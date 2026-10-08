import {
  EffortEstimate,
  Experiment,
  PacingAnalysis,
  Provenance,
  QualityIssue,
  QualityReport,
  Recommendation,
  RunAnalysis,
  RunSummary,
  SegmentAggregate,
} from './types';

import { finite, median } from './inference';
import { fixed, tr } from './i18n';

/**
 * v2: The comparison base is the median of several comparable runs instead of
 * a single conspicuous run (regression to the mean), checked with a sign test.
 * Cadence lock also applies to steps per foot, flatness counts ascent and
 * descent instead of net elevation, and load is RPE × minutes.
 */
export const MODEL_VERSION = 'runback-rules-2.0.0';
/** Data-quality rules; 2: gaps per segment take effect (gapSeconds from distance model 3.0). */
export const QUALITY_VERSION = 'runback-quality-2';
export const PACING_METHOD = 'pacing-fade-v2';
export const MAX_SEGMENTS = 500;
/** From this median late pace fade on, a calmer start is suggested (chosen threshold). */
export const FADE_TRIGGER_PERCENT = 8;
/** Comparison base: at least three, at most five comparable runs. */
export const MINIMUM_BASELINE_RUNS = 3;
export const MAXIMUM_BASELINE_RUNS = 5;
const BASELINE_WINDOW_DAYS = 90;
const DURATION_TOLERANCE_PERCENT = 20;
const DISTANCE_TOLERANCE_PERCENT = 15;
/** Percentage points below which a change in pace fade counts as no change (chosen value). */
export const MINIMUM_RELEVANT_CHANGE_PERCENT_POINTS = 3;
export const SIGN_TEST_ALPHA = 0.05;
/** Ascent plus descent per distance up to which a segment counts as flat. */
export const FLAT_GRADE_PERCENT = 2;
const DAY = 86400000;
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
    const segmentLock = possibleLock && cadenceLocked(s.avgHeartRate, s.avgCadence);
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
  return finite(s.gradePercent) && Math.abs(s.gradePercent) <= FLAT_GRADE_PERCENT;
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

export interface BaselineRun {
  run: RunSummary;
  pacing: PacingAnalysis;
}

/**
 * Comparison runs for the baseline: same purpose, flat, similar size, within 90
 * days before. The triggering run comes first, the most recent earlier runs
 * follow; at most five in total.
 */
export function comparableBaseline(
  run: RunSummary,
  pacing: PacingAnalysis,
  history: RunSummary[],
): BaselineRun[] {
  const seen = new Set<string>([run.canonicalId ?? run.id, run.id]);
  const previous: BaselineRun[] = [];
  const ordered = [...history].sort(
    (a, b) => b.startTime - a.startTime || a.id.localeCompare(b.id),
  );
  for (const candidate of ordered) {
    const canonical = candidate.canonicalId ?? candidate.id;
    if (seen.has(canonical) || seen.has(candidate.id)) {
      continue;
    }
    if (
      candidate.startTime >= run.startTime ||
      run.startTime - candidate.startTime > BASELINE_WINDOW_DAYS * DAY ||
      candidate.purpose !== run.purpose ||
      (candidate.sport ?? 'running') !== (run.sport ?? 'running')
    ) {
      continue;
    }
    if (
      Math.abs(candidate.durationSeconds / run.durationSeconds - 1) * 100 >
        DURATION_TOLERANCE_PERCENT ||
      Math.abs(candidate.distanceMeters / run.distanceMeters - 1) * 100 >
        DISTANCE_TOLERANCE_PERCENT
    ) {
      continue;
    }
    const candidatePacing = pacingFor(candidate);
    if (!candidatePacing || !flatPacingContext(candidate, candidatePacing)) {
      continue;
    }
    seen.add(canonical);
    previous.push({ run: candidate, pacing: candidatePacing });
    if (previous.length >= MAXIMUM_BASELINE_RUNS - 1) {
      break;
    }
  }
  return [{ run, pacing }, ...previous];
}

/**
 * `history` holds all known runs; the comparison baseline is built from them.
 * Without history there can be no recommendation, only observation.
 */
