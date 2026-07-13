import {
  type ComparisonState,
  type MatchupSide,
  type MatchupVote,
  type RevealPayload,
  type VoteVerdict,
  initialComparisonState,
} from './types';

export type ComparisonEvent =
  | { type: 'start'; side: MatchupSide }
  /** Legacy event names remain valid for callers that dispatch directly. */
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
    case 'start':
    case 'start-a':
    case 'start-b': {
      const side = event.type === 'start' ? event.side : event.type === 'start-a' ? 'a' : 'b';
      if (state.kind === 'assignment' || state.kind === 'ready-to-vote') {
        return { kind: side === 'a' ? 'playing-a' : 'playing-b', assignment: state.assignment, playCounts: copyCounts(state) };
      }
      break;
    }
    case 'run-end': {
      if ((state.kind === 'playing-a' && event.side === 'a') || (state.kind === 'playing-b' && event.side === 'b')) {
        const playCounts = copyCounts(state);
        playCounts[event.side] += 1;
        const kind = playCounts.a > 0 && playCounts.b > 0 ? 'ready-to-vote' : 'assignment';
        return { kind, assignment: state.assignment, playCounts };
      }
      break;
    }
    case 'replay':
      if ((state.kind === 'assignment' || state.kind === 'ready-to-vote') && state.playCounts[event.side] > 0) {
        return { kind: event.side === 'a' ? 'playing-a' : 'playing-b', assignment: state.assignment, playCounts: copyCounts(state) };
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
  start(side: MatchupSide): ComparisonState { return this.dispatch({ type: 'start', side }); }
  startA(): ComparisonState { return this.start('a'); }
  startB(): ComparisonState { return this.start('b'); }
  replay(side: MatchupSide): ComparisonState { return this.dispatch({ type: 'replay', side }); }
  submit(verdict: VoteVerdict): ComparisonState { return this.dispatch({ type: 'submit', verdict }); }
  reveal(payload: RevealPayload): ComparisonState { return this.dispatch({ type: 'revealed', payload }); }
}

export function voteFromSubmitting(state: ComparisonState): MatchupVote | null {
  return state.kind === 'submitting' ? null : state.kind === 'reveal' ? state.reveal.vote : null;
}
