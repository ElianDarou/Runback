import React, { useState } from 'react';
import { Switch } from 'react-native';
import {
  FEATURE_CATALOG,
  featureEnabled,
  withFeature,
  withNavigation,
  pinnedTabs,
  availableTabs,
  visibleTabs,
  type FeatureId,
  type OptionalTab,
  AFTER_RUN_OPTIONS,
  RECOMMENDATION_MODES,
  RECORDING_PRIMARIES,
  REST_SECONDS_OPTIONS,
  SORENESS_PROMPTS,
  STATS_MODULES,
  afterRunLabel,
  homeSectionLabel,
  recommendationModeLabel,
  recordingPrimaryLabel,
  sorenessPromptLabel,
  statsModuleLabel,
  availableHomeSections,
  visibleHomeSections,
  withArea,
  tabLabel,
  type Area,
  type FeatureSettings as Features,
  type RecordingMetric,
  type StatsModule,
} from '../domain/features';
import { tr } from '../domain/i18n';
import {
  Button,
  Card,
  CheckRow,
  Segmented,
  Sheet,
  ChipGroup,
  Copy,
  Disclosure,
  Field,
  FeatureRow,
  Row,
  Section,
  Title,
  color,
} from './components';

/**
 * One page, one sentence per row: what Runback shows and when it asks.
 * Switching off takes effect at once and only hides; data stays. The row
 * names the feature, the subtitle shows the current value — no explanations.
 */
