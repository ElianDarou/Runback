import { setLanguage } from '../src/domain/i18n';
import {
  addPlannedSet,
  addTemplateExercise,
  applyProposal,
  clearTemplateDays,
  comparePlan,
  createTemplate,
  daysLabel,
  deleteTemplate,
  duplicateTemplate,
  hasFixedDay,
  moveTemplateExercise,
  proposalFingerprint,
  proposalIsAllowed,
  recordDecision,
  removePlannedSet,
  removeTemplateExercise,
  renameTemplate,
  setTemplateDays,
  templateFromSession,
  templatesForDay,
  toggleTemplateDay,
  updatePlannedSet,
  upsertTemplate,
  validateTemplate,
  DECLINED_PROPOSAL_SILENCE_DAYS,
  PLAN_MODEL_VERSION,
  STRUCTURE_PROPOSAL_INTERVAL_DAYS,
  type PlanProposal,
  type ProposalRecord,
} from '../src/domain/plans';
import { catalogExercise } from '../src/domain/catalog';
import {
  completeSet,
  skipSet,
  startSession,
  type Exercise,
  type StrengthSession,
  type WorkoutTemplate,
} from '../src/domain/strength';

const NOW = 1_700_000_000_000;
const DAY = 24 * 60 * 60 * 1000;

const squat = catalogExercise('barbell_back_squat') as Exercise;
const curl = catalogExercise('lying_leg_curl') as Exercise;

const plan = (): WorkoutTemplate => ({
  id: 'template-1',
  name: 'Unterkörper',
  days: [1, 4],
  createdAt: NOW,
  exercises: [
    {
      exerciseId: 'barbell_back_squat',
      name: 'Kniebeuge (Langhantel)',
      sets: [
        { kind: 'normal', loadKind: 'kg', reps: 5, weightKg: 100, restSeconds: 180 },
        { kind: 'normal', loadKind: 'kg', reps: 5, weightKg: 100, restSeconds: 180 },
      ],
    },
    {
      exerciseId: 'lying_leg_curl',
      name: 'Beinbeuger liegend',
      sets: [
        { kind: 'normal', loadKind: 'kg', reps: 10, weightKg: 40, restSeconds: 90 },
      ],
    },
  ],
});

describe('Creating and editing plans', () => {
  it('creates an empty template with a deterministic id', () => {
    const created = createTemplate(NOW, 'Oberkörper');
    expect(created).toEqual(createTemplate(NOW, 'Oberkörper'));
    expect(created.exercises).toEqual([]);
    expect(created.days).toEqual([]);
    expect(created.createdAt).toBe(NOW);
  });

  it('avoids an id that is already taken', () => {
    const first = createTemplate(NOW, 'A');
    const second = createTemplate(NOW, 'B', [first]);
    expect(second.id).not.toBe(first.id);
  });

  it('renames without touching other fields', () => {
    const renamed = renameTemplate(plan(), 'Beine');
    expect(renamed.name).toBe('Beine');
    expect(renamed.exercises).toEqual(plan().exercises);
  });

  it('leaves the source template unchanged', () => {
    const original = plan();
    const snapshot = JSON.stringify(original);
    renameTemplate(original, 'Anders');
    addTemplateExercise(original, squat);
    removeTemplateExercise(original, 0);
    updatePlannedSet(original, 0, 0, { reps: 12 });
    expect(JSON.stringify(original)).toBe(snapshot);
  });
});

describe('Weekdays', () => {
  it('sorts by week starting Monday and removes duplicates', () => {
    const set = setTemplateDays(plan(), [0, 3, 1, 3]);
    expect(set.days).toEqual([1, 3, 0]);
  });

  it('ignores impossible days', () => {
    expect(setTemplateDays(plan(), [7, -1, 2.5, 2]).days).toEqual([2]);
  });

  it('turns a day on and off again', () => {
    const on = toggleTemplateDay(plan(), 6);
    expect(on.days).toContain(6);
    expect(toggleTemplateDay(on, 6).days).not.toContain(6);
  });

  it('knows the state without a fixed day', () => {
    const free = clearTemplateDays(plan());
    expect(free.days).toEqual([]);
    expect(hasFixedDay(free)).toBe(false);
    expect(daysLabel(free)).toBe('Kein fester Tag');
    expect(daysLabel(plan())).toBe('Mo, Do');
  });

  it('finds all templates for a day; none is valid', () => {
    const templates = [plan(), clearTemplateDays(plan())];
    expect(templatesForDay(templates, 1)).toHaveLength(1);
    expect(templatesForDay(templates, 2)).toEqual([]);
  });
});

