import { SERVER_SCOPE_OPTIONS } from '../../../src/domain/serverLink';
import { pairingExpiry } from '../auth';
import { PUBLIC_VIEWS } from '../db';
import type { SqlResult } from '../sql';
import type { PageContext } from './context';
import { syncStatus } from './context';
import { DASH, clock, counted, relative } from './format';
import { html, type Child, type Html } from './html';
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
 * Daten: Verbindung zum Telefon, Zugriff von außen (SQL, Export, API) und
 * Verwaltung. Seltenes steht eingeklappt unten.
 */

export interface DatenState {
  pairing?: { code: string; expiresAt: number };
  newToken?: { name: string; token: string };
  sql?: { query: string; result?: SqlResult; error?: string };
  message?: {
    title: string;
    body: string;
    tone: 'green' | 'caution' | 'danger';
  };
}

export const SQL_EXAMPLES: { label: string; sql: string }[] = [
  {
    label: 'Läufe der letzten 30 Tage',
    sql: "SELECT start_utc, distance_m, pace_s_per_km, avg_heart_rate\nFROM v1_runs\nWHERE sport = 'running' AND start_utc >= date('now', '-30 days')\nORDER BY start_utc DESC",
  },
  {
    label: 'Kilometer je Woche',
    sql: "SELECT strftime('%Y-%W', start_utc) AS woche, round(sum(distance_m) / 1000, 1) AS km, count(*) AS laeufe\nFROM v1_runs WHERE sport = 'running'\nGROUP BY woche ORDER BY woche DESC",
  },
  {
    label: 'Bester Satz je Übung',
    sql: "SELECT exercise_name, max(weight_kg) AS kg, count(*) AS saetze\nFROM v1_strength_sets\nWHERE completed = 1 AND kind IS NOT 'warmup'\nGROUP BY exercise_name ORDER BY saetze DESC",
  },
];

