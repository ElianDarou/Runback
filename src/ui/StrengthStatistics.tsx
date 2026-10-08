import React, { useMemo, useState } from 'react';
import { View } from 'react-native';
import type { StatsModule } from '../domain/features';
import type { StatsRange } from '../domain/statisticsView';
import { STATS_RANGES } from '../domain/statisticsView';
import {
  displaySessionName,
  isSetCompleted,
  type StrengthSession,
} from '../domain/strength';
import type { StrengthHeartSummary } from '../domain/strengthHeart';
import { setLabel } from '../domain/strengthSession';
import {
  buildStrengthStatisticsView,
  strengthBucketValue,
  type StrengthBucket,
  type StrengthExerciseStat,
  type StrengthRecord,
  type StrengthStatsMetric,
} from '../domain/strengthStatistics';
import { dateFormat, numberFormat, tr } from '../domain/i18n';
import { exerciseDisplayName } from '../domain/catalog';
import {
  Badge,
  ChipGroup,
  Copy,
  Disclosure,
  Row,
  Section,
  Segmented,
} from './components';
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
  statsStyles as styles,
} from './StatsParts';

/**
 * Statistics for the strength area, built like the running statistics: period,
 * three figures with a comparison, a trend with a selectable metric, then
 * exercises and collapsed sections. Each exercise opens its own history, each
 * personal best its session.
 */
export const STRENGTH_METRICS: {
  value: StrengthStatsMetric;
  shape: 'bar' | 'point';
}[] = [
  { value: 'sessions', shape: 'bar' },
  { value: 'sets', shape: 'bar' },
  { value: 'volume', shape: 'bar' },
  { value: 'duration', shape: 'bar' },
  { value: 'heartRate', shape: 'point' },
];

/** Metric names as shown to the user. */
const strengthMetricLabel = (metric: StrengthStatsMetric) => {
  switch (metric) {
    case 'sessions':
      return tr('Einheiten', 'Sessions');
    case 'sets':
      return tr('Sätze', 'Sets');
    case 'volume':
      return tr('Volumen', 'Volume');
    case 'duration':
      return tr('Dauer', 'Duration');
    case 'heartRate':
      return tr('Puls', 'Heart rate');
  }
};

/** Up to this many exercises are shown open; the rest sit under "All exercises". */
const VISIBLE_EXERCISES = 6;

const formatKg = (value: number) =>
  numberFormat({ maximumFractionDigits: 0 }).format(value);

const sessionWord = (count: number) =>
  tr(count === 1 ? 'Einheit' : 'Einheiten', count === 1 ? 'session' : 'sessions');
const setWord = (count: number) =>
  tr(count === 1 ? 'Satz' : 'Sätze', count === 1 ? 'set' : 'sets');
const weekWord = (count: number) =>
  tr(count === 1 ? 'Woche' : 'Wochen', count === 1 ? 'week' : 'weeks');

const counted = (count: number, word: (count: number) => string) =>
  `${count} ${word(count)}`;

function formatStrength(
  metric: StrengthStatsMetric,
  value: number | null,
): { value: string; unit: string } {
  if (value === null || !Number.isFinite(value)) {
    return { value: DASH, unit: '' };
  }
  switch (metric) {
    case 'sessions':
      return {
        value: String(Math.round(value)),
        unit: sessionWord(Math.round(value)),
      };
    case 'sets':
      return {
        value: String(Math.round(value)),
        unit: setWord(Math.round(value)),
      };
    case 'volume':
      return { value: formatKg(value), unit: 'kg' };
    case 'duration':
      return { value: formatDuration(value), unit: '' };
    case 'heartRate':
      return { value: String(Math.round(value)), unit: 'bpm' };
  }
}

const bpm = (value: number | null) =>
  value === null ? DASH : `${Math.round(value)} bpm`;

