import {
  DEFAULT_RUN_ANNOUNCEMENTS,
  NO_RUN_ANNOUNCEMENTS,
  normalizeRunAnnouncementSettings,
  normalizeRunAnnouncements,
  runAnnouncementsLabel,
} from '../src/domain/runAnnouncements';
import { setLanguage } from '../src/domain/i18n';
import { normalizeRunTarget, runTargetForStart } from '../src/domain/runTarget';
it('requires explicit complete settings and keeps every spoken metric optional', () => {
  expect(normalizeRunAnnouncements({ trigger: 'time' }).trigger).toBe('off');
  const settings = {
    ...NO_RUN_ANNOUNCEMENTS,
    trigger: 'time',
    interval: 10,
    distance: false,
  };
  expect(normalizeRunAnnouncements(settings)).toEqual(settings);
  expect(normalizeRunAnnouncements({ ...settings, interval: 0 }).trigger).toBe(
    'off',
  );
  expect(
    normalizeRunAnnouncements({ ...settings, interval: NaN }).trigger,
  ).toBe('off');
  expect(
    normalizeRunAnnouncements({ ...settings, heartRate: undefined }).trigger,
  ).toBe('off');
});
it('transports announcements without a pace target and preserves legacy target versions', () => {
  const announcements = {
    ...NO_RUN_ANNOUNCEMENTS,
    trigger: 'distance' as const,
  };
  expect(
    normalizeRunTarget({
      kind: 'none',
      version: 2,
      announcements,
      cueIntervalSeconds: 5,
    }),
  ).toMatchObject({ kind: 'none', announcements, cueIntervalSeconds: 5 });
  expect(
    normalizeRunTarget({
      kind: 'pace',
      version: 1,
      secondsPerKm: 330,
      mode: 'range',
      output: 'both',
    }).version,
  ).toBe(1);
  expect(
    normalizeRunTarget({
      kind: 'pace',
      version: 2,
      secondsPerKm: 330,
      mode: 'range',
      output: 'both',
      cueIntervalSeconds: 4,
    }).kind,
  ).toBe('none');
});

it('keeps the announcement setup while switched off and takes over an older choice once', () => {
  const minutes = {
    ...NO_RUN_ANNOUNCEMENTS,
    trigger: 'time' as const,
    interval: 5,
  };
  expect(normalizeRunAnnouncementSettings(undefined)).toEqual({
    on: false,
    setup: DEFAULT_RUN_ANNOUNCEMENTS,
  });
  expect(normalizeRunAnnouncementSettings(undefined, minutes)).toEqual({
    on: true,
    setup: minutes,
  });
  expect(
    normalizeRunAnnouncementSettings(
      { on: false, setup: minutes },
      {
        ...minutes,
        interval: 20,
      },
    ),
  ).toEqual({ on: false, setup: minutes });
  // A setup without a trigger is not a setup; the stored switch is ignored.
  expect(
    normalizeRunAnnouncementSettings({ on: true, setup: NO_RUN_ANNOUNCEMENTS }),
  ).toEqual({ on: false, setup: DEFAULT_RUN_ANNOUNCEMENTS });
});

it('sends announcements at start only while switched on, whatever the goal still carries', () => {
  const minutes = {
    ...NO_RUN_ANNOUNCEMENTS,
    trigger: 'time' as const,
    interval: 5,
  };
  const runTarget = {
    kind: 'none',
    version: 3,
    goal: { kind: 'distance', meters: 5000 },
    announcements: minutes,
  };
  const off = runTargetForStart({
    runTarget,
    runAnnouncements: { on: false, setup: minutes },
  });
  expect(off).not.toHaveProperty('announcements');
  expect(off.goal).toEqual({ kind: 'distance', meters: 5000 });
  expect(
    runTargetForStart({
      runTarget: { kind: 'none', version: 3 },
      runAnnouncements: { on: true, setup: DEFAULT_RUN_ANNOUNCEMENTS },
    }).announcements,
  ).toEqual(DEFAULT_RUN_ANNOUNCEMENTS);
  // Nothing stored yet: the older choice in the goal still applies.
  expect(runTargetForStart({ runTarget }).announcements).toEqual(minutes);
});

it('names the announcement interval in both languages', () => {
  setLanguage('de');
  expect(runAnnouncementsLabel(DEFAULT_RUN_ANNOUNCEMENTS)).toBe(
    'Jeden Kilometer',
  );
  expect(
    runAnnouncementsLabel({ ...DEFAULT_RUN_ANNOUNCEMENTS, interval: 2.5 }),
  ).toBe('Alle 2,5 km');
  setLanguage('en');
  expect(
    runAnnouncementsLabel({
      ...DEFAULT_RUN_ANNOUNCEMENTS,
      trigger: 'time',
      interval: 10,
    }),
  ).toBe('Every 10 minutes');
  setLanguage('de');
});
