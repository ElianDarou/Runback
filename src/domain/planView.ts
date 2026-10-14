import type { Sport } from './types';
import type { Run } from './trainingRecords';
import {
  displaySessionName,
  summarize,
  type StrengthSession,
} from './strength';
import { isAccidentalRun, isRun } from './sport';
import { runTitle } from './runTitle';
import { tr } from './i18n';
import {
  addCalendarDays,
  localDateKey,
  startOfWeek,
  type PlannedItem,
  type ScheduleDate,
} from './schedule';

/**
 * What Plan shows per day: planned workouts next to what was recorded.
 *
 * A planned workout counts as done only through a recording of the same kind
 * on the same day, never from the date alone: a run by a run (not a ride), a
 * strength template first by a session of that template, then by any other
 * strength session of the day. Whatever is left was trained without a plan.
 * False starts are no training and do not appear.
 *
 * v2: matched by day instead of a stored link; totals compare with the usual
 * amount of earlier periods.
 */
export const PLAN_VIEW_VERSION = 'plan-view-v2';

/** A recorded workout, reduced to what the calendar shows. */
export interface PlanActivity {
  id: string;
  kind: 'run' | 'strength';
  /** Runs only: running or cycling. */
  sport?: Sport;
  /** Strength only: the template it was started from. */
  templateId?: string;
  startTime: number;
  title: string;
  finished: boolean;
  /** Measured; missing stays missing. */
  durationSeconds?: number;
  /** Runs and rides with a measured distance. */
  distanceMeters?: number;
  /** Running only (not cycling): feeds the running total of a period. */
  runningMeters?: number;
  /** Strength only: confirmed sets. */
  sets?: number;
  /** Under 60 s and 100 m: stays stored but is no training. */
  falseStart?: boolean;
}

/** A run or ride as the calendar sees it. */
export function runActivity(run: Run): PlanActivity {
  const status = String(run.status || '').toLowerCase();
  return {
    id: run.id,
    kind: 'run',
    sport: run.sport,
    startTime: run.startTime,
    title: runTitle(run),
    finished:
      run.endTime > run.startTime &&
      ['completed', 'finished', 'complete', 'done', 'imported'].includes(
        status,
      ),
    durationSeconds: run.durationSeconds > 0 ? run.durationSeconds : undefined,
    distanceMeters: run.distanceMeters > 0 ? run.distanceMeters : undefined,
    runningMeters:
      isRun(run) && run.distanceMeters > 0 ? run.distanceMeters : undefined,
    falseStart: isAccidentalRun(run),
  };
}

/** A strength session as the calendar sees it. */
export function strengthActivity(session: StrengthSession): PlanActivity {
  const ended = (session.endTime ?? 0) > session.startTime;
  return {
    id: session.id,
    kind: 'strength',
    templateId: session.templateId,
    startTime: session.startTime,
    title:
      displaySessionName(session.name) ||
      tr('Krafttraining', 'Strength training'),
    // Imports may lack an end time: finished stays finished, only the
    // duration is unknown.
    finished: session.status === 'finished',
    durationSeconds: ended
      ? Math.round((session.endTime! - session.startTime) / 1000)
      : undefined,
    sets: summarize(session).completedSets,
  };
}

/** Planned and not (yet) done · running right now · done. */
export type MarkState = 'planned' | 'started' | 'done';

export type DayEntry =
  | {
      type: 'planned';
      item: PlannedItem;
      state: MarkState;
      activity?: PlanActivity;
    }
  | { type: 'unplanned'; activity: PlanActivity; state: 'started' | 'done' };

const isRunning = (activity: PlanActivity) =>
  activity.kind === 'run' && activity.sport !== 'cycling';

