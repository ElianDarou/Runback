import React, { useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Line, Text as SvgText } from 'react-native-svg';
import type { PacingAnalysis, RunSummary } from '../domain/types';
import {
  compassLabel,
  formatElapsed,
  formatKm,
  formatPace,
  type RunSeries,
} from '../domain/runSeries';
import {
  driftVerdictLabel,
  endRecovery,
  environmentCost,
  evennessLabel,
  fatiguePattern,
  formatSignedNumber,
  formatSignedPercent,
  formatSignedSeconds,
  gradeAdjustedPace,
  heartRateDrift,
  heartRatePaceCurve,
  heartRateZones,
  maxHeartRate,
  metersPerBeat,
  movementInsight,
  pacingVerdict,
  recentComparison,
  sameRouteComparison,
  timeBudgetShares,
  walkRecovery,
  weatherInsight,
  type ComparedMetric,
  type MetricComparison,
  type RecentComparison,
} from '../domain/insights';
import { gaitInsight, type GaitLine } from '../domain/gait';
import { fixed, percentSign, tr } from '../domain/i18n';
import {
  Copy,
  Disclosure,
  Input,
  Notice,
  Row,
  Section,
  StackedBar,
  color,
  space,
  toneColor,
  type,
  type StatTone,
} from './components';

/**
 * Deeper insights on a run's detail page. Each section shows only what the
 * data supports: no time budget, no movement; no heart rate, no zones; fewer
 * than three comparison runs, no comparison. Nothing here is a recommendation —
 * that stays with "Next step".
 */
export interface RunInsightsProps {
  run: RunSummary;
  series: RunSeries | null;
  history: RunSummary[];
  pacing?: PacingAnalysis;
  /** Max heart rate set by the user; if missing, Runback estimates it from recent runs. */
  maxHeartRateSetting?: number;
  onMaxHeartRate?: (value: number | undefined) => void;
}

const formatNumber = (value: number, digits = 0) => fixed(value, digits);
const bpm = (value: number | undefined) =>
  value === undefined ? '–' : `${Math.round(value)} bpm`;

/** Name of a compared metric as shown to the user. */
export const metricWord = (metric: ComparedMetric): string => {
  switch (metric) {
    case 'pace':
      return tr('Tempo', 'Pace');
    case 'heartRate':
      return tr('Ø Puls', 'Avg heart rate');
    case 'metersPerBeat':
      return tr('Meter je Herzschlag', 'Meters per beat');
    case 'cadence':
      return tr('Kadenz', 'Cadence');
    case 'drift':
      return tr('Puls-Drift', 'Heart rate drift');
    case 'fade':
      return tr('Tempoabfall', 'Pace fade');
  }
};

function metricText(metric: ComparedMetric, value: number): string {
  switch (metric) {
    case 'pace':
      return `${formatPace(value)} /km`;
    case 'heartRate':
      return bpm(value);
    case 'metersPerBeat':
      return `${formatNumber(value, 2)} m`;
    case 'cadence':
      return `${Math.round(value)} spm`;
    case 'drift':
    case 'fade':
      return `${formatNumber(value, 1)}${percentSign()}`;
  }
}
/** Difference to the baseline in the metric's unit, with sign. */
export function deltaText(item: MetricComparison): string {
  const diff = item.value - item.reference;
  switch (item.metric) {
    case 'pace':
      return `${formatSignedSeconds(diff)}/km`;
    case 'heartRate': {
      const rounded = Math.round(diff);
      return `${rounded > 0 ? '+' : rounded < 0 ? '−' : '±'}${Math.abs(
        rounded,
      )} bpm`;
    }
    case 'cadence': {
      const rounded = Math.round(diff);
      return `${rounded > 0 ? '+' : rounded < 0 ? '−' : '±'}${Math.abs(
        rounded,
      )} spm`;
    }
    case 'metersPerBeat':
      return formatSignedPercent(item.deltaPercent);
    case 'drift':
    case 'fade':
      return tr(
        `${formatSignedNumber(diff, 1)} Punkte`,
        `${formatSignedNumber(diff, 1)} points`,
      );
  }
}
export function toneFor(
  comparison: RecentComparison | undefined,
  metric: ComparedMetric,
): { tone: StatTone; delta: string } | undefined {
  const item = comparison?.metrics.find(entry => entry.metric === metric);
  return item ? { tone: item.rating, delta: deltaText(item) } : undefined;
}

