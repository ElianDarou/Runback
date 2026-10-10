import { fixed, tr } from './i18n';
import {
  normalizeRunAnnouncements,
  type RunAnnouncements,
} from './runAnnouncements';

/**
 * Version 3 splits the run goal into two independent choices: how far
 * (`goal`: open, distance, or time) and what to run by (`kind`: just track,
 * pace, heart rate, or intervals). The pace mode is now chosen explicitly
 * instead of following the run type. Versions 1 and 2 stay readable: they have
 * no goal and their stored pace mode is kept.
 */
export const RUN_TARGET_VERSION = 3 as const;
type StoredVersion = 1 | 2 | typeof RUN_TARGET_VERSION;

export type RunTargetOutput = 'voice' | 'vibration' | 'both';

/** How far: a distance or a duration. Missing means open. */
export type RunGoal =
  | { kind: 'distance'; meters: number }
  | { kind: 'time'; seconds: number };

/** One work stretch of an interval session, by time or by distance. */
export type IntervalWork =
  | { kind: 'time'; seconds: number }
  | { kind: 'distance'; meters: number };

/**
 * Interval session: optional warm-up, then `repeats` work stretches with a
 * rest between them (none after the last). Intervals set their own volume, so
 * they never carry a `goal`.
 */
export interface IntervalPlan {
  repeats: number;
  work: IntervalWork;
  restSeconds: number;
  warmupSeconds: number;
}

export type RunTarget = {
  cueIntervalSeconds?: number;
  announcements?: RunAnnouncements;
  goal?: RunGoal;
  /** Halfway, almost there, and reached for the goal. Missing means on. */
  goalCues?: boolean;
} & (
  | { kind: 'none'; version: StoredVersion; output?: RunTargetOutput }
  | {
      kind: 'pace';
      version: StoredVersion;
      secondsPerKm: number;
      /** `ceiling`: only speaks up when faster. `range`: both directions. */
      mode: 'ceiling' | 'range';
      output: RunTargetOutput;
    }
  | {
      kind: 'heart_rate';
      version: StoredVersion;
      minBpm: number;
      maxBpm: number;
      output: RunTargetOutput;
    }
  | {
      kind: 'intervals';
      version: StoredVersion;
      intervals: IntervalPlan;
      output: RunTargetOutput;
    }
);

export type RunTargetKind = RunTarget['kind'];
export type RunGoalKind = 'open' | RunGoal['kind'];

export const NO_RUN_TARGET: RunTarget = {
  kind: 'none',
  version: RUN_TARGET_VERSION,
};

/** Bounds shared with Kotlin (RunTargetGuidance, RunGoalCues, RunIntervals). */
export const GOAL_METERS = { min: 100, max: 100_000 } as const;
export const GOAL_SECONDS = { min: 60, max: 600 * 60 } as const;
export const INTERVAL_LIMITS = {
  repeats: { min: 1, max: 50 },
  workSeconds: { min: 10, max: 30 * 60 },
  workMeters: { min: 100, max: 10_000 },
  restSeconds: { min: 0, max: 10 * 60 },
  warmupSeconds: { min: 0, max: 60 * 60 },
} as const;

/** Starting values when a kind is picked for the first time. */
export const DEFAULT_GOAL_METERS = 5000;
export const DEFAULT_GOAL_SECONDS = 30 * 60;
export const DEFAULT_PACE_SECONDS = 330;
export const DEFAULT_HEART_RATE = { minBpm: 130, maxBpm: 150 } as const;
export const DEFAULT_INTERVALS: IntervalPlan = {
  repeats: 6,
  work: { kind: 'distance', meters: 400 },
  restSeconds: 90,
  warmupSeconds: 0,
};

const validOutput = (value: unknown): value is RunTargetOutput =>
  value === 'voice' || value === 'vibration' || value === 'both';

const integerIn = (value: unknown, min: number, max: number): value is number =>
  typeof value === 'number' &&
  Number.isInteger(value) &&
  value >= min &&
  value <= max;

