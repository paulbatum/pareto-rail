import { Color } from 'three';
import { mulberry32, type Rng } from '../../../engine/rng';

// Mass Driver's language is electric, not fire. The barrel is cold gunmetal in a
// blue-black void; everything the gun accelerates runs "hot" up an electrical
// ramp — arc blue → volt violet → blinding white — and the player's own kit
// (reticle, locks, shots) stays ion-white and arc-blue so it reads as the one
// precise, in-control thing in the tunnel. HAZARD amber is reserved: it belongs
// only to the jammed interlocks, the charge warnings, a denied release, and the
// detonation. Nothing else in the level is allowed to be amber.
export const VOID = new Color(0.006, 0.009, 0.018);
export const GUNMETAL = new Color(0.15, 0.18, 0.26);
export const ARC_BLUE = new Color(0.25, 0.65, 1.0);
export const VOLT_VIOLET = new Color(0.62, 0.32, 1.0);
export const ION_WHITE = new Color(0.86, 0.95, 1.0);
export const BLINDING = new Color(0.96, 0.97, 1.0);

// The one warning colour. Kept out of every friendly and structural element.
export const HAZARD = new Color(1.0, 0.42, 0.08);
export const HAZARD_RED = new Color(1.6, 0.12, 0.05);
export const HAZARD_FILL = new Color(0.32, 0.03, 0.006);

// Locks charge cold → violet → white: the sixth lock is the gun "fully charged".
export const LOCK_GRADIENT = [ARC_BLUE, VOLT_VIOLET, BLINDING] as const;

const HEAT_MID = 0.55;
const scratchHeat = new Color();

// The heat ramp is the level's soul: rings, hum, and hostiles all climb it as
// the run accelerates. t=0 arc blue, t≈0.55 volt violet, t=1 blinding white.
// Returns a base (roughly sub-bloom) colour — callers apply hdr() for rims.
export function heatColor(t: number, target = new Color()): Color {
  const x = t < 0 ? 0 : t > 1 ? 1 : t;
  if (x <= HEAT_MID) {
    return target.copy(ARC_BLUE).lerp(VOLT_VIOLET, x / HEAT_MID);
  }
  return target.copy(VOLT_VIOLET).lerp(BLINDING, (x - HEAT_MID) / (1 - HEAT_MID));
}

// Convenience for one-off reads where a fresh Color is wanted.
export function heatColorAt(t: number): Color {
  return heatColor(t, scratchHeat).clone();
}

export function hdr(color: Color, intensity: number): Color {
  return color.clone().multiplyScalar(intensity);
}

export { mulberry32, type Rng };
