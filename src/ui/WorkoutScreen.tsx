import React, { memo, useCallback, useEffect, useMemo, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import {
  displaySessionName,
  exerciseProgress,
  formatWeight,
  referenceLabel,
  referenceSet,
  restRemaining,
  sessionProgress,
  type LoggedSet,
  type SessionExercise,
  type StrengthSession,
} from '../domain/strength';
import {
  assessExerciseProgression,
  collapseToDays,
  MINIMUM_SESSIONS_FOR_DIRECTION,
  type ProgressionAssessment,
} from '../domain/progression';
import type { StrengthWatchLive } from '../domain/wearLink';
import {
  Badge,
  color,
  Copy,
  radius,
  space,
  SwipeToDelete,
  type,
} from './components';
import { tr } from '../domain/i18n';
import { exerciseDisplayName } from '../domain/catalog';

/** Watch labels during training; a hint only when the user can act on it. Built per call: the language can change at runtime. */
const watchWords = (
  state: StrengthWatchLive,
): { label: string; muted: boolean } =>
  ({
    measuring: { label: tr('Misst', 'Measuring'), muted: false },
    starting: { label: tr('Startet', 'Starting'), muted: true },
    silent: { label: tr('Keine Daten', 'No data'), muted: true },
    failed: { label: tr('Misst nicht', 'Not measuring'), muted: true },
    disconnected: {
      label: tr('Nicht verbunden', 'Not connected'),
      muted: true,
    },
  }[state]);

/**
 * A narrow line under the header: what the watch is measuring and the heart
 * rate right now. Without a fresh value it shows "–", never an old heart rate.
 */
function WatchStrip({
  watch,
}: {
  watch: { state: StrengthWatchLive; bpm?: number; hint?: string };
}) {
  const words = watchWords(watch.state);
  const measuring = watch.state === 'measuring';
  return (
    <View
      accessibilityLiveRegion="polite"
      accessibilityLabel={`${tr('Uhr', 'Watch')}: ${words.label}${
        measuring
          ? watch.bpm !== undefined
            ? tr(
                `, Puls ${watch.bpm} Schläge pro Minute`,
                `, heart rate ${watch.bpm} beats per minute`,
              )
            : tr(', noch kein Puls', ', no heart rate yet')
          : ''
      }${watch.hint ? `. ${watch.hint}` : ''}`}
      style={styles.watch}
    >
      <View style={styles.watchLine}>
        <Text style={styles.watchTitle}>{tr('Uhr', 'Watch')}</Text>
        <Badge muted={words.muted}>{words.label}</Badge>
        <View style={styles.watchSpacer} />
        {measuring ? (
          <Text style={styles.watchValue}>
            {watch.bpm !== undefined ? watch.bpm : '–'}
            <Text style={styles.watchUnit}> bpm</Text>
          </Text>
        ) : null}
      </View>
      {watch.hint ? <Text style={styles.watchHint}>{watch.hint}</Text> : null}
    </View>
  );
}

/**
 * Active workout view: confirm sets in seconds, log deviations without judgment.
 *
 * Layout: finished exercises as narrow rows at the top, the current exercise
 * as an expanded card in the middle, upcoming exercises as narrow rows at the
 * bottom. Tapping a row switches the exercise. A set can be swiped to the
 * left; until the next change, "Undo" takes its place.
 */

/** How long "Undo" stays after a set is deleted. */
const UNDO_MS = 8000;

interface RemovedSet {
  exerciseIndex: number;
  set: LoggedSet;
  position: number;
}

const formatClock = (seconds: number) => {
  const whole = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(whole / 60);
  return `${minutes}:${String(whole % 60).padStart(2, '0')}`;
};

const formatElapsed = (seconds: number) => {
  const whole = Math.max(0, Math.round(seconds));
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  return hours
    ? `${hours} h ${String(minutes).padStart(2, '0')} min`
    : `${minutes} min`;
};

const plannedLabel = (set: LoggedSet) => {
  const { planned } = set;
  if (planned.kind === 'timed' && planned.seconds) {
    return `${planned.seconds} s`;
  }
  const weight =
    planned.loadKind === 'bodyweight'
      ? tr('Eigengewicht', 'Bodyweight')
      : planned.weightKg
      ? `${formatWeight(planned.weightKg)} kg`
      : null;
  const reps = planned.reps
    ? tr(`${planned.reps} Wdh.`, `${planned.reps} reps`)
    : null;
  return [weight, reps].filter(Boolean).join(' × ') || tr('frei', 'free');
};

/** Starting value of an input field, from the last comparable session. */
interface SetSuggestion {
  weightKg?: number;
  reps?: number;
  seconds?: number;
}

const kindLabel = (kind: string): string => {
  switch (kind) {
    case 'warmup':
      return tr('Aufwärmen', 'Warm-up');
    case 'failure':
      return tr('bis Versagen', 'to failure');
    case 'dropset':
      return tr('Dropsatz', 'Drop set');
    case 'timed':
      return tr('Zeitsatz', 'Timed set');
    default:
      return '';
  }
};

function CompactRow({
  exercise,
  index,
  direction,
  onPress,
}: {
  exercise: SessionExercise;
  index: number;
  direction: 'up' | 'down';
  onPress: (index: number) => void;
}) {
  const progress = exerciseProgress(exercise);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={tr(
        `${exerciseDisplayName(exercise.exerciseId, exercise.name)}, ${progress.completed} von ${progress.total} Sätzen erledigt`,
        `${exerciseDisplayName(exercise.exerciseId, exercise.name)}, ${progress.completed} of ${progress.total} sets done`,
      )}
      onPress={() => onPress(index)}
      style={({ pressed }) => [styles.compact, pressed && styles.pressed]}
    >
      <Text style={styles.compactArrow}>{direction === 'up' ? '↑' : '↓'}</Text>
      <Text numberOfLines={1} style={styles.compactName}>
        {exerciseDisplayName(exercise.exerciseId, exercise.name)}
      </Text>
      <Text style={styles.compactCount}>
        {progress.completed}/{progress.total}
      </Text>
      <View style={[styles.check, progress.done && styles.checkDone]}>
        {progress.done ? <Text style={styles.checkMark}>✓</Text> : null}
      </View>
    </Pressable>
  );
}

