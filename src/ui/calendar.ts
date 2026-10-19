import { getLanguage } from '../domain/i18n';
import { addCalendarDays, localDateKey, startOfWeek } from '../domain/schedule';

/**
 * Month grid helpers shared by Plan and the date range picker. Days are local
 * calendar keys (`YYYY-MM-DD`); labels are built per call because the language
 * can change at runtime.
 */

export const weekdayShort = () =>
  getLanguage() === 'en'
    ? ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
    : ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];

export const monthNames = () =>
  getLanguage() === 'en'
    ? [
        'January',
        'February',
        'March',
        'April',
        'May',
        'June',
        'July',
        'August',
        'September',
        'October',
        'November',
        'December',
      ]
    : [
        'Januar',
        'Februar',
        'März',
        'April',
        'Mai',
        'Juni',
        'Juli',
        'August',
        'September',
        'Oktober',
        'November',
        'Dezember',
      ];

export const dateOf = (key: string): Date => {
  const [year, month, day] = key.split('-').map(Number);
  return new Date(year, month - 1, day);
};

export const firstOfMonth = (key: string) => `${key.slice(0, 7)}-01`;

export const shiftMonth = (first: string, months: number): string => {
  const date = dateOf(first);
  return localDateKey(
    new Date(date.getFullYear(), date.getMonth() + months, 1),
  );
};

/** "Oktober 2026" / "October 2026". */
export const monthTitle = (first: string): string =>
  `${monthNames()[dateOf(first).getMonth()]} ${dateOf(first).getFullYear()}`;

/** The six or five weeks that show a month, Monday first. */
export function monthWeeks(first: string): string[][] {
  const start = startOfWeek(first);
  const next = shiftMonth(first, 1);
  const weeks: string[][] = [];
  for (let monday = start; monday < next; monday = addCalendarDays(monday, 7))
    weeks.push(Array.from({ length: 7 }, (_, i) => addCalendarDays(monday, i)));
  return weeks;
}

/** A chosen period of whole days; `end` is missing while only the first day is tapped. */
export interface DayRange {
  start: string;
  end?: string;
}

/**
 * One tap in the range picker: the first tap sets the start, the second the
 * end. A second tap before the start swaps the two, so the order of taps
 * doesn't matter. Tapping again after a full range starts a new one.
 */
export function pickRangeDay(range: DayRange | null, day: string): DayRange {
  if (!range || range.end) return { start: day };
  return day < range.start
    ? { start: day, end: range.start }
    : { start: range.start, end: day };
}

/** Where a day sits in the range, for drawing. */
export function rangePosition(
  range: DayRange | null,
  day: string,
): 'start' | 'end' | 'single' | 'inside' | undefined {
  if (!range) return undefined;
  const end = range.end ?? range.start;
  if (day === range.start && day === end) return 'single';
  if (day === range.start) return 'start';
  if (day === end) return 'end';
  return day > range.start && day < end ? 'inside' : undefined;
}
