import React, { useEffect, useState } from 'react';
import {
  heartTrack,
  runEndSuggestion,
  runTracks,
  strengthEndSuggestion,
} from '../domain/endCorrection';
import type { StrengthSession } from '../domain/strength';
import { heartSourceLabel } from '../domain/strengthHeart';
import {
  native,
  type RunEndEditorData,
  type StrengthEndEditorData,
} from '../native';
import { Copy, Notice, Sheet, color } from './components';
import { EndEditor } from './EndEditor';

/** Lädt beim Öffnen; Fehler stehen im Sheet, damit der Weg zurück klar bleibt. */
function useEditorData<T>(visible: boolean, load: () => Promise<T>, key: string) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!visible) return;
    let current = true;
    setData(null);
    setError('');
    load()
      .then(result => current && setData(result))
      .catch(e =>
        current && setError(e instanceof Error ? e.message : 'Der Verlauf ließ sich nicht laden.'),
      );
    return () => {
      current = false;
    };
    // `load` hängt nur an der Kennung.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, key]);
  return { data, error };
}

export function StrengthEndSheet({
  session,
  visible,
  onClose,
  onSaved,
}: {
  session: StrengthSession;
  visible: boolean;
  onClose: () => void;
  onSaved: (session: StrengthSession) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState('');
  const { data, error } = useEditorData<StrengthEndEditorData>(
    visible,
    () => native.strengthEndEditor(session.id),
    session.id,
  );
  const save = async (endTime: number | null) => {
    setBusy(true);
    setSaveError('');
    try {
      onSaved(await native.setStrengthEnd(session.id, endTime));
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : 'Das Ende ließ sich nicht speichern.');
    } finally {
      setBusy(false);
    }
  };
  const originalEnd = data ? data.recordedEndTime ?? data.reportedEndTime : undefined;
  const marks = session.exercises
    .flatMap(exercise => exercise.sets)
    .filter(set => set.completedAt !== undefined && !set.skipped)
    .map(set => set.completedAt as number);
  return (
    <Sheet visible={visible} title="Ende bearbeiten" onClose={onClose}>
      {error ? <Notice>{error}</Notice> : null}
      {saveError ? <Notice>{saveError}</Notice> : null}
      {!data && !error ? <Copy muted>Lade Verlauf …</Copy> : null}
      {data ? (
        <EndEditor
          key={`${data.startTime}:${data.correctedEndTime ?? ''}`}
          startTime={data.startTime}
          rangeEnd={data.rangeEnd}
          originalEnd={originalEnd}
          currentEnd={data.correctedEndTime}
          suggestion={strengthEndSuggestion(
            session,
            data.correctedEndTime ?? originalEnd,
          )}
          lines={
            data.heart
              ? [
                  {
                    key: 'heart',
                    label: `Puls · ${heartSourceLabel(data.heart)}`,
                    unit: 'bpm',
                    stroke: color.series.heart,
                    points: heartTrack(data.heart),
                  },
                ]
              : []
          }
          marks={marks}
          emptyHint="Für diese Zeit gibt es keinen Puls. Importiere ihn aus Fitbit oder Google Fit oder setze das Ende nach Gefühl."
          busy={busy}
          onSave={endTime => void save(endTime)}
          onReset={data.correctedEndTime ? () => void save(null) : undefined}
        />
      ) : null}
    </Sheet>
  );
}

export function RunEndSheet({
  runId,
  visible,
  onClose,
  onSaved,
}: {
  runId: string;
  visible: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState('');
  const { data, error } = useEditorData<RunEndEditorData>(
    visible,
    () => native.runEndEditor(runId),
    runId,
  );
  const save = async (endTime: number | null) => {
    setBusy(true);
    setSaveError('');
    try {
      await native.setRunEnd(runId, endTime);
      onSaved();
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : 'Das Ende ließ sich nicht speichern.');
    } finally {
      setBusy(false);
    }
  };
  const tracks = data ? runTracks(data.startTime, data.series) : null;
  return (
    <Sheet visible={visible} title="Ende bearbeiten" onClose={onClose}>
      {error ? <Notice>{error}</Notice> : null}
      {saveError ? <Notice>{saveError}</Notice> : null}
      {!data && !error ? <Copy muted>Lade Verlauf …</Copy> : null}
      {data && !data.series ? (
        <Copy>Ohne aufgezeichneten Verlauf lässt sich das Ende nicht prüfen.</Copy>
      ) : null}
      {data && data.series && tracks ? (
        <EndEditor
          key={`${data.startTime}:${data.correctedEndTime ?? ''}`}
          startTime={data.startTime}
          rangeEnd={data.originalEndTime}
          originalEnd={data.originalEndTime}
          currentEnd={data.correctedEndTime}
          suggestion={runEndSuggestion(data.startTime, data.series, data.originalEndTime)}
          lines={[
            {
              key: 'speed',
              label: 'Tempo',
              unit: 'km/h',
              stroke: color.green,
              points: tracks.speed,
            },
            {
              key: 'heart',
              label: 'Puls',
              unit: 'bpm',
              stroke: color.series.heart,
              points: tracks.heart,
            },
          ]}
          emptyHint="Der Verlauf hat keine Bewegung und keinen Puls."
          busy={busy}
          onSave={endTime => void save(endTime)}
          onReset={data.correctedEndTime ? () => void save(null) : undefined}
        />
      ) : null}
    </Sheet>
  );
}
