import { Color } from 'three';
import type { Pane } from '../gameplay';

// Jewel light in a black room. The glass is the only saturated thing in the
// frame; everything else is near-black stone and candle amber.
export const COBALT = new Color(0.12, 0.3, 1.0);
export const BLOOD = new Color(1.0, 0.09, 0.07);
export const BOTTLE = new Color(0.12, 0.86, 0.32);
export const GOLD = new Color(1.0, 0.72, 0.18);
export const VIOLET = new Color(0.58, 0.22, 1.0);
export const CANDLE = new Color(1.0, 0.56, 0.2);
export const WHITE_HOT = new Color(1.0, 0.96, 0.86);
export const STONE = new Color(0.016, 0.015, 0.018);
export const VOID = new Color(0.006, 0.006, 0.009);
export const EMBER_RED = new Color(1.0, 0.22, 0.06);

export const PANE_COLORS: Record<Pane, Color> = {
  cobalt: COBALT,
  blood: BLOOD,
  bottle: BOTTLE,
  gold: GOLD,
  violet: VIOLET,
};

export const PANE_ORDER: Pane[] = ['cobalt', 'blood', 'bottle', 'gold', 'violet'];

// Locks walk the sight from gold to white-hot; the sixth lock is ignition.
export const LOCK_GRADIENT = [GOLD, WHITE_HOT] as const;

export function hdr(color: Color, intensity: number): Color {
  return color.clone().multiplyScalar(intensity);
}
