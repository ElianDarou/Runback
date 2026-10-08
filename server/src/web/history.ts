import type { Run } from '../../../src/domain/trainingRecords';
import { runTitle } from '../../../src/domain/runTitle';
import { isRun } from '../../../src/domain/sport';
import { mondayStart } from '../../../src/domain/statistics';
import type { StrengthSession } from '../../../src/domain/strength';
import type { PageContext } from './context';
import { oneOf, param, syncStatus } from './context';
import { completedSets, counted, dayMonth, day, km, tempo } from './format';
import { html, type Html } from './html';
import type { Translator } from './i18n';
import { emptyState, page, row, segmented, title } from './ui';

/**
 * History: what did I do? All workouts by week, as in the app. The week header
 * shows the total, so the volume is visible without switching to statistics.
 */

type Unit =
  | { kind: 'run'; at: number; run: Run }
  | { kind: 'strength'; at: number; session: StrengthSession };

// URL values stay German like the `bereich` parameter, so bookmarks keep working.
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

function weekLabel(tx: Translator, start: number, now: number): string {
  const thisWeek = mondayStart(now);
  if (start === thisWeek) return tx.t('Diese Woche', 'This week');
  if (start === mondayStart(thisWeek - 86_400_000))
    return tx.t('Letzte Woche', 'Last week');
  return `${dayMonth(tx, start)} – ${dayMonth(tx, start + 6 * 86_400_000)}`;
}

function weekSummary(tx: Translator, units: Unit[]): string {
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
      ? `${counted(
          tx,
          runs.length,
          ['Einheit', 'Einheiten'],
          ['workout', 'workouts'],
        )} · ${km(tx, meters, 1)} km`
      : null,
    sessions
      ? counted(
          tx,
          sessions,
          ['Krafttraining', 'Krafttrainings'],
          ['strength session', 'strength sessions'],
        )
      : null,
  ]
    .filter(Boolean)
    .join(' · ');
}

function unitRow(tx: Translator, unit: Unit, ctx: PageContext): Html {
  if (unit.kind === 'run') {
    const { value, unit: tempoUnit } = tempo(tx, unit.run);
    return row({
      title: runTitle(unit.run),
      subtitle: `${day(tx, unit.at)} · ${km(
        tx,
        unit.run.distanceMeters,
      )} km · ${value} ${tempoUnit}`,
      href: tx.link(`/run/${encodeURIComponent(unit.run.id)}`),
    });
  }
  const heart = ctx.data.heart[unit.session.id];
  const sets = completedSets(unit.session);
  return row({
    title: unit.session.name || tx.t('Krafttraining', 'Strength training'),
    subtitle: [
      day(tx, unit.at),
      counted(tx, sets, ['Satz', 'Sätze'], ['set', 'sets']),
      heart
        ? tx.t(
            `Ø ${Math.round(heart.averageBpm)} bpm`,
            `Avg ${Math.round(heart.averageBpm)} bpm`,
          )
        : null,
    ]
      .filter(Boolean)
      .join(' · '),
    href: tx.link(`/strength/${encodeURIComponent(unit.session.id)}`),
  });
}

export function historyPage(ctx: PageContext): Html {
  const { data, now, url, tx } = ctx;
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
    { value: 'alle', label: tx.t('Alle', 'All') },
    ...(units.some(u => u.kind === 'run' && isRun(u.run))
      ? [{ value: 'laufen' as const, label: tx.t('Laufen', 'Running') }]
      : []),
    ...(units.some(u => u.kind === 'run' && !isRun(u.run))
      ? [{ value: 'rad' as const, label: tx.t('Radfahren', 'Cycling') }]
      : []),
    ...(units.some(u => u.kind === 'strength')
      ? [
          {
            value: 'kraft' as const,
            label: tx.t('Krafttraining', 'Strength training'),
          },
        ]
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
        ? segmented(tx.t('Bereich', 'Area'), available, filter, value =>
            tx.link('/history', {
              bereich: value === 'alle' ? null : value,
            }),
          )
        : null}
      ${visible.map(
        ([start, entries]) =>
          html`<div class="week">
              <span>${weekLabel(tx, start, now)}</span
              ><span class="num">${weekSummary(tx, entries)}</span>
            </div>
            ${entries.map(unit => unitRow(tx, unit, ctx))}`,
      )}
      ${ordered.length > visible.length
        ? html`<div class="section">
            <a
              class="button secondary small"
              href="${tx.link('/history', {
                bereich: filter === 'alle' ? null : filter,
                wochen: weeks + PAGE_WEEKS,
              })}"
              >${tx.t('Ältere Wochen zeigen', 'Show older weeks')}</a
            >
          </div>`
        : null}`
    : emptyState(
        tx.t('Noch keine Einheiten', 'No workouts yet'),
        tx.t(
          'Verbinde dein Telefon. Danach erscheinen hier alle Läufe und Krafttrainings.',
          'Connect your phone. Runs and strength sessions will appear here.',
        ),
        {
          label: tx.t('Telefon verbinden', 'Connect phone'),
          href: `${tx.link('/data')}#verbinden`,
        },
      );

  return page(
    tx,
    {
      title: tx.t('Verlauf', 'History'),
      tab: 'history',
      status: syncStatus(tx, data, now),
    },
    html`${title(tx.t('Verlauf', 'History'))}${body}`,
  );
}
