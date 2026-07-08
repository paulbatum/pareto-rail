import { MathUtils } from 'three';
import type { CatmullRomCurve3 } from 'three';

export type RailPacePhase = 'enter' | 'hold' | 'exit' | 'done';

export type RailPacingResolved = {
  /** Distance ahead of the camera where the target first appears, usually near the fog edge. */
  spawnAheadUnits: number;
  /** Distance ahead of the camera held for the authored readable window. */
  engageAheadUnits: number;
  /** Seconds spent easing from spawnAheadUnits to engageAheadUnits. */
  enterSeconds: number;
  /** Seconds the target must pace the camera at engageAheadUnits. */
  readableFor: number;
  /** Seconds spent breaking away after the hold. */
  exitSeconds: number;
  /** Distance ahead of the camera reached at the end of the exit. Defaults to spawnAheadUnits. */
  exitAheadUnits: number;
};

export type RailPacingOverrides = Partial<RailPacingResolved>;

export type RailPacerOptions = {
  curve: CatmullRomCurve3;
  duration: number;
  runProgress(time: number, duration: number): number;
  defaults: Omit<RailPacingResolved, 'exitAheadUnits'> & { exitAheadUnits?: number };
};

export type RailPaceSample = RailPacingResolved & {
  anchorU: number;
  unclampedAnchorU: number;
  distanceAheadUnits: number;
  phase: RailPacePhase;
  phaseProgress: number;
  holdStartTime: number;
  holdEndTime: number;
  exitCompleteTime: number;
  done: boolean;
};

export type RailPacer = ReturnType<typeof createRailPacer>;

export function createRailPacer(options: RailPacerOptions) {
  const railLength = options.curve.getLength();
  if (!Number.isFinite(railLength) || railLength <= 0) throw new Error('createRailPacer requires a rail with positive length');
  if (!Number.isFinite(options.duration) || options.duration <= 0) throw new Error('createRailPacer duration must be positive');
  const defaults = resolveRailPacing(options.defaults);

  function resolve(overrides?: RailPacingOverrides): RailPacingResolved {
    return resolveRailPacing({ ...defaults, ...overrides });
  }

  function sample(entryTime: number, runTime: number, overrides?: RailPacingOverrides): RailPaceSample {
    const pacing = resolve(overrides);
    const age = Math.max(0, runTime - entryTime);
    const holdStartTime = entryTime + pacing.enterSeconds;
    const holdEndTime = holdStartTime + pacing.readableFor;
    const exitCompleteTime = holdEndTime + pacing.exitSeconds;
    const baseU = options.runProgress(runTime, options.duration);

    let phase: RailPacePhase;
    let phaseProgress = 0;
    let distanceAheadUnits = pacing.engageAheadUnits;

    if (age < pacing.enterSeconds) {
      phase = 'enter';
      phaseProgress = progress(age, pacing.enterSeconds);
      distanceAheadUnits = lerp(pacing.spawnAheadUnits, pacing.engageAheadUnits, easeOutCubic(phaseProgress));
    } else if (runTime < holdEndTime) {
      phase = 'hold';
      phaseProgress = progress(runTime - holdStartTime, pacing.readableFor);
      distanceAheadUnits = pacing.engageAheadUnits;
    } else if (runTime < exitCompleteTime) {
      phase = 'exit';
      phaseProgress = progress(runTime - holdEndTime, pacing.exitSeconds);
      distanceAheadUnits = lerp(pacing.engageAheadUnits, pacing.exitAheadUnits, easeInCubic(phaseProgress));
    } else {
      phase = 'done';
      phaseProgress = 1;
      distanceAheadUnits = pacing.exitAheadUnits;
    }

    const unclampedAnchorU = baseU + distanceAheadUnits / railLength;
    return {
      ...pacing,
      anchorU: MathUtils.clamp(unclampedAnchorU, 0, 1),
      unclampedAnchorU,
      distanceAheadUnits,
      phase,
      phaseProgress,
      holdStartTime,
      holdEndTime,
      exitCompleteTime,
      done: runTime >= exitCompleteTime,
    };
  }

  function fitsBeforeRailEnd(entryTime: number, overrides?: RailPacingOverrides) {
    const pacing = resolve(overrides);
    const exitCompleteTime = entryTime + pacing.enterSeconds + pacing.readableFor + pacing.exitSeconds;
    const exitBaseU = options.runProgress(exitCompleteTime, options.duration);
    return exitBaseU + pacing.exitAheadUnits / railLength <= 1;
  }

  return { railLength, defaults, resolve, sample, fitsBeforeRailEnd };
}

export function resolveRailPacing(input: Omit<RailPacingResolved, 'exitAheadUnits'> & { exitAheadUnits?: number }): RailPacingResolved {
  const resolved = {
    ...input,
    exitAheadUnits: input.exitAheadUnits ?? input.engageAheadUnits,
  };
  for (const [key, value] of Object.entries(resolved)) {
    if (!Number.isFinite(value) || value < 0) throw new Error(`Rail pacing ${key} must be a non-negative number`);
  }
  return resolved;
}

function progress(value: number, duration: number) {
  if (duration <= 0) return 1;
  return MathUtils.clamp(value / duration, 0, 1);
}

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

function easeOutCubic(t: number) {
  return 1 - (1 - t) ** 3;
}

function easeInCubic(t: number) {
  return t ** 3;
}
