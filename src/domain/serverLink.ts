import { locale, tr } from './i18n';

/**
 * Your own Runback server: optional, belongs to the user, receives only a copy.
 * Data flows only from the phone to the server; the server changes nothing in the app.
 *
 * This file holds the rules that the app, Kotlin and the server share: protocol
 * version, data scope, address check, and how the connection status is shown.
 */

/** Goes up when object keys or contents change incompatibly. */
export const SERVER_SYNC_PROTOCOL = 1;

/** What may go to the server. Raw samples and original files always stay on the phone. */
export interface ServerScope {
  runs: boolean;
  strength: boolean;
  /** Goal, focus, recommendations, plans and templates. */
  coach: boolean;
  /** Routes as coordinates. Without approval, no coordinate leaves the phone. */
  gps: boolean;
  /** Values from Health Connect and imports (sleep, resting HR, weight …). */
  health: boolean;
}

export const DEFAULT_SERVER_SCOPE: ServerScope = {
  runs: true,
  strength: true,
  coach: true,
  gps: false,
  health: false,
};

/** One scope option; its texts are read in the active language on access. */
function scopeOption(
  key: keyof ServerScope,
  label: { de: string; en: string },
  detail: { de: string; en: string },
) {
  return {
    key,
    get label() {
      return tr(label.de, label.en);
    },
    get detail() {
      return tr(detail.de, detail.en);
    },
  };
}

export const SERVER_SCOPE_OPTIONS: {
  key: keyof ServerScope;
  readonly label: string;
  readonly detail: string;
}[] = [
  scopeOption(
    'runs',
    { de: 'Läufe', en: 'Runs' },
    {
      de: 'Zusammenfassung, Verlauf und Abschnitte',
      en: 'Summary, history and segments',
    },
  ),
  scopeOption(
    'strength',
    { de: 'Krafttraining', en: 'Strength training' },
    { de: 'Einheiten, Sätze und Puls', en: 'Sessions, sets and heart rate' },
  ),
  scopeOption(
    'coach',
    { de: 'Coach', en: 'Coach' },
    {
      de: 'Ziel, Fokus, Empfehlungen und Pläne',
      en: 'Goal, focus, recommendations and plans',
    },
  ),
  scopeOption(
    'gps',
    { de: 'GPS-Strecken', en: 'GPS routes' },
    { de: 'Wo du gelaufen bist', en: 'Where you ran' },
  ),
  scopeOption(
    'health',
    { de: 'Gesundheitswerte', en: 'Health values' },
    { de: 'Schlaf, Ruhepuls, Gewicht', en: 'Sleep, resting HR, weight' },
  ),
];

export function readServerScope(raw: unknown): ServerScope {
  const value = (raw && typeof raw === 'object' ? raw : {}) as Record<
    string,
    unknown
  >;
  const pick = (key: keyof ServerScope) =>
    typeof value[key] === 'boolean'
      ? (value[key] as boolean)
      : DEFAULT_SERVER_SCOPE[key];
  return {
    runs: pick('runs'),
    strength: pick('strength'),
    coach: pick('coach'),
    gps: pick('gps'),
    health: pick('health'),
  };
}

export type ServerAddress =
  | { ok: true; url: string; encrypted: boolean }
  | { ok: false; reason: string };

/**
 * Checks the typed address. Without a scheme, https applies; in the home
 * network, http. Unencrypted is only allowed on your own network: at home on a
 * NAS without a certificate it should work, over the internet it should not.
 */
export function normalizeServerAddress(input: string): ServerAddress {
  const trimmed = input.trim().replace(/\/+$/, '');
  if (!trimmed)
    return {
      ok: false,
      reason: tr('Gib die Adresse deines Servers ein.', 'Enter the address of your server.'),
    };
  // React Native does not provide a complete WHATWG URL.
  const match =
    /^(?:(https?):\/\/)?(\[[0-9a-f:]+\]|[a-z0-9.-]+)(?::([0-9]{1,5}))?$/i.exec(
      trimmed,
    );
  if (!match || trimmed.includes('..'))
    return {
      ok: false,
      reason: tr(
        'Nutze eine Serveradresse ohne Pfad oder Zugangsdaten.',
        'Use a server address without a path or login details.',
      ),
    };
  const host = match[2].toLowerCase();
  const port = match[3] ? Number(match[3]) : null;
  if (port !== null && (port < 1 || port > 65535))
    return { ok: false, reason: tr('Der Port ist ungültig.', 'The port is invalid.') };
  const local = isLocalHost(host);
  const encrypted = match[1] ? match[1].toLowerCase() === 'https' : !local;
  if (!encrypted && !local)
    return {
      ok: false,
      reason: tr(
        'Nutze https für Adressen außerhalb deines Heimnetzes.',
        'Use https for addresses outside your home network.',
      ),
    };
  return {
    ok: true,
    url: `${encrypted ? 'https' : 'http'}://${host}${
      port !== null ? `:${port}` : ''
    }`,
    encrypted,
  };
}

/**
 * Addresses reachable only on your own network: private IPv4 ranges,
 * Tailscale/CGNAT, link-local, IPv6 ULA and names such as `nas.local`.
 */
