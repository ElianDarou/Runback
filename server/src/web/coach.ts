import {
  activeExperimentFor,
  recommendationArea,
} from '../../../src/domain/areas';
import type { TrainingFocus } from '../../../src/domain/focus';
import type {
  Area,
  Experiment,
  ExperimentStatus,
} from '../../../src/domain/types';
import type { PageContext } from './context';
import { oneOf, param, syncStatus } from './context';
import { date, relative } from './format';
import { html, type Html } from './html';
import type { Translator } from './i18n';
import { focusName } from './labels';
import {
  badge,
  card,
  copy,
  disclosure,
  emptyState,
  page,
  row,
  section,
  segmented,
  title,
} from './ui';

/**
 * Coach: what am I working on? Goal, focus and recommendation per area, as the
 * app last transferred them. The server re-evaluates nothing and suggests
 * nothing; new recommendations only come from the app.
 */

function statusLabel(tx: Translator, status: ExperimentStatus): string {
  switch (status) {
    case 'active':
      return tx.t('Aktiv', 'Active');
    case 'paused':
      return tx.t('Pausiert', 'Paused');
    case 'completed':
      return tx.t('Abgeschlossen', 'Completed');
    case 'aborted':
      return tx.t('Abgebrochen', 'Cancelled');
  }
}

function goalLine(
  tx: Translator,
  goal: unknown,
  targetDate: unknown,
): string | null {
  if (typeof goal !== 'string' || !goal.trim()) return null;
  const dateText =
    typeof targetDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(targetDate)
      ? tx.t(
          ` · bis ${date(tx, new Date(`${targetDate}T12:00:00`).getTime())}`,
          ` · until ${date(tx, new Date(`${targetDate}T12:00:00`).getTime())}`,
        )
      : '';
  return `${goal.trim()}${dateText}`;
}

function recommendationCard(
  tx: Translator,
  experiment: Experiment | undefined,
  ctx: PageContext,
): Html {
  if (!experiment) {
    const heading = tx.t('Keine aktive Empfehlung', 'No active recommendation');
    return card(
      html`<h2 class="card-title">${heading}</h2>
        ${copy(
          tx.t(
            'Neue Empfehlungen schlägt die App vor, wenn die Daten sie tragen.',
            'The app suggests new recommendations when the data supports them.',
          ),
          true,
        )}`,
      { label: tx.t('Empfehlung', 'Recommendation') },
    );
  }
  const recommendation = experiment.recommendation;
  const modelVersion = recommendation.model_version || '–';
  const accepted = relative(tx, experiment.acceptedAt, ctx.now);
  return card(
    html`<div>
        ${badge(
          statusLabel(tx, experiment.status),
          experiment.status === 'active' ? 'green' : 'muted',
        )}
      </div>
      <h2 class="card-title">
        ${recommendation.action || recommendation.title}
      </h2>
      ${copy(recommendation.reason, true)}
      ${recommendation.goal
        ? copy(
            tx.t(
              `Woran wir erkennen, ob es hilft: ${recommendation.goal}`,
              `How we will know it helped: ${recommendation.goal}`,
            ),
            true,
          )
        : null}
      ${copy(
        tx.t(
          `Angenommen ${accepted} · Stand aus der App · Modell ${modelVersion}`,
          `Accepted ${accepted} · As of the app · Model ${modelVersion}`,
        ),
        true,
      )}`,
    {
      accent: experiment.status === 'active',
      label: tx.t('Empfehlung', 'Recommendation'),
    },
  );
}

export function coachPage(ctx: PageContext): Html {
  const { data, now, url, tx } = ctx;
  const status = syncStatus(tx, data, now);
  const settings = data.settings;
  if (!settings) {
    return page(
      tx,
      { title: 'Coach', tab: 'coach', status },
      html`${title('Coach')}${emptyState(
        tx.t('Noch nichts übertragen', 'Nothing transferred yet'),
        tx.t(
          'Gib in der App den Bereich „Coach“ für deinen Server frei.',
          'Share the “Coach” area with your server in the app.',
        ),
      )}`,
    );
  }
  const area = oneOf<Area>(
    param(url, 'bereich'),
    ['running', 'strength'],
    'running',
  );
  const experiments = data.experiments;
  const active = activeExperimentFor(experiments, area as 'running');
  const goal =
    area === 'running'
      ? goalLine(tx, settings.goal, settings.goalTargetDate)
      : goalLine(tx, settings.strengthGoal, settings.strengthGoalTargetDate);
  const focus = (
    area === 'running' ? settings.trainingFocus : settings.strengthFocus
  ) as TrainingFocus | null | undefined;
  const history = experiments
    .filter(
      entry =>
        recommendationArea(entry.recommendation) === area && entry !== active,
    )
    .sort((a, b) => b.acceptedAt - a.acceptedAt);

  const body = html`
    ${title('Coach')}
    ${segmented(
      tx.t('Bereich', 'Area'),
      [
        { value: 'running' as Area, label: tx.t('Laufen', 'Running') },
        {
          value: 'strength' as Area,
          label: tx.t('Krafttraining', 'Strength training'),
        },
      ],
      area,
      value => tx.link('/coach', { bereich: value }),
    )}
    <div class="section">${recommendationCard(tx, active, ctx)}</div>
    ${section(
      null,
      html`
        ${row({
          title: tx.t('Ziel', 'Goal'),
          subtitle: goal ?? tx.t('Noch kein Ziel', 'No goal yet'),
        })}
        ${row({
          title: tx.t('Fokus', 'Focus'),
          subtitle: focus
            ? focusName(tx, focus)
            : tx.t('Noch kein Fokus', 'No focus yet'),
        })}
      `,
    )}
    ${history.length
      ? section(
          tx.t('Frühere Empfehlungen', 'Earlier recommendations'),
          history.map(entry =>
            row({
              title: entry.recommendation.action || entry.recommendation.title,
              subtitle: `${date(tx, entry.acceptedAt)} · ${statusLabel(
                tx,
                entry.status,
              )}`,
              value: badge(
                statusLabel(tx, entry.status),
                entry.status === 'active' ? 'green' : 'muted',
              ),
            }),
          ),
        )
      : null}
    ${section(
      null,
      disclosure(
        tx.t('So entsteht eine Empfehlung', 'How a recommendation comes about'),
        tx.t(
          'Regeln in der App, nicht auf dem Server',
          'Rules live in the app, not on the server',
        ),
        copy(
          tx.t(
            'Runback wählt je Bereich höchstens eine Empfehlung und legt vorher fest, woran sie gemessen wird. Diese Seite zeigt den Stand, den dein Telefon zuletzt übertragen hat.',
            'Runback picks at most one recommendation per area and decides beforehand how it will be measured. This page shows the state your phone last transferred.',
          ),
          true,
        ),
      ),
    )}
  `;
  return page(tx, { title: 'Coach', tab: 'coach', status }, body);
}
