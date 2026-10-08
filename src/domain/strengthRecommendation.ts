import { couplingGate, isStrengthRecommendation } from './areas';
import { catalogExercise, exerciseDisplayName } from './catalog';
import { focusTypesFor, type TrainingFocus } from './focus';
import { relevance, RELEVANCE_VERSION } from './prioritization';
import { median, signTest } from './inference';
import { locale, tr } from './i18n';
import {
  assessExerciseProgression,
  bestWorkingSet,
  PROGRESSION_CHECK_METHOD,
  PROGRESSION_MODEL_VERSION,
} from './progression';
import type { StrengthSession } from './strength';
import type {
  Adherence,
  Experiment,
  ExperimentEvaluation,
  ExperimentStatus,
  StrengthRecommendation,
} from './types';

/**
 * Recommendations in the strength training area. One unlocked action class:
 * the load of an exercise (`strength_load`), derived from the e1RM trend in
 * progression.ts. Setup, acceptance and review follow the same rules as for
 * running: set them beforehand, keep follow-through and result apart, and
 * claim no cause.
 */
export const STRENGTH_RECOMMENDATION_VERSION = 'strength-load-v2';
const DAY = 86400000;
/** Fixed in advance: only from six sessions can the sign test reach 5 %. */
const MINIMUM_OUTCOME_SESSIONS = 6;
const SIGN_TEST_ALPHA = 0.05;
/** Share from which a region counts as a main region of the exercise. */
const MAIN_REGION_SHARE = 0.15;

const kg = (value: number) =>
  value.toLocaleString(locale(), { maximumFractionDigits: 1 });

export function exerciseRegions(exerciseId: string): string[] {
  const shares = catalogExercise(exerciseId)?.shares ?? {};
  return Object.entries(shares)
    .filter(([, share]) => (share ?? 0) >= MAIN_REGION_SHARE)
    .map(([region]) => region)
    .sort();
}

/** Builds at most one recommendation from an exercise's trend. */
export function strengthRecommendationFor(
  sessions: StrengthSession[],
  exerciseId: string,
  now: number,
): { recommendation?: StrengthRecommendation; reason: string } {
  const finished = sessions.filter(session => session.status === 'finished');
  const assessment = assessExerciseProgression(finished, exerciseId, {
    nextSessionAt: now,
  });
  const suggestion = assessment.suggestion;
  if (!suggestion || assessment.verdict === 'not_assessable') {
    return { reason: assessment.reason };
  }
  if (suggestion.verdict === 'keep_going') {
    return { reason: assessment.reason };
  }
  const storedName =
    finished
      .flatMap(session => session.exercises)
      .find(exercise => exercise.exerciseId === exerciseId)?.name ??
    catalogExercise(exerciseId)?.name ??
    exerciseId;
  const name = exerciseDisplayName(exerciseId, storedName);
  const range = suggestion.targetRange;
  const last = assessment.series[assessment.series.length - 1];
  const baseline = assessment.series.slice(-3);
  const target = `${kg(range.minKg)}–${kg(range.maxKg)} kg × ${range.reps}`;
  const direction = suggestion.verdict;
  const action =
    direction === 'increase'
      ? tr(`Geh bei ${name} auf ${target}.`, `Go to ${target} for ${name}.`)
      : direction === 'reduce'
      ? tr(
          `Nimm bei ${name} etwas raus: ${target}.`,
          `Take a little weight off ${name}: ${target}.`,
        )
      : tr(
          `Probiere bei ${name} drei Einheiten ${target}.`,
          `Try ${name} at ${target} for three sessions.`,
        );
  return {
    recommendation: {
      model_version: STRENGTH_RECOMMENDATION_VERSION,
      inputSources: assessment.inputSources,
      segmentIds: baseline.map(point => point.setId),
      id: `strength_load:${exerciseId}:${last.sessionId}:${direction}`,
      kind: 'strength_load',
      area: 'strength',
      title: tr('Last anpassen', 'Adjust the load'),
      action,
      reason: suggestion.reason,
      goal: tr(
        `In den umgesetzten Einheiten liegt dein bestes Arbeits-e1RM bei ${name} häufiger als zufällig mindestens ${suggestion.checkCriterion.minimumRelevantChangePercent} % über dem Median der Vergleichseinheiten.`,
        `In the followed sessions, your best working e1RM for ${name} is at least ${suggestion.checkCriterion.minimumRelevantChangePercent} % above the median of the comparison sessions more often than chance.`,
      ),
      exerciseId,
      exerciseName: name,
      direction,
      regions: exerciseRegions(exerciseId),
      criteria: {
        method: PROGRESSION_CHECK_METHOD,
        exerciseId,
        baselineSessionIds: baseline.map(point => point.sessionId),
        baselineE1RM: median(baseline.map(point => point.e1rm)),
        targetMinKg: range.minKg,
        targetMaxKg: range.maxKg,
        targetReps: range.reps,
        outcome: 'best_working_e1rm_percent',
        minimumRelevantChangePercent:
          suggestion.checkCriterion.minimumRelevantChangePercent,
        signTestAlpha: SIGN_TEST_ALPHA,
        minimumObservations: MINIMUM_OUTCOME_SESSIONS,
        reviewAfterSessions: suggestion.checkCriterion.reviewAfterSessions,
        maxDays: 42,
        exclusions: [
          tr(
            'Aufwärm-, Drop- und Zeitsätze zählen nicht.',
            'Warm-up, drop and timed sets do not count.',
          ),
          tr(
            'Einheiten ohne abgeschlossenen Arbeitssatz dieser Übung zählen nicht.',
            'Sessions without a completed working set for this exercise do not count.',
          ),
        ],
        stopConditions: [
          tr(
            'Schmerzen oder starker gemeldeter Muskelkater in den beteiligten Regionen: Empfehlung pausieren.',
            'Pain or strong reported soreness in the involved regions: pause the recommendation.',
          ),
        ],
      },
    },
    reason: assessment.reason,
  };
}

