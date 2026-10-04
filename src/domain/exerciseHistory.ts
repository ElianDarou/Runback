import { finite } from './inference';
import {
  assessExerciseProgression,
  type ProgressionAssessment,
  type ProgressionVerdict,
} from './progression';
import type { StrengthSession } from './strength';
import { exerciseBreakdown, type BestSet } from './strengthSession';

/**
 * Verlauf einer Übung über alle abgeschlossenen Einheiten — die Tiefe, die
 * bei Läufen die Detailseite hat. Die Richtung kommt allein aus dem
 * versionierten Kraftverlauf (`progression.ts`); hier wird sie nur in
 * Worte übersetzt, nie neu bewertet.
 */
export const EXERCISE_HISTORY_VERSION = 'exercise-history-v1';

export interface ExerciseSessionPoint {
  sessionId: string;
  sessionName: string;
  /** Start der Einheit. */
  at: number;
  workingSets: number;
  volumeKg: number;
  totalReps: number;
  topWeightKg?: number;
  bestSet?: BestSet;
}

export interface ExerciseRecord {
  id: 'e1rm' | 'weight' | 'reps' | 'volume';
  label: string;
  point: ExerciseSessionPoint;
}

export interface ExerciseTrend {
  verdict: ProgressionVerdict;
  /** Zustand als Label (Design Language): kurz, ohne Fachwort. */
  label: string;
  /** Ein Satz, warum. */
  reason: string;
}

export interface ExerciseHistory {
  version: typeof EXERCISE_HISTORY_VERSION;
  exerciseId: string;
  name: string;
  /** Älteste zuerst. */
  points: ExerciseSessionPoint[];
  records: ExerciseRecord[];
  trend: ExerciseTrend;
  progression: ProgressionAssessment;
}

const TREND_LABEL: Record<ProgressionVerdict, string> = {
  increase: 'Steigt',
  reduce: 'Fällt',
  plateau: 'Stabil',
  keep_going: 'Noch nicht klar',
  not_assessable: 'Noch nicht klar',
};

/**
 * Beobachtung statt Handlung: Die Begründungen des Kraftverlaufs sprechen
 * zum Teil schon eine Empfehlung aus („Probiere …“). Die gehört nur in die
 * Empfehlung des Coachs, deshalb hier eigene, neutrale Sätze.
 */
const TREND_REASON: Partial<Record<ProgressionVerdict, string>> = {
  increase:
    'Dein geschätztes Maximum steigt — deutlicher, als die Tagesform erklärt.',
  reduce: 'Dein geschätztes Maximum fällt über die letzten Einheiten.',
  plateau: 'Seit mindestens vier Wochen nachweislich stabil.',
  keep_going: 'Der Verlauf lässt Steigerung und Stillstand noch beide zu.',
};

export function exerciseTrend(assessment: ProgressionAssessment): ExerciseTrend {
  return {
    verdict: assessment.verdict,
    label: TREND_LABEL[assessment.verdict],
    // „Noch nicht klar: Erst ab fünf Trainingstagen …“ ist schon neutral.
    reason: TREND_REASON[assessment.verdict] ?? assessment.reason,
  };
}

/** Alle Einheiten mit mindestens einem abgehakten Arbeitssatz dieser Übung. */
export function exercisePoints(
  sessions: StrengthSession[],
  exerciseId: string,
): ExerciseSessionPoint[] {
  const points: ExerciseSessionPoint[] = [];
  for (const session of sessions) {
    if (session.status !== 'finished' || !finite(session.startTime)) {
      continue;
    }
    // Kommt eine Übung zweimal vor, zählt sie als ein Eintrag mit allen Sätzen.
    const parts = exerciseBreakdown(session).filter(
      part => part.exerciseId === exerciseId && part.workingSets > 0,
    );
    if (!parts.length) {
      continue;
    }
    const best = parts
      .map(part => part.bestSet)
      .filter((set): set is BestSet => Boolean(set))
      .sort(
        (a, b) =>
          (b.e1rm ?? -1) - (a.e1rm ?? -1) ||
          (b.weightKg ?? -1) - (a.weightKg ?? -1) ||
          (b.reps ?? -1) - (a.reps ?? -1),
      )[0];
    const top = parts
      .map(part => part.topWeightKg)
      .filter((value): value is number => finite(value));
    points.push({
      sessionId: session.id,
      sessionName: session.name,
      at: session.startTime,
      workingSets: parts.reduce((sum, part) => sum + part.workingSets, 0),
      volumeKg: parts.reduce((sum, part) => sum + part.volumeKg, 0),
      totalReps: parts.reduce((sum, part) => sum + part.totalReps, 0),
      topWeightKg: top.length ? Math.max(...top) : undefined,
      bestSet: best,
    });
  }
  return points.sort(
    (a, b) => a.at - b.at || a.sessionId.localeCompare(b.sessionId),
  );
}

function recordOf(
  points: ExerciseSessionPoint[],
  value: (point: ExerciseSessionPoint) => number | undefined,
): ExerciseSessionPoint | undefined {
  let best: ExerciseSessionPoint | undefined;
  let bestValue = 0;
  for (const point of points) {
    const candidate = value(point);
    // Bei Gleichstand gilt der erste Tag, an dem der Wert erreicht wurde.
    if (finite(candidate) && candidate > bestValue) {
      best = point;
      bestValue = candidate;
    }
  }
  return best;
}

export function exerciseHistory(
  sessions: StrengthSession[],
  exerciseId: string,
): ExerciseHistory {
  const points = exercisePoints(sessions, exerciseId);
  const progression = assessExerciseProgression(sessions, exerciseId);
  const name =
    [...sessions]
      .sort((a, b) => b.startTime - a.startTime)
      .flatMap(session => session.exercises)
      .find(exercise => exercise.exerciseId === exerciseId)?.name ??
    exerciseId;
  const records: ExerciseRecord[] = [];
  const e1rm = recordOf(points, point => point.bestSet?.e1rm);
  if (e1rm) {
    records.push({ id: 'e1rm', label: 'Höchstes geschätztes Maximum', point: e1rm });
  }
  const weight = recordOf(points, point => point.topWeightKg);
  if (weight) {
    records.push({ id: 'weight', label: 'Schwerstes Gewicht', point: weight });
  }
  // Wiederholungen nur ohne Last vergleichen; mit Last sagt das Maximum mehr.
  if (!weight) {
    const reps = recordOf(points, point => point.bestSet?.reps);
    if (reps) {
      records.push({ id: 'reps', label: 'Meiste Wiederholungen', point: reps });
    }
  }
  const volume = recordOf(points, point => point.volumeKg);
  if (volume) {
    records.push({ id: 'volume', label: 'Größtes Volumen', point: volume });
  }
  return {
    version: EXERCISE_HISTORY_VERSION,
    exerciseId,
    name,
    points,
    records,
    trend: exerciseTrend(progression),
    progression,
  };
}
