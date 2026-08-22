import { Color } from 'three';

// Broadside's language: every hull reads as a silhouette rimmed by the
// magenta-and-gold nebula behind it. Sides read by color — the friendly fleet
// is ice-white with cyan engine glow, the enemy obsidian streaked with molten
// orange, firing crimson. Gold marks power, warnings, and the player's own
// lock hardware.

export const ICE = new Color(0.82, 0.94, 1.0);
export const CYAN = new Color(0.3, 0.9, 1.0);
export const GOLD = new Color(1.0, 0.76, 0.3);
export const MAGENTA = new Color(1.0, 0.25, 0.62);
export const EMBER = new Color(1.0, 0.45, 0.12);
export const CRIMSON = new Color(1.0, 0.12, 0.08);

// Hull bodies stay near-black so silhouettes carry; only edges and lamps emit.
export const FRIEND_HULL = new Color(0x0d141d);
export const FOE_HULL = new Color(0x0b0705);
export const VOID = new Color(0x050208);

export function hdr(color: Color, intensity: number): Color {
  return color.clone().multiplyScalar(intensity);
}
