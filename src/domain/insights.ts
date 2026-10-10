import type {
  MovementPhase,
  PacingAnalysis,
  RunSummary,
  SegmentAggregate,
} from './types';
import type { RunSeries, SeriesRow } from './runSeries';
import { formatPace } from './runSeries';
import { segmentIsFlat } from './analysis';
import { fixed, percentSign, tr } from './i18n';
import { comparablePurpose, samePurpose } from './runTitle';

/**
 * Deeper insights into a single run for the detail page. Everything here is
 * derived from aggregates (time budget, phases, segments) and the display
 * series — no raw samples, no recommendation, no fitness rating. Where a model
 * computes (grade, wind, heat, zones), the output marks it as an estimate, and
 * without a basis there is `undefined` instead of an invented number (ground
 * rules 5 and 7).
 *
 * Verdict strings such as `'unclear'` or `'efficient'` are stable keys that
 * the UI compares against. Show them through the `…Label()` functions.
 */
// 2: old long runs compare with easy runs, old "just run" with all runs.
export const INSIGHTS_VERSION = 'runback-insights-2';

const DAY = 24 * 60 * 60 * 1000;
/** Comparison window for "your recent runs" and the heart rate–pace curve. */
export const RECENT_WINDOW_DAYS = 120;
export const RECENT_MAX_RUNS = 8;
export const RECENT_MIN_RUNS = 3;

const finite = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);
const median = (values: number[]): number | undefined => {
  if (!values.length) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};
const mean = (values: number[]): number | undefined =>
  values.length
    ? values.reduce((sum, value) => sum + value, 0) / values.length
    : undefined;
const percent = (value: number, reference: number): number =>
  (value / reference - 1) * 100;
const isRunning = (run: RunSummary) => (run.sport ?? 'running') === 'running';

/** Moving time, otherwise recorded time; undefined without reliable time. */
export function movingSeconds(run: RunSummary): number | undefined {
  const seconds = run.time?.movingSeconds ?? run.durationSeconds;
  return finite(seconds) && seconds > 0 ? seconds : undefined;
}
function paceSecondsPerKm(run: RunSummary): number | undefined {
  const seconds = movingSeconds(run);
  return seconds !== undefined && run.distanceMeters >= 500
    ? seconds / (run.distanceMeters / 1000)
    : undefined;
}

// ---------------------------------------------------------------------------
// Movement: time budget, longest stretch, changes, heart rate per state
// ---------------------------------------------------------------------------

export interface TimeBudgetShares {
  runningSeconds: number;
  walkingSeconds: number;
  stoppedSeconds: number;
  pausedSeconds: number;
  /** Base of the bar: running + walking + standing (no pauses, no unknown). */
  totalSeconds: number;
}
/** Three shares for the bar. Undefined without a time budget (old data, imports). */
export function timeBudgetShares(
  run: RunSummary,
): TimeBudgetShares | undefined {
  const t = run.time;
  if (!t) return undefined;
  const totalSeconds = t.runningSeconds + t.walkingSeconds + t.stoppedSeconds;
  if (!finite(totalSeconds) || totalSeconds <= 0) return undefined;
  return {
    runningSeconds: t.runningSeconds,
    walkingSeconds: t.walkingSeconds,
    stoppedSeconds: t.stoppedSeconds,
    pausedSeconds: t.pausedSeconds,
    totalSeconds,
  };
}

export interface MovementInsight {
  longestRunMeters?: number;
  longestRunSeconds?: number;
  runWalkTransitions: number;
  runningHeartRate?: number;
  walkingHeartRate?: number;
}
export function movementInsight(run: RunSummary): MovementInsight | undefined {
  const m = run.phaseMetrics;
  if (!m) return undefined;
  return {
    longestRunMeters: m.longestRunMeters,
    longestRunSeconds: m.longestRunSeconds,
    runWalkTransitions: m.runWalkTransitions,
    runningHeartRate: m.running.avgHeartRate,
    walkingHeartRate:
      m.walking.seconds >= 30 ? m.walking.avgHeartRate : undefined,
  };
}

// ---------------------------------------------------------------------------
// Heart rate: recovery during walk breaks and after the end
// ---------------------------------------------------------------------------

function heartRateAt(
  rows: SeriesRow[],
  elapsedSeconds: number,
  toleranceSeconds: number,
): number | undefined {
  const values = rows
    .filter(
      row =>
        row.heartRate !== undefined &&
        Math.abs(row.elapsedSeconds - elapsedSeconds) <= toleranceSeconds,
    )
    .map(row => row.heartRate!);
  return mean(values);
}

