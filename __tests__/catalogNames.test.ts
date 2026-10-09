import {
  CATALOG,
  catalogExercise,
  exerciseDisplayName,
  exerciseName,
  nativeDisplayNames,
} from '../src/domain/catalog';
import { exerciseMuscleLabels } from '../src/domain/catalogData';
import { setLanguage } from '../src/domain/i18n';
import type { Exercise } from '../src/domain/strength';

describe('exercise names', () => {
  afterEach(() => setLanguage('de'));

  it('shows the German catalog name by default', () => {
    expect(exerciseName(catalogExercise('barbell_back_squat')!)).toBe(
      'Kniebeuge (Langhantel)',
    );
  });

  it('shows the English catalog name in English', () => {
    setLanguage('en');
    expect(exerciseName(catalogExercise('barbell_back_squat')!)).toBe(
      'Back squat (barbell)',
    );
  });

  it('falls back to the German name when no English name exists', () => {
    const exercise: Exercise = {
      id: 'user_exercise',
      name: 'Eigene Übung',
      equipment: 'other',
      shares: {},
      origin: 'user',
    };
    setLanguage('en');
    expect(exerciseName(exercise)).toBe('Eigene Übung');
  });

  it('translates a stored catalog default name', () => {
    setLanguage('en');
    expect(exerciseDisplayName('leg_press', 'Beinpresse')).toBe('Leg press');
  });

  it('keeps a name the user typed, even for a catalog exercise', () => {
    setLanguage('en');
    expect(exerciseDisplayName('leg_press', 'Meine Beinpresse')).toBe(
      'Meine Beinpresse',
    );
  });

  it('keeps a stored name for an exercise that is not in the catalog', () => {
    setLanguage('en');
    expect(exerciseDisplayName('user_exercise', 'Eigene Übung')).toBe(
      'Eigene Übung',
    );
  });

  it('uses the English database name for imported exercises', () => {
    const exercise = catalogExercise('fedb:Arnold_Dumbbell_Press')!;
    expect(exercise.name).toBe('Arnold-Drücken (Kurzhantel)');
    setLanguage('en');
    expect(exerciseDisplayName(exercise.id, exercise.name)).toBe(
      'Arnold Dumbbell Press',
    );
  });

  it('shows muscle groups in the active language', () => {
    const exercise = catalogExercise('fedb:Arnold_Dumbbell_Press')!;
    expect(exerciseMuscleLabels(exercise)).toEqual(['Schultern']);
    setLanguage('en');
    expect(exerciseMuscleLabels(exercise)).toEqual(['Shoulders']);
  });
});

describe('native display names', () => {
  afterEach(() => setLanguage('de'));

  it('sends no names in German, where stored and visible names are the same', () => {
    expect(nativeDisplayNames('de')).toEqual({ language: 'de', names: {} });
  });

  it('maps every stored German catalog name to its English name', () => {
    const { language, names } = nativeDisplayNames('en');
    expect(language).toBe('en');
    expect(names['Kniebeuge (Langhantel)']).toBe('Back squat (barbell)');
    expect(names['Beinpresse']).toBe('Leg press');
    for (const [stored, display] of Object.entries(names)) {
      expect(CATALOG.some(exercise => exercise.name === stored)).toBe(true);
      expect(display).not.toBe(stored);
    }
  });

  it('only includes names that differ, so the payload stays bounded', () => {
    const differing = CATALOG.filter(
      exercise => exercise.en && exercise.en !== exercise.name,
    ).length;
    expect(Object.keys(nativeDisplayNames('en').names).length).toBeLessThanOrEqual(
      differing,
    );
    expect(Object.keys(nativeDisplayNames('en').names).length).toBeGreaterThan(0);
  });

  it('defaults to the active language', () => {
    setLanguage('en');
    expect(nativeDisplayNames().language).toBe('en');
    expect(nativeDisplayNames().names['Beinpresse']).toBe('Leg press');
  });
});
