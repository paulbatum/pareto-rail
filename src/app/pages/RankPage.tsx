import { useCallback, useEffect, useRef, useState } from 'react';
import type { RunSummary } from '../../engine/scoring';
import type { GameLaunchContext } from '../../game';
import type { ComparisonState, MatchupSide, RevealPayload, VoteVerdict } from '../../benchmark/types';
import { CatalogBenchmarkApi } from '../../benchmark/catalog-api';
import { rankCatalog } from '../../benchmark/catalog';
import { BenchmarkLocalStore } from '../../benchmark/storage';
import { RankController, type RankLaunch } from '../rank';
import { RouteLink } from '../components/RouteLink';
import type { AppRoute } from '../router';
import { GameFrame, loadRankLevel } from './GamePage';

type RankRoute = Extract<AppRoute, { kind: 'rank' }>;

type RankPageProps = {
  route: RankRoute;
  onNavigate: (path: string) => void;
};

type RunScores = {
  matchupId: string;
  scores: Partial<Record<MatchupSide, number>>;
};

export function RankPage({ route, onNavigate }: RankPageProps) {
  const controllerRef = useRef<RankController | null>(null);
  const [controller, setController] = useState<RankController | null>(null);
  const [prepared, setPrepared] = useState(false);
  const [launch, setLaunch] = useState<RankLaunch | null>(null);
  const [runScores, setRunScores] = useState<RunScores | null>(null);
  const [, refresh] = useState(0);

  useEffect(() => {
    const created = createRankController();
    controllerRef.current = created;
    setController(created);
  }, []);

  useEffect(() => {
    if (!controller) return;
    return controller.subscribe(() => refresh((value) => value + 1));
  }, [controller]);

  useEffect(() => {
    if (!controller) return;
    let active = true;
    setPrepared(false);
    setLaunch(null);
    void controller.prepare().then(() => {
      if (!active) return;
      setPrepared(true);
      if (route.playSide) setLaunch(controller.launch(route.playSide));
    });
    return () => { active = false; };
  }, [controller, route.playSide]);

  const handleRunEnd = useCallback(async (summary: RunSummary, _frame: HTMLElement, context?: GameLaunchContext) => {
    const current = controllerRef.current;
    const side = context?.source === 'rank' && context.levelId ? route.playSide : null;
    const matchupId = current?.assignment?.matchupId;
    if (!current || !side || !matchupId) return;
    await current.completeRun(side);
    setRunScores((previous) => ({
      matchupId,
      scores: {
        ...(previous?.matchupId === matchupId ? previous.scores : {}),
        [side]: summary.score,
      },
    }));
  }, [route.playSide]);

  if (!controller || !prepared) return <section className="page-panel"><p className="eyebrow">Rank</p><h1>Preparing a matchup…</h1></section>;
  if (launch) return <RankGame launch={launch} onNavigate={onNavigate} onRunEnd={handleRunEnd} />;
  if (!controller.state) return <ProductionRankPage />;
  return <RankContent controller={controller} state={controller.state} runScores={runScores?.matchupId === controller.state.assignment.matchupId ? runScores.scores : undefined} onNavigate={onNavigate} />;
}

function RankContent({ controller, state, runScores, onNavigate }: { controller: RankController; state: ComparisonState; runScores?: Partial<Record<MatchupSide, number>>; onNavigate: (path: string) => void }) {
  const assignment = state.assignment;
  const launch = (side: MatchupSide) => {
    const next = controller.launch(side);
    if (next) onNavigate(`/rank?play=${next.side}`);
  };

  return (
    <section className="page-panel rank-panel">
      <p className="eyebrow">Rank</p>
      <h1>{assignment.theme.title}</h1>
      <p className="lede">{assignment.theme.summary}</p>
      <details className="prompt-details"><summary>Read full prompt</summary><p>{assignment.theme.prompt}</p></details>
      <p className="rank-note">Two levels were generated independently from this assignment. Model and workflow identities stay hidden until you vote.</p>
      <RankStage state={state} runScores={runScores} onLaunch={launch} onVote={(verdict) => void controller.submit(verdict)} onNext={() => void controller.nextMatchup()} />
      <PersonalCurve controller={controller} />
    </section>
  );
}

