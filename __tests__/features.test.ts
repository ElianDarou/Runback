import {
  DEFAULT_FEATURES,
  FEATURES_VERSION,
  featureEnabled,
  availableTabs,
  withFeature,
  withNavigation,
  availableHomeSections,
  enabledSports,
  normalizeFeatures,
  shouldPromptSoreness,
  visibleHomeSections,
  visibleTabs,
  withArea,
} from '../src/domain/features';

const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;
// A Wednesday, 12:00 local time — so that “today”, “this week” and
// weekdays are fixed, without depending on the test machine's clock.
const NOW = new Date(2026, 8, 16, 12, 0, 0).getTime();
const finished = (endedAgoMs: number) => ({
  status: 'finished' as const,
  startTime: NOW - endedAgoMs - HOUR,
  endTime: NOW - endedAgoMs,
});

describe('normalizeFeatures', () => {
  it('vibrates at the end of a rest by default but plays no sound', () => {
    expect(normalizeFeatures(undefined).strength).toMatchObject({
      restVibration: true,
      restSound: false,
    });
    const chosen = normalizeFeatures({
      strength: { restVibration: false, restSound: true },
    });
    expect(chosen.strength.restVibration).toBe(false);
    expect(chosen.strength.restSound).toBe(true);
    expect(
      normalizeFeatures({ strength: { restSound: 'ja' } }).strength.restSound,
    ).toBe(false);
  });

  it('speaks the rest end only when switched on', () => {
    expect(normalizeFeatures(undefined).strength.restVoice).toBe(false);
    expect(
      normalizeFeatures({ strength: { restVoice: true } }).strength.restVoice,
    ).toBe(true);
    expect(
      normalizeFeatures({ strength: { restVoice: 'ja' } }).strength.restVoice,
    ).toBe(false);
  });

  it('returns the default for missing or broken input', () => {
    expect(normalizeFeatures(undefined)).toEqual(DEFAULT_FEATURES);
    expect(normalizeFeatures('unsinn')).toEqual(DEFAULT_FEATURES);
    expect(normalizeFeatures({ soreness: { prompt: 'jedeStunde' } })).toEqual(
      DEFAULT_FEATURES,
    );
    expect(
      normalizeFeatures({ strength: { defaultRestSeconds: 99999 } }).strength
        .defaultRestSeconds,
    ).toBe(120);
  });

  it('takes over valid values and drops unknown list entries', () => {
    const next = normalizeFeatures({
      soreness: { enabled: false, prompt: 'weekly' },
      home: { sections: ['recent', 'unbekannt', 'week'] },
      statistics: { modules: ['records'] },
      strength: { defaultRestSeconds: 90 },
    });
    expect(next.soreness.enabled).toBe(false);
    expect(next.soreness.prompt).toBe('weekly');
    expect(next.home.sections).toEqual(['week', 'recent']);
    expect(next.statistics.modules).toEqual(['records']);
    expect(next.strength.defaultRestSeconds).toBe(90);
  });

  it('does not leave out both areas', () => {
    expect(
      normalizeFeatures({ areas: { running: false, strength: false } }).areas,
    ).toEqual({ running: true, strength: true });
    const strengthOnly = normalizeFeatures({
      areas: { running: false, strength: true },
    });
    expect(withArea(strengthOnly, 'strength', false)).toBe(strengthOnly);
    expect(withArea(strengthOnly, 'running', true).areas).toEqual({
      running: true,
      strength: true,
    });
  });

  it('takes over the old heart rate switch only without saved features', () => {
    expect(
      normalizeFeatures(undefined, { showHeartRate: true }).recording.metrics,
    ).toContain('heartRate');
    expect(
      normalizeFeatures(
        { recording: { metrics: ['distance'] } },
        {
          showHeartRate: true,
        },
      ).recording.metrics,
    ).toEqual(['distance']);
  });
});

