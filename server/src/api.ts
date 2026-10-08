import { mkdtempSync, rmSync, createReadStream, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { ServerResponse } from 'node:http';
import {
  buildStatisticsView,
  STATS_RANGES,
  type StatsRange,
} from '../../src/domain/statisticsView';
import { buildStrengthStatisticsView } from '../../src/domain/strengthStatistics';
import { PUBLIC_VIEWS, type PublicView, type Store } from './db';
import { loadDataset, loadRunDetail, loadObject } from './records';

/**
 * Read-only API under `/api/v1`. Responses are JSON; times are ISO 8601 in UTC
 * (`*_utc`) or milliseconds (`*Time`, as in the app). Unknown values are `null`.
 */

export class ApiError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

const RANGES = STATS_RANGES.map(entry => entry.value);

function limitParam(
  url: URL,
  fallback = 100,
  max = 1000,
): { limit: number; offset: number } {
  const limit = Number(url.searchParams.get('limit') ?? fallback);
  const offset = Number(url.searchParams.get('offset') ?? 0);
  if (!Number.isInteger(limit) || limit < 1 || limit > max) {
    throw new ApiError(400, `limit must be between 1 and ${max}.`);
  }
  if (!Number.isInteger(offset) || offset < 0)
    throw new ApiError(400, 'offset must be ≥ 0.');
  return { limit, offset };
}

/** `from`/`to` as a date or time (ISO 8601); `to` is exclusive. */
function timeFilter(
  url: URL,
  column: string,
): { where: string[]; values: string[] } {
  const where: string[] = [];
  const values: string[] = [];
  (['from', 'to'] as const).forEach(name => {
    const raw = url.searchParams.get(name);
    if (!raw) return;
    const at = Date.parse(raw);
    if (!Number.isFinite(at))
      throw new ApiError(400, `${name} is not a valid date.`);
    where.push(`${column} ${name === 'from' ? '>=' : '<'} ?`);
    values.push(new Date(at).toISOString());
  });
  return { where, values };
}

function listView(
  store: Store,
  view: PublicView,
  url: URL,
  { time, filters }: { time: string; filters: Record<string, string> },
) {
  const { limit, offset } = limitParam(url);
  const { where, values } = timeFilter(url, time);
  Object.entries(filters).forEach(([param, column]) => {
    const value = url.searchParams.get(param);
    if (value) {
      where.push(`${column} = ?`);
      values.push(value);
    }
  });
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const total = (
    store.db
      .prepare(`SELECT count(*) AS n FROM ${view} ${clause}`)
      .get(...values) as { n: number }
  ).n;
  const items = store.db
    .prepare(
      `SELECT * FROM ${view} ${clause} ORDER BY ${time} DESC LIMIT ? OFFSET ?`,
    )
    .all(...values, limit, offset);
  return { total: Number(total), limit, offset, items };
}

function rangeParam(url: URL): StatsRange {
  const value = url.searchParams.get('range') ?? '12w';
  if (!(RANGES as string[]).includes(value))
    throw new ApiError(400, `range must be one of ${RANGES.join(', ')}.`);
  return value as StatsRange;
}

export function apiRead(
  store: Store,
  path: string,
  url: URL,
  now: number,
): unknown {
  const data = loadDataset(store);
  if (path === '/status') {
    return {
      revision: data.revision,
      lastCompleteAt: data.lastCompleteAt,
      lastCommitAt: data.lastCommitAt,
      scope: data.scope,
      counts: {
        runs: data.runs.length,
        strengthSessions: data.strength.length,
        wellness: data.wellness.length,
      },
    };
  }
  if (path === '/documents')
    return listView(store, 'v1_documents', url, {
      time: 'updated_utc',
      filters: { kind: 'kind', key: 'key' },
    });
  if (path === '/runs') {
    return listView(store, 'v1_runs', url, {
      time: 'start_utc',
      filters: { sport: 'sport', purpose: 'purpose' },
    });
  }
  let match = /^\/runs\/([^/]+)$/.exec(path);
  if (match) {
    const id = decodeURIComponent(match[1]);
    const run = data.runs.find(entry => entry.id === id);
    if (!run)
      throw new ApiError(404, 'This workout does not exist on the server.');
    const detail = loadRunDetail(store, id);
    return { run, series: detail.series, route: detail.route };
  }
  if (path === '/strength/sessions') {
    return listView(store, 'v1_strength_sessions', url, {
      time: 'start_utc',
      filters: { status: 'status' },
    });
  }
  match = /^\/strength\/sessions\/([^/]+)$/.exec(path);
  if (match) {
    const id = decodeURIComponent(match[1]);
    const session = data.strength.find(entry => entry.id === id);
    if (!session)
      throw new ApiError(404, 'This workout does not exist on the server.');
    return { session, heart: data.heart[id] ?? null };
  }
  if (path === '/strength/sets') {
    return listView(store, 'v1_strength_sets', url, {
      time: 'session_start_utc',
      filters: { exercise: 'exercise_id', session: 'session_id' },
    });
  }
  if (path === '/wellness') {
    return listView(store, 'v1_wellness', url, {
      time: 'time_utc',
      filters: { kind: 'kind' },
    });
  }
  if (path === '/recommendations') {
    return listView(store, 'v1_recommendations', url, {
      time: 'accepted_utc',
      filters: { area: 'area', status: 'status' },
    });
  }
  if (path === '/plan')
    return {
      schedule: data.settings?.schedule ?? null,
      presets: data.settings?.presets ?? [],
      templates: loadObject(store, 'templates')?.templates ?? [],
    };
  if (path === '/soreness')
    return loadObject(store, 'soreness') ?? { reports: [] };
  if (path === '/coach') {
    const settings = data.settings;
    return {
      running: {
        goal: settings?.goal ?? null,
        goalTargetDate: settings?.goalTargetDate ?? null,
        focus: settings?.trainingFocus ?? null,
      },
      strength: {
        goal: settings?.strengthGoal ?? null,
        goalTargetDate: settings?.strengthGoalTargetDate ?? null,
        focus: settings?.strengthFocus ?? null,
      },
      experiments: data.experiments,
    };
  }
  if (path === '/stats/running') {
    const { runs: _runs, ...view } = buildStatisticsView(
      data.runs,
      rangeParam(url),
      now,
    );
    return view;
  }
  if (path === '/stats/strength') {
    const { sessions: _sessions, ...view } = buildStrengthStatisticsView(
      data.strength,
      rangeParam(url),
      now,
      data.heart,
    );
    return view;
  }
  throw new ApiError(404, 'Unknown endpoint.');
}

const csvCell = (value: unknown) => {
  if (value === null || value === undefined) return '';
  const text = String(value);
  return /[",\n\r;]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

export function writeCsv(
  res: ServerResponse,
  columns: string[],
  rows: Iterable<unknown[]>,
  filename: string,
) {
  res.writeHead(200, {
    'content-type': 'text/csv; charset=utf-8',
    'content-disposition': `attachment; filename="${filename}"`,
  });
  res.write(`﻿${columns.map(csvCell).join(',')}\n`);
  for (const row of rows) res.write(`${row.map(csvCell).join(',')}\n`);
  res.end();
}

export function exportView(store: Store, res: ServerResponse, name: string) {
  const match = /^(v1_[a-z_]+)\.(csv|jsonl)$/.exec(name);
  const view = match?.[1] as PublicView | undefined;
  if (!match || !view || !PUBLIC_VIEWS.includes(view))
    throw new ApiError(404, 'Unknown export.');
  const statement = store.db.prepare(`SELECT * FROM ${view}`);
  const columns = statement.columns().map(column => column.name);
  if (match[2] === 'csv') {
    writeCsv(
      res,
      columns,
      (function* () {
        for (const row of statement.iterate())
          yield columns.map(column => (row as Record<string, unknown>)[column]);
      })(),
      `runback-${view}.csv`,
    );
    return;
  }
  res.writeHead(200, {
    'content-type': 'application/x-ndjson; charset=utf-8',
    'content-disposition': `attachment; filename="runback-${view}.jsonl"`,
  });
  for (const row of statement.iterate()) res.write(`${JSON.stringify(row)}\n`);
  res.end();
}

/**
 * Whole database as a file, without credentials: password, sessions, tokens
 * and devices stay on the server.
 */
export function exportDatabase(store: Store, res: ServerResponse) {
  const dir = mkdtempSync(join(tmpdir(), 'runback-export-'));
  const file = join(dir, 'runback.sqlite');
  try {
    store.db.prepare('VACUUM INTO ?').run(file);
    const copy = new DatabaseSync(file);
    copy.exec(`DELETE FROM staged_objects; DELETE FROM sessions; DELETE FROM tokens; DELETE FROM devices; DELETE FROM pairing;
      DELETE FROM meta WHERE key = 'password'; VACUUM;`);
    copy.close();
    const day = new Date().toISOString().slice(0, 10);
    res.writeHead(200, {
      'content-type': 'application/vnd.sqlite3',
      'content-length': String(statSync(file).size),
      'content-disposition': `attachment; filename="runback-${day}.sqlite"`,
    });
    const stream = createReadStream(file);
    stream.pipe(res);
    stream.on('close', () => rmSync(dir, { recursive: true, force: true }));
    stream.on('error', () => {
      rmSync(dir, { recursive: true, force: true });
      res.destroy();
    });
  } catch (error) {
    rmSync(dir, { recursive: true, force: true });
    throw error;
  }
}
