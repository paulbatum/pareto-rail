import { Color } from 'three';

// The Broadside palette. Everything reads against a magenta-and-gold nebula:
// hulls are silhouettes rimmed in colored light. Sides read by color —
// the home fleet is ice-white with cyan engine glow and cyan fire; the enemy
// is obsidian streaked with molten orange, firing crimson.

export const NEBULA_DEEP = new Color(0.016, 0.006, 0.03);
export const NEBULA_MAGENTA = new Color(0.55, 0.08, 0.42);
export const NEBULA_GOLD = new Color(1.05, 0.62, 0.16);
export const NEBULA_EMBER = new Color(0.9, 0.3, 0.12);

export const ICE_WHITE = new Color(0.82, 0.94, 1.0);
export const CYAN = new Color(0.2, 0.85, 1.0);
export const CYAN_DEEP = new Color(0.05, 0.4, 0.62);
export const ALLY_HULL = new Color(0.34, 0.4, 0.48);
export const ALLY_DARK = new Color(0.1, 0.13, 0.17);

export const OBSIDIAN = new Color(0.045, 0.035, 0.045);
export const MOLTEN = new Color(1.0, 0.42, 0.08);
export const CRIMSON = new Color(1.0, 0.08, 0.12);
export const EMBER_ORANGE = new Color(1.0, 0.55, 0.1);

export const WHITE_HOT = new Color(1.35, 1.2, 1.0);
export const GOLD = new Color(1.0, 0.75, 0.25);

// Lock charge: cyan → ice → gold — the sixth lock is a firing solution.
export const LOCK_GRADIENT = [CYAN.clone(), ICE_WHITE.clone(), GOLD.clone()];

export function hdr(color: Color, intensity: number): Color {
  return color.clone().multiplyScalar(intensity);
}

export type Rng = () => number;

export function mulberry32(seed: number): Rng {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
