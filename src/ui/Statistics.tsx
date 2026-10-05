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
 * Statistik in drei Tiefen:
 *
 * 1. Kopf — Zeitraum wählen, drei Kennzahlen mit Vergleich zum Zeitraum davor.
 * 2. Verlauf — ein Diagramm, dessen Kennzahl der Nutzer wählt; jeder Balken
 *    ist antippbar und öffnet seine Werte an Ort und Stelle.
 * 3. Abschnitte — Verteilung, Bestwerte, Konsistenz, Körperwerte; eingeklappt,
 *    bis jemand sie sehen will.
 *
 * Die Zeitraumauswahl steht über allem und gilt für alles darunter. Es gibt
 * keine zweite Auswahl, die nur einen Abschnitt betrifft.
 *
 * Laufen und Krafttraining sind getrennte Bereiche: Haben beide Daten, wählt
 * ein `Segmented` oben den Bereich, der Zeitraum gilt für beide. Verrechnet
 * wird nichts — Kilometer und Sätze sind keine gemeinsame Größe.
 */

export interface StatisticsView {
  range: StatsRange;
  metric: StatsMetric;
  /** Zuletzt gewählter Bereich; zählt nur, wenn beide Bereiche Daten haben. */
  area?: Area;
  strengthMetric?: StrengthStatsMetric;
}

export const defaultStatisticsView: StatisticsView = {
  range: '12w',
  metric: 'distance',
};

/** Die Einstellungen kommen als ungeprüftes JSON aus dem nativen Speicher.
 *  Unbekanntes fällt auf die Voreinstellung zurück, statt die Seite zu leeren. */
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

const AREAS: { value: Area; label: string }[] = [
  { value: 'running', label: 'Laufen' },
  { value: 'strength', label: 'Krafttraining' },
];

const METRICS: {
  value: StatsMetric;
  label: string;
  /** Kennzahlen ohne sinnvollen Nullpunkt werden als Punkte gezeigt. */
  shape: 'bar' | 'point';
}[] = [
  { value: 'distance', label: 'Distanz', shape: 'bar' },
  { value: 'duration', label: 'Dauer', shape: 'bar' },
  { value: 'count', label: 'Läufe', shape: 'bar' },
  { value: 'pace', label: 'Tempo', shape: 'point' },
  { value: 'effort', label: 'Gefühl', shape: 'point' },
];

const formatKm = (value: number) => `${decimal(value, value >= 100 ? 0 : 1)}`;


const formatPace = (seconds: number | null) => {
  if (seconds === null || !Number.isFinite(seconds)) {
    return DASH;
  }
  const whole = Math.max(0, Math.round(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
};

/** Ein Wert samt Einheit — die einzige Stelle, an der eine Kennzahl in Text
 *  übersetzt wird. Sie wird für Kacheln, Achse und Detailzeile benutzt. */
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
        unit: value === 1 ? 'Lauf' : 'Läufe',
      };
    case 'pace':
      return { value: formatPace(value), unit: 'min / km' };
    case 'effort':
      return { value: decimal(value), unit: '/ 10' };
  }
}

