import React, {
  memo,
  useContext,
  useMemo,
  useRef,
  useState,
  type PropsWithChildren,
  type ReactNode,
} from 'react';
import {
  Animated,
  Image as NativeImage,
  KeyboardAvoidingView,
  PanResponder,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
  useWindowDimensions,
  type GestureResponderEvent,
  type ImageStyle,
  type LayoutChangeEvent,
} from 'react-native';
import Svg, { Circle, Path, Rect, Text as SvgText } from 'react-native-svg';
import {
  SafeAreaInsetsContext,
  type EdgeInsets,
} from 'react-native-safe-area-context';
import type { RoutePoint } from '../native';
import { percentSign, tr } from '../domain/i18n';

/**
 * Shared building blocks for the whole interface. The binding rules for use,
 * text, and affordances are in docs/design-language.md. Screens don't define
 * their own colors, spacing, or font sizes.
 */
// BEGIN SHARED DESIGN TOKENS
export const color = {
  bg: '#101210',
  surface: '#1A1D1A',
  raised: '#242924',
  line: '#343B34',
  text: '#F2F4EF',
  muted: '#ADB5AB',
  green: '#A5D879',
  greenSoft: '#26331E',
  ink: '#14200E',
  danger: '#E4796B',
  /** Slightly worse than usual: text only, never as a surface. */
  caution: '#E8B04B',
  mapOverlay: '#101210D9',
  mapLine: '#F2F4EF3D',
  /**
   * Lines of the run graphs. The accent stays pace; heart rate, cadence, and
   * wind need their own tones, checked against `surface`, because they must
   * read side by side. Elevation is background and stays `muted`.
   */
  series: {
    heart: '#E66767',
    cadence: '#9085E9',
    headwind: '#D95926',
    tailwind: '#3987E5',
  },
};

export const space = {
  xxs: 4,
  xs: 8,
  sm: 12,
  md: 16,
  ml: 20,
  lg: 24,
  xl: 32,
  xxl: 40,
};

export const radius = { sm: 8, md: 12, lg: 16, pill: 999 };

export const type = {
  display: { fontSize: 56, lineHeight: 60, fontWeight: '400' as const },
  title: { fontSize: 28, lineHeight: 34, fontWeight: '600' as const },
  heading: { fontSize: 20, lineHeight: 26, fontWeight: '600' as const },
  value: { fontSize: 26, lineHeight: 30, fontWeight: '500' as const },
  body: { fontSize: 16, lineHeight: 24, fontWeight: '400' as const },
  label: { fontSize: 14, lineHeight: 20, fontWeight: '500' as const },
  micro: { fontSize: 12, lineHeight: 16, fontWeight: '500' as const },
};
// END SHARED DESIGN TOKENS

/** From this distance (or 40 % of the width), a swipe to the left deletes. */
const SWIPE_DELETE_MIN = 96;

/**
 * Row that can be swiped away from right to left. Behind it sits what happens
 * ("Delete"); a short swipe springs back. Screen readers get the same action
 * as `accessibilityActions`.
 */
export function SwipeToDelete({
  children,
  onDelete,
  enabled = true,
  label = tr('Löschen', 'Delete'),
  surface = color.raised,
}: PropsWithChildren<{
  onDelete: () => void;
  enabled?: boolean;
  label?: string;
  /** Surface of the row; covers the label behind it. */
  surface?: string;
}>) {
  const width = useRef(0);
  const offset = useRef(new Animated.Value(0)).current;
  const latest = useRef({ onDelete, enabled });
  latest.current = { onDelete, enabled };
  const responder = useMemo(() => {
    const back = () =>
      Animated.spring(offset, { toValue: 0, useNativeDriver: true }).start();
    return PanResponder.create({
      // Only clearly horizontal movement; vertical movement scrolls the list.
      onMoveShouldSetPanResponderCapture: (_, gesture) =>
        latest.current.enabled &&
        gesture.dx < -12 &&
        Math.abs(gesture.dx) > Math.abs(gesture.dy) * 1.5,
      onPanResponderTerminationRequest: () => false,
      onPanResponderMove: (_, gesture) =>
        offset.setValue(Math.min(0, gesture.dx)),
      onPanResponderRelease: (_, gesture) => {
        const threshold = Math.max(SWIPE_DELETE_MIN, width.current * 0.4);
        if (-gesture.dx >= threshold) {
          Animated.timing(offset, {
            toValue: -Math.max(width.current, threshold),
            duration: 140,
            useNativeDriver: true,
          }).start(() => {
            latest.current.onDelete();
            offset.setValue(0);
          });
        } else {
          back();
        }
      },
      onPanResponderTerminate: back,
    });
  }, [offset]);
  return (
    <View
      accessibilityActions={enabled ? [{ name: 'delete', label }] : []}
      onAccessibilityAction={event => {
        if (enabled && event.nativeEvent.actionName === 'delete') onDelete();
      }}
      onLayout={(event: LayoutChangeEvent) => {
        width.current = event.nativeEvent.layout.width;
      }}
    >
      {enabled ? (
        <View
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          pointerEvents="none"
          style={s.swipeBehind}
        >
          <Text style={s.swipeLabel}>{label}</Text>
        </View>
      ) : null}
      <Animated.View
        style={{
          backgroundColor: surface,
          transform: [{ translateX: offset }],
        }}
        {...responder.panHandlers}
      >
        {children}
      </Animated.View>
    </View>
  );
}

/** Spotify playback always retains the track's original cover alongside its metadata. */
/** Original Spotify mark: developer-assets.spotifycdn.com/images/guidelines/design/icon3.svg. */
export function SpotifyAttribution() {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs }}>
      <NativeImage
        source={require('../../assets/spotify-icon.png')}
        accessibilityRole="image"
        accessibilityLabel="Spotify"
        style={{ width: space.lg * 2, height: space.lg * 2 }}
      />
      <Copy muted>Spotify</Copy>
    </View>
  );
}

export function MusicArtwork({ uri, label }: { uri?: string; label: string }) {
  return uri?.startsWith('https://') ? (
    <NativeImage
      source={{ uri }}
      accessibilityRole="image"
      accessibilityLabel={label}
      style={{ width: space.xl * 2, height: space.xl * 2 }}
    />
  ) : null;
}

export function Title({ children }: PropsWithChildren) {
  return (
    <Text accessibilityRole="header" style={s.title}>
      {children}
    </Text>
  );
}

export function Button({
  title,
  onPress,
  secondary = false,
  danger = false,
  disabled = false,
  small = false,
  label,
}: {
  title: string;
  onPress: () => void;
  secondary?: boolean;
  danger?: boolean;
  disabled?: boolean;
  small?: boolean;
  /** Text read aloud when the visible label alone is ambiguous. */
  label?: string;
}) {
  const outlined = secondary || danger;
  return (
    <Pressable
      accessibilityLabel={label ?? title}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        s.button,
        outlined && s.secondary,
        small && s.small,
        disabled && s.disabled,
        pressed && s.pressed,
      ]}
    >
      <Text
        style={[
          s.buttonText,
          outlined && s.secondaryText,
          danger && s.dangerText,
        ]}
      >
        {title}
      </Text>
    </Pressable>
  );
}

/**
 * Minus and plus for a value that is adjusted step by step. Goes in a `Row`'s
 * `trailing` slot, and the row names the current value.
 */
