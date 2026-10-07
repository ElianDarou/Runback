import React, { useRef, useState } from 'react';
import { Linking } from 'react-native';
import { native } from '../native';
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
        failure instanceof Error ? failure.message : 'Versuche es erneut.',
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
      <Title>Eigener Server</Title>
      {error ? (
        <Notice
          title="Aktion nicht abgeschlossen"
          onDismiss={() => setError('')}
        >
          {error}
        </Notice>
      ) : null}
      {!status ? (
        <EmptyState
          title="Status wird geladen"
          copy="Warte kurz auf den Verbindungsstand."
        />
      ) : (
        <>
          {connected ? (
            <Card>
              <Badge muted={status.state !== 'ok'}>
                {serverStateLabel(status)}
              </Badge>
              <Copy>{serverStateSentence(status)}</Copy>
              <Row title="Adresse" subtitle={status.url ?? undefined} />
              <Row
                title="Letzter Abgleich"
                subtitle={formatSyncTime(status.lastSuccessAt, Date.now())}
              />
              {status.pending !== null && status.pending > 0 ? (
                <Row
                  title="Noch ausstehend"
                  subtitle={`${status.pending.toLocaleString(
                    'de-DE',
                  )} Einträge`}
                />
              ) : null}
            </Card>
          ) : (
            <Copy muted>
              Verbinde deinen Server, um deine Daten dort anzusehen.
            </Copy>
          )}
          {pairing ? (
            <Section title="Verbinden">
              <Field
                label="Serveradresse"
                hint="Zum Beispiel nas.local:8080 oder https://runback.deine-domain.de"
              >
                <Input
                  label="Serveradresse"
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
                label="Kopplungscode"
                hint="Erzeuge den Code auf deiner Website unter „Daten“."
              >
                <Input
                  label="Kopplungscode"
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
          <Section title="Was darf auf deinen Server?">
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
              title={busy ? 'Wird verbunden …' : 'Server verbinden'}
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
                  ? 'Wird übertragen …'
                  : 'Freigabe speichern und abgleichen'
              }
            />
          )}
          <Disclosure title="Details">
            <Copy muted>
              Das Telefon bleibt das Original. Die Website liest eine Kopie;
              Pläne und Empfehlungen änderst du in der App.
            </Copy>
            <Copy muted>
              Ohne Verbindung trainierst du weiter. Rohsamples, Originaldateien
              und Zugangsschlüssel bleiben auf dem Telefon.
            </Copy>
            <Copy muted>
              Eine abgewählte Datenart verschwindet beim nächsten vollständigen
              Abgleich vom Server.
            </Copy>
            {connected ? (
              <>
                <Row
                  title="Website öffnen"
                  onPress={() => {
                    void Linking.openURL(status.url!).catch(() =>
                      setError('Die Website konnte nicht geöffnet werden.'),
                    );
                  }}
                />
                <Copy muted>
                  Beim Trennen bleibt die Kopie auf dem Server; löschen kannst
                  du sie dort unter „Daten“.
                </Copy>
                <Button
                  danger
                  secondary
                  disabled={busy}
                  onPress={() => void act(() => native.disconnectServer())}
                  title="Server trennen"
                />
              </>
            ) : null}
          </Disclosure>
        </>
      )}
    </>
  );
}
