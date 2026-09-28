import { Color } from 'three';

// Water, life, sickness, and the player's light. Four families, never mixed:
//   water   — clear blue-green shading to deep blue with distance
//   life    — the jelly's own bioluminescence, green over gold
//   blight  — the parasites: one sour violet, from bruise-dark to hot magenta
//   sun     — the player's fire, warm gold — the only warm thing in the water
export { mulberry32 } from '../../../engine/rng';

export const hdr = (color: Color, intensity: number) => color.clone().multiplyScalar(intensity);

// water
export const WATER_TOP = new Color(0.07, 0.47, 0.5);
export const WATER_MID = new Color(0.02, 0.22, 0.36);
export const WATER_DEEP = new Color(0.005, 0.045, 0.15);
export const WATER_FOG = new Color(0.02, 0.19, 0.32);
export const WATER_CLEAN_TOP = new Color(0.14, 0.62, 0.6);
export const SHAFT = new Color(0.5, 0.95, 0.8);
export const SNOW = new Color(0.55, 0.9, 0.85);

// life
export const STRAND_DIM = new Color(0.05, 0.3, 0.3);
export const STRAND_GREEN = new Color(0.22, 0.92, 0.55);
export const STRAND_GOLD = new Color(1, 0.82, 0.3);
export const BELL_GREEN = new Color(0.16, 0.78, 0.46);
export const BELL_GOLD = new Color(1, 0.86, 0.34);

// blight
export const VIOLET = new Color(0.52, 0.17, 0.82);
export const VIOLET_DARK = new Color(0.13, 0.035, 0.26);
export const VIOLET_PALE = new Color(0.78, 0.55, 1);
export const VIOLET_HOT = new Color(1, 0.36, 1);
export const SICK_MAGENTA = new Color(0.86, 0.12, 0.55);
export const SILK = new Color(0.66, 0.46, 1);

// sun
export const SUN_WHITE = new Color(1, 0.97, 0.78);
export const SUN_GOLD = new Color(1, 0.72, 0.22);
export const SUN_CORAL = new Color(1, 0.42, 0.24);
export const DENY = new Color(0.55, 0.08, 0.5);

// The lock gradient walks the player's light from pale gold to coral: the
// sixth lock is visibly ignition.
export const LOCK_GRADIENT = [SUN_WHITE, SUN_GOLD, SUN_CORAL] as const;
