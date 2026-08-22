import { Color } from 'three';
import { mulberry32, type Rng } from '../../../engine/rng';

// THERMAL INK's two realities. Normal sight is sodium-harbor murk: tobacco
// brown water, ochre haze, rust-red metal, dirty cream paint, hard lamps. The
// thermal display is stark charcoal: enemies blaze white-hot, vulnerable
// points burn as red signal cores, ink stays cold black, and the player's own
// tech reads as sea-glass in both worlds so nothing is ever lost.

export const MURK_BG = new Color(0.075, 0.048, 0.02);
export const FOG_MURK = new Color(0.095, 0.062, 0.026);
export const IR_BG = new Color(0.008, 0.011, 0.014);
export const IR_FOG = new Color(0.012, 0.016, 0.02);

export const RUST = new Color(0.4, 0.17, 0.08);
export const RUST_DARK = new Color(0.16, 0.07, 0.04);
export const CREAM = new Color(0.72, 0.65, 0.48);
export const SODIUM = new Color(1.0, 0.58, 0.16);
export const OCHRE = new Color(0.85, 0.46, 0.13);
export const OIL = new Color(0.052, 0.038, 0.046); // octopus flesh: an oily near-black
export const OIL_EDGE = new Color(0.5, 0.35, 0.19);
export const SIGNAL_RED = new Color(1.7, 0.09, 0.05);
export const SEA_GLASS = new Color(0.55, 0.95, 0.82);
export const WHITE_WARM = new Color(1.0, 0.93, 0.78);

// Thermal-display counterparts.
export const IR_HOT = new Color(1.9, 1.8, 1.6); // white-hot silhouettes
export const IR_WARM = new Color(0.9, 0.82, 0.66);
export const IR_METAL = new Color(0.14, 0.17, 0.19); // cold wreckage stays dark
export const IR_ENV = new Color(0.11, 0.14, 0.16);

// Locks charge cream → sea-glass → white-hot; the sixth lock is ignition.
export const LOCK_GRADIENT = [CREAM, SEA_GLASS, WHITE_WARM] as const;

export function hdr(color: Color, intensity: number) {
  return color.clone().multiplyScalar(intensity);
}

export { mulberry32, type Rng };
