import React, { useEffect, useState } from 'react';
import { nativeCall } from '../native';
import type { FeatureSettings } from '../domain/features';
import {
  runAnnouncementsLabel,
  type RunAnnouncementSettings,
} from '../domain/runAnnouncements';
import type { RunTargetOutput } from '../domain/runTarget';
import { tr } from '../domain/i18n';
import {
  Button,
  ChipGroup,
  Copy,
  Field,
  Notice,
  Row,
  Section,
  SwitchRow,
  Title,
} from './components';

/** What the native side reports; voices belong to the installed engine. */
interface SpeechSettings {
  available: boolean;
  voice: string | null;
  rate: number;
  voices: { name: string; country: string; network: boolean }[];
}

const RATES = [0.85, 1, 1.2] as const;
const SYSTEM_VOICE = 'system';

const rateOptions = () => [
  { value: '0.85', label: tr('Langsamer', 'Slower') },
  { value: '1', label: tr('Normal', 'Normal') },
  { value: '1.2', label: tr('Schneller', 'Faster') },
];

const outputLabel = (output: RunTargetOutput | undefined) =>
  output === 'voice'
    ? tr('Hinweise per Stimme', 'Cues by voice')
    : output === 'vibration'
    ? tr('Hinweise per Vibration', 'Cues by vibration')
    : tr('Hinweise per Vibration & Stimme', 'Cues by vibration & voice');

/**
 * Everything the app says or vibrates, in one place: the voice for all spoken
 * cues, the cues while running (their own page, also opened from the start
 * sheet), and the signals at the end of a rest. Voice choices apply right away.
 */
