import { ComparisonStateMachine } from '../benchmark/state';
import { findCatalogEntrant, findCatalogTheme, rankCatalog, type RankCatalog, type RankCatalogEntrant, type RankCatalogTheme } from '../benchmark/catalog';
import { revealFor } from '../benchmark/catalog-api';
import { mapVerdict, type BenchmarkTheme, type ComparisonState, type MatchupAssignment, type MatchupSide, type MatchupVote, type RevealPayload, type VoteVerdict } from '../benchmark/types';

export type MatchLaunch = { side: MatchupSide; levelId: string };
type Listener = () => void;

/** Why the requested pair can't be played, for the page to render as a friendly
 * error instead of a broken matchup. */
export type MatchError =
  | { kind: 'missing' }
  | { kind: 'same'; id: string }
  | { kind: 'unknown'; ids: readonly string[] };

const CUSTOM_THEME: BenchmarkTheme = {
  id: 'custom',
  title: 'Custom match',
  summary: 'A head-to-head between two levels you picked.',
  prompt: '',
};

/**
 * Controller for the casual `/match` page. It mirrors the ranked comparison flow
 * (play both, vote, reveal) using {@link ComparisonStateMachine}, but persists
 * nothing: no local store, no remote recorder, no benchmark API. Play counts and
 * scores live only in this instance, so a refresh restarts the match by design.
 *
 * Eligibility is any catalog entrant resolved via {@link findCatalogEntrant} —
 * deliberately broader than the ranked scheduler, so retired entrants and
 * entrants of retired or experimental themes can be matched here.
 */
export class CustomMatchController {
  readonly error: MatchError | null;
  readonly a: RankCatalogEntrant | null;
  readonly b: RankCatalogEntrant | null;
  /** The shared theme when both entrants belong to the same one; otherwise null
   * and the page shows each side's theme separately. */
  readonly sharedTheme: RankCatalogTheme | null;
  private readonly catalog: RankCatalog;
  private readonly listeners = new Set<Listener>();
  private readonly bestScores = new Map<string, number>();
  private machine: ComparisonStateMachine | null = null;

  constructor(aId: string | undefined, bId: string | undefined, catalog: RankCatalog = rankCatalog) {
    this.catalog = catalog;
    if (!aId || !bId) {
      this.error = { kind: 'missing' };
      this.a = this.b = null;
      this.sharedTheme = null;
      return;
    }
    if (aId === bId) {
      this.error = { kind: 'same', id: aId };
      this.a = this.b = null;
      this.sharedTheme = null;
      return;
    }
    const a = findCatalogEntrant(catalog, aId) ?? null;
    const b = findCatalogEntrant(catalog, bId) ?? null;
    const unknown = [...(a ? [] : [aId]), ...(b ? [] : [bId])];
    if (unknown.length > 0) {
      this.error = { kind: 'unknown', ids: unknown };
      this.a = this.b = null;
      this.sharedTheme = null;
      return;
    }
    this.error = null;
    this.a = a;
    this.b = b;
    this.sharedTheme = a!.themeId === b!.themeId ? findCatalogTheme(catalog, a!.themeId) ?? null : null;
    const theme = this.sharedTheme ?? CUSTOM_THEME;
    const assignment: MatchupAssignment = {
      matchupId: `custom:${a!.levelId}:${b!.levelId}`,
      theme,
      a: { playableRef: a!.levelId, ...(a!.thumbnailPath ? { thumbnailPath: a!.thumbnailPath } : {}) },
      b: { playableRef: b!.levelId, ...(b!.thumbnailPath ? { thumbnailPath: b!.thumbnailPath } : {}) },
      assignedAt: new Date().toISOString(),
    };
    this.machine = new ComparisonStateMachine(assignment);
  }

  get valid(): boolean { return this.error === null; }
  get state(): ComparisonState | null { return this.machine?.state ?? null; }
  get assignment(): MatchupAssignment | null { return this.machine?.state.assignment ?? null; }

  /** The theme of one side, for the cross-theme header where identities differ
   * but showing the theme pre-vote is fine (a theme is not an identity). */
  themeForSide(side: MatchupSide): RankCatalogTheme | undefined {
    const entrant = side === 'a' ? this.a : this.b;
    return entrant ? findCatalogTheme(this.catalog, entrant.themeId) : undefined;
  }

  bestScore(levelId: string): number | undefined { return this.bestScores.get(levelId); }

  subscribe(listener: Listener) {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  launch(side: MatchupSide): MatchLaunch | null {
    const state = this.machine?.state;
    if (!state) return null;
    const alreadyPlaying = (state.kind === 'playing-a' && side === 'a') || (state.kind === 'playing-b' && side === 'b');
    if (alreadyPlaying) return { side, levelId: state.assignment[side].playableRef };
    if (state.kind !== 'assignment' && state.kind !== 'ready-to-vote') return null;
    const next = state.kind === 'ready-to-vote' ? this.machine!.replay(side) : this.machine!.start(side);
    this.emit();
    return { side, levelId: next.assignment[side].playableRef };
  }

  completeRun(side: MatchupSide, score: number) {
    if (!this.machine) return;
    const state = this.machine.state;
    if ((state.kind !== 'playing-a' && state.kind !== 'playing-b') || (state.kind === 'playing-a' ? 'a' : 'b') !== side) return;
    const levelId = state.assignment[side].playableRef;
    const prior = this.bestScores.get(levelId);
    if (prior === undefined || score > prior) this.bestScores.set(levelId, score);
    this.machine.completeRun(side);
    this.emit();
  }

  submit(verdict: VoteVerdict) {
    if (!this.machine || this.machine.state.kind !== 'ready-to-vote' || !this.a || !this.b) return;
    const submitting = this.machine.submit(verdict);
    const mapping = mapVerdict(verdict);
    const vote: MatchupVote = {
      matchupId: submitting.assignment.matchupId,
      aEntrantId: this.a.levelId,
      bEntrantId: this.b.levelId,
      verdict,
      relative: mapping.relative,
      ...(mapping.sentiment ? { sentiment: mapping.sentiment } : {}),
      playCounts: { ...submitting.playCounts },
      submittedAt: new Date().toISOString(),
    };
    const reveal: RevealPayload = {
      matchupId: submitting.assignment.matchupId,
      a: revealFor(this.a),
      b: revealFor(this.b),
      vote,
    };
    this.machine.reveal(reveal);
    this.emit();
  }

  private emit() { for (const listener of this.listeners) listener(); }
}
