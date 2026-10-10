/**
 * Run report and analysis export for sharing.
 *
 * Three files: the Markdown report for people (with a compact JSON summary),
 * `…_analysis.json` for analysis, and the 5-second time series
 * `…_timeseries.csv`, which is written natively. Raw data, cleaned data and
 * derived metrics stay separate: time budget, phases, elevation and data
 * quality carry their model version; coverages are measured, and there is no
 * invented overall score.
 *
 * What is missing stays missing: no zeros, no invented values. Raw samples stay
 * native; the time course arrives as a bounded aggregate from Kotlin.
 */
import type {
  Adherence,
  ElevationSummary,
  MovementPhase,
  MovementState,
  QualityIssue,
  RunAnalysis,
  RunSummary,
  SegmentAggregate,
  TimeBudget,
} from './types';
import { runTitle, purposeLabel } from './runTitle';
import {
  isAccidentalRun,
  normalizeSport,
  runValidity,
  sportWords,
  usesPace,
} from './sport';
import { hasRunTarget, runTargetLabel, type RunTarget } from './runTarget';
import { focusLabel, type TrainingFocus } from './focus';
import { QUALITY_VERSION } from './analysis';
import { dateFormat, locale, percentSign, quote, tr } from './i18n';

export const RUN_REPORT_VERSION = 'runback-report-2';
export const RUN_ANALYSIS_EXPORT_VERSION = 'runback-analysis-1';

export interface ReportRoutePoint {
  latitude: number;
  longitude: number;
  time?: number;
  gap?: boolean;
}
export interface ReportEvent {
  type?: string;
  at?: number;
  message?: string;
  data?: Record<string, unknown>;
}
export interface TimelineRow {
  /** Seconds since the start, pauses included (end of the window). */
  elapsedSeconds: number;
  /** Distance covered at the end of the window, in m. */
  distanceMeters: number;
  stepDistanceMeters: number;
  /** Seconds with valid GPS steps in the window — not moving time. */
  gpsCoveredSeconds: number;
  avgHeartRate?: number;
  avgCadence?: number;
  altitudeM?: number;
}
export interface RunTimeline {
  version?: string;
  stepSeconds: number;
  rows: TimelineRow[];
}
export interface ReportRun extends RunSummary {
  note?: string;
  route?: ReportRoutePoint[];
  events?: ReportEvent[];
  target?: RunTarget;
}
export interface RunReportContext {
  goal?: string;
  goalTargetDate?: string;
  focus?: TrainingFocus | null;
  adherence?: Adherence;
  /** Other runs for weekly volume and context; the run itself may be included. */
  history?: RunSummary[];
}
export interface RunReportInput {
  run: ReportRun;
  analysis?: RunAnalysis | null;
  timeline?: RunTimeline | null;
  context?: RunReportContext;
  /** Time of the export; default: now. */
  now?: number;
}

const DAY = 24 * 3600 * 1000;

const fmt = (value: number, digits = 1) =>
  Number.isFinite(value)
    ? value.toLocaleString(locale(), {
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
      })
    : '–';
const int = (value: number | undefined) =>
  value !== undefined && Number.isFinite(value)
    ? Math.round(value).toLocaleString(locale())
    : '–';
