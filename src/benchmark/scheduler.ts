import type { RankCatalog, RankCatalogEntrant } from './catalog';
import { recomputePersonalCurve, type PersonalHistoryEntry } from './personal-curve.js';
import type { MatchupVote, RelativeOutcome } from './types';

/** Stable id for an unordered pair. Side assignment is deliberately separate. */
export function pairId(themeId: string, levelA: string, levelB: string): string {
  const [first, second] = [levelA, levelB].sort((left, right) => left.localeCompare(right));
  return `${themeId}:${first}__${second}`;
}

export interface SchedulerHistory {
  judged?: readonly { matchupId: string; relative: RelativeOutcome }[];
  levelExposureCounts?: Readonly<Record<string, number>> | ReadonlyMap<string, number>;
  /** Assignment theme ids in chronological order. */
  themeHistory?: readonly string[];
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
  costDifference: number;
}

/** Choose the next anonymous comparison without mutable or wall-clock state. */
export function nextScheduledMatchup(catalog: RankCatalog, participantId: string, history: SchedulerHistory = {}): ScheduledMatchup | null {
  if (!participantId || catalog.themes.length === 0) return null;
  const entrantsByTheme = new Map(catalog.themes.map((theme) => [theme.id, catalog.entrants.filter((entrant) => entrant.themeId === theme.id)]));
  const judged = history.judged ?? [];
  const exposureCounts = exposureMap(catalog, history, judged);
  const pairCounts = countJudgedPairs(catalog, judged);
  const configurationPairCounts = countJudgedConfigurationPairs(catalog, judged);
  const candidates = [...entrantsByTheme.entries()].flatMap(([themeId, entrants]) => pairsForTheme(themeId, entrants, exposureCounts, pairCounts, configurationPairCounts));
  if (candidates.length === 0) return null;

  const lastThemeId = history.themeHistory?.at(-1);
  const hasUnseenLevel = candidates.some((candidate) => candidate.unseenCount > 0);
  const selected = hasUnseenLevel
    ? selectCoveragePhase(catalog, entrantsByTheme, candidates, exposureCounts, judged, lastThemeId)
    : selectPlayoffPhase(catalog, candidates, judged, lastThemeId);
  if (!selected) return null;

  const [levelIdA, levelIdB] = deterministicSideOrder(participantId, selected.id, selected.a.levelId, selected.b.levelId);
  return { themeId: selected.themeId, levelIdA, levelIdB };
}

function selectCoveragePhase(
  catalog: RankCatalog,
  entrantsByTheme: ReadonlyMap<string, readonly RankCatalogEntrant[]>,
  candidates: readonly PairCandidate[],
  exposureCounts: ReadonlyMap<string, number>,
  judged: readonly { matchupId: string; relative: RelativeOutcome }[],
  lastThemeId: string | undefined,
): PairCandidate | null {
  const themeId = selectCoverageTheme(entrantsByTheme, candidates, exposureCounts, lastThemeId);
  if (!themeId) return null;
  const themeCandidates = candidates.filter((candidate) => candidate.themeId === themeId);
  if (!judged.some((item) => parsePairId(item.matchupId)?.themeId === themeId)) {
    const featuredPair = themeCandidates
      .filter((candidate) => candidate.a.featured === true && candidate.b.featured === true)
      .sort((left, right) => left.id.localeCompare(right.id))[0] ?? null;
    if (featuredPair) return featuredPair;
  }
  // Seed each theme with a placed pool before switching to anchored
  // arrivals. Existing placed configurations keep new catalog entries
  // attached to the same component.
  const curve = schedulerCurve(catalog, judged);
  const coldStart = curve.placedCount < catalog.themes.length * 2;
  const bothUnseen = themeCandidates
    .filter((candidate) => candidate.unseenCount === 2)
    .sort((left, right) => left.configurationPairCount - right.configurationPairCount
      || left.costDifference - right.costDifference
      || left.id.localeCompare(right.id))[0] ?? null;
  if (coldStart && bothUnseen) return bothUnseen;

  const placed = new Set(curve.points.filter((point) => point.status !== 'pending').map((point) => point.configurationId));
  const anchored = themeCandidates
    .filter((candidate) => candidate.unseenCount === 1)
    .sort((left, right) => {
      const leftUnseen = (exposureCounts.get(left.a.levelId) ?? 0) === 0 ? left.a : left.b;
      const rightUnseen = (exposureCounts.get(right.a.levelId) ?? 0) === 0 ? right.a : right.b;
      const leftAnchor = leftUnseen === left.a ? left.b : left.a;
      const rightAnchor = rightUnseen === right.a ? right.b : right.a;
      return Number(placed.has(rightAnchor.configurationId)) - Number(placed.has(leftAnchor.configurationId))
        || left.costDifference - right.costDifference
        || left.configurationPairCount - right.configurationPairCount
        || left.id.localeCompare(right.id);
    })[0] ?? null;
  // A fully unseen theme (for example a newly added one) has no seen anchors;
  // pair its levels with each other rather than stalling coverage.
  return anchored ?? bothUnseen;
}

