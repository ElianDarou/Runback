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

describe('Website and API', () => {
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

  it('redirects to sign-in without a session and rejects wrong passwords', async () => {
    const response = await fetch(`${app.base}/statistics`, {
      redirect: 'manual',
    });
    assert.equal(response.status, 303);
    assert.equal(
      response.headers.get('location'),
      '/sign-in?next=%2Fstatistics',
    );
    const wrong = await fetch(`${app.base}/sign-in`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: 'password=wrong',
      redirect: 'manual',
    });
    assert.equal(wrong.status, 401);
  });

  it('shows history, workouts, statistics and coach from the phone data', async () => {
    const history = await (await page('/history')).text();
    assert.match(history, /<h1 class="title">Verlauf<\/h1>/);
    assert.match(history, /href="\/run\/r1"/);
    assert.match(history, /href="\/strength\/s1"/);
    assert.match(history, /5,02 km/);

    const run = await (await page('/run/r1')).text();
    assert.match(run, /Beine 8 · Atmung 9/);
    assert.match(run, /<svg\s+class="chart"/);
    assert.match(run, /Kilometer/);

    const strength = await (await page('/strength/s1')).text();
    assert.match(strength, /Bankdrücken/);
    assert.match(strength, /60 kg × 8/);
    assert.match(strength, /Aufwärmen/);

    const statistics = await (
      await page('/statistics?bereich=kraft&zeitraum=4w')
    ).text();
    assert.match(statistics, /Wochen mit Krafttraining/);
    const runStatistics = await (
      await page('/statistics?zeitraum=4w&kennzahl=pace')
    ).text();
    assert.match(runStatistics, /Wochen mit Lauf/);

    const coach = await (await page('/coach')).text();
    assert.match(coach, /Starte die ersten 2 km ruhiger\./);
    assert.match(coach, /5 km unter 22 Minuten · bis 01\.12\.2026/);
    assert.match(coach, /Schneller werden/);

    assert.equal((await page('/run/gibt-es-nicht')).status, 404);
  });

  it('shows only saved plans and templates and reads them via the API', async () => {
    const { objects } = await import('./helpers');
    const schedule = {
      version: 1,
      sessions: [
        {
          id: 'p1',
          date: '2026-10-08',
          title: 'Upper body',
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
            name: 'Upper body',
            exercises: [
              { exerciseId: 'barbell_bench_press', sets: [{ reps: 8 }] },
            ],
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

  it('escapes text from the data', async () => {
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
    const history = await (await page('/history')).text();
    assert.ok(!history.includes('<script>alert(1)</script>'));
    assert.match(history, /&lt;script&gt;/);
    await again(app.base, phone);
  });

  it('requires the CSRF field for every action', async () => {
    const response = await submit('/data/token', { name: 'x' }, 'wrong');
    assert.equal(response.status, 403);
  });

  it('creates read tokens that may read but not upload', async () => {
    const created = await (
      await submit('/data/token', { name: 'Grafana' })
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

  it('runs read-only SQL queries and blocks everything else', async () => {
    const token = createReadToken(store, 'Script', NOW);
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

    const form = await submit('/data/sql', {
      sql: 'SELECT count(*) AS n FROM v1_strength_sets',
    });
    assert.match(await form.text(), /1 Zeile/);
    const csv = await submit('/data/sql', {
      sql: 'SELECT id FROM v1_runs ORDER BY id',
      format: 'csv',
    });
    assert.equal(await csv.text(), 'id\nr1\nr2\n');
  });

  it('exports views and the database without credentials', async () => {
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

  it('describes itself', async () => {
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

describe('SQL check', () => {
  it('allows exactly one read-only statement', () => {
    assert.equal(checkSql('SELECT 1'), null);
    assert.equal(checkSql('with x as (select 1) select * from x;'), null);
    assert.equal(checkSql("SELECT ';' AS semikolon"), null);
    assert.ok(checkSql('UPDATE runs SET id = 1'));
    assert.ok(checkSql('SELECT 1; SELECT 2'));
    assert.ok(checkSql('select load_extension("x")'));
    assert.ok(checkSql(''));
  });

  it('stops endless queries', async () => {
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
        /took longer than/,
      );
    } finally {
      dispose();
    }
  });
});
