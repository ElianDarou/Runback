import React, { useMemo, useState } from 'react';
import { View } from 'react-native';
import type { StatsModule } from '../domain/features';
import type { StatsRange } from '../domain/statisticsView';
import { STATS_RANGES } from '../domain/statisticsView';
import { isSetCompleted, type StrengthSession } from '../domain/strength';
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
 * Statistik im Bereich Krafttraining, gebaut wie die Laufstatistik: Zeitraum,
 * drei Kennzahlen mit Vergleich, ein Verlauf mit wählbarer Kennzahl, darunter
 * Übungen und eingeklappte Abschnitte. Jede Übung öffnet ihren eigenen
 * Verlauf, jeder Bestwert seine Einheit.
 */
export const STRENGTH_METRICS: {
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

/** Bis hierhin stehen Übungen offen da, der Rest unter „Alle Übungen“. */
const VISIBLE_EXERCISES = 6;

const kilograms = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 0 });

const counted = (count: number, singular: string, plural: string) =>
  `${count} ${count === 1 ? singular : plural}`;

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
  /** Nur für Tests; sonst die aktuelle Zeit. */
  now?: number;
}) {
  const stats = useMemo(
    () => buildStrengthStatisticsView(sessions, range, now, heart),
    [sessions, range, now, heart],
  );
  const [selected, setSelected] = useState<number | null>(null);
  // Eine Kennzahl ohne Daten wird nicht angeboten; eine gewählte fällt zurück.
  const metrics = STRENGTH_METRICS.filter(
    entry =>
      (entry.value !== 'volume' || stats.available.volume) &&
      (entry.value !== 'duration' || stats.available.duration) &&
      (entry.value !== 'heartRate' || stats.available.heartRate),
  );
  const metric = metrics.some(entry => entry.value === storedMetric)
    ? (storedMetric as StrengthStatsMetric)
    : 'sets';
  const metricLabel =
    STRENGTH_METRICS.find(entry => entry.value === metric)?.label ?? '';
  const { totals, consistency } = stats;
  const exercises = stats.exercises;
  const topGroup = stats.muscles.groups[0];
  const perWeek = (sets: number) =>
    stats.muscles.weekCount > 0 ? sets / stats.muscles.weekCount : null;

  return (
    <>
      <Segmented
        label="Zeitraum"
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
          label={totals.sessionCount === 1 ? 'Einheit' : 'Einheiten'}
          delta={stats.deltas.sessions}
        />
        <Tile
          value={String(totals.sets)}
          unit=""
          label={totals.sets === 1 ? 'Satz' : 'Sätze'}
          delta={stats.deltas.sets}
        />
        {stats.available.volume ? (
          <Tile
            value={kilograms.format(totals.volumeKg)}
            unit="kg"
            label="Volumen"
            delta={stats.deltas.volume}
          />
        ) : (
          <Tile
            value={stats.available.duration
              ? formatDuration(totals.durationSeconds) : DASH}
            unit=""
            label="Zeit"
            delta={stats.deltas.duration}
          />
        )}
      </View>
      {stats.comparisonLabel ? (
        <Copy muted style={styles.compare}>
          {`Pfeile vergleichen mit ${stats.comparisonLabel}.`}
        </Copy>
      ) : null}

      <Section title="Zeitverlauf">
        <ChipGroup
          label="Kennzahl im Verlauf"
          options={metrics.map(entry => ({
            value: entry.value,
            label: entry.label,
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
        <Section title="Übungen">
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
              title="Alle Übungen"
              subtitle={`${exercises.length - VISIBLE_EXERCISES} weitere`}
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
        <Section title="Tiefer schauen">
          {modules.includes('distribution') ? (
            <Panel
              title="Muskeln"
              summary={
                topGroup
                  ? `${topGroup.label} führt mit ${counted(
                      topGroup.sets,
                      'Satz',
                      'Sätzen',
                    )}`
                  : DASH
              }
            >
              {stats.muscles.groups.map(group => {
                const weekly = perWeek(group.sets);
                return (
                  <ShareRow
                    key={group.group}
                    label={group.label}
                    value={counted(group.sets, 'Satz', 'Sätze')}
                    share={topGroup ? group.sets / topGroup.sets : 0}
                    meta={
                      weekly === null ? undefined : `${decimal(weekly)} je Woche`
                    }
                  />
                );
              })}
              {stats.muscles.unassignedSets > 0 ? (
                <Copy muted>
                  {`${counted(
                    stats.muscles.unassignedSets,
                    'Satz',
                    'Sätze',
                  )} ohne bekannte Muskelgruppe.`}
                </Copy>
              ) : null}
              {stats.muscles.groups.length ? (
                <Copy muted>
                  Ein Arbeitssatz zählt für jede Hauptgruppe der Übung.
                </Copy>
              ) : (
                <Copy muted>Noch keine Arbeitssätze in diesem Zeitraum.</Copy>
              )}
            </Panel>
          ) : null}

          {modules.includes('records') ? (
            <Panel
              title="Bestwerte"
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
                  Für diesen Zeitraum gibt es noch keine Bestwerte.
                </Copy>
              )}
            </Panel>
          ) : null}

          {modules.includes('consistency') ? (
            <Panel
              title="Konsistenz"
              summary={`${consistency.activeWeeks} von ${consistency.weekCount} Wochen`}
            >
              <ValueRow
                label="Wochen mit Krafttraining"
                value={`${consistency.activeWeeks} / ${consistency.weekCount}`}
              />
              <ValueRow
                label="Aktuelle Serie"
                value={counted(consistency.currentStreakWeeks, 'Woche', 'Wochen')}
              />
              <ValueRow
                label="Längste Serie"
                value={counted(consistency.longestStreakWeeks, 'Woche', 'Wochen')}
              />
              <ValueRow
                label="Einheiten je Woche"
                value={
                  totals.sessionsPerWeek === null
                    ? DASH
                    : decimal(totals.sessionsPerWeek)
                }
              />
              <ValueRow
                label="Tage mit Krafttraining"
                value={String(consistency.activeDays)}
              />
            </Panel>
          ) : null}

          {modules.includes('body') ? (
            <Panel
              title="Körperwerte"
              summary={
                totals.averageBpm === null
                  ? totals.medianRir === null
                    ? DASH
                    : `${decimal(totals.medianRir)} im Tank`
                  : `Ø ${bpm(totals.averageBpm)}`
              }
            >
              <ValueRow
                label="Ø Puls"
                value={bpm(totals.averageBpm)}
                meta={
                  totals.heartSessions
                    ? `Von der Uhr · ${totals.heartSessions} von ${counted(
                        totals.sessionCount,
                        'Einheit',
                        'Einheiten',
                      )}`
                    : 'Mit Uhr gemessen; ohne Uhr bleibt er offen'
                }
              />
              <ValueRow label="Höchster Puls" value={bpm(totals.maxBpm)} />
              <ValueRow
                label="Wiederholungen im Tank"
                value={
                  totals.medianRir === null ? DASH : decimal(totals.medianRir)
                }
                meta={
                  totals.rirSets
                    ? `Median aus ${counted(totals.rirSets, 'Satz', 'Sätzen')}`
                    : undefined
                }
              />
              <ValueRow
                label="Satzabstand"
                value={
                  totals.medianSetGapSeconds === null
                    ? DASH
                    : formatClock(totals.medianSetGapSeconds)
                }
                meta="Median · Abhaken bis Abhaken, Pause und Satz"
              />
              <ValueRow
                label="Ø Dauer je Einheit"
                value={
                  totals.averageDurationSeconds === null
                    ? DASH
                    : formatDuration(totals.averageDurationSeconds)
                }
              />
              <ValueRow
                label="Sätze je Einheit"
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
        <Section title="Letzte Einheiten">
          {[...stats.sessions]
            .reverse()
            .slice(0, 3)
            .map(session => (
              <Row
                key={session.id}
                title={session.name || 'Krafttraining'}
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

/** „2:45“ für Satzabstände. */
export function formatClock(seconds: number): string {
  const whole = Math.max(0, Math.round(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}

const dayFormat = new Intl.DateTimeFormat('de-DE', {
  weekday: 'short',
  day: '2-digit',
  month: '2-digit',
});

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
    dayFormat.format(new Date(session.startTime)),
    counted(sets, 'Satz', 'Sätze'),
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
      title={entry.name}
      subtitle={[
        counted(entry.workingSets, 'Satz', 'Sätze'),
        best ? `bester Satz ${best}` : null,
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
        counted(bucket.sessionCount, 'Einheit', 'Einheiten'),
        counted(bucket.sets, 'Satz', 'Sätze'),
        bucket.volumeKg !== null && bucket.volumeKg > 0
          ? `${kilograms.format(bucket.volumeKg)} kg` : null,
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
