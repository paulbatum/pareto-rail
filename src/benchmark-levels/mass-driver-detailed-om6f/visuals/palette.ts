import { Color } from 'three';

// Electric, not fire. Everything the gun accelerates runs "hot" up a single
// electrical heat ramp — arc blue, through volt violet, to a blinding near
// white. The player's own kit stays ion white and arc blue: the one precise,
// in-control thing in the tunnel. Hazard amber is strictly reserved for the
// jammed interlocks, the charge warnings, and denial.

export const ARC_BLUE = new Color(0.20, 0.60, 1.0);
export const VOLT_VIOLET = new Color(0.62, 0.30, 1.0);
export const IGNITION = new Color(0.90, 0.94, 1.0);
export const ION_WHITE = new Color(0.86, 0.96, 1.0);

export const GUNMETAL = new Color(0.115, 0.130, 0.155);
export const GUNMETAL_EDGE = new Color(0.30, 0.35, 0.42);

export const HAZARD_AMBER = new Color(1.0, 0.60, 0.10);
export const HAZARD_RED = new Color(1.0, 0.14, 0.07);

export const VOID_BREECH = new Color(0.004, 0.008, 0.020);
export const VOID_INTERLOCK = new Color(0.024, 0.010, 0.040);
export const VOID_VACUUM = new Color(0.001, 0.001, 0.003);

const rampScratch = new Color();

/** The level's one color decision: 0 = arc blue, 0.5 = volt violet, 1 = blinding. */
export function heatRamp(t: number, target = new Color()): Color {
  const clamped = t < 0 ? 0 : t > 1 ? 1 : t;
  if (clamped <= 0.5) return target.copy(ARC_BLUE).lerp(VOLT_VIOLET, clamped * 2);
  return target.copy(VOLT_VIOLET).lerp(IGNITION, (clamped - 0.5) * 2);
}

export function heatRampScratch(t: number): Color {
  return heatRamp(t, rampScratch);
}

export function hdr(color: Color, intensity: number): Color {
  return color.clone().multiplyScalar(intensity);
}

/** The lock gradient climbs the same ramp, so the sixth lock reads as "fully charged". */
export const LOCK_GRADIENT = [ARC_BLUE, VOLT_VIOLET, IGNITION] as const;
