import { useCallback, useEffect, useMemo, useState } from 'react';
import type { RunSummary } from '../../engine/scoring';
import type { GameLaunchContext } from '../../game';
import type { ComparisonState, MatchupSide, VoteVerdict } from '../../benchmark/types';
import type { RankCatalogTheme } from '../../benchmark/catalog';
import { CustomMatchController, type MatchError, type MatchLaunch } from '../match';
import { copyText } from '../clipboard';
import { absoluteUrl } from '../seo';
import { RouteLink } from '../components/RouteLink';
import { CompareCard, RevealCards, VersusGrid, VoteButtons } from '../components/matchup';
import type { AppRoute } from '../router';
import { GameFrame } from '../components/LazyGameFrame';
import { loadRankLevel } from '../rank-level';

type MatchRoute = Extract<AppRoute, { kind: 'match' }>;

type MatchPageProps = {
  route: MatchRoute;
  onNavigate: (path: string) => void;
};

const CASUAL_NOTE = 'This is a casual match. Your pick is not recorded and does not affect any rankings.';

function matchPath(a: string, b: string): string {
  return `/match?a=${encodeURIComponent(a)}&b=${encodeURIComponent(b)}`;
}

export function MatchPage({ route, onNavigate }: MatchPageProps) {
  const controller = useMemo(() => new CustomMatchController(route.a, route.b), [route.a, route.b]);
  const [, refresh] = useState(0);
  const [launch, setLaunch] = useState<MatchLaunch | null>(null);

  useEffect(() => controller.subscribe(() => refresh((value) => value + 1)), [controller]);
  useEffect(() => {
    setLaunch(route.playSide ? controller.launch(route.playSide) : null);
  }, [controller, route.playSide]);

  const handleRunEnd = useCallback(async (summary: RunSummary, _frame: HTMLElement, context?: GameLaunchContext) => {
    const side = context?.source === 'match' && context.levelId ? route.playSide : null;
    if (!side) return;
    controller.completeRun(side, summary.score);
  }, [controller, route.playSide]);

  if (!controller.valid) return <MatchErrorPanel error={controller.error!} onNavigate={onNavigate} />;
  if (launch) return <MatchGame launch={launch} backPath={matchPath(route.a!, route.b!)} onNavigate={onNavigate} onRunEnd={handleRunEnd} />;
  return <MatchContent controller={controller} state={controller.state!} onNavigate={onNavigate} />;
}

function MatchContent({ controller, state, onNavigate }: { controller: CustomMatchController; state: ComparisonState; onNavigate: (path: string) => void }) {
  const shared = controller.sharedTheme;
  const launch = (side: MatchupSide) => {
    const next = controller.launch(side);
    if (next) onNavigate(`${matchPath(controller.a!.levelId, controller.b!.levelId)}&play=${next.side}`);
  };

  return (
    <section className="page-panel rank-panel">
      <p className="eyebrow">Custom match</p>
      {shared
        ? <><h1>{shared.title}</h1><p className="lede">“{shared.summary}”</p><details className="prompt-details"><summary>Read full prompt</summary><p>{shared.prompt}</p></details></>
        : <><h1>Custom match</h1><p className="lede">Two levels from different themes, played head-to-head.</p></>}
      <p className="match-casual-note" role="note">{CASUAL_NOTE}</p>
      <MatchStage controller={controller} state={state} crossTheme={!shared} onLaunch={launch} onVote={(verdict) => controller.submit(verdict)} onNavigate={onNavigate} />
    </section>
  );
}

function MatchStage({ controller, state, crossTheme, onLaunch, onVote, onNavigate }: { controller: CustomMatchController; state: ComparisonState; crossTheme: boolean; onLaunch: (side: MatchupSide) => void; onVote: (verdict: VoteVerdict) => void; onNavigate: (path: string) => void }) {
  const themeAnnotation = (side: MatchupSide) => {
    if (!crossTheme) return null;
    const theme = controller.themeForSide(side);
    if (!theme) return null;
    return <ThemeAnnotation theme={theme} />;
  };

  const nextSide = state.kind === 'assignment' && (state.playCounts.a > 0) !== (state.playCounts.b > 0)
    ? state.playCounts.a > 0 ? 'b' : 'a'
    : null;
  const freshAssignment = state.kind === 'assignment' && state.playCounts.a === 0 && state.playCounts.b === 0;
  const card = (side: MatchupSide) => {
    const played = state.playCounts[side] > 0;
    const score = controller.bestScore(state.assignment[side].playableRef);
    return <CompareCard side={side} thumbnailPath={state.assignment[side].thumbnailPath}
      className={nextSide === side ? 'is-next' : undefined}
      primary={nextSide === side || freshAssignment}
      buttonLabel={`${played ? 'Replay' : 'Play'} Level ${side.toUpperCase()}`}
      onLaunch={() => onLaunch(side)}>
      {themeAnnotation(side)}
      <p className="compare-stats">{played && <span>Completed run</span>}{score !== undefined && <span className="run-score">Best score: {score.toLocaleString('en-US')}</span>}</p>
    </CompareCard>;
  };
  const versusLayout = <VersusGrid a={card('a')} b={card('b')} />;

  if (state.kind === 'assignment') return versusLayout;
  if (state.kind === 'playing-a' || state.kind === 'playing-b') return <div className="assignment-card"><h2>Level {state.kind === 'playing-a' ? 'A' : 'B'} is in progress</h2><p>This match lives only in this tab. Refreshing starts it over — nothing is saved either way.</p></div>;
  if (state.kind === 'ready-to-vote') return <>{versusLayout}<h2 className="vote-heading">Which run felt better?</h2><VoteButtons onVote={onVote} /></>;
  if (state.kind === 'reveal') return <>
    <RevealCards reveal={state.reveal} sideAnnotation={themeAnnotation} />
    <MatchRevealActions controller={controller} onNavigate={onNavigate} />
  </>;
  return versusLayout;
}

