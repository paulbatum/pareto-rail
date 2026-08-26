import { useRef, useState } from 'react';
import type { PersonalRatingPoint } from '../../benchmark/personal-curve';
import { workflowQualifier } from '../../benchmark/identity';
import { CURVE_CHART, OUTPUT_TOKENS_AXIS, pointName, type CurveChartLayout } from './curve-layout';

export interface CurveChartLabels {
  /** Heading above the plot, e.g. "Quality vs cost". */
  title?: string;
  /** Y axis title, e.g. "Your preference rating". */
  ratingAxisTitle: string;
  /** Screen-reader description of the whole plot. */
  chartDescription: string;
  /** Column and tooltip heading for the rating, e.g. "Preference". */
  ratingTerm: string;
}

export function CurveChartFigure({ layout, labels }: { layout: CurveChartLayout; labels: CurveChartLabels }) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const { axis, xMax, ratingMin, ratingMax, xTicks, ratingTicks, plotted, frontierPath } = layout;
  const plotWidth = CURVE_CHART.width - CURVE_CHART.left - CURVE_CHART.right;
  const plotHeight = CURVE_CHART.height - CURVE_CHART.top - CURVE_CHART.bottom;
  const active = plotted.find((point) => point.configurationId === activeId) ?? null;

  const chart = <div className="curve-chart-wrap">
    <svg className="curve-chart" viewBox={`0 0 ${CURVE_CHART.width} ${CURVE_CHART.height}`} role="img" aria-label={labels.chartDescription}>
      <g className="chart-grid">
        {xTicks.map((tick) => {
          const x = CURVE_CHART.left + (tick / xMax) * plotWidth;
          return <g key={`x-${tick}`}><line x1={x} y1={CURVE_CHART.top} x2={x} y2={CURVE_CHART.top + plotHeight} /><text x={x} y={CURVE_CHART.top + plotHeight + 24} textAnchor="middle">{axis.formatTick(tick)}</text></g>;
        })}
        {ratingTicks.map((tick) => {
          const y = CURVE_CHART.top + ((ratingMax - tick) / (ratingMax - ratingMin)) * plotHeight;
          return <g key={`rating-${tick}`}><line x1={CURVE_CHART.left} y1={y} x2={CURVE_CHART.left + plotWidth} y2={y} /><text x={CURVE_CHART.left - 13} y={y + 4} textAnchor="end">{tick}</text></g>;
        })}
      </g>
      <g className="chart-axes">
        <line x1={CURVE_CHART.left} y1={CURVE_CHART.top + plotHeight} x2={CURVE_CHART.left + plotWidth} y2={CURVE_CHART.top + plotHeight} />
        <line x1={CURVE_CHART.left} y1={CURVE_CHART.top} x2={CURVE_CHART.left} y2={CURVE_CHART.top + plotHeight} />
        <text className="axis-title" x={CURVE_CHART.left + plotWidth / 2} y={CURVE_CHART.top + plotHeight + 42} textAnchor="middle">{axis.title}</text>
        <text className="axis-title" x="17" y={CURVE_CHART.top + plotHeight / 2} textAnchor="middle" transform={`rotate(-90 17 ${CURVE_CHART.top + plotHeight / 2})`}>{labels.ratingAxisTitle}</text>
      </g>
      {frontierPath && <path className="frontier-line" d={frontierPath} />}
      <g className="curve-points">
        {plotted.map((point) => {
          const labelX = point.x + (point.labelOnLeft ? -14 : 14);
          return <g key={point.configurationId} className={`curve-point${point.frontier ? ' frontier' : ''}${point.status === 'provisional' ? ' provisional' : ''}${activeId === point.configurationId ? ' active' : ''}`} tabIndex={0} role="button" aria-label={`${point.label}. Rating ${point.rating.toFixed(0)}. ${axis.title}: ${axis.formatValue(point.axisValue)}. ${evidenceText(point)}. Status: ${statusLabel(point.status)}.${point.frontier ? ' On the Pareto frontier.' : ''}`} onMouseEnter={() => setActiveId(point.configurationId)} onMouseLeave={() => setActiveId(null)} onFocus={() => setActiveId(point.configurationId)} onBlur={() => setActiveId(null)} onClick={() => setActiveId(activeId === point.configurationId ? null : point.configurationId)}>
            <line className="label-leader" x1={point.x} y1={point.y} x2={labelX + (point.labelOnLeft ? 4 : -4)} y2={point.labelY - 4} />
            <circle cx={point.x} cy={point.y} r={point.frontier ? 8 : 6} />
          </g>;
        })}
      </g>
      {/* Labels are drawn after every marker so a neighbouring point cannot
          paint over one. Points crowd together at the cheap end of the axis,
          where the labels are the only way to tell them apart. */}
      <g className="curve-labels">
        {plotted.map((point) => {
          const labelX = point.x + (point.labelOnLeft ? -14 : 14);
          const qualifier = workflowQualifier(point.workflowName);
          return <text key={point.configurationId} className={`point-label${point.status === 'provisional' ? ' provisional' : ''}`} x={labelX} y={point.labelY} textAnchor={point.labelOnLeft ? 'end' : 'start'}><tspan>{pointName(point)}</tspan>{qualifier && <tspan x={labelX} dy="10">{qualifier}</tspan>}</text>;
        })}
      </g>
    </svg>
    {active && <div className={`curve-tooltip${active.x > CURVE_CHART.width * .62 ? ' align-right' : ''}`} style={{ left: `${active.x / CURVE_CHART.width * 100}%`, top: `${active.y / CURVE_CHART.height * 100}%` }} role="status">
      <strong>{pointName(active)}</strong>{workflowQualifier(active.workflowName) && <span>{workflowQualifier(active.workflowName)}</span>}
      <dl><div><dt>{labels.ratingTerm}</dt><dd>{active.rating.toFixed(0)}</dd></div><div><dt>Mean cost</dt><dd>{active.meanCost === undefined ? 'Not priced' : `$${active.meanCost.toFixed(2)}`}</dd></div><div><dt>Mean output</dt><dd>{OUTPUT_TOKENS_AXIS.formatValue(active.meanOutputTokens)}</dd></div><div><dt>Evidence</dt><dd>{evidenceText(active)}</dd></div></dl>
      <p>{statusLabel(active.status)} · {placementText(active)}</p>
    </div>}
  </div>;

  // The note is inside the figure so a screen reader reaching the plot also
  // reaches what the plot left out; the plot's own aria-label cannot carry it,
  // because the omitted points are not in the image it describes.
  const omissionNote = layout.omittedLabels.length > 0
    ? <p className="curve-omission">{axis.describeOmitted(layout.omittedLabels)}</p>
    : null;
  if (!labels.title) return omissionNote ? <figure className="curve-figure">{chart}{omissionNote}</figure> : chart;
  return <figure className="curve-figure"><figcaption className="chart-title">{labels.title}</figcaption>{chart}{omissionNote}</figure>;
}

