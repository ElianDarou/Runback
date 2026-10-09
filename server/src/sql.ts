import { spawn } from 'node:child_process';
import { PUBLIC_VIEWS } from './db';

/**
 * Read-only SQL access. Each query runs in its own process with a read-only
 * connection, and that process is killed after `timeoutMs`. So even an endless
 * query cannot stall the server.
 *
 * Exactly one statement that starts with SELECT or WITH is allowed. ATTACH,
 * PRAGMA and extensions are blocked; the connection could not write anyway.
 */

/** A message in both languages; the website shows the visitor's language. */
export interface Message {
  de: string;
  en: string;
}

/** A query that was refused or failed. `message` is the English text. */
export class SqlError extends Error {
  constructor(readonly text: Message) {
    super(text.en);
  }
}

export interface SqlResult {
  columns: string[];
  rows: unknown[][];
  truncated: boolean;
  ms: number;
}

export const SQL_MAX_ROWS = 5000;
export const SQL_TIMEOUT_MS = 5000;

const WORKER = `
const workerData = JSON.parse(process.argv[1]);
const { DatabaseSync, constants: c } = require('node:sqlite');
const started = Date.now();
try {
  const db = new DatabaseSync(workerData.path, { readOnly: true });
  const backing = {
    v1_runs: ['runs'], v1_strength_sessions: ['strength_sessions'],
    v1_strength_sets: ['strength_sets', 'strength_sessions'], v1_wellness: ['wellness'],
    v1_recommendations: ['recommendations'], v1_documents: ['objects'],
  };
  db.prepare("SELECT value FROM json_each('[]')").all();
  db.prepare("SELECT value FROM json_tree('[]')").all();
  db.setAuthorizer((action, table, column, database, source) => {
    if (action === c.SQLITE_READ) return (database === null || workerData.views.includes(table) || ['json_each', 'json_tree'].includes(table) || (backing[source] || []).includes(table)) ? c.SQLITE_OK : c.SQLITE_DENY;
    if (action === c.SQLITE_SELECT || action === c.SQLITE_RECURSIVE) return c.SQLITE_OK;
    if (action === c.SQLITE_FUNCTION && !['load_extension', 'readfile', 'writefile'].includes(String(column).toLowerCase())) return c.SQLITE_OK;
    return c.SQLITE_DENY;
  });
  const statement = db.prepare(workerData.sql);
  const columns = statement.columns().map(column => column.name);
  statement.setReturnArrays?.(true);
  const rows = [];
  let truncated = false;
  for (const row of statement.iterate()) {
    if (rows.length >= workerData.maxRows) { truncated = true; break; }
    const values = Array.isArray(row) ? row : columns.map(name => row[name]);
    rows.push(values.map(value =>
      typeof value === 'bigint' ? Number(value)
        : value instanceof Uint8Array ? '<' + value.length + ' Bytes>'
        : value));
  }
  db.close();
  process.stdout.write(JSON.stringify({ ok: true, columns, rows, truncated, ms: Date.now() - started }));
} catch (error) {
  process.stdout.write(JSON.stringify({ ok: false, message: String(error && error.message || error) }));
}
`;

export function checkSql(sql: string): Message | null {
  const text = sql.trim().replace(/;\s*$/, '');
  if (!text) return { de: 'Gib eine Abfrage ein.', en: 'Enter a query.' };
  if (text.length > 20_000)
    return { de: 'Die Abfrage ist zu lang.', en: 'The query is too long.' };
  const withoutStrings = text
    .replace(/'(?:[^']|'')*'/g, "''")
    .replace(/"(?:[^"]|"")*"/g, '""')
    .replace(/--[^\n]*/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ');
  if (withoutStrings.includes(';'))
    return { de: 'Schicke genau eine Abfrage.', en: 'Send exactly one query.' };
  if (!/^\s*(select|with)\b/i.test(withoutStrings)) {
    return {
      de: 'Erlaubt sind nur Abfragen, die mit SELECT oder WITH beginnen.',
      en: 'Only queries that start with SELECT or WITH are allowed.',
    };
  }
  if (
    /\b(attach|detach|pragma|load_extension|vacuum)\b/i.test(withoutStrings)
  ) {
    return {
      de: 'ATTACH, PRAGMA und Erweiterungen sind gesperrt.',
      en: 'ATTACH, PRAGMA and extensions are blocked.',
    };
  }
  return null;
}

export function runSql(
  path: string,
  sql: string,
  { maxRows = SQL_MAX_ROWS, timeoutMs = SQL_TIMEOUT_MS } = {},
): Promise<SqlResult> {
  const problem = checkSql(sql);
  if (problem) return Promise.reject(new SqlError(problem));
  return new Promise((resolve, reject) => {
    // An OS process can be killed even while sqlite3_step is running.
    const child = spawn(
      process.execPath,
      [
        '--max-old-space-size=256',
        '-e',
        WORKER,
        JSON.stringify({
          path,
          sql: sql.trim().replace(/;\s*$/, ''),
          maxRows: Math.min(maxRows, SQL_MAX_ROWS),
          views: PUBLIC_VIEWS,
        }),
      ],
      {
        stdio: ['ignore', 'pipe', 'ignore'],
        env: { ...process.env, NODE_OPTIONS: '' },
      },
    );
    let output = '';
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs);
    child.stdout.on('data', chunk => {
      output += chunk;
      if (output.length > 16 * 1024 * 1024) child.kill('SIGKILL');
    });
    child.once('error', error => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('close', () => {
      clearTimeout(timer);
      if (timedOut)
        return reject(
          new SqlError({
            de: `Die Abfrage hat länger als ${timeoutMs / 1000} s gedauert.`,
            en: `The query took longer than ${timeoutMs / 1000} s.`,
          }),
        );
      try {
        const message = JSON.parse(output);
        if (!message.ok)
          return reject(
            new SqlError({ de: message.message, en: message.message }),
          );
        resolve({
          columns: message.columns,
          rows: message.rows,
          truncated: message.truncated,
          ms: message.ms,
        });
      } catch {
        reject(
          new SqlError({
            de: 'Die Abfrage konnte nicht abgeschlossen werden.',
            en: 'The query could not finish.',
          }),
        );
      }
    });
  });
}
