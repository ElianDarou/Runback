import type { RunPurpose, RunSummary } from './types';
import type { MaxHeartRate } from './insights';
import { isAccidentalRun, isRun } from './sport';
import { tr } from './i18n';

/**
 * Suggests the run type after a run. It is only a preview: the run type is
 * saved (with this version) only once the user confirms it.
 *
 * Intent isn't in pace alone — someone who runs the same loop against the
 * clock every day is never "faster than usual" compared with themselves.
 * So effort decides (heart rate against max heart rate, otherwise the user's
 * own breathing rating). If both are missing or contradict each other, there
 * is no suggestion instead of a guess. Pace changes also need a known, flat
 * elevation and a pace that switches back and forth several times — a steady
 * slowdown at the end of a hard run is not a pace change.
 */
export const PURPOSE_HINT_VERSION = 'runback-purpose-hint-2';

const DAY = 24 * 60 * 60 * 1000;
/** A heart rate from this share of max heart rate counts as hard, up to the easy share as easy. */
const HARD_HEART_RATE_SHARE = 0.87;
const EASY_HEART_RATE_SHARE = 0.78;
/** Without enough heart rate coverage the average says nothing. */
const MIN_HEART_RATE_COVERAGE = 0.8;
/** Breathing on the 1–10 scale. */
const HARD_BREATHING = 8;
const EASY_BREATHING = 4;
/** Variation of kilometer times (coefficient of variation) from which it looks like a pace change. */
const INTERVAL_PACE_VARIATION = 0.12;
const MIN_SEGMENTS = 3;
/** A change between kilometers counts as a change of direction from this relative change. */
const PACE_STEP_SHARE = 0.05;
/** The pace must change direction at least this often (fast–slow–fast). */
const MIN_PACE_REVERSALS = 2;
/**
 * Flat means: ascent at most 1 % of the distance (ascent plus descent ≤ 2 %
 * like `segmentIsFlat`; for imports only the ascent is known).
 */
const FLAT_ASCENT_SHARE = 0.01;
/** Long run: clearly longer than usual and at least this far. */
const LONG_FACTOR = 1.25;
const LONG_MIN_METERS = 8000;
const LONG_HISTORY_DAYS = 60;
const LONG_HISTORY_MIN_RUNS = 3;

export type PurposeHintSignal =
  | 'heart_rate_high'
  | 'heart_rate_low'
  | 'breathing_hard'
  | 'breathing_easy'
  | 'pace_varied'
  | 'pace_even'
  | 'longer_than_usual';

export interface PurposeHint {
  purpose: Extract<RunPurpose, 'easy' | 'long' | 'intervals' | 'race'>;
  signals: PurposeHintSignal[];
  model_version: string;
  /** Max heart rate the heart rate was read against, with its source. */
  maxHeartRate?: MaxHeartRate;
  /** Comparison runs for "longer than usual". */
  baselineRunIds?: string[];
}

type Intensity = 'hard' | 'easy';

const finite = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function heartRateUsable(
  run: RunSummary,
  maxHeartRate: number | undefined,
): maxHeartRate is number {
  return (
    finite(maxHeartRate) &&
    finite(run.avgHeartRate) &&
    finite(run.heartRateCoverage) &&
    run.heartRateCoverage >= MIN_HEART_RATE_COVERAGE
  );
}

function heartRateIntensity(
  run: RunSummary,
  maxHeartRate: number | undefined,
): Intensity | undefined {
  if (
    !heartRateUsable(run, maxHeartRate) ||
    !finite(run.avgHeartRate)
  ) {
    return undefined;
  }
  const share = run.avgHeartRate / maxHeartRate;
  if (share >= HARD_HEART_RATE_SHARE) return 'hard';
  if (share <= EASY_HEART_RATE_SHARE) return 'easy';
  return undefined;
}

function breathingIntensity(run: RunSummary): Intensity | undefined {
  const breathing = run.rpe?.breathing;
  if (!finite(breathing)) return undefined;
  if (breathing >= HARD_BREATHING) return 'hard';
  if (breathing <= EASY_BREATHING) return 'easy';
  return undefined;
}

/** Kilometer times in order; only full, gapless segments from 900 m. */
function kilometerPaces(run: RunSummary): number[] {
  return (run.segments ?? [])
    .filter(
      segment =>
        segment.distanceMeters >= 900 &&
        segment.durationSeconds > 0 &&
        (segment.gapSeconds ?? 0) < 5,
    )
    .map(segment => segment.durationSeconds / (segment.distanceMeters / 1000));
}

/** Coefficient of variation of the kilometer times. */
function paceVariation(paces: number[]): number | undefined {
  if (paces.length < MIN_SEGMENTS) return undefined;
  const mean = paces.reduce((sum, pace) => sum + pace, 0) / paces.length;
  const variance =
    paces.reduce((sum, pace) => sum + (pace - mean) ** 2, 0) / paces.length;
  return Math.sqrt(variance) / mean;
}

/** How often the pace flips between clearly faster and clearly slower. */
function paceReversals(paces: number[]): number {
  const mean = paces.reduce((sum, pace) => sum + pace, 0) / paces.length;
  const directions = paces
    .slice(1)
    .map((pace, index) => pace - paces[index])
    .filter(step => Math.abs(step) >= mean * PACE_STEP_SHARE)
    .map(Math.sign);
  return directions
    .slice(1)
    .filter((direction, index) => direction !== directions[index]).length;
}