describe('Exercises and sets', () => {
  it('adds a catalog exercise with prefilled sets', () => {
    const next = addTemplateExercise(plan(), curl, 4);
    expect(next.exercises).toHaveLength(3);
    expect(next.exercises[2].sets).toHaveLength(4);
    expect(next.exercises[2].name).toBe(curl.name);
  });

  it('sets the matching load type for bodyweight exercises', () => {
    const pullUp = catalogExercise('pull_up') as Exercise;
    const next = addTemplateExercise(createTemplate(NOW, 'X'), pullUp);
    expect(next.exercises[0].sets[0].loadKind).toBe('bodyweight');
  });

  it('removes an exercise and ignores impossible positions', () => {
    expect(removeTemplateExercise(plan(), 0).exercises).toHaveLength(1);
    expect(removeTemplateExercise(plan(), 9).exercises).toHaveLength(2);
  });

  it('reorders exercises and clamps targets to the range', () => {
    const moved = moveTemplateExercise(plan(), 1, 0);
    expect(moved.exercises.map(e => e.exerciseId)).toEqual([
      'lying_leg_curl',
      'barbell_back_squat',
    ]);
    expect(moveTemplateExercise(plan(), 0, 99).exercises[1].exerciseId).toBe(
      'barbell_back_squat',
    );
    expect(moveTemplateExercise(plan(), 0, 0)).toEqual(plan());
  });

  it('appends a set modeled on the last one', () => {
    const next = addPlannedSet(plan(), 1);
    expect(next.exercises[1].sets).toHaveLength(2);
    expect(next.exercises[1].sets[1]).toEqual(next.exercises[1].sets[0]);
  });

  it('keeps the last set of an exercise', () => {
    expect(removePlannedSet(plan(), 1, 0).exercises[1].sets).toHaveLength(1);
    expect(removePlannedSet(plan(), 0, 0).exercises[0].sets).toHaveLength(1);
  });

  it('changes single set values', () => {
    const next = updatePlannedSet(plan(), 0, 1, {
      reps: 3,
      weightKg: 110,
      restSeconds: 240,
      kind: 'failure',
    });
    expect(next.exercises[0].sets[1]).toEqual({
      kind: 'failure',
      loadKind: 'kg',
      reps: 3,
      weightKg: 110,
      restSeconds: 240,
    });
    expect(next.exercises[0].sets[0].reps).toBe(5);
  });

  it('treats a cleared target as not set', () => {
    const next = updatePlannedSet(plan(), 0, 0, { weightKg: undefined });
    expect(next.exercises[0].sets[0].weightKg).toBeUndefined();
  });

  it('does not allow a negative rest', () => {
    const next = updatePlannedSet(plan(), 0, 0, { restSeconds: -30 });
    expect(next.exercises[0].sets[0].restSeconds).toBe(0);
  });
});

describe('Duplicating and deleting', () => {
  it('creates an independent copy without a weekday', () => {
    const list = duplicateTemplate([plan()], 'template-1', NOW + 1000);
    expect(list).toHaveLength(2);
    expect(list[1].name).toBe('Unterkörper (Kopie)');
    expect(list[1].days).toEqual([]);
    expect(list[1].id).not.toBe('template-1');
    list[1].exercises[0].sets[0].reps = 99;
    expect(list[0].exercises[0].sets[0].reps).toBe(5);
  });
  it('names the copy in the active language', () => {
    setLanguage('en');
    const list = duplicateTemplate([plan()], 'template-1', NOW + 1000);
    expect(list[1].name).toBe('Unterkörper (copy)');
  });

  it('leaves the list untouched when the id is missing', () => {
    expect(duplicateTemplate([plan()], 'weg', NOW)).toHaveLength(1);
  });

  it('deletes exactly one template', () => {
    const other = { ...plan(), id: 'template-2' };
    expect(deleteTemplate([plan(), other], 'template-1')).toEqual([other]);
  });

  it('adds or replaces on save', () => {
    expect(upsertTemplate([], plan())).toHaveLength(1);
    const changed = renameTemplate(plan(), 'Neu');
    const list = upsertTemplate([plan()], changed);
    expect(list).toHaveLength(1);
    expect(list[0].name).toBe('Neu');
  });
});

