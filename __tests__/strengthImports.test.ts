declare const __dirname: string;
const fs = require('fs') as { readFileSync(path: string, encoding: string): string };
const path = require('path') as { join(...parts: string[]): string };
import {
  CATALOG,
  catalogExercise,
  resolveCatalogExercise,
  searchCatalog,
} from '../src/domain/catalog';
import { EXERCISE_DATABASE } from '../src/domain/catalogData';
import {
  acceptImportedTemplate,
  importedTemplateCandidates,
  STRENGTH_IMPORT_TEMPLATE_VERSION,
} from '../src/domain/strengthImports';
import {
  parseStrongCsvPreview,
  strongWorkoutVolume,
  STRONG_IMPORT_VERSION,
} from '../src/domain/vendorImports';
import { calculateSetStimulus } from '../src/domain/freshness';
import {
  completeSet,
  exerciseIsUsable,
  startSession,
} from '../src/domain/strength';

const fixture = fs.readFileSync(
  path.join(__dirname, 'fixtures/strong-android.csv'),
  'utf8',
);
const parsed = parseStrongCsvPreview(fixture);
const candidates = importedTemplateCandidates(parsed.workouts);

describe('Strong-Export und Vorlagen', () => {
  it('liest das vollständige Android-Format mit Einheiten und trennt Pausen von Sätzen', () => {
    expect(parsed.rows).toBe(1645);
    expect(parsed.workouts).toHaveLength(53);
    expect(parsed.workouts.flatMap(workout => workout.sets)).toHaveLength(896);
    expect(parsed.restRows).toBe(749);
    expect(parsed.skipped).toBe(0);
    expect(parsed.workouts[0].durationSeconds).toBe(3600);
    expect(parsed.workouts[0].sets[0]).toMatchObject({
      weight: 40,
      weightUnit: 'kg',
      restSeconds: 120,
    });
    expect(candidates).toHaveLength(7);
    expect(
      new Set(
        parsed.workouts.flatMap(workout =>
          workout.sets.map(set => set.exercise),
        ),
      ).size,
    ).toBe(19);
  });
  it('deckt jeden Übungsnamen des Exports eindeutig ab', () => {
    for (const set of parsed.workouts.flatMap(workout => workout.sets)) {
      expect(resolveCatalogExercise(set.exercise)).toBeDefined();
    }
  });
  it('übernimmt genau die letzte Einheit je Name samt Satzfolge und Herkunft', () => {
    for (const candidate of candidates) {
      const latest = Math.max(
        ...parsed.workouts
          .filter(workout => workout.name === candidate.source.name)
          .map(workout => workout.time),
      );
      expect(candidate.source.time).toBe(latest);
      expect(candidate.template.days).toEqual([]);
      expect(
        candidate.template.exercises.flatMap(exercise => exercise.sets),
      ).toHaveLength(candidate.source.sets.length);
      expect(candidate.template.importSource).toMatchObject({
        time: latest,
        modelVersion: STRENGTH_IMPORT_TEMPLATE_VERSION,
      });
      const session = startSession(candidate.template, 2000000000000);
      expect(
        session.exercises
          .flatMap(exercise => exercise.sets)
          .every(set => set.completedAt === undefined),
      ).toBe(true);
      expect(
        completeSet(session, 0, session.exercises[0].sets[0].id, 2000000001000)
          .exercises[0].sets[0].actualReps,
      ).toBe(8);
    }
  });
  it('lässt Änderungen, Umbenennungen, feste Tage und ursprüngliche Versionen bestehen', () => {
    const template = {
      ...candidates[0].template,
      name: 'Mein Plan',
      days: [1, 5],
    };
    const existing = [template];
    expect(acceptImportedTemplate(existing, candidates[0].template)).toBe(
      existing,
    );
    expect(
      importedTemplateCandidates(parsed.workouts, existing).map(
        item => item.template.id,
      ),
    ).not.toContain(template.id);
    const original = JSON.parse(JSON.stringify(parsed.workouts));
    importedTemplateCandidates(parsed.workouts);
    expect(parsed.workouts).toEqual(original);
  });
  it('behält unbekannte Einheiten, fehlende Pausen, Notizen und RPE ohne RIR-Schätzung', () => {
    const csv =
      'Date;Workout Name;Exercise Name;Set Order;Weight;Reps;RPE;Notes\n2024-01-01 18:00:00;A;Mystery;1;80;8;9;"Mit Pause; und \'Zitat\'"';
    const result = parseStrongCsvPreview(csv);
    const candidate = importedTemplateCandidates(result.workouts)[0];
    expect(result.workouts[0].durationSeconds).toBeNull();
    expect(strongWorkoutVolume(result.workouts[0])).toBeNull();
    expect(candidate.source.sets[0].rpe).toBe(9);
    expect(candidate.template.exercises[0].sets[0]).toEqual({
      kind: 'normal',
      loadKind: 'unknown',
      reps: 8,
    });
    expect(candidate.warnings.length).toBeGreaterThan(0);
  });
  it('hält gelöschte Vorschläge nach erneutem Import verborgen, ohne Originale oder andere Vorlagen zu ändern', () => {
    const removed = candidates[0];
    const dismissed = [removed.template.id];
    const originals = JSON.stringify(parsed.workouts);
    const saved = [{ ...removed.template, id: 'my-plan', name: 'Eigene Vorlage' }];
    const remaining = importedTemplateCandidates(parsed.workouts, [], dismissed);
    expect(remaining.map(item => item.template.id)).toEqual(
      candidates.slice(1).map(item => item.template.id),
    );
    const newer = {
      ...removed.source,
      id: 'new-import',
      name: `  ${removed.source.name.toUpperCase()}  `,
      time: removed.source.time + 86400000,
    };
    expect(importedTemplateCandidates([newer, removed.source], [], dismissed))
      .toEqual([]);
    expect(importedTemplateCandidates([newer], saved, dismissed)).toEqual([]);
    expect(saved[0].name).toBe('Eigene Vorlage');
    expect(JSON.stringify(parsed.workouts)).toBe(originals);
    expect(dismissed).toEqual([removed.template.id]);
    expect(importedTemplateCandidates([{ ...newer, source: 'other' }], [], dismissed))
      .toHaveLength(1);
  });
  it('konvertiert Pfund und bekannte Strecken, setzt aber keine Gewichte voraus', () => {
    const csv =
      'Date;Workout Name;Exercise Name;Set Order;Weight (lbs);Reps;Distance (km);Seconds\n2024-01-01 18:00:00;A;Bench Press (Barbell);1;100;8;;\n2024-01-01 18:00:00;A;Plank;2;;;;30';
    const result = parseStrongCsvPreview(csv);
    const template = importedTemplateCandidates(result.workouts)[0].template;
    expect(template.exercises[0].sets[0].weightKg).toBeCloseTo(45.359237);
    expect(template.exercises[1].sets[0]).toEqual({
      kind: 'timed',
      loadKind: 'bodyweight',
      seconds: 30,
    });
  });
  it('liest BOM, mehrzeilige und maskierte Notizen sowie explizite Satzarten', () => {
    const csv =
      '\uFEFFDate,Workout Name,Exercise Name,Set Order,Weight (kg),Reps,Seconds,Notes\r\n2024-01-01 18:00:00,A,Squat (Barbell),W,30,8,,"Rack, tief\n""Kontrolle"""\r\n2024-01-01 18:00:00,A,Squat (Barbell),Rest Timer,,,60,\r\n2024-01-01 18:00:00,A,Squat (Barbell),F,40,8,,\r\n';
    const result = parseStrongCsvPreview(csv);
    expect(result.skipped).toBe(0);
    expect(result.workouts[0].sets.map(set => set.kind)).toEqual([
      'warmup',
      'failure',
    ]);
    expect(result.workouts[0].sets[0].notes).toBe('Rack, tief\n"Kontrolle"');
    expect(result.workouts[0].sets[0].restSeconds).toBe(60);
  });
  it('ordnet fremde oder doppelte Pausen nicht dem falschen Satz zu', () => {
    const csv =
      'Date;Workout Name;Exercise Name;Set Order;Reps;Seconds\n2024-01-01 18:00:00;A;Squat;1;8;\n2024-01-01 18:00:00;A;Curl;Rest Timer;;30\n2024-01-01 18:00:00;A;Squat;Rest Timer;;60';
    const result = parseStrongCsvPreview(csv);
    expect(result.restRows).toBe(0);
    expect(result.skipped).toBe(2);
    expect(result.workouts[0].sets[0].restSeconds).toBeUndefined();
  });
  it('lässt gute Daten aus beschädigten Einheiten erhalten, baut aber keine verkürzte Vorlage', () => {
    const csv =
      'Date;Workout Name;Exercise Name;Set Order;Reps;Weight (kg)\n2024-01-01 18:00:00;A;Squat;1;8;20\n2024-01-01 18:00:00;A;Squat;2;acht;20\n2024-02-31 18:00:00;B;Squat;1;8;20';
    const result = parseStrongCsvPreview(csv);
    expect(result.skipped).toBe(2);
    expect(result.workouts[0].sets).toHaveLength(1);
    expect(result.workouts[0].incomplete).toBe(true);
    expect(importedTemplateCandidates(result.workouts)).toEqual([]);
  });
  it('weist unvollständige Anführungszeichen und überschrittene Grenzen sichtbar zurück', () => {
    expect(() =>
      parseStrongCsvPreview('Date,Exercise Name,Set Order\n"2024-01-01,A,1'),
    ).toThrow(/Anführungszeichen/);
    expect(() => parseStrongCsvPreview(fixture, 10)).toThrow(/Zu viele Zeilen/);
  });
});