export interface WalkRecovery {
  /** Walk breaks from 60 s after a run stretch, with heart rate at both ends. */
  pauses: number;
  /** Median heart rate drop in the first minute per break (bpm). */
  dropFirstMinute: number;
  /** Lowest heart rate within the scored breaks. */
  lowestHeartRate?: number;
}
/**
 * How fast the heart rate settles while walking. Only walk phases of at least
 * 60 s directly after a run phase count; the drop is the heart rate at the
 * start of the break minus the heart rate 60 s later.
 */
export function walkRecovery(
  run: RunSummary,
  series: RunSeries | null,
): WalkRecovery | undefined {
  if (!series || !run.phases?.length) return undefined;
  const rows = series.rows;
  const tolerance = Math.max(series.stepSeconds, 5);
  const drops: number[] = [];
  let lowest: number | undefined;
  run.phases.forEach((phase, index) => {
    const previous = run.phases![index - 1];
    if (
      phase.state !== 'WALK' ||
      previous?.state !== 'RUN' ||
      phase.endElapsedSeconds - phase.startElapsedSeconds < 60
    )
      return;
    const start = heartRateAt(rows, phase.startElapsedSeconds, tolerance);
    const later = heartRateAt(rows, phase.startElapsedSeconds + 60, tolerance);
    if (start === undefined || later === undefined) return;
    drops.push(start - later);
    rows
      .filter(
        row =>
          row.heartRate !== undefined &&
          row.elapsedSeconds >= phase.startElapsedSeconds &&
          row.elapsedSeconds <= phase.endElapsedSeconds,
      )
      .forEach(row => {
        lowest =
          lowest === undefined
            ? row.heartRate
            : Math.min(lowest, row.heartRate!);
      });
  });
  const drop = median(drops);
  if (drop === undefined) return undefined;
  return {
    pauses: drops.length,
    dropFirstMinute: drop,
    lowestHeartRate: lowest,
  };
}

export interface EndRecovery {
  /** Heart rate drop in the first minute after the last run stretch (bpm). */
  dropFirstMinute: number;
  heartRateAtEnd: number;
}
/**
 * Recovery after the end: heart rate at the end of the last run phase minus the
 * heart rate 60 s later. Needs at least 60 s of recording afterwards with heart
 * rate values.
 */
export function endRecovery(
  run: RunSummary,
  series: RunSeries | null,
): EndRecovery | undefined {
  if (!series || !run.phases?.length) return undefined;
  const lastRun = [...run.phases].reverse().find(p => p.state === 'RUN');
  if (!lastRun) return undefined;
  const after = run.phases.filter(
    p =>
      p.startElapsedSeconds >= lastRun.endElapsedSeconds && p.state !== 'RUN',
  );
  const trailing = after.reduce(
    (sum, p) => sum + (p.endElapsedSeconds - p.startElapsedSeconds),
    0,
  );
  if (trailing < 60) return undefined;
  const tolerance = Math.max(series.stepSeconds, 5);
  const atEnd = heartRateAt(series.rows, lastRun.endElapsedSeconds, tolerance);
  const later = heartRateAt(
    series.rows,
    lastRun.endElapsedSeconds + 60,
    tolerance,
  );
  if (atEnd === undefined || later === undefined) return undefined;
  return { dropFirstMinute: atEnd - later, heartRateAtEnd: atEnd };
}

// ---------------------------------------------------------------------------
// Pacing: split, evenness, fastest/slowest km, drift, GAP
// ---------------------------------------------------------------------------

export type SplitKind = 'negative' | 'positive' | 'even';
/** Stable keys; show them through `evennessLabel()`. */
export type Evenness = 'veryEven' | 'even' | 'uneven';
export interface PacingVerdict {
  split: SplitKind;
  fadePercent: number;
  coefficientOfVariation: number;
  evenness: Evenness;
  /** Index in the run's segment array, not in the km table. */
  fastestSegmentIndex?: number;
  slowestSegmentIndex?: number;
  fastestSecondsPerKm?: number;
  slowestSecondsPerKm?: number;
  sentence: string;
}
/** Only full, moving segments without a major GPS gap count as kilometers. */
function ratedSegments(run: RunSummary) {
  return (run.segments ?? [])
    .map((s, index) => ({ s, index }))
    .filter(
      ({ s }) =>
        s.distanceMeters >= 900 &&
        (s.gapSeconds ?? 0) < 5 &&
        (s.movingSeconds ?? s.durationSeconds) > 0 &&
        (!s.phase || s.phase === 'work'),
    );
}
const segmentPace = (s: SegmentAggregate) =>
  ((s.movingSeconds ?? s.durationSeconds) / s.distanceMeters) * 1000;

/** Label for the evenness of a pace profile. */
export function evennessLabel(evenness: Evenness): string {
  return {
    veryEven: tr('sehr gleichmäßig', 'very even'),
    even: tr('gleichmäßig', 'even'),
    uneven: tr('wechselhaft', 'uneven'),
  }[evenness];
}

