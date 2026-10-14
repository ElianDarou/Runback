import React from 'react';
import { ScrollView, Text } from 'react-native';
import TestRenderer from 'react-test-renderer';
import type { Run } from '../src/native';
import {
  buildDevelopmentFacts,
  type DevelopmentInput,
} from '../src/domain/development';
import type { LoggedSet, StrengthSession } from '../src/domain/strength';
import { predictRace } from '../src/domain/raceGoal';
import { DevelopmentScreen } from '../src/ui/DevelopmentScreen';

const localAt = (date: string, hour = 9, minute = 0): number => {
  const [year, month, day] = date.split('-').map(Number);
  return new Date(year, month - 1, day, hour, minute, 0, 0).getTime();
};

const runAt = (
  id: string,
  date: string,
  distanceMeters = 5000,
  overrides: Partial<Run> = {},
): Run => {
  const startTime = localAt(date);
  return {
    id,
    startTime,
    endTime: startTime + 30 * 60 * 1000,
    durationSeconds: 30 * 60,
    distanceMeters,
    purpose: 'easy',
    source: 'test',
    status: 'completed',
    ...overrides,
  };
};

const loggedSet = (
  id: string,
  completedAt: number,
  values: Pick<LoggedSet, 'actualReps' | 'actualWeightKg' | 'actualSeconds'> = {
    actualReps: 5,
    actualWeightKg: 20,
  },
): LoggedSet => ({
  id,
  planned: {
    kind: 'normal',
    loadKind: 'kg',
    reps: 5,
    weightKg: 20,
    restSeconds: 60,
  },
  ...values,
  completedAt,
});

const strengthAt = (
  id: string,
  date: string,
  overrides: Partial<StrengthSession> = {},
): StrengthSession => {
  const startTime = localAt(date, 8);
  return {
    id,
    kind: 'strength',
    name: 'Krafttraining',
    startTime,
    endTime: startTime + 60 * 60 * 1000,
    status: 'finished',
    exercises: [],
    currentExercise: 0,
    modelVersion: 'strength-v1',
    catalogVersion: 'catalog-v1',
    ...overrides,
  };
};

const input = (
  now: number,
  overrides: Partial<DevelopmentInput> = {},
): DevelopmentInput => ({
  runs: [],
  sessions: [],
  goal: '',
  now,
  ...overrides,
});

