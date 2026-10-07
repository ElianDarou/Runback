declare const __dirname: string;
const { readFileSync } = require('fs') as {
  readFileSync(path: string, encoding: string): string;
};
const { join } = require('path') as { join(...parts: string[]): string };
import {
  CATALOG_VERSION,
  STRENGTH_MODEL_VERSION,
  startSession,
  type WorkoutTemplate,
} from '../src/domain/strength';

// Die Uhr startet Einheiten über Kotlin `StrengthLive.startSession`. Dieselbe
// Vorlage und Zeit stehen in StrengthLiveTest.kt; beide müssen gleich rechnen.
const template: WorkoutTemplate = {
  id: 'tpl-push',
  name: 'Push',
  days: [1, 4],
  createdAt: 0,
  exercises: [
    {
      exerciseId: 'bench',
      name: 'Bankdrücken',
      sets: [
        {
          kind: 'normal',
          loadKind: 'kg',
          reps: 8,
          weightKg: 80,
          restSeconds: 90,
        },
        {
          kind: 'normal',
          loadKind: 'kg',
          reps: 8,
          weightKg: 80,
          restSeconds: 90,
        },
      ],
    },
    {
      exerciseId: 'dip',
      name: 'Dips',
      sets: [{ kind: 'normal', loadKind: 'kg', reps: 10, restSeconds: 90 }],
    },
  ],
} as unknown as WorkoutTemplate;

it('builds the same set ids as the watch start on the phone', () => {
  const session = startSession(template, 1_700_000_000_000);
  expect(
    session.exercises.flatMap(exercise => exercise.sets.map(set => set.id)),
  ).toEqual(['bench-loyw3v28-0-0', 'bench-loyw3v28-0-1', 'dip-loyw3v28-1-0']);
  expect(session.name).toBe('Push');
  expect(session.templateId).toBe('tpl-push');
  expect(startSession(null, 5).name).toBe('Freies Training');
});

it('keeps the versions of the Kotlin start in step', () => {
  const kotlin = readFileSync(
    join(
      __dirname,
      '../android/core/src/main/java/com/runback/core/StrengthLive.kt',
    ),
    'utf8',
  );
  expect(kotlin).toContain(
    `STRENGTH_MODEL_VERSION = "${STRENGTH_MODEL_VERSION}"`,
  );
  expect(kotlin).toContain(`CATALOG_VERSION = "${CATALOG_VERSION}"`);
});
