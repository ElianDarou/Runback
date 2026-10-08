import {
  addCalendarDays,
  applyWeekSuggestion,
  cancelSession,
  localDateKey,
  moveSession,
  normalizeSchedule,
  proposeMove,
  scheduleTitle,
  storedScheduleTitle,
  serializeSchedule,
  startOfWeek,
  suggestWeek,
  updateSession,
  type ScheduleState,
  type ScheduledSession,
} from '../src/domain/schedule';
import { setLanguage } from '../src/domain/i18n';

const TODAY = '2025-03-10';

const session = (
  id: string,
  date: string,
  extra: Partial<ScheduledSession> = {},
): ScheduledSession => ({
  id,
  date,
  title: 'Lauf',
  kind: 'run',
  minutes: 30,
  locked: false,
  status: 'planned',
  effort: 'easy',
  ...extra,
});

const state = (overrides: Partial<ScheduleState> = {}): ScheduleState => ({
  version: 1,
  sessions: [],
  availability: {},
  routine: { days: [0, 2, 5], minutes: 30 },
  ...overrides,
});

describe('Local calendar data', () => {
  it('works with calendar days instead of millisecond days', () => {
    expect(addCalendarDays('2024-03-30', 1)).toBe('2024-03-31');
    expect(addCalendarDays('2024-03-30', 2)).toBe('2024-04-01');
    expect(addCalendarDays('2024-10-26', 2)).toBe('2024-10-28');
    expect(startOfWeek('2025-03-16')).toBe('2025-03-10');
  });

  it('formats a local date value without a UTC shift', () => {
    const local = new Date(2025, 2, 10, 23, 59, 59);
    expect(localDateKey(local)).toBe('2025-03-10');
  });
});

describe('Schedule normalization and offline round trip', () => {
  it('removes invalid entries, deduplicates ids and keeps links', () => {
    const raw = {
      version: 99,
      routine: { days: [6, 0, 0, 8, -1], minutes: 45 },
      availability: { '2025-03-11': 20, 'kein-datum': 10 },
      sessions: [
        session('run-1', '2025-03-11', { activityId: 'native-run-1' }),
        session('run-1', '2025-03-12'),
        session('bad', '2025-02-30'),
      ],
    };
    const normalized = normalizeSchedule(raw);
    expect(normalized.version).toBe(1);
    expect(normalized.routine).toEqual({ days: [0, 6], minutes: 45 });
    expect(normalized.sessions).toHaveLength(1);
    expect(normalized.sessions[0].activityId).toBe('native-run-1');
    expect(normalized.availability).toEqual({ '2025-03-11': 20 });
  });

  it('serializes deterministically as local, purely optional calendar data', () => {
    const original = state({ sessions: [session('r', '2025-03-11')] });
    const restored = normalizeSchedule(JSON.parse(serializeSchedule(original)));
    expect(restored).toEqual(original);
  });
});

