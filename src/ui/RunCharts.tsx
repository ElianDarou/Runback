import React, { useMemo, useState } from 'react';
import {
  Pressable,
  StyleSheet,
  Switch,
  Text,
  View,
  type GestureResponderEvent,
} from 'react-native';
import Svg, {
  Circle,
  Defs,
  Line,
  Path,
  Pattern,
  Rect,
  Text as SvgText,
} from 'react-native-svg';
import type { RunSummary } from '../domain/types';
import {
  availableMetrics,
  averagePace,
  axisValue,
  formatElapsed,
  formatKm,
  formatMetric,
  metricLabel,
  metricUnit,
  metricValue,
  nearestIndex,
  seriesTotals,
  type KilometerSplit,
  type RunSeries,
  type SeriesAxis,
  type SeriesMetric,
} from '../domain/runSeries';
import { tr } from '../domain/i18n';
import {
  ChipGroup,
  Copy,
  Segmented,
  color,
  radius,
  space,
  type,
} from './components';

/**
 * A run's history: one graph, one axis, one metric per tab. The elevation
 * profile can sit behind it as a gray relief — with its own scale but no
 * second axis, so two arbitrarily scaled axes don't invent a relation. Swiping
 * picks a moment; the readout line stays fixed above the graph so the finger
 * doesn't cover it.
 */
const HEIGHT = 168;
const MARGIN = { top: 10, bottom: 20, left: 40 };
const LINE_COLOR: Record<SeriesMetric, string> = {
  pace: color.green,
  heartRate: color.series.heart,
  elevation: color.muted,
  cadence: color.series.cadence,
  armSwing: color.series.tailwind,
  wind: color.series.headwind,
};

function niceStep(span: number, target: number, steps: number[]): number {
  return steps.find(step => span / step <= target) ?? steps[steps.length - 1];
}

