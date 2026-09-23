import { Color } from 'three';

// Jewel light in a black room. The glass is the only saturated thing in
// the frame; stone is near-black, candles are pale wax-light, and the
// player's own marks (reticle, locks, shots) are the colour of candle flame.

export const JEWELS: readonly Color[] = [
  new Color(0.06, 0.2, 1.0), // cobalt
  new Color(1.0, 0.05, 0.07), // blood red
  new Color(0.04, 0.72, 0.28), // bottle green
  new Color(1.0, 0.66, 0.1), // gold
];

// Accents a window of each hue carries in its mosaic (Chartres blue with red
// sparks, and so on).
export const JEWEL_ACCENTS: readonly (readonly number[])[] = [
  [1, 3],
  [0, 3],
  [3, 1],
  [1, 0],
];

export const STONE = new Color(0.0055, 0.0052, 0.0068);
export const STONE_LIT = new Color(0.013, 0.012, 0.015);
export const CANDLE = new Color(1.0, 0.7, 0.36);
export const WAX = new Color(1.0, 0.86, 0.62);
export const FLAME = new Color(1.0, 0.82, 0.5);
export const CANDLE_FLAME = new Color(1.0, 0.62, 0.26);
export const LOCK_GOLD = new Color(1.0, 0.8, 0.42);
export const LOCK_WHITE = new Color(1.0, 0.95, 0.85);
export const ASH = new Color(0.6, 0.6, 0.66);
export const VOID = new Color(0.004, 0.004, 0.006);

export const LOCK_GRADIENT = [LOCK_GOLD, new Color(1.0, 0.9, 0.62), LOCK_WHITE] as const;

export function jewel(hue: number) {
  return JEWELS[((Math.round(hue) % 4) + 4) % 4];
}

export function hdr(color: Color, intensity: number) {
  return color.clone().multiplyScalar(intensity);
}