const formatDuration = (seconds: number) => {
  if (!Number.isFinite(seconds) || seconds < 0) return '–';
  const s = Math.floor(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor(s / 60) % 60;
  const sec = s % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
    : `${m}:${String(sec).padStart(2, '0')}`;
};
/** Pace in m:ss /km; not determinable under 20 m of distance or without time. */
const formatPace = (meters: number, seconds: number) =>
  meters >= 20 && seconds > 0
    ? `${formatDuration(seconds / (meters / 1000))} /km`
    : '–';
const formatSpeed = (meters: number, seconds: number) =>
  meters >= 20 && seconds > 0
    ? `${fmt(meters / 1000 / (seconds / 3600), 1)} km/h`
    : '–';
const dateTime = (timestamp: number) =>
  dateFormat({
    weekday: 'long',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(timestamp));
const clock = (timestamp: number) =>
  dateFormat({
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(new Date(timestamp));
const iso = (timestamp: number | undefined) =>
  timestamp && Number.isFinite(timestamp)
    ? new Date(timestamp).toISOString()
    : undefined;
const percent = (value: number | undefined) =>
  value === undefined || !Number.isFinite(value)
    ? '–'
    : `${Math.round(value * 100)}${percentSign()}`;
const escapeCell = (value: string) => value.replace(/\|/g, '\\|');
const table = (header: string[], rows: string[][]) =>
  [
    `| ${header.join(' | ')} |`,
    `| ${header.map(() => '---').join(' | ')} |`,
    ...rows.map(row => `| ${row.map(escapeCell).join(' | ')} |`),
  ].join('\n');
/** Markdown blockquote, one `>` per line. */
const blockquote = (text: string) =>
  text
    .trim()
    .split(/\r?\n/)
    .map(line => `> ${line}`)
    .join('\n');
const usableWord = (usable: boolean) =>
  usable ? tr('nutzbar', 'usable') : tr('nicht nutzbar', 'not usable');

const sourceLabel = (source: string) => {
  switch (source) {
    case 'phone':
      return tr('Telefon (Runback)', 'Phone (Runback)');
    case 'wear':
      return tr('Uhr (Runback Wear)', 'Watch (Runback Wear)');
    case 'import':
      return tr('Import', 'Import');
    case 'healthconnect':
      return 'Health Connect';
  }
  return source.startsWith('import') ? `Import (${source})` : source;
};

const eventLabel = (type: string): string =>
  (
    {
      start: tr('Start', 'Start'),
      pause: tr('Pause', 'Pause'),
      resume: tr('Weiter', 'Resumed'),
      stop: tr('Ende', 'Stopped'),
      completed: tr('Ende', 'Finished'),
      interrupted: tr('Unterbrochen', 'Interrupted'),
      target_cue: tr('Hinweis zum Ziel', 'Target cue'),
      target_pace: tr('Zieltempo geändert', 'Target pace changed'),
      goal_cue: tr('Ansage zum Ziel', 'Goal announcement'),
      interval_phase: tr('Intervallphase', 'Interval phase'),
      progress_cue: tr('Zwischenstand', 'Progress update'),
      warning: tr('Warnung', 'Warning'),
      feedback: tr('Feedback gespeichert', 'Feedback saved'),
    } as Record<string, string>
  )[type] || type;

const phaseLabel = (phase: SegmentAggregate['phase']) =>
  (
    {
      warmup: tr('Einlaufen', 'Warm-up'),
      work: tr('Belastung', 'Work'),
      recovery: tr('Erholung', 'Recovery'),
      cooldown: tr('Auslaufen', 'Cool-down'),
      pause: tr('Pause', 'Pause'),
    } as Record<string, string>
  )[phase || ''] || '';

const stateLabel = (state: MovementState | string): string =>
  (
    {
      RUN: tr('Laufen', 'Running'),
      WALK: tr('Gehen', 'Walking'),
      STOPPED: tr('Stillstand', 'Standing'),
      PAUSED: tr('Pause', 'Pause'),
      UNKNOWN: tr('Unbekannt', 'Unknown'),
    } as Record<string, string>
  )[state] || state;

const elevationReasonLabel = (reason: string): string =>
  (
    {
      NO_ELEVATION_SOURCE: tr('keine Höhenquelle', 'no elevation source'),
      NO_VERTICAL_ACCURACY: tr(
        'GPS-Höhe ohne Genauigkeitsangabe',
        'GPS elevation without accuracy information',
      ),
      VERTICAL_ACCURACY_TOO_LOW: tr(
        'GPS-Höhe zu ungenau',
        'GPS elevation too imprecise',
      ),
    } as Record<string, string>
  )[reason] || reason;

function overviewRows(run: ReportRun): string[][] {
  const sport = normalizeSport(run.sport);
  const pace = usesPace(sport);
  const rows: string[][] = [
    [tr('Sportart', 'Sport'), sportWords(sport).label],
    [tr('Laufart', 'Run type'), purposeLabel(run.purpose)],
    [tr('Start', 'Start'), dateTime(run.startTime)],
  ];
  if (run.endTime > run.startTime) {
    rows.push([tr('Ende', 'End'), clock(run.endTime)]);
  }
  if (isAccidentalRun(run)) {
    rows.push([
      tr('Gültigkeit', 'Validity'),
      tr(
        'Fehlstart (zählt nicht als Training)',
        'False start (does not count as training)',
      ),
    ]);
  }
  const time = run.time;
  const rate = (meters: number, seconds: number) =>
    pace ? formatPace(meters, seconds) : formatSpeed(meters, seconds);
  if (time) {
    rows.push([
      tr('Gesamtzeit (Start bis Ende)', 'Total time (start to end)'),
      formatDuration(time.elapsedSeconds),
    ]);
    if (time.pausedSeconds >= 1)
      rows.push([tr('Pausen', 'Pauses'), formatDuration(time.pausedSeconds)]);
    rows.push([
      tr('Aufzeichnungszeit (ohne Pausen)', 'Recorded time (without pauses)'),
      formatDuration(time.activeSeconds),
    ]);
    rows.push([
      tr('Bewegungszeit (Laufen + Gehen)', 'Moving time (running + walking)'),
      tr(
        `${formatDuration(time.movingSeconds)} (Laufen ${formatDuration(
          time.runningSeconds,
        )} · Gehen ${formatDuration(time.walkingSeconds)})`,
        `${formatDuration(time.movingSeconds)} (running ${formatDuration(
          time.runningSeconds,
        )} · walking ${formatDuration(time.walkingSeconds)})`,
      ),
    ]);
    if (time.stoppedSeconds >= 1)
      rows.push([tr('Stillstand', 'Standing'), formatDuration(time.stoppedSeconds)]);
    if (time.unknownSeconds >= 1)
      rows.push([
        tr('Ohne Bewegungsdaten', 'Without motion data'),
        formatDuration(time.unknownSeconds),
      ]);
  } else {
    if (run.endTime > run.startTime) {
      const wall = (run.endTime - run.startTime) / 1000;
      if (wall - run.durationSeconds > 30) {
        rows.push([
          tr('Pausen gesamt', 'Total pauses'),
          formatDuration(wall - run.durationSeconds),
        ]);
      }
    }
    rows.push([
      tr('Aufzeichnungszeit (ohne Pausen)', 'Recorded time (without pauses)'),
      formatDuration(run.durationSeconds),
    ]);
  }
  rows.push([tr('Distanz', 'Distance'), `${fmt(run.distanceMeters / 1000, 2)} km`]);
  const paceWord = pace
    ? tr('Ø Tempo', 'Avg pace')
    : tr('Ø Geschwindigkeit', 'Avg speed');
  rows.push([
    tr(
      `${paceWord} über die Aufzeichnungszeit`,
      `${paceWord} over recorded time`,
    ),
    rate(run.distanceMeters, time ? time.activeSeconds : run.durationSeconds),
  ]);
  if (time) {
    rows.push([
      tr(`${paceWord} in Bewegung`, `${paceWord} while moving`),
      rate(run.distanceMeters, time.movingSeconds),
    ]);
    const running = run.phaseMetrics?.running;
    if (running && running.meters >= 100) {
      rows.push([
        tr(`${paceWord} beim Laufen`, `${paceWord} while running`),
        `${rate(running.meters, running.seconds)} ${tr(
          '(nur RUN-Phasen; durch die Erkennungsschwelle schneller als eine Easy Pace)',
          '(RUN phases only; faster than an easy pace because of the detection threshold)',
        )}`,
      ]);
    }
  }
  if (run.avgHeartRate) {
    const extremes =
      run.avgHeartRateMax !== undefined && run.avgHeartRateMin !== undefined
        ? `, ${int(run.avgHeartRateMin)}–${int(run.avgHeartRateMax)} bpm`
        : '';
    rows.push([
      tr('Ø Puls', 'Avg heart rate'),
      `${int(run.avgHeartRate)} bpm${extremes}${
        run.heartRateCoverage !== undefined
          ? tr(
              ` (Abdeckung ${percent(run.heartRateCoverage)} der Aufzeichnungszeit)`,
              ` (coverage ${percent(run.heartRateCoverage)} of recorded time)`,
            )
          : ''
      }`,
    ]);
  }
  if (run.avgCadence) {
    rows.push([
      pace
        ? tr('Ø Schrittfrequenz', 'Avg cadence')
        : tr('Ø Trittfrequenz', 'Avg pedal rate'),
      `${int(run.avgCadence)} /min${
        run.cadenceCoverage !== undefined
          ? tr(
              ` (Abdeckung ${percent(run.cadenceCoverage)})`,
              ` (coverage ${percent(run.cadenceCoverage)})`,
            )
          : ''
      }`,
    ]);
  }
  const elevation = run.elevation;
  if (elevation?.available) {
    const source =
      elevation.source === 'barometer'
        ? tr('Barometer', 'barometer')
        : tr('GPS, geglättet', 'GPS, smoothed');
    const reference =
      elevation.reference === 'start'
        ? tr(', Höhe relativ zum Start', ', elevation relative to start')
        : '';
    rows.push([
      tr('Anstieg / Abstieg', 'Ascent / descent'),
      `${int(elevation.ascentMeters)} m / ${int(elevation.descentMeters)} m (${source}${reference})`,
    ]);
  } else if (elevation) {
    rows.push([
      tr('Anstieg / Abstieg', 'Ascent / descent'),
      tr(
        `nicht bestimmbar (${elevationReasonLabel(elevation.reason)})`,
        `not determinable (${elevationReasonLabel(elevation.reason)})`,
      ),
    ]);
  } else if (run.elevationGainMeters !== undefined) {
    rows.push([
      tr('Anstieg gesamt (laut Quelle)', 'Total ascent (per source)'),
      `${int(run.elevationGainMeters)} m`,
    ]);
  }
  if (run.calories)
    rows.push([tr('Kalorien', 'Calories'), `${int(run.calories)} kcal`]);
  if (run.steps) rows.push([tr('Schritte', 'Steps'), int(run.steps)]);
  if (
    run.context?.temperatureC !== undefined ||
    run.context?.windMps !== undefined
  ) {
    const parts: string[] = [];
    if (run.context.temperatureC !== undefined)
      parts.push(`${fmt(run.context.temperatureC, 0)} °C`);
    if (run.context.windMps !== undefined)
      parts.push(`${tr('Wind', 'Wind')} ${fmt(run.context.windMps, 1)} m/s`);
    rows.push([tr('Wetter', 'Weather'), parts.join(' · ')]);
  }
  if (run.target && hasRunTarget(run.target)) {
    rows.push([
      tr('Ziel unterwegs', 'Goal during the run'),
      runTargetLabel(run.target),
    ]);
  }
  rows.push([tr('Quelle', 'Source'), sourceLabel(run.source)]);
  if (run.sourceActivityType)
    rows.push([
      tr('Aktivitätstyp der Quelle', 'Source activity type'),
      run.sourceActivityType,
    ]);
  return rows;
}

function phaseTable(run: ReportRun): string | undefined {
  const phases = run.phases || [];
  if (!phases.length) return undefined;
  const pace = usesPace(normalizeSport(run.sport));
  const hasHeart = phases.some(p => p.avgHeartRate !== undefined);
  const header = [
    tr('Phase', 'Phase'),
    tr('Von', 'From'),
    tr('Bis', 'To'),
    tr('Dauer', 'Duration'),
    tr('Strecke', 'Distance'),
    pace ? tr('Tempo', 'Pace') : tr('Geschw.', 'Speed'),
  ];
  if (hasHeart) header.push(tr('Ø Puls', 'Avg heart rate'));
  const rows = phases.map(p => {
    const seconds = p.endElapsedSeconds - p.startElapsedSeconds;
    const moving = p.state === 'RUN' || p.state === 'WALK';
    const row = [
      stateLabel(p.state),
      formatDuration(p.startElapsedSeconds),
      formatDuration(p.endElapsedSeconds),
      formatDuration(seconds),
      moving ? `${fmt(p.distanceMeters / 1000, 2)} km` : '–',
      moving
        ? pace
          ? formatPace(p.distanceMeters, seconds)
          : formatSpeed(p.distanceMeters, seconds)
        : '–',
    ];
    if (hasHeart)
      row.push(p.avgHeartRate !== undefined ? `${int(p.avgHeartRate)} bpm` : '–');
    return row;
  });
  return table(header, rows);
}

function phaseMetricLines(run: ReportRun): string[] {
  const m = run.phaseMetrics;
  if (!m) return [];
  const pace = usesPace(normalizeSport(run.sport));
  const lines: string[] = [];
  if (m.longestRunSeconds !== undefined && m.longestRunMeters !== undefined) {
    lines.push(
      tr(
        `- Längste Laufphase am Stück: ${fmt(m.longestRunMeters / 1000, 2)} km in ${formatDuration(
          m.longestRunSeconds,
        )}`,
        `- Longest run phase without a break: ${fmt(m.longestRunMeters / 1000, 2)} km in ${formatDuration(
          m.longestRunSeconds,
        )}`,
      ),
    );
  }
  if (m.longestMovingSeconds !== undefined)
    lines.push(
      tr(
        `- Längste Bewegung ohne Stillstand: ${formatDuration(m.longestMovingSeconds)}`,
        `- Longest movement without standing still: ${formatDuration(m.longestMovingSeconds)}`,
      ),
    );
  lines.push(
    tr(
      `- Wechsel zwischen Laufen und Gehen: ${m.runWalkTransitions}`,
      `- Changes between running and walking: ${m.runWalkTransitions}`,
    ),
  );
  if (m.fastestSustained300sSecondsPerKm !== undefined && pace) {
    lines.push(
      tr(
        `- Schnellste 5 Minuten am Stück: ${formatDuration(
          m.fastestSustained300sSecondsPerKm,
        )} /km`,
        `- Fastest 5 minutes in a row: ${formatDuration(
          m.fastestSustained300sSecondsPerKm,
        )} /km`,
      ),
    );
  }
  if (m.trailingIdleSeconds >= 300) {
    lines.push(
      tr(
        `- Am Ende ${formatDuration(
          m.trailingIdleSeconds,
        )} ohne Bewegung: vermutlich wurde die Aufzeichnung nicht gestoppt.`,
        `- ${formatDuration(
          m.trailingIdleSeconds,
        )} without movement at the end: the recording was probably not stopped.`,
      ),
    );
  }
  return lines;
}

function segmentTable(run: ReportRun): string | undefined {
  const segments = run.segments || [];
  if (!segments.length) return undefined;
  const pace = usesPace(normalizeSport(run.sport));
  const hasMoving = segments.some(s => s.movingSeconds !== undefined);
  const hasHeart = segments.some(s => s.avgHeartRate !== undefined);
  const hasCadence = segments.some(s => s.avgCadence !== undefined);
  const hasGrade = segments.some(s => s.gradePercent !== undefined);
  const hasClimb = segments.some(s => s.ascentMeters !== undefined);
  const hasGap = segments.some(s => (s.gapSeconds ?? 0) > 0);
  const hasPhase = segments.some(s => s.phase);
  const header = [
    '#',
    tr('Bis km', 'To km'),
    tr('Länge', 'Length'),
    tr('Zeit', 'Time'),
  ];
  if (hasMoving) header.push(tr('In Bewegung', 'Moving'));
  header.push(pace ? tr('Tempo', 'Pace') : tr('Geschw.', 'Speed'));
  if (hasHeart) header.push(tr('Ø Puls', 'Avg heart rate'));
  if (hasCadence) header.push(tr('Ø Kadenz', 'Avg cadence'));
  if (hasGrade) header.push(tr('Steigung', 'Grade'));
  if (hasClimb) header.push(tr('Auf / Ab', 'Up / down'));
  if (hasGap) header.push(tr('GPS-Lücke', 'GPS gap'));
  if (hasPhase) header.push(tr('Phase', 'Phase'));
  let cumulative = 0;
  const rows = segments.map((s, i) => {
    cumulative += s.distanceMeters;
    const row = [
      String(i + 1),
      fmt(cumulative / 1000, 2),
      `${fmt(s.distanceMeters / 1000, 2)} km`,
      formatDuration(s.durationSeconds),
    ];
    if (hasMoving)
      row.push(s.movingSeconds !== undefined ? formatDuration(s.movingSeconds) : '–');
    row.push(
      pace
        ? formatPace(s.distanceMeters, s.durationSeconds)
        : formatSpeed(s.distanceMeters, s.durationSeconds),
    );
    if (hasHeart)
      row.push(
        s.avgHeartRate !== undefined ? `${int(s.avgHeartRate)} bpm` : '–',
      );
    if (hasCadence)
      row.push(s.avgCadence !== undefined ? `${int(s.avgCadence)}` : '–');
    if (hasGrade)
      row.push(
        s.gradePercent !== undefined
          ? `${fmt(s.gradePercent, 1)}${percentSign()}`
          : '–',
      );
    if (hasClimb)
      row.push(
        s.ascentMeters !== undefined
          ? `+${int(s.ascentMeters)} / −${int(s.descentMeters)} m`
          : '–',
      );
    if (hasGap)
      row.push((s.gapSeconds ?? 0) > 0 ? formatDuration(s.gapSeconds as number) : '–');
    if (hasPhase) row.push(phaseLabel(s.phase));
    return row;
  });
  return table(header, rows);
}

function timelineTable(
  run: ReportRun,
  timeline: RunTimeline,
): string | undefined {
  if (!timeline.rows.length) return undefined;
  const pace = usesPace(normalizeSport(run.sport));
  const hasHeart = timeline.rows.some(r => r.avgHeartRate !== undefined);
  const hasCadence = timeline.rows.some(r => r.avgCadence !== undefined);
  const hasAltitude = timeline.rows.some(r => r.altitudeM !== undefined);
  const header = [
    tr('Zeit seit Start', 'Time since start'),
    tr('km gesamt', 'km total'),
    pace
      ? tr('Tempo im Fenster', 'Pace in window')
      : tr('Geschw. im Fenster', 'Speed in window'),
  ];
  if (hasHeart) header.push(tr('Ø Puls', 'Avg heart rate'));
  if (hasCadence) header.push(tr('Ø Kadenz', 'Avg cadence'));
  if (hasAltitude) header.push(tr('Höhe', 'Elevation'));
  const rows = timeline.rows.map(r => {
    const row = [
      formatDuration(r.elapsedSeconds),
      fmt(r.distanceMeters / 1000, 2),
      r.stepDistanceMeters >= 50 && r.gpsCoveredSeconds > 0
        ? pace
          ? formatPace(r.stepDistanceMeters, r.gpsCoveredSeconds)
          : formatSpeed(r.stepDistanceMeters, r.gpsCoveredSeconds)
        : '–',
    ];
    if (hasHeart)
      row.push(
        r.avgHeartRate !== undefined ? `${int(r.avgHeartRate)} bpm` : '–',
      );
    if (hasCadence)
      row.push(r.avgCadence !== undefined ? int(r.avgCadence) : '–');
    if (hasAltitude)
      row.push(r.altitudeM !== undefined ? `${int(r.altitudeM)} m` : '–');
    return row;
  });
  return table(header, rows);
}

function eventLines(run: ReportRun): string[] {
  const events = (run.events || []).filter(
    e => e.type && e.type !== 'feedback' && typeof e.at === 'number',
  );
  return events.map(e => {
    const message =
      e.message ||
      (typeof e.data?.message === 'string' ? (e.data.message as string) : '');
    const label = eventLabel(e.type as string);
    return `- ${clock(e.at as number)} — ${label}${
      message ? `: ${message}` : ''
    }`;
  });
}

function impressionLines(run: ReportRun, context?: RunReportContext): string[] {
  const lines: string[] = [];
  if (run.rpe?.legs !== undefined)
    lines.push(`- ${tr('Beine', 'Legs')}: ${run.rpe.legs} ${tr('von 10', 'of 10')}`);
  if (run.rpe?.breathing !== undefined)
    lines.push(
      `- ${tr('Atmung', 'Breathing')}: ${run.rpe.breathing} ${tr('von 10', 'of 10')}`,
    );
  if (context?.adherence) {
    const adherenceLabel = (
      {
        yes: tr('Ja', 'Yes'),
        no: tr('Nein', 'No'),
        unknown: tr('Unklar', 'Unclear'),
      } as const
    )[context.adherence];
    lines.push(
      `- ${tr('Empfehlung ausprobiert', 'Tried the recommendation')}: ${adherenceLabel}`,
    );
  }
  if (run.note?.trim())
    lines.push(`- ${tr('Notiz', 'Note')}:\n\n${blockquote(run.note)}`);
  return lines;
}

export interface QualityIssueGroup {
  code: string;
  sensor: QualityIssue['sensor'];
  count: number;
  suspected: boolean;
  message: string;
  segmentIds: string[];
  /** Affected time ranges in seconds since the start, when the segments know them. */
  ranges: [number, number][];
}
export interface DataQuality {
  model_version: string;
  gps: {
    /** Share of the recorded time with valid GPS steps; missing without a gap list. */
    coverage?: number;
    rejectedSteps?: number;
    gaps?: number;
    usable: boolean;
  };
  heartRate: {
    available: boolean;
    coverage?: number;
    source?: string;
    usable: boolean;
    reason?: 'NO_HR_SOURCE' | 'NO_USABLE_SEGMENTS';
  };
  cadence: { available: boolean; coverage?: number };
  elevation: {
    available: boolean;
    source?: 'barometer' | 'gps';
    rejectedSamples?: number;
    usable: boolean;
    reason?: string;
  };
  issues: QualityIssueGroup[];
}

/**
 * Data quality as measured numbers: coverages, counts, time ranges. A total
 * score is deliberately missing — it would be invented. `usable` is the
 * versioned decision of the rules in analysis.ts.
 */
export function dataQualityFor(
  run: ReportRun,
  analysis?: RunAnalysis | null,
): DataQuality {
  const quality = analysis?.quality;
  const segments = run.segments || [];
  const rangeOf = (segmentId: string): [number, number] | undefined => {
    const index = segments.findIndex((s, i) => (s.id ?? `split-${i + 1}`) === segmentId);
    const s = segments[index];
    if (!s || s.startElapsedSeconds === undefined || s.endElapsedSeconds === undefined)
      return undefined;
    return [Math.round(s.startElapsedSeconds), Math.round(s.endElapsedSeconds)];
  };
  const groups = new Map<string, QualityIssueGroup>();
  for (const issue of quality?.issues ?? []) {
    const group = groups.get(issue.code) ?? {
      code: issue.code,
      sensor: issue.sensor,
      count: 0,
      suspected: issue.suspected,
      message: issue.message,
      segmentIds: [],
      ranges: [],
    };
    group.count++;
    if (issue.segmentId) {
      group.segmentIds.push(issue.segmentId);
      const range = rangeOf(issue.segmentId);
      if (range) group.ranges.push(range);
    }
    groups.set(issue.code, group);
  }
  const gapSeconds = (run.gaps || []).reduce(
    (a, g) => a + Math.max(0, g.toElapsedSeconds - g.fromElapsedSeconds),
    0,
  );
  const active = run.time?.activeSeconds ?? run.durationSeconds;
  const sources = run.sensorSources;
  const hrAvailable = run.avgHeartRate !== undefined;
  const elevation = run.elevation;
  const elevationSuspect = groups.has('suspected_elevation');
  return {
    model_version: QUALITY_VERSION,
    gps: {
      coverage:
        run.gaps && active > 0
          ? Math.max(0, Math.min(1, 1 - gapSeconds / active))
          : undefined,
      rejectedSteps: run.gapCount,
      gaps: run.gaps?.length,
      usable: quality?.paceUsable ?? false,
    },
    heartRate: {
      available: hrAvailable,
      coverage: run.heartRateCoverage,
      source: sources?.heartRate,
      usable: quality?.heartRateUsable ?? false,
      reason: !hrAvailable
        ? 'NO_HR_SOURCE'
        : quality && !quality.heartRateUsable
        ? 'NO_USABLE_SEGMENTS'
        : undefined,
    },
    cadence: {
      available: run.avgCadence !== undefined,
      coverage: run.cadenceCoverage,
    },
    elevation: elevation?.available
      ? {
          available: true,
          source: elevation.source,
          rejectedSamples: elevation.rejectedSamples,
          usable: !elevationSuspect,
          reason: elevationSuspect ? 'IMPLAUSIBLE_GRADE' : undefined,
        }
      : {
          available: false,
          usable: false,
          reason: elevation ? elevation.reason : 'NO_ELEVATION_MODEL',
        },
    issues: [...groups.values()],
  };
}

function analysisLines(run: ReportRun, analysis: RunAnalysis): string[] {
  const lines: string[] = [];
  lines.push(`- ${tr('Einordnung', 'Assessment')}: ${analysis.classification}`);
  lines.push(`- ${tr('Nächster Schritt', 'Next step')}: ${analysis.nextAction}`);
  const dq = dataQualityFor(run, analysis);
  const gpsCoverage =
    dq.gps.coverage !== undefined
      ? tr(
          ` (GPS-Abdeckung ${percent(dq.gps.coverage)})`,
          ` (GPS coverage ${percent(dq.gps.coverage)})`,
        )
      : '';
  const heartCoverage =
    dq.heartRate.coverage !== undefined
      ? tr(
          ` (Abdeckung ${percent(dq.heartRate.coverage)})`,
          ` (coverage ${percent(dq.heartRate.coverage)})`,
        )
      : '';
  const heartReason = dq.heartRate.reason ? ` [${dq.heartRate.reason}]` : '';
  const elevationReason = dq.elevation.reason ? ` [${dq.elevation.reason}]` : '';
  lines.push(
    tr(
      `- Datenqualität (${dq.model_version}): Tempo ${usableWord(dq.gps.usable)}${gpsCoverage}; Puls ${usableWord(dq.heartRate.usable)}${heartCoverage}${heartReason}; Höhe ${usableWord(dq.elevation.usable)}${elevationReason}`,
      `- Data quality (${dq.model_version}): pace ${usableWord(dq.gps.usable)}${gpsCoverage}; heart rate ${usableWord(dq.heartRate.usable)}${heartCoverage}${heartReason}; elevation ${usableWord(dq.elevation.usable)}${elevationReason}`,
    ),
  );
  for (const group of dq.issues) {
    const where = group.ranges.length
      ? ` (${group.ranges
          .slice(0, 6)
          .map(([a, b]) => `${formatDuration(a)}–${formatDuration(b)}`)
          .join(', ')}${group.ranges.length > 6 ? ', …' : ''})`
      : '';
    const suspected = group.suspected ? tr('Vermutet: ', 'Suspected: ') : '';
    lines.push(
      `  - ${suspected}${group.message} ×${group.count}${where}`,
    );
  }
  const effort = analysis.effort;
  const speedIndex =
    effort.speedIndex === undefined
      ? tr('nicht bestimmbar', 'not determinable')
      : tr(
          `Tempoindex ${fmt(effort.speedIndex, 0)} (${effort.unit})`,
          `pace index ${fmt(effort.speedIndex, 0)} (${effort.unit})`,
        );
  lines.push(
    `- ${tr('Modellierte Anforderung', 'Modeled effort')}: ${speedIndex}; ${effort.uncertainty}`,
  );
  lines.push(
    tr(
      `  - Faktoren: Tempo ${effort.factors.tempo} · Steigung ${effort.factors.slope} · Wind ${effort.factors.wind} · Wärme ${effort.factors.heat}`,
      `  - Factors: pace ${effort.factors.tempo} · slope ${effort.factors.slope} · wind ${effort.factors.wind} · heat ${effort.factors.heat}`,
    ),
  );
  if (
    effort.sessionLoad?.legs !== undefined ||
    effort.sessionLoad?.breathing !== undefined
  ) {
    const parts: string[] = [];
    if (effort.sessionLoad.legs !== undefined)
      parts.push(`${tr('Beine', 'legs')} ${fmt(effort.sessionLoad.legs, 0)}`);
    if (effort.sessionLoad.breathing !== undefined)
      parts.push(
        `${tr('Atmung', 'breathing')} ${fmt(effort.sessionLoad.breathing, 0)}`,
      );
    lines.push(
      `  - ${tr('Belastung (RPE × Minuten)', 'Load (RPE × minutes)')}: ${parts.join(' · ')}`,
    );
  }
  if (analysis.pacing) {
    const p = analysis.pacing;
    lines.push(
      tr(
        `- Tempoverlauf: erste Hälfte ${formatDuration(
          p.firstPaceSecondsPerKm,
        )} /km, zweite ${formatDuration(
          p.lastPaceSecondsPerKm,
        )} /km, Abfall ${fmt(p.fadePercent, 1)} %, Streuung ${fmt(
          p.coefficientOfVariation * 100,
          1,
        )} %`,
        `- Pace profile: first half ${formatDuration(
          p.firstPaceSecondsPerKm,
        )} /km, second ${formatDuration(
          p.lastPaceSecondsPerKm,
        )} /km, fade ${fmt(p.fadePercent, 1)}%, spread ${fmt(
          p.coefficientOfVariation * 100,
          1,
        )}%`,
      ),
    );
  }
  if (analysis.recommendation) {
    const r = analysis.recommendation;
    lines.push(
      `- ${tr('Empfehlung', 'Recommendation')} ${quote(r.title)}: ${r.action}`,
    );
    lines.push(`  - ${tr('Begründung', 'Reason')}: ${r.reason}`);
  }
  if (analysis.question) {
    lines.push(
      `- ${tr('Offene Frage der App', 'Open question in the app')}: ${analysis.question.text}`,
    );
  }
  lines.push(
    `- ${tr('Modellversion', 'Model version')}: ${analysis.model_version}`,
  );
  return lines;
}

/** Earlier, completed workouts without false starts — the same rule as the statistics. */
function historyBefore(run: ReportRun, context?: RunReportContext): RunSummary[] {
  return (context?.history || []).filter(
    r =>
      r.id !== run.id &&
      r.status !== 'recording' &&
      r.startTime < run.startTime &&
      !isAccidentalRun(r),
  );
}

function contextLines(run: ReportRun, context?: RunReportContext): string[] {
  const lines: string[] = [];
  if (!context) return lines;
  if (context.goal?.trim()) {
    const until = context.goalTargetDate
      ? tr(` (bis ${context.goalTargetDate})`, ` (until ${context.goalTargetDate})`)
      : '';
    lines.push(`- ${tr('Ziel', 'Goal')}: ${context.goal.trim()}${until}`);
  }
  if (context.focus)
    lines.push(`- ${tr('Fokus', 'Focus')}: ${focusLabel(context.focus)}`);
  const history = historyBefore(run, context);
  const skipped = (context.history || []).filter(
    r => r.id !== run.id && r.startTime < run.startTime && isAccidentalRun(r),
  ).length;
  if (skipped) {
    const word =
      skipped === 1 ? tr('Fehlstart', 'false start') : tr('Fehlstarts', 'false starts');
    lines.push(
      `- ${tr('Nicht mitgezählt', 'Not counted')}: ${skipped} ${word} ${tr(
        '(unter 60 s und unter 100 m)',
        '(under 60 s and under 100 m)',
      )}`,
    );
  }
  if (history.length) {
    const windowStats = (days: number) => {
      const from = run.startTime - days * DAY;
      const runs = history.filter(r => r.startTime >= from);
      const km = runs.reduce((a, r) => a + r.distanceMeters, 0) / 1000;
      const count =
        runs.length === 1 ? tr('Einheit', 'workout') : tr('Einheiten', 'workouts');
      return `${runs.length} ${count}, ${fmt(km, 1)} km`;
    };
    lines.push(
      `- ${tr('Vorher in den letzten 7 Tagen', 'Before, in the last 7 days')}: ${windowStats(7)}`,
    );
    lines.push(
      `- ${tr('Vorher in den letzten 28 Tagen', 'Before, in the last 28 days')}: ${windowStats(28)}`,
    );
    const previous = history.reduce((best, r) =>
      r.startTime > best.startTime ? r : best,
    );
    lines.push(
      `- ${tr('Letzte Einheit davor', 'Last workout before')}: ${dateTime(
        previous.startTime,
      )} · ${fmt(previous.distanceMeters / 1000, 2)} km · ${formatDuration(
        previous.durationSeconds,
      )}`,
    );
  }
  return lines;
}

function routeLines(run: ReportRun): string[] {
  const points = (run.route || []).filter(
    p => Number.isFinite(p.latitude) && Number.isFinite(p.longitude),
  );
  if (points.length < 2) return [];
  const lat = points.map(p => p.latitude);
  const lon = points.map(p => p.longitude);
  const coord = (p: ReportRoutePoint) =>
    `${fmt(p.latitude, 5)}, ${fmt(p.longitude, 5)}`;
  return [
    `- ${tr('Start', 'Start')}: ${coord(points[0])}`,
    `- ${tr('Ende', 'End')}: ${coord(points[points.length - 1])}`,
    `- ${tr('Ausdehnung', 'Extent')}: ${fmt(Math.min(...lat), 5)}–${fmt(
      Math.max(...lat),
      5,
    )} N, ${fmt(Math.min(...lon), 5)}–${fmt(Math.max(...lon), 5)} ${tr('O', 'E')}`,
    tr(
      `- ${points.length} gespeicherte Punkte (ausgedünnt); Koordinaten bleiben in der App`,
      `- ${points.length} saved points (thinned); coordinates stay in the app`,
    ),
  ];
}

const round = (value: number | undefined, digits: number) =>
  value !== undefined && Number.isFinite(value)
    ? Number(value.toFixed(digits))
    : undefined;

function historyStats(run: ReportRun, context?: RunReportContext) {
  const history = historyBefore(run, context);
  const window = (days: number) => {
    const runs = history.filter(r => r.startTime >= run.startTime - days * DAY);
    return {
      sessions: runs.length,
      distanceMeters: round(
        runs.reduce((a, r) => a + r.distanceMeters, 0),
        0,
      ),
      durationSeconds: round(
        runs.reduce((a, r) => a + r.durationSeconds, 0),
        0,
      ),
    };
  };
  const previous = history.length
    ? history.reduce((best, r) => (r.startTime > best.startTime ? r : best))
    : undefined;
  return {
    rule: tr(
      'Nur abgeschlossene Einheiten derselben Sportart vor diesem Start; Fehlstarts (< 60 s und < 100 m) ausgeschlossen.',
      'Only completed workouts of the same sport before this start; false starts (< 60 s and < 100 m) excluded.',
    ),
    last7Days: window(7),
    last28Days: window(28),
    previous: previous
      ? {
          id: previous.id,
          startTime: iso(previous.startTime),
          distanceMeters: round(previous.distanceMeters, 0),
          durationSeconds: round(previous.durationSeconds, 0),
        }
      : undefined,
  };
}

function timeAndPace(run: ReportRun) {
  const time: TimeBudget | undefined = run.time;
  const pace = (meters: number, seconds: number) =>
    meters >= 100 && seconds > 0 ? round(seconds / (meters / 1000), 0) : undefined;
  const running = run.phaseMetrics?.running;
  return {
    time: time
      ? {
          model_version: time.model_version,
          elapsedSeconds: round(time.elapsedSeconds, 0),
          pausedSeconds: round(time.pausedSeconds, 0),
          activeSeconds: round(time.activeSeconds, 0),
          movingSeconds: round(time.movingSeconds, 0),
          runningSeconds: round(time.runningSeconds, 0),
          walkingSeconds: round(time.walkingSeconds, 0),
          stoppedSeconds: round(time.stoppedSeconds, 0),
          unknownSeconds: round(time.unknownSeconds, 0),
          definition:
            'elapsed = paused + running + walking + stopped + unknown; active = elapsed − paused; moving = running + walking',
        }
      : {
          elapsedSeconds: round((run.endTime - run.startTime) / 1000, 0),
          activeSeconds: round(run.durationSeconds, 0),
          definition: tr(
            'Ohne Phasenerkennung (Altdaten, Import): nur Aufzeichnungszeit ohne Pausen bekannt; keine Bewegungszeit.',
            'Without phase detection (old data, import): only recorded time without pauses is known; no moving time.',
          ),
        },
    pace: {
      activeSecondsPerKm: pace(
        run.distanceMeters,
        time ? time.activeSeconds : run.durationSeconds,
      ),
      movingSecondsPerKm: time ? pace(run.distanceMeters, time.movingSeconds) : undefined,
      runningSecondsPerKm: running ? pace(running.meters, running.seconds) : undefined,
      note: tr(
        'runningSecondsPerKm ist das Tempo der als RUN erkannten Phasen und durch die Erkennungsschwelle nach oben verzerrt; es ist keine Easy Pace.',
        'runningSecondsPerKm is the pace of the phases detected as RUN and is skewed upward by the detection threshold; it is not an easy pace.',
      ),
    },
  };
}

function splitsFor(run: ReportRun) {
  let cumulative = 0;
  return run.segments?.map((s, i) => {
    cumulative += s.distanceMeters;
    return {
      id: s.id ?? `split-${i + 1}`,
      index: i + 1,
      endDistanceMeters: round(cumulative, 1),
      distanceMeters: round(s.distanceMeters, 1),
      elapsedSeconds: round(s.durationSeconds, 1),
      movingSeconds: round(s.movingSeconds, 1),
      gapSeconds: round(s.gapSeconds, 1),
      startElapsedSeconds: round(s.startElapsedSeconds, 1),
      endElapsedSeconds: round(s.endElapsedSeconds, 1),
      avgHeartRate: round(s.avgHeartRate, 1),
      avgCadence: round(s.avgCadence, 1),
      gradePercent: round(s.gradePercent, 2),
      ascentMeters: round(s.ascentMeters, 1),
      descentMeters: round(s.descentMeters, 1),
      phase: s.phase,
    };
  });
}

function phasesFor(run: ReportRun) {
  return run.phases?.map((p: MovementPhase) => ({
    state: p.state,
    startElapsedSeconds: p.startElapsedSeconds,
    endElapsedSeconds: p.endElapsedSeconds,
    seconds: p.endElapsedSeconds - p.startElapsedSeconds,
    distanceMeters: round(p.distanceMeters, 1),
    avgHeartRate: round(p.avgHeartRate, 1),
    avgCadence: round(p.avgCadence, 1),
  }));
}

function sensorFor(run: ReportRun) {
  const sources = run.sensorSources;
  const hr = run.avgHeartRate !== undefined;
  return {
    heartRate: hr
      ? {
          available: true,
          source: sources?.heartRate,
          coverage: round(run.heartRateCoverage, 3),
          avg: round(run.avgHeartRate, 1),
          max: round(run.avgHeartRateMax, 0),
          min: round(run.avgHeartRateMin, 0),
          zones: null,
          zonesReason: 'NO_MAX_HR_CONFIGURED',
        }
      : { available: false, reason: 'NO_HR_SOURCE' },
    cadence:
      run.avgCadence !== undefined
        ? {
            available: true,
            coverage: round(run.cadenceCoverage, 3),
            avg: round(run.avgCadence, 1),
            max: round(run.avgCadenceMax, 0),
            min: round(run.avgCadenceMin, 0),
          }
        : { available: false },
  };
}

function elevationFor(run: ReportRun) {
  const e: ElevationSummary | undefined = run.elevation;
  if (!e) {
    return run.elevationGainMeters !== undefined
      ? { available: true, source: 'import', ascentMeters: round(run.elevationGainMeters, 0) }
      : { available: false, reason: 'NO_ELEVATION_MODEL' };
  }
  return e.available
    ? {
        model_version: e.model_version,
        available: true,
        source: e.source,
        reference: e.reference,
        ascentMeters: round(e.ascentMeters, 0),
        descentMeters: round(e.descentMeters, 0),
        rejectedSamples: e.rejectedSamples,
        hysteresisMeters: e.hysteresisMeters,
      }
    : { model_version: e.model_version, available: false, reason: e.reason };
}

/**
 * `…_analysis.json`: everything an analysis needs, without the time series and
 * without the route. Units: seconds, meters, bpm, /min; times ISO 8601 (UTC).
 */
export function buildRunAnalysisExport(input: RunReportInput) {
  const { run, analysis, context } = input;
  const now = input.now ?? Date.now();
  const m = run.phaseMetrics;
  const pace = (meters: number | undefined, seconds: number | undefined) =>
    meters !== undefined && seconds !== undefined && meters >= 100 && seconds > 0
      ? round(seconds / (meters / 1000), 0)
      : undefined;
  return {
    exportVersion: RUN_ANALYSIS_EXPORT_VERSION,
    exportedAt: iso(now),
    units: {
      time: 's',
      distance: 'm',
      pace: 's/km',
      heartRate: 'bpm',
      cadence: '/min',
      elevation: 'm',
    },
    run: {
      id: run.id,
      title: runTitle(run),
      sport: normalizeSport(run.sport),
      purpose: run.purpose,
      validity: runValidity(run),
      startTime: iso(run.startTime),
      endTime: iso(run.endTime),
      distanceMeters: round(run.distanceMeters, 1),
      source: run.source,
      sourceActivityType: run.sourceActivityType,
      sensorSources: run.sensorSources,
      distanceModelVersion: run.model_version,
      rawSampleCount: run.samples,
      weather: run.context,
      target: hasRunTarget(run.target) ? run.target : undefined,
      rpe: run.rpe,
      note: run.note,
    },
    ...timeAndPace(run),
    phases: phasesFor(run),
    phaseMetrics: m
      ? {
          model_version: m.model_version,
          longestRunSeconds: m.longestRunSeconds,
          longestRunMeters: round(m.longestRunMeters, 0),
          longestMovingSeconds: m.longestMovingSeconds,
          runWalkTransitions: m.runWalkTransitions,
          trailingIdleSeconds: m.trailingIdleSeconds,
          fastestSustained300sSecondsPerKm: round(m.fastestSustained300sSecondsPerKm, 0),
          running: { ...m.running, meters: round(m.running.meters, 0), secondsPerKm: pace(m.running.meters, m.running.seconds) },
          walking: { ...m.walking, meters: round(m.walking.meters, 0), secondsPerKm: pace(m.walking.meters, m.walking.seconds) },
          stopped: { seconds: round(m.stopped.seconds, 0), avgHeartRate: round(m.stopped.avgHeartRate, 1) },
        }
      : undefined,
    splits: splitsFor(run),
    gaps: run.gaps?.map(g => ({
      fromElapsedSeconds: round(g.fromElapsedSeconds, 1),
      toElapsedSeconds: round(g.toElapsedSeconds, 1),
      reason: g.reason,
    })),
    ...sensorFor(run),
    elevation: elevationFor(run),
    load: analysis?.effort.sessionLoad,
    analysis: analysis
      ? {
          model_version: analysis.model_version,
          state: analysis.state,
          classification: analysis.classification,
          nextAction: analysis.nextAction,
          pacing: analysis.pacing,
          effort: {
            speedIndex: round(analysis.effort.speedIndex, 1),
            unit: analysis.effort.unit,
            uncertainty: analysis.effort.uncertainty,
          },
          recommendation: analysis.recommendation
            ? {
                id: analysis.recommendation.id,
                kind: analysis.recommendation.kind,
                title: analysis.recommendation.title,
                action: analysis.recommendation.action,
                reason: analysis.recommendation.reason,
              }
            : undefined,
          question: analysis.question?.text,
        }
      : undefined,
    dataQuality: dataQualityFor(run, analysis),
    context: {
      goal: context?.goal?.trim() || undefined,
      goalTargetDate: context?.goalTargetDate,
      focus: context?.focus ? focusLabel(context.focus) : undefined,
      adherence: context?.adherence,
      history: historyStats(run, context),
    },
    events: run.events
      ?.filter(e => e.type && e.type !== 'feedback')
      .map(e => ({
        type: e.type,
        at: iso(e.at),
        elapsedSeconds:
          typeof e.at === 'number' ? round((e.at - run.startTime) / 1000, 0) : undefined,
        message:
          e.message ||
          (typeof e.data?.message === 'string' ? e.data.message : undefined),
      })),
  };
}

/** Compact JSON appendix of the Markdown report: summary without the time series and route. */
function machineReadable(input: RunReportInput) {
  const { run, analysis, context } = input;
  return {
    reportVersion: RUN_REPORT_VERSION,
    run: {
      id: run.id,
      title: runTitle(run),
      sport: normalizeSport(run.sport),
      purpose: run.purpose,
      validity: runValidity(run),
      startTime: iso(run.startTime),
      endTime: iso(run.endTime),
      durationSeconds: round(run.durationSeconds, 1),
      distanceMeters: round(run.distanceMeters, 1),
      avgHeartRate: run.avgHeartRate,
      heartRateCoverage: run.heartRateCoverage,
      avgCadence: run.avgCadence,
      cadenceCoverage: run.cadenceCoverage,
      calories: run.calories,
      steps: run.steps,
      context: run.context,
      target: hasRunTarget(run.target) ? run.target : undefined,
      rpe: run.rpe,
      note: run.note,
      source: run.source,
      sourceActivityType: run.sourceActivityType,
      sourceVersion: run.sourceVersion,
      samples: run.samples,
    },
    ...timeAndPace(run),
    phaseMetrics: run.phaseMetrics,
    elevation: elevationFor(run),
    segments: splitsFor(run),
    dataQuality: dataQualityFor(run, analysis),
    analysis: analysis
      ? {
          model_version: analysis.model_version,
          state: analysis.state,
          classification: analysis.classification,
          nextAction: analysis.nextAction,
          effort: analysis.effort,
          pacing: analysis.pacing,
          recommendation: analysis.recommendation
            ? {
                id: analysis.recommendation.id,
                kind: analysis.recommendation.kind,
                title: analysis.recommendation.title,
                action: analysis.recommendation.action,
                reason: analysis.recommendation.reason,
              }
            : undefined,
        }
      : undefined,
    context: context
      ? {
          goal: context.goal?.trim() || undefined,
          goalTargetDate: context.goalTargetDate,
          focus: context.focus ? focusLabel(context.focus) : undefined,
          adherence: context.adherence,
          history: historyStats(run, context),
        }
      : undefined,
  };
}

export function buildRunReport(input: RunReportInput): string {
  const { run, analysis, timeline, context } = input;
  const now = input.now ?? Date.now();
  const words = sportWords(normalizeSport(run.sport));
  const parts: string[] = [];
  parts.push(
    `# ${runTitle(run)} — ${tr(
      `${words.noun} vom ${dateTime(run.startTime)}`,
      `${words.noun} from ${dateTime(run.startTime)}`,
    )}`,
  );
  parts.push(
    tr(
      `Exportiert aus Runback am ${dateTime(now)} · Berichtsformat ${RUN_REPORT_VERSION}. Alle Zeiten in der Zeitzone des Geräts; Zahlen im deutschen Format (Komma als Dezimaltrenner). Fehlende Werte sind als ${quote('–')} markiert und wurden nicht geschätzt.`,
      `Exported from Runback on ${dateTime(now)} · report format ${RUN_REPORT_VERSION}. All times in the device time zone; numbers in English format (point as decimal separator). Missing values are marked ${quote('–')} and were not estimated.`,
    ),
  );

  parts.push(
    `## ${tr('Überblick', 'Overview')}\n\n${table(
      [tr('Kennzahl', 'Metric'), tr('Wert', 'Value')],
      overviewRows(run),
    )}`,
  );

  const impression = impressionLines(run, context);
  if (impression.length)
    parts.push(`## ${words.feelingLabel}\n\n${impression.join('\n')}`);

  const phases = phaseTable(run);
  if (phases) {
    const metrics = phaseMetricLines(run);
    parts.push(
      `## ${tr('Bewegungsphasen', 'Movement phases')}\n\n${tr(
        `Erkannt aus Schrittfrequenz, Tempo und Beschleunigung über 15-s-Fenster; eine Phase dauert mindestens 20 s. ${quote('Pause')} hat der Nutzer ausgelöst, ${quote('Unbekannt')} heißt: keine Daten, die Bewegung oder Stillstand belegen.`,
        `Detected from step rate, pace and acceleration over 15-second windows; a phase lasts at least 20 s. ${quote('Pause')} was set by the user; ${quote('Unknown')} means no data that shows movement or standing still.`,
      )}\n\n${phases}${
        metrics.length ? `\n\n${metrics.join('\n')}` : ''
      }`,
    );
  }

  const segments = segmentTable(run);
  if (segments) {
    parts.push(
      `## ${tr('Kilometer-Abschnitte', 'Kilometer splits')}\n\n${tr(
        'Abschnitte enden bei jedem vollen Kilometer oder an einer Pause; der letzte ist meist kürzer. GPS-Lücken bleiben im Abschnitt und stehen als eigene Spalte.',
        'Segments end at each whole kilometer or at a pause; the last one is usually shorter. GPS gaps stay within the segment and appear in their own column.',
      )}\n\n${segments}`,
    );
  }

  if (timeline) {
    const rows = timelineTable(run, timeline);
    if (rows) {
      parts.push(
        `## ${tr('Zeitverlauf', 'Time course')}\n\n${tr(
          `Fenster von je ${formatDuration(
            timeline.stepSeconds,
          )} min (m:ss) seit dem Start, Pausen eingeschlossen. Tempo bezieht sich nur auf Sekunden mit gültigen GPS-Schritten im Fenster; Fenster ohne Messwerte fehlen. Die feine 5-s-Zeitreihe liegt in der CSV-Datei.`,
          `Windows of ${formatDuration(
            timeline.stepSeconds,
          )} min (m:ss) each since the start, pauses included. Pace only counts seconds with valid GPS steps in the window; windows without measurements are left out. The fine 5-second time series is in the CSV file.`,
        )}\n\n${rows}`,
      );
    }
  }

  const events = eventLines(run);
  if (events.length)
    parts.push(`## ${tr('Ereignisse', 'Events')}\n\n${events.join('\n')}`);

  if (analysis)
    parts.push(
      `## ${tr('Auswertung durch Runback', 'Analysis by Runback')}\n\n${analysisLines(run, analysis).join('\n')}`,
    );

  const ctx = contextLines(run, context);
  if (ctx.length)
    parts.push(`## ${tr('Trainingskontext', 'Training context')}\n\n${ctx.join('\n')}`);

  const route = routeLines(run);
  if (route.length) parts.push(`## ${tr('Strecke', 'Route')}\n\n${route.join('\n')}`);

  parts.push(
    `## ${tr('Daten als JSON', 'Data as JSON')}\n\n${tr(
      `Zusammenfassung maschinenlesbar. Zeiten als ISO 8601 (UTC), Strecken in Metern, Dauern in Sekunden. Phasen, Lücken und Ereignisse stehen vollständig in der Datei ${quote('…_analysis.json')}, die Zeitreihe in ${quote('…_timeseries.csv')}.`,
      `Machine-readable summary. Times as ISO 8601 (UTC), distances in meters, durations in seconds. Phases, gaps and events are listed in full in the file ${quote('…_analysis.json')}, the time series in ${quote('…_timeseries.csv')}.`,
    )}\n\n\`\`\`json\n${JSON.stringify(
      machineReadable(input),
      null,
      1,
    )}\n\`\`\``,
  );
  return parts.join('\n\n') + '\n';
}

/** File name without special characters: date, time and title. */
export function runReportFileName(run: ReportRun): string {
  return `${runExportBaseName(run)}.md`;
}
export function runExportBaseName(run: ReportRun): string {
  const d = new Date(run.startTime);
  const pad = (n: number) => String(n).padStart(2, '0');
  const stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(
    d.getDate(),
  )}_${pad(d.getHours())}-${pad(d.getMinutes())}`;
  // Umlauts become plain letters so German titles still give ASCII file names.
  const slug = runTitle(run)
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return `runback_${stamp}${slug ? `_${slug}` : ''}`;
}
/** The three export files of a run. */
export function runExportFileNames(run: ReportRun) {
  const base = runExportBaseName(run);
  return {
    markdown: `${base}.md`,
    analysis: `${base}_analysis.json`,
    timeseries: `${base}_timeseries.csv`,
  };
}
