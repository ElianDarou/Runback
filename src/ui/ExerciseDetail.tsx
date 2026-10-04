import React, { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import {
  EXERCISE_HISTORY_VERSION,
  exerciseHistory,
  type ExerciseSessionPoint,
} from '../domain/exerciseHistory';
import { exerciseGroups, muscleGroupLabel } from '../domain/muscleGroups';
import { formatWeight, type StrengthSession } from '../domain/strength';
import { setLabel } from '../domain/strengthSession';
import {
  Badge,
  ChipGroup,
  Copy,
  Disclosure,
  EmptyState,
  Row,
  Section,
  Stat,
  Title,
  space,
} from './components';
import { Chart, ChartDetail, DASH, ValueRow } from './StatsParts';

/**
 * Verlauf einer Übung: Richtung, Bestwerte, ein Diagramm je Einheit und die
 * Einheiten selbst. Die Richtung („Steigt“, „Stabil“, „Noch nicht klar“)
 * stammt aus dem Kraftverlauf und wird hier nur gezeigt, nicht neu bewertet.
 */

type ExerciseMetric = 'e1rm' | 'weight' | 'volume' | 'reps';

const METRICS: {
  value: ExerciseMetric;
  label: string;
  shape: 'bar' | 'point';
}[] = [
  { value: 'e1rm', label: 'Maximum', shape: 'point' },
  { value: 'weight', label: 'Gewicht', shape: 'point' },
  { value: 'volume', label: 'Volumen', shape: 'bar' },
  { value: 'reps', label: 'Wiederholungen', shape: 'bar' },
];

/** So viele Einheiten passen lesbar nebeneinander. */
const CHART_POINTS = 16;
const VISIBLE_SESSIONS = 8;

const kilograms = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 0 });
const dayFormat = new Intl.DateTimeFormat('de-DE', {
  day: '2-digit',
  month: '2-digit',
});
const dayLongFormat = new Intl.DateTimeFormat('de-DE', {
  weekday: 'short',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
});

const counted = (count: number, singular: string, plural: string) =>
  `${count} ${count === 1 ? singular : plural}`;

function valueOf(
  point: ExerciseSessionPoint,
  metric: ExerciseMetric,
): number | null {
  switch (metric) {
    case 'e1rm':
      return point.bestSet?.e1rm ?? null;
    case 'weight':
      return point.topWeightKg ?? null;
    case 'volume':
      return point.volumeKg > 0 ? point.volumeKg : null;
    case 'reps':
      return point.totalReps > 0 ? point.totalReps : null;
  }
}

function formatValue(metric: ExerciseMetric, value: number | null) {
  if (value === null || !Number.isFinite(value)) {
    return { value: DASH, unit: '' };
  }
  switch (metric) {
    case 'e1rm':
    case 'weight':
      return { value: formatWeight(Math.round(value * 2) / 2), unit: 'kg' };
    case 'volume':
      return { value: kilograms.format(value), unit: 'kg' };
    case 'reps':
      return { value: String(Math.round(value)), unit: 'Wdh.' };
  }
}

function pointLine(point: ExerciseSessionPoint): string {
  const best = point.bestSet ? setLabel(point.bestSet) : '';
  return [
    counted(point.workingSets, 'Satz', 'Sätze'),
    best ? `bester ${best}` : null,
    point.volumeKg > 0 ? `${kilograms.format(point.volumeKg)} kg` : null,
  ]
    .filter(Boolean)
    .join(' · ');
}

