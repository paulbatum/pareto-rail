import { Color } from 'three';
import { mulberry32, type Rng } from '../../../engine/rng';

// Skyhook has two colour families and no third.
//
//   Hardware — the tether, the climber car, the station, and everything the
//   player owns (reticle, shots, locks): white paneling and hazard orange.
//   Utilitarian paint, not neon.
//
//   Outside — the sky and the things that live in it: weathered pale greys and
//   cold blue-white ice. Hostiles are dark slate silhouettes with pale rims, so
//   they read against storm grey down low and against black at the top.
//
// Locking an enemy paints it: pale ice flips to hazard orange. That single
// swap is the whole lock language.

export const HAZARD = new Color(1.0, 0.42, 0.05);
export const AMBER = new Color(1.0, 0.68, 0.2);
export const PANEL = new Color(0.86, 0.88, 0.9);
export const STEEL = new Color(0.3, 0.33, 0.37);
export const SLATE = new Color(0.075, 0.085, 0.1);
export const RUST = new Color(0.42, 0.19, 0.08);

export const PALE = new Color(0.56, 0.65, 0.74);
export const ICE = new Color(0.82, 0.9, 0.98);
export const FAULT = new Color(1.25, 0.1, 0.06);

// Sky keyframes: storm grey → sunlit blue → indigo → black.
export const SKY_STORM = new Color(0.14, 0.155, 0.18);
export const SKY_BREAK = new Color(0.35, 0.51, 0.73);
export const SKY_HIGH = new Color(0.11, 0.2, 0.42);
export const SKY_THIN = new Color(0.03, 0.05, 0.14);
export const SKY_VOID = new Color(0.006, 0.008, 0.018);

export const HAZE_STORM = new Color(0.22, 0.24, 0.27);
export const HAZE_BREAK = new Color(0.62, 0.68, 0.77);
export const HAZE_HIGH = new Color(0.38, 0.5, 0.68);
export const HAZE_THIN = new Color(0.12, 0.24, 0.44);

export const PLANET_SEA = new Color(0.035, 0.062, 0.105);
export const PLANET_LAND = new Color(0.085, 0.095, 0.078);
export const PLANET_CLOUD = new Color(0.68, 0.72, 0.78);

// Locks charge white → amber → hazard: the sixth lock is the paint gun emptied.
export const LOCK_GRADIENT = [PANEL, AMBER, HAZARD] as const;

export function hdr(color: Color, intensity: number) {
  return color.clone().multiplyScalar(intensity);
}

export { mulberry32, type Rng };
