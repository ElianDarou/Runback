import { exerciseTrend, type ExerciseTrend } from './exerciseHistory';
import { finite, medianOrNull } from './inference';
import { muscleDistribution, type MuscleDistribution } from './muscleGroups';
import { assessExerciseProgression } from './progression';
import {
  displaySessionName,
  isSetCompleted,
  sessionProgress,
  type StrengthSession,
} from './strength';
import type { StrengthHeartSummary } from './strengthHeart';
import {
  exerciseBreakdown,
  sessionDurationSeconds,
  setGaps,
  type BestSet,
} from './strengthSession';
import { average } from './statistics';
import { numberFormat, tr } from './i18n';
import {
  advance,
  bucketLabels,
  buildConsistency,
  dayLongFormat,
  distinctDays,
  makeDelta,
  RANGE_COMPARISONS,
  startOf,
  statsWindow,
  unitFor,
  type BucketUnit,
  type StatsConsistency,
  type StatsDelta,
  type StatsRange,
} from './statisticsView';

/**
 * Statistics for the strength training area — the same questions as for runs
 * ("How much? How regularly? What were the personal bests? How did it feel?"),
 * answered with measures that fit strength training: sessions, sets, volume,
 * sets per muscle group, progress per exercise, and heart rate from the watch.
 * Running and strength training are never combined.
 *
 * Only finished sessions and ticked-off sets are counted. Pure functions; the
 * only time source is `now`.
 */
export const STRENGTH_STATS_VERSION = 'strength-stats-v2';

export type StrengthStatsMetric =
  | 'sessions'
  | 'sets'
  | 'volume'
  | 'duration'
  | 'heartRate';

export interface StrengthBucket {
  startTime: number;
  /** Exclusive. */
  endTime: number;
  label: string;
  fullLabel: string;
  sessionCount: number;
  /** Ticked-off sets, counted as in the session (including warm-up). */
  sets: number;
  volumeKg: number | null;
  durationSeconds: number | null;
  /** Average of the sessions with heart rate; without heart rate `null`. */
  averageBpm: number | null;
}

export interface StrengthTotals {
  sessionCount: number;
  sets: number;
  workingSets: number;
  volumeKg: number;
  /** Sum of the sessions with a known duration. */
  durationSeconds: number;
  averageDurationSeconds: number | null;
  setsPerSession: number | null;
  sessionsPerWeek: number | null;
  activeDays: number;
  medianRir: number | null;
  rirSets: number;
  averageBpm: number | null;
  maxBpm: number | null;
  heartSessions: number;
  medianSetGapSeconds: number | null;
}

export interface StrengthExerciseStat {
  exerciseId: string;
  name: string;
  sessions: number;
  workingSets: number;
  volumeKg: number;
  lastAt: number;
  /** Best set in the period. */
  best?: BestSet;
  /** Direction from all sessions so far, not just from the period. */
  trend: ExerciseTrend;
}

export interface StrengthRecord {
  id: string;
  label: string;
  value: string;
  detail: string;
  /** Exactly the sessions that carry the personal best. */
  sessionIds: string[];
}

export interface StrengthStatisticsView {
  version: typeof STRENGTH_STATS_VERSION;
  range: StatsRange;
  bucketUnit: BucketUnit;
  windowStart: number;
  windowEnd: number;
  buckets: StrengthBucket[];
  totals: StrengthTotals;
  deltas: Record<'sessions' | 'sets' | 'volume' | 'duration', StatsDelta>;
  comparisonLabel: string | null;
  muscles: MuscleDistribution & { weekCount: number };
  exercises: StrengthExerciseStat[];
  records: StrengthRecord[];
  consistency: StatsConsistency;
  available: { volume: boolean; duration: boolean; heartRate: boolean };
  sessions: StrengthSession[];
}

export function validStrengthSession(
  session: StrengthSession,
  now: number,
): boolean {
  return (
    session.status === 'finished' &&
    finite(session.startTime) &&
    session.startTime > 0 &&
    session.startTime <= now &&
    Array.isArray(session.exercises)
  );
}

