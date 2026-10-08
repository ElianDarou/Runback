import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import type { Run } from '../native';
import {
  displaySessionName,
  type StrengthSession,
  type WorkoutTemplate,
} from '../domain/strength';
import type { RunPurpose } from '../domain/types';
import { RUN_PURPOSES, runTitle } from '../domain/runTitle';
import { buildUpWeek } from '../domain/buildUp';
import { effectiveGoalDistanceKm } from '../domain/raceGoal';
import {
  addCalendarDays,
  addScheduledSession,
  applyWeekSuggestion,
  cancelSession,
  localDateKey,
  moveSession as applyDomainMove,
  proposeMove,
  scheduleTitle,
  setAvailability,
  storedScheduleTitle,
  setRoutine,
  startOfWeek,
  suggestWeek,
  updateSession,
  type ScheduleKind,
  type ScheduleEffort,
  type ScheduleState,
  type ScheduledSession,
  type WeekSuggestion,
} from '../domain/schedule';
import {
  Button,
  Card,
  ChipGroup,
  Copy,
  EmptyState,
  Field,
  Input,
  Notice,
  Row,
  Section,
  Segmented,
  Title,
  ToggleChips,
  color,
  radius,
  space,
  type as typography,
} from './components';
import { getLanguage, tr } from '../domain/i18n';

export type { ScheduleState, ScheduledSession } from '../domain/schedule';

export interface PlanningScreenProps {
  state: ScheduleState;
  onSave: (next: ScheduleState) => Promise<void>;
  templates: WorkoutTemplate[];
  runs: Run[];
  strengthSessions: StrengthSession[];
  now: number;
  onStartRun: (session: ScheduledSession) => Promise<void>;
  onStartStrength: (session: ScheduledSession) => Promise<void>;
  onDevelopment?: () => void;
  onManageTemplates?: () => void;
  /** Opens the route planner. Without it, there is no entry point. */
  onOpenRoutePlanner?: () => void;
  busy?: boolean;
  /** Offer "suggest week". People who plan on their own hide it. */
  showSuggest?: boolean;
  /** Offer the month view. */
  showMonth?: boolean;
  /** Strength sessions can be planned. Without the strength area, runs only. */
  showStrength?: boolean;
}

type ViewMode = 'week' | 'month';
type PlanningScope = 'week' | 'routine';
type ActivityStatus = 'planned' | 'skipped' | 'started' | 'done';

interface SessionDraft {
  id?: string;
  date: string;
  title: string;
  kind: ScheduleKind;
  minutes: string;
  purpose: RunPurpose;
  effort: ScheduleEffort;
  templateId?: string;
  locked: boolean;
}

interface PendingSave {
  next: ScheduleState;
  previous: ScheduleState;
  message: string;
  trackUndo: boolean;
}

// Labels are built per call: the language can change at runtime.
const weekdayShort = () =>
  getLanguage() === 'en'
    ? ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
    : ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
const weekdayLong = () =>
  getLanguage() === 'en'
    ? [
        'Monday',
        'Tuesday',
        'Wednesday',
        'Thursday',
        'Friday',
        'Saturday',
        'Sunday',
      ]
    : [
        'Montag',
        'Dienstag',
        'Mittwoch',
        'Donnerstag',
        'Freitag',
        'Samstag',
        'Sonntag',
      ];
const monthNames = () =>
  getLanguage() === 'en'
    ? [
        'January',
        'February',
        'March',
        'April',
        'May',
        'June',
        'July',
        'August',
        'September',
        'October',
        'November',
        'December',
      ]
    : [
        'Januar',
        'Februar',
        'März',
        'April',
        'Mai',
        'Juni',
        'Juli',
        'August',
        'September',
        'Oktober',
        'November',
        'Dezember',
      ];
const purposeOptions = () =>
  RUN_PURPOSES.map(({ value, label }) => ({ value, label }));
const kindOptions = (): { value: ScheduleKind; label: string }[] => [
  { value: 'run', label: tr('Lauf', 'Run') },
  { value: 'strength', label: tr('Kraft', 'Strength') },
];
const effortOptions = (): { value: ScheduleEffort; label: string }[] => [
  { value: 'easy', label: tr('Locker', 'Easy') },
  { value: 'hard', label: tr('Anstrengend', 'Hard') },
];
const scopeOptions = (): { value: PlanningScope; label: string }[] => [
  { value: 'week', label: tr('Diese Woche', 'This week') },
  { value: 'routine', label: tr('Rhythmus', 'Routine') },
];

let nextSessionNumber = 0;

function localDateFrom(value: number | string | Date): Date {
  if (value instanceof Date) return new Date(value.getTime());
  if (typeof value === 'number') return new Date(value);
  const parts = value.split('-').map(Number);
  return new Date(parts[0], parts[1] - 1, parts[2]);
}

function isoDate(value: Date): string {
  return localDateKey(value);
}

function addDays(value: Date, amount: number): Date {
  return localDateFrom(addCalendarDays(isoDate(value), amount));
}

function mondayOf(value: Date): Date {
  return localDateFrom(startOfWeek(value));
}

function firstOfMonth(value: Date): Date {
  return new Date(value.getFullYear(), value.getMonth(), 1);
}

function dateLabel(value: Date): string {
  const weekday = weekdayShort()[(value.getDay() + 6) % 7];
  const month = monthNames()[value.getMonth()].slice(0, 3);
  return tr(
    `${weekday}, ${value.getDate()}. ${month}.`,
    `${weekday}, ${value.getDate()} ${month}`,
  );
}

function fullDateLabel(value: Date): string {
  const weekday = weekdayLong()[(value.getDay() + 6) % 7];
  const month = monthNames()[value.getMonth()];
  return tr(
    `${weekday}, ${value.getDate()}. ${month}`,
    `${weekday}, ${month} ${value.getDate()}`,
  );
}

function monthLabel(value: Date): string {
  return `${monthNames()[value.getMonth()]} ${value.getFullYear()}`;
}

function parseMinutes(value: string): number | undefined {
  const parsed = Number(value.trim().replace(',', '.'));
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1440) return undefined;
  return Math.round(parsed);
}

function parseDuration(value: string): number | undefined {
  const minutes = parseMinutes(value);
  return minutes === undefined || minutes < 1 ? undefined : minutes;
}

function mondayIndex(value: Date): number {
  return (value.getDay() + 6) % 7;
}

function formatMinutes(value: number): string {
  return `${Math.max(0, Math.round(value))} min`;
}

function formatActivityDate(value: number): string {
  return dateLabel(localDateFrom(value));
}

function cloneState(state: ScheduleState): ScheduleState {
  return {
    version: state.version,
    sessions: state.sessions.map(session => ({ ...session })),
    availability: { ...state.availability },
    routine: { days: [...state.routine.days], minutes: state.routine.minutes },
    goal: state.goal ? { ...state.goal } : undefined,
  };
}

function scheduleSignature(state: ScheduleState): string {
  return JSON.stringify({
    version: state.version,
    availability: Object.keys(state.availability)
      .sort()
      .map(date => [date, state.availability[date]]),
    routine: {
      days: [...state.routine.days].sort((a, b) => a - b),
      minutes: state.routine.minutes,
    },
    goal: state.goal
      ? {
          name: state.goal.name,
          startDate: state.goal.startDate,
          targetDate: state.goal.targetDate,
          phase: state.goal.phase,
          distanceKm: state.goal.distanceKm,
          targetSeconds: state.goal.targetSeconds,
        }
      : undefined,
    sessions: [...state.sessions]
      .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id))
      .map(session => ({
        id: session.id,
        date: session.date,
        title: session.title,
        kind: session.kind,
        minutes: session.minutes,
        purpose: session.purpose,
        templateId: session.templateId,
        locked: session.locked,
        status: session.status,
        effort: session.effort,
        activityId: session.activityId,
        origin: session.origin,
        routineDay: session.routineDay,
      })),
  });
}

