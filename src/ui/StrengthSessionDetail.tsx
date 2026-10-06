import React, { useMemo, useState } from 'react';
import {
  StyleSheet,
  Text,
  View,
  type GestureResponderEvent,
} from 'react-native';
import Svg, { Circle, Line, Path, Text as SvgText } from 'react-native-svg';
import type { Rating } from '../domain/insights';
import { muscleDistribution } from '../domain/muscleGroups';
import {
  formatWeight,
  isSetCompleted,
  sessionProgress,
  type SessionExercise,
  type StrengthSession,
} from '../domain/strength';
import {
  heartPoints,
  sessionHeartInsight,
  isWatchHeart,
  heartSourceLabel,
  STRENGTH_HEART_INSIGHTS_VERSION,
  type StrengthHeart,
  type StrengthHeartSummary,
} from '../domain/strengthHeart';
import {
  exerciseBreakdown,
  exerciseComparison,
  sessionComparison,
  sessionDurationSeconds,
  setGaps,
  setLabel,
  STRENGTH_SESSION_VERSION,
  type ComparedValue,
  type ExerciseBreakdown,
} from '../domain/strengthSession';
import {
  strengthWatchCaptureLabel,
  strengthWatchTransfer,
  type StrengthWatchInfo,
} from '../domain/wearLink';
import {
  Badge,
  Copy,
  Disclosure,
  Row,
  Section,
  Stat,
  Title,
  color,
  space,
  toneColor,
  type as type_,
} from './components';
import {
  DASH,
  Panel,
  ShareRow,
  ValueRow,
  decimal,
  formatDuration,
  statsStyles,
} from './StatsParts';
import { formatClock } from './StrengthStatistics';

/**
 * Detail einer Krafteinheit — so tief wie die Detailseite eines Laufs:
 * Kennzahlen mit Vergleich, der Puls der Uhr über die Zeit mit den
 * abgehakten Sätzen, jede Übung gegen frühere Einheiten, darunter Muskeln,
 * Pausen und Vergleich eingeklappt. Gezeigt wird nur, was bestätigt wurde;
 * Planwerte erscheinen nicht als Ist-Werte (T-6).
 */

const kilograms = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 0 });
const dateFormat = new Intl.DateTimeFormat('de-DE', {
  weekday: 'long',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
});
const timeFormat = new Intl.DateTimeFormat('de-DE', {
  hour: '2-digit',
  minute: '2-digit',
});

const counted = (count: number, singular: string, plural: string) =>
  `${count} ${count === 1 ? singular : plural}`;

const RATING_MARK: Record<Rating, string> = {
  better: '▲',
  same: '',
  slightly_worse: '▽',
  worse: '▼',
};

const signedPercent = (value: number) => {
  const rounded = Math.round(value);
  return rounded === 0
    ? '± 0 %'
    : `${rounded > 0 ? '+' : '−'}${Math.abs(rounded)} %`;
};

/** Bestätigte Sätze einer Übung als Wertekette. Übersprungene werden benannt,
 *  nicht verschwiegen. */
export function setsChain(exercise: SessionExercise): string {
  const parts = exercise.sets
    .filter(set => isSetCompleted(set) || set.skipped)
    .map(set => {
      if (set.skipped) {
        return 'übersprungen';
      }
      const label = setLabel({
        weightKg: set.actualWeightKg,
        reps: set.actualReps,
        seconds: set.actualSeconds,
      });
      return label
        ? `${label}${set.planned?.kind === 'warmup' ? ' (Aufwärmen)' : ''}`
        : 'ohne Werte';
    });
  return parts.length ? parts.join(' · ') : 'Kein bestätigter Satz';
}

/**
 * Ob die Daten der Uhr schon hier sind. Nur sichtbar, wenn etwas fehlt —
 * ist der Puls da, zeigt ihn die Seite ohnehin.
 */
