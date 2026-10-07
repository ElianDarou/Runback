import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { createReadToken } from '../src/auth';
import { checkSql, runSql } from '../src/sql';
import {
  NOW,
  login,
  pair,
  post,
  startApp,
  syncAll,
  tempStore,
} from './helpers';

describe('Website und API', () => {
  const { store, dispose } = tempStore();
  let app: Awaited<ReturnType<typeof startApp>>;
  let session: { cookie: string; csrf: string };
  let phone = '';
  before(async () => {
    app = await startApp(store);
    phone = await pair(app.base, store);
    await syncAll(app.base, phone);
    session = await login(app.base);
  });
  after(async () => {
    await app.close();
    dispose();
  });

  const page = (path: string) =>
    fetch(`${app.base}${path}`, { headers: { cookie: session.cookie } });
  const submit = (
    path: string,
    fields: Record<string, string>,
    csrf = session.csrf,
  ) =>
    fetch(`${app.base}${path}`, {
      method: 'POST',
      headers: {
        cookie: session.cookie,
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ csrf, ...fields }).toString(),
      redirect: 'manual',
    });

  it('schickt ohne Anmeldung zur Anmeldung und lehnt falsche Passwörter ab', async () => {
    const response = await fetch(`${app.base}/statistik`, {
      redirect: 'manual',
    });
    assert.equal(response.status, 303);
    assert.equal(
      response.headers.get('location'),
      '/anmelden?weiter=%2Fstatistik',
    );
    const wrong = await fetch(`${app.base}/anmelden`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: 'password=falsch',
      redirect: 'manual',
    });
    assert.equal(wrong.status, 401);
  });

  it('zeigt Verlauf, Einheiten, Statistik und Coach mit den Daten des Telefons', async () => {
    const verlauf = await (await page('/verlauf')).text();
    assert.match(verlauf, /<h1 class="title">Verlauf<\/h1>/);
    assert.match(verlauf, /href="\/lauf\/r1"/);
    assert.match(verlauf, /href="\/kraft\/s1"/);
    assert.match(verlauf, /5,02 km/);

    const lauf = await (await page('/lauf/r1')).text();
    assert.match(lauf, /Beine 8 · Atmung 9/);
    assert.match(lauf, /<svg\s+class="chart"/);
    assert.match(lauf, /Kilometer/);

    const kraft = await (await page('/kraft/s1')).text();
    assert.match(kraft, /Bankdrücken/);
    assert.match(kraft, /60 kg × 8/);
    assert.match(kraft, /Aufwärmen/);

    const statistik = await (
      await page('/statistik?bereich=kraft&zeitraum=4w')
    ).text();
    assert.match(statistik, /Wochen mit Krafttraining/);
    const laufStatistik = await (
      await page('/statistik?zeitraum=4w&kennzahl=pace')
    ).text();
    assert.match(laufStatistik, /Wochen mit Lauf/);

    const coach = await (await page('/coach')).text();
    assert.match(coach, /Starte die ersten 2 km ruhiger\./);
    assert.match(coach, /5 km unter 22 Minuten · bis 01\.12\.2026/);
    assert.match(coach, /Schneller werden/);

    assert.equal((await page('/lauf/gibt-es-nicht')).status, 404);
  });

  it('zeigt nur gespeicherte Pläne und Vorlagen und liest sie per API', async () => {
    const { objects } = await import('./helpers');
    const schedule = {
      version: 1,
      sessions: [
        {
          id: 'p1',
          date: '2026-10-08',
          title: 'Oberkörper',
          kind: 'strength',
          minutes: 45,
          status: 'planned',
        },
      ],
      availability: {},
      routine: { days: [], minutes: 30 },
    };
    const list = objects().map(entry =>
      entry.key === 'settings'
        ? { ...entry, body: { ...(entry.body as any), schedule } }
        : entry,
    );
    list.push({
      key: 'templates',
      body: {
        templates: [
          {
            name: 'Oberkörper',
            exercises: [{ exerciseId: 'barbell_bench_press', sets: [{ reps: 8 }] }],
          },
        ],
      },
    });
    await syncAll(app.base, phone, list);
    const plan = await (await page('/plan')).text();
    assert.match(plan, /45 Minuten/);
    assert.match(plan, /Bankdrücken/);
    const result = (await (await page('/api/v1/plan')).json()) as any;
    assert.equal(result.schedule.sessions[0].id, 'p1');
    assert.equal(result.templates.length, 1);
    await syncAll(app.base, phone);
  });

  it('maskiert Text aus den Daten', async () => {
    const { syncAll: again, objects } = await import('./helpers');
    const list = objects().map(entry =>
      entry.key === 'strength/s1'
        ? {
            ...entry,
            body: {
              ...(entry.body as object),
              name: '<script>alert(1)</script>',
            },
          }
        : entry,
    );
    await again(app.base, phone, list);
    const verlauf = await (await page('/verlauf')).text();
    assert.ok(!verlauf.includes('<script>alert(1)</script>'));
    assert.match(verlauf, /&lt;script&gt;/);
    await again(app.base, phone);
  });

  it('verlangt das CSRF-Feld für jede Aktion', async () => {
    const response = await submit('/daten/token', { name: 'x' }, 'falsch');
    assert.equal(response.status, 403);
  });

  it('erstellt Lese-Tokens, die lesen, aber nicht übertragen dürfen', async () => {
    const created = await (
      await submit('/daten/token', { name: 'Grafana' })
    ).text();
    const token = /class="secret">(rbr_[^<]+)</.exec(created)?.[1];
    assert.ok(token);

    const runs = await fetch(`${app.base}/api/v1/runs?sport=running&limit=1`, {
      headers: { authorization: `Bearer ${token}` },
    });
    const body = (await runs.json()) as any;
    assert.equal(body.total, 2);
    assert.equal(body.items.length, 1);
    assert.equal(body.items[0].id, 'r2');

    const detail = (await (
      await fetch(`${app.base}/api/v1/runs/r1`, {
        headers: { authorization: `Bearer ${token}` },
      })
    ).json()) as any;
    assert.equal(detail.run.id, 'r1');
    assert.equal(detail.series.rows.length, 40);
    assert.equal(detail.route, null);

    const stats = (await (
      await fetch(`${app.base}/api/v1/stats/running?range=4w`, {
        headers: { authorization: `Bearer ${token}` },
      })
    ).json()) as any;
    assert.equal(stats.totals.runCount, 2);
    assert.equal(stats.runs, undefined);

    const upload = await post(app.base, '/api/v1/sync/plan', token!, {
      protocol: 1,
      manifest: {},
    });
    assert.equal(upload.status, 403);
    assert.equal((await fetch(`${app.base}/api/v1/runs`)).status, 401);
  });

  it('führt lesende SQL-Abfragen aus und sperrt alles andere', async () => {
    const token = createReadToken(store, 'Skript', NOW);
    const ok = await post(app.base, '/api/v1/sql', token, {
      sql: 'SELECT id, distance_m FROM v1_runs ORDER BY start_utc',
    });
    assert.equal(ok.status, 200);
    assert.deepEqual(ok.body.columns, ['id', 'distance_m']);
    assert.deepEqual(ok.body.rows, [
      ['r1', 5020],
      ['r2', 5020],
    ]);

    for (const sql of [
      'DELETE FROM runs',
      'SELECT 1; DELETE FROM runs',
      "ATTACH '/tmp/x' AS x",
      'PRAGMA user_version',
      'SELECT * FROM meta',
      'SELECT * FROM devices',
      'SELECT * FROM tokens',
      'SELECT * FROM objects',
      'SELECT * FROM staged_objects',
      'WITH v1_runs AS (SELECT value FROM meta) SELECT * FROM v1_runs',
      'WITH v1_documents AS (SELECT * FROM tokens) SELECT * FROM v1_documents',
      'SELECT * FROM sqlite_master',
      'SELECT value FROM meta WHERE key IN (SELECT id FROM v1_runs)',
      "SELECT * FROM pragma_table_info('devices')",
    ]) {
      const blocked = await post(app.base, '/api/v1/sql', token, { sql });
      assert.equal(blocked.status, 400, sql);
    }

    const documents = await post(app.base, '/api/v1/sql', token, {
      sql: `SELECT json_extract(body, '$.goal') AS goal FROM v1_documents WHERE key = 'settings'`,
    });
    assert.equal(documents.status, 200);
    assert.equal(documents.body.rows[0][0], '5 km unter 22 Minuten');
    const regions = await post(app.base, '/api/v1/sql', token, {
      sql: `SELECT value FROM json_each('[1,2]')`,
    });
    assert.equal(regions.status, 200);
    assert.deepEqual(regions.body.rows, [[1], [2]]);

    const form = await submit('/daten/sql', {
      sql: 'SELECT count(*) AS n FROM v1_strength_sets',
    });
    assert.match(await form.text(), /1 Zeile/);
    const csv = await submit('/daten/sql', {
      sql: 'SELECT id FROM v1_runs ORDER BY id',
      format: 'csv',
    });
    assert.equal(await csv.text(), 'id\nr1\nr2\n');
  });

  it('exportiert Sichten und die Datenbank ohne Zugangsdaten', async () => {
    const csv = await (await page('/api/v1/export/v1_runs.csv')).text();
    assert.match(csv, /^id,sport,purpose/);
    const jsonl = (
      await (await page('/api/v1/export/v1_recommendations.jsonl')).text()
    )
      .trim()
      .split('\n');
    assert.equal(JSON.parse(jsonl[0]).status, 'active');
    assert.equal((await page('/api/v1/export/objects.csv')).status, 404);

    const file = Buffer.from(
      await (await page('/api/v1/export/runback.sqlite')).arrayBuffer(),
    );
    const dir = mkdtempSync(join(tmpdir(), 'runback-export-test-'));
    try {
      writeFileSync(join(dir, 'x.sqlite'), file);
      const copy = new DatabaseSync(join(dir, 'x.sqlite'));
      assert.equal(
        (
          copy.prepare('SELECT count(*) AS n FROM v1_runs').get() as {
            n: number;
          }
        ).n,
        2,
      );
      assert.equal(
        copy.prepare("SELECT value FROM meta WHERE key = 'password'").get(),
        undefined,
      );
      assert.equal(
        (
          copy.prepare('SELECT count(*) AS n FROM devices').get() as {
            n: number;
          }
        ).n,
        0,
      );
      copy.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('beschreibt sich selbst', async () => {
    const hello = (await (
      await fetch(`${app.base}/api/v1/hello`)
    ).json()) as any;
    assert.deepEqual(hello, {
      app: 'runback-server',
      version: 'test',
      protocol: [1],
      paired: true,
    });
    const spec = (await (
      await fetch(`${app.base}/api/v1/openapi.json`)
    ).json()) as any;
    assert.equal(spec.openapi, '3.1.0');
    assert.ok(spec.paths['/runs']);
  });
});

describe('SQL-Prüfung', () => {
  it('lässt genau eine lesende Anweisung zu', () => {
    assert.equal(checkSql('SELECT 1'), null);
    assert.equal(checkSql('with x as (select 1) select * from x;'), null);
    assert.equal(checkSql("SELECT ';' AS semikolon"), null);
    assert.ok(checkSql('UPDATE runs SET id = 1'));
    assert.ok(checkSql('SELECT 1; SELECT 2'));
    assert.ok(checkSql('select load_extension("x")'));
    assert.ok(checkSql(''));
  });

  it('bricht endlose Abfragen ab', async () => {
    const { store, dispose } = tempStore();
    try {
      await assert.rejects(
        runSql(
          store.path,
          'WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n) SELECT count(*) FROM n',
          {
            timeoutMs: 300,
          },
        ),
        /länger als/,
      );
    } finally {
      dispose();
    }
  });
});
