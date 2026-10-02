import type { RunPurpose } from './types';
import {
  normalizeRunAnnouncements,
  type RunAnnouncements,
} from './runAnnouncements';

export const RUN_TARGET_VERSION = 2 as const;

export type RunTargetOutput = 'voice' | 'vibration' | 'both';

export type RunTarget = {
  cueIntervalSeconds?: number;
  announcements?: RunAnnouncements;
} & (
  | { kind: 'none'; version: 1 | typeof RUN_TARGET_VERSION }
  | {
      kind: 'pace';
      version: 1 | typeof RUN_TARGET_VERSION;
      secondsPerKm: number;
      mode: 'ceiling' | 'range';
      output: RunTargetOutput;
    }
  | {
      kind: 'heart_rate';
      version: 1 | typeof RUN_TARGET_VERSION;
      minBpm: number;
      maxBpm: number;
      output: RunTargetOutput;
    }
);

export const NO_RUN_TARGET: RunTarget = {
  kind: 'none',
  version: RUN_TARGET_VERSION,
};

const validOutput = (value: unknown): value is RunTargetOutput =>
  value === 'voice' || value === 'vibration' || value === 'both';

/** Alte oder unvollständige Einstellungen aktivieren niemals still Hinweise. */
export function normalizeRunTarget(value: unknown): RunTarget {
  if (!value || typeof value !== 'object') return NO_RUN_TARGET;
  const raw = value as Record<string, unknown>;
  if (raw.version !== 1 && raw.version !== RUN_TARGET_VERSION)
    return NO_RUN_TARGET;
  const cueIntervalSeconds = raw.cueIntervalSeconds ?? 30;
  if (
    typeof cueIntervalSeconds !== 'number' ||
    !Number.isInteger(cueIntervalSeconds) ||
    cueIntervalSeconds < 5 ||
    cueIntervalSeconds > 300
  )
    return NO_RUN_TARGET;
  const extra = {
    cueIntervalSeconds,
    ...(raw.announcements === undefined
      ? {}
      : { announcements: normalizeRunAnnouncements(raw.announcements) }),
  };
  if (raw.kind === 'none')
    return { ...NO_RUN_TARGET, version: raw.version, ...extra };
  if (raw.kind === 'pace') {
    const secondsPerKm = Number(raw.secondsPerKm);
    if (
      Number.isFinite(secondsPerKm) &&
      secondsPerKm >= 120 &&
      secondsPerKm <= 1200 &&
      (raw.mode === 'ceiling' || raw.mode === 'range') &&
      validOutput(raw.output)
    ) {
      return {
        ...extra,
        kind: 'pace',
        version: raw.version,
        secondsPerKm,
        mode: raw.mode,
        output: raw.output,
      };
    }
  }
  if (raw.kind === 'heart_rate') {
    const minBpm = Number(raw.minBpm);
    const maxBpm = Number(raw.maxBpm);
    if (
      Number.isFinite(minBpm) &&
      Number.isFinite(maxBpm) &&
      minBpm >= 40 &&
      maxBpm <= 240 &&
      maxBpm - minBpm >= 5 &&
      validOutput(raw.output)
    ) {
      return {
        ...extra,
        kind: 'heart_rate',
        version: raw.version,
        minBpm,
        maxBpm,
        output: raw.output,
      };
    }
  }
  return NO_RUN_TARGET;
}

export function parsePaceInput(value: string): number | null {
  const match = value.trim().match(/^(\d{1,2}):([0-5]\d)$/);
  if (!match) return null;
  const seconds = Number(match[1]) * 60 + Number(match[2]);
  return seconds >= 120 && seconds <= 1200 ? seconds : null;
}

/** Schrittweite der Plus-/Minus-Tasten für das Zieltempo während des Laufs. */
export const PACE_STEP_SECONDS = 5;

/**
 * Nächstes Zieltempo nach einem Tastendruck: `+1` erhöht die Zahl (langsamer),
 * `-1` senkt sie (schneller). Außerhalb des gültigen Bereichs gibt es keinen
 * Schritt; ein krummer Wert rastet auf das nächste 5-Sekunden-Raster ein.
 */
export function stepTargetPace(
  secondsPerKm: number,
  direction: 1 | -1,
): number | null {
  if (!Number.isFinite(secondsPerKm)) return null;
  const snapped =
    direction > 0
      ? Math.floor(secondsPerKm / PACE_STEP_SECONDS) * PACE_STEP_SECONDS
      : Math.ceil(secondsPerKm / PACE_STEP_SECONDS) * PACE_STEP_SECONDS;
  const next = snapped + direction * PACE_STEP_SECONDS;
  return next >= 120 && next <= 1200 ? next : null;
}

export function formatTargetPace(seconds: number): string {
  const rounded = Math.round(seconds);
  return `${Math.floor(rounded / 60)}:${String(rounded % 60).padStart(
    2,
    '0',
  )} /km`;
}

export function runTargetLabel(target: RunTarget): string {
  if (target.kind === 'pace') {
    return target.mode === 'ceiling'
      ? `Nicht schneller als ${formatTargetPace(target.secondsPerKm)}`
      : formatTargetPace(target.secondsPerKm);
  }
  if (target.kind === 'heart_rate') {
    return `${target.minBpm}–${target.maxBpm} bpm`;
  }
  return 'Ohne Ziel';
}

/** Locker und lang bleiben Obergrenzen; ein Pacemaker darf den Zweck nicht verdrängen. */
export function targetForPurpose(
  target: RunTarget,
  purpose: RunPurpose,
): RunTarget {
  if (target.kind !== 'pace') return target;
  return {
    ...target,
    mode: purpose === 'easy' || purpose === 'long' ? 'ceiling' : 'range',
  };
}