function actualSessionStatus(
  session: ScheduledSession,
  runs: Run[],
  strengthSessions: StrengthSession[],
): ActivityStatus {
  if (session.status === 'skipped') return 'skipped';
  if (!session.activityId) return 'planned';

  if (session.kind === 'run') {
    const run = runs.find(
      candidate =>
        candidate.id === session.activityId ||
        candidate.canonicalId === session.activityId,
    );
    if (!run) return 'planned';
    const runStatus = String(run.status || '').toLowerCase();
    const finished =
      run.endTime > run.startTime &&
      ['completed', 'finished', 'complete', 'done', 'imported'].includes(
        runStatus,
      );
    return finished ? 'done' : 'started';
  }

  const strength = strengthSessions.find(
    candidate => candidate.id === session.activityId,
  );
  if (!strength) return 'planned';
  return strength.status === 'finished' &&
    (strength.endTime ?? 0) > strength.startTime
    ? 'done'
    : 'started';
}

function statusLabel(status: ActivityStatus): string {
  switch (status) {
    case 'done':
      return tr('Erledigt', 'Done');
    case 'started':
      return tr('Gestartet', 'Started');
    case 'skipped':
      return tr('Ausgelassen', 'Skipped');
    default:
      return tr('Geplant', 'Planned');
  }
}

function sessionKindLabel(session: ScheduledSession): string {
  return session.kind === 'run' ? tr('Lauf', 'Run') : tr('Kraft', 'Strength');
}

function createSessionDraft(
  date: string,
  session?: ScheduledSession,
): SessionDraft {
  return {
    id: session?.id,
    date,
    title: session ? scheduleTitle(session) : '',
    kind: session?.kind ?? 'run',
    minutes: session ? String(session.minutes) : '30',
    purpose: session?.purpose ?? 'easy',
    effort:
      session?.effort ??
      (session?.purpose === 'intervals' || session?.purpose === 'race'
        ? 'hard'
        : 'easy'),
    templateId: session?.templateId,
    locked: Boolean(session?.locked),
  };
}

function monthCells(month: Date): Date[] {
  const start = mondayOf(firstOfMonth(month));
  const last = new Date(month.getFullYear(), month.getMonth() + 1, 0);
  const leadingDays = mondayIndex(firstOfMonth(month));
  const days = Math.ceil((leadingDays + last.getDate()) / 7) * 7;
  return Array.from({ length: Math.max(35, days) }, (_, index) =>
    addDays(start, index),
  );
}

function inMonth(value: Date, month: Date): boolean {
  return (
    value.getFullYear() === month.getFullYear() &&
    value.getMonth() === month.getMonth()
  );
}

function actualIdMatches(
  activityId: string | undefined,
  id: string,
  canonicalId?: string,
) {
  return Boolean(
    activityId && (activityId === id || activityId === canonicalId),
  );
}

function actualIsFinishedRun(run: Run): boolean {
  const status = String(run.status || '').toLowerCase();
  return (
    run.endTime > run.startTime &&
    ['completed', 'finished', 'complete', 'done', 'imported'].includes(status)
  );
}

/**
 * With a race goal and date, the build-up replaces the uniform routine: one
 * long run per week, easing off before the goal, the race on the goal date.
 * Without the basis, the suggestion says what is missing and proposes the
 * routine as usual.
 */
function suggestTrainingWeek(
  state: ScheduleState,
  weekStart: Date,
  templates: WorkoutTemplate[],
  today: string,
  runs: Run[],
  now: number,
): WeekSuggestion {
  const goal = state.goal;
  const distanceKm = goal ? effectiveGoalDistanceKm(goal) : undefined;
  const buildUp =
    goal?.targetDate && distanceKm !== undefined
      ? buildUpWeek({
          goal: { name: goal.name, distanceKm, targetDate: goal.targetDate },
          runs,
          routine: state.routine,
          weekStart: localDateKey(weekStart),
          today,
          now,
        })
      : undefined;
  const suggestion = suggestWeek(state, weekStart, {
    today,
    strengthTemplates: templates,
    runSlots: buildUp?.status === 'ready' ? buildUp.slots : undefined,
  });
  if (!buildUp) {
    return suggestion;
  }
  return {
    ...suggestion,
    warnings: [...buildUp.limits, ...suggestion.warnings],
    rationale: [...buildUp.rationale, ...suggestion.rationale],
  };
}

