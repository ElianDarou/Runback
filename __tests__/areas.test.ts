import { analyzeRun } from '../src/domain/analysis';
import {
  activeExperimentFor,
  couplingGate,
  influencedAreas,
  recommendationArea,
} from '../src/domain/areas';
import {
  acceptRecommendation,
  evaluateAnyExperiment,
} from '../src/domain/experiments';
import { focusTypesFor, suggestedFocus } from '../src/domain/focus';
import { relevance } from '../src/domain/prioritization';
import { selectRecommendations } from '../src/domain/recommendationSelection';
import type { StrengthSession } from '../src/domain/strength';
import {
  evaluateStrengthExperiment,
  selectStrengthRecommendation,
  strengthRecommendationFor,
} from '../src/domain/strengthRecommendation';
import type { RunSummary, StrengthRecommendation } from '../src/domain/types';

const DAY = 24 * 60 * 60 * 1000;

function session(
  id: string,
  day: number,
  weightKg: number,
  exerciseId = 'barbell_back_squat',
  reps = 5,
): StrengthSession {
  const at = day * DAY;
  return {
    id,
    kind: 'strength',
    name: 'Unterkörper',
    startTime: at,
    endTime: at + 3600000,
    status: 'finished',
    currentExercise: 0,
    modelVersion: 'strength-v1',
    catalogVersion: 'catalog-v1',
    exercises: [
      {
        exerciseId,
        name: exerciseId === 'barbell_back_squat' ? 'Kniebeuge' : 'Bankdrücken',
        sets: [
          {
            id: `${id}-work`,
            planned: {
              kind: 'normal',
              loadKind: 'kg',
              weightKg,
              reps,
              restSeconds: 120,
            },
            actualWeightKg: weightKg,
            actualReps: reps,
            completedAt: at + 200,
          },
        ],
      },
    ],
  };
}
const run = (id: string, startTime: number): RunSummary => ({
  id,
  startTime,
  endTime: startTime + 1320000,
  durationSeconds: 1320,
  distanceMeters: 2000,
  purpose: 'easy',
  source: 'test',
  status: 'complete',
  segments: [300, 300, 360, 360].map((durationSeconds, index) => ({
    id: `${id}:${index}`,
    durationSeconds,
    distanceMeters: 500,
    gradePercent: 0,
  })),
});
/** Two comparable earlier runs: only the median of several runs supports a recommendation. */
const runHistory = (startTime: number) => [
  run('prev-1', startTime - 7 * DAY),
  run('prev-2', startTime - 14 * DAY),
];
const runRecommendation = (id: string, startTime: number) =>
  analyzeRun(run(id, startTime), undefined, runHistory(startTime))
    .recommendation!;
const legSessions = [
  session('s1', 0, 100),
  session('s2', 7, 105),
  session('s3', 14, 110),
  session('s4', 21, 115),
  session('s5', 28, 120),
];
const benchSessions = [
  session('b1', 0, 60, 'barbell_bench_press'),
  session('b2', 7, 62.5, 'barbell_bench_press'),
  session('b3', 14, 65, 'barbell_bench_press'),
  session('b4', 21, 67.5, 'barbell_bench_press'),
  session('b5', 28, 70, 'barbell_bench_press'),
];
const now = 34 * DAY;
const options = { today: '2026-09-12', now };

