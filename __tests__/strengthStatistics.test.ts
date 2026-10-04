import {
  buildStrengthStatisticsView,
  strengthBucketValue,
} from '../src/domain/strengthStatistics';
import type { StrengthHeartSummary } from '../src/domain/strengthHeart';
import { DAY, MINUTE, strengthSession } from './fixtures/strengthSessions';

// Montag, 9. März 2026, lokale Zeit.
const NOW = new Date(2026, 2, 9, 12).getTime();

const bench = (weightKg: number, at = 5) => ({
  weightKg,
  reps: 8,
  at,
  rir: 2,
});

const session = (id: string, daysAgo: number, weightKg = 80) =>
  strengthSession(id, NOW - daysAgo * DAY, [
    [
      'barbell_bench_press',
      'Bankdrücken',
      [bench(weightKg, 5), bench(weightKg, 8), bench(weightKg, 11)],
    ],
    ['barbell_back_squat', 'Kniebeuge', [{ weightKg: 100, reps: 5, at: 20 }]],
  ]);

const heart = (averageBpm: number, maxBpm: number) =>
  ({
    model_version: 'strength-heart-v1',
    source: 'watch',
    startTime: 0,
    stepSeconds: 5,
    averageBpm,
    maxBpm,
    minBpm: 80,
    coverage: 1,
    samples: 100,
    clockAligned: true,
  } as StrengthHeartSummary);

describe('buildStrengthStatisticsView', () => {
  it('counts only finished sessions inside the range', () => {
    const sessions = [
      session('a', 2),
      session('b', 9),
      session('old', 60),
      { ...session('open', 1), status: 'active' as const },
    ];
    const view = buildStrengthStatisticsView(sessions, '4w', NOW);
    expect(view.sessions.map(entry => entry.id)).toEqual(['b', 'a']);
    expect(view.totals).toMatchObject({
      sessionCount: 2,
      sets: 8,
      workingSets: 8,
      volumeKg: 2 * (3 * 80 * 8 + 500),
      durationSeconds: 7200,
      averageDurationSeconds: 3600,
      setsPerSession: 4,
      activeDays: 2,
      medianRir: 2,
      rirSets: 6,
      averageBpm: null,
      heartSessions: 0,
      medianSetGapSeconds: 180,
    });
    expect(view.buckets).toHaveLength(4);
    expect(view.buckets.reduce((sum, bucket) => sum + bucket.sessionCount, 0)).toBe(2);
    expect(view.available).toEqual({ volume: true, duration: true, heartRate: false });
  });

  it('compares with the period before only when there was one', () => {
    const view = buildStrengthStatisticsView(
      [session('a', 2), session('before', 35)],
      '4w',
      NOW,
    );
    expect(view.comparisonLabel).toBe('die 4 Wochen davor');
    expect(view.deltas.sessions.direction).toBe('flat');
    const alone = buildStrengthStatisticsView([session('a', 2)], '4w', NOW);
    expect(alone.comparisonLabel).toBeNull();
    expect(alone.deltas.sets.direction).toBe('unknown');
  });

  it('distributes working sets over muscle groups', () => {
    const view = buildStrengthStatisticsView([session('a', 2)], '4w', NOW);
    expect(view.muscles.groups.map(group => [group.label, group.sets])).toEqual([
      ['Brust', 3],
      ['Trizeps', 3],
      ['Gesäß', 1],
      ['Oberschenkel vorn', 1],
    ]);
    expect(view.muscles.weekCount).toBe(4);
  });

  it('lists exercises with their best set and a trend from all sessions', () => {
    const sessions = [0, 1, 2, 3, 4, 5].map(index =>
      session(`s${index}`, 70 - index * 14, 70 + index * 2.5),
    );
    const view = buildStrengthStatisticsView(sessions, '4w', NOW);
    const [first] = view.exercises;
    expect(first.exerciseId).toBe('barbell_bench_press');
    // Im Zeitraum liegen die letzten beiden (vor 14 Tagen und heute).
    expect(first.sessions).toBe(2);
    expect(first.best).toMatchObject({ weightKg: 82.5, reps: 8 });
    // Der Trend sieht alle sechs Einheiten, nicht nur die im Zeitraum.
    expect(first.trend.label).toBe('Steigt');
  });

  it('names records and the sessions behind them', () => {
    const big = strengthSession(
      'big',
      NOW - 3 * DAY,
      [['barbell_bench_press', 'Bankdrücken', [bench(100), bench(100, 8)]]],
      { endTime: NOW - 3 * DAY + 95 * MINUTE },
    );
    const view = buildStrengthStatisticsView([session('a', 2), big], '4w', NOW);
    const byId = Object.fromEntries(view.records.map(record => [record.id, record]));
    expect(byId['biggest-volume'].sessionIds).toEqual(['a']);
    expect(byId.longest.value).toBe('1 h 35 min');
    expect(byId.longest.sessionIds).toEqual(['big']);
    expect(byId['best-week'].value).toBe('6 Sätze');
  });

  it('uses the watch heart rate where there is one', () => {
    const view = buildStrengthStatisticsView(
      [session('a', 2), session('b', 3)],
      '4w',
      NOW,
      { a: heart(120, 160) },
    );
    expect(view.totals.averageBpm).toBe(120);
    expect(view.totals.maxBpm).toBe(160);
    expect(view.totals.heartSessions).toBe(1);
    // NOW ist ein Montag; beide Einheiten liegen in der Woche davor.
    const week = view.buckets[view.buckets.length - 2];
    expect(week.sessionCount).toBe(2);
    expect(strengthBucketValue(week, 'heartRate')).toBe(120);
    expect(strengthBucketValue(view.buckets[0], 'heartRate')).toBeNull();
    expect(view.available.heartRate).toBe(true);
  });
});