export function SoundSettings({
  features,
  showRunning,
  showStrength,
  announcements,
  output,
  disabled,
  onChangeFeatures,
  onOpenRunCues,
}: {
  features: FeatureSettings;
  showRunning: boolean;
  showStrength: boolean;
  announcements: RunAnnouncementSettings;
  output: RunTargetOutput | undefined;
  disabled: boolean;
  onChangeFeatures: (next: FeatureSettings) => void;
  onOpenRunCues: () => void;
}) {
  const [speech, setSpeech] = useState<SpeechSettings | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let mounted = true;
    nativeCall<SpeechSettings>('getSpeechSettings')
      .then(value => {
        // An older build answers without these fields: no voices, no choice.
        if (mounted)
          setSpeech({
            available: value?.available === true,
            voice: typeof value?.voice === 'string' ? value.voice : null,
            rate: typeof value?.rate === 'number' ? value.rate : 1,
            voices: Array.isArray(value?.voices) ? value.voices : [],
          });
      })
      .catch(() => {
        if (mounted) setLoadFailed(true);
      });
    return () => {
      mounted = false;
    };
  }, []);

  const saveSpeech = async (voice: string | null, rate: number) => {
    if (!speech) return;
    const previous = speech;
    setSpeech({ ...speech, voice, rate });
    setBusy(true);
    setError('');
    try {
      await nativeCall('setSpeechSettings', voice, rate);
    } catch (caught) {
      setSpeech(previous);
      setError(
        caught instanceof Error
          ? caught.message
          : tr(
              'Die Stimme konnte nicht gespeichert werden.',
              'The voice could not be saved.',
            ),
      );
    } finally {
      setBusy(false);
    }
  };

  const preview = async () => {
    setBusy(true);
    setError('');
    try {
      await nativeCall('previewSpeech');
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : tr('Probe nicht möglich.', 'Preview not possible.'),
      );
    } finally {
      setBusy(false);
    }
  };

  const strength = features.strength;
  const patchStrength = (value: Partial<FeatureSettings['strength']>) =>
    onChangeFeatures({ ...features, strength: { ...strength, ...value } });

  // Voices of one country first carry a number; the country only shows where
  // several are on offer, "needs internet" only where it is true.
  const countries = new Set(speech?.voices.map(voice => voice.country));
  const voiceOptions = speech
    ? [
        { value: SYSTEM_VOICE, label: tr('Systemstimme', 'System voice') },
        ...speech.voices.map((voice, index) => ({
          value: voice.name,
          label: [
            tr(`Stimme ${index + 1}`, `Voice ${index + 1}`),
            countries.size > 1 && voice.country ? voice.country : '',
            voice.network ? tr('online', 'online') : '',
          ]
            .filter(Boolean)
            .join(' · '),
        })),
      ]
    : [];
  const selectedVoice =
    speech?.voice && speech.voices.some(voice => voice.name === speech.voice)
      ? speech.voice
      : SYSTEM_VOICE;
  const rate = RATES.find(value => value === speech?.rate) ?? 1;

  return (
    <>
      <Title>{tr('Stimme & Vibration', 'Voice & vibration')}</Title>
      {error ? (
        <Notice title={tr('Nicht gespeichert', 'Not saved')}>{error}</Notice>
      ) : null}
      <Section title={tr('Stimme', 'Voice')}>
        {!speech && !loadFailed ? (
          <Copy muted>
            {tr('Stimmen werden geladen …', 'Loading voices …')}
          </Copy>
        ) : loadFailed || !speech?.available ? (
          <Notice>
            {tr(
              'Keine Sprachausgabe gefunden. Installiere eine in den Android-Einstellungen unter Sprachausgabe.',
              'No speech output found. Install one in the Android settings under text-to-speech.',
            )}
          </Notice>
        ) : (
          <>
            <Field label={tr('Stimme für Ansagen', 'Voice for announcements')}>
              <ChipGroup
                label={tr('Stimme für Ansagen', 'Voice for announcements')}
                options={voiceOptions}
                value={selectedVoice}
                onChange={value =>
                  void saveSpeech(value === SYSTEM_VOICE ? null : value, rate)
                }
                disabled={busy || disabled}
              />
            </Field>
            <Field label={tr('Sprechtempo', 'Speaking rate')}>
              <ChipGroup
                label={tr('Sprechtempo', 'Speaking rate')}
                options={rateOptions()}
                value={String(rate)}
                onChange={value => void saveSpeech(speech.voice, Number(value))}
                disabled={busy || disabled}
              />
            </Field>
            <Button
              secondary
              title={tr('Probe hören', 'Hear a sample')}
              onPress={() => void preview()}
              disabled={busy}
            />
          </>
        )}
      </Section>
      {showRunning ? (
        <Section title={tr('Laufen', 'Running')}>
          <Row
            title={tr('Ansagen beim Laufen', 'Running cues')}
            subtitle={[
              announcements.on
                ? runAnnouncementsLabel(announcements.setup)
                : tr('Zwischenansagen aus', 'Progress announcements off'),
              outputLabel(output),
            ].join(' · ')}
            onPress={onOpenRunCues}
          />
        </Section>
      ) : null}
      {showStrength ? (
        <Section title={tr('Krafttraining', 'Strength training')}>
          {strength.restTimer ? (
            <>
              <SwitchRow
                title={tr('Vibration am Pausenende', 'Vibration at rest end')}
                subtitle={tr(
                  'Kurz, kurz, lang — auf der Uhr, sonst am Handy',
                  'Short, short, long — on the watch, otherwise on the phone',
                )}
                value={strength.restVibration}
                onChange={restVibration => patchStrength({ restVibration })}
                disabled={disabled}
              />
              <SwitchRow
                title={tr('Ton am Pausenende', 'Sound at rest end')}
                subtitle={tr(
                  'Kurz, kurz, lang am Handy',
                  'Short, short, long on the phone',
                )}
                value={strength.restSound}
                onChange={restSound => patchStrength({ restSound })}
                disabled={disabled}
              />
              <SwitchRow
                title={tr('Ansage am Pausenende', 'Announcement at rest end')}
                subtitle={tr(
                  'Nennt Übung und Satz, am Handy',
                  'Names exercise and set, on the phone',
                )}
                value={strength.restVoice}
                onChange={restVoice => patchStrength({ restVoice })}
                disabled={disabled}
              />
            </>
          ) : (
            <Copy muted>
              {tr(
                'Schalte unter Funktionen den Pausentimer ein, dann gibt es hier Signale am Pausenende.',
                'Turn on the rest timer under Features to get signals at the end of a rest.',
              )}
            </Copy>
          )}
        </Section>
      ) : null}
    </>
  );
}
