import {
  recomputePersonalCurve,
  personalHistoryFromReveals,
} from '../benchmark/personal-curve';
import { ComparisonStateMachine } from '../benchmark/state';
import { BenchmarkLocalStore } from '../benchmark/storage';
import type {
  BenchmarkApi,
  ComparisonState,
  MatchupAssignment,
  MatchupSide,
  RevealPayload,
  VoteVerdict,
} from '../benchmark/types';

export type RankLaunch = { side: MatchupSide; levelId: string };
type Navigate = (path: string) => void;

/** Participant-facing benchmark controller. It owns only the local fixture
 * workflow; server-backed benchmark data can be supplied through the API seam. */
export class RankController {
  private readonly store: BenchmarkLocalStore;
  private readonly api: BenchmarkApi | null;
  private readonly resolvePlayable: ((ref: string) => string) | null;
  private machine: ComparisonStateMachine | null = null;
  private host: HTMLElement | null = null;
  private navigate: Navigate = () => {};
  private busy = false;

  constructor(options: { api?: BenchmarkApi; store?: BenchmarkLocalStore; resolvePlayable?: (ref: string) => string } = {}) {
    this.store = options.store ?? new BenchmarkLocalStore();
    this.api = options.api ?? null;
    this.resolvePlayable = options.resolvePlayable ?? null;
  }

  get assignment(): MatchupAssignment | null { return this.machine?.state.assignment ?? null; }
  get state(): ComparisonState | null { return this.machine?.state ?? null; }
  get participantId() { return this.store.participantId; }

  async render(host: HTMLElement, navigate: Navigate) {
    this.host = host;
    this.navigate = navigate;
    if (!this.api) { this.renderProduction(); return; }
    await this.ensureRound();
    this.renderState();
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
    return { side, levelId: this.resolvePlayable(side === 'a' ? next.assignment.a.playableRef : next.assignment.b.playableRef) };
  }

  async completeRun(side: MatchupSide) {
    if (!this.machine || this.busy) return;
    const state = this.machine.state;
    if ((state.kind !== 'playing-a' && state.kind !== 'playing-b') || (state.kind === 'playing-a' ? 'a' : 'b') !== side) return;
    this.busy = true;
    try {
      const counts = await this.api!.recordPlay({ matchupId: state.assignment.matchupId, side, participantId: this.store.participantId });
      const next = this.machine.completeRun(side);
      // Trust the API's authoritative counts while retaining the pure state machine transition.
      const corrected = { ...next, playCounts: counts } as ComparisonState;
      this.replaceState(corrected, false);
    } finally { this.busy = false; }
  }

