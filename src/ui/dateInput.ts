/**
 * Date fields show and accept DD.MM.YYYY in both languages.
 * The calendar day is still stored as YYYY-MM-DD.
 */

const pad = (value: number) => String(value).padStart(2, '0');

/** "2026-11-08" → "08.11.2026". Empty stays empty; unreadable input is kept as is. */
export function dateToInput(iso: string | undefined | null): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec((iso ?? '').trim());
  return match ? `${match[3]}.${match[2]}.${match[1]}` : (iso ?? '').trim();
}

/**
 * "8.11.2026" or "08.11.2026" → "2026-11-08". Empty gives "", an invalid day
 * gives `null` — nothing is guessed.
 */
export function inputToDate(input: string): string | null {
  const text = input.trim();
  if (!text) return '';
  const dotted = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(text);
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  const [year, month, day] = dotted
    ? [Number(dotted[3]), Number(dotted[2]), Number(dotted[1])]
    : iso
    ? [Number(iso[1]), Number(iso[2]), Number(iso[3])]
    : [NaN, NaN, NaN];
  const date = new Date(year, month - 1, day);
  if (
    !Number.isFinite(year) ||
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return null;
  }
  return `${year}-${pad(month)}-${pad(day)}`;
}
