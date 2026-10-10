import type { RunPurpose, RunSummary } from './types';
import type { MaxHeartRate } from './insights';
import { isAccidentalRun, isRun } from './sport';
import { tr } from './i18n';
import { comparablePurpose, hasNamedPurpose } from './runTitle';
import type { RunTarget } from './runTarget';

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
export const PURPOSE_HINT_VERSION = 'runback-purpose-hint-3';

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

export type PurposeHintSignal =
  | 'heart_rate_high'
  | 'heart_rate_low'
  | 'breathing_hard'
  | 'breathing_easy'
  | 'pace_varied'
  | 'pace_even'
  // Only in hints confirmed before version 3, when long runs were their own type.
  | 'longer_than_usual';

export interface PurposeHint {
  purpose: Extract<RunPurpose, 'easy' | 'intervals' | 'race'>;
  signals: PurposeHintSignal[];
  model_version: string;
  /** Max heart rate the heart rate was read against, with its source. */
  maxHeartRate?: MaxHeartRate;
  /** Comparison runs for "longer than usual" (hints before version 3). */
  baselineRunIds?: string[];
}

type Intensity = 'hard' | 'easy';

const finite = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

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

/**
 * Suggests a run type, or returns `undefined` when the data doesn't support a
 * clear statement. `maxHeartRate` comes from `maxHeartRate()` in insights.ts
 * (set or estimated).
 */
export function suggestRunPurpose(
  run: RunSummary,
  _history: RunSummary[],
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
  const hint = (purpose: PurposeHint['purpose']): PurposeHint => ({
    purpose,
    signals,
    model_version: PURPOSE_HINT_VERSION,
    ...(usesHeart ? { maxHeartRate } : {}),
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
  return hint(intensity === 'hard' ? 'race' : 'easy');
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

/** Where the preselected run type of the question after a run comes from. */
export type LikelyPurposeSource =
  | 'intervals_target'
  | 'hint'
  | 'plan'
  | 'pace_ceiling'
  | 'similar_runs'
  | 'recent_runs'
  | 'default';

export interface LikelyPurpose {
  purpose: Extract<RunPurpose, 'easy' | 'race' | 'intervals'>;
  source: LikelyPurposeSource;
  /** Set when the heart rate or breathing hint decided. */
  hint?: PurposeHint;
}

const SIMILAR_DAYS = 120;
const SIMILAR_DISTANCE_SHARE = 0.2;
const RECENT_RUNS = 5;

/** Most frequent run type among the given runs (newest first); a tie goes to the newest. */
function usualPurpose(
  runs: RunSummary[],
): LikelyPurpose['purpose'] | undefined {
  const counts = new Map<LikelyPurpose['purpose'], number>();
  for (const other of runs) {
    const purpose = comparablePurpose(other.purpose);
    if (purpose !== 'unknown')
      counts.set(purpose, (counts.get(purpose) ?? 0) + 1);
  }
  let best: LikelyPurpose['purpose'] | undefined;
  for (const other of runs) {
    const purpose = comparablePurpose(other.purpose);
    if (purpose === 'unknown') continue;
    if (!best || (counts.get(purpose) ?? 0) > (counts.get(best) ?? 0))
      best = purpose;
  }
  return best;
}

/**
 * The most likely run type for the question after a run, so usually a single
 * "OK" is enough. Only a preselection: nothing is saved until the user
 * confirms. Order: started as intervals, the heart rate or breathing hint, the
 * planned session, a pace ceiling, the user's own choices on similar runs,
 * then on recent runs. Without any of these it falls back to easy, the most
 * common kind of run.
 */
export function likelyPurpose(input: {
  run: RunSummary;
  target?: RunTarget;
  history: RunSummary[];
  maxHeartRate: MaxHeartRate | undefined;
  plannedPurpose?: RunPurpose;
}): LikelyPurpose {
  const { run, target, history } = input;
  if (target?.kind === 'intervals') {
    return { purpose: 'intervals', source: 'intervals_target' };
  }
  const hint = suggestRunPurpose(run, history, input.maxHeartRate);
  if (hint) return { purpose: hint.purpose, source: 'hint', hint };
  const planned = comparablePurpose(input.plannedPurpose);
  if (planned !== 'unknown') return { purpose: planned, source: 'plan' };
  if (target?.kind === 'pace' && target.mode === 'ceiling') {
    return { purpose: 'easy', source: 'pace_ceiling' };
  }
  const earlier = history
    .filter(
      other =>
        other.id !== run.id &&
        isRun(other) &&
        !isAccidentalRun(other) &&
        other.startTime < run.startTime &&
        hasNamedPurpose(other.purpose),
    )
    .sort((a, b) => b.startTime - a.startTime);
  const similar = earlier
    .filter(
      other =>
        run.startTime - other.startTime <= SIMILAR_DAYS * DAY &&
        run.distanceMeters > 0 &&
        Math.abs(other.distanceMeters / run.distanceMeters - 1) <=
          SIMILAR_DISTANCE_SHARE,
    )
    .slice(0, RECENT_RUNS);
  const fromSimilar = usualPurpose(similar);
  if (fromSimilar) return { purpose: fromSimilar, source: 'similar_runs' };
  const fromRecent = usualPurpose(earlier.slice(0, RECENT_RUNS));
  if (fromRecent) return { purpose: fromRecent, source: 'recent_runs' };
  return { purpose: 'easy', source: 'default' };
}

/** Short reason for the preselection, or `undefined` for the plain default. */
export function likelyPurposeReason(likely: LikelyPurpose): string | undefined {
  switch (likely.source) {
    case 'intervals_target':
      return tr('Mit Intervallen gestartet', 'Started with intervals');
    case 'hint':
      return likely.hint ? purposeHintReason(likely.hint) : undefined;
    case 'plan':
      return tr('So geplant', 'As planned');
    case 'pace_ceiling':
      return tr('Mit Tempo-Obergrenze gelaufen', 'Run with a pace ceiling');
    case 'similar_runs':
      return tr('Wie deine ähnlichen Läufe', 'Like your similar runs');
    case 'recent_runs':
      return tr('Wie deine letzten Läufe', 'Like your recent runs');
    default:
      return undefined;
  }
}

/**
 * Runs recorded by Runback ask once for their run type when first opened.
 * Older recordings always had a run type from the start, and imports have the
 * "add run type" list instead, so neither gets the question.
 */
export function asksPurposeOnOpen(run: {
  purpose: RunPurpose;
  source: string;
  status: string;
  sport?: RunSummary['sport'];
  purposeConfirmed?: boolean;
  purposeAsked?: boolean;
}): boolean {
  return (
    isRun(run) &&
    run.status === 'completed' &&
    (run.source === 'phone' || run.source === 'wear_os') &&
    run.purpose === 'unknown' &&
    !run.purposeConfirmed &&
    !run.purposeAsked
  );
}
