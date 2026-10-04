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
      <RunTargetScreen value={NO_RUN_TARGET} purpose="free" onSave={onSave} />,
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
      version: 2,
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
      <RunTargetScreen value={NO_RUN_TARGET} purpose="free" onSave={onSave} />,
    );
  });
  await act(async () => {
    tree.root
      .findAllByType(ChipGroup)
      .find(item => item.props.label === 'Laufziel')!
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
  const five = rows.find(item => item.props.subtitle === 'Schätzung 25:00 min')!;
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
