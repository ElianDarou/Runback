import type { ScheduledSession } from './schedule';
import type { Sport } from './types';
import { localDateKey } from './schedule';

/**
 * What Plan shows per day: planned sessions next to what was actually
 * recorded. Pure view data — nothing here judges a day or infers completion
 * from a date. A planned session counts as done only through its linked
 * activity.
 */

/** A recorded workout, reduced to what the calendar shows. */
export interface PlanActivity {
  id: string;
  /** Older imports link through a canonical ID. */
  canonicalId?: string;
  kind: 'run' | 'strength';
  /** Runs only: running or cycling. */
  sport?: Sport;
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
}

export type PlanStatus = 'planned' | 'skipped' | 'started' | 'done';

export type PlanEntry =
  | {
      type: 'planned';
      session: ScheduledSession;
      status: PlanStatus;
      activity?: PlanActivity;
    }
  | {
      /**
       * A recording on the day it started. `plannedFor` names the planned
       * date when it belongs to a plan of another day; without it, it was
       * trained without a plan.
       */
      type: 'recorded';
      activity: PlanActivity;
      plannedFor?: string;
    };

const matches = (activity: PlanActivity, id: string | undefined): boolean =>
  Boolean(id && (activity.id === id || activity.canonicalId === id));

export function linkedActivity(
  session: ScheduledSession,
  activities: PlanActivity[],
): PlanActivity | undefined {
  if (!session.activityId) return undefined;
  return activities.find(
    activity =>
      activity.kind === session.kind && matches(activity, session.activityId),
  );
}

export function planStatus(
  session: ScheduledSession,
  activities: PlanActivity[],
): PlanStatus {
  if (session.status === 'skipped') return 'skipped';
  const activity = linkedActivity(session, activities);
  if (!activity) return 'planned';
  return activity.finished ? 'done' : 'started';
}

/**
 * Entries per date key. A linked activity appears with its planned session on
 * the planned date. If it started on another day, it also shows there, so
 * every day lists what was trained on it. Unlinked activities show on the day
 * they started. Within a day: by start time, planned-only sessions last.
 */
export function planEntriesByDate(
  sessions: ScheduledSession[],
  activities: PlanActivity[],
): Record<string, PlanEntry[]> {
  const byDate: Record<string, PlanEntry[]> = {};
  const push = (date: string, entry: PlanEntry) => {
    (byDate[date] = byDate[date] ?? []).push(entry);
  };
  const linkedIds = new Set<string>();
  sessions.forEach(session => {
    const activity = linkedActivity(session, activities);
    if (activity) {
      linkedIds.add(activity.id);
      const started = localDateKey(new Date(activity.startTime));
      if (started !== session.date)
        push(started, {
          type: 'recorded',
          activity,
          plannedFor: session.date,
        });
    }
    push(session.date, {
      type: 'planned',
      session,
      status: planStatus(session, activities),
      activity,
    });
  });
  activities.forEach(activity => {
    if (linkedIds.has(activity.id)) return;
    push(localDateKey(new Date(activity.startTime)), {
      type: 'recorded',
      activity,
    });
  });
  const order = (entry: PlanEntry) =>
    entry.type === 'recorded'
      ? entry.activity.startTime
      : entry.activity?.startTime ?? Number.MAX_SAFE_INTEGER;
  Object.values(byDate).forEach(entries =>
    entries.sort((a, b) => order(a) - order(b)),
  );
  return byDate;
}

export interface PlanSummary {
  /** Finished recorded workouts that started in the period, planned or not. */
  done: number;
  /** Planned sessions dated in the period that were not skipped. */
  planned: number;
  /** Of those, done through a linked finished activity. */
  plannedDone: number;
  /** Measured durations of finished workouts; undefined if none is known. */
  seconds?: number;
  /** How many of the `done` workouts have a measured duration. */
  timed: number;
  /** Running distance of finished runs; undefined if none is known. */
  runningMeters?: number;
  /** Finished runs (running only), and how many of them have a distance. */
  runs: number;
  measuredRuns: number;
}

/**
 * Actual training counts by the day it started; plan progress by the planned
 * date. A run on March 31 linked to a plan for April 1 is March training and
 * done April plan. Totals that miss a measurement say so via `timed` and
 * `measuredRuns` instead of passing as complete.
 */
export function planSummary(
  dates: string[],
  byDate: Record<string, PlanEntry[]>,
  activities: PlanActivity[],
): PlanSummary {
  const inPeriod = new Set(dates);
  let planned = 0;
  let plannedDone = 0;
  dates.forEach(date => {
    (byDate[date] ?? []).forEach(entry => {
      if (entry.type !== 'planned' || entry.status === 'skipped') return;
      planned += 1;
      if (entry.status === 'done') plannedDone += 1;
    });
  });
  let done = 0;
  let timed = 0;
  let runs = 0;
  let measuredRuns = 0;
  let seconds: number | undefined;
  let runningMeters: number | undefined;
  activities.forEach(activity => {
    if (!activity.finished) return;
    if (!inPeriod.has(localDateKey(new Date(activity.startTime)))) return;
    done += 1;
    if (activity.durationSeconds !== undefined) {
      timed += 1;
      seconds = (seconds ?? 0) + activity.durationSeconds;
    }
    if (activity.kind === 'run' && activity.sport !== 'cycling') {
      runs += 1;
      if (activity.runningMeters !== undefined) {
        measuredRuns += 1;
        runningMeters = (runningMeters ?? 0) + activity.runningMeters;
      }
    }
  });
  return {
    done,
    planned,
    plannedDone,
    seconds,
    timed,
    runningMeters,
    runs,
    measuredRuns,
  };
}