function RankStage({ state, runScores, onLaunch, onVote, onNext }: { state: ComparisonState; runScores?: Partial<Record<MatchupSide, number>>; onLaunch: (side: MatchupSide) => void; onVote: (verdict: VoteVerdict) => void; onNext: () => void }) {
  const nextSide = state.kind === 'assignment' && (state.playCounts.a > 0) !== (state.playCounts.b > 0)
    ? state.playCounts.a > 0 ? 'b' : 'a'
    : null;
  const card = (side: MatchupSide) => {
    const score = runScores?.[side];
    const completedRuns = state.playCounts[side] > 0;
    const label = completedRuns ? 'Replay' : 'Play';
    const emphasized = nextSide === side ? ' is-next' : '';
    return <article className={`compare-card${emphasized}`}>
      <LevelThumbnail side={side} path={state.assignment[side].thumbnailPath} />
      <h2>Level {side.toUpperCase()}</h2>
      <p className="compare-stats"><span>{state.playCounts[side]} completed run{state.playCounts[side] === 1 ? '' : 's'}</span>{score !== undefined && <span className="run-score">Your run: {score.toLocaleString('en-US')}</span>}</p>
      <button className={`button${nextSide === side ? ' primary' : ''}`} type="button" onClick={() => onLaunch(side)}>{label} Level {side.toUpperCase()}</button>
    </article>;
  };
  const versusLayout = <div className="compare-grid">{card('a')}<div className="versus-divider" aria-label="Versus"><span>VS</span></div>{card('b')}</div>;

  if (state.kind === 'assignment') return versusLayout;
  if (state.kind === 'playing-a' || state.kind === 'playing-b') return <div className="assignment-card"><h2>Level {state.kind === 'playing-a' ? 'A' : 'B'} is in progress</h2><p>Your run will be counted when it ends. Refreshing returns here without counting it.</p></div>;
  if (state.kind === 'ready-to-vote') return <>{versusLayout}<h2 className="vote-heading">Which run felt better?</h2><div className="vote-grid" role="group" aria-label="Choose a verdict"><button className="button primary" type="button" onClick={() => onVote('a-better')}>A is better</button><button className="button primary" type="button" onClick={() => onVote('b-better')}>B is better</button><button className="button" type="button" onClick={() => onVote('both-good')}>Both are good</button><button className="button" type="button" onClick={() => onVote('both-bad')}>Both are bad</button></div></>;
  if (state.kind === 'reveal') return <RevealStage reveal={state.reveal} onNext={onNext} />;
  return <div className="assignment-card"><h2>Saving your vote…</h2></div>;
}

function RevealStage({ reveal, onNext }: { reveal: RevealPayload; onNext: () => void }) {
  const card = (side: MatchupSide) => {
    const entrant = reveal[side];
    const marker = revealMarker(reveal.vote.verdict, side);
    return <article className={`reveal-card${marker.className}`}>
      {marker.label && <span className="reveal-tag">{marker.label}</span>}
      <LevelThumbnail side={side} path={entrant.thumbnailPath} />
      <h2>Level {side.toUpperCase()}</h2>
      <p className="identity">{entrant.modelName}{entrant.snapshotLabel ? ` · ${entrant.snapshotLabel}` : ''} · {entrant.workflowName}</p>
      <p className="cost"><strong className="cost-value">${entrant.generationCost.toFixed(2)}</strong><span className="cost-label">measured generation cost</span></p>
    </article>;
  };
  const comparison = costComparison(reveal);
  return <><div className="reveal-grid">{card('a')}{card('b')}</div><p className="vote-result">You chose <strong>{verdictLabel(reveal.vote.verdict)}</strong>.</p>{comparison && <p className="cost-comparison">{comparison}</p>}<button className="button primary" type="button" onClick={onNext}>Next matchup</button></>;
}

function PersonalCurve({ controller }: { controller: RankController }) {
  const curve = controller.curve;
  if (!curve.unlocked) return <p className="curve-progress">Your Pareto curve unlocks after {4 - curve.comparisonCount} more matchup{curve.comparisonCount === 3 ? '' : 's'}.</p>;
  const maxCost = Math.max(...curve.points.map((point) => point.meanCost), 1);
  const minCost = Math.min(...curve.points.map((point) => point.meanCost), 0);
  const span = Math.max(maxCost - minCost, .01);
  const plotted = curve.points.map((point) => ({ ...point, x: 38 + ((point.meanCost - minCost) / span) * 262, y: Math.max(28, Math.min(180, 180 - ((point.rating - 900) / 220) * 152)) }));
  const frontier = plotted.filter((point) => point.frontier).sort((left, right) => left.x - right.x);
  const frontierPath = frontier.length > 1 ? `M${frontier.map((point) => `${point.x.toFixed(1)} ${point.y.toFixed(1)}`).join('L')}` : null;
  return <div className="curve-panel"><h2>Your Pareto curve <span>{curve.isFull ? 'full curve' : 'early estimate'} · {curve.comparisonCount} comparisons</span></h2><svg viewBox="0 0 320 220" role="img" aria-label="Personal preference rating versus generation cost in dollars"><path d="M38 180H300M38 180V28" /><text className="axis-label axis-x" x="170" y="210">Cost ($)</text><text className="axis-label axis-y" x="11" y="110" transform="rotate(-90 11 110)">Preference rating</text>{frontierPath && <path className="frontier-line" d={frontierPath} />}{plotted.map((point) => <circle key={point.configurationId} cx={point.x} cy={point.y} r={point.frontier ? 7 : 5} className={point.frontier ? 'frontier' : ''}><title>{point.label} · {point.rating.toFixed(0)} rating · ${point.meanCost.toFixed(2)}</title></circle>)}</svg><p className="muted">Frontier points balance lower measured cost with a higher personal rating.</p></div>;
}

