import {
  CATALOG_VERSION,
  addExercise,
  displaySessionName,
  addSet,
  completeSet,
  editSet,
  epley1RM,
  exerciseProgress,
  finishSession,
  referenceLabel,
  clearRest,
  confirmSet,
  pauseRest,
  referenceSet,
  removeSet,
  restEndsAt,
  restoreSet,
  restRemaining,
  revise,
  resumeRest,
  selectExercise,
  sessionBest1RM,
  sessionProgress,
  skipSet,
  startSession,
  summarize,
  templateForDay,
  type StrengthSession,
  type WorkoutTemplate,
} from '../src/domain/strength';
import { setLanguage } from '../src/domain/i18n';
import { CATALOG, catalogExercise, searchCatalog } from '../src/domain/catalog';
import {
  allRegionIds,
  regionId,
  regionLabel,
  sharesAreValid,
} from '../src/domain/regions';

const template: WorkoutTemplate = {
  id: 'template-1',
  name: 'Lower body',
  days: [1],
  createdAt: 0,
  exercises: [
    {
      exerciseId: 'barbell_back_squat',
      name: 'Back squat (barbell)',
      sets: [
        {
          kind: 'warmup',
          loadKind: 'kg',
          reps: 8,
          weightKg: 40,
          restSeconds: 60,
        },
        {
          kind: 'normal',
          loadKind: 'kg',
          reps: 5,
          weightKg: 100,
          restSeconds: 180,
        },
        {
          kind: 'normal',
          loadKind: 'kg',
          reps: 5,
          weightKg: 100,
          restSeconds: 180,
        },
      ],
    },
    {
      exerciseId: 'romanian_deadlift',
      name: 'Romanian deadlift',
      sets: [
        {
          kind: 'normal',
          loadKind: 'kg',
          reps: 8,
          weightKg: 80,
          restSeconds: 120,
        },
      ],
    },
  ],
};

const start = () => startSession(template, 1_000_000);

describe('Muscle regions', () => {
  it('lists 45 concrete regions', () => {
    expect(allRegionIds()).toHaveLength(45);
  });

  it('attaches a side only to regions that have sides', () => {
    expect(regionId('quad', 'l')).toBe('quad_l');
    expect(regionId('neck', 'l')).toBe('neck');
  });

  it('labels concrete regions with their side', () => {
    expect(regionLabel('quad_r')).toBe('Quadrizeps rechts');
    expect(regionLabel('neck')).toBe('Nacken');
  });

  it('returns unknown ids unchanged instead of guessing', () => {
    expect(regionLabel('unbekannt')).toBe('unbekannt');
  });

  it('rejects shares that do not add up to 1', () => {
    expect(sharesAreValid({ quad: 0.5, glute: 0.3 })).toBe(false);
    expect(sharesAreValid({ quad: 0.5, glute: 0.5 })).toBe(true);
    expect(sharesAreValid({})).toBe(false);
  });
});

describe('Exercise catalog', () => {
  it('distributes modeled exercises completely and leaves missing models unknown', () => {
    const broken = CATALOG.filter(
      exercise =>
        exercise.eccentric !== undefined && !sharesAreValid(exercise.shares),
    );
    expect(broken.map(exercise => exercise.id)).toEqual([]);
  });

  it('keeps the eccentric factor within the documented range', () => {
    for (const exercise of CATALOG.filter(
      entry => entry.eccentric !== undefined,
    )) {
      expect(exercise.eccentric).toBeGreaterThanOrEqual(0.7);
      expect(exercise.eccentric).toBeLessThanOrEqual(1.8);
    }
  });

  it('assigns each id only once', () => {
    expect(new Set(CATALOG.map(exercise => exercise.id)).size).toBe(
      CATALOG.length,
    );
  });

  it('marks origin and catalog version', () => {
    for (const exercise of CATALOG) {
      expect(exercise.origin).toBe('catalog');
      expect(exercise.catalogVersion).toBe(CATALOG_VERSION);
    }
  });

  it('finds exercises regardless of letter case', () => {
    expect(searchCatalog('kniebeuge').length).toBeGreaterThan(0);
    expect(searchCatalog('gibtesnicht')).toEqual([]);
    expect(catalogExercise('leg_press')?.name).toBe('Beinpresse');
    expect(catalogExercise('gibtesnicht')).toBeUndefined();
  });
});

