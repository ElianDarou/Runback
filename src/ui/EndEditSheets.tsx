import React, { useEffect, useState } from 'react';
import {
  heartTrack,
  runEndSuggestion,
  runTracks,
  strengthEndSuggestion,
  strengthSetTimes,
} from '../domain/endCorrection';
import type { StrengthSession } from '../domain/strength';
import { heartSourceLabel } from '../domain/strengthHeart';
import {
  native,
  type RunEndEditorData,
  type StrengthEndEditorData,
} from '../native';
import { tr } from '../domain/i18n';
import { Copy, Notice, Sheet, color } from './components';
import { EndEditor } from './EndEditor';

/** Loads when opened; errors appear in the sheet so the way back stays clear. */
function useEditorData<T>(
  visible: boolean,
  load: () => Promise<T>,
  key: string,
) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!visible) return;
    let current = true;
    setData(null);
    setError('');
    load()
      .then(result => current && setData(result))
      .catch(
        e =>
          current &&
          setError(
            e instanceof Error
              ? e.message
              : tr(
                  'Der Verlauf ließ sich nicht laden.',
                  'The history could not be loaded.',
                ),
          ),
      );
    return () => {
      current = false;
    };
    // `load` only depends on the key.
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
      setSaveError(
        e instanceof Error
          ? e.message
          : tr(
              'Das Ende ließ sich nicht speichern.',
              'The end could not be saved.',
            ),
      );
    } finally {
      setBusy(false);
    }
  };
  const originalEnd = data
    ? data.recordedEndTime ?? data.reportedEndTime
    : undefined;
  const marks = strengthSetTimes(session);
  return (
    <Sheet
      visible={visible}
      title={tr('Ende bearbeiten', 'Edit end')}
      onClose={onClose}
    >
      {error ? <Notice>{error}</Notice> : null}
      {saveError ? <Notice>{saveError}</Notice> : null}
      {!data && !error ? (
        <Copy muted>{tr('Lade Verlauf …', 'Loading history …')}</Copy>
      ) : null}
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
                    label: tr(
                      `Puls · ${heartSourceLabel(data.heart)}`,
                      `Heart rate · ${heartSourceLabel(data.heart)}`,
                    ),
                    unit: 'bpm',
                    stroke: color.series.heart,
                    points: heartTrack(data.heart),
                  },
                ]
              : []
          }
          marks={marks}
          emptyHint={tr(
            'Für diese Zeit gibt es keinen Puls. Importiere ihn aus Fitbit oder Google Fit oder setze das Ende nach Gefühl.',
            'There is no heart rate for this time. Import it from Fitbit or Google Fit, or set the end by feel.',
          )}
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
      setSaveError(
        e instanceof Error
          ? e.message
          : tr(
              'Das Ende ließ sich nicht speichern.',
              'The end could not be saved.',
            ),
      );
    } finally {
      setBusy(false);
    }
  };
  const tracks = data ? runTracks(data.startTime, data.series) : null;
  return (
    <Sheet
      visible={visible}
      title={tr('Ende bearbeiten', 'Edit end')}
      onClose={onClose}
    >
      {error ? <Notice>{error}</Notice> : null}
      {saveError ? <Notice>{saveError}</Notice> : null}
      {!data && !error ? (
        <Copy muted>{tr('Lade Verlauf …', 'Loading history …')}</Copy>
      ) : null}
      {data && !data.series ? (
        <Copy>
          {tr(
            'Ohne aufgezeichneten Verlauf lässt sich das Ende nicht prüfen.',
            'Without a recorded history, the end cannot be checked.',
          )}
        </Copy>
      ) : null}
      {data && data.series && data.blockedReason ? (
        <Copy>{data.blockedReason}</Copy>
      ) : null}
      {data && data.series && !data.blockedReason && tracks ? (
        <EndEditor
          key={`${data.startTime}:${data.correctedEndTime ?? ''}`}
          startTime={data.startTime}
          rangeEnd={data.originalEndTime}
          originalEnd={data.originalEndTime}
          currentEnd={data.correctedEndTime}
          suggestion={runEndSuggestion(
            data.startTime,
            data.series,
            data.originalEndTime,
          )}
          lines={[
            {
              key: 'speed',
              label: tr('Tempo', 'Pace'),
              unit: 'km/h',
              stroke: color.green,
              points: tracks.speed,
            },
            {
              key: 'heart',
              label: tr('Puls', 'Heart rate'),
              unit: 'bpm',
              stroke: color.series.heart,
              points: tracks.heart,
            },
          ]}
          emptyHint={tr(
            'Der Verlauf hat keine Bewegung und keinen Puls.',
            'The history has no movement and no heart rate.',
          )}
          busy={busy}
          onSave={endTime => void save(endTime)}
          onReset={data.correctedEndTime ? () => void save(null) : undefined}
        />
      ) : null}
    </Sheet>
  );
}