const SetRow = memo(function SetRow({
  set,
  position,
  reference,
  suggestion,
  active,
  showRir,
  markPlanned,
  onComplete,
  onEdit,
}: {
  set: LoggedSet;
  position: number;
  reference: string | null;
  /** Under the "Last" header, the row marks a plain target. */
  markPlanned: boolean;
  suggestion: SetSuggestion | null;
  active: boolean;
  /** Without the field, reserve stays unknown; saved values are kept. */
  showRir: boolean;
  onComplete: (
    setId: string,
    weight: string,
    reps: string,
    rir: string,
    timed: boolean,
  ) => void;
  onEdit: (
    setId: string,
    weight: string,
    reps: string,
    rir: string,
    timed: boolean,
  ) => void;
}) {
  const timed = set.planned.kind === 'timed';
  // A logged value beats the plan value, and the plan value beats the
  // suggestion from history. The suggestion is only a preset in the input
  // field; only the check mark turns it into an actual value (T-5).
  const ownWeight = set.actualWeightKg ?? set.planned.weightKg ?? undefined;
  const ownReps = timed
    ? set.actualSeconds ?? set.planned.seconds ?? undefined
    : set.actualReps ?? set.planned.reps ?? undefined;
  const suggestedWeight = suggestion?.weightKg;
  const suggestedReps = timed ? suggestion?.seconds : suggestion?.reps;
  const initialWeight = ownWeight ?? suggestedWeight;
  const initialReps = ownReps ?? suggestedReps;
  const [weight, setWeight] = useState(
    initialWeight === undefined ? '' : formatWeight(initialWeight),
  );
  const [reps, setReps] = useState(
    initialReps === undefined ? '' : String(initialReps),
  );
  // Reserve (RIR) is optional and only user input. Empty means unknown; the
  // app doesn't estimate it from the same set.
  const [rir, setRir] = useState(
    set.actualRir === undefined ? '' : String(set.actualRir),
  );
  const [touched, setTouched] = useState(false);
  // A watch, a notification, or a deleted set before it changes values and
  // suggestions while the row stays put. Without its own input, it follows.
  useEffect(() => {
    if (touched) return;
    setWeight(initialWeight === undefined ? '' : formatWeight(initialWeight));
    setReps(initialReps === undefined ? '' : String(initialReps));
    setRir(set.actualRir === undefined ? '' : String(set.actualRir));
  }, [touched, initialWeight, initialReps, set.actualRir]);
  const done = set.completedAt !== undefined;
  const weightIsSuggested =
    !touched &&
    !done &&
    ownWeight === undefined &&
    suggestedWeight !== undefined;
  const repsIsSuggested =
    !touched && !done && ownReps === undefined && suggestedReps !== undefined;
  const bodyweight = set.planned.loadKind === 'bodyweight';
  const note = kindLabel(set.planned.kind);

  return (
    <View
      style={[
        styles.setRow,
        done && styles.setRowDone,
        set.skipped && styles.setRowSkipped,
        active && !done && styles.setRowActive,
      ]}
    >
      <View style={styles.setNumber}>
        <Text style={styles.setNumberText}>{position}</Text>
        {note ? <Text style={styles.setKind}>{note}</Text> : null}
      </View>
      <View style={styles.setReference}>
        <Text numberOfLines={1} style={styles.referenceText}>
          {reference || plannedLabel(set)}
        </Text>
        {/* The column header names the origin; only deviations appear here. */}
        {markPlanned && !reference ? (
          <Text style={styles.referenceHint}>{tr('Vorgabe', 'Target')}</Text>
        ) : null}
      </View>
      <TextInput
        accessibilityLabel={tr(
          `Gewicht für Satz ${position}${
            weightIsSuggested ? ', Vorschlag aus der letzten Einheit' : ''
          }`,
          `Weight for set ${position}${
            weightIsSuggested ? ', suggested from the last session' : ''
          }`,
        )}
        editable={!bodyweight}
        keyboardType="decimal-pad"
        onBlur={() => onEdit(set.id, weight, reps, rir, timed)}
        onChangeText={value => {
          setTouched(true);
          setWeight(value);
        }}
        placeholder={bodyweight ? 'KG' : '–'}
        placeholderTextColor={color.muted}
        selectTextOnFocus
        style={[
          styles.input,
          weightIsSuggested && styles.inputSuggested,
          bodyweight && styles.inputDisabled,
        ]}
        value={bodyweight ? '' : weight}
      />
      <TextInput
        accessibilityLabel={tr(
          `${timed ? 'Sekunden' : 'Wiederholungen'} für Satz ${position}${
            repsIsSuggested ? ', Vorschlag aus der letzten Einheit' : ''
          }`,
          `${timed ? 'Seconds' : 'Reps'} for set ${position}${
            repsIsSuggested ? ', suggested from the last session' : ''
          }`,
        )}
        keyboardType="number-pad"
        onBlur={() => onEdit(set.id, weight, reps, rir, timed)}
        onChangeText={value => {
          setTouched(true);
          setReps(value);
        }}
        placeholder="–"
        placeholderTextColor={color.muted}
        selectTextOnFocus
        style={[styles.input, repsIsSuggested && styles.inputSuggested]}
        value={reps}
      />
      {timed || !showRir ? (
        <View style={styles.inputSmall} />
      ) : (
        <TextInput
          accessibilityLabel={tr(
            `Wiederholungen im Tank für Satz ${position}, optional`,
            `Reps in reserve for set ${position}, optional`,
          )}
          keyboardType="number-pad"
          onBlur={() => onEdit(set.id, weight, reps, rir, timed)}
          onChangeText={value => {
            setTouched(true);
            setRir(value);
          }}
          placeholder="–"
          placeholderTextColor={color.muted}
          selectTextOnFocus
          style={[styles.input, styles.inputSmall]}
          value={rir}
        />
      )}
      <Pressable
        accessibilityLabel={
          done
            ? tr(`Satz ${position} zurücknehmen`, `Undo set ${position}`)
            : tr(`Satz ${position} bestätigen`, `Confirm set ${position}`)
        }
        accessibilityRole="button"
        accessibilityState={{ checked: done }}
        onPress={() => onComplete(set.id, weight, reps, rir, timed)}
        style={({ pressed }) => [
          styles.check,
          styles.checkLarge,
          done && styles.checkDone,
          pressed && styles.pressed,
        ]}
      >
        {done ? <Text style={styles.checkMark}>✓</Text> : null}
      </Pressable>
    </View>
  );
});

