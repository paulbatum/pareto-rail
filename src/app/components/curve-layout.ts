/* The chart's geometry and axes, separated from the React rendering in
 * `curve-chart.tsx` so the layout can be verified without a browser. */
import { paretoFrontier, type PersonalCurve, type PersonalRatingPoint } from '../../benchmark/personal-curve';
import { configurationGroupEfforts, workflowQualifier } from '../../benchmark/identity';
import { rankCatalog } from '../../benchmark/catalog';

export const CURVE_CHART = { width: 720, height: 378, left: 72, right: 24, top: 22, bottom: 56 } as const;

/** The quantity a chart places its points on the horizontal axis by. Both charts
 * share the rating axis, so the axis is the only difference between them. */
export interface CurveAxis {
  id: string;
  /** The point's position on this axis, or undefined when it has none and the
   * chart leaves it out. */
  value: (point: PersonalRatingPoint) => number | undefined;
  /** Axis title drawn under the plot. */
  title: string;
  /** Tick label, e.g. `$12` or `240k`. */
  formatTick: (value: number) => string;
  /** Tooltip and table figure, e.g. `$12.40` or `239,120`. */
  formatValue: (value: number) => string;
  /** Note printed under the plot naming the points this axis left out and why. */
  describeOmitted: (labels: readonly string[]) => string;
}

export const COST_AXIS: CurveAxis = {
  id: 'cost',
  value: (point) => point.meanCost,
  title: 'Measured generation cost (USD)',
  formatTick: (value) => `$${formatCostTick(value)}`,
  formatValue: (value) => `$${value.toFixed(2)}`,
  describeOmitted: (labels) => `Not shown: ${listLabels(labels)} — published without a price.`,
};

export const OUTPUT_TOKENS_AXIS: CurveAxis = {
  id: 'output-tokens',
  value: (point) => point.meanOutputTokens,
  title: 'Mean output tokens',
  formatTick: formatTokenTick,
  formatValue: (value) => Math.round(value).toLocaleString('en-US'),
  describeOmitted: (labels) => `Not shown: ${listLabels(labels)} — no output token count recorded.`,
};

export type PlottedCurvePoint = PersonalRatingPoint & {
  rating: number;
  /** The point's value on the axis it was placed by. */
  axisValue: number;
  x: number;
  y: number;
  labelY: number;
  /** True when the label is drawn to the left of its marker, so it does not run
   * off the right edge of the plot. */
  labelOnLeft: boolean;
};

/** Everything the chart is drawn from: axis domains, placed points, and the
 * frontier path. Kept separate from the rendering so the rank page's debug
 * export can describe exactly what was drawn. */
export interface CurveChartLayout {
  axis: CurveAxis;
  xMax: number;
  xTicks: readonly number[];
  ratingMin: number;
  ratingMax: number;
  ratingTicks: readonly number[];
  plotted: readonly PlottedCurvePoint[];
  frontierPath: string | null;
  /** Names of the rated points this axis had no value for, so the figure can say
   * which entrants it left out. */
  omittedLabels: readonly string[];
}

// A point is keyed by its rating group, and a chart shown from a fixture catalog
// is keyed by configuration id, so both resolve here.
const configurationEfforts = new Map([
  ...(rankCatalog.configurations ?? []).map((configuration) => [configuration.id, configuration.effort] as const),
  ...configurationGroupEfforts(rankCatalog.configurations),
]);

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
  xTicks: readonly number[];
  ratingTicks: readonly number[];
}

export function curveDomain(points: readonly (PersonalRatingPoint & { rating: number })[], axis: CurveAxis = COST_AXIS): CurveDomain {
  const placed = pointsOnAxis(points, axis);
  return {
    xTicks: ticksFromZero(Math.max(...placed.map((point) => point.axisValue), 1), 4),
    ratingTicks: boundedTicks(Math.min(...placed.map((point) => point.rating)), Math.max(...placed.map((point) => point.rating)), 4),
  };
}

/** The points this axis can place, each with its axis value resolved. A point the
 * axis has no value for is left out of the domain, the plot, and the frontier. */
function pointsOnAxis<T extends PersonalRatingPoint & { rating: number }>(points: readonly T[], axis: CurveAxis): (T & { axisValue: number })[] {
  return points.flatMap((point) => {
    const axisValue = axis.value(point);
    return axisValue === undefined ? [] : [{ ...point, axisValue }];
  });
}

/** The name a point is drawn and named by: its model, with the reasoning effort
 * its configuration ran at. */
export function pointName(point: Pick<PersonalRatingPoint, 'modelName' | 'configurationId'>): string {
  const effort = effortSuffix(point.configurationId);
  return effort ? `${point.modelName} ${effort}` : point.modelName;
}

