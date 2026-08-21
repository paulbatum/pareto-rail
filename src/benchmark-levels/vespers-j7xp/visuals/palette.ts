import { Color } from 'three';

// Cathedral stone palette: deep black gothic stonework and dark iron lead
export const BACKGROUND = new Color(0.002, 0.002, 0.005);
export const STONE_BLACK = new Color(0.015, 0.016, 0.022);
export const STONE_DARK = new Color(0.035, 0.038, 0.05);
export const STONE_RIB = new Color(0.07, 0.075, 0.095);
export const STONE_HIGHLIGHT = new Color(0.12, 0.13, 0.16);
export const LEAD_CAME = new Color(0.02, 0.022, 0.028);

// Stained glass jewel tones: the ONLY saturated things in the cathedral
export const COBALT = new Color(0.06, 0.35, 1.4);       // Deep cobalt blue
export const CRIMSON = new Color(1.3, 0.08, 0.16);      // Blood red ruby
export const EMERALD = new Color(0.05, 1.1, 0.45);      // Bottle / emerald green
export const GOLD = new Color(1.4, 0.82, 0.08);         // Radiant gold / amber
export const AMETHYST = new Color(0.85, 0.15, 1.25);    // Sacred violet
export const CANDLE_WARMTH = new Color(1.3, 0.55, 0.08); // Candlelight sea
export const PURE_LIGHT = new Color(1.5, 1.45, 1.35);   // Blinding white / gold core

export type GlassColorName = 'cobalt' | 'crimson' | 'emerald' | 'gold';

export const GLASS_PALETTE: Record<GlassColorName, Color> = {
  cobalt: COBALT,
  crimson: CRIMSON,
  emerald: EMERALD,
  gold: GOLD,
};

export const GLASS_COLOR_LIST: GlassColorName[] = ['cobalt', 'crimson', 'emerald', 'gold'];

export function colorForGlass(name: GlassColorName): Color {
  return GLASS_PALETTE[name] ?? COBALT;
}

export function hdr(color: Color, intensity: number): Color {
  return color.clone().multiplyScalar(intensity);
}
