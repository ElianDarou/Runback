import type {
  Exercise,
  LoadKind,
  LoggedSet,
  PlannedSet,
  SetKind,
  StrengthSession,
  TemplateExercise,
  WorkoutTemplate,
} from './strength';
import { tr } from './i18n';
import { displaySessionName } from './strength';

/**
 * Training plans.
 *
 * A plan is a user artifact. It suggests, it does not commit.
 * All functions here are pure and return a new template; the callers decide
 * whether and when to save. Time always comes in as a parameter, so the same
 * input gives the same result.
 *
 * Two rules run through this file:
 * - The app never changes a plan on its own. A suggestion is data; only an
 *   explicit `applyProposal` from the user makes it take effect (T-6).
 * - A difference between plan and execution is recorded but not judged. There
 *   is no good, no bad and no failure here (T-5, ground rule 13: execution is
 *   not a result).
 */

export const PLAN_MODEL_VERSION = 'plans-v1';

/** Gap a new structure suggestion keeps from the last one (T-6). */
export const STRUCTURE_PROPOSAL_INTERVAL_DAYS = 28;

/** For this long, a declined suggestion does not come back unchanged (T-6). */
export const DECLINED_PROPOSAL_SILENCE_DAYS = 60;

const DAY_MS = 24 * 60 * 60 * 1000;

/** Weekday names, 0 (Sunday) to 6, as `Date.getDay`. Functions, so they follow the language. */
export const weekdayLabels = (): string[] => [
  tr('Sonntag', 'Sunday'),
  tr('Montag', 'Monday'),
  tr('Dienstag', 'Tuesday'),
  tr('Mittwoch', 'Wednesday'),
  tr('Donnerstag', 'Thursday'),
  tr('Freitag', 'Friday'),
  tr('Samstag', 'Saturday'),
];

export const weekdayShort = (): string[] => [
  tr('So', 'Sun'),
  tr('Mo', 'Mon'),
  tr('Di', 'Tue'),
  tr('Mi', 'Wed'),
  tr('Do', 'Thu'),
  tr('Fr', 'Fri'),
  tr('Sa', 'Sat'),
];

/** Display order: the week starts on Monday. */
export const WEEKDAY_ORDER = [1, 2, 3, 4, 5, 6, 0];

const DEFAULT_SET: PlannedSet = {
  kind: 'normal',
  loadKind: 'kg',
  reps: 8,
  restSeconds: 120,
};

const isDay = (day: number) => Number.isInteger(day) && day >= 0 && day <= 6;

const sortDays = (days: number[]) =>
  [...new Set(days.filter(isDay))].sort(
    (a, b) => WEEKDAY_ORDER.indexOf(a) - WEEKDAY_ORDER.indexOf(b),
  );

const replaceExercise = (
  template: WorkoutTemplate,
  index: number,
  next: TemplateExercise,
): WorkoutTemplate => ({
  ...template,
  exercises: template.exercises.map((exercise, i) =>
    i === index ? next : exercise,
  ),
});

const withinBounds = (index: number, length: number) =>
  Number.isInteger(index) && index >= 0 && index < length;

// ── Create, edit, duplicate ───────────────────────────────────

const uniqueId = (existing: WorkoutTemplate[], base: string): string => {
  const taken = new Set(existing.map(template => template.id));
  if (!taken.has(base)) {
    return base;
  }
  let counter = 2;
  while (taken.has(`${base}-${counter}`)) {
    counter += 1;
  }
  return `${base}-${counter}`;
};

/** Empty template. Without exercises; the check lists that as an open point. */
export function createTemplate(
  now: number,
  name = '',
  existing: WorkoutTemplate[] = [],
): WorkoutTemplate {
  return {
    id: uniqueId(existing, `template-${now.toString(36)}`),
    name,
    days: [],
    exercises: [],
    createdAt: now,
  };
}

export function renameTemplate(
  template: WorkoutTemplate,
  name: string,
): WorkoutTemplate {
  return { ...template, name };
}

