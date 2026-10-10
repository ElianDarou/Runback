import {
  analyzeRun,
  assessQuality,
  formatPace,
  MODEL_VERSION,
} from './analysis';
import { uniqueRuns } from './experiments';
import {
  Experiment,
  Recommendation,
  RunAnalysis,
  RunPurpose,
  RunSummary,
} from './types';
import { tr } from './i18n';
import { comparablePurpose, samePurpose } from './runTitle';

export interface RunPreset {
  id: string;
  name: string;
  purpose: RunPurpose;
  durationMinutes: number;
  requiredDeviceIds: string[];
  cuesEnabled: boolean;
  targetPaceSecondsPerKm?: number;
  updatedAt?: number;
}
/** Built-in presets; names are text, so they are a function (see ground rule 6). */
export function defaultPresets(): RunPreset[] {
  return [
    {
      id: 'easy-30',
      name: tr('Ruhig · 30 Minuten', 'Easy · 30 minutes'),
      purpose: 'easy',
      durationMinutes: 30,
      requiredDeviceIds: [],
      cuesEnabled: false,
    },
    {
      id: 'long-60',
      name: tr('Lange Runde · 60 Minuten', 'Long run · 60 minutes'),
      purpose: 'long',
      durationMinutes: 60,
      requiredDeviceIds: [],
      cuesEnabled: false,
    },
    {
      id: 'free',
      name: tr('Einfach laufen', 'Just run'),
      purpose: 'free',
      durationMinutes: 30,
      requiredDeviceIds: [],
      cuesEnabled: false,
    },
  ];
}
export function validatePreset(
  preset: RunPreset,
  connectedDeviceIds: string[],
  now: number,
): { ready: boolean; warnings: string[] } {
  const warnings: string[] = [];
  if (
    !Number.isFinite(preset.durationMinutes) ||
    preset.durationMinutes < 1 ||
    preset.durationMinutes > 360
  ) {
    warnings.push(
      tr(
        'Laufdauer muss zwischen 1 und 360 Minuten liegen.',
        'Run duration must be between 1 and 360 minutes.',
      ),
    );
  }
  for (const id of preset.requiredDeviceIds) {
    if (!connectedDeviceIds.includes(id)) {
      warnings.push(
        tr(
          `Gerät ${id} fehlt. Konfiguration vor dem Start anpassen.`,
          `Device ${id} is missing. Adjust the setup before starting.`,
        ),
      );
    }
  }
  if (
    preset.targetPaceSecondsPerKm !== undefined &&
    (!Number.isFinite(preset.targetPaceSecondsPerKm) ||
      preset.targetPaceSecondsPerKm < 120 ||
      preset.targetPaceSecondsPerKm > 1200)
  ) {
    warnings.push(
      tr(
        'Tempoziel liegt außerhalb des unterstützten Bereichs.',
        'Pace goal is outside the supported range.',
      ),
    );
  }
  if (
    preset.targetPaceSecondsPerKm &&
    (!preset.updatedAt || now - preset.updatedAt > 90 * 86400000)
  ) {
    warnings.push(
      tr(
        'Tempoziel ist älter als 90 Tage oder undatiert. Bitte prüfen.',
        'Pace goal is older than 90 days or undated. Please check it.',
      ),
    );
  }
  return { ready: warnings.length === 0, warnings };
}

export interface CueRule {
  id: string;
  priority: number;
  cooldownSeconds: number;
  minimumDeviationPercent: number;
  direction: 'too_fast' | 'too_slow';
  text: string;
}
export interface CueEvent {
  ruleId: string;
  at: number;
  text: string;
}
export interface CueInput {
  now: number;
  enabled: boolean;
  purpose: RunPurpose;
  targetPaceSecondsPerKm?: number;
  currentPaceSecondsPerKm?: number;
  history: CueEvent[];
  hourlyBudget?: number;
  rules?: CueRule[];
}
/** Built-in cue rules; the cue text is shown and spoken, so it is a function. */
export function defaultCueRules(): CueRule[] {
  return [
    {
      id: 'ease-start',
      priority: 100,
      cooldownSeconds: 300,
      minimumDeviationPercent: 8,
      direction: 'too_fast',
      text: tr('Etwas ruhiger laufen.', 'Ease off a little.'),
    },
  ];
}
/** Call on aggregates only. The caller persists events, including across reconnects. */
export function scheduleCue(input: CueInput): CueEvent | undefined {
  if (
    !input.enabled ||
    comparablePurpose(input.purpose) !== 'easy' ||
    !Number.isFinite(input.now)
  ) {
    return undefined;
  }
  const target = input.targetPaceSecondsPerKm;
  const current = input.currentPaceSecondsPerKm;
  if (
    !target ||
    !current ||
    !Number.isFinite(target) ||
    !Number.isFinite(current) ||
    target < 120 ||
    current < 120
  ) {
    return undefined;
  }
  const recent = input.history.filter(
    e => e.at > input.now - 3600000 && e.at <= input.now,
  );
  const budget = Math.min(6, Math.max(0, Math.floor(input.hourlyBudget ?? 6)));
  if (
    recent.length >= budget ||
    input.history.some(e => e.at > input.now) ||
    recent.some(e => input.now - e.at < 60000)
  ) {
    return undefined;
  }
  const deviation = (current / target - 1) * 100;
  const candidates = (input.rules ?? defaultCueRules()).filter(
    rule =>
      Number.isFinite(rule.minimumDeviationPercent) &&
      rule.minimumDeviationPercent > 0 &&
      Number.isFinite(rule.cooldownSeconds) &&
      rule.cooldownSeconds >= 0 &&
      Number.isFinite(rule.priority) &&
      rule.direction === 'too_fast' &&
      deviation <= -rule.minimumDeviationPercent &&
      !input.history.some(
        e =>
          e.ruleId === rule.id &&
          input.now - e.at < Math.max(60, rule.cooldownSeconds) * 1000,
      ),
  );
  const selected = [...candidates].sort(
    (a, b) => b.priority - a.priority || a.id.localeCompare(b.id),
  )[0];
  return selected
    ? { ruleId: selected.id, at: input.now, text: selected.text }
    : undefined;
}

