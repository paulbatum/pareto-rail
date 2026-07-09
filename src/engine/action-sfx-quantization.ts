import { quantizeToGrid } from './music';

export type ShotDelayPattern = 'linear' | 'grid-ramp';

export type ShotDelaySettings = {
  /** Delay unit used by the linear pattern, measured in 32nd notes. */
  gapThirtyseconds: number;
  /** 0 = all delay is travel time; 1 = all delay is before launch. */
  releaseShare: number;
  pattern: ShotDelayPattern;
  /** Grid-ramp minimum growth between consecutive shot gaps, measured in 32nd notes. */
  gridRampGapGrowthThirtyseconds: number;
  /**
   * Longest acceptable snap period for any shot, in seconds. Deliberately
   * absolute rather than musical: how much delay a level can absorb depends on
   * its pace, not its tempo (a tempo-relative cap would cancel out against the
   * tempo-relative ramp and never trim anything). Fast levels should lower it.
   */
  maxGridSeconds: number;
};

export type ShotDelayContext = {
  index: number;
  volleySize: number;
  releaseTime: number;
  baselineTravelTime: number;
  baselineTravelTimes: number[];
  thirtysecondSeconds: number;
};

export type ActionSfxQuantizationSettings = {
  enabled: boolean;
  /** Grid size measured in 32nd notes. */
  gridThirtyseconds: number;
};

const DEFAULT_GRID_THIRTYSECONDS = 1; // 32nd note
const GRID_RAMP_THIRTYSECONDS = [1, 2, 4, 8, 16, 32, 32, 32];
// Default maxGridSeconds: the bar grid at 126 BPM (crystal's original tuning).
const DEFAULT_MAX_GRID_SECONDS = 1.905;

// Immutable baselines for reports/tools. Runtime settings below are mutable.
export const DEFAULT_SHOT_DELAY_SETTINGS = {
  gapThirtyseconds: 2,
  releaseShare: 0.75,
  pattern: 'grid-ramp',
  gridRampGapGrowthThirtyseconds: 2,
  maxGridSeconds: DEFAULT_MAX_GRID_SECONDS,
} as const satisfies ShotDelaySettings;

export const DEFAULT_ACTION_SFX_QUANTIZATION = {
  enabled: true,
  gridThirtyseconds: DEFAULT_GRID_THIRTYSECONDS,
} as const satisfies ActionSfxQuantizationSettings;

// The game's default quantization profile. Levels can override or opt out via
// the runner's timing field.
const shotDelaySettings: ShotDelaySettings = { ...DEFAULT_SHOT_DELAY_SETTINGS };

const settings: ActionSfxQuantizationSettings = { ...DEFAULT_ACTION_SFX_QUANTIZATION };

export function resolveShotDelaySettings(next: Partial<ShotDelaySettings> = {}): ShotDelaySettings {
  return {
    gapThirtyseconds: next.gapThirtyseconds === undefined
      ? DEFAULT_SHOT_DELAY_SETTINGS.gapThirtyseconds
      : Math.max(0, Math.round(next.gapThirtyseconds)),
    releaseShare: next.releaseShare === undefined
      ? DEFAULT_SHOT_DELAY_SETTINGS.releaseShare
      : Math.min(1, Math.max(0, next.releaseShare)),
    pattern: next.pattern ?? DEFAULT_SHOT_DELAY_SETTINGS.pattern,
    gridRampGapGrowthThirtyseconds: next.gridRampGapGrowthThirtyseconds === undefined
      ? DEFAULT_SHOT_DELAY_SETTINGS.gridRampGapGrowthThirtyseconds
      : Math.max(0, Math.round(next.gridRampGapGrowthThirtyseconds)),
    maxGridSeconds: next.maxGridSeconds === undefined
      ? DEFAULT_SHOT_DELAY_SETTINGS.maxGridSeconds
      : Math.max(0.01, next.maxGridSeconds),
  };
}

export function getShotDelaySettings() {
  return { ...shotDelaySettings };
}

export function setShotDelaySettings(next: Partial<ShotDelaySettings>) {
  Object.assign(shotDelaySettings, resolveShotDelaySettings({ ...shotDelaySettings, ...next }));
}

export function shotDelayForIndex(context: ShotDelayContext) {
  const totalDelay = totalDelayForShot(context);
  return {
    releaseDelay: totalDelay * shotDelaySettings.releaseShare,
    travelDelay: totalDelay * (1 - shotDelaySettings.releaseShare),
  };
}

