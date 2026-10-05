import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { Alert, Text } from 'react-native';
import { ImportReview } from '../src/ui/ImportReview';
import { ImportHistory } from '../src/ui/ImportHistory';
import { readImportBatches, readImportPreview } from '../src/domain/importReview';

function textContent(node: TestRenderer.ReactTestInstance): string {
  return node.children
    .map(child =>
      typeof child === 'string' || typeof child === 'number'
        ? String(child)
        : textContent(child as TestRenderer.ReactTestInstance),
    )
    .join('');
}

const preview = readImportPreview({
  runs: { new: 2, duplicates: 1 },
  wellness: { weight: 3 },
  strength: {
    duplicates: 0,
    workouts: [
      {
        id: 'strong:late',
        time: Date.UTC(2026, 6, 28, 19),
        name: 'Pull',
        sets: 1,
        durationSeconds: 54578,
        durationSuspect: true,
      },
      {
        id: 'strong:ok',
        time: Date.UTC(2026, 6, 29, 16),
        name: 'Push',
        sets: 12,
        durationSeconds: 3600,
        durationSuspect: false,
      },
    ],
  },
})!;

const checkbox = (tree: TestRenderer.ReactTestRenderer, label: string) =>
  tree.root.find(
    node =>
      node.props.accessibilityRole === 'checkbox' &&
      node.props.accessibilityLabel === label &&
      typeof node.props.onPress === 'function',
  );
const button = (tree: TestRenderer.ReactTestRenderer, label: string) =>
  tree.root.find(
    node =>
      node.props.accessibilityRole === 'button' &&
      node.props.accessibilityLabel === label &&
      typeof node.props.onPress === 'function',
  );

describe('ImportReview', () => {
  it('saves nothing until the user commits, and sends the chosen parts', () => {
    const onCommit = jest.fn();
    let tree!: TestRenderer.ReactTestRenderer;
    act(() => {
      tree = TestRenderer.create(
        <ImportReview
          preview={preview}
          files={['strong.csv']}
          busy={false}
          onCommit={onCommit}
          onDiscard={jest.fn()}
        />,
      );
    });
    const text = tree.root.findAllByType(Text).map(textContent).join(' ');
    expect(text).toContain('Dauer übernehmen?');
    expect(text).toContain('Schon gespeichert: 1 Läufe');
    expect(onCommit).not.toHaveBeenCalled();
    expect(checkbox(tree, 'Pull · 28.07.2026').props.accessibilityState.checked).toBe(false);

    act(() => checkbox(tree, 'Läufe').props.onPress());
    act(() => checkbox(tree, 'Pull · 28.07.2026').props.onPress());
    act(() => button(tree, '5 Einträge übernehmen').props.onPress());
    expect(onCommit).toHaveBeenCalledWith(
      expect.objectContaining({
        runs: false,
        strength: true,
        wellnessKinds: ['weight'],
        keepDurationIds: ['strong:late'],
        excludedStrengthIds: [],
        templateSuggestions: true,
      }),
    );
  });

  it('keeps the choice when the app re-renders with a fresh preview object', () => {
    const onCommit = jest.fn();
    const props = { files: [], busy: false, onCommit, onDiscard: jest.fn() };
    let tree!: TestRenderer.ReactTestRenderer;
    act(() => {
      tree = TestRenderer.create(<ImportReview key="t1" preview={preview} {...props} />);
    });
    act(() => checkbox(tree, 'Läufe').props.onPress());
    act(() => {
      tree.update(<ImportReview key="t1" preview={{ ...preview }} {...props} />);
    });
    expect(checkbox(tree, 'Läufe').props.accessibilityState.checked).toBe(false);
  });

  it('says so when everything is already stored', () => {
    const onDiscard = jest.fn();
    let tree!: TestRenderer.ReactTestRenderer;
    act(() => {
      tree = TestRenderer.create(
        <ImportReview
          preview={readImportPreview({ runs: { duplicates: 3 } })!}
          files={[]}
          busy={false}
          onCommit={jest.fn()}
          onDiscard={onDiscard}
        />,
      );
    });
    expect(tree.root.findAllByType(Text).map(textContent).join(' ')).toContain(
      'Alles Lesbare aus diesen Dateien ist schon gespeichert.',
    );
    act(() => button(tree, 'Schließen').props.onPress());
    expect(onDiscard).toHaveBeenCalled();
  });
});

describe('ImportReview problems', () => {
  it('names files that could not be read instead of calling them stored', () => {
    let tree!: TestRenderer.ReactTestRenderer;
    act(() => {
      tree = TestRenderer.create(
        <ImportReview
          preview={readImportPreview({})!}
          files={['kaputt.zip']}
          problems={{ failed: 1, skipped: 0, nonRunning: 0, errors: ['kaputt.zip: Beschädigtes ZIP'] }}
          busy={false}
          onCommit={jest.fn()}
          onDiscard={jest.fn()}
        />,
      );
    });
    const text = tree.root.findAllByType(Text).map(textContent).join(' ');
    expect(text).toContain('nichts gefunden');
    expect(text).not.toContain('schon gespeichert');
    expect(text).toContain('1 Datei ließ sich nicht lesen.');
    expect(text).toContain('kaputt.zip: Beschädigtes ZIP');
  });
});

describe('ImportHistory', () => {
  it('asks before deleting and keeps templates out of it', () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const onDelete = jest.fn();
    const batches = readImportBatches({
      batches: [
        {
          id: 'legacy:strong',
          legacy: true,
          source: 'strong',
          counts: { strength: 53 },
        },
      ],
    });
    let tree!: TestRenderer.ReactTestRenderer;
    act(() => {
      tree = TestRenderer.create(
        <ImportHistory
          batches={batches}
          busy={false}
          onDelete={onDelete}
          onImport={jest.fn()}
        />,
      );
    });
    act(() => button(tree, 'Strong · früherer Import').props.onPress());
    act(() => button(tree, 'Import löschen').props.onPress());
    expect(alert).toHaveBeenCalled();
    const [title, body, actions] = alert.mock.calls[0] as any;
    expect(title).toBe('Import löschen?');
    expect(body).toContain('53 Krafteinheiten');
    expect(body).toContain('Gespeicherte Vorlagen bleiben');
    expect(onDelete).not.toHaveBeenCalled();
    actions.find((item: any) => item.style === 'destructive').onPress();
    expect(onDelete).toHaveBeenCalledWith(batches[0]);
    alert.mockRestore();
  });

  it('shows an empty state with a way forward', () => {
    let tree!: TestRenderer.ReactTestRenderer;
    act(() => {
      tree = TestRenderer.create(
        <ImportHistory batches={[]} busy={false} onDelete={jest.fn()} onImport={jest.fn()} />,
      );
    });
    expect(tree.root.findAllByType(Text).map(textContent).join(' ')).toContain(
      'Noch keine Importe',
    );
  });
});