export function pacingVerdict(
  pacing: PacingAnalysis | undefined,
  run: RunSummary,
): PacingVerdict | undefined {
  if (!pacing) return undefined;
  const split: SplitKind =
    pacing.fadePercent <= -2
      ? 'negative'
      : pacing.fadePercent >= 2
      ? 'positive'
      : 'even';
  const cv = pacing.coefficientOfVariation;
  const evenness: Evenness =
    cv < 0.04 ? 'veryEven' : cv < 0.08 ? 'even' : 'uneven';
  const rated = ratedSegments(run);
  let fastest: { index: number; pace: number } | undefined;
  let slowest: { index: number; pace: number } | undefined;
  rated.forEach(({ s, index }) => {
    const pace = segmentPace(s);
    if (!fastest || pace < fastest.pace) fastest = { index, pace };
    if (!slowest || pace > slowest.pace) slowest = { index, pace };
  });
  const change = Math.abs(Math.round(pacing.fadePercent));
  const sentence =
    split === 'negative'
      ? tr(
          `Zweite Hälfte ${change} % schneller als die erste — ein Negativ-Split.`,
          `Second half ${change}% faster than the first — a negative split.`,
        )
      : split === 'positive'
      ? tr(
          `Zweite Hälfte ${change} % langsamer als die erste.`,
          `Second half ${change}% slower than the first.`,
        )
      : tr(
          'Beide Hälften gleich schnell.',
          'Both halves at the same pace.',
        );
  return {
    split,
    fadePercent: pacing.fadePercent,
    coefficientOfVariation: cv,
    evenness,
    fastestSegmentIndex: fastest?.index,
    slowestSegmentIndex: slowest?.index,
    fastestSecondsPerKm: fastest?.pace,
    slowestSecondsPerKm: slowest?.pace,
    sentence,
  };
}

export interface HeartRateDrift {
  /** Heart rate per speed, second half compared with the first, in %. */
  percent: number;
  /** Stable key; show it through `driftVerdictLabel()`. */
  verdict: 'solidAerobic' | 'slightDrift' | 'clearDrift';
  segmentCount: number;
}
/** Label for a heart rate drift verdict. */
export function driftVerdictLabel(verdict: HeartRateDrift['verdict']): string {
  return {
    solidAerobic: tr('aerob solide', 'aerobically solid'),
    slightDrift: tr('leichte Drift', 'slight drift'),
    clearDrift: tr('deutliche Drift', 'clear drift'),
  }[verdict];
}
/**
 * Heart rate drift (aerobic decoupling): ratio of heart rate to speed in the
 * second half compared with the first. The first kilometer is kept out as a
 * warm-up if four kilometers remain after it.
 */
export function heartRateDrift(run: RunSummary): HeartRateDrift | undefined {
  let rated = ratedSegments(run).filter(({ s }) => finite(s.avgHeartRate));
  if (rated.length >= 5) rated = rated.slice(1);
  if (rated.length < 4) return undefined;
  const half = Math.floor(rated.length / 2);
  const ratio = (items: typeof rated) => {
    const meters = items.reduce((sum, { s }) => sum + s.distanceMeters, 0);
    const seconds = items.reduce(
      (sum, { s }) => sum + (s.movingSeconds ?? s.durationSeconds),
      0,
    );
    const beats = items.reduce(
      (sum, { s }) =>
        sum + s.avgHeartRate! * ((s.movingSeconds ?? s.durationSeconds) / 60),
      0,
    );
    const hr = beats / (seconds / 60);
    return hr / (meters / seconds);
  };
  const first = ratio(rated.slice(0, half));
  const second = ratio(rated.slice(-half));
  const drift = percent(second, first);
  return {
    percent: drift,
    verdict:
      drift < 5 ? 'solidAerobic' : drift < 10 ? 'slightDrift' : 'clearDrift',
    segmentCount: rated.length,
  };
}

/** Meters per heartbeat while moving — comparable across runs. */
export function metersPerBeat(run: RunSummary): number | undefined {
  const seconds = movingSeconds(run);
  if (
    seconds === undefined ||
    !finite(run.avgHeartRate) ||
    run.avgHeartRate <= 0 ||
    run.distanceMeters < 500
  )
    return undefined;
  return run.distanceMeters / (run.avgHeartRate * (seconds / 60));
}

/**
 * Energy cost of running per gradient after Minetti et al. 2002 (J/kg/m),
 * `grade` as a fraction (0.05 = 5 %). Valid up to about ±30 %.
 */
export function minettiCost(grade: number): number {
  const i = Math.max(-0.3, Math.min(0.3, grade));
  return (
    155.4 * i ** 5 -
    30.4 * i ** 4 -
    43.3 * i ** 3 +
    46.3 * i ** 2 +
    19.5 * i +
    3.6
  );
}
export interface GradeAdjustedPace {
  realSecondsPerKm: number;
  adjustedSecondsPerKm: number;
  /** Flat equivalent per segment index; only segments with a grade. */
  perSegment: Record<number, number>;
  coveredMeters: number;
}
/**
 * Grade-adjusted pace: which pace the same effort would have produced on the
 * flat. An estimate with the net grade per segment; segments without a grade
 * value stay uncorrected and do not count as covered.
 */
