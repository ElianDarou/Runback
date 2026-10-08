import { dateToInput, inputToDate } from '../src/ui/dateInput';

describe('Date fields in German format', () => {
  it('shows saved calendar days as DD.MM.YYYY', () => {
    expect(dateToInput('2026-11-08')).toBe('08.11.2026');
    expect(dateToInput('')).toBe('');
    expect(dateToInput(undefined)).toBe('');
  });

  it('reads German and earlier inputs but guesses nothing', () => {
    expect(inputToDate('8.11.2026')).toBe('2026-11-08');
    expect(inputToDate(' 08.11.2026 ')).toBe('2026-11-08');
    expect(inputToDate('2026-11-08')).toBe('2026-11-08');
    expect(inputToDate('')).toBe('');
    expect(inputToDate('31.02.2026')).toBeNull();
    expect(inputToDate('November')).toBeNull();
  });
});
