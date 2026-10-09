import type { RoutePoint, Run, Settings } from '../../src/domain/trainingRecords';
import { recommendationArea } from '../../src/domain/areas';
import {
  mergeStrengthSessions,
  normalizeRun,
} from '../../src/domain/bridgeRecords';
import type { RunSeries } from '../../src/domain/runSeries';
import { readServerScope, type ServerScope } from '../../src/domain/serverLink';
import {
  isSetCompleted,
  type StrengthSession,
} from '../../src/domain/strength';
import {
  readStrengthHeartSummaries,
  type StrengthHeartSummary,
} from '../../src/domain/strengthHeart';
import type { Experiment } from '../../src/domain/types';
import type { Store } from './db';

/**
 * Reads the copy in `objects` with the same functions the app uses
 * (`domain/bridgeRecords`). The website, API and SQL tables therefore see the
 * same runs and workouts as the phone.
 */

export interface WellnessRow {
  id: string;
  kind: string;
  time: number;
  endTime: number | null;
  value: number | null;
  unit: string | null;
  source: string | null;
}

export interface Dataset {
  revision: number;
  /** Finished workouts of all sports, newest first. */
  runs: Run[];
  /** Own and imported strength sessions, newest first. */
  strength: StrengthSession[];
  heart: Record<string, StrengthHeartSummary>;
  settings: Settings | null;
  experiments: Experiment[];
  wellness: WellnessRow[];
  /** What the phone shared at the last sync; `null` before the first one. */
  scope: ServerScope | null;
  lastCommitAt: number | null;
  lastCompleteAt: number | null;
}

export interface RunDetail {
  series: RunSeries | null;
  route: RoutePoint[] | null;
}

const finite = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

function bodies(store: Store, kind: string): unknown[] {
  return (
    store.db
      .prepare('SELECT body FROM objects WHERE kind = ? ORDER BY key')
      .all(kind) as {
      body: string;
    }[]
  ).map(row => JSON.parse(row.body));
}

export function loadObject(store: Store, key: string): any | null {
  const row = store.db
    .prepare('SELECT body FROM objects WHERE key = ?')
    .get(key) as { body: string } | undefined;
  return row ? JSON.parse(row.body) : null;
}

function readWellness(raw: any): WellnessRow | null {
  const time = finite(raw?.time);
  if (
    typeof raw?.id !== 'string' ||
    typeof raw?.kind !== 'string' ||
    time === null
  )
    return null;
  const end = finite(raw.endTime);
  return {
    id: raw.id,
    kind: raw.kind,
    time,
    endTime: end && end > 0 ? end : null,
    value: finite(raw.value),
    unit: typeof raw.unit === 'string' && raw.unit ? raw.unit : null,
    source: typeof raw.source === 'string' && raw.source ? raw.source : null,
  };
}

const cache = new WeakMap<Store, Dataset>();

export function loadDataset(store: Store): Dataset {
  const revision = store.revision();
  const cached = cache.get(store);
  if (cached && cached.revision === revision) return cached;

  const runs = bodies(store, 'run')
    .map(raw => normalizeRun(raw))
    .filter(run => run.status !== 'recording' && run.startTime > 0)
    .sort((a, b) => b.startTime - a.startTime || b.id.localeCompare(a.id));
  const strength = mergeStrengthSessions(
    bodies(store, 'strength'),
    bodies(store, 'strengthImport'),
    Number.MAX_SAFE_INTEGER,
  ).filter(session => session.status !== 'active');
  const settings = loadObject(store, 'settings') as Settings | null;
  const experiments = Array.isArray(settings?.experiments)
    ? (settings!.experiments as Experiment[]).filter(
        entry => entry && typeof entry.id === 'string' && entry.recommendation,
      )
    : [];
  const scopeRaw = store.meta('scope');
  const dataset: Dataset = {
    revision,
    runs,
    strength,
    heart: readStrengthHeartSummaries(loadObject(store, 'strengthHeart')),
    settings,
    experiments,
    wellness: bodies(store, 'wellness')
      .map(readWellness)
      .filter((row): row is WellnessRow => row !== null)
      .sort((a, b) => b.time - a.time),
    scope: scopeRaw ? readServerScope(JSON.parse(scopeRaw)) : null,
    lastCommitAt: finite(Number(store.meta('lastCommitAt'))) || null,
    lastCompleteAt: finite(Number(store.meta('lastCompleteAt'))) || null,
  };
  cache.set(store, dataset);
  return dataset;
}

