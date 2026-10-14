import React, { useState } from 'react';
import {
  Button,
  Copy,
  Field,
  Input,
  Notice,
  Row,
  Section,
  Title,
} from './components';
import { dateToInput, inputToDate } from './dateInput';
import { ExercisePicker } from './ExercisePicker';
import { exerciseDisplayName } from '../domain/catalog';
import { tr } from '../domain/i18n';
import {
  normalizeStrengthTarget,
  type StrengthTarget,
} from '../domain/strengthGoal';

const plain = (value: number | undefined) =>
  value === undefined ? '' : String(value).replace('.', ',');

/**
 * Goal of the strength area: a load for one exercise at a number of reps,
 * which Development measures against your sets, plus optional free text and
 * a target date.
 */
export function StrengthGoalEditor({
  goal,
  targetDate,
  target,
  persist,
}: {
  goal: string;
  targetDate: string;
  target?: StrengthTarget;
  persist: (
    goal: string,
    targetDate: string,
    target: StrengthTarget | undefined,
  ) => Promise<void>;
}) {
  const [goalInput, setGoalInput] = useState(goal);
  const [targetInput, setTargetInput] = useState(dateToInput(targetDate));
  const [exercise, setExercise] = useState(
    target ? { id: target.exerciseId, name: target.name } : null,
  );
  const [kgInput, setKgInput] = useState(plain(target?.kg));
  const [repsInput, setRepsInput] = useState(plain(target?.reps ?? 1));
  const [picking, setPicking] = useState(false);
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
    let nextTarget: StrengthTarget | undefined;
    if (exercise) {
      nextTarget = normalizeStrengthTarget({
        exerciseId: exercise.id,
        name: exercise.name,
        kg: Number(kgInput.trim().replace(',', '.')),
        reps: Number(repsInput.trim()),
      });
      if (!nextTarget) {
        setMessage(
          tr(
            'Gib ein Gewicht über 0 kg und 1 bis 100 Wiederholungen ein.',
            'Enter a load above 0 kg and 1 to 100 reps.',
          ),
        );
        return;
      }
    }
    setBusy(true);
    setMessage('');
    try {
      await persist(goalInput.trim(), date, nextTarget);
      setMessage(
        goalInput.trim() || nextTarget
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
      {message ? (
        <Notice onDismiss={() => setMessage('')}>{message}</Notice>
      ) : null}
      <Section title={tr('Messbar', 'Measurable')}>
        <Row
          title={tr('Übung', 'Exercise')}
          subtitle={
            exercise
              ? exerciseDisplayName(exercise.id, exercise.name)
              : tr('Keine gewählt', 'None chosen')
          }
          onPress={() => setPicking(true)}
          disabled={busy}
        />
        {exercise ? (
          <>
            <Field label={tr('Gewicht in kg', 'Load in kg')}>
              <Input
                label={tr('Zielgewicht in kg', 'Target load in kg')}
                value={kgInput}
                onChangeText={setKgInput}
                editable={!busy}
                keyboardType="decimal-pad"
                placeholder="100"
              />
            </Field>
            <Field label={tr('Wiederholungen', 'Reps')}>
              <Input
                label={tr('Wiederholungen je Satz', 'Reps per set')}
                value={repsInput}
                onChangeText={setRepsInput}
                editable={!busy}
                keyboardType="number-pad"
                placeholder="5"
              />
            </Field>
            <Button
              secondary
              small
              title={tr('Übung entfernen', 'Remove exercise')}
              disabled={busy}
              onPress={() => setExercise(null)}
            />
          </>
        ) : (
          <Copy muted>
            {tr(
              'Mit Übung und Gewicht zeigt Entwicklung, wie nah du dran bist.',
              'With an exercise and load, Progress shows how close you are.',
            )}
          </Copy>
        )}
      </Section>
      <Field label={tr('Beschreibung (optional)', 'Description (optional)')}>
        <Input
          label={tr('Ziel im Krafttraining', 'Strength training goal')}
          value={goalInput}
          onChangeText={setGoalInput}
          editable={!busy}
          placeholder={tr(
            'Zum Beispiel: Kraft für den Bergsommer',
            'For example: strength for the mountain summer',
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
      <ExercisePicker
        visible={picking}
        onClose={() => setPicking(false)}
        onSelect={picked => {
          setExercise({ id: picked.id, name: picked.name });
          setPicking(false);
        }}
      />
    </>
  );
}
