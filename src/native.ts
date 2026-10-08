import type {
  Settings,
  MotionWrist,
  Run,
} from './domain/trainingRecords';
import { tr } from './domain/i18n';
export type {
  Preset,
  Settings,
  MotionWrist,
  MotionCaptureSettings,
  RoutePoint,
  Run,
} from './domain/trainingRecords';
import { readServerLinkStatus, type ServerScope } from './domain/serverLink';
import { NativeEventEmitter, NativeModules } from 'react-native';
import type { RouteCoordinate, RoutePlan } from './domain/routes';
import type { RunTimeline } from './domain/runReport';
import type { RunSeries } from './domain/runSeries';
import type {
  StrengthSession,
  StrengthState,
  WorkoutTemplate,
} from './domain/strength';
import { summarize } from './domain/strength';
import {
  mergeStrengthSessions,
  normalizeRun,
  normalizeStrength,
  strengthSessionFromBridge,
} from './domain/bridgeRecords';

export interface StrengthEndEditorData {
  startTime: number;
  rangeEnd: number;
  recordedEndTime?: number;
  reportedEndTime?: number;
  correctedEndTime?: number;
  heart?: StrengthHeart;
}
export interface RunEndEditorData {
  startTime: number;
  originalEndTime: number;
  correctedEndTime?: number;
  series: RunSeries | null;
  /** Why the end cannot be shortened safely, e.g. pauses without a time. */
  blockedReason?: string;
}
import {
  readImportBatches,
  type ImportBatch,
  type ImportChoice,
} from './domain/importReview';
import type {
  SorenessReport as CapturedSorenessReport,
  StructuredSorenessItem,
} from './domain/sorenessInput';
import {
  readStrengthHeart,
  readStrengthHeartSummaries,
  type StrengthHeart,
  type StrengthHeartSummary,
} from './domain/strengthHeart';
import {
  readStrengthWatchInfo,
  type StrengthWatchInfo,
} from './domain/wearLink';

