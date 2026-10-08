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
import { dateFormat, tr } from '../domain/i18n';
import { displaySessionName } from '../domain/strength';

const formatDay = (time: number) =>
  dateFormat({ day: '2-digit', month: '2-digit', year: 'numeric' }).format(
    new Date(time),
  );

const setsLabel = (n: number) =>
  `${formatCount(n)} ${n === 1 ? tr('Satz', 'set') : tr('Sätze', 'sets')}`;

function workoutSubtitle(workout: PreviewWorkout): string {
  return [
    formatDay(workout.time),
    setsLabel(workout.sets),
    workout.durationSeconds !== null
      ? formatDuration(workout.durationSeconds)
      : '',
    workout.incomplete ? tr('Unvollständig', 'Incomplete') : '',
  ]
    .filter(Boolean)
    .join(' · ');
}

/**
 * Content of the "Check import" sheet: nothing is saved until the user accepts.
 * The default is everything new; suspicious Strong durations stay open.
 * The choice lasts as long as the preview: a new preview gets a new `key`
 * (token) and starts again from the default.
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
  /** What could not be read; shown before the choice so nothing goes missing silently. */
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
      (files.length > 3
        ? tr(
            ` und ${files.length - 3} weitere`,
            ` and ${files.length - 3} more`,
          )
        : '')
    : '';

  const problemLines = [
    problems?.failed
      ? tr(
          `${formatCount(problems.failed)} ${
            problems.failed === 1 ? 'Datei ließ' : 'Dateien ließen'
          } sich nicht lesen.`,
          `${formatCount(problems.failed)} ${
            problems.failed === 1 ? 'file' : 'files'
          } could not be read.`,
        )
      : '',
    problems?.skipped
      ? tr(
          `${formatCount(problems.skipped)} Dateien oder Zeilen übersprungen.`,
          `${formatCount(problems.skipped)} files or rows skipped.`,
        )
      : '',
    problems?.nonRunning
      ? tr(
          `${formatCount(problems.nonRunning)} Aktivitäten sind keine Läufe.`,
          `${formatCount(problems.nonRunning)} activities are not runs.`,
        )
      : '',
    preview.runs.deleted
      ? tr(
          `${formatCount(preview.runs.deleted)} von dir gelöschte Läufe bleiben gelöscht.`,
          `${formatCount(preview.runs.deleted)} runs you deleted stay deleted.`,
        )
      : '',
  ].filter(Boolean);
  const problemBlock =
    problemLines.length || problems?.errors.length ? (
      <Section title={tr('Nicht dabei', 'Not included')}>
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
            ? tr(
                'Alles Lesbare aus diesen Dateien ist schon gespeichert.',
                'Everything readable in these files is already saved.',
              )
            : tr(
                'In diesen Dateien hat Runback nichts gefunden, was es übernehmen kann.',
                'Runback found nothing in these files it can import.',
              )}
        </Copy>
        {problemBlock}
        <View style={styles.actions}>
          <Button
            title={tr('Schließen', 'Close')}
            onPress={onDiscard}
            disabled={busy}
          />
        </View>
      </>
    );
  }

  const known = [
    preview.runs.duplicates
      ? tr(
          `${formatCount(preview.runs.duplicates)} Läufe`,
          `${formatCount(preview.runs.duplicates)} ${
            preview.runs.duplicates === 1 ? 'run' : 'runs'
          }`,
        )
      : '',
    preview.strength.duplicates
      ? tr(
          `${formatCount(preview.strength.duplicates)} Krafteinheiten`,
          `${formatCount(preview.strength.duplicates)} ${
            preview.strength.duplicates === 1
              ? 'strength session'
              : 'strength sessions'
          }`,
        )
      : '',
  ].filter(Boolean);

  return (
    <>
      {fileLine ? <Copy muted>{fileLine}</Copy> : null}
      {problemBlock}
      <Section title={tr('Übernehmen', 'Import')}>
        {preview.runs.new > 0 ? (
          <CheckRow
            title={tr('Läufe', 'Runs')}
            subtitle={tr(
              `${formatCount(preview.runs.new)} neu`,
              `${formatCount(preview.runs.new)} new`,
            )}
            checked={choice.runs}
            onToggle={runs => update({ runs })}
            disabled={busy}
          />
        ) : null}
        {workouts.length + preview.strength.omitted > 0 ? (
          <CheckRow
            title={tr('Krafteinheiten', 'Strength sessions')}
            subtitle={tr(
              `${formatCount(
                workouts.length + preview.strength.omitted,
              )} neu`,
              `${formatCount(
                workouts.length + preview.strength.omitted,
              )} new`,
            )}
            checked={choice.strength}
            onToggle={strength => update({ strength })}
            disabled={busy}
          />
        ) : null}
        {choice.strength && workouts.length ? (
          <CheckRow
            title={tr('Vorlagen vorschlagen', 'Suggest templates')}
            subtitle={tr(
              'Aus deinen Trainings neue Kraftvorlagen zum Prüfen.',
              'New strength templates from your workouts to review.',
            )}
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
              group.count === 1 ? tr('Wert', 'value') : tr('Werte', 'values')
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
          <Copy muted>
            {tr(
              `Schon gespeichert: ${known.join(' · ')}`,
              `Already saved: ${known.join(' · ')}`,
            )}
          </Copy>
        ) : null}
      </Section>
      {choice.strength && suspect.length ? (
        <Section title={tr('Dauer übernehmen?', 'Keep duration?')}>
          <Copy muted>
            {tr(
              'Strong speichert keine Satzzeiten. Diese Dauern passen nicht zu den Sätzen; ohne Haken bleibt das Ende offen.',
              'Strong does not save set times. These durations do not match the sets; without a tick the end stays open.',
            )}
          </Copy>
          {suspect.map(workout => (
            <CheckRow
              key={workout.id}
              title={`${
                displaySessionName(workout.name) ||
                tr('Krafttraining', 'Strength training')
              } · ${formatDay(workout.time)}`}
              subtitle={tr(
                `${formatDuration(
                  workout.durationSeconds ?? 0,
                )} für ${setsLabel(workout.sets)}`,
                `${formatDuration(
                  workout.durationSeconds ?? 0,
                )} for ${setsLabel(workout.sets)}`,
              )}
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
          title={tr(
            'Einzelne Krafteinheiten wählen',
            'Choose individual strength sessions',
          )}
          subtitle={tr(
            `${formatCount(
              workouts.length - choice.excludedStrengthIds.length,
            )} von ${formatCount(workouts.length)}`,
            `${formatCount(
              workouts.length - choice.excludedStrengthIds.length,
            )} of ${formatCount(workouts.length)}`,
          )}
        >
          {preview.strength.omitted ? (
            <Copy muted>
              {tr(
                `Weitere ${formatCount(
                  preview.strength.omitted,
                )} Krafteinheiten übernimmst du mit den Vorgaben.`,
                `You import the other ${formatCount(
                  preview.strength.omitted,
                )} strength sessions with the defaults.`,
              )}
            </Copy>
          ) : null}
          {workouts.map(workout => (
            <CheckRow
              key={workout.id}
              title={
                displaySessionName(workout.name) ||
                tr('Krafttraining', 'Strength training')
              }
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
              ? tr(
                  `${formatCount(total)} ${
                    total === 1 ? 'Eintrag' : 'Einträge'
                  } übernehmen`,
                  `Import ${formatCount(total)} ${
                    total === 1 ? 'entry' : 'entries'
                  }`,
                )
              : tr('Nichts gewählt', 'Nothing selected')
          }
          onPress={() => onCommit(choice)}
          disabled={busy || total === 0}
        />
        <Button
          secondary
          title={tr('Verwerfen', 'Discard')}
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
