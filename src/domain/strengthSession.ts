import { finite, median } from './inference';
import type { Rating } from './insights';
import { bestWorkingSet, MINIMUM_RELEVANT_CHANGE_PERCENT } from './progression';
import {
  epley1RM,
  isSetCompleted,
  formatWeight,
  sessionProgress,
  type LoggedSet,
  type SessionExercise,
  type StrengthSession,
} from './strength';
import type { StrengthHeartSummary } from './strengthHeart';

/**
 * Tiefere Auswertung einer Krafteinheit für ihre Detailseite — das
 * Gegenstück zu `insights.ts` für Läufe. Beobachtung, keine Empfehlung.
 *
 * Gezählt wird nur, was abgehakt wurde; Planwerte erscheinen nie als
 * Ist-Werte. Ohne Grundlage gibt es `undefined` statt einer Zahl.
 */
export const STRENGTH_SESSION_VERSION = 'strength-session-v2';
const DAY = 24 * 60 * 60 * 1000;
/** Vergleichsfenster für „deine letzten Einheiten“. */
export const SESSION_COMPARISON_DAYS = 120;
export const SESSION_COMPARISON_MAX = 8;
export const SESSION_COMPARISON_MIN = 3;
/** Je Übung: frühere Einheiten mit Arbeitssatz, höchstens so viele, so alt. */
export const EXERCISE_COMPARISON_DAYS = 180;
export const EXERCISE_COMPARISON_MAX = 5;
/** Längere Abstände zwischen zwei Sätzen sind eher Unterbrechung als Pause. */
export const MAX_SET_GAP_SECONDS = 15 * 60;

const done = (set: LoggedSet) =>
  isSetCompleted(set) && !set.skipped;

/** Dauer von Start bis Ende; ohne Ende unbekannt, nicht 0. */
export function sessionDurationSeconds(
  session: StrengthSession,
): number | undefined {
  const end = session.endTime;
  if (!finite(end) || !finite(session.startTime) || end <= session.startTime) {
    return undefined;
  }
  return (end - session.startTime) / 1000;
}

export interface BestSet {
  setId: string;
  weightKg?: number;
  reps?: number;
  seconds?: number;
  /** Geschätztes Maximum (Epley); nur für Arbeitssätze mit Last bis 12 Wdh. */
  e1rm?: number;
}

/** „80 kg × 8“, „12 Wdh.“, „45 s“ — oder leer, wenn nichts angegeben ist. */
export function setLabel(set: {
  weightKg?: number;
  reps?: number;
  seconds?: number;
}): string {
  if (finite(set.weightKg) && set.weightKg > 0 && finite(set.reps)) {
    return `${formatWeight(set.weightKg)} kg × ${set.reps}`;
  }
  if (finite(set.reps) && set.reps > 0) {
    return `${set.reps} Wdh.`;
  }
  if (finite(set.seconds) && set.seconds > 0) {
    return `${Math.round(set.seconds)} s`;
  }
  return '';
}

export interface ExerciseBreakdown {
  exerciseIndex: number;
  exerciseId: string;
  name: string;
  /** Abgehakt, ohne Aufwärmen. */
  workingSets: number;
  warmupSets: number;
  skippedSets: number;
  volumeKg: number;
  totalReps: number;
  topWeightKg?: number;
  bestSet?: BestSet;
  /** Median der angegebenen Wiederholungen im Tank; nur mit Angabe. */
  medianRir?: number;
}

function bestOf(exercise: SessionExercise): BestSet | undefined {
  let best: BestSet | undefined;
  const score = (candidate: BestSet) => [
    candidate.e1rm ?? -1,
    candidate.weightKg ?? -1,
    candidate.reps ?? -1,
    candidate.seconds ?? -1,
  ];
  for (const set of exercise.sets) {
    if (!done(set) || set.planned?.kind === 'warmup') {
      continue;
    }
    const candidate: BestSet = {
      setId: set.id,
      weightKg: finite(set.actualWeightKg) && set.actualWeightKg > 0
        ? set.actualWeightKg
        : undefined,
      reps: finite(set.actualReps) && set.actualReps > 0 ? set.actualReps : undefined,
      seconds:
        finite(set.actualSeconds) && set.actualSeconds > 0
          ? set.actualSeconds
          : undefined,
    };
    if (candidate.weightKg !== undefined && candidate.reps !== undefined) {
      candidate.e1rm = epley1RM(candidate.weightKg, candidate.reps) ?? undefined;
    }
    if (!setLabel(candidate)) {
      continue;
    }
    if (!best) {
      best = candidate;
      continue;
    }
    const a = score(candidate);
    const b = score(best);
    const index = a.findIndex((value, i) => value !== b[i]);
    if (index >= 0 && a[index] > b[index]) {
      best = candidate;
    }
  }
  return best;
}

