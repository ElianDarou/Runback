import { exactLowerRank, finite, median, robustScale } from './inference';
import { isSetCompleted, epley1RM, type LoggedSet, type StrengthSession } from './strength';
import { tr } from './i18n';

/**
 * v2: exact Kendall distribution instead of the normal approximation for small
 * n, direction only from five training days, plateau as an equivalence test,
 * relevance threshold 4 % instead of 2 % (test-retest spread of 1RM ≈ 2–3 %).
 */
// v3 also counts imported actual sets without a tick-off time.
// v4: observation only; no load suggestion or check criterion.
export const PROGRESSION_MODEL_VERSION = 'strength-progression-v4';
const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;
const PLATEAU_MS = 4 * WEEK_MS;
/** Under five days, even a perfectly monotonic series is too often chance. */
export const MINIMUM_SESSIONS_FOR_DIRECTION = 5;
/** Smallest change in e1RM that exceeds day-to-day form (a set value). */
export const MINIMUM_RELEVANT_CHANGE_PERCENT = 4;
/** "Stable" means: the weekly slope lies safely within ± this share. */
export const PLATEAU_EQUIVALENCE_PERCENT_PER_WEEK = 0.5;
/** Up to here the exact distribution is computed; above it, the approximation. */
const EXACT_DISTRIBUTION_MAX_POINTS = 12;

export interface E1RMPoint {
  sessionId: string;
  at: number;
  e1rm: number;
  weightKg: number;
  reps: number;
  setId: string;
}

/** A working set is only taken from a finished session. */
export function bestWorkingSet(
  session: StrengthSession,
  exerciseId: string,
): E1RMPoint | null {
  if (session.status !== 'finished') {
    return null;
  }
  const exercise = session.exercises.find(
    candidate => candidate.exerciseId === exerciseId,
  );
  const at = session.endTime ?? session.startTime;
  if (!exercise || !finite(at)) {
    return null;
  }
  let best: E1RMPoint | null = null;
  for (const set of exercise.sets) {
    if (!isCompletedWorkingSet(set)) {
      continue;
    }
    const weightKg = set.actualWeightKg;
    const reps = set.actualReps;
    if (!finite(weightKg) || !finite(reps)) {
      continue;
    }
    const e1rm = epley1RM(weightKg, reps);
    if (e1rm === null) {
      continue;
    }
    const point: E1RMPoint = {
      sessionId: session.id,
      at,
      e1rm,
      weightKg,
      reps,
      setId: set.id,
    };
    if (
      best === null ||
      point.e1rm > best.e1rm ||
      (point.e1rm === best.e1rm && point.setId.localeCompare(best.setId) < 0)
    ) {
      best = point;
    }
  }
  return best;
}

function isCompletedWorkingSet(set: LoggedSet): boolean {
  return (
    isSetCompleted(set) &&
    !set.skipped &&
    (set.planned.kind === 'normal' || set.planned.kind === 'failure') &&
    set.planned.loadKind === 'kg' &&
    finite(set.actualWeightKg) &&
    finite(set.actualReps)
  );
}

/** Series per exercise; open, interrupted and warm-up sets are left out. */
export function buildE1RMSeries(
  sessions: StrengthSession[],
  exerciseId: string,
): E1RMPoint[] {
  return sessions
    .map(session => bestWorkingSet(session, exerciseId))
    .filter((point): point is E1RMPoint => point !== null)
    .sort((a, b) => a.at - b.at || a.sessionId.localeCompare(b.sessionId));
}

export interface RankConfidenceInterval {
  lower: number;
  upper: number;
  confidenceLevel: number;
  lowerRank: number;
  upperRank: number;
  /** true: exact permutation distribution; false: normal approximation (n > 12). */
  exact: boolean;
}

/**
 * Rank-based bound for the same pairwise slopes as Theil-Sen. Up to twelve
 * points exact via the distribution of inversions; above that the normal
 * approximation after Gilbert (1987) with a tie correction. No result if n
 * cannot support the requested level — that is not an error.
 */
