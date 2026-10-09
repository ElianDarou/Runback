import { parseMusicBpm, tapTempo } from './music';

describe('music input', () => {
  it('keeps missing and invalid tempos unknown', () => {
    for (const input of [
      '',
      '0',
      'NaN',
      'Infinity',
      '170abc',
      '251',
      '39',
      '-1',
    ])
      expect(parseMusicBpm(input)).toBeUndefined();
    expect(parseMusicBpm('170,5')).toBe(170.5);
    expect(parseMusicBpm('85', 80)).toBe(85);
    expect(parseMusicBpm('79', 80)).toBeUndefined();
  });
  it('estimates tempo from several taps and ignores a single irregular interval', () => {
    expect(tapTempo([0, 500, 1000, 1500])).toBe(120);
    expect(tapTempo([0, 500, 1100, 1600, 2100])).toBe(120);
  });
  it('does not invent a tempo from insufficient, reversed or interrupted taps', () => {
    expect(tapTempo([0, 500, 1000])).toBeUndefined();
    expect(tapTempo([0, 500, 1000, 4000])).toBeUndefined();
    expect(tapTempo([0, 500, 500, 1000])).toBeUndefined();
    expect(tapTempo([0, 500, NaN, 1000])).toBeUndefined();
  });
});
