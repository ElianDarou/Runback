import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { RunTargetScreen } from '../src/ui/RunTargetScreen';
import { DistanceTimes } from '../src/ui/DistanceTimes';
import { Button, ChipGroup, Input, Row } from '../src/ui/components';
import { NO_RUN_TARGET } from '../src/domain/runTarget';
import type { Run } from '../src/native';
jest.mock('../src/native', () => ({ nativeCall: jest.fn(async () => ({})) }));

it('saves independent time announcements without requiring a pace target', async () => {
  const onSave = jest.fn(async () => undefined);
  let tree!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = TestRenderer.create(
      <RunTargetScreen value={NO_RUN_TARGET} onSave={onSave} />,
    );
  });
  await act(async () => {
    tree.root
      .findAllByType(ChipGroup)
      .find(item => item.props.label === 'Auslöser für Durchsagen')!
      .props.onChange('time');
  });
  await act(async () => {
    tree.root
      .findAllByType(ChipGroup)
      .find(item => item.props.label === 'Aktueller Puls')!
      .props.onChange('on');
  });
  await act(async () => {
    await tree.root.findByType(Button).props.onPress();
  });
  expect(onSave).toHaveBeenCalledWith(
    expect.objectContaining({
      kind: 'none',
      version: 3,
      announcements: expect.objectContaining({
        trigger: 'time',
        interval: 10,
        heartRate: true,
      }),
    }),
  );
  act(() => tree.unmount());
});

it('accepts five-second pace guidance and rejects an unsupported interval', async () => {
  const onSave = jest.fn(async () => undefined);
  let tree!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = TestRenderer.create(
      <RunTargetScreen value={NO_RUN_TARGET} onSave={onSave} />,
    );
  });
  await act(async () => {
    tree.root
      .findAllByType(ChipGroup)
      .find(item => item.props.label === 'Wonach')!
      .props.onChange('pace');
  });
  const interval = () =>
    tree.root
      .findAllByType(Input)
      .find(item => item.props.label === 'Hinweisabstand in Sekunden')!;
  await act(async () => {
    interval().props.onChangeText('4');
  });
  await act(async () => {
    await tree.root.findByType(Button).props.onPress();
  });
  expect(onSave).not.toHaveBeenCalled();
  await act(async () => {
    interval().props.onChangeText('5');
  });
  await act(async () => {
    await tree.root.findByType(Button).props.onPress();
  });
  expect(onSave).toHaveBeenCalledWith(
    expect.objectContaining({
      kind: 'pace',
      cueIntervalSeconds: 5,
      secondsPerKm: 330,
    }),
  );
  act(() => tree.unmount());
});

it('saves a distance goal with a pace from the finish time', async () => {
  const onSave = jest.fn(async () => undefined);
  let tree!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = TestRenderer.create(
      <RunTargetScreen value={NO_RUN_TARGET} onSave={onSave} />,
    );
  });
  const chips = (label: string) =>
    tree.root
      .findAllByType(ChipGroup)
      .find(item => item.props.label === label)!;
  const input = (label: string) =>
    tree.root.findAllByType(Input).find(item => item.props.label === label)!;
  await act(async () => {
    chips('Wie weit').props.onChange('distance');
  });
  await act(async () => {
    chips('Wonach').props.onChange('pace');
  });
  await act(async () => {
    input('Zielstrecke in Kilometern').props.onChangeText('5');
  });
  await act(async () => {
    input('Zielzeit für die Strecke').props.onChangeText('24:00');
  });
  expect(input('Zieltempo in Minuten pro Kilometer').props.value).toBe('4:48');
  await act(async () => {
    await tree.root.findByType(Button).props.onPress();
  });
  expect(onSave).toHaveBeenCalledWith(
    expect.objectContaining({
      kind: 'pace',
      version: 3,
      secondsPerKm: 288,
      mode: 'range',
      goal: { kind: 'distance', meters: 5000 },
    }),
  );
  onSave.mockClear();
  await act(async () =>
    input('Zielzeit für die Strecke').props.onChangeText('1:00'),
  );
  await act(async () => tree.root.findByType(Button).props.onPress());
  expect(onSave).not.toHaveBeenCalled();
  await act(async () =>
    input('Zielzeit für die Strecke').props.onChangeText('invalid'),
  );
  await act(async () => tree.root.findByType(Button).props.onPress());
  expect(onSave).not.toHaveBeenCalled();
  act(() => tree.unmount());
});

