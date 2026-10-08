import type { TrainingFocus } from './focus';
import type {
  GaitPlacement,
  RunSummary,
  RunPurpose,
  Sport,
  Experiment,
  Adherence,
} from './types';
import type { ScheduleState } from './schedule';
import type { RunTarget } from './runTarget';
import type { FeatureSettings } from './features';
import type { PurposeHintProvenance } from './purposeHint';
import type { Language } from './i18n';

/** Gemeinsame Datensätze von Telefon und Server, ohne Abhängigkeit zur nativen Brücke. */
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
  /** App language; missing means the device language (`ui/deviceLanguage`). Kotlin reads it for notifications. */
  language?: Language;
  [key: string]: unknown;
}
export type MotionWrist = 'left' | 'right' | 'unknown';
export interface MotionCaptureSettings {
  /** Bewegungen mitschreiben (Rohdaten für spätere Satzerkennung). */
  enabled: boolean;
  wrist: MotionWrist;
  /** Puls messen; fehlt der Wert, ist er an (Kotlin `MotionSessions.config`). */
  heartRate?: boolean;
  /**
   * Sätze auf der Uhr erkennen und Wiederholungen zählen; nur mit
   * `enabled`. Fehlt der Wert, ist sie an (Kotlin `MotionSessions.config`).
   */
  autoSets?: boolean;
  /**
   * Erkannte Zahl ohne Eingabe nach kurzer Zeit übernehmen; nur mit
   * `autoSets`. Fehlt der Wert, ist sie aus — der Nutzer bestätigt selbst.
   */
  autoConfirm?: boolean;
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