describe('Starting a session', () => {
  it('takes over the template with its targets and model versions', () => {
    const session = start();
    expect(session.name).toBe('Lower body');
    expect(session.templateId).toBe('template-1');
    expect(session.status).toBe('active');
    expect(session.exercises).toHaveLength(2);
    expect(session.exercises[0].sets).toHaveLength(3);
    expect(session.exercises[0].sets[1].planned.weightKg).toBe(100);
    expect(session.modelVersion).toBe('strength-v1');
    expect(session.catalogVersion).toBe(CATALOG_VERSION);
  });

  it('allows a session without a template', () => {
    const session = startSession(null, 5);
    expect(session.name).toBe('Freies Training');
    expect(session.exercises).toEqual([]);
    expect(session.templateId).toBeUndefined();
  });

  it('copies the targets instead of sharing the template', () => {
    const session = completeSet(
      start(),
      0,
      start().exercises[0].sets[0].id,
      1,
      {
        actualReps: 12,
      },
    );
    expect(template.exercises[0].sets[0].reps).toBe(8);
    expect(session.exercises[0].sets[0].actualReps).toBe(12);
  });

  it('gives each set its own id', () => {
    const ids = start().exercises.flatMap(exercise =>
      exercise.sets.map(set => set.id),
    );
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('keeps set ids unique even when the same exercise appears several times', () => {
    const duplicate: WorkoutTemplate = {
      ...template,
      exercises: [template.exercises[0], template.exercises[0]],
    };
    const session = startSession(duplicate, 1_000_000);
    const ids = session.exercises.flatMap(exercise =>
      exercise.sets.map(set => set.id),
    );
    expect(new Set(ids).size).toBe(ids.length);
    const changed = completeSet(session, 1, session.exercises[1].sets[0].id, 2);
    expect(changed.exercises[0].sets[0].completedAt).toBeUndefined();
    expect(changed.exercises[1].sets[0].completedAt).toBe(2);
  });
});

describe('Session names on display', () => {
  afterEach(() => setLanguage('de'));

  it('shows stored German defaults in German', () => {
    expect(displaySessionName('Krafttraining')).toBe('Krafttraining');
    expect(displaySessionName('Freies Training')).toBe('Freies Training');
  });

  it('shows stored German and English defaults in English', () => {
    setLanguage('en');
    expect(displaySessionName('Krafttraining')).toBe('Strength training');
    expect(displaySessionName('Strength training')).toBe('Strength training');
    expect(displaySessionName('Freies Training')).toBe('Free training');
    expect(displaySessionName('Free training')).toBe('Free training');
  });

  it('keeps names the user typed, in both languages', () => {
    setLanguage('en');
    expect(displaySessionName('Push day')).toBe('Push day');
    expect(displaySessionName('Krafttraining am Montag')).toBe(
      'Krafttraining am Montag',
    );
    setLanguage('de');
    expect(displaySessionName('Push day')).toBe('Push day');
  });

  it('does not change the stored name of a new session', () => {
    setLanguage('en');
    const session = startSession(null, 5);
    expect(session.name).toBe('Free training');
    setLanguage('de');
    expect(displaySessionName(session.name)).toBe('Freies Training');
  });
});

describe('Recording sets', () => {
  it('takes the target when confirming without input', () => {
    const session = start();
    const setId = session.exercises[0].sets[1].id;
    const next = completeSet(session, 0, setId, 2_000);
    const set = next.exercises[0].sets[1];
    expect(set.completedAt).toBe(2_000);
    expect(set.actualWeightKg).toBe(100);
    expect(set.actualReps).toBe(5);
  });

  it('stores deviating values without losing the target', () => {
    const session = start();
    const setId = session.exercises[0].sets[1].id;
    const next = completeSet(session, 0, setId, 2_000, {
      actualWeightKg: 102.5,
      actualReps: 3,
    });
    const set = next.exercises[0].sets[1];
    expect(set.actualWeightKg).toBe(102.5);
    expect(set.actualReps).toBe(3);
    expect(set.planned.weightKg).toBe(100);
    expect(set.planned.reps).toBe(5);
  });

  it('reopens a confirmed set when tapped again', () => {
    const session = start();
    const setId = session.exercises[0].sets[1].id;
    const done = completeSet(session, 0, setId, 2_000, { actualReps: 4 });
    const reopened = completeSet(done, 0, setId, 3_000);
    expect(reopened.exercises[0].sets[1].completedAt).toBeUndefined();
    expect(reopened.exercises[0].sets[1].actualReps).toBe(4);
    expect(reopened.restStartedAt).toBeUndefined();
  });

  it('changes values without completing the set', () => {
    const session = start();
    const setId = session.exercises[0].sets[0].id;
    const next = editSet(session, 0, setId, { actualWeightKg: 45 });
    expect(next.exercises[0].sets[0].actualWeightKg).toBe(45);
    expect(next.exercises[0].sets[0].completedAt).toBeUndefined();
  });

  it('leaves unknown sets and exercises unchanged', () => {
    const session = start();
    expect(completeSet(session, 9, 'gibtesnicht', 1)).toBe(session);
    expect(editSet(session, 0, 'gibtesnicht', { actualReps: 1 })).toBe(session);
    expect(skipSet(session, 0, 'gibtesnicht')).toBe(session);
  });

  it('treats skipping as information, not as an error', () => {
    const session = start();
    const setId = session.exercises[0].sets[0].id;
    const skipped = skipSet(session, 0, setId);
    expect(skipped.exercises[0].sets[0].skipped).toBe(true);
    expect(exerciseProgress(skipped.exercises[0]).total).toBe(2);
    expect(skipSet(skipped, 0, setId).exercises[0].sets[0].skipped).toBe(false);
  });

  it('prefills an added set from the last actual value', () => {
    const session = completeSet(
      start(),
      0,
      start().exercises[0].sets[2].id,
      2_000,
      { actualWeightKg: 105, actualReps: 3 },
    );
    const next = addSet(session, 0, 9_000);
    const added = next.exercises[0].sets[3];
    expect(added.planned.weightKg).toBe(105);
    expect(added.planned.reps).toBe(3);
    expect(added.completedAt).toBeUndefined();
  });

  it('adds a default set when the exercise is still empty', () => {
    const empty = addExercise(startSession(null, 1), { ...CATALOG[0] }, 2, 0);
    const withSet = addSet(removeAllSets(empty), 0, 3);
    expect(withSet.exercises[0].sets[0].planned.reps).toBe(8);
    expect(withSet.exercises[0].sets[0].planned.restSeconds).toBe(120);
  });

  it('removes a set but keeps the last one', () => {
    const session = start();
    const removed = removeSet(session, 0, session.exercises[0].sets[0].id);
    expect(removed.exercises[0].sets).toHaveLength(2);
    const single = removeSet(session, 1, session.exercises[1].sets[0].id);
    expect(single.exercises[1].sets).toHaveLength(1);
  });
});

const removeAllSets = (session: StrengthSession): StrengthSession => ({
  ...session,
  exercises: session.exercises.map(exercise => ({ ...exercise, sets: [] })),
});

describe('Switching and adding exercises', () => {
  it('limits the selection to existing exercises', () => {
    const session = start();
    expect(selectExercise(session, 5).currentExercise).toBe(1);
    expect(selectExercise(session, -3).currentExercise).toBe(0);
    expect(selectExercise(session, 0)).toBe(session);
    expect(selectExercise(startSession(null, 1), 2).currentExercise).toBe(0);
  });

  it('marks freely added exercises and jumps to them', () => {
    const session = addExercise(start(), CATALOG[0], 7_000);
    expect(session.exercises).toHaveLength(3);
    expect(session.exercises[2].added).toBe(true);
    expect(session.exercises[2].sets).toHaveLength(3);
    expect(session.currentExercise).toBe(2);
  });

  it('sets the matching load type for bodyweight exercises', () => {
    const pushUp = CATALOG.find(exercise => exercise.id === 'push_up')!;
    const session = addExercise(startSession(null, 1), pushUp, 2);
    expect(session.exercises[0].sets[0].planned.loadKind).toBe('bodyweight');
  });
});

describe('Confirming a set like a tap', () => {
  it('does not undo a set already ticked off on the watch', () => {
    const session = start();
    const setId = session.exercises[0].sets[1].id;
    const onWatch = completeSet(session, 0, setId, 1_900);
    const replayed = confirmSet(onWatch, 0, setId, false, 2_000, {
      actualReps: 4,
    });
    const set = replayed.exercises[0].sets[1];
    expect(set.completedAt).toBe(1_900);
    expect(set.actualReps).toBe(4);
    expect(replayed.restStartedAt).toBe(1_900);
  });

  it('confirms or reopens when the state is still the same', () => {
    const session = start();
    const setId = session.exercises[0].sets[1].id;
    const done = confirmSet(session, 0, setId, false, 2_000);
    expect(done.exercises[0].sets[1].completedAt).toBe(2_000);
    const reopened = confirmSet(done, 0, setId, true, 3_000);
    expect(reopened.exercises[0].sets[1].completedAt).toBeUndefined();
    // Already open: undoing does nothing more.
    expect(confirmSet(session, 0, setId, true, 3_000)).toBe(session);
  });
});

describe('Session revisions', () => {
  it('builds each saved revision on the previous one', () => {
    const session = start();
    const first = revise(session, session, () => 0.5);
    expect(first.revision).toBeTruthy();
    expect(first.baseRevision).toBeUndefined();
    const second = revise(first, { ...first, note: 'x' }, () => 0.25);
    expect(second.baseRevision).toBe(first.revision);
    expect(second.revision).not.toBe(first.revision);
    // An old base does not carry over.
    expect(revise(second, second).baseRevision).toBe(second.revision);
  });
});

describe('Rest', () => {
  it('pauses, keeps the remaining time and resumes afterwards', () => {
    const session = start();
    const resting = completeSet(session, 0, session.exercises[0].sets[1].id, 0);
    expect(restEndsAt(resting)).toBe(180_000);
    const paused = pauseRest(resting, 60_000);
    expect(restRemaining(paused, 60_000)).toBe(120);
    expect(restRemaining(paused, 500_000)).toBe(120);
    expect(restEndsAt(paused)).toBeNull();
    // Pausing twice changes nothing.
    expect(pauseRest(paused, 70_000)).toBe(paused);
    const resumed = resumeRest(paused, 100_000);
    expect(resumed.restPausedMs).toBe(40_000);
    expect(restEndsAt(resumed)).toBe(220_000);
    expect(restRemaining(resumed, 110_000)).toBe(110);
    expect(resumeRest(resumed, 120_000)).toBe(resumed);
  });

  it('jumps straight to the end when skipping', () => {
    const session = start();
    const resting = pauseRest(
      completeSet(session, 0, session.exercises[0].sets[1].id, 0),
      5_000,
    );
    const skipped = clearRest(resting);
    expect(restRemaining(skipped, 6_000)).toBeNull();
    expect(skipped.restPausedAt).toBeUndefined();
    expect(JSON.parse(JSON.stringify(skipped))).not.toHaveProperty('restStartedAt');
  });

  it('does not pause a rest that has already ended', () => {
    const session = start();
    const resting = completeSet(session, 0, session.exercises[0].sets[1].id, 0);
    expect(pauseRest(resting, 400_000)).toBe(resting);
  });

  it('ends the rest when its set is deleted and restores the set', () => {
    const session = start();
    const set = session.exercises[0].sets[1];
    const resting = completeSet(session, 0, set.id, 1_000);
    const removed = removeSet(resting, 0, set.id);
    expect(removed.exercises[0].sets.map(entry => entry.id)).not.toContain(set.id);
    expect(restRemaining(removed, 2_000)).toBeNull();
    const restored = restoreSet(removed, 0, resting.exercises[0].sets[1], 1);
    expect(restored.exercises[0].sets[1]).toEqual(resting.exercises[0].sets[1]);
    // A second restore does not add a duplicate set.
    expect(restoreSet(restored, 0, resting.exercises[0].sets[1], 1)).toBe(restored);
    // Another set leaves the running rest alone.
    const other = removeSet(resting, 0, session.exercises[0].sets[0].id);
    expect(restRemaining(other, 2_000)).not.toBeNull();
  });

  it('starts after a confirmed set and counts down', () => {
    const session = start();
    const setId = session.exercises[0].sets[1].id;
    const next = completeSet(session, 0, setId, 10_000);
    expect(next.restSeconds).toBe(180);
    expect(restRemaining(next, 10_000)).toBe(180);
    expect(restRemaining(next, 70_000)).toBe(120);
    expect(restRemaining(next, 190_001)).toBeNull();
  });

  it('starts no rest when the target has none', () => {
    const noRest = startSession(
      {
        ...template,
        exercises: [
          {
            exerciseId: 'plank',
            name: 'Plank',
            sets: [
              {
                kind: 'timed',
                loadKind: 'bodyweight',
                seconds: 45,
                restSeconds: 0,
              },
            ],
          },
        ],
      },
      1,
    );
    const next = completeSet(noRest, 0, noRest.exercises[0].sets[0].id, 5);
    expect(next.restStartedAt).toBeUndefined();
    expect(restRemaining(next, 6)).toBeNull();
  });
});

describe('Progress and evaluation', () => {
  it('counts sets and volume from actual values only', () => {
    let session = start();
    session = completeSet(session, 0, session.exercises[0].sets[1].id, 1, {
      actualWeightKg: 100,
      actualReps: 5,
    });
    session = completeSet(session, 0, session.exercises[0].sets[2].id, 2, {
      actualWeightKg: 100,
      actualReps: 4,
    });
    const progress = sessionProgress(session);
    expect(progress.completedSets).toBe(2);
    expect(progress.totalSets).toBe(4);
    expect(progress.volumeKg).toBe(900);
  });

  it('reports an exercise as done only when no set is open', () => {
    let session = start();
    expect(exerciseProgress(session.exercises[1]).done).toBe(false);
    session = completeSet(session, 1, session.exercises[1].sets[0].id, 1);
    expect(exerciseProgress(session.exercises[1]).done).toBe(true);
    expect(exerciseProgress(session.exercises[1]).activeSetId).toBeUndefined();
  });

  it('names the next open set', () => {
    const session = start();
    expect(exerciseProgress(session.exercises[0]).activeSetId).toBe(
      session.exercises[0].sets[0].id,
    );
  });

  it('estimates the one-rep max only from usable values', () => {
    expect(epley1RM(100, 5)).toBeCloseTo(116.667, 3);
    expect(epley1RM(100, 0)).toBeNull();
    expect(epley1RM(0, 5)).toBeNull();
    expect(epley1RM(100, 40)).toBeNull();
  });

  it('leaves warm-up sets out of the personal best', () => {
    let session = start();
    session = completeSet(session, 0, session.exercises[0].sets[0].id, 1, {
      actualWeightKg: 400,
      actualReps: 8,
    });
    session = completeSet(session, 0, session.exercises[0].sets[1].id, 2, {
      actualWeightKg: 100,
      actualReps: 5,
    });
    expect(sessionBest1RM(session, 'barbell_back_squat')).toBeCloseTo(
      116.667,
      3,
    );
    expect(sessionBest1RM(session, 'gibtesnicht')).toBeNull();
  });

  it('finishes a session and summarizes it', () => {
    let session = start();
    session = completeSet(session, 0, session.exercises[0].sets[1].id, 1, {
      actualWeightKg: 100,
      actualReps: 5,
    });
    const finished = finishSession(session, 50_000);
    expect(finished.status).toBe('finished');
    expect(finished.endTime).toBe(50_000);
    expect(finished.restStartedAt).toBeUndefined();
    expect(summarize(finished)).toMatchObject({
      completedSets: 1,
      volumeKg: 500,
      endTime: 50_000,
    });
  });
});

describe('Reference to the last performance', () => {
  const historyFrom = (values: {
    weight?: number;
    reps?: number;
    seconds?: number;
  }): StrengthSession[] => {
    const session = start();
    return [
      completeSet(session, 0, session.exercises[0].sets[0].id, 1, {
        actualWeightKg: values.weight,
        actualReps: values.reps,
        actualSeconds: values.seconds,
      }),
    ];
  };

  it('names weight and reps of the last session', () => {
    expect(
      referenceLabel(
        historyFrom({ weight: 82.5, reps: 6 }),
        'barbell_back_squat',
        0,
      ),
    ).toBe('82,5 kg × 6');
  });

  it('works without weight', () => {
    const history = historyFrom({ reps: 12 }).map(session => ({
      ...session,
      exercises: session.exercises.map((exercise, index) =>
        index === 0
          ? {
              ...exercise,
              sets: exercise.sets.map((set, position) =>
                position === 0
                  ? {
                      ...set,
                      actualWeightKg: undefined,
                      planned: { ...set.planned, weightKg: undefined },
                    }
                  : set,
              ),
            }
          : exercise,
      ),
    }));
    expect(referenceLabel(history, 'barbell_back_squat', 0)).toBe('12 Wdh.');
  });

  it('returns the last comparable set with numeric values', () => {
    const set = referenceSet(
      historyFrom({ weight: 82.5, reps: 6 }),
      'barbell_back_squat',
      0,
    );
    expect(set?.actualWeightKg).toBe(82.5);
    expect(set?.actualReps).toBe(6);
  });

  it('skips sessions without recorded values', () => {
    const empty = start();
    const withValues = historyFrom({ weight: 90, reps: 5 });
    expect(
      referenceSet([empty, ...withValues], 'barbell_back_squat', 0)
        ?.actualWeightKg,
    ).toBe(90);
  });

  it('returns null when nothing comparable exists', () => {
    expect(referenceSet([], 'barbell_back_squat', 0)).toBeNull();
    expect(referenceLabel([], 'barbell_back_squat', 0)).toBeNull();
    expect(
      referenceLabel(historyFrom({ weight: 80, reps: 5 }), 'leg_press', 0),
    ).toBeNull();
    expect(
      referenceLabel(
        historyFrom({ weight: 80, reps: 5 }),
        'barbell_back_squat',
        4,
      ),
    ).toBeNull();
  });
});

describe('Template for a weekday', () => {
  it('finds the template for the day and reports nothing otherwise', () => {
    expect(templateForDay([template], 1)?.id).toBe('template-1');
    expect(templateForDay([template], 3)).toBeNull();
    expect(templateForDay([], 1)).toBeNull();
  });
});
