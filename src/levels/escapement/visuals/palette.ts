import { Color } from 'three';

// Environment colours: lamp-lit brass, steel blue, black void, warm lamp white
// on the lamp only. Brass is lit and never emissive.
export const BRASS = new Color(0.78, 0.55, 0.22);
export const BRASS_DARK = new Color(0.36, 0.24, 0.09);
export const STEEL_BLUE = new Color(0.36, 0.46, 0.6);
export const STEEL_DARK = new Color(0.12, 0.16, 0.24);
export const BLACK_OXIDE = new Color(0.03, 0.03, 0.035);
export const VOID = new Color(0.006, 0.006, 0.01);
export const LAMP_WARM = new Color(1.0, 0.86, 0.62);

// Target accents. No environment surface uses these three colours: every
// lockable thing carries verdigris or ruby plus a white-hot spark, and only the
// bell strike and a target's spark are white-hot.
export const VERDIGRIS = new Color(0.24, 0.86, 0.58);
export const RUBY = new Color(0.92, 0.08, 0.14);
export const RUBY_DULL = new Color(0.42, 0.06, 0.09);
export const WHITE_HOT = new Color(0.96, 0.98, 1.0);
export const CHIME_SILVER = new Color(0.86, 0.9, 0.94);

// Player-owned colours: reticle, locks, shots. Cold so they never blend with brass.
export const LOCK_COLD = new Color(0.55, 0.8, 1.0);
export const LOCK_GRADIENT = [LOCK_COLD, WHITE_HOT, RUBY] as const;

export function hdr(color: Color, intensity: number) {
  return color.clone().multiplyScalar(intensity);
}
