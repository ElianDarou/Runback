import React, { useEffect, useState } from 'react';
import { View } from 'react-native';
import {
  DEFAULT_GOAL_METERS,
  DEFAULT_GOAL_SECONDS,
  DEFAULT_INTERVALS,
  INTERVAL_LIMITS,
  RUN_TARGET_VERSION,
  formatClock,
  formatTargetPace,
  normalizeRunTarget,
  paceForFinishTime,
  parseDurationInput,
  parseGoalKilometers,
  parseGoalMinutes,
  parsePaceInput,
  type IntervalPlan,
  type RunGoal,
  type RunGoalKind,
  type RunTarget,
  type RunTargetKind,
  type RunTargetMemory,
  type RunTargetOutput,
  runTargetLabel,
  withGoalKind,
  withGuideKind,
} from '../domain/runTarget';
import {
  NO_RUN_ANNOUNCEMENTS,
  type RunAnnouncementSettings,
} from '../domain/runAnnouncements';
import { nativeCall } from '../native';
import { fixed, tr } from '../domain/i18n';
import {
  Button,
  CheckRow,
  ChipGroup,
  Copy,
  Field,
  Input,
  Notice,
  Row,
  Section,
  SwitchRow,
  Title,
} from './components';

function hasConnectedHeartRateSensor(status: unknown): boolean {
  if (!status || typeof status !== 'object') return false;
  const devices = (status as { devices?: unknown }).devices;
  if (!Array.isArray(devices)) return false;
  return devices.some(device => {
    if (!device || typeof device !== 'object') return false;
    const value = device as { connected?: unknown; services?: unknown };
    return (
      value.connected === true &&
      Array.isArray(value.services) &&
      value.services.some(service =>
        String(service).toLowerCase().includes('0000180d'),
      )
    );
  });
}

/** Whether a Bluetooth heart rate sensor is connected; heart rate targets need one. */
export function useHeartRateSensor(): {
  available: boolean;
  checking: boolean;
} {
  const [available, setAvailable] = useState(false);
  const [checking, setChecking] = useState(true);
  useEffect(() => {
    let mounted = true;
    nativeCall('bleStatus')
      .then(status => {
        if (mounted) setAvailable(hasConnectedHeartRateSensor(status));
      })
      .catch(() => {})
      .finally(() => {
        if (mounted) setChecking(false);
      });
    return () => {
      mounted = false;
    };
  }, []);
  return { available, checking };
}

/** Options shared by the start sheet and this screen. */
export const goalKindOptions = (): { value: RunGoalKind; label: string }[] => [
  { value: 'open', label: tr('Offen', 'Open') },
  { value: 'distance', label: tr('Strecke', 'Distance') },
  { value: 'time', label: tr('Zeit', 'Time') },
];

export const guideKindOptions = (
  heartRateAvailable: boolean,
): { value: RunTargetKind; label: string; disabled?: boolean }[] => [
  { value: 'none', label: tr('Nur tracken', 'Just track') },
  { value: 'pace', label: tr('Tempo', 'Pace') },
  {
    value: 'heart_rate',
    label: tr('Puls', 'Heart rate'),
    disabled: !heartRateAvailable,
  },
  { value: 'intervals', label: tr('Intervalle', 'Intervals') },
];

const kmText = (meters: number) => {
  const km = meters / 1000;
  return Number.isInteger(km) ? String(km) : fixed(km, 2).replace(/0$/, '');
};

const finishFor = (pace: string, km: string) => {
  const meters = parseGoalKilometers(km);
  const seconds = parsePaceInput(pace);
  return meters && seconds ? formatClock((meters / 1000) * seconds) : '';
};

