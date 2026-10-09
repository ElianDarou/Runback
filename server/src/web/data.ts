import {
  SERVER_SCOPE_OPTIONS,
  type ServerScope,
} from '../../../src/domain/serverLink';
import { pairingExpiry } from '../auth';
import { PUBLIC_VIEWS } from '../db';
import type { SqlResult } from '../sql';
import type { PageContext } from './context';
import { syncStatus } from './context';
import { DASH, clock, counted, relative } from './format';
import { html, type Child, type Html } from './html';
import type { Translator } from './i18n';
import {
  badge,
  button,
  card,
  copy,
  disclosure,
  field,
  form,
  notice,
  page,
  row,
  section,
  table,
  title,
} from './ui';

/**
 * Data: connection to the phone, access from outside (SQL, export, API) and
 * administration. Rare things are collapsed at the bottom.
 */

export interface DataState {
  pairing?: { code: string; expiresAt: number };
  newToken?: { name: string; token: string };
  sql?: { query: string; result?: SqlResult; error?: string };
  message?: {
    title: string;
    body: string;
    tone: 'green' | 'caution' | 'danger';
  };
}

/** Example queries. The aliases are the column names the user sees. */
export function sqlExamples(tx: Translator): { label: string; sql: string }[] {
  return [
    {
      label: tx.t('Läufe der letzten 30 Tage', 'Runs in the last 30 days'),
      sql: "SELECT start_utc, distance_m, pace_s_per_km, avg_heart_rate\nFROM v1_runs\nWHERE sport = 'running' AND start_utc >= date('now', '-30 days')\nORDER BY start_utc DESC",
    },
    {
      label: tx.t('Kilometer je Woche', 'Kilometers per week'),
      sql: tx.t(
        "SELECT strftime('%Y-%W', start_utc) AS woche, round(sum(distance_m) / 1000, 1) AS km, count(*) AS laeufe\nFROM v1_runs WHERE sport = 'running'\nGROUP BY woche ORDER BY woche DESC",
        "SELECT strftime('%Y-%W', start_utc) AS week, round(sum(distance_m) / 1000, 1) AS km, count(*) AS runs\nFROM v1_runs WHERE sport = 'running'\nGROUP BY week ORDER BY week DESC",
      ),
    },
    {
      label: tx.t('Bester Satz je Übung', 'Best set per exercise'),
      sql: tx.t(
        "SELECT exercise_name, max(weight_kg) AS kg, count(*) AS saetze\nFROM v1_strength_sets\nWHERE completed = 1 AND kind IS NOT 'warmup'\nGROUP BY exercise_name ORDER BY saetze DESC",
        "SELECT exercise_name, max(weight_kg) AS kg, count(*) AS sets\nFROM v1_strength_sets\nWHERE completed = 1 AND kind IS NOT 'warmup'\nGROUP BY exercise_name ORDER BY sets DESC",
      ),
    },
  ];
}

/** Short English names for the scope options; the German comes from the domain. */
const SCOPE_EN: Record<keyof ServerScope, string> = {
  runs: 'Runs',
  strength: 'Strength training',
  coach: 'Coach',
  gps: 'GPS routes',
  health: 'Health values',
};

function sqlResult(tx: Translator, result: SqlResult): Html {
  if (!result.rows.length)
    return copy(
      tx.t(
        'Die Abfrage hat keine Zeilen ergeben.',
        'The query returned no rows.',
      ),
      true,
    );
  return html`${copy(
    `${counted(tx, result.rows.length, ['Zeile', 'Zeilen'], ['row', 'rows'])}${
      result.truncated ? tx.t(' (gekürzt)', ' (truncated)') : ''
    } · ${result.ms} ms`,
    true,
  )}${table(
    result.columns.map(name => ({ label: name })),
    result.rows.slice(0, 500).map(values => ({
      cells: values.map(value =>
        value === null || value === undefined
          ? html`<span class="muted">NULL</span>`
          : String(value),
      ) as Child[],
    })),
    tx.t('Ergebnis der Abfrage', 'Result of the query'),
  )}${result.rows.length > 500
    ? copy(
        tx.t(
          'Die Seite zeigt die ersten 500 Zeilen; der CSV-Download enthält alle.',
          'The page shows the first 500 rows; the CSV download contains all of them.',
        ),
        true,
      )
    : null}`;
}

