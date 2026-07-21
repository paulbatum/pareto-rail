import {
  recomputePersonalCurve,
  personalHistoryFromReveals,
  type PersonalHistoryEntry,
} from '../benchmark/personal-curve';
import { activeCatalogVersion, allCatalogEntrants, rankCatalog, type RankCatalog, type RankCatalogEntrant } from '../benchmark/catalog';
import { assignmentFromVote, completedMatchupsFromVotes, exposureCountsFromVotes, playCountsFor, type CompletedMatchup } from '../benchmark/catalog-api';
import { ComparisonStateMachine } from '../benchmark/state';
import { BenchmarkLocalStore } from '../benchmark/storage';
import { RemoteVoteRecorder, type RemoteVotePayload } from '../benchmark/remote-recorder';
import type {
  BenchmarkApi,
  ComparisonState,
  MatchupAssignment,
  MatchupSide,
  MatchupVote,
  VoteVerdict,
} from '../benchmark/types';

export type RankLaunch = { side: MatchupSide; levelId: string };
type Listener = () => void;

export function selectPersonalCurveCatalog(catalog: RankCatalog, history: readonly PersonalHistoryEntry[]): readonly RankCatalogEntrant[] {
  const configurationIds = new Set(activeCatalogVersion(catalog)?.entrants.map((entrant) => entrant.configurationId));
  for (const entry of history) {
    if (entry.a.configurationId) configurationIds.add(entry.a.configurationId);
    if (entry.b.configurationId) configurationIds.add(entry.b.configurationId);
  }
  return allCatalogEntrants(catalog).filter((entrant) => configurationIds.has(entrant.configurationId));
}

/** Participant-facing benchmark controller. It owns workflow state and API
 * calls; React owns the participant-facing rendering. */
export class RankController {
  private readonly store: BenchmarkLocalStore;
  private readonly api: BenchmarkApi | null;
  private readonly resolvePlayable: ((ref: string) => string) | null;
  private readonly remoteRecorder: RemoteVoteRecorder;
  private readonly listeners = new Set<Listener>();
  private machine: ComparisonStateMachine | null = null;
  private busy = false;
  private undoneVerdict: VoteVerdict | null = null;

  constructor(options: { api?: BenchmarkApi; store?: BenchmarkLocalStore; resolvePlayable?: (ref: string) => string; remoteRecorder?: RemoteVoteRecorder } = {}) {
    this.store = options.store ?? new BenchmarkLocalStore();
    this.api = options.api ?? null;
    this.resolvePlayable = options.resolvePlayable ?? null;
    this.remoteRecorder = options.remoteRecorder ?? new RemoteVoteRecorder();
  }

  get assignment(): MatchupAssignment | null { return this.machine?.state.assignment ?? null; }
  get state(): ComparisonState | null { return this.machine?.state ?? null; }
  get participantId() { return this.store.participantId; }
  get judgedMatchups(): readonly CompletedMatchup[] { return completedMatchupsFromVotes(rankCatalog, this.store.snapshot.history); }
  get levelExposureCounts(): Readonly<Record<string, number>> { return exposureCountsFromVotes(rankCatalog, this.store.snapshot.history); }
  get lastUndoneVerdict(): VoteVerdict | null { return this.undoneVerdict; }
  /** Complete local inputs for development-only diagnostics and reproducible exports. */
  get debugSnapshot() { return this.store.snapshot; }
  get curve() {
    const matchups = this.judgedMatchups;
    const history = personalHistoryFromReveals(matchups.map((item) => item.vote), matchups.map((item) => item.reveal));
    return recomputePersonalCurve(history, { catalog: selectPersonalCurveCatalog(rankCatalog, history) });
  }

