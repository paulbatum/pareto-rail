import {
  type ComparisonState,
  type MatchupSide,
  type MatchupVote,
  type RevealPayload,
  type VoteVerdict,
  initialComparisonState,
} from './types';

export type ComparisonEvent =
  | { type: 'start-a' }
  | { type: 'start-b' }
  | { type: 'run-end'; side: MatchupSide }
  | { type: 'replay'; side: MatchupSide }
  | { type: 'submit'; verdict: VoteVerdict }
  | { type: 'revealed'; payload: RevealPayload };

const copyCounts = (state: ComparisonState) => ({ ...state.playCounts });

/** Pure transition function. Invalid actions are rejected instead of silently
 * changing the round, which is important when a page resumes after refresh. */
export function reduceComparison(state: ComparisonState, event: ComparisonEvent): ComparisonState {
  switch (event.type) {
    case 'start-a':
      if (state.kind === 'assignment' || state.kind === 'a-complete' || state.kind === 'ready-to-vote') {
        return { kind: 'playing-a', assignment: state.assignment, playCounts: copyCounts(state) };
      }
      break;
    case 'start-b':
      if (state.kind === 'a-complete' || state.kind === 'ready-to-vote') {
        return { kind: 'playing-b', assignment: state.assignment, playCounts: copyCounts(state) };
      }
      break;
    case 'run-end': {
      if ((state.kind === 'playing-a' && event.side === 'a') || (state.kind === 'playing-b' && event.side === 'b')) {
        const playCounts = copyCounts(state);
        playCounts[event.side] += 1;
        // A replay after the other entrant has completed must go straight
        // back to voting; readiness is derived from both counts, not from the
        // side that just ended.
        const kind = playCounts.a > 0 && playCounts.b > 0 ? 'ready-to-vote' : 'a-complete';
        return { kind, assignment: state.assignment, playCounts };
      }
      break;
    }
    case 'replay':
      if (event.side === 'a' && (state.kind === 'a-complete' || state.kind === 'ready-to-vote')) {
        return { kind: 'playing-a', assignment: state.assignment, playCounts: copyCounts(state) };
      }
      if (event.side === 'b' && state.kind === 'ready-to-vote') {
        return { kind: 'playing-b', assignment: state.assignment, playCounts: copyCounts(state) };
      }
      break;
    case 'submit':
      if (state.kind === 'ready-to-vote' && state.playCounts.a > 0 && state.playCounts.b > 0) {
        return { kind: 'submitting', assignment: state.assignment, playCounts: copyCounts(state), verdict: event.verdict };
      }
      break;
    case 'revealed':
      if (state.kind === 'submitting' && event.payload.matchupId === state.assignment.matchupId) {
        return { kind: 'reveal', assignment: state.assignment, playCounts: copyCounts(state), reveal: event.payload };
      }
      break;
  }
  throw new Error(`Invalid comparison transition: ${state.kind} + ${event.type}`);
}

export class ComparisonStateMachine {
  private current: ComparisonState;
  private readonly listeners = new Set<(state: ComparisonState) => void>();

  constructor(assignment: Parameters<typeof initialComparisonState>[0], initial?: ComparisonState) {
    this.current = initial ?? initialComparisonState(assignment);
  }

  get state(): ComparisonState { return this.current; }

  dispatch(event: ComparisonEvent): ComparisonState {
    this.current = reduceComparison(this.current, event);
    for (const listener of this.listeners) listener(this.current);
    return this.current;
  }

  /** Subscribe persistence/UI adapters without coupling the machine to DOM or storage. */
  onTransition(listener: (state: ComparisonState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** A run is counted only when the game reports runend (finish or death). */
  completeRun(side: MatchupSide): ComparisonState { return this.dispatch({ type: 'run-end', side }); }
  startA(): ComparisonState { return this.dispatch({ type: 'start-a' }); }
  startB(): ComparisonState { return this.dispatch({ type: 'start-b' }); }
  replay(side: MatchupSide): ComparisonState { return this.dispatch({ type: 'replay', side }); }
  submit(verdict: VoteVerdict): ComparisonState { return this.dispatch({ type: 'submit', verdict }); }
  reveal(payload: RevealPayload): ComparisonState { return this.dispatch({ type: 'revealed', payload }); }
}

export function voteFromSubmitting(state: ComparisonState): MatchupVote | null {
  return state.kind === 'submitting' ? null : state.kind === 'reveal' ? state.reveal.vote : null;
}
