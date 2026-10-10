import {
  driftVerdictLabel,
  endRecovery,
  environmentCost,
  evennessLabel,
  fatiguePattern,
  formatSignedNumber,
  formatSignedPercent,
  formatSignedSeconds,
  heartRateZoneLabel,
  gradeAdjustedPace,
  heartRateDrift,
  heartRatePaceCurve,
  heartRateZones,
  maxHeartRate,
  metersPerBeat,
  minettiCost,
  movementInsight,
  pacingVerdict,
  rateDelta,
  recentComparison,
  recentRuns,
  sameRouteComparison,
  timeBudgetShares,
  walkRecovery,
  weatherInsight,
} from '../src/domain/insights';
import { pacingFor } from '../src/domain/analysis';
import { setLanguage } from '../src/domain/i18n';
import type { RunSeries, SeriesRow } from '../src/domain/runSeries';
import type { RunSummary, SegmentAggregate } from '../src/domain/types';

const DAY = 24 * 60 * 60 * 1000;
const NOW = 1_700_000_000_000;

/** A run of even kilometers; `paces` in s/km, `hrs` in bpm. */
function runWith(
  id: string,
  paces: number[],
  hrs: (number | undefined)[] = [],
  extra: Partial<RunSummary> = {},
  segmentExtra: Partial<SegmentAggregate>[] = [],
): RunSummary {
  let elapsed = 0;
  const segments: SegmentAggregate[] = paces.map((pace, i) => {
    const start = elapsed;
    elapsed += pace;
    return {
      distanceMeters: 1000,
      durationSeconds: pace,
      movingSeconds: pace,
      avgHeartRate: hrs[i],
      startElapsedSeconds: start,
      endElapsedSeconds: elapsed,
      ascentMeters: 0,
      descentMeters: 0,
      ...segmentExtra[i],
    };
  });
  const hrValues = hrs.filter((v): v is number => v !== undefined);
  return {
    id,
    startTime: NOW,
    endTime: NOW + elapsed * 1000,
    durationSeconds: elapsed,
    distanceMeters: paces.length * 1000,
    purpose: 'easy',
    source: 'phone',
    status: 'completed',
    avgHeartRate: hrValues.length
      ? hrValues.reduce((a, b) => a + b, 0) / hrValues.length
      : undefined,
    avgCadence: 170,
    time: {
      model_version: 't',
      elapsedSeconds: elapsed,
      pausedSeconds: 0,
      activeSeconds: elapsed,
      movingSeconds: elapsed,
      runningSeconds: elapsed,
      walkingSeconds: 0,
      stoppedSeconds: 0,
      unknownSeconds: 0,
    },
    segments,
    ...extra,
  };
}
const daysAgo = (days: number) => NOW - days * DAY;

const rowsFrom = (
  count: number,
  build: (i: number) => Partial<SeriesRow>,
): SeriesRow[] =>
  Array.from({ length: count }, (_, i) => ({
    elapsedSeconds: (i + 1) * 5,
    distanceMeters: (i + 1) * 15,
    moving: true,
    speedMps: 3,
    ...build(i),
  }));
const seriesOf = (rows: SeriesRow[]): RunSeries => ({ stepSeconds: 5, rows });

