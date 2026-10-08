import { tr } from './i18n';
import type { Sport } from './types';
import type { StrengthSession } from './strength';
import type { SorenessReport } from './sorenessInput';

/**
 * Which features the user wants to see and when Runback asks.
 *
 * The spec promises: "Every feature can be switched off, and switched off it
 * creates neither hints nor empty areas." This module is the one place where
 * that is decided. Switching off only hides; data stays, so switching back on
 * brings everything back (ground rules 1 and 10).
 *
 * Missing or broken values fall back to the default, never to an error. The
 * default matches the app's earlier behavior, with one exception: after
 * soreness, Runback now asks after strength training instead of daily.
 */
export const FEATURES_VERSION = 2 as const;

export type SorenessPrompt =
  | 'never'
  | 'after_strength'
  | 'daily'
  | 'training_days'
  | 'weekly';
export type RecommendationMode = 'suggest' | 'on_request' | 'off';
export type HomeSection =
  | 'week'
  | 'recommendation'
  | 'goal'
  | 'body'
  | 'recent';
export type RecordingMetric = 'distance' | 'pace' | 'heartRate' | 'target';
export type RecordingPrimary = 'duration' | 'distance' | 'heartRate';
export type AfterRun = 'detail' | 'feeling' | 'home';
export type StatsModule = 'distribution' | 'records' | 'consistency' | 'body';
export type Area = 'running' | 'strength';
export type OptionalTab =
  | 'plan'
  | 'coach'
  | 'statistics'
  | 'routes'
  | 'templates'
  | 'soreness';
export type Tab = 'today' | 'history' | OptionalTab;
/** Tab ids before the English rename; saved navigation still carries them. */
const LEGACY_TABS: Record<string, OptionalTab> = {
  Plan: 'plan',
  Coach: 'coach',
  Statistik: 'statistics',
  Routen: 'routes',
  Vorlagen: 'templates',
  Muskelkater: 'soreness',
};
export type FeatureId =
  | 'planning'
  | 'coach'
  | 'statistics'
  | 'routes'
  | 'templates'
  | 'soreness'
  | 'goals';
/**
 * Feature list in settings and home. Titles and descriptions are getters so
 * they follow the active language at read time, not at import time.
 */
export const FEATURE_CATALOG: readonly {
  readonly id: FeatureId;
  readonly title: string;
  readonly description: string;
  readonly tab?: OptionalTab;
}[] = [
  {
    id: 'coach',
    get title() {
      return tr('Coach', 'Coach');
    },
    get description() {
      return tr(
        'Empfehlungen und ihre Prüfung',
        'Recommendations and how they are checked',
      );
    },
    tab: 'coach',
  },
  {
    id: 'planning',
    get title() {
      return tr('Planung', 'Planning');
    },
    get description() {
      return tr('Woche und Monat planen', 'Plan the week and the month');
    },
    tab: 'plan',
  },
  {
    id: 'goals',
    get title() {
      return tr('Ziele & Fokus', 'Goals & focus');
    },
    get description() {
      return tr(
        'Vorhaben je Bereich festlegen',
        'Set plans for each area',
      );
    },
  },
  {
    id: 'statistics',
    get title() {
      return tr('Statistik', 'Statistics');
    },
    get description() {
      return tr(
        'Läufe und Krafttraining auswerten',
        'Review runs and strength training',
      );
    },
    tab: 'statistics',
  },
  {
    id: 'routes',
    get title() {
      return tr('Routen', 'Routes');
    },
    get description() {
      return tr(
        'Runden planen und mit Ansagen laufen',
        'Plan loops and run with announcements',
      );
    },
    tab: 'routes',
  },
  {
    id: 'templates',
    get title() {
      return tr('Vorlagen', 'Templates');
    },
    get description() {
      return tr(
        'Kraft- und Lauftraining vorbereiten',
        'Prepare strength and running workouts',
      );
    },
    tab: 'templates',
  },
  {
    id: 'soreness',
    get title() {
      return tr('Muskelkater', 'Soreness');
    },
    get description() {
      return tr(
        'Muskelkater melden und ansehen',
        'Report and review soreness',
      );
    },
    tab: 'soreness',
  },
];
const OPTIONAL_TABS: OptionalTab[] = [
  'plan',
  'coach',
  'statistics',
  'routes',
  'templates',
  'soreness',
];

