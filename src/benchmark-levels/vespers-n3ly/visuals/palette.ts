import { Color } from 'three';

export const VOID = new Color(0x010106);
export const STONE = new Color(0x090a0f);
export const STONE_EDGE = new Color(0x242634);
export const LEAD = new Color(0x020204);
export const BONE = new Color(0xd8d3c7);
export const CANDLE = new Color(0xffd9a3);

export const COBALT = new Color(0x164dff);
export const BLOOD = new Color(0xe51f38);
export const BOTTLE = new Color(0x00a85a);
export const GOLD = new Color(0xffb21a);

export const GLASS_COLORS = [COBALT, BLOOD, BOTTLE, GOLD] as const;

export function hdr(color: Color, intensity: number) {
  return color.clone().multiplyScalar(intensity);
}
