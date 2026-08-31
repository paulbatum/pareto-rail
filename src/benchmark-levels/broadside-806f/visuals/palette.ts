import { Color } from 'three';

export const VOID = new Color(0x03020a);
export const NEBULA_DEEP = new Color(0x24052d);
export const NEBULA_MAGENTA = new Color(0xb3187c);
export const NEBULA_GOLD = new Color(0xffa83d);
export const STAR_WHITE = new Color(0xe9f6ff);

export const FRIENDLY_HULL = new Color(0xc9d9e4);
export const FRIENDLY_SHADOW = new Color(0x344654);
export const CYAN = new Color(0x48eaff);
export const ICE = new Color(0xdffaff);

export const ENEMY_HULL = new Color(0x110f18);
export const ENEMY_EDGE = new Color(0x49302f);
export const MOLTEN = new Color(0xff7a22);
export const CRIMSON = new Color(0xff2448);
export const SHIELD = new Color(0xf04a9b);

export function hdr(color: Color, intensity = 1) {
  return color.clone().multiplyScalar(intensity);
}
