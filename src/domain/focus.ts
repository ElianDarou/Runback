import type { Area } from './types';
import { tr } from './i18n';

export const FOCUS_VERSION = 'focus-v1';
/** Focus types for running. Prioritization uses `value`; names come from `focusTypeLabel`. */
export const FOCUS_TYPES = [
  { value: 'endurance' },
  { value: 'speed' },
  { value: 'injury_free' },
  { value: 'habit' },
  { value: 'fitness' },
] as const;
/** Focus types for strength training. Own area, own list. */
export const STRENGTH_FOCUS_TYPES = [
  { value: 'strength' },
  { value: 'muscle' },
  { value: 'injury_free' },
  { value: 'habit' },
  { value: 'fitness' },
] as const;
export type FocusKind =
  | (typeof FOCUS_TYPES)[number]['value']
  | (typeof STRENGTH_FOCUS_TYPES)[number]['value'];
/** Broad foci give no yardstick; they count as "no focus". */
export const BROAD_FOCUS: readonly FocusKind[] = ['fitness'];
export interface TrainingFocus {
  version: typeof FOCUS_VERSION;
  kind: FocusKind;
  label: string;
  /** A missing field means the focus belongs to running. */
  area?: Area;
}

/** Visible name of a focus type in the active language; `undefined` for unknown kinds. */
export function focusTypeLabel(kind?: FocusKind): string | undefined {
  switch (kind) {
    case 'endurance':
      return tr('Ausdauer aufbauen', 'Build endurance');
    case 'speed':
      return tr('Schneller werden', 'Get faster');
    case 'injury_free':
      return tr('Verletzungsfrei bleiben', 'Stay injury-free');
    case 'habit':
      return tr('Gewohnheit aufbauen', 'Build a habit');
    case 'fitness':
      return tr('Allgemeine Fitness', 'General fitness');
    case 'strength':
      return tr('Stärker werden', 'Get stronger');
    case 'muscle':
      return tr('Muskeln aufbauen', 'Build muscle');
    default:
      return undefined;
  }
}

export function focusTypesFor(
  area: Area,
): readonly { value: FocusKind; label: string }[] {
  const types = area === 'strength' ? STRENGTH_FOCUS_TYPES : FOCUS_TYPES;
  return types.map(item => ({
    value: item.value,
    label: focusTypeLabel(item.value) ?? item.value,
  }));
}
export function focusLabel(focus?: TrainingFocus | null): string {
  return (
    focus?.label ||
    focusTypeLabel(focus?.kind) ||
    tr('Noch kein Fokus', 'No focus yet')
  );
}
/** A suggestion needs a goal; the user's focus label is never interpreted. */
export function suggestedFocus(
  goal: string,
  area: Area = 'running',
): FocusKind | undefined {
  if (!goal.trim()) return undefined;
  // German and English goal wording both count.
  if (area === 'strength') {
    return /kg|schwer|stärker|kraft|max|heavy|strong|strength|lift/i.test(goal)
      ? 'strength'
      : 'muscle';
  }
  return /unter|schneller|bestzeit|faster|under|personal best|\bpb\b/i.test(goal)
    ? 'speed'
    : 'endurance';
}