describe('Entwicklungsfakten', () => {
  it('compares adjacent local four-week windows and counts a training day once', () => {
    const now = localAt('2025-03-10', 12);
    const currentRun = runAt('current', '2025-03-10', 5000);
    const duplicate = runAt('duplicate', '2025-03-10', 8000, {
      canonicalId: 'source-run-1',
    });
    currentRun.canonicalId = 'source-run-1';
    const boundaryRun = runAt('boundary', '2025-02-11', 8000);
    const previousRun = runAt('previous', '2025-02-10', 7000);
    const outsideRun = runAt('outside', '2025-01-13', 9000);
    const futureRun = runAt('future', '2025-03-10', 9000, {
      startTime: now + 60 * 60 * 1000,
      endTime: now + 90 * 60 * 1000,
    });
    const recording = runAt('recording', '2025-03-10', 9000, {
      status: 'recording',
    });
    const invalid = runAt('invalid', '2025-03-10', -1);
    const currentStrength = strengthAt('strength-current', '2025-03-10', {
      exercises: [
        {
          exerciseId: 'squat',
          name: 'Kniebeuge',
          sets: [loggedSet('set-current', localAt('2025-03-10', 8, 30))],
        },
      ],
    });

    const facts = buildDevelopmentFacts(
      input(now, {
        runs: [
          currentRun,
          duplicate,
          boundaryRun,
          previousRun,
          outsideRun,
          futureRun,
          recording,
          invalid,
        ],
        sessions: [currentStrength],
      }),
    );

    expect(facts.current.runCount).toBe(2);
    expect(facts.current.distanceMeters).toBe(13_000);
    expect(facts.current.strengthSessionCount).toBe(1);
    expect(facts.current.trainingDays).toBe(2);
    expect(facts.previous.runCount).toBe(1);
    expect(facts.previous.distanceMeters).toBe(7000);
    expect(facts.previous.trainingDays).toBe(1);
    expect(facts.comparison).toMatchObject({
      trainingDays: 1,
      runCount: 1,
      distanceMeters: 6000,
    });
  });

  it('keeps only completed runs and validates set timestamps inside a session', () => {
    const now = localAt('2025-03-10', 12);
    const sessionStart = localAt('2025-03-10', 8);
    const sessionEnd = localAt('2025-03-10', 9);
    const session = strengthAt('strength-1', '2025-03-10', {
      startTime: sessionStart,
      endTime: sessionEnd,
      exercises: [
        {
          exerciseId: 'press',
          name: 'Drücken',
          sets: [
            loggedSet('inside', localAt('2025-03-10', 8, 30)),
            loggedSet('before', sessionStart - 1),
            loggedSet('after', sessionEnd + 1),
            loggedSet('future', now + 1),
            {
              ...loggedSet('planned-only', localAt('2025-03-10', 8, 30)),
              actualReps: undefined,
              actualWeightKg: undefined,
            },
          ],
        },
      ],
    });
    const invalidSession = strengthAt('invalid-strength', '2025-03-10', {
      status: 'interrupted',
    });
    const futureRun = runAt('future', '2025-03-10', 1000, {
      startTime: now + 1,
      endTime: now + 2,
    });

    const facts = buildDevelopmentFacts(
      input(now, {
        runs: [futureRun],
        sessions: [session, invalidSession],
      }),
    );

    expect(facts.current.runCount).toBe(0);
    expect(facts.current.strengthSessionCount).toBe(1);
    expect(facts.current.strengthCompletedSets).toBe(1);
    expect(facts.current.strengthVolumeKg).toBe(100);
    expect(facts.strengthHistory.completedSets).toBe(1);
  });

  it('does not count rides as running kilometres', () => {
    const now = localAt('2025-03-10', 12);
    const facts = buildDevelopmentFacts(
      input(now, {
        runs: [
          runAt('run', '2025-03-08', 5000),
          runAt('ride', '2025-03-09', 40000, { sport: 'cycling' }),
        ],
      }),
    );

    expect(facts.current.runCount).toBe(1);
    expect(facts.current.distanceMeters).toBe(5000);
  });

  it('describes the running goal by observed distance, without a forecast', () => {
    const now = localAt('2025-03-10', 12);
    const facts = buildDevelopmentFacts(
      input(now, {
        goal: '10 km schaffen',
        runs: [runAt('long', '2025-02-20', 7500)],
      }),
    );
    expect(facts).not.toHaveProperty('planPosition');
    expect(facts.goalEvidence).toMatchObject({
      status: 'observed',
      targetDistanceKm: 10,
      longestRunDistanceKm: 7.5,
    });
    expect(facts.goalEvidence).not.toHaveProperty('fitnessPercent');
    expect(facts.goalEvidence.message).toContain('keine Prognose');
  });

  it('keeps free-text goals honest when a direct distance comparison is unavailable', () => {
    const now = localAt('2025-03-10', 12);
    const observed = buildDevelopmentFacts(
      input(now, {
        goal: 'Regelmäßig trainieren',
        runs: [runAt('run', '2025-03-01', 5000)],
      }),
    );
    const missing = buildDevelopmentFacts(
      input(now, { goal: '10 km schaffen' }),
    );

    expect(observed.goalEvidence.status).toBe('observed');
    expect(observed.goalEvidence.targetDistanceKm).toBeUndefined();
    expect(observed.goalEvidence.longestRunDistanceKm).toBeUndefined();
    expect(missing.goalEvidence.status).toBe('insufficient_data');
    expect(missing.goalEvidence.targetDistanceKm).toBe(10);
    expect(missing.goalEvidence.longestRunDistanceKm).toBeUndefined();
  });
});

function textContent(node: TestRenderer.ReactTestInstance): string {
  return node.children
    .map(child =>
      typeof child === 'string' || typeof child === 'number'
        ? String(child)
        : textContent(child as TestRenderer.ReactTestInstance),
    )
    .join('');
}

