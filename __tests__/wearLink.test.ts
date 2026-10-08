import {
  readStrengthWatchInfo,
  STRENGTH_WATCH_HEART_MS,
  STRENGTH_WATCH_SILENCE_MS,
  strengthWatchCaptureLabel,
  strengthWatchLive,
  strengthWatchTransfer,
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
  // A confirmation for an earlier run does not count.
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

describe('strength watch', () => {
  const info = (patch: Record<string, unknown> = {}) =>
    readStrengthWatchInfo({
      sessionId: 'session-1',
      status: 'recording',
      capture: { motion: false, heartRate: true },
      watch: { status: 'recording', updatedAt: now - 60_000 },
      ...patch,
    });

  it('reads nothing as no watch', () => {
    expect(readStrengthWatchInfo(null)).toBeNull();
    expect(readStrengthWatchInfo({ status: 'recording' })).toBeNull();
    expect(strengthWatchLive(null, now)).toBeNull();
    expect(strengthWatchTransfer(null)).toBeNull();
  });

  it('shows the live pulse only while it is fresh', () => {
    const live = (bpmAt: number) =>
      info({
        live: { receivedAt: now - 2_000, motion: false, bpm: 128, bpmAt },
      });
    expect(strengthWatchLive(live(now - 3_000), now)).toEqual({
      state: 'measuring',
      bpm: 128,
    });
    // An old pulse is not reported as current.
    expect(
      strengthWatchLive(live(now - STRENGTH_WATCH_HEART_MS - 1), now),
    ).toEqual({ state: 'measuring' });
  });

  it('keeps an unknown pulse unknown', () => {
    expect(
      strengthWatchLive(info({ live: { receivedAt: now - 1_000 } }), now),
    ).toEqual({ state: 'measuring' });
    // Older watches report nothing live.
    expect(strengthWatchLive(info(), now)).toEqual({ state: 'measuring' });
  });

  it('calls a watch silent when its live messages stop', () => {
    expect(
      strengthWatchLive(
        info({
          live: {
            receivedAt: now - STRENGTH_WATCH_SILENCE_MS - 1,
            bpm: 120,
            bpmAt: now - 30_000,
          },
        }),
        now,
      )?.state,
    ).toBe('silent');
  });

  it('separates starting, failed and disconnected', () => {
    expect(strengthWatchLive(info({ watch: { status: 'sent' } }), now)).toEqual(
      {
        state: 'starting',
      },
    );
    expect(
      strengthWatchLive(info({ watch: { status: 'waiting' } }), now),
    ).toEqual({ state: 'starting', hint: 'Öffne Runback auf der Uhr.' });
    expect(
      strengthWatchLive(
        info({
          watch: {
            status: 'error',
            message: 'Erlaube Runback auf der Uhr den Pulssensor.',
          },
        }),
        now,
      ),
    ).toEqual({
      state: 'failed',
      hint: 'Erlaube Runback auf der Uhr den Pulssensor.',
    });
    expect(
      strengthWatchLive(info({ watch: { status: 'disconnected' } }), now)
        ?.state,
    ).toBe('disconnected');
  });

  it('reports what reached the phone after the session', () => {
    expect(strengthWatchLive(info({ status: 'stopped' }), now)).toBeNull();
    expect(strengthWatchTransfer(info())).toBeNull();
    expect(strengthWatchTransfer(info({ status: 'stopped' }))).toBe('waiting');
    expect(
      strengthWatchTransfer(
        info({ status: 'received', file: { receivedAt: now, present: true } }),
      ),
    ).toBe('received');
    expect(
      strengthWatchTransfer(
        info({ status: 'stopped', watch: { status: 'error' } }),
      ),
    ).toBe('missing');
  });

  it('names what was requested from the watch', () => {
    expect(strengthWatchCaptureLabel(info()!)).toBe('Puls');
    expect(
      strengthWatchCaptureLabel(
        info({ capture: { motion: true, heartRate: true } })!,
      ),
    ).toBe('Puls und Bewegungen');
  });
});
