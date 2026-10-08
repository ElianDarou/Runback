import {
  PURPOSE_HINT_VERSION,
  purposeHintReason,
  suggestRunPurpose,
} from '../src/domain/purposeHint';
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

  it('calls a clearly longer easy run a long run', () => {
    const hint = suggestRunPurpose(
      run({
        distanceMeters: 12000,
        rpe: { breathing: 3, recordedAt: START },
        segments: kmSegments(Array(12).fill(330)),
      }),
      history(6000),
      MAX,
    );
    expect(hint?.purpose).toBe('long');
    expect(hint?.signals).toContain('longer_than_usual');
    expect(hint?.baselineRunIds).toEqual(['old-0', 'old-1', 'old-2', 'old-3']);
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
