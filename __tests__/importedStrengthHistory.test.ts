declare const __dirname: string;
const { readFileSync } = require('fs') as {
  readFileSync(path: string, encoding: string): string;
};
const { join } = require('path') as { join(...parts: string[]): string };
import {
  importedStrengthSession,
  STRENGTH_IMPORT_SESSION_VERSION,
} from '../src/domain/strengthImports';
import {
  parseStrongCsvPreview,
  type StrongWorkout,
} from '../src/domain/vendorImports';
import {
  buildStrengthStatisticsView,
  strengthBucketValue,
} from '../src/domain/strengthStatistics';
import { buildDevelopmentFacts } from '../src/domain/development';
import { exerciseHistory } from '../src/domain/exerciseHistory';
import { sessionProgress } from '../src/domain/strength';
import {
  exerciseBreakdown,
  sessionDurationSeconds,
  setGaps,
} from '../src/domain/strengthSession';
import { bestWorkingSet } from '../src/domain/progression';
import { strengthSession } from './fixtures/strengthSessions';

const now = new Date(2026, 2, 9, 12).getTime();
const workout = (overrides: Partial<StrongWorkout> = {}): StrongWorkout => ({
  id: 'strong:test',
  time: now - 86400000,
  name: 'Push',
  source: 'strong',
  modelVersion: 'strong-import-v3',
  durationSeconds: 3600,
  workoutNotes: 'Notiz',
  sets: [
    {
      exercise: 'Bench Press (Barbell)',
      setOrder: 1,
      weight: 80,
      weightUnit: 'kg',
      reps: 8,
      seconds: null,
      distance: null,
      rpe: 9,
      notes: '',
    },
  ],
  ...overrides,
});

describe('importierte Krafthistorie', () => {
  it('zählt die gesamte Strong-Historie statt nur der letzten Einheit je Name', () => {
    const original = parseStrongCsvPreview(
      readFileSync(join(__dirname, 'fixtures/strong-android.csv'), 'utf8'),
    ).workouts;
    const before = JSON.stringify(original);
    const sessions = original.map(importedStrengthSession);
    const view = buildStrengthStatisticsView(sessions, 'all', now);
    expect(view.totals.sessionCount).toBe(53);
    expect(view.totals.sets).toBe(896);
    expect(view.totals.volumeKg).toBeGreaterThan(0);
    expect(view.exercises).toHaveLength(19);
    expect(view.muscles.groups.length).toBeGreaterThan(0);
    // Für Übungen ohne gespeicherte Muskelzuordnung bleibt die Zuordnung offen.
    expect(view.muscles.unassignedSets).toBe(155);
    expect(view.totals.medianRir).toBeNull();
    expect(view.totals.medianSetGapSeconds).toBeNull();
    expect(JSON.stringify(original)).toBe(before);
    expect(sessions[0]).toMatchObject({
      modelVersion: STRENGTH_IMPORT_SESSION_VERSION,
      importSource: { source: 'strong', importVersion: 'strong-import-v3' },
    });
  });

  it('liefert Ist-Werte und Bestwerte ohne erfundene Satzzeiten oder RIR', () => {
    const session = importedStrengthSession(workout());
    expect(sessionDurationSeconds(session)).toBe(3600);
    expect(sessionProgress(session)).toEqual({
      completedSets: 1,
      totalSets: 1,
      volumeKg: 640,
    });
    expect(session.exercises[0].sets[0]).toMatchObject({
      completed: true,
      actualReps: 8,
      actualWeightKg: 80,
    });
    expect(session.exercises[0].sets[0].completedAt).toBeUndefined();
    expect(session.exercises[0].sets[0].actualRir).toBeUndefined();
    expect(setGaps(session).medianSeconds).toBeUndefined();
    expect(bestWorkingSet(session, 'barbell_bench_press')?.e1rm).toBeCloseTo(
      80 * (1 + 8 / 30),
    );
    expect(
      exerciseHistory([session], 'barbell_bench_press').points[0].workingSets,
    ).toBe(1);
  });

  it('behält gute Sätze aus unvollständigen Importen und lässt fehlende Werte offen', () => {
    const value = workout({ durationSeconds: null, incomplete: true });
    value.sets[0].weightUnit = 'unknown';
    const session = importedStrengthSession(value);
    expect(session.endTime).toBeUndefined();
    expect(session.exercises[0].sets[0].actualWeightKg).toBeUndefined();
    expect(bestWorkingSet(session, 'barbell_bench_press')).toBeNull();
    const stats = buildStrengthStatisticsView([session], '4w', now);
    expect(stats.totals.sets).toBe(1);
    expect(stats.available).toEqual({
      volume: false,
      duration: false,
      heartRate: false,
    });
    const bucket = stats.buckets.find(entry => entry.sessionCount === 1)!;
    expect(strengthBucketValue(bucket, 'volume')).toBeNull();
    expect(strengthBucketValue(bucket, 'duration')).toBeNull();
    const development = buildDevelopmentFacts({
      sessions: [session],
      runs: [],
      goal: '',
      now,
    });
    expect(development.current.strengthCompletedSets).toBe(1);
    expect(development.strengthHistory.totalSessions).toBe(1);
    expect(development.strengthHistory.sessions[0].endTime).toBeUndefined();
  });

  it('rechnet Pfund um, zählt Aufwärmen getrennt und erhält unbekannte Übungen', () => {
    const parsed = parseStrongCsvPreview(
      'Date;Workout Name;Exercise Name;Set Order;Weight (lbs);Reps;Seconds\n2026-03-08 10:00:00;Push;Bench Press (Barbell);W;100;8;\n2026-03-08 10:00:00;Push;Bench Press (Barbell);1;120;8;\n2026-03-08 10:00:00;Push;Eigene Übung;2;;;30',
    );
    const session = importedStrengthSession(parsed.workouts[0]);
    expect(session.exercises[0].sets[0].actualWeightKg).toBeCloseTo(45.359237);
    expect(exerciseBreakdown(session)[0]).toMatchObject({
      workingSets: 1,
      warmupSets: 1,
    });
    expect(session.exercises[1].sets[0]).toMatchObject({
      actualSeconds: 30,
      planned: { kind: 'timed', loadKind: 'unknown' },
    });
    expect(
      buildStrengthStatisticsView([session], '4w', now).muscles.unassignedSets,
    ).toBe(1);
  });

  it('mischt native und importierte Einheiten ohne doppelte IDs und respektiert Zeiträume', () => {
    const imported = importedStrengthSession(workout());
    const local = strengthSession('local', now - 2 * 86400000, [
      [
        'barbell_bench_press',
        'Bankdrücken',
        [{ weightKg: 70, reps: 8, at: 5 }],
      ],
    ]);
    const old = importedStrengthSession(
      workout({ id: 'old', time: now - 60 * 86400000 }),
    );
    const view = buildStrengthStatisticsView(
      [local, imported, imported, old],
      '4w',
      now,
    );
    expect(view.totals.sessionCount).toBe(2);
    expect(view.totals.sets).toBe(2);
    expect(view.exercises[0].sessions).toBe(2);
    expect(
      view.records.find(record => record.id === 'biggest-volume')?.sessionIds,
    ).toEqual([imported.id]);
    expect(strengthBucketValue(view.buckets[0], 'sessions')).toBe(0);
  });
});
