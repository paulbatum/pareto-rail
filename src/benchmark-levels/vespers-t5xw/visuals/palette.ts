import { Color } from 'three';

// Jewel light in a black room. The stone is nearly colourless; the candles
// are dim and warm; the ONLY saturated things in the frame are stained glass
// and the stolen panes burning in the thieves' chests.

export const BACKGROUND = new Color(0x07070c);
export const STONE = new Color(0x101016);
export const STONE_DARK = new Color(0x090910);
export const LEAD = new Color(0x23232e);
export const LEAD_LIT = new Color(0x4a4a5c);
export const THIEF_BLACK = new Color(0x020204);
export const THIEF_EDGE = new Color(0x3c3c4c);
export const CANDLE = new Color(0xffa14a);
export const PALE = new Color(0xf5ead2);

// The window colours: deep cobalt, blood red, bottle green, gold, and the
// two rarer hues the rose window keeps for itself.
export const COBALT = new Color(0x2447ff);
export const BLOOD = new Color(0xe01322);
export const BOTTLE = new Color(0x14b34a);
export const GOLD = new Color(0xffb622);
export const AMETHYST = new Color(0x9b3cf0);
export const ROSEWHITE = new Color(0xffe9c9);

export const WINDOW_JEWELS = [COBALT, BLOOD, BOTTLE, GOLD, AMETHYST];
export const PETAL_JEWELS = [COBALT, BLOOD, BOTTLE, GOLD, AMETHYST, ROSEWHITE];

export function hdr(color: Color, intensity: number) {
  return color.clone().multiplyScalar(intensity);
}
