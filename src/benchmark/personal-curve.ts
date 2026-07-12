import type { MatchupVote, RevealPayload, RelativeOutcome } from './types.ts';

export interface PersonalCurveCatalogEntry {
  configurationId: string;
  modelName: string;
  workflowName: string;
  generationCost: number;
}

export interface PersonalHistoryEntrant {
  /** Stable configuration identity; entrantId is retained for old local data. */
  configurationId?: string;
  entrantId?: string;
  modelName?: string;
  workflowName?: string;
  generationCost: number;
}

export interface PersonalHistoryEntry {
  vote: MatchupVote;
  a: PersonalHistoryEntrant;
  b: PersonalHistoryEntrant;
}

export interface PersonalRatingPoint {
  configurationId: string;
  /** Backward-compatible alias; it now contains the configuration id. */
  entrantId: string;
  modelName: string;
  workflowName: string;
  label: string;
  rating: number;
  meanCost: number;
  comparisons: number;
  frontier: boolean;
}

export interface PersonalCurve {
  comparisonCount: number;
  unlocked: boolean;
  /** True once every catalog configuration has appeared in two comparisons. */
  isFull: boolean;
  earlyEstimate: boolean;
  points: PersonalRatingPoint[];
}

export interface PersonalRatingOptions {
  initialRating?: number;
  kFactor?: number;
  catalog?: readonly PersonalCurveCatalogEntry[];
}

/** Deterministic online Elo-style display layer aggregated by configuration.
 * Raw entries are consumed in submission order; callers can always recompute
 * when the display algorithm changes. Ties carry sentiment elsewhere and
 * remain 0.5 relative scores. */
export function recomputePersonalCurve(history: readonly PersonalHistoryEntry[], options: PersonalRatingOptions = {}): PersonalCurve {
  const initial = options.initialRating ?? 1000;
  const k = options.kFactor ?? 32;
  const ratings = new Map<string, number>();
  const observedCosts = new Map<string, number[]>();
  const comparisons = new Map<string, number>();
  const labels = new Map<string, { modelName: string; workflowName: string }>();
  const catalogCosts = new Map<string, number[]>();
  const catalogLabels = new Map<string, { modelName: string; workflowName: string }>();

  for (const entry of options.catalog ?? []) {
    catalogCosts.set(entry.configurationId, [...(catalogCosts.get(entry.configurationId) ?? []), entry.generationCost]);
    catalogLabels.set(entry.configurationId, { modelName: entry.modelName, workflowName: entry.workflowName });
  }

  const rating = (id: string) => ratings.get(id) ?? initial;
  for (const entry of history) {
    const aId = configurationIdFor(entry.a);
    const bId = configurationIdFor(entry.b);
    const aRating = rating(aId);
    const bRating = rating(bId);
    const expectedA = 1 / (1 + Math.pow(10, (bRating - aRating) / 400));
    const scoreA = scoreForA(entry.vote.relative);
    ratings.set(aId, aRating + k * (scoreA - expectedA));
    ratings.set(bId, bRating + k * ((1 - scoreA) - (1 - expectedA)));
    observedCosts.set(aId, [...(observedCosts.get(aId) ?? []), entry.a.generationCost]);
    observedCosts.set(bId, [...(observedCosts.get(bId) ?? []), entry.b.generationCost]);
    comparisons.set(aId, (comparisons.get(aId) ?? 0) + 1);
    comparisons.set(bId, (comparisons.get(bId) ?? 0) + 1);
    if (!labels.has(aId)) labels.set(aId, displayLabelFor(entry.a, aId));
    if (!labels.has(bId)) labels.set(bId, displayLabelFor(entry.b, bId));
  }

  const points = [...ratings.keys()].map((configurationId) => {
    const label = catalogLabels.get(configurationId) ?? labels.get(configurationId) ?? displayLabelFor({ generationCost: 0 }, configurationId);
    const costs = catalogCosts.get(configurationId) ?? observedCosts.get(configurationId) ?? [];
    return {
      configurationId,
      entrantId: configurationId,
      modelName: label.modelName,
      workflowName: label.workflowName,
      label: `${label.modelName} · ${label.workflowName}`,
      rating: ratings.get(configurationId) ?? initial,
      meanCost: mean(costs),
      comparisons: comparisons.get(configurationId) ?? 0,
      frontier: false,
    };
  }).sort((left, right) => left.configurationId.localeCompare(right.configurationId));
  const frontierIds = new Set(paretoFrontier(points).map((point) => point.configurationId ?? point.entrantId));
  for (const point of points) point.frontier = frontierIds.has(point.configurationId);

  const catalogConfigurationIds = [...catalogCosts.keys()];
  const configurations = catalogConfigurationIds.length > 0 ? catalogConfigurationIds : [...comparisons.keys()];
  const isFull = configurations.length > 0 && configurations.every((configurationId) => (comparisons.get(configurationId) ?? 0) >= 2);
  return { comparisonCount: history.length, unlocked: history.length >= 4, isFull, earlyEstimate: !isFull, points };
}

export function personalHistoryFromReveals(votes: readonly MatchupVote[], reveals: readonly RevealPayload[]): PersonalHistoryEntry[] {
  const byMatchup = new Map(reveals.map((reveal) => [reveal.matchupId, reveal]));
  return votes.flatMap((vote) => {
    const reveal = byMatchup.get(vote.matchupId);
    return reveal ? [{
      vote,
      a: historyEntrantFromReveal(reveal.a),
      b: historyEntrantFromReveal(reveal.b),
    }] : [];
  });
}

export function paretoFrontier<T extends { meanCost: number; rating: number; configurationId?: string; entrantId?: string }>(points: readonly T[]): T[] {
  return points.filter((point, index) => !points.some((other, otherIndex) => otherIndex !== index && other.meanCost <= point.meanCost && other.rating >= point.rating && (other.meanCost < point.meanCost || other.rating > point.rating)));
}

/** Naming aliases for UI callers that prefer the two operations separately. */
export const recomputePersonalRatings = recomputePersonalCurve;
export const calculateParetoFrontier = paretoFrontier;

function historyEntrantFromReveal(entrant: RevealPayload['a']): PersonalHistoryEntrant {
  return {
    configurationId: entrant.configurationId ?? `${entrant.modelName}::${entrant.workflowName}`,
    entrantId: entrant.entrantId,
    modelName: entrant.modelName,
    workflowName: entrant.workflowName,
    generationCost: entrant.generationCost,
  };
}

function configurationIdFor(entrant: PersonalHistoryEntrant): string {
  return entrant.configurationId ?? entrant.entrantId ?? `${entrant.modelName ?? 'unknown'}::${entrant.workflowName ?? 'unknown'}`;
}

function displayLabelFor(entrant: PersonalHistoryEntrant, configurationId: string): { modelName: string; workflowName: string } {
  return {
    modelName: entrant.modelName ?? configurationId,
    workflowName: entrant.workflowName ?? configurationId,
  };
}

function scoreForA(outcome: RelativeOutcome): number { return outcome === 'a' ? 1 : outcome === 'b' ? 0 : 0.5; }
function mean(values: readonly number[]): number { return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0; }
