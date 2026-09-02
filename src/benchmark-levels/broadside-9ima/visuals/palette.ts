import { Color } from 'three';

// Broadside color palette:
// Deep space is backlit by a colossal magenta-and-gold nebula.
// Friendly fleet: ice-white hull armor with cyan engine glow and cyan fire.
// Enemy fleet: obsidian dark armor streaked with molten orange, firing crimson.

export const VOID_BLACK = new Color(0x04020a);
export const COSMIC_PURPLE = new Color(0x140624);

// Nebula colors
export const NEBULA_MAGENTA = new Color(0xd91682);
export const NEBULA_GOLD = new Color(0xffaa22);
export const NEBULA_VIOLET = new Color(0x6e1485);
export const NEBULA_AMBER = new Color(0xff7733);
export const NEBULA_CYAN_RIM = new Color(0x22c4ff);

// Friendly Fleet (Ice-white & Cyan)
export const FRIENDLY_WHITE = new Color(0xdce8f8);
export const FRIENDLY_STEEL = new Color(0x849bb8);
export const FRIENDLY_CYAN = new Color(0x00e5ff);
export const FRIENDLY_CYAN_HOT = new Color(0x66f5ff);
export const CYAN_BOLT = new Color(0x00f0ff);

// Enemy Fleet (Obsidian & Molten Orange & Crimson)
export const ENEMY_OBSIDIAN = new Color(0x121218);
export const ENEMY_DARK_METAL = new Color(0x20202e);
export const MOLTEN_ORANGE = new Color(0xff6600);
export const MOLTEN_ORANGE_HOT = new Color(0xffaa22);
export const CRIMSON_FIRE = new Color(0xff1844);

// Combat, HUD & Weapons
export const RETICLE_CYAN = new Color(0x22e0ff);
export const LOCK_COLOR = new Color(0x00ffff);
export const DENIED_RED = new Color(0xff2244);
export const DENIED_FILL = new Color(0x35080c);
export const SHIELD_CYAN = new Color(0x44ddff);
export const CORE_ORANGE = new Color(0xff8800);
export const SPARKS_GOLD = new Color(0xffcc44);

export function hdr(color: Color, multiplier: number): Color {
  return color.clone().multiplyScalar(multiplier);
}
