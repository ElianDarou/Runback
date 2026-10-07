import { mkdirSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { createApp } from './app';
import { ensurePassword } from './auth';
import { Store } from './db';

/**
 * Einstieg des Containers. Einstellungen kommen aus der Umgebung:
 *
 * - `RUNBACK_DATA_DIR` (Standard `/data`): hier liegt `runback.sqlite`.
 * - `RUNBACK_PORT` (Standard `8080`).
 * - `RUNBACK_PASSWORD`: Passwort der Website. Ohne Angabe entsteht beim
 *   ersten Start eins und steht einmal im Log.
 * - `RUNBACK_TRUST_PROXY=1`: hinter einem Reverse Proxy, der HTTPS beendet.
 * - `TZ`: Zeitzone für Wochen und Uhrzeiten (Standard im Image Europe/Berlin).
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
  console.log('  Runback-Server: erstes Passwort für die Website');
  console.log(`  ${generated}`);
  console.log(
    '  Ändere es nach der Anmeldung unter „Daten“ oder setze RUNBACK_PASSWORD.',
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
  console.log(`Runback-Server ${version} hört auf Port ${port}.`),
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
