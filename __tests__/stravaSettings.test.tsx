import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { Alert, AppState, type AppStateStatus } from 'react-native';
import { StravaSettings } from '../src/ui/StravaSettings';
import { Button, CheckRow } from '../src/ui/components';
import { nativeCall } from '../src/native';

jest.mock('../src/native', () => ({ nativeCall: jest.fn() }));
const initial = {
  configured: true,
  clientId: '123',
  connected: true,
  enabled: false,
  gps: false,
  health: false,
  athleteId: '42',
  problem: '',
  lastSuccessAt: null,
  uploaded: 0,
  pending: 0,
  failed: 0,
  unknown: 0,
  issues: [],
};
let tree: TestRenderer.ReactTestRenderer;
let resume: ((state: AppStateStatus) => void) | undefined;
const call = nativeCall as jest.Mock;
const toggle = () =>
  tree.root
    .findAllByType(CheckRow)
    .find(row => row.props.title === 'Automatisch nach Abschluss senden')!;
beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  call.mockResolvedValue(initial);
  jest
    .spyOn(AppState, 'addEventListener')
    .mockImplementation((_type, listener) => {
      resume = listener;
      return { remove: jest.fn() };
    });
});
afterEach(async () => {
  if (tree) await act(async () => tree.unmount());
  jest.restoreAllMocks();
  jest.useRealTimers();
});
async function render() {
  await act(async () => {
    tree = TestRenderer.create(<StravaSettings />);
  });
}

it('enables automatic uploads only on request and keeps GPS and heart rate opt-in', async () => {
  await render();
  expect(call.mock.calls).toEqual([['getStravaStatus']]);
  call.mockResolvedValue({ ...initial, enabled: true });
  await act(async () => toggle().props.onToggle());
  expect(call).toHaveBeenLastCalledWith('setStravaOptions', true, false, false);
  expect(toggle().props.checked).toBe(true);
});

it('does not let an older status request undo a completed settings change', async () => {
  await render();
  let resolveOld!: (value: typeof initial) => void;
  call.mockImplementation((name: string) =>
    name === 'getStravaStatus'
      ? new Promise(resolve => {
          resolveOld = resolve;
        })
      : Promise.resolve({ ...initial, enabled: true }),
  );
  await act(async () => resume?.('active'));
  await act(async () => toggle().props.onToggle());
  expect(toggle().props.checked).toBe(true);
  await act(async () => resolveOld(initial));
  expect(toggle().props.checked).toBe(true);
});

it('blocks repeated changes while the previous setting is still being saved', async () => {
  await render();
  let finish!: (value: typeof initial) => void;
  call.mockImplementation(
    () =>
      new Promise(resolve => {
        finish = resolve;
      }),
  );
  await act(async () => {
    toggle().props.onToggle();
    toggle().props.onToggle();
  });
  expect(
    call.mock.calls.filter(args => args[0] === 'setStravaOptions'),
  ).toHaveLength(1);
  await act(async () => finish({ ...initial, enabled: true }));
});

it('requires a separate user decision before retrying an upload with a missing confirmation', async () => {
  call.mockResolvedValue({
    ...initial,
    enabled: true,
    unknown: 1,
    issues: [
      { key: 'upload-key', name: 'Run', at: 1700000000000, state: 'unknown' },
    ],
  });
  const confirmation = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  await render();
  expect(call.mock.calls.some(args => args[0] === 'retryStravaUpload')).toBe(
    false,
  );
  const button = tree.root
    .findAllByType(Button)
    .find(row => row.props.title === 'Nach Prüfung erneut senden')!;
  await act(async () => button.props.onPress());
  expect(call.mock.calls.some(args => args[0] === 'retryStravaUpload')).toBe(
    false,
  );
  const buttons = confirmation.mock.calls[0][2]!;
  await act(async () =>
    buttons.find(item => item.text === 'Erneut senden')!.onPress?.(),
  );
  expect(call).toHaveBeenLastCalledWith('retryStravaUpload', 'upload-key');
});
