import type { MatchupVote, RevealPayload, RelativeOutcome } from './types.ts';

export interface PersonalHistoryEntry {
  vote: MatchupVote;
  a: { entrantId: string; generationCost: number };
  b: { entrantId: string; generationCost: number };
}

export interface PersonalRatingPoint {
  entrantId: string;
  rating: number;
  meanCost: number;
  comparisons: number;
  frontier: boolean;
}

export interface PersonalCurve {
  comparisonCount: number;
  unlocked: boolean;
  points: PersonalRatingPoint[];
}

export interface PersonalRatingOptions {
  initialRating?: number;
  kFactor?: number;
}

/** Deterministic online Elo-style display layer. Raw entries are consumed in
 * submission order; callers can always recompute when the display algorithm
 * changes. Ties carry sentiment elsewhere and remain 0.5 relative scores. */
export function recomputePersonalCurve(history: readonly PersonalHistoryEntry[], options: PersonalRatingOptions = {}): PersonalCurve {
  const initial = options.initialRating ?? 1000;
  const k = options.kFactor ?? 32;
  const ratings = new Map<string, number>();
  const costs = new Map<string, number[]>();
  const comparisons = new Map<string, number>();
  const rating = (id: string) => ratings.get(id) ?? initial;
  for (const entry of history) {
    const aRating = rating(entry.a.entrantId);
    const bRating = rating(entry.b.entrantId);
    const expectedA = 1 / (1 + Math.pow(10, (bRating - aRating) / 400));
    const scoreA = scoreForA(entry.vote.relative);
    ratings.set(entry.a.entrantId, aRating + k * (scoreA - expectedA));
    ratings.set(entry.b.entrantId, bRating + k * ((1 - scoreA) - (1 - expectedA)));
    costs.set(entry.a.entrantId, [...(costs.get(entry.a.entrantId) ?? []), entry.a.generationCost]);
    costs.set(entry.b.entrantId, [...(costs.get(entry.b.entrantId) ?? []), entry.b.generationCost]);
    comparisons.set(entry.a.entrantId, (comparisons.get(entry.a.entrantId) ?? 0) + 1);
    comparisons.set(entry.b.entrantId, (comparisons.get(entry.b.entrantId) ?? 0) + 1);
  }
  const points = [...ratings.keys()].map((entrantId) => ({
    entrantId,
    rating: ratings.get(entrantId) ?? initial,
    meanCost: mean(costs.get(entrantId) ?? []),
    comparisons: comparisons.get(entrantId) ?? 0,
    frontier: false,
  })).sort((left, right) => left.entrantId.localeCompare(right.entrantId));
  const frontierIds = new Set(paretoFrontier(points).map((point) => point.entrantId));
  for (const point of points) point.frontier = frontierIds.has(point.entrantId);
  return { comparisonCount: history.length, unlocked: history.length >= 3, points };
}

export function personalHistoryFromReveals(votes: readonly MatchupVote[], reveals: readonly RevealPayload[]): PersonalHistoryEntry[] {
  const byMatchup = new Map(reveals.map((reveal) => [reveal.matchupId, reveal]));
  return votes.flatMap((vote) => {
    const reveal = byMatchup.get(vote.matchupId);
    return reveal ? [{ vote, a: { entrantId: reveal.a.entrantId, generationCost: reveal.a.generationCost }, b: { entrantId: reveal.b.entrantId, generationCost: reveal.b.generationCost } }] : [];
  });
}

export function paretoFrontier(points: readonly Pick<PersonalRatingPoint, 'entrantId' | 'meanCost' | 'rating'>[]): Pick<PersonalRatingPoint, 'entrantId' | 'meanCost' | 'rating'>[] {
  return points.filter((point, index) => !points.some((other, otherIndex) => otherIndex !== index && other.meanCost <= point.meanCost && other.rating >= point.rating && (other.meanCost < point.meanCost || other.rating > point.rating)));
}

/** Naming aliases for UI callers that prefer the two operations separately. */
export const recomputePersonalRatings = recomputePersonalCurve;
export const calculateParetoFrontier = paretoFrontier;

function scoreForA(outcome: RelativeOutcome): number { return outcome === 'a' ? 1 : outcome === 'b' ? 0 : 0.5; }
function mean(values: readonly number[]): number { return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0; }