function ThemeAnnotation({ theme }: { theme: RankCatalogTheme }) {
  return <div className="match-theme">
    <p className="match-theme-title">{theme.title}</p>
    {theme.prompt && <details className="prompt-details"><summary>Read full prompt</summary><p>{theme.prompt}</p></details>}
  </div>;
}

function MatchRevealActions({ controller, onNavigate }: { controller: CustomMatchController; onNavigate: (path: string) => void }) {
  const [copyStatus, setCopyStatus] = useState<'idle' | 'copied' | 'failed'>('idle');
  const shareUrl = absoluteUrl(matchPath(controller.a!.levelId, controller.b!.levelId));
  const copy = async () => {
    try {
      await copyText(shareUrl);
      setCopyStatus('copied');
    } catch {
      setCopyStatus('failed');
    }
  };
  return <div className="reveal-actions">
    <button className="button primary" type="button" onClick={() => void copy()}>{copyStatus === 'copied' ? 'Link copied' : copyStatus === 'failed' ? 'Copy failed — try again' : 'Copy match link'}</button>
    <RouteLink className="button" href="/rank" onNavigate={onNavigate}>Go to ranked comparisons</RouteLink>
  </div>;
}

function MatchErrorPanel({ error, onNavigate }: { error: MatchError; onNavigate: (path: string) => void }) {
  const detail = error.kind === 'missing'
    ? 'Add both levels to the address: /match?a=<level-id>&b=<level-id>.'
    : error.kind === 'same'
      ? `A match needs two different levels, but both sides point at “${error.id}”.`
      : `These level ids aren’t in the catalog: ${error.ids.join(', ')}.`;
  return (
    <section className="page-panel rank-panel">
      <p className="eyebrow">Custom match</p>
      <h1>Set up a custom match</h1>
      <p className="lede">A custom match plays two levels head-to-head, then reveals which model built each. Nothing you do here is recorded.</p>
      <div className="empty-state">
        <span className="empty-glyph">◌</span>
        <h2>Check the link</h2>
        <p>{detail}</p>
        <p>Browse valid level ids on the <RouteLink href="/levels/data" onNavigate={onNavigate}>catalog data page</RouteLink>.</p>
      </div>
    </section>
  );
}

function MatchGame({ launch, backPath, onNavigate, onRunEnd }: { launch: MatchLaunch; backPath: string; onNavigate: (path: string) => void; onRunEnd: (summary: RunSummary, frame: HTMLElement, context?: GameLaunchContext) => void | Promise<void> }) {
  const [level, setLevel] = useState<Awaited<ReturnType<typeof loadRankLevel>> | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);

  useEffect(() => {
    let active = true;
    setLevel(null);
    setLoadFailed(false);
    loadRankLevel(launch.levelId).then((loaded) => {
      if (active) setLevel(loaded);
    }).catch((error) => {
      console.error('Could not load match level', launch.levelId, error);
      if (active) setLoadFailed(true);
    });
    return () => { active = false; };
  }, [launch.levelId]);

  if (loadFailed) return (
    <section className="page-panel rank-panel">
      <p className="eyebrow">Custom match</p>
      <h1>This level could not load</h1>
      <p className="lede">Something went wrong preparing the level, so this side of the match can’t be played right now.</p>
      <div className="empty-state">
        <span className="empty-glyph">◌</span>
        <h2>Back to the match</h2>
        <p>Return to the match to pick up where you left off, or reload to try again.</p>
        <div className="invitation-actions">
          <RouteLink className="button primary" href={backPath} onNavigate={onNavigate}>Back to match</RouteLink>
          <button className="button" type="button" onClick={() => window.location.reload()}>Reload</button>
        </div>
      </div>
    </section>
  );
  if (!level) return <section className="page-panel"><p className="eyebrow">Custom match</p><h1>Loading level…</h1></section>;
  return <GameFrame level={level} title={`Level ${launch.side.toUpperCase()}`} launchContext={{ source: 'match', levelId: launch.levelId, mode: 'benchmark' }} onNavigate={onNavigate} onRunEnd={onRunEnd} runEndContent={<MatchInvitation side={launch.side} backPath={backPath} onNavigate={onNavigate} />} />;
}

function MatchInvitation({ side, backPath, onNavigate }: { side: MatchupSide; backPath: string; onNavigate: (path: string) => void }) {
  return <section className="benchmark-invitation"><p>Level {side.toUpperCase()} played. Nothing was saved — continue when you are ready.</p><div className="invitation-actions"><RouteLink className="button primary" href={backPath} onNavigate={onNavigate}>Back to match</RouteLink></div></section>;
}