/** Counters from `MotionSessions.status`; the raw data itself stays native. */
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
export { normalizeRun, normalizeStrength };
const module = NativeModules.Runback;
/** Same name as `StrengthWorkout.EVENT` in Kotlin. */
const STRENGTH_CHANGED_EVENT = 'runbackStrengthChanged';
const routeModule = NativeModules.RoutePlanner;
export async function nativeCall<T = unknown>(
  method: string,
  ...args: unknown[]
): Promise<T> {
  if (!module || typeof module[method] !== 'function') {
    throw new Error(
      tr(
        'Diese Funktion ist in diesem Build noch nicht verfügbar.',
        'This function is not available in this build yet.',
      ),
    );
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
      tr(
        'Der Routenplaner ist in diesem Build noch nicht verfügbar.',
        'The route planner is not available in this build yet.',
      ),
    );
  }
  const result = await routeModule[method](...args);
  return (typeof result === 'string' ? JSON.parse(result) : result) as T;
}
export const native = {
  async serverStatus() {
    return readServerLinkStatus(await nativeCall('getServerStatus'));
  },
  async connectServer(url: string, code: string, scope: ServerScope) {
    return readServerLinkStatus(
      await nativeCall('connectServer', url, code, JSON.stringify(scope)),
    );
  },
  async setServerScope(scope: ServerScope) {
    return readServerLinkStatus(
      await nativeCall('setServerScope', JSON.stringify(scope)),
    );
  },
  async syncServer() {
    return readServerLinkStatus(await nativeCall('syncServer'));
  },
  async disconnectServer() {
    return readServerLinkStatus(await nativeCall('disconnectServer'));
  },
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
  // ZIP from flat files; each call appends to files with the same name.
  async beginExportArchive(prefix: string): Promise<string> {
    return (await nativeCall<{ id: string }>('beginExportArchive', prefix)).id;
  },
  async appendExportArchive(id: string, files: Record<string, string>) {
    await nativeCall('appendExportArchive', id, JSON.stringify(files));
  },
  /** `includeMotion`: Kotlin adds the motion data as the folder `bewegungsdaten/`. */
  async shareExportArchive(
    id: string,
    title: string,
    options: { includeMotion?: boolean } = {},
  ) {
    await nativeCall(
      'shareExportArchive',
      id,
      title,
      options.includeMotion === true,
    );
  },
  async motionStatus(): Promise<MotionStatus> {
    return nativeCall<MotionStatus>('getMotionStatus');
  },
  async discardExportArchive(id: string) {
    await nativeCall('discardExportArchive', id);
  },
  /** Strength sessions recorded in Runback, oldest first, without imports. */
  async recordedStrengthSessionIds(): Promise<string[]> {
    return (await nativeCall<{ ids: string[] }>('recordedStrengthSessionIds'))
      .ids;
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
  /** Limited time course (aggregates per window) for the run report. */
  async runTimeline(id: string, maxRows = 120): Promise<RunTimeline> {
    const raw = await nativeCall<any>('getRunTimeline', id, maxRows);
    return {
      version: raw?.version,
      stepSeconds: Number(raw?.stepSeconds) || 60,
      rows: Array.isArray(raw?.rows) ? raw.rows : [],
    };
  },
  /** Display series for the detail page charts (RunSeries, ≤ maxRows rows). */
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
   * Writes the 5-second time series natively as CSV into the export cache. The
   * rows stay in Kotlin; only the file name comes back.
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
   * Shares several files at once. Entries without `content` must already be in
   * the export cache (see writeRunTimeseries).
   */
  async shareFiles(
    files: { fileName: string; mimeType: string; content?: string }[],
    title: string,
  ) {
    await nativeCall('shareFiles', JSON.stringify(files), title);
  },
  /** Passes a text file to the system share sheet. */
  async shareTextFile(
    fileName: string,
    content: string,
    title: string,
    mimeType = 'text/plain',
  ) {
    await nativeCall('shareTextFile', fileName, mimeType, content, title);
  },
  // Strength training. The native store keeps the running session apart from
  // the history, so a confirmed set stays a small write operation.
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
  /** `conflict`: the watch or notification was faster; `active` is its state. */
  async saveStrengthSession(
    session: StrengthSession,
  ): Promise<StrengthState & { conflict: boolean }> {
    const raw = await nativeCall<any>(
      'saveStrengthSession',
      JSON.stringify(session),
    );
    return { ...normalizeStrength(raw), conflict: raw?.conflict === true };
  },
  /**
   * Changes to the running session that do not come from the app: the watch or
   * a notification ticked a set or controlled the rest. Returns an unsubscribe.
   */
  onStrengthChanged(
    listener: (session: StrengthSession | null) => void,
  ): () => void {
    if (!module) return () => {};
    const subscription = new NativeEventEmitter(module).addListener(
      STRENGTH_CHANGED_EVENT,
      (raw: unknown) => {
        try {
          const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
          listener(normalizeStrength({ active: parsed }).active);
        } catch {
          // An unreadable event changes nothing; the next sync fetches the state.
        }
      },
    );
    return () => subscription.remove();
  },
  async discardStrengthSession(): Promise<StrengthState> {
    return normalizeStrength(await nativeCall<any>('discardStrengthSession'));
  },
  async finishStrengthSession(
    session: StrengthSession,
  ): Promise<StrengthState & { conflict: boolean }> {
    const raw = await nativeCall<any>(
      'finishStrengthSession',
      JSON.stringify(session),
      JSON.stringify(summarize(session)),
    );
    return { ...normalizeStrength(raw), conflict: raw?.conflict === true };
  },
  async strengthSession(id: string): Promise<StrengthSession> {
    const raw = await nativeCall<any>('getStrengthSession', id);
    return strengthSessionFromBridge(raw);
  },
  async strengthSessions(limit = 100): Promise<StrengthSession[]> {
    const raw = await nativeCall<any>('getStrengthSessions', limit);
    return mergeStrengthSessions(
      Array.isArray(raw?.sessions) ? raw.sessions : [],
      Array.isArray(raw?.imports) ? raw.imports : [],
      Math.min(500, limit),
    );
  },
  /** Heart rate of a strength session from the watch, with display series; otherwise undefined. */
  async strengthHeart(id: string): Promise<StrengthHeart | undefined> {
    return readStrengthHeart(await nativeCall<unknown>('getStrengthHeart', id));
  },
  /** What the watch measured for a strength session and sent; `null` without a watch. */
  async strengthWatch(id: string): Promise<StrengthWatchInfo | null> {
    return readStrengthWatchInfo(
      await nativeCall<unknown>('getStrengthWatch', id),
    );
  },
  /** Short forms without a series for all sessions with heart rate, per session. */
  async strengthHeartSummaries(): Promise<
    Record<string, StrengthHeartSummary>
  > {
    return readStrengthHeartSummaries(
      await nativeCall<unknown>('getStrengthHeartSummaries'),
    );
  },
  /** Time range, ends and heart rate for “Edit end” of a strength session. */
  async strengthEndEditor(id: string): Promise<StrengthEndEditorData> {
    const raw = await nativeCall<any>('getStrengthEndEditor', id);
    const time = (value: unknown) =>
      typeof value === 'number' && Number.isFinite(value) && value > 0
        ? value
        : undefined;
    return {
      startTime: raw.startTime,
      rangeEnd: raw.rangeEnd,
      recordedEndTime: time(raw.recordedEndTime),
      reportedEndTime: time(raw.reportedEndTime),
      correctedEndTime: time(raw.correctedEndTime),
      heart: readStrengthHeart(raw.heart),
    };
  },
  /** `null` restores the original end. */
  async setStrengthEnd(
    id: string,
    endTime: number | null,
  ): Promise<StrengthSession> {
    const raw = await nativeCall<any>('setStrengthEnd', id, endTime ?? -1);
    return strengthSessionFromBridge(raw);
  },
  /** Uncorrected history of a run for “Edit end”. */
  async runEndEditor(id: string): Promise<RunEndEditorData> {
    const raw = await nativeCall<any>('getRunEndEditor', id);
    const corrected = raw.correctedEndTime;
    return {
      startTime: raw.startTime,
      originalEndTime: raw.originalEndTime,
      correctedEndTime:
        typeof corrected === 'number' && corrected > 0 ? corrected : undefined,
      series: raw.hasSamples && raw.series ? (raw.series as RunSeries) : null,
      blockedReason:
        typeof raw.blockedReason === 'string' ? raw.blockedReason : undefined,
    };
  },
  async setRunEnd(id: string, endTime: number | null): Promise<void> {
    await nativeCall<any>('setRunEnd', id, endTime ?? -1);
  },
  /** Saves a checked preview from `importFiles` with the user's choice. */
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
