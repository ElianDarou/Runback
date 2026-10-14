import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { ScrollView, Text } from 'react-native';
import type { Run } from '../src/native';
import {
  PlanningScreen,
  type PlanningScreenProps,
} from '../src/ui/PlanningScreen';
import { WorkoutIcon } from '../src/ui/components';
import {
  normalizeSchedule,
  setDayPlan,
  type ScheduleState,
} from '../src/domain/schedule';
import type { StrengthSession, WorkoutTemplate } from '../src/domain/strength';

const localAt = (date: string, hour = 9, minute = 0): number => {
  const [year, month, day] = date.split('-').map(Number);
  return new Date(year, month - 1, day, hour, minute, 0, 0).getTime();
};

// Wednesday, 12 March 2025.
const NOW = localAt('2025-03-12', 12);

const completedRun = (
  id: string,
  date: string,
  extra: Partial<Run> = {},
): Run => {
  const startTime = localAt(date, 8);
  return {
    id,
    startTime,
    endTime: startTime + 30 * 60 * 1000,
    durationSeconds: 30 * 60,
    distanceMeters: 5000,
    purpose: 'easy',
    source: 'test',
    status: 'completed',
    ...extra,
  };
};

const template = (
  id: string,
  name: string,
  days: number[],
  icon?: string,
): WorkoutTemplate => ({
  id,
  name,
  days,
  icon,
  exercises: [],
  createdAt: 1,
});

const strengthSession = (
  id: string,
  date: string,
  templateId?: string,
): StrengthSession => ({
  id,
  kind: 'strength',
  name: 'Pull',
  templateId,
  startTime: localAt(date, 18),
  endTime: localAt(date, 19),
  status: 'finished',
  exercises: [],
  currentExercise: 0,
  modelVersion: 'strength-v1',
  catalogVersion: 'catalog-v2',
});

const renderPlanning = (
  state: ScheduleState = normalizeSchedule(),
  extra: Partial<PlanningScreenProps> = {},
) => {
  const onSave = jest
    .fn<Promise<void>, [ScheduleState]>()
    .mockResolvedValue(undefined);
  const props: PlanningScreenProps = {
    state,
    onSave,
    templates: [],
    runs: [],
    strengthSessions: [],
    now: NOW,
    ...extra,
  };
  let tree!: TestRenderer.ReactTestRenderer;
  act(() => {
    tree = TestRenderer.create(<PlanningScreen {...props} />);
  });
  return { tree, onSave, props };
};

const textContent = (node: TestRenderer.ReactTestInstance): string =>
  node.children
    .map(child =>
      typeof child === 'string' || typeof child === 'number'
        ? String(child)
        : textContent(child),
    )
    .join('');

const screenText = (tree: TestRenderer.ReactTestRenderer) =>
  tree.root.findAllByType(Text).map(textContent).join(' ');

const byLabel = (tree: TestRenderer.ReactTestRenderer, label: string) =>
  tree.root.find(
    node =>
      node.props.accessibilityLabel === label &&
      typeof node.props.onPress === 'function',
  );

const press = (tree: TestRenderer.ReactTestRenderer, label: string) =>
  act(() => {
    byLabel(tree, label).props.onPress();
  });

const dayCell = (tree: TestRenderer.ReactTestRenderer, prefix: string) =>
  tree.root.find(
    node =>
      typeof node.props.accessibilityLabel === 'string' &&
      node.props.accessibilityLabel.startsWith(prefix) &&
      !node.props.accessibilityLabel.endsWith('schließen') &&
      typeof node.props.onPress === 'function',
  );

