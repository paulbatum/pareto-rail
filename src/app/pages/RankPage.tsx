import { useCallback, useEffect, useRef, useState } from 'react';
import type { RunSummary } from '../../engine/scoring';
import type { GameLaunchContext } from '../../game';
import type { ComparisonState, MatchupSide, RevealPayload, VoteVerdict } from '../../benchmark/types';
import { RankController, type RankLaunch } from '../rank';
import { RouteLink } from '../components/RouteLink';
import type { AppRoute } from '../router';
import { GameFrame, loadRankLevel } from './GamePage';

type RankRoute = Extract<AppRoute, { kind: 'rank' }>;

type RankPageProps = {
  route: RankRoute;
  onNavigate: (path: string) => void;
};

export function RankPage({ route, onNavigate }: RankPageProps) {
  const controllerRef = useRef<RankController | null>(null);
  const [controller, setController] = useState<RankController | null>(null);
  const [prepared, setPrepared] = useState(false);
  const [launch, setLaunch] = useState<RankLaunch | null>(null);
  const [, refresh] = useState(0);

  useEffect(() => {
    let active = true;
    void createRankController().then((created) => {
      if (!active) return;
      controllerRef.current = created;
      setController(created);
    });
    return () => { active = false; };
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
    const side = context?.source === 'rank' ? (context.levelId ? route.playSide : null) : null;
    if (!current || !side) return;
    await current.completeRun(side);
    void summary;
  }, [onNavigate, route.playSide]);

  if (!controller || !prepared) return <section className="page-panel"><p className="eyebrow">Rank</p><h1>Preparing a matchup…</h1></section>;
  if (launch) return <RankGame launch={launch} onNavigate={onNavigate} onRunEnd={handleRunEnd} />;
  if (!controller.state) return <ProductionRankPage />;
  return <RankContent controller={controller} state={controller.state} onNavigate={onNavigate} />;
}

function RankContent({ controller, state, onNavigate }: { controller: RankController; state: ComparisonState; onNavigate: (path: string) => void }) {
  const assignment = state.assignment;
  const launch = (side: MatchupSide) => {
    const next = controller.launch(side);
    if (next) onNavigate(`/rank?play=${next.side}`);
  };

  return (
    <section className="page-panel rank-panel">
      <p className="eyebrow">Rank <span className="rehearsal-badge">DEV REHEARSAL</span></p>
      <h1>{assignment.theme.title}</h1>
      <p className="lede">{assignment.theme.summary}</p>
      <details className="prompt-details"><summary>Read full prompt</summary><p>{assignment.theme.prompt}</p></details>
      <p className="rank-note">Two levels were generated independently from this assignment. Model and workflow identities stay hidden until you vote.</p>
      <RankStage state={state} onLaunch={launch} onVote={(verdict) => void controller.submit(verdict)} onNext={() => void controller.nextMatchup()} />
      <PersonalCurve controller={controller} />
    </section>
  );
}

function RankStage({ state, onLaunch, onVote, onNext }: { state: ComparisonState; onLaunch: (side: MatchupSide) => void; onVote: (verdict: VoteVerdict) => void; onNext: () => void }) {
  const card = (side: MatchupSide) => <div className="compare-card"><div className="placeholder-strip" aria-label={`Level ${side.toUpperCase()} placeholder thumbnail`}><span>Level {side.toUpperCase()}</span><i /><i /><i /><i /></div><h2>Level {side.toUpperCase()}</h2><p>{state.playCounts[side]} completed run{state.playCounts[side] === 1 ? '' : 's'}</p></div>;

  if (state.kind === 'assignment') return <div className="assignment-card"><h2>Ready when you are</h2><p>Play both anonymous levels before voting.</p><button className="button primary" type="button" onClick={() => onLaunch('a')}>Play Level A</button></div>;
  if (state.kind === 'a-complete') return <><div className="compare-grid">{card('a')}{card('b')}</div><div className="rank-actions"><button className="button primary" type="button" onClick={() => onLaunch('b')}>Play Level B</button><button className="button" type="button" onClick={() => onLaunch('a')}>Replay Level A</button></div></>;
  if (state.kind === 'playing-a' || state.kind === 'playing-b') return <div className="assignment-card"><h2>Level {state.kind === 'playing-a' ? 'A' : 'B'} is in progress</h2><p>Your run will be counted when it ends. Refreshing returns here without counting it.</p></div>;
  if (state.kind === 'ready-to-vote') return <><div className="compare-grid">{card('a')}{card('b')}</div><div className="rank-actions"><button className="button" type="button" onClick={() => onLaunch('a')}>Replay Level A</button><button className="button" type="button" onClick={() => onLaunch('b')}>Replay Level B</button></div><h2 className="vote-heading">Which run felt better?</h2><div className="vote-grid" role="group" aria-label="Choose a verdict"><button className="button primary" type="button" onClick={() => onVote('a-better')}>A is better</button><button className="button primary" type="button" onClick={() => onVote('b-better')}>B is better</button><button className="button" type="button" onClick={() => onVote('both-good')}>Both are good</button><button className="button" type="button" onClick={() => onVote('both-bad')}>Both are bad</button></div></>;
  if (state.kind === 'reveal') return <RevealStage reveal={state.reveal} onNext={onNext} />;
  return <div className="assignment-card"><h2>Saving your vote…</h2></div>;
}

