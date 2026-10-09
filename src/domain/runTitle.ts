/**
 * Run titles for the UI.
 *
 * Imported runs often carry a file name (`activity_1234567.fit`) or a provider
 * placeholder ("Garmin Lauf") as their name. Neither says anything about the
 * run. `runTitle` is the only source of run titles and picks, in this order:
 *
 * 1. a meaningful name from the source,
 * 2. the run type, once it is set,
 * 3. the time of day the run started.
 *
 * See docs/design-language.md, section "Numbers".
 */
import { tr } from './i18n';
import type { RunPurpose, Sport } from './types';
import { sportWords, type SportWords } from './sport';

export interface RunPurposeOption {
  value: RunPurpose;
  readonly label: string;
  readonly description: string;
}

// Getters keep the texts in the active language at read time.
/**
 * Run types to choose from. "Not set yet" (`unknown`) is not a choice but the
 * state until the user says something; it shows as "Just run" instead.
 * The values stay the same so stored runs and the watch remain valid.
 */
export const RUN_PURPOSES: RunPurposeOption[] = [
  {
    value: 'free',
    get label() {
      return tr('Einfach laufen', 'Just run');
    },
    get description() {
      return tr(
        'Ohne Vorgabe — das Tempo wird nicht bewertet',
        'No target — pace is not rated',
      );
    },
  },
  {
    value: 'easy',
    get label() {
      return tr('Ruhig', 'Easy');
    },
    get description() {
      return tr(
        'Entspannt, du könntest dabei reden',
        'Relaxed — you could talk while running',
      );
    },
  },
  {
    value: 'long',
    get label() {
      return tr('Lange Runde', 'Long run');
    },
    get description() {
      return tr(
        'Länger als sonst, in ruhigem Tempo',
        'Longer than usual, at an easy pace',
      );
    },
  },
  {
    value: 'intervals',
    get label() {
      return tr('Tempowechsel', 'Pace changes');
    },
    get description() {
      return tr(
        'Schnelle Stücke mit Pausen dazwischen',
        'Fast stretches with rests in between',
      );
    },
  },
  {
    value: 'race',
    get label() {
      return tr('Auf Zeit', 'Time trial');
    },
    get description() {
      return tr(
        'So schnell es heute geht — Wettkampf oder deine Hausrunde',
        'As fast as today allows — a race or your usual loop',
      );
    },
  },
];

const PURPOSE_VALUES: RunPurpose[] = [
  'free',
  'easy',
  'long',
  'intervals',
  'race',
  'unknown',
];

// A function: the labels depend on the active language.
const purposeLabels = (): Record<RunPurpose, string> => ({
  free: tr('Einfach laufen', 'Just run'),
  easy: tr('Ruhig', 'Easy'),
  long: tr('Lange Runde', 'Long run'),
  intervals: tr('Tempowechsel', 'Pace changes'),
  race: tr('Auf Zeit', 'Time trial'),
  unknown: tr('Noch offen', 'Not set yet'),
});

/** As a run title a bare adjective sounds odd ("Easy"). */
const purposeTitles = (): Partial<Record<RunPurpose, string>> => ({
  easy: tr('Ruhige Runde', 'Easy run'),
});

export function purposeLabel(value: RunPurpose | undefined): string {
  return (value && purposeLabels()[value]) || tr('Lauf', 'Run');
}

/** Older watch versions write `quality` or `interval` for pace changes. */
export function normalizePurpose(value: unknown): RunPurpose {
  if (value === 'quality' || value === 'interval') return 'intervals';
  return typeof value === 'string' &&
    PURPOSE_VALUES.includes(value as RunPurpose)
    ? (value as RunPurpose)
    : 'unknown';
}

/** Value for the picker: "Not set yet" shows there as "Just run". */
export function selectablePurpose(value: RunPurpose | undefined): RunPurpose {
  return !value || value === 'unknown' ? 'free' : value;
}

/** A run type that says something about the run — "free" and "open" do not. */
export function hasNamedPurpose(purpose: RunPurpose | undefined): boolean {
  return purpose !== undefined && purpose !== 'unknown' && purpose !== 'free';
}

// Names that carry no information. The German entries stay because existing
// runs may have been imported with them; the English ones are the same idea,
// written by imports made while the app was in English.
const GENERIC_NAMES = new Set([
  'lauf',
  'laufen',
  'laufband',
  'run',
  'running',
  'afternoon run',
  'evening run',
  'night run',
  'activity',
  'aktivitat',
  'workout',
  'training',
  'untitled',
  'unbenannt',
  'export',
  'track',
  'importierter lauf',
  'apple health lauf',
  'garmin lauf',
  'google fit lauf',
  'mi fitness lauf',
  'google health lauf',
  'garmin run',
  'apple health run',
  'google fit run',
  'mi fitness run',
  'samsung health run',
  'mi fitness activity',
  'outdoor run',
  'treadmill run',
  'outdoor lauf',
  'treadmill laufen',
  'runback activity',
  'lauf am morgen',
  'lauf am vormittag',
  'lauf am mittag',
  'lauf am nachmittag',
  'lauf am abend',
  'lauf in der nacht',
]);

// Folds umlauts so German and English names compare the same way.
const normalize = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/[äöüß]/g, m => ({ ä: 'a', ö: 'o', ü: 'u', ß: 'ss' }[m] as string))
    .replace(/\s+/g, ' ');

/**
 * Detects technical names: file names, IDs, timestamps and the provider
 * placeholders. Only what a person could have typed survives.
 */
export function isMeaningfulRunName(raw: string | undefined): boolean {
  const name = (raw || '').trim();
  if (name.length < 3 || name.length > 120) {
    return false;
  }
  if (!/\p{L}/u.test(name)) {
    return false;
  }
  if (GENERIC_NAMES.has(normalize(name))) {
    return false;
  }
  // Long digit runs are IDs or timestamps, not titles.
  if (/\d{6,}/.test(name)) {
    return false;
  }
  // ISO timestamps and date file names: 2024-05-01, 2024_05_01T07-00-00.
  if (/\d{4}[-_.]\d{2}[-_.]\d{2}/.test(name)) {
    return false;
  }
  // UUIDs.
  if (/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}/i.test(name)) {
    return false;
  }
  // File-name look: no spaces, but underscores/dots and digits.
  if (!/\s/.test(name) && /[_.]/.test(name) && /\d/.test(name)) {
    return false;
  }
  return true;
}

const DAY_PARTS: {
  fromHour: number;
  part: keyof SportWords['dayParts'];
}[] = [
  { fromHour: 22, part: 'night' },
  { fromHour: 18, part: 'evening' },
  { fromHour: 14, part: 'afternoon' },
  { fromHour: 12, part: 'noon' },
  { fromHour: 10, part: 'forenoon' },
  { fromHour: 5, part: 'morning' },
];

export function dayPartTitle(startTime: number, sport?: Sport): string {
  const words = sportWords(sport);
  if (!Number.isFinite(startTime) || startTime <= 0) {
    return words.noun;
  }
  const hour = new Date(startTime).getHours();
  const part =
    DAY_PARTS.find(candidate => hour >= candidate.fromHour)?.part || 'night';
  return words.dayParts[part];
}

export function runTitle(run: {
  name?: string;
  startTime: number;
  purpose?: RunPurpose;
  sport?: Sport;
}): string {
  if (isMeaningfulRunName(run.name)) {
    return (run.name as string).trim();
  }
  if (hasNamedPurpose(run.purpose)) {
    return purposeTitles()[run.purpose!] ?? purposeLabel(run.purpose);
  }
  return dayPartTitle(run.startTime, run.sport);
}
