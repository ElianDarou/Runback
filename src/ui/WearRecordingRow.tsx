import React, { useEffect, useState } from 'react';
import { AppState as AndroidAppState, View } from 'react-native';
import { nativeCall } from '../native';
import { wearRecordingLink, type WearRecordingLink } from '../domain/wearLink';
import { tr } from '../domain/i18n';
import { Badge, Row } from './components';

// Built per render so the active language applies without a restart.
const wordsFor = (): Record<
  WearRecordingLink,
  { label: string; hint?: string; muted: boolean }
> => ({
  recording: { label: tr('Zeichnet mit', 'Recording with'), muted: false },
  waiting: {
    label: tr('Wartet', 'Waiting'),
    hint: tr('Öffne Runback auf der Uhr.', 'Open Runback on the watch.'),
    muted: true,
  },
  silent: {
    label: tr('Keine Daten', 'No data'),
    hint: tr(
      'Prüfe, ob die Uhr noch aufzeichnet.',
      'Check whether the watch is still recording.',
    ),
    muted: true,
  },
  failed: {
    label: tr('Nicht erreicht', 'Not reached'),
    hint: tr(
      'Öffne Runback auf der Uhr und prüfe die Verbindung.',
      'Open Runback on the watch and check the connection.',
    ),
    muted: true,
  },
  disconnected: {
    label: tr('Nicht verbunden', 'Not connected'),
    hint: tr(
      'Das Telefon zeichnet allein auf.',
      'The phone is recording on its own.',
    ),
    muted: true,
  },
});

/** Shows during a recording whether the watch is recording too. */
export function WearRecordingRow({
  run,
}: {
  run: { id: string; status: string };
}) {
  const [wear, setWear] = useState<unknown>(null);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    let mounted = true;
    const update = async () => {
      if (AndroidAppState.currentState === 'background') {
        return;
      }
      try {
        const next = await nativeCall('getWearStatus');
        if (mounted) {
          setWear(next);
          setNow(Date.now());
        }
      } catch {
        // Keeps the last state; without a status the row is not shown.
      }
    };
    void update();
    const timer = setInterval(update, 2500);
    return () => {
      mounted = false;
      clearInterval(timer);
    };
  }, [run.id]);
  const link = wearRecordingLink(wear, run, now);
  if (!link) {
    return null;
  }
  const words = wordsFor()[link];
  return (
    <View accessibilityLiveRegion="polite">
      <Row
        title={tr('Uhr', 'Watch')}
        subtitle={words.hint}
        trailing={<Badge muted={words.muted}>{words.label}</Badge>}
      />
    </View>
  );
}
