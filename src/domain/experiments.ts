import {
  analyzeRun,
  flatPacingContext,
  MODEL_VERSION,
  LEGACY_MODEL_VERSION,
  PACING_METHOD,
  pacingFor,
  provenance,
} from './analysis';
import { signTest } from './inference';
import { tr } from './i18n';
import { samePurpose } from './runTitle';
import { isRunRecommendation, recommendationArea } from './areas';
import type { StrengthSession } from './strength';
import { evaluateStrengthExperiment } from './strengthRecommendation';
import {
  Adherence,
  AnyRecommendation,
  Experiment,
  ExperimentEvaluation,
  ExperimentStatus,
  Recommendation,
  RunSummary,
} from './types';

const DAY = 86400000;
/** Clone before freezing: an accepted experiment never shares mutable proposal state. */
function immutable<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.values(value as Record<string, unknown>).forEach(immutable);
    Object.freeze(value);
  }
  return value;
}
/**
 * `existing` is the open recommendation of the same area. At most one runs
 * per area; another area does not block acceptance.
 */
export function acceptRecommendation<R extends AnyRecommendation>(
  recommendation: R,
  now: number,
  existing?: Experiment,
): Experiment<R> {
  if (!Number.isFinite(now)) {
    throw new Error(
      tr('Ungültiger Annahmezeitpunkt.', 'Invalid acceptance time.'),
    );
  }
  if (
    existing &&
    (existing.status === 'active' || existing.status === 'paused') &&
    recommendationArea(existing.recommendation) ===
      recommendationArea(recommendation)
  ) {
    throw new Error(
      tr(
        'Zuerst die bestehende Empfehlung beenden.',
        'End the existing recommendation first.',
      ),
    );
  }
  const snapshot = JSON.parse(JSON.stringify(recommendation)) as R;
  return immutable({
    id: `experiment:${recommendation.id}:${now}`,
    recommendation: snapshot,
    acceptedAt: now,
    status: 'active',
    history: [
      {
        at: now,
        status: 'active',
        reason: tr(
          'Empfehlung und Regeln für die Prüfung angenommen.',
          'Recommendation and review rules accepted.',
        ),
      },
    ],
  } as Experiment<R>);
}
export function transitionExperiment<R extends AnyRecommendation>(
  experiment: Experiment<R>,
  status: ExperimentStatus,
  now: number,
  reason: string,
): Experiment<R> {
  if (!reason.trim()) {
    throw new Error(
      tr(
        'Ein Zustandswechsel braucht eine Begründung.',
        'A status change needs a reason.',
      ),
    );
  }
  if (
    !Number.isFinite(now) ||
    now < experiment.history[experiment.history.length - 1].at
  ) {
    throw new Error(
      tr(
        'Zeitpunkt liegt vor der letzten Änderung.',
        'The time is before the last change.',
      ),
    );
  }
  if (experiment.status === 'completed' || experiment.status === 'aborted') {
    throw new Error(
      tr(
        'Beendete Empfehlungen bleiben unverändert.',
        'Completed recommendations stay unchanged.',
      ),
    );
  }
  if (status === experiment.status) {
    return experiment;
  }
  return immutable({
    ...experiment,
    status,
    history: [
      ...experiment.history,
      { at: now, status, reason: reason.trim() },
    ],
  });
}