/**
 * Short summary of an exercise's strength trend, visible once all its sets are
 * done. Shows an assessment with its uncertainty, not a judgment.
 */
function ProgressionNote({
  assessment,
}: {
  assessment: ProgressionAssessment;
}) {
  const latest = assessment.series[assessment.series.length - 1];
  if (!latest) {
    return null;
  }
  const headline = tr(
    `Bestes geschätztes Maximum: ${formatWeight(
      Math.round(latest.e1rm * 10) / 10,
    )} kg`,
    `Best estimated max: ${formatWeight(Math.round(latest.e1rm * 10) / 10)} kg`,
  );
  const missing =
    MINIMUM_SESSIONS_FOR_DIRECTION - collapseToDays(assessment.series).length;
  const detail =
    assessment.verdict === 'not_assessable'
      ? missing > 0
        ? tr(
            `Noch ${missing} ${
              missing === 1 ? 'Trainingstag' : 'Trainingstage'
            } bis zur ersten Einschätzung des Verlaufs.`,
            `${missing} more ${
              missing === 1 ? 'training day' : 'training days'
            } until the first assessment of the trend.`,
          )
        : tr(
            'Der Verlauf ist noch nicht belastbar einzuschätzen.',
            "The trend can't be assessed reliably yet.",
          )
      : // Observation only: an action ("increase", "reduce") exists only as a
      // recommendation in the Coach (ground rules 3 and 15).
      assessment.verdict === 'increase'
      ? tr('Der Verlauf zeigt nach oben.', 'The trend is going up.')
      : assessment.verdict === 'reduce'
      ? tr('Der Verlauf zeigt nach unten.', 'The trend is going down.')
      : assessment.verdict === 'plateau'
      ? tr(
          `Seit ${Math.round(
            assessment.plateau.spanWeeks,
          )} Wochen nachweislich stabil.`,
          `Demonstrably stable for ${Math.round(
            assessment.plateau.spanWeeks,
          )} weeks.`,
        )
      : tr(
          'Noch nicht klar: Änderung und Stillstand sind beide möglich. So weitermachen ist eine eigene Entscheidung.',
          'Not clear yet: change and standstill are both possible. Carrying on as before is your own decision.',
        );
  return (
    <View style={styles.progression}>
      <Text style={styles.progressionHeadline}>{headline}</Text>
      <Text style={styles.progressionDetail}>{detail}</Text>
      <Text style={styles.progressionSource}>
        {tr(
          `Schätzung aus ${assessment.series.length} ${
            assessment.series.length === 1 ? 'Einheit' : 'Einheiten'
          }, keine Messung.`,
          `Estimate from ${assessment.series.length} ${
            assessment.series.length === 1 ? 'session' : 'sessions'
          }, not a measurement.`,
        )}
      </Text>
    </View>
  );
}

