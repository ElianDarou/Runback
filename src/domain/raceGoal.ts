import type { Run } from './trainingRecords';
import { validRun } from './statistics';
import { numberFormat, tr } from './i18n';

/**
 * Race goal: distance, date, goal time — and an estimate of how close the
 * user is.
 *
 * The estimate is a Riegel calculation (T2 = T1 · (D2/D1)^1.06) from an actual
 * run. It is not a measurement and not a promise; every output names the run
 * it comes from and its limits. If no suitable run exists, it stays empty
 * instead of guessing.
 */
export const RACE_GOAL_VERSION = 'race-goal-v1';
/** Riegel exponent for endurance runs. Editorial, not learned. */
export const RIEGEL_EXPONENT = 1.06;
/** Only runs from the last eight weeks carry the estimate. */
export const REFERENCE_WINDOW_DAYS = 56;
/** A reference run is at least a quarter of the goal distance, otherwise the extrapolation gets too far. */
export const REFERENCE_MIN_SHARE = 0.25;
export const REFERENCE_MIN_KM = 3;

export const HALF_MARATHON_KM = 21.0975;
export const MARATHON_KM = 42.195;

const DAY = 86400000;

const NAMED_DISTANCES: { pattern: RegExp; km: number }[] = [
  {
    pattern: /(?:halb|half)\s*-?\s*marathon|\bhm\b|\bhalf\b/i,
    km: HALF_MARATHON_KM,
  },
  { pattern: /\bultra/i, km: 0 },
  { pattern: /marathon/i, km: MARATHON_KM },
];

/**
 * Reads the distance from the goal text: "Halbmarathon", "HM", "Marathon",
 * "10 km", "5k", "21,1 Kilometer", and the English "half marathon", "10k",
 * "21.1 kilometers". Ultra without a number stays unknown.
 */
export function parseGoalDistanceKm(text: string): number | undefined {
  const value = text.trim();
  if (!value) return undefined;
  const numeric = value.match(/(\d+(?:[.,]\d+)?)\s*(?:km|k\b|kilometer(?:n)?)/i);
  if (numeric) {
    const km = Number(numeric[1].replace(',', '.'));
    return Number.isFinite(km) && km > 0 ? km : undefined;
  }
  for (const named of NAMED_DISTANCES) {
    if (named.pattern.test(value)) {
      return named.km > 0 ? named.km : undefined;
    }
  }
  return undefined;
}

/**
 * Goal time as "h:mm:ss" or "mm:ss". Two parts count as "h:mm" from 15 km on
 * when the first number is a single digit — nobody writes a half marathon in
 * minutes:seconds, but "59:30" stays minutes.
 */
export function parseGoalTime(
  text: string,
  distanceKm?: number,
): number | undefined {
  const parts = text.trim().split(':');
  if (parts.length < 2 || parts.length > 3) return undefined;
  const numbers = parts.map(part => (/^\d{1,2}$/.test(part) ? Number(part) : NaN));
  if (numbers.some(part => !Number.isFinite(part))) return undefined;
  const [a, b, c] = numbers;
  let seconds: number;
  if (parts.length === 3) {
    if (b > 59 || c > 59) return undefined;
    seconds = a * 3600 + b * 60 + c;
  } else if (distanceKm !== undefined && distanceKm >= 15 && a <= 9) {
    if (b > 59) return undefined;
    seconds = a * 3600 + b * 60;
  } else {
    if (b > 59) return undefined;
    seconds = a * 60 + b;
  }
  return seconds > 0 ? seconds : undefined;
}

export function formatGoalTime(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const rest = total % 60;
  const pad = (value: number) => String(value).padStart(2, '0');
  return hours > 0
    ? `${hours}:${pad(minutes)}:${pad(rest)} h`
    : `${minutes}:${pad(rest)} min`;
}

/** Riegel: time over D2 from a time over D1. */
export function riegelSeconds(
  durationSeconds: number,
  fromKm: number,
  toKm: number,
): number {
  return durationSeconds * Math.pow(toKm / fromKm, RIEGEL_EXPONENT);
}

/**
 * The long run the build-up aims for: nine tenths of the distance up to 25 km,
 * above that three quarters, at most 32 km. An editorial choice.
 */
export function peakLongRunKm(distanceKm: number): number {
  const peak = distanceKm <= 25 ? distanceKm * 0.9 : Math.min(32, distanceKm * 0.75);
  return Math.round(peak * 10) / 10;
}

export interface RaceGoalInput {
  goal: string;
  distanceKm?: number;
  targetDate?: string;
  targetSeconds?: number;
  runs: Run[];
  now: number;
}

