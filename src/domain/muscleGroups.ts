import { catalogExercise, resolveCatalogExercise } from './catalog';
import type { RegionBase } from './regions';
import { isSetCompleted, type LoggedSet, type StrengthSession } from './strength';
import { tr } from './i18n';

/**
 * Coarse muscle groups for the strength statistics: "How many sets does my
 * chest get per week?" The question does not need finer groups, and the
 * catalog values would not carry finer ones either.
 *
 * An exercise counts a working set in full for each of its primary groups.
 * A primary group is any group that gets at least 25% of the catalog shares;
 * exercises from the free database carry no shares, so their primary muscles
 * count instead. Without either, the set stays "unassigned" — nothing is guessed.
 */
export const MUSCLE_GROUPS_VERSION = 'muscle-groups-v2';
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

/** Order from top to bottom, the way one reads the body. */
export const MUSCLE_GROUPS: { group: MuscleGroup; label: string; en: string }[] = [
  { group: 'chest', label: 'Brust', en: 'Chest' },
  { group: 'back', label: 'Rücken', en: 'Back' },
  { group: 'shoulders', label: 'Schultern', en: 'Shoulders' },
  { group: 'biceps', label: 'Bizeps', en: 'Biceps' },
  { group: 'triceps', label: 'Trizeps', en: 'Triceps' },
  { group: 'forearms', label: 'Unterarme', en: 'Forearms' },
  { group: 'core', label: 'Bauch', en: 'Core' },
  { group: 'glutes', label: 'Gesäß', en: 'Glutes' },
  { group: 'quads', label: 'Oberschenkel vorn', en: 'Quads' },
  { group: 'hamstrings', label: 'Oberschenkel hinten', en: 'Hamstrings' },
  { group: 'adductors', label: 'Oberschenkel innen', en: 'Inner thighs' },
  { group: 'calves', label: 'Waden', en: 'Calves' },
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

/** Primary muscles of the free database, by the database keys `catalogData.ts` stores. */
const DATABASE_GROUP: Record<string, MuscleGroup> = {
  abdominals: 'core',
  abductors: 'glutes',
  adductors: 'adductors',
  biceps: 'biceps',
  calves: 'calves',
  chest: 'chest',
  forearms: 'forearms',
  glutes: 'glutes',
  hamstrings: 'hamstrings',
  lats: 'back',
  'lower back': 'back',
  'middle back': 'back',
  neck: 'back',
  quadriceps: 'quads',
  shoulders: 'shoulders',
  traps: 'back',
  triceps: 'triceps',
};

/** Visible name of a muscle group in the active language. */
export function muscleGroupLabel(group: MuscleGroup): string {
  const entry = MUSCLE_GROUPS.find(item => item.group === group);
  return entry ? tr(entry.label, entry.en) : group;
}

/** Primary groups of an exercise, or `undefined` if the catalog does not know it. */
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

/** Ticked, not skipped, not a warm-up set. */
export function isWorkingSet(set: LoggedSet): boolean {
  return (
    isSetCompleted(set) &&
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
  /** Descending by sets; groups without a set are left out. */
  groups: MuscleGroupSets[];
  /** Working sets of exercises the catalog does not know. */
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
      .map(entry => ({
        group: entry.group,
        label: muscleGroupLabel(entry.group),
        sets: counts.get(entry.group) ?? 0,
      }))
      .sort((a, b) => b.sets - a.sets),
    unassignedSets,
    workingSets,
  };
}
