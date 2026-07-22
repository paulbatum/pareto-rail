import { Color } from 'three';

export const NIGHT = new Color(0x05030d);
export const ASPHALT = new Color(0x0b0b11);
export const CHROME = new Color(0xc9d0d8);
export const AMBER = new Color(0xff9b24);
export const HOT_PINK = new Color(0xff3d91);
export const TAIL_RED = new Color(0xff261f);
export const VIOLET = new Color(0x8d4dff);
export const WHITE = new Color(0xfff4de);
// Story color. No scenery, target optics, projectiles, or UI use this blue.
export const PURSE_BLUE = new Color(0x087cff);

export const hdr = (color: Color, intensity: number) => color.clone().multiplyScalar(intensity);
