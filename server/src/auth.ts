import {
  createHash,
  randomBytes,
  randomInt,
  randomUUID,
  scryptSync,
  timingSafeEqual,
} from 'node:crypto';
import type { Store } from './db';

/**
 * Zugänge. Ein Server gehört genau einer Person:
 *
 * - **Passwort** für die Website. Steht in `RUNBACK_PASSWORD` oder wird beim
 *   ersten Start erzeugt und einmal ins Log geschrieben.
 * - **Telefon** bekommt beim Koppeln ein eigenes Token (`rbd_…`). Es darf
 *   übertragen und lesen.
 * - **Lese-Tokens** (`rbr_…`) für Skripte, Notebooks und Grafana. Sie dürfen
 *   nur lesen.
 *
 * Gespeichert werden nur Hashes. Ein Token steht genau einmal im Klartext auf
 * dem Bildschirm.
 */

export type Scope = 'ingest' | 'read' | 'admin';
export interface Principal {
  kind: 'device' | 'token' | 'session';
  id: string;
  scopes: Scope[];
  csrf?: string;
}

const SESSION_DAYS = 30;
const PAIRING_MINUTES = 10;
const PAIRING_ATTEMPTS = 5;

export const sha256 = (value: string) =>
  createHash('sha256').update(value).digest('hex');

function secret(prefix: string) {
  return `${prefix}_${randomBytes(32).toString('base64url')}`;
}

function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const key = scryptSync(password, salt, 32, { N: 16384, r: 8, p: 1 });
  return `scrypt$${salt.toString('base64')}$${key.toString('base64')}`;
}

function verifyPassword(password: string, stored: string): boolean {
  const [scheme, salt, key] = stored.split('$');
  if (scheme !== 'scrypt' || !salt || !key) return false;
  const expected = Buffer.from(key, 'base64');
  const actual = scryptSync(
    password,
    Buffer.from(salt, 'base64'),
    expected.length,
    {
      N: 16384,
      r: 8,
      p: 1,
    },
  );
  return timingSafeEqual(actual, expected);
}

/**
 * Sorgt für ein Passwort. Ist `RUNBACK_PASSWORD` gesetzt, gilt immer dieses.
 * Sonst entsteht beim ersten Start eins; der Rückgabewert ist es dann im
 * Klartext, damit `main` es genau einmal ausgibt.
 */
export function ensurePassword(
  store: Store,
  fromEnv: string | undefined,
): string | null {
  const stored = store.meta('password');
  if (fromEnv) {
    if (fromEnv.length < 8) {
      throw new Error('RUNBACK_PASSWORD braucht mindestens 8 Zeichen.');
    }
    if (!stored || !verifyPassword(fromEnv, stored)) {
      store.setMeta('password', hashPassword(fromEnv));
      store.db.prepare('DELETE FROM sessions').run();
    }
    return null;
  }
  if (stored) return null;
  const generated = randomBytes(12).toString('base64url');
  store.setMeta('password', hashPassword(generated));
  return generated;
}

export function checkPassword(store: Store, password: string): boolean {
  const stored = store.meta('password');
  return !!stored && verifyPassword(password, stored);
}

export function changePassword(
  store: Store,
  current: string,
  next: string,
): string | null {
  if (!checkPassword(store, current))
    return 'Das aktuelle Passwort stimmt nicht.';
  if (next.length < 8) return 'Das neue Passwort braucht mindestens 8 Zeichen.';
  store.transaction(() => {
    store.setMeta('password', hashPassword(next));
    store.db.prepare('DELETE FROM sessions').run();
  });
  return null;
}

export function createSession(
  store: Store,
  now: number,
): { cookie: string; csrf: string } {
  const id = randomBytes(32).toString('base64url');
  const csrf = randomBytes(24).toString('base64url');
  store.db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(now);
  store.db
    .prepare(
      'INSERT INTO sessions(id_hash, csrf, created_at, expires_at) VALUES(?, ?, ?, ?)',
    )
    .run(sha256(id), csrf, now, now + SESSION_DAYS * 86_400_000);
  return { cookie: id, csrf };
}

export function endSession(store: Store, cookie: string) {
  store.db
    .prepare('DELETE FROM sessions WHERE id_hash = ?')
    .run(sha256(cookie));
}

export function sessionPrincipal(
  store: Store,
  cookie: string,
  now: number,
): Principal | null {
  const row = store.db
    .prepare('SELECT id_hash, csrf, expires_at FROM sessions WHERE id_hash = ?')
    .get(sha256(cookie)) as
    | { id_hash: string; csrf: string; expires_at: number }
    | undefined;
  if (!row || row.expires_at < now) return null;
  return {
    kind: 'session',
    id: row.id_hash,
    scopes: ['read', 'admin'],
    csrf: row.csrf,
  };
}

