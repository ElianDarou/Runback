import {
  END_SUGGESTION_VERSION,
  applyStrengthEndCorrection,
  clampEnd,
  heartTrack,
  runEndSuggestion,
  runTracks,
  strengthEndSuggestion,
} from '../src/domain/endCorrection';
import {
  heartSourceLabel,
  isWatchHeart,
  sessionHeartInsight,
  type StrengthHeart,
} from '../src/domain/strengthHeart';
import { importedStrengthSession } from '../src/domain/strengthImports';
import type { RunSeries } from '../src/domain/runSeries';
import { MINUTE, strengthSession } from './fixtures/strengthSessions';

const START = Date.UTC(2026, 9, 1, 16);

describe('strength end correction', () => {
  it('replaces the end and keeps the original next to it', () => {
    const session = strengthSession(
      's',
      START,
      [['bench', 'Bankdrücken', [{ weightKg: 60, reps: 8, at: 10 }]]],
      { endTime: START + 8 * 60 * MINUTE },
    );
    const corrected = applyStrengthEndCorrection(session, {
      endTime: START + 70 * MINUTE,
      setAt: 5,
      by: 'user',
    });
    expect(corrected.endTime).toBe(START + 70 * MINUTE);
    expect(corrected.endCorrection).toEqual({
      endTime: START + 70 * MINUTE,
      originalEndTime: START + 8 * 60 * MINUTE,
      setAt: 5,
    });
    // Invalid corrections change nothing.
    expect(applyStrengthEndCorrection(session, { endTime: START - 1 })).toBe(
      session,
    );
    expect(applyStrengthEndCorrection(session, null)).toBe(session);
  });

  it('suggests the last ticked set, only when it is clearly earlier', () => {
    const session = strengthSession('s', START, [
      [
        'bench',
        'Bankdrücken',
        [
          { weightKg: 60, reps: 8, at: 10 },
          { weightKg: 60, reps: 8, at: 52 },
          { weightKg: 60, reps: 8, at: 90, skipped: true },
        ],
      ],
    ]);
    expect(strengthEndSuggestion(session, START + 8 * 60 * MINUTE)).toEqual({
      time: START + 52 * MINUTE,
      reason: 'last_set',
      version: END_SUGGESTION_VERSION,
    });
    expect(strengthEndSuggestion(session, START + 53 * MINUTE)).toBeUndefined();
    const imported = strengthSession('i', START, [
      ['bench', 'Bankdrücken', [{ weightKg: 60, reps: 8 }]],
    ]);
    expect(strengthEndSuggestion(imported, undefined)).toBeUndefined();
  });

  it('applies a stored correction to an imported Strong workout', () => {
    const session = importedStrengthSession({
      id: 'strong:x',
      time: START,
      name: 'Pull',
      source: 'strong',
      durationSeconds: null,
      reportedDurationSeconds: 15305,
      durationRejected: {
        reason: 'not_finished',
        modelVersion: 'strong-duration-v1',
        decidedBy: 'default',
      },
      endCorrection: { endTime: START + 75 * MINUTE, by: 'user' },
      workoutNotes: '',
      sets: [],
    });
    expect(session.endTime).toBe(START + 75 * MINUTE);
    expect(session.endCorrection?.originalEndTime).toBeUndefined();
    expect(session.importSource?.rejectedDurationSeconds).toBe(15305);
  });

  it('drops sets ticked after the corrected end but remembers when they were', () => {
    const session = strengthSession('s', START, [
      [
        'bench',
        'Bankdrücken',
        [
          { weightKg: 60, reps: 8, at: 10 },
          { weightKg: 60, reps: 8, at: 50 },
        ],
      ],
      ['row', 'Rudern', [{ weightKg: 40, reps: 8, at: 55 }]],
    ]);
    const corrected = applyStrengthEndCorrection(session, {
      endTime: START + 20 * MINUTE,
    });
    expect(corrected.exercises).toHaveLength(1);
    expect(corrected.exercises[0].sets).toHaveLength(1);
    expect(corrected.endCorrection?.excludedSetTimes).toEqual([
      START + 50 * MINUTE,
      START + 55 * MINUTE,
    ]);
    // The suggestion also knows the hidden sets and helps you go back.
    expect(strengthEndSuggestion(corrected, START + 120 * MINUTE)?.time).toBe(
      START + 55 * MINUTE,
    );
    expect(session.exercises).toHaveLength(2);
  });

  it('never rounds past the range end and accepts recordings shorter than a minute', () => {
    expect(clampEnd(START + 3_600_599, START, START + 3_600_599)).toBe(
      START + 3_600_599,
    );
    expect(clampEnd(START, START, START + 30_000)).toBe(START + 30_000);
  });

  it('keeps a chosen end between one minute after start and the range end', () => {
    expect(clampEnd(START + 10_000, START, START + 3_600_000)).toBe(
      START + 60_000,
    );
    expect(clampEnd(START + 9_000_000, START, START + 3_600_000)).toBe(
      START + 3_600_000,
    );
    expect(clampEnd(START + 600_400, START, START + 3_600_000)).toBe(
      START + 600_000,
    );
  });
});

