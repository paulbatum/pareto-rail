import { Color } from 'three';

export const VOID = new Color(0.0015, 0.002, 0.009);
export const BARREL = new Color(0.014, 0.02, 0.055);
export const BARREL_EDGE = new Color(0.075, 0.12, 0.28);
export const ARC_BLUE = new Color(0.08, 0.42, 1.25);
export const ION_CYAN = new Color(0.18, 1.05, 1.55);
export const COIL_VIOLET = new Color(0.62, 0.12, 1.65);
export const CHARGE_WHITE = new Color(2.2, 2.45, 3.2);
export const DRONE_FILL = new Color(0.035, 0.045, 0.11);
export const DRONE_EDGE = new Color(0.22, 0.5, 1.1);
export const WARNING = new Color(1.35, 0.12, 0.72);
export const DENIED = new Color(1.7, 0.04, 0.22);

export function hdr(color: Color, intensity: number) {
  return color.clone().multiplyScalar(intensity);
}

export function chargeColor(progress: number) {
  const p = Math.max(0, Math.min(1, progress));
  const color = ARC_BLUE.clone();
  if (p < 0.68) color.lerp(COIL_VIOLET, p / 0.68);
  else color.copy(COIL_VIOLET).lerp(CHARGE_WHITE, (p - 0.68) / 0.32);
  return color.multiplyScalar(0.72 + p * p * 0.75);
}

