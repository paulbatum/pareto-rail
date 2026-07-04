import { Color } from 'three';

// The world burns; the player is cold. Everything hostile or environmental
// lives in gold/ember/obsidian, everything the player owns (reticle, locks,
// shots) is blue-white ice so it can never be lost against the fire.
export const GOLD = new Color(1.0, 0.62, 0.14);
export const EMBER = new Color(1.0, 0.24, 0.05);
export const BLOOD = new Color(0.55, 0.05, 0.05);
export const WHITE_HOT = new Color(1.0, 0.92, 0.74);
export const OBSIDIAN = new Color(0.045, 0.032, 0.042);
export const ASH_VIOLET = new Color(0.3, 0.14, 0.36);
export const COLD_BLUE = new Color(0.42, 0.74, 1.0);
export const ICE_WHITE = new Color(0.86, 0.95, 1.0);
export const SPACE_MAROON = new Color(0.028, 0.008, 0.016);

// Locks charge cold → white → gold: the sixth lock reads as ignition.
export const LOCK_GRADIENT = [COLD_BLUE, ICE_WHITE, GOLD] as const;

export function hdr(color: Color, intensity: number) {
  return color.clone().multiplyScalar(intensity);
}

export type Rng = () => number;

export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a += 0x6d2b79f5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
