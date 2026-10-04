import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { Text } from 'react-native';

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

jest.mock('../src/native', () => {
  // Innerhalb der Factory, weil jest.mock vor die Importe gehoben wird.
  const { emptyStrengthState } = require('../src/domain/strength');
  const state = {
    runs: [],
    recording: null,
    settings: { onboardedAt: 1, purpose: 'free', minutes: 30 },
    capabilities: {},
  };
  return {
    nativeCall: jest.fn(() => Promise.resolve({})),
    native: {
      state: jest.fn(() => Promise.resolve(state)),
      beginRunArchive: jest.fn(() => Promise.resolve('archive')),
      appendRunArchive: jest.fn(() => Promise.resolve()),
      shareRunArchive: jest.fn(() => Promise.resolve()),
      discardRunArchive: jest.fn(() => Promise.resolve()),
      runIdsInRange: jest.fn(() => Promise.resolve([])),
      runTimeline: jest.fn(() =>
        Promise.resolve({ rows: [], stepSeconds: 60 }),
      ),
      run: jest.fn(() => Promise.resolve(null)),
      saveSettings: jest.fn(() => Promise.resolve()),
      feedback: jest.fn(() => Promise.resolve()),
      strength: jest.fn(() => Promise.resolve(emptyStrengthState())),
      strengthSessions: jest.fn(() => Promise.resolve([])),
      sorenessReports: jest.fn(() => Promise.resolve([])),
      saveStrengthSession: jest.fn(() => Promise.resolve()),
      finishStrengthSession: jest.fn(() =>
        Promise.resolve(emptyStrengthState()),
      ),
      strengthSession: jest.fn(() => Promise.resolve(null)),
    },
  };
});

import { RunbackApp } from '../src/ui/RunbackApp';
import { native } from '../src/native';
import { ChipGroup, Row } from '../src/ui/components';
import { acceptRecommendation, analyzeRun } from '../src/domain';
import {
  buildRunReport,
  buildRunAnalysisExport,
} from '../src/domain/runReport';
import type { RunSummary } from '../src/domain';

const DAY = 86400000;
/** Zwei vergleichbare Vorläufe: erst der Median mehrerer Läufe trägt eine Empfehlung. */
const previousRuns = (base: RunSummary): RunSummary[] =>
  [1, 2].map(index => ({
    ...base,
    id: `${base.id}-prev-${index}`,
    startTime: base.startTime - index * 7 * DAY,
    endTime: base.startTime - index * 7 * DAY + (base.endTime - base.startTime),
  }));

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

/** Schalter (Switch) tragen keinen Titel; sie hängen an der Zeile davor. */
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

/** Zeilen tragen ihren Namen als Text, nicht als `accessibilityLabel`. */
const tapText = async (
  tree: TestRenderer.ReactTestRenderer,
  label: string,
): Promise<void> => {
  const node = tree.root
    .findAll(item => typeof item.props?.onPress === 'function')
    .find(item => textContent(item).includes(label));
  if (!node) {
    throw new Error(`Kein antippbares Element mit „${label}“ gefunden.`);
  }
  await act(async () => {
    node.props.onPress();
  });
};

