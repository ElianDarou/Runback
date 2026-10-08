import React, { useMemo, useState } from 'react';
import { Text, View } from 'react-native';
import type { Run } from '../native';
import type { StrengthSession } from '../domain/strength';
import type { StrengthHeartSummary } from '../domain/strengthHeart';
import type {
  StrengthRecord,
  StrengthStatsMetric,
} from '../domain/strengthStatistics';
import {
  bucketValue,
  buildStatisticsView,
  STATS_RANGES,
  type StatsBucket,
  type StatsMetric,
  type StatsRange,
  type StatsRecord,
} from '../domain/statisticsView';
import { ChipGroup, Segmented, Copy, EmptyState, Section } from './components';
import { tr } from '../domain/i18n';
import {
  Chart,
  ChartDetail,
  DASH,
  Panel,
  ShareRow,
  Tile,
  ValueRow,
  decimal,
  formatDuration,
  statsStyles,
} from './StatsParts';
import { STATS_MODULES, type Area, type StatsModule } from '../domain/features';
import { StrengthStatistics, STRENGTH_METRICS } from './StrengthStatistics';

/**
 * Statistics in three depths:
 *
 * 1. Header — pick a period, three figures with a comparison to the period before.
 * 2. Trend — one chart whose metric the user picks; every bar is tappable and
 *    opens its values in place.
 * 3. Sections — distribution, personal bests, consistency, body figures; collapsed
 *    until someone wants to see them.
 *
 * The period picker sits above everything and applies to everything below it.
 * There is no second picker that only affects one section.
 *
 * Running and strength are separate areas: when both have data, a `Segmented`
 * at the top picks the area, and the period applies to both. Nothing is
 * combined — kilometers and sets are not a shared quantity.
 */

export interface StatisticsView {
  range: StatsRange;
  metric: StatsMetric;
  /** Last chosen area; only counts when both areas have data. */
  area?: Area;
  strengthMetric?: StrengthStatsMetric;
}

export const defaultStatisticsView: StatisticsView = {
  range: '12w',
  metric: 'distance',
};

/** Settings arrive as unchecked JSON from native storage. Unknown values fall
 *  back to the default instead of emptying the page. */
export function readStatisticsView(value: unknown): StatisticsView {
  const raw = (value ?? {}) as {
    range?: unknown;
    metric?: unknown;
    area?: unknown;
    strengthMetric?: unknown;
  };
  return {
    range: STATS_RANGES.some(entry => entry.value === raw.range)
      ? (raw.range as StatsRange)
      : defaultStatisticsView.range,
    metric: METRICS.some(entry => entry.value === raw.metric)
      ? (raw.metric as StatsMetric)
      : defaultStatisticsView.metric,
    area:
      raw.area === 'running' || raw.area === 'strength' ? raw.area : undefined,
    strengthMetric: STRENGTH_METRICS.some(
      entry => entry.value === raw.strengthMetric,
    )
      ? (raw.strengthMetric as StrengthStatsMetric)
      : undefined,
  };
}

const areas = (): { value: Area; label: string }[] => [
  { value: 'running', label: tr('Laufen', 'Running') },
  { value: 'strength', label: tr('Krafttraining', 'Strength') },
];

const METRICS: {
  value: StatsMetric;
  /** Figures without a meaningful zero are shown as points. */
  shape: 'bar' | 'point';
}[] = [
  { value: 'distance', shape: 'bar' },
  { value: 'duration', shape: 'bar' },
  { value: 'count', shape: 'bar' },
  { value: 'pace', shape: 'point' },
  { value: 'effort', shape: 'point' },
];

const runWord = (count: number) =>
  tr(count === 1 ? 'Lauf' : 'Läufe', count === 1 ? 'run' : 'runs');

const weekWord = (count: number) =>
  tr(count === 1 ? 'Woche' : 'Wochen', count === 1 ? 'week' : 'weeks');

const formatKm = (value: number) => `${decimal(value, value >= 100 ? 0 : 1)}`;