export interface ConsideredStrengthRecommendation {
  exerciseId: string;
  exerciseName: string;
  recommendation?: StrengthRecommendation;
  reason: string;
}

/** Same exercise, same direction: the same recommendation. */
export function sameStrengthRecommendation(
  a: StrengthRecommendation,
  b: StrengthRecommendation,
): boolean {
  return a.exerciseId === b.exerciseId && a.direction === b.direction;
}

/** Read-only selection per exercise; at most one recommendation comes out. */
export function selectStrengthRecommendation(
  sessions: StrengthSession[],
  options: {
    active?: Experiment;
    /** Active recommendations of other areas for the coupling lock. */
    otherActive?: Experiment[];
    experiments?: Experiment[];
    dismissed?: string[];
    postponedUntil?: number;
    focus?: TrainingFocus | null;
    targetDate?: string;
    today: string;
    now: number;
  },
): {
  selected?: StrengthRecommendation;
  alternatives: ConsideredStrengthRecommendation[];
} {
  const finished = sessions.filter(session => session.status === 'finished');
  const names = new Map<string, string>();
  for (const session of finished) {
    for (const exercise of session.exercises) {
      if (!names.has(exercise.exerciseId)) {
        names.set(exercise.exerciseId, exercise.name);
      }
    }
  }
  const alternatives: ConsideredStrengthRecommendation[] = [];
  const eligible: {
    recommendation: StrengthRecommendation;
    quality: number;
  }[] = [];
  for (const [exerciseId, exerciseName] of [...names.entries()].sort()) {
    // Data after acceptance may carry a preview, not the old data.
    const usable = options.active
      ? finished.filter(
          session =>
            session.startTime > (options.active as Experiment).acceptedAt,
        )
      : finished;
    const { recommendation, reason } = strengthRecommendationFor(
      usable,
      exerciseId,
      options.now,
    );
    const reject = (why: string) =>
      alternatives.push({
        exerciseId,
        exerciseName,
        recommendation,
        reason: why,
      });
    if (!recommendation) {
      reject(reason);
      continue;
    }
    if (
      options.experiments?.some(
        item =>
          item.recommendation.id === recommendation.id ||
          (isStrengthRecommendation(item.recommendation) &&
            item.recommendation.criteria.baselineSessionIds.some(id =>
              recommendation.criteria.baselineSessionIds.includes(id),
            )),
      )
    ) {
      reject(
        tr(
          'Diese Einheiten wurden bereits für eine angenommene Empfehlung verwendet.',
          'These sessions were already used for an accepted recommendation.',
        ),
      );
      continue;
    }
    if (options.dismissed?.includes(recommendation.id)) {
      reject(tr('Diesen Vorschlag hast du abgelehnt.', 'You declined this suggestion.'));
      continue;
    }
    if (
      options.active &&
      isStrengthRecommendation(options.active.recommendation) &&
      sameStrengthRecommendation(recommendation, options.active.recommendation)
    ) {
      reject(tr('Das ist bereits deine laufende Empfehlung.', 'This is already your active recommendation.'));
      continue;
    }
    const priority = relevance(
      'strength_load',
      options.focus?.kind,
      options.targetDate,
      options.today,
    );
    if (priority.blocked) {
      reject(priority.blocked);
      continue;
    }
    const coupling = couplingGate(recommendation, options.otherActive ?? []);
    if (coupling.blocked) {
      reject(coupling.blocked);
      continue;
    }
    if (options.postponedUntil && options.postponedUntil > options.now) {
      reject(tr('Du hast die Entscheidung auf später verschoben.', 'You postponed the decision.'));
      continue;
    }
    eligible.push({
      recommendation: {
        ...recommendation,
        priority: {
          version: RELEVANCE_VERSION,
          focusLabel:
            focusTypesFor('strength').find(
              item => item.value === options.focus?.kind,
            )?.label || tr('Kein Fokus', 'No focus'),
          weight: priority.weight,
        },
      },
      quality: recommendation.inputSources.length,
    });
  }
  // More sessions in the trend means a sturdier basis. Then the fixed ID decides.
  eligible.sort(
    (a, b) =>
      b.recommendation.priority!.weight - a.recommendation.priority!.weight ||
      b.quality - a.quality ||
      a.recommendation.id.localeCompare(b.recommendation.id),
  );
  const selected = eligible[0]?.recommendation;
  for (const item of eligible.slice(1)) {
    alternatives.push({
      exerciseId: item.recommendation.exerciseId,
      exerciseName: item.recommendation.exerciseName,
      recommendation: item.recommendation,
      reason:
        item.quality < eligible[0].quality
          ? tr(
              'Für den gewählten Vorschlag liegen mehr Einheiten im Verlauf vor.',
              'The chosen suggestion has more sessions in its trend.',
            )
          : tr(
              'Gleich gut geeignet. Bei Gleichstand entscheidet eine feste Reihenfolge.',
              'Equally suitable. A fixed order decides a tie.',
            ),
    });
  }
  return { selected, alternatives };
}

