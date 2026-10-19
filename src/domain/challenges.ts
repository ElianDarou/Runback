import { localDateKey } from './schedule';

export const CHALLENGES_VERSION = 1 as const;
export const CHALLENGE_MODEL_VERSION = 'challenges-v1';
export const MAX_CHALLENGE_COUNT = 1_000_000;
export interface ChallengeEntry {
  id: string;
  at: number;
  amount: number;
}
export interface ChallengeDay {
  date: string;
  /** Snapshot: later goal changes must not rewrite completed days. */
  target: number;
  entries: ChallengeEntry[];
}
export interface Challenge {
  id: string;
  name: string;
  target: number;
  steps: number[];
  archived: boolean;
  showOnHome: boolean;
  days: ChallengeDay[];
}
/** Manual entries are kept with the settings document, including backup/restore. */
export interface Challenges {
  version: typeof CHALLENGES_VERSION;
  items: Challenge[];
}
const record = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
export const validChallengeCount = (n: number) =>
  Number.isSafeInteger(n) && n > 0 && n <= MAX_CHALLENGE_COUNT;
const validDate = (s: unknown): s is string => {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const date = new Date(y, m - 1, d, 12);
  return localDateKey(date) === s;
};
export function challengeSteps(text: string): number[] | null {
  const parts = text.trim().split(/[,;\s]+/);
  if (!parts.length || parts.length > 5 || parts.some(s => !/^\d+$/.test(s)))
    return null;
  const steps = parts.map(Number);
  return steps.every(validChallengeCount) &&
    new Set(steps).size === steps.length
    ? steps
    : null;
}
export function normalizeChallenges(raw: unknown): Challenges {
  const items: Challenge[] = [];
  if (
    !record(raw) ||
    raw.version !== CHALLENGES_VERSION ||
    !Array.isArray(raw.items)
  )
    return { version: CHALLENGES_VERSION, items };
  const ids = new Set<string>();
  for (const item of raw.items) {
    if (
      !record(item) ||
      typeof item.id !== 'string' ||
      !item.id ||
      ids.has(item.id) ||
      typeof item.name !== 'string' ||
      !item.name.trim() ||
      !validChallengeCount(item.target as number)
    )
      continue;
    ids.add(item.id);
    const days: ChallengeDay[] = [];
    const dates = new Set<string>();
    const entryIds = new Set<string>();
    for (const day of Array.isArray(item.days) ? item.days : []) {
      if (
        !record(day) ||
        !validDate(day.date) ||
        dates.has(day.date) ||
        !validChallengeCount(day.target as number)
      )
        continue;
      dates.add(day.date);
      const entries: ChallengeEntry[] = [];
      for (const entry of Array.isArray(day.entries) ? day.entries : []) {
        if (
          !record(entry) ||
          typeof entry.id !== 'string' ||
          !entry.id ||
          entryIds.has(entry.id) ||
          typeof entry.at !== 'number' ||
          !Number.isFinite(entry.at) ||
          !Number.isFinite(new Date(entry.at).getTime()) ||
          !validChallengeCount(entry.amount as number)
        )
          continue;
        entryIds.add(entry.id);
        entries.push({
          id: entry.id,
          at: entry.at,
          amount: entry.amount as number,
        });
      }
      days.push({ date: day.date, target: day.target as number, entries });
    }
    const steps = Array.isArray(item.steps)
      ? challengeSteps(item.steps.join(','))
      : null;
    items.push({
      id: item.id,
      name: item.name.trim(),
      target: item.target as number,
      steps: steps ?? [1, 5, 10],
      archived: item.archived === true,
      showOnHome: item.showOnHome !== false,
      days,
    });
  }
  return { version: CHALLENGES_VERSION, items };
}
export function dayTotal(day?: ChallengeDay): number {
  return day?.entries.reduce((sum, entry) => sum + entry.amount, 0) ?? 0;
}
export function challengeDay(
  challenge: Challenge,
  date: string,
): ChallengeDay | undefined {
  return challenge.days.find(day => day.date === date);
}
export function addChallengeEntry(
  state: Challenges,
  id: string,
  amount: number,
  at: number,
  entryId: string,
): Challenges {
  if (
    !validChallengeCount(amount) ||
    !Number.isFinite(new Date(at).getTime()) ||
    !entryId
  )
    throw new Error('Invalid challenge entry');
  const date = localDateKey(new Date(at));
  return {
    ...state,
    items: state.items.map(item => {
      if (
        item.id !== id ||
        item.archived ||
        item.days.some(d => d.entries.some(e => e.id === entryId))
      )
        return item;
      const previous = challengeDay(item, date);
      const day: ChallengeDay = {
        date,
        target: previous?.target ?? item.target,
        entries: [...(previous?.entries ?? []), { id: entryId, at, amount }],
      };
      if (!Number.isSafeInteger(dayTotal(day)))
        throw new Error('Challenge total exceeds safe integer range');
      return {
        ...item,
        days: [...item.days.filter(d => d.date !== date), day],
      };
    }),
  };
}
export function removeChallengeEntry(
  state: Challenges,
  id: string,
  entryId: string,
): Challenges {
  return {
    ...state,
    items: state.items.map(item =>
      item.id !== id
        ? item
        : {
            ...item,
            days: item.days.map(day => ({
              ...day,
              entries: day.entries.filter(e => e.id !== entryId),
            })),
          },
    ),
  };
}
const previousDate = (key: string) => {
  const [y, m, d] = key.split('-').map(Number);
  return localDateKey(new Date(y, m - 1, d - 1, 12));
};
export function challengeStats(item: Challenge, today: string) {
  const days = item.days.filter(
    day => day.date <= today && day.entries.length > 0,
  );
  const completed = days
    .filter(day => dayTotal(day) >= day.target)
    .map(day => day.date)
    .sort();
  const completedSet = new Set(completed);
  let currentStreak = 0;
  // Today can still be completed; yesterday's streak remains visible until midnight.
  let cursor = completedSet.has(today) ? today : previousDate(today);
  while (completedSet.has(cursor)) {
    currentStreak++;
    cursor = previousDate(cursor);
  }
  let longestStreak = 0;
  let streak = 0;
  let previous = '';
  for (const date of completed) {
    streak = previous === previousDate(date) ? streak + 1 : 1;
    longestStreak = Math.max(longestStreak, streak);
    previous = date;
  }
  return {
    modelVersion: CHALLENGE_MODEL_VERSION,
    total: days.reduce((sum, day) => sum + dayTotal(day), 0),
    largestEntry: days.length
      ? days.reduce(
          (max, day) =>
            day.entries.reduce((n, entry) => Math.max(n, entry.amount), max),
          0,
        )
      : null,
    bestDay: days.length ? Math.max(...days.map(dayTotal)) : null,
    completedDays: completed.length,
    currentStreak,
    longestStreak,
  };
}
/** Each challenge remains separate; calendar cells never mix different activities. */
export function challengeCalendar(
  state: Challenges,
): Record<
  string,
  { id: string; name: string; total: number; target: number }[]
> {
  const dates: Record<
    string,
    { id: string; name: string; total: number; target: number }[]
  > = {};
  for (const item of state.items)
    for (const day of item.days) {
      if (!day.entries.length) continue;
      (dates[day.date] ??= []).push({
        id: item.id,
        name: item.name,
        total: dayTotal(day),
        target: day.target,
      });
    }
  return dates;
}