/** Sets the weekdays. An empty list explicitly means: no fixed day. */
export function setTemplateDays(
  template: WorkoutTemplate,
  days: number[],
): WorkoutTemplate {
  return { ...template, days: sortDays(days) };
}

export function toggleTemplateDay(
  template: WorkoutTemplate,
  day: number,
): WorkoutTemplate {
  if (!isDay(day)) {
    return template;
  }
  return setTemplateDays(
    template,
    template.days.includes(day)
      ? template.days.filter(entry => entry !== day)
      : [...template.days, day],
  );
}

/** Removes every day binding. Without a fixed day, a plan is still complete. */
export function clearTemplateDays(template: WorkoutTemplate): WorkoutTemplate {
  return template.days.length ? { ...template, days: [] } : template;
}

export function hasFixedDay(template: WorkoutTemplate): boolean {
  return template.days.length > 0;
}

export function daysLabel(template: WorkoutTemplate): string {
  return template.days.length
    ? template.days.map(day => weekdayShort()[day]).join(', ')
    : tr('Kein fester Tag', 'No fixed day');
}

/**
 * Adds a catalog exercise. The preset values are a starting assumption, not a
 * target; the user sets the sets afterwards.
 */
export function addTemplateExercise(
  template: WorkoutTemplate,
  exercise: Exercise,
  sets = 3,
  defaultRestSeconds = DEFAULT_SET.restSeconds,
): WorkoutTemplate {
  const planned: PlannedSet = {
    ...DEFAULT_SET,
    restSeconds: defaultRestSeconds,
    loadKind: exercise.equipment === 'bodyweight' ? 'bodyweight' : 'kg',
  };
  return {
    ...template,
    exercises: [
      ...template.exercises,
      {
        exerciseId: exercise.id,
        name: exercise.name,
        sets: Array.from({ length: Math.max(1, sets) }, () => ({ ...planned })),
      },
    ],
  };
}

export function removeTemplateExercise(
  template: WorkoutTemplate,
  index: number,
): WorkoutTemplate {
  if (!withinBounds(index, template.exercises.length)) {
    return template;
  }
  return {
    ...template,
    exercises: template.exercises.filter((_, i) => i !== index),
  };
}

/** Moves an exercise to another position. Out-of-range positions are clamped. */
export function moveTemplateExercise(
  template: WorkoutTemplate,
  from: number,
  to: number,
): WorkoutTemplate {
  const length = template.exercises.length;
  if (!withinBounds(from, length)) {
    return template;
  }
  const target = Math.min(Math.max(to, 0), length - 1);
  if (target === from) {
    return template;
  }
  const exercises = [...template.exercises];
  const [moved] = exercises.splice(from, 1);
  exercises.splice(target, 0, moved);
  return { ...template, exercises };
}

/** Appends a set, pre-filled from the last set of the same exercise. */
export function addPlannedSet(
  template: WorkoutTemplate,
  exerciseIndex: number,
  defaultRestSeconds = DEFAULT_SET.restSeconds,
): WorkoutTemplate {
  const exercise = template.exercises[exerciseIndex];
  if (!exercise) {
    return template;
  }
  const last = exercise.sets[exercise.sets.length - 1];
  return replaceExercise(template, exerciseIndex, {
    ...exercise,
    sets: [
      ...exercise.sets,
      { ...(last || { ...DEFAULT_SET, restSeconds: defaultRestSeconds }) },
    ],
  });
}

/** Removes a set. The last remaining set stays. */
export function removePlannedSet(
  template: WorkoutTemplate,
  exerciseIndex: number,
  setIndex: number,
): WorkoutTemplate {
  const exercise = template.exercises[exerciseIndex];
  if (!exercise || exercise.sets.length <= 1) {
    return template;
  }
  if (!withinBounds(setIndex, exercise.sets.length)) {
    return template;
  }
  return replaceExercise(template, exerciseIndex, {
    ...exercise,
    sets: exercise.sets.filter((_, i) => i !== setIndex),
  });
}

