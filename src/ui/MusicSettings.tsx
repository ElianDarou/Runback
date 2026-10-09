import React, { useEffect, useRef, useState } from 'react';
import { Linking } from 'react-native';
import { native } from '../native';
import { fixed, numberFormat, tr } from '../domain/i18n';
import {
  musicStateLabel,
  parseMusicBpm,
  tapTempo,
  type MusicStatus,
  type MusicTrack,
} from '../domain/music';
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
  MusicArtwork,
  SpotifyAttribution,
  Notice,
  Row,
  Section,
  Segmented,
  Sheet,
  Title,
} from './components';

function useMusicStatus() {
  const [status, setStatus] = useState<MusicStatus | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    let pending = false;
    const read = async () => {
      if (pending || busyRef.current) return;
      pending = true;
      try {
        const next = await native.musicStatus();
        if (mounted.current) setStatus(next);
      } catch {
        if (mounted.current)
          setError(tr('Lade den Musikstatus erneut.', 'Reload music status.'));
      } finally {
        pending = false;
      }
    };
    void read();
    const timer = setInterval(() => {
      void read();
    }, 2000);
    return () => {
      mounted.current = false;
      clearInterval(timer);
    };
  }, []);
  const act = async (operation: () => Promise<MusicStatus>) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError('');
    try {
      const next = await operation();
      if (mounted.current) setStatus(next);
    } catch (failure) {
      if (mounted.current)
        setError(
          failure instanceof Error
            ? failure.message
            : tr('Versuche es erneut.', 'Try again.'),
        );
    } finally {
      busyRef.current = false;
      if (mounted.current) setBusy(false);
    }
  };
  return { status, error, setError, busy, act };
}

