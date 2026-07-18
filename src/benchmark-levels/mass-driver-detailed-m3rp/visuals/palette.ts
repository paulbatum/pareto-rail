import { Color } from 'three';
import { mulberry32, type Rng } from '../../../engine/rng';

// Electric, not fire. A near-black void, cold gunmetal structure, and one
// electrical heat ramp — arc blue → volt violet → blinding near-white — that
// everything the gun accelerates climbs as the run accelerates. The player's
// own kit (reticle, locks, shots) stays ion white and arc blue: the one
// precise, in-control thing in the tunnel. Hazard amber is strictly reserved
// for the jammed interlocks, the charge warnings, denial (a harsher hazard
// red), and the detonation; nothing else in the level may be amber.
export const VOID = new Color(0.005, 0.008, 0.017);
export const GUNMETAL = new Color(0.14, 0.17, 0.24);
export const ARC_BLUE = new Color(0.22, 0.62, 1.0);
export const VOLT_VIOLET = new Color(0.6, 0.3, 1.0);
export const ION_WHITE = new Color(0.87, 0.95, 1.0);
export const BLINDING = new Color(0.97, 0.98, 1.0);

// The one warning colour, kept off every friendly and structural element.
export const HAZARD = new Color(1.0, 0.44, 0.07);
export const HAZARD_RED = new Color(1.55, 0.13, 0.05);
export const HAZARD_FILL = new Color(0.3, 0.032, 0.007);

// The lock gradient climbs the same ramp: the sixth lock reads "fully charged".
export const LOCK_GRADIENT = [ARC_BLUE, VOLT_VIOLET, BLINDING] as const;

const HEAT_MID = 0.56;
const scratchHeat = new Color();

// The heat ramp: t=0 arc blue, t≈0.56 volt violet, t=1 blinding near-white.
// Returns a base (roughly sub-bloom) colour; callers apply hdr() for rims.
export function heatColor(t: number, target = new Color()): Color {
  const x = t < 0 ? 0 : t > 1 ? 1 : t;
  if (x <= HEAT_MID) return target.copy(ARC_BLUE).lerp(VOLT_VIOLET, x / HEAT_MID);
  return target.copy(VOLT_VIOLET).lerp(BLINDING, (x - HEAT_MID) / (1 - HEAT_MID));
}

export function heatColorAt(t: number): Color {
  return heatColor(t, scratchHeat).clone();
}

export function hdr(color: Color, intensity: number): Color {
  return color.clone().multiplyScalar(intensity);
}

export { mulberry32, type Rng };
