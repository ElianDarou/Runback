import type { Run } from './trainingRecords';
import type { RunSlotPlan, ScheduleDate, ScheduleRoutine } from './schedule';
import { startOfWeek } from './schedule';
import { peakLongRunKm, formatDistanceKm } from './raceGoal';
import { validRun } from './statistics';
import { median } from './inference';
import { tr } from './i18n';

/**
 * Build-up to a race: which long run goes into which week.
 *
 * Fixed, versioned rules, not a learning profile:
 * - The long run grows by at most ten percent per week, starting from the
 *   median of the longest runs of the last four weeks.
 * - Every fourth build-up week is a recovery week at four fifths.
 * - The week before the race is a taper (60 %); the race week only contains
 *   the race and a short easy run.
 * - The build-up ends at the targeted long run (`peakLongRunKm`).
 * If that doesn't reach the target date, the build-up says how far it gets;
 * it neither shortens the rule nor the time.
 */
export const BUILD_UP_VERSION = 'buildup-v1';
export const MAX_WEEKLY_GROWTH = 1.1;
export const RECOVERY_SHARE = 0.8;
export const TAPER_SHARE = 0.6;
export const BASE_WINDOW_DAYS = 28;
export const PACE_WINDOW_DAYS = 56;
/** Short easy run in the race week, in minutes. */
export const RACE_WEEK_EASY_MINUTES = 30;

const DAY = 86400000;

export type { RunSlotPlan } from './schedule';

export type BuildUpPhase = 'build' | 'recovery' | 'taper' | 'race';

export interface BuildUpInput {
  goal: { name: string; distanceKm: number; targetDate: ScheduleDate };
  runs: Run[];
  routine: ScheduleRoutine;
  weekStart: ScheduleDate;
  today: ScheduleDate;
  now: number;
}

export type BuildUpStatus =
  | 'ready'
  | 'past_target'
  | 'no_days'
  | 'insufficient_data';

export interface BuildUpWeek {
  version: typeof BUILD_UP_VERSION;
  status: BuildUpStatus;
  /** Weeks from this week to the race week; 0 is the race week. */
  weeksToGo: number;
  phase?: BuildUpPhase;
  peakLongRunKm: number;
  baseLongRunKm?: number;
  longRunKm?: number;
  /** What the build-up reaches by the last build-up week. */
  reachableKm?: number;
  paceSecondsPerKm?: number;
  slots: RunSlotPlan[];
  rationale: string[];
  limits: string[];
}

const round1 = (value: number) => Math.round(value * 10) / 10;
const roundMinutes = (value: number) => Math.max(10, Math.round(value / 5) * 5);

const weekKeyOf = (run: Run) => startOfWeek(run.startTime);

/** Median of the longest runs per week in the window; needs two weeks. */
export function baseLongRunKm(
  runs: Run[],
  now: number,
): { km?: number; weeks: number } {
  const windowStart = now - BASE_WINDOW_DAYS * DAY;
  const byWeek = new Map<string, number>();
  for (const run of runs) {
    if (!validRun(run, now) || run.startTime < windowStart) continue;
    const km = run.distanceMeters / 1000;
    if (km <= 0) continue;
    const key = weekKeyOf(run);
    byWeek.set(key, Math.max(byWeek.get(key) ?? 0, km));
  }
  const values = [...byWeek.values()];
  if (values.length < 2) {
    return { weeks: values.length };
  }
  return { km: round1(median(values)), weeks: values.length };
}

/** Median pace of easy runs from 5 km in the last eight weeks. */
export function longRunPace(runs: Run[], now: number): number | undefined {
  const windowStart = now - PACE_WINDOW_DAYS * DAY;
  const paces = runs
    .filter(
      run =>
        validRun(run, now) &&
        run.startTime >= windowStart &&
        run.distanceMeters >= 5000 &&
        run.durationSeconds > 0 &&
        run.purpose !== 'intervals' &&
        run.purpose !== 'race',
    )
    .map(run => run.durationSeconds / (run.distanceMeters / 1000));
  return paces.length ? median(paces) : undefined;
}

