import React, { useState } from 'react';
import {
  BROAD_FOCUS,
  FOCUS_VERSION,
  focusLabel,
  focusTypesFor,
  suggestedFocus,
  type FocusKind,
  type TrainingFocus,
} from '../domain/focus';
import { areaLabel } from '../domain/areas';
import type { Area } from '../domain/types';
import {
  Button,
  ChipGroup,
  Copy,
  Field,
  Input,
  Notice,
  Section,
  Title,
} from './components';
import { dateToInput, inputToDate } from './dateInput';
import { tr } from '../domain/i18n';

/**
 * Focus of an area. For strength training, the page also carries the goal,
 * because there is no separate "Goal & everyday life" page there.
 */
export function FocusEditor({
  area = 'running',
  focus,
  goal,
  persist,
  goalEditor,
}: {
  area?: Area;
  focus?: TrainingFocus | null;
  goal: string;
  persist: (focus: TrainingFocus | null) => Promise<void>;
  goalEditor?: {
    value: string;
    targetDate: string;
    persist: (goal: string, targetDate: string) => Promise<void>;
  };
}) {
  const [kind, setKind] = useState<FocusKind | ''>(focus?.kind || '');
  const [label, setLabel] = useState(focus?.label || '');
  const [goalInput, setGoalInput] = useState(goalEditor?.value || '');
  const [targetInput, setTargetInput] = useState(
    dateToInput(goalEditor?.targetDate),
  );
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const suggestion = suggestedFocus(goal, area);
  const types = focusTypesFor(area);
  async function run(task: () => Promise<void>, done: string) {
    setBusy(true);
    setMessage('');
    try {
      await task();
      setMessage(done);
    } catch {
      setMessage(
        tr(
          'Speichern hat nicht geklappt. Versuche es erneut.',
          "Saving didn't work. Try again.",
        ),
      );
    } finally {
      setBusy(false);
    }
  }
  async function save(next: TrainingFocus | null) {
    await run(
      async () => {
        await persist(next);
        setKind(next?.kind || '');
        setLabel(next?.label || '');
      },
      next
        ? tr('Fokus gespeichert.', 'Focus saved.')
        : tr('Fokus entfernt.', 'Focus removed.'),
    );
  }
  return (
    <>
      <Title>{tr('Dein Fokus', 'Your focus')}</Title>
      <Copy muted>
        {areaLabel(area)} ·{' '}
        {tr('Woran möchtest du arbeiten?', 'What do you want to work on?')}
      </Copy>
      {message ? (
        <Notice onDismiss={() => setMessage('')}>{message}</Notice>
      ) : null}
      {goalEditor ? (
        <Section title={tr('Dein Ziel', 'Your goal')}>
          <Field label={tr('Ziel (optional)', 'Goal (optional)')}>
            <Input
              label={tr('Ziel im Krafttraining', 'Strength training goal')}
              value={goalInput}
              onChangeText={setGoalInput}
              editable={!busy}
              placeholder={tr(
                'Zum Beispiel: 100 kg Kniebeuge',
                'For example: 100 kg squat',
              )}
            />
          </Field>
          <Field label={tr('Zieldatum (optional)', 'Target date (optional)')}>
            <Input
              label={tr(
                'Zieldatum im Krafttraining',
                'Strength training target date',
              )}
              value={targetInput}
              onChangeText={setTargetInput}
              editable={!busy}
              placeholder={tr('TT.MM.JJJJ', 'DD.MM.YYYY')}
            />
          </Field>
          <Button
            secondary
            title={tr('Ziel speichern', 'Save goal')}
            disabled={busy}
            onPress={() => {
              const targetDate = inputToDate(targetInput);
              if (targetDate === null) {
                setMessage(
                  tr(
                    'Gib das Zieldatum als TT.MM.JJJJ ein.',
                    'Enter the target date as DD.MM.YYYY.',
                  ),
                );
                return;
              }
              void run(
                () => goalEditor.persist(goalInput.trim(), targetDate),
                goalInput.trim()
                  ? tr('Ziel gespeichert.', 'Goal saved.')
                  : tr('Ziel entfernt.', 'Goal removed.'),
              );
            }}
          />
        </Section>
      ) : null}
      <Section title={tr('Fokus-Art', 'Focus type')}>
        <ChipGroup
          label={tr('Fokus-Art', 'Focus type')}
          options={types.map(item => ({ ...item }))}
          value={kind}
          onChange={value => setKind(value as FocusKind)}
          disabled={busy}
        />
        {!focus && suggestion && !kind ? (
          <Button
            secondary
            title={`${tr(
              'Vorschlag übernehmen',
              'Apply suggestion',
            )}: ${focusLabel({
              version: FOCUS_VERSION,
              kind: suggestion,
              label: '',
              area,
            })}`}
            onPress={() => setKind(suggestion)}
            disabled={busy}
          />
        ) : null}
        {kind && BROAD_FOCUS.includes(kind) ? (
          <Copy muted>
            {tr(
              'Für diesen breiten Fokus zählen passende Daten und gut umsetzbare Empfehlungen.',
              'For this broad focus, matching data and recommendations you can act on count.',
            )}
          </Copy>
        ) : null}
      </Section>
      <Field
        label={tr('Eigene Bezeichnung (optional)', 'Custom label (optional)')}
      >
        <Input
          label={tr('Eigene Fokusbezeichnung', 'Custom focus label')}
          value={label}
          onChangeText={setLabel}
          editable={!busy}
          placeholder={tr(
            'Zum Beispiel: gut durch den Winter',
            'For example: getting through winter well',
          )}
        />
      </Field>
      <Button
        title={tr('Fokus speichern', 'Save focus')}
        disabled={busy || !kind}
        onPress={() =>
          kind &&
          void save({ version: FOCUS_VERSION, kind, label: label.trim(), area })
        }
      />
      {focus ? (
        <>
          <Button
            secondary
            title={tr('Fokus entfernen', 'Remove focus')}
            disabled={busy}
            onPress={() => void save(null)}
          />
          <Copy muted>
            {tr(
              'Eine laufende Empfehlung bleibt mit ihren bisherigen Regeln bestehen.',
              'A running recommendation keeps its previous rules.',
            )}
          </Copy>
        </>
      ) : null}
    </>
  );
}
