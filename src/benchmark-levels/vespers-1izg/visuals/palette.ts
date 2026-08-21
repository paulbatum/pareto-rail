import { Color } from 'three';

// The glass is the only saturated thing in the frame. Four jewel panes —
// deep cobalt, blood red, bottle green, gold — burn out of a black-stone
// world kept in near-grays. HDR multipliers push lit glass past 1.0 so bloom
// carries it, but every color also survives at slider-zero through its base
// geometry.
export const COBALT = new Color(0.16, 0.38, 1.0);
export const CRIMSON = new Color(1.0, 0.13, 0.15);
export const VERDANT = new Color(0.12, 0.85, 0.42);
export const GOLD = new Color(1.0, 0.76, 0.22);
export const JEWELS = [COBALT, CRIMSON, GOLD, VERDANT] as const;

export const STONE = new Color(0.42, 0.45, 0.58); // used at low intensity for architecture
export const CANDLE = new Color(1.0, 0.62, 0.26);
export const MOON = new Color(0.78, 0.83, 1.0); // pale cold highlight for rims and shots
export const GLOOM = new Color(0.6, 0.48, 1.0); // hostile bolts: cold violet, never a jewel
export const ASH = new Color(0.5, 0.48, 0.55); // denied/reject feedback

export const BACKGROUND = new Color(0.004, 0.005, 0.012);
export const BODY_BLACK = new Color(0.012, 0.012, 0.022); // the flat black shapes

export function jewelForWindow(index: number): Color {
  return JEWELS[index % JEWELS.length];
}

export function hdr(color: Color, intensity: number): Color {
  return color.clone().multiplyScalar(intensity);
}
