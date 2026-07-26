import { Color } from 'three';

// Warm desk-lamp world: honey wood, cream lamplight, and bright craft-supply
// accents against matte charcoal glue. Hot elements go through hdr() so bloom
// picks them up while base colors stay legible with bloom at zero.

export const WOOD = new Color(0.5, 0.315, 0.155);
export const WOOD_DARK = new Color(0.335, 0.2, 0.095);
export const LAMP_CREAM = new Color(1.0, 0.87, 0.6);
export const LAMP_EDGE = new Color(0.5, 0.33, 0.16);
export const ROOM_DARK = new Color(0.055, 0.038, 0.028);

export const GLUE_BLACK = new Color(0.052, 0.048, 0.062);
export const GLUE_SHEEN = new Color(0.36, 0.2, 0.5);
export const CORE_VIOLET = new Color(0.72, 0.24, 0.95);
export const CORE_HOT = new Color(1.0, 0.42, 0.9);

export const BUTTON_RED = new Color(0.88, 0.2, 0.16);
export const COBALT = new Color(0.2, 0.42, 0.92);
export const MUSTARD = new Color(0.95, 0.7, 0.14);
export const TEAL = new Color(0.12, 0.68, 0.6);
export const CREAM = new Color(0.94, 0.88, 0.74);
export const PENCIL_YELLOW = new Color(0.96, 0.72, 0.12);
export const ERASER_PINK = new Color(0.93, 0.5, 0.54);
export const SPOOL_PLUM = new Color(0.6, 0.3, 0.62);
export const CARDBOARD = new Color(0.62, 0.44, 0.24);
export const CLIP_SILVER = new Color(0.72, 0.74, 0.78);

export const WARM_WHITE = new Color(1.0, 0.94, 0.82);
export const LOCK_AMBER = new Color(1.0, 0.62, 0.18);
export const DENY_RED = new Color(1.0, 0.24, 0.14);

/** Craft accents cycled by the letter blocks and rescued pieces. */
export const CRAFT_CYCLE = [BUTTON_RED, COBALT, MUSTARD, TEAL, ERASER_PINK, SPOOL_PLUM] as const;

export function hdr(color: Color, intensity: number) {
  return color.clone().multiplyScalar(intensity);
}