function dedupe(sessions: StrengthSession[], now: number): StrengthSession[] {
  const unique = new Map<string, StrengthSession>();
  sessions.forEach(session => {
    if (validStrengthSession(session, now) && !unique.has(session.id)) {
      unique.set(session.id, session);
    }
  });
  return Array.from(unique.values()).sort((a, b) => a.startTime - b.startTime);
}

function heartOf(
  sessions: StrengthSession[],
  heart: Record<string, StrengthHeartSummary>,
): StrengthHeartSummary[] {
  return sessions
    .map(session => heart[session.id])
    .filter((entry): entry is StrengthHeartSummary =>
      Boolean(entry && finite(entry.averageBpm)),
    );
}

function buildBucket(
  startTime: number,
  unit: BucketUnit,
  sessions: StrengthSession[],
  heart: Record<string, StrengthHeartSummary>,
): StrengthBucket {
  let sets = 0;
  let volumeKg = 0;
  let durationSeconds = 0;
  let hasVolume = sessions.length === 0;
  let hasDuration = sessions.length === 0;
  sessions.forEach(session => {
    const progress = sessionProgress(session);
    sets += progress.completedSets;
    volumeKg += progress.volumeKg;
    const duration = sessionDurationSeconds(session);
    if (duration !== undefined) {
      durationSeconds += duration;
      hasDuration = true;
    }
    hasVolume ||= session.exercises.some(exercise =>
      exercise.sets.some(set =>
        isSetCompleted(set) && !set.skipped &&
        finite(set.actualWeightKg) && finite(set.actualReps),
      ),
    );
  });
  return {
    startTime,
    endTime: advance(startTime, unit, 1),
    ...bucketLabels(startTime, unit),
    sessionCount: sessions.length,
    sets,
    volumeKg: hasVolume ? volumeKg : null,
    durationSeconds: hasDuration ? durationSeconds : null,
    averageBpm: average(heartOf(sessions, heart).map(entry => entry.averageBpm)),
  };
}

function bucketize(
  sessions: StrengthSession[],
  unit: BucketUnit,
  windowStart: number,
  windowEnd: number,
  heart: Record<string, StrengthHeartSummary>,
): StrengthBucket[] {
  const byStart = new Map<number, StrengthSession[]>();
  sessions.forEach(session => {
    const start = startOf(session.startTime, unit);
    byStart.set(start, (byStart.get(start) || []).concat(session));
  });
  const buckets: StrengthBucket[] = [];
  for (
    let start = startOf(windowStart, unit);
    start < windowEnd;
    start = advance(start, unit, 1)
  ) {
    buckets.push(buildBucket(start, unit, byStart.get(start) || [], heart));
  }
  return buckets;
}

function totalsFor(
  sessions: StrengthSession[],
  weeks: number,
  heart: Record<string, StrengthHeartSummary>,
): StrengthTotals {
  let sets = 0;
  let workingSets = 0;
  let volumeKg = 0;
  const durations: number[] = [];
  const rir: number[] = [];
  const gaps: number[] = [];
  sessions.forEach(session => {
    const progress = sessionProgress(session);
    sets += progress.completedSets;
    volumeKg += progress.volumeKg;
    const duration = sessionDurationSeconds(session);
    if (duration !== undefined) {
      durations.push(duration);
    }
    exerciseBreakdown(session).forEach(part => {
      workingSets += part.workingSets;
    });
    session.exercises.forEach(exercise =>
      exercise.sets.forEach(set => {
        if (
          isSetCompleted(set) &&
          !set.skipped &&
          set.planned?.kind !== 'warmup' &&
          finite(set.actualRir)
        ) {
          rir.push(set.actualRir);
        }
      }),
    );
    gaps.push(...setGaps(session).gaps);
  });
  const withHeart = heartOf(sessions, heart);
  const durationSeconds = durations.reduce((sum, value) => sum + value, 0);
  return {
    sessionCount: sessions.length,
    sets,
    workingSets,
    volumeKg,
    durationSeconds,
    averageDurationSeconds: durations.length
      ? durationSeconds / durations.length
      : null,
    setsPerSession: sessions.length ? sets / sessions.length : null,
    sessionsPerWeek: weeks > 0 ? sessions.length / weeks : null,
    activeDays: distinctDays(sessions),
    // RIR is a count with a rough self-assessment: median instead of mean.
    medianRir: medianOrNull(rir),
    rirSets: rir.length,
    averageBpm: average(withHeart.map(entry => entry.averageBpm)),
    maxBpm: withHeart.length
      ? Math.max(...withHeart.map(entry => entry.maxBpm))
      : null,
    heartSessions: withHeart.length,
    medianSetGapSeconds: medianOrNull(gaps),
  };
}

