import { tr } from './i18n';

/**
 * Symbols that stand for a workout in the calendar. A run and a ride have
 * fixed ones; each strength template has one the user picks. Stored by name on
 * the template; an unknown or missing name shows the barbell.
 */
export const TEMPLATE_ICONS = [
  'barbell',
  'kettlebell',
  'weight',
  'gymnastics',
  'handGrab',
  'stairsUp',
  'stretching',
  'yoga',
  'karate',
  'jumpRope',
  'swimming',
  'treadmill',
  'heartbeat',
  'flame',
  'bolt',
  'mountain',
  'target',
  'trophy',
] as const;

export type TemplateIcon = (typeof TEMPLATE_ICONS)[number];
export type TrainingIcon = TemplateIcon | 'run' | 'bike';

export const DEFAULT_TEMPLATE_ICON: TemplateIcon = 'barbell';

export function templateIcon(
  template: { icon?: unknown } | null | undefined,
): TemplateIcon {
  return TEMPLATE_ICONS.includes(template?.icon as TemplateIcon)
    ? (template!.icon as TemplateIcon)
    : DEFAULT_TEMPLATE_ICON;
}

/** Name read out for a symbol, for the picker. */
export function iconLabel(icon: TrainingIcon): string {
  switch (icon) {
    case 'run':
      return tr('Laufen', 'Running');
    case 'bike':
      return tr('Radfahren', 'Cycling');
    case 'barbell':
      return tr('Langhantel', 'Barbell');
    case 'kettlebell':
      return tr('Kettlebell', 'Kettlebell');
    case 'weight':
      return tr('Gewicht', 'Weight');
    case 'gymnastics':
      return tr('Turnen', 'Gymnastics');
    case 'handGrab':
      return tr('Greifen', 'Grip');
    case 'stairsUp':
      return tr('Stufen', 'Steps');
    case 'stretching':
      return tr('Dehnen', 'Stretching');
    case 'yoga':
      return tr('Yoga', 'Yoga');
    case 'karate':
      return tr('Kampfsport', 'Martial arts');
    case 'jumpRope':
      return tr('Seilspringen', 'Jump rope');
    case 'swimming':
      return tr('Schwimmen', 'Swimming');
    case 'treadmill':
      return tr('Laufband', 'Treadmill');
    case 'heartbeat':
      return tr('Puls', 'Heartbeat');
    case 'flame':
      return tr('Flamme', 'Flame');
    case 'bolt':
      return tr('Blitz', 'Bolt');
    case 'mountain':
      return tr('Berg', 'Mountain');
    case 'target':
      return tr('Ziel', 'Target');
    case 'trophy':
      return tr('Pokal', 'Trophy');
  }
}
