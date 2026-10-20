import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import {
  AppState as AndroidAppState,
  Text,
  type AppStateStatus,
} from 'react-native';

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock('../src/native', () => ({
  nativeCall: jest.fn(async () => ({})),
  normalizeRun: (raw: unknown) => raw,
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
    state: jest.fn(),
    saveSettings: jest.fn(),
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
}));

import { native, nativeCall, type AppState } from '../src/native';
import { RunbackApp } from '../src/ui/RunbackApp';
import { PlanningScreen } from '../src/ui/PlanningScreen';
import { DevelopmentScreen } from '../src/ui/DevelopmentScreen';
import {
  localDateKey,
  addCalendarDays,
  normalizeSchedule,
  setDayPlan,
  weekdayOf,
  type ScheduledSession,
} from '../src/domain/schedule';

let stored: AppState;
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
const textContent = (node: TestRenderer.ReactTestInstance): string =>
  node.children
    .map(child =>
      typeof child === 'string' || typeof child === 'number'
        ? String(child)
        : textContent(child),
    )
    .join('');
let tree: TestRenderer.ReactTestRenderer;
const session = (): ScheduledSession => ({
  id: 'planned-run',
  title: 'Lauf',
  date: localDateKey(),
  kind: 'run',
  purpose: 'easy',
  status: 'planned',
});
async function press(title: string) {
  await act(async () => {
    tree.root
      .find(
        node =>
          node.props.title === title &&
          typeof node.props.onPress === 'function',
      )
      .props.onPress();
  });
}
const allText = () => tree.root.findAllByType(Text).map(textContent).join(' ');
async function tap(label: string) {
  await act(async () => {
    tree.root
      .find(
        node =>
          node.props.accessibilityLabel === label &&
          typeof node.props.onPress === 'function',
      )
      .props.onPress();
  });
}
async function mount() {
  await act(async () => {
    tree = TestRenderer.create(<RunbackApp />);
  });
}
beforeEach(() => {
  jest.clearAllMocks();
  (AndroidAppState.addEventListener as jest.Mock).mockImplementation(() => ({
    remove: jest.fn(),
  }));
  (native.strength as jest.Mock).mockResolvedValue({
    templates: [],
    active: null,
    history: [],
  });
  stored = {
    runs: [],
    recording: null,
    capabilities: {},
    settings: {
      onboardedAt: 1,
      goal: 'Regelmäßig laufen',
      trainingDays: [1, 3],
      minutes: 30,
      schedule: { ...normalizeSchedule(), sessions: [session()] },
    },
  };
  (native.state as jest.Mock).mockImplementation(async () => clone(stored));
  (native.saveSettings as jest.Mock).mockImplementation(async settings => {
    stored.settings = clone(settings);
  });
  (nativeCall as jest.Mock).mockImplementation(async method => {
    if (method === 'requestRecordingPermissions')
      return { locationPermission: true };
    if (method === 'startRun')
      stored.recording = {
        id: 'recorded-run',
        startTime: Date.now(),
        endTime: 0,
        status: 'recording',
        purpose: 'easy',
        durationSeconds: 0,
        distanceMeters: 0,
        source: 'phone',
        sourceVersion: 'native-v1',
        samples: 0,
      };
    return {};
  });
});
afterEach(async () => {
  if (tree) await act(async () => tree.unmount());
  jest.restoreAllMocks();
});

it('saves calendar changes locally and restores them after reopening the app', async () => {
  await mount();
  await tap('Plan');
  const next = setDayPlan(
    normalizeSchedule(stored.settings.schedule),
    addCalendarDays(localDateKey(), 1),
    [{ kind: 'run' }],
    localDateKey(),
  );
  await act(async () => {
    await tree.root.findByType(PlanningScreen).props.onSave(next);
  });
  expect(stored.settings.goal).toBe('Regelmäßig laufen');
  expect(stored.settings.schedule).toEqual(next);
  await act(async () => tree.unmount());
  await mount();
  await tap('Plan');
  expect(tree.root.findByType(PlanningScreen).props.state).toEqual(next);
});

it('leaves saved planning intact and rejects the caller on storage failure', async () => {
  await mount();
  await tap('Plan');
  const before = clone(stored.settings.schedule);
  (native.saveSettings as jest.Mock).mockRejectedValueOnce(
    new Error('Speicher voll'),
  );
  await act(async () => {
    await expect(
      tree.root.findByType(PlanningScreen).props.onSave(normalizeSchedule()),
    ).rejects.toThrow('Speicher voll');
  });
  expect(stored.settings.schedule).toEqual(before);
  expect(tree.root.findByType(PlanningScreen).props.state).toEqual(before);
});

it('starts the run planned for today like any other run', async () => {
  await mount();
  expect(allText()).toContain('Heute geplant');
  await tap('Lauf starten');
  expect(nativeCall).toHaveBeenCalledWith(
    'startRun',
    // The run type is asked after the run, not taken from the plan.
    'unknown',
    'running',
    '{"kind":"none","version":3}',
  );
  // Nothing is linked or marked: Plan finds the run by its day.
  expect(stored.settings.schedule?.sessions[0]).toEqual(session());
  expect(allText()).toContain('Lauf läuft');
});

