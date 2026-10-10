import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { Alert, AppState as AndroidAppState, Text } from 'react-native';

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock('../src/native', () => {
  const { normalizeRun } = jest.requireActual('../src/native');
  return {
    nativeCall: jest.fn(async () => ({})),
    normalizeRun,
    native: {
      serverStatus: jest.fn(() => Promise.resolve({ state: 'off', url: null, scope: { runs: true, strength: true, coach: true, gps: false, health: false } })),
      state: jest.fn(),
      run: jest.fn(),
      saveSettings: jest.fn(),
      feedback: jest.fn(async () => undefined),
      strength: jest.fn(async () => ({
        templates: [],
        active: null,
        history: [],
      })),
      strengthSessions: jest.fn(async () => []),
      sorenessReports: jest.fn(async () => [
        { id: 'today', at: Date.now(), entries: [] },
      ]),
      setDisplayNames: jest.fn(() => Promise.resolve()),
      saveStrengthSession: jest.fn(async () => ({})),
    },
  };
});

import {
  native,
  nativeCall,
  normalizeRun,
  type AppState,
  type Run,
} from '../src/native';
import { RunbackApp } from '../src/ui/RunbackApp';
import { DistanceTimes } from '../src/ui/DistanceTimes';
import { RunTargetScreen } from '../src/ui/RunTargetScreen';
import { ChipGroup } from '../src/ui/components';
import {
  localDateKey,
  normalizeSchedule,
  type ScheduledSession,
} from '../src/domain/schedule';

let stored: AppState;
let tree: TestRenderer.ReactTestRenderer;
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
const textContent = (node: TestRenderer.ReactTestInstance): string =>
  node.children
    .map(child =>
      typeof child === 'string' || typeof child === 'number'
        ? String(child)
        : textContent(child),
    )
    .join('');
const screenText = () =>
  tree.root.findAllByType(Text).map(textContent).join(' ');
const pressables = () =>
  tree.root.findAll(node => typeof node.props.onPress === 'function');
const findPressable = (label: string) =>
  pressables().find(
    node =>
      node.props.accessibilityLabel === label ||
      node.props.title === label ||
      (node.props.accessibilityRole === 'tab' &&
        textContent(node).includes(label)),
  );
async function tap(label: string) {
  const node = findPressable(label);
  if (!node) {
    throw new Error(`Kein antippbares Element „${label}“.`);
  }
  await act(async () => {
    node.props.onPress();
  });
}
async function tapText(label: string) {
  const node = pressables().find(item => textContent(item).includes(label));
  if (!node) throw new Error(`Kein antippbarer Text „${label}“.`);
  await act(async () => {
    node.props.onPress();
  });
}
async function mount() {
  await act(async () => {
    tree = TestRenderer.create(<RunbackApp />);
  });
  await act(async () => {
    await Promise.resolve();
  });
}

const HOUR = 3600 * 1000;
const finished = (overrides: Partial<Run>): Run => ({
  id: 'run',
  startTime: Date.now() - 2 * HOUR,
  endTime: Date.now() - HOUR,
  durationSeconds: 3600,
  distanceMeters: 10000,
  purpose: 'free',
  source: 'phone',
  status: 'completed',
  ...overrides,
});
const plannedRun = (): ScheduledSession => ({
  id: 'planned-run',
  title: 'Locker 30',
  date: localDateKey(),
  kind: 'run',
  minutes: 30,
  purpose: 'easy',
  locked: false,
  status: 'planned',
  effort: 'easy',
});