function WatchTransferRow({
  watch,
  hasHeart,
}: {
  watch: StrengthWatchInfo | null;
  hasHeart: boolean;
}) {
  const transfer = strengthWatchTransfer(watch);
  if (!watch || !transfer) return null;
  const what = strengthWatchCaptureLabel(watch);
  if (transfer === 'received') {
    if (hasHeart || !watch.capture.heartRate) return null;
    return (
      <Row
        title="Uhr"
        subtitle="Die Uhr hat keinen gültigen Puls gemessen."
        trailing={<Badge muted>Übertragen</Badge>}
      />
    );
  }
  return (
    <View accessibilityLiveRegion="polite">
      <Row
        title="Uhr"
        subtitle={
          transfer === 'waiting'
            ? `${what} ${
                what === 'Puls' ? 'kommt' : 'kommen'
              }, sobald die Uhr in der Nähe ist.`
            : watch.watch.message || 'Die Uhr hat nicht aufgezeichnet.'
        }
        trailing={
          <Badge muted>
            {transfer === 'waiting' ? 'Wartet' : 'Nicht aufgezeichnet'}
          </Badge>
        }
      />
    </View>
  );
}

/** „+12 %“ unter einer Kennzahl; der Satz darunter nennt die Basis. Farbe
 *  trägt hier nichts. */
const deltaLine = (value: ComparedValue | undefined) =>
  value ? signedPercent(value.deltaPercent) : undefined;

