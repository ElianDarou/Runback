import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { Text } from 'react-native';
import { EndEditor } from '../src/ui/EndEditor';
import { END_SUGGESTION_VERSION } from '../src/domain/endCorrection';

const START = new Date(2026, 9, 1, 16, 0, 0).getTime();
const MIN = 60_000;

function textContent(node: TestRenderer.ReactTestInstance): string {
  return node.children
    .map(child =>
      typeof child === 'string' || typeof child === 'number'
        ? String(child)
        : textContent(child as TestRenderer.ReactTestInstance),
    )
    .join('');
}
const press = (tree: TestRenderer.ReactTestRenderer, label: string) =>
  act(() =>
    tree.root
      .find(
        node =>
          node.props.accessibilityLabel === label &&
          typeof node.props.onPress === 'function',
      )
      .props.onPress(),
  );
const readout = (tree: TestRenderer.ReactTestRenderer) =>
  tree.root.findAllByType(Text).map(textContent).find(text => text.startsWith('Ende '));

describe('EndEditor', () => {
  const heart = Array.from({ length: 120 }, (_, i) => ({
    t: START + i * MIN,
    value: i < 70 ? 130 : 80,
  }));

  it('moves the end, takes the suggestion and saves only the chosen time', () => {
    const onSave = jest.fn();
    let tree!: TestRenderer.ReactTestRenderer;
    act(() => {
      tree = TestRenderer.create(
        <EndEditor
          startTime={START}
          rangeEnd={START + 120 * MIN}
          originalEnd={START + 120 * MIN}
          suggestion={{ time: START + 70 * MIN, reason: 'last_set', version: END_SUGGESTION_VERSION }}
          lines={[{ key: 'heart', label: 'Puls', unit: 'bpm', stroke: '#f00', points: heart }]}
          emptyHint="leer"
          busy={false}
          onSave={onSave}
        />,
      );
    });
    expect(readout(tree)).toBe('Ende 18:00:00 · Dauer 2:00:00');
    // Unverändert lässt sich nichts speichern.
    expect(
      tree.root.find(node => node.props.accessibilityLabel === 'Ende speichern' && node.props.accessibilityState)
        .props.accessibilityState.disabled,
    ).toBe(true);
    press(tree, 'Eine Minute früher');
    expect(readout(tree)).toBe('Ende 17:59:00 · Dauer 1:59:00');
    press(tree, '17:10 übernehmen · letzter abgehakter Satz');
    expect(readout(tree)).toBe('Ende 17:10:00 · Dauer 1:10:00');
    press(tree, 'Ende speichern');
    expect(onSave).toHaveBeenCalledWith(START + 70 * MIN);
  });

  it('says what is missing without a curve and offers the reset only for corrections', () => {
    const onReset = jest.fn();
    let tree!: TestRenderer.ReactTestRenderer;
    act(() => {
      tree = TestRenderer.create(
        <EndEditor
          startTime={START}
          rangeEnd={START + 240 * MIN}
          currentEnd={START + 75 * MIN}
          lines={[]}
          emptyHint="Für diese Zeit gibt es keinen Puls."
          busy={false}
          onSave={jest.fn()}
          onReset={onReset}
        />,
      );
    });
    const text = tree.root.findAllByType(Text).map(textContent).join(' ');
    expect(text).toContain('Für diese Zeit gibt es keinen Puls.');
    expect(readout(tree)).toBe('Ende 17:15:00 · Dauer 1:15:00');
    press(tree, 'Ursprüngliches Ende');
    expect(onReset).toHaveBeenCalled();
  });
});
