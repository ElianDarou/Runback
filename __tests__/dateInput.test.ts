import { dateToInput, inputToDate } from '../src/ui/dateInput';

describe('Datumsfelder im deutschen Format', () => {
  it('zeigt gespeicherte Kalendertage als TT.MM.JJJJ', () => {
    expect(dateToInput('2026-11-08')).toBe('08.11.2026');
    expect(dateToInput('')).toBe('');
    expect(dateToInput(undefined)).toBe('');
  });

  it('liest deutsche und bisherige Eingaben, rät aber nichts', () => {
    expect(inputToDate('8.11.2026')).toBe('2026-11-08');
    expect(inputToDate(' 08.11.2026 ')).toBe('2026-11-08');
    expect(inputToDate('2026-11-08')).toBe('2026-11-08');
    expect(inputToDate('')).toBe('');
    expect(inputToDate('31.02.2026')).toBeNull();
    expect(inputToDate('November')).toBeNull();
  });
});
