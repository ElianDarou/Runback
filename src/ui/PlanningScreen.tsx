import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import type { Run } from '../native';
import type { StrengthSession, WorkoutTemplate } from '../domain/strength';
import {
  activitiesByDate,
  compareWithUsual,
  dayEntries,
  periodTotals,
  runActivity,
  strengthActivity,
  type DayEntry,
  type MarkState,
  type PlanActivity,
  type UsualTone,
} from '../domain/planView';
import {
  addCalendarDays,
  currentWeekly,
  isChangedDay,
  localDateKey,
  plannedOn,
  resetDay,
  scheduleTitle,
  setDayPlan,
  startOfWeek,
  weeklyFor,
  weekdayOf,
  type DayPlanEntry,
  type PlannedItem,
  type ScheduleState,
} from '../domain/schedule';
import { templateIcon, type TrainingIcon } from '../domain/trainingIcons';
import {
  Button,
  Copy,
  Notice,
  Sheet,
  Title,
  WorkoutIcon,
  color,
  radius,
  space,
  type as typography,
} from './components';
import {
  dateFormat,
  fixed,
  getLanguage,
  numberFormat,
  tr,
} from '../domain/i18n';

export type { ScheduleState } from '../domain/schedule';

export interface PlanningScreenProps {
  state: ScheduleState;
  onSave: (next: ScheduleState) => Promise<void>;
  templates: WorkoutTemplate[];
  runs: Run[];
  strengthSessions: StrengthSession[];
  now: number;
  /** Opens a recorded run or strength session. */
  onOpenActivity?: (kind: 'run' | 'strength', id: string) => void;
  busy?: boolean;
  /** Without the strength area, Plan shows neither sessions nor templates. */
  showStrength?: boolean;
  /** Without the running area, Plan shows neither runs nor planned runs. */
  showRunning?: boolean;
  /** False until the templates are read; their weekly days are unknown then. */
  templatesLoaded?: boolean;
  /**
   * False when the strength sessions did not load: strength training is then
   * unknown, not absent, and nothing is compared.
   */
  strengthHistoryAvailable?: boolean;
}

type ViewMode = 'week' | 'month';

// Labels are built per call: the language can change at runtime.
const weekdayShort = () =>
  getLanguage() === 'en'
    ? ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
    : ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];

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

const dateOf = (key: string): Date => {
  const [year, month, day] = key.split('-').map(Number);
  return new Date(year, month - 1, day);
};

const firstOfMonth = (key: string) => `${key.slice(0, 7)}-01`;

const shiftMonth = (first: string, months: number): string => {
  const date = dateOf(first);
  return localDateKey(
    new Date(date.getFullYear(), date.getMonth() + months, 1),
  );
};