export function dataPage(ctx: PageContext, state: DataState = {}): Html {
  const { store, data, now, csrf, tx } = ctx;
  const devices = store.db
    .prepare(
      'SELECT id, name, created_at, last_seen_at, last_sync_at FROM devices ORDER BY created_at DESC',
    )
    .all() as {
    id: string;
    name: string;
    created_at: number;
    last_seen_at: number | null;
    last_sync_at: number | null;
  }[];
  const tokens = store.db
    .prepare(
      'SELECT id, name, created_at, last_used_at FROM tokens ORDER BY created_at DESC',
    )
    .all() as {
    id: string;
    name: string;
    created_at: number;
    last_used_at: number | null;
  }[];
  const counts = {
    runs: data.runs.length,
    strength: data.strength.length,
    wellness: data.wellness.length,
  };
  const device = devices[0];
  const origin = `${ctx.url.protocol}//${ctx.url.host}`;
  const openPairing = state.pairing ? null : pairingExpiry(store, now);
  const examples = sqlExamples(tx);
  const query = state.sql?.query ?? examples[0].sql;

  const connection = device
    ? card(
        html`<div>${badge(tx.t('Verbunden', 'Connected'))}</div>
          <h2 class="card-title">${device.name}</h2>
          ${copy(
            device.last_sync_at
              ? tx.t(
                  `Zuletzt übertragen ${relative(
                    tx,
                    device.last_sync_at,
                    now,
                  )}.`,
                  `Last transferred ${relative(tx, device.last_sync_at, now)}.`,
                )
              : tx.t('Noch nichts übertragen.', 'Nothing transferred yet.'),
            true,
          )}`,
        { label: tx.t('Telefon', 'Phone') },
      )
    : card(
        html`<h2 class="card-title">
            ${tx.t('Verbinde dein Telefon', 'Connect your phone')}
          </h2>
          ${copy(
            tx.t(
              'Erzeuge einen Code und gib ihn in der App unter Einstellungen › Eigener Server ein.',
              'Create a code and enter it in the app under Settings › Own server.',
            ),
            true,
          )}`,
        { label: tx.t('Telefon', 'Phone'), accent: true },
      );

  const pairingLabel = tx.t('Kopplungscode', 'Pairing code');
  const pairing = state.pairing
    ? card(
        html`<span class="card-label">${pairingLabel}</span>
          <span
            class="pair-code"
            aria-label="${pairingLabel} ${state.pairing.code
              .split('')
              .join(' ')}"
            >${state.pairing.code.slice(0, 4)}
            ${state.pairing.code.slice(4)}</span
          >
          ${copy(
            html`${tx.t(
                'Gib in der App diese Adresse ein:',
                'Enter this address in the app:',
              )} <code>${origin}</code>`,
          )}
          ${copy(
            tx.t(
              `Der Code gilt bis ${clock(
                tx,
                state.pairing.expiresAt,
              )} Uhr und nur einmal.`,
              `The code is valid until ${clock(
                tx,
                state.pairing.expiresAt,
              )} and works only once.`,
            ),
            true,
          )}`,
        { accent: true },
      )
    : form(
        tx,
        '/data/pairing',
        csrf,
        html`${device
            ? copy(
                tx.t(
                  'Ein neues Telefon ersetzt das verbundene.',
                  'A new phone replaces the connected one.',
                ),
                true,
              )
            : null}${openPairing
            ? copy(
                tx.t(
                  `Ein Code ist noch bis ${clock(
                    tx,
                    openPairing,
                  )} Uhr gültig. Ein neuer ersetzt ihn.`,
                  `A code is valid until ${clock(
                    tx,
                    openPairing,
                  )}. A new one replaces it.`,
                ),
                true,
              )
            : null}
          <div class="actions">
            ${button(
              device
                ? tx.t('Neues Telefon verbinden', 'Connect new phone')
                : tx.t('Code erzeugen', 'Create code'),
              device ? 'secondary' : 'primary',
            )}
          </div>`,
      );

  const scope = data.scope;
  const body = html`
    ${title(tx.t('Daten', 'Data'))}
    ${state.message
      ? notice(state.message.title, state.message.body, state.message.tone)
      : null}
    <div class="grid two" id="verbinden">${connection}${pairing}</div>

    ${section(
      tx.t('Auf diesem Server', 'On this server'),
      html`
        ${row({
          title: tx.t('Läufe und Radfahrten', 'Runs and cycling'),
          value: String(counts.runs),
        })}
        ${row({
          title: tx.t('Krafteinheiten', 'Strength sessions'),
          value: String(counts.strength),
        })}
        ${row({
          title: tx.t('Gesundheitswerte', 'Health values'),
          value: String(counts.wellness),
        })}
        ${scope
          ? row({
              title: tx.t('Freigegeben', 'Shared'),
              subtitle:
                SERVER_SCOPE_OPTIONS.filter(option => scope[option.key])
                  .map(option => tx.t(option.label, SCOPE_EN[option.key]))
                  .join(' · ') || tx.t('Nichts', 'Nothing'),
            })
          : null}
        ${row({
          title: tx.t('Vollständig übertragen', 'Fully transferred'),
          value: data.lastCompleteAt
            ? relative(tx, data.lastCompleteAt, now)
            : DASH,
        })}
      `,
    )}
    ${section(
      'SQL',
      html`${copy(
          html`${tx.t(
            'Frag deine Daten direkt ab. Nur lesend; nutze die Sichten',
            'Query your data directly. Read-only; use the views',
          )}
          ${PUBLIC_VIEWS.map(
            (view, index) => html`${index ? ', ' : ''}<code>${view}</code>`,
          )}.`,
          true,
        )}
        <div class="chips">
          ${examples.map(
            example =>
              html`<a
                class="chip"
                href="${tx.withLang(
                  `/data?sql=${encodeURIComponent(example.sql)}`,
                )}#sql"
                >${example.label}</a
              >`,
          )}
        </div>
        <div id="sql">
          ${form(
            tx,
            '/data/sql',
            csrf,
            html`${field(
                tx.t('Abfrage', 'Query'),
                html`<textarea
                  class="input"
                  name="sql"
                  spellcheck="false"
                  rows="7"
                >
${query}</textarea
                >`,
              )}
              <div class="actions">
                ${button(
                  tx.t('Abfrage ausführen', 'Run query'),
                  'secondary',
                  true,
                )}<button
                  class="button secondary small"
                  type="submit"
                  name="format"
                  value="csv"
                >
                  ${tx.t('Als CSV laden', 'Download as CSV')}
                </button>
              </div>`,
          )}
        </div>
        ${state.sql?.error
          ? notice(
              tx.t('Abfrage fehlgeschlagen', 'Query failed'),
              state.sql.error,
              'danger',
            )
          : null}
        ${state.sql?.result ? sqlResult(tx, state.sql.result) : null}`,
    )}
    ${section(
      tx.t('Export', 'Export'),
      html`${PUBLIC_VIEWS.map(view =>
        row({
          title: view,
          subtitle: html`<a class="green" href="/api/v1/export/${view}.csv"
              >CSV</a
            >
            · <a class="green" href="/api/v1/export/${view}.jsonl">JSONL</a>`,
        }),
      )}
      ${row({
        title: tx.t('Ganze Datenbank', 'Whole database'),
        subtitle: tx.t(
          'SQLite-Datei mit allen Tabellen',
          'SQLite file with all tables',
        ),
        href: '/api/v1/export/runback.sqlite',
      })}`,
    )}
    ${section(
      'API',
      html`${copy(
        html`${tx.t(
            'Lies deine Daten aus Skripten, Notebooks oder Grafana. Die\n          Beschreibung steht unter',
            'Read your data from scripts, notebooks or Grafana. The\n          description is at',
          )}
          <a class="green" href="/api/v1/openapi.json">/api/v1/openapi.json</a
          >.`,
        true,
      )}
      ${state.newToken
        ? card(
            html`<span class="card-label"
                >${tx.t(
                  `Neues Lese-Token · ${state.newToken.name}`,
                  `New read token · ${state.newToken.name}`,
                )}</span
              >
              <span class="secret">${state.newToken.token}</span>
              ${copy(
                tx.t(
                  'Kopiere es jetzt. Runback zeigt es nur dieses eine Mal.',
                  'Copy it now. Runback shows it only once.',
                ),
                true,
              )}
              <pre class="code">
curl -H "Authorization: Bearer ${state.newToken.token}" \\
  ${origin}/api/v1/runs?limit=5</pre
              >`,
            { accent: true },
          )
        : null}
      ${tokens.map(
        token =>
          html`<div class="row">
            <span class="row-text"
              ><span class="row-title">${token.name}</span
              ><span class="row-subtitle"
                >${token.last_used_at
                  ? tx.t(
                      `Zuletzt genutzt ${relative(
                        tx,
                        token.last_used_at,
                        now,
                      )}`,
                      `Last used ${relative(tx, token.last_used_at, now)}`,
                    )
                  : tx.t('Noch nicht genutzt', 'Not used yet')}</span
              ></span
            >${form(
              tx,
              `/data/token/${encodeURIComponent(token.id)}/delete`,
              csrf,
              button(tx.t('Widerrufen', 'Revoke'), 'danger', true),
              '',
            )}
          </div>`,
      )}
      ${form(
        tx,
        '/data/token',
        csrf,
        html`${field(
            tx.t('Name des Tokens', 'Token name'),
            html`<input
              class="input"
              name="name"
              maxlength="80"
              placeholder="${tx.t(
                'Zum Beispiel: Grafana',
                'For example: Grafana',
              )}"
              required
            />`,
          )}
          <div class="actions">
            ${button(
              tx.t('Lese-Token erstellen', 'Create read token'),
              'secondary',
              true,
            )}
          </div>`,
      )}`,
    )}
    ${section(
      null,
      html`
        ${device
          ? disclosure(
              tx.t('Telefon trennen', 'Disconnect phone'),
              tx.t(
                'Die Kopie bleibt, es kommt nur nichts Neues mehr',
                'The copy stays; nothing new arrives anymore',
              ),
              form(
                tx,
                `/data/device/${encodeURIComponent(device.id)}/disconnect`,
                csrf,
                html`<div class="actions">
                  ${button(
                    tx.t('Telefon trennen', 'Disconnect phone'),
                    'danger',
                    true,
                  )}
                </div>`,
              ),
            )
          : null}
        ${disclosure(
          tx.t('Passwort ändern', 'Change password'),
          tx.t('Meldet alle Browser ab', 'Signs out all browsers'),
          form(
            tx,
            '/data/password',
            csrf,
            html`${field(
                tx.t('Aktuelles Passwort', 'Current password'),
                html`<input
                  class="input"
                  type="password"
                  name="current"
                  autocomplete="current-password"
                  required
                />`,
              )}
              ${field(
                tx.t('Neues Passwort', 'New password'),
                html`<input
                  class="input"
                  type="password"
                  name="next"
                  minlength="8"
                  autocomplete="new-password"
                  required
                />`,
              )}
              <div class="actions">
                ${button(
                  tx.t('Passwort speichern', 'Save password'),
                  'secondary',
                  true,
                )}
              </div>`,
          ),
        )}
        ${disclosure(
          tx.t('Kopie löschen', 'Delete copy'),
          tx.t(
            'Alles auf diesem Server, das Telefon behält seine Daten',
            'Everything on this server; the phone keeps its data',
          ),
          form(
            tx,
            '/data/delete',
            csrf,
            html`${copy(
                tx.t(
                  'Das trennt auch das Telefon. Tippe LÖSCHEN, um zu bestätigen.',
                  'This also disconnects the phone. Type DELETE to confirm.',
                ),
                true,
              )}
              ${field(
                tx.t('Bestätigung', 'Confirmation'),
                html`<input
                  class="input"
                  name="confirm"
                  autocomplete="off"
                  required
                />`,
              )}
              <div class="actions">
                ${button(tx.t('Kopie löschen', 'Delete copy'), 'danger', true)}
              </div>`,
          ),
        )}
        ${disclosure(
          tx.t('Abmelden', 'Sign out'),
          tx.t('In diesem Browser', 'In this browser'),
          form(
            tx,
            '/sign-out',
            csrf,
            html`<div class="actions">
              ${button(tx.t('Abmelden', 'Sign out'), 'secondary', true)}
            </div>`,
          ),
        )}
      `,
    )}
  `;
  return page(
    tx,
    {
      title: tx.t('Daten', 'Data'),
      tab: 'data',
      status: syncStatus(tx, data, now),
    },
    body,
  );
}

