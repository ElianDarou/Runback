import {
  DEFAULT_SERVER_SCOPE,
  formatSyncTime,
  isLocalHost,
  normalizeServerAddress,
  readServerLinkStatus,
  readServerScope,
  serverMark,
  serverNeedsAttention,
  serverStateLabel,
} from '../src/domain/serverLink';

describe('Own server', () => {
  it('uses HTTP only on the home network and HTTPS for public domains', () => {
    expect(normalizeServerAddress(' nas.local:8080/ ')).toEqual({
      ok: true,
      url: 'http://nas.local:8080',
      encrypted: false,
    });
    expect(normalizeServerAddress('runback.example.org')).toEqual({
      ok: true,
      url: 'https://runback.example.org',
      encrypted: true,
    });
    expect(normalizeServerAddress('https://nas.local:8443')).toEqual({
      ok: true,
      url: 'https://nas.local:8443',
      encrypted: true,
    });
    expect(normalizeServerAddress('[fd12::1]:8080')).toEqual({
      ok: true,
      url: 'http://[fd12::1]:8080',
      encrypted: false,
    });
  });
  it.each([
    '',
    'http://example.org',
    'https://user:secret@nas.local',
    'https://nas.local/a',
    'https://nas.local?key=x',
    'https://nas.local#x',
    'ftp://nas.local',
    'nas.local:99999',
    'nas.local:0',
    'nas.local\\@example.org',
    '//example.org',
  ])('lehnt ungültige oder ungeschützte Adressen ab: %s', value => {
    expect(normalizeServerAddress(value).ok).toBe(false);
  });
  it.each([
    '10.1.1.1',
    '172.16.0.1',
    '172.31.255.255',
    '192.168.0.1',
    '100.64.0.1',
    '100.127.0.1',
    'localhost',
    'nas.home.arpa',
    'fe80::1',
    '::1',
  ])('kennt lokale Adressen: %s', host => expect(isLocalHost(host)).toBe(true));
  it.each([
    '172.15.0.1',
    '172.32.0.1',
    '192.169.0.1',
    '100.63.0.1',
    '100.128.0.1',
    '10.999.0.1',
    'nas.local.example.org',
    '2001:db8::1',
  ])('kennt öffentliche Adressen: %s', host =>
    expect(isLocalHost(host)).toBe(false),
  );
  it('releases GPS and health values only explicitly', () => {
    expect(readServerScope(null)).toEqual(DEFAULT_SERVER_SCOPE);
    expect(readServerScope({ gps: 'true', health: 1 })).toEqual(
      DEFAULT_SERVER_SCOPE,
    );
    expect(readServerScope({ runs: false, gps: true }).gps).toBe(true);
  });
  it('keeps unknown times and the offline status without changing training', () => {
    const offline = readServerLinkStatus({
      url: 'http://nas.local',
      state: 'offline',
      pending: 0,
      lastSuccessAt: -1,
    });
    expect(offline.lastSuccessAt).toBeNull();
    expect(offline.pending).toBe(0);
    expect(serverNeedsAttention(offline)).toBe(true);
    expect(serverStateLabel(offline)).toBe('Nicht erreichbar');
    expect(readServerLinkStatus({ state: 'offline' }).state).toBe('off');
    expect(
      serverNeedsAttention(
        readServerLinkStatus({ url: 'http://nas.local', state: 'ok' }),
      ),
    ).toBe(false);
    expect(serverMark(offline)).toBe('attention');
    expect(
      serverMark(readServerLinkStatus({ url: 'http://nas.local', state: 'ok' })),
    ).toBe('connected');
    expect(
      serverMark(
        readServerLinkStatus({ url: 'http://nas.local', state: 'waiting' }),
      ),
    ).toBe('connected');
    expect(serverMark(readServerLinkStatus({}))).toBeNull();
    expect(serverMark(null)).toBeNull();
    expect(formatSyncTime(null, Date.now())).toBe('noch nie');
    const now = new Date(2026, 9, 7, 18).getTime();
    expect(formatSyncTime(now, now)).toContain('heute');
    expect(formatSyncTime(now - 86400000, now)).toContain('gestern');
  });
});
