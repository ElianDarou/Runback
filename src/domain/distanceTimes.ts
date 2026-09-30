import type { Run } from '../native';
import { validRun } from './statistics';
import { medianOrNull } from './inference';
import {
  HALF_MARATHON_KM,
  MARATHON_KM,
  riegelSeconds,
  REFERENCE_WINDOW_DAYS,
} from './raceGoal';

export const DISTANCE_TIMES_VERSION =
  'distance-times-riegel-median-v1' as const;
export const STANDARD_DISTANCES = [
  1,
  2,
  5,
  10,
  HALF_MARATHON_KM,
  MARATHON_KM,
] as const;

export interface DistanceTime {
  version: typeof DISTANCE_TIMES_VERSION;
  distanceKm: number;
  estimatedSeconds?: number;
  sourceRunIds: string[];
  /** Tatsächliche Aufzeichnungszeiten von Läufen innerhalb von 2 % der Strecke. */
  history: Run[];
}

/** Neutrale Hochrechnung, keine neue Trainingsempfehlung; Originalzeiten bleiben sichtbar.
 * Riegel (1981): https://pubmed.ncbi.nlm.nih.gov/7235349/
 * Der Median der letzten acht passenden Läufe begrenzt den Einfluss einzelner Ausreißer.
 */
export function distanceTime(
  runs: Run[],
  distanceKm: number,
  now: number,
): DistanceTime {
  const base: DistanceTime = {
    version: DISTANCE_TIMES_VERSION,
    distanceKm,
    sourceRunIds: [],
    history: [],
  };
  if (!Number.isFinite(distanceKm) || distanceKm <= 0 || !Number.isFinite(now))
    return base;
  const seen = new Set<string>();
  const unique = runs
    .filter(
      run =>
        validRun(run, now) && run.distanceMeters > 0 && run.durationSeconds > 0,
    )
    .sort((a, b) => b.startTime - a.startTime || a.id.localeCompare(b.id))
    .filter(run => {
      const id = run.canonicalId || run.id;
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    });
  const history = unique.filter(
    run =>
      Math.abs(run.distanceMeters / 1000 - distanceKm) <= distanceKm * 0.02,
  );
  const sources = unique
    .filter(
      run =>
        run.startTime >= now - REFERENCE_WINDOW_DAYS * 86400000 &&
        run.distanceMeters / 1000 >= Math.max(0.8, distanceKm * 0.25) &&
        run.distanceMeters / 1000 <= distanceKm * 4,
    )
    .slice(0, 8);
  const seconds = medianOrNull(
    sources.map(run =>
      riegelSeconds(run.durationSeconds, run.distanceMeters / 1000, distanceKm),
    ),
  );
  return {
    ...base,
    history,
    sourceRunIds: sources.map(run => run.id),
    estimatedSeconds:
      sources.length >= 3 && seconds !== null ? Math.round(seconds) : undefined,
  };
}