export function normalizeRunGoal(value: unknown): RunGoal | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const raw = value as Record<string, unknown>;
  if (
    raw.kind === 'distance' &&
    integerIn(raw.meters, GOAL_METERS.min, GOAL_METERS.max)
  )
    return { kind: 'distance', meters: raw.meters };
  if (
    raw.kind === 'time' &&
    integerIn(raw.seconds, GOAL_SECONDS.min, GOAL_SECONDS.max)
  )
    return { kind: 'time', seconds: raw.seconds };
  return undefined;
}

export function normalizeIntervalPlan(
  value: unknown,
): IntervalPlan | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const raw = value as Record<string, unknown>;
  const work = raw.work as Record<string, unknown> | undefined;
  const limits = INTERVAL_LIMITS;
  const workValid =
    !!work &&
    ((work.kind === 'time' &&
      integerIn(
        work.seconds,
        limits.workSeconds.min,
        limits.workSeconds.max,
      )) ||
      (work.kind === 'distance' &&
        integerIn(work.meters, limits.workMeters.min, limits.workMeters.max)));
  if (
    !workValid ||
    !integerIn(raw.repeats, limits.repeats.min, limits.repeats.max) ||
    !integerIn(
      raw.restSeconds,
      limits.restSeconds.min,
      limits.restSeconds.max,
    ) ||
    !integerIn(
      raw.warmupSeconds ?? 0,
      limits.warmupSeconds.min,
      limits.warmupSeconds.max,
    )
  )
    return undefined;
  return {
    repeats: raw.repeats as number,
    work:
      work!.kind === 'time'
        ? { kind: 'time', seconds: work!.seconds as number }
        : { kind: 'distance', meters: work!.meters as number },
    restSeconds: raw.restSeconds as number,
    warmupSeconds: (raw.warmupSeconds as number | undefined) ?? 0,
  };
}

/** Old or incomplete settings never silently switch cues on. */
export function normalizeRunTarget(value: unknown): RunTarget {
  if (!value || typeof value !== 'object') return NO_RUN_TARGET;
  const raw = value as Record<string, unknown>;
  if (
    raw.version !== 1 &&
    raw.version !== 2 &&
    raw.version !== RUN_TARGET_VERSION
  )
    return NO_RUN_TARGET;
  const version = raw.version as StoredVersion;
  const cueIntervalSeconds = raw.cueIntervalSeconds ?? 30;
  if (!integerIn(cueIntervalSeconds, 5, 300)) return NO_RUN_TARGET;
  // Goals exist only from version 3; an older record never gains one.
  const goal =
    version === RUN_TARGET_VERSION ? normalizeRunGoal(raw.goal) : undefined;
  const extra = {
    cueIntervalSeconds,
    ...(raw.announcements === undefined
      ? {}
      : { announcements: normalizeRunAnnouncements(raw.announcements) }),
    ...(goal && raw.kind !== 'intervals' ? { goal } : {}),
    ...(goal && raw.goalCues === false ? { goalCues: false } : {}),
  };
  if (raw.kind === 'none')
    return {
      ...extra,
      kind: 'none',
      version,
      ...(validOutput(raw.output) ? { output: raw.output } : {}),
    };
  if (!validOutput(raw.output)) return NO_RUN_TARGET;
  if (raw.kind === 'pace') {
    const secondsPerKm = Number(raw.secondsPerKm);
    if (
      Number.isFinite(secondsPerKm) &&
      secondsPerKm >= 120 &&
      secondsPerKm <= 1200 &&
      (raw.mode === 'ceiling' || raw.mode === 'range')
    ) {
      return {
        ...extra,
        kind: 'pace',
        version,
        secondsPerKm,
        mode: raw.mode,
        output: raw.output,
      };
    }
  }
  if (raw.kind === 'heart_rate') {
    const minBpm = Number(raw.minBpm);
    const maxBpm = Number(raw.maxBpm);
    if (
      Number.isFinite(minBpm) &&
      Number.isFinite(maxBpm) &&
      minBpm >= 40 &&
      maxBpm <= 240 &&
      maxBpm - minBpm >= 5
    ) {
      return {
        ...extra,
        kind: 'heart_rate',
        version,
        minBpm,
        maxBpm,
        output: raw.output,
      };
    }
  }
  if (raw.kind === 'intervals' && version === RUN_TARGET_VERSION) {
    const intervals = normalizeIntervalPlan(raw.intervals);
    if (intervals) {
      return {
        ...extra,
        kind: 'intervals',
        version,
        intervals,
        output: raw.output,
      };
    }
  }
  return NO_RUN_TARGET;
}