export function Stepper({
  onDecrease,
  onIncrease,
  decreaseLabel,
  increaseLabel,
  canDecrease = true,
  canIncrease = true,
  disabled = false,
}: {
  onDecrease: () => void;
  onIncrease: () => void;
  /** Text read aloud, e.g. "5 seconds faster". */
  decreaseLabel: string;
  increaseLabel: string;
  canDecrease?: boolean;
  canIncrease?: boolean;
  disabled?: boolean;
}) {
  const step = (
    symbol: string,
    label: string,
    enabled: boolean,
    onPress: () => void,
  ) => (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{ disabled: disabled || !enabled }}
      disabled={disabled || !enabled}
      onPress={onPress}
      style={({ pressed }) => [
        s.stepperButton,
        (disabled || !enabled) && s.disabled,
        pressed && s.pressed,
      ]}
    >
      <Text style={s.stepperSymbol}>{symbol}</Text>
    </Pressable>
  );
  return (
    <View style={s.stepper}>
      {step('−', decreaseLabel, canDecrease, onDecrease)}
      {step('+', increaseLabel, canIncrease, onIncrease)}
    </View>
  );
}

export function Copy({
  children,
  muted = false,
  selectable = false,
  style,
}: PropsWithChildren<{
  muted?: boolean;
  selectable?: boolean;
  style?: object;
}>) {
  return (
    <Text selectable={selectable} style={[s.copy, muted && s.muted, style]}>
      {children}
    </Text>
  );
}

export function Card({
  children,
  style,
}: PropsWithChildren<{ style?: object }>) {
  return <View style={[s.card, style]}>{children}</View>;
}

export function Section({
  title,
  children,
}: PropsWithChildren<{ title: string }>) {
  return (
    <View style={s.section}>
      <Text accessibilityRole="header" style={s.sectionTitle}>
        {title}
      </Text>
      {children}
    </View>
  );
}

export function Row({
  title,
  subtitle,
  onPress,
  trailing,
  disabled = false,
}: {
  title: string;
  subtitle?: string;
  onPress?: () => void;
  trailing?: React.ReactNode;
  disabled?: boolean;
}) {
  const content = (
    <>
      <View style={s.rowText}>
        <Text style={s.rowTitle}>{title}</Text>
        {subtitle ? <Text style={s.rowSubtitle}>{subtitle}</Text> : null}
      </View>
      {trailing}
      {onPress ? <Text style={s.chevron}>›</Text> : null}
    </>
  );
  return onPress ? (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [s.row, pressed && s.pressed]}
    >
      {content}
    </Pressable>
  ) : (
    <View style={s.row}>{content}</View>
  );
}

/** The text area opens details; the switch next to it stays its own action. */
export function FeatureRow({
  title,
  subtitle,
  trailing,
  onPress,
  disabled = false,
}: {
  title: string;
  subtitle: string;
  trailing: React.ReactNode;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <View style={s.row}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={tr(`${title} einstellen`, `Set ${title}`)}
        accessibilityState={{ disabled }}
        disabled={disabled}
        onPress={onPress}
        style={({ pressed }) => [
          s.rowText,
          s.featureRowAction,
          pressed && s.pressed,
        ]}
      >
        <Text style={s.rowTitle}>
          {title} <Text style={s.chevron}>›</Text>
        </Text>
        <Text style={s.rowSubtitle}>{subtitle}</Text>
      </Pressable>
      {trailing}
    </View>
  );
}

/**
 * On or off for one thing. The optional gear opens the page where it is set
 * up; the text itself is not tappable.
 */
export function SwitchRow({
  title,
  subtitle,
  value,
  onChange,
  onSettings,
  disabled = false,
}: {
  title: string;
  subtitle?: string;
  value: boolean;
  onChange: (value: boolean) => void;
  onSettings?: () => void;
  disabled?: boolean;
}) {
  return (
    <View style={s.row}>
      <View style={s.rowText}>
        <Text style={s.rowTitle}>{title}</Text>
        {subtitle ? <Text style={s.rowSubtitle}>{subtitle}</Text> : null}
      </View>
      {onSettings ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={tr(`${title} einstellen`, `Set ${title}`)}
          accessibilityState={{ disabled }}
          disabled={disabled}
          onPress={onSettings}
          style={({ pressed }) => [s.iconButton, pressed && s.pressed]}
        >
          <Icon name="settings" />
        </Pressable>
      ) : null}
      <Switch
        accessibilityLabel={title}
        accessibilityRole="switch"
        accessibilityState={{ checked: value, disabled }}
        value={value}
        disabled={disabled}
        onValueChange={onChange}
        trackColor={{ false: color.line, true: color.green }}
        thumbColor={value ? color.ink : color.muted}
      />
    </View>
  );
}

/**
 * Row for a multi-select when a chip has too little room for the
 * explanation: ✓ in a box on the right, `checked` for screen readers.
 */
