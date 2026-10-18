import {
  addChallengeEntry,
  challengeCalendar,
  challengeDay,
  challengeStats,
  challengeSteps,
  dayTotal,
  normalizeChallenges,
  removeChallengeEntry,
  type Challenge,
  type Challenges,
} from './challenges';

const at = (date: string) => new Date(`${date}T12:00:00`).getTime();
const challenge = (patch: Partial<Challenge> = {}): Challenge => ({
  id: 'push',
  name: 'Liegestütze',
  target: 100,
  steps: [1, 5, 10],
  archived: false,
  showOnHome: true,
  days: [],
  ...patch,
});
const initial = (): Challenges => ({
  version: 1,
  items: [challenge(), challenge({ id: 'squat', name: 'Kniebeugen' })],
});
const log = (s: Challenges, date: string, amount = 100, id = date) =>
  addChallengeEntry(s, 'push', amount, at(date), id);

describe('manual challenges', () => {
  it('keeps independent counters, allows exceeding the goal, and removes a specific mistaken entry', () => {
    const original = initial();
    let s = log(original, '2026-10-18', 100, 'a');
    s = log(s, '2026-10-18', 10, 'b');
    expect(dayTotal(challengeDay(s.items[0], '2026-10-18'))).toBe(110);
    expect(s.items[1].days).toEqual([]);
    expect(original.items[0].days).toEqual([]);
    expect(log(s, '2026-10-18', 10, 'b')).toEqual(s);
    s = removeChallengeEntry(s, 'push', 'a');
    expect(challengeStats(s.items[0], '2026-10-18')).toMatchObject({
      total: 10,
      largestEntry: 10,
      bestDay: 10,
      completedDays: 0,
    });
    s = removeChallengeEntry(s, 'push', 'b');
    expect(challengeStats(s.items[0], '2026-10-18').bestDay).toBeNull();
    expect(challengeCalendar(s)).toEqual({});
  });
  it('freezes each logged day goal, including after undo, and uses new goals on new days', () => {
    let s = log(initial(), '2026-10-18');
    s.items[0] = { ...s.items[0], target: 200 };
    s = log(s, '2026-10-19', 150);
    s = log(s, '2026-10-18', 1, 'later');
    expect(challengeDay(s.items[0], '2026-10-18')?.target).toBe(100);
    expect(challengeDay(s.items[0], '2026-10-19')?.target).toBe(200);
    expect(challengeStats(s.items[0], '2026-10-19').completedDays).toBe(1);
    s = removeChallengeEntry(
      removeChallengeEntry(s, 'push', '2026-10-18'),
      'push',
      'later',
    );
    s = log(s, '2026-10-18', 100, 'again');
    expect(challengeDay(s.items[0], '2026-10-18')?.target).toBe(100);
  });
  it('counts goal-day streaks over month boundaries and DST without counting incomplete or future days', () => {
    let s = initial();
    for (const date of [
      '2026-03-28',
      '2026-03-29',
      '2026-03-30',
      '2026-03-31',
      '2026-04-01',
    ])
      s = log(s, date);
    s = log(s, '2026-04-02', 5);
    s = log(s, '2026-04-04', 1000);
    expect(challengeStats(s.items[0], '2026-04-02')).toMatchObject({
      currentStreak: 5,
      longestStreak: 5,
      bestDay: 100,
      total: 505,
    });
    expect(challengeStats(s.items[0], '2026-04-03').currentStreak).toBe(0);
    s = removeChallengeEntry(s, 'push', '2026-03-30');
    expect(challengeStats(s.items[0], '2026-04-02')).toMatchObject({
      currentStreak: 2,
      longestStreak: 2,
    });
  });
  it('uses the local date at midnight and keeps archived history visible without accepting more entries', () => {
    let s = addChallengeEntry(
      initial(),
      'push',
      1,
      new Date(2026, 9, 31, 23, 59).getTime(),
      'a',
    );
    s = addChallengeEntry(
      s,
      'push',
      5,
      new Date(2026, 10, 1, 0, 1).getTime(),
      'b',
    );
    s.items[0].archived = true;
    expect(log(s, '2026-11-01')).toEqual(s);
    expect(challengeCalendar(s)).toMatchObject({
      '2026-10-31': [{ name: 'Liegestütze', total: 1 }],
      '2026-11-01': [{ name: 'Liegestütze', total: 5 }],
    });
  });
  it('round trips all manual history through settings JSON and keeps user names unchanged', () => {
    const s = log(initial(), '2026-10-18', 50);
    expect(normalizeChallenges(JSON.parse(JSON.stringify(s)))).toEqual(s);
  });
  it('keeps healthy records when unrelated saved records are malformed', () => {
    const s = log(initial(), '2026-10-18');
    const raw = JSON.parse(JSON.stringify(s));
    raw.items.unshift(null, { id: 'bad', target: -1 });
    raw.items[2].days.push({ date: '2026-02-30', target: 100, entries: [] });
    raw.items[2].days[0].entries.push({ id: 'bad', at: 1, amount: -5 });
    expect(normalizeChallenges(raw)).toEqual(s);
    expect(normalizeChallenges(undefined)).toEqual({ version: 1, items: [] });
  });
  it.each(['', '0', '-1', '1.5', '1,1', '1,2,3,4,5,6', '1000001', 'NaN'])(
    'rejects invalid quick buttons: %s',
    text => {
      expect(challengeSteps(text)).toBeNull();
    },
  );
  it('validates whole counts and custom quick steps', () => {
    expect(challengeSteps('1, 5, 25')).toEqual([1, 5, 25]);
    expect(() => log(initial(), '2026-10-18', 0)).toThrow();
    expect(() => log(initial(), '2026-10-18', 1.5)).toThrow();
  });
});
