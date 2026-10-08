import React, { useEffect, useState } from 'react';
import { View } from 'react-native';
import {
  NO_RUN_TARGET,
  RUN_TARGET_VERSION,
  formatTargetPace,
  normalizeRunTarget,
  parsePaceInput,
  type RunTarget,
  type RunTargetOutput,
} from '../domain/runTarget';
import { normalizeRunAnnouncements } from '../domain/runAnnouncements';
import type { RunPurpose } from '../domain/types';
import { nativeCall } from '../native';
import { tr } from '../domain/i18n';
import {
  Button,
  ChipGroup,
  Copy,
  Field,
  Input,
  Notice,
  Section,
  Title,
} from './components';

type TargetKind = RunTarget['kind'];

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

export function RunTargetScreen({
  value,
  purpose,
  onSave,
  settings = false,
}: {
  value: RunTarget;
  purpose: RunPurpose;
  onSave: (target: RunTarget) => Promise<void>;
  /** From settings ("Voice & vibration") instead of the start sheet. */
  settings?: boolean;
}) {
  const normalized = normalizeRunTarget(value);
  const [kind, setKind] = useState<TargetKind>(normalized.kind);
  const [paceInput, setPaceInput] = useState(
    normalized.kind === 'pace'
      ? formatTargetPace(normalized.secondsPerKm).replace(' /km', '')
      : '5:30',
  );
  const [minInput, setMinInput] = useState(
    normalized.kind === 'heart_rate' ? String(normalized.minBpm) : '130',
  );
  const [maxInput, setMaxInput] = useState(
    normalized.kind === 'heart_rate' ? String(normalized.maxBpm) : '150',
  );
  const [output, setOutput] = useState<RunTargetOutput>(
    normalized.kind === 'none' ? 'both' : normalized.output,
  );
  const [intervalInput, setIntervalInput] = useState(
    String(normalized.cueIntervalSeconds ?? 30),
  );
  const [announcements, setAnnouncements] = useState(
    normalizeRunAnnouncements(normalized.announcements),
  );
  const [announcementInterval, setAnnouncementInterval] = useState(
    String(announcements.interval),
  );
  const [heartRateAvailable, setHeartRateAvailable] = useState(false);
  const [checkingSensor, setCheckingSensor] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let mounted = true;
    nativeCall('bleStatus')
      .then(status => {
        if (mounted) setHeartRateAvailable(hasConnectedHeartRateSensor(status));
      })
      .catch(() => {})
      .finally(() => {
        if (mounted) setCheckingSensor(false);
      });
    return () => {
      mounted = false;
    };
  }, []);

  const save = async () => {
    setError('');
    let next: RunTarget = NO_RUN_TARGET;
    if (kind === 'pace') {
      const secondsPerKm = parsePaceInput(paceInput);
      if (secondsPerKm === null) {
        setError(
          tr(
            'Gib das Tempo als Minuten und Sekunden ein, zum Beispiel 5:30.',
            'Enter the pace as minutes and seconds, for example 5:30.',
          ),
        );
        return;
      }
      next = {
        kind: 'pace',
        version: RUN_TARGET_VERSION,
        secondsPerKm,
        mode: purpose === 'easy' || purpose === 'long' ? 'ceiling' : 'range',
        output,
      };
    }
    if (kind === 'heart_rate') {
      const minBpm = Number(minInput);
      const maxBpm = Number(maxInput);
      if (
        !Number.isInteger(minBpm) ||
        !Number.isInteger(maxBpm) ||
        minBpm < 40 ||
        maxBpm > 240 ||
        maxBpm - minBpm < 5
      ) {
        setError(
          tr(
            'Gib einen Pulsbereich zwischen 40 und 240 bpm ein.',
            'Enter a heart rate range between 40 and 240 bpm.',
          ),
        );
        return;
      }
      if (!heartRateAvailable) {
        setError(
          tr(
            'Verbinde zuerst einen Bluetooth-Pulssensor.',
            'Connect a Bluetooth heart rate sensor first.',
          ),
        );
        return;
      }
      next = {
        kind: 'heart_rate',
        version: RUN_TARGET_VERSION,
        minBpm,
        maxBpm,
        output,
      };
    }
    const cueIntervalSeconds = Number(intervalInput);
    const interval = Number(announcementInterval.replace(',', '.'));
    if (
      !Number.isInteger(cueIntervalSeconds) ||
      cueIntervalSeconds < 5 ||
      cueIntervalSeconds > 300
    ) {
      setError(
        tr(
          'Wähle einen Hinweisabstand zwischen 5 und 300 Sekunden.',
          'Choose a cue interval between 5 and 300 seconds.',
        ),
      );
      return;
    }
    if (
      announcements.trigger !== 'off' &&
      (!Number.isFinite(interval) ||
        interval < 1 ||
        interval > (announcements.trigger === 'distance' ? 10 : 60))
    ) {
      setError(
        tr(
          'Wähle 1 bis 10 Kilometer oder 1 bis 60 Minuten.',
          'Choose 1 to 10 kilometers or 1 to 60 minutes.',
        ),
      );
      return;
    }
    next = {
      ...next,
      cueIntervalSeconds,
      announcements: {
        ...announcements,
        interval: announcements.trigger === 'off' ? 1 : interval,
      },
    };
    setBusy(true);
    try {
      await onSave(next);
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

  const kindOptions = [
    { value: 'none' as const, label: tr('Ohne Ziel', 'No goal') },
    { value: 'pace' as const, label: tr('Tempo', 'Pace') },
    {
      value: 'heart_rate' as const,
      label: tr('Puls', 'Heart rate'),
      disabled: !heartRateAvailable,
    },
  ];

  return (
    <>
      <Title>
        {settings
          ? tr('Stimme & Vibration', 'Voice & vibration')
          : tr('Wie möchtest du laufen?', 'How do you want to run?')}
      </Title>
      <Field label={tr('Laufen nach', 'Run to')}>
        <ChipGroup
          label={tr('Laufziel', 'Run goal')}
          options={kindOptions}
          value={kind}
          onChange={setKind}
          disabled={busy}
        />
      </Field>
      {!checkingSensor && !heartRateAvailable ? (
        <Copy muted>
          {tr(
            'Puls wird nach dem Verbinden eines Bluetooth-Sensors wählbar.',
            'Heart rate becomes available after you connect a Bluetooth sensor.',
          )}
        </Copy>
      ) : null}
      {kind === 'pace' ? (
        <Section title={tr('Tempo', 'Pace')}>
          <Field
            label={tr('Minuten pro Kilometer', 'Minutes per kilometer')}
            hint={
              purpose === 'easy' || purpose === 'long'
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
              onChangeText={setPaceInput}
              placeholder="5:30"
              keyboardType="numbers-and-punctuation"
              editable={!busy}
            />
          </Field>
        </Section>
      ) : null}
      {kind === 'heart_rate' ? (
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
      {kind !== 'none' ? (
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
          <Copy muted>
            {tr(
              'Die Vibration kommt von dem Gerät, das aufzeichnet.',
              'The vibration comes from the device that records.',
            )}
          </Copy>
        </Section>
      ) : null}
      <Section title={tr('Zwischenstände ansagen', 'Announce progress')}>
        <ChipGroup
          label={tr('Auslöser für Durchsagen', 'Trigger for announcements')}
          options={[
            { value: 'off', label: tr('Aus', 'Off') },
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
        {announcements.trigger !== 'off' ? (
          <>
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
          </>
        ) : null}
      </Section>
      {error ? (
        <Notice title={tr('Prüfe deine Angabe', 'Check your entry')}>
          {error}
        </Notice>
      ) : null}
      <Button
        title={
          settings
            ? tr('Speichern', 'Save')
            : kind === 'none'
            ? tr('Ohne Ziel übernehmen', 'Use no goal')
            : tr('Ziel übernehmen', 'Use goal')
        }
        onPress={save}
        disabled={busy || checkingSensor}
      />
    </>
  );
}