export function RunInsights({
  run,
  series,
  history,
  pacing,
  maxHeartRateSetting,
  onMaxHeartRate,
}: RunInsightsProps) {
  const budget = timeBudgetShares(run);
  const movement = movementInsight(run);
  const verdict = pacingVerdict(pacing, run);
  const drift = heartRateDrift(run);
  const gap = gradeAdjustedPace(run);
  const efficiency = metersPerBeat(run);
  const walk = useMemo(() => walkRecovery(run, series), [run, series]);
  const end = useMemo(() => endRecovery(run, series), [run, series]);
  const max = useMemo(
    () => maxHeartRate(maxHeartRateSetting, history),
    [maxHeartRateSetting, history],
  );
  const zones = useMemo(() => heartRateZones(series, max), [series, max]);
  const fatigue = useMemo(() => fatiguePattern(run, series), [run, series]);
  const weather = useMemo(() => weatherInsight(run, series), [run, series]);
  const cost = useMemo(() => environmentCost(run, series), [run, series]);
  const comparison = useMemo(
    () => recentComparison(run, history, pacing),
    [run, history, pacing],
  );
  const route = useMemo(
    () => sameRouteComparison(run, history),
    [run, history],
  );
  const curve = useMemo(() => heartRatePaceCurve(run, history), [run, history]);
  const gait = useMemo(() => gaitInsight(run, history), [run, history]);
  const hasHeartRate = run.avgHeartRate !== undefined;
  const heartRateSpan =
    run.avgHeartRateMin !== undefined && run.avgHeartRateMax !== undefined
      ? `${Math.round(run.avgHeartRateMin)}–${Math.round(
          run.avgHeartRateMax,
        )} bpm`
      : undefined;
  const cadenceSpan =
    run.avgCadenceMin !== undefined && run.avgCadenceMax !== undefined
      ? `${Math.round(run.avgCadenceMin)}–${Math.round(run.avgCadenceMax)} spm`
      : undefined;
  const segments = run.segments ?? [];
  const kmLabel = (index: number | undefined) => {
    if (index === undefined) return undefined;
    let meters = 0;
    for (let i = 0; i <= index; i += 1)
      meters += segments[i]?.distanceMeters ?? 0;
    return `km ${Math.round(meters / 1000)}`;
  };

  return (
    <>
      {budget || movement ? (
        <Section title={tr('Bewegung', 'Movement')}>
          {budget ? (
            <StackedBar
              label={tr('Zeitbudget', 'Time budget')}
              parts={[
                {
                  value: budget.runningSeconds,
                  color: color.green,
                  label: tr('gelaufen', 'running'),
                  text: formatElapsed(budget.runningSeconds),
                },
                {
                  value: budget.walkingSeconds,
                  color: color.series.cadence,
                  label: tr('gegangen', 'walking'),
                  text: formatElapsed(budget.walkingSeconds),
                },
                {
                  value: budget.stoppedSeconds,
                  color: color.muted,
                  label: tr('gestanden', 'standing'),
                  text: formatElapsed(budget.stoppedSeconds),
                },
              ]}
            />
          ) : null}
          {budget && budget.pausedSeconds >= 30 ? (
            <Copy muted>
              {tr(
                `Dazu ${formatElapsed(budget.pausedSeconds)} pausiert.`,
                `Plus ${formatElapsed(budget.pausedSeconds)} paused.`,
              )}
            </Copy>
          ) : null}
          {movement?.longestRunMeters !== undefined &&
          movement.longestRunSeconds !== undefined ? (
            <Row
              title={tr('Längster Abschnitt am Stück', 'Longest stretch without a break')}
              subtitle={
                tr(
                  `${formatKm(movement.longestRunMeters)} km · ${formatElapsed(
                    movement.longestRunSeconds,
                  )} ohne Gehpause`,
                  `${formatKm(movement.longestRunMeters)} km · ${formatElapsed(
                    movement.longestRunSeconds,
                  )} without a walk break`,
                )
              }
            />
          ) : null}
          {movement ? (
            <Row
              title={tr('Wechsel zwischen Laufen und Gehen', 'Switches between running and walking')}
              subtitle={
                // No detected switches does not prove continuous running:
                // standing and unknown stretches don't count here.
                movement.runWalkTransitions > 0
                  ? `${movement.runWalkTransitions}×`
                  : tr('Keiner erkannt', 'None detected')
              }
            />
          ) : null}
          {movement?.runningHeartRate !== undefined &&
          movement.walkingHeartRate !== undefined ? (
            <Row
              title={tr('Puls laufend · gehend', 'Heart rate running · walking')}
              subtitle={`${bpm(movement.runningHeartRate)} · ${bpm(
                movement.walkingHeartRate,
              )}`}
            />
          ) : null}
        </Section>
      ) : null}

      {verdict || drift || gap ? (
        <Section title={tr('Einteilung', 'Pacing')}>
          {verdict ? <Copy>{verdict.sentence}</Copy> : null}
          {verdict ? (
            <Row
              title={tr('Gleichmäßigkeit', 'Evenness')}
              subtitle={tr(
                `${evennessLabel(verdict.evenness)} · Schwankung ${formatNumber(
                  verdict.coefficientOfVariation * 100,
                  1,
                )} %`,
                `${evennessLabel(verdict.evenness)} · variation ${formatNumber(
                  verdict.coefficientOfVariation * 100,
                  1,
                )}%`,
              )}
            />
          ) : null}
          {verdict?.fastestSecondsPerKm !== undefined &&
          verdict.slowestSecondsPerKm !== undefined &&
          verdict.fastestSegmentIndex !== verdict.slowestSegmentIndex ? (
            <Row
              title={tr('Schnellster · langsamster Kilometer', 'Fastest · slowest kilometer')}
              subtitle={`${formatPace(verdict.fastestSecondsPerKm)} (${kmLabel(
                verdict.fastestSegmentIndex,
              )}) · ${formatPace(verdict.slowestSecondsPerKm)} (${kmLabel(
                verdict.slowestSegmentIndex,
              )})`}
            />
          ) : null}
          {drift ? (
            <Row
              title={tr('Puls-Drift', 'Heart rate drift')}
              subtitle={`${formatSignedPercent(drift.percent, 1)} · ${driftVerdictLabel(
                drift.verdict,
              )}`}
            />
          ) : null}
          {gap &&
          Math.abs(gap.adjustedSecondsPerKm - gap.realSecondsPerKm) >= 2 ? (
            <Row
              title={tr('Flach-Äquivalent', 'Flat equivalent')}
              subtitle={
                tr(
                  `${formatPace(gap.realSecondsPerKm)} real · ${formatPace(
                    gap.adjustedSecondsPerKm,
                  )} /km in der Ebene — geschätzt`,
                  `${formatPace(gap.realSecondsPerKm)} actual · ${formatPace(
                    gap.adjustedSecondsPerKm,
                  )} /km on the flat — estimated`,
                )
              }
            />
          ) : null}
        </Section>
      ) : null}

      {hasHeartRate || cadenceSpan ? (
        <Section title={tr('Puls & Schritt', 'Heart rate & stride')}>
          {heartRateSpan ? (
            <Row title={tr('Puls', 'Heart rate')} subtitle={heartRateSpan} />
          ) : null}
          {cadenceSpan ? (
            <Row title={tr('Kadenz', 'Cadence')} subtitle={cadenceSpan} />
          ) : null}
          {efficiency !== undefined ? (
            <Row
              title={tr('Meter je Herzschlag', 'Meters per beat')}
              subtitle={`${formatNumber(efficiency, 2)} m`}
            />
          ) : null}
          {walk ? (
            <Row
              title={tr('Erholung in Gehpausen', 'Recovery in walk breaks')}
              subtitle={
                tr(
                  `Puls fällt in der ersten Minute um ${Math.round(
                    walk.dropFirstMinute,
                  )} bpm (${walk.pauses} ${
                    walk.pauses === 1 ? 'Pause' : 'Pausen'
                  })${
                    walk.lowestHeartRate !== undefined
                      ? ` · tiefster Wert ${Math.round(walk.lowestHeartRate)} bpm`
                      : ''
                  }`,
                  `Heart rate drops ${Math.round(
                    walk.dropFirstMinute,
                  )} bpm in the first minute (${walk.pauses} ${
                    walk.pauses === 1 ? 'break' : 'breaks'
                  })${
                    walk.lowestHeartRate !== undefined
                      ? ` · lowest value ${Math.round(walk.lowestHeartRate)} bpm`
                      : ''
                  }`,
                )
              }
            />
          ) : null}
          {end ? (
            <Row
              title={tr('Erholung nach dem Ende', 'Recovery after finishing')}
              subtitle={
                tr(
                  `Von ${Math.round(end.heartRateAtEnd)} bpm um ${Math.round(
                    end.dropFirstMinute,
                  )} bpm in der ersten Minute`,
                  `From ${Math.round(end.heartRateAtEnd)} bpm, down ${Math.round(
                    end.dropFirstMinute,
                  )} bpm in the first minute`,
                )
              }
            />
          ) : null}
          {zones ? (
            <StackedBar
              label={tr('Zeit in Pulszonen', 'Time in heart rate zones')}
              parts={zones.zones.map((zone, i) => ({
                value: zone.seconds,
                color: [
                  color.series.tailwind,
                  color.green,
                  color.caution,
                  color.series.headwind,
                  color.series.heart,
                ][i],
                label: `Z${zone.zone} ${zone.label}`,
                text: `${Math.round(zone.share * 100)}${percentSign()}`,
              }))}
            />
          ) : null}
          {hasHeartRate && onMaxHeartRate ? (
            <MaxHeartRateField
              current={max}
              setting={maxHeartRateSetting}
              onChange={onMaxHeartRate}
            />
          ) : null}
        </Section>
      ) : null}

      {fatigue && fatigue.verdict !== 'unclear' ? (
        <Section title={tr('Ermüdung', 'Fatigue')}>
          <Copy>{fatigue.sentence}</Copy>
          <Row
            title={tr('Letztes gegen erstes Drittel', 'Last vs. first third')}
            subtitle={[
              fatigue.paceChangePercent !== undefined
                ? tr(
                    `Tempo ${formatSignedPercent(fatigue.paceChangePercent)}`,
                    `Pace ${formatSignedPercent(fatigue.paceChangePercent)}`,
                  )
                : null,
              fatigue.heartRateChangePercent !== undefined
                ? tr(
                    `Puls ${formatSignedPercent(fatigue.heartRateChangePercent)}`,
                    `Heart rate ${formatSignedPercent(fatigue.heartRateChangePercent)}`,
                  )
                : null,
              fatigue.cadenceChangePercent !== undefined
                ? tr(
                    `Kadenz ${formatSignedPercent(fatigue.cadenceChangePercent)}`,
                    `Cadence ${formatSignedPercent(fatigue.cadenceChangePercent)}`,
                  )
                : null,
              fatigue.strideChangePercent !== undefined
                ? tr(
                    `Schrittlänge ${formatSignedPercent(fatigue.strideChangePercent)}`,
                    `Stride length ${formatSignedPercent(fatigue.strideChangePercent)}`,
                  )
                : null,
            ]
              .filter(Boolean)
              .join(' · ')}
          />
        </Section>
      ) : null}

      {gait ? (
        <Section title={tr('Laufstil', 'Running form')}>
          {gait.notice ? <Notice>{gait.notice}</Notice> : null}
          {gait.headline ? <Copy>{gait.headline}</Copy> : null}
          {gait.lines.map(item => (
            <GaitRow key={`${item.device}-${item.metric}`} item={item} />
          ))}
          {gait.late ? (
            <Row
              title={tr('Letztes gegen erstes Drittel', 'Last vs. first third')}
              subtitle={gait.late}
            />
          ) : null}
          <Disclosure
            title={tr('Details', 'Details')}
            subtitle={tr(
              'Trageort, Datenbasis, Modell',
              'Carry position, data basis, model',
            )}
          >
            {gait.details.map(text => (
              <Copy muted key={text}>
                {text}
              </Copy>
            ))}
          </Disclosure>
        </Section>
      ) : null}

      {weather ? (
        <Section title={tr('Bedingungen', 'Conditions')}>
          <Copy>
            {[
              weather.temperatureC !== undefined
                ? `${formatNumber(weather.temperatureC)} °C`
                : null,
              weather.windMps !== undefined
                ? `${tr('Wind', 'Wind')} ${formatNumber(weather.windMps)} m/s${
                    weather.windFromDeg !== undefined
                      ? tr(
                          ` aus ${compassLabel(weather.windFromDeg)}`,
                          ` from ${compassLabel(weather.windFromDeg)}`,
                        )
                      : ''
                  }`
                : null,
            ]
              .filter(Boolean)
              .join(' · ')}
          </Copy>
          {weather.headwindKilometers.length ? (
            <Row
              title={tr('Gegenwind', 'Headwind')}
              subtitle={`km ${weather.headwindKilometers.join(', ')}`}
            />
          ) : null}
          {weather.tailwindKilometers.length ? (
            <Row
              title={tr('Rückenwind', 'Tailwind')}
              subtitle={`km ${weather.tailwindKilometers.join(', ')}`}
            />
          ) : null}
          {cost?.windSecondsPerKm !== undefined ? (
            <Row
              title={tr('Wind am Tempo', 'Wind effect on pace')}
              subtitle={
                tr(
                  `${formatSignedSeconds(cost.windSecondsPerKm)}/km — geschätzt${
                    cost.windCoverage !== undefined && cost.windCoverage < 0.9
                      ? `, ${Math.round(cost.windCoverage * 100)} % der Strecke`
                      : ''
                  }`,
                  `${formatSignedSeconds(cost.windSecondsPerKm)}/km — estimated${
                    cost.windCoverage !== undefined && cost.windCoverage < 0.9
                      ? `, ${Math.round(cost.windCoverage * 100)}% of the route`
                      : ''
                  }`,
                )
              }
            />
          ) : null}
          {cost?.heatSecondsPerKm !== undefined ? (
            <Row
              title={tr('Wärme am Tempo', 'Heat effect on pace')}
              subtitle={
                tr(
                  `${formatSignedSeconds(cost.heatSecondsPerKm)}/km — grobe Schätzung ab 15 °C`,
                  `${formatSignedSeconds(cost.heatSecondsPerKm)}/km — rough estimate from 15 °C`,
                )
              }
            />
          ) : null}
        </Section>
      ) : null}

      {comparison || route || curve?.line ? (
        <Section title={tr('Im Vergleich zu dir', 'Compared with you')}>
          {comparison ? (
            <Copy muted>
              {tr(
                `Gegenüber dem Median deiner letzten ${comparison.count}${
                  comparison.samePurpose ? ' gleichartigen' : ''
                } Läufe.`,
                `Against the median of your last ${comparison.count}${
                  comparison.samePurpose ? ' similar' : ''
                } runs.`,
              )}
            </Copy>
          ) : null}
          {comparison?.metrics.map(item => (
            <CompareRow key={item.metric} item={item} />
          ))}
          {route ? (
            <Row
              title={tr(
                `${route.ordinal}. Mal auf dieser Strecke`,
                `Run ${route.ordinal} on this route`,
              )}
              subtitle={`${formatElapsed(route.currentSeconds)} · ${
                route.deltaToLastSeconds === 0
                  ? tr('wie zuletzt', 'same as recently')
                  : tr(
                      `${formatSignedSeconds(
                        route.deltaToLastSeconds,
                      )} gegenüber zuletzt`,
                      `${formatSignedSeconds(
                        route.deltaToLastSeconds,
                      )} compared with last time`,
                    )
              }${
                route.currentSeconds <= route.bestSeconds
                  ? tr(' · Bestzeit', ' · Personal best')
                  : ''
              }`}
            />
          ) : null}
          {curve?.line ? (
            <>
              <Copy>
                {curve.verdict === 'efficient'
                  ? tr(
                      `Bei gleichem Tempo ${Math.round(
                        Math.abs(curve.residualBpm ?? 0),
                      )} bpm unter deinem Normalniveau.`,
                      `At the same pace, ${Math.round(
                        Math.abs(curve.residualBpm ?? 0),
                      )} bpm below your usual level.`,
                    )
                  : curve.verdict === 'higher'
                  ? tr(
                      `Bei gleichem Tempo ${Math.round(
                        curve.residualBpm ?? 0,
                      )} bpm über deinem Normalniveau.`,
                      `At the same pace, ${Math.round(
                        curve.residualBpm ?? 0,
                      )} bpm above your usual level.`,
                    )
                  : tr(
                      'Puls zum Tempo wie bei deinen letzten Läufen.',
                      'Heart rate for your pace matches your recent runs.',
                    )}
              </Copy>
              <HeartRatePaceChart points={curve.points} line={curve.line} />
            </>
          ) : null}
        </Section>
      ) : null}
    </>
  );
}

