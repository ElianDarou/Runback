import type { RunSummary, SegmentAggregate } from './types';
import {
  allRegionIds,
  regionDefinition,
  regionId,
  REGIONS,
  REGIONS_VERSION,
  type RegionBase,
  type RegionId,
  type Side,
} from './regions';
import {
  CATALOG_VERSION,
  epley1RM,
  type Exercise,
  type LoggedSet,
  type StrengthSession,
} from './strength';
import { catalogExercise } from './catalog';
import { tr } from './i18n';

/**
 * Versioned starting assumptions of the muscle model.
 *
 * All numbers live here in one place. They are settings, not validated
 * values: the impulse response follows the Banister class, the “effective
 * repetitions” (λ = 4) are a hypothesis, and the run and grade coefficients
 * are starting assumptions. The model stays locked until validation
 * (modelValidation.ts) passes.
 *
 * v2: no substitute body weight, no planned values as actual, RIR only from
 * user input or an independent reference, Epley only up to twelve reps.
 * v3: database exercises without a numeric model and unknown load types give no stimulus.
 */
export const MUSCLE_MODEL_CONSTANTS = Object.freeze({
  modelVersion: 'muscle-model-v3',
  effectiveRepLambda: 4,
  relativeLoadGamma: 1,
  fastRiseHours: 0.5,
  fastDecayHours: 10,
  slowRiseHours: 12,
  slowDecayHours: 60,
  betaFast: 0.4,
  betaSlow: 0.6,
  downhillFactor: 12,
  uphillFactor: 8,
  referenceSpeedMps: 3,
  regularizationLambda: 1,
  processNoiseQ: 0.01,
  defaultCapacity: 10,
  uncertaintyThresholdFreshnessPoints: 15,
  modelHorizonDays: 7,
  posteriorCorrelationThreshold: 0.9,
  isometricReferenceSeconds: 12,
  defaultBodyweightFraction: 1,
  pushUpBodyweightFraction: 0.65,
  runCoefficientCalfGastroc: 12,
  runCoefficientCalfSoleus: 12,
  runCoefficientQuad: 8,
  runCoefficientHamstring: 6,
  runCoefficientGlute: 5,
  runCoefficientTibialis: 6,
  runReferenceHardCalfSets: 3,
  calibrationHuberDelta: 2,
  calibrationMeasurementVariance: 1,
  calibrationPriorVariance: 1,
  calibrationBins: 5,
  calibrationMeanGapPoints: 2,
  calibrationMaxIterations: 120,
  calibrationRobustPasses: 8,
  calibrationConvergence: 0.0000001,
  sorenessLogFloor: 0.000001,
  stabilityMaxShiftPoints: 15,
  timePeakToleranceHours: 36,
  timeCheckStepHours: 0.25,
  e1rmLookbackWeeks: 8,
  maxEpleyRepetitions: 12,
} as const);

export const MUSCLE_MODEL_VERSION = MUSCLE_MODEL_CONSTANTS.modelVersion;

/** A single report on a scale from 0 to 10. */
export interface SorenessReport {
  at: number;
  regionId: string;
  value: number;
  note?: string;
  kind?: 'soreness';
}

/** Explicit report that no region is reported today. */
export interface NothingTodayReport {
  kind: 'nothing_today';
  at: number;
  note?: string;
}

export type MuscleReport = SorenessReport | NothingTodayReport;

/** Provenance carried by every derivation of the model. */
export interface MuscleModelProvenance {
  model_version: string;
  regions_version: string;
  catalog_version: string;
  contributing_sessions: string[];
  contributing_reports: MuscleReport[];
}

export interface TimeConstants {
  fastRiseHours: number;
  fastDecayHours: number;
  slowRiseHours: number;
  slowDecayHours: number;
  betaFast: number;
  betaSlow: number;
}

export interface MuscleModelState {
  modelVersion?: string;
  coefficients?: Record<string, number>;
  priors?: Record<string, number>;
  posteriorVariance?: Record<string, number>;
  covariance?: Record<string, Record<string, number>>;
  capacities?: Partial<Record<RegionBase | RegionId, number>>;
  timeConstants?: TimeConstants;
}

export interface SetStimulusOptions {
  e1rmEstimate?: number;
  recentSessions?: StrengthSession[];
  at?: number;
  bodyweightKg?: number;
  bodyweightByExercise?: Record<string, number>;
  bodyweightFractionByExercise?: Record<string, number>;
  unilateralSide?: Side;
  sessionId?: string;
  reports?: MuscleReport[];
}

/**
 * Rough spread from fixed margins. No standard deviation and no prediction
 * interval: until a time-ordered validation produces errors on unseen
 * observations, `calibrated` stays false.
 */
export interface StimulusUncertainty {
  roughSpread: number;
  calibrated: false;
  reasons: string[];
}

export interface SetStimulusResult extends MuscleModelProvenance {
  kind: 'set_stimulus';
  exerciseId: string;
  sessionId?: string;
  setId?: string;
  e1rmEstimate: number | null;
  relativeLoad: number | null;
  rir: number | null;
  /** Source of the reserve; null means unknown and no stimulus. */
  rirSource: 'reported' | 'failure_confirmed' | 'estimated' | null;
  effectiveReps: number | null;
  stimulus: number | null;
  nEff: number | null;
  L: number | null;
  RIR: number | null;
  s: number | null;
  uncertainty: StimulusUncertainty;
  valid: boolean;
  reason?: string;
}

export interface StrengthStimulusContribution extends MuscleModelProvenance {
  kind: 'strength_contribution';
  sessionId: string;
  setId: string;
  exerciseId: string;
  regionId: RegionId;
  baseRegion: RegionBase;
  at: number;
  baseStimulus: number;
  share: number;
  stimulus: number;
  source: 'strength';
  exerciseOrigin: Exercise['origin'];
  catalogReliable: boolean;
  uncertainty: StimulusUncertainty;
}

export interface StrengthStimulusOptions extends SetStimulusOptions {
  exercises?: Exercise[];
  exerciseById?: Record<string, Exercise>;
  unilateralSides?: Record<string, Side>;
}

export interface RunSegmentStimulusOptions {
  at?: number;
  runId?: string;
  sourceVersion?: string;
  coefficients?: Partial<Record<RegionBase, number>>;
}

