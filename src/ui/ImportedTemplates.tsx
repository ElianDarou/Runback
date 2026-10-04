import React, { useEffect, useMemo, useState } from 'react';
import { nativeCall } from '../native';
import {
  importedTemplateCandidates,
  type ImportedTemplate,
} from '../domain/strengthImports';
import type { StrongWorkout } from '../domain/vendorImports';
import type { WorkoutTemplate } from '../domain/strength';
import { formatWeight } from '../domain/strength';
import {
  Button,
  Copy,
  Disclosure,
  Notice,
  Row,
  Section,
  Sheet,
} from './components';

/** Importvorschau am Ort der Vorlagen; Speichern braucht eine eigene Nutzeraktion. */
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
        if (active) setError('Vorlagen konnten nicht geladen werden.');
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
      setError('Vorlage konnte nicht gespeichert werden.');
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
      setError('Vorschlag konnte nicht gelöscht werden.');
    } finally {
      setSaving(false);
    }
  };
  if (loading) return <Copy muted>Vorlagen werden geladen.</Copy>;
  if (!candidates.length && !error && !omitted && !incomplete) return null;
  return (
    <Section title="Aus deinem Import">
      {error && !selected ? (
        <>
          <Notice>{error}</Notice>
          <Button
            secondary
            small
            title="Erneut laden"
            onPress={() => setRetry(value => value + 1)}
            disabled={saving}
          />
        </>
      ) : null}
      {incomplete ? (
        <Copy muted>
          Prüfe {incomplete} unvollständige Einheiten; daraus entsteht keine
          Vorlage.
        </Copy>
      ) : null}
      {omitted ? (
        <Copy muted>
          Begrenze den Export; {omitted} weitere Trainingsnamen passen nicht in
          die Vorschau.
        </Copy>
      ) : null}
      {candidates.length ? (
        <Copy muted>
          Übernimm die letzte Einheit je Trainingsname als Vorlage.
        </Copy>
      ) : null}
      {candidates.map(candidate => (
        <Row
          key={candidate.template.id}
          title={candidate.template.name}
          subtitle={`${candidate.template.exercises.length} Übungen · ${candidate.source.sets.length} Sätze`}
          onPress={() => {
            setSelected(candidate);
            setConfirmDelete(false);
            setError('');
          }}
        />
      ))}
      <Sheet
        visible={selected !== null}
        title={selected?.template.name ?? 'Vorlage prüfen'}
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
              Prüfe die Werte aus der Einheit vom{' '}
              {new Date(selected.source.time).toLocaleDateString('de-DE')}.
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
                title={`${exercise.name} · ${exercise.sets.length} Sätze`}
              >
                {exercise.sets.map((set, position) => (
                  <Row
                    key={position}
                    title={`Satz ${position + 1}`}
                    subtitle={[
                      set.loadKind === 'bodyweight'
                        ? 'Eigengewicht'
                        : set.weightKg !== undefined
                        ? `${formatWeight(set.weightKg)} kg`
                        : 'Last unbekannt',
                      set.reps !== undefined ? `${set.reps} Wdh.` : '',
                      set.seconds !== undefined
                        ? `${formatWeight(set.seconds)} s`
                        : '',
                      set.restSeconds !== undefined
                        ? `${formatWeight(set.restSeconds)} s Pause`
                        : 'Pause unbekannt',
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  />
                ))}
              </Disclosure>
            ))}
            <Disclosure title="Details">
              <Copy muted>
                {selected.source.workoutNotes || 'Keine Trainingsnotiz'}
              </Copy>
              {selected.source.sets
                .filter(
                  set => set.notes || set.rpe !== null || set.distance !== null,
                )
                .map((set, index) => (
                  <Row
                    key={index}
                    title={`${set.exercise} · Satz ${set.setOrder}`}
                    subtitle={[
                      set.notes,
                      set.rpe !== null
                        ? `Anstrengung ${formatWeight(set.rpe)} von 10`
                        : '',
                      set.distance !== null
                        ? `${formatWeight(set.distance)} ${set.distanceUnit === 'm' ? 'm' : '· Einheit unbekannt'}`
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
                  Lösche diesen Vorschlag dauerhaft; die importierte Einheit
                  bleibt erhalten.
                </Copy>
                <Button
                  danger
                  title={saving ? 'Wird gelöscht' : 'Löschen bestätigen'}
                  onPress={() => void dismiss()}
                  disabled={saving || busy}
                />
                <Button
                  secondary
                  title="Behalten"
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
                  title={saving ? 'Wird übernommen' : 'Vorlage übernehmen'}
                  onPress={() => void save()}
                  disabled={saving || busy}
                />
                <Button
                  danger
                  title="Vorschlag löschen"
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
