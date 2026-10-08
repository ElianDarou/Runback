import type { IncomingMessage, ServerResponse } from 'node:http';
import { SERVER_SYNC_PROTOCOL } from '../../src/domain/serverLink';
import { ApiError, apiRead, exportDatabase, exportView, writeCsv } from './api';
import {
  Throttle,
  bearerPrincipal,
  changePassword,
  checkPassword,
  createPairingCode,
  createReadToken,
  createSession,
  endSession,
  redeemPairingCode,
  removeDevice,
  revokeReadToken,
  sessionPrincipal,
  type Principal,
  type Scope,
} from './auth';
import type { Store } from './db';
import { openApi } from './openapi';
import { loadDataset } from './records';
import { SqlError, runSql } from './sql';
import { SyncError, commit, deleteCopy, plan, receive } from './sync';
import { planPage } from './web/plan';
import { coachPage } from './web/coach';
import type { PageContext } from './web/context';
import { dataPage, loginPage, notFoundPage, type DataState } from './web/data';
import { runPage, strengthPage } from './web/session';
import type { Html } from './web/html';
import { historyPage } from './web/history';
import { AsyncLocalStorage } from 'node:async_hooks';
import { setLanguageSource } from '../../src/domain/i18n';
import { requestLanguage, translator, type Lang, type Translator } from './web/i18n';

// Domain modules build text in "the" language; on the server that is the
// language of the request being handled, kept apart per async context.
const requestLang = new AsyncLocalStorage<Lang>();
setLanguageSource(() => requestLang.getStore());
import { statisticsPage } from './web/statistics';
import { STYLESHEET } from './web/style';

export interface AppConfig {
  version: string;
  /** Behind a reverse proxy: trust X-Forwarded-For and X-Forwarded-Proto. */
  trustProxy: boolean;
  now?: () => number;
}

const SESSION_COOKIE = 'runback_session';
const SMALL_BODY = 1024 * 1024;
const SYNC_BODY = 48 * 1024 * 1024;

const FAVICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="8" fill="#101210"/><path d="M11 24 21 8" stroke="#A5D879" stroke-width="4" stroke-linecap="round"/></svg>`;

/**
 * Website paths that used to be German. Old links and forms keep working:
 * GET requests are redirected to the new path, POST requests are routed to it.
 */
const RENAMED_PATHS: [legacy: string, current: string][] = [
  ['/verlauf', '/history'],
  ['/statistik', '/statistics'],
  ['/daten', '/data'],
  ['/anmelden', '/sign-in'],
  ['/abmelden', '/sign-out'],
  ['/lauf', '/run'],
  ['/kraft', '/strength'],
];
/** Segments of the data page's actions that were German. */
const RENAMED_ACTIONS: Record<string, string> = {
  kopplung: 'pairing',
  passwort: 'password',
  loeschen: 'delete',
  geraet: 'device',
  trennen: 'disconnect',
};

export function canonicalPath(pathname: string): string {
  for (const [legacy, current] of RENAMED_PATHS) {
    if (pathname !== legacy && !pathname.startsWith(`${legacy}/`)) continue;
    const rest = pathname.slice(legacy.length);
    if (current !== '/data') return current + rest;
    return (
      current +
      rest
        .split('/')
        .map(segment => RENAMED_ACTIONS[segment] ?? segment)
        .join('/')
    );
  }
  return pathname;
}

class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

function securityHeaders(res: ServerResponse) {
  res.setHeader('x-content-type-options', 'nosniff');
  res.setHeader('x-frame-options', 'DENY');
  res.setHeader('referrer-policy', 'no-referrer');
  res.setHeader(
    'content-security-policy',
    "default-src 'none'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
  );
  res.setHeader('cache-control', 'no-store');
}

function sendJson(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

function sendHtml(res: ServerResponse, status: number, body: Html) {
  res.writeHead(status, { 'content-type': 'text/html; charset=utf-8' });
  res.end(body.value);
}

function redirect(
  res: ServerResponse,
  location: string,
  cookies: string[] = [],
  status = 303,
) {
  if (cookies.length) res.setHeader('set-cookie', cookies);
  res.writeHead(status, { location });
  res.end();
}

async function readBody(req: IncomingMessage, limit: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > limit) throw new HttpError(413, 'The request is too large.');
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks);
}

async function readJson(
  req: IncomingMessage,
  limit = SMALL_BODY,
): Promise<any> {
  const body = await readBody(req, limit);
  try {
    return JSON.parse(body.toString('utf8') || '{}');
  } catch {
    throw new HttpError(400, 'Invalid JSON.');
  }
}

async function readForm(req: IncomingMessage): Promise<URLSearchParams> {
  return new URLSearchParams(
    (await readBody(req, SMALL_BODY)).toString('utf8'),
  );
}

function cookies(req: IncomingMessage): Record<string, string> {
  const result: Record<string, string> = {};
  (req.headers.cookie ?? '').split(';').forEach(part => {
    const index = part.indexOf('=');
    if (index > 0)
      result[part.slice(0, index).trim()] = decodeURIComponent(
        part.slice(index + 1).trim(),
      );
  });
  return result;
}

/** Only relative targets within the website; anything else goes to history. */
function safeNext(value: string | null): string {
  if (!value || !/^\/(?!\/)[^\s\\]*$/.test(value) || value.startsWith('/api/'))
    return '/history';
  const cut = value.search(/[?#]/);
  if (cut < 0) return canonicalPath(value);
  return canonicalPath(value.slice(0, cut)) + value.slice(cut);
}

/** Text for a failed query, in the visitor's language. */
function sqlMessage(error: unknown, tx: Translator): string {
  return error instanceof SqlError
    ? tx.t(error.text.de, error.text.en)
    : (error as Error).message;
}

export function createApp(store: Store, config: AppConfig) {
  const now = config.now ?? Date.now;
  const loginThrottle = new Throttle(10);
  const pairThrottle = new Throttle(20);

  const clientIp = (req: IncomingMessage) =>
    (config.trustProxy
      ? String(req.headers['x-forwarded-for'] ?? '')
          .split(',')[0]
          .trim()
      : '') ||
    req.socket.remoteAddress ||
    'unknown';
  const isSecure = (req: IncomingMessage) =>
    (req.socket as any).encrypted === true ||
    (config.trustProxy &&
      String(req.headers['x-forwarded-proto'] ?? '')
        .split(',')[0]
        .trim() === 'https');
  const sessionCookie = (req: IncomingMessage, value: string, maxAge: number) =>
    `${SESSION_COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${
      isSecure(req) ? '; Secure' : ''
    }`;

  function principal(req: IncomingMessage): Principal | null {
    const auth = req.headers.authorization;
    if (auth?.startsWith('Bearer '))
      return bearerPrincipal(store, auth.slice(7).trim(), now());
    const cookie = cookies(req)[SESSION_COOKIE];
    return cookie ? sessionPrincipal(store, cookie, now()) : null;
  }

  function need(who: Principal | null, scope: Scope): Principal {
    if (!who) throw new HttpError(401, 'Sign-in is missing or has expired.');
    if (!who.scopes.includes(scope))
      throw new HttpError(403, 'This access may not do that.');
    return who;
  }

  /** Forms on the website: same origin and a matching CSRF field. */
  function checkForm(
    req: IncomingMessage,
    who: Principal,
    form: URLSearchParams,
    tx: Translator,
  ) {
    const origin = req.headers.origin;
    if (origin && origin !== 'null') {
      let host = '';
      try {
        host = new URL(origin).host;
      } catch {
        host = '';
      }
      if (host !== req.headers.host)
        throw new HttpError(
          403,
          tx.t(
            'Anfrage von einer fremden Seite.',
            'Request from another site.',
          ),
        );
    }
    if (!who.csrf || form.get('csrf') !== who.csrf) {
      throw new HttpError(
        403,
        tx.t(
          'Die Seite war zu lange offen. Lade sie neu.',
          'The page was open too long. Reload it.',
        ),
      );
    }
  }

  function context(url: URL, who: Principal, tx: Translator): PageContext {
    return {
      store,
      data: loadDataset(store),
      now: now(),
      url,
      csrf: who.csrf ?? '',
      tx,
    };
  }

  async function handleApi(
    req: IncomingMessage,
    res: ServerResponse,
    url: URL,
    path: string,
  ) {
    const method = req.method ?? 'GET';
    if (method === 'GET' && path === '/hello') {
      const paired =
        (
          store.db.prepare('SELECT count(*) AS n FROM devices').get() as {
            n: number;
          }
        ).n > 0;
      return sendJson(res, 200, {
        app: 'runback-server',
        version: config.version,
        protocol: [SERVER_SYNC_PROTOCOL],
        paired,
      });
    }
    if (method === 'GET' && path === '/openapi.json')
      return sendJson(res, 200, openApi(config.version));
    if (method === 'POST' && path === '/pair') {
      const ip = clientIp(req);
      if (pairThrottle.blocked(ip, now()))
        throw new HttpError(429, 'Too many attempts. Wait fifteen minutes.');
      const body = await readJson(req);
      if (body?.protocol !== SERVER_SYNC_PROTOCOL) {
        throw new HttpError(
          409,
          'The app and the server speak different versions. Update the server or the app.',
        );
      }
      const result = redeemPairingCode(
        store,
        String(body?.code ?? ''),
        // Default device name, stored as given.
        String(body?.deviceName ?? 'Telefon'),
        body.protocol,
        now(),
      );
      if (!result) {
        pairThrottle.fail(ip, now());
        throw new HttpError(
          403,
          'The code is wrong or has expired. Create a new one on the website.',
        );
      }
      return sendJson(res, 200, {
        token: result.token,
        serverVersion: config.version,
        protocol: SERVER_SYNC_PROTOCOL,
      });
    }

    const who = principal(req);
    if (path.startsWith('/sync/')) {
      const device = need(who, 'ingest');
      if (method !== 'POST') throw new HttpError(405, 'Only POST.');
      const body = await readJson(
        req,
        path === '/sync/objects' ? SYNC_BODY : SYNC_BODY / 2,
      );
      if (path === '/sync/plan') return sendJson(res, 200, plan(store, body));
      if (path === '/sync/objects')
        return sendJson(res, 200, receive(store, body, now()));
      if (path === '/sync/commit') {
        return sendJson(res, 200, {
          ...commit(store, body, device.id, now()),
          serverVersion: config.version,
        });
      }
      throw new HttpError(404, 'Unknown endpoint.');
    }
    if (path === '/device' && method === 'DELETE') {
      const device = need(who, 'ingest');
      if (device.kind !== 'device')
        throw new HttpError(403, 'Only the phone can disconnect.');
      if (url.searchParams.get('copy') === 'delete') deleteCopy(store);
      else removeDevice(store, device.id);
      return sendJson(res, 200, { ok: true });
    }
    if (path === '/sql' && method === 'POST') {
      const caller = need(who, 'read');
      if (caller.kind === 'session')
        throw new HttpError(403, 'Use the “Data” page in the browser.');
      const body = await readJson(req);
      try {
        return sendJson(
          res,
          200,
          await runSql(store.path, String(body?.sql ?? '')),
        );
      } catch (error) {
        throw new HttpError(400, (error as Error).message);
      }
    }
    if (method !== 'GET') throw new HttpError(405, 'Only GET.');
    need(who, 'read');
    if (path === '/export/runback.sqlite') return exportDatabase(store, res);
    if (path.startsWith('/export/'))
      return exportView(store, res, path.slice('/export/'.length));
    return sendJson(res, 200, apiRead(store, path, url, now()));
  }

  async function handleWebPost(
    req: IncomingMessage,
    res: ServerResponse,
    url: URL,
    path: string,
    who: Principal,
    tx: Translator,
  ) {
    const form = await readForm(req);
    checkForm(req, who, form, tx);
    const show = (state: DataState, status = 200) =>
      sendHtml(res, status, dataPage(context(url, who, tx), state));
    if (path === '/sign-out') {
      const cookie = cookies(req)[SESSION_COOKIE];
      if (cookie) endSession(store, cookie);
      return redirect(res, tx.link('/sign-in'), [sessionCookie(req, '', 0)]);
    }
    if (path === '/data/pairing')
      return show({ pairing: createPairingCode(store, now()) });
    if (path === '/data/token') {
      const name =
        (form.get('name') ?? '').trim() || tx.t('Lese-Token', 'Read token');
      return show({
        newToken: { name, token: createReadToken(store, name, now()) },
      });
    }
    let match = /^\/data\/token\/([^/]+)\/delete$/.exec(path);
    if (match) {
      revokeReadToken(store, decodeURIComponent(match[1]));
      return show({
        message: {
          title: tx.t('Token widerrufen', 'Token revoked'),
          body: tx.t(
            'Es funktioniert ab sofort nicht mehr.',
            'It stops working right away.',
          ),
          tone: 'green',
        },
      });
    }
    match = /^\/data\/device\/([^/]+)\/disconnect$/.exec(path);
    if (match) {
      removeDevice(store, decodeURIComponent(match[1]));
      return show({
        message: {
          title: tx.t('Telefon getrennt', 'Phone disconnected'),
          body: tx.t(
            'Die Kopie bleibt. Neue Daten kommen erst nach dem nächsten Verbinden.',
            'The copy stays. New data only arrives after the next connection.',
          ),
          tone: 'green',
        },
      });
    }
    if (path === '/data/password') {
      const problem = changePassword(
        store,
        form.get('current') ?? '',
        form.get('next') ?? '',
      );
      if (problem)
        return show(
          {
            message: {
              title: tx.t('Passwort nicht geändert', 'Password not changed'),
              body:
                problem === 'wrong-current'
                  ? tx.t(
                      'Das aktuelle Passwort stimmt nicht.',
                      'The current password is wrong.',
                    )
                  : tx.t(
                      'Das neue Passwort braucht mindestens 8 Zeichen.',
                      'The new password needs at least 8 characters.',
                    ),
              tone: 'danger',
            },
          },
          400,
        );
      return redirect(res, tx.link('/sign-in'), [sessionCookie(req, '', 0)]);
    }
    if (path === '/data/delete') {
      // Both the German and the English word are accepted, whatever the page language.
      const typed = (form.get('confirm') ?? '').trim().toUpperCase();
      if (typed !== 'LÖSCHEN' && typed !== 'DELETE') {
        return show(
          {
            message: {
              title: tx.t('Nichts gelöscht', 'Nothing deleted'),
              body: tx.t(
                'Tippe LÖSCHEN, um zu bestätigen.',
                'Type DELETE to confirm.',
              ),
              tone: 'caution',
            },
          },
          400,
        );
      }
      deleteCopy(store);
      return show({
        message: {
          title: tx.t('Kopie gelöscht', 'Copy deleted'),
          body: tx.t(
            'Der Server ist leer und das Telefon getrennt.',
            'The server is empty and the phone is disconnected.',
          ),
          tone: 'green',
        },
      });
    }
    if (path === '/data/sql') {
      const sql = form.get('sql') ?? '';
      try {
        const result = await runSql(store.path, sql);
        if (form.get('format') === 'csv')
          return writeCsv(
            res,
            result.columns,
            result.rows,
            'runback-abfrage.csv',
          );
        return show({ sql: { query: sql, result } });
      } catch (error) {
        return show({ sql: { query: sql, error: sqlMessage(error, tx) } }, 400);
      }
    }
    throw new HttpError(404, tx.t('Unbekannte Aktion.', 'Unknown action.'));
  }

  async function handleWeb(
    req: IncomingMessage,
    res: ServerResponse,
    url: URL,
    tx: Translator,
  ) {
    const method = req.method ?? 'GET';
    if (url.pathname === '/app.css') {
      res.setHeader('cache-control', 'public, max-age=3600');
      res.writeHead(200, { 'content-type': 'text/css; charset=utf-8' });
      return res.end(STYLESHEET);
    }
    if (url.pathname === '/favicon.svg') {
      res.setHeader('cache-control', 'public, max-age=86400');
      res.writeHead(200, { 'content-type': 'image/svg+xml' });
      return res.end(FAVICON);
    }
    if (url.pathname === '/healthz') {
      res.writeHead(200, { 'content-type': 'text/plain' });
      return res.end('ok');
    }
    const path = canonicalPath(url.pathname);
    if (method === 'GET' && path !== url.pathname)
      return redirect(res, `${path}${url.search}`, [], 301);

    if (path === '/sign-in') {
      if (method === 'POST') {
        const form = await readForm(req);
        const ip = clientIp(req);
        const next = safeNext(form.get('next'));
        if (loginThrottle.blocked(ip, now())) {
          return sendHtml(
            res,
            429,
            loginPage(
              tx,
              tx.t(
                'Zu viele Versuche. Warte eine Viertelstunde.',
                'Too many attempts. Wait fifteen minutes.',
              ),
              next,
            ),
          );
        }
        if (!checkPassword(store, form.get('password') ?? '')) {
          loginThrottle.fail(ip, now());
          return sendHtml(
            res,
            401,
            loginPage(
              tx,
              tx.t('Das Passwort stimmt nicht.', 'The password is wrong.'),
              next,
            ),
          );
        }
        const session = createSession(store, now());
        return redirect(res, next, [
          sessionCookie(req, session.cookie, 30 * 86_400),
        ]);
      }
      return sendHtml(
        res,
        200,
        loginPage(
          tx,
          null,
          safeNext(
            url.searchParams.get('next') ?? url.searchParams.get('weiter'),
          ),
        ),
      );
    }

    const cookie = cookies(req)[SESSION_COOKIE];
    const who = cookie ? sessionPrincipal(store, cookie, now()) : null;
    if (!who) {
      if (method !== 'GET')
        throw new HttpError(401, tx.t('Melde dich an.', 'Sign in.'));
      return redirect(
        res,
        tx.withLang(`/sign-in?next=${encodeURIComponent(path + url.search)}`),
      );
    }
    if (method === 'POST') return handleWebPost(req, res, url, path, who, tx);
    if (method !== 'GET')
      throw new HttpError(405, tx.t('Nicht erlaubt.', 'Not allowed.'));

    const ctx = context(url, who, tx);
    if (path === '/') return redirect(res, tx.link('/history'));
    if (path === '/history') return sendHtml(res, 200, historyPage(ctx));
    if (path === '/statistics') return sendHtml(res, 200, statisticsPage(ctx));
    if (path === '/plan') return sendHtml(res, 200, planPage(ctx));
    if (path === '/coach') return sendHtml(res, 200, coachPage(ctx));
    if (path === '/data') {
      const sql = url.searchParams.get('sql');
      return sendHtml(
        res,
        200,
        dataPage(ctx, sql ? { sql: { query: sql.slice(0, 20_000) } } : {}),
      );
    }
    let match = /^\/run\/([^/]+)$/.exec(path);
    if (match) {
      const result = runPage(ctx, decodeURIComponent(match[1]));
      return sendHtml(res, result ? 200 : 404, result ?? notFoundPage(tx));
    }
    match = /^\/strength\/([^/]+)$/.exec(path);
    if (match) {
      const result = strengthPage(ctx, decodeURIComponent(match[1]));
      return sendHtml(res, result ? 200 : 404, result ?? notFoundPage(tx));
    }
    return sendHtml(res, 404, notFoundPage(tx));
  }

  return async function handle(req: IncomingMessage, res: ServerResponse) {
    securityHeaders(res);
    const url = new URL(
      req.url ?? '/',
      `${isSecure(req) ? 'https' : 'http'}://${
        req.headers.host ?? 'localhost'
      }`,
    );
    const isApi =
      url.pathname.startsWith('/api/v1/') || url.pathname === '/api/v1';
    const { lang, explicit } = requestLanguage(
      url,
      req.headers['accept-language'],
    );
    const tx = translator(lang, explicit);
    try {
      if (isApi)
        await handleApi(
          req,
          res,
          url,
          url.pathname.slice('/api/v1'.length) || '/',
        );
      else await requestLang.run(lang, () => handleWeb(req, res, url, tx));
    } catch (error) {
      const status =
        error instanceof HttpError ||
        error instanceof SyncError ||
        error instanceof ApiError
          ? error.status
          : 500;
      const message =
        status === 500
          ? isApi
            ? 'Internal error. Details are in the server log.'
            : tx.t(
                'Interner Fehler. Details stehen im Log des Servers.',
                'Internal error. Details are in the server log.',
              )
          : (error as Error).message;
      if (status === 500) console.error(error);
      if (res.headersSent) {
        res.destroy();
        return;
      }
      if (isApi) sendJson(res, status, { error: message });
      else {
        res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8' });
        res.end(message);
      }
    }
  };
}