export function analyzeRun(
  run: RunSummary,
  active?: Experiment,
  history: RunSummary[] = [],
): RunAnalysis {
  const quality = assessQuality(run);
  const pacing = pacingFor(run, quality);
  const effort = estimateEffort(run, quality);
  const result: RunAnalysis = {
    ...provenance([run], pacing?.segmentIds ?? []),
    classification: quality.paceUsable
      ? tr(
          'Zeit und Distanz sind für eine einfache Tempoauswertung nutzbar.',
          'Time and distance are usable for a simple pace review.',
        )
      : tr(
          'Dieser Lauf ist gespeichert; Zeit oder Distanz reichen für eine Tempoauswertung nicht aus.',
          'This run is saved; time or distance is not enough for a pace review.',
        ),
    focus: tr(
      'Noch nicht ausreichend beurteilbar.',
      'Not enough data to judge yet.',
    ),
    nextAction: tr(
      'Beim nächsten Lauf die Laufart angeben und geeignete Abschnitte aufzeichnen.',
      'On the next run, set the run type and record usable segments.',
    ),
    state: 'insufficient',
    quality,
    effort,
    pacing,
  };
  if (active && (active.status === 'active' || active.status === 'paused')) {
    return {
      ...result,
      focus:
        active.status === 'paused'
          ? tr('Deine Empfehlung ist pausiert.', 'Your recommendation is paused.')
          : tr(
              'Deine Empfehlung bleibt bestehen.',
              'Your recommendation stays in place.',
            ),
      nextAction:
        active.status === 'paused'
          ? tr(
              'Setze die Empfehlung fort, wenn sie wieder in deinen Alltag passt.',
              'Resume the recommendation when it fits your routine again.',
            )
          : active.recommendation.action,
      state: 'active',
    };
  }
  if (run.purpose === 'unknown' || run.purpose === 'free') {
    result.focus = tr(
      'Ohne gewählte Laufart bewerten wir wechselndes Tempo nicht als Fehler.',
      'Without a run type we do not treat changing pace as a mistake.',
    );
    result.question = {
      id: `purpose-${run.id}`,
      text: tr(
        'War das wechselnde Tempo beabsichtigt?',
        'Was the changing pace intended?',
      ),
      reason: tr(
        'Die Laufart entscheidet, ob eine gleichmäßigere Einteilung sinnvoll ist.',
        'The run type decides whether a more even pacing makes sense.',
      ),
    };
    result.nextAction = tr(
      'Ergänze bei Bedarf die Laufart; die Rückfrage ist freiwillig.',
      'Add the run type if you like; the question is optional.',
    );
    return result;
  }
  if (run.purpose === 'intervals' || run.purpose === 'race') {
    return {
      ...result,
      focus: tr(
        'Temposchwankungen können zu dieser Laufart gehören.',
        'Pace swings can belong to this run type.',
      ),
      nextAction: tr(
        'Für diese Laufart gibt es noch keine ausreichend geprüfte Empfehlung.',
        'There is no sufficiently tested recommendation for this run type yet.',
      ),
    };
  }
  if (!pacing) {
    result.focus = tr(
      'Für die Einteilung fehlen mindestens vier geeignete Abschnitte ab 500 m.',
      'Pacing needs at least four usable segments from 500 m on.',
    );
    result.nextAction = tr(
      'Laufart und geplanten Umfang beibehalten; aus diesen Daten folgt noch keine Änderung.',
      'Keep the run type and planned distance; this data does not call for a change yet.',
    );
    return result;
  }
  const fade = fixed(Math.abs(pacing.fadePercent), 1);
  result.classification =
    pacing.fadePercent >= 0
      ? tr(
          `Die zweite Laufhälfte war ${fade} % langsamer (geeignete Abschnitte).`,
          `The second half was ${fade}% slower (usable segments).`,
        )
      : tr(
          `Die zweite Laufhälfte war ${fade} % schneller (geeignete Abschnitte).`,
          `The second half was ${fade}% faster (usable segments).`,
        );
  if (!flatPacingContext(run, pacing)) {
    return {
      ...result,
      focus: tr(
        'Für eine Empfehlung zur Starteinteilung fehlen vergleichbar flache Abschnitte.',
        'A recommendation on the start pacing needs comparably flat segments.',
      ),
      nextAction: tr(
        'Tempoverteilung als Beobachtung nutzen. Für die Prüfung fehlen vergleichbar flache Abschnitte.',
        'Use the pace split as an observation. The check needs comparably flat segments.',
      ),
    };
  }
  const baseline = comparableBaseline(run, pacing, history);
  const fades = baseline.map(item => item.pacing.fadePercent);
  const medianFade = median(fades);
  if (baseline.length < MINIMUM_BASELINE_RUNS) {
    if (pacing.fadePercent < FADE_TRIGGER_PERCENT) {
      return {
        ...result,
        state: 'maintain',
        focus: tr(
          'Du hast zum Ende nicht deutlich an Tempo verloren.',
          'You did not lose much pace toward the end.',
        ),
        nextAction: tr(
          'Die bisherige Einteilung für diese Laufart beibehalten. Andere Trainingsaspekte bleiben offen.',
          'Keep your current pacing for this run type. Other training aspects stay open.',
        ),
      };
    }
    return {
      ...result,
      focus: tr(
        `Heute hat die zweite Hälfte deutlich nachgelassen. Ein einzelner Lauf trägt keine Empfehlung; es fehlen vergleichbare Läufe (${baseline.length} von ${MINIMUM_BASELINE_RUNS}).`,
        `Today the second half clearly faded. A single run does not support a recommendation; comparable runs are missing (${baseline.length} of ${MINIMUM_BASELINE_RUNS}).`,
      ),
      nextAction: tr(
        'Laufart und Umfang beibehalten. Entschieden wird über den Median mehrerer vergleichbarer flacher Läufe, nicht über einen Ausreißer.',
        'Keep the run type and distance. The decision rests on the median of several comparable flat runs, not on one outlier.',
      ),
    };
  }
  if (medianFade < FADE_TRIGGER_PERCENT) {
    return {
      ...result,
      state: 'maintain',
      focus: tr(
        `Im Median deiner letzten ${baseline.length} vergleichbaren Läufe war die zweite Hälfte ${fixed(
          medianFade,
          1,
        )} % langsamer. Das ist kein Muster, das eine Änderung trägt.`,
        `At the median of your last ${baseline.length} comparable runs, the second half was ${fixed(
          medianFade,
          1,
        )}% slower. That is not a pattern that justifies a change.`,
      ),
      nextAction: tr(
        'Die bisherige Einteilung für diese Laufart beibehalten. Andere Trainingsaspekte bleiben offen.',
        'Keep your current pacing for this run type. Other training aspects stay open.',
      ),
    };
  }
  const opening =
    median(baseline.map(item => item.pacing.firstPaceSecondsPerKm)) * 1.05;
  const isLong = run.purpose === 'long';
  const recommendation: Recommendation = {
    ...provenance(
      baseline.map(item => item.run),
      pacing.segmentIds,
    ),
    id: `calmer-start:${run.id}:${MODEL_VERSION}`,
    kind: 'calmer_start',
    title: tr('Ruhiger beginnen', 'Start more calmly'),
    action: tr(
      `Beginne die nächste vergleichbar flache ${
        isLong ? 'lange' : 'ruhige'
      } Runde in der ersten Hälfte etwa 5 % ruhiger (${formatPace(
        opening,
      )} min/km). Behalte Laufart und geplanten Umfang bei.`,
      `Start your next comparably flat ${
        isLong ? 'long' : 'easy'
      } run about 5% easier in the first half (${formatPace(
        opening,
      )} min/km). Keep the run type and planned distance.`,
    ),
    reason: tr(
      `In ${baseline.length} vergleichbaren Läufen war die zweite Hälfte im Median ${fixed(
        medianFade,
        1,
      )} % langsamer. Probiere einen ruhigeren Start aus; Gelände, Wetter und Tagesform können mitwirken.`,
      `Across ${baseline.length} comparable runs, the second half was ${fixed(
        medianFade,
        1,
      )}% slower at the median. Try a calmer start; terrain, weather and form on the day may play a part.`,
    ),
    purpose: run.purpose,
    goal: tr(
      'Gleichmäßigere Einteilung: weniger später Tempoabfall bei gleicher Laufart und gleichem Umfang. Das ist keine Aussage über Leistungsfähigkeit.',
      'More even pacing: less late pace fade at the same run type and distance. This says nothing about fitness.',
    ),
    criteria: {
      method: PACING_METHOD,
      baselineRunIds: baseline.map(item => item.run.id),
      baselineFadePercent: medianFade,
      signTestAlpha: SIGN_TEST_ALPHA,
      baselineDurationSeconds: median(
        baseline.map(item => item.run.durationSeconds),
      ),
      baselineDistanceMeters: median(
        baseline.map(item => item.run.distanceMeters),
      ),
      baselineContext: run.context ? { ...run.context } : undefined,
      openingPaceSecondsPerKm: opening,
      openingPaceTolerancePercent: 3,
      outcome: 'late_pace_fade_percent',
      minimumRelevantChangePercentPoints: MINIMUM_RELEVANT_CHANGE_PERCENT_POINTS,
      durationTolerancePercent: DURATION_TOLERANCE_PERCENT,
      distanceTolerancePercent: DISTANCE_TOLERANCE_PERCENT,
      minimumObservations: 6,
      minimumDays: 14,
      reviewAfterRuns: 3,
      maxDays: 56,
      exclusions: [
        tr('Andere Laufart', 'Different run type'),
        tr(
          'Dauer außerhalb ±20 % oder Distanz außerhalb ±15 %',
          'Duration outside ±20% or distance outside ±15%',
        ),
        tr(
          'Fehlende oder unzureichende Abschnitte',
          'Missing or insufficient segments',
        ),
        tr(
          'Unbekannte oder nicht flache Steigung',
          'Unknown or not flat grade',
        ),
        tr(
          'Bekannt deutlich abweichendes Wetter',
          'Known weather that differs markedly',
        ),
      ],
      stopConditions: [
        tr(
          'Bei Beschwerden die Empfehlung pausieren; das ist keine Diagnose',
          'If you have complaints, pause the recommendation; this is not a diagnosis',
        ),
        tr('Geändertes Trainingsziel', 'Changed training goal'),
        tr(
          'Modellfehler oder gelöschte Vergleichsläufe',
          'Model error or deleted comparison runs',
        ),
        tr(
          'Nach 56 Tagen mit zu wenig vergleichbaren Läufen neu entscheiden',
          'After 56 days with too few comparable runs, decide again',
        ),
      ],
    },
  };
  return {
    ...result,
    state: 'recommendation',
    focus: recommendation.reason,
    nextAction: recommendation.action,
    recommendation,
  };
}

export function formatPace(seconds: number): string {
  if (!finite(seconds) || seconds <= 0) {
    return '–';
  }
  const rounded = Math.round(seconds);
  return `${Math.floor(rounded / 60)}:${String(rounded % 60).padStart(2, '0')}`;
}
