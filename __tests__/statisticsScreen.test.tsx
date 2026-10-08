import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import {
  Statistics,
  defaultStatisticsView,
  readStatisticsView,
  type StatisticsView,
} from '../src/ui/Statistics';
import type { Run } from '../src/native';
import { Row } from '../src/ui/components';

const NOW = Date.now();
const days = (count: number) => count * 24 * 60 * 60 * 1000;

const run = (overrides: Partial<Run> = {}): Run => ({
  id: 'run-1',
  startTime: NOW - days(2),
  endTime: NOW - days(2) + 3_600_000,
  durationSeconds: 3600,
  distanceMeters: 10000,
  purpose: 'easy',
  source: 'test',
  status: 'completed',
  ...overrides,
});

const pressables = (tree: ReactTestRenderer.ReactTestRenderer) =>
  tree.root.findAll(node => typeof node.props?.onPress === 'function');

const byLabel = (tree: ReactTestRenderer.ReactTestRenderer, label: string) =>
  pressables(tree).find(node => node.props.accessibilityLabel === label);

const labelStartingWith = (
  tree: ReactTestRenderer.ReactTestRenderer,
  prefix: string,
) =>
  pressables(tree).find(node =>
    String(node.props.accessibilityLabel ?? '').startsWith(prefix),
  );

const texts = (tree: ReactTestRenderer.ReactTestRenderer) =>
  tree.root
    .findAllByType('Text' as unknown as React.ComponentType)
    .map(node => JSON.stringify(node.props.children))
    .join(' ');

const render = (
  runs: Run[],
  view: StatisticsView = defaultStatisticsView,
  onViewChange?: (next: StatisticsView) => void,
) => {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  ReactTestRenderer.act(() => {
    tree = ReactTestRenderer.create(
      <Statistics runs={runs} view={view} onViewChange={onViewChange} />,
    );
  });
  return tree;
};

