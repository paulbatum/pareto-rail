import { Color } from 'three';

export const WOOD = new Color(0x7f421f);
export const WOOD_LIGHT = new Color(0xb36b36);
export const WOOD_DARK = new Color(0x4b241c);
export const PAPER = new Color(0xffe5ad);
export const CARDBOARD = new Color(0xc98949);
export const GRAPHITE = new Color(0x251c22);
export const GLUE_BLACK = new Color(0x08070b);
export const GLUE_RIM = new Color(0x302432);
export const CREAM = new Color(0xfff4d1);
export const CORAL = new Color(0xff4f5e);
export const YELLOW = new Color(0xffc928);
export const CYAN = new Color(0x26d9d0);
export const BLUE = new Color(0x3377d6);
export const MINT = new Color(0x71e09b);
export const VIOLET = new Color(0xa35bdc);
export const ORANGE = new Color(0xff8a34);

export const SUPPLY_COLORS = [CORAL, YELLOW, CYAN, BLUE, MINT, VIOLET, ORANGE] as const;

export function hdr(color: Color, intensity: number) {
  return color.clone().multiplyScalar(intensity);
}
