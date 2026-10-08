import { catalogExercise } from './catalog';
import { focusLabel, type TrainingFocus } from './focus';
import { finite } from './inference';
import { dateFormat, numberFormat, tr } from './i18n';
import { exerciseGroups, MUSCLE_GROUPS_VERSION } from './muscleGroups';
import { PROGRESSION_CHECK_METHOD } from './progression';
import {
  CATALOG_VERSION,
  epley1RM,
  isSetCompleted,
  MAX_REPS_FOR_E1RM,
  displaySessionName,
  type LoggedSet,
  type PlannedSet,
  type StrengthSession,
} from './strength';
import {
  heartSourceLabel,
  sessionHeartInsight,
  STRENGTH_HEART_INSIGHTS_VERSION,
  type SetHeart,
  type StrengthHeart,
} from './strengthHeart';
import {
  exerciseBreakdown,
  sessionDurationSeconds,
  setGaps,
  setLabel,
  STRENGTH_SESSION_VERSION,
} from './strengthSession';

/**
 * Export of all strength sessions recorded in Runback, for analysis or for a
 * language model — the counterpart to the analysis export of runs. Imports
 * (Strong) are deliberately missing: they lack tick-off times and heart rate.
 *
 * A ZIP of flat files, appended piece by piece per session:
 * `trainingslog.md` to read, `sessions.csv`, `sets.csv`, `heart.csv` for
 * tables, and `sessions.jsonl` with everything nested, one session per line.
 * Counted as in the app; what is missing stays empty instead of 0.
 *
 * 2: The watch's motion data lives in the `bewegungsdaten/` folder (Kotlin
 * `MotionExport`, its own `manifest.json`). The folder name is a file name
 * inside the export and stays German.
 */
export const STRENGTH_EXPORT_VERSION = 'runback-strength-export-2';
export const STRENGTH_EXPORT_MOTION_DIRECTORY = 'bewegungsdaten';

export const STRENGTH_EXPORT_FILES = {
  readme: 'README.md',
  log: 'trainingslog.md',
  sessions: 'sessions.csv',
  sets: 'sets.csv',
  heart: 'heart.csv',
  jsonl: 'sessions.jsonl',
} as const;

const SESSION_COLUMNS = [
  'session_id',
  'start_utc',
  'start_local',
  'end_utc',
  'duration_s',
  'status',
  'name',
  'template_id',
  'exercises',
  'sets_completed',
  'sets_working',
  'sets_warmup',
  'sets_skipped',
  'sets_open',
  'total_reps',
  'sets_with_reps',
  'volume_kg',
  'sets_with_volume',
  'median_set_gap_s',
  'end_corrected',
  'heart_source',
  'heart_avg_bpm',
  'heart_max_bpm',
  'heart_min_bpm',
  'heart_coverage',
  'heart_clock_aligned',
  'median_set_peak_bpm',
  'median_recovery_bpm',
  'note',
  'model_version',
  'catalog_version',
];

const SET_COLUMNS = [
  'session_id',
  'session_start_utc',
  'exercise_index',
  'exercise_id',
  'exercise_name',
  'equipment',
  'unilateral',
  'muscle_groups',
  'exercise_added',
  'set_index',
  'set_id',
  'set_kind',
  'load_kind',
  'status',
  'planned_reps',
  'planned_seconds',
  'planned_weight_kg',
  'planned_rest_s',
  'actual_reps',
  'actual_seconds',
  'actual_weight_kg',
  'rir',
  'completed_at_utc',
  'completed_after_s',
  'gap_since_previous_set_s',
  'volume_kg',
  'e1rm_kg',
  'heart_peak_bpm',
  'heart_recovery_bpm',
];

const HEART_COLUMNS = [
  'session_id',
  'window_start_s',
  'window_s',
  'bpm',
  'source',
];

const DAY = 24 * 60 * 60 * 1000;

type Cell = string | number | boolean | undefined | null;

const csvCell = (value: Cell): string => {
  if (value === undefined || value === null) return '';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number')
    return Number.isFinite(value) ? String(value) : '';
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
};
const csvRow = (cells: Cell[]) => cells.map(csvCell).join(',') + '\n';