describe('Week suggestion', () => {
  it('returns a preview and does not change the saved state', () => {
    const original = state();
    const suggestion = suggestWeek(original, TODAY, { today: TODAY });
    expect(suggestion.weekStart).toBe(TODAY);
    expect(suggestion.addedSessions).toHaveLength(3);
    expect(suggestion.sessions.map(item => item.id)).toEqual([
      'routine-2025-03-10-0',
      'routine-2025-03-10-2',
      'routine-2025-03-10-5',
    ]);
    expect(original.sessions).toEqual([]);
  });

  it('moves a session off an unavailable day within the week and creates no duplicate', () => {
    const original = state({ availability: { '2025-03-12': 0 } });
    const first = suggestWeek(original, TODAY, { today: TODAY });
    const second = suggestWeek(original, TODAY, { today: TODAY });
    expect(first.addedSessions.map(item => item.date)).toEqual([
      '2025-03-10',
      '2025-03-11',
      '2025-03-15',
    ]);
    expect(first.addedSessions.map(item => item.id)).toEqual(
      second.addedSessions.map(item => item.id),
    );
    expect(first.suggestions[0].date).toBe('2025-03-11');
  });

  it('respects a skipped exception and does not catch it up automatically', () => {
    const original = state({
      sessions: [session('skip-wed', '2025-03-12', { status: 'skipped' })],
    });
    const suggestion = suggestWeek(original, TODAY, { today: TODAY });
    expect(suggestion.addedSessions.some(item => item.date === '2025-03-12')).toBe(
      false,
    );
    expect(suggestion.addedSessions).toHaveLength(2);
  });

  it('becomes persistent only through an explicit apply and stays idempotent', () => {
    const preview = suggestWeek(state(), TODAY, { today: TODAY });
    const applied = applyWeekSuggestion(state(), preview, { today: TODAY });
    const twice = applyWeekSuggestion(applied, preview, { today: TODAY });
    expect(applied.sessions).toHaveLength(3);
    expect(twice.sessions).toEqual(applied.sessions);
  });

  it('reflows an existing generated routine session from an unavailable day', () => {
    const generated = session('routine-2025-03-10-2', '2025-03-12', {
      origin: 'routine',
      routineDay: 2,
    });
    const original = state({
      availability: { '2025-03-12': 0 },
      sessions: [generated],
    });
    const suggestion = suggestWeek(original, TODAY, {
      today: TODAY,
      days: [2],
    });

    expect(suggestion.movedSessions).toHaveLength(1);
    expect(suggestion.moves[0]).toMatchObject({
      id: generated.id,
      from: '2025-03-12',
      to: '2025-03-11',
      reason: 'availability',
    });
    expect(suggestion.addedSessions).toHaveLength(0);
    expect(suggestion.preview.sessions).toEqual([
      expect.objectContaining({
        id: generated.id,
        date: '2025-03-11',
        origin: 'routine',
        routineDay: 2,
      }),
    ]);
  });

  it('uses one daily budget for run and strength sessions together', () => {
    const original = state({
      availability: {
        '2025-03-10': 30,
        '2025-03-11': 30,
      },
      sessions: [
        session('routine-2025-03-10-strength-gym-0', '2025-03-10', {
          kind: 'strength',
          minutes: 20,
          origin: 'routine',
          routineDay: 0,
          templateId: 'gym',
        }),
      ],
    });
    const suggestion = suggestWeek(original, TODAY, {
      today: TODAY,
      days: [0],
      minutes: 20,
      strengthTemplates: [
        { id: 'gym', name: 'Gym', days: [1], minutes: 20 },
      ],
    });

    expect(suggestion.addedSessions).toEqual([
      expect.objectContaining({ kind: 'run', date: '2025-03-11', minutes: 20 }),
    ]);
    const minutesByDate = suggestion.preview.sessions.reduce<Record<string, number>>(
      (totals, item) => ({
        ...totals,
        [item.date]: (totals[item.date] || 0) + item.minutes,
      }),
      {},
    );
    expect(minutesByDate).toEqual({ '2025-03-10': 20, '2025-03-11': 20 });
  });

  it('keeps fixed and linked sessions in place during reflow', () => {
    const fixed = session('fixed', '2025-03-11', {
      locked: true,
      origin: 'fixed',
    });
    const linked = session('linked', '2025-03-12', {
      activityId: 'native-run-1',
    });
    const original = state({
      availability: { '2025-03-11': 0, '2025-03-12': 0 },
      sessions: [fixed, linked],
    });
    const suggestion = suggestWeek(original, TODAY, {
      today: TODAY,
      includeRoutine: false,
    });

    expect(suggestion.movedSessions).toEqual([]);
    expect(suggestion.moves).toEqual([]);
    expect(suggestion.preview.sessions).toEqual(original.sessions);
  });

  it('rejects applying a week preview after the state has changed', () => {
    const original = state();
    const preview = suggestWeek(original, TODAY, { today: TODAY });
    const changed = state({ routine: { days: [1], minutes: 30 } });

    const applied = applyWeekSuggestion(changed, preview, { today: TODAY });

    expect(applied).toBe(changed);
    expect(applied.sessions).toEqual([]);
  });

  it('does not create duplicate generated sessions on a repeated preview', () => {
    const original = state();
    const first = suggestWeek(original, TODAY, { today: TODAY });
    const applied = applyWeekSuggestion(original, first, { today: TODAY });
    const second = suggestWeek(applied, TODAY, { today: TODAY });

    expect(second.addedSessions).toHaveLength(0);
    expect(second.movedSessions).toHaveLength(0);
    expect(new Set(second.preview.sessions.map(item => item.id)).size).toBe(
      applied.sessions.length,
    );
    expect(second.preview.sessions).toEqual(applied.sessions);
  });
});