export interface RunSegmentStimulusResult extends MuscleModelProvenance {
  kind: 'run_segment_stimulus';
  segmentId: string;
  at: number;
  speedMps: number | null;
  durationHours: number | null;
  stimulusByRegion: Partial<Record<RegionId, number>>;
  /** false: grade factors not calculated; the stimulus is a lower bound. */
  gradeKnown: boolean;
  uncertainty: StimulusUncertainty;
  valid: boolean;
  reason?: string;
}

export interface RunStimulusContribution extends MuscleModelProvenance {
  kind: 'run_contribution';
  runId: string;
  segmentId: string;
  regionId: RegionId;
  baseRegion: RegionBase;
  at: number;
  stimulus: number;
  source: 'run';
  catalogReliable: true;
  uncertainty: StimulusUncertainty;
}

export type RegionalStimulusContribution =
  | StrengthStimulusContribution
  | RunStimulusContribution;

export interface FreshnessUncertainty {
  /** Rough spread in freshness points from fixed margins; not an interval. */
  roughSpreadPoints: number;
  roughLowerPoints: number;
  roughUpperPoints: number;
  calibrated: false;
  reasons: string[];
}

export type FreshnessUnknownReason =
  | 'no_reliable_shares'
  | 'uncertainty_too_high'
  | 'outside_horizon_without_report'
  | 'missing_reports'
  | 'invalid_input';

export interface KnownFreshness extends MuscleModelProvenance {
  kind: 'freshness';
  regionId: RegionId;
  at: number;
  value: number;
  residualLoad: number;
  sorenessPrediction: number;
  uncertainty: FreshnessUncertainty;
  isPrediction: boolean;
  assumptions: string[];
  contributing: RegionalStimulusContribution[];
}

export interface UnknownFreshness extends MuscleModelProvenance {
  kind: 'unknown';
  regionId: RegionId;
  at: number;
  value: null;
  residualLoad: number | null;
  sorenessPrediction: null;
  uncertainty: FreshnessUncertainty;
  isPrediction: boolean;
  reasonCode: FreshnessUnknownReason;
  reason: string;
  contributing: RegionalStimulusContribution[];
}

export type RegionFreshness = KnownFreshness | UnknownFreshness;

export interface FreshnessInput {
  at: number;
  sessions: StrengthSession[];
  reports: MuscleReport[];
  runs?: RunSummary[];
  exercises?: Exercise[];
  exerciseById?: Record<string, Exercise>;
  unilateralSides?: Record<string, Side>;
  bodyweightKg?: number;
  bodyweightByExercise?: Record<string, number>;
  bodyweightFractionByExercise?: Record<string, number>;
  state?: MuscleModelState;
  capacities?: Partial<Record<RegionBase | RegionId, number>>;
}

export interface FreshnessSnapshot extends MuscleModelProvenance {
  kind: 'freshness_snapshot' | 'freshness_prediction';
  at: number;
  isPrediction: boolean;
  regions: Record<RegionId, RegionFreshness>;
}

const finite = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

const nonNegativeFinite = (value: unknown): value is number =>
  finite(value) && value >= 0;

export function isNothingTodayReport(
  report: MuscleReport,
): report is NothingTodayReport {
  return report.kind === 'nothing_today';
}

/** Checks a report without silently changing invalid values. */
export function isValidMuscleReport(report: MuscleReport): boolean {
  if (!finite(report.at) || report.at < 0) {
    return false;
  }
  if (isNothingTodayReport(report)) {
    return true;
  }
  return (
    typeof report.regionId === 'string' &&
    report.regionId.length > 0 &&
    allRegionIds().includes(report.regionId as RegionId) &&
    finite(report.value) &&
    report.value >= 0 &&
    report.value <= 10
  );
}

/** Creates an explicit, deterministic “nothing today” report. */
export function nothingTodayReport(at: number, note?: string): NothingTodayReport {
  return note === undefined
    ? { kind: 'nothing_today', at }
    : { kind: 'nothing_today', at, note };
}

const provenance = (
  sessions: string[] = [],
  reports: MuscleReport[] = [],
): MuscleModelProvenance => ({
  model_version: MUSCLE_MODEL_VERSION,
  regions_version: REGIONS_VERSION,
  catalog_version: CATALOG_VERSION,
  contributing_sessions: Array.from(new Set(sessions)).sort(),
  contributing_reports: reports.filter(isValidMuscleReport).map(report => ({
    ...report,
  })),
});

const segmentIdentifier = (segment: SegmentAggregate, index: number): string =>
  segment.id ?? `split-${index + 1}`;

const baseRegionFromId = (id: string): RegionBase | null => {
  const match = /^(.*?)(?:_(?:l|r))?$/.exec(id);
  const base = match?.[1];
  if (!base || !REGIONS.some(region => region.base === base)) {
    return null;
  }
  return base as RegionBase;
};

const isSided = (base: RegionBase): boolean => regionDefinition(base).sided;

const capacityFor = (
  id: RegionId,
  capacities: Partial<Record<RegionBase | RegionId, number>> | undefined,
): number => {
  const base = baseRegionFromId(id);
  const selected = capacities?.[id] ?? (base ? capacities?.[base] : undefined);
  return nonNegativeFinite(selected) && selected > 0
    ? selected
    : MUSCLE_MODEL_CONSTANTS.defaultCapacity;
};

const defaultTimeConstants = (): TimeConstants => ({
  fastRiseHours: MUSCLE_MODEL_CONSTANTS.fastRiseHours,
  fastDecayHours: MUSCLE_MODEL_CONSTANTS.fastDecayHours,
  slowRiseHours: MUSCLE_MODEL_CONSTANTS.slowRiseHours,
  slowDecayHours: MUSCLE_MODEL_CONSTANTS.slowDecayHours,
  betaFast: MUSCLE_MODEL_CONSTANTS.betaFast,
  betaSlow: MUSCLE_MODEL_CONSTANTS.betaSlow,
});

const bodyweightFraction = (
  exercise: Exercise,
  options: SetStimulusOptions,
): number => {
  const selected = options.bodyweightFractionByExercise?.[exercise.id];
  if (finite(selected) && selected > 0) {
    return selected;
  }
  if (exercise.id === 'push_up') {
    return MUSCLE_MODEL_CONSTANTS.pushUpBodyweightFraction;
  }
  return MUSCLE_MODEL_CONSTANTS.defaultBodyweightFraction;
};

