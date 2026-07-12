import { Color } from 'three';

export const VOID = new Color(0x010306);
export const GUNMETAL = new Color(0x161d22);
export const PLATE = new Color(0x273139);
export const EDGE = new Color(0x53606a);
export const ALERT_RED = new Color(0xff2618);
export const AMBER = new Color(0xff9a22);
export const HEAT = new Color(0xffd07a);
export const PLAYER = new Color(0x9ed9ff);
export const WHITE = new Color(0xe8f2f5);
export const hdr = (color: Color, intensity: number) => color.clone().multiplyScalar(intensity);

export function mulberry32(seed: number) {
  return () => {
    let value = seed += 0x6d2b79f5;
    value = Math.imul(value ^ value >>> 15, value | 1);
    value ^= value + Math.imul(value ^ value >>> 7, value | 61);
    return ((value ^ value >>> 14) >>> 0) / 4294967296;
  };
}