export function isLocalHost(rawHost: string): boolean {
  const host = rawHost.replace(/^\[|\]$/g, '').toLowerCase();
  if (host === 'localhost') return true;
  if (/\.(local|lan|home\.arpa|internal)$/.test(host)) return true;
  if (!host.includes('.') && !host.includes(':')) return true;
  const v4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    if ([v4[1], v4[2], v4[3], v4[4]].some(part => Number(part) > 255))
      return false;
    return (
      a === 10 ||
      a === 127 ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 169 && b === 254) ||
      (a === 100 && b >= 64 && b <= 127)
    );
  }
  if (host.includes(':')) {
    return (
      host === '::1' ||
      /^f[cd][0-9a-f]{2}:/.test(host) ||
      /^fe[89ab][0-9a-f]:/.test(host)
    );
  }
  return false;
}

export type ServerLinkState =
  /** Not set up. */
  | 'off'
  /** Last sync complete. */
  | 'ok'
  /** Sync is running right now. */
  | 'syncing'
  /** During training, only check reachability. */
  | 'waiting'
  /** Server unreachable, e.g. away from the home network. */
  | 'offline'
  /** Server no longer knows the phone; reconnect. */
  | 'rejected'
  /** Server reachable, but the sync failed. */
  | 'error';

export interface ServerLinkStatus {
  state: ServerLinkState;
  url: string | null;
  encrypted: boolean;
  scope: ServerScope;
  lastSuccessAt: number | null;
  lastAttemptAt: number | null;
  /** Objects not yet on the server at the last attempt; `null` = unknown. */
  pending: number | null;
  serverVersion: string | null;
  message: string | null;
}

export function readServerLinkStatus(raw: any): ServerLinkStatus {
  const states: ServerLinkState[] = [
    'off',
    'ok',
    'syncing',
    'waiting',
    'offline',
    'rejected',
    'error',
  ];
  const number = (value: unknown) =>
    typeof value === 'number' && Number.isFinite(value) && value > 0
      ? value
      : null;
  const url = typeof raw?.url === 'string' && raw.url ? raw.url : null;
  return {
    state: url && states.includes(raw?.state) ? raw.state : 'off',
    url,
    encrypted: raw?.encrypted !== false,
    scope: readServerScope(raw?.scope),
    lastSuccessAt: number(raw?.lastSuccessAt),
    lastAttemptAt: number(raw?.lastAttemptAt),
    pending:
      typeof raw?.pending === 'number' &&
      Number.isFinite(raw.pending) &&
      raw.pending >= 0
        ? raw.pending
        : null,
    serverVersion:
      typeof raw?.serverVersion === 'string' && raw.serverVersion
        ? raw.serverVersion
        : null,
    message:
      typeof raw?.message === 'string' && raw.message ? raw.message : null,
  };
}

/**
 * Red when the server is unreachable right now or rejects the sync.
 * The app keeps working normally in the meantime.
 */
export function serverNeedsAttention(status: ServerLinkStatus): boolean {
  return (
    status.state === 'offline' ||
    status.state === 'rejected' ||
    status.state === 'error'
  );
}

/** The dot next to the gear icon; without a configured server there is none. */
export function serverMark(
  status: ServerLinkStatus | null,
): 'connected' | 'attention' | null {
  if (!status || status.state === 'off') return null;
  return serverNeedsAttention(status) ? 'attention' : 'connected';
}

export function serverStateLabel(status: ServerLinkStatus): string {
  switch (status.state) {
    case 'off':
      return tr('Aus', 'Off');
    case 'ok':
      return tr('Aktuell', 'Up to date');
    case 'syncing':
      return tr('Wird übertragen', 'Syncing');
    case 'waiting':
      return tr('Nach dem Training', 'After training');
    case 'offline':
      return tr('Nicht erreichbar', 'Unreachable');
    case 'rejected':
      return tr('Neu verbinden', 'Reconnect');
    case 'error':
      return tr('Fehler', 'Error');
  }
}

/** One sentence under the status; says what happens and whether the user must act. */
export function serverStateSentence(status: ServerLinkStatus): string {
  switch (status.state) {
    case 'off':
      return tr(
        'Runback speichert alles nur auf diesem Telefon.',
        'Runback keeps everything on this phone only.',
      );
    case 'ok':
      return tr(
        'Dein Server hat denselben Stand wie dieses Telefon.',
        'Your server has the same data as this phone.',
      );
    case 'syncing':
      return tr(
        'Runback überträgt gerade deine Änderungen.',
        'Runback is sending your changes right now.',
      );
    case 'waiting':
      return tr(
        'Runback überträgt nach dem laufenden Training.',
        'Runback sends after the current training.',
      );
    case 'offline':
      return tr(
        'Runback überträgt, sobald dein Server wieder erreichbar ist.',
        'Runback sends as soon as your server is reachable again.',
      );
    case 'rejected':
      return tr(
        'Dein Server kennt dieses Telefon nicht mehr. Verbinde es neu.',
        'Your server no longer knows this phone. Reconnect it.',
      );
    case 'error':
      return (
        status.message ||
        tr(
          'Der letzte Abgleich ist fehlgeschlagen. Runback versucht es wieder.',
          'The last sync failed. Runback will try again.',
        )
      );
  }
}

/** "today, 18:04", "yesterday, 07:12" or "03.10.2026, 18:04". */
export function formatSyncTime(at: number | null, now: number): string {
  if (at == null) return tr('noch nie', 'never');
  const date = new Date(at);
  const time = date.toLocaleTimeString(locale(), {
    hour: '2-digit',
    minute: '2-digit',
  });
  const day = (value: Date) =>
    new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime();
  const days = Math.round((day(new Date(now)) - day(date)) / 86_400_000);
  if (days === 0) return `${tr('heute', 'today')}, ${time}`;
  if (days === 1) return `${tr('gestern', 'yesterday')}, ${time}`;
  return `${date.toLocaleDateString(locale(), {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  })}, ${time}`;
}
