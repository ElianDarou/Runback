import React, { useCallback, useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { nativeCall } from '../native';
import {
  VENDOR_INFOS,
  detectVendorForFile,
  type VendorId,
} from '../domain/vendorImports';
import { tr } from '../domain/i18n';
import { Button, Copy, Row, Section, Title, space } from './components';

/**
 * App imports: choose the source first, then only that source's steps.
 * Before, the guides of all providers stood on the page at once.
 * See docs/design-language.md, section "Text" (the choice first, then the steps).
 */
export function VendorImport({
  onImport,
  onCancelImport,
  onOpenDocs,
  onOpenTemplates,
  onOpenImports,
  busy,
  importStatus,
}: {
  onImport: () => void;
  onCancelImport: () => void;
  onOpenDocs?: () => void;
  onOpenTemplates?: () => void;
  onOpenImports?: () => void;
  busy: boolean;
  importStatus: any;
}) {
  const [selected, setSelected] = useState<VendorId | null>(null);
  const [summary, setSummary] = useState<any>(null);
  const status = importStatus || {};
  const vendors = status.vendors || {};
  const vendor = VENDOR_INFOS.find(item => item.id === selected) || null;

  const refreshSummary = useCallback(() => {
    nativeCall<any>('getVendorSummary')
      .then(setSummary)
      .catch(() => {});
  }, []);

  useEffect(() => {
    refreshSummary();
  }, [
    refreshSummary,
    status.imported,
    status.duplicates,
    status.state,
    status.wellness,
    status.strength,
  ]);

  const progress =
    status.state === 'running' ? (
      <>
        <Copy>
          {tr(
            `Import läuft: ${status.processed ?? 0} Dateien verarbeitet`,
            `Import running: ${status.processed ?? 0} files processed`,
          )}
          {status.currentFile ? ` · ${status.currentFile}` : ''}
        </Copy>
        <Button
          secondary
          small
          title={tr('Import abbrechen', 'Cancel import')}
          onPress={onCancelImport}
        />
      </>
    ) : null;

  // Nothing is saved during the review; the numbers are in the sheet.
  const result =
    status.state !== 'review' &&
    (status.imported !== undefined || status.wellness !== undefined) ? (
      <Copy>
        {tr(
          `Läufe: ${status.imported ?? 0} importiert · ${
            status.duplicates ?? 0
          } doppelt`,
          `Runs: ${status.imported ?? 0} imported · ${
            status.duplicates ?? 0
          } duplicate`,
        )}
        {status.wellness !== undefined
          ? tr(
              ` · Kontextwerte: ${status.wellness}`,
              ` · Context values: ${status.wellness}`,
            )
          : ''}
        {status.strength !== undefined
          ? tr(
              ` · Krafteinheiten: ${status.strength}`,
              ` · Strength sessions: ${status.strength}`,
            )
          : ''}
        {status.strengthDuplicates
          ? tr(
              ` · ${status.strengthDuplicates} Krafteinheiten doppelt`,
              ` · ${status.strengthDuplicates} strength sessions duplicate`,
            )
          : ''}
        {status.nonRunning
          ? tr(
              ` · ${status.nonRunning} keine Läufe`,
              ` · ${status.nonRunning} not runs`,
            )
          : ''}
        {status.excluded
          ? tr(
              ` · ${status.excluded} nicht gewählt`,
              ` · ${status.excluded} not selected`,
            )
          : ''}
        {status.skipped !== undefined
          ? tr(
              ` · ${status.skipped} übersprungen`,
              ` · ${status.skipped} skipped`,
            )
          : ''}
        {status.failed !== undefined
          ? tr(
              ` · ${status.failed} fehlgeschlagen`,
              ` · ${status.failed} failed`,
            )
          : ''}
      </Copy>
    ) : null;

  const errors = (status.errors || [])
    .slice(0, 20)
    .map((item: any, i: number) => (
      <Copy muted key={i}>
        {item.file ? `${item.file}: ` : ''}
        {item.message || item.reason || String(item)}
      </Copy>
    ));

  if (vendor) {
    const counts = vendors[vendor.id] || vendors[vendor.id.replace('_', '')];
    return (
      <>
        <Title>{vendor.name}</Title>
        <Copy muted>{vendor.short}</Copy>
        {progress}
        {result}
        {errors}
        {vendor.id === 'strong' && onOpenTemplates ? (
          <Row
            title={tr('Vorlagen ansehen', 'View templates')}
            subtitle={tr(
              'Prüfe und übernimm deine importierten Trainings.',
              'Check and save your imported workouts.',
            )}
            onPress={onOpenTemplates}
          />
        ) : null}
        <Section title={tr('So exportierst du', 'How to export')}>
          {vendor.exportSteps.map((step, i) => (
            <Copy key={i}>
              {i + 1}. {step}
            </Copy>
          ))}
        </Section>
        {vendor.notes?.length ? (
          <Section title={tr('Beachte', 'Keep in mind')}>
            {vendor.notes.map((note, i) => (
              <Copy key={i}>{note}</Copy>
            ))}
          </Section>
        ) : null}
        <Section title={tr('Diese Dateien', 'These files')}>
          {vendor.filePatterns.map((pattern, i) => (
            <Copy muted key={i}>
              • {pattern}
            </Copy>
          ))}
        </Section>
        <View style={styles.action}>
          <Button
            title={tr('Dateien wählen & importieren', 'Choose files & import')}
            onPress={onImport}
            disabled={busy}
          />
        </View>
        {counts ? (
          <Copy muted>
            {tr(
              `Bereits übernommen: ${counts.imported ?? 0} Läufe · ${
                counts.wellness ?? 0
              } Kontext`,
              `Already imported: ${counts.imported ?? 0} runs · ${
                counts.wellness ?? 0
              } context`,
            )}
            {counts.strength
              ? tr(
                  ` · ${counts.strength} Kraft`,
                  ` · ${counts.strength} strength`,
                )
              : ''}
          </Copy>
        ) : null}
        <Section
          title={tr('Was Runback damit macht', 'What Runback does with it')}
        >
          {vendor.useful.map((item, i) => (
            <Row key={i} title={item.label} subtitle={item.howUsed} />
          ))}
        </Section>
        <Section title={tr('Grenzen', 'Limits')}>
          {vendor.limitations.map((line, i) => (
            <Copy muted key={i}>
              • {line}
            </Copy>
          ))}
          <Copy muted>{vendor.privacy}</Copy>
        </Section>
        <View style={styles.action}>
          <Button
            secondary
            title={tr('Andere Quelle wählen', 'Choose another source')}
            onPress={() => setSelected(null)}
          />
        </View>
      </>
    );
  }

  return (
    <>
      <Title>{tr('App-Importe', 'App imports')}</Title>
      <Copy muted>
        {tr(
          'Wähle, woher deine Daten kommen.',
          'Choose where your data comes from.',
        )}
      </Copy>
      {progress}
      {result}
      {errors}
      {status.strength !== undefined &&
      status.state !== 'review' &&
      onOpenTemplates ? (
        <Row
          title={tr('Vorlagen ansehen', 'View templates')}
          onPress={onOpenTemplates}
        />
      ) : null}
      {onOpenImports ? (
        <Row
          title={tr('Deine Importe', 'Your imports')}
          subtitle={tr(
            'Frühere Importe ansehen oder löschen',
            'View or delete earlier imports',
          )}
          onPress={onOpenImports}
        />
      ) : null}
      <Section title={tr('Quelle', 'Source')}>
        {VENDOR_INFOS.map(item => {
          const counts = vendors[item.id] || vendors[item.id.replace('_', '')];
          return (
            <Row
              key={item.id}
              title={item.name}
              subtitle={
                counts
                  ? tr(
                      `${item.short} · ${counts.imported ?? 0} übernommen`,
                      `${item.short} · ${counts.imported ?? 0} imported`,
                    )
                  : item.short
              }
              onPress={() => setSelected(item.id)}
            />
          );
        })}
      </Section>
      {summary?.wellness && Object.keys(summary.wellness).length ? (
        <Section title={tr('Gespeicherter Kontext', 'Saved context')}>
          <Copy muted>
            {Object.entries(summary.wellness)
              .map(([kind, info]: [string, any]) => `${kind} (${info.count})`)
              .join(', ')}
          </Copy>
          {summary?.strength?.workouts ? (
            <Copy muted>
              {tr(
                `Krafteinheiten: ${summary.strength.workouts} gespeichert`,
                `Strength sessions: ${summary.strength.workouts} saved`,
              )}
            </Copy>
          ) : null}
        </Section>
      ) : null}
      <Section title={tr('Was nicht passiert', 'What does not happen')}>
        <Copy muted>
          {tr(
            'Keine Cloud-Synchronisierung, keine Readiness-Scores, keine Diagnosen.',
            'No cloud sync, no readiness scores, no diagnoses.',
          )}
        </Copy>
        {onOpenDocs ? (
          <Button
            secondary
            small
            title={tr('Ausführliche Anleitung', 'Detailed guide')}
            onPress={onOpenDocs}
          />
        ) : null}
      </Section>
    </>
  );
}

export function vendorHintForFileName(fileName: string): string {
  const vendor = detectVendorForFile(fileName);
  const info = VENDOR_INFOS.find(v => v.id === vendor);
  return info ? `${info.name}` : tr('Unbekannte Quelle', 'Unknown source');
}

const styles = StyleSheet.create({
  action: { marginTop: space.ml, gap: space.sm },
});
