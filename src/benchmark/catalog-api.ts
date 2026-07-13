import { initialComparisonState, type ComparisonState } from './types';
import { mapVerdict, type BenchmarkApi, type MatchupAssignment, type MatchupVote, type NextMatchupRequest, type PlayCounts, type RecordPlayRequest, type RevealPayload, type SubmitVoteRequest } from './types';
import type { RankCatalog, RankCatalogEntrant } from './catalog';
import { nextScheduledMatchup, pairId } from './scheduler';
import { BenchmarkLocalStore } from './storage';

/** Browser-local benchmark implementation backed only by the checked-in rank catalog. */
export class CatalogBenchmarkApi implements BenchmarkApi {
  readonly catalog: RankCatalog;
  readonly store: BenchmarkLocalStore;
  private readonly assignments = new Map<string, MatchupAssignment>();

  constructor(catalog: RankCatalog, store = new BenchmarkLocalStore()) {
    this.catalog = catalog;
    this.store = store;
  }

  /** Rehydrate an assignment after the controller restores an unfinished round. */
  restoreAssignment(assignment: MatchupAssignment, _participantId: string, playCounts: PlayCounts = { a: 0, b: 0 }): void {
    this.assignments.set(assignment.matchupId, assignment);
    const current = this.store.snapshot.unfinishedMatchup;
    if (!current || current.assignment.matchupId !== assignment.matchupId) {
      this.store.setUnfinishedMatchup(newState(assignment, playCounts));
    }
  }

  async nextMatchup(request: NextMatchupRequest): Promise<MatchupAssignment | null> {
    this.requireParticipant(request.participantId);
    const data = this.store.snapshot;
    const judgedMatchupIds = data.history.map((vote) => vote.matchupId);
    const scheduled = nextScheduledMatchup(this.catalog, this.store.participantId, {
      judgedMatchupIds: judgedMatchupIds.length > 0 ? judgedMatchupIds : request.judgedMatchupIds,
      levelExposureCounts: data.levelExposureCounts,
      themeHistory: data.themeHistory.length > 0 ? data.themeHistory : request.seenThemeIds,
    });
    if (!scheduled) return null;
    const theme = this.catalog.themes.find((candidate) => candidate.id === scheduled.themeId);
    const a = this.entrant(scheduled.levelIdA);
    const b = this.entrant(scheduled.levelIdB);
    if (!theme || !a || !b) return null;
    const assignment: MatchupAssignment = {
      matchupId: pairId(theme.id, a.levelId, b.levelId),
      benchmarkVersion: 'rank-catalog-v1',
      theme,
      a: { playableRef: a.levelId, ...(a.thumbnailPath ? { thumbnailPath: a.thumbnailPath } : {}) },
      b: { playableRef: b.levelId, ...(b.thumbnailPath ? { thumbnailPath: b.thumbnailPath } : {}) },
      assignedAt: new Date().toISOString(),
    };
    this.assignments.set(assignment.matchupId, assignment);
    this.store.setUnfinishedMatchup(newState(assignment, this.playCountsFor(assignment)));
    return assignment;
  }

  async recordPlay(request: RecordPlayRequest): Promise<PlayCounts> {
    this.requireParticipant(request.participantId);
    const assignment = this.assignmentFor(request.matchupId);
    const current = this.store.snapshot.unfinishedMatchup;
    const counts = current?.assignment.matchupId === request.matchupId ? { ...current.playCounts } : { a: 0, b: 0 };
    counts[request.side] += 1;
    if (current?.assignment.matchupId === request.matchupId) {
      this.store.setUnfinishedMatchup({ ...current, playCounts: counts });
    } else {
      this.store.setUnfinishedMatchup(newState(assignment, counts));
    }
    return counts;
  }

