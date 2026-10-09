import { tr } from '../domain/i18n';

/** Local calendar days; the exclusive upper bound also holds across daylight-saving changes. */
export function runExportRange(from: string, to: string) {
  const parse = (input: string) => {
    const match = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(input.trim());
    if (!match) {
      throw new Error(
        tr(
          'Gib beide Daten als TT.MM.JJJJ ein.',
          'Enter both dates as DD.MM.YYYY.',
        ),
      );
    }
    const [, day, month, year] = match.map(Number);
    const date = new Date(year, month - 1, day);
    if (
      date.getFullYear() !== year ||
      date.getMonth() !== month - 1 ||
      date.getDate() !== day
    ) {
      throw new Error(tr('Gib ein gültiges Datum ein.', 'Enter a valid date.'));
    }
    return date;
  };
  const start = parse(from);
  const end = parse(to);
  if (start > end) {
    throw new Error(
      tr(
        'Wähle das Ende am oder nach dem Beginn.',
        'Pick an end date on or after the start.',
      ),
    );
  }
  end.setDate(end.getDate() + 1);
  return { from: start.getTime(), until: end.getTime() };
}
