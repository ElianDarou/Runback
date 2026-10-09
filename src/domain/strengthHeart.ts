import { median } from './inference';
import type { StrengthSession } from './strength';
import { sourceName } from './importReview';
import { tr } from './i18n';

/**
 * Strength heart rate, from the watch's display series (Kotlin
 * `StrengthHeart`): windows of at least 5 s from the start of the session;
 * empty windows stay empty. This derives what a strength athlete can use: the
 * heart rate at the end of a set and how far it drops in the first rest
 * minute. An observation, not a recommendation or a fitness number.
 *
 * Set starts are not known, only the tick-off. So fixed windows set in
 * advance around the tick-off apply (see constants), and a recovery only
 * counts when the next set certainly had not started yet.
 */
export const STRENGTH_HEART_INSIGHTS_VERSION = 'strength-heart-insights-v1';
/** The set peak is the highest window from 30 s before to 15 s after the tick-off. */
export const SET_PEAK_BEFORE_SECONDS = 30;
export const SET_PEAK_AFTER_SECONDS = 15;
/** Recovery: set peak minus heart rate one minute after the tick-off. */
export const RECOVERY_AFTER_SECONDS = 60;
/** If the next set comes sooner, it may already have run during this minute. */
export const RECOVERY_MIN_GAP_SECONDS = 120;
/** A median over fewer sets would just be a single value. */
export const MIN_SETS_FOR_MEDIAN = 3;

export interface StrengthHeartSummary {
  model_version: string;
  source: 'watch' | string;
  /** Phone time at which window 0 begins (= start of the session). */
  startTime: number;
  stepSeconds: number;
  averageBpm: number;
  maxBpm: number;
  minBpm: number;
  /** Share of windows with a value, 0–1. */
  coverage: number;
  samples: number;
  /** Watch and phone clocks aligned via pings; otherwise seconds may be missing. */
  clockAligned: boolean;
}

export interface StrengthHeart extends StrengthHeartSummary {
  values: (number | null)[];
}

const finite = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

/** Checks what comes over the bridge; unusable data becomes `undefined`. */
export function readStrengthHeart(raw: unknown): StrengthHeart | undefined {
  const value = raw as Partial<StrengthHeart> | null | undefined;
  if (
    !value ||
    !finite(value.startTime) ||
    !finite(value.stepSeconds) ||
    value.stepSeconds <= 0 ||
    !finite(value.averageBpm) ||
    !Array.isArray(value.values)
  ) {
    return undefined;
  }
  return {
    ...(value as StrengthHeart),
    values: value.values.map(entry => (finite(entry) ? entry : null)),
  };
}

export function readStrengthHeartSummaries(
  raw: unknown,
): Record<string, StrengthHeartSummary> {
  const sessions = (raw as { sessions?: Record<string, unknown> } | null)
    ?.sessions;
  const result: Record<string, StrengthHeartSummary> = {};
  if (!sessions || typeof sessions !== 'object') {
    return result;
  }
  for (const [id, entry] of Object.entries(sessions)) {
    const value = entry as Partial<StrengthHeartSummary> | null;
    if (value && finite(value.averageBpm) && finite(value.maxBpm)) {
      result[id] = value as StrengthHeartSummary;
    }
  }
  return result;
}

export interface HeartPoint {
  /** Seconds since start of the session, middle of the window. */
  t: number;
  bpm: number | null;
}

export function heartPoints(heart: StrengthHeart): HeartPoint[] {
  return heart.values.map((bpm, index) => ({
    t: (index + 0.5) * heart.stepSeconds,
    bpm,
  }));
}

/** Values of the windows that touch the period [from, to] (seconds since start). */
function windowValues(heart: StrengthHeart, from: number, to: number) {
  const step = heart.stepSeconds;
  const first = Math.max(0, Math.floor(from / step));
  const last = Math.min(heart.values.length - 1, Math.floor(to / step));
  const values: number[] = [];
  for (let index = first; index <= last; index += 1) {
    const value = heart.values[index];
    if (finite(value)) {
      values.push(value);
    }
  }
  return values;
}