/** Output for goal and interval cues; "just track" without a choice uses both. */
export function targetOutput(target: RunTarget): RunTargetOutput {
  return target.output ?? 'both';
}

export function parsePaceInput(value: string): number | null {
  const match = value.trim().match(/^(\d{1,2}):([0-5]\d)$/);
  if (!match) return null;
  const seconds = Number(match[1]) * 60 + Number(match[2]);
  return seconds >= 120 && seconds <= 1200 ? seconds : null;
}

/** "25:00" or "1:45:00" as seconds; anything else is `null`. */
export function parseDurationInput(value: string): number | null {
  const match = value.trim().match(/^(?:(\d{1,2}):)?(\d{1,3}):([0-5]\d)$/);
  if (!match) return null;
  const hours = Number(match[1] ?? 0);
  const minutes = Number(match[2]);
  if (match[1] !== undefined && minutes > 59) return null;
  const seconds = hours * 3600 + minutes * 60 + Number(match[3]);
  return seconds > 0 ? seconds : null;
}

/** Kilometers as typed ("5", "10,5") in meters, or `null` outside the bounds. */
export function parseGoalKilometers(value: string): number | null {
  const km = Number(value.trim().replace(',', '.'));
  if (!Number.isFinite(km)) return null;
  const meters = Math.round(km * 1000);
  return meters >= GOAL_METERS.min && meters <= GOAL_METERS.max ? meters : null;
}

/** Whole minutes as typed, in seconds, or `null` outside the bounds. */
export function parseGoalMinutes(value: string): number | null {
  const minutes = Number(value.trim());
  if (!Number.isInteger(minutes)) return null;
  const seconds = minutes * 60;
  return seconds >= GOAL_SECONDS.min && seconds <= GOAL_SECONDS.max
    ? seconds
    : null;
}

/** Target pace from a finish time over the goal distance; `null` if it leaves the pace range. */
export function paceForFinishTime(
  meters: number,
  seconds: number,
): number | null {
  if (!(meters > 0) || !(seconds > 0)) return null;
  const pace = Math.round(seconds / (meters / 1000));
  return pace >= 120 && pace <= 1200 ? pace : null;
}

/**
 * Planned finish time for a distance goal with a pace to hold. A ceiling is
 * not a plan ("not faster than"), so it has no finish time.
 */
export function plannedFinishSeconds(target: RunTarget): number | undefined {
  if (target.kind !== 'pace' || target.mode !== 'range') return undefined;
  if (target.goal?.kind !== 'distance') return undefined;
  return Math.round((target.goal.meters / 1000) * target.secondsPerKm);
}

/** Step size of the plus/minus buttons for the target pace during a run. */
export const PACE_STEP_SECONDS = 5;

/**
 * Next target pace after a button press: `+1` raises the number (slower),
 * `-1` lowers it (faster). Outside the valid range there is no step; an odd
 * value snaps to the next 5-second grid.
 */
export function stepTargetPace(
  secondsPerKm: number,
  direction: 1 | -1,
): number | null {
  if (!Number.isFinite(secondsPerKm)) return null;
  const snapped =
    direction > 0
      ? Math.floor(secondsPerKm / PACE_STEP_SECONDS) * PACE_STEP_SECONDS
      : Math.ceil(secondsPerKm / PACE_STEP_SECONDS) * PACE_STEP_SECONDS;
  const next = snapped + direction * PACE_STEP_SECONDS;
  return next >= 120 && next <= 1200 ? next : null;
}