interface SetLoad {
  weightKg: number | null;
  uncertain: boolean;
  reasons: string[];
}

/** Only actually recorded values; planned values stay planning. */
const setLoad = (set: LoggedSet, exercise: Exercise, options: SetStimulusOptions): SetLoad => {
  const raw = set.actualWeightKg;
  const loadKind = set.planned.loadKind;
  const reasons: string[] = [];
  const uncertain = false;
  if (loadKind === 'unknown') {
    return {
      weightKg: null,
      uncertain: true,
      reasons: [tr('Die Lastart ist unbekannt.', 'The load type is unknown.')],
    };
  }
  if (loadKind === 'kg') {
    return {
      weightKg: finite(raw) && raw > 0 ? raw : null,
      uncertain: false,
      reasons,
    };
  }
  const providedBodyweight =
    options.bodyweightByExercise?.[exercise.id] ?? options.bodyweightKg;
  if (!(finite(providedBodyweight) && providedBodyweight > 0)) {
    return {
      weightKg: null,
      uncertain,
      reasons: [
        tr(
          'Körpergewicht fehlt; ohne Angabe bleibt die bewegte Last unbekannt.',
          'Body weight is missing; without it the moved load stays unknown.',
        ),
      ],
    };
  }
  const movedBodyweight =
    providedBodyweight * bodyweightFraction(exercise, options);
  if (loadKind === 'bodyweight') {
    return { weightKg: movedBodyweight, uncertain, reasons };
  }
  if (loadKind === 'assisted') {
    if (!finite(raw) || raw < 0 || raw >= movedBodyweight) {
      return {
        weightKg: null,
        uncertain,
        reasons: [
          ...reasons,
          tr(
            'Unterstützung oder Körpergewicht ist ungültig.',
            'Assistance or body weight is invalid.',
          ),
        ],
      };
    }
    return { weightKg: movedBodyweight - raw, uncertain, reasons };
  }
  if (!finite(raw) || raw < 0) {
    return { weightKg: null, uncertain, reasons };
  }
  return { weightKg: movedBodyweight + raw, uncertain, reasons };
};

/** Estimated one-rep max using the project's Epley function. */
export function estimateE1RM(weightKg: number, repetitions: number): number | null {
  return epley1RM(weightKg, repetitions);
}

/**
 * Best observed Epley value of earlier sessions within the last eight weeks.
 * The session itself does not count: a set must not be its own reference,
 * otherwise the reserve would always compute to 0.
 */
export function bestExerciseE1RM(
  exerciseId: string,
  sessions: StrengthSession[],
  at: number,
  excludeSessionId?: string,
): number | null {
  const eightWeeksMs =
    MUSCLE_MODEL_CONSTANTS.e1rmLookbackWeeks * 7 * 24 * 60 * 60 * 1000;
  let best: number | null = null;
  for (const session of sessions) {
    if (excludeSessionId !== undefined && session.id === excludeSessionId) {
      continue;
    }
    for (const exercise of session.exercises) {
      if (exercise.exerciseId !== exerciseId) {
        continue;
      }
      for (const set of exercise.sets) {
        if (
          set.skipped ||
          set.completedAt === undefined ||
          set.completedAt < at - eightWeeksMs ||
          set.completedAt >= at
        ) {
          continue;
        }
        const weight = set.actualWeightKg;
        const repetitions = set.actualReps;
        if (!finite(weight) || !finite(repetitions)) {
          continue;
        }
        const estimate = finite(set.actualRir)
          ? epley1RM(weight, repetitions + Math.max(0, set.actualRir))
          : epley1RM(weight, repetitions);
        if (estimate !== null && (best === null || estimate > best)) {
          best = estimate;
        }
      }
    }
  }
  return best;
}

/** Sum of the effective repetitions using the documented exponential form. */
export function effectiveRepetitions(repetitions: number, rir: number): number {
  if (!(repetitions > 0) || !(rir >= 0)) {
    return 0;
  }
  let result = 0;
  for (let index = 1; index <= Math.floor(repetitions); index += 1) {
    result += Math.exp(
      -(rir + Math.floor(repetitions) - index) /
        MUSCLE_MODEL_CONSTANTS.effectiveRepLambda,
    );
  }
  return result;
}

/** Effective repetitions for a timed or isometric set. */
export function effectiveRepetitionsFromSeconds(seconds: number): number {
  return finite(seconds) && seconds > 0
    ? seconds / MUSCLE_MODEL_CONSTANTS.isometricReferenceSeconds
    : 0;
}

