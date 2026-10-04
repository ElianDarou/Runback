import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { StatsDelta } from '../domain/statisticsView';
import {
  Chevron,
  Row,
  Stat,
  color,
  radius,
  space,
  type as type_,
} from './components';

/**
 * Bausteine der Statistikseite, geteilt von Laufen und Krafttraining:
 * Kennzahl mit Vergleich, ein Diagramm mit antippbaren Balken, eingeklappte
 * Abschnitte und Wertzeilen. Beide Bereiche sollen gleich aussehen und sich
 * gleich bedienen lassen.
 */

export const DASH = '–';

export const decimal = (value: number, digits = 1) =>
  value.toFixed(digits).replace('.', ',');

export const formatDuration = (seconds: number) => {
  const whole = Math.max(0, Math.round(seconds));
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  return hours ? `${hours} h ${minutes} min` : `${minutes} min`;
};

/** Kennzahl mit Vergleich. Der Pfeil ist die Richtung, der Prozentwert die
 *  Größe — Farbe trägt hier keine Information. */
export function Tile({
  value,
  unit,
  label,
  delta,
}: {
  value: string;
  unit: string;
  label: string;
  delta: StatsDelta;
}) {
  const arrow =
    delta.direction === 'up' ? '▲' : delta.direction === 'down' ? '▼' : '';
  const percent =
    delta.changeRatio === null
      ? DASH
      : `${Math.abs(Math.round(delta.changeRatio * 100))} %`;
  const spoken =
    delta.direction === 'up'
      ? `${percent} mehr`
      : delta.direction === 'down'
      ? `${percent} weniger`
      : delta.direction === 'flat'
      ? 'unverändert'
      : 'kein Vergleich möglich';
  return (
    <View
      accessible
      accessibilityLabel={`${label}: ${value} ${unit}, ${spoken}`}
      style={statsStyles.tile}
    >
      <Stat value={value} label={unit ? `${label} · ${unit}` : label} />
      {/* Ohne Vergleichszeitraum gibt es keinen Pfeil — und keinen Platzhalter. */}
      {delta.direction === 'unknown' ? null : (
        <Text style={statsStyles.tileDelta}>
          {delta.direction === 'flat' ? '± 0 %' : `${arrow} ${percent}`}
        </Text>
      )}
    </View>
  );
}

/**
 * Ein Diagramm, eine Achse. Balken für Kennzahlen mit echtem Nullpunkt,
 * Punkte für Tempo und Gefühl — dort wäre ein Balken ab null eine Lüge über
 * die Größenordnung. Der ausgewählte Wert ist grün, alle anderen sind Fläche.
 */
export interface ChartPoint {
  key: number;
  /** Kurze Achsenbeschriftung. */
  label: string;
  /** Ausgeschrieben für Vorlesetext. */
  fullLabel: string;
  value: number | null;
}

