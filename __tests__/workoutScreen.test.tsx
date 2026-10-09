import React from 'react';
import { TextInput } from 'react-native';
import ReactTestRenderer from 'react-test-renderer';
import { WorkoutScreen } from '../src/ui/WorkoutScreen';
import {
  completeSet,
  editSet,
  startSession,
  type StrengthSession,
  type WorkoutTemplate,
} from '../src/domain/strength';

const template: WorkoutTemplate = {
  id: 'template-1',
  name: 'Unterkörper',
  days: [],
  createdAt: 0,
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
    {
      exerciseId: 'standing_calf_raise',
      name: 'Wadenheben stehend',
      sets: [
        { kind: 'normal', loadKind: 'kg', reps: 12, weightKg: 60, restSeconds: 60 },
      ],
    },
  ],
};

const handlers = () => ({
  onRemoveSet: jest.fn(),
  onRestoreSet: jest.fn(),
  onPauseRest: jest.fn(),
  onResumeRest: jest.fn(),
  onSkipRest: jest.fn(),
  onSelectExercise: jest.fn(),
  onCompleteSet: jest.fn(),
  onEditSet: jest.fn(),
  onAddSet: jest.fn(),
  onAddExercise: jest.fn(),
  onFinish: jest.fn(),
  onMinimize: jest.fn(),
});

function render(
  session: StrengthSession,
  props: ReturnType<typeof handlers>,
  overrides: {
    now?: number;
    history?: StrengthSession[];
    sessions?: StrengthSession[];
    showRir?: boolean;
    showRestTimer?: boolean;
    watch?: React.ComponentProps<typeof WorkoutScreen>['watch'];
  } = {},
) {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  ReactTestRenderer.act(() => {
    tree = ReactTestRenderer.create(
      <WorkoutScreen
        history={overrides.history || []}
        now={overrides.now ?? 1_000_000}
        session={session}
        sessions={overrides.sessions}
        showRir={overrides.showRir}
        showRestTimer={overrides.showRestTimer}
        watch={overrides.watch}
        {...props}
      />,
    );
  });
  return tree;
}

/** Collects every rendered text node, regardless of nesting. */
const texts = (tree: ReactTestRenderer.ReactTestRenderer): string[] => {
  const found: string[] = [];
  const walk = (node: any) => {
    if (node === null || node === undefined || typeof node === 'boolean') {
      return;
    }
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (typeof node === 'string' || typeof node === 'number') {
      found.push(String(node));
      return;
    }
    const children = node.children;
    if (!children) {
      return;
    }
    if (node.type === 'Text') {
      const joined = children
        .filter(
          (child: unknown) =>
            typeof child === 'string' || typeof child === 'number',
        )
        .join('');
      if (joined) {
        found.push(joined);
      }
    }
    children.forEach(walk);
  };
  walk(tree.toJSON());
  return found;
};

const byLabel = (
  tree: ReactTestRenderer.ReactTestRenderer,
  label: string,
) =>
  tree.root.find(
    node =>
      typeof node.type !== 'string' &&
      node.props.accessibilityLabel === label &&
      typeof node.props.onPress === 'function',
  );

