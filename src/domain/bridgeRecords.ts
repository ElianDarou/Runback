import type { Run } from './trainingRecords';
import { applyStrengthEndCorrection } from './endCorrection';
import { normalizePurpose } from './runTitle';
import { normalizeRunTarget } from './runTarget';
import { normalizeSport } from './sport';
import type { StrengthSession, StrengthState } from './strength';
import { importedStrengthSession } from './strengthImports';
import type { StrongWorkout } from './vendorImports';

/**
 * Reads the records Kotlin delivers over the bridge. Your own server gets the
 * same records and reads them with the same functions, so the app and the
 * website show the same numbers.
 */

export function normalizeRun(raw: any): Run {
  const feedback = raw.feedback || {};
  return {
    ...raw,
    startTime: raw.startTime ?? raw.startedAt ?? 0,
    endTime: raw.endTime ?? raw.endedAt ?? 0,
    durationSeconds:
      raw.durationSeconds ?? raw.durationSec ?? (raw.elapsedMs || 0) / 1000,
    distanceMeters: raw.distanceMeters ?? raw.distanceM ?? 0,
    source: raw.source || 'phone',
    purpose: normalizePurpose(feedback.purpose ?? raw.purpose),
    purposeConfirmed: feedback.purposeConfirmed === true,
    purposeHint:
      feedback.purposeHint && typeof feedback.purposeHint === 'object'
        ? feedback.purposeHint
        : undefined,
    sport: normalizeSport(feedback.sport ?? raw.sport),
    samples: raw.samples ?? raw.rawSampleCount ?? 0,
    sourceVersion: raw.sourceVersion || 'native-v1',
    rpe: raw.rpe ?? feedback.rpe,
    note: raw.note ?? feedback.note,
    route: raw.route ?? raw.geometry,
    target: raw.target ? normalizeRunTarget(raw.target) : undefined,
  };
}

/** Missing fields give an empty, usable state instead of an error. */
export function normalizeStrength(raw: any): StrengthState {
  return {
    templates: Array.isArray(raw?.templates) ? raw.templates : [],
    active:
      raw?.active && raw.active.id ? (raw.active as StrengthSession) : null,
    history: Array.isArray(raw?.history) ? raw.history : [],
  };
}

/** A session from Runback or an import, each with its corrected end. */
export function strengthSessionFromBridge(raw: any): StrengthSession {
  return raw?.kind === 'strength'
    ? applyStrengthEndCorrection(raw, raw.endCorrection)
    : importedStrengthSession(raw);
}

/**
 * Own sessions and imports as one list, newest first. If a session exists
 * twice, the one recorded in Runback counts.
 */
export function mergeStrengthSessions(
  sessions: unknown[],
  imports: unknown[],
  limit: number,
): StrengthSession[] {
  const unique = new Map<string, StrengthSession>(
    (sessions as StrengthSession[]).map(session => [
      session.id,
      applyStrengthEndCorrection(session, (session as any).endCorrection),
    ]),
  );
  (imports as StrongWorkout[]).forEach(workout => {
    const session = importedStrengthSession(workout);
    if (!unique.has(session.id)) {
      unique.set(session.id, session);
    }
  });
  return Array.from(unique.values())
    .sort((a, b) => b.startTime - a.startTime || b.id.localeCompare(a.id))
    .slice(0, Math.max(1, limit));
}
