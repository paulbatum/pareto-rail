import { Color } from 'three';

// Warm worktable language: honey wood, lamplight amber, bright supply
// colors (button red/teal/yellow, bead blue), and near-black violet glue.
// HDR multipliers push small hot accents past 1.0 for bloom; base geometry
// and flat colors carry readability with bloom at zero.
export const WOOD = new Color(0.36, 0.23, 0.12);
export const WOOD_DARK = new Color(0.2, 0.12, 0.06);
export const LAMP = new Color(1.0, 0.82, 0.55);
export const AMBER = new Color(1.0, 0.62, 0.2);
export const BRASS = new Color(0.85, 0.6, 0.25);
export const CREAM = new Color(0.96, 0.89, 0.73);
export const PAPER = new Color(0.9, 0.87, 0.78);
export const BUTTON_RED = new Color(0.9, 0.16, 0.22);
export const BUTTON_TEAL = new Color(0.12, 0.72, 0.66);
export const BUTTON_YELLOW = new Color(1.0, 0.78, 0.18);
export const BEAD_BLUE = new Color(0.25, 0.45, 0.95);
export const BEAD_GREEN = new Color(0.3, 0.75, 0.35);
export const PENCIL = new Color(0.8, 0.55, 0.12);
export const ERASER_PINK = new Color(0.95, 0.55, 0.6);
export const CARDBOARD = new Color(0.72, 0.55, 0.33);
export const GLUE_DARK = new Color(0.04, 0.015, 0.07);
export const GLUE_VIOLET = new Color(0.55, 0.22, 0.9);
export const CORE_WHITE = new Color(1.0, 0.96, 0.88);
export const BACKGROUND = new Color(0.07, 0.045, 0.032);

export const SUPPLY_COLORS = [BUTTON_RED, BUTTON_TEAL, BUTTON_YELLOW, BEAD_BLUE, BEAD_GREEN, ERASER_PINK];

export function hdr(color: Color, intensity: number): Color {
  return color.clone().multiplyScalar(intensity);
}
