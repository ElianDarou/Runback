import type { RunPurpose } from './types';
import type { WorkoutTemplate } from './strength';
import { tr } from './i18n';

/**
 * Calendar planning: what the user means to train on which day.
 *
 * Two layers, both written only by the user:
 * - the weekly plan: runs on fixed weekdays (`runDays`) and each strength
 *   template on its own weekdays (`WorkoutTemplate.days`);
 * - changed days: a day the user edited keeps exactly its own sessions, and
 *   the weekly plan no longer applies to it.
 *
 * A session describes an intent, never the result of a workout. Whether it was
 * done is read from the recordings of that day (`planView.ts`). Past days keep
 * the weekly plan that was in effect then (`weeklyHistory`), so changing the
 * weekly plan today does not rewrite what was planned last month.
 *
 * v2: no time budget, availability, locks, or week suggestions anymore. Older
 * fields are dropped on read; planned sessions and the running goal stay.
 */
export const SCHEDULE_VERSION = 2 as const;
export const SCHEDULE_MODEL_VERSION = 'schedule-v2';

export type ScheduleDate = string;
export type ScheduleKind = 'run' | 'strength';
export type ScheduleStatus = 'planned' | 'skipped';

export interface ScheduleGoal {
  name: string;
  startDate: ScheduleDate;
  targetDate?: ScheduleDate;
  phase?: string;
  /** Goal distance in km; without it, `raceGoal` reads it from the name. */
  distanceKm?: number;
  /** Goal time in seconds, optional. */
  targetSeconds?: number;
}

export interface ScheduledSession {
  id: string;
  date: ScheduleDate;
  /** Shown when the template is gone; a live template name wins. */
  title: string;
  kind: ScheduleKind;
  purpose?: RunPurpose;
  templateId?: string;
  /**
   * Older plans could skip a session. A skipped session is not planned
   * anymore but still marks its day as changed.
   */
  status: ScheduleStatus;
}

/** Weekdays 0 (Monday) to 6 (Sunday). */
export interface WeeklyPlan {
  run: number[];
  strength: { templateId: string; days: number[] }[];
}

/** The weekly plan in effect from `since` until the next snapshot. */
export interface WeeklySnapshot extends WeeklyPlan {
  since: ScheduleDate;
}

export interface ScheduleState {
  version: typeof SCHEDULE_VERSION;
  sessions: ScheduledSession[];
  /** Days the user edited; the weekly plan does not apply to them. */
  changedDays: ScheduleDate[];
  /** Weekly run days, 0 (Monday) to 6. */
  runDays: number[];
  weeklyHistory: WeeklySnapshot[];
  goal?: ScheduleGoal;
}

export type LocalDateInput = string | number | Date;

const DATE_KEY = /^(\d{4})-(\d{2})-(\d{2})$/;
const PURPOSES: RunPurpose[] = [
  'easy',
  'long',
  'intervals',
  'race',
  'free',
  'unknown',
];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const finiteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

const nonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;

const isDay = (value: unknown): value is number =>
  typeof value === 'number' &&
  Number.isInteger(value) &&
  value >= 0 &&
  value <= 6;

const sortDays = (days: unknown): number[] =>
  Array.from(new Set((Array.isArray(days) ? days : []).filter(isDay))).sort(
    (a, b) => a - b,
  );

const dateParts = (value: string): [number, number, number] | null => {
  const match = DATE_KEY.exec(value);
  if (!match) {
    return null;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) {
    return null;
  }
  return [year, month, day];
};

/**
 * Creates a local midnight without using Date.UTC. The latter turns a date
 * key into the previous/next local day in many time zones.
 */
const localDateFromKey = (value: string): Date | null => {
  const parts = dateParts(value);
  if (!parts) {
    return null;
  }
  const [year, month, day] = parts;
  const result = new Date(0);
  result.setHours(0, 0, 0, 0);
  result.setFullYear(year, month - 1, day);
  // setFullYear normalizes impossible dates (e.g. February 31st). Reject them.
  if (
    result.getFullYear() !== year ||
    result.getMonth() !== month - 1 ||
    result.getDate() !== day
  ) {
    return null;
  }
  return result;
};