const TONE_MARK: Record<StatTone, string> = {
  better: '▲',
  same: '',
  slightly_worse: '▽',
  worse: '▼',
};
function CompareRow({ item }: { item: MetricComparison }) {
  const mark = TONE_MARK[item.rating];
  return (
    <Row
      title={metricWord(item.metric)}
      subtitle={tr(
        `Basis ${metricText(item.metric, item.reference)}`,
        `Baseline ${metricText(item.metric, item.reference)}`,
      )}
      trailing={
        <Text
          style={[styles.compareValue, { color: toneColor(item.rating) }]}
          accessibilityLabel={`${metricWord(item.metric)} ${metricText(
            item.metric,
            item.value,
          )}, ${deltaText(item)}`}
        >
          {metricText(item.metric, item.value)}
          {mark ? ` ${mark}` : ''}
          {'\n'}
          <Text style={styles.compareDelta}>{deltaText(item)}</Text>
        </Text>
      }
    />
  );
}

/** Running-form row; the comparison sits on the right, without color for neutral values. */
function GaitRow({ item }: { item: GaitLine }) {
  const comparison = item.comparison;
  const mark = comparison ? TONE_MARK[comparison.rating] : '';
  return (
    <Row
      title={item.title}
      subtitle={item.subtitle}
      trailing={
        comparison ? (
          <Text
            style={[
              styles.compareValue,
              { color: toneColor(comparison.rating) },
            ]}
            accessibilityLabel={tr(
              `${item.title}: ${comparison.delta} gegenüber deinen letzten ${comparison.count} Läufen`,
              `${item.title}: ${comparison.delta} compared with your last ${comparison.count} runs`,
            )}
          >
            {comparison.delta}
            {mark ? ` ${mark}` : ''}
            {'\n'}
            <Text style={styles.compareDelta}>
              {tr(`zu ${comparison.count} Läufen`, `vs. ${comparison.count} runs`)}
            </Text>
          </Text>
        ) : undefined
      }
    />
  );
}

