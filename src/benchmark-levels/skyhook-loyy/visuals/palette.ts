import { Color } from 'three';

// Aerospace white, deliberately below display white so broad panels remain
// legible under bloom instead of turning the frame into a light box.
export const PANEL = new Color(0xb8bec1);
export const PANEL_SHADE = new Color(0x5f6970);
export const GRAPHITE = new Color(0x171c20);
export const TETHER = new Color(0x343a3e);
export const ORANGE = new Color(0xe66b19);
export const HAZARD_DARK = new Color(0x542106);
export const LOCK_BLUE = new Color(0x78b8d8);
export const SUN_WHITE = new Color(0xfff2d1);
export const DENY_RED = new Color(0xb82c1b);
export const STORM = new Color(0x303b44);
export const SKY = new Color(0x367dae);
export const INDIGO = new Color(0x101b38);
export const SPACE = new Color(0x010308);

export function hdr(color: Color, intensity: number) {
  return color.clone().multiplyScalar(intensity);
}

export function mulberry32(seed: number) {
  return () => {
    let value = seed += 0x6d2b79f5;
    value = Math.imul(value ^ value >>> 15, value | 1);
    value ^= value + Math.imul(value ^ value >>> 7, value | 61);
    return ((value ^ value >>> 14) >>> 0) / 4294967296;
  };
}
