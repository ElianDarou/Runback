import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { BackHandler, Text, TextInput } from 'react-native';

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

jest.mock('../src/native', () => {
  // Inside the factory, because jest.mock is hoisted above the imports.
  const { emptyStrengthState } = require('../src/domain/strength');
  const state = {
    runs: [],
    recording: null,
    settings: { onboardedAt: 1, purpose: 'free', minutes: 30 },
    capabilities: {},
  };
  return {
    STRENGTH_EXPORT_BATCH: 25,
    nativeCall: jest.fn(() => Promise.resolve({})),
    native: {
      serverStatus: jest.fn(() =>
        Promise.resolve({
          state: 'off',
          url: null,
          scope: {
            runs: true,
            strength: true,
            coach: true,
            gps: false,
            health: false,
          },
        }),
      ),
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
      // Like Kotlin's getRunExport: the run as from `run`, plus the timeline.
      runExport: jest.fn(async (_archive: string, id: string) => ({
        run: await jest.requireMock('../src/native').native.run(id),
        timeline: { rows: [], stepSeconds: 60 },
      })),
      strengthExportBatch: jest.fn(async (ids: string[]) => {
        const mock = jest.requireMock('../src/native').native;
        const items = [];
        for (const id of ids) {
          const session = await mock.strengthSession(id);
          if (session) items.push({ id, session, heart: undefined });
        }
        return items;
      }),
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

import { FEATURES_VERSION } from '../src/domain/features';
import { RunbackApp } from '../src/ui/RunbackApp';
import { native, nativeCall } from '../src/native';
import {
  Button,
  CheckRow,
  ChipGroup,
  color,
  Row,
  Segmented,
  Sheet,
  SwitchRow,
} from '../src/ui/components';
import { analyzeRun } from '../src/domain';
import {
  buildRunReport,
  buildRunAnalysisExport,
} from '../src/domain/runReport';
import type { RunSummary } from '../src/domain';
import { createTemplate, addTemplateExercise } from '../src/domain/plans';
import { catalogExercise } from '../src/domain/catalog';
import { emptyStrengthState } from '../src/domain/strength';
import { parseStrongCsvPreview } from '../src/domain/vendorImports';
import { importedStrengthSession } from '../src/domain/strengthImports';

const DAY = 86400000;
import { dateFormat } from '../src/domain/i18n';
function textContent(node: TestRenderer.ReactTestInstance): string {
  return node.children
    .map(child =>
      typeof child === 'string' || typeof child === 'number'
        ? String(child)
        : textContent(child as TestRenderer.ReactTestInstance),
    )
    .join('');
}

const screenText = (tree: TestRenderer.ReactTestRenderer) =>
  tree.root.findAllByType(Text).map(textContent).join(' ');

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

/** Switches (Switch) carry no title; they hang on the row before them. */
const flip = async (tree: TestRenderer.ReactTestRenderer, rowTitle: string) => {
  const row = tree.root
    .findAll(
      item =>
        item.props?.title === rowTitle &&
        typeof item.props?.trailing === 'object',
    )
    .at(0);
  if (!row) {
    throw new Error(`Keine Zeile „${rowTitle}“ mit Schalter gefunden.`);
  }
  const trailing = row.props.trailing;
  await act(async () => {
    trailing.props.onValueChange(!trailing.props.value);
  });
};
const tabLabels = (tree: TestRenderer.ReactTestRenderer) => [
  ...new Set(
    tree.root
      .findAll(item => item.props?.accessibilityRole === 'tab')
      .map(item => item.props.accessibilityLabel as string),
  ),
];

const tap = async (
  tree: TestRenderer.ReactTestRenderer,
  label: string,
): Promise<void> => {
  const node = tree.root.find(
    item =>
      typeof item.props?.onPress === 'function' &&
      (item.props?.accessibilityLabel === label ||
        item.props?.title === label ||
        (item.props?.accessibilityRole === 'tab' &&
          textContent(item).includes(label))),
  );
  await act(async () => {
    node.props.onPress();
  });
};

/** Rows carry their name as text, not as `accessibilityLabel`. */
const tapText = async (
  tree: TestRenderer.ReactTestRenderer,
  label: string,
): Promise<void> => {
  const node = tree.root
    .findAll(item => typeof item.props?.onPress === 'function')
    .find(item => textContent(item).includes(label));
  if (!node) {
    throw new Error(`No pressable element found with “${label}”.`);
  }
  await act(async () => {
    node.props.onPress();
  });
};

/** Opens the period field, goes back to the month and taps the first and last day. */
const pickPeriod = async (
  tree: TestRenderer.ReactTestRenderer,
  first: Date,
  last: Date,
) => {
  const field = tree.root.find(
    item =>
      typeof item.props?.onPress === 'function' &&
      typeof item.props?.accessibilityLabel === 'string' &&
      item.props.accessibilityLabel.startsWith('Zeitraum:'),
  );
  await act(async () => field.props.onPress());
  const now = new Date();
  const back =
    (now.getFullYear() - last.getFullYear()) * 12 +
    now.getMonth() -
    last.getMonth();
  for (let i = 0; i < back; i++) await tap(tree, 'Vorheriger Monat');
  const day = (date: Date) =>
    dateFormat({ day: 'numeric', month: 'short', year: 'numeric' }).format(
      date,
    );
  await tap(tree, day(first));
  await tap(tree, day(last));
  await tap(tree, 'Zeitraum übernehmen');
};

describe('Today', () => {
  it('shows the server outage at the gear and leaves the training start open', async () => {
    (native.serverStatus as jest.Mock).mockResolvedValueOnce({
      state: 'offline',
      url: 'http://nas.local:8080',
      scope: {
        runs: true,
        strength: true,
        coach: true,
        gps: false,
        health: false,
      },
      lastSuccessAt: null,
      pending: null,
    });
    const tree = await render();
    expect(screenText(tree)).toContain('Lauf starten');
    const mark = tree.root
      .findAllByType(Text)
      .find(item => textContent(item) === '●')!;
    expect(mark.props.style.color).toBe(color.danger);
    await tap(tree, 'Einstellungen · Server Nicht erreichbar');
    await tap(tree, 'Eigener Server');
    expect(screenText(tree)).toContain('Nicht erreichbar');
    expect(screenText(tree)).toContain(
      'sobald dein Server wieder erreichbar ist',
    );
    await act(async () => tree.unmount());
  });

  it('shows a connected server in green next to the gear', async () => {
    (native.serverStatus as jest.Mock).mockResolvedValueOnce({
      state: 'ok',
      url: 'http://nas.local:8080',
      scope: {
        runs: true,
        strength: true,
        coach: true,
        gps: false,
        health: false,
      },
      lastSuccessAt: null,
      pending: 0,
    });
    const tree = await render();
    const mark = tree.root
      .findAllByType(Text)
      .find(item => textContent(item) === '●')!;
    expect(mark.props.style.color).toBe(color.green);
    await tap(tree, 'Einstellungen · Server Aktuell');
    expect(screenText(tree)).toContain('Eigener Server');
    await act(async () => tree.unmount());
  });

  it('shows no dot without a configured server', async () => {
    const tree = await render();
    expect(screenText(tree)).not.toContain('●');
    await tap(tree, 'Einstellungen');
    await act(async () => tree.unmount());
  });

  it('shows one start action without a date, a fake plan or settings', async () => {
    const tree = await render();
    const text = screenText(tree);

    expect(text).toContain('Lauf starten');
    // The device already shows the date (Design Language § 6).
    expect(text).not.toMatch(/\d{1,2}\.\s|Montag|Dienstag|Mittwoch/);
    expect(text).not.toContain('Starte einfach');
    expect(text).not.toContain('Minuten eingeplant');
    // No arrow that promises an expansion (Design Language § 8).
    expect(text).not.toContain('⌄');
    // Goals and templates have their place under All features and in Plan.
    expect(text).not.toContain('Dein Ziel');
    expect(text).not.toContain('Laufvorlagen');
    // The run type is chosen only at the moment of starting.
    expect(text).not.toContain('Zweck');
    await tap(tree, 'Lauf starten');
    expect(screenText(tree)).toContain('Wie weit');
    expect(screenText(tree)).not.toContain('Wie willst du laufen?');
    await act(async () => {
      tree.unmount();
    });
  });

  it('drops the pace-usability sentence', async () => {
    const tree = await render();
    expect(screenText(tree)).not.toContain(
      'Zeit und Distanz sind für eine einfache Tempoauswertung nutzbar',
    );
    await act(async () => {
      tree.unmount();
    });
  });
});

describe('History', () => {
  it('opens record runs and returns through the strongest week to statistics', async () => {
    const monday = new Date();
    monday.setHours(0, 0, 0, 0);
    monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7) - 7);
    const base = {
      id: 'record-long',
      startTime: monday.getTime(),
      endTime: monday.getTime() + 3600000,
      durationSeconds: 3600,
      distanceMeters: 12000,
      purpose: 'long' as const,
      source: 'test',
      status: 'completed' as const,
    };
    const runs = [
      base,
      {
        ...base,
        id: 'record-easy',
        startTime: base.startTime + DAY,
        distanceMeters: 5000,
        purpose: 'easy' as const,
      },
      {
        ...base,
        id: 'outside-week',
        startTime: base.startTime - DAY,
        distanceMeters: 1000,
        purpose: 'free' as const,
      },
    ];
    jest.mocked(native.state).mockResolvedValueOnce({
      runs,
      recording: null,
      settings: { onboardedAt: 1, minutes: 30 },
      capabilities: {},
    });
    jest
      .mocked(native.run)
      .mockImplementation(async id => runs.find(run => run.id === id) as never);
    const tree = await render();
    const pressRow = async (title: string) => {
      const row = tree.root
        .findAllByType(Row)
        .find(node => node.props.title === title)!;
      await act(async () => row.props.onPress());
    };
    try {
      await tap(tree, 'Statistik');
      await tap(tree, 'Bestwerte, 12,0 km');
      await pressRow('Längster Lauf');
      expect(native.run).toHaveBeenLastCalledWith('record-long');
      expect(screenText(tree)).toContain('12,00');
      await tap(tree, 'Zurück');
      expect(screenText(tree)).toContain('Statistik');
      await tap(tree, 'Bestwerte, 12,0 km');
      await pressRow('Stärkste Woche');
      expect(screenText(tree)).toContain('17,0 km');
      expect(
        tree.root.findAllByType(Row).map(node => node.props.title),
      ).toEqual(['Lockere Runde', 'Lange Runde']);
      await pressRow('Lockere Runde');
      expect(native.run).toHaveBeenLastCalledWith('record-easy');
      await tap(tree, 'Zurück');
      expect(screenText(tree)).toContain('Stärkste Woche');
      await tap(tree, 'Zurück');
      expect(screenText(tree)).toContain('Zeitverlauf');
    } finally {
      jest.mocked(native.run).mockResolvedValue(null as never);
      await act(async () => tree.unmount());
    }
  });

  it('shows runs and strength side by side, without an import entry', async () => {
    const tree = await render();
    await tap(tree, 'Verlauf');
    const text = screenText(tree);

    expect(text).toContain('Einheiten');
    expect(text).toContain('Statistik');
    // Runs, rides and strength sessions share one list; without
    // sessions there is nothing to filter.
    expect(text).toContain('Hier beginnt deine Historie');
    expect(text).not.toContain('Alle');
    // Importing stays a setting, not a row in the history.
    expect(text).not.toContain('Importieren');
    expect(text).not.toContain('Vorhandene Läufe importieren');
    await act(async () => {
      tree.unmount();
    });
  });
});

describe('Development', () => {
  it('keeps one goal per area under All features, without focus or recommendation', async () => {
    jest.mocked(native.state).mockResolvedValueOnce({
      runs: [],
      recording: null,
      settings: { onboardedAt: 1, goal: '10 km', strengthGoal: 'Klimmzüge' },
      capabilities: {},
    });
    const tree = await render();
    expect(tabLabels(tree)).toEqual(['Heute', 'Plan', 'Statistik', 'Verlauf']);
    await tap(tree, 'Einstellungen');
    await tap(tree, 'Alle Funktionen');
    await tapText(tree, 'Ziel je Bereich');
    expect(screenText(tree)).toContain('10 km');
    expect(screenText(tree)).not.toContain('Klimmzüge');
    await tap(tree, 'Krafttraining');
    const text = screenText(tree);
    expect(text).toContain('Klimmzüge');
    expect(text).not.toContain('10 km');
    expect(text).not.toContain('Fokus');
    expect(text).not.toContain('Empfehlung');
    await tapText(tree, 'Ziel bearbeiten');
    const input = (label: string) =>
      tree.root.find(
        item =>
          item.props?.label === label &&
          typeof item.props?.onChangeText === 'function',
      );
    await act(async () => {
      input('Ziel im Krafttraining').props.onChangeText('10 Klimmzüge');
      input('Zieldatum im Krafttraining').props.onChangeText('01.03.2027');
    });
    await tap(tree, 'Ziel speichern');
    const saved = jest.mocked(native.saveSettings).mock.calls.at(-1)![0];
    expect(saved.strengthGoal).toBe('10 Klimmzüge');
    expect(saved.strengthGoalTargetDate).toBe('2027-03-01');
    expect(saved.strengthGoalTarget).toBeUndefined();
    expect(saved.goal).toBe('10 km');
    await tap(tree, 'Zurück');
    // Back on Progress, still on strength training.
    expect(screenText(tree)).toContain('10 Klimmzüge');
    expect(screenText(tree)).not.toContain('Zielzeiten');
    await tap(tree, 'Zurück');
    expect(screenText(tree)).toContain('Aktiv');
    expect(screenText(tree)).toContain('Alle Funktionen');
    await act(async () => {
      tree.unmount();
    });
  });
});

describe('Template management', () => {
  it('stores deleted import suggestions apart from templates and does not show them again after a restart', async () => {
    const workouts = parseStrongCsvPreview(
      'Date;Workout Name;Exercise Name;Set Order;Weight (kg);Reps\n2024-01-01 18:00:00;Push;Bench Press (Barbell);1;60;8\n2024-01-02 18:00:00;Pull;Deadlift (Barbell);1;80;6',
    ).workouts;
    const before = JSON.stringify(workouts);
    const previousNativeCall = jest.mocked(nativeCall).getMockImplementation();
    jest
      .mocked(nativeCall)
      .mockImplementation(
        async method =>
          (method === 'getStrengthImportCandidates'
            ? { workouts }
            : {}) as never,
      );
    const savedTemplate = createTemplate(100, 'Meine Vorlage', []);
    jest.mocked(native.strength).mockResolvedValue({
      ...emptyStrengthState(),
      templates: [savedTemplate],
    });
    jest.mocked(native.saveStrengthTemplates).mockClear();
    jest.mocked(native.saveSettings).mockClear();
    let tree = await render();
    try {
      await tap(tree, 'Einstellungen');
      await tap(tree, 'Vorlagen verwalten');
      await tap(tree, 'Push');
      await tap(tree, 'Vorschlag löschen');
      expect(native.saveSettings).not.toHaveBeenCalled();
      jest.mocked(native.saveSettings).mockRejectedValueOnce(new Error('db'));
      await tap(tree, 'Löschen bestätigen');
      expect(screenText(tree)).toContain(
        'Vorschlag konnte nicht gelöscht werden.',
      );
      expect(screenText(tree)).toContain('Push');
      await tap(tree, 'Löschen bestätigen');
      const settings = jest.mocked(native.saveSettings).mock.calls.at(-1)![0];
      expect(settings.dismissedStrengthImportTemplateIds).toEqual([
        'import-template:strong:push',
      ]);
      expect(settings.minutes).toBe(30);
      expect(native.saveStrengthTemplates).not.toHaveBeenCalled();
      expect(JSON.stringify(workouts)).toBe(before);
      expect(screenText(tree)).not.toContain('Push');
      expect(screenText(tree)).toContain('Pull');
      expect(screenText(tree)).toContain('Meine Vorlage');

      await act(async () => tree.unmount());
      jest.mocked(native.state).mockResolvedValueOnce({
        runs: [],
        recording: null,
        settings,
        capabilities: {},
      });
      tree = await render();
      await tap(tree, 'Einstellungen');
      await tap(tree, 'Vorlagen verwalten');
      expect(screenText(tree)).not.toContain('Push');
      expect(screenText(tree)).toContain('Pull');
      expect(screenText(tree)).toContain('Meine Vorlage');
    } finally {
      await act(async () => tree.unmount());
      jest.mocked(native.strength).mockResolvedValue(emptyStrengthState());
      jest.mocked(nativeCall).mockImplementation(previousNativeCall!);
    }
  });

  it('opens the existing management via settings and saves editing, duplicating and deleting', async () => {
    const template = addTemplateExercise(
      createTemplate(100, 'Oberkörper', []),
      catalogExercise('barbell_bench_press')!,
    );
    jest.mocked(native.strength).mockResolvedValueOnce({
      ...emptyStrengthState(),
      templates: [template],
    });
    jest.mocked(native.saveStrengthTemplates).mockClear();
    const tree = await render();
    try {
      await tap(tree, 'Einstellungen');
      await tap(tree, 'Vorlagen verwalten');
      expect(screenText(tree)).toContain('Vorlagen');
      expect(screenText(tree)).not.toContain('Laufvorlagen');
      expect(screenText(tree)).toContain('Oberkörper');
      expect(native.saveStrengthTemplates).not.toHaveBeenCalled();

      await tap(tree, 'Oberkörper bearbeiten');
      await act(async () => {
        tree.root
          .findAllByType(TextInput)
          .find(node => node.props.accessibilityLabel === 'Name des Plans')!
          .props.onChangeText('Push');
      });
      await tap(tree, 'Plan speichern');
      expect(
        jest.mocked(native.saveStrengthTemplates).mock.calls.at(-1)![0][0].name,
      ).toBe('Push');
      await tap(tree, 'Push duplizieren');
      const duplicated = jest
        .mocked(native.saveStrengthTemplates)
        .mock.calls.at(-1)![0];
      expect(duplicated).toHaveLength(2);
      expect(duplicated[0].id).toBe(template.id);
      expect(duplicated[1].id).not.toBe(template.id);
      const writes = jest.mocked(native.saveStrengthTemplates).mock.calls
        .length;
      await tap(tree, 'Push löschen');
      expect(native.saveStrengthTemplates).toHaveBeenCalledTimes(writes);
      await tap(tree, 'Löschen abbrechen');
      expect(native.saveStrengthTemplates).toHaveBeenCalledTimes(writes);
      await tap(tree, 'Push löschen');
      await tap(tree, 'Löschen von Push bestätigen');
      expect(
        jest.mocked(native.saveStrengthTemplates).mock.calls.at(-1)![0],
      ).toEqual([duplicated[1]]);
      await tap(tree, 'Zurück');
      expect(screenText(tree)).toContain('Geräte & Verbindungen');
      expect(screenText(tree)).toContain('Vorlagen verwalten');
      await tap(tree, 'Wochenplan');
      await tap(tree, 'Vorlagen');
      expect(screenText(tree)).toContain(duplicated[1].name);
      await tap(tree, 'Zurück');
      expect(screenText(tree)).toContain('Wochenplan');
      expect(screenText(tree)).toContain('Gilt jede Woche.');
    } finally {
      await act(async () => tree.unmount());
    }
  });

  it('no longer shows stored run templates and returns to settings via Android back', async () => {
    jest.mocked(native.state).mockResolvedValueOnce({
      runs: [],
      recording: null,
      capabilities: {},
      settings: {
        onboardedAt: 1,
        features: {
          areas: { running: true, strength: false },
          planning: { enabled: false },
        },
        presets: [
          {
            id: 'run-template',
            name: 'Feierabend',
            purpose: 'easy',
            minutes: 20,
            cues: false,
          },
        ],
      } as any,
    });
    const backSpy = jest.spyOn(BackHandler, 'addEventListener');
    const tree = await render();
    try {
      expect(tabLabels(tree)).not.toContain('Plan');
      await tap(tree, 'Einstellungen');
      await tap(tree, 'Vorlagen verwalten');
      // Stored run templates stay in the settings but are not offered anymore.
      expect(screenText(tree)).not.toContain('Feierabend');
      expect(screenText(tree)).toContain('Neuen Plan anlegen');
      const back = backSpy.mock.calls.at(-1)![1];
      await act(async () => {
        expect(back()).toBe(true);
      });
      expect(screenText(tree)).toContain('Vorlagen verwalten');
      expect(screenText(tree)).toContain('Geräte & Verbindungen');
    } finally {
      await act(async () => tree.unmount());
      backSpy.mockRestore();
    }
  });
});

describe('Settings list', () => {
  it('has calculations and the weekly plan, but no chat and no setup entry', async () => {
    const tree = await render();
    try {
      await tap(tree, 'Einstellungen');
      const text = screenText(tree);
      expect(text).toContain('Rechenweg');
      expect(text).toContain('Wochenplan');
      expect(text).not.toContain('Trainingschat');
      expect(text).not.toContain('Einrichtung erneut öffnen');
      await tap(tree, 'Rechenweg');
      expect(screenText(tree)).toContain('Wie Runback rechnet');
      expect(screenText(tree)).not.toContain('OpenRouter');
    } finally {
      await act(async () => tree.unmount());
    }
  });

  it('collects voice, running cues, and rest signals under Voice & vibration', async () => {
    const previous = jest.mocked(nativeCall).getMockImplementation();
    jest.mocked(nativeCall).mockImplementation(((method: string) =>
      Promise.resolve(
        method === 'getSpeechSettings'
          ? {
              available: true,
              voice: null,
              rate: 1,
              voices: [{ name: 'de-x-a' }, { name: 'de-x-b' }],
            }
          : {},
      )) as any);
    const tree = await render();
    try {
      await tap(tree, 'Einstellungen');
      await tap(tree, 'Stimme & Vibration');
      const text = screenText(tree);
      expect(text).toContain('Systemstimme');
      await tap(tree, 'Stimme für Ansagen');
      await act(async () => {
        tree.root
          .findAllByType(CheckRow)
          .find(row => row.props.title === 'Stimme 2')!
          .props.onToggle(true);
      });
      expect(nativeCall).toHaveBeenCalledWith('setSpeechSettings', 'de-x-b', 1);
      expect(nativeCall).toHaveBeenCalledWith('previewSpeech');
      expect(text).toContain('Ansagen beim Laufen');
      expect(text).toContain('Ansage am Pausenende');
      await act(async () => {
        tree.root
          .findAllByType(SwitchRow)
          .find(row => row.props.title === 'Ansage am Pausenende')!
          .props.onChange(true);
      });
      expect(
        jest.mocked(native.saveSettings).mock.calls.at(-1)![0],
      ).toMatchObject({
        features: expect.objectContaining({
          strength: expect.objectContaining({ restVoice: true }),
        }),
      });
      await act(async () => {
        tree.root
          .findAllByType(ChipGroup)
          .find(group => group.props.label === 'Sprechtempo')!
          .props.onChange('1.2');
      });
      expect(nativeCall).toHaveBeenCalledWith(
        'setSpeechSettings',
        'de-x-b',
        1.2,
      );
      await tap(tree, 'Ansagen beim Laufen');
      expect(screenText(tree)).toContain('Zwischenstände ansagen');
    } finally {
      await act(async () => tree.unmount());
      jest.mocked(nativeCall).mockImplementation(previous!);
    }
  });
});

describe('Progress announcements', () => {
  const startSheetOpen = (tree: TestRenderer.ReactTestRenderer) =>
    tree.root
      .findAllByType(Sheet)
      .some(
        sheet =>
          sheet.props.title === 'Was startest du?' && sheet.props.visible,
      );

  it('switches in the start sheet and returns there from the gear via back and save', async () => {
    const backSpy = jest.spyOn(BackHandler, 'addEventListener');
    const tree = await render();
    try {
      await tap(tree, 'Lauf starten');
      expect(screenText(tree)).toContain('Jeden Kilometer');
      jest.mocked(native.saveSettings).mockClear();
      await act(async () => {
        tree.root.findByType(SwitchRow).props.onChange(true);
      });
      expect(native.saveSettings).toHaveBeenLastCalledWith(
        expect.objectContaining({
          runAnnouncements: expect.objectContaining({ on: true }),
        }),
      );

      await tap(tree, 'Zwischenansagen einstellen');
      expect(startSheetOpen(tree)).toBe(false);
      expect(screenText(tree)).toContain('Ansagen beim Laufen');
      const back = backSpy.mock.calls.at(-1)![1];
      await act(async () => {
        expect(back()).toBe(true);
      });
      expect(startSheetOpen(tree)).toBe(true);

      await tap(tree, 'Zwischenansagen einstellen');
      await tap(tree, 'Speichern');
      expect(startSheetOpen(tree)).toBe(true);
      expect(screenText(tree)).not.toContain('Ansagen beim Laufen');
    } finally {
      await act(async () => tree.unmount());
      backSpy.mockRestore();
    }
  });
});

describe('Features', () => {
  const settingsSaved = () =>
    jest.mocked(native.saveSettings).mock.calls.at(-1)![0];
  const withFeatures = (features: unknown, extra: object = {}) =>
    jest.mocked(native.state).mockResolvedValueOnce({
      runs: [],
      recording: null,
      settings: { onboardedAt: 1, features, ...extra } as any,
      capabilities: {},
    });

  it('creates a custom challenge, logs from Today, undoes mistakes and retains data while the feature is hidden', async () => {
    withFeatures({ challenges: { enabled: true } });
    const tree = await render();
    try {
      await tap(tree, 'Challenges öffnen');
      await tap(tree, 'Challenge erstellen');
      await act(async () => {
        tree.root
          .findAllByType(TextInput)
          .find(input => input.props.accessibilityLabel === 'Challenge-Name')!
          .props.onChangeText('Liegestütze');
        tree.root
          .findAllByType(TextInput)
          .find(input => input.props.accessibilityLabel === 'Schnellbuttons')!
          .props.onChangeText('1, 5, 20');
      });
      await tap(tree, 'Challenge speichern');
      expect(settingsSaved().challenges?.items[0]).toMatchObject({
        name: 'Liegestütze',
        target: 100,
        steps: [1, 5, 20],
      });
      await tap(tree, 'Heute');
      await tap(tree, 'Liegestütze: 20 hinzufügen');
      expect(screenText(tree)).toContain('20 von 100');
      await tap(tree, 'Liegestütze: 5 hinzufügen');
      expect(screenText(tree)).toContain('25 von 100');
      await tap(tree, 'Letzte 5 zurücknehmen');
      expect(screenText(tree)).toContain('20 von 100');
      await tap(tree, 'Einstellungen');
      await tap(tree, 'Funktionen');
      await flip(tree, 'Challenges');
      expect(settingsSaved().challenges?.items[0].days[0].entries).toHaveLength(
        1,
      );
      await tap(tree, 'Heute');
      expect(screenText(tree)).not.toContain('Liegestütze');
      await tap(tree, 'Einstellungen');
      await tap(tree, 'Funktionen');
      await flip(tree, 'Challenges');
      await tap(tree, 'Heute');
      expect(screenText(tree)).toContain('20 von 100');
    } finally {
      await act(async () => tree.unmount());
    }
  });

  it('publishes challenge counts only after durable saves and keeps the previous count on failure', async () => {
    withFeatures(
      { challenges: { enabled: true } },
      {
        challenges: {
          version: 1,
          items: [
            {
              id: 'push',
              name: 'Liegestütze',
              target: 100,
              steps: [1, 5, 10],
              days: [],
              archived: false,
              showOnHome: true,
            },
          ],
        },
      },
    );
    const tree = await render();
    let complete!: () => void;
    jest.mocked(native.saveSettings).mockImplementationOnce(
      () =>
        new Promise<void>(resolve => {
          complete = resolve;
        }),
    );
    try {
      await tap(tree, 'Liegestütze: 10 hinzufügen');
      expect(screenText(tree)).toContain('0 von 100');
      expect(
        tree.root
          .findAllByType(Button)
          .filter(item => item.props.label === 'Liegestütze: 5 hinzufügen')
          .every(item => item.props.disabled),
      ).toBe(true);
      await act(async () => complete());
      expect(screenText(tree)).toContain('10 von 100');
      jest
        .mocked(native.saveSettings)
        .mockRejectedValueOnce(new Error('Speichern fehlgeschlagen'));
      await tap(tree, 'Liegestütze: 5 hinzufügen');
      expect(screenText(tree)).toContain('10 von 100');
      expect(screenText(tree)).toContain('Speichern fehlgeschlagen');
      await tap(tree, 'Liegestütze: 5 hinzufügen');
      expect(screenText(tree)).toContain('15 von 100');
    } finally {
      await act(async () => tree.unmount());
    }
  });

  it('asks about soreness only when the setting asks for it', async () => {
    // Default: after strength training. Without a strength session, no prompt.
    const quiet = await render();
    expect(screenText(quiet)).not.toContain('Überspringen');
    expect(screenText(quiet)).toContain('Muskelkater melden');
    await act(async () => {
      quiet.unmount();
    });

    withFeatures({ soreness: { prompt: 'daily' } });
    const daily = await render();
    expect(screenText(daily)).toContain('Überspringen');
    await tap(daily, 'Überspringen');
    await act(async () => {
      daily.unmount();
    });
  });

  it('removes the soreness row, prompt and body map when soreness is switched off', async () => {
    withFeatures({ soreness: { enabled: false, prompt: 'daily' } });
    const tree = await render();
    const text = screenText(tree);
    expect(text).not.toContain('Überspringen');
    expect(text).not.toContain('Muskelkater melden');
    await tap(tree, 'Verlauf');
    expect(screenText(tree)).not.toContain('Muskelkarte');
    await act(async () => {
      tree.unmount();
    });
  });

  it('removes all entry points for deselected strength training and plan', async () => {
    withFeatures({
      areas: { running: true, strength: false },
      planning: { enabled: false },
    });
    const tree = await render();
    const text = screenText(tree);
    expect(text).toContain('Lauf starten');
    expect(text).not.toContain('Krafttraining starten');
    expect(text).not.toContain('Diese Woche im Plan ansehen');
    expect(tabLabels(tree)).toEqual(['Heute', 'Statistik', 'Verlauf']);
    await act(async () => {
      tree.unmount();
    });
  });

  it('shows the strength start alone without running', async () => {
    withFeatures({ areas: { running: false, strength: true } });
    const tree = await render();
    const text = screenText(tree);
    expect(text).toContain('Krafttraining starten');
    expect(text).not.toContain('Lauf starten');
    await act(async () => {
      tree.unmount();
    });
  });

  it('switches features immediately and saves them in the settings', async () => {
    const tree = await render();
    await tap(tree, 'Einstellungen');
    await tapText(tree, 'Funktionen');
    expect(screenText(tree)).toContain('deine Daten bleiben');
    await flip(tree, 'Planung');
    expect(settingsSaved().features?.planning.enabled).toBe(false);
    expect(tabLabels(tree)).not.toContain('Plan');
    await flip(tree, 'Muskelkater');
    expect(settingsSaved().features?.soreness.enabled).toBe(false);
    // The last area cannot be deselected.
    await flip(tree, 'Krafttraining');
    expect(settingsSaved().features?.areas.strength).toBe(false);
    await flip(tree, 'Laufen');
    expect(settingsSaved().features?.areas.running).toBe(true);
    await tap(tree, 'Heute');
    const text = screenText(tree);
    expect(text).not.toContain('Diese Woche im Plan ansehen');
    expect(text).not.toContain('Muskelkater melden');
    expect(text).not.toContain('Krafttraining starten');
    await act(async () => {
      tree.unmount();
    });
  });

  it('fills free slots with statistics and templates and keeps features without a tab reachable', async () => {
    withFeatures({ planning: { enabled: false }, navigation: { tabs: [] } });
    const tree = await render();
    expect(tabLabels(tree)).toEqual(['Heute', 'Verlauf']);
    await tap(tree, 'Einstellungen');
    await tapText(tree, 'Funktionen');
    const switchSettings = async (value: 'main' | 'navigation') => {
      await act(async () =>
        tree.root.findByType(Segmented).props.onChange(value),
      );
    };
    await switchSettings('navigation');
    const choose = async (title: string, checked: boolean) => {
      await act(async () =>
        tree.root
          .findAllByType(CheckRow)
          .find(row => row.props.title === title)!
          .props.onToggle(checked),
      );
    };
    await choose('Statistik', true);
    await choose('Vorlagen', true);
    expect(tabLabels(tree)).toEqual([
      'Heute',
      'Statistik',
      'Vorlagen',
      'Verlauf',
    ]);
    await tap(tree, 'Heute');
    await tap(tree, 'Vorlagen');
    expect(screenText(tree)).toContain('Vorlagen');
    expect(
      tree.root.findAll(
        item => item.props?.accessibilityLabel === 'Alle Funktionen',
      ),
    ).toHaveLength(0);
    await tap(tree, 'Einstellungen');
    await tap(tree, 'Alle Funktionen');
    await tapText(tree, 'Muskelkater');
    expect(screenText(tree)).toContain('Muskelkater melden');
    expect(tabLabels(tree)).not.toContain('Muskelkater');
    await tap(tree, 'Einstellungen');
    await tap(tree, 'Alle Funktionen');
    await tapText(tree, 'Ziel je Bereich');
    expect(screenText(tree)).toContain('Noch kein Ziel festgelegt');
    await act(async () => tree.unmount());
  });

  it('replaces only the chosen slot and keeps the change after a restart', async () => {
    const tree = await render();
    await tap(tree, 'Einstellungen');
    await tapText(tree, 'Funktionen');
    await act(async () =>
      tree.root.findByType(Segmented).props.onChange('navigation'),
    );
    await act(async () =>
      tree.root
        .findAllByType(CheckRow)
        .find(row => row.props.title === 'Vorlagen')!
        .props.onToggle(true),
    );
    expect(tabLabels(tree)).toEqual(['Heute', 'Plan', 'Statistik', 'Verlauf']);
    await tapText(tree, 'Statistik ersetzen');
    expect(tabLabels(tree)).toEqual(['Heute', 'Plan', 'Vorlagen', 'Verlauf']);
    expect(settingsSaved().features?.statistics.enabled).toBe(true);
    const saved = settingsSaved();
    await act(async () => tree.unmount());
    withFeatures(saved.features);
    const restarted = await render();
    expect(tabLabels(restarted)).toEqual([
      'Heute',
      'Plan',
      'Vorlagen',
      'Verlauf',
    ]);
    await act(async () => restarted.unmount());
  });

  it('removes switched-off statistics and templates also from history and the training start', async () => {
    withFeatures({
      statistics: { enabled: false },
      templates: { enabled: false },
      recording: { routes: false },
      coach: { enabled: false },
      planning: { enabled: false },
      goals: { enabled: false },
      soreness: { enabled: false },
    });
    const tree = await render();
    await tap(tree, 'Verlauf');
    expect(screenText(tree)).not.toContain('Statistik');
    await tap(tree, 'Heute');
    await tap(tree, 'Krafttraining starten');
    expect(screenText(tree)).not.toContain('Vorlagen verwalten');
    await act(async () =>
      tree.root
        .findAllByType(Sheet)
        .find(sheet => sheet.props.visible)!
        .props.onClose(),
    );
    await tap(tree, 'Einstellungen');
    await tap(tree, 'Alle Funktionen');
    expect(screenText(tree)).toContain(
      'Keine optionale Funktion eingeschaltet',
    );
    await act(async () => tree.unmount());
  });

  it('offers existing users the features once on Today', async () => {
    const tree = await render();
    expect(screenText(tree)).toContain('Neu: Wähle, was Runback zeigt');
    await tapText(tree, 'Neu: Wähle, was Runback zeigt');
    expect(screenText(tree)).toContain('Funktionen');
    expect(settingsSaved().features?.version).toBe(FEATURES_VERSION);
    await tap(tree, 'Heute');
    expect(screenText(tree)).not.toContain('Neu: Wähle, was Runback zeigt');
    await act(async () => {
      tree.unmount();
    });
  });
});

describe('Run detail', () => {
  it('shows insights and colors the pace against the last runs', async () => {
    const base: RunSummary = {
      id: 'now',
      startTime: 60 * DAY,
      endTime: 60 * DAY + 1200_000,
      durationSeconds: 1200,
      distanceMeters: 4000,
      purpose: 'easy',
      source: 'phone',
      status: 'completed',
      avgHeartRate: 150,
      time: {
        model_version: 't',
        elapsedSeconds: 1200,
        pausedSeconds: 0,
        activeSeconds: 1200,
        movingSeconds: 1200,
        runningSeconds: 1100,
        walkingSeconds: 60,
        stoppedSeconds: 40,
        unknownSeconds: 0,
      },
      phaseMetrics: {
        model_version: 'p',
        longestRunMeters: 2500,
        longestRunSeconds: 750,
        runWalkTransitions: 2,
        trailingIdleSeconds: 0,
        running: { seconds: 1100, meters: 3900, avgHeartRate: 152 },
        walking: { seconds: 60, meters: 100, avgHeartRate: 120 },
        stopped: { seconds: 40, meters: 0 },
      },
      segments: [300, 300, 300, 300].map((durationSeconds, index) => ({
        id: String(index),
        durationSeconds,
        movingSeconds: durationSeconds,
        distanceMeters: 1000,
        avgHeartRate: 150,
        gradePercent: 0,
      })),
    };
    // Three slower earlier runs: today's pace is clearly better.
    const slower = [1, 2, 3].map(index => ({
      ...base,
      id: `prev-${index}`,
      startTime: base.startTime - index * 5 * DAY,
      endTime: base.startTime - index * 5 * DAY + 1320_000,
      durationSeconds: 1320,
      time: { ...base.time!, movingSeconds: 1320 },
    }));
    jest.mocked(native.state).mockResolvedValueOnce({
      runs: [base, ...slower],
      recording: null,
      settings: { onboardedAt: 1, minutes: 30 },
      capabilities: {},
    });
    jest.mocked(native.run).mockResolvedValue(base as never);
    const tree = await render();
    try {
      await tap(tree, 'Verlauf');
      await tapText(tree, 'Lockere Runde');
      const text = screenText(tree);
      expect(text).toContain('Bewegung');
      expect(text).toContain('2,50 km · 12:30 ohne Gehpause');
      expect(text).toContain('Im Vergleich zu dir');
      expect(text).toContain(
        'Gegenüber dem Median deiner letzten 3 gleichartigen Läufe.',
      );
      // The pace tile carries the comparison as arrow and text, not only as color.
      expect(
        tree.root.findAll(
          item =>
            typeof item.props?.accessibilityLabel === 'string' &&
            item.props.accessibilityLabel.endsWith(', besser als zuletzt'),
        ).length,
      ).toBeGreaterThan(0);
      expect(text).toContain('−30 s/km');
    } finally {
      await act(async () => {
        tree.unmount();
      });
    }
  });
});

describe('Export run reports together', () => {
  beforeEach(() => jest.clearAllMocks());
  let activeTree: TestRenderer.ReactTestRenderer | undefined;
  afterEach(async () => {
    await act(async () => activeTree?.unmount());
    activeTree = undefined;
  });
  const run = (id: string) => ({
    id,
    startTime: new Date(2026, 9, 1, 12).getTime(),
    endTime: new Date(2026, 9, 1, 12, 30).getTime(),
    durationSeconds: 1800,
    distanceMeters: 5000,
    purpose: 'easy' as const,
    source: 'test',
    status: 'complete',
  });
  const rows = (tree: TestRenderer.ReactTestRenderer) =>
    tree.root.findAll(
      node =>
        typeof node.props.accessibilityLabel === 'string' &&
        node.props.accessibilityLabel.startsWith('Lauf:') &&
        typeof node.props.onPress === 'function',
    );
  const setup = async () => {
    jest.mocked(native.state).mockResolvedValueOnce({
      runs: [run('first'), run('second'), { ...run('bike'), sport: 'cycling' }],
      recording: null,
      settings: { onboardedAt: 1 },
      capabilities: {},
    });
    jest.mocked(native.run).mockImplementation(async id => run(id));
    const tree = await render();
    activeTree = tree;
    await tap(tree, 'Verlauf');
    return tree;
  };

  it('selects by long press, toggles by tap, and exports the same report files', async () => {
    const tree = await setup();
    await act(async () => {
      rows(tree)[0].props.onLongPress();
    });
    expect(screenText(tree)).toContain('1 Lauf ausgewählt');
    expect(rows(tree)[0].props.accessibilityState.checked).toBe(true);
    await act(async () => {
      rows(tree)[1].props.onPress();
    });
    expect(screenText(tree)).toContain('2 Läufe ausgewählt');
    await act(async () => {
      rows(tree)[0].props.onPress();
    });
    await tap(tree, 'Auswahl als ZIP exportieren');
    expect(native.appendRunArchive).toHaveBeenCalledTimes(1);
    expect(native.appendRunArchive).toHaveBeenCalledWith('archive', 'second', {
      markdown: {
        fileName: expect.stringMatching(/\.md$/),
        content: expect.stringContaining('Runback'),
      },
      analysis: {
        fileName: expect.stringMatching(/_analysis\.json$/),
        content: expect.any(String),
      },
      timeseries: expect.stringMatching(/_timeseries\.csv$/),
    });
    const expectedInput = {
      run: run('second'),
      analysis: analyzeRun(run('second')),
      timeline: { rows: [], stepSeconds: 60 },
      context: { history: [run('first'), run('second')] },
    };
    const exported = jest.mocked(native.appendRunArchive).mock.calls[0][2];
    expect(exported.markdown.content).toBe(buildRunReport(expectedInput));
    expect(JSON.parse(exported.analysis.content)).toEqual(
      JSON.parse(
        JSON.stringify(
          buildRunAnalysisExport({
            ...expectedInput,
            now: Date.parse(JSON.parse(exported.analysis.content).exportedAt),
          }),
        ),
      ),
    );
    expect(native.shareRunArchive).toHaveBeenCalledWith('archive');
    expect(native.discardRunArchive).toHaveBeenCalledWith('archive');
    expect(screenText(tree)).not.toContain('ausgewählt');
    await act(async () => tree.unmount());
  });

  it('keeps selection and discards partial archives when an export fails', async () => {
    const tree = await setup();
    jest
      .mocked(native.appendRunArchive)
      .mockRejectedValueOnce(new Error('Speicher voll.'));
    await act(async () => {
      rows(tree)[0].props.onLongPress();
    });
    await tap(tree, 'Auswahl als ZIP exportieren');
    expect(screenText(tree)).toContain('Speicher voll.');
    expect(screenText(tree)).toContain('1 Lauf ausgewählt');
    expect(native.shareRunArchive).not.toHaveBeenCalled();
    expect(native.discardRunArchive).toHaveBeenCalledWith('archive');
    await tap(tree, 'Auswahl beenden');
    expect(rows(tree)[0].props.accessibilityRole).toBe('button');
    await act(async () => tree.unmount());
  });

  it('exports the inclusive date range from settings, including runs outside the loaded list', async () => {
    const tree = await setup();
    await tap(tree, 'Einstellungen');
    await tap(tree, 'Deine Daten');
    await tap(tree, 'Laufberichte exportieren');
    await pickPeriod(tree, new Date(2026, 9, 1), new Date(2026, 9, 2));
    jest
      .mocked(native.runIdsInRange)
      .mockResolvedValueOnce(['old-run', 'second']);
    await tap(tree, 'Läufe als ZIP exportieren');
    expect(native.runIdsInRange).toHaveBeenCalledWith(
      new Date(2026, 9, 1).getTime(),
      new Date(2026, 9, 3).getTime(),
    );
    expect(native.runExport).toHaveBeenCalledWith('archive', 'old-run');
    expect(native.appendRunArchive).toHaveBeenCalledTimes(2);
    expect(
      jest.mocked(native.appendRunArchive).mock.calls.map(call => call[1]),
    ).toEqual(['old-run', 'second']);
    await act(async () => tree.unmount());
  });

  it('stops and discards the archive when the next run fails while one is written', async () => {
    const tree = await setup();
    await tap(tree, 'Einstellungen');
    await tap(tree, 'Deine Daten');
    await tap(tree, 'Laufberichte exportieren');
    await pickPeriod(tree, new Date(2026, 9, 1), new Date(2026, 9, 1));
    jest
      .mocked(native.runIdsInRange)
      .mockResolvedValueOnce(['first', 'gone', 'second']);
    const load = jest.mocked(native.runExport).getMockImplementation()!;
    jest
      .mocked(native.runExport)
      .mockImplementation((archive, id) =>
        id === 'gone'
          ? Promise.reject(new Error('Lauf nicht gefunden'))
          : load(archive, id),
      );
    await tap(tree, 'Läufe als ZIP exportieren');
    expect(screenText(tree)).toContain('Lauf nicht gefunden');
    expect(
      jest.mocked(native.appendRunArchive).mock.calls.map(call => call[1]),
    ).toEqual(['first']);
    expect(native.runExport).not.toHaveBeenCalledWith('archive', 'second');
    expect(native.shareRunArchive).not.toHaveBeenCalled();
    expect(native.discardRunArchive).toHaveBeenCalledWith('archive');
    jest.mocked(native.runExport).mockImplementation(load);
    await act(async () => tree.unmount());
  });

  it('needs a period and says when it holds no run', async () => {
    const tree = await setup();
    await tap(tree, 'Einstellungen');
    await tap(tree, 'Deine Daten');
    await tap(tree, 'Laufberichte exportieren');
    const button = () =>
      tree.root.find(
        node =>
          node.props.title === 'Läufe als ZIP exportieren' &&
          typeof node.props.onPress === 'function',
      );
    expect(button().props.disabled).toBe(true);
    await pickPeriod(tree, new Date(2026, 9, 2), new Date(2026, 9, 1));
    expect(button().props.disabled).toBe(false);
    await tap(tree, 'Läufe als ZIP exportieren');
    expect(native.runIdsInRange).toHaveBeenCalledWith(
      new Date(2026, 9, 1).getTime(),
      new Date(2026, 9, 3).getTime(),
    );
    expect(screenText(tree)).toContain('Wähle mindestens einen Lauf');
    expect(native.beginRunArchive).not.toHaveBeenCalled();
    await act(async () => tree.unmount());
  });
});

describe('Export strength training', () => {
  beforeEach(() => jest.clearAllMocks());
  const session = (id: string, start: number) => ({
    id,
    kind: 'strength' as const,
    name: 'Oberkörper',
    startTime: start,
    endTime: start + 3600_000,
    status: 'finished' as const,
    currentExercise: 0,
    modelVersion: 'strength-v1',
    catalogVersion: 'catalog-v2',
    exercises: [
      {
        exerciseId: 'barbell_bench_press',
        name: 'Bankdrücken',
        sets: [
          {
            id: `${id}-1`,
            planned: {
              kind: 'normal' as const,
              loadKind: 'kg' as const,
              reps: 8,
              weightKg: 80,
            },
            actualReps: 8,
            actualWeightKg: 80,
            completedAt: start + 600_000,
          },
        ],
      },
    ],
  });
  const open = async () => {
    const tree = await render();
    await tap(tree, 'Einstellungen');
    await tap(tree, 'Deine Daten');
    await tap(tree, 'Krafttraining exportieren');
    return tree;
  };

  it('packs every recorded session into one ZIP with the readme first', async () => {
    const start = new Date(2026, 9, 1, 18).getTime();
    jest
      .mocked(native.recordedStrengthSessionIds)
      .mockResolvedValueOnce(['a', 'b']);
    jest
      .mocked(native.strengthSession)
      .mockImplementation(id =>
        Promise.resolve(session(id, id === 'a' ? start : start + DAY)),
      );
    const tree = await open();
    await tap(tree, 'Krafttraining als ZIP exportieren');
    expect(native.beginExportArchive).toHaveBeenCalledWith(
      'runback-krafttraining',
    );
    expect(native.recordedStrengthSessionIds).toHaveBeenCalledWith(undefined);
    expect(native.strengthExportBatch).toHaveBeenCalledWith(['a', 'b']);
    const calls = jest.mocked(native.appendExportArchive).mock.calls;
    expect(calls).toHaveLength(3);
    expect(Object.keys(calls[0][1])[0]).toBe('README.md');
    expect(calls[1][1]['sets.csv']).toMatch(/^a,[^]*\nb,/);
    expect(calls[2][1]['README.md']).toContain('2 Einheiten, 2 Sätze');
    expect(calls[2][1]['README.md']).toContain(
      'Bewegungsdaten der Uhr aus 1 Einheiten',
    );
    expect(native.shareExportArchive).toHaveBeenCalledWith(
      'export',
      'Krafttraining teilen',
      { includeMotion: true },
    );
    expect(native.discardExportArchive).toHaveBeenCalledWith('export');
    jest.mocked(native.strengthSession).mockReset();
    await act(async () => tree.unmount());
  });

  it('exports only the chosen period, with the motion data of the same sessions', async () => {
    const start = new Date(2026, 9, 1, 18).getTime();
    jest.mocked(native.recordedStrengthSessionIds).mockResolvedValueOnce(['a']);
    jest
      .mocked(native.strengthSession)
      .mockImplementation(id => Promise.resolve(session(id, start)));
    const tree = await open();
    await pickPeriod(tree, new Date(2026, 9, 1), new Date(2026, 9, 1));
    await tap(tree, 'Krafttraining als ZIP exportieren');
    expect(native.recordedStrengthSessionIds).toHaveBeenCalledWith({
      from: new Date(2026, 9, 1).getTime(),
      until: new Date(2026, 9, 2).getTime(),
    });
    const calls = jest.mocked(native.appendExportArchive).mock.calls;
    expect(calls.at(-1)?.[1]['README.md']).toContain(
      'Bewegungsdaten der Uhr, falls aufgezeichnet',
    );
    expect(native.shareExportArchive).toHaveBeenCalledWith(
      'export',
      'Krafttraining teilen',
      { includeMotion: true, motionIds: ['a'] },
    );
    jest.mocked(native.strengthSession).mockReset();
    await act(async () => tree.unmount());
  });

  it('says what is missing when nothing was recorded', async () => {
    const tree = await open();
    await tap(tree, 'Krafttraining als ZIP exportieren');
    expect(screenText(tree)).toContain('Zeichne zuerst eine Krafteinheit auf.');
    expect(native.beginExportArchive).not.toHaveBeenCalled();
    await act(async () => tree.unmount());
  });
});

describe('Adding run type later', () => {
  const run = (id: string, day: number, purpose: string) => ({
    id,
    startTime: new Date(2026, 9, day, 7).getTime(),
    endTime: new Date(2026, 9, day, 7, 40).getTime(),
    durationSeconds: 2400,
    distanceMeters: 7000,
    purpose: purpose as any,
    source: 'test',
    status: 'complete',
  });
  let activeTree: TestRenderer.ReactTestRenderer | undefined;
  afterEach(async () => {
    await act(async () => activeTree?.unmount());
    activeTree = undefined;
    jest.mocked(native.state).mockReset();
    jest.mocked(native.state).mockImplementation(() =>
      Promise.resolve({
        runs: [],
        recording: null,
        settings: { onboardedAt: 1, purpose: 'free', minutes: 30 },
        capabilities: {},
      } as any),
    );
  });

  it('asks run by run, moves on only after saving, and counts “Just run” as an answer', async () => {
    let runs = [run('neu', 2, 'unknown'), run('alt', 1, 'unknown')];
    jest.mocked(native.state).mockImplementation(() =>
      Promise.resolve({
        runs: runs.map(item => ({ ...item })),
        recording: null,
        settings: { onboardedAt: 1 },
        capabilities: {},
      } as any),
    );
    jest.mocked(native.feedback).mockImplementation(async (id, patch: any) => {
      runs = runs.map(item =>
        item.id === id ? { ...item, purpose: patch.purpose } : item,
      );
    });
    const tree = await render();
    activeTree = tree;
    await tap(tree, 'Verlauf');
    expect(screenText(tree)).toContain('Bei 2 Läufen fehlt die Laufart.');
    await tap(tree, 'Laufart nachtragen');
    expect(screenText(tree)).toContain('Noch 2 Läufe ohne Laufart');
    const chips = () =>
      tree.root
        .findAllByType(ChipGroup)
        .find(group => String(group.props.label).startsWith('Laufart von'))!;
    await act(async () => chips().props.onChange('free'));
    expect(native.feedback).toHaveBeenCalledWith('neu', {
      purpose: 'free',
      purposeConfirmed: true,
      purposeHint: null,
    });
    expect(screenText(tree)).toContain('Noch 1 Lauf ohne Laufart');
    await tap(tree, 'Überspringen');
    expect(screenText(tree)).toContain('1 Lauf bleibt ohne Laufart.');
  });

  it('hides the backlog while the running area is switched off', async () => {
    jest.mocked(native.state).mockImplementation(() =>
      Promise.resolve({
        runs: [run('neu', 2, 'unknown')],
        recording: null,
        settings: {
          onboardedAt: 1,
          features: { areas: { running: false, strength: true } },
        },
        capabilities: {},
      } as any),
    );
    const tree = await render();
    activeTree = tree;
    await tap(tree, 'Verlauf');
    expect(screenText(tree)).not.toContain('Laufart nachtragen');
  });

  it('stays on the run when saving fails', async () => {
    jest.mocked(native.state).mockImplementation(() =>
      Promise.resolve({
        runs: [run('neu', 2, 'unknown')],
        recording: null,
        settings: { onboardedAt: 1 },
        capabilities: {},
      } as any),
    );
    jest
      .mocked(native.feedback)
      .mockRejectedValueOnce(new Error('Speicher voll.'));
    const tree = await render();
    activeTree = tree;
    await tap(tree, 'Verlauf');
    await tap(tree, 'Laufart nachtragen');
    const chips = tree.root
      .findAllByType(ChipGroup)
      .find(group => String(group.props.label).startsWith('Laufart von'))!;
    await act(async () => chips.props.onChange('easy'));
    const text = screenText(tree);
    expect(text).toContain('Speicher voll.');
    expect(text).toContain('Noch 1 Lauf ohne Laufart');
  });
});

describe('Strength history after import', () => {
  it('updates history and statistics right after the import', async () => {
    const sessions = parseStrongCsvPreview(
      `Date;Workout Name;Exercise Name;Set Order;Weight (kg);Reps\n${
        Date.now() - DAY
      };Import Push;Bench Press (Barbell);1;80;8`,
    ).workouts.map(importedStrengthSession);
    const previousCall = jest.mocked(nativeCall).getMockImplementation();
    const previousSessions = jest
      .mocked(native.strengthSessions)
      .getMockImplementation();
    // First a preview; saved only with “accept”.
    jest.mocked(nativeCall).mockImplementation(
      async method =>
        (method === 'importFiles'
          ? {
              state: 'review',
              token: 'vorschau',
              files: ['strong.csv'],
              preview: {
                strength: {
                  workouts: [
                    {
                      id: 'strong:push',
                      time: Date.now() - DAY,
                      name: 'Import Push',
                      sets: 1,
                    },
                  ],
                },
              },
            }
          : {}) as never,
    );
    jest
      .mocked(native.strengthSessions)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(sessions);
    const tree = await render();
    try {
      await tap(tree, 'Einstellungen');
      await tap(tree, 'Deine Daten');
      await tap(tree, 'Dateien importieren');
      expect(native.commitImport).not.toHaveBeenCalled();
      await tap(tree, '1 Eintrag übernehmen');
      expect(native.commitImport).toHaveBeenCalledWith(
        'vorschau',
        expect.objectContaining({ strength: true, templateSuggestions: true }),
      );
      await tap(tree, 'Verlauf');
      expect(screenText(tree)).toContain('Import Push');
      await act(async () =>
        tree.root
          .findAllByType(Segmented)
          .find(item => item.props.label === 'Ansicht')!
          .props.onChange('stats'),
      );
      expect(screenText(tree)).toContain('Bankdrücken');
      expect(screenText(tree)).not.toContain('Noch keine Läufe');
    } finally {
      await act(async () => tree.unmount());
      jest.mocked(nativeCall).mockImplementation(previousCall!);
      jest
        .mocked(native.strengthSessions)
        .mockImplementation(previousSessions!);
    }
  });
});
