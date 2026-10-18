import React, { useState } from 'react';
import { Alert, View, StyleSheet } from 'react-native';
import {
  addChallengeEntry,
  challengeDay,
  challengeStats,
  challengeSteps,
  dayTotal,
  removeChallengeEntry,
  validChallengeCount,
  type Challenge,
  type Challenges,
} from '../domain/challenges';
import { localDateKey } from '../domain/schedule';
import { dateFormat, numberFormat, tr } from '../domain/i18n';
import {
  Button,
  Card,
  CheckRow,
  Copy,
  Disclosure,
  EmptyState,
  Field,
  Input,
  Progress,
  Row,
  Section,
  Sheet,
  Title,
  space,
} from './components';

type Change = (
  update: (state: Challenges) => Challenges,
  onSaved?: () => void,
) => void;
const count = (n: number) =>
  numberFormat({ maximumFractionDigits: 0 }).format(n);
const historyDate = (date: string) =>
  dateFormat({ day: 'numeric', month: 'short', year: 'numeric' }).format(
    new Date(`${date}T12:00:00`),
  );
let sequence = 0;
const newId = () => `challenge-${Date.now()}-${++sequence}`;
const integerInput = (s: string) =>
  /^\d+$/.test(s) && validChallengeCount(Number(s));

function ChallengeCard({
  item,
  now,
  disabled,
  onChange,
  onEdit,
  compact,
}: {
  item: Challenge;
  now: number;
  disabled: boolean;
  onChange: Change;
  onEdit: () => void;
  compact: boolean;
}) {
  const [amount, setAmount] = useState('');
  const today = localDateKey(new Date(now));
  const day = challengeDay(item, today);
  const total = dayTotal(day);
  const target = day?.target ?? item.target;
  const stats = challengeStats(item, today);
  const add = (value: number, onSaved?: () => void) => {
    // Use the tap time, not a date captured before midnight or backgrounding.
    const at = Date.now();
    const id = newId();
    onChange(
      state => addChallengeEntry(state, item.id, value, at, id),
      onSaved,
    );
  };
  const last = day?.entries[day.entries.length - 1];
  return (
    <Card>
      <Copy>{item.name}</Copy>
      <View accessibilityLiveRegion="polite">
        <Copy>
          {tr(
            `${count(total)} von ${count(target)}`,
            `${count(total)} of ${count(target)}`,
          )}
        </Copy>
      </View>
      <Progress
        value={total / target}
        label={tr(
          `${count(total)} von ${count(target)}`,
          `${count(total)} of ${count(target)}`,
        )}
      />
      {!item.archived ? (
        <>
          <View style={styles.buttons}>
            {item.steps.map(step => (
              <Button
                key={step}
                secondary
                small
                title={`+${count(step)}`}
                label={tr(
                  `${item.name}: ${count(step)} hinzufügen`,
                  `${item.name}: add ${count(step)}`,
                )}
                disabled={disabled}
                onPress={() => add(step)}
              />
            ))}
          </View>
          <Disclosure title={tr('Andere Anzahl', 'Other amount')}>
            <Field label={tr('Anzahl', 'Amount')}>
              <Input
                label={tr(`${item.name}: Anzahl`, `${item.name}: amount`)}
                value={amount}
                onChangeText={setAmount}
                keyboardType="number-pad"
                editable={!disabled}
              />
            </Field>
            <Button
              secondary
              title={tr('Hinzufügen', 'Add')}
              disabled={disabled || !integerInput(amount)}
              onPress={() => add(Number(amount), () => setAmount(''))}
            />
          </Disclosure>
          {last ? (
            <Button
              secondary
              small
              disabled={disabled}
              title={tr(
                `Letzte ${count(last.amount)} zurücknehmen`,
                `Undo last ${count(last.amount)}`,
              )}
              onPress={() =>
                onChange(state => removeChallengeEntry(state, item.id, last.id))
              }
            />
          ) : null}
        </>
      ) : null}
      {!compact ? (
        <>
          <Disclosure title={tr('Statistik', 'Statistics')}>
            <Row
              title={tr('Insgesamt erfasst', 'Total logged')}
              subtitle={count(stats.total)}
            />
            <Row
              title={tr('Größter einzelner Eintrag', 'Largest single entry')}
              subtitle={
                stats.largestEntry === null ? '–' : count(stats.largestEntry)
              }
            />
            <Row
              title={tr('Meiste an einem Tag', 'Most in one day')}
              subtitle={stats.bestDay === null ? '–' : count(stats.bestDay)}
            />
            <Row
              title={tr('Zieltage in Folge', 'Consecutive goal days')}
              subtitle={count(stats.currentStreak)}
            />
            <Row
              title={tr('Längste Folge', 'Longest streak')}
              subtitle={count(stats.longestStreak)}
            />
            <Row
              title={tr('Tagesziel erreicht', 'Daily goal reached')}
              subtitle={count(stats.completedDays)}
            />
            <Copy muted>
              {tr(
                'Ein Eintrag zählt die von dir eingetragene Anzahl; die Folge zählt Tage mit erreichtem Tagesziel.',
                'An entry counts the amount you logged; a streak counts days when you met your daily goal.',
              )}
            </Copy>
            <Copy muted>{stats.modelVersion}</Copy>
          </Disclosure>
          <Disclosure title={tr('Verlauf', 'History')}>
            {item.days
              .filter(d => d.entries.length > 0)
              .sort((a, b) => b.date.localeCompare(a.date))
              .map(d => (
                <Disclosure
                  key={d.date}
                  title={`${historyDate(d.date)} · ${count(
                    dayTotal(d),
                  )} / ${count(d.target)}`}
                >
                  {d.entries.map(entry => (
                    <Row
                      key={entry.id}
                      title={`+${count(entry.amount)}`}
                      subtitle={dateFormat({
                        hour: '2-digit',
                        minute: '2-digit',
                      }).format(entry.at)}
                      trailing={
                        <Button
                          secondary
                          small
                          disabled={disabled}
                          title={tr('Zurücknehmen', 'Undo')}
                          label={tr(
                            `${count(entry.amount)} vom ${historyDate(
                              d.date,
                            )} zurücknehmen`,
                            `Undo ${count(entry.amount)} from ${historyDate(
                              d.date,
                            )}`,
                          )}
                          onPress={() =>
                            onChange(state =>
                              removeChallengeEntry(state, item.id, entry.id),
                            )
                          }
                        />
                      }
                    />
                  ))}
                </Disclosure>
              ))}
            {!item.days.some(d => d.entries.length) ? (
              <Copy muted>{tr('Noch keine Einträge.', 'No entries yet.')}</Copy>
            ) : null}
          </Disclosure>
          <Row
            title={tr('Challenge bearbeiten', 'Edit challenge')}
            disabled={disabled}
            onPress={onEdit}
          />
        </>
      ) : null}
    </Card>
  );
}

