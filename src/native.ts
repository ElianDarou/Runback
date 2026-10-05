import { NativeModules } from 'react-native';
import type { TrainingFocus } from './domain/focus';
import type {
  GaitPlacement,
  RunSummary,
  RunPurpose,
  Sport,
  Experiment,
  Adherence,
} from './domain/types';
import type { RouteCoordinate, RoutePlan } from './domain/routes';
import type { RunTimeline } from './domain/runReport';
import type { RunSeries } from './domain/runSeries';
import { normalizeSport } from './domain/sport';
import { normalizePurpose } from './domain/runTitle';
import type { PurposeHintProvenance } from './domain/purposeHint';
import type {
  StrengthSession,
  StrengthState,
  WorkoutTemplate,
} from './domain/strength';
import { summarize } from './domain/strength';
import { importedStrengthSession } from './domain/strengthImports';
import type { StrongWorkout } from './domain/vendorImports';
import {
  readImportBatches,
  type ImportBatch,
  type ImportChoice,
} from './domain/importReview';
import type { ScheduleState } from './domain/schedule';
import { normalizeRunTarget, type RunTarget } from './domain/runTarget';
import type {
  SorenessReport as CapturedSorenessReport,
  StructuredSorenessItem,
} from './domain/sorenessInput';
import type { FeatureSettings } from './domain/features';
import {
  readStrengthHeart,
  readStrengthHeartSummaries,
  type StrengthHeart,
  type StrengthHeartSummary,
} from './domain/strengthHeart';

