import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { requestLanguage, translator } from '../src/web/i18n';
import { login, pair, startApp, syncAll, tempStore } from './helpers';

describe('Language per request', () => {
  const url = (path: string) => new URL(`http://localhost${path}`);

  it('picks German when nothing else is asked for', () => {
    assert.deepEqual(requestLanguage(url('/history'), undefined), {
      lang: 'de',
      explicit: false,
    });
    assert.deepEqual(requestLanguage(url('/history'), 'fr, it;q=0.8'), {
      lang: 'de',
      explicit: false,
    });
  });

  it('reads Accept-Language by weight and skips unknown languages', () => {
    assert.equal(requestLanguage(url('/'), 'en-GB,en;q=0.9').lang, 'en');
    assert.equal(
      requestLanguage(url('/'), 'de-DE,de;q=0.9,en;q=0.8').lang,
      'de',
    );
    assert.equal(requestLanguage(url('/'), 'fr, en;q=0.5').lang, 'en');
    assert.equal(requestLanguage(url('/'), 'en;q=0, de').lang, 'de');
    assert.equal(requestLanguage(url('/'), 'en;q=0.5, de;q=0.9').lang, 'de');
  });

  it('prefers ?lang= over the browser and marks it as explicit', () => {
    assert.deepEqual(requestLanguage(url('/?lang=en'), 'de'), {
      lang: 'en',
      explicit: true,
    });
    assert.deepEqual(requestLanguage(url('/?lang=de'), 'en'), {
      lang: 'de',
      explicit: true,
    });
    assert.deepEqual(requestLanguage(url('/?lang=fr'), 'en'), {
      lang: 'en',
      explicit: false,
    });
  });

  it('adds lang to links only when it was chosen explicitly', () => {
    assert.equal(translator('en').link('/history'), '/history');
    assert.equal(
      translator('en', true).link('/statistics', { bereich: 'kraft' }),
      '/statistics?bereich=kraft&lang=en',
    );
    assert.equal(
      translator('de', true).withLang('/data?sql=SELECT%201'),
      '/data?sql=SELECT%201&lang=de',
    );
  });
});