const weeksBetween = (from: ScheduleDate, to: ScheduleDate): number => {
  const [fy, fm, fd] = from.split('-').map(Number);
  const [ty, tm, td] = to.split('-').map(Number);
  const a = new Date(fy, fm - 1, fd, 12).getTime();
  const b = new Date(ty, tm - 1, td, 12).getTime();
  return Math.round((b - a) / DAY / 7);
};

const weekdayOf = (date: ScheduleDate): number => {
  const [y, m, d] = date.split('-').map(Number);
  const day = new Date(y, m - 1, d, 12).getDay();
  return (day + 6) % 7;
};

/**
 * Long runs per build-up week, from the current week to the last build-up
 * week before the taper. Index 0 is the current week.
 */
export function longRunSequence(
  baseKm: number,
  peakKm: number,
  buildWeeks: number,
): { km: number; recovery: boolean }[] {
  const sequence: { km: number; recovery: boolean }[] = [];
  let line = baseKm;
  for (let index = 0; index < buildWeeks; index += 1) {
    const recovery = (index + 1) % 4 === 0 && index + 1 < buildWeeks;
    if (recovery) {
      sequence.push({ km: round1(line * RECOVERY_SHARE), recovery: true });
      continue;
    }
    line = Math.min(peakKm, line * MAX_WEEKLY_GROWTH);
    sequence.push({ km: round1(line), recovery: false });
  }
  return sequence;
}