export function RunSeriesPanel({
  run,
  series,
  selected,
  onSelect,
  range,
}: {
  run: RunSummary;
  series: RunSeries | null;
  /** Row index of the active moment; null without a selection. */
  selected: number | null;
  onSelect: (index: number | null) => void;
  /** Highlighted row range (e.g. one kilometer). */
  range: [number, number] | null;
}) {
  const metrics = useMemo(() => availableMetrics(series), [series]);
  const [metricChoice, setMetric] = useState<SeriesMetric>('pace');
  const [axis, setAxis] = useState<SeriesAxis>('distance');
  const [relief, setRelief] = useState(true);
  const [width, setWidth] = useState(320);
  const metric = metrics.includes(metricChoice)
    ? metricChoice
    : metrics[0] ?? 'pace';
  const rows = series?.rows ?? [];
  const hasElevation = metrics.includes('elevation');
  const showRelief = relief && hasElevation && metric !== 'elevation';
  const totals = useMemo(() => seriesTotals(run, series), [run, series]);

  if (!series || metrics.length === 0) {
    return (
      <Copy muted>
        {tr(
          'Für diesen Lauf gibt es keinen Verlauf — nur Aufzeichnungen mit GPS oder Sensoren haben einen.',
          'There is no history for this run — only recordings with GPS or sensors have one.',
        )}
      </Copy>
    );
  }

  // ---- Scales ----
  const right = showRelief ? 40 : 10;
  const plotWidth = Math.max(1, width - MARGIN.left - right);
  const plotHeight = HEIGHT - MARGIN.top - MARGIN.bottom;
  const axisMax = Math.max(1, axisValue(rows[rows.length - 1], axis));
  const xOf = (index: number) =>
    MARGIN.left + (axisValue(rows[index], axis) / axisMax) * plotWidth;
  const values = rows.map(row => metricValue(row, metric));
  const present = values.filter(
    (value): value is number => value !== undefined,
  );
  let low = Math.min(...present);
  let high = Math.max(...present);
  if (metric === 'wind') {
    const extent = Math.max(Math.abs(low), Math.abs(high), 0.5);
    low = -extent;
    high = extent;
  } else {
    const pad = Math.max((high - low) * 0.12, metric === 'pace' ? 10 : 1);
    low -= pad;
    high += pad;
  }
  const invert = metric === 'pace';
  const yOf = (value: number) => {
    const share = (value - low) / (high - low);
    return MARGIN.top + (invert ? share : 1 - share) * plotHeight;
  };

  // ---- Paths ----
  let linePath = '';
  let pen = false;
  values.forEach((value, index) => {
    if (value === undefined) {
      pen = false;
      return;
    }
    linePath += `${pen ? 'L' : 'M'}${xOf(index).toFixed(1)},${yOf(
      value,
    ).toFixed(1)} `;
    pen = true;
  });
  const baseline = MARGIN.top + plotHeight;
  const areaPath = (
    pick: (row: (typeof rows)[number]) => number | undefined,
    scale: (v: number) => number,
  ) => {
    let d = '';
    let open = false;
    rows.forEach((row, index) => {
      const value = pick(row);
      if (value === undefined) {
        if (open) d += `L${xOf(index - 1).toFixed(1)},${baseline} Z `;
        open = false;
        return;
      }
      d += `${open ? 'L' : `M${xOf(index).toFixed(1)},${baseline} L`}${xOf(
        index,
      ).toFixed(1)},${scale(value).toFixed(1)} `;
      open = true;
    });
    if (open) d += `L${xOf(rows.length - 1).toFixed(1)},${baseline} Z`;
    return d;
  };
  const elevations = rows
    .map(row => row.elevationM)
    .filter((value): value is number => value !== undefined);
  const elevationLow = Math.min(...elevations) - 3;
  const elevationHigh = Math.max(...elevations) + 3;
  const reliefPath = showRelief
    ? areaPath(
        row => row.elevationM,
        value =>
          MARGIN.top +
          (1 - (value - elevationLow) / (elevationHigh - elevationLow)) *
            plotHeight,
      )
    : '';
  const windPaths =
    metric === 'wind'
      ? {
          head: areaPath(
            row =>
              row.headwindMps === undefined
                ? undefined
                : Math.max(0, row.headwindMps),
            yOf,
          ),
          tail: areaPath(
            row =>
              row.headwindMps === undefined
                ? undefined
                : Math.min(0, row.headwindMps),
            yOf,
          ),
        }
      : null;
  const elevationArea =
    metric === 'elevation' ? areaPath(row => row.elevationM, yOf) : '';
  const mean = metric === 'pace' ? averagePace(run) : undefined;

  // ---- Axis labels ----
  const yTicks = [low, (low + high) / 2, high];
  const xStep =
    axis === 'distance'
      ? niceStep(axisMax, 6, [500, 1000, 2000, 5000, 10000, 20000])
      : niceStep(axisMax, 6, [60, 300, 600, 900, 1800, 3600, 7200]);
  const xTicks: number[] = [];
  for (let value = 0; value <= axisMax; value += xStep) xTicks.push(value);
  const xLabel = (value: number) =>
    axis === 'distance'
      ? `${formatKm(value, value % 1000 ? 1 : 0)} km`
      : `${Math.round(value / 60)} min`;

  // Gaps without pace while moving (GPS dropout) are hatched so nobody
  // expects a value there.
  const gapBands: [number, number][] = [];
  if (metric === 'pace') {
    let from: number | null = null;
    rows.forEach((row, index) => {
      const missing = row.moving && row.speedMps === undefined;
      if (missing && from === null) from = index;
      if (!missing && from !== null) {
        gapBands.push([from, index - 1]);
        from = null;
      }
    });
    if (from !== null) gapBands.push([from, rows.length - 1]);
  }

  // ---- Gesture ----
  const pick = (event: GestureResponderEvent) => {
    const x = event.nativeEvent.locationX;
    const share = Math.min(1, Math.max(0, (x - MARGIN.left) / plotWidth));
    onSelect(nearestIndex(rows, axis, share * axisMax));
  };
  const selectedRow = selected !== null ? rows[selected] : null;
  const selectedValue = selected !== null ? values[selected] : undefined;

  return (
    <View style={styles.panel}>
      <View accessibilityLiveRegion="polite" style={styles.readout}>
        <Text style={styles.readoutPosition}>
          {selectedRow ? (
            <>
              {tr('bei', 'at')}{' '}
              <Text style={styles.readoutStrong}>
                km {formatKm(selectedRow.distanceMeters)}
              </Text>
              {' · '}
              <Text style={styles.readoutStrong}>
                {formatElapsed(selectedRow.elapsedSeconds)}
              </Text>
              {' min'}
              {!selectedRow.moving ? tr(' · Pause', ' · Paused') : ''}
              {selectedRow.gradePercent !== undefined &&
              selectedRow.gradePercent > 3
                ? tr(' · Anstieg', ' · Uphill')
                : selectedRow.gradePercent !== undefined &&
                  selectedRow.gradePercent < -3
                ? tr(' · Gefälle', ' · Downhill')
                : ''}
            </>
          ) : (
            tr('Gesamt', 'Total')
          )}
        </Text>
        <View style={styles.readoutTiles}>
          {metrics.map(item => (
            <View key={item} style={styles.readoutTile}>
              <Text
                adjustsFontSizeToFit
                numberOfLines={1}
                style={styles.readoutValue}
              >
                {selectedRow
                  ? formatMetric(item, metricValue(selectedRow, item))
                  : totals[item] ?? '–'}
              </Text>
              <Text style={styles.readoutLabel}>{metricLabel(item)}</Text>
            </View>
          ))}
        </View>
      </View>
      <ChipGroup
        label={tr('Metrik im Verlauf', 'Metric over time')}
        options={metrics.map(item => ({
          value: item,
          label: metricLabel(item),
        }))}
        value={metric}
        onChange={setMetric}
      />
      <View
        accessibilityRole="adjustable"
        accessibilityLabel={tr(
          `${metricLabel(metric)} im Verlauf, ${
            present.length
          } Werte. Wischen wählt einen Moment.`,
          `${metricLabel(metric)} over time, ${
            present.length
          } values. Swipe to pick a moment.`,
        )}
        onLayout={event => setWidth(event.nativeEvent.layout.width)}
        onStartShouldSetResponder={() => true}
        onMoveShouldSetResponder={() => true}
        onResponderTerminationRequest={() => false}
        onResponderGrant={pick}
        onResponderMove={pick}
        style={styles.chart}
      >
        <Svg width={width} height={HEIGHT}>
          <Defs>
            <Pattern
              id="gap"
              width={6}
              height={6}
              patternUnits="userSpaceOnUse"
              patternTransform="rotate(45)"
            >
              <Line
                x1={0}
                y1={0}
                x2={0}
                y2={6}
                stroke={color.muted}
                strokeWidth={1.5}
              />
            </Pattern>
          </Defs>
          {showRelief ? (
            <>
              <Path d={reliefPath} fill={color.muted} opacity={0.18} />
              <SvgText
                x={width - right + 4}
                y={MARGIN.top + 9}
                fill={color.muted}
                fontSize={10}
              >
                {`${Math.round(elevationHigh - 3)} m`}
              </SvgText>
              <SvgText
                x={width - right + 4}
                y={baseline - 1}
                fill={color.muted}
                fontSize={10}
              >
                {`${Math.round(elevationLow + 3)} m`}
              </SvgText>
            </>
          ) : null}
          {range ? (
            <Rect
              x={xOf(range[0])}
              y={MARGIN.top}
              width={Math.max(2, xOf(range[1]) - xOf(range[0]))}
              height={plotHeight}
              fill={color.text}
              opacity={0.08}
            />
          ) : null}
          {yTicks.map(tick => (
            <React.Fragment key={tick}>
              <Line
                x1={MARGIN.left}
                x2={width - right}
                y1={yOf(tick)}
                y2={yOf(tick)}
                stroke={color.line}
                strokeWidth={1}
              />
              <SvgText
                x={MARGIN.left - 5}
                y={yOf(tick) + 3.5}
                fill={color.muted}
                fontSize={10}
                textAnchor="end"
              >
                {formatMetric(metric, tick).replace(' m', '')}
              </SvgText>
            </React.Fragment>
          ))}
          {xTicks.map(tick => (
            <SvgText
              key={tick}
              x={MARGIN.left + (tick / axisMax) * plotWidth}
              y={HEIGHT - 5}
              fill={color.muted}
              fontSize={10}
              textAnchor={tick === 0 ? 'start' : 'middle'}
            >
              {xLabel(tick)}
            </SvgText>
          ))}
          {gapBands.map(([from, to]) => (
            <Rect
              key={from}
              x={xOf(from)}
              y={MARGIN.top}
              width={Math.max(3, xOf(to) - xOf(from))}
              height={plotHeight}
              fill="url(#gap)"
              opacity={0.5}
            />
          ))}
          {windPaths ? (
            <>
              <Line
                x1={MARGIN.left}
                x2={width - right}
                y1={yOf(0)}
                y2={yOf(0)}
                stroke={color.muted}
                strokeWidth={1}
              />
              <Path
                d={windPaths.head}
                fill={color.series.headwind}
                opacity={0.85}
              />
              <Path
                d={windPaths.tail}
                fill={color.series.tailwind}
                opacity={0.85}
              />
              <SvgText
                x={MARGIN.left + 4}
                y={MARGIN.top + 10}
                fill={color.text}
                fontSize={10}
              >
                {tr('Gegenwind', 'Headwind')}
              </SvgText>
              <SvgText
                x={MARGIN.left + 4}
                y={baseline - 3}
                fill={color.text}
                fontSize={10}
              >
                {tr('Rückenwind', 'Tailwind')}
              </SvgText>
            </>
          ) : (
            <>
              {elevationArea ? (
                <Path d={elevationArea} fill={color.muted} opacity={0.25} />
              ) : null}
              <Path
                d={linePath}
                fill="none"
                stroke={LINE_COLOR[metric]}
                strokeWidth={2}
                strokeLinejoin="round"
              />
              {mean !== undefined && mean > low && mean < high ? (
                <>
                  <Line
                    x1={MARGIN.left}
                    x2={width - right}
                    y1={yOf(mean)}
                    y2={yOf(mean)}
                    stroke={LINE_COLOR[metric]}
                    strokeWidth={1}
                    strokeDasharray="3 3"
                    opacity={0.7}
                  />
                  <SvgText
                    x={width - right - 2}
                    y={yOf(mean) - 3}
                    fill={color.muted}
                    fontSize={10}
                    textAnchor="end"
                  >
                    {`Ø ${formatMetric(metric, mean)}`}
                  </SvgText>
                </>
              ) : null}
            </>
          )}
          {selected !== null ? (
            <>
              <Line
                x1={xOf(selected)}
                x2={xOf(selected)}
                y1={MARGIN.top}
                y2={baseline}
                stroke={color.text}
                strokeWidth={1}
                opacity={0.6}
              />
              {selectedValue !== undefined ? (
                <Circle
                  cx={xOf(selected)}
                  cy={yOf(selectedValue)}
                  r={4.5}
                  fill={color.text}
                  stroke={color.bg}
                  strokeWidth={2}
                />
              ) : null}
            </>
          ) : null}
        </Svg>
      </View>
      <View style={styles.legend}>
        {metric === 'wind' ? (
          <>
            <LegendItem
              swatch={color.series.headwind}
              label={tr('Gegenwind', 'Headwind')}
              area
            />
            <LegendItem
              swatch={color.series.tailwind}
              label={tr('Rückenwind', 'Tailwind')}
              area
            />
          </>
        ) : (
          <LegendItem
            swatch={LINE_COLOR[metric]}
            label={`${metricLabel(metric)} in ${metricUnit(metric)}${
              metric === 'pace' ? tr(' (oben = schneller)', ' (top = faster)') : ''
            }`}
          />
        )}
        {showRelief ? (
          <LegendItem swatch={color.muted} label={tr('Höhe', 'Elevation')} area />
        ) : null}
      </View>
      <View style={styles.controls}>
        {hasElevation && metric !== 'elevation' ? (
          <View style={styles.switchRow}>
            <Switch
              accessibilityLabel={tr(
                'Höhenprofil hinterlegen',
                'Show elevation profile behind',
              )}
              value={relief}
              onValueChange={setRelief}
              trackColor={{ false: color.line, true: color.greenSoft }}
              thumbColor={relief ? color.green : color.muted}
            />
            <Text style={styles.switchLabel}>
              {tr('Höhenprofil hinterlegen', 'Show elevation profile behind')}
            </Text>
          </View>
        ) : (
          <View />
        )}
        <View style={styles.axis}>
          <Segmented
            label={tr('Achse', 'Axis')}
            options={[
              { value: 'distance', label: 'km' },
              { value: 'time', label: 'min' },
            ]}
            value={axis}
            onChange={setAxis}
          />
        </View>
      </View>
    </View>
  );
}

