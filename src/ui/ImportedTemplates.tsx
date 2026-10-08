import React, { useEffect, useMemo, useState } from 'react';
import { nativeCall } from '../native';
import {
  importedTemplateCandidates,
  type ImportedTemplate,
} from '../domain/strengthImports';
import type { StrongWorkout } from '../domain/vendorImports';
import type { WorkoutTemplate } from '../domain/strength';
import { formatWeight } from '../domain/strength';
import { locale, tr } from '../domain/i18n';
import {
  Button,
  Copy,
  Disclosure,
  Notice,
  Row,
  Section,
  Sheet,
} from './components';

/** Import preview where the templates are; saving needs its own user action. */
export function ImportedTemplates({
  templates,
  onSave,
  onDismiss,
  dismissedIds = [],
  busy,
  refreshKey = '',
}: {
  templates: WorkoutTemplate[];
  onSave: (template: WorkoutTemplate) => Promise<void>;
  onDismiss: (id: string) => Promise<void>;
  dismissedIds?: readonly string[];
  busy: boolean;
  refreshKey?: string;
}) {
  const [workouts, setWorkouts] = useState<StrongWorkout[]>([]);
  const [selected, setSelected] = useState<ImportedTemplate | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState('');
  const [omitted, setOmitted] = useState(0);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    nativeCall<{ workouts?: StrongWorkout[]; omitted?: number }>(
      'getStrengthImportCandidates',
    )
      .then(result => {
        if (active) {
          setWorkouts(result.workouts ?? []);
          setOmitted(result.omitted ?? 0);
        }
      })
      .catch(() => {
        if (active)
          setError(
            tr(
              'Vorlagen konnten nicht geladen werden.',
              'Templates could not be loaded.',
            ),
          );
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [retry, refreshKey]);
  const candidates = useMemo(
    () => importedTemplateCandidates(workouts, templates, dismissedIds),
    [workouts, templates, dismissedIds],
  );
  const incomplete = workouts.filter(workout => workout.incomplete).length;
  const save = async () => {
    if (!selected || saving || busy) return;
    setSaving(true);
    setError('');
    try {
      await onSave(selected.template);
      setSelected(null);
    } catch {
      setError(
        tr(
          'Vorlage konnte nicht gespeichert werden.',
          'Template could not be saved.',
        ),
      );
    } finally {
      setSaving(false);
    }
  };
  const dismiss = async () => {
    if (!selected || saving || busy) return;
    setSaving(true);
    setError('');
    try {
      await onDismiss(selected.template.id);
      setSelected(null);
      setConfirmDelete(false);
    } catch {
      setError(
        tr(
          'Vorschlag konnte nicht gelöscht werden.',
          'Suggestion could not be deleted.',
        ),
      );
    } finally {
      setSaving(false);
    }
  };
  if (loading)
    return (
      <Copy muted>{tr('Vorlagen werden geladen.', 'Loading templates.')}</Copy>
    );
  if (!candidates.length && !error && !omitted && !incomplete) return null;
  return (
    <Section title={tr('Aus deinem Import', 'From your import')}>
      {error && !selected ? (
        <>
          <Notice>{error}</Notice>
          <Button
            secondary
            small
            title={tr('Erneut laden', 'Load again')}
            onPress={() => setRetry(value => value + 1)}
            disabled={saving}
          />
        </>
      ) : null}
      {incomplete ? (
        <Copy muted>
          {tr(
            `Prüfe ${incomplete} unvollständige Einheiten; daraus entsteht keine Vorlage.`,
            `Check ${incomplete} incomplete ${incomplete === 1 ? 'workout' : 'workouts'}; no template comes from ${incomplete === 1 ? 'it' : 'them'}.`,
          )}
        </Copy>
      ) : null}
      {omitted ? (
        <Copy muted>
          {tr(
            `Begrenze den Export; ${omitted} weitere Trainingsnamen passen nicht in die Vorschau.`,
            `Narrow the export; ${omitted} more workout names do not fit in the preview.`,
          )}
        </Copy>
      ) : null}
      {candidates.length ? (
        <Copy muted>
          {tr(
            'Übernimm die letzte Einheit je Trainingsname als Vorlage.',
            'Take the latest workout for each workout name as a template.',
          )}
        </Copy>
      ) : null}
      {candidates.map(candidate => (
        <Row
          key={candidate.template.id}
          title={candidate.template.name}
          subtitle={tr(
            `${candidate.template.exercises.length} Übungen · ${candidate.source.sets.length} Sätze`,
            `${candidate.template.exercises.length} ${candidate.template.exercises.length === 1 ? 'exercise' : 'exercises'} · ${candidate.source.sets.length} ${candidate.source.sets.length === 1 ? 'set' : 'sets'}`,
          )}
          onPress={() => {
            setSelected(candidate);
            setConfirmDelete(false);
            setError('');
          }}
        />
      ))}
      <Sheet
        visible={selected !== null}
        title={selected?.template.name ?? tr('Vorlage prüfen', 'Check template')}
        onClose={() => {
          if (!saving) {
            setSelected(null);
            setConfirmDelete(false);
          }
        }}
      >
        {selected ? (
          <>
            <Copy muted>
              {tr('Prüfe die Werte aus der Einheit vom', 'Check the values from the workout on')}{' '}
              {new Date(selected.source.time).toLocaleDateString(locale())}.
            </Copy>
            {selected.warnings.map(warning => (
              <Copy muted key={warning}>
                {warning}
              </Copy>
            ))}
            {error ? <Notice>{error}</Notice> : null}
            {selected.template.exercises.map((exercise, index) => (
              <Disclosure
                key={`${exercise.exerciseId}:${index}`}
                title={tr(
                  `${exercise.name} · ${exercise.sets.length} Sätze`,
                  `${exercise.name} · ${exercise.sets.length} ${exercise.sets.length === 1 ? 'set' : 'sets'}`,
                )}
              >
                {exercise.sets.map((set, position) => (
                  <Row
                    key={position}
                    title={tr(`Satz ${position + 1}`, `Set ${position + 1}`)}
                    subtitle={[
                      set.loadKind === 'bodyweight'
                        ? tr('Eigengewicht', 'Bodyweight')
                        : set.weightKg !== undefined
                        ? `${formatWeight(set.weightKg)} kg`
                        : tr('Last unbekannt', 'Load unknown'),
                      set.reps !== undefined
                        ? tr(`${set.reps} Wdh.`, `${set.reps} reps`)
                        : '',
                      set.seconds !== undefined
                        ? `${formatWeight(set.seconds)} s`
                        : '',
                      set.restSeconds !== undefined
                        ? tr(
                            `${formatWeight(set.restSeconds)} s Pause`,
                            `${formatWeight(set.restSeconds)} s rest`,
                          )
                        : tr('Pause unbekannt', 'Rest unknown'),
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  />
                ))}
              </Disclosure>
            ))}
            <Disclosure title={tr('Details', 'Details')}>
              <Copy muted>
                {selected.source.workoutNotes ||
                  tr('Keine Trainingsnotiz', 'No workout note')}
              </Copy>
              {selected.source.sets
                .filter(
                  set => set.notes || set.rpe !== null || set.distance !== null,
                )
                .map((set, index) => (
                  <Row
                    key={index}
                    title={tr(
                      `${set.exercise} · Satz ${set.setOrder}`,
                      `${set.exercise} · Set ${set.setOrder}`,
                    )}
                    subtitle={[
                      set.notes,
                      set.rpe !== null
                        ? tr(
                            `Anstrengung ${formatWeight(set.rpe)} von 10`,
                            `Effort ${formatWeight(set.rpe)} of 10`,
                          )
                        : '',
                      set.distance !== null
                        ? `${formatWeight(set.distance)} ${set.distanceUnit === 'm' ? 'm' : tr('· Einheit unbekannt', '· unit unknown')}`
                        : '',
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  />
                ))}
              <Copy muted>
                {selected.template.importSource?.modelVersion} ·{' '}
                {selected.source.modelVersion} ·{' '}
                {selected.template.importSource?.workoutId}
              </Copy>
            </Disclosure>
            {confirmDelete ? (
              <>
                <Copy muted>
                  {tr(
                    'Lösche diesen Vorschlag dauerhaft; die importierte Einheit bleibt erhalten.',
                    'Delete this suggestion for good; the imported workout stays.',
                  )}
                </Copy>
                <Button
                  danger
                  title={
                    saving
                      ? tr('Wird gelöscht', 'Deleting')
                      : tr('Löschen bestätigen', 'Confirm delete')
                  }
                  onPress={() => void dismiss()}
                  disabled={saving || busy}
                />
                <Button
                  secondary
                  title={tr('Behalten', 'Keep')}
                  onPress={() => {
                    setConfirmDelete(false);
                    setError('');
                  }}
                  disabled={saving || busy}
                />
              </>
            ) : (
              <>
                <Button
                  title={
                    saving
                      ? tr('Wird übernommen', 'Saving')
                      : tr('Vorlage übernehmen', 'Save template')
                  }
                  onPress={() => void save()}
                  disabled={saving || busy}
                />
                <Button
                  danger
                  title={tr('Vorschlag löschen', 'Delete suggestion')}
                  onPress={() => setConfirmDelete(true)}
                  disabled={saving || busy}
                />
              </>
            )}
          </>
        ) : null}
      </Sheet>
    </Section>
  );
}
