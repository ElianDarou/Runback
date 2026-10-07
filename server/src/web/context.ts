import type { Store } from '../db';
import type { Dataset } from '../records';
import { relative } from './format';

export interface PageContext {
  store: Store;
  data: Dataset;
  now: number;
  url: URL;
  csrf: string;
}

/**
 * Kopfzeile: wann das Telefon zuletzt alles übertragen hat. Rot, solange noch
 * nie vollständig übertragen wurde oder der letzte Abgleich unvollständig war.
 */
export function syncStatus(
  data: Dataset,
  now: number,
): { label: string; stale: boolean } {
  if (!data.lastCompleteAt) {
    return {
      label: data.lastCommitAt ? 'Unvollständig' : 'Noch keine Daten',
      stale: true,
    };
  }
  const incomplete = (data.lastCommitAt ?? 0) > data.lastCompleteAt;
  return {
    label: `Stand ${relative(
      incomplete ? data.lastCommitAt! : data.lastCompleteAt,
      now,
    )}`,
    stale: incomplete,
  };
}

export function param(url: URL, name: string): string | null {
  const value = url.searchParams.get(name);
  return value && value.length <= 200 ? value : null;
}

export function oneOf<T extends string>(
  value: string | null,
  options: readonly T[],
  fallback: T,
): T {
  return value && (options as readonly string[]).includes(value)
    ? (value as T)
    : fallback;
}
