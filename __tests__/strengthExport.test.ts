import {
  isRecordedStrengthSession,
  STRENGTH_EXPORT_VERSION,
  strengthExportChunk,
  strengthExportHeaders,
  strengthExportReadme,
} from '../src/domain/strengthExport';
import type { StrengthHeart } from '../src/domain/strengthHeart';
import { importedStrengthSession } from '../src/domain/strengthImports';
import { MINUTE, strengthSession } from './fixtures/strengthSessions';

const START = Date.UTC(2026, 9, 1, 16);

/** Einfacher CSV-Leser für die Tests: Anführungszeichen, Kommas, Zeilen. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"') quoted = true;
    else if (char === ',') {
      row.push(cell);
      cell = '';
    } else if (char === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += char;
  }
  return rows;
}
const table = (header: string, body: string) => {
  const [columns, ...rows] = parseCsv(header + body);
  return rows.map(row => {
    expect(row).toHaveLength(columns.length);
    return Object.fromEntries(columns.map((column, i) => [column, row[i]]));
  });
};

const session = () =>
  strengthSession('s1', START, [
    [
      'barbell_bench_press',
      'Bankdrücken',
      [
        { weightKg: 40, reps: 10, at: 2, warmup: true },
        { weightKg: 80, reps: 8, at: 5, rir: 2 },
        { weightKg: 80, reps: 7, at: 8 },
        { weightKg: 80, reps: 8 },
        { weightKg: 80, reps: 8, at: 10, skipped: true },
      ],
    ],
    ['custom', 'Eigene, "neue" Übung', [{ reps: 15, at: 15 }]],
  ]);

describe('strength export', () => {
  it('keeps only sessions recorded in Runback', () => {
    expect(isRecordedStrengthSession(session())).toBe(true);
    expect(isRecordedStrengthSession({ ...session(), status: 'active' })).toBe(
      false,
    );
    const imported = importedStrengthSession({
      id: 'w1',
      time: START,
      name: 'Strong',
      durationSeconds: 3600,
      source: 'strong',
      sets: [],
    } as any);
    expect(isRecordedStrengthSession(imported)).toBe(false);
  });

  it('writes one row per set with plan and actual apart and nothing invented', () => {
    const headers = strengthExportHeaders();
    const sets = table(headers.sets, strengthExportChunk(session()).sets);
    expect(sets).toHaveLength(6);
    const [warmup, first, second, open, skipped, custom] = sets;
    expect(warmup).toMatchObject({
      set_kind: 'warmup',
      status: 'completed',
      volume_kg: '400',
      e1rm_kg: '',
      completed_after_s: '120',
      gap_since_previous_set_s: '',
    });
    expect(first).toMatchObject({
      exercise_id: 'barbell_bench_press',
      equipment: 'barbell',
      muscle_groups: 'chest;triceps',
      planned_weight_kg: '80',
      actual_weight_kg: '80',
      actual_reps: '8',
      rir: '2',
      e1rm_kg: '101.3',
      gap_since_previous_set_s: '180',
      completed_at_utc: new Date(START + 5 * MINUTE).toISOString(),
    });
    expect(second).toMatchObject({
      actual_reps: '7',
      rir: '',
      gap_since_previous_set_s: '180',
    });
    // Offen und übersprungen: Plan bleibt, Ist-Werte und Ableitungen fehlen.
    for (const set of [open, skipped]) {
      expect(set).toMatchObject({
        planned_reps: '8',
        actual_reps: '',
        actual_weight_kg: '',
        volume_kg: '',
        e1rm_kg: '',
      });
    }
    expect(open.status).toBe('open');
    expect(skipped.status).toBe('skipped');
    expect(custom).toMatchObject({
      exercise_name: 'Eigene, "neue" Übung',
      equipment: '',
      muscle_groups: '',
      load_kind: 'bodyweight',
      actual_reps: '15',
      volume_kg: '',
      e1rm_kg: '',
    });
  });

  it('sums a session like the app and leaves unknown heart values empty', () => {
    const headers = strengthExportHeaders();
    const chunk = strengthExportChunk(session());
    const [row] = table(headers.sessions, chunk.sessions);
    expect(row).toMatchObject({
      session_id: 's1',
      duration_s: '3600',
      sets_completed: '4',
      sets_working: '3',
      sets_warmup: '1',
      sets_skipped: '1',
      sets_open: '1',
      total_reps: '40',
      sets_with_reps: '4',
      volume_kg: '1600',
      sets_with_volume: '3',
      heart_source: '',
      heart_avg_bpm: '',
    });
    expect(chunk.heart).toBe('');
    expect(chunk.heartSessions).toBe(0);
    const json = JSON.parse(chunk.jsonl);
    expect(json.exportVersion).toBe(STRENGTH_EXPORT_VERSION);
    expect(json.exercises[0].sets[3].status).toBe('open');
    expect(json.exercises[0].sets[3].actual).toBeUndefined();
    expect(json.exercises[0].sets[3].planned).toMatchObject({
      reps: 8,
      weightKg: 80,
    });
  });

  it('leaves totals empty when no set carries the value', () => {
    const headers = strengthExportHeaders();
    const blank = strengthSession('s2', START, [
      ['plank', 'Unterarmstütz', [{ seconds: 60, at: 2 }, { at: 4 }]],
    ]);
    const chunk = strengthExportChunk(blank);
    expect(table(headers.sessions, chunk.sessions)[0]).toMatchObject({
      sets_completed: '2',
      total_reps: '',
      sets_with_reps: '0',
      volume_kg: '',
      sets_with_volume: '0',
    });
    const exercise = JSON.parse(chunk.jsonl).exercises[0];
    expect(exercise.totalReps).toBeUndefined();
    expect(exercise.volumeKg).toBeUndefined();
    expect(exercise.setsWithReps).toBe(0);
    expect(chunk.log).not.toContain('Volumen');
  });

  it('exports heart windows with gaps and the per-set heart', () => {
    const values: (number | null)[] = Array.from({ length: 720 }, () => 110);
    values[0] = null;
    // Satz bei 5 min (Fenster 60): Spitze kurz davor.
    values[58] = 150;
    const heart: StrengthHeart = {
      model_version: 'strength-heart-v1',
      source: 'watch',
      startTime: START,
      stepSeconds: 5,
      averageBpm: 110,
      maxBpm: 150,
      minBpm: 110,
      coverage: 0.999,
      samples: 2000,
      clockAligned: true,
      values,
    };
    const headers = strengthExportHeaders();
    const chunk = strengthExportChunk(session(), heart);
    const windows = table(headers.heart, chunk.heart);
    expect(windows).toHaveLength(720);
    expect(windows[0]).toMatchObject({
      window_start_s: '0',
      window_s: '5',
      bpm: '',
    });
    expect(windows[1]).toMatchObject({ window_start_s: '5', bpm: '110' });
    const sets = table(headers.sets, chunk.sets);
    expect(sets[1].heart_peak_bpm).toBe('150');
    // Nächster Satz erst 3 min später: Abfall in der ersten Minute zählt.
    expect(sets[1].heart_recovery_bpm).toBe('40');
    // Gleichbleibender Puls: Abfall 0, nicht leer.
    expect(sets[2].heart_recovery_bpm).toBe('0');
    expect(table(headers.sessions, chunk.sessions)[0]).toMatchObject({
      heart_source: 'watch',
      heart_max_bpm: '150',
      heart_clock_aligned: 'true',
    });
    expect(chunk.log).toContain('Puls Ø 110, max 150 (Uhr)');
  });

  it('writes a readable log in German', () => {
    const base = session();
    base.exercises[0].sets[2].actualReps = 6;
    const log = strengthExportChunk({ ...base, note: 'Schulter zwickt' }).log;
    expect(log).toContain('· Oberkörper');
    expect(log).toContain('60 min · 4 Sätze abgehakt · 1.520 kg Volumen');
    expect(log).toContain('Notiz: Schulter zwickt');
    expect(log).toContain('- Aufwärmen: 40 kg × 10');
    expect(log).toContain('- 80 kg × 8 · 2 Wdh. im Tank');
    expect(log).toContain('- 80 kg × 6 · Plan 80 kg × 7');
    expect(log).toContain('- nicht abgehakt (Plan 80 kg × 8)');
    expect(log).toContain('- übersprungen (Plan 80 kg × 8)');
  });

  it('describes the files with counts, context and versions', () => {
    const readme = strengthExportReadme({
      exportedAt: START,
      sessions: 2,
      sets: 12,
      heartSessions: 1,
      firstStart: START - 7 * 24 * 60 * MINUTE,
      lastStart: START,
      goal: '100 kg Bankdrücken',
      focus: {
        version: 'focus-v1',
        kind: 'strength',
        label: 'Stärker werden',
        area: 'strength',
      },
    });
    expect(readme).toContain(STRENGTH_EXPORT_VERSION);
    expect(readme).toContain('2 Einheiten, 12 Sätze, 1 Einheiten mit Puls');
    expect(readme).toContain('(7 Tage)');
    expect(readme).toContain('Ziel Krafttraining: 100 kg Bankdrücken');
    expect(readme).toContain('Fokus Krafttraining: Stärker werden');
    expect(readme).toContain('Importe (z. B. Strong) fehlen');
  });
});
