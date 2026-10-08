import {
  availableMetrics,
  averagePace,
  formatPace,
  kilometerSplits,
  metricValue,
  type SeriesMetric,
} from '../../../src/domain/runSeries';
import { runTitle } from '../../../src/domain/runTitle';
import { usesPace } from '../../../src/domain/sport';
import { exerciseDisplayName } from '../../../src/domain/catalog';
import { displaySessionName, isSetCompleted } from '../../../src/domain/strength';
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
  setText,
  tempo,
} from './format';
import { html, type Html } from './html';
import type { Translator } from './i18n';
import { metricName, purposeName, sportName } from './labels';
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
 * Detail pages of a workout. View only: run type, feeling and end time are
 * changed in the app, because the original lives there.
 */

const SERIES_CLASS: Partial<Record<SeriesMetric, string>> = {
  heartRate: 'heart',
  cadence: 'cadence',
};

/** A metric value as text; wind keeps its sign, as in the app. */
function metricText(
  tx: Translator,
  metric: SeriesMetric,
  value: number | undefined,
): string {
  if (value === undefined || !Number.isFinite(value)) return DASH;
  switch (metric) {
    case 'pace':
      return formatPace(value);
    case 'wind': {
      const rounded = Math.round(value * 10) / 10;
      const sign = rounded > 0 ? '+' : rounded < 0 ? '−' : '±';
      return `${sign}${decimal(tx, Math.abs(rounded), 1)}`;
    }
    case 'elevation':
      return `${Math.round(value)} m`;
    default:
      return String(Math.round(value));
  }
}

export function runPage(ctx: PageContext, id: string): Html | null {
  const { tx } = ctx;
  const run = ctx.data.runs.find(entry => entry.id === id);
  if (!run) return null;
  const detail = loadRunDetail(ctx.store, id);
  const metrics = availableMetrics(detail.series);
  const metric = oneOf(param(ctx.url, 'wert'), metrics, metrics[0] ?? 'pace');
  const pace = tempo(tx, run);
  const splits = usesPace(run.sport) ? kilometerSplits(run.segments) : [];
  const elevation =
    run.elevation && run.elevation.available ? run.elevation : null;
  const rpe = run.rpe
    ? [
        run.rpe.legs
          ? tx.t(`Beine ${run.rpe.legs}`, `Legs ${run.rpe.legs}`)
          : null,
        run.rpe.breathing
          ? tx.t(
              `Atmung ${run.rpe.breathing}`,
              `Breathing ${run.rpe.breathing}`,
            )
          : null,
      ]
        .filter(Boolean)
        .join(' · ')
    : '';

  const rows = detail.series?.rows ?? [];
  const chart =
    metrics.length && detail.series
      ? lineChart(
          tx,
          {
            points: rows.map(r => ({
              x: r.distanceMeters,
              y: metricValue(r, metric),
            })),
            className: SERIES_CLASS[metric],
            invert: metric === 'pace',
            label: metricName(tx, metric),
            format: value => metricText(tx, metric, value),
            average:
              metric === 'pace'
                ? averagePace(run)
                : metric === 'heartRate'
                ? run.avgHeartRate
                : undefined,
          },
          x => `${km(tx, x, 1)} km`,
        )
      : null;

  const body = html`
    ${title(runTitle(run))}
    ${copy(
      `${longDate(tx, run.startTime)} · ${clock(
        tx,
        run.startTime,
      )} · ${sportName(tx, run.sport)} · ${purposeName(tx, run.purpose)}`,
      true,
    )}
    <div class="section">
      <div class="tiles">
        ${stat(
          km(tx, run.distanceMeters),
          tx.t('Distanz · km', 'Distance · km'),
        )}
        ${stat(
          formatClock(run.time?.movingSeconds ?? run.durationSeconds),
          run.time?.movingSeconds !== undefined
            ? tx.t('Bewegungszeit', 'Moving time')
            : tx.t('Zeit', 'Time'),
        )}
        ${stat(
          pace.value,
          tx.t(
            `Ø ${usesPace(run.sport) ? 'Tempo' : 'Geschwindigkeit'} · ${
              pace.unit
            }`,
            `Avg ${usesPace(run.sport) ? 'pace' : 'speed'} · ${pace.unit}`,
          ),
        )}
        ${run.avgHeartRate !== undefined
          ? stat(
              String(Math.round(run.avgHeartRate)),
              tx.t('Ø Puls · bpm', 'Avg heart rate · bpm'),
            )
          : null}
        ${elevation
          ? stat(
              `↗ ${Math.round(elevation.ascentMeters)}`,
              tx.t('Anstieg · m', 'Climb · m'),
            )
          : null}
      </div>
    </div>
    ${rpe ? section(tx.t('Gefühl', 'Effort'), copy(rpe)) : null}
    ${run.note ? section(tx.t('Notiz', 'Note'), copy(run.note)) : null}
    ${chart
      ? section(
          tx.t('Verlauf', 'Trace'),
          html`${metrics.length > 1
            ? chips(
                tx.t('Kennzahl im Verlauf', 'Metric in the trace'),
                metrics.map(entry => ({
                  value: entry,
                  label: metricName(tx, entry),
                })),
                metric,
                value =>
                  tx.link(`/run/${encodeURIComponent(id)}`, { wert: value }),
              )
            : null}${chart}`,
        )
      : null}
    ${splits.length
      ? section(
          tx.t('Kilometer', 'Kilometers'),
          table(
            [
              { label: 'km' },
              { label: tx.t('Tempo', 'Pace'), numeric: true },
              { label: tx.t('Puls', 'Heart rate'), numeric: true },
              { label: tx.t('Anstieg', 'Climb'), numeric: true },
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
            tx.t('Kilometerabschnitte', 'Kilometer splits'),
          ),
        )
      : null}
    ${detail.route
      ? section(tx.t('Strecke', 'Route'), routeShape(tx, detail.route as any))
      : null}
    ${section(
      null,
      disclosure(
        tx.t('Details', 'Details'),
        tx.t('Herkunft und Modell', 'Source and model'),
        html`
          ${row({ title: tx.t('Quelle', 'Source'), value: run.source })}
          ${row({
            title: tx.t('Distanzmodell', 'Distance model'),
            value: run.model_version ?? DASH,
          })}
          ${row({
            title: tx.t('Messpunkte', 'Samples'),
            value: run.samples ? String(run.samples) : DASH,
          })}
          ${row({
            title: tx.t('Puls von', 'Heart rate from'),
            value: run.sensorSources?.heartRate ?? DASH,
          })}
          ${row({
            title: tx.t('GPS von', 'GPS from'),
            value: run.sensorSources?.gps ?? DASH,
          })}
          ${!detail.route
            ? copy(
                tx.t(
                  'Die Strecke fehlt, weil GPS-Strecken in der App nicht freigegeben sind oder es keine gibt.',
                  'The route is missing because GPS routes are not shared in the app, or there are none.',
                ),
                true,
              )
            : null}
        `,
      ),
    )}
  `;
  return page(
    tx,
    {
      title: runTitle(run),
      tab: 'history',
      status: syncStatus(tx, ctx.data, ctx.now),
    },
    body,
  );
}

