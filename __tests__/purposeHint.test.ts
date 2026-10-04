import {
  PURPOSE_HINT_VERSION,
  purposeHintReason,
  suggestRunPurpose,
} from '../src/domain/purposeHint';
import type { RunSummary, SegmentAggregate } from '../src/domain/types';

const DAY = 24 * 60 * 60 * 1000;
const START = Date.UTC(2026, 9, 1, 7);
const MAX = 190;

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
  it('erkennt den täglichen 5-km-Lauf auf Zeit am Puls, nicht am Tempo', () => {
    const hint = suggestRunPurpose(
      run({ avgHeartRate: 172, heartRateCoverage: 0.95 }),
      history(5000),
      MAX,
    );
    expect(hint?.purpose).toBe('race');
    expect(hint?.signals).toEqual(['heart_rate_high', 'pace_even']);
    expect(hint?.model_version).toBe(PURPOSE_HINT_VERSION);
  });

  it('schlägt bei niedrigem Puls eine ruhige Runde vor', () => {
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

  it('nennt eine ruhige, deutlich längere Runde eine lange Runde', () => {
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
  });

  it('bleibt ohne Vergleichsläufe bei einer ruhigen Runde', () => {
    const hint = suggestRunPurpose(
      run({ distanceMeters: 12000, rpe: { breathing: 3, recordedAt: START } }),
      [],
      MAX,
    );
    expect(hint?.purpose).toBe('easy');
  });

  it('erkennt stark wechselndes Tempo auf flacher Strecke als Tempowechsel', () => {
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

  it('schlägt auf hügeliger Strecke keinen Tempowechsel vor', () => {
    expect(
      suggestRunPurpose(
        run({
          elevationGainMeters: 300,
          segments: kmSegments([240, 380, 240, 380, 240, 380]),
        }),
        [],
        MAX,
      ),
    ).toBeUndefined();
  });

  it('schweigt ohne Puls und ohne Angabe zur Atmung', () => {
    expect(suggestRunPurpose(run(), history(5000), MAX)).toBeUndefined();
  });

  it('schweigt, wenn Puls und Atmung sich widersprechen', () => {
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

  it('nutzt keinen Puls mit zu geringer Abdeckung oder ohne Maxpuls', () => {
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

  it('schweigt im Graubereich des Pulses', () => {
    expect(
      suggestRunPurpose(
        run({ avgHeartRate: 155, heartRateCoverage: 0.95 }),
        [],
        MAX,
      ),
    ).toBeUndefined();
  });

  it('macht für Radfahrten und Fehlstarts keinen Vorschlag', () => {
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