/** Training activities per local start date, oldest first. */
export function activitiesByDate(
  activities: PlanActivity[],
): Record<ScheduleDate, PlanActivity[]> {
  const byDate: Record<ScheduleDate, PlanActivity[]> = {};
  [...activities]
    .filter(activity => !activity.falseStart)
    .sort((a, b) => a.startTime - b.startTime)
    .forEach(activity => {
      const date = localDateKey(new Date(activity.startTime));
      (byDate[date] = byDate[date] ?? []).push(activity);
    });
  return byDate;
}

/**
 * Pairs the planned workouts of one day with that day's recordings. Planned
 * entries keep their order; unplanned recordings follow by start time.
 */
export function dayEntries(
  planned: PlannedItem[],
  activities: PlanActivity[],
): DayEntry[] {
  const open = activities.filter(activity => !activity.falseStart);
  const matched = new Map<number, PlanActivity>();
  const take = (index: number, test: (activity: PlanActivity) => boolean) => {
    const found = open.find(test);
    if (!found) return;
    open.splice(open.indexOf(found), 1);
    matched.set(index, found);
  };
  // The same template first, so "Pull" is not taken by the "Push" session.
  planned.forEach((item, index) => {
    if (item.kind === 'strength' && item.templateId)
      take(
        index,
        activity =>
          activity.kind === 'strength' &&
          activity.templateId === item.templateId,
      );
  });
  planned.forEach((item, index) => {
    if (matched.has(index)) return;
    take(index, item.kind === 'run' ? isRunning : a => a.kind === 'strength');
  });
  const state = (activity: PlanActivity) =>
    activity.finished ? ('done' as const) : ('started' as const);
  return [
    ...planned.map((item, index): DayEntry => {
      const activity = matched.get(index);
      return activity
        ? { type: 'planned', item, state: state(activity), activity }
        : { type: 'planned', item, state: 'planned' };
    }),
    ...open.map(
      (activity): DayEntry => ({
        type: 'unplanned',
        activity,
        state: state(activity),
      }),
    ),
  ];
}

export interface PeriodTotals {
  /** Finished workouts that started in the period. */
  workouts: number;
  /** Sum of measured durations; undefined if none is known. */
  seconds?: number;
  /** How many of the workouts have a measured duration. */
  timed: number;
  /** Running distance (not cycling); undefined if none is known. */
  runningMeters?: number;
  runs: number;
  measuredRuns: number;
}

/** Totals of finished training that started from `from` to `to`, inclusive. */
export function periodTotals(
  activities: PlanActivity[],
  from: ScheduleDate,
  to: ScheduleDate,
): PeriodTotals {
  const totals: PeriodTotals = {
    workouts: 0,
    timed: 0,
    runs: 0,
    measuredRuns: 0,
  };
  activities.forEach(activity => {
    if (!activity.finished || activity.falseStart) return;
    const date = localDateKey(new Date(activity.startTime));
    if (date < from || date > to) return;
    totals.workouts += 1;
    if (activity.durationSeconds !== undefined) {
      totals.timed += 1;
      totals.seconds = (totals.seconds ?? 0) + activity.durationSeconds;
    }
    if (isRunning(activity)) {
      totals.runs += 1;
      if (activity.runningMeters !== undefined) {
        totals.measuredRuns += 1;
        totals.runningMeters =
          (totals.runningMeters ?? 0) + activity.runningMeters;
      }
    }
  });
  return totals;
}

/** Earlier periods that make up "usual", and how many are needed at least. */
export const USUAL_PERIODS = 6;
export const USUAL_MIN_PERIODS = 3;
/** Within ±10 % of the usual amount counts as usual. */
export const USUAL_MARGIN = 0.1;

export type UsualTone = 'more' | 'usual' | 'less';
export type PeriodKind = 'week' | 'month';

export interface UsualComparison {
  /** Tones per value; missing where the basis is too thin or incomplete. */
  workouts?: UsualTone;
  seconds?: UsualTone;
  runningMeters?: UsualTone;
  /** Earlier periods the workouts are compared with. */
  periods: number;
  /** Days of each period compared: all of them, or the days so far. */
  days: number;
  partial: boolean;
}