/** Trace and route of a run; either is missing if the phone did not send it. */
export function loadRunDetail(store: Store, id: string): RunDetail {
  const raw = loadObject(store, `runDetail/${id}`);
  const series =
    raw?.series && Array.isArray(raw.series.rows)
      ? (raw.series as RunSeries)
      : null;
  const route = Array.isArray(raw?.route)
    ? (raw.route as RoutePoint[]).filter(
        point =>
          finite(point?.latitude) !== null && finite(point?.longitude) !== null,
      )
    : null;
  return { series, route: route && route.length >= 2 ? route : null };
}

/** Rewrites the flat tables. Runs inside the sync transaction. */
export function rebuildDerived(store: Store) {
  const data = loadDataset(store);
  const db = store.db;
  [
    'runs',
    'strength_sets',
    'strength_sessions',
    'wellness',
    'recommendations',
  ].forEach(table => db.prepare(`DELETE FROM ${table}`).run());

  const insertRun = db.prepare(
    `INSERT OR REPLACE INTO runs(id, sport, purpose, name, start_ms, end_ms, duration_s, moving_s,
      distance_m, avg_heart_rate, avg_cadence, elevation_gain_m, rpe_legs, rpe_breathing, source,
      model_version) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  data.runs.forEach(run => {
    const elevation =
      run.elevation && (run.elevation as any).available
        ? finite((run.elevation as any).ascentMeters)
        : finite(run.elevationGainMeters);
    insertRun.run(
      run.id,
      run.sport ?? 'running',
      run.purpose,
      run.name ?? null,
      run.startTime,
      finite(run.endTime) && run.endTime > 0 ? run.endTime : null,
      finite(run.durationSeconds),
      finite(run.time?.movingSeconds),
      finite(run.distanceMeters),
      finite(run.avgHeartRate),
      finite(run.avgCadence),
      elevation,
      finite(run.rpe?.legs),
      finite(run.rpe?.breathing),
      run.source,
      run.model_version ?? null,
    );
  });

  const insertSession = db.prepare(
    `INSERT OR REPLACE INTO strength_sessions(id, name, start_ms, end_ms, duration_s, status, source,
      completed_sets, avg_heart_rate, max_heart_rate, model_version)
      VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const insertSet = db.prepare(
    `INSERT OR REPLACE INTO strength_sets(session_id, exercise_index, exercise_id, exercise_name,
      set_index, kind, completed, skipped, weight_kg, reps, seconds, rir, completed_ms)
      VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  data.strength.forEach(session => {
    const exercises = Array.isArray(session.exercises) ? session.exercises : [];
    const completed = exercises.reduce(
      (sum, exercise) =>
        sum + (exercise.sets ?? []).filter(isSetCompleted).length,
      0,
    );
    const end = finite(session.endTime);
    const heart = data.heart[session.id];
    insertSession.run(
      session.id,
      session.name || null,
      session.startTime,
      end,
      end !== null && end > session.startTime
        ? (end - session.startTime) / 1000
        : null,
      session.status,
      session.importSource?.source ?? 'runback',
      completed,
      heart ? finite(heart.averageBpm) : null,
      heart ? finite(heart.maxBpm) : null,
      session.modelVersion ?? null,
    );
    exercises.forEach((exercise, exerciseIndex) =>
      (exercise.sets ?? []).forEach((set, setIndex) =>
        insertSet.run(
          session.id,
          exerciseIndex,
          exercise.exerciseId,
          exercise.name,
          setIndex,
          set.planned?.kind ?? null,
          isSetCompleted(set) ? 1 : 0,
          set.skipped ? 1 : 0,
          finite(set.actualWeightKg),
          finite(set.actualReps),
          finite(set.actualSeconds),
          finite(set.actualRir),
          finite(set.completedAt),
        ),
      ),
    );
  });

  const insertWellness = db.prepare(
    'INSERT OR REPLACE INTO wellness(id, kind, time_ms, end_ms, value, unit, source) VALUES(?, ?, ?, ?, ?, ?, ?)',
  );
  data.wellness.forEach(row =>
    insertWellness.run(
      row.id,
      row.kind,
      row.time,
      row.endTime,
      row.value,
      row.unit,
      row.source,
    ),
  );

  const insertRecommendation = db.prepare(
    `INSERT OR REPLACE INTO recommendations(id, area, kind, title, action, status, accepted_ms,
      model_version) VALUES(?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  data.experiments.forEach(experiment => {
    const recommendation = experiment.recommendation;
    insertRecommendation.run(
      experiment.id,
      recommendationArea(recommendation),
      recommendation.kind,
      recommendation.title,
      recommendation.action,
      experiment.status,
      experiment.acceptedAt,
      recommendation.model_version ?? null,
    );
  });
}
