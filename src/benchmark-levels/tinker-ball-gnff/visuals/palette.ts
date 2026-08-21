import { Color } from 'three';

// Tinker Ball palette: a warm desk under a lamp. Walnut and paper carry the
// world; brass, button-red, and spool-teal are the accents; glue is near-
// black warm brown with a single hot specular glint so cores read as targets.

export const WOOD = new Color(0x8a5a34);
export const WOOD_DARK = new Color(0x54351e);
export const WOOD_LIGHT = new Color(0xb07c46);
export const LAMP = new Color(0xffd9a0);
export const CREAM = new Color(0xf2e6cf);
export const PAPER = new Color(0xf5eedd);
export const BRASS = new Color(0xd9a441);
export const BUTTON_RED = new Color(0xe04b3a);
export const SPOOL_TEAL = new Color(0x3fa8a0);
export const PENCIL_YELLOW = new Color(0xe8b23a);
export const CARDBOARD = new Color(0xc9a06a);
export const ERASER_PINK = new Color(0xe88c9a);
export const GLUE = new Color(0x17110c);
export const GLUE_SHEEN = new Color(0x584636);
export const ROOM = new Color(0x160e08);

// Lock gradient: cream → brass → button red as the volley fills.
export const LOCK_COLORS = [CREAM, BRASS, BUTTON_RED];

export function hdr(color: Color, intensity: number): Color {
  return color.clone().multiplyScalar(intensity);
}