export function formatTargetPace(seconds: number): string {
  const rounded = Math.round(seconds);
  return `${Math.floor(rounded / 60)}:${String(rounded % 60).padStart(
    2,
    '0',
  )} /km`;
}

/** "25:00" or "1:05:00". */
export function formatClock(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const rest = String(total % 60).padStart(2, '0');
  return hours
    ? `${hours}:${String(minutes).padStart(2, '0')}:${rest}`
    : `${minutes}:${rest}`;
}

/** "5 km", "10,5 km", "800 m". */
export function formatGoalDistance(meters: number): string {
  if (meters < 1000) return `${Math.round(meters)} m`;
  const km = meters / 1000;
  return `${
    Number.isInteger(km)
      ? String(km)
      : fixed(km, km * 10 === Math.round(km * 10) ? 1 : 2)
  } km`;
}

/** "30 min", "1:30 h", "45 s". */
export function formatGoalDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)} s`;
  if (seconds % 60 !== 0) return formatClock(seconds);
  const minutes = seconds / 60;
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(
    2,
    '0',
  )} h`;
}

export function runGoalLabel(goal: RunGoal | undefined): string {
  if (!goal) return tr('Offen', 'Open');
  return goal.kind === 'distance'
    ? formatGoalDistance(goal.meters)
    : formatGoalDuration(goal.seconds);
}

export function intervalPlanLabel(plan: IntervalPlan): string {
  const work =
    plan.work.kind === 'time'
      ? formatGoalDuration(plan.work.seconds)
      : formatGoalDistance(plan.work.meters);
  const rest = plan.restSeconds
    ? tr(
        ` · ${formatGoalDuration(plan.restSeconds)} Pause`,
        ` · ${formatGoalDuration(plan.restSeconds)} rest`,
      )
    : '';
  return `${plan.repeats} × ${work}${rest}`;
}

/** What the run is guided by, without the goal: "5:00 /km", "130–150 bpm". */
export function runGuideLabel(target: RunTarget): string {
  if (target.kind === 'pace') {
    return target.mode === 'ceiling'
      ? tr(
          `Nicht schneller als ${formatTargetPace(target.secondsPerKm)}`,
          `Not faster than ${formatTargetPace(target.secondsPerKm)}`,
        )
      : formatTargetPace(target.secondsPerKm);
  }
  if (target.kind === 'heart_rate') {
    return `${target.minBpm}–${target.maxBpm} bpm`;
  }
  if (target.kind === 'intervals') return intervalPlanLabel(target.intervals);
  return tr('Nur tracken', 'Just track');
}

/** Goal and guide in one line: "5 km · 5:00 /km", "Nur tracken". */
export function runTargetLabel(target: RunTarget): string {
  const guide = runGuideLabel(target);
  if (!target.goal) return guide;
  const goal = runGoalLabel(target.goal);
  return target.kind === 'none' ? goal : `${goal} · ${guide}`;
}

/** Whether a target does anything during the run (cues or a goal to reach). */
export function hasRunTarget(target: RunTarget | undefined): boolean {
  return Boolean(target && (target.kind !== 'none' || target.goal));
}

/**
 * Last values per kind, so switching chips in the start sheet restores what
 * the user typed before instead of defaults.
 */
export interface RunTargetMemory {
  goalMeters?: number;
  goalSeconds?: number;
  pace?: { secondsPerKm: number; mode: 'ceiling' | 'range' };
  heartRate?: { minBpm: number; maxBpm: number };
  intervals?: IntervalPlan;
}