/** Calculates the base stimulus of a single logged set. */
export function calculateSetStimulus(
  set: LoggedSet,
  exercise: Exercise,
  options: SetStimulusOptions = {},
): SetStimulusResult {
  const load = setLoad(set, exercise, options);
  const at = options.at ?? set.completedAt ?? 0;
  const provenanceValue = provenance(
    options.sessionId ? [options.sessionId] : [],
    options.reports ?? [],
  );
  const uncertaintyReasons = [...load.reasons];
  const timedSeconds = set.actualSeconds;
  const repetitions = set.actualReps;
  const isTimed = set.planned.kind === 'timed' || finite(timedSeconds);
  if (set.completedAt === undefined) {
    uncertaintyReasons.push(
      tr(
        'Satz nicht abgeschlossen; Planwerte zählen nicht als Reiz.',
        'Set not completed; planned values do not count as stimulus.',
      ),
    );
  }
  // Independent reference: passed explicitly or taken from earlier sessions.
  const reference =
    options.e1rmEstimate ??
    (options.recentSessions
      ? bestExerciseE1RM(
          exercise.id,
          options.recentSessions,
          at,
          options.sessionId,
        )
      : null);
  // Reserve: user input > set confirmed to failure > estimate from an
  // independent reference. Without one of these it stays unknown.
  let rir: number | null = null;
  let rirSource: 'reported' | 'failure_confirmed' | 'estimated' | null = null;
  if (!isTimed && finite(repetitions)) {
    if (finite(set.actualRir) && set.actualRir >= 0) {
      rir = set.actualRir;
      rirSource = 'reported';
    } else if (set.planned.kind === 'failure' && set.completedAt !== undefined) {
      rir = 0;
      rirSource = 'failure_confirmed';
    } else if (
      reference !== null &&
      finite(load.weightKg) &&
      load.weightKg > 0 &&
      reference > 0
    ) {
      const relative = Math.min(1, Math.max(0, load.weightKg / reference));
      rir = Math.max(0, 30 * (1 / relative - 1) - repetitions);
      rirSource = 'estimated';
      uncertaintyReasons.push(
        tr(
          'Anstrengung (RIR) aus dem e1RM einer früheren Einheit geschätzt.',
          'Reps in reserve (RIR) estimated from the e1RM of an earlier session.',
        ),
      );
    } else {
      uncertaintyReasons.push(
        tr(
          'Anstrengung (RIR) nicht angegeben und keine frühere Einheit als Referenz; der Reiz bleibt unbekannt.',
          'Reps in reserve (RIR) not given and no earlier session as reference; the stimulus stays unknown.',
        ),
      );
    }
  }
  // e1RM: with a known reserve from this set (inverse Epley with reps + RIR),
  // otherwise only from the independent reference. Never from the set alone.
  const e1rm =
    !isTimed && finite(load.weightKg) && finite(repetitions) && rir !== null
      ? epley1RM(load.weightKg, repetitions + rir) ?? reference
      : reference;
  if (
    !isTimed &&
    finite(load.weightKg) &&
    finite(repetitions) &&
    rir !== null &&
    epley1RM(load.weightKg, repetitions + rir) === null
  ) {
    uncertaintyReasons.push(
      tr(
        `Mehr als ${MUSCLE_MODEL_CONSTANTS.maxEpleyRepetitions} Wiederholungen bis zum Versagen; Epley trägt hier keine Schätzung.`,
        `More than ${MUSCLE_MODEL_CONSTANTS.maxEpleyRepetitions} reps to failure; Epley gives no estimate here.`,
      ),
    );
  }
  const relativeLoad =
    finite(load.weightKg) && finite(e1rm) && e1rm > 0
      ? Math.min(1, Math.max(0, load.weightKg / e1rm))
      : isTimed && finite(load.weightKg)
        ? 1
        : null;
  const nEff = isTimed
    ? effectiveRepetitionsFromSeconds(timedSeconds ?? 0)
    : finite(repetitions) && rir !== null
      ? effectiveRepetitions(repetitions, rir)
      : 0;
  if (isTimed && !(nEff > 0)) {
    uncertaintyReasons.push(
      tr(
        'Spannungsdauer fehlt oder ist ungültig.',
        'Time under tension is missing or invalid.',
      ),
    );
  }
  if (!isTimed && !(nEff > 0)) {
    uncertaintyReasons.push(
      tr(
        'Last oder Wiederholungen fehlen oder sind ungültig.',
        'Load or reps are missing or invalid.',
      ),
    );
  }
  if (exercise.origin !== 'catalog') {
    uncertaintyReasons.push(
      tr(
        'Eigene Übung: Anteile sind keine Katalogannahme.',
        'Custom exercise: shares are not a catalog assumption.',
      ),
    );
  }
  if (!finite(exercise.eccentric) || !finiteShareSet(exercise)) {
    uncertaintyReasons.push(
      tr(
        'Muskelanteile oder Belastungsfaktor dieser Übung sind unbekannt.',
        'Muscle shares or load factor of this exercise are unknown.',
      ),
    );
  }
  const stimulus =
    nEff > 0 && relativeLoad !== null && set.completedAt !== undefined &&
      finite(exercise.eccentric) && finiteShareSet(exercise)
      ? nEff * relativeLoad ** MUSCLE_MODEL_CONSTANTS.relativeLoadGamma * exercise.eccentric
      : null;
  // Fixed margins, no estimated spread.
  const roughSpread =
    (load.uncertain ? 8 : 3) +
    (exercise.origin === 'catalog' ? 0 : 5) +
    (rirSource === 'estimated' ? 2 : 0);
  const valid = stimulus !== null && finite(stimulus) && stimulus >= 0;
  return {
    ...provenanceValue,
    kind: 'set_stimulus',
    exerciseId: exercise.id,
    sessionId: options.sessionId,
    setId: set.id,
    e1rmEstimate: e1rm,
    relativeLoad,
    rir,
    rirSource,
    effectiveReps: nEff,
    stimulus,
    nEff,
    L: relativeLoad,
    RIR: rir,
    s: stimulus,
    uncertainty: {
      roughSpread,
      calibrated: false,
      reasons: Array.from(new Set(uncertaintyReasons)),
    },
    valid,
    reason: valid
      ? undefined
      : tr(
          'Satz kann nicht als Reiz berechnet werden.',
          'Set cannot be calculated as a stimulus.',
        ),
  };
}

/** Distributes a stimulus across concrete regions and sides. */
export function distributeStimulus(
  exercise: Exercise,
  stimulus: number,
  unilateralSide?: Side,
): Partial<Record<RegionId, number>> {
  const result: Partial<Record<RegionId, number>> = {};
  if (!finite(stimulus) || stimulus < 0) {
    return result;
  }
  for (const [baseValue, share] of Object.entries(exercise.shares)) {
    const base = baseValue as RegionBase;
    if (!finite(share) || share <= 0) {
      continue;
    }
    if (!isSided(base)) {
      result[regionId(base)] = stimulus * share;
      continue;
    }
    if (exercise.unilateral) {
      if (unilateralSide) {
        result[regionId(base, unilateralSide)] = stimulus * share;
      }
      continue;
    }
    result[regionId(base, 'l')] = stimulus * share / 2;
    result[regionId(base, 'r')] = stimulus * share / 2;
  }
  return result;
}

const resolveExercise = (
  exerciseId: string,
  options: StrengthStimulusOptions,
): Exercise | undefined => {
  const fromMap = options.exerciseById?.[exerciseId];
  if (fromMap) {
    return fromMap;
  }
  const fromList = options.exercises?.find(exercise => exercise.id === exerciseId);
  return fromList ?? catalogExercise(exerciseId);
};

const unilateralSideFor = (
  set: LoggedSet,
  exerciseId: string,
  options: StrengthStimulusOptions,
): Side | undefined => {
  const withSide = set as LoggedSet & { side?: Side };
  return (
    withSide.side ??
    options.unilateralSides?.[set.id] ??
    options.unilateralSides?.[exerciseId] ??
    options.unilateralSide
  );
};

