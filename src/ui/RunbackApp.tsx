import { ServerSettings } from './ServerSettings';
import { ConnectionMark } from './components';
import { serverMark, serverStateLabel, type ServerLinkStatus } from '../domain/serverLink';
import { exerciseDisplayName, nativeDisplayNames } from '../domain/catalog';
import React, {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  ActivityIndicator,
  Alert,
  AppState as AndroidAppState,
  BackHandler,
  FlatList,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  dateFormat,
  fixed,
  getLanguage,
  isLanguage,
  numberFormat,
  parseDecimal,
  percentSign,
  setLanguage,
  tr,
  type Language,
} from '../domain/i18n';
import { deviceLanguage } from './deviceLanguage';
import { FocusEditor } from './FocusEditor';
import { focusLabel } from '../domain/focus';
import { selectRecommendations } from '../domain/recommendationSelection';
import { selectStrengthRecommendation } from '../domain/strengthRecommendation';
import {
  activeExperimentFor,
  areaLabel,
  isRunRecommendation,
  isStrengthRecommendation,
  recommendationArea,
} from '../domain/areas';
import { Onboarding } from './Onboarding';
import { Statistics, readStatisticsView } from './Statistics';
import type { StatsRecord } from '../domain/statisticsView';
import type { StrengthRecord } from '../domain/strengthStatistics';
import type {
  StrengthHeart,
  StrengthHeartSummary,
} from '../domain/strengthHeart';
import {
  strengthWatchLive,
  strengthWatchTransfer,
  type StrengthWatchInfo,
} from '../domain/wearLink';
import { StrengthSessionDetail } from './StrengthSessionDetail';
import { ExerciseDetail } from './ExerciseDetail';
import { PlanningScreen } from './PlanningScreen';
import { DevelopmentScreen } from './DevelopmentScreen';
import { GoalProgress } from './GoalProgress';
import {
  formatGoalTime,
  parseGoalDistanceKm,
  parseGoalTime,
  predictRace,
} from '../domain/raceGoal';
import {
  addCalendarDays,
  localDateKey,
  normalizeSchedule,
  scheduleTitle,
  startOfWeek,
  type ScheduledSession,
  type ScheduleState,
} from '../domain/schedule';
import {
  googleMapsDirectionsUrl,
  type RouteCoordinate,
} from '../domain/routes';

import { runExportRange } from './runExportRange';
import { dateToInput, inputToDate } from './dateInput';
import { TrainingChat } from './TrainingChat';
import { DeviceSettings } from './DeviceSettings';
import { WearRecordingRow } from './WearRecordingRow';
import { VendorImport } from './VendorImport';
import { ImportReview } from './ImportReview';
import { ImportHistory } from './ImportHistory';
import { RunEndSheet, StrengthEndSheet } from './EndEditSheets';
import {
  readImportPreview,
  type ImportBatch,
  type ImportChoice,
} from '../domain/importReview';
import { ImportedTemplates } from './ImportedTemplates';
import { acceptImportedTemplate } from '../domain/strengthImports';
import { WorkoutScreen } from './WorkoutScreen';
import { ExercisePicker } from './ExercisePicker';
import { PlanEditor } from './PlanEditor';
import { PlanList } from './PlanList';
import { BodyMap, type BodyMapMode } from './BodyMap';
import { SorenessCapture } from './SorenessCapture';
import { RunTargetScreen } from './RunTargetScreen';
import { DistanceTimes } from './DistanceTimes';
import { distanceTime } from '../domain/distanceTimes';
import {
  createTemplate,
  deleteTemplate,
  duplicateTemplate,
  upsertTemplate,
} from '../domain/plans';
import {
  addExercise,
  addSet,
  clearRest,
  confirmSet,
  pauseRest,
  removeSet as removeStrengthSet,
  revise as reviseSession,
  restoreSet as restoreStrengthSet,
  resumeRest,
  editSet as editStrengthSet,
  isSetCompleted,
  emptyStrengthState,
  finishSession,
  displaySessionName,
  selectExercise,
  summarize,
  startSession,
  templateForDay,
  type Exercise,
  type StrengthSession,
  type StrengthState,
  type WorkoutTemplate,
} from '../domain/strength';
import { RunIntegrations } from './RunIntegrations';
import { KilometerTable, RunSeriesPanel } from './RunCharts';
import { RunInsights, toneFor } from './RunInsights';
import { maxHeartRate, recentComparison } from '../domain/insights';
import {
  purposeHintProvenance,
  purposeHintReason,
  suggestRunPurpose,
} from '../domain/purposeHint';
import {
  compassLabel,
  kilometerSplits,
  nearestByPosition,
  nearestIndex,
  splitRange,
  type RunSeries,
} from '../domain/runSeries';
import { ProseSettings, ProseExplanation } from './ProseSettings';
import {
  acceptRecommendation,
  analyzeRun,
  allRegionIds,
  evaluateAnyExperiment,
  evaluateExperiment,
  transitionExperiment,
} from '../domain';
import type {
  AnyRecommendation,
  Experiment,
  ExperimentEvaluation,
  ExperimentStatus,
  Recommendation,
  RunAnalysis,
  RunPurpose,
  Sport,
  StrengthRecommendation,
} from '../domain/types';
import {
  SPORTS,
  isRun,
  normalizeSport,
  sportNoun,
  sportWords,
  speedKmh,
  usesPace,
} from '../domain/sport';
import type { SorenessReport as CapturedSorenessReport } from '../domain/sorenessInput';
import type { RegionId } from '../domain/regions';
import {
  NO_RUN_TARGET,
  RUN_TARGET_VERSION,
  type RunTarget,
  normalizeRunTarget,
  PACE_STEP_SECONDS,
  runTargetLabel,
  stepTargetPace,
  targetForPurpose,
} from '../domain/runTarget';
import {
  native,
  nativeCall,
  normalizeRun,
  type AppState,
  type Preset,
  type Run,
  type Settings,
} from '../native';
import { FeatureSettings } from './FeatureSettings';
import { RoutePlannerScreen } from './RoutePlannerScreen';
import { PHONE_PLACEMENTS, normalizePlacement } from '../domain/gait';
import {
  FEATURE_CATALOG,
  featureEnabled,
  availableTabs,
  type Tab,
  type FeatureId,
  enabledSports,
  normalizeFeatures,
  recommendationsShown,
  recommendationsSuggested,
  shouldPromptSoreness,
  visibleHomeSections,
  visibleTabs,
  tabLabel,
  type FeatureSettings as Features,
} from '../domain/features';
import {
  Badge,
  Button,
  Card,
  ChipGroup,
  Copy,
  Disclosure,
  EmptyState,
  Field,
  Icon,
  Input,
  Notice,
  Progress,
  Route,
  RouteOpenActions,
  Row,
  Section,
  Segmented,
  Sheet,
  Stat,
  Stepper,
  Title,
  color,
  radius,
  space,
  type,
} from './components';
import {
  RUN_PURPOSES,
  hasNamedPurpose,
  purposeLabel,
  runTitle,
  selectablePurpose,
} from '../domain/runTitle';
import {
  buildRunAnalysisExport,
  buildRunReport,
  runExportFileNames,
  type RunTimeline,
} from '../domain/runReport';
import {
  isRecordedStrengthSession,
  STRENGTH_EXPORT_FILES,
  strengthExportChunk,
  strengthExportHeaders,
  strengthExportReadme,
} from '../domain/strengthExport';

const purposes = RUN_PURPOSES;
const number = (value: number, digits = 1) =>
  Number.isFinite(value) ? fixed(value, digits) : '–';
/** Plain number for input fields: decimal comma in German, point in English. */
const plainNumber = (value: number) =>
  numberFormat({ useGrouping: false, maximumFractionDigits: 20 }).format(value);
const distance = (run: Run) => number(run.distanceMeters / 1000, 2);
const duration = (seconds: number) => {
  const s = Math.max(0, Math.floor(seconds));
  return s >= 3600
    ? `${Math.floor(s / 3600)}:${String(Math.floor(s / 60) % 60).padStart(
        2,
        '0',
      )}:${String(s % 60).padStart(2, '0')}`
    : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};
const pace = (run: Run) =>
  run.distanceMeters >= 20
    ? duration(run.durationSeconds / (run.distanceMeters / 1000))
    : '–:––';
const speed = (run: Run) => {
  const kmh = speedKmh(run);
  return kmh === null ? '–' : number(kmh, 1);
};
/** Pace per sport: runs in min/km, rides in km/h. */
const tempoValue = (run: Run) => (usesPace(run.sport) ? pace(run) : speed(run));
const tempoUnit = (run: Run) => (usesPace(run.sport) ? '/km' : 'km/h');
const tempoLabel = (run: Run) =>
  usesPace(run.sport)
    ? tr('Ø min / km', 'Avg pace')
    : tr('Ø km/h', 'Avg km/h');
const date = (timestamp: number) =>
  dateFormat({
    weekday: 'short',
    day: 'numeric',
    month: 'long',
  }).format(new Date(timestamp));
/** Shorter form for list rows that are already grouped by week. */
const listDate = (timestamp: number) =>
  dateFormat({
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  }).format(new Date(timestamp));
const DAY = 24 * 3600 * 1000;
const initial: AppState = {
  runs: [],
  recording: null,
  settings: {},
  capabilities: {},
};
type Page =
  | 'main'
  | 'focus-running'
  | 'focus-strength'
  | 'goal'
  | 'session'
  | 'exercise'
  | 'record-runs'
  | 'record-sessions'
  | 'templates'
  | 'muscle-map'
  | 'server'
  | 'settings'
  | 'devices'
  | 'data'
  | 'vendor-import'
  | 'imports'
  | 'models'
  | 'development'
  | 'chat'
  | 'distance-times'
  | 'run-audio'
  | 'run-target'
  | 'features'
  | 'features-home'
  | 'features-navigation'
  | 'features-detail'
  | 'all-functions'
  | 'goals';
/** Where "‹ Back" leads from a page. A missing entry goes to the main page. */
/** Pages opened from a strength session, exercise, or statistics;
 *  "Back" follows `trail` to where the user came from. */
const DEPTH_PAGES: Page[] = ['session', 'exercise', 'record-sessions'];
interface Trail {
  page: Page;
  session: StrengthSession | null;
  exercise: string | null;
  record: StrengthRecord | null;
}
const PARENT_PAGE: Partial<Record<Page, Page>> = {
  devices: 'settings',
  server: 'settings',
  'run-audio': 'settings',
  data: 'settings',
  models: 'settings',
  features: 'settings',
  'features-home': 'features',
  'features-navigation': 'features',
  'features-detail': 'features',
  'all-functions': 'settings',
  goal: 'goals',
  'focus-running': 'goals',
  'focus-strength': 'goals',
  'vendor-import': 'data',
  imports: 'data',
};
type HistoryView = 'units' | 'stats';
/** How often a change is retried on a newer state from the watch or a notification. */
const MAX_SAVE_RETRIES = 3;
type StartKind = 'run' | 'strength';
type TemplatesView = 'strength' | 'run';
const historyViewOptions = (): { value: HistoryView; label: string }[] => [
  { value: 'units', label: tr('Einheiten', 'Workouts') },
  { value: 'stats', label: tr('Statistik', 'Statistics') },
];
const startKindOptions = (): {
  value: 'running' | 'cycling' | 'strength';
  label: string;
}[] => [
  { value: 'running', label: tr('Laufen', 'Running') },
  { value: 'cycling', label: tr('Radfahren', 'Cycling') },
  { value: 'strength', label: tr('Krafttraining', 'Strength') },
];
const weekdayShortLabels = (): string[] =>
  getLanguage() === 'en'
    ? ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
    : ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];

/**
 * A recorded unit is a run or a strength session. Both sit in the same list
 * because they answer the same question: what did I train? They are never
 * added together — kilometers and sets are not a shared unit.
 */
type Unit =
  | { kind: 'run'; key: string; at: number; run: Run }
  | { kind: 'strength'; key: string; at: number; session: StrengthSession };
type UnitFilter = 'all' | 'runs' | 'cycling' | 'strength';

const unitFilterOptions = (): { value: UnitFilter; label: string }[] => [
  { value: 'all', label: tr('Alle', 'All') },
  { value: 'runs', label: tr('Laufen', 'Running') },
  { value: 'cycling', label: tr('Radfahren', 'Cycling') },
  { value: 'strength', label: tr('Krafttraining', 'Strength training') },
];
const unitMatches = (unit: Unit, filter: UnitFilter) =>
  filter === 'all'
    ? true
    : filter === 'strength'
    ? unit.kind === 'strength'
    : unit.kind === 'run' &&
      (filter === 'runs' ? isRun(unit.run) : !isRun(unit.run));
/** No purpose at all — "Just run" is an answer, "Not set yet" is not. */
const purposeMissing = (run: Run) => !run.purpose || run.purpose === 'unknown';
/** Count with number: "1 run", "3 rides". */
const counted = (count: number, singular: string, plural: string) =>
  `${count} ${count === 1 ? singular : plural}`;
/** Recorded duration of a strength session. Without an end time it stays 0. */
const sessionSeconds = (session: StrengthSession) => {
  const end = session.endTime ?? session.startTime;
  return Math.max(0, Math.round((end - session.startTime) / 1000));
};
const unitKindLabel = (unit: Unit) =>
  unit.kind === 'run'
    ? sportNoun(unit.run.sport)
    : tr('Krafttraining', 'Strength training');
const unitTitle = (unit: Unit) =>
  unit.kind === 'run'
    ? runTitle(unit.run)
    : displaySessionName(unit.session.name) ||
      tr('Krafttraining', 'Strength training');
/** Short form for list rows outside the workouts list. */
const unitSummary = (unit: Unit) => {
  if (unit.kind === 'run') {
    return `${date(unit.at)} · ${distance(unit.run)} km · ${tempoValue(
      unit.run,
    )} ${tempoUnit(unit.run)}`;
  }
  const sets = summarize(unit.session).completedSets;
  return `${date(unit.at)} · ${sets} ${sets === 1 ? tr('Satz', 'set') : tr('Sätze', 'sets')}`;
};

/**
 * The workouts list is grouped by week. The week header carries the total,
 * so the volume is visible without switching to statistics.
 */
type UnitListItem =
  | { type: 'unit'; key: string; unit: Unit }
  | { type: 'week'; key: string; label: string; summary: string };
const clockFormat = (timestamp: Date) =>
  dateFormat({
    hour: '2-digit',
    minute: '2-digit',
  }).format(timestamp);
const shortDate = (timestamp: Date) =>
  dateFormat({
    day: 'numeric',
    month: 'short',
  }).format(timestamp);
const weekLabel = (weekStart: string, today: string) => {
  const thisWeek = startOfWeek(today);
  if (weekStart === thisWeek) {
    return tr('Diese Woche', 'This week');
  }
  if (weekStart === startOfWeek(addCalendarDays(thisWeek, -7))) {
    return tr('Letzte Woche', 'Last week');
  }
  const start = new Date(`${weekStart}T12:00:00`);
  const end = new Date(`${addCalendarDays(weekStart, 6)}T12:00:00`);
  // Within one month the month appears once: "14.–20. Sept." / "14–20 Sept"
  return start.getMonth() === end.getMonth()
    ? `${start.getDate()}${tr('.', '')}–${shortDate(end)}`
    : `${shortDate(start)} – ${shortDate(end)}`;
};
const weekSummary = (units: Unit[]) => {
  const runs = units.filter(unit => unit.kind === 'run');
  const km = runs.reduce(
    (sum, unit) =>
      sum +
      (unit.kind === 'run' && isRun(unit.run) ? unit.run.distanceMeters : 0),
    0,
  );
  const seconds = units.reduce(
    (sum, unit) =>
      sum +
      (unit.kind === 'run'
        ? unit.run.durationSeconds
        : sessionSeconds(unit.session)),
    0,
  );
  const parts = [
    counted(units.length, tr('Einheit', 'workout'), tr('Einheiten', 'workouts')),
  ];
  if (km > 0) {
    parts.push(`${number(km / 1000, 1)} km`);
  }
  if (seconds > 0) {
    parts.push(duration(seconds));
  }
  return parts.join(' · ');
};
const groupUnitsByWeek = (units: Unit[], today: string): UnitListItem[] => {
  const items: UnitListItem[] = [];
  let currentWeek = '';
  let bucket: Unit[] = [];
  const flush = () => {
    if (!bucket.length) {
      return;
    }
    items.push({
      type: 'week',
      key: `week-${currentWeek}`,
      label: weekLabel(currentWeek, today),
      summary: weekSummary(bucket),
    });
    bucket.forEach(unit => items.push({ type: 'unit', key: unit.key, unit }));
    bucket = [];
  };
  units.forEach(unit => {
    const week = startOfWeek(unit.at);
    if (week !== currentWeek) {
      flush();
      currentWeek = week;
    }
    bucket.push(unit);
  });
  flush();
  return items;
};

const UnitRow = memo(function UnitRow({
  unit,
  open,
  onLongPress,
  checked,
  disabled = false,
}: {
  unit: Unit;
  open: (unit: Unit) => void;
  onLongPress?: () => void;
  checked?: boolean;
  disabled?: boolean;
}) {
  const title = unitTitle(unit);
  const kind = unitKindLabel(unit);
  const summary = unit.kind === 'strength' ? summarize(unit.session) : null;
  const value =
    unit.kind === 'run' ? distance(unit.run) : String(summary!.completedSets);
  const valueUnit =
    unit.kind === 'run'
      ? 'km'
      : summary!.completedSets === 1
      ? tr('Satz', 'set')
      : tr('Sätze', 'sets');
  const note =
    unit.kind === 'run'
      ? hasNamedPurpose(unit.run.purpose) &&
        purposeLabel(unit.run.purpose) !== title
        ? ` · ${purposeLabel(unit.run.purpose)}`
        : ''
      : '';
  const detail =
    unit.kind === 'run'
      ? `${duration(unit.run.durationSeconds)} · ${tempoValue(
          unit.run,
        )} ${tempoUnit(unit.run)}`
      : summary!.volumeKg > 0
      ? `${duration(sessionSeconds(unit.session))} · ${numberFormat({
          maximumFractionDigits: 0,
        }).format(summary!.volumeKg)} kg`
      : duration(sessionSeconds(unit.session));
  return (
    <Pressable
      accessibilityRole={checked === undefined ? 'button' : 'checkbox'}
      accessibilityState={{ checked, disabled }}
      disabled={disabled}
      onLongPress={onLongPress}
      accessibilityHint={
        onLongPress
          ? tr(
              'Halte gedrückt, um Läufe zum Export auszuwählen.',
              'Press and hold to select runs for export.',
            )
          : undefined
      }
      accessibilityLabel={`${kind}: ${title}, ${date(
        unit.at,
      )}, ${value} ${valueUnit}`}
      onPress={() => open(unit)}
      style={({ pressed }) => [styles.runRow, pressed && styles.pressed]}
    >
      <View style={styles.runTop}>
        <Text style={styles.runTitle}>{title}</Text>
        <Text style={styles.muted}>
          {/* Runs are the usual case; only other kinds name their kind. */}
          {unit.kind === 'run' && isRun(unit.run) ? '' : `${kind} · `}
          {listDate(unit.at)}
          {note}
        </Text>
      </View>
      <View style={styles.runBottom}>
        <Text style={styles.runDistance}>
          {value} <Text style={styles.runUnit}>{valueUnit}</Text>
        </Text>
        <Text style={styles.muted}>{detail}</Text>
        <Text style={styles.arrow}>
          {checked === undefined ? '›' : checked ? '✓' : '○'}
        </Text>
      </View>
    </Pressable>
  );
});

