import { exportRange } from '../src/ui/exportRange';
import {
  monthWeeks,
  pickRangeDay,
  rangePosition,
  shiftMonth,
} from '../src/ui/calendar';

test('includes both local calendar days', () => {
  expect(exportRange('2026-10-01', '2026-10-02')).toEqual({
    from: new Date(2026, 9, 1).getTime(),
    until: new Date(2026, 9, 3).getTime(),
  });
  const range = exportRange('2026-12-31', '2026-12-31');
  expect(range.until).toBe(new Date(2027, 0, 1).getTime());
});

test.each([
  '2026-02-31',
  '2025-02-29',
  '2026-10-00',
  '2026-13-01',
  '01.10.2026',
  '',
])('rejects invalid day %s', input => {
  expect(() => exportRange(input, '2026-10-02')).toThrow();
});

test('checks order and leap years', () => {
  expect(() => exportRange('2026-10-03', '2026-10-02')).toThrow('Ende');
  expect(exportRange('2024-02-29', '2024-02-29').until).toBe(
    new Date(2024, 2, 1).getTime(),
  );
});

test('first tap starts, second tap ends the range in either order', () => {
  const start = pickRangeDay(null, '2026-10-05');
  expect(start).toEqual({ start: '2026-10-05' });
  expect(pickRangeDay(start, '2026-10-12')).toEqual({
    start: '2026-10-05',
    end: '2026-10-12',
  });
  expect(pickRangeDay(start, '2026-09-28')).toEqual({
    start: '2026-09-28',
    end: '2026-10-05',
  });
  expect(pickRangeDay(start, '2026-10-05')).toEqual({
    start: '2026-10-05',
    end: '2026-10-05',
  });
  expect(
    pickRangeDay({ start: '2026-10-05', end: '2026-10-12' }, '2026-11-01'),
  ).toEqual({ start: '2026-11-01' });
});

test('marks start, end and the days between', () => {
  const range = { start: '2026-10-05', end: '2026-10-07' };
  expect(rangePosition(range, '2026-10-05')).toBe('start');
  expect(rangePosition(range, '2026-10-06')).toBe('inside');
  expect(rangePosition(range, '2026-10-07')).toBe('end');
  expect(rangePosition(range, '2026-10-08')).toBeUndefined();
  expect(rangePosition({ start: '2026-10-05' }, '2026-10-05')).toBe('single');
  expect(rangePosition({ start: '2026-10-05' }, '2026-10-06')).toBeUndefined();
  expect(rangePosition(null, '2026-10-05')).toBeUndefined();
});

test('month grid starts on Monday and crosses the year', () => {
  const weeks = monthWeeks('2026-10-01');
  expect(weeks[0][0]).toBe('2026-09-28');
  expect(weeks.every(week => week.length === 7)).toBe(true);
  expect(weeks.flat()).toContain('2026-10-31');
  expect(shiftMonth('2026-12-01', 1)).toBe('2027-01-01');
  expect(shiftMonth('2026-01-01', -1)).toBe('2025-12-01');
});
