import {
  addCalendarDays,
  currentWeekly,
  isChangedDay,
  localDateKey,
  normalizeSchedule,
  plannedOn,
  recordWeekly,
  resetDay,
  scheduleTitle,
  setDayPlan,
  setRunDays,
  startOfWeek,
  weekdayOf,
  weeklyFor,
  type ScheduleState,
} from '../src/domain/schedule';
import { setLanguage } from '../src/domain/i18n';

// 2026-10-12 is a Monday.
const MONDAY = '2026-10-12';
const empty = (): ScheduleState => normalizeSchedule(undefined);
const pull = { id: 'pull', days: [1, 4] }; // Monday and Thursday, Sunday-based
const push = { id: 'push', days: [2] }; // Tuesday

describe('schedule dates', () => {
  it('works in local calendar days', () => {
    expect(localDateKey(new Date(2026, 9, 12, 23, 30))).toBe(MONDAY);
    expect(addCalendarDays(MONDAY, 7)).toBe('2026-10-19');
    expect(addCalendarDays('2026-03-28', 2)).toBe('2026-03-30');
    expect(startOfWeek('2026-10-18')).toBe(MONDAY);
    expect(weekdayOf(MONDAY)).toBe(0);
    expect(weekdayOf('2026-10-18')).toBe(6);
  });
});

describe('normalizeSchedule', () => {
  it('reads an older plan: keeps sessions and goal, drops time budgets', () => {
    const state = normalizeSchedule({
      version: 1,
      routine: { days: [0, 2], minutes: 45 },
      availability: { [MONDAY]: 30 },
      sessions: [
        {
          id: 'a',
          date: MONDAY,
          kind: 'run',
          title: 'Lauf',
          minutes: 40,
          locked: true,
          status: 'planned',
          purpose: 'easy',
          activityId: 'run-1',
        },
        { id: 'a', date: MONDAY, kind: 'run' },
        { id: 'broken', date: '2026-02-31', kind: 'run' },
      ],
      goal: { name: 'Halbmarathon', startDate: MONDAY, distanceKm: 21.1 },
    });
    expect(state).toEqual({
      version: 2,
      sessions: [
        {
          id: 'a',
          date: MONDAY,
          kind: 'run',
          title: 'Lauf',
          status: 'planned',
          purpose: 'easy',
        },
      ],
      changedDays: [],
      // The old routine meant available days, not runs: it is not carried over.
      runDays: [],
      weeklyHistory: [],
      goal: { name: 'Halbmarathon', startDate: MONDAY, distanceKm: 21.1 },
    });
  });

  it('ignores broken weekly values', () => {
    const state = normalizeSchedule({
      runDays: [1, 1, 9, -1, 'x', 3],
      changedDays: ['2026-10-14', 'nope', '2026-10-14'],
      weeklyHistory: [
        { since: 'nope', run: [1] },
        { since: MONDAY, run: [2], strength: [{ templateId: 'a', days: [] }] },
      ],
    });
    expect(state.runDays).toEqual([1, 3]);
    expect(state.changedDays).toEqual(['2026-10-14']);
    expect(state.weeklyHistory).toEqual([
      { since: MONDAY, run: [2], strength: [] },
    ]);
  });
});

