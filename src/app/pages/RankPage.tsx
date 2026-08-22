import { useCallback, useEffect, useRef, useState } from 'react';
import type { RunSummary } from '../../engine/scoring';
import type { GameLaunchContext } from '../../game';
import type { ComparisonState, MatchupSide, RevealPayload, VoteVerdict } from '../../benchmark/types';
import type { PersonalCurve, PersonalRatingPoint } from '../../benchmark/personal-curve';
import { entrantLabel } from '../../benchmark/identity';
import { CurveChartFigure, CurveLegend, CurveTable } from '../components/curve-chart';
import { COST_AXIS, CURVE_CHART, OUTPUT_TOKENS_AXIS, layoutCurveChart, ratedCurvePoints, type CurveChartLayout, type PlottedCurvePoint } from '../components/curve-layout';
import { CatalogBenchmarkApi, type CompletedMatchup } from '../../benchmark/catalog-api';
import { findCatalogTheme, rankCatalog } from '../../benchmark/catalog';
import { BenchmarkLocalStore } from '../../benchmark/storage';
import { RankController, type RankLaunch } from '../rank';
import { copyText } from '../clipboard';
import { RouteLink } from '../components/RouteLink';
import { CompareCard, GenerationDetails, RevealStage, VersusGrid, VoteButtons } from '../components/matchup';
import type { AppRoute } from '../router';
import { GameFrame } from '../components/LazyGameFrame';
import { loadRankLevel } from '../rank-level';
import { builtInLevelCatalog, getBuiltInLevelById } from '../../levels';
import type { LevelDefinition } from '../../engine/types';
import { INTERLUDE_VERDICT_THRESHOLD, interludeOutcome, recordInterludeOutcome } from '../interlude';

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
  const [interlude, setInterlude] = useState<'idle' | 'playing' | 'just-dismissed'>('idle');
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
    await current.completeRun(side, summary.score);
  }, [route.playSide]);

  if (!controller || !prepared) return <section className="page-panel"><p className="eyebrow">Rank</p><h1>Preparing a matchup…</h1></section>;
  if (launch) return <RankGame launch={launch} onNavigate={onNavigate} onRunEnd={handleRunEnd} />;
  if (interlude === 'playing') return <InterludeGame onReturn={() => setInterlude('idle')} />;
  if (!controller.state) return controller.judgedMatchups.length > 0 ? <CompletedRankPage controller={controller} /> : <ProductionRankPage />;
  const state = controller.state;
  // A one-time Helios detour, offered only between matchups so it never
  // interrupts a comparison someone has already started playing.
  const offerInterlude = interlude === 'idle'
    && state.kind === 'assignment' && state.playCounts.a === 0 && state.playCounts.b === 0
    && controller.judgedMatchups.length >= INTERLUDE_VERDICT_THRESHOLD
    && interludeOutcome() === null;
  if (offerInterlude) return <InterludeOffer
    onPlay={() => { recordInterludeOutcome('played'); setInterlude('playing'); }}
    onDismiss={() => { recordInterludeOutcome('dismissed'); setInterlude('just-dismissed'); }}
  />;
  return <RankContent controller={controller} state={state} onNavigate={onNavigate} showInterludeHint={interlude === 'just-dismissed'} />;
}

function RankContent({ controller, state, onNavigate, showInterludeHint = false }: { controller: RankController; state: ComparisonState; onNavigate: (path: string) => void; showInterludeHint?: boolean }) {
  const assignment = state.assignment;
  const launch = (side: MatchupSide) => {
    const next = controller.launch(side);
    if (next) onNavigate(`/rank?play=${next.side}`);
  };

  return (
    <section className="page-panel rank-panel">
      <p className="eyebrow">Rank</p>
      <h1>{assignment.theme.title}</h1>
      <p className="lede">“{assignment.theme.summary}”</p>
      {showInterludeHint && <p className="interlude-hint" role="status">No problem — Helios is always on the <RouteLink href="/levels" onNavigate={onNavigate}>Levels</RouteLink> page if you change your mind.</p>}
      <details className="prompt-details"><summary>Read full prompt</summary><p>{assignment.theme.prompt}</p></details>
      <RankStage controller={controller} state={state} lastUndoneVerdict={controller.lastUndoneVerdict} onLaunch={launch} onVote={(verdict) => void controller.submit(verdict)} onNext={() => void controller.nextMatchup()} />
      {controller.curve.comparisonCount > 0 && <PersonalCurve controller={controller} />}
    </section>
  );
}

