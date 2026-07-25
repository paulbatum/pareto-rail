import { useRef, useState } from 'react';
import type { PersonalCurve, PersonalRatingPoint } from '../../benchmark/personal-curve';
import { workflowQualifier } from '../../benchmark/identity';
import { rankCatalog } from '../../benchmark/catalog';

export const CURVE_CHART = { width: 720, height: 410, left: 72, right: 24, top: 42, bottom: 68 } as const;

export type PlottedCurvePoint = PersonalRatingPoint & {
  rating: number;
  x: number;
  y: number;
  labelY: number;
};

/** Everything the chart is drawn from: axis domains, placed points, and the
 * frontier path. Kept separate from the rendering so the rank page's debug
 * export can describe exactly what was drawn. */
export interface CurveChartLayout {
  costMax: number;
  costTicks: readonly number[];
  ratingMin: number;
  ratingMax: number;
  ratingTicks: readonly number[];
  plotted: readonly PlottedCurvePoint[];
  frontierPath: string | null;
}

const configurationEfforts = new Map((rankCatalog.configurations ?? []).map((configuration) => [configuration.id, configuration.effort]));

/** The reasoning effort a configuration ran at, as a parenthetical suffix for
 * model names on the results chart and table. */
export function effortSuffix(configurationId: string): string | null {
  const effort = configurationEfforts.get(configurationId);
  return effort ? `(${effort.charAt(0).toUpperCase()}${effort.slice(1)})` : null;
}

export function ratedCurvePoints(curve: PersonalCurve): (PersonalRatingPoint & { rating: number })[] {
  return curve.points.filter((point): point is PersonalRatingPoint & { rating: number } => point.rating !== undefined);
}

/** Axis ticks two charts can share so their points are read against the same
 * scale. Derived from the union of both point sets. */
export interface CurveDomain {
  costTicks: readonly number[];
  ratingTicks: readonly number[];
}

export function curveDomain(points: readonly (PersonalRatingPoint & { rating: number })[]): CurveDomain {
  return {
    costTicks: ticksFromZero(Math.max(...points.map((point) => point.meanCost), 1), 4),
    ratingTicks: boundedTicks(Math.min(...points.map((point) => point.rating)), Math.max(...points.map((point) => point.rating)), 4),
  };
}

export function layoutCurveChart(points: readonly (PersonalRatingPoint & { rating: number })[], domain: CurveDomain = curveDomain(points)): CurveChartLayout {
  const { costTicks, ratingTicks } = domain;
  const costMax = costTicks.at(-1) ?? 1;
  const ratingMin = ratingTicks[0] ?? 950;
  const ratingMax = ratingTicks.at(-1) ?? 1050;
  const plotWidth = CURVE_CHART.width - CURVE_CHART.left - CURVE_CHART.right;
  const plotHeight = CURVE_CHART.height - CURVE_CHART.top - CURVE_CHART.bottom;
  const plotted = spreadCurveLabels(points.map((point) => ({
    ...point,
    x: CURVE_CHART.left + (point.meanCost / costMax) * plotWidth,
    y: CURVE_CHART.top + ((ratingMax - point.rating) / (ratingMax - ratingMin)) * plotHeight,
    labelY: 0,
  })));
  const frontier = plotted.filter((point) => point.frontier).sort((left, right) => left.x - right.x);
  return {
    costMax,
    costTicks,
    ratingMin,
    ratingMax,
    ratingTicks,
    plotted,
    frontierPath: frontier.length > 1 ? `M${frontier.map((point) => `${point.x.toFixed(1)} ${point.y.toFixed(1)}`).join('L')}` : null,
  };
}

export interface CurveChartLabels {
  /** Y axis title, e.g. "Your preference rating · higher is better →". */
  ratingAxisTitle: string;
  /** Screen-reader description of the whole plot. */
  chartDescription: string;
  /** Column and tooltip heading for the rating, e.g. "Preference". */
  ratingTerm: string;
}

