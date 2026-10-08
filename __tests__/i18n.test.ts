import {
  dateFormat,
  fixed,
  getLanguage,
  isLanguage,
  locale,
  numberFormat,
  parseDecimal,
  percentSign,
  quote,
  setLanguage,
  tr,
} from '../src/domain/i18n';

// Monday, 9 March 2026, local time.
const MONDAY = new Date(2026, 2, 9, 12, 0, 0);

describe('app language', () => {
  it('starts in German and switches the text with the language', () => {
    expect(getLanguage()).toBe('de');
    expect(tr('Heute', 'Today')).toBe('Heute');
    setLanguage('en');
    expect(getLanguage()).toBe('en');
    expect(tr('Heute', 'Today')).toBe('Today');
    setLanguage('de');
    expect(tr('Heute', 'Today')).toBe('Heute');
  });

  it('accepts only the two supported language codes', () => {
    expect(isLanguage('de')).toBe(true);
    expect(isLanguage('en')).toBe(true);
    expect(isLanguage('fr')).toBe(false);
    expect(isLanguage(undefined)).toBe(false);
  });

  it('maps each language to its locale and keeps 24-hour dates in English', () => {
    expect(locale('de')).toBe('de-DE');
    expect(locale('en')).toBe('en-GB');
    setLanguage('en');
    expect(locale()).toBe('en-GB');
    setLanguage('de');
    expect(locale()).toBe('de-DE');
  });
});

describe('number and text helpers', () => {
  it('writes decimals with a comma in German and a point in English', () => {
    expect(fixed(1.25)).toBe('1,3');
    expect(fixed(2, 0)).toBe('2');
    setLanguage('en');
    expect(fixed(1.25)).toBe('1.3');
    expect(fixed(7.5, 2)).toBe('7.50');
    setLanguage('de');
  });

  it('reads a typed decimal with either separator', () => {
    expect(parseDecimal('1,5')).toBe(1.5);
    expect(parseDecimal('1.5')).toBe(1.5);
    expect(parseDecimal(' 2,25 ')).toBe(2.25);
    expect(Number.isNaN(parseDecimal('abc'))).toBe(true);
  });

  it('quotes with the typographic marks of the active language', () => {
    expect(quote('Heute')).toBe('„Heute“');
    setLanguage('en');
    expect(quote('Today')).toBe('“Today”');
    setLanguage('de');
  });

  it('spaces the percent sign in German and closes it up in English', () => {
    expect(percentSign()).toBe(' %');
    expect(`${3}${percentSign()}`).toBe('3 %');
    setLanguage('en');
    expect(percentSign()).toBe('%');
    expect(`+${3}${percentSign()}`).toBe('+3%');
    setLanguage('de');
  });

  it('formats numbers with the separators of the active language', () => {
    expect(numberFormat().format(1234.5)).toBe('1.234,5');
    setLanguage('en');
    expect(numberFormat().format(1234.5)).toBe('1,234.5');
    setLanguage('de');
  });
});

describe('cached formats follow the language', () => {
  it('returns the German weekday name and locale by default', () => {
    const format = dateFormat({ weekday: 'long' });
    expect(format.resolvedOptions().locale).toBe('de-DE');
    expect(format.format(MONDAY)).toBe('Montag');
  });

  it('switches to English without reusing the German format', () => {
    const german = dateFormat({ weekday: 'long' });
    setLanguage('en');
    const english = dateFormat({ weekday: 'long' });
    expect(english).not.toBe(german);
    expect(english.resolvedOptions().locale).toBe('en-GB');
    expect(english.format(MONDAY)).toBe('Monday');
    setLanguage('de');
    expect(dateFormat({ weekday: 'long' })).toBe(german);
  });

  it('caches one format per language and option set', () => {
    setLanguage('en');
    const first = numberFormat({ maximumFractionDigits: 1 });
    expect(numberFormat({ maximumFractionDigits: 1 })).toBe(first);
    setLanguage('de');
    expect(numberFormat({ maximumFractionDigits: 1 })).not.toBe(first);
  });
});