describe('Heute', () => {
  it('shows one start action without a date, a fake plan or settings', async () => {
    const tree = await render();
    const text = screenText(tree);

    expect(text).toContain('Lauf starten');
    // Das Gerät zeigt das Datum bereits an (Design Language § 6).
    expect(text).not.toMatch(/\d{1,2}\.\s|Montag|Dienstag|Mittwoch/);
    expect(text).not.toContain('Starte einfach');
    expect(text).not.toContain('Minuten eingeplant');
    // Kein Pfeil, der ein Aufklappen verspricht (Design Language § 8).
    expect(text).not.toContain('⌄');
    // Fokus, Ziel und Vorlagen haben ihren Ort im Coach und im Plan.
    expect(text).not.toContain('Dein Fokus');
    expect(text).not.toContain('Dein Ziel');
    expect(text).not.toContain('Laufvorlagen');
    // Der Zweck wird erst im Moment des Startens gewählt.
    expect(text).not.toContain('Zweck');
    await tap(tree, 'Lauf starten');
    expect(screenText(tree)).toContain('Zweck');
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

describe('Verlauf', () => {
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
      await tap(tree, 'Verlauf');
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
      ).toEqual(['Locker', 'Lang']);
      await pressRow('Locker');
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
    // Läufe, Radfahrten und Krafteinheiten teilen sich eine Liste; ohne
    // Einheiten gibt es nichts zu filtern.
    expect(text).toContain('Hier beginnt deine Historie');
    expect(text).not.toContain('Alle');
    // Importieren bleibt eine Einstellung, keine Zeile in der Historie.
    expect(text).not.toContain('Importieren');
    expect(text).not.toContain('Vorhandene Läufe importieren');
    await act(async () => {
      tree.unmount();
    });
  });
});

describe('Fokus', () => {
  it.each(['active', 'paused'] as const)(
    'shows a read-only follow-up when %s, including missing comparison data and real alternatives',
    async status => {
      const baseline = {
        id: 'deleted',
        startTime: 30 * DAY,
        endTime: 30 * DAY + 1320000,
        durationSeconds: 1320,
        distanceMeters: 2000,
        purpose: 'easy' as const,
        source: 'test',
        status: 'complete',
        segments: [300, 300, 360, 360].map((durationSeconds, index) => ({
          id: String(index),
          durationSeconds,
          distanceMeters: 500,
          gradePercent: 0,
        })),
      };
      const accepted = {
        ...acceptRecommendation(
          analyzeRun(baseline, undefined, previousRuns(baseline))
            .recommendation!,
          30 * DAY + 2000000,
        ),
        status,
      };
      const before = JSON.stringify(accepted);
      const later = {
        ...baseline,
        id: 'later',
        startTime: 60 * DAY,
        endTime: 60 * DAY + 1320000,
        purpose: 'long' as const,
      };
      jest.mocked(native.state).mockResolvedValueOnce({
        runs: [
          later,
          ...previousRuns(later),
          { ...later, id: 'incomplete', segments: [] },
        ],
        recording: null,
        settings: { onboardedAt: 1, minutes: 30, experiments: [accepted] },
        capabilities: {},
      });
      let tree!: TestRenderer.ReactTestRenderer;
      await act(async () => {
        tree = TestRenderer.create(<RunbackApp />);
      });
      try {
        // Heute zeigt die Empfehlung kompakt mit Zustand; der Coach trägt den Rest.
        expect(screenText(tree)).toContain(accepted.recommendation.action);
        expect(screenText(tree)).toContain(
          status === 'paused' ? 'Pausiert' : 'Aktiv',
        );
        expect(screenText(tree)).not.toContain('Danach vorgesehen');
        await tapText(tree, accepted.recommendation.action);
        expect(screenText(tree)).toContain('Danach vorgesehen');
        expect(screenText(tree)).not.toContain('Empfehlung annehmen');
        expect(screenText(tree)).not.toContain('Empfehlung abschließen');
        await tap(tree, 'Details');
        expect(screenText(tree)).toContain(
          'Vergleichslauf nicht mehr vorhanden',
        );
        expect(screenText(tree)).toContain('Auswahl für danach');
        expect(screenText(tree)).toContain(
          'fehlen mindestens vier geeignete Abschnitte',
        );
        expect(JSON.stringify(accepted)).toBe(before);
        await tap(tree, 'Empfehlung verwalten');
        await tap(tree, 'Empfehlung abschließen');
        expect(screenText(tree)).toContain('Vorschlag');
        expect(screenText(tree)).toContain('Empfehlung annehmen');
        expect(screenText(tree)).not.toContain('Danach vorgesehen');
        const saved = jest.mocked(native.saveSettings).mock.calls.at(-1)![0];
        expect(saved.experiments).toHaveLength(1);
        expect(saved.experiments![0].status).toBe('completed');
        expect(saved.experiments![0].recommendation).toEqual(
          accepted.recommendation,
        );
      } finally {
        await act(async () => {
          tree.unmount();
        });
      }
    },
  );
  it('keeps focus and recommendation independent through editing, removal, pause and completion', async () => {
    const baseline = {
      id: 'baseline',
      startTime: 30 * DAY,
      endTime: 30 * DAY + 1320000,
      durationSeconds: 1320,
      distanceMeters: 2000,
      purpose: 'easy' as const,
      source: 'test',
      status: 'complete',
      segments: [300, 300, 360, 360].map((durationSeconds, index) => ({
        id: String(index),
        distanceMeters: 500,
        durationSeconds,
        gradePercent: 0,
      })),
    };
    const accepted = acceptRecommendation(
      analyzeRun(baseline, undefined, previousRuns(baseline)).recommendation!,
      30 * DAY + 2000000,
    );
    const saved = JSON.stringify(accepted);
    jest.mocked(native.state).mockResolvedValueOnce({
      runs: [baseline, ...previousRuns(baseline)],
      recording: null,
      settings: {
        onboardedAt: 1,
        minutes: 30,
        goal: 'Halbmarathon im April',
        experiments: [accepted],
      },
      capabilities: {},
    });
    let tree!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      tree = TestRenderer.create(<RunbackApp />);
    });
    try {
      await tap(tree, 'Coach');
      await tapText(tree, 'Noch kein Fokus');
      await act(async () => {
        tree.root.findByType(ChipGroup).props.onChange('injury_free');
      });
      await tap(tree, 'Fokus speichern');
      const settings = jest.mocked(native.saveSettings).mock.calls.at(-1)![0];
      expect(settings.trainingFocus?.kind).toBe('injury_free');
      expect(JSON.stringify(settings.experiments![0])).toBe(saved);
      await tap(tree, 'Fokus entfernen');
      expect(
        jest.mocked(native.saveSettings).mock.calls.at(-1)![0].trainingFocus,
      ).toBeNull();
      expect(
        JSON.stringify(
          jest.mocked(native.saveSettings).mock.calls.at(-1)![0]
            .experiments![0],
        ),
      ).toBe(saved);
      await act(async () => {
        tree.root.findByType(ChipGroup).props.onChange('habit');
      });
      await tap(tree, 'Fokus speichern');
      const focus = jest.mocked(native.saveSettings).mock.calls.at(-1)![0]
        .trainingFocus;
      await tap(tree, 'Zurück');
      await tapText(tree, 'Halbmarathon im April');
      await tap(tree, 'Ziel entfernen');
      expect(
        jest.mocked(native.saveSettings).mock.calls.at(-1)![0].trainingFocus,
      ).toEqual(focus);
      expect(
        JSON.stringify(
          jest.mocked(native.saveSettings).mock.calls.at(-1)![0]
            .experiments![0],
        ),
      ).toBe(saved);
      await tap(tree, 'Heute');
      await tapText(tree, accepted.recommendation.action);
      await tap(tree, 'Empfehlung verwalten');
      await tap(tree, 'Empfehlung pausieren');
      expect(screenText(tree)).toContain('Pausiert');
      expect(screenText(tree)).not.toContain('Probiere die Empfehlung aus.');
      expect(
        jest.mocked(native.saveSettings).mock.calls.at(-1)![0].trainingFocus,
      ).toEqual(focus);
      await tap(tree, 'Empfehlung fortsetzen');
      await tap(tree, 'Empfehlung abschließen');
      const completed = jest.mocked(native.saveSettings).mock.calls.at(-1)![0];
      expect(completed.trainingFocus).toEqual(focus);
      expect(completed.experiments![0].status).toBe('completed');
      expect(completed.experiments![0].recommendation).toEqual(
        accepted.recommendation,
      );
      expect(screenText(tree)).toContain('Abgeschlossen');
      expect(screenText(tree)).not.toContain('Empfehlung annehmen');
      expect(screenText(tree)).not.toMatch(
        /Arbeitsthema|nächste Handlung|Intervention|Laufempfehlung|Baseline|inconclusive|Prüfbedingung/,
      );
    } finally {
      await act(async () => {
        tree.unmount();
      });
    }
  });
  it('is reachable from Coach and replaces the old wording', async () => {
    const tree = await render();
    // Der Fokus ist die Grundlage der Empfehlung und steht im Coach.
    expect(screenText(tree)).not.toContain('Noch kein Fokus');
    await tap(tree, 'Coach');
    expect(screenText(tree)).toContain('Noch kein Fokus');
    await tapText(tree, 'Noch kein Fokus');
    const text = screenText(tree);

    expect(text).toContain('Fokus-Art');
    expect(text).toContain('Eigene Bezeichnung');
    expect(text).not.toContain('Ergebnis bisher');
    expect(text).not.toContain('Empfehlung abschließen');
    expect(text).not.toContain('Eine Änderung. Eine nachvollziehbare Prüfung.');
    await act(async () => {
      tree.unmount();
    });
  });
});

