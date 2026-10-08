import { DatabaseSync } from 'node:sqlite';

/**
 * The server's storage. `objects` is a copy of what the phone sends, key by key
 * and unchanged. Everything else is derived from it and may be rebuilt at any
 * time:
 *
 * - `runs`, `strength_sessions`, `strength_sets`, `wellness`,
 *   `recommendations` are flat tables for SQL and export.
 * - `v1_*` are the promised views. Internal tables may change with a migration;
 *   the views stay stable until there is a `v2_*`.
 *
 * Unknown values stay `NULL`, never `0`.
 */

export const SCHEMA_VERSION = 3;
/** Version of the flat tables; goes into every row of the views. */
export const DERIVED_VERSION = 'server-rows-v1';

const MIGRATIONS: string[] = [
  `
  CREATE TABLE meta(key TEXT PRIMARY KEY, value TEXT NOT NULL);
  CREATE TABLE objects(
    key TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    hash TEXT NOT NULL,
    body TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX objects_kind ON objects(kind);
  CREATE TABLE devices(
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    created_at INTEGER NOT NULL,
    last_seen_at INTEGER,
    last_sync_at INTEGER,
    app_protocol INTEGER
  );
  CREATE TABLE tokens(
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    created_at INTEGER NOT NULL,
    last_used_at INTEGER
  );
  CREATE TABLE sessions(
    id_hash TEXT PRIMARY KEY,
    csrf TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
  );
  CREATE TABLE pairing(
    code_hash TEXT PRIMARY KEY,
    expires_at INTEGER NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE runs(
    id TEXT PRIMARY KEY,
    sport TEXT NOT NULL,
    purpose TEXT NOT NULL,
    name TEXT,
    start_ms INTEGER NOT NULL,
    end_ms INTEGER,
    duration_s REAL,
    moving_s REAL,
    distance_m REAL,
    avg_heart_rate REAL,
    avg_cadence REAL,
    elevation_gain_m REAL,
    rpe_legs REAL,
    rpe_breathing REAL,
    source TEXT NOT NULL,
    model_version TEXT
  );
  CREATE TABLE strength_sessions(
    id TEXT PRIMARY KEY,
    name TEXT,
    start_ms INTEGER NOT NULL,
    end_ms INTEGER,
    duration_s REAL,
    status TEXT NOT NULL,
    source TEXT NOT NULL,
    completed_sets INTEGER NOT NULL,
    avg_heart_rate REAL,
    max_heart_rate REAL,
    model_version TEXT
  );
  CREATE TABLE strength_sets(
    session_id TEXT NOT NULL,
    exercise_index INTEGER NOT NULL,
    exercise_id TEXT NOT NULL,
    exercise_name TEXT NOT NULL,
    set_index INTEGER NOT NULL,
    kind TEXT,
    completed INTEGER NOT NULL,
    skipped INTEGER NOT NULL,
    weight_kg REAL,
    reps INTEGER,
    seconds REAL,
    rir REAL,
    completed_ms INTEGER,
    PRIMARY KEY(session_id, exercise_index, set_index)
  );
  CREATE TABLE wellness(
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    time_ms INTEGER NOT NULL,
    end_ms INTEGER,
    value REAL,
    unit TEXT,
    source TEXT
  );
  CREATE TABLE recommendations(
    id TEXT PRIMARY KEY,
    area TEXT NOT NULL,
    kind TEXT NOT NULL,
    title TEXT NOT NULL,
    action TEXT NOT NULL,
    status TEXT NOT NULL,
    accepted_ms INTEGER NOT NULL,
    model_version TEXT
  );

  CREATE VIEW v1_runs AS SELECT
    id, sport, purpose, name,
    strftime('%Y-%m-%dT%H:%M:%fZ', start_ms / 1000.0, 'unixepoch') AS start_utc,
    CASE WHEN end_ms IS NULL THEN NULL
      ELSE strftime('%Y-%m-%dT%H:%M:%fZ', end_ms / 1000.0, 'unixepoch') END AS end_utc,
    duration_s, moving_s, distance_m,
    CASE WHEN distance_m >= 500 AND COALESCE(moving_s, duration_s) > 0
      THEN COALESCE(moving_s, duration_s) / (distance_m / 1000.0) END AS pace_s_per_km,
    avg_heart_rate, avg_cadence, elevation_gain_m, rpe_legs, rpe_breathing,
    source, model_version, '${DERIVED_VERSION}' AS row_version
  FROM runs;

  CREATE VIEW v1_strength_sessions AS SELECT
    id, name,
    strftime('%Y-%m-%dT%H:%M:%fZ', start_ms / 1000.0, 'unixepoch') AS start_utc,
    CASE WHEN end_ms IS NULL THEN NULL
      ELSE strftime('%Y-%m-%dT%H:%M:%fZ', end_ms / 1000.0, 'unixepoch') END AS end_utc,
    duration_s, status, source, completed_sets, avg_heart_rate, max_heart_rate,
    model_version, '${DERIVED_VERSION}' AS row_version
  FROM strength_sessions;

  CREATE VIEW v1_strength_sets AS SELECT
    s.session_id,
    strftime('%Y-%m-%dT%H:%M:%fZ', p.start_ms / 1000.0, 'unixepoch') AS session_start_utc,
    s.exercise_index, s.exercise_id, s.exercise_name, s.set_index, s.kind,
    s.completed, s.skipped, s.weight_kg, s.reps, s.seconds, s.rir,
    CASE WHEN s.completed_ms IS NULL THEN NULL
      ELSE strftime('%Y-%m-%dT%H:%M:%fZ', s.completed_ms / 1000.0, 'unixepoch') END AS completed_utc,
    '${DERIVED_VERSION}' AS row_version
  FROM strength_sets s JOIN strength_sessions p ON p.id = s.session_id;

  CREATE VIEW v1_wellness AS SELECT
    id, kind,
    strftime('%Y-%m-%dT%H:%M:%fZ', time_ms / 1000.0, 'unixepoch') AS time_utc,
    CASE WHEN end_ms IS NULL THEN NULL
      ELSE strftime('%Y-%m-%dT%H:%M:%fZ', end_ms / 1000.0, 'unixepoch') END AS end_utc,
    value, unit, source, '${DERIVED_VERSION}' AS row_version
  FROM wellness;

  CREATE VIEW v1_recommendations AS SELECT
    id, area, kind, title, action, status,
    strftime('%Y-%m-%dT%H:%M:%fZ', accepted_ms / 1000.0, 'unixepoch') AS accepted_utc,
    model_version, '${DERIVED_VERSION}' AS row_version
  FROM recommendations;
  `,
  `CREATE TABLE staged_objects(key TEXT PRIMARY KEY, kind TEXT NOT NULL, hash TEXT NOT NULL, body TEXT NOT NULL, updated_at INTEGER NOT NULL);`,
  `CREATE VIEW v1_documents AS SELECT key, kind, hash, body,
    strftime('%Y-%m-%dT%H:%M:%fZ', updated_at / 1000.0, 'unixepoch') AS updated_utc,
    '${DERIVED_VERSION}' AS row_version FROM objects;`,
];

