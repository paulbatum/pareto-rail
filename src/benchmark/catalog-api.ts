import { mapVerdict, type BenchmarkApi, type MatchupAssignment, type MatchupVote, type NextMatchupRequest, type PlayCounts, type RecordPlayRequest, type RevealPayload, type SubmitVoteRequest } from './types';
import { allCatalogEntrants, findCatalogVersionForLevels, activeCatalogVersion, type RankCatalog, type RankCatalogEntrant } from './catalog';
import { nextScheduledMatchup, pairId, parsePairId } from './scheduler';
import { BenchmarkLocalStore, type LevelRun } from './storage';

export interface CompletedMatchup {
  matchupId: string;
  vote: MatchupVote;
  reveal: RevealPayload;
}

/** Rebuild catalog-derived reveal data from the vote log. Current catalog
 * metadata is deliberately used here, so changed thumbnails and other
 * published details are reflected after a reload. */
export function completedMatchupsFromVotes(catalog: RankCatalog, votes: readonly MatchupVote[]): CompletedMatchup[] {
  return votes.flatMap((vote) => {
    const reveal = revealFromVote(catalog, vote);
    return reveal ? [{ matchupId: reveal.matchupId, vote: reveal.vote, reveal }] : [];
  });
}

export function exposureCountsFromVotes(catalog: RankCatalog, votes: readonly MatchupVote[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const completed of completedMatchupsFromVotes(catalog, votes)) {
    for (const levelId of [completed.reveal.a.levelId, completed.reveal.b.levelId]) {
      counts[levelId] = (counts[levelId] ?? 0) + 1;
    }
  }
  return counts;
}

export function assignmentFromVote(catalog: RankCatalog, vote: MatchupVote): MatchupAssignment | null {
  const parsed = parsePairId(vote.matchupId);
  const parsedA = parsed ? findCatalogEntrant(catalog, parsed.levelA) : undefined;
  const parsedB = parsed ? findCatalogEntrant(catalog, parsed.levelB) : undefined;
  const a = findCatalogEntrant(catalog, vote.aEntrantId);
  const b = findCatalogEntrant(catalog, vote.bEntrantId);
  const pairLevels = parsed ? new Set([parsed.levelA, parsed.levelB]) : new Set<string>();
  const sideOrderIsValid = !!a && !!b && a.levelId !== b.levelId && pairLevels.has(a.levelId) && pairLevels.has(b.levelId);
  const version = parsed && parsedA && parsedB ? findCatalogVersionForLevels(catalog, parsedA.levelId, parsedB.levelId) : undefined;
  const theme = version && parsed ? version.themes.find((candidate) => candidate.id === parsed.themeId) : undefined;
  if (!parsed || !parsedA || !parsedB || !a || !b || !sideOrderIsValid || !version || !theme
    || parsedA.themeId !== parsed.themeId || parsedB.themeId !== parsed.themeId) return null;
  return {
    matchupId: vote.matchupId,
    benchmarkVersion: version.benchmarkVersion,
    theme,
    a: { playableRef: a.levelId, ...(a.thumbnailPath ? { thumbnailPath: a.thumbnailPath } : {}) },
    b: { playableRef: b.levelId, ...(b.thumbnailPath ? { thumbnailPath: b.thumbnailPath } : {}) },
    assignedAt: vote.submittedAt,
  };
}

export function revealFromVote(catalog: RankCatalog, vote: MatchupVote): RevealPayload | null {
  const assignment = assignmentFromVote(catalog, vote);
  if (!assignment) return null;
  const a = findCatalogEntrant(catalog, assignment.a.playableRef);
  const b = findCatalogEntrant(catalog, assignment.b.playableRef);
  if (!a || !b) return null;
  return {
    matchupId: assignment.matchupId,
    a: revealFor(a),
    b: revealFor(b),
    vote: voteForCatalog(vote, a, b),
  };
}

/** Browser-local benchmark implementation backed only by the checked-in rank catalog. */
export class CatalogBenchmarkApi implements BenchmarkApi {
  readonly catalog: RankCatalog;
  readonly store: BenchmarkLocalStore;
  private readonly assignments = new Map<string, MatchupAssignment>();
  private readonly playCounts = new Map<string, PlayCounts>();

  constructor(catalog: RankCatalog, store = new BenchmarkLocalStore()) {
    this.catalog = catalog;
    this.store = store;
  }

  async nextMatchup(request: NextMatchupRequest): Promise<MatchupAssignment | null> {
    this.requireParticipant(request.participantId);
    const data = this.store.snapshot;
    const activeVersion = activeCatalogVersion(this.catalog);
    if (!activeVersion) return null;
    const judged = completedMatchupsFromVotes(this.catalog, data.history).map(({ vote }) => ({ matchupId: vote.matchupId, relative: vote.relative, aLevelId: vote.aEntrantId }));
    const scheduled = nextScheduledMatchup(activeVersion, this.store.participantId, { judged });
    if (!scheduled) return null;
    const theme = activeVersion.themes.find((candidate) => candidate.id === scheduled.themeId);
    const a = findCatalogEntrant(this.catalog, scheduled.levelIdA);
    const b = findCatalogEntrant(this.catalog, scheduled.levelIdB);
    if (!theme || !a || !b) return null;
    const assignment: MatchupAssignment = {
      matchupId: pairId(theme.id, a.levelId, b.levelId),
      benchmarkVersion: this.catalog.activeBenchmarkVersion,
      theme,
      a: { playableRef: a.levelId, ...(a.thumbnailPath ? { thumbnailPath: a.thumbnailPath } : {}) },
      b: { playableRef: b.levelId, ...(b.thumbnailPath ? { thumbnailPath: b.thumbnailPath } : {}) },
      assignedAt: new Date().toISOString(),
    };
    this.assignments.set(assignment.matchupId, assignment);
    if (!this.playCounts.has(assignment.matchupId)) this.playCounts.set(assignment.matchupId, playCountsFor(assignment, data.levelRuns));
    return assignment;
  }

