import {
  mergeStrengthSessions,
  normalizeRun,
  normalizeStrength,
  strengthSessionFromBridge,
} from '../src/domain/bridgeRecords';
import { strengthSession } from './fixtures/strengthSessions';

describe('Datensätze für App und Website', () => {
  it('liest native Namen und erhält Herkunft sowie Modellversion', () => {
    const run = normalizeRun({
      id: 'r1',
      startedAt: 1000,
      endedAt: 5000,
      durationSec: 4,
      distanceM: 12,
      model_version: 'original-v1',
      feedback: { purpose: 'easy', sport: 'cycling', rpe: { legs: 3 } },
    });
    expect(run.startTime).toBe(1000);
    expect(run.distanceMeters).toBe(12);
    expect(run.avgHeartRate).toBeUndefined();
    expect(run.model_version).toBe('original-v1');
    expect(run.sport).toBe('cycling');
    expect(run.rpe?.legs).toBe(3);
  });
  it('liest leere Kraftdaten ohne Einheiten zu erfinden', () =>
    expect(normalizeStrength(null)).toEqual({
      templates: [],
      active: null,
      history: [],
    }));
  it('erhält eigene Einheiten und getrennte Endkorrekturen', () => {
    const session = strengthSession('s1', 1000000, [], { endTime: 1060000 });
    const corrected = strengthSessionFromBridge({
      ...session,
      endCorrection: { endTime: 1030000 },
    });
    expect(corrected.endTime).toBe(1030000);
    expect(session.endTime).toBe(1060000);
    expect(
      mergeStrengthSessions(
        [session, { ...session, id: 's2', startTime: 2000000 }],
        [],
        1,
      )[0].id,
    ).toBe('s2');
  });
});