export function CurveChartFigure({ layout, labels }: { layout: CurveChartLayout; labels: CurveChartLabels }) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const { costMax, ratingMin, ratingMax, costTicks, ratingTicks, plotted, frontierPath } = layout;
  const plotWidth = CURVE_CHART.width - CURVE_CHART.left - CURVE_CHART.right;
  const plotHeight = CURVE_CHART.height - CURVE_CHART.top - CURVE_CHART.bottom;
  const active = plotted.find((point) => point.configurationId === activeId) ?? null;

  return <div className="curve-chart-wrap">
    <svg className="curve-chart" viewBox={`0 0 ${CURVE_CHART.width} ${CURVE_CHART.height}`} role="img" aria-label={labels.chartDescription}>
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
        <text className="axis-title" x="17" y={CURVE_CHART.top + plotHeight / 2} textAnchor="middle" transform={`rotate(-90 17 ${CURVE_CHART.top + plotHeight / 2})`}>{labels.ratingAxisTitle}</text>
      </g>
      {frontierPath && <path className="frontier-line" d={frontierPath} />}
      <g className="curve-points">
        {plotted.map((point) => {
          const labelOnLeft = point.x > CURVE_CHART.width * .62;
          const labelX = point.x + (labelOnLeft ? -14 : 14);
          return <g key={point.configurationId} className={`curve-point${point.frontier ? ' frontier' : ''}${point.status === 'provisional' ? ' provisional' : ''}${activeId === point.configurationId ? ' active' : ''}`} tabIndex={0} role="button" aria-label={`${point.label}. Rating ${point.rating.toFixed(0)}. Mean cost $${point.meanCost.toFixed(2)}. ${evidenceText(point)}. Status: ${statusLabel(point.status)}.${point.frontier ? ' On the Pareto frontier.' : ''}`} onMouseEnter={() => setActiveId(point.configurationId)} onMouseLeave={() => setActiveId(null)} onFocus={() => setActiveId(point.configurationId)} onBlur={() => setActiveId(null)} onClick={() => setActiveId(activeId === point.configurationId ? null : point.configurationId)}>
            <line className="label-leader" x1={point.x} y1={point.y} x2={labelX + (labelOnLeft ? 4 : -4)} y2={point.labelY - 4} />
            <circle cx={point.x} cy={point.y} r={point.frontier ? 8 : 6} />
          </g>;
        })}
      </g>
      {/* Labels are drawn after every marker so a neighbouring point cannot
          paint over one. Points crowd together at the cheap end of the axis,
          where the labels are the only way to tell them apart. */}
      <g className="curve-labels">
        {plotted.map((point) => {
          const labelOnLeft = point.x > CURVE_CHART.width * .62;
          const labelX = point.x + (labelOnLeft ? -14 : 14);
          const qualifier = workflowQualifier(point.workflowName);
          const effort = effortSuffix(point.configurationId);
          return <text key={point.configurationId} className={`point-label${point.status === 'provisional' ? ' provisional' : ''}`} x={labelX} y={point.labelY} textAnchor={labelOnLeft ? 'end' : 'start'}><tspan>{effort ? `${point.modelName} ${effort}` : point.modelName}</tspan>{qualifier && <tspan x={labelX} dy="14">{qualifier}</tspan>}</text>;
        })}
      </g>
    </svg>
    {active && <div className={`curve-tooltip${active.x > CURVE_CHART.width * .62 ? ' align-right' : ''}`} style={{ left: `${active.x / CURVE_CHART.width * 100}%`, top: `${active.y / CURVE_CHART.height * 100}%` }} role="status">
      <strong>{effortSuffix(active.configurationId) ? `${active.modelName} ${effortSuffix(active.configurationId)}` : active.modelName}</strong>{workflowQualifier(active.workflowName) && <span>{workflowQualifier(active.workflowName)}</span>}
      <dl><div><dt>{labels.ratingTerm}</dt><dd>{active.rating.toFixed(0)}</dd></div><div><dt>Mean cost</dt><dd>${active.meanCost.toFixed(2)}</dd></div><div><dt>Evidence</dt><dd>{evidenceText(active)}</dd></div></dl>
      <p>{statusLabel(active.status)} · {placementText(active)}</p>
    </div>}
  </div>;
}

export function CurveLegend() {
  return <div className="curve-legend" aria-label="Chart legend"><span><i className="legend-point frontier" />Pareto frontier</span><span><i className="legend-point" />Other configuration</span><span><i className="legend-point provisional" />Too early to call</span><span className="best-direction">↖ Better value</span></div>;
}

