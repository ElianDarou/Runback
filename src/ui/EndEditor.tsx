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

export interface EndLine {
  key: string;
  label: string;
  stroke: string;
  unit: string;
  /** Zeit in ms; `null` ist eine Lücke, kein Nullwert. */
  points: { t: number; value: number | null }[];
}

const HEIGHT = 96;
const MARGIN = { top: 8, bottom: 6, left: 36, right: 8 };
const AXIS = 18;

const clock = new Intl.DateTimeFormat('de-DE', {
  hour: '2-digit',
  minute: '2-digit',
});
const clockSeconds = new Intl.DateTimeFormat('de-DE', {
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

const REASON: Record<EndSuggestion['reason'], string> = {
  last_set: 'letzter abgehakter Satz',
  last_movement: 'letzte Bewegung',
};

/**
 * „Ende bearbeiten“ für Lauf und Krafteinheit: Tippen oder Wischen im
 * Verlauf setzt das Ende, ± verschiebt um eine Minute. Was danach liegt, ist
 * abgedunkelt und zählt nach dem Speichern nicht mehr; das Original bleibt.
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
  /** Aufgezeichnetes oder gemeldetes Ende, als Strich markiert. */
  originalEnd?: number;
  /** Bisher gesetzte Korrektur. */
  currentEnd?: number;
  suggestion?: EndSuggestion;
  lines: EndLine[];
  /** Zeiten abgehakter Sätze. */
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
    MARGIN.left + (Math.min(Math.max(time - startTime, 0), span) / span) * plotWidth;
  const pick = (event: GestureResponderEvent) => {
    const share = (event.nativeEvent.locationX - MARGIN.left) / plotWidth;
    setEnd(clampEnd(startTime + share * span, startTime, rangeEnd));
  };
  const shift = (minutes: number) =>
    setEnd(current => clampEnd(current + minutes * 60_000, startTime, rangeEnd));
  const drawable = lines.filter(
    line => line.points.filter(point => point.value !== null).length >= 2,
  );
  const tickMinutes =
    [5, 10, 15, 30, 60, 120].find(step => span / 60_000 / step <= 5) ?? 120;
  const ticks: number[] = [];
  for (let at = 0; at <= span; at += tickMinutes * 60_000) ticks.push(startTime + at);
  const changed = end !== (currentEnd ?? originalEnd);

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
      path += `${pen ? 'L' : 'M'}${xOf(point.t).toFixed(1)},${yOf(point.value).toFixed(1)} `;
      pen = true;
    });
    return (
      <Svg key={line.key} width={width} height={HEIGHT}>
        <SvgText x={MARGIN.left - 6} y={MARGIN.top + 8} fontSize={10} fill={color.muted} textAnchor="end">
          {String(Math.round(high))}
        </SvgText>
        <SvgText x={MARGIN.left - 6} y={HEIGHT - MARGIN.bottom} fontSize={10} fill={color.muted} textAnchor="end">
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
        <Path d={path} stroke={line.stroke} strokeWidth={2} fill="none" strokeLinejoin="round" />
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
        {`Ende ${clockSeconds.format(new Date(end))} · Dauer ${formatElapsed(
          (end - startTime) / 1000,
        )}`}
      </Text>
      {drawable.length ? (
        <View
          accessibilityRole="adjustable"
          accessibilityLabel={`Verlauf von ${clock.format(new Date(startTime))} bis ${clock.format(
            new Date(rangeEnd),
          )}. Tippe, wo die Einheit endete.`}
          onLayout={event => setWidth(event.nativeEvent.layout.width)}
          onStartShouldSetResponder={() => true}
          onMoveShouldSetResponder={() => true}
          onResponderTerminationRequest={() => false}
          onResponderGrant={pick}
          onResponderMove={pick}
        >
          {drawable.map(line => (
            <View key={line.key}>
              <Text style={styles.lineLabel}>{`${line.label} (${line.unit})`}</Text>
              {chart(line)}
            </View>
          ))}
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
                {clock.format(new Date(time))}
              </SvgText>
            ))}
          </Svg>
        </View>
      ) : (
        <Copy muted>{emptyHint}</Copy>
      )}
      <Row
        title="Um eine Minute verschieben"
        trailing={
          <Stepper
            onDecrease={() => shift(-1)}
            onIncrease={() => shift(1)}
            decreaseLabel="Eine Minute früher"
            increaseLabel="Eine Minute später"
            canDecrease={end > startTime + MIN_DURATION_SECONDS * 1000}
            canIncrease={end < rangeEnd}
            disabled={busy}
          />
        }
      />
      {suggestion ? (
        <Button
          secondary
          title={`${clock.format(new Date(suggestion.time))} übernehmen · ${REASON[suggestion.reason]}`}
          onPress={() => setEnd(clampEnd(suggestion.time, startTime, rangeEnd))}
          disabled={busy}
        />
      ) : null}
      <Button title="Ende speichern" onPress={() => onSave(end)} disabled={busy || !changed} />
      {onReset ? (
        <Button secondary title="Ursprüngliches Ende" onPress={onReset} disabled={busy} />
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
