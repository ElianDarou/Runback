import type {
  AnyRecommendation,
  Area,
  Experiment,
  Recommendation,
  StrengthRecommendation,
} from './types';
import { tr } from './i18n';

/**
 * Running and strength training are separate areas: own goal, own focus, and
 * at most one active recommendation each. This file defines how recommendations
 * map to their area and when a second recommendation could distort the test of
 * the first (coupling lock).
 */
export const COUPLING_GATE_VERSION = 'coupling-v2';
export const AREAS: readonly Area[] = ['running', 'strength'];
/** Visible name of an area in the active language. */
export function areaLabel(area: Area): string {
  return area === 'strength'
    ? tr('Krafttraining', 'Strength training')
    : tr('Laufen', 'Running');
}

/** Regions whose load can noticeably affect running results. */
const RUNNING_REGIONS = new Set([
  'hip_flexor',
  'glute',
  'quad',
  'hamstring',
  'adductor',
  'calf_gastroc',
  'calf_soleus',
  'tibialis',
]);

export function isRunRecommendation(
  recommendation: AnyRecommendation,
): recommendation is Recommendation {
  return recommendation.kind === 'calmer_start';
}
export function isStrengthRecommendation(
  recommendation: AnyRecommendation,
): recommendation is StrengthRecommendation {
  return recommendation.kind === 'strength_load';
}

/** Older recommendations without the field are running recommendations. */
export function recommendationArea(recommendation: AnyRecommendation): Area {
  return isStrengthRecommendation(recommendation) ? 'strength' : 'running';
}

export function isOpen(experiment: Experiment): boolean {
  return experiment.status === 'active' || experiment.status === 'paused';
}

export function activeExperimentFor(
  experiments: Experiment[] | undefined,
  area: 'running',
): Experiment<Recommendation> | undefined;
export function activeExperimentFor(
  experiments: Experiment[] | undefined,
  area: 'strength',
): Experiment<StrengthRecommendation> | undefined;
export function activeExperimentFor(
  experiments: Experiment[] | undefined,
  area: Area,
): Experiment | undefined {
  return experiments?.find(
    item => isOpen(item) && recommendationArea(item.recommendation) === area,
  );
}

/**
 * Which other areas a recommendation can influence. A calmer start changes no
 * load; a load recommendation for the legs affects runs.
 */
export function influencedAreas(recommendation: AnyRecommendation): Area[] {
  if (isStrengthRecommendation(recommendation)) {
    // Without known regions, a coupling with running cannot be ruled out.
    return !recommendation.regions.length || recommendation.regions.some(region => RUNNING_REGIONS.has(region))
      ? ['running']
      : [];
  }
  return [];
}

/**
 * Coupling lock: a second recommendation must not run in parallel if it can
 * influence the first one's target, or the first one can influence its own.
 * It then stays "Up next".
 */
export function couplingGate(
  candidate: AnyRecommendation,
  activeOthers: Experiment[],
): { blocked?: string; modelVersion: string } {
  const area = recommendationArea(candidate);
  for (const other of activeOthers) {
    if (!isOpen(other)) continue;
    const otherArea = recommendationArea(other.recommendation);
    if (otherArea === area) continue;
    if (influencedAreas(candidate).includes(otherArea)) {
      return {
        modelVersion: COUPLING_GATE_VERSION,
        blocked: tr(
          `Könnte die laufende Prüfung im Bereich ${areaLabel(otherArea)} verfälschen. Erst danach.`,
          `Could distort the running test in the ${areaLabel(otherArea)} area. Only after that.`,
        ),
      };
    }
    if (influencedAreas(other.recommendation).includes(area)) {
      return {
        modelVersion: COUPLING_GATE_VERSION,
        blocked: tr(
          `Deine laufende Empfehlung im Bereich ${areaLabel(otherArea)} kann dieses Ergebnis beeinflussen. Erst danach.`,
          `Your running recommendation in the ${areaLabel(otherArea)} area can affect this result. Only after that.`,
        ),
      };
    }
  }
  return { modelVersion: COUPLING_GATE_VERSION };
}