export function bearerPrincipal(
  store: Store,
  token: string,
  now: number,
): Principal | null {
  const hash = sha256(token);
  if (token.startsWith('rbd_')) {
    const row = store.db
      .prepare('SELECT id FROM devices WHERE token_hash = ?')
      .get(hash) as { id: string } | undefined;
    if (!row) return null;
    store.db
      .prepare('UPDATE devices SET last_seen_at = ? WHERE id = ?')
      .run(now, row.id);
    return { kind: 'device', id: row.id, scopes: ['ingest', 'read'] };
  }
  if (token.startsWith('rbr_')) {
    const row = store.db
      .prepare('SELECT id FROM tokens WHERE token_hash = ?')
      .get(hash) as { id: string } | undefined;
    if (!row) return null;
    store.db
      .prepare('UPDATE tokens SET last_used_at = ? WHERE id = ?')
      .run(now, row.id);
    return { kind: 'token', id: row.id, scopes: ['read'] };
  }
  return null;
}

/**
 * Neuer Kopplungscode, acht Ziffern, zehn Minuten gültig, fünf Versuche.
 * Ein neuer Code ersetzt den alten.
 */
export function createPairingCode(
  store: Store,
  now: number,
): { code: string; expiresAt: number } {
  const code = String(randomInt(0, 100_000_000)).padStart(8, '0');
  const expiresAt = now + PAIRING_MINUTES * 60_000;
  store.transaction(() => {
    store.db.prepare('DELETE FROM pairing').run();
    store.db
      .prepare(
        'INSERT INTO pairing(code_hash, expires_at, attempts) VALUES(?, ?, 0)',
      )
      .run(sha256(code), expiresAt);
  });
  return { code, expiresAt };
}

export function pairingExpiry(store: Store, now: number): number | null {
  const row = store.db
    .prepare(
      'SELECT expires_at, attempts FROM pairing WHERE expires_at > ? AND attempts < ?',
    )
    .get(now, PAIRING_ATTEMPTS) as { expires_at: number } | undefined;
  return row ? row.expires_at : null;
}

/**
 * Löst einen Kopplungscode ein. Jeder falsche Versuch zählt gegen den offenen
 * Code; nach fünf ist er verbraucht. Ein Server gehört einer Person, also
 * ersetzt ein neues Telefon das alte.
 */
export function redeemPairingCode(
  store: Store,
  code: string,
  deviceName: string,
  protocol: number,
  now: number,
): { token: string; deviceId: string } | null {
  return store.transaction(() => {
    const open = store.db
      .prepare(
        'SELECT code_hash, attempts FROM pairing WHERE expires_at > ? AND attempts < ?',
      )
      .get(now, PAIRING_ATTEMPTS) as
      | { code_hash: string; attempts: number }
      | undefined;
    if (!open) return null;
    const given = Buffer.from(sha256(code.replace(/\D/g, '')));
    const expected = Buffer.from(open.code_hash);
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
      store.db
        .prepare(
          'UPDATE pairing SET attempts = attempts + 1 WHERE code_hash = ?',
        )
        .run(open.code_hash);
      return null;
    }
    store.db.prepare('DELETE FROM pairing').run();
    store.db.prepare('DELETE FROM devices').run();
    store.db.prepare('DELETE FROM staged_objects').run();
    const token = secret('rbd');
    const deviceId = randomUUID();
    store.db
      .prepare(
        'INSERT INTO devices(id, name, token_hash, created_at, last_seen_at, app_protocol) VALUES(?, ?, ?, ?, ?, ?)',
      )
      .run(
        deviceId,
        deviceName.slice(0, 80) || 'Telefon',
        sha256(token),
        now,
        now,
        protocol,
      );
    return { token, deviceId };
  });
}

export function createReadToken(
  store: Store,
  name: string,
  now: number,
): string {
  const token = secret('rbr');
  store.db
    .prepare(
      'INSERT INTO tokens(id, name, token_hash, created_at) VALUES(?, ?, ?, ?)',
    )
    .run(
      randomUUID(),
      name.trim().slice(0, 80) || 'Lese-Token',
      sha256(token),
      now,
    );
  return token;
}

export function revokeReadToken(store: Store, id: string) {
  store.db.prepare('DELETE FROM tokens WHERE id = ?').run(id);
}

export function removeDevice(store: Store, id: string) {
  store.db.prepare('DELETE FROM devices WHERE id = ?').run(id);
}

/**
 * Bremst Rateversuche am Login und beim Koppeln: höchstens zehn Fehlversuche
 * je Adresse in 15 Minuten. Nur im Speicher; ein Neustart setzt zurück.
 */
export class Throttle {
  private failures = new Map<string, number[]>();
  constructor(private limit = 10, private windowMs = 15 * 60_000) {}

  blocked(key: string, now: number): boolean {
    const recent = (this.failures.get(key) ?? []).filter(
      at => now - at < this.windowMs,
    );
    this.failures.set(key, recent);
    return recent.length >= this.limit;
  }

  fail(key: string, now: number) {
    const recent = (this.failures.get(key) ?? []).filter(
      at => now - at < this.windowMs,
    );
    recent.push(now);
    this.failures.set(key, recent);
    if (this.failures.size > 10_000) {
      this.failures.clear();
    }
  }
}
