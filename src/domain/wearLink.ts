/**
 * Whether the watch records along with a running recording on the phone.
 *
 * Based on `getWearStatus`: connected watches plus `lastCommand`, the latest
 * state Kotlin stores as `wearLinkStatus` — command sent, the watch's
 * confirmation (`accepted`/`error`/`retry`), or incoming watch data (`live`).
 * A state from another run does not count.
 */
import { tr } from './i18n';

export type WearRecordingLink =
  /** Watch has confirmed or is sending data right now. */
  | 'recording'
  /** Command is on its way; the watch has not confirmed yet. */
  | 'waiting'
  /** Watch has confirmed but sends nothing during the recording anymore. */
  | 'silent'
  /** Watch declined the command or could not be reached. */
  | 'failed'
  /** No watch connected; the phone records alone. */
  | 'disconnected';

/** The watch sends GPS immediately and sensors in batches; silent for longer means: no data. */
export const WEAR_LIVE_SILENCE_MS = 20_000;

/**
 * `null` while the status is unknown or the phone has no Wear OS — then there
 * is nothing honest to say about the watch.
 */
export function wearRecordingLink(
  wear: unknown,
  run: { id: string; status: string },
  now: number,
): WearRecordingLink | null {
  if (!wear || typeof wear !== 'object') {
    return null;
  }
  const { connected, status, lastCommand } = wear as Record<string, unknown>;
  if (typeof connected !== 'boolean' || status === 'unavailable') {
    return null;
  }
  if (!connected) {
    return 'disconnected';
  }
  const link =
    lastCommand && typeof lastCommand === 'object'
      ? (lastCommand as Record<string, unknown>)
      : null;
  if (!link || link.runId !== run.id) {
    return 'waiting';
  }
  // Paused, the watch sends nothing; silence only counts during a running recording.
  const silentSince = (at: unknown) =>
    run.status === 'recording' &&
    (typeof at !== 'number' ||
      !Number.isFinite(at) ||
      now - at > WEAR_LIVE_SILENCE_MS);
  switch (link.status) {
    case 'live':
      return silentSince(link.lastLiveAt) ? 'silent' : 'recording';
    case 'accepted':
      return silentSince(link.updatedAt) ? 'silent' : 'recording';
    case 'error':
      return 'failed';
    default:
      // sent, pending, queued, retry, disconnected: the phone tries again.
      return 'waiting';
  }
}

/**
 * What the watch measures for a strength session and has already handed to
 * the phone (Kotlin `MotionSessions.watchInfo`). If missing, the watch was not
 * involved.
 */
export interface StrengthWatchInfo {
  sessionId: string;
  /** `recording` during the session, `stopped` until the file is there, then `received`. */
  status: string;
  capture: { motion: boolean; heartRate: boolean };
  /** Latest message from the watch: `sent`, `recording`, `waiting`, `error`, `disconnected`. */
  watch: { status?: string; message?: string; updatedAt?: number };
  file?: { receivedAt?: number; present?: boolean };
  /** Latest live value in phone time; the heart rate is missing if the watch had no valid one. */
  live?: { receivedAt: number; motion?: boolean; bpm?: number; bpmAt?: number };
}

const finite = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

/** Reads the bridge response; unreadable means "no watch", not an error. */
export function readStrengthWatchInfo(raw: unknown): StrengthWatchInfo | null {
  if (!raw || typeof raw !== 'object') return null;
  const value = raw as Record<string, any>;
  if (typeof value.sessionId !== 'string' || typeof value.status !== 'string') {
    return null;
  }
  const capture =
    value.capture && typeof value.capture === 'object' ? value.capture : {};
  const watch =
    value.watch && typeof value.watch === 'object' ? value.watch : {};
  const live = value.live && typeof value.live === 'object' ? value.live : null;
  const file = value.file && typeof value.file === 'object' ? value.file : null;
  return {
    sessionId: value.sessionId,
    status: value.status,
    capture: {
      motion: capture.motion === true,
      heartRate: capture.heartRate === true,
    },
    watch: {
      status: typeof watch.status === 'string' ? watch.status : undefined,
      message:
        typeof watch.message === 'string' && watch.message
          ? watch.message
          : undefined,
      updatedAt: finite(watch.updatedAt) ? watch.updatedAt : undefined,
    },
    ...(file
      ? {
          file: {
            receivedAt: finite(file.receivedAt) ? file.receivedAt : undefined,
            present: file.present === true,
          },
        }
      : {}),
    ...(live && finite(live.receivedAt)
      ? {
          live: {
            receivedAt: live.receivedAt,
            motion: live.motion === true,
            bpm: finite(live.bpm) ? live.bpm : undefined,
            bpmAt: finite(live.bpmAt) ? live.bpmAt : undefined,
          },
        }
      : {}),
  };
}