describe('Validation', () => {
  it('accepts a complete template', () => {
    expect(validateTemplate(plan())).toEqual({ ok: true, problems: [] });
  });

  it('reports a missing name and a missing exercise as data', () => {
    const result = validateTemplate(createTemplate(NOW, '   '));
    expect(result.ok).toBe(false);
    expect(result.problems.map(p => p.field)).toEqual(['name', 'exercises']);
    expect(result.problems[0].message).toContain('Namen');
  });

  it('names an exercise without a set by its position', () => {
    const empty: WorkoutTemplate = {
      ...plan(),
      exercises: [{ exerciseId: 'x', name: 'Testübung', sets: [] }],
    };
    const result = validateTemplate(empty);
    expect(result.ok).toBe(false);
    expect(result.problems[0]).toEqual({
      field: 'sets',
      exerciseIndex: 0,
      message: 'Testübung hat noch keinen Satz.',
    });
  });

  it('throws on no input', () => {
    expect(() =>
      validateTemplate({
        id: '',
        name: '',
        days: [],
        exercises: [],
        createdAt: 0,
      }),
    ).not.toThrow();
  });
});

describe('Template from a completed session', () => {
  const finished = (): StrengthSession => {
    let session = startSession(plan(), NOW);
    session = completeSet(session, 0, session.exercises[0].sets[0].id, NOW, {
      actualReps: 5,
      actualWeightKg: 102.5,
    });
    session = completeSet(session, 0, session.exercises[0].sets[1].id, NOW, {
      actualReps: 4,
      actualWeightKg: 102.5,
    });
    return session;
  };

  it('takes the actual values of the confirmed sets', () => {
    const derived = templateFromSession(finished(), NOW + DAY, 'Wie zuletzt');
    expect(derived.name).toBe('Wie zuletzt');
    expect(derived.exercises).toHaveLength(1);
    expect(derived.exercises[0].sets).toEqual([
      { kind: 'normal', loadKind: 'kg', reps: 5, weightKg: 102.5, restSeconds: 180 },
      { kind: 'normal', loadKind: 'kg', reps: 4, weightKg: 102.5, restSeconds: 180 },
    ]);
  });

  it('leaves out skipped and open sets and sets no days', () => {
    let session = finished();
    session = skipSet(session, 0, session.exercises[0].sets[1].id);
    const derived = templateFromSession(session, NOW + DAY);
    expect(derived.exercises[0].sets).toHaveLength(1);
    expect(derived.days).toEqual([]);
  });

  it('does not change the underlying session', () => {
    const session = finished();
    const snapshot = JSON.stringify(session);
    templateFromSession(session, NOW + DAY);
    expect(JSON.stringify(session)).toBe(snapshot);
  });

  it('yields a template without exercises when nothing was confirmed', () => {
    const derived = templateFromSession(startSession(plan(), NOW), NOW);
    expect(derived.exercises).toEqual([]);
    expect(validateTemplate(derived).ok).toBe(false);
  });
});