export interface ModelAvailability {
  id: string;
  name: string;
  enabled: boolean;
  reason: string;
}
/** Complex estimates stay gated until a shipped, prospectively validated model exists. */
export function modelAvailability(): ModelAvailability[] {
  return [
    {
      id: 'pacing',
      name: tr('Pacing & Tempoindex', 'Pacing & pace index'),
      enabled: true,
      reason: tr(
        'Transparente Ausgangsregeln mit sichtbaren Modellgrenzen.',
        'Transparent baseline rules with visible model limits.',
      ),
    },
    {
      id: 'critical-speed',
      name: 'Critical Speed & D′',
      enabled: false,
      reason: tr(
        'Zeitlich getrennte Leistungsdaten und Validierung gegen eine einfache Referenz fehlen.',
        'Time-separated performance data and validation against a simple reference are missing.',
      ),
    },
    {
      id: 'fitness',
      name: tr('Fitness & Durability', 'Fitness & durability'),
      enabled: false,
      reason: tr(
        'Kein validiertes persönliches Prognosemodell verfügbar.',
        'No validated personal forecast model is available.',
      ),
    },
    {
      id: 'environment',
      name: tr('Persönliche Umweltmodelle', 'Personal environment models'),
      enabled: false,
      reason: tr(
        'Steigung, Hitze und Wind sind noch nicht ausreichend getrennt identifizierbar.',
        'Slope, heat and wind cannot yet be told apart reliably.',
      ),
    },
    {
      id: 'race',
      name: tr('Race Simulator & Szenarien', 'Race simulator & scenarios'),
      enabled: false,
      reason: tr(
        'Benötigt ein validiertes persönliches Modell samt Gültigkeitsbereich.',
        'Needs a validated personal model with its scope of validity.',
      ),
    },
    {
      id: 'fuel',
      name: tr('Fuel-Prognose', 'Fuel forecast'),
      enabled: false,
      reason: tr(
        'Individuelle Verträglichkeit und validierte Bedarfsannahmen fehlen; kein Glykogen-Messwert.',
        'Individual tolerance and validated demand assumptions are missing; there is no glycogen measurement.',
      ),
    },
  ];
}