describe('Website in English and German', () => {
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

  const get = (path: string, headers: Record<string, string> = {}) =>
    fetch(`${app.base}${path}`, {
      headers: { cookie: session.cookie, ...headers },
      redirect: 'manual',
    });
  const text = async (path: string, headers?: Record<string, string>) =>
    (await get(path, headers)).text();

  it('serves English for Accept-Language: en', async () => {
    const page = await text('/history', { 'accept-language': 'en' });
    assert.match(page, /<html lang="en">/);
    assert.match(page, /<title>History · Runback<\/title>/);
    assert.match(page, /<h1 class="title">History<\/h1>/);
    assert.match(page, /Last week/);
    assert.match(page, /5\.02 km/);
    assert.match(page, /Avg 112 bpm/);
    assert.doesNotMatch(page, /Verlauf/);
  });

  it('builds domain text in the request language', async () => {
    const [english, german] = await Promise.all([
      text('/statistics?bereich=kraft&lang=en'),
      text('/statistics?bereich=kraft&lang=de'),
    ]);
    const visible = (page: string) =>
      page.replace(/<style[\s\S]*?<\/style>/g, '').replace(/<[^>]+>/g, ' ');
    assert.doesNotMatch(visible(english), /Sätze|Noch nicht klar|Woche /);
    assert.match(visible(german), /Sätze|Satz/);
  });

  it('serves English for ?lang=en, even with a German browser', async () => {
    const page = await text('/statistics?lang=en', {
      'accept-language': 'de-DE,de;q=0.9',
    });
    assert.match(page, /<html lang="en">/);
    assert.match(page, /<h1 class="title">Statistics<\/h1>/);
    assert.match(page, /Distance · km/);
    assert.match(page, /Time range/);
    assert.match(page, /10\.0/);
  });

  it('stays German for ?lang=de, even with an English browser', async () => {
    const page = await text('/history?lang=de', { 'accept-language': 'en' });
    assert.match(page, /<html lang="de">/);
    assert.match(page, /<h1 class="title">Verlauf<\/h1>/);
    assert.match(page, /5,02 km/);
  });

  it('serves concurrent requests in both languages correctly', async () => {
    const [english, german] = await Promise.all([
      text('/coach?lang=en'),
      text('/coach?lang=de'),
      text('/plan', { 'accept-language': 'en' }),
      text('/plan', { 'accept-language': 'de' }),
    ]);
    assert.match(english, /<h1 class="title">Coach<\/h1>/);
    assert.match(english, /How a recommendation comes about/);
    assert.match(german, /<html lang="de">/);
    assert.match(german, /So entsteht eine Empfehlung/);
  });

  it('carries an explicitly chosen language into links', async () => {
    const page = await text('/history?lang=en');
    assert.match(page, /href="\/statistics\?lang=en"/);
    assert.match(page, /href="\/data\?lang=en"/);
    const german = await text('/history');
    assert.doesNotMatch(german, /href="[^"]*lang=/);
  });

  it('translates forms and carries the language through the action', async () => {
    const page = await text('/data?lang=en');
    assert.match(page, /action="\/data\/token\?lang=en"/);
    assert.match(page, /Create read token/);
    const failed = await fetch(`${app.base}/data/sql?lang=en`, {
      method: 'POST',
      headers: {
        cookie: session.cookie,
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        csrf: session.csrf,
        sql: 'DELETE FROM runs',
      }).toString(),
    });
    assert.equal(failed.status, 400);
    const body = await failed.text();
    assert.match(body, /Query failed/);
    assert.match(body, /Only queries that start with SELECT or WITH/);
  });

  it('translates sign-in and error pages', async () => {
    const signIn = await text('/sign-in?lang=en');
    assert.match(signIn, /<h1 class="title">Sign in<\/h1>/);
    const wrong = await fetch(`${app.base}/sign-in?lang=en`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: 'password=wrong',
      redirect: 'manual',
    });
    assert.equal(wrong.status, 401);
    assert.match(await wrong.text(), /The password is wrong\./);
    const missing = await get('/run/gibt-es-nicht', {
      'accept-language': 'en',
    });
    assert.equal(missing.status, 404);
    assert.match(await missing.text(), /Go to history/);
  });

  it('redirects to sign-in without a session and keeps the language', async () => {
    const response = await fetch(`${app.base}/history?lang=en`, {
      redirect: 'manual',
    });
    assert.equal(response.status, 303);
    assert.equal(
      response.headers.get('location'),
      `/sign-in?next=${encodeURIComponent('/history?lang=en')}&lang=en`,
    );
  });
});

describe('Old German addresses', () => {
  const { store, dispose } = tempStore();
  let app: Awaited<ReturnType<typeof startApp>>;
  let session: { cookie: string; csrf: string };

  before(async () => {
    app = await startApp(store);
    const phone = await pair(app.base, store);
    await syncAll(app.base, phone);
    session = await login(app.base);
  });
  after(async () => {
    await app.close();
    dispose();
  });

  const redirectOf = async (path: string) => {
    const response = await fetch(`${app.base}${path}`, {
      headers: { cookie: session.cookie },
      redirect: 'manual',
    });
    return {
      status: response.status,
      location: response.headers.get('location'),
    };
  };

  it('permanently redirects old page addresses and keeps the query', async () => {
    assert.deepEqual(await redirectOf('/verlauf?bereich=kraft'), {
      status: 301,
      location: '/history?bereich=kraft',
    });
    assert.deepEqual(await redirectOf('/statistik?zeitraum=4w'), {
      status: 301,
      location: '/statistics?zeitraum=4w',
    });
    assert.deepEqual(await redirectOf('/daten?sql=SELECT%201'), {
      status: 301,
      location: '/data?sql=SELECT%201',
    });
    assert.deepEqual(await redirectOf('/lauf/r1?wert=pace'), {
      status: 301,
      location: '/run/r1?wert=pace',
    });
    assert.deepEqual(await redirectOf('/kraft/s1'), {
      status: 301,
      location: '/strength/s1',
    });
    assert.deepEqual(await redirectOf('/verlauf?lang=en'), {
      status: 301,
      location: '/history?lang=en',
    });
    assert.deepEqual(await redirectOf('/anmelden'), {
      status: 301,
      location: '/sign-in',
    });
  });

  it('still accepts old form addresses', async () => {
    const token = await fetch(`${app.base}/daten/token`, {
      method: 'POST',
      headers: {
        cookie: session.cookie,
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        csrf: session.csrf,
        name: 'Alt',
      }).toString(),
    });
    assert.equal(token.status, 200);
    assert.match(await token.text(), /class="secret">rbr_/);
  });
});
