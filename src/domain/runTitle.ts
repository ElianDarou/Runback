/**
 * Lauftitel für die Oberfläche.
 *
 * Importierte Läufe tragen häufig einen Dateinamen (`activity_1234567.fit`) oder
 * einen Platzhalter des Anbieters („Garmin Lauf“) als Namen. Beides sagt nichts
 * über den Lauf aus. `runTitle` ist die einzige Quelle für Lauftitel und wählt in
 * dieser Reihenfolge:
 *
 * 1. einen sprechenden Namen aus der Quelle,
 * 2. die Laufart, sobald sie festgelegt ist,
 * 3. die Tageszeit des Starts.
 *
 * Siehe docs/design-language.md, Abschnitt „Zahlen“.
 */
import type { RunPurpose, Sport } from './types';
import { sportWords, type SportWords } from './sport';

export interface RunPurposeOption {
  value: RunPurpose;
  label: string;
  description: string;
}

/**
 * Laufarten zur Auswahl. „Offen“ (`unknown`) ist keine Wahl, sondern der
 * Zustand, bis der Nutzer etwas angibt; er sieht dafür „Einfach laufen“.
 * Die Werte bleiben gleich, damit gespeicherte Läufe und die Uhr gültig bleiben.
 */
export const RUN_PURPOSES: RunPurposeOption[] = [
  {
    value: 'free',
    label: 'Einfach laufen',
    description: 'Ohne Vorgabe — das Tempo wird nicht bewertet',
  },
  {
    value: 'easy',
    label: 'Ruhig',
    description: 'Entspannt, du könntest dabei reden',
  },
  {
    value: 'long',
    label: 'Lange Runde',
    description: 'Länger als sonst, in ruhigem Tempo',
  },
  {
    value: 'intervals',
    label: 'Tempowechsel',
    description: 'Schnelle Stücke mit Pausen dazwischen',
  },
  {
    value: 'race',
    label: 'Auf Zeit',
    description: 'So schnell es heute geht — Wettkampf oder deine Hausrunde',
  },
];

const PURPOSE_LABELS: Record<RunPurpose, string> = {
  free: 'Einfach laufen',
  easy: 'Ruhig',
  long: 'Lange Runde',
  intervals: 'Tempowechsel',
  race: 'Auf Zeit',
  unknown: 'Noch offen',
};

/** Als Lauftitel klingt ein Adjektiv allein seltsam („Ruhig“). */
const PURPOSE_TITLES: Partial<Record<RunPurpose, string>> = {
  easy: 'Ruhige Runde',
};

export function purposeLabel(value: RunPurpose | undefined): string {
  return (value && PURPOSE_LABELS[value]) || 'Lauf';
}

/** Ältere Uhr-Versionen schreiben `quality` oder `interval` für Tempowechsel. */
export function normalizePurpose(value: unknown): RunPurpose {
  if (value === 'quality' || value === 'interval') return 'intervals';
  return typeof value === 'string' && value in PURPOSE_LABELS
    ? (value as RunPurpose)
    : 'unknown';
}

/** Wert für die Auswahl: „Noch offen“ erscheint dort als „Einfach laufen“. */
export function selectablePurpose(value: RunPurpose | undefined): RunPurpose {
  return !value || value === 'unknown' ? 'free' : value;
}

/** Eine Laufart, die etwas über den Lauf aussagt — „frei“ und „offen“ tun das nicht. */
export function hasNamedPurpose(purpose: RunPurpose | undefined): boolean {
  return purpose !== undefined && purpose !== 'unknown' && purpose !== 'free';
}

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

const normalize = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/[äöüß]/g, m => ({ ä: 'a', ö: 'o', ü: 'u', ß: 'ss' }[m] as string))
    .replace(/\s+/g, ' ');

/**
 * Erkennt technische Namen: Dateinamen, IDs, Zeitstempel und die Platzhalter der
 * Anbieter. Nur was ein Mensch geschrieben haben könnte, überlebt.
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
  // Lange Ziffernfolgen sind IDs oder Zeitstempel, keine Titel.
  if (/\d{6,}/.test(name)) {
    return false;
  }
  // ISO-Zeitstempel und Datumsdateinamen: 2024-05-01, 2024_05_01T07-00-00.
  if (/\d{4}[-_.]\d{2}[-_.]\d{2}/.test(name)) {
    return false;
  }
  // UUIDs.
  if (/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}/i.test(name)) {
    return false;
  }
  // Dateinamen-Optik: keine Leerzeichen, aber Unterstriche/Punkte und Ziffern.
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
    return PURPOSE_TITLES[run.purpose!] ?? purposeLabel(run.purpose);
  }
  return dayPartTitle(run.startTime, run.sport);
}
