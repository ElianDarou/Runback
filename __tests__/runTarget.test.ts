import {
  NO_RUN_TARGET,
  normalizeRunTarget,
  parsePaceInput,
  runTargetLabel,
  stepTargetPace,
  targetForPurpose,
} from '../src/domain/runTarget';

describe('Laufziel', () => {
  it('parses only explicit supported pace values', () => {
    expect(parsePaceInput('5:30')).toBe(330);
    expect(parsePaceInput('05:07')).toBe(307);
    expect(parsePaceInput('5:75')).toBeNull();
    expect(parsePaceInput('schnell')).toBeNull();
  });

  it('keeps invalid or old settings inactive', () => {
    expect(normalizeRunTarget({ kind: 'pace', secondsPerKm: 330 })).toEqual(
      NO_RUN_TARGET,
    );
    expect(
      normalizeRunTarget({
        kind: 'heart_rate',
        version: 1,
        minBpm: 170,
        maxBpm: 150,
        output: 'both',
      }),
    ).toEqual(NO_RUN_TARGET);
  });

  it('uses a pace ceiling for easy and long runs', () => {
    const pace = normalizeRunTarget({
      kind: 'pace',
      version: 1,
      secondsPerKm: 330,
      mode: 'range',
      output: 'both',
    });
    expect(targetForPurpose(pace, 'easy')).toMatchObject({ mode: 'ceiling' });
    expect(targetForPurpose(pace, 'intervals')).toMatchObject({
      mode: 'range',
    });
    expect(runTargetLabel(targetForPurpose(pace, 'easy'))).toBe(
      'Nicht schneller als 5:30 /km',
    );
  });

  it('steps the target pace in five seconds and stays in range', () => {
    expect(stepTargetPace(330, 1)).toBe(335);
    expect(stepTargetPace(330, -1)).toBe(325);
    // Ein krummes Zieltempo aus der Zielzeit rastet auf das Raster ein.
    expect(stepTargetPace(331.4, 1)).toBe(335);
    expect(stepTargetPace(331.4, -1)).toBe(330);
    expect(stepTargetPace(120, -1)).toBeNull();
    expect(stepTargetPace(1200, 1)).toBeNull();
    expect(stepTargetPace(Number.NaN, 1)).toBeNull();
  });
});