describe('Derivations', () => {
  it('removes the blocks and tabs of switched-off features', () => {
    const f = normalizeFeatures({
      areas: { running: true, strength: false },
      planning: { enabled: false },
      soreness: { enabled: false },
    });
    expect(visibleTabs(f)).toEqual(['today', 'statistics', 'history']);
    expect(availableHomeSections(f)).toEqual(['goal', 'recent']);
    expect(visibleHomeSections(f)).toEqual(availableHomeSections(f));
    // Goal progress belongs to running: without the area the block disappears.
    expect(
      availableHomeSections(
        normalizeFeatures({ areas: { running: false, strength: true } }),
      ),
    ).not.toContain('goal');
  });

  it('respects the selection of the Today blocks', () => {
    const f = normalizeFeatures({ home: { sections: ['recent'] } });
    expect(visibleHomeSections(f)).toEqual(['recent']);
  });

  it('names only switched-on sports', () => {
    expect(enabledSports(DEFAULT_FEATURES)).toEqual(['running', 'cycling']);
    expect(
      enabledSports(normalizeFeatures({ sports: { cycling: false } })),
    ).toEqual(['running']);
    expect(
      enabledSports(
        normalizeFeatures({ areas: { running: false, strength: true } }),
      ),
    ).toEqual(['cycling']);
  });
});

describe('shouldPromptSoreness', () => {
  const withPrompt = (prompt: string, enabled = true) =>
    normalizeFeatures({ soreness: { prompt, enabled } });

  it('never asks when soreness is off or “never” was chosen', () => {
    expect(
      shouldPromptSoreness(withPrompt('daily', false), [], [], [], NOW),
    ).toBe(false);
    expect(shouldPromptSoreness(withPrompt('never'), [], [], [], NOW)).toBe(
      false,
    );
  });

  it('daily: only without a report from today', () => {
    expect(shouldPromptSoreness(withPrompt('daily'), [], [], [], NOW)).toBe(
      true,
    );
    expect(
      shouldPromptSoreness(
        withPrompt('daily'),
        [{ at: NOW - HOUR }],
        [],
        [],
        NOW,
      ),
    ).toBe(false);
    expect(
      shouldPromptSoreness(
        withPrompt('daily'),
        [{ at: NOW - DAY }],
        [],
        [],
        NOW,
      ),
    ).toBe(true);
  });

  it('after strength training: 8 to 72 hours after a session, once per session', () => {
    const f = withPrompt('after_strength');
    expect(shouldPromptSoreness(f, [], [], [], NOW)).toBe(false);
    expect(shouldPromptSoreness(f, [], [finished(2 * HOUR)], [], NOW)).toBe(
      false,
    );
    expect(shouldPromptSoreness(f, [], [finished(20 * HOUR)], [], NOW)).toBe(
      true,
    );
    expect(shouldPromptSoreness(f, [], [finished(80 * HOUR)], [], NOW)).toBe(
      false,
    );
    // Already reported after this session → quiet.
    expect(
      shouldPromptSoreness(
        f,
        [{ at: NOW - 10 * HOUR }],
        [finished(20 * HOUR)],
        [],
        NOW,
      ),
    ).toBe(false);
    // A session in progress does not count.
    expect(
      shouldPromptSoreness(
        f,
        [],
        [{ ...finished(20 * HOUR), status: 'active' }],
        [],
        NOW,
      ),
    ).toBe(false);
  });

  it('on training days: only when today is one', () => {
    const f = withPrompt('training_days');
    const today = new Date(NOW).getDay();
    expect(shouldPromptSoreness(f, [], [], [today], NOW)).toBe(true);
    expect(shouldPromptSoreness(f, [], [], [(today + 1) % 7], NOW)).toBe(false);
    expect(
      shouldPromptSoreness(f, [{ at: NOW - HOUR }], [], [today], NOW),
    ).toBe(false);
  });

  it('weekly: once per calendar week starting Monday', () => {
    const f = withPrompt('weekly');
    expect(shouldPromptSoreness(f, [], [], [], NOW)).toBe(true);
    // Monday of this week is two days back; a report from Tuesday is enough.
    expect(shouldPromptSoreness(f, [{ at: NOW - DAY }], [], [], NOW)).toBe(
      false,
    );
    // A report from the Sunday before no longer counts.
    expect(shouldPromptSoreness(f, [{ at: NOW - 3 * DAY }], [], [], NOW)).toBe(
      true,
    );
  });
});

