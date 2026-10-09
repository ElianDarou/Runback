import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { Text } from 'react-native';
import { MusicLive, MusicSettings } from '../src/ui/MusicSettings';
import { Button, Input, Row, Segmented, Sheet } from '../src/ui/components';
import { native } from '../src/native';
import type { MusicStatus } from '../src/domain/music';

jest.mock('../src/native', () => ({
  native: {
    musicStatus: jest.fn(),
    configureMusic: jest.fn(),
    setMusicBpm: jest.fn(),
    startMusic: jest.fn(),
    stopMusic: jest.fn(),
    disconnectMusic: jest.fn(),
  },
}));
const initial: MusicStatus = {
  enabled: true,
  clientId: '',
  hasBpmKey: false,
  connected: false,
  spotifyInstalled: false,
  redirectUri: 'http://127.0.0.1:43821/callback',
  fingerprint: 'AA:BB',
  config: { mode: 'cadence', halfTime: true },
  state: 'idle',
  message: '',
  version: 'music-match-1',
};
const track = {
  uri: 'spotify:track:0123456789abcdefghijkL',
  name: 'Example track',
  artists: ['Example artist'],
  bpm: null,
};
let tree: TestRenderer.ReactTestRenderer;
async function render(view: React.ReactElement) {
  await act(async () => {
    tree = TestRenderer.create(view);
  });
}
async function press(title: string) {
  const button = tree.root
    .findAllByType(Button)
    .find(item => item.props.title === title);
  if (!button) throw new Error(`Missing button: ${title}`);
  await act(async () => {
    await button.props.onPress();
  });
}
function content(node: TestRenderer.ReactTestInstance): string {
  return node.children
    .map(child =>
      typeof child === 'string' || typeof child === 'number'
        ? String(child)
        : content(child),
    )
    .join('');
}
function texts() {
  return tree.root.findAllByType(Text).map(content).join(' ');
}
beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  (native.musicStatus as jest.Mock).mockResolvedValue(initial);
  (native.configureMusic as jest.Mock).mockResolvedValue(initial);
  (native.setMusicBpm as jest.Mock).mockResolvedValue(initial);
  (native.disconnectMusic as jest.Mock).mockResolvedValue(initial);
  (native.startMusic as jest.Mock).mockResolvedValue({
    ...initial,
    runId: 'run',
  });
});
afterEach(async () => {
  if (tree) await act(async () => tree.unmount());
  jest.useRealTimers();
});

it('hides account setup when switched off and never connects or plays automatically', async () => {
  await render(<MusicSettings enabled={false} onToggle={jest.fn()} />);
  expect(texts()).toContain('Schalte Musik ein');
  expect(tree.root.findAllByType(Input)).toHaveLength(0);
  expect(native.startMusic).not.toHaveBeenCalled();
});
it('validates fixed tempo before saving settings and never displays stored keys', async () => {
  await render(<MusicSettings enabled onToggle={jest.fn()} />);
  const selector = tree.root.findByType(Segmented);
  await act(async () => selector.props.onChange('fixed'));
  await press('Musikeinstellungen speichern');
  expect(native.configureMusic).not.toHaveBeenCalled();
  expect(texts()).toContain('zwischen 80 und 250');
  const input = tree.root
    .findAllByType(Input)
    .find(item => item.props.label === 'Musiktempo in BPM')!;
  await act(async () => input.props.onChangeText('170'));
  await press('Musikeinstellungen speichern');
  expect(native.configureMusic).toHaveBeenCalledWith(
    { mode: 'fixed', fixedBpm: 170, halfTime: true },
    '',
    '',
  );
});
it('keeps missing BPM visible and lets the user set a song tempo', async () => {
  (native.musicStatus as jest.Mock).mockResolvedValue({
    ...initial,
    config: {
      ...initial.config,
      playlist: {
        id: 'playlist',
        name: 'Examples',
        tracks: [track],
        truncated: false,
      },
    },
  });
  await render(<MusicSettings enabled onToggle={jest.fn()} />);
  expect(texts()).toContain('BPM unbekannt');
  const row = tree.root
    .findAllByType(Row)
    .find(item => item.props.title === 'Example track')!;
  await act(async () => row.props.onPress());
  expect(tree.root.findByType(Sheet).props.visible).toBe(true);
  const input = tree.root
    .findAllByType(Input)
    .find(item => item.props.label === 'Songtempo in BPM')!;
  await act(async () => input.props.onChangeText('85'));
  await press('BPM speichern');
  expect(native.setMusicBpm).toHaveBeenCalledWith(track.uri, 85);
});
it('starts playback only after pressing the run music action', async () => {
  (native.musicStatus as jest.Mock).mockResolvedValue({
    ...initial,
    config: {
      ...initial.config,
      playlist: {
        id: 'playlist',
        name: 'Examples',
        tracks: [{ ...track, bpm: 170 }],
        truncated: false,
      },
    },
  });
  await render(<MusicLive runId="run" onSettings={jest.fn()} />);
  expect(native.startMusic).not.toHaveBeenCalled();
  await press('Musik starten');
  expect(native.startMusic).toHaveBeenCalledWith('run');
});
it('explains missing BPM and disables music starts during a paused run', async () => {
  await render(<MusicLive runId="run" onSettings={jest.fn()} />);
  expect(texts()).toContain('BPM fehlen');
  expect(
    tree.root
      .findAllByType(Button)
      .find(item => item.props.title === 'Musik starten')?.props.disabled,
  ).toBe(true);
  await act(async () => tree.unmount());
  (native.musicStatus as jest.Mock).mockResolvedValue({
    ...initial,
    config: {
      ...initial.config,
      playlist: {
        id: 'playlist',
        name: 'Examples',
        tracks: [{ ...track, bpm: 170 }],
        truncated: false,
      },
    },
  });
  await render(<MusicLive runId="run" paused onSettings={jest.fn()} />);
  expect(
    tree.root
      .findAllByType(Button)
      .find(item => item.props.title === 'Musik starten')?.props.disabled,
  ).toBe(true);
  expect(native.startMusic).not.toHaveBeenCalled();
});
it('clears the visible tempo settings when disconnecting', async () => {
  (native.musicStatus as jest.Mock).mockResolvedValue({
    ...initial,
    config: { mode: 'fixed', fixedBpm: 170, halfTime: false },
  });
  await render(<MusicSettings enabled onToggle={jest.fn()} />);
  const details = tree.root.findAll(
    item =>
      item.props.accessibilityLabel === 'Details' &&
      typeof item.props.onPress === 'function',
  )[0];
  await act(async () => details.props.onPress());
  const row = tree.root
    .findAllByType(Row)
    .find(
      item => item.props.title === 'Spotify trennen und Musikdaten löschen',
    )!;
  await act(async () => row.props.onPress());
  expect(native.disconnectMusic).toHaveBeenCalled();
  expect(tree.root.findByType(Segmented).props.value).toBe('cadence');
  expect(
    tree.root
      .findAllByType(Input)
      .find(item => item.props.label === 'Musiktempo in BPM'),
  ).toBeUndefined();
});