const formatPace = (seconds: number | null) => {
  if (seconds === null || !Number.isFinite(seconds)) {
    return DASH;
  }
  const whole = Math.max(0, Math.round(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
};

/** A value with its unit — the only place a metric is turned into text. It is
 *  used for tiles, the axis and the detail line. */
function formatMetric(
  metric: StatsMetric,
  value: number | null,
): { value: string; unit: string } {
  if (value === null || !Number.isFinite(value)) {
    return { value: DASH, unit: '' };
  }
  switch (metric) {
    case 'distance':
      return { value: formatKm(value), unit: 'km' };
    case 'duration':
      return { value: formatDuration(value), unit: '' };
    case 'count':
      return {
        value: String(Math.round(value)),
        unit: runWord(value),
      };
    case 'pace':
      return { value: formatPace(value), unit: 'min / km' };
    case 'effort':
      return { value: decimal(value), unit: '/ 10' };
  }
}

const metricLabel = (metric: StatsMetric) => {
  switch (metric) {
    case 'distance':
      return tr('Distanz', 'Distance');
    case 'duration':
      return tr('Dauer', 'Duration');
    case 'count':
      return tr('Läufe', 'Runs');
    case 'pace':
      return tr('Tempo', 'Pace');
    case 'effort':
      return tr('Gefühl', 'Feel');
  }
};

export function Statistics({
  runs,
  sessions = [],
  heart = {},
  view = defaultStatisticsView,
  onViewChange,
  onOpenRecord,
  onOpenSession,
  onOpenStrengthRecord,
  onOpenExercise,
  busy = false,
  embedded = false,
  modules = STATS_MODULES,
  showRunning = true,
  showStrength = true,
}: {
  runs: Run[];
  /** Finished strength sessions. Without them this area does not exist here. */
  sessions?: StrengthSession[];
  /** Heart rate of the strength sessions from the watch, per session. */
  heart?: Record<string, StrengthHeartSummary>;
  /** Last chosen period and metric. */
  view?: StatisticsView;
  onViewChange?: (view: StatisticsView) => void;
  onOpenRecord?: (record: StatsRecord) => void;
  onOpenSession?: (id: string) => void;
  onOpenStrengthRecord?: (record: StrengthRecord) => void;
  onOpenExercise?: (exerciseId: string) => void;
  busy?: boolean;
  /** Part of a page that already has the title (History). */
  embedded?: boolean;
  /** Blocks under "Explore further" the user wants to see. */
  modules?: StatsModule[];
  /** Switched-off areas show nothing here — not even an empty state. */
  showRunning?: boolean;
  showStrength?: boolean;
}) {
  const [localView, setLocalView] = useState(view);
  // Without outside storage, the choice at least lasts for this session.
  const active = onViewChange ? view : localView;
  const setView = (next: StatisticsView) => {
    setLocalView(next);
    onViewChange?.(next);
  };

  const stats = useMemo(
    () => buildStatisticsView(runs, active.range),
    [runs, active.range],
  );
  const [selected, setSelected] = useState<number | null>(null);
  // A metric without data is not offered — and one already chosen falls back
  // to distance.
  const metrics = METRICS.filter(
    entry =>
      (entry.value !== 'pace' || stats.available.pace) &&
      (entry.value !== 'effort' || stats.available.effort),
  );
  const metric = metrics.some(entry => entry.value === active.metric)
    ? active.metric
    : 'distance';

  // An area that is switched off or has no data does not appear — not even as
  // an empty state next to the other one.
  const hasStrength =
    showStrength && sessions.some(session => session.status === 'finished');
  const hasRunning = showRunning && runs.length > 0;
  const area: Area =
    hasRunning && hasStrength
      ? active.area ?? 'running'
      : hasStrength || !showRunning
      ? 'strength'
      : 'running';
  const title = embedded ? null : (
    <Text accessibilityRole="header" style={styles.title}>
      {tr('Statistik', 'Statistics')}
    </Text>
  );
  const areaPicker =
    hasRunning && hasStrength ? (
      <Segmented
        label={tr('Bereich', 'Area')}
        options={areas()}
        value={area}
        onChange={next => {
          setSelected(null);
          setView({ ...active, area: next });
        }}
      />
    ) : null;

  if (area === 'strength') {
    return (
      <View style={styles.page}>
        {title}
        {areaPicker}
        {hasStrength ? (
          <StrengthStatistics
            sessions={sessions}
            heart={heart}
            range={active.range}
            metric={active.strengthMetric}
            onRangeChange={range => setView({ ...active, range })}
            onMetricChange={strengthMetric =>
              setView({ ...active, strengthMetric })
            }
            onOpenSession={onOpenSession}
            onOpenRecord={onOpenStrengthRecord}
            onOpenExercise={onOpenExercise}
            busy={busy}
            modules={modules}
          />
        ) : (
          <EmptyState
            title={tr('Noch keine Krafteinheit', 'No strength session yet')}
            copy={tr(
              'Sobald ein Training abgeschlossen oder importiert ist, stehen hier Einheiten, Sätze, Muskeln und Übungen.',
              'As soon as a workout is finished or imported, sessions, sets, muscles and exercises appear here.',
            )}
          />
        )}
      </View>
    );
  }
  if (!runs.length) {
    return (
      <View style={styles.page}>
        {title}
        <EmptyState
          title={tr('Noch keine Läufe', 'No runs yet')}
          copy={tr(
            'Sobald ein Lauf abgeschlossen oder importiert ist, entsteht hier deine Entwicklung.',
            'As soon as a run is finished or imported, your progress appears here.',
          )}
        />
      </View>
    );
  }

  return (
    <View style={styles.page}>
      {title}
      {areaPicker}

      <Segmented
        label={tr('Zeitraum', 'Period')}
        options={STATS_RANGES}
        value={active.range}
        onChange={range => {
          setSelected(null);
          setView({ ...active, range });
        }}
      />

      <View style={styles.tiles}>
        <Tile
          value={formatKm(stats.totals.distanceKm)}
          unit="km"
          label={tr('Distanz', 'Distance')}
          delta={stats.deltas.distance}
        />
        <Tile
          value={String(stats.totals.runCount)}
          unit=""
          label={runWord(stats.totals.runCount)}
          delta={stats.deltas.count}
        />
        <Tile
          value={formatDuration(stats.totals.durationSeconds)}
          unit=""
          label={tr('Zeit', 'Time')}
          delta={stats.deltas.duration}
        />
      </View>
      {stats.comparisonLabel ? (
        <Copy muted style={styles.compare}>
          {tr(
            `Pfeile vergleichen mit ${stats.comparisonLabel}.`,
            `Arrows compare with ${stats.comparisonLabel}.`,
          )}
        </Copy>
      ) : null}

      <Section title={tr('Zeitverlauf', 'Over time')}>
        <ChipGroup
          label={tr('Kennzahl im Verlauf', 'Metric over time')}
          options={metrics.map(entry => ({
            value: entry.value,
            label: metricLabel(entry.value),
          }))}
          value={metric}
          onChange={next => setView({ ...active, metric: next })}
        />
        <Chart
          points={stats.buckets.map(bucket => ({
            key: bucket.startTime,
            label: bucket.label,
            fullLabel: bucket.fullLabel,
            value: bucketValue(bucket, metric),
          }))}
          title={metricLabel(metric)}
          format={value => formatMetric(metric, value)}
          shape={METRICS.find(entry => entry.value === metric)?.shape ?? 'bar'}
          selected={selected}
          onSelect={index =>
            setSelected(current => (current === index ? null : index))
          }
        />
        <BucketDetail
          bucket={selected === null ? null : stats.buckets[selected]}
          metric={metric}
        />
      </Section>

      {modules.length ? (
        <Section title={tr('Tiefer schauen', 'Explore further')}>
          {modules.includes('distribution') ? (
            <Panel
              title={tr('Verteilung', 'Distribution')}
              summary={
                stats.purposes.length
                  ? tr(
                      `${stats.purposes[0].label} führt mit ${Math.round(
                        stats.purposes[0].share * 100,
                      )} %`,
                      `${stats.purposes[0].label} leads with ${Math.round(
                        stats.purposes[0].share * 100,
                      )} %`,
                    )
                  : DASH
              }
            >
              {stats.purposes.map(share => (
                <ShareRow
                  key={share.purpose}
                  label={share.label}
                  value={`${formatKm(share.distanceKm)} km · ${Math.round(
                    share.share * 100,
                  )} %`}
                  share={share.share}
                  meta={`${share.runCount} ${runWord(share.runCount)}`}
                />
              ))}
            </Panel>
          ) : null}

          {modules.includes('records') ? (
            <Panel
              title={tr('Bestwerte', 'Personal bests')}
              summary={stats.records.length ? stats.records[0].value : DASH}
            >
              {stats.records.length ? (
                stats.records.map(record => (
                  <ValueRow
                    key={record.id}
                    label={record.label}
                    value={record.value}
                    meta={record.detail}
                    onPress={
                      onOpenRecord && record.runIds.length
                        ? () => onOpenRecord(record)
                        : undefined
                    }
                    disabled={busy}
                  />
                ))
              ) : (
                <Copy muted>
                  {tr(
                    'Für diesen Zeitraum gibt es noch keine Bestwerte.',
                    'There are no personal bests for this period yet.',
                  )}
                </Copy>
              )}
            </Panel>
          ) : null}

          {modules.includes('consistency') ? (
            <Panel
              title={tr('Konsistenz', 'Consistency')}
              summary={tr(
                `${stats.consistency.activeWeeks} von ${stats.consistency.weekCount} Wochen`,
                `${stats.consistency.activeWeeks} of ${stats.consistency.weekCount} ${weekWord(stats.consistency.weekCount)}`,
              )}
            >
              <ValueRow
                label={tr('Wochen mit Lauf', 'Weeks with a run')}
                value={`${stats.consistency.activeWeeks} / ${stats.consistency.weekCount}`}
              />
              <ValueRow
                label={tr('Aktuelle Serie', 'Current streak')}
                value={`${stats.consistency.currentStreakWeeks} ${weekWord(
                  stats.consistency.currentStreakWeeks,
                )}`}
              />
              <ValueRow
                label={tr('Längste Serie', 'Longest streak')}
                value={`${stats.consistency.longestStreakWeeks} ${weekWord(
                  stats.consistency.longestStreakWeeks,
                )}`}
              />
              <ValueRow
                label={tr('Läufe je Woche', 'Runs per week')}
                value={
                  stats.totals.runsPerWeek === null
                    ? DASH
                    : decimal(stats.totals.runsPerWeek)
                }
              />
              <ValueRow
                label={tr('Tage mit Lauf', 'Days with a run')}
                value={String(stats.consistency.activeDays)}
              />
            </Panel>
          ) : null}

          {modules.includes('body') ? (
            <Panel
              title={tr('Körperwerte', 'Body figures')}
              summary={
                stats.totals.paceSecondsPerKm === null
                  ? DASH
                  : `${formatPace(stats.totals.paceSecondsPerKm)} min / km`
              }
            >
              <ValueRow
                label={tr('Ø Tempo', 'Ø Pace')}
                value={
                  stats.totals.paceSecondsPerKm === null
                    ? DASH
                    : `${formatPace(stats.totals.paceSecondsPerKm)} min / km`
                }
                meta={tr(
                  'Nach Strecke gewichtet, Läufe ab 500 m',
                  'Weighted by distance, runs from 500 m',
                )}
              />
              <ValueRow
                label={tr('Ø Distanz je Lauf', 'Ø Distance per run')}
                value={
                  stats.totals.averageDistanceKm === null
                    ? DASH
                    : `${formatKm(stats.totals.averageDistanceKm)} km`
                }
              />
              <ValueRow
                label={tr('Beine (Median)', 'Legs (median)')}
                value={
                  stats.totals.medianLegsRpe === null
                    ? DASH
                    : `${decimal(stats.totals.medianLegsRpe)} / 10`
                }
              />
              <ValueRow
                label={tr('Atmung (Median)', 'Breathing (median)')}
                value={
                  stats.totals.medianBreathingRpe === null
                    ? DASH
                    : `${decimal(stats.totals.medianBreathingRpe)} / 10`
                }
              />
              <ValueRow
                label={tr('Ø Puls', 'Ø Heart rate')}
                value={
                  stats.totals.averageHeartRate === null
                    ? DASH
                    : `${Math.round(stats.totals.averageHeartRate)} bpm`
                }
              />
              <ValueRow
                label={tr('Ø Schrittfrequenz', 'Ø Cadence')}
                value={
                  stats.totals.averageCadence === null
                    ? DASH
                    : `${Math.round(stats.totals.averageCadence)} spm`
                }
              />
            </Panel>
          ) : null}
        </Section>
      ) : null}
    </View>
  );
}

/** What sits behind a tapped bar — shown in place, without a new view. With no
 *  selection, nothing is shown here. */
function BucketDetail({
  bucket,
  metric,
}: {
  bucket: StatsBucket | null;
  metric: StatsMetric;
}) {
  if (!bucket) {
    return null;
  }
  const highlighted = formatMetric(metric, bucketValue(bucket, metric));
  return (
    <ChartDetail
      title={bucket.fullLabel}
      value={`${metricLabel(metric)} ${highlighted.value} ${
        highlighted.unit
      }`.trim()}
      meta={[
          `${bucket.runCount} ${runWord(bucket.runCount)}`,
          `${formatKm(bucket.distanceKm)} km`,
          formatDuration(bucket.durationSeconds),
          bucket.paceSecondsPerKm === null
            ? null
            : `${formatPace(bucket.paceSecondsPerKm)} min / km`,
          bucket.effort === null
            ? null
            : `${tr('Gefühl', 'Feel')} ${decimal(bucket.effort)} / 10`,
        ]
        .filter(Boolean)
        .join(' · ')}
    />
  );
}

const styles = statsStyles;