function MaxHeartRateField({
  current,
  setting,
  onChange,
}: {
  current: ReturnType<typeof maxHeartRate>;
  setting: number | undefined;
  onChange: (value: number | undefined) => void;
}) {
  const [text, setText] = useState(setting ? String(setting) : '');
  const commit = () => {
    const parsed = Number.parseInt(text, 10);
    onChange(
      Number.isFinite(parsed) && parsed >= 100 && parsed <= 230
        ? parsed
        : undefined,
    );
  };
  return (
    <Disclosure
      title={tr('Maxpuls', 'Max heart rate')}
      subtitle={
        current
          ? current.source === 'setting'
            ? tr(
                `${current.value} bpm · eingestellt`,
                `${current.value} bpm · set`,
              )
            : tr(
                `${current.value} bpm · geschätzt aus ${current.runs} Läufen`,
                `${current.value} bpm · estimated from ${current.runs} runs`,
              )
          : tr(
              'Noch nicht bekannt — eintragen oder drei Läufe mit Puls',
              'Not known yet — enter it or use three runs with heart rate',
            )
      }
    >
      <Copy muted>
        {tr(
          'Die Zonen rechnen mit dem Maxpuls. Trag ihn ein, wenn du ihn kennst.',
          'The zones use your max heart rate. Enter it if you know it.',
        )}
      </Copy>
      <Input
        label={tr('Maxpuls in bpm', 'Max heart rate in bpm')}
        keyboardType="number-pad"
        value={text}
        onChangeText={setText}
        onBlur={commit}
        onSubmitEditing={commit}
        placeholder={tr('z. B. 190', 'e.g. 190')}
      />
    </Disclosure>
  );
}

