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
  displaySessionName,
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
  strengthWatchTransfer,
  type StrengthWatchInfo,
} from '../domain/wearLink';
import { dateFormat, numberFormat, tr } from '../domain/i18n';
import { exerciseDisplayName } from '../domain/catalog';
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
 * Detail of a strength session — as deep as a run's detail page: figures with
 * comparison, the watch's heart rate over time with the ticked-off sets, each
 * exercise against earlier sessions, and muscles, rest and comparison in
 * collapsed sections below. Only what was confirmed is shown; planned values
 * never appear as actual values (T-6).
 */

const formatKg = (value: number) =>
  numberFormat({ maximumFractionDigits: 0 }).format(value);

const setWord = (count: number) =>
  tr(count === 1 ? 'Satz' : 'Sätze', count === 1 ? 'set' : 'sets');

const counted = (count: number, word: (count: number) => string) =>
  `${count} ${word(count)}`;
/** "3 Sätzen": the German dative after "aus" and "von"; English stays "3 sets". */
const setCountDative = (count: number) =>
  tr(
    `${count} ${count === 1 ? 'Satz' : 'Sätzen'}`,
    `${count} ${count === 1 ? 'set' : 'sets'}`,
  );

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

/** Confirmed sets of an exercise as a chain of values. Skipped ones are named, not hidden. */
export function setsChain(exercise: SessionExercise): string {
  const parts = exercise.sets
    .filter(set => isSetCompleted(set) || set.skipped)
    .map(set => {
      if (set.skipped) {
        return tr('übersprungen', 'skipped');
      }
      const label = setLabel({
        weightKg: set.actualWeightKg,
        reps: set.actualReps,
        seconds: set.actualSeconds,
      });
      return label
        ? `${label}${
            set.planned?.kind === 'warmup' ? tr(' (Aufwärmen)', ' (warm-up)') : ''
          }`
        : tr('ohne Werte', 'no values');
    });
  return parts.length
    ? parts.join(' · ')
    : tr('Kein bestätigter Satz', 'No confirmed set');
}