export type StrengthWatchLive =
  /** Watch is measuring and reporting. */
  | 'measuring'
  /** Start is on its way or the watch app has to be opened. */
  | 'starting'
  /** Watch has reported but has been silent for a while. */
  | 'silent'
  /** Watch declined the start. */
  | 'failed'
  /** No watch was connected at the start. */
  | 'disconnected';

/** The watch reports every 5 s; after 20 s without a report it counts as silent. */
export const STRENGTH_WATCH_SILENCE_MS = 20_000;
/** A heart rate stays a live reading this long; afterwards it shows "–". */
export const STRENGTH_WATCH_HEART_MS = 15_000;

/**
 * State of the watch during a running strength session, and the heart rate now.
 * `null` if the watch is not involved or the session is no longer running.
 */
export function strengthWatchLive(
  info: StrengthWatchInfo | null,
  now: number,
): { state: StrengthWatchLive; bpm?: number; hint?: string } | null {
  if (!info || info.status !== 'recording') return null;
  switch (info.watch.status) {
    case 'error':
      return { state: 'failed', hint: info.watch.message };
    case 'disconnected':
      return { state: 'disconnected' };
    case 'recording':
      break;
    default:
      // `sent` or `waiting`: Android did not allow the start in the background.
      return {
        state: 'starting',
        hint:
          info.watch.status === 'waiting'
            ? tr('Öffne Runback auf der Uhr.', 'Open Runback on the watch.')
            : undefined,
      };
  }
  const live = info.live;
  // Older watches report nothing live; then the confirmed start stays.
  if (!live) return { state: 'measuring' };
  if (now - live.receivedAt > STRENGTH_WATCH_SILENCE_MS) {
    return {
      state: 'silent',
      hint: tr('Prüfe, ob die Uhr in der Nähe ist.', 'Check that the watch is nearby.'),
    };
  }
  const fresh =
    live.bpm !== undefined &&
    live.bpmAt !== undefined &&
    now - live.bpmAt <= STRENGTH_WATCH_HEART_MS;
  return { state: 'measuring', ...(fresh ? { bpm: live.bpm } : {}) };
}

export type StrengthWatchTransfer =
  /** The watch's data is on the phone. */
  | 'received'
  /** Session has ended; the watch's file is still missing. */
  | 'waiting'
  /** The watch did not record. */
  | 'missing';

/** Transfer status of an ended session; `null` without a watch or while it runs. */
export function strengthWatchTransfer(
  info: StrengthWatchInfo | null,
): StrengthWatchTransfer | null {
  if (!info || info.status === 'recording') return null;
  if (info.status === 'received') return 'received';
  // The watch never started: nothing more will come.
  if (info.watch.status === 'error' || info.watch.status === 'disconnected') {
    return 'missing';
  }
  return 'waiting';
}

/** "Heart rate and motion", "Heart rate" or "Motion" — what was requested. */
export function strengthWatchCaptureLabel(info: StrengthWatchInfo): string {
  const { heartRate, motion } = info.capture;
  if (heartRate && motion)
    return tr('Puls und Bewegungen', 'Heart rate and motion');
  return heartRate ? tr('Puls', 'Heart rate') : tr('Bewegungen', 'Motion');
}
