import {
  SERVER_SYNC_PROTOCOL,
  readServerScope,
} from '../../src/domain/serverLink';
import type { Store } from './db';
import { rebuildDerived } from './records';

/**
 * Sync from the phone. The phone is the original; the server takes over its
 * state and never writes back.
 *
 * 1. `plan`: The phone sends its full inventory (key → hash). The server names
 *    what it is missing or has out of date.
 * 2. `objects`: The phone sends exactly those objects, in batches.
 * 3. `commit`: The phone sends the inventory again. Anything not in it was
 *    deleted on the phone or is no longer shared; the server deletes it too.
 *    Afterwards the SQL tables are rebuilt.
 *
 * Every step can be repeated freely. If the connection drops, objects already
 * sent stay in place and are not needed again.
 */

export const KINDS = [
  'run',
  'runDetail',
  'strength',
  'strengthImport',
  'strengthHeart',
  'settings',
  'templates',
  'soreness',
  'wellness',
] as const;
export type ObjectKind = (typeof KINDS)[number];

const KEY = /^([a-zA-Z]+)(?:\/([A-Za-z0-9._:@+-]{1,200}))?$/;
const HASH = /^[a-f0-9]{16,128}$/;
export const MAX_MANIFEST = 200_000;
export const MAX_BATCH = 500;

export class SyncError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

export function kindOf(key: string): ObjectKind {
  const match = KEY.exec(key);
  const kind = match?.[1] as ObjectKind | undefined;
  if (!match || !kind || !KINDS.includes(kind)) {
    throw new SyncError(400, `Unknown key: ${key.slice(0, 80)}`);
  }
  // Single objects have no id; lists always have one.
  const single =
    kind === 'settings' ||
    kind === 'templates' ||
    kind === 'soreness' ||
    kind === 'strengthHeart';
  if (single !== (match[2] === undefined)) {
    throw new SyncError(400, `Unknown key: ${key.slice(0, 80)}`);
  }
  return kind;
}

function checkProtocol(body: any) {
  if (body?.protocol !== SERVER_SYNC_PROTOCOL) {
    throw new SyncError(
      409,
      'The app and the server speak different versions. Update the server or the app.',
    );
  }
}

function readManifest(raw: unknown): Map<string, string> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new SyncError(400, 'Inventory is missing.');
  }
  const entries = Object.entries(raw as Record<string, unknown>);
  if (entries.length > MAX_MANIFEST) {
    throw new SyncError(413, 'The inventory is too large.');
  }
  const manifest = new Map<string, string>();
  for (const [key, hash] of entries) {
    kindOf(key);
    if (typeof hash !== 'string' || !HASH.test(hash)) {
      throw new SyncError(400, `Invalid hash for ${key.slice(0, 80)}.`);
    }
    manifest.set(key, hash);
  }
  return manifest;
}

function storedHashes(store: Store): Map<string, string> {
  const rows = store.db
    .prepare(
      'SELECT key, hash FROM objects UNION ALL SELECT key, hash FROM staged_objects',
    )
    .all() as {
    key: string;
    hash: string;
  }[];
  return new Map(rows.map(row => [row.key, row.hash]));
}

export function plan(store: Store, body: any): { need: string[] } {
  checkProtocol(body);
  const manifest = readManifest(body.manifest);
  const stored = storedHashes(store);
  const need: string[] = [];
  manifest.forEach((hash, key) => {
    if (stored.get(key) !== hash) need.push(key);
  });
  return { need };
}

export function receive(
  store: Store,
  body: any,
  now: number,
): { stored: number } {
  checkProtocol(body);
  const objects = body?.objects;
  if (!Array.isArray(objects) || objects.length > MAX_BATCH) {
    throw new SyncError(400, `Send at most ${MAX_BATCH} objects per batch.`);
  }
  const checked = objects.map(entry => {
    const key = String(entry?.key ?? '');
    const kind = kindOf(key);
    const hash = String(entry?.hash ?? '');
    if (!HASH.test(hash))
      throw new SyncError(400, `Invalid hash for ${key.slice(0, 80)}.`);
    if (!entry.body || typeof entry.body !== 'object') {
      throw new SyncError(400, `Object ${key.slice(0, 80)} has no content.`);
    }
    return { key, kind, hash, body: JSON.stringify(entry.body) };
  });
  store.transaction(() => {
    const upsert = store.db.prepare(
      `INSERT INTO staged_objects(key, kind, hash, body, updated_at) VALUES(?, ?, ?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET kind = excluded.kind, hash = excluded.hash,
         body = excluded.body, updated_at = excluded.updated_at`,
    );
    checked.forEach(entry =>
      upsert.run(entry.key, entry.kind, entry.hash, entry.body, now),
    );
  });
  return { stored: checked.length };
}

export function commit(
  store: Store,
  body: any,
  deviceId: string,
  now: number,
): { deleted: number; missing: string[] } {
  checkProtocol(body);
  const manifest = readManifest(body.manifest);
  const scope = readServerScope(body.scope);
  return store.transaction(() => {
    const stored = storedHashes(store);
    const missing: string[] = [];
    manifest.forEach((hash, key) => {
      if (stored.get(key) !== hash) missing.push(key);
    });
    if (missing.length) return { deleted: 0, missing };
    const remove = store.db.prepare('DELETE FROM objects WHERE key = ?');
    let deleted = 0;
    (
      store.db.prepare('SELECT key FROM objects').all() as { key: string }[]
    ).forEach(({ key }) => {
      if (!manifest.has(key)) {
        remove.run(key);
        deleted++;
      }
    });
    const promote = store.db
      .prepare(`INSERT INTO objects(key, kind, hash, body, updated_at)
      SELECT key, kind, hash, body, updated_at FROM staged_objects WHERE key = ? AND hash = ?
      ON CONFLICT(key) DO UPDATE SET kind=excluded.kind, hash=excluded.hash, body=excluded.body, updated_at=excluded.updated_at`);
    manifest.forEach((hash, key) => promote.run(key, hash));
    store.db.prepare('DELETE FROM staged_objects').run();
    store.setMeta('scope', JSON.stringify(scope));
    store.setMeta('lastCommitAt', String(now));
    if (!missing.length) store.setMeta('lastCompleteAt', String(now));
    store.db
      .prepare(
        'UPDATE devices SET last_sync_at = ?, app_protocol = ? WHERE id = ?',
      )
      .run(now, SERVER_SYNC_PROTOCOL, deviceId);
    store.bumpRevision();
    rebuildDerived(store);
    return { deleted, missing };
  });
}

/**
 * Deletes the copy on the server and disconnects the phone. Otherwise the phone
 * would send everything again at the next sync; reconnecting is a deliberate act.
 */
export function deleteCopy(store: Store) {
  store.transaction(() => {
    store.db.prepare('DELETE FROM objects').run();
    store.db.prepare('DELETE FROM staged_objects').run();
    store.db.prepare('DELETE FROM devices').run();
    ['scope', 'lastCommitAt', 'lastCompleteAt'].forEach(key =>
      store.setMeta(key, null),
    );
    store.bumpRevision();
    rebuildDerived(store);
  });
}
