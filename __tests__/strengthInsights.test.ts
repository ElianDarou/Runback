import {
  exerciseGroups,
  muscleDistribution,
} from '../src/domain/muscleGroups';
import {
  readStrengthHeart,
  readStrengthHeartSummaries,
  sessionHeartInsight,
  type StrengthHeart,
} from '../src/domain/strengthHeart';
import {
  exerciseBreakdown,
  exerciseComparison,
  rateE1RM,
  sessionComparison,
  sessionDurationSeconds,
  setGaps,
  setLabel,
} from '../src/domain/strengthSession';
import { exerciseHistory } from '../src/domain/exerciseHistory';
import { DAY, MINUTE, strengthSession } from './fixtures/strengthSessions';

const START = new Date(2026, 2, 2, 18).getTime();

describe('muscle groups', () => {
  it('counts a working set for each group with at least a quarter share', () => {
    expect(exerciseGroups('barbell_bench_press')).toEqual(['chest', 'triceps']);
    expect(exerciseGroups('barbell_back_squat')).toEqual(['glutes', 'quads']);
    expect(exerciseGroups('pull_up')).toEqual(['back']);
  });

  it('falls back to the database primary muscles and never guesses', () => {
    expect(exerciseGroups('fedb:Arnold_Dumbbell_Press')).toEqual(['shoulders']);
    expect(exerciseGroups('my-own-thing', 'Meine Übung')).toBeUndefined();
  });

  it('skips warm-ups, open and skipped sets and keeps unknown exercises apart', () => {
    const session = strengthSession('a', START, [
      [
        'barbell_bench_press',
        'Bankdrücken',
        [
          { weightKg: 40, reps: 10, at: 2, warmup: true },
          { weightKg: 80, reps: 8, at: 5 },
          { weightKg: 80, reps: 8, at: 8 },
          { weightKg: 80, reps: 8 },
          { weightKg: 80, reps: 8, at: 10, skipped: true },
        ],
      ],
      ['custom', 'Eigene Übung', [{ reps: 12, at: 15 }]],
    ]);
    const result = muscleDistribution([session]);
    expect(result.groups).toEqual([
      { group: 'chest', label: 'Brust', sets: 2 },
      { group: 'triceps', label: 'Trizeps', sets: 2 },
    ]);
    expect(result.unassignedSets).toBe(1);
    expect(result.workingSets).toBe(3);
  });
});

describe('session breakdown', () => {
  const session = strengthSession('a', START, [
    [
      'barbell_bench_press',
      'Bankdrücken',
      [
        { weightKg: 40, reps: 10, at: 2, warmup: true },
        { weightKg: 80, reps: 8, at: 5, rir: 2 },
        { weightKg: 85, reps: 5, at: 8, rir: 1 },
        { weightKg: 80, reps: 8, skipped: true },
      ],
    ],
    ['plank', 'Unterarmstütz', [{ seconds: 60, at: 20 }]],
  ]);

  it('takes the best set by estimated maximum and keeps unknown values unknown', () => {
    const [bench, plank] = exerciseBreakdown(session);
    expect(bench).toMatchObject({
      workingSets: 2,
      warmupSets: 1,
      skippedSets: 1,
      volumeKg: 40 * 10 + 80 * 8 + 85 * 5,
      totalReps: 23,
      topWeightKg: 85,
      medianRir: 1.5,
    });
    // 85 × 5 → 99,2 kg schlägt 80 × 8 → 101,3 kg nicht.
    expect(setLabel(bench.bestSet!)).toBe('80 kg × 8');
    expect(bench.bestSet!.e1rm).toBeCloseTo(101.33, 1);
    expect(plank.bestSet).toMatchObject({ seconds: 60 });
    expect(plank.bestSet!.e1rm).toBeUndefined();
    expect(plank.medianRir).toBeUndefined();
  });

  it('measures set-to-set gaps within one exercise only', () => {
    const gaps = setGaps(session);
    expect(gaps.gaps).toEqual([180, 180]);
    expect(gaps.medianSeconds).toBe(180);
    expect(gaps.plannedMedianSeconds).toBe(120);
  });

  it('has no duration without an end', () => {
    expect(sessionDurationSeconds(session)).toBe(3600);
    expect(
      sessionDurationSeconds({ ...session, endTime: undefined }),
    ).toBeUndefined();
  });
});

describe('comparisons', () => {
  const past = (index: number, weightKg: number, templateId = 'push') =>
    strengthSession(
      `p${index}`,
      START - (index + 1) * 7 * DAY,
      [
        [
          'barbell_bench_press',
          'Bankdrücken',
          [
            { weightKg, reps: 8, at: 5 },
            { weightKg, reps: 8, at: 8 },
          ],
        ],
      ],
      { templateId, endTime: START - (index + 1) * 7 * DAY + 50 * MINUTE },
    );
  const current = strengthSession(
    'now',
    START,
    [
      [
        'barbell_bench_press',
        'Bankdrücken',
        [
          { weightKg: 90, reps: 8, at: 5 },
          { weightKg: 90, reps: 8, at: 8 },
          { weightKg: 90, reps: 8, at: 11 },
        ],
      ],
    ],
    { templateId: 'push' },
  );

  it('compares a session only with sessions of the same template, from three on', () => {
    const history = [past(0, 80), past(1, 80), past(2, 80, 'legs')];
    expect(sessionComparison(current, history)).toBeUndefined();
    const enough = [...history, past(3, 80)];
    const result = sessionComparison(current, enough, {
      now: { averageBpm: 120 } as never,
    })!;
    expect(result.sessionIds).toEqual(['p0', 'p1', 'p3']);
    expect(result.sets!.deltaPercent).toBeCloseTo(50);
    expect(result.durationSeconds!.median).toBe(3000);
    // Ohne Puls in den Vergleichseinheiten kein Vergleich.
    expect(result.averageBpm).toBeUndefined();
  });

  it('rates an exercise against the median of earlier sessions', () => {
    const history = [past(0, 80), past(1, 82.5), past(2, 85)];
    const result = exerciseComparison(current, history, 'barbell_bench_press')!;
    expect(result.last).toMatchObject({ sessionId: 'p0', label: '80 kg × 8' });
    expect(result.deltaPercent).toBeCloseTo((90 / 82.5 - 1) * 100);
    expect(result.rating).toBe('better');
    // Mit nur einer früheren Einheit gibt es das letzte Mal, aber kein Urteil.
    const single = exerciseComparison(current, [past(0, 80)], 'barbell_bench_press')!;
    expect(single.last).toBeDefined();
    expect(single.rating).toBeUndefined();
  });

  it('rates small differences as the same', () => {
    expect(rateE1RM(3.9)).toBe('same');
    expect(rateE1RM(-3.9)).toBe('same');
    expect(rateE1RM(-5)).toBe('slightly_worse');
    expect(rateE1RM(-9)).toBe('worse');
  });
});

