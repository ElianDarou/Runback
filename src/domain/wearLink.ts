/**
 * Ob die Uhr eine laufende Aufzeichnung des Telefons mitschreibt.
 *
 * Grundlage ist `getWearStatus`: verbundene Uhren plus `lastCommand`, der
 * letzte Stand, den Kotlin als `wearLinkStatus` ablegt — Befehl gesendet,
 * Bestätigung der Uhr (`accepted`/`error`/`retry`) oder eingehende
 * Uhrdaten (`live`). Ein Stand eines anderen Laufs zählt nicht.
 */

export type WearRecordingLink =
  /** Uhr hat bestätigt oder schickt gerade Daten. */
  | 'recording'
  /** Befehl ist unterwegs, die Uhr hat noch nicht bestätigt. */
  | 'waiting'
  /** Uhr hat bestätigt, schickt aber während der Aufzeichnung nichts mehr. */
  | 'silent'
  /** Uhr hat den Befehl abgelehnt oder war nicht erreichbar. */
  | 'failed'
  /** Keine Uhr verbunden; das Telefon zeichnet allein auf. */
  | 'disconnected';

/** Die Uhr sendet GPS sofort und Sensoren gebündelt; länger still heißt: keine Daten. */
export const WEAR_LIVE_SILENCE_MS = 20_000;

/**
 * `null`, solange der Status unbekannt ist oder das Telefon kein Wear OS hat —
 * dann gibt es nichts Ehrliches über die Uhr zu sagen.
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
  // Pausiert schickt die Uhr nichts; Stille zählt nur bei laufender Aufnahme.
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
      // sent, pending, queued, retry, disconnected: das Telefon versucht es erneut.
      return 'waiting';
  }
}

/**
 * Was die Uhr zu einer Krafteinheit misst und schon ans Handy gegeben hat
 * (Kotlin `MotionSessions.watchInfo`). Fehlt es, war die Uhr nicht beteiligt.
 */
export interface StrengthWatchInfo {
  sessionId: string;
  /** `recording` während der Einheit, `stopped` bis die Datei da ist, dann `received`. */
  status: string;
  capture: { motion: boolean; heartRate: boolean };
  /** Letzte Meldung der Uhr: `sent`, `recording`, `waiting`, `error`, `disconnected`. */
  watch: { status?: string; message?: string; updatedAt?: number };
  file?: { receivedAt?: number; present?: boolean };
  /** Letzter Live-Wert in Handyzeit; der Puls fehlt, wenn die Uhr keinen gültigen hatte. */
  live?: { receivedAt: number; motion?: boolean; bpm?: number; bpmAt?: number };
}

const finite = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

/** Liest die Bridge-Antwort; Unlesbares ist „keine Uhr“, nicht ein Fehler. */
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
  /** Uhr misst und meldet sich. */
  | 'measuring'
  /** Start ist unterwegs oder die Uhr-App muss geöffnet werden. */
  | 'starting'
  /** Uhr hat gemeldet, schweigt aber seit einer Weile. */
  | 'silent'
  /** Uhr hat den Start abgelehnt. */
  | 'failed'
  /** Beim Start war keine Uhr verbunden. */
  | 'disconnected';

/** Die Uhr meldet sich alle 5 s; nach 20 s ohne Meldung gilt sie als still. */
export const STRENGTH_WATCH_SILENCE_MS = 20_000;
/** Ein Puls ist so lange eine Live-Anzeige; danach steht „–“. */
export const STRENGTH_WATCH_HEART_MS = 15_000;

/**
 * Zustand der Uhr während einer laufenden Krafteinheit und der Puls jetzt.
 * `null`, wenn die Uhr nicht beteiligt ist oder die Einheit nicht mehr läuft.
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
      // `sent` oder `waiting`: Android ließ den Start im Hintergrund nicht zu.
      return {
        state: 'starting',
        hint:
          info.watch.status === 'waiting'
            ? 'Öffne Runback auf der Uhr.'
            : undefined,
      };
  }
  const live = info.live;
  // Ältere Uhren melden nichts live; dann bleibt es beim bestätigten Start.
  if (!live) return { state: 'measuring' };
  if (now - live.receivedAt > STRENGTH_WATCH_SILENCE_MS) {
    return { state: 'silent', hint: 'Prüfe, ob die Uhr in der Nähe ist.' };
  }
  const fresh =
    live.bpm !== undefined &&
    live.bpmAt !== undefined &&
    now - live.bpmAt <= STRENGTH_WATCH_HEART_MS;
  return { state: 'measuring', ...(fresh ? { bpm: live.bpm } : {}) };
}

export type StrengthWatchTransfer =
  /** Daten der Uhr sind auf dem Handy. */
  | 'received'
  /** Einheit ist beendet, die Datei der Uhr fehlt noch. */
  | 'waiting'
  /** Die Uhr hat nicht aufgezeichnet. */
  | 'missing';

/** Übertragungsstand einer beendeten Einheit; `null` ohne Uhr oder solange sie läuft. */
export function strengthWatchTransfer(
  info: StrengthWatchInfo | null,
): StrengthWatchTransfer | null {
  if (!info || info.status === 'recording') return null;
  if (info.status === 'received') return 'received';
  // Gestartet hat die Uhr nie: Es kommt nichts mehr.
  if (info.watch.status === 'error' || info.watch.status === 'disconnected') {
    return 'missing';
  }
  return 'waiting';
}

/** „Puls und Bewegungen“, „Puls“ oder „Bewegungen“ — was angefordert war. */
export function strengthWatchCaptureLabel(info: StrengthWatchInfo): string {
  const { heartRate, motion } = info.capture;
  if (heartRate && motion) return 'Puls und Bewegungen';
  return heartRate ? 'Puls' : 'Bewegungen';
}
