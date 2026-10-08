import React, { useState } from 'react';
import { Alert } from 'react-native';
import { nativeCall } from '../native';
import { tr } from '../domain/i18n';
import { Button, Copy, Section } from './components';
export function RunIntegrations({
  id,
  weatherEnabled,
}: {
  id: string;
  weatherEnabled: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [weather, setWeather] = useState<any>(null);
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
          : tr('Aktion fehlgeschlagen.', 'Action failed.'),
      );
    } finally {
      setBusy(false);
    }
  };
  const healthExport = (route: boolean) => {
    void act(async () => {
      await nativeCall('healthRequestPermissions', true, route);
      const result = await nativeCall<any>('healthExport', id, route);
      setMessage(
        result.message ||
          (result.status === 'exported' || result.status === 'success'
            ? tr(
                'Lauf an Health Connect übergeben.',
                'Run handed to Health Connect.',
              )
            : tr(
                `Health Connect: ${result.status || 'Vorgang abgeschlossen'}`,
                `Health Connect: ${result.status || 'Operation completed'}`,
              )),
      );
    });
  };
  return (
    <>
      <Section title={tr('Wetter zum Lauf', 'Weather for the run')}>
        <Copy muted>
          {weatherEnabled
            ? tr(
                'Genaue Position und Laufzeit werden für diese Anfrage an Open-Meteo übermittelt.',
                'Your exact position and run time are sent to Open-Meteo for this request.',
              )
            : tr(
                'Wetter ist ausgeschaltet. Du kannst es unter Geräte & Verbindungen freigeben.',
                'Weather is off. You can allow it under Devices & connections.',
              )}
        </Copy>
        {weather ? (
          <>
            <Copy>
              {weather.message ||
                (weather.status === 'available' || weather.status === 'partial'
                  ? tr(
                      `${weather.temperatureC ?? '–'} °C · ${
                        weather.windMps ?? '–'
                      } m/s Wind`,
                      `${weather.temperatureC ?? '–'} °C · ${
                        weather.windMps ?? '–'
                      } m/s wind`,
                    )
                  : tr(
                      'Für diesen Lauf sind keine passenden Wetterdaten verfügbar.',
                      'No matching weather data is available for this run.',
                    ))}
            </Copy>
            {weather.source ? (
              <Copy muted>
                {tr(
                  `Quelle: ${weather.source} · ${weather.resolution} · Modell ${weather.modelVersion}. Regionaler Modellwind, keine Messung am Körper.`,
                  `Source: ${weather.source} · ${weather.resolution} · model ${weather.modelVersion}. Regional model wind, not measured on the body.`,
                )}
              </Copy>
            ) : null}
          </>
        ) : null}
        <Button
          secondary
          title={tr('Wetter abrufen', 'Get weather')}
          disabled={!weatherEnabled || busy}
          onPress={() => {
            void act(async () =>
              setWeather(await nativeCall('enrichWeather', id)),
            );
          }}
        />
      </Section>
      <Section title="Health Connect">
        <Copy muted>
          {tr(
            'Nur nach deiner Freigabe. Die Route kannst du getrennt mitgeben.',
            'Only with your permission. You can share the route separately.',
          )}
        </Copy>
        <Button
          secondary
          title={tr(
            'Lauf an Health Connect senden',
            'Send run to Health Connect',
          )}
          disabled={busy}
          onPress={() =>
            Alert.alert(
              tr('Route mitgeben?', 'Share the route?'),
              tr(
                'Andere Apps mit Health-Connect-Zugriff können diese Daten lesen.',
                'Other apps with Health Connect access can read this data.',
              ),
              [
                { text: tr('Abbrechen', 'Cancel'), style: 'cancel' },
                {
                  text: tr('Ohne Route', 'Without route'),
                  onPress: () => healthExport(false),
                },
                {
                  text: tr('Mit Route', 'With route'),
                  onPress: () => healthExport(true),
                },
              ],
            )
          }
        />
      </Section>
      {message ? <Copy>{message}</Copy> : null}
    </>
  );
}
