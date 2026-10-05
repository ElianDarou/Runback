import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import {
  chosenCounts,
  defaultImportChoice,
  formatCount,
  hasNewData,
  toggleIn,
  wellnessGroups,
  type ImportChoice,
  type ImportPreview,
  type PreviewWorkout,
} from '../domain/importReview';
import {
  Button,
  CheckRow,
  Copy,
  Disclosure,
  Section,
  space,
} from './components';
import { formatDuration } from './StatsParts';

const dayFormat = new Intl.DateTimeFormat('de-DE', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
});

const setsLabel = (n: number) => `${formatCount(n)} ${n === 1 ? 'Satz' : 'Sätze'}`;

function workoutSubtitle(workout: PreviewWorkout): string {
  return [
    dayFormat.format(new Date(workout.time)),
    setsLabel(workout.sets),
    workout.durationSeconds !== null
      ? formatDuration(workout.durationSeconds)
      : '',
    workout.incomplete ? 'Unvollständig' : '',
  ]
    .filter(Boolean)
    .join(' · ');
}

/**
 * Inhalt des Sheets „Import prüfen“: Nichts ist gespeichert, bis der Nutzer
 * übernimmt. Vorgabe ist alles Neue; verdächtige Strong-Dauern bleiben offen.
 * Die Wahl lebt so lange wie die Vorschau: Eine neue Vorschau bekommt einen
 * neuen `key` (Token) und beginnt wieder bei der Vorgabe.
 */
export function ImportReview({
  preview,
  files,
  busy,
  onCommit,
  onDiscard,
}: {
  preview: ImportPreview;
  files: string[];
  busy: boolean;
  onCommit: (choice: ImportChoice) => void;
  onDiscard: () => void;
}) {
  const [choice, setChoice] = useState<ImportChoice>(() =>
    defaultImportChoice(preview),
  );
  const update = (patch: Partial<ImportChoice>) =>
    setChoice(current => ({ ...current, ...patch }));
  const counts = chosenCounts(preview, choice);
  const total = counts.runs + counts.strength + counts.wellness;
  const workouts = preview.strength.workouts;
  const suspect = workouts.filter(
    w => w.durationSuspect && !choice.excludedStrengthIds.includes(w.id),
  );
  const fileLine = files.length
    ? files.slice(0, 3).join(', ') +
      (files.length > 3 ? ` und ${files.length - 3} weitere` : '')
    : '';

  if (!hasNewData(preview)) {
    return (
      <>
        {fileLine ? <Copy muted>{fileLine}</Copy> : null}
        <Copy>Alles aus diesen Dateien ist schon gespeichert.</Copy>
        <View style={styles.actions}>
          <Button title="Schließen" onPress={onDiscard} disabled={busy} />
        </View>
      </>
    );
  }

  const known = [
    preview.runs.duplicates
      ? `${formatCount(preview.runs.duplicates)} Läufe`
      : '',
    preview.strength.duplicates
      ? `${formatCount(preview.strength.duplicates)} Krafteinheiten`
      : '',
  ].filter(Boolean);

  return (
    <>
      {fileLine ? <Copy muted>{fileLine}</Copy> : null}
      <Section title="Übernehmen">
        {preview.runs.new > 0 ? (
          <CheckRow
            title="Läufe"
            subtitle={`${formatCount(preview.runs.new)} neu`}
            checked={choice.runs}
            onToggle={runs => update({ runs })}
            disabled={busy}
          />
        ) : null}
        {workouts.length + preview.strength.omitted > 0 ? (
          <CheckRow
            title="Krafteinheiten"
            subtitle={`${formatCount(
              workouts.length + preview.strength.omitted,
            )} neu`}
            checked={choice.strength}
            onToggle={strength => update({ strength })}
            disabled={busy}
          />
        ) : null}
        {choice.strength && workouts.length ? (
          <CheckRow
            title="Vorlagen vorschlagen"
            subtitle="Aus deinen Trainings neue Kraftvorlagen zum Prüfen."
            checked={choice.templateSuggestions}
            onToggle={templateSuggestions => update({ templateSuggestions })}
            disabled={busy}
          />
        ) : null}
        {wellnessGroups(preview.wellness).map(group => (
          <CheckRow
            key={group.label}
            title={group.label}
            subtitle={`${formatCount(group.count)} ${
              group.count === 1 ? 'Wert' : 'Werte'
            }`}
            checked={group.kinds.every(kind =>
              choice.wellnessKinds.includes(kind),
            )}
            onToggle={on =>
              update({
                wellnessKinds: group.kinds.reduce(
                  (list, kind) => toggleIn(list, kind, on),
                  choice.wellnessKinds,
                ),
              })
            }
            disabled={busy}
          />
        ))}
        {known.length ? (
          <Copy muted>{`Schon gespeichert: ${known.join(' · ')}`}</Copy>
        ) : null}
      </Section>
      {choice.strength && suspect.length ? (
        <Section title="Dauer übernehmen?">
          <Copy muted>
            Strong speichert keine Satzzeiten. Diese Dauern passen nicht zu den
            Sätzen; ohne Haken bleibt das Ende offen.
          </Copy>
          {suspect.map(workout => (
            <CheckRow
              key={workout.id}
              title={`${workout.name || 'Krafttraining'} · ${dayFormat.format(
                new Date(workout.time),
              )}`}
              subtitle={`${formatDuration(
                workout.durationSeconds ?? 0,
              )} für ${setsLabel(workout.sets)}`}
              checked={choice.keepDurationIds.includes(workout.id)}
              onToggle={on =>
                update({
                  keepDurationIds: toggleIn(
                    choice.keepDurationIds,
                    workout.id,
                    on,
                  ),
                })
              }
              disabled={busy}
            />
          ))}
        </Section>
      ) : null}
      {choice.strength && workouts.length > 1 ? (
        <Disclosure
          title="Einzelne Krafteinheiten wählen"
          subtitle={`${formatCount(
            workouts.length - choice.excludedStrengthIds.length,
          )} von ${formatCount(workouts.length)}`}
        >
          {workouts.map(workout => (
            <CheckRow
              key={workout.id}
              title={workout.name || 'Krafttraining'}
              subtitle={workoutSubtitle(workout)}
              checked={!choice.excludedStrengthIds.includes(workout.id)}
              onToggle={on =>
                update({
                  excludedStrengthIds: toggleIn(
                    choice.excludedStrengthIds,
                    workout.id,
                    !on,
                  ),
                })
              }
              disabled={busy}
            />
          ))}
        </Disclosure>
      ) : null}
      <View style={styles.actions}>
        <Button
          title={
            total
              ? `${formatCount(total)} ${
                  total === 1 ? 'Eintrag' : 'Einträge'
                } übernehmen`
              : 'Nichts gewählt'
          }
          onPress={() => onCommit(choice)}
          disabled={busy || total === 0}
        />
        <Button
          secondary
          title="Verwerfen"
          onPress={onDiscard}
          disabled={busy}
        />
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  actions: { marginTop: space.ml, gap: space.sm },
});
