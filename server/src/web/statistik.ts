import { setLabel } from '../../../src/domain/strengthSession';
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
import { DASH, counted, decimal, formatClock, formatDuration } from './format';
import { html, query, type Child, type Html } from './html';
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

/**
 * Statistik: dieselbe Auswertung wie in der App (`buildStatisticsView`,
 * `buildStrengthStatisticsView`), nur auf großem Bildschirm. Auswahl steht in
 * der Adresse, damit man eine Ansicht als Lesezeichen behalten kann.
 */

type Area = 'laufen' | 'kraft';
const RANGES = STATS_RANGES.map(entry => entry.value);

const RUN_METRICS: {
  value: StatsMetric;
  label: string;
  shape: 'bar' | 'point';
}[] = [
  { value: 'distance', label: 'Distanz', shape: 'bar' },
  { value: 'duration', label: 'Dauer', shape: 'bar' },
  { value: 'count', label: 'Läufe', shape: 'bar' },
  { value: 'pace', label: 'Tempo', shape: 'point' },
  { value: 'effort', label: 'Gefühl', shape: 'point' },
];
const STRENGTH_METRICS: {
  value: StrengthStatsMetric;
  label: string;
  shape: 'bar' | 'point';
}[] = [
  { value: 'sessions', label: 'Einheiten', shape: 'bar' },
  { value: 'sets', label: 'Sätze', shape: 'bar' },
  { value: 'volume', label: 'Volumen', shape: 'bar' },
  { value: 'duration', label: 'Dauer', shape: 'bar' },
  { value: 'heartRate', label: 'Puls', shape: 'point' },
];

