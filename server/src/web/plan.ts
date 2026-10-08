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
import { counted, date, decimal, numberFormat } from './format';
import { loadObject } from '../records';
import { catalogExercise } from '../../../src/domain/catalog';

/** Only appointments and templates already saved; the server creates no plan. */
export function planPage(ctx: PageContext) {
  const { tx } = ctx;
  const settings = ctx.data.settings;
  const sessions = settings?.schedule?.sessions ?? [];
  const templates = loadObject(ctx.store, 'templates')?.templates;
  const appointments = !settings
    ? emptyState(
        tx.t('Noch kein Plan übertragen', 'No plan transferred yet'),
        tx.t(
          'Gib in der App „Coach“ für deinen Server frei.',
          'Share “Coach” with your server in the app.',
        ),
      )
    : !sessions.length
    ? emptyState(
        tx.t('Noch keine Termine', 'No appointments yet'),
        tx.t(
          'Plane deine Einheiten in der App.',
          'Plan your workouts in the app.',
        ),
      )
    : section(
        tx.t('Deine Termine', 'Your appointments'),
        [...sessions]
          .sort((a, b) => a.date.localeCompare(b.date))
          .map(entry =>
            row({
              title: entry.title,
              subtitle: `${date(
                tx,
                new Date(`${entry.date}T12:00:00`).getTime(),
              )} · ${
                entry.kind === 'strength'
                  ? tx.t('Krafttraining', 'Strength training')
                  : tx.t('Laufen', 'Running')
              } · ${numberFormat(tx).format(entry.minutes)} ${tx.t(
                'Minuten',
                'minutes',
              )}`,
              value: badge(
                entry.status === 'skipped'
                  ? tx.t('Übersprungen', 'Skipped')
                  : entry.activityId
                  ? tx.t('Verknüpft', 'Linked')
                  : tx.t('Geplant', 'Planned'),
                'muted',
              ),
            }),
          ),
      );
  const strengthTemplates =
    Array.isArray(templates) && templates.length
      ? section(
          tx.t('Vorlagen', 'Templates'),
          templates.map(template => {
            const exercises = Array.isArray(template.exercises)
              ? template.exercises
              : [];
            return disclosure(
              template.name || tx.t('Krafttraining', 'Strength training'),
              null,
              exercises.map((exercise: any) =>
                row({
                  title:
                    exercise.name ??
                    catalogExercise(exercise.exerciseId)?.name ??
                    tx.t('Unbekannte Übung', 'Unknown exercise'),
                  subtitle: Array.isArray(exercise.sets)
                    ? counted(
                        tx,
                        exercise.sets.length,
                        ['Satz', 'Sätze'],
                        ['set', 'sets'],
                      )
                    : '–',
                }),
              ),
            );
          }),
        )
      : null;
  const presets =
    Array.isArray(settings?.presets) && settings.presets.length
      ? section(
          tx.t('Laufvorlagen', 'Running presets'),
          settings.presets.map((preset: any) =>
            row({
              title: preset.name ?? tx.t('Lauf', 'Run'),
              subtitle:
                typeof preset.minutes === 'number'
                  ? tx.t(
                      `${decimal(tx, preset.minutes, 0)} Minuten`,
                      `${decimal(tx, preset.minutes, 0)} minutes`,
                    )
                  : undefined,
            }),
          ),
        )
      : null;
  return page(
    tx,
    {
      title: tx.t('Plan', 'Plan'),
      tab: 'plan',
      status: syncStatus(tx, ctx.data, ctx.now),
    },
    html`${title(
      tx.t('Plan', 'Plan'),
    )}${appointments}${strengthTemplates}${presets}${copy(
      tx.t('Ändere deinen Plan in der App.', 'Change your plan in the app.'),
      true,
    )}`,
  );
}