export function gradeAdjustedPace(
  run: RunSummary,
): GradeAdjustedPace | undefined {
  const rated = ratedSegments(run).filter(({ s }) => finite(s.gradePercent));
  if (!rated.length) return undefined;
  const perSegment: Record<number, number> = {};
  let realSeconds = 0;
  let adjustedSeconds = 0;
  let meters = 0;
  rated.forEach(({ s, index }) => {
    const seconds = s.movingSeconds ?? s.durationSeconds;
    const factor = minettiCost(0) / minettiCost(s.gradePercent! / 100);
    perSegment[index] = segmentPace(s) * factor;
    realSeconds += seconds;
    adjustedSeconds += seconds * factor;
    meters += s.distanceMeters;
  });
  const total = (run.segments ?? []).reduce(
    (sum, s) => sum + s.distanceMeters,
    0,
  );
  // Without a grade on at least half the distance, the number is not the pace
  // of the run but only the pace of a section.
  if (total > 0 && meters / total < 0.5) return undefined;
  return {
    realSecondsPerKm: (realSeconds / meters) * 1000,
    adjustedSecondsPerKm: (adjustedSeconds / meters) * 1000,
    perSegment,
    coveredMeters: meters,
  };
}

// ---------------------------------------------------------------------------
// Heart rate zones with max heart rate from setting or estimate
// ---------------------------------------------------------------------------

export interface MaxHeartRate {
  value: number;
  source: 'setting' | 'estimate';
  /** Runs the estimate was based on (only for `estimate`). */
  runs?: number;
}
/**
 * Max heart rate: the setting wins. Otherwise the highest value from the peak
 * heart rates of recent runs, without the single largest value (an outlier from
 * a strap). With fewer than three runs with heart rate there is no estimate.
 */
export function maxHeartRate(
  setting: number | undefined,
  history: RunSummary[],
): MaxHeartRate | undefined {
  if (finite(setting) && setting >= 100 && setting <= 230)
    return { value: Math.round(setting), source: 'setting' };
  const peaks = history
    .filter(isRunning)
    .map(run => run.avgHeartRateMax)
    .filter((value): value is number => finite(value) && value > 100)
    .sort((a, b) => b - a);
  if (peaks.length < RECENT_MIN_RUNS) return undefined;
  return {
    value: Math.round(peaks[1]),
    source: 'estimate',
    runs: peaks.length,
  };
}

export interface HeartRateZone {
  zone: 1 | 2 | 3 | 4 | 5;
  label: string;
  fromPercent: number;
  seconds: number;
  share: number;
}
export interface HeartRateZones {
  max: MaxHeartRate;
  zones: HeartRateZone[];
  coveredSeconds: number;
}
const ZONES: { zone: 1 | 2 | 3 | 4 | 5; from: number }[] = [
  { zone: 1, from: 0 },
  { zone: 2, from: 60 },
  { zone: 3, from: 70 },
  { zone: 4, from: 80 },
  { zone: 5, from: 90 },
];
/** Label of a heart rate zone. */
export function heartRateZoneLabel(zone: HeartRateZone['zone']): string {
  return {
    1: tr('sehr locker', 'very easy'),
    2: tr('locker', 'easy'),
    3: tr('moderat', 'moderate'),
    4: tr('hart', 'hard'),
    5: tr('maximal', 'maximum'),
  }[zone];
}
/** Time in five zones as a share of max heart rate, from the display series. */
export function heartRateZones(
  series: RunSeries | null,
  max: MaxHeartRate | undefined,
): HeartRateZones | undefined {
  if (!series || !max) return undefined;
  const seconds = ZONES.map(() => 0);
  let covered = 0;
  series.rows.forEach(row => {
    if (row.heartRate === undefined) return;
    const share = (row.heartRate / max.value) * 100;
    let index = 0;
    ZONES.forEach((zone, i) => {
      if (share >= zone.from) index = i;
    });
    seconds[index] += series.stepSeconds;
    covered += series.stepSeconds;
  });
  if (covered < 120) return undefined;
  return {
    max,
    coveredSeconds: covered,
    zones: ZONES.map((zone, i) => ({
      zone: zone.zone,
      label: heartRateZoneLabel(zone.zone),
      fromPercent: zone.from,
      seconds: seconds[i],
      share: seconds[i] / covered,
    })),
  };
}

// ---------------------------------------------------------------------------
// Fatigue pattern: pace, heart rate, cadence, stride length – first vs. last third
// ---------------------------------------------------------------------------