export type RacePredictionStatus =
  | 'no_goal'
  | 'no_distance'
  | 'insufficient_data'
  | 'estimated';

export interface RaceReference {
  runId: string;
  distanceKm: number;
  durationSeconds: number;
  startTime: number;
}

export interface RacePrediction {
  version: typeof RACE_GOAL_VERSION;
  status: RacePredictionStatus;
  goal: string;
  /** One sentence for the card. */
  message: string;
  distanceKm?: number;
  targetDate?: string;
  targetSeconds?: number;
  /** Estimated goal time by Riegel from `reference`. */
  predictedSeconds?: number;
  predictedPaceSecondsPerKm?: number;
  targetPaceSecondsPerKm?: number;
  /** Estimated minus goal pace in s/km; positive means still too slow. */
  paceGapSecondsPerKm?: number;
  reference?: RaceReference;
  /** Longest run in the window and the long run the build-up aims for. */
  longestRunKm?: number;
  peakLongRunKm?: number;
  /** Share 0–1: longest run against the targeted long run. */
  distanceShare?: number;
  /** Share 0–1: goal time against estimated time. Only with a goal time. */
  timeShare?: number;
  /**
   * Goal progress 0–1 for the ring: the smaller of the distance and time shares.
   * Without an estimate there is no goal progress either.
   */
  progress?: number;
  /** Which value currently limits the goal progress. */
  limitedBy?: 'distance' | 'time';
  daysToGo?: number;
  limits: string[];
}

const round1 = (value: number) => Math.round(value * 10) / 10;

export function effectiveGoalDistanceKm(input: {
  /** Goal text; `name` for a goal from the plan. */
  goal?: string;
  name?: string;
  distanceKm?: number;
}): number | undefined {
  if (
    typeof input.distanceKm === 'number' &&
    Number.isFinite(input.distanceKm) &&
    input.distanceKm > 0
  ) {
    return input.distanceKm;
  }
  return parseGoalDistanceKm(input.goal ?? input.name ?? '');
}

export function daysUntil(targetDate: string, now: number): number | undefined {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(targetDate)) return undefined;
  const [year, month, day] = targetDate.split('-').map(Number);
  const target = new Date(year, month - 1, day, 12, 0, 0, 0).getTime();
  const today = new Date(now);
  today.setHours(12, 0, 0, 0);
  const days = Math.round((target - today.getTime()) / DAY);
  return Number.isFinite(days) ? days : undefined;
}

