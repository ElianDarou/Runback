import React, { useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import {
  SORENESS_PROMPTS,
  normalizeFeatures,
  sorenessPromptLabel,
  withArea,
  type FeatureSettings,
} from '../domain/features';
import { nativeCall, type Settings } from '../native';
import { Button, Copy, Section, color } from './components';
import { getLanguage, tr } from '../domain/i18n';

const STEPS = ['welcome', 'goal', 'features', 'import', 'ready'] as const;
type Step = (typeof STEPS)[number];

// Built per call: the language can change at runtime. Index 0 is Monday.
const dayLabels = () =>
  getLanguage() === 'en'
    ? ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
    : ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];

export interface OnboardingProps {
  settings: Settings;
  persist: (patch: Partial<Settings>) => Promise<void>;
  onDone: () => void;
  onImport: () => void;
  onCancelImport?: () => void;
  importStatus: any;
  busy: boolean;
}

function parseMinutes(value: string): number | undefined {
  const minutes = Number(value);
  return Number.isInteger(minutes) && minutes >= 5 && minutes <= 600
    ? minutes
    : undefined;
}

export function Onboarding({
  settings,
  persist,
  onDone,
  onImport,
  onCancelImport,
  importStatus,
  busy,
}: OnboardingProps) {
  const initial = STEPS.includes(settings.onboardingStep as Step)
    ? (settings.onboardingStep as Step)
    : 'welcome';
  const [step, setStep] = useState<Step>(initial);
  const [goal, setGoal] = useState(settings.goal || '');
  const [minutes, setMinutes] = useState(String(settings.minutes || 30));
  const [days, setDays] = useState<number[]>(settings.trainingDays || []);
  // What the user wants to use. Skipping means: everything is on.
  const [features, setFeatures] = useState<FeatureSettings>(() =>
    normalizeFeatures(settings.features, {
      showHeartRate: settings.showHeartRate,
    }),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [permissionBusy, setPermissionBusy] = useState(false);
  const [permissionStatus, setPermissionStatus] = useState('');
  const patch = (): Partial<Settings> => {
    const value = parseMinutes(minutes);
    return {
      goal: goal.trim() || undefined,
      ...(value === undefined ? {} : { minutes: value }),
      trainingDays: [...days].sort(),
      features,
    };
  };
  const saveAnd = async (next: Step) => {
    setSaving(true);
    setError('');
    try {
      await persist({ ...patch(), onboardingStep: next });
      setStep(next);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : tr('Speichern fehlgeschlagen.', 'Saving failed.'),
      );
    } finally {
      setSaving(false);
    }
  };
  const skip = async () => {
    setSaving(true);
    setError('');
    try {
      await persist({
        onboardedAt: Date.now(),
        onboardingStep: 'welcome',
        onboardingSkipped: true,
      });
      onDone();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : tr('Speichern fehlgeschlagen.', 'Saving failed.'),
      );
    } finally {
      setSaving(false);
    }
  };
  const finish = async () => {
    setSaving(true);
    setError('');
    try {
      await persist({
        ...patch(),
        onboardingStep: 'welcome',
        onboardedAt: Date.now(),
        onboardingSkipped: false,
      });
      onDone();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : tr('Speichern fehlgeschlagen.', 'Saving failed.'),
      );
    } finally {
      setSaving(false);
    }
  };
  const index = STEPS.indexOf(step);
  const next = () => saveAnd(STEPS[Math.min(index + 1, STEPS.length - 1)]);
  const validMinutes = parseMinutes(minutes) !== undefined;
  const status = importStatus || {};
  const importRunning = status.state === 'running';
  const canLeave = !saving && !busy && !importRunning;
  const requestPermissions = async () => {
    setPermissionBusy(true);
    setPermissionStatus('');
    setError('');
    try {
      const result = await nativeCall<any>('requestRecordingPermissions');
      setPermissionStatus(
        result?.locationPermission && result?.notificationPermission
          ? tr(
              'Standort und Mitteilungen sind freigegeben.',
              'Location and notifications are allowed.',
            )
          : tr(
              'Mindestens eine Berechtigung ist noch nicht freigegeben. Die Aufzeichnung fragt beim Start erneut.',
              'At least one permission is not allowed yet. Recording asks again when you start.',
            ),
      );
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : tr(
              'Berechtigungen konnten nicht angefragt werden.',
              'Permissions could not be requested.',
            ),
      );
    } finally {
      setPermissionBusy(false);
    }
  };
  return (
    <ScrollView
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
    >
      <View style={styles.header}>
        <Text style={styles.progress}>
          {tr('Einrichtung', 'Setup')} · {index + 1}/{STEPS.length}
        </Text>
        <Pressable
          accessibilityRole="button"
          onPress={skip}
          disabled={!canLeave}
        >
          <Text style={styles.link}>{tr('Später', 'Later')}</Text>
        </Pressable>
      </View>
      <View style={styles.progressLine}>
        {STEPS.map(item => (
          <View
            key={item}
            style={[
              styles.progressDot,
              item === step && styles.progressDotActive,
            ]}
          />
        ))}
      </View>
      {step === 'welcome' ? (
        <>
          <Text style={styles.title}>
            {tr('Willkommen bei Runback', 'Welcome to Runback')}
          </Text>
          <Copy muted>
            {tr(
              'Vier kurze Schritte, alle optional. Deine Daten bleiben auf diesem Gerät.',
              'Four short steps, all optional. Your data stays on this device.',
            )}
          </Copy>
          <Button
            title={tr('Einrichten', 'Set up')}
            onPress={next}
            disabled={saving || busy}
          />
        </>
      ) : null}
      {step === 'goal' ? (
        <>
          <Text style={styles.title}>
            {tr('Dein nächster Lauf', 'Your next run')}
          </Text>
          <Section title={tr('Ziel (optional)', 'Goal (optional)')}>
            <TextInput
              accessibilityLabel={tr('Laufziel', 'Running goal')}
              value={goal}
              onChangeText={setGoal}
              placeholder={tr(
                'Zum Beispiel: Halbmarathon im April',
                'For example: half marathon in April',
              )}
              placeholderTextColor={color.muted}
              style={styles.input}
            />
          </Section>
          <Section
            title={tr('Zeitbudget in Minuten', 'Time budget in minutes')}
          >
            <TextInput
              accessibilityLabel={tr(
                'Zeitbudget in Minuten',
                'Time budget in minutes',
              )}
              value={minutes}
              onChangeText={setMinutes}
              keyboardType="number-pad"
              style={styles.input}
            />
            {!validMinutes ? (
              <Copy muted>
                {tr(
                  'Bitte zwischen 5 und 600 Minuten eingeben.',
                  'Enter between 5 and 600 minutes.',
                )}
              </Copy>
            ) : null}
          </Section>
          <Section title={tr('Mögliche Lauftage', 'Possible running days')}>
            <View style={styles.days}>
              {dayLabels().map((label, day) => (
                <Pressable
                  key={label}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: days.includes(day) }}
                  onPress={() =>
                    setDays(current =>
                      current.includes(day)
                        ? current.filter(item => item !== day)
                        : [...current, day],
                    )
                  }
                  style={[styles.day, days.includes(day) && styles.dayActive]}
                >
                  <Text
                    style={[
                      styles.dayText,
                      days.includes(day) && styles.dayTextActive,
                    ]}
                  >
                    {label}
                  </Text>
                </Pressable>
              ))}
            </View>
          </Section>
          <Button
            title={tr('Weiter', 'Next')}
            onPress={next}
            disabled={saving || busy || !validMinutes}
          />
        </>
      ) : null}
      {step === 'features' ? (
        <>
          <Text style={styles.title}>
            {tr('Was möchtest du nutzen?', 'What do you want to use?')}
          </Text>
          <Copy muted>
            {tr(
              'Abgewähltes verschwindet. Ändern kannst du das jederzeit in den Einstellungen.',
              'Anything you deselect disappears. You can change this anytime in Settings.',
            )}
          </Copy>
          <Section title={tr('Bereiche', 'Areas')}>
            {(
              [
                { key: 'running', label: tr('Laufen', 'Running') },
                {
                  key: 'strength',
                  label: tr('Krafttraining', 'Strength training'),
                },
              ] as const
            ).map(option => {
              const checked = features.areas[option.key];
              return (
                <Pressable
                  key={option.key}
                  accessibilityRole="checkbox"
                  accessibilityLabel={option.label}
                  accessibilityState={{ checked }}
                  onPress={() =>
                    setFeatures(current =>
                      withArea(current, option.key, !checked),
                    )
                  }
                  style={styles.choice}
                >
                  <Text style={styles.choiceText}>{option.label}</Text>
                  <Text style={styles.check}>{checked ? '✓' : ''}</Text>
                </Pressable>
              );
            })}
            <Pressable
              accessibilityRole="checkbox"
              accessibilityLabel={tr('Radfahren', 'Cycling')}
              accessibilityState={{ checked: features.sports.cycling }}
              onPress={() =>
                setFeatures(current => ({
                  ...current,
                  sports: { cycling: !current.sports.cycling },
                }))
              }
              style={styles.choice}
            >
              <Text style={styles.choiceText}>
                {tr('Radfahren', 'Cycling')}
              </Text>
              <Text style={styles.check}>
                {features.sports.cycling ? '✓' : ''}
              </Text>
            </Pressable>
          </Section>
          <Section title={tr('Muskelkater', 'Soreness')}>
            <Pressable
              accessibilityRole="checkbox"
              accessibilityLabel={tr('Muskelkater melden', 'Report soreness')}
              accessibilityState={{ checked: features.soreness.enabled }}
              onPress={() =>
                setFeatures(current => ({
                  ...current,
                  soreness: {
                    ...current.soreness,
                    enabled: !current.soreness.enabled,
                  },
                }))
              }
              style={styles.choice}
            >
              <Text style={styles.choiceText}>
                {tr('Muskelkater melden', 'Report soreness')}
              </Text>
              <Text style={styles.check}>
                {features.soreness.enabled ? '✓' : ''}
              </Text>
            </Pressable>
            {features.soreness.enabled ? (
              <>
                <Copy muted>
                  {tr('Wann Runback fragt', 'When Runback asks')}
                </Copy>
                {SORENESS_PROMPTS.map(prompt => (
                  <Pressable
                    key={prompt}
                    accessibilityRole="radio"
                    accessibilityLabel={sorenessPromptLabel(prompt)}
                    accessibilityState={{
                      checked: features.soreness.prompt === prompt,
                    }}
                    onPress={() =>
                      setFeatures(current => ({
                        ...current,
                        soreness: { ...current.soreness, prompt },
                      }))
                    }
                    style={styles.choice}
                  >
                    <Text style={styles.choiceText}>
                      {sorenessPromptLabel(prompt)}
                    </Text>
                    <Text style={styles.check}>
                      {features.soreness.prompt === prompt ? '✓' : ''}
                    </Text>
                  </Pressable>
                ))}
              </>
            ) : null}
          </Section>
          <Button
            title={tr('Weiter', 'Next')}
            onPress={next}
            disabled={saving || busy}
          />
        </>
      ) : null}
      {step === 'import' ? (
        <>
          <Text style={styles.title}>
            {tr('Historie mitnehmen?', 'Bring over your history?')}
          </Text>
          <Copy muted>
            {tr(
              'FIT, GPX, TCX oder ein Export aus Strava, Garmin und anderen Apps. Doppelte Aktivitäten werden erkannt.',
              'FIT, GPX, TCX, or an export from Strava, Garmin, and other apps. Duplicate activities are detected.',
            )}
          </Copy>
          <Button
            title={
              importRunning
                ? tr('Import läuft …', 'Import running …')
                : tr('Dateien importieren', 'Import files')
            }
            onPress={onImport}
            disabled={busy || importRunning}
          />
          {importRunning && onCancelImport ? (
            <Button
              secondary
              title={tr('Import abbrechen', 'Cancel import')}
              onPress={onCancelImport}
            />
          ) : null}
          {status.imported !== undefined && status.state !== 'review' ? (
            <Copy>
              {[
                tr(
                  `Importiert: ${status.imported}`,
                  `Imported: ${status.imported}`,
                ),
                status.duplicates
                  ? tr(
                      `Doppelt: ${status.duplicates}`,
                      `Duplicates: ${status.duplicates}`,
                    )
                  : '',
                status.skipped
                  ? tr(
                      `Übersprungen: ${status.skipped}`,
                      `Skipped: ${status.skipped}`,
                    )
                  : '',
              ]
                .filter(Boolean)
                .join(' · ')}
            </Copy>
          ) : null}
          <Button
            secondary
            title={tr('Weiter', 'Next')}
            onPress={next}
            disabled={saving || busy || importRunning}
          />
        </>
      ) : null}
      {step === 'ready' ? (
        <>
          <Text style={styles.title}>
            {tr('Bereit für den ersten Lauf', 'Ready for your first run')}
          </Text>
          <Copy muted>
            {tr(
              'Die Einrichtung findest du jederzeit in den Einstellungen.',
              'You can find setup anytime in Settings.',
            )}
          </Copy>
          <Button
            secondary
            title={tr(
              'Aufzeichnungsberechtigungen anfragen',
              'Request recording permissions',
            )}
            onPress={requestPermissions}
            disabled={saving || busy || permissionBusy}
          />
          {permissionStatus ? <Copy muted>{permissionStatus}</Copy> : null}
          <Button
            title={tr('Los geht’s', 'Let’s go')}
            onPress={finish}
            disabled={saving || busy || permissionBusy}
          />
        </>
      ) : null}
      {error ? (
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      ) : null}
      {step !== 'welcome' && step !== 'ready' ? (
        <Pressable
          onPress={() => saveAnd(STEPS[Math.max(index - 1, 0)])}
          disabled={!canLeave}
        >
          <Text style={styles.back}>{tr('Zurück', 'Back')}</Text>
        </Pressable>
      ) : null}
    </ScrollView>
  );
}

