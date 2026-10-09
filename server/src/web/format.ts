import type { Run } from '../../../src/domain/trainingRecords';
import { formatPace } from '../../../src/domain/runSeries';
import { speedKmh, usesPace } from '../../../src/domain/sport';
import {
  isSetCompleted,
  type StrengthSession,
} from '../../../src/domain/strength';
import type { Translator } from './i18n';

/**
 * Numbers and dates as in the app: German or English format for the response
 * language, „–“ for unknown values, never an invented zero. Dates and times use
 * the server's time zone (`TZ`, Europe/Berlin in the container by default).
 */

export const DASH = '–';

const dateFormats = new Map<string, Intl.DateTimeFormat>();
const numberFormats = new Map<string, Intl.NumberFormat>();

function dateFormat(locale: string, options: Intl.DateTimeFormatOptions) {
  const key = `${locale}|${JSON.stringify(options)}`;
  let format = dateFormats.get(key);
  if (!format) {
    format = new Intl.DateTimeFormat(locale, options);
    dateFormats.set(key, format);
  }
  return format;
}

export function numberFormat(
  tx: Translator,
  options: Intl.NumberFormatOptions = {},
): Intl.NumberFormat {
  const key = `${tx.locale}|${JSON.stringify(options)}`;
  let format = numberFormats.get(key);
  if (!format) {
    format = new Intl.NumberFormat(tx.locale, options);
    numberFormats.set(key, format);
  }
  return format;
}

export const decimal = (tx: Translator, value: number, digits = 1) => {
  const text = value.toFixed(digits);
  return tx.lang === 'de' ? text.replace('.', ',') : text;
};

/** Count with the matching singular or plural; the caller gives both per language. */
export const counted = (
  tx: Translator,
  count: number,
  de: [singular: string, plural: string],
  en: [singular: string, plural: string],
) => {
  const [singular, plural] = tx.lang === 'en' ? en : de;
  return `${count} ${count === 1 ? singular : plural}`;
};

export const formatDuration = (seconds: number) => {
  const whole = Math.max(0, Math.round(seconds));
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  return hours ? `${hours} h ${minutes} min` : `${minutes} min`;
};

/** „24:12“ or „1:04:30“. */
export const formatClock = (seconds: number) => {
  const whole = Math.max(0, Math.round(seconds));
  const h = Math.floor(whole / 3600);
  const m = Math.floor((whole % 3600) / 60);
  const s = whole % 60;
  return h
    ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${m}:${String(s).padStart(2, '0')}`;
};

export const km = (tx: Translator, meters: number, digits = 2) =>
  decimal(tx, meters / 1000, digits);

export const day = (tx: Translator, at: number) =>
  dateFormat(tx.locale, {
    weekday: 'short',
    day: '2-digit',
    month: '2-digit',
  }).format(new Date(at));
export const date = (tx: Translator, at: number) =>
  dateFormat(tx.locale, {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(new Date(at));
export const dayMonth = (tx: Translator, at: number) =>
  dateFormat(tx.locale, {
    day: '2-digit',
    month: '2-digit',
  }).format(new Date(at));
export const clock = (tx: Translator, at: number) =>
  dateFormat(tx.locale, {
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(at));
export const longDate = (tx: Translator, at: number) =>
  dateFormat(tx.locale, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(new Date(at));

/** Pace for running, speed for other sports, as in the app. */
export function tempo(
  tx: Translator,
  run: Run,
): { value: string; unit: string } {
  if (usesPace(run.sport)) {
    if (run.distanceMeters < 20 || run.durationSeconds <= 0)
      return { value: DASH, unit: 'min / km' };
    const seconds = run.time?.movingSeconds ?? run.durationSeconds;
    return {
      value: formatPace(seconds / (run.distanceMeters / 1000)),
      unit: 'min / km',
    };
  }
  const speed = speedKmh(run);
  return {
    value: speed === null ? DASH : decimal(tx, speed),
    unit: 'km/h',
  };
}

export function completedSets(session: StrengthSession): number {
  return (session.exercises ?? []).reduce(
    (sum, exercise) =>
      sum +
      (exercise.sets ?? []).filter(set => isSetCompleted(set) && !set.skipped)
        .length,
    0,
  );
}

export function sessionSeconds(session: StrengthSession): number | null {
  return session.endTime && session.endTime > session.startTime
    ? Math.round((session.endTime - session.startTime) / 1000)
    : null;
}

/** „today, 18:04“, „yesterday, 07:12“ or a date. */
export function relative(tx: Translator, at: number, now: number): string {
  const startOfDay = (value: number) => {
    const d = new Date(value);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  };
  const days = Math.round((startOfDay(now) - startOfDay(at)) / 86_400_000);
  if (days === 0)
    return tx.t(`heute, ${clock(tx, at)}`, `today, ${clock(tx, at)}`);
  if (days === 1)
    return tx.t(`gestern, ${clock(tx, at)}`, `yesterday, ${clock(tx, at)}`);
  return `${date(tx, at)}, ${clock(tx, at)}`;
}

const finite = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

/** Weight without trailing zeros: „62,5“ in German, „62.5“ in English. */
export function weightText(tx: Translator, value: number): string {
  const rounded = Math.round(value * 100) / 100;
  return tx.lang === 'de' ? String(rounded).replace('.', ',') : String(rounded);
}

/** „80 kg × 8“, „8 Wdh.“ / „8 reps“, „45 s“ — or empty if nothing is given. */
export function setText(
  tx: Translator,
  set: { weightKg?: number; reps?: number; seconds?: number },
): string {
  if (finite(set.weightKg) && set.weightKg > 0 && finite(set.reps)) {
    return `${weightText(tx, set.weightKg)} kg × ${set.reps}`;
  }
  if (finite(set.reps) && set.reps > 0) {
    return tx.t(
      `${set.reps} Wdh.`,
      `${set.reps} ${set.reps === 1 ? 'rep' : 'reps'}`,
    );
  }
  if (finite(set.seconds) && set.seconds > 0) {
    return `${Math.round(set.seconds)} s`;
  }
  return '';
}
