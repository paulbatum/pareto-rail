import { Color } from 'three';

// Strandline's whole palette is one idea: sunlit water plus one animal's own
// light, and exactly one colour that does not belong there.
//
//   Water   — clear blue-green up close, deep blue with distance.
//   Sunlight— the surface is somewhere above; everything is lit from up there.
//   Jelly   — green-gold bioluminescence layered on top of the water light.
//   Parasite— sickly violet. Nothing else in the level is violet.
//   Player  — the coldest, cleanest white-gold. Reads on both.

export const WATER_NEAR = new Color(0.026, 0.098, 0.118);
export const WATER_DEEP = new Color(0.007, 0.026, 0.072);
export const WATER_OPEN = new Color(0.020, 0.086, 0.128);
export const WATER_CROWN = new Color(0.016, 0.068, 0.094);
export const WATER_CLEAR = new Color(0.030, 0.118, 0.152);

export const SUNSHAFT = new Color(0.72, 0.94, 0.80);
export const JELLY_GREEN = new Color(0.34, 1.0, 0.56);
export const JELLY_GOLD = new Color(1.0, 0.84, 0.40);
export const JELLY_DEEP = new Color(0.10, 0.46, 0.34);
export const BELL_FLESH = new Color(0.17, 0.44, 0.36);
export const BELL_RIM = new Color(0.42, 0.96, 0.66);

export const PARASITE_VIOLET = new Color(0.60, 0.16, 0.96);
export const PARASITE_PALE = new Color(0.84, 0.56, 1.0);
export const PARASITE_DARK = new Color(0.16, 0.045, 0.28);

export const PLAYER_WHITE = new Color(0.92, 1.0, 0.95);
export const PLAYER_GOLD = new Color(1.0, 0.92, 0.66);

/** Lock charge walks the animal's own light: green → gold → clean white. */
export const LOCK_GRADIENT = [
  JELLY_GREEN.clone(),
  JELLY_GOLD.clone(),
  PLAYER_WHITE.clone(),
] as const;

/** HDR helper: base colour scaled past 1 so bloom picks it up without changing hue. */
export function hdr(color: Color, intensity: number) {
  return color.clone().multiplyScalar(intensity);
}
