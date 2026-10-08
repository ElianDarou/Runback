import type { Exercise } from './strength';
import { CATALOG_VERSION } from './strength';
import {
  databaseCatalog,
  equipmentLabel,
  exerciseMuscleLabels,
  IMPORT_EXERCISE_ALIASES,
} from './catalogData';
import { tr } from './i18n';

/**
 * Versioned exercise catalog with a local selection from the Free Exercise DB.
 *
 * `shares` spreads the load across base regions from `regions-v1` and adds up
 * to 1. `eccentric` is the eccentric and stretch factor of the muscle model
 * (see freshness.ts).
 *
 * All values are reasoned starting assumptions from movement science, not
 * measurements. The muscle model learns them per user later; until then they
 * must be marked as assumptions.
 *
 * `name` is the German name and is what logged sets store; `en` is the English
 * name. Use `exerciseName` for the visible name.
 */
const entries: Omit<Exercise, 'origin' | 'catalogVersion'>[] = [
  // ── Legs ─────────────────────────────────────────────────────────────────
  {
    id: 'barbell_back_squat',
    name: 'Kniebeuge (Langhantel)',
    en: 'Back squat (barbell)',
    equipment: 'barbell',
    unilateral: false,
    eccentric: 1.3,
    shares: { quad: 0.45, glute: 0.25, adductor: 0.1, lower_back: 0.1, abs_upper: 0.1 },
  },
  {
    id: 'barbell_front_squat',
    name: 'Frontkniebeuge',
    en: 'Front squat',
    equipment: 'barbell',
    unilateral: false,
    eccentric: 1.3,
    shares: { quad: 0.55, glute: 0.15, abs_upper: 0.15, lower_back: 0.1, adductor: 0.05 },
  },
  {
    id: 'leg_press',
    name: 'Beinpresse',
    en: 'Leg press',
    equipment: 'machine',
    unilateral: false,
    eccentric: 1.0,
    shares: { quad: 0.55, glute: 0.3, adductor: 0.15 },
  },
  {
    id: 'leg_extension',
    name: 'Beinstrecker',
    en: 'Leg extension',
    equipment: 'machine',
    unilateral: false,
    eccentric: 0.9,
    shares: { quad: 1 },
  },
  {
    id: 'romanian_deadlift',
    name: 'Rumänisches Kreuzheben',
    en: 'Romanian deadlift',
    equipment: 'barbell',
    unilateral: false,
    eccentric: 1.7,
    shares: { hamstring: 0.45, glute: 0.3, lower_back: 0.2, forearm: 0.05 },
  },
  {
    id: 'conventional_deadlift',
    name: 'Kreuzheben',
    en: 'Deadlift',
    equipment: 'barbell',
    unilateral: false,
    eccentric: 1.2,
    shares: { hamstring: 0.25, glute: 0.25, lower_back: 0.25, quad: 0.15, forearm: 0.1 },
  },
  {
    id: 'lying_leg_curl',
    name: 'Beinbeuger liegend',
    en: 'Lying leg curl',
    equipment: 'machine',
    unilateral: false,
    eccentric: 1.2,
    shares: { hamstring: 0.9, calf_gastroc: 0.1 },
  },
  {
    id: 'hip_thrust',
    name: 'Hip Thrust',
    en: 'Hip thrust',
    equipment: 'barbell',
    unilateral: false,
    eccentric: 0.9,
    shares: { glute: 0.7, hamstring: 0.2, quad: 0.1 },
  },
  {
    id: 'walking_lunge',
    name: 'Ausfallschritt gehend',
    en: 'Walking lunge',
    equipment: 'dumbbell',
    unilateral: true,
    eccentric: 1.6,
    shares: { quad: 0.4, glute: 0.35, hamstring: 0.15, adductor: 0.1 },
  },
  {
    id: 'bulgarian_split_squat',
    name: 'Bulgarische Kniebeuge',
    en: 'Bulgarian split squat',
    equipment: 'dumbbell',
    unilateral: true,
    eccentric: 1.7,
    shares: { quad: 0.4, glute: 0.35, adductor: 0.15, hip_flexor: 0.1 },
  },
  {
    id: 'standing_calf_raise',
    name: 'Wadenheben stehend',
    en: 'Standing calf raise',
    equipment: 'machine',
    unilateral: false,
    eccentric: 1.4,
    shares: { calf_gastroc: 0.75, calf_soleus: 0.25 },
  },
  {
    id: 'seated_calf_raise',
    name: 'Wadenheben sitzend',
    en: 'Seated calf raise',
    equipment: 'machine',
    unilateral: false,
    eccentric: 1.3,
    shares: { calf_soleus: 0.8, calf_gastroc: 0.2 },
  },
  {
    id: 'back_extension',
    name: 'Rückenstrecken',
    en: 'Back extension',
    equipment: 'bodyweight',
    unilateral: false,
    eccentric: 1.1,
    shares: { lower_back: 0.5, glute: 0.3, hamstring: 0.2 },
  },

  // ── Chest ────────────────────────────────────────────────────────────────
  {
    id: 'barbell_bench_press',
    name: 'Bankdrücken',
    en: 'Bench press',
    equipment: 'barbell',
    unilateral: false,
    eccentric: 1.2,
    shares: { chest_mid: 0.45, chest_upper: 0.15, triceps: 0.25, shoulder_front: 0.15 },
  },
  {
    id: 'incline_bench_press',
    name: 'Schrägbankdrücken',
    en: 'Incline bench press',
    equipment: 'barbell',
    unilateral: false,
    eccentric: 1.2,
    shares: { chest_upper: 0.45, chest_mid: 0.15, shoulder_front: 0.2, triceps: 0.2 },
  },
  {
    id: 'dumbbell_bench_press',
    name: 'Bankdrücken (Kurzhantel)',
    en: 'Bench press (dumbbell)',
    equipment: 'dumbbell',
    unilateral: false,
    eccentric: 1.4,
    shares: { chest_mid: 0.45, chest_upper: 0.15, triceps: 0.2, shoulder_front: 0.2 },
  },
  {
    id: 'cable_chest_fly',
    name: 'Fliegende am Kabel',
    en: 'Cable chest fly',
    equipment: 'cable',
    unilateral: false,
    eccentric: 1.5,
    shares: { chest_mid: 0.6, chest_upper: 0.25, shoulder_front: 0.15 },
  },
  {
    id: 'dip',
    name: 'Dips',
    en: 'Dips',
    equipment: 'bodyweight',
    unilateral: false,
    eccentric: 1.4,
    shares: { chest_mid: 0.35, triceps: 0.35, shoulder_front: 0.2, chest_upper: 0.1 },
  },
  {
    id: 'push_up',
    name: 'Liegestütz',
    en: 'Push-up',
    equipment: 'bodyweight',
    unilateral: false,
    eccentric: 1.1,
    shares: { chest_mid: 0.4, triceps: 0.25, shoulder_front: 0.2, abs_upper: 0.15 },
  },

  // ── Shoulders ────────────────────────────────────────────────────────────
  {
    id: 'overhead_press',
    name: 'Schulterdrücken (Langhantel)',
    en: 'Overhead press (barbell)',
    equipment: 'barbell',
    unilateral: false,
    eccentric: 1.1,
    shares: { shoulder_front: 0.4, shoulder_side: 0.2, triceps: 0.25, abs_upper: 0.15 },
  },
  {
    id: 'dumbbell_shoulder_press',
    name: 'Schulterdrücken (Kurzhantel)',
    en: 'Shoulder press (dumbbell)',
    equipment: 'dumbbell',
    unilateral: false,
    eccentric: 1.2,
    shares: { shoulder_front: 0.4, shoulder_side: 0.25, triceps: 0.25, trap_upper: 0.1 },
  },
  {
    id: 'lateral_raise',
    name: 'Seitheben',
    en: 'Lateral raise',
    equipment: 'dumbbell',
    unilateral: false,
    eccentric: 1.1,
    shares: { shoulder_side: 0.8, trap_upper: 0.2 },
  },
  {
    id: 'rear_delt_fly',
    name: 'Reverse Fly',
    en: 'Reverse fly',
    equipment: 'dumbbell',
    unilateral: false,
    eccentric: 1.1,
    shares: { shoulder_rear: 0.6, rhomboid: 0.25, trap_mid: 0.15 },
  },
  {
    id: 'face_pull',
    name: 'Face Pull',
    en: 'Face pull',
    equipment: 'cable',
    unilateral: false,
    eccentric: 1.0,
    shares: { shoulder_rear: 0.45, trap_mid: 0.25, rhomboid: 0.2, trap_upper: 0.1 },
  },

  // ── Back ─────────────────────────────────────────────────────────────────
  {
    id: 'pull_up',
    name: 'Klimmzug (Obergriff)',
    en: 'Pull-up (overhand)',
    equipment: 'bodyweight',
    unilateral: false,
    eccentric: 1.4,
    shares: { lat: 0.5, biceps: 0.15, rhomboid: 0.15, trap_mid: 0.1, forearm: 0.1 },
  },
  {
    id: 'chin_up',
    name: 'Klimmzug (Untergriff)',
    en: 'Chin-up (underhand)',
    equipment: 'bodyweight',
    unilateral: false,
    eccentric: 1.4,
    shares: { lat: 0.45, biceps: 0.3, rhomboid: 0.1, forearm: 0.15 },
  },
  {
    id: 'lat_pulldown',
    name: 'Latzug',
    en: 'Lat pulldown',
    equipment: 'machine',
    unilateral: false,
    eccentric: 1.2,
    shares: { lat: 0.55, biceps: 0.2, rhomboid: 0.15, forearm: 0.1 },
  },
  {
    id: 'barbell_row',
    name: 'Langhantelrudern',
    en: 'Barbell row',
    equipment: 'barbell',
    unilateral: false,
    eccentric: 1.2,
    shares: { lat: 0.35, rhomboid: 0.2, trap_mid: 0.15, lower_back: 0.15, biceps: 0.15 },
  },
  {
    id: 'seated_cable_row',
    name: 'Rudern am Kabel sitzend',
    en: 'Seated cable row',
    equipment: 'cable',
    unilateral: false,
    eccentric: 1.2,
    shares: { lat: 0.35, rhomboid: 0.25, trap_mid: 0.2, biceps: 0.2 },
  },
  {
    id: 'single_arm_dumbbell_row',
    name: 'Einarmiges Rudern',
    en: 'Single-arm dumbbell row',
    equipment: 'dumbbell',
    unilateral: true,
    eccentric: 1.3,
    shares: { lat: 0.45, rhomboid: 0.2, trap_mid: 0.15, biceps: 0.2 },
  },
  {
    id: 'straight_arm_pulldown',
    name: 'Überzüge am Kabel',
    en: 'Straight-arm pulldown',
    equipment: 'cable',
    unilateral: false,
    eccentric: 1.4,
    shares: { lat: 0.75, triceps: 0.15, abs_upper: 0.1 },
  },
  {
    id: 'shrug',
    name: 'Nackenziehen',
    en: 'Shrug',
    equipment: 'dumbbell',
    unilateral: false,
    eccentric: 1.0,
    shares: { trap_upper: 0.75, forearm: 0.15, neck: 0.1 },
  },

  // ── Arms ─────────────────────────────────────────────────────────────────
  {
    id: 'barbell_curl',
    name: 'Bizepscurl (Langhantel)',
    en: 'Barbell curl',
    equipment: 'barbell',
    unilateral: false,
    eccentric: 1.2,
    shares: { biceps: 0.8, forearm: 0.2 },
  },
  {
    id: 'incline_dumbbell_curl',
    name: 'Schrägbank-Curl',
    en: 'Incline dumbbell curl',
    equipment: 'dumbbell',
    unilateral: false,
    eccentric: 1.7,
    shares: { biceps: 0.85, forearm: 0.15 },
  },
  {
    id: 'hammer_curl',
    name: 'Hammercurl',
    en: 'Hammer curl',
    equipment: 'dumbbell',
    unilateral: false,
    eccentric: 1.2,
    shares: { biceps: 0.6, forearm: 0.4 },
  },
  {
    id: 'triceps_pushdown',
    name: 'Trizepsdrücken am Kabel',
    en: 'Triceps pushdown (cable)',
    equipment: 'cable',
    unilateral: false,
    eccentric: 1.0,
    shares: { triceps: 1 },
  },
  {
    id: 'overhead_triceps_extension',
    name: 'Trizepsdrücken über Kopf',
    en: 'Overhead triceps extension',
    equipment: 'cable',
    unilateral: false,
    eccentric: 1.6,
    shares: { triceps: 0.9, shoulder_front: 0.1 },
  },
  {
    id: 'skull_crusher',
    name: 'Stirndrücken',
    en: 'Skull crusher',
    equipment: 'barbell',
    unilateral: false,
    eccentric: 1.5,
    shares: { triceps: 0.9, forearm: 0.1 },
  },

  // ── Core ─────────────────────────────────────────────────────────────────
  {
    id: 'plank',
    name: 'Unterarmstütz',
    en: 'Plank',
    equipment: 'bodyweight',
    unilateral: false,
    eccentric: 0.7,
    shares: { abs_upper: 0.35, abs_lower: 0.3, oblique: 0.2, shoulder_front: 0.15 },
  },
  {
    id: 'hanging_leg_raise',
    name: 'Beinheben hängend',
    en: 'Hanging leg raise',
    equipment: 'bodyweight',
    unilateral: false,
    eccentric: 1.3,
    shares: { abs_lower: 0.45, hip_flexor: 0.3, abs_upper: 0.15, forearm: 0.1 },
  },
  {
    id: 'cable_woodchop',
    name: 'Holzhacker am Kabel',
    en: 'Cable woodchop',
    equipment: 'cable',
    unilateral: true,
    eccentric: 1.1,
    shares: { oblique: 0.6, abs_upper: 0.25, shoulder_front: 0.15 },
  },
];

