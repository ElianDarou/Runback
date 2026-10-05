import { median } from './inference';
import type { StrengthSession } from './strength';
import { sourceName } from './importReview';

/**
 * Puls im Krafttraining, aus der Darstellungsreihe der Uhr (Kotlin
 * `StrengthHeart`): Fenster von mindestens 5 s ab Start der Einheit, leere
 * Fenster bleiben leer. Hier entsteht, was ein Kraftsportler damit anfangen
 * kann — der Puls am Ende eines Satzes und wie weit er in der ersten
 * Pausenminute fällt. Beobachtung, keine Empfehlung und keine Fitnesszahl.
 *
 * Satzanfänge sind nicht bekannt, nur das Abhaken. Deshalb gelten feste,
 * vorab gesetzte Fenster um das Abhaken (siehe Konstanten), und eine
 * Erholung zählt nur, wenn der nächste Satz sicher noch nicht lief.
 */
export const STRENGTH_HEART_INSIGHTS_VERSION = 'strength-heart-insights-v1';
/** Der Satzpuls ist das höchste Fenster von 30 s vor bis 15 s nach dem Abhaken. */
export const SET_PEAK_BEFORE_SECONDS = 30;
export const SET_PEAK_AFTER_SECONDS = 15;
/** Erholung: Satzpuls minus Puls eine Minute nach dem Abhaken. */
export const RECOVERY_AFTER_SECONDS = 60;
/** Kommt der nächste Satz früher, lief er womöglich schon in dieser Minute. */
export const RECOVERY_MIN_GAP_SECONDS = 120;
/** Ein Median über weniger Sätze wäre ein Einzelwert. */
export const MIN_SETS_FOR_MEDIAN = 3;

export interface StrengthHeartSummary {
  model_version: string;
  source: 'watch' | string;
  /** Handyzeit, zu der Fenster 0 beginnt (= Start der Einheit). */
  startTime: number;
  stepSeconds: number;
  averageBpm: number;
  maxBpm: number;
  minBpm: number;
  /** Anteil der Fenster mit Wert, 0–1. */
  coverage: number;
  samples: number;
  /** Uhr und Handy über Pings abgeglichen; sonst können Sekunden fehlen. */
  clockAligned: boolean;
}

export interface StrengthHeart extends StrengthHeartSummary {
  values: (number | null)[];
}

const finite = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

/** Prüft, was über die Brücke kommt; Unbrauchbares wird `undefined`. */
export function readStrengthHeart(raw: unknown): StrengthHeart | undefined {
  const value = raw as Partial<StrengthHeart> | null | undefined;
  if (
    !value ||
    !finite(value.startTime) ||
    !finite(value.stepSeconds) ||
    value.stepSeconds <= 0 ||
    !finite(value.averageBpm) ||
    !Array.isArray(value.values)
  ) {
    return undefined;
  }
  return {
    ...(value as StrengthHeart),
    values: value.values.map(entry => (finite(entry) ? entry : null)),
  };
}

export function readStrengthHeartSummaries(
  raw: unknown,
): Record<string, StrengthHeartSummary> {
  const sessions = (raw as { sessions?: Record<string, unknown> } | null)
    ?.sessions;
  const result: Record<string, StrengthHeartSummary> = {};
  if (!sessions || typeof sessions !== 'object') {
    return result;
  }
  for (const [id, entry] of Object.entries(sessions)) {
    const value = entry as Partial<StrengthHeartSummary> | null;
    if (value && finite(value.averageBpm) && finite(value.maxBpm)) {
      result[id] = value as StrengthHeartSummary;
    }
  }
  return result;
}

export interface HeartPoint {
  /** Sekunden seit Start der Einheit, Mitte des Fensters. */
  t: number;
  bpm: number | null;
}

export function heartPoints(heart: StrengthHeart): HeartPoint[] {
  return heart.values.map((bpm, index) => ({
    t: (index + 0.5) * heart.stepSeconds,
    bpm,
  }));
}

/** Werte der Fenster, die den Zeitraum [from, to] (Sekunden seit Start) berühren. */
function windowValues(heart: StrengthHeart, from: number, to: number) {
  const step = heart.stepSeconds;
  const first = Math.max(0, Math.floor(from / step));
  const last = Math.min(heart.values.length - 1, Math.floor(to / step));
  const values: number[] = [];
  for (let index = first; index <= last; index += 1) {
    const value = heart.values[index];
    if (finite(value)) {
      values.push(value);
    }
  }
  return values;
}

