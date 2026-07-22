import { useCallback, useEffect, useMemo, useState } from 'react';
import type { RunSummary } from '../../engine/scoring';
import type { GameLaunchContext } from '../../game';
import type { ComparisonState, MatchupSide, VoteVerdict } from '../../benchmark/types';
import { rankCatalog, type RankCatalogTheme } from '../../benchmark/catalog';
import { benchmarkLevelCatalog } from '../../levels';
import { customMatchControllerFor, type CustomMatchController, type MatchError, type MatchLaunch } from '../match';
import { copyText } from '../clipboard';
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
  const controller = useMemo(() => customMatchControllerFor(route.a, route.b), [route.a, route.b]);
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

  if (!controller.valid) return <MatchSetupPage error={controller.error!} onNavigate={onNavigate} />;
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
  const runA = controller.levelRun(state.assignment.a.playableRef);
  const runB = controller.levelRun(state.assignment.b.playableRef);
  /** Only meaningful once both sides have a run, so the badge implies the other side came first. */
  const recentSide: MatchupSide | null = runA && runB && runA.completedAt !== runB.completedAt
    ? (runA.completedAt > runB.completedAt ? 'a' : 'b')
    : null;
  const card = (side: MatchupSide) => {
    const played = state.playCounts[side] > 0;
    const priorRun = side === 'a' ? runA : runB;
    return <CompareCard side={side} thumbnailPath={state.assignment[side].thumbnailPath}
      className={nextSide === side ? 'is-next' : undefined}
      primary={nextSide === side || freshAssignment}
      buttonLabel={`${played ? 'Replay' : 'Play'} Level ${side.toUpperCase()}`}
      onLaunch={() => onLaunch(side)}>
      {themeAnnotation(side)}
      <p className="compare-stats">{played && <span>Completed run</span>}{priorRun?.score !== undefined && <span className="run-score">Best score: {priorRun.score.toLocaleString('en-US')}</span>}{recentSide === side && <span className="run-recent">Played most recently</span>}</p>
    </CompareCard>;
  };
  const versusLayout = <VersusGrid a={card('a')} b={card('b')} />;

  if (state.kind === 'assignment') return versusLayout;
  if (state.kind === 'playing-a' || state.kind === 'playing-b') return <div className="assignment-card"><h2>Level {state.kind === 'playing-a' ? 'A' : 'B'} is in progress</h2><p>Your run is remembered on this device, so it counts when it ends. Your pick is never recorded.</p></div>;
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
  const shareUrl = `${window.location.origin}${matchPath(controller.a!.levelId, controller.b!.levelId)}`;
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

function MatchSetupPage({ error, onNavigate }: { error: MatchError; onNavigate: (path: string) => void }) {
  // `missing` is the bare /match landing; `same`/`unknown` came from a bad link,
  // so they get a short notice above the same picker.
  const notice = error.kind === 'missing'
    ? null
    : error.kind === 'same'
      ? `A match needs two different levels, but both sides point at “${error.id}”.`
      : `These level ids aren’t in the catalog: ${error.ids.join(', ')}.`;
  return (
    <section className="page-panel rank-panel">
      <p className="eyebrow">Custom match</p>
      <h1>Build a custom match</h1>
      <p className="lede">Pick two levels to play head-to-head, then reveal which model built each. Nothing here is recorded — it’s just for fun.</p>
      {notice && <p className="match-pick-error" role="alert">{notice}</p>}
      <MatchPicker onNavigate={onNavigate} />
      <p className="match-url-hint">Prefer a link? Use <code>/match?a=&lt;level-id&gt;&amp;b=&lt;level-id&gt;</code> — browse ids on the <RouteLink href="/levels/data" onNavigate={onNavigate}>catalog data page</RouteLink>.</p>
    </section>
  );
}

type PickerEntry = { levelId: string; thumbnailPath?: string };
type PickerBand = { theme: RankCatalogTheme; entries: PickerEntry[] };

/** Playable catalog entrants grouped into theme bands, mirroring the levels
 * gallery's `themeBands`: only entrants whose level module is present appear, so
 * module-less retired entrants are excluded. Retired and experimental themes all
 * show — the picker has no category filter. */
