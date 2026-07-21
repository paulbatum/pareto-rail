import { Color } from 'three';

// Two families, and the level never mixes them up.
//
// The gun is electric: arc blue climbing through violet to blinding white as
// the coils are driven harder. Hot here means voltage, never fire.
//
// Everything hostile is a fault light: sodium amber and warning red. The jammed
// interlocks are the loudest fault in the barrel, which is exactly why they
// read as targets the moment they appear.

export const ARC_BLUE = new Color(0.18, 0.60, 1.0);
export const ARC_CYAN = new Color(0.42, 0.86, 1.0);
export const VIOLET = new Color(0.58, 0.26, 1.0);
export const MAGENTA = new Color(0.92, 0.32, 0.98);
export const WHITE_HOT = new Color(0.90, 0.95, 1.0);

export const STEEL = new Color(0.24, 0.29, 0.40);
export const BORE_WALL = new Color(0.105, 0.130, 0.205);
export const BORE_FOG = new Color(0.012, 0.018, 0.042);
export const VOID = new Color(0.002, 0.003, 0.010);

export const FAULT_AMBER = new Color(1.0, 0.52, 0.10);
export const FAULT_RED = new Color(1.0, 0.16, 0.07);

/** Locks walk the coil ramp, so charging a volley looks like charging the gun. */
export const LOCK_GRADIENT = [ARC_CYAN, VIOLET, WHITE_HOT] as const;

/** Scale a base colour into HDR so bloom picks it up; base colour still reads at bloom 0. */
export function hdr(color: Color, intensity: number) {
  return color.clone().multiplyScalar(intensity);
}

/**
 * The coil ramp: how hot a given accelerator ring burns, from the breech (arc
 * blue) through the mid-barrel (violet) to the muzzle (white). `t` is position
 * along the barrel in 0..1.
 */
export function coilColor(t: number, target = new Color()) {
  const clamped = Math.min(1, Math.max(0, t));
  if (clamped < 0.55) return target.copy(ARC_BLUE).lerp(VIOLET, clamped / 0.55);
  return target.copy(VIOLET).lerp(WHITE_HOT, (clamped - 0.55) / 0.45);
}