export interface PlannedSetValues {
  kind?: SetKind;
  loadKind?: LoadKind;
  reps?: number;
  seconds?: number;
  weightKg?: number;
  restSeconds?: number;
}

/**
 * Changes a planned set. `undefined` in `values` clears the value, so an
 * emptied input really means "not preset".
 */
export function updatePlannedSet(
  template: WorkoutTemplate,
  exerciseIndex: number,
  setIndex: number,
  values: PlannedSetValues,
): WorkoutTemplate {
  const exercise = template.exercises[exerciseIndex];
  if (!exercise || !withinBounds(setIndex, exercise.sets.length)) {
    return template;
  }
  const current = exercise.sets[setIndex];
  const next: PlannedSet = { ...current };
  for (const key of Object.keys(values) as (keyof PlannedSetValues)[]) {
    const value = values[key];
    if (key === 'kind' && value !== undefined) {
      next.kind = value as SetKind;
    } else if (key === 'loadKind' && value !== undefined) {
      next.loadKind = value as LoadKind;
    } else if (key === 'restSeconds') {
      next.restSeconds =
        typeof value === 'number' && Number.isFinite(value)
          ? Math.max(0, value)
          : undefined;
    } else if (key === 'reps' || key === 'seconds' || key === 'weightKg') {
      const parsed =
        typeof value === 'number' && Number.isFinite(value) ? value : undefined;
      next[key] = parsed !== undefined && parsed >= 0 ? parsed : undefined;
    }
  }
  return replaceExercise(template, exerciseIndex, {
    ...exercise,
    sets: exercise.sets.map((set, i) => (i === setIndex ? next : set)),
  });
}

/** Creates a copy. It stands on its own and gets no days assigned. */
export function duplicateTemplate(
  templates: WorkoutTemplate[],
  id: string,
  now: number,
): WorkoutTemplate[] {
  const source = templates.find(template => template.id === id);
  if (!source) {
    return templates;
  }
  const copy: WorkoutTemplate = {
    ...source,
    id: uniqueId(templates, `template-${now.toString(36)}`),
    // A new name the user owns; created in the language of the moment.
    name: tr(`${source.name} (Kopie)`, `${source.name} (copy)`),
    days: [],
    createdAt: now,
    exercises: source.exercises.map(exercise => ({
      ...exercise,
      sets: exercise.sets.map(set => ({ ...set })),
    })),
  };
  const index = templates.findIndex(template => template.id === id);
  return [
    ...templates.slice(0, index + 1),
    copy,
    ...templates.slice(index + 1),
  ];
}

export function deleteTemplate(
  templates: WorkoutTemplate[],
  id: string,
): WorkoutTemplate[] {
  return templates.filter(template => template.id !== id);
}

/** Adds or replaces, depending on whether the ID already exists. */
export function upsertTemplate(
  templates: WorkoutTemplate[],
  template: WorkoutTemplate,
): WorkoutTemplate[] {
  return templates.some(entry => entry.id === template.id)
    ? templates.map(entry => (entry.id === template.id ? template : entry))
    : [...templates, template];
}

/** All templates for one weekday. None is also a valid result. */
export function templatesForDay(
  templates: WorkoutTemplate[],
  day: number,
): WorkoutTemplate[] {
  return templates.filter(template => template.days.includes(day));
}

// ── Template from a logged session ───────────────────────────────────

/**
 * Turns a logged session into a template: "just like that" as a plan.
 *
 * What actually happened is carried over — confirmed sets with their actual
 * values. Skipped and open sets don't go into the plan; they are part of the
 * session, not the intent. The session itself stays unchanged (ground rule 1).
 */