describe('weekly plan', () => {
  it('turns template days (Sunday-based) into Monday-based days', () => {
    const state = setRunDays(empty(), [1, 4, 6]);
    expect(
      currentWeekly(state, [pull, push, { id: 'free', days: [] }]),
    ).toEqual({
      run: [1, 4, 6],
      strength: [
        { templateId: 'pull', days: [0, 3] },
        { templateId: 'push', days: [1] },
      ],
    });
  });

  it('keeps the noted strength days while the templates are not loaded', () => {
    const noted = recordWeekly(
      empty(),
      { run: [0], strength: [{ templateId: 'pull', days: [3] }] },
      MONDAY,
    );
    expect(currentWeekly(setRunDays(noted, [2]), undefined)).toEqual({
      run: [2],
      strength: [{ templateId: 'pull', days: [3] }],
    });
  });

  it('plans each weekday from the weekly plan', () => {
    const state = setRunDays(empty(), [1]);
    const weekly = currentWeekly(state, [pull, push]);
    expect(plannedOn(state, weekly, MONDAY, MONDAY)).toEqual([
      {
        key: 'weekly-pull',
        kind: 'strength',
        templateId: 'pull',
        fromWeekly: true,
      },
    ]);
    expect(
      plannedOn(state, weekly, '2026-10-13', MONDAY).map(item => item.key),
    ).toEqual(['weekly-run', 'weekly-push']);
    expect(plannedOn(state, weekly, '2026-10-14', MONDAY)).toEqual([]);
  });

  it('keeps past days on the plan that was in effect then', () => {
    let state = setRunDays(empty(), [0]);
    state = recordWeekly(state, currentWeekly(state, []), '2026-10-01');
    const before = state;
    // Same plan: nothing to note.
    expect(recordWeekly(state, currentWeekly(state, []), '2026-10-05')).toBe(
      before,
    );
    state = setRunDays(state, [2]);
    state = recordWeekly(state, currentWeekly(state, []), MONDAY);
    const weekly = currentWeekly(state, []);
    // Monday 5 October: runs were on Mondays then.
    expect(plannedOn(state, weekly, '2026-10-05', '2026-10-13')).toHaveLength(
      1,
    );
    expect(plannedOn(state, weekly, '2026-10-07', '2026-10-13')).toHaveLength(
      0,
    );
    // From the change on, Wednesdays.
    expect(plannedOn(state, weekly, '2026-10-14', '2026-10-13')).toHaveLength(
      1,
    );
    expect(plannedOn(state, weekly, '2026-10-19', '2026-10-13')).toHaveLength(
      0,
    );
    // Before the first note, nothing was planned.
    expect(
      weeklyFor(state, weekly, '2026-09-28', '2026-10-13'),
    ).toBeUndefined();
  });

  it('replaces a second change on the same day', () => {
    let state = recordWeekly(empty(), { run: [0], strength: [] }, MONDAY);
    state = recordWeekly(state, { run: [1], strength: [] }, MONDAY);
    expect(state.weeklyHistory).toEqual([
      { since: MONDAY, run: [1], strength: [] },
    ]);
    // Template order alone is no change.
    const a = { templateId: 'a', days: [0] };
    const b = { templateId: 'b', days: [2] };
    const noted = recordWeekly(
      state,
      { run: [1], strength: [a, b] },
      '2026-10-13',
    );
    expect(
      recordWeekly(noted, { run: [1], strength: [b, a] }, '2026-10-14'),
    ).toBe(noted);
  });

  it('does not note an empty plan without history', () => {
    const state = empty();
    expect(recordWeekly(state, { run: [], strength: [] }, MONDAY)).toBe(state);
  });
});

describe('changed days', () => {
  it('replaces the weekly plan on one day only', () => {
    const base = setRunDays(empty(), [0, 1]);
    const weekly = currentWeekly(base, [pull]);
    const state = setDayPlan(
      base,
      MONDAY,
      [{ kind: 'strength', templateId: 'push', title: 'Push' }],
      MONDAY,
    );
    expect(isChangedDay(state, MONDAY)).toBe(true);
    expect(plannedOn(state, weekly, MONDAY, MONDAY)).toEqual([
      {
        key: `${MONDAY}-1`,
        kind: 'strength',
        templateId: 'push',
        title: 'Push',
        purpose: undefined,
        fromWeekly: false,
      },
    ]);
    // The next week stays as every week.
    expect(
      plannedOn(state, weekly, '2026-10-19', MONDAY).map(item => item.key),
    ).toEqual(['weekly-run', 'weekly-pull']);
  });

  it('can empty a day and bring the weekly plan back', () => {
    const base = setRunDays(empty(), [0]);
    const weekly = currentWeekly(base, []);
    const cleared = setDayPlan(base, MONDAY, [], MONDAY);
    expect(plannedOn(cleared, weekly, MONDAY, MONDAY)).toEqual([]);
    const reset = resetDay(cleared, MONDAY, MONDAY);
    expect(reset.changedDays).toEqual([]);
    expect(plannedOn(reset, weekly, MONDAY, MONDAY)).toHaveLength(1);
  });

  it('never changes the past', () => {
    const base = setDayPlan(
      empty(),
      '2026-10-10',
      [{ kind: 'run' }],
      '2026-10-10',
    );
    expect(setDayPlan(base, '2026-10-10', [], MONDAY)).toBe(base);
    expect(resetDay(base, '2026-10-10', MONDAY)).toBe(base);
  });

  it('treats an older skipped session as a changed day without plan', () => {
    const state = normalizeSchedule({
      sessions: [{ id: 's', date: MONDAY, kind: 'run', status: 'skipped' }],
      runDays: [0],
    });
    expect(plannedOn(state, currentWeekly(state, []), MONDAY, MONDAY)).toEqual(
      [],
    );
  });
});

describe('scheduleTitle', () => {
  afterEach(() => setLanguage('de'));
  it('shows stored German defaults in the active language', () => {
    setLanguage('en');
    expect(scheduleTitle({ title: 'Lauf' })).toBe('Run');
    expect(scheduleTitle({ title: 'Krafttraining' })).toBe('Strength training');
    expect(scheduleTitle({ title: 'Pull' })).toBe('Pull');
  });
});
