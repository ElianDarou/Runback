import { VENDOR_INFOS } from './vendorImports';
import { locale, numberFormat, tr } from './i18n';

/**
 * Import in two steps: Kotlin first only reads the files and reports what
 * would be new (preview). The user chooses; only then is anything saved — as
 * one import that can later be deleted as a whole.
 */
export const IMPORT_CHOICE_VERSION = 'import-choice-v1';

export interface PreviewWorkout {
  id: string;
  time: number;
  name: string;
  source: string;
  sets: number;
  /** Reported duration; `null` if the file has none. */
  durationSeconds: number | null;
  /** Duration fits no set count; probably not finished (strong-duration-v1). */
  durationSuspect: boolean;
  incomplete: boolean;
}

export interface ImportPreview {
  runs: { new: number; duplicates: number; deleted: number };
  /** New context values per kind. */
  wellness: Record<string, number>;
  /** Context values already saved per kind; the import shares them when the kind is chosen. */
  wellnessKnown: Record<string, number>;
  strength: { duplicates: number; omitted: number; workouts: PreviewWorkout[] };
}

export interface ImportChoice {
  version: typeof IMPORT_CHOICE_VERSION;
  runs: boolean;
  strength: boolean;
  /** Chosen context kinds; missing kinds are not saved. */
  wellnessKinds: string[];
  excludedStrengthIds: string[];
  /** Suspicious durations the user keeps anyway. Otherwise the duration stays unknown. */
  keepDurationIds: string[];
  templateSuggestions: boolean;
}

const count = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : 0;

export function readImportPreview(raw: unknown): ImportPreview | null {
  if (!raw || typeof raw !== 'object') return null;
  const value = raw as Record<string, any>;
  const counts = (raw: unknown): Record<string, number> => {
    const result: Record<string, number> = {};
    if (raw && typeof raw === 'object')
      for (const [kind, n] of Object.entries(raw))
        if (count(n) > 0) result[kind] = count(n);
    return result;
  };
  const wellness = counts(value.wellness);
  const wellnessKnown = counts(value.wellnessKnown);
  const workouts: PreviewWorkout[] = Array.isArray(value.strength?.workouts)
    ? value.strength.workouts
        .filter(
          (item: any) =>
            item &&
            typeof item.id === 'string' &&
            Number.isFinite(item.time),
        )
        .map((item: any) => ({
          id: item.id,
          time: item.time,
          name: typeof item.name === 'string' ? item.name : '',
          source: typeof item.source === 'string' ? item.source : 'strong',
          sets: count(item.sets),
          durationSeconds:
            typeof item.durationSeconds === 'number' &&
            Number.isFinite(item.durationSeconds) &&
            item.durationSeconds > 0
              ? item.durationSeconds
              : null,
          durationSuspect: item.durationSuspect === true,
          incomplete: item.incomplete === true,
        }))
    : [];
  return {
    runs: {
      new: count(value.runs?.new),
      duplicates: count(value.runs?.duplicates),
      deleted: count(value.runs?.deleted),
    },
    wellness,
    wellnessKnown,
    strength: {
      duplicates: count(value.strength?.duplicates),
      omitted: count(value.strength?.omitted),
      workouts,
    },
  };
}

/**
 * Default: take everything; suspicious durations stay unknown. Areas that only
 * contain already-saved data are also chosen: the import then shares these
 * entries, and deleting an older import does not take them away.
 */
export function defaultImportChoice(preview: ImportPreview): ImportChoice {
  return {
    version: IMPORT_CHOICE_VERSION,
    runs: preview.runs.new + preview.runs.duplicates > 0,
    strength:
      preview.strength.workouts.length +
        preview.strength.omitted +
        preview.strength.duplicates >
      0,
    wellnessKinds: Array.from(
      new Set([
        ...Object.keys(preview.wellness),
        ...Object.keys(preview.wellnessKnown),
      ]),
    ).sort(),
    excludedStrengthIds: [],
    keepDurationIds: [],
    templateSuggestions: preview.strength.workouts.length > 0,
  };
}

/** What would actually be newly saved with this choice. */
export function chosenCounts(
  preview: ImportPreview,
  choice: ImportChoice,
): { runs: number; strength: number; wellness: number } {
  const excluded = new Set(choice.excludedStrengthIds);
  const kinds = new Set(choice.wellnessKinds);
  return {
    runs: choice.runs ? preview.runs.new : 0,
    strength: choice.strength
      ? preview.strength.workouts.filter(w => !excluded.has(w.id)).length +
        preview.strength.omitted
      : 0,
    wellness: Object.entries(preview.wellness)
      .filter(([kind]) => kinds.has(kind))
      .reduce((sum, [, n]) => sum + n, 0),
  };
}

export function hasNewData(preview: ImportPreview): boolean {
  return (
    preview.runs.new > 0 ||
    preview.strength.workouts.length + preview.strength.omitted > 0 ||
    Object.keys(preview.wellness).length > 0
  );
}

export function toggleIn(list: string[], id: string, on: boolean): string[] {
  const rest = list.filter(item => item !== id);
  return on ? [...rest, id] : rest;
}