export function templateFromSession(
  session: StrengthSession,
  now: number,
  name = displaySessionName(session.name),
  existing: WorkoutTemplate[] = [],
): WorkoutTemplate {
  const exercises: TemplateExercise[] = [];
  for (const exercise of session.exercises) {
    const sets = exercise.sets
      .filter(set => set.completedAt !== undefined && !set.skipped)
      .map(set => plannedFromLogged(set));
    if (sets.length) {
      exercises.push({
        exerciseId: exercise.exerciseId,
        name: exercise.name,
        sets,
      });
    }
  }
  return {
    ...createTemplate(now, name, existing),
    exercises,
  };
}

const plannedFromLogged = (set: LoggedSet): PlannedSet => {
  const next: PlannedSet = {
    kind: set.planned.kind,
    loadKind: set.planned.loadKind,
    restSeconds: set.planned.restSeconds,
  };
  const reps = set.actualReps ?? set.planned.reps;
  const seconds = set.actualSeconds ?? set.planned.seconds;
  const weightKg = set.actualWeightKg ?? set.planned.weightKg;
  if (reps !== undefined) {
    next.reps = reps;
  }
  if (seconds !== undefined) {
    next.seconds = seconds;
  }
  if (weightKg !== undefined) {
    next.weightKg = weightKg;
  }
  return next;
};

// ── Check ────────────────────────────────────────────────────────────────

export type TemplateProblemField = 'name' | 'exercises' | 'sets';

/** An open point on the template. Data, not an exception, not a reproach. */
export interface TemplateProblem {
  field: TemplateProblemField;
  message: string;
  exerciseIndex?: number;
}

export interface TemplateValidation {
  ok: boolean;
  problems: TemplateProblem[];
}

/**
 * Checks a template. User input never throws; an open point is an entry in
 * `problems` that the UI can show next to the field.
 */
export function validateTemplate(
  template: WorkoutTemplate,
): TemplateValidation {
  const problems: TemplateProblem[] = [];
  if (!template.name.trim()) {
    problems.push({
      field: 'name',
      message: tr('Der Plan braucht einen Namen.', 'The plan needs a name.'),
    });
  }
  if (!template.exercises.length) {
    problems.push({
      field: 'exercises',
      message: tr(
        'Füge mindestens eine Übung hinzu.',
        'Add at least one exercise.',
      ),
    });
  }
  template.exercises.forEach((exercise, exerciseIndex) => {
    if (!exercise.sets.length) {
      problems.push({
        field: 'sets',
        exerciseIndex,
        message: tr(
          `${exercise.name} hat noch keinen Satz.`,
          `${exercise.name} has no set yet.`,
        ),
      });
    }
  });
  return { ok: problems.length === 0, problems };
}

// ── Plan and execution side by side ────────────────────────────────────

/**
 * How a set relates to the plan. Explicitly not a verdict:
 * `deviated` means "different from planned", not "wrong".
 */
export type SetAdherence =
  | 'matched'
  | 'deviated'
  | 'added'
  | 'skipped'
  | 'open';

export interface SetComparison {
  setId: string;
  position: number;
  adherence: SetAdherence;
  planned?: PlannedSet;
  actualReps?: number;
  actualSeconds?: number;
  actualWeightKg?: number;
  /** Actual minus planned. A sign, not a judgment. */
  repsDelta?: number;
  secondsDelta?: number;
  weightDelta?: number;
}

export interface ExerciseComparison {
  exerciseId: string;
  name: string;
  /** Taken from the plan as it was. Otherwise added freely. */
  planned: boolean;
  sets: SetComparison[];
}

/** Planned, but not in the session. Not an error state. */
export interface UntrainedExercise {
  exerciseId: string;
  name: string;
  plannedSets: number;
}

export interface PlanComparison {
  templateId?: string;
  templateName?: string;
  /** Without a template there is nothing to compare; that is allowed (T-5). */
  hasPlan: boolean;
  exercises: ExerciseComparison[];
  untrained: UntrainedExercise[];
  matched: number;
  deviated: number;
  added: number;
  skipped: number;
  open: number;
  /** Neutral one-sentence summary. */
  summary: string;
  modelVersion: string;
}

