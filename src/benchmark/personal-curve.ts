import type { MatchupVote, RevealPayload, RelativeOutcome } from './types.ts';

export interface PersonalCurveCatalogEntry {
  configurationId: string;
  modelName: string;
  workflowName: string;
  generationCost: number;
  featured?: boolean;
}

export interface PersonalHistoryEntrant {
  configurationId?: string;
  modelName?: string;
  workflowName?: string;
  generationCost: number;
}

export interface PersonalHistoryEntry {
  vote: MatchupVote;
  a: PersonalHistoryEntrant;
  b: PersonalHistoryEntrant;
}

export type PersonalPointStatus = 'pending' | 'provisional' | 'stable';

export interface PersonalRatingPoint {
  configurationId: string;
  modelName: string;
  workflowName: string;
  label: string;
  rating?: number;
  meanCost: number;
  comparisons: number;
  wins: number;
  ties: number;
  losses: number;
  frontier: boolean;
  status: PersonalPointStatus;
}

export interface PersonalCurve {
  comparisonCount: number;
  points: PersonalRatingPoint[];
  placedCount: number;
  frontierReady: boolean;
}

export interface PersonalRatingOptions {
  catalog?: readonly PersonalCurveCatalogEntry[];
}

export interface BradleyTerryComparison {
  aConfigurationId: string;
  bConfigurationId: string;
  relative: RelativeOutcome;
}

interface PairStats {
  comparisons: number;
  winsA: number;
}

interface RawPointStats {
  wins: number;
  ties: number;
  losses: number;
  comparisons: number;
}

/** Fit regularized Bradley-Terry strengths with a fixed-strength tie anchor. */
export function fitBradleyTerry(
  comparisons: readonly BradleyTerryComparison[],
  configurationIds: readonly string[] = [],
): Map<string, number> {
  const ids = new Set(configurationIds);
  const pairs = new Map<string, PairStats>();
  for (const comparison of comparisons) {
    const a = comparison.aConfigurationId;
    const b = comparison.bConfigurationId;
    if (a === b) continue;
    ids.add(a);
    ids.add(b);
    const [first, second] = orderedPair(a, b);
    const scoreForFirst = a === first ? scoreForA(comparison.relative) : 1 - scoreForA(comparison.relative);
    const key = configurationPairKey(first, second);
    const prior = pairs.get(key) ?? { comparisons: 0, winsA: 0 };
    pairs.set(key, { comparisons: prior.comparisons + 1, winsA: prior.winsA + scoreForFirst });
  }

  const orderedIds = [...ids].sort((left, right) => left.localeCompare(right));
  const strengths = new Map<string, number>(orderedIds.map((id) => [id, 1] as const));
  for (let iteration = 0; iteration < 500; iteration += 1) {
    const next = new Map<string, number>();
    let maxLogChange = 0;
    for (const id of orderedIds) {
      let wins = 0.5;
      let denominator = 1 / (strengths.get(id)! + 1);
      for (const key of [...pairs.keys()].sort((left, right) => left.localeCompare(right))) {
        const pair = pairs.get(key)!;
        const [first, second] = splitConfigurationPairKey(key);
        if (first !== id && second !== id) continue;
        const opponent = first === id ? second : first;
        wins += first === id ? pair.winsA : pair.comparisons - pair.winsA;
        denominator += pair.comparisons / (strengths.get(id)! + strengths.get(opponent)!);
      }
      const updated = wins / denominator;
      next.set(id, updated);
      maxLogChange = Math.max(maxLogChange, Math.abs(Math.log(updated / strengths.get(id)!)));
    }
    for (const id of orderedIds) strengths.set(id, next.get(id)!);
    if (maxLogChange < 1e-10) break;
  }
  return strengths;
}

/** Bradley-Terry probability that the first strength beats the second. */
export function predictedWinProbability(strengthA: number, strengthB: number): number {
  return strengthA / (strengthA + strengthB);
}

/** Recompute the personal curve from raw vote history. History order does not
 * affect the fit: votes are aggregated before the MM iteration. */
