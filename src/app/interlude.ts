/** One-time Helios intermission offered on the Rank page after enough verdicts.
 * The outcome is stored outside the versioned benchmark envelope because it is
 * presentation state, not voting data (see docs/compat.md). */

export const INTERLUDE_VERDICT_THRESHOLD = 4;
export const INTERLUDE_STORAGE_KEY = 'pareto-rail-helios-interlude';

export type InterludeOutcome = 'played' | 'dismissed';

export function interludeOutcome(): InterludeOutcome | null {
  try {
    const value = localStorage.getItem(INTERLUDE_STORAGE_KEY);
    return value === 'played' || value === 'dismissed' ? value : null;
  } catch {
    return null;
  }
}

export function recordInterludeOutcome(outcome: InterludeOutcome): void {
  try { localStorage.setItem(INTERLUDE_STORAGE_KEY, outcome); } catch { /* private browsing */ }
}
