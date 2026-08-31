import { Color } from 'three';

// The sky carries the color. Hardware stays civic, ceramic, and serviceable.
export const STORM_SKY = new Color(0x151c22);
export const RAIN_GREY = new Color(0x66727a);
export const CLOUD_GREY = new Color(0xa8afb0);
export const CLOUD_WHITE = new Color(0xe7e5dc);
export const SUNLIT_BLUE = new Color(0x4f8eb8);
export const HIGH_BLUE = new Color(0x274f80);
export const INDIGO = new Color(0x171d46);
export const ORBIT_BLACK = new Color(0x02050b);

export const PANEL_WHITE = new Color(0xd8d8cf);
export const PANEL_SHADE = new Color(0x777d7e);
export const GRAPHITE = new Color(0x171b1c);
export const STEEL = new Color(0x50585a);
export const HAZARD_ORANGE = new Color(0xe26822);
export const HAZARD_PALE = new Color(0xffad61);
export const IMPACT_RED = new Color(0xb62c1f);
export const WINDOW_BLUE = new Color(0x8db2c4);

export function hdr(color: Color, intensity: number) {
  return color.clone().multiplyScalar(intensity);
}