export function StrengthSessionDetail({
  session,
  history,
  heart,
  watch = null,
  heartSummaries,
  onOpenExercise,
  onEditEnd,
  busy = false,
}: {
  /** Was die Uhr zu dieser Einheit gemessen und übertragen hat; `null` ohne Uhr. */
  watch?: StrengthWatchInfo | null;
  session: StrengthSession;
  /** Alle abgeschlossenen Einheiten; die Seite sucht sich die früheren. */
  history: StrengthSession[];
  /** Puls dieser Einheit mit Reihe; fehlt ohne Uhr. */
  heart?: StrengthHeart;
  heartSummaries: Record<string, StrengthHeartSummary>;
  onOpenExercise?: (exerciseId: string) => void;
  /** Öffnet „Ende bearbeiten“; fehlt bei laufenden Einheiten. */
  onEditEnd?: () => void;
  busy?: boolean;
}) {
  const progress = sessionProgress(session);
  const seconds = sessionDurationSeconds(session);
  const parts = useMemo(() => exerciseBreakdown(session), [session]);
  const comparison = useMemo(
    () => sessionComparison(session, history, heartSummaries),
    [session, history, heartSummaries],
  );
  const heartInsight = useMemo(
    () => (heart ? sessionHeartInsight(session, heart) : undefined),
    [session, heart],
  );
  const muscles = useMemo(() => muscleDistribution([session]), [session]);
  const gaps = useMemo(() => setGaps(session), [session]);
  const topGroup = muscles.groups[0];
  const confirmed = session.exercises.flatMap(exercise =>
    exercise.sets.filter(set => isSetCompleted(set) && !set.skipped),
  );
  const withWeight = confirmed.filter(
    set => (set.actualWeightKg ?? 0) > 0 && (set.actualReps ?? 0) > 0,
  ).length;
  const end = session.endTime;

  return (
    <>
      <Title>{session.name || 'Krafttraining'}</Title>
      <Copy muted>
        {`${dateFormat.format(new Date(session.startTime))} · ${timeFormat.format(
          new Date(session.startTime),
        )}${end ? `–${timeFormat.format(new Date(end))}` : ''}`}
      </Copy>
      {session.importSource ? (
        <Copy muted>
          {`Importiert aus ${session.importSource.source === 'strong' ? 'Strong' : session.importSource.source}${session.importSource.incomplete ? ' · Unvollständig' : ''}`}
        </Copy>
      ) : null}
      {session.endCorrection ? (
        <Copy muted>
          {session.endCorrection.originalEndTime
            ? `Ende von dir gesetzt · ursprünglich ${timeFormat.format(
                new Date(session.endCorrection.originalEndTime),
              )}`
            : 'Ende von dir gesetzt'}
        </Copy>
      ) : null}
      {session.importSource?.rejectedDurationSeconds && !session.endCorrection ? (
        <Copy muted>
          {`Ende unbekannt — die Einheit wurde erst nach ${formatDuration(
            session.importSource.rejectedDurationSeconds,
          )} beendet.`}
        </Copy>
      ) : null}
      <View style={styles.metrics}>
        <Stat
          value={seconds === undefined ? DASH : formatDuration(seconds)}
          label="Dauer"
          delta={deltaLine(comparison?.durationSeconds)}
        />
        <Stat
          value={String(progress.completedSets)}
          label="Sätze"
          delta={deltaLine(comparison?.sets)}
        />
        <Stat
          value={
            progress.volumeKg > 0 ? kilograms.format(progress.volumeKg) : DASH
          }
          label="Volumen kg"
          delta={deltaLine(comparison?.volumeKg)}
        />
        {heart ? (
          <Stat
            value={String(Math.round(heart.averageBpm))}
            label="Ø Puls"
            delta={deltaLine(comparison?.averageBpm)}
          />
        ) : null}
      </View>
      {comparison ? (
        <Copy muted>
          {`Prozent gegenüber dem Median deiner letzten ${comparison.sessionIds.length} Einheiten ${
            comparison.basis === 'template'
              ? 'aus dieser Vorlage'
              : 'mit diesem Namen'
          }.`}
        </Copy>
      ) : null}

      <WatchTransferRow watch={watch} hasHeart={Boolean(heart)} />

      {heart && heartInsight ? (
        <Section title="Puls">
          <HeartChart session={session} heart={heart} />
          {heartInsight.medianRecoveryBpm !== undefined ? (
            <Copy>
              {`In der ersten Pausenminute fiel dein Puls im Schnitt um ${Math.round(
                heartInsight.medianRecoveryBpm,
              )} Schläge.`}
            </Copy>
          ) : null}
          <ValueRow label="Ø Puls" value={`${Math.round(heart.averageBpm)} bpm`} />
          <ValueRow
            label="Höchster Puls"
            value={`${Math.round(heart.maxBpm)} bpm`}
          />
          {isWatchHeart(heart) ? (
          <>
          <ValueRow
            label="Puls am Satzende"
            value={
              heartInsight.medianPeakBpm === undefined
                ? DASH
                : `${Math.round(heartInsight.medianPeakBpm)} bpm`
            }
            meta="Median · höchster Wert kurz vor und nach dem Abhaken"
          />
          <ValueRow
            label="Abfall in der ersten Pausenminute"
            value={
              heartInsight.medianRecoveryBpm === undefined
                ? DASH
                : `${Math.round(heartInsight.medianRecoveryBpm)} bpm`
            }
            meta={`Median aus ${counted(
              heartInsight.recoverySets,
              'Satz',
              'Sätzen',
            )} mit mindestens zwei Minuten Pause`}
          />
          </>
          ) : (
            <Copy muted>{`Puls aus ${heartSourceLabel(heart)}, je Minute gemittelt.`}</Copy>
          )}
          {heart.coverage < 0.8 ? (
            <Copy muted>
              {`${isWatchHeart(heart) ? 'Die Uhr' : heartSourceLabel(heart)} hatte nur ${Math.round(
                heart.coverage * 100,
              )} % der Zeit einen Pulswert; Lücken bleiben leer.`}
            </Copy>
          ) : null}
        </Section>
      ) : null}

      <Section title="Übungen">
        {parts.length ? (
          parts.map(part => (
            <ExerciseLine
              key={`${part.exerciseId}-${part.exerciseIndex}`}
              part={part}
              session={session}
              history={history}
              peakBpm={
                heartInsight?.byExercise.find(
                  entry => entry.exerciseIndex === part.exerciseIndex,
                )?.peakBpm
              }
              onPress={onOpenExercise}
              disabled={busy}
            />
          ))
        ) : (
          <Copy muted>In dieser Einheit ist keine Übung erfasst.</Copy>
        )}
      </Section>

      <Section title="Tiefer schauen">
        <Panel
          title="Muskeln"
          summary={
            topGroup
              ? `${topGroup.label} · ${counted(topGroup.sets, 'Satz', 'Sätze')}`
              : DASH
          }
        >
          {muscles.groups.map(group => (
            <ShareRow
              key={group.group}
              label={group.label}
              value={counted(group.sets, 'Satz', 'Sätze')}
              share={topGroup ? group.sets / topGroup.sets : 0}
            />
          ))}
          {muscles.unassignedSets > 0 ? (
            <Copy muted>
              {`${counted(
                muscles.unassignedSets,
                'Satz',
                'Sätze',
              )} ohne bekannte Muskelgruppe.`}
            </Copy>
          ) : null}
          {!muscles.groups.length && !muscles.unassignedSets ? (
            <Copy muted>Keine Arbeitssätze abgehakt.</Copy>
          ) : null}
        </Panel>
        <Panel
          title="Pausen"
          summary={
            gaps.medianSeconds === undefined
              ? DASH
              : `Satzabstand ${formatClock(gaps.medianSeconds)}`
          }
        >
          <ValueRow
            label="Satzabstand"
            value={
              gaps.medianSeconds === undefined
                ? DASH
                : formatClock(gaps.medianSeconds)
            }
            meta="Median · Abhaken bis Abhaken derselben Übung, Satz eingeschlossen"
          />
          <ValueRow
            label="Geplante Pause"
            value={
              gaps.plannedMedianSeconds === undefined
                ? DASH
                : formatClock(gaps.plannedMedianSeconds)
            }
          />
          {gaps.gaps.length ? (
            <ValueRow
              label="Kürzester · längster Abstand"
              value={`${formatClock(Math.min(...gaps.gaps))} · ${formatClock(
                Math.max(...gaps.gaps),
              )}`}
            />
          ) : null}
        </Panel>
        {comparison ? (
          <Panel
            title="Vergleich"
            summary={`${counted(
              comparison.sessionIds.length,
              'frühere Einheit',
              'frühere Einheiten',
            )}`}
          >
            <ComparedRow
              label="Volumen"
              value={comparison.volumeKg}
              format={value => `${kilograms.format(value)} kg`}
            />
            <ComparedRow
              label="Sätze"
              value={comparison.sets}
              format={value => decimal(value, Number.isInteger(value) ? 0 : 1)}
            />
            <ComparedRow
              label="Dauer"
              value={comparison.durationSeconds}
              format={formatDuration}
            />
            <ComparedRow
              label="Ø Puls"
              value={comparison.averageBpm}
              format={value => `${Math.round(value)} bpm`}
            />
          </Panel>
        ) : null}
      </Section>

      {session.note ? (
        <Section title="Notiz">
          <Copy>{session.note}</Copy>
        </Section>
      ) : null}

      {onEditEnd && session.status === 'finished' ? (
        <Row
          title="Ende bearbeiten"
          subtitle="Vergessen zu beenden? Wähle im Verlauf, wann Schluss war."
          onPress={onEditEnd}
          disabled={busy}
        />
      ) : null}
      <Disclosure title="Details" subtitle="Datenbasis und Versionen">
        {confirmed.length > 0 &&
        withWeight > 0 &&
        withWeight < confirmed.length ? (
          <Copy muted>
            {`Volumen aus ${withWeight} von ${counted(
              confirmed.length,
              'Satz',
              'Sätzen',
            )} mit Gewicht.`}
          </Copy>
        ) : null}
        <Copy muted>
          Das Maximum ist eine Schätzung nach Epley aus Arbeitssätzen bis zwölf
          Wiederholungen, keine Messung.
        </Copy>
        {heart ? (
          <Copy muted>
            {`Puls von ${isWatchHeart(heart) ? 'der Uhr' : heartSourceLabel(heart)} in ${heart.stepSeconds}-s-Fenstern, ${Math.round(
              heart.coverage * 100,
            )} % abgedeckt${
              heart.clockAligned
                ? ''
                : '; Uhr und Handy ohne Abgleich, Satzzeiten können einige Sekunden daneben liegen'
            }.`}
          </Copy>
        ) : null}
        <Copy muted>
          {[
            session.modelVersion,
            session.catalogVersion,
            session.importSource?.importVersion,
            STRENGTH_SESSION_VERSION,
            heart ? heart.model_version : null,
            heart ? STRENGTH_HEART_INSIGHTS_VERSION : null,
            muscles.version,
          ]
            .filter(Boolean)
            .join(' · ')}
        </Copy>
      </Disclosure>
    </>
  );
}