export function rankConfidenceInterval(
  slopes: number[],
  observations: number,
  confidenceLevel = 0.95,
  tieGroupSizes: number[] = [],
): RankConfidenceInterval | null {
  const finiteSlopes = slopes.filter(finite).sort((a, b) => a - b);
  const expectedPairs = (observations * (observations - 1)) / 2;
  if (
    !finiteSlopes.length ||
    observations < 2 ||
    finiteSlopes.length !== expectedPairs
  ) {
    return null;
  }
  const confidence = Math.min(
    0.999,
    Math.max(0.5, finite(confidenceLevel) ? confidenceLevel : 0.95),
  );
  const alpha = (1 - confidence) / 2;
  const n = finiteSlopes.length;
  if (observations <= EXACT_DISTRIBUTION_MAX_POINTS) {
    const lowerRank = exactLowerRank(observations, alpha);
    if (lowerRank === null) {
      return null;
    }
    const upperRank = n - 1 - lowerRank;
    return {
      lower: finiteSlopes[lowerRank],
      upper: finiteSlopes[upperRank],
      confidenceLevel: confidence,
      lowerRank,
      upperRank,
      exact: true,
    };
  }
  const z =
    confidence >= 0.985
      ? 2.326
      : confidence >= 0.94
      ? 1.96
      : confidence >= 0.89
      ? 1.645
      : 1.282;
  const tieTerm = tieGroupSizes
    .filter(size => size > 1)
    .reduce((sum, size) => sum + size * (size - 1) * (2 * size + 5), 0);
  const variance =
    (observations * (observations - 1) * (2 * observations + 5) - tieTerm) / 18;
  const rankHalfWidth = z * Math.sqrt(Math.max(0, variance));
  // Gilbert: M1 = (N − C)/2 is a 1-based rank; here it is 0-based.
  const lowerRank = Math.max(
    0,
    Math.min(n - 1, Math.floor((n - rankHalfWidth) / 2) - 1),
  );
  const upperRank = Math.max(
    lowerRank,
    Math.min(n - 1, Math.ceil((n + rankHalfWidth) / 2)),
  );
  return {
    lower: finiteSlopes[lowerRank],
    upper: finiteSlopes[upperRank],
    confidenceLevel: confidence,
    lowerRank,
    upperRank,
    exact: false,
  };
}

export interface TheilSenTrend {
  slopePerWeek: number;
  intercept: number;
  confidenceInterval: RankConfidenceInterval;
  pairwiseSlopeCount: number;
  firstAt: number;
  lastAt: number;
  pointCount: number;
  predictAt: (at: number) => number;
}

/** Two sessions on the same day are one observation day; the better one counts. */
export function collapseToDays(series: E1RMPoint[]): E1RMPoint[] {
  const byDay = new Map<number, E1RMPoint>();
  for (const point of series) {
    if (!finite(point.at) || !finite(point.e1rm)) {
      continue;
    }
    const day = Math.floor(point.at / DAY_MS);
    const existing = byDay.get(day);
    if (!existing || point.e1rm > existing.e1rm) {
      byDay.set(day, point);
    }
  }
  return [...byDay.values()].sort(
    (a, b) => a.at - b.at || a.sessionId.localeCompare(b.sessionId),
  );
}

/** Theil-Sen estimate with the time axis in weeks from the first point. */
export function theilSenSlope(
  series: E1RMPoint[],
  confidenceLevel = 0.95,
): TheilSenTrend | null {
  const points = collapseToDays(series);
  if (points.length < 2) {
    return null;
  }
  const firstAt = points[0].at;
  const x = (at: number) => (at - firstAt) / WEEK_MS;
  const slopes: number[] = [];
  for (let i = 0; i < points.length; i += 1) {
    for (let j = i + 1; j < points.length; j += 1) {
      const deltaX = x(points[j].at) - x(points[i].at);
      slopes.push((points[j].e1rm - points[i].e1rm) / deltaX);
    }
  }
  const tieGroups = new Map<number, number>();
  for (const point of points) {
    tieGroups.set(point.e1rm, (tieGroups.get(point.e1rm) ?? 0) + 1);
  }
  const confidenceInterval = rankConfidenceInterval(
    slopes,
    points.length,
    confidenceLevel,
    [...tieGroups.values()],
  );
  if (!confidenceInterval) {
    return null;
  }
  const slopePerWeek = median(slopes);
  const intercept = median(
    points.map(point => point.e1rm - slopePerWeek * x(point.at)),
  );
  return {
    slopePerWeek,
    intercept,
    confidenceInterval,
    pairwiseSlopeCount: slopes.length,
    firstAt,
    lastAt: points[points.length - 1].at,
    pointCount: points.length,
    predictAt: (at: number) => intercept + slopePerWeek * x(at),
  };
}

export interface CusumChangePoint {
  index: number;
  sessionId: string;
  at: number;
  direction: 'higher' | 'lower';
  score: number;
  residual: number;
}

export interface CusumAnalysis {
  residuals: { sessionId: string; at: number; residual: number }[];
  changePoints: CusumChangePoint[];
  threshold: number;
  allowance: number;
  minimumConsecutive: number;
}

export interface CusumOptions {
  threshold?: number;
  allowance?: number;
  minimumConsecutive?: number;
}

