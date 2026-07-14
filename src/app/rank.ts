import {
  recomputePersonalCurve,
  personalHistoryFromReveals,
  type PersonalHistoryEntry,
} from '../benchmark/personal-curve';
import { activeCatalogVersion, allCatalogEntrants, findCatalogVersionForLevels, rankCatalog, type RankCatalog, type RankCatalogEntrant } from '../benchmark/catalog';
import { ComparisonStateMachine } from '../benchmark/state';
import { BenchmarkLocalStore, type CompletedMatchup } from '../benchmark/storage';
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
  get judgedMatchups(): readonly CompletedMatchup[] { return this.store.snapshot.completedMatchups; }
  get lastUndoneVerdict(): VoteVerdict | null { return this.undoneVerdict; }
  /** Complete local inputs for development-only diagnostics and reproducible exports. */
  get debugSnapshot() { return this.store.snapshot; }
  get curve() {
    const data = this.store.snapshot;
    const history = personalHistoryFromReveals(data.history, data.completedMatchups.map((item) => item.reveal));
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
    this.persist(next);
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
      this.persist(this.machine.state);
      this.emit();
    } finally { this.busy = false; }
  }

  async submit(verdict: VoteVerdict) {
    if (!this.machine || !this.api || this.machine.state.kind !== 'ready-to-vote' || this.busy) return;
    this.undoneVerdict = null;
    this.busy = true;
    try {
      const submitting = this.machine.submit(verdict);
      this.persist(submitting);
      const vote = await this.api.submitVote({ matchupId: submitting.assignment.matchupId, participantId: this.store.participantId, verdict, playCounts: submitting.playCounts });
      this.remoteRecorder.record(remotePayload(submitting.assignment, vote, this.store));
      const reveal = await this.api.reveal(submitting.assignment.matchupId, this.store.participantId);
      const revealed = this.machine.reveal({ ...reveal, vote });
      this.store.completeMatchup({ matchupId: reveal.matchupId, vote, reveal });
      this.machine = new ComparisonStateMachine(revealed.assignment, revealed);
      this.persist(this.machine.state);
      this.emit();
    } catch (error) {
      console.warn('Could not submit benchmark vote', error);
      const current = this.machine?.state;
      if (current?.kind === 'submitting') {
        const ready: ComparisonState = { kind: 'ready-to-vote', assignment: current.assignment, playCounts: { ...current.playCounts } };
        this.machine = new ComparisonStateMachine(ready.assignment, ready);
        this.persist(ready);
        this.emit();
      }
    } finally { this.busy = false; }
  }

  async nextMatchup() {
    if (!this.api || this.busy) return;
    this.undoneVerdict = null;
    this.busy = true;
    try {
      const assignment = await this.api.nextMatchup({ participantId: this.store.participantId, judged: this.store.snapshot.history.map((vote) => ({ matchupId: vote.matchupId, relative: vote.relative })) });
      if (!assignment) return;
      this.machine = this.machineForAssignment(assignment);
      this.persist(this.machine.state);
      this.emit();
    } finally { this.busy = false; }
  }

  /** Development-only correction for the newest completed judgment. */
  undoLastVerdict(): VoteVerdict | null {
    if (!import.meta.env.DEV || this.busy) return null;
    const latest = this.store.snapshot.completedMatchups.at(-1);
    if (!latest) return null;
    const assignment = assignmentFromCompleted(latest);
    if (!assignment) return null;
    const undone = this.store.undoLastVerdict();
    if (!undone) return null;
    const restored: ComparisonState = {
      kind: 'ready-to-vote',
      assignment,
      playCounts: { ...undone.vote.playCounts },
    };
    this.machine = new ComparisonStateMachine(assignment, restored);
    this.store.setUnfinishedMatchup(restored);
    this.undoneVerdict = undone.vote.verdict;
    this.emit();
    return this.undoneVerdict;
  }

  private async ensureRound() {
    const unfinished = this.store.snapshot.unfinishedMatchup;
    if (unfinished) {
      let safe = unfinished;
      if (safe.kind === 'playing-a' || safe.kind === 'playing-b') {
        const kind = safe.playCounts.a > 0 && safe.playCounts.b > 0 ? 'ready-to-vote' : 'assignment';
        safe = { kind, assignment: safe.assignment, playCounts: { ...safe.playCounts } };
      }
      const fixture = this.api as BenchmarkApi & { restoreAssignment?: (assignment: MatchupAssignment, participantId: string, counts: { a: number; b: number }) => void };
      fixture.restoreAssignment?.(safe.assignment, this.store.participantId, safe.playCounts);
      const restored = this.store.snapshot.unfinishedMatchup;
      const initial = restored?.assignment.matchupId === safe.assignment.matchupId ? restored : safe;
      this.machine = new ComparisonStateMachine(safe.assignment, initial);
      this.store.setUnfinishedMatchup(this.machine.state);
      return;
    }
    const assignment = await this.api!.nextMatchup({ participantId: this.store.participantId, judged: this.store.snapshot.history.map((vote) => ({ matchupId: vote.matchupId, relative: vote.relative })) });
    if (!assignment) return;
    this.machine = this.machineForAssignment(assignment);
    this.persist(this.machine.state);
  }

  /** Catalog-backed APIs precompute whether either level has been played in a
   * previous matchup. Preserve that prepared state instead of replacing it
   * with the zero-count initial state. */
  private machineForAssignment(assignment: MatchupAssignment): ComparisonStateMachine {
    const prepared = this.store.snapshot.unfinishedMatchup;
    return new ComparisonStateMachine(
      assignment,
      prepared?.assignment.matchupId === assignment.matchupId ? prepared : undefined,
    );
  }

  private persist(state: ComparisonState) {
    const prior = this.store.snapshot.themeHistory;
    this.store.save({ unfinishedMatchup: state, themeHistory: [...prior, state.assignment.theme.id] });
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

function assignmentFromCompleted(completed: CompletedMatchup): MatchupAssignment | null {
  const separator = completed.matchupId.indexOf(':');
  const themeId = separator > 0 ? completed.matchupId.slice(0, separator) : '';
  const version = findCatalogVersionForLevels(rankCatalog, completed.reveal.a.levelId, completed.reveal.b.levelId);
  const theme = version?.themes.find((candidate) => candidate.id === themeId);
  if (!version || !theme) return null;
  const preVote = (side: MatchupSide) => {
    const entrant = completed.reveal[side];
    return { playableRef: entrant.playableRef, ...(entrant.thumbnailPath ? { thumbnailPath: entrant.thumbnailPath } : {}) };
  };
  return {
    matchupId: completed.matchupId,
    benchmarkVersion: version.benchmarkVersion,
    theme,
    a: preVote('a'),
    b: preVote('b'),
    assignedAt: completed.vote.submittedAt,
  };
}
