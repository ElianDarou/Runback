import React, { useState } from 'react';
import { Button, Copy, Field, Input, Notice, Title } from './components';
import { dateToInput, inputToDate } from './dateInput';
import { tr } from '../domain/i18n';

/** Goal of the strength area: free text and an optional target date. */
export function StrengthGoalEditor({
  goal,
  targetDate,
  persist,
}: {
  goal: string;
  targetDate: string;
  persist: (goal: string, targetDate: string) => Promise<void>;
}) {
  const [goalInput, setGoalInput] = useState(goal);
  const [targetInput, setTargetInput] = useState(dateToInput(targetDate));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const save = async () => {
    const date = inputToDate(targetInput);
    if (date === null) {
      setMessage(
        tr(
          'Gib das Zieldatum als TT.MM.JJJJ ein.',
          'Enter the target date as DD.MM.YYYY.',
        ),
      );
      return;
    }
    setBusy(true);
    setMessage('');
    try {
      await persist(goalInput.trim(), date);
      setMessage(
        goalInput.trim()
          ? tr('Ziel gespeichert.', 'Goal saved.')
          : tr('Ziel entfernt.', 'Goal removed.'),
      );
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
  };
  return (
    <>
      <Title>{tr('Ziel im Krafttraining', 'Strength training goal')}</Title>
      <Copy muted>
        {tr(
          'Das Ziel steht in deinem Krafttraining-Export.',
          'The goal appears in your strength training export.',
        )}
      </Copy>
      {message ? (
        <Notice onDismiss={() => setMessage('')}>{message}</Notice>
      ) : null}
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
        title={tr('Ziel speichern', 'Save goal')}
        disabled={busy}
        onPress={() => void save()}
      />
    </>
  );
}
