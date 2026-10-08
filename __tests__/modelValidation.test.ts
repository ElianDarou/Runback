import {
  modelIsUnlocked,
  validateModel,
  type ModelValidationInput,
} from '../src/domain/modelValidation';
import type { StrengthSession } from '../src/domain/strength';

const hour = 60 * 60 * 1000;
const base = 3_000_000;

const session: StrengthSession = {
  id: 'validation-session',
  kind: 'strength',
  name: 'Prüfung',
  startTime: base,
  endTime: base + 60 * 1000,
  status: 'finished',
  currentExercise: 0,
  modelVersion: 'strength-v1',
  catalogVersion: 'catalog-v1',
  exercises: [{
    exerciseId: 'leg_extension',
    name: 'Beinstrecker',
    sets: [{
      id: 'validation-set',
      planned: {
        kind: 'failure',
        loadKind: 'kg',
        reps: 10,
        weightKg: 60,
        restSeconds: 60,
      },
      actualReps: 10,
      actualWeightKg: 60,
      completedAt: base,
    }],
  }],
};

const input: ModelValidationInput = {
  sessions: [session],
  reports: [
    { at: base + 12 * hour, regionId: 'quad_l', value: 2 },
    { at: base + 24 * hour, regionId: 'quad_l', value: 5 },
    { at: base + 36 * hour, regionId: 'quad_l', value: 4 },
    { at: base + 48 * hour, regionId: 'quad_l', value: 2 },
  ],
};

describe('Model validation', () => {
  it('returns the three comparison values and calibration classes', () => {
    const result = validateModel(input);
    expect(result.holdout.count).toBeGreaterThan(0);
    expect(result.holdout.alwaysZeroMae).not.toBeNull();
    expect(result.holdout.personalMedianMae).not.toBeNull();
    expect(result.holdout.repeatLastMae).not.toBeNull();
    expect(result.calibration.bins).toHaveLength(5);
    expect(result.model_version).toBe('muscle-model-v3');
  });

  it('stays locked without a data basis and names the reasons', () => {
    const verdict = modelIsUnlocked({ sessions: [], reports: [] });
    expect(verdict.unlocked).toBe(false);
    expect(verdict.reasons.length).toBeGreaterThan(0);
    expect(verdict.checks.failures.passes).toBe(true);
    expect(verdict.regions_version).toBe('regions-v1');
    expect(verdict.catalog_version).toBe('catalog-v2');
  });

  it('counts reports of a recovery course as one block and requires a noticeable gain', () => {
    const result = validateModel(input);
    // Four reports after the same session: one block, not an independent experience.
    expect(result.holdout.blocks).toBe(1);
    expect(result.holdout.passes).toBe(false);
    const verdict = modelIsUnlocked(input);
    expect(verdict.reasons.map(reason => reason.code)).toEqual(
      expect.arrayContaining(['not_enough_holdouts', 'not_enough_blocks']),
    );
    expect(verdict.unlocked).toBe(false);
  });

  it('ignores a calibration passed in from outside so no future knowledge flows in', () => {
    const plain = validateModel(input);
    const leaked = validateModel({
      ...input,
      calibration: {
        coefficients: { 'leg_extension:quad': 42 },
      } as unknown as ModelValidationInput['calibration'],
    });
    expect(leaked.holdouts.map(item => item.predicted)).toEqual(
      plain.holdouts.map(item => item.predicted),
    );
  });

  it('handles contradictory reports without crashing', () => {
    expect(() => validateModel({
      sessions: [session],
      reports: [
        { at: base + hour, regionId: 'quad_l', value: 0 },
        { at: base + hour, regionId: 'quad_l', value: 10 },
        { at: base + 24 * hour, regionId: 'quad_l', value: 3 },
      ],
    })).not.toThrow();
  });
});
