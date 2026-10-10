import {
  PURPOSE_HINT_VERSION,
  asksPurposeOnOpen,
  likelyPurpose,
  likelyPurposeReason,
  purposeHintReason,
  suggestRunPurpose,
} from '../src/domain/purposeHint';
import { NO_RUN_TARGET, normalizeRunTarget } from '../src/domain/runTarget';
import type { MaxHeartRate } from '../src/domain/insights';
import type { RunSummary, SegmentAggregate } from '../src/domain/types';

const DAY = 24 * 60 * 60 * 1000;
const START = Date.UTC(2026, 9, 1, 7);
const MAX: MaxHeartRate = { value: 190, source: 'setting' };

const kmSegments = (paces: number[]): SegmentAggregate[] =>
  paces.map(pace => ({ distanceMeters: 1000, durationSeconds: pace }));

const run = (patch: Partial<RunSummary> = {}): RunSummary => ({
  id: 'run',
  startTime: START,
  endTime: START + 1800 * 1000,
  durationSeconds: 1500,
  distanceMeters: 5000,
  purpose: 'free',
  source: 'phone',
  status: 'finished',
  segments: kmSegments([300, 300, 302, 298, 300]),
  ...patch,
});

const history = (distanceMeters: number, count = 4): RunSummary[] =>
  Array.from({ length: count }, (_, index) =>
    run({
      id: `old-${index}`,
      startTime: START - (index + 1) * 2 * DAY,
      distanceMeters,
    }),
  );

