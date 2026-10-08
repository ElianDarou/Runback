import { mkdirSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { createApp } from './app';
import { ensurePassword } from './auth';
import { Store } from './db';

/**
 * Container entry point. Settings come from the environment:
 *
 * - `RUNBACK_DATA_DIR` (default `/data`): `runback.sqlite` lives here.
 * - `RUNBACK_PORT` (default `8080`).
 * - `RUNBACK_PASSWORD`: password of the website. If not given, one is generated
 *   on first start and written to the log once.
 * - `RUNBACK_TRUST_PROXY=1`: behind a reverse proxy that terminates HTTPS.
 * - `TZ`: time zone for weeks and clock times (the image defaults to Europe/Berlin).
 */

declare const __RUNBACK_SERVER_VERSION__: string;
const version =
  typeof __RUNBACK_SERVER_VERSION__ === 'string'
    ? __RUNBACK_SERVER_VERSION__
    : 'dev';

const dataDir = process.env.RUNBACK_DATA_DIR || '/data';
const port = Number(process.env.RUNBACK_PORT || 8080);
mkdirSync(dataDir, { recursive: true });
const store = new Store(join(dataDir, 'runback.sqlite'));

const generated = ensurePassword(
  store,
  process.env.RUNBACK_PASSWORD || undefined,
);
if (generated) {
  console.log('');
  console.log('  Runback server: first password for the website');
  console.log(`  ${generated}`);
  console.log(
    '  Change it after signing in under “Data”, or set RUNBACK_PASSWORD.',
  );
  console.log('');
}

const server = createServer(
  createApp(store, {
    version,
    trustProxy: process.env.RUNBACK_TRUST_PROXY === '1',
  }),
);
server.requestTimeout = 5 * 60_000;
server.listen(port, () =>
  console.log(`Runback server ${version} listening on port ${port}.`),
);

const stop = () => {
  server.close(() => {
    store.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 5000).unref();
};
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