export function buildUpWeek(input: BuildUpInput): BuildUpWeek {
  const peak = peakLongRunKm(input.goal.distanceKm);
  const raceWeekStart = startOfWeek(input.goal.targetDate);
  const currentWeekStart = startOfWeek(input.today);
  const weeksToGo = weeksBetween(input.weekStart, raceWeekStart);
  const base = {
    version: BUILD_UP_VERSION as typeof BUILD_UP_VERSION,
    weeksToGo,
    peakLongRunKm: peak,
    slots: [] as RunSlotPlan[],
    rationale: [] as string[],
    limits: [] as string[],
  };
  if (weeksToGo < 0) {
    return {
      ...base,
      status: 'past_target',
      rationale: [
        tr(
          'Das Zieldatum liegt vor dieser Woche; die Routine gilt wie gewohnt.',
          'The target date is before this week; the routine applies as usual.',
        ),
      ],
    };
  }
  const runDays = [...new Set(input.routine.days)].sort((a, b) => a - b);
  if (!runDays.length) {
    return {
      ...base,
      status: 'no_days',
      limits: [
        tr(
          'Lege unter „Zeit & Rhythmus“ deine Lauftage fest, dann plant Runback den Aufbau.',
          'Set your running days under “Time & routine”, then Runback plans the build-up.',
        ),
      ],
    };
  }
  const baseline = baseLongRunKm(input.runs, input.now);
  const pace = longRunPace(input.runs, input.now);
  const missing: string[] = [];
  if (baseline.km === undefined) {
    missing.push(
      tr(
        'Für den Aufbau fehlen Läufe aus mindestens zwei der letzten vier Wochen.',
        'The build-up needs runs from at least two of the last four weeks.',
      ),
    );
  }
  if (pace === undefined) {
    missing.push(
      tr(
        'Für die Dauer fehlt ein Lauf ab 5 km aus den letzten acht Wochen.',
        'The duration needs a run of 5 km or more from the last eight weeks.',
      ),
    );
  }
  if (baseline.km === undefined || pace === undefined) {
    return { ...base, status: 'insufficient_data', baseLongRunKm: baseline.km, limits: missing };
  }
  const easy: Omit<RunSlotPlan, 'routineDay'> = {
    minutes: input.routine.minutes,
    purpose: 'easy',
    title: tr('Lockere Runde', 'Easy run'),
    effort: 'easy',
  };
  const minutesFor = (km: number) => roundMinutes((km * pace) / 60);
  const longDay = runDays[runDays.length - 1];

  if (weeksToGo === 0) {
    const raceDay = weekdayOf(input.goal.targetDate);
    const slots: RunSlotPlan[] = runDays
      .filter(day => day <= raceDay - 2)
      .map(day => ({
        ...easy,
        routineDay: day,
        minutes: Math.min(input.routine.minutes, RACE_WEEK_EASY_MINUTES),
      }));
    slots.push({
      routineDay: raceDay,
      minutes: minutesFor(input.goal.distanceKm),
      purpose: 'race',
      title: input.goal.name,
      effort: 'hard',
      distanceKm: input.goal.distanceKm,
      stretch: true,
    });
    return {
      ...base,
      status: 'ready',
      phase: 'race',
      baseLongRunKm: baseline.km,
      paceSecondsPerKm: pace,
      slots,
      rationale: [
        tr(
          `Wettkampfwoche: ${input.goal.name} am ${input.goal.targetDate}, davor nur kurz und locker.`,
          `Race week: ${input.goal.name} on ${input.goal.targetDate}, only short and easy before it.`,
        ),
      ],
    };
  }

  // Weeks until the taper, counted from the current week, so a new suggestion
  // after new runs starts from the real state.
  const buildWeeksTotal = Math.max(0, weeksBetween(currentWeekStart, raceWeekStart) - 1);
  const sequence = longRunSequence(baseline.km, peak, buildWeeksTotal);
  const reachable = sequence.length ? sequence[sequence.length - 1].km : baseline.km;
  const offset = weeksBetween(currentWeekStart, input.weekStart);
  const limits: string[] = [];
  if (reachable < peak) {
    limits.push(
      tr(
        `Mit höchstens 10 % mehr pro Woche kommst du bis zum Ziel auf lange Läufe von etwa ${formatDistanceKm(
          reachable,
        )} statt ${formatDistanceKm(peak)}.`,
        `With at most 10% more per week, you reach long runs of about ${formatDistanceKm(
          reachable,
        )} by the target instead of ${formatDistanceKm(peak)}.`,
      ),
    );
  }
  let longKm: number;
  let phase: BuildUpPhase;
  if (weeksToGo === 1) {
    phase = 'taper';
    longKm = round1(reachable * TAPER_SHARE);
  } else {
    const entry = sequence[Math.min(offset, sequence.length - 1)];
    phase = entry?.recovery ? 'recovery' : 'build';
    longKm = entry?.km ?? baseline.km;
  }
  const slots: RunSlotPlan[] = runDays.map(day =>
    day === longDay
      ? {
          routineDay: day,
          minutes: minutesFor(longKm),
          purpose: 'long',
          title: tr(
            `Langer Lauf · ${formatDistanceKm(longKm)}`,
            `Long run · ${formatDistanceKm(longKm)}`,
          ),
          effort: phase === 'taper' ? 'easy' : 'hard',
          distanceKm: longKm,
          stretch: true,
        }
      : { ...easy, routineDay: day },
  );
  const rationale =
    phase === 'taper'
      ? [
          tr(
            `Entlastung: noch eine Woche bis ${input.goal.name}, langer Lauf ${formatDistanceKm(longKm)}.`,
            `Taper: one week to ${input.goal.name}, long run ${formatDistanceKm(longKm)}.`,
          ),
        ]
      : phase === 'recovery'
      ? [
          tr(
            `Erholungswoche im Aufbau zu ${input.goal.name}: langer Lauf ${formatDistanceKm(longKm)}.`,
            `Recovery week in the build-up to ${input.goal.name}: long run ${formatDistanceKm(longKm)}.`,
          ),
        ]
      : [
          tr(
            `Aufbau zu ${input.goal.name}: noch ${weeksToGo} Wochen, langer Lauf ${formatDistanceKm(
              longKm,
            )} von ${formatDistanceKm(peak)}.`,
            `Build-up to ${input.goal.name}: ${weeksToGo} weeks to go, long run ${formatDistanceKm(
              longKm,
            )} of ${formatDistanceKm(peak)}.`,
          ),
        ];
  return {
    ...base,
    status: 'ready',
    phase,
    baseLongRunKm: baseline.km,
    longRunKm: longKm,
    reachableKm: reachable,
    paceSecondsPerKm: pace,
    slots,
    rationale,
    limits,
  };
}