export function MusicSettings({
  enabled,
  onToggle,
}: {
  enabled: boolean;
  onToggle: (value: boolean) => void;
}) {
  const { status, error, setError, busy, act } = useMusicStatus();
  const [authorizing, setAuthorizing] = useState(false);
  const [clientId, setClientId] = useState('');
  const [key, setKey] = useState('');
  const [playlist, setPlaylist] = useState('');
  const [mode, setMode] = useState<'cadence' | 'fixed'>('cadence');
  const [target, setTarget] = useState('');
  const [halfTime, setHalfTime] = useState(true);
  const [editor, setEditor] = useState<MusicTrack | null>(null);
  const [bpm, setBpm] = useState('');
  const [page, setPage] = useState(0);
  const taps = useRef<number[]>([]);
  const loaded = useRef(false);
  useEffect(() => {
    if (!status || loaded.current) return;
    loaded.current = true;
    setClientId(status.clientId);
    setMode(status.config.mode);
    setHalfTime(status.config.halfTime);
    setTarget(
      status.config.fixedBpm === undefined
        ? ''
        : String(status.config.fixedBpm),
    );
    setPlaylist(
      status.config.playlist
        ? `https://open.spotify.com/playlist/${status.config.playlist.id}`
        : '',
    );
  }, [status]);
  const tracks = status?.config.playlist?.tracks ?? [];
  const known = tracks.filter(track => track.bpm != null).length;
  const unqueried = tracks.filter(
    track => track.bpm == null && !track.bpmCheckedAt,
  ).length;
  const open = (url: string) => {
    void Linking.openURL(url).catch(() =>
      setError(
        tr('Öffne den Link im Browser.', 'Open the link in your browser.'),
      ),
    );
  };
  const save = async () => {
    const fixedBpm = parseMusicBpm(target, 80);
    if (mode === 'fixed' && fixedBpm === undefined) {
      setError(
        tr(
          'Setze das Musiktempo zwischen 80 und 250 BPM.',
          'Set the music tempo between 80 and 250 BPM.',
        ),
      );
      return;
    }
    await act(async () => {
      const next = await native.configureMusic(
        { mode, fixedBpm, halfTime },
        clientId.trim(),
        key.trim(),
      );
      setKey('');
      return next;
    });
  };
  return (
    <>
      <Title>{tr('Musik', 'Music')}</Title>
      <CheckRow
        title={tr('Musik beim Laufen', 'Music while running')}
        checked={enabled}
        disabled={busy}
        onToggle={onToggle}
      />
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
            'Warte kurz oder lade den Status erneut.',
            'Wait a moment or reload status.',
          )}
          action={{
            title: tr('Erneut laden', 'Reload'),
            onPress: () => {
              void act(native.musicStatus);
            },
          }}
        />
      ) : (
        <>
          {!enabled ? (
            <Copy muted>
              {tr(
                'Schalte Musik ein, um Spotify einzurichten.',
                'Turn on music to set up Spotify.',
              )}
            </Copy>
          ) : (
            <>
              <Section title={tr('Spotify', 'Spotify')}>
                <Badge muted={!status.connected}>
                  {status.connected
                    ? tr('Verbunden', 'Connected')
                    : tr('Nicht verbunden', 'Disconnected')}
                </Badge>
                {!status.spotifyInstalled ? (
                  <Row
                    title={tr('Spotify installieren', 'Install Spotify')}
                    onPress={() =>
                      open(
                        'https://play.google.com/store/apps/details?id=com.spotify.music',
                      )
                    }
                  />
                ) : null}
                <Field label={tr('Spotify-Client-ID', 'Spotify client ID')}>
                  <Input
                    label={tr('Spotify-Client-ID', 'Spotify client ID')}
                    value={clientId}
                    onChangeText={setClientId}
                    editable={!busy}
                    autoCapitalize="none"
                    autoCorrect={false}
                    maxLength={32}
                  />
                </Field>
                <Disclosure title={tr('Spotify einrichten', 'Set up Spotify')}>
                  <Copy>
                    {tr(
                      'Erstelle mit deinem Premium-Konto eine eigene Entwickler-App und wähle Web API und Android.',
                      'Create your own developer app with your Premium account and select Web API and Android.',
                    )}
                  </Copy>
                  <Row
                    title={tr(
                      'Entwickler-Dashboard öffnen',
                      'Open developer dashboard',
                    )}
                    onPress={() =>
                      open('https://developer.spotify.com/dashboard')
                    }
                  />
                  <Copy muted>
                    {tr(
                      'Trage diese Rücksprungadresse ein und füge dich unter Users Management hinzu.',
                      'Register this redirect URI and add yourself under Users Management.',
                    )}
                  </Copy>
                  <Copy selectable>{status.redirectUri}</Copy>
                  <Copy muted>
                    {tr(
                      'Trage als Android-Paket com.runback und diesen SHA-1-Fingerabdruck ein.',
                      'Register com.runback as the Android package with this SHA-1 fingerprint.',
                    )}
                  </Copy>
                  <Copy selectable>{status.fingerprint}</Copy>
                  <Copy muted>
                    {tr(
                      'Kopiere die Client-ID hierher; ein Client Secret wird nicht benötigt.',
                      'Copy the client ID here; no client secret is needed.',
                    )}
                  </Copy>
                </Disclosure>
              </Section>
              <Section title={tr('Musiktempo', 'Music tempo')}>
                <Segmented
                  label={tr('Musiktempo wählen', 'Choose music tempo')}
                  options={[
                    {
                      value: 'cadence',
                      label: tr('Meinen Schritten folgen', 'Follow my steps'),
                    },
                    {
                      value: 'fixed',
                      label: tr('Festes Tempo', 'Fixed tempo'),
                    },
                  ]}
                  value={mode}
                  onChange={value => {
                    if (!busy) setMode(value);
                  }}
                />
                {mode === 'fixed' ? (
                  <Field label={tr('Schläge pro Minute', 'Beats per minute')}>
                    <Input
                      label={tr('Musiktempo in BPM', 'Music tempo in BPM')}
                      value={target}
                      onChangeText={setTarget}
                      keyboardType="decimal-pad"
                      editable={!busy}
                      maxLength={6}
                    />
                  </Field>
                ) : null}
                <CheckRow
                  title={tr(
                    'Auch einen Beat für zwei Schritte nutzen',
                    'Also use one beat for two steps',
                  )}
                  checked={halfTime}
                  disabled={busy}
                  onToggle={setHalfTime}
                />
                <Button
                  title={tr(
                    'Musikeinstellungen speichern',
                    'Save music settings',
                  )}
                  disabled={busy}
                  onPress={() => {
                    void save();
                  }}
                />
                <Button
                  secondary
                  title={tr('Spotify verbinden', 'Connect Spotify')}
                  disabled={busy || !status.clientId}
                  onPress={() => {
                    setAuthorizing(true);
                    void act(native.authorizeMusic).finally(() =>
                      setAuthorizing(false),
                    );
                  }}
                />
                {authorizing ? (
                  <Row
                    title={tr('Anmeldung abbrechen', 'Cancel sign-in')}
                    onPress={() => {
                      void native
                        .cancelMusicAuthorization()
                        .catch(() =>
                          setError(tr('Versuche es erneut.', 'Try again.')),
                        );
                    }}
                  />
                ) : null}
              </Section>
              <Section title={tr('Playlist', 'Playlist')}>
                <Field
                  label={tr(
                    'Link deiner eigenen Spotify-Playlist',
                    'Your own Spotify playlist link',
                  )}
                >
                  <Input
                    label={tr('Spotify-Playlist', 'Spotify playlist')}
                    value={playlist}
                    onChangeText={setPlaylist}
                    editable={!busy}
                    autoCapitalize="none"
                    autoCorrect={false}
                    keyboardType="url"
                  />
                </Field>
                <Button
                  secondary
                  title={tr('Playlist einlesen', 'Load playlist')}
                  disabled={busy || !status.connected || !playlist.trim()}
                  onPress={() => {
                    setPage(0);
                    void act(() => native.importMusicPlaylist(playlist));
                  }}
                />
                {status.config.playlist ? (
                  <Copy muted>
                    {tr(
                      `${status.config.playlist.name} · ${numberFormat().format(
                        known,
                      )} von ${numberFormat().format(
                        tracks.length,
                      )} Titeln mit BPM`,
                      `${status.config.playlist.name} · ${numberFormat().format(
                        known,
                      )} of ${numberFormat().format(
                        tracks.length,
                      )} tracks with BPM`,
                    )}
                  </Copy>
                ) : (
                  <Copy muted>
                    {tr(
                      'Wähle eine Playlist, die dir gehört oder an der du mitarbeitest.',
                      'Choose a playlist you own or collaborate on.',
                    )}
                  </Copy>
                )}
                {status.config.playlist?.truncated ? (
                  <Copy muted>
                    {tr(
                      'Nur die ersten 500 Playlist-Einträge wurden eingelesen.',
                      'Only the first 500 playlist entries were loaded.',
                    )}
                  </Copy>
                ) : null}
              </Section>
              <Disclosure title={tr('Songtempo abrufen', 'Look up song tempo')}>
                <Copy muted>
                  {tr(
                    'Sende Titel und Künstler an GetSongBPM; deine Laufdaten bleiben auf dem Handy.',
                    'Send titles and artists to GetSongBPM; your run data stays on the phone.',
                  )}
                </Copy>
                <Field
                  label={tr('Dein GetSongBPM-Schlüssel', 'Your GetSongBPM key')}
                  hint={
                    status.hasBpmKey
                      ? tr(
                          'Ein Schlüssel ist gespeichert; lasse das Feld leer, um ihn zu behalten.',
                          'A key is saved; leave this field empty to keep it.',
                        )
                      : undefined
                  }
                >
                  <Input
                    label={tr('GetSongBPM-Schlüssel', 'GetSongBPM key')}
                    value={key}
                    onChangeText={setKey}
                    secureTextEntry
                    editable={!busy}
                    autoCorrect={false}
                    autoCapitalize="none"
                    maxLength={256}
                  />
                </Field>
                <Button
                  secondary
                  title={tr('Schlüssel speichern', 'Save key')}
                  disabled={busy || !key.trim()}
                  onPress={() => {
                    void save();
                  }}
                />
                <Button
                  secondary
                  title={tr('Fehlende BPM abrufen', 'Look up missing BPM')}
                  disabled={busy || !status.hasBpmKey || unqueried === 0}
                  onPress={() => {
                    void act(native.lookupMusicBpm);
                  }}
                />
                <Copy muted>
                  {tr(
                    'Pro Abruf werden bis zu 50 neue Titel gesucht; unklare Treffer bleiben unbekannt.',
                    'Each lookup searches up to 50 new tracks; unclear matches stay unknown.',
                  )}
                </Copy>
                <Row
                  title={tr('GetSongBPM öffnen', 'Open GetSongBPM')}
                  onPress={() => open('https://getsongbpm.com/api')}
                />
                <Copy muted>
                  {tr(
                    'Beantrage deinen Schlüssel mit einem öffentlichen Backlink auf deiner Website; das ist auch für private Nutzung erforderlich.',
                    'Request your key with a public backlink on your website; this is also required for private use.',
                  )}
                </Copy>
                {status.hasBpmKey ? (
                  <Row
                    title={tr('BPM-Schlüssel entfernen', 'Remove BPM key')}
                    disabled={busy}
                    onPress={() => {
                      void act(native.clearMusicBpmKey);
                    }}
                  />
                ) : null}
              </Disclosure>
              {tracks.length > 0 ? (
                <Section title={tr('Titel', 'Tracks')}>
                  <SpotifyAttribution />
                  {tracks.slice(page * 20, page * 20 + 20).map(track => (
                    <Row
                      key={track.uri}
                      title={track.name}
                      subtitle={`${track.artists.join(', ')} · ${
                        track.bpm == null
                          ? tr('BPM unbekannt', 'BPM unknown')
                          : `${fixed(track.bpm, 0)} BPM · ${
                              track.bpmSource === 'manual'
                                ? tr('Selbst gesetzt', 'Set by you')
                                : tr('GetSongBPM', 'GetSongBPM')
                            }`
                      }`}
                      disabled={busy}
                      onPress={() => {
                        setEditor(track);
                        setBpm(track.bpm == null ? '' : String(track.bpm));
                        taps.current = [];
                      }}
                    />
                  ))}
                  {page > 0 ? (
                    <Button
                      secondary
                      title={tr('Vorherige Titel', 'Previous tracks')}
                      disabled={busy}
                      onPress={() => setPage(page - 1)}
                    />
                  ) : null}
                  {(page + 1) * 20 < tracks.length ? (
                    <Button
                      secondary
                      title={tr('Weitere Titel', 'More tracks')}
                      disabled={busy}
                      onPress={() => setPage(page + 1)}
                    />
                  ) : null}
                </Section>
              ) : null}
              <Disclosure title={tr('Details', 'Details')}>
                <Copy muted>
                  {tr(
                    'Starte die Musik im laufenden Handy-Lauf; der nächste Titel wird kurz vor dem Songende gewählt.',
                    'Start music during a phone run; the next track is selected shortly before the song ends.',
                  )}
                </Copy>
                <Copy muted>
                  {tr(
                    'Ohne frische Schrittwerte oder passenden Titel bleibt die laufende Musik unverändert.',
                    'Without fresh step readings or a matching track, the current music stays unchanged.',
                  )}
                </Copy>
                <Copy muted>
                  {tr(
                    'Ein manueller Titelwechsel oder eine Pause in Spotify beendet die automatische Steuerung.',
                    'A manual track change or pause in Spotify ends automatic control.',
                  )}
                </Copy>
                <Copy muted>
                  {tr(
                    'Zugangsdaten bleiben verschlüsselt auf dem Gerät und fehlen im Backup.',
                    'Credentials stay encrypted on the device and are excluded from backups.',
                  )}
                </Copy>
                <Copy muted>
                  {tr(
                    'Für Offline-Wiedergabe lade die Musik in Spotify herunter und verbinde Runback vorher online.',
                    'For offline playback, download music in Spotify and connect Runback online beforehand.',
                  )}
                </Copy>
                <Row
                  title={tr(
                    'Spotify trennen und Musikdaten löschen',
                    'Disconnect Spotify and delete music data',
                  )}
                  disabled={busy}
                  onPress={() => {
                    void act(async () => {
                      const next = await native.disconnectMusic();
                      setClientId('');
                      setKey('');
                      setPlaylist('');
                      setMode(next.config.mode);
                      setTarget('');
                      setHalfTime(next.config.halfTime);
                      setPage(0);
                      return next;
                    });
                  }}
                />
              </Disclosure>
            </>
          )}
        </>
      )}
      <Sheet
        visible={editor !== null}
        title={editor?.name ?? tr('Songtempo', 'Song tempo')}
        onClose={() => {
          if (!busy) setEditor(null);
        }}
      >
        <Field label={tr('Schläge pro Minute', 'Beats per minute')}>
          <Input
            label={tr('Songtempo in BPM', 'Song tempo in BPM')}
            value={bpm}
            onChangeText={setBpm}
            keyboardType="decimal-pad"
            editable={!busy}
            maxLength={6}
          />
        </Field>
        <Button
          secondary
          title={tr('Im Takt mittippen', 'Tap along to the beat')}
          disabled={busy}
          onPress={() => {
            const now = Date.now();
            const last = taps.current.at(-1);
            if (last !== undefined && now - last > 1500) taps.current = [];
            taps.current = [...taps.current.slice(-8), now];
            const result = tapTempo(taps.current);
            if (result !== undefined) setBpm(String(result));
          }}
        />
        <Button
          title={tr('BPM speichern', 'Save BPM')}
          disabled={busy || parseMusicBpm(bpm) === undefined}
          onPress={() => {
            const value = parseMusicBpm(bpm);
            if (editor && value !== undefined) {
              void act(async () => {
                const next = await native.setMusicBpm(editor.uri, value);
                setEditor(null);
                return next;
              });
            }
          }}
        />
        <Row
          title={tr(
            'BPM löschen und erneut suchbar machen',
            'Clear BPM and allow another lookup',
          )}
          disabled={busy}
          onPress={() => {
            if (editor)
              void act(async () => {
                const next = await native.setMusicBpm(editor.uri);
                setEditor(null);
                return next;
              });
          }}
        />
        {editor ? (
          <>
            <MusicArtwork
              uri={editor.imageUrl}
              label={`${editor.name} · ${editor.artists.join(', ')}`}
            />
            <SpotifyAttribution />
            <Row
              title={tr('In Spotify öffnen', 'Open in Spotify')}
              onPress={() =>
                open(
                  `https://open.spotify.com/track/${editor.uri
                    .split(':')
                    .at(-1)}`,
                )
              }
            />
          </>
        ) : null}
      </Sheet>
    </>
  );
}

