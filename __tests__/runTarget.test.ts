import {
  NO_RUN_TARGET,
  RUN_TARGET_VERSION,
  formatGoalDistance,
  formatGoalDuration,
  intervalPhases,
  normalizeRunTarget,
  normalizeRunTargetMemory,
  paceForFinishTime,
  parseDurationInput,
  parseGoalKilometers,
  parseGoalMinutes,
  parsePaceInput,
  plannedFinishSeconds,
  rememberRunTarget,
  runTargetLabel,
  stepTargetPace,
  targetProgressLabel,
  withGoalKind,
  withGuideKind,
  type RunTarget,
} from '../src/domain/runTarget';

const pace = (patch: Record<string, unknown> = {}): RunTarget =>
  normalizeRunTarget({
    kind: 'pace',
    version: 3,
    secondsPerKm: 300,
    mode: 'range',
    output: 'both',
    ...patch,
  });
const intervals = normalizeRunTarget({
  kind: 'intervals',
  version: 3,
  output: 'both',
  intervals: {
    repeats: 6,
    work: { kind: 'distance', meters: 400 },
    restSeconds: 90,
    warmupSeconds: 0,
  },
});

describe('Run target', () => {
  it('parses only explicit supported pace values', () => {
    expect(parsePaceInput('5:30')).toBe(330);
    expect(parsePaceInput('05:07')).toBe(307);
    expect(parsePaceInput('5:75')).toBeNull();
    expect(parsePaceInput('schnell')).toBeNull();
  });

  it('keeps invalid or old settings inactive', () => {
    expect(normalizeRunTarget({ kind: 'pace', secondsPerKm: 330 })).toEqual(
      NO_RUN_TARGET,
    );
    expect(
      normalizeRunTarget({
        kind: 'heart_rate',
        version: 1,
        minBpm: 170,
        maxBpm: 150,
        output: 'both',
      }),
    ).toEqual(NO_RUN_TARGET);
  });

  it('reads older targets as they were saved, without a goal', () => {
    const old = normalizeRunTarget({
      kind: 'pace',
      version: 2,
      secondsPerKm: 330,
      mode: 'ceiling',
      output: 'voice',
      goal: { kind: 'distance', meters: 5000 },
    });
    expect(old).toMatchObject({ kind: 'pace', version: 2, mode: 'ceiling' });
    expect(old.goal).toBeUndefined();
    expect(runTargetLabel(old)).toBe('Nicht schneller als 5:30 /km');
    // Intervals exist only from version 3.
    expect(normalizeRunTarget({ ...intervals, version: 2 })).toEqual(
      NO_RUN_TARGET,
    );
  });

  it('combines how far and what to run by', () => {
    const fiveK = pace({ goal: { kind: 'distance', meters: 5000 } });
    expect(fiveK.goal).toEqual({ kind: 'distance', meters: 5000 });
    expect(runTargetLabel(fiveK)).toBe('5 km · 5:00 /km');
    expect(plannedFinishSeconds(fiveK)).toBe(1500);
    expect(
      plannedFinishSeconds(pace({ mode: 'ceiling', goal: fiveK.goal })),
    ).toBeUndefined();
    const half = normalizeRunTarget({
      kind: 'none',
      version: 3,
      goal: { kind: 'time', seconds: 1800 },
    });
    expect(runTargetLabel(half)).toBe('30 min');
    expect(runTargetLabel(NO_RUN_TARGET)).toBe('Nur tracken');
    expect(runTargetLabel(intervals)).toBe('6 × 400 m · 1:30 Pause');
    // Intervals set their own volume and never carry a goal.
    expect(
      normalizeRunTarget({
        ...intervals,
        goal: { kind: 'time', seconds: 1800 },
      }).goal,
    ).toBeUndefined();
    // Goals outside the bounds are dropped, the rest stays.
    const tooShort = pace({ goal: { kind: 'distance', meters: 50 } });
    expect(tooShort.kind).toBe('pace');
    expect(tooShort.goal).toBeUndefined();
  });

  it('switches chips with remembered values', () => {
    const memory = rememberRunTarget(
      {},
      pace({ secondsPerKm: 285, goal: { kind: 'distance', meters: 10000 } }),
    );
    const open = withGoalKind(pace(), 'open', memory);
    expect(open.goal).toBeUndefined();
    expect(withGoalKind(open, 'distance', memory).goal).toEqual({
      kind: 'distance',
      meters: 10000,
    });
    expect(withGoalKind(open, 'time', memory).goal).toEqual({
      kind: 'time',
      seconds: 1800,
    });
    const tracked = withGuideKind(
      withGoalKind(open, 'distance', memory),
      'none',
      memory,
    );
    expect(tracked).toMatchObject({ kind: 'none', goal: { meters: 10000 } });
    expect(withGuideKind(tracked, 'pace', memory)).toMatchObject({
      kind: 'pace',
      secondsPerKm: 285,
      version: RUN_TARGET_VERSION,
      goal: { meters: 10000 },
    });
    const toIntervals = withGuideKind(tracked, 'intervals', memory);
    expect(toIntervals.kind).toBe('intervals');
    expect(toIntervals.goal).toBeUndefined();
    expect(withGuideKind(tracked, 'heart_rate', memory)).toMatchObject({
      minBpm: 130,
      maxBpm: 150,
    });
    expect(
      normalizeRunTargetMemory(JSON.parse(JSON.stringify(memory))),
    ).toEqual(memory);
    expect(
      normalizeRunTargetMemory({ goalMeters: -1, pace: { secondsPerKm: 5 } }),
    ).toEqual({});
  });

  it('parses goal entries strictly', () => {
    expect(parseGoalKilometers('5')).toBe(5000);
    expect(parseGoalKilometers('10,5')).toBe(10500);
    expect(parseGoalKilometers('0')).toBeNull();
    expect(parseGoalKilometers('weit')).toBeNull();
    expect(parseGoalMinutes('30')).toBe(1800);
    expect(parseGoalMinutes('30.5')).toBeNull();
    expect(parseDurationInput('25:00')).toBe(1500);
    expect(parseDurationInput('1:45:00')).toBe(6300);
    expect(parseDurationInput('1:75:00')).toBeNull();
    expect(paceForFinishTime(5000, 1500)).toBe(300);
    expect(paceForFinishTime(5000, 60)).toBeNull();
    expect(formatGoalDistance(10500)).toBe('10,5 km');
    expect(formatGoalDistance(800)).toBe('800 m');
    expect(formatGoalDuration(5400)).toBe('1:30 h');
  });

  it('shows what is left of the goal and of the interval phase', () => {
    const fiveK = pace({ goal: { kind: 'distance', meters: 5000 } });
    expect(
      targetProgressLabel(fiveK, {
        durationSeconds: 900,
        distanceMeters: 3170,
      }),
    ).toBe('Noch 1,83 km');
    expect(
      targetProgressLabel(fiveK, {
        durationSeconds: 1500,
        distanceMeters: 5010,
      }),
    ).toBe('Ziel erreicht');
    expect(
      targetProgressLabel(pace(), {
        durationSeconds: 900,
        distanceMeters: 3000,
      }),
    ).toBeUndefined();
    expect(
      targetProgressLabel(intervals, {
        durationSeconds: 10,
        distanceMeters: 40,
      }),
    ).toBe('Intervall 1 von 6 · noch 360 m');
    expect(
      targetProgressLabel(intervals, {
        durationSeconds: 130,
        distanceMeters: 420,
        intervalState: { phase: 1, startSeconds: 100, startMeters: 410 },
      }),
    ).toBe('Pause · noch 1:00');
  });

  it('orders interval phases like Kotlin', () => {
    if (intervals.kind !== 'intervals') throw new Error('intervals');
    expect(
      intervalPhases({
        ...intervals.intervals,
        repeats: 2,
        warmupSeconds: 300,
      }).map(p => p.kind),
    ).toEqual(['warmup', 'work', 'rest', 'work', 'done']);
  });

  it('steps the target pace in five seconds and stays in range', () => {
    expect(stepTargetPace(330, 1)).toBe(335);
    expect(stepTargetPace(330, -1)).toBe(325);
    // An awkward target pace derived from the goal time snaps to the grid.
    expect(stepTargetPace(331.4, 1)).toBe(335);
    expect(stepTargetPace(331.4, -1)).toBe(330);
    expect(stepTargetPace(120, -1)).toBeNull();
    expect(stepTargetPace(1200, 1)).toBeNull();
    expect(stepTargetPace(Number.NaN, 1)).toBeNull();
  });
});