export function CurveLegend() {
  return <div className="curve-legend" aria-label="Chart legend"><span><i className="legend-point frontier" />Pareto frontier</span><span><i className="legend-point" />Other configuration</span><span><i className="legend-point provisional" />Too early to call</span><span className="best-direction">↖ Better value</span></div>;
}

export function CurveTable({ points, caption, ratingTerm }: { points: readonly PersonalRatingPoint[]; caption: string; ratingTerm: string }) {
  const ordered = [...points].sort((left, right) => (right.rating ?? -Infinity) - (left.rating ?? -Infinity) || left.configurationId.localeCompare(right.configurationId));
  const ratingRange = valueRange(ordered.flatMap((point) => (point.rating === undefined ? [] : [point.rating])));
  const costRange = valueRange(ordered.flatMap((point) => (point.meanCost === undefined ? [] : [point.meanCost])));
  const tokenRange = valueRange(ordered.map((point) => point.meanOutputTokens));
  return <div className="curve-table-wrap"><table className="curve-table"><caption>{caption}</caption><thead><tr><th scope="col">Model</th><th scope="col">Matches</th><th scope="col">Record</th><th scope="col">{ratingTerm}</th><th scope="col">Mean cost</th><th scope="col">Mean output tokens</th><th scope="col">Status</th></tr></thead><tbody>{ordered.map((point) => {
    const record = point.comparisons === 0
      ? <span aria-label="No comparisons yet">—</span>
      : <span aria-label={recordAriaLabel(point)}><span className="record-wins">{point.wins}</span>–<span className="record-ties">{point.ties}</span>–<span className="record-losses">{point.losses}</span></span>;
    return <tr key={point.configurationId}><th scope="row"><strong>{pointName(point)}</strong><WorkflowQualifier workflowName={point.workflowName} /></th><td>{point.comparisons}</td><td className="record-cell">{record}</td><td style={point.rating === undefined ? undefined : { color: rampColor('--value-high', ratingRange(point.rating)) }}>{point.rating === undefined ? '—' : point.rating.toFixed(0)}</td><td style={point.meanCost === undefined ? undefined : { color: rampColor('--value-costly', costRange(point.meanCost)) }}>{point.meanCost === undefined ? '—' : `$${point.meanCost.toFixed(2)}`}</td><td style={{ color: rampColor('--value-costly', tokenRange(point.meanOutputTokens)) }}>{OUTPUT_TOKENS_AXIS.formatValue(point.meanOutputTokens)}</td><td className={point.frontier ? 'frontier-status' : ''}>{point.frontier ? 'Frontier' : statusLabel(point.status)}</td></tr>;
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

