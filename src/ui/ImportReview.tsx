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
export interface ImportProblems {
  failed: number;
  skipped: number;
  nonRunning: number;
  errors: string[];
}

export function ImportReview({
  preview,
  files,
  problems,
  busy,
  onCommit,
  onDiscard,
}: {
  preview: ImportPreview;
  files: string[];
  /** Was beim Lesen nicht ging; steht vor der Wahl, damit nichts still fehlt. */
  problems?: ImportProblems;
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

  const problemLines = [
    problems?.failed
      ? `${formatCount(problems.failed)} ${
          problems.failed === 1 ? 'Datei ließ' : 'Dateien ließen'
        } sich nicht lesen.`
      : '',
    problems?.skipped
      ? `${formatCount(problems.skipped)} Dateien oder Zeilen übersprungen.`
      : '',
    problems?.nonRunning
      ? `${formatCount(problems.nonRunning)} Aktivitäten sind keine Läufe.`
      : '',
    preview.runs.deleted
      ? `${formatCount(preview.runs.deleted)} von dir gelöschte Läufe bleiben gelöscht.`
      : '',
  ].filter(Boolean);
  const problemBlock =
    problemLines.length || problems?.errors.length ? (
      <Section title="Nicht dabei">
        {problemLines.map(line => (
          <Copy muted key={line}>
            {line}
          </Copy>
        ))}
        {(problems?.errors ?? []).slice(0, 5).map((line, i) => (
          <Copy muted key={`e${i}`}>
            {line}
          </Copy>
        ))}
      </Section>
    ) : null;
  const somethingKnown =
    preview.runs.duplicates +
      preview.strength.duplicates +
      Object.keys(preview.wellnessKnown).length >
    0;

  if (!hasNewData(preview)) {
    return (
      <>
        {fileLine ? <Copy muted>{fileLine}</Copy> : null}
        <Copy>
          {somethingKnown
            ? 'Alles Lesbare aus diesen Dateien ist schon gespeichert.'
            : 'In diesen Dateien hat Runback nichts gefunden, was es übernehmen kann.'}
        </Copy>
        {problemBlock}
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
      {problemBlock}
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
          {preview.strength.omitted ? (
            <Copy muted>{`Weitere ${formatCount(
              preview.strength.omitted,
            )} Krafteinheiten übernimmst du mit den Vorgaben.`}</Copy>
          ) : null}
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