export interface SetHeart {
  setId: string;
  exerciseIndex: number;
  completedAt: number;
  peakBpm?: number;
  /** Drop in the first rest minute, in beats; positive = fell. */
  recoveryBpm?: number;
}

export interface ExerciseHeart {
  exerciseIndex: number;
  exerciseId: string;
  name: string;
  /** Median of the set peak; only with values from at least one set. */
  peakBpm?: number;
  sets: number;
}

export interface SessionHeartInsight {
  model_version: typeof STRENGTH_HEART_INSIGHTS_VERSION;
  heartModel: string;
  sets: SetHeart[];
  /** Median of the set peak, from three sets with a value. */
  medianPeakBpm?: number;
  /** Median of the recovery, from three sets with a long enough rest. */
  medianRecoveryBpm?: number;
  recoverySets: number;
  byExercise: ExerciseHeart[];
}

/** Heart rate from the watch; imported heart rate (`import:<Source>`) comes as per-minute averages. */
export const isWatchHeart = (heart: StrengthHeartSummary): boolean =>
  !heart.source || heart.source === 'watch';

/** Where the heart rate comes from, as a word for display. */
export function heartSourceLabel(heart: StrengthHeartSummary): string {
  return isWatchHeart(heart)
    ? tr('Uhr', 'Watch')
    : sourceName(heart.source.replace(/^import:/, ''));
}

export function sessionHeartInsight(
  session: StrengthSession,
  heart: StrengthHeart,
): SessionHeartInsight {
  // Per-minute averages from imports carry no heart rate at the end of a set and no recovery.
  const completed = (isWatchHeart(heart) ? session.exercises : [])
    .flatMap((exercise, exerciseIndex) =>
      exercise.sets
        .filter(set => finite(set.completedAt) && !set.skipped)
        .map(set => ({
          setId: set.id,
          exerciseIndex,
          completedAt: set.completedAt as number,
        })),
    )
    .sort((a, b) => a.completedAt - b.completedAt);
  const sets: SetHeart[] = completed.map((set, index) => {
    const at = (set.completedAt - heart.startTime) / 1000;
    const around = windowValues(
      heart,
      at - SET_PEAK_BEFORE_SECONDS,
      at + SET_PEAK_AFTER_SECONDS,
    );
    const peakBpm = around.length ? Math.max(...around) : undefined;
    const next = completed[index + 1];
    const gap = next ? (next.completedAt - set.completedAt) / 1000 : Infinity;
    const later =
      peakBpm !== undefined && gap >= RECOVERY_MIN_GAP_SECONDS
        ? windowValues(
            heart,
            at + RECOVERY_AFTER_SECONDS - heart.stepSeconds / 2,
            at + RECOVERY_AFTER_SECONDS + heart.stepSeconds / 2,
          )
        : [];
    const after = later.length
      ? later.reduce((sum, value) => sum + value, 0) / later.length
      : undefined;
    return {
      ...set,
      peakBpm,
      recoveryBpm:
        peakBpm !== undefined && after !== undefined
          ? peakBpm - after
          : undefined,
    };
  });
  const peaks = sets
    .map(set => set.peakBpm)
    .filter((value): value is number => value !== undefined);
  const recoveries = sets
    .map(set => set.recoveryBpm)
    .filter((value): value is number => value !== undefined);
  const byExercise = session.exercises
    .map((exercise, exerciseIndex) => {
      const values = sets
        .filter(set => set.exerciseIndex === exerciseIndex)
        .map(set => set.peakBpm)
        .filter((value): value is number => value !== undefined);
      return {
        exerciseIndex,
        exerciseId: exercise.exerciseId,
        name: exercise.name,
        peakBpm: values.length ? median(values) : undefined,
        sets: values.length,
      };
    })
    .filter(entry => entry.sets > 0);
  return {
    model_version: STRENGTH_HEART_INSIGHTS_VERSION,
    heartModel: heart.model_version,
    sets,
    medianPeakBpm:
      peaks.length >= MIN_SETS_FOR_MEDIAN ? median(peaks) : undefined,
    medianRecoveryBpm:
      recoveries.length >= MIN_SETS_FOR_MEDIAN ? median(recoveries) : undefined,
    recoverySets: recoveries.length,
    byExercise,
  };
}
