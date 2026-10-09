import React, { useCallback, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { regionLabel, type RegionId } from '../domain/regions';
import {
  buildReport,
  fromStructured,
  parseSoreness,
  type SorenessParse,
  type SorenessQuestion,
  type SorenessReport,
  type StructuredSorenessItem,
} from '../domain/sorenessInput';
import { quote, tr } from '../domain/i18n';
import { BodyMap, type BodyView } from './BodyMap';
import { Button, color, radius, space, type } from './components';

/**
 * Short soreness check: reported in seconds, visible on the figure right away.
 *
 * One screen, one task: tap, choose a strength, save. Speech is the quick side
 * path, not the fallback. Nothing is saved until the user taps "Save". "Nothing
 * today" is a complete, valuable answer. Skipping is always possible and has no
 * effect on the analysis.
 *
 * Text appears only where it carries a decision. The strength picker explains
 * the scale itself; the figure's legend explains the color.
 */

export interface TranscriptResult {
  text: string;
  /**
   * Optional structured fields from the switchable OpenRouter pass. They go
   * through the same lexicon as spoken input; anything not found there is
   * discarded (ground rule 6).
   */
  structured?: StructuredSorenessItem[];
}

export interface SorenessCaptureProps {
  now: number;
  busy?: boolean;
  /** Voice path available. If missing, tapping stays fully usable. */
  voiceAvailable: boolean;
  /** Why the voice path is unavailable right now. Shown as given. */
  voiceHint?: string;
  onTranscribe?: () => Promise<TranscriptResult>;
  onSave: (report: SorenessReport) => void;
  onSkip: () => void;
}

/**
 * Strength steps of the lexicon plus the two ends. `label` is the text read
 * aloud; on screen the number is large and the word small beneath it, so the
 * row fits on one line.
 */
const steps = (): { value: number; word: string; label: string }[] => [
  {
    value: 0,
    word: tr('kein', 'none'),
    label: tr('kein Muskelkater · 0', 'no soreness · 0'),
  },
  {
    value: 3,
    word: tr('leicht', 'light'),
    label: tr('leicht · 3', 'light · 3'),
  },
  {
    value: 5,
    word: tr('mittel', 'moderate'),
    label: tr('mittel · 5', 'moderate · 5'),
  },
  {
    value: 6,
    word: tr('ordentlich', 'considerable'),
    label: tr('ordentlich · 6', 'considerable · 6'),
  },
  {
    value: 8,
    word: tr('stark', 'strong'),
    label: tr('stark · 8', 'strong · 8'),
  },
  {
    value: 9,
    word: tr('extrem', 'extreme'),
    label: tr('extrem · 9', 'extreme · 9'),
  },
  {
    value: 10,
    word: tr('maximal', 'maximum'),
    label: tr('mehr geht nicht · 10', "can't get worse · 10"),
  },
];

type Values = Record<RegionId, number | null>;

export function SorenessCapture({
  now,
  busy = false,
  voiceAvailable,
  voiceHint,
  onTranscribe,
  onSave,
  onSkip,
}: SorenessCaptureProps) {
  const [values, setValues] = useState<Values>({});
  const [view, setView] = useState<BodyView>('front');
  const [questions, setQuestions] = useState<SorenessQuestion[]>([]);
  const [pending, setPending] = useState<RegionId[]>([]);
  const [transcript, setTranscript] = useState('');
  const [listening, setListening] = useState(false);
  const [notice, setNotice] = useState('');
  const [usedVoice, setUsedVoice] = useState(false);
  const [usedTap, setUsedTap] = useState(false);

  const answered = useMemo(
    () => Object.keys(values).filter(id => typeof values[id] === 'number'),
    [values],
  );

  const apply = useCallback((ids: RegionId[], value: number | null) => {
    setValues(previous => {
      const next = { ...previous };
      ids.forEach(id => {
        if (value === null) {
          delete next[id];
        } else {
          next[id] = value;
        }
      });
      return next;
    });
  }, []);

  const absorb = useCallback((parse: SorenessParse) => {
    setValues(previous => {
      const next = { ...previous };
      parse.proposals.forEach(entry => {
        next[entry.regionId] = entry.value;
      });
      return next;
    });
    setQuestions(parse.questions);
  }, []);

  const listen = useCallback(async () => {
    if (!onTranscribe) {
      return;
    }
    setListening(true);
    setNotice('');
    try {
      const result = await onTranscribe();
      setTranscript(result.text || '');
      setUsedVoice(true);
      // The rule-based path always takes precedence. Structured fields from
      // OpenRouter only fill what it left open.
      const rules = parseSoreness(result.text || '');
      if (result.structured && result.structured.length) {
        const checked = fromStructured(result.structured, result.text || '');
        const ruleIds = new Set(rules.proposals.map(entry => entry.regionId));
        absorb({
          ...rules,
          // Structured proposals may fill gaps, never replace parsed regions.
          proposals: [
            ...rules.proposals,
            ...checked.proposals.filter(entry => !ruleIds.has(entry.regionId)),
          ],
          questions: [...rules.questions, ...checked.questions],
        });
      } else {
        absorb(rules);
      }
      if (rules.nothingToday) {
        setNotice(
          tr(
            'Verstanden: heute nichts. Bitte noch bestätigen.',
            'Got it: nothing today. Please confirm.',
          ),
        );
      }
    } catch (error) {
      setNotice(
        error instanceof Error
          ? error.message
          : tr(
              'Die Spracherkennung hat nicht geantwortet. Tippen geht weiter.',
              'Speech recognition did not respond. Tapping still works.',
            ),
      );
    } finally {
      setListening(false);
    }
  }, [absorb, onTranscribe]);

  const answerQuestion = useCallback(
    (question: SorenessQuestion, ids: RegionId[]) => {
      setQuestions(previous => previous.filter(item => item !== question));
      if (typeof question.value === 'number') {
        apply(ids, question.value);
      } else {
        setPending(ids);
      }
    },
    [apply],
  );

  const nothingToday = useCallback(() => {
    onSave(buildReport({}, now, usedVoice ? 'voice' : 'tap', transcript));
  }, [now, onSave, transcript, usedVoice]);

  const confirm = useCallback(() => {
    const source = usedVoice && usedTap ? 'mixed' : usedVoice ? 'voice' : 'tap';
    onSave(buildReport(values, now, source, transcript));
  }, [now, onSave, transcript, usedTap, usedVoice, values]);

  const pendingLabel = pending
    .map(regionLabel)
    .join(tr(' und ', ' and '));

  return (
    <View style={styles.screen}>
      <View style={styles.head}>
        <View style={styles.headText}>
          <Text accessibilityRole="header" style={styles.title}>
            {tr('Muskelkater', 'Soreness')}
          </Text>
          <Text style={styles.subtitle}>
            {tr('Tippe an, wo es zieht.', 'Tap where it aches.')}
          </Text>
          {voiceAvailable && onTranscribe ? (
            <Pressable
              accessibilityLabel={tr('Stattdessen sprechen', 'Speak instead')}
              accessibilityRole="button"
              disabled={busy || listening}
              onPress={() => {
                void listen();
              }}
              style={({ pressed }) => [styles.link, pressed && styles.pressed]}
            >
              <Text style={styles.linkText}>
                {listening
                  ? tr('Hört zu …', 'Listening …')
                  : tr('Stattdessen sprechen', 'Speak instead')}
              </Text>
            </Pressable>
          ) : voiceHint ? (
            <Text style={styles.subtitle}>{voiceHint}</Text>
          ) : null}
        </View>
        <Pressable
          accessibilityLabel={tr('Überspringen', 'Skip')}
          accessibilityRole="button"
          disabled={busy}
          onPress={onSkip}
          style={({ pressed }) => [styles.skip, pressed && styles.pressed]}
        >
          <Text style={styles.skipText}>{tr('Überspringen', 'Skip')}</Text>
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        style={styles.scroll}
      >
        {answered.length ? (
          <View style={styles.summary}>
            {answered.map(id => (
              <Pressable
                accessibilityLabel={tr(
                  `${regionLabel(id)} ändern, aktuell ${values[id]} von 10`,
                  `Change ${regionLabel(id)}, currently ${values[id]} of 10`,
                )}
                accessibilityRole="button"
                key={`set-${id}`}
                onPress={() => setPending([id])}
                style={({ pressed }) => [
                  styles.summaryChip,
                  pressed && styles.pressed,
                ]}
              >
                <Text style={styles.summaryValue}>{values[id]}</Text>
                <Text style={styles.summaryName}>{regionLabel(id)}</Text>
              </Pressable>
            ))}
          </View>
        ) : null}

        <BodyMap
          height={370}
          mode="soreness"
          onChangeView={setView}
          onSelectRegion={id => {
            setUsedTap(true);
            setPending([id]);
          }}
          selected={pending[0] ?? null}
          showList={false}
          showScaleTitle={false}
          values={values}
          view={view}
        />

        {notice ? (
          <Text accessibilityLiveRegion="polite" style={styles.notice}>
            {notice}
          </Text>
        ) : null}

        {transcript ? (
          <Text style={styles.subtitle}>
            {`${tr('Gehört', 'Heard')}: ${quote(transcript)}`}
          </Text>
        ) : null}

        {questions.map((question, index) => (
          <View key={`q-${index}-${question.fragment}`} style={styles.question}>
            <Text style={styles.questionText}>{question.question}</Text>
            <View style={styles.chips}>
              {question.kind === 'side' ? (
                <>
                  {question.candidates.map(id => (
                    <Chip
                      key={id}
                      label={regionLabel(id)}
                      onPress={() => answerQuestion(question, [id])}
                    />
                  ))}
                  <Chip
                    label={tr('beide', 'both')}
                    onPress={() => answerQuestion(question, question.candidates)}
                  />
                </>
              ) : question.kind === 'region' ? (
                question.candidates.map(id => (
                  <Chip
                    key={id}
                    label={regionLabel(id)}
                    onPress={() => answerQuestion(question, [id])}
                  />
                ))
              ) : question.kind === 'intensity' ? (
                steps().map(step => (
                  <Chip
                    key={step.value}
                    label={step.label}
                    onPress={() => {
                      setQuestions(previous =>
                        previous.filter(item => item !== question),
                      );
                      apply(question.candidates, step.value);
                    }}
                  />
                ))
              ) : null}
            </View>
          </View>
        ))}
      </ScrollView>

      {pending.length ? (
        <View style={styles.sheet}>
          <View style={styles.sheetHead}>
            <Text style={styles.sheetTitle} numberOfLines={1}>
              {pendingLabel}
            </Text>
            <Pressable
              accessibilityLabel={tr('Angabe entfernen', 'Remove entry')}
              accessibilityRole="button"
              onPress={() => {
                apply(pending, null);
                setPending([]);
              }}
              style={({ pressed }) => [styles.skip, pressed && styles.pressed]}
            >
              <Text style={styles.skipText}>{tr('Entfernen', 'Remove')}</Text>
            </Pressable>
          </View>
          <View style={styles.scaleRow}>
            {steps().map(step => {
              const active = pending.every(id => values[id] === step.value);
              return (
                <Pressable
                  accessibilityLabel={step.label}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  key={step.value}
                  onPress={() => {
                    apply(pending, step.value);
                    setUsedTap(true);
                    setPending([]);
                  }}
                  style={({ pressed }) => [
                    styles.step,
                    active && styles.stepActive,
                    pressed && styles.pressed,
                  ]}
                >
                  <Text
                    style={[styles.stepValue, active && styles.stepValueActive]}
                  >
                    {step.value}
                  </Text>
                  <Text
                    adjustsFontSizeToFit
                    numberOfLines={1}
                    style={styles.stepWord}
                  >
                    {step.word}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      ) : (
        <View style={styles.footer}>
          <View style={styles.footerHalf}>
            <Button
              disabled={busy}
              label={tr('Heute nichts', 'Nothing today')}
              onPress={nothingToday}
              secondary
              title={tr('Nichts heute', 'Nothing today')}
            />
          </View>
          <View style={styles.footerHalf}>
            <Button
              disabled={busy || !answered.length}
              label={tr('Übernehmen und speichern', 'Confirm and save')}
              onPress={confirm}
              title={
                answered.length
                  ? tr(`Speichern (${answered.length})`, `Save (${answered.length})`)
                  : tr('Speichern', 'Save')
              }
            />
          </View>
        </View>
      )}
    </View>
  );
}

function Chip({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.chip, pressed && styles.pressed]}
    >
      <Text style={styles.chipText}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.bg },
  head: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space.sm,
    paddingHorizontal: space.ml,
    paddingTop: space.xs,
    paddingBottom: space.sm,
  },
  headText: { flex: 1, gap: space.xxs },
  title: { color: color.text, ...type.title, letterSpacing: -0.6 },
  subtitle: { color: color.muted, ...type.label },
  link: { minHeight: 44, justifyContent: 'center' },
  linkText: { color: color.green, ...type.label, fontWeight: '600' },
  skip: { minHeight: 44, justifyContent: 'center', paddingHorizontal: space.xs },
  skipText: { color: color.muted, ...type.label, fontWeight: '600' },
  pressed: { opacity: 0.72 },
  scroll: { flex: 1 },
  content: { paddingHorizontal: space.ml, paddingBottom: space.lg, gap: space.md },
  summary: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs },
  summaryChip: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    paddingHorizontal: space.sm,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: color.line,
    backgroundColor: color.surface,
  },
  summaryValue: {
    color: color.text,
    ...type.body,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  summaryName: { color: color.muted, ...type.label },
  notice: { color: color.text, ...type.label },
  question: {
    backgroundColor: color.surface,
    borderRadius: radius.md,
    padding: space.md,
    gap: space.sm,
  },
  questionText: { color: color.text, ...type.body },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs },
  chip: {
    minHeight: 48,
    justifyContent: 'center',
    paddingHorizontal: space.md,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: color.line,
    backgroundColor: color.raised,
  },
  chipText: { color: color.text, ...type.label },
  footer: {
    flexDirection: 'row',
    gap: space.sm,
    paddingHorizontal: space.ml,
    paddingTop: space.sm,
    paddingBottom: space.md,
    borderTopWidth: 1,
    borderTopColor: color.line,
    backgroundColor: color.bg,
  },
  footerHalf: { flex: 1 },
  sheet: {
    gap: space.sm,
    paddingHorizontal: space.ml,
    paddingTop: space.sm,
    paddingBottom: space.md,
    backgroundColor: color.surface,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    borderTopWidth: 1,
    borderTopColor: color.line,
  },
  sheetHead: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  sheetTitle: { flex: 1, color: color.text, ...type.heading },
  scaleRow: { flexDirection: 'row', gap: space.xxs },
  step: {
    flex: 1,
    minHeight: 60,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: color.line,
    backgroundColor: color.raised,
    paddingHorizontal: 2,
  },
  stepActive: { backgroundColor: color.greenSoft, borderColor: color.green },
  stepValue: {
    color: color.text,
    ...type.heading,
    fontVariant: ['tabular-nums'],
  },
  stepValueActive: { color: color.green },
  stepWord: { color: color.muted, ...type.micro },
});
