import { MathUtils } from 'three';
import type { CatmullRomCurve3 } from 'three';

/**
 * Rail pacing generalizes the fixed-anchor lead used by slower levels. A lead
 * keeps its `railAnchor(lead)` meaning — the camera overtakes the target
 * `leadSeconds` after it spawns — but when the camera would cover more ground
 * during the lead than the level can show (the fog budget, `spawnAheadUnits`),
 * the target's distance-ahead profile is scaled down so it spawns exactly at
 * the visibility edge and closes on the camera proportionally. The overtake
 * time is unchanged, so the on-screen window is the lead by construction.
 * When the fixed anchor already fits inside the budget the scale is 1 and the
 * result is identical to `railAnchor(lead)`.
 */

export type RailLead = {
  /** Authored seconds between spawn and the camera overtaking the target. */
  leadSeconds: number;
  /** Absolute run time of the overtake, clamped to the run duration. */
  passTime: number;
  /** Seconds the target is expected to be on screen: passTime minus spawn time. */
  windowSeconds: number;
};

export type RailPacerOptions = {
  curve: CatmullRomCurve3;
  duration: number;
  runProgress(time: number, duration: number): number;
  /** Distance ahead of the camera where a target first becomes visible, usually just inside the fog wall. */
  spawnAheadUnits: number;
  /** Lead applied when a spawn does not author its own. */
  defaultLeadSeconds: number;
};

export type RailPaceSample = {
  anchorU: number;
  unclampedAnchorU: number;
  distanceAheadUnits: number;
  /** 1 when the target behaves as a fixed rail anchor; below 1 the profile is compressed to fit the fog budget. */
  scale: number;
  passTime: number;
  windowSeconds: number;
};

export type RailPacer = ReturnType<typeof createRailPacer>;

export function createRailPacer(options: RailPacerOptions) {
  const railLength = options.curve.getLength();
  if (!Number.isFinite(railLength) || railLength <= 0) throw new Error('createRailPacer requires a rail with positive length');
  if (!Number.isFinite(options.duration) || options.duration <= 0) throw new Error('createRailPacer duration must be positive');
  if (!Number.isFinite(options.spawnAheadUnits) || options.spawnAheadUnits <= 0) throw new Error('createRailPacer spawnAheadUnits must be positive');
  if (!Number.isFinite(options.defaultLeadSeconds) || options.defaultLeadSeconds <= 0) throw new Error('createRailPacer defaultLeadSeconds must be positive');

  function resolve(entryTime: number, leadSeconds = options.defaultLeadSeconds): RailLead {
    if (!Number.isFinite(leadSeconds) || leadSeconds <= 0) throw new Error('Rail pacing leadSeconds must be positive');
    const passTime = Math.min(entryTime + leadSeconds, options.duration);
    return { leadSeconds, passTime, windowSeconds: Math.max(0, passTime - entryTime) };
  }

  function sample(entryTime: number, runTime: number, lead?: number | RailLead): RailPaceSample {
    const resolved = typeof lead === 'object' ? lead : resolve(entryTime, lead);
    const passU = options.runProgress(resolved.passTime, options.duration);
    const entryU = options.runProgress(entryTime, options.duration);
    const spawnAheadAtEntry = (passU - entryU) * railLength;
    const scale = spawnAheadAtEntry > options.spawnAheadUnits ? options.spawnAheadUnits / spawnAheadAtEntry : 1;
    const baseU = options.runProgress(runTime, options.duration);
    const unclampedAnchorU = baseU + scale * (passU - baseU);
    return {
      anchorU: MathUtils.clamp(unclampedAnchorU, 0, 1),
      unclampedAnchorU,
      distanceAheadUnits: scale * (passU - baseU) * railLength,
      scale,
      passTime: resolved.passTime,
      windowSeconds: resolved.windowSeconds,
    };
  }

  return { railLength, resolve, sample };
}
