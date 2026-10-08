import type { MuscleShares } from './regions';
import { sharesAreValid } from './regions';
import { getLanguage, tr } from './i18n';

/**
 * Strength training: exercises, sets, sessions and templates.
 *
 * Pure functions without state. Anything that changes a session's course
 * returns a new session; the callers decide whether to save.
 *
 * Ground rule T-5: plan and actual value are kept apart and both are kept.
 * A deviation is recorded, but not judged.
 */
export const STRENGTH_MODEL_VERSION = 'strength-v1';
export const CATALOG_VERSION = 'catalog-v2';

export type SetKind = 'warmup' | 'normal' | 'failure' | 'dropset' | 'timed';
export type LoadKind =
  | 'kg'
  | 'bodyweight'
  | 'assisted'
  | 'bodyweight_plus'
  | 'unknown';
export type Equipment =
  | 'barbell'
  | 'dumbbell'
  | 'machine'
  | 'cable'
  | 'bodyweight'
  | 'band'
  | 'kettlebell'
  | 'ez_bar'
  | 'ball'
  | 'other'
  | 'unknown';

export interface Exercise {
  id: string;
  /** German name, stored with logged sets. Show it through `exerciseName`. */
  name: string;
  /** English name; falls back to `name` when missing. */
  en?: string;
  equipment: Equipment;
  /** Trains one side at a time; load then goes only to that side. */
  unilateral?: boolean;
  /** Eccentric and stretch factor for the load stimulus (freshness.ts). */
  eccentric?: number;
  shares: MuscleShares;
  /** `catalog` or `user`. Own exercises carry no catalog origin. */
  origin: 'catalog' | 'user';
  catalogVersion?: string;
  aliases?: string[];
  /** Database origin; muscle groups are not numeric model shares. */
  source?: { database: string; revision: string; id: string };
  muscleGroups?: string[];
}

/** Target of a set. Comes from the plan or the last session. */
export interface PlannedSet {
  kind: SetKind;
  loadKind: LoadKind;
  reps?: number;
  seconds?: number;
  weightKg?: number;
  restSeconds?: number;
}

/** A set during or after the session: target plus actual value. */
export interface LoggedSet {
  id: string;
  planned: PlannedSet;
  actualReps?: number;
  actualSeconds?: number;
  actualWeightKg?: number;
  /** Reported reps in reserve (RIR). User input, never estimated. */
  actualRir?: number;
  /** Imported actual set without a known tick-off time. */
  completed?: boolean;
  completedAt?: number;
  /** Skipped by the user. Not an error, just a note on follow-through. */
  skipped?: boolean;
}

export interface SessionExercise {
  exerciseId: string;
  name: string;
  sets: LoggedSet[];
  /** Added freely instead of taken from the plan. */
  added?: boolean;
}

export type SessionStatus = 'active' | 'finished' | 'interrupted';

export interface StrengthSession {
  id: string;
  kind: 'strength';
  name: string;
  templateId?: string;
  startTime: number;
  endTime?: number;
  status: SessionStatus;
  exercises: SessionExercise[];
  currentExercise: number;
  /** Running since this point, for the rest after a set. */
  restStartedAt?: number;
  restSeconds?: number;
  /** Rest paused since this point; the remaining time then stands still. */
  restPausedAt?: number;
  /** Already paused time of this rest in ms, without the ongoing pause. */
  restPausedMs?: number;
  note?: string;
  /**
   * Identifier of the saved state. The watch and notifications also change the
   * session without the app; a save therefore carries `baseRevision`, and the
   * phone only accepts it if it builds on the saved state.
   */
  revision?: string;
  baseRevision?: string;
  modelVersion: string;
  catalogVersion: string;
  importSource?: {
    workoutId: string;
    source: string;
    importVersion: string;
    incomplete: boolean;
    /** Strong reported this duration, but it fits no set count; the end is unknown. */
    rejectedDurationSeconds?: number;
  };
  /** End set by the user; `endTime` is then already the corrected one, the original is kept here. */
  endCorrection?: {
    endTime: number;
    originalEndTime?: number;
    setAt?: number;
    /** Ticked off after the set end; not counted, kept in the original. */
    excludedSetTimes?: number[];
  };
}

export const isSetCompleted = (set: LoggedSet): boolean =>
  set.completed === true || set.completedAt !== undefined;

export interface TemplateExercise {
  exerciseId: string;
  name: string;
  sets: PlannedSet[];
}

