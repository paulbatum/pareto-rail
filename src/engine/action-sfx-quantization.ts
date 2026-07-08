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

// The game's default quantization profile. Levels can override or opt out via
// the runner's timing field.
const shotDelaySettings: ShotDelaySettings = {
  gapThirtyseconds: 2,
  releaseShare: 0.75,
  pattern: 'grid-ramp',
  gridRampGapGrowthThirtyseconds: 2,
  maxGridSeconds: DEFAULT_MAX_GRID_SECONDS,
};

const settings: ActionSfxQuantizationSettings = {
  enabled: true,
  gridThirtyseconds: DEFAULT_GRID_THIRTYSECONDS,
};

export function getShotDelaySettings() {
  return { ...shotDelaySettings };
}

export function setShotDelaySettings(next: Partial<ShotDelaySettings>) {
  if (next.gapThirtyseconds !== undefined) shotDelaySettings.gapThirtyseconds = Math.max(0, Math.round(next.gapThirtyseconds));
  if (next.releaseShare !== undefined) shotDelaySettings.releaseShare = Math.min(1, Math.max(0, next.releaseShare));
  if (next.pattern !== undefined) shotDelaySettings.pattern = next.pattern;
  if (next.gridRampGapGrowthThirtyseconds !== undefined) {
    shotDelaySettings.gridRampGapGrowthThirtyseconds = Math.max(0, Math.round(next.gridRampGapGrowthThirtyseconds));
  }
  if (next.maxGridSeconds !== undefined) {
    shotDelaySettings.maxGridSeconds = Math.max(0.01, next.maxGridSeconds);
  }
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

export function getActionSfxQuantization() {
  return { ...settings };
}

export function setActionSfxQuantization(next: Partial<ActionSfxQuantizationSettings>) {
  if (next.enabled !== undefined) settings.enabled = next.enabled;
  if (next.gridThirtyseconds !== undefined) settings.gridThirtyseconds = Math.max(1, Math.round(next.gridThirtyseconds));
}

export function quantizeActionSfxTime(time: number, thirtysecondSeconds: number) {
  if (!settings.enabled) return time;
  const gridSeconds = thirtysecondSeconds * settings.gridThirtyseconds;
  return quantizeToGrid(time, gridSeconds);
}
