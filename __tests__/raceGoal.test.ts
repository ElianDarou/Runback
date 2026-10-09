import type { Run } from '../src/native';
import {
  HALF_MARATHON_KM,
  parseGoalDistanceKm,
  parseGoalTime,
  peakLongRunKm,
  predictRace,
  riegelSeconds,
} from '../src/domain/raceGoal';
import { setLanguage } from '../src/domain/i18n';

const localAt = (date: string, hour = 9): number => {
  const [year, month, day] = date.split('-').map(Number);
  return new Date(year, month - 1, day, hour, 0, 0, 0).getTime();
};

const runAt = (
  id: string,
  date: string,
  km: number,
  durationSeconds: number,
  overrides: Partial<Run> = {},
): Run => {
  const startTime = localAt(date);
  return {
    id,
    startTime,
    endTime: startTime + durationSeconds * 1000,
    durationSeconds,
    distanceMeters: km * 1000,
    purpose: 'easy',
    source: 'test',
    status: 'completed',
    ...overrides,
  };
};

const NOW = localAt('2026-09-22', 18);

describe('Goal text', () => {
  it('recognizes named and numeric distances', () => {
    expect(parseGoalDistanceKm('Halbmarathon im April')).toBeCloseTo(HALF_MARATHON_KM);
    expect(parseGoalDistanceKm('HM unter 2 h')).toBeCloseTo(HALF_MARATHON_KM);
    expect(parseGoalDistanceKm('Marathon Berlin')).toBeCloseTo(42.195);
    expect(parseGoalDistanceKm('10 km unter 50 min')).toBe(10);
    expect(parseGoalDistanceKm('5k')).toBe(5);
    expect(parseGoalDistanceKm('21,1 Kilometer')).toBeCloseTo(21.1);
    expect(parseGoalDistanceKm('Ultra')).toBeUndefined();
    expect(parseGoalDistanceKm('Regelmäßig laufen')).toBeUndefined();
  });

  it('reads English goal texts when the app language is English', () => {
    setLanguage('en');
    expect(parseGoalDistanceKm('half marathon in April')).toBeCloseTo(HALF_MARATHON_KM);
    expect(parseGoalDistanceKm('10k under 50 min')).toBe(10);
    expect(parseGoalDistanceKm('21.1 kilometers')).toBeCloseTo(21.1);
    expect(parseGoalDistanceKm('ultra')).toBeUndefined();
    setLanguage('de');
  });

  it('reads goal times as h:mm or mm:ss depending on the distance', () => {
    expect(parseGoalTime('1:59:30')).toBe(7170);
    expect(parseGoalTime('1:59', HALF_MARATHON_KM)).toBe(7140);
    expect(parseGoalTime('49:30', 10)).toBe(2970);
    expect(parseGoalTime('59:30', 15)).toBe(3570);
    expect(parseGoalTime('2:75', 10)).toBeUndefined();
    expect(parseGoalTime('abc')).toBeUndefined();
    expect(parseGoalTime('')).toBeUndefined();
  });
});

describe('Estimate', () => {
  it('calculates with Riegel and aims at nine tenths as the long run', () => {
    expect(riegelSeconds(3000, 10, 20)).toBeCloseTo(3000 * Math.pow(2, 1.06));
    expect(peakLongRunKm(HALF_MARATHON_KM)).toBe(19);
    expect(peakLongRunKm(42.195)).toBe(31.6);
  });

  it('honestly stays empty without a goal or distance', () => {
    expect(predictRace({ goal: '', runs: [], now: NOW }).status).toBe('no_goal');
    expect(
      predictRace({ goal: 'Fitter werden', runs: [], now: NOW }).status,
    ).toBe('no_distance');
  });

  it('requires a run over a quarter of the goal distance from the last eight weeks', () => {
    const short = predictRace({
      goal: 'Halbmarathon',
      runs: [runAt('a', '2026-09-20', 5, 1500)],
      now: NOW,
    });
    expect(short.status).toBe('insufficient_data');
    expect(short.message).toContain('5,3 km');
    const old = predictRace({
      goal: 'Halbmarathon',
      runs: [runAt('b', '2026-06-01', 12, 3600)],
      now: NOW,
    });
    expect(old.status).toBe('insufficient_data');
  });

  it('takes the run with the best projection, not the longest', () => {
    const prediction = predictRace({
      goal: 'Halbmarathon',
      targetSeconds: 2 * 3600,
      runs: [
        runAt('fast-10', '2026-09-10', 10, 50 * 60),
        runAt('slow-15', '2026-09-14', 15, 95 * 60),
      ],
      now: NOW,
    });
    expect(prediction.status).toBe('estimated');
    expect(prediction.reference?.runId).toBe('fast-10');
    expect(prediction.predictedSeconds).toBe(
      Math.round(riegelSeconds(3000, 10, HALF_MARATHON_KM)),
    );
    // 15 km of 19 km: the distance limits it, the time (≈1:50 h) fits.
    expect(prediction.limitedBy).toBe('distance');
    expect(prediction.progress).toBeCloseTo(15 / 19, 2);
    expect(prediction.timeShare).toBe(1);
    expect(prediction.paceGapSecondsPerKm).toBeLessThan(0);
    expect(prediction.message).toContain('liegt dein Ziel');
  });

  it('names the missing time per kilometer when the time is the limit', () => {
    const prediction = predictRace({
      goal: 'Halbmarathon',
      targetSeconds: 100 * 60,
      runs: [runAt('long', '2026-09-14', 19, 120 * 60)],
      now: NOW,
    });
    expect(prediction.status).toBe('estimated');
    expect(prediction.limitedBy).toBe('time');
    expect(prediction.distanceShare).toBe(1);
    expect(prediction.progress).toBeLessThan(1);
    expect(prediction.paceGapSecondsPerKm).toBeGreaterThan(0);
    expect(prediction.message).toContain('fehlen noch');
    expect(prediction.limits.length).toBe(2);
  });

  it('ignores duplicates and other sports', () => {
    const prediction = predictRace({
      goal: '10 km',
      runs: [
        runAt('bike', '2026-09-15', 30, 3600, { sport: 'cycling' }),
        runAt('a', '2026-09-16', 8, 2400, { canonicalId: 'x' }),
        runAt('b', '2026-09-16', 8, 2400, { canonicalId: 'x' }),
      ],
      now: NOW,
    });
    expect(prediction.reference?.runId).toBe('a');
    expect(prediction.longestRunKm).toBe(8);
  });
});
