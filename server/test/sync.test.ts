import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { SERVER_SYNC_PROTOCOL } from '../../src/domain/serverLink';
import { createPairingCode, redeemPairingCode } from '../src/auth';
import { loadDataset } from '../src/records';
import {
  DAY,
  NOW,
  bridgeRun,
  manifest,
  objects,
  pair,
  post,
  startApp,
  syncAll,
  tempStore,
} from './helpers';

describe('Kopplung', () => {
  it('löst einen Code genau einmal ein und ersetzt das alte Telefon', () => {
    const { store, dispose } = tempStore();
    try {
      const first = createPairingCode(store, NOW);
      assert.equal(first.code.length, 8);
      const phone = redeemPairingCode(store, first.code, 'Pixel', 1, NOW);
      assert.ok(phone?.token.startsWith('rbd_'));
      assert.equal(redeemPairingCode(store, first.code, 'Pixel', 1, NOW), null);

      const second = createPairingCode(store, NOW);
      assert.ok(redeemPairingCode(store, second.code, 'Neues Telefon', 1, NOW));
      const devices = store.db.prepare('SELECT name FROM devices').all() as {
        name: string;
      }[];
      assert.deepEqual(
        devices.map(d => d.name),
        ['Neues Telefon'],
      );
    } finally {
      dispose();
    }
  });

  it('verbraucht den Code nach fünf falschen Versuchen und nach zehn Minuten', () => {
    const { store, dispose } = tempStore();
    try {
      const { code } = createPairingCode(store, NOW);
      const wrong = code === '00000000' ? '11111111' : '00000000';
      for (let i = 0; i < 5; i++)
        assert.equal(redeemPairingCode(store, wrong, 'x', 1, NOW), null);
      assert.equal(redeemPairingCode(store, code, 'x', 1, NOW), null);

      const fresh = createPairingCode(store, NOW);
      assert.equal(
        redeemPairingCode(store, fresh.code, 'x', 1, NOW + 11 * 60_000),
        null,
      );
    } finally {
      dispose();
    }
  });
});

