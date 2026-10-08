import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { Run } from '../native';
import {
  displaySessionName,
  type StrengthSession,
} from '../domain/strength';
import type { ScheduleState } from '../domain/schedule';
import {
  buildDevelopmentFacts,
  DEVELOPMENT_RUN_LOAD_LIMIT,
  DEVELOPMENT_STRENGTH_LOAD_LIMIT,
  type DevelopmentPeriod,
  type DevelopmentFacts,
  type PlanPosition,
  type StrengthHistoryItem,
} from '../domain/development';
import { dateFormat, numberFormat, tr } from '../domain/i18n';
import {
  Button,
  Card,
  Copy,
  Section,
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
  `${numberFormat({ minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(
    Math.max(0, meters) / 1000,
  )} km`;

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

const formatDateRange = (position: PlanPosition) => {
  const start = formatDate(position.startDate);
  const end = formatDate(position.targetDate);
  if (start && end) {
    return `${start} – ${end}`;
  }
  return start || end;
};

const signedNumber = (value: number) =>
  value > 0 ? `+${formatNumber(value)}` : formatNumber(value);

const sessionWord = (count: number) =>
  tr(
    count === 1 ? 'Krafteinheit' : 'Krafteinheiten',
    count === 1 ? 'strength session' : 'strength sessions',
  );

function PeriodBlock({
  period,
  title,
}: {
  period: DevelopmentPeriod;
  title: string;
}) {
  const hasRuns = period.runCount > 0;
  return (
    <View style={styles.period}>
      <Text style={styles.periodTitle}>{title}</Text>
      <View style={styles.statRow}>
        <Stat
          label={tr('Tage trainiert', 'Training days')}
          value={
            period.hasTraining ? formatNumber(period.trainingDays) : '–'
          }
        />
        <Stat
          label={tr('Laufstrecke', 'Running distance')}
          value={hasRuns ? formatDistance(period.distanceMeters) : '–'}
        />
        <Stat
          label={tr('Laufzeit', 'Running time')}
          value={hasRuns ? formatDuration(period.durationSeconds) : '–'}
        />
      </View>
      <Text style={styles.periodMeta}>
        {hasRuns
          ? tr(
              `${formatNumber(period.runCount)} ${
                period.runCount === 1 ? 'Lauf' : 'Läufe'
              }`,
              `${formatNumber(period.runCount)} ${
                period.runCount === 1 ? 'run' : 'runs'
              }`,
            )
          : period.hasTraining
          ? tr('Kein Lauf in diesem Zeitraum', 'No run in this period')
          : tr('Keine abgeschlossene Einheit', 'No completed session')}
      </Text>
      {period.strengthSessionCount > 0 ? (
        <Text style={styles.periodMeta}>
          {tr(
            `${formatNumber(period.strengthSessionCount)} ${sessionWord(
              period.strengthSessionCount,
            )} · ${formatNumber(period.strengthCompletedSets)} bestätigte Sätze`,
            `${formatNumber(period.strengthSessionCount)} ${sessionWord(
              period.strengthSessionCount,
            )} · ${formatNumber(period.strengthCompletedSets)} confirmed sets`,
          )}
        </Text>
      ) : null}
    </View>
  );
}

function PlanPositionCard({ position }: { position: PlanPosition | null }) {
  return (
    <Card>
      {position ? (
        <>
          <Text style={styles.planLabel}>{position.label}</Text>
          <Text style={styles.planMeta}>
            {position.timing === 'upcoming'
              ? tr('Planbeginn liegt noch vor dir', 'The plan starts ahead of you')
              : position.timing === 'ended'
              ? tr('Geplanter Zeitraum beendet', 'Planned period ended')
              : tr(
                  `Woche ${position.week}${
                    position.totalWeeks ? ` von ${position.totalWeeks}` : ''
                  }`,
                  `Week ${position.week}${
                    position.totalWeeks ? ` of ${position.totalWeeks}` : ''
                  }`,
                )}
          </Text>
          <Copy muted>
            {tr(
              'Zeitlicher Planstand, keine Bewertung deiner Leistung.',
              'Where you are in the schedule, not a rating of your performance.',
            )}
          </Copy>
          {position.phase && position.phase !== position.label ? (
            <Text style={styles.planMeta}>{position.phase}</Text>
          ) : null}
          {formatDateRange(position) ? (
            <Text style={styles.planMeta}>{formatDateRange(position)}</Text>
          ) : null}
        </>
      ) : (
        <Copy muted>
          {tr(
            'Kein aktueller Planabschnitt hinterlegt.',
            'No current plan phase on record.',
          )}
        </Copy>
      )}
    </Card>
  );
}

function GoalCard({
  facts,
  goal,
  onEditGoal,
}: {
  facts: DevelopmentFacts;
  goal: string;
  onEditGoal: () => void;
}) {
  const evidence = facts.goalEvidence;
  return (
    <Card>
      <Text style={styles.goal}>
        {goal.trim() || tr('Noch kein Ziel festgelegt', 'No goal set yet')}
      </Text>
      <Button title={tr('Ziel bearbeiten', 'Edit goal')} onPress={onEditGoal} />
      <Text style={styles.evidence}>{evidence.message}</Text>
      {evidence.targetDistanceKm !== undefined ? (
        <View style={styles.factList}>
          <FactRow
            label={tr('Zielstrecke', 'Goal distance')}
            value={formatDistance(evidence.targetDistanceKm * 1000)}
          />
          <FactRow
            label={tr('Längster erfasster Lauf', 'Longest recorded run')}
            value={
              evidence.longestRunDistanceKm === undefined
                ? '–'
                : formatDistance(evidence.longestRunDistanceKm * 1000)
            }
          />
        </View>
      ) : null}
    </Card>
  );
}

function FactRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.factRow}>
      <Text style={styles.factLabel}>{label}</Text>
      <Text style={styles.factValue}>{value}</Text>
    </View>
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
            `Weitere ${formatNumber(history.sessions.length - 4)} Einheiten in der Historie.`,
            `${formatNumber(history.sessions.length - 4)} more sessions in the history.`,
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
        <Text style={styles.historyTitle}>
          {displaySessionName(item.name)}
        </Text>
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
  goal: string;
  now: number;
  schedule?: ScheduleState | null;
  onEditGoal: () => void;
  /** Goal progress from `predictRace`; without it the page only shows the goal check. */
  prediction?: RacePrediction;
  /** False when the native history query failed, rather than returned no rows. */
  strengthHistoryAvailable?: boolean;
}