const sameNumber = (a?: number, b?: number) =>
  (a ?? undefined) === (b ?? undefined);

const delta = (actual?: number, planned?: number) =>
  actual !== undefined && planned !== undefined && actual !== planned
    ? Math.round((actual - planned) * 100) / 100
    : undefined;

const compareSet = (
  set: LoggedSet,
  planned: PlannedSet | undefined,
  position: number,
): SetComparison => {
  const base: SetComparison = {
    setId: set.id,
    position,
    adherence: 'open',
    planned,
    actualReps: set.actualReps,
    actualSeconds: set.actualSeconds,
    actualWeightKg: set.actualWeightKg,
  };
  if (set.skipped) {
    return { ...base, adherence: 'skipped' };
  }
  if (set.completedAt === undefined) {
    return base;
  }
  if (!planned) {
    return { ...base, adherence: 'added' };
  }
  const repsDelta = delta(set.actualReps, planned.reps);
  const secondsDelta = delta(set.actualSeconds, planned.seconds);
  const weightDelta = delta(set.actualWeightKg, planned.weightKg);
  const identical =
    sameNumber(set.actualReps, planned.reps) &&
    sameNumber(set.actualSeconds, planned.seconds) &&
    sameNumber(set.actualWeightKg, planned.weightKg);
  return {
    ...base,
    adherence: identical ? 'matched' : 'deviated',
    repsDelta,
    secondsDelta,
    weightDelta,
  };
};

/**
 * Puts a logged session next to its template.
 *
 * The result is a statement about execution under T-5 and ground rule 13. It
 * deliberately contains no judgment, no rate and no target. If the template
 * is missing, `hasPlan` is false and everything logged counts as free training.
 */
export function comparePlan(
  session: StrengthSession,
  template: WorkoutTemplate | null,
): PlanComparison {
  const exercises: ExerciseComparison[] = [];
  const used = new Set<number>();
  let matched = 0;
  let deviated = 0;
  let added = 0;
  let skipped = 0;
  let open = 0;

  for (const exercise of session.exercises) {
    const planIndex = template
      ? template.exercises.findIndex(
          (candidate, index) =>
            candidate.exerciseId === exercise.exerciseId && !used.has(index),
        )
      : -1;
    if (planIndex >= 0) {
      used.add(planIndex);
    }
    const plannedSets =
      planIndex >= 0 && template ? template.exercises[planIndex].sets : [];
    const sets = exercise.sets.map((set, position) =>
      compareSet(set, plannedSets[position], position + 1),
    );
    for (const set of sets) {
      if (set.adherence === 'matched') {
        matched += 1;
      } else if (set.adherence === 'deviated') {
        deviated += 1;
      } else if (set.adherence === 'added') {
        added += 1;
      } else if (set.adherence === 'skipped') {
        skipped += 1;
      } else {
        open += 1;
      }
    }
    exercises.push({
      exerciseId: exercise.exerciseId,
      name: exercise.name,
      planned: planIndex >= 0,
      sets,
    });
  }

  const untrained: UntrainedExercise[] = [];
  if (template) {
    template.exercises.forEach((exercise, index) => {
      if (!used.has(index)) {
        untrained.push({
          exerciseId: exercise.exerciseId,
          name: exercise.name,
          plannedSets: exercise.sets.length,
        });
      }
    });
  }

  return {
    templateId: template?.id,
    templateName: template?.name,
    hasPlan: Boolean(template),
    exercises,
    untrained,
    matched,
    deviated,
    added,
    skipped,
    open,
    summary: comparisonSummary({
      hasPlan: Boolean(template),
      matched,
      deviated,
      added,
      skipped,
      open,
      untrained: untrained.length,
    }),
    modelVersion: PLAN_MODEL_VERSION,
  };
}