function ChallengeEditor({
  item,
  disabled,
  onChange,
  onClose,
}: {
  item: Challenge | null;
  disabled: boolean;
  onChange: Change;
  onClose: () => void;
}) {
  const [name, setName] = useState(item?.name ?? '');
  const [target, setTarget] = useState(item ? String(item.target) : '100');
  const [steps, setSteps] = useState(item?.steps.join(', ') ?? '1, 5, 10');
  const [showOnHome, setShowOnHome] = useState(item?.showOnHome ?? true);
  const parsedSteps = challengeSteps(steps);
  const valid =
    name.trim().length > 0 && integerInput(target) && parsedSteps !== null;
  return (
    <Sheet
      visible
      title={
        item
          ? tr('Challenge bearbeiten', 'Edit challenge')
          : tr('Challenge erstellen', 'Create challenge')
      }
      onClose={onClose}
    >
      <Field label={tr('Name', 'Name')}>
        <Input
          label={tr('Challenge-Name', 'Challenge name')}
          value={name}
          onChangeText={setName}
          placeholder={tr('Zum Beispiel Liegestütze', 'For example push-ups')}
          maxLength={60}
          editable={!disabled}
        />
      </Field>
      <Field
        label={tr('Tagesziel', 'Daily goal')}
        hint={
          item
            ? tr(
                'Bereits erfasste Tage behalten ihr Ziel; das neue Ziel gilt ab dem nächsten noch nicht erfassten Tag.',
                'Logged days keep their goal; the new goal applies to the next day you have not logged yet.',
              )
            : undefined
        }
      >
        <Input
          label={tr('Tagesziel', 'Daily goal')}
          value={target}
          onChangeText={setTarget}
          keyboardType="number-pad"
          editable={!disabled}
        />
      </Field>
      <Field
        label={tr('Schnellbuttons', 'Quick buttons')}
        hint={tr(
          'Eine bis fünf verschiedene ganze Zahlen von 1 bis 1.000.000, mit Komma getrennt.',
          'One to five different whole numbers from 1 to 1,000,000, separated by commas.',
        )}
      >
        <Input
          label={tr('Schnellbuttons', 'Quick buttons')}
          value={steps}
          onChangeText={setSteps}
          editable={!disabled}
        />
      </Field>
      <CheckRow
        title={tr('Auf Heute anzeigen', 'Show on Today')}
        checked={showOnHome}
        disabled={disabled}
        onToggle={setShowOnHome}
      />
      <Button
        title={tr('Challenge speichern', 'Save challenge')}
        disabled={disabled || !valid}
        onPress={() => {
          if (!parsedSteps) return;
          const id = item?.id ?? newId();
          onChange(
            state => ({
              ...state,
              items: item
                ? state.items.map(current =>
                    current.id === id
                      ? {
                          ...current,
                          name: name.trim(),
                          target: Number(target),
                          steps: parsedSteps,
                          showOnHome,
                        }
                      : current,
                  )
                : [
                    ...state.items,
                    {
                      id,
                      name: name.trim(),
                      target: Number(target),
                      steps: parsedSteps,
                      showOnHome,
                      archived: false,
                      days: [],
                    },
                  ],
            }),
            onClose,
          );
        }}
      />
      {item ? (
        <>
          <Button
            secondary
            title={
              item.archived
                ? tr('Challenge fortsetzen', 'Resume challenge')
                : tr('Challenge archivieren', 'Archive challenge')
            }
            disabled={disabled}
            onPress={() =>
              onChange(
                state => ({
                  ...state,
                  items: state.items.map(current =>
                    current.id === item.id
                      ? { ...current, archived: !current.archived }
                      : current,
                  ),
                }),
                onClose,
              )
            }
          />
          <Button
            danger
            title={tr('Challenge löschen', 'Delete challenge')}
            disabled={disabled}
            onPress={() =>
              Alert.alert(
                tr('Challenge löschen?', 'Delete challenge?'),
                tr(
                  'Alle Einträge dieser Challenge werden gelöscht.',
                  'All entries for this challenge will be deleted.',
                ),
                [
                  { text: tr('Abbrechen', 'Cancel'), style: 'cancel' },
                  {
                    text: tr('Löschen', 'Delete'),
                    style: 'destructive',
                    onPress: () =>
                      onChange(
                        state => ({
                          ...state,
                          items: state.items.filter(
                            current => current.id !== item.id,
                          ),
                        }),
                        onClose,
                      ),
                  },
                ],
              )
            }
          />
        </>
      ) : null}
    </Sheet>
  );
}

