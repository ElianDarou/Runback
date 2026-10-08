import React, { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import {
  EXERCISE_HISTORY_VERSION,
  exerciseHistory,
  type ExerciseSessionPoint,
} from '../domain/exerciseHistory';
import { exerciseGroups, muscleGroupLabel } from '../domain/muscleGroups';
import {
  displaySessionName,
  formatWeight,
  type StrengthSession,
} from '../domain/strength';
import { setLabel } from '../domain/strengthSession';
import { dateFormat, numberFormat, tr } from '../domain/i18n';
import { exerciseDisplayName } from '../domain/catalog';
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
 * History of one exercise: direction, personal bests, a chart per session and
 * the sessions themselves. The direction ("Rising", "Stable", "Not clear yet")
 * comes from the strength trend and is only shown here, not re-evaluated.
 */

type ExerciseMetric = 'e1rm' | 'weight' | 'volume' | 'reps';

const METRICS: {
  value: ExerciseMetric;
  shape: 'bar' | 'point';
}[] = [
  { value: 'e1rm', shape: 'point' },
  { value: 'weight', shape: 'point' },
  { value: 'volume', shape: 'bar' },
  { value: 'reps', shape: 'bar' },
];

const metricLabel = (metric: ExerciseMetric) => {
  switch (metric) {
    case 'e1rm':
      return tr('Maximum', 'Maximum');
    case 'weight':
      return tr('Gewicht', 'Weight');
    case 'volume':
      return tr('Volumen', 'Volume');
    case 'reps':
      return tr('Wiederholungen', 'Reps');
  }
};

/** This many sessions fit side by side and stay readable. */
const CHART_POINTS = 16;
const VISIBLE_SESSIONS = 8;

const formatKg = (value: number) =>
  numberFormat({ maximumFractionDigits: 0 }).format(value);
const shortDay = (at: number) =>
  dateFormat({ day: '2-digit', month: '2-digit' }).format(new Date(at));
const longDay = (at: number) =>
  dateFormat({
    weekday: 'short',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(new Date(at));

const sessionWord = (count: number) =>
  tr(count === 1 ? 'Einheit' : 'Einheiten', count === 1 ? 'session' : 'sessions');
const setWord = (count: number) =>
  tr(count === 1 ? 'Satz' : 'Sätze', count === 1 ? 'set' : 'sets');

const counted = (count: number, word: (count: number) => string) =>
  `${count} ${word(count)}`;

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
      return { value: formatKg(value), unit: 'kg' };
    case 'reps':
      return {
        value: String(Math.round(value)),
        unit: tr('Wdh.', 'reps'),
      };
  }
}

function pointLine(point: ExerciseSessionPoint): string {
  const best = point.bestSet ? setLabel(point.bestSet) : '';
  return [
    counted(point.workingSets, setWord),
    best ? tr(`bester ${best}`, `best ${best}`) : null,
    point.volumeKg > 0 ? `${formatKg(point.volumeKg)} kg` : null,
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
        <Title>{exerciseDisplayName(history.exerciseId, history.name)}</Title>
        <EmptyState
          title={tr('Noch kein Satz', 'No set yet')}
          copy={tr(
            'Sobald du diese Übung abhakst, entsteht hier ihr Verlauf.',
            'As soon as you tick off this exercise, its history appears here.',
          )}
        />
      </>
    );
  }

  return (
    <>
      <Title>{exerciseDisplayName(history.exerciseId, history.name)}</Title>
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
          label={tr('Max. kg geschätzt', 'Est. max kg')}
        />
        <Stat
          value={heaviest === undefined ? DASH : formatWeight(heaviest)}
          label={tr('Schwerstes kg', 'Heaviest kg')}
        />
        <Stat
          value={String(history.points.length)}
          label={sessionWord(history.points.length)}
        />
      </View>

      {metrics.length ? (
        <Section title={tr('Verlauf', 'Trace')}>
          <ChipGroup
            label={tr('Kennzahl im Verlauf', 'Metric over time')}
            options={metrics.map(entry => ({
              value: entry.value,
              label: metricLabel(entry.value),
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
              label: shortDay(point.at),
              fullLabel: longDay(point.at),
              value: valueOf(point, metric),
            }))}
            title={metricLabel(metric)}
            format={value => formatValue(metric, value)}
            shape={METRICS.find(entry => entry.value === metric)?.shape ?? 'bar'}
            selected={selected}
            onSelect={index =>
              setSelected(current => (current === index ? null : index))
            }
          />
          {selectedPoint ? (
            <ChartDetail
              title={longDay(selectedPoint.at)}
              value={`${metricLabel(metric)} ${
                formatValue(metric, valueOf(selectedPoint, metric)).value
              } ${formatValue(metric, valueOf(selectedPoint, metric)).unit}`.trim()}
              meta={pointLine(selectedPoint)}
            />
          ) : null}
          {history.points.length > CHART_POINTS ? (
            <Copy muted>
              {tr(
                `Die letzten ${CHART_POINTS} Einheiten.`,
                `The last ${CHART_POINTS} sessions.`,
              )}
            </Copy>
          ) : null}
        </Section>
      ) : null}

      {history.records.length ? (
        <Section title={tr('Bestwerte', 'Personal bests')}>
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
                  ? `${formatKg(entry.point.volumeKg)} kg`
                  : tr(
                      `${entry.point.bestSet?.reps ?? DASH} Wdh.`,
                      `${entry.point.bestSet?.reps ?? DASH} reps`,
                    )
              }
              meta={`${
                entry.point.bestSet ? `${setLabel(entry.point.bestSet)} · ` : ''
              }${longDay(entry.point.at)}`}
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

      <Section title={tr('Einheiten', 'Sessions')}>
        {newestFirst.slice(0, VISIBLE_SESSIONS).map(point => (
          <Row
            key={point.sessionId}
            title={`${longDay(point.at)} · ${
              displaySessionName(point.sessionName) ||
              tr('Krafttraining', 'Strength training')
            }`}
            subtitle={pointLine(point)}
            onPress={onOpenSession ? () => onOpenSession(point.sessionId) : undefined}
            disabled={busy}
          />
        ))}
        {newestFirst.length > VISIBLE_SESSIONS ? (
          <Disclosure
            title={tr('Ältere Einheiten', 'Older sessions')}
            subtitle={tr(
              `${newestFirst.length - VISIBLE_SESSIONS} weitere`,
              `${newestFirst.length - VISIBLE_SESSIONS} more`,
            )}
          >
            {newestFirst.slice(VISIBLE_SESSIONS).map(point => (
              <Row
                key={point.sessionId}
                title={`${longDay(point.at)} · ${
                  displaySessionName(point.sessionName) ||
                  tr('Krafttraining', 'Strength training')
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

      <Disclosure
        title={tr('Details', 'Details')}
        subtitle={tr('Datenbasis und Versionen', 'Data basis and versions')}
      >
        <Copy muted>
          {tr(
            'Das Maximum ist eine Schätzung nach Epley aus Arbeitssätzen mit Last bis zwölf Wiederholungen, keine Messung.',
            'The maximum is an Epley estimate from working sets with a load of up to twelve reps, not a measurement.',
          )}
        </Copy>
        <Copy muted>
          {groups
            ? tr(
                `Muskelgruppen: ${groups.map(muscleGroupLabel).join(', ')}.`,
                `Muscle groups: ${groups.map(muscleGroupLabel).join(', ')}.`,
              )
            : tr(
                'Diese Übung hat keine bekannte Muskelgruppe.',
                'This exercise has no known muscle group.',
              )}
        </Copy>
        <Copy muted>
          {tr(
            `${EXERCISE_HISTORY_VERSION} · ${history.progression.model_version} · ${counted(
              history.progression.series.length,
              sessionWord,
            )} mit geeignetem Arbeitssatz`,
            `${EXERCISE_HISTORY_VERSION} · ${history.progression.model_version} · ${counted(
              history.progression.series.length,
              sessionWord,
            )} with a suitable working set`,
          )}
        </Copy>
      </Disclosure>
    </>
  );
}

const styles = StyleSheet.create({
  trend: { flexDirection: 'row' },
  metrics: { flexDirection: 'row', gap: space.sm, paddingTop: space.xs },
});