beforeEach(() => {
  jest.clearAllMocks();
  (AndroidAppState.addEventListener as jest.Mock).mockImplementation(() => ({
    remove: jest.fn(),
  }));
  stored = {
    runs: [],
    recording: null,
    capabilities: {},
    settings: { onboardedAt: 1, purpose: 'free', minutes: 30 },
  };
  (native.state as jest.Mock).mockImplementation(async () => clone(stored));
  (native.run as jest.Mock).mockImplementation(async (id: string) =>
    clone(stored.runs.find(run => run.id === id)!),
  );
  (native.saveSettings as jest.Mock).mockImplementation(async settings => {
    stored.settings = clone(settings);
  });
  (nativeCall as jest.Mock).mockImplementation(
    async (method: string, ...args: unknown[]) => {
      if (method === 'requestRecordingPermissions') {
        return { locationPermission: true };
      }
      if (method === 'startRun') {
        stored.recording = {
          id: 'recorded',
          startTime: Date.now(),
          endTime: 0,
          status: 'recording',
          purpose: args[0] as Run['purpose'],
          sport: args[1] as Run['sport'],
          durationSeconds: 0,
          distanceMeters: 0,
          source: 'phone',
        };
        return { recording: clone(stored.recording) };
      }
      return {};
    },
  );
});
afterEach(async () => {
  if (tree) {
    await act(async () => tree.unmount());
  }
});

describe('Free recording on Today', () => {
  it('keeps the start card to one button and asks sport and goal in the sheet', async () => {
    await mount();
    const home = screenText();
    // The start page asks for no decision: no chip, no plan.
    expect(home).not.toContain('Sportart');
    expect(home).not.toContain('Zweck');
    expect(findPressable('Lauf starten')).toBeTruthy();
    expect(findPressable('Aufzeichnung starten')).toBeUndefined();

    await tap('Lauf starten');
    const sheet = screenText();
    expect(sheet).toContain('Laufen');
    expect(sheet).toContain('Radfahren');
    expect(sheet).toContain('Krafttraining');
    // How far and what to run by; the run type is asked after the run.
    expect(sheet).toContain('Wie weit');
    expect(sheet).toContain('Wonach');
    expect(sheet).not.toContain('Wie willst du laufen?');
    expect(sheet).not.toContain('Laufvorlage');

    await tap('Radfahren');
    expect(stored.settings.sport).toBe('cycling');
    expect(screenText()).not.toContain('Wie weit');

    await tap('Aufzeichnung starten');
    expect(nativeCall).toHaveBeenCalledWith(
      'startRun',
      'unknown',
      'cycling',
      '{"kind":"none","version":3}',
    );
    const live = screenText();
    expect(live).toContain('Radfahrt läuft');
    expect(live).toContain('Fahrzeit');
    expect(live).toContain('Ø km/h');
    expect(live).not.toContain('min / km');
    expect(findPressable('Radfahrt beenden')).toBeTruthy();
  });

  it('puts the planned run first and keeps a free recording one tap away', async () => {
    stored.settings.schedule = {
      ...normalizeSchedule(),
      sessions: [plannedRun()],
    };
    await mount();
    expect(screenText()).toContain('Locker 30');
    expect(findPressable('Lauf starten')).toBeTruthy();
    expect(findPressable('Stattdessen etwas anderes starten')).toBeTruthy();
    expect(screenText()).not.toContain('Radfahren');

    await tap('Stattdessen etwas anderes starten');
    expect(screenText()).toContain('Radfahren');
    expect(findPressable('Aufzeichnung starten')).toBeTruthy();

    await tap('Aufzeichnung starten');
    expect(nativeCall).toHaveBeenCalledWith(
      'startRun',
      'unknown',
      'running',
      '{"kind":"none","version":3}',
    );
    // A free recording is not linked to the appointment.
    expect(stored.settings.schedule?.sessions[0].activityId).toBeUndefined();
  });

  it('sets how far and what to run by with chips and keeps the last choice', async () => {
    await mount();
    expect(screenText()).not.toContain('Wie weit');

    await tap('Lauf starten');
    expect(screenText()).toContain('Nur tracken');
    expect(screenText()).not.toContain('Minuten pro Kilometer');

    await tap('Strecke');
    await tap('Tempo');
    expect(stored.settings.runTarget).toMatchObject({
      kind: 'pace',
      version: 3,
      secondsPerKm: 330,
      mode: 'range',
      goal: { kind: 'distance', meters: 5000 },
    });
    expect(screenText()).toContain('5 km · 5:30 /km');

    // The values open on their own page and come back to the sheet.
    await tapText('Tippe, um Werte zu ändern');
    expect(screenText()).toContain('Laufziel');
    expect(findPressable('Aufzeichnung starten')).toBeUndefined();
    expect(screenText()).toContain('Oder Zielzeit');
    await tap('Ziel übernehmen');
    expect(findPressable('Aufzeichnung starten')).toBeTruthy();

    await tap('Aufzeichnung starten');
    expect(nativeCall).toHaveBeenCalledWith(
      'startRun',
      'unknown',
      'running',
      expect.stringContaining('"goal":{"kind":"distance","meters":5000}'),
    );
    // The values are remembered per kind for the next switch of chips.
    expect(stored.settings.runTargetMemory).toMatchObject({
      goalMeters: 5000,
      pace: { secondsPerKm: 330, mode: 'range' },
    });
  });

  it('shows what is left of the goal during the run', async () => {
    stored.recording = {
      id: 'live',
      startTime: Date.now() - 900_000,
      endTime: 0,
      status: 'recording',
      purpose: 'unknown',
      sport: 'running',
      durationSeconds: 900,
      distanceMeters: 3170,
      source: 'phone',
      target: {
        kind: 'pace',
        version: 3,
        secondsPerKm: 300,
        mode: 'range',
        output: 'both',
        goal: { kind: 'distance', meters: 5000 },
      },
    } as Run;
    await mount();
    const text = screenText();
    expect(text).toContain('Noch 1,83 km');
    expect(text).toContain('5 km · 5:00 /km');
    expect(text).not.toContain('Noch offen');
  });
});

