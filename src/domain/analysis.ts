import {
  EffortEstimate,
  PacingAnalysis,
  Provenance,
  QualityIssue,
  QualityReport,
  RunAnalysis,
  RunSummary,
  SegmentAggregate,
} from './types';

import { finite } from './inference';
import { fixed, tr } from './i18n';

/**
 * v2: Cadence lock also applies to steps per foot, flatness counts ascent and
 * descent instead of net elevation, and load is RPE × minutes.
 * v3: Observation only; the analysis no longer derives a recommendation.
 */
export const MODEL_VERSION = 'runback-rules-3.0.0';
/** Data-quality rules; 2: gaps per segment take effect (gapSeconds from distance model 3.0). */
export const QUALITY_VERSION = 'runback-quality-2';
export const PACING_METHOD = 'pacing-fade-v2';
export const MAX_SEGMENTS = 500;
/** Ascent plus descent per distance up to which a segment counts as flat. */
export const FLAT_GRADE_PERCENT = 2;
export const segmentId = (s: SegmentAggregate, i: number): string =>
  s.id ?? `split-${i + 1}`;
export const provenance = (
  runs: RunSummary[],
  segmentIds: string[] = [],
): Provenance => ({
  model_version: MODEL_VERSION,
  inputSources: runs.map(r => ({
    runId: r.id,
    source: r.source,
    version: r.sourceVersion ?? 'native-aggregate-v1',
  })),
  segmentIds,
});
/**
 * Optical heart rate sensors lock onto the step frequency. BLE reports steps
 * per minute (~170), FIT/TCX often steps per foot (~85); so both units are
 * checked.
 */
export function cadenceLocked(
  heartRate: number | undefined,
  cadence: number | undefined,
): boolean {
  if (!finite(heartRate) || !finite(cadence)) {
    return false;
  }
  const perMinute = cadence < 120 ? cadence * 2 : cadence;
  return (
    Math.abs(heartRate - cadence) <= 3 || Math.abs(heartRate - perMinute) <= 3
  );
}

