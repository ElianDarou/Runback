import type { RunPurpose, RunSummary } from './types';
import { isAccidentalRun, isRun } from './sport';

/**
 * Vorschlag der Laufart nach dem Lauf. Er ist nur Vorschau: Erst wenn der
 * Nutzer ihn bestätigt, wird die Laufart gespeichert (mit dieser Version).
 *
 * Die Absicht steckt nicht im Tempo allein — wer jeden Tag dieselbe Runde auf
 * Zeit läuft, ist im Vergleich zu sich selbst nie „schneller als sonst“.
 * Deshalb entscheidet die Anstrengung (Puls gegen Maxpuls, sonst die eigene
 * Angabe zur Atmung). Fehlt beides oder widerspricht es sich, gibt es keinen
 * Vorschlag statt einer Vermutung.
 */
export const PURPOSE_HINT_VERSION = 'runback-purpose-hint-1';

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
/** Ab hier gilt eine Strecke als hügelig; Tempowechsel wäre dann nicht unterscheidbar. */
const HILLY_GAIN_SHARE = 0.02;
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
}

type Intensity = 'hard' | 'easy';

const finite = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function heartRateIntensity(
  run: RunSummary,
  maxHeartRate: number | undefined,
): Intensity | undefined {
  if (
    !finite(maxHeartRate) ||
    !finite(run.avgHeartRate) ||
    !finite(run.heartRateCoverage) ||
    run.heartRateCoverage < MIN_HEART_RATE_COVERAGE
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

/** Variationskoeffizient der Kilometerzeiten; nur volle, lückenlose Abschnitte ab 900 m. */
function paceVariation(run: RunSummary): number | undefined {
  const paces = (run.segments ?? [])
    .filter(
      segment =>
        segment.distanceMeters >= 900 &&
        segment.durationSeconds > 0 &&
        (segment.gapSeconds ?? 0) < 5,
    )
    .map(segment => segment.durationSeconds / (segment.distanceMeters / 1000));
  if (paces.length < MIN_SEGMENTS) return undefined;
  const mean = paces.reduce((sum, pace) => sum + pace, 0) / paces.length;
  const variance =
    paces.reduce((sum, pace) => sum + (pace - mean) ** 2, 0) / paces.length;
  return Math.sqrt(variance) / mean;
}

function hilly(run: RunSummary): boolean {
  return (
    finite(run.elevationGainMeters) &&
    run.distanceMeters > 0 &&
    run.elevationGainMeters / run.distanceMeters > HILLY_GAIN_SHARE
  );
}

function longerThanUsual(run: RunSummary, history: RunSummary[]): boolean {
  if (run.distanceMeters < LONG_MIN_METERS) return false;
  const distances = history
    .filter(
      other =>
        other.id !== run.id &&
        isRun(other) &&
        !isAccidentalRun(other) &&
        other.startTime < run.startTime &&
        run.startTime - other.startTime <= LONG_HISTORY_DAYS * DAY &&
        other.distanceMeters > 0,
    )
    .map(other => other.distanceMeters);
  if (distances.length < LONG_HISTORY_MIN_RUNS) return false;
  return run.distanceMeters >= median(distances) * LONG_FACTOR;
}

/**
 * Schlägt eine Laufart vor oder gibt `undefined` zurück, wenn die Daten keine
 * eindeutige Aussage tragen. `maxHeartRate` kommt aus `maxHeartRate()` in
 * insights.ts (eingestellt oder geschätzt).
 */
export function suggestRunPurpose(
  run: RunSummary,
  history: RunSummary[],
  maxHeartRate: number | undefined,
): PurposeHint | undefined {
  if (!isRun(run) || isAccidentalRun(run) || run.distanceMeters < 1000) {
    return undefined;
  }
  const fromHeart = heartRateIntensity(run, maxHeartRate);
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
  const variation = paceVariation(run);
  const varied =
    variation !== undefined && variation >= INTERVAL_PACE_VARIATION;
  const hint = (purpose: PurposeHint['purpose']): PurposeHint => ({
    purpose,
    signals,
    model_version: PURPOSE_HINT_VERSION,
  });

  if (varied) {
    // Auf hügeliger Strecke schwankt das Tempo ohnehin; ruhig und wechselnd
    // widerspricht sich. Beides bleibt ohne Vorschlag.
    if (hilly(run) || intensity === 'easy') return undefined;
    signals.push('pace_varied');
    return hint('intervals');
  }
  if (!intensity) return undefined;
  if (variation !== undefined) signals.push('pace_even');
  if (intensity === 'hard') return hint('race');
  if (longerThanUsual(run, history)) {
    signals.push('longer_than_usual');
    return hint('long');
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