/** Builds all regional contributions of a strength session from its logged sets. */
export function buildStrengthStimulusContributions(
  session: StrengthSession,
  options: StrengthStimulusOptions = {},
): StrengthStimulusContribution[] {
  const result: StrengthStimulusContribution[] = [];
  for (const sessionExercise of session.exercises) {
    const exercise = resolveExercise(sessionExercise.exerciseId, options);
    if (!exercise) {
      continue;
    }
    for (const set of sessionExercise.sets) {
      if (set.skipped || set.completedAt === undefined) {
        continue;
      }
      const calculated = calculateSetStimulus(set, exercise, {
        ...options,
        recentSessions: options.recentSessions ?? [session],
        at: set.completedAt,
        sessionId: session.id,
        unilateralSide: unilateralSideFor(set, exercise.id, options),
      });
      if (!calculated.valid || calculated.stimulus === null) {
        continue;
      }
      const distributed = distributeStimulus(
        exercise,
        calculated.stimulus,
        unilateralSideFor(set, exercise.id, options),
      );
      for (const [id, stimulus] of Object.entries(distributed)) {
        const region = baseRegionFromId(id);
        if (!region || !finite(stimulus) || stimulus <= 0) {
          continue;
        }
        const share =
          calculated.stimulus > 0 ? stimulus / calculated.stimulus : 0;
        result.push({
          ...provenance([session.id], options.reports ?? []),
          kind: 'strength_contribution',
          sessionId: session.id,
          setId: set.id,
          exerciseId: exercise.id,
          regionId: id,
          baseRegion: region,
          at: set.completedAt,
          baseStimulus: calculated.stimulus,
          share,
          stimulus,
          source: 'strength',
          exerciseOrigin: exercise.origin,
          catalogReliable: finiteShareSet(exercise),
          uncertainty: calculated.uncertainty,
        });
      }
    }
  }
  return result;
}

function finiteShareSet(exercise: Exercise): boolean {
  const entries = Object.entries(exercise.shares);
  return (
    entries.length > 0 &&
    entries.every(([base, share]) =>
      REGIONS.some(region => region.base === base) && finite(share) && share > 0,
    ) &&
    Math.abs(entries.reduce((sum, [, share]) => sum + (share ?? 0), 0) - 1) < 0.005
  );
}

const runCoefficients = (): Record<RegionBase, number> => ({
  neck: 0,
  trap_upper: 0,
  trap_mid: 0,
  rhomboid: 0,
  lat: 0,
  lower_back: 0,
  shoulder_front: 0,
  shoulder_side: 0,
  shoulder_rear: 0,
  chest_upper: 0,
  chest_mid: 0,
  biceps: 0,
  triceps: 0,
  forearm: 0,
  abs_upper: 0,
  abs_lower: 0,
  oblique: 0,
  hip_flexor: 0,
  adductor: 0,
  quad: MUSCLE_MODEL_CONSTANTS.runCoefficientQuad,
  hamstring: MUSCLE_MODEL_CONSTANTS.runCoefficientHamstring,
  glute: MUSCLE_MODEL_CONSTANTS.runCoefficientGlute,
  calf_gastroc: MUSCLE_MODEL_CONSTANTS.runCoefficientCalfGastroc,
  calf_soleus: MUSCLE_MODEL_CONSTANTS.runCoefficientCalfSoleus,
  tibialis: MUSCLE_MODEL_CONSTANTS.runCoefficientTibialis,
});

/** Calculates the direct stimulus of a run segment per §4. */
export function runSegmentStimulus(
  segment: SegmentAggregate,
  options: RunSegmentStimulusOptions = {},
): RunSegmentStimulusResult {
  const segmentId = segmentIdentifier(segment, 0);
  const at = options.at ?? 0;
  const provenanceValue = provenance(options.runId ? [options.runId] : []);
  const durationSeconds = segment.durationSeconds;
  const distanceMeters = segment.distanceMeters;
  const validTime = finite(durationSeconds) && durationSeconds > 0;
  const validDistance = finite(distanceMeters) && distanceMeters > 0;
  const speedMps = validTime && validDistance ? distanceMeters / durationSeconds : null;
  const coefficient = { ...runCoefficients(), ...options.coefficients };
  const uncertaintyReasons: string[] = [];
  if (segment.phase === 'pause') {
    uncertaintyReasons.push(
      tr('Pausenabschnitt erzeugt keinen Reiz.', 'Pause segment produces no stimulus.'),
    );
  }
  const gradeKnown = finite(segment.gradePercent);
  if (!gradeKnown) {
    uncertaintyReasons.push(
      tr(
        'Steigung fehlt; der Steigungsanteil wird nicht berechnet, Zeit und Distanz bleiben nutzbar.',
        'Grade is missing; the grade share is not calculated, time and distance stay usable.',
      ),
    );
  }
  if (speedMps === null || segment.phase === 'pause') {
    return {
      ...provenanceValue,
      kind: 'run_segment_stimulus',
      segmentId,
      at,
      speedMps,
      durationHours: validTime ? durationSeconds / 3600 : null,
      stimulusByRegion: {},
      gradeKnown,
      uncertainty: {
        roughSpread: speedMps === null ? 15 : 5,
        calibrated: false,
        reasons: [
          ...uncertaintyReasons,
          tr(
            'Dauer oder Distanz des Abschnitts ist ungültig.',
            'Duration or distance of the segment is invalid.',
          ),
        ],
      },
      valid: false,
      reason: tr(
        'Laufabschnitt kann nicht als Reiz berechnet werden.',
        'Run segment cannot be calculated as a stimulus.',
      ),
    };
  }
  const durationHours = durationSeconds / 3600;
  const speedRatio = speedMps / MUSCLE_MODEL_CONSTANTS.referenceSpeedMps;
  // Without grade the grade factors drop out; the stimulus is then a lower
  // bound, not a “flat” assumption.
  const grade = gradeKnown ? (segment.gradePercent as number) / 100 : 0;
  const downhill = Math.max(0, -grade);
  const uphill = Math.max(0, grade);
  const baseStimulus: Partial<Record<RegionBase, number>> = {
    calf_gastroc: coefficient.calf_gastroc * durationHours * speedRatio ** 1.5,
    calf_soleus: coefficient.calf_soleus * durationHours * speedRatio ** 1.2,
    quad:
      coefficient.quad * durationHours * speedRatio ** 1.2 *
      (1 + MUSCLE_MODEL_CONSTANTS.downhillFactor * downhill),
    hamstring:
      coefficient.hamstring * durationHours * speedRatio ** 1.5 *
      (1 + MUSCLE_MODEL_CONSTANTS.uphillFactor * uphill),
    glute:
      coefficient.glute * durationHours * speedRatio ** 1.2 *
      (1 + MUSCLE_MODEL_CONSTANTS.uphillFactor * uphill),
    tibialis:
      coefficient.tibialis * durationHours * speedRatio ** 1.2 *
      (1 + MUSCLE_MODEL_CONSTANTS.downhillFactor * downhill),
  };
  const stimulusByRegion: Partial<Record<RegionId, number>> = {};
  for (const [baseValue, value] of Object.entries(baseStimulus)) {
    const base = baseValue as RegionBase;
    if (!finite(value) || value <= 0) {
      continue;
    }
    if (isSided(base)) {
      stimulusByRegion[regionId(base, 'l')] = value / 2;
      stimulusByRegion[regionId(base, 'r')] = value / 2;
    } else {
      stimulusByRegion[regionId(base)] = value;
    }
  }
  return {
    ...provenanceValue,
    kind: 'run_segment_stimulus',
    segmentId,
    at,
    speedMps,
    durationHours,
    stimulusByRegion,
    gradeKnown,
    uncertainty: {
      roughSpread: uncertaintyReasons.length ? 8 : 4,
      calibrated: false,
      reasons: uncertaintyReasons,
    },
    valid: true,
  };
}

