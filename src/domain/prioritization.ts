import { BROAD_FOCUS, type FocusKind } from './focus';
import { tr } from './i18n';

export const RELEVANCE_VERSION = 'relevance-v2';
export type ActionClass =
  | 'calmer_start'
  | 'heart_rate'
  | 'cadence'
  | 'volume'
  | 'technique'
  | 'taper'
  | 'strength_load';
/**
 * Editorial weights 0–5 per action class and focus type. `null` is a hard
 * block. A missing focus type counts as "no focus" (0). The weights are not
 * learned from user data.
 */
const weights: Record<
  ActionClass,
  Partial<Record<FocusKind, number | null>>
> = {
  calmer_start: { endurance: 5, speed: 3, injury_free: 3, habit: 4 },
  heart_rate: { endurance: 4, speed: 3, injury_free: 2, habit: 1 },
  cadence: { endurance: 2, speed: 4, injury_free: 1, habit: 1 },
  volume: { endurance: 5, speed: 4, injury_free: null, habit: 3 },
  technique: { endurance: 2, speed: 4, injury_free: 1, habit: 1 },
  taper: { endurance: 2, speed: 3, injury_free: 3, habit: 0 },
  strength_load: {
    strength: 5,
    muscle: 4,
    injury_free: 3,
    habit: 2,
    endurance: 1,
    speed: 1,
  },
};
export function relevance(
  action: ActionClass,
  focus?: FocusKind,
  targetDate?: string,
  today?: string,
): { weight: number; blocked?: string } {
  const table = weights[action];
  // `null` is a block and must not turn into 0.
  const weight =
    focus && !BROAD_FOCUS.includes(focus) && focus in table
      ? (table[focus] as number | null)
      : 0;
  if (weight === null)
    return {
      weight: 0,
      blocked: tr(
        'Bei Fokus „verletzungsfrei bleiben“ sind Empfehlungen für mehr Umfang gesperrt.',
        'With the focus "Stay injury-free", recommendations for more volume are blocked.',
      ),
    };
  if (targetDate && today) {
    const days = (Date.parse(targetDate) - Date.parse(today)) / 86400000;
    if (Number.isFinite(days) && days >= 0) {
      if (action === 'technique' && days <= 21)
        return {
          weight,
          blocked: tr(
            'So kurz vor deinem Ziel ist ein Technikumbau gesperrt.',
            'So close to your goal, a technique build-up is blocked.',
          ),
        };
      if (action === 'taper' && days > 84)
        return {
          weight,
          blocked: tr(
            'Für die Entlastung vor deinem Ziel ist es noch zu früh.',
            'It is still too early for a taper before your goal.',
          ),
        };
    }
  }
  return { weight };
}
