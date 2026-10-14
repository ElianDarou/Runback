import {
  normalizeStrengthTarget,
  strengthGoalProgress,
  STRENGTH_GOAL_WINDOW_DAYS,
} from '../src/domain/strengthGoal';
import type { LoggedSet, StrengthSession } from '../src/domain/strength';

const NOW = new Date(2026, 9, 14, 12).getTime();
const DAY = 86400000;

const set = (
  kg: number,
  reps: number,
  extra: Partial<LoggedSet> = {},
): LoggedSet => ({
  id: `${kg}-${reps}`,
  planned: { kind: 'normal', loadKind: 'kg', reps, weightKg: kg },
  actualReps: reps,
  actualWeightKg: kg,
  completedAt: NOW - DAY,
  ...extra,
});

const session = (
  sets: LoggedSet[],
  daysAgo = 1,
  exerciseId = 'squat',
): StrengthSession => ({
  id: `s-${daysAgo}-${exerciseId}`,
  kind: 'strength',
  name: 'Beine',
  startTime: NOW - daysAgo * DAY,
  endTime: NOW - daysAgo * DAY + 3600000,
  status: 'finished',
  exercises: [{ exerciseId, name: 'Kniebeuge', sets }],
  currentExercise: 0,
  modelVersion: 'strength-v1',
  catalogVersion: 'catalog-v2',
});

const target = { exerciseId: 'squat', name: 'Kniebeuge', kg: 100, reps: 5 };

describe('strength goal', () => {
  it('reads only complete targets', () => {
    expect(normalizeStrengthTarget(target)).toEqual(target);
    expect(normalizeStrengthTarget({ ...target, kg: 0 })).toBeUndefined();
    expect(normalizeStrengthTarget({ ...target, reps: 2.5 })).toBeUndefined();
    expect(
      normalizeStrengthTarget({ ...target, exerciseId: ' ' }),
    ).toBeUndefined();
    expect(normalizeStrengthTarget('100 kg')).toBeUndefined();
  });

  it('measures the heaviest working set with enough reps', () => {
    const progress = strengthGoalProgress(
      target,
      [
        session([
          set(90, 3), // too few reps
          set(80, 6),
          set(85, 5),
          set(120, 5, { planned: { kind: 'warmup', loadKind: 'kg' } }),
          set(95, 5, { skipped: true }),
        ]),
        session([set(100, 5)], 1, 'bench'),
      ],
      NOW,
    );
    expect(progress).toMatchObject({
      status: 'observed',
      best: { kg: 85, reps: 5 },
      share: 0.85,
      reached: false,
      sets: 3,
    });
  });

  it('counts only recent sets and says when none fits', () => {
    const old = session([set(110, 5)], STRENGTH_GOAL_WINDOW_DAYS + 1);
    expect(strengthGoalProgress(target, [old], NOW)).toMatchObject({
      status: 'none',
      sets: 0,
      reached: false,
    });
    const reached = strengthGoalProgress(
      target,
      [old, session([set(102.5, 5)])],
      NOW,
    );
    expect(reached).toMatchObject({ share: 1, reached: true });
  });
});