describe('Movement', () => {
  it('splits the time budget into running, walking and standing', () => {
    const run = runWith('a', [300, 300], [], {
      time: {
        model_version: 't',
        elapsedSeconds: 700,
        pausedSeconds: 60,
        activeSeconds: 640,
        movingSeconds: 600,
        runningSeconds: 500,
        walkingSeconds: 100,
        stoppedSeconds: 40,
        unknownSeconds: 0,
      },
    });
    expect(timeBudgetShares(run)).toEqual({
      runningSeconds: 500,
      walkingSeconds: 100,
      stoppedSeconds: 40,
      pausedSeconds: 60,
      totalSeconds: 640,
    });
    expect(timeBudgetShares({ ...run, time: undefined })).toBeUndefined();
  });

  it('takes the longest stretch and the changes from the phase figures', () => {
    const run = runWith('a', [300], [], {
      phaseMetrics: {
        model_version: 'p',
        longestRunMeters: 4800,
        longestRunSeconds: 1620,
        runWalkTransitions: 7,
        trailingIdleSeconds: 0,
        running: { seconds: 2000, meters: 6000, avgHeartRate: 158 },
        walking: { seconds: 200, meters: 300, avgHeartRate: 121 },
        stopped: { seconds: 0, meters: 0 },
      },
    });
    expect(movementInsight(run)).toEqual({
      longestRunMeters: 4800,
      longestRunSeconds: 1620,
      runWalkTransitions: 7,
      runningHeartRate: 158,
      walkingHeartRate: 121,
    });
    expect(movementInsight(runWith('b', [300]))).toBeUndefined();
  });
});

describe('Heart rate recovery', () => {
  const phases = [
    {
      state: 'RUN' as const,
      startElapsedSeconds: 0,
      endElapsedSeconds: 300,
      distanceMeters: 1000,
    },
    {
      state: 'WALK' as const,
      startElapsedSeconds: 300,
      endElapsedSeconds: 420,
      distanceMeters: 150,
    },
    {
      state: 'RUN' as const,
      startElapsedSeconds: 420,
      endElapsedSeconds: 720,
      distanceMeters: 1000,
    },
    {
      state: 'STOPPED' as const,
      startElapsedSeconds: 720,
      endElapsedSeconds: 800,
      distanceMeters: 0,
    },
  ];
  // Heart rate: 160 while running, falls linearly to 130 in the walking break, to 120 after the end.
  const rows = rowsFrom(160, i => {
    const t = (i + 1) * 5;
    const heartRate =
      t <= 300
        ? 160
        : t <= 420
        ? Math.max(130, 160 - (t - 300) / 2)
        : t <= 720
        ? 160
        : Math.max(120, 160 - (t - 720) / 2);
    return { heartRate, moving: t <= 720 };
  });

  it('measures the drop in the first minute of a walking break', () => {
    const result = walkRecovery(
      runWith('a', [300, 300], [160, 160], { phases }),
      seriesOf(rows),
    );
    expect(result?.pauses).toBe(1);
    // ±5 s averaging at the phase boundary smooths the edge a little.
    expect(result?.dropFirstMinute).toBeGreaterThan(27);
    expect(result?.dropFirstMinute).toBeLessThanOrEqual(30);
    expect(result?.lowestHeartRate).toBe(130);
  });

  it('measures recovery after the last running stretch', () => {
    const result = endRecovery(
      runWith('a', [300, 300], [160, 160], { phases }),
      seriesOf(rows),
    );
    expect(result?.heartRateAtEnd).toBeGreaterThan(158);
    expect(result?.dropFirstMinute).toBeGreaterThan(27);
    expect(result?.dropFirstMinute).toBeLessThanOrEqual(30);
  });

  it('stays empty without a series, phases or cool-down', () => {
    expect(walkRecovery(runWith('a', [300]), null)).toBeUndefined();
    const short = phases.slice(0, 3);
    expect(
      endRecovery(
        runWith('a', [300, 300], [], { phases: short }),
        seriesOf(rows),
      ),
    ).toBeUndefined();
  });
});

