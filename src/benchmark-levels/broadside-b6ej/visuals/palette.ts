import { Color } from 'three';

export const VOID = new Color(0x14051c);
export const NEBULA_MAGENTA = new Color(0x5a0b52);
export const NEBULA_GOLD = new Color(0xb96b21);
export const FRIENDLY_HULL = new Color(0x314753);
export const FRIENDLY_EDGE = new Color(0xa8d4e0);
export const CYAN = new Color(0x3ee9ff);
export const ENEMY_HULL = new Color(0x0e0913);
export const ENEMY_PLATE = new Color(0x382038);
export const ORANGE = new Color(0xff761f);
export const CRIMSON = new Color(0xff244f);
export const WHITE = new Color(0xffffff);
export const GOLD = new Color(0xffcf63);

export function hdr(color: Color, intensity = 1) { return color.clone().multiplyScalar(intensity); }

export function mulberry32(seed: number) {
  return () => {
    let value = seed += 0x6d2b79f5;
    value = Math.imul(value ^ value >>> 15, value | 1);
    value ^= value + Math.imul(value ^ value >>> 7, value | 61);
    return ((value ^ value >>> 14) >>> 0) / 4294967296;
  };
}