it('plans a template on its weekdays and notes the weekly plan from today on', async () => {
  (native.strength as jest.Mock).mockResolvedValue({
    templates: [
      {
        id: 'pull',
        name: 'Pull',
        days: [new Date().getDay()],
        icon: 'handGrab',
        exercises: [],
        createdAt: 1,
      },
    ],
    active: null,
    history: [],
  });
  stored.settings.schedule = normalizeSchedule({ runDays: [] });
  await mount();
  expect(allText()).toContain('Heute geplant');
  expect(allText()).toContain('Pull');
  expect(stored.settings.schedule?.weeklyHistory).toEqual([
    {
      since: localDateKey(),
      run: [],
      strength: [{ templateId: 'pull', days: [weekdayOf(localDateKey())] }],
    },
  ]);
});

it('notes changed run days even when the strength history does not load', async () => {
  (native.strengthSessions as jest.Mock).mockRejectedValueOnce(new Error('db'));
  stored.settings.schedule = normalizeSchedule({ runDays: [2] });
  await mount();
  expect(stored.settings.schedule?.weeklyHistory).toEqual([
    { since: localDateKey(), run: [2], strength: [] },
  ]);
});

it('takes a weekly workout off Today when the day was changed', async () => {
  (native.strength as jest.Mock).mockResolvedValue({
    templates: [
      {
        id: 'gym',
        name: 'Beintraining',
        days: [new Date().getDay()],
        exercises: [],
        createdAt: 1,
      },
    ],
    active: null,
    history: [],
  });
  stored.settings.schedule = setDayPlan(
    normalizeSchedule(),
    localDateKey(),
    [],
    localDateKey(),
  );
  await mount();
  expect(allText()).not.toContain('Heute geplant');
  expect(allText()).toContain('Heute frei');
  // Next week it is back.
  expect(allText()).toContain('Als Nächstes: Beintraining');
});

it('opens Development under All features with both goals apart', async () => {
  await mount();
  await tap('Einstellungen');
  await press('Darstellung');
  await press('Alle Funktionen');
  await press('Entwicklung');
  const screen = tree.root.findByType(DevelopmentScreen);
  expect(screen.props.runs).toEqual([]);
  expect(screen.props.prediction.goal).toBe('Regelmäßig laufen');
  await act(async () => screen.props.onEditStrengthGoal());
  expect(allText()).toContain('Ziel im Krafttraining');
});

it('does not let a slow refresh overwrite a newly saved calendar', async () => {
  let activate: (value: AppStateStatus) => void = () => {};
  const listener = jest
    .spyOn(AndroidAppState, 'addEventListener')
    .mockImplementation((_event, callback) => {
      activate = callback;
      return { remove: jest.fn() };
    });
  await mount();
  await tap('Plan');
  const stale = clone(stored);
  let resolveRead!: (value: AppState) => void;
  (native.state as jest.Mock).mockImplementationOnce(
    () =>
      new Promise(resolve => {
        resolveRead = resolve;
      }),
  );
  await act(async () => activate('active'));
  const changed = setDayPlan(
    normalizeSchedule(stored.settings.schedule),
    localDateKey(),
    [{ kind: 'strength', title: 'Neu' }],
    localDateKey(),
  );
  await act(async () => {
    await tree.root.findByType(PlanningScreen).props.onSave(changed);
  });
  await act(async () => resolveRead(stale));
  expect(
    tree.root.findByType(PlanningScreen).props.state.sessions[0].title,
  ).toBe('Neu');
  listener.mockRestore();
});

it('does not let a slow refresh erase a newly started recording', async () => {
  let activate: (value: AppStateStatus) => void = () => {};
  const listener = jest
    .spyOn(AndroidAppState, 'addEventListener')
    .mockImplementation((_event, callback) => {
      activate = callback;
      return { remove: jest.fn() };
    });
  await mount();
  const stale = clone(stored);
  let resolveRead!: (value: AppState) => void;
  (native.state as jest.Mock).mockImplementationOnce(
    () =>
      new Promise(resolve => {
        resolveRead = resolve;
      }),
  );
  await act(async () => activate('active'));
  await tap('Lauf starten');
  await act(async () => resolveRead(stale));
  expect(allText()).toContain('Lauf läuft');
  listener.mockRestore();
});

it('keeps the schedule goal canonical when the running goal is saved', async () => {
  const scheduleGoal = {
    name: '10 km im Herbst',
    startDate: localDateKey(),
  };
  stored.settings = {
    ...stored.settings,
    goal: 'Altes Ziel',
    schedule: {
      ...normalizeSchedule(stored.settings.schedule),
      runDays: [2, 5],
      goal: scheduleGoal,
    },
  };
  await mount();
  await tap('Einstellungen');
  await press('Darstellung');
  await press('Alle Funktionen');
  await press('Entwicklung');
  expect(tree.root.findByType(DevelopmentScreen).props.prediction.goal).toBe(
    scheduleGoal.name,
  );
  await act(async () =>
    tree.root.findByType(DevelopmentScreen).props.onEditGoal(),
  );
  expect(
    tree.root.find(node => node.props.accessibilityLabel === 'Dein Ziel').props
      .value,
  ).toBe(scheduleGoal.name);
  await press('Ziel speichern');
  expect(stored.settings.schedule?.runDays).toEqual([2, 5]);
  expect(stored.settings.schedule?.goal?.name).toBe(scheduleGoal.name);
  expect(stored.settings.goal).toBe(scheduleGoal.name);
});
