import React, { useEffect, useRef, useState } from 'react';
import {
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { nativeCall } from '../native';
import {
  Button,
  Copy,
  EmptyState,
  Notice,
  Title,
  color,
  radius,
  space,
  type,
} from './components';
import { tr } from '../domain/i18n';

type ChatMessage = {
  role: 'user' | 'assistant';
  content: string;
};

type ChatResult = {
  messages: ChatMessage[];
  model?: string;
  includeTraining?: boolean;
};

type ProseSettings = {
  enabled?: boolean;
  hasKey?: boolean;
  model?: string;
};

// Built per call: the language can change at runtime.
const suggestions = () => [
  tr('Was steht diese Woche an?', "What's on this week?"),
  tr('Wie war mein letzter Lauf?', 'How was my last run?'),
  tr('Erkläre meine Empfehlung', 'Explain my recommendation'),
];

/**
 * Training chat as a chat interface: the history fills the screen, the input
 * stays fixed at the bottom, and everything else (data sharing, model, clear
 * history) sits behind "Options" instead of between the messages.
 */
export function TrainingChat({ onSettings }: { onSettings: () => void }) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [includeTraining, setIncludeTraining] = useState(true);
  const [settings, setSettings] = useState<ProseSettings | null>(null);
  const [model, setModel] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [loadingFailed, setLoadingFailed] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const sendingRef = useRef(false);
  const listRef = useRef<FlatList<ChatMessage>>(null);

  useEffect(() => {
    let mounted = true;
    Promise.all([
      nativeCall<ChatResult>('getChatHistory'),
      nativeCall<ProseSettings>('getProseSettings'),
    ])
      .then(([history, prose]) => {
        if (!mounted) return;
        setMessages(history.messages || []);
        setIncludeTraining(history.includeTraining ?? true);
        setModel(history.model || prose.model || '');
        setSettings(prose);
        setLoadingFailed(false);
        setError('');
      })
      .catch(value => {
        if (mounted) {
          setLoadingFailed(true);
          setError(
            value instanceof Error
              ? value.message
              : tr(
                  'Der Chat konnte nicht geladen werden.',
                  'The chat could not be loaded.',
                ),
          );
        }
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, [reloadToken]);

  const refreshHistory = async () => {
    const result = await nativeCall<ChatResult>('getChatHistory');
    setMessages(result.messages || []);
    if (typeof result.includeTraining === 'boolean') {
      setIncludeTraining(result.includeTraining);
    }
    if (result.model) setModel(result.model);
  };

  const send = async () => {
    const text = draft.trim();
    if (!text || busy || sendingRef.current) return;
    if (!settings?.enabled || !settings.hasKey) {
      setError(
        tr(
          'Bitte richte zuerst den OpenRouter-Zugang in den Einstellungen ein.',
          'First set up OpenRouter access in Settings.',
        ),
      );
      return;
    }

    sendingRef.current = true;
    setBusy(true);
    setError('');
    const optimistic = [...messages, { role: 'user' as const, content: text }];
    setMessages(optimistic.slice(-40));
    setDraft('');
    try {
      const result = await nativeCall<ChatResult>(
        'sendChat',
        text,
        includeTraining,
      );
      setMessages((result.messages || []).slice(-40));
      if (typeof result.includeTraining === 'boolean') {
        setIncludeTraining(result.includeTraining);
      }
      if (result.model) setModel(result.model);
    } catch (value) {
      setDraft(text);
      try {
        await refreshHistory();
      } catch {
        // Keep the original send error visible when a recovery refresh also fails.
      }
      setError(
        value instanceof Error
          ? value.message
          : tr(
              'Die Nachricht konnte nicht gesendet werden.',
              'The message could not be sent.',
            ),
      );
    } finally {
      sendingRef.current = false;
      setBusy(false);
    }
  };

  const clearConversation = async () => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const result = await nativeCall<ChatResult>('clearChatHistory');
      setMessages(result.messages || []);
      if (typeof result.includeTraining === 'boolean') {
        setIncludeTraining(result.includeTraining);
      }
      if (result.model) setModel(result.model);
      setDraft('');
      setOptionsOpen(false);
    } catch (value) {
      setError(
        value instanceof Error
          ? value.message
          : tr(
              'Die Unterhaltung konnte nicht gelöscht werden.',
              'The conversation could not be deleted.',
            ),
      );
    } finally {
      setBusy(false);
    }
  };

  const changeTrainingAccess = async (value: boolean) => {
    if (busy || value === includeTraining) return;
    const previous = includeTraining;
    setIncludeTraining(value);
    setBusy(true);
    setError('');
    try {
      const result = await nativeCall<ChatResult>(
        'setChatTrainingAccess',
        value,
      );
      setMessages(result.messages || []);
      if (typeof result.includeTraining === 'boolean') {
        setIncludeTraining(result.includeTraining);
      }
      if (result.model) setModel(result.model);
    } catch (valueError) {
      setIncludeTraining(previous);
      setError(
        valueError instanceof Error
          ? valueError.message
          : tr(
              'Die neue Chat-Einstellung konnte nicht übernommen werden.',
              'The new chat setting could not be applied.',
            ),
      );
    } finally {
      setBusy(false);
    }
  };

  const ready = Boolean(settings?.enabled && settings?.hasKey);
  const displayedMessages = messages.slice(-40);
  const canSend = ready && !busy && Boolean(draft.trim());

  return (
    <View style={styles.screen}>
      <View style={styles.head}>
        <Title>{tr('Trainingschat', 'Training chat')}</Title>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={tr('Chat-Optionen', 'Chat options')}
          onPress={() => setOptionsOpen(true)}
          style={({ pressed }) => [
            styles.headAction,
            pressed && styles.pressed,
          ]}
        >
          <Text style={styles.headActionText}>{tr('Optionen', 'Options')}</Text>
        </Pressable>
      </View>

      <FlatList
        ref={listRef}
        data={displayedMessages}
        keyExtractor={(item, index) => `${index}-${item.role}`}
        contentContainerStyle={styles.list}
        keyboardShouldPersistTaps="handled"
        onContentSizeChange={() =>
          listRef.current?.scrollToEnd({ animated: false })
        }
        renderItem={({ item }) => (
          <View
            accessibilityRole="text"
            accessibilityLabel={`${
              item.role === 'user' ? tr('Du', 'You') : 'Runback'
            }: ${item.content}`}
            style={[
              styles.bubble,
              item.role === 'user' ? styles.bubbleUser : styles.bubbleAssistant,
            ]}
          >
            <Text style={styles.bubbleText}>{item.content}</Text>
          </View>
        )}
        ListEmptyComponent={
          loading ? (
            <Copy muted>
              {tr('Unterhaltung wird geladen …', 'Loading conversation …')}
            </Copy>
          ) : (
            <View style={styles.emptyWrap}>
              <EmptyState
                title={tr(
                  'Stelle eine Frage zu deinem Training',
                  'Ask a question about your training',
                )}
                copy={
                  ready
                    ? tr(
                        'Runback antwortet mit deinen freigegebenen Trainingsdaten.',
                        'Runback answers with the training data you have shared.',
                      )
                    : tr(
                        'Dafür fehlt noch der OpenRouter-Zugang.',
                        'OpenRouter access is still missing for that.',
                      )
                }
                action={
                  ready
                    ? undefined
                    : {
                        title: tr('OpenRouter einrichten', 'Set up OpenRouter'),
                        onPress: onSettings,
                      }
                }
              />
              <View style={styles.chips}>
                {suggestions().map(prompt => (
                  <Pressable
                    key={prompt}
                    accessibilityRole="button"
                    accessibilityLabel={tr(
                      `Frage verwenden: ${prompt}`,
                      `Use question: ${prompt}`,
                    )}
                    disabled={busy}
                    onPress={() => setDraft(prompt)}
                    style={({ pressed }) => [
                      styles.chip,
                      pressed && styles.pressed,
                    ]}
                  >
                    <Text style={styles.chipText}>{prompt}</Text>
                  </Pressable>
                ))}
              </View>
            </View>
          )
        }
        ListFooterComponent={
          busy ? (
            <Text accessibilityLiveRegion="polite" style={styles.pending}>
              {tr('Runback antwortet …', 'Runback is replying …')}
            </Text>
          ) : null
        }
      />

      {error ? (
        <View style={styles.noticeSlot}>
          <Notice onDismiss={() => setError('')}>{error}</Notice>
        </View>
      ) : null}
      {loadingFailed ? (
        <View style={styles.noticeSlot}>
          <Button
            secondary
            small
            title={tr('Erneut laden', 'Load again')}
            disabled={busy}
            onPress={() => {
              setLoadingFailed(false);
              setLoading(true);
              setError('');
              setReloadToken(value => value + 1);
            }}
          />
        </View>
      ) : null}

      <View style={styles.composer}>
        <TextInput
          accessibilityLabel={tr(
            'Nachricht an den Trainingschat',
            'Message to the training chat',
          )}
          accessibilityHint={tr(
            'Frage eingeben und anschließend senden',
            'Type a question, then send',
          )}
          multiline
          editable={!busy}
          maxLength={6000}
          value={draft}
          onChangeText={setDraft}
          placeholder={tr('Frage stellen …', 'Ask a question …')}
          placeholderTextColor={color.muted}
          selectionColor={color.green}
          style={styles.input}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={tr('Senden', 'Send')}
          accessibilityState={{ disabled: !canSend }}
          disabled={!canSend}
          onPress={() => void send()}
          style={({ pressed }) => [
            styles.send,
            !canSend && styles.sendDisabled,
            pressed && styles.pressed,
          ]}
        >
          <Text style={styles.sendText}>↑</Text>
        </Pressable>
      </View>

      <Modal
        visible={optionsOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setOptionsOpen(false)}
      >
        <View style={styles.backdrop}>
          <View style={styles.sheet}>
            <Text style={styles.sheetTitle}>
              {tr('Chat-Optionen', 'Chat options')}
            </Text>
            <View style={styles.accessRow}>
              <View style={styles.accessText}>
                <Text style={styles.label}>
                  {tr('Trainingsdaten einbeziehen', 'Include training data')}
                </Text>
                <Text style={styles.hint}>
                  {includeTraining
                    ? tr(
                        'Profil, Läufe, Laufgefühl und Notizen. Nur lesend.',
                        'Profile, runs, how runs felt, and notes. Read-only.',
                      )
                    : tr(
                        'Allgemeiner Chat ohne Zugriff auf Trainingsdaten.',
                        'General chat without access to training data.',
                      )}
                </Text>
              </View>
              <Switch
                accessibilityLabel={tr(
                  'Trainingsdaten einbeziehen',
                  'Include training data',
                )}
                accessibilityState={{
                  checked: includeTraining,
                  disabled: busy || loading,
                }}
                disabled={busy || loading}
                value={includeTraining}
                onValueChange={value => void changeTrainingAccess(value)}
                trackColor={{ false: color.line, true: color.green }}
                thumbColor={includeTraining ? color.ink : color.muted}
              />
            </View>
            {model ? (
              <Copy muted>
                {tr('Modell', 'Model')}: {model}
              </Copy>
            ) : null}
            <Copy muted>
              {tr(
                'Nachrichten und freigegebene Trainingsdaten gehen an OpenRouter und den gewählten Modellanbieter. GPS-Koordinaten und Rohsamples nicht.',
                'Messages and shared training data go to OpenRouter and the chosen model provider. GPS coordinates and raw samples do not.',
              )}
            </Copy>
            <Copy muted>
              {tr(
                'Antworten sind Einschätzungen und ändern keine Auswertung.',
                'Answers are assessments and do not change any analysis.',
              )}
            </Copy>
            <Button
              secondary
              title={tr('OpenRouter-Einstellungen', 'OpenRouter settings')}
              disabled={busy}
              onPress={() => {
                setOptionsOpen(false);
                onSettings();
              }}
            />
            <Button
              danger
              title={tr('Unterhaltung löschen', 'Delete conversation')}
              disabled={busy || messages.length === 0}
              onPress={() => void clearConversation()}
            />
            <Button
              secondary
              small
              title={tr('Schließen', 'Close')}
              onPress={() => setOptionsOpen(false)}
            />
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space.lg,
    paddingBottom: space.xs,
    gap: space.sm,
  },
  headAction: {
    minHeight: 48,
    justifyContent: 'center',
    paddingHorizontal: space.xs,
  },
  headActionText: { color: color.green, ...type.label, fontWeight: '600' },
  list: {
    paddingHorizontal: space.lg,
    paddingBottom: space.md,
    gap: space.sm,
    flexGrow: 1,
  },
  emptyWrap: { gap: space.md },
  bubble: {
    borderRadius: radius.lg,
    maxWidth: '92%',
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
  },
  bubbleAssistant: {
    alignSelf: 'flex-start',
    backgroundColor: color.surface,
    borderColor: color.line,
    borderWidth: 1,
  },
  bubbleUser: { alignSelf: 'flex-end', backgroundColor: color.raised },
  bubbleText: { color: color.text, ...type.body },
  pending: {
    color: color.muted,
    ...type.label,
    fontWeight: '400',
    paddingTop: space.xs,
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs },
  chip: {
    backgroundColor: color.surface,
    borderColor: color.line,
    borderRadius: radius.pill,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 48,
    paddingHorizontal: space.md,
  },
  chipText: { color: color.text, ...type.label, fontWeight: '400' },
  pressed: { opacity: 0.72 },
  noticeSlot: { paddingHorizontal: space.lg, paddingBottom: space.xs },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: space.xs,
    paddingHorizontal: space.lg,
    paddingTop: space.xs,
    paddingBottom: space.sm,
    borderTopWidth: 1,
    borderTopColor: color.line,
  },
  input: {
    flex: 1,
    backgroundColor: color.surface,
    borderColor: color.line,
    borderRadius: radius.lg,
    borderWidth: 1,
    color: color.text,
    ...type.body,
    maxHeight: 140,
    minHeight: 52,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    textAlignVertical: 'top',
  },
  send: {
    width: 52,
    height: 52,
    borderRadius: radius.pill,
    backgroundColor: color.green,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendDisabled: { opacity: 0.4 },
  sendText: { color: color.ink, fontSize: 24, fontWeight: '700' },
  backdrop: {
    flex: 1,
    backgroundColor: '#000000AA',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: color.surface,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    padding: space.lg,
    gap: space.sm,
  },
  sheetTitle: { color: color.text, ...type.heading },
  accessRow: {
    alignItems: 'center',
    borderBottomColor: color.line,
    borderBottomWidth: 1,
    flexDirection: 'row',
    gap: space.sm,
    paddingBottom: space.sm,
  },
  accessText: { flex: 1, gap: space.xxs },
  label: { color: color.text, ...type.body, fontWeight: '500' },
  hint: { color: color.muted, ...type.label, fontWeight: '400' },
});
