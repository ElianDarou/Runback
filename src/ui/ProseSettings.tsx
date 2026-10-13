import React, { useEffect, useState } from 'react';
import { StyleSheet, Switch, TextInput } from 'react-native';
import { nativeCall } from '../native';
import { Button, Copy, Row, Section, color } from './components';
import { tr } from '../domain/i18n';

export function ProseSettings() {
  const [settings, setSettings] = useState<any>(null);
  const [key, setKey] = useState('');
  const [model, setModel] = useState('openrouter/free');
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  useEffect(() => {
    let mounted = true;
    nativeCall<any>('getProseSettings')
      .then(value => {
        if (mounted) {
          setSettings(value);
          setModel(value.model);
          setEnabled(value.enabled);
        }
      })
      .catch(() => {});
    return () => {
      mounted = false;
    };
  }, []);
  const act = async (fn: () => Promise<void>) => {
    setBusy(true);
    setMessage('');
    try {
      await fn();
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : tr(
              'Einstellung konnte nicht gespeichert werden.',
              'The setting could not be saved.',
            ),
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <Section title={tr('OpenRouter & Chat', 'OpenRouter & chat')}>
      <Copy muted>
        {tr(
          'Hier verbindest du deinen eigenen OpenRouter-Schlüssel. Im Trainingschat kannst du Fragen stellen und lokale Trainingsdaten einbeziehen. Alle Auswertungen rechnet Runback weiterhin lokal.',
          'Connect your own OpenRouter key here. In the training chat, you can ask questions and include local training data. Runback still calculates every analysis locally.',
        )}
      </Copy>
      <Row
        title={tr('OpenRouter verwenden', 'Use OpenRouter')}
        subtitle={
          settings?.hasKey
            ? tr('Eigener Schlüssel ist gespeichert', 'Your own key is saved')
            : tr(
                'Eigener API-Schlüssel erforderlich',
                'Your own API key is required',
              )
        }
        trailing={
          <Switch
            accessibilityLabel={tr(
              'OpenRouter aktivieren',
              'Turn on OpenRouter',
            )}
            value={enabled}
            onValueChange={setEnabled}
            trackColor={{ false: color.line, true: color.green }}
            thumbColor={enabled ? color.ink : color.muted}
          />
        }
      />
      <Copy>{tr('API-Schlüssel', 'API key')}</Copy>
      <TextInput
        accessibilityLabel={tr(
          'OpenRouter API-Schlüssel',
          'OpenRouter API key',
        )}
        secureTextEntry
        autoCapitalize="none"
        autoCorrect={false}
        value={key}
        onChangeText={setKey}
        placeholder={
          settings?.hasKey
            ? tr('Gespeicherten Schlüssel ersetzen', 'Replace saved key')
            : tr('Eigenen Schlüssel eingeben', 'Enter your own key')
        }
        placeholderTextColor={color.muted}
        style={styles.input}
      />
      <Copy>{tr('Modell', 'Model')}</Copy>
      <TextInput
        accessibilityLabel={tr('OpenRouter Modell', 'OpenRouter model')}
        autoCapitalize="none"
        autoCorrect={false}
        value={model}
        onChangeText={setModel}
        style={styles.input}
      />
      <Copy muted>
        {tr(
          'Standard: openrouter/free. Auch andere gültige OpenRouter-Modellkennungen sind erlaubt; kostenpflichtige Modelle nutzen dein OpenRouter-Guthaben. Runback hat kein tägliches Token- oder Anfragelimit. Die Limits des Anbieters gelten weiterhin.',
          "Default: openrouter/free. Other valid OpenRouter model IDs are allowed too; paid models use your OpenRouter credit. Runback has no daily token or request limit. The provider's limits still apply.",
        )}
      </Copy>
      <Button
        secondary
        title={tr('OpenRouter speichern', 'Save OpenRouter')}
        disabled={busy}
        onPress={() => {
          void act(async () => {
            setSettings(
              await nativeCall(
                'configureProse',
                enabled,
                model.trim(),
                key.trim() || null,
              ),
            );
            setKey('');
            setMessage(tr('Einstellungen gespeichert.', 'Settings saved.'));
          });
        }}
      />
      {settings?.hasKey ? (
        <Button
          secondary
          title={tr('Schlüssel entfernen', 'Remove key')}
          disabled={busy}
          onPress={() => {
            void act(async () => {
              setSettings(await nativeCall('clearProseKey'));
              setEnabled(false);
              setKey('');
            });
          }}
        />
      ) : null}
      {message ? <Copy>{message}</Copy> : null}
    </Section>
  );
}

const styles = StyleSheet.create({
  input: {
    borderWidth: 1,
    borderColor: color.line,
    borderRadius: 8,
    padding: 14,
    color: color.text,
    backgroundColor: color.surface,
    fontSize: 16,
    minHeight: 52,
  },
});
