import { Color } from 'three';

// Strandline's palette is three lights in water:
// - the sea itself, sunlit blue-green overhead shading to deep blue with depth
//   and distance;
// - the jellyfish's bioluminescence, green shading to gold, which is also the
//   player's light — locks, shots, the reticle, the letters all borrow it;
// - the sickly violet of the parasites, the only sour colour in the frame.

export const WATER_SURFACE = new Color(0.11, 0.38, 0.42);
export const WATER_MID = new Color(0.01, 0.075, 0.15);
export const WATER_DEEP = new Color(0.003, 0.022, 0.075);
export const WATER_FOG = new Color(0.01, 0.065, 0.13);
export const SUNLIGHT = new Color(0.82, 1.0, 0.92);

export const JELLY_GREEN = new Color(0.3, 1.0, 0.55);
export const JELLY_GOLD = new Color(1.0, 0.82, 0.34);
export const JELLY_SICK = new Color(0.09, 0.2, 0.24);
export const JELLY_DEEP = new Color(0.04, 0.22, 0.16);

export const PARASITE = new Color(0.46, 0.14, 0.7);
export const PARASITE_DARK = new Color(0.16, 0.03, 0.26);
export const PARASITE_HOT = new Color(1.0, 0.36, 1.0);
export const PARASITE_PALE = new Color(0.78, 0.62, 1.0);

export const PLAYER_LIGHT = new Color(1.0, 0.95, 0.72);
export const DENY = new Color(1.0, 0.16, 0.62);

/** Lock charge walks the jelly's own light: aqua → green → gold. */
export const LOCK_GRADIENT = [
  new Color(0.4, 1.0, 0.9),
  new Color(0.42, 1.0, 0.45),
  new Color(1.0, 0.8, 0.28),
] as const;

export function hdr(color: Color, intensity: number) {
  return color.clone().multiplyScalar(intensity);
}
