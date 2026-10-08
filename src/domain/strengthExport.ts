import { catalogExercise } from './catalog';
import { focusLabel, type TrainingFocus } from './focus';
import { finite } from './inference';
import { exerciseGroups, MUSCLE_GROUPS_VERSION } from './muscleGroups';
import { PROGRESSION_CHECK_METHOD } from './progression';
import {
  CATALOG_VERSION,
  epley1RM,
  isSetCompleted,
  MAX_REPS_FOR_E1RM,
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
 * Export aller in Runback aufgezeichneten Krafteinheiten zum Auswerten oder
 * für ein Sprachmodell — das Gegenstück zum Analyse-Export der Läufe.
 * Importe (Strong) fehlen bewusst: Ihnen fehlen Abhakzeiten und Puls.
 *
 * Ein ZIP mit flachen Dateien, je Einheit stückweise angehängt:
 * `trainingslog.md` zum Lesen, `sessions.csv`, `sets.csv`, `heart.csv` für
 * Tabellen und `sessions.jsonl` mit allem verschachtelt, je Zeile eine
 * Einheit. Gezählt wird wie in der App; was fehlt, bleibt leer statt 0.
 *
 * 2: Bewegungsdaten der Uhr liegen im Ordner `bewegungsdaten/` (Kotlin
 * `MotionExport`, eigenes `manifest.json`).
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
/** Ortszeit des Geräts mit Versatz, z. B. `2026-10-05T18:30:00+02:00`. */
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
/** Volumen wie `sessionProgress`: abgehakt, Last mal Wiederholungen. */
const setVolume = (set: LoggedSet) =>
  done(set) && set.actualWeightKg && set.actualReps
    ? set.actualWeightKg * set.actualReps
    : undefined;
/** Wie die Fortschrittsprüfung: Arbeitssatz mit Last in kg, bis 12 Wdh. */
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

/** Nur in Runback aufgezeichnet und abgeschlossen; keine Importe. */
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
    // Satzabstand wie `setGaps`: Abhaken bis Abhaken derselben Übung.
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
 * Summen nur über Sätze, die den Wert tragen; ohne einen einzigen bleibt die
 * Summe unbekannt statt 0. Die Zahl der beitragenden Sätze steht daneben,
 * damit eine Teilsumme als solche erkennbar ist.
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
  /** Zähler für das README. */
  setCount: number;
  heartSessions: number;
}

/**
 * Zeilen einer Einheit für alle Dateien. Die Einheit kommt mit
 * angewandtem gesetzten Ende (wie in der App); Sätze danach fehlen.
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

const dateLabel = new Intl.DateTimeFormat('de-DE', {
  weekday: 'short',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});
const number = (value: number, digits = 0) =>
  value.toLocaleString('de-DE', { maximumFractionDigits: digits });

function setLine(set: LoggedSet): string {
  const planned = setLabel(set.planned);
  const plan = planned ? `Plan ${planned}` : '';
  if (set.skipped) return `übersprungen${plan ? ` (${plan})` : ''}`;
  if (!isSetCompleted(set)) return `nicht abgehakt${plan ? ` (${plan})` : ''}`;
  const actual =
    setLabel({
      weightKg: set.actualWeightKg,
      reps: set.actualReps,
      seconds: set.actualSeconds,
    }) || 'abgehakt, ohne Werte';
  const parts = [
    set.planned.kind === 'warmup' ? `Aufwärmen: ${actual}` : actual,
  ];
  if (finite(set.actualRir)) parts.push(`${set.actualRir} Wdh. im Tank`);
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
    duration !== undefined ? `${number(duration / 60)} min` : 'Dauer unbekannt',
    `${totals.completedSets} Sätze abgehakt`,
    totals.volumeKg ? `${number(totals.volumeKg)} kg Volumen` : undefined,
    heart
      ? `Puls Ø ${number(heart.averageBpm)}, max ${number(
          heart.maxBpm,
        )} (${heartSourceLabel(heart)})`
      : undefined,
    session.status === 'interrupted' ? 'abgebrochen' : undefined,
  ].filter(Boolean);
  const lines = [
    `## ${dateLabel.format(new Date(session.startTime))} · ${session.name}`,
    '',
    facts.join(' · '),
  ];
  if (session.note?.trim()) lines.push('', `Notiz: ${session.note.trim()}`);
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
    log: '# Krafttraining aus Runback\n\nAlle in Runback aufgezeichneten Einheiten, älteste zuerst. Gewichte in kg, Zahlen im deutschen Format.\n\n',
  };
}

export interface StrengthExportSummary {
  exportedAt: number;
  sessions: number;
  sets: number;
  heartSessions: number;
  /**
   * Einheiten mit Bewegungsdaten (`MotionStatus.sessions`); fehlt der Zähler,
   * ist er unbekannt. Wie viele Rohdateien dabei sind, steht nur in
   * `bewegungsdaten/sessions.csv` — die Uhr kann während des Exports liefern.
   */
  motionSessions?: number;
  firstStart?: number;
  lastStart?: number;
  goal?: string;
  goalTargetDate?: string;
  focus?: TrainingFocus | null;
}

/** Beschreibung aller Dateien und Spalten — für Menschen und Sprachmodelle. */
export function strengthExportReadme(summary: StrengthExportSummary): string {
  const span =
    summary.firstStart !== undefined && summary.lastStart !== undefined
      ? `${iso(summary.firstStart)?.slice(0, 10)} bis ${iso(
          summary.lastStart,
        )?.slice(0, 10)} (${Math.round(
          (summary.lastStart - summary.firstStart) / DAY,
        )} Tage)`
      : 'keine Einheiten';
  const context = [
    summary.goal?.trim() ? `- Ziel Krafttraining: ${summary.goal.trim()}` : '',
    summary.goalTargetDate ? `- Zieldatum: ${summary.goalTargetDate}` : '',
    summary.focus ? `- Fokus Krafttraining: ${focusLabel(summary.focus)}` : '',
  ].filter(Boolean);
  const motion =
    summary.motionSessions === 0
      ? ''
      : `- \`${STRENGTH_EXPORT_MOTION_DIRECTORY}/\`: ${
          summary.motionSessions === undefined
            ? 'Bewegungsdaten der Uhr, falls aufgezeichnet'
            : `Bewegungsdaten der Uhr aus ${summary.motionSessions} Einheiten`
        } — Beschleunigung, Gyroskop, Puls roh, Ereignisse und Erkennungen je Einheit; \`raw_available\` in \`${STRENGTH_EXPORT_MOTION_DIRECTORY}/sessions.csv\` sagt, wo Rohdaten dabei sind. Zeit in ms ab Start der Einheit; Beschreibung in \`${STRENGTH_EXPORT_MOTION_DIRECTORY}/manifest.json\` und docs/motion-data.md im Runback-Repository. \`session_id\` passt zu den Tabellen oben. Die Bewegungsdaten zeigen die Aufzeichnung, wie sie war: Ein vom Nutzer gesetztes Ende gilt dort nicht, später abgehakte Sätze stehen in ihrem \`sets.csv\`.\n`;
  return `# Runback – Krafttraining-Export

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
`;
}