function sqlResult(result: SqlResult): Html {
  if (!result.rows.length)
    return copy('Die Abfrage hat keine Zeilen ergeben.', true);
  return html`${copy(
    `${counted(result.rows.length, 'Zeile', 'Zeilen')}${
      result.truncated ? ' (gekürzt)' : ''
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
    'Ergebnis der Abfrage',
  )}${result.rows.length > 500
    ? copy(
        'Die Seite zeigt die ersten 500 Zeilen; der CSV-Download enthält alle.',
        true,
      )
    : null}`;
}

export function datenPage(ctx: PageContext, state: DatenState = {}): Html {
  const { store, data, now, csrf } = ctx;
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
  const query = state.sql?.query ?? SQL_EXAMPLES[0].sql;

  const connection = device
    ? card(
        html`<div>${badge('Verbunden')}</div>
          <h2 class="card-title">${device.name}</h2>
          ${copy(
            device.last_sync_at
              ? `Zuletzt übertragen ${relative(device.last_sync_at, now)}.`
              : 'Noch nichts übertragen.',
            true,
          )}`,
        { label: 'Telefon' },
      )
    : card(
        html`<h2 class="card-title">Verbinde dein Telefon</h2>
          ${copy(
            'Erzeuge einen Code und gib ihn in der App unter Einstellungen › Eigener Server ein.',
            true,
          )}`,
        { label: 'Telefon', accent: true },
      );

  const pairing = state.pairing
    ? card(
        html`<span class="card-label">Kopplungscode</span>
          <span
            class="pair-code"
            aria-label="Kopplungscode ${state.pairing.code.split('').join(' ')}"
            >${state.pairing.code.slice(0, 4)}
            ${state.pairing.code.slice(4)}</span
          >
          ${copy(
            html`Gib in der App diese Adresse ein: <code>${origin}</code>`,
          )}
          ${copy(
            `Der Code gilt bis ${clock(
              state.pairing.expiresAt,
            )} Uhr und nur einmal.`,
            true,
          )}`,
        { accent: true },
      )
    : form(
        '/daten/kopplung',
        csrf,
        html`${device
            ? copy('Ein neues Telefon ersetzt das verbundene.', true)
            : null}${openPairing
            ? copy(
                `Ein Code ist noch bis ${clock(
                  openPairing,
                )} Uhr gültig. Ein neuer ersetzt ihn.`,
                true,
              )
            : null}
          <div class="actions">
            ${button(
              device ? 'Neues Telefon verbinden' : 'Code erzeugen',
              device ? 'secondary' : 'primary',
            )}
          </div>`,
      );

  const scope = data.scope;
  const body = html`
    ${title('Daten')}
    ${state.message
      ? notice(state.message.title, state.message.body, state.message.tone)
      : null}
    <div class="grid two" id="verbinden">${connection}${pairing}</div>

    ${section(
      'Auf diesem Server',
      html`
        ${row({ title: 'Läufe und Radfahrten', value: String(counts.runs) })}
        ${row({ title: 'Krafteinheiten', value: String(counts.strength) })}
        ${row({ title: 'Gesundheitswerte', value: String(counts.wellness) })}
        ${scope
          ? row({
              title: 'Freigegeben',
              subtitle:
                SERVER_SCOPE_OPTIONS.filter(option => scope[option.key])
                  .map(option => option.label)
                  .join(' · ') || 'Nichts',
            })
          : null}
        ${row({
          title: 'Vollständig übertragen',
          value: data.lastCompleteAt
            ? relative(data.lastCompleteAt, now)
            : DASH,
        })}
      `,
    )}
    ${section(
      'SQL',
      html`${copy(
          html`Frag deine Daten direkt ab. Nur lesend; nutze die Sichten
          ${PUBLIC_VIEWS.map(
            (view, index) => html`${index ? ', ' : ''}<code>${view}</code>`,
          )}.`,
          true,
        )}
        <div class="chips">
          ${SQL_EXAMPLES.map(
            example =>
              html`<a
                class="chip"
                href="/daten?sql=${encodeURIComponent(example.sql)}#sql"
                >${example.label}</a
              >`,
          )}
        </div>
        <div id="sql">
          ${form(
            '/daten/sql',
            csrf,
            html`${field(
                'Abfrage',
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
                ${button('Abfrage ausführen', 'secondary', true)}<button
                  class="button secondary small"
                  type="submit"
                  name="format"
                  value="csv"
                >
                  Als CSV laden
                </button>
              </div>`,
          )}
        </div>
        ${state.sql?.error
          ? notice('Abfrage fehlgeschlagen', state.sql.error, 'danger')
          : null}
        ${state.sql?.result ? sqlResult(state.sql.result) : null}`,
    )}
    ${section(
      'Export',
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
        title: 'Ganze Datenbank',
        subtitle: 'SQLite-Datei mit allen Tabellen',
        href: '/api/v1/export/runback.sqlite',
      })}`,
    )}
    ${section(
      'API',
      html`${copy(
        html`Lies deine Daten aus Skripten, Notebooks oder Grafana. Die
          Beschreibung steht unter
          <a class="green" href="/api/v1/openapi.json">/api/v1/openapi.json</a
          >.`,
        true,
      )}
      ${state.newToken
        ? card(
            html`<span class="card-label"
                >Neues Lese-Token · ${state.newToken.name}</span
              >
              <span class="secret">${state.newToken.token}</span>
              ${copy(
                'Kopiere es jetzt. Runback zeigt es nur dieses eine Mal.',
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
                  ? `Zuletzt genutzt ${relative(token.last_used_at, now)}`
                  : 'Noch nicht genutzt'}</span
              ></span
            >${form(
              `/daten/token/${encodeURIComponent(token.id)}/loeschen`,
              csrf,
              button('Widerrufen', 'danger', true),
              '',
            )}
          </div>`,
      )}
      ${form(
        '/daten/token',
        csrf,
        html`${field(
            'Name des Tokens',
            html`<input
              class="input"
              name="name"
              maxlength="80"
              placeholder="Zum Beispiel: Grafana"
              required
            />`,
          )}
          <div class="actions">
            ${button('Lese-Token erstellen', 'secondary', true)}
          </div>`,
      )}`,
    )}
    ${section(
      null,
      html`
        ${device
          ? disclosure(
              'Telefon trennen',
              'Die Kopie bleibt, es kommt nur nichts Neues mehr',
              form(
                `/daten/geraet/${encodeURIComponent(device.id)}/trennen`,
                csrf,
                html`<div class="actions">
                  ${button('Telefon trennen', 'danger', true)}
                </div>`,
              ),
            )
          : null}
        ${disclosure(
          'Passwort ändern',
          'Meldet alle Browser ab',
          form(
            '/daten/passwort',
            csrf,
            html`${field(
                'Aktuelles Passwort',
                html`<input
                  class="input"
                  type="password"
                  name="current"
                  autocomplete="current-password"
                  required
                />`,
              )}
              ${field(
                'Neues Passwort',
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
                ${button('Passwort speichern', 'secondary', true)}
              </div>`,
          ),
        )}
        ${disclosure(
          'Kopie löschen',
          'Alles auf diesem Server, das Telefon behält seine Daten',
          form(
            '/daten/loeschen',
            csrf,
            html`${copy(
                'Das trennt auch das Telefon. Tippe LÖSCHEN, um zu bestätigen.',
                true,
              )}
              ${field(
                'Bestätigung',
                html`<input
                  class="input"
                  name="confirm"
                  autocomplete="off"
                  required
                />`,
              )}
              <div class="actions">
                ${button('Kopie löschen', 'danger', true)}
              </div>`,
          ),
        )}
        ${disclosure(
          'Abmelden',
          'In diesem Browser',
          form(
            '/abmelden',
            csrf,
            html`<div class="actions">
              ${button('Abmelden', 'secondary', true)}
            </div>`,
          ),
        )}
      `,
    )}
  `;
  return page(
    { title: 'Daten', tab: 'Daten', status: syncStatus(data, now) },
    body,
  );
}

export function loginPage(error: string | null, next: string): Html {
  return page(
    { title: 'Anmelden', narrow: true },
    html`${title('Anmelden')}
      ${error ? notice('Anmeldung fehlgeschlagen', error, 'danger') : null}
      <form class="form" method="post" action="/anmelden">
        <input type="hidden" name="next" value="${next}" />
        ${field(
          'Passwort',
          html`<input
            class="input"
            type="password"
            name="password"
            autocomplete="current-password"
            autofocus
            required
          />`,
        )}
        <div class="actions">${button('Anmelden')}</div>
      </form>
      <div class="section">
        ${copy(
          'Beim ersten Start schreibt der Server ein Passwort in sein Log, außer du hast RUNBACK_PASSWORD gesetzt.',
          true,
        )}
      </div>`,
  );
}

export function notFoundPage(): Html {
  return page(
    { title: 'Nicht gefunden', narrow: true },
    html`${title('Nicht gefunden')}${copy(
        'Diese Seite gibt es nicht, oder die Einheit wurde in der App gelöscht.',
        true,
      )}
      <div class="section">
        <a class="button secondary small" href="/verlauf">Zum Verlauf</a>
      </div>`,
  );
}