export interface WorkoutTemplate {
  id: string;
  name: string;
  /** Weekdays 0 (Sunday) to 6, as in `Date.getDay`. Empty means: no fixed day. */
  days: number[];
  exercises: TemplateExercise[];
  createdAt: number;
  importSource?: {
    modelVersion: string;
    importVersion: string;
    catalogVersion: string;
    workoutId: string;
    source: string;
    time: number;
    name: string;
  };
}

export interface StrengthState {
  templates: WorkoutTemplate[];
  active: StrengthSession | null;
  history: SessionSummary[];
}

export interface SessionSummary {
  id: string;
  name: string;
  startTime: number;
  endTime: number;
  completedSets: number;
  volumeKg: number;
}

const identifier = (prefix: string, seed: number, index: number, scope = 0) =>
  `${prefix}-${seed.toString(36)}-${scope}-${index}`;

export const emptyStrengthState = (): StrengthState => ({
  templates: [],
  active: null,
  history: [],
});

/**
 * Visible name of a session. Default names are stored as text: German values
 * come from older data and the watch, English values from sessions started
 * in English. Both map to the active language on display; any other name is
 * one the user typed and stays as it is. Stored data is never rewritten.
 */
export function displaySessionName(name: string): string {
  switch (name) {
    case 'Krafttraining':
    case 'Strength training':
      return tr('Krafttraining', 'Strength training');
    case 'Freies Training':
    case 'Free training':
      return tr('Freies Training', 'Free training');
    default:
      return name;
  }
}

/**
 * Starts a session from a template. Without a template an empty session is
 * created, to which exercises are added one by one.
 */
export function startSession(
  template: WorkoutTemplate | null,
  now: number,
  name = tr('Freies Training', 'Free training'),
): StrengthSession {
  const exercises = (template?.exercises || []).map(
    (exercise, exerciseIndex) => ({
      exerciseId: exercise.exerciseId,
      name: exercise.name,
      sets: exercise.sets.map((planned, index) => ({
        id: identifier(exercise.exerciseId, now, index, exerciseIndex),
        planned: { ...planned },
      })),
    }),
  );
  return {
    id: `session-${now.toString(36)}`,
    kind: 'strength',
    name: template?.name || name,
    templateId: template?.id,
    startTime: now,
    status: 'active',
    exercises,
    currentExercise: 0,
    modelVersion: STRENGTH_MODEL_VERSION,
    catalogVersion: CATALOG_VERSION,
  };
}

const NO_REST = {
  restStartedAt: undefined,
  restSeconds: undefined,
  restPausedAt: undefined,
  restPausedMs: undefined,
} as const;

const replaceExercise = (
  session: StrengthSession,
  index: number,
  next: SessionExercise,
): StrengthSession => ({
  ...session,
  exercises: session.exercises.map((exercise, i) =>
    i === index ? next : exercise,
  ),
});

const replaceSet = (
  exercise: SessionExercise,
  setId: string,
  next: LoggedSet,
): SessionExercise => ({
  ...exercise,
  sets: exercise.sets.map(set => (set.id === setId ? next : set)),
});

export function selectExercise(
  session: StrengthSession,
  index: number,
): StrengthSession {
  if (!session.exercises.length) {
    return session;
  }
  const clamped = Math.min(Math.max(index, 0), session.exercises.length - 1);
  return clamped === session.currentExercise
    ? session
    : { ...session, currentExercise: clamped };
}

/** Enters changed values without completing the set. */
export function editSet(
  session: StrengthSession,
  exerciseIndex: number,
  setId: string,
  values: Pick<
    LoggedSet,
    'actualReps' | 'actualWeightKg' | 'actualSeconds' | 'actualRir'
  >,
): StrengthSession {
  const exercise = session.exercises[exerciseIndex];
  const set = exercise?.sets.find(candidate => candidate.id === setId);
  if (!exercise || !set) {
    return session;
  }
  return replaceExercise(
    session,
    exerciseIndex,
    replaceSet(exercise, setId, { ...set, ...values }),
  );
}

/**
 * Completes a set. Values not given take over the target, so that confirming
 * stays possible with one action (T-4).
 */
