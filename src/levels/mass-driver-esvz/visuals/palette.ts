import { Color } from 'three';

// Electric heat, not fire: the barrel climbs arc blue → violet → blinding
// white as the payload accelerates. Structure is near-black gunmetal so the
// coil glow carries the space. Hostile hardware is hazard amber — the one
// warm family in the level — and the jammed interlocks add warning red.
// Player optics (reticle, locks, shots) are the coldest, whitest cyan.
export const ARC_BLUE = new Color(0.3, 0.72, 1.0);
export const ARC_VIOLET = new Color(0.62, 0.34, 1.0);
export const ARC_WHITE = new Color(0.93, 0.95, 1.0);
export const PLAYER_CYAN = new Color(0.55, 0.95, 1.0);
export const HAZARD_AMBER = new Color(1.0, 0.58, 0.1);
export const WARNING_RED = new Color(1.0, 0.16, 0.08);
export const GUNMETAL = new Color(0.055, 0.065, 0.09);
export const COIL_DARK = new Color(0.028, 0.032, 0.05);
export const SPACE_BLACK = new Color(0.004, 0.006, 0.013);
export const PLANET_BLUE = new Color(0.05, 0.09, 0.16);

// Locks charge blue → violet → white: the electric heat ramp itself.
export const LOCK_GRADIENT = [ARC_BLUE, ARC_VIOLET, ARC_WHITE] as const;

export function hdr(color: Color, intensity: number) {
  return color.clone().multiplyScalar(intensity);
}

/** Barrel heat ramp: 0 = breech (arc blue), 1 = muzzle at full charge (white). */
export function ringHeatColor(t: number) {
  const clamped = Math.min(1, Math.max(0, t));
  if (clamped < 0.55) return ARC_BLUE.clone().lerp(ARC_VIOLET, clamped / 0.55);
  return ARC_VIOLET.clone().lerp(ARC_WHITE, (clamped - 0.55) / 0.45);
}