/** Development: plan position, observed activity and goal evidence. */
export function DevelopmentScreen({
  runs,
  sessions,
  goal,
  now,
  schedule = null,
  onEditGoal,
  prediction,
  strengthHistoryAvailable = true,
}: DevelopmentScreenProps) {
  const facts = useMemo(
    () => buildDevelopmentFacts({ runs, sessions, goal, now, schedule }),
    [goal, now, runs, schedule, sessions],
  );
  const comparison = facts.comparison;
  return (
    <View style={styles.content}>
      <Title>{tr('Entwicklung', 'Development')}</Title>

      <Section title={tr('Ziel', 'Goal')}>
        {prediction ? (
          <GoalProgress prediction={prediction} onEdit={onEditGoal} />
        ) : (
          <GoalCard facts={facts} goal={goal} onEditGoal={onEditGoal} />
        )}
      </Section>

      <Section title={tr('Im Trainingsplan', 'In the training plan')}>
        <PlanPositionCard position={facts.planPosition} />
      </Section>

      <Section title={tr('Tatsächliches Training', 'Actual training')}>
        <Card>
          <PeriodBlock
            period={facts.current}
            title={tr('Letzte 4 Wochen', 'Last 4 weeks')}
          />
          <View style={styles.divider} />
          <PeriodBlock
            period={facts.previous}
            title={tr('Davor', 'Before that')}
          />
          {facts.current.hasTraining || facts.previous.hasTraining ? (
            <Text style={styles.comparison}>
              {tr(
                `Trainingstage im Vergleich: ${signedNumber(comparison.trainingDays)}`,
                `Training days compared: ${signedNumber(comparison.trainingDays)}`,
              )}
            </Text>
          ) : (
            <Copy muted>
              {tr(
                'Für den Vergleich fehlen abgeschlossene Einheiten.',
                'The comparison needs completed sessions.',
              )}
            </Copy>
          )}
          {!strengthHistoryAvailable ? (
            <Copy muted>
              {tr(
                'Krafttraining ist momentan nicht geladen; Trainingstage und Vergleich berücksichtigen nur Läufe.',
                'Strength training is not loaded right now; training days and the comparison only count runs.',
              )}
            </Copy>
          ) : null}
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

      <Section title={tr('Kraftverlauf', 'Strength history')}>
        <StrengthHistoryCard
          history={facts.strengthHistory}
          loadedLimitReached={
            sessions.length >= DEVELOPMENT_STRENGTH_LOAD_LIMIT
          }
          available={strengthHistoryAvailable}
        />
      </Section>
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
  evidence: { color: color.text, ...type.body },
  statRow: { flexDirection: 'row', gap: space.md },
  period: { gap: space.sm },
  periodTitle: { color: color.text, ...type.heading },
  periodMeta: { color: color.muted, ...type.label, fontWeight: '400' },
  divider: { borderTopWidth: 1, borderTopColor: color.line },
  comparison: { color: color.text, ...type.label },
  factList: { gap: space.xs },
  factRow: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.md,
    borderBottomWidth: 1,
    borderBottomColor: color.line,
  },
  factLabel: { color: color.muted, ...type.label },
  factValue: {
    color: color.text,
    ...type.label,
    fontVariant: ['tabular-nums'],
  },
  planLabel: { color: color.text, ...type.heading },
  planMeta: { color: color.muted, ...type.label, fontWeight: '400' },
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
