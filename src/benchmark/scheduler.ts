import type { RankCatalog, RankCatalogEntrant } from './catalog';

/** Stable id for an unordered pair. Side assignment is deliberately separate. */
export function pairId(themeId: string, levelA: string, levelB: string): string {
  const [first, second] = [levelA, levelB].sort((left, right) => left.localeCompare(right));
  return `${themeId}:${first}__${second}`;
}

export interface SchedulerHistory {
  judgedMatchupIds?: readonly string[];
  levelExposureCounts?: Readonly<Record<string, number>> | ReadonlyMap<string, number>;
  /** Assignment theme ids in chronological order. Older stores may contain
   * each theme only once; the final value is still a useful tie-breaker. */
  themeHistory?: readonly string[];
  /** Compatibility name used by the API request contract. */
  seenThemeIds?: readonly string[];
}

export interface ScheduledMatchup {
  themeId: string;
  levelIdA: string;
  levelIdB: string;
}

interface PairCandidate {
  themeId: string;
  a: RankCatalogEntrant;
  b: RankCatalogEntrant;
  id: string;
  configurationPairId: string;
  pairCount: number;
  configurationPairCount: number;
  unseenCount: number;
}

/**
 * Choose the next anonymous comparison without mutable or wall-clock state.
 * Coverage is intentionally based on catalog entries, so adding a new
 * configuration only adds new candidates to the same algorithm.
 */
export function nextScheduledMatchup(catalog: RankCatalog, participantId: string, history: SchedulerHistory = {}): ScheduledMatchup | null {
  if (!participantId || catalog.themes.length === 0) return null;
  const entrantsByTheme = new Map(catalog.themes.map((theme) => [theme.id, catalog.entrants.filter((entrant) => entrant.themeId === theme.id)]));
  const judgedIds = [...new Set(history.judgedMatchupIds ?? [])];
  const exposureCounts = exposureMap(catalog, history, judgedIds);
  const pairCounts = countJudgedPairs(catalog, judgedIds);
  const configurationPairCounts = countJudgedConfigurationPairs(catalog, judgedIds);
  const lastThemeId = (history.themeHistory ?? history.seenThemeIds)?.at(-1);

  const allCandidates = [...entrantsByTheme.entries()].flatMap(([themeId, entrants]) => pairsForTheme(themeId, entrants, exposureCounts, pairCounts, configurationPairCounts));
  if (allCandidates.length === 0) return null;

  const unseenCandidates = allCandidates.filter((candidate) => candidate.unseenCount === 2);
  const unseenLevels = allCandidates.filter((candidate) => candidate.unseenCount > 0);
  const selected = unseenCandidates.length > 0
    ? selectCoveragePair(unseenCandidates, entrantsByTheme, exposureCounts, lastThemeId)
    : unseenLevels.length > 0
      ? selectPartialCoveragePair(unseenLevels, entrantsByTheme, exposureCounts, lastThemeId)
      : selectRefinementPair(allCandidates, lastThemeId);
  if (!selected) return null;

  const [levelIdA, levelIdB] = deterministicSideOrder(participantId, selected.id, selected.a.levelId, selected.b.levelId);
  return { themeId: selected.themeId, levelIdA, levelIdB };
}

function selectCoveragePair(
  candidates: readonly PairCandidate[],
  entrantsByTheme: ReadonlyMap<string, readonly RankCatalogEntrant[]>,
  exposureCounts: ReadonlyMap<string, number>,
  lastThemeId: string | undefined,
): PairCandidate | null {
  const unseenByTheme = [...entrantsByTheme.keys()].map((themeId) => ({
    themeId,
    count: (entrantsByTheme.get(themeId) ?? []).filter((entrant) => (exposureCounts.get(entrant.levelId) ?? 0) === 0).length,
  }));
  const maximum = Math.max(...unseenByTheme.map((item) => item.count));
  const themes = unseenByTheme.filter((item) => item.count === maximum && item.count >= 2).map((item) => item.themeId);
  const themeId = alternateTheme(themes, lastThemeId);
  if (!themeId) return null;
  return bestCoverageCandidate(candidates.filter((candidate) => candidate.themeId === themeId));
}

function selectPartialCoveragePair(candidates: readonly PairCandidate[], entrantsByTheme: ReadonlyMap<string, readonly RankCatalogEntrant[]>, exposureCounts: ReadonlyMap<string, number>, lastThemeId: string | undefined): PairCandidate | null {
  const unseenByTheme = [...entrantsByTheme.keys()].map((themeId) => ({
    themeId,
    count: (entrantsByTheme.get(themeId) ?? []).filter((entrant) => (exposureCounts.get(entrant.levelId) ?? 0) === 0).length,
  }));
  const maximum = Math.max(...unseenByTheme.map((item) => item.count));
  const themeId = alternateTheme(unseenByTheme.filter((item) => item.count === maximum).map((item) => item.themeId), lastThemeId);
  return themeId ? bestCoverageCandidate(candidates.filter((candidate) => candidate.themeId === themeId)) : null;
}

function selectRefinementPair(candidates: readonly PairCandidate[], lastThemeId: string | undefined): PairCandidate | null {
  const leastPairCount = Math.min(...candidates.map((candidate) => candidate.pairCount));
  const leastPairs = candidates.filter((candidate) => candidate.pairCount === leastPairCount);
  const themeIds = [...new Set(leastPairs.map((candidate) => candidate.themeId))];
  const themeId = alternateTheme(themeIds, lastThemeId);
  if (!themeId) return null;
  return leastPairs.filter((candidate) => candidate.themeId === themeId).sort(compareStable)[0] ?? null;
}