const dateKeyFromDate = (value: Date): string => {
  if (Number.isNaN(value.getTime())) {
    throw new RangeError('Invalid date.');
  }
  const year = String(value.getFullYear()).padStart(4, '0');
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const inputToDate = (value: LocalDateInput): Date => {
  if (value instanceof Date) {
    return new Date(value.getTime());
  }
  if (typeof value === 'number') {
    return new Date(value);
  }
  if (DATE_KEY.test(value)) {
    const parsed = localDateFromKey(value);
    if (!parsed) {
      throw new RangeError(`Invalid calendar date: ${value}`);
    }
    return parsed;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new RangeError(`Invalid date: ${value}`);
  }
  return parsed;
};

const tryLocalDateKey = (value: unknown): string | null => {
  if (typeof value === 'string' && DATE_KEY.test(value)) {
    return localDateFromKey(value) ? value : null;
  }
  if (value instanceof Date || typeof value === 'number') {
    try {
      return localDateKey(value);
    } catch {
      return null;
    }
  }
  if (typeof value === 'string') {
    try {
      return localDateKey(value);
    } catch {
      return null;
    }
  }
  return null;
};

/**
 * Returns the local calendar date as ISO `YYYY-MM-DD`.
 *
 * A date-only string is interpreted as a local calendar date. Date-times and
 * timestamps are converted using the device's local time zone.
 */
export function localDateKey(value: LocalDateInput = new Date()): ScheduleDate {
  return dateKeyFromDate(inputToDate(value));
}

/** Adds calendar days in local time and returns another local date key. */
export function addCalendarDays(
  value: LocalDateInput,
  days: number,
): ScheduleDate {
  if (!Number.isInteger(days)) {
    throw new RangeError('Calendar days must be whole numbers.');
  }
  const date = inputToDate(value);
  date.setHours(12, 0, 0, 0);
  date.setDate(date.getDate() + days);
  return localDateKey(date);
}

/** Returns the Monday of the local week containing the given date. */
export function startOfWeek(value: LocalDateInput): ScheduleDate {
  const date = inputToDate(value);
  const mondayOffset = (date.getDay() + 6) % 7;
  return addCalendarDays(localDateKey(date), -mondayOffset);
}

// Stored as the session title when none is given, so the German values stay
// as persisted data (ground rule 4). Show them through `scheduleTitle`.
const defaultTitle = (kind: ScheduleKind): string =>
  kind === 'strength' ? 'Krafttraining' : 'Lauf';

/**
 * Visible title of a schedule entry. A stored German default shows the
 * localized default; a title the user typed is shown as it is.
 */
export function scheduleTitle(entry: { title: string }): string {
  switch (entry.title) {
    case 'Krafttraining':
      return tr('Krafttraining', 'Strength training');
    case 'Lauf':
      return tr('Lauf', 'Run');
    default:
      return entry.title;
  }
}

const normalizeKind = (value: unknown): ScheduleKind =>
  value === 'strength' ? 'strength' : 'run';

const normalizeSession = (raw: unknown): ScheduledSession | null => {
  if (!isRecord(raw) || !nonEmptyString(raw.id)) {
    return null;
  }
  const date = tryLocalDateKey(raw.date);
  if (!date) {
    return null;
  }
  const kind = normalizeKind(raw.kind);
  const session: ScheduledSession = {
    id: raw.id.trim(),
    date,
    title: nonEmptyString(raw.title) ? raw.title.trim() : defaultTitle(kind),
    kind,
    status: raw.status === 'skipped' ? 'skipped' : 'planned',
  };
  if (kind === 'run' && PURPOSES.includes(raw.purpose as RunPurpose)) {
    session.purpose = raw.purpose as RunPurpose;
  }
  if (kind === 'strength' && nonEmptyString(raw.templateId)) {
    session.templateId = raw.templateId.trim();
  }
  return session;
};

const normalizeWeekly = (raw: Record<string, unknown>): WeeklyPlan => {
  const seen = new Set<string>();
  const strength: WeeklyPlan['strength'] = [];
  for (const entry of Array.isArray(raw.strength) ? raw.strength : []) {
    if (!isRecord(entry) || !nonEmptyString(entry.templateId)) continue;
    const templateId = entry.templateId.trim();
    const days = sortDays(entry.days);
    if (!days.length || seen.has(templateId)) continue;
    seen.add(templateId);
    strength.push({ templateId, days });
  }
  return { run: sortDays(raw.run), strength };
};

const normalizeGoal = (raw: unknown): ScheduleGoal | undefined => {
  if (!isRecord(raw) || !nonEmptyString(raw.name)) return undefined;
  const startDate = tryLocalDateKey(raw.startDate);
  if (!startDate) return undefined;
  const goal: ScheduleGoal = { name: raw.name.trim(), startDate };
  const targetDate = tryLocalDateKey(raw.targetDate);
  if (targetDate) goal.targetDate = targetDate;
  if (nonEmptyString(raw.phase)) goal.phase = raw.phase.trim();
  if (finiteNumber(raw.distanceKm) && raw.distanceKm > 0)
    goal.distanceKm = raw.distanceKm;
  if (finiteNumber(raw.targetSeconds) && raw.targetSeconds > 0)
    goal.targetSeconds = Math.round(raw.targetSeconds);
  return goal;
};

const compareSessions = (a: ScheduledSession, b: ScheduledSession): number =>
  a.date.localeCompare(b.date) || a.id.localeCompare(b.id);

/**
 * Normalizes persisted JSON. Unknown or malformed entries are ignored so an
 * old or broken optional calendar cannot keep the rest of the app from opening.
 */
export function normalizeSchedule(raw: unknown = undefined): ScheduleState {
  const value = isRecord(raw) ? raw : {};
  const sessions: ScheduledSession[] = [];
  const ids = new Set<string>();
  for (const rawSession of Array.isArray(value.sessions)
    ? value.sessions
    : []) {
    const session = normalizeSession(rawSession);
    if (!session || ids.has(session.id)) continue;
    ids.add(session.id);
    sessions.push(session);
  }
  sessions.sort(compareSessions);
  const changedDays = Array.from(
    new Set(
      (Array.isArray(value.changedDays) ? value.changedDays : [])
        .map(tryLocalDateKey)
        .filter((date): date is string => Boolean(date)),
    ),
  ).sort();
  const history: WeeklySnapshot[] = [];
  for (const entry of Array.isArray(value.weeklyHistory)
    ? value.weeklyHistory
    : []) {
    if (!isRecord(entry)) continue;
    const since = tryLocalDateKey(entry.since);
    if (!since) continue;
    // One snapshot per day; the later one in the list wins.
    const index = history.findIndex(snapshot => snapshot.since === since);
    const snapshot = { since, ...normalizeWeekly(entry) };
    if (index >= 0) history[index] = snapshot;
    else history.push(snapshot);
  }
  history.sort((a, b) => a.since.localeCompare(b.since));
  const state: ScheduleState = {
    version: SCHEDULE_VERSION,
    sessions,
    changedDays,
    runDays: sortDays(value.runDays),
    weeklyHistory: history,
  };
  const goal = normalizeGoal(value.goal);
  if (goal) state.goal = goal;
  return state;
}

/** Sunday-based weekdays of `Date.getDay` (templates) to Monday-based ones. */
export const mondayDay = (sundayDay: number): number => (sundayDay + 6) % 7;

/** Monday-based weekday of a date key. */
export function weekdayOf(date: ScheduleDate): number {
  return mondayDay(inputToDate(date).getDay());
}

/** The weekly plan as it is set right now. */
export function currentWeekly(
  state: ScheduleState,
  templates: Pick<WorkoutTemplate, 'id' | 'days'>[],
): WeeklyPlan {
  return {
    run: [...state.runDays],
    strength: templates
      .map(template => ({
        templateId: template.id,
        days: sortDays(template.days.map(mondayDay)),
      }))
      .filter(entry => entry.days.length),
  };
}

// Template order does not change the plan.
const weeklyKey = (plan: WeeklyPlan): string => {
  const normalized = normalizeWeekly(
    plan as unknown as Record<string, unknown>,
  );
  return JSON.stringify({
    run: normalized.run,
    strength: [...normalized.strength].sort((a, b) =>
      a.templateId.localeCompare(b.templateId),
    ),
  });
};
const sameWeekly = (a: WeeklyPlan, b: WeeklyPlan): boolean =>
  weeklyKey(a) === weeklyKey(b);

/**
 * Notes the weekly plan in effect from `today` on, so past days keep theirs.
 * Unchanged plans return the same state; a second change on the same day
 * replaces that day's snapshot.
 */
export function recordWeekly(
  state: ScheduleState,
  weekly: WeeklyPlan,
  today: LocalDateInput = new Date(),
): ScheduleState {
  const since = localDateKey(today);
  const history = state.weeklyHistory.filter(
    snapshot => snapshot.since <= since,
  );
  const latest = history[history.length - 1];
  if (latest && sameWeekly(latest, weekly)) {
    return history.length === state.weeklyHistory.length
      ? state
      : { ...state, weeklyHistory: history };
  }
  // Nothing planned weekly and nothing before: there is nothing to keep.
  if (!latest && !weekly.run.length && !weekly.strength.length) return state;
  const snapshot: WeeklySnapshot = {
    since,
    ...normalizeWeekly(weekly as unknown as Record<string, unknown>),
  };
  return {
    ...state,
    weeklyHistory: [
      ...history.filter(entry => entry.since !== since),
      snapshot,
    ],
  };
}

/**
 * Weekly plan for a date: from today on the current one, before that the
 * snapshot in effect then. Before the first snapshot, nothing was planned.
 */
export function weeklyFor(
  state: ScheduleState,
  current: WeeklyPlan,
  date: ScheduleDate,
  today: ScheduleDate,
): WeeklyPlan | undefined {
  if (date >= today) return current;
  let found: WeeklySnapshot | undefined;
  for (const snapshot of state.weeklyHistory) {
    if (snapshot.since <= date) found = snapshot;
  }
  return found;
}

/** One planned workout on one day. */
export interface PlannedItem {
  /** Stable within the day; the session ID for a changed day. */
  key: string;
  kind: ScheduleKind;
  templateId?: string;
  /** Stored title of a changed day; weekly items take the live name. */
  title?: string;
  purpose?: RunPurpose;
  fromWeekly: boolean;
}

/** Whether the day was edited by hand and the weekly plan does not apply. */
export function isChangedDay(
  state: ScheduleState,
  date: ScheduleDate,
): boolean {
  return (
    state.changedDays.includes(date) ||
    state.sessions.some(session => session.date === date)
  );
}

/**
 * What is planned on a date: the day's own sessions if it was changed,
 * otherwise the weekly plan in effect then. Runs come first, then strength in
 * the order of the templates.
 */
export function plannedOn(
  state: ScheduleState,
  current: WeeklyPlan,
  date: ScheduleDate,
  today: ScheduleDate,
): PlannedItem[] {
  if (isChangedDay(state, date)) {
    return state.sessions
      .filter(session => session.date === date && session.status === 'planned')
      .map(session => ({
        key: session.id,
        kind: session.kind,
        templateId: session.templateId,
        title: session.title,
        purpose: session.purpose,
        fromWeekly: false,
      }));
  }
  const weekly = weeklyFor(state, current, date, today);
  if (!weekly) return [];
  const day = weekdayOf(date);
  return [
    ...(weekly.run.includes(day)
      ? [{ key: 'weekly-run', kind: 'run' as const, fromWeekly: true }]
      : []),
    ...weekly.strength
      .filter(entry => entry.days.includes(day))
      .map(entry => ({
        key: `weekly-${entry.templateId}`,
        kind: 'strength' as const,
        templateId: entry.templateId,
        fromWeekly: true,
      })),
  ];
}

/** A workout to plan on a day: a run, or strength with or without template. */
export interface DayPlanEntry {
  kind: ScheduleKind;
  templateId?: string;
  /** Kept as fallback title if the template disappears. */
  title?: string;
  purpose?: RunPurpose;
}

/**
 * Sets exactly what is planned on one day, from today on; the past stays as it
 * was. The day is then a changed day, also when the list is empty ("nothing
 * this day").
 */
export function setDayPlan(
  state: ScheduleState,
  date: ScheduleDate,
  entries: DayPlanEntry[],
  today: ScheduleDate,
): ScheduleState {
  if (!localDateFromKey(date) || date < today) return state;
  const sessions: ScheduledSession[] = entries.map((entry, index) => {
    const session: ScheduledSession = {
      id: `${date}-${index + 1}`,
      date,
      title: entry.title?.trim() || defaultTitle(entry.kind),
      kind: entry.kind,
      status: 'planned',
    };
    if (entry.kind === 'run' && entry.purpose) session.purpose = entry.purpose;
    if (entry.kind === 'strength' && entry.templateId)
      session.templateId = entry.templateId;
    return session;
  });
  return {
    ...state,
    sessions: [
      ...state.sessions.filter(session => session.date !== date),
      ...sessions,
    ].sort(compareSessions),
    changedDays: Array.from(new Set([...state.changedDays, date])).sort(),
  };
}

/** Lets the weekly plan apply to a day again, from today on. */
export function resetDay(
  state: ScheduleState,
  date: ScheduleDate,
  today: ScheduleDate,
): ScheduleState {
  if (date < today || !isChangedDay(state, date)) return state;
  return {
    ...state,
    sessions: state.sessions.filter(session => session.date !== date),
    changedDays: state.changedDays.filter(day => day !== date),
  };
}

/** Sets the weekly run days (Monday 0 to Sunday 6). */
export function setRunDays(
  state: ScheduleState,
  days: number[],
): ScheduleState {
  return { ...state, runDays: sortDays(days) };
}