export interface FeatureSettings {
  version: typeof FEATURES_VERSION;
  areas: Record<Area, boolean>;
  sports: { cycling: boolean };
  soreness: {
    enabled: boolean;
    prompt: SorenessPrompt;
    map: boolean;
    voice: boolean;
  };
  home: { sections: HomeSection[] };
  coach: { enabled: boolean };
  goals: { enabled: boolean };
  templates: { enabled: boolean };
  navigation: { tabs: OptionalTab[] };
  planning: { enabled: boolean; suggest: boolean; month: boolean };
  recommendations: {
    running: RecommendationMode;
    strength: RecommendationMode;
    showQueued: boolean;
  };
  recording: {
    metrics: RecordingMetric[];
    primary: RecordingPrimary;
    targets: boolean;
    routes: boolean;
    afterRun: AfterRun;
  };
  strength: {
    restTimer: boolean;
    /** Short, short, long at the end of a rest: on the paired watch, otherwise on the phone. */
    restVibration: boolean;
    /** Short, short, long as a sound, phone only. */
    restSound: boolean;
    defaultRestSeconds: number;
    rir: boolean;
    templateOfDay: boolean;
  };
  statistics: { enabled: boolean; modules: StatsModule[] };
}

export const HOME_SECTIONS: HomeSection[] = [
  'week',
  'recommendation',
  'goal',
  'body',
  'recent',
];
export const RECORDING_METRICS: RecordingMetric[] = [
  'distance',
  'pace',
  'heartRate',
  'target',
];
export const STATS_MODULES: StatsModule[] = [
  'distribution',
  'records',
  'consistency',
  'body',
];
export const SORENESS_PROMPTS: SorenessPrompt[] = [
  'never',
  'after_strength',
  'daily',
  'training_days',
  'weekly',
];
export const RECOMMENDATION_MODES: RecommendationMode[] = [
  'suggest',
  'on_request',
  'off',
];
export const AFTER_RUN_OPTIONS: AfterRun[] = ['detail', 'feeling', 'home'];
export const RECORDING_PRIMARIES: RecordingPrimary[] = [
  'duration',
  'distance',
  'heartRate',
];
export const REST_SECONDS_OPTIONS = [60, 90, 120, 180] as const;
const MIN_REST_SECONDS = 0;
const MAX_REST_SECONDS = 600;