export function normalizeRunTargetMemory(value: unknown): RunTargetMemory {
  if (!value || typeof value !== 'object') return {};
  const raw = value as Record<string, unknown>;
  const memory: RunTargetMemory = {};
  const distance = normalizeRunGoal({
    kind: 'distance',
    meters: raw.goalMeters,
  });
  if (distance?.kind === 'distance') memory.goalMeters = distance.meters;
  const time = normalizeRunGoal({ kind: 'time', seconds: raw.goalSeconds });
  if (time?.kind === 'time') memory.goalSeconds = time.seconds;
  const pace = normalizeRunTarget({
    kind: 'pace',
    version: RUN_TARGET_VERSION,
    output: 'both',
    ...(raw.pace as object),
  });
  if (pace.kind === 'pace')
    memory.pace = { secondsPerKm: pace.secondsPerKm, mode: pace.mode };
  const heart = normalizeRunTarget({
    kind: 'heart_rate',
    version: RUN_TARGET_VERSION,
    output: 'both',
    ...(raw.heartRate as object),
  });
  if (heart.kind === 'heart_rate')
    memory.heartRate = { minBpm: heart.minBpm, maxBpm: heart.maxBpm };
  const intervals = normalizeIntervalPlan(raw.intervals);
  if (intervals) memory.intervals = intervals;
  return memory;
}

/** Remembers the values of the given target next to the earlier ones. */
export function rememberRunTarget(
  memory: RunTargetMemory,
  target: RunTarget,
): RunTargetMemory {
  const next = { ...memory };
  if (target.goal?.kind === 'distance') next.goalMeters = target.goal.meters;
  if (target.goal?.kind === 'time') next.goalSeconds = target.goal.seconds;
  if (target.kind === 'pace')
    next.pace = { secondsPerKm: target.secondsPerKm, mode: target.mode };
  if (target.kind === 'heart_rate')
    next.heartRate = { minBpm: target.minBpm, maxBpm: target.maxBpm };
  if (target.kind === 'intervals') next.intervals = target.intervals;
  return next;
}

function common(target: RunTarget) {
  return {
    ...(target.cueIntervalSeconds === undefined
      ? {}
      : { cueIntervalSeconds: target.cueIntervalSeconds }),
    ...(target.announcements ? { announcements: target.announcements } : {}),
    ...(target.goalCues === false ? { goalCues: false } : {}),
  };
}

/** Same target with another "how far"; intervals keep their own volume. */
export function withGoalKind(
  target: RunTarget,
  kind: RunGoalKind,
  memory: RunTargetMemory,
): RunTarget {
  const goal: RunGoal | undefined =
    kind === 'distance'
      ? { kind: 'distance', meters: memory.goalMeters ?? DEFAULT_GOAL_METERS }
      : kind === 'time'
      ? { kind: 'time', seconds: memory.goalSeconds ?? DEFAULT_GOAL_SECONDS }
      : undefined;
  const rest: Record<string, unknown> = { ...target };
  delete rest.goal;
  return normalizeRunTarget({
    ...rest,
    version: RUN_TARGET_VERSION,
    ...(goal && target.kind !== 'intervals' ? { goal } : {}),
  });
}

/** Same goal with another "run by", filled from memory or defaults. */
export function withGuideKind(
  target: RunTarget,
  kind: RunTargetKind,
  memory: RunTargetMemory,
): RunTarget {
  const output = target.output ?? 'both';
  const base = {
    ...common(target),
    version: RUN_TARGET_VERSION,
    ...(target.goal && kind !== 'intervals' ? { goal: target.goal } : {}),
  };
  if (kind === 'pace') {
    const pace = memory.pace ?? {
      secondsPerKm: DEFAULT_PACE_SECONDS,
      mode: 'range' as const,
    };
    return normalizeRunTarget({ ...base, kind, output, ...pace });
  }
  if (kind === 'heart_rate') {
    return normalizeRunTarget({
      ...base,
      kind,
      output,
      ...(memory.heartRate ?? DEFAULT_HEART_RATE),
    });
  }
  if (kind === 'intervals') {
    return normalizeRunTarget({
      ...base,
      kind,
      output,
      intervals: memory.intervals ?? DEFAULT_INTERVALS,
    });
  }
  return normalizeRunTarget({
    ...base,
    kind: 'none',
    ...(target.output ? { output: target.output } : {}),
  });
}

