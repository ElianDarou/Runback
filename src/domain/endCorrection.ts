import type { RunSeries } from './runSeries';
import type { StrengthSession } from './strength';
import type { StrengthHeart } from './strengthHeart';

/**
 * Ende nachträglich setzen, für Läufe und Krafteinheiten: wer vergessen hat
 * zu beenden, wählt im Verlauf, wann wirklich Schluss war. Die Korrektur
 * liegt neben dem Original (Kotlin: `trim_<id>`, `strength_end_<id>`), das
 * Original bleibt erhalten und lässt sich wiederherstellen.
 *
 * Vorschläge sind nur Vorschau, bis der Nutzer sie übernimmt: beim Lauf das
 * Ende der letzten Bewegung, bei einer aufgezeichneten Krafteinheit der
 * zuletzt abgehakte Satz. Ohne solche Spuren gibt es keinen Vorschlag.
 */
export const END_CORRECTION_VERSION = 'end-correction-v1';
export const END_SUGGESTION_VERSION = 'end-suggestion-v1';
/** Ein Vorschlag lohnt sich erst, wenn er mindestens zwei Minuten früher endet. */
export const MIN_SUGGESTION_GAP_SECONDS = 120;
/** Kürzer als eine Minute wäre keine Einheit mehr. */
export const MIN_DURATION_SECONDS = 60;

export interface EndCorrection {
  endTime: number;
  setAt?: number;
}

export interface EndSuggestion {
  time: number;
  reason: 'last_set' | 'last_movement';
  version: typeof END_SUGGESTION_VERSION;
}

const finite = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

export function readEndCorrection(raw: unknown): EndCorrection | undefined {
  const value = raw as Partial<EndCorrection> | null | undefined;
  return value && finite(value.endTime) && value.endTime > 0
    ? {
        endTime: value.endTime,
        setAt: finite(value.setAt) ? value.setAt : undefined,
      }
    : undefined;
}

/**
 * Krafteinheit mit korrigiertem Ende; ohne gültige Korrektur unverändert.
 * Sätze, die erst nach dem gesetzten Ende abgehakt wurden, zählen wie beim
 * Lauf nicht mehr; im gespeicherten Original bleiben sie.
 */
export function applyStrengthEndCorrection(
  session: StrengthSession,
  raw: unknown,
): StrengthSession {
  const correction = readEndCorrection(raw);
  if (!correction || correction.endTime <= session.startTime) return session;
  const excludedSetTimes = (session.exercises || [])
    .flatMap(exercise => exercise.sets)
    .map(set => set.completedAt)
    .filter((at): at is number => finite(at) && at > correction.endTime);
  const exercises = (session.exercises || [])
    .map(exercise => ({
      ...exercise,
      sets: exercise.sets.filter(
        set =>
          !finite(set.completedAt) || set.completedAt <= correction.endTime,
      ),
    }))
    .filter(exercise => exercise.sets.length > 0);
  return {
    ...session,
    exercises,
    currentExercise: Math.min(
      session.currentExercise ?? 0,
      Math.max(0, exercises.length - 1),
    ),
    endTime: correction.endTime,
    endCorrection: {
      endTime: correction.endTime,
      originalEndTime: session.endTime,
      setAt: correction.setAt,
      ...(excludedSetTimes.length ? { excludedSetTimes } : {}),
    },
  };
}

/** Abhakzeiten aller Sätze, auch der hinter einem gesetzten Ende. */
export function strengthSetTimes(session: StrengthSession): number[] {
  const times = (session.exercises || [])
    .flatMap(exercise => exercise.sets || [])
    .filter(set => !set.skipped && finite(set.completedAt))
    .map(set => set.completedAt as number);
  return [...times, ...(session.endCorrection?.excludedSetTimes ?? [])];
}

/** Zuletzt abgehakter Satz einer aufgezeichneten Einheit. Importe kennen keine Satzzeiten. */
export function strengthEndSuggestion(
  session: StrengthSession,
  currentEnd: number | undefined,
): EndSuggestion | undefined {
  let last: number | undefined;
  for (const time of strengthSetTimes(session))
    if (time > session.startTime)
      last = last === undefined ? time : Math.max(last, time);
  if (last === undefined) return undefined;
  if (
    currentEnd !== undefined &&
    last > currentEnd - MIN_SUGGESTION_GAP_SECONDS * 1000
  )
    return undefined;
  return { time: last, reason: 'last_set', version: END_SUGGESTION_VERSION };
}

/** Ende der letzten Bewegung im unkorrigierten Verlauf eines Laufs. */
export function runEndSuggestion(
  startTime: number,
  series: RunSeries | null | undefined,
  originalEnd: number,
): EndSuggestion | undefined {
  if (!series || !finite(series.stepSeconds)) return undefined;
  let last: number | undefined;
  for (const row of series.rows)
    if (row.moving) last = row.elapsedSeconds + series.stepSeconds;
  if (last === undefined) return undefined;
  const time = Math.min(originalEnd, startTime + last * 1000);
  if (time > originalEnd - MIN_SUGGESTION_GAP_SECONDS * 1000) return undefined;
  return { time, reason: 'last_movement', version: END_SUGGESTION_VERSION };
}

/**
 * Hält ein gewähltes Ende zwischen „eine Minute nach Start“ und dem Ende des
 * Zeitraums, auf volle Sekunden. Ist der Zeitraum kürzer als eine Minute, gilt
 * sein Ende.
 */
export function clampEnd(
  time: number,
  startTime: number,
  rangeEnd: number,
): number {
  const min = Math.min(startTime + MIN_DURATION_SECONDS * 1000, rangeEnd);
  const rounded = Math.round(time / 1000) * 1000;
  return Math.max(min, Math.min(rangeEnd, rounded));
}

export interface TrackPoint {
  /** Zeit in ms. */
  t: number;
  value: number | null;
}

/** Puls einer Krafteinheit als Zeitpunkte in der Fenstermitte. */
export function heartTrack(heart: StrengthHeart | undefined): TrackPoint[] {
  if (!heart) return [];
  return heart.values.map((bpm, index) => ({
    t: heart.startTime + (index + 0.5) * heart.stepSeconds * 1000,
    value: bpm,
  }));
}

/** Tempo als km/h (nur in Bewegung) und Puls aus dem Laufverlauf. */
export function runTracks(
  startTime: number,
  series: RunSeries | null | undefined,
): { speed: TrackPoint[]; heart: TrackPoint[] } {
  if (!series) return { speed: [], heart: [] };
  const at = (elapsed: number) =>
    startTime + (elapsed + series.stepSeconds / 2) * 1000;
  return {
    speed: series.rows.map(row => ({
      t: at(row.elapsedSeconds),
      // Stillstand und Unbekanntes bleiben Lücken: Wo die Linie aufhört, endete die Bewegung.
      value:
        row.moving && row.speedMps !== undefined && row.speedMps > 0
          ? Math.round(row.speedMps * 36) / 10
          : null,
    })),
    heart: series.rows.map(row => ({
      t: at(row.elapsedSeconds),
      value: row.heartRate ?? null,
    })),
  };
}