export function assessQuality(run: RunSummary): QualityReport {
  const issues: QualityIssue[] = [];
  const issue = (
    sensor: QualityIssue['sensor'],
    code: string,
    message: string,
    id?: string,
    suspected = false,
  ) => issues.push({ sensor, code, message, segmentId: id, suspected });
  const validTime =
    finite(run.durationSeconds) &&
    run.durationSeconds > 0 &&
    finite(run.startTime) &&
    finite(run.endTime) &&
    run.endTime > run.startTime;
  const validDistance = finite(run.distanceMeters) && run.distanceMeters > 0;
  if (!validTime) {
    issue(
      'time',
      'invalid_time',
      tr(
        'Zeitdaten fehlen oder widersprechen sich.',
        'Time data is missing or contradictory.',
      ),
    );
  }
  if (!validDistance) {
    issue(
      'gps',
      'invalid_distance',
      tr(
        'Keine verlässliche Distanz vorhanden.',
        'No reliable distance available.',
      ),
    );
  }
  if (
    validTime &&
    run.durationSeconds > (run.endTime - run.startTime) / 1000 + 5
  ) {
    issue(
      'time',
      'duration_mismatch',
      tr(
        'Aufzeichnungszeit überschreitet die Spanne zwischen Start und Ende.',
        'Recorded time exceeds the span between start and end.',
      ),
    );
  }
  if ((run.segments?.length ?? 0) > MAX_SEGMENTS) {
    issue(
      'time',
      'aggregate_limit',
      tr(
        'Zu viele Abschnitte: Detailauswertung bleibt aus.',
        'Too many segments: detailed analysis is skipped.',
      ),
    );
  }
  const usablePaceSegmentIds: string[] = [];
  const usableHeartRateSegmentIds: string[] = [];
  const segments =
    (run.segments?.length ?? 0) <= MAX_SEGMENTS ? run.segments ?? [] : [];
  let lockCount = 0;
  for (const s of segments) {
    if (cadenceLocked(s.avgHeartRate, s.avgCadence)) {
      lockCount++;
    }
  }
  const possibleLock =
    lockCount >= 3 && lockCount / Math.max(1, segments.length) >= 0.6;
  segments.forEach((s, i) => {
    const id = segmentId(s, i);
    const timeOK = finite(s.durationSeconds) && s.durationSeconds > 0;
    const distanceOK = finite(s.distanceMeters) && s.distanceMeters > 0;
    const speed =
      timeOK && distanceOK ? s.distanceMeters / s.durationSeconds : NaN;
    if (!timeOK) {
      issue(
        'time',
        'invalid_segment_time',
        tr(
          'Abschnitt mit ungültiger Dauer ausgeschlossen.',
          'Segment with invalid duration excluded.',
        ),
        id,
      );
    }
    if (!distanceOK || (finite(speed) && speed > 12)) {
      issue(
        'gps',
        'suspected_jump',
        tr(
          'Distanz unplausibel; möglicher GPS-Sprung.',
          'Implausible distance; possible GPS jump.',
        ),
        id,
        true,
      );
    }
    const hasGap = finite(s.gapSeconds) && s.gapSeconds > 5;
    if (hasGap) {
      issue(
        'time',
        'gap',
        tr(
          'Messlücke: Abschnitt für Pacing nicht geeignet.',
          'Recording gap: segment not suitable for pacing.',
        ),
        id,
      );
    }
    if (finite(s.gradePercent) && Math.abs(s.gradePercent) > 40) {
      issue(
        'elevation',
        'suspected_elevation',
        tr(
          'Unplausible Steigung; Höhenquelle prüfen.',
          'Implausible grade; check the elevation source.',
        ),
        id,
        true,
      );
    }
    if (
      timeOK &&
      distanceOK &&
      speed <= 12 &&
      speed >= 0.5 &&
      !hasGap &&
      s.phase !== 'pause'
    ) {
      usablePaceSegmentIds.push(id);
    }
    const hrOK =
      finite(s.avgHeartRate) && s.avgHeartRate >= 35 && s.avgHeartRate <= 230;
    if (s.avgHeartRate !== undefined && !hrOK) {
      issue(
        'heartRate',
        'implausible_hr',
        tr(
          'Pulswert außerhalb des unterstützten Bereichs.',
          'Heart rate outside the supported range.',
        ),
        id,
      );
    }
    const segmentLock =
      possibleLock && cadenceLocked(s.avgHeartRate, s.avgCadence);
    if (segmentLock) {
      issue(
        'heartRate',
        'possible_cadence_lock',
        tr(
          'Puls folgt möglicherweise der Kadenz; kein sicherer Gerätefehler.',
          'Heart rate may be following cadence; not a confirmed device fault.',
        ),
        id,
        true,
      );
    }
    if (
      s.avgCadence !== undefined &&
      (!finite(s.avgCadence) || s.avgCadence < 40 || s.avgCadence > 260)
    ) {
      issue(
        'cadence',
        'implausible_cadence',
        tr(
          'Kadenz außerhalb des unterstützten Bereichs.',
          'Cadence outside the supported range.',
        ),
        id,
      );
    }
    if (
      hrOK &&
      !segmentLock &&
      timeOK &&
      s.durationSeconds >= 180 &&
      !hasGap &&
      s.phase !== 'pause' &&
      s.phase !== 'recovery'
    ) {
      usableHeartRateSegmentIds.push(id);
    }
  });
  const speed = run.distanceMeters / run.durationSeconds;
  const paceUsable =
    validTime &&
    validDistance &&
    speed >= 0.5 &&
    speed <= 12 &&
    !issues.some(i => i.code === 'duration_mismatch');
  const heartRateUsable =
    segments.length > 0
      ? usableHeartRateSegmentIds.length > 0
      : finite(run.avgHeartRate) &&
        run.avgHeartRate >= 35 &&
        run.avgHeartRate <= 230;
  if (!heartRateUsable) {
    issue(
      'heartRate',
      'no_usable_hr',
      tr(
        'Keine geeigneten Pulsdaten; Tempo bleibt separat auswertbar.',
        'No usable heart rate data; pace can still be evaluated separately.',
      ),
    );
  }
  return {
    issues,
    paceUsable,
    heartRateUsable,
    usablePaceSegmentIds,
    usableHeartRateSegmentIds,
  };
}

/** A transparent speed-only index, explicitly not metabolic power or fitness. */
export function estimateEffort(
  run: RunSummary,
  quality = assessQuality(run),
): EffortEstimate {
  const speedIndex = quality.paceUsable
    ? (run.distanceMeters / run.durationSeconds / 3) * 100
    : undefined;
  const minutes =
    finite(run.durationSeconds) && run.durationSeconds > 0
      ? run.durationSeconds / 60
      : undefined;
  const rpe = (value: number | undefined) =>
    minutes !== undefined && finite(value) && value >= 1 && value <= 10
      ? value * minutes
      : undefined;
  const legs = rpe(run.rpe?.legs);
  const breathing = rpe(run.rpe?.breathing);
  return {
    ...provenance([run], quality.usablePaceSegmentIds),
    kind: 'estimate',
    speedIndex,
    sessionLoad:
      legs === undefined && breathing === undefined
        ? undefined
        : { legs, breathing },
    unit: 'index (100 = 3 m/s)',
    uncertainty: tr(
      'Keine validierte Unsicherheitsspanne. Der Tempoindex erfasst weder persönliche Leistungsfähigkeit noch Umweltbelastung.',
      'No validated uncertainty range. The pace index captures neither personal fitness nor environmental strain.',
    ),
    assumptions: [
      tr(
        'Version 2: 100 Indexpunkte entsprechen 3 m/s; linearer Tempoindex.',
        'Version 2: 100 index points equal 3 m/s; linear pace index.',
      ),
      tr(
        'Nur gleichmäßige Laufbewegung mit plausibler Zeit und Distanz; keine physiologische Gesamtbewertung.',
        'Only steady running with plausible time and distance; no overall physiological assessment.',
      ),
      tr(
        'Belastung: RPE × Bewegungsminuten je Skala (Beine, Atmung), angelehnt an Session-RPE; kein Gesamtwert aus beiden.',
        'Load: RPE × moving minutes per scale (legs, breathing), based on session RPE; no total combining both.',
      ),
    ],
    factors: {
      tempo:
        speedIndex === undefined
          ? tr('Nicht bestimmbar', 'Not determinable')
          : tr(
              `${Math.round(speedIndex)} Indexpunkte`,
              `${Math.round(speedIndex)} index points`,
            ),
      slope: tr(
        'Nicht bestimmbar – kein validiertes Steigungsmodell',
        'Not determinable – no validated slope model',
      ),
      wind: tr(
        'Nicht bestimmbar – kein validiertes Windmodell',
        'Not determinable – no validated wind model',
      ),
      heat: tr(
        'Nicht bestimmbar – kein validiertes Hitzemodell',
        'Not determinable – no validated heat model',
      ),
    },
  };
}

