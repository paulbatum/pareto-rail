import { Color, SRGBColorSpace } from 'three';
import { mulberry32, type Rng } from '../../../engine/rng';

// The renderer treats Color components as linear working-space values and
// applies the sRGB output transform at the end, so raw floats get lifted
// (0.045 renders as ~0.24). Dark base colors are therefore authored in sRGB
// and converted here; emissive/signal colors stay raw — they want the lift.
const srgb = (r: number, g: number, b: number) => new Color().setRGB(r, g, b, SRGBColorSpace);

// Broadside's color law: the nebula owns the sky, the fleets own two
// temperature-coded signal palettes, and everything else is silhouette.
// The sky is a magenta-and-gold nebula, so every hull reads dark against it,
// rimmed in its side's color. Friendly hardware is ice-white with cyan
// engine glow and cyan fire; enemy hardware is obsidian streaked with molten
// orange, firing crimson. The player flies with the friendly fleet: cyan
// locks warming through nebula gold into hot magenta as the volley charges.

// -- the sky ------------------------------------------------------------------
export const NEBULA_MAGENTA = new Color(0.62, 0.08, 0.38);
export const NEBULA_DEEP = srgb(0.16, 0.02, 0.14);
export const NEBULA_GOLD = new Color(1.0, 0.62, 0.16);
export const NEBULA_EMBER = new Color(0.85, 0.3, 0.1);
export const SPACE_BLACK = srgb(0.012, 0.008, 0.02);

// -- friendly fleet -------------------------------------------------------------
export const ICE_HULL = srgb(0.66, 0.72, 0.8);
export const ICE_SHADOW = srgb(0.34, 0.38, 0.46);
export const CYAN_ENGINE = new Color(0.2, 0.85, 1.0);
export const CYAN_FIRE = new Color(0.3, 0.95, 1.0);
export const CYAN_WINDOW = new Color(0.55, 0.92, 1.0);

// -- enemy fleet ---------------------------------------------------------------
export const OBSIDIAN = srgb(0.045, 0.04, 0.065);
export const OBSIDIAN_LIT = srgb(0.1, 0.075, 0.1);
export const MOLTEN_ORANGE = new Color(1.0, 0.42, 0.08);
export const CRIMSON_FIRE = new Color(1.0, 0.12, 0.16);
export const CRIMSON_WINDOW = new Color(0.9, 0.16, 0.14);

// -- player ----------------------------------------------------------------------
export const PLAYER_WHITE = new Color(0.95, 0.99, 1.0);
export const LOCK_CYAN = new Color(0.3, 0.95, 1.0);
export const LOCK_GOLD = new Color(1.0, 0.72, 0.24);
export const LOCK_MAGENTA = new Color(1.0, 0.3, 0.75);

// Locks charge cyan -> nebula gold -> hot magenta: the volley going to full
// broadside walks the sky's own gradient.
export const LOCK_GRADIENT = [LOCK_CYAN, LOCK_GOLD, LOCK_MAGENTA] as const;

export const HULL_DARK = srgb(0.09, 0.1, 0.13);

export function hdr(color: Color, intensity: number) {
  return color.clone().multiplyScalar(intensity);
}

export { mulberry32, type Rng };