// These export names leave the equipment or the execution open; the gap is kept.
const unspecified: Exercise[] = [
  {
    id: 'chest_fly_unspecified',
    name: 'Fliegende (Gerät unbekannt)',
    en: 'Chest fly (equipment unknown)',
    equipment: 'unknown',
    shares: {},
    origin: 'catalog',
  },
  {
    id: 'cable_triceps_extension_unspecified',
    name: 'Trizepsstrecken (Kabel)',
    en: 'Triceps extension (cable)',
    equipment: 'cable',
    shares: {},
    origin: 'catalog',
  },
  {
    id: 'wide_pull_up',
    name: 'Klimmzug mit breitem Griff',
    en: 'Wide-grip pull-up',
    equipment: 'bodyweight',
    shares: {},
    origin: 'catalog',
  },
];

export const CATALOG: Exercise[] = databaseCatalog(
  [
    ...entries.map(entry => ({
      ...entry,
      origin: 'catalog' as const,
      catalogVersion: CATALOG_VERSION,
    })),
    ...unspecified,
  ],
  CATALOG_VERSION,
).map(exercise => ({
  ...exercise,
  catalogVersion: CATALOG_VERSION,
  aliases: [
    ...(exercise.aliases ?? []),
    ...(IMPORT_EXERCISE_ALIASES[exercise.id] ?? []),
  ],
}));

