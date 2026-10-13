export type RunPurpose =
  | 'easy'
  | 'long'
  | 'intervals'
  | 'race'
  | 'free'
  | 'unknown';
/**
 * Sport of a recording. A missing field means a run, so older records stay
 * readable without migration. Labels and rules: sport.ts.
 */
export type Sport = 'running' | 'cycling';
/** Training area of a goal or view. Running and strength training stay separate. */
export type Area = 'running' | 'strength';

/** Native, bounded derived splits, never a raw sensor stream. */
export interface SegmentAggregate {
  id?: string;
  distanceMeters: number;
  /** Time span of the segment without pauses; GPS gaps are included (see gapSeconds). */
  durationSeconds: number;
  /** Seconds in RUN or WALK phases within the segment (from distance model 3.0). */
  movingSeconds?: number;
  startElapsedSeconds?: number;
  endElapsedSeconds?: number;
  avgHeartRate?: number;
  avgCadence?: number;
  /** Only from 50 m of distance and from smoothed elevation (RunElevation). */
  gradePercent?: number;
  /** Sum of the climbs and descents in the segment (with hysteresis), in m. */
  ascentMeters?: number;
  descentMeters?: number;
  /** Seconds without valid GPS steps in the segment; from 5 s not suitable for pacing. */
  gapSeconds?: number;
  phase?: 'warmup' | 'work' | 'recovery' | 'cooldown' | 'pause';
  sourceVersion?: string;
}
export type MovementState = 'RUN' | 'WALK' | 'STOPPED' | 'PAUSED' | 'UNKNOWN';
/**
 * Time budget of a recording (RunPhases). Adds up without remainder:
 * elapsed = paused + running + walking + stopped + unknown.
 * `activeSeconds` is the recorded time without pauses, `movingSeconds` the
 * moving time (RUN + WALK). If the object is missing (old data, imports), there
 * is only `durationSeconds` — and that is not moving time.
 */
export interface TimeBudget {
  model_version: string;
  elapsedSeconds: number;
  pausedSeconds: number;
  activeSeconds: number;
  movingSeconds: number;
  runningSeconds: number;
  walkingSeconds: number;
  stoppedSeconds: number;
  unknownSeconds: number;
}
export interface MovementPhase {
  state: MovementState;
  startElapsedSeconds: number;
  endElapsedSeconds: number;
  distanceMeters: number;
  avgHeartRate?: number;
  avgCadence?: number;
}
export interface StateSummary {
  seconds: number;
  meters: number;
  avgHeartRate?: number;
  avgCadence?: number;
}
export interface PhaseMetrics {
  model_version: string;
  longestRunSeconds?: number;
  longestRunMeters?: number;
  longestMovingSeconds?: number;
  runWalkTransitions: number;
  /** STOPPED/UNKNOWN at the end; from 5 min probably not stopped. */
  trailingIdleSeconds: number;
  fastestSustained300sSecondsPerKm?: number;
  running: StateSummary;
  walking: StateSummary;
  stopped: StateSummary;
}
/** Elevation gain from RunElevation; without a reliable source only `available: false` with a reason. */
export type ElevationSummary =
  | {
      model_version: string;
      available: true;
      source: 'barometer' | 'gps';
      reference: 'absolute' | 'start';
      ascentMeters: number;
      descentMeters: number;
      rejectedSamples: number;
      hysteresisMeters: number;
    }
  | { model_version: string; available: false; reason: string };
export interface GpsGap {
  fromElapsedSeconds: number;
  toElapsedSeconds: number;
  reason: 'timeout' | 'accuracy' | 'speed' | 'invalid' | string;
}
/** Where a device is carried while running; the watch is always `wrist`. */
export type GaitPlacement =
  | 'hand'
  | 'upper_arm'
  | 'waist'
  | 'pocket'
  | 'chest'
  | 'wrist'
  | 'unknown';