/** Builds the run contributions of a run. */
export function buildRunStimulusContributions(
  run: RunSummary,
  coefficients?: Partial<Record<RegionBase, number>>,
): RunStimulusContribution[] {
  const result: RunStimulusContribution[] = [];
  let elapsedSeconds = 0;
  for (const [index, segment] of (run.segments ?? []).entries()) {
    // Native summaries may omit segment IDs. Give each segment a stable
    // position-based fallback before calculating provenance; otherwise every
    // anonymous segment would be reported as `split-1`.
    const segmentWithId = segment.id
      ? segment
      : { ...segment, id: `split-${index + 1}` };
    const calculated = runSegmentStimulus(segmentWithId, {
      at: run.startTime + elapsedSeconds * 1000,
      runId: run.id,
      sourceVersion: segment.sourceVersion ?? run.sourceVersion,
      coefficients,
    });
    if (finite(segment.durationSeconds) && segment.durationSeconds > 0) {
      elapsedSeconds += segment.durationSeconds;
    }
    for (const [id, stimulus] of Object.entries(calculated.stimulusByRegion)) {
      const baseRegion = baseRegionFromId(id);
      if (!baseRegion || !finite(stimulus) || stimulus <= 0) {
        continue;
      }
      result.push({
        ...provenance([run.id]),
        kind: 'run_contribution',
        runId: run.id,
        segmentId: calculated.segmentId,
        regionId: id,
        baseRegion,
        at: calculated.at,
        stimulus,
        source: 'run',
        catalogReliable: true,
        uncertainty: calculated.uncertainty,
      });
    }
  }
  return result;
}

const normalisedImpulse = (hours: number, rise: number, decay: number): number => {
  if (!(hours >= 0) || !(rise > 0) || !(decay > rise)) {
    return 0;
  }
  const maximumAt = Math.log(decay / rise) / (1 / rise - 1 / decay);
  const peak = Math.exp(-maximumAt / decay) - Math.exp(-maximumAt / rise);
  return peak > 0
    ? (Math.exp(-hours / decay) - Math.exp(-hours / rise)) / peak
    : 0;
};

/** Normalized difference of two exponential functions per §5.1. */
export function impulseResponse(
  hours: number,
  riseHours: number,
  decayHours: number,
): number {
  return normalisedImpulse(hours, riseHours, decayHours);
}

/** Combined fast and slow impulse response. */
export function combinedImpulseResponse(
  hours: number,
  timeConstants: TimeConstants = defaultTimeConstants(),
): number {
  if (!(hours >= 0)) {
    return 0;
  }
  return (
    timeConstants.betaFast *
      normalisedImpulse(hours, timeConstants.fastRiseHours, timeConstants.fastDecayHours) +
    timeConstants.betaSlow *
      normalisedImpulse(hours, timeConstants.slowRiseHours, timeConstants.slowDecayHours)
  );
}

/** Hours between two instants, since all model times are passed as milliseconds. */
export function hoursSince(at: number, origin: number): number {
  return (at - origin) / (60 * 60 * 1000);
}

const coefficientKey = (exerciseId: string, baseRegion: RegionBase): string =>
  `${exerciseId}|${baseRegion}`;

const coefficientFromState = (
  contribution: StrengthStimulusContribution,
  state: MuscleModelState | undefined,
  exercises: Exercise[],
): { value: number; variance: number; source: 'personal' | 'similarity' | 'catalog' } => {
  const key = coefficientKey(contribution.exerciseId, contribution.baseRegion);
  const direct = state?.coefficients?.[key];
  if (nonNegativeFinite(direct)) {
    return {
      value: direct,
      variance: state?.posteriorVariance?.[key] ?? MUSCLE_MODEL_CONSTANTS.calibrationPriorVariance,
      source: 'personal',
    };
  }
  const target = exercises.find(exercise => exercise.id === contribution.exerciseId);
  if (target) {
    const pooled = partialPoolCoefficient(target, contribution.baseRegion, state, exercises);
    if (pooled.source === 'similarity') {
      return pooled;
    }
  }
  return {
    value: 1,
    variance: MUSCLE_MODEL_CONSTANTS.calibrationPriorVariance,
    source: 'catalog',
  };
};

/** Cosine similarity of the catalog shares of two exercises. */
export function cosineShareSimilarity(left: Exercise, right: Exercise): number {
  const bases = Array.from(
    new Set([...Object.keys(left.shares), ...Object.keys(right.shares)]),
  );
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (const base of bases) {
    const leftValue = left.shares[base as RegionBase] ?? 0;
    const rightValue = right.shares[base as RegionBase] ?? 0;
    dot += leftValue * rightValue;
    leftNorm += leftValue * leftValue;
    rightNorm += rightValue * rightValue;
  }
  return leftNorm > 0 && rightNorm > 0
    ? dot / Math.sqrt(leftNorm * rightNorm)
    : 0;
}

