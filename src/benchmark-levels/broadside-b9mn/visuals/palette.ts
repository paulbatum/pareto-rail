import { Color } from 'three';
import { mulberry32, type Rng } from '../../../engine/rng';

// Broadside's rule: the nebula does the lighting, the fleets do the color-coding.
// Every hull is a silhouette rimmed in nebula light; you tell the sides apart
// by their signals. Friendly hardware is ice-white with cyan engine glow and
// cyan fire; the enemy is obsidian streaked with molten orange, firing crimson.
// The player's own optics, tracers, and letters are all friendly cyan.
export const ICE_WHITE = new Color(0.78, 0.84, 0.9);
export const ICE_SHADOW = new Color(0.22, 0.26, 0.32);
export const CYAN = new Color(0.3, 0.85, 1.0);
export const CYAN_PALE = new Color(0.62, 0.92, 1.0);
export const OBSIDIAN = new Color(0.055, 0.05, 0.07);
export const OBSIDIAN_EDGE = new Color(0.14, 0.12, 0.16);
export const MOLTEN = new Color(1.0, 0.45, 0.08);
export const CRIMSON = new Color(1.0, 0.14, 0.12);
export const COLD_WHITE = new Color(0.94, 0.97, 1.0);

// The nebula backdrop: magenta and gold, with deep violet shadow.
export const NEBULA_MAGENTA = new Color(0.72, 0.12, 0.5);
export const NEBULA_GOLD = new Color(0.95, 0.62, 0.18);
export const NEBULA_VIOLET = new Color(0.1, 0.03, 0.15);
export const SPACE_BLACK = new Color(0.012, 0.008, 0.02);

// Locks charge cyan → pale ice → cold white: the sixth lock reads as a full
// firing solution, your fleet's own light at maximum.
export const LOCK_GRADIENT = [CYAN, CYAN_PALE, COLD_WHITE] as const;

export function hdr(color: Color, intensity: number) {
  return color.clone().multiplyScalar(intensity);
}

export { mulberry32, type Rng };
