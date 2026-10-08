import { fixed, getLanguage, tr } from './i18n';
import type { RunSummary, SegmentAggregate } from './types';

/**
 * Display series of a run for the detail page's charts. It arrives ready-made
 * from Kotlin (RunSeries): one window per row, pace only while moving, elevation
 * from RunElevation, headwind only with a known wind direction. This file only
 * derives display values — no fallback to 0; missing values stay `undefined`.
 */
export interface SeriesRow {
  elapsedSeconds: number;
  distanceMeters: number;
  moving: boolean;
  speedMps?: number;
  heartRate?: number;
  cadence?: number;
  elevationM?: number;
  gradePercent?: number;
  latitude?: number;
  longitude?: number;
  /** Positive = headwind, negative = tailwind (m/s). */
  headwindMps?: number;
  /** Arm swing from the running form (watch, otherwise phone in hand), degrees. */
  armSwingDeg?: number;
}
export interface RunSeries {
  version?: string;
  stepSeconds: number;
  wind?: { mps: number; fromDeg: number };
  rows: SeriesRow[];
}

export type SeriesMetric =
  | 'pace'
  | 'heartRate'
  | 'elevation'
  | 'cadence'
  | 'armSwing'
  | 'wind';
export const SERIES_METRICS: SeriesMetric[] = [
  'pace',
  'heartRate',
  'elevation',
  'cadence',
  'armSwing',
  'wind',
];
export function metricLabel(metric: SeriesMetric): string {
  return {
    pace: tr('Tempo', 'Pace'),
    heartRate: tr('Puls', 'Heart rate'),
    elevation: tr('Höhe', 'Elevation'),
    cadence: tr('Kadenz', 'Cadence'),
    armSwing: tr('Armschwung', 'Arm swing'),
    wind: tr('Wind', 'Wind'),
  }[metric];
}

/** Value of a metric in one row; pace as s/km, otherwise as measured. */
export function metricValue(
  row: SeriesRow,
  metric: SeriesMetric,
): number | undefined {
  switch (metric) {
    case 'pace':
      return row.speedMps !== undefined && row.speedMps > 0
        ? 1000 / row.speedMps
        : undefined;
    case 'heartRate':
      return row.heartRate;
    case 'elevation':
      return row.elevationM;
    case 'cadence':
      return row.cadence;
    case 'armSwing':
      return row.armSwingDeg;
    case 'wind':
      return row.headwindMps;
  }
}

/** Only metrics with at least two readings get a tab. */
export function availableMetrics(series: RunSeries | null): SeriesMetric[] {
  if (!series) return [];
  return SERIES_METRICS.filter(
    metric =>
      series.rows.filter(row => metricValue(row, metric) !== undefined)
        .length >= 2,
  );
}