export function PlanningScreen({
  state,
  onSave,
  templates,
  runs,
  strengthSessions,
  now,
  onStartRun,
  onStartStrength,
  onDevelopment,
  onManageTemplates,
  onOpenRoutePlanner,
  busy = false,
  showSuggest = true,
  showMonth = true,
  showStrength = true,
}: PlanningScreenProps) {
  const [displayState, setDisplayState] = useState<ScheduleState>(() =>
    cloneState(state),
  );
  const [view, setView] = useState<ViewMode>('week');
  const [weekStart, setWeekStart] = useState(() =>
    mondayOf(localDateFrom(now)),
  );
  const [monthDate, setMonthDate] = useState(() =>
    firstOfMonth(localDateFrom(now)),
  );
  const [adjusting, setAdjusting] = useState(false);
  const [scope, setScope] = useState<PlanningScope>('week');
  const [availabilityDraft, setAvailabilityDraft] = useState<
    Record<string, string>
  >({});
  const [routineDaysDraft, setRoutineDaysDraft] = useState<number[]>([]);
  const [routineMinutesDraft, setRoutineMinutesDraft] = useState('30');
  const [proposal, setProposal] = useState<WeekSuggestion | null>(null);
  const [editor, setEditor] = useState<SessionDraft | null>(null);
  const [detailsId, setDetailsId] = useState<string | null>(null);
  const [moveId, setMoveId] = useState<string | null>(null);
  const [moveWeekStart, setMoveWeekStart] = useState(() =>
    mondayOf(localDateFrom(now)),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [validation, setValidation] = useState('');
  const [pending, setPending] = useState<PendingSave | null>(null);
  const [undoState, setUndoState] = useState<ScheduleState | null>(null);
  const [startingId, setStartingId] = useState<string | null>(null);
  const saveExpectation = useRef<ScheduleState | null>(null);

  const today = isoDate(localDateFrom(now));
  const working = saving || Boolean(busy) || Boolean(pending);

  useEffect(() => {
    if (saving || pending) return;
    const expected = saveExpectation.current;
    if (expected) {
      if (scheduleSignature(state) !== scheduleSignature(expected)) return;
      saveExpectation.current = null;
    }
    setDisplayState(cloneState(state));
  }, [pending, saving, state]);

  const weekDates = useMemo(
    () => Array.from({ length: 7 }, (_, index) => addDays(weekStart, index)),
    [weekStart],
  );
  const moveWeekDates = useMemo(
    () =>
      Array.from({ length: 7 }, (_, index) => addDays(moveWeekStart, index)),
    [moveWeekStart],
  );
  const weekDateKeys = useMemo(() => weekDates.map(isoDate), [weekDates]);
  const monthDays = useMemo(() => monthCells(monthDate), [monthDate]);
  const monthRows = useMemo(
    () =>
      Array.from({ length: Math.ceil(monthDays.length / 7) }, (_, index) =>
        monthDays.slice(index * 7, index * 7 + 7),
      ),
    [monthDays],
  );
  const sessionsByDate = useMemo(() => {
    const grouped: Record<string, ScheduledSession[]> = {};
    displayState.sessions.forEach(session => {
      grouped[session.date] = grouped[session.date] ?? [];
      grouped[session.date].push(session);
    });
    return grouped;
  }, [displayState.sessions]);
  const detailsSession = detailsId
    ? displayState.sessions.find(session => session.id === detailsId) ?? null
    : null;
  const moveSessionDraft = moveId
    ? displayState.sessions.find(session => session.id === moveId) ?? null
    : null;

  const availableMinutes = useCallback(
    (date: string, _day?: number) => {
      if (
        Object.prototype.hasOwnProperty.call(displayState.availability, date)
      ) {
        return Math.max(0, displayState.availability[date] ?? 0);
      }
      return displayState.routine.minutes;
    },
    [displayState.availability, displayState.routine],
  );

  const visibleRange = useMemo(() => {
    if (view === 'week') return weekDateKeys;
    return monthDays.filter(day => inMonth(day, monthDate)).map(isoDate);
  }, [monthDate, monthDays, view, weekDateKeys]);

  const freeRuns = useMemo(() => {
    const linked = displayState.sessions
      .map(session => session.activityId)
      .filter((id): id is string => Boolean(id));
    return runs
      .filter(
        run => !linked.some(id => actualIdMatches(id, run.id, run.canonicalId)),
      )
      .filter(run =>
        visibleRange.includes(isoDate(localDateFrom(run.startTime))),
      )
      .sort((a, b) => b.startTime - a.startTime);
  }, [displayState.sessions, runs, visibleRange]);

  const freeStrength = useMemo(() => {
    const linked = displayState.sessions
      .map(session => session.activityId)
      .filter((id): id is string => Boolean(id));
    return strengthSessions
      .filter(session => !linked.includes(session.id))
      .filter(session =>
        visibleRange.includes(isoDate(localDateFrom(session.startTime))),
      )
      .sort((a, b) => b.startTime - a.startTime);
  }, [displayState.sessions, strengthSessions, visibleRange]);

  const persist = useCallback(
    async (
      next: ScheduleState,
      saveMessage: string,
      trackUndo = true,
      previous = displayState,
    ): Promise<boolean> => {
      setError('');
      setMessage('');
      setValidation('');
      setPending(null);
      saveExpectation.current = cloneState(next);
      setDisplayState(cloneState(next));
      setSaving(true);
      try {
        await onSave(next);
        setUndoState(trackUndo ? cloneState(previous) : null);
        setMessage(saveMessage);
        return true;
      } catch (caught) {
        const reason =
          caught instanceof Error
            ? caught.message
            : tr('Bitte versuche es erneut.', 'Please try again.');
        setDisplayState(cloneState(previous));
        saveExpectation.current = null;
        setPending({
          next: cloneState(next),
          previous: cloneState(previous),
          message: saveMessage,
          trackUndo,
        });
        setError(
          tr(
            `Änderung nicht gespeichert. ${reason}`,
            `Change not saved. ${reason}`,
          ),
        );
        return false;
      } finally {
        setSaving(false);
      }
    },
    [displayState, onSave],
  );

  const retrySave = useCallback(() => {
    if (!pending || saving || busy) return;
    void persist(
      pending.next,
      pending.message,
      pending.trackUndo,
      pending.previous,
    ).then(ok => {
      if (ok) {
        setEditor(null);
        setAdjusting(false);
        setMoveId(null);
        setDetailsId(null);
        setProposal(null);
      }
    });
  }, [pending, persist, saving, busy]);

  const undo = useCallback(() => {
    if (!undoState || working) return;
    void persist(
      undoState,
      tr('Letzte Änderung zurückgenommen.', 'Last change undone.'),
      false,
      displayState,
    ).then(ok => {
      if (ok) setUndoState(null);
    });
  }, [displayState, persist, undoState, working]);

  const openAdjustment = useCallback(() => {
    const values: Record<string, string> = {};
    weekDates.forEach((date, index) => {
      const key = isoDate(date);
      values[key] = String(availableMinutes(key, index));
    });
    setAvailabilityDraft(values);
    setRoutineDaysDraft([...displayState.routine.days]);
    setRoutineMinutesDraft(String(displayState.routine.minutes));
    setScope('week');
    setValidation('');
    setAdjusting(true);
  }, [
    availableMinutes,
    displayState.routine.days,
    displayState.routine.minutes,
    weekDates,
  ]);

  const saveAdjustment = useCallback(async () => {
    if (scope === 'routine') {
      const minutes = parseDuration(routineMinutesDraft);
      if (minutes === undefined) {
        setValidation(
          tr(
            'Der Rhythmus braucht 1 bis 1.440 Minuten.',
            'The routine needs 1 to 1,440 minutes.',
          ),
        );
        return;
      }
      const next = setRoutine(displayState, {
        days: routineDaysDraft,
        minutes,
      });
      const ok = await persist(
        next,
        tr('Rhythmus gespeichert.', 'Routine saved.'),
      );
      if (ok) setAdjusting(false);
      return;
    }

    let next = cloneState(displayState);
    for (const date of weekDateKeys) {
      const minutes = parseMinutes(availabilityDraft[date] ?? '');
      if (minutes === undefined) {
        const day = fullDateLabel(localDateFrom(date));
        setValidation(
          tr(
            `Bitte trage für ${day} eine Zahl zwischen 0 und 1.440 ein.`,
            `Enter a number from 0 to 1,440 for ${day}.`,
          ),
        );
        return;
      }
      next = setAvailability(next, date, minutes);
    }
    const ok = await persist(
      next,
      tr('Verfügbarkeit gespeichert.', 'Availability saved.'),
    );
    if (ok) setAdjusting(false);
  }, [
    availabilityDraft,
    displayState,
    persist,
    routineDaysDraft,
    routineMinutesDraft,
    scope,
    weekDateKeys,
  ]);

  const createProposal = useCallback(() => {
    setError('');
    setMessage('');
    setValidation('');
    setProposal(
      suggestTrainingWeek(displayState, weekStart, templates, today, runs, now),
    );
  }, [displayState, now, runs, templates, today, weekStart]);

  const applyProposal = useCallback(async () => {
    if (
      !proposal ||
      (!proposal.addedSessions.length && !proposal.movedSessions.length) ||
      working
    ) {
      return;
    }
    const next = applyWeekSuggestion(displayState, proposal, { today });
    if (next === displayState) {
      setError(
        tr(
          'Der Plan hat sich geändert. Erstelle den Vorschlag bitte erneut.',
          'The plan has changed. Please create the suggestion again.',
        ),
      );
      setProposal(null);
      return;
    }
    const ok = await persist(
      next,
      tr('Vorschlag übernommen.', 'Suggestion applied.'),
    );
    if (ok) setProposal(null);
  }, [displayState, persist, proposal, today, working]);

  const openEditor = useCallback(
    (session?: ScheduledSession, date = weekDateKeys[0]) => {
      setValidation('');
      setProposal(null);
      setDetailsId(null);
      setEditor(createSessionDraft(date, session));
    },
    [weekDateKeys],
  );

  const saveEditor = useCallback(async () => {
    if (!editor) return;
    const title = storedScheduleTitle(editor.title.trim());
    const minutes = parseDuration(editor.minutes);
    if (!title) {
      setValidation(
        tr(
          'Bitte gib der Einheit einen Namen.',
          'Enter a name for the workout.',
        ),
      );
      return;
    }
    if (minutes === undefined) {
      setValidation(
        tr(
          'Die Dauer muss zwischen 1 und 1.440 Minuten liegen.',
          'The duration must be between 1 and 1,440 minutes.',
        ),
      );
      return;
    }
    const current = editor.id
      ? displayState.sessions.find(session => session.id === editor.id)
      : undefined;
    if (current?.locked) {
      setValidation(
        tr(
          'Eine gesperrte Einheit kann nicht geändert werden.',
          "A locked workout can't be changed.",
        ),
      );
      return;
    }
    if (current?.activityId && editor.kind !== current.kind) {
      setValidation(
        tr(
          'Eine gestartete Einheit kann nicht in eine andere Art geaendert werden.',
          "A started workout can't be changed to another kind.",
        ),
      );
      return;
    }
    const session: ScheduledSession = {
      id: editor.id ?? `session-${Date.now()}-${nextSessionNumber++}`,
      date: editor.date,
      title,
      kind: editor.kind,
      minutes,
      purpose: editor.kind === 'run' ? editor.purpose : undefined,
      templateId: editor.kind === 'strength' ? editor.templateId : undefined,
      locked: current?.locked ?? false,
      status: current?.status ?? 'planned',
      effort: current?.effort ?? 'easy',
      activityId: current?.activityId,
      origin: current?.origin ?? 'manual',
      routineDay: current?.routineDay,
    };
    const next = current
      ? updateSession(
          displayState,
          current.id,
          {
            title: session.title,
            kind: session.kind,
            minutes: session.minutes,
            purpose: session.purpose,
            templateId: session.templateId,
            effort: session.effort,
          },
          { today },
        )
      : addScheduledSession(displayState, session, { today });
    if (next === displayState) {
      setValidation(
        tr(
          'Die Einheit konnte nicht geändert werden. Prüfe Datum und Sperre.',
          "The workout couldn't be changed. Check the date and lock.",
        ),
      );
      return;
    }
    const ok = await persist(
      next,
      current
        ? tr('Einheit geändert.', 'Workout changed.')
        : tr('Einheit hinzugefügt.', 'Workout added.'),
    );
    if (ok) setEditor(null);
  }, [displayState, editor, persist, today]);

  const handleMoveChoice = useCallback(
    async (session: ScheduledSession, date: string) => {
      if (working || session.locked || session.date === date) return;
      const proposalForMove = proposeMove(displayState, session.id, date, {
        today,
        maxSuggestions: 2,
      });
      if (!proposalForMove.allowed) {
        const explanation = proposalForMove.conflicts
          .map(conflict => conflict.message)
          .join(' ');
        setValidation(
          explanation ||
            tr(
              'Dieser Tag passt nicht für die Einheit.',
              "This day doesn't fit the workout.",
            ),
        );
        return;
      }
      const next = applyDomainMove(displayState, proposalForMove);
      if (next === displayState) {
        setValidation(
          tr(
            'Die Einheit konnte nicht verschoben werden.',
            "The workout couldn't be moved.",
          ),
        );
        return;
      }
      const ok = await persist(
        next,
        tr('Einheit verschoben.', 'Workout moved.'),
      );
      if (ok) {
        setMoveId(null);
        setDetailsId(null);
      }
    },
    [displayState, persist, today, working],
  );

  const skip = useCallback(
    async (session: ScheduledSession) => {
      if (working || session.activityId || session.date < today) return;
      const next =
        session.status === 'skipped'
          ? updateSession(
              displayState,
              session.id,
              { status: 'planned' },
              { today },
            )
          : cancelSession(displayState, session.id, { today });
      if (next === displayState) {
        setValidation(
          tr(
            'Diese Einheit kann nicht mehr geändert werden.',
            "This workout can't be changed anymore.",
          ),
        );
        return;
      }
      const ok = await persist(
        next,
        session.status === 'skipped'
          ? tr('Einheit wieder eingeplant.', 'Workout scheduled again.')
          : tr('Einheit ausgelassen.', 'Workout skipped.'),
      );
      if (ok) setDetailsId(null);
    },
    [displayState, persist, today, working],
  );

  const toggleLock = useCallback(
    async (session: ScheduledSession) => {
      if (working || session.date < today) return;
      let next: ScheduleState;
      if (session.locked) {
        next = {
          ...cloneState(displayState),
          sessions: displayState.sessions.map(candidate =>
            candidate.id === session.id
              ? {
                  ...candidate,
                  locked: false,
                  origin:
                    candidate.origin === 'fixed' ? 'manual' : candidate.origin,
                }
              : { ...candidate },
          ),
        };
      } else {
        next = updateSession(
          displayState,
          session.id,
          { locked: true },
          { today },
        );
      }
      if (next === displayState) {
        setValidation(
          tr(
            'Die Sperre konnte nicht geändert werden.',
            "The lock couldn't be changed.",
          ),
        );
        return;
      }
      const ok = await persist(
        next,
        session.locked
          ? tr('Einheit wieder flexibel.', 'Workout is flexible again.')
          : tr('Einheit gesperrt.', 'Workout locked.'),
      );
      if (ok) setDetailsId(null);
    },
    [displayState, persist, today, working],
  );

  const startSession = useCallback(
    async (session: ScheduledSession) => {
      if (working || startingId) return;
      const handler = session.kind === 'run' ? onStartRun : onStartStrength;
      if (session.date !== today) {
        setValidation(
          tr(
            'Verschiebe die Einheit zuerst auf heute.',
            'Move the workout to today first.',
          ),
        );
        return;
      }
      setError('');
      setStartingId(session.id);
      try {
        await handler(session);
        setMessage(
          tr(
            `${session.title} kann jetzt gestartet werden.`,
            `${scheduleTitle(session)} can be started now.`,
          ),
        );
        setDetailsId(null);
      } catch (caught) {
        const reason =
          caught instanceof Error
            ? caught.message
            : tr('Bitte versuche es erneut.', 'Please try again.');
        setError(
          tr(
            `Einheit konnte nicht gestartet werden. ${reason}`,
            `Couldn't start the workout. ${reason}`,
          ),
        );
      } finally {
        setStartingId(null);
      }
    },
    [onStartRun, onStartStrength, startingId, today, working],
  );

  const jumpToToday = useCallback(() => {
    const current = localDateFrom(now);
    setWeekStart(mondayOf(current));
    setMonthDate(firstOfMonth(current));
  }, [now]);

  const navigateWeek = useCallback((amount: number) => {
    setWeekStart(current => addDays(current, amount * 7));
  }, []);

  const navigateMonth = useCallback((amount: number) => {
    setMonthDate(
      current =>
        new Date(current.getFullYear(), current.getMonth() + amount, 1),
    );
  }, []);

  const openMove = useCallback((session: ScheduledSession) => {
    setValidation('');
    setDetailsId(null);
    setMoveId(session.id);
    setMoveWeekStart(mondayOf(localDateFrom(session.date)));
  }, []);

  const summaryMinutes = weekDateKeys.reduce(
    (total, date) =>
      total +
      (sessionsByDate[date] ?? []).reduce(
        (sum, session) => sum + session.minutes,
        0,
      ),
    0,
  );
  const weekSessionCount = weekDateKeys.reduce(
    (total, date) => total + (sessionsByDate[date] ?? []).length,
    0,
  );

  const renderSession = (session: ScheduledSession) => {
    const status = actualSessionStatus(session, runs, strengthSessions);
    return (
      <Pressable
        key={session.id}
        accessibilityRole="button"
        accessibilityLabel={tr(
          `Einheit ${session.title}, ${fullDateLabel(
            localDateFrom(session.date),
          )}`,
          `Workout ${scheduleTitle(session)}, ${fullDateLabel(
            localDateFrom(session.date),
          )}`,
        )}
        accessibilityState={{ disabled: working }}
        disabled={working}
        onPress={() => setDetailsId(session.id)}
        style={({ pressed }) => [styles.session, pressed && styles.pressed]}
      >
        <View style={styles.sessionMain}>
          <Text
            style={[
              styles.sessionTitle,
              session.status === 'skipped' && styles.struck,
            ]}
          >
            {scheduleTitle(session)}
          </Text>
          <Text style={styles.sessionMeta}>
            {sessionKindLabel(session)} · {formatMinutes(session.minutes)} ·{' '}
            {statusLabel(status)}
          </Text>
        </View>
        <Text
          style={session.locked ? styles.sessionLocked : styles.sessionMark}
        >
          {session.locked ? tr('Gesperrt', 'Locked') : '›'}
        </Text>
      </Pressable>
    );
  };

  const renderDayRow = (date: Date, index: number) => {
    const key = isoDate(date);
    const sessions = sessionsByDate[key] ?? [];
    const available = availableMinutes(key, index);
    const past = key < today;
    // The time budget only shows on days where it says something: routine days
    // and exceptions set on purpose.
    const budgetShown =
      displayState.routine.days.includes(index) ||
      Object.prototype.hasOwnProperty.call(displayState.availability, key);
    if (!sessions.length) {
      return (
        <Pressable
          key={key}
          accessibilityRole="button"
          accessibilityLabel={tr(
            `Einheit am ${weekdayLong()[index]} hinzufügen`,
            `Add workout on ${weekdayLong()[index]}`,
          )}
          accessibilityState={{ disabled: working || past }}
          disabled={working || past}
          onPress={() => openEditor(undefined, key)}
          style={({ pressed }) => [
            styles.emptyDayRow,
            pressed && styles.pressed,
          ]}
        >
          <View style={styles.dayHeadingText}>
            <Text style={[styles.dayTitle, past && styles.mutedText]}>
              {fullDateLabel(date)}
            </Text>
            {budgetShown && !past ? (
              <Text style={styles.dayMeta}>
                {tr(
                  `${formatMinutes(available)} verfügbar`,
                  `${formatMinutes(available)} available`,
                )}
              </Text>
            ) : null}
          </View>
          {past ? null : <Text style={styles.addText}>+</Text>}
        </Pressable>
      );
    }
    return (
      <View key={key} style={styles.dayCard}>
        <View style={styles.dayHeading}>
          <View style={styles.dayHeadingText}>
            <Text style={styles.dayTitle}>{fullDateLabel(date)}</Text>
            {budgetShown && !past ? (
              <Text style={styles.dayMeta}>
                {tr(
                  `${formatMinutes(available)} verfügbar`,
                  `${formatMinutes(available)} available`,
                )}
              </Text>
            ) : null}
          </View>
          {past ? null : (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={tr(
                `Einheit am ${weekdayLong()[index]} hinzufügen`,
                `Add workout on ${weekdayLong()[index]}`,
              )}
              accessibilityState={{ disabled: working }}
              disabled={working}
              onPress={() => openEditor(undefined, key)}
              style={({ pressed }) => [
                styles.addButton,
                pressed && styles.pressed,
              ]}
            >
              <Text style={styles.addText}>+</Text>
            </Pressable>
          )}
        </View>
        {sessions.map(renderSession)}
      </View>
    );
  };

  const renderCalendarCell = (date: Date) => {
    const key = isoDate(date);
    const sessions = sessionsByDate[key] ?? [];
    const selected = key === today;
    const outside = !inMonth(date, monthDate);
    return (
      <Pressable
        key={key}
        accessibilityRole="button"
        accessibilityLabel={`${fullDateLabel(date)}${
          sessions.length
            ? tr(
                `, ${sessions.length} Einheiten`,
                `, ${sessions.length} ${
                  sessions.length === 1 ? 'workout' : 'workouts'
                }`,
              )
            : ''
        }`}
        accessibilityState={{ selected }}
        onPress={() => {
          setWeekStart(mondayOf(date));
          setView('week');
        }}
        style={({ pressed }) => [
          styles.calendarCell,
          outside && styles.calendarOutside,
          selected && styles.calendarToday,
          pressed && styles.pressed,
        ]}
      >
        <Text style={[styles.calendarNumber, outside && styles.mutedText]}>
          {date.getDate()}
        </Text>
        {sessions.slice(0, 3).map(session => (
          <View
            key={session.id}
            style={[
              styles.calendarDot,
              session.status === 'skipped' && styles.calendarDotSkipped,
            ]}
          />
        ))}
      </Pressable>
    );
  };

  const renderActuals = () => {
    if (!freeRuns.length && !freeStrength.length) return null;
    return (
      <Section title={tr('Ohne Plan trainiert', 'Trained without a plan')}>
        <Card>
          {freeRuns.map(run => (
            <Row
              key={`run-${run.id}`}
              title={runTitle(run)}
              subtitle={`${formatActivityDate(run.startTime)} · ${
                actualIsFinishedRun(run)
                  ? statusLabel('done')
                  : statusLabel('started')
              }`}
              trailing={
                <Text style={styles.activityType}>{tr('Lauf', 'Run')}</Text>
              }
            />
          ))}
          {freeStrength.map(session => (
            <Row
              key={`strength-${session.id}`}
              title={displaySessionName(session.name)}
              subtitle={`${formatActivityDate(session.startTime)} · ${
                session.status === 'finished' &&
                (session.endTime ?? 0) > session.startTime
                  ? statusLabel('done')
                  : statusLabel('started')
              }`}
              trailing={
                <Text style={styles.activityType}>
                  {tr('Kraft', 'Strength')}
                </Text>
              }
            />
          ))}
        </Card>
      </Section>
    );
  };

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <Title>Plan</Title>
        {working ? (
          <ActivityIndicator
            color={color.green}
            accessibilityLabel={tr('Speichern läuft', 'Saving')}
          />
        ) : null}
      </View>

      {error ? (
        <Notice
          title={tr('Aktion nicht abgeschlossen', 'Action not completed')}
          onDismiss={() => setError('')}
        >
          {error}
        </Notice>
      ) : null}
      {message ? (
        <Notice onDismiss={() => setMessage('')}>{message}</Notice>
      ) : null}
      {pending ? (
        <Notice title={tr('Speichern erneut versuchen', 'Try saving again')}>
          <Text>
            {tr(
              'Deine Eingaben sind noch offen.',
              'Your changes are still open.',
            )}
          </Text>
          <View style={styles.noticeAction}>
            <Button
              title={tr('Erneut speichern', 'Save again')}
              secondary
              small
              disabled={saving || Boolean(busy)}
              onPress={retrySave}
            />
            <Button
              title={tr('Änderung verwerfen', 'Discard change')}
              secondary
              small
              disabled={saving || Boolean(busy)}
              onPress={() => {
                setPending(null);
                setError('');
                setEditor(null);
                setAdjusting(false);
                setMoveId(null);
                setProposal(null);
              }}
            />
          </View>
        </Notice>
      ) : null}
      {validation ? (
        <Notice
          title={tr('Bitte prüfen', 'Please check')}
          onDismiss={() => setValidation('')}
        >
          {validation}
        </Notice>
      ) : null}

      {view === 'week' || !showMonth ? (
        <>
          <View style={styles.periodNavigation}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={tr('Vorherige Woche', 'Previous week')}
              accessibilityState={{ disabled: working }}
              disabled={working}
              onPress={() => navigateWeek(-1)}
              style={styles.navButton}
            >
              <Text style={styles.navText}>‹</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={tr('Aktuelle Woche', 'Current week')}
              accessibilityState={{ disabled: working }}
              disabled={working}
              onPress={jumpToToday}
              style={styles.periodLabel}
            >
              <Text style={styles.periodTitle}>
                {dateLabel(weekDates[0])} – {dateLabel(weekDates[6])}
              </Text>
              <Text style={styles.periodMeta}>
                {weekSessionCount === 0
                  ? tr('Nichts geplant', 'Nothing planned')
                  : `${tr(
                      weekSessionCount === 1
                        ? '1 Einheit'
                        : `${weekSessionCount} Einheiten`,
                      weekSessionCount === 1
                        ? '1 workout'
                        : `${weekSessionCount} workouts`,
                    )} · ${formatMinutes(summaryMinutes)}`}
              </Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={tr('Nächste Woche', 'Next week')}
              accessibilityState={{ disabled: working }}
              disabled={working}
              onPress={() => navigateWeek(1)}
              style={styles.navButton}
            >
              <Text style={styles.navText}>›</Text>
            </Pressable>
          </View>
          <Card style={styles.weekCard}>{weekDates.map(renderDayRow)}</Card>
          {showSuggest ? (
            <Button
              title={tr('Woche vorschlagen lassen', 'Suggest a week')}
              secondary={Boolean(weekSessionCount)}
              disabled={working}
              onPress={createProposal}
              label={tr(
                'Trainingswoche aus Rhythmus und Kraftvorlagen vorschlagen',
                'Suggest a training week from your routine and strength templates',
              )}
            />
          ) : null}
          {showMonth ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={tr('Monat', 'Month')}
              accessibilityState={{ disabled: working }}
              disabled={working}
              onPress={() => setView('month')}
              style={({ pressed }) => [
                styles.monthLink,
                pressed && styles.pressed,
              ]}
            >
              <Text style={styles.monthLinkText}>
                {tr('Monat ansehen ›', 'View month ›')}
              </Text>
            </Pressable>
          ) : null}
        </>
      ) : (
        <Section title={monthLabel(monthDate)}>
          <View style={styles.periodNavigation}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={tr('Vorheriger Monat', 'Previous month')}
              accessibilityState={{ disabled: working }}
              disabled={working}
              onPress={() => navigateMonth(-1)}
              style={styles.navButton}
            >
              <Text style={styles.navText}>‹</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={tr('Aktuellen Monat', 'Current month')}
              accessibilityState={{ disabled: working }}
              disabled={working}
              onPress={jumpToToday}
              style={styles.periodLabel}
            >
              <Text style={styles.periodTitle}>{tr('Heute', 'Today')}</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={tr('Nächster Monat', 'Next month')}
              accessibilityState={{ disabled: working }}
              disabled={working}
              onPress={() => navigateMonth(1)}
              style={styles.navButton}
            >
              <Text style={styles.navText}>›</Text>
            </Pressable>
          </View>
          <View style={styles.calendarWeekdays}>
            {weekdayShort().map(day => (
              <Text key={day} style={styles.calendarWeekday}>
                {day}
              </Text>
            ))}
          </View>
          <View style={styles.calendarGrid}>
            {monthRows.map((row, index) => (
              <View key={`month-week-${index}`} style={styles.calendarRow}>
                {row.map(renderCalendarCell)}
              </View>
            ))}
          </View>
          <Button
            title={tr('Zurück zur Woche', 'Back to week')}
            secondary
            small
            label={tr('Woche', 'Week')}
            onPress={() => setView('week')}
          />
        </Section>
      )}

      {undoState ? (
        <View style={styles.undoRow}>
          <Copy muted>{tr('Änderung gespeichert.', 'Change saved.')}</Copy>
          <Button
            title={tr('Rückgängig', 'Undo')}
            secondary
            small
            disabled={working}
            onPress={undo}
          />
        </View>
      ) : null}

      {renderActuals()}

      <Section title={tr('Mehr', 'More')}>
        <Row
          title={tr('Zeit & Rhythmus', 'Time & routine')}
          subtitle={`${
            displayState.routine.days.length
              ? displayState.routine.days
                  .map(day => weekdayShort()[day])
                  .join(' · ')
              : tr('Keine festen Tage', 'No fixed days')
          } · ${tr(
            `${formatMinutes(displayState.routine.minutes)} üblich`,
            `${formatMinutes(displayState.routine.minutes)} usual`,
          )}`}
          onPress={openAdjustment}
        />
        {onManageTemplates ? (
          <Row
            title={tr('Vorlagen', 'Templates')}
            subtitle={
              templates.length
                ? tr(
                    `${templates.length} ${
                      templates.length === 1 ? 'Kraftvorlage' : 'Kraftvorlagen'
                    } · Laufvorlagen`,
                    `${templates.length} ${
                      templates.length === 1
                        ? 'strength template'
                        : 'strength templates'
                    } · Run templates`,
                  )
                : tr('Kraft- und Laufvorlagen', 'Strength and run templates')
            }
            onPress={onManageTemplates}
          />
        ) : null}
        {onOpenRoutePlanner ? (
          <Row
            title={tr('Route planen', 'Plan route')}
            subtitle={tr(
              'Strecke festlegen und beim Lauf folgen',
              'Set the distance and follow it on your run',
            )}
            onPress={onOpenRoutePlanner}
          />
        ) : null}
        {onDevelopment ? (
          <Row
            title={tr('Entwicklung', 'Progress')}
            subtitle={tr(
              'Ziel, Planstand und tatsächliches Training',
              'Goal, plan status, and actual training',
            )}
            onPress={onDevelopment}
          />
        ) : null}
      </Section>

      <Modal
        visible={Boolean(proposal)}
        transparent
        animationType="slide"
        onRequestClose={() => setProposal(null)}
      >
        <KeyboardAvoidingView behavior="height" style={styles.modalBackdrop}>
          <ScrollView
            style={styles.modalScroll}
            contentContainerStyle={styles.modalCard}
            keyboardShouldPersistTaps="handled"
          >
            <View style={styles.modalHeader}>
              <Text accessibilityRole="header" style={styles.modalTitle}>
                {tr('Wochenvorschlag', 'Week suggestion')}
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={tr(
                  'Vorschlag schließen',
                  'Close suggestion',
                )}
                onPress={() => setProposal(null)}
                style={styles.closeButton}
              >
                <Text style={styles.closeText}>×</Text>
              </Pressable>
            </View>
            {proposal ? (
              proposal.addedSessions.length || proposal.movedSessions.length ? (
                <>
                  <Copy>
                    {proposal.addedSessions.length +
                      proposal.movedSessions.length ===
                    1
                      ? tr(
                          '1 Änderung für diese Woche.',
                          '1 change for this week.',
                        )
                      : tr(
                          `${
                            proposal.addedSessions.length +
                            proposal.movedSessions.length
                          } Änderungen für diese Woche.`,
                          `${
                            proposal.addedSessions.length +
                            proposal.movedSessions.length
                          } changes for this week.`,
                        )}
                  </Copy>
                  {proposal.addedSessions.map(session => (
                    <Row
                      key={session.id}
                      title={scheduleTitle(session)}
                      subtitle={`${fullDateLabel(
                        localDateFrom(session.date),
                      )} · ${formatMinutes(session.minutes)}`}
                    />
                  ))}
                  {proposal.moves.map(move => (
                    <Row
                      key={move.id}
                      title={scheduleTitle(move)}
                      subtitle={`${dateLabel(
                        localDateFrom(move.from),
                      )} → ${dateLabel(
                        localDateFrom(move.to),
                      )} · ${formatMinutes(move.session.minutes)}`}
                    />
                  ))}
                  {proposal.warnings.map(warning => (
                    <Notice key={warning}>{warning}</Notice>
                  ))}
                  {/* Dated entries are the routine's log ("2026-09-28: …"); what
                      changes is already in the rows above. A build-up sentence
                      carries a reason instead. */}
                  {proposal.rationale
                    .filter(line => !/^\d{4}-\d{2}-\d{2}:/.test(line))
                    .slice(0, 1)
                    .map(line => (
                      <Copy muted key={line}>
                        {line}
                      </Copy>
                    ))}
                  <Button
                    title={tr('Vorschlag übernehmen', 'Apply suggestion')}
                    disabled={working}
                    onPress={() => void applyProposal()}
                  />
                </>
              ) : (
                <EmptyState
                  title={tr('Keine neue Einheit', 'No new workout')}
                  copy={
                    proposal.warnings[0] ??
                    (displayState.routine.days.length ||
                    templates.some(template => template.days.length)
                      ? tr(
                          'Der vorhandene Plan passt bereits.',
                          'The existing plan already fits.',
                        )
                      : tr(
                          'Lege unter „Zeit & Rhythmus“ deine üblichen Tage fest oder füge eine Einheit direkt hinzu.',
                          'Set your usual days under “Time & routine”, or add a workout directly.',
                        ))
                  }
                  action={{
                    title: tr('Schließen', 'Close'),
                    onPress: () => setProposal(null),
                  }}
                />
              )
            ) : null}
          </ScrollView>
        </KeyboardAvoidingView>
      </Modal>

      <Modal
        visible={Boolean(detailsSession)}
        transparent
        animationType="slide"
        onRequestClose={() => setDetailsId(null)}
      >
        <KeyboardAvoidingView behavior="height" style={styles.modalBackdrop}>
          <ScrollView
            style={styles.modalScroll}
            contentContainerStyle={styles.modalCard}
            keyboardShouldPersistTaps="handled"
          >
            <View style={styles.modalHeader}>
              <Text accessibilityRole="header" style={styles.modalTitle}>
                {tr('Einheit', 'Workout')}
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={tr('Details schließen', 'Close details')}
                onPress={() => setDetailsId(null)}
                style={styles.closeButton}
              >
                <Text style={styles.closeText}>×</Text>
              </Pressable>
            </View>
            {detailsSession ? (
              <>
                <Text style={styles.detailTitle}>
                  {scheduleTitle(detailsSession)}
                </Text>
                <Text style={styles.detailMeta}>
                  {fullDateLabel(localDateFrom(detailsSession.date))} ·{' '}
                  {sessionKindLabel(detailsSession)} ·{' '}
                  {formatMinutes(detailsSession.minutes)}
                </Text>
                <Text style={styles.detailStatus}>
                  {statusLabel(
                    actualSessionStatus(detailsSession, runs, strengthSessions),
                  )}
                  {detailsSession.locked ? tr(' · Gesperrt', ' · Locked') : ''}
                </Text>
                <View style={styles.modalActions}>
                  <Button
                    title={
                      detailsSession.date === today
                        ? tr('Einheit starten', 'Start workout')
                        : tr('Heute einplanen', 'Schedule for today')
                    }
                    secondary
                    disabled={
                      working ||
                      detailsSession.status === 'skipped' ||
                      Boolean(detailsSession.activityId)
                    }
                    onPress={() => void startSession(detailsSession)}
                  />
                  <Button
                    title={tr('Einheit bearbeiten', 'Edit workout')}
                    secondary
                    disabled={
                      working ||
                      detailsSession.locked ||
                      detailsSession.date < today
                    }
                    onPress={() =>
                      openEditor(detailsSession, detailsSession.date)
                    }
                  />
                  <Button
                    title={tr('Einheit verschieben', 'Move workout')}
                    secondary
                    disabled={
                      working ||
                      detailsSession.locked ||
                      detailsSession.date < today
                    }
                    onPress={() => openMove(detailsSession)}
                  />
                  <Button
                    title={
                      detailsSession.status === 'skipped'
                        ? tr(
                            'Einheit wieder einplanen',
                            'Schedule workout again',
                          )
                        : tr('Einheit auslassen', 'Skip workout')
                    }
                    secondary
                    disabled={
                      working ||
                      Boolean(detailsSession.activityId) ||
                      detailsSession.locked ||
                      detailsSession.date < today
                    }
                    onPress={() => void skip(detailsSession)}
                  />
                  <Button
                    title={
                      detailsSession.locked
                        ? tr('Einheit entsperren', 'Unlock workout')
                        : tr('Einheit sperren', 'Lock workout')
                    }
                    secondary
                    disabled={working || detailsSession.date < today}
                    onPress={() => void toggleLock(detailsSession)}
                  />
                </View>
              </>
            ) : null}
          </ScrollView>
        </KeyboardAvoidingView>
      </Modal>

      <Modal
        visible={Boolean(moveSessionDraft)}
        transparent
        animationType="slide"
        onRequestClose={() => setMoveId(null)}
      >
        <KeyboardAvoidingView behavior="height" style={styles.modalBackdrop}>
          <ScrollView
            style={styles.modalScroll}
            contentContainerStyle={styles.modalCard}
            keyboardShouldPersistTaps="handled"
          >
            <View style={styles.modalHeader}>
              <Text accessibilityRole="header" style={styles.modalTitle}>
                {tr('Einheit verschieben', 'Move workout')}
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={tr('Verschieben schließen', 'Close move')}
                onPress={() => setMoveId(null)}
                style={styles.closeButton}
              >
                <Text style={styles.closeText}>×</Text>
              </Pressable>
            </View>
            {moveSessionDraft ? (
              <>
                <Copy>{scheduleTitle(moveSessionDraft)}</Copy>
                <View style={styles.periodNavigation}>
                  <Button
                    title="‹"
                    secondary
                    label={tr(
                      'Vorherige Woche zum Verschieben',
                      'Previous week to move to',
                    )}
                    disabled={working}
                    onPress={() =>
                      setMoveWeekStart(current => addDays(current, -7))
                    }
                  />
                  <Text style={styles.periodTitle}>
                    {dateLabel(moveWeekStart)} –{' '}
                    {dateLabel(addDays(moveWeekStart, 6))}
                  </Text>
                  <Button
                    title="›"
                    secondary
                    label={tr(
                      'Nächste Woche zum Verschieben',
                      'Next week to move to',
                    )}
                    disabled={working}
                    onPress={() =>
                      setMoveWeekStart(current => addDays(current, 7))
                    }
                  />
                </View>
                {moveWeekDates.map(date => {
                  const key = isoDate(date);
                  const candidate = proposeMove(
                    displayState,
                    moveSessionDraft.id,
                    key,
                    { today, maxSuggestions: 0 },
                  );
                  const selected = key === moveSessionDraft.date;
                  return (
                    <Pressable
                      key={key}
                      accessibilityRole="button"
                      accessibilityLabel={`${fullDateLabel(date)}${
                        selected ? tr(', aktueller Tag', ', current day') : ''
                      }`}
                      accessibilityState={{
                        disabled: working || selected || !candidate.allowed,
                        selected,
                      }}
                      disabled={working || selected || !candidate.allowed}
                      onPress={() =>
                        void handleMoveChoice(moveSessionDraft, key)
                      }
                      style={({ pressed }) => [
                        styles.moveChoice,
                        selected && styles.moveChoiceSelected,
                        pressed && styles.pressed,
                      ]}
                    >
                      <Text style={styles.moveChoiceText}>
                        {fullDateLabel(date)}
                      </Text>
                      <Text style={styles.moveChoiceMeta}>
                        {selected
                          ? tr('Aktuell', 'Current')
                          : candidate.allowed
                          ? tr('Passt', 'Fits')
                          : tr('Nicht möglich', 'Not possible')}
                      </Text>
                    </Pressable>
                  );
                })}
                {error ? <Notice>{error}</Notice> : null}
                {pending ? (
                  <Button
                    title={tr('Speicherung wiederholen', 'Retry saving')}
                    secondary
                    disabled={saving || Boolean(busy)}
                    onPress={retrySave}
                  />
                ) : null}
                {validation ? <Notice>{validation}</Notice> : null}
              </>
            ) : null}
          </ScrollView>
        </KeyboardAvoidingView>
      </Modal>

      <Modal
        visible={Boolean(editor)}
        transparent
        animationType="slide"
        onRequestClose={() => setEditor(null)}
      >
        <KeyboardAvoidingView behavior="height" style={styles.modalBackdrop}>
          <ScrollView
            style={styles.modalScroll}
            contentContainerStyle={styles.modalCard}
            keyboardShouldPersistTaps="handled"
          >
            <View style={styles.modalHeader}>
              <Text accessibilityRole="header" style={styles.modalTitle}>
                {editor?.id
                  ? tr('Einheit bearbeiten', 'Edit workout')
                  : tr('Einheit hinzufügen', 'Add workout')}
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={tr('Bearbeiten schließen', 'Close editor')}
                onPress={() => setEditor(null)}
                style={styles.closeButton}
              >
                <Text style={styles.closeText}>×</Text>
              </Pressable>
            </View>
            {editor ? (
              <>
                <Field label={tr('Name', 'Name')}>
                  <Input
                    label={tr('Name der Einheit', 'Workout name')}
                    value={editor.title}
                    onChangeText={title =>
                      setEditor(current =>
                        current ? { ...current, title } : current,
                      )
                    }
                    placeholder={tr(
                      'Zum Beispiel Ruhige Runde',
                      'For example, Easy loop',
                    )}
                  />
                </Field>
                <Field label={tr('Dauer in Minuten', 'Duration in minutes')}>
                  <Input
                    label={tr('Dauer in Minuten', 'Duration in minutes')}
                    keyboardType="numeric"
                    value={editor.minutes}
                    onChangeText={minutes =>
                      setEditor(current =>
                        current ? { ...current, minutes } : current,
                      )
                    }
                  />
                </Field>
                <Field label={tr('Art', 'Type')}>
                  <ChipGroup
                    options={
                      showStrength
                        ? kindOptions()
                        : kindOptions().filter(item => item.value === 'run')
                    }
                    value={editor.kind}
                    onChange={kind =>
                      setEditor(current =>
                        current ? { ...current, kind } : current,
                      )
                    }
                    label={tr('Art der Einheit', 'Workout type')}
                  />
                </Field>
                {editor.kind === 'run' ? (
                  <Field label={tr('Laufart', 'Run type')}>
                    <ChipGroup
                      options={purposeOptions()}
                      value={editor.purpose}
                      onChange={purpose =>
                        setEditor(current =>
                          current
                            ? {
                                ...current,
                                purpose,
                                effort:
                                  purpose === 'intervals' || purpose === 'race'
                                    ? 'hard'
                                    : current.effort,
                              }
                            : current,
                        )
                      }
                      label={tr('Laufart', 'Run type')}
                    />
                  </Field>
                ) : (
                  <Field label={tr('Kraftvorlage', 'Strength template')}>
                    {templates.length ? (
                      <ChipGroup
                        options={templates.map(template => ({
                          value: template.id,
                          label: template.name,
                        }))}
                        value={editor.templateId ?? templates[0].id}
                        onChange={templateId =>
                          setEditor(current =>
                            current ? { ...current, templateId } : current,
                          )
                        }
                        label={tr('Kraftvorlage', 'Strength template')}
                      />
                    ) : (
                      <Copy muted>
                        {tr(
                          'Lege zuerst eine Kraftvorlage an.',
                          'Create a strength template first.',
                        )}
                      </Copy>
                    )}
                  </Field>
                )}
                <Field label={tr('Belastung', 'Load')}>
                  <ChipGroup
                    options={effortOptions()}
                    value={editor.effort}
                    onChange={effort =>
                      setEditor(current =>
                        current ? { ...current, effort } : current,
                      )
                    }
                    label={tr('Belastung der Einheit', 'Workout load')}
                  />
                </Field>
                {error ? <Notice>{error}</Notice> : null}
                {pending ? (
                  <Button
                    title={tr('Speicherung wiederholen', 'Retry saving')}
                    secondary
                    disabled={saving || Boolean(busy)}
                    onPress={retrySave}
                  />
                ) : null}
                {validation ? <Notice>{validation}</Notice> : null}
                <View style={styles.modalActions}>
                  <Button
                    title={tr('Speichern', 'Save')}
                    secondary
                    disabled={working}
                    onPress={() => void saveEditor()}
                  />
                  <Button
                    title={tr('Abbrechen', 'Cancel')}
                    secondary
                    disabled={working}
                    onPress={() => setEditor(null)}
                  />
                </View>
              </>
            ) : null}
          </ScrollView>
        </KeyboardAvoidingView>
      </Modal>

      <Modal
        visible={adjusting}
        transparent
        animationType="slide"
        onRequestClose={() => setAdjusting(false)}
      >
        <KeyboardAvoidingView behavior="height" style={styles.modalBackdrop}>
          <ScrollView
            style={styles.modalScroll}
            contentContainerStyle={styles.modalCard}
            keyboardShouldPersistTaps="handled"
          >
            <View style={styles.modalHeader}>
              <Text accessibilityRole="header" style={styles.modalTitle}>
                {tr('Zeitbudget', 'Time budget')}
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={tr(
                  'Zeitbudget schließen',
                  'Close time budget',
                )}
                onPress={() => setAdjusting(false)}
                style={styles.closeButton}
              >
                <Text style={styles.closeText}>×</Text>
              </Pressable>
            </View>
            <Segmented
              options={scopeOptions()}
              value={scope}
              onChange={setScope}
              label={tr('Zeitbudget ändern für', 'Change time budget for')}
            />
            {scope === 'week' ? (
              <>
                <Copy muted>
                  {tr(
                    'Gilt nur für diese Woche.',
                    'Applies to this week only.',
                  )}
                </Copy>
                {weekDateKeys.map((date, index) => (
                  <Field key={date} label={weekdayLong()[index]}>
                    <Input
                      label={tr(
                        `${weekdayLong()[index]} verfügbare Minuten`,
                        `${weekdayLong()[index]} available minutes`,
                      )}
                      keyboardType="numeric"
                      value={availabilityDraft[date] ?? ''}
                      onChangeText={value =>
                        setAvailabilityDraft(current => ({
                          ...current,
                          [date]: value,
                        }))
                      }
                    />
                  </Field>
                ))}
              </>
            ) : (
              <>
                <Field label={tr('Wöchentliche Tage', 'Weekly days')}>
                  <ToggleChips
                    options={weekdayShort().map((label, value) => ({
                      value: String(value),
                      label,
                    }))}
                    values={routineDaysDraft.map(String)}
                    onToggle={value => {
                      const day = Number(value);
                      setRoutineDaysDraft(current =>
                        current.includes(day)
                          ? current.filter(item => item !== day)
                          : [...current, day].sort((a, b) => a - b),
                      );
                    }}
                    label={tr('Wochentage im Rhythmus', 'Weekdays in routine')}
                  />
                </Field>
                <Field
                  label={tr(
                    'Übliches Zeitbudget in Minuten',
                    'Usual time budget in minutes',
                  )}
                >
                  <Input
                    label={tr('Übliche Minuten', 'Usual minutes')}
                    keyboardType="numeric"
                    value={routineMinutesDraft}
                    onChangeText={setRoutineMinutesDraft}
                  />
                </Field>
              </>
            )}
            {error ? <Notice>{error}</Notice> : null}
            {pending ? (
              <Button
                title={tr('Speicherung wiederholen', 'Retry saving')}
                secondary
                disabled={saving || Boolean(busy)}
                onPress={retrySave}
              />
            ) : null}
            {validation ? <Notice>{validation}</Notice> : null}
            <View style={styles.modalActions}>
              <Button
                title={
                  scope === 'week'
                    ? tr('Verfügbarkeit speichern', 'Save availability')
                    : tr('Rhythmus speichern', 'Save routine')
                }
                disabled={working}
                onPress={() => void saveAdjustment()}
              />
              <Button
                title={tr('Abbrechen', 'Cancel')}
                secondary
                disabled={working}
                onPress={() => setAdjusting(false)}
              />
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { gap: space.md },
  periodMeta: { color: color.muted, ...typography.label, textAlign: 'center' },
  monthLink: {
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  monthLinkText: { color: color.green, ...typography.label },
  weekCard: { padding: space.md, gap: space.xs },
  emptyDayRow: {
    minHeight: 48,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  addText: { color: color.green, fontSize: 26, lineHeight: 30 },
  addButton: {
    minWidth: 48,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sessionLocked: { color: color.muted, ...typography.label },
  calendarRow: { flexDirection: 'row', gap: space.xxs },
  modalScroll: { maxHeight: '90%', flexGrow: 0 },
  header: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  actionBlock: { marginTop: space.xs },
  periodNavigation: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.xs,
  },
  navButton: {
    minWidth: 48,
    minHeight: 48,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: color.surface,
  },
  navText: {
    color: color.text,
    fontSize: 32,
    lineHeight: 36,
    fontWeight: '400',
  },
  periodLabel: {
    minHeight: 48,
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  periodTitle: {
    flexShrink: 1,
    textAlign: 'center',
    color: color.text,
    ...typography.body,
    fontWeight: '600',
  },
  stats: { flexDirection: 'row', gap: space.md, paddingVertical: space.sm },
  dayCard: {
    gap: space.xxs,
    paddingVertical: space.xs,
    borderBottomWidth: 1,
    borderBottomColor: color.line,
  },
  dayHeading: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  dayHeadingText: { flex: 1, gap: space.xxs },
  dayTitle: { color: color.text, ...typography.body, fontWeight: '600' },
  dayMeta: { color: color.muted, ...typography.label },
  dayCount: {
    color: color.muted,
    ...typography.value,
    fontVariant: ['tabular-nums'],
  },
  session: {
    minHeight: 64,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingVertical: space.xs,
    borderTopWidth: 1,
    borderTopColor: color.line,
  },
  sessionMain: { flex: 1, gap: space.xxs },
  sessionTitle: { color: color.text, ...typography.body, fontWeight: '600' },
  sessionMeta: { color: color.muted, ...typography.label },
  sessionMark: {
    color: color.green,
    fontSize: 24,
    minWidth: 24,
    textAlign: 'center',
  },
  struck: { textDecorationLine: 'line-through', color: color.muted },
  pressed: { opacity: 0.72 },
  calendarWeekdays: { flexDirection: 'row', gap: space.xxs },
  calendarWeekday: {
    flex: 1,
    textAlign: 'center',
    color: color.muted,
    ...typography.micro,
  },
  calendarGrid: { gap: space.xxs },
  calendarCell: {
    flex: 1,
    minHeight: 56,
    borderRadius: radius.sm,
    backgroundColor: color.surface,
    padding: space.xxs,
    alignItems: 'center',
    gap: space.xxs,
  },
  calendarOutside: { opacity: 0.45 },
  calendarToday: {
    borderWidth: 1,
    borderColor: color.green,
    backgroundColor: color.greenSoft,
  },
  calendarNumber: {
    color: color.text,
    ...typography.label,
    fontVariant: ['tabular-nums'],
  },
  calendarDot: {
    width: space.xs,
    height: space.xs,
    borderRadius: radius.pill,
    backgroundColor: color.green,
  },
  calendarDotSkipped: { backgroundColor: color.muted },
  mutedText: { color: color.muted },
  activityType: { color: color.muted, ...typography.label },
  undoRow: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.sm,
  },
  noticeAction: { marginTop: space.xs },
  modalBackdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(16,18,16,0.72)',
  },
  modalCard: {
    backgroundColor: color.surface,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    padding: space.lg,
    gap: space.md,
  },
  modalHeader: {
    minHeight: 48,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  modalTitle: { color: color.text, ...typography.heading },
  closeButton: {
    minWidth: 48,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeText: { color: color.text, fontSize: 30, lineHeight: 32 },
  detailTitle: { color: color.text, ...typography.title },
  detailMeta: { color: color.muted, ...typography.body },
  detailStatus: { color: color.green, ...typography.label },
  modalActions: { gap: space.sm },
  moveChoice: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: 1,
    borderBottomColor: color.line,
    paddingHorizontal: space.sm,
  },
  moveChoiceSelected: {
    backgroundColor: color.greenSoft,
    borderColor: color.green,
  },
  moveChoiceText: { color: color.text, ...typography.body },
  moveChoiceMeta: { color: color.muted, ...typography.label },
});