export function exerciseBreakdown(
  session: StrengthSession,
): ExerciseBreakdown[] {
  return session.exercises.map((exercise, exerciseIndex) => {
    let workingSets = 0;
    let warmupSets = 0;
    let skippedSets = 0;
    let volumeKg = 0;
    let totalReps = 0;
    let topWeightKg: number | undefined;
    const rir: number[] = [];
    for (const set of exercise.sets) {
      if (set.skipped) {
        skippedSets += 1;
        continue;
      }
      if (!isSetCompleted(set)) {
        continue;
      }
      if (set.planned?.kind === 'warmup') {
        warmupSets += 1;
      } else {
        workingSets += 1;
        if (finite(set.actualRir)) {
          rir.push(set.actualRir);
        }
        if (finite(set.actualWeightKg) && set.actualWeightKg > 0) {
          topWeightKg = Math.max(topWeightKg ?? 0, set.actualWeightKg);
        }
      }
      // Wie `sessionProgress`: Volumen aus allen abgehakten Sätzen mit Last.
      if (set.actualWeightKg && set.actualReps) {
        volumeKg += set.actualWeightKg * set.actualReps;
      }
      if (finite(set.actualReps) && set.actualReps > 0) {
        totalReps += set.actualReps;
      }
    }
    return {
      exerciseIndex,
      exerciseId: exercise.exerciseId,
      name: exercise.name,
      workingSets,
      warmupSets,
      skippedSets,
      volumeKg,
      totalReps,
      topWeightKg,
      bestSet: bestOf(exercise),
      medianRir: rir.length ? median(rir) : undefined,
    };
  });
}

export interface SetGaps {
  /** Sekunden zwischen zwei abgehakten Sätzen derselben Übung. */
  gaps: number[];
  medianSeconds?: number;
  /** Median der geplanten Pausen dieser Abstände; nur mit Planwert. */
  plannedMedianSeconds?: number;
}

/**
 * Satzabstand: vom Abhaken eines Satzes bis zum Abhaken des nächsten
 * derselben Übung. Er enthält Pause und Satz; eine reine Pausenzeit kennt
 * Runback nicht, weil Satzanfänge nicht erfasst werden.
 */
export function setGaps(session: StrengthSession): SetGaps {
  const gaps: number[] = [];
  const planned: number[] = [];
  for (const exercise of session.exercises) {
    const completed = exercise.sets
      .filter(set => done(set) && finite(set.completedAt))
      .sort((a, b) => (a.completedAt as number) - (b.completedAt as number));
    for (let index = 1; index < completed.length; index += 1) {
      const seconds =
        ((completed[index].completedAt as number) -
          (completed[index - 1].completedAt as number)) /
        1000;
      if (seconds <= 0 || seconds > MAX_SET_GAP_SECONDS) {
        continue;
      }
      gaps.push(seconds);
      const rest = completed[index - 1].planned?.restSeconds;
      if (finite(rest) && rest > 0) {
        planned.push(rest);
      }
    }
  }
  return {
    gaps,
    medianSeconds: gaps.length ? median(gaps) : undefined,
    plannedMedianSeconds: planned.length ? median(planned) : undefined,
  };
}

const normalizedName = (name: string) => name.trim().toLowerCase();

/**
 * Frühere vergleichbare Einheiten: abgeschlossen, davor, innerhalb von 120
 * Tagen, aus derselben Vorlage — ohne Vorlage mit demselben Namen. Ein
 * Beintag gegen einen Brusttag wäre kein Vergleich.
 */
export function comparableSessions(
  session: StrengthSession,
  history: StrengthSession[],
): StrengthSession[] {
  const name = normalizedName(session.name || '');
  return history
    .filter(
      other =>
        other.id !== session.id &&
        other.status === 'finished' &&
        other.startTime < session.startTime &&
        session.startTime - other.startTime <= SESSION_COMPARISON_DAYS * DAY &&
        (session.templateId
          ? other.templateId === session.templateId
          : Boolean(name) && normalizedName(other.name || '') === name),
    )
    .sort((a, b) => b.startTime - a.startTime)
    .slice(0, SESSION_COMPARISON_MAX);
}