describe('Pacing', () => {
  it('detects negative split, evenness and the fastest kilometer', () => {
    const run = runWith('a', [320, 318, 315, 300, 298, 296]);
    const verdict = pacingVerdict(pacingFor(run), run)!;
    expect(verdict.split).toBe('negative');
    expect(verdict.sentence).toMatch(/Negativ-Split/);
    expect(verdict.evenness).toBe('veryEven');
    expect(verdict.fastestSegmentIndex).toBe(5);
    expect(verdict.slowestSegmentIndex).toBe(0);
    expect(verdict.fastestSecondsPerKm).toBe(296);
  });

  it('names a clear drop and uneven pace', () => {
    const run = runWith('a', [280, 330, 290, 340, 320, 360]);
    const verdict = pacingVerdict(pacingFor(run), run)!;
    expect(verdict.split).toBe('positive');
    expect(verdict.evenness).toBe('uneven');
    expect(pacingVerdict(undefined, run)).toBeUndefined();
  });

  it('computes heart rate drift without the first kilometer', () => {
    // Same pace, heart rate rises 8 % in the second half.
    const run = runWith(
      'a',
      [300, 300, 300, 300, 300, 300, 300],
      [140, 150, 150, 150, 162, 162, 162],
    );
    const drift = heartRateDrift(run)!;
    expect(drift.percent).toBeCloseTo(8, 0);
    expect(drift.verdict).toBe('slightDrift');
    expect(drift.segmentCount).toBe(6);
    expect(
      heartRateDrift(runWith('b', [300, 300, 300], [150, 150, 150])),
    ).toBeUndefined();
  });

  it('computes meters per beat', () => {
    const run = runWith('a', [300, 300], [150, 150]);
    // 2000 m / (150 bpm × 10 min)
    expect(metersPerBeat(run)).toBeCloseTo(1.333, 2);
    expect(metersPerBeat(runWith('b', [300, 300]))).toBeUndefined();
  });

  it('estimates a flat equivalent from the net gradient', () => {
    expect(minettiCost(0)).toBeCloseTo(3.6, 5);
    expect(minettiCost(0.05)).toBeGreaterThan(minettiCost(0));
    expect(minettiCost(-0.05)).toBeLessThan(minettiCost(0));
    const run = runWith('a', [300, 330, 300, 280], [], {}, [
      { gradePercent: 0 },
      { gradePercent: 5 },
      { gradePercent: 0 },
      { gradePercent: -4 },
    ]);
    const gap = gradeAdjustedPace(run)!;
    expect(gap.realSecondsPerKm).toBeCloseTo(302.5, 1);
    expect(gap.adjustedSecondsPerKm).toBeLessThan(gap.realSecondsPerKm);
    expect(gap.perSegment[1]).toBeLessThan(330);
    expect(gap.perSegment[3]).toBeGreaterThan(280);
    expect(gap.coveredMeters).toBe(4000);
  });

  it('gives no flat equivalent when the gradient is mostly missing', () => {
    const run = runWith('a', [300, 300, 300, 300], [], {}, [
      { gradePercent: 3 },
    ]);
    expect(gradeAdjustedPace(run)).toBeUndefined();
  });
});

describe('Heart rate zones', () => {
  const history = [
    runWith('h1', [300], [150], { avgHeartRateMax: 181 }),
    runWith('h2', [300], [150], { avgHeartRateMax: 189 }),
    runWith('h3', [300], [150], { avgHeartRateMax: 205 }),
    runWith('h4', [300], [150], { avgHeartRateMax: 186 }),
  ];

  it('uses the setting, otherwise the second-highest peak', () => {
    expect(maxHeartRate(192, history)).toEqual({
      value: 192,
      source: 'setting',
    });
    expect(maxHeartRate(undefined, history)).toEqual({
      value: 189,
      source: 'estimate',
      runs: 4,
    });
    expect(maxHeartRate(undefined, history.slice(0, 2))).toBeUndefined();
    expect(maxHeartRate(50, history)?.source).toBe('estimate');
  });

  it('spreads the time across five zones', () => {
    // 100 rows of 5 s each: 20 each in Z1..Z5 at max heart rate 200.
    const rows = rowsFrom(100, i => ({
      heartRate: [110, 130, 150, 170, 190][Math.floor(i / 20)],
    }));
    const zones = heartRateZones(seriesOf(rows), {
      value: 200,
      source: 'setting',
    })!;
    expect(zones.coveredSeconds).toBe(500);
    expect(zones.zones.map(z => z.share)).toEqual([0.2, 0.2, 0.2, 0.2, 0.2]);
    expect(zones.zones[1].label).toBe('locker');
    expect(
      heartRateZones(seriesOf(rows.slice(0, 10)), {
        value: 200,
        source: 'setting',
      }),
    ).toBeUndefined();
    expect(heartRateZones(seriesOf(rows), undefined)).toBeUndefined();
  });
});

