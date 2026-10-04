/**
 * Datumsfelder zeigen und nehmen das deutsche Format (TT.MM.JJJJ);
 * gespeichert wird weiter der Kalendertag als JJJJ-MM-TT.
 */

const pad = (value: number) => String(value).padStart(2, '0');

/** „2026-11-08“ → „08.11.2026“. Leer bleibt leer, Unlesbares bleibt stehen. */
export function dateToInput(iso: string | undefined | null): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec((iso ?? '').trim());
  return match ? `${match[3]}.${match[2]}.${match[1]}` : (iso ?? '').trim();
}

/**
 * „8.11.2026“ oder „08.11.2026“ → „2026-11-08“. Leer ergibt „“, ein
 * ungültiger Tag `null` — es wird nichts geraten.
 */
export function inputToDate(input: string): string | null {
  const text = input.trim();
  if (!text) return '';
  const german = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(text);
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  const [year, month, day] = german
    ? [Number(german[3]), Number(german[2]), Number(german[1])]
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