const screenProps = (now: number) => ({
  runs: [],
  sessions: [],
  now,
  showRunning: true,
  showStrength: true,
  prediction: predictRace({ goal: '', runs: [], now }),
  onEditGoal: jest.fn(),
  onDistanceTimes: jest.fn(),
  strengthGoal: '',
  strengthGoalTargetDate: '',
  onEditStrengthGoal: jest.fn(),
});

describe('DevelopmentScreen', () => {
  it('is content for the parent scroll container and discloses unavailable strength history', () => {
    let tree!: TestRenderer.ReactTestRenderer;
    TestRenderer.act(() => {
      tree = TestRenderer.create(
        <DevelopmentScreen
          {...screenProps(localAt('2025-03-10', 12))}
          showRunning={false}
          strengthHistoryAvailable={false}
        />,
      );
    });

    const text = tree.root.findAllByType(Text).map(textContent).join(' ');
    expect(tree.root.findAllByType(ScrollView)).toHaveLength(0);
    expect(text).toContain('Kraft-Historie momentan nicht verfügbar.');
    expect(text).toContain('Krafttraining ist momentan nicht geladen.');
    expect(text).not.toContain(
      'Keine abgeschlossenen Krafttrainings mit bestätigten Werten.',
    );
    TestRenderer.act(() => tree.unmount());
  });

  it('keeps running and strength apart and measures the strength goal', () => {
    const now = localAt('2025-03-10', 12);
    const sessions = [
      strengthAt('legs', '2025-03-05', {
        exercises: [
          {
            exerciseId: 'squat',
            name: 'Kniebeuge',
            sets: [
              {
                ...loggedSet('heavy', localAt('2025-03-05', 8, 30)),
                actualReps: 5,
                actualWeightKg: 80,
              },
            ],
          },
        ],
      }),
    ];
    let tree!: TestRenderer.ReactTestRenderer;
    TestRenderer.act(() => {
      tree = TestRenderer.create(
        <DevelopmentScreen
          {...screenProps(now)}
          sessions={sessions}
          strengthTarget={{
            exerciseId: 'squat',
            name: 'Kniebeuge',
            kg: 100,
            reps: 5,
          }}
        />,
      );
    });
    const text = () => tree.root.findAllByType(Text).map(textContent).join(' ');
    expect(text()).toContain('Zielzeiten');
    expect(text()).not.toContain('Kniebeuge');
    const strength = tree.root.find(
      node =>
        node.props.accessibilityRole === 'radio' &&
        node.props.accessibilityLabel === 'Krafttraining' &&
        typeof node.props.onPress === 'function',
    );
    TestRenderer.act(() => strength.props.onPress());
    expect(text()).not.toContain('Zielzeiten');
    expect(text()).toContain('Kniebeuge · 100 kg × 5');
    expect(text()).toContain('Bestes in 12 Wochen: 80 kg × 5');
    TestRenderer.act(() => tree.unmount());
  });

  it('shows the loaded-data qualifier when the native history page is full', () => {
    const sessions = Array.from({ length: 500 }, (_, index) =>
      strengthAt(`strength-${index}`, '2025-03-01', {
        exercises: [
          {
            exerciseId: 'squat',
            name: 'Kniebeuge',
            sets: [loggedSet(`set-${index}`, localAt('2025-03-01', 8, 30))],
          },
        ],
      }),
    );
    let tree!: TestRenderer.ReactTestRenderer;
    TestRenderer.act(() => {
      tree = TestRenderer.create(
        <DevelopmentScreen
          {...screenProps(localAt('2025-03-10', 12))}
          sessions={sessions}
          showRunning={false}
        />,
      );
    });

    const text = tree.root.findAllByType(Text).map(textContent).join(' ');
    expect(text).toContain('Erfasste Einheiten');
    expect(text).toContain('Geladen sind höchstens 500 Kraft-Einheiten');
    TestRenderer.act(() => tree.unmount());
  });
});

it('does not count a saved empty strength session as a training day', () => {
  const facts = buildDevelopmentFacts(
    input(localAt('2025-03-10', 12), {
      sessions: [strengthAt('empty', '2025-03-10')],
    }),
  );
  expect(facts.current.trainingDays).toBe(0);
  expect(facts.strengthHistory.totalSessions).toBe(0);
});
