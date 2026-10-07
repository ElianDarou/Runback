import { SERVER_SYNC_PROTOCOL } from '../../src/domain/serverLink';
import { PUBLIC_VIEWS } from './db';

/** Beschreibung der API für Werkzeuge (Swagger UI, Codegeneratoren, Grafana). */
export function openApi(version: string) {
  const list = (summary: string, extra: Record<string, unknown>[] = []) => ({
    get: {
      summary,
      security: [{ bearer: [] }],
      parameters: [
        {
          name: 'from',
          in: 'query',
          schema: { type: 'string', format: 'date-time' },
          description: 'Ab hier (einschließlich).',
        },
        {
          name: 'to',
          in: 'query',
          schema: { type: 'string', format: 'date-time' },
          description: 'Bis hier (ausschließlich).',
        },
        {
          name: 'limit',
          in: 'query',
          schema: { type: 'integer', minimum: 1, maximum: 1000, default: 100 },
        },
        {
          name: 'offset',
          in: 'query',
          schema: { type: 'integer', minimum: 0, default: 0 },
        },
        ...extra,
      ],
      responses: { 200: { description: '`{ total, limit, offset, items }`' } },
    },
  });
  const query = (name: string, description: string) => ({
    name,
    in: 'query',
    schema: { type: 'string' },
    description,
  });
  const get = (summary: string, parameters: unknown[] = []) => ({
    get: {
      summary,
      security: [{ bearer: [] }],
      parameters,
      responses: { 200: { description: 'JSON' } },
    },
  });
  const range = {
    name: 'range',
    in: 'query',
    schema: {
      type: 'string',
      enum: ['4w', '12w', '1y', 'all'],
      default: '12w',
    },
  };
  return {
    openapi: '3.1.0',
    info: {
      title: 'Runback Server',
      version,
      description:
        'Lesende API deines eigenen Runback-Servers. Die App überträgt eine Kopie; der Server ändert nichts an deinen Daten. Unbekannte Werte sind null.',
    },
    servers: [{ url: '/api/v1' }],
    components: {
      securitySchemes: {
        bearer: {
          type: 'http',
          scheme: 'bearer',
          description:
            'Lese-Token (rbr_…) aus „Daten“ oder das Token des Telefons.',
        },
      },
    },
    paths: {
      '/hello': {
        get: {
          summary: 'Erreichbarkeit und Version, ohne Anmeldung',
          responses: { 200: { description: 'JSON' } },
        },
      },
      '/documents': list(
        'Alle freigegebenen Dokumente mit Herkunft und Inhalt',
        [
          query('kind', 'Datenart, z. B. settings oder soreness.'),
          query('key', 'Ein Dokument, z. B. settings oder run/id.'),
        ],
      ),
      '/status': get('Stand der Kopie'),
      '/runs': list('Läufe und Radfahrten (v1_runs)', [
        query('sport', 'running, cycling …'),
        query('purpose', 'Laufart'),
      ]),
      '/runs/{id}': get(
        'Ein Lauf mit Verlauf und, falls freigegeben, Strecke',
        [
          {
            name: 'id',
            in: 'path',
            required: true,
            schema: { type: 'string' },
          },
        ],
      ),
      '/strength/sessions': list('Krafteinheiten (v1_strength_sessions)', [
        query('status', 'finished, interrupted'),
      ]),
      '/strength/sessions/{id}': get('Eine Krafteinheit mit allen Sätzen', [
        { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
      ]),
      '/strength/sets': list('Sätze (v1_strength_sets)', [
        query('exercise', 'Übungskennung'),
        query('session', 'Einheit'),
      ]),
      '/wellness': list('Gesundheitswerte (v1_wellness)', [
        query('kind', 'Art des Werts'),
      ]),
      '/recommendations': list('Empfehlungen (v1_recommendations)', [
        query('area', 'running oder strength'),
        query('status', 'active …'),
      ]),
      '/plan': get('Gespeicherte Termine und Vorlagen aus der App'),
      '/soreness': get('Gemeldeter Muskelkater aus der App'),
      '/coach': get('Ziel, Fokus und Empfehlungen je Bereich'),
      '/stats/running': get('Laufstatistik wie in der App', [range]),
      '/stats/strength': get('Kraftstatistik wie in der App', [range]),
      '/sql': {
        post: {
          summary:
            'Lesende SQL-Abfrage (nur SELECT/WITH, 5 s, höchstens 5000 Zeilen)',
          security: [{ bearer: [] }],
          requestBody: {
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: { sql: { type: 'string' } },
                  required: ['sql'],
                },
              },
            },
          },
          responses: {
            200: { description: '`{ columns, rows, truncated, ms }`' },
          },
        },
      },
      '/export/{view}.{format}': get('Ganze Sicht als Datei', [
        {
          name: 'view',
          in: 'path',
          required: true,
          schema: { type: 'string', enum: [...PUBLIC_VIEWS] },
        },
        {
          name: 'format',
          in: 'path',
          required: true,
          schema: { type: 'string', enum: ['csv', 'jsonl'] },
        },
      ]),
      '/export/runback.sqlite': get('Ganze Datenbank ohne Zugangsdaten'),
    },
    'x-runback-sync-protocol': SERVER_SYNC_PROTOCOL,
  };
}