export function strengthPage(ctx: PageContext, id: string): Html | null {
  const { tx } = ctx;
  const session = ctx.data.strength.find(entry => entry.id === id);
  if (!session) return null;
  const heart = ctx.data.heart[id];
  const seconds = sessionSeconds(session);
  const sets = completedSets(session);
  const sessionTitle = session.name
    ? displaySessionName(session.name)
    : tx.t('Krafttraining', 'Strength training');
  const body = html`
    ${title(sessionTitle)}
    ${copy(
      `${longDate(tx, session.startTime)} · ${clock(tx, session.startTime)}`,
      true,
    )}
    <div class="section">
      <div class="tiles">
        ${stat(
          seconds === null ? DASH : formatDuration(seconds),
          tx.t('Dauer', 'Duration'),
        )}
        ${stat(
          String(sets),
          tx.t(sets === 1 ? 'Satz' : 'Sätze', sets === 1 ? 'set' : 'sets'),
        )}
        ${heart
          ? stat(
              String(Math.round(heart.averageBpm)),
              tx.t('Ø Puls · bpm', 'Avg heart rate · bpm'),
            )
          : null}
        ${heart
          ? stat(
              String(Math.round(heart.maxBpm)),
              tx.t('Höchster Puls · bpm', 'Max heart rate · bpm'),
            )
          : null}
      </div>
    </div>
    ${session.note ? section(tx.t('Notiz', 'Note'), copy(session.note)) : null}
    ${session.exercises.map(exercise =>
      section(
        exerciseDisplayName(exercise.exerciseId, exercise.name),
        table(
          [
            { label: tx.t('Satz', 'Set') },
            { label: tx.t('Ergebnis', 'Result') },
            { label: tx.t('Vorgabe', 'Target') },
            { label: 'RIR', numeric: true },
            { label: '' },
          ],
          exercise.sets.map((set, index) => {
            const done = isSetCompleted(set) && !set.skipped;
            const actual = setText(tx, {
              weightKg: set.actualWeightKg,
              reps: set.actualReps,
              seconds: set.actualSeconds,
            });
            const planned = setText(tx, {
              weightKg: set.planned?.weightKg,
              reps: set.planned?.reps,
              seconds: set.planned?.seconds,
            });
            return {
              cells: [
                String(index + 1),
                done ? actual || DASH : DASH,
                planned || DASH,
                set.actualRir === undefined
                  ? DASH
                  : decimal(tx, set.actualRir, 0),
                set.skipped
                  ? badge(tx.t('Übersprungen', 'Skipped'), 'muted')
                  : !done
                  ? badge(tx.t('Offen', 'Open'), 'muted')
                  : set.planned?.kind === 'warmup'
                  ? badge(tx.t('Aufwärmen', 'Warm-up'), 'muted')
                  : null,
              ],
            };
          }),
          exerciseDisplayName(exercise.exerciseId, exercise.name),
        ),
      ),
    )}
    ${section(
      null,
      disclosure(
        tx.t('Details', 'Details'),
        tx.t('Herkunft und Modell', 'Source and model'),
        html`
          ${row({
            title: tx.t('Quelle', 'Source'),
            value: session.importSource
              ? session.importSource.source
              : 'Runback',
          })}
          ${row({
            title: tx.t('Übungen', 'Exercises'),
            value: counted(
              tx,
              session.exercises.length,
              ['Übung', 'Übungen'],
              ['exercise', 'exercises'],
            ),
          })}
          ${row({
            title: tx.t('Modell', 'Model'),
            value: session.modelVersion || DASH,
          })}
          ${row({
            title: tx.t('Katalog', 'Catalog'),
            value: session.catalogVersion || DASH,
          })}
          ${session.endCorrection
            ? row({
                title: tx.t('Ende', 'End'),
                value: tx.t('In der App korrigiert', 'Corrected in the app'),
              })
            : null}
          ${session.importSource?.incomplete
            ? copy(
                tx.t(
                  'Der Import war unvollständig; fehlende Werte bleiben leer.',
                  'The import was incomplete; missing values stay empty.',
                ),
                true,
              )
            : null}
        `,
      ),
    )}
  `;
  return page(
    tx,
    {
      title: sessionTitle,
      tab: 'history',
      status: syncStatus(tx, ctx.data, ctx.now),
    },
    body,
  );
}
