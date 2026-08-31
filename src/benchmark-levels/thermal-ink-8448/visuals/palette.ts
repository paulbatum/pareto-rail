import { Color } from 'three';

// Sodium harbour: nothing is pure. Even the cream paint is stained by water,
// and the warm accents stay small enough that the silhouettes remain legible
// with bloom disabled.
export const WATER = new Color(0.055, 0.035, 0.026);
export const WATER_DEEP = new Color(0.018, 0.015, 0.014);
export const MUD = new Color(0.12, 0.075, 0.042);
export const OCHRE = new Color(0.58, 0.31, 0.08);
export const LAMP = new Color(1.0, 0.58, 0.18);
export const RUST = new Color(0.42, 0.09, 0.035);
export const RUST_DARK = new Color(0.16, 0.035, 0.022);
export const CREAM = new Color(0.73, 0.56, 0.31);
export const BONE = new Color(0.46, 0.35, 0.22);
export const OILY = new Color(0.035, 0.028, 0.025);
export const INK = new Color(0.002, 0.003, 0.004);
export const SIGNAL = new Color(1.0, 0.045, 0.015);
export const PLAYER = new Color(0.96, 0.72, 0.31);

// Infrared is a charcoal read, not an orange post-filter. The world loses
// most of its detail and the living silhouettes gain a hard white-hot edge.
export const IR_BACKGROUND = new Color(0.006, 0.008, 0.011);
export const IR_CHARCOAL = new Color(0.055, 0.065, 0.075);
export const IR_STEEL = new Color(0.12, 0.14, 0.16);
export const IR_WHITE_HOT = new Color(0.92, 0.95, 0.9);
export const IR_WHITE_EDGE = new Color(1.35, 1.35, 1.18);
export const IR_RED = new Color(1.65, 0.018, 0.008);
export const IR_INK = new Color(0.001, 0.0015, 0.002);

export function hdr(color: Color, intensity: number) {
  return color.clone().multiplyScalar(intensity);
}

export function modeColor(infrared: boolean, normal: Color, thermal: Color) {
  return (infrared ? thermal : normal).clone();
}
