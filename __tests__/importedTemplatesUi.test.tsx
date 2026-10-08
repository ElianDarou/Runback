import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { Text } from 'react-native';
import { ImportedTemplates } from '../src/ui/ImportedTemplates';
import { ExercisePicker } from '../src/ui/ExercisePicker';
import { nativeCall } from '../src/native';
import { Button, Disclosure, Input, Row, Sheet } from '../src/ui/components';
import { parseStrongCsvPreview } from '../src/domain/vendorImports';
import { CATALOG } from '../src/domain/catalog';
import type { WorkoutTemplate } from '../src/domain/strength';

jest.mock('../src/native', () => ({ nativeCall: jest.fn() }));
const workouts = parseStrongCsvPreview('Date;Workout Name;Exercise Name;Set Order;Weight (kg);Reps;Seconds;Notes\n2024-01-01 18:00:00;Push;Bench Press (Barbell);1;60;8;;Kontrolle\n2024-01-01 18:00:00;Push;Bench Press (Barbell);Rest Timer;;;90;').workouts;
function textContent(node: TestRenderer.ReactTestInstance): string {
  return node.children.map(child => typeof child === 'string' || typeof child === 'number'
    ? String(child) : textContent(child as TestRenderer.ReactTestInstance)).join('');
}
function texts(tree: TestRenderer.ReactTestRenderer) {
  return tree.root.findAllByType(Text).map(textContent).join(' ');
}
async function render(onSave: (template: WorkoutTemplate) => Promise<void> = jest.fn(async (_template: WorkoutTemplate) => {})) {
  (nativeCall as jest.Mock).mockResolvedValue({ workouts });
  let tree!: TestRenderer.ReactTestRenderer;
  await act(async () => { tree = TestRenderer.create(<ImportedTemplates onDismiss={jest.fn()} templates={[]} onSave={onSave} busy={false} />); });
  return tree;
}
it('shows the preview first and saves only after the user’s own accept action', async () => {
  const onSave = jest.fn(async (_template: WorkoutTemplate) => {});
  const tree = await render(onSave);
  expect(nativeCall).toHaveBeenCalledWith('getStrengthImportCandidates');
  expect(onSave).not.toHaveBeenCalled();
  await act(async () => { tree.root.findByType(Row).props.onPress(); });
  expect(tree.root.findByType(Sheet).props.visible).toBe(true);
  expect(onSave).not.toHaveBeenCalled();
  await act(async () => { tree.root.findAllByType(Disclosure)[0].find(node => node.props.onPress).props.onPress(); });
  expect(texts(tree)).toContain('60 kg · 8 Wdh. · 90 s Pause');
  await act(async () => { tree.root.findAllByType(Button).find(button => button.props.title === 'Vorlage übernehmen')!.props.onPress(); });
  expect(onSave).toHaveBeenCalledTimes(1);
  expect(onSave.mock.calls[0][0]).toMatchObject({ name: 'Push', days: [], importSource: { source: 'strong' } });
  expect(tree.root.findByType(Sheet).props.visible).toBe(false);
});
it('keeps the preview open for a retry after a save error', async () => {
  const onSave = jest.fn(async () => { throw new Error('db'); });
  const tree = await render(onSave);
  await act(async () => { tree.root.findByType(Row).props.onPress(); });
  await act(async () => { tree.root.findAllByType(Button).find(button => button.props.title === 'Vorlage übernehmen')!.props.onPress(); });
  expect(tree.root.findByType(Sheet).props.visible).toBe(true);
  expect(texts(tree)).toContain('Vorlage konnte nicht gespeichert werden.');
});
it('deletes suggestions only after confirmation and keeps them hidden after reopening', async () => {
  (nativeCall as jest.Mock).mockResolvedValue({ workouts });
  const onSave = jest.fn();
  let dismissedIds: string[] = [];
  const onDismiss = jest.fn(async (id: string) => {
    dismissedIds = [id];
  });
  let tree!: TestRenderer.ReactTestRenderer;
  const props = { templates: [], onSave, onDismiss, busy: false };
  await act(async () => {
    tree = TestRenderer.create(<ImportedTemplates {...props} />);
  });
  const press = async (title: string) => {
    await act(async () => {
      tree.root
        .findAllByType(Button)
        .find((button) => button.props.title === title)!
        .props.onPress();
    });
  };
  try {
    await act(async () => {
      tree.root.findByType(Row).props.onPress();
    });
    await press('Vorschlag löschen');
    expect(onDismiss).not.toHaveBeenCalled();
    expect(texts(tree)).toContain('importierte Einheit bleibt erhalten');
    await press('Behalten');
    expect(onDismiss).not.toHaveBeenCalled();
    await press('Vorschlag löschen');
    await press('Löschen bestätigen');
    expect(onDismiss).toHaveBeenCalledWith('import-template:strong:push');
    expect(onSave).not.toHaveBeenCalled();
    await act(async () => {
      tree.update(<ImportedTemplates {...props} dismissedIds={dismissedIds} />);
    });
    expect(tree.toJSON()).toBeNull();
    await act(async () => {
      tree.unmount();
    });
    await act(async () => {
      tree = TestRenderer.create(
        <ImportedTemplates {...props} dismissedIds={dismissedIds} />,
      );
    });
    expect(tree.toJSON()).toBeNull();
  } finally {
    await act(async () => {
      tree.unmount();
    });
  }
});
it('keeps the confirmation open after a delete error and allows a retry', async () => {
  (nativeCall as jest.Mock).mockResolvedValue({ workouts });
  const onDismiss = jest
    .fn()
    .mockRejectedValueOnce(new Error('db'))
    .mockResolvedValue(undefined);
  const onSave = jest.fn();
  let tree!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = TestRenderer.create(
      <ImportedTemplates
        templates={[]}
        onSave={onSave}
        onDismiss={onDismiss}
        busy={false}
      />,
    );
  });
  const press = async (title: string) => {
    await act(async () => {
      tree.root
        .findAllByType(Button)
        .find((button) => button.props.title === title)!
        .props.onPress();
    });
  };
  try {
    await act(async () => {
      tree.root.findByType(Row).props.onPress();
    });
    await press('Vorschlag löschen');
    await press('Löschen bestätigen');
    expect(tree.root.findByType(Sheet).props.visible).toBe(true);
    expect(texts(tree)).toContain('Vorschlag konnte nicht gelöscht werden.');
    await press('Löschen bestätigen');
    expect(onDismiss).toHaveBeenCalledTimes(2);
    expect(onSave).not.toHaveBeenCalled();
    expect(tree.root.findByType(Sheet).props.visible).toBe(false);
  } finally {
    await act(async () => {
      tree.unmount();
    });
  }
});
it('locks both actions and closing while deleting', async () => {
  (nativeCall as jest.Mock).mockResolvedValue({ workouts });
  let finish!: () => void;
  const onDismiss = jest.fn(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  let tree!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = TestRenderer.create(
      <ImportedTemplates
        templates={[]}
        onSave={jest.fn()}
        onDismiss={onDismiss}
        busy={false}
      />,
    );
  });
  try {
    await act(async () => {
      tree.root.findByType(Row).props.onPress();
    });
    await act(async () => {
      tree.root
        .findAllByType(Button)
        .find((button) => button.props.title === 'Vorschlag löschen')!
        .props.onPress();
    });
    await act(async () => {
      tree.root
        .findAllByType(Button)
        .find((button) => button.props.title === 'Löschen bestätigen')!
        .props.onPress();
    });
    expect(
      tree.root.findAllByType(Button).every((button) => button.props.disabled),
    ).toBe(true);
    await act(async () => {
      tree.root.findByType(Sheet).props.onClose();
    });
    expect(tree.root.findByType(Sheet).props.visible).toBe(true);
    await act(async () => {
      finish();
    });
    expect(tree.root.findByType(Sheet).props.visible).toBe(false);
  } finally {
    await act(async () => {
      tree.unmount();
    });
  }
});
it('hides already accepted templates after saving', async () => {
  let templates: WorkoutTemplate[] = [];
  const onSave = async (template: WorkoutTemplate) => { templates = [template]; };
  const tree = await render(onSave);
  await act(async () => { tree.root.findByType(Row).props.onPress(); });
  await act(async () => { tree.root.findAllByType(Button).find(button => button.props.title === 'Vorlage übernehmen')!.props.onPress(); });
  await act(async () => { tree.update(<ImportedTemplates onDismiss={jest.fn()} templates={templates} onSave={onSave} busy={false} />); });
  expect(tree.toJSON()).toBeNull();
});
it('shows loading errors with a retry action and invents no empty success', async () => {
  (nativeCall as jest.Mock).mockRejectedValueOnce(new Error('bridge'));
  let tree!: TestRenderer.ReactTestRenderer;
  await act(async () => { tree = TestRenderer.create(<ImportedTemplates onDismiss={jest.fn()} templates={[]} onSave={jest.fn()} busy={false} />); });
  expect(texts(tree)).toContain('Vorlagen konnten nicht geladen werden.');
  (nativeCall as jest.Mock).mockResolvedValueOnce({ workouts });
  await act(async () => { tree.root.findByType(Button).props.onPress(); });
  expect(texts(tree)).toContain('Push');
});
it('makes the full catalog reachable and searches English names', async () => {
  const onSelect = jest.fn();
  let tree!: TestRenderer.ReactTestRenderer;
  await act(async () => { tree = TestRenderer.create(<ExercisePicker visible onSelect={onSelect} onClose={jest.fn()} />); });
  for (let count = 40; count < CATALOG.length; count += 40) {
    await act(async () => { tree.root.findAllByType(Button).find(button => button.props.title === 'Weitere Übungen zeigen')!.props.onPress(); });
  }
  expect(tree.root.findAllByType(Row)).toHaveLength(CATALOG.length);
  await act(async () => { tree.root.findByType(Input).props.onChangeText('Arnold Press'); });
  expect(texts(tree)).toContain('Arnold-Drücken (Kurzhantel)');
  await act(async () => { tree.root.findByType(Row).props.onPress(); });
  expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: 'fedb:Arnold_Dumbbell_Press' }));
});


it('updates an open preview when the import finishes', async () => {
  (nativeCall as jest.Mock).mockResolvedValueOnce({ workouts: [] });
  let tree!: TestRenderer.ReactTestRenderer;
  const props = { templates: [], onSave: jest.fn(), onDismiss: jest.fn(), busy: false };
  await act(async () => { tree = TestRenderer.create(<ImportedTemplates {...props} refreshKey="running:0" />); });
  expect(tree.toJSON()).toBeNull();
  (nativeCall as jest.Mock).mockResolvedValueOnce({ workouts });
  await act(async () => { tree.update(<ImportedTemplates {...props} refreshKey="completed:1" />); });
  expect(texts(tree)).toContain('Push');
  expect(props.onSave).not.toHaveBeenCalled();
});