  async submit(verdict: VoteVerdict) {
    if (!this.machine || this.machine.state.kind !== 'ready-to-vote' || this.busy) return;
    this.busy = true;
    try {
      const submitting = this.machine.submit(verdict); this.persist(submitting);
      const vote = await this.api!.submitVote({ matchupId: submitting.assignment.matchupId, participantId: this.store.participantId, verdict, playCounts: submitting.playCounts });
      const reveal = await this.api!.reveal(submitting.assignment.matchupId, this.store.participantId);
      const revealed = this.machine.reveal({ ...reveal, vote });
      this.store.completeMatchup({ matchupId: reveal.matchupId, vote, reveal });
      this.machine = new ComparisonStateMachine(revealed.assignment, revealed);
      this.renderState();
    } catch (error) {
      console.warn('Could not submit benchmark vote', error);
      const current = this.machine?.state;
      if (current?.kind === 'submitting') {
        const ready: ComparisonState = { kind: 'ready-to-vote', assignment: current.assignment, playCounts: { ...current.playCounts } };
        this.machine = new ComparisonStateMachine(ready.assignment, ready);
        this.persist(ready);
        this.renderState();
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
      this.renderState();
    } finally { this.busy = false; }
  }

  private async ensureRound() {
    const unfinished = this.store.snapshot.unfinishedMatchup;
    if (unfinished) {
      // A refresh during gameplay must not count a phantom run. Return to the
      // actionable pre-launch state and restore the fixture's server memory.
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
    this.store.save({ unfinishedMatchup: state, themeHistory: prior.includes(state.assignment.theme.id) ? prior : [...prior, state.assignment.theme.id] });
  }
  private replaceState(state: ComparisonState, render = true) { this.machine = new ComparisonStateMachine(state.assignment, state); this.persist(state); if (render) this.renderState(); }

  private renderProduction() {
    this.host!.innerHTML = `<section class="page-panel rank-panel"><p class="eyebrow">Rank</p><h1>No published matchup yet</h1><p class="lede">The public comparison service is provisional while the first benchmark release is prepared.</p><div class="empty-state"><span class="empty-glyph">◌</span><h2>Check back soon</h2><p>Results and assignments will appear here once the release is locked. You can still play Crystal and browse the methodology.</p></div></section>`;
  }

  private renderState() {
    if (!this.host || !this.machine) return;
    const state = this.machine.state;
    const assignment = state.assignment;
    const theme = assignment.theme;
    const progress = this.personalCurve();
    const body = document.createElement('section'); body.className = 'page-panel rank-panel';
    body.innerHTML = `<p class="eyebrow">Rank <span class="rehearsal-badge">DEV REHEARSAL</span></p><h1>${escapeHtml(theme.title)}</h1><p class="lede">${escapeHtml(theme.summary)}</p><details class="prompt-details"><summary>Read full prompt</summary><p>${escapeHtml(theme.prompt)}</p></details><p class="rank-note">Two levels were generated independently from this assignment. Model and workflow identities stay hidden until you vote.</p><div class="rank-stage"></div><div class="curve-slot"></div>`;
    const stage = body.querySelector<HTMLElement>('.rank-stage')!;
    this.renderStage(stage, state);
    const curve = body.querySelector<HTMLElement>('.curve-slot')!;
    renderCurve(curve, progress);
    this.host.replaceChildren(body);
  }

  private renderStage(host: HTMLElement, state: ComparisonState) {
    const a = `<div class="compare-card"><div class="placeholder-strip" aria-label="Level A placeholder thumbnail"><span>Level A</span><i></i><i></i><i></i><i></i></div><h2>Level A</h2><p>${state.playCounts.a} completed run${state.playCounts.a === 1 ? '' : 's'}</p></div>`;
    const b = `<div class="compare-card"><div class="placeholder-strip" aria-label="Level B placeholder thumbnail"><span>Level B</span><i></i><i></i><i></i><i></i></div><h2>Level B</h2><p>${state.playCounts.b} completed run${state.playCounts.b === 1 ? '' : 's'}</p></div>`;
    if (state.kind === 'assignment') { host.innerHTML = `<div class="assignment-card"><h2>Ready when you are</h2><p>Play both anonymous levels before voting.</p><button class="button primary" data-action="play-a">Play Level A</button></div>`; }
    else if (state.kind === 'a-complete') { host.innerHTML = `<div class="compare-grid">${a}${b}</div><div class="rank-actions"><button class="button primary" data-action="play-b">Play Level B</button><button class="button" data-action="replay-a">Replay Level A</button></div>`; }
    else if (state.kind === 'playing-a' || state.kind === 'playing-b') { host.innerHTML = `<div class="assignment-card"><h2>Level ${state.kind === 'playing-a' ? 'A' : 'B'} is in progress</h2><p>Your run will be counted when it ends. Refreshing returns here without counting it.</p></div>`; }
    else if (state.kind === 'ready-to-vote') { host.innerHTML = `<div class="compare-grid">${a}${b}</div><div class="rank-actions"><button class="button" data-action="replay-a">Replay Level A</button><button class="button" data-action="replay-b">Replay Level B</button></div><h2 class="vote-heading">Which run felt better?</h2><div class="vote-grid" role="group" aria-label="Choose a verdict"><button class="button primary" data-verdict="a-better">A is better</button><button class="button primary" data-verdict="b-better">B is better</button><button class="button" data-verdict="both-good">Both are good</button><button class="button" data-verdict="both-bad">Both are bad</button></div>`; }
    else if (state.kind === 'reveal') this.renderReveal(host, state.reveal);
    else host.innerHTML = `<div class="assignment-card"><h2>Saving your vote…</h2></div>`;
    host.querySelectorAll<HTMLElement>('[data-action]').forEach((button) => button.addEventListener('click', () => this.handleAction(button.dataset.action!)));
    host.querySelectorAll<HTMLButtonElement>('[data-verdict]').forEach((button) => { button.addEventListener('click', () => void this.submit(button.dataset.verdict as VoteVerdict)); });
  }

  private renderReveal(host: HTMLElement, reveal: RevealPayload) {
    const card = (side: 'a' | 'b') => { const entrant = reveal[side]; return `<article class="reveal-card"><div class="placeholder-strip"><span>Level ${side.toUpperCase()}</span><i></i><i></i><i></i><i></i></div><h2>Level ${side.toUpperCase()}</h2><p class="identity">${escapeHtml(entrant.modelName)} · ${escapeHtml(entrant.snapshotLabel)} · ${escapeHtml(entrant.workflowName)}</p><p class="cost">$${entrant.generationCost.toFixed(2)} measured generation cost</p></article>`; };
    host.innerHTML = `<div class="reveal-grid">${card('a')}${card('b')}</div><p class="vote-result">You chose <strong>${verdictLabel(reveal.vote.verdict)}</strong>.</p><button class="button primary" data-action="next">Next matchup</button>`;
    host.querySelector('[data-action="next"]')?.addEventListener('click', () => void this.nextMatchup());
  }

  private handleAction(action: string) {
    const side = action.endsWith('-a') ? 'a' : 'b';
    if (action === 'play-a' || action === 'play-b' || action === 'replay-a' || action === 'replay-b') {
      const launch = this.launch(side as MatchupSide); if (launch) this.navigate(`/rank?play=${launch.side}`);
    }
  }

  private personalCurve() {
    const data = this.store.snapshot;
    const reveals = data.completedMatchups.map((item) => item.reveal);
    return recomputePersonalCurve(personalHistoryFromReveals(data.history, reveals));
  }
}

function renderCurve(host: HTMLElement, curve: ReturnType<RankController['personalCurve']>) {
  if (curve.comparisonCount < 3) { host.innerHTML = `<p class="curve-progress">Your Pareto curve unlocks after ${3 - curve.comparisonCount} more comparison${curve.comparisonCount === 2 ? '' : 's'}.</p>`; return; }
  const points = curve.points; const maxCost = Math.max(...points.map((point) => point.meanCost), 1); const minCost = Math.min(...points.map((point) => point.meanCost), 0); const span = Math.max(maxCost - minCost, .01);
  const plotted = points.map((point) => ({
    ...point,
    x: 28 + ((point.meanCost - minCost) / span) * 260,
    y: Math.max(20, Math.min(170, 170 - ((point.rating - 900) / 220) * 130)),
  }));
  const dots = plotted.map((point) => `<circle cx="${point.x.toFixed(1)}" cy="${point.y.toFixed(1)}" r="${point.frontier ? 7 : 5}" class="${point.frontier ? 'frontier' : ''}"><title>${escapeHtml(point.entrantId)} · ${point.rating.toFixed(0)} rating · $${point.meanCost.toFixed(2)}</title></circle>`).join('');
  const frontier = plotted.filter((point) => point.frontier).sort((left, right) => left.x - right.x);
  const frontierPath = frontier.length > 1 ? `<path class="frontier-line" d="M${frontier.map((point) => `${point.x.toFixed(1)} ${point.y.toFixed(1)}`).join('L')}"/>` : '';
  host.innerHTML = `<div class="curve-panel"><h2>Your Pareto curve <span>early estimate · ${curve.comparisonCount} comparisons</span></h2><svg viewBox="0 0 320 200" role="img" aria-label="Personal quality versus cost curve"><path d="M28 170H300M28 170V20"/>${frontierPath}${dots}</svg><p class="muted">Frontier points balance lower measured cost with a higher personal rating.</p></div>`;
}

function verdictLabel(verdict: VoteVerdict) { return verdict === 'a-better' ? 'Level A' : verdict === 'b-better' ? 'Level B' : verdict === 'both-good' ? 'both good' : 'both bad'; }
function escapeHtml(value: string) { const div = document.createElement('div'); div.textContent = value; return div.innerHTML; }