export function uniqueRuns(runs: RunSummary[]): RunSummary[] {
  const seen = new Set<string>();
  // Native storage owns cross-format deduplication. Canonical IDs preserve independent evidence.
  return runs.filter(run => {
    const id = run.canonicalId ?? run.id;
    if (seen.has(id)) {
      return false;
    }
    seen.add(id);
    return true;
  });
}
function activeAt(experiment: Experiment, time: number): boolean {
  let status: ExperimentStatus | undefined;
  for (const event of experiment.history) {
    if (event.at <= time) {
      status = event.status;
    }
  }
  return status === 'active';
}
/** Checks a recommendation against the data of its area. */
export function evaluateAnyExperiment(
  experiment: Experiment,
  runs: RunSummary[],
  sessions: StrengthSession[],
  reported: Record<string, Adherence> = {},
): ExperimentEvaluation {
  return isRunRecommendation(experiment.recommendation)
    ? evaluateExperiment(
        experiment as Experiment<Recommendation>,
        runs,
        reported,
      )
    : evaluateStrengthExperiment(
        experiment as Experiment<import('./types').StrengthRecommendation>,
        sessions,
        reported,
      );
}
export function evaluateExperiment(
  experiment: Experiment<Recommendation>,
  runs: RunSummary[],
  reported: Record<string, Adherence> = {},
): ExperimentEvaluation {
  const c = experiment.recommendation.criteria;
  const modelVersion = experiment.recommendation.model_version;
  const result: ExperimentEvaluation = {
    ...provenance([]),
    model_version: modelVersion,
    verdict: 'insufficient_evidence',
    summary: tr(
      'Noch keine geeigneten Folgeläufe. Die Umsetzung und das Ergebnis werden getrennt geprüft.',
      'No suitable follow-up runs yet. Follow-through and the result are checked separately.',
    ),
    eligibleRunIds: [],
    excluded: [],
    adherence: [],
    causalClaim: false,
  };
  if (
    c.method !== PACING_METHOD ||
    ![MODEL_VERSION, LEGACY_MODEL_VERSION].includes(modelVersion)
  ) {
    return {
      ...result,
      summary: tr(
        'Der gespeicherte Modellstand ist hier nicht verfügbar. Die vor dem Start festgelegten Regeln bleiben erhalten.',
        'The saved model version is not available here. The rules set before the start stay in place.',
      ),
    };
  }
  const outcomes: { run: RunSummary; fade: number }[] = [];
  for (const run of uniqueRuns(runs).sort(
    (a, b) => a.startTime - b.startTime || a.id.localeCompare(b.id),
  )) {
    if (
      run.startTime <= experiment.acceptedAt ||
      c.baselineRunIds.includes(run.id)
    ) {
      continue;
    }
    const exclude = (reason: string) =>
      result.excluded.push({ runId: run.id, reason });
    if (!activeAt(experiment, run.startTime)) {
      exclude(
        tr(
          'Empfehlung war bei Laufbeginn nicht aktiv.',
          'Recommendation was not active when the run started.',
        ),
      );
      continue;
    }
    if (run.startTime > experiment.acceptedAt + c.maxDays * DAY) {
      exclude(
        tr(
          'Vorab festgelegter Beobachtungszeitraum abgelaufen.',
          'Observation period set in advance has ended.',
        ),
      );
      continue;
    }
    // Accepted checks retain their original grouping; only new checks combine
    // easy and long runs, with their fixed volume limits below.
    const matchesPurpose =
      modelVersion === LEGACY_MODEL_VERSION
        ? run.purpose === experiment.recommendation.purpose
        : samePurpose(run.purpose, experiment.recommendation.purpose);
    if (!matchesPurpose) {
      exclude(tr('Andere Laufart.', 'Different run type.'));
      continue;
    }
    if (
      Math.abs(run.durationSeconds / c.baselineDurationSeconds - 1) * 100 >
        c.durationTolerancePercent ||
      Math.abs(run.distanceMeters / c.baselineDistanceMeters - 1) * 100 >
        c.distanceTolerancePercent
    ) {
      exclude(
        tr(
          'Geplanter Umfang nicht ausreichend erhalten.',
          'Planned volume was not kept closely enough.',
        ),
      );
      continue;
    }
    const pacing = pacingFor(run);
    if (!pacing || !flatPacingContext(run, pacing)) {
      exclude(
        tr(
          'Vergleichbare flache Laufabschnitte fehlen.',
          'Comparable flat run sections are missing.',
        ),
      );
      continue;
    }
    const base = c.baselineContext;
    const current = run.context;
    if (
      base?.temperatureC !== undefined &&
      current?.temperatureC !== undefined &&
      Math.abs(base.temperatureC - current.temperatureC) > 5
    ) {
      exclude(
        tr(
          'Temperatur unterscheidet sich um mehr als 5 °C.',
          'Temperature differs by more than 5 °C.',
        ),
      );
      continue;
    }
    if (
      base?.windMps !== undefined &&
      current?.windMps !== undefined &&
      Math.abs(base.windMps - current.windMps) > 2
    ) {
      exclude(
        tr(
          'Wind unterscheidet sich um mehr als 2 m/s.',
          'Wind differs by more than 2 m/s.',
        ),
      );
      continue;
    }
    result.eligibleRunIds.push(run.id);
    let value = reported[run.id];
    let source: 'reported' | 'derived' | 'unknown' = value
      ? 'reported'
      : 'derived';
    if (!value) {
      value =
        Math.abs(pacing.firstPaceSecondsPerKm / c.openingPaceSecondsPerKm - 1) *
          100 <=
        c.openingPaceTolerancePercent
          ? 'yes'
          : 'no';
    }
    if (value === 'unknown') {
      source = 'unknown';
    }
    result.adherence.push({ runId: run.id, value, source });
    if (value === 'yes') {
      outcomes.push({ run, fade: pacing.fadePercent });
    }
  }
  result.inputSources = provenance(outcomes.map(o => o.run)).inputSources;
  if (
    result.adherence.length >= c.reviewAfterRuns &&
    result.adherence.every(a => a.value === 'no')
  ) {
    return {
      ...result,
      verdict: 'not_implemented',
      summary: tr(
        'Du hast den ruhigeren Start bisher nicht probiert. Ob er hilft, bleibt noch offen.',
        "You haven't tried the calmer start yet. Whether it helps is still open.",
      ),
    };
  }
  if (outcomes.length === 0) {
    return result;
  }
  const changes = outcomes.map(o => c.baselineFadePercent - o.fade);
  result.changePercentPoints =
    changes.reduce((a, b) => a + b, 0) / changes.length;
  result.observedRange = [Math.min(...changes), Math.max(...changes)];
  const enoughTime =
    outcomes[outcomes.length - 1].run.startTime - experiment.acceptedAt >=
    c.minimumDays * DAY;
  if (outcomes.length < c.minimumObservations || !enoughTime) {
    const interim =
      outcomes.length >= c.reviewAfterRuns
        ? tr('Zwischenstand verfügbar. ', 'Interim result available. ')
        : '';
    result.summary = tr(
      `${outcomes.length} umgesetzte, geeignete Läufe; Prüfung ab ${c.minimumObservations} Läufen über mindestens ${c.minimumDays} Tage. ${interim}Der beobachtete Unterschied beweist keine Ursache.`,
      `${outcomes.length} followed, suitable runs; review from ${c.minimumObservations} runs over at least ${c.minimumDays} days. ${interim}The observed difference does not prove a cause.`,
    );
    return result;
  }
  const weatherUnknown = outcomes.some(
    o =>
      c.baselineContext?.temperatureC === undefined ||
      c.baselineContext?.windMps === undefined ||
      o.run.context?.temperatureC === undefined ||
      o.run.context?.windMps === undefined,
  );
  const causal = tr(
    ` Beobachtung, kein Ursachennachweis.${
      weatherUnknown
        ? ' Fehlender Wetterkontext begrenzt die Zuordnung zusätzlich.'
        : ''
    }`,
    ` An observation, not proof of cause.${
      weatherUnknown
        ? ' Missing weather context further limits the attribution.'
        : ''
    }`,
  );
  // A calmer start already lowers the late fade by arithmetic. So the result
  // says "more even", never "faster" or "fitter".
  const test = signTest(changes, c.minimumRelevantChangePercentPoints);
  result.signTest = { ...test, alpha: c.signTestAlpha };
  if (test.pValue <= c.signTestAlpha && test.positives > test.negatives) {
    return {
      ...result,
      verdict: 'improved',
      summary: tr(
        `Bei gleicher Laufart und gleichem Umfang lief die zweite Hälfte in ${test.positives} von ${outcomes.length} umgesetzten Läufen gleichmäßiger als in den Vergleichsläufen; das ist häufiger als zufällig. Über Tempo oder Fitness sagt das nichts.${causal}`,
        `With the same run type and volume, the second half was more even than in the comparison runs in ${test.positives} of ${outcomes.length} followed runs; that is more often than chance. It says nothing about pace or fitness.${causal}`,
      ),
    };
  }
  if (test.pValue <= c.signTestAlpha && test.negatives > test.positives) {
    return {
      ...result,
      verdict: 'worsened',
      summary: tr(
        `In ${test.negatives} von ${outcomes.length} umgesetzten Läufen war der späte Tempoabfall größer als in den Vergleichsläufen; das ist häufiger als zufällig.${causal}`,
        `In ${test.negatives} of ${outcomes.length} followed runs, the late pace fade was larger than in the comparison runs; that is more often than chance.${causal}`,
      ),
    };
  }
  if (test.ties === changes.length) {
    return {
      ...result,
      verdict: 'no_relevant_effect',
      summary: tr(
        `Alle ${outcomes.length} umgesetzten Läufe lagen innerhalb von ±${c.minimumRelevantChangePercentPoints} Prozentpunkten der Vergleichsläufe.${causal}`,
        `All ${outcomes.length} followed runs were within ±${c.minimumRelevantChangePercentPoints} percentage points of the comparison runs.${causal}`,
      ),
    };
  }
  return {
    ...result,
    summary: tr(
      `Noch nicht klar. ${test.positives} Läufe gleichmäßiger, ${test.negatives} ungleichmäßiger, ${test.ties} unverändert; das kann Zufall sein.${causal}`,
      `Not clear yet. ${test.positives} runs more even, ${test.negatives} less even, ${test.ties} unchanged; this may be chance.${causal}`,
    ),
  };
}

export function recommend(
  run: RunSummary,
  active?: Experiment,
  history: RunSummary[] = [],
) {
  return analyzeRun(run, active, history);
}
