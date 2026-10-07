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
import { runSql } from './sql';
import { SyncError, commit, deleteCopy, plan, receive } from './sync';
import { planPage } from './web/plan';
import { coachPage } from './web/coach';
import type { PageContext } from './web/context';
import {
  datenPage,
  loginPage,
  notFoundPage,
  type DatenState,
} from './web/daten';
import { runPage, strengthPage } from './web/einheit';
import type { Html } from './web/html';
import { statistikPage } from './web/statistik';
import { STYLESHEET } from './web/style';
import { verlaufPage } from './web/verlauf';

export interface AppConfig {
  version: string;
  /** Hinter einem Reverse Proxy: X-Forwarded-For/-Proto vertrauen. */
  trustProxy: boolean;
  now?: () => number;
}

const SESSION_COOKIE = 'runback_session';
const SMALL_BODY = 1024 * 1024;
const SYNC_BODY = 48 * 1024 * 1024;

const FAVICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="8" fill="#101210"/><path d="M11 24 21 8" stroke="#A5D879" stroke-width="4" stroke-linecap="round"/></svg>`;

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
) {
  if (cookies.length) res.setHeader('set-cookie', cookies);
  res.writeHead(303, { location });
  res.end();
}

async function readBody(req: IncomingMessage, limit: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > limit) throw new HttpError(413, 'Die Anfrage ist zu groß.');
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
    throw new HttpError(400, 'Ungültiges JSON.');
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

/** Nur relative Ziele innerhalb der Website; alles andere führt zum Verlauf. */
function safeNext(value: string | null): string {
  return value && /^\/(?!\/)[^\s\\]*$/.test(value) && !value.startsWith('/api/')
    ? value
    : '/verlauf';
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
    if (!who) throw new HttpError(401, 'Anmeldung fehlt oder ist abgelaufen.');
    if (!who.scopes.includes(scope))
      throw new HttpError(403, 'Dieser Zugang darf das nicht.');
    return who;
  }

  /** Formulare der Website: gleiche Herkunft und passendes CSRF-Feld. */
  function checkForm(
    req: IncomingMessage,
    who: Principal,
    form: URLSearchParams,
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
        throw new HttpError(403, 'Anfrage von einer fremden Seite.');
    }
    if (!who.csrf || form.get('csrf') !== who.csrf) {
      throw new HttpError(403, 'Die Seite war zu lange offen. Lade sie neu.');
    }
  }

  function context(url: URL, who: Principal): PageContext {
    return {
      store,
      data: loadDataset(store),
      now: now(),
      url,
      csrf: who.csrf ?? '',
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
        throw new HttpError(
          429,
          'Zu viele Versuche. Warte eine Viertelstunde.',
        );
      const body = await readJson(req);
      if (body?.protocol !== SERVER_SYNC_PROTOCOL) {
        throw new HttpError(
          409,
          'App und Server sprechen verschiedene Versionen. Aktualisiere den Server oder die App.',
        );
      }
      const result = redeemPairingCode(
        store,
        String(body?.code ?? ''),
        String(body?.deviceName ?? 'Telefon'),
        body.protocol,
        now(),
      );
      if (!result) {
        pairThrottle.fail(ip, now());
        throw new HttpError(
          403,
          'Der Code stimmt nicht oder ist abgelaufen. Erzeuge auf der Website einen neuen.',
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
      if (method !== 'POST') throw new HttpError(405, 'Nur POST.');
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
      throw new HttpError(404, 'Unbekannter Endpunkt.');
    }
    if (path === '/device' && method === 'DELETE') {
      const device = need(who, 'ingest');
      if (device.kind !== 'device')
        throw new HttpError(403, 'Nur das Telefon kann sich trennen.');
      if (url.searchParams.get('copy') === 'delete') deleteCopy(store);
      else removeDevice(store, device.id);
      return sendJson(res, 200, { ok: true });
    }
    if (path === '/sql' && method === 'POST') {
      const caller = need(who, 'read');
      if (caller.kind === 'session')
        throw new HttpError(403, 'Nutze im Browser die Seite „Daten“.');
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
    if (method !== 'GET') throw new HttpError(405, 'Nur GET.');
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
    who: Principal,
  ) {
    const form = await readForm(req);
    checkForm(req, who, form);
    const path = url.pathname;
    const show = (state: DatenState, status = 200) =>
      sendHtml(res, status, datenPage(context(url, who), state));
    if (path === '/abmelden') {
      const cookie = cookies(req)[SESSION_COOKIE];
      if (cookie) endSession(store, cookie);
      return redirect(res, '/anmelden', [sessionCookie(req, '', 0)]);
    }
    if (path === '/daten/kopplung')
      return show({ pairing: createPairingCode(store, now()) });
    if (path === '/daten/token') {
      const name = (form.get('name') ?? '').trim() || 'Lese-Token';
      return show({
        newToken: { name, token: createReadToken(store, name, now()) },
      });
    }
    let match = /^\/daten\/token\/([^/]+)\/loeschen$/.exec(path);
    if (match) {
      revokeReadToken(store, decodeURIComponent(match[1]));
      return show({
        message: {
          title: 'Token widerrufen',
          body: 'Es funktioniert ab sofort nicht mehr.',
          tone: 'green',
        },
      });
    }
    match = /^\/daten\/geraet\/([^/]+)\/trennen$/.exec(path);
    if (match) {
      removeDevice(store, decodeURIComponent(match[1]));
      return show({
        message: {
          title: 'Telefon getrennt',
          body: 'Die Kopie bleibt. Neue Daten kommen erst nach dem nächsten Verbinden.',
          tone: 'green',
        },
      });
    }
    if (path === '/daten/passwort') {
      const problem = changePassword(
        store,
        form.get('current') ?? '',
        form.get('next') ?? '',
      );
      if (problem)
        return show(
          {
            message: {
              title: 'Passwort nicht geändert',
              body: problem,
              tone: 'danger',
            },
          },
          400,
        );
      return redirect(res, '/anmelden', [sessionCookie(req, '', 0)]);
    }
    if (path === '/daten/loeschen') {
      if ((form.get('confirm') ?? '').trim().toUpperCase() !== 'LÖSCHEN') {
        return show(
          {
            message: {
              title: 'Nichts gelöscht',
              body: 'Tippe LÖSCHEN, um zu bestätigen.',
              tone: 'caution',
            },
          },
          400,
        );
      }
      deleteCopy(store);
      return show({
        message: {
          title: 'Kopie gelöscht',
          body: 'Der Server ist leer und das Telefon getrennt.',
          tone: 'green',
        },
      });
    }
    if (path === '/daten/sql') {
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
        return show(
          { sql: { query: sql, error: (error as Error).message } },
          400,
        );
      }
    }
    throw new HttpError(404, 'Unbekannte Aktion.');
  }

  async function handleWeb(
    req: IncomingMessage,
    res: ServerResponse,
    url: URL,
  ) {
    const path = url.pathname;
    const method = req.method ?? 'GET';
    if (path === '/app.css') {
      res.setHeader('cache-control', 'public, max-age=3600');
      res.writeHead(200, { 'content-type': 'text/css; charset=utf-8' });
      return res.end(STYLESHEET);
    }
    if (path === '/favicon.svg') {
      res.setHeader('cache-control', 'public, max-age=86400');
      res.writeHead(200, { 'content-type': 'image/svg+xml' });
      return res.end(FAVICON);
    }
    if (path === '/healthz') {
      res.writeHead(200, { 'content-type': 'text/plain' });
      return res.end('ok');
    }
    if (path === '/anmelden') {
      if (method === 'POST') {
        const form = await readForm(req);
        const ip = clientIp(req);
        const next = safeNext(form.get('next'));
        if (loginThrottle.blocked(ip, now())) {
          return sendHtml(
            res,
            429,
            loginPage('Zu viele Versuche. Warte eine Viertelstunde.', next),
          );
        }
        if (!checkPassword(store, form.get('password') ?? '')) {
          loginThrottle.fail(ip, now());
          return sendHtml(
            res,
            401,
            loginPage('Das Passwort stimmt nicht.', next),
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
        loginPage(null, safeNext(url.searchParams.get('weiter'))),
      );
    }

    const cookie = cookies(req)[SESSION_COOKIE];
    const who = cookie ? sessionPrincipal(store, cookie, now()) : null;
    if (!who) {
      if (method !== 'GET') throw new HttpError(401, 'Melde dich an.');
      return redirect(
        res,
        `/anmelden?weiter=${encodeURIComponent(path + url.search)}`,
      );
    }
    if (method === 'POST') return handleWebPost(req, res, url, who);
    if (method !== 'GET') throw new HttpError(405, 'Nicht erlaubt.');

    const ctx = context(url, who);
    if (path === '/') return redirect(res, '/verlauf');
    if (path === '/verlauf') return sendHtml(res, 200, verlaufPage(ctx));
    if (path === '/statistik') return sendHtml(res, 200, statistikPage(ctx));
    if (path === '/plan') return sendHtml(res, 200, planPage(ctx));
    if (path === '/coach') return sendHtml(res, 200, coachPage(ctx));
    if (path === '/daten') {
      const sql = url.searchParams.get('sql');
      return sendHtml(
        res,
        200,
        datenPage(ctx, sql ? { sql: { query: sql.slice(0, 20_000) } } : {}),
      );
    }
    let match = /^\/lauf\/([^/]+)$/.exec(path);
    if (match) {
      const result = runPage(ctx, decodeURIComponent(match[1]));
      return sendHtml(res, result ? 200 : 404, result ?? notFoundPage());
    }
    match = /^\/kraft\/([^/]+)$/.exec(path);
    if (match) {
      const result = strengthPage(ctx, decodeURIComponent(match[1]));
      return sendHtml(res, result ? 200 : 404, result ?? notFoundPage());
    }
    return sendHtml(res, 404, notFoundPage());
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
    try {
      if (isApi)
        await handleApi(
          req,
          res,
          url,
          url.pathname.slice('/api/v1'.length) || '/',
        );
      else await handleWeb(req, res, url);
    } catch (error) {
      const status =
        error instanceof HttpError ||
        error instanceof SyncError ||
        error instanceof ApiError
          ? error.status
          : 500;
      const message =
        status === 500
          ? 'Interner Fehler. Details stehen im Log des Servers.'
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