function RankStage({ controller, state, lastUndoneVerdict, onLaunch, onVote, onNext }: { controller: RankController; state: ComparisonState; lastUndoneVerdict: VoteVerdict | null; onLaunch: (side: MatchupSide) => void; onVote: (verdict: VoteVerdict) => void; onNext: () => void }) {
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
    const priorRun = side === 'a' ? runA : runB;
    const completedRuns = state.playCounts[side] > 0;
    const label = completedRuns ? 'Replay' : 'Play';
    return <CompareCard side={side} thumbnailPath={state.assignment[side].thumbnailPath}
      className={nextSide === side ? 'is-next' : undefined}
      primary={nextSide === side || freshAssignment}
      buttonLabel={`${label} Level ${side.toUpperCase()}`}
      onLaunch={() => onLaunch(side)}>
      <p className="compare-stats">{completedRuns && <span>Completed run</span>}{priorRun?.score !== undefined && <span className="run-score">Best score: {priorRun.score.toLocaleString('en-US')}</span>}{recentSide === side && <span className="run-recent">Played most recently</span>}</p>
    </CompareCard>;
  };
  const versusLayout = <VersusGrid a={card('a')} b={card('b')} />;

  if (state.kind === 'assignment') return versusLayout;
  if (state.kind === 'playing-a' || state.kind === 'playing-b') return <div className="assignment-card"><h2>Level {state.kind === 'playing-a' ? 'A' : 'B'} is in progress</h2><p>Your run will be counted when it ends. Refreshing returns here without counting it.</p></div>;
  if (state.kind === 'ready-to-vote') return <>{versusLayout}{import.meta.env.DEV && lastUndoneVerdict && <p className="debug-undo-notice" role="status">Last verdict undone: <strong>{verdictText(lastUndoneVerdict)}</strong></p>}<h2 className="vote-heading">Which run felt better?</h2><VoteButtons onVote={onVote} /></>;
  if (state.kind === 'reveal') return <RevealStage reveal={state.reveal} onNext={onNext} />;
  return <div className="assignment-card"><h2>Saving your vote…</h2></div>;
}

type CurveDebugStage = 'verdicts' | 'chart';

