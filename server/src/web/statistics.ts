import {
  STATS_RANGES,
  bucketValue,
  buildStatisticsView,
  type StatsDelta,
  type StatsMetric,
  type StatsRange,
} from '../../../src/domain/statisticsView';
import {
  buildStrengthStatisticsView,
  strengthBucketValue,
  type StrengthStatsMetric,
} from '../../../src/domain/strengthStatistics';
import { bucketChart } from './charts';
import type { PageContext } from './context';
import { oneOf, param, syncStatus } from './context';
import {
  DASH,
  counted,
  decimal,
  formatClock,
  formatDuration,
  numberFormat,
  setText,
} from './format';
import { html, type Child, type Html } from './html';
import type { Translator } from './i18n';
import { comparisonName, purposeName, rangeName } from './labels';
import {
  badge,
  chips,
  copy,
  disclosure,
  emptyState,
  page,
  row,
  section,
  segmented,
  share,
  stat,
  title,
} from './ui';
import { exerciseDisplayName } from '../../../src/domain/catalog';

/**
 * Statistics: the same evaluation as in the app (`buildStatisticsView`,
 * `buildStrengthStatisticsView`), just on a large screen. The selection is in
 * the address, so a view can be kept as a bookmark.
 */

// URL values stay German like the `bereich` parameter, so bookmarks keep working.
type Area = 'laufen' | 'kraft';
const RANGES = STATS_RANGES.map(entry => entry.value);

type MetricOption<M extends string> = {
  value: M;
  label: string;
  shape: 'bar' | 'point';
};

const runMetrics = (tx: Translator): MetricOption<StatsMetric>[] => [
  { value: 'distance', label: tx.t('Distanz', 'Distance'), shape: 'bar' },
  { value: 'duration', label: tx.t('Dauer', 'Duration'), shape: 'bar' },
  { value: 'count', label: tx.t('Läufe', 'Runs'), shape: 'bar' },
  { value: 'pace', label: tx.t('Tempo', 'Pace'), shape: 'point' },
  { value: 'effort', label: tx.t('Gefühl', 'Effort'), shape: 'point' },
];
const strengthMetrics = (
  tx: Translator,
): MetricOption<StrengthStatsMetric>[] => [
  { value: 'sessions', label: tx.t('Einheiten', 'Sessions'), shape: 'bar' },
  { value: 'sets', label: tx.t('Sätze', 'Sets'), shape: 'bar' },
  { value: 'volume', label: tx.t('Volumen', 'Volume'), shape: 'bar' },
  { value: 'duration', label: tx.t('Dauer', 'Duration'), shape: 'bar' },
  { value: 'heartRate', label: tx.t('Puls', 'Heart rate'), shape: 'point' },
];

const formatKm = (tx: Translator, value: number) =>
  decimal(tx, value, value >= 100 ? 0 : 1);