function RevealStage({ reveal, onNext }: { reveal: RevealPayload; onNext: () => void }) {
  const card = (side: MatchupSide) => {
    const entrant = reveal[side];
    return <article className="reveal-card"><div className="placeholder-strip"><span>Level {side.toUpperCase()}</span><i /><i /><i /><i /></div><h2>Level {side.toUpperCase()}</h2><p className="identity">{entrant.modelName} · {entrant.snapshotLabel} · {entrant.workflowName}</p><p className="cost">${entrant.generationCost.toFixed(2)} measured generation cost</p></article>;
  };
  return <><div className="reveal-grid">{card('a')}{card('b')}</div><p className="vote-result">You chose <strong>{verdictLabel(reveal.vote.verdict)}</strong>.</p><button className="button primary" type="button" onClick={onNext}>Next matchup</button></>;
}

function PersonalCurve({ controller }: { controller: RankController }) {
  const curve = controller.curve;
  if (curve.comparisonCount < 3) return <p className="curve-progress">Your Pareto curve unlocks after {3 - curve.comparisonCount} more comparison{curve.comparisonCount === 2 ? '' : 's'}.</p>;
  const maxCost = Math.max(...curve.points.map((point) => point.meanCost), 1);
  const minCost = Math.min(...curve.points.map((point) => point.meanCost), 0);
  const span = Math.max(maxCost - minCost, .01);
  const plotted = curve.points.map((point) => ({ ...point, x: 28 + ((point.meanCost - minCost) / span) * 260, y: Math.max(20, Math.min(170, 170 - ((point.rating - 900) / 220) * 130)) }));
  const frontier = plotted.filter((point) => point.frontier).sort((left, right) => left.x - right.x);
  const frontierPath = frontier.length > 1 ? `M${frontier.map((point) => `${point.x.toFixed(1)} ${point.y.toFixed(1)}`).join('L')}` : null;
  return <div className="curve-panel"><h2>Your Pareto curve <span>early estimate · {curve.comparisonCount} comparisons</span></h2><svg viewBox="0 0 320 200" role="img" aria-label="Personal quality versus cost curve"><path d="M28 170H300M28 170V20" />{frontierPath && <path className="frontier-line" d={frontierPath} />}{plotted.map((point) => <circle key={point.entrantId} cx={point.x} cy={point.y} r={point.frontier ? 7 : 5} className={point.frontier ? 'frontier' : ''}><title>{point.entrantId} · {point.rating.toFixed(0)} rating · ${point.meanCost.toFixed(2)}</title></circle>)}</svg><p className="muted">Frontier points balance lower measured cost with a higher personal rating.</p></div>;
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

async function createRankController(): Promise<RankController> {
  if (!import.meta.env.DEV) return new RankController();
  const { createDevelopmentFixtureApi, createFixtureCatalog, playableLevelId } = await import('../../benchmark/fixtures');
  const catalog = createFixtureCatalog('development');
  return new RankController({ api: createDevelopmentFixtureApi(), resolvePlayable: (ref) => playableLevelId(ref, catalog) });
}

function BenchmarkInvitation({ side, onNavigate }: { side: 'a' | 'b'; onNavigate: (path: string) => void }) {
  return <section className="benchmark-invitation"><p>Level {side.toUpperCase()} recorded. Continue when you are ready.</p><div className="invitation-actions"><RouteLink className="button primary" href="/rank" onNavigate={onNavigate}>Continue comparison</RouteLink><RouteLink className="button" href={`/rank?play=${side}`} onNavigate={onNavigate}>Replay Level {side.toUpperCase()}</RouteLink></div></section>;
}

function verdictLabel(verdict: VoteVerdict) { return verdict === 'a-better' ? 'Level A' : verdict === 'b-better' ? 'Level B' : verdict === 'both-good' ? 'both good' : 'both bad'; }