export function Chart({
  points: buckets,
  title,
  format,
  shape,
  selected,
  onSelect,
}: {
  points: ChartPoint[];
  /** Name der Kennzahl, für den Vorlesetext. */
  title: string;
  /** Wert und Einheit als Text; `null` wird zu „–“. */
  format: (value: number | null) => { value: string; unit: string };
  shape: 'bar' | 'point';
  selected: number | null;
  onSelect: (index: number) => void;
}) {
  const values = buckets.map(bucket => bucket.value);
  const present = values.filter(
    (value): value is number => value !== null && Number.isFinite(value),
  );
  const max = present.length ? Math.max(...present) : 0;
  const min = present.length ? Math.min(...present) : 0;
  // Punkte bekommen etwas Luft, damit der beste und der schlechteste Wert
  // nicht auf dem Rand kleben.
  const padding =
    shape === 'point' ? Math.max((max - min) * 0.2, max * 0.02) : 0;
  const low = shape === 'bar' ? 0 : min - padding;
  const high = shape === 'bar' ? max : max + padding;
  const span = high - low;
  const mean = present.length
    ? present.reduce((sum, value) => sum + value, 0) / present.length
    : null;
  const share = (value: number) =>
    span > 0 ? Math.min(Math.max((value - low) / span, 0), 1) : 0.5;

  // Bei vielen Balken trägt nicht jeder eine Beschriftung, sonst überlappen sie.
  const step = Math.ceil(buckets.length / 7);
  const scale = present.length
    ? shape === 'bar'
      ? `0 bis ${format(max).value}`
      : `${format(min).value} bis ${format(max).value}`
    : 'keine Werte';

  return (
    <View style={statsStyles.chartBlock}>
      <View style={statsStyles.chartHead}>
        <Text style={statsStyles.chartScale}>{`Skala ${scale} ${
          format(max).unit
        }`}</Text>
        {mean === null ? null : (
          <Text style={statsStyles.chartScale}>{`Ø ${format(mean).value}`}</Text>
        )}
      </View>
      <View
        accessibilityRole="adjustable"
        accessibilityLabel={`${title} je Zeitraum, ${buckets.length} Werte`}
        style={statsStyles.chart}
      >
        {buckets.map((bucket, index) => {
          const value = values[index];
          const isSelected = selected === index;
          const height = value === null ? 0 : share(value) * 100;
          const readout = format(value);
          return (
            <Pressable
              key={bucket.key}
              accessibilityRole="button"
              accessibilityLabel={`${bucket.fullLabel}: ${readout.value} ${readout.unit}`}
              accessibilityState={{ selected: isSelected }}
              onPress={() => onSelect(index)}
              style={statsStyles.column}
            >
              <View style={statsStyles.plot}>
                {value === null ? null : shape === 'bar' ? (
                  <View
                    style={[
                      statsStyles.bar,
                      { height: `${Math.max(height, 1.5)}%` },
                      isSelected && statsStyles.markSelected,
                    ]}
                  />
                ) : (
                  <View
                    style={[
                      statsStyles.dot,
                      { bottom: `${height}%` },
                      isSelected && statsStyles.markSelected,
                    ]}
                  />
                )}
              </View>
              <Text
                numberOfLines={1}
                style={[statsStyles.tick, isSelected && statsStyles.tickSelected]}
              >
                {isSelected || index % step === 0 ? bucket.label : ''}
              </Text>
            </Pressable>
          );
        })}
        {mean === null ? null : (
          // Liegt über den Marken und deckt genau die Zeichenfläche ab, nicht
          // die Spalte samt Beschriftung.
          <View pointerEvents="none" style={statsStyles.meanLayer}>
            <View style={[statsStyles.mean, { bottom: `${share(mean) * 100}%` }]} />
          </View>
        )}
      </View>
    </View>
  );
}

/** Eingeklappter Abschnitt. Der Titel trägt schon einen Wert, damit auch der
 *  geschlossene Zustand etwas sagt; `⌄` verspricht Inhalt an dieser Stelle. */