export interface PartialPoolResult {
  value: number;
  variance: number;
  source: 'similarity' | 'catalog';
  similarity: number;
}

/** Transfers learned values to a new exercise by cosine similarity. */
export function partialPoolCoefficient(
  target: Exercise,
  baseRegion: RegionBase,
  state: MuscleModelState | undefined,
  exercises: Exercise[],
): PartialPoolResult {
  const values: { value: number; variance: number; similarity: number }[] = [];
  for (const candidate of exercises) {
    if (candidate.id === target.id) {
      continue;
    }
    const similarity = cosineShareSimilarity(target, candidate);
    const key = coefficientKey(candidate.id, baseRegion);
    const value = state?.coefficients?.[key];
    if (similarity > 0 && nonNegativeFinite(value)) {
      values.push({
        value,
        variance: state?.posteriorVariance?.[key] ?? MUSCLE_MODEL_CONSTANTS.calibrationPriorVariance,
        similarity,
      });
    }
  }
  if (!values.length) {
    return {
      value: 1,
      variance: MUSCLE_MODEL_CONSTANTS.calibrationPriorVariance,
      source: 'catalog',
      similarity: 0,
    };
  }
  const totalWeight = values.reduce((sum, item) => sum + item.similarity, 0);
  return {
    value: values.reduce((sum, item) => sum + item.value * item.similarity, 0) / totalWeight,
    variance:
      values.reduce((sum, item) => sum + item.variance * item.similarity, 0) / totalWeight,
    source: 'similarity',
    similarity: Math.max(...values.map(item => item.similarity)),
  };
}

const allExercises = (input: FreshnessInput): Exercise[] => {
  const provided = [
    ...(input.exercises ?? []),
    ...Object.values(input.exerciseById ?? {}),
  ];
  const byId = new Map<string, Exercise>();
  for (const exercise of provided) {
    byId.set(exercise.id, exercise);
  }
  for (const session of input.sessions) {
    for (const sessionExercise of session.exercises) {
      const exercise = input.exerciseById?.[sessionExercise.exerciseId] ??
        input.exercises?.find(candidate => candidate.id === sessionExercise.exerciseId) ??
        catalogExercise(sessionExercise.exerciseId);
      if (exercise) {
        byId.set(exercise.id, exercise);
      }
    }
  }
  return Array.from(byId.values());
};

/** All contributions from strength and run data in one shared timeline. */
export function buildRegionalStimulusContributions(
  input: FreshnessInput,
): RegionalStimulusContribution[] {
  const strengthOptions: StrengthStimulusOptions = {
    exercises: input.exercises,
    exerciseById: input.exerciseById,
    unilateralSides: input.unilateralSides,
    bodyweightKg: input.bodyweightKg,
    bodyweightByExercise: input.bodyweightByExercise,
    bodyweightFractionByExercise: input.bodyweightFractionByExercise,
    reports: input.reports,
  };
  const strength = input.sessions.flatMap(session =>
    buildStrengthStimulusContributions(session, strengthOptions),
  );
  const runs = (input.runs ?? []).flatMap(run => buildRunStimulusContributions(run));
  return [...strength, ...runs].sort((left, right) =>
    left.at - right.at || left.regionId.localeCompare(right.regionId),
  );
}

const reportsForRegion = (reports: MuscleReport[], id: RegionId): MuscleReport[] =>
  reports.filter(report =>
    isValidMuscleReport(report) &&
    (isNothingTodayReport(report) || report.regionId === id),
  );

const modelStateCoefficient = (
  contribution: StrengthStimulusContribution,
  state: MuscleModelState | undefined,
  exercises: Exercise[],
): { value: number; variance: number; source: 'personal' | 'similarity' | 'catalog' } =>
  coefficientFromState(contribution, state, exercises);

const regionProvenance = (
  contributions: RegionalStimulusContribution[],
  reports: MuscleReport[],
): MuscleModelProvenance =>
  provenance(
    contributions.flatMap(contribution =>
      contribution.source === 'strength'
        ? [contribution.sessionId]
        : [contribution.runId],
    ),
    reports,
  );

const regionContributions = (
  contributions: RegionalStimulusContribution[],
  id: RegionId,
): RegionalStimulusContribution[] =>
  contributions.filter(contribution => contribution.regionId === id);

