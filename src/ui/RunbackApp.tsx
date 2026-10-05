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
import { FocusEditor } from './FocusEditor';
import { focusLabel } from '../domain/focus';
import { selectRecommendations } from '../domain/recommendationSelection';
import { selectStrengthRecommendation } from '../domain/strengthRecommendation';
import {
  AREA_LABELS,
  activeExperimentFor,
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
  completeSet as completeStrengthSet,
  editSet as editStrengthSet,
  emptyStrengthState,
  finishSession,
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
import { PHONE_PLACEMENTS, normalizePlacement } from '../domain/gait';
import {
  enabledSports,
  normalizeFeatures,
  recommendationsShown,
  recommendationsSuggested,
  shouldPromptSoreness,
  visibleHomeSections,
  visibleTabs,
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

const purposes = RUN_PURPOSES;
const number = (value: number, digits = 1) =>
  Number.isFinite(value) ? value.toFixed(digits).replace('.', ',') : '–';
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
/** Tempo je Sportart: Läufe in min/km, Radfahrten in km/h. */
const tempoValue = (run: Run) => (usesPace(run.sport) ? pace(run) : speed(run));
const tempoUnit = (run: Run) => (usesPace(run.sport) ? '/km' : 'km/h');
const tempoLabel = (run: Run) =>
  usesPace(run.sport) ? 'Ø min / km' : 'Ø km/h';
const dateFormatter = new Intl.DateTimeFormat('de-DE', {
  weekday: 'short',
  day: 'numeric',
  month: 'long',
});
const date = (timestamp: number) => dateFormatter.format(new Date(timestamp));
/** Kürzer für Listenzeilen, die schon nach Wochen gruppiert sind. */
const listDateFormatter = new Intl.DateTimeFormat('de-DE', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
});
const DAY = 24 * 3600 * 1000;
const initial: AppState = {
  runs: [],
  recording: null,
  settings: {},
  capabilities: {},
};
/**
 * Vier Tabs, je eine Frage: Heute (Was mache ich jetzt?), Plan (Was mache ich
 * diese Woche?), Verlauf (Was habe ich gemacht?), Coach (Woran arbeite ich?).
 * Einstellungen sind kein Tab, sondern eine Seite hinter dem Zahnrad im Kopf.
 */
type Tab = 'Heute' | 'Plan' | 'Verlauf' | 'Coach';

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
  | 'features-home';
/** Wohin „‹ Zurück“ von einer Seite führt. Fehlt der Eintrag, zur Hauptseite. */
/** Seiten, die man aus einer Krafteinheit, Übung oder Statistik heraus öffnet;
 *  „Zurück“ führt über `trail` dorthin, woher man kam. */
const DEPTH_PAGES: Page[] = ['session', 'exercise', 'record-sessions'];
interface Trail {
  page: Page;
  session: StrengthSession | null;
  exercise: string | null;
  record: StrengthRecord | null;
}
const PARENT_PAGE: Partial<Record<Page, Page>> = {
  devices: 'settings',
  'run-audio': 'settings',
  data: 'settings',
  models: 'settings',
  features: 'settings',
  'features-home': 'features',
  'vendor-import': 'data',
  imports: 'data',
};
type VerlaufView = 'units' | 'stats';
type StartKind = 'run' | 'strength';
type TemplatesView = 'strength' | 'run';
const VERLAUF_VIEWS: { value: VerlaufView; label: string }[] = [
  { value: 'units', label: 'Einheiten' },
  { value: 'stats', label: 'Statistik' },
];
const START_KINDS: {
  value: 'running' | 'cycling' | 'strength';
  label: string;
}[] = [
  { value: 'running', label: 'Laufen' },
  { value: 'cycling', label: 'Radfahren' },
  { value: 'strength', label: 'Krafttraining' },
];
const WEEKDAY_SHORT = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];

/**
 * Eine erfasste Einheit ist ein Lauf oder ein Krafttraining. Beide stehen in
 * derselben Liste, weil sie dieselbe Frage beantworten: Was habe ich
 * trainiert? Zusammengerechnet werden sie nirgends — Kilometer und Sätze sind
 * keine gemeinsame Größe.
 */
type Unit =
  | { kind: 'run'; key: string; at: number; run: Run }
  | { kind: 'strength'; key: string; at: number; session: StrengthSession };
type UnitFilter = 'all' | 'runs' | 'cycling' | 'strength';

const UNIT_FILTERS: { value: UnitFilter; label: string }[] = [
  { value: 'all', label: 'Alle' },
  { value: 'runs', label: 'Laufen' },
  { value: 'cycling', label: 'Radfahren' },
  { value: 'strength', label: 'Krafttraining' },
];
const unitMatches = (unit: Unit, filter: UnitFilter) =>
  filter === 'all'
    ? true
    : filter === 'strength'
    ? unit.kind === 'strength'
    : unit.kind === 'run' &&
      (filter === 'runs' ? isRun(unit.run) : !isRun(unit.run));
/** Ohne jede Angabe zur Laufart — „Einfach laufen“ ist eine Antwort, „Noch offen“ nicht. */
const purposeMissing = (run: Run) => !run.purpose || run.purpose === 'unknown';
/** Zählwort mit Zahl: „1 Lauf“, „3 Radfahrten“. */
const counted = (count: number, singular: string, plural: string) =>
  `${count} ${count === 1 ? singular : plural}`;
const kilogramFormat = new Intl.NumberFormat('de-DE', {
  maximumFractionDigits: 0,
});
/** Erfasste Dauer einer Krafteinheit. Ohne Endzeit bleibt sie 0. */
const sessionSeconds = (session: StrengthSession) => {
  const end = session.endTime ?? session.startTime;
  return Math.max(0, Math.round((end - session.startTime) / 1000));
};
const unitKindLabel = (unit: Unit) =>
  unit.kind === 'run' ? sportNoun(unit.run.sport) : 'Krafttraining';
const unitTitle = (unit: Unit) =>
  unit.kind === 'run'
    ? runTitle(unit.run)
    : unit.session.name || 'Krafttraining';
/** Kurzfassung für Listenzeilen außerhalb der Einheiten-Liste. */
const unitSummary = (unit: Unit) => {
  if (unit.kind === 'run') {
    return `${date(unit.at)} · ${distance(unit.run)} km · ${tempoValue(
      unit.run,
    )} ${tempoUnit(unit.run)}`;
  }
  const sets = summarize(unit.session).completedSets;
  return `${date(unit.at)} · ${sets} ${sets === 1 ? 'Satz' : 'Sätze'}`;
};

/**
 * Die Einheiten-Liste ist nach Wochen gruppiert. Der Wochenkopf trägt die
 * Summe, damit man den Umfang sieht, ohne in die Statistik zu wechseln.
 */
type UnitListItem =
  | { type: 'unit'; key: string; unit: Unit }
  | { type: 'week'; key: string; label: string; summary: string };