describe('Abgleich', () => {
  const { store, dispose } = tempStore();
  let app: Awaited<ReturnType<typeof startApp>>;
  let token = '';
  before(async () => {
    app = await startApp(store);
    token = await pair(app.base, store);
  });
  after(async () => {
    await app.close();
    dispose();
  });

  it('übernimmt beim ersten Mal alles und danach nur Änderungen', async () => {
    const first = await syncAll(app.base, token);
    assert.equal(first.need.length, objects().length);
    assert.deepEqual(first.commit.body.missing, []);

    const second = await syncAll(app.base, token);
    assert.deepEqual(second.need, []);

    const data = loadDataset(store);
    assert.deepEqual(
      data.runs.map(run => run.id),
      ['r2', 'r1'],
    );
    assert.equal(data.strength[0].id, 's1');
    assert.equal(data.experiments.length, 1);
    assert.ok(data.lastCompleteAt);
  });

  it('schreibt flache Tabellen mit NULL statt erfundener Werte', async () => {
    await syncAll(app.base, token);
    const run = store.db
      .prepare("SELECT * FROM v1_runs WHERE id = 'r1'")
      .get() as Record<string, unknown>;
    assert.equal(run.distance_m, 5020);
    assert.equal(run.rpe_legs, 8);
    assert.equal(run.avg_heart_rate, null);
    assert.match(String(run.start_utc), /^2026-10-03T/);
    const easy = store.db
      .prepare("SELECT rpe_legs FROM v1_runs WHERE id = 'r2'")
      .get() as Record<string, unknown>;
    assert.equal(easy.rpe_legs, null);

    const sets = store.db
      .prepare(
        "SELECT exercise_name, weight_kg, reps, completed, rir FROM v1_strength_sets WHERE session_id = 's1' ORDER BY exercise_index, set_index",
      )
      .all() as Record<string, unknown>[];
    assert.equal(sets.length, 5);
    assert.deepEqual(
      { ...sets[1] },
      {
        exercise_name: 'Bankdrücken',
        weight_kg: 60,
        reps: 8,
        completed: 1,
        rir: 2,
      },
    );
    // Nicht abgehakt: Ist-Werte bleiben leer, nicht 0.
    assert.deepEqual(
      { ...sets[4] },
      {
        exercise_name: 'Bizepscurls',
        weight_kg: null,
        reps: null,
        completed: 0,
        rir: null,
      },
    );

    const session = store.db
      .prepare(
        'SELECT completed_sets, avg_heart_rate FROM v1_strength_sessions',
      )
      .get() as Record<string, unknown>;
    assert.deepEqual(
      { ...session },
      { completed_sets: 4, avg_heart_rate: 112 },
    );
    const recommendation = store.db
      .prepare('SELECT area, status, title FROM v1_recommendations')
      .get() as Record<string, unknown>;
    assert.deepEqual(
      { ...recommendation },
      { area: 'running', status: 'active', title: 'Ruhiger starten' },
    );
  });

  it('löscht, was das Telefon nicht mehr hat, und lädt Geändertes neu', async () => {
    await syncAll(app.base, token);
    const changed = objects()
      .filter(entry => entry.key !== 'run/r2')
      .map(entry =>
        entry.key === 'run/r1'
          ? {
              ...entry,
              body: bridgeRun('r1', NOW - 2 * DAY, { distanceMeters: 5100 }),
            }
          : entry,
      );
    const result = await syncAll(app.base, token, changed);
    assert.deepEqual(result.need, ['run/r1']);
    assert.equal(result.commit.body.deleted, 1);
    assert.deepEqual(
      loadDataset(store).runs.map(run => run.id),
      ['r1'],
    );
    assert.equal(
      (
        store.db.prepare('SELECT count(*) AS n FROM v1_runs').get() as {
          n: number;
        }
      ).n,
      1,
    );
  });

  it('meldet fehlende Objekte und markiert den Abgleich als unvollständig', async () => {
    await syncAll(app.base, token);
    const before = loadDataset(store).lastCompleteAt;
    const list = [...objects(), { key: 'run/r9', body: bridgeRun('r9', NOW) }];
    const commit = await post(app.base, '/api/v1/sync/commit', token, {
      protocol: SERVER_SYNC_PROTOCOL,
      manifest: manifest(list),
    });
    assert.deepEqual(commit.body.missing, ['run/r9']);
    assert.equal(loadDataset(store).lastCompleteAt, before);
  });

  it('lehnt unbekannte Schlüssel, falsche Hashes und andere Protokolle ab', async () => {
    const bad = await post(app.base, '/api/v1/sync/plan', token, {
      protocol: SERVER_SYNC_PROTOCOL,
      manifest: { 'raw/x': 'a'.repeat(64) },
    });
    assert.equal(bad.status, 400);
    const single = await post(app.base, '/api/v1/sync/plan', token, {
      protocol: SERVER_SYNC_PROTOCOL,
      manifest: { 'settings/x': 'a'.repeat(64) },
    });
    assert.equal(single.status, 400);
    const badHash = await post(app.base, '/api/v1/sync/plan', token, {
      protocol: SERVER_SYNC_PROTOCOL,
      manifest: { 'run/a': 'xyz' },
    });
    assert.equal(badHash.status, 400);
    const version = await post(app.base, '/api/v1/sync/plan', token, {
      protocol: 99,
      manifest: {},
    });
    assert.equal(version.status, 409);
  });

  it('zeigt bis zum vollständigen Commit unverändert den letzten Stand', async () => {
    await syncAll(app.base, token);
    const changed = objects().map(entry =>
      entry.key === 'run/r1'
        ? {
            ...entry,
            body: bridgeRun('r1', NOW - 2 * DAY, { distanceMeters: 6000 }),
          }
        : entry,
    );
    const all = manifest(changed);
    const entry = changed.find(value => value.key === 'run/r1')!;
    await post(app.base, '/api/v1/sync/objects', token, {
      protocol: 1,
      objects: [{ ...entry, hash: all[entry.key] }],
    });
    assert.equal(
      loadDataset(store).runs.find(run => run.id === 'r1')?.distanceMeters,
      5020,
    );
    const interrupted = await post(app.base, '/api/v1/sync/commit', token, {
      protocol: 1,
      manifest: { ...all, 'run/missing': 'f'.repeat(64) },
    });
    assert.deepEqual(interrupted.body.missing, ['run/missing']);
    assert.equal(
      loadDataset(store).runs.find(run => run.id === 'r1')?.distanceMeters,
      5020,
    );
    const resumed = await syncAll(app.base, token, changed);
    assert.deepEqual(resumed.need, []);
    assert.equal(
      loadDataset(store).runs.find(run => run.id === 'r1')?.distanceMeters,
      6000,
    );
  });

  it('nimmt nur das Telefon-Token an', async () => {
    const response = await post(app.base, '/api/v1/sync/plan', 'rbr_falsch', {
      protocol: SERVER_SYNC_PROTOCOL,
      manifest: {},
    });
    assert.equal(response.status, 401);
  });

  it('trennt das Telefon und löscht auf Wunsch die Kopie', async () => {
    await syncAll(app.base, token);
    const response = await fetch(`${app.base}/api/v1/device?copy=delete`, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${token}` },
    });
    assert.equal(response.status, 200);
    assert.equal(loadDataset(store).runs.length, 0);
    const again = await post(app.base, '/api/v1/sync/plan', token, {
      protocol: SERVER_SYNC_PROTOCOL,
      manifest: {},
    });
    assert.equal(again.status, 401);
    token = await pair(app.base, store);
  });
});
