import { findCatalogEntrant, rankCatalog } from '../benchmark/catalog';
import { completedMatchupsFromVotes } from '../benchmark/catalog-api';
import { personalHistoryFromReveals, recomputePersonalCurve, type PersonalCurve, type PersonalHistoryEntry } from '../benchmark/personal-curve';
import { BenchmarkLocalStore } from '../benchmark/storage';
import { selectPersonalCurveCatalog } from './rank';
import type { MatchupVote, RelativeOutcome } from '../benchmark/types';

/** The owner's participant hash prefix, used only by the development-build
 * filter that shows what the leaderboard looks like without his own votes. */
export const OWNER_PARTICIPANT_PREFIX = '8903c1f8';

interface AggregatePair {
  a: string;
  b: string;
  aWins: number;
  bWins: number;
  ties: number;
}

export interface LeaderboardResults {
  curve: PersonalCurve;
  votes: number;
  participants: number;
  latestVoteAt: string | null;
  excludedVotes: number;
}

export interface LeaderboardOptions {
  excludeParticipantPrefix?: string;
  signal?: AbortSignal;
}

/**
 * The community curve, fit from every eligible vote the service has recorded.
 * The API returns level pairs and tallies only; the catalog already on the
 * client turns those into the models, workflows, and costs the chart plots, so
 * the same Bradley-Terry fit runs here as on a participant's own results.
 */
export async function loadLeaderboardResults(options: LeaderboardOptions = {}): Promise<LeaderboardResults> {
  const query = options.excludeParticipantPrefix ? `?exclude=${encodeURIComponent(options.excludeParticipantPrefix)}` : '';
  const response = await fetch(`/api/rank/aggregate${query}`, { signal: options.signal, headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error(`Results request failed with ${response.status}`);
  const body = await response.json() as { ok?: boolean; pairs?: AggregatePair[]; votes?: number; participants?: number; latestVoteAt?: string | null; excludedVotes?: number };
  if (!body.ok || !Array.isArray(body.pairs)) throw new Error('Results response was not usable');

  const history = historyFromPairs(body.pairs);
  return {
    curve: recomputePersonalCurve(history, { catalog: selectPersonalCurveCatalog(rankCatalog, history) }),
    votes: body.votes ?? history.length,
    participants: body.participants ?? 0,
    latestVoteAt: body.latestVoteAt ?? null,
    excludedVotes: body.excludedVotes ?? 0,
  };
}

/** This device's own curve, read straight from local vote history — the same
 * fit the rank page shows, so the two can be put side by side. */
export function personalCurveFromLocalHistory(): PersonalCurve {
  const matchups = completedMatchupsFromVotes(rankCatalog, new BenchmarkLocalStore().snapshot.history);
  const history = personalHistoryFromReveals(matchups.map((item) => item.vote), matchups.map((item) => item.reveal));
  return recomputePersonalCurve(history, { catalog: selectPersonalCurveCatalog(rankCatalog, history) });
}

/** Expand each pair's tally back into one comparison per vote. The fit only
 * reads aggregates, so the expansion is exact rather than a reconstruction. */
function historyFromPairs(pairs: readonly AggregatePair[]): PersonalHistoryEntry[] {
  const history: PersonalHistoryEntry[] = [];
  for (const pair of pairs) {
    const a = historyEntrant(pair.a);
    const b = historyEntrant(pair.b);
    if (!a || !b) continue;
    const push = (relative: RelativeOutcome, count: number) => {
      for (let index = 0; index < count; index += 1) history.push({ vote: aggregateVote(relative), a, b });
    };
    push('a', pair.aWins);
    push('b', pair.bWins);
    push('tie', pair.ties);
  }
  return history;
}

function historyEntrant(levelId: string) {
  const entrant = findCatalogEntrant(rankCatalog, levelId);
  if (!entrant) return null;
  return {
    configurationId: entrant.configurationId,
    modelName: entrant.modelName,
    workflowName: entrant.workflowName,
    generationCost: entrant.generationCost,
  };
}

/** The fit reads `relative` alone; the rest of the vote shape is inert here
 * because aggregated votes carry no matchup identity or timing. */
function aggregateVote(relative: RelativeOutcome): MatchupVote {
  return {
    matchupId: '',
    aEntrantId: '',
    bEntrantId: '',
    verdict: relative === 'a' ? 'a-better' : relative === 'b' ? 'b-better' : 'both-good',
    relative,
    playCounts: { a: 0, b: 0 },
    submittedAt: '',
  };
}
