import {
  availableMetrics,
  averagePace,
  formatMetric,
  formatPace,
  kilometerSplits,
  metricLabel,
  metricValue,
  type SeriesMetric,
} from '../../../src/domain/runSeries';
import { purposeLabel, runTitle } from '../../../src/domain/runTitle';
import { sportLabel, usesPace } from '../../../src/domain/sport';
import { setLabel } from '../../../src/domain/strengthSession';
import { isSetCompleted } from '../../../src/domain/strength';
import { loadRunDetail } from '../records';
import { lineChart, routeShape } from './charts';
import type { PageContext } from './context';
import { oneOf, param, syncStatus } from './context';
import {
  DASH,
  clock,
  completedSets,
  counted,
  decimal,
  formatClock,
  formatDuration,
  km,
  longDate,
  sessionSeconds,
  tempo,
} from './format';
import { html, query, type Html } from './html';
import {
  badge,
  chips,
  copy,
  disclosure,
  page,
  row,
  section,
  stat,
  table,
  title,
} from './ui';

/**
 * Detailseiten einer Einheit. Nur Ansicht: Laufart, Gefühl und Ende ändert
 * man in der App, weil dort das Original liegt.
 */

const SERIES_CLASS: Partial<Record<SeriesMetric, string>> = {
  heartRate: 'heart',
  cadence: 'cadence',
};

export function runPage(ctx: PageContext, id: string): Html | null {
  const run = ctx.data.runs.find(entry => entry.id === id);
  if (!run) return null;
  const detail = loadRunDetail(ctx.store, id);
  const metrics = availableMetrics(detail.series);
  const metric = oneOf(param(ctx.url, 'wert'), metrics, metrics[0] ?? 'pace');
  const pace = tempo(run);
  const splits = usesPace(run.sport) ? kilometerSplits(run.segments) : [];
  const elevation =
    run.elevation && run.elevation.available ? run.elevation : null;
  const rpe = run.rpe
    ? [
        run.rpe.legs ? `Beine ${run.rpe.legs}` : null,
        run.rpe.breathing ? `Atmung ${run.rpe.breathing}` : null,
      ]
        .filter(Boolean)
        .join(' · ')
    : '';

  const rows = detail.series?.rows ?? [];
  const chart =
    metrics.length && detail.series
      ? lineChart(
          {
            points: rows.map(r => ({
              x: r.distanceMeters,
              y: metricValue(r, metric),
            })),
            className: SERIES_CLASS[metric],
            invert: metric === 'pace',
            label: metricLabel(metric),
            format: value => formatMetric(metric, value),
            average:
              metric === 'pace'
                ? averagePace(run)
                : metric === 'heartRate'
                ? run.avgHeartRate
                : undefined,
          },
          x => `${km(x, 1)} km`,
        )
      : null;

  const body = html`
    ${title(runTitle(run))}
    ${copy(
      `${longDate(run.startTime)} · ${clock(run.startTime)} · ${sportLabel(
        run.sport,
      )} · ${purposeLabel(run.purpose)}`,
      true,
    )}
    <div class="section">
      <div class="tiles">
        ${stat(km(run.distanceMeters), 'Distanz · km')}
        ${stat(
          formatClock(run.time?.movingSeconds ?? run.durationSeconds),
          run.time?.movingSeconds !== undefined ? 'Bewegungszeit' : 'Zeit',
        )}
        ${stat(
          pace.value,
          `Ø ${usesPace(run.sport) ? 'Tempo' : 'Geschwindigkeit'} · ${
            pace.unit
          }`,
        )}
        ${run.avgHeartRate !== undefined
          ? stat(String(Math.round(run.avgHeartRate)), 'Ø Puls · bpm')
          : null}
        ${elevation
          ? stat(`↗ ${Math.round(elevation.ascentMeters)}`, 'Anstieg · m')
          : null}
      </div>
    </div>
    ${rpe ? section('Gefühl', copy(rpe)) : null}
    ${run.note ? section('Notiz', copy(run.note)) : null}
    ${chart
      ? section(
          'Verlauf',
          html`${metrics.length > 1
            ? chips(
                'Kennzahl im Verlauf',
                metrics.map(entry => ({
                  value: entry,
                  label: metricLabel(entry),
                })),
                metric,
                value =>
                  `/lauf/${encodeURIComponent(id)}${query({ wert: value })}`,
              )
            : null}${chart}`,
        )
      : null}
    ${splits.length
      ? section(
          'Kilometer',
          table(
            [
              { label: 'km' },
              { label: 'Tempo', numeric: true },
              { label: 'Puls', numeric: true },
              { label: 'Anstieg', numeric: true },
            ],
            splits.map(split => ({
              cells: [
                split.label,
                split.secondsPerKm === undefined
                  ? DASH
                  : `${formatPace(split.secondsPerKm)}${
                      split.uncertain ? ' ~' : ''
                    }`,
                split.avgHeartRate === undefined
                  ? DASH
                  : String(Math.round(split.avgHeartRate)),
                split.ascentMeters === undefined
                  ? DASH
                  : `${Math.round(split.ascentMeters)} m`,
              ],
            })),
            'Kilometerabschnitte',
          ),
        )
      : null}
    ${detail.route ? section('Strecke', routeShape(detail.route as any)) : null}
    ${section(
      null,
      disclosure(
        'Details',
        'Herkunft und Modell',
        html`
          ${row({ title: 'Quelle', value: run.source })}
          ${row({ title: 'Distanzmodell', value: run.model_version ?? DASH })}
          ${row({
            title: 'Messpunkte',
            value: run.samples ? String(run.samples) : DASH,
          })}
          ${row({
            title: 'Puls von',
            value: run.sensorSources?.heartRate ?? DASH,
          })}
          ${row({ title: 'GPS von', value: run.sensorSources?.gps ?? DASH })}
          ${!detail.route
            ? copy(
                'Die Strecke fehlt, weil GPS-Strecken in der App nicht freigegeben sind oder es keine gibt.',
                true,
              )
            : null}
        `,
      ),
    )}
  `;
  return page(
    {
      title: runTitle(run),
      tab: 'Verlauf',
      status: syncStatus(ctx.data, ctx.now),
    },
    body,
  );
}