describe('Fatigue', () => {
  const base = runWith('a', [300, 300, 300, 300]);

  it('detects tired legs from cadence and stride length at a calm heart rate', () => {
    const rows = rowsFrom(120, i => ({
      speedMps: i < 80 ? 3.3 : 3.1,
      cadence: i < 80 ? 176 : 166,
      heartRate: 152,
    }));
    const result = fatiguePattern(base, seriesOf(rows))!;
    expect(result.verdict).toBe('muscular');
    expect(result.cadenceChangePercent).toBeCloseTo(-5.7, 0);
  });

  it('detects circulation or heat from a rising heart rate at the same pace', () => {
    const rows = rowsFrom(120, i => ({
      speedMps: 3.3,
      cadence: 176,
      heartRate: i < 80 ? 150 : 162,
    }));
    expect(fatiguePattern(base, seriesOf(rows))!.verdict).toBe('circulation');
  });

  it('calls steady runs steady and leaves out short runs', () => {
    const rows = rowsFrom(120, () => ({
      speedMps: 3.3,
      cadence: 176,
      heartRate: 150,
    }));
    expect(fatiguePattern(base, seriesOf(rows))!.verdict).toBe('stable');
    expect(
      fatiguePattern(runWith('b', [300, 300]), seriesOf(rows)),
    ).toBeUndefined();
    expect(fatiguePattern(base, null)).toBeUndefined();
  });
});

describe('Conditions', () => {
  it('collects temperature, wind and headwind kilometers', () => {
    const run = runWith('a', [300, 300, 300], [], {
      context: { temperatureC: 14, windMps: 4 },
    });
    const rows = rowsFrom(180, i => ({
      distanceMeters: i * 16.7,
      headwindMps: i < 60 ? 2.5 : i < 120 ? 0 : -2.5,
    }));
    const weather = weatherInsight(run, {
      ...seriesOf(rows),
      wind: { mps: 4.2, fromDeg: 230 },
    })!;
    expect(weather.temperatureC).toBe(14);
    expect(weather.windMps).toBe(4.2);
    expect(weather.windFromDeg).toBe(230);
    expect(weather.headwindKilometers).toEqual([1]);
    expect(weather.tailwindKilometers).toEqual([3]);
    expect(weatherInsight(runWith('b', [300]), null)).toBeUndefined();
  });

  it('estimates wind and heat costs with their sign', () => {
    const headwind = rowsFrom(200, () => ({ speedMps: 3.3, headwindMps: 4 }));
    const tailwind = rowsFrom(200, () => ({ speedMps: 3.3, headwindMps: -4 }));
    const warm = runWith('a', [300, 300, 300], [], {
      context: { temperatureC: 25 },
    });
    const costHead = environmentCost(warm, seriesOf(headwind))!;
    const costTail = environmentCost(warm, seriesOf(tailwind))!;
    expect(costHead.windSecondsPerKm).toBeGreaterThan(3);
    expect(costHead.windSecondsPerKm).toBeLessThan(30);
    expect(costTail.windSecondsPerKm).toBeLessThan(-2);
    expect(costHead.windCoverage).toBe(1);
    // 10 °C above the threshold: 3 % of 300 s/km ≈ 9 s
    expect(costHead.heatSecondsPerKm).toBeCloseTo(8.7, 0);
    expect(environmentCost(runWith('b', [300, 300]), null)).toBeUndefined();
    expect(
      environmentCost(
        runWith('c', [300, 300], [], { context: { temperatureC: 10 } }),
        null,
      ),
    ).toBeUndefined();
  });
});