function bestCoverageCandidate(candidates: readonly PairCandidate[]): PairCandidate | null {
  return [...candidates].sort((left, right) => left.configurationPairCount - right.configurationPairCount
    || left.pairCount - right.pairCount
    || compareStable(left, right))[0] ?? null;
}

function pairsForTheme(
  themeId: string,
  entrants: readonly RankCatalogEntrant[],
  exposureCounts: ReadonlyMap<string, number>,
  pairCounts: ReadonlyMap<string, number>,
  configurationPairCounts: ReadonlyMap<string, number>,
): PairCandidate[] {
  const candidates: PairCandidate[] = [];
  for (let i = 0; i < entrants.length; i += 1) {
    for (let j = i + 1; j < entrants.length; j += 1) {
      const a = entrants[i];
      const b = entrants[j];
      const id = pairId(themeId, a.levelId, b.levelId);
      const configurationPairId = configurationPairIdFor(themeId, a.configurationId, b.configurationId);
      const exposureA = exposureCounts.get(a.levelId) ?? 0;
      const exposureB = exposureCounts.get(b.levelId) ?? 0;
      candidates.push({
        themeId,
        a,
        b,
        id,
        configurationPairId,
        pairCount: pairCounts.get(id) ?? 0,
        configurationPairCount: configurationPairCounts.get(configurationPairId) ?? 0,
        unseenCount: Number(exposureA === 0) + Number(exposureB === 0),
      });
    }
  }
  return candidates;
}

function countJudgedPairs(catalog: RankCatalog, judgedIds: readonly string[]): Map<string, number> {
  const knownIds = new Set(catalog.entrants.map((entrant) => entrant.levelId));
  const counts = new Map<string, number>();
  for (const id of judgedIds) {
    const parsed = parsePairId(id);
    if (!parsed || !knownIds.has(parsed.levelA) || !knownIds.has(parsed.levelB)) continue;
    const canonical = pairId(parsed.themeId, parsed.levelA, parsed.levelB);
    counts.set(canonical, (counts.get(canonical) ?? 0) + 1);
  }
  return counts;
}

function countJudgedConfigurationPairs(catalog: RankCatalog, judgedIds: readonly string[]): Map<string, number> {
  const entrants = new Map(catalog.entrants.map((entrant) => [entrant.levelId, entrant]));
  const counts = new Map<string, number>();
  for (const id of judgedIds) {
    const parsed = parsePairId(id);
    const a = parsed ? entrants.get(parsed.levelA) : undefined;
    const b = parsed ? entrants.get(parsed.levelB) : undefined;
    if (!parsed || !a || !b || a.themeId !== parsed.themeId || b.themeId !== parsed.themeId) continue;
    const key = configurationPairIdFor(parsed.themeId, a.configurationId, b.configurationId);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

function exposureMap(catalog: RankCatalog, history: SchedulerHistory, judgedIds: readonly string[]): Map<string, number> {
  const counts = new Map<string, number>();
  const knownIds = new Set(catalog.entrants.map((entrant) => entrant.levelId));
  for (const id of judgedIds) {
    const parsed = parsePairId(id);
    if (!parsed || !knownIds.has(parsed.levelA) || !knownIds.has(parsed.levelB)) continue;
    counts.set(parsed.levelA, (counts.get(parsed.levelA) ?? 0) + 1);
    counts.set(parsed.levelB, (counts.get(parsed.levelB) ?? 0) + 1);
  }
  if (history.levelExposureCounts instanceof Map) {
    for (const [levelId, count] of history.levelExposureCounts) counts.set(levelId, count);
  } else if (history.levelExposureCounts) {
    for (const [levelId, count] of Object.entries(history.levelExposureCounts)) counts.set(levelId, count);
  }
  return counts;
}

function configurationPairIdFor(themeId: string, configurationA: string, configurationB: string): string {
  const [first, second] = [configurationA, configurationB].sort((left, right) => left.localeCompare(right));
  return `${themeId}:${first}__${second}`;
}

function parsePairId(id: string): { themeId: string; levelA: string; levelB: string } | null {
  const separator = id.indexOf(':');
  const pair = separator >= 0 ? id.slice(separator + 1) : '';
  const divider = pair.indexOf('__');
  if (separator <= 0 || divider <= 0 || divider + 2 >= pair.length) return null;
  return { themeId: id.slice(0, separator), levelA: pair.slice(0, divider), levelB: pair.slice(divider + 2) };
}

function alternateTheme(themeIds: readonly string[], lastThemeId: string | undefined): string | null {
  if (themeIds.length === 0) return null;
  return themeIds.find((themeId) => themeId !== lastThemeId) ?? themeIds[0];
}

function compareStable(left: PairCandidate, right: PairCandidate): number {
  return left.id.localeCompare(right.id);
}

function deterministicSideOrder(participantId: string, matchupId: string, levelA: string, levelB: string): [string, string] {
  const hash = hashString(`${participantId}:${matchupId}`);
  return hash % 2 === 0 ? [levelA, levelB] : [levelB, levelA];
}

function hashString(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}