describe('Moving and conflicts', () => {
  it('reports a fixed target date and suggests no silent move', () => {
    const current = state({
      sessions: [
        session('move', '2025-03-11'),
        session('fixed', '2025-03-13', { locked: true, origin: 'fixed' }),
      ],
    });
    const proposal = proposeMove(current, 'move', '2025-03-13', { today: TODAY });
    expect(proposal.allowed).toBe(false);
    expect(proposal.conflicts.map(item => item.code)).toContain('locked_session');
    expect(moveSession(current, 'move', '2025-03-13', { today: TODAY })).toEqual(
      current,
    );
  });

  it('detects hard sessions across the week boundary', () => {
    const current = state({
      sessions: [
        session('sunday-hard', '2025-03-16', { effort: 'hard' }),
        session('move', '2025-03-14', { effort: 'hard' }),
      ],
    });
    const proposal = proposeMove(current, 'move', '2025-03-17', { today: TODAY });
    expect(proposal.conflicts.map(item => item.code)).toContain('adjacent_hard');
    expect(proposal.suggestions.some(item => item.date === '2025-03-18')).toBe(true);
  });

  it('moves an allowed date only after explicit application', () => {
    const current = state({ sessions: [session('move', '2025-03-11')] });
    const moved = moveSession(current, 'move', '2025-03-13', { today: TODAY });
    expect(moved.sessions.find(item => item.id === 'move')?.date).toBe('2025-03-13');
    expect(current.sessions[0].date).toBe('2025-03-11');
  });
});

describe('Safe changes', () => {
  it('keeps past sessions unchanged', () => {
    const current = state({ sessions: [session('past', '2025-03-09')] });
    expect(updateSession(current, 'past', { title: 'Geändert' }, { today: TODAY })).toBe(
      current,
    );
    expect(cancelSession(current, 'past', { today: TODAY })).toBe(current);
  });

  it('marks a future cancellation without creating a make-up session', () => {
    const current = state({ sessions: [session('future', '2025-03-12')] });
    const cancelled = cancelSession(current, 'future', { today: TODAY });
    expect(cancelled.sessions).toEqual([
      expect.objectContaining({ id: 'future', status: 'skipped' }),
    ]);
    expect(cancelled.sessions).toHaveLength(1);
  });
});

describe('schedule titles', () => {
  afterEach(() => setLanguage('de'));

  it('shows the localized default for the German stored defaults', () => {
    expect(scheduleTitle({ title: 'Krafttraining' })).toBe('Krafttraining');
    expect(scheduleTitle({ title: 'Lauf' })).toBe('Lauf');
    setLanguage('en');
    expect(scheduleTitle({ title: 'Krafttraining' })).toBe('Strength training');
    expect(scheduleTitle({ title: 'Lauf' })).toBe('Run');
  });

  it('shows titles the user typed as they are', () => {
    setLanguage('en');
    expect(scheduleTitle({ title: 'Morning hills' })).toBe('Morning hills');
    expect(scheduleTitle({ title: 'Morgenlauf' })).toBe('Morgenlauf');
  });

  it('stores a localized default back as the German value', () => {
    expect(storedScheduleTitle('Krafttraining')).toBe('Krafttraining');
    setLanguage('en');
    expect(storedScheduleTitle('Strength training')).toBe('Krafttraining');
    expect(storedScheduleTitle('Run')).toBe('Lauf');
    expect(storedScheduleTitle('Morning hills')).toBe('Morning hills');
  });
});