function durationText(seconds: number) {
  const whole = Math.max(0, Math.round(seconds));
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  return hours ? `${hours} h ${minutes} min` : `${minutes} min`;
}

const setsText = (count: number) =>
  `${count} ${count === 1 ? tr('Satz', 'set') : tr('Sätze', 'sets')}`;

function sessionDetail(session: StrengthSession) {
  return `${displaySessionName(session.name) || tr('Krafttraining', 'Strength training')} · ${dayLongFormat.format(
    new Date(session.startTime),
  )}`;
}

function bestBy(
  sessions: StrengthSession[],
  value: (session: StrengthSession) => number | undefined,
): { session: StrengthSession; value: number } | null {
  let best: { session: StrengthSession; value: number } | null = null;
  sessions.forEach(session => {
    const candidate = value(session);
    if (finite(candidate) && candidate > 0 && (!best || candidate > best.value)) {
      best = { session, value: candidate };
    }
  });
  return best;
}

function buildRecords(
  sessions: StrengthSession[],
  weeks: StrengthBucket[],
): StrengthRecord[] {
  const records: StrengthRecord[] = [];
  const volume = bestBy(sessions, session => sessionProgress(session).volumeKg);
  if (volume) {
    records.push({
      id: 'biggest-volume',
      label: tr('Größtes Volumen', 'Largest volume'),
      value: `${numberFormat({ maximumFractionDigits: 0 }).format(volume.value)} kg`,
      detail: sessionDetail(volume.session),
      sessionIds: [volume.session.id],
    });
  }
  const sets = bestBy(sessions, session => sessionProgress(session).completedSets);
  if (sets) {
    records.push({
      id: 'most-sets',
      label: tr('Meiste Sätze', 'Most sets'),
      value: setsText(sets.value),
      detail: sessionDetail(sets.session),
      sessionIds: [sets.session.id],
    });
  }
  const longest = bestBy(sessions, sessionDurationSeconds);
  if (longest) {
    records.push({
      id: 'longest',
      label: tr('Längste Einheit', 'Longest session'),
      value: durationText(longest.value),
      detail: sessionDetail(longest.session),
      sessionIds: [longest.session.id],
    });
  }
  const week = weeks.reduce<StrengthBucket | null>(
    (best, bucket) => (!best || bucket.sets > best.sets ? bucket : best),
    null,
  );
  if (week && week.sets > 0) {
    records.push({
      id: 'best-week',
      label: tr('Stärkste Woche', 'Strongest week'),
      value: setsText(week.sets),
      detail: week.fullLabel,
      sessionIds: sessions
        .filter(
          session =>
            session.startTime >= week.startTime &&
            session.startTime < week.endTime,
        )
        .map(session => session.id),
    });
  }
  return records;
}

