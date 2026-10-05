import { VENDOR_INFOS } from './vendorImports';

/**
 * Import in zwei Schritten: Kotlin liest die Dateien zuerst nur und meldet,
 * was neu wäre (Vorschau). Der Nutzer wählt, erst dann wird gespeichert —
 * als ein Import, den er später als Ganzes wieder löschen kann.
 */
export const IMPORT_CHOICE_VERSION = 'import-choice-v1';

export interface PreviewWorkout {
  id: string;
  time: number;
  name: string;
  source: string;
  sets: number;
  /** Gemeldete Dauer; `null`, wenn die Datei keine kennt. */
  durationSeconds: number | null;
  /** Dauer passt zu keiner Satzzahl, vermutlich nicht beendet (strong-duration-v1). */
  durationSuspect: boolean;
  incomplete: boolean;
}

export interface ImportPreview {
  runs: { new: number; duplicates: number; deleted: number };
  /** Neue Kontextwerte je Art. */
  wellness: Record<string, number>;
  /** Schon gespeicherte Kontextwerte je Art; der Import teilt sie, wenn die Art gewählt ist. */
  wellnessKnown: Record<string, number>;
  strength: { duplicates: number; omitted: number; workouts: PreviewWorkout[] };
}

export interface ImportChoice {
  version: typeof IMPORT_CHOICE_VERSION;
  runs: boolean;
  strength: boolean;
  /** Gewählte Kontextarten; fehlende Arten werden nicht gespeichert. */
  wellnessKinds: string[];
  excludedStrengthIds: string[];
  /** Verdächtige Dauern, die der Nutzer trotzdem übernimmt. Sonst bleibt die Dauer unbekannt. */
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
 * Vorgabe: alles übernehmen, verdächtige Dauern bleiben unbekannt. Bereiche,
 * die nur schon Gespeichertes enthalten, sind mitgewählt: Der Import teilt
 * diese Einträge dann, und das Löschen eines älteren Imports nimmt sie ihm
 * nicht weg.
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

/** Was mit dieser Wahl tatsächlich neu gespeichert würde. */
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

const WELLNESS_LABELS: Record<string, string> = {
  resting_hr: 'Ruhepuls',
  heart_rate: 'Puls im Alltag',
  heart_sample: 'Pulsverlauf',
  sleep_hr: 'Puls im Schlaf',
  hrv_rmssd: 'Herzratenvariabilität',
  hrv_sdnn: 'Herzratenvariabilität',
  hrv_entropy: 'Herzratenvariabilität',
  sleep_session: 'Schlaf',
  sleep_stage: 'Schlaf',
  sleep_score: 'Schlaf',
  weight: 'Gewicht',
  height: 'Körpergröße',
  body_fat: 'Körperfett',
  steps: 'Schritte',
  distance: 'Strecke im Alltag',
  calories: 'Kalorien',
  calories_basal: 'Kalorien',
  calories_intake: 'Gegessene Kalorien',
  active_minutes: 'Aktive Minuten',
  stand_count: 'Aktive Minuten',
  vo2max: 'VO2max',
  spo2: 'Sauerstoffsättigung',
  respiratory_rate: 'Atemfrequenz',
  stress: 'Stress',
};

export function wellnessLabel(kind: string): string {
  if (WELLNESS_LABELS[kind]) return WELLNESS_LABELS[kind];
  if (kind.startsWith('body_')) return 'Körpermaße';
  return 'Weitere Werte';
}

/** Arten mit gleichem Alltagswort erscheinen als eine Wahl. */
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
    (a, b) => b.count - a.count || a.label.localeCompare(b.label, 'de'),
  );
}

export interface ImportBatch {
  id: string;
  /** Vor der Importliste angelegt: alle Einträge einer Quelle ohne eigenen Import. */
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

/** Quellnamen wie in der Anbieterliste; Dateiimporte ohne Anbieter heißen „Dateien“. */
export function sourceName(source: string): string {
  const id = source.toLowerCase().replace(/^vendor:/, '');
  if (id === 'import' || id === 'generic' || id === '') return 'Dateien';
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
  const title = names.length ? names.join(', ') : 'Dateien';
  return batch.legacy ? `${title} · früherer Import` : title;
}

/** Ganze Zahl mit deutschem Tausenderpunkt. */
export function formatCount(n: number): string {
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

export function importBatchCounts(batch: ImportBatch): string {
  const { runs, strength, wellness } = batch.counts;
  return [
    runs ? `${formatCount(runs)} ${runs === 1 ? 'Lauf' : 'Läufe'}` : '',
    strength
      ? `${formatCount(strength)} ${
          strength === 1 ? 'Krafteinheit' : 'Krafteinheiten'
        }`
      : '',
    wellness
      ? `${formatCount(wellness)} ${wellness === 1 ? 'Kontextwert' : 'Kontextwerte'}`
      : '',
  ]
    .filter(Boolean)
    .join(' · ');
}
