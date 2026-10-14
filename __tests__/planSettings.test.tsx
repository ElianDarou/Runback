import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { PlanSettings } from '../src/ui/PlanSettings';
import { normalizeSchedule } from '../src/domain/schedule';
import type { WorkoutTemplate } from '../src/domain/strength';

const pull: WorkoutTemplate = {
  id: 'pull',
  name: 'Pull',
  days: [1],
  exercises: [],
  createdAt: 1,
};

const render = (
  extra: Partial<React.ComponentProps<typeof PlanSettings>> = {},
) => {
  const onSaveSchedule = jest.fn();
  const onSaveTemplates = jest.fn();
  let tree!: TestRenderer.ReactTestRenderer;
  act(() => {
    tree = TestRenderer.create(
      <PlanSettings
        schedule={normalizeSchedule({ runDays: [1] })}
        templates={[pull]}
        showRunning
        showStrength
        disabled={false}
        onSaveSchedule={onSaveSchedule}
        onSaveTemplates={onSaveTemplates}
        {...extra}
      />,
    );
  });
  return { tree, onSaveSchedule, onSaveTemplates };
};

const chip = (
  tree: TestRenderer.ReactTestRenderer,
  group: string,
  day: string,
) =>
  tree.root
    .find(node => node.props.accessibilityLabel === group && node.props.style)
    .find(
      node =>
        node.props.accessibilityLabel === day &&
        typeof node.props.onPress === 'function',
    );

describe('PlanSettings', () => {
  it('sets weekly run days on the plan and template days on the template', () => {
    const { tree, onSaveSchedule, onSaveTemplates } = render();
    expect(
      chip(tree, 'Wochentage für Läufe', 'Di').props.accessibilityState,
    ).toMatchObject({ checked: true });
    act(() => chip(tree, 'Wochentage für Läufe', 'Fr').props.onPress());
    expect(onSaveSchedule.mock.calls[0][0].runDays).toEqual([1, 4]);
    // Monday in the chips is day 1 on the template (Sunday-based).
    expect(
      chip(tree, 'Wochentage für Pull', 'Mo').props.accessibilityState,
    ).toMatchObject({ checked: true });
    act(() => chip(tree, 'Wochentage für Pull', 'So').props.onPress());
    expect(onSaveTemplates.mock.calls[0][0][0].days).toEqual([0, 1]);
  });

  it('picks a symbol for a template', () => {
    const { tree, onSaveTemplates } = render();
    act(() =>
      tree.root
        .find(
          node =>
            node.props.accessibilityLabel === 'Symbol für Pull wählen' &&
            typeof node.props.onPress === 'function',
        )
        .props.onPress(),
    );
    act(() =>
      tree.root
        .find(
          node =>
            node.props.accessibilityRole === 'radio' &&
            node.props.accessibilityLabel === 'Greifen' &&
            typeof node.props.onPress === 'function',
        )
        .props.onPress(),
    );
    expect(onSaveTemplates.mock.calls[0][0][0].icon).toBe('handGrab');
  });

  it('leaves out the area that is switched off', () => {
    const { tree } = render({ showRunning: false });
    expect(
      tree.root.findAll(
        node => node.props.accessibilityLabel === 'Wochentage für Läufe',
      ),
    ).toHaveLength(0);
  });
});