describe('heart rate in a session', () => {
  const session = strengthSession('h', START, [
    [
      'barbell_bench_press',
      'Bankdrücken',
      [
        { weightKg: 80, reps: 8, at: 2 },
        { weightKg: 80, reps: 8, at: 5 },
        { weightKg: 80, reps: 8, at: 8 },
        { weightKg: 80, reps: 8, at: 9 },
      ],
    ],
  ]);
  // 5-s-Fenster über 12 Minuten: Ruhe 90, 30 s vor jedem Abhaken bis 140,
  // eine Minute danach wieder 110.
  const values: (number | null)[] = Array.from({ length: 144 }, (_, i) => {
    const t = i * 5 + 2.5;
    const near = [2, 5, 8, 9].some(
      minute => t >= minute * 60 - 30 && t <= minute * 60 + 10,
    );
    return near ? 140 : 110;
  });
  values[0] = null;
  const heart: StrengthHeart = {
    model_version: 'strength-heart-v1',
    source: 'watch',
    startTime: START,
    stepSeconds: 5,
    averageBpm: 115,
    maxBpm: 140,
    minBpm: 110,
    coverage: 0.99,
    samples: 700,
    clockAligned: true,
    values,
  };

  it('finds the set peak and the drop in the first minute of rest', () => {
    const insight = sessionHeartInsight(session, heart);
    expect(insight.sets.map(set => set.peakBpm)).toEqual([140, 140, 140, 140]);
    // Satz 3 wird nach 60 s schon vom nächsten Satz überlagert: keine Erholung.
    expect(insight.sets.map(set => set.recoveryBpm)).toEqual([
      30,
      30,
      undefined,
      30,
    ]);
    expect(insight.medianPeakBpm).toBe(140);
    expect(insight.medianRecoveryBpm).toBe(30);
    expect(insight.recoverySets).toBe(3);
    expect(insight.byExercise[0]).toMatchObject({ peakBpm: 140, sets: 4 });
  });

  it('stays silent with fewer than three sets', () => {
    const short = { ...session, exercises: [{ ...session.exercises[0], sets: session.exercises[0].sets.slice(0, 2) }] };
    const insight = sessionHeartInsight(short, heart);
    expect(insight.medianPeakBpm).toBeUndefined();
    expect(insight.medianRecoveryBpm).toBeUndefined();
  });

  it('accepts only usable bridge data', () => {
    expect(readStrengthHeart(null)).toBeUndefined();
    expect(readStrengthHeart({ ...heart, stepSeconds: 0 })).toBeUndefined();
    expect(readStrengthHeart({ ...heart, values: [1, 'x', null] })!.values).toEqual([
      1,
      null,
      null,
    ]);
    expect(
      Object.keys(
        readStrengthHeartSummaries({
          sessions: { a: { averageBpm: 1, maxBpm: 2 }, b: { averageBpm: 'x' } },
        }),
      ),
    ).toEqual(['a']);
  });
});

describe('exercise history', () => {
  const sessions = [80, 82.5, 85, 87.5, 90, 92.5].map((weightKg, index) =>
    strengthSession(`s${index}`, START + index * 7 * DAY, [
      [
        'barbell_bench_press',
        index === 5 ? 'Bankdrücken (neu)' : 'Bankdrücken',
        [
          { weightKg, reps: 5, at: 5 },
          { weightKg: weightKg - 10, reps: 10, at: 8 },
        ],
      ],
    ]),
  );

  it('lists sessions oldest first with records and the progression verdict', () => {
    const history = exerciseHistory(sessions, 'barbell_bench_press');
    expect(history.name).toBe('Bankdrücken (neu)');
    expect(history.points.map(point => point.topWeightKg)).toEqual([
      80, 82.5, 85, 87.5, 90, 92.5,
    ]);
    expect(history.records.map(record => record.id)).toEqual([
      'e1rm',
      'weight',
      'volume',
    ]);
    expect(history.records[1].point.sessionId).toBe('s5');
    expect(history.trend).toMatchObject({ verdict: 'increase', label: 'Steigt' });
  });

  it('says honestly when there are too few sessions', () => {
    const history = exerciseHistory(sessions.slice(0, 2), 'barbell_bench_press');
    expect(history.trend.label).toBe('Noch nicht klar');
    expect(history.trend.verdict).toBe('not_assessable');
  });
});