export const DEFAULT_FEATURES: FeatureSettings = {
  version: FEATURES_VERSION,
  areas: { running: true, strength: true },
  sports: { cycling: true },
  soreness: { enabled: true, prompt: 'after_strength', map: true, voice: true },
  home: { sections: [...HOME_SECTIONS] },
  planning: { enabled: true, suggest: true, month: true },
  coach: { enabled: true },
  goals: { enabled: true },
  templates: { enabled: true },
  navigation: { tabs: ['plan', 'coach'] },
  recommendations: {
    running: 'suggest',
    strength: 'suggest',
    showQueued: true,
  },
  recording: {
    metrics: ['distance', 'pace', 'target'],
    primary: 'duration',
    targets: true,
    routes: true,
    afterRun: 'detail',
  },
  strength: {
    restTimer: true,
    restVibration: true,
    restSound: false,
    defaultRestSeconds: 120,
    rir: true,
    templateOfDay: true,
  },
  statistics: { enabled: true, modules: [...STATS_MODULES] },
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const bool = (value: unknown, fallback: boolean) =>
  typeof value === 'boolean' ? value : fallback;
const oneOf = <T extends string>(value: unknown, allowed: T[], fallback: T) =>
  typeof value === 'string' && (allowed as string[]).includes(value)
    ? (value as T)
    : fallback;
/** Subset of a fixed list, in its order; unknown values are dropped. */
const subset = <T extends string>(
  value: unknown,
  allowed: T[],
  fallback: T[],
) =>
  Array.isArray(value)
    ? allowed.filter(item => value.includes(item))
    : [...fallback];

/**
 * Reads saved settings. `legacy` carries older single switches that existed
 * before this module; they apply only while `features` is missing.
 */
export function normalizeFeatures(
  raw: unknown,
  legacy: { showHeartRate?: boolean } = {},
): FeatureSettings {
  const d = DEFAULT_FEATURES;
  if (!isRecord(raw)) {
    const metrics = legacy.showHeartRate
      ? [...d.recording.metrics, 'heartRate' as const]
      : [...d.recording.metrics];
    return {
      ...d,
      areas: { ...d.areas },
      sports: { ...d.sports },
      soreness: { ...d.soreness },
      home: { sections: [...d.home.sections] },
      planning: { ...d.planning },
      coach: { ...d.coach },
      goals: { ...d.goals },
      templates: { ...d.templates },
      navigation: { tabs: [...d.navigation.tabs] },
      recommendations: { ...d.recommendations },
      recording: {
        ...d.recording,
        metrics: RECORDING_METRICS.filter(item => metrics.includes(item)),
      },
      strength: { ...d.strength },
      statistics: { ...d.statistics, modules: [...d.statistics.modules] },
    };
  }
  const areas = isRecord(raw.areas) ? raw.areas : {};
  const sports = isRecord(raw.sports) ? raw.sports : {};
  const soreness = isRecord(raw.soreness) ? raw.soreness : {};
  const home = isRecord(raw.home) ? raw.home : {};
  const planning = isRecord(raw.planning) ? raw.planning : {};
  const recommendations = isRecord(raw.recommendations)
    ? raw.recommendations
    : {};
  const recording = isRecord(raw.recording) ? raw.recording : {};
  const strength = isRecord(raw.strength) ? raw.strength : {};
  const statistics = isRecord(raw.statistics) ? raw.statistics : {};
  const running = bool(areas.running, d.areas.running);
  const strengthArea = bool(areas.strength, d.areas.strength);
  const restSeconds = Number(strength.defaultRestSeconds);
  const coach = isRecord(raw.coach) ? raw.coach : {};
  const goals = isRecord(raw.goals) ? raw.goals : {};
  const templates = isRecord(raw.templates) ? raw.templates : {};
  const navigation = isRecord(raw.navigation) ? raw.navigation : {};
  const navigationTabs = Array.isArray(navigation.tabs)
    ? navigation.tabs
        .map(tab => (typeof tab === 'string' && LEGACY_TABS[tab]) || tab)
        .filter(
          (tab, index, all): tab is OptionalTab =>
            OPTIONAL_TABS.includes(tab as OptionalTab) &&
            all.indexOf(tab) === index,
        )
        .slice(0, 2)
    : [...d.navigation.tabs];
  const normalized: FeatureSettings = {
    version: FEATURES_VERSION,
    // At least one area stays on, otherwise there would be nothing to start.
    areas:
      running || strengthArea
        ? { running, strength: strengthArea }
        : { ...d.areas },
    sports: { cycling: bool(sports.cycling, d.sports.cycling) },
    coach: { enabled: bool(coach.enabled, d.coach.enabled) },
    goals: { enabled: bool(goals.enabled, d.goals.enabled) },
    templates: { enabled: bool(templates.enabled, d.templates.enabled) },
    navigation: { tabs: navigationTabs },
    soreness: {
      enabled: bool(soreness.enabled, d.soreness.enabled),
      prompt: oneOf(soreness.prompt, SORENESS_PROMPTS, d.soreness.prompt),
      map: bool(soreness.map, d.soreness.map),
      voice: bool(soreness.voice, d.soreness.voice),
    },
    home: {
      sections: subset(home.sections, HOME_SECTIONS, d.home.sections),
    },
    planning: {
      enabled: bool(planning.enabled, d.planning.enabled),
      suggest: bool(planning.suggest, d.planning.suggest),
      month: bool(planning.month, d.planning.month),
    },
    recommendations: {
      running: oneOf(
        recommendations.running,
        RECOMMENDATION_MODES,
        d.recommendations.running,
      ),
      strength: oneOf(
        recommendations.strength,
        RECOMMENDATION_MODES,
        d.recommendations.strength,
      ),
      showQueued: bool(
        recommendations.showQueued,
        d.recommendations.showQueued,
      ),
    },
    recording: {
      metrics: subset(
        recording.metrics,
        RECORDING_METRICS,
        d.recording.metrics,
      ),
      primary: oneOf(
        recording.primary,
        RECORDING_PRIMARIES,
        d.recording.primary,
      ),
      targets: bool(recording.targets, d.recording.targets),
      routes: bool(recording.routes, d.recording.routes),
      afterRun: oneOf(
        recording.afterRun,
        AFTER_RUN_OPTIONS,
        d.recording.afterRun,
      ),
    },
    strength: {
      restTimer: bool(strength.restTimer, d.strength.restTimer),
      restVibration: bool(strength.restVibration, d.strength.restVibration),
      restSound: bool(strength.restSound, d.strength.restSound),
      defaultRestSeconds:
        Number.isInteger(restSeconds) &&
        restSeconds >= MIN_REST_SECONDS &&
        restSeconds <= MAX_REST_SECONDS
          ? restSeconds
          : d.strength.defaultRestSeconds,
      rir: bool(strength.rir, d.strength.rir),
      templateOfDay: bool(strength.templateOfDay, d.strength.templateOfDay),
    },
    statistics: {
      enabled: bool(statistics.enabled, d.statistics.enabled),
      modules: subset(statistics.modules, STATS_MODULES, d.statistics.modules),
    },
  };
  return { ...normalized, navigation: { tabs: pinnedTabs(normalized) } };
}

/** Switches an area; the last active area cannot be switched off. */
export function withArea(
  features: FeatureSettings,
  area: Area,
  enabled: boolean,
): FeatureSettings {
  const next = { ...features.areas, [area]: enabled };
  if (!next.running && !next.strength) {
    return features;
  }
  const updated = { ...features, areas: next };
  return { ...updated, navigation: { tabs: pinnedTabs(updated) } };
}

/** Sports offered in the picker before a recording. */
export function enabledSports(features: FeatureSettings): Sport[] {
  const sports: Sport[] = [];
  if (features.areas.running) {
    sports.push('running');
  }
  if (features.sports.cycling) {
    sports.push('cycling');
  }
  return sports;
}

/** Available features and their tab slots are independent; switching off frees the slot. */
export function featureEnabled(
  features: FeatureSettings,
  id: FeatureId,
): boolean {
  switch (id) {
    case 'routes':
      return features.areas.running && features.recording.routes;
    default:
      return features[id].enabled;
  }
}
export function withFeature(
  features: FeatureSettings,
  id: FeatureId,
  enabled: boolean,
): FeatureSettings {
  const next =
    id === 'routes'
      ? { ...features, recording: { ...features.recording, routes: enabled } }
      : { ...features, [id]: { ...features[id], enabled } };
  // A switched-off slot is freed; switching back on does not pin anything automatically.
  return {
    ...next,
    navigation: {
      tabs: features.navigation.tabs.filter(tab =>
        availableTabs(next).includes(tab),
      ),
    },
  };
}
export function availableTabs(features: FeatureSettings): OptionalTab[] {
  return FEATURE_CATALOG.filter(
    entry => entry.tab && featureEnabled(features, entry.id),
  ).map(entry => entry.tab!);
}
export function pinnedTabs(features: FeatureSettings): OptionalTab[] {
  return features.navigation.tabs
    .filter(tab => availableTabs(features).includes(tab))
    .slice(0, 2);
}
/** Visible name of a tab in the active language. */
export function tabLabel(tab: Tab): string {
  switch (tab) {
    case 'today':
      return tr('Heute', 'Today');
    case 'history':
      return tr('Verlauf', 'History');
    case 'plan':
      return tr('Plan', 'Plan');
    case 'coach':
      return tr('Coach', 'Coach');
    case 'statistics':
      return tr('Statistik', 'Statistics');
    case 'routes':
      return tr('Routen', 'Routes');
    case 'templates':
      return tr('Vorlagen', 'Templates');
    case 'soreness':
      return tr('Muskelkater', 'Soreness');
  }
}
export function visibleTabs(features: FeatureSettings): Tab[] {
  return ['today', ...pinnedTabs(features), 'history'];
}
/** Unknown, duplicate, and switched-off targets never reach the bar. */
export function withNavigation(
  features: FeatureSettings,
  tabs: OptionalTab[],
): FeatureSettings {
  return {
    ...features,
    navigation: {
      tabs: tabs
        .filter(
          (tab, index) =>
            availableTabs(features).includes(tab) &&
            tabs.indexOf(tab) === index,
        )
        .slice(0, 2),
    },
  };
}

/** Whether a recommendation for this area is calculated and shown at all. */
export function recommendationsShown(
  features: FeatureSettings,
  area: Area,
): boolean {
  return (
    features.coach.enabled &&
    features.areas[area] &&
    features.recommendations[area] !== 'off'
  );
}

/** Whether the recommendation for this area appears unasked on Today and after the workout. */
export function recommendationsSuggested(
  features: FeatureSettings,
  area: Area,
): boolean {
  return (
    features.coach.enabled &&
    features.areas[area] &&
    features.recommendations[area] === 'suggest'
  );
}

/**
 * Blocks on Today that the user has ticked and whose feature is on.
 * A switched-off feature takes its block along — it then also drops out of
 * the choices. The start card is not a block; it always stays.
 */
export function availableHomeSections(
  features: FeatureSettings,
): HomeSection[] {
  return HOME_SECTIONS.filter(section => {
    switch (section) {
      case 'week':
        return features.planning.enabled;
      case 'body':
        return features.soreness.enabled;
      case 'goal':
        return features.areas.running && features.goals.enabled;
      case 'recommendation':
        return (
          recommendationsSuggested(features, 'running') ||
          recommendationsSuggested(features, 'strength')
        );
      default:
        return true;
    }
  });
}

export function visibleHomeSections(features: FeatureSettings): HomeSection[] {
  const available = availableHomeSections(features);
  return available.filter(section => features.home.sections.includes(section));
}

const HOUR = 3600 * 1000;
/** Soreness shows up late: it is asked no earlier than 8 and no later than 72 hours after the workout. */
const AFTER_STRENGTH_MIN = 8 * HOUR;
const AFTER_STRENGTH_MAX = 72 * HOUR;

const sameDay = (a: number, b: number) => {
  const x = new Date(a);
  const y = new Date(b);
  return (
    x.getFullYear() === y.getFullYear() &&
    x.getMonth() === y.getMonth() &&
    x.getDate() === y.getDate()
  );
};
/** Monday 0:00 local time of the week that contains `at`. */
const weekStart = (at: number) => {
  const d = new Date(at);
  d.setHours(0, 0, 0, 0);
  const day = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - day);
  return d.getTime();
};

