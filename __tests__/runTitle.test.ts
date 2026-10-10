import {
  RUN_PURPOSES,
  comparablePurpose,
  dayPartTitle,
  hasNamedPurpose,
  isMeaningfulRunName,
  normalizePurpose,
  purposeLabel,
  runTitle,
  samePurpose,
  selectablePurpose,
} from '../src/domain/runTitle';

const at = (hour: number) => new Date(2024, 4, 1, hour, 30).getTime();

describe('isMeaningfulRunName', () => {
  it('accepts names a person could have written', () => {
    expect(isMeaningfulRunName('Morning Run')).toBe(true);
    expect(isMeaningfulRunName('Feierabendrunde')).toBe(true);
    expect(isMeaningfulRunName('Intervalle Bahn')).toBe(true);
  });

  it('rejects file names, identifiers and time stamps', () => {
    expect(isMeaningfulRunName('activity_12345678')).toBe(false);
    expect(isMeaningfulRunName('2024-05-01T07-00-00')).toBe(false);
    expect(isMeaningfulRunName('3f2504e0-4f89-11d3-9a0c-0305e82c3301')).toBe(
      false,
    );
    expect(isMeaningfulRunName('9982371')).toBe(false);
    expect(isMeaningfulRunName('')).toBe(false);
    expect(isMeaningfulRunName(undefined)).toBe(false);
  });

  it('rejects the placeholder names the importers write', () => {
    expect(isMeaningfulRunName('Garmin Lauf')).toBe(false);
    expect(isMeaningfulRunName('Importierter Lauf')).toBe(false);
    expect(isMeaningfulRunName('Lauf am Nachmittag')).toBe(false);
    expect(isMeaningfulRunName('Afternoon Run')).toBe(false);
    expect(isMeaningfulRunName('activity')).toBe(false);
  });

  it('rejects the placeholders from imports made in English', () => {
    expect(isMeaningfulRunName('Garmin run')).toBe(false);
    expect(isMeaningfulRunName('Garmin Lauf')).toBe(false);
    expect(isMeaningfulRunName('Apple Health run')).toBe(false);
    expect(isMeaningfulRunName('Google Fit run')).toBe(false);
    expect(isMeaningfulRunName('Mi Fitness activity')).toBe(false);
    expect(isMeaningfulRunName('Samsung Health run')).toBe(false);
  });
});

describe('dayPartTitle', () => {
  it('names the part of the day the run started in', () => {
    expect(dayPartTitle(at(6))).toBe('Morgenlauf');
    expect(dayPartTitle(at(11))).toBe('Vormittagslauf');
    expect(dayPartTitle(at(12))).toBe('Mittagslauf');
    expect(dayPartTitle(at(15))).toBe('Nachmittagslauf');
    expect(dayPartTitle(at(19))).toBe('Abendlauf');
    expect(dayPartTitle(at(23))).toBe('Nachtlauf');
    expect(dayPartTitle(at(2))).toBe('Nachtlauf');
  });

  it('falls back without a usable start time', () => {
    expect(dayPartTitle(0)).toBe('Lauf');
  });
});

describe('runTitle', () => {
  it('prefers a meaningful name from the source', () => {
    expect(
      runTitle({ name: 'Morning Run', startTime: at(19), purpose: 'easy' }),
    ).toBe('Morning Run');
  });

  it('falls back to the purpose when the name is technical', () => {
    expect(
      runTitle({
        name: 'activity_12345678',
        startTime: at(19),
        purpose: 'intervals',
      }),
    ).toBe(purposeLabel('intervals'));
  });

  it('falls back to the part of the day without a usable purpose', () => {
    expect(
      runTitle({ name: 'Garmin Lauf', startTime: at(7), purpose: 'unknown' }),
    ).toBe('Morgenlauf');
    expect(runTitle({ startTime: at(19), purpose: 'free' })).toBe('Abendlauf');
  });
});

describe('Run types', () => {
  it('offers the three types the comparisons need', () => {
    expect(RUN_PURPOSES.map(option => option.label)).toEqual([
      'Locker',
      'Schnell',
      'Intervalle',
    ]);
    expect(selectablePurpose('unknown')).toBe('unknown');
    expect(selectablePurpose(undefined)).toBe('unknown');
    expect(selectablePurpose('race')).toBe('race');
    expect(purposeLabel('unknown')).toBe('Noch offen');
  });

  it('maps old run types for comparisons without rewriting them', () => {
    expect(comparablePurpose('long')).toBe('easy');
    expect(comparablePurpose('free')).toBe('unknown');
    expect(comparablePurpose('intervals')).toBe('intervals');
    expect(samePurpose('long', 'easy')).toBe(true);
    expect(samePurpose('free', 'unknown')).toBe(true);
    expect(samePurpose('race', 'easy')).toBe(false);
    expect(selectablePurpose('long')).toBe('easy');
    expect(purposeLabel('long')).toBe('Locker');
    expect(hasNamedPurpose('free')).toBe(false);
    expect(hasNamedPurpose('long')).toBe(true);
  });

  it('reads the old watch values as intervals', () => {
    expect(normalizePurpose('quality')).toBe('intervals');
    expect(normalizePurpose('interval')).toBe('intervals');
    expect(normalizePurpose('easy')).toBe('easy');
    expect(normalizePurpose('bogus')).toBe('unknown');
    expect(normalizePurpose(undefined)).toBe('unknown');
  });

  it('turns run types into titles that serve as names', () => {
    expect(runTitle({ startTime: at(7), purpose: 'easy' })).toBe(
      'Lockere Runde',
    );
    expect(runTitle({ startTime: at(7), purpose: 'race' })).toBe(
      'Schneller Lauf',
    );
    expect(runTitle({ startTime: at(7), purpose: 'intervals' })).toBe(
      'Intervalle',
    );
    // An old long run keeps the name it had.
    expect(runTitle({ startTime: at(7), purpose: 'long' })).toBe('Lange Runde');
  });
});