export function compareRuns(
  a: RunSummary,
  b: RunSummary,
): { comparable: boolean; summary: string; limitations: string[] } {
  const limitations: string[] = [];
  if (
    !samePurpose(a.purpose, b.purpose) ||
    comparablePurpose(a.purpose) !== 'easy'
  ) {
    limitations.push(
      tr(
        'Keine ausreichend vergleichbare gleichmäßige Laufart.',
        'No sufficiently comparable, even run type.',
      ),
    );
  }
  if (!assessQuality(a).paceUsable || !assessQuality(b).paceUsable) {
    limitations.push(
      tr(
        'Zeit oder Distanz sind nicht ausreichend geeignet.',
        'Time or distance is not suitable enough.',
      ),
    );
  }
  if ((a.canonicalId && a.canonicalId === b.canonicalId) || a.id === b.id) {
    limitations.push(
      tr(
        'Beide Quellen gehören zum selben Lauf.',
        'Both sources belong to the same run.',
      ),
    );
  }
  if (
    !a.context ||
    !b.context ||
    a.context.temperatureC === undefined ||
    b.context.temperatureC === undefined ||
    a.context.windMps === undefined ||
    b.context.windMps === undefined
  ) {
    limitations.push(
      tr(
        'Wetter fehlt: Keine Rangfolge der äußeren Gesamtanforderung.',
        'Weather is missing: no ranking of the overall external demand.',
      ),
    );
  } else if (
    Math.abs(a.context.temperatureC - b.context.temperatureC) > 5 ||
    Math.abs(a.context.windMps - b.context.windMps) > 2
  ) {
    limitations.push(
      tr(
        'Wetter ist ohne validierte Korrektur nicht ausreichend vergleichbar.',
        'Weather is not comparable enough without a validated correction.',
      ),
    );
  }
  if (
    !(a.segments?.length && b.segments?.length) ||
    [...(a.segments ?? []), ...(b.segments ?? [])].some(
      s => s.gradePercent === undefined || Math.abs(s.gradePercent) > 2,
    )
  ) {
    limitations.push(
      tr(
        'Streckenprofil fehlt oder liegt außerhalb der einfachen flachen Referenz.',
        'Route profile is missing or outside the simple flat reference.',
      ),
    );
  }
  if (limitations.length) {
    return {
      comparable: false,
      summary: tr(
        'Keine belastbare Rangfolge. Einzelne Messwerte bleiben sichtbar.',
        'No reliable ranking. Individual measurements stay visible.',
      ),
      limitations,
    };
  }
  const firstIsFaster =
    a.distanceMeters / a.durationSeconds > b.distanceMeters / b.durationSeconds;
  const faster = firstIsFaster
    ? tr('Der erste', 'The first')
    : tr('Der zweite', 'The second');
  const minutesA = Math.round(a.durationSeconds / 60);
  const minutesB = Math.round(b.durationSeconds / 60);
  return {
    comparable: true,
    summary: tr(
      `${faster} Lauf hatte das höhere mittlere Tempo. Dauer: ${minutesA} / ${minutesB} Minuten. Das ist keine Rangfolge der persönlichen Anstrengung.`,
      `${faster} run had the higher average pace. Duration: ${minutesA} / ${minutesB} minutes. This is not a ranking of personal effort.`,
    ),
    limitations: [
      tr(
        'Keine Korrektur für Untergrund, individuellen Windschutz oder Tagesform.',
        'No correction for surface, individual wind shelter or daily form.',
      ),
    ],
  };
}

export type EngineQuestion = 'biggest_problem' | 'why' | 'what_would_change';
export function queryEngine(
  question: EngineQuestion,
  runs: RunSummary[],
  active?: Experiment<Recommendation>,
): { answer: string; model_version: string; runIds: string[] } {
  const latest = uniqueRuns(runs).sort(
    (a, b) => b.startTime - a.startTime || a.id.localeCompare(b.id),
  )[0];
  const analysis: RunAnalysis | undefined = latest
    ? analyzeRun(latest, active, runs)
    : undefined;
  const answer = !analysis
    ? tr(
        'Noch keine Läufe vorhanden. Für eine Empfehlung fehlen noch passende Daten.',
        'No runs yet. A recommendation still needs suitable data.',
      )
    : question === 'why'
    ? active?.recommendation.reason ?? analysis.focus
    : question === 'what_would_change'
    ? active
      ? tr(
          'Die Auswertung späterer passender Läufe, ein geändertes Ziel oder ein Fehler im Rechenmodell können Anlass sein, neu zu entscheiden. Neue Daten allein ersetzen deine Empfehlung nicht.',
          'Later matching runs, a changed goal or an error in the calculation model can be reason to decide again. New data alone does not replace your recommendation.',
        )
      : tr(
          'Wenn klar ist, wofür du gelaufen bist, können mindestens vier passende flache Abschnitte zeigen, ob ein ruhigerer Start sinnvoll wäre.',
          'Once it is clear what you ran for, at least four matching flat sections can show whether a calmer start would help.',
        )
    : analysis.focus;
  return {
    answer,
    model_version: MODEL_VERSION,
    runIds: latest ? [latest.id] : [],
  };
}
export function nextRunPlan(
  preset: RunPreset,
  active?: Experiment<Recommendation>,
): string {
  const detail =
    active?.status === 'active' &&
    active.recommendation.purpose === preset.purpose
      ? ` ${active.recommendation.action}`
      : preset.targetPaceSecondsPerKm
      ? tr(
          ` Tempoziel ${formatPace(preset.targetPaceSecondsPerKm)} min/km.`,
          ` Pace goal ${formatPace(preset.targetPaceSecondsPerKm)} min/km.`,
        )
      : tr(
          ' Laufart und verfügbaren Umfang beachten.',
          ' Check the run type and the time available.',
        );
  return tr(
    `${preset.name}: etwa ${preset.durationMinutes} Minuten.${detail}`,
    `${preset.name}: about ${preset.durationMinutes} minutes.${detail}`,
  );
}