/** Views that the API and the website offer as promised. */
export const PUBLIC_VIEWS = [
  'v1_runs',
  'v1_strength_sessions',
  'v1_strength_sets',
  'v1_wellness',
  'v1_recommendations',
  'v1_documents',
] as const;
export type PublicView = (typeof PUBLIC_VIEWS)[number];

export class Store {
  readonly db: DatabaseSync;
  readonly path: string;

  constructor(path: string) {
    this.path = path;
    this.db = new DatabaseSync(path);
    this.db.exec('PRAGMA journal_mode = WAL');
    this.db.exec('PRAGMA busy_timeout = 5000');
    this.db.exec('PRAGMA foreign_keys = ON');
    this.migrate();
  }

  private migrate() {
    const current = Number(
      (this.db.prepare('PRAGMA user_version').get() as { user_version: number })
        .user_version,
    );
    if (current > MIGRATIONS.length) {
      throw new Error(
        `The database comes from a newer server version (schema ${current}).`,
      );
    }
    for (let version = current; version < MIGRATIONS.length; version++) {
      this.transaction(() => {
        this.db.exec(MIGRATIONS[version]);
        this.db.exec(`PRAGMA user_version = ${version + 1}`);
      });
    }
  }

  transaction<T>(block: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = block();
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  meta(key: string): string | null {
    const row = this.db
      .prepare('SELECT value FROM meta WHERE key = ?')
      .get(key) as { value: string } | undefined;
    return row ? row.value : null;
  }

  setMeta(key: string, value: string | null) {
    if (value === null) {
      this.db.prepare('DELETE FROM meta WHERE key = ?').run(key);
    } else {
      this.db
        .prepare(
          'INSERT INTO meta(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
        )
        .run(key, value);
    }
  }

  /** Goes up with every change to `objects`; the website re-reads after that. */
  revision(): number {
    return Number(this.meta('revision') ?? '0');
  }

  bumpRevision() {
    this.setMeta('revision', String(this.revision() + 1));
  }

  close() {
    this.db.close();
  }
}
