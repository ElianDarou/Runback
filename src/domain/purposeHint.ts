import type { RunPurpose, RunSummary } from './types';
import type { MaxHeartRate } from './insights';
import { isAccidentalRun, isRun } from './sport';

/**
 * Vorschlag der Laufart nach dem Lauf. Er ist nur Vorschau: Erst wenn der
 * Nutzer ihn bestätigt, wird die Laufart gespeichert (mit dieser Version).
 *
 * Die Absicht steckt nicht im Tempo allein — wer jeden Tag dieselbe Runde auf
 * Zeit läuft, ist im Vergleich zu sich selbst nie „schneller als sonst“.
 * Deshalb entscheidet die Anstrengung (Puls gegen Maxpuls, sonst die eigene
 * Angabe zur Atmung). Fehlt beides oder widerspricht es sich, gibt es keinen
 * Vorschlag statt einer Vermutung. Tempowechsel braucht zusätzlich bekannte,
 * flache Höhe und ein Tempo, das mehrmals hin und her springt — ein stetiges
 * Nachlassen am Ende eines harten Laufs ist kein Tempowechsel.
 */
export const PURPOSE_HINT_VERSION = 'runback-purpose-hint-2';

const DAY = 24 * 60 * 60 * 1000;
/** Puls ab diesem Anteil vom Maxpuls gilt als hart, bis zu diesem als ruhig. */
const HARD_HEART_RATE_SHARE = 0.87;
const EASY_HEART_RATE_SHARE = 0.78;
/** Ohne ausreichende Pulsabdeckung ist der Durchschnitt keine Aussage. */
const MIN_HEART_RATE_COVERAGE = 0.8;
/** Atmung auf der Skala 1–10. */
const HARD_BREATHING = 8;
const EASY_BREATHING = 4;
/** Schwankung der Kilometerzeiten (Variationskoeffizient), ab der es nach Tempowechsel aussieht. */
const INTERVAL_PACE_VARIATION = 0.12;
const MIN_SEGMENTS = 3;
/** Ein Kilometerwechsel zählt ab dieser relativen Änderung als Richtungswechsel. */
const PACE_STEP_SHARE = 0.05;
/** Mindestens so oft muss das Tempo die Richtung wechseln (schnell–langsam–schnell). */
const MIN_PACE_REVERSALS = 2;
/**
 * Flach heißt: Anstieg höchstens 1 % der Strecke (Auf- plus Abstieg ≤ 2 % wie
 * `segmentIsFlat`, bei Importen ist nur der Anstieg bekannt).
 */
const FLAT_ASCENT_SHARE = 0.01;
/** Lange Runde: deutlich länger als üblich und mindestens so weit. */
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
  /** Maxpuls, gegen den der Puls gelesen wurde, mit Herkunft. */
  maxHeartRate?: MaxHeartRate;
  /** Vergleichsläufe für „länger als sonst“. */
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

/** Kilometerzeiten in Reihenfolge; nur volle, lückenlose Abschnitte ab 900 m. */
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

/** Variationskoeffizient der Kilometerzeiten. */
function paceVariation(paces: number[]): number | undefined {
  if (paces.length < MIN_SEGMENTS) return undefined;
  const mean = paces.reduce((sum, pace) => sum + pace, 0) / paces.length;
  const variance =
    paces.reduce((sum, pace) => sum + (pace - mean) ** 2, 0) / paces.length;
  return Math.sqrt(variance) / mean;
}

/** Wie oft das Tempo zwischen deutlich schneller und deutlich langsamer umschlägt. */
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

/** `undefined`, wenn die Höhe unbekannt ist — dann ist auch „flach“ unbekannt. */
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

/** Vergleichsläufe, wenn der Lauf deutlich länger war als üblich; sonst `undefined`. */
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
 * Schlägt eine Laufart vor oder gibt `undefined` zurück, wenn die Daten keine
 * eindeutige Aussage tragen. `maxHeartRate` kommt aus `maxHeartRate()` in
 * insights.ts (eingestellt oder geschätzt).
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
  // Ohne Puls und ohne eigene Angabe fehlt jeder Hinweis auf die Absicht.
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
    // Tempowechsel nur bei bekannter flacher Strecke, ohne ruhige Anstrengung
    // und mit echtem Hin und Her. Alles andere bleibt ohne Vorschlag.
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

const SIGNAL_WORDS: Record<PurposeHintSignal, string> = {
  heart_rate_high: 'hoher Puls',
  heart_rate_low: 'niedriger Puls',
  breathing_hard: 'Atmung schwer',
  breathing_easy: 'Atmung leicht',
  pace_varied: 'Tempo stark wechselnd',
  pace_even: 'gleichmäßiges Tempo',
  longer_than_usual: 'länger als sonst',
};

/** Kurzer Grund für die Oberfläche, z. B. „niedriger Puls · länger als sonst“. */
export function purposeHintReason(hint: PurposeHint): string {
  return hint.signals.map(signal => SIGNAL_WORDS[signal]).join(' · ');
}

/** Was beim Bestätigen gespeichert wird: Ergebnis samt Spur (Grundregel 2). */
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