export function ExerciseDetail({
  exerciseId,
  sessions,
  onOpenSession,
  busy = false,
}: {
  exerciseId: string;
  sessions: StrengthSession[];
  onOpenSession?: (id: string) => void;
  busy?: boolean;
}) {
  const history = useMemo(
    () => exerciseHistory(sessions, exerciseId),
    [sessions, exerciseId],
  );
  const [metricChoice, setMetric] = useState<ExerciseMetric>('e1rm');
  const [selected, setSelected] = useState<number | null>(null);
  const metrics = METRICS.filter(entry =>
    history.points.some(point => valueOf(point, entry.value) !== null),
  );
  const metric = metrics.some(entry => entry.value === metricChoice)
    ? metricChoice
    : metrics[0]?.value ?? 'reps';
  const recent = history.points.slice(-CHART_POINTS);
  const groups = exerciseGroups(exerciseId, history.name);
  const record = (id: string) =>
    history.records.find(entry => entry.id === id)?.point;
  const bestE1RM = record('e1rm')?.bestSet?.e1rm;
  const heaviest = record('weight')?.topWeightKg;
  const newestFirst = [...history.points].reverse();
  const selectedPoint = selected === null ? null : recent[selected];

  if (!history.points.length) {
    return (
      <>
        <Title>{history.name}</Title>
        <EmptyState
          title="Noch kein Satz"
          copy="Sobald du diese Übung abhakst, entsteht hier ihr Verlauf."
        />
      </>
    );
  }

  return (
    <>
      <Title>{history.name}</Title>
      <View style={styles.trend}>
        <Badge muted={history.trend.verdict !== 'increase'}>
          {history.trend.label}
        </Badge>
      </View>
      <Copy muted>{history.trend.reason}</Copy>
      <View style={styles.metrics}>
        <Stat
          value={
            bestE1RM === undefined
              ? DASH
              : formatWeight(Math.round(bestE1RM * 2) / 2)
          }
          label="Max. kg geschätzt"
        />
        <Stat
          value={heaviest === undefined ? DASH : formatWeight(heaviest)}
          label="Schwerstes kg"
        />
        <Stat
          value={String(history.points.length)}
          label={history.points.length === 1 ? 'Einheit' : 'Einheiten'}
        />
      </View>

      {metrics.length ? (
        <Section title="Verlauf">
          <ChipGroup
            label="Kennzahl im Verlauf"
            options={metrics.map(entry => ({
              value: entry.value,
              label: entry.label,
            }))}
            value={metric}
            onChange={next => {
              setSelected(null);
              setMetric(next);
            }}
          />
          <Chart
            points={recent.map(point => ({
              key: point.at,
              label: dayFormat.format(new Date(point.at)),
              fullLabel: dayLongFormat.format(new Date(point.at)),
              value: valueOf(point, metric),
            }))}
            title={METRICS.find(entry => entry.value === metric)?.label ?? ''}
            format={value => formatValue(metric, value)}
            shape={METRICS.find(entry => entry.value === metric)?.shape ?? 'bar'}
            selected={selected}
            onSelect={index =>
              setSelected(current => (current === index ? null : index))
            }
          />
          {selectedPoint ? (
            <ChartDetail
              title={dayLongFormat.format(new Date(selectedPoint.at))}
              value={`${
                METRICS.find(entry => entry.value === metric)?.label ?? ''
              } ${formatValue(metric, valueOf(selectedPoint, metric)).value} ${
                formatValue(metric, valueOf(selectedPoint, metric)).unit
              }`.trim()}
              meta={pointLine(selectedPoint)}
            />
          ) : null}
          {history.points.length > CHART_POINTS ? (
            <Copy muted>{`Die letzten ${CHART_POINTS} Einheiten.`}</Copy>
          ) : null}
        </Section>
      ) : null}

      {history.records.length ? (
        <Section title="Bestwerte">
          {history.records.map(entry => (
            <ValueRow
              key={entry.id}
              label={entry.label}
              value={
                entry.id === 'e1rm'
                  ? `${formatValue('e1rm', entry.point.bestSet?.e1rm ?? null).value} kg`
                  : entry.id === 'weight'
                  ? `${formatWeight(entry.point.topWeightKg ?? 0)} kg`
                  : entry.id === 'volume'
                  ? `${kilograms.format(entry.point.volumeKg)} kg`
                  : `${entry.point.bestSet?.reps ?? DASH} Wdh.`
              }
              meta={`${
                entry.point.bestSet ? `${setLabel(entry.point.bestSet)} · ` : ''
              }${dayLongFormat.format(new Date(entry.point.at))}`}
              onPress={
                onOpenSession
                  ? () => onOpenSession(entry.point.sessionId)
                  : undefined
              }
              disabled={busy}
            />
          ))}
        </Section>
      ) : null}

      <Section title="Einheiten">
        {newestFirst.slice(0, VISIBLE_SESSIONS).map(point => (
          <Row
            key={point.sessionId}
            title={`${dayLongFormat.format(new Date(point.at))} · ${
              point.sessionName || 'Krafttraining'
            }`}
            subtitle={pointLine(point)}
            onPress={onOpenSession ? () => onOpenSession(point.sessionId) : undefined}
            disabled={busy}
          />
        ))}
        {newestFirst.length > VISIBLE_SESSIONS ? (
          <Disclosure
            title="Ältere Einheiten"
            subtitle={`${newestFirst.length - VISIBLE_SESSIONS} weitere`}
          >
            {newestFirst.slice(VISIBLE_SESSIONS).map(point => (
              <Row
                key={point.sessionId}
                title={`${dayLongFormat.format(new Date(point.at))} · ${
                  point.sessionName || 'Krafttraining'
                }`}
                subtitle={pointLine(point)}
                onPress={
                  onOpenSession ? () => onOpenSession(point.sessionId) : undefined
                }
                disabled={busy}
              />
            ))}
          </Disclosure>
        ) : null}
      </Section>

      <Disclosure title="Details" subtitle="Datenbasis und Versionen">
        <Copy muted>
          Das Maximum ist eine Schätzung nach Epley aus Arbeitssätzen mit Last
          bis zwölf Wiederholungen, keine Messung.
        </Copy>
        <Copy muted>
          {groups
            ? `Muskelgruppen: ${groups.map(muscleGroupLabel).join(', ')}.`
            : 'Diese Übung hat keine bekannte Muskelgruppe.'}
        </Copy>
        <Copy muted>
          {`${EXERCISE_HISTORY_VERSION} · ${history.progression.model_version} · ${counted(
            history.progression.series.length,
            'Einheit',
            'Einheiten',
          )} mit geeignetem Arbeitssatz`}
        </Copy>
      </Disclosure>
    </>
  );
}

const styles = StyleSheet.create({
  trend: { flexDirection: 'row' },
  metrics: { flexDirection: 'row', gap: space.sm, paddingTop: space.xs },
});