/**
 * Whether the watch's data is here yet. Shown only when something is missing —
 * if the heart rate is there, the page shows it anyway.
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
  const { heartRate, motion } = watch.capture;
  const what = heartRate && motion
    ? tr('Puls und Bewegungen', 'Heart rate and motion')
    : heartRate
    ? tr('Puls', 'Heart rate')
    : tr('Bewegungen', 'Motion');
  const arriving = heartRate && !motion ? tr('kommt', 'is coming') : tr('kommen', 'are coming');
  if (transfer === 'received') {
    if (hasHeart || !watch.capture.heartRate) return null;
    return (
      <Row
        title={tr('Uhr', 'Watch')}
        subtitle={tr(
          'Die Uhr hat keinen gültigen Puls gemessen.',
          'The watch did not measure a valid heart rate.',
        )}
        trailing={<Badge muted>{tr('Übertragen', 'Transferred')}</Badge>}
      />
    );
  }
  return (
    <View accessibilityLiveRegion="polite">
      <Row
        title={tr('Uhr', 'Watch')}
        subtitle={
          transfer === 'waiting'
            ? tr(
                `${what} ${arriving}, sobald die Uhr in der Nähe ist.`,
                `${what} ${arriving} as soon as the watch is nearby.`,
              )
            : watch.watch.message ||
              tr('Die Uhr hat nicht aufgezeichnet.', 'The watch did not record.')
        }
        trailing={
          <Badge muted>
            {transfer === 'waiting'
              ? tr('Wartet', 'Waiting')
              : tr('Nicht aufgezeichnet', 'Not recorded')}
          </Badge>
        }
      />
    </View>
  );
}

/** "+12 %" under a figure; the line below names the baseline. Color carries nothing here. */
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
  /** What the watch measured and transferred for this session; `null` without a watch. */
  watch?: StrengthWatchInfo | null;
  session: StrengthSession;
  /** All completed sessions; the page finds the earlier ones itself. */
  history: StrengthSession[];
  /** Heart rate of this session with its series; missing without a watch. */
  heart?: StrengthHeart;
  heartSummaries: Record<string, StrengthHeartSummary>;
  onOpenExercise?: (exerciseId: string) => void;
  /** Opens "Edit end"; missing for running sessions. */
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
  const formatTime = (at: number) =>
    dateFormat({ hour: '2-digit', minute: '2-digit' }).format(new Date(at));

  return (
    <>
      <Title>
        {displaySessionName(session.name) ||
          tr('Krafttraining', 'Strength training')}
      </Title>
      <Copy muted>
        {`${dateFormat({
          weekday: 'long',
          day: '2-digit',
          month: '2-digit',
          year: 'numeric',
        }).format(new Date(session.startTime))} · ${formatTime(session.startTime)}${
          end ? `–${formatTime(end)}` : ''
        }`}
      </Copy>
      {session.importSource ? (
        <Copy muted>
          {tr(
            `Importiert aus ${session.importSource.source === 'strong' ? 'Strong' : session.importSource.source}${session.importSource.incomplete ? ' · Unvollständig' : ''}`,
            `Imported from ${session.importSource.source === 'strong' ? 'Strong' : session.importSource.source}${session.importSource.incomplete ? ' · Incomplete' : ''}`,
          )}
        </Copy>
      ) : null}
      {session.endCorrection ? (
        <Copy muted>
          {session.endCorrection.originalEndTime
            ? tr(
                `Ende von dir gesetzt · ursprünglich ${formatTime(
                  session.endCorrection.originalEndTime,
                )}`,
                `End set by you · originally ${formatTime(
                  session.endCorrection.originalEndTime,
                )}`,
              )
            : tr('Ende von dir gesetzt', 'End set by you')}
        </Copy>
      ) : null}
      {session.importSource?.rejectedDurationSeconds && !session.endCorrection ? (
        <Copy muted>
          {tr(
            `Ende unbekannt — die Einheit wurde erst nach ${formatDuration(
              session.importSource.rejectedDurationSeconds,
            )} beendet.`,
            `End unknown — the session was only finished after ${formatDuration(
              session.importSource.rejectedDurationSeconds,
            )}.`,
          )}
        </Copy>
      ) : null}
      <View style={styles.metrics}>
        <Stat
          value={seconds === undefined ? DASH : formatDuration(seconds)}
          label={tr('Dauer', 'Duration')}
          delta={deltaLine(comparison?.durationSeconds)}
        />
        <Stat
          value={String(progress.completedSets)}
          label={tr('Sätze', 'Sets')}
          delta={deltaLine(comparison?.sets)}
        />
        <Stat
          value={
            progress.volumeKg > 0 ? formatKg(progress.volumeKg) : DASH
          }
          label={tr('Volumen kg', 'Volume kg')}
          delta={deltaLine(comparison?.volumeKg)}
        />
        {heart ? (
          <Stat
            value={String(Math.round(heart.averageBpm))}
            label={tr('Ø Puls', 'Ø Heart rate')}
            delta={deltaLine(comparison?.averageBpm)}
          />
        ) : null}
      </View>
      {comparison ? (
        <Copy muted>
          {tr(
            `Prozent gegenüber dem Median deiner letzten ${comparison.sessionIds.length} Einheiten ${
              comparison.basis === 'template'
                ? 'aus dieser Vorlage'
                : 'mit diesem Namen'
            }.`,
            `Percent against the median of your last ${comparison.sessionIds.length} sessions ${
              comparison.basis === 'template'
                ? 'from this template'
                : 'with this name'
            }.`,
          )}
        </Copy>
      ) : null}

      <WatchTransferRow watch={watch} hasHeart={Boolean(heart)} />

      {heart && heartInsight ? (
        <Section title={tr('Puls', 'Heart rate')}>
          <HeartChart session={session} heart={heart} />
          {heartInsight.medianRecoveryBpm !== undefined ? (
            <Copy>
              {tr(
                `In der ersten Pausenminute fiel dein Puls im Schnitt um ${Math.round(
                  heartInsight.medianRecoveryBpm,
                )} Schläge.`,
                `In the first minute of rest, your heart rate fell by ${Math.round(
                  heartInsight.medianRecoveryBpm,
                )} beats on average.`,
              )}
            </Copy>
          ) : null}
          <ValueRow
            label={tr('Ø Puls', 'Ø Heart rate')}
            value={`${Math.round(heart.averageBpm)} bpm`}
          />
          <ValueRow
            label={tr('Höchster Puls', 'Highest heart rate')}
            value={`${Math.round(heart.maxBpm)} bpm`}
          />
          {isWatchHeart(heart) ? (
            <>
              <ValueRow
                label={tr('Puls am Satzende', 'Heart rate at set end')}
                value={
                  heartInsight.medianPeakBpm === undefined
                    ? DASH
                    : `${Math.round(heartInsight.medianPeakBpm)} bpm`
                }
                meta={tr(
                  'Median · höchster Wert kurz vor und nach dem Abhaken',
                  'Median · highest value just before and after ticking off',
                )}
              />
              <ValueRow
                label={tr(
                  'Abfall in der ersten Pausenminute',
                  'Drop in the first minute of rest',
                )}
                value={
                  heartInsight.medianRecoveryBpm === undefined
                    ? DASH
                    : `${Math.round(heartInsight.medianRecoveryBpm)} bpm`
                }
                meta={tr(
                  `Median aus ${setCountDative(heartInsight.recoverySets)} mit mindestens zwei Minuten Pause`,
                  `Median of ${setCountDative(heartInsight.recoverySets)} with at least two minutes of rest`,
                )}
              />
            </>
          ) : (
            <Copy muted>
              {tr(
                `Puls aus ${heartSourceLabel(heart)}, je Minute gemittelt.`,
                `Heart rate from ${heartSourceLabel(heart)}, averaged per minute.`,
              )}
            </Copy>
          )}
          {heart.coverage < 0.8 ? (
            <Copy muted>
              {tr(
                `${isWatchHeart(heart) ? 'Die Uhr' : heartSourceLabel(heart)} hatte nur ${Math.round(
                  heart.coverage * 100,
                )} % der Zeit einen Pulswert; Lücken bleiben leer.`,
                `${isWatchHeart(heart) ? 'The watch' : heartSourceLabel(heart)} had a heart rate value for only ${Math.round(
                  heart.coverage * 100,
                )} % of the time; gaps stay empty.`,
              )}
            </Copy>
          ) : null}
        </Section>
      ) : null}

      <Section title={tr('Übungen', 'Exercises')}>
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
          <Copy muted>
            {tr(
              'In dieser Einheit ist keine Übung erfasst.',
              'No exercise is recorded in this session.',
            )}
          </Copy>
        )}
      </Section>

      <Section title={tr('Tiefer schauen', 'Explore further')}>
        <Panel
          title={tr('Muskeln', 'Muscles')}
          summary={
            topGroup
              ? `${topGroup.label} · ${counted(topGroup.sets, setWord)}`
              : DASH
          }
        >
          {muscles.groups.map(group => (
            <ShareRow
              key={group.group}
              label={group.label}
              value={counted(group.sets, setWord)}
              share={topGroup ? group.sets / topGroup.sets : 0}
            />
          ))}
          {muscles.unassignedSets > 0 ? (
            <Copy muted>
              {tr(
                `${counted(muscles.unassignedSets, setWord)} ohne bekannte Muskelgruppe.`,
                `${counted(muscles.unassignedSets, setWord)} without a known muscle group.`,
              )}
            </Copy>
          ) : null}
          {!muscles.groups.length && !muscles.unassignedSets ? (
            <Copy muted>
              {tr(
                'Keine Arbeitssätze abgehakt.',
                'No working sets ticked off.',
              )}
            </Copy>
          ) : null}
        </Panel>
        <Panel
          title={tr('Pausen', 'Rest')}
          summary={
            gaps.medianSeconds === undefined
              ? DASH
              : tr(
                  `Satzabstand ${formatClock(gaps.medianSeconds)}`,
                  `Set interval ${formatClock(gaps.medianSeconds)}`,
                )
          }
        >
          <ValueRow
            label={tr('Satzabstand', 'Set interval')}
            value={
              gaps.medianSeconds === undefined
                ? DASH
                : formatClock(gaps.medianSeconds)
            }
            meta={tr(
              'Median · Abhaken bis Abhaken derselben Übung, Satz eingeschlossen',
              'Median · tick to tick of the same exercise, set included',
            )}
          />
          <ValueRow
            label={tr('Geplante Pause', 'Planned rest')}
            value={
              gaps.plannedMedianSeconds === undefined
                ? DASH
                : formatClock(gaps.plannedMedianSeconds)
            }
          />
          {gaps.gaps.length ? (
            <ValueRow
              label={tr('Kürzester · längster Abstand', 'Shortest · longest interval')}
              value={`${formatClock(Math.min(...gaps.gaps))} · ${formatClock(
                Math.max(...gaps.gaps),
              )}`}
            />
          ) : null}
        </Panel>
        {comparison ? (
          <Panel
            title={tr('Vergleich', 'Comparison')}
            summary={tr(
              `${comparison.sessionIds.length} ${
                comparison.sessionIds.length === 1
                  ? 'frühere Einheit'
                  : 'frühere Einheiten'
              }`,
              `${comparison.sessionIds.length} earlier ${
                comparison.sessionIds.length === 1 ? 'session' : 'sessions'
              }`,
            )}
          >
            <ComparedRow
              label={tr('Volumen', 'Volume')}
              value={comparison.volumeKg}
              format={value => `${formatKg(value)} kg`}
            />
            <ComparedRow
              label={tr('Sätze', 'Sets')}
              value={comparison.sets}
              format={value => decimal(value, Number.isInteger(value) ? 0 : 1)}
            />
            <ComparedRow
              label={tr('Dauer', 'Duration')}
              value={comparison.durationSeconds}
              format={formatDuration}
            />
            <ComparedRow
              label={tr('Ø Puls', 'Ø Heart rate')}
              value={comparison.averageBpm}
              format={value => `${Math.round(value)} bpm`}
            />
          </Panel>
        ) : null}
      </Section>

      {session.note ? (
        <Section title={tr('Notiz', 'Note')}>
          <Copy>{session.note}</Copy>
        </Section>
      ) : null}

      {onEditEnd && session.status === 'finished' ? (
        <Row
          title={tr('Ende bearbeiten', 'Edit end')}
          subtitle={tr(
            'Vergessen zu beenden? Wähle im Verlauf, wann Schluss war.',
            'Forgot to finish? Choose in History when it ended.',
          )}
          onPress={onEditEnd}
          disabled={busy}
        />
      ) : null}
      <Disclosure
        title={tr('Details', 'Details')}
        subtitle={tr('Datenbasis und Versionen', 'Data basis and versions')}
      >
        {confirmed.length > 0 &&
        withWeight > 0 &&
        withWeight < confirmed.length ? (
          <Copy muted>
            {tr(
              `Volumen aus ${withWeight} von ${setCountDative(confirmed.length)} mit Gewicht.`,
              `Volume from ${withWeight} of ${setCountDative(confirmed.length)} with weight.`,
            )}
          </Copy>
        ) : null}
        <Copy muted>
          {tr(
            'Das Maximum ist eine Schätzung nach Epley aus Arbeitssätzen bis zwölf Wiederholungen, keine Messung.',
            'The maximum is an Epley estimate from working sets of up to twelve reps, not a measurement.',
          )}
        </Copy>
        {heart ? (
          <Copy muted>
            {tr(
              `Puls von ${isWatchHeart(heart) ? 'der Uhr' : heartSourceLabel(heart)} in ${heart.stepSeconds}-s-Fenstern, ${Math.round(
                heart.coverage * 100,
              )} % abgedeckt${
                heart.clockAligned
                  ? ''
                  : '; Uhr und Handy ohne Abgleich, Satzzeiten können einige Sekunden daneben liegen'
              }.`,
              `Heart rate from ${isWatchHeart(heart) ? 'the watch' : heartSourceLabel(heart)} in ${heart.stepSeconds}-s windows, ${Math.round(
                heart.coverage * 100,
              )} % covered${
                heart.clockAligned
                  ? ''
                  : '; watch and phone not synced, set times may be a few seconds off'
              }.`,
            )}
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
      ? tr(
          `≈ ${formatWeight(Math.round(part.bestSet.e1rm * 2) / 2)} kg Maximum`,
          `≈ ${formatWeight(Math.round(part.bestSet.e1rm * 2) / 2)} kg est. max`,
        )
      : null,
    part.medianRir !== undefined
      ? tr(
          `${decimal(part.medianRir)} im Tank`,
          `${decimal(part.medianRir)} in reserve`,
        )
      : null,
    peakBpm !== undefined
      ? tr(`Satzpuls ${Math.round(peakBpm)}`, `Set peak ${Math.round(peakBpm)}`)
      : null,
    compared?.last
      ? tr(
          `zuletzt bester ${compared.last.label}`,
          `best last time ${compared.last.label}`,
        )
      : null,
  ]
    .filter(Boolean)
    .join(' · ');
  const chain = setsChain(session.exercises[part.exerciseIndex]);
  const subtitle = facts ? `${chain}\n${facts}` : chain;
  const rating = compared?.rating;
  return (
    <Row
      title={exerciseDisplayName(part.exerciseId, part.name)}
      subtitle={subtitle}
      trailing={
        rating && compared?.deltaPercent !== undefined ? (
          <Text
            accessibilityLabel={tr(
              `Geschätztes Maximum ${signedPercent(
                compared.deltaPercent,
              )} gegenüber deinen letzten ${compared.count} Einheiten`,
              `Estimated max ${signedPercent(
                compared.deltaPercent,
              )} compared with your last ${compared.count} sessions`,
            )}
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
// Heart rate trace
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
 * Heart rate over time, one axis. Vertical lines mark ticked-off sets; gaps
 * without a value stay gaps. Swiping picks a moment; the readout line stays
 * fixed above the chart.
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
          ? tr(
              `Minute ${elapsedLabel(point.t)} · ${
                point.bpm === null ? 'kein Wert' : `${Math.round(point.bpm)} bpm`
              }`,
              `Minute ${elapsedLabel(point.t)} · ${
                point.bpm === null ? 'no value' : `${Math.round(point.bpm)} bpm`
              }`,
            )
          : tr(
              `${counted(marks.length, setWord)} markiert · Wischen zeigt einen Moment`,
              `${counted(marks.length, setWord)} marked · Swipe shows a moment`,
            )}
      </Text>
      <View
        accessibilityRole="adjustable"
        accessibilityLabel={tr(
          `Puls im Verlauf von ${Math.round(
            Math.min(...present),
          )} bis ${Math.round(Math.max(...present))} bpm, ${
            marks.length
          } abgehakte Sätze markiert.`,
          `Heart rate over time from ${Math.round(
            Math.min(...present),
          )} to ${Math.round(Math.max(...present))} bpm, ${
            marks.length
          } ticked-off sets marked.`,
        )}
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