export function completeSet(
  session: StrengthSession,
  exerciseIndex: number,
  setId: string,
  now: number,
  values: Pick<
    LoggedSet,
    'actualReps' | 'actualWeightKg' | 'actualSeconds' | 'actualRir'
  > = {},
): StrengthSession {
  const exercise = session.exercises[exerciseIndex];
  const set = exercise?.sets.find(candidate => candidate.id === setId);
  if (!exercise || !set) {
    return session;
  }
  if (isSetCompleted(set)) {
    // Tapping again takes the completion back; the values stay.
    const reopened = replaceSet(exercise, setId, {
      ...set,
      completedAt: undefined,
      completed: undefined,
    });
    return {
      ...replaceExercise(session, exerciseIndex, reopened),
      ...NO_REST,
    };
  }
  const completed: LoggedSet = {
    ...set,
    ...values,
    actualReps: values.actualReps ?? set.actualReps ?? set.planned.reps,
    actualWeightKg:
      values.actualWeightKg ?? set.actualWeightKg ?? set.planned.weightKg,
    actualSeconds:
      values.actualSeconds ?? set.actualSeconds ?? set.planned.seconds,
    completedAt: now,
    skipped: false,
  };
  const rest = set.planned.restSeconds;
  return {
    ...replaceExercise(
      session,
      exerciseIndex,
      replaceSet(exercise, setId, completed),
    ),
    ...NO_REST,
    restStartedAt: rest !== undefined && rest > 0 ? now : undefined,
    restSeconds: rest !== undefined && rest > 0 ? rest : undefined,
  };
}

/**
 * Confirms or reopens a set as the tap meant it (`wasDone`). If the watch has
 * ticked it off in the meantime, completion and rest stay and only the values
 * are added; nothing is taken back by accident.
 */
export function confirmSet(
  session: StrengthSession,
  exerciseIndex: number,
  setId: string,
  wasDone: boolean,
  now: number,
  values: Pick<
    LoggedSet,
    'actualReps' | 'actualWeightKg' | 'actualSeconds' | 'actualRir'
  > = {},
): StrengthSession {
  const set = session.exercises[exerciseIndex]?.sets.find(
    candidate => candidate.id === setId,
  );
  if (!set) return session;
  if (isSetCompleted(set) === wasDone) {
    return completeSet(session, exerciseIndex, setId, now, values);
  }
  return wasDone ? session : editSet(session, exerciseIndex, setId, values);
}

export function skipSet(
  session: StrengthSession,
  exerciseIndex: number,
  setId: string,
): StrengthSession {
  const exercise = session.exercises[exerciseIndex];
  const set = exercise?.sets.find(candidate => candidate.id === setId);
  if (!exercise || !set) {
    return session;
  }
  return replaceExercise(
    session,
    exerciseIndex,
    replaceSet(exercise, setId, {
      ...set,
      skipped: !set.skipped,
      completed: undefined,
      completedAt: undefined,
    }),
  );
}

/** New state based on `base`; see `StrengthSession.revision`. */
export function revise(
  base: StrengthSession,
  next: StrengthSession,
  random: () => number = Math.random,
): StrengthSession {
  const rest = { ...next };
  delete rest.baseRevision;
  return {
    ...rest,
    revision: `${Date.now().toString(36)}-${random().toString(36).slice(2, 8)}`,
    ...(base.revision ? { baseRevision: base.revision } : {}),
  };
}

/** Rest after a set, unless the user has set something else. */
export const DEFAULT_REST_SECONDS = 120;

/** Appends a set, pre-filled from the last set of the same exercise. */
export function addSet(
  session: StrengthSession,
  exerciseIndex: number,
  now: number,
  defaultRestSeconds = DEFAULT_REST_SECONDS,
): StrengthSession {
  const exercise = session.exercises[exerciseIndex];
  if (!exercise) {
    return session;
  }
  const last = exercise.sets[exercise.sets.length - 1];
  const planned: PlannedSet = last
    ? {
        ...last.planned,
        reps: last.actualReps ?? last.planned.reps,
        weightKg: last.actualWeightKg ?? last.planned.weightKg,
        seconds: last.actualSeconds ?? last.planned.seconds,
      }
    : {
        kind: 'normal',
        loadKind: 'kg',
        reps: 8,
        restSeconds: defaultRestSeconds,
      };
  return replaceExercise(session, exerciseIndex, {
    ...exercise,
    sets: [
      ...exercise.sets,
      {
        id: identifier(exercise.exerciseId, now, exercise.sets.length),
        planned,
      },
    ],
  });
}