export function StrengthStatistics({
  sessions,
  heart,
  range,
  metric: storedMetric,
  onRangeChange,
  onMetricChange,
  onOpenSession,
  onOpenRecord,
  onOpenExercise,
  busy = false,
  modules,
  now,
}: {
  sessions: StrengthSession[];
  heart: Record<string, StrengthHeartSummary>;
  range: StatsRange;
  metric?: StrengthStatsMetric;
  onRangeChange: (range: StatsRange) => void;
  onMetricChange: (metric: StrengthStatsMetric) => void;
  onOpenSession?: (id: string) => void;
  onOpenRecord?: (record: StrengthRecord) => void;
  onOpenExercise?: (exerciseId: string) => void;
  busy?: boolean;
  modules: StatsModule[];
  /** Only for tests; otherwise the current time. */
  now?: number;
}) {
  const stats = useMemo(
    () => buildStrengthStatisticsView(sessions, range, now, heart),
    [sessions, range, now, heart],
  );
  const [selected, setSelected] = useState<number | null>(null);
  // A metric without data is not offered; a chosen one falls back.
  const metrics = STRENGTH_METRICS.filter(
    entry =>
      (entry.value !== 'volume' || stats.available.volume) &&
      (entry.value !== 'duration' || stats.available.duration) &&
      (entry.value !== 'heartRate' || stats.available.heartRate),
  );
  const metric = metrics.some(entry => entry.value === storedMetric)
    ? (storedMetric as StrengthStatsMetric)
    : 'sets';
  const metricLabel = strengthMetricLabel(metric);
  const { totals, consistency } = stats;
  const exercises = stats.exercises;
  const topGroup = stats.muscles.groups[0];
  const perWeek = (sets: number) =>
    stats.muscles.weekCount > 0 ? sets / stats.muscles.weekCount : null;

  return (
    <>
      <Segmented
        label={tr('Zeitraum', 'Period')}
        options={STATS_RANGES}
        value={range}
        onChange={next => {
          setSelected(null);
          onRangeChange(next);
        }}
      />

      <View style={styles.tiles}>
        <Tile
          value={String(totals.sessionCount)}
          unit=""
          label={sessionWord(totals.sessionCount)}
          delta={stats.deltas.sessions}
        />
        <Tile
          value={String(totals.sets)}
          unit=""
          label={setWord(totals.sets)}
          delta={stats.deltas.sets}
        />
        {stats.available.volume ? (
          <Tile
            value={formatKg(totals.volumeKg)}
            unit="kg"
            label={tr('Volumen', 'Volume')}
            delta={stats.deltas.volume}
          />
        ) : (
          <Tile
            value={stats.available.duration
              ? formatDuration(totals.durationSeconds) : DASH}
            unit=""
            label={tr('Zeit', 'Time')}
            delta={stats.deltas.duration}
          />
        )}
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
            label: strengthMetricLabel(entry.value),
          }))}
          value={metric}
          onChange={next => onMetricChange(next)}
        />
        <Chart
          points={stats.buckets.map(bucket => ({
            key: bucket.startTime,
            label: bucket.label,
            fullLabel: bucket.fullLabel,
            value: strengthBucketValue(bucket, metric),
          }))}
          title={metricLabel}
          format={value => formatStrength(metric, value)}
          shape={
            STRENGTH_METRICS.find(entry => entry.value === metric)?.shape ??
            'bar'
          }
          selected={selected}
          onSelect={index =>
            setSelected(current => (current === index ? null : index))
          }
        />
        <BucketDetail
          bucket={selected === null ? null : stats.buckets[selected]}
          metric={metric}
          label={metricLabel}
        />
      </Section>

      {exercises.length ? (
        <Section title={tr('Übungen', 'Exercises')}>
          {exercises.slice(0, VISIBLE_EXERCISES).map(entry => (
            <ExerciseRow
              key={entry.exerciseId}
              entry={entry}
              onPress={onOpenExercise}
              disabled={busy}
            />
          ))}
          {exercises.length > VISIBLE_EXERCISES ? (
            <Disclosure
              title={tr('Alle Übungen', 'All exercises')}
              subtitle={tr(
                `${exercises.length - VISIBLE_EXERCISES} weitere`,
                `${exercises.length - VISIBLE_EXERCISES} more`,
              )}
            >
              {exercises.slice(VISIBLE_EXERCISES).map(entry => (
                <ExerciseRow
                  key={entry.exerciseId}
                  entry={entry}
                  onPress={onOpenExercise}
                  disabled={busy}
                />
              ))}
            </Disclosure>
          ) : null}
        </Section>
      ) : null}

      {modules.length ? (
        <Section title={tr('Tiefer schauen', 'Explore further')}>
          {modules.includes('distribution') ? (
            <Panel
              title={tr('Muskeln', 'Muscles')}
              summary={
                topGroup
                  ? tr(
                      `${topGroup.label} führt mit ${topGroup.sets} ${topGroup.sets === 1 ? 'Satz' : 'Sätzen'}`,
                      `${topGroup.label} leads with ${counted(topGroup.sets, setWord)}`,
                    )
                  : DASH
              }
            >
              {stats.muscles.groups.map(group => {
                const weekly = perWeek(group.sets);
                return (
                  <ShareRow
                    key={group.group}
                    label={group.label}
                    value={counted(group.sets, setWord)}
                    share={topGroup ? group.sets / topGroup.sets : 0}
                    meta={
                      weekly === null
                        ? undefined
                        : tr(
                            `${decimal(weekly)} je Woche`,
                            `${decimal(weekly)} per week`,
                          )
                    }
                  />
                );
              })}
              {stats.muscles.unassignedSets > 0 ? (
                <Copy muted>
                  {tr(
                    `${counted(stats.muscles.unassignedSets, setWord)} ohne bekannte Muskelgruppe.`,
                    `${counted(stats.muscles.unassignedSets, setWord)} without a known muscle group.`,
                  )}
                </Copy>
              ) : null}
              {stats.muscles.groups.length ? (
                <Copy muted>
                  {tr(
                    'Ein Arbeitssatz zählt für jede Hauptgruppe der Übung.',
                    'A working set counts toward each main group of the exercise.',
                  )}
                </Copy>
              ) : (
                <Copy muted>
                  {tr(
                    'Noch keine Arbeitssätze in diesem Zeitraum.',
                    'No working sets in this period yet.',
                  )}
                </Copy>
              )}
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
                      onOpenRecord && record.sessionIds.length
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
                `${consistency.activeWeeks} von ${consistency.weekCount} Wochen`,
                `${consistency.activeWeeks} of ${counted(consistency.weekCount, weekWord)}`,
              )}
            >
              <ValueRow
                label={tr('Wochen mit Krafttraining', 'Weeks with strength training')}
                value={`${consistency.activeWeeks} / ${consistency.weekCount}`}
              />
              <ValueRow
                label={tr('Aktuelle Serie', 'Current streak')}
                value={counted(consistency.currentStreakWeeks, weekWord)}
              />
              <ValueRow
                label={tr('Längste Serie', 'Longest streak')}
                value={counted(consistency.longestStreakWeeks, weekWord)}
              />
              <ValueRow
                label={tr('Einheiten je Woche', 'Sessions per week')}
                value={
                  totals.sessionsPerWeek === null
                    ? DASH
                    : decimal(totals.sessionsPerWeek)
                }
              />
              <ValueRow
                label={tr('Tage mit Krafttraining', 'Days with strength training')}
                value={String(consistency.activeDays)}
              />
            </Panel>
          ) : null}

          {modules.includes('body') ? (
            <Panel
              title={tr('Körperwerte', 'Body figures')}
              summary={
                totals.averageBpm === null
                  ? totals.medianRir === null
                    ? DASH
                    : tr(
                        `${decimal(totals.medianRir)} im Tank`,
                        `${decimal(totals.medianRir)} in reserve`,
                      )
                  : `Ø ${bpm(totals.averageBpm)}`
              }
            >
              <ValueRow
                label={tr('Ø Puls', 'Ø Heart rate')}
                value={bpm(totals.averageBpm)}
                meta={
                  totals.heartSessions
                    ? tr(
                        `Von der Uhr · ${totals.heartSessions} von ${counted(
                          totals.sessionCount,
                          sessionWord,
                        )}`,
                        `From the watch · ${totals.heartSessions} of ${counted(
                          totals.sessionCount,
                          sessionWord,
                        )}`,
                      )
                    : tr(
                        'Mit Uhr gemessen; ohne Uhr bleibt er offen',
                        'Measured with the watch; without it, this stays open',
                      )
                }
              />
              <ValueRow
                label={tr('Höchster Puls', 'Highest heart rate')}
                value={bpm(totals.maxBpm)}
              />
              <ValueRow
                label={tr('Wiederholungen im Tank', 'Reps in reserve')}
                value={
                  totals.medianRir === null ? DASH : decimal(totals.medianRir)
                }
                meta={
                  totals.rirSets
                    ? tr(
                        `Median aus ${totals.rirSets} ${totals.rirSets === 1 ? 'Satz' : 'Sätzen'}`,
                        `Median of ${counted(totals.rirSets, setWord)}`,
                      )
                    : undefined
                }
              />
              <ValueRow
                label={tr('Satzabstand', 'Set interval')}
                value={
                  totals.medianSetGapSeconds === null
                    ? DASH
                    : formatClock(totals.medianSetGapSeconds)
                }
                meta={tr(
                  'Median · Abhaken bis Abhaken, Pause und Satz',
                  'Median · from tick to tick, including rest and set',
                )}
              />
              <ValueRow
                label={tr('Ø Dauer je Einheit', 'Ø Duration per session')}
                value={
                  totals.averageDurationSeconds === null
                    ? DASH
                    : formatDuration(totals.averageDurationSeconds)
                }
              />
              <ValueRow
                label={tr('Sätze je Einheit', 'Sets per session')}
                value={
                  totals.setsPerSession === null
                    ? DASH
                    : decimal(totals.setsPerSession)
                }
              />
            </Panel>
          ) : null}
        </Section>
      ) : null}

      {onOpenSession && stats.sessions.length ? (
        <Section title={tr('Letzte Einheiten', 'Recent sessions')}>
          {[...stats.sessions]
            .reverse()
            .slice(0, 3)
            .map(session => (
              <Row
                key={session.id}
                title={displaySessionName(session.name) || tr('Krafttraining', 'Strength training')}
                subtitle={sessionLine(session, heart[session.id])}
                onPress={() => onOpenSession(session.id)}
                disabled={busy}
              />
            ))}
        </Section>
      ) : null}
    </>
  );
}