export function RunbackApp({
  onOpenRoutePlanner,
}: {
  /** Opens the route planner. Without it there is no entry point. */
  onOpenRoutePlanner?: () => void;
} = {}) {
  const insets = useSafeAreaInsets();
  const [state, setState] = useState<AppState>(initial);
  // Set before anything below builds text; children remount on a change
  // through the key on the root view.
  const language: Language = isLanguage(state.settings.language)
    ? state.settings.language
    : deviceLanguage();
  setLanguage(language);
  // The watch and notifications have no JS of their own: they get the names
  // of this language whenever it is set or changes.
  useEffect(() => {
    void native.setDisplayNames(language, nativeDisplayNames(language).names).catch(() => {});
  }, [language]);
  const [serverStatus, setServerStatus] = useState<ServerLinkStatus | null>(null);
  useEffect(() => {
    let alive = true;
    const update = () => {
      if (AndroidAppState.currentState === 'background') return;
      void native.serverStatus().then(next => { if (alive) setServerStatus(next); }).catch(() => {});
    };
    update();
    const timer = setInterval(update, 5000);
    const subscription = AndroidAppState.addEventListener('change', update);
    return () => { alive = false; clearInterval(timer); subscription.remove(); };
  }, []);
  const stateRef = useRef(state);
  const stateGeneration = useRef(0);
  const settingsRevision = useRef(0);
  const settingsWritePending = useRef(false);
  const pendingScheduleLink = useRef<{
    entryId: string;
    activityId: string;
  } | null>(null);
  const [tab, setTab] = useState<Tab>('today');
  const [page, setPage] = useState<Page>('main');
  const [featureDetail, setFeatureDetail] = useState<
    FeatureId | 'recording' | 'strength'
  >('coach');
  const [selected, setSelected] = useState<Run | null>(null);
  const [selectedRecord, setSelectedRecord] = useState<StatsRecord | null>(
    null,
  );
  const [selectedSession, setSelectedSession] =
    useState<StrengthSession | null>(null);
  // Strength training in depth: exercise, personal best, and where the user
  // came from. A session or exercise can be opened from the other one; "Back"
  // returns there instead of to the main page.
  const [selectedExercise, setSelectedExercise] = useState<string | null>(null);
  const [selectedStrengthRecord, setSelectedStrengthRecord] =
    useState<StrengthRecord | null>(null);
  const [trail, setTrail] = useState<Trail[]>([]);
  // Strength session heart rate from the watch: short forms for statistics,
  // the series only for the open session.
  const [heartSummaries, setHeartSummaries] = useState<
    Record<string, StrengthHeartSummary>
  >({});
  // What the watch has transferred for the open session, and live for the running one.
  const [sessionWatch, setSessionWatch] = useState<StrengthWatchInfo | null>(
    null,
  );
  const [activeWatch, setActiveWatch] =
    useState<ReturnType<typeof strengthWatchLive>>(null);
  const [sessionHeart, setSessionHeart] = useState<StrengthHeart | undefined>(
    undefined,
  );
  const [exportSelection, setExportSelection] = useState<string[] | null>(null);
  const [exportFrom, setExportFrom] = useState('');
  const [exportTo, setExportTo] = useState('');
  const [exportProgress, setExportProgress] = useState('');
  const [unitFilter, setUnitFilter] = useState<UnitFilter>('all');
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [setupOpen, setSetupOpen] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  // Today: sport, run type, template, and goal are picked when starting, not
  // kept on the page. The sheet remembers its kind.
  const [startSheet, setStartSheet] = useState<StartKind | null>(null);
  const [startTemplateId, setStartTemplateId] = useState<string | null>(null);
  const [coachArea, setCoachArea] = useState<'running' | 'strength'>('running');
  // Add run types afterwards: one run at a time; skipped ones stay open.
  const [purposeSheet, setPurposeSheet] = useState(false);
  const [purposeSkipped, setPurposeSkipped] = useState<string[]>([]);
  const [historyView, setHistoryView] = useState<HistoryView>('units');
  const [templatesView, setTemplatesView] = useState<TemplatesView>('strength');
  const [templatesParent, setTemplatesParent] = useState<Page>('main');
  const [note, setNote] = useState('');
  const [importStatus, setImportStatus] = useState<any>(null);
  // "Edit end": sheet for the open run or the open strength session.
  const [endEdit, setEndEdit] = useState<{
    kind: 'run' | 'strength';
    id: string;
  } | null>(null);
  // Counts saved and deleted imports so suggestions reload.
  const [importRevision, setImportRevision] = useState(0);
  const [importBatches, setImportBatches] = useState<ImportBatch[] | null>(
    null,
  );
  const [importBatchesError, setImportBatchesError] = useState('');
  const [moreDetails, setMoreDetails] = useState(false);
  const [criteriaOpen, setCriteriaOpen] = useState(false);
  const [pastRecommendationOpen, setPastRecommendationOpen] = useState<
    string | null
  >(null);
  const [goalInput, setGoalInput] = useState('');
  const [goalStartInput, setGoalStartInput] = useState('');
  const [goalTargetInput, setGoalTargetInput] = useState('');
  const [goalPhaseInput, setGoalPhaseInput] = useState('');
  const [goalDistanceInput, setGoalDistanceInput] = useState('');
  const [goalTimeInput, setGoalTimeInput] = useState('');
  const [previewRunTarget, setPreviewRunTarget] = useState<RunTarget | null>(
    null,
  );
  const [presetName, setPresetName] = useState('');
  const [strength, setStrength] = useState<StrengthState>(emptyStrengthState());
  const [workoutOpen, setWorkoutOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [planDraft, setPlanDraft] = useState<WorkoutTemplate | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [recentSessions, setRecentSessions] = useState<StrengthSession[]>([]);
  const [strengthSessions, setStrengthSessions] = useState<StrengthSession[]>(
    [],
  );
  const [strengthHistoryAvailable, setStrengthHistoryAvailable] =
    useState(false);
  const [sorenessReports, setSorenessReports] = useState<
    CapturedSorenessReport[]
  >([]);
  const [sorenessStorageAvailable, setSorenessStorageAvailable] =
    useState(false);
  const [sorenessOpen, setSorenessOpen] = useState(false);
  const [muscleMapMode, setMuscleMapMode] = useState<BodyMapMode>('freshness');
  // After finishing, ask only for the feeling instead of the whole detail page.
  const [feelingOnly, setFeelingOnly] = useState(false);
  // Detail page: display series for the charts, an active moment for the map,
  // chart, and kilometers, plus the marked kilometer.
  const [series, setSeries] = useState<RunSeries | null>(null);
  const [seriesIndex, setSeriesIndex] = useState<number | null>(null);
  const [splitIndex, setSplitIndex] = useState<number | null>(null);
  // Whether the strength history has loaded (or was detected as unavailable).
  const [strengthHistorySettled, setStrengthHistorySettled] = useState(false);
  // Offer the training chat only with a configured OpenRouter connection.
  const [proseReady, setProseReady] = useState(false);
  const sorenessPromptShown = useRef(false);
  const strengthRef = useRef(strength);
  strengthRef.current = strength;
  const settings = state.settings;
  const features = useMemo(
    () =>
      normalizeFeatures(settings.features, {
        showHeartRate: settings.showHeartRate,
      }),
    [settings.features, settings.showHeartRate],
  );
  const tabs = useMemo(() => visibleTabs(features), [features]);
  const homeSections = useMemo(() => visibleHomeSections(features), [features]);
  const showRunning = features.areas.running;
  const showStrength = features.areas.strength;
  const runRecs = recommendationsShown(features, 'running');
  const strengthRecs = recommendationsShown(features, 'strength');
  const runRecsSuggested = recommendationsSuggested(features, 'running');
  const sports = enabledSports(features);
  const schedule = useMemo(
    () =>
      normalizeSchedule(settings.schedule, {
        routine: {
          days: settings.trainingDays ?? [],
          minutes: settings.minutes ?? 30,
        },
      }),
    [settings.schedule, settings.trainingDays, settings.minutes],
  );
  const runs = state.runs;
  // Only runs carry this pace analysis and kilometers; rides sit alongside them.
  const runningRuns = useMemo(() => runs.filter(isRun), [runs]);
  // Goal progress: estimate from actual runs, separate from any recommendation.
  const racePrediction = useMemo(
    () =>
      predictRace({
        goal: settings.goal || schedule.goal?.name || '',
        distanceKm: settings.goalDistanceKm ?? schedule.goal?.distanceKm,
        targetDate: settings.goalTargetDate || schedule.goal?.targetDate,
        targetSeconds:
          settings.goalTargetSeconds ?? schedule.goal?.targetSeconds,
        runs: runningRuns,
        now,
      }),
    // `tr` reads the module-level language, so the text recomputes via this dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      settings.goal,
      settings.goalDistanceKm,
      settings.goalTargetDate,
      settings.goalTargetSeconds,
      schedule.goal,
      runningRuns,
      now,
      language,
    ],
  );
  const statisticsView = useMemo(
    () => readStatisticsView(settings.statisticsView),
    [settings.statisticsView],
  );
  const recording = state.recording;
  const isRecording = Boolean(recording);
  const showOnboarding =
    loaded && !isRecording && (setupOpen || !settings.onboardedAt);
  // At most one open recommendation per area; both share the list.
  const experiment = activeExperimentFor(settings.experiments, 'running');
  const strengthExperiment = activeExperimentFor(
    settings.experiments,
    'strength',
  );
  const analyses = useMemo(
    () =>
      (runRecs ? runningRuns : []).map(run => ({
        run,
        analysis: analyzeRun(run, experiment, runningRuns),
      })),
    // `tr` reads the module-level language, so the text recomputes via this dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [runningRuns, experiment, runRecs, language],
  );
  const finishedSessions = useMemo(
    () => strengthSessions.filter(session => session.status === 'finished'),
    [strengthSessions],
  );
  // Runs and strength sessions on one timeline, newest first.
  const units = useMemo<Unit[]>(
    () =>
      [
        ...runs.map(
          (run): Unit => ({
            kind: 'run',
            key: `run-${run.id}`,
            at: run.startTime,
            run,
          }),
        ),
        ...finishedSessions.map(
          (session): Unit => ({
            kind: 'strength',
            key: `strength-${session.id}`,
            at: session.startTime,
            session,
          }),
        ),
      ].sort((a, b) => b.at - a.at || a.key.localeCompare(b.key)),
    [runs, finishedSessions],
  );
  // A filter with no matching units (e.g. after deleting the last ride) is
  // hidden and must not leave the list empty.
  const effectiveUnitFilter: UnitFilter =
    unitFilter !== 'all' && !units.some(unit => unitMatches(unit, unitFilter))
      ? 'all'
      : unitFilter;
  const visibleUnits = useMemo(
    () => units.filter(unit => unitMatches(unit, effectiveUnitFilter)),
    [units, effectiveUnitFilter],
  );
  const todayKey = localDateKey(now);
  const unitListItems = useMemo(
    () => groupUnitsByWeek(visibleUnits, todayKey),
    // `tr` reads the module-level language, so the text recomputes via this dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [visibleUnits, todayKey, language],
  );
  const selection = useMemo(
    () =>
      selectRecommendations(runRecs ? runningRuns : [], {
        active: experiment,
        otherActive: strengthExperiment ? [strengthExperiment] : [],
        experiments: settings.experiments,
        dismissed: settings.dismissedRecommendations,
        postponedUntil: settings.postponedUntil,
        focus: settings.trainingFocus,
        targetDate: settings.goalTargetDate || schedule.goal?.targetDate,
        today: localDateKey(now),
        now,
      }),
    // `tr` reads the module-level language, so the text recomputes via this dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      runningRuns,
      runRecs,
      experiment,
      strengthExperiment,
      settings.experiments,
      settings.dismissedRecommendations,
      settings.postponedUntil,
      settings.trainingFocus,
      settings.goalTargetDate,
      schedule.goal?.targetDate,
      now,
      language,
    ],
  );
  const candidate = experiment || !runRecs ? undefined : selection.selected;
  const queued =
    experiment && runRecs && features.recommendations.showQueued
      ? selection.selected
      : undefined;
  const strengthSelection = useMemo(
    () =>
      selectStrengthRecommendation(strengthRecs ? finishedSessions : [], {
        active: strengthExperiment,
        otherActive: experiment ? [experiment] : [],
        experiments: settings.experiments,
        dismissed: settings.dismissedRecommendations,
        postponedUntil: settings.strengthPostponedUntil as number | undefined,
        focus: settings.strengthFocus,
        targetDate: settings.strengthGoalTargetDate,
        today: localDateKey(now),
        now,
      }),
    // `tr` reads the module-level language, so the text recomputes via this dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      finishedSessions,
      strengthRecs,
      strengthExperiment,
      experiment,
      settings.experiments,
      settings.dismissedRecommendations,
      settings.strengthPostponedUntil,
      settings.strengthFocus,
      settings.strengthGoalTargetDate,
      now,
      language,
    ],
  );
  const strengthCandidate =
    strengthExperiment || !strengthRecs
      ? undefined
      : strengthSelection.selected;
  const strengthQueued =
    strengthExperiment && strengthRecs && features.recommendations.showQueued
      ? strengthSelection.selected
      : undefined;
  const purpose = settings.purpose || 'free';
  // A deselected sport falls back to the first allowed one.
  const chosenSport = normalizeSport(settings.sport);
  const sport = sports.includes(chosenSport)
    ? chosenSport
    : sports[0] ?? 'running';
  const words = sportWords(sport);
  const runTarget = normalizeRunTarget(settings.runTarget);

  const refresh = useCallback(async () => {
    const generation = stateGeneration.current;
    const revision = settingsRevision.current;
    const next = await native.state();
    if (generation !== stateGeneration.current) {
      return stateRef.current;
    }
    if (revision !== settingsRevision.current || settingsWritePending.current) {
      next.settings = stateRef.current.settings;
    }
    next.runs.sort((a, b) => b.startTime - a.startTime);
    stateRef.current = next;
    setState(next);
    setLoaded(true);
    return next;
  }, []);
  const reloadTrainingState = useCallback(async () => {
    pendingScheduleLink.current = null;
    strengthRef.current = emptyStrengthState();
    setStrength(emptyStrengthState());
    setStrengthSessions([]);
    setStrengthHistoryAvailable(false);
    setSorenessReports([]);
    setSorenessStorageAvailable(false);
    setRecentSessions([]);
    setPlanDraft(null);
    setPickerOpen(false);
    setWorkoutOpen(false);
    setSorenessOpen(false);
    const [nextStrength, nextSessions, nextReports] = await Promise.all([
      native.strength(),
      native.strengthSessions(500),
      native.sorenessReports(),
    ]);
    strengthRef.current = nextStrength;
    setStrength(nextStrength);
    setStrengthSessions(nextSessions);
    setStrengthHistoryAvailable(true);
    setSorenessReports(nextReports);
    setSorenessStorageAvailable(true);
    setRecentSessions([]);
    setPlanDraft(null);
    setPickerOpen(false);
    setWorkoutOpen(Boolean(nextStrength.active));
    setSorenessOpen(false);
  }, []);
  const action = useCallback(async (fn: () => Promise<void>) => {
    if (busyRef.current) {
      return;
    }
    stateGeneration.current += 1;
    busyRef.current = true;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await fn();
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : tr(
              'Die Aktion konnte nicht abgeschlossen werden. Bitte erneut versuchen.',
              'The action could not be completed. Try again.',
            ),
      );
    } finally {
      stateGeneration.current += 1;
      busyRef.current = false;
      setBusy(false);
    }
  // `tr` reads the module-level language, so the text recomputes via this dependency.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [language]);
  const persist = useCallback(async (patch: Partial<Settings>) => {
    const updated = { ...stateRef.current.settings, ...patch };
    settingsRevision.current += 1;
    settingsWritePending.current = true;
    try {
      await native.saveSettings(updated);
      stateRef.current = { ...stateRef.current, settings: updated };
      setState(stateRef.current);
    } finally {
      settingsWritePending.current = false;
      settingsRevision.current += 1;
    }
  }, []);
  const save = (patch: Partial<Settings>) => {
    void action(() => persist(patch));
  };

  const openGoogleMaps = useCallback(async (points: RouteCoordinate[]) => {
    const url = googleMapsDirectionsUrl(points);
    if (!url)
      throw new Error(
        tr(
          'Diese Route kann nicht geöffnet werden.',
          'This route cannot be opened.',
        ),
      );
    await Linking.openURL(url);
  // `tr` reads the module-level language, so the text recomputes via this dependency.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [language]);

  const openCoMaps = useCallback(async (points: RouteCoordinate[]) => {
    await native.openRouteFile(points, 'comaps');
  }, []);
  // Three files to pass on (e.g. to a language model): the report for people,
  // the analysis as JSON, and the 5-second time series as CSV. Kotlin writes
  // the time series straight into the export cache; if it or the timeline is
  // missing, only that part is missing — the rest is still shared.
  const prepareRunExport = async (
    run: Run,
    analysis: RunAnalysis | null,
    current: AppState,
  ) => {
    let timeline: RunTimeline | null = null;
    try {
      timeline = await native.runTimeline(run.id);
    } catch {
      timeline = null;
    }
    const sameSport = current.runs.filter(
      other => normalizeSport(other.sport) === normalizeSport(run.sport),
    );
    const names = runExportFileNames(run);
    const input = {
      run,
      analysis,
      timeline,
      context: {
        goal: current.settings.goal,
        goalTargetDate: current.settings.goalTargetDate,
        focus: current.settings.trainingFocus,
        adherence: current.settings.adherence?.[run.id],
        history: sameSport,
      },
    };
    return { names, input };
  };
  const shareRuns = (getIds: () => Promise<string[]>) => {
    void action(async () => {
      const ids = [...new Set(await getIds())];
      if (!ids.length)
        throw new Error(
          tr(
            'Wähle mindestens einen Lauf im Zeitraum oder in der Liste.',
            'Choose at least one run in the period or in the list.',
          ),
        );
      const current = stateRef.current;
      const archive = await native.beginRunArchive();
      try {
        for (const [index, id] of ids.entries()) {
          setExportProgress(
            tr(
              `${index + 1} von ${ids.length} Läufen`,
              `${index + 1} of ${ids.length} ${ids.length === 1 ? 'run' : 'runs'}`,
            ),
          );
          const run = await native.run(id);
          const analysis = analyzeRun(
            run,
            activeExperimentFor(current.settings.experiments, 'running'),
            current.runs.filter(isRun),
          );
          const { names, input } = await prepareRunExport(
            run,
            analysis,
            current,
          );
          await native.appendRunArchive(archive, id, {
            markdown: {
              fileName: names.markdown,
              content: buildRunReport(input),
            },
            analysis: {
              fileName: names.analysis,
              content: JSON.stringify(buildRunAnalysisExport(input), null, 1),
            },
            timeseries: names.timeseries,
          });
        }
        await native.shareRunArchive(archive);
        setExportSelection(null);
      } finally {
        setExportProgress('');
        await native.discardRunArchive(archive).catch(() => {});
      }
    });
  };
  const toggleExportRun = (id: string) => {
    if (busyRef.current) return;
    setExportSelection(ids =>
      ids?.includes(id)
        ? ids.filter(value => value !== id)
        : [...(ids || []), id],
    );
  };

  const shareRun = (run: Run, analysis: RunAnalysis | null) => {
    void action(async () => {
      const { names, input } = await prepareRunExport(
        run,
        analysis,
        stateRef.current,
      );
      const files: { fileName: string; mimeType: string; content?: string }[] =
        [
          {
            fileName: names.markdown,
            mimeType: 'text/markdown',
            content: buildRunReport(input),
          },
          {
            fileName: names.analysis,
            mimeType: 'application/json',
            content: JSON.stringify(buildRunAnalysisExport(input), null, 1),
          },
        ];
      try {
        const written = await native.writeRunTimeseries(
          run.id,
          names.timeseries,
        );
        if (written.rows > 0) {
          files.push({ fileName: written.fileName, mimeType: 'text/csv' });
        }
      } catch {
        // Without a time series (import, old data) the report and analysis remain.
      }
      const noun = sportWords(run.sport).noun;
      await native.shareFiles(
        files,
        tr(`${noun} teilen`, `Share ${noun.toLowerCase()}`),
      );
    });
  };
  // All strength sessions recorded in Runback as one ZIP, without imports.
  // One call per session; Kotlin appends to the files and only packs at the
  // end. The README comes first, its content last (with the counts).
  // Kotlin adds the watch motion data when packing; it stays native.
  const shareStrength = () => {
    void action(async () => {
      const ids = await native.recordedStrengthSessionIds();
      if (!ids.length)
        throw new Error(
          tr(
            'Zeichne zuerst eine Krafteinheit auf.',
            'Record a strength session first.',
          ),
        );
      const files = STRENGTH_EXPORT_FILES;
      const headers = strengthExportHeaders();
      const settings = stateRef.current.settings;
      const motion = await native.motionStatus().catch(() => undefined);
      const summary = {
        exportedAt: Date.now(),
        sessions: 0,
        sets: 0,
        heartSessions: 0,
        motionSessions: motion?.sessions,
        firstStart: undefined as number | undefined,
        lastStart: undefined as number | undefined,
        goal: settings.strengthGoal,
        goalTargetDate: settings.strengthGoalTargetDate,
        focus: settings.strengthFocus,
      };
      const archive = await native.beginExportArchive('runback-krafttraining');
      try {
        await native.appendExportArchive(archive, {
          [files.readme]: '',
          [files.log]: headers.log,
          [files.sessions]: headers.sessions,
          [files.sets]: headers.sets,
          [files.heart]: headers.heart,
          [files.jsonl]: '',
        });
        for (const [index, id] of ids.entries()) {
          setExportProgress(
            tr(
              `${index + 1} von ${ids.length} Einheiten`,
              `${index + 1} of ${ids.length} ${ids.length === 1 ? 'session' : 'sessions'}`,
            ),
          );
          const session = await native.strengthSession(id);
          if (!isRecordedStrengthSession(session)) continue;
          const heart = await native.strengthHeart(id).catch(() => undefined);
          const chunk = strengthExportChunk(session, heart);
          await native.appendExportArchive(archive, {
            [files.log]: chunk.log,
            [files.sessions]: chunk.sessions,
            [files.sets]: chunk.sets,
            [files.heart]: chunk.heart,
            [files.jsonl]: chunk.jsonl,
          });
          summary.sessions += 1;
          summary.sets += chunk.setCount;
          summary.heartSessions += chunk.heartSessions;
          summary.firstStart ??= session.startTime;
          summary.lastStart = session.startTime;
        }
        if (!summary.sessions)
          throw new Error(
            tr(
              'Zeichne zuerst eine Krafteinheit auf.',
              'Record a strength session first.',
            ),
          );
        await native.appendExportArchive(archive, {
          [files.readme]: strengthExportReadme(summary),
        });
        await native.shareExportArchive(
          archive,
          tr('Krafttraining teilen', 'Share strength training'),
          { includeMotion: true },
        );
      } finally {
        setExportProgress('');
        await native.discardExportArchive(archive).catch(() => {});
      }
    });
  };

  useEffect(() => {
    void refresh()
      .catch(e => setError(String(e.message)))
      .finally(() => setLoading(false));
  }, [refresh]);
  // Strength training loads separately. Without native support the state stays
  // empty and the rest of the app is untouched (ground rule 7).
  useEffect(() => {
    void native
      .strength()
      .then(next => {
        setStrength(next);
        if (next.active) {
          setSorenessOpen(false);
          setWorkoutOpen(true);
        }
      })
      .catch(() => {});
    void native
      .strengthSessions(500)
      .then(sessions => {
        setStrengthSessions(sessions);
        setStrengthHistoryAvailable(true);
      })
      .catch(() => setStrengthHistoryAvailable(false))
      .finally(() => setStrengthHistorySettled(true));
    void native
      .sorenessReports()
      .then(next => {
        setSorenessReports(next);
        setSorenessStorageAvailable(true);
      })
      .catch(() => {});
  }, []);
  // Heart rate reaches the app from the watch only after training; so ask again
  // on every tab change and after new sessions. Without a watch it stays empty.
  useEffect(() => {
    if (!showStrength) return;
    let cancelled = false;
    native
      .strengthHeartSummaries?.()
      .then(next => {
        if (!cancelled) setHeartSummaries(next);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [strengthSessions, tab, showStrength]);
  const selectedSessionId = selectedSession?.id;
  useEffect(() => {
    setSessionHeart(undefined);
    setSessionWatch(null);
    if (!selectedSessionId) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const loadHeart = () =>
      native
        .strengthHeart?.(selectedSessionId)
        .then(next => {
          if (!cancelled) setSessionHeart(next);
        })
        .catch(() => {});
    // If the session is still waiting for the watch, the page checks until the
    // data is there, then fetches the heart rate.
    const loadWatch = async (waited: boolean) => {
      const next = await native
        .strengthWatch?.(selectedSessionId)
        .catch(() => null);
      if (cancelled) return;
      setSessionWatch(next ?? null);
      const transfer = strengthWatchTransfer(next ?? null);
      if (transfer === 'waiting') {
        timer = setTimeout(() => void loadWatch(true), 5000);
      } else if (waited && transfer === 'received') {
        void loadHeart();
      }
    };
    void loadHeart();
    void loadWatch(false);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [selectedSessionId, selectedSession?.endTime]);
  const loadProseReady = useCallback(() => {
    void nativeCall<{ enabled?: boolean; hasKey?: boolean }>('getProseSettings')
      .then(value => setProseReady(Boolean(value?.enabled && value?.hasKey)))
      .catch(() => setProseReady(false));
  }, []);
  useEffect(() => {
    loadProseReady();
  }, [loadProseReady]);
  // The prompt appears at most once per session, and only if the setting asks
  // for it (`shouldPromptSoreness`).
  useEffect(() => {
    if (
      !loaded ||
      !sorenessStorageAvailable ||
      !strengthHistorySettled ||
      sorenessPromptShown.current ||
      showOnboarding ||
      isRecording ||
      workoutOpen
    ) {
      return;
    }
    sorenessPromptShown.current = true;
    if (
      shouldPromptSoreness(
        features,
        sorenessReports,
        strengthSessions,
        settings.trainingDays ?? [],
        Date.now(),
      )
    ) {
      setSorenessOpen(true);
    }
  }, [
    features,
    isRecording,
    loaded,
    settings.trainingDays,
    sorenessReports,
    sorenessStorageAvailable,
    strengthHistorySettled,
    strengthSessions,
    showOnboarding,
    workoutOpen,
  ]);
  // During training: what the watch is measuring right now, every few seconds.
  const activeSessionId = strength.active?.id;
  useEffect(() => {
    setActiveWatch(null);
    if (!activeSessionId || !workoutOpen) return;
    let cancelled = false;
    const update = async () => {
      if (AndroidAppState.currentState === 'background') return;
      const info = await native
        .strengthWatch?.(activeSessionId)
        .catch(() => null);
      if (!cancelled)
        setActiveWatch(strengthWatchLive(info ?? null, Date.now()));
    };
    void update();
    const timer = setInterval(update, 3000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [activeSessionId, workoutOpen]);
  // Second tick only while a rest is running and the timer is visible.
  useEffect(() => {
    if (
      strength.active?.restStartedAt === undefined ||
      !features.strength.restTimer
    ) {
      return;
    }
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [strength.active?.restStartedAt, features.strength.restTimer]);
  // If the current tab disappears (plan switched off), go to Today.
  useEffect(() => {
    if (
      tab !== 'today' &&
      tab !== 'history' &&
      !availableTabs(features).includes(tab)
    ) {
      setTab('today');
    }
  }, [features, tab]);
  useEffect(() => {
    const subscription = AndroidAppState.addEventListener('change', value => {
      if (value === 'active' && !busyRef.current) {
        setNow(Date.now());
        void refresh().catch(() => {});
      }
    });
    const timer = setInterval(
      () => {
        if (!busyRef.current && AndroidAppState.currentState === 'active') {
          setNow(Date.now());
          void refresh().catch(() => {});
        }
      },
      isRecording ? 1200 : 8000,
    );
    return () => {
      subscription.remove();
      clearInterval(timer);
    };
  }, [refresh, isRecording]);
  useEffect(() => {
    const subscription = BackHandler.addEventListener(
      'hardwareBackPress',
      () => {
        if (exportSelection !== null) {
          if (!busyRef.current) setExportSelection(null);
          return true;
        }
        if (showOnboarding) return false;
        if (sorenessOpen) {
          setSorenessOpen(false);
          return true;
        }
        if (workoutOpen) {
          if (pickerOpen) {
            setPickerOpen(false);
          } else {
            setWorkoutOpen(false);
          }
          return true;
        }
        if (startSheet) {
          setStartSheet(null);
          return true;
        }
        if (selected) {
          setSelected(null);
          setMoreDetails(false);
          setFeelingOnly(false);
          return true;
        }
        if (page !== 'main') {
          leaveDepthRef.current();
          return true;
        }
        if (tab !== 'today') {
          setTab('today');
          return true;
        }
        return false;
      },
    );
    return () => subscription.remove();
  }, [
    exportSelection,
    selected,
    page,
    templatesParent,
    tab,
    startSheet,
    showOnboarding,
    workoutOpen,
    pickerOpen,
    sorenessOpen,
  ]);
  useEffect(() => {
    setNote(selected?.note || '');
  }, [selected?.id, selected?.note]);
  useEffect(() => {
    if (importStatus?.state !== 'running') {
      return;
    }
    const timer = setInterval(() => {
      void nativeCall<any>('getImportStatus')
        .then(result => {
          setImportStatus(result);
          if (result.state !== 'running') {
            void refresh();
            void native
              .strengthSessions(500)
              .then(sessions => {
                setStrengthSessions(sessions);
                setStrengthHistoryAvailable(true);
              })
              .catch(() => setStrengthHistoryAvailable(false));
          }
        })
        .catch(() => {});
    }, 1000);
    return () => clearInterval(timer);
  }, [importStatus?.state, refresh]);

  useEffect(() => {
    if (page !== 'imports') {
      return;
    }
    let current = true;
    setImportBatchesError('');
    native
      .importBatches()
      .then(batches => current && setImportBatches(batches))
      .catch(e => {
        if (current) {
          setImportBatches([]);
          setImportBatchesError(
            e instanceof Error
              ? e.message
              : tr(
                  'Importe konnten nicht geladen werden.',
                  'Imports could not be loaded.',
                ),
          );
        }
      });
    return () => {
      current = false;
    };
  }, [page]);

  const openRun = useCallback(
    (id: string) => {
      void action(async () => {
        setSelected(await native.run(id));
        setMoreDetails(false);
      });
    },
    [action],
  );
  // The series comes separately from the run, because it is larger and only
  // the detail page needs it. If it is missing (import without a trace, old
  // build), there is no history — no substitute data.
  const selectedId = selected?.id;
  // A newly set end changes the series, so reload on that too.
  const selectedEnd = selected?.endTime;
  useEffect(() => {
    setSeries(null);
    setSeriesIndex(null);
    setSplitIndex(null);
    if (!selectedId) return;
    let cancelled = false;
    native
      .runSeries?.(selectedId)
      .then(result => {
        if (!cancelled) setSeries(result.rows.length >= 2 ? result : null);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [selectedId, selectedEnd]);
  const openUnit = useCallback(
    (unit: Unit) => {
      if (unit.kind === 'run') {
        openRun(unit.run.id);
        return;
      }
      setTrail([]);
      setSelectedSession(unit.session);
      setPage('session');
    },
    [openRun],
  );
  const openPage = (next: Page) => {
    setExportSelection(null);
    if (next === 'templates' && page !== 'templates') {
      setTemplatesParent(page);
    }
    setPage(next);
    setTrail([]);
    if (next !== 'session') {
      setSelectedSession(null);
    }
    setSelectedExercise(null);
    setSelectedStrengthRecord(null);
    // Existing users see a hint about Today until their first visit; the first
    // visit writes the default values and ends it.
    if (next === 'features' && !settings.features) {
      save({ features });
    }
    if (next === 'muscle-map') {
      setNow(Date.now());
      setMuscleMapMode('soreness');
    }
    if (next === 'run-target' || next === 'run-audio')
      setPreviewRunTarget(null);
    if (next === 'goal') {
      setGoalInput(schedule.goal?.name || settings.goal || '');
      // Without a start there is no plan state and no build-up: suggest today;
      // the user sees it and changes it in the field.
      setGoalStartInput(
        dateToInput(schedule.goal?.startDate || localDateKey(now)),
      );
      setGoalTargetInput(
        dateToInput(settings.goalTargetDate || schedule.goal?.targetDate || ''),
      );
      setGoalPhaseInput(schedule.goal?.phase || '');
      const distanceKm = settings.goalDistanceKm ?? schedule.goal?.distanceKm;
      setGoalDistanceInput(
        distanceKm === undefined ? '' : plainNumber(distanceKm),
      );
      const targetSeconds =
        settings.goalTargetSeconds ?? schedule.goal?.targetSeconds;
      // Always h:mm:ss, so "59:30" is not read as hours when saved.
      setGoalTimeInput(
        targetSeconds === undefined
          ? ''
          : `${Math.floor(targetSeconds / 3600)}:${String(
              Math.floor((targetSeconds % 3600) / 60),
            ).padStart(2, '0')}:${String(targetSeconds % 60).padStart(2, '0')}`,
      );
    }
  };
  const switchTab = (next: Tab) => {
    setExportSelection(null);
    setNow(Date.now());
    setTab(next);
    setStartSheet(null);
    setPage('main');
    setSelected(null);
    setFeelingOnly(false);
    setSelectedSession(null);
    setSelectedExercise(null);
    setSelectedStrengthRecord(null);
    setTrail([]);
    setError('');
    setMessage('');
  };
  const openCoach = (area: 'running' | 'strength') => {
    setCoachArea(area);
    setCriteriaOpen(false);
    switchTab('coach');
  };
  // One level back: from strength training depth to where the user came from,
  // otherwise to the fixed parent page.
  const leavePage = () => {
    const last = DEPTH_PAGES.includes(page)
      ? trail[trail.length - 1]
      : undefined;
    if (last) {
      setTrail(trail.slice(0, -1));
      setSelectedSession(last.session);
      setSelectedExercise(last.exercise);
      setSelectedStrengthRecord(last.record);
      setPage(last.page);
      return;
    }
    setTrail([]);
    setPage(
      page === 'templates' ? templatesParent : PARENT_PAGE[page] ?? 'main',
    );
    setSelectedSession(null);
    setSelectedExercise(null);
    setSelectedStrengthRecord(null);
  };
  const leaveDepthRef = useRef(leavePage);
  leaveDepthRef.current = leavePage;
  const openDepth = (
    next: Page,
    change: {
      session?: StrengthSession;
      exercise?: string;
      record?: StrengthRecord;
    },
  ) => {
    setExportSelection(null);
    setTrail(current => [
      ...current,
      {
        page,
        session: selectedSession,
        exercise: selectedExercise,
        record: selectedStrengthRecord,
      },
    ]);
    if (change.session) setSelectedSession(change.session);
    if (change.exercise) setSelectedExercise(change.exercise);
    if (change.record) setSelectedStrengthRecord(change.record);
    setPage(next);
  };
  const openSessionById = (id: string) => {
    const session = strengthSessions.find(entry => entry.id === id);
    if (session) openDepth('session', { session });
  };
  const openExercise = (exerciseId: string) =>
    openDepth('exercise', { exercise: exerciseId });
  const openStrengthRecord = (record: StrengthRecord) => {
    if (record.sessionIds.length === 1) openSessionById(record.sessionIds[0]);
    else openDepth('record-sessions', { record });
  };
  const leaveDetail = () => {
    if (selected) {
      setSelected(null);
      setMoreDetails(false);
      setFeelingOnly(false);
      return;
    }
    if (page === 'models' || page === 'devices') {
      loadProseReady();
    }
    leavePage();
  };
  const changeFeatures = (next: Features) => {
    const at = Date.now();
    const stopsRunning =
      recommendationsShown(features, 'running') &&
      !recommendationsShown(next, 'running');
    const stopsStrength =
      recommendationsShown(features, 'strength') &&
      !recommendationsShown(next, 'strength');
    const pausing: string[] = [];
    if (stopsRunning && experiment?.status === 'active') {
      pausing.push(experiment.id);
    }
    if (stopsStrength && strengthExperiment?.status === 'active') {
      pausing.push(strengthExperiment.id);
    }
    const apply = () => {
      const patch: Partial<Settings> = { features: next };
      if (pausing.length) {
        // The reason is stored in the experiment history, so it stays German.
        patch.experiments = settings.experiments?.map(item =>
          pausing.includes(item.id)
            ? transitionExperiment(
                item,
                'paused',
                at,
                tr('Funktion abgeschaltet', 'Feature turned off'),
              )
            : item,
        );
      }
      save(patch);
    };
    const warnings = [
      features.areas.strength && !next.areas.strength && strength.active
        ? tr(
            'Ein Krafttraining läuft gerade; es bleibt gespeichert.',
            'A strength session is running; it stays saved.',
          )
        : '',
      pausing.length
        ? tr(
            'Die laufende Empfehlung wird pausiert, nicht abgebrochen.',
            'The running recommendation is paused, not cancelled.',
          )
        : '',
    ].filter(Boolean);
    if (!warnings.length) {
      apply();
      return;
    }
    Alert.alert(
      tr('Trotzdem ausblenden?', 'Hide anyway?'),
      warnings.join(' '),
      [
        { text: tr('Zurück', 'Back'), style: 'cancel' },
        { text: tr('Ausblenden', 'Hide'), onPress: apply },
      ],
    );
  };

  // ── Strength training ────────────────────────────────────────────────────
  // Every change saves the running session right away, so a crash or an empty
  // battery does not lose confirmed sets (T-4).
  // The watch or a notification may have saved in between. Then the phone
  // rejects, and the same change is retried on its state.
  const persistSession = useCallback(
    (
      change: (session: StrengthSession) => StrengthSession,
      base: StrengthSession,
      attempt = 0,
    ) => {
      const next = reviseSession(base, change(base));
      strengthRef.current = { ...strengthRef.current, active: next };
      setStrength(current => ({ ...current, active: next }));
      void native
        .saveStrengthSession(next)
        .then(result => {
          // Already finished or a different session by now: do not revive anything.
          if (!result.conflict || result.active?.id !== base.id) return;
          const current = result.active;
          if (attempt < MAX_SAVE_RETRIES) {
            persistSession(change, current, attempt + 1);
          } else {
            strengthRef.current = { ...strengthRef.current, active: current };
            setStrength(value => ({ ...value, active: current }));
          }
        })
        .catch(e => setError(e.message));
    },
    [],
  );
  const changeSession = useCallback(
    (change: (session: StrengthSession) => StrengthSession) => {
      const active = strengthRef.current.active;
      if (active) {
        persistSession(change, active);
      }
    },
    [persistSession],
  );
  /** Rest buttons apply to the rest that was running when tapped — not a newer one from the watch. */
  const changeRest = useCallback(
    (change: (session: StrengthSession) => StrengthSession) => {
      const restStartedAt = strengthRef.current.active?.restStartedAt;
      changeSession(s => (s.restStartedAt === restStartedAt ? change(s) : s));
    },
    [changeSession],
  );
  const loadRecentSessions = useCallback(async (state: StrengthState) => {
    const recent = [...state.history]
      .sort((a, b) => b.startTime - a.startTime)
      .slice(0, 5);
    const loaded = await Promise.all(
      recent.map(entry => native.strengthSession(entry.id).catch(() => null)),
    );
    setRecentSessions(loaded.filter(Boolean) as StrengthSession[]);
  }, []);
  // The watch and a notification change the running session natively; the new
  // state arrives as an event and replaces ours, so nothing is overwritten.
  useEffect(
    () =>
      native.onStrengthChanged?.(next => {
        const current = strengthRef.current.active;
        // Started on the watch: the app takes over the new session.
        if (next && !current && next.status === 'active') {
          strengthRef.current = { ...strengthRef.current, active: next };
          setStrength(value => ({ ...value, active: next }));
          setWorkoutOpen(true);
          setNow(Date.now());
          void loadRecentSessions(strengthRef.current);
          return;
        }
        if (!next || !current || next.id !== current.id) return;
        if (next.revision && next.revision === current.revision) return;
        strengthRef.current = { ...strengthRef.current, active: next };
        setStrength(value => ({ ...value, active: next }));
        setNow(Date.now());
      }),
    [loadRecentSessions],
  );
  const startStrength = (template: WorkoutTemplate | null) => {
    if (strengthRef.current.active) {
      setWorkoutOpen(true);
      return;
    }
    void action(async () => {
      const created = startSession(template, Date.now());
      const session = reviseSession(created, created);
      // Saved first, then usable: a change before that would have no saved state
      // to build on and would be lost.
      const saved = await native.saveStrengthSession(session);
      // The watch just started a session: that one keeps running, not a second.
      const active = saved.conflict && saved.active ? saved.active : session;
      strengthRef.current = { ...strengthRef.current, active };
      setStrength(current => ({ ...current, active }));
      setWorkoutOpen(true);
      setNow(Date.now());
      await loadRecentSessions(strengthRef.current);
    });
  };
  const finishStrength = () => {
    const active = strengthRef.current.active;
    if (!active) {
      return;
    }
    const endTime = Date.now();
    void action(async () => {
      let base = active;
      let next = await native.finishStrengthSession(
        reviseSession(base, finishSession(base, endTime)),
      );
      // Ticked off on the watch while "Finish" ran here: finish the watch's state.
      for (let attempt = 0; next.conflict; attempt++) {
        if (!next.active || next.active.id !== base.id) break;
        if (attempt >= MAX_SAVE_RETRIES) {
          throw new Error(
            tr(
              'Das Training hat sich gerade geändert. Beende es erneut.',
              'The session changed just now. Finish it again.',
            ),
          );
        }
        base = next.active;
        next = await native.finishStrengthSession(
          reviseSession(base, finishSession(base, endTime)),
        );
      }
      strengthRef.current = next;
      setStrength(next);
      try {
        setStrengthSessions(await native.strengthSessions(500));
        setStrengthHistoryAvailable(true);
      } catch {
        setStrengthHistoryAvailable(false);
      }
      setWorkoutOpen(false);
      setMessage(tr('Training gespeichert.', 'Session saved.'));
    });
  };
  // Plans stay user artifacts: only what the user explicitly confirmed here is
  // written (T-6).
  const persistTemplates = (next: WorkoutTemplate[]) => {
    setStrength(current => ({ ...current, templates: next }));
    void native.saveStrengthTemplates(next).catch(e => setError(e.message));
  };
  const todaysScheduledRun = (
    features.planning.enabled ? schedule.sessions : []
  ).find(
    item =>
      item.date === todayKey &&
      item.kind === 'run' &&
      item.status === 'planned' &&
      !item.activityId,
  );
  const todaysScheduledStrength = (
    features.planning.enabled ? schedule.sessions : []
  ).find(
    item =>
      item.date === todayKey &&
      item.kind === 'strength' &&
      item.status === 'planned' &&
      !item.activityId,
  );
  const hasStrengthCalendar =
    features.planning.enabled &&
    schedule.sessions.some(item => item.kind === 'strength');
  const todaysTemplate = !features.templates.enabled
    ? null
    : hasStrengthCalendar
    ? strength.templates.find(
        item => item.id === todaysScheduledStrength?.templateId,
      ) ?? null
    : features.strength.templateOfDay
    ? templateForDay(strength.templates, new Date(now).getDay())
    : null;
  // A recording needs only location permission, nothing else: no plan, no
  // template. Sport and run type are labels, not targets.
  const beginRecording = async (
    nextPurpose: RunPurpose,
    nextSport: Sport,
  ): Promise<Run> => {
    const permissions = await nativeCall<{ locationPermission: boolean }>(
      'requestRecordingPermissions',
    );
    if (!permissions.locationPermission) {
      throw new Error(
        tr(
          'Für die Streckenaufzeichnung fehlt die genaue Standortfreigabe. Du kannst sie in den Android-App-Einstellungen ändern.',
          'Route recording needs precise location access. You can change it in the Android app settings.',
        ),
      );
    }
    const started = await nativeCall<{ recording?: Run }>(
      'startRun',
      nextPurpose,
      nextSport,
      JSON.stringify(
        nextSport === 'running'
          ? targetForPurpose(
              normalizeRunTarget(stateRef.current.settings.runTarget),
              nextPurpose,
            )
          : NO_RUN_TARGET,
      ),
    );
    const active = started.recording?.id
      ? normalizeRun(started.recording)
      : (await refresh()).recording;
    if (!active) {
      throw new Error(
        tr(
          'Die Aufzeichnung konnte noch nicht geladen werden. Prüfe die Startseite.',
          'The recording could not be loaded yet. Check the start page.',
        ),
      );
    }
    stateRef.current = { ...stateRef.current, recording: active };
    setState(stateRef.current);
    return active;
  };
  const start = () => {
    void action(async () => {
      if (!stateRef.current.recording) {
        await beginRecording(purpose, sport);
      }
      switchTab('today');
    });
  };
  // The start sheet opens with the kind tapped on Today; today's strength
  // template is preselected, otherwise the first existing one.
  const openStartSheet = (kind: StartKind) => {
    setNow(Date.now());
    if (kind === 'strength') {
      setStartTemplateId(
        todaysTemplate?.id ?? strengthRef.current.templates[0]?.id ?? null,
      );
    }
    setStartSheet(kind);
  };
  // Unlike the general action wrapper, planning callers must receive failures
  // so their editable draft remains open for retry.
  const planningAction = async (fn: () => Promise<void>) => {
    if (busyRef.current) {
      throw new Error(
        tr(
          'Eine Aktion läuft noch. Bitte gleich erneut versuchen.',
          'An action is still running. Try again in a moment.',
        ),
      );
    }
    stateGeneration.current += 1;
    busyRef.current = true;
    setBusy(true);
    try {
      await fn();
    } finally {
      stateGeneration.current += 1;
      busyRef.current = false;
      setBusy(false);
    }
  };
  const saveSchedule = (next: ScheduleState) =>
    planningAction(async () => {
      await persist({
        schedule: normalizeSchedule(next),
        trainingDays: next.routine.days,
        minutes: next.routine.minutes,
      });
    });
  const startScheduled = (planned: ScheduledSession) =>
    planningAction(async () => {
      const latest = normalizeSchedule(stateRef.current.settings.schedule);
      const entry = latest.sessions.find(item => item.id === planned.id);
      const pending = pendingScheduleLink.current;
      if (
        entry &&
        pending?.entryId === entry.id &&
        !entry.activityId &&
        entry.status === 'planned'
      ) {
        try {
          await persist({
            schedule: {
              ...latest,
              sessions: latest.sessions.map(item =>
                item.id === entry.id
                  ? { ...item, activityId: pending.activityId }
                  : item,
              ),
            },
          });
          pendingScheduleLink.current = null;
        } catch {
          const message = tr(
            'Die Zuordnung konnte noch nicht gespeichert werden. Öffne Planung und tippe die Einheit erneut an.',
            'The link could not be saved yet. Open Plan and tap the session again.',
          );
          setError(message);
          throw new Error(message);
        }
        if (entry.kind === 'run') {
          switchTab('today');
        } else {
          setWorkoutOpen(true);
          setNow(Date.now());
        }
        return;
      }
      if (pending?.entryId === entry?.id && entry?.activityId) {
        pendingScheduleLink.current = null;
      }
      if (
        !entry ||
        entry.status !== 'planned' ||
        entry.date !== localDateKey()
      ) {
        throw new Error(
          tr(
            'Diese Einheit ist nicht für heute geplant. Verschiebe sie zuerst auf heute.',
            'This session is not planned for today. Move it to today first.',
          ),
        );
      }
      if (entry.activityId) {
        if (stateRef.current.recording?.id === entry.activityId) {
          switchTab('today');
          return;
        }
        if (strengthRef.current.active?.id === entry.activityId) {
          setWorkoutOpen(true);
          return;
        }
        throw new Error(
          tr(
            'Diese Einheit wurde bereits gestartet. Die Aufzeichnung findest du im Verlauf.',
            'This session was already started. Find the recording in History.',
          ),
        );
      }
      if (stateRef.current.recording || strengthRef.current.active) {
        throw new Error(
          tr(
            'Beende zuerst dein laufendes Training.',
            'Finish your running session first.',
          ),
        );
      }
      let activityId: string;
      if (entry.kind === 'run') {
        const active = await beginRecording(entry.purpose || 'free', 'running');
        activityId = active.id;
        pendingScheduleLink.current = { entryId: entry.id, activityId };
        switchTab('today');
      } else {
        const template = entry.templateId
          ? strengthRef.current.templates.find(
              item => item.id === entry.templateId,
            )
          : null;
        if (entry.templateId && !template) {
          throw new Error(
            tr(
              'Die Kraftvorlage fehlt. Wähle in der geplanten Einheit eine vorhandene Vorlage.',
              'The strength template is missing. Choose an existing template for the planned session.',
            ),
          );
        }
        const created = startSession(template ?? null, Date.now(), entry.title);
        const session = reviseSession(created, created);
        await native.saveStrengthSession(session);
        strengthRef.current = { ...strengthRef.current, active: session };
        setStrength(strengthRef.current);
        setWorkoutOpen(true);
        setNow(Date.now());
        activityId = session.id;
        pendingScheduleLink.current = { entryId: entry.id, activityId };
        await loadRecentSessions(strengthRef.current);
      }
      try {
        await persist({
          schedule: {
            ...latest,
            sessions: latest.sessions.map(item =>
              item.id === entry.id ? { ...item, activityId } : item,
            ),
          },
        });
        pendingScheduleLink.current = null;
      } catch {
        const message = tr(
          'Das Training läuft. Die Zuordnung konnte noch nicht gespeichert werden. Öffne Planung und tippe die Einheit erneut an.',
          'The session is running. The link could not be saved yet. Open Plan and tap the session again.',
        );
        setError(message);
        throw new Error(message);
      }
    });
  const stop = () => {
    const stopWords = sportWords(recording?.sport);
    Alert.alert(
      tr(`${stopWords.noun} beenden?`, `End ${stopWords.noun.toLowerCase()}?`),
      tr(
        `Deine bisherige Aufzeichnung wird gespeichert. Du kannst danach noch dein ${stopWords.feelingLabel} ergänzen.`,
        `Your recording so far is saved. You can add your ${stopWords.feelingLabel.toLowerCase()} afterwards.`,
      ),
      [
        { text: stopWords.continueLabel, style: 'cancel' },
        {
          text: tr('Beenden & speichern', 'End & save'),
          onPress: () => {
            void action(async () => {
              const id = recording?.id;
              await nativeCall('finishRun');
              const next = await refresh();
              if (features.recording.afterRun === 'home') {
                setMessage(
                  tr(
                    'Aufzeichnung gespeichert. Dein Gefühl kannst du im Verlauf nachtragen.',
                    'Recording saved. You can add your feeling later in History.',
                  ),
                );
                return;
              }
              setFeelingOnly(features.recording.afterRun === 'feeling');
              if (id) {
                setSelected(await native.run(id));
              } else if (next.runs[0]) {
                setSelected(await native.run(next.runs[0].id));
              }
            });
          },
        },
      ],
    );
  };
  const updateFeedback = (patch: any) => {
    if (!selected) {
      return;
    }
    const id = selected.id;
    void action(async () => {
      await native.feedback(id, patch);
      setSelected(await native.run(id));
      await refresh();
    });
  };
  const accept = (recommendation: AnyRecommendation) => {
    void action(async () => {
      const area = recommendationArea(recommendation);
      const next = acceptRecommendation(
        recommendation,
        Date.now(),
        area === 'running' ? experiment : strengthExperiment,
      );
      await persist({ experiments: [...(settings.experiments || []), next] });
      setSelected(null);
      openCoach(area);
    });
  };
  const changeExperiment = (
    status: ExperimentStatus,
    target: Experiment | undefined = experiment,
  ) => {
    if (!target) {
      return;
    }
    void action(async () => {
      const updated = transitionExperiment(
        target,
        status,
        Date.now(),
        // Stored in the experiment history in the language of the moment.
        tr('Vom Nutzer geändert', 'Changed by you'),
      );
      await persist({
        experiments: settings.experiments?.map(e =>
          e.id === updated.id ? updated : e,
        ),
      });
    });
  };
  const beginImport = (stayOnPage: boolean) => {
    void action(async () => {
      pendingScheduleLink.current = null;
      if (!stayOnPage) {
        setPage('data');
      }
      const timer = setInterval(() => {
        nativeCall<any>('getImportStatus')
          .then(setImportStatus)
          .catch(() => {});
      }, 700);
      try {
        // Only reads; saving happens after the choice in the "Review import" sheet.
        const result = await nativeCall<any>('importFiles');
        setImportStatus(result.cancelled ? null : result);
      } finally {
        clearInterval(timer);
      }
    });
  };
  const afterImportChange = async () => {
    // Templates are their own documents and do not change through imports.
    setImportRevision(value => value + 1);
    await refresh();
    setStrengthSessions(await native.strengthSessions(500));
    setStrengthHistoryAvailable(true);
    setImportBatches(await native.importBatches());
  };
  const commitImport = (choice: ImportChoice) => {
    const token = importStatus?.token;
    if (typeof token !== 'string') {
      return;
    }
    void action(async () => {
      const timer = setInterval(() => {
        nativeCall<any>('getImportStatus')
          .then(setImportStatus)
          .catch(() => {});
      }, 700);
      try {
        setImportStatus(await native.commitImport(token, choice));
      } finally {
        clearInterval(timer);
      }
      await afterImportChange();
    });
  };
  const discardImport = () => {
    const token = importStatus?.token;
    void action(async () => {
      if (typeof token === 'string') {
        await native.discardImport(token);
      }
      setImportStatus(null);
    });
  };
  const deleteImport = (batch: ImportBatch) => {
    void action(async () => {
      await native.deleteImportBatch(batch.id);
      setSelected(null);
      setSelectedSession(null);
      await afterImportChange();
      setMessage(tr('Import gelöscht.', 'Import deleted.'));
    });
  };
  const runImport = () => beginImport(false);
  const runVendorImport = () => beginImport(true);
  const cancelImport = () => {
    void nativeCall<any>('cancelImport')
      .then(setImportStatus)
      .catch(e => setError(e.message));
  };
  // Only counters that say something: "Imported" always, the rest from 1.
  const importSummary =
    importStatus && importStatus.state !== 'review'
      ? [
          tr(
            `Importiert: ${importStatus.imported ?? 0}`,
            `Imported: ${importStatus.imported ?? 0}`,
          ),
          ...(
            [
              [tr('Doppelt', 'Duplicates'), importStatus.duplicates],
              [tr('Keine Läufe', 'No runs'), importStatus.nonRunning],
              [tr('Übersprungen', 'Skipped'), importStatus.skipped],
              [tr('Fehlgeschlagen', 'Failed'), importStatus.failed],
              [tr('Kontextwerte', 'Context values'), importStatus.wellness],
              [tr('Krafteinheiten', 'Strength sessions'), importStatus.strength],
              [tr('Nicht gewählt', 'Not selected'), importStatus.excluded],
            ] as [string, number | undefined][]
          )
            .filter(([, count]) => (count ?? 0) > 0)
            .map(([label, count]) => `${label}: ${count}`),
        ].join(' · ')
      : '';
  // The run analysis applies only to runs. For other sports it does not appear
  // at all instead of showing wrong numbers (Spec T-1).
  const snapshot =
    selected && isRun(selected)
      ? analyzeRun(selected, experiment, runningRuns)
      : null;
  // The comparison with recent runs colors the tiles above; like the analysis,
  // it applies only to runs.
  const comparison =
    selected && isRun(selected)
      ? recentComparison(selected, runningRuns, snapshot?.pacing)
      : undefined;
  // Full hold-out/stability validation currently takes seconds to minutes.
  // Keep predictions locked until a validated result can be produced off the
  // UI thread and bound to the exact data/model version (model spec §11).
  const freshnessValues = useMemo(
    () =>
      Object.fromEntries(allRegionIds().map(id => [id, null])) as Record<
        RegionId,
        null
      >,
    [],
  );
  const latestSoreness = useMemo(
    () => [...sorenessReports].sort((a, b) => b.at - a.at)[0] ?? null,
    [sorenessReports],
  );
  const sorenessValues = useMemo(() => {
    const byId = new Map(
      latestSoreness?.entries.map(entry => [entry.regionId, entry.value]) ?? [],
    );
    return allRegionIds().reduce((values, id) => {
      values[id] = byId.get(id) ?? null;
      return values;
    }, {} as Record<RegionId, number | null>);
  }, [latestSoreness]);
  const openSorenessCapture = () => {
    setNow(Date.now());
    setSorenessOpen(true);
  };
  const transcribeSoreness = async () => {
    const capabilities = await native.requestSorenessVoicePermissions();
    setState(current => ({ ...current, capabilities }));
    if (!capabilities.microphonePermission) {
      throw new Error(
        tr(
          'Für die Spracheingabe fehlt die Mikrofonfreigabe. Tippen funktioniert unverändert.',
          'Voice input needs microphone access. Typing works as before.',
        ),
      );
    }
    if (!capabilities.speechRecognition) {
      throw new Error(
        tr(
          'Auf diesem Gerät ist keine Spracherkennung verfügbar.',
          'Speech recognition is not available on this device.',
        ),
      );
    }
    return native.transcribeSoreness();
  };
  const saveSoreness = (report: CapturedSorenessReport) => {
    void action(async () => {
      const next = await native.saveSorenessReport(report);
      setSorenessReports(next);
      setSorenessOpen(false);
      setMessage(tr('Muskelkatermeldung gespeichert.', 'Soreness report saved.'));
    });
  };

  // Start page: one question — what do I do now? The answer is a card with one
  // button. Below it only what counts today: the running recommendation, a
  // body check, the last two sessions. Focus, goal, templates, and the map have
  // their place in Coach, Plan, and History.
  const startPlannedRun = () => {
    if (todaysScheduledRun) {
      void startScheduled(todaysScheduledRun).catch(e => setError(e.message));
    }
  };
  const startPlannedStrength = () => {
    if (todaysScheduledStrength) {
      void startScheduled(todaysScheduledStrength).catch(e =>
        setError(e.message),
      );
    } else {
      startStrength(todaysTemplate);
    }
  };
  const targetRow = (nextPurpose: RunPurpose) =>
    features.recording.targets ? (
      <Row
        title={tr('Laufen nach', 'Run by')}
        subtitle={runTargetLabel(targetForPurpose(runTarget, nextPurpose))}
        onPress={() => {
          setStartSheet(null);
          openPage('run-target');
        }}
      />
    ) : null;
  const shortVerdict = (verdict: string | undefined) =>
    verdict === 'improved'
      ? tr('hat geholfen', 'helped')
      : verdict === 'worsened'
      ? tr('eher nicht geholfen', 'rather did not help')
      : verdict === 'no_relevant_effect'
      ? tr('kein Unterschied', 'no difference')
      : verdict === 'not_implemented'
      ? tr('noch nicht ausprobiert', 'not tried yet')
      : tr('noch nicht klar', 'not clear yet');
  const runEvaluation =
    experiment && runRecs
      ? evaluateExperiment(experiment, runningRuns, settings.adherence)
      : null;
  const strengthEvaluation =
    strengthExperiment && strengthRecs
      ? evaluateAnyExperiment(
          strengthExperiment,
          runningRuns,
          strengthSessions,
          settings.adherence,
        )
      : null;
  /** Compact card per area: state, progress; one tap leads to Coach. */
  const recommendationCard = (area: 'running' | 'strength') => {
    if (!recommendationsSuggested(features, area)) {
      return null;
    }
    const active = area === 'running' ? experiment : strengthExperiment;
    const evaluation = area === 'running' ? runEvaluation : strengthEvaluation;
    const proposal = area === 'running' ? candidate : strengthCandidate;
    const areaWord =
      area === 'running' ? tr('Läufen', 'runs') : tr('Einheiten', 'sessions');
    if (active && evaluation) {
      const minimum = active.recommendation.criteria.minimumObservations;
      const done = evaluation.eligibleRunIds.length;
      return (
        <Pressable
          key={area}
          accessibilityRole="button"
          accessibilityLabel={tr(
            `Empfehlung ${areaLabel(area)}: ${active.recommendation.action}`,
            `Recommendation ${areaLabel(area)}: ${active.recommendation.action}`,
          )}
          onPress={() => openCoach(area)}
          style={({ pressed }) => [
            styles.recommendationCard,
            pressed && styles.pressed,
          ]}
        >
          <View style={styles.recommendationHead}>
            <Text style={styles.recommendationTitle}>
              {active.recommendation.action}
            </Text>
            <Text style={styles.arrow}>›</Text>
          </View>
          <View style={styles.recommendationMeta}>
            <Badge muted={active.status === 'paused'}>
              {active.status === 'paused'
                ? tr('Pausiert', 'Paused')
                : tr('Aktiv', 'Active')}
            </Badge>
            <Text style={styles.muted}>
              {areaLabel(area)} ·{' '}
              {tr(
                `${done} von ${minimum} ${areaWord}`,
                `${done} of ${minimum} ${areaWord}`,
              )}{' '}
              · {shortVerdict(evaluation.verdict)}
            </Text>
          </View>
          <Progress
            value={minimum ? done / minimum : 0}
            label={tr(
              `${done} von ${minimum} geeigneten ${areaWord}`,
              `${done} of ${minimum} suitable ${areaWord}`,
            )}
          />
        </Pressable>
      );
    }
    if (proposal) {
      return (
        <Pressable
          key={area}
          accessibilityRole="button"
          accessibilityLabel={tr(
            `Vorschlag ${areaLabel(area)}: ${proposal.action}`,
            `Suggestion ${areaLabel(area)}: ${proposal.action}`,
          )}
          onPress={() => openCoach(area)}
          style={({ pressed }) => [
            styles.recommendationCard,
            pressed && styles.pressed,
          ]}
        >
          <View style={styles.recommendationHead}>
            <Text style={styles.recommendationTitle}>{proposal.action}</Text>
            <Text style={styles.arrow}>›</Text>
          </View>
          <View style={styles.recommendationMeta}>
            <Badge>{tr('Vorschlag', 'Suggestion')}</Badge>
            <Text style={styles.muted}>
              {areaLabel(area)} ·{' '}
              {tr(
                'Prüfe, ob er zu dir passt.',
                'Check whether it fits you.',
              )}
            </Text>
          </View>
        </Pressable>
      );
    }
    return null;
  };
  const reportedToday = sorenessReports.some(
    report => localDateKey(report.at) === todayKey,
  );
  // Week strip: seven days, one dot per day — green for a recorded session,
  // gray for a planned one. One tap opens Plan.
  const weekStrip = () => {
    const monday = startOfWeek(todayKey);
    const doneDays = new Set(units.map(unit => localDateKey(unit.at)));
    const plannedDays = new Set(
      schedule.sessions
        .filter(item => item.status === 'planned' && !item.activityId)
        .map(item => item.date),
    );
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={tr(
          'Diese Woche im Plan ansehen',
          'View this week in Plan',
        )}
        onPress={() => switchTab('plan')}
        style={({ pressed }) => [styles.weekStrip, pressed && styles.pressed]}
      >
        {weekdayShortLabels().map((label, index) => {
          const key = addCalendarDays(monday, index);
          const dayNumber = Number(key.slice(-2));
          const isToday = key === todayKey;
          return (
            <View
              key={key}
              style={[styles.weekDay, isToday && styles.weekDayToday]}
            >
              <Text style={styles.weekDayNumber}>{dayNumber}</Text>
              <Text style={styles.weekDayLabel}>{label}</Text>
              <View
                style={[
                  styles.weekDot,
                  doneDays.has(key)
                    ? styles.weekDotDone
                    : plannedDays.has(key)
                    ? styles.weekDotPlanned
                    : null,
                ]}
              />
            </View>
          );
        })}
      </Pressable>
    );
  };
  const nextPlanned = schedule.sessions
    .filter(
      item =>
        item.status === 'planned' && !item.activityId && item.date > todayKey,
    )
    .sort((a, b) => a.date.localeCompare(b.date))[0];
  const todaysLinked = schedule.sessions.filter(
    item => item.date === todayKey && item.activityId,
  );
  const linkedUnit = (activityId: string) =>
    units.find(unit =>
      unit.kind === 'run'
        ? unit.run.id === activityId || unit.run.canonicalId === activityId
        : unit.session.id === activityId,
    );
  const renderHero = () => {
    if (strength.active) {
      const minutes = Math.max(
        1,
        Math.round((Date.now() - strength.active.startTime) / 60000),
      );
      return (
        <Card style={styles.hero}>
          <Text style={styles.heroLabel}>
            {tr('Training läuft', 'Session running')}
          </Text>
          <Text style={styles.heroTitle}>
            {displaySessionName(strength.active.name)}
          </Text>
          <Copy muted>
            {tr(
              `Krafttraining · seit ${minutes} Minuten`,
              `Strength training · ${minutes} ${minutes === 1 ? 'minute' : 'minutes'} so far`,
            )}
          </Copy>
          <Button
            title={tr('Training fortsetzen', 'Continue session')}
            onPress={() => {
              setNow(Date.now());
              setWorkoutOpen(true);
            }}
          />
        </Card>
      );
    }
    // Without the running area, "something else" starts directly at strength training.
    const otherKind: StartKind = sports.length ? 'run' : 'strength';
    if (todaysScheduledRun && showRunning) {
      const plannedPurpose = todaysScheduledRun.purpose || 'free';
      return (
        <Card style={styles.hero}>
          <Text style={styles.heroLabel}>
            {tr('Heute geplant', 'Planned for today')}
          </Text>
          <Text style={styles.heroTitle}>
            {scheduleTitle(todaysScheduledRun)}
          </Text>
          <Copy muted>
            {tr(
              `Lauf · ${todaysScheduledRun.minutes} Min`,
              `Run · ${todaysScheduledRun.minutes} min`,
            )}{' '}
            · {purposeLabel(plannedPurpose)}
          </Copy>
          {targetRow(plannedPurpose)}
          <Button
            title={tr('Lauf starten', 'Start run')}
            onPress={startPlannedRun}
            disabled={busy}
          />
          {todaysScheduledStrength && showStrength ? (
            <Row
              title={scheduleTitle(todaysScheduledStrength)}
              subtitle={tr(
                `Krafttraining · ${todaysScheduledStrength.minutes} Min · ebenfalls heute`,
                `Strength training · ${todaysScheduledStrength.minutes} min · also today`,
              )}
              onPress={startPlannedStrength}
            />
          ) : null}
          <Button
            secondary
            small
            title={tr(
              'Stattdessen etwas anderes starten',
              'Start something else instead',
            )}
            onPress={() => openStartSheet(otherKind)}
            disabled={busy}
          />
        </Card>
      );
    }
    if (showStrength && (todaysScheduledStrength || todaysTemplate)) {
      const title = todaysScheduledStrength
        ? scheduleTitle(todaysScheduledStrength)
        : todaysTemplate!.name;
      const exerciseCount = todaysTemplate?.exercises.length ?? 0;
      return (
        <Card style={styles.hero}>
          <Text style={styles.heroLabel}>
            {todaysScheduledStrength
              ? tr('Heute geplant', 'Planned for today')
              : tr('Heute vorgesehen', 'Set for today')}
          </Text>
          <Text style={styles.heroTitle}>{title}</Text>
          <Copy muted>
            {tr('Krafttraining', 'Strength training')}
            {todaysScheduledStrength
              ? tr(
                  ` · ${todaysScheduledStrength.minutes} Min`,
                  ` · ${todaysScheduledStrength.minutes} min`,
                )
              : ''}
            {exerciseCount
              ? ` · ${counted(
                  exerciseCount,
                  tr('Übung', 'exercise'),
                  tr('Übungen', 'exercises'),
                )}`
              : ''}
          </Copy>
          <Button
            title={tr('Training starten', 'Start session')}
            onPress={startPlannedStrength}
            disabled={busy}
          />
          <Button
            secondary
            small
            title={tr(
              'Stattdessen etwas anderes starten',
              'Start something else instead',
            )}
            onPress={() => openStartSheet(otherKind)}
            disabled={busy}
          />
        </Card>
      );
    }
    if (todaysLinked.length) {
      const first = linkedUnit(todaysLinked[0].activityId!);
      return (
        <Card style={styles.hero}>
          <Text style={styles.heroLabel}>
            {tr('Heute erledigt ✓', 'Done today ✓')}
          </Text>
          <Text style={styles.heroTitle}>
            {first ? unitTitle(first) : scheduleTitle(todaysLinked[0])}
          </Text>
          <Copy muted>
            {first
              ? `${unitKindLabel(first)} · ${unitSummary(first)}`
              : tr(
                  'Gestartet, noch nicht abgeschlossen.',
                  'Started, not finished yet.',
                )}
          </Copy>
          <Button
            secondary
            title={tr('Noch eine Einheit starten', 'Start another workout')}
            onPress={() => openStartSheet(otherKind)}
            disabled={busy}
          />
        </Card>
      );
    }
    return (
      <Card style={styles.hero}>
        <Text style={styles.heroTitle}>{tr('Heute frei', 'Free today')}</Text>
        {nextPlanned ? (
          <Copy muted>
            {tr(
              `Als Nächstes: ${nextPlanned.title} · ${date(
                new Date(`${nextPlanned.date}T12:00:00`).getTime(),
              )}`,
              `Up next: ${nextPlanned.title} · ${date(
                new Date(`${nextPlanned.date}T12:00:00`).getTime(),
              )}`,
            )}
          </Copy>
        ) : null}
        {sports.length ? (
          <Button
            title={tr(
              `${words.noun} starten`,
              `Start ${words.noun.toLowerCase()}`,
            )}
            onPress={() => openStartSheet('run')}
            disabled={busy}
          />
        ) : null}
        {showStrength ? (
          <Button
            secondary={sports.length > 0}
            title={tr('Krafttraining starten', 'Start strength training')}
            onPress={() => openStartSheet('strength')}
            disabled={busy}
          />
        ) : null}
      </Card>
    );
  };
  // Today shows the recommendation for the session that is up next — never both
  // stacked (Spec "Two areas"). If it is missing, the other area's is shown.
  const heroArea: 'running' | 'strength' =
    strength.active ||
    (!todaysScheduledRun && (todaysScheduledStrength || todaysTemplate))
      ? 'strength'
      : 'running';
  const renderHome = () => (
    <>
      <Title>{tr('Heute', 'Today')}</Title>
      {homeSections.includes('week') ? weekStrip() : null}
      {renderHero()}
      {!settings.features && settings.onboardedAt ? (
        <Row
          title={tr(
            'Neu: Wähle, was Runback zeigt',
            'New: choose what Runback shows',
          )}
          subtitle={tr(
            'Bereiche, Muskelkater, Plan und mehr abwählen',
            'Deselect areas, soreness, Plan, and more',
          )}
          onPress={() => openPage('features')}
        />
      ) : null}
      {homeSections.includes('recommendation')
        ? recommendationCard(heroArea) ??
          recommendationCard(heroArea === 'running' ? 'strength' : 'running')
        : null}
      {homeSections.includes('goal') &&
      showRunning &&
      racePrediction.status !== 'no_goal' ? (
        <GoalProgress
          prediction={racePrediction}
          compact
          onEdit={() => openPage('goal')}
        />
      ) : null}
      {homeSections.includes('body') &&
      sorenessStorageAvailable &&
      !reportedToday ? (
        <Row
          title={tr('Wie fühlst du dich heute?', 'How do you feel today?')}
          subtitle={
            latestSoreness
              ? tr(
                  `Muskelkater melden · zuletzt ${date(latestSoreness.at)}`,
                  `Report soreness · last ${date(latestSoreness.at)}`,
                )
              : tr('Muskelkater melden', 'Report soreness')
          }
          onPress={openSorenessCapture}
        />
      ) : null}
      {!homeSections.includes('recent') ? null : units.length ? (
        <Section title={tr('Zuletzt', 'Recent')}>
          {units.slice(0, 2).map(unit => (
            <Row
              key={unit.key}
              title={unitTitle(unit)}
              subtitle={`${unitKindLabel(unit)} · ${unitSummary(unit)}`}
              onPress={() => openUnit(unit)}
            />
          ))}
          {units.length > 2 ? (
            <Row
              title={tr('Alle Einheiten', 'All workouts')}
              subtitle={counted(
                units.length,
                tr('Einheit', 'workout'),
                tr('Einheiten', 'workouts'),
              )}
              onPress={() => switchTab('history')}
            />
          ) : null}
        </Section>
      ) : (
        <EmptyState
          title={tr('Noch keine Einheit', 'No workouts yet')}
          copy={tr(
            'Dein erster Lauf und dein erstes Krafttraining erscheinen hier. Vorhandene Historie importierst du in den Einstellungen unter „Deine Daten“.',
            'Your first run and first strength session appear here. Import existing history in Settings under “Your data”.',
          )}
        />
      )}
    </>
  );

  // Start sheet: everything that describes a recording, in one place — with the
  // last choice as the default. Normally: one tap, then "Go".
  const startKindValue: 'running' | 'cycling' | 'strength' =
    startSheet === 'strength' ? 'strength' : sport;
  const startKinds = startKindOptions().filter(kind =>
    kind.value === 'strength' ? showStrength : sports.includes(kind.value),
  );
  const selectedTemplate = features.templates.enabled
    ? strength.templates.find(item => item.id === startTemplateId) ?? null
    : null;
  const startFromSheet = () => {
    if (startSheet === 'strength') {
      setStartSheet(null);
      if (
        todaysScheduledStrength &&
        (todaysScheduledStrength.templateId ?? null) ===
          (selectedTemplate?.id ?? null)
      ) {
        startPlannedStrength();
      } else {
        startStrength(selectedTemplate);
      }
      return;
    }
    setStartSheet(null);
    start();
  };
  const renderStartSheet = () => (
    <Sheet
      visible={Boolean(startSheet)}
      title={tr('Was startest du?', 'What are you starting?')}
      onClose={() => setStartSheet(null)}
    >
      {startKinds.length > 1 ? (
        <Segmented
          label={tr('Art der Einheit', 'Type of workout')}
          options={startKinds}
          value={startKindValue}
          onChange={value => {
            if (value === 'strength') {
              openStartSheet('strength');
            } else {
              setStartSheet('run');
              save({ sport: value });
            }
          }}
        />
      ) : null}
      {startSheet === 'strength' ? (
        <>
          {(features.templates.enabled ? strength.templates : []).map(item => (
            <Row
              key={item.id}
              title={item.name}
              subtitle={`${counted(
                item.exercises.length,
                tr('Übung', 'exercise'),
                tr('Übungen', 'exercises'),
              )}${
                todaysScheduledStrength?.templateId === item.id ||
                (!todaysScheduledStrength && todaysTemplate?.id === item.id)
                  ? tr(' · heute vorgesehen', ' · set for today')
                  : ''
              }`}
              onPress={() => setStartTemplateId(item.id)}
              trailing={
                <Text style={styles.greenText}>
                  {startTemplateId === item.id ? '✓' : ''}
                </Text>
              }
            />
          ))}
          <Row
            title={tr('Frei trainieren', 'Train freely')}
            subtitle={tr(
              'Übungen während der Einheit wählen',
              'Choose exercises during the session',
            )}
            onPress={() => setStartTemplateId(null)}
            trailing={
              <Text style={styles.greenText}>
                {startTemplateId === null ? '✓' : ''}
              </Text>
            }
          />
          {features.templates.enabled ? (
            <Row
              title={tr('Vorlagen verwalten', 'Manage templates')}
              onPress={() => {
                setStartSheet(null);
                setTemplatesView('strength');
                openPage('templates');
              }}
            />
          ) : null}
        </>
      ) : (
        <>
          {features.templates.enabled && settings.presets?.length ? (
            <Field label={tr('Vorlage', 'Template')}>
              <ChipGroup
                label={tr('Laufvorlage', 'Run template')}
                options={[
                  ...settings.presets.map(p => ({
                    value: p.id,
                    label: p.name,
                  })),
                  { value: '', label: tr('Ohne', 'None') },
                ]}
                value={
                  settings.presets.find(
                    p =>
                      p.purpose === purpose &&
                      p.minutes === (settings.minutes || 30),
                  )?.id ?? ''
                }
                onChange={id => {
                  const preset = settings.presets?.find(p => p.id === id);
                  if (preset) {
                    save({
                      purpose: preset.purpose,
                      minutes: preset.minutes,
                      cues: preset.cues,
                    });
                  }
                }}
                disabled={busy}
              />
            </Field>
          ) : null}
          <Field label={tr('Wie willst du laufen?', 'How do you want to run?')}>
            <ChipGroup
              label={tr('Laufart dieser Aufzeichnung', 'Run type for this recording')}
              options={purposes.map(p => ({
                value: p.value,
                label: p.label,
              }))}
              value={selectablePurpose(purpose)}
              onChange={value => save({ purpose: value })}
              disabled={busy}
            />
            <Copy muted>
              {
                purposes.find(p => p.value === selectablePurpose(purpose))
                  ?.description
              }
            </Copy>
          </Field>
          {sport === 'running' ? targetRow(purpose) : null}
          {sport === 'running' ? (
            // The carry position rarely changes: collapsed, with the last choice as value.
            <Disclosure
              title={tr('Handy', 'Phone position')}
              subtitle={
                PHONE_PLACEMENTS.find(
                  item =>
                    item.value === normalizePlacement(settings.gaitPlacement),
                )?.label
              }
            >
              <ChipGroup
                label={tr(
                  'Wo das Handy beim Laufen steckt',
                  'Where the phone is carried while running',
                )}
                options={PHONE_PLACEMENTS}
                value={normalizePlacement(settings.gaitPlacement)}
                onChange={value => save({ gaitPlacement: value })}
                disabled={busy}
              />
            </Disclosure>
          ) : null}
        </>
      )}
      <Button
        title={
          startSheet === 'strength'
            ? tr('Training starten', 'Start session')
            : tr('Aufzeichnung starten', 'Start recording')
        }
        onPress={startFromSheet}
        disabled={busy}
      />
    </Sheet>
  );

  // Add run types afterwards: one run per step, newest first. Moving on happens
  // only once the choice is saved; skipped ones stay open and are named at the
  // end.
  const purposeOpen = runningRuns.filter(purposeMissing);
  const purposeQueue = purposeOpen.filter(
    run => !purposeSkipped.includes(run.id),
  );
  const purposeRun = purposeQueue[0];
  const renderPurposeSheet = () => (
    <Sheet
      visible={purposeSheet}
      title={tr('Laufart nachtragen', 'Add run type')}
      onClose={() => setPurposeSheet(false)}
    >
      {error ? (
        <Notice
          title={tr('Nicht gespeichert', 'Not saved')}
          onDismiss={() => setError('')}
        >
          {error}
        </Notice>
      ) : null}
      {purposeRun ? (
        <>
          <Copy muted>
            {tr(
              `Noch ${counted(purposeQueue.length, 'Lauf', 'Läufe')} ohne Laufart`,
              `Still ${counted(purposeQueue.length, 'run', 'runs')} without a run type`,
            )}
          </Copy>
          <Row
            title={runTitle(purposeRun)}
            subtitle={`${date(purposeRun.startTime)} · ${distance(
              purposeRun,
            )} km · ${tempoValue(purposeRun)} ${tempoUnit(purposeRun)}`}
          />
          <ChipGroup
            label={tr(
              `Laufart von ${runTitle(purposeRun)}`,
              `Run type for ${runTitle(purposeRun)}`,
            )}
            options={purposes.map(p => ({ value: p.value, label: p.label }))}
            value={selectablePurpose(purposeRun.purpose)}
            disabled={busy}
            onChange={value => {
              void action(async () => {
                await native.feedback(purposeRun.id, {
                  purpose: value,
                  purposeConfirmed: true,
                  purposeHint: null,
                });
                await refresh();
              });
            }}
          />
          <Button
            secondary
            small
            title={tr('Überspringen', 'Skip')}
            disabled={busy}
            onPress={() =>
              setPurposeSkipped(current => [...current, purposeRun.id])
            }
          />
        </>
      ) : (
        <>
          <Copy>
            {purposeOpen.length
              ? tr(
                  `Durchgesehen. ${counted(
                    purposeOpen.length,
                    'Lauf bleibt',
                    'Läufe bleiben',
                  )} ohne Laufart.`,
                  `Reviewed. ${counted(
                    purposeOpen.length,
                    'run stays',
                    'runs stay',
                  )} without a run type.`,
                )
              : tr(
                  'Jeder Lauf hat jetzt eine Laufart.',
                  'Every run now has a run type.',
                )}
          </Copy>
          <Button
            title={tr('Fertig', 'Done')}
            onPress={() => setPurposeSheet(false)}
          />
        </>
      )}
    </Sheet>
  );

  // Plus and minus change only the target of this run; the saved default for
  // the next run stays as the user chose it in Coach.
  const changeTargetPace = (direction: 1 | -1) => {
    void action(async () => {
      const target = stateRef.current.recording?.target;
      if (target?.kind !== 'pace') return;
      const next = stepTargetPace(target.secondsPerKm, direction);
      if (next === null) return;
      const updated = normalizeRun(await nativeCall('setRunTargetPace', next));
      stateRef.current = { ...stateRef.current, recording: updated };
      setState(stateRef.current);
    });
  };
  const renderRecording = () => {
    if (!recording) {
      return null;
    }
    const recordingWords = sportWords(recording.sport);
    const { primary, metrics } = features.recording;
    const secondary = [
      primary !== 'duration',
      metrics.includes('distance') && primary !== 'distance',
      metrics.includes('pace'),
    ].filter(Boolean);
    return (
      <>
        <View style={styles.recordingHeader}>
          <Text style={styles.title}>
            {recording.status === 'recording'
              ? tr(
                  `${recordingWords.noun} läuft`,
                  `${recordingWords.noun} in progress`,
                )
              : recording.status === 'paused'
              ? tr(
                  `${recordingWords.noun} pausiert`,
                  `${recordingWords.noun} paused`,
                )
              : tr(
                  `${recordingWords.noun} unterbrochen`,
                  `${recordingWords.noun} interrupted`,
                )}
          </Text>
          <Copy muted>{purposeLabel(recording.purpose)}</Copy>
        </View>
        <View style={styles.bigMetric}>
          {primary === 'distance' ? (
            <Stat
              large
              value={distance(recording)}
              label={tr('Kilometer', 'Kilometers')}
            />
          ) : primary === 'heartRate' ? (
            <Stat
              large
              value={
                recording.avgHeartRate
                  ? String(Math.round(recording.avgHeartRate))
                  : '–'
              }
              label={tr('Ø bpm', 'Avg bpm')}
            />
          ) : (
            <Stat
              large
              value={duration(recording.durationSeconds)}
              label={recordingWords.durationLabel}
            />
          )}
        </View>
        {secondary.length ? (
          <View style={styles.metrics}>
            {primary !== 'duration' ? (
              <Stat
                value={duration(recording.durationSeconds)}
                label={recordingWords.durationLabel}
              />
            ) : null}
            {metrics.includes('distance') && primary !== 'distance' ? (
              <Stat
                value={distance(recording)}
                label={tr('Kilometer', 'Kilometers')}
              />
            ) : null}
            {metrics.includes('pace') ? (
              <Stat
                value={tempoValue(recording)}
                label={tempoLabel(recording)}
              />
            ) : null}
          </View>
        ) : null}
        {metrics.includes('heartRate') && primary !== 'heartRate' ? (
          <Row
            title={tr('Herzfrequenz', 'Heart rate')}
            trailing={
              <Copy>
                {recording.avgHeartRate
                  ? `${Math.round(recording.avgHeartRate)} bpm`
                  : tr('Keine Daten', 'No data')}
              </Copy>
            }
          />
        ) : null}
        {metrics.includes('target') &&
        recording.target &&
        recording.target.kind !== 'none' ? (
          <Row
            title={tr('Laufen nach', 'Run by')}
            subtitle={runTargetLabel(recording.target)}
            trailing={
              recording.target.kind === 'pace' ? (
                <Stepper
                  decreaseLabel={tr(
                    `Zieltempo ${PACE_STEP_SECONDS} Sekunden schneller`,
                    `Target pace ${PACE_STEP_SECONDS} seconds faster`,
                  )}
                  increaseLabel={tr(
                    `Zieltempo ${PACE_STEP_SECONDS} Sekunden langsamer`,
                    `Target pace ${PACE_STEP_SECONDS} seconds slower`,
                  )}
                  canDecrease={
                    stepTargetPace(recording.target.secondsPerKm, -1) !== null
                  }
                  canIncrease={
                    stepTargetPace(recording.target.secondsPerKm, 1) !== null
                  }
                  disabled={busy}
                  onDecrease={() => changeTargetPace(-1)}
                  onIncrease={() => changeTargetPace(1)}
                />
              ) : undefined
            }
          />
        ) : null}
        <WearRecordingRow run={recording} />
        {recording.distanceMeters > 0 ? null : (
          <Copy muted>
            {tr(
              'Noch keine Strecke gemessen. Geh für GPS nach draußen.',
              'No distance measured yet. Go outside for GPS.',
            )}
          </Copy>
        )}
        {recording.status === 'interrupted' ? (
          <Copy>
            {tr(
              'Die Aufzeichnung wurde unterbrochen. Die Lücke bleibt in deinen Daten erkennbar.',
              'The recording was interrupted. The gap stays visible in your data.',
            )}
          </Copy>
        ) : null}
        {experiment?.status === 'active' &&
        runRecsSuggested &&
        isRun(recording) ? (
          <Section title={tr('Für diesen Lauf', 'For this run')}>
            <Copy>{experiment.recommendation.action}</Copy>
          </Section>
        ) : null}
        <View style={styles.recordingActions}>
          <Button
            title={
              recording.status === 'recording'
                ? tr('Pause', 'Pause')
                : tr('Fortsetzen', 'Resume')
            }
            disabled={busy}
            onPress={() => {
              void action(async () => {
                await nativeCall(
                  recording.status === 'recording' ? 'pauseRun' : 'resumeRun',
                );
                await refresh();
              });
            }}
          />
          <Button
            secondary
            title={tr(
              `${recordingWords.noun} beenden`,
              `End ${recordingWords.noun.toLowerCase()}`,
            )}
            onPress={stop}
            disabled={busy}
          />
        </View>
      </>
    );
  };

  // Test criteria stay traceable, but sit behind a switch: the page shows the
  // action, not the method.
  const renderCriteria = (recommendation: Recommendation, accepted = false) => (
    <>
      <Copy>
        {tr(
          'Woran erkennen wir, dass es geholfen hat?',
          'How will we know it helped?',
        )}
      </Copy>
      <Copy muted>{recommendation.goal}</Copy>
      <Copy muted>
        {accepted
          ? tr(
              'Vor dem Start festgelegt. Ein Fokuswechsel ändert diese Regeln nicht.',
              'Set before the start. A focus change does not alter these rules.',
            )
          : tr(
              'Bei der Annahme werden diese Regeln festgeschrieben.',
              'Accepting locks in these rules.',
            )}
      </Copy>
      <Copy muted>
        {tr('Ab', 'From')} {recommendation.criteria.minimumObservations}{' '}
        {tr('geeigneten Läufen über', 'suitable runs over')}{' '}
        {recommendation.criteria.minimumDays}{' '}
        {tr(
          'Tage · Vorzeichentest: häufiger als zufällig mindestens',
          'days · sign test: more often than chance, at least',
        )}{' '}
        {recommendation.criteria.minimumRelevantChangePercentPoints}{' '}
        {tr(
          'Prozentpunkte weniger Tempoabfall als der Median der Vergleichsläufe (',
          'percentage points less pace fade than the median of the comparison runs (',
        )}
        {number(recommendation.criteria.baselineFadePercent, 1)}{percentSign()})
      </Copy>
      {recommendation.criteria.exclusions.map((text, i) => (
        <Copy muted key={i}>
          {text}
        </Copy>
      ))}
      <Row
        title={tr('Modellversion', 'Model version')}
        subtitle={recommendation.model_version}
      />
      <Copy muted>
        {tr(
          `Wenn nach ${recommendation.criteria.maxDays} Tagen noch zu wenig vergleichbare Läufe vorliegen, entscheide neu, wie du weitertrainieren möchtest.`,
          `If there are still too few comparable runs after ${recommendation.criteria.maxDays} days, decide again how you want to keep training.`,
        )}
      </Copy>
      <Section title={tr('Vergleichsläufe', 'Comparison runs')}>
        <Copy muted>
          {tr(
            'Die Basis ist der Median dieser Läufe, nicht ein einzelner Ausreißer.',
            'The baseline is the median of these runs, not a single outlier.',
          )}
        </Copy>
        {recommendation.criteria.baselineRunIds.map(id => {
          const run = runningRuns.find(item => item.id === id);
          return (
            <Row
              key={id}
              title={
                run
                  ? runTitle(run)
                  : tr(
                      'Vergleichslauf nicht mehr vorhanden',
                      'Comparison run no longer exists',
                    )
              }
              subtitle={run ? date(run.startTime) : undefined}
            />
          );
        })}
      </Section>
      <Section title={tr('So priorisiert Runback', 'How Runback prioritizes')}>
        {recommendation.priority ? (
          <Row
            title={recommendation.priority.focusLabel}
            subtitle={tr(
              `${recommendation.priority.version} · redaktionelles Gewicht ${recommendation.priority.weight}`,
              `${recommendation.priority.version} · editorial weight ${recommendation.priority.weight}`,
            )}
          />
        ) : (
          <Copy muted>
            {tr(
              'Für diese ältere Empfehlung wurde keine Fokus-Priorisierung gespeichert.',
              'No focus prioritization was saved for this older recommendation.',
            )}
          </Copy>
        )}
        <Copy muted>
          {tr(
            'Die Auswahlregeln sind redaktionell festgelegt. Sie lernen keine Vorlieben aus deinen Läufen.',
            'The selection rules are set by the editors. They do not learn preferences from your runs.',
          )}
        </Copy>
        <Copy muted>
          {tr(
            'Derzeit ist nur der ruhigere Start als überprüfbare Empfehlung verfügbar. Pulsverlauf und Schrittfrequenz liefern noch keine eigenen Empfehlungen.',
            'Currently only the easier start is available as a testable recommendation. Heart rate trace and stride rate do not yet produce their own recommendations.',
          )}
        </Copy>
      </Section>
    </>
  );

  const storedRunTitle = (id: string) => {
    const run = runningRuns.find(item => item.id === id);
    return run ? runTitle(run) : tr('Lauf nicht mehr vorhanden', 'Run no longer exists');
  };
  // Same reason, same line: 28 runs without a run type is one finding.
  const groupedAlternatives = () => {
    const groups = new Map<
      string,
      { key: string; title: string; reason: string; runIds: string[] }
    >();
    selection.alternatives.forEach(item => {
      const title =
        item.recommendation?.title || tr('Starteinteilung', 'Pacing plan');
      const key = `${title}\u0000${item.reason}`;
      const group = groups.get(key) ?? {
        key,
        title,
        reason: item.reason,
        runIds: [],
      };
      group.runIds.push(item.runId);
      groups.set(key, group);
    });
    return [...groups.values()];
  };
  const renderAlternatives = () => (
    <Section
      title={
        experiment
          ? tr('Auswahl für danach', 'Up next')
          : tr('Andere geprüfte Möglichkeiten', 'Other options checked')
      }
    >
      {selection.alternatives.length ? (
        groupedAlternatives().map(group => (
          <Row
            key={group.key}
            title={`${group.title} · ${
              group.runIds.length === 1
                ? storedRunTitle(group.runIds[0])
                : counted(
                    group.runIds.length,
                    tr('Lauf', 'run'),
                    tr('Läufe', 'runs'),
                  )
            }`}
            subtitle={group.reason}
          />
        ))
      ) : (
        <Copy muted>
          {tr(
            'Keine weitere Möglichkeit aus den vorhandenen Daten geprüft.',
            'No further option was checked against the existing data.',
          )}
        </Copy>
      )}
    </Section>
  );
  // Strength training has its own recommendation page: the same three questions,
  // the same states, but checked on sessions and sets instead of runs.
  const sessionTitle = (id: string) => {
    const session = strengthSessions.find(item => item.id === id);
    return session
      ? `${displaySessionName(session.name)} · ${date(session.startTime)}`
      : tr('Einheit nicht mehr vorhanden', 'Session no longer exists');
  };
  const renderStrengthCriteria = (
    recommendation: StrengthRecommendation,
    accepted = false,
  ) => (
    <>
      <Copy>
        {tr(
          'Woran erkennen wir, dass es geholfen hat?',
          'How will we know it helped?',
        )}
      </Copy>
      <Copy muted>{recommendation.goal}</Copy>
      <Copy muted>
        {accepted
          ? tr(
              'Vor dem Start festgelegt. Ein Fokuswechsel ändert diese Regeln nicht.',
              'Set before the start. A focus change does not alter these rules.',
            )
          : tr(
              'Bei der Annahme werden diese Regeln festgeschrieben.',
              'Accepting locks in these rules.',
            )}
      </Copy>
      <Copy muted>
        {tr('Ab', 'From')} {recommendation.criteria.minimumObservations}{' '}
        {tr('passenden Einheiten', 'suitable sessions')} ·{' '}
        {tr('Zielbereich', 'Target range')}{' '}
        {number(recommendation.criteria.targetMinKg, 1)}–
        {number(recommendation.criteria.targetMaxKg, 1)} kg ×{' '}
        {recommendation.criteria.targetReps} ·{' '}
        {tr(
          'Vorzeichentest: häufiger als zufällig mindestens',
          'sign test: more often than chance, at least',
        )}{' '}
        {recommendation.criteria.minimumRelevantChangePercent}{percentSign()}{' '}
        {tr(
          'über dem Median der Vergleichseinheiten',
          'above the median of the comparison sessions',
        )}
      </Copy>
      {recommendation.criteria.exclusions.map((text, i) => (
        <Copy muted key={i}>
          {text}
        </Copy>
      ))}
      {recommendation.criteria.stopConditions.map((text, i) => (
        <Copy muted key={`stop-${i}`}>
          {text}
        </Copy>
      ))}
      <Row
        title={tr('Modellversion', 'Model version')}
        subtitle={recommendation.model_version}
      />
      <Copy muted>
        {tr(
          `Wenn nach ${recommendation.criteria.maxDays} Tagen noch zu wenig passende Einheiten vorliegen, entscheide neu.`,
          `If there are still too few suitable sessions after ${recommendation.criteria.maxDays} days, decide again.`,
        )}
      </Copy>
      <Section title={tr('Vergleichseinheiten', 'Comparison sessions')}>
        {recommendation.criteria.baselineSessionIds.map(id => (
          <Row key={id} title={sessionTitle(id)} />
        ))}
      </Section>
      <Section title={tr('So priorisiert Runback', 'How Runback prioritizes')}>
        {recommendation.priority ? (
          <Row
            title={recommendation.priority.focusLabel}
            subtitle={tr(
              `${recommendation.priority.version} · redaktionelles Gewicht ${recommendation.priority.weight}`,
              `${recommendation.priority.version} · editorial weight ${recommendation.priority.weight}`,
            )}
          />
        ) : null}
        <Copy muted>
          {tr(
            'Die Auswahlregeln sind redaktionell festgelegt. Sie lernen keine Vorlieben aus deinen Einheiten. Derzeit ist nur die Last einer Übung als überprüfbare Empfehlung verfügbar.',
            'The selection rules are set by the editors. They do not learn preferences from your sessions. Currently only the load of one exercise is available as a testable recommendation.',
          )}
        </Copy>
      </Section>
    </>
  );
  const renderStrengthAlternatives = () => (
    <Section
      title={
        strengthExperiment
          ? tr('Auswahl für danach', 'Up next')
          : tr('Andere geprüfte Möglichkeiten', 'Other options checked')
      }
    >
      {strengthSelection.alternatives.length ? (
        strengthSelection.alternatives.map(item => (
          <Row
            key={item.exerciseId}
            title={exerciseDisplayName(item.exerciseId, item.exerciseName)}
            subtitle={item.reason}
          />
        ))
      ) : (
        <Copy muted>
          {tr(
            'Keine weitere Möglichkeit aus den vorhandenen Einheiten geprüft.',
            'No further option was checked against the existing sessions.',
          )}
        </Copy>
      )}
    </Section>
  );
  // Coach: the one recommendation per area as a state card — label, progress,
  // two questions. Details and management are collapsed so the recommendation
  // itself stays the largest area. Below it the basis (focus, goal) and the ways
  // to ask questions.
  const manageButtons = (target: Experiment) => (
    <>
      <Button
        secondary
        small
        disabled={busy}
        title={
          target.status === 'paused'
            ? tr('Empfehlung fortsetzen', 'Resume recommendation')
            : tr('Empfehlung pausieren', 'Pause recommendation')
        }
        onPress={() =>
          changeExperiment(
            target.status === 'paused' ? 'active' : 'paused',
            target,
          )
        }
      />
      <Button
        secondary
        small
        title={tr('Empfehlung abschließen', 'Complete recommendation')}
        disabled={busy}
        onPress={() => changeExperiment('completed', target)}
      />
      <Button
        danger
        small
        title={tr('Empfehlung abbrechen', 'Cancel recommendation')}
        disabled={busy}
        onPress={() =>
          Alert.alert(
            tr('Empfehlung abbrechen?', 'Cancel recommendation?'),
            tr(
              'Die bisherige Prüfung bleibt gespeichert.',
              'The test so far stays saved.',
            ),
            [
              { text: tr('Zurück', 'Back'), style: 'cancel' },
              {
                text: tr('Abbrechen', 'Cancel'),
                onPress: () => changeExperiment('aborted', target),
              },
            ],
          )
        }
      />
    </>
  );
  const activeCard = (
    target: Experiment,
    evaluation: ExperimentEvaluation,
    triedText: string,
    resultTitle: string,
    resultText: string,
    causeText: string,
    unitWord: string,
  ) => {
    const minimum = target.recommendation.criteria.minimumObservations;
    const done = evaluation.eligibleRunIds.length;
    return (
      <Card style={styles.coachCard}>
        <View style={styles.recommendationMeta}>
          <Text style={styles.heroLabel}>
            {tr('Deine Empfehlung', 'Your recommendation')}
          </Text>
          <Badge muted={target.status === 'paused'}>
            {target.status === 'paused'
              ? tr('Pausiert', 'Paused')
              : tr(
                  `Aktiv seit ${date(target.acceptedAt)}`,
                  `Active since ${date(target.acceptedAt)}`,
                )}
          </Badge>
        </View>
        <Text style={styles.cardTitle}>{target.recommendation.action}</Text>
        <Progress
          value={minimum ? done / minimum : 0}
          label={tr(
            `${done} von ${minimum} geeigneten ${unitWord}`,
            `${done} of ${minimum} suitable ${unitWord}`,
          )}
        />
        <Copy muted>
          {tr(
            `${done} von ${minimum} geeigneten ${unitWord}`,
            `${done} of ${minimum} suitable ${unitWord}`,
          )}{' '}
          · {tr('Ergebnis', 'Result')} {shortVerdict(evaluation.verdict)}
        </Copy>
        <Row title={tr('Ausprobiert?', 'Tried it?')} subtitle={triedText} />
        <Row title={resultTitle} subtitle={resultText} />
        <Copy muted>{causeText}</Copy>
      </Card>
    );
  };
  const proposalCard = (
    proposal: AnyRecommendation,
    onPostpone: () => void,
  ) => (
    <Card style={styles.coachCard}>
      <View style={styles.recommendationMeta}>
        <Text style={styles.heroLabel}>
          {tr('Neuer Vorschlag', 'New suggestion')}
        </Text>
        <Badge>{tr('Vorschlag', 'Suggestion')}</Badge>
      </View>
      <Text style={styles.cardTitle}>{proposal.action}</Text>
      <Copy muted>{proposal.reason}</Copy>
      <Button
        title={tr('Empfehlung annehmen', 'Accept recommendation')}
        onPress={() => accept(proposal)}
        disabled={busy}
      />
      <View style={styles.choiceRow}>
        <View style={styles.flex}>
          <Button
            secondary
            small
            title={tr('Später entscheiden', 'Decide later')}
            disabled={busy}
            onPress={onPostpone}
          />
        </View>
        <View style={styles.flex}>
          <Button
            secondary
            small
            title={tr('Vorschlag ablehnen', 'Decline')}
            disabled={busy}
            onPress={() =>
              save({
                dismissedRecommendations: [
                  ...(settings.dismissedRecommendations || []),
                  proposal.id,
                ],
              })
            }
          />
        </View>
      </View>
    </Card>
  );
  const renderRunningCoach = () => {
    const evaluation = runEvaluation;
    const withoutPurpose = runningRuns.filter(purposeMissing).length;
    const needsPurpose = withoutPurpose > 0;
    const maintaining = analyses[0]?.analysis.state === 'maintain';
    const postponed = Boolean(
      settings.postponedUntil && settings.postponedUntil > now,
    );
    const missing = postponed
      ? tr(
          'Du hast den Vorschlag auf morgen verschoben.',
          'You postponed the suggestion to tomorrow.',
        )
      : maintaining
      ? analyses[0].analysis.focus
      : !runningRuns.length
      ? tr(
          'Dafür fehlt noch ein aufgezeichneter Lauf.',
          'A recorded run is still needed for this.',
        )
      : needsPurpose
      ? tr(
          `Bei ${counted(withoutPurpose, 'Lauf', 'Läufen')} fehlt die Laufart.`,
          `The run type is missing for ${counted(withoutPurpose, 'run', 'runs')}.`,
        )
      : tr(
          'Vorschläge entstehen aus ruhigen und langen Runden mit mindestens vier gleichmäßigen Abschnitten ab 500 m.',
          'Suggestions come from easy and long runs with at least four even splits of 500 m or more.',
        );
    const past = (settings.experiments || []).filter(
      (e): e is Experiment<Recommendation> =>
        (e.status === 'completed' || e.status === 'aborted') &&
        isRunRecommendation(e.recommendation),
    );
    return (
      <>
        {runRecs ? (
          <>
            {experiment && evaluation ? (
              <>
                {activeCard(
                  experiment,
                  evaluation,
                  evaluation.adherence.some(item => item.value === 'yes')
                    ? tr('Ja, in passenden Läufen.', 'Yes, in suitable runs.')
                    : evaluation.verdict === 'not_implemented'
                    ? tr(
                        'Du hast es bisher nicht probiert.',
                        'You have not tried it yet.',
                      )
                    : tr('Noch nicht klar.', 'Not clear yet.'),
                  tr('Gleichmäßiger gelaufen?', 'Ran more evenly?'),
                  evaluation.verdict === 'improved'
                    ? tr(
                        'Ja, häufiger als zufällig. Über Tempo oder Fitness sagt das nichts.',
                        'Yes, more often than chance. This says nothing about pace or fitness.',
                      )
                    : evaluation.verdict === 'worsened'
                    ? tr(
                        'Nein, du hast zum Ende häufiger mehr Tempo verloren.',
                        'No, more often you lost more pace toward the end.',
                      )
                    : evaluation.verdict === 'no_relevant_effect'
                    ? tr(
                        'Kein spürbarer Unterschied.',
                        'No noticeable difference.',
                      )
                    : tr('Noch nicht klar.', 'Not clear yet.'),
                  tr(
                    'Ob es an der Empfehlung lag, bleibt offen. Wetter und Tagesform können mitwirken.',
                    'Whether the recommendation was the cause stays open. Weather and form on the day can play a part.',
                  ),
                  tr('Läufen', 'runs'),
                )}
                {queued ? (
                  <Row
                    title={tr('Danach vorgesehen', 'Up next')}
                    subtitle={tr(
                      `${queued.action} · Vorschau, wird nach Abschluss geprüft`,
                      `${queued.action} · Preview, checked after completion`,
                    )}
                  />
                ) : null}
                <Disclosure
                  title={tr('Details', 'Details')}
                  subtitle={tr(
                    'Prüfregeln, Vergleichsläufe, ausgeschlossene Läufe',
                    'Test rules, comparison runs, excluded runs',
                  )}
                  open={criteriaOpen}
                  onToggle={setCriteriaOpen}
                >
                  <Copy muted>{evaluation.summary}</Copy>
                  {renderCriteria(experiment.recommendation, true)}
                  {evaluation.excluded.map(item => (
                    <Row
                      key={item.runId}
                      title={storedRunTitle(item.runId)}
                      subtitle={item.reason}
                    />
                  ))}
                  {queued ? (
                    <Section title={tr('Grundlage der Vorschau', 'Basis of the preview')}>
                      <Copy muted>{queued.reason}</Copy>
                      {renderCriteria(queued)}
                    </Section>
                  ) : null}
                  {renderAlternatives()}
                </Disclosure>
                <Disclosure
                  title={tr('Empfehlung verwalten', 'Manage recommendation')}
                  subtitle={tr(
                    'Pausieren, abschließen, abbrechen',
                    'Pause, complete, cancel',
                  )}
                >
                  {manageButtons(experiment)}
                </Disclosure>
              </>
            ) : candidate ? (
              <>
                {proposalCard(candidate, () =>
                  save({ postponedUntil: Date.now() + DAY }),
                )}
                <Disclosure
                  title={tr('Details', 'Details')}
                  subtitle={tr(
                    'Woran wir erkennen, ob es hilft',
                    'How we tell whether it helps',
                  )}
                  open={criteriaOpen}
                  onToggle={setCriteriaOpen}
                >
                  {renderCriteria(candidate)}
                  {renderAlternatives()}
                </Disclosure>
              </>
            ) : (
              <>
                <EmptyState
                  title={
                    postponed
                      ? tr('Entscheide morgen in Ruhe.', 'Decide calmly tomorrow.')
                      : maintaining
                      ? tr(
                          'Behalte deine Einteilung bei.',
                          'Keep your plan as it is.',
                        )
                      : tr('Noch keine Empfehlung', 'No recommendation yet')
                  }
                  copy={missing}
                  action={
                    postponed
                      ? {
                          title: tr(
                            'Vorschlag jetzt ansehen',
                            'See the suggestion now',
                          ),
                          onPress: () => save({ postponedUntil: 0 }),
                        }
                      : runningRuns.length
                      ? needsPurpose
                        ? {
                            title: tr('Laufart nachtragen', 'Add run type'),
                            onPress: () => {
                              setPurposeSkipped([]);
                              setPurposeSheet(true);
                            },
                          }
                        : {
                            title: tr('Einheiten ansehen', 'View workouts'),
                            onPress: () => switchTab('history'),
                          }
                      : {
                          title: tr('Ersten Lauf starten', 'Start first run'),
                          onPress: () => switchTab('today'),
                        }
                  }
                />
                {selection.alternatives.length ? (
                  <Disclosure
                    title={tr('Details', 'Details')}
                    subtitle={tr(
                      'Andere geprüfte Möglichkeiten',
                      'Other options checked',
                    )}
                    open={criteriaOpen}
                    onToggle={setCriteriaOpen}
                  >
                    {renderAlternatives()}
                  </Disclosure>
                ) : null}
              </>
            )}
          </>
        ) : (
          <Copy muted>
            {tr(
              'Empfehlungen für diesen Bereich sind aus.',
              'Recommendations for this area are off.',
            )}
          </Copy>
        )}
        {features.goals.enabled ? (
          <Section title={tr('Grundlage', 'Basis')}>
            <Row
              title={tr('Ziele & Fokus', 'Goals & focus')}
              onPress={() => openPage('goals')}
            />
          </Section>
        ) : null}
        {runRecs && past.length ? (
          <Section title={tr('Frühere Empfehlungen', 'Earlier recommendations')}>
            {past.map(e => (
              <Card key={e.id}>
                <Copy>{e.recommendation.action}</Copy>
                <Copy muted>{`${
                  e.status === 'completed'
                    ? tr('Abgeschlossen', 'Completed')
                    : tr('Abgebrochen', 'Cancelled')
                } · ${
                  evaluateExperiment(e, runningRuns, settings.adherence).summary
                }`}</Copy>
                <Button
                  secondary
                  small
                  title={
                    pastRecommendationOpen === e.id
                      ? tr(
                          'Gespeicherte Details ausblenden',
                          'Hide saved details',
                        )
                      : tr('Gespeicherte Details ansehen', 'View saved details')
                  }
                  onPress={() =>
                    setPastRecommendationOpen(
                      pastRecommendationOpen === e.id ? null : e.id,
                    )
                  }
                />
                {pastRecommendationOpen === e.id
                  ? renderCriteria(e.recommendation, true)
                  : null}
              </Card>
            ))}
          </Section>
        ) : null}
      </>
    );
  };
  const renderStrengthCoach = () => {
    const evaluation = strengthEvaluation;
    const postponed = Boolean(
      settings.strengthPostponedUntil && settings.strengthPostponedUntil > now,
    );
    const past = (settings.experiments || []).filter(
      (e): e is Experiment<StrengthRecommendation> =>
        (e.status === 'completed' || e.status === 'aborted') &&
        isStrengthRecommendation(e.recommendation),
    );
    return (
      <>
        {strengthRecs ? (
          <>
            {strengthExperiment && evaluation ? (
              <>
                {activeCard(
                  strengthExperiment,
                  evaluation,
                  evaluation.adherence.some(item => item.value === 'yes')
                    ? tr('Ja, in passenden Einheiten.', 'Yes, in suitable sessions.')
                    : evaluation.verdict === 'not_implemented'
                    ? tr(
                        'Du hast es bisher nicht probiert.',
                        'You have not tried it yet.',
                      )
                    : tr('Noch nicht klar.', 'Not clear yet.'),
                  tr('Besser geworden?', 'Got better?'),
                  evaluation.verdict === 'improved'
                    ? tr(
                        'Dein bestes Arbeitsgewicht lag häufiger als zufällig darüber.',
                        'Your best working weight was above that more often than chance.',
                      )
                    : evaluation.verdict === 'worsened'
                    ? tr(
                        'Dein bestes Arbeitsgewicht lag häufiger als zufällig darunter.',
                        'Your best working weight was below that more often than chance.',
                      )
                    : evaluation.verdict === 'no_relevant_effect'
                    ? tr(
                        'Kein spürbarer Unterschied.',
                        'No noticeable difference.',
                      )
                    : tr('Noch nicht klar.', 'Not clear yet.'),
                  tr(
                    'Ob es an der Empfehlung lag, bleibt offen. Schlaf, Muskelkater und Tagesform können mitwirken.',
                    'Whether the recommendation was the cause stays open. Sleep, soreness, and form on the day can play a part.',
                  ),
                  tr('Einheiten', 'sessions'),
                )}
                {strengthQueued ? (
                  <Row
                    title={tr('Danach vorgesehen', 'Up next')}
                    subtitle={tr(
                      `${strengthQueued.action} · Vorschau, wird nach Abschluss geprüft`,
                      `${strengthQueued.action} · Preview, checked after completion`,
                    )}
                  />
                ) : null}
                <Disclosure
                  title={tr('Details', 'Details')}
                  subtitle={tr(
                    'Prüfregeln, Vergleichseinheiten, ausgeschlossene Einheiten',
                    'Test rules, comparison sessions, excluded sessions',
                  )}
                  open={criteriaOpen}
                  onToggle={setCriteriaOpen}
                >
                  <Copy muted>{evaluation.summary}</Copy>
                  {renderStrengthCriteria(
                    strengthExperiment.recommendation,
                    true,
                  )}
                  {evaluation.excluded.map(item => (
                    <Row
                      key={item.runId}
                      title={sessionTitle(item.runId)}
                      subtitle={item.reason}
                    />
                  ))}
                  {strengthQueued ? (
                    <Section title={tr('Grundlage der Vorschau', 'Basis of the preview')}>
                      <Copy muted>{strengthQueued.reason}</Copy>
                    </Section>
                  ) : null}
                  {renderStrengthAlternatives()}
                </Disclosure>
                <Disclosure
                  title={tr('Empfehlung verwalten', 'Manage recommendation')}
                  subtitle={tr(
                    'Pausieren, abschließen, abbrechen',
                    'Pause, complete, cancel',
                  )}
                >
                  {manageButtons(strengthExperiment)}
                </Disclosure>
              </>
            ) : strengthCandidate ? (
              <>
                {proposalCard(strengthCandidate, () =>
                  save({ strengthPostponedUntil: Date.now() + DAY }),
                )}
                <Disclosure
                  title={tr('Details', 'Details')}
                  subtitle={tr(
                    'Woran wir erkennen, ob es hilft',
                    'How we tell whether it helps',
                  )}
                  open={criteriaOpen}
                  onToggle={setCriteriaOpen}
                >
                  {renderStrengthCriteria(strengthCandidate)}
                  {renderStrengthAlternatives()}
                </Disclosure>
              </>
            ) : (
              <>
                <EmptyState
                  title={
                    postponed
                      ? tr('Entscheide morgen in Ruhe.', 'Decide calmly tomorrow.')
                      : tr('Noch keine Empfehlung', 'No recommendation yet')
                  }
                  copy={
                    postponed
                      ? tr(
                          'Du hast den Vorschlag auf morgen verschoben.',
                          'You postponed the suggestion to tomorrow.',
                        )
                      : tr(
                          'Dafür braucht eine Übung mindestens drei Einheiten mit Arbeitssätzen.',
                          'An exercise needs at least three sessions with working sets for this.',
                        )
                  }
                  action={
                    postponed
                      ? {
                          title: tr(
                            'Vorschlag jetzt ansehen',
                            'See the suggestion now',
                          ),
                          onPress: () => save({ strengthPostponedUntil: 0 }),
                        }
                      : finishedSessions.length
                      ? {
                          title: tr('Einheiten ansehen', 'View workouts'),
                          onPress: () => switchTab('history'),
                        }
                      : {
                          title: tr('Erstes Training starten', 'Start first session'),
                          onPress: () => switchTab('today'),
                        }
                  }
                />
                {strengthSelection.alternatives.length ? (
                  <Disclosure
                    title={tr('Details', 'Details')}
                    subtitle={tr(
                      'Andere geprüfte Möglichkeiten',
                      'Other options checked',
                    )}
                    open={criteriaOpen}
                    onToggle={setCriteriaOpen}
                  >
                    {renderStrengthAlternatives()}
                  </Disclosure>
                ) : null}
              </>
            )}
          </>
        ) : (
          <Copy muted>
            {tr(
              'Empfehlungen für diesen Bereich sind aus.',
              'Recommendations for this area are off.',
            )}
          </Copy>
        )}
        {features.goals.enabled ? (
          <Section title={tr('Grundlage', 'Basis')}>
            <Row
              title={tr('Ziele & Fokus', 'Goals & focus')}
              onPress={() => openPage('goals')}
            />
          </Section>
        ) : null}
        {strengthRecs && past.length ? (
          <Section title={tr('Frühere Empfehlungen', 'Earlier recommendations')}>
            {past.map(e => (
              <Card key={e.id}>
                <Copy>{e.recommendation.action}</Copy>
                <Copy muted>{`${
                  e.status === 'completed'
                    ? tr('Abgeschlossen', 'Completed')
                    : tr('Abgebrochen', 'Cancelled')
                } · ${
                  evaluateAnyExperiment(
                    e,
                    runningRuns,
                    strengthSessions,
                    settings.adherence,
                  ).summary
                }`}</Copy>
                <Button
                  secondary
                  small
                  title={
                    pastRecommendationOpen === e.id
                      ? tr('Gespeicherte Details ausblenden', 'Hide saved details')
                      : tr('Gespeicherte Details ansehen', 'View saved details')
                  }
                  onPress={() =>
                    setPastRecommendationOpen(
                      pastRecommendationOpen === e.id ? null : e.id,
                    )
                  }
                />
                {pastRecommendationOpen === e.id
                  ? renderStrengthCriteria(e.recommendation, true)
                  : null}
              </Card>
            ))}
          </Section>
        ) : null}
      </>
    );
  };
  const renderGoals = () => (
    <>
      <Title>{tr('Ziele & Fokus', 'Goals & focus')}</Title>
      {showRunning && showStrength ? (
        <Segmented
          label={tr('Bereich', 'Area')}
          options={[
            { value: 'running', label: areaLabel('running') },
            { value: 'strength', label: areaLabel('strength') },
          ]}
          value={coachArea}
          onChange={setCoachArea}
        />
      ) : null}
      {showRunning && (coachArea === 'running' || !showStrength) ? (
        <>
          <Section title={tr('Laufen', 'Running')}>
            <Row
              title={tr('Fokus', 'Focus')}
              subtitle={focusLabel(settings.trainingFocus)}
              onPress={() => openPage('focus-running')}
            />
            <Row
              title={tr('Ziel', 'Goal')}
              subtitle={
                racePrediction.status === 'estimated' &&
                racePrediction.predictedSeconds !== undefined
                  ? tr(
                      `${racePrediction.goal} · etwa ${formatGoalTime(
                        racePrediction.predictedSeconds,
                      )} geschätzt`,
                      `${racePrediction.goal} · about ${formatGoalTime(
                        racePrediction.predictedSeconds,
                      )} estimated`,
                    )
                  : settings.goal ||
                    schedule.goal?.name ||
                    tr('Kein Ziel gesetzt', 'No goal set')
              }
              onPress={() => openPage('goal')}
            />
            <Row
              title={tr('Zielzeiten', 'Goal times')}
              subtitle={tr(
                'Geschätzte Zeiten von 1 km bis Marathon',
                'Estimated times from 1 km to marathon',
              )}
              onPress={() => openPage('distance-times')}
            />
          </Section>
        </>
      ) : null}
      {showStrength && (coachArea === 'strength' || !showRunning) ? (
        <>
          <Section title={tr('Krafttraining', 'Strength training')}>
            <Row
              title={tr('Fokus', 'Focus')}
              subtitle={focusLabel(settings.strengthFocus)}
              onPress={() => openPage('focus-strength')}
            />
            <Row
              title={tr('Ziel', 'Goal')}
              subtitle={
                settings.strengthGoal || tr('Kein Ziel gesetzt', 'No goal set')
              }
              onPress={() => openPage('focus-strength')}
            />
          </Section>
        </>
      ) : null}
    </>
  );
  const openFunction = (id: FeatureId) => {
    if (!featureEnabled(features, id)) return;
    if (id === 'goals') openPage('goals');
    else {
      const entry = FEATURE_CATALOG.find(item => item.id === id);
      if (entry?.tab) {
        if (id === 'templates')
          setTemplatesView(showStrength ? 'strength' : 'run');
        switchTab(entry.tab);
      }
    }
  };
  const renderFunctions = () => (
    <>
      <Title>{tr('Alle Funktionen', 'All features')}</Title>
      <Section title={tr('Aktiv', 'Active')}>
        {FEATURE_CATALOG.filter(entry =>
          featureEnabled(features, entry.id),
        ).map(entry => (
          <Row
            key={entry.id}
            title={entry.title}
            subtitle={
              entry.tab && tabs.includes(entry.tab)
                ? tr('In der Leiste', 'In the tab bar')
                : entry.description
            }
            onPress={() => openFunction(entry.id)}
          />
        ))}
        {!FEATURE_CATALOG.some(entry => featureEnabled(features, entry.id)) ? (
          <Copy muted>
            {tr(
              'Keine optionale Funktion eingeschaltet.',
              'No optional feature is turned on.',
            )}
          </Copy>
        ) : null}
      </Section>
      <Section title={tr('Anpassen', 'Customize')}>
        <Row
          title={tr('Funktionen bearbeiten', 'Edit features')}
          onPress={() => openPage('features')}
        />
      </Section>
    </>
  );
  // Strength training shows its coach only once it is used — and
  // not at all if the area is deselected. Without running, it stands alone.
  const showStrengthArea =
    showStrength &&
    (!showRunning ||
      Boolean(
        finishedSessions.length || strengthExperiment || settings.strengthFocus,
      ));
  const renderCoach = () => (
    <>
      <Title>Coach</Title>
      {showStrengthArea && showRunning ? (
        <Segmented
          label={tr('Bereich', 'Area')}
          options={[
            { value: 'running', label: areaLabel('running') },
            { value: 'strength', label: areaLabel('strength') },
          ]}
          value={coachArea}
          onChange={area => {
            setCriteriaOpen(false);
            setCoachArea(area);
          }}
        />
      ) : null}
      {(coachArea === 'strength' || !showRunning) && showStrengthArea
        ? renderStrengthCoach()
        : renderRunningCoach()}
      <Section title={tr('Fragen', 'Questions')}>
        {proseReady ? (
          <Row
            title={tr('Trainingschat', 'Training chat')}
            subtitle={tr(
              'Fragen zu deinen Einheiten stellen',
              'Ask questions about your sessions',
            )}
            onPress={() => openPage('chat')}
          />
        ) : null}
        <Row
          title={tr('Wie Runback rechnet', 'How Runback calculates')}
          subtitle={tr(
            'Grundlagen, Grenzen und gesperrte Modelle',
            'Basics, limits, and locked models',
          )}
          onPress={() => openPage('models')}
        />
      </Section>
    </>
  );

  const renderRpe = (field: 'legs' | 'breathing', label: string) => (
    <View style={styles.rpeGroup}>
      <Text style={styles.fieldLabel}>
        {label}
        {selected?.rpe?.[field]
          ? ` · ${selected.rpe[field]} / 10`
          : tr(' · Nicht angegeben', ' · Not given')}
      </Text>
      <View style={styles.rpeGrid}>
        {Array.from({ length: 10 }, (_, i) => i + 1).map(value => (
          <Pressable
            key={value}
            accessibilityRole="button"
            accessibilityLabel={tr(
              `${label}: ${value} von 10`,
              `${label}: ${value} of 10`,
            )}
            accessibilityState={{
              selected: selected?.rpe?.[field] === value,
              disabled: busy,
            }}
            disabled={busy}
            onPress={() =>
              updateFeedback({
                rpe: {
                  ...selected?.rpe,
                  [field]: value,
                  recordedAt: Date.now(),
                },
              })
            }
            style={[
              styles.rpe,
              selected?.rpe?.[field] === value && styles.rpeSelected,
            ]}
          >
            <Text
              style={[
                styles.rpeText,
                selected?.rpe?.[field] === value && styles.rpeTextSelected,
              ]}
            >
              {value}
            </Text>
          </Pressable>
        ))}
      </View>
      <View style={styles.runTop}>
        <Text style={styles.smallMuted}>
          {tr('1 · sehr leicht', '1 · very easy')}
        </Text>
        <Text style={styles.smallMuted}>{tr('10 · maximal', '10 · maximum')}</Text>
      </View>
    </View>
  );

  // Detail of a recording: first look (map, numbers), then rate it (next step,
  // feeling), then the splits. Raw data, model, sport/run type changes, and
  // delete sit collapsed below. The run analysis appears only for runs (Spec T-1).
  const renderDetail = () => {
    if (!selected) {
      return null;
    }
    const selectedWords = sportWords(selected.sport);
    const rows = series?.rows ?? [];
    const seriesRow = seriesIndex !== null ? rows[seriesIndex] : undefined;
    const splits = kilometerSplits(selected.segments);
    const highlightRange =
      splitIndex !== null && splits[splitIndex] && series
        ? splitRange(rows, splits[splitIndex])
        : null;
    const highlightPoints = highlightRange
      ? rows
          .slice(highlightRange[0], highlightRange[1] + 1)
          .filter(
            row => row.latitude !== undefined && row.longitude !== undefined,
          )
          .map(row => ({ latitude: row.latitude!, longitude: row.longitude! }))
      : undefined;
    // Kilometer points on the map: the row at the split's end time.
    const kmMarkers = series
      ? splits
          .filter(split => /^\d+$/.test(split.label))
          .map(split => {
            if (split.endElapsedSeconds === undefined) return null;
            const row =
              rows[nearestIndex(rows, 'time', split.endElapsedSeconds)];
            return row?.latitude !== undefined && row.longitude !== undefined
              ? {
                  point: { latitude: row.latitude, longitude: row.longitude },
                  label: split.label,
                }
              : null;
          })
          .filter(
            (marker): marker is NonNullable<typeof marker> => marker !== null,
          )
      : undefined;
    const rpeSummary = selected.rpe
      ? [
          selected.rpe.legs
            ? tr(`Beine ${selected.rpe.legs}`, `Legs ${selected.rpe.legs}`)
            : null,
          selected.rpe.breathing
            ? tr(
                `Atmung ${selected.rpe.breathing}`,
                `Breathing ${selected.rpe.breathing}`,
              )
            : null,
        ]
          .filter(Boolean)
          .join(' · ')
      : '';
    // Every choice here is explicit; the page does not ask again afterwards.
    // An own choice erases the trace of an earlier confirmed suggestion; the
    // event log in memory keeps it.
    const purposeChips = (
      <Field label={tr('Laufart', 'Run type')}>
        <ChipGroup
          label={tr('Laufart dieser Aufzeichnung', 'Run type for this recording')}
          options={purposes.map(p => ({ value: p.value, label: p.label }))}
          value={selectablePurpose(selected.purpose)}
          onChange={value =>
            updateFeedback({
              purpose: value,
              purposeConfirmed: true,
              purposeHint: null,
            })
          }
          disabled={busy}
        />
      </Field>
    );
    // "Not set yet" always asks. "Just run" without an explicit choice (the
    // default at start) asks only if there is a suggestion.
    const unconfirmedFree =
      isRun(selected) &&
      selected.purpose === 'free' &&
      !selected.purposeConfirmed;
    const purposeHint =
      isRun(selected) && (purposeMissing(selected) || unconfirmedFree)
        ? suggestRunPurpose(
            selected,
            runningRuns,
            maxHeartRate(settings.maxHeartRate, runningRuns),
          )
        : undefined;
    const askPurpose =
      isRun(selected) &&
      (purposeMissing(selected) || (unconfirmedFree && Boolean(purposeHint)));
    const purposePrompt = (
      <>
        {purposeHint ? (
          <>
            <Copy>
              {tr('Sah aus wie:', 'Looked like:')}{' '}
              {purposeLabel(purposeHint.purpose)} —{' '}
              {purposeHintReason(purposeHint)}.
            </Copy>
            <Button
              secondary
              title={tr('Stimmt', "That's right")}
              onPress={() =>
                updateFeedback({
                  purpose: purposeHint.purpose,
                  purposeConfirmed: true,
                  purposeHint: purposeHintProvenance(purposeHint),
                })
              }
              disabled={busy}
            />
          </>
        ) : null}
        <Copy muted>
          {tr(
            'Danach vergleichen wir den Lauf mit ähnlichen Läufen.',
            'Then we compare the run with similar runs.',
          )}
        </Copy>
        {purposeChips}
      </>
    );
    const finishedAt = selected.startTime + selected.durationSeconds * 1000;
    // The feeling section opens only for fresh sessions; for old or imported ones
    // the large grid would be just empty space.
    const askFeeling = Date.now() - finishedAt < 2 * DAY;
    const distanceTarget =
      isRun(selected) && selected.distanceMeters > 0
        ? distanceTime(runningRuns, selected.distanceMeters / 1000, Date.now())
        : null;
    if (feelingOnly) {
      return (
        <>
          <Title>{runTitle(selected)}</Title>
          <Copy muted>
            {selectedWords.noun} · {date(selected.startTime)} ·{' '}
            {tr('gespeichert', 'saved')}
          </Copy>
          <View style={styles.metrics}>
            <Stat value={distance(selected)} label="km" />
            <Stat
              value={duration(selected.durationSeconds)}
              label={selectedWords.durationLabel}
            />
            <Stat value={tempoValue(selected)} label={tempoLabel(selected)} />
          </View>
          <Section title={selectedWords.feelingLabel}>
            {renderRpe('legs', tr('Beine', 'Legs'))}
            {renderRpe('breathing', tr('Atmung', 'Breathing'))}
          </Section>
          <Button
            title={tr('Fertig', 'Done')}
            onPress={leaveDetail}
            disabled={busy}
          />
          <Button
            secondary
            small
            title={tr('Alle Details ansehen', 'View all details')}
            onPress={() => setFeelingOnly(false)}
          />
        </>
      );
    }
    return (
      <>
        <Title>{runTitle(selected)}</Title>
        <Copy muted>
          {selectedWords.noun} · {date(selected.startTime)}
          {hasNamedPurpose(selected.purpose)
            ? ` · ${purposeLabel(selected.purpose)}`
            : ''}
        </Copy>
        <Route
          points={selected.route || []}
          overlay={{
            focus:
              seriesRow?.latitude !== undefined &&
              seriesRow?.longitude !== undefined
                ? {
                    latitude: seriesRow.latitude,
                    longitude: seriesRow.longitude,
                  }
                : undefined,
            highlight: highlightPoints,
            markers: kmMarkers,
            note: series?.wind
              ? `Wind ${compassLabel(series.wind.fromDeg)} ${Math.round(
                  series.wind.mps,
                )} m/s`
              : undefined,
            onPick: series
              ? point => {
                  const index = nearestByPosition(
                    series.rows,
                    point.latitude,
                    point.longitude,
                  );
                  if (index >= 0) setSeriesIndex(index);
                }
              : undefined,
          }}
        />
        <View style={styles.metrics}>
          <Stat value={distance(selected)} label="km" />
          <Stat
            value={duration(selected.durationSeconds)}
            label={selectedWords.durationLabel}
          />
          <Stat
            value={tempoValue(selected)}
            label={tempoLabel(selected)}
            {...toneFor(comparison, 'pace')}
          />
          {selected.avgHeartRate ? (
            <Stat
              value={`${Math.round(selected.avgHeartRate)}`}
              label={tr('Ø bpm', 'Avg bpm')}
              {...toneFor(comparison, 'heartRate')}
            />
          ) : null}
        </View>
        {snapshot?.quality.issues.length ? (
          // One caveat stays on the main surface; the details are under
          // "Data & origin".
          <Copy muted>
            {`${
              snapshot.quality.issues[0].suspected
                ? tr('Vermutet: ', 'Suspected: ')
                : ''
            }${snapshot.quality.issues[0].message}${
              snapshot.quality.issues.length > 1
                ? tr(
                    ` · ${snapshot.quality.issues.length - 1} weitere unter „Daten & Herkunft“`,
                    ` · ${snapshot.quality.issues.length - 1} more under “Data & origin”`,
                  )
                : ''
            }`}
          </Copy>
        ) : null}
        {askPurpose ? (
          <Section title={tr('Wie war der Lauf gemeint?', 'What was the run meant to be?')}>
            {purposePrompt}
          </Section>
        ) : null}
        {selected.avgCadence && usesPace(selected.sport) && !series ? (
          <Copy muted>
            {tr('Ø', 'Avg')} {Math.round(selected.avgCadence)}{' '}
            {tr('Schritte / min', 'steps / min')}
          </Copy>
        ) : null}
        {series ? (
          <Section title={tr('Verlauf', 'Trace')}>
            <RunSeriesPanel
              run={selected}
              series={series}
              selected={seriesIndex}
              onSelect={setSeriesIndex}
              range={highlightRange}
            />
          </Section>
        ) : null}
        {splits.length ? (
          <Section title={tr('Kilometer', 'Kilometers')}>
            <KilometerTable
              splits={splits}
              selected={splitIndex}
              onSelect={index => {
                setSplitIndex(index);
                if (index !== null && series) {
                  const range = splitRange(series.rows, splits[index]);
                  if (range)
                    setSeriesIndex(Math.round((range[0] + range[1]) / 2));
                }
              }}
            />
          </Section>
        ) : null}
        {isRun(selected) ? (
          <RunInsights
            run={selected}
            series={series}
            history={runningRuns}
            pacing={snapshot?.pacing}
            maxHeartRateSetting={settings.maxHeartRate}
            onMaxHeartRate={value => save({ maxHeartRate: value })}
          />
        ) : null}
        {features.goals.enabled && distanceTarget ? (
          <Row
            title={tr(
              'Zielzeit für den nächsten Lauf',
              'Goal time for the next run',
            )}
            subtitle={
              distanceTarget.estimatedSeconds === undefined
                ? tr(
                    'Zu wenig vergleichbare Läufe',
                    'Too few comparable runs',
                  )
                : tr(
                    `Gleiche Strecke · Schätzung ${formatGoalTime(
                      distanceTarget.estimatedSeconds,
                    )}`,
                    `Same distance · estimate ${formatGoalTime(
                      distanceTarget.estimatedSeconds,
                    )}`,
                  )
            }
            onPress={() => {
              setSelected(null);
              openPage('distance-times');
            }}
          />
        ) : null}
        {/* If only the run type is missing, the question above is already the next step. */}
        {snapshot &&
        runRecs &&
        !(askPurpose && !snapshot.recommendation && !experiment) ? (
          <Card style={styles.nextStepCard}>
            <Text style={styles.heroLabel}>{tr('Nächster Schritt', 'Next step')}</Text>
            <Copy>{snapshot.nextAction}</Copy>
            {snapshot.recommendation && !experiment && runRecs ? (
              <Button
                title={tr('Empfehlung ansehen', 'View recommendation')}
                onPress={() => {
                  setSelected(null);
                  openCoach('running');
                }}
              />
            ) : null}
            {experiment &&
            runRecs &&
            selected.startTime > experiment.acceptedAt ? (
              <>
                <Copy muted>
                  {tr(
                    'Hast du die Empfehlung ausprobiert?',
                    'Did you try the recommendation?',
                  )}
                </Copy>
                <View style={styles.choiceRow}>
                  {(
                    [
                      { value: 'yes', label: tr('Ja', 'Yes') },
                      { value: 'no', label: tr('Nein', 'No') },
                      { value: 'unknown', label: tr('Unklar', 'Unclear') },
                    ] as const
                  ).map(option => (
                    <View key={option.value} style={styles.flex}>
                      <Button
                        small
                        secondary={
                          settings.adherence?.[selected.id] !== option.value
                        }
                        title={option.label}
                        onPress={() =>
                          save({
                            adherence: {
                              ...settings.adherence,
                              [selected.id]: option.value,
                            },
                          })
                        }
                      />
                    </View>
                  ))}
                </View>
              </>
            ) : null}
          </Card>
        ) : null}
        <Disclosure
          title={selectedWords.feelingLabel}
          subtitle={
            rpeSummary
              ? `${rpeSummary}${selected.note ? tr(' · Notiz', ' · Note') : ''}`
              : tr('Noch nicht eingetragen', 'Not entered yet')
          }
          defaultOpen={!rpeSummary && askFeeling}
        >
          {renderRpe('legs', tr('Beine', 'Legs'))}
          {renderRpe('breathing', tr('Atmung', 'Breathing'))}
          <Text style={styles.fieldLabel}>{tr('Notiz', 'Note')}</Text>
          <TextInput
            accessibilityLabel={tr(
              'Notiz zu dieser Aufzeichnung',
              'Note on this recording',
            )}
            multiline
            value={note}
            onChangeText={setNote}
            onBlur={() => {
              if (note !== (selected.note || '')) {
                updateFeedback({ note });
              }
            }}
            placeholder={tr(
              'Was möchtest du festhalten?',
              'What do you want to note?',
            )}
            placeholderTextColor={color.muted}
            style={[styles.input, styles.note]}
            selectionColor={color.green}
          />
          {note !== (selected.note || '') ? (
            <Button
              secondary
              small
              title={tr('Notiz speichern', 'Save note')}
              onPress={() => updateFeedback({ note })}
              disabled={busy}
            />
          ) : null}
        </Disclosure>
        <View style={styles.sectionGap}>
          <Disclosure
            title={tr('Teilen & exportieren', 'Share & export')}
            subtitle={
              selected.route && selected.route.length >= 2
                ? tr(
                    'Bericht, GPX, Route in Karten-App',
                    'Report, GPX, route in maps app',
                  )
                : 'Bericht, GPX'
            }
          >
            <Button
              secondary
              title={tr(
                `${selectedWords.noun} als Bericht teilen`,
                `Share ${selectedWords.noun.toLowerCase()} as report`,
              )}
              onPress={() => shareRun(selected, snapshot)}
              disabled={busy}
            />
            <Button
              secondary
              title={tr('Als GPX exportieren', 'Export as GPX')}
              onPress={() => {
                void action(async () => {
                  await nativeCall('exportRun', selected.id, 'gpx');
                });
              }}
              disabled={busy}
            />
            {selected.route && selected.route.length >= 2 ? (
              <RouteOpenActions
                embedded
                onGoogleMaps={() =>
                  void action(() => openGoogleMaps(selected.route || []))
                }
                onCoMaps={() =>
                  void action(() => openCoMaps(selected.route || []))
                }
                disabled={busy}
              />
            ) : null}
          </Disclosure>
          <Disclosure
            title={tr('Daten & Herkunft', 'Data & origin')}
            subtitle={
              snapshot?.quality.issues.length
                ? tr(
                    `${counted(
                      snapshot.quality.issues.length,
                      'Auffälligkeit',
                      'Auffälligkeiten',
                    )} · Quelle, Modell, Wetter`,
                    `${counted(
                      snapshot.quality.issues.length,
                      'finding',
                      'findings',
                    )} · source, model, weather`,
                  )
                : tr(
                    'Quelle, Samples, Modellversion, Wetter',
                    'Source, samples, model version, weather',
                  )
            }
            open={moreDetails}
            onToggle={setMoreDetails}
          >
            {snapshot?.quality.issues.map((issue, i) => (
              <Copy muted key={i}>
                {issue.suspected ? tr('Vermutet: ', 'Suspected: ') : ''}
                {issue.message}
              </Copy>
            ))}
            <Row title={tr('Quelle', 'Source')} subtitle={selected.source} />
            <Row
              title={tr('Originalsamples', 'Original samples')}
              subtitle={tr(
                `${selected.samples || 0} gespeichert`,
                `${selected.samples || 0} saved`,
              )}
            />
            {snapshot ? (
              <Row
                title={tr('Modell', 'Model')}
                subtitle={snapshot.model_version}
              />
            ) : null}
            {selected.purposeHint ? (
              <Row
                title={tr('Laufart', 'Run type')}
                subtitle={`${tr('Vorschlag bestätigt', 'Suggestion confirmed')} · ${
                  selected.purposeHint.model_version
                }${
                  selected.purposeHint.maxHeartRate
                    ? tr(
                        ` · Maxpuls ${selected.purposeHint.maxHeartRate.value} (${
                          selected.purposeHint.maxHeartRate.source === 'setting'
                            ? 'eingestellt'
                            : 'geschätzt'
                        })`,
                        ` · max heart rate ${selected.purposeHint.maxHeartRate.value} (${
                          selected.purposeHint.maxHeartRate.source === 'setting'
                            ? 'set'
                            : 'estimated'
                        })`,
                      )
                    : ''
                }`}
              />
            ) : null}
            {snapshot ? (
              <Section title={tr('Modellierte Anforderung', 'Modeled effort')}>
                <Copy>
                  {snapshot.effort.speedIndex === undefined
                    ? tr('Nicht bestimmbar', 'Not determinable')
                    : tr(
                        `${number(snapshot.effort.speedIndex, 0)} · Tempoindex`,
                        `${number(snapshot.effort.speedIndex, 0)} · pace index`,
                      )}
                </Copy>
                <Copy muted>{snapshot.effort.uncertainty}</Copy>
                {Object.entries(snapshot.effort.factors).map(([key, value]) => (
                  <Row
                    key={key}
                    title={
                      (
                        {
                          tempo: tr('Tempo', 'Pace'),
                          slope: tr('Steigung', 'Gradient'),
                          wind: tr('Wind', 'Wind'),
                          heat: tr('Wärme', 'Heat'),
                        } as Record<string, string>
                      )[key] || key
                    }
                    subtitle={value}
                  />
                ))}
              </Section>
            ) : null}
            {snapshot ? <ProseExplanation analysis={snapshot} /> : null}
            <RunIntegrations
              id={selected.id}
              weatherEnabled={Boolean(settings.weatherEnabled)}
            />
          </Disclosure>
          <Disclosure
            title={tr('Bearbeiten & verwalten', 'Edit & manage')}
            subtitle={tr(
              'Ende, Sportart und Laufart ändern, löschen',
              'Change end, sport, and run type, delete',
            )}
          >
            {(selected as any).rawSampleCount > 0 ||
            (selected as any).originalEndTime ? (
              <Row
                title={tr('Ende bearbeiten', 'Edit end')}
                subtitle={
                  (selected as any).originalEndTime
                    ? tr(
                        `Von dir gesetzt · ursprünglich ${clockFormat(
                          new Date((selected as any).originalEndTime),
                        )}`,
                        `Set by you · originally ${clockFormat(
                          new Date((selected as any).originalEndTime),
                        )}`,
                      )
                    : tr(
                        'Vergessen zu beenden? Wähle im Verlauf, wann Schluss war.',
                        'Forgot to end it? Pick on the chart when it ended.',
                      )
                }
                onPress={() => setEndEdit({ kind: 'run', id: selected.id })}
              />
            ) : null}
            <Field label={tr('Sportart', 'Sport')}>
              <ChipGroup
                label={tr('Sportart dieser Aufzeichnung', 'Sport for this recording')}
                options={SPORTS.filter(
                  option =>
                    sports.includes(option.value) ||
                    option.value === normalizeSport(selected.sport),
                )}
                value={normalizeSport(selected.sport)}
                onChange={value => updateFeedback({ sport: value })}
                disabled={busy}
              />
            </Field>
            {askPurpose ? null : purposeChips}
            <Button
              danger
              title={tr('Aufzeichnung löschen', 'Delete recording')}
              onPress={() =>
                Alert.alert(
                  tr('Diese Aufzeichnung löschen?', 'Delete this recording?'),
                  tr(
                    'Originaldaten und Feedback dieser Aufzeichnung werden dauerhaft entfernt. Die vorher festgelegten Regeln bleiben gespeichert.',
                    'Original data and feedback for this recording are removed permanently. The rules set beforehand stay saved.',
                  ),
                  [
                    { text: tr('Behalten', 'Keep'), style: 'cancel' },
                    {
                      text: tr('Löschen', 'Delete'),
                      style: 'destructive',
                      onPress: () => {
                        void action(async () => {
                          await nativeCall('deleteRun', selected.id);
                          setSelected(null);
                          await refresh();
                        });
                      },
                    },
                  ],
                )
              }
            />
          </Disclosure>
        </View>
      </>
    );
  };

  // Templates keep their place in Plan; Settings opens the same management.
  // Settings is a short list; each row names what lies behind it.
  const renderSettings = () => (
    <>
      <Title>{tr('Einstellungen', 'Settings')}</Title>
      <Section title={tr('Sprache', 'Language')}>
        <Segmented<Language>
          label={tr('Sprache', 'Language')}
          options={[
            { value: 'de', label: 'Deutsch' },
            { value: 'en', label: 'English' },
          ]}
          value={language}
          onChange={next => save({ language: next })}
        />
      </Section>
      <View>
        <Row
          title={tr('Funktionen', 'Features')}
          subtitle={tr(
            'Was Runback zeigt und wann es fragt',
            'What Runback shows and when it asks',
          )}
          onPress={() => openPage('features')}
        />
        <Row
          title={tr('Alle Funktionen', 'All features')}
          subtitle={tr(
            'Auch Funktionen ohne eigenen Tab öffnen',
            'Also open features without their own tab',
          )}
          onPress={() => openPage('all-functions')}
        />
        {showRunning ? (
          <Row
            title={tr('Stimme & Vibration', 'Voice & vibration')}
            subtitle={tr(
              'Ansagen während des Laufs',
              'Announcements during a run',
            )}
            onPress={() => openPage('run-audio')}
          />
        ) : null}
        {features.templates.enabled ? (
          <Row
            title={tr('Vorlagen verwalten', 'Manage templates')}
            subtitle={tr(
              'Verwalte deine Kraft- und Laufvorlagen',
              'Manage your strength and run templates',
            )}
            onPress={() => {
              setTemplatesView(showStrength ? 'strength' : 'run');
              openPage('templates');
            }}
          />
        ) : null}
        <Row
          title={tr('Geräte & Verbindungen', 'Devices & connections')}
          subtitle={tr(
            'Uhr, Sensoren, Health Connect, Wetter',
            'Watch, sensors, Health Connect, weather',
          )}
          onPress={() => openPage('devices')}
        />
        <Row
          title={tr('Eigener Server', 'Own server')}
          subtitle={
            serverStatus
              ? serverStateLabel(serverStatus)
              : tr('Status wird geladen', 'Loading status')
          }
          trailing={<ConnectionMark mark={serverMark(serverStatus)} />}
          onPress={() => openPage('server')}
        />
        <Row
          title={tr('Deine Daten', 'Your data')}
          subtitle={tr(
            `${counted(runs.length, 'Aufzeichnung', 'Aufzeichnungen')} · Import, Backup, Löschen`,
            `${counted(runs.length, 'recording', 'recordings')} · import, backup, delete`,
          )}
          onPress={() => openPage('data')}
        />
        <Row
          title={tr(
            'KI-Formulierung & Trainingschat',
            'AI wording & training chat',
          )}
          subtitle={tr(
            'Optional, mit eigenem OpenRouter-Schlüssel',
            'Optional, with your own OpenRouter key',
          )}
          onPress={() => openPage('models')}
        />
        <Row
          title={tr('Einrichtung erneut öffnen', 'Open setup again')}
          subtitle={tr(
            'Ziel festlegen und Historie importieren',
            'Set a goal and import history',
          )}
          onPress={() => setSetupOpen(true)}
        />
      </View>
    </>
  );

  // Running goal: name, period, phase. Time budget and training days belong to
  // the rhythm in Plan, not here.
  const renderGoal = () => (
    <>
      <Title>{tr('Dein Ziel', 'Your goal')}</Title>
      {racePrediction.status !== 'no_goal' ? (
        <GoalProgress prediction={racePrediction} />
      ) : null}
      <Section title={tr('Was möchtest du erreichen?', 'What do you want to achieve?')}>
        <TextInput
          accessibilityLabel={tr('Dein Ziel', 'Your goal')}
          value={goalInput}
          onChangeText={setGoalInput}
          placeholder={tr(
            'Zum Beispiel: Halbmarathon im April',
            'For example: half marathon in April',
          )}
          placeholderTextColor={color.muted}
          style={styles.input}
          selectionColor={color.green}
        />
      </Section>
      <Section title={tr('Wettkampf', 'Race')}>
        <Field
          label={tr('Strecke in km (optional)', 'Distance in km (optional)')}
          hint={
            goalDistanceInput.trim()
              ? undefined
              : parseGoalDistanceKm(goalInput) !== undefined
              ? tr(
                  `Aus dem Ziel gelesen: ${numberFormat({
                    useGrouping: false,
                    maximumFractionDigits: 1,
                  }).format(
                    Math.round(parseGoalDistanceKm(goalInput)! * 10) / 10,
                  )} km`,
                  `Read from the goal: ${numberFormat({
                    useGrouping: false,
                    maximumFractionDigits: 1,
                  }).format(
                    Math.round(parseGoalDistanceKm(goalInput)! * 10) / 10,
                  )} km`,
                )
              : tr(
                  'Zum Beispiel 21,1 — oder „Halbmarathon“ im Ziel',
                  'For example 21.1 — or “half marathon” in the goal',
                )
          }
        >
          <TextInput
            accessibilityLabel={tr('Zielstrecke', 'Goal distance')}
            value={goalDistanceInput}
            onChangeText={setGoalDistanceInput}
            placeholder={tr('21,1', '21.1')}
            placeholderTextColor={color.muted}
            keyboardType="decimal-pad"
            style={styles.input}
          />
        </Field>
        <Field label={tr('Zielzeit (optional, h:mm:ss)', 'Goal time (optional, h:mm:ss)')}>
          <TextInput
            accessibilityLabel={tr('Zielzeit', 'Goal time')}
            value={goalTimeInput}
            onChangeText={setGoalTimeInput}
            placeholder="1:59:00"
            placeholderTextColor={color.muted}
            style={styles.input}
          />
        </Field>
      </Section>
      <Section title={tr('Zeitraum', 'Period')}>
        <Field label={tr('Beginn (optional)', 'Start (optional)')}>
          <TextInput
            accessibilityLabel={tr('Planbeginn', 'Plan start')}
            value={goalStartInput}
            onChangeText={setGoalStartInput}
            placeholder={tr('TT.MM.JJJJ', 'DD.MM.YYYY')}
            placeholderTextColor={color.muted}
            style={styles.input}
          />
        </Field>
        <Field label={tr('Zieldatum (optional)', 'Goal date (optional)')}>
          <TextInput
            accessibilityLabel={tr('Zieldatum', 'Goal date')}
            value={goalTargetInput}
            onChangeText={setGoalTargetInput}
            placeholder={tr('TT.MM.JJJJ', 'DD.MM.YYYY')}
            placeholderTextColor={color.muted}
            style={styles.input}
          />
        </Field>
        <Field label={tr('Trainingsphase (optional)', 'Training phase (optional)')}>
          <TextInput
            accessibilityLabel={tr('Trainingsphase', 'Training phase')}
            value={goalPhaseInput}
            onChangeText={setGoalPhaseInput}
            placeholder={tr(
              'Zum Beispiel: Wettkampfvorbereitung',
              'For example: race preparation',
            )}
            placeholderTextColor={color.muted}
            style={styles.input}
          />
        </Field>
      </Section>
      <View style={[styles.sectionGap, styles.buttonStack]}>
        <Button
          title={tr('Ziel speichern', 'Save goal')}
          onPress={() => {
            void action(async () => {
              const startDate = inputToDate(goalStartInput);
              const targetDate = inputToDate(goalTargetInput);
              if (startDate === null || targetDate === null) {
                throw new Error(
                  tr(
                    'Bitte ein gültiges Datum als TT.MM.JJJJ eingeben.',
                    'Enter a valid date as DD.MM.YYYY.',
                  ),
                );
              }
              if (targetDate && startDate && targetDate < startDate) {
                throw new Error(
                  tr(
                    'Trage einen Planbeginn ein, der spätestens am Zieldatum liegt.',
                    'Enter a plan start that is no later than the goal date.',
                  ),
                );
              }
              if (
                (startDate || targetDate || goalPhaseInput.trim()) &&
                !goalInput.trim()
              ) {
                throw new Error(
                  tr('Trage zuerst dein Ziel ein.', 'Enter your goal first.'),
                );
              }
              if (goalPhaseInput.trim() && !startDate) {
                throw new Error(
                  tr(
                    'Trage für deinen Schwerpunkt auch den Planbeginn ein.',
                    'Also enter a plan start for your focus.',
                  ),
                );
              }
              let distanceKm: number | undefined;
              if (goalDistanceInput.trim()) {
                distanceKm = parseDecimal(goalDistanceInput);
                if (!Number.isFinite(distanceKm) || distanceKm <= 0) {
                  throw new Error(
                    tr(
                      'Trage die Strecke als Zahl in km ein.',
                      'Enter the distance as a number in km.',
                    ),
                  );
                }
              }
              let targetSeconds: number | undefined;
              if (goalTimeInput.trim()) {
                targetSeconds = parseGoalTime(
                  goalTimeInput,
                  distanceKm ?? parseGoalDistanceKm(goalInput),
                );
                if (targetSeconds === undefined) {
                  throw new Error(
                    tr(
                      'Trage die Zielzeit als h:mm:ss ein.',
                      'Enter the goal time as h:mm:ss.',
                    ),
                  );
                }
              }
              await persist({
                goal: goalInput.trim(),
                goalTargetDate: targetDate,
                goalDistanceKm: distanceKm,
                goalTargetSeconds: targetSeconds,
                schedule: {
                  ...schedule,
                  goal:
                    startDate && goalInput.trim()
                      ? {
                          name: goalInput.trim(),
                          startDate,
                          targetDate: targetDate || undefined,
                          phase: goalPhaseInput.trim() || undefined,
                          distanceKm,
                          targetSeconds,
                        }
                      : undefined,
                },
              });
              setPage('main');
              setMessage(tr('Ziel gespeichert.', 'Goal saved.'));
            });
          }}
        />
        {settings.goal || schedule.goal ? (
          <Button
            secondary
            small
            title={tr('Ziel entfernen', 'Remove goal')}
            disabled={busy}
            onPress={() => {
              void action(async () => {
                await persist({
                  goal: '',
                  goalTargetDate: '',
                  goalDistanceKm: undefined,
                  goalTargetSeconds: undefined,
                  schedule: { ...schedule, goal: undefined },
                });
                setGoalInput('');
                setGoalStartInput('');
                setGoalTargetInput('');
                setGoalPhaseInput('');
                setGoalDistanceInput('');
                setGoalTimeInput('');
                setMessage(
                  tr(
                    'Ziel entfernt. Dein Fokus bleibt bestehen.',
                    'Goal removed. Your focus stays.',
                  ),
                );
              });
            }}
          />
        ) : null}
      </View>
    </>
  );

  const renderDevices = () => (
    <DeviceSettings
      capabilities={state.capabilities}
      settings={settings}
      save={save}
      refresh={refresh}
    />
  );
  // Importing is the main thing; export, backup, and delete are side paths and
  // stay collapsed.
  const renderData = () => (
    <>
      <Title>{tr('Deine Daten', 'Your data')}</Title>
      <Section title={tr('Importieren', 'Import')}>
        <Button
          title={tr('Dateien importieren', 'Import files')}
          onPress={runImport}
          disabled={busy}
        />
        <Copy muted>
          {tr(
            'FIT, GPX, TCX oder ZIP. Doppelte Läufe werden erkannt.',
            'FIT, GPX, TCX, or ZIP. Duplicate runs are detected.',
          )}
        </Copy>
        {importStatus && importStatus.state !== 'review' ? (
          <>
            <Copy>{importSummary}</Copy>
            {importStatus.state === 'running' ? (
              <Button
                secondary
                title={tr('Import abbrechen', 'Cancel import')}
                onPress={() => {
                  nativeCall<any>('cancelImport')
                    .then(setImportStatus)
                    .catch(e => setError(e.message));
                }}
              />
            ) : null}
            {(importStatus.errors || [])
              .slice(0, 20)
              .map((item: any, i: number) => (
                <Copy muted key={i}>
                  {typeof item === 'string'
                    ? item
                    : item.reason || item.message || JSON.stringify(item)}
                </Copy>
              ))}
          </>
        ) : null}
        <Row
          title={tr('Aus anderen Apps', 'From other apps')}
          subtitle={tr(
            'Fitbit, Strava, Garmin, Apple Health, Samsung und weitere',
            'Fitbit, Strava, Garmin, Apple Health, Samsung, and more',
          )}
          onPress={() => openPage('vendor-import')}
        />
        <Row
          title={tr('Deine Importe', 'Your imports')}
          subtitle={tr(
            'Frühere Importe ansehen oder löschen',
            'View or delete earlier imports',
          )}
          onPress={() => openPage('imports')}
        />
      </Section>
      <View style={styles.sectionGap}>
        <Disclosure
          title={tr('Laufberichte exportieren', 'Export run reports')}
          subtitle={tr('Zeitraum als ZIP teilen', 'Share a period as ZIP')}
        >
          <Field label={tr('Von', 'From')}>
            <Input
              label={tr('Von (TT.MM.JJJJ)', 'From (DD.MM.YYYY)')}
              placeholder={tr('TT.MM.JJJJ', 'DD.MM.YYYY')}
              value={exportFrom}
              onChangeText={setExportFrom}
              editable={!busy}
              keyboardType="numbers-and-punctuation"
            />
          </Field>
          <Field
            label={tr('Bis', 'To')}
            hint={tr('Beide Tage zählen mit.', 'Both days are included.')}
          >
            <Input
              label={tr('Bis (TT.MM.JJJJ)', 'To (DD.MM.YYYY)')}
              placeholder={tr('TT.MM.JJJJ', 'DD.MM.YYYY')}
              value={exportTo}
              onChangeText={setExportTo}
              editable={!busy}
              keyboardType="numbers-and-punctuation"
            />
          </Field>
          <Button
            secondary
            title={tr('Läufe als ZIP exportieren', 'Export runs as ZIP')}
            disabled={busy || !exportFrom || !exportTo}
            onPress={() =>
              shareRuns(async () => {
                const range = runExportRange(exportFrom, exportTo);
                return native.runIdsInRange(range.from, range.until);
              })
            }
          />
        </Disclosure>
        <Disclosure
          title={tr('Krafttraining exportieren', 'Export strength training')}
          subtitle={tr(
            'Alle aufgezeichneten Einheiten als ZIP teilen',
            'Share all recorded sessions as ZIP',
          )}
        >
          <Copy muted>
            {tr(
              'Sätze, Puls, Trainingslog und Bewegungsdaten der Uhr für Tabellen oder ein Sprachmodell. Importe fehlen.',
              'Sets, heart rate, training log, and watch motion data for spreadsheets or a language model. Imports are not included.',
            )}
          </Copy>
          <Button
            secondary
            title={tr(
              'Krafttraining als ZIP exportieren',
              'Export strength training as ZIP',
            )}
            disabled={busy}
            onPress={shareStrength}
          />
        </Disclosure>
        <Disclosure
          title="Backup"
          subtitle={tr(
            'Alle Originaldaten und Einstellungen sichern',
            'Back up all original data and settings',
          )}
        >
          <Button
            secondary
            title={tr('Backup exportieren', 'Export backup')}
            disabled={busy}
            onPress={() => {
              void action(async () => {
                const result = await nativeCall<any>('exportBackup');
                if (!result.cancelled) {
                  setMessage(tr('Backup exportiert.', 'Backup exported.'));
                }
              });
            }}
          />
          <Button
            secondary
            title={tr('Backup wiederherstellen', 'Restore backup')}
            disabled={busy}
            onPress={() =>
              Alert.alert(
                tr('Backup wiederherstellen?', 'Restore backup?'),
                tr(
                  'Wähle ein Runback-Backup. Bereits vorhandene Läufe bleiben erhalten und werden nicht doppelt angelegt.',
                  'Choose a Runback backup. Runs that already exist stay and are not added twice.',
                ),
                [
                  { text: tr('Zurück', 'Back'), style: 'cancel' },
                  {
                    text: tr('Backup wählen', 'Choose backup'),
                    onPress: () => {
                      void action(async () => {
                        const result = await nativeCall<any>('restoreBackup');
                        if (!result.cancelled) {
                          await Promise.all([reloadTrainingState(), refresh()]);
                          setMessage(
                            result.message ||
                              tr('Backup wiederhergestellt.', 'Backup restored.'),
                          );
                        }
                      });
                    },
                  },
                ],
              )
            }
          />
        </Disclosure>
        <Disclosure
          title={tr('Daten löschen', 'Delete data')}
          subtitle={tr('Alles auf diesem Telefon', 'Everything on this phone')}
        >
          <Button
            danger
            title={tr('Alle lokalen Daten löschen', 'Delete all local data')}
            onPress={() =>
              Alert.alert(
                tr('Alle lokalen Daten löschen?', 'Delete all local data?'),
                tr(
                  'Alle Läufe, Originaldaten, Notizen und Einstellungen auf diesem Telefon werden dauerhaft gelöscht. Exportiere vorher ein Backup, wenn du sie behalten möchtest.',
                  'All runs, original data, notes, and settings on this phone are deleted permanently. Export a backup first if you want to keep them.',
                ),
                [
                  { text: tr('Behalten', 'Keep'), style: 'cancel' },
                  {
                    text: tr('Alles löschen', 'Delete everything'),
                    style: 'destructive',
                    onPress: () => {
                      void action(async () => {
                        await nativeCall('clearAllData');
                        await Promise.all([reloadTrainingState(), refresh()]);
                        setPage('main');
                        setMessage(
                          tr('Lokale Daten gelöscht.', 'Local data deleted.'),
                        );
                      });
                    },
                  },
                ],
              )
            }
          />
        </Disclosure>
      </View>
    </>
  );

  const renderImports = () => (
    <ImportHistory
      batches={importBatches}
      error={importBatchesError}
      busy={busy || importStatus?.state === 'running'}
      onDelete={deleteImport}
      onImport={runVendorImport}
    />
  );

  const importPreview = useMemo(
    () =>
      importStatus?.state === 'review'
        ? readImportPreview(importStatus.preview)
        : null,
    // `tr` reads the module-level language, so the text recomputes via this dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [importStatus?.state, importStatus?.preview, language],
  );
  const renderEndEdit = () =>
    endEdit?.kind === 'strength' && selectedSession?.id === endEdit.id ? (
      <StrengthEndSheet
        session={selectedSession}
        visible
        onClose={() => setEndEdit(null)}
        onSaved={next => {
          setEndEdit(null);
          setSelectedSession(next);
          void native
            .strengthSessions(500)
            .then(setStrengthSessions)
            .catch(() => {});
        }}
      />
    ) : endEdit?.kind === 'run' && selected?.id === endEdit.id ? (
      <RunEndSheet
        runId={endEdit.id}
        visible
        onClose={() => setEndEdit(null)}
        onSaved={() => {
          setEndEdit(null);
          void action(async () => {
            setSelected(await native.run(endEdit.id));
            await refresh();
          });
        }}
      />
    ) : null;

  const renderImportReview = () => (
    <Sheet
      visible={importPreview !== null}
      title={tr('Import prüfen', 'Review import')}
      onClose={discardImport}
    >
      {importPreview ? (
        <ImportReview
          key={String(importStatus?.token)}
          preview={importPreview}
          files={Array.isArray(importStatus?.files) ? importStatus.files : []}
          problems={{
            failed: Number(importStatus?.failed) || 0,
            skipped: Number(importStatus?.skipped) || 0,
            nonRunning: Number(importStatus?.nonRunning) || 0,
            errors: (Array.isArray(importStatus?.errors)
              ? importStatus.errors
              : []
            ).map((item: any) =>
              typeof item === 'string'
                ? item
                : `${item?.file ? `${item.file}: ` : ''}${
                    item?.message || item?.reason || ''
                  }`,
            ),
          }}
          busy={busy}
          onCommit={commitImport}
          onDiscard={discardImport}
        />
      ) : null}
    </Sheet>
  );

  const renderVendorImport = () => (
    <VendorImport
      busy={busy}
      importStatus={importStatus}
      onImport={runVendorImport}
      onCancelImport={cancelImport}
      onOpenImports={() => openPage('imports')}
      onOpenTemplates={() => {
        setTemplatesView('strength');
        openPage('templates');
      }}
    />
  );

  // Templates in one place: strength templates (exercise sequences) and run
  // templates (run type and time for the start). Both appear in the start sheet.
  const renderPresets = () => (
    <>
      <Copy muted>
        {tr(
          'Eine Laufvorlage setzt Laufart und Zeit beim Start. Die aktuelle Wahl speicherst du hier als neue Vorlage.',
          'A run template sets the run type and time at the start. Save the current choice here as a new template.',
        )}
      </Copy>
      <Section title={tr('Aktuelle Einstellung speichern', 'Save current setting')}>
        <Copy>
          {purposeLabel(purpose)} · {settings.minutes || 30}{' '}
          {tr('Minuten', 'minutes')}
        </Copy>
        <TextInput
          accessibilityLabel={tr('Name der Laufvorlage', 'Run template name')}
          value={presetName}
          onChangeText={setPresetName}
          placeholder={tr(
            'Zum Beispiel: Feierabendrunde',
            'For example: after-work loop',
          )}
          placeholderTextColor={color.muted}
          style={styles.input}
        />
        <Button
          title={tr('Vorlage speichern', 'Save template')}
          disabled={!presetName.trim() || busy}
          onPress={() => {
            const preset: Preset = {
              id: `preset-${Date.now()}`,
              name: presetName.trim(),
              purpose,
              minutes: settings.minutes || 30,
              cues: Boolean(settings.cues),
            };
            void action(async () => {
              await persist({ presets: [...(settings.presets || []), preset] });
              setPresetName('');
            });
          }}
        />
      </Section>
      <Section title={tr('Deine Vorlagen', 'Your templates')}>
        {features.templates.enabled && settings.presets?.length ? (
          settings.presets.map(p => (
            <View key={p.id}>
              <Row
                title={p.name}
                subtitle={tr(
                  `${purposeLabel(p.purpose)} · ${p.minutes} Minuten`,
                  `${purposeLabel(p.purpose)} · ${p.minutes} minutes`,
                )}
                onPress={() => {
                  void action(async () => {
                    await persist({
                      purpose: p.purpose,
                      minutes: p.minutes,
                      cues: p.cues,
                    });
                    switchTab('today');
                    openStartSheet('run');
                  });
                }}
              />
              <Pressable
                accessibilityRole="button"
                style={styles.textButton}
                onPress={() =>
                  save({
                    presets: settings.presets?.filter(item => item.id !== p.id),
                  })
                }
              >
                <Text style={styles.muted}>
                  {tr('Vorlage entfernen', 'Remove template')}
                </Text>
              </Pressable>
            </View>
          ))
        ) : (
          <Copy muted>
            {tr('Noch keine Vorlage gespeichert.', 'No template saved yet.')}
          </Copy>
        )}
      </Section>
    </>
  );

  const renderTemplates = () => (
    <>
      <Title>{tr('Vorlagen', 'Templates')}</Title>
      <Segmented
        label={tr('Art der Vorlage', 'Type of template')}
        options={[
          { value: 'strength', label: tr('Kraftvorlagen', 'Strength templates') },
          { value: 'run', label: tr('Laufvorlagen', 'Run templates') },
        ]}
        value={templatesView}
        onChange={setTemplatesView}
      />
      {templatesView === 'strength' ? (
        <>
          <ImportedTemplates
            refreshKey={`${importRevision}:${importStatus?.state ?? ''}:${
              importStatus?.strength ?? ''
            }:${importStatus?.strengthDuplicates ?? ''}`}
            templates={strength.templates}
            dismissedIds={settings.dismissedStrengthImportTemplateIds ?? []}
            busy={busy}
            onDismiss={async id => {
              await persist({
                dismissedStrengthImportTemplateIds: Array.from(
                  new Set([
                    ...(stateRef.current.settings
                      .dismissedStrengthImportTemplateIds ?? []),
                    id,
                  ]),
                ),
              });
            }}
            onSave={async template => {
              const next = acceptImportedTemplate(
                strengthRef.current.templates,
                { ...template, createdAt: Date.now() },
              );
              setStrength(await native.saveStrengthTemplates(next));
            }}
          />
          <PlanList
            busy={busy}
            onCreate={() =>
              setPlanDraft(createTemplate(Date.now(), '', strength.templates))
            }
            onDelete={id =>
              persistTemplates(deleteTemplate(strength.templates, id))
            }
            onDuplicate={id =>
              persistTemplates(
                duplicateTemplate(strength.templates, id, Date.now()),
              )
            }
            onEdit={template => setPlanDraft(template)}
            onStart={template => startStrength(template)}
            templates={strength.templates}
            today={new Date().getDay()}
          />
        </>
      ) : (
        renderPresets()
      )}
    </>
  );

  // Detail of a strength session. Shows what was confirmed — planned values do
  // not appear here as actual values (T-6).
  const renderSession = () =>
    selectedSession ? (
      <StrengthSessionDetail
        session={selectedSession}
        history={finishedSessions}
        heart={sessionHeart}
        watch={sessionWatch}
        heartSummaries={heartSummaries}
        onOpenExercise={openExercise}
        onEditEnd={() =>
          setEndEdit({ kind: 'strength', id: selectedSession.id })
        }
        busy={busy}
      />
    ) : null;

  // Muscle map: first what you reported yourself; the calculated freshness
  // stays beside it, as "unknown", while it is locked. Terms and caveats are
  // under "What the map shows".
  const renderMuscleMap = () => {
    const latestReport = latestSoreness;
    return (
      <>
        <Text style={styles.title}>{tr('Muskelkarte', 'Muscle map')}</Text>
        <Segmented
          label={tr('Was die Karte zeigt', 'What the map shows')}
          options={[
            { value: 'soreness', label: tr('Gemeldeter Muskelkater', 'Reported soreness') },
            { value: 'freshness', label: tr('Frische', 'Freshness') },
          ]}
          value={muscleMapMode}
          onChange={setMuscleMapMode}
        />
        <BodyMap
          mode={muscleMapMode}
          showScaleTitle={false}
          values={
            muscleMapMode === 'freshness' ? freshnessValues : sorenessValues
          }
        />
        <Copy muted>
          {muscleMapMode === 'freshness'
            ? tr(
                'Noch nicht freigeschaltet — alle Regionen bleiben unbekannt.',
                'Not unlocked yet — all regions stay unknown.',
              )
            : latestReport
            ? tr(
                `Letzte Meldung: ${date(latestReport.at)} · ${
                  latestReport.nothingToday
                    ? 'heute nichts'
                    : counted(latestReport.entries.length, 'Region', 'Regionen')
                }`,
                `Last report: ${date(latestReport.at)} · ${
                  latestReport.nothingToday
                    ? 'nothing today'
                    : counted(latestReport.entries.length, 'region', 'regions')
                }`,
              )
            : tr(
                'Noch keine Meldung gespeichert.',
                'No report saved yet.',
              )}
        </Copy>
        <Button
          title={tr('Muskelkater melden', 'Report soreness')}
          onPress={openSorenessCapture}
        />
        <View style={styles.sectionGap}>
          <Disclosure
            title={tr('Was die Karte zeigt', 'What the map shows')}
            subtitle={tr(
              'Frische, Muskelkater und Grenzen',
              'Freshness, soreness, and limits',
            )}
          >
            <Copy muted>
              {tr(
                'Muskelkater ist deine eigene Angabe je Region von 0 bis 10 — keine Messung und keine Diagnose.',
                'Soreness is your own rating per region from 0 to 10 — not a measurement and not a diagnosis.',
              )}
            </Copy>
            <Copy muted>
              {tr(
                'Frische ist eine gerechnete Größe je Region. 100 bedeutet: keine nachwirkende Belastung im Sinne des Modells — nicht gesund, stark oder bereit.',
                'Freshness is a calculated value per region. 100 means: no lingering load in the model’s sense — not healthy, strong, or ready.',
              )}
            </Copy>
            <Copy muted>
              {tr(
                'Für persönliche Frischewerte fehlt noch eine abgeschlossene Modellprüfung. Fehlende oder unsichere Grundlage bleibt unbekannt.',
                'Personal freshness values still lack a completed model check. Missing or uncertain basis stays unknown.',
              )}
            </Copy>
          </Disclosure>
        </View>
      </>
    );
  };

  const lockedModels = [
    'Critical Speed & Fitness',
    'Race Simulator & Pacemaker',
    tr('Persönliche Umweltparameter', 'Personal environment parameters'),
    tr('Fuel-Plan & Szenarien', 'Fuel plan & scenarios'),
  ];
  const renderModels = () => (
    <>
      <Title>{tr('Wie Runback rechnet', 'How Runback calculates')}</Title>
      <Section title={tr('Lokal aus deinen Daten', 'Local, from your data')}>
        <Copy>
          {tr(
            'Basiswerte, Datenqualität und Laufart rechnet Runback auf diesem Gerät. Messung, Gefühl und Schätzung bleiben getrennt.',
            'Runback calculates base values, data quality, and run type on this device. Measurement, feeling, and estimate stay separate.',
          )}
        </Copy>
        <Copy muted>
          {tr(
            'Der Tempoindex beschreibt die äußere Anforderung eines Laufs — keine Messung von Fitness, Ermüdung oder Gesundheit.',
            'The pace index describes the external demand of a run — not a measure of fitness, fatigue, or health.',
          )}
        </Copy>
        <Disclosure
          title={tr('Gesperrte Modelle', 'Locked models')}
          subtitle={tr(
            `${lockedModels.length} Modelle · noch nicht freigegeben`,
            `${lockedModels.length} models · not released yet`,
          )}
        >
          {lockedModels.map(title => (
            <Row key={title} title={title} />
          ))}
          <Copy muted>
            {tr(
              'Für persönliche Empfehlungen fehlen geeignete Daten und eine unabhängige Modellprüfung.',
              'Personal recommendations lack suitable data and an independent model check.',
            )}
          </Copy>
        </Disclosure>
      </Section>
      <Section title={tr('Erklärungen ohne Cloud', 'Explanations without cloud')}>
        <Copy muted>
          {tr(
            'Die lokalen Regeln entscheiden. Ein Sprachmodell ist optional und formuliert nur.',
            'The local rules decide. A language model is optional and only phrases.',
          )}
        </Copy>
      </Section>
      <ProseSettings />
      <Button
        title={tr('Trainingschat öffnen', 'Open training chat')}
        onPress={() => openPage('chat')}
      />
    </>
  );

  const recordRuns = selectedRecord
    ? runningRuns
        .filter(run => selectedRecord.runIds.includes(run.id))
        .sort((a, b) => b.startTime - a.startTime)
    : [];

  const content = selected ? (
    renderDetail()
  ) : page === 'exercise' && selectedExercise ? (
    <ExerciseDetail
      exerciseId={selectedExercise}
      sessions={finishedSessions}
      onOpenSession={openSessionById}
      busy={busy}
    />
  ) : page === 'record-sessions' && selectedStrengthRecord ? (
    <>
      <Title>{selectedStrengthRecord.label}</Title>
      <Copy muted>{selectedStrengthRecord.detail}</Copy>
      <Stat
        value={selectedStrengthRecord.value}
        label={tr('Bestwert', 'Personal best')}
      />
      <Section title={tr('Einheiten', 'Workouts')}>
        {finishedSessions
          .filter(session =>
            selectedStrengthRecord.sessionIds.includes(session.id),
          )
          .sort((a, b) => b.startTime - a.startTime)
          .map(session => (
            <Row
              key={session.id}
              title={
                displaySessionName(session.name) ||
                tr('Krafttraining', 'Strength training')
              }
              subtitle={unitSummary({
                kind: 'strength',
                key: session.id,
                session,
                at: session.startTime,
              })}
              onPress={() => openDepth('session', { session })}
              disabled={busy}
            />
          ))}
      </Section>
    </>
  ) : page === 'record-runs' && selectedRecord ? (
    <>
      <Title>{selectedRecord.label}</Title>
      <Copy muted>{selectedRecord.detail}</Copy>
      <Stat
        value={selectedRecord.value}
        label={tr('Distanz', 'Distance')}
      />
      <Section title={tr('Läufe', 'Runs')}>
        {recordRuns.map(run => (
          <Row
            key={run.id}
            title={runTitle(run)}
            subtitle={unitSummary({
              kind: 'run',
              key: run.id,
              run,
              at: run.startTime,
            })}
            onPress={() => openRun(run.id)}
            disabled={busy}
          />
        ))}
        {!recordRuns.length ? (
          <EmptyState
            title={tr('Keine Läufe mehr vorhanden', 'No runs left')}
            copy={tr(
              'Öffne die Statistik erneut.',
              'Open statistics again.',
            )}
            action={{
              title: tr('Zur Statistik', 'To statistics'),
              onPress: leaveDetail,
            }}
          />
        ) : null}
      </Section>
    </>
  ) : page === 'distance-times' ? (
    <DistanceTimes
      runs={runningRuns}
      onRun={run => openRun(run.id)}
      onNextRun={(km, seconds) => {
        openPage('run-target');
        setPreviewRunTarget({
          ...runTarget,
          kind: 'pace',
          version: RUN_TARGET_VERSION,
          secondsPerKm: seconds / km,
          mode: 'range',
          output: runTarget.kind === 'none' ? 'both' : runTarget.output,
        });
      }}
      onChoose={(km, seconds) => {
        openPage('goal');
        setGoalInput(`${plainNumber(km)} km`);
        setGoalDistanceInput(plainNumber(km));
        setGoalTimeInput(formatGoalTime(seconds).replace(/ (min|h)$/, ''));
      }}
    />
  ) : page === 'development' ? (
    <DevelopmentScreen
      runs={runningRuns}
      sessions={strengthSessions}
      goal={schedule.goal?.name || settings.goal || ''}
      strengthHistoryAvailable={strengthHistoryAvailable}
      now={now}
      schedule={schedule}
      prediction={racePrediction}
      onEditGoal={() => openPage('goal')}
    />
  ) : page === 'session' ? (
    renderSession()
  ) : page === 'focus-running' ? (
    <FocusEditor
      area="running"
      focus={settings.trainingFocus}
      goal={settings.goal || schedule.goal?.name || ''}
      persist={trainingFocus => persist({ trainingFocus })}
    />
  ) : page === 'focus-strength' ? (
    <FocusEditor
      area="strength"
      focus={settings.strengthFocus}
      goal={settings.strengthGoal || ''}
      persist={strengthFocus => persist({ strengthFocus })}
      goalEditor={{
        value: settings.strengthGoal || '',
        targetDate: settings.strengthGoalTargetDate || '',
        persist: (strengthGoal, strengthGoalTargetDate) =>
          persist({ strengthGoal, strengthGoalTargetDate }),
      }}
    />
  ) : page === 'templates' ? (
    renderTemplates()
  ) : page === 'chat' ? (
    <TrainingChat onSettings={() => openPage('models')} />
  ) : page === 'goal' ? (
    renderGoal()
  ) : page === 'run-target' || page === 'run-audio' ? (
    <RunTargetScreen
      settings={page === 'run-audio'}
      value={previewRunTarget ?? runTarget}
      purpose={
        todaysScheduledRun ? todaysScheduledRun.purpose || 'free' : purpose
      }
      onSave={async target => {
        await persist({ runTarget: target });
        setPage(page === 'run-audio' ? 'settings' : 'main');
        if (page !== 'run-audio' && !todaysScheduledRun) {
          setStartSheet('run');
        }
      }}
    />
  ) : page === 'all-functions' ? (
    renderFunctions()
  ) : page === 'goals' ? (
    renderGoals()
  ) : page === 'features' ||
    page === 'features-home' ||
    page === 'features-navigation' ||
    page === 'features-detail' ? (
    <FeatureSettings
      features={features}
      screen={
        page === 'features-home'
          ? 'home'
          : page === 'features-navigation'
          ? 'navigation'
          : page === 'features-detail'
          ? featureDetail
          : 'main'
      }
      disabled={busy}
      onChange={changeFeatures}
      onOpenHomeSections={() => openPage('features-home')}
      onOpenNavigation={() => openPage('features-navigation')}
      onOpenMain={() => openPage('features')}
      onOpenDetails={screen => {
        setFeatureDetail(screen);
        openPage('features-detail');
      }}
    />
  ) : page === 'server' ? (
    <ServerSettings key={serverStatus?.url ?? "off"} status={serverStatus} onStatus={setServerStatus} />
  ) : page === 'settings' ? (
    renderSettings()
  ) : page === 'devices' ? (
    renderDevices()
  ) : page === 'data' ? (
    renderData()
  ) : page === 'vendor-import' ? (
    renderVendorImport()
  ) : page === 'imports' ? (
    renderImports()
  ) : page === 'muscle-map' ? (
    renderMuscleMap()
  ) : page === 'models' ? (
    renderModels()
  ) : tab === 'today' ? (
    recording ? (
      renderRecording()
    ) : (
      renderHome()
    )
  ) : tab === 'plan' ? (
    <PlanningScreen
      state={schedule}
      onSave={saveSchedule}
      templates={strength.templates}
      runs={runs}
      strengthSessions={strengthSessions}
      now={now}
      onStartRun={startScheduled}
      onStartStrength={startScheduled}
      onDevelopment={() => openPage('development')}
      onManageTemplates={
        features.templates.enabled
          ? () => {
              setTemplatesView(showStrength ? 'strength' : 'run');
              openPage('templates');
            }
          : undefined
      }
      onOpenRoutePlanner={
        onOpenRoutePlanner && features.recording.routes && showRunning
          ? onOpenRoutePlanner
          : undefined
      }
      busy={busy}
      showSuggest={features.planning.suggest}
      showMonth={features.planning.month}
      showStrength={showStrength}
    />
  ) : tab === 'templates' ? (
    renderTemplates()
  ) : tab === 'soreness' ? (
    <>
      <Title>{tr('Muskelkater', 'Soreness')}</Title>
      <Button
        title={tr('Muskelkater melden', 'Report soreness')}
        onPress={() => setSorenessOpen(true)}
        disabled={busy || !sorenessStorageAvailable}
      />
      {features.soreness.map ? (
        <Section title={tr('Gemeldet', 'Reported')}>
          <Row
            title={tr('Muskelkarte', 'Muscle map')}
            onPress={() => openPage('muscle-map')}
          />
        </Section>
      ) : null}
      {!sorenessStorageAvailable ? (
        <Notice>
          {tr(
            'Muskelkater kann mit dieser App-Version nicht gespeichert werden.',
            'Soreness cannot be saved with this app version.',
          )}
        </Notice>
      ) : null}
    </>
  ) : tab === 'routes' ? null : tab === 'history' || tab === 'statistics' ? (
    <>
      <Title>{tabLabel(tab)}</Title>
      {tab === 'history' && features.statistics.enabled ? (
        <Segmented
          label={tr('Ansicht', 'View')}
          options={historyViewOptions()}
          value={historyView}
          onChange={next => {
            setExportSelection(null);
            setHistoryView(next);
          }}
        />
      ) : null}
      <Statistics
        embedded
        runs={runningRuns}
        sessions={finishedSessions}
        heart={heartSummaries}
        onOpenSession={openSessionById}
        onOpenStrengthRecord={openStrengthRecord}
        onOpenExercise={openExercise}
        view={statisticsView}
        onViewChange={next => save({ statisticsView: next })}
        busy={busy}
        onOpenRecord={record => {
          if (record.runId) {
            openRun(record.runId);
          } else {
            setSelectedRecord(record);
            openPage('record-runs');
          }
        }}
        modules={features.statistics.modules}
        showRunning={showRunning}
        showStrength={showStrength}
      />
      {features.soreness.enabled && features.soreness.map ? (
        <Section title={tr('Körper', 'Body')}>
          <Row
            title={tr('Muskelkarte', 'Muscle map')}
            subtitle={tr(
              'Gemeldeter Muskelkater und gerechnete Frische je Region',
              'Reported soreness and calculated freshness per region',
            )}
            onPress={() => openPage('muscle-map')}
          />
        </Section>
      ) : null}
    </>
  ) : (
    renderCoach()
  );
  if (sorenessOpen && !workoutOpen && !showOnboarding && !recording) {
    return (
      <View
        style={[
          styles.app,
          { paddingTop: insets.top, paddingBottom: insets.bottom },
        ]}
      >
        <View style={styles.header}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={tr(
              'Muskelkatermeldung schließen',
              'Close soreness report',
            )}
            onPress={() => setSorenessOpen(false)}
            style={styles.back}
          >
            <Text style={styles.backText}>‹</Text>
            <Text style={styles.backLabel}>{tr('Zurück', 'Back')}</Text>
          </Pressable>
          {busy ? <ActivityIndicator color={color.green} /> : null}
        </View>
        {error ? (
          <View style={styles.noticeSlot}>
            <Notice>{error}</Notice>
          </View>
        ) : null}
        <SorenessCapture
          busy={busy}
          now={now}
          onSave={saveSoreness}
          onSkip={() => setSorenessOpen(false)}
          onTranscribe={
            features.soreness.voice ? transcribeSoreness : undefined
          }
          voiceAvailable={
            features.soreness.voice &&
            Boolean(state.capabilities.speechRecognition)
          }
          voiceHint={
            features.soreness.voice &&
            state.capabilities.speechRecognition === false
              ? tr(
                  'Auf diesem Gerät ist keine Spracherkennung verfügbar. Tippen funktioniert unverändert.',
                  'Speech recognition is not available on this device. Typing works as before.',
                )
              : undefined
          }
        />
      </View>
    );
  }
  if (planDraft) {
    return (
      <View
        style={[
          styles.app,
          { paddingTop: insets.top, paddingBottom: insets.bottom },
        ]}
      >
        {error ? (
          <View style={styles.noticeSlot}>
            <Notice>{error}</Notice>
          </View>
        ) : null}
        <PlanEditor
          busy={busy}
          defaultRestSeconds={features.strength.defaultRestSeconds}
          onCancel={() => setPlanDraft(null)}
          onSave={template => {
            persistTemplates(upsertTemplate(strength.templates, template));
            setPlanDraft(null);
            setMessage(tr('Plan gespeichert.', 'Plan saved.'));
          }}
          template={planDraft}
        />
      </View>
    );
  }
  if (strength.active && workoutOpen) {
    const session = strength.active;
    return (
      <View
        style={[
          styles.app,
          { paddingTop: insets.top, paddingBottom: insets.bottom },
        ]}
      >
        {error ? (
          <View style={styles.noticeSlot}>
            <Notice>{error}</Notice>
          </View>
        ) : null}
        <WorkoutScreen
          busy={busy}
          watch={activeWatch}
          history={recentSessions}
          now={now}
          sessions={strengthSessions}
          showRir={features.strength.rir}
          showRestTimer={features.strength.restTimer}
          onAddExercise={() => setPickerOpen(true)}
          onAddSet={index =>
            changeSession(s =>
              addSet(
                s,
                index,
                Date.now(),
                features.strength.defaultRestSeconds,
              ),
            )
          }
          onRemoveSet={(index, setId) =>
            changeSession(s => removeStrengthSet(s, index, setId))
          }
          onRestoreSet={(index, set, position) =>
            changeSession(s => restoreStrengthSet(s, index, set, position))
          }
          onPauseRest={() => changeRest(s => pauseRest(s, Date.now()))}
          onResumeRest={() => changeRest(s => resumeRest(s, Date.now()))}
          onSkipRest={() => changeRest(clearRest)}
          onCompleteSet={(index, setId, values) => {
            // What held when the set was tapped decides (confirmSet).
            const tapped = strengthRef.current.active?.exercises[
              index
            ]?.sets.find(set => set.id === setId);
            if (!tapped) return;
            const wasDone = isSetCompleted(tapped);
            const at = Date.now();
            changeSession(s =>
              confirmSet(s, index, setId, wasDone, at, values),
            );
          }}
          onEditSet={(index, setId, values) =>
            changeSession(s => editStrengthSet(s, index, setId, values))
          }
          onFinish={finishStrength}
          onMinimize={() => setWorkoutOpen(false)}
          onSelectExercise={index =>
            changeSession(s => selectExercise(s, index))
          }
          session={session}
        />
        <ExercisePicker
          onClose={() => setPickerOpen(false)}
          onSelect={(exercise: Exercise) => {
            setPickerOpen(false);
            changeSession(s =>
              addExercise(
                s,
                exercise,
                Date.now(),
                3,
                features.strength.defaultRestSeconds,
              ),
            );
          }}
          visible={pickerOpen}
        />
      </View>
    );
  }
  if (showOnboarding) {
    return (
      <View
        style={[
          styles.app,
          { paddingTop: insets.top, paddingBottom: insets.bottom },
        ]}
      >
        {error ? (
          <View style={styles.noticeSlot}>
            <Notice>{error}</Notice>
          </View>
        ) : null}
        <Onboarding
          settings={settings}
          persist={persist}
          busy={busy}
          importStatus={importStatus}
          onImport={() => beginImport(true)}
          onCancelImport={() => {
            void nativeCall('cancelImport').catch(e => setError(e.message));
          }}
          onDone={() => {
            setSetupOpen(false);
            setTab('today');
            setPage('main');
          }}
        />
        {renderImportReview()}
      </View>
    );
  }
  const isUnits =
    !selected &&
    page === 'main' &&
    tab === 'history' &&
    (historyView === 'units' || !features.statistics.enabled);
  const runCount = units.filter(unit => unitMatches(unit, 'runs')).length;
  const cyclingCount = units.filter(unit =>
    unitMatches(unit, 'cycling'),
  ).length;
  const sessionCount = units.length - runCount - cyclingCount;
  // Only filters that have something behind them are shown, even when an area
  // is switched off, so history does not disappear. With only one kind there is
  // no filter.
  const unitFilterChoices = unitFilterOptions();
  const presentFilters = unitFilterChoices.filter(
    item =>
      (item.value === 'runs' && runCount > 0) ||
      (item.value === 'cycling' && cyclingCount > 0) ||
      (item.value === 'strength' && sessionCount > 0),
  );
  const unitFilters =
    presentFilters.length > 1
      ? [unitFilterChoices[0], ...presentFilters]
      : [unitFilterChoices[0]];
  const activeUnitFilter = unitFilters.some(
    item => item.value === effectiveUnitFilter,
  )
    ? effectiveUnitFilter
    : 'all';
  const runCountLabel = counted(runCount, tr('Lauf', 'run'), tr('Läufe', 'runs'));
  const cyclingCountLabel = counted(
    cyclingCount,
    tr('Radfahrt', 'ride'),
    tr('Radfahrten', 'rides'),
  );
  const sessionCountLabel = counted(
    sessionCount,
    tr('Krafteinheit', 'strength session'),
    tr('Krafteinheiten', 'strength sessions'),
  );
  const unitCountLabel =
    activeUnitFilter === 'runs'
      ? runCountLabel
      : activeUnitFilter === 'cycling'
      ? cyclingCountLabel
      : activeUnitFilter === 'strength'
      ? sessionCountLabel
      : [
          runCount ? runCountLabel : '',
          cyclingCount ? cyclingCountLabel : '',
          sessionCount ? sessionCountLabel : '',
        ]
          .filter(Boolean)
          .join(' · ');
  const unitEmptyState =
    activeUnitFilter === 'strength' ? (
      <EmptyState
        title={tr('Noch keine Krafteinheit', 'No strength session yet')}
        copy={tr(
          'Jede bestätigte Einheit erscheint hier, mit Sätzen und Volumen.',
          'Every confirmed session appears here, with sets and volume.',
        )}
        action={{
          title: tr('Krafttraining starten', 'Start strength training'),
          onPress: () => switchTab('today'),
        }}
      />
    ) : activeUnitFilter === 'cycling' ? (
      <EmptyState
        title={tr('Noch keine Radfahrt', 'No ride yet')}
        copy={tr(
          'Radfahrten stehen hier mit Strecke und Geschwindigkeit, getrennt von deinen Laufkilometern.',
          'Rides appear here with distance and speed, separate from your running kilometers.',
        )}
        action={{
          title: tr('Radfahrt starten', 'Start ride'),
          onPress: () => {
            save({ sport: 'cycling' });
            switchTab('today');
            openStartSheet('run');
          },
        }}
      />
    ) : activeUnitFilter === 'runs' ? (
      <EmptyState
        title={tr('Noch kein Lauf', 'No run yet')}
        copy={tr(
          'Nach deinem ersten Lauf stehen hier Strecke, Laufgefühl und der nächste Schritt.',
          'After your first run, distance, run feel, and the next step appear here.',
        )}
        action={{
          title: tr('Ersten Lauf starten', 'Start first run'),
          onPress: () => switchTab('today'),
        }}
      />
    ) : (
      <EmptyState
        title={tr('Hier beginnt deine Historie', 'Your history starts here')}
        copy={tr(
          'Läufe, Radfahrten und Krafteinheiten stehen ab dem ersten Mal gemeinsam in dieser Liste.',
          'Runs, rides, and strength sessions appear together in this list from the first one on.',
        )}
        action={{
          title: tr('Aufzeichnung starten', 'Start recording'),
          onPress: () => switchTab('today'),
        }}
      />
    );
  // The chat needs the full height: history scrolls, the input stays at the bottom.
  const isChat = !selected && page === 'chat';
  return (
    <View key={language} style={[styles.app, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        {selected || page !== 'main' ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={tr('Zurück', 'Back')}
            onPress={leaveDetail}
            style={styles.back}
          >
            <Text style={styles.backText}>‹</Text>
            <Text style={styles.backLabel}>{tr('Zurück', 'Back')}</Text>
          </Pressable>
        ) : (
          <Text style={styles.brand}>
            runback<Text style={styles.brandMark}> /</Text>
          </Text>
        )}
        {busy ? (
          <ActivityIndicator color={color.green} />
        ) : recording ? (
          <Text style={styles.headerInfo}>
            {tr('Aufzeichnung aktiv', 'Recording active')}
          </Text>
        ) : !selected && page === 'main' ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={
              serverStatus && serverMark(serverStatus)
                ? tr(
                    `Einstellungen · Server ${serverStateLabel(serverStatus)}`,
                    `Settings · server ${serverStateLabel(serverStatus)}`,
                  )
                : tr('Einstellungen', 'Settings')
            }
            onPress={() => openPage('settings')}
            style={({ pressed }) => [styles.settingsButton, pressed && styles.pressed]}
          >
            <ConnectionMark mark={serverMark(serverStatus)} />
            <Icon name="settings" />
          </Pressable>
        ) : null}
      </View>
      {error ? (
        <View style={styles.noticeSlot}>
          <Notice
            title={tr('Aktion nicht abgeschlossen', 'Action not completed')}
            onDismiss={() => setError('')}
          >
            {error}
          </Notice>
        </View>
      ) : null}
      {exportProgress ? (
        <View style={styles.noticeSlot} accessibilityLiveRegion="polite">
          <Copy>{exportProgress}</Copy>
        </View>
      ) : null}
      {message ? (
        <View style={styles.noticeSlot}>
          <Notice onDismiss={() => setMessage('')}>{message}</Notice>
        </View>
      ) : null}
      {loading ? (
        <View style={styles.loading}>
          <ActivityIndicator color={color.green} />
          <Copy muted>{tr('Einheiten werden geladen …', 'Loading workouts …')}</Copy>
        </View>
      ) : isChat ? (
        <TrainingChat onSettings={() => openPage('models')} />
      ) : !selected && page === 'main' && tab === 'routes' ? (
        <RoutePlannerScreen embedded onClose={() => switchTab('today')} />
      ) : isUnits ? (
        <FlatList
          data={unitListItems}
          keyExtractor={item => item.key}
          renderItem={({ item }) =>
            item.type === 'week' ? (
              <View style={styles.weekHeader}>
                <Text style={styles.weekHeaderTitle}>{item.label}</Text>
                <Text style={[styles.muted, styles.weekHeaderSummary]}>
                  {item.summary}
                </Text>
              </View>
            ) : (
              <UnitRow
                unit={item.unit}
                disabled={
                  busy ||
                  (exportSelection !== null &&
                    (item.unit.kind !== 'run' || !isRun(item.unit.run)))
                }
                checked={
                  exportSelection !== null &&
                  item.unit.kind === 'run' &&
                  isRun(item.unit.run)
                    ? exportSelection.includes(item.unit.run.id)
                    : undefined
                }
                onLongPress={
                  item.unit.kind === 'run' && isRun(item.unit.run)
                    ? () =>
                        toggleExportRun(
                          item.unit.kind === 'run' ? item.unit.run.id : '',
                        )
                    : undefined
                }
                open={unit => {
                  if (exportSelection !== null && unit.kind === 'run')
                    toggleExportRun(unit.run.id);
                  else openUnit(unit);
                }}
              />
            )
          }
          contentContainerStyle={styles.listContent}
          ListHeaderComponent={
            <View style={styles.historyHeader}>
              <Title>{tr('Verlauf', 'History')}</Title>
              {features.statistics.enabled ? (
                <Segmented
                  label={tr('Ansicht', 'View')}
                  options={historyViewOptions()}
                  value={historyView}
                  onChange={next => {
                    setExportSelection(null);
                    setHistoryView(next);
                  }}
                />
              ) : null}
              {unitFilters.length > 1 ? (
                <ChipGroup
                  label={tr('Einheiten filtern', 'Filter workouts')}
                  options={unitFilters}
                  value={activeUnitFilter}
                  onChange={setUnitFilter}
                />
              ) : null}
              {exportSelection !== null ? (
                <Card>
                  <Copy>
                    {counted(
                      exportSelection.length,
                      tr('Lauf', 'run'),
                      tr('Läufe', 'runs'),
                    )}{' '}
                    {tr('ausgewählt', 'selected')}
                  </Copy>
                  <Button
                    title={tr('Auswahl als ZIP exportieren', 'Export selection as ZIP')}
                    disabled={busy || !exportSelection.length}
                    onPress={() => shareRuns(async () => exportSelection)}
                  />
                  <Button
                    secondary
                    title={tr('Auswahl beenden', 'End selection')}
                    disabled={busy}
                    onPress={() => setExportSelection(null)}
                  />
                </Card>
              ) : units.length ? (
                <View style={styles.listMeta}>
                  <Copy muted>{unitCountLabel}</Copy>
                  {runCount ? (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={tr(
                        'Läufe zum Export auswählen',
                        'Select runs to export',
                      )}
                      accessibilityHint={tr(
                        'Auch per langem Druck auf einen Lauf.',
                        'Also by pressing and holding a run.',
                      )}
                      disabled={busy}
                      onPress={() => setExportSelection([])}
                      style={({ pressed }) => [
                        styles.listMetaAction,
                        pressed && styles.pressed,
                      ]}
                    >
                      <Text style={styles.greenText}>
                        {tr('Auswählen', 'Select')}
                      </Text>
                    </Pressable>
                  ) : null}
                </View>
              ) : null}
            </View>
          }
          ListEmptyComponent={unitEmptyState}
          ListFooterComponent={
            strengthSessions.length >= 500 ? (
              <Copy muted>
                {tr(
                  'Krafteinheiten: höchstens die 500 neuesten. Ältere bleiben im Backup erhalten.',
                  'Strength sessions: at most the 500 newest. Older ones stay in the backup.',
                )}
              </Copy>
            ) : null
          }
          initialNumToRender={14}
          maxToRenderPerBatch={10}
          windowSize={7}
          refreshing={busy}
          onRefresh={() => {
            // The list shows both, so it reloads both. Without native strength
            // support, the rest stays untouched.
            void action(async () => {
              await refresh();
              await native
                .strengthSessions(500)
                .then(setStrengthSessions)
                .catch(() => {});
            });
          }}
        />
      ) : (
        <ScrollView
          key={`${tab}-${page}-${selected?.id || ''}-${Boolean(recording)}`}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
        >
          {content}
        </ScrollView>
      )}
      <View
        style={[styles.tabBar, { paddingBottom: Math.max(insets.bottom, 8) }]}
      >
        {tabs.map(name => (
          <Pressable
            key={name}
            accessibilityRole="tab"
            accessibilityState={{ selected: tab === name }}
            accessibilityLabel={tabLabel(name)}
            onPress={() => switchTab(name)}
            style={[styles.tab, tab === name && styles.tabActive]}
          >
            <Icon name={name} selected={tab === name} />
            <Text
              style={[styles.tabText, tab === name && styles.tabTextActive]}
            >
              {tabLabel(name)}
            </Text>
          </Pressable>
        ))}
      </View>
      {renderStartSheet()}
      {renderPurposeSheet()}
      {renderImportReview()}
      {renderEndEdit()}
    </View>
  );
}

const styles = StyleSheet.create({
  app: { flex: 1, backgroundColor: color.bg },
  header: {
    height: 64,
    paddingHorizontal: space.lg,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  brand: {
    color: color.text,
    fontSize: 25,
    fontWeight: '700',
    letterSpacing: -1,
  },
  brandMark: { color: color.green },
  headerInfo: { color: color.muted, ...type.micro },
  back: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    minHeight: 48,
  },
  backText: { color: color.green, fontSize: 34 },
  backLabel: { color: color.text, ...type.body },
  title: { color: color.text, ...type.title, letterSpacing: -0.6 },
  muted: { color: color.muted, ...type.label, fontWeight: '400' },
  smallMuted: { color: color.muted, ...type.micro, fontWeight: '400' },
  greenText: { color: color.green, ...type.label, fontWeight: '600' },
  buttonStack: { gap: space.sm },
  listMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  listMetaAction: {
    minHeight: 48,
    justifyContent: 'center',
    paddingLeft: space.md,
  },
  scrollContent: {
    paddingHorizontal: space.lg,
    paddingTop: space.xs,
    paddingBottom: space.xxl,
    gap: space.xs,
  },
  listContent: {
    paddingHorizontal: space.lg,
    paddingTop: space.xs,
    paddingBottom: space.xl,
    flexGrow: 1,
  },
  cardTitle: { color: color.text, ...type.heading },
  settingsButton: {
    minWidth: 48,
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.xs,
  },
  hero: { marginTop: space.xs, borderWidth: 1, borderColor: color.line },
  heroLabel: {
    color: color.muted,
    ...type.micro,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  heroTitle: { color: color.text, ...type.title, letterSpacing: -0.4 },
  coachCard: { marginTop: space.xs },
  nextStepCard: { backgroundColor: color.greenSoft, gap: space.sm },
  recommendationCard: {
    backgroundColor: color.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: color.green,
    padding: space.md,
    gap: space.xs,
  },
  recommendationHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
  },
  recommendationTitle: {
    flex: 1,
    color: color.text,
    ...type.body,
    fontWeight: '600',
  },
  recommendationMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: space.xs,
  },
  weekStrip: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: space.xxs,
    marginTop: space.xs,
  },
  weekDay: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: space.xs,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: 'transparent',
    gap: 2,
  },
  weekDayToday: { backgroundColor: color.surface, borderColor: color.line },
  weekDayNumber: {
    color: color.text,
    ...type.label,
    fontVariant: ['tabular-nums'],
  },
  weekDayLabel: { color: color.muted, ...type.micro },
  weekDot: {
    width: 6,
    height: 6,
    borderRadius: radius.pill,
    backgroundColor: 'transparent',
  },
  weekDotDone: { backgroundColor: color.green },
  weekDotPlanned: { backgroundColor: color.muted },
  weekHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    gap: space.sm,
    paddingTop: space.lg,
    paddingBottom: space.xxs,
  },
  weekHeaderTitle: { color: color.text, ...type.heading },
  weekHeaderSummary: { flexShrink: 1, textAlign: 'right' },
  textButton: {
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabBar: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderTopColor: color.line,
    paddingHorizontal: space.xs,
    backgroundColor: color.bg,
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: space.sm,
    paddingBottom: space.xxs,
    gap: space.xxs,
    borderTopWidth: 2,
    borderTopColor: 'transparent',
    minHeight: 64,
  },
  tabActive: { borderTopColor: color.green },
  tabText: { color: color.muted, ...type.micro },
  tabTextActive: { color: color.green },
  runRow: {
    paddingVertical: space.ml,
    borderBottomWidth: 1,
    borderBottomColor: color.line,
    gap: space.sm,
  },
  runTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: space.xxs,
  },
  runTitle: { color: color.text, ...type.body, fontWeight: '600' },
  runBottom: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.xs,
  },
  runDistance: {
    color: color.text,
    ...type.value,
    fontVariant: ['tabular-nums'],
  },
  // No line height of its own: Android would take it for the whole row and cut
  // off the descender of the decimal point in the large value ("7.99").
  runUnit: {
    color: color.muted,
    fontSize: type.label.fontSize,
    fontWeight: '400',
  },
  arrow: { color: color.muted, fontSize: 26 },
  historyHeader: { gap: space.xxs, marginBottom: space.sm },
  pressed: { opacity: 0.7 },
  metrics: { flexDirection: 'row', gap: space.md, paddingVertical: space.ml },
  bigMetric: { paddingTop: space.xl, paddingBottom: space.xs },
  recordingHeader: { marginTop: space.xs },
  recordingActions: {
    gap: space.sm,
    marginTop: space.xl,
    marginBottom: space.sm,
  },
  fieldLabel: { color: color.text, ...type.label },
  rpeGroup: { gap: space.xs, marginTop: space.xs },
  rpeGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs },
  importLink: { minHeight: 48, justifyContent: 'center' },
  empty: { paddingVertical: space.xl, gap: space.md },
  historyCard: {
    backgroundColor: color.raised,
    borderRadius: radius.md,
    padding: space.md,
    gap: space.xxs,
  },
  feedbackSlot: {
    paddingVertical: space.md,
    borderTopWidth: 1,
    borderTopColor: color.line,
    gap: space.sm,
  },
  slotTitle: { color: color.green, ...type.label, fontWeight: '600' },
  rpe: {
    width: '18%',
    flexGrow: 1,
    height: 48,
    backgroundColor: color.surface,
    borderWidth: 1,
    borderColor: color.line,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rpeSelected: { backgroundColor: color.greenSoft, borderColor: color.green },
  rpeText: { color: color.muted, ...type.body },
  rpeTextSelected: { color: color.text, fontWeight: '700' },
  input: {
    borderWidth: 1,
    borderColor: color.line,
    borderRadius: radius.sm,
    paddingHorizontal: space.sm,
    paddingVertical: space.sm,
    color: color.text,
    backgroundColor: color.surface,
    ...type.body,
    minHeight: 52,
  },
  note: { minHeight: 96, textAlignVertical: 'top' },
  choiceRow: { flexDirection: 'row', gap: space.xxs },
  flex: { flex: 1 },
  day: {
    flex: 1,
    minHeight: 48,
    borderWidth: 1,
    borderColor: color.line,
    backgroundColor: color.surface,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dayText: { color: color.muted, ...type.label },
  timeInput: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  sectionGap: { marginTop: space.lg },
  noticeSlot: { paddingHorizontal: space.md, paddingBottom: space.xs },
  loading: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: space.md,
  },
});