const CHART_HEIGHT = 150;
const CHART_MARGIN = { top: 8, bottom: 22, left: 36, right: 8 };
/**
 * Heart rate over pace: this run's points, the line from recent runs. The
 * x-axis shows pace (slow on the left, fast on the right), so the curve rises
 * to the upper right as usual.
 */
function HeartRatePaceChart({
  points,
  line,
}: {
  points: { speedMps: number; heartRate: number }[];
  line: { slope: number; intercept: number; runs: number };
}) {
  const [width, setWidth] = useState(320);
  const speeds = points.map(p => p.speedMps);
  const minSpeed = Math.min(...speeds) - 0.2;
  const maxSpeed = Math.max(...speeds) + 0.2;
  const hrs = [
    ...points.map(p => p.heartRate),
    line.intercept + line.slope * minSpeed,
    line.intercept + line.slope * maxSpeed,
  ];
  const minHr = Math.floor((Math.min(...hrs) - 5) / 5) * 5;
  const maxHr = Math.ceil((Math.max(...hrs) + 5) / 5) * 5;
  const plotWidth = width - CHART_MARGIN.left - CHART_MARGIN.right;
  const plotHeight = CHART_HEIGHT - CHART_MARGIN.top - CHART_MARGIN.bottom;
  const x = (speed: number) =>
    CHART_MARGIN.left +
    ((speed - minSpeed) / (maxSpeed - minSpeed)) * plotWidth;
  const y = (hr: number) =>
    CHART_MARGIN.top + (1 - (hr - minHr) / (maxHr - minHr)) * plotHeight;
  const ticks = [minSpeed + 0.2, (minSpeed + maxSpeed) / 2, maxSpeed - 0.2];
  return (
    <View
      accessibilityRole="image"
      accessibilityLabel={tr(
        `Puls über Tempo: ${points.length} Kilometer dieses Laufs gegen die Gerade aus ${line.runs} Läufen.`,
        `Heart rate over pace: ${points.length} kilometers of this run against the line from ${line.runs} runs.`,
      )}
      onLayout={event => setWidth(event.nativeEvent.layout.width)}
    >
      <Svg width={width} height={CHART_HEIGHT}>
        {[minHr, (minHr + maxHr) / 2, maxHr].map(hr => (
          <React.Fragment key={hr}>
            <Line
              x1={CHART_MARGIN.left}
              x2={width - CHART_MARGIN.right}
              y1={y(hr)}
              y2={y(hr)}
              stroke={color.line}
              strokeWidth={1}
            />
            <SvgText
              x={CHART_MARGIN.left - 6}
              y={y(hr) + 4}
              fill={color.muted}
              fontSize={11}
              textAnchor="end"
            >
              {Math.round(hr)}
            </SvgText>
          </React.Fragment>
        ))}
        {ticks.map(speed => (
          <SvgText
            key={speed}
            x={x(speed)}
            y={CHART_HEIGHT - 6}
            fill={color.muted}
            fontSize={11}
            textAnchor="middle"
          >
            {formatPace(1000 / speed)}
          </SvgText>
        ))}
        <Line
          x1={x(minSpeed)}
          y1={y(line.intercept + line.slope * minSpeed)}
          x2={x(maxSpeed)}
          y2={y(line.intercept + line.slope * maxSpeed)}
          stroke={color.muted}
          strokeWidth={2}
          strokeDasharray="6 4"
        />
        {points.map((p, i) => (
          <Circle
            key={i}
            cx={x(p.speedMps)}
            cy={y(p.heartRate)}
            r={4.5}
            fill={color.series.heart}
          />
        ))}
      </Svg>
      <View style={styles.legend}>
        <View style={styles.legendItem}>
          <View
            style={[styles.legendDot, { backgroundColor: color.series.heart }]}
          />
          <Text style={styles.legendText}>
            {tr('Kilometer dieses Laufs', 'Kilometers of this run')}
          </Text>
        </View>
        <View style={styles.legendItem}>
          <View style={[styles.legendLine, { backgroundColor: color.muted }]} />
          <Text style={styles.legendText}>
            {tr(
              `Deine letzten ${line.runs} Läufe`,
              `Your last ${line.runs} runs`,
            )}
          </Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  compareValue: {
    ...type.label,
    fontWeight: '600',
    textAlign: 'right',
    fontVariant: ['tabular-nums'],
  },
  compareDelta: { color: color.muted, ...type.micro, fontWeight: '400' },
  legend: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space.md,
    marginTop: space.xs,
  },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: space.xxs },
  legendDot: { width: 9, height: 9, borderRadius: 5 },
  legendLine: { width: 14, height: 2, borderRadius: 1 },
  legendText: { color: color.muted, ...type.micro, fontWeight: '400' },
});
