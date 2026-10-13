import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { describe, it } from 'node:test';
import { MIGRATIONS, SCHEMA_VERSION, Store } from '../src/db';
import { rebuildDerived } from '../src/records';
import { kindOf } from '../src/sync';
import { NOW, bridgeRun, hash } from './helpers';

describe('Schema upgrade', () => {
  it('drops the recommendations of a populated schema 3 database and keeps the rest', () => {
    const dir = mkdtempSync(join(tmpdir(), 'runback-migration-'));
    const path = join(dir, 'runback.sqlite');
    try {
      const old = new DatabaseSync(path);
      MIGRATIONS.slice(0, 3).forEach(sql => old.exec(sql));
      old.exec('PRAGMA user_version = 3');
      const run = bridgeRun('r1', NOW);
      const settings = { goal: '10 km', experiments: [{ id: 'e1' }] };
      const insert = old.prepare(
        'INSERT INTO objects(key, kind, hash, body, updated_at) VALUES(?, ?, ?, ?, ?)',
      );
      insert.run('run/r1', kindOf('run/r1'), hash(run), JSON.stringify(run), NOW);
      insert.run(
        'settings',
        kindOf('settings'),
        hash(settings),
        JSON.stringify(settings),
        NOW,
      );
      old
        .prepare("INSERT INTO meta(key, value) VALUES('lastCommitAt', ?)")
        .run(String(NOW));
      old
        .prepare(
          "INSERT INTO devices(id, name, token_hash, created_at) VALUES('d1', 'Pixel', 'h1', ?)",
        )
        .run(NOW);
      old
        .prepare(
          "INSERT INTO recommendations(id, area, kind, title, action, status, accepted_ms) VALUES('x', 'running', 'k', 't', 'a', 'active', ?)",
        )
        .run(NOW);
      old.close();

      const store = new Store(path);
      const version = store.db.prepare('PRAGMA user_version').get() as {
        user_version: number;
      };
      assert.equal(version.user_version, SCHEMA_VERSION);
      assert.equal(
        store.db
          .prepare(
            "SELECT name FROM sqlite_master WHERE name IN ('recommendations', 'v1_recommendations')",
          )
          .all().length,
        0,
      );
      assert.equal(
        (store.db.prepare('SELECT COUNT(*) AS n FROM objects').get() as any).n,
        2,
      );
      assert.equal(store.meta('lastCommitAt'), String(NOW));
      assert.equal(
        (store.db.prepare("SELECT name FROM devices WHERE id = 'd1'").get() as any)
          .name,
        'Pixel',
      );
      rebuildDerived(store);
      assert.deepEqual(
        store.db
          .prepare('SELECT id FROM v1_runs')
          .all()
          .map((row: any) => row.id),
        ['r1'],
      );
      store.close();

      // Opening again runs no migration twice.
      new Store(path).close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
