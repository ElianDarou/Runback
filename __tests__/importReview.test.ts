import {
  chosenCounts,
  defaultImportChoice,
  formatCount,
  hasNewData,
  importBatchCounts,
  importBatchTitle,
  readImportBatches,
  readImportPreview,
  toggleIn,
  wellnessGroups,
} from '../src/domain/importReview';
import {
  STRONG_DURATION_MODEL,
  isStrongDurationSuspect,
  parseStrongCsvPreview,
  strongDurationLimitSeconds,
} from '../src/domain/vendorImports';
import { importedStrengthSession } from '../src/domain/strengthImports';

const rawPreview = {
  runs: { new: 3, duplicates: 2, deleted: 0 },
  wellness: { weight: 4, body_waist: 2, body_hips: 1, resting_hr: 0 },
  strength: {
    duplicates: 1,
    omitted: 0,
    workouts: [
      {
        id: 'strong:a',
        time: 1_700_000_000_000,
        name: 'Pull',
        source: 'strong',
        sets: 1,
        durationSeconds: 54578,
        durationSuspect: true,
        incomplete: false,
      },
      {
        id: 'strong:b',
        time: 1_699_000_000_000,
        name: 'Push',
        source: 'strong',
        sets: 18,
        durationSeconds: 0,
        durationSuspect: false,
      },
      { id: 42, time: 1 },
    ],
  },
};

describe('import preview', () => {
  it('reads native preview data without inventing values', () => {
    const preview = readImportPreview(rawPreview)!;
    expect(preview.runs).toEqual({ new: 3, duplicates: 2, deleted: 0 });
    expect(preview.wellness).toEqual({ weight: 4, body_waist: 2, body_hips: 1 });
    expect(preview.strength.workouts).toHaveLength(2);
    // Eine Dauer von 0 ist unbekannt, keine Zahl.
    expect(preview.strength.workouts[1].durationSeconds).toBeNull();
    expect(readImportPreview(null)).toBeNull();
  });

  it('chooses everything new by default but keeps suspect durations open', () => {
    const preview = readImportPreview(rawPreview)!;
    const choice = defaultImportChoice(preview);
    expect(choice.runs).toBe(true);
    expect(choice.strength).toBe(true);
    expect(choice.templateSuggestions).toBe(true);
    expect(choice.keepDurationIds).toEqual([]);
    expect(choice.wellnessKinds).toEqual(['body_hips', 'body_waist', 'weight']);
    expect(chosenCounts(preview, choice)).toEqual({
      runs: 3,
      strength: 2,
      wellness: 7,
    });
    expect(
      chosenCounts(preview, {
        ...choice,
        runs: false,
        excludedStrengthIds: ['strong:a'],
        wellnessKinds: ['weight'],
      }),
    ).toEqual({ runs: 0, strength: 1, wellness: 4 });
    expect(hasNewData(preview)).toBe(true);
    expect(
      hasNewData(
        readImportPreview({ runs: { duplicates: 4 }, strength: {}, wellness: {} })!,
      ),
    ).toBe(false);
  });

  it('groups wellness kinds by the word the user sees', () => {
    const groups = wellnessGroups({ weight: 4, body_waist: 2, body_hips: 1 });
    expect(groups).toEqual([
      { label: 'Gewicht', kinds: ['weight'], count: 4 },
      { label: 'Körpermaße', kinds: ['body_hips', 'body_waist'], count: 3 },
    ]);
    expect(toggleIn(['a', 'b'], 'a', false)).toEqual(['b']);
    expect(toggleIn(['b'], 'a', true)).toEqual(['b', 'a']);
    expect(toggleIn(['a'], 'a', true)).toEqual(['a']);
  });
});

describe('import batches', () => {
  it('names batches by source and counts in German format', () => {
    const batches = readImportBatches({
      batches: [
        {
          id: 'b1',
          createdAt: 5,
          vendors: ['strong'],
          files: ['strong.csv'],
          templateSuggestions: false,
          counts: { runs: 0, strength: 53, wellness: 1234 },
        },
        {
          id: 'legacy:import',
          legacy: true,
          source: 'import',
          counts: { runs: 1 },
        },
        { nope: true },
      ],
    });
    expect(batches).toHaveLength(2);
    expect(importBatchTitle(batches[0])).toBe('Strong');
    expect(batches[0].templateSuggestions).toBe(false);
    expect(importBatchCounts(batches[0])).toBe(
      '53 Krafteinheiten · 1.234 Kontextwerte',
    );
    expect(importBatchTitle(batches[1])).toBe('Dateien · früherer Import');
    expect(importBatchCounts(batches[1])).toBe('1 Lauf');
    expect(formatCount(1234567)).toBe('1.234.567');
  });
});

describe('unfinished Strong workouts', () => {
  it('flags durations that fit no set count (same rule as Kotlin)', () => {
    expect(STRONG_DURATION_MODEL).toBe('strong-duration-v1');
    expect(strongDurationLimitSeconds(18)).toBe(138 * 60);
    expect(isStrongDurationSuspect(255 * 60, 18)).toBe(true);
    expect(isStrongDurationSuspect(127 * 60, 20)).toBe(false);
    expect(isStrongDurationSuspect(null, 1)).toBe(false);
    const parsed = parseStrongCsvPreview(
      'Date;Workout Name;Duration (sec);Exercise Name;Set Order;Weight (kg);Reps\n' +
        '2026-07-28 21:03:31;Pull;20000;Row;1;40;8\n' +
        '2026-07-29 18:00:00;Pull;1800;Row;1;40;8\n',
    );
    expect(parsed.workouts.map(w => w.durationSuspect)).toEqual([true, false]);
    expect(parsed.workouts[0].durationSeconds).toBe(20000);
  });

  it('shows a rejected duration as unknown end, keeping the reported value', () => {
    const session = importedStrengthSession({
      id: 'strong:late',
      time: 1_700_000_000_000,
      name: 'Pull',
      source: 'strong',
      modelVersion: 'strong-import-v3',
      durationSeconds: null,
      reportedDurationSeconds: 54578,
      durationRejected: {
        reason: 'not_finished',
        modelVersion: STRONG_DURATION_MODEL,
        decidedBy: 'default',
      },
      workoutNotes: '',
      sets: [
        {
          exercise: 'Row',
          setOrder: 1,
          weight: 40,
          weightUnit: 'kg',
          reps: 8,
          distance: null,
          seconds: null,
          rpe: null,
          notes: '',
        },
      ],
    });
    expect(session.endTime).toBeUndefined();
    expect(session.importSource?.rejectedDurationSeconds).toBe(54578);
  });
});
