import { runExportRange } from '../src/ui/runExportRange';

test('schließt beide lokalen Kalendertage ein', () => {
  expect(runExportRange('01.10.2026', '02.10.2026')).toEqual({
    from: new Date(2026, 9, 1).getTime(),
    until: new Date(2026, 9, 3).getTime(),
  });
  const range = runExportRange('31.12.2026', '31.12.2026');
  expect(range.until).toBe(new Date(2027, 0, 1).getTime());
});

test.each([
  '31.02.2026',
  '29.02.2025',
  '00.10.2026',
  '01.13.2026',
  '2026-10-01',
  '',
])('weist ungültiges Datum %s ab', input => {
  expect(() => runExportRange(input, '02.10.2026')).toThrow();
});

test('prüft Reihenfolge und Schaltjahre', () => {
  expect(() => runExportRange('03.10.2026', '02.10.2026')).toThrow('Ende');
  expect(runExportRange('29.02.2024', '29.02.2024').until).toBe(
    new Date(2024, 2, 1).getTime(),
  );
});