function ComparedRow({
  label,
  value,
  format,
}: {
  label: string;
  value: ComparedValue | undefined;
  format: (value: number) => string;
}) {
  if (!value) {
    return null;
  }
  return (
    <ValueRow
      label={label}
      value={format(value.value)}
      meta={`Median ${format(value.median)} · ${signedPercent(
        value.deltaPercent,
      )}`}
    />
  );
}

function ExerciseLine({
  part,
  session,
  history,
  peakBpm,
  onPress,
  disabled,
}: {
  part: ExerciseBreakdown;
  session: StrengthSession;
  history: StrengthSession[];
  peakBpm?: number;
  onPress?: (exerciseId: string) => void;
  disabled: boolean;
}) {
  const compared = useMemo(
    () => exerciseComparison(session, history, part.exerciseId),
    [session, history, part.exerciseId],
  );
  const facts = [
    part.bestSet?.e1rm !== undefined
      ? `≈ ${formatWeight(Math.round(part.bestSet.e1rm * 2) / 2)} kg Maximum`
      : null,
    part.medianRir !== undefined ? `${decimal(part.medianRir)} im Tank` : null,
    peakBpm !== undefined ? `Satzpuls ${Math.round(peakBpm)}` : null,
    compared?.last ? `zuletzt bester ${compared.last.label}` : null,
  ]
    .filter(Boolean)
    .join(' · ');
  const chain = setsChain(session.exercises[part.exerciseIndex]);
  const subtitle = facts ? `${chain}\n${facts}` : chain;
  const rating = compared?.rating;
  return (
    <Row
      title={part.name}
      subtitle={subtitle}
      trailing={
        rating && compared?.deltaPercent !== undefined ? (
          <Text
            accessibilityLabel={`Geschätztes Maximum ${signedPercent(
              compared.deltaPercent,
            )} gegenüber deinen letzten ${compared.count} Einheiten`}
            style={[statsStyles.rowValue, { color: toneColor(rating) }]}
          >
            {`${RATING_MARK[rating]} ${signedPercent(
              compared.deltaPercent,
            )}`.trim()}
          </Text>
        ) : undefined
      }
      onPress={onPress ? () => onPress(part.exerciseId) : undefined}
      disabled={disabled}
    />
  );
}