describe('Comparison with yourself', () => {
  const current = runWith(
    'now',
    [290, 290, 290, 290, 290],
    [148, 148, 148, 148, 148],
  );
  const history = [
    runWith('p1', [300, 300, 300, 300, 300], [150, 150, 150, 150, 150], {
      startTime: daysAgo(3),
    }),
    runWith('p2', [305, 305, 305, 305, 305], [152, 152, 152, 152, 152], {
      startTime: daysAgo(10),
    }),
    runWith('p3', [310, 310, 310, 310, 310], [155, 155, 155, 155, 155], {
      startTime: daysAgo(20),
    }),
    runWith('fast', [330, 330, 330, 330, 330], [140, 140, 140, 140, 140], {
      startTime: daysAgo(5),
      purpose: 'race',
    }),
    runWith('old', [200, 200, 200, 200, 200], [170, 170, 170, 170, 170], {
      startTime: daysAgo(200),
    }),
    runWith('later', [200, 200, 200, 200, 200], [170, 170, 170, 170, 170], {
      startTime: NOW + DAY,
    }),
    runWith('bike', [200, 200, 200, 200, 200], [170, 170, 170, 170, 170], {
      startTime: daysAgo(1),
      sport: 'cycling',
    }),
  ];

  it('takes only earlier runs in the window, of the same kind, preferring the same purpose', () => {
    expect(recentRuns(current, history).map(run => run.id)).toEqual([
      'p1',
      'p2',
      'p3',
    ]);
    const free = { ...current, purpose: 'free' as const };
    expect(recentRuns(free, history).map(run => run.id)).toEqual([
      'p1',
      'fast',
      'p2',
      'p3',
    ]);
  });

  it('counts an old long run as an easy run', () => {
    const oldLong = history.map(run =>
      run.id === 'p2' ? { ...run, purpose: 'long' as const } : run,
    );
    expect(recentRuns(current, oldLong).map(run => run.id)).toEqual([
      'p1',
      'p2',
      'p3',
    ]);
    expect(
      recentComparison(current, oldLong, pacingFor(current))!.samePurpose,
    ).toBe(true);
  });

  it('rates against the median in color and direction', () => {
    expect(rateDelta('pace', -4)).toBe('better');
    expect(rateDelta('pace', 1)).toBe('same');
    expect(rateDelta('pace', 4)).toBe('slightly_worse');
    expect(rateDelta('pace', 7)).toBe('worse');
    expect(rateDelta('metersPerBeat', 4)).toBe('better');
    expect(rateDelta('cadence', -5)).toBe('worse');
  });

  it('compares pace, heart rate, efficiency and cadence with the last runs', () => {
    const result = recentComparison(current, history, pacingFor(current))!;
    expect(result.count).toBe(3);
    expect(result.samePurpose).toBe(true);
    const pace = result.metrics.find(m => m.metric === 'pace')!;
    expect(pace.reference).toBe(305);
    expect(pace.deltaPercent).toBeCloseTo(-4.9, 0);
    expect(pace.rating).toBe('better');
    const hr = result.metrics.find(m => m.metric === 'heartRate')!;
    expect(hr.reference).toBe(152);
    expect(hr.rating).toBe('same');
    expect(result.metrics.find(m => m.metric === 'metersPerBeat')!.rating).toBe(
      'better',
    );
    expect(result.metrics.find(m => m.metric === 'cadence')!.rating).toBe(
      'same',
    );
    expect(result.metrics.find(m => m.metric === 'fade')!.rating).toBe('same');
  });

  it('needs at least three comparison runs', () => {
    expect(recentComparison(current, history.slice(0, 2))).toBeUndefined();
  });

  it('compares runs on the same route', () => {
    const route = { routeId: 'r' };
    const run = runWith('now', [300, 300], [], { context: route });
    const before = [
      runWith('a', [310, 310], [], { context: route, startTime: daysAgo(2) }),
      runWith('b', [290, 290], [], { context: route, startTime: daysAgo(9) }),
      runWith('c', [280, 280], [], {
        context: { routeId: 'other' },
        startTime: daysAgo(1),
      }),
    ];
    expect(sameRouteComparison(run, before)).toEqual({
      ordinal: 3,
      lastSeconds: 620,
      currentSeconds: 600,
      bestSeconds: 580,
      deltaToLastSeconds: -20,
    });
    expect(sameRouteComparison(runWith('x', [300]), before)).toBeUndefined();
  });

  it('fits a heart rate-pace line through the last runs and measures the distance', () => {
    // History: heart rate = 100 + 15 × speed; today's run 6 bpm below.
    const hist = [3.0, 3.2, 3.4, 3.6].map((speed, i) =>
      runWith(
        `h${i}`,
        [1000 / speed, 1000 / speed, 1000 / speed],
        [100 + 15 * speed, 100 + 15 * speed, 100 + 15 * speed],
        { startTime: daysAgo(i + 1) },
      ),
    );
    const today = runWith(
      't',
      [1000 / 3.3, 1000 / 3.3, 1000 / 3.3],
      [143.5, 143.5, 143.5],
    );
    const curve = heartRatePaceCurve(today, hist)!;
    expect(curve.points).toHaveLength(3);
    expect(curve.line?.slope).toBeCloseTo(15, 3);
    expect(curve.line?.runs).toBe(4);
    expect(curve.residualBpm).toBeCloseTo(-6, 3);
    expect(curve.verdict).toBe('efficient');
    expect(heartRatePaceCurve(today, hist.slice(0, 1))!.line).toBeUndefined();
    expect(heartRatePaceCurve(runWith('n', [300, 300]), hist)).toBeUndefined();
  });
});