const shortDate = new Intl.DateTimeFormat('de-DE', {
  day: 'numeric',
  month: 'short',
});
const weekLabel = (weekStart: string, today: string) => {
  const thisWeek = startOfWeek(today);
  if (weekStart === thisWeek) {
    return 'Diese Woche';
  }
  if (weekStart === startOfWeek(addCalendarDays(thisWeek, -7))) {
    return 'Letzte Woche';
  }
  const start = new Date(`${weekStart}T12:00:00`);
  const end = new Date(`${addCalendarDays(weekStart, 6)}T12:00:00`);
  // Im selben Monat reicht der Monat einmal: „14.–20. Sept.“
  return start.getMonth() === end.getMonth()
    ? `${start.getDate()}.–${shortDate.format(end)}`
    : `${shortDate.format(start)} – ${shortDate.format(end)}`;
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
  const parts = [counted(units.length, 'Einheit', 'Einheiten')];
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
      ? 'Satz'
      : 'Sätze';
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
      ? `${duration(sessionSeconds(unit.session))} · ${kilogramFormat.format(
          summary!.volumeKg,
        )} kg`
      : duration(sessionSeconds(unit.session));
  return (
    <Pressable
      accessibilityRole={checked === undefined ? 'button' : 'checkbox'}
      accessibilityState={{ checked, disabled }}
      disabled={disabled}
      onLongPress={onLongPress}
      accessibilityHint={
        onLongPress
          ? 'Halte gedrückt, um Läufe zum Export auszuwählen.'
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
          {/* Läufe sind der Normalfall; nur andere Arten nennen ihre Art. */}
          {unit.kind === 'run' && isRun(unit.run) ? '' : `${kind} · `}
          {listDateFormatter.format(new Date(unit.at))}
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
  /** Öffnet den Routenplaner. Fehlt er, gibt es keinen Einstieg. */
  onOpenRoutePlanner?: () => void;
} = {}) {
  const insets = useSafeAreaInsets();
  const [state, setState] = useState<AppState>(initial);
  const stateRef = useRef(state);
  const stateGeneration = useRef(0);
  const settingsRevision = useRef(0);
  const settingsWritePending = useRef(false);
  const pendingScheduleLink = useRef<{
    entryId: string;
    activityId: string;
  } | null>(null);
  const [tab, setTab] = useState<Tab>('Heute');
  const [page, setPage] = useState<Page>('main');
  const [selected, setSelected] = useState<Run | null>(null);
  const [selectedRecord, setSelectedRecord] = useState<StatsRecord | null>(
    null,
  );
  const [selectedSession, setSelectedSession] =
    useState<StrengthSession | null>(null);
  // Krafttraining in die Tiefe: Übung, Bestwert und woher man kam. Eine
  // Einheit oder Übung lässt sich aus der jeweils anderen öffnen; „Zurück“
  // führt dorthin zurück statt zur Hauptseite.
  const [selectedExercise, setSelectedExercise] = useState<string | null>(
    null,
  );
  const [selectedStrengthRecord, setSelectedStrengthRecord] =
    useState<StrengthRecord | null>(null);
  const [trail, setTrail] = useState<Trail[]>([]);
  // Puls der Krafteinheiten von der Uhr: Kurzformen für die Statistik, die
  // Reihe nur für die offene Einheit.
  const [heartSummaries, setHeartSummaries] = useState<
    Record<string, StrengthHeartSummary>
  >({});
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
  // Heute: Sportart, Laufart, Vorlage und Ziel werden im Moment des Startens
  // gewählt, nicht dauerhaft auf der Seite. Das Sheet merkt sich seine Art.
  const [startSheet, setStartSheet] = useState<StartKind | null>(null);
  const [startTemplateId, setStartTemplateId] = useState<string | null>(null);
  const [coachArea, setCoachArea] = useState<'running' | 'strength'>('running');
  // Laufart nachtragen: ein Lauf nach dem anderen; Übersprungenes bleibt offen.
  const [purposeSheet, setPurposeSheet] = useState(false);
  const [purposeSkipped, setPurposeSkipped] = useState<string[]>([]);
  const [verlaufView, setVerlaufView] = useState<VerlaufView>('units');
  const [templatesView, setTemplatesView] = useState<TemplatesView>('strength');
  const [templatesParent, setTemplatesParent] = useState<Page>('main');
  const [note, setNote] = useState('');
  const [importStatus, setImportStatus] = useState<any>(null);
  // Zählt gespeicherte und gelöschte Importe, damit Vorschläge neu laden.
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
  // Nach dem Beenden nur das Gefühl abfragen statt der ganzen Detailseite.
  const [feelingOnly, setFeelingOnly] = useState(false);
  // Detailseite: Darstellungsreihe für die Graphen, ein aktiver Moment für
  // Karte, Graph und Kilometer, dazu der markierte Kilometer.
  const [series, setSeries] = useState<RunSeries | null>(null);
  const [seriesIndex, setSeriesIndex] = useState<number | null>(null);
  const [splitIndex, setSplitIndex] = useState<number | null>(null);
  // Ob die Krafthistorie geladen (oder als nicht verfügbar erkannt) ist.
  const [strengthHistorySettled, setStrengthHistorySettled] = useState(false);
  // Trainingschat nur mit eingerichtetem OpenRouter-Zugang anbieten.
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
  // Nur Läufe tragen diese Tempoauswertung und Kilometer; Radfahrten stehen daneben.
  const runningRuns = useMemo(() => runs.filter(isRun), [runs]);
  // Zielnähe: Schätzung aus tatsächlichen Läufen, getrennt von jeder Empfehlung.
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
    [
      settings.goal,
      settings.goalDistanceKm,
      settings.goalTargetDate,
      settings.goalTargetSeconds,
      schedule.goal,
      runningRuns,
      now,
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
  // Je Bereich höchstens eine offene Empfehlung; beide teilen sich die Liste.
  const experiment = activeExperimentFor(settings.experiments, 'running');
  const strengthExperiment = activeExperimentFor(
    settings.experiments,
    'strength',
  );
  const analyses = useMemo(
    () =>
      runningRuns.map(run => ({
        run,
        analysis: analyzeRun(run, experiment, runningRuns),
      })),
    [runningRuns, experiment],
  );
  const finishedSessions = useMemo(
    () => strengthSessions.filter(session => session.status === 'finished'),
    [strengthSessions],
  );
  // Läufe und Krafteinheiten in einer Zeitachse, neueste zuerst.
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
  // Ein Filter ohne passende Einheiten (z. B. nach dem Löschen der letzten
  // Radfahrt) ist ausgeblendet und darf die Liste nicht leer halten.
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
    [visibleUnits, todayKey],
  );
  const selection = useMemo(
    () =>
      selectRecommendations(runningRuns, {
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
    [
      runningRuns,
      experiment,
      strengthExperiment,
      settings.experiments,
      settings.dismissedRecommendations,
      settings.postponedUntil,
      settings.trainingFocus,
      settings.goalTargetDate,
      schedule.goal?.targetDate,
      now,
    ],
  );
  const candidate = experiment || !runRecs ? undefined : selection.selected;
  const queued =
    experiment && runRecs && features.recommendations.showQueued
      ? selection.selected
      : undefined;
  const strengthSelection = useMemo(
    () =>
      selectStrengthRecommendation(finishedSessions, {
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
    [
      finishedSessions,
      strengthExperiment,
      experiment,
      settings.experiments,
      settings.dismissedRecommendations,
      settings.strengthPostponedUntil,
      settings.strengthFocus,
      settings.strengthGoalTargetDate,
      now,
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
  // Eine abgewählte Sportart fällt auf die erste erlaubte zurück.
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
          : 'Die Aktion konnte nicht abgeschlossen werden. Bitte erneut versuchen.',
      );
    } finally {
      stateGeneration.current += 1;
      busyRef.current = false;
      setBusy(false);
    }
  }, []);
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
    if (!url) throw new Error('Diese Route kann nicht geöffnet werden.');
    await Linking.openURL(url);
  }, []);

  const openCoMaps = useCallback(async (points: RouteCoordinate[]) => {
    await native.openRouteFile(points, 'comaps');
  }, []);
  // Drei Dateien zum Weitergeben (z. B. an ein Sprachmodell): der Bericht
  // für Menschen, die Analyse als JSON und die 5-s-Zeitreihe als CSV. Die
  // Zeitreihe schreibt Kotlin direkt in den Export-Cache; fehlt sie oder der
  // Zeitverlauf, fehlt nur dieser Teil — der Rest wird trotzdem geteilt.
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
          'Wähle mindestens einen Lauf im Zeitraum oder in der Liste.',
        );
      const current = stateRef.current;
      const archive = await native.beginRunArchive();
      try {
        for (const [index, id] of ids.entries()) {
          setExportProgress(`${index + 1} von ${ids.length} Läufen`);
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
        // Ohne Zeitreihe (Import, Altdaten) bleiben Bericht und Analyse.
      }
      await native.shareFiles(files, `${sportWords(run.sport).noun} teilen`);
    });
  };

  useEffect(() => {
    void refresh()
      .catch(e => setError(String(e.message)))
      .finally(() => setLoading(false));
  }, [refresh]);
  // Krafttraining wird getrennt geladen. Fehlt die native Unterstützung, bleibt
  // der Zustand leer und der Rest der App unberührt (Grundregel 7).
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
  // Der Puls kommt von der Uhr erst nach dem Training an; deshalb bei jedem
  // Wechsel des Tabs und nach neuen Einheiten nachfragen. Ohne Uhr bleibt es leer.
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
    if (!selectedSessionId) return;
    let cancelled = false;
    native
      .strengthHeart?.(selectedSessionId)
      .then(next => {
        if (!cancelled) setSessionHeart(next);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [selectedSessionId]);
  const loadProseReady = useCallback(() => {
    void nativeCall<{ enabled?: boolean; hasKey?: boolean }>('getProseSettings')
      .then(value => setProseReady(Boolean(value?.enabled && value?.hasKey)))
      .catch(() => setProseReady(false));
  }, []);
  useEffect(() => {
    loadProseReady();
  }, [loadProseReady]);
  // Die Abfrage erscheint höchstens einmal je Sitzung, und nur wenn die
  // Einstellung es will (`shouldPromptSoreness`).
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
  // Sekundentakt nur, solange eine Pause läuft und der Timer sichtbar ist.
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
  // Verschwindet der aktuelle Tab (Plan abgeschaltet), geht es zu Heute.
  useEffect(() => {
    if (!tabs.includes(tab)) {
      setTab('Heute');
      setPage('main');
    }
  }, [tabs, tab]);
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
        if (tab !== 'Heute') {
          setTab('Heute');
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
            void native.strengthSessions(500)
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
            e instanceof Error ? e.message : 'Importe konnten nicht geladen werden.',
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
  // Die Reihe kommt getrennt vom Lauf, weil sie größer ist und nur die
  // Detailseite sie braucht. Fehlt sie (Import ohne Spur, alter Build), gibt
  // es keinen Verlauf — keine Ersatzdaten.
  const selectedId = selected?.id;
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
  }, [selectedId]);
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
    // Bestehende Nutzer sehen bis zum ersten Besuch einen Hinweis auf Heute;
    // der erste Besuch schreibt die Standardwerte und beendet ihn.
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
      // Ohne Beginn kein Planstand und kein Aufbau: heute vorschlagen, der
      // Nutzer sieht und ändert es im Feld.
      setGoalStartInput(
        dateToInput(schedule.goal?.startDate || localDateKey(now)),
      );
      setGoalTargetInput(
        dateToInput(settings.goalTargetDate || schedule.goal?.targetDate || ''),
      );
      setGoalPhaseInput(schedule.goal?.phase || '');
      const distanceKm = settings.goalDistanceKm ?? schedule.goal?.distanceKm;
      setGoalDistanceInput(
        distanceKm === undefined ? '' : String(distanceKm).replace('.', ','),
      );
      const targetSeconds =
        settings.goalTargetSeconds ?? schedule.goal?.targetSeconds;
      // Immer h:mm:ss, damit „59:30“ beim Speichern nicht als Stunden gilt.
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
    switchTab('Coach');
  };
  // Eine Ebene zurück: aus der Tiefe des Krafttrainings dorthin, woher man
  // kam, sonst zur festen Elternseite.
  const leavePage = () => {
    const last = DEPTH_PAGES.includes(page) ? trail[trail.length - 1] : undefined;
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
        patch.experiments = settings.experiments?.map(item =>
          pausing.includes(item.id)
            ? transitionExperiment(item, 'paused', at, 'Funktion abgeschaltet')
            : item,
        );
      }
      save(patch);
    };
    const warnings = [
      features.areas.strength && !next.areas.strength && strength.active
        ? 'Ein Krafttraining läuft gerade; es bleibt gespeichert.'
        : '',
      pausing.length
        ? 'Die laufende Empfehlung wird pausiert, nicht abgebrochen.'
        : '',
    ].filter(Boolean);
    if (!warnings.length) {
      apply();
      return;
    }
    Alert.alert('Trotzdem ausblenden?', warnings.join(' '), [
      { text: 'Zurück', style: 'cancel' },
      { text: 'Ausblenden', onPress: apply },
    ]);
  };

  // ── Krafttraining ────────────────────────────────────────────────────────
  // Jede Änderung schreibt die laufende Einheit sofort weg, damit ein Absturz
  // oder ein leerer Akku keine bestätigten Sätze verliert (T-4).
  const persistSession = useCallback((next: StrengthSession) => {
    setStrength(current => ({ ...current, active: next }));
    void native.saveStrengthSession(next).catch(e => setError(e.message));
  }, []);
  const changeSession = useCallback(
    (change: (session: StrengthSession) => StrengthSession) => {
      const active = strengthRef.current.active;
      if (active) {
        persistSession(change(active));
      }
    },
    [persistSession],
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
  const startStrength = (template: WorkoutTemplate | null) => {
    if (strengthRef.current.active) {
      setWorkoutOpen(true);
      return;
    }
    void action(async () => {
      const session = startSession(template, Date.now());
      setStrength(current => ({ ...current, active: session }));
      setWorkoutOpen(true);
      setNow(Date.now());
      await loadRecentSessions(strengthRef.current);
      await native.saveStrengthSession(session);
    });
  };
  const finishStrength = () => {
    const active = strengthRef.current.active;
    if (!active) {
      return;
    }
    const finished = finishSession(active, Date.now());
    void action(async () => {
      const next = await native.finishStrengthSession(finished);
      setStrength(next);
      try {
        setStrengthSessions(await native.strengthSessions(500));
        setStrengthHistoryAvailable(true);
      } catch {
        setStrengthHistoryAvailable(false);
      }
      setWorkoutOpen(false);
      setMessage('Training gespeichert.');
    });
  };
  // Pläne bleiben Nutzerartefakte: geschrieben wird nur, was der Nutzer hier
  // ausdrücklich bestätigt hat (T-6).
  const persistTemplates = (next: WorkoutTemplate[]) => {
    setStrength(current => ({ ...current, templates: next }));
    void native.saveStrengthTemplates(next).catch(e => setError(e.message));
  };
  const todaysScheduledRun = schedule.sessions.find(
    item =>
      item.date === todayKey &&
      item.kind === 'run' &&
      item.status === 'planned' &&
      !item.activityId,
  );
  const todaysScheduledStrength = schedule.sessions.find(
    item =>
      item.date === todayKey &&
      item.kind === 'strength' &&
      item.status === 'planned' &&
      !item.activityId,
  );
  const hasStrengthCalendar = schedule.sessions.some(
    item => item.kind === 'strength',
  );
  const todaysTemplate = hasStrengthCalendar
    ? strength.templates.find(
        item => item.id === todaysScheduledStrength?.templateId,
      ) ?? null
    : features.strength.templateOfDay
    ? templateForDay(strength.templates, new Date(now).getDay())
    : null;
  // Eine Aufzeichnung braucht die Standortfreigabe, sonst nichts: keine
  // Planung, keine Vorlage. Sportart und Laufart sind Beschriftung, nicht Vorgabe.
  const beginRecording = async (
    nextPurpose: RunPurpose,
    nextSport: Sport,
  ): Promise<Run> => {
    const permissions = await nativeCall<{ locationPermission: boolean }>(
      'requestRecordingPermissions',
    );
    if (!permissions.locationPermission) {
      throw new Error(
        'Für die Streckenaufzeichnung fehlt die genaue Standortfreigabe. Du kannst sie in den Android-App-Einstellungen ändern.',
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
        'Die Aufzeichnung konnte noch nicht geladen werden. Prüfe die Startseite.',
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
      switchTab('Heute');
    });
  };
  // Das Start-Sheet öffnet mit der Art, die man auf Heute angetippt hat; die
  // Kraftvorlage von heute ist vorausgewählt, sonst die erste vorhandene.
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
      throw new Error('Eine Aktion läuft noch. Bitte gleich erneut versuchen.');
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
          const message =
            'Die Zuordnung konnte noch nicht gespeichert werden. Öffne Planung und tippe die Einheit erneut an.';
          setError(message);
          throw new Error(message);
        }
        if (entry.kind === 'run') {
          switchTab('Heute');
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
          'Diese Einheit ist nicht für heute geplant. Verschiebe sie zuerst auf heute.',
        );
      }
      if (entry.activityId) {
        if (stateRef.current.recording?.id === entry.activityId) {
          switchTab('Heute');
          return;
        }
        if (strengthRef.current.active?.id === entry.activityId) {
          setWorkoutOpen(true);
          return;
        }
        throw new Error(
          'Diese Einheit wurde bereits gestartet. Die Aufzeichnung findest du im Verlauf.',
        );
      }
      if (stateRef.current.recording || strengthRef.current.active) {
        throw new Error('Beende zuerst dein laufendes Training.');
      }
      let activityId: string;
      if (entry.kind === 'run') {
        const active = await beginRecording(entry.purpose || 'free', 'running');
        activityId = active.id;
        pendingScheduleLink.current = { entryId: entry.id, activityId };
        switchTab('Heute');
      } else {
        const template = entry.templateId
          ? strengthRef.current.templates.find(
              item => item.id === entry.templateId,
            )
          : null;
        if (entry.templateId && !template) {
          throw new Error(
            'Die Kraftvorlage fehlt. Wähle in der geplanten Einheit eine vorhandene Vorlage.',
          );
        }
        const session = startSession(template ?? null, Date.now(), entry.title);
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
        const message =
          'Das Training läuft. Die Zuordnung konnte noch nicht gespeichert werden. Öffne Planung und tippe die Einheit erneut an.';
        setError(message);
        throw new Error(message);
      }
    });
  const stop = () => {
    const stopWords = sportWords(recording?.sport);
    Alert.alert(
      `${stopWords.noun} beenden?`,
      `Deine bisherige Aufzeichnung wird gespeichert. Du kannst danach noch dein ${stopWords.feelingLabel} ergänzen.`,
      [
        { text: stopWords.continueLabel, style: 'cancel' },
        {
          text: 'Beenden & speichern',
          onPress: () => {
            void action(async () => {
              const id = recording?.id;
              await nativeCall('finishRun');
              const next = await refresh();
              if (features.recording.afterRun === 'home') {
                setMessage(
                  'Aufzeichnung gespeichert. Dein Gefühl kannst du im Verlauf nachtragen.',
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
        'Vom Nutzer geändert',
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
        // Liest nur; gespeichert wird erst nach der Wahl im Sheet „Import prüfen“.
        const result = await nativeCall<any>('importFiles');
        setImportStatus(result.cancelled ? null : result);
      } finally {
        clearInterval(timer);
      }
    });
  };
  const afterImportChange = async () => {
    // Vorlagen sind eigene Dokumente und ändern sich durch Importe nicht.
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
      setMessage('Import gelöscht.');
    });
  };
  const runImport = () => beginImport(false);
  const runVendorImport = () => beginImport(true);
  const cancelImport = () => {
    void nativeCall<any>('cancelImport')
      .then(setImportStatus)
      .catch(e => setError(e.message));
  };
  // Nur Zähler, die etwas sagen: „Importiert“ immer, der Rest ab 1.
  const importSummary =
    importStatus && importStatus.state !== 'review'
    ? [
        `Importiert: ${importStatus.imported ?? 0}`,
        ...(
          [
            ['Doppelt', importStatus.duplicates],
            ['Keine Läufe', importStatus.nonRunning],
            ['Übersprungen', importStatus.skipped],
            ['Fehlgeschlagen', importStatus.failed],
            ['Kontextwerte', importStatus.wellness],
            ['Krafteinheiten', importStatus.strength],
            ['Nicht gewählt', importStatus.excluded],
          ] as [string, number | undefined][]
        )
          .filter(([, count]) => (count ?? 0) > 0)
          .map(([label, count]) => `${label}: ${count}`),
      ].join(' · ')
    : '';
  // Die Laufauswertung gilt nur für Läufe. Bei anderen Sportarten erscheint
  // sie gar nicht statt mit falschen Zahlen (Spec T-1).
  const snapshot =
    selected && isRun(selected)
      ? analyzeRun(selected, experiment, runningRuns)
      : null;
  // Vergleich mit den letzten Läufen färbt die Kacheln oben; er gilt wie die
  // Auswertung nur für Läufe.
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
        'Für die Spracheingabe fehlt die Mikrofonfreigabe. Tippen funktioniert unverändert.',
      );
    }
    if (!capabilities.speechRecognition) {
      throw new Error('Auf diesem Gerät ist keine Spracherkennung verfügbar.');
    }
    return native.transcribeSoreness();
  };
  const saveSoreness = (report: CapturedSorenessReport) => {
    void action(async () => {
      const next = await native.saveSorenessReport(report);
      setSorenessReports(next);
      setSorenessOpen(false);
      setMessage('Muskelkatermeldung gespeichert.');
    });
  };

  // Startseite: eine Frage — was mache ich jetzt? Die Antwort ist eine Karte
  // mit einem Button. Darunter nur, was heute zählt: die laufende Empfehlung,
  // ein Körper-Check, die letzten zwei Einheiten. Fokus, Ziel, Vorlagen und
  // Karte haben ihren Ort in Coach, Plan und Verlauf.
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
        title="Laufen nach"
        subtitle={runTargetLabel(targetForPurpose(runTarget, nextPurpose))}
        onPress={() => {
          setStartSheet(null);
          openPage('run-target');
        }}
      />
    ) : null;
  const shortVerdict = (verdict: string | undefined) =>
    verdict === 'improved'
      ? 'hat geholfen'
      : verdict === 'worsened'
      ? 'eher nicht geholfen'
      : verdict === 'no_relevant_effect'
      ? 'kein Unterschied'
      : verdict === 'not_implemented'
      ? 'noch nicht ausprobiert'
      : 'noch nicht klar';
  const runEvaluation = experiment
    ? evaluateExperiment(experiment, runningRuns, settings.adherence)
    : null;
  const strengthEvaluation = strengthExperiment
    ? evaluateAnyExperiment(
        strengthExperiment,
        runningRuns,
        strengthSessions,
        settings.adherence,
      )
    : null;
  /** Kompakte Karte je Bereich: Zustand, Fortschritt, ein Tipp führt zum Coach. */
  const recommendationCard = (area: 'running' | 'strength') => {
    if (!recommendationsSuggested(features, area)) {
      return null;
    }
    const active = area === 'running' ? experiment : strengthExperiment;
    const evaluation = area === 'running' ? runEvaluation : strengthEvaluation;
    const proposal = area === 'running' ? candidate : strengthCandidate;
    const areaWord = area === 'running' ? 'Läufen' : 'Einheiten';
    if (active && evaluation) {
      const minimum = active.recommendation.criteria.minimumObservations;
      const done = evaluation.eligibleRunIds.length;
      return (
        <Pressable
          key={area}
          accessibilityRole="button"
          accessibilityLabel={`Empfehlung ${AREA_LABELS[area]}: ${active.recommendation.action}`}
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
              {active.status === 'paused' ? 'Pausiert' : 'Aktiv'}
            </Badge>
            <Text style={styles.muted}>
              {AREA_LABELS[area]} · {done} von {minimum} {areaWord} ·{' '}
              {shortVerdict(evaluation.verdict)}
            </Text>
          </View>
          <Progress
            value={minimum ? done / minimum : 0}
            label={`${done} von ${minimum} geeigneten ${areaWord}`}
          />
        </Pressable>
      );
    }
    if (proposal) {
      return (
        <Pressable
          key={area}
          accessibilityRole="button"
          accessibilityLabel={`Vorschlag ${AREA_LABELS[area]}: ${proposal.action}`}
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
            <Badge>Vorschlag</Badge>
            <Text style={styles.muted}>
              {AREA_LABELS[area]} · Prüfe, ob er zu dir passt.
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
  // Wochenleiste: sieben Tage, ein Punkt je Tag — grün für eine erfasste
  // Einheit, grau für eine geplante. Ein Tipp öffnet den Plan.
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
        accessibilityLabel="Diese Woche im Plan ansehen"
        onPress={() => switchTab('Plan')}
        style={({ pressed }) => [styles.weekStrip, pressed && styles.pressed]}
      >
        {WEEKDAY_SHORT.map((label, index) => {
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
          <Text style={styles.heroLabel}>Training läuft</Text>
          <Text style={styles.heroTitle}>{strength.active.name}</Text>
          <Copy muted>Krafttraining · seit {minutes} Minuten</Copy>
          <Button
            title="Training fortsetzen"
            onPress={() => {
              setNow(Date.now());
              setWorkoutOpen(true);
            }}
          />
        </Card>
      );
    }
    // Ohne Bereich Laufen startet „etwas anderes“ direkt beim Krafttraining.
    const otherKind: StartKind = sports.length ? 'run' : 'strength';
    if (todaysScheduledRun && showRunning) {
      const plannedPurpose = todaysScheduledRun.purpose || 'free';
      return (
        <Card style={styles.hero}>
          <Text style={styles.heroLabel}>Heute geplant</Text>
          <Text style={styles.heroTitle}>{todaysScheduledRun.title}</Text>
          <Copy muted>
            Lauf · {todaysScheduledRun.minutes} Min ·{' '}
            {purposeLabel(plannedPurpose)}
          </Copy>
          {targetRow(plannedPurpose)}
          <Button
            title="Lauf starten"
            onPress={startPlannedRun}
            disabled={busy}
          />
          {todaysScheduledStrength && showStrength ? (
            <Row
              title={todaysScheduledStrength.title}
              subtitle={`Krafttraining · ${todaysScheduledStrength.minutes} Min · ebenfalls heute`}
              onPress={startPlannedStrength}
            />
          ) : null}
          <Button
            secondary
            small
            title="Stattdessen etwas anderes starten"
            onPress={() => openStartSheet(otherKind)}
            disabled={busy}
          />
        </Card>
      );
    }
    if (showStrength && (todaysScheduledStrength || todaysTemplate)) {
      const title = todaysScheduledStrength?.title ?? todaysTemplate!.name;
      const exerciseCount = todaysTemplate?.exercises.length ?? 0;
      return (
        <Card style={styles.hero}>
          <Text style={styles.heroLabel}>
            {todaysScheduledStrength ? 'Heute geplant' : 'Heute vorgesehen'}
          </Text>
          <Text style={styles.heroTitle}>{title}</Text>
          <Copy muted>
            Krafttraining
            {todaysScheduledStrength
              ? ` · ${todaysScheduledStrength.minutes} Min`
              : ''}
            {exerciseCount
              ? ` · ${counted(exerciseCount, 'Übung', 'Übungen')}`
              : ''}
          </Copy>
          <Button
            title="Training starten"
            onPress={startPlannedStrength}
            disabled={busy}
          />
          <Button
            secondary
            small
            title="Stattdessen etwas anderes starten"
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
          <Text style={styles.heroLabel}>Heute erledigt ✓</Text>
          <Text style={styles.heroTitle}>
            {first ? unitTitle(first) : todaysLinked[0].title}
          </Text>
          <Copy muted>
            {first
              ? `${unitKindLabel(first)} · ${unitSummary(first)}`
              : 'Gestartet, noch nicht abgeschlossen.'}
          </Copy>
          <Button
            secondary
            title="Noch eine Einheit starten"
            onPress={() => openStartSheet(otherKind)}
            disabled={busy}
          />
        </Card>
      );
    }
    return (
      <Card style={styles.hero}>
        <Text style={styles.heroTitle}>Heute frei</Text>
        {nextPlanned ? (
          <Copy muted>
            {`Als Nächstes: ${nextPlanned.title} · ${date(
              new Date(`${nextPlanned.date}T12:00:00`).getTime(),
            )}`}
          </Copy>
        ) : null}
        {sports.length ? (
          <Button
            title={`${words.noun} starten`}
            onPress={() => openStartSheet('run')}
            disabled={busy}
          />
        ) : null}
        {showStrength ? (
          <Button
            secondary={sports.length > 0}
            title="Krafttraining starten"
            onPress={() => openStartSheet('strength')}
            disabled={busy}
          />
        ) : null}
      </Card>
    );
  };
  // Auf Heute steht die Empfehlung für die Einheit, die gerade ansteht — nie
  // beide untereinander (Spec „Zwei Bereiche“). Fehlt sie, die des anderen.
  const heroArea: 'running' | 'strength' =
    strength.active ||
    (!todaysScheduledRun && (todaysScheduledStrength || todaysTemplate))
      ? 'strength'
      : 'running';
  const renderHome = () => (
    <>
      <Title>Heute</Title>
      {homeSections.includes('week') ? weekStrip() : null}
      {renderHero()}
      {!settings.features && settings.onboardedAt ? (
        <Row
          title="Neu: Wähle, was Runback zeigt"
          subtitle="Bereiche, Muskelkater, Plan und mehr abwählen"
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
          title="Wie fühlst du dich heute?"
          subtitle={
            latestSoreness
              ? `Muskelkater melden · zuletzt ${date(latestSoreness.at)}`
              : 'Muskelkater melden'
          }
          onPress={openSorenessCapture}
        />
      ) : null}
      {!homeSections.includes('recent') ? null : units.length ? (
        <Section title="Zuletzt">
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
              title="Alle Einheiten"
              subtitle={counted(units.length, 'Einheit', 'Einheiten')}
              onPress={() => switchTab('Verlauf')}
            />
          ) : null}
        </Section>
      ) : (
        <EmptyState
          title="Noch keine Einheit"
          copy="Dein erster Lauf und dein erstes Krafttraining erscheinen hier. Vorhandene Historie importierst du in den Einstellungen unter „Deine Daten“."
        />
      )}
    </>
  );

  // Start-Sheet: alles, was eine Aufzeichnung beschreibt, an einem Ort — mit
  // der letzten Wahl als Vorgabe. Im Normalfall: ein Tipp, dann „Los“.
  const startKindValue: 'running' | 'cycling' | 'strength' =
    startSheet === 'strength' ? 'strength' : sport;
  const startKinds = START_KINDS.filter(kind =>
    kind.value === 'strength' ? showStrength : sports.includes(kind.value),
  );
  const selectedTemplate =
    strength.templates.find(item => item.id === startTemplateId) ?? null;
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
      title="Was startest du?"
      onClose={() => setStartSheet(null)}
    >
      {startKinds.length > 1 ? (
        <Segmented
          label="Art der Einheit"
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
          {strength.templates.map(item => (
            <Row
              key={item.id}
              title={item.name}
              subtitle={`${counted(item.exercises.length, 'Übung', 'Übungen')}${
                todaysScheduledStrength?.templateId === item.id ||
                (!todaysScheduledStrength && todaysTemplate?.id === item.id)
                  ? ' · heute vorgesehen'
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
            title="Frei trainieren"
            subtitle="Übungen während der Einheit wählen"
            onPress={() => setStartTemplateId(null)}
            trailing={
              <Text style={styles.greenText}>
                {startTemplateId === null ? '✓' : ''}
              </Text>
            }
          />
          <Row
            title="Vorlagen verwalten"
            onPress={() => {
              setStartSheet(null);
              setTemplatesView('strength');
              openPage('templates');
            }}
          />
        </>
      ) : (
        <>
          {settings.presets?.length ? (
            <Field label="Vorlage">
              <ChipGroup
                label="Laufvorlage"
                options={[
                  ...settings.presets.map(p => ({
                    value: p.id,
                    label: p.name,
                  })),
                  { value: '', label: 'Ohne' },
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
          <Field label="Wie willst du laufen?">
            <ChipGroup
              label="Laufart dieser Aufzeichnung"
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
            // Der Trageort ändert sich selten: zu, mit der letzten Wahl als Wert.
            <Disclosure
              title="Handy"
              subtitle={
                PHONE_PLACEMENTS.find(
                  item =>
                    item.value === normalizePlacement(settings.gaitPlacement),
                )?.label
              }
            >
              <ChipGroup
                label="Wo das Handy beim Laufen steckt"
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
            ? 'Training starten'
            : 'Aufzeichnung starten'
        }
        onPress={startFromSheet}
        disabled={busy}
      />
    </Sheet>
  );

  // Laufart nachtragen: ein Lauf je Schritt, neueste zuerst. Weiter geht es erst,
  // wenn die Wahl gespeichert ist; Übersprungenes bleibt offen und wird am
  // Ende genannt.
  const purposeOpen = runningRuns.filter(purposeMissing);
  const purposeQueue = purposeOpen.filter(
    run => !purposeSkipped.includes(run.id),
  );
  const purposeRun = purposeQueue[0];
  const renderPurposeSheet = () => (
    <Sheet
      visible={purposeSheet}
      title="Laufart nachtragen"
      onClose={() => setPurposeSheet(false)}
    >
      {error ? (
        <Notice title="Nicht gespeichert" onDismiss={() => setError('')}>
          {error}
        </Notice>
      ) : null}
      {purposeRun ? (
        <>
          <Copy muted>
            {`Noch ${counted(purposeQueue.length, 'Lauf', 'Läufe')} ohne Laufart`}
          </Copy>
          <Row
            title={runTitle(purposeRun)}
            subtitle={`${date(purposeRun.startTime)} · ${distance(
              purposeRun,
            )} km · ${tempoValue(purposeRun)} ${tempoUnit(purposeRun)}`}
          />
          <ChipGroup
            label={`Laufart von ${runTitle(purposeRun)}`}
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
            title="Überspringen"
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
              ? `Durchgesehen. ${counted(
                  purposeOpen.length,
                  'Lauf bleibt',
                  'Läufe bleiben',
                )} ohne Laufart.`
              : 'Jeder Lauf hat jetzt eine Laufart.'}
          </Copy>
          <Button title="Fertig" onPress={() => setPurposeSheet(false)} />
        </>
      )}
    </Sheet>
  );

  // Plus und Minus ändern nur das Ziel dieses Laufs; die gespeicherte Vorgabe
  // für den nächsten Lauf bleibt, wie der Nutzer sie im Coach gewählt hat.
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
              ? `${recordingWords.noun} läuft`
              : recording.status === 'paused'
              ? `${recordingWords.noun} pausiert`
              : `${recordingWords.noun} unterbrochen`}
          </Text>
          <Copy muted>{purposeLabel(recording.purpose)}</Copy>
        </View>
        <View style={styles.bigMetric}>
          {primary === 'distance' ? (
            <Stat large value={distance(recording)} label="Kilometer" />
          ) : primary === 'heartRate' ? (
            <Stat
              large
              value={
                recording.avgHeartRate
                  ? String(Math.round(recording.avgHeartRate))
                  : '–'
              }
              label="Ø bpm"
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
              <Stat value={distance(recording)} label="Kilometer" />
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
            title="Herzfrequenz"
            trailing={
              <Copy>
                {recording.avgHeartRate
                  ? `${Math.round(recording.avgHeartRate)} bpm`
                  : 'Keine Daten'}
              </Copy>
            }
          />
        ) : null}
        {metrics.includes('target') &&
        recording.target &&
        recording.target.kind !== 'none' ? (
          <Row
            title="Laufen nach"
            subtitle={runTargetLabel(recording.target)}
            trailing={
              recording.target.kind === 'pace' ? (
                <Stepper
                  decreaseLabel={`Zieltempo ${PACE_STEP_SECONDS} Sekunden schneller`}
                  increaseLabel={`Zieltempo ${PACE_STEP_SECONDS} Sekunden langsamer`}
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
            Noch keine Strecke gemessen. Geh für GPS nach draußen.
          </Copy>
        )}
        {recording.status === 'interrupted' ? (
          <Copy>
            Die Aufzeichnung wurde unterbrochen. Die Lücke bleibt in deinen
            Daten erkennbar.
          </Copy>
        ) : null}
        {experiment?.status === 'active' &&
        runRecsSuggested &&
        isRun(recording) ? (
          <Section title="Für diesen Lauf">
            <Copy>{experiment.recommendation.action}</Copy>
          </Section>
        ) : null}
        <View style={styles.recordingActions}>
          <Button
            title={recording.status === 'recording' ? 'Pause' : 'Fortsetzen'}
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
            title={`${recordingWords.noun} beenden`}
            onPress={stop}
            disabled={busy}
          />
        </View>
      </>
    );
  };

  // Prüfkriterien bleiben nachvollziehbar, stehen aber hinter einem Schalter:
  // Auf der Seite steht die Handlung, nicht das Verfahren.
  const renderCriteria = (recommendation: Recommendation, accepted = false) => (
    <>
      <Copy>Woran erkennen wir, dass es geholfen hat?</Copy>
      <Copy muted>{recommendation.goal}</Copy>
      <Copy muted>
        {accepted
          ? 'Vor dem Start festgelegt. Ein Fokuswechsel ändert diese Regeln nicht.'
          : 'Bei der Annahme werden diese Regeln festgeschrieben.'}
      </Copy>
      <Copy muted>
        Ab {recommendation.criteria.minimumObservations} geeigneten Läufen über
        mindestens {recommendation.criteria.minimumDays} Tage · Vorzeichentest:
        häufiger als zufällig mindestens{' '}
        {recommendation.criteria.minimumRelevantChangePercentPoints}{' '}
        Prozentpunkte weniger Tempoabfall als der Median der Vergleichsläufe (
        {number(recommendation.criteria.baselineFadePercent, 1)} %)
      </Copy>
      {recommendation.criteria.exclusions.map((text, i) => (
        <Copy muted key={i}>
          {text}
        </Copy>
      ))}
      <Row title="Modellversion" subtitle={recommendation.model_version} />
      <Copy muted>
        Wenn nach {recommendation.criteria.maxDays} Tagen noch zu wenig
        vergleichbare Läufe vorliegen, entscheide neu, wie du weitertrainieren
        möchtest.
      </Copy>
      <Section title="Vergleichsläufe">
        <Copy muted>
          Die Basis ist der Median dieser Läufe, nicht ein einzelner Ausreißer.
        </Copy>
        {recommendation.criteria.baselineRunIds.map(id => {
          const run = runningRuns.find(item => item.id === id);
          return (
            <Row
              key={id}
              title={
                run ? runTitle(run) : 'Vergleichslauf nicht mehr vorhanden'
              }
              subtitle={run ? date(run.startTime) : undefined}
            />
          );
        })}
      </Section>
      <Section title="So priorisiert Runback">
        {recommendation.priority ? (
          <Row
            title={recommendation.priority.focusLabel}
            subtitle={`${recommendation.priority.version} · redaktionelles Gewicht ${recommendation.priority.weight}`}
          />
        ) : (
          <Copy muted>
            Für diese ältere Empfehlung wurde keine Fokus-Priorisierung
            gespeichert.
          </Copy>
        )}
        <Copy muted>
          Die Auswahlregeln sind redaktionell festgelegt. Sie lernen keine
          Vorlieben aus deinen Läufen.
        </Copy>
        <Copy muted>
          Derzeit ist nur der ruhigere Start als überprüfbare Empfehlung
          verfügbar. Pulsverlauf und Schrittfrequenz liefern noch keine eigenen
          Empfehlungen.
        </Copy>
      </Section>
    </>
  );

  const storedRunTitle = (id: string) => {
    const run = runningRuns.find(item => item.id === id);
    return run ? runTitle(run) : 'Lauf nicht mehr vorhanden';
  };
  // Gleicher Grund, gleiche Zeile: 28 Läufe ohne Laufart sind ein Befund.
  const groupedAlternatives = () => {
    const groups = new Map<
      string,
      { key: string; title: string; reason: string; runIds: string[] }
    >();
    selection.alternatives.forEach(item => {
      const title = item.recommendation?.title || 'Starteinteilung';
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
        experiment ? 'Auswahl für danach' : 'Andere geprüfte Möglichkeiten'
      }
    >
      {selection.alternatives.length ? (
        groupedAlternatives().map(group => (
          <Row
            key={group.key}
            title={`${group.title} · ${
              group.runIds.length === 1
                ? storedRunTitle(group.runIds[0])
                : counted(group.runIds.length, 'Lauf', 'Läufe')
            }`}
            subtitle={group.reason}
          />
        ))
      ) : (
        <Copy muted>
          Keine weitere Möglichkeit aus den vorhandenen Daten geprüft.
        </Copy>
      )}
    </Section>
  );
  // Krafttraining hat seine eigene Empfehlungsseite: gleiche drei Fragen,
  // gleiche Zustände, aber an Einheiten und Sätzen geprüft statt an Läufen.
  const sessionTitle = (id: string) => {
    const session = strengthSessions.find(item => item.id === id);
    return session
      ? `${session.name} · ${date(session.startTime)}`
      : 'Einheit nicht mehr vorhanden';
  };
  const renderStrengthCriteria = (
    recommendation: StrengthRecommendation,
    accepted = false,
  ) => (
    <>
      <Copy>Woran erkennen wir, dass es geholfen hat?</Copy>
      <Copy muted>{recommendation.goal}</Copy>
      <Copy muted>
        {accepted
          ? 'Vor dem Start festgelegt. Ein Fokuswechsel ändert diese Regeln nicht.'
          : 'Bei der Annahme werden diese Regeln festgeschrieben.'}
      </Copy>
      <Copy muted>
        Ab {recommendation.criteria.minimumObservations} passenden Einheiten ·
        Zielbereich {number(recommendation.criteria.targetMinKg, 1)}–
        {number(recommendation.criteria.targetMaxKg, 1)} kg ×{' '}
        {recommendation.criteria.targetReps} · Vorzeichentest: häufiger als
        zufällig mindestens{' '}
        {recommendation.criteria.minimumRelevantChangePercent} % über dem Median
        der Vergleichseinheiten
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
      <Row title="Modellversion" subtitle={recommendation.model_version} />
      <Copy muted>
        Wenn nach {recommendation.criteria.maxDays} Tagen noch zu wenig passende
        Einheiten vorliegen, entscheide neu.
      </Copy>
      <Section title="Vergleichseinheiten">
        {recommendation.criteria.baselineSessionIds.map(id => (
          <Row key={id} title={sessionTitle(id)} />
        ))}
      </Section>
      <Section title="So priorisiert Runback">
        {recommendation.priority ? (
          <Row
            title={recommendation.priority.focusLabel}
            subtitle={`${recommendation.priority.version} · redaktionelles Gewicht ${recommendation.priority.weight}`}
          />
        ) : null}
        <Copy muted>
          Die Auswahlregeln sind redaktionell festgelegt. Sie lernen keine
          Vorlieben aus deinen Einheiten. Derzeit ist nur die Last einer Übung
          als überprüfbare Empfehlung verfügbar.
        </Copy>
      </Section>
    </>
  );
  const renderStrengthAlternatives = () => (
    <Section
      title={
        strengthExperiment
          ? 'Auswahl für danach'
          : 'Andere geprüfte Möglichkeiten'
      }
    >
      {strengthSelection.alternatives.length ? (
        strengthSelection.alternatives.map(item => (
          <Row
            key={item.exerciseId}
            title={item.exerciseName}
            subtitle={item.reason}
          />
        ))
      ) : (
        <Copy muted>
          Keine weitere Möglichkeit aus den vorhandenen Einheiten geprüft.
        </Copy>
      )}
    </Section>
  );
  // Coach: die eine Empfehlung je Bereich als Zustandskarte — Etikett,
  // Fortschritt, zwei Fragen. Details und Verwaltung sind eingeklappt, damit
  // die Empfehlung selbst die größte Fläche bleibt. Darunter die Grundlage
  // (Fokus, Ziel) und die Wege, Fragen zu stellen.
  const manageButtons = (target: Experiment) => (
    <>
      <Button
        secondary
        small
        disabled={busy}
        title={
          target.status === 'paused'
            ? 'Empfehlung fortsetzen'
            : 'Empfehlung pausieren'
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
        title="Empfehlung abschließen"
        disabled={busy}
        onPress={() => changeExperiment('completed', target)}
      />
      <Button
        danger
        small
        title="Empfehlung abbrechen"
        disabled={busy}
        onPress={() =>
          Alert.alert(
            'Empfehlung abbrechen?',
            'Die bisherige Prüfung bleibt gespeichert.',
            [
              { text: 'Zurück', style: 'cancel' },
              {
                text: 'Abbrechen',
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
          <Text style={styles.heroLabel}>Deine Empfehlung</Text>
          <Badge muted={target.status === 'paused'}>
            {target.status === 'paused'
              ? 'Pausiert'
              : `Aktiv seit ${date(target.acceptedAt)}`}
          </Badge>
        </View>
        <Text style={styles.cardTitle}>{target.recommendation.action}</Text>
        <Progress
          value={minimum ? done / minimum : 0}
          label={`${done} von ${minimum} geeigneten ${unitWord}`}
        />
        <Copy muted>
          {done} von {minimum} geeigneten {unitWord} · Ergebnis{' '}
          {shortVerdict(evaluation.verdict)}
        </Copy>
        <Row title="Ausprobiert?" subtitle={triedText} />
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
        <Text style={styles.heroLabel}>Neuer Vorschlag</Text>
        <Badge>Vorschlag</Badge>
      </View>
      <Text style={styles.cardTitle}>{proposal.action}</Text>
      <Copy muted>{proposal.reason}</Copy>
      <Button
        title="Empfehlung annehmen"
        onPress={() => accept(proposal)}
        disabled={busy}
      />
      <View style={styles.choiceRow}>
        <View style={styles.flex}>
          <Button
            secondary
            small
            title="Später entscheiden"
            disabled={busy}
            onPress={onPostpone}
          />
        </View>
        <View style={styles.flex}>
          <Button
            secondary
            small
            title="Vorschlag ablehnen"
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
      ? 'Du hast den Vorschlag auf morgen verschoben.'
      : maintaining
      ? analyses[0].analysis.focus
      : !runningRuns.length
      ? 'Dafür fehlt noch ein aufgezeichneter Lauf.'
      : needsPurpose
      ? `Bei ${counted(withoutPurpose, 'Lauf', 'Läufen')} fehlt die Laufart.`
      : 'Vorschläge entstehen aus ruhigen und langen Runden mit mindestens vier gleichmäßigen Abschnitten ab 500 m.';
    const past = (settings.experiments || []).filter(
      (e): e is Experiment<Recommendation> =>
        (e.status === 'completed' || e.status === 'aborted') &&
        isRunRecommendation(e.recommendation),
    );
    return (
      <>
        {experiment && evaluation ? (
          <>
            {activeCard(
              experiment,
              evaluation,
              evaluation.adherence.some(item => item.value === 'yes')
                ? 'Ja, in passenden Läufen.'
                : evaluation.verdict === 'not_implemented'
                ? 'Du hast es bisher nicht probiert.'
                : 'Noch nicht klar.',
              'Gleichmäßiger gelaufen?',
              evaluation.verdict === 'improved'
                ? 'Ja, häufiger als zufällig. Über Tempo oder Fitness sagt das nichts.'
                : evaluation.verdict === 'worsened'
                ? 'Nein, du hast zum Ende häufiger mehr Tempo verloren.'
                : evaluation.verdict === 'no_relevant_effect'
                ? 'Kein spürbarer Unterschied.'
                : 'Noch nicht klar.',
              'Ob es an der Empfehlung lag, bleibt offen. Wetter und Tagesform können mitwirken.',
              'Läufen',
            )}
            {queued ? (
              <Row
                title="Danach vorgesehen"
                subtitle={`${queued.action} · Vorschau, wird nach Abschluss geprüft`}
              />
            ) : null}
            <Disclosure
              title="Details"
              subtitle="Prüfregeln, Vergleichsläufe, ausgeschlossene Läufe"
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
                <Section title="Grundlage der Vorschau">
                  <Copy muted>{queued.reason}</Copy>
                  {renderCriteria(queued)}
                </Section>
              ) : null}
              {renderAlternatives()}
            </Disclosure>
            <Disclosure
              title="Empfehlung verwalten"
              subtitle="Pausieren, abschließen, abbrechen"
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
              title="Details"
              subtitle="Woran wir erkennen, ob es hilft"
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
                  ? 'Entscheide morgen in Ruhe.'
                  : maintaining
                  ? 'Behalte deine Einteilung bei.'
                  : 'Noch keine Empfehlung'
              }
              copy={missing}
              action={
                postponed
                  ? {
                      title: 'Vorschlag jetzt ansehen',
                      onPress: () => save({ postponedUntil: 0 }),
                    }
                  : runningRuns.length
                  ? needsPurpose
                    ? {
                        title: 'Laufart nachtragen',
                        onPress: () => {
                          setPurposeSkipped([]);
                          setPurposeSheet(true);
                        },
                      }
                    : {
                        title: 'Einheiten ansehen',
                        onPress: () => switchTab('Verlauf'),
                      }
                  : {
                      title: 'Ersten Lauf starten',
                      onPress: () => switchTab('Heute'),
                    }
              }
            />
            {selection.alternatives.length ? (
              <Disclosure
                title="Details"
                subtitle="Andere geprüfte Möglichkeiten"
                open={criteriaOpen}
                onToggle={setCriteriaOpen}
              >
                {renderAlternatives()}
              </Disclosure>
            ) : null}
          </>
        )}
        <Section title="Grundlage">
          <Row
            title="Fokus"
            subtitle={focusLabel(settings.trainingFocus)}
            onPress={() => openPage('focus-running')}
          />
          <Row
            title="Ziel"
            subtitle={
              racePrediction.status === 'estimated' &&
              racePrediction.predictedSeconds !== undefined
                ? `${racePrediction.goal} · etwa ${formatGoalTime(
                    racePrediction.predictedSeconds,
                  )} geschätzt`
                : settings.goal || schedule.goal?.name || 'Kein Ziel gesetzt'
            }
            onPress={() => openPage('goal')}
          />
          <Row
            title="Zielzeiten"
            subtitle="Geschätzte Zeiten von 1 km bis Marathon"
            onPress={() => openPage('distance-times')}
          />
        </Section>
        {past.length ? (
          <Section title="Frühere Empfehlungen">
            {past.map(e => (
              <Card key={e.id}>
                <Copy>{e.recommendation.action}</Copy>
                <Copy muted>{`${
                  e.status === 'completed' ? 'Abgeschlossen' : 'Abgebrochen'
                } · ${
                  evaluateExperiment(e, runningRuns, settings.adherence).summary
                }`}</Copy>
                <Button
                  secondary
                  small
                  title={
                    pastRecommendationOpen === e.id
                      ? 'Gespeicherte Details ausblenden'
                      : 'Gespeicherte Details ansehen'
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
        {strengthExperiment && evaluation ? (
          <>
            {activeCard(
              strengthExperiment,
              evaluation,
              evaluation.adherence.some(item => item.value === 'yes')
                ? 'Ja, in passenden Einheiten.'
                : evaluation.verdict === 'not_implemented'
                ? 'Du hast es bisher nicht probiert.'
                : 'Noch nicht klar.',
              'Besser geworden?',
              evaluation.verdict === 'improved'
                ? 'Dein bestes Arbeitsgewicht lag häufiger als zufällig darüber.'
                : evaluation.verdict === 'worsened'
                ? 'Dein bestes Arbeitsgewicht lag häufiger als zufällig darunter.'
                : evaluation.verdict === 'no_relevant_effect'
                ? 'Kein spürbarer Unterschied.'
                : 'Noch nicht klar.',
              'Ob es an der Empfehlung lag, bleibt offen. Schlaf, Muskelkater und Tagesform können mitwirken.',
              'Einheiten',
            )}
            {strengthQueued ? (
              <Row
                title="Danach vorgesehen"
                subtitle={`${strengthQueued.action} · Vorschau, wird nach Abschluss geprüft`}
              />
            ) : null}
            <Disclosure
              title="Details"
              subtitle="Prüfregeln, Vergleichseinheiten, ausgeschlossene Einheiten"
              open={criteriaOpen}
              onToggle={setCriteriaOpen}
            >
              <Copy muted>{evaluation.summary}</Copy>
              {renderStrengthCriteria(strengthExperiment.recommendation, true)}
              {evaluation.excluded.map(item => (
                <Row
                  key={item.runId}
                  title={sessionTitle(item.runId)}
                  subtitle={item.reason}
                />
              ))}
              {strengthQueued ? (
                <Section title="Grundlage der Vorschau">
                  <Copy muted>{strengthQueued.reason}</Copy>
                </Section>
              ) : null}
              {renderStrengthAlternatives()}
            </Disclosure>
            <Disclosure
              title="Empfehlung verwalten"
              subtitle="Pausieren, abschließen, abbrechen"
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
              title="Details"
              subtitle="Woran wir erkennen, ob es hilft"
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
                  ? 'Entscheide morgen in Ruhe.'
                  : 'Noch keine Empfehlung'
              }
              copy={
                postponed
                  ? 'Du hast den Vorschlag auf morgen verschoben.'
                  : 'Dafür braucht eine Übung mindestens drei Einheiten mit Arbeitssätzen.'
              }
              action={
                postponed
                  ? {
                      title: 'Vorschlag jetzt ansehen',
                      onPress: () => save({ strengthPostponedUntil: 0 }),
                    }
                  : finishedSessions.length
                  ? {
                      title: 'Einheiten ansehen',
                      onPress: () => switchTab('Verlauf'),
                    }
                  : {
                      title: 'Erstes Training starten',
                      onPress: () => switchTab('Heute'),
                    }
              }
            />
            {strengthSelection.alternatives.length ? (
              <Disclosure
                title="Details"
                subtitle="Andere geprüfte Möglichkeiten"
                open={criteriaOpen}
                onToggle={setCriteriaOpen}
              >
                {renderStrengthAlternatives()}
              </Disclosure>
            ) : null}
          </>
        )}
        <Section title="Grundlage">
          <Row
            title="Fokus"
            subtitle={focusLabel(settings.strengthFocus)}
            onPress={() => openPage('focus-strength')}
          />
          <Row
            title="Ziel"
            subtitle={settings.strengthGoal || 'Kein Ziel gesetzt'}
            onPress={() => openPage('focus-strength')}
          />
        </Section>
        {past.length ? (
          <Section title="Frühere Empfehlungen">
            {past.map(e => (
              <Card key={e.id}>
                <Copy>{e.recommendation.action}</Copy>
                <Copy muted>{`${
                  e.status === 'completed' ? 'Abgeschlossen' : 'Abgebrochen'
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
                      ? 'Gespeicherte Details ausblenden'
                      : 'Gespeicherte Details ansehen'
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
  // Krafttraining zeigt seinen Coach erst, wenn es genutzt wird — und gar
  // nicht, wenn der Bereich abgewählt ist. Ohne Laufen steht er allein.
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
          label="Bereich"
          options={[
            { value: 'running', label: AREA_LABELS.running },
            { value: 'strength', label: AREA_LABELS.strength },
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
      <Section title="Fragen">
        {proseReady ? (
          <Row
            title="Trainingschat"
            subtitle="Fragen zu deinen Einheiten stellen"
            onPress={() => openPage('chat')}
          />
        ) : null}
        <Row
          title="Wie Runback rechnet"
          subtitle="Grundlagen, Grenzen und gesperrte Modelle"
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
          : ' · Nicht angegeben'}
      </Text>
      <View style={styles.rpeGrid}>
        {Array.from({ length: 10 }, (_, i) => i + 1).map(value => (
          <Pressable
            key={value}
            accessibilityRole="button"
            accessibilityLabel={`${label}: ${value} von 10`}
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
        <Text style={styles.smallMuted}>1 · sehr leicht</Text>
        <Text style={styles.smallMuted}>10 · maximal</Text>
      </View>
    </View>
  );

  // Detail einer Aufzeichnung: erst sehen (Karte, Zahlen), dann bewerten
  // (nächster Schritt, Gefühl), dann die Abschnitte. Rohdaten, Modell,
  // Sport-/Laufart ändern und Löschen liegen eingeklappt darunter. Die
  // Laufauswertung erscheint nur bei Läufen (Spec T-1).
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
    // Kilometerpunkte auf der Karte: Zeile zur Endzeit des Abschnitts.
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
          selected.rpe.legs ? `Beine ${selected.rpe.legs}` : null,
          selected.rpe.breathing ? `Atmung ${selected.rpe.breathing}` : null,
        ]
          .filter(Boolean)
          .join(' · ')
      : '';
    // Jede Wahl hier ist ausdrücklich; danach fragt die Seite nicht mehr nach.
    // Eine eigene Wahl löscht die Spur eines früher bestätigten Vorschlags;
    // das Ereignisprotokoll im Speicher behält sie.
    const purposeChips = (
      <Field label="Laufart">
        <ChipGroup
          label="Laufart dieser Aufzeichnung"
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
    // „Noch offen“ fragt immer. „Einfach laufen“ ohne ausdrückliche Wahl (die
    // Vorgabe beim Start) fragt nur, wenn es einen Vorschlag gibt.
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
              Sah aus wie: {purposeLabel(purposeHint.purpose)} —{' '}
              {purposeHintReason(purposeHint)}.
            </Copy>
            <Button
              secondary
              title="Stimmt"
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
        <Copy muted>Danach vergleichen wir den Lauf mit ähnlichen Läufen.</Copy>
        {purposeChips}
      </>
    );
    const finishedAt = selected.startTime + selected.durationSeconds * 1000;
    // Das Gefühl klappt nur bei frischen Einheiten auf; bei alten oder
    // importierten wäre das große Raster nur Fläche.
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
            {selectedWords.noun} · {date(selected.startTime)} · gespeichert
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
            {renderRpe('legs', 'Beine')}
            {renderRpe('breathing', 'Atmung')}
          </Section>
          <Button title="Fertig" onPress={leaveDetail} disabled={busy} />
          <Button
            secondary
            small
            title="Alle Details ansehen"
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
              label="Ø bpm"
              {...toneFor(comparison, 'heartRate')}
            />
          ) : null}
        </View>
        {snapshot?.quality.issues.length ? (
          // Ein Vorbehalt bleibt auf der Hauptfläche; die Einzelheiten stehen
          // unter „Daten & Herkunft“.
          <Copy muted>
            {`${snapshot.quality.issues[0].suspected ? 'Vermutet: ' : ''}${
              snapshot.quality.issues[0].message
            }${
              snapshot.quality.issues.length > 1
                ? ` · ${
                    snapshot.quality.issues.length - 1
                  } weitere unter „Daten & Herkunft“`
                : ''
            }`}
          </Copy>
        ) : null}
        {askPurpose ? (
          <Section title="Wie war der Lauf gemeint?">{purposePrompt}</Section>
        ) : null}
        {selected.avgCadence && usesPace(selected.sport) && !series ? (
          <Copy muted>Ø {Math.round(selected.avgCadence)} Schritte / min</Copy>
        ) : null}
        {series ? (
          <Section title="Verlauf">
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
          <Section title="Kilometer">
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
        {distanceTarget ? (
          <Row
            title="Zielzeit für den nächsten Lauf"
            subtitle={
              distanceTarget.estimatedSeconds === undefined
                ? 'Zu wenig vergleichbare Läufe'
                : `Gleiche Strecke · Schätzung ${formatGoalTime(
                    distanceTarget.estimatedSeconds,
                  )}`
            }
            onPress={() => {
              setSelected(null);
              openPage('distance-times');
            }}
          />
        ) : null}
        {/* Fehlt nur die Laufart, ist die Rückfrage oben schon der nächste Schritt. */}
        {snapshot &&
        !(askPurpose && !snapshot.recommendation && !experiment) ? (
          <Card style={styles.nextStepCard}>
            <Text style={styles.heroLabel}>Nächster Schritt</Text>
            <Copy>{snapshot.nextAction}</Copy>
            {snapshot.recommendation && !experiment && runRecs ? (
              <Button
                title="Empfehlung ansehen"
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
                <Copy muted>Hast du die Empfehlung ausprobiert?</Copy>
                <View style={styles.choiceRow}>
                  {(
                    [
                      { value: 'yes', label: 'Ja' },
                      { value: 'no', label: 'Nein' },
                      { value: 'unknown', label: 'Unklar' },
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
              ? `${rpeSummary}${selected.note ? ' · Notiz' : ''}`
              : 'Noch nicht eingetragen'
          }
          defaultOpen={!rpeSummary && askFeeling}
        >
          {renderRpe('legs', 'Beine')}
          {renderRpe('breathing', 'Atmung')}
          <Text style={styles.fieldLabel}>Notiz</Text>
          <TextInput
            accessibilityLabel="Notiz zu dieser Aufzeichnung"
            multiline
            value={note}
            onChangeText={setNote}
            onBlur={() => {
              if (note !== (selected.note || '')) {
                updateFeedback({ note });
              }
            }}
            placeholder="Was möchtest du festhalten?"
            placeholderTextColor={color.muted}
            style={[styles.input, styles.note]}
            selectionColor={color.green}
          />
          {note !== (selected.note || '') ? (
            <Button
              secondary
              small
              title="Notiz speichern"
              onPress={() => updateFeedback({ note })}
              disabled={busy}
            />
          ) : null}
        </Disclosure>
        <View style={styles.sectionGap}>
          <Disclosure
            title="Teilen & exportieren"
            subtitle={
              selected.route && selected.route.length >= 2
                ? 'Bericht, GPX, Route in Karten-App'
                : 'Bericht, GPX'
            }
          >
            <Button
              secondary
              title={`${selectedWords.noun} als Bericht teilen`}
              onPress={() => shareRun(selected, snapshot)}
              disabled={busy}
            />
            <Button
              secondary
              title="Als GPX exportieren"
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
            title="Daten & Herkunft"
            subtitle={
              snapshot?.quality.issues.length
                ? `${counted(
                    snapshot.quality.issues.length,
                    'Auffälligkeit',
                    'Auffälligkeiten',
                  )} · Quelle, Modell, Wetter`
                : 'Quelle, Samples, Modellversion, Wetter'
            }
            open={moreDetails}
            onToggle={setMoreDetails}
          >
            {snapshot?.quality.issues.map((issue, i) => (
              <Copy muted key={i}>
                {issue.suspected ? 'Vermutet: ' : ''}
                {issue.message}
              </Copy>
            ))}
            <Row title="Quelle" subtitle={selected.source} />
            <Row
              title="Originalsamples"
              subtitle={`${selected.samples || 0} gespeichert`}
            />
            {snapshot ? (
              <Row title="Modell" subtitle={snapshot.model_version} />
            ) : null}
            {selected.purposeHint ? (
              <Row
                title="Laufart"
                subtitle={`Vorschlag bestätigt · ${
                  selected.purposeHint.model_version
                }${
                  selected.purposeHint.maxHeartRate
                    ? ` · Maxpuls ${selected.purposeHint.maxHeartRate.value} (${
                        selected.purposeHint.maxHeartRate.source === 'setting'
                          ? 'eingestellt'
                          : 'geschätzt'
                      })`
                    : ''
                }`}
              />
            ) : null}
            {snapshot ? (
              <Section title="Modellierte Anforderung">
                <Copy>
                  {snapshot.effort.speedIndex === undefined
                    ? 'Nicht bestimmbar'
                    : `${number(snapshot.effort.speedIndex, 0)} · Tempoindex`}
                </Copy>
                <Copy muted>{snapshot.effort.uncertainty}</Copy>
                {Object.entries(snapshot.effort.factors).map(([key, value]) => (
                  <Row
                    key={key}
                    title={
                      (
                        {
                          tempo: 'Tempo',
                          slope: 'Steigung',
                          wind: 'Wind',
                          heat: 'Wärme',
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
            title="Bearbeiten & verwalten"
            subtitle="Sportart und Laufart ändern, löschen"
          >
            <Field label="Sportart">
              <ChipGroup
                label="Sportart dieser Aufzeichnung"
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
              title="Aufzeichnung löschen"
              onPress={() =>
                Alert.alert(
                  'Diese Aufzeichnung löschen?',
                  'Originaldaten und Feedback dieser Aufzeichnung werden dauerhaft entfernt. Die vorher festgelegten Regeln bleiben gespeichert.',
                  [
                    { text: 'Behalten', style: 'cancel' },
                    {
                      text: 'Löschen',
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

  // Vorlagen behalten ihren Ort im Plan; die Einstellungen öffnen dieselbe Verwaltung.
  // Einstellungen sind eine kurze Liste; jede Zeile nennt, was dahinter liegt.
  const renderSettings = () => (
    <>
      <Title>Einstellungen</Title>
      <View>
        <Row
          title="Funktionen"
          subtitle="Was Runback zeigt und wann es fragt"
          onPress={() => openPage('features')}
        />
        {showRunning ? (
          <Row
            title="Stimme & Vibration"
            subtitle="Ansagen während des Laufs"
            onPress={() => openPage('run-audio')}
          />
        ) : null}
        <Row
          title="Vorlagen verwalten"
          subtitle="Verwalte deine Kraft- und Laufvorlagen"
          onPress={() => {
            setTemplatesView(showStrength ? 'strength' : 'run');
            openPage('templates');
          }}
        />
        <Row
          title="Geräte & Verbindungen"
          subtitle="Uhr, Sensoren, Health Connect, Wetter"
          onPress={() => openPage('devices')}
        />
        <Row
          title="Deine Daten"
          subtitle={`${counted(
            runs.length,
            'Aufzeichnung',
            'Aufzeichnungen',
          )} · Import, Backup, Löschen`}
          onPress={() => openPage('data')}
        />
        <Row
          title="KI-Formulierung & Trainingschat"
          subtitle="Optional, mit eigenem OpenRouter-Schlüssel"
          onPress={() => openPage('models')}
        />
        <Row
          title="Einrichtung erneut öffnen"
          subtitle="Ziel festlegen und Historie importieren"
          onPress={() => setSetupOpen(true)}
        />
      </View>
    </>
  );

  // Ziel fürs Laufen: Name, Zeitraum, Phase. Zeitbudget und Lauftage gehören
  // zum Rhythmus im Plan, nicht hierher.
  const renderGoal = () => (
    <>
      <Title>Dein Ziel</Title>
      {racePrediction.status !== 'no_goal' ? (
        <GoalProgress prediction={racePrediction} />
      ) : null}
      <Section title="Was möchtest du erreichen?">
        <TextInput
          accessibilityLabel="Dein Ziel"
          value={goalInput}
          onChangeText={setGoalInput}
          placeholder="Zum Beispiel: Halbmarathon im April"
          placeholderTextColor={color.muted}
          style={styles.input}
          selectionColor={color.green}
        />
      </Section>
      <Section title="Wettkampf">
        <Field
          label="Strecke in km (optional)"
          hint={
            goalDistanceInput.trim()
              ? undefined
              : parseGoalDistanceKm(goalInput) !== undefined
              ? `Aus dem Ziel gelesen: ${String(
                  Math.round(parseGoalDistanceKm(goalInput)! * 10) / 10,
                ).replace('.', ',')} km`
              : 'Zum Beispiel 21,1 — oder „Halbmarathon“ im Ziel'
          }
        >
          <TextInput
            accessibilityLabel="Zielstrecke"
            value={goalDistanceInput}
            onChangeText={setGoalDistanceInput}
            placeholder="21,1"
            placeholderTextColor={color.muted}
            keyboardType="decimal-pad"
            style={styles.input}
          />
        </Field>
        <Field label="Zielzeit (optional, h:mm:ss)">
          <TextInput
            accessibilityLabel="Zielzeit"
            value={goalTimeInput}
            onChangeText={setGoalTimeInput}
            placeholder="1:59:00"
            placeholderTextColor={color.muted}
            style={styles.input}
          />
        </Field>
      </Section>
      <Section title="Zeitraum">
        <Field label="Beginn (optional)">
          <TextInput
            accessibilityLabel="Planbeginn"
            value={goalStartInput}
            onChangeText={setGoalStartInput}
            placeholder="TT.MM.JJJJ"
            placeholderTextColor={color.muted}
            style={styles.input}
          />
        </Field>
        <Field label="Zieldatum (optional)">
          <TextInput
            accessibilityLabel="Zieldatum"
            value={goalTargetInput}
            onChangeText={setGoalTargetInput}
            placeholder="TT.MM.JJJJ"
            placeholderTextColor={color.muted}
            style={styles.input}
          />
        </Field>
        <Field label="Trainingsphase (optional)">
          <TextInput
            accessibilityLabel="Trainingsphase"
            value={goalPhaseInput}
            onChangeText={setGoalPhaseInput}
            placeholder="Zum Beispiel: Wettkampfvorbereitung"
            placeholderTextColor={color.muted}
            style={styles.input}
          />
        </Field>
      </Section>
      <View style={[styles.sectionGap, styles.buttonStack]}>
        <Button
          title="Ziel speichern"
          onPress={() => {
            void action(async () => {
              const startDate = inputToDate(goalStartInput);
              const targetDate = inputToDate(goalTargetInput);
              if (startDate === null || targetDate === null) {
                throw new Error(
                  'Bitte ein gültiges Datum als TT.MM.JJJJ eingeben.',
                );
              }
              if (targetDate && startDate && targetDate < startDate) {
                throw new Error(
                  'Trage einen Planbeginn ein, der spätestens am Zieldatum liegt.',
                );
              }
              if (
                (startDate || targetDate || goalPhaseInput.trim()) &&
                !goalInput.trim()
              ) {
                throw new Error('Trage zuerst dein Ziel ein.');
              }
              if (goalPhaseInput.trim() && !startDate) {
                throw new Error(
                  'Trage für deinen Schwerpunkt auch den Planbeginn ein.',
                );
              }
              let distanceKm: number | undefined;
              if (goalDistanceInput.trim()) {
                distanceKm = Number(goalDistanceInput.trim().replace(',', '.'));
                if (!Number.isFinite(distanceKm) || distanceKm <= 0) {
                  throw new Error('Trage die Strecke als Zahl in km ein.');
                }
              }
              let targetSeconds: number | undefined;
              if (goalTimeInput.trim()) {
                targetSeconds = parseGoalTime(
                  goalTimeInput,
                  distanceKm ?? parseGoalDistanceKm(goalInput),
                );
                if (targetSeconds === undefined) {
                  throw new Error('Trage die Zielzeit als h:mm:ss ein.');
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
              setMessage('Ziel gespeichert.');
            });
          }}
        />
        {settings.goal || schedule.goal ? (
          <Button
            secondary
            small
            title="Ziel entfernen"
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
                setMessage('Ziel entfernt. Dein Fokus bleibt bestehen.');
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
  // Importieren ist die Hauptsache; Export, Backup und Löschen sind
  // Nebenwege und bleiben eingeklappt.
  const renderData = () => (
    <>
      <Title>Deine Daten</Title>
      <Section title="Importieren">
        <Button
          title="Dateien importieren"
          onPress={runImport}
          disabled={busy}
        />
        <Copy muted>
          FIT, GPX, TCX oder ZIP. Doppelte Läufe werden erkannt.
        </Copy>
        {importStatus && importStatus.state !== 'review' ? (
          <>
            <Copy>{importSummary}</Copy>
            {importStatus.state === 'running' ? (
              <Button
                secondary
                title="Import abbrechen"
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
          title="Aus anderen Apps"
          subtitle="Fitbit, Strava, Garmin, Apple Health, Samsung und weitere"
          onPress={() => openPage('vendor-import')}
        />
        <Row
          title="Deine Importe"
          subtitle="Frühere Importe ansehen oder löschen"
          onPress={() => openPage('imports')}
        />
      </Section>
      <View style={styles.sectionGap}>
        <Disclosure
          title="Laufberichte exportieren"
          subtitle="Zeitraum als ZIP teilen"
        >
          <Field label="Von">
            <Input
              label="Von (TT.MM.JJJJ)"
              placeholder="TT.MM.JJJJ"
              value={exportFrom}
              onChangeText={setExportFrom}
              editable={!busy}
              keyboardType="numbers-and-punctuation"
            />
          </Field>
          <Field label="Bis" hint="Beide Tage zählen mit.">
            <Input
              label="Bis (TT.MM.JJJJ)"
              placeholder="TT.MM.JJJJ"
              value={exportTo}
              onChangeText={setExportTo}
              editable={!busy}
              keyboardType="numbers-and-punctuation"
            />
          </Field>
          <Button
            secondary
            title="Läufe als ZIP exportieren"
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
          title="Backup"
          subtitle="Alle Originaldaten und Einstellungen sichern"
        >
          <Button
            secondary
            title="Backup exportieren"
            disabled={busy}
            onPress={() => {
              void action(async () => {
                const result = await nativeCall<any>('exportBackup');
                if (!result.cancelled) {
                  setMessage('Backup exportiert.');
                }
              });
            }}
          />
          <Button
            secondary
            title="Backup wiederherstellen"
            disabled={busy}
            onPress={() =>
              Alert.alert(
                'Backup wiederherstellen?',
                'Wähle ein Runback-Backup. Bereits vorhandene Läufe bleiben erhalten und werden nicht doppelt angelegt.',
                [
                  { text: 'Zurück', style: 'cancel' },
                  {
                    text: 'Backup wählen',
                    onPress: () => {
                      void action(async () => {
                        const result = await nativeCall<any>('restoreBackup');
                        if (!result.cancelled) {
                          await Promise.all([reloadTrainingState(), refresh()]);
                          setMessage(
                            result.message || 'Backup wiederhergestellt.',
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
        <Disclosure title="Daten löschen" subtitle="Alles auf diesem Telefon">
          <Button
            danger
            title="Alle lokalen Daten löschen"
            onPress={() =>
              Alert.alert(
                'Alle lokalen Daten löschen?',
                'Alle Läufe, Originaldaten, Notizen und Einstellungen auf diesem Telefon werden dauerhaft gelöscht. Exportiere vorher ein Backup, wenn du sie behalten möchtest.',
                [
                  { text: 'Behalten', style: 'cancel' },
                  {
                    text: 'Alles löschen',
                    style: 'destructive',
                    onPress: () => {
                      void action(async () => {
                        await nativeCall('clearAllData');
                        await Promise.all([reloadTrainingState(), refresh()]);
                        setPage('main');
                        setMessage('Lokale Daten gelöscht.');
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
    [importStatus?.state, importStatus?.preview],
  );
  const renderImportReview = () => (
    <Sheet
      visible={importPreview !== null}
      title="Import prüfen"
      onClose={discardImport}
    >
      {importPreview ? (
        <ImportReview
          key={String(importStatus?.token)}
          preview={importPreview}
          files={Array.isArray(importStatus?.files) ? importStatus.files : []}
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

  // Vorlagen an einem Ort: Kraftvorlagen (Übungsfolgen) und Laufvorlagen
  // (Laufart und Zeit für den Start). Beide erscheinen im Start-Sheet.
  const renderPresets = () => (
    <>
      <Copy muted>
        Eine Laufvorlage setzt Laufart und Zeit beim Start. Die aktuelle Wahl
        speicherst du hier als neue Vorlage.
      </Copy>
      <Section title="Aktuelle Einstellung speichern">
        <Copy>
          {purposeLabel(purpose)} · {settings.minutes || 30} Minuten
        </Copy>
        <TextInput
          accessibilityLabel="Name der Laufvorlage"
          value={presetName}
          onChangeText={setPresetName}
          placeholder="Zum Beispiel: Feierabendrunde"
          placeholderTextColor={color.muted}
          style={styles.input}
        />
        <Button
          title="Vorlage speichern"
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
      <Section title="Deine Vorlagen">
        {settings.presets?.length ? (
          settings.presets.map(p => (
            <View key={p.id}>
              <Row
                title={p.name}
                subtitle={`${purposeLabel(p.purpose)} · ${p.minutes} Minuten`}
                onPress={() => {
                  void action(async () => {
                    await persist({
                      purpose: p.purpose,
                      minutes: p.minutes,
                      cues: p.cues,
                    });
                    switchTab('Heute');
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
                <Text style={styles.muted}>Vorlage entfernen</Text>
              </Pressable>
            </View>
          ))
        ) : (
          <Copy muted>Noch keine Vorlage gespeichert.</Copy>
        )}
      </Section>
    </>
  );

  const renderTemplates = () => (
    <>
      <Title>Vorlagen</Title>
      <Segmented
        label="Art der Vorlage"
        options={[
          { value: 'strength', label: 'Kraftvorlagen' },
          { value: 'run', label: 'Laufvorlagen' },
        ]}
        value={templatesView}
        onChange={setTemplatesView}
      />
      {templatesView === 'strength' ? (
        <>
          <ImportedTemplates
            refreshKey={`${importRevision}:${importStatus?.state ?? ''}:${importStatus?.strength ?? ''}:${importStatus?.strengthDuplicates ?? ''}`}
            templates={strength.templates}
            dismissedIds={settings.dismissedStrengthImportTemplateIds ?? []}
            busy={busy}
            onDismiss={async id => {
              await persist({
                dismissedStrengthImportTemplateIds: Array.from(
                  new Set([
                    ...(stateRef.current.settings.dismissedStrengthImportTemplateIds ?? []),
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

  // Detail einer Krafteinheit. Gezeigt wird, was bestätigt wurde — Planwerte
  // erscheinen hier nicht als Ist-Werte (T-6).
  const renderSession = () =>
    selectedSession ? (
      <StrengthSessionDetail
        session={selectedSession}
        history={finishedSessions}
        heart={sessionHeart}
        heartSummaries={heartSummaries}
        onOpenExercise={openExercise}
        busy={busy}
      />
    ) : null;

  // Muskelkarte: zuerst, was du selbst gemeldet hast; die gerechnete
  // Frische bleibt daneben, solange sie gesperrt ist, als „unbekannt“.
  // Begriffe und Vorbehalte stehen unter „Was die Karte zeigt“.
  const renderMuscleMap = () => {
    const latestReport = latestSoreness;
    return (
      <>
        <Text style={styles.title}>Muskelkarte</Text>
        <Segmented
          label="Was die Karte zeigt"
          options={[
            { value: 'soreness', label: 'Gemeldeter Muskelkater' },
            { value: 'freshness', label: 'Frische' },
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
            ? 'Noch nicht freigeschaltet — alle Regionen bleiben unbekannt.'
            : latestReport
            ? `Letzte Meldung: ${date(latestReport.at)} · ${
                latestReport.nothingToday
                  ? 'heute nichts'
                  : counted(latestReport.entries.length, 'Region', 'Regionen')
              }`
            : 'Noch keine Meldung gespeichert.'}
        </Copy>
        <Button title="Muskelkater melden" onPress={openSorenessCapture} />
        <View style={styles.sectionGap}>
          <Disclosure
            title="Was die Karte zeigt"
            subtitle="Frische, Muskelkater und Grenzen"
          >
            <Copy muted>
              Muskelkater ist deine eigene Angabe je Region von 0 bis 10 — keine
              Messung und keine Diagnose.
            </Copy>
            <Copy muted>
              Frische ist eine gerechnete Größe je Region. 100 bedeutet: keine
              nachwirkende Belastung im Sinne des Modells — nicht gesund, stark
              oder bereit.
            </Copy>
            <Copy muted>
              Für persönliche Frischewerte fehlt noch eine abgeschlossene
              Modellprüfung. Fehlende oder unsichere Grundlage bleibt unbekannt.
            </Copy>
          </Disclosure>
        </View>
      </>
    );
  };

  const LOCKED_MODELS = [
    'Critical Speed & Fitness',
    'Race Simulator & Pacemaker',
    'Persönliche Umweltparameter',
    'Fuel-Plan & Szenarien',
  ];
  const renderModels = () => (
    <>
      <Title>Wie Runback rechnet</Title>
      <Section title="Lokal aus deinen Daten">
        <Copy>
          Basiswerte, Datenqualität und Laufart rechnet Runback auf diesem
          Gerät. Messung, Gefühl und Schätzung bleiben getrennt.
        </Copy>
        <Copy muted>
          Der Tempoindex beschreibt die äußere Anforderung eines Laufs — keine
          Messung von Fitness, Ermüdung oder Gesundheit.
        </Copy>
        <Disclosure
          title="Gesperrte Modelle"
          subtitle={`${LOCKED_MODELS.length} Modelle · noch nicht freigegeben`}
        >
          {LOCKED_MODELS.map(title => (
            <Row key={title} title={title} />
          ))}
          <Copy muted>
            Für persönliche Empfehlungen fehlen geeignete Daten und eine
            unabhängige Modellprüfung.
          </Copy>
        </Disclosure>
      </Section>
      <Section title="Erklärungen ohne Cloud">
        <Copy muted>
          Die lokalen Regeln entscheiden. Ein Sprachmodell ist optional und
          formuliert nur.
        </Copy>
      </Section>
      <ProseSettings />
      <Button title="Trainingschat öffnen" onPress={() => openPage('chat')} />
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
      <Stat value={selectedStrengthRecord.value} label="Bestwert" />
      <Section title="Einheiten">
        {finishedSessions
          .filter(session =>
            selectedStrengthRecord.sessionIds.includes(session.id),
          )
          .sort((a, b) => b.startTime - a.startTime)
          .map(session => (
            <Row
              key={session.id}
              title={session.name || 'Krafttraining'}
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
      <Stat value={selectedRecord.value} label="Distanz" />
      <Section title="Läufe">
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
            title="Keine Läufe mehr vorhanden"
            copy="Öffne die Statistik erneut."
            action={{ title: 'Zur Statistik', onPress: leaveDetail }}
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
        setGoalInput(`${String(km).replace('.', ',')} km`);
        setGoalDistanceInput(String(km).replace('.', ','));
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
  ) : page === 'features' || page === 'features-home' ? (
    <FeatureSettings
      features={features}
      screen={page === 'features-home' ? 'home' : 'main'}
      disabled={busy}
      onChange={changeFeatures}
      onOpenHomeSections={() => openPage('features-home')}
    />
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
  ) : tab === 'Heute' ? (
    recording ? (
      renderRecording()
    ) : (
      renderHome()
    )
  ) : tab === 'Plan' ? (
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
      onManageTemplates={() => {
        setTemplatesView(showStrength ? 'strength' : 'run');
        openPage('templates');
      }}
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
  ) : tab === 'Verlauf' ? (
    <>
      <Title>Verlauf</Title>
      <Segmented
        label="Ansicht"
        options={VERLAUF_VIEWS}
        value={verlaufView}
        onChange={next => {
          setExportSelection(null);
          setVerlaufView(next);
        }}
      />
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
        <Section title="Körper">
          <Row
            title="Muskelkarte"
            subtitle="Gemeldeter Muskelkater und gerechnete Frische je Region"
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
            accessibilityLabel="Muskelkatermeldung schließen"
            onPress={() => setSorenessOpen(false)}
            style={styles.back}
          >
            <Text style={styles.backText}>‹</Text>
            <Text style={styles.backLabel}>Zurück</Text>
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
              ? 'Auf diesem Gerät ist keine Spracherkennung verfügbar. Tippen funktioniert unverändert.'
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
            setMessage('Plan gespeichert.');
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
          onCompleteSet={(index, setId, values) =>
            changeSession(s =>
              completeStrengthSet(s, index, setId, Date.now(), values),
            )
          }
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
            setTab('Heute');
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
    tab === 'Verlauf' &&
    verlaufView === 'units';
  const runCount = units.filter(unit => unitMatches(unit, 'runs')).length;
  const cyclingCount = units.filter(unit =>
    unitMatches(unit, 'cycling'),
  ).length;
  const sessionCount = units.length - runCount - cyclingCount;
  // Gefiltert wird nur, was es gibt — auch bei abgewähltem Bereich, damit
  // Historie nicht verschwindet. Mit nur einer Art braucht es keinen Filter.
  const presentFilters = UNIT_FILTERS.filter(
    item =>
      (item.value === 'runs' && runCount > 0) ||
      (item.value === 'cycling' && cyclingCount > 0) ||
      (item.value === 'strength' && sessionCount > 0),
  );
  const unitFilters =
    presentFilters.length > 1
      ? [UNIT_FILTERS[0], ...presentFilters]
      : [UNIT_FILTERS[0]];
  const activeUnitFilter = unitFilters.some(
    item => item.value === effectiveUnitFilter,
  )
    ? effectiveUnitFilter
    : 'all';
  const runCountLabel = counted(runCount, 'Lauf', 'Läufe');
  const cyclingCountLabel = counted(cyclingCount, 'Radfahrt', 'Radfahrten');
  const sessionCountLabel = counted(
    sessionCount,
    'Krafteinheit',
    'Krafteinheiten',
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
        title="Noch keine Krafteinheit"
        copy="Jede bestätigte Einheit erscheint hier, mit Sätzen und Volumen."
        action={{
          title: 'Krafttraining starten',
          onPress: () => switchTab('Heute'),
        }}
      />
    ) : activeUnitFilter === 'cycling' ? (
      <EmptyState
        title="Noch keine Radfahrt"
        copy="Radfahrten stehen hier mit Strecke und Geschwindigkeit, getrennt von deinen Laufkilometern."
        action={{
          title: 'Radfahrt starten',
          onPress: () => {
            save({ sport: 'cycling' });
            switchTab('Heute');
            openStartSheet('run');
          },
        }}
      />
    ) : activeUnitFilter === 'runs' ? (
      <EmptyState
        title="Noch kein Lauf"
        copy="Nach deinem ersten Lauf stehen hier Strecke, Laufgefühl und der nächste Schritt."
        action={{
          title: 'Ersten Lauf starten',
          onPress: () => switchTab('Heute'),
        }}
      />
    ) : (
      <EmptyState
        title="Hier beginnt deine Historie"
        copy="Läufe, Radfahrten und Krafteinheiten stehen ab dem ersten Mal gemeinsam in dieser Liste."
        action={{
          title: 'Aufzeichnung starten',
          onPress: () => switchTab('Heute'),
        }}
      />
    );
  // Der Chat braucht die volle Höhe: Verlauf scrollt, die Eingabe bleibt unten.
  const isChat = !selected && page === 'chat';
  return (
    <View style={[styles.app, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        {selected || page !== 'main' ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Zurück"
            onPress={leaveDetail}
            style={styles.back}
          >
            <Text style={styles.backText}>‹</Text>
            <Text style={styles.backLabel}>Zurück</Text>
          </Pressable>
        ) : (
          <Text style={styles.brand}>
            runback<Text style={styles.brandMark}> /</Text>
          </Text>
        )}
        {busy ? (
          <ActivityIndicator color={color.green} />
        ) : recording ? (
          <Text style={styles.headerInfo}>Aufzeichnung aktiv</Text>
        ) : !selected && page === 'main' ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Einstellungen"
            onPress={() => openPage('settings')}
            style={({ pressed }) => [styles.gear, pressed && styles.pressed]}
          >
            <Icon name="Einstellungen" />
          </Pressable>
        ) : null}
      </View>
      {error ? (
        <View style={styles.noticeSlot}>
          <Notice
            title="Aktion nicht abgeschlossen"
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
          <Copy muted>Einheiten werden geladen …</Copy>
        </View>
      ) : isChat ? (
        <TrainingChat onSettings={() => openPage('models')} />
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
              <Title>Verlauf</Title>
              <Segmented
                label="Ansicht"
                options={VERLAUF_VIEWS}
                value={verlaufView}
                onChange={next => {
                  setExportSelection(null);
                  setVerlaufView(next);
                }}
              />
              {unitFilters.length > 1 ? (
                <ChipGroup
                  label="Einheiten filtern"
                  options={unitFilters}
                  value={activeUnitFilter}
                  onChange={setUnitFilter}
                />
              ) : null}
              {exportSelection !== null ? (
                <Card>
                  <Copy>
                    {counted(exportSelection.length, 'Lauf', 'Läufe')}{' '}
                    ausgewählt
                  </Copy>
                  <Button
                    title="Auswahl als ZIP exportieren"
                    disabled={busy || !exportSelection.length}
                    onPress={() => shareRuns(async () => exportSelection)}
                  />
                  <Button
                    secondary
                    title="Auswahl beenden"
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
                      accessibilityLabel="Läufe zum Export auswählen"
                      accessibilityHint="Auch per langem Druck auf einen Lauf."
                      disabled={busy}
                      onPress={() => setExportSelection([])}
                      style={({ pressed }) => [
                        styles.listMetaAction,
                        pressed && styles.pressed,
                      ]}
                    >
                      <Text style={styles.greenText}>Auswählen</Text>
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
                Krafteinheiten: höchstens die 500 neuesten. Ältere bleiben im
                Backup erhalten.
              </Copy>
            ) : null
          }
          initialNumToRender={14}
          maxToRenderPerBatch={10}
          windowSize={7}
          refreshing={busy}
          onRefresh={() => {
            // Die Liste zeigt beides, also lädt sie auch beides nach. Fehlt die
            // native Kraftunterstützung, bleibt der Rest unberührt.
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
            accessibilityLabel={name}
            onPress={() => switchTab(name)}
            style={[styles.tab, tab === name && styles.tabActive]}
          >
            <Icon name={name} selected={tab === name} />
            <Text
              style={[styles.tabText, tab === name && styles.tabTextActive]}
            >
              {name}
            </Text>
          </Pressable>
        ))}
      </View>
      {renderStartSheet()}
      {renderPurposeSheet()}
      {renderImportReview()}
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
  gear: {
    minWidth: 48,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
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
  // Ohne eigene Zeilenhöhe: Android übernähme sie für die ganze Zeile und
  // schnitte die Unterlänge des Kommas im großen Wert ab („7.99“).
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
