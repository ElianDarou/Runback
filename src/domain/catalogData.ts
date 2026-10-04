import database from './data/freeExerciseDb.json';
import type { Equipment, Exercise } from './strength';

export const EXERCISE_DATABASE = {
  name: 'Free Exercise DB',
  url: database.repository,
  revision: database.revision,
  license: database.license,
} as const;

export const EQUIPMENT_LABEL: Record<Equipment, string> = {
  barbell: 'Langhantel',
  dumbbell: 'Kurzhantel',
  machine: 'Maschine',
  cable: 'Kabel',
  bodyweight: 'Eigengewicht',
  band: 'Band',
  kettlebell: 'Kettlebell',
  ez_bar: 'SZ-Stange',
  ball: 'Ball',
  other: 'Weiteres Gerät',
  unknown: 'Gerät unbekannt',
};

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
const muscles: Record<string, string> = {
  abdominals: 'Bauch',
  abductors: 'Hüfte außen',
  adductors: 'Oberschenkel innen',
  biceps: 'Bizeps',
  calves: 'Waden',
  chest: 'Brust',
  forearms: 'Unterarme',
  glutes: 'Gesäß',
  hamstrings: 'Oberschenkel hinten',
  lats: 'Latissimus',
  'lower back': 'Unterer Rücken',
  'middle back': 'Mittlerer Rücken',
  neck: 'Nacken',
  quadriceps: 'Oberschenkel vorn',
  shoulders: 'Schultern',
  traps: 'Trapez',
  triceps: 'Trizeps',
};

// Bereits gespeicherte Vorlagen behalten ihre Kennungen; gleiche Varianten werden nicht verdoppelt.
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

/** Nur Namen, Geräte und Muskelgruppen stammen aus der Datenbank, keine Rechenparameter. */
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
      origin: 'catalog',
      catalogVersion,
      aliases: [...(previous?.aliases ?? []), row.englishName],
      source: {
        database: EXERCISE_DATABASE.name,
        revision: database.revision,
        id: row.id,
      },
      muscleGroups: row.primaryMuscles.map(muscle => muscles[muscle]),
    });
  }
  return Array.from(result.values());
}

/** Explizite App-Namen; unscharfe Treffer dürfen keine importierte Übung umdeuten. */
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