export function strengthPage(ctx: PageContext, id: string): Html | null {
  const session = ctx.data.strength.find(entry => entry.id === id);
  if (!session) return null;
  const heart = ctx.data.heart[id];
  const seconds = sessionSeconds(session);
  const sets = completedSets(session);
  const body = html`
    ${title(session.name || 'Krafttraining')}
    ${copy(
      `${longDate(session.startTime)} · ${clock(session.startTime)}`,
      true,
    )}
    <div class="section">
      <div class="tiles">
        ${stat(seconds === null ? DASH : formatDuration(seconds), 'Dauer')}
        ${stat(String(sets), sets === 1 ? 'Satz' : 'Sätze')}
        ${heart
          ? stat(String(Math.round(heart.averageBpm)), 'Ø Puls · bpm')
          : null}
        ${heart
          ? stat(String(Math.round(heart.maxBpm)), 'Höchster Puls · bpm')
          : null}
      </div>
    </div>
    ${session.note ? section('Notiz', copy(session.note)) : null}
    ${session.exercises.map(exercise =>
      section(
        exercise.name,
        table(
          [
            { label: 'Satz' },
            { label: 'Ergebnis' },
            { label: 'Vorgabe' },
            { label: 'RIR', numeric: true },
            { label: '' },
          ],
          exercise.sets.map((set, index) => {
            const done = isSetCompleted(set) && !set.skipped;
            const actual = setLabel({
              weightKg: set.actualWeightKg,
              reps: set.actualReps,
              seconds: set.actualSeconds,
            });
            const planned = setLabel({
              weightKg: set.planned?.weightKg,
              reps: set.planned?.reps,
              seconds: set.planned?.seconds,
            });
            return {
              cells: [
                String(index + 1),
                done ? actual || DASH : DASH,
                planned || DASH,
                set.actualRir === undefined ? DASH : decimal(set.actualRir, 0),
                set.skipped
                  ? badge('Übersprungen', 'muted')
                  : !done
                  ? badge('Offen', 'muted')
                  : set.planned?.kind === 'warmup'
                  ? badge('Aufwärmen', 'muted')
                  : null,
              ],
            };
          }),
          exercise.name,
        ),
      ),
    )}
    ${section(
      null,
      disclosure(
        'Details',
        'Herkunft und Modell',
        html`
          ${row({
            title: 'Quelle',
            value: session.importSource
              ? session.importSource.source
              : 'Runback',
          })}
          ${row({
            title: 'Übungen',
            value: counted(session.exercises.length, 'Übung', 'Übungen'),
          })}
          ${row({ title: 'Modell', value: session.modelVersion || DASH })}
          ${row({ title: 'Katalog', value: session.catalogVersion || DASH })}
          ${session.endCorrection
            ? row({ title: 'Ende', value: 'In der App korrigiert' })
            : null}
          ${session.importSource?.incomplete
            ? copy(
                'Der Import war unvollständig; fehlende Werte bleiben leer.',
                true,
              )
            : null}
        `,
      ),
    )}
  `;
  return page(
    {
      title: session.name || 'Krafttraining',
      tab: 'Verlauf',
      status: syncStatus(ctx.data, ctx.now),
    },
    body,
  );
}
