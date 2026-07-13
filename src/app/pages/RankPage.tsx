import { useCallback, useEffect, useRef, useState } from 'react';
import type { RunSummary } from '../../engine/scoring';
import type { GameLaunchContext } from '../../game';
import type { ComparisonState, MatchupSide, RevealPayload, VoteVerdict } from '../../benchmark/types';
import type { PersonalCurve, PersonalRatingPoint } from '../../benchmark/personal-curve';
import { CatalogBenchmarkApi } from '../../benchmark/catalog-api';
import { rankCatalog, type RankCatalogConfiguration } from '../../benchmark/catalog';
import { BenchmarkLocalStore, type CompletedMatchup } from '../../benchmark/storage';
import { RankController, type RankLaunch } from '../rank';
import { RouteLink } from '../components/RouteLink';
import type { AppRoute } from '../router';
import { GameFrame } from './GamePage';
import { loadRankLevel } from '../rank-level';

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
      <p className="eyebrow">Rank</p>
      <h1>{assignment.theme.title}</h1>
      <p className="lede">{assignment.theme.summary}</p>
      <details className="prompt-details"><summary>Read full prompt</summary><p>{assignment.theme.prompt}</p></details>
      <p className="rank-note">Two levels were generated independently from this assignment. Model and workflow identities stay hidden until you vote.</p>
      <RankStage controller={controller} state={state} lastUndoneVerdict={controller.lastUndoneVerdict} onLaunch={launch} onVote={(verdict) => void controller.submit(verdict)} onNext={() => void controller.nextMatchup()} />
      {controller.curve.comparisonCount > 0 && <PersonalCurve controller={controller} onNavigate={onNavigate} />}
    </section>
  );
}

function RankStage({ controller, state, lastUndoneVerdict, onLaunch, onVote, onNext }: { controller: RankController; state: ComparisonState; lastUndoneVerdict: VoteVerdict | null; onLaunch: (side: MatchupSide) => void; onVote: (verdict: VoteVerdict) => void; onNext: () => void }) {
  const nextSide = state.kind === 'assignment' && (state.playCounts.a > 0) !== (state.playCounts.b > 0)
    ? state.playCounts.a > 0 ? 'b' : 'a'
    : null;
  const card = (side: MatchupSide) => {
    const priorRun = controller.levelRun(state.assignment[side].playableRef);
    const completedRuns = state.playCounts[side] > 0;
    const label = completedRuns ? 'Replay' : 'Play';
    const emphasized = nextSide === side ? ' is-next' : '';
    return <article className={`compare-card${emphasized}`}>
      <LevelThumbnail side={side} path={state.assignment[side].thumbnailPath} />
      <h2>Level {side.toUpperCase()}</h2>
      <p className="compare-stats">{completedRuns && <span>Completed run</span>}{priorRun?.score !== undefined && <span className="run-score">Latest score: {priorRun.score.toLocaleString('en-US')}</span>}</p>
      <button className={`button${nextSide === side ? ' primary' : ''}`} type="button" onClick={() => onLaunch(side)}>{label} Level {side.toUpperCase()}</button>
    </article>;
  };
  const versusLayout = <div className="compare-grid">{card('a')}<div className="versus-divider" aria-label="Versus"><span>VS</span></div>{card('b')}</div>;

  if (state.kind === 'assignment') return versusLayout;
  if (state.kind === 'playing-a' || state.kind === 'playing-b') return <div className="assignment-card"><h2>Level {state.kind === 'playing-a' ? 'A' : 'B'} is in progress</h2><p>Your run will be counted when it ends. Refreshing returns here without counting it.</p></div>;
  if (state.kind === 'ready-to-vote') return <>{versusLayout}{import.meta.env.DEV && lastUndoneVerdict && <p className="debug-undo-notice" role="status">Last verdict undone: <strong>{verdictText(lastUndoneVerdict)}</strong></p>}<h2 className="vote-heading">Which run felt better?</h2><div className="vote-grid" role="group" aria-label="Choose a verdict"><button className="button primary" type="button" onClick={() => onVote('a-better')}>A is better</button><button className="button primary" type="button" onClick={() => onVote('b-better')}>B is better</button><button className="button" type="button" onClick={() => onVote('both-good')}>Both are good</button><button className="button" type="button" onClick={() => onVote('both-bad')}>Both are bad</button></div></>;
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
      <GenerationDetails entrant={entrant} />
    </article>;
  };
  const comparison = costComparison(reveal);
  return <><div className="reveal-grid">{card('a')}{card('b')}</div><p className="vote-result">You chose <strong>{verdictLabel(reveal.vote.verdict)}</strong>.</p>{comparison && <p className="cost-comparison">{comparison}</p>}<button className="button primary" type="button" onClick={onNext}>Next matchup</button></>;
}

