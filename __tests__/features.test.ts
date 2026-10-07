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
  recommendationsShown,
  recommendationsSuggested,
  shouldPromptSoreness,
  visibleHomeSections,
  visibleTabs,
  withArea,
} from '../src/domain/features';

const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;
// Ein Mittwoch, 12:00 Ortszeit — so liegen „heute“, „diese Woche“ und
// Wochentage fest, ohne von der Uhr der Testmaschine abzuhängen.
const NOW = new Date(2026, 8, 16, 12, 0, 0).getTime();
const finished = (endedAgoMs: number) => ({
  status: 'finished' as const,
  startTime: NOW - endedAgoMs - HOUR,
  endTime: NOW - endedAgoMs,
});

describe('normalizeFeatures', () => {
  it('vibriert am Pausenende standardmäßig, spielt aber keinen Ton', () => {
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

  it('liefert den Standard für fehlende oder kaputte Eingaben', () => {
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

  it('übernimmt gültige Werte und wirft unbekannte Listeneinträge weg', () => {
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

  it('lässt nicht beide Bereiche aus', () => {
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

  it('übernimmt den alten Herzfrequenz-Schalter nur ohne gespeicherte Funktionen', () => {
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

describe('Ableitungen', () => {
  it('nimmt abgeschalteten Funktionen ihre Blöcke und Tabs', () => {
    const f = normalizeFeatures({
      areas: { running: true, strength: false },
      planning: { enabled: false },
      soreness: { enabled: false },
      recommendations: { running: 'off', strength: 'suggest' },
    });
    expect(visibleTabs(f)).toEqual(['Heute', 'Coach', 'Verlauf']);
    expect(availableHomeSections(f)).toEqual(['goal', 'recent']);
    expect(visibleHomeSections(f)).toEqual(availableHomeSections(f));
    expect(recommendationsShown(f, 'running')).toBe(false);
    expect(recommendationsShown(f, 'strength')).toBe(false);
    // Die Zielnähe gehört zum Laufen: ohne den Bereich verschwindet der Block.
    expect(
      availableHomeSections(
        normalizeFeatures({ areas: { running: false, strength: true } }),
      ),
    ).not.toContain('goal');
  });

  it('unterscheidet Vorschlagen von Nur auf Nachfrage', () => {
    const f = normalizeFeatures({
      recommendations: { running: 'on_request' },
    });
    expect(recommendationsShown(f, 'running')).toBe(true);
    expect(recommendationsSuggested(f, 'running')).toBe(false);
    expect(visibleHomeSections(f)).toContain('recommendation');
    const quiet = normalizeFeatures({
      recommendations: { running: 'on_request', strength: 'off' },
    });
    expect(visibleHomeSections(quiet)).not.toContain('recommendation');
  });

  it('achtet die Auswahl der Heute-Blöcke', () => {
    const f = normalizeFeatures({ home: { sections: ['recent'] } });
    expect(visibleHomeSections(f)).toEqual(['recent']);
  });

  it('nennt nur eingeschaltete Sportarten', () => {
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

  it('fragt nie, wenn Muskelkater aus ist oder „nie“ gewählt wurde', () => {
    expect(
      shouldPromptSoreness(withPrompt('daily', false), [], [], [], NOW),
    ).toBe(false);
    expect(shouldPromptSoreness(withPrompt('never'), [], [], [], NOW)).toBe(
      false,
    );
  });

  it('täglich: nur ohne Meldung von heute', () => {
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

  it('nach Krafttraining: 8 bis 72 Stunden nach einer Einheit, einmal je Einheit', () => {
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
    // Schon gemeldet nach dieser Einheit → Ruhe.
    expect(
      shouldPromptSoreness(
        f,
        [{ at: NOW - 10 * HOUR }],
        [finished(20 * HOUR)],
        [],
        NOW,
      ),
    ).toBe(false);
    // Laufende Einheit zählt nicht.
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

  it('an Trainingstagen: nur wenn heute einer ist', () => {
    const f = withPrompt('training_days');
    const today = new Date(NOW).getDay();
    expect(shouldPromptSoreness(f, [], [], [today], NOW)).toBe(true);
    expect(shouldPromptSoreness(f, [], [], [(today + 1) % 7], NOW)).toBe(false);
    expect(
      shouldPromptSoreness(f, [{ at: NOW - HOUR }], [], [today], NOW),
    ).toBe(false);
  });

  it('wöchentlich: einmal je Kalenderwoche ab Montag', () => {
    const f = withPrompt('weekly');
    expect(shouldPromptSoreness(f, [], [], [], NOW)).toBe(true);
    // Montag dieser Woche liegt zwei Tage zurück; eine Meldung von Dienstag reicht.
    expect(shouldPromptSoreness(f, [{ at: NOW - DAY }], [], [], NOW)).toBe(
      false,
    );
    // Eine Meldung vom Sonntag davor zählt nicht mehr.
    expect(shouldPromptSoreness(f, [{ at: NOW - 3 * DAY }], [], [], NOW)).toBe(
      true,
    );
  });
});

describe('Funktionen und Navigation v2', () => {
  it('migriert alte Einstellungen ohne abgeschaltete Funktionen wieder einzuschalten', () => {
    const f = normalizeFeatures({
      version: 1,
      planning: { enabled: false },
      recording: { routes: false },
      recommendations: { running: 'off' },
    });
    expect(f.version).toBe(FEATURES_VERSION);
    expect(f.coach.enabled).toBe(true);
    expect(f.planning.enabled).toBe(false);
    expect(f.recording.routes).toBe(false);
    expect(f.recommendations.running).toBe('off');
    expect(visibleTabs(f)).toEqual(['Heute', 'Coach', 'Verlauf']);
  });
  it('normalisiert Plätze ohne ihre Reihenfolge zu verlieren', () => {
    const f = normalizeFeatures({
      navigation: {
        tabs: ['Routen', 'Statistik', 'Routen', 'Heute', 'Coach', 'garbage'],
      },
    });
    expect(f.navigation.tabs).toEqual(['Routen', 'Statistik']);
    expect(visibleTabs(f)).toEqual(['Heute', 'Routen', 'Statistik', 'Verlauf']);
    expect(
      normalizeFeatures({ navigation: { tabs: [] } }).navigation.tabs,
    ).toEqual([]);
  });
  it('trennt aktive Funktionen von ihren Plätzen und lässt leere Plätze frei', () => {
    const f = withFeature(
      withFeature(normalizeFeatures(undefined), 'coach', false),
      'planning',
      false,
    );
    expect(visibleTabs(f)).toEqual(['Heute', 'Verlauf']);
    const enabled = withFeature(f, 'coach', true);
    expect(enabled.coach.enabled).toBe(true);
    expect(visibleTabs(enabled)).toEqual(['Heute', 'Verlauf']);
    const pinned = withNavigation(enabled, ['Statistik', 'Routen']);
    expect(visibleTabs(pinned)).toEqual([
      'Heute',
      'Statistik',
      'Routen',
      'Verlauf',
    ]);
    expect(withNavigation(pinned, []).statistics.enabled).toBe(true);
  });
  it('behält Ziele, Fokusmodi und gespeicherte Anzeigeoptionen ohne Coach', () => {
    const f = withFeature(normalizeFeatures(undefined), 'coach', false);
    expect(recommendationsShown(f, 'running')).toBe(false);
    expect(recommendationsShown(f, 'strength')).toBe(false);
    expect(recommendationsSuggested(f, 'running')).toBe(false);
    expect(availableHomeSections(f)).not.toContain('recommendation');
    expect(availableHomeSections(f)).toContain('goal');
    expect(f.recommendations.running).toBe('suggest');
    expect(withFeature(f, 'coach', true).recommendations.running).toBe(
      'suggest',
    );
  });
  it('lässt Vorlagen ohne Planung und Statistik ohne Coach nutzen', () => {
    const f = normalizeFeatures({
      planning: { enabled: false },
      coach: { enabled: false },
    });
    expect(availableTabs(f)).toEqual([
      'Statistik',
      'Routen',
      'Vorlagen',
      'Muskelkater',
    ]);
    expect(featureEnabled(f, 'templates')).toBe(true);
  });
  it('verhindert inaktive, doppelte und zusätzliche Tab-Ziele', () => {
    const f = normalizeFeatures({
      areas: { running: false, strength: true },
      statistics: { enabled: false },
      soreness: { enabled: false },
    });
    expect(
      withNavigation(f, [
        'Routen',
        'Statistik',
        'Muskelkater',
        'Vorlagen',
        'Vorlagen',
        'Coach',
        'Plan',
      ]).navigation.tabs,
    ).toEqual(['Vorlagen', 'Coach']);
    expect(featureEnabled(f, 'routes')).toBe(false);
  });
  it('blendet Zielnähe nur über den unabhängigen Zielschalter aus', () => {
    const f = withFeature(normalizeFeatures(undefined), 'goals', false);
    expect(availableHomeSections(f)).not.toContain('goal');
    expect(recommendationsShown(f, 'running')).toBe(true);
  });
});
