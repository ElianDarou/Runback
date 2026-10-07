import type { Run } from '../../../src/native';
import { formatPace } from '../../../src/domain/runSeries';
import { speedKmh, usesPace } from '../../../src/domain/sport';
import {
  isSetCompleted,
  type StrengthSession,
} from '../../../src/domain/strength';

/**
 * Zahlen und Daten wie in der App: deutsches Format, „–“ für Unbekanntes,
 * nie eine erfundene Null. Datum und Uhrzeit in der Zeitzone des Servers
 * (`TZ`, im Container standardmäßig Europe/Berlin).
 */

export const DASH = '–';

export const decimal = (value: number, digits = 1) =>
  value.toFixed(digits).replace('.', ',');

export const counted = (count: number, singular: string, plural: string) =>
  `${count} ${count === 1 ? singular : plural}`;

export const formatDuration = (seconds: number) => {
  const whole = Math.max(0, Math.round(seconds));
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  return hours ? `${hours} h ${minutes} min` : `${minutes} min`;
};

/** „24:12“ oder „1:04:30“. */
export const formatClock = (seconds: number) => {
  const whole = Math.max(0, Math.round(seconds));
  const h = Math.floor(whole / 3600);
  const m = Math.floor((whole % 3600) / 60);
  const s = whole % 60;
  return h
    ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${m}:${String(s).padStart(2, '0')}`;
};

export const km = (meters: number, digits = 2) =>
  decimal(meters / 1000, digits);

const dayFormat = new Intl.DateTimeFormat('de-DE', {
  weekday: 'short',
  day: '2-digit',
  month: '2-digit',
});
const dateFormat = new Intl.DateTimeFormat('de-DE', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
});
const timeFormat = new Intl.DateTimeFormat('de-DE', {
  hour: '2-digit',
  minute: '2-digit',
});
const longDateFormat = new Intl.DateTimeFormat('de-DE', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
});

export const day = (at: number) => dayFormat.format(new Date(at));
export const date = (at: number) => dateFormat.format(new Date(at));
export const clock = (at: number) => timeFormat.format(new Date(at));
export const longDate = (at: number) => longDateFormat.format(new Date(at));

/** Tempo bei Läufen, Geschwindigkeit bei anderen Sportarten — wie in der App. */
export function tempo(run: Run): { value: string; unit: string } {
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
  return { value: speed === null ? DASH : decimal(speed), unit: 'km/h' };
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

/** „heute, 18:04“, „gestern, 07:12“ oder Datum. */
export function relative(at: number, now: number): string {
  const startOfDay = (value: number) => {
    const d = new Date(value);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  };
  const days = Math.round((startOfDay(now) - startOfDay(at)) / 86_400_000);
  if (days === 0) return `heute, ${clock(at)}`;
  if (days === 1) return `gestern, ${clock(at)}`;
  return `${date(at)}, ${clock(at)}`;
}