const setWord = (count: number) =>
  tr(count === 1 ? 'Satz' : 'Sätze', count === 1 ? 'set' : 'sets');

/**
 * One sentence in neutral language. Lists what happened and leaves it there.
 * Words like "good", "bad", "missed" or "nailed" deliberately don't appear here.
 */
function comparisonSummary(counts: {
  hasPlan: boolean;
  matched: number;
  deviated: number;
  added: number;
  skipped: number;
  open: number;
  untrained: number;
}): string {
  if (!counts.hasPlan) {
    const total = counts.matched + counts.deviated + counts.added;
    return total
      ? tr(
          `Freies Training, ${total} ${setWord(total)} erfasst.`,
          `Free training, ${total} ${setWord(total)} logged.`,
        )
      : tr(
          'Freies Training ohne erfasste Sätze.',
          'Free training with no logged sets.',
        );
  }
  const parts: string[] = [];
  if (counts.matched) {
    parts.push(
      tr(
        `${counts.matched} ${setWord(counts.matched)} wie vorgesehen`,
        `${counts.matched} ${setWord(counts.matched)} as planned`,
      ),
    );
  }
  if (counts.deviated) {
    parts.push(
      tr(
        `${counts.deviated} mit anderen Werten`,
        `${counts.deviated} with different values`,
      ),
    );
  }
  if (counts.added) {
    parts.push(tr(`${counts.added} zusätzlich`, `${counts.added} extra`));
  }
  if (counts.skipped) {
    parts.push(
      tr(`${counts.skipped} übersprungen`, `${counts.skipped} skipped`),
    );
  }
  if (counts.open) {
    parts.push(tr(`${counts.open} offen`, `${counts.open} open`));
  }
  if (counts.untrained) {
    const exercises =
      counts.untrained === 1
        ? tr('Übung', 'exercise')
        : tr('Übungen', 'exercises');
    parts.push(
      tr(
        `${counts.untrained} ${exercises} nicht trainiert`,
        `${counts.untrained} ${exercises} not trained`,
      ),
    );
  }
  return parts.length
    ? `${parts.join(', ')}.`
    : tr(
        'Zu dieser Einheit wurde nichts erfasst.',
        'Nothing was logged for this session.',
      );
}

// ── Suggestions: suggest, never rewrite ───────────────────────────────

export type PlanChange =
  | {
      kind: 'setValues';
      exerciseIndex: number;
      setIndex: number;
      values: PlannedSetValues;
    }
  | { kind: 'addSet'; exerciseIndex: number; set: PlannedSet }
  | { kind: 'removeSet'; exerciseIndex: number; setIndex: number }
  | { kind: 'days'; days: number[] };

/**
 * `structure` covers days, exercises and volume and stays rare.
 * `load` covers load, sets and reps and may come more often, because these
 * values are set anew for each session anyway (T-6).
 */
export type ProposalScope = 'structure' | 'load';

export interface PlanProposal {
  id: string;
  templateId: string;
  scope: ProposalScope;
  /** Trigger: what the suggestion came from. */
  reason: string;
  /** Affected parts of the plan, in words. */
  slots: string;
  /** Expected effect. */
  expectation: string;
  /** Check criterion set in advance, ground rule 3. */
  check: string;
  changes: PlanChange[];
  createdAt: number;
}

export type ProposalDecision = 'accepted' | 'declined';

export interface ProposalRecord {
  proposalId: string;
  templateId: string;
  scope: ProposalScope;
  decision: ProposalDecision;
  /** Fingerprint of the changes, to notice repeats. */
  fingerprint: string;
  decidedAt: number;
}

/** Stable fingerprint of a set of changes, independent of time and ID. */
export function proposalFingerprint(proposal: PlanProposal): string {
  return `${proposal.templateId}|${proposal.scope}|${proposal.changes
    .map(change => JSON.stringify(change))
    .join(';')}`;
}

export interface ProposalGate {
  allowed: boolean;
  /** Always filled, so the suppression stays traceable. */
  reason: string;
}

