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
  expect(result.version).toBe('distance-times-riegel-recent-v2');
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

const daysAgo = (days: number) => now - days * 86400000;

it('does not turn today’s 32-minute five-kilometer run into a 44-minute estimate', () => {
  const runs = [
    run('today', 32 * 60, { startTime: daysAgo(0) }),
    ...Array.from({ length: 7 }, (_, index) =>
      run(`old-${index}`, 44 * 60, { startTime: daysAgo(index + 1) }),
    ),
  ];
  const result = distanceTime(runs, 5, now);
  expect(result.estimatedSeconds).toBe(32 * 60);
  expect(result.sourceRunIds[0]).toBe('today');
  expect(result.history[0].durationSeconds).toBe(32 * 60);
  expect(distanceTime([...runs].reverse(), 5, now)).toEqual(result);
});

it('lets the newest three outweigh five older runs when projecting another distance', () => {
  const runs = Array.from({ length: 8 }, (_, index) =>
    run(`run-${index}`, (index < 3 ? 32 : 44) * 60, {
      startTime: daysAgo(index),
    }),
  );
  expect(distanceTime(runs, 10, now).estimatedSeconds).toBe(
    Math.round(32 * 60 * Math.pow(2, 1.06)),
  );
});

it('does not let a single extrapolated outlier override the recent middle value', () => {
  const result = distanceTime(
    [
      run('newest', 1000, { startTime: daysAgo(0) }),
      run('second', 1900, { startTime: daysAgo(1) }),
      run('third', 2000, { startTime: daysAgo(2) }),
      run('older', 2100, { startTime: daysAgo(3) }),
    ],
    10,
    now,
  );
  expect(result.estimatedSeconds).toBe(Math.round(1900 * Math.pow(2, 1.06)));
});

it('can become slower again instead of keeping an old personal best forever', () => {
  const runs = Array.from({ length: 8 }, (_, index) =>
    run(`run-${index}`, (index < 3 ? 44 : 32) * 60, {
      startTime: daysAgo(index),
    }),
  );
  expect(distanceTime(runs, 5, now).estimatedSeconds).toBe(44 * 60);
});

it('does not use a stale actual time as a ceiling for current projections', () => {
  const result = distanceTime(
    [
      run('old-best', 1000, { startTime: daysAgo(57) }),
      ...Array.from({ length: 3 }, (_, index) =>
        run(`recent-${index}`, 3000, {
          startTime: daysAgo(index),
          distanceMeters: 6000,
        }),
      ),
    ],
    5,
    now,
  );
  expect(result.estimatedSeconds).toBe(
    Math.round(3000 * Math.pow(5 / 6, 1.06)),
  );
  expect(result.history.map(item => item.id)).toEqual(['old-best']);
  expect(result.sourceRunIds).not.toContain('old-best');
});

it('normalizes an actual run near the target distance before limiting the estimate', () => {
  const result = distanceTime(
    [
      run('today', 1920, { startTime: daysAgo(0), distanceMeters: 4900 }),
      run('second', 2640, { startTime: daysAgo(1) }),
      run('third', 2640, { startTime: daysAgo(2) }),
    ],
    5,
    now,
  );
  expect(result.estimatedSeconds).toBe(
    Math.round(1920 * Math.pow(5 / 4.9, 1.06)),
  );
});
