import { Color } from 'three';
import { mulberry32, type Rng } from '../../../engine/rng';

// BROADSIDE reads by side, and only by side. Everything is a silhouette rimmed
// in colored light against a magenta-and-gold nebula:
//
//   Your fleet   ice-white hull, cyan engine glow, cyan gunfire.
//   The enemy    obsidian hull, molten-orange seams, crimson gunfire.
//
// There is no third faction color. Locks, letters, the reticle and your own
// tracers are cyan-white, so anything crimson on screen is trying to kill you.
export const ICE_WHITE = new Color(0.86, 0.91, 0.97);
export const ICE_SHADOW = new Color(0.3, 0.36, 0.44);
export const CYAN = new Color(0.28, 0.92, 1.0);
export const CYAN_DEEP = new Color(0.08, 0.5, 0.78);
export const COLD_WHITE = new Color(0.9, 0.97, 1.0);

export const OBSIDIAN = new Color(0.055, 0.05, 0.065);
export const OBSIDIAN_EDGE = new Color(0.14, 0.12, 0.15);
export const MOLTEN = new Color(1.0, 0.42, 0.06);
export const EMBER = new Color(0.9, 0.2, 0.02);
export const CRIMSON = new Color(1.0, 0.11, 0.14);

// The nebula: magenta low, gold high, near-black in the deep gaps between.
// Deliberately dim: the nebula is a backlight, not a subject. Anything above
// about 0.2 luminance across the whole frame swallows the rim light that makes
// every hull in the level readable, and takes the reticle with it.
export const NEBULA_MAGENTA = new Color(0.2, 0.03, 0.15);
export const NEBULA_ROSE = new Color(0.32, 0.055, 0.21);
export const NEBULA_GOLD = new Color(0.34, 0.21, 0.07);
export const NEBULA_DEEP = new Color(0.028, 0.012, 0.045);
export const VOID_BLACK = new Color(0.008, 0.005, 0.014);

/** Locks charge cyan → white → gold: your fire spectrum, ending on the nebula's own highlight. */
export const LOCK_GRADIENT = [CYAN, COLD_WHITE, new Color(1.0, 0.78, 0.3)] as const;

export function hdr(color: Color, intensity: number) {
  return color.clone().multiplyScalar(intensity);
}

export { mulberry32, type Rng };