function selectPlayoffPhase(
  catalog: RankCatalog,
  candidates: readonly PairCandidate[],
  judged: readonly { matchupId: string; relative: RelativeOutcome }[],
  lastThemeId: string | undefined,
): PairCandidate | null {
  const themeCounts = new Map<string, number>();
  for (const theme of catalog.themes) themeCounts.set(theme.id, 0);
  for (const item of judged) {
    const parsed = parsePairId(item.matchupId);
    if (parsed && themeCounts.has(parsed.themeId)) themeCounts.set(parsed.themeId, themeCounts.get(parsed.themeId)! + 1);
  }
  const themeIds = [...new Set(candidates.map((candidate) => candidate.themeId))];
  const minimum = Math.min(...themeIds.map((themeId) => themeCounts.get(themeId) ?? 0));
  const themeId = alternateLexicalTheme(themeIds.filter((candidate) => (themeCounts.get(candidate) ?? 0) === minimum), lastThemeId);
  if (!themeId) return null;

  const curve = schedulerCurve(catalog, judged);
  const ratings = new Map(curve.points.flatMap((point) => point.rating === undefined ? [] : [[point.configurationId, point.rating] as const]));
  return candidates
    .filter((candidate) => candidate.themeId === themeId)
    .map((candidate) => ({ candidate, information: playoffInformation(candidate, ratings) }))
    .sort((left, right) => right.information - left.information
      || left.candidate.pairCount - right.candidate.pairCount
      || left.candidate.costDifference - right.candidate.costDifference
      || left.candidate.id.localeCompare(right.candidate.id))[0]?.candidate ?? null;
}

function playoffInformation(candidate: PairCandidate, ratings: ReadonlyMap<string, number>): number {
  const ratingA = ratings.get(candidate.a.configurationId) ?? 1000;
  const ratingB = ratings.get(candidate.b.configurationId) ?? 1000;
  const p = 1 / (1 + Math.pow(10, (ratingB - ratingA) / 400));
  return p * (1 - p) / (1 + candidate.configurationPairCount);
}

function selectCoverageTheme(
  entrantsByTheme: ReadonlyMap<string, readonly RankCatalogEntrant[]>,
  candidates: readonly PairCandidate[],
  exposureCounts: ReadonlyMap<string, number>,
  lastThemeId: string | undefined,
): string | null {
  const available = [...entrantsByTheme.entries()]
    .map(([themeId, entrants]) => ({
      themeId,
      unseen: entrants.filter((entrant) => (exposureCounts.get(entrant.levelId) ?? 0) === 0).length,
      hasCandidate: candidates.some((candidate) => candidate.themeId === themeId),
    }))
    .filter((item) => item.unseen > 0 && item.hasCandidate);
  if (available.length === 0) return null;
  const maximum = Math.max(...available.map((item) => item.unseen));
  return alternateLexicalTheme(available.filter((item) => item.unseen === maximum).map((item) => item.themeId), lastThemeId);
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
      if (a.configurationId === b.configurationId) continue;
      const id = pairId(themeId, a.levelId, b.levelId);
      const configurationPairId = configurationPairIdFor(a.configurationId, b.configurationId);
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
        costDifference: Math.abs(a.generationCost - b.generationCost),
      });
    }
  }
  return candidates;
}

