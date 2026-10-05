import React from 'react';
import { Alert } from 'react-native';
import {
  importBatchCounts,
  importBatchTitle,
  type ImportBatch,
} from '../domain/importReview';
import { Button, Copy, Disclosure, EmptyState, Notice, Title } from './components';

const dayFormat = new Intl.DateTimeFormat('de-DE', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
});

/**
 * Deine Importe: jeder Import lässt sich als Ganzes löschen und danach neu
 * importieren. Was ein anderer Import ebenfalls geliefert hat, bleibt;
 * gespeicherte Vorlagen und eigene Aufzeichnungen gehören keinem Import.
 */
export function ImportHistory({
  batches,
  error,
  busy,
  onDelete,
  onImport,
}: {
  batches: ImportBatch[] | null;
  error?: string;
  busy: boolean;
  onDelete: (batch: ImportBatch) => void;
  onImport: () => void;
}) {
  const confirm = (batch: ImportBatch) =>
    Alert.alert(
      'Import löschen?',
      `${importBatchCounts(batch)} verschwinden, sofern kein anderer Import sie enthält. Gespeicherte Vorlagen bleiben; du kannst die Dateien später neu importieren.`,
      [
        { text: 'Behalten', style: 'cancel' },
        {
          text: 'Import löschen',
          style: 'destructive',
          onPress: () => onDelete(batch),
        },
      ],
    );

  return (
    <>
      <Title>Deine Importe</Title>
      {error ? <Notice>{error}</Notice> : null}
      {batches === null && !error ? <Copy muted>Lade Importe …</Copy> : null}
      {batches?.length === 0 ? (
        <EmptyState
          title="Noch keine Importe"
          copy="Was du aus anderen Apps importierst, erscheint hier."
          action={{ title: 'Dateien importieren', onPress: onImport }}
        />
      ) : null}
      {batches?.map(batch => (
        <Disclosure
          key={batch.id}
          title={importBatchTitle(batch)}
          subtitle={[
            batch.createdAt ? dayFormat.format(new Date(batch.createdAt)) : '',
            importBatchCounts(batch),
          ]
            .filter(Boolean)
            .join(' · ')}
        >
          {batch.files.length ? (
            <Copy muted>{batch.files.join(', ')}</Copy>
          ) : null}
          {batch.state === 'cancelled' || batch.state === 'failed' ? (
            <Copy muted>Abgebrochen — nur ein Teil wurde gespeichert.</Copy>
          ) : null}
          {batch.counts.strength && !batch.templateSuggestions ? (
            <Copy muted>Ohne Vorlagenvorschläge importiert.</Copy>
          ) : null}
          <Button
            danger
            small
            title="Import löschen"
            disabled={busy}
            onPress={() => confirm(batch)}
          />
        </Disclosure>
      ))}
    </>
  );
}
