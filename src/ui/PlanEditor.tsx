import React, { memo, useCallback, useMemo, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import {
  addPlannedSet,
  addTemplateExercise,
  clearTemplateDays,
  moveTemplateExercise,
  removePlannedSet,
  removeTemplateExercise,
  renameTemplate,
  toggleTemplateDay,
  updatePlannedSet,
  validateTemplate,
  WEEKDAY_ORDER,
  type PlannedSetValues,
} from '../domain/plans';
import {
  formatWeight,
  type Exercise,
  type LoadKind,
  type PlannedSet,
  type SetKind,
  type WorkoutTemplate,
} from '../domain/strength';
import { color, Copy } from './components';
import { ExercisePicker } from './ExercisePicker';
import { getLanguage, tr } from '../domain/i18n';
import { exerciseDisplayName } from '../domain/catalog';

/**
 * Create and edit a plan.
 *
 * The plan is the user's artifact: every change here comes from the user;
 * nothing shifts on its own. Open points show as a quiet note next to the
 * field, not as an error message.
 */

const SET_KINDS: SetKind[] = [
  'warmup',
  'normal',
  'failure',
  'dropset',
  'timed',
];

// Labels are built per call: the language can change at runtime.
const setKindLabel = (kind: SetKind): string =>
  ({
    warmup: tr('Aufwärmen', 'Warm-up'),
    normal: tr('Arbeitssatz', 'Working set'),
    failure: tr('bis Versagen', 'to failure'),
    dropset: tr('Dropsatz', 'Drop set'),
    timed: tr('Zeitsatz', 'Timed set'),
  }[kind]);

const setKindShort = (kind: SetKind): string =>
  ({
    warmup: tr('Aufw.', 'Warm'),
    normal: tr('Arbeit', 'Work'),
    failure: tr('Vers.', 'Fail'),
    dropset: tr('Drop', 'Drop'),
    timed: tr('Zeit', 'Time'),
  }[kind]);

const loadKindLabel = (kind: LoadKind): string =>
  ({
    unknown: tr('Lastart unbekannt', 'Load type unknown'),
    kg: tr('Zusatzlast in kg', 'Extra load in kg'),
    bodyweight: tr('Eigengewicht', 'Bodyweight'),
    assisted: tr('mit Unterstützung', 'assisted'),
    bodyweight_plus: tr('Eigengewicht plus Last', 'Bodyweight plus load'),
  }[kind]);

// Weekday names by `Date#getDay` index (0 = Sunday).
const weekdayLong = (day: number): string =>
  (getLanguage() === 'en'
    ? [
        'Sunday',
        'Monday',
        'Tuesday',
        'Wednesday',
        'Thursday',
        'Friday',
        'Saturday',
      ]
    : [
        'Sonntag',
        'Montag',
        'Dienstag',
        'Mittwoch',
        'Donnerstag',
        'Freitag',
        'Samstag',
      ])[day];
const weekdayShort = (day: number): string =>
  (getLanguage() === 'en'
    ? ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
    : ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'])[day];

const LOAD_KINDS: LoadKind[] = [
  'unknown',
  'kg',
  'bodyweight',
  'assisted',
  'bodyweight_plus',
];

const nextIn = <T,>(values: T[], current: T): T =>
  values[(Math.max(0, values.indexOf(current)) + 1) % values.length];

const numberText = (value?: number) =>
  value === undefined ? '' : formatWeight(value);

const parseNumber = (text: string): number | undefined => {
  const trimmed = text.trim();
  if (!trimmed) {
    return undefined;
  }
  const parsed = Number(trimmed.replace(',', '.'));
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
};

const SetRow = memo(function SetRow({
  set,
  exerciseName,
  position,
  onChange,
  onCycleKind,
  onRemove,
  removable,
}: {
  set: PlannedSet;
  exerciseName: string;
  position: number;
  onChange: (values: PlannedSetValues) => void;
  onCycleKind: () => void;
  onRemove: () => void;
  removable: boolean;
}) {
  const timed = set.kind === 'timed';
  const bodyweight = set.loadKind === 'bodyweight';
  const [weight, setWeight] = useState(numberText(set.weightKg));
  const [reps, setReps] = useState(numberText(timed ? set.seconds : set.reps));
  const [rest, setRest] = useState(numberText(set.restSeconds));

  return (
    <View style={styles.setRow}>
      <Pressable
        accessibilityLabel={tr(
          `Satzart für Satz ${position} von ${exerciseName}, jetzt ${setKindLabel(
            set.kind,
          )}, weiterschalten`,
          `Set type for set ${position} of ${exerciseName}, now ${setKindLabel(
            set.kind,
          )}, switch to next`,
        )}
        accessibilityRole="button"
        onPress={onCycleKind}
        style={({ pressed }) => [styles.kind, pressed && styles.pressed]}
      >
        <Text style={styles.kindNumber}>{position}</Text>
        <Text numberOfLines={1} style={styles.kindLabel}>
          {setKindShort(set.kind)}
        </Text>
      </Pressable>
      <TextInput
        accessibilityLabel={tr(
          `Gewicht für Satz ${position} von ${exerciseName} in Kilogramm`,
          `Weight for set ${position} of ${exerciseName} in kilograms`,
        )}
        editable={!bodyweight}
        keyboardType="decimal-pad"
        onBlur={() => onChange({ weightKg: parseNumber(weight) })}
        onChangeText={setWeight}
        placeholder={bodyweight ? '–' : 'kg'}
        placeholderTextColor={color.muted}
        selectTextOnFocus
        style={[styles.input, bodyweight && styles.inputDisabled]}
        value={bodyweight ? '' : weight}
      />
      <TextInput
        accessibilityLabel={tr(
          `${
            timed ? 'Sekunden' : 'Wiederholungen'
          } für Satz ${position} von ${exerciseName}`,
          `${
            timed ? 'Seconds' : 'Reps'
          } for set ${position} of ${exerciseName}`,
        )}
        keyboardType="number-pad"
        onBlur={() =>
          onChange(
            timed
              ? { seconds: parseNumber(reps), reps: undefined }
              : { reps: parseNumber(reps), seconds: undefined },
          )
        }
        onChangeText={setReps}
        placeholder={timed ? 's' : tr('Wdh.', 'Reps')}
        placeholderTextColor={color.muted}
        selectTextOnFocus
        style={styles.input}
        value={reps}
      />
      <TextInput
        accessibilityLabel={tr(
          `Pause nach Satz ${position} von ${exerciseName} in Sekunden`,
          `Rest after set ${position} of ${exerciseName} in seconds`,
        )}
        keyboardType="number-pad"
        onBlur={() => onChange({ restSeconds: parseNumber(rest) })}
        onChangeText={setRest}
        placeholder="s"
        placeholderTextColor={color.muted}
        selectTextOnFocus
        style={styles.input}
        value={rest}
      />
      <Pressable
        accessibilityLabel={tr(
          `Satz ${position} von ${exerciseName} entfernen`,
          `Remove set ${position} of ${exerciseName}`,
        )}
        accessibilityRole="button"
        accessibilityState={{ disabled: !removable }}
        disabled={!removable}
        onPress={onRemove}
        style={({ pressed }) => [
          styles.iconButton,
          !removable && styles.disabled,
          pressed && styles.pressed,
        ]}
      >
        <Text style={styles.iconText}>−</Text>
      </Pressable>
    </View>
  );
});

export function PlanEditor({
  template,
  busy = false,
  defaultRestSeconds,
  onSave,
  onCancel,
}: {
  template: WorkoutTemplate;
  busy?: boolean;
  /** Rest for new sets; existing sets keep their values. */
  defaultRestSeconds?: number;
  onSave: (template: WorkoutTemplate) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState<WorkoutTemplate>(template);
  const [pickerOpen, setPickerOpen] = useState(false);
  const validation = useMemo(() => validateTemplate(draft), [draft]);

  const change = useCallback(
    (next: (current: WorkoutTemplate) => WorkoutTemplate) =>
      setDraft(current => next(current)),
    [],
  );

  const setValues = useCallback(
    (exerciseIndex: number, setIndex: number, values: PlannedSetValues) =>
      change(current =>
        updatePlannedSet(current, exerciseIndex, setIndex, values),
      ),
    [change],
  );

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <Pressable
          accessibilityLabel={tr('Bearbeiten abbrechen', 'Cancel editing')}
          accessibilityRole="button"
          onPress={onCancel}
          style={({ pressed }) => [
            styles.headerButton,
            pressed && styles.pressed,
          ]}
        >
          <Text style={styles.headerButtonText}>‹</Text>
        </Pressable>
        <Text numberOfLines={1} style={styles.headerTitle}>
          {draft.name.trim() || tr('Neuer Plan', 'New plan')}
        </Text>
        <Pressable
          accessibilityLabel={tr('Plan speichern', 'Save plan')}
          accessibilityRole="button"
          accessibilityState={{ disabled: busy || !validation.ok }}
          disabled={busy || !validation.ok}
          onPress={() => onSave(draft)}
          style={({ pressed }) => [
            styles.save,
            (busy || !validation.ok) && styles.disabled,
            pressed && styles.pressed,
          ]}
        >
          <Text style={styles.saveText}>{tr('Speichern', 'Save')}</Text>
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.card}>
          <Text style={styles.label}>Name</Text>
          <TextInput
            accessibilityLabel={tr('Name des Plans', 'Plan name')}
            onChangeText={value =>
              change(current => renameTemplate(current, value))
            }
            placeholder={tr(
              'Zum Beispiel Oberkörper A',
              'For example, Upper body A',
            )}
            placeholderTextColor={color.muted}
            style={styles.nameInput}
            value={draft.name}
          />
        </View>

        <View style={styles.card}>
          <Text style={styles.label}>{tr('Wochentage', 'Weekdays')}</Text>
          <Copy muted style={styles.hint}>
            {tr(
              'Ohne festen Tag ist der Plan jederzeit startbar. Ein Tag ist ein Vorschlag, keine Verpflichtung.',
              'Without a fixed day, the plan can be started at any time. A day is a suggestion, not a commitment.',
            )}
          </Copy>
          <View style={styles.days}>
            {WEEKDAY_ORDER.map(day => {
              const active = draft.days.includes(day);
              return (
                <Pressable
                  accessibilityLabel={`${weekdayLong(day)}${
                    active ? tr(', ausgewählt', ', selected') : ''
                  }`}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  key={day}
                  onPress={() =>
                    change(current => toggleTemplateDay(current, day))
                  }
                  style={({ pressed }) => [
                    styles.day,
                    active && styles.dayActive,
                    pressed && styles.pressed,
                  ]}
                >
                  <Text
                    style={[styles.dayText, active && styles.dayTextActive]}
                  >
                    {weekdayShort(day)}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          <Pressable
            accessibilityLabel={tr(
              'Keinen festen Tag festlegen',
              'Clear fixed day',
            )}
            accessibilityRole="button"
            onPress={() => change(clearTemplateDays)}
            style={({ pressed }) => [styles.ghost, pressed && styles.pressed]}
          >
            <Text style={styles.ghostText}>
              {tr('Kein fester Tag', 'No fixed day')}
            </Text>
          </Pressable>
        </View>

        {draft.exercises.map((exercise, exerciseIndex) => (
          <View
            key={`${exercise.exerciseId}-${exerciseIndex}`}
            style={styles.card}
          >
            <View style={styles.exerciseHead}>
              <Text numberOfLines={2} style={styles.exerciseName}>
                {exerciseDisplayName(exercise.exerciseId, exercise.name)}
              </Text>
              <Pressable
                accessibilityLabel={tr(
                  `${exerciseDisplayName(exercise.exerciseId, exercise.name)} nach oben schieben`,
                  `Move ${exerciseDisplayName(exercise.exerciseId, exercise.name)} up`,
                )}
                accessibilityRole="button"
                accessibilityState={{ disabled: exerciseIndex === 0 }}
                disabled={exerciseIndex === 0}
                onPress={() =>
                  change(current =>
                    moveTemplateExercise(
                      current,
                      exerciseIndex,
                      exerciseIndex - 1,
                    ),
                  )
                }
                style={({ pressed }) => [
                  styles.iconButton,
                  exerciseIndex === 0 && styles.disabled,
                  pressed && styles.pressed,
                ]}
              >
                <Text style={styles.iconText}>↑</Text>
              </Pressable>
              <Pressable
                accessibilityLabel={tr(
                  `${exerciseDisplayName(exercise.exerciseId, exercise.name)} nach unten schieben`,
                  `Move ${exerciseDisplayName(exercise.exerciseId, exercise.name)} down`,
                )}
                accessibilityRole="button"
                accessibilityState={{
                  disabled: exerciseIndex === draft.exercises.length - 1,
                }}
                disabled={exerciseIndex === draft.exercises.length - 1}
                onPress={() =>
                  change(current =>
                    moveTemplateExercise(
                      current,
                      exerciseIndex,
                      exerciseIndex + 1,
                    ),
                  )
                }
                style={({ pressed }) => [
                  styles.iconButton,
                  exerciseIndex === draft.exercises.length - 1 &&
                    styles.disabled,
                  pressed && styles.pressed,
                ]}
              >
                <Text style={styles.iconText}>↓</Text>
              </Pressable>
              <Pressable
                accessibilityLabel={tr(
                  `${exerciseDisplayName(exercise.exerciseId, exercise.name)} aus dem Plan nehmen`,
                  `Remove ${exerciseDisplayName(exercise.exerciseId, exercise.name)} from the plan`,
                )}
                accessibilityRole="button"
                onPress={() =>
                  change(current =>
                    removeTemplateExercise(current, exerciseIndex),
                  )
                }
                style={({ pressed }) => [
                  styles.iconButton,
                  pressed && styles.pressed,
                ]}
              >
                <Text style={styles.iconText}>×</Text>
              </Pressable>
            </View>

            <Pressable
              accessibilityLabel={tr(
                `Lastart für ${exerciseDisplayName(exercise.exerciseId, exercise.name)}, jetzt ${loadKindLabel(
                  exercise.sets[0]?.loadKind || 'kg',
                )}, weiterschalten`,
                `Load type for ${exerciseDisplayName(exercise.exerciseId, exercise.name)}, now ${loadKindLabel(
                  exercise.sets[0]?.loadKind || 'kg',
                )}, switch to next`,
              )}
              accessibilityRole="button"
              onPress={() =>
                change(current => {
                  const sets = current.exercises[exerciseIndex]?.sets || [];
                  const loadKind = nextIn(
                    LOAD_KINDS,
                    sets[0]?.loadKind || 'kg',
                  );
                  return sets.reduce(
                    (next, _set, setIndex) =>
                      updatePlannedSet(next, exerciseIndex, setIndex, {
                        loadKind,
                      }),
                    current,
                  );
                })
              }
              style={({ pressed }) => [styles.chip, pressed && styles.pressed]}
            >
              <Text style={styles.chipText}>
                {loadKindLabel(exercise.sets[0]?.loadKind || 'kg')}
              </Text>
            </Pressable>

            <View style={styles.columns}>
              <Text style={[styles.columnLabel, styles.columnKind]}>
                {tr('Satz', 'Set')}
              </Text>
              <Text style={[styles.columnLabel, styles.columnInput]}>kg</Text>
              <Text style={[styles.columnLabel, styles.columnInput]}>
                {tr('Wdh.', 'Reps')}
              </Text>
              <Text style={[styles.columnLabel, styles.columnInput]}>
                {tr('Pause', 'Rest')}
              </Text>
              <View style={styles.columnIcon} />
            </View>

            {exercise.sets.map((set, setIndex) => (
              <SetRow
                exerciseName={exerciseDisplayName(exercise.exerciseId, exercise.name)}
                key={`${exercise.exerciseId}-${exerciseIndex}-${setIndex}-${set.kind}-${set.loadKind}`}
                onChange={values => setValues(exerciseIndex, setIndex, values)}
                onCycleKind={() =>
                  setValues(exerciseIndex, setIndex, {
                    kind: nextIn(SET_KINDS, set.kind),
                  })
                }
                onRemove={() =>
                  change(current =>
                    removePlannedSet(current, exerciseIndex, setIndex),
                  )
                }
                position={setIndex + 1}
                removable={exercise.sets.length > 1}
                set={set}
              />
            ))}

            <Pressable
              accessibilityLabel={tr(
                `Satz zu ${exercise.name} hinzufügen`,
                `Add set to ${exercise.name}`,
              )}
              accessibilityRole="button"
              onPress={() =>
                change(current =>
                  addPlannedSet(current, exerciseIndex, defaultRestSeconds),
                )
              }
              style={({ pressed }) => [styles.ghost, pressed && styles.pressed]}
            >
              <Text style={styles.ghostText}>{tr('+ Satz', '+ Set')}</Text>
            </Pressable>
          </View>
        ))}

        <Pressable
          accessibilityLabel={tr(
            'Übung zum Plan hinzufügen',
            'Add exercise to plan',
          )}
          accessibilityRole="button"
          onPress={() => setPickerOpen(true)}
          style={({ pressed }) => [styles.ghost, pressed && styles.pressed]}
        >
          <Text style={styles.ghostText}>{tr('+ Übung', '+ Exercise')}</Text>
        </Pressable>

        {validation.problems.length ? (
          <View style={styles.notes}>
            {validation.problems.map(problem => (
              <Copy key={`${problem.field}-${problem.message}`} muted>
                {problem.message}
              </Copy>
            ))}
          </View>
        ) : null}
      </ScrollView>

      <ExercisePicker
        onClose={() => setPickerOpen(false)}
        onSelect={(exercise: Exercise) => {
          setPickerOpen(false);
          change(current =>
            addTemplateExercise(current, exercise, 3, defaultRestSeconds),
          );
        }}
        visible={pickerOpen}
      />
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
    width: 44,
    height: 44,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: color.surface,
  },
  headerButtonText: { color: color.text, fontSize: 24, lineHeight: 26 },
  headerTitle: { flex: 1, color: color.text, fontSize: 17, fontWeight: '600' },
  save: {
    minHeight: 44,
    paddingHorizontal: 14,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: color.green,
  },
  saveText: { color: color.ink, fontSize: 15, fontWeight: '700' },

  content: { padding: 12, paddingBottom: 48, gap: 10 },
  card: {
    borderRadius: 8,
    backgroundColor: color.raised,
    padding: 14,
    gap: 10,
  },
  label: { color: color.muted, fontSize: 13 },
  hint: { fontSize: 14, lineHeight: 21 },
  nameInput: {
    minHeight: 48,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: color.line,
    backgroundColor: color.bg,
    color: color.text,
    fontSize: 17,
    paddingHorizontal: 12,
  },

  days: { flexDirection: 'row', gap: 6 },
  day: {
    flex: 1,
    minHeight: 44,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: color.line,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dayActive: { backgroundColor: color.green, borderColor: color.green },
  dayText: { color: color.text, fontSize: 14, fontWeight: '600' },
  dayTextActive: { color: color.ink },

  exerciseHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  exerciseName: { flex: 1, color: color.text, fontSize: 17, fontWeight: '600' },

  chip: {
    alignSelf: 'flex-start',
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: color.line,
    backgroundColor: color.surface,
  },
  chipText: { color: color.text, fontSize: 14 },

  columns: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  columnLabel: { color: color.muted, fontSize: 12 },
  columnKind: { width: 52 },
  columnInput: { width: 60, textAlign: 'center' },
  columnIcon: { width: 44 },

  setRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  kind: {
    width: 52,
    minHeight: 44,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: color.surface,
  },
  kindNumber: {
    color: color.text,
    fontSize: 15,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
  kindLabel: { color: color.muted, fontSize: 10 },
  input: {
    width: 60,
    minHeight: 48,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: color.line,
    backgroundColor: color.bg,
    color: color.text,
    fontSize: 16,
    fontWeight: '600',
    textAlign: 'center',
    paddingVertical: 6,
    fontVariant: ['tabular-nums'],
  },
  inputDisabled: { opacity: 0.4 },

  iconButton: {
    width: 44,
    height: 44,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: color.surface,
  },
  iconText: { color: color.text, fontSize: 18, lineHeight: 20 },

  ghost: {
    minHeight: 48,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: color.line,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ghostText: { color: color.text, fontSize: 15, fontWeight: '600' },

  notes: { gap: 6, paddingHorizontal: 2 },
  pressed: { opacity: 0.72 },
  disabled: { opacity: 0.4 },
});