function listLabels(labels: readonly string[]): string {
  if (labels.length <= 1) return labels[0] ?? '';
  return `${labels.slice(0, -1).join(', ')} and ${labels.at(-1)}`;
}

export function layoutCurveChart(
  points: readonly (PersonalRatingPoint & { rating: number })[],
  axis: CurveAxis = COST_AXIS,
  domain: CurveDomain = curveDomain(points, axis),
): CurveChartLayout {
  const { xTicks, ratingTicks } = domain;
  const placed = pointsOnAxis(points, axis);
  const omittedLabels = points.filter((point) => axis.value(point) === undefined).map(pointName);
  const xMax = xTicks.at(-1) ?? 1;
  const ratingMin = ratingTicks[0] ?? 950;
  const ratingMax = ratingTicks.at(-1) ?? 1050;
  const plotWidth = CURVE_CHART.width - CURVE_CHART.left - CURVE_CHART.right;
  const plotHeight = CURVE_CHART.height - CURVE_CHART.top - CURVE_CHART.bottom;
  // The frontier is drawn for the axis in view: a configuration that wins on cost
  // need not win on tokens. Both charts draw it through established points only,
  // the same rule the curve fit applies.
  const frontierIds = new Set(paretoFrontier(placed
    .filter((point) => point.status === 'established')
    .map((point) => ({ configurationId: point.configurationId, meanCost: point.axisValue, rating: point.rating })))
    .map((point) => point.configurationId));
  const plotted = spreadCurveLabels(placed.map((point) => {
    const x = CURVE_CHART.left + (point.axisValue / xMax) * plotWidth;
    return {
      ...point,
      frontier: frontierIds.has(point.configurationId),
      x,
      y: CURVE_CHART.top + ((ratingMax - point.rating) / (ratingMax - ratingMin)) * plotHeight,
      labelY: 0,
      labelOnLeft: x > CURVE_CHART.width * LABEL_LEFT_FRACTION,
    };
  }));
  const frontier = plotted.filter((point) => point.frontier).sort((left, right) => left.x - right.x);
  return {
    axis,
    xMax,
    xTicks,
    ratingMin,
    ratingMax,
    ratingTicks,
    plotted,
    frontierPath: frontier.length > 1 ? `M${frontier.map((point) => `${point.x.toFixed(1)} ${point.y.toFixed(1)}`).join('L')}` : null,
    omittedLabels,
  };
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

function formatTokenTick(value: number): string {
  if (value === 0) return '0';
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(value % 1_000_000 === 0 ? 0 : 1)}M`;
  if (value >= 1000) return `${(value / 1000).toFixed(value % 1000 === 0 ? 0 : 1)}k`;
  return value.toFixed(0);
}

/** Points past this fraction of the chart width get their label to the left of
 * the marker, so the text stays inside the plot. */
const LABEL_LEFT_FRACTION = .62;

/** How far the top of a label's first line sits above its baseline. */
const LABEL_ASCENT = 7;

/** Vertical room one label needs, in chart units: a name line, plus the workflow
 * line when the point has one. */
function labelHeight(point: Pick<PersonalRatingPoint, 'workflowName'>): number {
  return workflowQualifier(point.workflowName) ? 21 : 12;
}

/** Move each label off its marker until no two labels on the same side of the
 * plot overlap, and keep every label inside the plot.
 *
 * The two sides are spread independently, because a label anchored to the left
 * of its marker and one anchored to the right cannot collide. Each side is
 * placed top down, pushing a label below the one above it, then pushed back up
 * from the bottom edge. When a side holds more labels than the plot has room
 * for, the push-up pass runs out of room and the topmost labels stack at the top
 * edge rather than escaping the plot. */
function spreadCurveLabels<T extends PlottedCurvePoint>(points: T[]): T[] {
  const top = CURVE_CHART.top;
  const bottom = CURVE_CHART.height - CURVE_CHART.bottom;
  for (const side of [true, false]) {
    const ordered = points.filter((point) => point.labelOnLeft === side).sort((a, b) => a.y - b.y);
    let lowest = top;
    for (const point of ordered) {
      point.labelY = Math.max(point.y - 4, lowest + LABEL_ASCENT);
      lowest = point.labelY + labelHeight(point) - LABEL_ASCENT;
    }
    let highest = bottom;
    for (const point of [...ordered].reverse()) {
      point.labelY = Math.min(point.labelY, highest - labelHeight(point) + LABEL_ASCENT);
      highest = point.labelY - LABEL_ASCENT;
    }
  }
  return points;
}