/** "2:45" for set intervals. */
export function formatClock(seconds: number): string {
  const whole = Math.max(0, Math.round(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}

function sessionLine(
  session: StrengthSession,
  heart: StrengthHeartSummary | undefined,
): string {
  const sets = session.exercises.reduce(
    (sum, exercise) =>
      sum +
      exercise.sets.filter(set => isSetCompleted(set) && !set.skipped)
        .length,
    0,
  );
  return [
    dateFormat({ weekday: 'short', day: '2-digit', month: '2-digit' }).format(
      new Date(session.startTime),
    ),
    counted(sets, setWord),
    heart ? `Ø ${Math.round(heart.averageBpm)} bpm` : null,
  ]
    .filter(Boolean)
    .join(' · ');
}

function ExerciseRow({
  entry,
  onPress,
  disabled,
}: {
  entry: StrengthExerciseStat;
  onPress?: (exerciseId: string) => void;
  disabled: boolean;
}) {
  const best = entry.best ? setLabel(entry.best) : '';
  return (
    <Row
      title={exerciseDisplayName(entry.exerciseId, entry.name)}
      subtitle={[
        counted(entry.workingSets, setWord),
        best ? tr(`bester Satz ${best}`, `best set ${best}`) : null,
      ]
        .filter(Boolean)
        .join(' · ')}
      trailing={
        <Badge muted={entry.trend.verdict !== 'increase'}>
          {entry.trend.label}
        </Badge>
      }
      onPress={onPress ? () => onPress(entry.exerciseId) : undefined}
      disabled={disabled}
    />
  );
}

function BucketDetail({
  bucket,
  metric,
  label,
}: {
  bucket: StrengthBucket | null;
  metric: StrengthStatsMetric;
  label: string;
}) {
  if (!bucket) {
    return null;
  }
  const highlighted = formatStrength(metric, strengthBucketValue(bucket, metric));
  return (
    <ChartDetail
      title={bucket.fullLabel}
      value={`${label} ${highlighted.value} ${highlighted.unit}`.trim()}
      meta={[
        counted(bucket.sessionCount, sessionWord),
        counted(bucket.sets, setWord),
        bucket.volumeKg !== null && bucket.volumeKg > 0
          ? `${formatKg(bucket.volumeKg)} kg` : null,
        bucket.durationSeconds !== null && bucket.durationSeconds > 0
          ? formatDuration(bucket.durationSeconds)
          : null,
        bucket.averageBpm === null ? null : `Ø ${bpm(bucket.averageBpm)}`,
      ]
        .filter(Boolean)
        .join(' · ')}
    />
  );
}
