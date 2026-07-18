import { Color } from 'three';

// Electric, not fire. The level has exactly one color story: everything the gun
// accelerates runs "hot" up an electrical heat ramp — arc blue through volt
// violet toward blinding near-white — against near-black void and cold gunmetal
// structure.
//
// The player's own kit (reticle, locks, shots, trails) stays ion white and arc
// blue: the one precise, in-control thing in the tunnel.
//
// HAZARD AMBER IS RESERVED. It appears on the jammed interlocks, the charge
// warnings, denial (as the harsher hazard red), and the detonation. Nothing
// else in this level may be amber, or the deadline stops reading as a warning.

export const ARC_BLUE = new Color(0.22, 0.62, 1.0);
export const VOLT_VIOLET = new Color(0.62, 0.3, 1.0);
export const IGNITION = new Color(0.93, 0.95, 1.0);
export const ION_WHITE = new Color(0.86, 0.95, 1.0);

export const HAZARD_AMBER = new Color(1.0, 0.64, 0.12);
export const HAZARD_RED = new Color(1.0, 0.15, 0.08);

export const GUNMETAL = new Color(0.115, 0.128, 0.155);
export const GUNMETAL_LIT = new Color(0.2, 0.225, 0.27);
export const VOID = new Color(0.004, 0.008, 0.02);

/** The heat ramp: 0 = cold breech arc blue, 0.55 = volt violet, 1 = blinding. */
export function heat(t: number, target = new Color()): Color {
  const clamped = Math.min(1, Math.max(0, t));
  if (clamped <= 0.55) return target.copy(ARC_BLUE).lerp(VOLT_VIOLET, clamped / 0.55);
  return target.copy(VOLT_VIOLET).lerp(IGNITION, (clamped - 0.55) / 0.45);
}

/** HDR multiplier: values past 1.0 are what bloom picks up. */
export function hdr(color: Color, intensity: number): Color {
  return color.clone().multiplyScalar(intensity);
}

/** The lock gradient climbs the same ramp, so the sixth lock reads as "fully charged". */
export const LOCK_GRADIENT = [ARC_BLUE, VOLT_VIOLET, IGNITION] as const;
