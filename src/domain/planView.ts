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
  | { type: 'unplanned'; activity: PlanActivity };

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
 * Entries per date key. A linked activity appears with its planned session
 * (on the planned date); every other activity on the day it started.
 * Within a day: by start time, planned-only sessions after recorded ones.
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
    if (activity) linkedIds.add(activity.id);
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
      type: 'unplanned',
      activity,
    });
  });
  const order = (entry: PlanEntry) =>
    entry.type === 'unplanned'
      ? entry.activity.startTime
      : entry.activity?.startTime ?? Number.MAX_SAFE_INTEGER;
  Object.values(byDate).forEach(entries =>
    entries.sort((a, b) => order(a) - order(b)),
  );
  return byDate;
}

export interface PlanSummary {
  /** Finished recorded workouts, planned or not. */
  done: number;
  /** Planned sessions that were not skipped. */
  planned: number;
  /** Of those, done through a linked finished activity. */
  plannedDone: number;
  /** Sum of measured durations of finished workouts; undefined if none is known. */
  seconds?: number;
  /** Running distance; undefined when no run with a distance happened. */
  runningMeters?: number;
}

export function planSummary(
  dates: string[],
  byDate: Record<string, PlanEntry[]>,
): PlanSummary {
  let done = 0;
  let planned = 0;
  let plannedDone = 0;
  let seconds: number | undefined;
  let runningMeters: number | undefined;
  dates.forEach(date => {
    (byDate[date] ?? []).forEach(entry => {
      if (entry.type === 'planned') {
        if (entry.status === 'skipped') return;
        planned += 1;
        if (entry.status === 'done') plannedDone += 1;
      }
      const activity = entry.activity;
      if (!activity?.finished) return;
      done += 1;
      if (activity.durationSeconds !== undefined)
        seconds = (seconds ?? 0) + activity.durationSeconds;
      if (activity.runningMeters !== undefined)
        runningMeters = (runningMeters ?? 0) + activity.runningMeters;
    });
  });
  return { done, planned, plannedDone, seconds, runningMeters };
}
