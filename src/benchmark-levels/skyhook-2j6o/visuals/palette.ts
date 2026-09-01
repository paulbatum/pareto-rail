import { Color } from 'three';
import { mulberry32, type Rng } from '../../../engine/rng';

// Utilitarian hardware, coloured by the sky. Everything the player owns or
// rides is white paneling with hazard orange; everything hostile is charcoal
// hardware with red marker lights; the targeting instrument is a pale cyan
// white that never appears in the world. No neon: the sky does the colouring.
export const PANEL = new Color(0.66, 0.68, 0.72);
export const PANEL_DARK = new Color(0.2, 0.22, 0.25);
export const GUNMETAL = new Color(0.1, 0.11, 0.13);
export const HAZARD_ORANGE = new Color(1.0, 0.5, 0.06);
export const CHARCOAL = new Color(0.075, 0.08, 0.09);
export const HOSTILE_RED = new Color(1.0, 0.2, 0.08);
export const INSTRUMENT = new Color(0.62, 0.88, 1.0);
export const INSTRUMENT_HOT = new Color(0.95, 0.98, 1.0);
export const WARNING_RED = new Color(1.0, 0.1, 0.06);
export const SUN_WHITE = new Color(1.0, 0.97, 0.9);

// Sky phases: storm → sunlit → indigo → black. Values are linear; the renderer
// displays them through the sRGB transfer, so mid-greys here read as pale
// skies on screen, and every large area stays under the bloom threshold.
export const SKY = {
  storm: { horizon: new Color(0.2, 0.21, 0.24), zenith: new Color(0.075, 0.085, 0.105), fog: new Color(0.19, 0.2, 0.23) },
  sunlit: { horizon: new Color(0.33, 0.42, 0.55), zenith: new Color(0.05, 0.16, 0.46), fog: new Color(0.32, 0.4, 0.52) },
  indigo: { horizon: new Color(0.06, 0.085, 0.2), zenith: new Color(0.01, 0.012, 0.045), fog: new Color(0.05, 0.07, 0.16) },
  black: { horizon: new Color(0.008, 0.012, 0.028), zenith: new Color(0.0, 0.0, 0.002), fog: new Color(0.004, 0.005, 0.012) },
} as const;

// Locks charge instrument-white → hot white → hazard orange: six is a warning.
export const LOCK_GRADIENT = [INSTRUMENT, INSTRUMENT_HOT, HAZARD_ORANGE] as const;

export function hdr(color: Color, intensity: number) {
  return color.clone().multiplyScalar(intensity);
}

export { mulberry32, type Rng };
