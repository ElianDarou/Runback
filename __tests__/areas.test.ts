import { AREAS, areaLabel } from '../src/domain/areas';
import { setLanguage } from '../src/domain/i18n';

describe('Two areas', () => {
  afterEach(() => setLanguage('de'));

  it('names running and strength training in the active language', () => {
    expect(AREAS).toEqual(['running', 'strength']);
    expect(AREAS.map(areaLabel)).toEqual(['Laufen', 'Krafttraining']);
    setLanguage('en');
    expect(AREAS.map(areaLabel)).toEqual(['Running', 'Strength training']);
  });
});
