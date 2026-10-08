import React, {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import {
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

/** Labels der Uhr im Training; ein Satz Hinweis nur, wenn der Nutzer etwas tun kann. */
const WATCH_WORDS: Record<
  StrengthWatchLive,
  { label: string; muted: boolean }
> = {
  measuring: { label: 'Misst', muted: false },
  starting: { label: 'Startet', muted: true },
  silent: { label: 'Keine Daten', muted: true },
  failed: { label: 'Misst nicht', muted: true },
  disconnected: { label: 'Nicht verbunden', muted: true },
};

/**
 * Eine schmale Zeile unter dem Kopf: was die Uhr gerade misst und der Puls
 * jetzt. Ohne frischen Wert steht „–“, kein alter Puls.
 */
function WatchStrip({
  watch,
}: {
  watch: { state: StrengthWatchLive; bpm?: number; hint?: string };
}) {
  const words = WATCH_WORDS[watch.state];
  const measuring = watch.state === 'measuring';
  return (
    <View
      accessibilityLiveRegion="polite"
      accessibilityLabel={`Uhr: ${words.label}${
        measuring
          ? watch.bpm !== undefined
            ? `, Puls ${watch.bpm} Schläge pro Minute`
            : ', noch kein Puls'
          : ''
      }${watch.hint ? `. ${watch.hint}` : ''}`}
      style={styles.watch}
    >
      <View style={styles.watchLine}>
        <Text style={styles.watchTitle}>Uhr</Text>
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
 * Aktive Trainingsansicht: Sätze in Sekunden bestätigen, Abweichungen ohne Wertung erfassen.
 *
 * Aufbau: erledigte Übungen als schmale Zeilen oben, die aktuelle Übung als
 * ausgeklappte Karte in der Mitte, kommende Übungen als schmale Zeilen unten.
 * Eine Zeile antippen wechselt die Übung. Ein Satz lässt sich nach links
 * wegwischen; bis zur nächsten Änderung steht an seiner Stelle „Rückgängig“.
 */

/** So lange bleibt „Rückgängig“ nach dem Löschen eines Satzes stehen. */
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
      ? 'Eigengewicht'
      : planned.weightKg
      ? `${formatWeight(planned.weightKg)} kg`
      : null;
  const reps = planned.reps ? `${planned.reps} Wdh.` : null;
  return [weight, reps].filter(Boolean).join(' × ') || 'frei';
};

/** Voreinstellung eines Eingabefeldes aus der letzten vergleichbaren Einheit. */
interface SetSuggestion {
  weightKg?: number;
  reps?: number;
  seconds?: number;
}

/** Ein Entwurf bleibt lokal; ein neuer gespeicherter Wert oder Satzabschluss gilt. */
function useSetInput(
  initial: string,
  stored: number | undefined,
  completedAt: number | undefined,
) {
  const [value, setValue] = useState(initial);
  const [touched, setTouched] = useState(false);
  const previous = useRef({ stored, completedAt });
  useEffect(() => {
    const changed =
      previous.current.stored !== stored ||
      previous.current.completedAt !== completedAt;
    previous.current = { stored, completedAt };
    if (!touched || changed) {
      setValue(initial);
      setTouched(false);
    }
  }, [initial, stored, completedAt, touched]);
  const change = (next: string) => {
    setTouched(true);
    setValue(next);
  };
  return [value, change, touched] as const;
}

const kindLabel: Record<string, string> = {
  warmup: 'Aufwärmen',
  failure: 'bis Versagen',
  dropset: 'Dropsatz',
  timed: 'Zeitsatz',
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
      accessibilityLabel={`${exercise.name}, ${progress.completed} von ${progress.total} Sätzen erledigt`}
      onPress={() => onPress(index)}
      style={({ pressed }) => [styles.compact, pressed && styles.pressed]}
    >
      <Text style={styles.compactArrow}>{direction === 'up' ? '↑' : '↓'}</Text>
      <Text numberOfLines={1} style={styles.compactName}>
        {exercise.name}
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
  /** Unter dem Kopf „Zuletzt“ kennzeichnet die Zeile eine bloße Vorgabe. */
  markPlanned: boolean;
  suggestion: SetSuggestion | null;
  active: boolean;
  /** Ohne das Feld bleibt die Reserve unbekannt; gespeicherte Werte bleiben. */
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
  // Erfasster Wert schlägt Planwert, Planwert schlägt Vorschlag aus der
  // Historie. Der Vorschlag ist nur eine Voreinstellung im Eingabefeld; erst
  // das Häkchen macht daraus einen tatsächlichen Wert (T-5).
  const ownWeight = set.actualWeightKg ?? set.planned.weightKg ?? undefined;
  const ownReps = timed
    ? set.actualSeconds ?? set.planned.seconds ?? undefined
    : set.actualReps ?? set.planned.reps ?? undefined;
  const suggestedWeight = suggestion?.weightKg;
  const suggestedReps = timed ? suggestion?.seconds : suggestion?.reps;
  const initialWeight = ownWeight ?? suggestedWeight;
  const initialReps = ownReps ?? suggestedReps;
  const [weight, setWeight, weightTouched] = useSetInput(
    initialWeight === undefined ? '' : formatWeight(initialWeight),
    set.actualWeightKg,
    set.completedAt,
  );
  const [reps, setReps, repsTouched] = useSetInput(
    initialReps === undefined ? '' : String(initialReps),
    timed ? set.actualSeconds : set.actualReps,
    set.completedAt,
  );
  // Reserve (RIR) ist freiwillig und nur eine Nutzereingabe. Leer heißt
  // unbekannt; die App schätzt sie nicht aus demselben Satz.
  const [rir, setRir] = useSetInput(
    set.actualRir === undefined ? '' : String(set.actualRir),
    set.actualRir,
    set.completedAt,
  );
  const done = set.completedAt !== undefined;
  const weightIsSuggested =
    !weightTouched &&
    !done &&
    ownWeight === undefined &&
    suggestedWeight !== undefined;
  const repsIsSuggested =
    !repsTouched && !done && ownReps === undefined && suggestedReps !== undefined;
  const bodyweight = set.planned.loadKind === 'bodyweight';
  const note = kindLabel[set.planned.kind];

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
        {/* Der Spaltenkopf nennt die Herkunft; nur Abweichungen stehen hier. */}
        {markPlanned && !reference ? (
          <Text style={styles.referenceHint}>Vorgabe</Text>
        ) : null}
      </View>
      <TextInput
        accessibilityLabel={`Gewicht für Satz ${position}${
          weightIsSuggested ? ', Vorschlag aus der letzten Einheit' : ''
        }`}
        editable={!bodyweight}
        keyboardType="decimal-pad"
        onBlur={() => onEdit(set.id, weight, reps, rir, timed)}
        onChangeText={setWeight}
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
        accessibilityLabel={`${
          timed ? 'Sekunden' : 'Wiederholungen'
        } für Satz ${position}${
          repsIsSuggested ? ', Vorschlag aus der letzten Einheit' : ''
        }`}
        keyboardType="number-pad"
        onBlur={() => onEdit(set.id, weight, reps, rir, timed)}
        onChangeText={setReps}
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
          accessibilityLabel={`Wiederholungen im Tank für Satz ${position}, optional`}
          keyboardType="number-pad"
          onBlur={() => onEdit(set.id, weight, reps, rir, timed)}
          onChangeText={setRir}
          placeholder="–"
          placeholderTextColor={color.muted}
          selectTextOnFocus
          style={[styles.input, styles.inputSmall]}
          value={rir}
        />
      )}
      <Pressable
        accessibilityLabel={
          done ? `Satz ${position} zurücknehmen` : `Satz ${position} bestätigen`
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
 * Kurzfassung des Kraftverlaufs einer Übung, sichtbar sobald alle Sätze
 * erledigt sind. Zeigt eine Einschätzung mit Unsicherheit, keine Bewertung.
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
  const headline = `Bestes geschätztes Maximum: ${formatWeight(
    Math.round(latest.e1rm * 10) / 10,
  )} kg`;
  const missing =
    MINIMUM_SESSIONS_FOR_DIRECTION - collapseToDays(assessment.series).length;
  const detail =
    assessment.verdict === 'not_assessable'
      ? missing > 0
        ? `Noch ${missing} ${
            missing === 1 ? 'Trainingstag' : 'Trainingstage'
          } bis zur ersten Einschätzung des Verlaufs.`
        : 'Der Verlauf ist noch nicht belastbar einzuschätzen.'
      : // Nur Beobachtung: Eine Handlung („steigern“, „reduzieren“) gibt es
      // allein als Empfehlung im Coach (Grundregeln 3 und 15).
      assessment.verdict === 'increase'
      ? 'Der Verlauf zeigt nach oben.'
      : assessment.verdict === 'reduce'
      ? 'Der Verlauf zeigt nach unten.'
      : assessment.verdict === 'plateau'
      ? `Seit ${Math.round(
          assessment.plateau.spanWeeks,
        )} Wochen nachweislich stabil.`
      : 'Noch nicht klar: Änderung und Stillstand sind beide möglich. So weitermachen ist eine eigene Entscheidung.';
  return (
    <View style={styles.progression}>
      <Text style={styles.progressionHeadline}>{headline}</Text>
      <Text style={styles.progressionDetail}>{detail}</Text>
      <Text style={styles.progressionSource}>
        Schätzung aus {assessment.series.length}{' '}
        {assessment.series.length === 1 ? 'Einheit' : 'Einheiten'}, keine
        Messung.
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
  /** Live-Zustand der Uhr (`strengthWatchLive`); ohne Uhr keine Zeile. */
  watch?: { state: StrengthWatchLive; bpm?: number; hint?: string } | null;
  session: StrengthSession;
  history: StrengthSession[];
  /** Vollstaendige Historie fuer den Verlauf. Fehlt sie, entfaellt die Notiz. */
  sessions?: StrengthSession[];
  now: number;
  busy?: boolean;
  /** Eingabefeld „Wiederholungen im Tank“ anbieten. */
  showRir?: boolean;
  /** Pausenbalken nach einem Satz zeigen. Die Pause selbst wird immer gespeichert. */
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
  /** Ohne Rückruf lässt sich kein Satz wegwischen. */
  onRemoveSet?: (exerciseIndex: number, setId: string) => void;
  onRestoreSet?: (exerciseIndex: number, set: LoggedSet, position: number) => void;
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
      <Text style={styles.undoText}>Satz {undo.position + 1} gelöscht</Text>
      <Pressable
        accessibilityLabel={`Satz ${undo.position + 1} wiederherstellen`}
        accessibilityRole="button"
        onPress={() => {
          onRestoreSet?.(undo.exerciseIndex, undo.set, undo.position);
          setRemoved(null);
        }}
        style={({ pressed }) => [styles.undoButton, pressed && styles.pressed]}
      >
        <Text style={styles.ghostText}>Rückgängig</Text>
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

  // Vorschläge aus der letzten vergleichbaren Einheit. Sie füllen nur die
  // Eingabefelder vor, damit ein bestätigter Satz ein Tippen kostet.
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

  // Erst rechnen, wenn die Übung fertig ist. Vorher lenkt der Verlauf nur ab.
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
          accessibilityLabel="Training in den Hintergrund legen"
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
            {session.name}
          </Text>
          <Text style={styles.headerMeta}>
            {formatElapsed(elapsed)} · {progress.completedSets} von{' '}
            {progress.totalSets} Sätzen
          </Text>
        </View>
        <Pressable
          accessibilityLabel="Training beenden"
          accessibilityRole="button"
          disabled={busy}
          onPress={onFinish}
          style={({ pressed }) => [
            styles.finish,
            busy && styles.disabled,
            pressed && styles.pressed,
          ]}
        >
          <Text style={styles.finishText}>Beenden</Text>
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
            <Text style={styles.cardTitle}>{current.name}</Text>
            <Text style={styles.cardMeta}>
              {currentProgress.done
                ? 'Alle Sätze erledigt'
                : `Satz ${Math.min(
                    currentProgress.completed + 1,
                    currentProgress.total,
                  )} von ${currentProgress.total}`}
              {current.added ? ' · frei ergänzt' : ''}
            </Text>

            <View style={styles.columns}>
              <Text style={[styles.columnLabel, styles.columnNumber]}>#</Text>
              <Text style={[styles.columnLabel, styles.columnReference]}>
                {/* Ohne frühere Sätze steht dort die Vorgabe, nicht „zuletzt“. */}
                {references.some(Boolean) ? 'Zuletzt' : 'Vorgabe'}
              </Text>
              <Text style={[styles.columnLabel, styles.columnInput]}>kg</Text>
              <Text style={[styles.columnLabel, styles.columnInput]}>Wdh.</Text>
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
                  label={`Satz ${position + 1} löschen`}
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
                      accessibilityLabel={`Pause${
                        restPaused ? ' angehalten' : ''
                      }, noch ${formatClock(rest)}`}
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
                        {restPaused ? 'Pause angehalten' : 'Pause'}{' '}
                        {formatClock(rest)}
                      </Text>
                    </View>
                    {onPauseRest && onResumeRest && onSkipRest ? (
                      <View style={styles.restActions}>
                        <Pressable
                          accessibilityLabel={
                            restPaused ? 'Pause weiterlaufen lassen' : 'Pause anhalten'
                          }
                          accessibilityRole="button"
                          onPress={restPaused ? onResumeRest : onPauseRest}
                          style={({ pressed }) => [
                            styles.restButton,
                            pressed && styles.pressed,
                          ]}
                        >
                          <Text style={styles.ghostText}>
                            {restPaused ? 'Weiter' : 'Anhalten'}
                          </Text>
                        </Pressable>
                        <Pressable
                          accessibilityLabel="Pause überspringen"
                          accessibilityRole="button"
                          onPress={onSkipRest}
                          style={({ pressed }) => [
                            styles.restButton,
                            pressed && styles.pressed,
                          ]}
                        >
                          <Text style={styles.ghostText}>Überspringen</Text>
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
              accessibilityLabel="Satz hinzufügen"
              accessibilityRole="button"
              onPress={() => onAddSet(index)}
              style={({ pressed }) => [styles.ghost, pressed && styles.pressed]}
            >
              <Text style={styles.ghostText}>+ Satz</Text>
            </Pressable>
          </View>
        ) : (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Noch keine Übung</Text>
            <Copy muted>
              Füge eine Übung hinzu, um mit dem Aufzeichnen zu beginnen.
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
          accessibilityLabel="Übung hinzufügen"
          accessibilityRole="button"
          onPress={onAddExercise}
          style={({ pressed }) => [styles.ghost, pressed && styles.pressed]}
        >
          <Text style={styles.ghostText}>+ Übung</Text>
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
  // Vorschlag aus der Historie: sichtbar, aber erkennbar noch nicht erfasst.
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