describe('Features and navigation v2', () => {
  it('migrates old settings without switching features back on', () => {
    const f = normalizeFeatures({
      version: 1,
      planning: { enabled: false },
      recording: { routes: false },
    });
    expect(f.version).toBe(FEATURES_VERSION);
    expect(f.planning.enabled).toBe(false);
    expect(f.recording.routes).toBe(false);
    expect(visibleTabs(f)).toEqual(['today', 'statistics', 'history']);
  });
  it('drops the removed Coach and puts Statistics in its pinned slot', () => {
    const f = normalizeFeatures({
      version: 3,
      coach: { enabled: true },
      recommendations: { running: 'suggest', strength: 'off' },
      home: { sections: ['week', 'recommendation', 'recent'] },
      navigation: { tabs: ['plan', 'coach'] },
    });
    expect(f).not.toHaveProperty('coach');
    expect(f).not.toHaveProperty('recommendations');
    expect(f.home.sections).toEqual(['week', 'recent']);
    expect(f.navigation.tabs).toEqual(['plan', 'statistics']);
    expect(
      normalizeFeatures({ navigation: { tabs: ['statistics', 'coach'] } })
        .navigation.tabs,
    ).toEqual(['statistics']);
  });
  it('normalizes slots without losing their order', () => {
    const f = normalizeFeatures({
      navigation: {
        tabs: ['Routen', 'Statistik', 'Routen', 'Heute', 'Coach', 'garbage'],
      },
    });
    expect(f.navigation.tabs).toEqual(['routes', 'statistics']);
    expect(visibleTabs(f)).toEqual(['today', 'routes', 'statistics', 'history']);
    expect(
      normalizeFeatures({ navigation: { tabs: [] } }).navigation.tabs,
    ).toEqual([]);
  });
  it('separates active features from their slots and leaves empty slots free', () => {
    const f = withFeature(
      withFeature(normalizeFeatures(undefined), 'statistics', false),
      'planning',
      false,
    );
    expect(visibleTabs(f)).toEqual(['today', 'history']);
    const enabled = withFeature(f, 'statistics', true);
    expect(enabled.statistics.enabled).toBe(true);
    expect(visibleTabs(enabled)).toEqual(['today', 'history']);
    const pinned = withNavigation(enabled, ['statistics', 'routes']);
    expect(visibleTabs(pinned)).toEqual([
      'today',
      'statistics',
      'routes',
      'history',
    ]);
    expect(withNavigation(pinned, []).statistics.enabled).toBe(true);
  });
  it('lets templates be used without planning', () => {
    const f = normalizeFeatures({
      planning: { enabled: false },
    });
    expect(availableTabs(f)).toEqual([
      'statistics',
      'routes',
      'templates',
      'soreness',
    ]);
    expect(featureEnabled(f, 'templates')).toBe(true);
  });
  it('prevents inactive, duplicate and extra tab targets', () => {
    const f = normalizeFeatures({
      areas: { running: false, strength: true },
      statistics: { enabled: false },
      soreness: { enabled: false },
    });
    expect(
      withNavigation(f, [
        'routes',
        'statistics',
        'soreness',
        'templates',
        'templates',
        'plan',
      ]).navigation.tabs,
    ).toEqual(['templates', 'plan']);
    expect(featureEnabled(f, 'routes')).toBe(false);
  });
  it('hides goal progress only via its independent goal switch', () => {
    const f = withFeature(normalizeFeatures(undefined), 'goals', false);
    expect(availableHomeSections(f)).not.toContain('goal');
    expect(availableHomeSections(f)).toContain('week');
  });
});


describe('optional music', () => {
  it('stays off for new and existing users and takes no navigation slot', () => {
    const defaults = normalizeFeatures(undefined);
    expect(defaults.music.enabled).toBe(false);
    expect(normalizeFeatures({ version: 2 }).music.enabled).toBe(false);
    const music = withFeature(defaults, 'music', true);
    expect(featureEnabled(music, 'music')).toBe(true);
    expect(availableTabs(music)).toEqual(availableTabs(defaults));
    expect(withFeature(music, 'music', false).music.enabled).toBe(false);
  });
});
