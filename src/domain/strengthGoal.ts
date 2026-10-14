import { isWorkingSet } from './muscleGroups';
import type { StrengthSession } from './strength';

/**
 * How close the strength goal is: a target load for an exercise at a number
 * of reps, e.g. 100 kg squat × 5. Measured, not estimated: the heaviest
 * working set of that exercise with at least the target reps in the recent
 * weeks, against the target load. No one-rep-max estimate, no forecast.
 */
export const STRENGTH_GOAL_VERSION = 'strength-goal-v1';
/** Only recent sets say how close the goal is now. */
export const STRENGTH_GOAL_WINDOW_DAYS = 84;

export interface StrengthTarget {
  exerciseId: string;
  /** Stored exercise name, shown through `exerciseDisplayName`. */
  name: string;
  kg: number;
  reps: number;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export function normalizeStrengthTarget(
  raw: unknown,
): StrengthTarget | undefined {
  if (!isRecord(raw)) return undefined;
  const { exerciseId, name, kg, reps } = raw;
  if (typeof exerciseId !== 'string' || !exerciseId.trim()) return undefined;
  if (typeof kg !== 'number' || !Number.isFinite(kg) || kg <= 0 || kg > 1000)
    return undefined;
  if (
    typeof reps !== 'number' ||
    !Number.isInteger(reps) ||
    reps < 1 ||
    reps > 100
  )
    return undefined;
  return {
    exerciseId: exerciseId.trim(),
    name: typeof name === 'string' && name.trim() ? name.trim() : exerciseId,
    kg,
    reps,
  };
}

export interface StrengthGoalProgress {
  version: typeof STRENGTH_GOAL_VERSION;
  /** `none`: no working set of the exercise with enough reps in the window. */
  status: 'none' | 'observed';
  /** Heaviest qualifying set in the window. */
  best?: { kg: number; reps: number; at: number; sessionId: string };
  /** Best load against the target load, 0 to 1. */
  share?: number;
  reached: boolean;
  /** Working sets of the exercise in the window, with any reps. */
  sets: number;
}

export function strengthGoalProgress(
  target: StrengthTarget,
  sessions: StrengthSession[],
  now: number,
): StrengthGoalProgress {
  const from = now - STRENGTH_GOAL_WINDOW_DAYS * 86400000;
  let best: StrengthGoalProgress['best'];
  let sets = 0;
  sessions.forEach(session => {
    if (session.startTime < from || session.startTime > now) return;
    session.exercises.forEach(exercise => {
      if (exercise.exerciseId !== target.exerciseId) return;
      exercise.sets.forEach(set => {
        if (!isWorkingSet(set)) return;
        sets += 1;
        const kg = set.actualWeightKg;
        const reps = set.actualReps;
        if (
          typeof kg !== 'number' ||
          !Number.isFinite(kg) ||
          kg <= 0 ||
          typeof reps !== 'number' ||
          reps < target.reps
        )
          return;
        if (!best || kg > best.kg)
          best = {
            kg,
            reps,
            at: set.completedAt ?? session.startTime,
            sessionId: session.id,
          };
      });
    });
  });
  if (!best)
    return {
      version: STRENGTH_GOAL_VERSION,
      status: 'none',
      reached: false,
      sets,
    };
  return {
    version: STRENGTH_GOAL_VERSION,
    status: 'observed',
    best,
    share: Math.min(1, best.kg / target.kg),
    reached: best.kg >= target.kg,
    sets,
  };
}
