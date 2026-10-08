import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { WorkoutTemplate } from '../domain/strength';
import { getLanguage, tr } from '../domain/i18n';
import { Button, color, Copy } from './components';

/**
 * Overview of training plans.
 *
 * A plan is a suggestion. That's why each plan has "Start" next to it, but
 * nowhere a quota, a backlog, or a reminder. Delete asks once, because it
 * can't be undone.
 */

// Labels are built per call: the language can change at runtime.
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

const daysText = (template: WorkoutTemplate) =>
  template.days.length
    ? template.days.map(weekdayShort).join(', ')
    : tr('Kein fester Tag', 'No fixed day');

const summary = (template: WorkoutTemplate) => {
  const exercises = template.exercises.length;
  const sets = template.exercises.reduce(
    (total, exercise) => total + exercise.sets.length,
    0,
  );
  if (!exercises) {
    return tr('Noch keine Übung hinterlegt', 'No exercises added yet');
  }
  return tr(
    `${exercises} ${exercises === 1 ? 'Übung' : 'Übungen'} · ${sets} ${
      sets === 1 ? 'Satz' : 'Sätze'
    }`,
    `${exercises} ${exercises === 1 ? 'exercise' : 'exercises'} · ${sets} ${
      sets === 1 ? 'set' : 'sets'
    }`,
  );
};

export function PlanList({
  templates,
  today,
  busy = false,
  onCreate,
  onStart,
  onEdit,
  onDuplicate,
  onDelete,
}: {
  templates: WorkoutTemplate[];
  /** Weekday from 0 (Sunday) to 6, as in `Date.getDay`. */
  today: number;
  busy?: boolean;
  onCreate: () => void;
  onStart: (template: WorkoutTemplate) => void;
  onEdit: (template: WorkoutTemplate) => void;
  onDuplicate: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  const [confirming, setConfirming] = useState<string | null>(null);

  return (
    <View style={styles.content}>
      {templates.length ? (
        templates.map(template => {
          const onToday = template.days.includes(today);
          const confirmingThis = confirming === template.id;
          return (
            <View key={template.id} style={styles.card}>
              <Text style={styles.name}>
                {template.name || tr('Ohne Namen', 'Unnamed')}
              </Text>
              <Text style={styles.meta}>
                {daysText(template)} · {summary(template)}
                {onToday
                  ? ` · ${tr('heute', 'today')} ${weekdayLong(today)}`
                  : ''}
              </Text>

              {confirmingThis ? (
                <>
                  <Copy muted>
                    {tr(
                      `${
                        template.name || 'Diesen Plan'
                      } endgültig löschen? Bereits erfasste Einheiten bleiben erhalten.`,
                      `Delete ${
                        template.name || 'this plan'
                      } for good? Workouts already logged are kept.`,
                    )}
                  </Copy>
                  <View style={styles.actions}>
                    <Pressable
                      accessibilityLabel={tr(
                        `Löschen von ${template.name} bestätigen`,
                        `Confirm deleting ${template.name}`,
                      )}
                      accessibilityRole="button"
                      onPress={() => {
                        setConfirming(null);
                        onDelete(template.id);
                      }}
                      style={({ pressed }) => [
                        styles.action,
                        pressed && styles.pressed,
                      ]}
                    >
                      <Text style={styles.actionText}>
                        {tr('Endgültig löschen', 'Delete for good')}
                      </Text>
                    </Pressable>
                    <Pressable
                      accessibilityLabel={tr(
                        'Löschen abbrechen',
                        'Cancel delete',
                      )}
                      accessibilityRole="button"
                      onPress={() => setConfirming(null)}
                      style={({ pressed }) => [
                        styles.action,
                        pressed && styles.pressed,
                      ]}
                    >
                      <Text style={styles.actionText}>
                        {tr('Behalten', 'Keep')}
                      </Text>
                    </Pressable>
                  </View>
                </>
              ) : (
                <>
                  <Button
                    disabled={busy || !template.exercises.length}
                    label={tr(
                      `${template.name || 'Plan ohne Namen'} starten`,
                      `Start ${template.name || 'plan without name'}`,
                    )}
                    small
                    title={tr(
                      `${template.name || 'Plan'} starten`,
                      `Start ${template.name || 'plan'}`,
                    )}
                    onPress={() => onStart(template)}
                  />
                  <View style={styles.actions}>
                    <Pressable
                      accessibilityLabel={tr(
                        `${template.name} bearbeiten`,
                        `Edit ${template.name}`,
                      )}
                      accessibilityRole="button"
                      onPress={() => onEdit(template)}
                      style={({ pressed }) => [
                        styles.action,
                        pressed && styles.pressed,
                      ]}
                    >
                      <Text style={styles.actionText}>
                        {tr('Bearbeiten', 'Edit')}
                      </Text>
                    </Pressable>
                    <Pressable
                      accessibilityLabel={tr(
                        `${template.name} duplizieren`,
                        `Duplicate ${template.name}`,
                      )}
                      accessibilityRole="button"
                      onPress={() => onDuplicate(template.id)}
                      style={({ pressed }) => [
                        styles.action,
                        pressed && styles.pressed,
                      ]}
                    >
                      <Text style={styles.actionText}>
                        {tr('Duplizieren', 'Duplicate')}
                      </Text>
                    </Pressable>
                    <Pressable
                      accessibilityLabel={tr(
                        `${template.name} löschen`,
                        `Delete ${template.name}`,
                      )}
                      accessibilityRole="button"
                      onPress={() => setConfirming(template.id)}
                      style={({ pressed }) => [
                        styles.action,
                        pressed && styles.pressed,
                      ]}
                    >
                      <Text style={styles.actionText}>
                        {tr('Löschen', 'Delete')}
                      </Text>
                    </Pressable>
                  </View>
                </>
              )}
            </View>
          );
        })
      ) : (
        <View style={styles.card}>
          <Text style={styles.name}>{tr('Noch kein Plan', 'No plan yet')}</Text>
          <Copy muted>
            {tr(
              'Du kannst jederzeit frei trainieren. Eine Vorlage hält wiederkehrende Einheiten fest.',
              'You can always train freely. A template keeps recurring workouts.',
            )}
          </Copy>
        </View>
      )}

      <Button
        label={tr('Neuen Trainingsplan anlegen', 'Create a new training plan')}
        title={tr('Neuen Plan anlegen', 'Create new plan')}
        onPress={onCreate}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  content: { gap: 12, paddingBottom: 24 },
  card: {
    borderRadius: 8,
    backgroundColor: color.raised,
    padding: 14,
    gap: 10,
  },
  name: { color: color.text, fontSize: 18, fontWeight: '600' },
  meta: { color: color.muted, fontSize: 14, lineHeight: 21 },
  actions: { flexDirection: 'row', gap: 8 },
  action: {
    flex: 1,
    minHeight: 44,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: color.line,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  actionText: { color: color.text, fontSize: 14, fontWeight: '600' },
  pressed: { opacity: 0.72 },
});