  async submitVote(request: SubmitVoteRequest): Promise<MatchupVote> {
    this.requireParticipant(request.participantId);
    const assignment = this.assignmentFor(request.matchupId);
    const prior = this.store.snapshot.history.find((vote) => vote.matchupId === request.matchupId);
    if (prior) {
      if (prior.verdict !== request.verdict) throw new Error('A matchup already has a different vote');
      return prior;
    }
    const current = this.store.snapshot.unfinishedMatchup;
    const counts = current?.assignment.matchupId === request.matchupId ? current.playCounts : { a: 0, b: 0 };
    if (counts.a < 1 || counts.b < 1 || request.playCounts.a < 1 || request.playCounts.b < 1) throw new Error('Both entrants must be played before voting');
    const a = this.entrant(assignment.a.playableRef);
    const b = this.entrant(assignment.b.playableRef);
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
    const completed = this.store.snapshot.completedMatchups.find((item) => item.matchupId === matchupId);
    if (completed) return completed.reveal;
    const assignment = this.assignmentFor(matchupId);
    const vote = this.store.snapshot.history.find((item) => item.matchupId === matchupId);
    if (!vote) throw new Error('Reveal is available only after a vote');
    const a = this.entrant(assignment.a.playableRef);
    const b = this.entrant(assignment.b.playableRef);
    if (!a || !b) throw new Error('Unknown playable reference');
    const reveal: RevealPayload = { matchupId, a: revealFor(a), b: revealFor(b), vote };
    this.store.completeMatchup({ matchupId, vote, reveal });
    return reveal;
  }

  private assignmentFor(matchupId: string): MatchupAssignment {
    const cached = this.assignments.get(matchupId);
    if (cached) return cached;
    const unfinished = this.store.snapshot.unfinishedMatchup;
    if (unfinished?.assignment.matchupId === matchupId) {
      this.assignments.set(matchupId, unfinished.assignment);
      return unfinished.assignment;
    }
    const completed = this.store.snapshot.completedMatchups.find((item) => item.matchupId === matchupId);
    const parsed = parseMatchupId(matchupId);
    const theme = parsed ? this.catalog.themes.find((candidate) => candidate.id === parsed.themeId) : undefined;
    if (!completed || !parsed || !theme) throw new Error('Unknown matchup');
    const assignment: MatchupAssignment = {
      matchupId,
      benchmarkVersion: 'rank-catalog-v1',
      theme,
      a: { playableRef: completed.reveal.a.playableRef, ...(completed.reveal.a.thumbnailPath ? { thumbnailPath: completed.reveal.a.thumbnailPath } : {}) },
      b: { playableRef: completed.reveal.b.playableRef, ...(completed.reveal.b.thumbnailPath ? { thumbnailPath: completed.reveal.b.thumbnailPath } : {}) },
      assignedAt: completed.vote.submittedAt,
    };
    this.assignments.set(matchupId, assignment);
    return assignment;
  }

  private playCountsFor(assignment: MatchupAssignment): PlayCounts {
    const completed = new Set(this.store.snapshot.levelRuns.map((run) => run.levelId));
    return {
      a: completed.has(assignment.a.playableRef) ? 1 : 0,
      b: completed.has(assignment.b.playableRef) ? 1 : 0,
    };
  }

  private entrant(levelId: string): RankCatalogEntrant | undefined {
    return this.catalog.entrants.find((candidate) => candidate.levelId === levelId);
  }

  private requireParticipant(participantId: string): void {
    if (!participantId) throw new Error('Participant is required');
    if (participantId !== this.store.participantId) throw new Error('Participant does not match local benchmark data');
  }
}

function newState(assignment: MatchupAssignment, playCounts: PlayCounts): ComparisonState {
  const counts = { ...playCounts };
  return counts.a > 0 && counts.b > 0
    ? { kind: 'ready-to-vote', assignment, playCounts: counts }
    : { kind: 'assignment', assignment, playCounts: counts };
}

function revealFor(entrant: RankCatalogEntrant): RevealPayload['a'] {
  return {
    entrantId: entrant.levelId,
    playableRef: entrant.levelId,
    levelId: entrant.levelId,
    configurationId: entrant.configurationId,
    modelName: entrant.modelName,
    workflowName: entrant.workflowName,
    generationCost: entrant.generationCost,
    ...(entrant.thumbnailPath ? { thumbnailPath: entrant.thumbnailPath } : {}),
    dataClass: 'eligible',
  };
}

function parseMatchupId(matchupId: string): { themeId: string; levelA: string; levelB: string } | null {
  const separator = matchupId.indexOf(':');
  const pair = separator >= 0 ? matchupId.slice(separator + 1) : '';
  const divider = pair.indexOf('__');
  if (separator <= 0 || divider <= 0 || divider + 2 >= pair.length) return null;
  return { themeId: matchupId.slice(0, separator), levelA: pair.slice(0, divider), levelB: pair.slice(divider + 2) };
}
