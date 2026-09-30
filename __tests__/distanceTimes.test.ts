import { distanceTime, STANDARD_DISTANCES } from '../src/domain/distanceTimes';
import type { Run } from '../src/native';
const now = new Date('2026-09-30T12:00:00Z').getTime();
const run = (
  id: string,
  seconds = 1500,
  overrides: Partial<Run> = {},
): Run => ({
  id,
  startTime: now - 86400000,
  endTime: now,
  distanceMeters: 5000,
  durationSeconds: seconds,
  purpose: 'free',
  source: 'test',
  status: 'completed',
  ...overrides,
});
it('lists all requested distances and uses a median instead of the fastest outlier', () => {
  expect(STANDARD_DISTANCES).toEqual([1, 2, 5, 10, 21.0975, 42.195]);
  const result = distanceTime(
    [run('a', 1500), run('b', 1600), run('c', 1000)],
    5,
    now,
  );
  expect(result.estimatedSeconds).toBe(1500);
  expect(result.sourceRunIds).toHaveLength(3);
  expect(result.version).toBe('distance-times-riegel-median-v1');
  expect(
    distanceTime([run('a'), run('b'), run('c')], 10, now).estimatedSeconds,
  ).toBe(Math.round(1500 * Math.pow(2, 1.06)));
});
it('keeps missing, duplicate, stale, cycling and excessively short references out', () => {
  const result = distanceTime(
    [
      run('a'),
      run('duplicate', 1000, { canonicalId: 'a' }),
      run('old', 1500, { startTime: now - 60 * 86400000 }),
      run('bike', 800, { sport: 'cycling' }),
      run('future', 1400, { startTime: now + 1000 }),
    ],
    5,
    now,
  );
  expect(result.estimatedSeconds).toBeUndefined();
  expect(result.sourceRunIds).toEqual(['a']);
  expect(result.history.map(item => item.id)).toEqual(['a', 'old']);
  expect(
    distanceTime([run('a'), run('b'), run('c')], 42.195, now).estimatedSeconds,
  ).toBeUndefined();
  expect(distanceTime([], NaN, now).estimatedSeconds).toBeUndefined();
});
it('keeps actual times separate from estimated times and requires three recent references', () => {
  const result = distanceTime(
    [run('a'), run('b', 1900, { distanceMeters: 6000 })],
    5,
    now,
  );
  expect(result.history.map(item => item.durationSeconds)).toEqual([1500]);
  expect(result.estimatedSeconds).toBeUndefined();
});

it('also estimates short-distance times from the usual five- and ten-kilometer runs', () => {
  const runs = [run('a'), run('b'), run('c')];
  expect(distanceTime(runs, 1, now).estimatedSeconds).toBe(
    Math.round(1500 * Math.pow(1 / 5, 1.06)),
  );
  expect(distanceTime(runs, 2, now).estimatedSeconds).toBe(
    Math.round(1500 * Math.pow(2 / 5, 1.06)),
  );
});
