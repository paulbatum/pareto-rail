import { Color } from 'three';

// Electric, not fire. A near-black void, cold gunmetal structure, and one
// electrical heat ramp everything the gun accelerates runs up: arc blue →
// volt violet → blinding near-white. The player's own kit stays ion-white
// and arc blue. Hazard amber is STRICTLY reserved for the jammed interlocks,
// charge warnings, and denial/detonation reds — nothing else may be amber.
export const ARC_BLUE = new Color(0.24, 0.66, 1.0);
export const VOLT_VIOLET = new Color(0.62, 0.36, 1.0);
export const ION_WHITE = new Color(0.9, 0.95, 1.0);
export const GUNMETAL = new Color(0.085, 0.1, 0.125);
export const GUNMETAL_EDGE = new Color(0.32, 0.42, 0.55);
export const HAZARD_AMBER = new Color(1.0, 0.6, 0.14);
export const HAZARD_RED = new Color(1.0, 0.14, 0.09);
export const BACKGROUND = new Color(0.004, 0.008, 0.022);

/** The lock gradient climbs the same ramp — the sixth lock reads "fully charged". */
export const LOCK_GRADIENT = [ARC_BLUE, VOLT_VIOLET, ION_WHITE] as const;

export function hdr(color: Color, intensity: number): Color {
  return color.clone().multiplyScalar(intensity);
}

/** The electrical heat ramp: 0 = arc blue, 0.5 = volt violet, 1 = blinding near-white. */
export function heatRamp(t: number): Color {
  const clamped = Math.min(1, Math.max(0, t));
  if (clamped < 0.5) return ARC_BLUE.clone().lerp(VOLT_VIOLET, clamped * 2);
  return VOLT_VIOLET.clone().lerp(ION_WHITE, (clamped - 0.5) * 2);
}
