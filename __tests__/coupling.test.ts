import {
  evaluateCoupling,
  searchMonthlyPlan,
  simulatePlannedFreshness,
  type CoupledRun,
} from '../src/domain/coupling';
import type { RunSummary } from '../src/domain/types';

const DAY = 24 * 60 * 60 * 1000;

function run(id: string, index: number, fadePercent: number): RunSummary {
  const startTime = index * DAY;
  const lateDuration = 300 * (1 + fadePercent / 100);
  return {
    id,
    startTime,
    endTime: startTime + 20 * 60 * 1000,
    durationSeconds: 20 * 60,
    distanceMeters: 4000,
    purpose: 'easy',
    source: 'test',
    status: 'finished',
    segments: [
      { id: `${id}-1`, distanceMeters: 1000, durationSeconds: 300 },
      { id: `${id}-2`, distanceMeters: 1000, durationSeconds: 300 },
      { id: `${id}-3`, distanceMeters: 1000, durationSeconds: lateDuration },
      { id: `${id}-4`, distanceMeters: 1000, durationSeconds: lateDuration },
    ],
  };
}

function coupledRuns(count: number): CoupledRun[] {
  return Array.from({ length: count }, (_, index) => ({
    run: run(`run-${index}`, index, 4 + index),
    regionBase: 'legs',
  }));
}