describe('suggestRunPurpose', () => {
  it('recognizes the daily 5 km timed run by heart rate, not by pace', () => {
    const hint = suggestRunPurpose(
      run({ avgHeartRate: 172, heartRateCoverage: 0.95 }),
      history(5000),
      MAX,
    );
    expect(hint?.purpose).toBe('race');
    expect(hint?.signals).toEqual(['heart_rate_high', 'pace_even']);
    expect(hint?.model_version).toBe(PURPOSE_HINT_VERSION);
    expect(hint?.maxHeartRate).toEqual(MAX);
  });

  it('suggests an easy run at a low heart rate', () => {
    const hint = suggestRunPurpose(
      run({ avgHeartRate: 140, heartRateCoverage: 0.9 }),
      history(5000),
      MAX,
    );
    expect(hint?.purpose).toBe('easy');
    expect(purposeHintReason(hint!)).toBe(
      'niedriger Puls · gleichmäßiges Tempo',
    );
  });

  it('calls a clearly longer easy run easy, since long runs are easy runs now', () => {
    const hint = suggestRunPurpose(
      run({
        distanceMeters: 12000,
        rpe: { breathing: 3, recordedAt: START },
        segments: kmSegments(Array(12).fill(330)),
      }),
      history(6000),
      MAX,
    );
    expect(hint?.purpose).toBe('easy');
    expect(hint?.signals).not.toContain('longer_than_usual');
    expect(hint?.baselineRunIds).toBeUndefined();
    expect(hint?.model_version).toBe('runback-purpose-hint-3');
    // Without heart rate no max heart rate was used, so none appears in the trace.
    expect(hint?.maxHeartRate).toBeUndefined();
  });

  it('stays with an easy run without comparison runs', () => {
    const hint = suggestRunPurpose(
      run({ distanceMeters: 12000, rpe: { breathing: 3, recordedAt: START } }),
      [],
      MAX,
    );
    expect(hint?.purpose).toBe('easy');
  });

  it('recognizes strongly varying pace on a flat route as pace changes', () => {
    const hint = suggestRunPurpose(
      run({
        avgHeartRate: 168,
        heartRateCoverage: 0.9,
        elevationGainMeters: 20,
        segments: kmSegments([240, 380, 240, 380, 240, 380]),
      }),
      [],
      MAX,
    );
    expect(hint?.purpose).toBe('intervals');
    expect(hint?.signals).toContain('pace_varied');
  });

  const intervalRun = (patch: Partial<RunSummary>) =>
    run({
      avgHeartRate: 168,
      heartRateCoverage: 0.9,
      distanceMeters: 6000,
      segments: kmSegments([240, 380, 240, 380, 240, 380]),
      ...patch,
    });

  it('reads the elevation from the native recording', () => {
    const elevation = (ascentMeters: number) => ({
      model_version: 'elevation-1',
      available: true as const,
      source: 'barometer' as const,
      reference: 'start' as const,
      ascentMeters,
      descentMeters: ascentMeters,
      rejectedSamples: 0,
      hysteresisMeters: 2,
    });
    expect(
      suggestRunPurpose(intervalRun({ elevation: elevation(200) }), [], MAX),
    ).toBeUndefined();
    expect(
      suggestRunPurpose(intervalRun({ elevation: elevation(20) }), [], MAX)
        ?.purpose,
    ).toBe('intervals');
  });

  it('suggests no pace changes on hilly or unknown routes', () => {
    expect(
      suggestRunPurpose(intervalRun({ elevationGainMeters: 300 }), [], MAX),
    ).toBeUndefined();
    expect(suggestRunPurpose(intervalRun({}), [], MAX)).toBeUndefined();
    expect(
      suggestRunPurpose(
        intervalRun({
          elevationGainMeters: 300,
          elevation: {
            model_version: 'elevation-1',
            available: false,
            reason: 'Kein Barometer',
          },
        }),
        [],
        MAX,
      ),
    ).toBeUndefined();
  });

  it('needs heart rate or a breathing note for pace changes', () => {
    expect(
      suggestRunPurpose(
        intervalRun({
          avgHeartRate: undefined,
          heartRateCoverage: undefined,
          elevationGainMeters: 10,
        }),
        [],
        MAX,
      ),
    ).toBeUndefined();
  });

  it('does not take steady fading of a hard run for pace changes', () => {
    expect(
      suggestRunPurpose(
        run({
          avgHeartRate: 172,
          heartRateCoverage: 0.95,
          elevationGainMeters: 10,
          segments: kmSegments([240, 270, 300, 350, 400]),
        }),
        [],
        MAX,
      ),
    ).toBeUndefined();
  });

  it('stays silent without heart rate and without a breathing note', () => {
    expect(suggestRunPurpose(run(), history(5000), MAX)).toBeUndefined();
  });

  it('stays silent when heart rate and breathing contradict each other', () => {
    expect(
      suggestRunPurpose(
        run({
          avgHeartRate: 175,
          heartRateCoverage: 0.95,
          rpe: { breathing: 2, recordedAt: START },
        }),
        [],
        MAX,
      ),
    ).toBeUndefined();
  });

  it('uses no heart rate with too little coverage or without max heart rate', () => {
    expect(
      suggestRunPurpose(
        run({ avgHeartRate: 175, heartRateCoverage: 0.4 }),
        [],
        MAX,
      ),
    ).toBeUndefined();
    expect(
      suggestRunPurpose(
        run({ avgHeartRate: 175, heartRateCoverage: 0.95 }),
        [],
        undefined,
      ),
    ).toBeUndefined();
  });

  it('stays silent in the gray zone of the heart rate', () => {
    expect(
      suggestRunPurpose(
        run({ avgHeartRate: 155, heartRateCoverage: 0.95 }),
        [],
        MAX,
      ),
    ).toBeUndefined();
  });

  it('makes no suggestion for rides and false starts', () => {
    const hard = { avgHeartRate: 175, heartRateCoverage: 0.95 };
    expect(
      suggestRunPurpose(run({ ...hard, sport: 'cycling' }), [], MAX),
    ).toBeUndefined();
    expect(
      suggestRunPurpose(
        run({ ...hard, durationSeconds: 30, distanceMeters: 50 }),
        [],
        MAX,
      ),
    ).toBeUndefined();
  });
});

