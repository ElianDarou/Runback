import { metricLabel, type SeriesMetric } from '../../../src/domain/runSeries';
import { purposeLabel } from '../../../src/domain/runTitle';
import {
  focusLabel,
  focusTypeLabel,
  type FocusKind,
  type TrainingFocus,
} from '../../../src/domain/focus';
import { normalizeSport, sportLabel } from '../../../src/domain/sport';
import type { RunPurpose, Sport } from '../../../src/domain/types';
import type { Translator } from './i18n';

/**
 * English names for labels that the domain builds in the app's language. The
 * server never sets that language, so the German comes from the domain as the
 * first argument of `tx.t`, and the English comes from the maps here.
 */

const METRIC_EN: Record<SeriesMetric, string> = {
  pace: 'Pace',
  heartRate: 'Heart rate',
  elevation: 'Elevation',
  cadence: 'Cadence',
  armSwing: 'Arm swing',
  wind: 'Wind',
};

export const metricName = (tx: Translator, metric: SeriesMetric) =>
  tx.t(metricLabel(metric), METRIC_EN[metric]);

const SPORT_EN: Record<Sport, string> = {
  running: 'Running',
  cycling: 'Cycling',
};

export const sportName = (tx: Translator, sport: Sport | undefined) =>
  tx.t(sportLabel(sport), SPORT_EN[normalizeSport(sport)]);

const PURPOSE_EN: Record<RunPurpose, string> = {
  free: 'Just run',
  easy: 'Easy',
  long: 'Long run',
  intervals: 'Pace changes',
  race: 'Against the clock',
  unknown: 'Not set yet',
};

export const purposeName = (tx: Translator, value: RunPurpose | undefined) =>
  tx.t(purposeLabel(value), (value && PURPOSE_EN[value]) || 'Run');

const FOCUS_EN: Partial<Record<FocusKind, string>> = {
  endurance: 'Build endurance',
  speed: 'Get faster',
  injury_free: 'Stay injury-free',
  habit: 'Build a habit',
  fitness: 'General fitness',
  strength: 'Get stronger',
  muscle: 'Build muscle',
};

/** The focus as the user sees it: their own label, else the type name. */
export function focusName(tx: Translator, focus: TrainingFocus): string {
  if (tx.lang === 'de') return focusLabel(focus);
  return (
    focus.label || FOCUS_EN[focus.kind] || focusTypeLabel(focus.kind) || ''
  );
}

const RANGE_EN: Record<string, string> = {
  '4w': '4 weeks',
  '12w': '12 weeks',
  '1y': '1 year',
  all: 'All',
};

/** Name of a statistics range; `de` is the domain's German label. */
export const rangeName = (tx: Translator, value: string, de: string) =>
  tx.t(de, RANGE_EN[value] ?? value);

const COMPARISON_EN: Record<string, string> = {
  '4w': 'the 4 weeks before',
  '12w': 'the 12 weeks before',
  '1y': 'the year before',
  all: 'the period before',
};

/** Phrase for the period an arrow compares with, e.g. “the 4 weeks before”. */
export const comparisonName = (tx: Translator, value: string, de: string) =>
  tx.t(de, COMPARISON_EN[value] ?? value);
