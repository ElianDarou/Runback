import React from 'react';
import type { Run } from '../native';
import { distanceTime, STANDARD_DISTANCES } from '../domain/distanceTimes';
import { formatDistanceKm, formatGoalTime } from '../domain/raceGoal';
import {
  Copy,
  Disclosure,
  EmptyState,
  Row,
  Section,
  Title,
} from './components';

export function DistanceTimes({
  runs,
  onChoose,
  onRun,
  onNextRun,
}: {
  runs: Run[];
  onChoose: (distanceKm: number, seconds: number) => void;
  onRun: (run: Run) => void;
  onNextRun?: (distanceKm: number, seconds: number) => void;
}) {
  const now = Date.now();
  return (
    <>
      <Title>Zielzeiten</Title>
      <Copy muted>
        Vergleiche deine bisherigen Zeiten und wähle einen geschätzten
        Richtwert.
      </Copy>
      {STANDARD_DISTANCES.map(km => {
        const result = distanceTime(runs, km, now);
        const supportsPace =
          result.estimatedSeconds !== undefined &&
          result.estimatedSeconds / km >= 120 &&
          result.estimatedSeconds / km <= 1200;
        const choose = onNextRun && supportsPace ? onNextRun : onChoose;
        return (
          <Section
            key={km}
            title={
              km === 21.0975
                ? 'Halbmarathon'
                : km === 42.195
                ? 'Marathon'
                : formatDistanceKm(km)
            }
          >
            <Row
              title={
                result.estimatedSeconds === undefined
                  ? 'Zu wenig vergleichbare Läufe'
                  : `Schätzung ${formatGoalTime(result.estimatedSeconds)}`
              }
              subtitle={
                result.estimatedSeconds === undefined
                  ? 'Mindestens drei passende Läufe aus den letzten acht Wochen fehlen.'
                  : onNextRun && supportsPace
                  ? 'Tempo für nächsten Lauf ansehen'
                  : 'Als Zielzeit ansehen'
              }
              onPress={
                result.estimatedSeconds === undefined
                  ? undefined
                  : () => choose(km, result.estimatedSeconds!)
              }
            />
            <Disclosure title="Bisherige Zeiten & Details">
              {onNextRun && result.estimatedSeconds !== undefined ? (
                <Row
                  title="Als Wettkampfziel ansehen"
                  onPress={() => onChoose(km, result.estimatedSeconds!)}
                />
              ) : null}
              {result.history.length ? (
                result.history.map(run => (
                  <Row
                    key={run.id}
                    title={formatGoalTime(run.durationSeconds)}
                    subtitle={`${formatDistanceKm(
                      run.distanceMeters / 1000,
                    )} · ${new Date(run.startTime).toLocaleDateString(
                      'de-DE',
                    )}`}
                    onPress={() => onRun(run)}
                  />
                ))
              ) : (
                <EmptyState
                  title="Noch keine Zeit"
                  copy="Zeichne einen Lauf über diese Strecke auf."
                />
              )}
              <Copy muted>
                Die Schätzung rechnet letzte Läufe nach Riegel auf diese Strecke
                um und nimmt deren mittleren Wert.
              </Copy>
              <Copy muted>
                Kürzere Strecken bleiben eine grobe Hochrechnung aus längeren
                Läufen.
              </Copy>
              <Copy muted>
                Trainingsläufe zeigen keine Wettkampfgrenze; Gelände, Gehphasen
                und Tagesform bleiben enthalten.
              </Copy>
              <Copy
                muted
              >{`Modell ${result.version} · ${result.sourceRunIds.length} Vergleichsläufe`}</Copy>
              {result.sourceRunIds.map(id => {
                const run = runs.find(item => item.id === id);
                return run ? (
                  <Row
                    key={`source-${id}`}
                    title={`${formatDistanceKm(
                      run.distanceMeters / 1000,
                    )} · ${formatGoalTime(run.durationSeconds)}`}
                    subtitle={new Date(run.startTime).toLocaleDateString(
                      'de-DE',
                    )}
                    onPress={() => onRun(run)}
                  />
                ) : null;
              })}
            </Disclosure>
          </Section>
        );
      })}
    </>
  );
}
