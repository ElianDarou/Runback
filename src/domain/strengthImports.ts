import { resolveCatalogExercise } from './catalog';
import type { PlannedSet, StrengthSession, WorkoutTemplate } from './strength';
import { CATALOG_VERSION } from './strength';
import type { StrongWorkout } from './vendorImports';
import { applyStrengthEndCorrection } from './endCorrection';

export const STRENGTH_IMPORT_TEMPLATE_VERSION = 'strength-import-template-v2';
export const STRENGTH_IMPORT_SESSION_VERSION = 'strength-import-session-v1';

/** Nur eine Ansicht der Originale: Satzabschluss bekannt, Satzzeit und RIR unbekannt. */
export function importedStrengthSession(
  workout: StrongWorkout,
): StrengthSession {
  const exercises: StrengthSession['exercises'] = [];
  workout.sets.forEach((set, index) => {
    const exercise = resolveCatalogExercise(set.exercise);
    const exerciseId =
      exercise?.id ??
      `imported:${encodeURIComponent(
        set.exercise.trim().toLowerCase().replace(/\s+/g, ' '),
      )}`;
    const kg =
      set.weight !== null && set.weight >= 0
        ? set.weightUnit === 'kg'
          ? set.weight
          : set.weightUnit === 'lb'
          ? set.weight * 0.45359237
          : undefined
        : undefined;
    const bodyweight = exercise?.equipment === 'bodyweight';
    const planned: PlannedSet = {
      kind:
        set.kind && set.kind !== 'normal'
          ? set.kind
          : set.seconds !== null && set.reps === null
          ? 'timed'
          : 'normal',
      loadKind:
        bodyweight && (set.weight === null || set.weight === 0)
          ? 'bodyweight'
          : bodyweight && kg !== undefined
          ? 'bodyweight_plus'
          : kg !== undefined
          ? 'kg'
          : 'unknown',
    };
    const logged = {
      id: `${workout.id ?? `${workout.time}|${workout.name}`}:set:${index}`,
      planned,
      completed: true,
      actualReps: set.reps ?? undefined,
      actualSeconds: set.seconds ?? undefined,
      actualWeightKg: kg,
    };
    const previous = exercises[exercises.length - 1];
    if (previous?.exerciseId === exerciseId) previous.sets.push(logged);
    else
      exercises.push({
        exerciseId,
        name: exercise?.name ?? set.exercise,
        sets: [logged],
      });
  });
  const duration = workout.durationSeconds;
  return applyStrengthEndCorrection({
    id: workout.id ?? `${workout.time}|${workout.name}`,
    kind: 'strength',
    name: workout.name,
    startTime: workout.time,
    endTime:
      duration !== null && Number.isFinite(duration) && duration > 0
        ? workout.time + duration * 1000
        : undefined,
    status: 'finished',
    exercises,
    currentExercise: 0,
    note: workout.workoutNotes || undefined,
    modelVersion: STRENGTH_IMPORT_SESSION_VERSION,
    catalogVersion: CATALOG_VERSION,
    importSource: {
      workoutId: workout.id ?? `${workout.time}|${workout.name}`,
      source: workout.source ?? 'strong',
      importVersion: workout.modelVersion ?? 'unknown',
      incomplete: workout.incomplete === true,
      ...(workout.durationRejected &&
      typeof workout.reportedDurationSeconds === 'number' &&
      workout.reportedDurationSeconds > 0
        ? { rejectedDurationSeconds: workout.reportedDurationSeconds }
        : {}),
    },
  }, workout.endCorrection);
}
export interface ImportedTemplate {
  template: WorkoutTemplate;
  source: StrongWorkout;
  warnings: string[];
}
const workoutName = (name: string) =>
  name.trim().toLowerCase().replace(/\s+/g, ' ');

