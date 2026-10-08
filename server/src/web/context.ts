import type { Store } from '../db';
import type { Dataset } from '../records';
import { relative } from './format';
import type { Translator } from './i18n';

export interface PageContext {
  store: Store;
  data: Dataset;
  now: number;
  url: URL;
  csrf: string;
  tx: Translator;
}

/**
 * Header line: when the phone last transferred everything. Red until a full
 * transfer has happened, or while the last sync was incomplete.
 */
export function syncStatus(
  tx: Translator,
  data: Dataset,
  now: number,
): { label: string; stale: boolean } {
  if (!data.lastCompleteAt) {
    return {
      label: data.lastCommitAt
        ? tx.t('Unvollständig', 'Incomplete')
        : tx.t('Noch keine Daten', 'No data yet'),
      stale: true,
    };
  }
  const incomplete = (data.lastCommitAt ?? 0) > data.lastCompleteAt;
  const when = relative(
    tx,
    incomplete ? data.lastCommitAt! : data.lastCompleteAt,
    now,
  );
  return {
    label: tx.t(`Stand ${when}`, `As of ${when}`),
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