function LegendItem({
  swatch,
  label,
  area = false,
}: {
  swatch: string;
  label: string;
  area?: boolean;
}) {
  return (
    <View style={styles.legendItem}>
      <View
        style={[
          styles.legendSwatch,
          area && styles.legendArea,
          { backgroundColor: swatch },
        ]}
      />
      <Text style={styles.legendText}>{label}</Text>
    </View>
  );
}

/**
 * Kilometers as bars: length is the pace (starting at zero so the bars compare),
 * with heart rate and elevation gain beside them. Tapping marks the kilometer
 * in the graph and on the map.
 */
export function KilometerTable({
  splits,
  selected,
  onSelect,
}: {
  splits: KilometerSplit[];
  selected: number | null;
  onSelect: (index: number | null) => void;
}) {
  const paces = splits
    .map(split => split.secondsPerKm)
    .filter((value): value is number => value !== undefined);
  if (!paces.length) return null;
  const slowest = Math.max(...paces);
  const mean = paces.reduce((sum, value) => sum + value, 0) / paces.length;
  return (
    <View accessibilityRole="list" style={styles.table}>
      <View style={styles.tableHead}>
        <Text style={[styles.tableLabel, styles.colKm]}>km</Text>
        <Text style={[styles.tableLabel, styles.colBar]}>
          {tr('Tempo /km', 'Pace /km')}
        </Text>
        <Text style={[styles.tableLabel, styles.colHr]}>Ø bpm</Text>
        <Text style={[styles.tableLabel, styles.colElev]}>
          {tr('Höhe', 'Elevation')}
        </Text>
      </View>
      {splits.map(split => {
        const isSelected = selected === split.index;
        const share =
          split.secondsPerKm !== undefined ? split.secondsPerKm / slowest : 0;
        // Grade before climb: it explains a slow pace better than "↗ 12".
        // Under ±1 % the kilometer counts as flat.
        const grade =
          split.gradePercent !== undefined && Math.abs(split.gradePercent) >= 1
            ? `${split.gradePercent > 0 ? '+' : '−'}${Math.round(
                Math.abs(split.gradePercent),
              )} %`
            : '';
        const climb = [
          grade,
          split.ascentMeters !== undefined && split.ascentMeters >= 1
            ? `↗ ${Math.round(split.ascentMeters)}`
            : '',
          split.descentMeters !== undefined && split.descentMeters >= 1
            ? `↘ ${Math.round(split.descentMeters)}`
            : '',
        ]
          .filter(Boolean)
          .join(' ');
        return (
          <Pressable
            key={split.index}
            accessibilityRole="button"
            accessibilityState={{ selected: isSelected }}
            accessibilityLabel={tr(
              `Kilometer ${split.label}: ${formatMetric(
                'pace',
                split.secondsPerKm,
              )} pro Kilometer${split.uncertain ? ', Tempo unsicher' : ''}`,
              `Kilometer ${split.label}: ${formatMetric(
                'pace',
                split.secondsPerKm,
              )} per kilometer${split.uncertain ? ', pace uncertain' : ''}`,
            )}
            onPress={() => onSelect(isSelected ? null : split.index)}
            style={({ pressed }) => [
              styles.tableRow,
              isSelected && styles.tableRowSelected,
              pressed && styles.pressed,
            ]}
          >
            <Text style={[styles.tableCell, styles.colKm]}>{split.label}</Text>
            <View style={[styles.colBar, styles.barCell]}>
              <View
                style={[
                  styles.bar,
                  { flex: Math.max(share, 0.02) },
                  split.secondsPerKm !== undefined &&
                    split.secondsPerKm > mean &&
                    styles.barSlow,
                  split.uncertain && styles.barUncertain,
                ]}
              />
              <Text style={styles.barValue}>
                {formatMetric('pace', split.secondsPerKm)}
                {split.uncertain ? ' ?' : ''}
              </Text>
              <View style={{ flex: Math.max(1 - share, 0) }} />
            </View>
            <Text style={[styles.tableCellMuted, styles.colHr]}>
              {split.avgHeartRate !== undefined
                ? Math.round(split.avgHeartRate)
                : '–'}
            </Text>
            <Text style={[styles.tableCellMuted, styles.colElev]}>
              {climb || '–'}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { gap: space.sm },
  readout: {
    gap: space.xs,
    paddingBottom: space.xs,
    borderBottomWidth: 1,
    borderBottomColor: color.line,
  },
  readoutPosition: { color: color.muted, ...type.label, fontWeight: '400' },
  readoutStrong: {
    color: color.text,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
  readoutTiles: { flexDirection: 'row', gap: space.xxs },
  readoutTile: { flex: 1, alignItems: 'center', gap: 2 },
  readoutValue: {
    color: color.text,
    ...type.body,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
  readoutLabel: { color: color.muted, ...type.micro, fontWeight: '400' },
  chart: { marginHorizontal: -space.xxs },
  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: space.md },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: space.xxs },
  legendSwatch: { width: 14, height: 2, borderRadius: 1 },
  legendArea: { height: 8, opacity: 0.45, borderRadius: 2 },
  legendText: { color: color.muted, ...type.micro, fontWeight: '400' },
  controls: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: space.sm,
  },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  switchLabel: { color: color.text, ...type.label, fontWeight: '400' },
  axis: { width: 120 },
  table: { gap: space.xxs },
  tableHead: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  tableLabel: { color: color.muted, ...type.micro, fontWeight: '400' },
  tableRow: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    paddingHorizontal: space.xs,
    marginHorizontal: -space.xs,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  tableRowSelected: {
    backgroundColor: color.greenSoft,
    borderColor: color.green,
  },
  pressed: { opacity: 0.72 },
  tableCell: {
    color: color.text,
    ...type.label,
    fontVariant: ['tabular-nums'],
  },
  tableCellMuted: {
    color: color.muted,
    ...type.label,
    fontWeight: '400',
    fontVariant: ['tabular-nums'],
  },
  colKm: { width: 52 },
  colBar: { flex: 1 },
  colHr: { width: 48, textAlign: 'right' },
  colElev: { width: 68, textAlign: 'right' },
  barCell: { flexDirection: 'row', alignItems: 'center', gap: space.xxs },
  bar: { height: 12, borderRadius: 4, backgroundColor: color.green },
  barSlow: { opacity: 0.55 },
  barUncertain: { backgroundColor: color.muted },
  barValue: {
    color: color.text,
    ...type.micro,
    fontVariant: ['tabular-nums'],
  },
});
