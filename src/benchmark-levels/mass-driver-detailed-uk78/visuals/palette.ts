import { Color } from 'three';

export const VOID = new Color(0x01040b);
export const BORE_BLACK = new Color(0x050b14);
export const GUNMETAL = new Color(0x172333);
export const GUNMETAL_LIGHT = new Color(0x34445a);
export const ARC_BLUE = new Color(0x20a9ff);
export const VOLT_VIOLET = new Color(0x8b48ff);
export const ION_WHITE = new Color(0xe8f7ff);
export const HAZARD_AMBER = new Color(0xffa21a);
export const HAZARD_RED = new Color(0xff203d);

export function hot(color: Color, intensity = 1) {
  return color.clone().multiplyScalar(intensity);
}

export function heatColor(t: number) {
  const clamped = Math.min(1, Math.max(0, t));
  if (clamped < 0.58) return ARC_BLUE.clone().lerp(VOLT_VIOLET, clamped / 0.58);
  return VOLT_VIOLET.clone().lerp(ION_WHITE, (clamped - 0.58) / 0.42);
}

export function colorForLockCount(count: number) {
  return heatColor(Math.min(1, Math.max(0, count / 6)));
}

export function mulberry32(seed: number) {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}
