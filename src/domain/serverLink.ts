/**
 * Eigener Runback-Server: optional, gehört dem Nutzer, bekommt nur eine Kopie.
 * Daten fließen nur vom Telefon zum Server; der Server ändert nichts in der App.
 *
 * Hier stehen die Regeln, die App, Kotlin und Server teilen: Protokollversion,
 * Datenumfang, Adressprüfung und wie der Verbindungsstand angezeigt wird.
 */

/** Steigt, wenn sich Objektschlüssel oder Inhalte inkompatibel ändern. */
export const SERVER_SYNC_PROTOCOL = 1;

/** Was auf den Server darf. Rohsamples und Originaldateien bleiben immer auf dem Telefon. */
export interface ServerScope {
  runs: boolean;
  strength: boolean;
  /** Ziel, Fokus, Empfehlungen, Pläne und Vorlagen. */
  coach: boolean;
  /** Strecken als Koordinaten. Ohne Freigabe verlässt keine Koordinate das Telefon. */
  gps: boolean;
  /** Werte aus Health Connect und Importen (Schlaf, Ruhepuls, Gewicht …). */
  health: boolean;
}

export const DEFAULT_SERVER_SCOPE: ServerScope = {
  runs: true,
  strength: true,
  coach: true,
  gps: false,
  health: false,
};

export const SERVER_SCOPE_OPTIONS: {
  key: keyof ServerScope;
  label: string;
  detail: string;
}[] = [
  {
    key: 'runs',
    label: 'Läufe',
    detail: 'Zusammenfassung, Verlauf und Abschnitte',
  },
  {
    key: 'strength',
    label: 'Krafttraining',
    detail: 'Einheiten, Sätze und Puls',
  },
  {
    key: 'coach',
    label: 'Coach',
    detail: 'Ziel, Fokus, Empfehlungen und Pläne',
  },
  { key: 'gps', label: 'GPS-Strecken', detail: 'Wo du gelaufen bist' },
  {
    key: 'health',
    label: 'Gesundheitswerte',
    detail: 'Schlaf, Ruhepuls, Gewicht',
  },
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
 * Prüft die eingetippte Adresse. Ohne Schema gilt https, im Heimnetz http.
 * Unverschlüsselt ist nur im eigenen Netz erlaubt: Zuhause auf einem NAS ohne
 * Zertifikat soll es gehen, über das Internet nicht.
 */
export function normalizeServerAddress(input: string): ServerAddress {
  const trimmed = input.trim().replace(/\/+$/, '');
  if (!trimmed)
    return { ok: false, reason: 'Gib die Adresse deines Servers ein.' };
  // React Native stellt keine vollständige WHATWG-URL bereit.
  const match =
    /^(?:(https?):\/\/)?(\[[0-9a-f:]+\]|[a-z0-9.-]+)(?::([0-9]{1,5}))?$/i.exec(
      trimmed,
    );
  if (!match || trimmed.includes('..'))
    return {
      ok: false,
      reason: 'Nutze eine Serveradresse ohne Pfad oder Zugangsdaten.',
    };
  const host = match[2].toLowerCase();
  const port = match[3] ? Number(match[3]) : null;
  if (port !== null && (port < 1 || port > 65535))
    return { ok: false, reason: 'Der Port ist ungültig.' };
  const local = isLocalHost(host);
  const encrypted = match[1] ? match[1].toLowerCase() === 'https' : !local;
  if (!encrypted && !local)
    return {
      ok: false,
      reason: 'Nutze https für Adressen außerhalb deines Heimnetzes.',
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
 * Adressen, die nur im eigenen Netz erreichbar sind: private IPv4-Bereiche,
 * Tailscale/CGNAT, link-local, IPv6 ULA und Namen wie `nas.local`.
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
  /** Nicht eingerichtet. */
  | 'off'
  /** Letzter Abgleich vollständig. */
  | 'ok'
  /** Abgleich läuft gerade. */
  | 'syncing'
  /** Während des Trainings nur Erreichbarkeit prüfen. */
  | 'waiting'
  /** Server nicht erreichbar, etwa unterwegs ohne Heimnetz. */
  | 'offline'
  /** Server kennt das Telefon nicht mehr; neu verbinden. */
  | 'rejected'
  /** Server erreichbar, aber der Abgleich ging schief. */
  | 'error';

export interface ServerLinkStatus {
  state: ServerLinkState;
  url: string | null;
  encrypted: boolean;
  scope: ServerScope;
  lastSuccessAt: number | null;
  lastAttemptAt: number | null;
  /** Objekte, die beim letzten Versuch noch nicht auf dem Server lagen; `null` = unbekannt. */
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
 * Der Punkt am Zahnrad: rot, wenn der Server gerade nicht erreichbar ist oder
 * den Abgleich ablehnt. Die App funktioniert dabei ganz normal weiter.
 */
export function serverNeedsAttention(status: ServerLinkStatus): boolean {
  return (
    status.state === 'offline' ||
    status.state === 'rejected' ||
    status.state === 'error'
  );
}

export function serverStateLabel(status: ServerLinkStatus): string {
  switch (status.state) {
    case 'off':
      return 'Aus';
    case 'ok':
      return 'Aktuell';
    case 'syncing':
      return 'Wird übertragen';
    case 'waiting':
      return 'Nach dem Training';
    case 'offline':
      return 'Nicht erreichbar';
    case 'rejected':
      return 'Neu verbinden';
    case 'error':
      return 'Fehler';
  }
}

/** Ein Satz unter dem Status; sagt, was passiert und ob der Nutzer etwas tun muss. */
export function serverStateSentence(status: ServerLinkStatus): string {
  switch (status.state) {
    case 'off':
      return 'Runback speichert alles nur auf diesem Telefon.';
    case 'ok':
      return 'Dein Server hat denselben Stand wie dieses Telefon.';
    case 'syncing':
      return 'Runback überträgt gerade deine Änderungen.';
    case 'waiting':
      return 'Runback überträgt nach dem laufenden Training.';
    case 'offline':
      return 'Runback überträgt, sobald dein Server wieder erreichbar ist.';
    case 'rejected':
      return 'Dein Server kennt dieses Telefon nicht mehr. Verbinde es neu.';
    case 'error':
      return (
        status.message ||
        'Der letzte Abgleich ist fehlgeschlagen. Runback versucht es wieder.'
      );
  }
}

/** „heute, 18:04“, „gestern, 07:12“ oder „03.10.2026, 18:04“. */
export function formatSyncTime(at: number | null, now: number): string {
  if (at == null) return 'noch nie';
  const date = new Date(at);
  const time = date.toLocaleTimeString('de-DE', {
    hour: '2-digit',
    minute: '2-digit',
  });
  const day = (value: Date) =>
    new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime();
  const days = Math.round((day(new Date(now)) - day(date)) / 86_400_000);
  if (days === 0) return `heute, ${time}`;
  if (days === 1) return `gestern, ${time}`;
  return `${date.toLocaleDateString('de-DE', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  })}, ${time}`;
}