/** Running form values, each the median of the run's 10-s windows (Kotlin `Gait`). */
export interface GaitValues {
  /** Steps per minute. */
  cadence?: number;
  /** Similarity of one double step to the next, 0–1. */
  regularity?: number;
  /** Angle from fully forward to fully back. */
  armSwingDeg?: number;
  /** Share of the arm rotation around the vertical axis, 0–1. */
  crossShare?: number;
  oscillationCm?: number;
  contactMs?: number;
  /** Peak vertical acceleration per step, in g. */
  impactG?: number;
  /** Forward–backward pace variation per step. */
  brakingMps?: number;
  leanDeg?: number;
}
export interface GaitDevice extends GaitValues {
  source: string;
  placement: GaitPlacement;
  /** Windows run. */
  windows: number;
  /** Of those, windows with a detected step. */
  usable: number;
  /** Windows whose signal could be checked against the carry position, and how many did not fit. */
  checked: number;
  mismatch: number;
  early?: GaitValues;
  late?: GaitValues;
}
/** Running form of a run per device; missing if no window was recorded. */
export interface RunGait {
  model_version: string;
  phone?: GaitDevice;
  watch?: GaitDevice;
}
export interface RunSummary {
  id: string;
  /** Name from the source. Always use runTitle() for display. */
  name?: string;
  startTime: number;
  endTime: number;
  durationSeconds: number;
  distanceMeters: number;
  purpose: RunPurpose;
  sport?: Sport;
  source: string;
  status: string;
  /** Time-weighted. If coverage is missing, the value comes from old data or imports. */
  avgHeartRate?: number;
  /** Share of moving time with heart rate values (0–1). */
  heartRateCoverage?: number;
  avgCadence?: number;
  cadenceCoverage?: number;
  calories?: number;
  steps?: number;
  elevationGainMeters?: number;
  avgHeartRateMax?: number;
  avgHeartRateMin?: number;
  avgCadenceMax?: number;
  avgCadenceMin?: number;
  time?: TimeBudget;
  phases?: MovementPhase[];
  phaseMetrics?: PhaseMetrics;
  elevation?: ElevationSummary;
  gaps?: GpsGap[];
  gapCount?: number;
  /** Version of the native distance model used to derive segments and distance. */
  model_version?: string;
  sensorSources?: { gps?: string; heartRate?: string };
  gait?: RunGait;
  sourceActivityId?: string;
  sourceActivityType?: string;
  importVersion?: string;
  importDetails?: Record<string, unknown> | string;
  segments?: SegmentAggregate[];
  /** Count only. Raw samples stay in native storage. */
  samples?: number;
  sourceVersion?: string;
  canonicalId?: string;
  context?: { temperatureC?: number; windMps?: number; routeId?: string };
  rpe?: { legs?: number; breathing?: number; recordedAt: number };
}
export interface Provenance {
  model_version: string;
  inputSources: { runId: string; source: string; version: string }[];
  segmentIds: string[];
}
export interface QualityIssue {
  sensor: 'time' | 'gps' | 'heartRate' | 'cadence' | 'elevation';
  code: string;
  message: string;
  segmentId?: string;
  suspected: boolean;
}
export interface QualityReport {
  issues: QualityIssue[];
  paceUsable: boolean;
  heartRateUsable: boolean;
  usablePaceSegmentIds: string[];
  usableHeartRateSegmentIds: string[];
}
export interface EffortEstimate extends Provenance {
  kind: 'estimate';
  speedIndex?: number;
  /**
   * Load from session RPE (Foster 2001): RPE × minutes of movement. Legs
   * and breathing stay separate; if a value is missing, its figure is missing too.
   */
  sessionLoad?: { legs?: number; breathing?: number };
  unit: 'index (100 = 3 m/s)';
  uncertainty: string;
  assumptions: string[];
  factors: { tempo: string; slope: string; wind: string; heat: string };
}
export interface PacingAnalysis {
  firstPaceSecondsPerKm: number;
  lastPaceSecondsPerKm: number;
  fadePercent: number;
  coefficientOfVariation: number;
  segmentIds: string[];
}
export interface RunAnalysis extends Provenance {
  classification: string;
  quality: QualityReport;
  effort: EffortEstimate;
  pacing?: PacingAnalysis;
}