export function RunTargetScreen({
  value,
  onSave,
  settings = false,
  announcements: storedAnnouncements,
}: {
  value: RunTarget;
  /** `announcements` only comes along from settings. */
  onSave: (
    target: RunTarget,
    announcements?: RunAnnouncementSettings,
  ) => Promise<void>;
  /** From settings ("Voice & vibration"): only the cues, not the goal itself. */
  settings?: boolean;
  /** Progress announcements, set up only from settings; not part of the goal. */
  announcements?: RunAnnouncementSettings;
}) {
  const normalized = normalizeRunTarget(value);
  const plan: IntervalPlan =
    normalized.kind === 'intervals' ? normalized.intervals : DEFAULT_INTERVALS;
  const [goalKind, setGoalKind] = useState<RunGoalKind>(
    normalized.goal?.kind ?? 'open',
  );
  const [kmInput, setKmInput] = useState(
    kmText(
      normalized.goal?.kind === 'distance'
        ? normalized.goal.meters
        : DEFAULT_GOAL_METERS,
    ),
  );
  const [minutesInput, setMinutesInput] = useState(
    String(
      (normalized.goal?.kind === 'time'
        ? normalized.goal.seconds
        : DEFAULT_GOAL_SECONDS) / 60,
    ),
  );
  const [kind, setKind] = useState<RunTargetKind>(normalized.kind);
  const [paceInput, setPaceInput] = useState(
    normalized.kind === 'pace'
      ? formatTargetPace(normalized.secondsPerKm).replace(' /km', '')
      : '5:30',
  );
  const [paceMode, setPaceMode] = useState<'range' | 'ceiling'>(
    normalized.kind === 'pace' ? normalized.mode : 'range',
  );
  const [finishInput, setFinishInput] = useState(() =>
    finishFor(paceInput, kmInput),
  );
  const [paceEntry, setPaceEntry] = useState<'pace' | 'finish'>('pace');
  const [minInput, setMinInput] = useState(
    normalized.kind === 'heart_rate' ? String(normalized.minBpm) : '130',
  );
  const [maxInput, setMaxInput] = useState(
    normalized.kind === 'heart_rate' ? String(normalized.maxBpm) : '150',
  );
  const [repeatsInput, setRepeatsInput] = useState(String(plan.repeats));
  const [workKind, setWorkKind] = useState<'distance' | 'time'>(plan.work.kind);
  const [workMetersInput, setWorkMetersInput] = useState(
    String(plan.work.kind === 'distance' ? plan.work.meters : 400),
  );
  const [workTimeInput, setWorkTimeInput] = useState(
    formatClock(plan.work.kind === 'time' ? plan.work.seconds : 120),
  );
  const [restInput, setRestInput] = useState(formatClock(plan.restSeconds));
  const [warmupInput, setWarmupInput] = useState(
    String(Math.round(plan.warmupSeconds / 60)),
  );
  const [output, setOutput] = useState<RunTargetOutput>(
    normalized.output ?? 'both',
  );
  const [goalCues, setGoalCues] = useState(normalized.goalCues !== false);
  const [intervalInput, setIntervalInput] = useState(
    String(normalized.cueIntervalSeconds ?? 30),
  );
  const [announcementsOn, setAnnouncementsOn] = useState(
    storedAnnouncements?.on ?? false,
  );
  const [announcements, setAnnouncements] = useState(
    storedAnnouncements?.setup ?? NO_RUN_ANNOUNCEMENTS,
  );
  const [announcementInterval, setAnnouncementInterval] = useState(
    String(announcements.interval).replace('.', tr(',', '.')),
  );
  const sensor = useHeartRateSensor();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const goalMeters =
    goalKind === 'distance' && kind !== 'intervals'
      ? parseGoalKilometers(kmInput)
      : null;
  const fail = (de: string, en: string) => {
    setError(tr(de, en));
    return null;
  };

  /** The goal as typed, `undefined` for open, `null` if the entry is invalid. */
  const readGoal = (): RunGoal | undefined | null => {
    if (kind === 'intervals' || goalKind === 'open') return undefined;
    if (goalKind === 'distance') {
      const meters = parseGoalKilometers(kmInput);
      return meters
        ? { kind: 'distance', meters }
        : fail(
            'Gib die Strecke zwischen 0,1 und 100 km ein.',
            'Enter a distance between 0.1 and 100 km.',
          );
    }
    const seconds = parseGoalMinutes(minutesInput);
    return seconds
      ? { kind: 'time', seconds }
      : fail(
          'Gib die Zeit in ganzen Minuten ein, 1 bis 600.',
          'Enter the time in whole minutes, 1 to 600.',
        );
  };

  const readIntervals = (): IntervalPlan | null => {
    const limits = INTERVAL_LIMITS;
    const repeats = Number(repeatsInput);
    if (
      !Number.isInteger(repeats) ||
      repeats < limits.repeats.min ||
      repeats > limits.repeats.max
    )
      return fail('Wähle 1 bis 50 Wiederholungen.', 'Choose 1 to 50 repeats.');
    let work: IntervalPlan['work'];
    if (workKind === 'distance') {
      const meters = Number(workMetersInput);
      if (
        !Number.isInteger(meters) ||
        meters < limits.workMeters.min ||
        meters > limits.workMeters.max
      )
        return fail(
          'Gib die Belastung zwischen 100 und 10000 Metern ein.',
          'Enter the work stretch between 100 and 10000 meters.',
        );
      work = { kind: 'distance', meters };
    } else {
      const seconds = parseDurationInput(workTimeInput);
      if (
        seconds === null ||
        seconds < limits.workSeconds.min ||
        seconds > limits.workSeconds.max
      )
        return fail(
          'Gib die Belastung als Minuten und Sekunden ein, zum Beispiel 2:00.',
          'Enter the work stretch as minutes and seconds, for example 2:00.',
        );
      work = { kind: 'time', seconds };
    }
    const rest = /^0(?::00){0,2}$/.test(restInput.trim())
      ? 0
      : parseDurationInput(restInput);
    if (rest === null || rest > limits.restSeconds.max)
      return fail(
        'Gib die Pause als Minuten und Sekunden ein, höchstens 10:00.',
        'Enter the rest as minutes and seconds, at most 10:00.',
      );
    const warmup = Number(warmupInput || '0');
    if (!Number.isInteger(warmup) || warmup < 0 || warmup > 60)
      return fail(
        'Gib das Einlaufen in ganzen Minuten ein, 0 bis 60.',
        'Enter the warm-up in whole minutes, 0 to 60.',
      );
    return { repeats, work, restSeconds: rest, warmupSeconds: warmup * 60 };
  };

  const save = async () => {
    setError('');
    const goal = settings ? normalized.goal : readGoal();
    if (goal === null) return;
    let next: Record<string, unknown>;
    if (settings) {
      next = { ...normalized };
    } else if (kind === 'pace') {
      const finishSeconds = parseDurationInput(finishInput);
      const fromFinish =
        paceEntry === 'finish' &&
        goal?.kind === 'distance' &&
        paceMode === 'range';
      const secondsPerKm = fromFinish
        ? finishSeconds === null
          ? null
          : paceForFinishTime(goal.meters, finishSeconds)
        : parsePaceInput(paceInput);
      if (secondsPerKm === null) {
        if (fromFinish)
          fail(
            'Gib eine Zielzeit passend zu einem Tempo zwischen 2:00 und 20:00 /km ein.',
            'Enter a finish time matching a pace between 2:00 and 20:00 /km.',
          );
        else
          fail(
            'Gib das Tempo als Minuten und Sekunden ein, zum Beispiel 5:30.',
            'Enter the pace as minutes and seconds, for example 5:30.',
          );
        return;
      }
      next = { kind, secondsPerKm, mode: paceMode };
    } else if (kind === 'heart_rate') {
      const minBpm = Number(minInput);
      const maxBpm = Number(maxInput);
      if (
        !Number.isInteger(minBpm) ||
        !Number.isInteger(maxBpm) ||
        minBpm < 40 ||
        maxBpm > 240 ||
        maxBpm - minBpm < 5
      ) {
        fail(
          'Gib einen Pulsbereich zwischen 40 und 240 bpm ein.',
          'Enter a heart rate range between 40 and 240 bpm.',
        );
        return;
      }
      if (!sensor.available) {
        fail(
          'Verbinde zuerst einen Bluetooth-Pulssensor.',
          'Connect a Bluetooth heart rate sensor first.',
        );
        return;
      }
      next = { kind, minBpm, maxBpm };
    } else if (kind === 'intervals') {
      const intervals = readIntervals();
      if (!intervals) return;
      next = { kind, intervals };
    } else {
      next = { kind: 'none' };
    }
    const cueIntervalSeconds = Number(intervalInput);
    const interval = Number(announcementInterval.replace(',', '.'));
    if (
      !Number.isInteger(cueIntervalSeconds) ||
      cueIntervalSeconds < 5 ||
      cueIntervalSeconds > 300
    ) {
      fail(
        'Wähle einen Hinweisabstand zwischen 5 und 300 Sekunden.',
        'Choose a cue interval between 5 and 300 seconds.',
      );
      return;
    }
    if (
      storedAnnouncements &&
      (!Number.isFinite(interval) ||
        interval < 1 ||
        interval > (announcements.trigger === 'distance' ? 10 : 60))
    ) {
      fail(
        'Wähle 1 bis 10 Kilometer oder 1 bis 60 Minuten.',
        'Choose 1 to 10 kilometers or 1 to 60 minutes.',
      );
      return;
    }
    const rest = { ...next };
    delete rest.goal;
    delete rest.goalCues;
    const target = normalizeRunTarget({
      ...rest,
      version: RUN_TARGET_VERSION,
      output,
      cueIntervalSeconds,
      // Kept as stored; the start takes announcements from their own setting.
      ...(normalized.announcements
        ? { announcements: normalized.announcements }
        : {}),
      ...(goal ? { goal } : {}),
      ...(goal && !goalCues ? { goalCues: false } : {}),
    });
    setBusy(true);
    try {
      await (storedAnnouncements
        ? onSave(target, {
            on: announcementsOn,
            setup: { ...announcements, interval },
          })
        : onSave(target));
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : tr(
              'Das Laufziel konnte nicht gespeichert werden.',
              'The run goal could not be saved.',
            ),
      );
    } finally {
      setBusy(false);
    }
  };

  const shownKind = settings ? normalized.kind : kind;
  const hasGoal = settings
    ? Boolean(normalized.goal)
    : kind !== 'intervals' && goalKind !== 'open';

  return (
    <>
      <Title>
        {settings
          ? tr('Stimme & Vibration', 'Voice & vibration')
          : tr('Laufziel', 'Run goal')}
      </Title>
      {settings ? null : (
        <>
          <Field label={tr('Wie weit', 'How far')}>
            <ChipGroup
              label={tr('Wie weit', 'How far')}
              options={goalKindOptions().map(option => ({
                ...option,
                disabled: kind === 'intervals' && option.value !== 'open',
              }))}
              value={kind === 'intervals' ? 'open' : goalKind}
              onChange={setGoalKind}
              disabled={busy}
            />
          </Field>
          {kind === 'intervals' ? (
            <Copy muted>
              {tr(
                'Intervalle legen den Umfang selbst fest.',
                'Intervals set their own volume.',
              )}
            </Copy>
          ) : goalKind === 'distance' ? (
            <Field
              label={tr('Strecke in Kilometern', 'Distance in kilometers')}
            >
              <Input
                label={tr(
                  'Zielstrecke in Kilometern',
                  'Goal distance in kilometers',
                )}
                value={kmInput}
                onChangeText={text => {
                  setKmInput(text);
                  setPaceEntry('pace');
                  setFinishInput(finishFor(paceInput, text));
                }}
                placeholder="5"
                keyboardType="decimal-pad"
                editable={!busy}
              />
            </Field>
          ) : goalKind === 'time' ? (
            <Field label={tr('Zeit in Minuten', 'Time in minutes')}>
              <Input
                label={tr('Zielzeit in Minuten', 'Goal time in minutes')}
                value={minutesInput}
                onChangeText={setMinutesInput}
                placeholder="30"
                keyboardType="number-pad"
                editable={!busy}
              />
            </Field>
          ) : null}
          <Field label={tr('Wonach', 'Run by')}>
            <ChipGroup
              label={tr('Wonach', 'Run by')}
              options={guideKindOptions(sensor.available)}
              value={kind}
              onChange={setKind}
              disabled={busy}
            />
          </Field>
          {!sensor.checking && !sensor.available ? (
            <Copy muted>
              {tr(
                'Puls wird nach dem Verbinden eines Bluetooth-Sensors wählbar.',
                'Heart rate becomes available after you connect a Bluetooth sensor.',
              )}
            </Copy>
          ) : null}
        </>
      )}
      {!settings && kind === 'pace' ? (
        <Section title={tr('Tempo', 'Pace')}>
          <ChipGroup
            label={tr('Art des Tempoziels', 'Kind of pace target')}
            options={[
              { value: 'range' as const, label: tr('Halten', 'Hold') },
              {
                value: 'ceiling' as const,
                label: tr('Nicht schneller als', 'Not faster than'),
              },
            ]}
            value={paceMode}
            onChange={setPaceMode}
            disabled={busy}
          />
          <Field
            label={tr('Minuten pro Kilometer', 'Minutes per kilometer')}
            hint={
              paceMode === 'ceiling'
                ? tr(
                    'Runback bremst nur, wenn du schneller wirst.',
                    'Runback only slows you down when you get faster.',
                  )
                : tr(
                    'Runback meldet, wenn du deutlich schneller oder langsamer wirst.',
                    'Runback speaks up when you get clearly faster or slower.',
                  )
            }
          >
            <Input
              label={tr(
                'Zieltempo in Minuten pro Kilometer',
                'Target pace in minutes per kilometer',
              )}
              value={paceInput}
              onChangeText={text => {
                setPaceInput(text);
                setPaceEntry('pace');
                setFinishInput(finishFor(text, kmInput));
              }}
              placeholder="5:30"
              keyboardType="numbers-and-punctuation"
              editable={!busy}
            />
          </Field>
          {goalMeters && paceMode === 'range' ? (
            <Field
              label={tr('Oder Zielzeit', 'Or finish time')}
              hint={tr(
                'Daraus wird das Tempo für die Strecke.',
                'This sets the pace for the distance.',
              )}
            >
              <Input
                label={tr(
                  'Zielzeit für die Strecke',
                  'Finish time for the distance',
                )}
                value={finishInput}
                onChangeText={text => {
                  setFinishInput(text);
                  setPaceEntry('finish');
                  const seconds = parseDurationInput(text);
                  const pace = seconds
                    ? paceForFinishTime(goalMeters, seconds)
                    : null;
                  if (pace)
                    setPaceInput(formatTargetPace(pace).replace(' /km', ''));
                }}
                placeholder="25:00"
                keyboardType="numbers-and-punctuation"
                editable={!busy}
              />
            </Field>
          ) : null}
        </Section>
      ) : null}
      {!settings && kind === 'heart_rate' ? (
        <Section title={tr('Pulsbereich', 'Heart rate range')}>
          <View>
            <Field label={tr('Untergrenze', 'Lower limit')}>
              <Input
                label={tr('Untere Pulsgrenze', 'Lower heart rate limit')}
                value={minInput}
                onChangeText={setMinInput}
                keyboardType="number-pad"
                editable={!busy}
              />
            </Field>
          </View>
          <Field label={tr('Obergrenze', 'Upper limit')}>
            <Input
              label={tr('Obere Pulsgrenze', 'Upper heart rate limit')}
              value={maxInput}
              onChangeText={setMaxInput}
              keyboardType="number-pad"
              editable={!busy}
            />
          </Field>
          <Copy muted>
            {tr(
              'Runback schätzt keine persönlichen Pulszonen.',
              'Runback does not estimate personal heart rate zones.',
            )}
          </Copy>
        </Section>
      ) : null}
      {!settings && kind === 'intervals' ? (
        <Section title={tr('Intervalle', 'Intervals')}>
          <Field label={tr('Wiederholungen', 'Repeats')}>
            <Input
              label={tr('Anzahl der Wiederholungen', 'Number of repeats')}
              value={repeatsInput}
              onChangeText={setRepeatsInput}
              keyboardType="number-pad"
              editable={!busy}
            />
          </Field>
          <Field label={tr('Belastung', 'Work')}>
            <ChipGroup
              label={tr('Belastung nach', 'Work by')}
              options={[
                {
                  value: 'distance' as const,
                  label: tr('Strecke', 'Distance'),
                },
                { value: 'time' as const, label: tr('Zeit', 'Time') },
              ]}
              value={workKind}
              onChange={setWorkKind}
              disabled={busy}
            />
            {workKind === 'distance' ? (
              <Input
                label={tr('Belastung in Metern', 'Work in meters')}
                value={workMetersInput}
                onChangeText={setWorkMetersInput}
                placeholder="400"
                keyboardType="number-pad"
                editable={!busy}
              />
            ) : (
              <Input
                label={tr(
                  'Belastung in Minuten und Sekunden',
                  'Work in minutes and seconds',
                )}
                value={workTimeInput}
                onChangeText={setWorkTimeInput}
                placeholder="2:00"
                keyboardType="numbers-and-punctuation"
                editable={!busy}
              />
            )}
          </Field>
          <Field label={tr('Pause', 'Rest')}>
            <Input
              label={tr(
                'Pause in Minuten und Sekunden',
                'Rest in minutes and seconds',
              )}
              value={restInput}
              onChangeText={setRestInput}
              placeholder="1:30"
              keyboardType="numbers-and-punctuation"
              editable={!busy}
            />
          </Field>
          <Field label={tr('Einlaufen in Minuten', 'Warm-up in minutes')}>
            <Input
              label={tr('Einlaufen in Minuten', 'Warm-up in minutes')}
              value={warmupInput}
              onChangeText={setWarmupInput}
              placeholder="0"
              keyboardType="number-pad"
              editable={!busy}
            />
          </Field>
          {workKind === 'distance' ? (
            <Copy muted>
              {tr(
                'Eine Strecke endet erst mit gemessener Distanz. Ohne GPS läuft sie weiter.',
                'A distance stretch only ends on measured distance. Without GPS it keeps going.',
              )}
            </Copy>
          ) : null}
        </Section>
      ) : null}
      {shownKind !== 'none' || hasGoal ? (
        <Section title={tr('Hinweise', 'Cues')}>
          <ChipGroup
            label={tr('Ausgabe der Hinweise', 'Cue output')}
            options={[
              {
                value: 'both',
                label: tr('Vibration & Stimme', 'Vibration & voice'),
              },
              { value: 'vibration', label: tr('Vibration', 'Vibration') },
              { value: 'voice', label: tr('Stimme', 'Voice') },
            ]}
            value={output}
            onChange={setOutput}
            disabled={busy}
          />
          {hasGoal ? (
            <CheckRow
              title={tr('Ansagen zum Ziel', 'Goal announcements')}
              subtitle={tr(
                'Hälfte, kurz vor dem Ziel, Ziel erreicht',
                'Halfway, almost there, goal reached',
              )}
              checked={goalCues}
              onToggle={setGoalCues}
              disabled={busy}
            />
          ) : null}
          {shownKind === 'pace' || shownKind === 'heart_rate' ? (
            <Field
              label={tr('Abstand in Sekunden', 'Interval in seconds')}
              hint={tr(
                'Beim Gehen und Stehen bleiben Tempohinweise stumm.',
                'Pace cues stay silent while you walk or stand.',
              )}
            >
              <Input
                label={tr(
                  'Hinweisabstand in Sekunden',
                  'Cue interval in seconds',
                )}
                value={intervalInput}
                onChangeText={setIntervalInput}
                keyboardType="number-pad"
                editable={!busy}
              />
            </Field>
          ) : null}
          <Copy muted>
            {tr(
              'Die Vibration kommt von dem Gerät, das aufzeichnet.',
              'The vibration comes from the device that records.',
            )}
          </Copy>
        </Section>
      ) : null}
      {storedAnnouncements ? (
        <Section title={tr('Zwischenansagen', 'Progress announcements')}>
          <SwitchRow
            title={tr('Zwischenstände ansagen', 'Announce progress')}
            value={announcementsOn}
            onChange={setAnnouncementsOn}
            disabled={busy}
          />
          <ChipGroup
            label={tr('Auslöser für Durchsagen', 'Trigger for announcements')}
            options={[
              { value: 'distance', label: tr('Kilometer', 'Kilometers') },
              { value: 'time', label: tr('Minuten', 'Minutes') },
            ]}
            value={announcements.trigger}
            onChange={trigger => {
              setAnnouncements({ ...announcements, trigger });
              setAnnouncementInterval(trigger === 'time' ? '10' : '1');
            }}
            disabled={busy}
          />
          <Field
            label={
              announcements.trigger === 'time'
                ? tr('Abstand in Minuten', 'Interval in minutes')
                : tr('Abstand in Kilometern', 'Interval in kilometers')
            }
          >
            <Input
              label={tr('Abstand der Durchsagen', 'Announcement interval')}
              value={announcementInterval}
              onChangeText={setAnnouncementInterval}
              keyboardType="decimal-pad"
              editable={!busy}
            />
          </Field>
          {(
            [
              ['kilometer', tr('Kilometermarke', 'Kilometer mark')],
              ['distance', tr('Zurückgelegte Strecke', 'Distance covered')],
              [
                'lastKilometerPace',
                tr(
                  'Tempo des letzten Kilometers',
                  'Pace of the last kilometer',
                ),
              ],
              ['averagePace', tr('Durchschnittstempo', 'Average pace')],
              ['heartRate', tr('Aktueller Puls', 'Current heart rate')],
            ] as [
              (
                | 'kilometer'
                | 'distance'
                | 'lastKilometerPace'
                | 'averagePace'
                | 'heartRate'
              ),
              string,
            ][]
          ).map(([key, label]) => (
            <Field key={key} label={label}>
              <ChipGroup
                label={label}
                options={[
                  { value: 'on', label: tr('An', 'On') },
                  { value: 'off', label: tr('Aus', 'Off') },
                ]}
                value={announcements[key] === true ? 'on' : 'off'}
                disabled={busy}
                onChange={choice =>
                  setAnnouncements({
                    ...announcements,
                    [key]: choice === 'on',
                  })
                }
              />
            </Field>
          ))}
        </Section>
      ) : null}
      {error ? (
        <Notice title={tr('Prüfe deine Angabe', 'Check your entry')}>
          {error}
        </Notice>
      ) : null}
      <Button
        title={
          settings ? tr('Speichern', 'Save') : tr('Ziel übernehmen', 'Use goal')
        }
        onPress={save}
        disabled={busy || sensor.checking}
      />
    </>
  );
}

