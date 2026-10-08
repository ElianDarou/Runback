import type {
  LoggedSet,
  SessionExercise,
  StrengthSession,
} from '../../src/domain/strength';

/** Builds strength sessions for tests: compact, with sensible defaults. */
export const MINUTE = 60 * 1000;
export const DAY = 24 * 60 * MINUTE;

export interface SetSpec {
  weightKg?: number;
  reps?: number;
  seconds?: number;
  rir?: number;
  /** Minutes after the session start; without it the set is not ticked off. */
  at?: number;
  warmup?: boolean;
  skipped?: boolean;
  restSeconds?: number;
}

export function exercise(
  exerciseId: string,
  name: string,
  sets: SetSpec[],
  start: number,
): SessionExercise {
  return {
    exerciseId,
    name,
    sets: sets.map(
      (spec, index): LoggedSet => ({
        id: `${exerciseId}-${start}-${index}`,
        planned: {
          kind: spec.warmup ? 'warmup' : 'normal',
          loadKind: spec.weightKg ? 'kg' : 'bodyweight',
          reps: spec.reps,
          weightKg: spec.weightKg,
          restSeconds: spec.restSeconds ?? 120,
        },
        actualWeightKg: spec.at !== undefined ? spec.weightKg : undefined,
        actualReps: spec.at !== undefined ? spec.reps : undefined,
        actualSeconds: spec.at !== undefined ? spec.seconds : undefined,
        actualRir: spec.rir,
        completedAt:
          spec.at !== undefined && !spec.skipped
            ? start + spec.at * MINUTE
            : undefined,
        skipped: spec.skipped,
      }),
    ),
  };
}

export function strengthSession(
  id: string,
  start: number,
  exercises: [string, string, SetSpec[]][],
  overrides: Partial<StrengthSession> = {},
): StrengthSession {
  return {
    id,
    kind: 'strength',
    name: 'Oberkörper',
    startTime: start,
    endTime: start + 60 * MINUTE,
    status: 'finished',
    currentExercise: 0,
    modelVersion: 'strength-v1',
    catalogVersion: 'catalog-v2',
    exercises: exercises.map(([exerciseId, name, sets]) =>
      exercise(exerciseId, name, sets, start),
    ),
    ...overrides,
  };
}
