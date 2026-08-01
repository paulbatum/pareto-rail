import { Color } from 'three';

// VESPERS — jewel light in a black room. The glass colours are the only
// saturated things in the frame; the stone is near-black. HDR multipliers
// push the glass past 1.0 so bloom turns it into light.
export const COBALT = new Color(0.1, 0.3, 1.0);      // deep cobalt window glass
export const BLOOD = new Color(0.92, 0.05, 0.1);     // blood red
export const BOTTLE = new Color(0.05, 0.62, 0.32);   // bottle green
export const GOLD = new Color(1.0, 0.68, 0.14);      // gold
export const VIOLET = new Color(0.58, 0.18, 0.9);    // deep violet (rose accents)

export const CANDLE = new Color(1.0, 0.72, 0.42);    // candle flame
export const WHITE_HOT = new Color(1.0, 0.95, 0.82); // the light itself

// The stone: near-black blue-greys. Edges and lines sit a step brighter so
// the architecture reads against the void without breaking the dark.
export const STONE = new Color(0.035, 0.04, 0.07);
export const STONE_DARK = new Color(0.018, 0.02, 0.038);
export const STONE_EDGE = new Color(0.1, 0.115, 0.175);
export const STONE_LINE = new Color(0.06, 0.07, 0.11);

export const BACKGROUND = new Color(0.003, 0.004, 0.012);

// The window palette: pane enemies cycle it, and each relit window takes the
// colour of the pane that stripped it. The rose holds every colour at once.
export const WINDOW_PALETTE = [COBALT, BLOOD, BOTTLE, GOLD, VIOLET] as const;

// The reticle/lock walk: gold sight, then the glass colours as locks charge.
export const LOCK_GRADIENT = [GOLD, COBALT, BLOOD, BOTTLE, VIOLET, WHITE_HOT] as const;

export function hdr(color: Color, intensity: number): Color {
  return color.clone().multiplyScalar(intensity);
}
