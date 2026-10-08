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
import { fixed, tr } from '../domain/i18n';
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

// Built per render so the active language applies without a restart.
const wristOptions = (): { value: MotionWrist; label: string }[] => [
  { value: 'left', label: tr('Links', 'Left') },
  { value: 'right', label: tr('Rechts', 'Right') },
];

/** "3 sessions · 2 on the phone · 12.4 MB" */
function motionSummary(status: MotionStatus): string {
  const parts = [
    tr(
      `${status.sessions} ${status.sessions === 1 ? 'Einheit' : 'Einheiten'}`,
      `${status.sessions} ${status.sessions === 1 ? 'session' : 'sessions'}`,
    ),
    tr(`${status.received} auf dem Handy`, `${status.received} on the phone`),
  ];
  if (status.waiting > 0) {
    parts.push(
      tr(
        `${status.waiting} noch auf der Uhr`,
        `${status.waiting} still on the watch`,
      ),
    );
  }
  if (status.bytes > 0) {
    parts.push(`${fixed(status.bytes / 1_000_000, 1)} MB`);
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
  // "No sensors found" only means something after a scan.
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
          : tr(
              'Die Verbindung konnte nicht hergestellt werden.',
              'The connection could not be made.',
            ),
      );
    } finally {
      setBusy(false);
    }
  };
  const motionSettings: MotionCaptureSettings = settings.motionCapture ?? {
    enabled: false,
    wrist: 'unknown',
  };
  // A missing value means the watch measures heart rate (like Kotlin `MotionSessions.config`).
  const heartRate = motionSettings.heartRate !== false;
  const autoSets = motionSettings.autoSets !== false;
  const autoConfirm = motionSettings.autoConfirm === true;
  const saveMotion = (patch: Partial<MotionCaptureSettings>) =>
    save({ motionCapture: { ...motionSettings, ...patch } });
  return (
    <>
      <Title>{tr('Geräte & Verbindungen', 'Devices & connections')}</Title>
      {message ? (
        <View style={styles.message}>
          <Notice onDismiss={() => setMessage('')}>{message}</Notice>
        </View>
      ) : null}
      <Section title={tr('Dieses Telefon', 'This phone')}>
        <Row
          title="GPS"
          subtitle={
            capabilities.gps
              ? capabilities.locationPermission
                ? tr('Verfügbar und freigegeben', 'Available and allowed')
                : tr(
                    'Verfügbar · Freigabe beim Start',
                    'Available · allowed at start',
                  )
              : tr('Kein GPS-Sensor gemeldet', 'No GPS sensor reported')
          }
        />
        <Row
          title={tr('Barometer', 'Barometer')}
          subtitle={
            capabilities.barometer
              ? tr('Verfügbar', 'Available')
              : tr(
                  'Auf diesem Gerät nicht vorhanden',
                  'Not present on this device',
                )
          }
        />
        <Row
          title={tr('Beschleunigung', 'Accelerometer')}
          subtitle={
            capabilities.accelerometer
              ? tr('Verfügbar', 'Available')
              : tr(
                  'Auf diesem Gerät nicht vorhanden',
                  'Not present on this device',
                )
          }
        />
      </Section>
      <Section title="Wear OS">
        {wear ? (
          <Copy>
            {wear.message ||
              (wear.connected
                ? tr('Uhr verbunden', 'Watch connected')
                : tr(
                    'Derzeit keine Uhr verbunden',
                    'No watch connected right now',
                  ))}
          </Copy>
        ) : (
          <Copy muted>{tr('Status wird geprüft …', 'Checking status …')}</Copy>
        )}
        <Copy muted>
          {tr(
            'Die Uhr zeichnet auch ohne Telefon auf.',
            'The watch also records without the phone.',
          )}
        </Copy>
      </Section>
      <Section
        title={tr('Uhr im Krafttraining', 'Watch for strength training')}
      >
        <Row
          title={tr('Puls messen', 'Measure heart rate')}
          subtitle={tr(
            'Zeigt Puls je Satz und Erholung in der Pause.',
            'Shows heart rate per set and recovery during rest.',
          )}
          trailing={
            <Switch
              accessibilityLabel={tr(
                'Puls im Krafttraining mit der Uhr messen',
                'Measure heart rate with the watch during strength training',
              )}
              value={heartRate}
              onValueChange={value => saveMotion({ heartRate: value })}
              trackColor={{ false: color.line, true: color.green }}
              thumbColor={heartRate ? color.ink : color.muted}
            />
          }
        />
        <Row
          title={tr('Bewegungen mitschreiben', 'Record motion')}
          subtitle={tr(
            'Sammelt Daten, damit die Uhr Sätze erkennen kann.',
            'Collects data so the watch can detect sets.',
          )}
          trailing={
            <Switch
              accessibilityLabel={tr(
                'Bewegungen im Krafttraining aufzeichnen',
                'Record motion during strength training',
              )}
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
              title={tr('Sätze erkennen', 'Detect sets')}
              subtitle={tr(
                'Die Uhr zählt Wiederholungen mit, du bestätigst die Zahl.',
                'The watch counts the reps; you confirm the number.',
              )}
              trailing={
                <Switch
                  accessibilityLabel={tr(
                    'Sätze auf der Uhr automatisch erkennen',
                    'Detect sets automatically on the watch',
                  )}
                  value={autoSets}
                  onValueChange={value => saveMotion({ autoSets: value })}
                  trackColor={{ false: color.line, true: color.green }}
                  thumbColor={autoSets ? color.ink : color.muted}
                />
              }
            />
            {autoSets ? (
              <Row
                title={tr('Ohne Eingabe übernehmen', 'Accept without input')}
                subtitle={tr(
                  'Tippst du nichts, gilt die Zahl der Uhr nach 12 Sekunden.',
                  'If you tap nothing, the watch count applies after 12 seconds.',
                )}
                trailing={
                  <Switch
                    accessibilityLabel={tr(
                      'Erkannte Wiederholungen ohne Eingabe übernehmen',
                      'Accept detected reps without input',
                    )}
                    value={autoConfirm}
                    onValueChange={value => saveMotion({ autoConfirm: value })}
                    trackColor={{ false: color.line, true: color.green }}
                    thumbColor={autoConfirm ? color.ink : color.muted}
                  />
                }
              />
            ) : null}
            <ChipGroup
              label={tr('Handgelenk mit der Uhr', 'Wrist with the watch')}
              options={wristOptions()}
              value={motionSettings.wrist}
              onChange={wrist => saveMotion({ wrist })}
              disabled={busy}
            />
            {motionSettings.wrist === 'unknown' ? (
              <Copy muted>
                {tr(
                  'Wähle das Handgelenk, an dem die Uhr sitzt.',
                  'Choose the wrist the watch is on.',
                )}
              </Copy>
            ) : null}
          </>
        ) : null}
        {motion?.recording ? (
          <Copy>
            {motion.recording.watch.message ||
              tr('Uhr wird gestartet …', 'Starting watch …')}
          </Copy>
        ) : null}
        {motion && motion.sessions > 0 ? (
          <>
            <Copy muted>{motionSummary(motion)}</Copy>
            <Copy muted>
              {tr(
                'Exportiere sie mit dem Krafttraining unter „Deine Daten“.',
                'Export them with strength training under “Your data”.',
              )}
            </Copy>
            <Button
              small
              secondary
              title={tr('Bewegungsdaten löschen', 'Delete motion data')}
              disabled={busy}
              onPress={() =>
                Alert.alert(
                  tr('Bewegungsdaten löschen?', 'Delete motion data?'),
                  tr(
                    'Deine Sätze und Pulswerte bleiben erhalten.',
                    'Your sets and heart rate values stay.',
                  ),
                  [
                    { text: tr('Abbrechen', 'Cancel'), style: 'cancel' },
                    {
                      text: tr('Löschen', 'Delete'),
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
                connected: tr('Lesen ist freigegeben.', 'Reading is allowed.'),
                permission_required: tr(
                  'Lesefreigabe fehlt.',
                  'Read permission is missing.',
                ),
                unavailable: tr(
                  'Auf diesem Telefon nicht verfügbar.',
                  'Not available on this phone.',
                ),
                provider_update_required: tr(
                  'Health Connect muss installiert oder aktualisiert werden.',
                  'Health Connect must be installed or updated.',
                ),
              } as Record<string, string>
            )[health?.status] ||
            tr('Verfügbarkeit wird geprüft …', 'Checking availability …')}
        </Copy>
        <Button
          secondary
          title={tr('Leseberechtigungen verwalten', 'Manage read permissions')}
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
              title={tr('Letzte 30 Tage importieren', 'Import last 30 days')}
              disabled={busy}
              onPress={() => {
                void act(async () => {
                  const result = await nativeCall<any>('healthImport', 30);
                  const count = result.imported ?? result.runs ?? 0;
                  setMessage(
                    result.message ||
                      tr(
                        `${count} Läufe eingelesen.`,
                        `${count} ${count === 1 ? 'run' : 'runs'} imported.`,
                      ),
                  );
                  await refresh();
                });
              }}
            />
            <Copy muted>
              {tr(
                'Verfügbar ist nur, was deine anderen Apps nach Health Connect schreiben.',
                'Only what your other apps write to Health Connect is available.',
              )}
            </Copy>
          </>
        ) : null}
      </Section>
      <Section title={tr('Bluetooth-Sensoren', 'Bluetooth sensors')}>
        <Copy muted>
          {ble?.error ||
            (ble?.scanning
              ? tr('Suche läuft …', 'Scanning …')
              : tr(
                  'Herzfrequenz, Kadenz, Akku.',
                  'Heart rate, cadence, battery.',
                ))}
        </Copy>
        <Button
          secondary
          title={
            ble?.scanning
              ? tr('Suche stoppen', 'Stop scan')
              : tr('Sensoren suchen', 'Scan for sensors')
          }
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
              title={device.name || tr('Unbenannter Sensor', 'Unnamed sensor')}
              subtitle={`${
                (
                  {
                    connected: tr('Verbunden', 'Connected'),
                    connecting: tr('Verbindet …', 'Connecting …'),
                    disconnected: tr('Getrennt', 'Disconnected'),
                    reconnecting: tr('Verbindet erneut …', 'Reconnecting …'),
                  } as Record<string, string>
                )[device.state] || device.state
              }${device.error ? ` · ${device.error}` : ''}`}
            />
            {device.measurements?.heartRate ? (
              <Copy muted>
                {tr('Herzfrequenz', 'Heart rate')}:{' '}
                {device.measurements.heartRate.values.bpm} bpm
              </Copy>
            ) : null}
            {device.measurements?.cadence ? (
              <Copy muted>
                {tr('Kadenz', 'Cadence')}:{' '}
                {device.measurements.cadence.values.rawCadence} /min
              </Copy>
            ) : null}
            {device.measurements?.battery ? (
              <Copy muted>
                {tr('Akku', 'Battery')}:{' '}
                {device.measurements.battery.values.percent} %
              </Copy>
            ) : null}
            <Button
              small
              secondary
              title={
                device.selected || device.connected
                  ? tr('Sensor trennen', 'Disconnect sensor')
                  : tr('Verbinden', 'Connect')
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
          <Copy muted>
            {tr('Keine Sensoren gefunden.', 'No sensors found.')}
          </Copy>
        ) : null}
      </Section>
      <Section title={tr('Wetterdaten', 'Weather data')}>
        <Row
          title={tr('Wetter ergänzen', 'Add weather')}
          subtitle={tr(
            'Sendet Position und Laufzeit an Open-Meteo.',
            'Sends position and run time to Open-Meteo.',
          )}
          trailing={
            <Switch
              accessibilityLabel={tr(
                'Wetterdaten aktivieren',
                'Turn on weather data',
              )}
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