describe('Two areas', () => {
  it('assigns recommendations to their area; without a field it means running', () => {
    const running = runRecommendation('r', 30 * DAY);
    const strength = strengthRecommendationFor(
      legSessions,
      'barbell_back_squat',
      now,
    ).recommendation!;
    expect(recommendationArea(running)).toBe('running');
    expect(recommendationArea({ ...running, area: undefined })).toBe('running');
    expect(recommendationArea(strength)).toBe('strength');
    expect(strength.kind).toBe('strength_load');
    expect(strength.direction).toBe('increase');
    expect(strength.criteria.baselineSessionIds).toEqual(['s3', 's4', 's5']);
    expect(strength.criteria.method).toBe('strength-e1rm-v2');
    expect(strength.criteria.minimumObservations).toBe(6);
  });

  it('allows one active recommendation per area, but never two in the same area', () => {
    const running = acceptRecommendation(
      runRecommendation('r', 30 * DAY),
      1000,
    );
    const bench = strengthRecommendationFor(
      benchSessions,
      'barbell_bench_press',
      now,
    ).recommendation!;
    // A different area does not block acceptance.
    const strength = acceptRecommendation(bench, 2000, running);
    const all = [running, strength];
    expect(activeExperimentFor(all, 'running')?.id).toBe(running.id);
    expect(activeExperimentFor(all, 'strength')?.id).toBe(strength.id);
    // Same area: finish it first.
    expect(() => acceptRecommendation(bench, 3000, strength)).toThrow(
      'Zuerst die bestehende Empfehlung beenden.',
    );
  });

  it('locks leg-load recommendations while a running recommendation is being checked', () => {
    const running = acceptRecommendation(
      runRecommendation('r', 30 * DAY),
      1000,
    );
    const squat = strengthRecommendationFor(
      legSessions,
      'barbell_back_squat',
      now,
    ).recommendation!;
    const bench = strengthRecommendationFor(
      benchSessions,
      'barbell_bench_press',
      now,
    ).recommendation!;
    expect(influencedAreas(squat)).toEqual(['running']);
    expect(influencedAreas(bench)).toEqual([]);
    expect(couplingGate(squat, [running]).blocked).toMatch(/Laufen/);
    expect(couplingGate(bench, [running]).blocked).toBeUndefined();
    // Symmetric: a running leg-load recommendation locks running suggestions.
    const legs = acceptRecommendation(squat, 1000);
    expect(
      couplingGate(runRecommendation('r2', 30 * DAY), [legs]).blocked,
    ).toMatch(/Krafttraining/);
    const selection = selectRecommendations(
      [run('r3', 30 * DAY), ...runHistory(30 * DAY)],
      {
        ...options,
        otherActive: [legs],
      },
    );
    expect(selection.selected).toBeUndefined();
    expect(selection.alternatives[0].reason).toMatch(/Krafttraining/);
  });

  it('picks at most one recommendation in strength training and shows the rest as alternatives', () => {
    const result = selectStrengthRecommendation(
      [...legSessions, ...benchSessions],
      {
        ...options,
        focus: {
          version: 'focus-v1',
          kind: 'strength',
          label: '',
          area: 'strength',
        },
      },
    );
    expect(result.selected?.kind).toBe('strength_load');
    expect(result.selected?.priority).toEqual({
      version: 'relevance-v2',
      focusLabel: 'Stärker werden',
      weight: 5,
    });
    expect(result.alternatives).toHaveLength(1);
    // The order of the input does not change the selection.
    expect(
      selectStrengthRecommendation([...benchSessions, ...legSessions], options)
        .selected?.id,
    ).toBe(
      selectStrengthRecommendation([...legSessions, ...benchSessions], options)
        .selected?.id,
    );
  });

  it('checks a load recommendation against later sessions with separate follow-through', () => {
    const squat = strengthRecommendationFor(
      legSessions,
      'barbell_back_squat',
      now,
    ).recommendation!;
    const experiment = acceptRecommendation(squat, now);
    const inRange = squat.criteria.targetMinKg;
    const later = [
      session('s6', 35, inRange),
      session('s7', 38, inRange),
      session('s8', 41, inRange),
    ];
    const evaluation = evaluateStrengthExperiment(experiment, [
      ...legSessions,
      ...later,
    ]);
    expect(evaluation.eligibleRunIds).toEqual(['s6', 's7', 's8']);
    expect(evaluation.adherence.every(item => item.value === 'yes')).toBe(true);
    expect(evaluation.causalClaim).toBe(false);
    // Three sessions can never reach the sign test.
    expect(evaluation.verdict).toBe('insufficient_evidence');
    // Not carried out does not mean disproven.
    const skipped = evaluateStrengthExperiment(experiment, [
      ...legSessions,
      session('s6', 35, 50),
      session('s7', 38, 50),
      session('s8', 41, 50),
    ]);
    expect(skipped.verdict).toBe('not_implemented');
    expect(
      evaluateAnyExperiment(experiment, [], [...legSessions, ...later]).verdict,
    ).toBe(evaluation.verdict);
  });

  it('has its own focus types and suggestions per area', () => {
    expect(focusTypesFor('strength').map(item => item.value)).toContain(
      'strength',
    );
    expect(focusTypesFor('running').map(item => item.value)).not.toContain(
      'strength',
    );
    expect(suggestedFocus('100 kg Kniebeuge', 'strength')).toBe('strength');
    expect(suggestedFocus('Halbmarathon', 'running')).toBe('endurance');
    expect(relevance('strength_load', 'strength').weight).toBe(5);
    expect(relevance('strength_load', 'fitness').weight).toBe(0);
    expect(relevance('volume', 'injury_free').blocked).toBeTruthy();
  });
});

// Type check: the snapshot structure stays serializable.
const _probe: StrengthRecommendation['criteria']['method'] = 'strength-e1rm-v2';
void _probe;


it('locks a parallel check even with unknown muscle regions', () => {
  const recommendation = strengthRecommendationFor(legSessions, 'barbell_back_squat', now).recommendation!;
  const unknown = { ...recommendation, regions: [] };
  const running = acceptRecommendation(runRecommendation('r', 30 * DAY), 1000);
  expect(influencedAreas(unknown)).toEqual(['running']);
  expect(couplingGate(unknown, [running]).blocked).toMatch(/Laufen/);
  expect(couplingGate(unknown, []).modelVersion).toBe('coupling-v2');
});
