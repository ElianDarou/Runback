import React from 'react';
import { Alert } from 'react-native';
import {
  importBatchCounts,
  importBatchTitle,
  type ImportBatch,
} from '../domain/importReview';
import { dateFormat, tr } from '../domain/i18n';
import { Button, Copy, Disclosure, EmptyState, Notice, Title } from './components';

/**
 * Your imports: each import can be deleted as a whole and then imported again.
 * What another import also delivered stays; saved templates and your own
 * recordings do not belong to an import.
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
      tr('Import löschen?', 'Delete import?'),
      tr(
        `${importBatchCounts(batch)} verschwinden, sofern kein anderer Import sie enthält. Gespeicherte Vorlagen bleiben; du kannst die Dateien später neu importieren.`,
        `${importBatchCounts(batch)} will be removed unless another import contains them. Saved templates stay; you can import the files again later.`,
      ),
      [
        { text: tr('Behalten', 'Keep'), style: 'cancel' },
        {
          text: tr('Import löschen', 'Delete import'),
          style: 'destructive',
          onPress: () => onDelete(batch),
        },
      ],
    );

  return (
    <>
      <Title>{tr('Deine Importe', 'Your imports')}</Title>
      {error ? <Notice>{error}</Notice> : null}
      {batches === null && !error ? (
        <Copy muted>{tr('Lade Importe …', 'Loading imports …')}</Copy>
      ) : null}
      {batches?.length === 0 ? (
        <EmptyState
          title={tr('Noch keine Importe', 'No imports yet')}
          copy={tr(
            'Was du aus anderen Apps importierst, erscheint hier.',
            'What you import from other apps shows up here.',
          )}
          action={{
            title: tr('Dateien importieren', 'Import files'),
            onPress: onImport,
          }}
        />
      ) : null}
      {batches?.map(batch => (
        <Disclosure
          key={batch.id}
          title={importBatchTitle(batch)}
          subtitle={[
            batch.createdAt
              ? dateFormat({
                  day: '2-digit',
                  month: '2-digit',
                  year: 'numeric',
                }).format(new Date(batch.createdAt))
              : '',
            importBatchCounts(batch),
          ]
            .filter(Boolean)
            .join(' · ')}
        >
          {batch.files.length ? (
            <Copy muted>{batch.files.join(', ')}</Copy>
          ) : null}
          {batch.state === 'cancelled' || batch.state === 'failed' ? (
            <Copy muted>
              {tr(
                'Abgebrochen — nur ein Teil wurde gespeichert.',
                'Cancelled — only part of it was saved.',
              )}
            </Copy>
          ) : null}
          {batch.counts.strength && !batch.templateSuggestions ? (
            <Copy muted>
              {tr(
                'Ohne Vorlagenvorschläge importiert.',
                'Imported without template suggestions.',
              )}
            </Copy>
          ) : null}
          <Button
            danger
            small
            title={tr('Import löschen', 'Delete import')}
            disabled={busy}
            onPress={() => confirm(batch)}
          />
        </Disclosure>
      ))}
    </>
  );
}
