import { Color } from 'three';

// Two complete palettes, one world. Every surface in the level declares a murk
// colour and an infrared colour; the shared imager uniform crossfades between
// them, so switching senses repaints the whole harbour at once instead of
// tinting it.

// --- Sodium-harbour murk: tobacco water, ochre grit, rust, dirty cream paint.
export const WATER = new Color(0.032, 0.022, 0.013);
export const HAZE = new Color(0.320, 0.205, 0.082);
export const SILT = new Color(0.170, 0.110, 0.052);
export const RUST = new Color(0.520, 0.200, 0.072);
export const IRON = new Color(0.205, 0.170, 0.132);
export const CREAM = new Color(0.760, 0.665, 0.470);
export const LAMP = new Color(1.0, 0.585, 0.155);
export const FLESH = new Color(0.185, 0.126, 0.116);
export const FLESH_LIT = new Color(0.380, 0.205, 0.165);
export const ICHOR = new Color(0.620, 0.240, 0.300);
export const INK = new Color(0.010, 0.008, 0.009);

// --- Infrared: stark charcoal, white-hot bodies, red signal cores, cold voids.
export const COLD = new Color(0.052, 0.056, 0.064);
export const COLD_EDGE = new Color(0.170, 0.182, 0.200);
export const WARM = new Color(0.330, 0.280, 0.235);
export const HOT = new Color(0.950, 0.965, 1.0);
export const EMBER = new Color(1.0, 0.560, 0.230);
export const SIGNAL = new Color(1.0, 0.135, 0.045);
export const VOID = new Color(0, 0, 0);

export function hdr(color: Color, intensity: number): Color {
  return color.clone().multiplyScalar(intensity);
}

export function mixColor(a: Color, b: Color, t: number): Color {
  return a.clone().lerp(b, t);
}
