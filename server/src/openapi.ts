import { SERVER_SYNC_PROTOCOL } from '../../src/domain/serverLink';
import { PUBLIC_VIEWS } from './db';

/** API description for tools (Swagger UI, code generators, Grafana). */
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
          description: 'From here (inclusive).',
        },
        {
          name: 'to',
          in: 'query',
          schema: { type: 'string', format: 'date-time' },
          description: 'Up to here (exclusive).',
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
        'Read-only API of your own Runback server. The app sends a copy; the server changes nothing in your data. Unknown values are null.',
    },
    servers: [{ url: '/api/v1' }],
    components: {
      securitySchemes: {
        bearer: {
          type: 'http',
          scheme: 'bearer',
          description: 'Read token (rbr_…) from “Data”, or the phone’s token.',
        },
      },
    },
    paths: {
      '/hello': {
        get: {
          summary: 'Reachability and version, no sign-in needed',
          responses: { 200: { description: 'JSON' } },
        },
      },
      '/documents': list('All shared documents with origin and content', [
        query('kind', 'Data kind, e.g. settings or soreness.'),
        query('key', 'One document, e.g. settings or run/id.'),
      ]),
      '/status': get('Stand der Kopie'),
      '/runs': list('Runs and cycling (v1_runs)', [
        query('sport', 'running, cycling …'),
        query('purpose', 'Run type'),
      ]),
      '/runs/{id}': get('A run with its trace and, if shared, its route', [
        {
          name: 'id',
          in: 'path',
          required: true,
          schema: { type: 'string' },
        },
      ]),
      '/strength/sessions': list('Strength sessions (v1_strength_sessions)', [
        query('status', 'finished, interrupted'),
      ]),
      '/strength/sessions/{id}': get('A strength session with all sets', [
        { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
      ]),
      '/strength/sets': list('Sets (v1_strength_sets)', [
        query('exercise', 'Exercise id'),
        query('session', 'Workout'),
      ]),
      '/wellness': list('Health values (v1_wellness)', [
        query('kind', 'Kind of value'),
      ]),
      '/recommendations': list('Recommendations (v1_recommendations)', [
        query('area', 'running oder strength'),
        query('status', 'active …'),
      ]),
      '/plan': get('Saved appointments and templates from the app'),
      '/soreness': get('Reported soreness from the app'),
      '/coach': get('Goal, focus and recommendations per area'),
      '/stats/running': get('Running statistics, as in the app', [range]),
      '/stats/strength': get('Strength statistics, as in the app', [range]),
      '/sql': {
        post: {
          summary:
            'Read-only SQL query (SELECT or WITH only, 5 s, at most 5000 rows)',
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
      '/export/{view}.{format}': get('Whole view as a file', [
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
      '/export/runback.sqlite': get('Whole database without credentials'),
    },
    'x-runback-sync-protocol': SERVER_SYNC_PROTOCOL,
  };
}