function GenerationDetails({ entrant }: { entrant: RevealPayload['a'] }) {
  const published = rankCatalog.entrants.find((candidate) => candidate.levelId === entrant.levelId);
  const run = entrant.run ?? published?.run;
  if (!run) return null;
  const configuration = configurationFor(entrant.configurationId);
  return <details className="run-details">
    <summary><span>Generation details</span><span>{formatDuration(run.generationWallTimeSeconds)} · {run.models.length} model{run.models.length === 1 ? '' : 's'}</span></summary>
    <div className="run-details-body">
      <dl className="run-facts">
        <div><dt>Level ID</dt><dd>{entrant.levelId}</dd></div>
        <div><dt>Generation</dt><dd title={`${run.generationWallTimeSeconds.toLocaleString('en-US')} seconds`}>{formatDuration(run.generationWallTimeSeconds)}</dd></div>
        <div><dt>Full run</dt><dd title={`${run.totalWallTimeSeconds.toLocaleString('en-US')} seconds`}>{formatDuration(run.totalWallTimeSeconds)}</dd></div>
        <div><dt>Result</dt><dd>{formatRunResult(run.result)}</dd></div>
      </dl>
      <div className="model-usage-list" aria-label="Token usage by model">
        <p>Token usage by model</p>
        {run.models.map((model) => <section className="model-usage" key={`${model.modelName}-${model.role}`}>
          <header><span><strong>{model.modelName}</strong><small>{model.role}</small></span><span>{model.costUsd === undefined ? 'Per-model cost unavailable' : `$${model.costUsd.toFixed(2)}`}</span></header>
          <dl>
            <TokenMetric label="Input" value={model.inputTokens} />
            <TokenMetric label="Cache read" value={model.cacheReadTokens} />
            <TokenMetric label="Cache write" value={model.cacheWriteTokens} />
            <TokenMetric label="Output" value={model.outputTokens} />
            <TokenMetric label="Reasoning" value={model.reasoningTokens} />
          </dl>
        </section>)}
      </div>
      {configuration && <WorkflowDetails configuration={configuration} />}
      <p className="run-data-note">Generation time covers the model session. Full run time also includes deterministic setup, sealing, and verification. Cache and reasoning fields are shown separately rather than folded into input or output.</p>
    </div>
  </details>;
}

function TokenMetric({ label, value }: { label: string; value?: number }) {
  return <div><dt>{label}</dt><dd title={value === undefined ? undefined : value.toLocaleString('en-US')}>{value === undefined ? '—' : formatTokenCount(value)}</dd></div>;
}

function WorkflowDetails({ configuration }: { configuration: RankCatalogConfiguration }) {
  return <div className="workflow-details">
    <p><strong>{configuration.modelName} · {configuration.workflowName}</strong> {configuration.workflowSummary}</p>
    <dl><div><dt>Primary</dt><dd>{configuration.primaryModel} · {configuration.effort} effort</dd></div>{configuration.delegateModel && <div><dt>Requested delegate</dt><dd>{configuration.delegateModel} · {configuration.delegateEffort} effort</dd></div>}</dl>
    {configuration.delegationGuidance && <blockquote><span>Delegation guidance</span>{configuration.delegationGuidance}</blockquote>}
  </div>;
}

const CURVE_CHART = { width: 720, height: 410, left: 72, right: 24, top: 42, bottom: 68 } as const;

type PlottedCurvePoint = {
  configurationId: string;
  modelName: string;
  workflowName: string;
  label: string;
  rating: number;
  meanCost: number;
  comparisons: number;
  wins: number;
  ties: number;
  losses: number;
  frontier: boolean;
  status: 'pending' | 'provisional' | 'stable';
  x: number;
  y: number;
  labelY: number;
};