function totalDelayForShot(context: ShotDelayContext) {
  if (shotDelaySettings.pattern === 'grid-ramp' && context.volleySize > 1) return gridRampDelayForShot(context);
  return delayStepForIndex(Math.max(0, context.index)) * shotDelaySettings.gapThirtyseconds * context.thirtysecondSeconds;
}

/**
 * Volley impact timing composes two deliberately separate rules:
 *
 * 1. Grid ramp (`rawGridRampHitTimes`): each shot's natural arrival is
 *    ceil-snapped — never earlier — to a per-index grid that coarsens
 *    (32nd, 16th, ... bar), so later shots land on progressively stronger
 *    beats.
 * 2. Gap floor (`enforceIncreasingGaps`): consecutive impacts must fan out,
 *    each gap at least the previous gap plus a growth term. The grids are
 *    nested, so without this a release just before a strong beat clumps
 *    several shots onto the same line.
 *
 * The floor pushes by raw offsets, which lands a pushed hit off its own
 * coarse grid — but every quantity here is a 32nd-note multiple, so pushed
 * hits stay on the 32nd lattice: strong-beat placement degrades to
 * weak-beat placement, never off the music. That degradation is
 * load-bearing. Re-snapping floored hits to their own coarse grid (the
 * "clean" unification) lets each snap-up widen the next required gap and
 * roughly triples the resolution time of a clumped volley, such as a
 * six-lock word release.
 */
function gridRampDelayForShot(context: ShotDelayContext) {
  const hitTimes = rawGridRampHitTimes(context);
  enforceIncreasingGaps(
    hitTimes,
    context.thirtysecondSeconds,
    shotDelaySettings.gridRampGapGrowthThirtyseconds * context.thirtysecondSeconds,
  );
  const hitTime = hitTimes[context.index] ?? context.releaseTime + context.baselineTravelTime;
  return Math.max(0, hitTime - context.releaseTime - context.baselineTravelTime);
}

function rawGridRampHitTimes(context: ShotDelayContext) {
  const times: number[] = [];
  const ramp = gridRampForTempo(context.thirtysecondSeconds);
  for (let index = 0; index < context.volleySize; index += 1) {
    const travelTime = context.baselineTravelTimes[index] ?? context.baselineTravelTime;
    const gridThirtyseconds = ramp[Math.min(index, ramp.length - 1)] ?? 32;
    const gridSeconds = gridThirtyseconds * context.thirtysecondSeconds;
    times.push(quantizeToGrid(context.releaseTime + travelTime, gridSeconds));
  }
  return times;
}

function gridRampForTempo(thirtysecondSeconds: number) {
  let ramp = [...GRID_RAMP_THIRTYSECONDS];
  while (ramp[ramp.length - 1] * thirtysecondSeconds > shotDelaySettings.maxGridSeconds) {
    if (ramp.every((gridThirtyseconds) => gridThirtyseconds === 1)) break;
    ramp = [1, ...ramp.slice(0, -1)];
  }
  return ramp;
}

function enforceIncreasingGaps(hitTimes: number[], minSpacing: number, gapGrowth: number) {
  let previousGap = 0;
  for (let index = 1; index < hitTimes.length; index += 1) {
    const requiredGap = index === 1 ? minSpacing : previousGap + gapGrowth;
    const earliest = hitTimes[index - 1] + requiredGap;
    if (hitTimes[index] < earliest) hitTimes[index] = earliest;
    previousGap = hitTimes[index] - hitTimes[index - 1];
  }
}

function delayStepForIndex(index: number) {
  return index;
}

export function resolveActionSfxQuantization(next: Partial<ActionSfxQuantizationSettings> = {}): ActionSfxQuantizationSettings {
  return {
    enabled: next.enabled ?? DEFAULT_ACTION_SFX_QUANTIZATION.enabled,
    gridThirtyseconds: next.gridThirtyseconds === undefined
      ? DEFAULT_ACTION_SFX_QUANTIZATION.gridThirtyseconds
      : Math.max(1, Math.round(next.gridThirtyseconds)),
  };
}

export function getActionSfxQuantization() {
  return { ...settings };
}

export function setActionSfxQuantization(next: Partial<ActionSfxQuantizationSettings>) {
  Object.assign(settings, resolveActionSfxQuantization({ ...settings, ...next }));
}

export function quantizeActionSfxTime(time: number, thirtysecondSeconds: number) {
  if (!settings.enabled) return time;
  const gridSeconds = thirtysecondSeconds * settings.gridThirtyseconds;
  return quantizeToGrid(time, gridSeconds);
}