function PersonalCurve({ controller }: { controller: RankController }) {
  const [copyStatus, setCopyStatus] = useState<'idle' | 'copied' | 'failed'>('idle');
  const curve = controller.curve;
  const plottedPoints = ratedCurvePoints(curve);
  const copyDebugData = async (stage: CurveDebugStage, chart?: CurveChartLayout) => {
    const judgments = controller.judgedMatchups;
    const lines = [
      `PARETO RAIL PERSONAL CURVE DEBUG v5 | stage=${stage} | exported=${new Date().toISOString()} | comparisons=${curve.comparisonCount} | configurations=${curve.points.length}`,
      'ALGORITHM | regularized Bradley-Terry | anchor=1 | pseudo-result=tie | rating=1000+400log10(strength)',
      `THRESHOLD | comparisonsRequired=${curve.comparisonsRequired} | established=${curve.establishedCount} | rule=max(3, ceil(0.8 * median comparisons))`,
      ...(chart
        ? [`CHART | size=${CURVE_CHART.width}x${CURVE_CHART.height} | xAxis=${chart.axis.id} | xDomain=0..${chart.xMax} | xTicks=${chart.xTicks.join(',')} | ratingDomain=${chart.ratingMin}..${chart.ratingMax} | ratingTicks=${chart.ratingTicks.join(',')}`]
        : ['VERDICTS | chart=not-rendered']),
      'CURRENT MATCHUP',
      ...debugCurrentMatchup(controller),
      'JUDGMENTS',
      ...judgments.map(({ vote, reveal }, index) => [
        `J${index + 1}`,
        `id=${vote.matchupId}`,
        `at=${vote.submittedAt}`,
        `verdict=${vote.verdict}`,
        `relative=${vote.relative}`,
        `sentiment=${vote.sentiment ?? '-'}`,
        `plays=${vote.playCounts.a}/${vote.playCounts.b}`,
        `A=${debugEntrant(reveal.a)}`,
        `B=${debugEntrant(reveal.b)}`,
      ].join(' | ')),
      'DERIVED POINTS',
      ...(chart?.plotted ?? curve.points).map((point, index) => debugPointLine(point, index)),
      `FRONTIER PATH | ${chart?.frontierPath ?? '-'}`,
    ];
    try {
      await copyText(lines.join('\n'));
      setCopyStatus('copied');
    } catch (error) {
      console.warn('Could not copy personal results debug data', error);
      setCopyStatus('failed');
    }
  };

  const judgedMatchups = controller.judgedMatchups;

  if (!curve.chartReady) return <section className="curve-panel" aria-labelledby="personal-curve-title">
    <div className="curve-heading">
      <div><h2 id="personal-curve-title">Your verdicts</h2></div>
      <CopyDebugButton status={copyStatus} onCopy={() => void copyDebugData('verdicts')} />
    </div>
    <p className="curve-progress">Your quality vs cost chart unlocks as verdicts accumulate.</p>
    <VerdictLog matchups={judgedMatchups} onUndo={() => controller.undoLastVerdict()} />
  </section>;

  const costLayout = layoutCurveChart(plottedPoints, COST_AXIS);
  const tokenLayout = layoutCurveChart(plottedPoints, OUTPUT_TOKENS_AXIS);
  // Two placed points are what an axis needs for a domain at all. The cost axis
  // has many, so this guards the empty case rather than an expected one.
  const showCostChart = costLayout.plotted.length >= 2;
  const showTokenChart = tokenLayout.plotted.length >= 2;

  return <section className="curve-panel" aria-labelledby="personal-curve-title">
    <div className="curve-heading">
      <div><p className="eyebrow">Personal results</p><h2 id="personal-curve-title">Your Pareto Frontier</h2></div>
      <div className="curve-heading-actions">
        <span className="curve-status">{curveStatusNarrative(curve)}</span>
        <CopyDebugButton status={copyStatus} onCopy={() => void copyDebugData('chart', showCostChart ? costLayout : undefined)} />
      </div>
    </div>
    <p className="curve-intro">Each plotted point is a model and workflow configuration, aggregated across its generated levels. The best trade-offs move toward the <strong>upper left</strong>: higher personal preference at lower generation cost.</p>
    <CurveLegend />
    {showCostChart && <CurveChartFigure layout={costLayout} labels={{
      title: 'Quality vs cost',
      ratingAxisTitle: 'Your preference rating',
      chartDescription: 'Scatter plot of your preference rating by measured generation cost. Higher ratings are better and lower costs are better.',
      ratingTerm: 'Preference',
    }} />}
    {showTokenChart && <CurveChartFigure layout={tokenLayout} labels={{
      title: 'Quality vs output tokens',
      ratingAxisTitle: 'Your preference rating',
      chartDescription: 'Scatter plot of your preference rating by mean output tokens. Higher ratings are better and fewer output tokens are better.',
      ratingTerm: 'Preference',
    }} />}
    <CurveTable points={curve.points.filter((point) => point.comparisons > 0)} caption="Your scoreboard" ratingTerm="Preference" />
    <details className="verdict-details"><summary>All your verdicts ({judgedMatchups.length})</summary><VerdictLog matchups={judgedMatchups} onUndo={() => controller.undoLastVerdict()} /></details>
  </section>;
}

