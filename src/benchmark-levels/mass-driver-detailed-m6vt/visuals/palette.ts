import { Color } from 'three';

// Electric, not fire. A near-black void, cold gunmetal structure, and one
// electrical heat ramp: arc blue -> volt violet -> blinding near-white.
// Hazard amber is strictly reserved for the jammed interlocks, the charge
// warnings, denial (hazard red), and the detonation.

export const ARC_BLUE = new Color(0.22, 0.6, 1.0);
export const VOLT_VIOLET = new Color(0.62, 0.34, 1.0);
export const ION_WHITE = new Color(0.92, 0.96, 1.0);
export const GUNMETAL = new Color(0.075, 0.085, 0.105);
export const GUNMETAL_LIT = new Color(0.13, 0.15, 0.19);
export const HAZARD_AMBER = new Color(1.0, 0.62, 0.1);
export const HAZARD_RED = new Color(1.0, 0.14, 0.08);
export const BACKGROUND = new Color(0.004, 0.006, 0.012);

export function hdr(color: Color, intensity: number) {
  return color.clone().multiplyScalar(intensity);
}

/** The heat ramp: 0 = arc blue, 0.5 = volt violet, 1 = blinding near-white. */
export function heatRamp(t: number) {
  const clamped = Math.min(1, Math.max(0, t));
  if (clamped < 0.55) return ARC_BLUE.clone().lerp(VOLT_VIOLET, clamped / 0.55);
  return VOLT_VIOLET.clone().lerp(ION_WHITE, (clamped - 0.55) / 0.45);
}

/** The lock gradient climbs the same ramp, so the sixth lock reads "fully charged". */
export const LOCK_GRADIENT = [ARC_BLUE, VOLT_VIOLET, ION_WHITE] as const;
