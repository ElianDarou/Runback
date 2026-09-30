import {
  NO_RUN_ANNOUNCEMENTS,
  normalizeRunAnnouncements,
} from '../src/domain/runAnnouncements';
import { normalizeRunTarget } from '../src/domain/runTarget';
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