/**
 * The goal in the start sheet: two chip rows (how far, run by) and one row
 * with the values, which opens this screen to change them. The last choice is
 * preselected, so starting usually needs no tap here at all.
 */
export function RunGoalChips({
  target,
  memory,
  disabled,
  onChange,
  onEdit,
}: {
  target: RunTarget;
  memory: RunTargetMemory;
  disabled: boolean;
  onChange: (target: RunTarget) => void;
  onEdit: () => void;
}) {
  const sensor = useHeartRateSensor();
  const intervals = target.kind === 'intervals';
  return (
    <>
      <Field label={tr('Wie weit', 'How far')}>
        <ChipGroup
          label={tr('Wie weit', 'How far')}
          options={goalKindOptions().map(option => ({
            ...option,
            disabled: intervals && option.value !== 'open',
          }))}
          value={intervals ? 'open' : target.goal?.kind ?? 'open'}
          onChange={kind => onChange(withGoalKind(target, kind, memory))}
          disabled={disabled}
        />
      </Field>
      <Field label={tr('Wonach', 'Run by')}>
        <ChipGroup
          label={tr('Wonach', 'Run by')}
          options={guideKindOptions(sensor.available)}
          value={target.kind}
          onChange={kind => onChange(withGuideKind(target, kind, memory))}
          disabled={disabled}
        />
      </Field>
      <Row
        title={runTargetLabel(target)}
        subtitle={
          intervals
            ? tr(
                'Intervalle legen den Umfang selbst fest. Tippe, um Werte zu ändern.',
                'Intervals set their own volume. Tap to change values.',
              )
            : tr('Tippe, um Werte zu ändern', 'Tap to change values')
        }
        onPress={onEdit}
      />
    </>
  );
}