export { Onboarding as OnboardingFlow };

const styles = StyleSheet.create({
  content: { padding: 20, paddingBottom: 40, gap: 16 },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  progress: { color: color.muted, fontSize: 13 },
  link: { color: color.green, fontSize: 15, fontWeight: '600' },
  progressLine: { flexDirection: 'row', gap: 6 },
  progressDot: {
    flex: 1,
    height: 4,
    backgroundColor: color.line,
    borderRadius: 2,
  },
  progressDotActive: { backgroundColor: color.green },
  title: { color: color.text, fontSize: 28, fontWeight: '700' },
  input: {
    minHeight: 52,
    borderWidth: 1,
    borderColor: color.line,
    borderRadius: 8,
    padding: 14,
    color: color.text,
    backgroundColor: color.surface,
    fontSize: 16,
  },
  days: { flexDirection: 'row', gap: 6 },
  day: {
    flex: 1,
    borderWidth: 1,
    borderColor: color.line,
    borderRadius: 8,
    paddingVertical: 11,
    alignItems: 'center',
  },
  dayActive: { backgroundColor: color.green, borderColor: color.green },
  dayText: { color: color.text },
  dayTextActive: { color: color.ink, fontWeight: '700' },
  choice: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: 1,
    borderBottomColor: color.line,
  },
  choiceText: { color: color.text, fontSize: 16 },
  check: { color: color.green, fontSize: 20 },
  back: { color: color.muted, textAlign: 'center', paddingVertical: 8 },
  error: { color: color.text, fontSize: 14, lineHeight: 20 },
});