describe('Workout view', () => {
  const base = () => startSession(template, 1_000_000);

  const swipeRows = (tree: ReactTestRenderer.ReactTestRenderer) =>
    tree.root.findAll(
      node =>
        typeof node.type !== 'string' &&
        typeof node.props.onAccessibilityAction === 'function',
    );

  it('deletes a set by swiping and offers undo', () => {
    const props = handlers();
    const session = base();
    const tree = render(session, props);
    const rows = swipeRows(tree);
    expect(rows).toHaveLength(2);
    expect(rows[1].props.accessibilityActions).toEqual([
      { name: 'delete', label: 'Satz 2 löschen' },
    ]);
    ReactTestRenderer.act(() => {
      rows[1].props.onAccessibilityAction({
        nativeEvent: { actionName: 'delete' },
      });
    });
    const removed = session.exercises[0].sets[1];
    expect(props.onRemoveSet).toHaveBeenCalledWith(0, removed.id);
    expect(texts(tree)).toContain('Satz 2 gelöscht');
    ReactTestRenderer.act(() => {
      byLabel(tree, 'Satz 2 wiederherstellen').props.onPress();
    });
    expect(props.onRestoreSet).toHaveBeenCalledWith(0, removed, 1);
    expect(texts(tree)).not.toContain('Satz 2 gelöscht');
  });

  it('takes over values that the watch or a notification saved', () => {
    const props = handlers();
    const session = base();
    const tree = render(session, props);
    expect(tree.root.findAllByType(TextInput)[0].props.value).toBe('100');
    const completed = completeSet(
      session,
      0,
      session.exercises[0].sets[0].id,
      1_000_000,
      { actualWeightKg: 102.5, actualReps: 4 },
    );
    ReactTestRenderer.act(() => {
      tree.update(
        <WorkoutScreen history={[]} now={1_000_000} session={completed} {...props} />,
      );
    });
    const inputs = tree.root.findAllByType(TextInput);
    expect(inputs[0].props.value).toBe('102,5');
    expect(inputs[1].props.value).toBe('4');
  });

  it.each([
    [0, '70'],
    [1, '8'],
    [2, '2'],
  ])(
    'shows the six reps confirmed on the watch after typing into field %i',
    (field, value) => {
      const props = handlers();
      const session = startSession(
        {
          ...template,
          exercises: [
            {
              exerciseId: 'barbell_bench_press',
              name: 'Bankdrücken',
              sets: [
                {
                  kind: 'normal',
                  loadKind: 'kg',
                  reps: 8,
                  weightKg: 60,
                  restSeconds: 120,
                },
              ],
            },
          ],
        },
        1_000_000,
      );
      const setId = session.exercises[0].sets[0].id;
      const tree = render(session, props);
      ReactTestRenderer.act(() => {
        tree.root.findAllByType(TextInput)[field].props.onChangeText(value);
      });
      ReactTestRenderer.act(() => {
        tree.root.findAllByType(TextInput)[field].props.onBlur();
      });
      const edited = editSet(
        session,
        0,
        setId,
        props.onEditSet.mock.calls[0][2],
      );
      const update = (next: StrengthSession) =>
        ReactTestRenderer.act(() => {
          tree.update(
            <WorkoutScreen
              history={[]}
              now={1_010_000}
              session={next}
              {...props}
            />,
          );
        });
      update(edited);
      update(completeSet(edited, 0, setId, 1_010_000, { actualReps: 6 }));

      const inputs = tree.root.findAllByType(TextInput);
      expect(inputs[0].props.value).toBe(field === 0 ? '70' : '60');
      expect(inputs[1].props.value).toBe('6');
      expect(inputs[2].props.value).toBe(field === 2 ? '2' : '');
      expect(
        byLabel(tree, 'Satz 1 zurücknehmen').props.accessibilityState.checked,
      ).toBe(true);
      ReactTestRenderer.act(() => inputs[0].props.onBlur());
      expect(props.onEditSet.mock.lastCall[2].actualReps).toBe(6);

      // A set confirmed on the watch stays correctable on the phone.
      ReactTestRenderer.act(() => inputs[1].props.onChangeText('7'));
      expect(tree.root.findAllByType(TextInput)[1].props.value).toBe('7');
    },
  );

  it('keeps an open weight draft when only the reps change', () => {
    const props = handlers();
    const session = base();
    const tree = render(session, props);
    ReactTestRenderer.act(() => {
      tree.root.findAllByType(TextInput)[0].props.onChangeText('102,');
    });
    const updated = editSet(session, 0, session.exercises[0].sets[0].id, {
      actualReps: 6,
    });
    ReactTestRenderer.act(() => {
      tree.update(
        <WorkoutScreen
          history={[]}
          now={1_010_000}
          session={updated}
          {...props}
        />,
      );
    });
    const inputs = tree.root.findAllByType(TextInput);
    expect(inputs[0].props.value).toBe('102,');
    expect(inputs[1].props.value).toBe('6');
  });

  it('does not let the only set of an exercise be swiped away', () => {
    const tree = render({ ...base(), currentExercise: 1 }, handlers());
    expect(swipeRows(tree)[0].props.accessibilityActions).toEqual([]);
  });

  it('pauses the rest, lets it run on, or skips it', () => {
    const props = handlers();
    const session = base();
    const resting = completeSet(session, 0, session.exercises[0].sets[0].id, 1_000_000);
    const tree = render(resting, props, { now: 1_030_000 });
    expect(texts(tree)).toContain('Pause 2:30');
    byLabel(tree, 'Pause anhalten').props.onPress();
    expect(props.onPauseRest).toHaveBeenCalled();
    byLabel(tree, 'Pause überspringen').props.onPress();
    expect(props.onSkipRest).toHaveBeenCalled();

    const paused = render({ ...resting, restPausedAt: 1_030_000 }, props, {
      now: 1_500_000,
    });
    expect(texts(paused)).toContain('Pause angehalten 2:30');
    byLabel(paused, 'Pause weiterlaufen lassen').props.onPress();
    expect(props.onResumeRest).toHaveBeenCalled();
  });

  it('shows the current exercise expanded and the others as rows', () => {
    const session = { ...base(), currentExercise: 1 };
    const tree = render(session, handlers());
    const shown = texts(tree);
    expect(shown).toContain('Beinbeuger liegend');
    expect(shown).toContain('Kniebeuge (Langhantel)');
    expect(shown).toContain('Wadenheben stehend');
    // Only the current exercise shows input fields: kg, Wdh. and RIR (optional).
    expect(tree.root.findAllByType(TextInput)).toHaveLength(3);
  });

  it('marks the direction of the neighboring exercises', () => {
    const tree = render({ ...base(), currentExercise: 1 }, handlers());
    const shown = texts(tree);
    expect(shown).toContain('↑');
    expect(shown).toContain('↓');
  });

  it('switches the exercise when a row is tapped', () => {
    const props = handlers();
    const tree = render({ ...base(), currentExercise: 1 }, props);
    byLabel(tree, 'Wadenheben stehend, 0 von 1 Sätzen erledigt').props.onPress();
    expect(props.onSelectExercise).toHaveBeenCalledWith(2);
  });

  it('prefills the inputs from the target', () => {
    const tree = render(base(), handlers());
    const inputs = tree.root.findAllByType(TextInput);
    expect(inputs[0].props.value).toBe('100');
    expect(inputs[1].props.value).toBe('5');
  });

  it('confirms a set with the visible values', () => {
    const props = handlers();
    const tree = render(base(), props);
    ReactTestRenderer.act(() => {
      tree.root.findAllByType(TextInput)[1].props.onChangeText('4');
    });
    byLabel(tree, 'Satz 1 bestätigen').props.onPress();
    expect(props.onCompleteSet).toHaveBeenCalledWith(
      0,
      base().exercises[0].sets[0].id,
      { actualWeightKg: 100, actualReps: 4 },
    );
  });

  it('takes a reported reserve (RIR) only as user input', () => {
    const props = handlers();
    const tree = render(base(), props);
    ReactTestRenderer.act(() => {
      tree.root.findAllByType(TextInput)[2].props.onChangeText('2');
    });
    byLabel(tree, 'Satz 1 bestätigen').props.onPress();
    expect(props.onCompleteSet).toHaveBeenCalledWith(
      0,
      base().exercises[0].sets[0].id,
      { actualWeightKg: 100, actualReps: 5, actualRir: 2 },
    );
    // Empty stays unknown: no field, no 0.
    const empty = handlers();
    const bare = render(base(), empty);
    byLabel(bare, 'Satz 1 bestätigen').props.onPress();
    expect(empty.onCompleteSet.mock.calls[0][2]).not.toHaveProperty('actualRir');
  });

  it('stores seconds instead of reps for a timed set', () => {
    const timed = startSession(
      {
        ...template,
        exercises: [
          {
            exerciseId: 'plank',
            name: 'Unterarmstütz',
            sets: [
              {
                kind: 'timed',
                loadKind: 'bodyweight',
                seconds: 30,
                restSeconds: 30,
              },
            ],
          },
        ],
      },
      1_000_000,
    );
    const props = handlers();
    const tree = render(timed, props);
    ReactTestRenderer.act(() => {
      tree.root.findAllByType(TextInput)[1].props.onChangeText('42');
    });
    byLabel(tree, 'Satz 1 bestätigen').props.onPress();
    expect(props.onCompleteSet).toHaveBeenCalledWith(
      0,
      timed.exercises[0].sets[0].id,
      { actualWeightKg: undefined, actualSeconds: 42 },
    );
  });

  it('offers to undo a completed set', () => {
    const session = base();
    const done = completeSet(session, 0, session.exercises[0].sets[0].id, 1);
    const tree = render(done, handlers(), { now: 1 });
    expect(() => byLabel(tree, 'Satz 1 zurücknehmen')).not.toThrow();
  });

  it('shows the running rest with the remaining time', () => {
    const session = base();
    const done = completeSet(session, 0, session.exercises[0].sets[0].id, 0);
    const tree = render(done, handlers(), { now: 60_000 });
    expect(texts(tree)).toContain('Pause 2:00');
  });

  it('shows no rest once it has ended', () => {
    const session = base();
    const done = completeSet(session, 0, session.exercises[0].sets[0].id, 0);
    const tree = render(done, handlers(), { now: 200_000 });
    expect(texts(tree).some(value => value.startsWith('Pause'))).toBe(false);
  });

  it('names the last comparable performance instead of the target', () => {
    const previous = completeSet(
      base(),
      0,
      base().exercises[0].sets[0].id,
      1,
      { actualWeightKg: 97.5, actualReps: 6 },
    );
    const tree = render(base(), handlers(), { history: [previous] });
    expect(texts(tree)).toContain('97,5 kg × 6');
  });

  it('reports progress and elapsed time in the header', () => {
    const session = base();
    const done = completeSet(session, 0, session.exercises[0].sets[0].id, 1);
    const tree = render(done, handlers(), { now: 1_000_000 + 15 * 60_000 });
    expect(texts(tree)).toContain('15 min · 1 von 4 Sätzen');
  });

  it('passes on finish, minimize and add', () => {
    const props = handlers();
    const tree = render(base(), props);
    byLabel(tree, 'Training beenden').props.onPress();
    byLabel(tree, 'Training in den Hintergrund legen').props.onPress();
    byLabel(tree, 'Satz hinzufügen').props.onPress();
    byLabel(tree, 'Übung hinzufügen').props.onPress();
    expect(props.onFinish).toHaveBeenCalled();
    expect(props.onMinimize).toHaveBeenCalled();
    expect(props.onAddSet).toHaveBeenCalledWith(0);
    expect(props.onAddExercise).toHaveBeenCalled();
  });

  it('handles a session without exercises', () => {
    const tree = render(startSession(null, 1), handlers());
    expect(texts(tree)).toContain('Noch keine Übung');
    expect(tree.root.findAllByType(TextInput)).toHaveLength(0);
  });

  it('locks the weight field for bodyweight exercises', () => {
    const bodyweight = startSession(
      {
        ...template,
        exercises: [
          {
            exerciseId: 'push_up',
            name: 'Liegestütz',
            sets: [
              { kind: 'normal', loadKind: 'bodyweight', reps: 15, restSeconds: 60 },
            ],
          },
        ],
      },
      1,
    );
    const tree = render(bodyweight, handlers());
    expect(tree.root.findAllByType(TextInput)[0].props.editable).toBe(false);
  });

  /** Session without planned values, so only the suggestion can apply. */
  const freeTemplate: WorkoutTemplate = {
    id: 'template-free',
    name: 'Frei',
    days: [],
    createdAt: 0,
    exercises: [
      {
        exerciseId: 'barbell_back_squat',
        name: 'Kniebeuge (Langhantel)',
        sets: [
          { kind: 'normal', loadKind: 'kg', restSeconds: 180 },
          { kind: 'normal', loadKind: 'kg', restSeconds: 180 },
        ],
      },
    ],
  };

  /** Completed session with actual values as history. */
  const finishedSession = (
    id: string,
    at: number,
    weights: number[],
  ): StrengthSession => ({
    id,
    kind: 'strength',
    name: 'Frei',
    startTime: at,
    endTime: at + 3_600_000,
    status: 'finished',
    currentExercise: 0,
    modelVersion: 'strength-v1',
    catalogVersion: 'catalog-v1',
    exercises: [
      {
        exerciseId: 'barbell_back_squat',
        name: 'Kniebeuge (Langhantel)',
        sets: weights.map((weightKg, position) => ({
          id: `${id}-set-${position}`,
          planned: { kind: 'normal', loadKind: 'kg', restSeconds: 180 },
          actualWeightKg: weightKg,
          actualReps: 5,
          completedAt: at + position,
        })),
      },
    ],
  });

  it('fills empty fields with the values of the last session', () => {
    const tree = render(startSession(freeTemplate, 2_000_000), handlers(), {
      history: [finishedSession('older', 1_000_000, [95, 95])],
    });
    const inputs = tree.root.findAllByType(TextInput);
    expect(inputs[0].props.value).toBe('95');
    expect(inputs[1].props.value).toBe('5');
  });

  it('takes the suggestion when confirming without further input', () => {
    const props = handlers();
    const session = startSession(freeTemplate, 2_000_000);
    const tree = render(session, props, {
      history: [finishedSession('older', 1_000_000, [95, 95])],
    });
    byLabel(tree, 'Satz 1 bestätigen').props.onPress();
    expect(props.onCompleteSet).toHaveBeenCalledWith(
      0,
      session.exercises[0].sets[0].id,
      { actualWeightKg: 95, actualReps: 5 },
    );
  });

  it('keeps the planned value in front of the suggestion', () => {
    const tree = render(base(), handlers(), {
      history: [finishedSession('older', 1_000_000, [95, 95])],
    });
    expect(tree.root.findAllByType(TextInput)[0].props.value).toBe('100');
  });

  it('marks the suggestion as a suggestion and the input as input', () => {
    const tree = render(startSession(freeTemplate, 2_000_000), handlers(), {
      history: [finishedSession('older', 1_000_000, [95, 95])],
    });
    const suggested = tree.root.findAllByType(TextInput)[0];
    expect(suggested.props.accessibilityLabel).toContain('Vorschlag');
    ReactTestRenderer.act(() => {
      suggested.props.onChangeText('97,5');
    });
    expect(
      tree.root.findAllByType(TextInput)[0].props.accessibilityLabel,
    ).not.toContain('Vorschlag');
  });

  it('shows the history only once all sets of the exercise are done', () => {
    const sessions = [
      finishedSession('s1', 1_000_000, [90, 90]),
      finishedSession('s2', 1_000_000 + 7 * 86_400_000, [95, 95]),
      finishedSession('s3', 1_000_000 + 14 * 86_400_000, [100, 100]),
    ];
    let session = startSession(freeTemplate, 1_000_000 + 21 * 86_400_000);
    const open = render(session, handlers(), { sessions });
    expect(
      texts(open).some(text => text.includes('Bestes geschätztes Maximum')),
    ).toBe(false);

    for (const set of session.exercises[0].sets) {
      session = completeSet(session, 0, set.id, session.startTime, {
        actualWeightKg: 105,
        actualReps: 5,
      });
    }
    const done = render(session, handlers(), { sessions });
    expect(
      texts(done).some(text => text.includes('Bestes geschätztes Maximum')),
    ).toBe(true);
  });

  it('shows no history note without passed history', () => {
    let session = startSession(freeTemplate, 2_000_000);
    for (const set of session.exercises[0].sets) {
      session = completeSet(session, 0, set.id, session.startTime, {
        actualWeightKg: 105,
        actualReps: 5,
      });
    }
    const tree = render(session, handlers());
    expect(
      texts(tree).some(text => text.includes('Bestes geschätztes Maximum')),
    ).toBe(false);
  });
});

