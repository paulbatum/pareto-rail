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

// The game's default quantization profile. Levels can override or opt out via
// the runner's timing field.
const shotDelaySettings: ShotDelaySettings = {
  gapThirtyseconds: 2,
  releaseShare: 0.75,
  pattern: 'grid-ramp',
  gridRampGapGrowthThirtyseconds: 2,
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
  for (let index = 0; index < context.volleySize; index += 1) {
    const travelTime = context.baselineTravelTimes[index] ?? context.baselineTravelTime;
    const gridThirtyseconds = GRID_RAMP_THIRTYSECONDS[Math.min(index, GRID_RAMP_THIRTYSECONDS.length - 1)] ?? 32;
    const gridSeconds = gridThirtyseconds * context.thirtysecondSeconds;
    times.push(quantizeToGrid(context.releaseTime + travelTime, gridSeconds));
  }
  return times;
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
