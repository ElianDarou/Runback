import React from 'react';
import { View } from 'react-native';
import type { Run } from '../native';
import { distanceTime, STANDARD_DISTANCES } from '../domain/distanceTimes';
import { formatDistanceKm, formatGoalTime } from '../domain/raceGoal';
import { locale, tr } from '../domain/i18n';
import { Copy, Disclosure, Row, Section, Title } from './components';

const distanceName = (km: number) =>
  km === 21.0975
    ? tr('Halbmarathon', 'Half marathon')
    : km === 42.195
    ? 'Marathon'
    : formatDistanceKm(km);

/**
 * One row per distance with the estimated time; a tap adopts it.
 * Past times, comparison runs and the limits of the estimate apply to all
 * distances alike and sit once in a collapsed section below.
 */
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
  const results = STANDARD_DISTANCES.map(km => ({
    km,
    result: distanceTime(runs, km, now),
  }));
  return (
    <>
      <Title>{tr('Zielzeiten', 'Goal times')}</Title>
      <View>
        {results.map(({ km, result }) => {
          const supportsPace =
            result.estimatedSeconds !== undefined &&
            result.estimatedSeconds / km >= 120 &&
            result.estimatedSeconds / km <= 1200;
          const choose = onNextRun && supportsPace ? onNextRun : onChoose;
          return (
            <Row
              key={km}
              title={distanceName(km)}
              subtitle={
                result.estimatedSeconds === undefined
                  ? tr(
                      'Zu wenig vergleichbare Läufe',
                      'Not enough comparable runs',
                    )
                  : tr(
                      `Schätzung ${formatGoalTime(result.estimatedSeconds)}`,
                      `Estimate ${formatGoalTime(result.estimatedSeconds)}`,
                    )
              }
              onPress={
                result.estimatedSeconds === undefined
                  ? undefined
                  : () => choose(km, result.estimatedSeconds!)
              }
            />
          );
        })}
      </View>
      <Disclosure
        title={tr('Bisherige Zeiten & Details', 'Past times & details')}
        subtitle={tr(
          'Vergleichsläufe und Grenzen der Schätzung',
          'Comparison runs and limits of the estimate',
        )}
      >
        {results.map(({ km, result }) => (
          <Section key={km} title={distanceName(km)}>
            {onNextRun && result.estimatedSeconds !== undefined ? (
              <Row
                title={tr('Als Wettkampfziel ansehen', 'Use as race goal')}
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
                  )} · ${new Date(run.startTime).toLocaleDateString(locale())}`}
                  onPress={() => onRun(run)}
                />
              ))
            ) : (
              <Copy muted>
                {tr(
                  'Noch keine Zeit über diese Strecke.',
                  'No time over this distance yet.',
                )}
              </Copy>
            )}
            {result.sourceRunIds.length ? (
              <Copy muted>{`${tr('Modell', 'Model')} ${result.version} · ${counted(
                result.sourceRunIds.length,
              )}`}</Copy>
            ) : null}
            {result.sourceRunIds.map(id => {
              const run = runs.find(item => item.id === id);
              return run ? (
                <Row
                  key={`source-${id}`}
                  title={`${formatDistanceKm(
                    run.distanceMeters / 1000,
                  )} · ${formatGoalTime(run.durationSeconds)}`}
                  subtitle={new Date(run.startTime).toLocaleDateString(locale())}
                  onPress={() => onRun(run)}
                />
              ) : null;
            })}
          </Section>
        ))}
        <Section title={tr('So wird geschätzt', 'How the estimate works')}>
          <Copy muted>
            {tr(
              'Die Schätzung rechnet letzte Läufe auf die Strecke um und gewichtet die neuesten drei am stärksten. Dein letzter passender Lauf begrenzt sie: Sie fällt höchstens so langsam aus.',
              'The estimate converts recent runs to this distance and weights the newest three most heavily. Your last matching run sets a limit: the estimate can be no slower than that.',
            )}
          </Copy>
          <Copy muted>
            {tr(
              'Kürzere Strecken bleiben eine grobe Hochrechnung aus längeren Läufen. Trainingsläufe zeigen keine Wettkampfgrenze; Gelände, Gehphasen und Tagesform bleiben enthalten.',
              'Shorter distances stay a rough projection from longer runs. Training runs show no race limit; terrain, walking phases and form on the day stay included.',
            )}
          </Copy>
        </Section>
      </Disclosure>
    </>
  );
}

const counted = (count: number) =>
  count === 1
    ? tr(
        `${count} Vergleichslauf`,
        `${count} comparison run`,
      )
    : tr(`${count} Vergleichsläufe`, `${count} comparison runs`);