function VerdictLog({ matchups, onUndo }: { matchups: readonly CompletedMatchup[]; onUndo?: () => void }) {
  return <ol className="verdict-log" aria-label="Your verdicts">{[...matchups].reverse().map((matchup, index) => <li key={matchup.matchupId}>
    <div className="verdict-headline">
      <div><strong className="verdict-theme">{themeTitleForMatchup(matchup.matchupId)}</strong><span className="verdict-separator"> — </span><span className={`verdict-outcome verdict-${matchup.vote.verdict}`}>{verdictOutcome(matchup.vote.verdict, matchup.reveal)}</span></div>
      {import.meta.env.DEV && index === 0 && onUndo && <button className="verdict-undo" type="button" onClick={onUndo}>Undo</button>}
    </div>
    <details className="verdict-data"><summary>Inspect level generation records</summary><div className="verdict-run-grid"><article><h4>Level A</h4><GenerationDetails entrant={matchup.reveal.a} expanded /></article><article><h4>Level B</h4><GenerationDetails entrant={matchup.reveal.b} expanded /></article></div></details>
  </li>)}</ol>;
}

function verdictOutcome(verdict: VoteVerdict, reveal: RevealPayload) {
  if (verdict === 'both-good' || verdict === 'both-bad') {
    return <>{verdict === 'both-good' ? 'Both impressed you: ' : 'Neither impressed you: '}<span className="verdict-identity">{entrantIdentity(reveal.a)}</span>{' and '}<span className="verdict-identity">{entrantIdentity(reveal.b)}</span></>;
  }
  const preferredSide = verdict === 'a-better' ? 'a' : 'b';
  const otherSide = preferredSide === 'a' ? 'b' : 'a';
  const preferred = reveal[preferredSide];
  const other = reveal[otherSide];
  const costs = preferred.generationCost !== undefined && other.generationCost !== undefined
    ? <>{' '}<span className="verdict-costs">(${preferred.generationCost.toFixed(2)} vs ${other.generationCost.toFixed(2)})</span></>
    : null;
  return <><span className="verdict-identity">{entrantIdentity(preferred)}</span>{' beat '}<span className="verdict-identity">{entrantIdentity(other)}</span>{costs}</>;
}

function entrantIdentity(entrant: RevealPayload['a']): string {
  return entrantLabel({ modelName: entrant.modelName, snapshotLabel: entrant.snapshotLabel, workflowName: entrant.workflowName });
}

function themeTitleForMatchup(matchupId: string): string {
  const separator = matchupId.indexOf(':');
  const themeId = separator > 0 ? matchupId.slice(0, separator) : matchupId;
  return findCatalogTheme(rankCatalog, themeId)?.title ?? themeId;
}

function CopyDebugButton({ status, onCopy }: { status: 'idle' | 'copied' | 'failed'; onCopy: () => void }) {
  const label = status === 'copied' ? 'Debug data copied' : status === 'failed' ? 'Copy failed, try again' : 'Copy debug data';
  return <button className="curve-debug-copy" type="button" data-status={status} onClick={onCopy} aria-label={label} title={label}>
    <svg className="copy-mark" viewBox="0 0 24 24" aria-hidden="true">
      {status === 'copied'
        ? <path d="M4.8 12.6l4.8 4.8L19.2 6.8" />
        : <><rect x="9" y="9" width="11.2" height="12.2" rx="1.6" /><path d="M15.4 5.8H5.4a1.6 1.6 0 0 0-1.6 1.6v10" /></>}
    </svg>
  </button>;
}

function curveStatusNarrative(curve: PersonalCurve): string {
  const judged = curve.points.filter((point) => point.comparisons > 0).length;
  const tooEarly = judged - curve.establishedCount;
  if (tooEarly === 0) return `${curve.establishedCount} ranked`;
  return `${curve.establishedCount} ranked · ${tooEarly} too early`;
}