function LevelThumbnail({ side, path }: { side: MatchupSide; path?: string }) {
  const [failed, setFailed] = useState(false);
  if (!path || failed) return <div className="thumbnail-fallback" aria-label={`Level ${side.toUpperCase()} thumbnail unavailable`}><span>Level {side.toUpperCase()}</span></div>;
  return <img className="level-thumbnail" src={path} alt={`Anonymous Level ${side.toUpperCase()}`} onError={() => setFailed(true)} />;
}

function ProductionRankPage() {
  return <section className="page-panel rank-panel"><p className="eyebrow">Rank</p><h1>No published matchup yet</h1><p className="lede">The public comparison service is provisional while the first benchmark release is prepared.</p><div className="empty-state"><span className="empty-glyph">◌</span><h2>Check back soon</h2><p>Results and assignments will appear here once the release is locked. You can still play Crystal and browse the methodology.</p></div></section>;
}

function RankGame({ launch, onNavigate, onRunEnd }: { launch: RankLaunch; onNavigate: (path: string) => void; onRunEnd: (summary: RunSummary, frame: HTMLElement, context?: GameLaunchContext) => void | Promise<void> }) {
  const [level, setLevel] = useState<Awaited<ReturnType<typeof loadRankLevel>> | null>(null);

  useEffect(() => {
    let active = true;
    setLevel(null);
    void loadRankLevel(launch.levelId).then((loaded) => {
      if (active) setLevel(loaded);
    });
    return () => { active = false; };
  }, [launch.levelId]);

  if (!level) return <section className="page-panel"><p className="eyebrow">Rank</p><h1>Loading anonymous level…</h1></section>;
  return <GameFrame level={level} title={`Level ${launch.side.toUpperCase()}`} backPath="/rank" backLabel="Matchup" launchContext={{ source: 'rank', levelId: launch.levelId, mode: 'benchmark' }} showLevelPicker={false} onNavigate={onNavigate} onRunEnd={onRunEnd} runEndContent={<BenchmarkInvitation side={launch.side} onNavigate={onNavigate} />} />;
}

function createRankController(): RankController {
  const store = new BenchmarkLocalStore();
  store.pruneToCatalog(
    new Set(rankCatalog.entrants.map((entrant) => entrant.levelId)),
    new Set(rankCatalog.themes.map((theme) => theme.id)),
  );
  const api = new CatalogBenchmarkApi(rankCatalog, store);
  return new RankController({ api, store, resolvePlayable: (ref) => ref });
}

function BenchmarkInvitation({ side, onNavigate }: { side: 'a' | 'b'; onNavigate: (path: string) => void }) {
  return <section className="benchmark-invitation"><p>Level {side.toUpperCase()} recorded. Continue when you are ready.</p><div className="invitation-actions"><RouteLink className="button primary" href="/rank" onNavigate={onNavigate}>Continue comparison</RouteLink><RouteLink className="button" href={`/rank?play=${side}`} onNavigate={onNavigate}>Replay Level {side.toUpperCase()}</RouteLink></div></section>;
}

function revealMarker(verdict: VoteVerdict, side: MatchupSide): { className: string; label: string | null } {
  if (verdict === 'both-good') return { className: ' is-picked', label: 'Your pick' };
  if (verdict === 'both-bad') return { className: ' is-rejected', label: 'Not preferred' };
  const picked = verdict === 'a-better' ? 'a' : 'b';
  return picked === side ? { className: ' is-picked', label: 'Your pick' } : { className: '', label: null };
}

function costComparison(reveal: RevealPayload): string | null {
  const preferred = reveal.vote.verdict === 'a-better' ? 'a' : reveal.vote.verdict === 'b-better' ? 'b' : null;
  if (!preferred) return null;
  const other = preferred === 'a' ? 'b' : 'a';
  const preferredCost = reveal[preferred].generationCost.toFixed(2);
  const otherCost = reveal[other].generationCost.toFixed(2);
  if (preferredCost === otherCost) return null;
  return `You preferred the $${preferredCost} level over the $${otherCost} one.`;
}

function verdictLabel(verdict: VoteVerdict) { return verdict === 'a-better' ? 'Level A' : verdict === 'b-better' ? 'Level B' : verdict === 'both-good' ? 'both good' : 'both bad'; }
