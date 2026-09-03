import { Color } from 'three';

// Broadside palette: the whole battle backlit by a magenta-and-gold nebula.
// Friendly fleet reads ice-white with cyan glow; the enemy reads obsidian
// with molten orange slits and crimson fire.
export const NEBULA_MAGENTA = new Color(0.85, 0.16, 0.62);
export const NEBULA_GOLD = new Color(1.0, 0.62, 0.22);
export const NEBULA_DEEP = new Color(0.03, 0.012, 0.06);
export const BACKGROUND = new Color(0.012, 0.006, 0.03);

export const ICE = new Color(0.82, 0.93, 1.0);
export const CYAN_GLOW = new Color(0.3, 0.9, 1.0);
export const GOLD = new Color(1.0, 0.72, 0.3);

export const OBSIDIAN = new Color(0.05, 0.045, 0.07);
export const MOLTEN = new Color(1.0, 0.38, 0.08);
export const CRIMSON = new Color(1.0, 0.12, 0.2);
export const CORE_WHITE = new Color(0.9, 0.97, 1.0);

export function hdr(color: Color, intensity: number): Color {
  return color.clone().multiplyScalar(intensity);
}
