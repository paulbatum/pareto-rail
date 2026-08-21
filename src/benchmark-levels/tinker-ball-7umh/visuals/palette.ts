import { Color } from 'three';
import { mulberry32, type Rng } from '../../../engine/rng';

export { mulberry32, type Rng };

export const WOOD_BASE = new Color(0x9c7048);
export const WOOD_PLANK = new Color(0x7a4e28);
export const WOOD_GRAIN = new Color(0x543217);
export const TABLE_DARK = new Color(0x24150b);
export const LAMP_WARM = new Color(0xffb84d);
export const LAMP_BEAM = new Color(0xffe082);

// Craft supply materials
export const BUTTON_CYAN = new Color(0x00e5ff);
export const BUTTON_MAGENTA = new Color(0xff2a85);
export const BUTTON_YELLOW = new Color(0xffd600);
export const BUTTON_PURPLE = new Color(0xaa00ff);
export const BUTTON_ORANGE = new Color(0xff6d00);
export const BUTTON_LIME = new Color(0x76ff03);

export const PENCIL_YELLOW = new Color(0xffc107);
export const PENCIL_WOOD = new Color(0xe0a96d);
export const PENCIL_LEAD = new Color(0x2c2c2c);
export const ERASER_PINK = new Color(0xff8da1);
export const BRASS_METAL = new Color(0xffab40);
export const STEEL_METAL = new Color(0xd0d8e2);
export const CARDBOARD_KRAFT = new Color(0xbcaaa4);
export const CARDBOARD_DARK = new Color(0x8d6e63);
export const CUTTING_MAT_GREEN = new Color(0x1b5e20);
export const CUTTING_MAT_LINE = new Color(0x81c784);
export const SPOOL_WOOD = new Color(0xd7ccc8);

// Glue & Monster cores
export const GLUE_DARK = new Color(0x120a16);
export const GLUE_PURPLE = new Color(0x2e1236);
export const GLUE_CORE_GLOW = new Color(0xff3d00);
export const GLUE_CORE_HOT = new Color(0xffab00);
export const CLEAN_SPARKLE = new Color(0xffffff);

export const LOCK_COLOR = new Color(0xffd600);
export const DENIED_COLOR = new Color(0xff1744);

export function hdr(base: Color, boost: number): Color {
  return base.clone().multiplyScalar(boost);
}
