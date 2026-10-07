import React, { useEffect, useState } from 'react';
import { Alert, StyleSheet, Switch, View } from 'react-native';
import {
  nativeCall,
  type Capabilities,
  type MotionCaptureSettings,
  type MotionStatus,
  type MotionWrist,
  type Settings,
} from '../native';
import {
  Button,
  ChipGroup,
  Copy,
  Notice,
  Row,
  Section,
  Title,
  color,
  space,
} from './components';

const WRISTS: { value: MotionWrist; label: string }[] = [
  { value: 'left', label: 'Links' },
  { value: 'right', label: 'Rechts' },
];

/** „3 Einheiten · 2 auf dem Handy · 12,4 MB“ */
function motionSummary(status: MotionStatus): string {
  const parts = [
    `${status.sessions} ${status.sessions === 1 ? 'Einheit' : 'Einheiten'}`,
    `${status.received} auf dem Handy`,
  ];
  if (status.waiting > 0) {
    parts.push(`${status.waiting} noch auf der Uhr`);
  }
  if (status.bytes > 0) {
    parts.push(`${(status.bytes / 1_000_000).toFixed(1).replace('.', ',')} MB`);
  }
  return parts.join(' · ');
}

export function DeviceSettings({
  capabilities,
  settings,
  save,
  refresh,
}: {
  capabilities: Capabilities;
  settings: Settings;
  save: (patch: Partial<Settings>) => void;
  refresh: () => Promise<unknown>;
}) {
  const [ble, setBle] = useState<any>(null);
  // „Keine Sensoren gefunden“ ist erst nach einer Suche eine Aussage.
  const [scanned, setScanned] = useState(false);
  const [health, setHealth] = useState<any>(null);
  const [wear, setWear] = useState<any>(null);
  const [motion, setMotion] = useState<MotionStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  useEffect(() => {
    let mounted = true;
    const update = async () => {
      const results = await Promise.allSettled([
        nativeCall('bleStatus'),
        nativeCall('healthStatus'),
        nativeCall('getWearStatus'),
        nativeCall<MotionStatus>('getMotionStatus'),
      ]);
      if (!mounted) {
        return;
      }
      if (results[0].status === 'fulfilled') {
        setBle(results[0].value);
      }
      if (results[1].status === 'fulfilled') {
        setHealth(results[1].value);
      }
      if (results[2].status === 'fulfilled') {
        setWear(results[2].value);
      }
      if (results[3].status === 'fulfilled') {
        setMotion(results[3].value);
      }
    };
    void update();
    const timer = setInterval(update, 2500);
    return () => {
      mounted = false;
      clearInterval(timer);
    };
  }, []);
  const act = async (fn: () => Promise<void>) => {
    if (busy) {
      return;
    }
    setBusy(true);
    setMessage('');
    try {
      await fn();
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : 'Die Verbindung konnte nicht hergestellt werden.',
      );
    } finally {
      setBusy(false);
    }
  };
  const motionSettings: MotionCaptureSettings = settings.motionCapture ?? {
    enabled: false,
    wrist: 'unknown',
  };
  // Fehlt der Wert, misst die Uhr den Puls (wie Kotlin `MotionSessions.config`).
  const heartRate = motionSettings.heartRate !== false;
  const autoSets = motionSettings.autoSets !== false;
  const saveMotion = (patch: Partial<MotionCaptureSettings>) =>
    save({ motionCapture: { ...motionSettings, ...patch } });
  return (
    <>
      <Title>Geräte & Verbindungen</Title>
      {message ? (
        <View style={styles.message}>
          <Notice onDismiss={() => setMessage('')}>{message}</Notice>
        </View>
      ) : null}
      <Section title="Dieses Telefon">
        <Row
          title="GPS"
          subtitle={
            capabilities.gps
              ? capabilities.locationPermission
                ? 'Verfügbar und freigegeben'
                : 'Verfügbar · Freigabe beim Start'
              : 'Kein GPS-Sensor gemeldet'
          }
        />
        <Row
          title="Barometer"
          subtitle={
            capabilities.barometer
              ? 'Verfügbar'
              : 'Auf diesem Gerät nicht vorhanden'
          }
        />
        <Row
          title="Beschleunigung"
          subtitle={
            capabilities.accelerometer
              ? 'Verfügbar'
              : 'Auf diesem Gerät nicht vorhanden'
          }
        />
      </Section>
      <Section title="Wear OS">
        {wear ? (
          <Copy>
            {wear.message ||
              (wear.connected
                ? 'Uhr verbunden'
                : 'Derzeit keine Uhr verbunden')}
          </Copy>
        ) : (
          <Copy muted>Status wird geprüft …</Copy>
        )}
        <Copy muted>Die Uhr zeichnet auch ohne Telefon auf.</Copy>
      </Section>
      <Section title="Uhr im Krafttraining">
        <Row
          title="Puls messen"
          subtitle="Zeigt Puls je Satz und Erholung in der Pause."
          trailing={
            <Switch
              accessibilityLabel="Puls im Krafttraining mit der Uhr messen"
              value={heartRate}
              onValueChange={value => saveMotion({ heartRate: value })}
              trackColor={{ false: color.line, true: color.green }}
              thumbColor={heartRate ? color.ink : color.muted}
            />
          }
        />
        <Row
          title="Bewegungen mitschreiben"
          subtitle="Sammelt Daten, damit die Uhr Sätze erkennen kann."
          trailing={
            <Switch
              accessibilityLabel="Bewegungen im Krafttraining aufzeichnen"
              value={motionSettings.enabled}
              onValueChange={value => saveMotion({ enabled: value })}
              trackColor={{ false: color.line, true: color.green }}
              thumbColor={motionSettings.enabled ? color.ink : color.muted}
            />
          }
        />
        {motionSettings.enabled ? (
          <>
            <Row
              title="Sätze erkennen"
              subtitle="Die Uhr zählt Wiederholungen mit, du bestätigst die Zahl."
              trailing={
                <Switch
                  accessibilityLabel="Sätze auf der Uhr automatisch erkennen"
                  value={autoSets}
                  onValueChange={value => saveMotion({ autoSets: value })}
                  trackColor={{ false: color.line, true: color.green }}
                  thumbColor={autoSets ? color.ink : color.muted}
                />
              }
            />
            <ChipGroup
              label="Handgelenk mit der Uhr"
              options={WRISTS}
              value={motionSettings.wrist}
              onChange={wrist => saveMotion({ wrist })}
              disabled={busy}
            />
            {motionSettings.wrist === 'unknown' ? (
              <Copy muted>Wähle das Handgelenk, an dem die Uhr sitzt.</Copy>
            ) : null}
          </>
        ) : null}
        {motion?.recording ? (
          <Copy>
            {motion.recording.watch.message || 'Uhr wird gestartet …'}
          </Copy>
        ) : null}
        {motion && motion.sessions > 0 ? (
          <>
            <Copy muted>{motionSummary(motion)}</Copy>
            <Button
              secondary
              title="Bewegungsdaten exportieren"
              disabled={busy || motion.received === 0}
              onPress={() => {
                void act(async () => {
                  const result = await nativeCall<any>('exportMotionData');
                  if (result?.exported) {
                    setMessage(`${result.sessions} Einheiten exportiert.`);
                  }
                });
              }}
            />
            <Button
              small
              secondary
              title="Bewegungsdaten löschen"
              disabled={busy}
              onPress={() =>
                Alert.alert(
                  'Bewegungsdaten löschen?',
                  'Deine Sätze und Pulswerte bleiben erhalten.',
                  [
                    { text: 'Abbrechen', style: 'cancel' },
                    {
                      text: 'Löschen',
                      style: 'destructive',
                      onPress: () => {
                        void act(async () =>
                          setMotion(
                            await nativeCall<MotionStatus>('deleteMotionData'),
                          ),
                        );
                      },
                    },
                  ],
                )
              }
            />
          </>
        ) : null}
      </Section>
      <Section title="Health Connect">
        <Copy muted>
          {health?.message ||
            (
              {
                connected: 'Lesen ist freigegeben.',
                permission_required: 'Lesefreigabe fehlt.',
                unavailable: 'Auf diesem Telefon nicht verfügbar.',
                provider_update_required:
                  'Health Connect muss installiert oder aktualisiert werden.',
              } as Record<string, string>
            )[health?.status] ||
            'Verfügbarkeit wird geprüft …'}
        </Copy>
        <Button
          secondary
          title="Leseberechtigungen verwalten"
          disabled={busy}
          onPress={() => {
            void act(async () =>
              setHealth(
                await nativeCall('healthRequestPermissions', false, false),
              ),
            );
          }}
        />
        {health?.status === 'connected' ? (
          <>
            <Button
              secondary
              title="Letzte 30 Tage importieren"
              disabled={busy}
              onPress={() => {
                void act(async () => {
                  const result = await nativeCall<any>('healthImport', 30);
                  setMessage(
                    result.message ||
                      `${
                        result.imported ?? result.runs ?? 0
                      } Läufe eingelesen.`,
                  );
                  await refresh();
                });
              }}
            />
            <Copy muted>
              Verfügbar ist nur, was deine anderen Apps nach Health Connect
              schreiben.
            </Copy>
          </>
        ) : null}
      </Section>
      <Section title="Bluetooth-Sensoren">
        <Copy muted>
          {ble?.error ||
            (ble?.scanning ? 'Suche läuft …' : 'Herzfrequenz, Kadenz, Akku.')}
        </Copy>
        <Button
          secondary
          title={ble?.scanning ? 'Suche stoppen' : 'Sensoren suchen'}
          disabled={busy}
          onPress={() => {
            void act(async () => {
              if (!ble?.scanning) {
                await nativeCall('requestBluetoothPermissions');
                setScanned(true);
              }
              setBle(
                await nativeCall(
                  ble?.scanning ? 'bleStopScan' : 'bleStartScan',
                ),
              );
            });
          }}
        />
        {ble?.devices?.map((device: any) => (
          <View key={device.address}>
            <Row
              title={device.name || 'Unbenannter Sensor'}
              subtitle={`${
                (
                  {
                    connected: 'Verbunden',
                    connecting: 'Verbindet …',
                    disconnected: 'Getrennt',
                    reconnecting: 'Verbindet erneut …',
                  } as Record<string, string>
                )[device.state] || device.state
              }${device.error ? ` · ${device.error}` : ''}`}
            />
            {device.measurements?.heartRate ? (
              <Copy muted>
                Herzfrequenz: {device.measurements.heartRate.values.bpm} bpm
              </Copy>
            ) : null}
            {device.measurements?.cadence ? (
              <Copy muted>
                Kadenz: {device.measurements.cadence.values.rawCadence} /min
              </Copy>
            ) : null}
            {device.measurements?.battery ? (
              <Copy muted>
                Akku: {device.measurements.battery.values.percent} %
              </Copy>
            ) : null}
            <Button
              small
              secondary
              title={
                device.selected || device.connected
                  ? 'Sensor trennen'
                  : 'Verbinden'
              }
              disabled={busy}
              onPress={() => {
                void act(async () =>
                  setBle(
                    await nativeCall(
                      device.selected || device.connected
                        ? 'bleDisconnect'
                        : 'bleConnect',
                      device.address,
                    ),
                  ),
                );
              }}
            />
          </View>
        ))}
        {scanned && ble && !ble.scanning && !ble.devices?.length ? (
          <Copy muted>Keine Sensoren gefunden.</Copy>
        ) : null}
      </Section>
      <Section title="Wetterdaten">
        <Row
          title="Wetter ergänzen"
          subtitle="Sendet Position und Laufzeit an Open-Meteo."
          trailing={
            <Switch
              accessibilityLabel="Wetterdaten aktivieren"
              value={Boolean(settings.weatherEnabled)}
              onValueChange={value => save({ weatherEnabled: value })}
              trackColor={{ false: color.line, true: color.green }}
              thumbColor={settings.weatherEnabled ? color.ink : color.muted}
            />
          }
        />
      </Section>
    </>
  );
}
const styles = StyleSheet.create({
  message: { marginTop: space.sm },
});