export function recomputePersonalCurve(history: readonly PersonalHistoryEntry[], options: PersonalRatingOptions = {}): PersonalCurve {
  const catalog = options.catalog ?? [];
  const catalogCosts = new Map<string, number[]>();
  const catalogLabels = new Map<string, { modelName: string; workflowName: string }>();
  for (const entry of catalog) {
    catalogCosts.set(entry.configurationId, [...(catalogCosts.get(entry.configurationId) ?? []), entry.generationCost]);
    addLabel(catalogLabels, entry.configurationId, { modelName: entry.modelName, workflowName: entry.workflowName });
  }

  const seenIds = new Set<string>();
  const observedCosts = new Map<string, number[]>();
  const labels = new Map<string, { modelName: string; workflowName: string }>();
  const rawStats = new Map<string, RawPointStats>();
  const comparisons: BradleyTerryComparison[] = [];

  for (const entry of history) {
    const aId = configurationIdFor(entry.a);
    const bId = configurationIdFor(entry.b);
    seenIds.add(aId);
    seenIds.add(bId);
    addObservedPoint(aId, entry.a, observedCosts, labels, rawStats);
    addObservedPoint(bId, entry.b, observedCosts, labels, rawStats);
    if (aId === bId) continue;

    comparisons.push({ aConfigurationId: aId, bConfigurationId: bId, relative: entry.vote.relative });
    const aStats = rawStats.get(aId)!;
    const bStats = rawStats.get(bId)!;
    aStats.comparisons += 1;
    bStats.comparisons += 1;
    if (entry.vote.relative === 'a') {
      aStats.wins += 1;
      bStats.losses += 1;
    } else if (entry.vote.relative === 'b') {
      aStats.losses += 1;
      bStats.wins += 1;
    } else {
      aStats.ties += 1;
      bStats.ties += 1;
    }
  }

  const configurationIds = new Set([...seenIds, ...catalogCosts.keys()]);
  const strengths = fitBradleyTerry(comparisons, [...seenIds]);
  const ratings = new Map([...strengths].map(([id, strength]) => [id, ratingForStrength(strength)] as const));
  const featuredIds = new Set(catalog.filter((entry) => entry.featured).map((entry) => entry.configurationId));
  const mainComponent = mainComparisonComponent([...seenIds], comparisons, featuredIds);
  const placedIds = new Set([...seenIds].filter((id) => (rawStats.get(id)?.comparisons ?? 0) >= 2));

  const points = [...configurationIds].map((configurationId): PersonalRatingPoint => {
    const label = catalogLabels.get(configurationId) ?? labels.get(configurationId) ?? displayLabelFor({ generationCost: 0 }, configurationId);
    const costs = catalogCosts.get(configurationId) ?? observedCosts.get(configurationId) ?? [];
    const stats = rawStats.get(configurationId) ?? { wins: 0, ties: 0, losses: 0, comparisons: 0 };
    return {
      configurationId,
      modelName: label.modelName,
      workflowName: label.workflowName,
      label: `${label.modelName} · ${label.workflowName}`,
      ...(seenIds.has(configurationId) ? { rating: ratings.get(configurationId) } : {}),
      meanCost: mean(costs),
      comparisons: stats.comparisons,
      wins: stats.wins,
      ties: stats.ties,
      losses: stats.losses,
      frontier: false,
      status: placedIds.has(configurationId) ? 'stable' : 'pending',
    };
  }).sort((left, right) => left.configurationId.localeCompare(right.configurationId));

  const placedPoints = points.filter((point) => placedIds.has(point.configurationId) && point.rating !== undefined)
    .map((point) => ({ ...point, rating: point.rating! }));
  const frontierIds = new Set(paretoFrontier(placedPoints).map((point) => point.configurationId));
  for (const point of points) {
    point.frontier = placedIds.has(point.configurationId) && frontierIds.has(point.configurationId);
  }

  for (const point of points) {
    if (!placedIds.has(point.configurationId)) continue;
    if (!mainComponent.has(point.configurationId)) {
      point.status = 'provisional';
      continue;
    }
    const blocker = cheaperHighestRatedPoint(point, placedPoints);
    if (!blocker) {
      point.status = 'stable';
      continue;
    }
    const synthetic: BradleyTerryComparison = {
      aConfigurationId: point.configurationId,
      bConfigurationId: blocker.configurationId,
      relative: point.frontier ? 'b' : 'a',
    };
    const syntheticStrengths = fitBradleyTerry([...comparisons, synthetic], [...seenIds]);
    const reratedPlaced = placedPoints.map((placedPoint) => ({
      ...placedPoint,
      rating: ratingForStrength(syntheticStrengths.get(placedPoint.configurationId)!),
    }));
    const syntheticFrontier = new Set(paretoFrontier(reratedPlaced).map((candidate) => candidate.configurationId));
    const membershipChanged = syntheticFrontier.has(point.configurationId) !== point.frontier;
    point.status = membershipChanged ? 'provisional' : 'stable';
  }

  return {
    comparisonCount: history.length,
    points,
    placedCount: placedIds.size,
    frontierReady: placedIds.size >= 2,
  };
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

export function paretoFrontier<T extends { meanCost: number; rating: number }>(points: readonly T[]): T[] {
  return points.filter((point, index) => !points.some((other, otherIndex) => otherIndex !== index
    && other.meanCost <= point.meanCost
    && other.rating >= point.rating
    && (other.meanCost < point.meanCost || other.rating > point.rating)));
}

function addObservedPoint(
  configurationId: string,
  entrant: PersonalHistoryEntrant,
  observedCosts: Map<string, number[]>,
  labels: Map<string, { modelName: string; workflowName: string }>,
  rawStats: Map<string, RawPointStats>,
): void {
  observedCosts.set(configurationId, [...(observedCosts.get(configurationId) ?? []), entrant.generationCost]);
  addLabel(labels, configurationId, displayLabelFor(entrant, configurationId));
  if (!rawStats.has(configurationId)) rawStats.set(configurationId, { wins: 0, ties: 0, losses: 0, comparisons: 0 });
}

function mainComparisonComponent(nodeIds: readonly string[], comparisons: readonly BradleyTerryComparison[], featuredIds: ReadonlySet<string> = new Set()): Set<string> {
  const adjacency = new Map(nodeIds.map((id) => [id, new Set<string>()] as const));
  const edgeCounts = new Map<string, number>();
  for (const comparison of comparisons) {
    const [first, second] = orderedPair(comparison.aConfigurationId, comparison.bConfigurationId);
    adjacency.get(first)?.add(second);
    adjacency.get(second)?.add(first);
    const key = configurationPairKey(first, second);
    edgeCounts.set(key, (edgeCounts.get(key) ?? 0) + 1);
  }

  const unvisited = new Set(nodeIds);
  const components: { ids: string[]; comparisons: number }[] = [];
  while (unvisited.size > 0) {
    const start = [...unvisited].sort((left, right) => left.localeCompare(right))[0];
    const ids: string[] = [];
    const queue = [start];
    unvisited.delete(start);
    while (queue.length > 0) {
      const id = queue.shift()!;
      ids.push(id);
      for (const neighbor of [...(adjacency.get(id) ?? [])].sort((left, right) => left.localeCompare(right))) {
        if (!unvisited.delete(neighbor)) continue;
        queue.push(neighbor);
      }
    }
    const componentIds = new Set(ids);
    const comparisonTotal = [...edgeCounts].reduce((sum, [key, count]) => {
      const [first, second] = splitConfigurationPairKey(key);
      return componentIds.has(first) && componentIds.has(second) ? sum + count : sum;
    }, 0);
    components.push({ ids, comparisons: comparisonTotal });
  }
  components.sort((left, right) => right.comparisons - left.comparisons
    || Number(right.ids.some((id) => featuredIds.has(id))) - Number(left.ids.some((id) => featuredIds.has(id)))
    || left.ids.slice().sort((a, b) => a.localeCompare(b))[0].localeCompare(right.ids.slice().sort((a, b) => a.localeCompare(b))[0]));
  return new Set(components[0]?.ids ?? []);
}

function cheaperHighestRatedPoint(point: PersonalRatingPoint, placedPoints: readonly PersonalRatingPoint[]): PersonalRatingPoint | null {
  return placedPoints
    .filter((candidate) => candidate.configurationId !== point.configurationId && candidate.meanCost < point.meanCost && candidate.rating !== undefined)
    .sort((left, right) => (right.rating! - left.rating!) || left.configurationId.localeCompare(right.configurationId))[0] ?? null;
}

function historyEntrantFromReveal(entrant: RevealPayload['a']): PersonalHistoryEntrant {
  return {
    configurationId: entrant.configurationId ?? `${entrant.modelName}::${entrant.workflowName}`,
    modelName: entrant.modelName,
    workflowName: entrant.workflowName,
    generationCost: entrant.generationCost,
  };
}

function configurationIdFor(entrant: PersonalHistoryEntrant): string {
  return entrant.configurationId ?? `${entrant.modelName ?? 'unknown'}::${entrant.workflowName ?? 'unknown'}`;
}

function displayLabelFor(entrant: PersonalHistoryEntrant, configurationId: string): { modelName: string; workflowName: string } {
  return {
    modelName: entrant.modelName ?? configurationId,
    workflowName: entrant.workflowName ?? configurationId,
  };
}

function addLabel(map: Map<string, { modelName: string; workflowName: string }>, id: string, label: { modelName: string; workflowName: string }): void {
  const prior = map.get(id);
  if (!prior || label.modelName.localeCompare(prior.modelName) < 0 || (label.modelName === prior.modelName && label.workflowName.localeCompare(prior.workflowName) < 0)) {
    map.set(id, label);
  }
}

function ratingForStrength(strength: number): number { return 1000 + 400 * Math.log10(strength); }
function scoreForA(outcome: RelativeOutcome): number { return outcome === 'a' ? 1 : outcome === 'b' ? 0 : 0.5; }
function mean(values: readonly number[]): number {
  const ordered = [...values].sort((left, right) => left - right);
  return ordered.length ? ordered.reduce((sum, value) => sum + value, 0) / ordered.length : 0;
}
function orderedPair(a: string, b: string): [string, string] { return a.localeCompare(b) <= 0 ? [a, b] : [b, a]; }
function configurationPairKey(a: string, b: string): string { return `${a.length}:${a}::${b.length}:${b}`; }
function splitConfigurationPairKey(key: string): [string, string] {
  const firstLengthEnd = key.indexOf(':');
  const firstLength = Number(key.slice(0, firstLengthEnd));
  const firstStart = firstLengthEnd + 1;
  const first = key.slice(firstStart, firstStart + firstLength);
  const secondLengthStart = firstStart + firstLength + 2;
  const secondLengthEnd = key.indexOf(':', secondLengthStart);
  const secondLength = Number(key.slice(secondLengthStart, secondLengthEnd));
  return [first, key.slice(secondLengthEnd + 1, secondLengthEnd + 1 + secondLength)];
}
