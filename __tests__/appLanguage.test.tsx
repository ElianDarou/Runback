import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { Text } from 'react-native';

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

jest.mock('../src/native', () => {
  // Inside the factory, because jest.mock is hoisted above the imports.
  const { emptyStrengthState } = require('../src/domain/strength');
  const state = {
    runs: [],
    recording: null,
    settings: { onboardedAt: 1, purpose: 'free', minutes: 30, language: 'en' },
    capabilities: {},
  };
  return {
    nativeCall: jest.fn(() => Promise.resolve({})),
    native: {
      serverStatus: jest.fn(() => Promise.resolve({ state: 'off', url: null, scope: { runs: true, strength: true, coach: true, gps: false, health: false } })),
      state: jest.fn(() => Promise.resolve(state)),
      beginRunArchive: jest.fn(() => Promise.resolve('archive')),
      appendRunArchive: jest.fn(() => Promise.resolve()),
      shareRunArchive: jest.fn(() => Promise.resolve()),
      discardRunArchive: jest.fn(() => Promise.resolve()),
      runIdsInRange: jest.fn(() => Promise.resolve([])),
      beginExportArchive: jest.fn(() => Promise.resolve('export')),
      appendExportArchive: jest.fn(() => Promise.resolve()),
      shareExportArchive: jest.fn(() => Promise.resolve()),
      discardExportArchive: jest.fn(() => Promise.resolve()),
      recordedStrengthSessionIds: jest.fn(() => Promise.resolve([])),
      strengthHeart: jest.fn(() => Promise.resolve(undefined)),
      motionStatus: jest.fn(() =>
        Promise.resolve({ sessions: 1, received: 1 }),
      ),
      runTimeline: jest.fn(() =>
        Promise.resolve({ rows: [], stepSeconds: 60 }),
      ),
      run: jest.fn(() => Promise.resolve(null)),
      saveSettings: jest.fn(() => Promise.resolve()),
      feedback: jest.fn(() => Promise.resolve()),
      strength: jest.fn(() => Promise.resolve(emptyStrengthState())),
      saveStrengthTemplates: jest.fn(templates =>
        Promise.resolve({ ...emptyStrengthState(), templates }),
      ),
      strengthSessions: jest.fn(() => Promise.resolve([])),
      sorenessReports: jest.fn(() => Promise.resolve([])),
      setDisplayNames: jest.fn(() => Promise.resolve()),
      saveStrengthSession: jest.fn(() => Promise.resolve()),
      finishStrengthSession: jest.fn(() =>
        Promise.resolve(emptyStrengthState()),
      ),
      strengthSession: jest.fn(() => Promise.resolve(null)),
      commitImport: jest.fn(() =>
        Promise.resolve({ state: 'completed', strength: 1 }),
      ),
      discardImport: jest.fn(() => Promise.resolve({ state: 'idle' })),
      importBatches: jest.fn(() => Promise.resolve([])),
      deleteImportBatch: jest.fn(() => Promise.resolve({})),
    },
  };
});

import { RunbackApp } from '../src/ui/RunbackApp';
import { native } from '../src/native';
import { getLanguage } from '../src/domain/i18n';

function textContent(node: TestRenderer.ReactTestInstance): string {
  return node.children
    .map(child =>
      typeof child === 'string' || typeof child === 'number'
        ? String(child)
        : textContent(child as TestRenderer.ReactTestInstance),
    )
    .join('');
}

const tabLabels = (tree: TestRenderer.ReactTestRenderer): string[] =>
  tree.root
    .findAll(item => item.props?.accessibilityRole === 'tab')
    .map(item => item.props.accessibilityLabel);

async function render() {
  let tree!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = TestRenderer.create(<RunbackApp />);
  });
  await act(async () => {
    await Promise.resolve();
  });
  return tree;
}

async function tapWhere(
  tree: TestRenderer.ReactTestRenderer,
  matches: (node: TestRenderer.ReactTestInstance) => boolean,
): Promise<void> {
  const node = tree.root.find(
    item => typeof item.props?.onPress === 'function' && matches(item),
  );
  await act(async () => {
    node.props.onPress();
  });
}

describe('app language', () => {
  let tree: TestRenderer.ReactTestRenderer | undefined;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(async () => {
    await act(async () => tree?.unmount());
    tree = undefined;
  });

  it('renders the tabs in English when the saved language is English', async () => {
    tree = await render();
    expect(getLanguage()).toBe('en');
    expect(tabLabels(tree)).toEqual(expect.arrayContaining(['Today', 'History']));
    expect(tabLabels(tree)).not.toContain('Heute');
    expect(tree.root.findAllByType(Text).map(textContent).join(' ')).toContain(
      'Today',
    );
  });

  it('switches back to German in settings and shows the German tabs', async () => {
    tree = await render();
    await tapWhere(
      tree,
      item =>
        /^Settings/.test(item.props.accessibilityLabel ?? ''),
    );
    await tapWhere(
      tree,
      item => item.props.accessibilityRole === 'radio' && item.props.accessibilityLabel === 'Deutsch',
    );
    expect(getLanguage()).toBe('de');
    expect(tabLabels(tree)).toEqual(expect.arrayContaining(['Heute', 'Verlauf']));
    expect(tabLabels(tree)).not.toContain('Today');
    expect(native.saveSettings).toHaveBeenCalledWith(
      expect.objectContaining({ language: 'de' }),
    );
  });
});
