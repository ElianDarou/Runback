import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import { Statistics, defaultStatisticsView } from '../src/ui/Statistics';
import { StrengthSessionDetail } from '../src/ui/StrengthSessionDetail';
import { ExerciseDetail } from '../src/ui/ExerciseDetail';
import { DevelopmentScreen } from '../src/ui/DevelopmentScreen';
import type { Run } from '../src/native';
import type { StrengthHeart } from '../src/domain/strengthHeart';
import { Row, Stat } from '../src/ui/components';
import { DAY, strengthSession } from './fixtures/strengthSessions';
import { importedStrengthSession } from '../src/domain/strengthImports';
import { parseStrongCsvPreview } from '../src/domain/vendorImports';

const NOW = Date.now();

const run: Run = {
  id: 'run-1',
  startTime: NOW - 2 * DAY,
  endTime: NOW - 2 * DAY + 3_600_000,
  durationSeconds: 3600,
  distanceMeters: 10000,
  purpose: 'easy',
  source: 'test',
  status: 'completed',
};

const benchSession = (id: string, daysAgo: number, weightKg: number) =>
  strengthSession(
    id,
    NOW - daysAgo * DAY,
    [
      [
        'barbell_bench_press',
        'Bankdrücken',
        [
          { weightKg, reps: 8, at: 2 },
          { weightKg, reps: 8, at: 5 },
          { weightKg, reps: 8, at: 8 },
        ],
      ],
    ],
    { templateId: 'push', name: 'Push' },
  );

const sessions = [
  benchSession('s1', 28, 75),
  benchSession('s2', 21, 77.5),
  benchSession('s3', 14, 80),
  benchSession('s4', 7, 82.5),
];

const texts = (tree: ReactTestRenderer.ReactTestRenderer) =>
  tree.root
    .findAllByType('Text' as unknown as React.ComponentType)
    .map(node => JSON.stringify(node.props.children))
    .join(' ');

const pressables = (tree: ReactTestRenderer.ReactTestRenderer) =>
  tree.root.findAll(node => typeof node.props?.onPress === 'function');

const byLabel = (tree: ReactTestRenderer.ReactTestRenderer, label: string) =>
  pressables(tree).find(node => node.props.accessibilityLabel === label);

const create = (element: React.ReactElement) => {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  ReactTestRenderer.act(() => {
    tree = ReactTestRenderer.create(element);
  });
  return tree;
};

describe('Statistik · Bereich', () => {
  it('zeigt eine reine Importhistorie und öffnet ihre Einheit ohne native Aufzeichnung', () => {
    const workout = parseStrongCsvPreview(
      `Date;Workout Name;Exercise Name;Set Order;Weight (kg);Reps\n${NOW - DAY};Push;Bench Press (Barbell);1;80;8`,
    ).workouts[0];
    const session = importedStrengthSession(workout);
    const onOpenSession = jest.fn();
    const tree = create(<Statistics runs={[]} sessions={[session]} onOpenSession={onOpenSession} />);
    expect(texts(tree)).toContain('"Übungen"');
    expect(texts(tree)).not.toContain('Noch keine Läufe');
    const row = tree.root.findAllByType(Row).find(node => node.props.title === 'Push')!;
    ReactTestRenderer.act(() => row.props.onPress());
    expect(onOpenSession).toHaveBeenCalledWith(session.id);
    const detail = create(<StrengthSessionDetail session={session} history={[session]} heartSummaries={{}} />);
    expect(texts(detail)).toContain('Importiert aus Strong');
    expect(texts(detail)).toContain('80 kg × 8');
    expect(texts(detail)).toContain('"–"');
    const withoutLoad = importedStrengthSession({
      ...workout,
      sets: workout.sets.map(set => ({ ...set, weight: null })),
    });
    const development = create(
      <DevelopmentScreen runs={[]} sessions={[withoutLoad]} goal="" now={NOW} onEditGoal={jest.fn()} />,
    );
    expect(development.root.findAllByType(Stat).find(node => node.props.label === 'kg bewegt')?.props.value).toBe('–');
  });

  it('wählt den Bereich oben, wenn beide Daten haben', () => {
    const onViewChange = jest.fn();
    const tree = create(
      <Statistics
        runs={[run]}
        sessions={sessions}
        view={defaultStatisticsView}
        onViewChange={onViewChange}
      />,
    );
    expect(byLabel(tree, 'Laufen')).toBeDefined();
    ReactTestRenderer.act(() => {
      byLabel(tree, 'Krafttraining')!.props.onPress();
    });
    expect(onViewChange).toHaveBeenCalledWith({
      ...defaultStatisticsView,
      area: 'strength',
    });
  });

  it('zeigt im Krafttraining Einheiten, Übungen und Muskeln', () => {
    const onOpenExercise = jest.fn();
    const tree = create(
      <Statistics
        runs={[run]}
        sessions={sessions}
        view={{ ...defaultStatisticsView, area: 'strength' }}
        onOpenExercise={onOpenExercise}
      />,
    );
    const all = texts(tree);
    expect(all).toContain('Einheiten');
    expect(all).toContain('"Übungen"');
    expect(all).toContain('"Muskeln"');
    expect(all).not.toContain('"Ø Tempo"');
    const exercise = tree.root
      .findAllByType(Row)
      .find(node => node.props.title === 'Bankdrücken')!;
    ReactTestRenderer.act(() => exercise.props.onPress());
    expect(onOpenExercise).toHaveBeenCalledWith('barbell_bench_press');
  });

  it('zeigt ohne Laufbereich nur das Krafttraining, ohne Bereichswahl', () => {
    const tree = create(
      <Statistics runs={[run]} sessions={sessions} showRunning={false} />,
    );
    expect(byLabel(tree, 'Laufen')).toBeUndefined();
    expect(texts(tree)).toContain('"Übungen"');
  });

  it('bietet Puls im Verlauf nur an, wenn die Uhr gemessen hat', () => {
    const view = { ...defaultStatisticsView, area: 'strength' as const };
    const without = create(
      <Statistics runs={[run]} sessions={sessions} view={view} />,
    );
    expect(byLabel(without, 'Puls')).toBeUndefined();
    const withHeart = create(
      <Statistics
        runs={[run]}
        sessions={sessions}
        view={view}
        heart={{
          s4: {
            model_version: 'strength-heart-v1',
            source: 'watch',
            startTime: 0,
            stepSeconds: 5,
            averageBpm: 118,
            maxBpm: 150,
            minBpm: 80,
            coverage: 1,
            samples: 100,
            clockAligned: true,
          },
        }}
      />,
    );
    expect(byLabel(withHeart, 'Puls')).toBeDefined();
  });
});

