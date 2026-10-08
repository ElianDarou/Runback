import React, { useRef, useState } from 'react';
import { Linking } from 'react-native';
import { native } from '../native';
import { locale, tr } from '../domain/i18n';
import {
  DEFAULT_SERVER_SCOPE,
  SERVER_SCOPE_OPTIONS,
  formatSyncTime,
  normalizeServerAddress,
  serverStateLabel,
  serverStateSentence,
  type ServerLinkStatus,
  type ServerScope,
} from '../domain/serverLink';
import {
  Badge,
  Button,
  Card,
  CheckRow,
  Copy,
  Disclosure,
  EmptyState,
  Field,
  Input,
  Notice,
  Row,
  Section,
  Title,
} from './components';

export function ServerSettings({
  status,
  onStatus,
}: {
  status: ServerLinkStatus | null;
  onStatus: (next: ServerLinkStatus) => void;
}) {
  const [address, setAddress] = useState(status?.url ?? '');
  const [code, setCode] = useState('');
  const [scope, setScope] = useState<ServerScope>(
    status?.scope ?? DEFAULT_SERVER_SCOPE,
  );
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [error, setError] = useState('');
  const connected = Boolean(status?.url);
  const pairing = !connected || status?.state === 'rejected';
  const act = async (operation: () => Promise<ServerLinkStatus>) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError('');
    try {
      onStatus(await operation());
      setCode('');
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : tr('Versuche es erneut.', 'Try again.'),
      );
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };
  const connect = () => {
    const parsed = normalizeServerAddress(address);
    if (!parsed.ok) {
      setError(parsed.reason);
      return;
    }
    void act(() => native.connectServer(parsed.url, code.trim(), scope));
  };
  return (
    <>
      <Title>{tr('Eigener Server', 'Own server')}</Title>
      {error ? (
        <Notice
          title={tr('Aktion nicht abgeschlossen', 'Action not completed')}
          onDismiss={() => setError('')}
        >
          {error}
        </Notice>
      ) : null}
      {!status ? (
        <EmptyState
          title={tr('Status wird geladen', 'Loading status')}
          copy={tr(
            'Warte kurz auf den Verbindungsstand.',
            'Wait a moment for the connection status.',
          )}
        />
      ) : (
        <>
          {connected ? (
            <Card>
              <Badge muted={status.state !== 'ok'}>
                {serverStateLabel(status)}
              </Badge>
              <Copy>{serverStateSentence(status)}</Copy>
              <Row
                title={tr('Adresse', 'Address')}
                subtitle={status.url ?? undefined}
              />
              <Row
                title={tr('Letzter Abgleich', 'Last sync')}
                subtitle={formatSyncTime(status.lastSuccessAt, Date.now())}
              />
              {status.pending !== null && status.pending > 0 ? (
                <Row
                  title={tr('Noch ausstehend', 'Still pending')}
                  subtitle={tr(
                    `${status.pending.toLocaleString(locale())} Einträge`,
                    `${status.pending.toLocaleString(locale())} ${
                      status.pending === 1 ? 'entry' : 'entries'
                    }`,
                  )}
                />
              ) : null}
            </Card>
          ) : (
            <Copy muted>
              {tr(
                'Verbinde deinen Server, um deine Daten dort anzusehen.',
                'Connect your server to view your data there.',
              )}
            </Copy>
          )}
          {pairing ? (
            <Section title={tr('Verbinden', 'Connect')}>
              <Field
                label={tr('Serveradresse', 'Server address')}
                hint={tr(
                  'Zum Beispiel nas.local:8080 oder https://runback.deine-domain.de',
                  'For example nas.local:8080 or https://runback.your-domain.com',
                )}
              >
                <Input
                  label={tr('Serveradresse', 'Server address')}
                  value={address}
                  onChangeText={setAddress}
                  editable={!busy}
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="url"
                  placeholder="nas.local:8080"
                />
              </Field>
              <Field
                label={tr('Kopplungscode', 'Pairing code')}
                hint={tr(
                  'Erzeuge den Code auf deiner Website unter „Daten“.',
                  'Create the code on your website under “Your data”.',
                )}
              >
                <Input
                  label={tr('Kopplungscode', 'Pairing code')}
                  value={code}
                  onChangeText={setCode}
                  editable={!busy}
                  keyboardType="number-pad"
                  maxLength={8}
                  placeholder="12345678"
                />
              </Field>
            </Section>
          ) : null}
          <Section
            title={tr(
              'Was darf auf deinen Server?',
              'What may go to your server?',
            )}
          >
            {SERVER_SCOPE_OPTIONS.map(option => (
              <CheckRow
                key={option.key}
                title={option.label}
                subtitle={option.detail}
                checked={scope[option.key]}
                disabled={busy}
                onToggle={value =>
                  setScope(previous => ({ ...previous, [option.key]: value }))
                }
              />
            ))}
          </Section>
          {pairing ? (
            <Button
              disabled={busy || !address.trim() || code.trim().length !== 8}
              onPress={connect}
              title={
                busy
                  ? tr('Wird verbunden …', 'Connecting …')
                  : tr('Server verbinden', 'Connect server')
              }
            />
          ) : (
            <Button
              disabled={busy || status.state === 'syncing'}
              onPress={() =>
                void act(async () => {
                  await native.setServerScope(scope);
                  return native.syncServer();
                })
              }
              title={
                busy || status.state === 'syncing'
                  ? tr('Wird übertragen …', 'Sending …')
                  : tr(
                      'Freigabe speichern und abgleichen',
                      'Save sharing and sync',
                    )
              }
            />
          )}
          <Disclosure title={tr('Details', 'Details')}>
            <Copy muted>
              {tr(
                'Das Telefon bleibt das Original. Die Website liest eine Kopie; Pläne und Empfehlungen änderst du in der App.',
                'The phone stays the original. The website reads a copy; you change plans and recommendations in the app.',
              )}
            </Copy>
            <Copy muted>
              {tr(
                'Ohne Verbindung trainierst du weiter. Rohsamples, Originaldateien und Zugangsschlüssel bleiben auf dem Telefon.',
                'Without a connection you keep training. Raw samples, original files and access keys stay on the phone.',
              )}
            </Copy>
            <Copy muted>
              {tr(
                'Eine abgewählte Datenart verschwindet beim nächsten vollständigen Abgleich vom Server.',
                'A data type you clear disappears from the server at the next full sync.',
              )}
            </Copy>
            {connected ? (
              <>
                <Row
                  title={tr('Website öffnen', 'Open website')}
                  onPress={() => {
                    void Linking.openURL(status.url!).catch(() =>
                      setError(
                        tr(
                          'Die Website konnte nicht geöffnet werden.',
                          'The website could not be opened.',
                        ),
                      ),
                    );
                  }}
                />
                <Copy muted>
                  {tr(
                    'Beim Trennen bleibt die Kopie auf dem Server; löschen kannst du sie dort unter „Daten“.',
                    'When you disconnect, the copy stays on the server; you can delete it there under “Your data”.',
                  )}
                </Copy>
                <Button
                  danger
                  secondary
                  disabled={busy}
                  onPress={() => void act(() => native.disconnectServer())}
                  title={tr('Server trennen', 'Disconnect server')}
                />
              </>
            ) : null}
          </Disclosure>
        </>
      )}
    </>
  );
}
