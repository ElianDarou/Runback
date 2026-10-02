import {
  WEAR_LIVE_SILENCE_MS,
  wearRecordingLink,
} from '../src/domain/wearLink';

const now = 1_000_000;
const run = { id: 'run-1', status: 'recording' };
const connected = (lastCommand: unknown) => ({
  status: 'connected',
  connected: true,
  lastCommand,
});

it('says nothing while the status is unknown or Wear OS is missing', () => {
  expect(wearRecordingLink(null, run, now)).toBeNull();
  expect(wearRecordingLink({}, run, now)).toBeNull();
  expect(
    wearRecordingLink({ status: 'unavailable', connected: false }, run, now),
  ).toBeNull();
});

it('reports a missing watch as disconnected', () => {
  expect(
    wearRecordingLink(
      { status: 'disconnected', connected: false, lastCommand: null },
      run,
      now,
    ),
  ).toBe('disconnected');
});

it('waits until the watch answers for this run', () => {
  expect(wearRecordingLink(connected(null), run, now)).toBe('waiting');
  for (const status of ['sent', 'pending', 'queued', 'retry', 'disconnected']) {
    expect(
      wearRecordingLink(
        connected({ status, runId: 'run-1', updatedAt: now }),
        run,
        now,
      ),
    ).toBe('waiting');
  }
  // Eine Bestätigung für einen früheren Lauf zählt nicht.
  expect(
    wearRecordingLink(
      connected({ status: 'live', runId: 'old', lastLiveAt: now }),
      run,
      now,
    ),
  ).toBe('waiting');
});

it('counts a fresh confirmation or fresh watch data as recording', () => {
  expect(
    wearRecordingLink(
      connected({ status: 'accepted', runId: 'run-1', updatedAt: now - 1000 }),
      run,
      now,
    ),
  ).toBe('recording');
  expect(
    wearRecordingLink(
      connected({ status: 'live', runId: 'run-1', lastLiveAt: now - 1000 }),
      run,
      now,
    ),
  ).toBe('recording');
});

it('flags a silent watch only while the phone is recording', () => {
  const stale = now - WEAR_LIVE_SILENCE_MS - 1;
  const live = connected({ status: 'live', runId: 'run-1', lastLiveAt: stale });
  expect(wearRecordingLink(live, run, now)).toBe('silent');
  expect(
    wearRecordingLink(
      connected({ status: 'accepted', runId: 'run-1', updatedAt: stale }),
      run,
      now,
    ),
  ).toBe('silent');
  expect(
    wearRecordingLink(connected({ status: 'live', runId: 'run-1' }), run, now),
  ).toBe('silent');
  expect(wearRecordingLink(live, { ...run, status: 'paused' }, now)).toBe(
    'recording',
  );
});

it('reports a rejected command as failed', () => {
  expect(
    wearRecordingLink(
      connected({ status: 'error', runId: 'run-1', updatedAt: now }),
      run,
      now,
    ),
  ).toBe('failed');
});