export function formatPace(secondsPerKm: number | undefined): string {
  if (secondsPerKm === undefined || !Number.isFinite(secondsPerKm))
    return '–:––';
  const s = Math.round(secondsPerKm);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
export function formatElapsed(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return s >= 3600
    ? `${Math.floor(s / 3600)}:${String(Math.floor(s / 60) % 60).padStart(
        2,
        '0',
      )}:${String(s % 60).padStart(2, '0')}`
    : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
export function formatKm(meters: number, digits = 2): string {
  return fixed(meters / 1000, digits);
}
/** Headwind with sign and the active decimal separator: "+2,1" or "−1,4". */
export function formatHeadwind(mps: number | undefined): string {
  if (mps === undefined || !Number.isFinite(mps)) return '–';
  const rounded = Math.round(mps * 10) / 10;
  const sign = rounded > 0 ? '+' : rounded < 0 ? '−' : '±';
  return `${sign}${fixed(Math.abs(rounded), 1)}`;
}
export function formatMetric(
  metric: SeriesMetric,
  value: number | undefined,
): string {
  if (value === undefined || !Number.isFinite(value)) return '–';
  switch (metric) {
    case 'pace':
      return formatPace(value);
    case 'wind':
      return formatHeadwind(value);
    case 'elevation':
      return `${Math.round(value)} m`;
    default:
      return String(Math.round(value));
  }
}
export function metricUnit(metric: SeriesMetric): string {
  return {
    pace: '/km',
    heartRate: 'bpm',
    elevation: 'm',
    cadence: 'spm',
    armSwing: '°',
    wind: 'm/s',
  }[metric];
}

/** Wind direction as the compass point it comes from. */
export function compassLabel(fromDeg: number): string {
  const names =
    getLanguage() === 'en'
      ? ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']
      : ['N', 'NO', 'O', 'SO', 'S', 'SW', 'W', 'NW'];
  return names[Math.round((((fromDeg % 360) + 360) % 360) / 45) % 8];
}

export type SeriesAxis = 'distance' | 'time';
export function axisValue(row: SeriesRow, axis: SeriesAxis): number {
  return axis === 'distance' ? row.distanceMeters : row.elapsedSeconds;
}

/** Row closest to the axis value (binary search; rows are sorted). */
export function nearestIndex(
  rows: SeriesRow[],
  axis: SeriesAxis,
  target: number,
): number {
  if (!rows.length) return -1;
  let lo = 0;
  let hi = rows.length - 1;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (axisValue(rows[mid], axis) < target) lo = mid + 1;
    else hi = mid;
  }
  if (lo > 0) {
    const before = axisValue(rows[lo - 1], axis);
    const here = axisValue(rows[lo], axis);
    if (Math.abs(target - before) <= Math.abs(here - target)) return lo - 1;
  }
  return lo;
}

/** Row whose position is closest to the point; −1 without positions. */
export function nearestByPosition(
  rows: SeriesRow[],
  latitude: number,
  longitude: number,
): number {
  let best = -1;
  let bestDistance = Infinity;
  const scale = Math.cos((latitude * Math.PI) / 180);
  rows.forEach((row, index) => {
    if (row.latitude === undefined || row.longitude === undefined) return;
    const dy = row.latitude - latitude;
    const dx = (row.longitude - longitude) * scale;
    const d = dx * dx + dy * dy;
    if (d < bestDistance) {
      bestDistance = d;
      best = index;
    }
  });
  return best;
}

/**
 * Kilometer splits for the table. The source is the native `segments`
 * (distance model 3.0): they end at a whole kilometer or at a pause, so one
 * kilometer can span two rows. Pace from moving time when known, otherwise
 * from the split duration.
 */
export interface KilometerSplit {
  index: number;
  /** "1", "2" … or "8–8.4" for the remainder. */
  label: string;
  fromMeters: number;
  toMeters: number;
  distanceMeters: number;
  secondsPerKm?: number;
  avgHeartRate?: number;
  ascentMeters?: number;
  descentMeters?: number;
  /** Net grade of the split in %, only from 50 m on smoothed elevation. */
  gradePercent?: number;
  startElapsedSeconds?: number;
  endElapsedSeconds?: number;
  /** From 5 s without GPS in the split, the pace is not reliable. */
  uncertain: boolean;
}
export function kilometerSplits(
  segments: SegmentAggregate[] | undefined,
): KilometerSplit[] {
  if (!segments?.length) return [];
  let cumulative = 0;
  return segments
    .filter(segment => segment.distanceMeters > 0)
    .map((segment, index) => {
      const from = cumulative;
      cumulative += segment.distanceMeters;
      const seconds = segment.movingSeconds ?? segment.durationSeconds;
      const secondsPerKm =
        segment.distanceMeters >= 50 && seconds > 0
          ? seconds / (segment.distanceMeters / 1000)
          : undefined;
      // Native splits end at the first GPS point from 1000 m on, so just past
      // it; a "whole" kilometer may therefore run a little longer.
      const whole =
        segment.distanceMeters >= 950 &&
        segment.distanceMeters <= 1050 &&
        Math.round(cumulative / 1000) === Math.round(from / 1000) + 1;
      return {
        index,
        label: whole
          ? String(Math.round(cumulative / 1000))
          : `${formatKm(from, 1)}–${formatKm(cumulative, 1)}`,
        fromMeters: from,
        toMeters: cumulative,
        distanceMeters: segment.distanceMeters,
        secondsPerKm,
        avgHeartRate: segment.avgHeartRate,
        ascentMeters: segment.ascentMeters,
        descentMeters: segment.descentMeters,
        gradePercent: segment.gradePercent,
        startElapsedSeconds: segment.startElapsedSeconds,
        endElapsedSeconds: segment.endElapsedSeconds,
        uncertain: (segment.gapSeconds ?? 0) >= 5,
      };
    });
}

/** Row range of a split in the series, by time; null without time data. */
export function splitRange(
  rows: SeriesRow[],
  split: KilometerSplit,
): [number, number] | null {
  if (
    split.startElapsedSeconds === undefined ||
    split.endElapsedSeconds === undefined ||
    !rows.length
  )
    return null;
  const from = nearestIndex(rows, 'time', split.startElapsedSeconds);
  const to = nearestIndex(rows, 'time', split.endElapsedSeconds);
  return from <= to ? [from, to] : [to, from];
}

/** Average pace of the run in s/km for the average line; undefined under 20 m. */
export function averagePace(run: RunSummary): number | undefined {
  if (run.distanceMeters < 20 || run.durationSeconds <= 0) return undefined;
  const seconds = run.time?.movingSeconds ?? run.durationSeconds;
  return seconds / (run.distanceMeters / 1000);
}

/** Totals for the reading line without a selection. */
export function seriesTotals(
  run: RunSummary,
  series: RunSeries | null,
): Partial<Record<SeriesMetric, string>> {
  const totals: Partial<Record<SeriesMetric, string>> = {};
  const pace = averagePace(run);
  if (pace !== undefined) totals.pace = formatPace(pace);
  if (run.avgHeartRate !== undefined)
    totals.heartRate = String(Math.round(run.avgHeartRate));
  if (run.avgCadence !== undefined)
    totals.cadence = String(Math.round(run.avgCadence));
  if (run.elevation?.available)
    totals.elevation = `↗ ${Math.round(run.elevation.ascentMeters)} m`;
  const winds = series?.rows
    .map(row => row.headwindMps)
    .filter((value): value is number => value !== undefined);
  if (winds?.length)
    totals.wind = formatHeadwind(
      winds.reduce((sum, value) => sum + value, 0) / winds.length,
    );
  return totals;
}