export function removeSet(
  session: StrengthSession,
  exerciseIndex: number,
  setId: string,
): StrengthSession {
  const exercise = session.exercises[exerciseIndex];
  const removed = exercise?.sets.find(set => set.id === setId);
  if (!exercise || !removed || exercise.sets.length <= 1) {
    return session;
  }
  const next = replaceExercise(session, exerciseIndex, {
    ...exercise,
    sets: exercise.sets.filter(set => set.id !== setId),
  });
  // The rest belongs to the deleted set; without it there is nothing to wait for.
  return removed.completedAt !== undefined &&
    removed.completedAt === session.restStartedAt
    ? clearRest(next)
    : next;
}

/** Puts a deleted set back unchanged in its old place. */
export function restoreSet(
  session: StrengthSession,
  exerciseIndex: number,
  set: LoggedSet,
  position: number,
): StrengthSession {
  const exercise = session.exercises[exerciseIndex];
  if (!exercise || exercise.sets.some(candidate => candidate.id === set.id)) {
    return session;
  }
  const at = Math.min(Math.max(position, 0), exercise.sets.length);
  return replaceExercise(session, exerciseIndex, {
    ...exercise,
    sets: [...exercise.sets.slice(0, at), set, ...exercise.sets.slice(at)],
  });
}

/** Adds an exercise spontaneously. It is marked as added freely. */
export function addExercise(
  session: StrengthSession,
  exercise: Exercise,
  now: number,
  sets = 3,
  defaultRestSeconds = DEFAULT_REST_SECONDS,
): StrengthSession {
  const planned: PlannedSet = {
    kind: 'normal',
    loadKind: exercise.equipment === 'bodyweight' ? 'bodyweight' : 'kg',
    reps: 8,
    restSeconds: defaultRestSeconds,
  };
  const next: SessionExercise = {
    exerciseId: exercise.id,
    name: exercise.name,
    added: true,
    sets: Array.from({ length: Math.max(1, sets) }, (_, index) => ({
      id: identifier(exercise.id, now, index, session.exercises.length),
      planned: { ...planned },
    })),
  };
  return {
    ...session,
    exercises: [...session.exercises, next],
    currentExercise: session.exercises.length,
  };
}

export interface ExerciseProgress {
  completed: number;
  total: number;
  done: boolean;
  /** First set that is still open. For pre-filling the input. */
  activeSetId?: string;
}

export function exerciseProgress(exercise: SessionExercise): ExerciseProgress {
  const relevant = exercise.sets.filter(set => !set.skipped);
  const completed = relevant.filter(isSetCompleted).length;
  return {
    completed,
    total: relevant.length,
    done: relevant.length > 0 && completed === relevant.length,
    activeSetId: exercise.sets.find(set => !isSetCompleted(set) && !set.skipped)
      ?.id,
  };
}

export function sessionProgress(session: StrengthSession): {
  completedSets: number;
  totalSets: number;
  volumeKg: number;
} {
  let completedSets = 0;
  let totalSets = 0;
  let volumeKg = 0;
  for (const exercise of session.exercises) {
    for (const set of exercise.sets) {
      if (set.skipped) {
        continue;
      }
      totalSets += 1;
      if (!isSetCompleted(set)) {
        continue;
      }
      completedSets += 1;
      if (set.actualWeightKg && set.actualReps) {
        volumeKg += set.actualWeightKg * set.actualReps;
      }
    }
  }
  return { completedSets, totalSets, volumeKg };
}

/**
 * Remaining rest seconds, or null if no rest is running. A paused rest keeps
 * its remaining time until it resumes.
 */
export function restRemaining(
  session: StrengthSession,
  now: number,
): number | null {
  if (session.restStartedAt === undefined || !session.restSeconds) {
    return null;
  }
  const until = session.restPausedAt ?? now;
  const elapsed = Math.floor(
    (until - session.restStartedAt - (session.restPausedMs ?? 0)) / 1000,
  );
  const remaining = session.restSeconds - elapsed;
  return remaining > 0 ? remaining : null;
}

/** Time at which the running rest ends; null if paused or without a rest. */
export function restEndsAt(session: StrengthSession): number | null {
  if (
    session.restStartedAt === undefined ||
    !session.restSeconds ||
    session.restPausedAt !== undefined
  ) {
    return null;
  }
  return (
    session.restStartedAt +
    session.restSeconds * 1000 +
    (session.restPausedMs ?? 0)
  );
}

/** Pauses the running rest. Without a running rest nothing changes. */
export function pauseRest(
  session: StrengthSession,
  now: number,
): StrengthSession {
  if (
    session.restPausedAt !== undefined ||
    restRemaining(session, now) === null
  ) {
    return session;
  }
  return { ...session, restPausedAt: now };
}