/**
 * Should the soreness question appear now, unasked? Decided purely from the
 * setting, reports, and strength sessions; the caller records whether the
 * question was already seen in this session.
 */
export function shouldPromptSoreness(
  features: FeatureSettings,
  reports: Pick<SorenessReport, 'at'>[],
  sessions: Pick<StrengthSession, 'status' | 'startTime' | 'endTime'>[],
  trainingDays: number[],
  now: number,
): boolean {
  if (!features.soreness.enabled) {
    return false;
  }
  const reportedToday = reports.some(report => sameDay(report.at, now));
  switch (features.soreness.prompt) {
    case 'never':
      return false;
    case 'daily':
      return !reportedToday;
    case 'training_days':
      return !reportedToday && trainingDays.includes(new Date(now).getDay());
    case 'weekly': {
      const start = weekStart(now);
      return !reports.some(report => report.at >= start && report.at <= now);
    }
    case 'after_strength': {
      if (reportedToday) {
        return false;
      }
      return sessions.some(session => {
        if (session.status !== 'finished') {
          return false;
        }
        const end = session.endTime ?? session.startTime;
        const age = now - end;
        if (age < AFTER_STRENGTH_MIN || age > AFTER_STRENGTH_MAX) {
          return false;
        }
        // Once per session: one report after its end is enough.
        return !reports.some(report => report.at >= end);
      });
    }
    default:
      return false;
  }
}