/** Visible names of the wellness kinds; kinds with the same everyday name share one choice. */
const WELLNESS_LABELS: Record<string, { de: string; en: string }> = {
  resting_hr: { de: 'Ruhepuls', en: 'Resting heart rate' },
  heart_rate: { de: 'Puls im Alltag', en: 'Heart rate during the day' },
  heart_sample: { de: 'Pulsverlauf', en: 'Heart rate trace' },
  sleep_hr: { de: 'Puls im Schlaf', en: 'Heart rate during sleep' },
  hrv_rmssd: { de: 'Herzratenvariabilität', en: 'Heart rate variability' },
  hrv_sdnn: { de: 'Herzratenvariabilität', en: 'Heart rate variability' },
  hrv_entropy: { de: 'Herzratenvariabilität', en: 'Heart rate variability' },
  sleep_session: { de: 'Schlaf', en: 'Sleep' },
  sleep_stage: { de: 'Schlaf', en: 'Sleep' },
  sleep_score: { de: 'Schlaf', en: 'Sleep' },
  weight: { de: 'Gewicht', en: 'Weight' },
  height: { de: 'Körpergröße', en: 'Height' },
  body_fat: { de: 'Körperfett', en: 'Body fat' },
  steps: { de: 'Schritte', en: 'Steps' },
  distance: { de: 'Strecke im Alltag', en: 'Distance during the day' },
  calories: { de: 'Kalorien', en: 'Calories' },
  calories_basal: { de: 'Kalorien', en: 'Calories' },
  calories_intake: { de: 'Gegessene Kalorien', en: 'Calories eaten' },
  active_minutes: { de: 'Aktive Minuten', en: 'Active minutes' },
  stand_count: { de: 'Aktive Minuten', en: 'Active minutes' },
  vo2max: { de: 'VO2max', en: 'VO2max' },
  spo2: { de: 'Sauerstoffsättigung', en: 'Blood oxygen' },
  respiratory_rate: { de: 'Atemfrequenz', en: 'Breathing rate' },
  stress: { de: 'Stress', en: 'Stress' },
};

export function wellnessLabel(kind: string): string {
  const label = WELLNESS_LABELS[kind];
  if (label) return tr(label.de, label.en);
  if (kind.startsWith('body_'))
    return tr('Körpermaße', 'Body measurements');
  return tr('Weitere Werte', 'Other values');
}

/** Kinds with the same everyday name appear as one choice. */
export function wellnessGroups(
  wellness: Record<string, number>,
): { label: string; kinds: string[]; count: number }[] {
  const groups = new Map<string, { kinds: string[]; count: number }>();
  for (const kind of Object.keys(wellness).sort()) {
    const label = wellnessLabel(kind);
    const group = groups.get(label) ?? { kinds: [], count: 0 };
    group.kinds.push(kind);
    group.count += wellness[kind];
    groups.set(label, group);
  }
  return Array.from(groups, ([label, group]) => ({ label, ...group })).sort(
    (a, b) => b.count - a.count || a.label.localeCompare(b.label, locale()),
  );
}

export interface ImportBatch {
  id: string;
  /** Created before the import list: all entries of a source without their own import. */
  legacy: boolean;
  createdAt?: number;
  source?: string;
  vendors: string[];
  files: string[];
  state?: string;
  templateSuggestions: boolean;
  counts: { runs: number; strength: number; wellness: number };
}

export function readImportBatches(raw: unknown): ImportBatch[] {
  const list = Array.isArray((raw as any)?.batches)
    ? (raw as any).batches
    : [];
  return list
    .filter((item: any) => item && typeof item.id === 'string')
    .map(
      (item: any): ImportBatch => ({
        id: item.id,
        legacy: item.legacy === true,
        createdAt: Number.isFinite(item.createdAt) ? item.createdAt : undefined,
        source: typeof item.source === 'string' ? item.source : undefined,
        vendors: Array.isArray(item.vendors)
          ? item.vendors.filter((v: unknown) => typeof v === 'string')
          : [],
        files: Array.isArray(item.files)
          ? item.files.filter((v: unknown) => typeof v === 'string')
          : [],
        state: typeof item.state === 'string' ? item.state : undefined,
        templateSuggestions: item.templateSuggestions !== false,
        counts: {
          runs: count(item.counts?.runs),
          strength: count(item.counts?.strength),
          wellness: count(item.counts?.wellness),
        },
      }),
    );
}

/** Source names as in the provider list; file imports without a provider are called "Files". */
export function sourceName(source: string): string {
  const id = source.toLowerCase().replace(/^vendor:/, '');
  if (id === 'import' || id === 'generic' || id === '')
    return tr('Dateien', 'Files');
  const info = VENDOR_INFOS.find(
    vendor => vendor.id === id || vendor.id.replace('_', '') === id,
  );
  return info ? info.name.replace(/\s*\(.*\)$/, '') : source;
}

export function importBatchTitle(batch: ImportBatch): string {
  const names = Array.from(
    new Set(
      (batch.legacy && batch.source ? [batch.source] : batch.vendors).map(
        sourceName,
      ),
    ),
  );
  const title = names.length ? names.join(', ') : tr('Dateien', 'Files');
  return batch.legacy
    ? tr(`${title} · früherer Import`, `${title} · earlier import`)
    : title;
}

/** Whole number with the thousands separator of the active language. */
export function formatCount(n: number): string {
  return numberFormat().format(Math.round(n));
}

export function importBatchCounts(batch: ImportBatch): string {
  const { runs, strength, wellness } = batch.counts;
  return [
    runs
      ? `${formatCount(runs)} ${
          runs === 1 ? tr('Lauf', 'run') : tr('Läufe', 'runs')
        }`
      : '',
    strength
      ? `${formatCount(strength)} ${
          strength === 1
            ? tr('Krafteinheit', 'strength session')
            : tr('Krafteinheiten', 'strength sessions')
        }`
      : '',
    wellness
      ? `${formatCount(wellness)} ${
          wellness === 1
            ? tr('Kontextwert', 'context value')
            : tr('Kontextwerte', 'context values')
        }`
      : '',
  ]
    .filter(Boolean)
    .join(' · ');
}
