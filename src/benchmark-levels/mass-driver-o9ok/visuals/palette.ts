import { Color } from 'three';

// MASS DRIVER is electric, never fire. The gun's own hardware runs a single
// heat ramp — arc blue → indigo → violet → blinding white — and nothing else in
// the level is allowed on that ramp. The one warm colour belongs to the defence
// drones, so "the thing trying to stop you" is always the odd colour out.

/** Cold end of the coil ramp: a coil at rest. */
export const ARC_BLUE = new Color(0.18, 0.62, 1.0);
/** Mid ramp: current is flowing. */
export const INDIGO = new Color(0.42, 0.46, 1.0);
/** Hot ramp: the coil is working. */
export const VIOLET = new Color(0.68, 0.3, 1.0);
/** Top of the ramp. Reserved for the charge peak and the shot. */
export const WHITE_ARC = new Color(1.0, 0.96, 1.0);

/** Unlit barrel structure. Carries silhouette when bloom is off. */
export const GUN_STEEL = new Color(0.15, 0.18, 0.27);
export const GUN_STEEL_LIT = new Color(0.3, 0.36, 0.52);

/** Defence drones. The only warm hue in the barrel. */
export const DRONE_AMBER = new Color(1.0, 0.58, 0.12);
export const DRONE_SHELL = new Color(0.22, 0.16, 0.12);
/** Interlock housings: amber hardware clamped onto the gun's own violet. */
export const INTERLOCK_WARN = new Color(1.0, 0.36, 0.16);

/** Deep space past the muzzle. */
export const VOID = new Color(0.004, 0.006, 0.016);
export const BARREL_HAZE = new Color(0.02, 0.045, 0.1);
export const CHARGE_HAZE = new Color(0.1, 0.06, 0.16);

/** Charge ramp for lock count: cold blue at one lock, white arc at six. */
export const LOCK_GRADIENT = [ARC_BLUE, VIOLET, WHITE_ARC] as const;

/**
 * The coil heat ramp as a function of run progress. Coils do not get hotter
 * because time passed — they get hotter because more current is going through
 * them, so this is driven by the same 0→1 the speed profile produces.
 */
export function coilHeatColor(heat: number, target = new Color()) {
  const t = Math.min(1, Math.max(0, heat));
  if (t < 0.45) return target.copy(ARC_BLUE).lerp(INDIGO, t / 0.45);
  if (t < 0.8) return target.copy(INDIGO).lerp(VIOLET, (t - 0.45) / 0.35);
  return target.copy(VIOLET).lerp(WHITE_ARC, (t - 0.8) / 0.2);
}

/** HDR lift so bloom picks a colour up, without changing its hue at bloom 0. */
export function hdr(color: Color, intensity: number) {
  return color.clone().multiplyScalar(1 + intensity);
}