export function FeatureSettings({
  features,
  screen = 'main',
  disabled = false,
  onChange,
  onOpenHomeSections,
  onOpenNavigation,
  onOpenMain,
  onOpenDetails,
}: {
  features: Features;
  screen?:
    | 'main'
    | 'home'
    | 'navigation'
    | FeatureId
    | 'recording'
    | 'strength';
  disabled?: boolean;
  onChange: (next: Features) => void;
  onOpenHomeSections: () => void;
  onOpenNavigation: () => void;
  onOpenMain: () => void;
  onOpenDetails: (screen: FeatureId | 'recording' | 'strength') => void;
}) {
  const [replacement, setReplacement] = useState<OptionalTab | null>(null);
  const toggle = (
    label: string,
    value: boolean,
    change: (value: boolean) => void,
  ) => (
    <Switch
      accessibilityLabel={label}
      accessibilityRole="switch"
      accessibilityState={{ checked: value, disabled }}
      value={value}
      disabled={disabled}
      onValueChange={change}
      trackColor={{ false: color.line, true: color.green }}
      thumbColor={value ? color.ink : color.muted}
    />
  );
  const setArea = (area: Area, enabled: boolean) =>
    onChange(withArea(features, area, enabled));
  const patch = <K extends Exclude<keyof Features, 'version'>>(
    key: K,
    value: Partial<Features[K]>,
  ) =>
    onChange({
      ...features,
      [key]: { ...(features[key] as object), ...value },
    });
  const toggleIn = <T extends string>(list: T[], item: T, on: boolean) =>
    on ? [...list, item] : list.filter(entry => entry !== item);
  const hasMetric = (metric: RecordingMetric) =>
    features.recording.metrics.includes(metric);
  const setMetric = (metric: RecordingMetric, on: boolean) =>
    patch('recording', {
      metrics: toggleIn(features.recording.metrics, metric, on),
    });
  const hasModule = (module: StatsModule) =>
    features.statistics.modules.includes(module);
  const setModule = (module: StatsModule, on: boolean) =>
    patch('statistics', {
      modules: toggleIn(features.statistics.modules, module, on),
    });
  const running = features.areas.running;
  const strength = features.areas.strength;
  const recordsSomething = running || features.sports.cycling;

  if (screen === 'home') {
    const available = availableHomeSections(features);
    return (
      <>
        <Title>{tr('Blöcke auf Heute', 'Blocks on Today')}</Title>
        <Copy muted>
          {tr(
            'Die Startkarte bleibt immer; aktive Funktionen bleiben unter Alle Funktionen erreichbar.',
            'The start card always stays; active features stay reachable under All features.',
          )}
        </Copy>
        <Section title={tr('Sichtbar', 'Visible')}>
          {available.map(section => (
            <Row
              key={section}
              title={homeSectionLabel(section)}
              trailing={toggle(
                homeSectionLabel(section),
                features.home.sections.includes(section),
                value =>
                  patch('home', {
                    sections: toggleIn(features.home.sections, section, value),
                  }),
              )}
            />
          ))}
        </Section>
      </>
    );
  }

  const selected = pinnedTabs(features);
  const navigationTabs = (
    <Segmented
      label={tr('Einstellungen bearbeiten', 'Edit settings')}
      options={[
        { value: 'main', label: tr('Funktionen', 'Features') },
        { value: 'navigation', label: tr('Navigation', 'Navigation') },
      ]}
      value={screen === 'navigation' ? 'navigation' : 'main'}
      onChange={value => (value === 'main' ? onOpenMain() : onOpenNavigation())}
    />
  );
  if (screen === 'navigation') {
    const choose = (tab: OptionalTab, checked: boolean) => {
      if (!checked)
        onChange(
          withNavigation(
            features,
            selected.filter(item => item !== tab),
          ),
        );
      else if (selected.length < 2)
        onChange(withNavigation(features, [...selected, tab]));
      else setReplacement(tab);
    };
    return (
      <>
        <Title>{tr('Navigation', 'Navigation')}</Title>
        {navigationTabs}
        <Card>
          <Copy>{visibleTabs(features).join(' · ')}</Copy>
          <Copy muted>
            {tr(
              `${selected.length} von 2 eigenen Plätzen belegt.`,
              `${selected.length} of 2 own spots taken.`,
            )}
          </Copy>
        </Card>
        <Copy muted>
          {tr(
            'Heute und Verlauf bleiben fest; wähle bis zu zwei weitere Funktionen.',
            'Today and History stay fixed; choose up to two more features.',
          )}
        </Copy>
        <Section title={tr('In der Leiste', 'In the tab bar')}>
          {selected.length ? (
            selected.map((tab, index) => (
              <Row
                key={tab}
                title={tabLabel(tab)}
                subtitle={tr(`Platz ${index + 2}`, `Spot ${index + 2}`)}
                trailing={
                  <Button
                    secondary
                    small
                    title={tr(
                      `${tabLabel(tab)} entfernen`,
                      `Remove ${tabLabel(tab)}`,
                    )}
                    disabled={disabled}
                    onPress={() => choose(tab, false)}
                  />
                }
              />
            ))
          ) : (
            <Copy muted>{tr('Beide Plätze sind frei.', 'Both spots are free.')}</Copy>
          )}
          {selected.length === 2 ? (
            <Button
              secondary
              small
              title={tr('Reihenfolge tauschen', 'Swap order')}
              disabled={disabled}
              onPress={() =>
                onChange(withNavigation(features, [...selected].reverse()))
              }
            />
          ) : null}
        </Section>
        <Section title={tr('Aktive Funktionen', 'Active features')}>
          {availableTabs(features).map(tab => (
            <CheckRow
              key={tab}
              title={tabLabel(tab)}
              subtitle={
                selected.includes(tab)
                  ? tr('In der Leiste', 'In the tab bar')
                  : tr('Unter Alle Funktionen erreichbar', 'Reachable under All features')
              }
              checked={selected.includes(tab)}
              disabled={disabled}
              onToggle={checked => choose(tab, checked)}
            />
          ))}
        </Section>
        <Section title={tr('Ausgeschaltet', 'Turned off')}>
          {FEATURE_CATALOG.filter(
            entry => entry.tab && !featureEnabled(features, entry.id),
          ).map(entry => (
            <Row
              key={entry.id}
              title={entry.title}
              subtitle={tr(
                'Schalte die Funktion zuerst ein.',
                'Turn the feature on first.',
              )}
              onPress={() => onOpenDetails(entry.id)}
            />
          ))}
        </Section>
        <Sheet
          visible={replacement !== null}
          title={tr('Platz ersetzen', 'Replace spot')}
          onClose={() => setReplacement(null)}
        >
          <Copy muted>
            {tr(
              `Wähle den Platz für ${replacement ? tabLabel(replacement) : ''}; die ersetzte Funktion bleibt aktiv.`,
              `Choose the spot for ${replacement ? tabLabel(replacement) : ''}; the replaced feature stays active.`,
            )}
          </Copy>
          {selected.map(tab => (
            <Row
              key={tab}
              title={tr(`${tabLabel(tab)} ersetzen`, `Replace ${tabLabel(tab)}`)}
              disabled={disabled}
              onPress={() => {
                if (replacement)
                  onChange(
                    withNavigation(
                      features,
                      selected.map(item => (item === tab ? replacement : item)),
                    ),
                  );
                setReplacement(null);
              }}
            />
          ))}
        </Sheet>
      </>
    );
  }
  if (screen === 'main') {
    const functionRows = (ids: FeatureId[]) =>
      FEATURE_CATALOG.filter(entry => ids.includes(entry.id)).map(entry => {
        const enabled = featureEnabled(features, entry.id);
        return (
          <React.Fragment key={entry.id}>
            <FeatureRow
              title={entry.title}
              disabled={disabled}
              onPress={() => onOpenDetails(entry.id)}
              subtitle={`${
                entry.id === 'routes' && !running
                  ? tr('Laufen aus', 'Running off')
                  : enabled
                  ? tr('An', 'On')
                  : tr('Aus', 'Off')
              } · ${
                enabled && entry.tab && selected.includes(entry.tab)
                  ? tr('In der Leiste', 'In the tab bar')
                  : enabled
                  ? tr('Unter Alle Funktionen', 'In All features')
                  : entry.description
              }`}
              trailing={
                <Switch
                  accessibilityLabel={tr(
                    `${entry.title} einschalten`,
                    `Turn on ${entry.title}`,
                  )}
                  accessibilityState={{
                    checked: enabled,
                    disabled: disabled || (entry.id === 'routes' && !running),
                  }}
                  value={enabled}
                  disabled={disabled || (entry.id === 'routes' && !running)}
                  onValueChange={value =>
                    onChange(withFeature(features, entry.id, value))
                  }
                  trackColor={{ false: color.line, true: color.green }}
                  thumbColor={enabled ? color.ink : color.muted}
                />
              }
            />
          </React.Fragment>
        );
      });
    return (
      <>
        <Title>{tr('Funktionen', 'Features')}</Title>
        {navigationTabs}
        <Copy muted>
          {tr(
            'Schalte ein, was du nutzen möchtest; deine Daten bleiben erhalten.',
            'Turn on what you want to use; your data stays.',
          )}
        </Copy>
        <Section title={tr('Training begleiten', 'Support training')}>
          {functionRows(['coach', 'planning', 'goals'])}
        </Section>
        <Section title={tr('Auswerten und vorbereiten', 'Analyze and prepare')}>
          {functionRows(['statistics', 'routes', 'templates', 'soreness'])}
        </Section>
        <Section title={tr('Bereiche', 'Areas')}>
          <Row
            title={tr('Laufen', 'Running')}
            trailing={toggle(tr('Laufen', 'Running'), running, value =>
              setArea('running', value),
            )}
          />
          <Row
            title={tr('Krafttraining', 'Strength training')}
            trailing={toggle(tr('Krafttraining', 'Strength training'), strength, value =>
              setArea('strength', value),
            )}
          />
          <Row
            title={tr('Radfahren in der Auswahl', 'Offer cycling')}
            trailing={toggle(
              tr('Radfahren in der Auswahl', 'Offer cycling'),
              features.sports.cycling,
              value => patch('sports', { cycling: value }),
            )}
          />
          <Copy muted>{tr('Ein Bereich bleibt immer an.', 'One area always stays on.')}</Copy>
        </Section>
        <Section title={tr('Anzeige und Training', 'Display and training')}>
          <Row
            title={tr('Heute gestalten', 'Customize Today')}
            subtitle={tr(
              `${visibleHomeSections(features).length} Blöcke sichtbar`,
              `${visibleHomeSections(features).length} ${
                visibleHomeSections(features).length === 1 ? 'block' : 'blocks'
              } visible`,
            )}
            onPress={onOpenHomeSections}
          />
          {recordsSomething ? (
            <Row
              title={tr('Aufzeichnung', 'Recording')}
              subtitle={tr('Kennzahlen und Laufvorgaben', 'Metrics and run targets')}
              onPress={() => onOpenDetails('recording')}
            />
          ) : null}
          {strength ? (
            <Row
              title={tr('Krafttraining einstellen', 'Set up strength training')}
              subtitle={tr('Pausen und Satzangaben', 'Rest and set details')}
              onPress={() => onOpenDetails('strength')}
            />
          ) : null}
        </Section>
      </>
    );
  }
  const entry = FEATURE_CATALOG.find(item => item.id === screen);
  return (
    <>
      <Title>
        {entry?.title ??
          (screen === 'recording'
            ? tr('Aufzeichnung', 'Recording')
            : tr('Krafttraining', 'Strength training'))}
      </Title>
      {entry && !(entry.id === 'routes' && !running) ? (
        <Row
          title={entry.title}
          subtitle={
            featureEnabled(features, entry.id) ? tr('An', 'On') : tr('Aus', 'Off')
          }
          trailing={toggle(
            entry.title,
            featureEnabled(features, entry.id),
            value => onChange(withFeature(features, entry.id, value)),
          )}
        />
      ) : null}
      {entry && !featureEnabled(features, entry.id) ? (
        <Copy muted>
          {entry.id === 'routes' && !running
            ? tr(
                'Schalte Laufen ein, um Routen zu nutzen.',
                'Turn on running to use routes.',
              )
            : tr(
                'Schalte die Funktion ein, um ihre Details zu bearbeiten.',
                'Turn on the feature to edit its details.',
              )}
        </Copy>
      ) : null}
      {screen === 'soreness' && features.soreness.enabled ? (
        <Section title={tr('Muskelkater', 'Soreness')}>
          {features.soreness.enabled ? (
            <>
              <Field label={tr('Wann Runback fragt', 'When Runback asks')}>
                <ChipGroup
                  label={tr(
                    'Wann Runback nach Muskelkater fragt',
                    'When Runback asks about soreness',
                  )}
                  options={SORENESS_PROMPTS.map(value => ({
                    value,
                    label: sorenessPromptLabel(value),
                  }))}
                  value={features.soreness.prompt}
                  onChange={prompt => patch('soreness', { prompt })}
                  disabled={disabled}
                />
              </Field>
              <Row
                title={tr('Muskelkarte', 'Soreness map')}
                subtitle={tr(
                  'Gemeldeter Muskelkater und Frische je Region',
                  'Reported soreness and freshness per region',
                )}
                trailing={toggle(
                  tr('Muskelkarte', 'Soreness map'),
                  features.soreness.map,
                  value => patch('soreness', { map: value }),
                )}
              />
              <Row
                title={tr('Spracheingabe beim Melden', 'Voice input when reporting')}
                subtitle={tr(
                  'Mikrofon in der Muskelkater-Erfassung',
                  'Microphone in soreness logging',
                )}
                trailing={toggle(
                  tr('Spracheingabe beim Melden', 'Voice input when reporting'),
                  features.soreness.voice,
                  value => patch('soreness', { voice: value }),
                )}
              />
            </>
          ) : null}
        </Section>
      ) : null}
      {screen === 'planning' && features.planning.enabled ? (
        <Section title={tr('Planung', 'Planning')}>
          {features.planning.enabled ? (
            <>
              <Row
                title={tr('Woche vorschlagen', 'Suggest week')}
                trailing={toggle(
                  tr('Woche vorschlagen', 'Suggest week'),
                  features.planning.suggest,
                  value => patch('planning', { suggest: value }),
                )}
              />
              <Row
                title={tr('Monatsansicht', 'Month view')}
                trailing={toggle(
                  tr('Monatsansicht', 'Month view'),
                  features.planning.month,
                  value => patch('planning', { month: value }),
                )}
              />
            </>
          ) : null}
        </Section>
      ) : null}
      <>
        {screen === 'coach' && features.coach.enabled ? (
          <Disclosure
            defaultOpen
            title={tr('Empfehlungen', 'Recommendations')}
            subtitle={[
              running
                ? tr(
                    `Laufen: ${recommendationModeLabel(features.recommendations.running)}`,
                    `Running: ${recommendationModeLabel(features.recommendations.running)}`,
                  )
                : '',
              strength
                ? tr(
                    `Kraft: ${recommendationModeLabel(features.recommendations.strength)}`,
                    `Strength: ${recommendationModeLabel(features.recommendations.strength)}`,
                  )
                : '',
            ]
              .filter(Boolean)
              .join(' · ')}
          >
            {running ? (
              <Field label={tr('Laufen', 'Running')}>
                <ChipGroup
                  label={tr('Empfehlungen fürs Laufen', 'Recommendations for running')}
                  options={RECOMMENDATION_MODES.map(value => ({
                    value,
                    label: recommendationModeLabel(value),
                  }))}
                  value={features.recommendations.running}
                  onChange={mode => patch('recommendations', { running: mode })}
                  disabled={disabled}
                />
              </Field>
            ) : null}
            {strength ? (
              <Field label={tr('Krafttraining', 'Strength training')}>
                <ChipGroup
                  label={tr(
                    'Empfehlungen fürs Krafttraining',
                    'Recommendations for strength training',
                  )}
                  options={RECOMMENDATION_MODES.map(value => ({
                    value,
                    label: recommendationModeLabel(value),
                  }))}
                  value={features.recommendations.strength}
                  onChange={mode =>
                    patch('recommendations', { strength: mode })
                  }
                  disabled={disabled}
                />
              </Field>
            ) : null}
            <Row
              title={tr('„Danach vorgesehen“ anzeigen', 'Show “Up next”')}
              subtitle={tr(
                'Die wartende nächste Empfehlung',
                'The next recommendation waiting',
              )}
              trailing={toggle(
                tr('„Danach vorgesehen“ anzeigen', 'Show “Up next”'),
                features.recommendations.showQueued,
                value => patch('recommendations', { showQueued: value }),
              )}
            />
            <Copy muted>
              {tr(
                'Nur auf Nachfrage: Die Empfehlung steht im Coach, nicht auf Heute. Aus: Eine laufende Empfehlung wird pausiert, nicht abgebrochen.',
                'Only on request: the recommendation is in Coach, not on Today. Off: a running recommendation is paused, not cancelled.',
              )}
            </Copy>
          </Disclosure>
        ) : null}
        {screen === 'recording' && recordsSomething ? (
          <Disclosure
            defaultOpen
            title={tr('Aufzeichnung', 'Recording')}
            subtitle={tr(
              `Groß: ${recordingPrimaryLabel(features.recording.primary)} · Danach: ${afterRunLabel(features.recording.afterRun)}`,
              `Large: ${recordingPrimaryLabel(features.recording.primary)} · After: ${afterRunLabel(features.recording.afterRun)}`,
            )}
          >
            <Field label={tr('Groß angezeigt', 'Shown large')}>
              <ChipGroup
                label={tr(
                  'Große Kennzahl während der Aufzeichnung',
                  'Large metric during recording',
                )}
                options={RECORDING_PRIMARIES.map(value => ({
                  value,
                  label: recordingPrimaryLabel(value),
                }))}
                value={features.recording.primary}
                onChange={primary => patch('recording', { primary })}
                disabled={disabled}
              />
            </Field>
            <Row
              title={tr('Kilometer', 'Kilometers')}
              trailing={toggle(tr('Kilometer', 'Kilometers'), hasMetric('distance'), value =>
                setMetric('distance', value),
              )}
            />
            <Row
              title={tr('Tempo', 'Pace')}
              trailing={toggle(tr('Tempo', 'Pace'), hasMetric('pace'), value =>
                setMetric('pace', value),
              )}
            />
            <Row
              title={tr('Herzfrequenz', 'Heart rate')}
              subtitle={tr('Nur mit vorhandenen Messdaten', 'Only with existing measurements')}
              trailing={toggle(tr('Herzfrequenz', 'Heart rate'), hasMetric('heartRate'), value =>
                setMetric('heartRate', value),
              )}
            />
            {running ? (
              <>
                <Row
                  title={tr('Laufen nach Tempo oder Puls', 'Run by pace or heart rate')}
                  subtitle={tr(
                    'Zielvorgabe vor dem Start anbieten',
                    'Offer a target before the start',
                  )}
                  trailing={toggle(
                    tr('Laufen nach Tempo oder Puls', 'Run by pace or heart rate'),
                    features.recording.targets,
                    value => patch('recording', { targets: value }),
                  )}
                />
              </>
            ) : null}
            <Field label={tr('Nach dem Beenden', 'After stopping')}>
              <ChipGroup
                label={tr(
                  'Was nach dem Beenden einer Aufzeichnung passiert',
                  'What happens after a recording stops',
                )}
                options={AFTER_RUN_OPTIONS.map(value => ({
                  value,
                  label: afterRunLabel(value),
                }))}
                value={features.recording.afterRun}
                onChange={afterRun => patch('recording', { afterRun })}
                disabled={disabled}
              />
            </Field>
          </Disclosure>
        ) : null}
        {screen === 'strength' && strength ? (
          <Disclosure
            defaultOpen
            title={tr('Krafttraining', 'Strength training')}
            subtitle={tr(
              `Pause ${features.strength.defaultRestSeconds} s${
                features.strength.restTimer ? '' : ' · Timer aus'
              }`,
              `Rest ${features.strength.defaultRestSeconds} s${
                features.strength.restTimer ? '' : ' · Timer off'
              }`,
            )}
          >
            <Row
              title={tr('Pausentimer', 'Rest timer')}
              subtitle={tr(
                'Balken nach jedem bestätigten Satz',
                'Bar after each confirmed set',
              )}
              trailing={toggle(
                tr('Pausentimer', 'Rest timer'),
                features.strength.restTimer,
                value => patch('strength', { restTimer: value }),
              )}
            />
            {features.strength.restTimer ? (
              <>
                <Row
                  title={tr('Vibration am Pausenende', 'Vibration at rest end')}
                  subtitle={tr(
                    'Kurz, kurz, lang — auf der Uhr, sonst am Handy',
                    'Short, short, long — on the watch, otherwise on the phone',
                  )}
                  trailing={toggle(
                    tr('Vibration am Pausenende', 'Vibration at rest end'),
                    features.strength.restVibration,
                    value => patch('strength', { restVibration: value }),
                  )}
                />
                <Row
                  title={tr('Ton am Pausenende', 'Sound at rest end')}
                  subtitle={tr(
                    'Kurz, kurz, lang am Handy',
                    'Short, short, long on the phone',
                  )}
                  trailing={toggle(
                    tr('Ton am Pausenende', 'Sound at rest end'),
                    features.strength.restSound,
                    value => patch('strength', { restSound: value }),
                  )}
                />
              </>
            ) : null}
            <Field label={tr('Standardpause für neue Sätze', 'Default rest for new sets')}>
              <ChipGroup
                label={tr('Standardpause für neue Sätze', 'Default rest for new sets')}
                options={REST_SECONDS_OPTIONS.map(value => ({
                  value: String(value),
                  label: `${value} s`,
                }))}
                value={String(features.strength.defaultRestSeconds)}
                onChange={value =>
                  patch('strength', { defaultRestSeconds: Number(value) })
                }
                disabled={disabled}
              />
            </Field>
            <Row
              title={tr('Wiederholungen im Tank', 'Reps in reserve')}
              subtitle={tr('Feld je Satz, freiwillig', 'Field per set, optional')}
              trailing={toggle(
                tr('Wiederholungen im Tank', 'Reps in reserve'),
                features.strength.rir,
                value => patch('strength', { rir: value }),
              )}
            />
            <Row
              title={tr('Tagesvorlage auf Heute', 'Day template on Today')}
              subtitle={tr(
                'Vorlage nach Wochentag vorschlagen',
                'Suggest template by weekday',
              )}
              trailing={toggle(
                tr('Tagesvorlage auf Heute', 'Day template on Today'),
                features.strength.templateOfDay,
                value => patch('strength', { templateOfDay: value }),
              )}
            />
          </Disclosure>
        ) : null}
        {screen === 'statistics' && features.statistics.enabled ? (
          <Disclosure
            defaultOpen
            title={tr('Statistik · Tiefer schauen', 'Statistics · Look deeper')}
            subtitle={tr(
              `${STATS_MODULES.filter(module => hasModule(module)).length} von ${STATS_MODULES.length} Blöcken`,
              `${STATS_MODULES.filter(module => hasModule(module)).length} of ${STATS_MODULES.length} blocks`,
            )}
          >
            {STATS_MODULES.map(module => (
              <Row
                key={module}
                title={
                  // Running splits by run type, strength by muscle group.
                  module === 'distribution' && strength
                    ? running
                      ? tr('Verteilung und Muskeln', 'Distribution and muscles')
                      : tr('Muskeln', 'Muscles')
                    : statsModuleLabel(module)
                }
                trailing={toggle(
                  statsModuleLabel(module),
                  hasModule(module),
                  value => setModule(module, value),
                )}
              />
            ))}
          </Disclosure>
        ) : null}
      </>
      {screen === 'goals' && features.goals.enabled ? (
        <Copy muted>
          {tr(
            'Wähle Ziel und Fokus je Bereich unter Alle Funktionen.',
            'Choose goal and focus per area under All features.',
          )}
        </Copy>
      ) : null}
      {screen === 'routes' && featureEnabled(features, 'routes') ? (
        <Copy muted>
          {tr(
            'Öffne Routen unter Alle Funktionen oder setze sie in die Navigation.',
            'Open Routes under All features or put them in the navigation.',
          )}
        </Copy>
      ) : null}
      {screen === 'templates' && features.templates.enabled ? (
        <Row
          title={tr('Tagesvorlage auf Heute', 'Day template on Today')}
          trailing={toggle(
            tr('Tagesvorlage auf Heute', 'Day template on Today'),
            features.strength.templateOfDay,
            value => patch('strength', { templateOfDay: value }),
          )}
        />
      ) : null}
    </>
  );
}
