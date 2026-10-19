import { tr } from '../domain/i18n';
import { dateOf } from './calendar';

/**
 * A chosen period of local calendar days (`YYYY-MM-DD`, both included) as
 * milliseconds `[from, until)`; the exclusive upper bound also holds across
 * daylight-saving changes.
 */
export function exportRange(start: string, end: string) {
  const parse = (key: string) => {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
    const date = match ? dateOf(key) : new Date(NaN);
    if (
      !match ||
      date.getFullYear() !== Number(match[1]) ||
      date.getMonth() !== Number(match[2]) - 1 ||
      date.getDate() !== Number(match[3])
    ) {
      throw new Error(tr('Wähle einen Zeitraum.', 'Choose a period.'));
    }
    return date;
  };
  const from = parse(start);
  const until = parse(end);
  if (from > until) {
    throw new Error(
      tr(
        'Wähle das Ende am oder nach dem Beginn.',
        'Pick an end date on or after the start.',
      ),
    );
  }
  until.setDate(until.getDate() + 1);
  return { from: from.getTime(), until: until.getTime() };
}