  subscribe(listener: Listener) {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  async prepare() {
    this.remoteRecorder.retryPending();
    if (!this.api) return;
    await this.ensureRound();
    this.emit();
  }

  launch(side: MatchupSide): RankLaunch | null {
    const state = this.machine?.state;
    if (!state || this.busy || !this.resolvePlayable) return null;
    const alreadyPlaying = (state.kind === 'playing-a' && side === 'a') || (state.kind === 'playing-b' && side === 'b');
    if (alreadyPlaying) {
      const ref = side === 'a' ? state.assignment.a.playableRef : state.assignment.b.playableRef;
      return { side, levelId: this.resolvePlayable(ref) };
    }
    const canStart = state.kind === 'assignment' || state.kind === 'ready-to-vote';
    if (!canStart) return null;
    const next = state.kind === 'ready-to-vote'
      ? this.machine!.replay(side)
      : this.machine!.start(side);
    this.emit();
    return { side, levelId: this.resolvePlayable(side === 'a' ? next.assignment.a.playableRef : next.assignment.b.playableRef) };
  }

  levelRun(levelId: string) {
    return this.store.snapshot.levelRuns.find((run) => run.levelId === levelId);
  }

  async completeRun(side: MatchupSide, score: number) {
    if (!this.machine || this.busy || !this.api) return;
    const state = this.machine.state;
    if ((state.kind !== 'playing-a' && state.kind !== 'playing-b') || (state.kind === 'playing-a' ? 'a' : 'b') !== side) return;
    this.busy = true;
    try {
      const levelId = side === 'a' ? state.assignment.a.playableRef : state.assignment.b.playableRef;
      this.store.recordLevelRun(levelId, score);
      const counts = await this.api.recordPlay({ matchupId: state.assignment.matchupId, side, participantId: this.store.participantId });
      const next = this.machine.completeRun(side);
      this.machine = new ComparisonStateMachine(next.assignment, { ...next, playCounts: counts } as ComparisonState);
      this.emit();
    } finally { this.busy = false; }
  }

  async submit(verdict: VoteVerdict) {
    if (!this.machine || !this.api || this.machine.state.kind !== 'ready-to-vote' || this.busy) return;
    this.undoneVerdict = null;
    this.busy = true;
    try {
      const submitting = this.machine.submit(verdict);
      const vote = await this.api.submitVote({ matchupId: submitting.assignment.matchupId, participantId: this.store.participantId, verdict, playCounts: submitting.playCounts });
      this.remoteRecorder.record(remotePayload(submitting.assignment, vote, this.store));
      const reveal = await this.api.reveal(submitting.assignment.matchupId, this.store.participantId);
      const revealed = this.machine.reveal({ ...reveal, vote });
      this.machine = new ComparisonStateMachine(revealed.assignment, revealed);
      this.emit();
    } catch (error) {
      console.warn('Could not submit benchmark vote', error);
      const current = this.machine?.state;
      if (current?.kind === 'submitting') {
        const ready: ComparisonState = { kind: 'ready-to-vote', assignment: current.assignment, playCounts: { ...current.playCounts } };
        this.machine = new ComparisonStateMachine(ready.assignment, ready);
        this.emit();
      }
    } finally { this.busy = false; }
  }

  async nextMatchup() {
    if (!this.api || this.busy) return;
    this.undoneVerdict = null;
    this.busy = true;
    try {
      const assignment = await this.api.nextMatchup({ participantId: this.store.participantId, judged: this.judgedForScheduler() });
      // A null assignment means every available pair has been judged; clearing
      // the machine lets the page show the completed state instead of the last reveal.
      this.machine = assignment ? this.machineForAssignment(assignment) : null;
      this.emit();
    } finally { this.busy = false; }
  }

  /** Development-only correction for the newest completed judgment. */
  undoLastVerdict(): VoteVerdict | null {
    if (!import.meta.env.DEV || this.busy) return null;
    const latest = this.judgedMatchups.at(-1);
    if (!latest) return null;
    const assignment = assignmentFromVote(rankCatalog, latest.vote);
    if (!assignment) return null;
    const undone = this.store.undoLastVerdict();
    if (!undone) return null;
    const restored: ComparisonState = {
      kind: 'ready-to-vote',
      assignment,
      playCounts: { ...undone.playCounts },
    };
    this.machine = new ComparisonStateMachine(assignment, restored);
    this.undoneVerdict = undone.verdict;
    this.emit();
    return this.undoneVerdict;
  }

  private async ensureRound() {
    const assignment = await this.api!.nextMatchup({ participantId: this.store.participantId, judged: this.judgedForScheduler() });
    if (!assignment) return;
    this.machine = this.machineForAssignment(assignment);
  }

  private judgedForScheduler() {
    return this.store.snapshot.history.map((vote) => ({ matchupId: vote.matchupId, relative: vote.relative, aLevelId: vote.aEntrantId }));
  }

  private machineForAssignment(assignment: MatchupAssignment): ComparisonStateMachine {
    const existing = this.machine?.state;
    if (existing?.assignment.matchupId === assignment.matchupId && (existing.kind === 'assignment' || existing.kind === 'ready-to-vote')) {
      return new ComparisonStateMachine(assignment, existing);
    }
    const counts = playCountsFor(assignment, this.store.snapshot.levelRuns);
    const initial: ComparisonState = counts.a > 0 && counts.b > 0
      ? { kind: 'ready-to-vote', assignment, playCounts: counts }
      : { kind: 'assignment', assignment, playCounts: counts };
    return new ComparisonStateMachine(assignment, initial);
  }

  private emit() { for (const listener of this.listeners) listener(); }
}

function remotePayload(assignment: MatchupAssignment, vote: MatchupVote, store: BenchmarkLocalStore): RemoteVotePayload {
  const snapshot = store.snapshot;
  const scoreFor = (levelId: string): number | undefined => snapshot.levelRuns.find((run) => run.levelId === levelId)?.score;
  const bestScoreA = scoreFor(assignment.a.playableRef);
  const bestScoreB = scoreFor(assignment.b.playableRef);
  return {
    matchupId: assignment.matchupId,
    participantId: store.participantId,
    benchmarkVersion: assignment.benchmarkVersion,
    themeId: assignment.theme.id,
    aLevelId: assignment.a.playableRef,
    bLevelId: assignment.b.playableRef,
    verdict: vote.verdict,
    playCounts: { ...vote.playCounts },
    ...(bestScoreA !== undefined || bestScoreB !== undefined ? { bestScores: { ...(bestScoreA === undefined ? {} : { a: bestScoreA }), ...(bestScoreB === undefined ? {} : { b: bestScoreB }) } } : {}),
    assignedAt: assignment.assignedAt,
    clientSubmittedAt: vote.submittedAt,
    idempotencyKey: `${assignment.matchupId}:${store.participantId}`,
  };
}
