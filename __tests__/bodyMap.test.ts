import {
  displayValue,
  regionSpeech,
  regionsInView,
} from '../src/ui/BodyMap';

describe('Body map', () => {
  it('keeps unknown separate from zero and numeric values', () => {
    expect(displayValue(null)).toBe('–');
    expect(displayValue(undefined)).toBe('–');
    expect(displayValue(62.4)).toBe('62');
    expect(regionSpeech('freshness', 'quad_l', null)).toContain('unbekannt');
    expect(regionSpeech('freshness', 'quad_l', 62)).toContain('62 von 100');
  });

  it('returns only the matching regions for front and back views', () => {
    expect(regionsInView('front')).toContain('quad_l');
    expect(regionsInView('front')).not.toContain('hamstring_l');
    expect(regionsInView('back')).toContain('hamstring_l');
    expect(regionsInView('back')).not.toContain('quad_l');
  });
});
