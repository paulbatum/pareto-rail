import { Color } from 'three';
import { mulberry32, type Rng } from '../../../engine/rng';

// Hot here means electric, not fire. The barrel charges arc blue → violet →
// blinding white across the run. Everything hostile carries magenta signal
// light so it never disappears into the barrel's own glow, and everything
// the player owns (reticle, locks, tracers) is kinetic amber — the one warm
// thing inside an electric gun.
export const GUNMETAL = new Color(0.055, 0.065, 0.09);
export const COIL_DARK = new Color(0.03, 0.034, 0.05);
export const ARC_BLUE = new Color(0.3, 0.62, 1.0);
export const ARC_VIOLET = new Color(0.6, 0.34, 1.0);
export const ARC_WHITE = new Color(0.88, 0.93, 1.0);
export const HOSTILE_MAGENTA = new Color(1.0, 0.2, 0.6);
export const TRACER_AMBER = new Color(1.0, 0.72, 0.26);
export const AMBER_WHITE = new Color(1.0, 0.9, 0.68);
export const WARNING_RED = new Color(1.0, 0.16, 0.1);
export const SPACE_BLACK = new Color(0.004, 0.005, 0.012);
export const BARREL_HAZE = new Color(0.016, 0.02, 0.038);

// Player charge walks amber → white: the sixth lock reads as a seated breech.
export const LOCK_GRADIENT = [TRACER_AMBER, AMBER_WHITE, ARC_WHITE] as const;

/** Electric charge ramp: arc blue through violet toward blinding white. */
export function chargeColor(t: number, target = new Color()) {
  const clamped = Math.min(1, Math.max(0, t));
  if (clamped < 0.5) return target.copy(ARC_BLUE).lerp(ARC_VIOLET, clamped * 2);
  return target.copy(ARC_VIOLET).lerp(ARC_WHITE, (clamped - 0.5) * 2);
}

export function hdr(color: Color, intensity: number) {
  return color.clone().multiplyScalar(intensity);
}

export { mulberry32, type Rng };