describe('Plan and performance side by side', () => {
  it('recognizes a set that matches the target exactly', () => {
    let session = startSession(plan(), NOW);
    session = completeSet(session, 0, session.exercises[0].sets[0].id, NOW);
    const result = comparePlan(session, plan());
    expect(result.exercises[0].sets[0].adherence).toBe('matched');
    expect(result.matched).toBe(1);
    expect(result.modelVersion).toBe(PLAN_MODEL_VERSION);
  });

  it('records a deviation with its sign without rating it', () => {
    let session = startSession(plan(), NOW);
    session = completeSet(session, 0, session.exercises[0].sets[0].id, NOW, {
      actualReps: 7,
      actualWeightKg: 95,
    });
    const result = comparePlan(session, plan());
    const set = result.exercises[0].sets[0];
    expect(set.adherence).toBe('deviated');
    expect(set.repsDelta).toBe(2);
    expect(set.weightDelta).toBe(-5);
    expect(result.deviated).toBe(1);
  });

  it('distinguishes skipped, open and added', () => {
    let session = startSession(plan(), NOW);
    session = skipSet(session, 0, session.exercises[0].sets[0].id);
    const result = comparePlan(session, plan());
    expect(result.skipped).toBe(1);
    expect(result.open).toBe(2);
    expect(result.matched).toBe(0);
  });

  it('counts sets beyond the target as added', () => {
    const short: WorkoutTemplate = {
      ...plan(),
      exercises: [{ ...plan().exercises[0], sets: [plan().exercises[0].sets[0]] }],
    };
    let session = startSession(plan(), NOW);
    session = completeSet(session, 0, session.exercises[0].sets[1].id, NOW);
    const result = comparePlan(session, short);
    expect(result.exercises[0].sets[1].adherence).toBe('added');
    expect(result.added).toBe(1);
  });

  it('lists a planned but untrained exercise as such', () => {
    const session = startSession(
      { ...plan(), exercises: [plan().exercises[0]] },
      NOW,
    );
    const result = comparePlan(session, plan());
    expect(result.untrained).toEqual([
      {
        exerciseId: 'lying_leg_curl',
        name: 'Beinbeuger liegend',
        plannedSets: 1,
      },
    ]);
  });

  it('marks a freely added exercise', () => {
    const session = startSession(plan(), NOW);
    const withExtra: StrengthSession = {
      ...session,
      exercises: [
        ...session.exercises,
        { exerciseId: 'plank', name: 'Unterarmstütz', sets: [], added: true },
      ],
    };
    const result = comparePlan(withExtra, plan());
    expect(result.exercises[2].planned).toBe(false);
    expect(result.exercises[0].planned).toBe(true);
  });

  it('works without a plan and calls it free training', () => {
    let session = startSession(null, NOW, 'Freies Training');
    session = startSession(plan(), NOW);
    session = completeSet(session, 0, session.exercises[0].sets[0].id, NOW);
    const result = comparePlan(session, null);
    expect(result.hasPlan).toBe(false);
    expect(result.untrained).toEqual([]);
    expect(result.summary).toBe('Freies Training, 1 Satz erfasst.');
  });

  it('phrases the summary without any judgment', () => {
    let session = startSession(plan(), NOW);
    session = completeSet(session, 0, session.exercises[0].sets[0].id, NOW);
    session = completeSet(session, 0, session.exercises[0].sets[1].id, NOW, {
      actualReps: 3,
    });
    session = skipSet(session, 1, session.exercises[1].sets[0].id);
    const { summary } = comparePlan(session, plan());
    expect(summary).toBe(
      '1 Satz wie vorgesehen, 1 mit anderen Werten, 1 übersprungen.',
    );
    for (const word of [
      'gut',
      'schlecht',
      'Fehler',
      'verfehlt',
      'geschafft',
      'leider',
      'nicht erfüllt',
    ]) {
      expect(summary.toLowerCase()).not.toContain(word.toLowerCase());
    }
  });

  it('matches the same exercise twice in the plan in order', () => {
    const twice: WorkoutTemplate = {
      ...plan(),
      exercises: [plan().exercises[0], plan().exercises[0]],
    };
    const session = startSession(twice, NOW);
    const result = comparePlan(session, twice);
    expect(result.exercises.every(exercise => exercise.planned)).toBe(true);
    expect(result.untrained).toEqual([]);
  });

  it('returns the same result for the same input', () => {
    const session = startSession(plan(), NOW);
    expect(comparePlan(session, plan())).toEqual(comparePlan(session, plan()));
  });
});