export interface FatiguePattern {
  paceChangePercent?: number;
  heartRateChangePercent?: number;
  cadenceChangePercent?: number;
  strideChangePercent?: number;
  /** Stable keys; the sentence is the display text. */
  verdict: 'muscular' | 'circulation' | 'deliberate' | 'stable' | 'unclear';
  sentence: string;
}
/**
 * First against last third of the moving distance. Cadence and stride length
 * drop when the legs tire while the heart rate stays; if the heart rate rises
 * at the same pace, it was more likely circulation or heat.
 */
export function fatiguePattern(
  run: RunSummary,
  series: RunSeries | null,
): FatiguePattern | undefined {
  if (!series || run.distanceMeters < 3000) return undefined;
  const moving = series.rows.filter(
    row => row.moving && row.speedMps !== undefined && row.speedMps > 0.5,
  );
  if (moving.length < 30) return undefined;
  const third = Math.floor(moving.length / 3);
  const first = moving.slice(0, third);
  const last = moving.slice(-third);
  const stride = (row: SeriesRow) =>
    row.cadence !== undefined && row.cadence > 0 && row.speedMps !== undefined
      ? row.speedMps / (row.cadence / 60)
      : undefined;
  const change = (pick: (row: SeriesRow) => number | undefined) => {
    const a = mean(first.map(pick).filter(finite));
    const b = mean(last.map(pick).filter(finite));
    return a !== undefined && b !== undefined && a > 0
      ? percent(b, a)
      : undefined;
  };
  const speed = change(row => row.speedMps);
  const pace = speed === undefined ? undefined : -speed;
  const hr = change(row => row.heartRate);
  const cadence = change(row => row.cadence);
  const strideChange = change(stride);
  let verdict: FatiguePattern['verdict'] = 'unclear';
  let sentence = tr(
    'Zu wenig Werte für ein Ermüdungsmuster.',
    'Too few values for a fatigue pattern.',
  );
  const legsTired =
    (cadence !== undefined && cadence <= -3) ||
    (strideChange !== undefined && strideChange <= -4);
  if (pace !== undefined && hr !== undefined) {
    if (legsTired && hr <= 3) {
      verdict = 'muscular';
      sentence = tr(
        'Zum Ende sinken Kadenz oder Schrittlänge, der Puls bleibt — eher die Beine als der Kreislauf.',
        'Toward the end cadence or stride length drops while the heart rate holds — more the legs than circulation.',
      );
    } else if (hr >= 5 && Math.abs(pace) <= 3) {
      verdict = 'circulation';
      sentence = tr(
        'Gleiches Tempo, aber der Puls steigt zum Ende — eher Kreislauf oder Wärme als die Beine.',
        'Same pace, but the heart rate rises toward the end — more circulation or heat than legs.',
      );
    } else if (pace >= 5 && hr <= -2) {
      verdict = 'deliberate';
      sentence = tr(
        'Zum Ende langsamer und der Puls fällt — du hast bewusst rausgenommen.',
        'Slower toward the end and the heart rate falls — you eased off on purpose.',
      );
    } else if (Math.abs(pace) < 3 && hr < 5 && !legsTired) {
      verdict = 'stable';
      sentence = tr(
        'Tempo, Puls und Schritt bleiben bis zum Ende stabil.',
        'Pace, heart rate and stride stay steady to the end.',
      );
    } else {
      sentence = tr(
        'Kein eindeutiges Ermüdungsmuster.',
        'No clear fatigue pattern.',
      );
    }
  } else if (pace !== undefined && legsTired) {
    verdict = 'muscular';
    sentence = tr(
      'Zum Ende sinken Kadenz oder Schrittlänge — eher die Beine.',
      'Toward the end cadence or stride length drops — more the legs.',
    );
  }
  return {
    paceChangePercent: pace,
    heartRateChangePercent: hr,
    cadenceChangePercent: cadence,
    strideChangePercent: strideChange,
    verdict,
    sentence,
  };
}

// ---------------------------------------------------------------------------
// Conditions: weather, headwind segments, wind and heat costs
// ---------------------------------------------------------------------------

export interface WeatherInsight {
  temperatureC?: number;
  windMps?: number;
  windFromDeg?: number;
  /** Kilometers with noticeable headwind (≥ 1.5 m/s on average), as labels. */
  headwindKilometers: number[];
  tailwindKilometers: number[];
}
export function weatherInsight(
  run: RunSummary,
  series: RunSeries | null,
): WeatherInsight | undefined {
  const temperatureC = run.context?.temperatureC;
  const windMps = series?.wind?.mps ?? run.context?.windMps;
  if (!finite(temperatureC) && !finite(windMps)) return undefined;
  const headwindKilometers: number[] = [];
  const tailwindKilometers: number[] = [];
  if (series) {
    const byKm = new Map<number, number[]>();
    series.rows.forEach(row => {
      if (row.headwindMps === undefined || !row.moving) return;
      const km = Math.floor(row.distanceMeters / 1000) + 1;
      byKm.set(km, [...(byKm.get(km) ?? []), row.headwindMps]);
    });
    [...byKm.entries()]
      .sort((a, b) => a[0] - b[0])
      .forEach(([km, values]) => {
        const avg = mean(values)!;
        if (avg >= 1.5) headwindKilometers.push(km);
        else if (avg <= -1.5) tailwindKilometers.push(km);
      });
  }
  return {
    temperatureC,
    windMps,
    windFromDeg: series?.wind?.fromDeg,
    headwindKilometers,
    tailwindKilometers,
  };
}

