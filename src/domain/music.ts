import { tr } from './i18n';

export interface MusicTrack {
  uri: string;
  name: string;
  artists: string[];
  album?: string;
  imageUrl?: string;
  bpm?: number | null;
  bpmSource?: 'manual' | 'lookup' | 'unknown';
  bpmCheckedAt?: number;
}
export interface MusicConfig {
  mode: 'cadence' | 'fixed';
  fixedBpm?: number;
  halfTime: boolean;
  playlist?: {
    id: string;
    name: string;
    tracks: MusicTrack[];
    truncated: boolean;
  };
}
export interface MusicStatus {
  enabled: boolean;
  clientId: string;
  hasBpmKey: boolean;
  connected: boolean;
  spotifyInstalled: boolean;
  redirectUri: string;
  fingerprint: string;
  config: MusicConfig;
  state:
    | 'idle'
    | 'connecting'
    | 'waiting'
    | 'playing'
    | 'paused'
    | 'no_match'
    | 'spotify_missing'
    | 'stopped'
    | 'error';
  message: string;
  runId?: string;
  target?: number;
  currentTrack?: MusicTrack;
  version: string;
}
export const TAP_TEMPO_VERSION = 'tap-tempo-1';
/** Long breaks reset tapping; at least four beats establish a median interval. */
export function tapTempo(taps: readonly number[]): number | undefined {
  if (taps.length < 4 || taps.some(value => !Number.isFinite(value)))
    return undefined;
  const intervals = taps.slice(1).map((at, i) => at - taps[i]);
  if (intervals.some(value => value < 240 || value > 1500)) return undefined;
  const sorted = intervals.slice(-8).sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const median =
    sorted.length % 2
      ? sorted[middle]
      : (sorted[middle - 1] + sorted[middle]) / 2;
  return Math.round(60000 / median);
}
export function parseMusicBpm(value: string, minimum = 40): number | undefined {
  if (!/^\d{2,3}(?:[.,]\d{1,2})?$/.test(value.trim())) return undefined;
  const bpm = Number(value.trim().replace(',', '.'));
  return Number.isFinite(bpm) && bpm >= minimum && bpm <= 250 ? bpm : undefined;
}
export function musicStateLabel(state: MusicStatus['state']): string {
  switch (state) {
    case 'idle':
      return tr('Bereit', 'Ready');
    case 'connecting':
      return tr('Verbindet', 'Connecting');
    case 'waiting':
      return tr('Wartet auf Schritte', 'Waiting for steps');
    case 'playing':
      return tr('Spielt', 'Playing');
    case 'paused':
      return tr('Pausiert', 'Paused');
    case 'no_match':
      return tr('Kein passender Titel', 'No matching track');
    case 'spotify_missing':
      return tr('Spotify fehlt', 'Spotify missing');
    case 'stopped':
      return tr('Steuerung beendet', 'Control stopped');
    case 'error':
      return tr('Nicht verbunden', 'Disconnected');
  }
}