export function pacingFor(
  run: RunSummary,
  quality = assessQuality(run),
): PacingAnalysis | undefined {
  if (!quality.paceUsable || (run.segments?.length ?? 0) > MAX_SEGMENTS) {
    return undefined;
  }
  const usable = new Set(quality.usablePaceSegmentIds);
  const splits = (run.segments ?? [])
    .map((s, i) => ({ s, id: segmentId(s, i) }))
    .filter(
      ({ s, id }) =>
        usable.has(id) &&
        s.distanceMeters >= 500 &&
        (!s.phase || s.phase === 'work'),
    );
  if (splits.length < 4) {
    return undefined;
  }
  const half = Math.floor(splits.length / 2);
  const pace = (items: typeof splits) =>
    (items.reduce((sum, { s }) => sum + s.durationSeconds, 0) /
      items.reduce((sum, { s }) => sum + s.distanceMeters, 0)) *
    1000;
  const firstPaceSecondsPerKm = pace(splits.slice(0, half));
  const lastPaceSecondsPerKm = pace(splits.slice(-half));
  const paces = splits.map(
    ({ s }) => (s.durationSeconds / s.distanceMeters) * 1000,
  );
  const mean = paces.reduce((a, b) => a + b, 0) / paces.length;
  const deviation = Math.sqrt(
    paces.reduce((sum, value) => sum + (value - mean) ** 2, 0) / paces.length,
  );
  return {
    firstPaceSecondsPerKm,
    lastPaceSecondsPerKm,
    fadePercent: (lastPaceSecondsPerKm / firstPaceSecondsPerKm - 1) * 100,
    coefficientOfVariation: deviation / mean,
    segmentIds: splits.map(s => s.id),
  };
}

/**
 * Flat means: ascent plus descent ≤ 2 % of the distance. Net elevation alone
 * would count "up and down again" as flat. Without ascent/descent (old data,
 * imports) the net grade counts; without either it is unknown.
 */
export function segmentIsFlat(s: SegmentAggregate): boolean {
  if (!finite(s.distanceMeters) || s.distanceMeters <= 0) {
    return false;
  }
  if (finite(s.ascentMeters) && finite(s.descentMeters)) {
    return (
      ((s.ascentMeters + s.descentMeters) / s.distanceMeters) * 100 <=
      FLAT_GRADE_PERCENT
    );
  }
  return (
    finite(s.gradePercent) && Math.abs(s.gradePercent) <= FLAT_GRADE_PERCENT
  );
}

export function flatPacingContext(
  run: RunSummary,
  pacing: PacingAnalysis,
): boolean {
  const ids = new Set(pacing.segmentIds);
  return (run.segments ?? [])
    .filter((s, i) => ids.has(segmentId(s, i)))
    .every(segmentIsFlat);
}

/** Observation only: data quality, effort, and the pace split of usable segments. */
export function analyzeRun(run: RunSummary): RunAnalysis {
  const quality = assessQuality(run);
  const pacing = pacingFor(run, quality);
  const effort = estimateEffort(run, quality);
  const fade = pacing ? fixed(Math.abs(pacing.fadePercent), 1) : undefined;
  const classification = !quality.paceUsable
    ? tr(
        'Dieser Lauf ist gespeichert; Zeit oder Distanz reichen für eine Tempoauswertung nicht aus.',
        'This run is saved; time or distance is not enough for a pace review.',
      )
    : !pacing
    ? tr(
        'Zeit und Distanz sind für eine einfache Tempoauswertung nutzbar.',
        'Time and distance are usable for a simple pace review.',
      )
    : pacing.fadePercent >= 0
    ? tr(
        `Die zweite Laufhälfte war ${fade} % langsamer (geeignete Abschnitte).`,
        `The second half was ${fade}% slower (usable segments).`,
      )
    : tr(
        `Die zweite Laufhälfte war ${fade} % schneller (geeignete Abschnitte).`,
        `The second half was ${fade}% faster (usable segments).`,
      );
  return {
    ...provenance([run], pacing?.segmentIds ?? []),
    classification,
    quality,
    effort,
    pacing,
  };
}

export function formatPace(seconds: number): string {
  if (!finite(seconds) || seconds <= 0) {
    return '–';
  }
  const rounded = Math.round(seconds);
  return `${Math.floor(rounded / 60)}:${String(rounded % 60).padStart(2, '0')}`;
}
