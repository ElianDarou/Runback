import React, { useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { Run } from '../native';
import {
  displaySessionName,
  formatWeight,
  type StrengthSession,
} from '../domain/strength';
import {
  buildDevelopmentFacts,
  DEVELOPMENT_RUN_LOAD_LIMIT,
  DEVELOPMENT_STRENGTH_LOAD_LIMIT,
  type DevelopmentPeriod,
  type DevelopmentFacts,
  type StrengthHistoryItem,
} from '../domain/development';
import {
  strengthGoalProgress,
  type StrengthTarget,
} from '../domain/strengthGoal';
import { exerciseDisplayName } from '../domain/catalog';
import { dateFormat, numberFormat, tr } from '../domain/i18n';
import {
  Button,
  Card,
  Copy,
  Ring,
  Row,
  Section,
  Segmented,
  Stat,
  Title,
  color,
  space,
  type,
} from './components';
import type { RacePrediction } from '../domain/raceGoal';
import { GoalProgress } from './GoalProgress';

const formatNumber = (value: number) =>
  numberFormat({ minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(
    value,
  );

const formatDistance = (meters: number) =>
  `${numberFormat({
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Math.max(0, meters) / 1000)} km`;

const formatDuration = (seconds: number) => {
  const minutes = Math.max(0, Math.round(seconds / 60));
  if (minutes < 60) {
    return `${formatNumber(minutes)} min`;
  }
  const hours = Math.floor(minutes / 60);
  return `${hours} h ${minutes % 60} min`;
};

const formatDate = (dateKey: string | undefined) => {
  if (!dateKey || !/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) {
    return null;
  }
  const [year, month, day] = dateKey.split('-').map(Number);
  const date = new Date(0);
  date.setHours(0, 0, 0, 0);
  date.setFullYear(year, month - 1, day);
  return Number.isNaN(date.getTime())
    ? null
    : dateFormat({ day: '2-digit', month: '2-digit', year: 'numeric' }).format(
        date,
      );
};

const formatDay = (time: number) =>
  dateFormat({ day: '2-digit', month: '2-digit' }).format(new Date(time));

const formatKg = (kg: number) => `${formatWeight(kg)} kg`;

function PeriodBlock({
  period,
  title,
  area,
}: {
  period: DevelopmentPeriod;
  title: string;
  area: 'running' | 'strength';
}) {
  if (area === 'running') {
    const hasRuns = period.runCount > 0;
    return (
      <View style={styles.period}>
        <Text style={styles.periodTitle}>{title}</Text>
        <View style={styles.statRow}>
          <Stat
            label={tr('Läufe', 'Runs')}
            value={formatNumber(period.runCount)}
          />
          <Stat
            label={tr('Strecke', 'Distance')}
            value={hasRuns ? formatDistance(period.distanceMeters) : '–'}
          />
          <Stat
            label={tr('Zeit', 'Time')}
            value={hasRuns ? formatDuration(period.durationSeconds) : '–'}
          />
        </View>
      </View>
    );
  }
  return (
    <View style={styles.period}>
      <Text style={styles.periodTitle}>{title}</Text>
      <View style={styles.statRow}>
        <Stat
          label={tr('Einheiten', 'Sessions')}
          value={formatNumber(period.strengthSessionCount)}
        />
        <Stat
          label={tr('Sätze', 'Sets')}
          value={formatNumber(period.strengthCompletedSets)}
        />
        <Stat
          label={tr('kg bewegt', 'kg moved')}
          value={
            period.strengthVolumeKg > 0
              ? formatNumber(Math.round(period.strengthVolumeKg))
              : '–'
          }
        />
      </View>
    </View>
  );
}

function StrengthGoalCard({
  target,
  goal,
  targetDate,
  sessions,
  now,
  onEdit,
  available,
}: {
  available: boolean;
  target?: StrengthTarget;
  goal: string;
  targetDate: string;
  sessions: StrengthSession[];
  now: number;
  onEdit: () => void;
}) {
  // Without loaded sessions, how close the goal is stays unknown.
  const progress =
    target && available
      ? strengthGoalProgress(target, sessions, now)
      : undefined;
  const targetText = target
    ? `${exerciseDisplayName(target.exerciseId, target.name)} · ${formatKg(
        target.kg,
      )} × ${target.reps}`
    : '';
  return (
    <Card>
      <View style={styles.goalHeader}>
        <Ring
          value={progress?.share ?? null}
          label={tr(
            `Zielnähe ${targetText || 'kein Ziel'}`,
            `Goal progress ${targetText || 'no goal'}`,
          )}
          caption={tr('Zielnähe', 'Goal progress')}
        />
        <View style={styles.goalText}>
          <Text style={styles.goal} numberOfLines={2}>
            {targetText ||
              goal.trim() ||
              tr('Noch kein Ziel festgelegt', 'No goal set yet')}
          </Text>
          {targetText && goal.trim() ? (
            <Text style={styles.periodMeta}>{goal.trim()}</Text>
          ) : null}
          {formatDate(targetDate) ? (
            <Text style={styles.periodMeta}>
              {tr(
                `bis ${formatDate(targetDate)}`,
                `by ${formatDate(targetDate)}`,
              )}
            </Text>
          ) : null}
        </View>
      </View>
      {target && progress ? (
        <Text style={styles.evidence}>
          {progress.best
            ? progress.reached
              ? tr(
                  `Geschafft: ${formatKg(progress.best.kg)} × ${
                    progress.best.reps
                  } am ${formatDay(progress.best.at)}.`,
                  `Done: ${formatKg(progress.best.kg)} × ${
                    progress.best.reps
                  } on ${formatDay(progress.best.at)}.`,
                )
              : tr(
                  `Bestes in 12 Wochen: ${formatKg(progress.best.kg)} × ${
                    progress.best.reps
                  } am ${formatDay(progress.best.at)}.`,
                  `Best in 12 weeks: ${formatKg(progress.best.kg)} × ${
                    progress.best.reps
                  } on ${formatDay(progress.best.at)}.`,
                )
            : progress.sets
            ? tr(
                `In 12 Wochen kein Satz mit ${target.reps} Wiederholungen und Gewicht.`,
                `No set with ${target.reps} reps and a load in 12 weeks.`,
              )
            : tr(
                'Die Übung kam in den letzten 12 Wochen nicht vor.',
                'The exercise did not come up in the last 12 weeks.',
              )}
        </Text>
      ) : !target ? (
        <Copy muted>
          {tr(
            'Wähle Übung und Gewicht, dann siehst du, wie nah du dran bist.',
            'Choose an exercise and load to see how close you are.',
          )}
        </Copy>
      ) : (
        <Copy muted>
          {tr(
            'Krafttraining ist momentan nicht geladen.',
            'Strength training is not loaded right now.',
          )}
        </Copy>
      )}
      <Button
        secondary
        title={tr('Ziel bearbeiten', 'Edit goal')}
        onPress={onEdit}
      />
    </Card>
  );
}

function StrengthHistoryCard({
  history,
  loadedLimitReached,
  available,
}: {
  history: DevelopmentFacts['strengthHistory'];
  loadedLimitReached: boolean;
  available: boolean;
}) {
  if (!available) {
    return (
      <Card>
        <Copy muted>
          {tr(
            'Kraft-Historie momentan nicht verfügbar.',
            'Strength history is not available right now.',
          )}
        </Copy>
      </Card>
    );
  }
  if (!history.hasData) {
    return (
      <Card>
        <Copy muted>
          {tr(
            'Keine abgeschlossenen Krafttrainings mit bestätigten Werten.',
            'No completed strength sessions with confirmed values.',
          )}
        </Copy>
        {loadedLimitReached ? (
          <Copy muted>
            {tr(
              'Geprüft wurden die höchstens 500 zuletzt geladenen Kraft-Einheiten.',
              'Only the 500 most recently loaded strength sessions were checked.',
            )}
          </Copy>
        ) : null}
      </Card>
    );
  }
  return (
    <Card>
      <View style={styles.statRow}>
        <Stat
          label={tr('Erfasste Einheiten', 'Sessions logged')}
          value={formatNumber(history.totalSessions)}
        />
        <Stat
          label={tr('Sätze erfasst', 'Sets logged')}
          value={formatNumber(history.completedSets)}
        />
        <Stat
          label={tr('kg bewegt', 'kg moved')}
          value={
            history.volumeKg > 0
              ? formatNumber(Math.round(history.volumeKg))
              : '–'
          }
        />
      </View>
      <View style={styles.historyList}>
        {history.sessions.slice(0, 4).map(item => (
          <StrengthHistoryRow item={item} key={item.id} />
        ))}
      </View>
      {loadedLimitReached ? (
        <Copy muted>
          {tr(
            `Geladen sind höchstens ${formatNumber(
              DEVELOPMENT_STRENGTH_LOAD_LIMIT,
            )} Kraft-Einheiten; ältere Einheiten können fehlen.`,
            `At most ${formatNumber(
              DEVELOPMENT_STRENGTH_LOAD_LIMIT,
            )} strength sessions are loaded; older sessions may be missing.`,
          )}
        </Copy>
      ) : null}
      {history.sessions.length > 4 ? (
        <Copy muted>
          {tr(
            `Weitere ${formatNumber(
              history.sessions.length - 4,
            )} Einheiten in der Historie.`,
            `${formatNumber(
              history.sessions.length - 4,
            )} more sessions in the history.`,
          )}
        </Copy>
      ) : null}
      <Copy muted>
        {tr(
          'Nur bestätigte Satzwerte fließen in die Zahlen ein.',
          'Only confirmed set values feed into the numbers.',
        )}
      </Copy>
    </Card>
  );
}

function StrengthHistoryRow({ item }: { item: StrengthHistoryItem }) {
  const date = dateFormat({
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(new Date(item.startTime));
  return (
    <View style={styles.historyRow}>
      <View style={styles.historyText}>
        <Text style={styles.historyTitle}>{displaySessionName(item.name)}</Text>
        <Text style={styles.historyMeta}>
          {date || tr('Datum unbekannt', 'Date unknown')}
        </Text>
      </View>
      <Text style={styles.historyValue}>
        {`${formatNumber(item.completedSets)} ${tr(
          item.completedSets === 1 ? 'Satz' : 'Sätze',
          item.completedSets === 1 ? 'set' : 'sets',
        )}`}
      </Text>
    </View>
  );
}

export interface DevelopmentScreenProps {
  runs: Run[];
  sessions: StrengthSession[];
  now: number;
  showRunning: boolean;
  showStrength: boolean;
  /** Running goal progress from `predictRace`. */
  prediction: RacePrediction;
  onEditGoal: () => void;
  onDistanceTimes: () => void;
  strengthGoal: string;
  strengthGoalTargetDate: string;
  strengthTarget?: StrengthTarget;
  onEditStrengthGoal: () => void;
  /** False when the native history query failed, rather than returned no rows. */
  strengthHistoryAvailable?: boolean;
  /** Shown area, kept by the caller so it stays after editing a goal. */
  area?: 'running' | 'strength';
  onAreaChange?: (area: 'running' | 'strength') => void;
}

/**
 * Development: per area its own goal, how close it is, and the last weeks
 * against the weeks before. Running and strength never share a number.
 */
export function DevelopmentScreen({
  runs,
  sessions,
  now,
  showRunning,
  showStrength,
  prediction,
  onEditGoal,
  onDistanceTimes,
  strengthGoal,
  strengthGoalTargetDate,
  strengthTarget,
  onEditStrengthGoal,
  strengthHistoryAvailable = true,
  area: keptArea,
  onAreaChange,
}: DevelopmentScreenProps) {
  const [ownArea, setOwnArea] = useState<'running' | 'strength'>(
    showRunning ? 'running' : 'strength',
  );
  const area = keptArea ?? ownArea;
  const setArea = (next: 'running' | 'strength') => {
    setOwnArea(next);
    onAreaChange?.(next);
  };
  const facts = useMemo(
    () => buildDevelopmentFacts({ runs, sessions, now }),
    [now, runs, sessions],
  );
  const shown =
    area === 'running' && showRunning
      ? 'running'
      : showStrength
      ? 'strength'
      : 'running';
  return (
    <View style={styles.content}>
      <Title>{tr('Entwicklung', 'Progress')}</Title>
      {showRunning && showStrength ? (
        <Segmented
          label={tr('Bereich', 'Area')}
          options={[
            { value: 'running', label: tr('Laufen', 'Running') },
            { value: 'strength', label: tr('Krafttraining', 'Strength') },
          ]}
          value={shown}
          onChange={setArea}
        />
      ) : null}

      {shown === 'running' ? (
        <>
          <Section title={tr('Ziel', 'Goal')}>
            <GoalProgress prediction={prediction} onEdit={onEditGoal} />
            <Row
              title={tr('Zielzeiten', 'Goal times')}
              subtitle={tr(
                'Geschätzte Zeiten von 1 km bis Marathon',
                'Estimated times from 1 km to marathon',
              )}
              onPress={onDistanceTimes}
            />
          </Section>
          <Section title={tr('Tatsächliches Training', 'Actual training')}>
            <Card>
              <PeriodBlock
                area="running"
                period={facts.current}
                title={tr('Letzte 4 Wochen', 'Last 4 weeks')}
              />
              <View style={styles.divider} />
              <PeriodBlock
                area="running"
                period={facts.previous}
                title={tr('Die 4 Wochen davor', 'The 4 weeks before')}
              />
              {runs.length >= DEVELOPMENT_RUN_LOAD_LIMIT ? (
                <Copy muted>
                  {tr(
                    `Die Laufzahlen basieren auf bis zu ${formatNumber(
                      DEVELOPMENT_RUN_LOAD_LIMIT,
                    )} zuletzt geladenen Läufen.`,
                    `The run figures are based on up to the ${formatNumber(
                      DEVELOPMENT_RUN_LOAD_LIMIT,
                    )} most recently loaded runs.`,
                  )}
                </Copy>
              ) : null}
            </Card>
          </Section>
        </>
      ) : (
        <>
          <Section title={tr('Ziel', 'Goal')}>
            <StrengthGoalCard
              target={strengthTarget}
              goal={strengthGoal}
              targetDate={strengthGoalTargetDate}
              sessions={sessions}
              now={now}
              onEdit={onEditStrengthGoal}
              available={strengthHistoryAvailable}
            />
          </Section>
          <Section title={tr('Tatsächliches Training', 'Actual training')}>
            <Card>
              {strengthHistoryAvailable ? (
                <>
                  <PeriodBlock
                    area="strength"
                    period={facts.current}
                    title={tr('Letzte 4 Wochen', 'Last 4 weeks')}
                  />
                  <View style={styles.divider} />
                  <PeriodBlock
                    area="strength"
                    period={facts.previous}
                    title={tr('Die 4 Wochen davor', 'The 4 weeks before')}
                  />
                </>
              ) : (
                <Copy muted>
                  {tr(
                    'Krafttraining ist momentan nicht geladen.',
                    'Strength training is not loaded right now.',
                  )}
                </Copy>
              )}
            </Card>
          </Section>
          <Section title={tr('Kraftverlauf', 'Strength history')}>
            <StrengthHistoryCard
              history={facts.strengthHistory}
              loadedLimitReached={
                sessions.length >= DEVELOPMENT_STRENGTH_LOAD_LIMIT
              }
              available={strengthHistoryAvailable}
            />
          </Section>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingTop: space.xs,
    paddingBottom: space.xxl,
    gap: space.xs,
  },
  goal: { color: color.text, ...type.heading },
  goalHeader: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  goalText: { flex: 1, gap: space.xxs },
  evidence: { color: color.text, ...type.body },
  statRow: { flexDirection: 'row', gap: space.md },
  period: { gap: space.sm },
  periodTitle: { color: color.text, ...type.heading },
  periodMeta: { color: color.muted, ...type.label, fontWeight: '400' },
  divider: { borderTopWidth: 1, borderTopColor: color.line },
  historyList: { gap: 0 },
  historyRow: {
    minHeight: 64,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    borderBottomWidth: 1,
    borderBottomColor: color.line,
  },
  historyText: { flex: 1, gap: space.xxs },
  historyTitle: { color: color.text, ...type.body, fontWeight: '500' },
  historyMeta: { color: color.muted, ...type.label, fontWeight: '400' },
  historyValue: {
    color: color.text,
    ...type.label,
    fontVariant: ['tabular-nums'],
  },
});

export default DevelopmentScreen;
