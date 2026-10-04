import { catalogExercise, resolveCatalogExercise } from './catalog';
import type { RegionBase } from './regions';
import type { LoggedSet, StrengthSession } from './strength';

/**
 * Grobe Muskelgruppen für die Kraftstatistik: „Wie viele Sätze bekommt meine
 * Brust je Woche?“. Feiner als das braucht die Frage nicht, und feiner tragen
 * es die Katalogwerte auch nicht.
 *
 * Eine Übung zählt einen Arbeitssatz voll für jede ihrer Hauptgruppen.
 * Hauptgruppe ist jede Gruppe, auf die laut Katalog-Anteilen mindestens 25 %
 * entfallen; Übungen aus der freien Datenbank tragen keine Anteile, dort
 * zählen ihre Hauptmuskeln. Ohne beides bleibt der Satz „ohne Zuordnung“ —
 * geraten wird nicht.
 */
export const MUSCLE_GROUPS_VERSION = 'muscle-groups-v1';
export const PRIMARY_SHARE = 0.25;

export type MuscleGroup =
  | 'chest'
  | 'back'
  | 'shoulders'
  | 'biceps'
  | 'triceps'
  | 'forearms'
  | 'core'
  | 'glutes'
  | 'quads'
  | 'hamstrings'
  | 'adductors'
  | 'calves';

/** Reihenfolge von oben nach unten, wie man den Körper liest. */
export const MUSCLE_GROUPS: { group: MuscleGroup; label: string }[] = [
  { group: 'chest', label: 'Brust' },
  { group: 'back', label: 'Rücken' },
  { group: 'shoulders', label: 'Schultern' },
  { group: 'biceps', label: 'Bizeps' },
  { group: 'triceps', label: 'Trizeps' },
  { group: 'forearms', label: 'Unterarme' },
  { group: 'core', label: 'Bauch' },
  { group: 'glutes', label: 'Gesäß' },
  { group: 'quads', label: 'Oberschenkel vorn' },
  { group: 'hamstrings', label: 'Oberschenkel hinten' },
  { group: 'adductors', label: 'Oberschenkel innen' },
  { group: 'calves', label: 'Waden' },
];

const REGION_GROUP: Record<RegionBase, MuscleGroup> = {
  neck: 'back',
  trap_upper: 'back',
  trap_mid: 'back',
  rhomboid: 'back',
  lat: 'back',
  lower_back: 'back',
  shoulder_front: 'shoulders',
  shoulder_side: 'shoulders',
  shoulder_rear: 'shoulders',
  chest_upper: 'chest',
  chest_mid: 'chest',
  biceps: 'biceps',
  triceps: 'triceps',
  forearm: 'forearms',
  abs_upper: 'core',
  abs_lower: 'core',
  oblique: 'core',
  hip_flexor: 'core',
  glute: 'glutes',
  quad: 'quads',
  hamstring: 'hamstrings',
  adductor: 'adductors',
  calf_gastroc: 'calves',
  calf_soleus: 'calves',
  tibialis: 'calves',
};

/** Hauptmuskeln der freien Datenbank, wie `catalogData.ts` sie übersetzt. */
const DATABASE_GROUP: Record<string, MuscleGroup> = {
  Bauch: 'core',
  'Hüfte außen': 'glutes',
  'Oberschenkel innen': 'adductors',
  Bizeps: 'biceps',
  Waden: 'calves',
  Brust: 'chest',
  Unterarme: 'forearms',
  Gesäß: 'glutes',
  'Oberschenkel hinten': 'hamstrings',
  Latissimus: 'back',
  'Unterer Rücken': 'back',
  'Mittlerer Rücken': 'back',
  Nacken: 'back',
  'Oberschenkel vorn': 'quads',
  Schultern: 'shoulders',
  Trapez: 'back',
  Trizeps: 'triceps',
};

export function muscleGroupLabel(group: MuscleGroup): string {
  return MUSCLE_GROUPS.find(entry => entry.group === group)?.label ?? group;
}

/** Hauptgruppen einer Übung, oder `undefined`, wenn der Katalog sie nicht kennt. */
export function exerciseGroups(
  exerciseId: string,
  name?: string,
): MuscleGroup[] | undefined {
  const exercise =
    catalogExercise(exerciseId) ??
    (name ? resolveCatalogExercise(name) : undefined);
  if (!exercise) {
    return undefined;
  }
  const byGroup = new Map<MuscleGroup, number>();
  for (const [base, share] of Object.entries(exercise.shares) as [
    RegionBase,
    number,
  ][]) {
    const group = REGION_GROUP[base];
    if (group && share > 0) {
      byGroup.set(group, (byGroup.get(group) ?? 0) + share);
    }
  }
  const fromShares = Array.from(byGroup.entries())
    .filter(([, share]) => share >= PRIMARY_SHARE - 1e-9)
    .map(([group]) => group);
  if (fromShares.length) {
    return order(fromShares);
  }
  const fromDatabase = (exercise.muscleGroups ?? [])
    .map(label => DATABASE_GROUP[label])
    .filter((group): group is MuscleGroup => Boolean(group));
  return fromDatabase.length ? order(Array.from(new Set(fromDatabase))) : undefined;
}

function order(groups: MuscleGroup[]): MuscleGroup[] {
  return MUSCLE_GROUPS.map(entry => entry.group).filter(group =>
    groups.includes(group),
  );
}

/** Abgehakt, nicht übersprungen, kein Aufwärmsatz. */
export function isWorkingSet(set: LoggedSet): boolean {
  return (
    set.completedAt !== undefined &&
    !set.skipped &&
    set.planned?.kind !== 'warmup'
  );
}

export interface MuscleGroupSets {
  group: MuscleGroup;
  label: string;
  sets: number;
}

export interface MuscleDistribution {
  version: typeof MUSCLE_GROUPS_VERSION;
  /** Absteigend nach Sätzen; Gruppen ohne Satz fehlen. */
  groups: MuscleGroupSets[];
  /** Arbeitssätze von Übungen, die der Katalog nicht kennt. */
  unassignedSets: number;
  workingSets: number;
}

export function muscleDistribution(
  sessions: StrengthSession[],
): MuscleDistribution {
  const counts = new Map<MuscleGroup, number>();
  let unassignedSets = 0;
  let workingSets = 0;
  const cache = new Map<string, MuscleGroup[] | undefined>();
  for (const session of sessions) {
    for (const exercise of session.exercises) {
      const sets = exercise.sets.filter(isWorkingSet).length;
      if (!sets) {
        continue;
      }
      workingSets += sets;
      const key = `${exercise.exerciseId}|${exercise.name}`;
      if (!cache.has(key)) {
        cache.set(key, exerciseGroups(exercise.exerciseId, exercise.name));
      }
      const groups = cache.get(key);
      if (!groups) {
        unassignedSets += sets;
        continue;
      }
      groups.forEach(group =>
        counts.set(group, (counts.get(group) ?? 0) + sets),
      );
    }
  }
  return {
    version: MUSCLE_GROUPS_VERSION,
    groups: MUSCLE_GROUPS.filter(entry => counts.has(entry.group))
      .map(entry => ({ ...entry, sets: counts.get(entry.group) ?? 0 }))
      .sort((a, b) => b.sets - a.sets),
    unassignedSets,
    workingSets,
  };
}
