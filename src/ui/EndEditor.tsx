import React, { useState } from 'react';
import {
  StyleSheet,
  Text,
  View,
  type GestureResponderEvent,
} from 'react-native';
import Svg, { Line, Path, Rect, Text as SvgText } from 'react-native-svg';
import {
  clampEnd,
  MIN_DURATION_SECONDS,
  type EndSuggestion,
} from '../domain/endCorrection';
import {
  Button,
  Copy,
  Row,
  Stepper,
  color,
  space,
  type as type_,
} from './components';
import { formatElapsed } from '../domain/runSeries';
import { dateFormat, tr } from '../domain/i18n';

export interface EndLine {
  key: string;
  label: string;
  stroke: string;
  unit: string;
  /** Time in ms; `null` is a gap, not a zero value. */
  points: { t: number; value: number | null }[];
}

const HEIGHT = 96;
const MARGIN = { top: 8, bottom: 6, left: 36, right: 8 };
const AXIS = 18;
const STRIP = 40;

const clock = () => dateFormat({ hour: '2-digit', minute: '2-digit' });
const clockSeconds = () =>
  dateFormat({ hour: '2-digit', minute: '2-digit', second: '2-digit' });

const reasonLabel = (reason: EndSuggestion['reason']) =>
  reason === 'last_set'
    ? tr('letzter abgehakter Satz', 'last ticked set')
    : tr('letzte Bewegung', 'last movement');

/**
 * "Edit end" for a run and a strength session: tapping or swiping in the
 * history sets the end, ± moves it by one minute. What lies after it is dimmed
 * and no longer counts after saving; the original stays.
 */