it('saves intervals without a goal and rejects a bad rest', async () => {
  const onSave = jest.fn(async () => undefined);
  let tree!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = TestRenderer.create(
      <RunTargetScreen
        value={{
          kind: 'none',
          version: 3,
          goal: { kind: 'time', seconds: 1800 },
        }}
        onSave={onSave}
      />,
    );
  });
  const input = (label: string) =>
    tree.root.findAllByType(Input).find(item => item.props.label === label)!;
  await act(async () => {
    tree.root
      .findAllByType(ChipGroup)
      .find(item => item.props.label === 'Wonach')!
      .props.onChange('intervals');
  });
  await act(async () => {
    input('Pause in Minuten und Sekunden').props.onChangeText('20:00');
  });
  await act(async () => {
    await tree.root.findByType(Button).props.onPress();
  });
  expect(onSave).not.toHaveBeenCalled();
  await act(async () => {
    input('Pause in Minuten und Sekunden').props.onChangeText('1:00');
  });
  await act(async () => {
    await tree.root.findByType(Button).props.onPress();
  });
  const saved = (onSave.mock.calls[0] as unknown[])[0] as Record<
    string,
    unknown
  >;
  expect(saved).toMatchObject({
    kind: 'intervals',
    intervals: {
      repeats: 6,
      work: { kind: 'distance', meters: 400 },
      restSeconds: 60,
      warmupSeconds: 0,
    },
  });
  expect(saved.goal).toBeUndefined();
  onSave.mockClear();
  await act(async () =>
    input('Pause in Minuten und Sekunden').props.onChangeText('0:00'),
  );
  await act(async () => tree.root.findByType(Button).props.onPress());
  expect(onSave).toHaveBeenCalledWith(
    expect.objectContaining({
      intervals: expect.objectContaining({ restSeconds: 0 }),
    }),
  );
  act(() => tree.unmount());
});

it('opens a target preview only on selection and leaves unsupported distances inactive', () => {
  const onChoose = jest.fn();
  const runs: Run[] = ['a', 'b', 'c'].map(id => ({
    id,
    startTime: Date.now() - 86400000,
    endTime: Date.now() - 84000000,
    durationSeconds: 1500,
    distanceMeters: 5000,
    purpose: 'free',
    status: 'completed',
    source: 'test',
  }));
  let tree!: TestRenderer.ReactTestRenderer;
  act(() => {
    tree = TestRenderer.create(
      <DistanceTimes runs={runs} onChoose={onChoose} onRun={() => {}} />,
    );
  });
  expect(onChoose).not.toHaveBeenCalled();
  const rows = tree.root.findAllByType(Row);
  const five = rows.find(
    item => item.props.subtitle === 'Schätzung 25:00 min',
  )!;
  act(() => five.props.onPress());
  expect(onChoose).toHaveBeenCalledWith(5, 1500);
  expect(
    rows.find(item => item.props.subtitle === 'Zu wenig vergleichbare Läufe')!
      .props.onPress,
  ).toBeUndefined();
  act(() => tree.unmount());
});

it('prefers the next-run pace preview when available without applying settings', () => {
  const onNextRun = jest.fn();
  const onChoose = jest.fn();
  const runs: Run[] = ['a', 'b', 'c'].map(id => ({
    id,
    startTime: Date.now() - 86400000,
    endTime: Date.now() - 84000000,
    durationSeconds: 1500,
    distanceMeters: 5000,
    purpose: 'free',
    status: 'completed',
    source: 'test',
  }));
  let tree!: TestRenderer.ReactTestRenderer;
  act(() => {
    tree = TestRenderer.create(
      <DistanceTimes
        runs={runs}
        onChoose={onChoose}
        onNextRun={onNextRun}
        onRun={() => {}}
      />,
    );
  });
  expect(onNextRun).not.toHaveBeenCalled();
  act(() =>
    tree.root
      .findAllByType(Row)
      .find(item => item.props.subtitle === 'Schätzung 25:00 min')!
      .props.onPress(),
  );
  expect(onNextRun).toHaveBeenCalledWith(5, 1500);
  expect(onChoose).not.toHaveBeenCalled();
  act(() => tree.unmount());
});
