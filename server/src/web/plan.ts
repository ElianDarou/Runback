import type { PageContext } from './context';
import { syncStatus } from './context';
import { html } from './html';
import {
  badge,
  copy,
  disclosure,
  emptyState,
  page,
  row,
  section,
  title,
} from './ui';
import { date, decimal, counted } from './format';
import { loadObject } from '../records';
import { catalogExercise } from '../../../src/domain/catalog';

/** Nur bereits gespeicherte Termine und Vorlagen; der Server erzeugt keinen Plan. */
export function planPage(ctx: PageContext) {
  const settings = ctx.data.settings;
  const sessions = settings?.schedule?.sessions ?? [];
  const templates = loadObject(ctx.store, 'templates')?.templates;
  const appointments = !settings
    ? emptyState(
        'Noch kein Plan übertragen',
        'Gib in der App „Coach“ für deinen Server frei.',
      )
    : !sessions.length
    ? emptyState('Noch keine Termine', 'Plane deine Einheiten in der App.')
    : section(
        'Deine Termine',
        [...sessions]
          .sort((a, b) => a.date.localeCompare(b.date))
          .map(entry =>
            row({
              title: entry.title,
              subtitle: `${date(
                new Date(`${entry.date}T12:00:00`).getTime(),
              )} · ${
                entry.kind === 'strength' ? 'Krafttraining' : 'Laufen'
              } · ${entry.minutes.toLocaleString('de-DE')} Minuten`,
              value: badge(
                entry.status === 'skipped'
                  ? 'Übersprungen'
                  : entry.activityId
                  ? 'Verknüpft'
                  : 'Geplant',
                'muted',
              ),
            }),
          ),
      );
  const strengthTemplates =
    Array.isArray(templates) && templates.length
      ? section(
          'Vorlagen',
          templates.map(template => {
            const exercises = Array.isArray(template.exercises)
              ? template.exercises
              : [];
            return disclosure(
              template.name || 'Krafttraining',
              null,
              exercises.map((exercise: any) =>
                row({
                  title:
                    exercise.name ??
                    catalogExercise(exercise.exerciseId)?.name ??
                    'Unbekannte Übung',
                  subtitle: Array.isArray(exercise.sets) ? counted(exercise.sets.length, 'Satz', 'Sätze') : '–', 
                }),
              ),
            );
          }),
        )
      : null;
  const presets =
    Array.isArray(settings?.presets) && settings.presets.length
      ? section(
          'Laufvorlagen',
          settings.presets.map((preset: any) =>
            row({
              title: preset.name ?? 'Lauf',
              subtitle:
                typeof preset.minutes === 'number'
                  ? `${decimal(preset.minutes, 0)} Minuten`
                  : undefined,
            }),
          ),
        )
      : null;
  return page(
    { title: 'Plan', tab: 'Plan', status: syncStatus(ctx.data, ctx.now) },
    html`${title('Plan')}${appointments}${strengthTemplates}${presets}${copy(
      'Ändere deinen Plan in der App.',
      true,
    )}`,
  );
}