export function CheckRow({
  title,
  subtitle,
  checked,
  onToggle,
  disabled = false,
}: {
  title: string;
  subtitle?: string;
  checked: boolean;
  onToggle: (checked: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityLabel={title}
      accessibilityState={{ checked, disabled }}
      disabled={disabled}
      onPress={() => onToggle(!checked)}
      style={({ pressed }) => [
        s.row,
        disabled && s.disabled,
        pressed && s.pressed,
      ]}
    >
      <View style={s.rowText}>
        <Text style={s.rowTitle}>{title}</Text>
        {subtitle ? <Text style={s.rowSubtitle}>{subtitle}</Text> : null}
      </View>
      <View style={[s.checkBox, checked && s.chipSelected]}>
        <Text style={s.checkMark}>{checked ? '✓' : ''}</Text>
      </View>
    </Pressable>
  );
}

/**
 * Single choice directly on the page. Replaces dialogs whose options fit on
 * one line — a chip looks selectable and behaves that way too.
 */
export function ChipGroup<T extends string>({
  options,
  value,
  onChange,
  label,
  disabled = false,
}: {
  options: { value: T; label: string; disabled?: boolean }[];
  value: T;
  onChange: (value: T) => void;
  label?: string;
  disabled?: boolean;
}) {
  return (
    <View
      accessibilityRole="radiogroup"
      accessibilityLabel={label}
      style={s.chips}
    >
      {options.map(option => {
        const selected = option.value === value;
        const optionDisabled = disabled || option.disabled;
        return (
          <Pressable
            key={option.value}
            accessibilityRole="radio"
            accessibilityLabel={option.label}
            accessibilityState={{
              selected,
              checked: selected,
              disabled: optionDisabled,
            }}
            disabled={optionDisabled}
            onPress={() => onChange(option.value)}
            style={({ pressed }) => [
              s.chip,
              selected && s.chipSelected,
              optionDisabled && s.disabled,
              pressed && s.pressed,
            ]}
          >
            <Text style={[s.chipText, selected && s.chipTextSelected]}>
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/**
 * Multi-select as chips, e.g. weekdays. Each chip toggles on its own; selected
 * means a green border plus `checked`.
 */
export function ToggleChips<T extends string>({
  options,
  values,
  onToggle,
  label,
  disabled = false,
}: {
  options: { value: T; label: string }[];
  values: T[];
  onToggle: (value: T) => void;
  label?: string;
  disabled?: boolean;
}) {
  return (
    <View accessibilityLabel={label} style={s.chips}>
      {options.map(option => {
        const checked = values.includes(option.value);
        return (
          <Pressable
            key={option.value}
            accessibilityRole="checkbox"
            accessibilityLabel={option.label}
            accessibilityState={{ checked, disabled }}
            disabled={disabled}
            onPress={() => onToggle(option.value)}
            style={({ pressed }) => [
              s.chip,
              checked && s.chipSelected,
              disabled && s.disabled,
              pressed && s.pressed,
            ]}
          >
            <Text style={[s.chipText, checked && s.chipTextSelected]}>
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function Field({
  label,
  hint,
  children,
}: PropsWithChildren<{ label: string; hint?: string }>) {
  return (
    <View style={s.field}>
      <Text style={s.fieldLabel}>{label}</Text>
      {children}
      {hint ? <Text style={s.rowSubtitle}>{hint}</Text> : null}
    </View>
  );
}

export function Input({
  label,
  ...props
}: { label: string } & React.ComponentProps<typeof TextInput>) {
  return (
    <TextInput
      accessibilityLabel={label}
      placeholderTextColor={color.muted}
      selectionColor={color.green}
      {...props}
      style={[s.input, props.multiline && s.inputMultiline, props.style]}
    />
  );
}

export function Notice({
  children,
  title,
  onDismiss,
}: PropsWithChildren<{ title?: string; onDismiss?: () => void }>) {
  const body = (
    <>
      {title ? <Text style={s.noticeTitle}>{title}</Text> : null}
      <Text style={s.copy}>{children}</Text>
    </>
  );
  return onDismiss ? (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={tr('Meldung schließen', 'Dismiss message')}
      accessibilityLiveRegion="polite"
      onPress={onDismiss}
      style={({ pressed }) => [s.notice, pressed && s.pressed]}
    >
      {body}
    </Pressable>
  ) : (
    <View accessibilityLiveRegion="polite" style={s.notice}>
      {body}
    </View>
  );
}

/** Empty state: a title, one sentence, exactly one action. */
export function EmptyState({
  title,
  copy,
  action,
}: {
  title: string;
  copy: string;
  action?: { title: string; onPress: () => void };
}) {
  return (
    <View style={s.empty}>
      <Text accessibilityRole="header" style={s.emptyTitle}>
        {title}
      </Text>
      <Copy muted>{copy}</Copy>
      {action ? <Button title={action.title} onPress={action.onPress} /> : null}
    </View>
  );
}

/** How a number compares with recent runs. Never color alone: the arrow says the same thing. */
export type StatTone = 'better' | 'same' | 'slightly_worse' | 'worse';
const TONE_MARK: Record<StatTone, string> = {
  better: '▲',
  same: '',
  slightly_worse: '▽',
  worse: '▼',
};
const toneWord = (tone: StatTone): string => {
  switch (tone) {
    case 'better':
      return tr('besser als zuletzt', 'Better than last time');
    case 'same':
      return tr('wie zuletzt', 'Same as last time');
    case 'slightly_worse':
      return tr(
        'etwas schlechter als zuletzt',
        'Slightly worse than last time',
      );
    case 'worse':
      return tr('schlechter als zuletzt', 'Worse than last time');
  }
};
export function toneColor(tone: StatTone | undefined): string {
  return tone === 'better'
    ? color.green
    : tone === 'slightly_worse'
    ? color.caution
    : tone === 'worse'
    ? color.danger
    : color.text;
}

export function Stat({
  value,
  label,
  large = false,
  tone,
  delta,
}: {
  value: string;
  label: string;
  large?: boolean;
  /** Comparison with recent runs; colors the value and adds an arrow. */
  tone?: StatTone;
  /** Short comparison text under the label, e.g. "−0:08 /km". */
  delta?: string;
}) {
  const mark = tone ? TONE_MARK[tone] : '';
  return (
    <View
      style={s.stat}
      accessibilityLabel={
        tone ? `${value} ${label}, ${toneWord(tone)}` : undefined
      }
    >
      <Text
        adjustsFontSizeToFit
        numberOfLines={1}
        style={[
          s.statValue,
          large && s.statLarge,
          tone ? { color: toneColor(tone) } : null,
        ]}
      >
        {value}
        {mark ? <Text style={s.statMark}> {mark}</Text> : null}
      </Text>
      <Text style={s.statLabel}>{label}</Text>
      {delta ? <Text style={s.statDelta}>{delta}</Text> : null}
    </View>
  );
}

/**
 * A bar made of several shares, e.g. a run's time budget. Each share has a
 * color and a label; the legend below names the values so color isn't the
 * only information.
 */
export function StackedBar({
  label,
  parts,
}: {
  label: string;
  parts: { value: number; color: string; label: string; text: string }[];
}) {
  const total = parts.reduce((sum, part) => sum + Math.max(part.value, 0), 0);
  if (total <= 0) return null;
  return (
    <View style={s.stacked}>
      <View
        accessibilityRole="image"
        accessibilityLabel={`${label}: ${parts
          .map(part => `${part.label} ${part.text}`)
          .join(', ')}`}
        style={s.stackedBar}
      >
        {parts.map(part =>
          part.value > 0 ? (
            <View
              key={part.label}
              style={{
                flex: part.value / total,
                backgroundColor: part.color,
              }}
            />
          ) : null,
        )}
      </View>
      <View style={s.stackedLegend}>
        {parts.map(part => (
          <View key={part.label} style={s.stackedItem}>
            <View style={[s.swatch, { backgroundColor: part.color }]} />
            <Text style={s.stackedText}>
              {part.label} <Text style={s.stackedValue}>{part.text}</Text>
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}

/**
 * Switch between two or three equal views of the same page (Workouts ·
 * Statistics, Running · Strength training). Unlike `ChipGroup`, it stands for
 * views, not inputs, and fills the full width.
 */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  label?: string;
}) {
  return (
    <View
      accessibilityRole="radiogroup"
      accessibilityLabel={label}
      style={s.segmented}
    >
      {options.map(option => {
        const selected = option.value === value;
        return (
          <Pressable
            key={option.value}
            accessibilityRole="radio"
            accessibilityLabel={option.label}
            accessibilityState={{ selected, checked: selected }}
            onPress={() => onChange(option.value)}
            style={({ pressed }) => [
              s.segment,
              selected && s.segmentSelected,
              pressed && s.pressed,
            ]}
          >
            <Text
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.8}
              style={[s.segmentText, selected && s.segmentTextSelected]}
            >
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** Also named in the button label in the header; color is never the only information. */
export function ConnectionMark({
  mark,
}: {
  mark: 'connected' | 'attention' | null;
}) {
  return mark ? (
    <Text
      accessible={false}
      style={{
        color: mark === 'attention' ? color.danger : color.green,
        ...type.label,
      }}
    >
      ●
    </Text>
  ) : null;
}

/** Visible state as a small label: Suggestion · Active · Paused. */
export function Badge({
  children,
  muted = false,
}: PropsWithChildren<{ muted?: boolean }>) {
  return (
    <View style={[s.badge, muted && s.badgeMuted]}>
      <Text style={[s.badgeText, muted && s.badgeTextMuted]}>{children}</Text>
    </View>
  );
}

/** Progress of a check as a bar. `value` between 0 and 1. */
export function Progress({ value, label }: { value: number; label: string }) {
  const clamped = Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
  return (
    <View
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      accessibilityValue={{ min: 0, max: 100, now: Math.round(clamped * 100) }}
      style={s.progress}
    >
      <View style={[s.progressFill, { width: `${clamped * 100}%` }]} />
    </View>
  );
}

/**
 * Goal progress as a ring that fills. `value` between 0 and 1; the number in
 * the middle as text, so color isn't the only information. Without a value the
 * ring stays empty and shows "–".
 */
export function Ring({
  value,
  label,
  caption,
  size = 96,
}: {
  value: number | null;
  label: string;
  /** Short text under the number, e.g. "Goal progress". */
  caption?: string;
  size?: number;
}) {
  const clamped =
    value === null || !Number.isFinite(value)
      ? null
      : Math.max(0, Math.min(1, value));
  const stroke = 8;
  const r = (size - stroke) / 2;
  const circumference = 2 * Math.PI * r;
  const percent = clamped === null ? null : Math.round(clamped * 100);
  return (
    <View
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      accessibilityValue={
        percent === null
          ? undefined
          : {
              min: 0,
              max: 100,
              now: percent,
              text: `${percent}${percentSign()}`,
            }
      }
      style={[s.ring, { width: size, height: size }]}
    >
      <Svg width={size} height={size}>
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={color.line}
          strokeWidth={stroke}
          fill="none"
        />
        {clamped !== null && clamped > 0 ? (
          <Circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            stroke={color.green}
            strokeWidth={stroke}
            strokeLinecap="round"
            fill="none"
            strokeDasharray={`${circumference} ${circumference}`}
            strokeDashoffset={circumference * (1 - clamped)}
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
          />
        ) : null}
      </Svg>
      <View style={s.ringCenter} pointerEvents="none">
        <Text style={s.ringValue}>
          {percent === null ? '–' : `${percent}${percentSign()}`}
        </Text>
        {caption ? <Text style={s.ringCaption}>{caption}</Text> : null}
      </View>
    </View>
  );
}

/**
 * Expands content in place (symbol `⌄`). For side paths that should stay on
 * the page: details, managing, more figures.
 */
export function Disclosure({
  title,
  subtitle,
  children,
  defaultOpen = false,
  open: controlledOpen,
  onToggle,
}: PropsWithChildren<{
  title: string;
  subtitle?: string;
  defaultOpen?: boolean;
  open?: boolean;
  onToggle?: (open: boolean) => void;
}>) {
  const [localOpen, setLocalOpen] = useState(defaultOpen);
  const open = controlledOpen ?? localOpen;
  const toggle = () => {
    setLocalOpen(!open);
    onToggle?.(!open);
  };
  return (
    <View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={title}
        accessibilityState={{ expanded: open }}
        onPress={toggle}
        style={({ pressed }) => [s.row, pressed && s.pressed]}
      >
        <View style={s.rowText}>
          <Text style={s.rowTitle}>{title}</Text>
          {subtitle ? <Text style={s.rowSubtitle}>{subtitle}</Text> : null}
        </View>
        <Chevron open={open} />
      </Pressable>
      {open ? <View style={s.disclosureBody}>{children}</View> : null}
    </View>
  );
}

/**
 * The expand symbol `⌄`, drawn as a rotated `›`: the system font sets `⌄`
 * small on the baseline, where it looks like a "v".
 */
export function Chevron({ open = false }: { open?: boolean }) {
  return (
    <Text
      accessible={false}
      importantForAccessibility="no"
      style={[s.chevron, open ? s.chevronUp : s.chevronDown]}
    >
      ›
    </Text>
  );
}

// Without a provider (tests with a stub), insets count as zero.
const InsetsContext: React.Context<EdgeInsets | null> =
  SafeAreaInsetsContext ?? React.createContext<EdgeInsets | null>(null);

/**
 * Bottom sheet for decisions made in the moment: starting a workout, editing a
 * workout. The page underneath stays visible so it's clear where you return.
 */
export function Sheet({
  visible,
  title,
  onClose,
  children,
}: PropsWithChildren<{
  visible: boolean;
  title: string;
  onClose: () => void;
}>) {
  const insets = useContext(InsetsContext);
  const { height } = useWindowDimensions();
  return (
    <Modal
      visible={visible}
      transparent
      // Full screen height; the sheet sets its own bottom spacing.
      statusBarTranslucent
      navigationBarTranslucent
      animationType="slide"
      onRequestClose={onClose}
    >
      {/* Android adjusts the modal window to the keyboard by itself. */}
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={s.sheetBackdrop}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={tr(`${title} schließen`, `Close ${title}`)}
          onPress={onClose}
          style={s.sheetScrim}
        />
        <ScrollView
          // A number, not a percentage: on Android a percentage didn't hold, so
          // long sheets reached below the screen edge and their end was out of reach.
          style={[s.sheetScroll, { maxHeight: height * 0.88 }]}
          contentContainerStyle={[
            s.sheetCard,
            // The sheet reaches below the navigation bar.
            { paddingBottom: space.lg + (insets?.bottom ?? 0) },
          ]}
          keyboardShouldPersistTaps="handled"
        >
          <View style={s.sheetGrip} />
          <Text accessibilityRole="header" style={s.sheetTitle}>
            {title}
          </Text>
          {children}
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

export function Icon({
  name,
  selected = false,
}: {
  name: string;
  selected?: boolean;
}) {
  const paths: Record<string, string> = {
    today: 'M4 12L12 5L20 12M6 10V21H18V10M10 21V15H14V21',
    plan: 'M8 2V6M16 2V6M3 10H21M5 4H19A2 2 0 0 1 21 6V20A2 2 0 0 1 19 22H5A2 2 0 0 1 3 20V6A2 2 0 0 1 5 4M8 14H8.01M12 14H12.01M16 14H16.01M8 18H8.01M12 18H12.01',
    history: 'M4 20V13M10 20V7M16 20V10M3 20H21',
    coach:
      'M12 21A9 9 0 1 0 12 3A9 9 0 0 0 12 21M12 16A4 4 0 1 0 12 8A4 4 0 0 0 12 16M12 12H12.01',
    settings:
      'M12 15A3 3 0 1 0 12 9A3 3 0 0 0 12 15M19.4 15A1.65 1.65 0 0 0 19.73 16.82L19.79 16.88A2 2 0 1 1 16.96 19.71L16.9 19.65A1.65 1.65 0 0 0 15.08 19.32A1.65 1.65 0 0 0 14.08 20.83V21A2 2 0 1 1 10.08 21V20.91A1.65 1.65 0 0 0 9 19.4A1.65 1.65 0 0 0 7.18 19.73L7.12 19.79A2 2 0 1 1 4.29 16.96L4.35 16.9A1.65 1.65 0 0 0 4.68 15.08A1.65 1.65 0 0 0 3.17 14.08H3A2 2 0 1 1 3 10.08H3.09A1.65 1.65 0 0 0 4.6 9A1.65 1.65 0 0 0 4.27 7.18L4.21 7.12A2 2 0 1 1 7.04 4.29L7.1 4.35A1.65 1.65 0 0 0 8.92 4.68H9A1.65 1.65 0 0 0 10 3.17V3A2 2 0 1 1 14 3V3.09A1.65 1.65 0 0 0 15 4.6A1.65 1.65 0 0 0 16.82 4.27L16.88 4.21A2 2 0 1 1 19.71 7.04L19.65 7.1A1.65 1.65 0 0 0 19.32 8.92V9A1.65 1.65 0 0 0 20.83 10H21A2 2 0 1 1 21 14H20.91A1.65 1.65 0 0 0 19.4 15',
    statistics: 'M4 20V13M10 20V7M16 20V10M3 20H21',
    routes: 'M6 20C6 15 18 17 18 11S6 10 6 4M4 4H8M4 20H8',
    templates: 'M6 3H21V19H6ZM3 7V22H17M10 7H17M10 11H17M10 15H14',
    soreness:
      'M10 4A2 2 0 1 0 14 4A2 2 0 1 0 10 4M8 8H16L18 14M6 14L8 8M10 8V15L8 21M14 8V15L16 21',
    more: 'M4 7H20M4 12H20M4 17H20',
  };
  return (
    <Svg width={23} height={23} viewBox="0 0 24 24">
      <Path
        d={paths[name] || paths.more}
        stroke={selected ? color.green : color.muted}
        strokeWidth={1.65}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </Svg>
  );
}

const ROUTE_VIEWBOX_WIDTH = 360;
const ROUTE_VIEWBOX_HEIGHT = 260;
const ROUTE_PADDING = 28;
const TILE_SIZE = 256;
const TILE_MIN_ZOOM = 10;
const TILE_MAX_ZOOM = 18;
const MAX_ROUTE_POINTS = 512;
const MAP_TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const MAP_TILE_HEADERS = {
  Accept: 'image/png,image/*;q=0.8',
  'User-Agent':
    'Runback/0.1 (https://github.com/GhostCodeByte/Runback; route map)',
};

type Point = [number, number];
type Tile = {
  key: string;
  url: string;
  left: number;
  top: number;
  size: number;
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Web Mercator projection in pixels. Only for map tiles, not for analysis. */
function worldPixel(latitude: number, longitude: number, zoom: number): Point {
  const safeLatitude = clamp(latitude, -85.05112878, 85.05112878);
  const scale = TILE_SIZE * 2 ** zoom;
  const radians = (safeLatitude * Math.PI) / 180;
  return [
    ((longitude + 180) / 360) * scale,
    (0.5 -
      Math.log((1 + Math.sin(radians)) / (1 - Math.sin(radians))) /
        (4 * Math.PI)) *
      scale,
  ];
}

function bounds(points: Point[]) {
  const xs = points.map(point => point[0]);
  const ys = points.map(point => point[1]);
  return {
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minY: Math.min(...ys),
    maxY: Math.max(...ys),
  };
}

type MapPoint = Pick<RoutePoint, 'latitude' | 'longitude'> & {
  gap?: boolean;
};

function validMapPoint(point: MapPoint | undefined): point is MapPoint {
  return Boolean(
    point &&
      Number.isFinite(point.latitude) &&
      Number.isFinite(point.longitude),
  );
}

function routeZoom(points: MapPoint[]): number {
  for (let zoom = TILE_MAX_ZOOM; zoom >= TILE_MIN_ZOOM; zoom -= 1) {
    const projected = points.map(point =>
      worldPixel(point.latitude, point.longitude, zoom),
    );
    const range = bounds(projected);
    const spanX = Math.max(range.maxX - range.minX, 1);
    const spanY = Math.max(range.maxY - range.minY, 1);
    const widthRatio = spanX / (ROUTE_VIEWBOX_WIDTH - ROUTE_PADDING * 2);
    const heightRatio = spanY / (ROUTE_VIEWBOX_HEIGHT - ROUTE_PADDING * 2);
    if (Math.max(widthRatio, heightRatio) <= 1.2) {
      return zoom;
    }
  }
  return TILE_MIN_ZOOM;
}

/** Keeps start, end, and gaps without cutting off the finish on long runs. */
function sampleRoute(points: RoutePoint[]): RoutePoint[] {
  const valid = points.filter(
    point =>
      Number.isFinite(point.latitude) && Number.isFinite(point.longitude),
  );
  if (valid.length <= MAX_ROUTE_POINTS) {
    return valid;
  }

  const indexes = new Set<number>([0, valid.length - 1]);
  valid.forEach((point, index) => {
    if (point.gap) {
      indexes.add(index);
    }
  });
  const target = Math.max(0, MAX_ROUTE_POINTS - indexes.size);
  for (let i = 0; i < target; i += 1) {
    indexes.add(Math.round((i * (valid.length - 1)) / Math.max(target - 1, 1)));
  }
  return Array.from(indexes)
    .sort((left, right) => left - right)
    .slice(0, MAX_ROUTE_POINTS)
    .map(index => valid[index]);
}

function mapTiles(
  range: { minX: number; maxX: number; minY: number; maxY: number },
  scale: number,
  zoom: number,
): Tile[] {
  const worldPadding = ROUTE_PADDING / Math.max(scale, 0.0001);
  const firstX = Math.floor((range.minX - worldPadding) / TILE_SIZE) - 1;
  const lastX = Math.floor((range.maxX + worldPadding) / TILE_SIZE) + 1;
  const firstY = Math.floor((range.minY - worldPadding) / TILE_SIZE) - 1;
  const lastY = Math.floor((range.maxY + worldPadding) / TILE_SIZE) + 1;
  const worldTiles = 2 ** zoom;
  const tiles: Tile[] = [];

  for (let tileY = firstY; tileY <= lastY; tileY += 1) {
    if (tileY < 0 || tileY >= worldTiles) {
      continue;
    }
    for (let tileX = firstX; tileX <= lastX; tileX += 1) {
      const wrappedX = ((tileX % worldTiles) + worldTiles) % worldTiles;
      tiles.push({
        key: `${zoom}/${tileX}/${tileY}`,
        url: MAP_TILE_URL.replace('{z}', String(zoom))
          .replace('{x}', String(wrappedX))
          .replace('{y}', String(tileY)),
        left: ROUTE_PADDING + (tileX * TILE_SIZE - range.minX) * scale,
        top: ROUTE_PADDING + (tileY * TILE_SIZE - range.minY) * scale,
        size: TILE_SIZE * scale,
      });
    }
  }
  return tiles;
}

function markerLabel(
  point: Point,
  label: string,
  width: number,
  placement: 'above' | 'below' = 'above',
) {
  const left = clamp(point[0] + 12, 8, ROUTE_VIEWBOX_WIDTH - width - 8);
  const top = clamp(
    placement === 'above' ? point[1] - 34 : point[1] + 12,
    8,
    ROUTE_VIEWBOX_HEIGHT - 30,
  );
  return (
    <>
      <Rect
        x={left}
        y={top}
        width={width}
        height={22}
        rx={11}
        fill={color.mapOverlay}
        stroke={color.text}
        strokeOpacity={0.24}
        strokeWidth={1}
      />
      <SvgText
        x={left + width / 2}
        y={top + 15}
        fill={color.text}
        fontSize={10}
        fontWeight="700"
        textAnchor="middle"
      >
        {label}
      </SvgText>
    </>
  );
}

function mapProjection(points: MapPoint[]) {
  const zoom = routeZoom(points);
  const projected = points.map(point =>
    worldPixel(point.latitude, point.longitude, zoom),
  );
  const worldRange = bounds(projected);
  const spanX = Math.max(worldRange.maxX - worldRange.minX, 1);
  const spanY = Math.max(worldRange.maxY - worldRange.minY, 1);
  const scale = Math.min(
    (ROUTE_VIEWBOX_WIDTH - ROUTE_PADDING * 2) / spanX,
    (ROUTE_VIEWBOX_HEIGHT - ROUTE_PADDING * 2) / spanY,
  );
  const project = (point: MapPoint): Point => {
    const world = worldPixel(point.latitude, point.longitude, zoom);
    return [
      ROUTE_PADDING + (world[0] - worldRange.minX) * scale,
      ROUTE_PADDING + (world[1] - worldRange.minY) * scale,
    ];
  };
  return {
    xy: projected.map(
      point =>
        [
          ROUTE_PADDING + (point[0] - worldRange.minX) * scale,
          ROUTE_PADDING + (point[1] - worldRange.minY) * scale,
        ] as Point,
    ),
    tiles: mapTiles(worldRange, scale, zoom),
    project,
  };
}

/** Touch in view pixels → viewBox coordinates (the Svg fills centered, "meet"). */
function svgPointFromTouch(
  x: number,
  y: number,
  width: number,
  height: number,
): Point {
  const k = Math.min(
    width / ROUTE_VIEWBOX_WIDTH,
    height / ROUTE_VIEWBOX_HEIGHT,
  );
  if (!(k > 0)) return [x, y];
  return [
    (x - (width - ROUTE_VIEWBOX_WIDTH * k) / 2) / k,
    (y - (height - ROUTE_VIEWBOX_HEIGHT * k) / 2) / k,
  ];
}

/** Extra map layers for the detail page: active moment, kilometers, highlighted section. */
export interface RouteOverlay {
  /** Active moment; white ring so it stands out from start/finish and kilometers. */
  focus?: MapPoint;
  /** Section (e.g. one kilometer) that is highlighted. */
  highlight?: MapPoint[];
  markers?: { point: MapPoint; label: string }[];
  /** Short note in the top right, e.g. wind. */
  note?: string;
  /** Tap or drag on the map: nearest route point. */
  onPick?: (point: RoutePoint) => void;
}

function mapTileStyle(tile: Tile): ImageStyle {
  return {
    left: `${(tile.left / ROUTE_VIEWBOX_WIDTH) * 100}%`,
    top: `${(tile.top / ROUTE_VIEWBOX_HEIGHT) * 100}%`,
    width: `${(tile.size / ROUTE_VIEWBOX_WIDTH) * 100}%`,
    height: `${(tile.size / ROUTE_VIEWBOX_HEIGHT) * 100}%`,
  } as ImageStyle;
}

function RouteSurface({
  planned,
  track,
  current,
  mode,
  accessibilityLabel,
  overlay,
}: {
  planned: MapPoint[];
  track: MapPoint[];
  current?: MapPoint;
  mode: 'planned' | 'live' | 'recorded';
  accessibilityLabel: string;
  overlay?: RouteOverlay;
}) {
  const [size, setSize] = useState<{ width: number; height: number } | null>(
    null,
  );
  const validPlanned = planned.filter(validMapPoint).slice(0, MAX_ROUTE_POINTS);
  const validTrack = track.filter(validMapPoint).slice(0, MAX_ROUTE_POINTS);
  const validCurrent = validMapPoint(current) ? current : undefined;
  const valid = [
    ...validPlanned,
    ...validTrack,
    ...(validCurrent ? [validCurrent] : []),
  ];
  if (valid.length < 2) {
    const hasRecordedTrack = mode === 'recorded';
    return (
      <View
        accessible
        accessibilityRole="image"
        accessibilityLabel={accessibilityLabel}
        style={[s.route, s.routeEmpty]}
      >
        <View pointerEvents="none" style={s.mapFallback} />
        <View pointerEvents="none" style={s.routeEmptyContent}>
          <Text style={s.routeEmptyTitle}>
            {hasRecordedTrack
              ? tr('Keine GPS-Strecke', 'No GPS route')
              : tr('Route wird geladen', 'Loading route')}
          </Text>
          <Text style={s.routeEmptyCopy}>
            {hasRecordedTrack
              ? tr(
                  'Für diese Einheit wurde keine Route gespeichert.',
                  'No route was saved for this workout.',
                )
              : tr(
                  'Die Kartendaten werden vorbereitet.',
                  'Map data is being prepared.',
                )}
          </Text>
        </View>
      </View>
    );
  }

  const { xy, tiles, project } = mapProjection(valid);
  const pointToSvg = (point: MapPoint) => {
    const index = valid.indexOf(point);
    return index >= 0 ? xy[index] : project(point);
  };
  const onPick = overlay?.onPick;
  // Tap/drag: nearest route point in image coordinates. The gesture stays on
  // the map so the list below doesn't scroll.
  const pick = (event: GestureResponderEvent) => {
    if (!onPick || !size || validTrack.length < 2) return;
    const { locationX, locationY } = event.nativeEvent;
    const [x, y] = svgPointFromTouch(
      locationX,
      locationY,
      size.width,
      size.height,
    );
    let best = 0;
    let bestDistance = Infinity;
    validTrack.forEach((point, index) => {
      const [px, py] = pointToSvg(point);
      const d = (px - x) ** 2 + (py - y) ** 2;
      if (d < bestDistance) {
        bestDistance = d;
        best = index;
      }
    });
    onPick(validTrack[best] as RoutePoint);
  };
  const responder = onPick
    ? {
        onLayout: (event: LayoutChangeEvent) =>
          setSize({
            width: event.nativeEvent.layout.width,
            height: event.nativeEvent.layout.height,
          }),
        onStartShouldSetResponder: () => true,
        onMoveShouldSetResponder: () => true,
        onResponderTerminationRequest: () => false,
        onResponderGrant: pick,
        onResponderMove: pick,
      }
    : {};

  const pathFor = (points: MapPoint[]) => {
    const usable = points.filter(validMapPoint);
    return usable
      .map((point, index) => {
        const [x, y] = pointToSvg(point);
        return `${index === 0 || point.gap ? 'M' : 'L'}${x.toFixed(
          2,
        )},${y.toFixed(2)}`;
      })
      .join(' ');
  };
  const startPoint = validPlanned[0] || validTrack[0];
  const finishPoint =
    validPlanned[validPlanned.length - 1] || validTrack[validTrack.length - 1];
  const start = pointToSvg(startPoint);
  const finish = pointToSvg(finishPoint);
  const currentPoint =
    mode === 'recorded' ? undefined : validCurrent || validTrack.at(-1);
  const currentSvg = currentPoint ? pointToSvg(currentPoint) : undefined;
  const plannedPath = pathFor(validPlanned);
  const trackPath = pathFor(validTrack);
  const highlightPath =
    overlay?.highlight && overlay.highlight.length >= 2
      ? pathFor(overlay.highlight)
      : '';
  const focus = validMapPoint(overlay?.focus)
    ? pointToSvg(overlay.focus)
    : undefined;

  return (
    <View
      accessible
      accessibilityRole={onPick ? 'adjustable' : 'image'}
      accessibilityLabel={accessibilityLabel}
      style={s.route}
      {...responder}
    >
      <View pointerEvents="none" style={s.routeLayer}>
        <View style={s.mapTiles}>
          {tiles.map(tile => (
            <NativeImage
              key={tile.key}
              accessible={false}
              source={{
                uri: tile.url,
                headers: MAP_TILE_HEADERS,
                cache: 'force-cache',
              }}
              resizeMode="cover"
              style={[s.mapTile, mapTileStyle(tile)]}
            />
          ))}
        </View>
        <View style={s.routeScrim} />
      </View>
      <View pointerEvents="none" style={s.routeBadge}>
        <Text style={s.routeBadgeText}>
          {mode === 'live'
            ? tr('Live-Route', 'Live route')
            : tr('GPS-Route', 'GPS route')}
        </Text>
      </View>
      {overlay?.note ? (
        <View pointerEvents="none" style={[s.routeBadge, s.routeNote]}>
          <Text style={s.routeBadgeText}>{overlay.note}</Text>
        </View>
      ) : null}
      <Svg
        height="100%"
        pointerEvents="none"
        style={s.routeLayer}
        viewBox={`0 0 ${ROUTE_VIEWBOX_WIDTH} ${ROUTE_VIEWBOX_HEIGHT}`}
        width="100%"
      >
        {mode === 'live' && validPlanned.length >= 2 ? (
          <>
            <Path
              d={plannedPath}
              stroke={color.ink}
              strokeWidth={9}
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeDasharray="8 8"
              fill="none"
              opacity={0.92}
            />
            <Path
              d={plannedPath}
              stroke={color.text}
              strokeWidth={5}
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeDasharray="8 8"
              fill="none"
            />
          </>
        ) : mode !== 'live' && validPlanned.length >= 2 ? (
          <>
            <Path
              d={plannedPath}
              stroke={color.ink}
              strokeWidth={10}
              strokeLinecap="round"
              strokeLinejoin="round"
              fill="none"
              opacity={0.9}
            />
            <Path
              d={plannedPath}
              stroke={color.green}
              strokeWidth={5.5}
              strokeLinecap="round"
              strokeLinejoin="round"
              fill="none"
            />
          </>
        ) : null}
        {(mode === 'live' || mode === 'recorded') && validTrack.length >= 2 ? (
          <>
            <Path
              d={trackPath}
              stroke={color.ink}
              strokeWidth={10}
              strokeLinecap="round"
              strokeLinejoin="round"
              fill="none"
              opacity={0.92}
            />
            <Path
              d={trackPath}
              stroke={color.green}
              strokeWidth={6}
              strokeLinecap="round"
              strokeLinejoin="round"
              fill="none"
            />
          </>
        ) : null}
        {highlightPath ? (
          <Path
            d={highlightPath}
            stroke={color.text}
            strokeWidth={6}
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
          />
        ) : null}
        <Circle
          cx={start[0]}
          cy={start[1]}
          r={8}
          fill={color.text}
          stroke={color.ink}
          strokeWidth={3}
        />
        <Circle
          cx={finish[0]}
          cy={finish[1]}
          r={8}
          fill={color.green}
          stroke={color.ink}
          strokeWidth={3}
        />
        {overlay?.markers
          ?.filter(marker => validMapPoint(marker.point))
          .map(marker => {
            const [x, y] = pointToSvg(marker.point);
            return (
              <React.Fragment key={marker.label}>
                <Circle
                  cx={x}
                  cy={y}
                  r={8}
                  fill={color.mapOverlay}
                  stroke={color.green}
                  strokeWidth={1.5}
                />
                <SvgText
                  x={x}
                  y={y + 3.5}
                  fill={color.text}
                  fontSize={9}
                  fontWeight="700"
                  textAnchor="middle"
                >
                  {marker.label}
                </SvgText>
              </React.Fragment>
            );
          })}
        {overlay?.markers?.length
          ? null
          : markerLabel(start, 'Start', 48, 'above')}
        {overlay?.markers?.length
          ? null
          : markerLabel(finish, tr('Ziel', 'Finish'), 42, 'below')}
        {focus ? (
          <>
            <Circle
              cx={focus[0]}
              cy={focus[1]}
              r={13}
              fill="none"
              stroke={color.text}
              strokeWidth={2}
              opacity={0.6}
            />
            <Circle
              cx={focus[0]}
              cy={focus[1]}
              r={6}
              fill={color.text}
              stroke={color.ink}
              strokeWidth={3}
            />
          </>
        ) : null}
        {currentSvg ? (
          <Circle
            cx={currentSvg[0]}
            cy={currentSvg[1]}
            r={10}
            fill={color.green}
            stroke={color.ink}
            strokeWidth={4}
          />
        ) : null}
      </Svg>
      <View pointerEvents="none" style={s.mapAttribution}>
        <Text style={s.mapAttributionText}>
          {tr('© OpenStreetMap-Mitwirkende', '© OpenStreetMap contributors')}
        </Text>
      </View>
    </View>
  );
}

export const Route = memo(function Route({
  points,
  overlay,
}: {
  points: RoutePoint[];
  overlay?: RouteOverlay;
}) {
  const valid = sampleRoute(points);
  return (
    <RouteSurface
      planned={[]}
      track={valid}
      mode="recorded"
      overlay={overlay}
      accessibilityLabel={
        valid.length >= 2
          ? overlay?.onPick
            ? tr(
                'Aufgezeichnete GPS-Strecke mit OpenStreetMap-Karte. Antippen wählt einen Moment des Laufs.',
                'Recorded GPS route on an OpenStreetMap map. Tap to pick a moment of the run.',
              )
            : tr(
                'Aufgezeichnete GPS-Strecke mit OpenStreetMap-Karte. Start und Ziel sind markiert.',
                'Recorded GPS route on an OpenStreetMap map. Start and finish are marked.',
              )
          : tr('Keine GPS-Strecke aufgezeichnet', 'No GPS route recorded')
      }
    />
  );
});

/**
 * Map view for planned and running routes. The street map comes as normal
 * React Native image tiles with an identifying User-Agent; that prevents the
 * 403 block of the public OSM tile server.
 */
export const RouteMap = memo(function RouteMap({
  planned,
  track = [],
  current,
}: {
  planned: MapPoint[];
  track?: MapPoint[];
  current?: MapPoint;
}) {
  return (
    <RouteSurface
      planned={planned}
      track={track}
      current={current}
      mode={track.length > 1 || current ? 'live' : 'planned'}
      accessibilityLabel={tr(
        'Geplante Laufstrecke auf einer OpenStreetMap-Karte mit Start, Ziel und bisheriger Position',
        'Planned running route on an OpenStreetMap map with start, finish, and current position',
      )}
    />
  );
});

export function RouteOpenActions({
  onGoogleMaps,
  onCoMaps,
  disabled = false,
  embedded = false,
}: {
  onGoogleMaps: () => void;
  onCoMaps: () => void;
  disabled?: boolean;
  /** Without its own heading, e.g. inside a `Disclosure`. */
  embedded?: boolean;
}) {
  const actions = (
    <>
      <Button
        secondary
        title={tr('In Google Maps öffnen', 'Open in Google Maps')}
        onPress={onGoogleMaps}
        disabled={disabled}
      />
      <Button
        secondary
        title={tr(
          'In CoMaps oder anderer App öffnen',
          'Open in CoMaps or another app',
        )}
        onPress={onCoMaps}
        disabled={disabled}
      />
      <Copy muted>
        {tr(
          'Google Maps rechnet die Route neu, CoMaps übernimmt sie genau.',
          'Google Maps recalculates the route, CoMaps uses it exactly.',
        )}
      </Copy>
    </>
  );
  return embedded ? (
    actions
  ) : (
    <Section
      title={tr('Route in Karten-App öffnen', 'Open route in a maps app')}
    >
      {actions}
    </Section>
  );
}

export type { ReactNode };

export const s = StyleSheet.create({
  featureRowAction: { minHeight: 48, justifyContent: 'center' },
  swipeBehind: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'flex-end',
    justifyContent: 'center',
    paddingHorizontal: space.md,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: color.danger,
  },
  swipeLabel: { ...type.label, color: color.danger },
  title: { color: color.text, ...type.title, letterSpacing: -0.6 },
  button: {
    minHeight: 54,
    borderRadius: radius.md,
    backgroundColor: color.green,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: space.ml,
    paddingVertical: space.md,
  },
  secondary: {
    backgroundColor: color.surface,
    borderColor: color.line,
    borderWidth: 1,
  },
  small: { minHeight: 48, paddingVertical: space.sm },
  stepper: { flexDirection: 'row', gap: space.xs },
  stepperButton: {
    minWidth: 56,
    minHeight: 56,
    borderRadius: radius.md,
    backgroundColor: color.surface,
    borderColor: color.line,
    borderWidth: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  stepperSymbol: { color: color.text, ...type.value },
  disabled: { opacity: 0.4 },
  pressed: { opacity: 0.72 },
  buttonText: { color: color.ink, ...type.body, fontWeight: '700' },
  secondaryText: { color: color.text },
  dangerText: { color: color.danger },
  copy: { color: color.text, ...type.body },
  muted: { color: color.muted },
  card: {
    backgroundColor: color.surface,
    borderRadius: radius.md,
    padding: space.lg,
    gap: space.md,
  },
  section: { marginTop: space.xl, gap: space.sm },
  sectionTitle: { color: color.text, ...type.heading },
  row: {
    minHeight: 64,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingVertical: space.md,
    borderBottomWidth: 1,
    borderBottomColor: color.line,
  },
  rowText: { flex: 1, gap: space.xxs },
  rowTitle: { color: color.text, ...type.body, fontWeight: '500' },
  rowSubtitle: { color: color.muted, ...type.label, fontWeight: '400' },
  chevron: { fontSize: 26, color: color.muted, width: 24, textAlign: 'center' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs },
  chip: {
    minHeight: 48,
    justifyContent: 'center',
    paddingHorizontal: space.md,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: color.line,
    backgroundColor: color.surface,
  },
  chipSelected: {
    backgroundColor: color.greenSoft,
    borderColor: color.green,
  },
  checkBox: {
    width: 28,
    height: 28,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: color.line,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkMark: { color: color.green, ...type.label, fontWeight: '700' },
  iconButton: {
    minWidth: 48,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipText: { color: color.muted, ...type.label },
  chipTextSelected: { color: color.text, fontWeight: '600' },
  field: { gap: space.xs },
  fieldLabel: { color: color.text, ...type.label },
  input: {
    borderWidth: 1,
    borderColor: color.line,
    borderRadius: radius.sm,
    paddingHorizontal: space.sm,
    paddingVertical: space.sm,
    color: color.text,
    backgroundColor: color.surface,
    ...type.body,
    minHeight: 52,
  },
  inputMultiline: { minHeight: 96, textAlignVertical: 'top' },
  notice: {
    backgroundColor: color.raised,
    borderRadius: radius.sm,
    padding: space.md,
    gap: space.xxs,
    borderLeftWidth: 3,
    borderLeftColor: color.green,
  },
  noticeTitle: { color: color.text, ...type.label, fontWeight: '700' },
  empty: { paddingVertical: space.xxl, gap: space.md },
  emptyTitle: { color: color.text, ...type.heading },
  segmented: {
    flexDirection: 'row',
    backgroundColor: color.surface,
    borderRadius: radius.md,
    padding: space.xxs,
    gap: space.xxs,
  },
  segment: {
    flex: 1,
    minHeight: 48,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space.xs,
  },
  segmentSelected: { backgroundColor: color.raised },
  segmentText: { color: color.muted, ...type.label },
  segmentTextSelected: { color: color.text, fontWeight: '600' },
  badge: {
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderColor: color.green,
    borderRadius: radius.pill,
    paddingHorizontal: space.xs,
    paddingVertical: 2,
  },
  badgeMuted: { borderColor: color.muted },
  badgeText: { color: color.green, ...type.micro, fontWeight: '600' },
  badgeTextMuted: { color: color.muted },
  progress: {
    height: 6,
    borderRadius: radius.pill,
    backgroundColor: color.line,
    overflow: 'hidden',
  },
  progressFill: { height: '100%', backgroundColor: color.green },
  ring: { alignItems: 'center', justifyContent: 'center' },
  ringCenter: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ringValue: {
    color: color.text,
    ...type.heading,
    fontVariant: ['tabular-nums'],
  },
  ringCaption: { color: color.muted, ...type.micro },
  chevronDown: { transform: [{ rotate: '90deg' }] },
  chevronUp: { transform: [{ rotate: '-90deg' }] },
  disclosureBody: { paddingTop: space.sm, gap: space.sm },
  sheetBackdrop: { flex: 1, justifyContent: 'flex-end' },
  sheetScrim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: color.mapOverlay,
  },
  sheetScroll: { flexGrow: 0 },
  sheetCard: {
    backgroundColor: color.raised,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    padding: space.lg,
    paddingTop: space.sm,
    gap: space.sm,
  },
  sheetGrip: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: radius.pill,
    backgroundColor: color.line,
    marginBottom: space.xs,
  },
  sheetTitle: { color: color.text, ...type.heading },
  stat: { flex: 1, gap: space.xxs },
  statValue: {
    color: color.text,
    ...type.value,
    fontVariant: ['tabular-nums'],
  },
  statLarge: { ...type.display },
  statLabel: { color: color.muted, ...type.label, fontWeight: '400' },
  statMark: { ...type.label, fontWeight: '600' },
  statDelta: {
    color: color.muted,
    ...type.label,
    fontWeight: '400',
    fontVariant: ['tabular-nums'],
  },
  stacked: { gap: space.xs },
  stackedBar: {
    flexDirection: 'row',
    height: 12,
    borderRadius: radius.sm,
    overflow: 'hidden',
    backgroundColor: color.raised,
  },
  stackedLegend: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  stackedItem: { flexDirection: 'row', alignItems: 'center', gap: space.xxs },
  swatch: { width: 10, height: 10, borderRadius: 3 },
  stackedText: { color: color.muted, ...type.label, fontWeight: '400' },
  stackedValue: {
    color: color.text,
    fontWeight: '500',
    fontVariant: ['tabular-nums'],
  },
  route: {
    height: ROUTE_VIEWBOX_HEIGHT,
    backgroundColor: color.surface,
    borderRadius: radius.md,
    overflow: 'hidden',
  },
  routeLayer: {
    ...StyleSheet.absoluteFillObject,
  },
  mapTiles: {
    ...StyleSheet.absoluteFillObject,
    overflow: 'hidden',
    backgroundColor: color.surface,
  },
  mapTile: { position: 'absolute', backgroundColor: color.surface },
  mapFallback: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: color.surface,
  },
  routeScrim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: color.mapOverlay,
    opacity: 0.16,
  },
  routeBadge: {
    position: 'absolute',
    left: space.md,
    top: space.md,
    minHeight: 28,
    justifyContent: 'center',
    paddingHorizontal: space.sm,
    borderRadius: radius.pill,
    backgroundColor: color.mapOverlay,
    borderWidth: 1,
    borderColor: color.mapLine,
  },
  routeBadgeText: { color: color.text, ...type.micro, fontWeight: '700' },
  routeNote: { left: undefined, right: space.md },
  mapAttribution: {
    position: 'absolute',
    right: space.xs,
    bottom: space.xs,
    paddingHorizontal: space.xs,
    paddingVertical: 2,
    borderRadius: radius.sm,
    backgroundColor: color.mapOverlay,
  },
  mapAttributionText: { color: color.text, ...type.micro, fontSize: 10 },
  routeEmpty: { justifyContent: 'center', alignItems: 'center' },
  routeEmptyContent: {
    alignItems: 'center',
    paddingHorizontal: space.lg,
  },
  routeEmptyTitle: { color: color.text, ...type.heading },
  routeEmptyCopy: {
    color: color.muted,
    ...type.label,
    textAlign: 'center',
    marginTop: space.xs,
  },
});
