import { fixed, tr } from './i18n';

export const RUN_ANNOUNCEMENTS_VERSION = 1 as const;

export interface RunAnnouncements {
  version: typeof RUN_ANNOUNCEMENTS_VERSION;
  trigger: 'off' | 'distance' | 'time';
  /** Kilometers when triggered by distance, minutes when triggered by time. */
  interval: number;
  kilometer: boolean;
  distance: boolean;
  lastKilometerPace: boolean;
  averagePace: boolean;
  heartRate: boolean;
}

export const NO_RUN_ANNOUNCEMENTS: RunAnnouncements = {
  version: RUN_ANNOUNCEMENTS_VERSION,
  trigger: 'off',
  interval: 1,
  kilometer: true,
  distance: true,
  lastKilometerPace: true,
  averagePace: true,
  heartRate: false,
};

export function normalizeRunAnnouncements(value: unknown): RunAnnouncements {
  if (!value || typeof value !== 'object') return NO_RUN_ANNOUNCEMENTS;
  const raw = value as Record<string, unknown>;
  if (
    raw.version !== RUN_ANNOUNCEMENTS_VERSION ||
    !['off', 'distance', 'time'].includes(String(raw.trigger)) ||
    typeof raw.interval !== 'number' ||
    !Number.isFinite(raw.interval) ||
    raw.interval < 1 ||
    raw.interval > (raw.trigger === 'distance' ? 10 : 60) ||
    ![
      'kilometer',
      'distance',
      'lastKilometerPace',
      'averagePace',
      'heartRate',
    ].every(key => typeof raw[key] === 'boolean')
  )
    return NO_RUN_ANNOUNCEMENTS;
  return raw as unknown as RunAnnouncements;
}

/** Setup when progress announcements are switched on for the first time. */
export const DEFAULT_RUN_ANNOUNCEMENTS: RunAnnouncements = {
  ...NO_RUN_ANNOUNCEMENTS,
  trigger: 'distance',
};

/**
 * Progress announcements are a setting of their own, not part of the run goal:
 * a switch, plus the setup that is kept while the switch is off. The setup's
 * trigger is never `off`. Older versions stored the announcements in
 * `runTarget.announcements`; as long as nothing is stored here, that choice
 * is taken over.
 */
export interface RunAnnouncementSettings {
  on: boolean;
  setup: RunAnnouncements;
}

export function normalizeRunAnnouncementSettings(
  stored: unknown,
  legacy?: unknown,
): RunAnnouncementSettings {
  if (stored && typeof stored === 'object') {
    const raw = stored as Record<string, unknown>;
    const setup = normalizeRunAnnouncements(raw.setup);
    if (typeof raw.on === 'boolean' && setup.trigger !== 'off')
      return { on: raw.on, setup };
  }
  const old = normalizeRunAnnouncements(legacy);
  return old.trigger === 'off'
    ? { on: false, setup: DEFAULT_RUN_ANNOUNCEMENTS }
    : { on: true, setup: old };
}

/** "Every kilometer", "Every 2.5 km", "Every 10 minutes". */
export function runAnnouncementsLabel(setup: RunAnnouncements): string {
  const value = Number.isInteger(setup.interval)
    ? String(setup.interval)
    : fixed(setup.interval, 2).replace(/0$/, '');
  if (setup.trigger === 'time')
    return setup.interval === 1
      ? tr('Jede Minute', 'Every minute')
      : tr(`Alle ${value} Minuten`, `Every ${value} minutes`);
  return setup.interval === 1
    ? tr('Jeden Kilometer', 'Every kilometer')
    : tr(`Alle ${value} km`, `Every ${value} km`);
}
