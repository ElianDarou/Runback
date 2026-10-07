import {
  activeExperimentFor,
  recommendationArea,
} from '../../../src/domain/areas';
import { focusLabel, type TrainingFocus } from '../../../src/domain/focus';
import type {
  Area,
  Experiment,
  ExperimentStatus,
} from '../../../src/domain/types';
import type { PageContext } from './context';
import { oneOf, param, syncStatus } from './context';
import { date, relative } from './format';
import { html, type Html } from './html';
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
 * Coach: Woran arbeite ich? Ziel, Fokus und Empfehlung je Bereich, so wie die
 * App sie zuletzt übertragen hat. Der Server bewertet nichts neu und schlägt
 * nichts vor; neue Empfehlungen entstehen nur in der App.
 */

const STATUS_LABEL: Record<ExperimentStatus, string> = {
  active: 'Aktiv',
  paused: 'Pausiert',
  completed: 'Abgeschlossen',
  aborted: 'Abgebrochen',
};

function goalLine(goal: unknown, targetDate: unknown): string | null {
  if (typeof goal !== 'string' || !goal.trim()) return null;
  const dateText =
    typeof targetDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(targetDate)
      ? ` · bis ${date(new Date(`${targetDate}T12:00:00`).getTime())}`
      : '';
  return `${goal.trim()}${dateText}`;
}

function recommendationCard(
  experiment: Experiment | undefined,
  ctx: PageContext,
): Html {
  if (!experiment) {
    return card(
      html`<h2 class="card-title">Keine aktive Empfehlung</h2>
        ${copy(
          'Neue Empfehlungen schlägt die App vor, wenn die Daten sie tragen.',
          true,
        )}`,
      { label: 'Empfehlung' },
    );
  }
  const recommendation = experiment.recommendation;
  return card(
    html`<div>
        ${badge(
          STATUS_LABEL[experiment.status],
          experiment.status === 'active' ? 'green' : 'muted',
        )}
      </div>
      <h2 class="card-title">
        ${recommendation.action || recommendation.title}
      </h2>
      ${copy(recommendation.reason, true)}
      ${recommendation.goal
        ? copy(`Woran wir erkennen, ob es hilft: ${recommendation.goal}`, true)
        : null}
      ${copy(
        `Angenommen ${relative(
          experiment.acceptedAt,
          ctx.now,
        )} · Stand aus der App · Modell ${recommendation.model_version || '–'}`,
        true,
      )}`,
    { accent: experiment.status === 'active', label: 'Empfehlung' },
  );
}

export function coachPage(ctx: PageContext): Html {
  const { data, now, url } = ctx;
  const status = syncStatus(data, now);
  const settings = data.settings;
  if (!settings) {
    return page(
      { title: 'Coach', tab: 'Coach', status },
      html`${title('Coach')}${emptyState(
        'Noch nichts übertragen',
        'Gib in der App den Bereich „Coach“ für deinen Server frei.',
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
      ? goalLine(settings.goal, settings.goalTargetDate)
      : goalLine(settings.strengthGoal, settings.strengthGoalTargetDate);
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
      'Bereich',
      [
        { value: 'running' as Area, label: 'Laufen' },
        { value: 'strength' as Area, label: 'Krafttraining' },
      ],
      area,
      value => `/coach?bereich=${value}`,
    )}
    <div class="section">${recommendationCard(active, ctx)}</div>
    ${section(
      null,
      html`
        ${row({ title: 'Ziel', subtitle: goal ?? 'Noch kein Ziel' })}
        ${row({
          title: 'Fokus',
          subtitle: focus ? focusLabel(focus) : 'Noch kein Fokus',
        })}
      `,
    )}
    ${history.length
      ? section(
          'Frühere Empfehlungen',
          history.map(entry =>
            row({
              title: entry.recommendation.action || entry.recommendation.title,
              subtitle: `${date(entry.acceptedAt)} · ${
                STATUS_LABEL[entry.status]
              }`,
              value: badge(
                STATUS_LABEL[entry.status],
                entry.status === 'active' ? 'green' : 'muted',
              ),
            }),
          ),
        )
      : null}
    ${section(
      null,
      disclosure(
        'So entsteht eine Empfehlung',
        'Regeln in der App, nicht auf dem Server',
        copy(
          'Runback wählt je Bereich höchstens eine Empfehlung und legt vorher fest, woran sie gemessen wird. Diese Seite zeigt den Stand, den dein Telefon zuletzt übertragen hat.',
          true,
        ),
      ),
    )}
  `;
  return page({ title: 'Coach', tab: 'Coach', status }, body);
}