export interface ComparedValue {
  value: number;
  median: number;
  /** Abweichung vom Median in Prozent. */
  deltaPercent: number;
}

export interface SessionComparison {
  version: typeof STRENGTH_SESSION_VERSION;
  basis: 'template' | 'name';
  sessionIds: string[];
  volumeKg?: ComparedValue;
  sets?: ComparedValue;
  durationSeconds?: ComparedValue;
  averageBpm?: ComparedValue;
}

function compared(
  value: number | undefined,
  references: (number | undefined)[],
): ComparedValue | undefined {
  const usable = references.filter(
    (entry): entry is number => finite(entry) && entry > 0,
  );
  if (!finite(value) || value <= 0 || usable.length < SESSION_COMPARISON_MIN) {
    return undefined;
  }
  const reference = median(usable);
  return {
    value,
    median: reference,
    deltaPercent: (value / reference - 1) * 100,
  };
}

/** Gegen den Median der letzten vergleichbaren Einheiten, ab drei. */
export function sessionComparison(
  session: StrengthSession,
  history: StrengthSession[],
  heart: Record<string, StrengthHeartSummary> = {},
): SessionComparison | undefined {
  const others = comparableSessions(session, history);
  if (others.length < SESSION_COMPARISON_MIN) {
    return undefined;
  }
  const own = sessionProgress(session);
  const result: SessionComparison = {
    version: STRENGTH_SESSION_VERSION,
    basis: session.templateId ? 'template' : 'name',
    sessionIds: others.map(other => other.id),
    volumeKg: compared(
      own.volumeKg,
      others.map(other => sessionProgress(other).volumeKg),
    ),
    sets: compared(
      own.completedSets,
      others.map(other => sessionProgress(other).completedSets),
    ),
    durationSeconds: compared(
      sessionDurationSeconds(session),
      others.map(sessionDurationSeconds),
    ),
    averageBpm: compared(
      heart[session.id]?.averageBpm,
      others.map(other => heart[other.id]?.averageBpm),
    ),
  };
  return result;
}

export interface ExerciseComparison {
  exerciseId: string;
  /** Bester Arbeitssatz beim letzten Mal; ein Fakt, keine Bewertung. */
  last?: { sessionId: string; at: number; label: string; e1rm: number };
  /** Gegen den Median der letzten bis zu fünf Einheiten, ab drei. */
  median?: number;
  count: number;
  deltaPercent?: number;
  rating?: Rating;
}

/**
 * Höher ist besser; unterhalb der Relevanzschwelle des Kraftverlaufs (4 %)
 * ist es „wie zuletzt“ — kleinere Unterschiede liegen in der Tagesform.
 */
export function rateE1RM(deltaPercent: number): Rating {
  const threshold = MINIMUM_RELEVANT_CHANGE_PERCENT;
  if (deltaPercent >= threshold) return 'better';
  if (deltaPercent > -threshold) return 'same';
  if (deltaPercent > -threshold * 2) return 'slightly_worse';
  return 'worse';
}

export function exerciseComparison(
  session: StrengthSession,
  history: StrengthSession[],
  exerciseId: string,
): ExerciseComparison | undefined {
  const current = bestWorkingSet(
    { ...session, status: 'finished' },
    exerciseId,
  );
  const previous = history
    .filter(
      other =>
        other.id !== session.id &&
        other.startTime < session.startTime &&
        session.startTime - other.startTime <= EXERCISE_COMPARISON_DAYS * DAY,
    )
    .map(other => bestWorkingSet(other, exerciseId))
    .filter((point): point is NonNullable<typeof point> => point !== null)
    .sort((a, b) => b.at - a.at)
    .slice(0, EXERCISE_COMPARISON_MAX);
  if (!previous.length) {
    return undefined;
  }
  const last = previous[0];
  const result: ExerciseComparison = {
    exerciseId,
    last: {
      sessionId: last.sessionId,
      at: last.at,
      label: setLabel(last),
      e1rm: last.e1rm,
    },
    count: previous.length,
  };
  if (current && previous.length >= SESSION_COMPARISON_MIN) {
    const reference = median(previous.map(point => point.e1rm));
    result.median = reference;
    result.deltaPercent = (current.e1rm / reference - 1) * 100;
    result.rating = rateE1RM(result.deltaPercent);
  }
  return result;
}
