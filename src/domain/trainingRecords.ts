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
import type { IntervalState, RunTarget, RunTargetMemory } from './runTarget';
import type { RunAnnouncementSettings } from './runAnnouncements';
import type { FeatureSettings } from './features';
import type { PurposeHintProvenance } from './purposeHint';
import type { Language } from './i18n';

/**
 * Shared records of phone and server, without a dependency on the native bridge.
 * Run templates are no longer offered (the goal in the start sheet replaced
 * them); stored ones stay in the settings untouched.
 */
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
  /** Goal distance in km and goal time in seconds for the running goal (`domain/raceGoal`). */
  goalDistanceKm?: number;
  goalTargetSeconds?: number;
  trainingFocus?: TrainingFocus | null;
  /** Strength area: own goal and own focus. */
  strengthGoal?: string;
  strengthGoalTargetDate?: string;
  strengthFocus?: TrainingFocus | null;
  strengthPostponedUntil?: number;
  minutes?: number;
  /** No longer read: the run type is asked after the run (`likelyPurpose`). */
  purpose?: RunPurpose;
  /** Last chosen sport for free recording. */
  sport?: Sport;
  /** Where the phone is carried while running; Kotlin reads it at start for running form. */
  gaitPlacement?: GaitPlacement;
  /** Heart rate and watch motion in strength training; Kotlin reads it when a session starts. */
  motionCapture?: MotionCaptureSettings;
  trainingDays?: number[];
  cues?: boolean;
  /** Explicitly chosen goal for the next run (how far and what to run by). */
  runTarget?: RunTarget;
  /** Last values per goal kind, so switching chips restores them (`RunTargetMemory`). */
  runTargetMemory?: RunTargetMemory;
  /** Progress announcements: a switch and their setup, apart from the goal (`RunAnnouncementSettings`). */
  runAnnouncements?: RunAnnouncementSettings;
  weather?: boolean;
  /** Max heart rate in bpm for the heart rate zones; if missing, Runback estimates it from runs. */
  maxHeartRate?: number;
  /** Older single switch; applies only while `features` is missing. */
  showHeartRate?: boolean;
  /** What the user wants to see and when Runback asks (`domain/features`). */
  features?: FeatureSettings;
  presets?: Preset[];
  experiments?: Experiment[];
  dismissedRecommendations?: string[];
  /** Deleted import suggestions; original sessions and saved templates are kept. */
  dismissedStrengthImportTemplateIds?: string[];
  adherence?: Record<string, Adherence>;
  postponedUntil?: number;
  /** App language; missing means the device language (`ui/deviceLanguage`). Kotlin reads it for notifications. */
  language?: Language;
  [key: string]: unknown;
}
export type MotionWrist = 'left' | 'right' | 'unknown';
export interface MotionCaptureSettings {
  /** Record motion (raw data for later set detection). */
  enabled: boolean;
  wrist: MotionWrist;
  /** Measure heart rate; if the value is missing, it is on (Kotlin `MotionSessions.config`). */
  heartRate?: boolean;
  /**
   * Detect sets on the watch and count reps; only with `enabled`. If the
   * value is missing, it is on (Kotlin `MotionSessions.config`).
   */
  autoSets?: boolean;
  /**
   * Accept the detected count after a short time without input; only with
   * `autoSets`. If the value is missing, it is off — the user confirms.
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
  /** Current interval phase, written by Kotlin on each phase change. */
  intervalState?: IntervalState;
  /** Run type explicitly chosen or confirmed; then the detail page stops asking. */
  purposeConfirmed?: boolean;
  /** The run type question was shown once and dismissed; it does not come back. */
  purposeAsked?: boolean;
  /** Trace of a confirmed suggestion; missing when chosen by the user. */
  purposeHint?: PurposeHintProvenance;
}
