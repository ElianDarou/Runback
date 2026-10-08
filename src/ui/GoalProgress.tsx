import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { formatPace } from '../domain/analysis';
import {
  formatGoalTime,
  formatDistanceKm,
  type RacePrediction,
} from '../domain/raceGoal';
import {
  Button,
  Card,
  Copy,
  Disclosure,
  Ring,
  color,
  space,
  type,
} from './components';
import { dateFormat, tr } from '../domain/i18n';

// Formats are read per call: the language can change at runtime.
const formatDate = (date: Date) =>
  dateFormat({ day: '2-digit', month: '2-digit', year: 'numeric' }).format(
    date,
  );

const formatDateKey = (key: string) => {
  const [year, month, day] = key.split('-').map(Number);
  const date = new Date(year, month - 1, day, 12);
  return Number.isNaN(date.getTime()) ? key : formatDate(date);
};

const daysLabel = (days: number) =>
  days < 0
    ? tr('Zieldatum vorbei', 'Target date passed')
    : days === 0
    ? tr('Heute', 'Today')
    : days === 1
    ? tr('Noch 1 Tag', '1 day left')
    : tr(`Noch ${days} Tage`, `${days} days left`);

/**
 * Goal progress: a ring, one sentence, the facts below. Estimate and
 * measurement stay labeled separately; under "Details" are the run, the model,
 * and the limits of the estimate.
 */
