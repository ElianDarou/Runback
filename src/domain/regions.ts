import { tr } from './i18n';

/**
 * Muscle regions of the muscle model, version `regions-v1`.
 *
 * IDs are stable. A region is never renamed, only added or marked as
 * deprecated. Exercises carry their shares on the base names; the split into
 * sides happens only at calculation time, so one-sided exercises count on the
 * correct side.
 */
export const REGIONS_VERSION = 'regions-v1';

/** Base name of a region, without side. */
export type RegionBase =
  | 'neck'
  | 'trap_upper'
  | 'trap_mid'
  | 'rhomboid'
  | 'lat'
  | 'lower_back'
  | 'shoulder_front'
  | 'shoulder_side'
  | 'shoulder_rear'
  | 'chest_upper'
  | 'chest_mid'
  | 'biceps'
  | 'triceps'
  | 'forearm'
  | 'abs_upper'
  | 'abs_lower'
  | 'oblique'
  | 'hip_flexor'
  | 'glute'
  | 'quad'
  | 'hamstring'
  | 'adductor'
  | 'calf_gastroc'
  | 'calf_soleus'
  | 'tibialis';

export type Side = 'l' | 'r';

/** Concrete region, such as `quad_l` or `neck`. */
export type RegionId = string;

export interface RegionDefinition {
  base: RegionBase;
  /** German name. Use `regionBaseLabel` for the visible name. */
  label: string;
  /** English name. */
  en: string;
  /** Tracked per side; yields two concrete regions. */
  sided: boolean;
  /** Visible from the front or the back. For the body figure. */
  view: 'front' | 'back';
}

export const REGIONS: RegionDefinition[] = [
  { base: 'neck', label: 'Nacken', en: 'Neck', sided: false, view: 'back' },
  { base: 'trap_upper', label: 'Trapez oben', en: 'Upper trapezius', sided: true, view: 'back' },
  { base: 'trap_mid', label: 'Trapez mitte', en: 'Middle trapezius', sided: false, view: 'back' },
  { base: 'rhomboid', label: 'Rautenmuskel', en: 'Rhomboid', sided: false, view: 'back' },
  { base: 'lat', label: 'Latissimus', en: 'Latissimus', sided: true, view: 'back' },
  { base: 'lower_back', label: 'Unterer Rücken', en: 'Lower back', sided: true, view: 'back' },
  { base: 'shoulder_front', label: 'Schulter vorn', en: 'Front shoulder', sided: true, view: 'front' },
  { base: 'shoulder_side', label: 'Schulter seitlich', en: 'Side shoulder', sided: true, view: 'front' },
  { base: 'shoulder_rear', label: 'Schulter hinten', en: 'Rear shoulder', sided: true, view: 'back' },
  { base: 'chest_upper', label: 'Brust oben', en: 'Upper chest', sided: true, view: 'front' },
  { base: 'chest_mid', label: 'Brust mitte', en: 'Middle chest', sided: true, view: 'front' },
  { base: 'biceps', label: 'Bizeps', en: 'Biceps', sided: true, view: 'front' },
  { base: 'triceps', label: 'Trizeps', en: 'Triceps', sided: true, view: 'back' },
  { base: 'forearm', label: 'Unterarm', en: 'Forearm', sided: true, view: 'front' },
  { base: 'abs_upper', label: 'Bauch oben', en: 'Upper abs', sided: false, view: 'front' },
  { base: 'abs_lower', label: 'Bauch unten', en: 'Lower abs', sided: false, view: 'front' },
  { base: 'oblique', label: 'Seitlicher Bauch', en: 'Obliques', sided: true, view: 'front' },
  { base: 'hip_flexor', label: 'Hüftbeuger', en: 'Hip flexor', sided: true, view: 'front' },
  { base: 'glute', label: 'Gesäß', en: 'Glutes', sided: true, view: 'back' },
  { base: 'quad', label: 'Quadrizeps', en: 'Quadriceps', sided: true, view: 'front' },
  { base: 'hamstring', label: 'Ischiocrurale', en: 'Hamstrings', sided: true, view: 'back' },
  { base: 'adductor', label: 'Adduktoren', en: 'Adductors', sided: true, view: 'front' },
  { base: 'calf_gastroc', label: 'Wade (Zwillingsmuskel)', en: 'Calf (gastrocnemius)', sided: true, view: 'back' },
  { base: 'calf_soleus', label: 'Wade (Schollenmuskel)', en: 'Calf (soleus)', sided: true, view: 'back' },
  { base: 'tibialis', label: 'Schienbeinmuskel', en: 'Shin (tibialis)', sided: true, view: 'front' },
];

const byBase = new Map(REGIONS.map(region => [region.base, region]));

export function regionDefinition(base: RegionBase): RegionDefinition {
  const definition = byBase.get(base);
  if (!definition) {
    throw new Error(`Unknown muscle region: ${base}`);
  }
  return definition;
}

/** Concrete ID, such as `quad_l`. Regions without sides ignore the side. */
export function regionId(base: RegionBase, side?: Side): RegionId {
  return regionDefinition(base).sided && side ? `${base}_${side}` : base;
}

/** All concrete regions; sided ones twice. 45 entries in `regions-v1`. */
export function allRegionIds(): RegionId[] {
  return REGIONS.flatMap(region =>
    region.sided ? [`${region.base}_l`, `${region.base}_r`] : [region.base],
  );
}

/** Visible name of a base region in the active language. */
export function regionBaseLabel(base: RegionBase): string {
  const definition = regionDefinition(base);
  return tr(definition.label, definition.en);
}

/** Visible name of a concrete region, with side if it is tracked per side. */
export function regionLabel(id: RegionId): string {
  const [, base, side] = /^(.*?)(?:_(l|r))?$/.exec(id) || [];
  const definition = base ? byBase.get(base as RegionBase) : undefined;
  if (!definition) {
    return id;
  }
  const name = regionBaseLabel(definition.base);
  if (!side) {
    return name;
  }
  return side === 'l'
    ? tr(`${name} links`, `Left ${lowerFirst(name)}`)
    : tr(`${name} rechts`, `Right ${lowerFirst(name)}`);
}

function lowerFirst(text: string): string {
  return text.charAt(0).toLowerCase() + text.slice(1);
}

/**
 * Muscle shares of an exercise. Values are shares across base regions and add
 * up to 1. A missing entry means: not meaningfully involved.
 */
export type MuscleShares = Partial<Record<RegionBase, number>>;

/** Adds up to 1 (± tolerance) and contains only known regions. */
export function sharesAreValid(shares: MuscleShares): boolean {
  const entries = Object.entries(shares) as [RegionBase, number][];
  if (!entries.length) {
    return false;
  }
  if (entries.some(([base, value]) => !byBase.has(base) || !(value > 0))) {
    return false;
  }
  const total = entries.reduce((sum, [, value]) => sum + value, 0);
  return Math.abs(total - 1) < 0.005;
}