type CurveDebugStage = 'verdicts' | 'chart';

type CurveDebugChart = {
  costMax: number;
  costTicks: readonly number[];
  ratingMin: number;
  ratingMax: number;
  ratingTicks: readonly number[];
  plotted: readonly PlottedCurvePoint[];
  frontierPath: string | null;
};

function PersonalCurve({ controller, onNavigate }: { controller: RankController; onNavigate: (path: string) => void }) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const [copyStatus, setCopyStatus] = useState<'idle' | 'copied' | 'failed'>('idle');
  const curve = controller.curve;
  const pendingPoints = curve.points.filter((point) => point.status === 'pending');
  const placedPoints = curve.points.filter((point): point is typeof point & { rating: number } => point.status !== 'pending' && point.rating !== undefined);
  const copyDebugData = async (stage: CurveDebugStage, chart?: CurveDebugChart) => {
    const judgments = controller.judgedMatchups;
    const lines = [
      `PARETO RAIL PERSONAL CURVE DEBUG v3 | stage=${stage} | exported=${new Date().toISOString()} | comparisons=${curve.comparisonCount} | configurations=${curve.points.length}`,
      'ALGORITHM | regularized Bradley-Terry | anchor=1 | pseudo-result=tie | rating=1000+400log10(strength)',
      ...(chart
        ? [`CHART | size=${CURVE_CHART.width}x${CURVE_CHART.height} | costDomain=0..${chart.costMax} | costTicks=${chart.costTicks.join(',')} | ratingDomain=${chart.ratingMin}..${chart.ratingMax} | ratingTicks=${chart.ratingTicks.join(',')}`]
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

  if (!curve.frontierReady) return <section className="curve-panel" aria-labelledby="personal-curve-title">
    <div className="curve-heading">
      <div><p className="eyebrow">Your verdicts</p><h2 id="personal-curve-title">How you rank the models</h2></div>
      {import.meta.env.DEV && <button className="curve-debug-copy" type="button" onClick={() => void copyDebugData('verdicts')}>{copyStatus === 'copied' ? 'Copied debug data' : copyStatus === 'failed' ? 'Copy failed' : 'Copy debug data'}</button>}
    </div>
    <p className="curve-intro">Every verdict ranks the model and workflow behind each level — your run scores don't affect this.</p>
    <p className="curve-progress">Your Pareto chart unlocks as verdicts accumulate.</p>
    <VerdictLog matchups={judgedMatchups} onUndo={() => controller.undoLastVerdict()} />
  </section>;

  const costs = placedPoints.map((point) => point.meanCost);
  const ratings = placedPoints.map((point) => point.rating);
  const costTicks = ticksFromZero(Math.max(...costs, 1), 4);
  const ratingTicks = boundedTicks(Math.min(...ratings), Math.max(...ratings), 4);
  const costMax = costTicks.at(-1) ?? 1;
  const ratingMin = ratingTicks[0] ?? 950;
  const ratingMax = ratingTicks.at(-1) ?? 1050;
  const plotWidth = CURVE_CHART.width - CURVE_CHART.left - CURVE_CHART.right;
  const plotHeight = CURVE_CHART.height - CURVE_CHART.top - CURVE_CHART.bottom;
  const plotted = spreadCurveLabels(placedPoints.map((point) => ({
    ...point,
    x: CURVE_CHART.left + (point.meanCost / costMax) * plotWidth,
    y: CURVE_CHART.top + ((ratingMax - point.rating) / (ratingMax - ratingMin)) * plotHeight,
    labelY: 0,
  })));
  const frontier = plotted.filter((point) => point.frontier).sort((left, right) => left.x - right.x);
  const frontierPath = frontier.length > 1 ? `M${frontier.map((point) => `${point.x.toFixed(1)} ${point.y.toFixed(1)}`).join('L')}` : null;
  const active = plotted.find((point) => point.configurationId === activeId) ?? null;
  const chartDebug: CurveDebugChart = { costMax, costTicks, ratingMin, ratingMax, ratingTicks, plotted, frontierPath };

  return <section className="curve-panel" aria-labelledby="personal-curve-title">
    <div className="curve-heading">
      <div><p className="eyebrow">Personal results</p><h2 id="personal-curve-title">Your Pareto curve</h2></div>
      <div className="curve-heading-actions">
        {import.meta.env.DEV && <button className="curve-debug-copy" type="button" onClick={() => void copyDebugData('chart', chartDebug)}>{copyStatus === 'copied' ? 'Copied debug data' : copyStatus === 'failed' ? 'Copy failed' : 'Copy debug data'}</button>}
        <span className="curve-status">{curveStatusNarrative(curve)}</span>
      </div>
    </div>
    <p className="curve-intro">Each plotted point is a model and workflow configuration, aggregated across its generated levels. The best trade-offs move toward the <strong>upper left</strong>: higher personal preference at lower generation cost.</p>
    <div className="curve-legend" aria-label="Chart legend"><span><i className="legend-point frontier" />Pareto frontier</span><span><i className="legend-point" />Other configuration</span><span><i className="legend-point early-estimate" />Early estimate</span><span className="best-direction">↖ Better value</span></div>
    <div className="curve-chart-wrap">
      <svg className="curve-chart" viewBox={`0 0 ${CURVE_CHART.width} ${CURVE_CHART.height}`} role="img" aria-label="Scatter plot of your preference rating by measured generation cost. Higher ratings are better and lower costs are better.">
        <g className="chart-grid">
          {costTicks.map((tick) => {
            const x = CURVE_CHART.left + (tick / costMax) * plotWidth;
            return <g key={`cost-${tick}`}><line x1={x} y1={CURVE_CHART.top} x2={x} y2={CURVE_CHART.top + plotHeight} /><text x={x} y={CURVE_CHART.top + plotHeight + 24} textAnchor="middle">${formatCostTick(tick)}</text></g>;
          })}
          {ratingTicks.map((tick) => {
            const y = CURVE_CHART.top + ((ratingMax - tick) / (ratingMax - ratingMin)) * plotHeight;
            return <g key={`rating-${tick}`}><line x1={CURVE_CHART.left} y1={y} x2={CURVE_CHART.left + plotWidth} y2={y} /><text x={CURVE_CHART.left - 13} y={y + 4} textAnchor="end">{tick}</text></g>;
          })}
        </g>
        <g className="chart-axes">
          <line x1={CURVE_CHART.left} y1={CURVE_CHART.top + plotHeight} x2={CURVE_CHART.left + plotWidth} y2={CURVE_CHART.top + plotHeight} />
          <line x1={CURVE_CHART.left} y1={CURVE_CHART.top} x2={CURVE_CHART.left} y2={CURVE_CHART.top + plotHeight} />
          <text className="axis-title" x={CURVE_CHART.left + plotWidth / 2} y={CURVE_CHART.height - 10} textAnchor="middle">Measured generation cost (USD) · lower is better ←</text>
          <text className="axis-title" x="17" y={CURVE_CHART.top + plotHeight / 2} textAnchor="middle" transform={`rotate(-90 17 ${CURVE_CHART.top + plotHeight / 2})`}>Your preference rating · higher is better ↑</text>
        </g>
        {frontierPath && <path className="frontier-line" d={frontierPath} />}
        <g className="curve-points">
          {plotted.map((point) => {
            const labelOnLeft = point.x > CURVE_CHART.width * .62;
            const labelX = point.x + (labelOnLeft ? -14 : 14);
            const levelNames = levelsForConfiguration(point.configurationId).map((level) => `${level.themeTitle}: ${level.levelId}`).join(', ');
            return <g key={point.configurationId} className={`curve-point${point.frontier ? ' frontier' : ''}${point.status === 'provisional' ? ' provisional' : ''}${activeId === point.configurationId ? ' active' : ''}`} tabIndex={0} role="button" aria-label={`${point.label}. Rating ${point.rating.toFixed(0)}. Mean cost $${point.meanCost.toFixed(2)}. ${point.comparisons} comparisons. Status: ${statusLabel(point.status)}.${point.frontier ? ' On your Pareto frontier.' : ''} Levels: ${levelNames}.`} onMouseEnter={() => setActiveId(point.configurationId)} onMouseLeave={() => setActiveId(null)} onFocus={() => setActiveId(point.configurationId)} onBlur={() => setActiveId(null)} onClick={() => setActiveId(activeId === point.configurationId ? null : point.configurationId)}>
              <line className="label-leader" x1={point.x} y1={point.y} x2={labelX + (labelOnLeft ? 4 : -4)} y2={point.labelY - 4} />
              <circle cx={point.x} cy={point.y} r={point.frontier ? 8 : 6} />
              <text className="point-label" x={labelX} y={point.labelY} textAnchor={labelOnLeft ? 'end' : 'start'}><tspan>{point.modelName}</tspan><tspan x={labelX} dy="14">{point.workflowName}</tspan></text>
            </g>;
          })}
        </g>
      </svg>
      {active && <div className={`curve-tooltip${active.x > CURVE_CHART.width * .62 ? ' align-right' : ''}`} style={{ left: `${active.x / CURVE_CHART.width * 100}%`, top: `${active.y / CURVE_CHART.height * 100}%` }} role="status">
        <strong>{active.modelName}</strong><span>{active.workflowName}</span>
        <dl><div><dt>Preference</dt><dd>{active.rating.toFixed(0)}</dd></div><div><dt>Mean cost</dt><dd>${active.meanCost.toFixed(2)}</dd></div><div><dt>Evidence</dt><dd>{active.comparisons} comparison{active.comparisons === 1 ? '' : 's'}</dd></div></dl>
        <p>{statusLabel(active.status)} · {active.frontier ? 'On your Pareto frontier' : 'Dominated by a higher-value option'}</p>
        <div className="curve-tooltip-levels"><span>Levels behind this point</span><ul>{levelsForConfiguration(active.configurationId).map((level) => <li key={level.levelId}><strong>{level.themeTitle}</strong><code>{level.levelId}</code></li>)}</ul></div>
      </div>}
    </div>
    <p className="curve-help">Hover, tap, or focus a point for details. Ratings start at 1,000 and move with your matchup choices; dashed points are early estimates that firm up with more matchups. They are personal estimates, not public benchmark scores.</p>
    {pendingPoints.length > 0 && <p className="curve-unplotted">Not yet ranked: {pendingPoints.map((point) => point.label).join(', ')}</p>}
    <PersonalCurveTable points={curve.points} showFrontier onNavigate={onNavigate} />
    <details className="verdict-details"><summary>All your verdicts ({judgedMatchups.length})</summary><VerdictLog matchups={judgedMatchups} onUndo={() => controller.undoLastVerdict()} /></details>
  </section>;
}

function VerdictLog({ matchups, onUndo }: { matchups: readonly CompletedMatchup[]; onUndo?: () => void }) {
  return <ol className="verdict-log" aria-label="Your verdicts">{[...matchups].reverse().map((matchup, index) => <li key={matchup.matchupId}>
    <div><strong className="verdict-theme">{themeTitleForMatchup(matchup.matchupId)}</strong><span className="verdict-separator"> — </span><span className={`verdict-outcome verdict-${matchup.vote.verdict}`}>{verdictOutcome(matchup.vote.verdict, matchup.reveal)}</span></div>
    <details className="verdict-data"><summary>Inspect level generation records</summary><div className="verdict-run-grid"><article><h4>Level A</h4><GenerationDetails entrant={matchup.reveal.a} /></article><article><h4>Level B</h4><GenerationDetails entrant={matchup.reveal.b} /></article></div></details>
    {import.meta.env.DEV && index === 0 && onUndo && <button className="verdict-undo" type="button" onClick={onUndo}>Undo</button>}
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
  return <><span className="verdict-identity">{entrantIdentity(preferred)}</span>{' beat '}<span className="verdict-identity">{entrantIdentity(other)}</span>{' '}<span className="verdict-costs">(${preferred.generationCost.toFixed(2)} vs ${other.generationCost.toFixed(2)})</span></>;
}

function entrantIdentity(entrant: RevealPayload['a']): string {
  return `${entrant.modelName}${entrant.snapshotLabel ? ` · ${entrant.snapshotLabel}` : ''} · ${entrant.workflowName}`;
}

function themeTitleForMatchup(matchupId: string): string {
  const separator = matchupId.indexOf(':');
  const themeId = separator > 0 ? matchupId.slice(0, separator) : matchupId;
  return rankCatalog.themes.find((theme) => theme.id === themeId)?.title ?? themeId;
}

function PersonalCurveTable({ points, showFrontier, onNavigate }: { points: readonly PersonalRatingPoint[]; showFrontier: boolean; onNavigate: (path: string) => void }) {
  const ordered = [...points].sort((left, right) => (right.rating ?? -Infinity) - (left.rating ?? -Infinity) || left.configurationId.localeCompare(right.configurationId));
  return <div className="curve-table-wrap"><table className="curve-table"><caption>Chart data and underlying levels</caption><thead><tr><th scope="col">Model</th><th scope="col">Levels</th><th scope="col">Record</th><th scope="col">Preference</th><th scope="col">Mean cost</th><th scope="col">Status</th></tr></thead><tbody>{ordered.map((point) => {
    const frontierStatus = showFrontier && point.frontier;
    const record = point.comparisons === 0
      ? <span aria-label="No comparisons yet">—</span>
      : <span aria-label={recordAriaLabel(point)}>{point.wins}–{point.ties}–{point.losses}</span>;
    const levels = levelsForConfiguration(point.configurationId);
    return <tr key={point.configurationId}><th scope="row"><strong>{point.modelName}</strong><span>{point.workflowName}</span></th><td className="curve-levels">{levels.map((level) => <RouteLink key={level.levelId} href={`/play/${encodeURIComponent(level.levelId)}`} onNavigate={onNavigate}><strong>{level.themeTitle}</strong><code>{level.levelId}</code></RouteLink>)}</td><td>{record}</td><td>{point.rating === undefined ? '—' : point.rating.toFixed(0)}</td><td>${point.meanCost.toFixed(2)}</td><td className={frontierStatus ? 'frontier-status' : ''}>{frontierStatus ? `Frontier · ${statusLabel(point.status)}` : statusLabel(point.status)}</td></tr>;
  })}</tbody></table></div>;
}

function configurationFor(configurationId?: string): RankCatalogConfiguration | undefined {
  return configurationId ? rankCatalog.configurations?.find((configuration) => configuration.id === configurationId) : undefined;
}

function levelsForConfiguration(configurationId: string): { levelId: string; themeTitle: string }[] {
  return rankCatalog.entrants
    .filter((entrant) => entrant.configurationId === configurationId)
    .map((entrant) => ({
      levelId: entrant.levelId,
      themeTitle: rankCatalog.themes.find((theme) => theme.id === entrant.themeId)?.title ?? entrant.themeId,
    }))
    .sort((left, right) => left.themeTitle.localeCompare(right.themeTitle));
}

function formatDuration(seconds: number): string {
  const rounded = Math.round(seconds);
  const hours = Math.floor(rounded / 3600);
  const minutes = Math.floor((rounded % 3600) / 60);
  const remainingSeconds = rounded % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${remainingSeconds}s`;
  return `${remainingSeconds}s`;
}

function formatTokenCount(value: number): string {
  return value.toLocaleString('en-US');
}

function formatRunResult(result: string): string {
  if (result === 'completed') return 'Completed';
  if (result === 'timed-out') return 'Timed out · playable output retained';
  return result.replaceAll('-', ' ');
}

function curveStatusNarrative(curve: PersonalCurve): string {
  if (curve.points.every((point) => point.status === 'stable')) return 'All settled';
  const pending = curve.points.filter((point) => point.status === 'pending').length;
  return pending > 0 ? `${curve.placedCount} ranked · ${pending} pending` : `${curve.placedCount} ranked · still settling`;
}

function statusLabel(status: PersonalRatingPoint['status']): string {
  return status === 'pending' ? 'Needs matchups' : status === 'provisional' ? 'Early estimate' : 'Settled';
}

function recordAriaLabel(point: PersonalRatingPoint): string {
  const count = (value: number, singular: string, plural: string) => `${value} ${value === 1 ? singular : plural}`;
  return `${count(point.wins, 'win', 'wins')}, ${count(point.ties, 'tie', 'ties')}, ${count(point.losses, 'loss', 'losses')}`;
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
    `meanCost=${point.meanCost.toFixed(6)}`,
    `comparisons=${point.comparisons}`,
    `wins=${point.wins}`,
    `ties=${point.ties}`,
    `losses=${point.losses}`,
    `frontier=${point.frontier}`,
    `status=${point.status}`,
    ...coordinates,
  ].join(' | ');
}

function debugEntrant(entrant: RevealPayload['a']): string {
  return `${entrant.modelName}/${entrant.workflowName} config=${entrant.configurationId ?? '-'} entrant=${entrant.entrantId} level=${entrant.levelId} cost=${entrant.generationCost.toFixed(6)}`;
}

function debugCurrentMatchup(controller: RankController): string[] {
  const state = controller.state;
  if (!state) return ['none'];

  const { assignment, playCounts } = state;
  const snapshot = controller.debugSnapshot;
  const levelLine = (side: MatchupSide) => {
    const entrant = assignment[side];
    const run = snapshot.levelRuns.find((candidate) => candidate.levelId === entrant.playableRef);
    const exposures = snapshot.levelExposureCounts[entrant.playableRef] ?? 0;
    return `${side.toUpperCase()} | playableRef=${entrant.playableRef} | currentPlays=${playCounts[side]} | priorRuns=${run?.count ?? 0} | priorJudgmentExposures=${exposures}`;
  };

  return [
    `state=${state.kind} | matchupId=${assignment.matchupId} | benchmarkVersion=${assignment.benchmarkVersion} | assignedAt=${assignment.assignedAt}`,
    `themeId=${assignment.theme.id} | themeTitle=${JSON.stringify(assignment.theme.title)}`,
    levelLine('a'),
    levelLine('b'),
    ...(state.kind === 'reveal' ? [`A_REVEAL | ${debugEntrant(state.reveal.a)}`, `B_REVEAL | ${debugEntrant(state.reveal.b)}`] : []),
  ];
}

async function copyText(text: string): Promise<void> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }
  } catch { /* fall back for browsers that deny the async clipboard API */ }
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.append(textarea);
  textarea.select();
  const copied = document.execCommand('copy');
  textarea.remove();
  if (!copied) throw new Error('Clipboard API unavailable');
}

function ticksFromZero(maximum: number, intervals: number): number[] {
  const step = niceStep(maximum / intervals);
  const upper = Math.ceil(maximum / step) * step;
  return Array.from({ length: Math.round(upper / step) + 1 }, (_, index) => index * step);
}

function boundedTicks(minimum: number, maximum: number, intervals: number): number[] {
  const paddedMin = minimum - 24;
  const paddedMax = maximum + 24;
  const step = niceStep((paddedMax - paddedMin) / intervals);
  const lower = Math.floor(paddedMin / step) * step;
  const upper = Math.ceil(paddedMax / step) * step;
  return Array.from({ length: Math.round((upper - lower) / step) + 1 }, (_, index) => lower + index * step);
}

function niceStep(value: number): number {
  const power = Math.pow(10, Math.floor(Math.log10(Math.max(value, .001))));
  const normalized = value / power;
  return (normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10) * power;
}

function formatCostTick(value: number): string { return value < 10 && value % 1 !== 0 ? value.toFixed(1) : value.toFixed(0); }

function spreadCurveLabels<T extends PlottedCurvePoint>(points: T[]): T[] {
  const ordered = [...points].sort((a, b) => a.y - b.y);
  let prior = CURVE_CHART.top - 32;
  for (const point of ordered) {
    point.labelY = Math.max(point.y - 7, prior + 32);
    prior = point.labelY;
  }
  const overflow = Math.max(0, prior - (CURVE_CHART.height - CURVE_CHART.bottom - 12));
  if (overflow) for (const point of ordered) point.labelY -= overflow;
  return points;
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
function verdictText(verdict: VoteVerdict) { return verdict === 'a-better' ? 'A is better' : verdict === 'b-better' ? 'B is better' : verdict === 'both-good' ? 'Both are good' : 'Both are bad'; }
