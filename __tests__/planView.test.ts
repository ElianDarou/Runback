import {
  activitiesByDate,
  compareWithUsual,
  dayEntries,
  periodTotals,
  type PlanActivity,
} from '../src/domain/planView';
import type { PlannedItem } from '../src/domain/schedule';

const at = (date: string, hour = 8): number => {
  const [year, month, day] = date.split('-').map(Number);
  return new Date(year, month - 1, day, hour).getTime();
};

const run = (overrides: Partial<PlanActivity> = {}): PlanActivity => ({
  id: 'r1',
  kind: 'run',
  sport: 'running',
  startTime: at('2026-10-12'),
  title: 'Morgenlauf',
  finished: true,
  durationSeconds: 1800,
  distanceMeters: 5000,
  runningMeters: 5000,
  ...overrides,
});

const lift = (overrides: Partial<PlanActivity> = {}): PlanActivity => ({
  id: 's1',
  kind: 'strength',
  startTime: at('2026-10-12', 18),
  title: 'Pull',
  finished: true,
  durationSeconds: 3600,
  sets: 12,
  ...overrides,
});

const planned = (
  kind: PlannedItem['kind'],
  templateId?: string,
): PlannedItem => ({
  key: `${kind}-${templateId ?? ''}`,
  kind,
  templateId,
  fromWeekly: true,
});

describe('dayEntries', () => {
  it('turns a planned workout done through a recording of the same day', () => {
    const entries = dayEntries([planned('run')], [run()]);
    expect(entries).toEqual([
      expect.objectContaining({ type: 'planned', state: 'done' }),
    ]);
    expect(dayEntries([planned('run')], [])).toEqual([
      expect.objectContaining({ type: 'planned', state: 'planned' }),
    ]);
  });

  it('matches the same template first, then any strength session', () => {
    const entries = dayEntries(
      [planned('strength', 'push'), planned('strength', 'pull')],
      [lift({ id: 'a', templateId: 'pull' }), lift({ id: 'b' })],
    );
    expect(
      entries.map(entry => [entry.type, entry.state, entry.activity?.id]),
    ).toEqual([
      ['planned', 'done', 'b'],
      ['planned', 'done', 'a'],
    ]);
  });

  it('does not let a ride carry out a planned run', () => {
    const ride = run({ sport: 'cycling', runningMeters: undefined });
    expect(dayEntries([planned('run')], [ride])).toEqual([
      expect.objectContaining({ type: 'planned', state: 'planned' }),
      expect.objectContaining({ type: 'unplanned', state: 'done' }),
    ]);
  });

  it('shows a running session as started and leaves false starts out', () => {
    const entries = dayEntries(
      [planned('strength')],
      [
        lift({ finished: false }),
        run({ falseStart: true, durationSeconds: 10, distanceMeters: 20 }),
      ],
    );
    expect(entries).toEqual([
      expect.objectContaining({ type: 'planned', state: 'started' }),
    ]);
  });

  it('lists unplanned training after the plan', () => {
    const entries = dayEntries([], [lift(), run()]);
    expect(entries.map(entry => entry.type)).toEqual([
      'unplanned',
      'unplanned',
    ]);
  });
});

describe('activitiesByDate', () => {
  it('groups by local start day, oldest first, without false starts', () => {
    const byDate = activitiesByDate([
      lift(),
      run(),
      run({ id: 'x', falseStart: true }),
      run({ id: 'next', startTime: at('2026-10-13') }),
    ]);
    expect(byDate['2026-10-12'].map(item => item.id)).toEqual(['r1', 's1']);
    expect(byDate['2026-10-13'].map(item => item.id)).toEqual(['next']);
  });
});