/** One phase of an interval session for the live display. */
export interface IntervalPhase {
  kind: 'warmup' | 'work' | 'rest' | 'done';
  /** 1-based work stretch for `work` and the rest after it. */
  index: number;
  count: number;
}

/** Phase state written by Kotlin (RunIntervals) on every phase change. */
export interface IntervalState {
  phase: number;
  startSeconds: number;
  startMeters: number;
}

/** Phases in order: warm-up (if any), work and rest alternating, done. */
export function intervalPhases(plan: IntervalPlan): IntervalPhase[] {
  const phases: IntervalPhase[] = [];
  if (plan.warmupSeconds > 0)
    phases.push({ kind: 'warmup', index: 0, count: plan.repeats });
  for (let index = 1; index <= plan.repeats; index += 1) {
    phases.push({ kind: 'work', index, count: plan.repeats });
    if (index < plan.repeats && plan.restSeconds > 0)
      phases.push({ kind: 'rest', index, count: plan.repeats });
  }
  phases.push({ kind: 'done', index: plan.repeats, count: plan.repeats });
  return phases;
}

export function normalizeIntervalState(
  value: unknown,
): IntervalState | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const raw = value as Record<string, unknown>;
  const phase = raw.phase;
  const startSeconds = raw.startSeconds;
  const startMeters = raw.startMeters;
  return typeof phase === 'number' &&
    Number.isInteger(phase) &&
    phase >= 0 &&
    typeof startSeconds === 'number' &&
    Number.isFinite(startSeconds) &&
    startSeconds >= 0 &&
    typeof startMeters === 'number' &&
    Number.isFinite(startMeters) &&
    startMeters >= 0
    ? { phase, startSeconds, startMeters }
    : undefined;
}

/**
 * Live line under the goal: what is left of the goal or of the current
 * interval phase. Distance remains unknown without measured distance; then
 * the line says nothing about it instead of guessing.
 */
export function targetProgressLabel(
  target: RunTarget | undefined,
  run: {
    durationSeconds: number;
    distanceMeters: number;
    intervalState?: IntervalState;
  },
): string | undefined {
  if (!target) return undefined;
  if (target.kind === 'intervals') {
    const phases = intervalPhases(target.intervals);
    const state = run.intervalState ?? {
      phase: 0,
      startSeconds: 0,
      startMeters: 0,
    };
    const phase = phases[Math.min(state.phase, phases.length - 1)];
    if (phase.kind === 'done')
      return tr('Intervalle geschafft', 'Intervals done');
    const elapsed = Math.max(0, run.durationSeconds - state.startSeconds);
    const covered = Math.max(0, run.distanceMeters - state.startMeters);
    const left =
      phase.kind === 'work'
        ? target.intervals.work.kind === 'time'
          ? formatClock(target.intervals.work.seconds - elapsed)
          : formatGoalDistance(
              Math.max(0, target.intervals.work.meters - covered),
            )
        : formatClock(
            (phase.kind === 'warmup'
              ? target.intervals.warmupSeconds
              : target.intervals.restSeconds) - elapsed,
          );
    const name =
      phase.kind === 'warmup'
        ? tr('Einlaufen', 'Warm-up')
        : phase.kind === 'rest'
        ? tr('Pause', 'Rest')
        : tr(
            `Intervall ${phase.index} von ${phase.count}`,
            `Interval ${phase.index} of ${phase.count}`,
          );
    return tr(`${name} · noch ${left}`, `${name} · ${left} left`);
  }
  const goal = target.goal;
  if (!goal) return undefined;
  if (goal.kind === 'distance') {
    const left = goal.meters - run.distanceMeters;
    if (left <= 0) return tr('Ziel erreicht', 'Goal reached');
    return tr(
      `Noch ${formatGoalDistance(left)}`,
      `${formatGoalDistance(left)} left`,
    );
  }
  const left = goal.seconds - run.durationSeconds;
  if (left <= 0) return tr('Ziel erreicht', 'Goal reached');
  return tr(`Noch ${formatClock(left)}`, `${formatClock(left)} left`);
}
