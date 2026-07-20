import { Color } from 'three';

export const VOID = new Color(0x01030a);
export const GUNMETAL = new Color(0x111827);
export const STEEL = new Color(0x273346);
export const ARC_BLUE = new Color(0x19a7ff);
export const ION_BLUE = new Color(0x73d8ff);
export const VIOLET = new Color(0x7f32ff);
export const HOT_VIOLET = new Color(0xc277ff);
export const ION_WHITE = new Color(0xeafcff);
export const HAZARD_AMBER = new Color(0xff9d18);
export const HAZARD_RED = new Color(0xff2438);
export const LOCK_GRADIENT = [ARC_BLUE, new Color(0x31c6ff), new Color(0x587cff), VIOLET, HOT_VIOLET, ION_WHITE];

export const hdr = (color: Color, intensity = 1) => color.clone().multiplyScalar(intensity);

export function heatColor(t: number) {
  const x = Math.max(0, Math.min(1, t));
  if (x < 0.58) return ARC_BLUE.clone().lerp(VIOLET, x / 0.58);
  return VIOLET.clone().lerp(ION_WHITE, (x - 0.58) / 0.42);
}