/** Air drag per meter and kg at 1.2 kg/m³, CdA 0.45 m², 70 kg. */
const AIR_COST = (0.5 * 1.2 * 0.45) / 70;
/** Speed in still air at the same power as `speed` against `headwind`. */
function stillAirSpeed(speed: number, headwind: number): number {
  const power =
    (minettiCost(0) + AIR_COST * Math.max(speed + headwind, 0) ** 2) * speed;
  let low = 0.5;
  let high = 12;
  for (let i = 0; i < 40; i += 1) {
    const mid = (low + high) / 2;
    const p = (minettiCost(0) + AIR_COST * mid ** 2) * mid;
    if (p < power) low = mid;
    else high = mid;
  }
  return (low + high) / 2;
}
export interface EnvironmentCost {
  /** Seconds per km that the wind cost (positive) or gave (negative). */
  windSecondsPerKm?: number;
  /** Share of the moving distance with a wind value. */
  windCoverage?: number;
  /** Seconds per km above the 15 °C heat threshold (0.3 % per degree). */
  heatSecondsPerKm?: number;
}
/** Rough estimate of how wind and heat changed the pace. */
export function environmentCost(
  run: RunSummary,
  series: RunSeries | null,
): EnvironmentCost | undefined {
  const result: EnvironmentCost = {};
  if (series) {
    let deltaSeconds = 0;
    let coveredMeters = 0;
    let movingMeters = 0;
    series.rows.forEach(row => {
      if (!row.moving || row.speedMps === undefined || row.speedMps <= 0.5)
        return;
      const meters = row.speedMps * series.stepSeconds;
      movingMeters += meters;
      if (row.headwindMps === undefined) return;
      const still = stillAirSpeed(row.speedMps, row.headwindMps);
      deltaSeconds += meters / row.speedMps - meters / still;
      coveredMeters += meters;
    });
    if (coveredMeters >= 1000 && movingMeters > 0) {
      result.windSecondsPerKm = deltaSeconds / (coveredMeters / 1000);
      result.windCoverage = coveredMeters / movingMeters;
    }
  }
  const pace = paceSecondsPerKm(run);
  const temperature = run.context?.temperatureC;
  if (pace !== undefined && finite(temperature) && temperature > 15) {
    result.heatSecondsPerKm = pace * (1 - 1 / (1 + 0.003 * (temperature - 15)));
  }
  return result.windSecondsPerKm === undefined &&
    result.heatSecondsPerKm === undefined
    ? undefined
    : result;
}

// ---------------------------------------------------------------------------
// Comparison with yourself: recent runs, same route, heart rate–pace curve
// ---------------------------------------------------------------------------

export type Rating = 'better' | 'same' | 'slightly_worse' | 'worse';
export type ComparedMetric =
  | 'pace'
  | 'heartRate'
  | 'metersPerBeat'
  | 'cadence'
  | 'drift'
  | 'fade';
export interface MetricComparison {
  metric: ComparedMetric;
  value: number;
  reference: number;
  /** Deviation in percent, sign as measured (pace: + = slower). */
  deltaPercent: number;
  rating: Rating;
}
export interface RecentComparison {
  /** Number of runs used. */
  count: number;
  /** Whether all comparison runs had the same purpose. */
  samePurpose: boolean;
  metrics: MetricComparison[];
}
/**
 * Direction and thresholds per metric. `better` means past the threshold in the
 * good direction; `slightly_worse` up to double the threshold in the bad one,
 * beyond that `worse`.
 */
const METRIC_RULES: Record<
  ComparedMetric,
  { higherIsBetter: boolean; thresholdPercent: number }
> = {
  pace: { higherIsBetter: false, thresholdPercent: 3 },
  heartRate: { higherIsBetter: false, thresholdPercent: 3 },
  metersPerBeat: { higherIsBetter: true, thresholdPercent: 3 },
  cadence: { higherIsBetter: true, thresholdPercent: 2 },
  drift: { higherIsBetter: false, thresholdPercent: 30 },
  fade: { higherIsBetter: false, thresholdPercent: 30 },
};
export function rateDelta(
  metric: ComparedMetric,
  deltaPercent: number,
): Rating {
  const rule = METRIC_RULES[metric];
  const good = rule.higherIsBetter ? deltaPercent : -deltaPercent;
  if (good >= rule.thresholdPercent) return 'better';
  if (good > -rule.thresholdPercent) return 'same';
  if (good > -rule.thresholdPercent * 2) return 'slightly_worse';
  return 'worse';
}