const round = (value: number | undefined, digits = 1) =>
  finite(value) ? Math.round(value * 10 ** digits) / 10 ** digits : undefined;
const iso = (ms: number | undefined) =>
  finite(ms) ? new Date(ms).toISOString() : undefined;
const pad = (n: number) => String(Math.trunc(Math.abs(n))).padStart(2, '0');
/** Device local time with offset, e.g. `2026-10-05T18:30:00+02:00`. */
function localIso(ms: number): string {
  const d = new Date(ms);
  const offset = -d.getTimezoneOffset();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours(),
  )}:${pad(d.getMinutes())}:${pad(d.getSeconds())}${
    offset >= 0 ? '+' : '-'
  }${pad(offset / 60)}:${pad(offset % 60)}`;
}

const done = (set: LoggedSet) => isSetCompleted(set) && !set.skipped;
const setStatus = (set: LoggedSet) =>
  set.skipped ? 'skipped' : isSetCompleted(set) ? 'completed' : 'open';
/** Volume as in `sessionProgress`: ticked off, load times reps. */
const setVolume = (set: LoggedSet) =>
  done(set) && set.actualWeightKg && set.actualReps
    ? set.actualWeightKg * set.actualReps
    : undefined;
/** As in the progress check: working set with load in kg, up to 12 reps. */
function setE1rm(set: LoggedSet): number | undefined {
  if (
    !done(set) ||
    (set.planned.kind !== 'normal' && set.planned.kind !== 'failure') ||
    set.planned.loadKind !== 'kg' ||
    !finite(set.actualWeightKg) ||
    !finite(set.actualReps)
  )
    return undefined;
  return round(epley1RM(set.actualWeightKg, set.actualReps) ?? undefined, 1);
}

/** Only recorded and finished in Runback; no imports. */
export function isRecordedStrengthSession(session: StrengthSession): boolean {
  return (
    session.kind === 'strength' &&
    !session.importSource &&
    session.status !== 'active' &&
    finite(session.startTime)
  );
}

interface SetRecord {
  exerciseIndex: number;
  setIndex: number;
  set: LoggedSet;
  completedAfterSeconds?: number;
  gapSeconds?: number;
  volumeKg?: number;
  e1rmKg?: number;
  heart?: SetHeart;
}

function setRecords(
  session: StrengthSession,
  heartBySet: Map<string, SetHeart>,
): SetRecord[] {
  return session.exercises.flatMap((exercise, exerciseIndex) => {
    // Set interval as in `setGaps`: ticking off to ticking off the same exercise.
    const times = exercise.sets
      .filter(set => done(set) && finite(set.completedAt))
      .map(set => set.completedAt as number)
      .sort((a, b) => a - b);
    return exercise.sets.map((set, setIndex) => {
      const at =
        done(set) && finite(set.completedAt) ? set.completedAt : undefined;
      const before =
        at === undefined ? undefined : times.filter(t => t < at).pop();
      return {
        exerciseIndex,
        setIndex,
        set,
        completedAfterSeconds:
          at === undefined
            ? undefined
            : round((at - session.startTime) / 1000, 0),
        gapSeconds:
          at === undefined || before === undefined
            ? undefined
            : round((at - before) / 1000, 0),
        volumeKg: round(setVolume(set), 1),
        e1rmKg: setE1rm(set),
        heart: heartBySet.get(set.id),
      };
    });
  });
}

const plannedRecord = (planned: PlannedSet) => ({
  kind: planned.kind,
  loadKind: planned.loadKind,
  reps: planned.reps,
  seconds: planned.seconds,
  weightKg: planned.weightKg,
  restSeconds: planned.restSeconds,
});

function exerciseInfo(exerciseId: string, name: string) {
  const known = catalogExercise(exerciseId);
  return {
    equipment: known?.equipment,
    unilateral: known ? known.unilateral === true : undefined,
    muscleGroups: exerciseGroups(exerciseId, name),
    catalogKnown: Boolean(known),
  };
}

/**
 * Sums only over sets that carry the value; without a single one the sum stays
 * unknown instead of 0. The number of contributing sets is shown alongside,
 * so that a partial sum is recognizable as one.
 */
function sums(records: SetRecord[]) {
  const reps = records
    .map(record => (done(record.set) ? record.set.actualReps : undefined))
    .filter((value): value is number => finite(value) && value > 0);
  const volumes = records
    .map(record => record.volumeKg)
    .filter((value): value is number => finite(value));
  const total = (values: number[]) =>
    values.reduce((sum, value) => sum + value, 0);
  return {
    totalReps: reps.length ? total(reps) : undefined,
    setsWithReps: reps.length,
    volumeKg: volumes.length ? round(total(volumes), 1) : undefined,
    setsWithVolume: volumes.length,
  };
}

export interface StrengthExportChunk {
  sessions: string;
  sets: string;
  heart: string;
  jsonl: string;
  log: string;
  /** Counters for the README. */
  setCount: number;
  heartSessions: number;
}

/**
 * Rows of one session for all files. The session comes with its applied end
 * (as in the app); sets after it are missing.
 */
export function strengthExportChunk(
  session: StrengthSession,
  heart?: StrengthHeart,
): StrengthExportChunk {
  const insight = heart ? sessionHeartInsight(session, heart) : undefined;
  const heartBySet = new Map(insight?.sets.map(set => [set.setId, set]));
  const records = setRecords(session, heartBySet);
  const breakdown = exerciseBreakdown(session);
  const gaps = setGaps(session);
  const duration = sessionDurationSeconds(session);
  const count = (predicate: (set: LoggedSet) => boolean) =>
    records.filter(record => predicate(record.set)).length;
  const completed = count(done);
  const warmup = count(set => done(set) && set.planned.kind === 'warmup');
  const totals = {
    exercises: session.exercises.length,
    completedSets: completed,
    workingSets: completed - warmup,
    warmupSets: warmup,
    skippedSets: count(set => set.skipped === true),
    openSets: count(set => !set.skipped && !isSetCompleted(set)),
    ...sums(records),
    medianSetGapSeconds: round(gaps.medianSeconds, 0),
  };
  const heartSummary = heart
    ? {
        model_version: heart.model_version,
        source: heart.source || 'watch',
        averageBpm: heart.averageBpm,
        maxBpm: heart.maxBpm,
        minBpm: heart.minBpm,
        coverage: heart.coverage,
        clockAligned: heart.clockAligned,
        windowSeconds: heart.stepSeconds,
        medianSetPeakBpm: round(insight?.medianPeakBpm, 1),
        medianRecoveryBpm: round(insight?.medianRecoveryBpm, 1),
      }
    : undefined;

  const sessions = csvRow([
    session.id,
    iso(session.startTime),
    localIso(session.startTime),
    iso(session.endTime),
    round(duration, 0),
    session.status,
    session.name,
    session.templateId,
    totals.exercises,
    totals.completedSets,
    totals.workingSets,
    totals.warmupSets,
    totals.skippedSets,
    totals.openSets,
    totals.totalReps,
    totals.setsWithReps,
    totals.volumeKg,
    totals.setsWithVolume,
    totals.medianSetGapSeconds,
    Boolean(session.endCorrection),
    heartSummary?.source,
    heartSummary?.averageBpm,
    heartSummary?.maxBpm,
    heartSummary?.minBpm,
    heartSummary?.coverage,
    heartSummary?.clockAligned,
    heartSummary?.medianSetPeakBpm,
    heartSummary?.medianRecoveryBpm,
    session.note?.trim() || undefined,
    session.modelVersion,
    session.catalogVersion,
  ]);

  const infos = session.exercises.map(exercise =>
    exerciseInfo(exercise.exerciseId, exercise.name),
  );
  const sets = records
    .map(record => {
      const exercise = session.exercises[record.exerciseIndex];
      const info = infos[record.exerciseIndex];
      const { set } = record;
      const actual = done(set);
      return csvRow([
        session.id,
        iso(session.startTime),
        record.exerciseIndex,
        exercise.exerciseId,
        exercise.name,
        info.equipment,
        info.unilateral,
        info.muscleGroups?.join(';'),
        exercise.added === true,
        record.setIndex,
        set.id,
        set.planned.kind,
        set.planned.loadKind,
        setStatus(set),
        set.planned.reps,
        set.planned.seconds,
        set.planned.weightKg,
        set.planned.restSeconds,
        actual ? set.actualReps : undefined,
        actual ? set.actualSeconds : undefined,
        actual ? set.actualWeightKg : undefined,
        actual ? set.actualRir : undefined,
        actual ? iso(set.completedAt) : undefined,
        record.completedAfterSeconds,
        record.gapSeconds,
        record.volumeKg,
        record.e1rmKg,
        record.heart?.peakBpm,
        round(record.heart?.recoveryBpm, 1),
      ]);
    })
    .join('');

  const heartRows = heart
    ? heart.values
        .map((bpm, index) =>
          csvRow([
            session.id,
            index * heart.stepSeconds,
            heart.stepSeconds,
            bpm,
            heart.source || 'watch',
          ]),
        )
        .join('')
    : '';

  const json = {
    exportVersion: STRENGTH_EXPORT_VERSION,
    id: session.id,
    name: session.name,
    templateId: session.templateId,
    status: session.status,
    startTime: iso(session.startTime),
    startLocal: localIso(session.startTime),
    endTime: iso(session.endTime),
    durationSeconds: round(duration, 0),
    endCorrection: session.endCorrection
      ? {
          originalEndTime: iso(session.endCorrection.originalEndTime),
          excludedSets: session.endCorrection.excludedSetTimes?.length ?? 0,
        }
      : undefined,
    note: session.note?.trim() || undefined,
    modelVersion: session.modelVersion,
    catalogVersion: session.catalogVersion,
    totals,
    heart: heartSummary,
    exercises: session.exercises.map((exercise, exerciseIndex) => {
      const item = breakdown[exerciseIndex];
      return {
        index: exerciseIndex,
        exerciseId: exercise.exerciseId,
        name: exercise.name,
        added: exercise.added === true,
        ...infos[exerciseIndex],
        workingSets: item.workingSets,
        warmupSets: item.warmupSets,
        skippedSets: item.skippedSets,
        ...sums(
          records.filter(record => record.exerciseIndex === exerciseIndex),
        ),
        topWeightKg: item.topWeightKg,
        medianRir: item.medianRir,
        sets: records
          .filter(record => record.exerciseIndex === exerciseIndex)
          .map(record => ({
            index: record.setIndex,
            id: record.set.id,
            status: setStatus(record.set),
            planned: plannedRecord(record.set.planned),
            actual: done(record.set)
              ? {
                  reps: record.set.actualReps,
                  seconds: record.set.actualSeconds,
                  weightKg: record.set.actualWeightKg,
                  rir: record.set.actualRir,
                  completedAt: iso(record.set.completedAt),
                }
              : undefined,
            completedAfterSeconds: record.completedAfterSeconds,
            gapSincePreviousSetSeconds: record.gapSeconds,
            volumeKg: record.volumeKg,
            e1rmKg: record.e1rmKg,
            heartPeakBpm: record.heart?.peakBpm,
            heartRecoveryBpm: round(record.heart?.recoveryBpm, 1),
          })),
      };
    }),
  };

  return {
    sessions,
    sets,
    heart: heartRows,
    jsonl: JSON.stringify(json) + '\n',
    log: logSection(session, totals, duration, heart),
    setCount: records.length,
    heartSessions: heart ? 1 : 0,
  };
}

const dateLabel = () =>
  dateFormat({
    weekday: 'short',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
const number = (value: number, digits = 0) =>
  numberFormat({ maximumFractionDigits: digits }).format(value);

function setLine(set: LoggedSet): string {
  const planned = setLabel(set.planned);
  const plan = planned ? `${tr('Plan', 'Plan')} ${planned}` : '';
  if (set.skipped) {
    return `${tr('übersprungen', 'skipped')}${plan ? ` (${plan})` : ''}`;
  }
  if (!isSetCompleted(set)) {
    return `${tr('nicht abgehakt', 'not ticked off')}${plan ? ` (${plan})` : ''}`;
  }
  const actual =
    setLabel({
      weightKg: set.actualWeightKg,
      reps: set.actualReps,
      seconds: set.actualSeconds,
    }) || tr('abgehakt, ohne Werte', 'ticked off, no values');
  const parts = [
    set.planned.kind === 'warmup'
      ? `${tr('Aufwärmen', 'Warm-up')}: ${actual}`
      : actual,
  ];
  if (finite(set.actualRir)) {
    parts.push(
      tr(
        `${set.actualRir} Wdh. im Tank`,
        `${set.actualRir} ${set.actualRir === 1 ? 'rep' : 'reps'} in reserve`,
      ),
    );
  }
  if (planned && planned !== actual) parts.push(plan);
  return parts.join(' · ');
}

function logSection(
  session: StrengthSession,
  totals: { completedSets: number; volumeKg?: number },
  duration: number | undefined,
  heart?: StrengthHeart,
): string {
  const facts = [
    duration !== undefined
      ? `${number(duration / 60)} min`
      : tr('Dauer unbekannt', 'Duration unknown'),
    tr(
      `${totals.completedSets} Sätze abgehakt`,
      `${totals.completedSets} ${totals.completedSets === 1 ? 'set' : 'sets'} ticked off`,
    ),
    totals.volumeKg
      ? tr(
          `${number(totals.volumeKg)} kg Volumen`,
          `${number(totals.volumeKg)} kg volume`,
        )
      : undefined,
    heart
      ? tr(
          `Puls Ø ${number(heart.averageBpm)}, max ${number(
            heart.maxBpm,
          )} (${heartSourceLabel(heart)})`,
          `Heart rate avg ${number(heart.averageBpm)}, max ${number(
            heart.maxBpm,
          )} (${heartSourceLabel(heart)})`,
        )
      : undefined,
    session.status === 'interrupted'
      ? tr('abgebrochen', 'cancelled')
      : undefined,
  ].filter(Boolean);
  const lines = [
    `## ${dateLabel().format(new Date(session.startTime))} · ${displaySessionName(session.name)}`,
    '',
    facts.join(' · '),
  ];
  if (session.note?.trim()) {
    lines.push(
      '',
      `${tr('Notiz', 'Note')}: ${session.note.trim()}`,
    );
  }
  session.exercises.forEach(exercise => {
    lines.push('', `### ${exercise.name}`, '');
    exercise.sets.forEach(set => lines.push(`- ${setLine(set)}`));
  });
  return lines.join('\n') + '\n\n';
}