describe('Features in workouts', () => {
  it('hides the RIR field and rest bar on request', () => {
    const started = startSession(template, 1_000_000);
    const session = completeSet(
      started,
      0,
      started.exercises[0].sets[0].id,
      1_000_000,
      {},
    );
    const shown = render(session, handlers(), { now: 1_010_000 });
    expect(
      shown.root
        .findAllByType(TextInput)
        .some(node =>
          String(node.props.accessibilityLabel).startsWith(
            'Wiederholungen im Tank',
          ),
        ),
    ).toBe(true);
    expect(texts(shown).some(text => text.startsWith('Pause '))).toBe(true);

    const hidden = render(session, handlers(), {
      now: 1_010_000,
      showRir: false,
      showRestTimer: false,
    });
    expect(
      hidden.root
        .findAllByType(TextInput)
        .some(node =>
          String(node.props.accessibilityLabel).startsWith(
            'Wiederholungen im Tank',
          ),
        ),
    ).toBe(false);
    expect(texts(hidden).some(text => text.startsWith('Pause '))).toBe(false);
    expect(texts(hidden)).not.toContain('RIR');
  });
});

describe('watch line', () => {
  it('is absent without a watch', () => {
    const tree = render(startSession(template, 1_000_000), handlers());
    expect(texts(tree)).not.toContain('Uhr');
  });

  it('shows the pulse the watch is measuring now', () => {
    const tree = render(startSession(template, 1_000_000), handlers(), {
      watch: { state: 'measuring', bpm: 128 },
    });
    const shown = texts(tree);
    expect(shown).toContain('Uhr');
    expect(shown).toContain('Misst');
    expect(shown.join(' ')).toContain('128');
  });

  it('shows a dash, not an old value, when no pulse is fresh', () => {
    const tree = render(startSession(template, 1_000_000), handlers(), {
      watch: { state: 'measuring' },
    });
    expect(texts(tree)).toContain('–');
  });

  it('says what to do when the watch is not measuring', () => {
    const tree = render(startSession(template, 1_000_000), handlers(), {
      watch: { state: 'starting', hint: 'Öffne Runback auf der Uhr.' },
    });
    const shown = texts(tree);
    expect(shown).toContain('Startet');
    expect(shown).toContain('Öffne Runback auf der Uhr.');
    expect(shown.join(' ')).not.toContain('bpm');
  });
});
