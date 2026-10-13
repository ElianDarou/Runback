import { analyzeRun, MODEL_VERSION, scheduleCue } from '../src/domain';
import type { RunSummary } from '../src/domain';

const segment = (durationSeconds: number, id?: string) => ({
  id,
  distanceMeters: 500,
  durationSeconds,
  gradePercent: 0,
  phase: 'work' as const,
});

const run = (overrides: Partial<RunSummary> = {}): RunSummary => ({
  id: 'run-1',
  startTime: 0,
  endTime: 1200000,
  durationSeconds: 1200,
  distanceMeters: 2000,
  purpose: 'easy',
  source: 'test',
  status: 'complete',
  segments: [
    segment(300, 's1'),
    segment(300, 's2'),
    segment(360, 's3'),
    segment(360, 's4'),
  ],
  ...overrides,
});

describe('domain rules', () => {
  it('describes the pace split as an observation, without a recommendation', () => {
    const result = analyzeRun(run());

    expect(result.model_version).toBe(MODEL_VERSION);
    expect(result.pacing?.fadePercent).toBeCloseTo(20, 5);
    expect(result.classification).toMatch(
      /zweite Laufhälfte war 20,0 % langsamer/,
    );
    expect(Object.keys(result).sort()).toEqual(
      [
        'classification',
        'effort',
        'inputSources',
        'model_version',
        'pacing',
        'quality',
        'segmentIds',
      ].sort(),
    );
  });

  it('reports the split for every run type, intervals included', () => {
    const result = analyzeRun(run({ purpose: 'intervals' }));
    expect(result.pacing).toBeDefined();
    expect(result.classification).toMatch(/langsamer/);
    expect(analyzeRun(run({ purpose: 'unknown' })).pacing).toBeDefined();
  });

  it('names a faster second half as faster', () => {
    const result = analyzeRun(
      run({
        segments: [segment(360), segment(360), segment(300), segment(300)],
      }),
    );
    expect(result.classification).toMatch(/schneller/);
  });

  it('reports insufficient data without inventing a pace split', () => {
    const result = analyzeRun(
      run({ durationSeconds: 0, distanceMeters: 0, segments: [] }),
    );

    expect(result.pacing).toBeUndefined();
    expect(result.quality.paceUsable).toBe(false);
    expect(result.classification).toMatch(
      /reichen für eine Tempoauswertung nicht/,
    );
  });

  it('keeps pace analysis usable when sample count and heart-rate data are corrupt', () => {
    const result = analyzeRun(run({ samples: Number.NaN, avgHeartRate: 999 }));

    expect(result.quality.paceUsable).toBe(true);
    expect(
      result.quality.issues.some(issue => issue.code === 'implausible_hr'),
    ).toBe(false);
    expect(result.pacing).toBeDefined();
  });

  it('enforces cue hourly budget and per-rule cooldown', () => {
    const input = {
      now: 3600000,
      enabled: true,
      purpose: 'easy' as const,
      targetPaceSecondsPerKm: 360,
      currentPaceSecondsPerKm: 320,
      history: [],
      hourlyBudget: 1,
    };
    const first = scheduleCue(input);
    expect(first?.ruleId).toBe('ease-start');

    expect(scheduleCue({ ...input, history: [first!] })).toBeUndefined();
    expect(
      scheduleCue({
        ...input,
        history: [{ ...first!, at: input.now - 60000 }],
      }),
    ).toBeUndefined();
    expect(
      scheduleCue({
        ...input,
        history: [{ ...first!, at: input.now - 3600001 }],
      }),
    ).toBeDefined();
  });
});