export function WorkoutScreen({
  session,
  history,
  sessions,
  now,
  busy = false,
  showRir = true,
  showRestTimer = true,
  onSelectExercise,
  onCompleteSet,
  onEditSet,
  onAddSet,
  onAddExercise,
  onRemoveSet,
  onRestoreSet,
  onPauseRest,
  onResumeRest,
  onSkipRest,
  onFinish,
  onMinimize,
  watch = null,
}: {
  /** Live state of the watch (`strengthWatchLive`); without a watch there is no row. */
  watch?: { state: StrengthWatchLive; bpm?: number; hint?: string } | null;
  session: StrengthSession;
  history: StrengthSession[];
  /** Full history for the trend. Without it, the note is left out. */
  sessions?: StrengthSession[];
  now: number;
  busy?: boolean;
  /** Offer the "Reps in reserve" input field. */
  showRir?: boolean;
  /** Show the rest bar after a set. The rest itself is always saved. */
  showRestTimer?: boolean;
  onSelectExercise: (index: number) => void;
  onCompleteSet: (
    exerciseIndex: number,
    setId: string,
    values: {
      actualWeightKg?: number;
      actualReps?: number;
      actualSeconds?: number;
      actualRir?: number;
    },
  ) => void;
  onEditSet: (
    exerciseIndex: number,
    setId: string,
    values: {
      actualWeightKg?: number;
      actualReps?: number;
      actualSeconds?: number;
      actualRir?: number;
    },
  ) => void;
  onAddSet: (exerciseIndex: number) => void;
  onAddExercise: () => void;
  /** Without a callback, a set can't be swiped away. */
  onRemoveSet?: (exerciseIndex: number, setId: string) => void;
  onRestoreSet?: (
    exerciseIndex: number,
    set: LoggedSet,
    position: number,
  ) => void;
  onPauseRest?: () => void;
  onResumeRest?: () => void;
  onSkipRest?: () => void;
  onFinish: () => void;
  onMinimize: () => void;
}) {
  const index = session.currentExercise;
  const current = session.exercises[index];
  const progress = sessionProgress(session);
  const rest = restRemaining(session, now);
  const restPaused = session.restPausedAt !== undefined;
  const elapsed = Math.max(0, (now - session.startTime) / 1000);
  const [removed, setRemoved] = useState<RemovedSet | null>(null);
  useEffect(() => {
    if (!removed) return;
    const timer = setTimeout(() => setRemoved(null), UNDO_MS);
    return () => clearTimeout(timer);
  }, [removed]);
  const remove = useCallback(
    (set: LoggedSet, position: number) => {
      if (!onRemoveSet) return;
      onRemoveSet(index, set.id);
      setRemoved({ exerciseIndex: index, set, position });
    },
    [index, onRemoveSet],
  );
  const undo =
    removed && removed.exerciseIndex === index && onRestoreSet ? removed : null;
  const undoRow = undo ? (
    <View key="undo" style={styles.undo}>
      <Text style={styles.undoText}>
        {tr(
          `Satz ${undo.position + 1} gelöscht`,
          `Set ${undo.position + 1} deleted`,
        )}
      </Text>
      <Pressable
        accessibilityLabel={tr(
          `Satz ${undo.position + 1} wiederherstellen`,
          `Restore set ${undo.position + 1}`,
        )}
        accessibilityRole="button"
        onPress={() => {
          onRestoreSet?.(undo.exerciseIndex, undo.set, undo.position);
          setRemoved(null);
        }}
        style={({ pressed }) => [styles.undoButton, pressed && styles.pressed]}
      >
        <Text style={styles.ghostText}>{tr('Rückgängig', 'Undo')}</Text>
      </Pressable>
    </View>
  ) : null;

  const parse = useCallback(
    (weight: string, reps: string, rir: string, timed: boolean) => {
      const parsedWeight = Number(weight.replace(',', '.'));
      const parsedReps = Number(reps);
      const parsedRir = Number(rir);
      return {
        actualWeightKg:
          Number.isFinite(parsedWeight) && weight.trim()
            ? parsedWeight
            : undefined,
        ...(!timed && rir.trim() && Number.isFinite(parsedRir) && parsedRir >= 0
          ? { actualRir: Math.round(parsedRir) }
          : {}),
        ...(timed
          ? {
              actualSeconds:
                Number.isFinite(parsedReps) && reps.trim()
                  ? Math.round(parsedReps)
                  : undefined,
            }
          : {
              actualReps:
                Number.isFinite(parsedReps) && reps.trim()
                  ? Math.round(parsedReps)
                  : undefined,
            }),
      };
    },
    [],
  );

  const complete = useCallback(
    (
      setId: string,
      weight: string,
      reps: string,
      rir: string,
      timed: boolean,
    ) => onCompleteSet(index, setId, parse(weight, reps, rir, timed)),
    [index, onCompleteSet, parse],
  );
  const edit = useCallback(
    (
      setId: string,
      weight: string,
      reps: string,
      rir: string,
      timed: boolean,
    ) => onEditSet(index, setId, parse(weight, reps, rir, timed)),
    [index, onEditSet, parse],
  );

  const references = useMemo(
    () =>
      current
        ? current.sets.map((_, position) =>
            referenceLabel(history, current.exerciseId, position),
          )
        : [],
    [current, history],
  );

  // Suggestions from the last comparable session. They only prefill the
  // input fields, so a confirmed set costs one tap.
  const suggestions = useMemo<(SetSuggestion | null)[]>(
    () =>
      current
        ? current.sets.map((_, position) => {
            const previous = referenceSet(
              history,
              current.exerciseId,
              position,
            );
            return previous
              ? {
                  weightKg: previous.actualWeightKg,
                  reps: previous.actualReps,
                  seconds: previous.actualSeconds,
                }
              : null;
          })
        : [],
    [current, history],
  );

  const currentProgress = current
    ? exerciseProgress(current)
    : { completed: 0, total: 0, done: false, activeSetId: undefined };

  // Only compute once the exercise is done; before that, the trend only distracts.
  const progression = useMemo(() => {
    if (!current || !currentProgress.done || !sessions?.length) {
      return null;
    }
    return assessExerciseProgression(sessions, current.exerciseId, {
      nextSessionAt: now,
    });
  }, [current, currentProgress.done, now, sessions]);

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <Pressable
          accessibilityLabel={tr(
            'Training in den Hintergrund legen',
            'Move workout to background',
          )}
          accessibilityRole="button"
          onPress={onMinimize}
          style={({ pressed }) => [
            styles.headerButton,
            pressed && styles.pressed,
          ]}
        >
          <Text style={styles.headerButtonText}>‹</Text>
        </Pressable>
        <View style={styles.headerCenter}>
          <Text numberOfLines={1} style={styles.headerTitle}>
            {displaySessionName(session.name)}
          </Text>
          <Text style={styles.headerMeta}>
            {formatElapsed(elapsed)} ·{' '}
            {tr(
              `${progress.completedSets} von ${progress.totalSets} Sätzen`,
              `${progress.completedSets} of ${progress.totalSets} sets`,
            )}
          </Text>
        </View>
        <Pressable
          accessibilityLabel={tr('Training beenden', 'End workout')}
          accessibilityRole="button"
          disabled={busy}
          onPress={onFinish}
          style={({ pressed }) => [
            styles.finish,
            busy && styles.disabled,
            pressed && styles.pressed,
          ]}
        >
          <Text style={styles.finishText}>{tr('Beenden', 'End')}</Text>
        </Pressable>
      </View>
      {watch ? <WatchStrip watch={watch} /> : null}

      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        {session.exercises.map((exercise, position) =>
          position < index ? (
            <CompactRow
              direction="up"
              exercise={exercise}
              index={position}
              key={`${exercise.exerciseId}-${position}`}
              onPress={onSelectExercise}
            />
          ) : null,
        )}

        {current ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>
              {exerciseDisplayName(current.exerciseId, current.name)}
            </Text>
            <Text style={styles.cardMeta}>
              {currentProgress.done
                ? tr('Alle Sätze erledigt', 'All sets done')
                : tr(
                    `Satz ${Math.min(
                      currentProgress.completed + 1,
                      currentProgress.total,
                    )} von ${currentProgress.total}`,
                    `Set ${Math.min(
                      currentProgress.completed + 1,
                      currentProgress.total,
                    )} of ${currentProgress.total}`,
                  )}
              {current.added ? tr(' · frei ergänzt', ' · added') : ''}
            </Text>

            <View style={styles.columns}>
              <Text style={[styles.columnLabel, styles.columnNumber]}>#</Text>
              <Text style={[styles.columnLabel, styles.columnReference]}>
                {/* Without earlier sets, the column shows the target, not the last session. */}
                {references.some(Boolean)
                  ? tr('Zuletzt', 'Last')
                  : tr('Vorgabe', 'Target')}
              </Text>
              <Text style={[styles.columnLabel, styles.columnInput]}>kg</Text>
              <Text style={[styles.columnLabel, styles.columnInput]}>
                {tr('Wdh.', 'Reps')}
              </Text>
              <Text style={[styles.columnLabel, styles.columnInputSmall]}>
                {showRir ? 'RIR' : ''}
              </Text>
              <View style={styles.columnCheck} />
            </View>

            {current.sets.map((set, position) => (
              <View key={set.id}>
                {undo && undo.position === position ? undoRow : null}
                <SwipeToDelete
                  enabled={Boolean(onRemoveSet) && current.sets.length > 1}
                  label={tr(
                    `Satz ${position + 1} löschen`,
                    `Delete set ${position + 1}`,
                  )}
                  onDelete={() => remove(set, position)}
                >
                  <SetRow
                    active={currentProgress.activeSetId === set.id}
                    onComplete={complete}
                    onEdit={edit}
                    position={position + 1}
                    reference={references[position]}
                    markPlanned={references.some(Boolean)}
                    suggestion={suggestions[position]}
                    showRir={showRir}
                    set={set}
                  />
                </SwipeToDelete>
                {showRestTimer &&
                rest !== null &&
                session.restStartedAt !== undefined &&
                set.completedAt === session.restStartedAt ? (
                  <View style={styles.restBlock}>
                    <View
                      accessibilityLabel={tr(
                        `Pause${
                          restPaused ? ' angehalten' : ''
                        }, noch ${formatClock(rest)}`,
                        `Rest${restPaused ? ' paused' : ''}, ${formatClock(
                          rest,
                        )} left`,
                      )}
                      style={styles.rest}
                    >
                      <View
                        style={[
                          styles.restFill,
                          {
                            width: `${Math.round(
                              (1 - rest / (session.restSeconds || 1)) * 100,
                            )}%`,
                          },
                        ]}
                      />
                      <Text style={styles.restText}>
                        {restPaused
                          ? tr('Pause angehalten', 'Rest paused')
                          : tr('Pause', 'Rest')}{' '}
                        {formatClock(rest)}
                      </Text>
                    </View>
                    {onPauseRest && onResumeRest && onSkipRest ? (
                      <View style={styles.restActions}>
                        <Pressable
                          accessibilityLabel={
                            restPaused
                              ? tr('Pause weiterlaufen lassen', 'Resume rest')
                              : tr('Pause anhalten', 'Pause rest')
                          }
                          accessibilityRole="button"
                          onPress={restPaused ? onResumeRest : onPauseRest}
                          style={({ pressed }) => [
                            styles.restButton,
                            pressed && styles.pressed,
                          ]}
                        >
                          <Text style={styles.ghostText}>
                            {restPaused
                              ? tr('Weiter', 'Resume')
                              : tr('Anhalten', 'Pause')}
                          </Text>
                        </Pressable>
                        <Pressable
                          accessibilityLabel={tr(
                            'Pause überspringen',
                            'Skip rest',
                          )}
                          accessibilityRole="button"
                          onPress={onSkipRest}
                          style={({ pressed }) => [
                            styles.restButton,
                            pressed && styles.pressed,
                          ]}
                        >
                          <Text style={styles.ghostText}>
                            {tr('Überspringen', 'Skip')}
                          </Text>
                        </Pressable>
                      </View>
                    ) : null}
                  </View>
                ) : null}
              </View>
            ))}
            {undo && undo.position >= current.sets.length ? undoRow : null}

            {progression ? <ProgressionNote assessment={progression} /> : null}

            <Pressable
              accessibilityLabel={tr('Satz hinzufügen', 'Add set')}
              accessibilityRole="button"
              onPress={() => onAddSet(index)}
              style={({ pressed }) => [styles.ghost, pressed && styles.pressed]}
            >
              <Text style={styles.ghostText}>{tr('+ Satz', '+ Set')}</Text>
            </Pressable>
          </View>
        ) : (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>
              {tr('Noch keine Übung', 'No exercise yet')}
            </Text>
            <Copy muted>
              {tr(
                'Füge eine Übung hinzu, um mit dem Aufzeichnen zu beginnen.',
                'Add an exercise to start recording.',
              )}
            </Copy>
          </View>
        )}

        {session.exercises.map((exercise, position) =>
          position > index ? (
            <CompactRow
              direction="down"
              exercise={exercise}
              index={position}
              key={`${exercise.exerciseId}-${position}`}
              onPress={onSelectExercise}
            />
          ) : null,
        )}

        <Pressable
          accessibilityLabel={tr('Übung hinzufügen', 'Add exercise')}
          accessibilityRole="button"
          onPress={onAddExercise}
          style={({ pressed }) => [styles.ghost, pressed && styles.pressed]}
        >
          <Text style={styles.ghostText}>{tr('+ Übung', '+ Exercise')}</Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: color.line,
  },
  headerButton: {
    width: 48,
    height: 48,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: color.surface,
  },
  headerButtonText: { color: color.text, fontSize: 24, lineHeight: 26 },
  headerCenter: { flex: 1, gap: 2 },
  headerTitle: { color: color.text, fontSize: 17, fontWeight: '600' },
  headerMeta: { color: color.muted, fontSize: 13 },
  finish: {
    minHeight: 48,
    paddingHorizontal: 14,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: color.surface,
    borderWidth: 1,
    borderColor: color.line,
  },
  finishText: { color: color.text, fontSize: 15, fontWeight: '600' },
  content: { padding: 12, paddingBottom: 40, gap: 8 },
  watch: {
    paddingHorizontal: space.sm,
    paddingVertical: space.xs,
    borderBottomWidth: 1,
    borderBottomColor: color.line,
    gap: space.xxs,
  },
  watchLine: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  watchTitle: { ...type.label, color: color.text },
  watchSpacer: { flex: 1 },
  watchValue: {
    ...type.label,
    color: color.text,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
  watchUnit: { color: color.muted, fontWeight: '400' },
  watchHint: { ...type.label, color: color.muted },

  compact: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minHeight: 52,
    paddingHorizontal: 12,
    borderRadius: 8,
    backgroundColor: color.surface,
    opacity: 0.72,
  },
  compactArrow: { color: color.muted, fontSize: 14, width: 14 },
  compactName: { flex: 1, color: color.text, fontSize: 15 },
  compactCount: {
    color: color.muted,
    fontSize: 13,
    fontVariant: ['tabular-nums'],
  },

  card: {
    borderRadius: 12,
    backgroundColor: color.raised,
    padding: 14,
    gap: 10,
  },
  cardTitle: { color: color.text, fontSize: 22, fontWeight: '600' },
  cardMeta: { color: color.muted, fontSize: 14 },

  columns: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 },
  columnLabel: { color: color.muted, fontSize: 12 },
  columnNumber: { width: 36 },
  columnReference: { flex: 1 },
  columnInput: { width: 64, textAlign: 'center' },
  columnInputSmall: { width: 44, textAlign: 'center' },
  columnCheck: { width: 44 },

  setRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minHeight: 60,
    paddingVertical: 6,
    paddingHorizontal: 4,
    borderRadius: 8,
  },
  setRowActive: { backgroundColor: color.surface },
  setRowDone: { opacity: 0.6 },
  setRowSkipped: { opacity: 0.35 },
  setNumber: { width: 36, gap: 2 },
  setNumberText: {
    color: color.text,
    fontSize: 16,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
  setKind: { color: color.muted, fontSize: 10 },
  setReference: { flex: 1, gap: 2 },
  referenceText: { color: color.text, fontSize: 14 },
  referenceHint: { color: color.muted, fontSize: 11 },
  input: {
    width: 64,
    minHeight: 48,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: color.line,
    backgroundColor: color.bg,
    color: color.text,
    fontSize: 17,
    fontWeight: '600',
    textAlign: 'center',
    paddingVertical: 6,
    fontVariant: ['tabular-nums'],
  },
  inputDisabled: { opacity: 0.4 },
  inputSmall: { width: 44, fontSize: 15 },
  progression: {
    marginTop: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: color.line,
    gap: 4,
  },
  progressionHeadline: { color: color.text, fontSize: 15, fontWeight: '600' },
  progressionDetail: { color: color.text, fontSize: 14 },
  progressionSource: { color: color.muted, fontSize: 12 },
  // Suggestion from history: visible, but clearly not logged yet.
  inputSuggested: { color: color.muted, fontWeight: '400' },

  check: {
    width: 28,
    height: 28,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: color.line,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkLarge: { width: 48, height: 48 },
  checkDone: { backgroundColor: color.green, borderColor: color.green },
  checkMark: { color: color.ink, fontSize: 18, fontWeight: '700' },

  restBlock: { gap: space.xs, marginBottom: space.xxs },
  restActions: { flexDirection: 'row', gap: space.xs },
  restButton: {
    flex: 1,
    minHeight: 48,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: color.line,
    alignItems: 'center',
    justifyContent: 'center',
  },
  undo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    minHeight: 60,
    paddingHorizontal: space.xxs,
  },
  undoText: { ...type.label, flex: 1, color: color.muted },
  undoButton: {
    minHeight: 48,
    paddingHorizontal: space.sm,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: color.line,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rest: {
    height: 34,
    borderRadius: 8,
    backgroundColor: color.surface,
    justifyContent: 'center',
    overflow: 'hidden',
  },
  restFill: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    backgroundColor: color.line,
  },
  restText: {
    color: color.text,
    fontSize: 14,
    fontWeight: '600',
    textAlign: 'center',
    fontVariant: ['tabular-nums'],
  },

  ghost: {
    minHeight: 48,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: color.line,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ghostText: { color: color.text, fontSize: 15, fontWeight: '600' },

  pressed: { opacity: 0.72 },
  disabled: { opacity: 0.4 },
});