export function Panel({
  title,
  summary,
  children,
}: React.PropsWithChildren<{ title: string; summary: string }>) {
  const [open, setOpen] = useState(false);
  return (
    <View style={statsStyles.panel}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${title}, ${summary}`}
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen(value => !value)}
        style={({ pressed }) => [statsStyles.panelHead, pressed && statsStyles.pressed]}
      >
        <View style={statsStyles.panelText}>
          <Text style={statsStyles.panelTitle}>{title}</Text>
          <Text style={statsStyles.panelSummary}>{summary}</Text>
        </View>
        <Chevron open={open} />
      </Pressable>
      {open ? <View style={statsStyles.panelBody}>{children}</View> : null}
    </View>
  );
}

/** Beschriftung und Wert. `Row` ist der Baustein; der Wert hängt als
 *  `trailing` daran, damit keine zweite Zeilenvariante entsteht. */
export function ValueRow({
  label,
  value,
  meta,
  onPress,
  disabled,
}: {
  label: string;
  value: string;
  meta?: string | null;
  onPress?: () => void;
  disabled?: boolean;
}) {
  return (
    <Row
      title={label}
      subtitle={meta ?? undefined}
      onPress={onPress}
      disabled={disabled}
      trailing={<Text style={statsStyles.rowValue}>{value}</Text>}
    />
  );
}

/** Ein Anteil als Balken mit Beschriftung — Farbe ist nie die einzige Angabe. */
export function ShareRow({
  label,
  value,
  share,
  meta,
}: {
  label: string;
  value: string;
  /** 0 bis 1. */
  share: number;
  meta?: string;
}) {
  return (
    <View style={statsStyles.shareRow}>
      <View style={statsStyles.shareHead}>
        <Text style={statsStyles.shareLabel}>{label}</Text>
        <Text style={statsStyles.rowValue}>{value}</Text>
      </View>
      <View style={statsStyles.shareTrack}>
        <View
          style={[
            statsStyles.shareFill,
            { width: `${Math.max(Math.min(share, 1) * 100, 1)}%` },
          ]}
        />
      </View>
      {meta ? <Text style={statsStyles.shareMeta}>{meta}</Text> : null}
    </View>
  );
}

/** Was hinter einem angetippten Balken steckt — an Ort und Stelle. */
export function ChartDetail({
  title,
  value,
  meta,
}: {
  title: string;
  value: string;
  meta: string;
}) {
  return (
    <View accessibilityLiveRegion="polite" style={statsStyles.detail}>
      <Text style={statsStyles.detailTitle}>{title}</Text>
      <Text style={statsStyles.detailValue}>{value}</Text>
      <Text style={statsStyles.detailMeta}>{meta}</Text>
    </View>
  );
}

export const statsStyles = StyleSheet.create({
  page: { gap: space.md },
  title: { color: color.text, ...type_.title, letterSpacing: -0.6 },
  tiles: { flexDirection: 'row', gap: space.sm, paddingTop: space.xs },
  tile: { flex: 1, gap: space.xxs },
  tileDelta: {
    color: color.text,
    ...type_.micro,
    fontVariant: ['tabular-nums'],
  },
  compare: { ...type_.label, fontWeight: '400' },

  chartBlock: { gap: space.xs },
  chartHead: { flexDirection: 'row', justifyContent: 'space-between' },
  chartScale: {
    color: color.muted,
    ...type_.micro,
    fontVariant: ['tabular-nums'],
  },
  chart: { flexDirection: 'row', gap: space.xxs, alignItems: 'flex-end' },
  meanLayer: { position: 'absolute', left: 0, right: 0, top: 0, height: 132 },
  mean: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 1,
    backgroundColor: color.muted,
    opacity: 0.5,
  },
  column: { flex: 1, alignItems: 'center', gap: space.xxs, minHeight: 48 },
  plot: { width: '100%', height: 132, justifyContent: 'flex-end' },
  bar: { width: '100%', backgroundColor: color.line, borderRadius: radius.sm },
  dot: {
    position: 'absolute',
    left: '50%',
    width: 10,
    height: 10,
    marginLeft: -5,
    marginBottom: -5,
    borderRadius: radius.pill,
    backgroundColor: color.line,
  },
  markSelected: { backgroundColor: color.green },
  // Breiter als die Spalte, damit „13.09.“ nicht abgeschnitten wird; es
  // trägt ohnehin nur jede zweite oder dritte Spalte eine Beschriftung.
  tick: {
    width: 56,
    textAlign: 'center',
    height: 16,
    color: color.muted,
    ...type_.micro,
    fontSize: 10,
    fontVariant: ['tabular-nums'],
  },
  tickSelected: { color: color.text },

  detail: {
    backgroundColor: color.surface,
    borderRadius: radius.md,
    padding: space.md,
    gap: space.xxs,
  },
  detailTitle: { color: color.muted, ...type_.label, fontWeight: '400' },
  detailValue: {
    color: color.text,
    ...type_.body,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
  detailMeta: {
    color: color.muted,
    ...type_.label,
    fontWeight: '400',
    fontVariant: ['tabular-nums'],
  },

  panel: {
    borderBottomWidth: 1,
    borderBottomColor: color.line,
  },
  panelHead: {
    minHeight: 64,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingVertical: space.sm,
  },
  panelText: { flex: 1, gap: space.xxs },
  panelTitle: { color: color.text, ...type_.body, fontWeight: '500' },
  panelSummary: {
    color: color.muted,
    ...type_.label,
    fontWeight: '400',
    fontVariant: ['tabular-nums'],
  },
  panelBody: { paddingBottom: space.md, gap: space.xs },
  pressed: { opacity: 0.72 },

  shareRow: { gap: space.xxs, paddingVertical: space.xs },
  shareLabel: { color: color.text, ...type_.body },
  shareHead: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: space.xs,
  },
  shareTrack: {
    height: 6,
    borderRadius: radius.pill,
    backgroundColor: color.line,
    overflow: 'hidden',
  },
  shareFill: { height: '100%', backgroundColor: color.green },
  shareMeta: { color: color.muted, ...type_.micro },

  rowValue: {
    color: color.text,
    ...type_.body,
    fontWeight: '500',
    fontVariant: ['tabular-nums'],
  },
});