/** CUSUM on trend residuals; by default a single outlier is not enough. */
export function detectCusumChangePoints(
  series: E1RMPoint[],
  trend: TheilSenTrend,
  options: CusumOptions = {},
): CusumAnalysis {
  const points = series
    .filter(point => finite(point.at) && finite(point.e1rm))
    .sort((a, b) => a.at - b.at || a.sessionId.localeCompare(b.sessionId));
  const residuals = points.map(point => ({
    sessionId: point.sessionId,
    at: point.at,
    residual: point.e1rm - trend.predictAt(point.at),
  }));
  if (!points.length) {
    return {
      residuals,
      changePoints: [],
      threshold: options.threshold ?? 0,
      allowance: options.allowance ?? 0,
      minimumConsecutive: Math.max(
        2,
        Math.floor(options.minimumConsecutive ?? 2),
      ),
    };
  }
  // MAD of the residuals themselves (not of their magnitudes): otherwise σ would be halved.
  const baseline = Math.max(
    0.5,
    median(points.map(point => point.e1rm)) * 0.005,
  );
  const scale = Math.max(
    baseline,
    robustScale(residuals.map(item => item.residual)),
  );
  const allowance = Math.max(
    0.1,
    finite(options.allowance) ? options.allowance : scale * 0.5,
  );
  const threshold = Math.max(
    allowance * 2,
    finite(options.threshold) ? options.threshold : scale * 4,
  );
  const minimumConsecutive = Math.max(
    2,
    Math.floor(options.minimumConsecutive ?? 2),
  );
  let positive = 0;
  let negative = 0;
  let positiveStreak = 0;
  let negativeStreak = 0;
  const changePoints: CusumChangePoint[] = [];
  residuals.forEach((item, index) => {
    positive = Math.max(0, positive + item.residual - allowance);
    negative = Math.min(0, negative + item.residual + allowance);
    positiveStreak =
      item.residual > 0 && positive > threshold ? positiveStreak + 1 : 0;
    negativeStreak =
      item.residual < 0 && -negative > threshold ? negativeStreak + 1 : 0;
    if (positiveStreak >= minimumConsecutive) {
      changePoints.push({
        index,
        sessionId: item.sessionId,
        at: item.at,
        direction: 'higher',
        score: positive,
        residual: item.residual,
      });
      positive = 0;
      positiveStreak = 0;
    } else if (negativeStreak >= minimumConsecutive) {
      changePoints.push({
        index,
        sessionId: item.sessionId,
        at: item.at,
        direction: 'lower',
        score: -negative,
        residual: item.residual,
      });
      negative = 0;
      negativeStreak = 0;
    }
    if (item.residual < 0) {
      positive = 0;
      positiveStreak = 0;
    }
    if (item.residual > 0) {
      negative = 0;
      negativeStreak = 0;
    }
  });
  return {
    residuals,
    changePoints,
    threshold,
    allowance,
    minimumConsecutive,
  };
}

export type PlateauStatus = 'changing' | 'stable' | 'unclear';

export interface PlateauAssessment {
  /** true only for `status === 'stable'`; "interval contains 0" is not enough. */
  isPlateau: boolean;
  status: PlateauStatus;
  spanWeeks: number;
  /** Permissible weekly slope in kg within which "stable" applies. */
  equivalenceMarginKgPerWeek: number | null;
  criterion: string;
}

/**
 * Equivalence test instead of "no evidence": stable means the entire slope
 * interval lies within ± margin. A wide interval around 0 is "not clear yet",
 * not a plateau.
 */
export function assessPlateau(
  series: E1RMPoint[],
  trend: TheilSenTrend | null,
): PlateauAssessment {
  const points = collapseToDays(series);
  const spanWeeks =
    points.length > 1
      ? (points[points.length - 1].at - points[0].at) / WEEK_MS
      : 0;
  const margin =
    points.length > 0
      ? (median(points.map(point => point.e1rm)) *
          PLATEAU_EQUIVALENCE_PERCENT_PER_WEEK) /
        100
      : null;
  const criterion = tr(
    'Stabil bedeutet: das Steigungsintervall liegt vollständig innerhalb ±0,5 % des e1RM pro Woche und umfasst mindestens vier Wochen. Ein breites Intervall um 0 heißt nur „noch nicht klar“.',
    'Stable means: the slope interval lies entirely within ±0.5% of the e1RM per week and spans at least four weeks. A wide interval around 0 only means "not clear yet".',
  );
  if (!trend || margin === null) {
    return {
      isPlateau: false,
      status: 'unclear',
      spanWeeks,
      equivalenceMarginKgPerWeek: margin,
      criterion,
    };
  }
  const { lower, upper } = trend.confidenceInterval;
  const status: PlateauStatus =
    lower > 0 || upper < 0
      ? 'changing'
      : spanWeeks * WEEK_MS >= PLATEAU_MS && lower >= -margin && upper <= margin
      ? 'stable'
      : 'unclear';
  return {
    isPlateau: status === 'stable',
    status,
    spanWeeks,
    equivalenceMarginKgPerWeek: margin,
    criterion,
  };
}

