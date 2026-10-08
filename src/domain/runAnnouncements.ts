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