/**
 * Your recent runs: same sport, earlier, within 120 days, at most eight. If
 * there are three with the same purpose, only those count; otherwise all of
 * them. A comparison needs at least three.
 */
export function recentRuns(
  run: RunSummary,
  history: RunSummary[],
): RunSummary[] {
  const seen = new Set<string>([run.id, run.canonicalId ?? run.id]);
  const candidates = [...history]
    .filter(
      other =>
        !seen.has(other.id) &&
        !seen.has(other.canonicalId ?? other.id) &&
        (other.sport ?? 'running') === (run.sport ?? 'running') &&
        other.startTime < run.startTime &&
        run.startTime - other.startTime <= RECENT_WINDOW_DAYS * DAY &&
        other.distanceMeters >= 1000 &&
        other.status !== 'accidental',
    )
    .sort((a, b) => b.startTime - a.startTime);
  const sameType = candidates.filter(other =>
    samePurpose(other.purpose, run.purpose),
  );
  const chosen =
    comparablePurpose(run.purpose) !== 'unknown' &&
    sameType.length >= RECENT_MIN_RUNS
      ? sameType
      : candidates;
  return chosen.slice(0, RECENT_MAX_RUNS);
}

function comparedValue(
  metric: ComparedMetric,
  run: RunSummary,
): number | undefined {
  switch (metric) {
    case 'pace':
      return paceSecondsPerKm(run);
    case 'heartRate':
      return finite(run.avgHeartRate) ? run.avgHeartRate : undefined;
    case 'metersPerBeat':
      return metersPerBeat(run);
    case 'cadence':
      return finite(run.avgCadence) ? run.avgCadence : undefined;
    case 'drift':
      return heartRateDrift(run)?.percent;
    case 'fade':
      return undefined;
  }
}

export function recentComparison(
  run: RunSummary,
  history: RunSummary[],
  pacing?: PacingAnalysis,
): RecentComparison | undefined {
  const recent = recentRuns(run, history);
  if (recent.length < RECENT_MIN_RUNS) return undefined;
  const metrics: MetricComparison[] = [];
  const metricsToCompare: ComparedMetric[] = [
    'pace',
    'heartRate',
    'metersPerBeat',
    'cadence',
    'drift',
  ];
  metricsToCompare.forEach(metric => {
    const value = comparedValue(metric, run);
    const references = recent
      .map(other => comparedValue(metric, other))
      .filter(finite);
    const reference = median(references);
    if (value === undefined || reference === undefined) return;
    if (references.length < RECENT_MIN_RUNS) return;
    // Drift is a percentage itself; here the difference counts in points,
    // measured against a fixed span of 10 points.
    const deltaPercent =
      metric === 'drift'
        ? ((value - reference) / 10) * 100
        : reference === 0
        ? 0
        : percent(value, reference);
    metrics.push({
      metric,
      value,
      reference,
      deltaPercent,
      rating: rateDelta(metric, deltaPercent),
    });
  });
  if (pacing) {
    const references = recent
      .map(other => {
        // Fade of the comparison runs from their segments, without an analysis object.
        const rated = ratedSegments(other);
        if (rated.length < 4) return undefined;
        const half = Math.floor(rated.length / 2);
        const pace = (items: typeof rated) =>
          (items.reduce(
            (sum, { s }) => sum + (s.movingSeconds ?? s.durationSeconds),
            0,
          ) /
            items.reduce((sum, { s }) => sum + s.distanceMeters, 0)) *
          1000;
        return percent(pace(rated.slice(-half)), pace(rated.slice(0, half)));
      })
      .filter(finite);
    const reference = median(references);
    if (reference !== undefined && references.length >= RECENT_MIN_RUNS) {
      const deltaPercent = ((pacing.fadePercent - reference) / 10) * 100;
      metrics.push({
        metric: 'fade',
        value: pacing.fadePercent,
        reference,
        deltaPercent,
        rating: rateDelta('fade', deltaPercent),
      });
    }
  }
  if (!metrics.length) return undefined;
  return {
    count: recent.length,
    samePurpose: recent.every(other => samePurpose(other.purpose, run.purpose)),
    metrics,
  };
}

