import type { Run } from './trainingRecords';
import { validRun } from './statistics';
import {
  HALF_MARATHON_KM,
  MARATHON_KM,
  riegelSeconds,
  REFERENCE_WINDOW_DAYS,
} from './raceGoal';

export const DISTANCE_TIMES_VERSION =
  'distance-times-riegel-recent-v2' as const;
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
  /** Actual recorded times of runs within 2 % of the distance. */
  history: Run[];
}

/** Neutral projection, not a new training recommendation; original times stay visible.
 * Riegel (1981): https://pubmed.ncbi.nlm.nih.gov/7235349/
 * Weighted median: the newest three runs count 3, 2 and 1.5; after that the
 * weight halves (1/2, 1/4, …). Old runs do not outvote them.
 * The last actually run matching distance caps the estimate from above,
 * without turning it into a guarantee or a lasting personal best.
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
        run.distanceMeters / 1000 >= Math.max(0.8, distanceKm * 0.25),
    )
    .slice(0, 8);
  const projections = sources.map((run, index) => ({
    run,
    seconds: riegelSeconds(
      run.durationSeconds,
      run.distanceMeters / 1000,
      distanceKm,
    ),
    weight: index < 3 ? [3, 2, 1.5][index] : 2 ** (2 - index),
  }));
  const halfWeight =
    projections.reduce((sum, item) => sum + item.weight, 0) / 2;
  let cumulativeWeight = 0;
  const middle = [...projections]
    .sort((a, b) => a.seconds - b.seconds)
    .find(item => {
      cumulativeWeight += item.weight;
      return cumulativeWeight >= halfWeight;
    });
  // Only a recent observation of the same distance caps the estimate;
  // a projection from another distance is not a reached value.
  const latestActual = projections.find(item => history.includes(item.run));
  const seconds = middle
    ? Math.min(middle.seconds, latestActual?.seconds ?? middle.seconds)
    : undefined;
  return {
    ...base,
    history,
    sourceRunIds: sources.map(run => run.id),
    estimatedSeconds:
      sources.length >= 3 && seconds !== undefined
        ? Math.round(seconds)
        : undefined,
  };
}