export function MusicLive({
  runId,
  paused = false,
  onSettings,
}: {
  runId: string;
  paused?: boolean;
  onSettings: () => void;
}) {
  const { status, busy, error, setError, act } = useMusicStatus();
  const active = status?.runId === runId;
  const track = active ? status?.currentTrack : undefined;
  const ready = Boolean(
    status?.config.playlist?.tracks.some(item => item.bpm != null),
  );
  return (
    <Section title={tr('Musik', 'Music')}>
      {error ? (
        <Notice
          title={tr('Musik nicht gestartet', 'Music not started')}
          onDismiss={() => setError('')}
        >
          {error}
        </Notice>
      ) : null}
      {track ? (
        <Card>
          <MusicArtwork
            uri={track.imageUrl}
            label={`${track.name} · ${track.artists.join(', ')}`}
          />
          <Row
            title={track.name}
            subtitle={track.artists.join(', ')}
            onPress={() => {
              void Linking.openURL(
                `https://open.spotify.com/track/${track.uri.split(':').at(-1)}`,
              ).catch(() => setError(tr('Öffne Spotify.', 'Open Spotify.')));
            }}
          />
          <SpotifyAttribution />
        </Card>
      ) : null}
      {status ? (
        <Badge muted={!active}>
          {!active && !ready && status.state === 'idle'
            ? tr('BPM fehlen', 'BPM missing')
            : musicStateLabel(status.state)}
        </Badge>
      ) : null}
      {status && !ready ? (
        <Copy muted>
          {tr(
            'Lies eine Playlist ein und ergänze die BPM ihrer Titel.',
            'Load a playlist and add the BPM of its tracks.',
          )}
        </Copy>
      ) : null}
      {active && status?.target != null ? (
        <Copy muted>{`${fixed(status.target, 0)} ${
          status.config.mode === 'fixed'
            ? 'BPM'
            : tr('Schritte/min', 'steps/min')
        }`}</Copy>
      ) : null}
      {status?.message ? <Copy muted>{status.message}</Copy> : null}
      {active ? (
        <Button
          secondary
          title={tr('Musiksteuerung beenden', 'Stop music control')}
          disabled={busy}
          onPress={() => {
            void act(native.stopMusic);
          }}
        />
      ) : (
        <Button
          secondary
          title={tr('Musik starten', 'Start music')}
          disabled={busy || !ready || paused}
          onPress={() => {
            void act(() => native.startMusic(runId));
          }}
        />
      )}
      <Row
        title={tr('Musik einrichten', 'Set up music')}
        onPress={onSettings}
      />
    </Section>
  );
}