/**
 * May this suggestion appear now?
 *
 * Structure suggestions keep their distance, so a plan isn't under constant
 * revision. A declined suggestion doesn't come back unchanged for a while.
 * Both are display rules — the plan stays unchanged in any case until the
 * user agrees.
 */
export function proposalIsAllowed(
  proposal: PlanProposal,
  records: ProposalRecord[],
  now: number,
): ProposalGate {
  const fingerprint = proposalFingerprint(proposal);
  const declined = records.find(
    record =>
      record.decision === 'declined' &&
      record.fingerprint === fingerprint &&
      now - record.decidedAt < DECLINED_PROPOSAL_SILENCE_DAYS * DAY_MS,
  );
  if (declined) {
    return {
      allowed: false,
      reason: tr(
        'Diesen Vorschlag hast du bereits abgelehnt.',
        'You have already declined this suggestion.',
      ),
    };
  }
  if (proposal.scope === 'load') {
    return {
      allowed: true,
      reason: tr(
        'Vorschlag zu Last und Wiederholungen.',
        'Suggestion about load and reps.',
      ),
    };
  }
  const lastStructure = records
    .filter(
      record =>
        record.scope === 'structure' &&
        record.templateId === proposal.templateId,
    )
    .reduce(
      (latest, record) => Math.max(latest, record.decidedAt),
      Number.NEGATIVE_INFINITY,
    );
  if (lastStructure === Number.NEGATIVE_INFINITY) {
    return {
      allowed: true,
      reason: tr(
        'Erster Strukturvorschlag für diesen Plan.',
        'First structure suggestion for this plan.',
      ),
    };
  }
  const days = Math.floor((now - lastStructure) / DAY_MS);
  return days >= STRUCTURE_PROPOSAL_INTERVAL_DAYS
    ? {
        allowed: true,
        reason: tr(
          `Letzte Strukturfrage vor ${days} Tagen.`,
          `Last structure question ${days} days ago.`,
        ),
      }
    : {
        allowed: false,
        reason: tr(
          `Struktur wurde vor ${days} Tagen zuletzt besprochen; frühestens nach ${STRUCTURE_PROPOSAL_INTERVAL_DAYS} Tagen wieder.`,
          `Structure was last discussed ${days} days ago; it can come back after ${STRUCTURE_PROPOSAL_INTERVAL_DAYS} days at the earliest.`,
        ),
      };
}

/**
 * Applies a confirmed suggestion.
 *
 * This function is the only way a suggestion reaches the plan, and it is only
 * called after explicit confirmation (T-6). If a change no longer fits the
 * plan, it has no effect instead of hitting something else.
 */
export function applyProposal(
  template: WorkoutTemplate,
  proposal: PlanProposal,
): WorkoutTemplate {
  if (proposal.templateId !== template.id) {
    return template;
  }
  return proposal.changes.reduce((current, change) => {
    if (change.kind === 'days') {
      return setTemplateDays(current, change.days);
    }
    if (change.kind === 'setValues') {
      return updatePlannedSet(
        current,
        change.exerciseIndex,
        change.setIndex,
        change.values,
      );
    }
    if (change.kind === 'removeSet') {
      return removePlannedSet(current, change.exerciseIndex, change.setIndex);
    }
    const exercise = current.exercises[change.exerciseIndex];
    if (!exercise) {
      return current;
    }
    return replaceExercise(current, change.exerciseIndex, {
      ...exercise,
      sets: [...exercise.sets, { ...change.set }],
    });
  }, template);
}

/** Records a decision. "Leave unchanged" is a valid result. */
export function recordDecision(
  proposal: PlanProposal,
  decision: ProposalDecision,
  now: number,
): ProposalRecord {
  return {
    proposalId: proposal.id,
    templateId: proposal.templateId,
    scope: proposal.scope,
    decision,
    fingerprint: proposalFingerprint(proposal),
    decidedAt: now,
  };
}
