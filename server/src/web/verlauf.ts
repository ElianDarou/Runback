import type { Run } from '../../../src/domain/trainingRecords';
import { runTitle } from '../../../src/domain/runTitle';
import { isRun } from '../../../src/domain/sport';
import { mondayStart } from '../../../src/domain/statistics';
import type { StrengthSession } from '../../../src/domain/strength';
import type { PageContext } from './context';
import { oneOf, param, syncStatus } from './context';
import { completedSets, counted, date, day, km, tempo } from './format';
import { html, query, type Html } from './html';
import { emptyState, page, row, segmented, title } from './ui';

/**
 * Verlauf: Was habe ich gemacht? Alle Einheiten nach Wochen, wie in der App.
 * Der Wochenkopf trägt die Summe, damit man den Umfang sieht, ohne in die
 * Statistik zu wechseln.
 */

type Unit =
  | { kind: 'run'; at: number; run: Run }
  | { kind: 'strength'; at: number; session: StrengthSession };

type Filter = 'alle' | 'laufen' | 'rad' | 'kraft';
const FILTERS: Filter[] = ['alle', 'laufen', 'rad', 'kraft'];
const PAGE_WEEKS = 26;

const matches = (unit: Unit, filter: Filter) =>
  filter === 'alle'
    ? true
    : filter === 'kraft'
    ? unit.kind === 'strength'
    : unit.kind === 'run' &&
      (filter === 'laufen' ? isRun(unit.run) : !isRun(unit.run));

function weekLabel(start: number, now: number): string {
  const thisWeek = mondayStart(now);
  if (start === thisWeek) return 'Diese Woche';
  if (start === mondayStart(thisWeek - 86_400_000)) return 'Letzte Woche';
  return `${date(start).slice(0, 6)} – ${date(start + 6 * 86_400_000).slice(
    0,
    6,
  )}`;
}

function weekSummary(units: Unit[]): string {
  const runs = units.filter(
    (unit): unit is Extract<Unit, { kind: 'run' }> => unit.kind === 'run',
  );
  const sessions = units.length - runs.length;
  const meters = runs.reduce(
    (sum, unit) => sum + (unit.run.distanceMeters || 0),
    0,
  );
  return [
    runs.length
      ? `${counted(runs.length, 'Einheit', 'Einheiten')} · ${km(meters, 1)} km`
      : null,
    sessions ? counted(sessions, 'Krafttraining', 'Krafttrainings') : null,
  ]
    .filter(Boolean)
    .join(' · ');
}

function unitRow(unit: Unit, ctx: PageContext): Html {
  if (unit.kind === 'run') {
    const { value, unit: tempoUnit } = tempo(unit.run);
    return row({
      title: runTitle(unit.run),
      subtitle: `${day(unit.at)} · ${km(
        unit.run.distanceMeters,
      )} km · ${value} ${tempoUnit}`,
      href: `/lauf/${encodeURIComponent(unit.run.id)}`,
    });
  }
  const heart = ctx.data.heart[unit.session.id];
  const sets = completedSets(unit.session);
  return row({
    title: unit.session.name || 'Krafttraining',
    subtitle: [
      day(unit.at),
      counted(sets, 'Satz', 'Sätze'),
      heart ? `Ø ${Math.round(heart.averageBpm)} bpm` : null,
    ]
      .filter(Boolean)
      .join(' · '),
    href: `/kraft/${encodeURIComponent(unit.session.id)}`,
  });
}

export function verlaufPage(ctx: PageContext): Html {
  const { data, now, url } = ctx;
  const units: Unit[] = [
    ...data.runs.map(run => ({ kind: 'run' as const, at: run.startTime, run })),
    ...data.strength
      .filter(session => session.status === 'finished')
      .map(session => ({
        kind: 'strength' as const,
        at: session.startTime,
        session,
      })),
  ].sort((a, b) => b.at - a.at);

  const available: { value: Filter; label: string }[] = [
    { value: 'alle', label: 'Alle' },
    ...(units.some(u => u.kind === 'run' && isRun(u.run))
      ? [{ value: 'laufen' as const, label: 'Laufen' }]
      : []),
    ...(units.some(u => u.kind === 'run' && !isRun(u.run))
      ? [{ value: 'rad' as const, label: 'Radfahren' }]
      : []),
    ...(units.some(u => u.kind === 'strength')
      ? [{ value: 'kraft' as const, label: 'Krafttraining' }]
      : []),
  ];
  const filter = oneOf(param(url, 'bereich'), FILTERS, 'alle');
  const shown = units.filter(unit => matches(unit, filter));
  const weeks = Math.max(
    PAGE_WEEKS,
    Number(param(url, 'wochen')) || PAGE_WEEKS,
  );

  const groups = new Map<number, Unit[]>();
  shown.forEach(unit => {
    const start = mondayStart(unit.at);
    groups.set(start, [...(groups.get(start) ?? []), unit]);
  });
  const ordered = Array.from(groups.entries()).sort((a, b) => b[0] - a[0]);
  const visible = ordered.slice(0, weeks);

  const body = units.length
    ? html`${available.length > 2
        ? segmented(
            'Bereich',
            available,
            filter,
            value =>
              `/verlauf${query({ bereich: value === 'alle' ? null : value })}`,
          )
        : null}
      ${visible.map(
        ([start, entries]) =>
          html`<div class="week">
              <span>${weekLabel(start, now)}</span
              ><span class="num">${weekSummary(entries)}</span>
            </div>
            ${entries.map(unit => unitRow(unit, ctx))}`,
      )}
      ${ordered.length > visible.length
        ? html`<div class="section">
            <a
              class="button secondary small"
              href="/verlauf${query({
                bereich: filter === 'alle' ? null : filter,
                wochen: weeks + PAGE_WEEKS,
              })}"
              >Ältere Wochen zeigen</a
            >
          </div>`
        : null}`
    : emptyState(
        'Noch keine Einheiten',
        'Verbinde dein Telefon. Danach erscheinen hier alle Läufe und Krafttrainings.',
        { label: 'Telefon verbinden', href: '/daten#verbinden' },
      );

  return page(
    { title: 'Verlauf', tab: 'Verlauf', status: syncStatus(data, now) },
    html`${title('Verlauf')}${body}`,
  );
}