describe('run end suggestion', () => {
  const series: RunSeries = {
    stepSeconds: 30,
    rows: [
      {
        elapsedSeconds: 0,
        distanceMeters: 0,
        moving: true,
        speedMps: 3,
        heartRate: 140,
      },
      {
        elapsedSeconds: 30,
        distanceMeters: 90,
        moving: true,
        speedMps: 3.2,
        heartRate: 150,
      },
      {
        elapsedSeconds: 60,
        distanceMeters: 180,
        moving: false,
        heartRate: 120,
      },
      { elapsedSeconds: 90, distanceMeters: 180, moving: false },
    ],
  };
  it('proposes the end of the last movement when the run went on idle', () => {
    expect(runEndSuggestion(START, series, START + 600_000)).toEqual({
      time: START + 60_000,
      reason: 'last_movement',
      version: END_SUGGESTION_VERSION,
    });
    // Hardly any idle time: no suggestion.
    expect(runEndSuggestion(START, series, START + 120_000)).toBeUndefined();
    expect(runEndSuggestion(START, null, START + 600_000)).toBeUndefined();
  });

  it('draws speed only while moving and keeps gaps as gaps', () => {
    const tracks = runTracks(START, series);
    expect(tracks.speed.map(point => point.value)).toEqual([
      10.8,
      11.5,
      null,
      null,
    ]);
    expect(tracks.heart.map(point => point.value)).toEqual([
      140,
      150,
      120,
      null,
    ]);
    expect(tracks.speed[0].t).toBe(START + 15_000);
  });
});

describe('imported heart', () => {
  const heart: StrengthHeart = {
    model_version: 'strength-heart-v1',
    source: 'import:fitbit',
    startTime: START,
    stepSeconds: 60,
    averageBpm: 120,
    maxBpm: 150,
    minBpm: 90,
    coverage: 1,
    samples: 3,
    clockAligned: true,
    values: [90, 150, null],
  };
  it('names the source and draws minute points', () => {
    expect(isWatchHeart(heart)).toBe(false);
    expect(heartSourceLabel(heart)).toBe('Fitbit / Google Health');
    expect(heartSourceLabel({ ...heart, source: 'import:google_fit' })).toBe(
      'Google Fit',
    );
    expect(heartSourceLabel({ ...heart, source: 'watch' })).toBe('Uhr');
    expect(heartTrack(heart)).toEqual([
      { t: START + 30_000, value: 90 },
      { t: START + 90_000, value: 150 },
      { t: START + 150_000, value: null },
    ]);
  });

  it('derives no set peaks or recovery from minute averages', () => {
    const session = strengthSession('s', START, [
      [
        'bench',
        'Bankdrücken',
        [
          { weightKg: 60, reps: 8, at: 1 },
          { weightKg: 60, reps: 8, at: 2 },
          { weightKg: 60, reps: 8, at: 3 },
        ],
      ],
    ]);
    const imported = sessionHeartInsight(session, heart);
    expect(imported.medianPeakBpm).toBeUndefined();
    expect(imported.recoverySets).toBe(0);
    const watch = sessionHeartInsight(session, {
      ...heart,
      source: 'watch',
      values: [90, 150, 140, 130, 120],
    });
    expect(watch.medianPeakBpm).toBeDefined();
  });
});