const formatPace = (seconds: number | null) => {
  if (seconds === null || !Number.isFinite(seconds)) return DASH;
  const whole = Math.max(0, Math.round(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
};

/** The arrow is the direction, the number the size: color carries no information. */
function deltaText(tx: Translator, delta: StatsDelta): string | null {
  if (delta.direction === 'unknown') return null;
  if (delta.direction === 'flat') return `± 0${tx.t(' %', '%')}`;
  const percent =
    delta.changeRatio === null
      ? DASH
      : `${Math.abs(Math.round(delta.changeRatio * 100))}${tx.t(' %', '%')}`;
  return `${delta.direction === 'up' ? '▲' : '▼'} ${percent}`;
}

function runMetric(
  tx: Translator,
  metric: StatsMetric,
  value: number | null,
): { value: string; unit: string } {
  if (value === null || !Number.isFinite(value))
    return { value: DASH, unit: '' };
  switch (metric) {
    case 'distance':
      return { value: formatKm(tx, value), unit: 'km' };
    case 'duration':
      return { value: formatDuration(value), unit: '' };
    case 'count':
      return {
        value: String(Math.round(value)),
        unit: value === 1 ? tx.t('Lauf', 'run') : tx.t('Läufe', 'runs'),
      };
    case 'pace':
      return { value: formatPace(value), unit: 'min / km' };
    case 'effort':
      return { value: decimal(tx, value), unit: '/ 10' };
  }
}

function strengthMetric(
  tx: Translator,
  metric: StrengthStatsMetric,
  value: number | null,
): { value: string; unit: string } {
  if (value === null || !Number.isFinite(value))
    return { value: DASH, unit: '' };
  switch (metric) {
    case 'sessions':
      return {
        value: String(Math.round(value)),
        unit:
          Math.round(value) === 1
            ? tx.t('Einheit', 'session')
            : tx.t('Einheiten', 'sessions'),
      };
    case 'sets':
      return {
        value: String(Math.round(value)),
        unit:
          Math.round(value) === 1 ? tx.t('Satz', 'set') : tx.t('Sätze', 'sets'),
      };
    case 'volume':
      return {
        value: numberFormat(tx, { maximumFractionDigits: 0 }).format(value),
        unit: 'kg',
      };
    case 'duration':
      return { value: formatDuration(value), unit: '' };
    case 'heartRate':
      return { value: String(Math.round(value)), unit: 'bpm' };
  }
}

const valueRow = (
  label: string,
  value: string,
  meta?: string | null,
  href?: string,
) => row({ title: label, subtitle: meta ?? undefined, value, href });

const panel = (heading: string, summary: string, body: Child) =>
  disclosure(heading, summary, body);

const shareRow = (
  label: string,
  value: string,
  fraction: number,
  meta?: string,
) =>
  html`<div class="row">
    <span class="row-text"
      ><span class="row-title">${label}</span>${share(fraction)}${meta
        ? html`<span class="row-subtitle">${meta}</span>`
        : null}</span
    ><span class="row-value">${value}</span>
  </div>`;

function tiles(
  entries: { value: string; label: string; delta: StatsDelta }[],
  tx: Translator,
): Html {
  return html`<div class="tiles">
    ${entries.map(entry =>
      stat(entry.value, entry.label, deltaText(tx, entry.delta)),
    )}
  </div>`;
}

/** Note under the tiles: which period the arrows compare with. */
function comparisonNote(
  tx: Translator,
  range: StatsRange,
  label: string | null,
): Html | null {
  if (!label) return null;
  const phrase = comparisonName(tx, range, label);
  return copy(
    tx.t(`Pfeile vergleichen mit ${phrase}.`, `Arrows compare with ${phrase}.`),
    true,
  );
}

export function statisticsPage(ctx: PageContext): Html {
  const { data, now, url, tx } = ctx;
  const hasRunning = data.runs.length > 0;
  const hasStrength = data.strength.some(
    session => session.status === 'finished',
  );
  const areaParam = oneOf<Area>(
    param(url, 'bereich'),
    ['laufen', 'kraft'],
    hasRunning || !hasStrength ? 'laufen' : 'kraft',
  );
  const area: Area =
    areaParam === 'kraft' && hasStrength
      ? 'kraft'
      : hasRunning
      ? 'laufen'
      : hasStrength
      ? 'kraft'
      : 'laufen';
  const range = oneOf<StatsRange>(param(url, 'zeitraum'), RANGES, '12w');
  const link = (changes: Record<string, string | null>) =>
    tx.link('/statistics', {
      bereich: area,
      zeitraum: range,
      kennzahl: param(url, 'kennzahl'),
      ...changes,
    });
  const areaPicker =
    hasRunning && hasStrength
      ? segmented(
          tx.t('Bereich', 'Area'),
          [
            { value: 'laufen' as Area, label: tx.t('Laufen', 'Running') },
            {
              value: 'kraft' as Area,
              label: tx.t('Krafttraining', 'Strength training'),
            },
          ],
          area,
          value => link({ bereich: value, kennzahl: null, auswahl: null }),
        )
      : null;
  const rangePicker = segmented(
    tx.t('Zeitraum', 'Time range'),
    STATS_RANGES.map(entry => ({
      value: entry.value,
      label: rangeName(tx, entry.value, entry.label),
    })),
    range,
    value => link({ zeitraum: value, auswahl: null }),
  );
  const status = syncStatus(tx, data, now);

  if (!hasRunning && !hasStrength) {
    return page(
      tx,
      { title: tx.t('Statistik', 'Statistics'), tab: 'statistics', status },
      html`${title(tx.t('Statistik', 'Statistics'))}${emptyState(
        tx.t('Noch keine Läufe', 'No runs yet'),
        tx.t(
          'Sobald ein Lauf abgeschlossen oder importiert ist, entsteht hier deine Entwicklung.',
          'Once a run is finished or imported, your progress appears here.',
        ),
      )}`,
    );
  }

  const body =
    area === 'kraft'
      ? strengthBody(ctx, range, link)
      : runningBody(ctx, range, link);
  return page(
    tx,
    { title: tx.t('Statistik', 'Statistics'), tab: 'statistics', status },
    html`${title(tx.t('Statistik', 'Statistics'))}
      <div class="form">${areaPicker}${rangePicker}</div>
      ${body}`,
  );
}

function runningBody(
  ctx: PageContext,
  range: StatsRange,
  link: (changes: Record<string, string | null>) => string,
): Html {
  const { tx } = ctx;
  const stats = buildStatisticsView(ctx.data.runs, range, ctx.now);
  const options = runMetrics(tx);
  const metrics = options.filter(
    entry =>
      (entry.value !== 'pace' || stats.available.pace) &&
      (entry.value !== 'effort' || stats.available.effort),
  );
  const metric = oneOf(
    param(ctx.url, 'kennzahl'),
    metrics.map(m => m.value),
    'distance',
  );
  const selectedKey = param(ctx.url, 'auswahl');
  const selected =
    stats.buckets.find(bucket => String(bucket.startTime) === selectedKey) ??
    null;
  const label = metrics.find(m => m.value === metric)?.label ?? '';
  const t = stats.totals;
  const c = stats.consistency;

  const chart = bucketChart(
    tx,
    stats.buckets.map(bucket => {
      const readout = runMetric(tx, metric, bucketValue(bucket, metric));
      return {
        key: String(bucket.startTime),
        label: bucket.label,
        fullLabel: bucket.fullLabel,
        value: bucketValue(bucket, metric),
        readout: `${readout.value} ${readout.unit}`.trim(),
        href: link({
          kennzahl: metric,
          auswahl:
            String(bucket.startTime) === selectedKey
              ? null
              : String(bucket.startTime),
        }),
      };
    }),
    {
      shape: options.find(m => m.value === metric)?.shape ?? 'bar',
      selected: selectedKey,
      title: label,
    },
  );
  const detail = selected
    ? html`<div class="chart-detail">
        <span class="row-title">${selected.fullLabel}</span
        ><span class="num"
          >${`${label} ${
            runMetric(tx, metric, bucketValue(selected, metric)).value
          } ${
            runMetric(tx, metric, bucketValue(selected, metric)).unit
          }`.trim()}</span
        ><span class="row-subtitle num"
          >${[
            counted(tx, selected.runCount, ['Lauf', 'Läufe'], ['run', 'runs']),
            `${formatKm(tx, selected.distanceKm)} km`,
            formatDuration(selected.durationSeconds),
            selected.paceSecondsPerKm === null
              ? null
              : `${formatPace(selected.paceSecondsPerKm)} min / km`,
            selected.effort === null
              ? null
              : tx.t(
                  `Gefühl ${decimal(tx, selected.effort)} / 10`,
                  `Effort ${decimal(tx, selected.effort)} / 10`,
                ),
          ]
            .filter(Boolean)
            .join(' · ')}</span
        >
      </div>`
    : null;

  return html`
    <div class="section">
      ${tiles(
        [
          {
            value: formatKm(tx, t.distanceKm),
            label: tx.t('Distanz · km', 'Distance · km'),
            delta: stats.deltas.distance,
          },
          {
            value: String(t.runCount),
            label:
              t.runCount === 1 ? tx.t('Lauf', 'Run') : tx.t('Läufe', 'Runs'),
            delta: stats.deltas.count,
          },
          {
            value: formatDuration(t.durationSeconds),
            label: tx.t('Zeit', 'Time'),
            delta: stats.deltas.duration,
          },
        ],
        tx,
      )}${comparisonNote(tx, range, stats.comparisonLabel)}
    </div>
    ${section(
      tx.t('Zeitverlauf', 'Over time'),
      html`${chips(
        tx.t('Kennzahl im Verlauf', 'Metric over time'),
        metrics,
        metric,
        value => link({ kennzahl: value, auswahl: null }),
      )}${chart}${detail}`,
    )}
    ${section(
      tx.t('Tiefer schauen', 'Dig deeper'),
      html`
        ${panel(
          tx.t('Verteilung', 'Distribution'),
          stats.purposes.length
            ? `${purposeName(tx, stats.purposes[0].purpose)} ${tx.t(
                'führt mit',
                'leads with',
              )} ${Math.round(stats.purposes[0].share * 100)}${tx.t(' %', '%')}`
            : DASH,
          stats.purposes.map(entry =>
            shareRow(
              purposeName(tx, entry.purpose),
              `${formatKm(tx, entry.distanceKm)} km · ${Math.round(
                entry.share * 100,
              )}${tx.t(' %', '%')}`,
              entry.share,
              counted(tx, entry.runCount, ['Lauf', 'Läufe'], ['run', 'runs']),
            ),
          ),
        )}
        ${panel(
          tx.t('Bestwerte', 'Personal bests'),
          stats.records.length ? stats.records[0].value : DASH,
          stats.records.length
            ? stats.records.map(record =>
                valueRow(
                  record.label,
                  record.value,
                  record.detail,
                  record.runIds.length === 1
                    ? tx.link(`/run/${encodeURIComponent(record.runIds[0])}`)
                    : undefined,
                ),
              )
            : copy(
                tx.t(
                  'Für diesen Zeitraum gibt es noch keine Bestwerte.',
                  'There are no personal bests for this period yet.',
                ),
                true,
              ),
        )}
        ${panel(
          tx.t('Konsistenz', 'Consistency'),
          tx.t(
            `${c.activeWeeks} von ${c.weekCount} Wochen`,
            `${c.activeWeeks} of ${c.weekCount} weeks`,
          ),
          html`
            ${valueRow(
              tx.t('Wochen mit Lauf', 'Weeks with a run'),
              `${c.activeWeeks} / ${c.weekCount}`,
            )}
            ${valueRow(
              tx.t('Aktuelle Serie', 'Current streak'),
              counted(
                tx,
                c.currentStreakWeeks,
                ['Woche', 'Wochen'],
                ['week', 'weeks'],
              ),
            )}
            ${valueRow(
              tx.t('Längste Serie', 'Longest streak'),
              counted(
                tx,
                c.longestStreakWeeks,
                ['Woche', 'Wochen'],
                ['week', 'weeks'],
              ),
            )}
            ${valueRow(
              tx.t('Läufe je Woche', 'Runs per week'),
              t.runsPerWeek === null ? DASH : decimal(tx, t.runsPerWeek),
            )}
            ${valueRow(
              tx.t('Tage mit Lauf', 'Days with a run'),
              String(c.activeDays),
            )}
          `,
        )}
        ${panel(
          tx.t('Körperwerte', 'Body values'),
          t.paceSecondsPerKm === null
            ? DASH
            : `${formatPace(t.paceSecondsPerKm)} min / km`,
          html`
            ${valueRow(
              tx.t('Ø Tempo', 'Avg pace'),
              t.paceSecondsPerKm === null
                ? DASH
                : `${formatPace(t.paceSecondsPerKm)} min / km`,
              tx.t(
                'Nach Strecke gewichtet, Läufe ab 500 m',
                'Weighted by distance, runs from 500 m',
              ),
            )}
            ${valueRow(
              tx.t('Ø Distanz je Lauf', 'Avg distance per run'),
              t.averageDistanceKm === null
                ? DASH
                : `${formatKm(tx, t.averageDistanceKm)} km`,
            )}
            ${valueRow(
              tx.t('Beine (Median)', 'Legs (median)'),
              t.medianLegsRpe === null
                ? DASH
                : `${decimal(tx, t.medianLegsRpe)} / 10`,
            )}
            ${valueRow(
              tx.t('Atmung (Median)', 'Breathing (median)'),
              t.medianBreathingRpe === null
                ? DASH
                : `${decimal(tx, t.medianBreathingRpe)} / 10`,
            )}
            ${valueRow(
              tx.t('Ø Puls', 'Avg heart rate'),
              t.averageHeartRate === null
                ? DASH
                : `${Math.round(t.averageHeartRate)} bpm`,
            )}
            ${valueRow(
              tx.t('Ø Schrittfrequenz', 'Avg cadence'),
              t.averageCadence === null
                ? DASH
                : `${Math.round(t.averageCadence)} spm`,
            )}
          `,
        )}
      `,
    )}
  `;
}

function strengthBody(
  ctx: PageContext,
  range: StatsRange,
  link: (changes: Record<string, string | null>) => string,
): Html {
  const { tx } = ctx;
  const stats = buildStrengthStatisticsView(
    ctx.data.strength,
    range,
    ctx.now,
    ctx.data.heart,
  );
  const options = strengthMetrics(tx);
  const metrics = options.filter(
    entry =>
      (entry.value !== 'volume' || stats.available.volume) &&
      (entry.value !== 'duration' || stats.available.duration) &&
      (entry.value !== 'heartRate' || stats.available.heartRate),
  );
  const metric = oneOf(
    param(ctx.url, 'kennzahl'),
    metrics.map(m => m.value),
    'sets',
  );
  const selectedKey = param(ctx.url, 'auswahl');
  const selected =
    stats.buckets.find(bucket => String(bucket.startTime) === selectedKey) ??
    null;
  const label = metrics.find(m => m.value === metric)?.label ?? '';
  const { totals: t, consistency: c } = stats;
  const topGroup = stats.muscles.groups[0];
  const perWeek = (sets: number) =>
    stats.muscles.weekCount > 0 ? sets / stats.muscles.weekCount : null;
  const bpm = (value: number | null) =>
    value === null ? DASH : `${Math.round(value)} bpm`;
  const kilograms = (value: number) =>
    numberFormat(tx, { maximumFractionDigits: 0 }).format(value);

  const chart = bucketChart(
    tx,
    stats.buckets.map(bucket => {
      const readout = strengthMetric(
        tx,
        metric,
        strengthBucketValue(bucket, metric),
      );
      return {
        key: String(bucket.startTime),
        label: bucket.label,
        fullLabel: bucket.fullLabel,
        value: strengthBucketValue(bucket, metric),
        readout: `${readout.value} ${readout.unit}`.trim(),
        href: link({
          kennzahl: metric,
          auswahl:
            String(bucket.startTime) === selectedKey
              ? null
              : String(bucket.startTime),
        }),
      };
    }),
    {
      shape: options.find(m => m.value === metric)?.shape ?? 'bar',
      selected: selectedKey,
      title: label,
    },
  );
  const detail = selected
    ? html`<div class="chart-detail">
        <span class="row-title">${selected.fullLabel}</span
        ><span class="row-subtitle num"
          >${[
            counted(
              tx,
              selected.sessionCount,
              ['Einheit', 'Einheiten'],
              ['session', 'sessions'],
            ),
            counted(tx, selected.sets, ['Satz', 'Sätze'], ['set', 'sets']),
            selected.volumeKg === null
              ? null
              : `${kilograms(selected.volumeKg)} kg`,
            selected.durationSeconds === null
              ? null
              : formatDuration(selected.durationSeconds),
            selected.averageBpm === null
              ? null
              : tx.t(
                  `Ø ${Math.round(selected.averageBpm)} bpm`,
                  `Avg ${Math.round(selected.averageBpm)} bpm`,
                ),
          ]
            .filter(Boolean)
            .join(' · ')}</span
        >
      </div>`
    : null;

  return html`
    <div class="section">
      ${tiles(
        [
          {
            value: String(t.sessionCount),
            label:
              t.sessionCount === 1
                ? tx.t('Einheit', 'Session')
                : tx.t('Einheiten', 'Sessions'),
            delta: stats.deltas.sessions,
          },
          {
            value: String(t.sets),
            label: t.sets === 1 ? tx.t('Satz', 'Set') : tx.t('Sätze', 'Sets'),
            delta: stats.deltas.sets,
          },
          stats.available.volume
            ? {
                value: kilograms(t.volumeKg),
                label: tx.t('Volumen · kg', 'Volume · kg'),
                delta: stats.deltas.volume,
              }
            : {
                value: stats.available.duration
                  ? formatDuration(t.durationSeconds)
                  : DASH,
                label: tx.t('Zeit', 'Time'),
                delta: stats.deltas.duration,
              },
        ],
        tx,
      )}${comparisonNote(tx, range, stats.comparisonLabel)}
    </div>
    ${section(
      tx.t('Zeitverlauf', 'Over time'),
      html`${chips(
        tx.t('Kennzahl im Verlauf', 'Metric over time'),
        metrics,
        metric,
        value => link({ kennzahl: value, auswahl: null }),
      )}${chart}${detail}`,
    )}
    ${stats.exercises.length
      ? section(
          tx.t('Übungen', 'Exercises'),
          stats.exercises.map(entry =>
            row({
              title: html`${exerciseDisplayName(entry.exerciseId, entry.name)}
              ${badge(
                entry.trend.label,
                entry.trend.verdict === 'increase' ? 'green' : 'muted',
              )}`,
              subtitle: [
                counted(
                  tx,
                  entry.workingSets,
                  ['Satz', 'Sätze'],
                  ['set', 'sets'],
                ),
                entry.best && setText(tx, entry.best)
                  ? tx.t(
                      `bester Satz ${setText(tx, entry.best)}`,
                      `best set ${setText(tx, entry.best)}`,
                    )
                  : null,
              ]
                .filter(Boolean)
                .join(' · '),
            }),
          ),
        )
      : null}
    ${section(
      tx.t('Tiefer schauen', 'Dig deeper'),
      html`
        ${panel(
          tx.t('Muskeln', 'Muscles'),
          topGroup
            ? tx.t(
                `${topGroup.label} führt mit ${counted(
                  tx,
                  topGroup.sets,
                  ['Satz', 'Sätzen'],
                  ['set', 'sets'],
                )}`,
                `${topGroup.label} leads with ${counted(
                  tx,
                  topGroup.sets,
                  ['Satz', 'Sätzen'],
                  ['set', 'sets'],
                )}`,
              )
            : DASH,
          html`${stats.muscles.groups.map(group => {
            const weekly = perWeek(group.sets);
            return shareRow(
              group.label,
              counted(tx, group.sets, ['Satz', 'Sätze'], ['set', 'sets']),
              topGroup ? group.sets / topGroup.sets : 0,
              weekly === null
                ? undefined
                : tx.t(
                    `${decimal(tx, weekly)} je Woche`,
                    `${decimal(tx, weekly)} per week`,
                  ),
            );
          })}${stats.muscles.unassignedSets > 0
            ? copy(
                tx.t(
                  `${counted(
                    tx,
                    stats.muscles.unassignedSets,
                    ['Satz', 'Sätze'],
                    ['set', 'sets'],
                  )} ohne bekannte Muskelgruppe.`,
                  `${counted(
                    tx,
                    stats.muscles.unassignedSets,
                    ['Satz', 'Sätze'],
                    ['set', 'sets'],
                  )} without a known muscle group.`,
                ),
                true,
              )
            : null}${copy(
            stats.muscles.groups.length
              ? tx.t(
                  'Ein Arbeitssatz zählt für jede Hauptgruppe der Übung.',
                  'A working set counts for each main group of the exercise.',
                )
              : tx.t(
                  'Noch keine Arbeitssätze in diesem Zeitraum.',
                  'No working sets in this period yet.',
                ),
            true,
          )}`,
        )}
        ${panel(
          tx.t('Bestwerte', 'Personal bests'),
          stats.records.length ? stats.records[0].value : DASH,
          stats.records.length
            ? stats.records.map(record =>
                valueRow(
                  record.label,
                  record.value,
                  record.detail,
                  record.sessionIds.length === 1
                    ? tx.link(
                        `/strength/${encodeURIComponent(record.sessionIds[0])}`,
                      )
                    : undefined,
                ),
              )
            : copy(
                tx.t(
                  'Für diesen Zeitraum gibt es noch keine Bestwerte.',
                  'There are no personal bests for this period yet.',
                ),
                true,
              ),
        )}
        ${panel(
          tx.t('Konsistenz', 'Consistency'),
          tx.t(
            `${c.activeWeeks} von ${c.weekCount} Wochen`,
            `${c.activeWeeks} of ${c.weekCount} weeks`,
          ),
          html`
            ${valueRow(
              tx.t('Wochen mit Krafttraining', 'Weeks with strength training'),
              `${c.activeWeeks} / ${c.weekCount}`,
            )}
            ${valueRow(
              tx.t('Aktuelle Serie', 'Current streak'),
              counted(
                tx,
                c.currentStreakWeeks,
                ['Woche', 'Wochen'],
                ['week', 'weeks'],
              ),
            )}
            ${valueRow(
              tx.t('Längste Serie', 'Longest streak'),
              counted(
                tx,
                c.longestStreakWeeks,
                ['Woche', 'Wochen'],
                ['week', 'weeks'],
              ),
            )}
            ${valueRow(
              tx.t('Einheiten je Woche', 'Sessions per week'),
              t.sessionsPerWeek === null
                ? DASH
                : decimal(tx, t.sessionsPerWeek),
            )}
            ${valueRow(
              tx.t('Tage mit Krafttraining', 'Days with strength training'),
              String(c.activeDays),
            )}
          `,
        )}
        ${panel(
          tx.t('Körperwerte', 'Body values'),
          t.averageBpm === null
            ? t.medianRir === null
              ? DASH
              : tx.t(
                  `${decimal(tx, t.medianRir)} im Tank`,
                  `${decimal(tx, t.medianRir)} reps in reserve`,
                )
            : tx.t(`Ø ${bpm(t.averageBpm)}`, `Avg ${bpm(t.averageBpm)}`),
          html`
            ${valueRow(
              tx.t('Ø Puls', 'Avg heart rate'),
              bpm(t.averageBpm),
              t.heartSessions
                ? tx.t(
                    `Von der Uhr · ${t.heartSessions} von ${counted(
                      tx,
                      t.sessionCount,
                      ['Einheit', 'Einheiten'],
                      ['session', 'sessions'],
                    )}`,
                    `From the watch · ${t.heartSessions} of ${counted(
                      tx,
                      t.sessionCount,
                      ['Einheit', 'Einheiten'],
                      ['session', 'sessions'],
                    )}`,
                  )
                : tx.t(
                    'Mit Uhr gemessen; ohne Uhr bleibt er offen',
                    'Measured with the watch; stays open without one',
                  ),
            )}
            ${valueRow(tx.t('Höchster Puls', 'Max heart rate'), bpm(t.maxBpm))}
            ${valueRow(
              tx.t('Wiederholungen im Tank', 'Reps in reserve'),
              t.medianRir === null ? DASH : decimal(tx, t.medianRir),
              t.rirSets
                ? tx.t(
                    `Median aus ${counted(
                      tx,
                      t.rirSets,
                      ['Satz', 'Sätzen'],
                      ['set', 'sets'],
                    )}`,
                    `Median of ${counted(
                      tx,
                      t.rirSets,
                      ['Satz', 'Sätzen'],
                      ['set', 'sets'],
                    )}`,
                  )
                : undefined,
            )}
            ${valueRow(
              tx.t('Satzabstand', 'Set interval'),
              t.medianSetGapSeconds === null
                ? DASH
                : formatClock(t.medianSetGapSeconds),
              tx.t(
                'Median · Abhaken bis Abhaken, Pause und Satz',
                'Median · from tick to tick, including rest and set',
              ),
            )}
            ${valueRow(
              tx.t('Ø Dauer je Einheit', 'Avg duration per session'),
              t.averageDurationSeconds === null
                ? DASH
                : formatDuration(t.averageDurationSeconds),
            )}
            ${valueRow(
              tx.t('Sätze je Einheit', 'Sets per session'),
              t.setsPerSession === null ? DASH : decimal(tx, t.setsPerSession),
            )}
          `,
        )}
      `,
    )}
  `;
}
