import { Color } from 'three';

export function hdr(color: number | string, multiplier = 1): Color {
  return new Color(color).multiplyScalar(multiplier);
}

// ---- Faction Palettes -----------------------------------------------------

// Friendly Fleet (The Republic / Allied Vanguard)
// Sleek naval armor hulls with luminous cyan power systems
export const ICE_WHITE = new Color(0xd8e8f4);
export const ICE_WHITE_HULL = new Color(0x283645);       // Matte naval slate alloy
export const ICE_WHITE_PLATE = new Color(0x42566c);      // Secondary armor plates
export const ALLY_ACCENT_BLUE = new Color(0x1e2c3a);
export const CYAN_GLOW = hdr(0x00d8ff, 1.5);
export const CYAN_FIRE = hdr(0x00ffff, 2.0);
export const CYAN_BEAM = hdr(0x00e5ff, 1.8);

// Enemy Fleet (The Obsidian Armada)
// Deep obsidian armor with molten orange heat sinks and crimson plasma
export const OBSIDIAN_HULL = new Color(0x0a0c10);
export const OBSIDIAN_ARMOR = new Color(0x141820);
export const MOLTEN_ORANGE = hdr(0xff6600, 1.8);
export const MOLTEN_ORANGE_DIM = new Color(0x803000);
export const CRIMSON_FIRE = hdr(0xff1535, 2.0);
export const CRIMSON_GLOW = hdr(0xd50025, 1.5);

// Space Opera Nebula Backdrop (Magenta & Gold)
export const SPACE_VOID = new Color(0x020106);
export const NEBULA_MAGENTA = hdr(0xd81075, 1.2);
export const NEBULA_MAGENTA_DEEP = new Color(0x3a0420);
export const NEBULA_GOLD = hdr(0xf59e0b, 1.2);
export const NEBULA_GOLD_DEEP = new Color(0x452400);
export const STAR_WHITE = hdr(0xffffff, 1.2);

// Targeting, Reticle, and HUD
export const RETICLE_CYAN = hdr(0x00f5ff, 1.5);
export const RETICLE_LOCKED = hdr(0xffd700, 2.0);
export const DENY_CRIMSON = hdr(0xff2244, 2.0);
export const LOCK_GRADIENT = [
  CYAN_FIRE,
  hdr(0x18e8ff, 1.8),
  hdr(0x3ac0ff, 1.9),
  hdr(0x7890ff, 2.0),
  hdr(0xd070ff, 2.1),
  hdr(0xffd700, 2.2),
] as const;
