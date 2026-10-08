import {
  buildReport,
  fromStructured,
  normalizeText,
  parseSoreness,
} from '../src/domain/sorenessInput';

describe('Soreness input', () => {
  it('normalizes German umlauts deterministically', () => {
    expect(normalizeText('Äußere Schulter, Übung!')).toBe(
      'aussere schulter ubung',
    );
  });

  it('recognizes side, region and intensity together', () => {
    const result = parseSoreness('links starke Wade');
    expect(result.questions).toEqual([]);
    expect(result.proposals).toEqual([
      { regionId: 'calf_gastroc_l', value: 8 },
    ]);
  });

  it('spreads both sides across two concrete regions', () => {
    const result = parseSoreness('beide Waden 5');
    expect(result.proposals).toEqual([
      { regionId: 'calf_gastroc_l', value: 5 },
      { regionId: 'calf_gastroc_r', value: 5 },
    ]);
  });

  it('asks when the side is missing and the region is ambiguous', () => {
    expect(parseSoreness('Wade').questions[0]).toMatchObject({
      kind: 'side',
      candidates: ['calf_gastroc_l', 'calf_gastroc_r'],
    });
    expect(parseSoreness('Rücken 5').questions[0]).toMatchObject({
      kind: 'region',
      candidates: expect.arrayContaining(['lat_l', 'lower_back_l']),
      value: 5,
    });
  });

  it('treats “nothing today” as a confirmed answer', () => {
    expect(parseSoreness('Heute nichts')).toMatchObject({
      nothingToday: true,
      proposals: [],
      questions: [],
    });
  });

  it('reads full English utterances without asking about filler words', () => {
    expect(parseSoreness('left calf three today')).toMatchObject({
      proposals: [{ regionId: 'calf_gastroc_l', value: 3 }],
      questions: [],
    });
    expect(parseSoreness('my right quad is about five')).toMatchObject({
      proposals: [{ regionId: 'quad_r', value: 5 }],
      questions: [],
    });
    expect(parseSoreness('I think my left calf is a little strong')).toMatchObject({
      proposals: [{ regionId: 'calf_gastroc_l', value: 8 }],
      questions: [],
    });
  });

  it('treats English “nothing today” as a confirmed answer', () => {
    expect(parseSoreness('nothing today')).toMatchObject({
      nothingToday: true,
      proposals: [],
      questions: [],
    });
  });

  it('records the lexicon version it was evaluated with', () => {
    expect(parseSoreness('left calf three').lexiconVersion).toBe(
      'soreness-lexicon-v2',
    );
  });

  it('discards unknown structured regions instead of inventing them', () => {
    const result = fromStructured([
      { region: 'quad_l', value: 4 },
      { region: 'mysteriöser Muskel', value: 9 },
    ]);
    expect(result.proposals).toEqual([{ regionId: 'quad_l', value: 4 }]);
    expect(result.questions[0].kind).toBe('unknown');
  });

  it('filters invalid regions when saving and limits values', () => {
    const report = buildReport(
      { quad_l: 12, calf_gastroc_r: 4, unknown: 10 } as never,
      1_700_000_000_000,
      'tap',
    );
    expect(report.entries).toEqual([
      { regionId: 'quad_l', value: 10 },
      { regionId: 'calf_gastroc_r', value: 4 },
    ]);
    expect(report.nothingToday).toBe(false);
  });
});

describe('Soreness capture parsing', () => {
  it('keeps an explicit left-and-right report on both concrete regions', () => {
    expect(parseSoreness('Bizeps links und rechts 5').proposals).toEqual([
      { regionId: 'biceps_l', value: 5 },
      { regionId: 'biceps_r', value: 5 },
    ]);
  });

  it('combines side words that occur before the region', () => {
    expect(parseSoreness('links und rechts Bizeps 5').proposals).toEqual([
      { regionId: 'biceps_l', value: 5 },
      { regionId: 'biceps_r', value: 5 },
    ]);
  });

  it('keeps consecutive regions with different sides separate', () => {
    expect(parseSoreness('Bizeps links 3 rechts Wade 5').proposals).toEqual([
      { regionId: 'biceps_l', value: 3 },
      { regionId: 'calf_gastroc_r', value: 5 },
    ]);
    expect(parseSoreness('Bizeps links 3 rechts Bizeps 5').proposals).toEqual([
      { regionId: 'biceps_l', value: 3 },
      { regionId: 'biceps_r', value: 5 },
    ]);
  });

  it('does not accept an unknown structured region', () => {
    const result = fromStructured([
      { region: 'mysterious muscle', side: 'l', value: 4 },
    ]);
    expect(result.proposals).toEqual([]);
    expect(result.questions[0]).toMatchObject({
      kind: 'unknown',
      candidates: [],
    });
  });

  it('does not treat an empty structured value as zero', () => {
    const result = fromStructured([{ region: 'biceps_l', value: ' ' }]);
    expect(result.proposals).toEqual([]);
    expect(result.questions[0]).toMatchObject({ kind: 'intensity' });
  });

  it('writes reports in canonical region order regardless of object insertion order', () => {
    const report = buildReport(
      { quad_r: 4, biceps_l: 2, quad_l: 3 },
      123,
      'tap',
    );
    expect(report.entries).toEqual([
      { regionId: 'biceps_l', value: 2 },
      { regionId: 'quad_l', value: 3 },
      { regionId: 'quad_r', value: 4 },
    ]);
  });

  it('does not persist non-finite report values', () => {
    expect(
      buildReport({ biceps_l: Number.NaN, quad_l: Infinity }, 123, 'tap')
        .entries,
    ).toEqual([]);
  });
});