  async recordPlay(request: RecordPlayRequest): Promise<PlayCounts> {
    this.requireParticipant(request.participantId);
    const assignment = this.assignmentFor(request.matchupId);
    const counts = { ...(this.playCounts.get(request.matchupId) ?? playCountsFor(assignment, this.store.snapshot.levelRuns)) };
    counts[request.side] += 1;
    this.playCounts.set(request.matchupId, counts);
    return { ...counts };
  }

  async submitVote(request: SubmitVoteRequest): Promise<MatchupVote> {
    this.requireParticipant(request.participantId);
    const assignment = this.assignmentFor(request.matchupId);
    const prior = this.store.snapshot.history.find((vote) => vote.matchupId === request.matchupId);
    if (prior) {
      if (prior.verdict !== request.verdict) throw new Error('A matchup already has a different vote');
      return prior;
    }
    const counts = this.playCounts.get(request.matchupId) ?? playCountsFor(assignment, this.store.snapshot.levelRuns);
    if (counts.a < 1 || counts.b < 1 || request.playCounts.a < 1 || request.playCounts.b < 1) throw new Error('Both entrants must be played before voting');
    const a = findCatalogEntrant(this.catalog, assignment.a.playableRef);
    const b = findCatalogEntrant(this.catalog, assignment.b.playableRef);
    if (!a || !b) throw new Error('Unknown playable reference');
    const mapping = mapVerdict(request.verdict);
    const vote: MatchupVote = {
      matchupId: request.matchupId,
      aEntrantId: a.levelId,
      bEntrantId: b.levelId,
      verdict: request.verdict,
      relative: mapping.relative,
      sentiment: mapping.sentiment,
      playCounts: { ...counts },
      submittedAt: new Date().toISOString(),
    };
    const history = [...this.store.snapshot.history.filter((item) => item.matchupId !== request.matchupId), vote];
    this.store.save({ history });
    return vote;
  }

  async reveal(matchupId: string, participantId = ''): Promise<RevealPayload> {
    if (participantId) this.requireParticipant(participantId);
    const vote = this.store.snapshot.history.find((item) => item.matchupId === matchupId);
    if (!vote) throw new Error('Reveal is available only after a vote');
    const reveal = revealFromVote(this.catalog, vote);
    if (!reveal) throw new Error('Unknown matchup');
    return reveal;
  }

  private assignmentFor(matchupId: string): MatchupAssignment {
    const cached = this.assignments.get(matchupId);
    if (cached) return cached;
    const vote = this.store.snapshot.history.find((item) => item.matchupId === matchupId);
    const assignment = vote ? assignmentFromVote(this.catalog, vote) : null;
    if (!assignment) throw new Error('Unknown matchup');
    this.assignments.set(matchupId, assignment);
    if (!this.playCounts.has(matchupId)) this.playCounts.set(matchupId, playCountsFor(assignment, this.store.snapshot.levelRuns));
    return assignment;
  }

  private requireParticipant(participantId: string): void {
    if (!participantId) throw new Error('Participant is required');
    if (participantId !== this.store.participantId) throw new Error('Participant does not match local benchmark data');
  }
}

export function playCountsFor(assignment: MatchupAssignment, levelRuns: readonly LevelRun[]): PlayCounts {
  const completed = new Set(levelRuns.map((run) => run.levelId));
  return {
    a: completed.has(assignment.a.playableRef) ? 1 : 0,
    b: completed.has(assignment.b.playableRef) ? 1 : 0,
  };
}

function findCatalogEntrant(catalog: RankCatalog, levelId: string): RankCatalogEntrant | undefined {
  return allCatalogEntrants(catalog).find((candidate) => candidate.levelId === levelId);
}

function voteForCatalog(vote: MatchupVote, a: RankCatalogEntrant, b: RankCatalogEntrant): MatchupVote {
  const mapping = mapVerdict(vote.verdict);
  const { sentiment: _storedSentiment, ...withoutSentiment } = vote;
  return {
    ...withoutSentiment,
    aEntrantId: a.levelId,
    bEntrantId: b.levelId,
    relative: mapping.relative,
    ...(mapping.sentiment ? { sentiment: mapping.sentiment } : {}),
  };
}

export function revealFor(entrant: RankCatalogEntrant): RevealPayload['a'] {
  return {
    entrantId: entrant.levelId,
    playableRef: entrant.levelId,
    levelId: entrant.levelId,
    configurationId: entrant.configurationId,
    modelName: entrant.modelName,
    workflowName: entrant.workflowName,
    generationCost: entrant.generationCost,
    ...(entrant.run ? { run: entrant.run } : {}),
    ...(entrant.thumbnailPath ? { thumbnailPath: entrant.thumbnailPath } : {}),
    dataClass: 'eligible',
  };
}