export function CurveTable({ points, caption, ratingTerm }: { points: readonly PersonalRatingPoint[]; caption: string; ratingTerm: string }) {
  const ordered = [...points].sort((left, right) => (right.rating ?? -Infinity) - (left.rating ?? -Infinity) || left.configurationId.localeCompare(right.configurationId));
  const ratingRange = valueRange(ordered.flatMap((point) => (point.rating === undefined ? [] : [point.rating])));
  const costRange = valueRange(ordered.map((point) => point.meanCost));
  return <div className="curve-table-wrap"><table className="curve-table"><caption>{caption}</caption><thead><tr><th scope="col">Model</th><th scope="col">Matches</th><th scope="col">Record</th><th scope="col">{ratingTerm}</th><th scope="col">Mean cost</th><th scope="col">Status</th></tr></thead><tbody>{ordered.map((point) => {
    const record = point.comparisons === 0
      ? <span aria-label="No comparisons yet">—</span>
      : <span aria-label={recordAriaLabel(point)}><span className="record-wins">{point.wins}</span>–<span className="record-ties">{point.ties}</span>–<span className="record-losses">{point.losses}</span></span>;
    const effort = effortSuffix(point.configurationId);
    return <tr key={point.configurationId}><th scope="row"><strong>{effort ? `${point.modelName} ${effort}` : point.modelName}</strong><WorkflowQualifier workflowName={point.workflowName} /></th><td>{point.comparisons}</td><td className="record-cell">{record}</td><td style={point.rating === undefined ? undefined : { color: rampColor('--value-high', ratingRange(point.rating)) }}>{point.rating === undefined ? '—' : point.rating.toFixed(0)}</td><td style={{ color: rampColor('--value-costly', costRange(point.meanCost)) }}>${point.meanCost.toFixed(2)}</td><td className={point.frontier ? 'frontier-status' : ''}>{point.frontier ? 'Frontier' : statusLabel(point.status)}</td></tr>;
  })}</tbody></table></div>;
}

/** Position a value takes in its column, as 0 (lowest in the table) to 1
 * (highest). A column whose values are all equal reads as neutral rather than
 * uniformly hot: nothing in it stands out from anything else. */
function valueRange(values: readonly number[]): (value: number) => number {
  const low = Math.min(...values);
  const high = Math.max(...values);
  if (!Number.isFinite(low) || !Number.isFinite(high) || high === low) return () => 0;
  return (value) => (value - low) / (high - low);
}

/** Tint a figure toward its column's colour by how far up the column it sits,
 * leaving the low end at ordinary body text so only the extremes carry weight. */
function rampColor(token: string, position: number): string {
  return `color-mix(in oklab, var(${token}) ${Math.round(15 + 75 * position)}%, var(--body-text))`;
}

const BUDGET_EXPLAINER = 'This entrant was told how much of its budget it had spent as it worked. If it submitted a level having used less than 75%, it was sent back to keep improving it.';

/** The workflow half of a configuration label, with a hover explainer when the
 *  workflow is one of the budgeted ones. The bubble is fixed-positioned so the
 *  scrollable table wrapper can't clip it. */
function WorkflowQualifier({ workflowName }: { workflowName: string }) {
  const trigger = useRef<HTMLSpanElement>(null);
  const [anchor, setAnchor] = useState<{ left: number; top: number } | null>(null);
  const qualifier = workflowQualifier(workflowName);
  if (!qualifier) return null;
  if (!/budget/i.test(qualifier)) return <span>{qualifier}</span>;
  const show = () => {
    const box = trigger.current?.getBoundingClientRect();
    if (box) setAnchor({ left: Math.min(box.left, window.innerWidth - 300), top: box.bottom + 8 });
  };
  return <span ref={trigger} className="has-explainer" tabIndex={0} onMouseEnter={show} onMouseLeave={() => setAnchor(null)} onFocus={show} onBlur={() => setAnchor(null)}>
    {qualifier}
    {anchor && <span className="explainer-bubble" role="tooltip" style={{ left: `${anchor.left}px`, top: `${anchor.top}px` }}>{BUDGET_EXPLAINER}</span>}
  </span>;
}

export function statusLabel(status: PersonalRatingPoint['status']): string {
  return status === 'pending' ? 'Needs matchups' : status === 'provisional' ? 'Too early to call' : 'Ranked';
}

/** How much evidence a configuration's rating rests on. Provisional points name
 * the bar they have to clear, so it is clear whether more voting will settle
 * them or the configuration simply needs to run on more themes. */
export function evidenceText(point: Pick<PersonalRatingPoint, 'comparisons' | 'comparisonsRequired' | 'status'>): string {
  const plural = point.comparisons === 1 ? '' : 's';
  return point.status === 'provisional'
    ? `${point.comparisons} of ${point.comparisonsRequired} comparison${point.comparisonsRequired === 1 ? '' : 's'}`
    : `${point.comparisons} comparison${plural}`;
}

function placementText(point: Pick<PersonalRatingPoint, 'status' | 'frontier'>): string {
  if (point.status === 'provisional') return 'Held off the frontier until it has been compared as often as the rest';
  return point.frontier ? 'On the Pareto frontier' : 'Dominated by a higher-value option';
}

function recordAriaLabel(point: PersonalRatingPoint): string {
  const count = (value: number, singular: string, plural: string) => `${value} ${value === 1 ? singular : plural}`;
  return `${count(point.wins, 'win', 'wins')}, ${count(point.ties, 'tie', 'ties')}, ${count(point.losses, 'loss', 'losses')}`;
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