describe('lokale Übungssammlung', () => {
  it('liefert eine breite, versionierte Auswahl mit prüfbarer Quelle', () => {
    expect(CATALOG.length).toBeGreaterThan(250);
    expect(EXERCISE_DATABASE.license).toBe('Unlicense');
    expect(EXERCISE_DATABASE.revision).toMatch(/^[a-f0-9]{40}$/);
    expect(CATALOG.filter(exercise => exercise.source).length).toBeGreaterThan(
      250,
    );
    expect(searchCatalog('kettlebell', 300).length).toBeGreaterThan(10);
    expect(searchCatalog('multipresse', 300).length).toBeGreaterThan(5);
    expect(searchCatalog('', CATALOG.length).length).toBe(CATALOG.length);
  });
  it('findet deutsche und englische Wörter, Umlaute und Gerätevarianten', () => {
    expect(searchCatalog('Arnold Press')[0].id).toBe(
      'fedb:Arnold_Dumbbell_Press',
    );
    expect(searchCatalog('schraegbank kurzhantel', 300).length).toBeGreaterThan(
      0,
    );
    expect(searchCatalog('bizeps kabel', 300).length).toBeGreaterThan(5);
    expect(searchCatalog('bankdruecken').length).toBeGreaterThan(0);
    expect(resolveCatalogExercise('Bench Press (Barbell)')?.id).toBe(
      'barbell_bench_press',
    );
    expect(resolveCatalogExercise('Bench Press')).toBeUndefined();
    expect(resolveCatalogExercise('Chest Fly')?.equipment).toBe('unknown');
    expect(searchCatalog('', -1)).toEqual([]);
  });
  it('erfindet keine numerischen Muskelmodelle für neue Datenbankübungen', () => {
    const exercise = catalogExercise('fedb:Arnold_Dumbbell_Press')!;
    expect(exercise.shares).toEqual({});
    expect(exercise.eccentric).toBeUndefined();
    expect(exerciseIsUsable(exercise)).toBe(false);
    const result = calculateSetStimulus(
      {
        id: 'set',
        planned: { kind: 'normal', loadKind: 'kg', reps: 8 },
        actualWeightKg: 20,
        actualReps: 8,
        actualRir: 2,
        completedAt: 1234,
      },
      exercise,
    );
    expect(result.valid).toBe(false);
    expect(result.stimulus).toBeNull();
  });
});

