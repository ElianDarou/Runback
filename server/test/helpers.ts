import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SERVER_SYNC_PROTOCOL } from '../../src/domain/serverLink';
import { strengthSession } from '../../__tests__/fixtures/strengthSessions';
import { createApp } from '../src/app';
import { createPairingCode, ensurePassword } from '../src/auth';
import { Store } from '../src/db';

// Montag, 5. Oktober 2026, 18 Uhr lokale Zeit.
export const NOW = new Date(2026, 9, 5, 18).getTime();
export const DAY = 86_400_000;
export const PASSWORD = 'richtig-langes-passwort';

export function tempStore(): { store: Store; dispose: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'runback-test-'));
  const store = new Store(join(dir, 'runback.sqlite'));
  return {
    store,
    dispose: () => {
      store.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

export const hash = (body: unknown) =>
  createHash('sha256').update(JSON.stringify(body)).digest('hex');

/** Ein Lauf, wie ihn `RunStore.listRuns()` über die Brücke liefert. */
export function bridgeRun(
  id: string,
  startTime: number,
  overrides: Record<string, unknown> = {},
) {
  return {
    id,
    startTime,
    endTime: startTime + 1452_000,
    startedAt: startTime,
    endedAt: startTime + 1452_000,
    durationMs: 1452_000,
    durationSeconds: 1452,
    durationSec: 1452,
    elapsedMs: 1452_000,
    distanceMeters: 5020,
    distanceM: 5020,
    status: 'completed',
    source: 'watch',
    sport: 'running',
    purpose: 'race',
    model_version: 'distance-3.0',
    feedback: {
      rpe: { legs: 8, breathing: 9, recordedAt: startTime + 1500_000 },
    },
    segments: [
      {
        id: `${id}:0`,
        distanceMeters: 1003,
        durationSeconds: 290,
        movingSeconds: 288,
        avgHeartRate: 168,
      },
      {
        id: `${id}:1`,
        distanceMeters: 1001,
        durationSeconds: 291,
        movingSeconds: 291,
        avgHeartRate: 174,
      },
    ],
    ...overrides,
  };
}

export function bridgeStrength(id: string, startTime: number) {
  return strengthSession(id, startTime, [
    [
      'bench_press',
      'Bankdrücken',
      [
        { weightKg: 40, reps: 10, at: 2, warmup: true },
        { weightKg: 60, reps: 8, at: 6, rir: 2 },
        { weightKg: 60, reps: 7, at: 10, rir: 1 },
      ],
    ],
    [
      'biceps_curl',
      'Bizepscurls',
      [
        { weightKg: 12, reps: 12, at: 14 },
        { weightKg: 12, reps: 10 },
      ],
    ],
  ]);
}

export const SETTINGS = {
  goal: '5 km unter 22 Minuten',
  goalTargetDate: '2026-12-01',
  trainingFocus: {
    version: 'focus-v1',
    kind: 'speed',
    label: 'Schneller werden',
  },
  experiments: [
    {
      id: 'exp-1',
      acceptedAt: NOW - 5 * DAY,
      status: 'active',
      history: [],
      recommendation: {
        id: 'rec-1',
        kind: 'calmer_start',
        area: 'running',
        title: 'Ruhiger starten',
        action: 'Starte die ersten 2 km ruhiger.',
        reason: 'Du wirst auf dem letzten Kilometer deutlich langsamer.',
        purpose: 'easy',
        goal: 'Der Tempoabfall am Ende wird kleiner.',
        model_version: 'pacing-fade-v2',
        inputSources: [],
        segmentIds: [],
        criteria: {},
      },
    },
  ],
};

export function objects(): { key: string; body: unknown }[] {
  return [
    { key: 'run/r1', body: bridgeRun('r1', NOW - 2 * DAY) },
    {
      key: 'run/r2',
      body: bridgeRun('r2', NOW - DAY, { purpose: 'easy', feedback: {} }),
    },
    {
      key: 'runDetail/r1',
      body: {
        series: {
          stepSeconds: 5,
          rows: Array.from({ length: 40 }, (_, i) => ({
            elapsedSeconds: i * 5,
            distanceMeters: i * 17,
            moving: true,
            speedMps: 3.3 + (i % 5) * 0.05,
            heartRate: 150 + i,
          })),
        },
      },
    },
    { key: 'strength/s1', body: bridgeStrength('s1', NOW - 3 * DAY) },
    { key: 'settings', body: SETTINGS },
    {
      key: 'strengthHeart',
      body: { sessions: { s1: { averageBpm: 112, maxBpm: 151 } } },
    },
  ];
}

export function manifest(list = objects()): Record<string, string> {
  return Object.fromEntries(list.map(entry => [entry.key, hash(entry.body)]));
}

export async function startApp(store: Store) {
  ensurePassword(store, PASSWORD);
  const handler = createApp(store, {
    version: 'test',
    trustProxy: false,
    now: () => NOW,
  });
  const server: Server = createServer(handler);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    base,
    close: () => new Promise<void>(resolve => server.close(() => resolve())),
  };
}

/** Koppelt ein Telefon und gibt sein Token zurück. */
export async function pair(base: string, store: Store): Promise<string> {
  const { code } = createPairingCode(store, NOW);
  const response = await fetch(`${base}/api/v1/pair`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      code,
      deviceName: 'Pixel',
      protocol: SERVER_SYNC_PROTOCOL,
    }),
  });
  if (response.status !== 200) throw new Error(`pair: ${response.status}`);
  return ((await response.json()) as { token: string }).token;
}

export async function post(
  base: string,
  path: string,
  token: string,
  body: unknown,
) {
  const response = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: (await response.json()) as any };
}

/** Kompletter Abgleich wie das Telefon: plan → objects → commit. */
export async function syncAll(
  base: string,
  token: string,
  list = objects(),
  scope?: Record<string, boolean>,
) {
  const all = manifest(list);
  const planned = await post(base, '/api/v1/sync/plan', token, {
    protocol: SERVER_SYNC_PROTOCOL,
    manifest: all,
  });
  const need = new Set<string>(planned.body.need);
  const upload = list
    .filter(entry => need.has(entry.key))
    .map(entry => ({ ...entry, hash: all[entry.key] }));
  if (upload.length) {
    const stored = await post(base, '/api/v1/sync/objects', token, {
      protocol: SERVER_SYNC_PROTOCOL,
      objects: upload,
    });
    if (stored.status !== 200) throw new Error(JSON.stringify(stored.body));
  }
  const committed = await post(base, '/api/v1/sync/commit', token, {
    protocol: SERVER_SYNC_PROTOCOL,
    manifest: all,
    scope: scope ?? {
      runs: true,
      strength: true,
      coach: true,
      gps: false,
      health: false,
    },
  });
  return { need: [...need], commit: committed };
}

/** Meldet sich an und liefert Cookie und CSRF-Feld für Formulare. */
export async function login(
  base: string,
): Promise<{ cookie: string; csrf: string }> {
  const response = await fetch(`${base}/anmelden`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      password: PASSWORD,
      next: '/daten',
    }).toString(),
    redirect: 'manual',
  });
  const cookie = (response.headers.get('set-cookie') ?? '').split(';')[0];
  const page = await (
    await fetch(`${base}/daten`, { headers: { cookie } })
  ).text();
  const csrf = /name="csrf" value="([^"]+)"/.exec(page)?.[1] ?? '';
  return { cookie, csrf };
}