function activeAt(experiment: Experiment, time: number): boolean {
  let status: ExperimentStatus | undefined;
  for (const event of experiment.history) {
    if (event.at <= time) status = event.status;
  }
  return status === 'active';
}

/** Checks an accepted load recommendation against later sessions. */
export function evaluateStrengthExperiment(
  experiment: Experiment<StrengthRecommendation>,
  sessions: StrengthSession[],
  reported: Record<string, Adherence> = {},
): ExperimentEvaluation {
  const c = experiment.recommendation.criteria;
  const result: ExperimentEvaluation = {
    model_version: PROGRESSION_MODEL_VERSION,
    inputSources: [],
    segmentIds: [],
    verdict: 'insufficient_evidence',
    summary: tr(
      'Noch keine geeigneten Folgeeinheiten. Die Umsetzung und das Ergebnis werden getrennt geprüft.',
      'No suitable follow-up sessions yet. Follow-through and result are checked separately.',
    ),
    eligibleRunIds: [],
    excluded: [],
    adherence: [],
    causalClaim: false,
  };
  if (
    c.method !== PROGRESSION_CHECK_METHOD ||
    experiment.recommendation.model_version !== STRENGTH_RECOMMENDATION_VERSION
  ) {
    return {
      ...result,
      summary:
        tr(
          'Der gespeicherte Modellstand ist hier nicht verfügbar. Die vor dem Start festgelegten Regeln bleiben erhalten.',
          'The saved model version is not available here. The rules set before the start still apply.',
        ),
    };
  }
  const outcomes: { sessionId: string; e1rm: number }[] = [];
  const ordered = [...sessions].sort(
    (a, b) => a.startTime - b.startTime || a.id.localeCompare(b.id),
  );
  for (const session of ordered) {
    if (
      session.startTime <= experiment.acceptedAt ||
      c.baselineSessionIds.includes(session.id)
    ) {
      continue;
    }
    const exclude = (reason: string) =>
      result.excluded.push({ runId: session.id, reason });
    if (session.status !== 'finished') {
      exclude(tr('Einheit nicht abgeschlossen.', 'Session not finished.'));
      continue;
    }
    if (!activeAt(experiment, session.startTime)) {
      exclude(tr('Empfehlung war bei Beginn der Einheit nicht aktiv.', 'Recommendation was not active when the session started.'));
      continue;
    }
    if (session.startTime > experiment.acceptedAt + c.maxDays * DAY) {
      exclude(tr('Vorab festgelegter Beobachtungszeitraum abgelaufen.', 'Observation period set in advance has ended.'));
      continue;
    }
    const best = bestWorkingSet(session, c.exerciseId);
    if (!best) {
      exclude(tr('Kein abgeschlossener Arbeitssatz dieser Übung.', 'No completed working set for this exercise.'));
      continue;
    }
    result.eligibleRunIds.push(session.id);
    result.inputSources.push({
      runId: session.id,
      source: 'strength-session',
      version: session.modelVersion,
    });
    let value = reported[session.id];
    let source: 'reported' | 'derived' | 'unknown' = value
      ? 'reported'
      : 'derived';
    if (!value) {
      value =
        best.weightKg >= c.targetMinKg - 0.01 &&
        best.weightKg <= c.targetMaxKg + 0.01
          ? 'yes'
          : 'no';
    }
    if (value === 'unknown') source = 'unknown';
    result.adherence.push({ runId: session.id, value, source });
    if (value === 'yes') {
      outcomes.push({ sessionId: session.id, e1rm: best.e1rm });
    }
  }
  if (
    result.adherence.length >= c.reviewAfterSessions &&
    result.adherence.every(item => item.value === 'no')
  ) {
    return {
      ...result,
      verdict: 'not_implemented',
      summary: tr(
        'Du hast die neue Last bisher nicht probiert. Ob sie hilft, bleibt noch offen.',
        'You have not tried the new load yet. Whether it helps is still open.',
      ),
    };
  }
  if (!outcomes.length) return result;
  const changes = outcomes.map(
    item => ((item.e1rm - c.baselineE1RM) / c.baselineE1RM) * 100,
  );
  result.changePercentPoints =
    changes.reduce((a, b) => a + b, 0) / changes.length;
  result.observedRange = [Math.min(...changes), Math.max(...changes)];
  if (outcomes.length < c.minimumObservations) {
    result.summary = tr(
      `${outcomes.length} umgesetzte, geeignete Einheiten; Prüfung ab ${c.minimumObservations} Einheiten. Der beobachtete Unterschied beweist keine Ursache.`,
      `${outcomes.length} suitable ${outcomes.length === 1 ? 'session' : 'sessions'} followed; the check starts at ${c.minimumObservations} sessions. The observed difference proves no cause.`,
    );
    return result;
  }
  const causal = tr(' Beobachtung, kein Ursachennachweis.', ' An observation, not proof of a cause.');
  const test = signTest(changes, c.minimumRelevantChangePercent);
  result.signTest = { ...test, alpha: c.signTestAlpha };
  if (test.pValue <= c.signTestAlpha && test.positives > test.negatives) {
    return {
      ...result,
      verdict: 'improved',
      summary: tr(
        `Dein bestes Arbeits-e1RM lag in ${test.positives} von ${outcomes.length} umgesetzten Einheiten mindestens ${c.minimumRelevantChangePercent} % über den Vergleichseinheiten; das ist häufiger als zufällig.${causal}`,
        `Your best working e1RM was at least ${c.minimumRelevantChangePercent} % above the comparison sessions in ${test.positives} of ${outcomes.length} followed sessions; that is more often than chance.${causal}`,
      ),
    };
  }
  if (test.pValue <= c.signTestAlpha && test.negatives > test.positives) {
    return {
      ...result,
      verdict: 'worsened',
      summary: tr(
        `Dein bestes Arbeits-e1RM lag in ${test.negatives} von ${outcomes.length} umgesetzten Einheiten mindestens ${c.minimumRelevantChangePercent} % unter den Vergleichseinheiten; das ist häufiger als zufällig.${causal}`,
        `Your best working e1RM was at least ${c.minimumRelevantChangePercent} % below the comparison sessions in ${test.negatives} of ${outcomes.length} followed sessions; that is more often than chance.${causal}`,
      ),
    };
  }
  if (test.ties === changes.length) {
    return {
      ...result,
      verdict: 'no_relevant_effect',
      summary: tr(
        `Alle ${outcomes.length} umgesetzten Einheiten lagen innerhalb von ±${c.minimumRelevantChangePercent} % der Vergleichseinheiten.${causal}`,
        `All ${outcomes.length} followed sessions were within ±${c.minimumRelevantChangePercent} % of the comparison sessions.${causal}`,
      ),
    };
  }
  return {
    ...result,
    summary: tr(
      `Noch nicht klar. ${test.positives} Einheiten besser, ${test.negatives} schlechter, ${test.ties} unverändert; das kann Zufall sein.${causal}`,
      `Not clear yet. ${test.positives} ${test.positives === 1 ? 'session' : 'sessions'} better, ${test.negatives} worse, ${test.ties} unchanged; this may be chance.${causal}`,
    ),
  };
}