export interface SameRouteComparison {
  /** Which run on this route this is, counting this one. */
  ordinal: number;
  lastSeconds: number;
  currentSeconds: number;
  bestSeconds: number;
  /** Positive = slower than last time. */
  deltaToLastSeconds: number;
}
/** Same route per `context.routeId`; the time is the moving time. */
export function sameRouteComparison(
  run: RunSummary,
  history: RunSummary[],
): SameRouteComparison | undefined {
  const routeId = run.context?.routeId;
  const current = movingSeconds(run);
  if (!routeId || current === undefined) return undefined;
  const earlier = history
    .filter(
      other =>
        other.id !== run.id &&
        other.context?.routeId === routeId &&
        other.startTime < run.startTime &&
        movingSeconds(other) !== undefined,
    )
    .sort((a, b) => b.startTime - a.startTime);
  if (!earlier.length) return undefined;
  const last = movingSeconds(earlier[0])!;
  const best = Math.min(
    current,
    ...earlier.map(other => movingSeconds(other)!),
  );
  return {
    ordinal: earlier.length + 1,
    lastSeconds: last,
    currentSeconds: current,
    bestSeconds: best,
    deltaToLastSeconds: current - last,
  };
}

export interface CurvePoint {
  speedMps: number;
  heartRate: number;
}
export interface HeartRatePaceCurve {
  /** Points of this run: flat, moving kilometers. */
  points: CurvePoint[];
  /** Regression line from recent runs; missing when the spread is too small. */
  line?: { slope: number; intercept: number; runs: number; points: number };
  /** Mean deviation of this run from the line in bpm. */
  residualBpm?: number;
  /** Stable keys; show them through the UI's own labels. */
  verdict?: 'efficient' | 'usual' | 'higher';
}
function curvePoints(run: RunSummary): CurvePoint[] {
  return ratedSegments(run)
    .filter(({ s }) => finite(s.avgHeartRate) && segmentIsFlat(s))
    .map(({ s }) => ({
      speedMps: s.distanceMeters / (s.movingSeconds ?? s.durationSeconds),
      heartRate: s.avgHeartRate!,
    }))
    .filter(p => p.speedMps > 1 && p.speedMps < 8);
}
/**
 * Heart rate over pace: the kilometers of this run against a line from the flat
 * kilometers of your recent runs. A run below the line had a lower heart rate
 * than usual at the same pace.
 */
export function heartRatePaceCurve(
  run: RunSummary,
  history: RunSummary[],
): HeartRatePaceCurve | undefined {
  const points = curvePoints(run);
  if (!points.length) return undefined;
  const recent = recentRuns(run, history);
  const pool = recent.flatMap(curvePoints);
  const result: HeartRatePaceCurve = { points };
  const speeds = pool.map(p => p.speedMps);
  if (
    pool.length >= 8 &&
    recent.length >= RECENT_MIN_RUNS &&
    Math.max(...speeds) - Math.min(...speeds) >= 0.3
  ) {
    const mx = mean(speeds)!;
    const my = mean(pool.map(p => p.heartRate))!;
    const sxx = pool.reduce((sum, p) => sum + (p.speedMps - mx) ** 2, 0);
    const sxy = pool.reduce(
      (sum, p) => sum + (p.speedMps - mx) * (p.heartRate - my),
      0,
    );
    const slope = sxy / sxx;
    const intercept = my - slope * mx;
    const residual = mean(
      points.map(p => p.heartRate - (intercept + slope * p.speedMps)),
    )!;
    result.line = {
      slope,
      intercept,
      runs: recent.length,
      points: pool.length,
    };
    result.residualBpm = residual;
    result.verdict =
      residual <= -3 ? 'efficient' : residual >= 3 ? 'higher' : 'usual';
  }
  return result;
}

// ---------------------------------------------------------------------------
// Formatting for sentences that several surfaces share
// ---------------------------------------------------------------------------

/** Under a minute as "−12 s", above as "+1:05". */
export function formatSignedSeconds(seconds: number): string {
  const rounded = Math.round(seconds);
  const sign = rounded > 0 ? '+' : rounded < 0 ? '−' : '±';
  const abs = Math.abs(rounded);
  return abs < 60 ? `${sign}${abs} s` : `${sign}${formatPace(abs)}`;
}
/** Signed number without a unit; the unit is added by the caller. */
export function formatSignedNumber(value: number, digits = 0): string {
  const rounded = Number(value.toFixed(digits));
  const sign = rounded > 0 ? '+' : rounded < 0 ? '−' : '±';
  return `${sign}${fixed(Math.abs(rounded), digits)}`;
}
export function formatSignedPercent(value: number, digits = 0): string {
  return `${formatSignedNumber(value, digits)}${percentSign()}`;
}
/** How a phase reads in a sentence; keeps the glossary and the UI together. */
export function phaseWord(state: MovementPhase['state']): string {
  return {
    RUN: tr('gelaufen', 'running'),
    WALK: tr('gegangen', 'walking'),
    STOPPED: tr('gestanden', 'standing'),
    PAUSED: tr('pausiert', 'paused'),
    UNKNOWN: tr('unbekannt', 'unknown'),
  }[state];
}