describe('Coupling of run and strength training', () => {
  it('can be switched off completely without calling the freshness source', () => {
    const result = evaluateCoupling({
      enabled: false,
      runs: coupledRuns(10),
      freshness: () => {
        throw new Error('darf bei abgeschalteter Kopplung nicht laufen');
      },
    });
    expect(result.mode).toBe('separate');
    expect(result.couplingEnabled).toBe(false);
    expect(result.adjustedFadePercent).toBeNull();
    expect(result.causalClaim).toBe(false);
  });

  it('uses only the 10-point caliper below ten runs', () => {
    const entries = coupledRuns(3);
    const freshness: Record<string, number> = {
      '0': 50,
      '1': 55,
      '2': 90,
    };
    const result = evaluateCoupling({
      enabled: true,
      runs: entries,
      freshness: (_region, at) => freshness[String(at / DAY)] ?? null,
    });
    expect(result.assessment).toBe('observation');
    expect(result.method).toBe('caliper_matching');
    expect(result.matchedPairs).toHaveLength(1);
    expect(result.matchedPairs?.[0].freshnessDifference).toBeLessThanOrEqual(
      10,
    );
  });

  it('counts old long runs as easy runs and leaves fast runs out', () => {
    const entries = coupledRuns(3).map((entry, index) => ({
      ...entry,
      run: {
        ...entry.run,
        purpose: index === 1 ? ('long' as const) : entry.run.purpose,
      },
    }));
    const freshness: Record<string, number> = { '0': 50, '1': 55, '2': 90 };
    const lookup = (_region: string, at: number) =>
      freshness[String(at / DAY)] ?? null;
    const mixed = evaluateCoupling({
      enabled: true,
      runs: entries,
      freshness: lookup,
    });
    expect(mixed.model_version).toBe('run-strength-coupling-v2');
    expect(mixed.matchedPairs).toHaveLength(1);
    const withFast = entries.map((entry, index) =>
      index === 1
        ? { ...entry, run: { ...entry.run, purpose: 'race' as const } }
        : entry,
    );
    expect(
      evaluateCoupling({ enabled: true, runs: withFast, freshness: lookup })
        .matchedPairs ?? [],
    ).toHaveLength(0);
  });

  it('orients caliper pairs by freshness instead of date', () => {
    const result = evaluateCoupling({
      enabled: true,
      runs: [
        { run: run('älter', 0, 8), regionBase: 'legs' },
        { run: run('frischer', 1, 3), regionBase: 'legs' },
      ],
      freshness: (_region, at) => (at === 0 ? 50 : 55),
    });
    expect(result.matchedPairs?.[0]).toMatchObject({
      firstRunId: 'frischer',
      secondRunId: 'älter',
      freshnessDifference: 5,
    });
    expect(result.matchedPairs?.[0].fadeDifferencePercent).toBeCloseTo(5);
  });

  it('matches old long and easy runs by measured duration and keeps different lengths out', () => {
    const entries = coupledRuns(3).map((entry, index) => ({
      ...entry,
      run: {
        ...entry.run,
        purpose: index === 0 ? ('easy' as const) : ('long' as const),
        durationSeconds: [1200, 1260, 3600][index],
        endTime: entry.run.startTime + [1200, 1260, 3600][index] * 1000,
        distanceMeters: entry.run.distanceMeters * [1, 1.05, 3][index],
        segments: entry.run.segments!.map(segment => ({
          ...segment,
          durationSeconds: segment.durationSeconds * [1, 1.05, 3][index],
          distanceMeters: segment.distanceMeters * [1, 1.05, 3][index],
        })),
      },
    }));
    const input = {
      enabled: true,
      runs: entries,
      freshness: (_region: string, at: number) => 50 + (at / DAY) * 5,
    };
    const result = evaluateCoupling(input);
    expect(result.comparableRunIds).toEqual(['run-0', 'run-1']);
    expect(result.matchedPairs).toHaveLength(1);
    expect(
      evaluateCoupling({ ...input, runs: [...entries].reverse() }),
    ).toEqual(result);
  });

  it('picks the largest region proxy regardless of input order', () => {
    const runs = coupledRuns(5).map((entry, index) => ({
      ...entry,
      regionBase: index < 2 ? 'calf' : 'legs',
    }));
    const freshness = (_region: string, at: number) => 50 + at / DAY;
    const forward = evaluateCoupling({ enabled: true, runs, freshness });
    const reversed = evaluateCoupling({
      enabled: true,
      runs: [...runs].reverse(),
      freshness,
    });
    expect(forward.comparableRunIds).toEqual(['run-2', 'run-3', 'run-4']);
    expect(reversed.comparableRunIds).toEqual(forward.comparableRunIds);
  });

  it('switches to the small regression from ten comparable runs on', () => {
    const entries = coupledRuns(10);
    const result = evaluateCoupling({
      enabled: true,
      runs: entries,
      freshness: (_region, at) => 90 - (at / DAY) * 2,
    });
    expect(result.assessment).toBe('observation');
    expect(result.method).toBe('covariate_regression');
    expect(result.regression?.covariates).toEqual(['100_minus_leg_freshness']);
    // No adjusted value without a standard error and interval.
    expect(result.regression?.standardErrors).toHaveLength(2);
    expect(result.regression?.residualDegreesOfFreedom).toBeGreaterThanOrEqual(
      8,
    );
    const [lower, upper] = result.regression!.adjustedFadeInterval;
    expect(lower).toBeLessThanOrEqual(result.adjustedFadePercent as number);
    expect(upper).toBeGreaterThanOrEqual(result.adjustedFadePercent as number);
    expect(result.causalClaim).toBe(false);
  });

  it('returns no number when the data is insufficient', () => {
    const result = evaluateCoupling({
      enabled: true,
      runs: [coupledRuns(1)[0]],
      freshness: () => 50,
    });
    expect(result.assessment).toBe('insufficient_evidence');
    expect(result.adjustedFadePercent).toBeNull();
  });

  it('simulates planned freshness per appointment and region', () => {
    const result = simulatePlannedFreshness(
      [
        {
          id: 'lauf',
          kind: 'run',
          at: 100,
          regionBases: ['quad', 'calf'],
          important: true,
        },
      ],
      (region, at) => (region === 'quad' ? at : 80),
    );
    expect(result[0].minimumFreshness).toBe(80);
    expect(result[0].assessment).toBe('observation');
  });

  it('enumerates the small weekday space completely and keeps fixed dates', () => {
    const weekStartAt = 0;
    const result = searchMonthlyPlan({
      enabled: true,
      weekStartAt,
      weeks: 4,
      freshness: (_region, at) => 50 + ((at / DAY) % 7),
      sessions: [
        {
          id: 'wichtig',
          kind: 'run',
          regionBases: ['legs'],
          important: true,
          existingWeekday: 0,
        },
        {
          id: 'fix',
          kind: 'strength',
          regionBases: ['legs'],
          important: false,
          fixedWeekday: 2,
        },
      ],
    });
    expect(result.assessment).toBe('observation');
    expect(result.selected?.assignments).toContainEqual({
      sessionId: 'fix',
      weekday: 2,
    });
    expect(result.selected?.assignments).toContainEqual({
      sessionId: 'wichtig',
      weekday: 6,
    });
    expect(result.verdict).toBe('change_plan');
    expect(result.suggestion?.checkCriterion).toBeTruthy();
  });

  it('explicitly gives no rating in the plan without a freshness source', () => {
    const result = searchMonthlyPlan({
      enabled: true,
      weekStartAt: 0,
      sessions: [
        {
          id: 'wichtig',
          kind: 'run',
          regionBases: ['legs'],
          important: true,
        },
      ],
    });
    expect(result.verdict).toBe('not_assessable');
    expect(result.selected).toBeNull();
  });

  it('rejects a plan with colliding fixed dates', () => {
    const result = searchMonthlyPlan({
      enabled: true,
      weekStartAt: 0,
      freshness: () => 80,
      sessions: [
        {
          id: 'lauf',
          kind: 'run',
          regionBases: ['legs'],
          important: true,
          fixedWeekday: 2,
        },
        {
          id: 'kraft',
          kind: 'strength',
          regionBases: ['legs'],
          important: false,
          fixedWeekday: 2,
        },
      ],
    });
    expect(result.verdict).toBe('not_assessable');
    expect(result.selected).toBeNull();
  });

  it('rejects duplicate session ids instead of overwriting them in the mapping', () => {
    const result = searchMonthlyPlan({
      enabled: true,
      weekStartAt: 0,
      freshness: () => 80,
      sessions: [
        {
          id: 'doppelt',
          kind: 'run',
          regionBases: ['legs'],
          important: true,
        },
        {
          id: 'doppelt',
          kind: 'strength',
          regionBases: ['legs'],
          important: false,
        },
      ],
    });
    expect(result.verdict).toBe('not_assessable');
    expect(result.selected).toBeNull();
  });

  it('rejects appointments outside the day window', () => {
    const result = searchMonthlyPlan({
      enabled: true,
      weekStartAt: 0,
      freshness: () => 80,
      sessions: [
        {
          id: 'lauf',
          kind: 'run',
          regionBases: ['legs'],
          important: true,
          timeOfDayMs: 24 * DAY,
        },
      ],
    });
    expect(result.verdict).toBe('not_assessable');
    expect(result.selected).toBeNull();
  });
});
