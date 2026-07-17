import { Color } from 'three';
import { mulberry32, type Rng } from '../../../engine/rng';

// Electric, not fire. A near-black void and cold gunmetal structure;
// everything the gun accelerates runs "hot" up an electrical heat ramp:
// arc blue → volt violet → blinding near-white. The player's own kit stays
// ion-white and arc blue. Hazard amber is strictly reserved for the jammed
// interlocks, charge warnings, denial (hazard red), and the detonation.
export const GUNMETAL = new Color(0.052, 0.058, 0.072);
export const ARC_BLUE = new Color(0.3, 0.62, 1.0);
export const VOLT_VIOLET = new Color(0.62, 0.34, 1.0);
export const ION_WHITE = new Color(0.9, 0.95, 1.0);
export const BLINDING = new Color(1.0, 0.99, 0.96);
export const HAZARD_AMBER = new Color(1.0, 0.6, 0.1);
export const HAZARD_RED = new Color(1.0, 0.13, 0.05);
export const VOID_BLUE = new Color(0.006, 0.01, 0.024);

// The lock gradient climbs the same heat ramp, so the sixth lock reads as
// the gun "fully charged".
export const LOCK_GRADIENT = [ARC_BLUE, VOLT_VIOLET, BLINDING] as const;

/** Electrical heat ramp: 0 = arc blue, ~0.55 = volt violet, 1 = blinding. */
export function heatColor(t: number) {
  const clamped = Math.min(1, Math.max(0, t));
  if (clamped < 0.55) return ARC_BLUE.clone().lerp(VOLT_VIOLET, clamped / 0.55);
  return VOLT_VIOLET.clone().lerp(BLINDING, (clamped - 0.55) / 0.45);
}

export function hdr(color: Color, intensity: number) {
  return color.clone().multiplyScalar(intensity);
}

export { mulberry32, type Rng };