const attachment = (require('process') as { env: Record<string, string | undefined> }).env.RUNBACK_STRONG_EXPORT_PATH;
(attachment ? it : it.skip)(
  'prüft den unveränderten Strong-Anhang, ohne ihn ins Repository zu kopieren',
  () => {
    const result = parseStrongCsvPreview(fs.readFileSync(attachment!, 'utf8'));
    expect(result.workouts).toHaveLength(53);
    expect(result.workouts.flatMap(workout => workout.sets)).toHaveLength(896);
    expect(result.restRows).toBe(749);
    expect(result.skipped).toBe(0);
    expect(importedTemplateCandidates(result.workouts)).toHaveLength(7);
    expect(result.workouts[0].sets[0].weight).toBe(66);
    expect(result.workouts[0].durationSeconds).toBe(5042);
    expect(
      result.workouts
        .flatMap(workout => workout.sets)
        .every(set => resolveCatalogExercise(set.exercise)),
    ).toBe(true);
    expect(result.workouts[0].modelVersion).toBe(STRONG_IMPORT_VERSION);
  },
);


it('hält Strecken ohne Einheit offen und rechnet nur ausdrücklich genannte Kilometer um', () => {
  const csv = 'Date;Workout Name;Exercise Name;Set Order;Distance;Seconds\n2024-01-01 18:00:00;A;Cardio;1;2,5;600';
  const raw = parseStrongCsvPreview(csv).workouts[0].sets[0];
  expect(raw.distance).toBe(2.5);
  expect(raw.distanceUnit).toBe('unknown');
  const known = parseStrongCsvPreview(csv.replace('Distance;', 'Distance (km);')).workouts[0].sets[0];
  expect(known.distance).toBe(2500);
  expect(known.distanceUnit).toBe('m');
});
it('behält verschiedene eigene Übungen auch bei nichtlateinischen Namen getrennt', () => {
  const csv = 'Date;Workout Name;Exercise Name;Set Order;Weight (kg);Reps\n2024-01-01 18:00:00;A;推;1;40;8\n2024-01-01 18:00:00;A;拉;1;40;8';
  const candidate = importedTemplateCandidates(parseStrongCsvPreview(csv).workouts)[0];
  expect(candidate.template.exercises).toHaveLength(2);
  expect(candidate.template.exercises[0].exerciseId).not.toBe(candidate.template.exercises[1].exerciseId);
});