export function GoalProgress({
  prediction,
  onEdit,
  compact = false,
}: {
  prediction: RacePrediction;
  onEdit?: () => void;
  /** On Today: only the ring and sentence; details stay on the goal page. */
  compact?: boolean;
}) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const hasGoal = prediction.status !== 'no_goal';
  const ringValue =
    prediction.status === 'estimated' && prediction.progress !== undefined
      ? prediction.progress
      : null;
  const header = (
    <View style={styles.header}>
      <Ring
        value={ringValue}
        label={tr(
          `Zielnähe ${prediction.goal || 'kein Ziel'}`,
          `Goal progress ${prediction.goal || 'no goal'}`,
        )}
        caption={tr('Zielnähe', 'Goal progress')}
      />
      <View style={styles.headerText}>
        <Text style={styles.goal} numberOfLines={2}>
          {hasGoal
            ? prediction.goal
            : tr('Noch kein Ziel festgelegt', 'No goal set yet')}
        </Text>
        {prediction.targetDate ? (
          <Text style={styles.meta}>
            {formatDateKey(prediction.targetDate)}
            {prediction.daysToGo !== undefined
              ? ` · ${daysLabel(prediction.daysToGo)}`
              : ''}
          </Text>
        ) : null}
        {prediction.targetSeconds !== undefined ? (
          <Text style={styles.meta}>
            {tr('Ziel', 'Goal')} {formatGoalTime(prediction.targetSeconds)}
          </Text>
        ) : null}
      </View>
    </View>
  );
  return (
    <Card>
      {header}
      <Copy>{prediction.message}</Copy>
      {compact ? (
        onEdit ? (
          <Button
            secondary
            small
            title={tr('Ziel ansehen', 'View goal')}
            onPress={onEdit}
          />
        ) : null
      ) : (
        <>
          {prediction.status === 'estimated' ? (
            <View style={styles.facts}>
              <Fact
                label={tr('Geschätzt', 'Estimated')}
                value={
                  prediction.predictedSeconds === undefined
                    ? '–'
                    : formatGoalTime(prediction.predictedSeconds)
                }
                note={
                  prediction.predictedPaceSecondsPerKm === undefined
                    ? undefined
                    : `${formatPace(prediction.predictedPaceSecondsPerKm)} /km`
                }
              />
              <Fact
                label={tr('Längster Lauf', 'Longest run')}
                value={
                  prediction.longestRunKm === undefined
                    ? '–'
                    : formatDistanceKm(prediction.longestRunKm)
                }
                note={
                  prediction.peakLongRunKm === undefined
                    ? undefined
                    : tr(
                        `Aufbau bis ${formatDistanceKm(
                          prediction.peakLongRunKm,
                        )}`,
                        `Build-up to ${formatDistanceKm(
                          prediction.peakLongRunKm,
                        )}`,
                      )
                }
              />
            </View>
          ) : null}
          {prediction.status === 'estimated' && prediction.reference ? (
            <Disclosure
              title="Details"
              subtitle={tr(
                'Lauf, Modell und Grenzen der Schätzung',
                'Run, model, and limits of the estimate',
              )}
              open={detailsOpen}
              onToggle={setDetailsOpen}
            >
              <Copy muted>
                {tr(
                  `Grundlage: dein Lauf über ${formatDistanceKm(
                    prediction.reference.distanceKm,
                  )} in ${formatGoalTime(
                    prediction.reference.durationSeconds,
                  )} vom ${formatDate(
                    new Date(prediction.reference.startTime),
                  )}.`,
                  `Based on your run over ${formatDistanceKm(
                    prediction.reference.distanceKm,
                  )} in ${formatGoalTime(
                    prediction.reference.durationSeconds,
                  )} on ${formatDate(
                    new Date(prediction.reference.startTime),
                  )}.`,
                )}
              </Copy>
              <Copy muted>
                {prediction.limitedBy === 'time'
                  ? tr(
                      `Zielnähe: die Zielzeit begrenzt — ${Math.round(
                        (prediction.distanceShare ?? 0) * 100,
                      )} % der Aufbaustrecke${
                        prediction.timeShare === undefined
                          ? ''
                          : `, ${Math.round(
                              prediction.timeShare * 100,
                            )} % der Zielzeit`
                      }.`,
                      `Goal progress: the goal time limits it — ${Math.round(
                        (prediction.distanceShare ?? 0) * 100,
                      )}% of the build-up distance${
                        prediction.timeShare === undefined
                          ? ''
                          : `, ${Math.round(
                              prediction.timeShare * 100,
                            )}% of the goal time`
                      }.`,
                    )
                  : tr(
                      `Zielnähe: die Strecke begrenzt — ${Math.round(
                        (prediction.distanceShare ?? 0) * 100,
                      )} % der Aufbaustrecke${
                        prediction.timeShare === undefined
                          ? ''
                          : `, ${Math.round(
                              prediction.timeShare * 100,
                            )} % der Zielzeit`
                      }.`,
                      `Goal progress: the distance limits it — ${Math.round(
                        (prediction.distanceShare ?? 0) * 100,
                      )}% of the build-up distance${
                        prediction.timeShare === undefined
                          ? ''
                          : `, ${Math.round(
                              prediction.timeShare * 100,
                            )}% of the goal time`
                      }.`,
                    )}
              </Copy>
              {prediction.limits.map(limit => (
                <Copy muted key={limit}>
                  {limit}
                </Copy>
              ))}
              <Copy muted>
                {tr(
                  `Modell ${prediction.version}`,
                  `Model ${prediction.version}`,
                )}
              </Copy>
            </Disclosure>
          ) : null}
          {onEdit ? (
            <Button
              secondary
              small
              title={
                hasGoal
                  ? tr('Ziel bearbeiten', 'Edit goal')
                  : tr('Ziel festlegen', 'Set goal')
              }
              onPress={onEdit}
            />
          ) : null}
        </>
      )}
    </Card>
  );
}

function Fact({
  label,
  value,
  note,
}: {
  label: string;
  value: string;
  note?: string;
}) {
  return (
    <View style={styles.fact}>
      <Text style={styles.factValue}>{value}</Text>
      <Text style={styles.factLabel}>{label}</Text>
      {note ? <Text style={styles.factLabel}>{note}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  headerText: { flex: 1, gap: space.xxs },
  goal: { color: color.text, ...type.heading },
  meta: { color: color.muted, ...type.label, fontWeight: '400' },
  facts: { flexDirection: 'row', gap: space.md },
  fact: { flex: 1, gap: 2 },
  factValue: {
    color: color.text,
    ...type.value,
    fontVariant: ['tabular-nums'],
  },
  factLabel: { color: color.muted, ...type.micro, fontWeight: '400' },
});
