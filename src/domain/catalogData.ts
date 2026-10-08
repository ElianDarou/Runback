import database from './data/freeExerciseDb.json';
import { tr } from './i18n';
import type { Equipment, Exercise } from './strength';

export const EXERCISE_DATABASE = {
  name: 'Free Exercise DB',
  url: database.repository,
  revision: database.revision,
  license: database.license,
} as const;

/** Visible name of an equipment type in the active language. */
export function equipmentLabel(equipment: Equipment): string {
  switch (equipment) {
    case 'barbell':
      return tr('Langhantel', 'Barbell');
    case 'dumbbell':
      return tr('Kurzhantel', 'Dumbbell');
    case 'machine':
      return tr('Maschine', 'Machine');
    case 'cable':
      return tr('Kabel', 'Cable');
    case 'bodyweight':
      return tr('Eigengewicht', 'Bodyweight');
    case 'band':
      return tr('Band', 'Band');
    case 'kettlebell':
      return tr('Kettlebell', 'Kettlebell');
    case 'ez_bar':
      return tr('SZ-Stange', 'EZ bar');
    case 'ball':
      return tr('Ball', 'Ball');
    case 'other':
      return tr('Weiteres Gerät', 'Other equipment');
    case 'unknown':
      return tr('Gerät unbekannt', 'Equipment unknown');
  }
}

const equipment: Record<string, Equipment> = {
  barbell: 'barbell',
  dumbbell: 'dumbbell',
  machine: 'machine',
  cable: 'cable',
  'body only': 'bodyweight',
  bands: 'band',
  kettlebells: 'kettlebell',
  'e-z curl bar': 'ez_bar',
  'exercise ball': 'ball',
  'medicine ball': 'ball',
  other: 'other',
};
/**
 * Database muscle names (English, the stored key) with their visible names.
 * Stored `muscleGroups` hold these keys, not the labels.
 */
const muscles: Record<string, { de: string; en: string }> = {
  abdominals: { de: 'Bauch', en: 'Abs' },
  abductors: { de: 'Hüfte außen', en: 'Outer hips' },
  adductors: { de: 'Oberschenkel innen', en: 'Inner thighs' },
  biceps: { de: 'Bizeps', en: 'Biceps' },
  calves: { de: 'Waden', en: 'Calves' },
  chest: { de: 'Brust', en: 'Chest' },
  forearms: { de: 'Unterarme', en: 'Forearms' },
  glutes: { de: 'Gesäß', en: 'Glutes' },
  hamstrings: { de: 'Oberschenkel hinten', en: 'Hamstrings' },
  lats: { de: 'Latissimus', en: 'Lats' },
  'lower back': { de: 'Unterer Rücken', en: 'Lower back' },
  'middle back': { de: 'Mittlerer Rücken', en: 'Middle back' },
  neck: { de: 'Nacken', en: 'Neck' },
  quadriceps: { de: 'Oberschenkel vorn', en: 'Quads' },
  shoulders: { de: 'Schultern', en: 'Shoulders' },
  traps: { de: 'Trapez', en: 'Traps' },
  triceps: { de: 'Trizeps', en: 'Triceps' },
};

/** Visible name of a database muscle key; unknown keys are shown as they are. */
export function databaseMuscleLabel(muscle: string): string {
  const label = muscles[muscle];
  return label ? tr(label.de, label.en) : muscle;
}

/** Visible muscle names of a catalog exercise, in the active language. */
export function exerciseMuscleLabels(exercise: Exercise): string[] {
  return (exercise.muscleGroups ?? []).map(databaseMuscleLabel);
}

// Templates already saved keep their IDs; equivalent variants are not doubled.
const legacy: Record<string, string> = {
  Barbell_Full_Squat: 'barbell_back_squat',
  Front_Barbell_Squat: 'barbell_front_squat',
  Leg_Press: 'leg_press',
  Leg_Extensions: 'leg_extension',
  Romanian_Deadlift: 'romanian_deadlift',
  Barbell_Deadlift: 'conventional_deadlift',
  Lying_Leg_Curls: 'lying_leg_curl',
  Barbell_Hip_Thrust: 'hip_thrust',
  Standing_Calf_Raises: 'standing_calf_raise',
  Seated_Calf_Raise: 'seated_calf_raise',
  Hyperextensions_Back_Extensions: 'back_extension',
  'Barbell_Bench_Press_-_Medium_Grip': 'barbell_bench_press',
  'Barbell_Incline_Bench_Press_-_Medium_Grip': 'incline_bench_press',
  Dumbbell_Bench_Press: 'dumbbell_bench_press',
  Cable_Crossover: 'cable_chest_fly',
  'Dips_-_Triceps_Version': 'dip',
  Pushups: 'push_up',
  Standing_Military_Press: 'overhead_press',
  Side_Lateral_Raise: 'lateral_raise',
  Reverse_Flyes: 'rear_delt_fly',
  Face_Pull: 'face_pull',
  Pullups: 'pull_up',
  'Chin-Up': 'chin_up',
  Bent_Over_Barbell_Row: 'barbell_row',
  Seated_Cable_Rows: 'seated_cable_row',
  Seated_Dumbbell_Press: 'dumbbell_shoulder_press',
  Dumbbell_Shrug: 'shrug',
  'One-Arm_Dumbbell_Row': 'single_arm_dumbbell_row',
  'Straight-Arm_Pulldown': 'straight_arm_pulldown',
  Barbell_Curl: 'barbell_curl',
  Incline_Dumbbell_Curl: 'incline_dumbbell_curl',
  Hammer_Curls: 'hammer_curl',
  Triceps_Pushdown: 'triceps_pushdown',
  Triceps_Overhead_Extension_with_Rope: 'overhead_triceps_extension',
  Lying_Triceps_Press: 'skull_crusher',
  Plank: 'plank',
  Hanging_Leg_Raise: 'hanging_leg_raise',
  Standing_Cable_Wood_Chop: 'cable_woodchop',
};