const metricLabel = (metric: StatsMetric) =>
  METRICS.find(entry => entry.value === metric)?.label ?? '';

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
  /** Abgeschlossene Krafteinheiten. Ohne sie gibt es den Bereich hier nicht. */
  sessions?: StrengthSession[];
  /** Puls der Krafteinheiten von der Uhr, nach Einheit. */
  heart?: Record<string, StrengthHeartSummary>;
  /** Zuletzt gewählter Zeitraum und Kennzahl. */
  view?: StatisticsView;
  onViewChange?: (view: StatisticsView) => void;
  onOpenRecord?: (record: StatsRecord) => void;
  onOpenSession?: (id: string) => void;
  onOpenStrengthRecord?: (record: StrengthRecord) => void;
  onOpenExercise?: (exerciseId: string) => void;
  busy?: boolean;
  /** Als Teil einer Seite, die den Titel schon trägt (Verlauf). */
  embedded?: boolean;
  /** Blöcke unter „Tiefer schauen“, die der Nutzer sehen will. */
  modules?: StatsModule[];
  /** Abgeschaltete Bereiche zeigen hier nichts — auch keinen Leerzustand. */
  showRunning?: boolean;
  showStrength?: boolean;
}) {
  const [localView, setLocalView] = useState(view);
  // Ohne Speicher von außen bleibt die Auswahl wenigstens für diese Sitzung.
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
  // Eine Kennzahl, für die es keine Daten gibt, wird nicht angeboten — und
  // eine bereits gewählte fällt auf die Distanz zurück.
  const metrics = METRICS.filter(
    entry =>
      (entry.value !== 'pace' || stats.available.pace) &&
      (entry.value !== 'effort' || stats.available.effort),
  );
  const metric = metrics.some(entry => entry.value === active.metric)
    ? active.metric
    : 'distance';

  // Ein Bereich, der abgewählt ist oder keine Daten hat, erscheint nicht —
  // auch nicht als Leerzustand neben dem anderen.
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
      Statistik
    </Text>
  );
  const areaPicker =
    hasRunning && hasStrength ? (
      <Segmented
        label="Bereich"
        options={AREAS}
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
            title="Noch keine Krafteinheit"
            copy="Sobald ein Training abgeschlossen oder importiert ist, stehen hier Einheiten, Sätze, Muskeln und Übungen."
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
          title="Noch keine Läufe"
          copy="Sobald ein Lauf abgeschlossen oder importiert ist, entsteht hier deine Entwicklung."
        />
      </View>
    );
  }

  return (
    <View style={styles.page}>
      {title}
      {areaPicker}

      <Segmented
        label="Zeitraum"
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
          label="Distanz"
          delta={stats.deltas.distance}
        />
        <Tile
          value={String(stats.totals.runCount)}
          unit=""
          label={stats.totals.runCount === 1 ? 'Lauf' : 'Läufe'}
          delta={stats.deltas.count}
        />
        <Tile
          value={formatDuration(stats.totals.durationSeconds)}
          unit=""
          label="Zeit"
          delta={stats.deltas.duration}
        />
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
        <Section title="Tiefer schauen">
          {modules.includes('distribution') ? (
            <Panel
              title="Verteilung"
              summary={
                stats.purposes.length
                  ? `${stats.purposes[0].label} führt mit ${Math.round(
                      stats.purposes[0].share * 100,
                    )} %`
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
                  meta={`${share.runCount} ${
                    share.runCount === 1 ? 'Lauf' : 'Läufe'
                  }`}
                />
              ))}
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
                      onOpenRecord && record.runIds.length
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
              summary={`${stats.consistency.activeWeeks} von ${stats.consistency.weekCount} Wochen`}
            >
              <ValueRow
                label="Wochen mit Lauf"
                value={`${stats.consistency.activeWeeks} / ${stats.consistency.weekCount}`}
              />
              <ValueRow
                label="Aktuelle Serie"
                value={`${stats.consistency.currentStreakWeeks} ${
                  stats.consistency.currentStreakWeeks === 1
                    ? 'Woche'
                    : 'Wochen'
                }`}
              />
              <ValueRow
                label="Längste Serie"
                value={`${stats.consistency.longestStreakWeeks} ${
                  stats.consistency.longestStreakWeeks === 1
                    ? 'Woche'
                    : 'Wochen'
                }`}
              />
              <ValueRow
                label="Läufe je Woche"
                value={
                  stats.totals.runsPerWeek === null
                    ? DASH
                    : decimal(stats.totals.runsPerWeek)
                }
              />
              <ValueRow
                label="Tage mit Lauf"
                value={String(stats.consistency.activeDays)}
              />
            </Panel>
          ) : null}

          {modules.includes('body') ? (
            <Panel
              title="Körperwerte"
              summary={
                stats.totals.paceSecondsPerKm === null
                  ? DASH
                  : `${formatPace(stats.totals.paceSecondsPerKm)} min / km`
              }
            >
              <ValueRow
                label="Ø Tempo"
                value={
                  stats.totals.paceSecondsPerKm === null
                    ? DASH
                    : `${formatPace(stats.totals.paceSecondsPerKm)} min / km`
                }
                meta="Nach Strecke gewichtet, Läufe ab 500 m"
              />
              <ValueRow
                label="Ø Distanz je Lauf"
                value={
                  stats.totals.averageDistanceKm === null
                    ? DASH
                    : `${formatKm(stats.totals.averageDistanceKm)} km`
                }
              />
              <ValueRow
                label="Beine (Median)"
                value={
                  stats.totals.medianLegsRpe === null
                    ? DASH
                    : `${decimal(stats.totals.medianLegsRpe)} / 10`
                }
              />
              <ValueRow
                label="Atmung (Median)"
                value={
                  stats.totals.medianBreathingRpe === null
                    ? DASH
                    : `${decimal(stats.totals.medianBreathingRpe)} / 10`
                }
              />
              <ValueRow
                label="Ø Puls"
                value={
                  stats.totals.averageHeartRate === null
                    ? DASH
                    : `${Math.round(stats.totals.averageHeartRate)} bpm`
                }
              />
              <ValueRow
                label="Ø Schrittfrequenz"
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

/** Was hinter einem angetippten Balken steckt — an Ort und Stelle, ohne
 *  neue Ansicht. Ohne Auswahl steht hier der Hinweis, dass es etwas gibt. */
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
          `${bucket.runCount} ${bucket.runCount === 1 ? 'Lauf' : 'Läufe'}`,
          `${formatKm(bucket.distanceKm)} km`,
          formatDuration(bucket.durationSeconds),
          bucket.paceSecondsPerKm === null
            ? null
            : `${formatPace(bucket.paceSecondsPerKm)} min / km`,
          bucket.effort === null
            ? null
            : `Gefühl ${decimal(bucket.effort)} / 10`,
        ]
        .filter(Boolean)
        .join(' · ')}
    />
  );
}

const styles = statsStyles;