const regionFreshness = (
  id: RegionId,
  input: FreshnessInput,
  contributions: RegionalStimulusContribution[],
  isPrediction: boolean,
  allowUnknown: boolean,
): RegionFreshness => {
  const relevant = regionContributions(contributions, id);
  const reports = reportsForRegion(input.reports, id);
  const state = input.state;
  const timeConstants = state?.timeConstants ?? defaultTimeConstants();
  const exercises = allExercises(input);
  const loadByContribution = relevant.map(contribution => {
    const coefficient = contribution.source === 'strength'
      ? modelStateCoefficient(contribution, state, exercises)
      : { value: 1, variance: 0, source: 'catalog' as const };
    const impulse = combinedImpulseResponse(
      hoursSince(input.at, contribution.at),
      timeConstants,
    );
    return { contribution, coefficient, impulse };
  });
  const residualLoad = loadByContribution.reduce(
    (sum, item) =>
      sum + item.contribution.stimulus * item.coefficient.value * item.impulse,
    0,
  );
  const capacity = capacityFor(id, input.capacities ?? state?.capacities);
  const freshness = 100 * Math.exp(-residualLoad / capacity);
  let variance = 0;
  const uncertaintyReasons: string[] = [];
  for (const item of loadByContribution) {
    const scale =
      (item.contribution.stimulus * item.impulse) / capacity;
    variance += scale * scale * item.coefficient.variance;
    uncertaintyReasons.push(...item.contribution.uncertainty.reasons);
    if (!item.contribution.catalogReliable) {
      uncertaintyReasons.push(
      tr(
        'Mindestens ein Anteil stammt nicht aus einem belastbaren Katalog.',
        'At least one share does not come from a reliable catalog.',
      ),
    );
    }
  }
  if (!relevant.length) {
    uncertaintyReasons.push(
      tr(
        'Für diese Region liegt kein relevanter Beitrag vor.',
        'This region has no relevant contribution.',
      ),
    );
  }
  if (!reports.length) {
    uncertaintyReasons.push(tr('Keine bestätigende Meldung vorhanden.', 'No confirming report.'));
  }
  // Fixed margins plus coefficient variance without covariance: a rough
  // spread, not a prediction interval.
  const roughSpread = Math.min(
    100,
    Math.sqrt(variance) * 100 + (reports.length ? 0 : 2) +
      (loadByContribution.some(item => item.coefficient.source !== 'personal') ? 8 : 0),
  );
  const lastRelevantAt = relevant.reduce(
    (latest, contribution) => Math.max(latest, contribution.at),
    -Infinity,
  );
  const recentEnough =
    lastRelevantAt !== -Infinity &&
    input.at - lastRelevantAt <=
      MUSCLE_MODEL_CONSTANTS.modelHorizonDays * 24 * 60 * 60 * 1000;
  const hasConfirmation = reports.length > 0;
  const reliableShares = relevant.every(contribution => contribution.catalogReliable);
  let reasonCode: FreshnessUnknownReason | undefined;
  let reason: string | undefined;
  if (!relevant.length) {
    reasonCode = 'no_reliable_shares';
    reason = tr(
      'Für diese Region fehlen belastbare Trainingsanteile.',
      'This region lacks reliable training shares.',
    );
  } else if (!reliableShares) {
    reasonCode = 'no_reliable_shares';
    reason = tr(
      'Die Anteile dieser Region sind noch nicht belastbar hinterlegt.',
      'The shares of this region are not yet reliably recorded.',
    );
  } else if (roughSpread > MUSCLE_MODEL_CONSTANTS.uncertaintyThresholdFreshnessPoints) {
    reasonCode = 'uncertainty_too_high';
    reason = tr(
      'Die Unsicherheit der Regionsschätzung liegt über der festgelegten Schwelle.',
      'The uncertainty of the region estimate is above the set threshold.',
    );
  } else if (!recentEnough && !hasConfirmation) {
    reasonCode = 'outside_horizon_without_report';
    reason = tr(
      'Die letzte relevante Einheit liegt außerhalb des Modellhorizonts und es fehlt eine bestätigende Meldung.',
      'The last relevant session is outside the model horizon and no confirming report exists.',
    );
  } else if (!hasConfirmation && freshness === 100) {
    reasonCode = 'missing_reports';
    reason = tr(
      'Ohne Meldung wird keine exakte 100 ausgegeben.',
      'Without a report, an exact 100 is not shown.',
    );
  }
  const uniqueReasons = Array.from(new Set(uncertaintyReasons));
  const uncertainty: FreshnessUncertainty = {
    roughSpreadPoints: roughSpread,
    roughLowerPoints: Math.max(0, freshness - roughSpread),
    roughUpperPoints: Math.min(100, freshness + roughSpread),
    calibrated: false,
    reasons: uniqueReasons,
  };
  const base = {
    ...regionProvenance(relevant, reports),
    regionId: id,
    at: input.at,
    residualLoad,
    uncertainty,
    isPrediction,
    contributing: relevant,
  };
  if (reasonCode && !allowUnknown) {
    return {
      ...base,
      kind: 'unknown',
      value: null,
      sorenessPrediction: null,
      reasonCode,
      reason:
        reason ??
        tr(
          'Für diese Region liegt noch keine belastbare Zahl vor.',
          'This region has no reliable number yet.',
        ),
    };
  }
  return {
    ...base,
    kind: 'freshness',
    value: freshness,
    sorenessPrediction: 10 * (1 - freshness / 100),
    assumptions: [
      tr(
        'Die Impulsantwort wird mit der versionierten Ausgangsannahme berechnet.',
        'The impulse response is calculated with the versioned starting assumption.',
      ),
      reports.length
        ? tr(
            'Die Regionsschätzung wird durch vorhandene Meldungen eingeordnet.',
            'The region estimate is placed in context by existing reports.',
          )
        : tr(
            'Mangels Meldung wird die Katalogannahme verwendet.',
            'Without a report, the catalog assumption is used.',
          ),
    ],
  };
};

/** Calculates the freshness of all concrete regions at the given time. */
export function calculateFreshness(
  input: FreshnessInput,
): FreshnessSnapshot {
  const contributions = buildRegionalStimulusContributions(input);
  const regions = Object.fromEntries(
    allRegionIds().map(id => [
      id,
      regionFreshness(id, input, contributions, false, false),
    ]),
  ) as Record<RegionId, RegionFreshness>;
  return {
    ...provenance(
      contributions.flatMap(contribution =>
        contribution.source === 'strength'
          ? [contribution.sessionId]
          : [contribution.runId],
      ),
      input.reports,
    ),
    kind: 'freshness_snapshot',
    at: input.at,
    isPrediction: false,
    regions,
  };
}

/** Forward-looking evaluation of the same equation, explicitly marked as a forecast. */
export function predictFreshness(input: FreshnessInput): FreshnessSnapshot {
  const contributions = buildRegionalStimulusContributions(input);
  const regions = Object.fromEntries(
    allRegionIds().map(id => [
      id,
      regionFreshness(id, input, contributions, true, false),
    ]),
  ) as Record<RegionId, RegionFreshness>;
  return {
    ...provenance(
      contributions.flatMap(contribution =>
        contribution.source === 'strength'
          ? [contribution.sessionId]
          : [contribution.runId],
      ),
      input.reports,
    ),
    kind: 'freshness_prediction',
    at: input.at,
    isPrediction: true,
    regions,
  };
}

/** Returns the model prediction even when §7 marks the display as unknown. */
export function predictSoreness(
  input: FreshnessInput,
  regionIdValue: RegionId,
): number | null {
  const contributions = buildRegionalStimulusContributions(input);
  const result = regionFreshness(
    regionIdValue,
    input,
    contributions,
    true,
    true,
  );
  return result.kind === 'freshness' ? result.sorenessPrediction : null;
}

/** Short name for callers that use a single set as a stimulus function. */
export const setStimulus = calculateSetStimulus;

/** Short name for the run segment calculation. */
export const calculateRunSegmentStimulus = runSegmentStimulus;

/** Short name for the combined impulse response. */
export const hTotal = combinedImpulseResponse;

/** Returns a single region from a complete snapshot. */
export function freshnessAt(
  input: FreshnessInput,
  regionIdValue: RegionId,
): RegionFreshness {
  return calculateFreshness(input).regions[regionIdValue];
}

export { coefficientKey };