/** Estimates how close the user is to their race goal. */
export function predictRace(input: RaceGoalInput): RacePrediction {
  const goal = input.goal.trim();
  const base = {
    version: RACE_GOAL_VERSION as typeof RACE_GOAL_VERSION,
    goal,
    limits: [] as string[],
  };
  if (!goal) {
    return {
      ...base,
      status: 'no_goal',
      message: tr('Noch kein Ziel hinterlegt.', 'No goal set yet.'),
    };
  }
  const distanceKm = effectiveGoalDistanceKm(input);
  const daysToGo =
    input.targetDate === undefined ? undefined : daysUntil(input.targetDate, input.now);
  const targetSeconds =
    typeof input.targetSeconds === 'number' &&
    Number.isFinite(input.targetSeconds) &&
    input.targetSeconds > 0
      ? input.targetSeconds
      : undefined;
  if (distanceKm === undefined) {
    return {
      ...base,
      status: 'no_distance',
      message: tr(
        'Trage eine Strecke ein, dann schätzt Runback deine Zielzeit.',
        'Enter a distance, then Runback estimates your goal time.',
      ),
      targetDate: input.targetDate,
      daysToGo,
    };
  }
  const peak = peakLongRunKm(distanceKm);
  const windowStart = input.now - REFERENCE_WINDOW_DAYS * DAY;
  const seen = new Set<string>();
  const recent = input.runs.filter(run => {
    if (!validRun(run, input.now) || run.startTime < windowStart) return false;
    if (run.distanceMeters <= 0 || run.durationSeconds <= 0) return false;
    const key = run.canonicalId || run.id;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const longest = recent.reduce<Run | null>(
    (current, run) =>
      !current || run.distanceMeters > current.distanceMeters ? run : current,
    null,
  );
  const longestRunKm = longest ? round1(longest.distanceMeters / 1000) : undefined;
  const minReferenceKm = Math.max(REFERENCE_MIN_KM, distanceKm * REFERENCE_MIN_SHARE);
  // The best run is the one with the smallest projected goal time, not the
  // longest: a fast 10k says more than a slow 15k.
  let reference: RaceReference | undefined;
  let predictedSeconds: number | undefined;
  for (const run of recent) {
    const km = run.distanceMeters / 1000;
    if (km < minReferenceKm) continue;
    const projected = riegelSeconds(run.durationSeconds, km, distanceKm);
    if (predictedSeconds === undefined || projected < predictedSeconds) {
      predictedSeconds = projected;
      reference = {
        runId: run.id,
        distanceKm: round1(km),
        durationSeconds: run.durationSeconds,
        startTime: run.startTime,
      };
    }
  }
  const common = {
    ...base,
    distanceKm,
    targetDate: input.targetDate,
    targetSeconds,
    longestRunKm,
    peakLongRunKm: peak,
    daysToGo,
  };
  if (!reference || predictedSeconds === undefined) {
    return {
      ...common,
      status: 'insufficient_data',
      message: tr(
        `Für eine Schätzung fehlt ein Lauf über mindestens ${formatDistanceKm(
          minReferenceKm,
        )} aus den letzten acht Wochen.`,
        `An estimate needs a run of at least ${formatDistanceKm(
          minReferenceKm,
        )} from the last eight weeks.`,
      ),
    };
  }
  const distanceShare = Math.min(1, (longestRunKm ?? 0) / peak);
  const timeShare =
    targetSeconds === undefined ? undefined : Math.min(1, targetSeconds / predictedSeconds);
  const limitedBy: 'distance' | 'time' =
    timeShare !== undefined && timeShare < distanceShare ? 'time' : 'distance';
  const progress = limitedBy === 'time' ? (timeShare as number) : distanceShare;
  const predictedPace = predictedSeconds / distanceKm;
  const targetPace = targetSeconds === undefined ? undefined : targetSeconds / distanceKm;
  const paceGap = targetPace === undefined ? undefined : predictedPace - targetPace;
  const limits = [
    tr(
      `Die Schätzung rechnet deinen Lauf über ${formatDistanceKm(
        reference.distanceKm,
      )} nach Riegel hoch und nimmt an, dass du ihn mit vollem Einsatz gelaufen bist.`,
      `The estimate scales your run of ${formatDistanceKm(
        reference.distanceKm,
      )} up with Riegel and assumes you ran it at full effort.`,
    ),
    tr(
      'Schätzung, keine Messung. Sie ersetzt keinen Testlauf über die Zielstrecke.',
      'An estimate, not a measurement. It does not replace a test run over the goal distance.',
    ),
  ];
  const message =
    targetSeconds === undefined
      ? tr(
          `Nach deinem Lauf über ${formatDistanceKm(reference.distanceKm)} wären etwa ${formatGoalTime(
            predictedSeconds,
          )} möglich.`,
          `After your run over ${formatDistanceKm(reference.distanceKm)}, about ${formatGoalTime(
            predictedSeconds,
          )} would be possible.`,
        )
      : paceGap !== undefined && paceGap <= 0
      ? tr(
          `Nach deinem Lauf über ${formatDistanceKm(
            reference.distanceKm,
          )} liegt dein Ziel von ${formatGoalTime(targetSeconds)} rechnerisch drin.`,
          `After your run over ${formatDistanceKm(
            reference.distanceKm,
          )}, your goal of ${formatGoalTime(targetSeconds)} is within reach on paper.`,
        )
      : tr(
          `Etwa ${formatGoalTime(
            predictedSeconds,
          )} sind rechnerisch drin — für ${formatGoalTime(
            targetSeconds,
          )} fehlen noch ${formatPaceGap(paceGap as number)} pro Kilometer.`,
          `About ${formatGoalTime(
            predictedSeconds,
          )} is possible on paper — for ${formatGoalTime(
            targetSeconds,
          )} you still need to gain ${formatPaceGap(paceGap as number)} per kilometer.`,
        );
  return {
    ...common,
    status: 'estimated',
    message,
    predictedSeconds: Math.round(predictedSeconds),
    predictedPaceSecondsPerKm: Math.round(predictedPace),
    targetPaceSecondsPerKm: targetPace === undefined ? undefined : Math.round(targetPace),
    paceGapSecondsPerKm: paceGap === undefined ? undefined : Math.round(paceGap),
    reference,
    distanceShare: Math.round(distanceShare * 100) / 100,
    timeShare: timeShare === undefined ? undefined : Math.round(timeShare * 100) / 100,
    progress: Math.round(progress * 100) / 100,
    limitedBy,
    limits,
  };
}

export function formatDistanceKm(km: number): string {
  const text = numberFormat({
    minimumFractionDigits: 0,
    maximumFractionDigits: 1,
  }).format(km);
  return `${text} km`;
}

function formatPaceGap(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')} min`;
}