function debugPointLine(point: PersonalRatingPoint | PlottedCurvePoint, index: number): string {
  const coordinates = 'x' in point
    ? [`x=${point.x.toFixed(2)}`, `y=${point.y.toFixed(2)}`, `labelY=${point.labelY.toFixed(2)}`]
    : [];
  return [
    `P${index + 1}`,
    `config=${point.configurationId}`,
    `label=${point.modelName}/${point.workflowName}`,
    `rating=${point.rating === undefined ? '-' : point.rating.toFixed(4)}`,
    `meanCost=${point.meanCost === undefined ? '-' : point.meanCost.toFixed(6)}`,
    `meanOutputTokens=${point.meanOutputTokens.toFixed(0)}`,
    `comparisons=${point.comparisons}`,
    `required=${point.comparisonsRequired}`,
    `wins=${point.wins}`,
    `ties=${point.ties}`,
    `losses=${point.losses}`,
    `frontier=${point.frontier}`,
    `status=${point.status}`,
    ...coordinates,
  ].join(' | ');
}

function debugEntrant(entrant: RevealPayload['a']): string {
  return `${entrant.modelName}/${entrant.workflowName} config=${entrant.configurationId ?? '-'} entrant=${entrant.entrantId} level=${entrant.levelId} cost=${entrant.generationCost?.toFixed(6) ?? 'unavailable'}`;
}

function debugCurrentMatchup(controller: RankController): string[] {
  const state = controller.state;
  if (!state) return ['none'];

  const { assignment, playCounts } = state;
  const snapshot = controller.debugSnapshot;
  const levelLine = (side: MatchupSide) => {
    const entrant = assignment[side];
    const run = snapshot.levelRuns.find((candidate) => candidate.levelId === entrant.playableRef);
    const exposures = controller.levelExposureCounts[entrant.playableRef] ?? 0;
    return `${side.toUpperCase()} | playableRef=${entrant.playableRef} | currentPlays=${playCounts[side]} | priorRuns=${run?.count ?? 0} | priorJudgmentExposures=${exposures}`;
  };

  return [
    `state=${state.kind} | matchupId=${assignment.matchupId} | assignedAt=${assignment.assignedAt}`,
    `themeId=${assignment.theme.id} | themeTitle=${JSON.stringify(assignment.theme.title)}`,
    levelLine('a'),
    levelLine('b'),
    ...(state.kind === 'reveal' ? [`A_REVEAL | ${debugEntrant(state.reveal.a)}`, `B_REVEAL | ${debugEntrant(state.reveal.b)}`] : []),
  ];
}

function CompletedRankPage({ controller }: { controller: RankController }) {
  return (
    <section className="page-panel rank-panel">
      <p className="eyebrow">Rank</p>
      <h1>You’ve compared everything</h1>
      <p className="lede">Every matchup in the current benchmark has your verdict. New levels will appear here as the catalog grows.</p>
      <PersonalCurve controller={controller} />
    </section>
  );
}

function ProductionRankPage() {
  return <section className="page-panel rank-panel"><p className="eyebrow">Rank</p><h1>No published matchup yet</h1><p className="lede">The public comparison service is provisional while the first benchmark release is prepared.</p><div className="empty-state"><span className="empty-glyph">◌</span><h2>Check back soon</h2><p>Results and assignments will appear here once the release is locked. You can still play Crystal and browse the methodology.</p></div></section>;
}

function RankGame({ launch, onNavigate, onRunEnd }: { launch: RankLaunch; onNavigate: (path: string) => void; onRunEnd: (summary: RunSummary, frame: HTMLElement, context?: GameLaunchContext) => void | Promise<void> }) {
  const [level, setLevel] = useState<Awaited<ReturnType<typeof loadRankLevel>> | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);

  useEffect(() => {
    let active = true;
    setLevel(null);
    setLoadFailed(false);
    loadRankLevel(launch.levelId).then((loaded) => {
      if (active) setLevel(loaded);
    }).catch((error) => {
      console.error('Could not load anonymous level', launch.levelId, error);
      if (active) setLoadFailed(true);
    });
    return () => { active = false; };
  }, [launch.levelId]);

  if (loadFailed) return (
    <section className="page-panel rank-panel">
      <p className="eyebrow">Rank</p>
      <h1>This level could not load</h1>
      <p className="lede">Something went wrong preparing the anonymous level, so this matchup can’t be played right now.</p>
      <div className="empty-state">
        <span className="empty-glyph">◌</span>
        <h2>Back to the matchup</h2>
        <p>Return to Rank to pick up where you left off, or reload to try again.</p>
        <div className="invitation-actions">
          <RouteLink className="button primary" href="/rank" onNavigate={onNavigate}>Back to Rank</RouteLink>
          <button className="button" type="button" onClick={() => window.location.reload()}>Reload</button>
        </div>
      </div>
    </section>
  );
  if (!level) return <section className="page-panel"><p className="eyebrow">Rank</p><h1>Loading anonymous level…</h1></section>;
  return <GameFrame level={level} title={`Level ${launch.side.toUpperCase()}`} launchContext={{ source: 'rank', levelId: launch.levelId, mode: 'benchmark' }} onRunEnd={onRunEnd} runEndContent={<BenchmarkInvitation side={launch.side} onNavigate={onNavigate} />} />;
}

