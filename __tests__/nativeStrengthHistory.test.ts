jest.mock('react-native', () => ({
  NativeModules: {
    Runback: {
      getStrengthSessions: jest.fn(),
      getStrengthSession: jest.fn(),
    },
  },
}));
import { NativeModules } from 'react-native';
import { native } from '../src/native';
import { parseStrongCsvPreview } from '../src/domain/vendorImports';
import { sessionProgress } from '../src/domain/strength';
import { strengthSession } from './fixtures/strengthSessions';

const module = NativeModules.Runback;
const imports = parseStrongCsvPreview(
  'Date;Workout Name;Exercise Name;Set Order;Weight (kg);Reps\n2026-03-08 10:00:00;Push;Bench Press (Barbell);1;80;8',
).workouts;
imports[0].id = 'strong:test';

it('loads and sorts imports together with local sessions via the existing bridge', async () => {
  const local = strengthSession('local', imports[0].time - 86400000, []);
  module.getStrengthSessions.mockResolvedValue({ sessions: [local], imports });
  const sessions = await native.strengthSessions(500);
  expect(sessions.map(session => session.id)).toEqual(['strong:test', 'local']);
  expect(sessionProgress(sessions[0]).completedSets).toBe(1);
  expect(await native.strengthSessions(1)).toHaveLength(1);
  module.getStrengthSessions.mockResolvedValue({
    sessions: [sessions[0]],
    imports,
  });
  expect(await native.strengthSessions(500)).toHaveLength(1);
});

it('opens imported details and supports answers from older builds', async () => {
  module.getStrengthSession.mockResolvedValue(imports[0]);
  expect(
    (await native.strengthSession('strong:test')).importSource?.workoutId,
  ).toBe('strong:test');
  const local = strengthSession('local', imports[0].time, []);
  module.getStrengthSessions.mockResolvedValue({ sessions: [local] });
  expect(await native.strengthSessions()).toEqual([local]);
  module.getStrengthSession.mockResolvedValue(local);
  expect(await native.strengthSession('local')).toEqual(local);
});
