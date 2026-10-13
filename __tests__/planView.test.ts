import {
  planEntriesByDate,
  planStatus,
  planSummary,
  type PlanActivity,
} from '../src/domain/planView';
import type { ScheduledSession } from '../src/domain/schedule';

const at = (date: string, hour = 8): number => {
  const [year, month, day] = date.split('-').map(Number);
  return new Date(year, month - 1, day, hour).getTime();
};

const session = (
  overrides: Partial<ScheduledSession> = {},
): ScheduledSession => ({
  id: 's1',
  date: '2025-03-10',
  title: 'Lauf',
  kind: 'run',
  minutes: 30,
  locked: false,
  status: 'planned',
  effort: 'easy',
  ...overrides,
});

const run = (overrides: Partial<PlanActivity> = {}): PlanActivity => ({
  id: 'r1',
  kind: 'run',
  startTime: at('2025-03-10'),
  title: 'Morgenlauf',
  finished: true,
  durationSeconds: 1800,
  distanceMeters: 5000,
  runningMeters: 5000,
  ...overrides,
});

describe('planView', () => {
  it('counts a session as done only through a finished linked activity', () => {
    expect(planStatus(session(), [run()])).toBe('planned');
    expect(planStatus(session({ activityId: 'r1' }), [run()])).toBe('done');
    expect(
      planStatus(session({ activityId: 'r1' }), [run({ finished: false })]),
    ).toBe('started');
    expect(planStatus(session({ status: 'skipped' }), [run()])).toBe(
      'skipped',
    );
    // A strength session never links to a run with the same ID.
    expect(
      planStatus(session({ kind: 'strength', activityId: 'r1' }), [run()]),
    ).toBe('planned');
  });

  it('links through the canonical ID of older imports', () => {
    expect(
      planStatus(session({ activityId: 'canon' }), [
        run({ canonicalId: 'canon' }),
      ]),
    ).toBe('done');
  });

  it('shows a linked activity on the planned date and others on their own day', () => {
    const byDate = planEntriesByDate(
      [session({ date: '2025-03-11', activityId: 'r1' })],
      [run(), run({ id: 'r2', startTime: at('2025-03-12', 18) })],
    );
    expect(byDate['2025-03-10']).toBeUndefined();
    expect(byDate['2025-03-11']).toEqual([
      expect.objectContaining({ type: 'planned', status: 'done' }),
    ]);
    expect(byDate['2025-03-12']).toEqual([
      expect.objectContaining({ type: 'unplanned' }),
    ]);
  });

  it('orders a day by time and puts open plans last', () => {
    const byDate = planEntriesByDate(
      [session({ id: 'open' })],
      [
        run({ id: 'late', startTime: at('2025-03-10', 19) }),
        run({ id: 'early', startTime: at('2025-03-10', 6) }),
      ],
    );
    expect(
      byDate['2025-03-10'].map(entry =>
        entry.type === 'planned' ? entry.session.id : entry.activity.id,
      ),
    ).toEqual(['early', 'late', 'open']);
  });

  it('sums only finished workouts and keeps unknown totals unknown', () => {
    const byDate = planEntriesByDate(
      [
        session({ id: 'done', activityId: 'r1' }),
        session({ id: 'open', date: '2025-03-11' }),
        session({ id: 'skipped', date: '2025-03-12', status: 'skipped' }),
      ],
      [
        run(),
        run({ id: 'unfinished', finished: false, startTime: at('2025-03-11') }),
        {
          id: 'gym',
          kind: 'strength',
          startTime: at('2025-03-12'),
          title: 'Kraft',
          finished: true,
          sets: 12,
        },
      ],
    );
    const dates = ['2025-03-10', '2025-03-11', '2025-03-12'];
    expect(planSummary(dates, byDate)).toEqual({
      done: 2,
      planned: 2,
      plannedDone: 1,
      seconds: 1800,
      runningMeters: 5000,
    });
    // Strength without a known duration and no run: no invented zero.
    expect(planSummary(['2025-03-12'], byDate)).toEqual({
      done: 1,
      planned: 0,
      plannedDone: 0,
      seconds: undefined,
      runningMeters: undefined,
    });
  });
});
