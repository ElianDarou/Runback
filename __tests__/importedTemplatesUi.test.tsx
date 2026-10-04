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
  await act(async () => { tree = TestRenderer.create(<ImportedTemplates templates={[]} onSave={onSave} busy={false} />); });
  return tree;
}
it('zeigt erst die Vorschau und speichert nur nach der eigenen Übernahmeaktion', async () => {
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
it('lässt die Vorschau nach einem Speicherfehler zum erneuten Versuch offen', async () => {
  const onSave = jest.fn(async () => { throw new Error('db'); });
  const tree = await render(onSave);
  await act(async () => { tree.root.findByType(Row).props.onPress(); });
  await act(async () => { tree.root.findAllByType(Button).find(button => button.props.title === 'Vorlage übernehmen')!.props.onPress(); });
  expect(tree.root.findByType(Sheet).props.visible).toBe(true);
  expect(texts(tree)).toContain('Vorlage konnte nicht gespeichert werden.');
});
it('blendet bereits übernommene Vorlagen nach dem Speichern aus', async () => {
  let templates: WorkoutTemplate[] = [];
  const onSave = async (template: WorkoutTemplate) => { templates = [template]; };
  const tree = await render(onSave);
  await act(async () => { tree.root.findByType(Row).props.onPress(); });
  await act(async () => { tree.root.findAllByType(Button).find(button => button.props.title === 'Vorlage übernehmen')!.props.onPress(); });
  await act(async () => { tree.update(<ImportedTemplates templates={templates} onSave={onSave} busy={false} />); });
  expect(tree.toJSON()).toBeNull();
});
it('zeigt Ladefehler mit einer erneuten Aktion und erfindet keinen leeren Erfolg', async () => {
  (nativeCall as jest.Mock).mockRejectedValueOnce(new Error('bridge'));
  let tree!: TestRenderer.ReactTestRenderer;
  await act(async () => { tree = TestRenderer.create(<ImportedTemplates templates={[]} onSave={jest.fn()} busy={false} />); });
  expect(texts(tree)).toContain('Vorlagen konnten nicht geladen werden.');
  (nativeCall as jest.Mock).mockResolvedValueOnce({ workouts });
  await act(async () => { tree.root.findByType(Button).props.onPress(); });
  expect(texts(tree)).toContain('Push');
});
it('macht den vollständigen Katalog erreichbar und sucht englische Namen', async () => {
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


it('aktualisiert eine bereits geöffnete Vorschau, wenn der Import fertig ist', async () => {
  (nativeCall as jest.Mock).mockResolvedValueOnce({ workouts: [] });
  let tree!: TestRenderer.ReactTestRenderer;
  const props = { templates: [], onSave: jest.fn(), busy: false };
  await act(async () => { tree = TestRenderer.create(<ImportedTemplates {...props} refreshKey="running:0" />); });
  expect(tree.toJSON()).toBeNull();
  (nativeCall as jest.Mock).mockResolvedValueOnce({ workouts });
  await act(async () => { tree.update(<ImportedTemplates {...props} refreshKey="completed:1" />); });
  expect(texts(tree)).toContain('Push');
  expect(props.onSave).not.toHaveBeenCalled();
});
