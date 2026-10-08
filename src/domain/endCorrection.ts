import type { RunSeries } from './runSeries';
import type { StrengthSession } from './strength';
import type { StrengthHeart } from './strengthHeart';

/**
 * Set the end after the fact, for runs and strength sessions: whoever forgot to
 * stop picks in the history when it really ended. The correction sits next to
 * the original (Kotlin: `trim_<id>`, `strength_end_<id>`); the original is kept
 * and can be restored.
 *
 * Suggestions are only a preview until the user accepts them: for a run the end
 * of the last movement, for a recorded strength session the last ticked set.
 * Without such traces there is no suggestion.
 */
export const END_CORRECTION_VERSION = 'end-correction-v1';
export const END_SUGGESTION_VERSION = 'end-suggestion-v1';
/** A suggestion is only worth it if it ends at least two minutes earlier. */
export const MIN_SUGGESTION_GAP_SECONDS = 120;
/** Shorter than a minute would no longer be a workout. */
export const MIN_DURATION_SECONDS = 60;

export interface EndCorrection {
  endTime: number;
  setAt?: number;
}

export interface EndSuggestion {
  time: number;
  reason: 'last_set' | 'last_movement';
  version: typeof END_SUGGESTION_VERSION;
}

const finite = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

export function readEndCorrection(raw: unknown): EndCorrection | undefined {
  const value = raw as Partial<EndCorrection> | null | undefined;
  return value && finite(value.endTime) && value.endTime > 0
    ? {
        endTime: value.endTime,
        setAt: finite(value.setAt) ? value.setAt : undefined,
      }
    : undefined;
}

/**
 * Strength session with the corrected end; unchanged without a valid correction.
 * Sets ticked only after the chosen end no longer count, as with a run; they
 * remain in the saved original.
 */
export function applyStrengthEndCorrection(
  session: StrengthSession,
  raw: unknown,
): StrengthSession {
  const correction = readEndCorrection(raw);
  if (!correction || correction.endTime <= session.startTime) return session;
  const excludedSetTimes = (session.exercises || [])
    .flatMap(exercise => exercise.sets)
    .map(set => set.completedAt)
    .filter((at): at is number => finite(at) && at > correction.endTime);
  const exercises = (session.exercises || [])
    .map(exercise => ({
      ...exercise,
      sets: exercise.sets.filter(
        set =>
          !finite(set.completedAt) || set.completedAt <= correction.endTime,
      ),
    }))
    .filter(exercise => exercise.sets.length > 0);
  return {
    ...session,
    exercises,
    currentExercise: Math.min(
      session.currentExercise ?? 0,
      Math.max(0, exercises.length - 1),
    ),
    endTime: correction.endTime,
    endCorrection: {
      endTime: correction.endTime,
      originalEndTime: session.endTime,
      setAt: correction.setAt,
      ...(excludedSetTimes.length ? { excludedSetTimes } : {}),
    },
  };
}

/** Tick times of all sets, including those after a set end. */
export function strengthSetTimes(session: StrengthSession): number[] {
  const times = (session.exercises || [])
    .flatMap(exercise => exercise.sets || [])
    .filter(set => !set.skipped && finite(set.completedAt))
    .map(set => set.completedAt as number);
  return [...times, ...(session.endCorrection?.excludedSetTimes ?? [])];
}

/** Last ticked set of a recorded session. Imports have no set times. */
export function strengthEndSuggestion(
  session: StrengthSession,
  currentEnd: number | undefined,
): EndSuggestion | undefined {
  let last: number | undefined;
  for (const time of strengthSetTimes(session))
    if (time > session.startTime)
      last = last === undefined ? time : Math.max(last, time);
  if (last === undefined) return undefined;
  if (
    currentEnd !== undefined &&
    last > currentEnd - MIN_SUGGESTION_GAP_SECONDS * 1000
  )
    return undefined;
  return { time: last, reason: 'last_set', version: END_SUGGESTION_VERSION };
}

/** End of the last movement in the uncorrected history of a run. */
export function runEndSuggestion(
  startTime: number,
  series: RunSeries | null | undefined,
  originalEnd: number,
): EndSuggestion | undefined {
  if (!series || !finite(series.stepSeconds)) return undefined;
  let last: number | undefined;
  for (const row of series.rows)
    if (row.moving) last = row.elapsedSeconds + series.stepSeconds;
  if (last === undefined) return undefined;
  const time = Math.min(originalEnd, startTime + last * 1000);
  if (time > originalEnd - MIN_SUGGESTION_GAP_SECONDS * 1000) return undefined;
  return { time, reason: 'last_movement', version: END_SUGGESTION_VERSION };
}

/**
 * Keeps a chosen end between "one minute after the start" and the end of the
 * time range, rounded to whole seconds. If the range is shorter than a minute,
 * its end applies.
 */
export function clampEnd(
  time: number,
  startTime: number,
  rangeEnd: number,
): number {
  const min = Math.min(startTime + MIN_DURATION_SECONDS * 1000, rangeEnd);
  const rounded = Math.round(time / 1000) * 1000;
  return Math.max(min, Math.min(rangeEnd, rounded));
}

export interface TrackPoint {
  /** Time in ms. */
  t: number;
  value: number | null;
}

/** Heart rate of a strength session as times at the window center. */
export function heartTrack(heart: StrengthHeart | undefined): TrackPoint[] {
  if (!heart) return [];
  return heart.values.map((bpm, index) => ({
    t: heart.startTime + (index + 0.5) * heart.stepSeconds * 1000,
    value: bpm,
  }));
}

/** Speed in km/h (only while moving) and heart rate from the run history. */
export function runTracks(
  startTime: number,
  series: RunSeries | null | undefined,
): { speed: TrackPoint[]; heart: TrackPoint[] } {
  if (!series) return { speed: [], heart: [] };
  const at = (elapsed: number) =>
    startTime + (elapsed + series.stepSeconds / 2) * 1000;
  return {
    speed: series.rows.map(row => ({
      t: at(row.elapsedSeconds),
      // Standing still and unknown stay gaps: where the line stops, the movement ended.
      value:
        row.moving && row.speedMps !== undefined && row.speedMps > 0
          ? Math.round(row.speedMps * 36) / 10
          : null,
    })),
    heart: series.rows.map(row => ({
      t: at(row.elapsedSeconds),
      value: row.heartRate ?? null,
    })),
  };
}