function buildExercises(
  sessions: StrengthSession[],
  history: StrengthSession[],
): StrengthExerciseStat[] {
  const byId = new Map<
    string,
    Omit<StrengthExerciseStat, 'trend'> & { sessionIds: Set<string> }
  >();
  sessions.forEach(session => {
    exerciseBreakdown(session).forEach(part => {
      if (!part.workingSets) {
        return;
      }
      const entry = byId.get(part.exerciseId) ?? {
        exerciseId: part.exerciseId,
        name: part.name,
        sessions: 0,
        workingSets: 0,
        volumeKg: 0,
        lastAt: session.startTime,
        sessionIds: new Set<string>(),
      };
      entry.sessionIds.add(session.id);
      entry.sessions = entry.sessionIds.size;
      entry.workingSets += part.workingSets;
      entry.volumeKg += part.volumeKg;
      if (session.startTime >= entry.lastAt) {
        entry.lastAt = session.startTime;
        // The newest name applies if the exercise was renamed.
        entry.name = part.name;
      }
      const best = part.bestSet;
      if (
        best &&
        (!entry.best ||
          (best.e1rm ?? -1) > (entry.best.e1rm ?? -1) ||
          ((best.e1rm ?? -1) === (entry.best.e1rm ?? -1) &&
            (best.weightKg ?? -1) > (entry.best.weightKg ?? -1)))
      ) {
        entry.best = best;
      }
      byId.set(part.exerciseId, entry);
    });
  });
  return Array.from(byId.values())
    .sort(
      (a, b) =>
        b.workingSets - a.workingSets ||
        b.lastAt - a.lastAt ||
        a.name.localeCompare(b.name),
    )
    .map(({ sessionIds: _ids, ...entry }) => ({
      ...entry,
      trend: exerciseTrend(assessExerciseProgression(history, entry.exerciseId)),
    }));
}

/** Whole view for one period, computed consistently. */
export function buildStrengthStatisticsView(
  input: StrengthSession[],
  range: StatsRange = '12w',
  now = Date.now(),
  heart: Record<string, StrengthHeartSummary> = {},
): StrengthStatisticsView {
  const referenceNow = Number.isFinite(now) ? now : Date.now();
  const all = dedupe(input, referenceNow);
  const { windowStart, windowEnd } = statsWindow(
    range,
    all.length ? all[0].startTime : null,
    referenceNow,
  );
  const inRange = all.filter(
    session =>
      session.startTime >= windowStart && session.startTime < windowEnd,
  );
  const unit = unitFor(range, windowStart, windowEnd);
  const buckets = bucketize(inRange, unit, windowStart, windowEnd, heart);
  const weekBuckets =
    unit === 'week'
      ? buckets
      : bucketize(inRange, 'week', windowStart, windowEnd, heart);
  const previousStart =
    range === 'all' ? null : windowStart - (windowEnd - windowStart);
  const previous =
    previousStart === null
      ? []
      : all.filter(
          session =>
            session.startTime >= previousStart &&
            session.startTime < windowStart,
        );
  const compare = previous.length > 0;
  const totals = totalsFor(inRange, weekBuckets.length, heart);
  const before = totalsFor(previous, weekBuckets.length, heart);
  const against = (current: number | null, past: number | null) =>
    makeDelta(current, compare ? past : null);
  return {
    version: STRENGTH_STATS_VERSION,
    range,
    bucketUnit: unit,
    windowStart,
    windowEnd,
    buckets,
    totals,
    deltas: {
      sessions: against(totals.sessionCount, before.sessionCount),
      sets: against(totals.sets, before.sets),
      volume: against(
        totals.volumeKg > 0 ? totals.volumeKg : null,
        before.volumeKg > 0 ? before.volumeKg : null,
      ),
      duration: against(
        totals.durationSeconds > 0 ? totals.durationSeconds : null,
        before.durationSeconds > 0 ? before.durationSeconds : null,
      ),
    },
    comparisonLabel: compare ? RANGE_COMPARISONS[range] : null,
    muscles: { ...muscleDistribution(inRange), weekCount: weekBuckets.length },
    exercises: buildExercises(inRange, all),
    records: buildRecords(inRange, weekBuckets),
    consistency: buildConsistency(inRange, windowStart, windowEnd),
    available: {
      volume: totals.volumeKg > 0,
      duration: totals.durationSeconds > 0,
      heartRate: totals.heartSessions > 0,
    },
    sessions: inRange,
  };
}

export function strengthBucketValue(
  bucket: StrengthBucket,
  metric: StrengthStatsMetric,
): number | null {
  switch (metric) {
    case 'sessions':
      return bucket.sessionCount;
    case 'sets':
      return bucket.sets;
    case 'volume':
      return bucket.volumeKg;
    case 'duration':
      return bucket.durationSeconds;
    case 'heartRate':
      return bucket.averageBpm;
  }
}