export function loginPage(
  tx: Translator,
  error: string | null,
  next: string,
): Html {
  return page(
    tx,
    { title: tx.t('Anmelden', 'Sign in'), narrow: true },
    html`${title(tx.t('Anmelden', 'Sign in'))}
      ${error
        ? notice(
            tx.t('Anmeldung fehlgeschlagen', 'Sign-in failed'),
            error,
            'danger',
          )
        : null}
      <form class="form" method="post" action="${tx.link('/sign-in')}">
        <input type="hidden" name="next" value="${next}" />
        ${field(
          tx.t('Passwort', 'Password'),
          html`<input
            class="input"
            type="password"
            name="password"
            autocomplete="current-password"
            autofocus
            required
          />`,
        )}
        <div class="actions">${button(tx.t('Anmelden', 'Sign in'))}</div>
      </form>
      <div class="section">
        ${copy(
          tx.t(
            'Beim ersten Start schreibt der Server ein Passwort in sein Log, außer du hast RUNBACK_PASSWORD gesetzt.',
            'On first start the server writes a password to its log, unless you set RUNBACK_PASSWORD.',
          ),
          true,
        )}
      </div>`,
  );
}

export function notFoundPage(tx: Translator): Html {
  const historyHref = tx.link('/history');
  const back = tx.t('Zum Verlauf', 'Go to history');
  return page(
    tx,
    { title: tx.t('Nicht gefunden', 'Not found'), narrow: true },
    html`${title(tx.t('Nicht gefunden', 'Not found'))}${copy(
        tx.t(
          'Diese Seite gibt es nicht, oder die Einheit wurde in der App gelöscht.',
          'This page does not exist, or the workout was deleted in the app.',
        ),
        true,
      )}
      <div class="section">
        <a class="button secondary small" href="${historyHref}">${back}</a>
      </div>`,
  );
}