export interface Preset {
  id: string;
  name: string;
  purpose: RunPurpose;
  minutes: number;
  cues: boolean;
}
export interface Settings {
  schedule?: ScheduleState;
  goal?: string;
  goalTargetDate?: string;
  /** Zielstrecke in km und Zielzeit in Sekunden fürs Laufziel (`domain/raceGoal`). */
  goalDistanceKm?: number;
  goalTargetSeconds?: number;
  trainingFocus?: TrainingFocus | null;
  /** Bereich Krafttraining: eigenes Ziel und eigener Fokus. */
  strengthGoal?: string;
  strengthGoalTargetDate?: string;
  strengthFocus?: TrainingFocus | null;
  strengthPostponedUntil?: number;
  minutes?: number;
  purpose?: RunPurpose;
  /** Zuletzt gewählte Sportart für die freie Aufzeichnung. */
  sport?: Sport;
  /** Wo das Handy beim Laufen steckt; Kotlin liest es beim Start für den Laufstil. */
  gaitPlacement?: GaitPlacement;
  /** Puls und Bewegungen der Uhr im Krafttraining; Kotlin liest es beim Start einer Einheit. */
  motionCapture?: MotionCaptureSettings;
  trainingDays?: number[];
  cues?: boolean;
  /** Explizit gewählte Begleitung für den nächsten Lauf. */
  runTarget?: RunTarget;
  weather?: boolean;
  /** Maxpuls in bpm für die Pulszonen; fehlt er, schätzt Runback aus den Läufen. */
  maxHeartRate?: number;
  /** Älterer Einzelschalter; gilt nur, solange `features` fehlt. */
  showHeartRate?: boolean;
  /** Was der Nutzer sehen will und wann Runback fragt (`domain/features`). */
  features?: FeatureSettings;
  presets?: Preset[];
  experiments?: Experiment[];
  dismissedRecommendations?: string[];
  /** Gelöschte Importvorschläge; Originaleinheiten und gespeicherte Vorlagen bleiben erhalten. */
  dismissedStrengthImportTemplateIds?: string[];
  adherence?: Record<string, Adherence>;
  postponedUntil?: number;
  [key: string]: unknown;
}
export type MotionWrist = 'left' | 'right' | 'unknown';
export interface MotionCaptureSettings {
  /** Bewegungen mitschreiben (Rohdaten für spätere Satzerkennung). */
  enabled: boolean;
  wrist: MotionWrist;
  /** Puls messen; fehlt der Wert, ist er an (Kotlin `MotionSessions.config`). */
  heartRate?: boolean;
}
/** Zähler aus `MotionSessions.status`; die Rohdaten selbst bleiben nativ. */
export interface MotionStatus {
  enabled: boolean;
  heartRate?: boolean;
  wrist: MotionWrist;
  sessions: number;
  received: number;
  waiting: number;
  bytes: number;
  recording: {
    sessionId: string;
    watch: { status?: string; message?: string };
  } | null;
}
export interface RoutePoint {
  latitude: number;
  longitude: number;
  time?: number;
  gap?: boolean;
}
export interface Run extends RunSummary {
  note?: string;
  route?: RoutePoint[];
  events?: { type?: string; at?: number; message?: string }[];
  target?: RunTarget;
  /** Laufart ausdrücklich gewählt oder bestätigt; dann fragt die Detailseite nicht mehr. */
  purposeConfirmed?: boolean;
  /** Spur eines bestätigten Vorschlags; fehlt bei eigener Wahl. */
  purposeHint?: PurposeHintProvenance;
}
export interface Capabilities {
  gps?: boolean;
  barometer?: boolean;
  accelerometer?: boolean;
  locationPermission?: boolean;
  notificationPermission?: boolean;
  bluetoothPermission?: boolean;
  microphonePermission?: boolean;
  speechRecognition?: boolean;
  healthConnect?: string;
  [key: string]: unknown;
}
export interface NativeLocation {
  latitude: number;
  longitude: number;
  accuracyM?: number;
  label?: string;
}
export interface LocationSearchResult extends NativeLocation {
  label: string;
}
export interface RouteVoiceSettings {
  enabled: boolean;
  pace: boolean;
  distance: boolean;
  heartRate: boolean;
  navigation: boolean;
  intervalKm: number;
}
export interface RoutePlannerState {
  routes: RoutePlan[];
  voice: RouteVoiceSettings;
  activeRoutePlanId?: string | null;
}
export interface SorenessTranscript {
  text: string;
  structured?: StructuredSorenessItem[];
}
export interface AppState {
  runs: Run[];
  recording: Run | null;
  settings: Settings;
  capabilities: Capabilities;
}
const module = NativeModules.Runback;
const routeModule = NativeModules.RoutePlanner;
export async function nativeCall<T = unknown>(
  method: string,
  ...args: unknown[]
): Promise<T> {
  if (!module || typeof module[method] !== 'function') {
    throw new Error('Diese Funktion ist in diesem Build noch nicht verfügbar.');
  }
  const result = await module[method](...args);
  return (typeof result === 'string' ? JSON.parse(result) : result) as T;
}
export async function routeCall<T = unknown>(
  method: string,
  ...args: unknown[]
): Promise<T> {
  if (!routeModule || typeof routeModule[method] !== 'function') {
    throw new Error(
      'Der Routenplaner ist in diesem Build noch nicht verfügbar.',
    );
  }
  const result = await routeModule[method](...args);
  return (typeof result === 'string' ? JSON.parse(result) : result) as T;
}
export function normalizeRun(raw: any): Run {
  const feedback = raw.feedback || {};
  return {
    ...raw,
    startTime: raw.startTime ?? raw.startedAt ?? 0,
    endTime: raw.endTime ?? raw.endedAt ?? 0,
    durationSeconds:
      raw.durationSeconds ?? raw.durationSec ?? (raw.elapsedMs || 0) / 1000,
    distanceMeters: raw.distanceMeters ?? raw.distanceM ?? 0,
    source: raw.source || 'phone',
    purpose: normalizePurpose(feedback.purpose ?? raw.purpose),
    purposeConfirmed: feedback.purposeConfirmed === true,
    purposeHint:
      feedback.purposeHint && typeof feedback.purposeHint === 'object'
        ? feedback.purposeHint
        : undefined,
    sport: normalizeSport(feedback.sport ?? raw.sport),
    samples: raw.samples ?? raw.rawSampleCount ?? 0,
    sourceVersion: raw.sourceVersion || 'native-v1',
    rpe: raw.rpe ?? feedback.rpe,
    note: raw.note ?? feedback.note,
    route: raw.route ?? raw.geometry,
    target: raw.target ? normalizeRunTarget(raw.target) : undefined,
  };
}
export const native = {
  async runIdsInRange(from: number, until: number): Promise<string[]> {
    const result = await nativeCall<{ ids: string[] }>(
      'runIdsInRange',
      from,
      until,
    );
    return result.ids;
  },
  async beginRunArchive(): Promise<string> {
    return (await nativeCall<{ id: string }>('beginRunArchive')).id;
  },
  async appendRunArchive(
    id: string,
    runId: string,
    files: {
      markdown: { fileName: string; content: string };
      analysis: { fileName: string; content: string };
      timeseries: string;
    },
  ) {
    await nativeCall('appendRunArchive', id, runId, JSON.stringify(files));
  },
  async shareRunArchive(id: string) {
    await nativeCall('shareRunArchive', id);
  },
  async discardRunArchive(id: string) {
    await nativeCall('discardRunArchive', id);
  },
  async state(): Promise<AppState> {
    const raw = await nativeCall<any>('getState');
    return {
      runs: (raw.runs || []).map(normalizeRun),
      recording: raw.recording ? normalizeRun(raw.recording) : null,
      settings: raw.settings || {},
      capabilities: raw.capabilities || {},
    };
  },
  async run(id: string): Promise<Run> {
    return normalizeRun(await nativeCall('getRun', id));
  },
  async saveSettings(settings: Settings) {
    await nativeCall('saveSettings', JSON.stringify(settings));
  },
  async feedback(id: string, feedback: unknown) {
    await nativeCall('updateRunFeedback', id, JSON.stringify(feedback));
  },
  /** Begrenzter Zeitverlauf (Aggregate je Fenster) für den Laufbericht. */
  async runTimeline(id: string, maxRows = 120): Promise<RunTimeline> {
    const raw = await nativeCall<any>('getRunTimeline', id, maxRows);
    return {
      version: raw?.version,
      stepSeconds: Number(raw?.stepSeconds) || 60,
      rows: Array.isArray(raw?.rows) ? raw.rows : [],
    };
  },
  /** Darstellungsreihe für die Graphen der Detailseite (RunSeries, ≤ maxRows Zeilen). */
  async runSeries(id: string, maxRows = 600): Promise<RunSeries> {
    const raw = await nativeCall<any>('getRunSeries', id, maxRows);
    return {
      version: raw?.version,
      stepSeconds: Number(raw?.stepSeconds) || 5,
      wind:
        raw?.wind &&
        Number.isFinite(raw.wind.mps) &&
        Number.isFinite(raw.wind.fromDeg)
          ? { mps: raw.wind.mps, fromDeg: raw.wind.fromDeg }
          : undefined,
      rows: Array.isArray(raw?.rows) ? raw.rows : [],
    };
  },
  /**
   * Schreibt die 5-s-Zeitreihe nativ als CSV in den Export-Cache. Die Zeilen
   * bleiben in Kotlin; zurück kommt nur der Dateiname.
   */
  async writeRunTimeseries(
    id: string,
    fileName: string,
  ): Promise<{ fileName: string; rows: number }> {
    const raw = await nativeCall<any>('writeRunTimeseries', id, fileName);
    return {
      fileName: String(raw?.fileName || fileName),
      rows: Number(raw?.rows) || 0,
    };
  },
  /**
   * Teilt mehrere Dateien auf einmal. Einträge ohne `content` müssen bereits
   * im Export-Cache liegen (siehe writeRunTimeseries).
   */
  async shareFiles(
    files: { fileName: string; mimeType: string; content?: string }[],
    title: string,
  ) {
    await nativeCall('shareFiles', JSON.stringify(files), title);
  },
  /** Übergibt eine Textdatei an das System-Share-Sheet. */
  async shareTextFile(
    fileName: string,
    content: string,
    title: string,
    mimeType = 'text/plain',
  ) {
    await nativeCall('shareTextFile', fileName, mimeType, content, title);
  },
  // Krafttraining. Der native Speicher legt die laufende Einheit getrennt von
  // der Historie ab, damit ein bestätigter Satz eine kleine Schreiboperation
  // bleibt.
  async strength(): Promise<StrengthState> {
    return normalizeStrength(await nativeCall<any>('getStrengthState'));
  },
  async saveStrengthTemplates(
    templates: WorkoutTemplate[],
  ): Promise<StrengthState> {
    return normalizeStrength(
      await nativeCall<any>('saveStrengthTemplates', JSON.stringify(templates)),
    );
  },
  async saveStrengthSession(session: StrengthSession): Promise<StrengthState> {
    return normalizeStrength(
      await nativeCall<any>('saveStrengthSession', JSON.stringify(session)),
    );
  },
  async discardStrengthSession(): Promise<StrengthState> {
    return normalizeStrength(await nativeCall<any>('discardStrengthSession'));
  },
  async finishStrengthSession(
    session: StrengthSession,
  ): Promise<StrengthState> {
    return normalizeStrength(
      await nativeCall<any>(
        'finishStrengthSession',
        JSON.stringify(session),
        JSON.stringify(summarize(session)),
      ),
    );
  },
  async strengthSession(id: string): Promise<StrengthSession> {
    const raw = await nativeCall<any>('getStrengthSession', id);
    return raw?.kind === 'strength' ? raw : importedStrengthSession(raw);
  },
  async strengthSessions(limit = 100): Promise<StrengthSession[]> {
    const raw = await nativeCall<any>('getStrengthSessions', limit);
    const sessions: StrengthSession[] = Array.isArray(raw?.sessions)
      ? raw.sessions
      : [];
    const imported: StrongWorkout[] = Array.isArray(raw?.imports)
      ? raw.imports
      : [];
    const unique = new Map(sessions.map(session => [session.id, session]));
    imported.forEach(workout => {
      const session = importedStrengthSession(workout);
      if (!unique.has(session.id)) {
        unique.set(session.id, session);
      }
    });
    return Array.from(unique.values())
      .sort((a, b) => b.startTime - a.startTime || b.id.localeCompare(a.id))
      .slice(0, Math.max(1, Math.min(500, limit)));
  },
  /** Puls einer Krafteinheit von der Uhr, mit Darstellungsreihe; sonst undefined. */
  async strengthHeart(id: string): Promise<StrengthHeart | undefined> {
    return readStrengthHeart(await nativeCall<unknown>('getStrengthHeart', id));
  },
  /** Kurzformen ohne Reihe für alle Einheiten mit Puls, nach Einheit. */
  async strengthHeartSummaries(): Promise<
    Record<string, StrengthHeartSummary>
  > {
    return readStrengthHeartSummaries(
      await nativeCall<unknown>('getStrengthHeartSummaries'),
    );
  },
  /** Speichert eine geprüfte Vorschau aus `importFiles` mit der Wahl des Nutzers. */
  async commitImport(token: string, choice: ImportChoice): Promise<any> {
    return nativeCall<any>('commitImport', token, JSON.stringify(choice));
  },
  async discardImport(token: string): Promise<any> {
    return nativeCall<any>('discardImport', token);
  },
  async importBatches(): Promise<ImportBatch[]> {
    return readImportBatches(await nativeCall<unknown>('getImportBatches'));
  },
  async deleteImportBatch(id: string): Promise<{
    deleted?: { runs: number; strength: number; wellness: number };
    kept?: number;
  }> {
    return nativeCall<any>('deleteImportBatch', id);
  },
  async deleteStrengthSession(id: string): Promise<StrengthState> {
    return normalizeStrength(
      await nativeCall<any>('deleteStrengthSession', id),
    );
  },
  async sorenessReports(): Promise<CapturedSorenessReport[]> {
    const raw = await nativeCall<any>('getSorenessReports');
    return Array.isArray(raw?.reports)
      ? (raw.reports as CapturedSorenessReport[])
      : [];
  },
  async saveSorenessReport(
    report: CapturedSorenessReport,
  ): Promise<CapturedSorenessReport[]> {
    const raw = await nativeCall<any>(
      'saveSorenessReport',
      JSON.stringify(report),
    );
    return Array.isArray(raw?.reports)
      ? (raw.reports as CapturedSorenessReport[])
      : [];
  },
  async requestSorenessVoicePermissions(): Promise<Capabilities> {
    return nativeCall<Capabilities>('requestSorenessVoicePermissions');
  },
  async transcribeSoreness(): Promise<SorenessTranscript> {
    return nativeCall<SorenessTranscript>('transcribeSoreness');
  },
  async currentLocation(): Promise<NativeLocation> {
    return routeCall<NativeLocation>('getCurrentLocation');
  },
  async searchLocation(query: string): Promise<LocationSearchResult[]> {
    const raw = await routeCall<LocationSearchResult[]>(
      'searchLocation',
      query,
    );
    return Array.isArray(raw) ? raw : [];
  },
  async speakRoute(text: string) {
    await routeCall('routeSpeak', text);
  },
  async stopRouteSpeech() {
    await routeCall('routeStopSpeaking');
  },
  async openRouteFile(
    points: RouteCoordinate[],
    target: 'comaps' | 'chooser' = 'comaps',
  ) {
    await routeCall('openRouteFile', JSON.stringify(points), target);
  },
  async routePlannerState(): Promise<RoutePlannerState> {
    const raw = await routeCall<any>('getRoutePlannerState');
    return {
      routes: Array.isArray(raw?.routes) ? raw.routes : [],
      voice: raw?.voice || {
        enabled: true,
        pace: true,
        distance: true,
        heartRate: false,
        navigation: true,
        intervalKm: 1,
      },
      activeRoutePlanId: raw?.activeRoutePlanId ?? null,
    };
  },
  async saveRoutePlannerState(state: RoutePlannerState) {
    await routeCall('saveRoutePlannerState', JSON.stringify(state));
  },
};

/** Fehlende Felder ergeben einen leeren, benutzbaren Zustand statt eines Fehlers. */
export function normalizeStrength(raw: any): StrengthState {
  return {
    templates: Array.isArray(raw?.templates) ? raw.templates : [],
    active:
      raw?.active && raw.active.id ? (raw.active as StrengthSession) : null,
    history: Array.isArray(raw?.history) ? raw.history : [],
  };
}
