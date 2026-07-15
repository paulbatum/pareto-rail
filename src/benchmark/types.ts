/** Public benchmark contracts.  Keep the pre-vote projection deliberately
 * smaller than the reveal projection: it must not contain identity or cost. */

export type BenchmarkDataClass = 'eligible' | 'rehearsal' | 'development';
export type MatchupSide = 'a' | 'b';
export type RelativeOutcome = MatchupSide | 'tie';
export type TieSentiment = 'positive' | 'negative';
export type VoteVerdict = 'a-better' | 'b-better' | 'both-good' | 'both-bad';

export interface BenchmarkTheme {
  id: string;
  title: string;
  summary: string;
  prompt: string;
}

/** This is safe to send before a vote.  A playable ref is opaque by design. */
export interface PreVoteEntrant {
  playableRef: string;
  thumbnailPath?: string;
}

export interface BenchmarkModelUsage {
  modelName: string;
  role: 'solo' | 'orchestrate' | 'implement';
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  reasoningTokens?: number;
  costUsd?: number;
  /** Which source these figures came from, when the run cross-checked two.  `agreed` means both
   * matched; `harness-counter` means the persisted transcripts under-reported and were corrected. */
  usageSource?: 'ccusage' | 'harness-counter' | 'agreed';
}

/** The CLI that drove the run.  Token fields are only comparable within a
 * harness, so the harness is part of the record rather than a detail of it. */
export interface BenchmarkHarness {
  name: string;
  version: string;
}

export interface BenchmarkRunMetrics {
  generationWallTimeSeconds: number;
  totalWallTimeSeconds: number;
  result: string;
  orchestrationTreatment: string;
  harness?: BenchmarkHarness;
  models: readonly BenchmarkModelUsage[];
}

export interface RevealEntrant extends PreVoteEntrant {
  entrantId: string;
  levelId: string;
  configurationId?: string;
  modelName: string;
  snapshotLabel?: string;
  workflowName: string;
  generationCost: number;
  costCurrency?: string;
  run?: BenchmarkRunMetrics;
  dataClass: BenchmarkDataClass;
}

export interface MatchupAssignment {
  matchupId: string;
  benchmarkVersion: string;
  theme: BenchmarkTheme;
  a: PreVoteEntrant;
  b: PreVoteEntrant;
  assignedAt: string;
}

export interface PlayCounts {
  a: number;
  b: number;
}

export interface VoteMapping {
  verdict: VoteVerdict;
  relative: RelativeOutcome;
  sentiment?: TieSentiment;
}

export interface MatchupVote {
  matchupId: string;
  aEntrantId: string;
  bEntrantId: string;
  verdict: VoteVerdict;
  relative: RelativeOutcome;
  sentiment?: TieSentiment;
  playCounts: PlayCounts;
  submittedAt: string;
}

export interface RevealPayload {
  matchupId: string;
  a: RevealEntrant;
  b: RevealEntrant;
  vote: MatchupVote;
}

export type ComparisonState =
  /** The idle pre-vote state. One side may already have completed runs. */
  | { kind: 'assignment'; assignment: MatchupAssignment; playCounts: PlayCounts }
  | { kind: 'playing-a'; assignment: MatchupAssignment; playCounts: PlayCounts }
  | { kind: 'playing-b'; assignment: MatchupAssignment; playCounts: PlayCounts }
  | { kind: 'ready-to-vote'; assignment: MatchupAssignment; playCounts: PlayCounts }
  | { kind: 'submitting'; assignment: MatchupAssignment; playCounts: PlayCounts; verdict: VoteVerdict }
  | { kind: 'reveal'; assignment: MatchupAssignment; playCounts: PlayCounts; reveal: RevealPayload };

export interface NextMatchupRequest {
  participantId: string;
  judged?: readonly { matchupId: string; relative: RelativeOutcome }[];
}

export interface RecordPlayRequest {
  matchupId: string;
  side: MatchupSide;
  participantId: string;
}

export interface SubmitVoteRequest {
  matchupId: string;
  participantId: string;
  verdict: VoteVerdict;
  playCounts: PlayCounts;
  idempotencyKey?: string;
}

export interface BenchmarkApi {
  nextMatchup(request: NextMatchupRequest): Promise<MatchupAssignment | null>;
  recordPlay(request: RecordPlayRequest): Promise<PlayCounts>;
  submitVote(request: SubmitVoteRequest): Promise<MatchupVote>;
  reveal(matchupId: string, participantId?: string): Promise<RevealPayload>;
}

export function mapVerdict(verdict: VoteVerdict): VoteMapping {
  switch (verdict) {
    case 'a-better': return { verdict, relative: 'a' };
    case 'b-better': return { verdict, relative: 'b' };
    case 'both-good': return { verdict, relative: 'tie', sentiment: 'positive' };
    case 'both-bad': return { verdict, relative: 'tie', sentiment: 'negative' };
  }
}

export const verdictMapping = mapVerdict;

export function initialComparisonState(assignment: MatchupAssignment): ComparisonState {
  return { kind: 'assignment', assignment, playCounts: { a: 0, b: 0 } };
}