/** Eine letzte Einheit je Name, ohne Mischung historischer Varianten oder erfundene Wochentage. */
export function importedTemplateCandidates(
  workouts: StrongWorkout[],
  existing: WorkoutTemplate[] = [],
  dismissedIds: readonly string[] = [],
): ImportedTemplate[] {
  const dismissed = new Set(dismissedIds);
  const latest = new Map<string, StrongWorkout>();
  for (const workout of workouts) {
    if (
      !Number.isFinite(workout.time) ||
      workout.time <= 0 ||
      !workout.sets.length
    )
      continue;
    const key = workoutName(workout.name);
    const previous = latest.get(key);
    if (
      !previous ||
      previous.time < workout.time ||
      (previous.time === workout.time &&
        (previous.id ?? '') < (workout.id ?? ''))
    )
      latest.set(key, workout);
  }
  const result: ImportedTemplate[] = [];
  for (const [key, workout] of latest) {
    const source = workout.source ?? 'strong';
    // Die Wahl gilt für Quelle und Trainingsname, auch nach einem erneuten Import.
    const id = `import-template:${encodeURIComponent(source)}:${encodeURIComponent(key)}`;
    if (
      dismissed.has(id) ||
      workout.incomplete ||
      existing.some(
        template =>
          template.importSource?.source === (workout.source ?? 'strong') &&
          workoutName(template.importSource.name) === key,
      )
    )
      continue;
    const warnings = new Set<string>();
    const exercises: WorkoutTemplate['exercises'] = [];
    for (const set of workout.sets) {
      const exercise = resolveCatalogExercise(set.exercise);
      const exerciseId =
        exercise?.id ??
        `imported:${encodeURIComponent(set.exercise.trim().toLowerCase().replace(/\s+/g, ' '))}`;
      if (!exercise)
        warnings.add('Prüfe Übungen, deren Ausführung noch unbekannt ist.');
      const kg =
        set.weight !== null && set.weight >= 0
          ? set.weightUnit === 'kg'
            ? set.weight
            : set.weightUnit === 'lb'
            ? set.weight * 0.45359237
            : undefined
          : undefined;
      if (set.weight !== null && kg === undefined)
        warnings.add('Ergänze Lasten mit unbekannter Einheit oder Bedeutung.');
      const bodyweight = exercise?.equipment === 'bodyweight';
      const planned: PlannedSet = {
        kind:
          set.kind && set.kind !== 'normal'
            ? set.kind
            : set.seconds !== null && set.reps === null
            ? 'timed'
            : 'normal',
        loadKind:
          bodyweight && (set.weight === null || set.weight === 0)
            ? 'bodyweight'
            : bodyweight && kg !== undefined
            ? 'bodyweight_plus'
            : kg !== undefined
            ? 'kg'
            : 'unknown',
      };
      if (set.reps !== null) planned.reps = set.reps;
      if (set.seconds !== null) planned.seconds = set.seconds;
      if (kg !== undefined && (!bodyweight || kg > 0)) planned.weightKg = kg;
      if (set.restSeconds != null) planned.restSeconds = set.restSeconds;
      else warnings.add('Ergänze Pausen, die im Export fehlen.');
      if (set.distance !== null)
        warnings.add(
          'Prüfe Streckenangaben in den Details; die Kraftvorlage übernimmt keine Strecke.',
        );
      // Gleiche Übung in getrennten Blöcken bleibt getrennt, etwa bei Supersätzen.
      const previous = exercises[exercises.length - 1];
      if (previous?.exerciseId === exerciseId) previous.sets.push(planned);
      else
        exercises.push({
          exerciseId,
          name: exercise?.name ?? set.exercise,
          sets: [planned],
        });
    }
    if (!exercises.length) continue;
    result.push({
      source: workout,
      warnings: Array.from(warnings),
      template: {
        id,
        name: workout.name.trim(),
        days: [],
        exercises,
        createdAt: workout.time,
        importSource: {
          modelVersion: STRENGTH_IMPORT_TEMPLATE_VERSION,
          importVersion: workout.modelVersion ?? 'unknown',
          catalogVersion: CATALOG_VERSION,
          workoutId: workout.id ?? `${workout.time}|${workout.name}`,
          source,
          time: workout.time,
          name: workout.name,
        },
      },
    });
  }
  return result.sort(
    (a, b) =>
      b.source.time - a.source.time ||
      (a.template.id < b.template.id ? -1 : a.template.id === b.template.id ? 0 : 1),
  );
}

/** Übernehmen legt nur neue Vorlagen an; eigene Änderungen bleiben erhalten. */
export function acceptImportedTemplate(
  existing: WorkoutTemplate[],
  candidate: WorkoutTemplate,
): WorkoutTemplate[] {
  if (
    !candidate.importSource ||
    existing.some(
      template =>
        template.id === candidate.id ||
        (template.importSource?.source === candidate.importSource?.source &&
          workoutName(template.importSource!.name) ===
            workoutName(candidate.importSource!.name)),
    )
  )
    return existing;
  return [...existing, candidate];
}
