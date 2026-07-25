import { Color } from 'three';

// Sodium-harbor murk: tobacco water, ochre haze, rust metal, dirty cream
// paint, hard amber lamps. The octopus is oil-black with a faint cold sheen;
// danger reads as signal red. Infrared swaps the world to charcoal, white-hot
// flesh, and red signal cores.
export const RUST = new Color(0.54, 0.2, 0.09);
export const RUST_DARK = new Color(0.24, 0.1, 0.055);
export const CREAM = new Color(0.9, 0.84, 0.68);
export const CREAM_DIRTY = new Color(0.62, 0.55, 0.42);
export const OCHRE = new Color(0.76, 0.5, 0.16);
export const LAMP = new Color(1.0, 0.7, 0.3);
export const WATER = new Color(0.042, 0.028, 0.015);
export const OIL = new Color(0.045, 0.028, 0.04);
export const OIL_SHEEN = new Color(0.1, 0.13, 0.12);
export const SIGNAL_RED = new Color(1.0, 0.09, 0.05);
export const INK_BLACK = new Color(0.016, 0.012, 0.016);
export const PALE_SICK = new Color(0.62, 0.7, 0.58);

// Infrared display values. Cold values are authored in linear space: 0.02
// linear reads as deep charcoal after sRGB encoding, not mid-gray.
export const IR_HOT = new Color(1.0, 0.98, 0.95);
export const IR_WARM = new Color(0.42, 0.4, 0.38);
export const IR_COLD = new Color(0.02, 0.021, 0.024);
export const IR_BLACK = new Color(0.007, 0.007, 0.009);

// Atmosphere states the mode driver lerps between.
export const ATMOS = {
  murk: { background: new Color(0.052, 0.034, 0.016), fog: new Color(0.068, 0.044, 0.022), density: 0.019 },
  blind: { background: new Color(0.01, 0.007, 0.007), fog: new Color(0.016, 0.011, 0.011), density: 0.085 },
  ir: { background: new Color(0.02, 0.021, 0.024), fog: new Color(0.022, 0.023, 0.026), density: 0.006 },
  lamps: { background: new Color(0.085, 0.058, 0.028), fog: new Color(0.1, 0.068, 0.034), density: 0.013 },
} as const;

export function hdr(color: Color, intensity: number) {
  return color.clone().multiplyScalar(intensity);
}
