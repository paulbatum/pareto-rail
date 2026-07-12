import {
  recomputePersonalCurve,
  personalHistoryFromReveals,
} from '../benchmark/personal-curve';
import { rankCatalog } from '../benchmark/catalog';
import { ComparisonStateMachine } from '../benchmark/state';
import { BenchmarkLocalStore } from '../benchmark/storage';
import type {
  BenchmarkApi,
  ComparisonState,
  MatchupAssignment,
  MatchupSide,
  VoteVerdict,
} from '../benchmark/types';

export type RankLaunch = { side: MatchupSide; levelId: string };
type Listener = () => void;

/** Participant-facing benchmark controller. It owns workflow state and API
 * calls; React owns the participant-facing rendering. */
export class RankController {
  private readonly store: BenchmarkLocalStore;
  private readonly api: BenchmarkApi | null;
  private readonly resolvePlayable: ((ref: string) => string) | null;
  private readonly listeners = new Set<Listener>();
  private machine: ComparisonStateMachine | null = null;
  private busy = false;

  constructor(options: { api?: BenchmarkApi; store?: BenchmarkLocalStore; resolvePlayable?: (ref: string) => string } = {}) {
    this.store = options.store ?? new BenchmarkLocalStore();
    this.api = options.api ?? null;
    this.resolvePlayable = options.resolvePlayable ?? null;
  }

  get assignment(): MatchupAssignment | null { return this.machine?.state.assignment ?? null; }
  get state(): ComparisonState | null { return this.machine?.state ?? null; }
  get participantId() { return this.store.participantId; }
  get curve() {
    const data = this.store.snapshot;
    return recomputePersonalCurve(personalHistoryFromReveals(data.history, data.completedMatchups.map((item) => item.reveal)), {
      catalog: rankCatalog.entrants,
    });
  }

  subscribe(listener: Listener) {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  async prepare() {
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
    const canStart = side === 'a'
      ? state.kind === 'assignment' || state.kind === 'a-complete' || state.kind === 'ready-to-vote'
      : state.kind === 'a-complete' || state.kind === 'ready-to-vote';
    if (!canStart) return null;
    const next = state.kind === 'assignment' && side === 'a'
      ? this.machine!.startA()
      : state.kind === 'a-complete' && side === 'b'
        ? this.machine!.startB()
        : this.machine!.replay(side);
    this.persist(next);
    this.emit();
    return { side, levelId: this.resolvePlayable(side === 'a' ? next.assignment.a.playableRef : next.assignment.b.playableRef) };
  }

  async completeRun(side: MatchupSide) {
    if (!this.machine || this.busy || !this.api) return;
    const state = this.machine.state;
    if ((state.kind !== 'playing-a' && state.kind !== 'playing-b') || (state.kind === 'playing-a' ? 'a' : 'b') !== side) return;
    this.busy = true;
    try {
      const counts = await this.api.recordPlay({ matchupId: state.assignment.matchupId, side, participantId: this.store.participantId });
      const next = this.machine.completeRun(side);
      this.machine = new ComparisonStateMachine(next.assignment, { ...next, playCounts: counts } as ComparisonState);
      this.persist(this.machine.state);
      this.emit();
    } finally { this.busy = false; }
  }

  async submit(verdict: VoteVerdict) {
    if (!this.machine || !this.api || this.machine.state.kind !== 'ready-to-vote' || this.busy) return;
    this.busy = true;
    try {
      const submitting = this.machine.submit(verdict);
      this.persist(submitting);
      const vote = await this.api.submitVote({ matchupId: submitting.assignment.matchupId, participantId: this.store.participantId, verdict, playCounts: submitting.playCounts });
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
    this.busy = true;
    try {
      const assignment = await this.api.nextMatchup({ participantId: this.store.participantId, judgedMatchupIds: this.store.snapshot.completedMatchups.map((item) => item.matchupId), seenThemeIds: this.store.snapshot.themeHistory });
      if (!assignment) return;
      this.machine = new ComparisonStateMachine(assignment);
      this.persist(this.machine.state);
      this.emit();
    } finally { this.busy = false; }
  }

  private async ensureRound() {
    const unfinished = this.store.snapshot.unfinishedMatchup;
    if (unfinished) {
      let safe = unfinished;
      if (safe.kind === 'playing-a') safe = { kind: 'assignment', assignment: safe.assignment, playCounts: { ...safe.playCounts } };
      if (safe.kind === 'playing-b') safe = { kind: safe.playCounts.a > 0 ? 'a-complete' : 'assignment', assignment: safe.assignment, playCounts: { ...safe.playCounts } } as ComparisonState;
      this.machine = new ComparisonStateMachine(safe.assignment, safe);
      this.store.setUnfinishedMatchup(safe);
      const fixture = this.api as BenchmarkApi & { restoreAssignment?: (assignment: MatchupAssignment, participantId: string, counts: { a: number; b: number }) => void };
      fixture.restoreAssignment?.(safe.assignment, this.store.participantId, safe.playCounts);
      return;
    }
    const assignment = await this.api!.nextMatchup({ participantId: this.store.participantId, judgedMatchupIds: this.store.snapshot.completedMatchups.map((item) => item.matchupId), seenThemeIds: this.store.snapshot.themeHistory });
    if (!assignment) return;
    this.machine = new ComparisonStateMachine(assignment);
    this.persist(this.machine.state);
  }

  private persist(state: ComparisonState) {
    const prior = this.store.snapshot.themeHistory;
    this.store.save({ unfinishedMatchup: state, themeHistory: [...prior, state.assignment.theme.id] });
  }

  private emit() { for (const listener of this.listeners) listener(); }
}
