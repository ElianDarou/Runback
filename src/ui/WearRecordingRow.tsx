import React, { useEffect, useState } from 'react';
import { AppState as AndroidAppState, View } from 'react-native';
import { nativeCall } from '../native';
import { wearRecordingLink, type WearRecordingLink } from '../domain/wearLink';
import { Badge, Row } from './components';

const WORDS: Record<
  WearRecordingLink,
  { label: string; hint?: string; muted: boolean }
> = {
  recording: { label: 'Zeichnet mit', muted: false },
  waiting: {
    label: 'Wartet',
    hint: 'Öffne Runback auf der Uhr.',
    muted: true,
  },
  silent: {
    label: 'Keine Daten',
    hint: 'Prüfe, ob die Uhr noch aufzeichnet.',
    muted: true,
  },
  failed: {
    label: 'Nicht erreicht',
    hint: 'Öffne Runback auf der Uhr und prüfe die Verbindung.',
    muted: true,
  },
  disconnected: {
    label: 'Nicht verbunden',
    hint: 'Das Telefon zeichnet allein auf.',
    muted: true,
  },
};

/** Zeigt während einer Aufzeichnung, ob die Uhr mitschreibt. */
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
        // Bleibt beim letzten Stand; ohne Status wird die Zeile nicht gezeigt.
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
  const words = WORDS[link];
  return (
    <View accessibilityLiveRegion="polite">
      <Row
        title="Uhr"
        subtitle={words.hint}
        trailing={<Badge muted={words.muted}>{words.label}</Badge>}
      />
    </View>
  );
}
