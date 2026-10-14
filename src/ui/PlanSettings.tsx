import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { getLanguage, tr } from '../domain/i18n';
import { mondayDay, setRunDays, type ScheduleState } from '../domain/schedule';
import type { WorkoutTemplate } from '../domain/strength';
import { templateIcon } from '../domain/trainingIcons';
import {
  Button,
  Copy,
  IconPicker,
  Row,
  Section,
  Sheet,
  Title,
  WeekdayChips,
  WorkoutIcon,
  color,
  space,
  type as typography,
} from './components';

// Monday first; labels are read per call because the language can change.
const dayLabels = () =>
  getLanguage() === 'en'
    ? ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
    : ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];

const toggled = (days: number[], day: number) =>
  days.includes(day) ? days.filter(item => item !== day) : [...days, day];

/**
 * The weekly plan: which workouts repeat on which weekdays. Runs keep their
 * days in the plan, strength templates on the template itself, so "Pull on
 * Monday" is one fact wherever it shows. Single days change in Plan.
 */
export function PlanSettings({
  schedule,
  templates,
  showRunning,
  showStrength,
  disabled,
  onSaveSchedule,
  onSaveTemplates,
  onOpenTemplates,
}: {
  schedule: ScheduleState;
  templates: WorkoutTemplate[];
  showRunning: boolean;
  showStrength: boolean;
  disabled: boolean;
  onSaveSchedule: (next: ScheduleState) => void;
  onSaveTemplates: (next: WorkoutTemplate[]) => void;
  /** Opens template management; without it, there is no way to create one. */
  onOpenTemplates?: () => void;
}) {
  const [iconFor, setIconFor] = useState<string | null>(null);
  const choosing = templates.find(template => template.id === iconFor);
  const updateTemplate = (
    id: string,
    patch: Partial<Pick<WorkoutTemplate, 'days' | 'icon'>>,
  ) =>
    onSaveTemplates(
      templates.map(template =>
        template.id === id ? { ...template, ...patch } : template,
      ),
    );
  return (
    <>
      <Title>{tr('Wochenplan', 'Weekly plan')}</Title>
      <Copy muted>
        {tr(
          'Gilt jede Woche. Einzelne Tage änderst du im Plan.',
          'Applies every week. Change single days in Plan.',
        )}
      </Copy>
      {showRunning ? (
        <Section title={tr('Laufen', 'Running')}>
          <View style={styles.item}>
            <View style={styles.itemHead}>
              <WorkoutIcon name="run" />
              <Text style={styles.itemTitle}>{tr('Lauf', 'Run')}</Text>
            </View>
            <WeekdayChips
              label={tr('Wochentage für Läufe', 'Weekdays for runs')}
              labels={dayLabels()}
              values={schedule.runDays}
              onToggle={day =>
                onSaveSchedule(
                  setRunDays(schedule, toggled(schedule.runDays, day)),
                )
              }
              disabled={disabled}
            />
          </View>
        </Section>
      ) : null}
      {showStrength ? (
        <Section title={tr('Krafttraining', 'Strength training')}>
          {templates.map(template => {
            const days = template.days.map(mondayDay);
            return (
              <View key={template.id} style={styles.item}>
                <View style={styles.itemHead}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={tr(
                      `Symbol für ${template.name} wählen`,
                      `Choose symbol for ${template.name}`,
                    )}
                    disabled={disabled}
                    onPress={() => setIconFor(template.id)}
                    style={({ pressed }) => [
                      styles.iconButton,
                      pressed && styles.pressed,
                    ]}
                  >
                    <WorkoutIcon name={templateIcon(template)} selected />
                  </Pressable>
                  <Text numberOfLines={1} style={styles.itemTitle}>
                    {template.name}
                  </Text>
                </View>
                <WeekdayChips
                  label={tr(
                    `Wochentage für ${template.name}`,
                    `Weekdays for ${template.name}`,
                  )}
                  labels={dayLabels()}
                  values={days}
                  onToggle={day =>
                    updateTemplate(template.id, {
                      // Templates count weekdays from Sunday, as `Date.getDay`.
                      days: toggled(days, day)
                        .map(monday => (monday + 1) % 7)
                        .sort((a, b) => a - b),
                    })
                  }
                  disabled={disabled}
                />
              </View>
            );
          })}
          {!templates.length ? (
            <Copy muted>
              {tr(
                'Lege eine Kraftvorlage an, dann planst du sie hier für feste Tage.',
                'Create a strength template to plan it for fixed days here.',
              )}
            </Copy>
          ) : null}
          {onOpenTemplates ? (
            <Row
              title={tr('Vorlagen', 'Templates')}
              subtitle={tr(
                'Kraftvorlagen anlegen und bearbeiten',
                'Create and edit strength templates',
              )}
              onPress={onOpenTemplates}
            />
          ) : null}
        </Section>
      ) : null}
      <Sheet
        visible={Boolean(choosing)}
        title={
          choosing
            ? tr(`Symbol für ${choosing.name}`, `Symbol for ${choosing.name}`)
            : ''
        }
        onClose={() => setIconFor(null)}
      >
        {choosing ? (
          <IconPicker
            value={templateIcon(choosing)}
            disabled={disabled}
            onChange={icon => updateTemplate(choosing.id, { icon })}
          />
        ) : null}
        <Button title={tr('Fertig', 'Done')} onPress={() => setIconFor(null)} />
      </Sheet>
    </>
  );
}

const styles = StyleSheet.create({
  item: { gap: space.xs, paddingVertical: space.xs },
  itemHead: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  itemTitle: { flex: 1, color: color.text, ...typography.body },
  iconButton: {
    width: 48,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: { opacity: 0.72 },
});
