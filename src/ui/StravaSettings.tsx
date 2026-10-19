import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, AppState, Linking } from 'react-native';
import { nativeCall } from '../native';
import { dateFormat, numberFormat, tr } from '../domain/i18n';
import {
  Badge,
  Button,
  CheckRow,
  Copy,
  Disclosure,
  Field,
  Input,
  Notice,
  Row,
  Section,
  Title,
} from './components';

interface StravaStatus {
  configured: boolean;
  clientId: string;
  connected: boolean;
  enabled: boolean;
  gps: boolean;
  health: boolean;
  athleteId: string;
  problem: string;
  lastSuccessAt: number | null;
  uploaded: number;
  pending: number;
  unknown: number;
  failed: number;
  issues: { key: string; name: string; at: number; state: string }[];
}

export function StravaSettings() {
  const [status, setStatus] = useState<StravaStatus | null>(null);
  const [clientId, setClientId] = useState<string | null>(null);
  const [secret, setSecret] = useState('');
  const [busy, setBusy] = useState(false);
  const [authorizing, setAuthorizing] = useState(false);
  const [error, setError] = useState('');
  const working = useRef(false);
  const mounted = useRef(true);
  const revision = useRef(0);
  const refresh = useCallback(async () => {
    const requestedAt = revision.current;
    try {
      const next = await nativeCall<StravaStatus>('getStravaStatus');
      if (
        mounted.current &&
        !working.current &&
        requestedAt === revision.current
      )
        setStatus(next);
    } catch {
      if (mounted.current && requestedAt === revision.current)
        setError(
          tr('Lade den Strava-Status erneut.', 'Reload the Strava status.'),
        );
    }
  }, []);
  useEffect(() => {
    mounted.current = true;
    void refresh();
    const subscription = AppState.addEventListener('change', state => {
      if (state === 'active') void refresh();
    });
    const timer = setInterval(() => {
      if (!working.current && AppState.currentState === 'active')
        void refresh();
    }, 5000);
    return () => {
      mounted.current = false;
      revision.current += 1;
      subscription.remove();
      clearInterval(timer);
    };
  }, [refresh]);

  const act = async (name: string, ...args: unknown[]) => {
    if (working.current) return;
    working.current = true;
    revision.current += 1;
    setBusy(true);
    setError('');
    try {
      const next = await nativeCall<StravaStatus>(name, ...args);
      if (mounted.current) setStatus(next);
      return next;
    } catch (cause) {
      if (mounted.current)
        setError(
          cause instanceof Error
            ? cause.message
            : tr('Versuche es erneut.', 'Try again.'),
        );
    } finally {
      working.current = false;
      revision.current += 1;
      if (mounted.current) {
        setBusy(false);
        setAuthorizing(false);
      }
    }
  };
  const open = (url: string) => {
    void Linking.openURL(url).catch(() =>
      setError(tr('Öffne Strava im Browser.', 'Open Strava in your browser.')),
    );
  };

  return (
    <>
      <Title>Strava</Title>
      {error ? (
        <Notice
          title={tr('Aktion fehlgeschlagen', 'Action failed')}
          onDismiss={() => setError('')}
        >
          {error}
        </Notice>
      ) : null}
      {!status ? (
        <Section title={tr('Verbindung', 'Connection')}>
          <Copy muted>{tr('Status wird geladen.', 'Loading status.')}</Copy>
          <Button
            secondary
            title={tr('Erneut laden', 'Reload')}
            onPress={() => {
              void refresh();
            }}
          />
        </Section>
      ) : (
        <>
          <Section title={tr('Übertragung', 'Uploads')}>
            <Badge muted={!status.connected}>
              {status.connected
                ? tr('Verbunden', 'Connected')
                : tr('Nicht verbunden', 'Not connected')}
            </Badge>
            <Copy muted>
              {tr(
                'Übertrage neue, abgeschlossene Läufe, Fahrten und Krafttrainings automatisch in dein Strava-Konto.',
                'Automatically upload new, completed runs, rides, and strength sessions to your Strava account.',
              )}
            </Copy>
            {status.connected ? (
              <>
                <CheckRow
                  title={tr(
                    'Automatisch nach Abschluss senden',
                    'Send automatically after finishing',
                  )}
                  checked={status.enabled}
                  disabled={busy}
                  onToggle={() => {
                    void act(
                      'setStravaOptions',
                      !status.enabled,
                      status.gps,
                      status.health,
                    );
                  }}
                />
                <CheckRow
                  title={tr('GPS-Strecke mitsenden', 'Include GPS route')}
                  checked={status.gps}
                  disabled={busy}
                  onToggle={() => {
                    void act(
                      'setStravaOptions',
                      status.enabled,
                      !status.gps,
                      status.health,
                    );
                  }}
                />
                <CheckRow
                  title={tr(
                    'Herzfrequenz bei Läufen und Fahrten mitsenden',
                    'Include heart rate from runs and rides',
                  )}
                  checked={status.health}
                  disabled={busy}
                  onToggle={() => {
                    void act(
                      'setStravaOptions',
                      status.enabled,
                      status.gps,
                      !status.health,
                    );
                  }}
                />
                <Copy muted>
                  {tr(
                    'Beim Einschalten beginnt die Übertragung mit den danach gestarteten Einheiten.',
                    'When enabled, uploads begin with sessions started from that point on.',
                  )}
                </Copy>
                {status.problem ? (
                  <Notice
                    title={tr('Übertragung ausstehend', 'Upload pending')}
                  >
                    {status.problem === 'authorization'
                      ? tr('Verbinde Strava erneut.', 'Reconnect Strava.')
                      : status.problem === 'limit'
                      ? tr(
                          'Das Strava-Limit ist erreicht; die Übertragung wird später wiederholt.',
                          'The Strava request limit was reached; uploads will retry later.',
                        )
                      : tr(
                          'Prüfe die Internetverbindung; ausstehende Einheiten werden später übertragen.',
                          'Check your internet connection; pending sessions will upload later.',
                        )}
                  </Notice>
                ) : null}
                <Row
                  title={tr('Von Strava bestätigt', 'Confirmed by Strava')}
                  subtitle={numberFormat().format(status.uploaded)}
                />
                {status.pending > 0 ? (
                  <Copy muted>
                    {tr(
                      `${numberFormat().format(
                        status.pending,
                      )} Übertragungen werden noch verarbeitet.`,
                      `${numberFormat().format(
                        status.pending,
                      )} uploads are still being processed.`,
                    )}
                  </Copy>
                ) : null}
                {status.lastSuccessAt ? (
                  <Copy muted>
                    {tr('Zuletzt übertragen: ', 'Last uploaded: ') +
                      dateFormat({
                        dateStyle: 'short',
                        timeStyle: 'short',
                      }).format(new Date(status.lastSuccessAt))}
                  </Copy>
                ) : null}
                <Button
                  secondary
                  title={tr('Jetzt erneut versuchen', 'Try again now')}
                  disabled={busy || !status.enabled}
                  onPress={() => {
                    void act('syncStrava');
                  }}
                />
                <Row
                  title={tr('In Strava ansehen', 'View on Strava')}
                  onPress={() =>
                    open('https://www.strava.com/athlete/training')
                  }
                />
              </>
            ) : null}
            {!status.connected || status.problem === 'authorization' ? (
              <Button
                title={tr('Strava verbinden', 'Connect Strava')}
                disabled={busy || !status.configured}
                onPress={() => {
                  setAuthorizing(true);
                  void act('authorizeStrava');
                }}
              />
            ) : null}
            {authorizing ? (
              <Row
                title={tr('Anmeldung abbrechen', 'Cancel sign-in')}
                onPress={() => {
                  void nativeCall('cancelStravaAuthorization').catch(() =>
                    setError(tr('Versuche es erneut.', 'Try again.')),
                  );
                }}
              />
            ) : null}
          </Section>
          {(status.issues ?? []).map(issue => (
            <Section
              key={issue.key}
              title={issue.name || tr('Aktivität', 'Activity')}
            >
              <Copy muted>
                {issue.at > 0
                  ? dateFormat({
                      dateStyle: 'short',
                      timeStyle: 'short',
                    }).format(new Date(issue.at))
                  : ''}
              </Copy>
              <Copy>
                {issue.state === 'failed'
                  ? tr(
                      'Prüfe die Daten dieser Einheit und versuche es erneut.',
                      'Check this session’s data and try again.',
                    )
                  : tr(
                      'Die Bestätigung fehlt; prüfe zuerst, ob die Aktivität in Strava vorhanden ist.',
                      'The confirmation is missing; first check whether the activity exists on Strava.',
                    )}
              </Copy>
              <Row
                title={tr(
                  'Als bereits in Strava vorhanden markieren',
                  'Mark as already on Strava',
                )}
                disabled={busy}
                onPress={() => {
                  void act('confirmExistingStravaUpload', issue.key);
                }}
              />
              <Button
                secondary
                title={tr(
                  'Nach Prüfung erneut senden',
                  'Resend after checking',
                )}
                disabled={busy || !status.enabled}
                onPress={() =>
                  Alert.alert(
                    tr('Erneut senden?', 'Send again?'),
                    tr(
                      'Prüfe zuerst dein Strava-Konto; erneutes Senden kann eine zweite Aktivität anlegen.',
                      'Check your Strava account first; sending again may create a second activity.',
                    ),
                    [
                      { text: tr('Abbrechen', 'Cancel'), style: 'cancel' },
                      {
                        text: tr('Erneut senden', 'Send again'),
                        onPress: () => {
                          void act('retryStravaUpload', issue.key);
                        },
                      },
                    ],
                  )
                }
              />
            </Section>
          ))}
          <Disclosure
            title={tr('Zugang einrichten', 'Set up access')}
            defaultOpen={!status.configured}
          >
            <Copy muted>
              {tr(
                'Erstelle einmalig eine eigene Strava-API-Anwendung und trage die Zugangsdaten hier ein.',
                'Create your own Strava API application once and enter its credentials here.',
              )}
            </Copy>
            <Row
              title={tr(
                'Strava-API-Einstellungen öffnen',
                'Open Strava API settings',
              )}
              onPress={() => open('https://www.strava.com/settings/api')}
            />
            <Copy muted>
              {tr(
                'Setze die „Authorization Callback Domain“ auf 127.0.0.1.',
                'Set the “Authorization Callback Domain” to 127.0.0.1.',
              )}
            </Copy>
            <Field
              label={tr('Deine Strava-Client-ID', 'Your Strava client ID')}
            >
              <Input
                label={tr('Strava-Client-ID', 'Strava client ID')}
                value={clientId ?? status.clientId}
                onChangeText={setClientId}
                keyboardType="number-pad"
                editable={!busy}
                maxLength={20}
              />
            </Field>
            <Field
              label="Client Secret"
              hint={
                status.configured
                  ? tr(
                      'Lasse das Feld leer, um den gespeicherten Schlüssel zu behalten.',
                      'Leave empty to keep the saved secret.',
                    )
                  : undefined
              }
            >
              <Input
                label="Strava Client Secret"
                value={secret}
                onChangeText={setSecret}
                secureTextEntry
                autoCapitalize="none"
                autoCorrect={false}
                editable={!busy}
                maxLength={256}
              />
            </Field>
            <Button
              secondary
              title={tr('Zugangsdaten speichern', 'Save credentials')}
              disabled={
                busy ||
                !(clientId ?? status.clientId).trim() ||
                (!secret && !status.configured)
              }
              onPress={() => {
                void act(
                  'configureStrava',
                  clientId ?? status.clientId,
                  secret,
                ).then(next => {
                  if (next && mounted.current) {
                    setSecret('');
                    setClientId(null);
                  }
                });
              }}
            />
          </Disclosure>
          <Disclosure title={tr('Details', 'Details')}>
            <Copy muted>
              {tr(
                'Ohne Internet wartet die Übertragung; Android kann sie im Hintergrund verzögern.',
                'Uploads wait for an internet connection; Android may delay them in the background.',
              )}
            </Copy>
            <Copy muted>
              {tr(
                'Importierte und geplante Einheiten werden nicht automatisch übertragen.',
                'Imported and planned sessions are excluded from automatic uploads.',
              )}
            </Copy>
            <Copy muted>
              {tr(
                'Strava bestimmt die Sichtbarkeit anhand deiner Strava-Einstellungen.',
                'Strava determines visibility using your Strava settings.',
              )}
            </Copy>
            <Copy muted>
              {tr(
                'Änderungen und Löschungen in Runback ändern bereits übertragene Aktivitäten nicht.',
                'Edits and deletions in Runback do not change activities already uploaded.',
              )}
            </Copy>
            <Copy muted>
              {tr(
                'Zugangsdaten bleiben verschlüsselt auf dem Handy und fehlen im Backup.',
                'Credentials stay encrypted on the phone and are excluded from backups.',
              )}
            </Copy>
            {status.configured ? (
              <Row
                title={tr(
                  'Strava trennen und Zugangsdaten entfernen',
                  'Disconnect Strava and remove credentials',
                )}
                disabled={busy}
                onPress={() => {
                  void act('disconnectStrava').then(next => {
                    if (next && mounted.current) {
                      setClientId(null);
                      setSecret('');
                    }
                  });
                }}
              />
            ) : null}
          </Disclosure>
        </>
      )}
    </>
  );
}
