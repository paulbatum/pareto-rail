import { Color } from 'three';
import { mulberry32, type Rng } from '../../../engine/rng';

// Strandline's rule: the water and the animal share one family of colours —
// sunlit teal falling away into deep blue, with the jelly's own green-gold
// bioluminescence layered on top of it. Violet appears nowhere except on the
// infestation, so "sick" is a colour you can read at a glance from any
// distance, and the player's own light is the coldest, cleanest thing on
// screen so shots never get lost in the glow.

// --- water -------------------------------------------------------------------
export const SUNLIT_WATER = new Color(0.09, 0.31, 0.33);
export const MID_WATER = new Color(0.04, 0.17, 0.27);
export const DEEP_WATER = new Color(0.012, 0.05, 0.15);
export const OPEN_WATER = new Color(0.07, 0.27, 0.36);
export const SURFACE_LIGHT = new Color(0.72, 0.98, 0.86);

// --- the animal --------------------------------------------------------------
export const LUME_GREEN = new Color(0.30, 1.0, 0.62);
export const LUME_GOLD = new Color(1.0, 0.85, 0.42);
export const LUME_DEEP = new Color(0.10, 0.52, 0.44);
export const JELLY_FLESH = new Color(0.16, 0.44, 0.42);
export const JELLY_RIM = new Color(0.55, 1.0, 0.80);

// --- the infestation ---------------------------------------------------------
export const SICK_VIOLET = new Color(0.58, 0.16, 0.95);
export const SICK_PALE = new Color(0.84, 0.60, 1.0);
export const SICK_DARK = new Color(0.16, 0.05, 0.26);
export const SICK_CORE = new Color(1.0, 0.30, 0.86);

// --- the player --------------------------------------------------------------
export const COLD_WHITE = new Color(0.90, 0.99, 1.0);
export const PLAYER_CYAN = new Color(0.55, 0.95, 1.0);

// Locks charge green → gold → white-hot: the animal's own light gathering in
// your hand until the sixth target tips it over.
export const LOCK_GRADIENT = [LUME_GREEN, LUME_GOLD, COLD_WHITE] as const;

export function hdr(color: Color, intensity: number) {
  return color.clone().multiplyScalar(intensity);
}

export { mulberry32, type Rng };