describe('PlanningScreen', () => {
  it('opens on the month, without scrolling, with a quiet switch to the week', () => {
    const { tree } = renderPlanning();
    expect(screenText(tree)).toContain('März 2025');
    expect(tree.root.findAllByType(ScrollView)).toHaveLength(0);
    // 31 days plus the days of the neighboring months in the first and last row.
    expect(
      tree.root.findAll(
        node =>
          node.props.accessibilityRole === 'button' &&
          /^\w+, \d+\. März/.test(node.props.accessibilityLabel ?? '') &&
          typeof node.props.onPress === 'function',
      ).length,
    ).toBeGreaterThanOrEqual(31);
    press(tree, 'Wochenansicht zeigen');
    expect(screenText(tree)).toContain('10. März – 16. März');
    press(tree, 'Monatsansicht zeigen');
    expect(screenText(tree)).toContain('März 2025');
  });

  it('shows the weekly plan gray and turns it green once done', () => {
    // Past days follow the weekly plan noted for them.
    const state = normalizeSchedule({
      runDays: [0],
      weeklyHistory: [
        {
          since: '2025-03-01',
          run: [0],
          strength: [{ templateId: 'pull', days: [0, 2] }],
        },
      ],
    });
    const { tree } = renderPlanning(state, {
      // Pull on Monday (1) and Wednesday (3), Sunday-based.
      templates: [template('pull', 'Pull', [1, 3], 'handGrab')],
      runs: [completedRun('r1', '2025-03-10')],
    });
    expect(dayCell(tree, 'Montag, 10. März').props.accessibilityLabel).toBe(
      'Montag, 10. März, Lauf, erledigt, Pull, geplant',
    );
    expect(dayCell(tree, 'Mittwoch, 12. März').props.accessibilityLabel).toBe(
      'Mittwoch, 12. März, heute, Pull, geplant',
    );
    const icons = tree.root.findAllByType(WorkoutIcon);
    expect(icons.some(icon => icon.props.name === 'handGrab')).toBe(true);
    expect(
      icons.some(
        icon => icon.props.name === 'run' && icon.props.state === 'done',
      ),
    ).toBe(true);
  });

  it('does not plan past days before the weekly plan was set', () => {
    const { tree } = renderPlanning(normalizeSchedule({ runDays: [0] }));
    expect(dayCell(tree, 'Montag, 10. März').props.accessibilityLabel).toBe(
      'Montag, 10. März',
    );
    expect(dayCell(tree, 'Montag, 17. März').props.accessibilityLabel).toBe(
      'Montag, 17. März, Lauf, geplant',
    );
  });

  it('lets a strength session of the template carry out its plan', () => {
    const state = normalizeSchedule({
      weeklyHistory: [
        {
          since: '2025-03-01',
          run: [],
          strength: [{ templateId: 'pull', days: [0] }],
        },
      ],
    });
    const { tree } = renderPlanning(state, {
      templates: [template('pull', 'Pull', [1])],
      strengthSessions: [strengthSession('s1', '2025-03-10', 'pull')],
    });
    expect(dayCell(tree, 'Montag, 10. März').props.accessibilityLabel).toBe(
      'Montag, 10. März, Pull, erledigt',
    );
  });

  it('changes one day without touching the weekly plan', async () => {
    const state = normalizeSchedule({ runDays: [3] });
    const { tree, onSave } = renderPlanning(state, {
      templates: [template('push', 'Push', [])],
    });
    act(() => dayCell(tree, 'Donnerstag, 13. März').props.onPress());
    expect(screenText(tree)).toContain(
      'Eine Änderung gilt nur für diesen Tag.',
    );
    await act(async () =>
      byLabel(tree, 'Lauf an diesem Tag nicht planen').props.onPress(),
    );
    expect(onSave).toHaveBeenLastCalledWith(
      setDayPlan(state, '2025-03-13', [], '2025-03-12'),
    );
    await act(async () => byLabel(tree, 'Push planen').props.onPress());
    const saved = onSave.mock.calls.at(-1)![0];
    expect(saved.runDays).toEqual([3]);
    expect(saved.sessions).toEqual([
      expect.objectContaining({
        date: '2025-03-13',
        kind: 'strength',
        templateId: 'push',
        title: 'Push',
      }),
    ]);
    // The changed day can follow the weekly plan again.
    await act(async () =>
      byLabel(
        tree,
        'Wochenplan für diesen Tag wiederherstellen',
      ).props.onPress(),
    );
    expect(onSave.mock.calls.at(-1)![0]).toMatchObject({
      sessions: [],
      changedDays: [],
    });
  });

  it('keeps the plan of a hidden area when a day is edited', async () => {
    const state = normalizeSchedule();
    const { tree, onSave } = renderPlanning(state, {
      // Pull on Thursday; strength training is switched off.
      templates: [template('pull', 'Pull', [4])],
      showStrength: false,
    });
    act(() => dayCell(tree, 'Donnerstag, 13. März').props.onPress());
    await act(async () => byLabel(tree, 'Lauf planen').props.onPress());
    expect(onSave.mock.calls.at(-1)![0].sessions).toEqual([
      expect.objectContaining({ kind: 'strength', templateId: 'pull' }),
      expect.objectContaining({ kind: 'run' }),
    ]);
  });

  it('plans a single day without any weekly plan', async () => {
    const { tree, onSave } = renderPlanning();
    act(() => dayCell(tree, 'Montag, 17. März').props.onPress());
    expect(screenText(tree)).toContain('Nichts geplant.');
    await act(async () => byLabel(tree, 'Lauf planen').props.onPress());
    expect(onSave.mock.calls.at(-1)![0].sessions).toEqual([
      expect.objectContaining({ date: '2025-03-17', kind: 'run' }),
    ]);
  });

  it('shows past days as what was trained and keeps them read-only', () => {
    const onOpenActivity = jest.fn();
    const { tree } = renderPlanning(normalizeSchedule(), {
      runs: [completedRun('r1', '2025-03-03')],
      onOpenActivity,
    });
    act(() => dayCell(tree, 'Montag, 3. März').props.onPress());
    const text = screenText(tree);
    expect(text).toContain('ohne Plan');
    expect(text).not.toContain('An diesem Tag planen');
    act(() => {
      tree.root
        .find(
          node =>
            typeof node.props.accessibilityLabel === 'string' &&
            node.props.accessibilityLabel.endsWith('ansehen') &&
            typeof node.props.onPress === 'function',
        )
        .props.onPress();
    });
    expect(onOpenActivity).toHaveBeenCalledWith('run', 'r1');
  });

  it('keeps a switched-off area out of the calendar and the choices', () => {
    const { tree } = renderPlanning(normalizeSchedule({ runDays: [0] }), {
      runs: [completedRun('r1', '2025-03-10')],
      templates: [template('pull', 'Pull', [])],
      showRunning: false,
    });
    expect(dayCell(tree, 'Montag, 10. März').props.accessibilityLabel).toBe(
      'Montag, 10. März',
    );
    act(() => dayCell(tree, 'Montag, 17. März').props.onPress());
    expect(() => byLabel(tree, 'Lauf planen')).toThrow();
    expect(byLabel(tree, 'Pull planen')).toBeTruthy();
    expect(screenText(tree)).not.toContain('gelaufen');
  });

  it('sums the shown period and marks it against the usual amount', () => {
    // One run in each of the four weeks before, two this week.
    const runs = [
      completedRun('a', '2025-03-10'),
      completedRun('b', '2025-03-11'),
      ...['2025-03-03', '2025-02-24', '2025-02-17', '2025-02-10'].map(date =>
        completedRun(`w${date}`, date),
      ),
    ];
    const { tree } = renderPlanning(normalizeSchedule(), { runs });
    press(tree, 'Wochenansicht zeigen');
    const workouts = tree.root.find(
      node =>
        node.props.accessible === true &&
        typeof node.props.accessibilityLabel === 'string' &&
        node.props.accessibilityLabel.includes('Einheiten'),
    );
    expect(workouts.props.accessibilityLabel).toBe(
      '2 Einheiten, mehr als üblich',
    );
    const text = screenText(tree);
    expect(text).toContain('1:00 h');
    expect(text).toContain('10,00 km');
    expect(text).toContain('gegenüber den ersten 3 Tagen der 4 Wochen davor');
  });

  it('keeps a failed save visible and shows the saved plan again', async () => {
    const state = normalizeSchedule();
    const { tree, onSave } = renderPlanning(state);
    onSave.mockRejectedValueOnce(new Error('Speicher voll'));
    act(() => dayCell(tree, 'Montag, 17. März').props.onPress());
    await act(async () => byLabel(tree, 'Lauf planen').props.onPress());
    expect(screenText(tree)).toContain('Speicher voll');
    expect(dayCell(tree, 'Montag, 17. März').props.accessibilityLabel).toBe(
      'Montag, 17. März',
    );
  });
});
