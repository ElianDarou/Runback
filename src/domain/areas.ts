import type { Area } from './types';
import { tr } from './i18n';

/** Running and strength training are separate areas, each with its own goal. */
export const AREAS: readonly Area[] = ['running', 'strength'];
/** Visible name of an area in the active language. */
export function areaLabel(area: Area): string {
  return area === 'strength'
    ? tr('Krafttraining', 'Strength training')
    : tr('Laufen', 'Running');
}