function pickerBands(): PickerBand[] {
  const playable = new Set(benchmarkLevelCatalog.map((level) => level.id));
  const bands: PickerBand[] = [];
  for (const theme of rankCatalog.themes) {
    const entries = rankCatalog.entrants
      .filter((entrant) => entrant.themeId === theme.id && playable.has(entrant.levelId))
      .sort((first, second) => first.generationCost - second.generationCost)
      .map((entrant): PickerEntry => ({ levelId: entrant.levelId, ...(entrant.thumbnailPath ? { thumbnailPath: entrant.thumbnailPath } : {}) }));
    if (entries.length > 0) bands.push({ theme, entries });
  }
  return bands;
}

/** Blind, transient level picker. Cards show only the thumbnail and level id —
 * never model or cost — so the person can still play the match blind. First pick
 * is side A, second is side B; picking a third replaces side B. */
function MatchPicker({ onNavigate }: { onNavigate: (path: string) => void }) {
  const bands = useMemo(pickerBands, []);
  const [selected, setSelected] = useState<readonly string[]>([]);
  const [copyStatus, setCopyStatus] = useState<'idle' | 'copied' | 'failed'>('idle');

  const toggle = (levelId: string) => {
    setCopyStatus('idle');
    setSelected((current) => {
      if (current.includes(levelId)) return current.filter((id) => id !== levelId);
      if (current.length < 2) return [...current, levelId];
      return [current[0], levelId];
    });
  };

  const [a, b] = selected;
  const ready = selected.length === 2;
  const copy = async () => {
    try {
      await copyText(`${window.location.origin}${matchPath(a, b)}`);
      setCopyStatus('copied');
    } catch {
      setCopyStatus('failed');
    }
  };

  return (
    <div className="match-picker">
      {bands.map((band) => (
        <section className="levels-band" key={band.theme.id}>
          <div className="levels-band-head"><h2>{band.theme.title}<PickerThemeTag theme={band.theme} /> — {band.entries.length} level{band.entries.length === 1 ? '' : 's'}</h2></div>
          <div className="levels-grid">
            {band.entries.map((entry) => {
              const index = selected.indexOf(entry.levelId);
              return (
                <button key={entry.levelId} type="button" className={`gallery-card match-pick-card${index >= 0 ? ' is-selected' : ''}`} aria-pressed={index >= 0} onClick={() => toggle(entry.levelId)}>
                  <span className="gallery-thumb">
                    <PickerThumbnail path={entry.thumbnailPath} />
                    {index >= 0 && <b className="match-pick-badge">{index === 0 ? 'A' : 'B'}</b>}
                  </span>
                  <span className="gallery-copy"><span className="name run-id">{entry.levelId}</span></span>
                </button>
              );
            })}
          </div>
        </section>
      ))}
      {ready && (
        <div className="match-pick-bar">
          <p className="match-pick-summary">Level A: <span className="run-id">{a}</span> · Level B: <span className="run-id">{b}</span></p>
          <div className="match-pick-actions">
            <button className="button primary" type="button" onClick={() => onNavigate(matchPath(a, b))}>Start match</button>
            <button className="button" type="button" onClick={() => void copy()}>{copyStatus === 'copied' ? 'Link copied' : copyStatus === 'failed' ? 'Copy failed — try again' : 'Copy share link'}</button>
          </div>
        </div>
      )}
    </div>
  );
}

function PickerThemeTag({ theme }: { theme: RankCatalogTheme }) {
  if (theme.retired === true) return <span className="retired-tag">Retired</span>;
  if (theme.experimental === true) return <span className="experimental-tag">Experimental</span>;
  return null;
}

function PickerThumbnail({ path }: { path?: string }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => { setFailed(false); }, [path]);
  if (!path || failed) return <span className="thumbnail-fallback"><span>No thumbnail</span></span>;
  return <img src={path} alt="" loading="lazy" onError={() => setFailed(true)} />;
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
  return <section className="benchmark-invitation"><p>Level {side.toUpperCase()} played — your run is remembered on this device. Continue when you are ready.</p><div className="invitation-actions"><RouteLink className="button primary" href={backPath} onNavigate={onNavigate}>Back to match</RouteLink></div></section>;
}