function fullDateLabel(key: string): string {
  return dateFormat({
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(dateOf(key));
}

function shortDateLabel(key: string): string {
  return dateFormat({ day: 'numeric', month: 'short' }).format(dateOf(key));
}

/** The six or five weeks that show a month, Monday first. */
function monthWeeks(first: string): string[][] {
  const start = startOfWeek(first);
  const next = shiftMonth(first, 1);
  const weeks: string[][] = [];
  for (let monday = start; monday < next; monday = addCalendarDays(monday, 7))
    weeks.push(Array.from({ length: 7 }, (_, i) => addCalendarDays(monday, i)));
  return weeks;
}

/** "28:14" or "1:02:05"; unknown stays "–". */
function clock(seconds: number | undefined): string {
  if (seconds === undefined || !Number.isFinite(seconds)) return '–';
  const total = Math.max(0, Math.round(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor(total / 60) % 60;
  const rest = String(total % 60).padStart(2, '0');
  return hours
    ? `${hours}:${String(minutes).padStart(2, '0')}:${rest}`
    : `${minutes}:${rest}`;
}

/** Hours and minutes for period totals: "4:35 h" or "45 min". */
function totalTime(seconds: number | undefined): string {
  if (seconds === undefined) return '–';
  const minutes = Math.round(seconds / 60);
  return minutes < 60
    ? `${minutes} min`
    : `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')} h`;
}

function kilometers(meters: number | undefined): string {
  if (meters === undefined) return '–';
  return `${numberFormat({
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(meters / 1000)} km`;
}

/** What was measured: "5,02 km · 28:14" or "14 Sätze · 46:10". */
function activityMeta(activity: PlanActivity): string {
  const parts: string[] = [];
  if (activity.kind === 'run' && activity.distanceMeters !== undefined)
    parts.push(`${fixed(activity.distanceMeters / 1000, 2)} km`);
  if (activity.kind === 'strength' && activity.sets !== undefined)
    parts.push(
      activity.sets === 1
        ? tr('1 Satz', '1 set')
        : tr(`${activity.sets} Sätze`, `${activity.sets} sets`),
    );
  if (activity.durationSeconds !== undefined)
    parts.push(clock(activity.durationSeconds));
  return parts.join(' · ');
}

const stateLabel = (state: MarkState): string =>
  state === 'done'
    ? tr('erledigt', 'done')
    : state === 'started'
    ? tr('läuft', 'in progress')
    : tr('geplant', 'planned');

const TONE_MARK: Record<UsualTone, string> = {
  more: '▲',
  usual: '',
  less: '▼',
};

const toneWord = (tone: UsualTone): string =>
  tone === 'more'
    ? tr('mehr als üblich', 'more than usual')
    : tone === 'less'
    ? tr('weniger als üblich', 'less than usual')
    : tr('wie üblich', 'as usual');

export function PlanningScreen({
  state,
  onSave,
  templates,
  runs,
  strengthSessions,
  now,
  onOpenActivity,
  busy = false,
  showStrength = true,
  showRunning = true,
  templatesLoaded = true,
  strengthHistoryAvailable = true,
}: PlanningScreenProps) {
  const today = localDateKey(new Date(now));
  const [shown, setShown] = useState<ScheduleState>(state);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [view, setView] = useState<ViewMode>('month');
  const [month, setMonth] = useState(() => firstOfMonth(today));
  const [week, setWeek] = useState(() => startOfWeek(today));
  const [openDay, setOpenDay] = useState<string | null>(null);
  const working = saving || busy;

  // The saved state wins once no own change is on its way.
  useEffect(() => {
    if (!saving) setShown(state);
  }, [saving, state]);

  const language = getLanguage();
  // Each area shows only its own data; a switched-off area leaves no trace.
  const activities = useMemo(
    () => [
      ...(showRunning ? runs.map(runActivity) : []),
      ...(showStrength ? strengthSessions.map(strengthActivity) : []),
    ],
    // Titles depend on the language, so it is part of the memo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [runs, strengthSessions, language, showRunning, showStrength],
  );
  const byDate = useMemo(() => activitiesByDate(activities), [activities]);
  const weekly = useMemo(
    // The whole weekly plan, also of a hidden area: the display filters, but a
    // day edit keeps what the other area had planned.
    () => currentWeekly(shown, templatesLoaded ? templates : undefined),
    [shown, templates, templatesLoaded],
  );
  const templateById = useMemo(
    () => new Map(templates.map(template => [template.id, template])),
    [templates],
  );

  const plannedFor = (date: string): PlannedItem[] =>
    plannedOn(shown, weekly, date, today).filter(item =>
      item.kind === 'run' ? showRunning : showStrength,
    );
  const entriesFor = (date: string): DayEntry[] =>
    dayEntries(plannedFor(date), byDate[date] ?? []);

  const itemTitle = (item: PlannedItem): string => {
    if (item.kind === 'run') return tr('Lauf', 'Run');
    const template = item.templateId
      ? templateById.get(item.templateId)
      : undefined;
    return (
      template?.name ||
      scheduleTitle({ title: item.title ?? '' }) ||
      tr('Krafttraining', 'Strength training')
    );
  };
  const itemIcon = (item: PlannedItem): TrainingIcon =>
    item.kind === 'run'
      ? 'run'
      : templateIcon(
          item.templateId ? templateById.get(item.templateId) : null,
        );
  const activityIcon = (activity: PlanActivity): TrainingIcon =>
    activity.kind === 'run'
      ? activity.sport === 'cycling'
        ? 'bike'
        : 'run'
      : templateIcon(
          activity.templateId ? templateById.get(activity.templateId) : null,
        );
  const entryIcon = (entry: DayEntry): TrainingIcon =>
    entry.type === 'planned'
      ? itemIcon(entry.item)
      : activityIcon(entry.activity);
  const entryTitle = (entry: DayEntry): string =>
    entry.type === 'planned' ? itemTitle(entry.item) : entry.activity.title;
  const entryLabel = (entry: DayEntry) =>
    `${entryTitle(entry)}, ${stateLabel(entry.state)}${
      entry.type === 'unplanned' ? tr(', ohne Plan', ', unplanned') : ''
    }`;

  const save = async (next: ScheduleState) => {
    if (working || next === shown) return;
    const previous = shown;
    setShown(next);
    setSaving(true);
    setError('');
    try {
      await onSave(next);
    } catch (caught) {
      setShown(previous);
      setError(
        caught instanceof Error && caught.message
          ? caught.message
          : tr('Bitte versuche es erneut.', 'Please try again.'),
      );
    } finally {
      setSaving(false);
    }
  };

  // The shown period: its days, first and last day.
  const weeks = useMemo(() => monthWeeks(month), [month]);
  const weekDays = useMemo(
    () => Array.from({ length: 7 }, (_, i) => addCalendarDays(week, i)),
    [week],
  );
  const periodStart = view === 'month' ? month : week;
  const periodEnd =
    view === 'month' ? addCalendarDays(shiftMonth(month, 1), -1) : weekDays[6];
  const containsToday = periodStart <= today && today <= periodEnd;
  const totals = periodTotals(
    activities,
    periodStart,
    containsToday ? today : periodEnd,
  );
  const strengthMissing = showStrength && !strengthHistoryAvailable;
  const usual = strengthMissing
    ? undefined
    : compareWithUsual({
        activities,
        kind: view,
        start: periodStart,
        today,
      });

  const navigate = (amount: number) => {
    if (view === 'month') setMonth(current => shiftMonth(current, amount));
    else setWeek(current => addCalendarDays(current, amount * 7));
  };
  const backToToday = () => {
    setMonth(firstOfMonth(today));
    setWeek(startOfWeek(today));
  };
  const switchView = () => {
    if (view === 'month') {
      // The week of today if it is in the month, else the month's first week.
      setWeek(startOfWeek(month === firstOfMonth(today) ? today : month));
      setView('week');
    } else {
      setMonth(firstOfMonth(week));
      setView('month');
    }
  };
  const periodTitle =
    view === 'month'
      ? `${monthNames()[dateOf(month).getMonth()]} ${dateOf(
          month,
        ).getFullYear()}`
      : `${shortDateLabel(weekDays[0])} – ${shortDateLabel(weekDays[6])}`;

  const renderTotal = (
    value: string,
    label: string,
    tone: UsualTone | undefined,
  ) => (
    <View
      style={styles.total}
      accessible
      accessibilityLabel={`${value} ${label}${
        tone ? `, ${toneWord(tone)}` : ''
      }`}
    >
      <Text
        style={[
          styles.totalValue,
          tone === 'more' && styles.more,
          tone === 'less' && styles.less,
        ]}
      >
        {value}
        {tone && TONE_MARK[tone] ? ` ${TONE_MARK[tone]}` : ''}
      </Text>
      <Text style={styles.totalLabel}>{label}</Text>
    </View>
  );

  const renderTotals = () => {
    if (periodStart > today)
      return (
        <Text style={styles.compareNote}>
          {tr('Noch nichts trainiert.', 'Nothing trained yet.')}
        </Text>
      );
    const unit =
      view === 'month' ? tr('Monate', 'months') : tr('Wochen', 'weeks');
    return (
      <View style={styles.totals}>
        <View style={styles.totalRow}>
          {renderTotal(
            String(totals.workouts),
            totals.workouts === 1
              ? tr('Einheit', 'workout')
              : tr('Einheiten', 'workouts'),
            usual?.workouts,
          )}
          {renderTotal(
            totalTime(totals.seconds),
            totals.timed < totals.workouts
              ? tr(`Zeit von ${totals.timed}`, `time of ${totals.timed}`)
              : tr('Zeit', 'time'),
            usual?.seconds,
          )}
          {showRunning
            ? renderTotal(
                kilometers(totals.runningMeters),
                totals.measuredRuns < totals.runs
                  ? tr(
                      `aus ${totals.measuredRuns} von ${totals.runs} Läufen`,
                      `from ${totals.measuredRuns} of ${totals.runs} runs`,
                    )
                  : tr('gelaufen', 'run'),
                usual?.runningMeters,
              )
            : null}
        </View>
        {strengthMissing ? (
          <Text style={styles.compareNote}>
            {showRunning
              ? tr(
                  'Krafteinheiten sind gerade nicht geladen; die Summen zeigen nur Läufe.',
                  'Strength sessions are not loaded right now; the totals show runs only.',
                )
              : tr(
                  'Krafteinheiten sind gerade nicht geladen.',
                  'Strength sessions are not loaded right now.',
                )}
          </Text>
        ) : usual ? (
          <Text style={styles.compareNote}>
            {usual.partial
              ? tr(
                  `▲ ▼ gegenüber den ersten ${usual.days} Tagen der ${usual.periods} ${unit} davor`,
                  `▲ ▼ against the first ${usual.days} days of the ${usual.periods} ${unit} before`,
                )
              : tr(
                  `▲ ▼ gegenüber den ${usual.periods} ${unit} davor`,
                  `▲ ▼ against the ${usual.periods} ${unit} before`,
                )}
          </Text>
        ) : null}
      </View>
    );
  };

  const dayLabel = (date: string, entries: DayEntry[]) =>
    [
      fullDateLabel(date),
      date === today ? tr('heute', 'today') : '',
      ...entries.map(entryLabel),
    ]
      .filter(Boolean)
      .join(', ');

  const renderCell = (date: string) => {
    const entries = entriesFor(date);
    const outside = date.slice(0, 7) !== month.slice(0, 7);
    const isToday = date === today;
    const shownEntries = entries.slice(0, entries.length > 4 ? 3 : 4);
    return (
      <Pressable
        key={date}
        accessibilityRole="button"
        accessibilityLabel={dayLabel(date, entries)}
        onPress={() => setOpenDay(date)}
        style={({ pressed }) => [
          styles.cell,
          outside && styles.cellOutside,
          isToday && styles.cellToday,
          pressed && styles.pressed,
        ]}
      >
        <Text
          style={[
            styles.cellNumber,
            (outside || date < today) && styles.mutedText,
            isToday && styles.todayText,
          ]}
        >
          {dateOf(date).getDate()}
        </Text>
        <View style={styles.cellIcons}>
          {shownEntries.map((entry, index) => (
            <WorkoutIcon
              key={index}
              name={entryIcon(entry)}
              state={entry.state}
              size="small"
            />
          ))}
          {entries.length > shownEntries.length ? (
            <Text style={styles.moreCount}>
              +{entries.length - shownEntries.length}
            </Text>
          ) : null}
        </View>
      </Pressable>
    );
  };

  const renderWeekDay = (date: string, index: number) => {
    const entries = entriesFor(date);
    const isToday = date === today;
    return (
      <Pressable
        key={date}
        accessibilityRole="button"
        accessibilityLabel={dayLabel(date, entries)}
        onPress={() => setOpenDay(date)}
        style={({ pressed }) => [
          styles.weekRow,
          index > 0 && styles.weekDivider,
          pressed && styles.pressed,
        ]}
      >
        <View style={styles.weekDate}>
          <Text style={[styles.weekWeekday, isToday && styles.todayText]}>
            {weekdayShort()[index]}
          </Text>
          <Text
            style={[
              styles.weekNumber,
              date < today && styles.mutedText,
              isToday && styles.todayText,
            ]}
          >
            {dateOf(date).getDate()}
          </Text>
        </View>
        <View style={styles.weekEntries}>
          {entries.map((entry, entryIndex) => (
            <View key={entryIndex} style={styles.weekEntry}>
              <WorkoutIcon name={entryIcon(entry)} state={entry.state} />
              <Text
                numberOfLines={1}
                style={[
                  styles.weekEntryText,
                  entry.state === 'planned' && styles.mutedText,
                ]}
              >
                {entryTitle(entry)}
              </Text>
            </View>
          ))}
        </View>
      </Pressable>
    );
  };

  const renderDaySheet = () => {
    if (!openDay) return null;
    const date = openDay;
    const planned = plannedFor(date);
    // Same item objects as `planned`, so a row finds its index for removal.
    const entries = dayEntries(planned, byDate[date] ?? []);
    const editable = date >= today;
    const changed = isChangedDay(shown, date);
    const weeklyDay = weeklyFor(shown, weekly, date, today);
    const hasWeekly =
      Boolean(weeklyDay) &&
      (weeklyDay!.run.includes(weekdayOf(date)) ||
        weeklyDay!.strength.some(entry =>
          entry.days.includes(weekdayOf(date)),
        ));
    const asEntries = (items: PlannedItem[]): DayPlanEntry[] =>
      items.map(item => ({
        kind: item.kind,
        templateId: item.templateId,
        title: itemTitle(item),
        purpose: item.purpose,
      }));
    // Planned items of the other area stay as they are.
    const hidden = plannedOn(shown, weekly, date, today).filter(
      item => !(item.kind === 'run' ? showRunning : showStrength),
    );
    const setPlan = (items: DayPlanEntry[]) =>
      void save(
        setDayPlan(shown, date, [...asEntries(hidden), ...items], today),
      );
    const remove = (index: number) =>
      setPlan(asEntries(planned.filter((_, i) => i !== index)));
    const add = (entry: DayPlanEntry) =>
      setPlan([...asEntries(planned), entry]);
    const options: {
      key: string;
      label: string;
      icon: TrainingIcon;
      entry: DayPlanEntry;
    }[] = [
      ...(showRunning
        ? [
            {
              key: 'run',
              label: tr('Lauf', 'Run'),
              icon: 'run' as const,
              entry: { kind: 'run' as const },
            },
          ]
        : []),
      ...(showStrength
        ? templates.length
          ? templates.map(template => ({
              key: template.id,
              label: template.name,
              icon: templateIcon(template),
              entry: {
                kind: 'strength' as const,
                templateId: template.id,
                title: template.name,
              },
            }))
          : [
              {
                key: 'strength',
                label: tr('Krafttraining', 'Strength training'),
                icon: templateIcon(null),
                entry: { kind: 'strength' as const },
              },
            ]
        : []),
    ];
    return (
      <Sheet
        visible
        title={`${fullDateLabel(date)}${
          date === today ? tr(' · heute', ' · today') : ''
        }`}
        onClose={() => setOpenDay(null)}
      >
        {entries.length ? (
          entries.map((entry, index) => {
            const activity = entry.activity;
            const plannedIndex =
              entry.type === 'planned' ? planned.indexOf(entry.item) : -1;
            const meta = [
              entry.type === 'unplanned'
                ? tr('ohne Plan', 'unplanned')
                : stateLabel(entry.state),
              activity ? activityMeta(activity) : '',
            ]
              .filter(Boolean)
              .join(' · ');
            const open =
              activity && onOpenActivity
                ? () => {
                    setOpenDay(null);
                    onOpenActivity(activity.kind, activity.id);
                  }
                : undefined;
            return (
              <View key={index} style={styles.sheetRow}>
                <Pressable
                  accessibilityRole={open ? 'button' : undefined}
                  accessibilityLabel={
                    open
                      ? tr(
                          `${activity!.title} ansehen`,
                          `View ${activity!.title}`,
                        )
                      : entryLabel(entry)
                  }
                  disabled={!open}
                  onPress={open}
                  style={({ pressed }) => [
                    styles.sheetEntry,
                    pressed && styles.pressed,
                  ]}
                >
                  <WorkoutIcon name={entryIcon(entry)} state={entry.state} />
                  <View style={styles.sheetText}>
                    <Text numberOfLines={1} style={styles.sheetTitle}>
                      {entryTitle(entry)}
                    </Text>
                    <Text style={styles.sheetMeta}>{meta}</Text>
                  </View>
                  {open ? <Text style={styles.chevron}>›</Text> : null}
                </Pressable>
                {editable && plannedIndex >= 0 ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={tr(
                      `${entryTitle(entry)} an diesem Tag nicht planen`,
                      `Unplan ${entryTitle(entry)} on this day`,
                    )}
                    accessibilityState={{ disabled: working }}
                    disabled={working}
                    onPress={() => remove(plannedIndex)}
                    style={({ pressed }) => [
                      styles.remove,
                      pressed && styles.pressed,
                    ]}
                  >
                    <Text style={styles.removeText}>×</Text>
                  </Pressable>
                ) : null}
              </View>
            );
          })
        ) : (
          <Copy muted>
            {editable
              ? tr('Nichts geplant.', 'Nothing planned.')
              : strengthMissing && showRunning
              ? tr(
                  'Kein Lauf; Krafteinheiten sind nicht geladen.',
                  'No run; strength sessions are not loaded.',
                )
              : strengthMissing
              ? tr(
                  'Krafteinheiten sind nicht geladen.',
                  'Strength sessions are not loaded.',
                )
              : tr('Kein Training.', 'No workout.')}
          </Copy>
        )}
        {editable && options.length ? (
          <>
            <Text style={styles.sheetSection}>
              {tr('An diesem Tag planen', 'Plan on this day')}
            </Text>
            <View style={styles.options}>
              {options.map(option => (
                <Pressable
                  key={option.key}
                  accessibilityRole="button"
                  accessibilityLabel={tr(
                    `${option.label} planen`,
                    `Plan ${option.label}`,
                  )}
                  accessibilityState={{ disabled: working }}
                  disabled={working}
                  onPress={() => add(option.entry)}
                  style={({ pressed }) => [
                    styles.option,
                    working && styles.disabled,
                    pressed && styles.pressed,
                  ]}
                >
                  <WorkoutIcon name={option.icon} size="small" />
                  <Text numberOfLines={1} style={styles.optionText}>
                    {option.label}
                  </Text>
                </Pressable>
              ))}
            </View>
            {changed && hasWeekly ? (
              <Button
                secondary
                small
                title={tr('Wie jede Woche', 'As every week')}
                label={tr(
                  'Wochenplan für diesen Tag wiederherstellen',
                  'Restore the weekly plan for this day',
                )}
                disabled={working}
                onPress={() => void save(resetDay(shown, date, today))}
              />
            ) : null}
            {!changed && hasWeekly ? (
              <Copy muted>
                {tr(
                  'Eine Änderung gilt nur für diesen Tag.',
                  'A change applies to this day only.',
                )}
              </Copy>
            ) : null}
          </>
        ) : null}
        <Button title={tr('Fertig', 'Done')} onPress={() => setOpenDay(null)} />
      </Sheet>
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
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={
            view === 'month'
              ? tr('Wochenansicht zeigen', 'Show week view')
              : tr('Monatsansicht zeigen', 'Show month view')
          }
          onPress={switchView}
          style={({ pressed }) => [
            styles.viewSwitch,
            pressed && styles.pressed,
          ]}
        >
          <Text style={styles.viewSwitchText}>
            {view === 'month' ? tr('Woche', 'Week') : tr('Monat', 'Month')}
          </Text>
        </Pressable>
      </View>

      {error ? (
        <Notice
          title={tr('Nicht gespeichert', 'Not saved')}
          onDismiss={() => setError('')}
        >
          {error}
        </Notice>
      ) : null}

      <View style={styles.navigation}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={
            view === 'month'
              ? tr('Vorheriger Monat', 'Previous month')
              : tr('Vorherige Woche', 'Previous week')
          }
          onPress={() => navigate(-1)}
          style={({ pressed }) => [styles.navButton, pressed && styles.pressed]}
        >
          <Text style={styles.navText}>‹</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={
            containsToday
              ? periodTitle
              : tr(
                  `${periodTitle}, zurück zu heute`,
                  `${periodTitle}, back to today`,
                )
          }
          disabled={containsToday}
          onPress={backToToday}
          style={styles.periodLabel}
        >
          <Text style={styles.periodTitle}>{periodTitle}</Text>
          {containsToday ? null : (
            <Text style={styles.periodLink}>
              {tr('Zurück zu heute', 'Back to today')}
            </Text>
          )}
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={
            view === 'month'
              ? tr('Nächster Monat', 'Next month')
              : tr('Nächste Woche', 'Next week')
          }
          onPress={() => navigate(1)}
          style={({ pressed }) => [styles.navButton, pressed && styles.pressed]}
        >
          <Text style={styles.navText}>›</Text>
        </Pressable>
      </View>

      {renderTotals()}

      {view === 'month' ? (
        <View style={styles.calendar}>
          <View style={styles.weekdays}>
            {weekdayShort().map(day => (
              <Text key={day} style={styles.weekday}>
                {day}
              </Text>
            ))}
          </View>
          {weeks.map(days => (
            <View key={days[0]} style={styles.calendarRow}>
              {days.map(renderCell)}
            </View>
          ))}
        </View>
      ) : (
        <View style={styles.calendar}>{weekDays.map(renderWeekDay)}</View>
      )}

      <View style={styles.legend} accessible={false}>
        <View style={styles.legendItem}>
          <WorkoutIcon name="run" state="planned" size="small" />
          <Text style={styles.legendText}>{tr('Geplant', 'Planned')}</Text>
        </View>
        <View style={styles.legendItem}>
          <WorkoutIcon name="run" state="done" size="small" />
          <Text style={styles.legendText}>{tr('Erledigt', 'Done')}</Text>
        </View>
        <Text style={styles.legendText}>
          {tr('Tippe auf einen Tag zum Planen.', 'Tap a day to plan it.')}
        </Text>
      </View>

      {renderDaySheet()}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, gap: space.xs },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.sm,
  },
  viewSwitch: {
    minHeight: 48,
    minWidth: 48,
    paddingHorizontal: space.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  viewSwitchText: { color: color.green, ...typography.label },
  navigation: { flexDirection: 'row', alignItems: 'center' },
  navButton: {
    width: 48,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  navText: { color: color.text, fontSize: 28, lineHeight: 32 },
  periodLabel: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  periodTitle: { color: color.text, ...typography.heading },
  periodLink: { color: color.green, ...typography.micro },
  totals: { gap: space.xxs },
  totalRow: { flexDirection: 'row', gap: space.sm },
  total: { flex: 1 },
  totalValue: {
    color: color.text,
    ...typography.label,
    fontVariant: ['tabular-nums'],
  },
  totalLabel: { color: color.muted, ...typography.micro },
  more: { color: color.green },
  moreCount: { color: color.muted, ...typography.micro },
  less: { color: color.danger },
  compareNote: { color: color.muted, ...typography.micro },
  calendar: {
    flex: 1,
    borderRadius: radius.md,
    backgroundColor: color.surface,
    overflow: 'hidden',
  },
  weekdays: { flexDirection: 'row', paddingVertical: space.xxs },
  weekday: {
    flex: 1,
    textAlign: 'center',
    color: color.muted,
    ...typography.micro,
  },
  calendarRow: {
    flex: 1,
    flexDirection: 'row',
    borderTopWidth: 1,
    borderTopColor: color.line,
  },
  cell: {
    flex: 1,
    // Narrow sides so two symbols fit per row on a 360 dp phone.
    paddingVertical: space.xxs,
    paddingHorizontal: 1,
    gap: 2,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'transparent',
    // Many workouts on one day must not spill into the next week.
    overflow: 'hidden',
  },
  cellOutside: { opacity: 0.45 },
  cellToday: { borderColor: color.green, borderRadius: radius.sm },
  cellNumber: {
    color: color.text,
    ...typography.micro,
    fontVariant: ['tabular-nums'],
  },
  cellIcons: {
    alignSelf: 'stretch',
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 2,
  },
  weekRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: space.sm,
    gap: space.sm,
  },
  weekDivider: { borderTopWidth: 1, borderTopColor: color.line },
  weekDate: { width: 36, alignItems: 'center' },
  weekWeekday: { color: color.muted, ...typography.micro },
  weekNumber: {
    color: color.text,
    ...typography.label,
    fontVariant: ['tabular-nums'],
  },
  weekEntries: {
    flex: 1,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space.xs,
  },
  weekEntry: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xxs,
    maxWidth: '100%',
  },
  weekEntryText: { color: color.text, ...typography.label, flexShrink: 1 },
  mutedText: { color: color.muted },
  todayText: { color: color.green },
  legend: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: space.sm,
  },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: space.xxs },
  legendText: { color: color.muted, ...typography.micro },
  sheetRow: { flexDirection: 'row', alignItems: 'center' },
  sheetEntry: {
    flex: 1,
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
  },
  sheetText: { flex: 1 },
  sheetTitle: { color: color.text, ...typography.body },
  sheetMeta: { color: color.muted, ...typography.label, fontWeight: '400' },
  chevron: { color: color.muted, fontSize: 22 },
  remove: {
    width: 48,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  removeText: { color: color.muted, fontSize: 24 },
  sheetSection: {
    color: color.muted,
    ...typography.label,
    marginTop: space.sm,
  },
  options: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs },
  option: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    paddingHorizontal: space.sm,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: color.line,
    maxWidth: '100%',
  },
  optionText: { color: color.text, ...typography.label, flexShrink: 1 },
  disabled: { opacity: 0.5 },
  pressed: { opacity: 0.7 },
});