export interface ProgressionOptions {
  confidenceLevel?: number;
}

export type ProgressionVerdict =
  | 'increase'
  | 'reduce'
  | 'plateau'
  | 'keep_going'
  | 'not_assessable';

export interface ProgressionAssessment {
  model_version: string;
  inputSources: { runId: string; source: string; version: string }[];
  exerciseId: string;
  inputSessionIds: string[];
  series: E1RMPoint[];
  trend: TheilSenTrend | null;
  plateau: PlateauAssessment;
  cusum: CusumAnalysis | null;
  verdict: ProgressionVerdict;
  reason: string;
}

/** Observed direction of one exercise's estimated max; never an instruction. */
export function assessExerciseProgression(
  sessions: StrengthSession[],
  exerciseId: string,
  options: ProgressionOptions = {},
): ProgressionAssessment {
  const series = buildE1RMSeries(sessions, exerciseId);
  const inputSessionIds = series.map(point => point.sessionId);
  const inputSources = series.map(point => {
    const source = sessions.find(session => session.id === point.sessionId);
    return {
      runId: point.sessionId,
      source: 'strength-session',
      version: source?.modelVersion ?? 'unknown',
    };
  });
  const emptyPlateau = assessPlateau(series, null);
  const days = collapseToDays(series).length;
  if (days < MINIMUM_SESSIONS_FOR_DIRECTION) {
    const missing = MINIMUM_SESSIONS_FOR_DIRECTION - days;
    return {
      model_version: PROGRESSION_MODEL_VERSION,
      inputSources,
      exerciseId,
      inputSessionIds,
      series,
      trend: null,
      plateau: emptyPlateau,
      cusum: null,
      verdict: 'not_assessable',
      reason: tr(
        `Noch nicht klar: Erst ab ${MINIMUM_SESSIONS_FOR_DIRECTION} Trainingstagen mit geeigneten Arbeitssätzen trägt der Verlauf eine Richtung; es ${
          missing === 1 ? 'fehlt noch einer' : `fehlen noch ${missing}`
        }.`,
        `Not clear yet: the trend only supports a direction after ${MINIMUM_SESSIONS_FOR_DIRECTION} training days with suitable working sets; ${
          missing === 1 ? 'one more is missing' : `${missing} more are missing`
        }.`,
      ),
    };
  }
  const trend = theilSenSlope(series, options.confidenceLevel);
  if (!trend) {
    return {
      model_version: PROGRESSION_MODEL_VERSION,
      inputSources,
      exerciseId,
      inputSessionIds,
      series,
      trend: null,
      plateau: emptyPlateau,
      cusum: null,
      verdict: 'not_assessable',
      reason: tr(
        'Noch nicht klar: Aus diesen Einheiten lässt sich kein Steigungsintervall auf dem gewählten Niveau bilden.',
        'Not clear yet: these sessions cannot form a slope interval at the chosen level.',
      ),
    };
  }
  const plateau = assessPlateau(series, trend);
  const cusum = detectCusumChangePoints(series, trend);
  const verdict: Exclude<ProgressionVerdict, 'not_assessable'> =
    trend.confidenceInterval.lower > 0
      ? 'increase'
      : trend.confidenceInterval.upper < 0
      ? 'reduce'
      : plateau.isPlateau
      ? 'plateau'
      : 'keep_going';
  const reason =
    verdict === 'increase'
      ? tr(
          'Dein geschätztes Maximum steigt über die letzten Einheiten.',
          'Your estimated max is rising over the last sessions.',
        )
      : verdict === 'reduce'
      ? tr(
          'Dein geschätztes Maximum fällt über die letzten Einheiten.',
          'Your estimated max is falling over the last sessions.',
        )
      : verdict === 'plateau'
      ? tr(
          'Seit mindestens vier Wochen ist deine Leistung nachweislich stabil; das Steigungsintervall liegt eng um null.',
          'Your performance has been demonstrably stable for at least four weeks; the slope interval sits tightly around zero.',
        )
      : tr(
          'Noch nicht klar: Der Verlauf lässt sowohl eine Änderung als auch Stillstand zu.',
          'Not clear yet: the trend allows both a change and a plateau.',
        );
  return {
    model_version: PROGRESSION_MODEL_VERSION,
    inputSources,
    exerciseId,
    inputSessionIds,
    series,
    trend,
    plateau,
    cusum,
    verdict,
    reason,
  };
}

export const e1rmSeries = buildE1RMSeries;
export const estimateTheilSenTrend = theilSenSlope;
export const detectPlateau = assessPlateau;
export const progressionForExercise = assessExerciseProgression;