describe('Rides in sessions and detail', () => {
  beforeEach(() => {
    stored.runs = [
      finished({ id: 'ride', sport: 'cycling', distanceMeters: 30000 }),
      finished({
        id: 'run',
        startTime: Date.now() - 26 * HOUR,
        endTime: Date.now() - 25 * HOUR,
      }),
    ];
  });

  it('lists rides with their own label and speed, filtered separately', async () => {
    await mount();
    await tap('Verlauf');
    let text = screenText();
    expect(text).toContain('Radfahrt');
    expect(text).toContain('30,0 km/h');
    expect(text).toContain('1 Lauf · 1 Radfahrt');
    // The week header counts only running kilometers: 10, not 10 + 30.
    expect(text).toContain('Diese Woche');
    expect(text).toContain('10,0 km');
    expect(text).not.toContain('40,0');

    await tap('Radfahren');
    text = screenText();
    expect(text).toContain('1 Radfahrt');
    expect(text).not.toContain('1 Lauf ');

    await tap('Laufen');
    text = screenText();
    expect(text).toContain('1 Lauf');
    expect(text).not.toContain('km/h');
  });

  it('shows a ride without the running analysis but with a correctable sport', async () => {
    await mount();
    await tap('Verlauf');
    const row = pressables().find(node =>
      (node.props.accessibilityLabel || '').startsWith('Radfahrt:'),
    );
    expect(row).toBeTruthy();
    await act(async () => {
      row!.props.onPress();
    });
    const text = screenText();
    expect(text).toContain('Fahrzeit');
    expect(text).toContain('Ø km/h');
    expect(text).toContain('Fahrgefühl');
    expect(text).not.toContain('Nächster Schritt');
    expect(text).not.toContain('Tempoindex');
    // Changing sport and run type is an exception and sits collapsed at the bottom.
    expect(findPressable('Laufen')).toBeUndefined();

    await tap('Bearbeiten & verwalten');
    expect(screenText()).toContain('Sportart');
    await tap('Laufen');
    expect(native.feedback).toHaveBeenCalledWith('ride', { sport: 'running' });
  });
});