export function strengthExportHeaders(): Record<
  'sessions' | 'sets' | 'heart' | 'log',
  string
> {
  return {
    sessions: csvRow(SESSION_COLUMNS),
    sets: csvRow(SET_COLUMNS),
    heart: csvRow(HEART_COLUMNS),
    log: tr(
      '# Krafttraining aus Runback\n\nAlle in Runback aufgezeichneten Einheiten, älteste zuerst. Gewichte in kg, Zahlen im deutschen Format.\n\n',
      '# Strength training from Runback\n\nAll sessions recorded in Runback, oldest first. Weights in kg, numbers in English format.\n\n',
    ),
  };
}

export interface StrengthExportSummary {
  exportedAt: number;
  sessions: number;
  sets: number;
  heartSessions: number;
  /**
   * Sessions with motion data (`MotionStatus.sessions`); if the counter is
   * missing, it is unknown. How many raw files are included only appears in
   * `bewegungsdaten/sessions.csv` — the watch can deliver during the export.
   */
  motionSessions?: number;
  firstStart?: number;
  lastStart?: number;
  goal?: string;
  goalTargetDate?: string;
  focus?: TrainingFocus | null;
}

/** Description of all files and columns — for people and language models. */
export function strengthExportReadme(summary: StrengthExportSummary): string {
  const span =
    summary.firstStart !== undefined && summary.lastStart !== undefined
      ? tr(
          `${iso(summary.firstStart)?.slice(0, 10)} bis ${iso(
            summary.lastStart,
          )?.slice(0, 10)} (${Math.round(
            (summary.lastStart - summary.firstStart) / DAY,
          )} Tage)`,
          `${iso(summary.firstStart)?.slice(0, 10)} to ${iso(
            summary.lastStart,
          )?.slice(0, 10)} (${Math.round(
            (summary.lastStart - summary.firstStart) / DAY,
          )} days)`,
        )
      : tr('keine Einheiten', 'no sessions');
  const context = [
    summary.goal?.trim()
      ? tr(
          `- Ziel Krafttraining: ${summary.goal.trim()}`,
          `- Strength goal: ${summary.goal.trim()}`,
        )
      : '',
    summary.goalTargetDate
      ? tr(
          `- Zieldatum: ${summary.goalTargetDate}`,
          `- Target date: ${summary.goalTargetDate}`,
        )
      : '',
    summary.focus
      ? tr(
          `- Fokus Krafttraining: ${focusLabel(summary.focus)}`,
          `- Strength focus: ${focusLabel(summary.focus)}`,
        )
      : '',
  ].filter(Boolean);
  const motion =
    summary.motionSessions === 0
      ? ''
      : tr(
          `- \`${STRENGTH_EXPORT_MOTION_DIRECTORY}/\`: ${
            summary.motionSessions === undefined
              ? 'Bewegungsdaten der Uhr, falls aufgezeichnet'
              : `Bewegungsdaten der Uhr aus ${summary.motionSessions} Einheiten`
          } — Beschleunigung, Gyroskop, Puls roh, Ereignisse und Erkennungen je Einheit; \`raw_available\` in \`${STRENGTH_EXPORT_MOTION_DIRECTORY}/sessions.csv\` sagt, wo Rohdaten dabei sind. Zeit in ms ab Start der Einheit; Beschreibung in \`${STRENGTH_EXPORT_MOTION_DIRECTORY}/manifest.json\` und docs/motion-data.md im Runback-Repository. \`session_id\` passt zu den Tabellen oben. Die Bewegungsdaten zeigen die Aufzeichnung, wie sie war: Ein vom Nutzer gesetztes Ende gilt dort nicht, später abgehakte Sätze stehen in ihrem \`sets.csv\`.\n`,
          `- \`${STRENGTH_EXPORT_MOTION_DIRECTORY}/\`: ${
            summary.motionSessions === undefined
              ? 'motion data from the watch, if recorded'
              : `motion data from the watch from ${summary.motionSessions} sessions`
          } — acceleration, gyroscope, raw heart rate, events and detections per session; \`raw_available\` in \`${STRENGTH_EXPORT_MOTION_DIRECTORY}/sessions.csv\` says where raw data is included. Time in ms from the start of the session; description in \`${STRENGTH_EXPORT_MOTION_DIRECTORY}/manifest.json\` and docs/motion-data.md in the Runback repository. \`session_id\` matches the tables above. The motion data shows the recording as it was: an end set by the user does not apply there; sets ticked off later are in its \`sets.csv\`.\n`,
        );
  const body = tr(
    `# Runback – Krafttraining-Export

Format \`${STRENGTH_EXPORT_VERSION}\`, exportiert ${iso(summary.exportedAt)}.
${summary.sessions} Einheiten, ${summary.sets} Sätze, ${
    summary.heartSessions
  } Einheiten mit Puls; Zeitraum ${span}.

Enthalten sind nur Einheiten, die Runback selbst aufgezeichnet hat. Importe (z. B. Strong) fehlen.
Hat der Nutzer das Ende einer Einheit gesetzt, gilt dieses Ende; danach abgehakte Sätze fehlen wie in der App.
${context.length ? `\n## Trainingskontext\n\n${context.join('\n')}\n` : ''}
## Regeln

- Fehlende Werte sind leer (CSV) bzw. fehlen (JSON). Nichts ist geschätzt oder mit 0 aufgefüllt.
- Plan (\`planned_*\`) und Ist (\`actual_*\`) liegen getrennt. Ist-Werte gibt es nur für abgehakte Sätze.
- Zeiten: \`*_utc\` als ISO 8601 in UTC, \`start_local\` in der Ortszeit des Geräts mit Versatz.
- Einheiten: kg, Sekunden, Schläge pro Minute. CSV: Komma als Trenner, Punkt als Dezimalzeichen, UTF-8.
- Satzanfänge kennt Runback nicht, nur das Abhaken. Ein Satzabstand enthält Pause und Satz.

## Dateien

- \`trainingslog.md\`: alle Einheiten zum Lesen, je Übung die Sätze mit Plan, wenn er abweicht.
- \`sessions.csv\`: eine Zeile je Einheit.
- \`sets.csv\`: eine Zeile je Satz (auch übersprungene und nicht abgehakte), Schlüssel \`session_id\`.
- \`heart.csv\`: Puls je Zeitfenster ab Start der Einheit. Leeres \`bpm\` heißt: kein gültiger Wert im Fenster.
- \`sessions.jsonl\`: je Zeile eine Einheit als JSON mit Übungen, Sätzen und Puls-Zusammenfassung.
${motion}
## Spalten in sets.csv

- \`set_kind\`: warmup, normal, failure, dropset, timed. \`load_kind\`: kg, bodyweight, assisted (Gewicht = Unterstützung), bodyweight_plus (Gewicht = Zusatzlast), unknown.
- \`status\`: completed, skipped oder open (nicht abgehakt).
- \`rir\`: Wiederholungen im Tank, freiwillige Angabe des Nutzers.
- \`completed_after_s\`: Sekunden vom Start der Einheit bis zum Abhaken.
- \`gap_since_previous_set_s\`: Sekunden seit dem vorigen abgehakten Satz derselben Übung.
- \`volume_kg\`: Gewicht × Wiederholungen eines abgehakten Satzes, wie in der App (auch Aufwärmsätze).
- \`e1rm_kg\`: geschätztes Maximum nach Epley (Gewicht × (1 + Wdh./30)), nur für Arbeitssätze mit Last in kg und höchstens ${MAX_REPS_FOR_E1RM} Wiederholungen. Schätzung, keine Messung.
- \`muscle_groups\`: Hauptgruppen laut Übungskatalog, mit \`;\` getrennt; leer, wenn der Katalog die Übung nicht kennt.
- \`heart_peak_bpm\`: höchster Puls von 30 s vor bis 15 s nach dem Abhaken. \`heart_recovery_bpm\`: Abfall in der Minute danach, nur wenn der nächste Satz frühestens 2 min später kam. Beides nur mit Puls von der Uhr.

## Spalten in sessions.csv

- \`sets_working\`: abgehakt, nicht übersprungen, kein Aufwärmen. \`sets_open\`: weder abgehakt noch übersprungen.
- \`total_reps\`, \`volume_kg\`: Summen nur über abgehakte Sätze mit diesem Wert; leer, wenn kein Satz ihn trägt. \`sets_with_reps\` und \`sets_with_volume\` zählen die beitragenden Sätze — weniger als \`sets_completed\` heißt: Teilsumme.
- \`median_set_gap_s\`: Median der Satzabstände bis 15 min.
- \`heart_source\`: \`watch\` (Uhr) oder \`import:<Quelle>\` (Minutenmittel aus einem Import, ohne Satzwerte).
- \`heart_coverage\`: Anteil der Zeitfenster mit Wert, 0–1. \`heart_clock_aligned\`: Uhr- und Handyzeit abgeglichen.
- \`median_set_peak_bpm\`, \`median_recovery_bpm\`: Median ab drei Sätzen mit Wert.

## Versionen

- Krafttraining: siehe \`model_version\` und \`catalog_version\` je Einheit (aktueller Katalog \`${CATALOG_VERSION}\`).
- Auswertung je Einheit \`${STRENGTH_SESSION_VERSION}\`, Puls je Satz \`${STRENGTH_HEART_INSIGHTS_VERSION}\`, Muskelgruppen \`${MUSCLE_GROUPS_VERSION}\`, geschätztes Maximum \`${PROGRESSION_CHECK_METHOD}\`.
- Puls in \`heart.csv\`: Modell steht in \`sessions.jsonl\` unter \`heart.model_version\`.
`,
    `# Runback – Strength training export

Format \`${STRENGTH_EXPORT_VERSION}\`, exported ${iso(summary.exportedAt)}.
${summary.sessions} sessions, ${summary.sets} sets, ${
    summary.heartSessions
  } sessions with heart rate; period ${span}.

Only sessions that Runback recorded itself are included. Imports (e.g. Strong) are missing.
If the user set the end of a session, that end applies; sets ticked off after it are missing, as in the app.
${context.length ? `\n## Training context\n\n${context.join('\n')}\n` : ''}
## Rules

- Missing values are empty (CSV) or absent (JSON). Nothing is estimated or padded with 0.
- Plan (\`planned_*\`) and actual (\`actual_*\`) are kept separate. Actual values exist only for ticked-off sets.
- Times: \`*_utc\` as ISO 8601 in UTC, \`start_local\` in the device's local time with offset.
- Units: kg, seconds, beats per minute. CSV: comma as separator, point as decimal mark, UTF-8.
- Runback does not know set starts, only ticking off. A set interval includes rest and the set itself.

## Files

- \`trainingslog.md\`: all sessions to read; per exercise the sets, with the plan where it differs.
- \`sessions.csv\`: one row per session.
- \`sets.csv\`: one row per set (including skipped and not ticked-off sets), key \`session_id\`.
- \`heart.csv\`: heart rate per time window from the start of the session. An empty \`bpm\` means: no valid value in the window.
- \`sessions.jsonl\`: one session per line as JSON, with exercises, sets and heart rate summary.
${motion}
## Columns in sets.csv

- \`set_kind\`: warmup, normal, failure, dropset, timed. \`load_kind\`: kg, bodyweight, assisted (weight = assistance), bodyweight_plus (weight = added load), unknown.
- \`status\`: completed, skipped or open (not ticked off).
- \`rir\`: reps in reserve, an optional entry by the user.
- \`completed_after_s\`: seconds from the start of the session to ticking off.
- \`gap_since_previous_set_s\`: seconds since the previous ticked-off set of the same exercise.
- \`volume_kg\`: weight × reps of a ticked-off set, as in the app (including warm-up sets).
- \`e1rm_kg\`: estimated max by Epley (weight × (1 + reps/30)), only for working sets with load in kg and at most ${MAX_REPS_FOR_E1RM} reps. An estimate, not a measurement.
- \`muscle_groups\`: main groups per the exercise catalog, separated by \`;\`; empty if the catalog does not know the exercise.
- \`heart_peak_bpm\`: highest heart rate from 30 s before to 15 s after ticking off. \`heart_recovery_bpm\`: drop in the minute after, only if the next set came at least 2 min later. Both only with heart rate from the watch.

## Columns in sessions.csv

- \`sets_working\`: ticked off, not skipped, no warm-up. \`sets_open\`: neither ticked off nor skipped.
- \`total_reps\`, \`volume_kg\`: sums only over ticked-off sets with this value; empty if no set carries it. \`sets_with_reps\` and \`sets_with_volume\` count the contributing sets — fewer than \`sets_completed\` means: partial sum.
- \`median_set_gap_s\`: median of the set intervals up to 15 min.
- \`heart_source\`: \`watch\` or \`import:<source>\` (per-minute averages from an import, without set values).
- \`heart_coverage\`: share of time windows with a value, 0–1. \`heart_clock_aligned\`: watch and phone clocks aligned.
- \`median_set_peak_bpm\`, \`median_recovery_bpm\`: median from three sets with a value.

## Versions

- Strength training: see \`model_version\` and \`catalog_version\` per session (current catalog \`${CATALOG_VERSION}\`).
- Evaluation per session \`${STRENGTH_SESSION_VERSION}\`, heart rate per set \`${STRENGTH_HEART_INSIGHTS_VERSION}\`, muscle groups \`${MUSCLE_GROUPS_VERSION}\`, estimated max \`${PROGRESSION_CHECK_METHOD}\`.
- Heart rate in \`heart.csv\`: the model is in \`sessions.jsonl\` under \`heart.model_version\`.
`,
  );
  return body;
}