const periodStart = (kind: PeriodKind, date: ScheduleDate): ScheduleDate =>
  kind === 'week' ? startOfWeek(date) : `${date.slice(0, 7)}-01`;

const monthsBack = (first: ScheduleDate, months: number): ScheduleDate => {
  const [year, month] = first.split('-').map(Number);
  const index = year * 12 + (month - 1) - months;
  return `${String(Math.floor(index / 12)).padStart(4, '0')}-${String(
    (index % 12) + 1,
  ).padStart(2, '0')}-01`;
};

const periodEnd = (kind: PeriodKind, start: ScheduleDate): ScheduleDate =>
  kind === 'week'
    ? addCalendarDays(start, 6)
    : addCalendarDays(monthsBack(start, -1), -1);

const daysBetween = (from: ScheduleDate, to: ScheduleDate): number =>
  Math.round(
    (new Date(`${to}T12:00:00`).getTime() -
      new Date(`${from}T12:00:00`).getTime()) /
      86400000,
  );

const median = (values: number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
};

const tone = (value: number, usual: number): UsualTone => {
  if (usual === 0) return value > 0 ? 'more' : 'usual';
  const ratio = value / usual;
  return ratio >= 1 + USUAL_MARGIN
    ? 'more'
    : ratio <= 1 - USUAL_MARGIN
    ? 'less'
    : 'usual';
};

/**
 * Compares a week or month with the median of the up to six periods before
 * it. A running period is compared day for day with the same first days of
 * the earlier ones. Periods before the first recording are not "nothing
 * trained" but unknown and stay out. A total with an unmeasured workout is
 * not compared, and neither are earlier periods with one.
 */
export function compareWithUsual({
  activities,
  kind,
  start,
  today,
}: {
  activities: PlanActivity[];
  kind: PeriodKind;
  /** First day of the shown period. */
  start: ScheduleDate;
  today: ScheduleDate;
}): UsualComparison | undefined {
  if (start > today) return undefined;
  const training = activities.filter(
    activity => activity.finished && !activity.falseStart,
  );
  if (!training.length) return undefined;
  const first = training
    .map(activity => localDateKey(new Date(activity.startTime)))
    .sort()[0];
  const firstPeriod = periodStart(kind, first);
  const end = periodEnd(kind, start);
  const partial = end > today;
  const days = daysBetween(start, partial ? today : end) + 1;
  const window = (from: ScheduleDate) => {
    const last = periodEnd(kind, from);
    const cut = addCalendarDays(from, days - 1);
    return periodTotals(training, from, cut < last ? cut : last);
  };
  const earlier: PeriodTotals[] = [];
  for (let back = 1; back <= USUAL_PERIODS; back += 1) {
    const from =
      kind === 'week'
        ? addCalendarDays(start, -7 * back)
        : monthsBack(start, back);
    if (from < firstPeriod) break;
    earlier.push(window(from));
  }
  if (earlier.length < USUAL_MIN_PERIODS) return undefined;
  const current = window(start);
  const comparison: UsualComparison = {
    workouts: tone(current.workouts, median(earlier.map(p => p.workouts))),
    periods: earlier.length,
    days,
    partial,
  };
  const timed = earlier.filter(period => period.timed === period.workouts);
  if (current.timed === current.workouts && timed.length >= USUAL_MIN_PERIODS)
    comparison.seconds = tone(
      current.seconds ?? 0,
      median(timed.map(period => period.seconds ?? 0)),
    );
  const measured = earlier.filter(
    period => period.measuredRuns === period.runs,
  );
  if (
    current.measuredRuns === current.runs &&
    measured.length >= USUAL_MIN_PERIODS &&
    (current.runs > 0 || measured.some(period => period.runs > 0))
  )
    comparison.runningMeters = tone(
      current.runningMeters ?? 0,
      median(measured.map(period => period.runningMeters ?? 0)),
    );
  return comparison;
}