describe('Suggestions stay suggestions', () => {
  const proposal = (
    overrides: Partial<PlanProposal> = {},
  ): PlanProposal => ({
    id: 'proposal-1',
    templateId: 'template-1',
    scope: 'structure',
    reason: 'Der Montagstermin ist dreimal in Folge ausgefallen.',
    slots: 'Kniebeuge, Satz 1 und 2',
    expectation: 'Der Umfang passt wieder zu deiner Woche.',
    check: 'In vier Wochen: findet die Einheit wieder regelmäßig statt?',
    changes: [
      {
        kind: 'setValues',
        exerciseIndex: 0,
        setIndex: 0,
        values: { reps: 3 },
      },
    ],
    createdAt: NOW,
    ...overrides,
  });

  it('changes the plan only when it is applied', () => {
    const template = plan();
    const snapshot = JSON.stringify(template);
    const suggestion = proposal();
    expect(JSON.stringify(template)).toBe(snapshot);
    const applied = applyProposal(template, suggestion);
    expect(applied.exercises[0].sets[0].reps).toBe(3);
    expect(JSON.stringify(template)).toBe(snapshot);
  });

  it('applies only to the plan it was made for', () => {
    const other = { ...plan(), id: 'template-9' };
    expect(applyProposal(other, proposal())).toEqual(other);
  });

  it('makes a change that no longer fits have no effect', () => {
    const suggestion = proposal({
      changes: [
        { kind: 'setValues', exerciseIndex: 7, setIndex: 0, values: { reps: 3 } },
      ],
    });
    expect(applyProposal(plan(), suggestion)).toEqual(plan());
  });

  it('can add and remove sets and set days', () => {
    const suggestion = proposal({
      changes: [
        {
          kind: 'addSet',
          exerciseIndex: 1,
          set: { kind: 'normal', loadKind: 'kg', reps: 12, restSeconds: 90 },
        },
        { kind: 'removeSet', exerciseIndex: 0, setIndex: 1 },
        { kind: 'days', days: [2] },
      ],
    });
    const applied = applyProposal(plan(), suggestion);
    expect(applied.exercises[1].sets).toHaveLength(2);
    expect(applied.exercises[0].sets).toHaveLength(1);
    expect(applied.days).toEqual([2]);
  });

  it('allows a first structure suggestion', () => {
    const gate = proposalIsAllowed(proposal(), [], NOW);
    expect(gate.allowed).toBe(true);
    expect(gate.reason).toBeTruthy();
  });

  it('keeps structure suggestions apart and gives the reason', () => {
    const records: ProposalRecord[] = [
      recordDecision(proposal(), 'accepted', NOW),
    ];
    const soon = proposalIsAllowed(
      proposal({ id: 'proposal-2', changes: [{ kind: 'days', days: [3] }] }),
      records,
      NOW + 7 * DAY,
    );
    expect(soon.allowed).toBe(false);
    expect(soon.reason).toContain('7 Tagen');
    const later = proposalIsAllowed(
      proposal({ id: 'proposal-2', changes: [{ kind: 'days', days: [3] }] }),
      records,
      NOW + (STRUCTURE_PROPOSAL_INTERVAL_DAYS + 1) * DAY,
    );
    expect(later.allowed).toBe(true);
  });

  it('allows load and rep suggestions more often', () => {
    const load = proposal({ id: 'proposal-3', scope: 'load' });
    const records = [recordDecision(proposal(), 'accepted', NOW)];
    expect(proposalIsAllowed(load, records, NOW + DAY).allowed).toBe(true);
  });

  it('does not bring back a rejected suggestion unchanged', () => {
    const declined = proposal();
    const records = [recordDecision(declined, 'declined', NOW)];
    const again = proposalIsAllowed(declined, records, NOW + 7 * DAY);
    expect(again.allowed).toBe(false);
    expect(again.reason).toContain('abgelehnt');
    expect(
      proposalIsAllowed(
        declined,
        records,
        NOW + (DECLINED_PROPOSAL_SILENCE_DAYS + 1) * DAY,
      ).allowed,
    ).toBe(true);
  });

  it('recognizes identical changes by their fingerprint', () => {
    expect(proposalFingerprint(proposal())).toBe(
      proposalFingerprint(proposal({ id: 'anders', createdAt: NOW + DAY })),
    );
    expect(proposalFingerprint(proposal())).not.toBe(
      proposalFingerprint(proposal({ changes: [{ kind: 'days', days: [5] }] })),
    );
  });

  it('records rejection as a valid result too', () => {
    const record = recordDecision(proposal(), 'declined', NOW);
    expect(record.decision).toBe('declined');
    expect(record.templateId).toBe('template-1');
    expect(record.decidedAt).toBe(NOW);
  });

  it('names the trigger, places, effect and check in every suggestion', () => {
    const suggestion = proposal();
    expect(suggestion.reason.length).toBeGreaterThan(0);
    expect(suggestion.slots.length).toBeGreaterThan(0);
    expect(suggestion.expectation.length).toBeGreaterThan(0);
    expect(suggestion.check.length).toBeGreaterThan(0);
  });
});