export function ChallengesView({
  state,
  now,
  disabled,
  onChange,
  compact = false,
  onOpen,
}: {
  state: Challenges;
  now: number;
  disabled: boolean;
  onChange: Change;
  compact?: boolean;
  onOpen?: () => void;
}) {
  const [editing, setEditing] = useState<Challenge | 'new' | null>(null);
  const active = state.items.filter(
    item => !item.archived && (!compact || item.showOnHome),
  );
  return (
    <>
      {!compact ? <Title>{tr('Challenges', 'Challenges')}</Title> : null}
      <Section
        title={
          compact
            ? tr('Challenges', 'Challenges')
            : tr('Heute zählen', 'Log today')
        }
      >
        {active.map(item => (
          <ChallengeCard
            key={item.id}
            item={item}
            now={now}
            compact={compact}
            disabled={disabled}
            onChange={onChange}
            onEdit={() => setEditing(item)}
          />
        ))}
        {!active.length && !compact ? (
          <EmptyState
            title={tr(
              'Noch keine aktive Challenge',
              'No active challenges yet',
            )}
            copy={tr(
              'Lege eine eigene Challenge mit Tagesziel an.',
              'Create your own challenge with a daily goal.',
            )}
          />
        ) : null}
        {compact ? (
          <Row
            title={tr('Challenges öffnen', 'Open challenges')}
            onPress={onOpen}
          />
        ) : (
          <Button
            title={tr('Challenge erstellen', 'Create challenge')}
            onPress={() => setEditing('new')}
            disabled={disabled}
          />
        )}
      </Section>
      {!compact && state.items.some(item => item.archived) ? (
        <Disclosure title={tr('Archiviert', 'Archived')}>
          {state.items
            .filter(item => item.archived)
            .map(item => (
              <ChallengeCard
                key={item.id}
                item={item}
                now={now}
                compact={false}
                disabled={disabled}
                onChange={onChange}
                onEdit={() => setEditing(item)}
              />
            ))}
        </Disclosure>
      ) : null}
      {editing !== null ? (
        <ChallengeEditor
          item={editing === 'new' ? null : editing}
          disabled={disabled}
          onChange={onChange}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </>
  );
}
const styles = StyleSheet.create({
  buttons: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
});
