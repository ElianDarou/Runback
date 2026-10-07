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
  AFTER_RUN_LABELS,
  AFTER_RUN_OPTIONS,
  HOME_SECTION_LABELS,
  RECOMMENDATION_MODES,
  RECOMMENDATION_MODE_LABELS,
  RECORDING_PRIMARIES,
  RECORDING_PRIMARY_LABELS,
  REST_SECONDS_OPTIONS,
  SORENESS_PROMPTS,
  SORENESS_PROMPT_LABELS,
  STATS_MODULES,
  STATS_MODULE_LABELS,
  availableHomeSections,
  visibleHomeSections,
  withArea,
  type Area,
  type FeatureSettings as Features,
  type RecordingMetric,
  type StatsModule,
} from '../domain/features';
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
 * Eine Seite, ein Satz je Zeile: Was Runback zeigt und wann es fragt.
 * Abschalten wirkt sofort und versteckt nur; Daten bleiben. Die Zeile nennt
 * die Funktion, der Untertitel den aktuellen Wert — keine Erklärtexte.
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
        <Title>Blöcke auf Heute</Title>
        <Copy muted>
          Die Startkarte bleibt immer; aktive Funktionen bleiben unter Alle
          Funktionen erreichbar.
        </Copy>
        <Section title="Sichtbar">
          {available.map(section => (
            <Row
              key={section}
              title={HOME_SECTION_LABELS[section]}
              trailing={toggle(
                HOME_SECTION_LABELS[section],
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
      label="Einstellungen bearbeiten"
      options={[
        { value: 'main', label: 'Funktionen' },
        { value: 'navigation', label: 'Navigation' },
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
        <Title>Navigation</Title>
        {navigationTabs}
        <Card>
          <Copy>{visibleTabs(features).join(' · ')}</Copy>
          <Copy muted>{selected.length} von 2 eigenen Plätzen belegt.</Copy>
        </Card>
        <Copy muted>
          Heute und Verlauf bleiben fest; wähle bis zu zwei weitere Funktionen.
        </Copy>
        <Section title="In der Leiste">
          {selected.length ? (
            selected.map((tab, index) => (
              <Row
                key={tab}
                title={tab}
                subtitle={`Platz ${index + 2}`}
                trailing={
                  <Button
                    secondary
                    small
                    title={`${tab} entfernen`}
                    disabled={disabled}
                    onPress={() => choose(tab, false)}
                  />
                }
              />
            ))
          ) : (
            <Copy muted>Beide Plätze sind frei.</Copy>
          )}
          {selected.length === 2 ? (
            <Button
              secondary
              small
              title="Reihenfolge tauschen"
              disabled={disabled}
              onPress={() =>
                onChange(withNavigation(features, [...selected].reverse()))
              }
            />
          ) : null}
        </Section>
        <Section title="Aktive Funktionen">
          {availableTabs(features).map(tab => (
            <CheckRow
              key={tab}
              title={tab}
              subtitle={
                selected.includes(tab)
                  ? 'In der Leiste'
                  : 'Unter Alle Funktionen erreichbar'
              }
              checked={selected.includes(tab)}
              disabled={disabled}
              onToggle={checked => choose(tab, checked)}
            />
          ))}
        </Section>
        <Section title="Ausgeschaltet">
          {FEATURE_CATALOG.filter(
            entry => entry.tab && !featureEnabled(features, entry.id),
          ).map(entry => (
            <Row
              key={entry.id}
              title={entry.title}
              subtitle="Schalte die Funktion zuerst ein."
              onPress={() => onOpenDetails(entry.id)}
            />
          ))}
        </Section>
        <Sheet
          visible={replacement !== null}
          title="Platz ersetzen"
          onClose={() => setReplacement(null)}
        >
          <Copy muted>
            Wähle den Platz für {replacement}; die ersetzte Funktion bleibt
            aktiv.
          </Copy>
          {selected.map(tab => (
            <Row
              key={tab}
              title={`${tab} ersetzen`}
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
                  ? 'Laufen aus'
                  : enabled
                  ? 'An'
                  : 'Aus'
              } · ${
                enabled && entry.tab && selected.includes(entry.tab)
                  ? 'In der Leiste'
                  : enabled
                  ? 'Unter Alle Funktionen'
                  : entry.description
              }`}
              trailing={
                <Switch
                  accessibilityLabel={`${entry.title} einschalten`}
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
        <Title>Funktionen</Title>
        {navigationTabs}
        <Copy muted>
          Schalte ein, was du nutzen möchtest; deine Daten bleiben erhalten.
        </Copy>
        <Section title="Training begleiten">
          {functionRows(['coach', 'planning', 'goals'])}
        </Section>
        <Section title="Auswerten und vorbereiten">
          {functionRows(['statistics', 'routes', 'templates', 'soreness'])}
        </Section>
        <Section title="Bereiche">
          <Row
            title="Laufen"
            trailing={toggle('Laufen', running, value =>
              setArea('running', value),
            )}
          />
          <Row
            title="Krafttraining"
            trailing={toggle('Krafttraining', strength, value =>
              setArea('strength', value),
            )}
          />
          <Row
            title="Radfahren in der Auswahl"
            trailing={toggle(
              'Radfahren in der Auswahl',
              features.sports.cycling,
              value => patch('sports', { cycling: value }),
            )}
          />
          <Copy muted>Ein Bereich bleibt immer an.</Copy>
        </Section>
        <Section title="Anzeige und Training">
          <Row
            title="Heute gestalten"
            subtitle={`${visibleHomeSections(features).length} Blöcke sichtbar`}
            onPress={onOpenHomeSections}
          />
          {recordsSomething ? (
            <Row
              title="Aufzeichnung"
              subtitle="Kennzahlen und Laufvorgaben"
              onPress={() => onOpenDetails('recording')}
            />
          ) : null}
          {strength ? (
            <Row
              title="Krafttraining einstellen"
              subtitle="Pausen und Satzangaben"
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
          (screen === 'recording' ? 'Aufzeichnung' : 'Krafttraining')}
      </Title>
      {entry && !(entry.id === 'routes' && !running) ? (
        <Row
          title={entry.title}
          subtitle={featureEnabled(features, entry.id) ? 'An' : 'Aus'}
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
            ? 'Schalte Laufen ein, um Routen zu nutzen.'
            : 'Schalte die Funktion ein, um ihre Details zu bearbeiten.'}
        </Copy>
      ) : null}
      {screen === 'soreness' && features.soreness.enabled ? (
        <Section title="Muskelkater">
          {features.soreness.enabled ? (
            <>
              <Field label="Wann Runback fragt">
                <ChipGroup
                  label="Wann Runback nach Muskelkater fragt"
                  options={SORENESS_PROMPTS.map(value => ({
                    value,
                    label: SORENESS_PROMPT_LABELS[value],
                  }))}
                  value={features.soreness.prompt}
                  onChange={prompt => patch('soreness', { prompt })}
                  disabled={disabled}
                />
              </Field>
              <Row
                title="Muskelkarte"
                subtitle="Gemeldeter Muskelkater und Frische je Region"
                trailing={toggle('Muskelkarte', features.soreness.map, value =>
                  patch('soreness', { map: value }),
                )}
              />
              <Row
                title="Spracheingabe beim Melden"
                subtitle="Mikrofon in der Muskelkater-Erfassung"
                trailing={toggle(
                  'Spracheingabe beim Melden',
                  features.soreness.voice,
                  value => patch('soreness', { voice: value }),
                )}
              />
            </>
          ) : null}
        </Section>
      ) : null}
      {screen === 'planning' && features.planning.enabled ? (
        <Section title="Planung">
          {features.planning.enabled ? (
            <>
              <Row
                title="Woche vorschlagen"
                trailing={toggle(
                  'Woche vorschlagen',
                  features.planning.suggest,
                  value => patch('planning', { suggest: value }),
                )}
              />
              <Row
                title="Monatsansicht"
                trailing={toggle(
                  'Monatsansicht',
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
            title="Empfehlungen"
            subtitle={[
              running
                ? `Laufen: ${
                    RECOMMENDATION_MODE_LABELS[features.recommendations.running]
                  }`
                : '',
              strength
                ? `Kraft: ${
                    RECOMMENDATION_MODE_LABELS[
                      features.recommendations.strength
                    ]
                  }`
                : '',
            ]
              .filter(Boolean)
              .join(' · ')}
          >
            {running ? (
              <Field label="Laufen">
                <ChipGroup
                  label="Empfehlungen fürs Laufen"
                  options={RECOMMENDATION_MODES.map(value => ({
                    value,
                    label: RECOMMENDATION_MODE_LABELS[value],
                  }))}
                  value={features.recommendations.running}
                  onChange={mode => patch('recommendations', { running: mode })}
                  disabled={disabled}
                />
              </Field>
            ) : null}
            {strength ? (
              <Field label="Krafttraining">
                <ChipGroup
                  label="Empfehlungen fürs Krafttraining"
                  options={RECOMMENDATION_MODES.map(value => ({
                    value,
                    label: RECOMMENDATION_MODE_LABELS[value],
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
              title="„Danach vorgesehen“ anzeigen"
              subtitle="Die wartende nächste Empfehlung"
              trailing={toggle(
                '„Danach vorgesehen“ anzeigen',
                features.recommendations.showQueued,
                value => patch('recommendations', { showQueued: value }),
              )}
            />
            <Copy muted>
              Nur auf Nachfrage: Die Empfehlung steht im Coach, nicht auf Heute.
              Aus: Eine laufende Empfehlung wird pausiert, nicht abgebrochen.
            </Copy>
          </Disclosure>
        ) : null}
        {screen === 'recording' && recordsSomething ? (
          <Disclosure
            defaultOpen
            title="Aufzeichnung"
            subtitle={`Groß: ${
              RECORDING_PRIMARY_LABELS[features.recording.primary]
            } · Danach: ${AFTER_RUN_LABELS[features.recording.afterRun]}`}
          >
            <Field label="Groß angezeigt">
              <ChipGroup
                label="Große Kennzahl während der Aufzeichnung"
                options={RECORDING_PRIMARIES.map(value => ({
                  value,
                  label: RECORDING_PRIMARY_LABELS[value],
                }))}
                value={features.recording.primary}
                onChange={primary => patch('recording', { primary })}
                disabled={disabled}
              />
            </Field>
            <Row
              title="Kilometer"
              trailing={toggle('Kilometer', hasMetric('distance'), value =>
                setMetric('distance', value),
              )}
            />
            <Row
              title="Tempo"
              trailing={toggle('Tempo', hasMetric('pace'), value =>
                setMetric('pace', value),
              )}
            />
            <Row
              title="Herzfrequenz"
              subtitle="Nur mit vorhandenen Messdaten"
              trailing={toggle('Herzfrequenz', hasMetric('heartRate'), value =>
                setMetric('heartRate', value),
              )}
            />
            {running ? (
              <>
                <Row
                  title="Laufen nach Tempo oder Puls"
                  subtitle="Zielvorgabe vor dem Start anbieten"
                  trailing={toggle(
                    'Laufen nach Tempo oder Puls',
                    features.recording.targets,
                    value => patch('recording', { targets: value }),
                  )}
                />
              </>
            ) : null}
            <Field label="Nach dem Beenden">
              <ChipGroup
                label="Was nach dem Beenden einer Aufzeichnung passiert"
                options={AFTER_RUN_OPTIONS.map(value => ({
                  value,
                  label: AFTER_RUN_LABELS[value],
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
            title="Krafttraining"
            subtitle={`Pause ${features.strength.defaultRestSeconds} s${
              features.strength.restTimer ? '' : ' · Timer aus'
            }`}
          >
            <Row
              title="Pausentimer"
              subtitle="Balken nach jedem bestätigten Satz"
              trailing={toggle(
                'Pausentimer',
                features.strength.restTimer,
                value => patch('strength', { restTimer: value }),
              )}
            />
            {features.strength.restTimer ? (
              <>
                <Row
                  title="Vibration am Pausenende"
                  subtitle="Kurz, kurz, lang — auf der Uhr, sonst am Handy"
                  trailing={toggle(
                    'Vibration am Pausenende',
                    features.strength.restVibration,
                    value => patch('strength', { restVibration: value }),
                  )}
                />
                <Row
                  title="Ton am Pausenende"
                  subtitle="Kurz, kurz, lang am Handy"
                  trailing={toggle(
                    'Ton am Pausenende',
                    features.strength.restSound,
                    value => patch('strength', { restSound: value }),
                  )}
                />
              </>
            ) : null}
            <Field label="Standardpause für neue Sätze">
              <ChipGroup
                label="Standardpause für neue Sätze"
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
              title="Wiederholungen im Tank"
              subtitle="Feld je Satz, freiwillig"
              trailing={toggle(
                'Wiederholungen im Tank',
                features.strength.rir,
                value => patch('strength', { rir: value }),
              )}
            />
            <Row
              title="Tagesvorlage auf Heute"
              subtitle="Vorlage nach Wochentag vorschlagen"
              trailing={toggle(
                'Tagesvorlage auf Heute',
                features.strength.templateOfDay,
                value => patch('strength', { templateOfDay: value }),
              )}
            />
          </Disclosure>
        ) : null}
        {screen === 'statistics' && features.statistics.enabled ? (
          <Disclosure
            defaultOpen
            title="Statistik · Tiefer schauen"
            subtitle={`${
              STATS_MODULES.filter(module => hasModule(module)).length
            } von ${STATS_MODULES.length} Blöcken`}
          >
            {STATS_MODULES.map(module => (
              <Row
                key={module}
                title={
                  // Laufen verteilt nach Laufart, Krafttraining nach Muskelgruppe.
                  module === 'distribution' && strength
                    ? running
                      ? 'Verteilung und Muskeln'
                      : 'Muskeln'
                    : STATS_MODULE_LABELS[module]
                }
                trailing={toggle(
                  STATS_MODULE_LABELS[module],
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
          Wähle Ziel und Fokus je Bereich unter Alle Funktionen.
        </Copy>
      ) : null}
      {screen === 'routes' && featureEnabled(features, 'routes') ? (
        <Copy muted>
          Öffne Routen unter Alle Funktionen oder setze sie in die Navigation.
        </Copy>
      ) : null}
      {screen === 'templates' && features.templates.enabled ? (
        <Row
          title="Tagesvorlage auf Heute"
          trailing={toggle(
            'Tagesvorlage auf Heute',
            features.strength.templateOfDay,
            value => patch('strength', { templateOfDay: value }),
          )}
        />
      ) : null}
    </>
  );
}