/** `undefined` when the elevation is unknown — then "flat" is unknown too. */
function flat(run: RunSummary): boolean | undefined {
  if (!(run.distanceMeters > 0)) return undefined;
  const ascent =
    run.elevation?.available === true
      ? run.elevation.ascentMeters
      : run.elevation?.available === false
      ? undefined
      : run.elevationGainMeters;
  if (!finite(ascent)) return undefined;
  return ascent / run.distanceMeters <= FLAT_ASCENT_SHARE;
}

/** Comparison runs when the run was clearly longer than usual; otherwise `undefined`. */
function longerThanUsual(
  run: RunSummary,
  history: RunSummary[],
): string[] | undefined {
  if (run.distanceMeters < LONG_MIN_METERS) return undefined;
  const baseline = history
    .filter(
      other =>
        other.id !== run.id &&
        isRun(other) &&
        !isAccidentalRun(other) &&
        other.startTime < run.startTime &&
        run.startTime - other.startTime <= LONG_HISTORY_DAYS * DAY &&
        other.distanceMeters > 0,
    );
  if (baseline.length < LONG_HISTORY_MIN_RUNS) return undefined;
  const usual = median(baseline.map(other => other.distanceMeters));
  return run.distanceMeters >= usual * LONG_FACTOR
    ? baseline.map(other => other.id)
    : undefined;
}

/**
 * Suggests a run type, or returns `undefined` when the data doesn't support a
 * clear statement. `maxHeartRate` comes from `maxHeartRate()` in insights.ts
 * (set or estimated).
 */
export function suggestRunPurpose(
  run: RunSummary,
  history: RunSummary[],
  maxHeartRate: MaxHeartRate | undefined,
): PurposeHint | undefined {
  if (!isRun(run) || isAccidentalRun(run) || run.distanceMeters < 1000) {
    return undefined;
  }
  const usesHeart = heartRateUsable(run, maxHeartRate?.value);
  const fromHeart = heartRateIntensity(run, maxHeartRate?.value);
  const fromBreathing = breathingIntensity(run);
  if (fromHeart && fromBreathing && fromHeart !== fromBreathing) {
    return undefined;
  }
  const intensity = fromHeart ?? fromBreathing;
  const signals: PurposeHintSignal[] = [];
  if (fromHeart) {
    signals.push(fromHeart === 'hard' ? 'heart_rate_high' : 'heart_rate_low');
  }
  if (fromBreathing) {
    signals.push(
      fromBreathing === 'hard' ? 'breathing_hard' : 'breathing_easy',
    );
  }
  // Without heart rate and without the user's own rating, there is no hint of intent.
  if (!usesHeart && !fromBreathing) return undefined;
  const paces = kilometerPaces(run);
  const variation = paceVariation(paces);
  const varied =
    variation !== undefined && variation >= INTERVAL_PACE_VARIATION;
  const hint = (
    purpose: PurposeHint['purpose'],
    baselineRunIds?: string[],
  ): PurposeHint => ({
    purpose,
    signals,
    model_version: PURPOSE_HINT_VERSION,
    ...(usesHeart ? { maxHeartRate } : {}),
    ...(baselineRunIds ? { baselineRunIds } : {}),
  });

  if (varied) {
    // Pace changes only on a known flat course, without easy effort and with a
    // real back and forth. Anything else gets no suggestion.
    if (
      flat(run) !== true ||
      intensity === 'easy' ||
      paceReversals(paces) < MIN_PACE_REVERSALS
    ) {
      return undefined;
    }
    signals.push('pace_varied');
    return hint('intervals');
  }
  if (!intensity) return undefined;
  if (variation !== undefined) signals.push('pace_even');
  if (intensity === 'hard') return hint('race');
  const baselineRunIds = longerThanUsual(run, history);
  if (baselineRunIds) {
    signals.push('longer_than_usual');
    return hint('long', baselineRunIds);
  }
  return hint('easy');
}

/** Short label for one signal, in the active language. */
function signalWord(signal: PurposeHintSignal): string {
  switch (signal) {
    case 'heart_rate_high':
      return tr('hoher Puls', 'high heart rate');
    case 'heart_rate_low':
      return tr('niedriger Puls', 'low heart rate');
    case 'breathing_hard':
      return tr('Atmung schwer', 'breathing hard');
    case 'breathing_easy':
      return tr('Atmung leicht', 'breathing easy');
    case 'pace_varied':
      return tr('Tempo stark wechselnd', 'pace changes a lot');
    case 'pace_even':
      return tr('gleichmäßiges Tempo', 'even pace');
    case 'longer_than_usual':
      return tr('länger als sonst', 'longer than usual');
  }
}

/** Short reason for the UI, e.g. "low heart rate · longer than usual". */
export function purposeHintReason(hint: PurposeHint): string {
  return hint.signals.map(signalWord).join(' · ');
}

/** What is saved on confirming: the result with its trace (ground rule 2). */
export function purposeHintProvenance(hint: PurposeHint) {
  return {
    model_version: hint.model_version,
    purpose: hint.purpose,
    signals: hint.signals,
    ...(hint.maxHeartRate ? { maxHeartRate: hint.maxHeartRate } : {}),
    ...(hint.baselineRunIds ? { baselineRunIds: hint.baselineRunIds } : {}),
  };
}
export type PurposeHintProvenance = ReturnType<typeof purposeHintProvenance>;
