import { finite } from './inference';
import { tr } from './i18n';
import {
  assessExerciseProgression,
  type ProgressionAssessment,
  type ProgressionVerdict,
} from './progression';
import type { StrengthSession } from './strength';
import { exerciseBreakdown, type BestSet } from './strengthSession';

/**
 * History of one exercise across all finished sessions: the depth that runs
 * get from their detail page. The direction comes solely from the versioned
 * strength progression (`progression.ts`); here it is only put into words,
 * never re-assessed.
 */
export const EXERCISE_HISTORY_VERSION = 'exercise-history-v2';

export interface ExerciseSessionPoint {
  sessionId: string;
  sessionName: string;
  /** Start of the session. */
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
  /** State as a label (design language): short, no jargon. */
  label: string;
  /** One sentence on why. */
  reason: string;
}

export interface ExerciseHistory {
  version: typeof EXERCISE_HISTORY_VERSION;
  exerciseId: string;
  name: string;
  /** Oldest first. */
  points: ExerciseSessionPoint[];
  records: ExerciseRecord[];
  trend: ExerciseTrend;
  progression: ProgressionAssessment;
}

function trendLabel(verdict: ProgressionVerdict): string {
  switch (verdict) {
    case 'increase':
      return tr('Steigt', 'Rising');
    case 'reduce':
      return tr('Fällt', 'Falling');
    case 'plateau':
      return tr('Stabil', 'Stable');
    case 'keep_going':
    case 'not_assessable':
      return tr('Noch nicht klar', 'Not clear yet');
  }
}

/**
 * Observation instead of action: the strength progression's reasons partly
 * already state a recommendation ("Try …"). That belongs only in the coach's
 * recommendation, so here we use our own neutral sentences.
 */
function trendReason(verdict: ProgressionVerdict): string | undefined {
  switch (verdict) {
    case 'increase':
      return tr(
        'Dein geschätztes Maximum steigt — deutlicher, als die Tagesform erklärt.',
        'Your estimated max is rising — more than day-to-day form explains.',
      );
    case 'reduce':
      return tr(
        'Dein geschätztes Maximum fällt über die letzten Einheiten.',
        'Your estimated max has been falling over the last sessions.',
      );
    case 'plateau':
      return tr(
        'Seit mindestens vier Wochen nachweislich stabil.',
        'Demonstrably stable for at least four weeks.',
      );
    case 'keep_going':
      return tr(
        'Der Verlauf lässt Steigerung und Stillstand noch beide zu.',
        'The trend still allows both progress and a plateau.',
      );
    case 'not_assessable':
      return undefined;
  }
}

export function exerciseTrend(assessment: ProgressionAssessment): ExerciseTrend {
  return {
    verdict: assessment.verdict,
    label: trendLabel(assessment.verdict),
    // “Not clear yet: only from five training days …” is already neutral.
    reason: trendReason(assessment.verdict) ?? assessment.reason,
  };
}

/** All sessions with at least one ticked working set of this exercise. */
export function exercisePoints(
  sessions: StrengthSession[],
  exerciseId: string,
): ExerciseSessionPoint[] {
  const points: ExerciseSessionPoint[] = [];
  for (const session of sessions) {
    if (session.status !== 'finished' || !finite(session.startTime)) {
      continue;
    }
    // If an exercise appears twice, it counts as one entry with all its sets.
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
    // On a tie, the first day the value was reached counts.
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
    records.push({
      id: 'e1rm',
      label: tr('Höchstes geschätztes Maximum', 'Highest estimated max'),
      point: e1rm,
    });
  }
  const weight = recordOf(points, point => point.topWeightKg);
  if (weight) {
    records.push({
      id: 'weight',
      label: tr('Schwerstes Gewicht', 'Heaviest weight'),
      point: weight,
    });
  }
  // Compare reps only without load; with load, the max says more.
  if (!weight) {
    const reps = recordOf(points, point => point.bestSet?.reps);
    if (reps) {
      records.push({
        id: 'reps',
        label: tr('Meiste Wiederholungen', 'Most reps'),
        point: reps,
      });
    }
  }
  const volume = recordOf(points, point => point.volumeKg);
  if (volume) {
    records.push({
      id: 'volume',
      label: tr('Größtes Volumen', 'Largest volume'),
      point: volume,
    });
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
