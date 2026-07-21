import { Color } from 'three';

// One rule holds this level together: heat is electrical, never thermal.
// Everything the barrel does runs arc blue → violet → blinding white as the
// payload accelerates. Acid green is reserved for the defence drones so a
// hostile can never be mistaken for scenery, red belongs only to the firing
// charge, and the player's own hardware is cold ice-white.

export const ARC_BLUE = new Color(0.16, 0.56, 1.0);
export const ARC_VIOLET = new Color(0.58, 0.26, 1.0);
export const WHITE_HOT = new Color(0.94, 0.96, 1.0);
export const BORE_PLATE = new Color(0.055, 0.07, 0.105);
export const BUSBAR = new Color(0.12, 0.3, 0.62);
export const HULL = new Color(0.115, 0.13, 0.165);
export const HOSTILE = new Color(0.28, 1.0, 0.44);
export const DANGER = new Color(1.0, 0.2, 0.09);
export const ICE = new Color(0.72, 0.94, 1.0);
export const VOID = new Color(0.006, 0.009, 0.019);

/** Locks charge along the same ramp the barrel does: the sixth lock is white hot. */
export const LOCK_GRADIENT = [ARC_BLUE, ARC_VIOLET, WHITE_HOT] as const;

export function hdr(color: Color, intensity: number) {
  return color.clone().multiplyScalar(intensity);
}

const ringScratch = new Color();

/** Ring colour for heat in [0, 1]: arc blue, through violet, to blinding white. */
export function ringColor(heat: number, target = new Color()) {
  const t = heat < 0 ? 0 : heat > 1 ? 1 : heat;
  if (t < 0.55) return target.copy(ARC_BLUE).lerp(ARC_VIOLET, t / 0.55);
  return target.copy(ARC_VIOLET).lerp(WHITE_HOT, (t - 0.55) / 0.45);
}

/** Same ramp, pre-multiplied into HDR so bloom picks the hot end up hardest. */
export function ringEmissive(heat: number, gain = 1, target = new Color()) {
  ringColor(heat, target);
  return target.multiplyScalar(gain * (0.85 + heat * 1.9));
}

export function mixColor(from: Color, to: Color, t: number) {
  return ringScratch.copy(from).lerp(to, t).clone();
}