describe('Funktionen', () => {
  const settingsSaved = () =>
    jest.mocked(native.saveSettings).mock.calls.at(-1)![0];
  const withFeatures = (features: unknown, extra: object = {}) =>
    jest.mocked(native.state).mockResolvedValueOnce({
      runs: [],
      recording: null,
      settings: { onboardedAt: 1, features, ...extra } as any,
      capabilities: {},
    });

  it('fragt nur nach Muskelkater, wenn die Einstellung es will', async () => {
    // Standard: nach Krafttraining. Ohne Krafteinheit keine Abfrage.
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

  it('nimmt abgeschaltetem Muskelkater Zeile, Abfrage und Muskelkarte', async () => {
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

  it('nimmt abgewähltem Krafttraining und abgewähltem Plan alle Einstiege', async () => {
    withFeatures({
      areas: { running: true, strength: false },
      planning: { enabled: false },
    });
    const tree = await render();
    const text = screenText(tree);
    expect(text).toContain('Lauf starten');
    expect(text).not.toContain('Krafttraining starten');
    expect(text).not.toContain('Diese Woche im Plan ansehen');
    expect(tabLabels(tree)).toEqual(['Heute', 'Verlauf', 'Coach']);
    await tap(tree, 'Coach');
    // Ohne Kraft kein Bereichswechsel und ohne Schlüssel kein Chat.
    expect(screenText(tree)).not.toContain('Trainingschat');
    expect(
      tree.root.findAll(item => item.props?.accessibilityLabel === 'Bereich'),
    ).toHaveLength(0);
    await act(async () => {
      tree.unmount();
    });
  });

  it('zeigt ohne Laufen den Kraft-Coach und den Kraftstart allein', async () => {
    withFeatures({ areas: { running: false, strength: true } });
    const tree = await render();
    const text = screenText(tree);
    expect(text).toContain('Krafttraining starten');
    expect(text).not.toContain('Lauf starten');
    await tap(tree, 'Coach');
    expect(screenText(tree)).toContain('Erstes Training starten');
    expect(screenText(tree)).not.toContain('aufgezeichneter Lauf');
    await act(async () => {
      tree.unmount();
    });
  });

  it('schaltet Funktionen sofort und speichert sie in den Einstellungen', async () => {
    const tree = await render();
    await tap(tree, 'Einstellungen');
    await tapText(tree, 'Funktionen');
    expect(screenText(tree)).toContain('deine Daten bleiben');
    await flip(tree, 'Planung als Tab');
    expect(settingsSaved().features?.planning.enabled).toBe(false);
    expect(tabLabels(tree)).not.toContain('Plan');
    await flip(tree, 'Muskelkater melden');
    expect(settingsSaved().features?.soreness.enabled).toBe(false);
    // Der letzte Bereich lässt sich nicht abwählen.
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

  it('zeigt Empfehlungen auf Nachfrage nur im Coach', async () => {
    const baseline = {
      id: 'base',
      startTime: 30 * DAY,
      endTime: 30 * DAY + 1320000,
      durationSeconds: 1320,
      distanceMeters: 2000,
      purpose: 'easy' as const,
      source: 'test',
      status: 'complete',
      segments: [300, 300, 360, 360].map((durationSeconds, index) => ({
        id: String(index),
        durationSeconds,
        distanceMeters: 500,
        gradePercent: 0,
      })),
    };
    jest.mocked(native.state).mockResolvedValueOnce({
      runs: [baseline, ...previousRuns(baseline)],
      recording: null,
      settings: {
        onboardedAt: 1,
        features: { recommendations: { running: 'on_request' } },
      } as any,
      capabilities: {},
    });
    const tree = await render();
    expect(screenText(tree)).not.toContain('Vorschlag');
    await tap(tree, 'Coach');
    expect(screenText(tree)).toContain('Empfehlung annehmen');
    await act(async () => {
      tree.unmount();
    });
  });

  it('bietet bestehenden Nutzern die Funktionen einmalig auf Heute an', async () => {
    const tree = await render();
    expect(screenText(tree)).toContain('Neu: Wähle, was Runback zeigt');
    await tapText(tree, 'Neu: Wähle, was Runback zeigt');
    expect(screenText(tree)).toContain('Funktionen');
    expect(settingsSaved().features?.version).toBe(1);
    await tap(tree, 'Heute');
    expect(screenText(tree)).not.toContain('Neu: Wähle, was Runback zeigt');
    await act(async () => {
      tree.unmount();
    });
  });
});

describe('Lauf-Detail', () => {
  it('zeigt Einblicke und färbt das Tempo gegenüber den letzten Läufen', async () => {
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
    // Drei langsamere Vorläufe: das heutige Tempo ist deutlich besser.
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
      await tapText(tree, 'Locker');
      const text = screenText(tree);
      expect(text).toContain('Bewegung');
      expect(text).toContain('2,50 km · 12:30 ohne Gehpause');
      expect(text).toContain('Im Vergleich zu dir');
      expect(text).toContain(
        'Gegenüber dem Median deiner letzten 3 gleichartigen Läufe.',
      );
      // Die Tempo-Kachel trägt den Vergleich als Pfeil und Text, nicht nur als Farbe.
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

describe('Laufberichte gesammelt exportieren', () => {
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
      analysis: analyzeRun(run('second'), undefined, [
        run('first'),
        run('second'),
      ]),
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
    const input = (label: string) =>
      tree.root.findAll(
        node =>
          node.props.accessibilityLabel === label &&
          typeof node.props.onChangeText === 'function',
      )[0];
    await act(async () => {
      input('Von (TT.MM.JJJJ)').props.onChangeText('01.10.2026');
      input('Bis (TT.MM.JJJJ)').props.onChangeText('02.10.2026');
    });
    jest
      .mocked(native.runIdsInRange)
      .mockResolvedValueOnce(['old-run', 'second']);
    await tap(tree, 'Läufe als ZIP exportieren');
    expect(native.runIdsInRange).toHaveBeenCalledWith(
      new Date(2026, 9, 1).getTime(),
      new Date(2026, 9, 3).getTime(),
    );
    expect(native.run).toHaveBeenCalledWith('old-run');
    expect(native.appendRunArchive).toHaveBeenCalledTimes(2);
    await act(async () => tree.unmount());
  });

  it('rejects invalid and empty ranges before creating an archive', async () => {
    const tree = await setup();
    await tap(tree, 'Einstellungen');
    await tap(tree, 'Deine Daten');
    await tap(tree, 'Laufberichte exportieren');
    const input = (label: string) =>
      tree.root.findAll(
        node =>
          node.props.accessibilityLabel === label &&
          typeof node.props.onChangeText === 'function',
      )[0];
    await act(async () => {
      input('Von (TT.MM.JJJJ)').props.onChangeText('31.02.2026');
      input('Bis (TT.MM.JJJJ)').props.onChangeText('02.10.2026');
    });
    await tap(tree, 'Läufe als ZIP exportieren');
    expect(native.runIdsInRange).not.toHaveBeenCalled();
    expect(native.beginRunArchive).not.toHaveBeenCalled();
    await act(async () =>
      input('Von (TT.MM.JJJJ)').props.onChangeText('01.10.2026'),
    );
    await tap(tree, 'Läufe als ZIP exportieren');
    expect(screenText(tree)).toContain('Wähle mindestens einen Lauf');
    expect(native.beginRunArchive).not.toHaveBeenCalled();
    await act(async () => tree.unmount());
  });
});

describe('Zweck nachtragen', () => {
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
    jest
      .mocked(native.state)
      .mockImplementation(() =>
        Promise.resolve({
          runs: [],
          recording: null,
          settings: { onboardedAt: 1, purpose: 'free', minutes: 30 },
          capabilities: {},
        } as any),
      );
  });

  it('fragt Lauf für Lauf, geht erst nach dem Speichern weiter und zählt „Frei“ als Antwort', async () => {
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
    await tap(tree, 'Coach');
    expect(screenText(tree)).toContain('Bei 2 Läufen fehlt der Zweck.');
    await tap(tree, 'Zweck nachtragen');
    expect(screenText(tree)).toContain('Noch 2 Läufe ohne Zweck');
    const chips = () =>
      tree.root
        .findAllByType(ChipGroup)
        .find(group => String(group.props.label).startsWith('Zweck von'))!;
    await act(async () => chips().props.onChange('free'));
    expect(native.feedback).toHaveBeenCalledWith('neu', { purpose: 'free' });
    expect(screenText(tree)).toContain('Noch 1 Lauf ohne Zweck');
    await tap(tree, 'Überspringen');
    expect(screenText(tree)).toContain('1 Lauf bleibt ohne Zweck.');
  });

  it('bleibt beim Lauf, wenn das Speichern scheitert', async () => {
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
    await tap(tree, 'Coach');
    await tap(tree, 'Zweck nachtragen');
    const chips = tree.root
      .findAllByType(ChipGroup)
      .find(group => String(group.props.label).startsWith('Zweck von'))!;
    await act(async () => chips.props.onChange('easy'));
    const text = screenText(tree);
    expect(text).toContain('Speicher voll.');
    expect(text).toContain('Noch 1 Lauf ohne Zweck');
  });
});