const kilograms = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 0 });
const formatKm = (value: number) => decimal(value, value >= 100 ? 0 : 1);
const formatPace = (seconds: number | null) => {
  if (seconds === null || !Number.isFinite(seconds)) return DASH;
  const whole = Math.max(0, Math.round(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
};

/** Pfeil ist die Richtung, die Zahl die Größe — Farbe trägt keine Information. */
function deltaText(delta: StatsDelta): string | null {
  if (delta.direction === 'unknown') return null;
  if (delta.direction === 'flat') return '± 0 %';
  const percent =
    delta.changeRatio === null
      ? DASH
      : `${Math.abs(Math.round(delta.changeRatio * 100))} %`;
  return `${delta.direction === 'up' ? '▲' : '▼'} ${percent}`;
}

function runMetric(
  metric: StatsMetric,
  value: number | null,
): { value: string; unit: string } {
  if (value === null || !Number.isFinite(value))
    return { value: DASH, unit: '' };
  switch (metric) {
    case 'distance':
      return { value: formatKm(value), unit: 'km' };
    case 'duration':
      return { value: formatDuration(value), unit: '' };
    case 'count':
      return {
        value: String(Math.round(value)),
        unit: value === 1 ? 'Lauf' : 'Läufe',
      };
    case 'pace':
      return { value: formatPace(value), unit: 'min / km' };
    case 'effort':
      return { value: decimal(value), unit: '/ 10' };
  }
}

function strengthMetric(
  metric: StrengthStatsMetric,
  value: number | null,
): { value: string; unit: string } {
  if (value === null || !Number.isFinite(value))
    return { value: DASH, unit: '' };
  switch (metric) {
    case 'sessions':
      return {
        value: String(Math.round(value)),
        unit: Math.round(value) === 1 ? 'Einheit' : 'Einheiten',
      };
    case 'sets':
      return {
        value: String(Math.round(value)),
        unit: Math.round(value) === 1 ? 'Satz' : 'Sätze',
      };
    case 'volume':
      return { value: kilograms.format(value), unit: 'kg' };
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
): Html {
  return html`<div class="tiles">
    ${entries.map(entry =>
      stat(entry.value, entry.label, deltaText(entry.delta)),
    )}
  </div>`;
}

export function statistikPage(ctx: PageContext): Html {
  const { data, now, url } = ctx;
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
    `/statistik${query({
      bereich: area,
      zeitraum: range,
      kennzahl: param(url, 'kennzahl'),
      ...changes,
    })}`;
  const areaPicker =
    hasRunning && hasStrength
      ? segmented(
          'Bereich',
          [
            { value: 'laufen' as Area, label: 'Laufen' },
            { value: 'kraft' as Area, label: 'Krafttraining' },
          ],
          area,
          value => link({ bereich: value, kennzahl: null, auswahl: null }),
        )
      : null;
  const rangePicker = segmented('Zeitraum', STATS_RANGES, range, value =>
    link({ zeitraum: value, auswahl: null }),
  );
  const status = syncStatus(data, now);

  if (!hasRunning && !hasStrength) {
    return page(
      { title: 'Statistik', tab: 'Statistik', status },
      html`${title('Statistik')}${emptyState(
        'Noch keine Läufe',
        'Sobald ein Lauf abgeschlossen oder importiert ist, entsteht hier deine Entwicklung.',
      )}`,
    );
  }

  const body =
    area === 'kraft'
      ? strengthBody(ctx, range, link)
      : runningBody(ctx, range, link);
  return page(
    { title: 'Statistik', tab: 'Statistik', status },
    html`${title('Statistik')}
      <div class="form">${areaPicker}${rangePicker}</div>
      ${body}`,
  );
}

function runningBody(
  ctx: PageContext,
  range: StatsRange,
  link: (changes: Record<string, string | null>) => string,
): Html {
  const stats = buildStatisticsView(ctx.data.runs, range, ctx.now);
  const metrics = RUN_METRICS.filter(
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
    stats.buckets.map(bucket => {
      const readout = runMetric(metric, bucketValue(bucket, metric));
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
      shape: RUN_METRICS.find(m => m.value === metric)?.shape ?? 'bar',
      selected: selectedKey,
      title: label,
    },
  );
  const detail = selected
    ? html`<div class="chart-detail">
        <span class="row-title">${selected.fullLabel}</span
        ><span class="num"
          >${`${label} ${
            runMetric(metric, bucketValue(selected, metric)).value
          } ${
            runMetric(metric, bucketValue(selected, metric)).unit
          }`.trim()}</span
        ><span class="row-subtitle num"
          >${[
            counted(selected.runCount, 'Lauf', 'Läufe'),
            `${formatKm(selected.distanceKm)} km`,
            formatDuration(selected.durationSeconds),
            selected.paceSecondsPerKm === null
              ? null
              : `${formatPace(selected.paceSecondsPerKm)} min / km`,
            selected.effort === null
              ? null
              : `Gefühl ${decimal(selected.effort)} / 10`,
          ]
            .filter(Boolean)
            .join(' · ')}</span
        >
      </div>`
    : null;

  return html`
    <div class="section">
      ${tiles([
        {
          value: formatKm(t.distanceKm),
          label: 'Distanz · km',
          delta: stats.deltas.distance,
        },
        {
          value: String(t.runCount),
          label: t.runCount === 1 ? 'Lauf' : 'Läufe',
          delta: stats.deltas.count,
        },
        {
          value: formatDuration(t.durationSeconds),
          label: 'Zeit',
          delta: stats.deltas.duration,
        },
      ])}${stats.comparisonLabel
        ? copy(`Pfeile vergleichen mit ${stats.comparisonLabel}.`, true)
        : null}
    </div>
    ${section(
      'Zeitverlauf',
      html`${chips('Kennzahl im Verlauf', metrics, metric, value =>
        link({ kennzahl: value, auswahl: null }),
      )}${chart}${detail}`,
    )}
    ${section(
      'Tiefer schauen',
      html`
        ${panel(
          'Verteilung',
          stats.purposes.length
            ? `${stats.purposes[0].label} führt mit ${Math.round(
                stats.purposes[0].share * 100,
              )} %`
            : DASH,
          stats.purposes.map(entry =>
            shareRow(
              entry.label,
              `${formatKm(entry.distanceKm)} km · ${Math.round(
                entry.share * 100,
              )} %`,
              entry.share,
              counted(entry.runCount, 'Lauf', 'Läufe'),
            ),
          ),
        )}
        ${panel(
          'Bestwerte',
          stats.records.length ? stats.records[0].value : DASH,
          stats.records.length
            ? stats.records.map(record =>
                valueRow(
                  record.label,
                  record.value,
                  record.detail,
                  record.runIds.length === 1
                    ? `/lauf/${encodeURIComponent(record.runIds[0])}`
                    : undefined,
                ),
              )
            : copy('Für diesen Zeitraum gibt es noch keine Bestwerte.', true),
        )}
        ${panel(
          'Konsistenz',
          `${c.activeWeeks} von ${c.weekCount} Wochen`,
          html`
            ${valueRow('Wochen mit Lauf', `${c.activeWeeks} / ${c.weekCount}`)}
            ${valueRow(
              'Aktuelle Serie',
              counted(c.currentStreakWeeks, 'Woche', 'Wochen'),
            )}
            ${valueRow(
              'Längste Serie',
              counted(c.longestStreakWeeks, 'Woche', 'Wochen'),
            )}
            ${valueRow(
              'Läufe je Woche',
              t.runsPerWeek === null ? DASH : decimal(t.runsPerWeek),
            )}
            ${valueRow('Tage mit Lauf', String(c.activeDays))}
          `,
        )}
        ${panel(
          'Körperwerte',
          t.paceSecondsPerKm === null
            ? DASH
            : `${formatPace(t.paceSecondsPerKm)} min / km`,
          html`
            ${valueRow(
              'Ø Tempo',
              t.paceSecondsPerKm === null
                ? DASH
                : `${formatPace(t.paceSecondsPerKm)} min / km`,
              'Nach Strecke gewichtet, Läufe ab 500 m',
            )}
            ${valueRow(
              'Ø Distanz je Lauf',
              t.averageDistanceKm === null
                ? DASH
                : `${formatKm(t.averageDistanceKm)} km`,
            )}
            ${valueRow(
              'Beine (Median)',
              t.medianLegsRpe === null
                ? DASH
                : `${decimal(t.medianLegsRpe)} / 10`,
            )}
            ${valueRow(
              'Atmung (Median)',
              t.medianBreathingRpe === null
                ? DASH
                : `${decimal(t.medianBreathingRpe)} / 10`,
            )}
            ${valueRow(
              'Ø Puls',
              t.averageHeartRate === null
                ? DASH
                : `${Math.round(t.averageHeartRate)} bpm`,
            )}
            ${valueRow(
              'Ø Schrittfrequenz',
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
  const stats = buildStrengthStatisticsView(
    ctx.data.strength,
    range,
    ctx.now,
    ctx.data.heart,
  );
  const metrics = STRENGTH_METRICS.filter(
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

  const chart = bucketChart(
    stats.buckets.map(bucket => {
      const readout = strengthMetric(
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
      shape: STRENGTH_METRICS.find(m => m.value === metric)?.shape ?? 'bar',
      selected: selectedKey,
      title: label,
    },
  );
  const detail = selected
    ? html`<div class="chart-detail">
        <span class="row-title">${selected.fullLabel}</span
        ><span class="row-subtitle num"
          >${[
            counted(selected.sessionCount, 'Einheit', 'Einheiten'),
            counted(selected.sets, 'Satz', 'Sätze'),
            selected.volumeKg === null
              ? null
              : `${kilograms.format(selected.volumeKg)} kg`,
            selected.durationSeconds === null
              ? null
              : formatDuration(selected.durationSeconds),
            selected.averageBpm === null
              ? null
              : `Ø ${Math.round(selected.averageBpm)} bpm`,
          ]
            .filter(Boolean)
            .join(' · ')}</span
        >
      </div>`
    : null;

  return html`
    <div class="section">
      ${tiles([
        {
          value: String(t.sessionCount),
          label: t.sessionCount === 1 ? 'Einheit' : 'Einheiten',
          delta: stats.deltas.sessions,
        },
        {
          value: String(t.sets),
          label: t.sets === 1 ? 'Satz' : 'Sätze',
          delta: stats.deltas.sets,
        },
        stats.available.volume
          ? {
              value: kilograms.format(t.volumeKg),
              label: 'Volumen · kg',
              delta: stats.deltas.volume,
            }
          : {
              value: stats.available.duration
                ? formatDuration(t.durationSeconds)
                : DASH,
              label: 'Zeit',
              delta: stats.deltas.duration,
            },
      ])}${stats.comparisonLabel
        ? copy(`Pfeile vergleichen mit ${stats.comparisonLabel}.`, true)
        : null}
    </div>
    ${section(
      'Zeitverlauf',
      html`${chips('Kennzahl im Verlauf', metrics, metric, value =>
        link({ kennzahl: value, auswahl: null }),
      )}${chart}${detail}`,
    )}
    ${stats.exercises.length
      ? section(
          'Übungen',
          stats.exercises.map(entry =>
            row({
              title: html`${entry.name}
              ${badge(
                entry.trend.label,
                entry.trend.verdict === 'increase' ? 'green' : 'muted',
              )}`,
              subtitle: [
                counted(entry.workingSets, 'Satz', 'Sätze'),
                entry.best && setLabel(entry.best)
                  ? `bester Satz ${setLabel(entry.best)}`
                  : null,
              ]
                .filter(Boolean)
                .join(' · '),
            }),
          ),
        )
      : null}
    ${section(
      'Tiefer schauen',
      html`
        ${panel(
          'Muskeln',
          topGroup
            ? `${topGroup.label} führt mit ${counted(
                topGroup.sets,
                'Satz',
                'Sätzen',
              )}`
            : DASH,
          html`${stats.muscles.groups.map(group => {
            const weekly = perWeek(group.sets);
            return shareRow(
              group.label,
              counted(group.sets, 'Satz', 'Sätze'),
              topGroup ? group.sets / topGroup.sets : 0,
              weekly === null ? undefined : `${decimal(weekly)} je Woche`,
            );
          })}${stats.muscles.unassignedSets > 0
            ? copy(
                `${counted(
                  stats.muscles.unassignedSets,
                  'Satz',
                  'Sätze',
                )} ohne bekannte Muskelgruppe.`,
                true,
              )
            : null}${copy(
            stats.muscles.groups.length
              ? 'Ein Arbeitssatz zählt für jede Hauptgruppe der Übung.'
              : 'Noch keine Arbeitssätze in diesem Zeitraum.',
            true,
          )}`,
        )}
        ${panel(
          'Bestwerte',
          stats.records.length ? stats.records[0].value : DASH,
          stats.records.length
            ? stats.records.map(record =>
                valueRow(
                  record.label,
                  record.value,
                  record.detail,
                  record.sessionIds.length === 1
                    ? `/kraft/${encodeURIComponent(record.sessionIds[0])}`
                    : undefined,
                ),
              )
            : copy('Für diesen Zeitraum gibt es noch keine Bestwerte.', true),
        )}
        ${panel(
          'Konsistenz',
          `${c.activeWeeks} von ${c.weekCount} Wochen`,
          html`
            ${valueRow(
              'Wochen mit Krafttraining',
              `${c.activeWeeks} / ${c.weekCount}`,
            )}
            ${valueRow(
              'Aktuelle Serie',
              counted(c.currentStreakWeeks, 'Woche', 'Wochen'),
            )}
            ${valueRow(
              'Längste Serie',
              counted(c.longestStreakWeeks, 'Woche', 'Wochen'),
            )}
            ${valueRow(
              'Einheiten je Woche',
              t.sessionsPerWeek === null ? DASH : decimal(t.sessionsPerWeek),
            )}
            ${valueRow('Tage mit Krafttraining', String(c.activeDays))}
          `,
        )}
        ${panel(
          'Körperwerte',
          t.averageBpm === null
            ? t.medianRir === null
              ? DASH
              : `${decimal(t.medianRir)} im Tank`
            : `Ø ${bpm(t.averageBpm)}`,
          html`
            ${valueRow(
              'Ø Puls',
              bpm(t.averageBpm),
              t.heartSessions
                ? `Von der Uhr · ${t.heartSessions} von ${counted(
                    t.sessionCount,
                    'Einheit',
                    'Einheiten',
                  )}`
                : 'Mit Uhr gemessen; ohne Uhr bleibt er offen',
            )}
            ${valueRow('Höchster Puls', bpm(t.maxBpm))}
            ${valueRow(
              'Wiederholungen im Tank',
              t.medianRir === null ? DASH : decimal(t.medianRir),
              t.rirSets
                ? `Median aus ${counted(t.rirSets, 'Satz', 'Sätzen')}`
                : undefined,
            )}
            ${valueRow(
              'Satzabstand',
              t.medianSetGapSeconds === null
                ? DASH
                : formatClock(t.medianSetGapSeconds),
              'Median · Abhaken bis Abhaken, Pause und Satz',
            )}
            ${valueRow(
              'Ø Dauer je Einheit',
              t.averageDurationSeconds === null
                ? DASH
                : formatDuration(t.averageDurationSeconds),
            )}
            ${valueRow(
              'Sätze je Einheit',
              t.setsPerSession === null ? DASH : decimal(t.setsPerSession),
            )}
          `,
        )}
      `,
    )}
  `;
}