const byId = new Map(CATALOG.map(exercise => [exercise.id, exercise]));
export function catalogExercise(id: string): Exercise | undefined {
  return byId.get(id);
}

/** Visible name of an exercise in the active language. Stored names stay German. */
export function exerciseName(exercise: Exercise): string {
  return tr(exercise.name, exercise.en ?? exercise.name);
}

/**
 * Visible name for a logged exercise. Only a stored name that is still the
 * catalog's German default is translated; names the user typed stay as they are.
 */
export function exerciseDisplayName(exerciseId: string, storedName: string): string {
  const exercise = catalogExercise(exerciseId);
  return exercise && storedName === exercise.name
    ? exerciseName(exercise)
    : storedName;
}

export function normalizeExerciseName(name: string): string {
  return name
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}
const names = new Map<string, Set<string>>();
for (const exercise of CATALOG) {
  for (const name of [exercise.name, ...(exercise.aliases ?? [])]) {
    const key = normalizeExerciseName(name);
    const ids = names.get(key) ?? new Set<string>();
    ids.add(exercise.id);
    names.set(key, ids);
  }
}

/** Only a unique, complete name may link history and catalog. */
export function resolveCatalogExercise(name: string): Exercise | undefined {
  const ids = names.get(normalizeExerciseName(name));
  return ids?.size === 1 ? byId.get(Array.from(ids)[0]) : undefined;
}

/** Search words may be German or English; equipment and muscle group help find an exercise. */
export function searchCatalog(query: string, limit = 20): Exercise[] {
  const needle = normalizeExerciseName(query);
  const words = needle.split(' ').filter(Boolean);
  const count = Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : 20;
  return CATALOG.map((exercise, order) => {
    const labels = [exercise.name, ...(exercise.aliases ?? [])].map(
      normalizeExerciseName,
    );
    const text = normalizeExerciseName(
      [
        exercise.name,
        exercise.en ?? exercise.name,
        ...(exercise.aliases ?? []),
        equipmentLabel(exercise.equipment),
        ...(exercise.muscleGroups ?? []),
        ...exerciseMuscleLabels(exercise),
      ].join(' '),
    );
    return {
      exercise,
      order,
      match: words.every(word => text.includes(word)),
      rank: labels.includes(needle)
        ? 0
        : labels.some(label => label.startsWith(needle))
        ? 1
        : 2,
    };
  })
    .filter(item => item.match)
    .sort((a, b) => a.rank - b.rank || a.order - b.order)
    .slice(0, count)
    .map(item => item.exercise);
}