describe('Detail einer Krafteinheit', () => {
  const current = benchSession('now', 0, 90);
  const values = Array.from({ length: 144 }, (_, index) =>
    index % 24 < 6 ? 140 : 105,
  );
  const heart: StrengthHeart = {
    model_version: 'strength-heart-v1',
    source: 'watch',
    startTime: current.startTime,
    stepSeconds: 5,
    averageBpm: 115,
    maxBpm: 140,
    minBpm: 105,
    coverage: 1,
    samples: 700,
    clockAligned: true,
    values,
  };

  it('vergleicht mit früheren Einheiten derselben Vorlage und öffnet Übungen', () => {
    const onOpenExercise = jest.fn();
    const tree = create(
      <StrengthSessionDetail
        session={current}
        history={sessions}
        heartSummaries={{}}
        onOpenExercise={onOpenExercise}
      />,
    );
    const all = texts(tree);
    expect(all).toContain(
      'Prozent gegenüber dem Median deiner letzten 4 Einheiten',
    );
    expect(all).toContain('90 kg × 8 · 90 kg × 8 · 90 kg × 8');
    // Kein Puls ohne Uhr — auch kein leerer Abschnitt.
    expect(all).not.toContain('"Puls"');
    const row = tree.root
      .findAllByType(Row)
      .find(node => node.props.title === 'Bankdrücken')!;
    ReactTestRenderer.act(() => row.props.onPress());
    expect(onOpenExercise).toHaveBeenCalledWith('barbell_bench_press');
  });

  it('zeigt den Puls der Uhr mit Satzende und Erholung', () => {
    const tree = create(
      <StrengthSessionDetail
        session={current}
        history={sessions}
        heart={heart}
        heartSummaries={{}}
      />,
    );
    const all = texts(tree);
    expect(all).toContain('"Puls"');
    expect(all).toContain('Puls am Satzende');
    expect(all).toContain('Abfall in der ersten Pausenminute');
  });
});

describe('Übungsverlauf', () => {
  it('zeigt Richtung, Bestwerte und öffnet Einheiten', () => {
    const onOpenSession = jest.fn();
    const tree = create(
      <ExerciseDetail
        exerciseId="barbell_bench_press"
        sessions={sessions}
        onOpenSession={onOpenSession}
      />,
    );
    const all = texts(tree);
    expect(all).toContain('"Bankdrücken"');
    // Vier Trainingstage tragen noch keine Richtung.
    expect(all).toContain('"Noch nicht klar"');
    expect(all).toContain('Schwerstes Gewicht');
    const newest = tree.root
      .findAllByType(Row)
      .find(node => String(node.props.title).endsWith('· Push'))!;
    ReactTestRenderer.act(() => newest.props.onPress());
    expect(onOpenSession).toHaveBeenCalledWith('s4');
  });

  it('bleibt ohne abgehakten Satz leer statt Nullen zu zeigen', () => {
    const tree = create(
      <ExerciseDetail exerciseId="unknown" sessions={sessions} />,
    );
    expect(texts(tree)).toContain('Noch kein Satz');
  });
});

describe('watch data on a finished session', () => {
  const session = strengthSession('session-w', NOW - DAY, [
    ['bench', 'Bankdrücken', [{ weightKg: 80, reps: 8, at: 5 }]],
  ]);
  const watch = (status: string, watchStatus = 'recording') => ({
    sessionId: 'session-w',
    status,
    capture: { motion: false, heartRate: true },
    watch: { status: watchStatus, message: 'Keine Uhr verbunden.' },
  });
  const detail = (
    info: ReturnType<typeof watch> | null,
    heart?: StrengthHeart,
  ) =>
    texts(
      create(
        <StrengthSessionDetail
          session={session}
          history={[session]}
          heartSummaries={{}}
          heart={heart}
          watch={info}
        />,
      ),
    );

  it('says the pulse is still on its way', () => {
    const shown = detail(watch('stopped'));
    expect(shown).toContain('Wartet');
    expect(shown).toContain('Puls kommt, sobald die Uhr in der Nähe ist.');
  });

  it('says when the watch never recorded', () => {
    const shown = detail(watch('stopped', 'disconnected'));
    expect(shown).toContain('Nicht aufgezeichnet');
    expect(shown).toContain('Keine Uhr verbunden.');
  });

  it('stays quiet without a watch', () => {
    expect(detail(null)).not.toContain('Uhr');
  });
});