/** Option label for the soreness prompt setting, in the active language. */
export function sorenessPromptLabel(value: SorenessPrompt): string {
  switch (value) {
    case 'never':
      return tr('Nie – nur selbst melden', 'Never – only report it yourself');
    case 'after_strength':
      return tr('Nach Krafttraining', 'After strength training');
    case 'daily':
      return tr('Täglich beim ersten Öffnen', 'Daily, on first open');
    case 'training_days':
      return tr('An Trainingstagen', 'On training days');
    case 'weekly':
      return tr('Einmal pro Woche', 'Once a week');
  }
}
/** Option label for a recommendation mode, in the active language. */
export function recommendationModeLabel(value: RecommendationMode): string {
  switch (value) {
    case 'suggest':
      return tr('Vorschlagen', 'Suggest');
    case 'on_request':
      return tr('Nur auf Nachfrage', 'Only on request');
    case 'off':
      return tr('Aus', 'Off');
  }
}
/** Option label for what happens after a recording, in the active language. */
export function afterRunLabel(value: AfterRun): string {
  switch (value) {
    case 'detail':
      return tr('Detailseite öffnen', 'Open the detail page');
    case 'feeling':
      return tr('Nur Gefühl abfragen', 'Only ask how it felt');
    case 'home':
      return tr('Direkt zurück zu Heute', 'Straight back to Today');
  }
}
/** Name of a home section, in the active language. */
export function homeSectionLabel(value: HomeSection): string {
  switch (value) {
    case 'week':
      return tr('Wochenleiste', 'Week bar');
    case 'recommendation':
      return tr('Empfehlung', 'Recommendation');
    case 'goal':
      return tr('Zielnähe', 'Goal progress');
    case 'body':
      return tr('Muskelkater melden', 'Report soreness');
    case 'recent':
      return tr('Zuletzt', 'Recent');
  }
}
/** Name of a recording metric, in the active language. */
export function recordingMetricLabel(value: RecordingMetric): string {
  switch (value) {
    case 'distance':
      return tr('Kilometer', 'Kilometers');
    case 'pace':
      return tr('Tempo', 'Pace');
    case 'heartRate':
      return tr('Herzfrequenz', 'Heart rate');
    case 'target':
      return tr('Laufen nach', 'Run to');
  }
}
/** Name of the primary recording value, in the active language. */
export function recordingPrimaryLabel(value: RecordingPrimary): string {
  switch (value) {
    case 'duration':
      return tr('Dauer', 'Duration');
    case 'distance':
      return tr('Kilometer', 'Kilometers');
    case 'heartRate':
      return tr('Herzfrequenz', 'Heart rate');
  }
}
/** Name of a statistics module, in the active language. */
export function statsModuleLabel(value: StatsModule): string {
  switch (value) {
    case 'distribution':
      return tr('Verteilung', 'Distribution');
    case 'records':
      return tr('Bestwerte', 'Personal bests');
    case 'consistency':
      return tr('Konsistenz', 'Consistency');
    case 'body':
      return tr('Körperwerte', 'Body values');
  }
}
