import { Color } from 'three';

export const VOID = new Color(0x010104);
export const NIGHT = new Color(0x05050b);
export const STONE = new Color(0x0b0b12);
export const STONE_EDGE = new Color(0x24232d);
export const LEAD = new Color(0x07070b);
export const CANDLE = new Color(0xffb84f);
export const LOCK_GOLD = new Color(0xffd889);
export const CORE_WHITE = new Color(0xfff4d6);

export const COBALT = new Color(0x194fff);
export const BLOOD = new Color(0xe1122f);
export const BOTTLE = new Color(0x11b46b);
export const GOLD = new Color(0xffb21c);
export const VIOLET = new Color(0x8c3dff);
export const ROSE = new Color(0xff3c87);

export const JEWELS = [COBALT, BLOOD, BOTTLE, GOLD, VIOLET, ROSE] as const;

export function hdr(color: Color, intensity: number) {
  return color.clone().multiplyScalar(intensity);
}

export function jewelAt(index: number) {
  return JEWELS[((index % JEWELS.length) + JEWELS.length) % JEWELS.length].clone();
}

export function mulberry32(seed: number) {
  let value = seed >>> 0;
  return () => {
    value += 0x6d2b79f5;
    let t = value;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