describe('Statistics', () => {
  it('shows the empty state instead of empty charts when there are no runs', () => {
    const tree = render([]);
    expect(JSON.stringify(tree.toJSON())).toContain('Noch keine Läufe');
    expect(byLabel(tree, 'Zeitraum')).toBeUndefined();
  });

  it('reports the chosen period outward', () => {
    const onViewChange = jest.fn();
    const tree = render([run()], defaultStatisticsView, onViewChange);
    ReactTestRenderer.act(() => {
      byLabel(tree, '4 Wochen')!.props.onPress();
    });
    expect(onViewChange).toHaveBeenCalledWith({
      range: '4w',
      metric: 'distance',
    });
  });

  it('reports the chosen metric outward', () => {
    const onViewChange = jest.fn();
    const tree = render([run()], defaultStatisticsView, onViewChange);
    ReactTestRenderer.act(() => {
      byLabel(tree, 'Dauer')!.props.onPress();
    });
    expect(onViewChange).toHaveBeenCalledWith({
      range: '12w',
      metric: 'duration',
    });
  });

  it('hides metrics that have no data', () => {
    const bare = render([run({ distanceMeters: 200, durationSeconds: 90 })]);
    expect(byLabel(bare, 'Tempo')).toBeUndefined();
    expect(byLabel(bare, 'Gefühl')).toBeUndefined();

    const rated = render([
      run({ rpe: { legs: 5, breathing: 7, recordedAt: 1 } }),
    ]);
    expect(byLabel(rated, 'Tempo')).toBeDefined();
    expect(byLabel(rated, 'Gefühl')).toBeDefined();
  });

  it('opens a bar’s values in place', () => {
    const tree = render([run()]);
    expect(texts(tree)).not.toContain('Woche ');

    const bar = labelStartingWith(tree, 'Woche ');
    ReactTestRenderer.act(() => {
      bar!.props.onPress();
    });
    const shown = texts(tree);
    expect(shown).toContain('Woche ');
  });

  it('expands a section only on request', () => {
    const tree = render([run()]);
    const panel = labelStartingWith(tree, 'Bestwerte,')!;
    expect(panel.props.accessibilityState.expanded).toBe(false);
    expect(texts(tree)).not.toContain('Längster Lauf');

    ReactTestRenderer.act(() => {
      panel.props.onPress();
    });
    expect(texts(tree)).toContain('Längster Lauf');
  });

  it('opens single records and the strongest week with their sources', () => {
    const onOpenRecord = jest.fn();
    let tree!: ReactTestRenderer.ReactTestRenderer;
    ReactTestRenderer.act(() => {
      tree = ReactTestRenderer.create(
        <Statistics runs={[run()]} onOpenRecord={onOpenRecord} />,
      );
    });
    ReactTestRenderer.act(() => {
      labelStartingWith(tree, 'Bestwerte,')!.props.onPress();
    });
    for (const title of [
      'Längster Lauf',
      'Längste Dauer',
      'Schnellster Lauf ab 5 km',
      'Stärkste Woche',
    ]) {
      const row = tree.root
        .findAllByType(Row)
        .find(node => node.props.title === title)!;
      expect(
        row.findAll(node => node.props.accessibilityRole === 'button').length,
      ).toBeGreaterThan(0);
      expect(
        row
          .findAllByType('Text' as unknown as React.ComponentType)
          .some(node => node.props.children === '›'),
      ).toBe(true);
      ReactTestRenderer.act(() => row.props.onPress());
      expect(onOpenRecord).toHaveBeenLastCalledWith(
        expect.objectContaining({ label: title, runIds: ['run-1'] }),
      );
    }
  });

  it('offers no link without a run id or navigation and locks while loading', () => {
    const onOpenRecord = jest.fn();
    let tree!: ReactTestRenderer.ReactTestRenderer;
    ReactTestRenderer.act(() => {
      tree = ReactTestRenderer.create(
        <Statistics runs={[run()]} onOpenRecord={onOpenRecord} busy />,
      );
    });
    ReactTestRenderer.act(() =>
      labelStartingWith(tree, 'Bestwerte,')!.props.onPress(),
    );
    const row = tree.root
      .findAllByType(Row)
      .find(node => node.props.title === 'Längster Lauf')!;
    expect(
      row.findAll(node => node.props.accessibilityRole === 'button')[0].props
        .accessibilityState.disabled,
    ).toBe(true);
    for (const props of [
      { runs: [run({ id: '' })], onOpenRecord },
      { runs: [run()] },
    ]) {
      ReactTestRenderer.act(() => tree.update(<Statistics {...props} />));
      const record = tree.root
        .findAllByType(Row)
        .find(node => node.props.title === 'Längster Lauf')!;
      expect(record.props.onPress).toBeUndefined();
    }
  });
});

describe('readStatisticsView', () => {
  it('keeps the saved selection and discards nonsense', () => {
    expect(readStatisticsView({ range: '1y', metric: 'pace' })).toEqual({
      range: '1y',
      metric: 'pace',
    });
    expect(readStatisticsView({ range: 'gestern', metric: 42 })).toEqual(
      defaultStatisticsView,
    );
    expect(readStatisticsView(undefined)).toEqual(defaultStatisticsView);
  });
});

describe('Statistics · Features', () => {
  it('shows only the chosen modules under "Look deeper"', () => {
    let tree!: ReactTestRenderer.ReactTestRenderer;
    ReactTestRenderer.act(() => {
      tree = ReactTestRenderer.create(
        <Statistics runs={[run()]} modules={['records']} />,
      );
    });
    const all = texts(tree);
    expect(all).toContain('"Bestwerte"');
    expect(all).not.toContain('"Verteilung"');
    expect(all).not.toContain('"Konsistenz"');
    expect(all).not.toContain('"Körperwerte"');
    ReactTestRenderer.act(() => {
      tree = ReactTestRenderer.create(
        <Statistics runs={[run()]} modules={[]} />,
      );
    });
    expect(texts(tree)).not.toContain('"Tiefer schauen"');
  });

  it('shows no running statistics and no empty state for them without the Running area', () => {
    let tree!: ReactTestRenderer.ReactTestRenderer;
    ReactTestRenderer.act(() => {
      tree = ReactTestRenderer.create(
        <Statistics runs={[run()]} showRunning={false} />,
      );
    });
    const all = texts(tree);
    expect(all).not.toContain('"Noch keine Läufe"');
    expect(all).not.toContain('"Verlauf"');
    expect(byLabel(tree, 'Zeitraum')).toBeUndefined();
  });
});
