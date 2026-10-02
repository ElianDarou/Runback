/** Lokale Kalendertage; die exklusive Obergrenze folgt auch Sommerzeitwechseln. */
export function runExportRange(from: string, to: string) {
  const parse = (input: string) => {
    const match = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(input.trim());
    if (!match) throw new Error('Gib beide Daten als TT.MM.JJJJ ein.');
    const [, day, month, year] = match.map(Number);
    const date = new Date(year, month - 1, day);
    if (
      date.getFullYear() !== year ||
      date.getMonth() !== month - 1 ||
      date.getDate() !== day
    ) {
      throw new Error('Gib ein gültiges Datum ein.');
    }
    return date;
  };
  const start = parse(from);
  const end = parse(to);
  if (start > end) throw new Error('Wähle das Ende am oder nach dem Beginn.');
  end.setDate(end.getDate() + 1);
  return { from: start.getTime(), until: end.getTime() };
}