describe('periodTotals', () => {
  it('sums finished training and keeps unknown totals unknown', () => {
    expect(
      periodTotals(
        [
          run(),
          lift({ durationSeconds: undefined }),
          run({ id: 'open', finished: false }),
          run({ id: 'out', startTime: at('2026-10-20') }),
        ],
        '2026-10-12',
        '2026-10-18',
      ),
    ).toEqual({
      workouts: 2,
      seconds: 1800,
      timed: 1,
      runningMeters: 5000,
      runs: 1,
      measuredRuns: 1,
    });
    expect(periodTotals([lift()], '2026-10-12', '2026-10-12')).toEqual({
      workouts: 1,
      seconds: 3600,
      timed: 1,
      runningMeters: undefined,
      runs: 0,
      measuredRuns: 0,
    });
  });
});

describe('compareWithUsual', () => {
  // One run per earlier week, 5 km and 30 min each.
  const weeks = (count: number, start = '2026-10-12') =>
    Array.from({ length: count }, (_, index) => {
      const date = new Date(at(start) - (index + 1) * 7 * 86400000);
      return run({ id: `w${index}`, startTime: date.getTime() });
    });

  it('needs three earlier periods with recordings', () => {
    expect(
      compareWithUsual({
        activities: [run(), ...weeks(2)],
        kind: 'week',
        start: '2026-10-12',
        today: '2026-10-18',
      }),
    ).toBeUndefined();
  });

  it('marks more and less than the median of the weeks before', () => {
    const more = compareWithUsual({
      activities: [
        run(),
        run({ id: 'b', startTime: at('2026-10-14') }),
        ...weeks(6),
      ],
      kind: 'week',
      start: '2026-10-12',
      today: '2026-10-25',
    });
    expect(more).toEqual({
      workouts: 'more',
      seconds: 'more',
      runningMeters: 'more',
      periods: 6,
      days: 7,
      partial: false,
    });
    const less = compareWithUsual({
      activities: weeks(6),
      kind: 'week',
      start: '2026-10-12',
      today: '2026-10-25',
    });
    expect(less?.workouts).toBe('less');
    const same = compareWithUsual({
      activities: [run(), ...weeks(4)],
      kind: 'week',
      start: '2026-10-12',
      today: '2026-10-25',
    });
    expect(same).toMatchObject({ workouts: 'usual', periods: 4 });
  });

  it('compares a running week day for day', () => {
    // Earlier weeks trained on Sunday; on Tuesday this week nothing is behind.
    const sundays = Array.from({ length: 4 }, (_, index) =>
      run({
        id: `s${index}`,
        startTime: at('2026-10-11') - index * 7 * 86400000,
      }),
    );
    const result = compareWithUsual({
      activities: sundays,
      kind: 'week',
      start: '2026-10-12',
      today: '2026-10-13',
    });
    expect(result).toMatchObject({
      workouts: 'usual',
      days: 2,
      partial: true,
    });
  });

  it('leaves a total with an unmeasured workout uncompared', () => {
    const result = compareWithUsual({
      activities: [run({ durationSeconds: undefined }), ...weeks(4)],
      kind: 'week',
      start: '2026-10-12',
      today: '2026-10-25',
    });
    expect(result?.workouts).toBe('usual');
    expect(result?.seconds).toBeUndefined();
    expect(result?.runningMeters).toBe('usual');
  });

  it('compares months with the months before', () => {
    const months = [8, 7, 6].map((month, index) =>
      run({
        id: `m${index}`,
        startTime: new Date(2026, month, 3, 8).getTime(),
      }),
    );
    const result = compareWithUsual({
      activities: [...months, run({ startTime: at('2026-10-02') })],
      kind: 'month',
      start: '2026-10-01',
      today: '2026-10-14',
    });
    expect(result).toMatchObject({
      workouts: 'usual',
      periods: 3,
      days: 14,
      partial: true,
    });
  });

  it('says nothing about a period that has not begun', () => {
    expect(
      compareWithUsual({
        activities: weeks(6),
        kind: 'week',
        start: '2026-10-19',
        today: '2026-10-14',
      }),
    ).toBeUndefined();
  });
});