describe('Recording features', () => {
  const live = (): Run => ({
    id: 'live',
    startTime: Date.now() - 600_000,
    endTime: 0,
    status: 'recording',
    purpose: 'free',
    sport: 'running',
    durationSeconds: 600,
    distanceMeters: 2000,
    source: 'phone',
  });

  it('hides cycling, strength training and “Run after” when they are deselected', async () => {
    stored.settings.features = {
      areas: { running: true, strength: false },
      sports: { cycling: false },
      recording: { targets: false },
    } as any;
    await mount();
    expect(screenText()).not.toContain('Krafttraining starten');
    await tap('Lauf starten');
    const sheet = screenText();
    expect(sheet).not.toContain('Radfahren');
    expect(sheet).not.toContain('Art der Einheit');
    expect(sheet).not.toContain('Wie weit');
    expect(sheet).not.toContain('Wonach');
    expect(sheet).toContain('Aufzeichnung starten');
  });

  it('shows only the chosen metrics during recording', async () => {
    stored.settings.features = {
      recording: { metrics: ['heartRate'], primary: 'distance' },
    } as any;
    stored.recording = live();
    await mount();
    const text = screenText();
    expect(text).toContain('Kilometer');
    expect(text).toContain('Herzfrequenz');
    expect(text).not.toContain('Ø min / km');
  });

  it('shows whether the watch is recording the run', async () => {
    stored.recording = live();
    let wear: unknown = {
      status: 'connected',
      connected: true,
      lastCommand: { status: 'sent', runId: 'live', updatedAt: Date.now() },
    };
    (nativeCall as jest.Mock).mockImplementation(async (method: string) =>
      method === 'getWearStatus' ? wear : {},
    );
    await mount();
    expect(screenText()).toContain('Wartet');
    expect(screenText()).toContain('Öffne Runback auf der Uhr.');
    await act(async () => tree.unmount());
    wear = {
      status: 'connected',
      connected: true,
      lastCommand: { status: 'live', runId: 'live', lastLiveAt: Date.now() },
    };
    await mount();
    expect(screenText()).toContain('Zeichnet mit');
    await act(async () => tree.unmount());
    wear = { status: 'disconnected', connected: false, lastCommand: null };
    await mount();
    expect(screenText()).toContain('Das Telefon zeichnet allein auf.');
  });

  it('adjusts the target pace during the run in 5-second steps', async () => {
    stored.recording = {
      ...live(),
      target: {
        kind: 'pace',
        version: 2,
        secondsPerKm: 330,
        mode: 'range',
        output: 'both',
      },
    };
    (nativeCall as jest.Mock).mockImplementation(
      async (method: string, ...args: unknown[]) => {
        if (method === 'setRunTargetPace') {
          stored.recording = {
            ...stored.recording!,
            target: {
              ...(stored.recording!.target as any),
              secondsPerKm: args[0],
            },
          };
          return clone(stored.recording);
        }
        return {};
      },
    );
    await mount();
    expect(screenText()).toContain('5:30 /km');
    await tap('Zieltempo 5 Sekunden langsamer');
    expect(nativeCall).toHaveBeenCalledWith('setRunTargetPace', 335);
    expect(screenText()).toContain('5:35 /km');
    await tap('Zieltempo 5 Sekunden schneller');
    await tap('Zieltempo 5 Sekunden schneller');
    expect(nativeCall).toHaveBeenLastCalledWith('setRunTargetPace', 325);
    expect(screenText()).toContain('5:25 /km');
    // The target for the next run stays unchanged.
    expect(native.saveSettings).not.toHaveBeenCalled();
  });

  it('returns straight to Today after finishing, if wanted', async () => {
    stored.settings.features = { recording: { afterRun: 'home' } } as any;
    stored.recording = live();
    (nativeCall as jest.Mock).mockImplementation(async (method: string) => {
      if (method === 'finishRun') {
        stored.runs = [finished({ id: 'live' })];
        stored.recording = null;
      }
      return {};
    });
    const alert = jest
      .spyOn(Alert, 'alert')
      .mockImplementation((_title, _message, buttons) => {
        buttons
          ?.find(button => button.text === 'Beenden & speichern')
          ?.onPress?.();
      });
    await mount();
    await tap('Lauf beenden');
    await act(async () => {
      await Promise.resolve();
    });
    expect(screenText()).toContain('Aufzeichnung gespeichert');
    expect(screenText()).toContain('Lauf starten');
    expect(screenText()).not.toContain('Notiz zu dieser Aufzeichnung');
    alert.mockRestore();
  });
});