export interface SetHeart {
  setId: string;
  exerciseIndex: number;
  completedAt: number;
  peakBpm?: number;
  /** Abfall in der ersten Pausenminute, in Schlägen; positiv = gefallen. */
  recoveryBpm?: number;
}

export interface ExerciseHeart {
  exerciseIndex: number;
  exerciseId: string;
  name: string;
  /** Median des Satzpulses; nur mit Werten aus mindestens einem Satz. */
  peakBpm?: number;
  sets: number;
}

export interface SessionHeartInsight {
  model_version: typeof STRENGTH_HEART_INSIGHTS_VERSION;
  heartModel: string;
  sets: SetHeart[];
  /** Median des Satzpulses, ab drei Sätzen mit Wert. */
  medianPeakBpm?: number;
  /** Median der Erholung, ab drei Sätzen mit langer genug Pause. */
  medianRecoveryBpm?: number;
  recoverySets: number;
  byExercise: ExerciseHeart[];
}

/** Puls von der Uhr; importierter Puls (`import:<Quelle>`) kommt als Minutenmittel. */
export const isWatchHeart = (heart: StrengthHeartSummary): boolean =>
  !heart.source || heart.source === 'watch';

/** Woher der Puls kommt, als Wort für die Anzeige. */
export function heartSourceLabel(heart: StrengthHeartSummary): string {
  return isWatchHeart(heart)
    ? 'Uhr'
    : sourceName(heart.source.replace(/^import:/, ''));
}

export function sessionHeartInsight(
  session: StrengthSession,
  heart: StrengthHeart,
): SessionHeartInsight {
  // Minutenmittel aus Importen tragen keinen Puls am Satzende und keine Erholung.
  const completed = (isWatchHeart(heart) ? session.exercises : [])
    .flatMap((exercise, exerciseIndex) =>
      exercise.sets
        .filter(set => finite(set.completedAt) && !set.skipped)
        .map(set => ({
          setId: set.id,
          exerciseIndex,
          completedAt: set.completedAt as number,
        })),
    )
    .sort((a, b) => a.completedAt - b.completedAt);
  const sets: SetHeart[] = completed.map((set, index) => {
    const at = (set.completedAt - heart.startTime) / 1000;
    const around = windowValues(
      heart,
      at - SET_PEAK_BEFORE_SECONDS,
      at + SET_PEAK_AFTER_SECONDS,
    );
    const peakBpm = around.length ? Math.max(...around) : undefined;
    const next = completed[index + 1];
    const gap = next ? (next.completedAt - set.completedAt) / 1000 : Infinity;
    const later =
      peakBpm !== undefined && gap >= RECOVERY_MIN_GAP_SECONDS
        ? windowValues(
            heart,
            at + RECOVERY_AFTER_SECONDS - heart.stepSeconds / 2,
            at + RECOVERY_AFTER_SECONDS + heart.stepSeconds / 2,
          )
        : [];
    const after = later.length
      ? later.reduce((sum, value) => sum + value, 0) / later.length
      : undefined;
    return {
      ...set,
      peakBpm,
      recoveryBpm:
        peakBpm !== undefined && after !== undefined
          ? peakBpm - after
          : undefined,
    };
  });
  const peaks = sets
    .map(set => set.peakBpm)
    .filter((value): value is number => value !== undefined);
  const recoveries = sets
    .map(set => set.recoveryBpm)
    .filter((value): value is number => value !== undefined);
  const byExercise = session.exercises
    .map((exercise, exerciseIndex) => {
      const values = sets
        .filter(set => set.exerciseIndex === exerciseIndex)
        .map(set => set.peakBpm)
        .filter((value): value is number => value !== undefined);
      return {
        exerciseIndex,
        exerciseId: exercise.exerciseId,
        name: exercise.name,
        peakBpm: values.length ? median(values) : undefined,
        sets: values.length,
      };
    })
    .filter(entry => entry.sets > 0);
  return {
    model_version: STRENGTH_HEART_INSIGHTS_VERSION,
    heartModel: heart.model_version,
    sets,
    medianPeakBpm:
      peaks.length >= MIN_SETS_FOR_MEDIAN ? median(peaks) : undefined,
    medianRecoveryBpm:
      recoveries.length >= MIN_SETS_FOR_MEDIAN ? median(recoveries) : undefined,
    recoverySets: recoveries.length,
    byExercise,
  };
}