function countJudgedPairs(catalog: RankCatalog, judged: readonly { matchupId: string; relative: RelativeOutcome }[]): Map<string, number> {
  const knownIds = new Set(catalog.entrants.map((entrant) => entrant.levelId));
  const counts = new Map<string, number>();
  for (const item of judged) {
    const parsed = parsePairId(item.matchupId);
    if (!parsed || !knownIds.has(parsed.levelA) || !knownIds.has(parsed.levelB)) continue;
    const canonical = pairId(parsed.themeId, parsed.levelA, parsed.levelB);
    counts.set(canonical, (counts.get(canonical) ?? 0) + 1);
  }
  return counts;
}

function countJudgedConfigurationPairs(catalog: RankCatalog, judged: readonly { matchupId: string; relative: RelativeOutcome }[]): Map<string, number> {
  const entrants = new Map(catalog.entrants.map((entrant) => [entrant.levelId, entrant]));
  const counts = new Map<string, number>();
  for (const item of judged) {
    const parsed = parsePairId(item.matchupId);
    const a = parsed ? entrants.get(parsed.levelA) : undefined;
    const b = parsed ? entrants.get(parsed.levelB) : undefined;
    if (!parsed || !a || !b || a.themeId !== parsed.themeId || b.themeId !== parsed.themeId || a.configurationId === b.configurationId) continue;
    const key = configurationPairIdFor(a.configurationId, b.configurationId);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

function exposureMap(
  catalog: RankCatalog,
  history: SchedulerHistory,
  judged: readonly { matchupId: string; relative: RelativeOutcome }[],
): Map<string, number> {
  const counts = new Map<string, number>();
  const knownIds = new Set(catalog.entrants.map((entrant) => entrant.levelId));
  for (const item of judged) {
    const parsed = parsePairId(item.matchupId);
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

function schedulerCurve(catalog: RankCatalog, judged: readonly { matchupId: string; relative: RelativeOutcome }[]) {
  const entrants = new Map(catalog.entrants.map((entrant) => [entrant.levelId, entrant]));
  const history: PersonalHistoryEntry[] = [];
  for (const item of judged) {
    const parsed = parsePairId(item.matchupId);
    const a = parsed ? entrants.get(parsed.levelA) : undefined;
    const b = parsed ? entrants.get(parsed.levelB) : undefined;
    if (!parsed || !a || !b || a.themeId !== parsed.themeId || b.themeId !== parsed.themeId || a.configurationId === b.configurationId) continue;
    const vote: MatchupVote = {
      matchupId: item.matchupId,
      aEntrantId: a.levelId,
      bEntrantId: b.levelId,
      verdict: item.relative === 'a' ? 'a-better' : item.relative === 'b' ? 'b-better' : 'both-good',
      relative: item.relative,
      playCounts: { a: 1, b: 1 },
      submittedAt: '',
    };
    history.push({
      vote,
      a: { configurationId: a.configurationId, modelName: a.modelName, workflowName: a.workflowName, generationCost: a.generationCost },
      b: { configurationId: b.configurationId, modelName: b.modelName, workflowName: b.workflowName, generationCost: b.generationCost },
    });
  }
  return recomputePersonalCurve(history, { catalog: catalog.entrants });
}

function configurationPairIdFor(configurationA: string, configurationB: string): string {
  const [first, second] = [configurationA, configurationB].sort((left, right) => left.localeCompare(right));
  return `${first}__${second}`;
}

function parsePairId(id: string): { themeId: string; levelA: string; levelB: string } | null {
  const separator = id.indexOf(':');
  const pair = separator >= 0 ? id.slice(separator + 1) : '';
  const divider = pair.indexOf('__');
  if (separator <= 0 || divider <= 0 || divider + 2 >= pair.length) return null;
  return { themeId: id.slice(0, separator), levelA: pair.slice(0, divider), levelB: pair.slice(divider + 2) };
}

function alternateLexicalTheme(themeIds: readonly string[], lastThemeId: string | undefined): string | null {
  const ordered = [...themeIds].sort((left, right) => left.localeCompare(right));
  return ordered.find((themeId) => themeId !== lastThemeId) ?? ordered[0] ?? null;
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