/** Only names, equipment and muscle groups come from the database, not calculation parameters. */
export function databaseCatalog(
  reviewed: Exercise[],
  catalogVersion: string,
): Exercise[] {
  const result = new Map(reviewed.map(entry => [entry.id, entry]));
  for (const row of database.exercises) {
    const id = legacy[row.id] ?? `fedb:${row.id}`;
    const previous = result.get(id);
    result.set(id, {
      ...(previous ?? {
        id,
        name: row.name,
        equipment: equipment[row.equipment ?? ''] ?? 'unknown',
        shares: {},
      }),
      en: previous?.en ?? row.englishName,
      origin: 'catalog',
      catalogVersion,
      aliases: [...(previous?.aliases ?? []), row.englishName],
      source: {
        database: EXERCISE_DATABASE.name,
        revision: database.revision,
        id: row.id,
      },
      muscleGroups: row.primaryMuscles.filter(muscle => muscles[muscle]),
    });
  }
  return Array.from(result.values());
}

/** Explicit app names; fuzzy matches must not reinterpret an imported exercise. */
export const IMPORT_EXERCISE_ALIASES: Record<string, string[]> = {
  barbell_back_squat: ['Squat (Barbell)', 'Barbell Squat', 'Back Squat'],
  barbell_front_squat: ['Front Squat (Barbell)'],
  barbell_bench_press: ['Bench Press (Barbell)'],
  dumbbell_bench_press: ['Bench Press (Dumbbell)'],
  incline_bench_press: ['Incline Bench Press (Barbell)'],
  lat_pulldown: ['Lat Pulldown (Cable)'],
  lateral_raise: ['Lateral Raise (Dumbbell)'],
  face_pull: ['Face Pull (Cable)'],
  seated_cable_row: ['Seated Row (Cable)'],
  single_arm_dumbbell_row: ['Bent Over One Arm Row (Dumbbell)', 'Dumbbell Row'],
  triceps_pushdown: ['Triceps Pushdown (Cable - Straight Bar)'],
  push_up: ['Push Up', 'Push-Up'],
  'fedb:Arnold_Dumbbell_Press': ['Arnold Press (Dumbbell)', 'Arnold Press'],
  'fedb:Standing_Biceps_Cable_Curl': ['Bicep Curl (Cable)', 'Cable Curl'],
  'fedb:Concentration_Curls': ['Concentration Curl (Dumbbell)'],
  'fedb:Incline_Dumbbell_Press': ['Incline Bench Press (Dumbbell)'],
  'fedb:Dumbbell_Incline_Row': ['Incline Row (Dumbbell)'],
  'fedb:Machine_Bench_Press': ['Chest Press (Machine)'],
  'fedb:Machine_Shoulder_Military_Press': ['Shoulder Press (Machine)'],
  'fedb:Butterfly': ['Chest Fly (Machine)', 'Pec Deck'],
  cable_chest_fly: ['Cable Crossover'],
  lying_leg_curl: ['Leg Curl (Lying)', 'Lying Leg Curl'],
  leg_extension: ['Leg Extension (Machine)'],
  leg_press: ['Leg Press (Machine)'],
  conventional_deadlift: ['Deadlift (Barbell)'],
  romanian_deadlift: ['Romanian Deadlift (Barbell)'],
  hammer_curl: ['Hammer Curl (Dumbbell)'],
  chest_fly_unspecified: ['Chest Fly'],
  cable_triceps_extension_unspecified: ['Triceps Extension (Cable)'],
  wide_pull_up: ['Wide Pull Up', 'Wide Grip Pull Up', 'Wide-Grip Pull-Up'],
};
