/**
 * Small shared statistics building blocks without model assumptions: median,
 * sign test, and the exact distribution of Kendall's S for small n.
 * Everything here is deterministic and has no fallback values.
 */
export const INFERENCE_VERSION = 'inference-v1';

export const finite = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

export function median(values: number[]): number {
  const sorted = values.filter(finite).sort((a, b) => a - b);
  if (!sorted.length) {
    throw new Error('The median needs at least one value.');
  }
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

/** Median or null; for displays that may stay empty without a value. */
export function medianOrNull(values: number[]): number | null {
  const usable = values.filter(finite);
  return usable.length ? median(usable) : null;
}

/** Robust spread: 1.4826 · MAD. Without values, 0. */
export function robustScale(values: number[]): number {
  const usable = values.filter(finite);
  if (!usable.length) {
    return 0;
  }
  const center = median(usable);
  return 1.4826 * median(usable.map(value => Math.abs(value - center)));
}

function binomialCoefficient(n: number, k: number): number {
  if (k < 0 || k > n) {
    return 0;
  }
  let result = 1;
  for (let i = 1; i <= k; i += 1) {
    result = (result * (n - k + i)) / i;
  }
  return result;
}

export interface SignTestResult {
  positives: number;
  negatives: number;
  ties: number;
  /** Two-sided exact p-value under p = ½; 1 without observations. */
  pValue: number;
}

/**
 * Exact sign test: ties (within the relevance threshold) do not count. Fixed
 * in advance so results cannot be tuned to fit.
 */
export function signTest(
  changes: number[],
  minimumRelevantChange: number,
): SignTestResult {
  let positives = 0;
  let negatives = 0;
  let ties = 0;
  for (const change of changes) {
    if (!finite(change)) {
      continue;
    }
    if (change >= minimumRelevantChange) {
      positives += 1;
    } else if (change <= -minimumRelevantChange) {
      negatives += 1;
    } else {
      ties += 1;
    }
  }
  const n = positives + negatives;
  if (n === 0) {
    return { positives, negatives, ties, pValue: 1 };
  }
  const extreme = Math.max(positives, negatives);
  let tail = 0;
  for (let k = extreme; k <= n; k += 1) {
    tail += binomialCoefficient(n, k);
  }
  const pValue = Math.min(1, (2 * tail) / 2 ** n);
  return { positives, negatives, ties, pValue };
}

/**
 * Number of permutations of n elements with exactly k inversions (Mahonian
 * numbers). Under "no trend" every order is equally likely; the exact
 * distribution of the negative pairwise slopes follows from this.
 */
export function inversionCounts(n: number): number[] {
  let counts = [1];
  for (let m = 2; m <= n; m += 1) {
    const next = new Array(counts.length + m - 1).fill(0);
    for (let k = 0; k < counts.length; k += 1) {
      for (let j = 0; j < m; j += 1) {
        next[k + j] += counts[k];
      }
    }
    counts = next;
  }
  return counts;
}

/**
 * Largest rank k for which, under "no trend", at most `alpha` of the orders
 * have k or fewer inversions. null if even the perfectly monotone order is
 * more likely than `alpha` — then n carries no directional statement.
 */
export function exactLowerRank(n: number, alpha: number): number | null {
  if (!(n >= 2) || !(alpha > 0)) {
    return null;
  }
  const counts = inversionCounts(n);
  const total = counts.reduce((sum, value) => sum + value, 0);
  let cumulative = 0;
  let rank: number | null = null;
  for (let k = 0; k < counts.length; k += 1) {
    cumulative += counts[k];
    if (cumulative / total <= alpha) {
      rank = k;
    } else {
      break;
    }
  }
  return rank;
}