function createRankController(): RankController {
  const store = new BenchmarkLocalStore();
  const api = new CatalogBenchmarkApi(rankCatalog, store);
  return new RankController({ api, store, resolvePlayable: (ref) => ref });
}

function BenchmarkInvitation({ side, onNavigate }: { side: 'a' | 'b'; onNavigate: (path: string) => void }) {
  return <section className="benchmark-invitation"><p>Level {side.toUpperCase()} recorded. Continue when you are ready.</p><div className="invitation-actions"><RouteLink className="button primary" href="/rank" onNavigate={onNavigate}>Continue comparison</RouteLink></div></section>;
}

function InterludeOffer({ onPlay, onDismiss }: { onPlay: () => void; onDismiss: () => void }) {
  const hero = builtInLevelCatalog.find((level) => level.id === 'helios')?.contentImages?.hero;
  return <section className="page-panel rank-panel interlude-panel">
    <p className="eyebrow">Intermission</p>
    <h1>Thanks for voting — want to try something different?</h1>
    <p className="lede">Helios is a one-shot level built from a single instruction: “make something epic.” No benchmark theme, no comparison — a two-minute dive into a dying star.</p>
    {hero && <img className="level-thumbnail interlude-hero" src={hero} alt="Helios — a rail dive toward a dying star" />}
    <div className="rank-actions interlude-actions">
      <button className="button primary" type="button" onClick={onPlay}>Play Helios</button>
      <button className="button" type="button" onClick={onDismiss}>Not now — keep ranking</button>
    </div>
    <p className="interlude-note">When your run ends you’ll land right back at your next matchup.</p>
  </section>;
}

function InterludeGame({ onReturn }: { onReturn: () => void }) {
  const [level, setLevel] = useState<LevelDefinition | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);

  useEffect(() => {
    let active = true;
    getBuiltInLevelById('helios').then((loaded) => {
      if (active) setLevel(loaded);
    }).catch((error: unknown) => {
      console.error('Could not load Helios', error);
      if (active) setLoadFailed(true);
    });
    return () => { active = false; };
  }, []);

  if (loadFailed) return (
    <section className="page-panel rank-panel">
      <p className="eyebrow">Intermission</p>
      <h1>Helios could not load</h1>
      <p className="lede">Something went wrong preparing the level. Your matchups are unaffected.</p>
      <div className="invitation-actions"><button className="button primary" type="button" onClick={onReturn}>Back to ranking</button></div>
    </section>
  );
  if (!level) return <section className="page-panel"><p className="eyebrow">Intermission</p><h1>Loading Helios…</h1></section>;
  return <GameFrame
    level={level}
    title="Helios"
    launchContext={{ source: 'play', levelId: 'helios' }}
    runEndContent={<section className="benchmark-invitation"><p>That was Helios. Back to the matchups when you’re ready.</p><div className="invitation-actions"><button className="button primary" type="button" onClick={onReturn}>Back to ranking</button></div></section>}
  />;
}

function verdictText(verdict: VoteVerdict) { return verdict === 'a-better' ? 'A is better' : verdict === 'b-better' ? 'B is better' : verdict === 'both-good' ? 'Both are good' : 'Both are bad'; }