/** Lets a paused rest run on with its remaining time. */
export function resumeRest(
  session: StrengthSession,
  now: number,
): StrengthSession {
  if (session.restPausedAt === undefined) {
    return session;
  }
  return {
    ...session,
    restPausedAt: undefined,
    restPausedMs:
      (session.restPausedMs ?? 0) + Math.max(0, now - session.restPausedAt),
  };
}

/** Ends the rest immediately, for example when skipping. */
export function clearRest(session: StrengthSession): StrengthSession {
  return session.restStartedAt === undefined &&
    session.restPausedAt === undefined
    ? session
    : { ...session, ...NO_REST };
}

/**
 * The last comparable completed set from the history. `history` is searched in
 * the order given; callers sort the newest session first.
 */
export function referenceSet(
  history: StrengthSession[],
  exerciseId: string,
  setIndex: number,
): LoggedSet | null {
  for (const session of history) {
    const exercise = session.exercises.find(
      candidate => candidate.exerciseId === exerciseId,
    );
    const set = exercise?.sets.filter(
      candidate => isSetCompleted(candidate),
    )[setIndex];
    if (set && (set.actualWeightKg || set.actualReps || set.actualSeconds)) {
      return set;
    }
  }
  return null;
}

/**
 * Short form of the last comparable performance, e.g. `80 kg × 8`.
 * From the history, so training shows what it builds on.
 */
export function referenceLabel(
  history: StrengthSession[],
  exerciseId: string,
  setIndex: number,
): string | null {
  const set = referenceSet(history, exerciseId, setIndex);
  if (!set) {
    return null;
  }
  if (set.actualWeightKg && set.actualReps) {
    return `${formatWeight(set.actualWeightKg)} kg × ${set.actualReps}`;
  }
  if (set.actualReps) {
    return tr(
      `${set.actualReps} Wdh.`,
      `${set.actualReps} ${set.actualReps === 1 ? 'rep' : 'reps'}`,
    );
  }
  if (set.actualSeconds) {
    return `${set.actualSeconds} s`;
  }
  return null;
}

export function formatWeight(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  return getLanguage() === 'de'
    ? String(rounded).replace('.', ',')
    : String(rounded);
}

/**
 * Up to here Epley is checked against measured 1RM (LeSuer 1997, Reynolds
 * 2006); above it endurance dominates, and the estimate scatters too much to
 * enter a trend unweighted.
 */
export const MAX_REPS_FOR_E1RM = 12;

/**
 * Estimated one-rep max after Epley.
 * An estimate, not a measurement. Only for working sets with load and up to
 * twelve reps; longer sets yield no value instead of a rough one.
 */
export function epley1RM(weightKg: number, reps: number): number | null {
  if (!(weightKg > 0) || !(reps > 0) || reps > MAX_REPS_FOR_E1RM) {
    return null;
  }
  return weightKg * (1 + reps / 30);
}

/** Best estimated value of a session for an exercise. */
export function sessionBest1RM(
  session: StrengthSession,
  exerciseId: string,
): number | null {
  const exercise = session.exercises.find(
    candidate => candidate.exerciseId === exerciseId,
  );
  if (!exercise) {
    return null;
  }
  let best: number | null = null;
  for (const set of exercise.sets) {
    if (!isSetCompleted(set) || set.planned.kind === 'warmup') {
      continue;
    }
    const estimate = epley1RM(set.actualWeightKg || 0, set.actualReps || 0);
    if (estimate !== null && (best === null || estimate > best)) {
      best = estimate;
    }
  }
  return best;
}

export function finishSession(
  session: StrengthSession,
  now: number,
): StrengthSession {
  return {
    ...clearRest(session),
    status: 'finished',
    endTime: now,
  };
}

export function summarize(session: StrengthSession): SessionSummary {
  const { completedSets, volumeKg } = sessionProgress(session);
  return {
    id: session.id,
    name: session.name,
    startTime: session.startTime,
    endTime: session.endTime || session.startTime,
    completedSets,
    volumeKg,
  };
}

/** Template due today. Null without a match; that is not an error. */
export function templateForDay(
  templates: WorkoutTemplate[],
  day: number,
): WorkoutTemplate | null {
  return templates.find(template => template.days.includes(day)) || null;
}

export function exerciseIsUsable(exercise: Exercise): boolean {
  return (
    sharesAreValid(exercise.shares) &&
    exercise.eccentric !== undefined &&
    exercise.eccentric > 0
  );
}