describe('Formatting', () => {
  it('writes seconds and percent with sign and decimal comma', () => {
    expect(formatSignedSeconds(-8)).toBe('−8 s');
    expect(formatSignedSeconds(65)).toBe('+1:05');
    expect(formatSignedSeconds(0)).toBe('±0 s');
    expect(formatSignedPercent(4.26, 1)).toBe('+4,3 %');
    expect(formatSignedPercent(-2)).toBe('−2 %');
  });

  it('keeps the sign and digits apart from the unit', () => {
    expect(formatSignedNumber(4.26, 1)).toBe('+4,3');
    expect(formatSignedNumber(-2.5, 1)).toBe('−2,5');
    expect(formatSignedNumber(0, 1)).toBe('±0,0');
  });

  it('writes percent and decimal point in English', () => {
    setLanguage('en');
    expect(formatSignedPercent(4.26, 1)).toBe('+4.3%');
    expect(formatSignedPercent(-2)).toBe('−2%');
    expect(formatSignedNumber(-2.5, 1)).toBe('−2.5');
  });
});

describe('Labels', () => {
  afterEach(() => setLanguage('de'));

  it('shows verdict keys as German text by default', () => {
    expect(evennessLabel('veryEven')).toBe('sehr gleichmäßig');
    expect(evennessLabel('uneven')).toBe('wechselhaft');
    expect(driftVerdictLabel('slightDrift')).toBe('leichte Drift');
    expect(heartRateZoneLabel(2)).toBe('locker');
  });

  it('shows verdict keys as English text', () => {
    setLanguage('en');
    expect(evennessLabel('veryEven')).toBe('very even');
    expect(evennessLabel('even')).toBe('even');
    expect(evennessLabel('uneven')).toBe('uneven');
    expect(driftVerdictLabel('solidAerobic')).toBe('aerobically solid');
    expect(driftVerdictLabel('clearDrift')).toBe('clear drift');
    expect(heartRateZoneLabel(1)).toBe('very easy');
    expect(heartRateZoneLabel(5)).toBe('maximum');
  });
});