it('previews a next-run pace and a race goal without changing persisted settings', async () => {
  stored.runs = ['a', 'b', 'c'].map(id =>
    finished({ id, distanceMeters: 5000, durationSeconds: 1500 }),
  );
  await mount();
  await tap('Coach');
  await tapText('Ziele & Fokus');
  await tapText('Zielzeiten');
  await act(async () => {
    tree.root.findByType(DistanceTimes).props.onChoose(5, 1500);
  });
  expect(stored.settings.goalTargetSeconds).toBeUndefined();
  const goalTime = tree.root.findAll(
    node => node.props.accessibilityLabel === 'Zielzeit',
  );
  expect(goalTime.some(node => node.props.value === '25:00')).toBe(true);
  await tap('Coach');
  await tapText('Ziele & Fokus');
  await tapText('Zielzeiten');
  await act(async () => {
    tree.root.findByType(DistanceTimes).props.onNextRun(5, 1500);
  });
  expect(tree.root.findByType(RunTargetScreen).props.value).toMatchObject({
    kind: 'pace',
    secondsPerKm: 300,
  });
  expect(stored.settings.runTarget).toBeUndefined();
});

describe('Run type after the run', () => {
  const openRun = async () => {
    await tap('Verlauf');
    const row = pressables().find(node =>
      (node.props.accessibilityLabel || '').startsWith('Lauf:'),
    );
    expect(row).toBeTruthy();
    await act(async () => {
      row!.props.onPress();
    });
  };

  it('suggests the run type and saves it only after “That’s right”', async () => {
    stored.settings = { ...stored.settings, maxHeartRate: 190 };
    stored.runs = [
      finished({
        id: 'five',
        distanceMeters: 5000,
        durationSeconds: 1250,
        avgHeartRate: 172,
        heartRateCoverage: 0.95,
      }),
    ];
    await mount();
    await openRun();
    expect(screenText()).toContain('Wie war der Lauf gemeint?');
    expect(screenText()).toContain('Sah aus wie: Schnell — hoher Puls.');
    expect(native.feedback).not.toHaveBeenCalled();

    await tap('Stimmt');
    expect(native.feedback).toHaveBeenCalledWith('five', {
      purpose: 'race',
      purposeConfirmed: true,
      purposeHint: {
        model_version: 'runback-purpose-hint-3',
        purpose: 'race',
        signals: ['heart_rate_high'],
        maxHeartRate: { value: 190, source: 'setting' },
      },
    });
  });

  it('clears the trace of a suggestion when the user chooses their own and otherwise shows it under origin', async () => {
    stored.runs = [
      normalizeRun({
        ...finished({ id: 'hinted' }),
        feedback: {
          purpose: 'race',
          purposeConfirmed: true,
          purposeHint: {
            model_version: 'runback-purpose-hint-2',
            purpose: 'race',
            signals: ['heart_rate_high'],
            maxHeartRate: { value: 190, source: 'setting' },
          },
        },
      }),
    ];
    await mount();
    await openRun();
    expect(screenText()).not.toContain('Wie war der Lauf gemeint?');
    await tap('Daten & Herkunft');
    expect(screenText()).toContain(
      'Vorschlag bestätigt · runback-purpose-hint-2 · Maxpuls 190 (eingestellt)',
    );
    await tap('Bearbeiten & verwalten');
    await tapText('Intervalle');
    expect(native.feedback).toHaveBeenCalledWith('hinted', {
      purpose: 'intervals',
      purposeConfirmed: true,
      purposeHint: null,
    });
  });

  const recorded = (patch: Partial<Run> = {}) =>
    finished({
      id: 'fresh',
      purpose: 'unknown',
      distanceMeters: 5000,
      durationSeconds: 1250,
      avgHeartRate: 172,
      heartRateCoverage: 0.95,
      ...patch,
    });
  const chosen = () =>
    tree.root
      .findAllByType(ChipGroup)
      .find(item => item.props.label === 'Laufart dieser Aufzeichnung')!.props
      .value;

  it('asks a fresh recording once with the most likely run type preselected', async () => {
    stored.settings = { ...stored.settings, maxHeartRate: 190 };
    stored.runs = [recorded()];
    await mount();
    await openRun();
    expect(screenText()).toContain('Wie war der Lauf?');
    expect(screenText()).toContain('Vorausgewählt: hoher Puls.');
    expect(chosen()).toBe('race');
    // The page itself does not ask a second time.
    expect(screenText()).not.toContain('Wie war der Lauf gemeint?');
    expect(native.feedback).not.toHaveBeenCalled();

    await tap('OK');
    expect(native.feedback).toHaveBeenCalledWith('fresh', {
      purpose: 'race',
      purposeConfirmed: true,
      purposeAsked: true,
      purposeHint: expect.objectContaining({
        model_version: 'runback-purpose-hint-3',
        purpose: 'race',
      }),
    });
    expect(screenText()).not.toContain('Wie war der Lauf?');
  });

  it('saves another choice without the hint trace, and cancel only marks it asked', async () => {
    stored.settings = { ...stored.settings, maxHeartRate: 190 };
    stored.runs = [recorded()];
    await mount();
    await openRun();
    await tap('Locker');
    expect(chosen()).toBe('easy');
    await tap('OK');
    expect(native.feedback).toHaveBeenLastCalledWith('fresh', {
      purpose: 'easy',
      purposeConfirmed: true,
      purposeAsked: true,
      purposeHint: null,
    });

    await act(async () => tree.unmount());
    (native.feedback as jest.Mock).mockClear();
    stored.runs = [recorded({ id: 'other' })];
    await mount();
    await openRun();
    await tap('Abbrechen');
    expect(native.feedback).toHaveBeenCalledWith('other', {
      purposeAsked: true,
    });
    expect(screenText()).not.toContain('Wie war der Lauf?');
  });

  it('does not ask after a cancel, nor for imports', async () => {
    stored.runs = [
      normalizeRun({ ...recorded(), feedback: { purposeAsked: true } }),
    ];
    await mount();
    await openRun();
    expect(screenText()).not.toContain('Wie war der Lauf?');
    expect(screenText()).not.toContain('Wie war der Lauf gemeint?');

    await act(async () => tree.unmount());
    stored.runs = [recorded({ id: 'imported', source: 'garmin' })];
    await mount();
    await openRun();
    expect(screenText()).not.toContain('Wie war der Lauf?');
    // Imports keep the quiet question on the page.
    expect(screenText()).toContain('Wie war der Lauf gemeint?');
  });

  it('keeps the run type question open when saving fails so the user can retry', async () => {
    stored.runs = [recorded()];
    await mount();
    await openRun();
    (native.feedback as jest.Mock).mockRejectedValueOnce(new Error('Storage unavailable'));
    await tap('OK');
    expect(screenText()).toContain('Wie war der Lauf?');
    expect(screenText()).toContain('Storage unavailable');
    await tap('OK');
    expect(screenText()).not.toContain('Wie war der Lauf?');
  });

  it('reads pace changes from older watch versions correctly', () => {
    expect(normalizeRun({ ...finished({}), purpose: 'quality' }).purpose).toBe(
      'intervals',
    );
    expect(normalizeRun(finished({})).purposeConfirmed).toBe(false);
  });

  it('stops asking once “Just run” was explicitly chosen', async () => {
    // This is how the run comes from native storage via normalizeRun.
    stored.runs = [
      normalizeRun({
        ...finished({ id: 'free-run', purpose: 'unknown' }),
        feedback: { purpose: 'free', purposeConfirmed: true },
      }),
    ];
    expect(stored.runs[0].purposeConfirmed).toBe(true);
    await mount();
    await openRun();
    expect(screenText()).not.toContain('Wie war der Lauf gemeint?');
  });
});