describe('likelyPurpose', () => {
  const fresh = run({ id: 'fresh', purpose: 'unknown' });
  const earlier = (
    purpose: RunSummary['purpose'],
    distanceMeters: number,
    days: number,
  ) =>
    run({
      id: `${purpose}-${distanceMeters}-${days}`,
      purpose,
      distanceMeters,
      startTime: START - days * DAY,
    });

  it('takes intervals from the start choice first', () => {
    const target = normalizeRunTarget({
      kind: 'intervals',
      version: 3,
      output: 'both',
      intervals: {
        repeats: 6,
        work: { kind: 'distance', meters: 400 },
        restSeconds: 90,
      },
    });
    const likely = likelyPurpose({
      run: { ...fresh, avgHeartRate: 120, heartRateCoverage: 0.95 },
      target,
      history: [],
      maxHeartRate: MAX,
    });
    expect(likely).toEqual({
      purpose: 'intervals',
      source: 'intervals_target',
    });
    expect(likelyPurposeReason(likely)).toBe('Mit Intervallen gestartet');
  });

  it('preselects fast for the daily 5 km by heart rate and keeps the hint for the trace', () => {
    const likely = likelyPurpose({
      run: { ...fresh, avgHeartRate: 172, heartRateCoverage: 0.95 },
      target: NO_RUN_TARGET,
      history: [earlier('easy', 5000, 2)],
      maxHeartRate: MAX,
    });
    expect(likely.purpose).toBe('race');
    expect(likely.source).toBe('hint');
    expect(likely.hint?.model_version).toBe(PURPOSE_HINT_VERSION);
    expect(likelyPurposeReason(likely)).toBe(
      'hoher Puls · gleichmäßiges Tempo',
    );
  });

  it('then follows the plan and a pace ceiling', () => {
    expect(
      likelyPurpose({
        run: fresh,
        history: [],
        maxHeartRate: undefined,
        plannedPurpose: 'long',
      }),
    ).toEqual({ purpose: 'easy', source: 'plan' });
    const ceiling = normalizeRunTarget({
      kind: 'pace',
      version: 3,
      secondsPerKm: 360,
      mode: 'ceiling',
      output: 'both',
    });
    expect(
      likelyPurpose({
        run: fresh,
        target: ceiling,
        history: [],
        maxHeartRate: undefined,
      }),
    ).toEqual({ purpose: 'easy', source: 'pace_ceiling' });
  });

  it('without signals uses the usual choice on similar runs, old values mapped', () => {
    const likely = likelyPurpose({
      run: fresh,
      history: [
        earlier('race', 5100, 1),
        earlier('race', 4900, 2),
        earlier('long', 15000, 3),
        earlier('easy', 5000, 4),
        earlier('free', 5000, 5),
        earlier('unknown', 5000, 6),
      ],
      maxHeartRate: undefined,
    });
    expect(likely).toEqual({ purpose: 'race', source: 'similar_runs' });
    expect(likelyPurposeReason(likely)).toBe('Wie deine ähnlichen Läufe');
  });

  it('falls back to recent runs, then to easy', () => {
    expect(
      likelyPurpose({
        run: fresh,
        history: [
          earlier('long', 15000, 1),
          earlier('race', 12000, 2),
          earlier('long', 16000, 3),
        ],
        maxHeartRate: undefined,
      }),
    ).toEqual({ purpose: 'easy', source: 'recent_runs' });
    const plain = likelyPurpose({
      run: fresh,
      history: [],
      maxHeartRate: undefined,
    });
    expect(plain).toEqual({ purpose: 'easy', source: 'default' });
    expect(likelyPurposeReason(plain)).toBeUndefined();
  });

  it('ignores later runs and the run itself', () => {
    expect(
      likelyPurpose({
        run: fresh,
        history: [{ ...fresh, purpose: 'race' }, earlier('race', 5000, -1)],
        maxHeartRate: undefined,
      }).source,
    ).toBe('default');
  });
});

describe('asksPurposeOnOpen', () => {
  const recorded = {
    purpose: 'unknown' as const,
    source: 'phone',
    status: 'completed',
  };

  it('asks a fresh own recording once', () => {
    expect(asksPurposeOnOpen(recorded)).toBe(true);
    expect(asksPurposeOnOpen({ ...recorded, source: 'wear_os' })).toBe(true);
    expect(asksPurposeOnOpen({ ...recorded, purposeAsked: true })).toBe(false);
    expect(asksPurposeOnOpen({ ...recorded, purposeConfirmed: true })).toBe(
      false,
    );
  });

  it('leaves old recordings, imports, rides and running recordings alone', () => {
    expect(asksPurposeOnOpen({ ...recorded, purpose: 'free' })).toBe(false);
    expect(asksPurposeOnOpen({ ...recorded, purpose: 'long' })).toBe(false);
    expect(asksPurposeOnOpen({ ...recorded, source: 'strava' })).toBe(false);
    expect(asksPurposeOnOpen({ ...recorded, sport: 'cycling' })).toBe(false);
    expect(asksPurposeOnOpen({ ...recorded, status: 'recording' })).toBe(false);
  });
});
