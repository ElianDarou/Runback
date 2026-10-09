/**
 * Sport of a recording.
 *
 * A recording is first of all just that: time, distance, sensors. The sport
 * says how to read it. Running is the default — older records without the field
 * stay runs and are neither migrated nor evaluated differently. Analyses that
 * only apply to runs (pace, focus, weekly kilometers) do not appear for other
 * sports instead of showing wrong numbers.
 */
import { tr } from './i18n';
import type { Sport } from './types';

export interface SportOption {
  value: Sport;
  readonly label: string;
}

// Labels are getters so they follow the active language at read time.
export const SPORTS: SportOption[] = [
  {
    value: 'running',
    get label() {
      return tr('Laufen', 'Running');
    },
  },
  {
    value: 'cycling',
    get label() {
      return tr('Radfahren', 'Cycling');
    },
  },
];

export const DEFAULT_SPORT: Sport = 'running';

/** Unknown or missing values count as a run. */
export function normalizeSport(value: unknown): Sport {
  return SPORTS.some(option => option.value === value)
    ? (value as Sport)
    : DEFAULT_SPORT;
}

/** Only runs carry pace, focus and kilometer analyses. */
export function isRun(record: { sport?: Sport }): boolean {
  return normalizeSport(record.sport) === 'running';
}

/** Words that change with the sport in the UI. */
export interface SportWords {
  /** "Running" — choice and filter. */
  label: string;
  /** "Run" — a single recording. */
  noun: string;
  /** "Runs" */
  plural: string;
  /** "Duration" — time spent on the activity. */
  durationLabel: string;
  /** "Run feel" — the perceived effort field. */
  feelingLabel: string;
  /** "Keep running" — cancels the prompt to end. */
  continueLabel: string;
  /** Titles by time of day, same order as DAY_PARTS in runTitle.ts. */
  dayParts: {
    night: string;
    evening: string;
    afternoon: string;
    noon: string;
    forenoon: string;
    morning: string;
  };
}

// A function, not a constant: the texts depend on the active language.
const words = (): Record<Sport, SportWords> => ({
  running: {
    label: tr('Laufen', 'Running'),
    noun: tr('Lauf', 'Run'),
    plural: tr('Läufe', 'Runs'),
    durationLabel: tr('Laufzeit', 'Duration'),
    feelingLabel: tr('Laufgefühl', 'Run feel'),
    continueLabel: tr('Weiterlaufen', 'Keep running'),
    dayParts: {
      night: tr('Nachtlauf', 'Night run'),
      evening: tr('Abendlauf', 'Evening run'),
      afternoon: tr('Nachmittagslauf', 'Afternoon run'),
      noon: tr('Mittagslauf', 'Midday run'),
      forenoon: tr('Vormittagslauf', 'Late morning run'),
      morning: tr('Morgenlauf', 'Morning run'),
    },
  },
  cycling: {
    label: tr('Radfahren', 'Cycling'),
    noun: tr('Radfahrt', 'Ride'),
    plural: tr('Radfahrten', 'Rides'),
    durationLabel: tr('Fahrzeit', 'Ride time'),
    feelingLabel: tr('Fahrgefühl', 'Ride feel'),
    continueLabel: tr('Weiterfahren', 'Keep riding'),
    dayParts: {
      night: tr('Nachtfahrt', 'Night ride'),
      evening: tr('Abendfahrt', 'Evening ride'),
      afternoon: tr('Nachmittagsfahrt', 'Afternoon ride'),
      noon: tr('Mittagsfahrt', 'Midday ride'),
      forenoon: tr('Vormittagsfahrt', 'Late morning ride'),
      morning: tr('Morgenfahrt', 'Morning ride'),
    },
  },
});

export function sportWords(sport: Sport | undefined): SportWords {
  return words()[normalizeSport(sport)];
}

export function sportLabel(sport: Sport | undefined): string {
  return sportWords(sport).label;
}

/** "Run" or "Ride" — the name of a single recording. */
export function sportNoun(sport: Sport | undefined): string {
  return sportWords(sport).noun;
}

/**
 * Runs are read in min/km, rides in km/h. Both are the same measurement, just
 * inverted — so the sport decides, not the number.
 */
export function usesPace(sport: Sport | undefined): boolean {
  return normalizeSport(sport) === 'running';
}

/** Average speed in km/h; `null` without a usable distance or time. */
export function speedKmh(record: {
  distanceMeters: number;
  durationSeconds: number;
}): number | null {
  if (
    !Number.isFinite(record.distanceMeters) ||
    !Number.isFinite(record.durationSeconds) ||
    record.distanceMeters < 20 ||
    record.durationSeconds <= 0
  ) {
    return null;
  }
  return record.distanceMeters / 1000 / (record.durationSeconds / 3600);
}

/** Under 60 s and under 100 m: started by accident, not training (a setting). */
export const ACCIDENTAL_MAX_SECONDS = 60;
export const ACCIDENTAL_MAX_METERS = 100;
/**
 * False start: the recording stays saved but counts neither in history, volume
 * nor load. Both limits must be undercut — a short sprint over 100 m or standing
 * still for over a minute is not a false start.
 */
export function isAccidentalRun(record: {
  durationSeconds: number;
  distanceMeters: number;
}): boolean {
  return (
    Number.isFinite(record.durationSeconds) &&
    Number.isFinite(record.distanceMeters) &&
    record.durationSeconds < ACCIDENTAL_MAX_SECONDS &&
    record.distanceMeters < ACCIDENTAL_MAX_METERS
  );
}
export type RunValidity = 'valid' | 'accidental';
export function runValidity(record: {
  durationSeconds: number;
  distanceMeters: number;
}): RunValidity {
  return isAccidentalRun(record) ? 'accidental' : 'valid';
}