export function EndEditor({
  startTime,
  rangeEnd,
  originalEnd,
  currentEnd,
  suggestion,
  lines,
  marks = [],
  emptyHint,
  busy,
  onSave,
  onReset,
}: {
  startTime: number;
  rangeEnd: number;
  /** Recorded or reported end, marked with a line. */
  originalEnd?: number;
  /** Correction set so far. */
  currentEnd?: number;
  suggestion?: EndSuggestion;
  lines: EndLine[];
  /** Times of ticked sets. */
  marks?: number[];
  emptyHint: string;
  busy: boolean;
  onSave: (endTime: number) => void;
  onReset?: () => void;
}) {
  const [width, setWidth] = useState(320);
  const [end, setEnd] = useState(() =>
    clampEnd(currentEnd ?? originalEnd ?? rangeEnd, startTime, rangeEnd),
  );
  const span = Math.max(1, rangeEnd - startTime);
  const plotWidth = Math.max(1, width - MARGIN.left - MARGIN.right);
  const xOf = (time: number) =>
    MARGIN.left +
    (Math.min(Math.max(time - startTime, 0), span) / span) * plotWidth;
  const pick = (event: GestureResponderEvent) => {
    const share = (event.nativeEvent.locationX - MARGIN.left) / plotWidth;
    setEnd(clampEnd(startTime + share * span, startTime, rangeEnd));
  };
  const shift = (minutes: number) =>
    setEnd(current =>
      clampEnd(current + minutes * 60_000, startTime, rangeEnd),
    );
  const drawable = lines.filter(
    line => line.points.filter(point => point.value !== null).length >= 2,
  );
  const tickMinutes =
    [5, 10, 15, 30, 60, 120].find(step => span / 60_000 / step <= 5) ?? 120;
  const ticks: number[] = [];
  for (let at = 0; at <= span; at += tickMinutes * 60_000)
    ticks.push(startTime + at);
  const changed = end !== (currentEnd ?? originalEnd);
  const marksAfter = marks.filter(time => time > end).length;

  const chart = (line: EndLine) => {
    const values = line.points
      .map(point => point.value)
      .filter((value): value is number => value !== null);
    const low = Math.min(...values);
    const high = Math.max(...values);
    const range = high - low || 1;
    const plotHeight = HEIGHT - MARGIN.top - MARGIN.bottom;
    const yOf = (value: number) =>
      MARGIN.top + (1 - (value - low) / range) * plotHeight;
    let path = '';
    let pen = false;
    line.points.forEach(point => {
      if (point.value === null) {
        pen = false;
        return;
      }
      path += `${pen ? 'L' : 'M'}${xOf(point.t).toFixed(1)},${yOf(
        point.value,
      ).toFixed(1)} `;
      pen = true;
    });
    return (
      <Svg key={line.key} width={width} height={HEIGHT}>
        <SvgText
          x={MARGIN.left - 6}
          y={MARGIN.top + 8}
          fontSize={10}
          fill={color.muted}
          textAnchor="end"
        >
          {String(Math.round(high))}
        </SvgText>
        <SvgText
          x={MARGIN.left - 6}
          y={HEIGHT - MARGIN.bottom}
          fontSize={10}
          fill={color.muted}
          textAnchor="end"
        >
          {String(Math.round(low))}
        </SvgText>
        {marks.map((time, index) => (
          <Line
            key={`m-${index}`}
            x1={xOf(time)}
            x2={xOf(time)}
            y1={MARGIN.top}
            y2={HEIGHT - MARGIN.bottom}
            stroke={color.muted}
            strokeOpacity={0.45}
            strokeDasharray="3 3"
          />
        ))}
        <Path
          d={path}
          stroke={line.stroke}
          strokeWidth={2}
          fill="none"
          strokeLinejoin="round"
        />
        <Rect
          x={xOf(end)}
          y={MARGIN.top}
          width={Math.max(0, MARGIN.left + plotWidth - xOf(end))}
          height={HEIGHT - MARGIN.top - MARGIN.bottom}
          fill={color.bg}
          opacity={0.6}
        />
        {originalEnd !== undefined && originalEnd <= rangeEnd ? (
          <Line
            x1={xOf(originalEnd)}
            x2={xOf(originalEnd)}
            y1={MARGIN.top}
            y2={HEIGHT - MARGIN.bottom}
            stroke={color.muted}
            strokeWidth={1}
          />
        ) : null}
        <Line
          x1={xOf(end)}
          x2={xOf(end)}
          y1={MARGIN.top}
          y2={HEIGHT - MARGIN.bottom}
          stroke={color.green}
          strokeWidth={2}
        />
      </Svg>
    );
  };

  return (
    <View style={styles.block}>
      <Text accessibilityLiveRegion="polite" style={styles.readout}>
        {tr(
          `Ende ${clockSeconds().format(new Date(end))} · Dauer ${formatElapsed(
            (end - startTime) / 1000,
          )}`,
          `End ${clockSeconds().format(
            new Date(end),
          )} · Duration ${formatElapsed((end - startTime) / 1000)}`,
        )}
      </Text>
      {drawable.length ? null : <Copy muted>{emptyHint}</Copy>}
      {marksAfter ? (
        <Copy muted>
          {tr(
            `${marksAfter} ${
              marksAfter === 1
                ? 'abgehakter Satz liegt'
                : 'abgehakte Sätze liegen'
            } danach und ${
              marksAfter === 1 ? 'zählt' : 'zählen'
            } dann nicht mehr.`,
            `${marksAfter} ${
              marksAfter === 1 ? 'ticked set falls' : 'ticked sets fall'
            } after this point and will no longer count.`,
          )}
        </Copy>
      ) : null}
      {drawable.length || marks.length ? (
        <View
          accessibilityRole="adjustable"
          accessibilityLabel={tr(
            `Verlauf von ${clock().format(
              new Date(startTime),
            )} bis ${clock().format(
              new Date(rangeEnd),
            )}. Tippe, wo die Einheit endete.`,
            `Trace from ${clock().format(
              new Date(startTime),
            )} to ${clock().format(
              new Date(rangeEnd),
            )}. Tap where the workout ended.`,
          )}
          onLayout={event => setWidth(event.nativeEvent.layout.width)}
          onStartShouldSetResponder={() => true}
          onMoveShouldSetResponder={() => true}
          onResponderTerminationRequest={() => false}
          onResponderGrant={pick}
          onResponderMove={pick}
        >
          {drawable.map(line => (
            <View key={line.key}>
              <Text
                style={styles.lineLabel}
              >{`${line.label} (${line.unit})`}</Text>
              {chart(line)}
            </View>
          ))}
          {drawable.length ? null : (
            <>
              <Text style={styles.lineLabel}>
                {tr('Abgehakte Sätze', 'Ticked sets')}
              </Text>
              <Svg width={width} height={STRIP}>
                {marks.map((time, index) => (
                  <Line
                    key={`s-${index}`}
                    x1={xOf(time)}
                    x2={xOf(time)}
                    y1={4}
                    y2={STRIP - 4}
                    stroke={color.text}
                    strokeWidth={2}
                  />
                ))}
                <Rect
                  x={xOf(end)}
                  y={0}
                  width={Math.max(0, MARGIN.left + plotWidth - xOf(end))}
                  height={STRIP}
                  fill={color.bg}
                  opacity={0.6}
                />
                <Line
                  x1={xOf(end)}
                  x2={xOf(end)}
                  y1={0}
                  y2={STRIP}
                  stroke={color.green}
                  strokeWidth={2}
                />
              </Svg>
            </>
          )}
          <Svg width={width} height={AXIS}>
            {ticks.map(time => (
              <SvgText
                key={time}
                x={xOf(time)}
                y={AXIS - 4}
                fontSize={10}
                fill={color.muted}
                textAnchor={time === startTime ? 'start' : 'middle'}
              >
                {clock().format(new Date(time))}
              </SvgText>
            ))}
          </Svg>
        </View>
      ) : null}
      <Row
        title={tr('Um eine Minute verschieben', 'Move by one minute')}
        trailing={
          <Stepper
            onDecrease={() => shift(-1)}
            onIncrease={() => shift(1)}
            decreaseLabel={tr('Eine Minute früher', 'One minute earlier')}
            increaseLabel={tr('Eine Minute später', 'One minute later')}
            canDecrease={end > startTime + MIN_DURATION_SECONDS * 1000}
            canIncrease={end < rangeEnd}
            disabled={busy}
          />
        }
      />
      {suggestion ? (
        <Button
          secondary
          title={tr(
            `${clock().format(
              new Date(suggestion.time),
            )} übernehmen · ${reasonLabel(suggestion.reason)}`,
            `Use ${clock().format(new Date(suggestion.time))} · ${reasonLabel(
              suggestion.reason,
            )}`,
          )}
          onPress={() => setEnd(clampEnd(suggestion.time, startTime, rangeEnd))}
          disabled={busy}
        />
      ) : null}
      <Button
        title={tr('Ende speichern', 'Save end')}
        onPress={() => onSave(end)}
        disabled={busy || !changed}
      />
      {onReset ? (
        <Button
          secondary
          title={tr('Ursprüngliches Ende', 'Original end')}
          onPress={onReset}
          disabled={busy}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  block: { gap: space.sm },
  readout: {
    color: color.text,
    ...type_.body,
    fontVariant: ['tabular-nums'],
  },
  lineLabel: { color: color.muted, ...type_.label, fontWeight: '400' },
});