// ---------------------------------------------------------------------------
// Pulsverlauf
// ---------------------------------------------------------------------------

const HEIGHT = 150;
const MARGIN = { top: 10, bottom: 20, left: 36, right: 8 };

function elapsedLabel(seconds: number) {
  const whole = Math.max(0, Math.round(seconds));
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  const rest = whole % 60;
  return hours
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}`
    : `${minutes}:${String(rest).padStart(2, '0')}`;
}

/**
 * Puls über die Zeit, eine Achse. Senkrechte Striche markieren abgehakte
 * Sätze; Lücken ohne Wert bleiben Lücken. Wischen wählt einen Moment, die
 * Ablese-Zeile steht fest darüber.
 */
function HeartChart({
  session,
  heart,
}: {
  session: StrengthSession;
  heart: StrengthHeart;
}) {
  const [width, setWidth] = useState(320);
  const [selected, setSelected] = useState<number | null>(null);
  const points = useMemo(() => heartPoints(heart), [heart]);
  const present = points
    .map(point => point.bpm)
    .filter((value): value is number => value !== null);
  if (present.length < 2) {
    return null;
  }
  const plotWidth = Math.max(1, width - MARGIN.left - MARGIN.right);
  const plotHeight = HEIGHT - MARGIN.top - MARGIN.bottom;
  const total = points.length * heart.stepSeconds;
  const low = Math.floor((Math.min(...present) - 5) / 10) * 10;
  const high = Math.ceil((Math.max(...present) + 5) / 10) * 10;
  const xOf = (seconds: number) =>
    MARGIN.left + (Math.min(Math.max(seconds, 0), total) / total) * plotWidth;
  const yOf = (bpm: number) =>
    MARGIN.top + (1 - (bpm - low) / (high - low)) * plotHeight;
  let path = '';
  let pen = false;
  points.forEach(point => {
    if (point.bpm === null) {
      pen = false;
      return;
    }
    path += `${pen ? 'L' : 'M'}${xOf(point.t).toFixed(1)},${yOf(
      point.bpm,
    ).toFixed(1)} `;
    pen = true;
  });
  const marks = session.exercises
    .flatMap(exercise => exercise.sets)
    .filter(set => set.completedAt !== undefined && !set.skipped)
    .map(set => ((set.completedAt as number) - heart.startTime) / 1000)
    .filter(seconds => seconds >= 0 && seconds <= total);
  const minuteStep = [5, 10, 15, 30, 60].find(step => total / 60 / step <= 6) ?? 60;
  const xTicks: number[] = [];
  for (let minute = 0; minute * 60 <= total; minute += minuteStep) {
    xTicks.push(minute * 60);
  }
  const pick = (event: GestureResponderEvent) => {
    const share = Math.min(
      1,
      Math.max(0, (event.nativeEvent.locationX - MARGIN.left) / plotWidth),
    );
    const index = Math.min(
      points.length - 1,
      Math.floor((share * total) / heart.stepSeconds),
    );
    setSelected(index);
  };
  const point = selected === null ? null : points[selected];
  return (
    <View style={styles.chartBlock}>
      <Text accessibilityLiveRegion="polite" style={styles.readout}>
        {point
          ? `Minute ${elapsedLabel(point.t)} · ${
              point.bpm === null ? 'kein Wert' : `${Math.round(point.bpm)} bpm`
            }`
          : `${counted(marks.length, 'Satz', 'Sätze')} markiert · Wischen zeigt einen Moment`}
      </Text>
      <View
        accessibilityRole="adjustable"
        accessibilityLabel={`Puls im Verlauf von ${Math.round(
          Math.min(...present),
        )} bis ${Math.round(Math.max(...present))} bpm, ${
          marks.length
        } abgehakte Sätze markiert.`}
        onLayout={event => setWidth(event.nativeEvent.layout.width)}
        onStartShouldSetResponder={() => true}
        onMoveShouldSetResponder={() => true}
        onResponderTerminationRequest={() => false}
        onResponderGrant={pick}
        onResponderMove={pick}
      >
        <Svg width={width} height={HEIGHT}>
          {[low, (low + high) / 2, high].map(value => (
            <React.Fragment key={`y-${value}`}>
              <Line
                x1={MARGIN.left}
                x2={width - MARGIN.right}
                y1={yOf(value)}
                y2={yOf(value)}
                stroke={color.line}
                strokeWidth={1}
              />
              <SvgText
                x={MARGIN.left - 6}
                y={yOf(value) + 4}
                fontSize={10}
                fill={color.muted}
                textAnchor="end"
              >
                {String(Math.round(value))}
              </SvgText>
            </React.Fragment>
          ))}
          {marks.map((seconds, index) => (
            <Line
              key={`m-${index}`}
              x1={xOf(seconds)}
              x2={xOf(seconds)}
              y1={MARGIN.top}
              y2={MARGIN.top + plotHeight}
              stroke={color.muted}
              strokeOpacity={0.45}
              strokeWidth={1}
              strokeDasharray="3 3"
            />
          ))}
          <Path
            d={path}
            stroke={color.series.heart}
            strokeWidth={2}
            fill="none"
            strokeLinejoin="round"
          />
          {xTicks.map(seconds => (
            <SvgText
              key={`x-${seconds}`}
              x={xOf(seconds)}
              y={HEIGHT - 4}
              fontSize={10}
              fill={color.muted}
              textAnchor={seconds === 0 ? 'start' : 'middle'}
            >
              {`${Math.round(seconds / 60)} min`}
            </SvgText>
          ))}
          {point && point.bpm !== null ? (
            <>
              <Line
                x1={xOf(point.t)}
                x2={xOf(point.t)}
                y1={MARGIN.top}
                y2={MARGIN.top + plotHeight}
                stroke={color.text}
                strokeWidth={1}
              />
              <Circle
                cx={xOf(point.t)}
                cy={yOf(point.bpm)}
                r={4}
                fill={color.series.heart}
                stroke={color.text}
                strokeWidth={1.5}
              />
            </>
          ) : null}
        </Svg>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  metrics: {
    flexDirection: 'row',
    gap: space.sm,
    paddingTop: space.xs,
  },
  chartBlock: { gap: space.xs },
  readout: {
    color: color.muted,
    ...type_.label,
    fontWeight: '400',
    fontVariant: ['tabular-nums'],
  },
});
