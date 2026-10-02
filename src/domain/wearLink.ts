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
