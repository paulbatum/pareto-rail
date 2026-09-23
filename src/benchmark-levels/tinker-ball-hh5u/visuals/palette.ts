import { Color } from 'three';

// Tinker Ball palette: honey-oak worktable under a warm lamp, clean toy-box
// supplies, and one enemy colour — wet black glue with an oily sheen.

export const hex = (value: number) => new Color(value);

export const TABLE_OAK = hex(0xb07a45);
export const TABLE_DARK = hex(0x6b4524);
export const TABLE_PALE = hex(0xe2b77e);
export const SCRATCH = hex(0xf3d6a6);
export const FOG = hex(0x3a2619);
export const DOME_TOP = hex(0x0e0906);
export const WALNUT = hex(0x4a2f1c);
export const CLEAR = 0x1a110b;

export const LAMP_WARM = hex(0xffd9a3);
export const LAMP_BULB = hex(0xfff2d6);
export const ROOM_SKY = hex(0xffe7c8);
export const ROOM_GROUND = hex(0x3b2515);
export const WINDOW_COOL = hex(0xa9c4ff);

export const GLUE = hex(0x0b070e);
export const GLUE_SHEEN = hex(0x6b4fd6);
export const GLUE_SHEEN_ALT = hex(0x2fb6a2);

// Clean supplies: the colours the ball collects.
export const TOMATO = hex(0xe8452c);
export const MUSTARD = hex(0xf2b632);
export const TEAL = hex(0x1fa39a);
export const COBALT = hex(0x2f5fd0);
export const MINT = hex(0x8fdcb0);
export const BLUSH = hex(0xf49aa6);
export const CREAM = hex(0xf5ead2);
export const PLUM = hex(0x8c4a9e);
export const LEAF = hex(0x4f9d3a);
export const TANGERINE = hex(0xf5822a);
export const STEEL = hex(0xc9ccd2);
export const KRAFT = hex(0xb9895a);
export const PINE = hex(0xdcb785);
export const GRAPHITE = hex(0x2e2d33);
export const GLASS = hex(0xbfdcdc);

export const TOY_COLORS = [TOMATO, MUSTARD, TEAL, COBALT, MINT, BLUSH, CREAM, PLUM, LEAF, TANGERINE];

// Player colours: the reticle and shots are citrus solvent — the only thing
// that cuts glue — so they read warm-bright against every surface.
export const SOLVENT = hex(0xffc83a);
export const SOLVENT_HOT = hex(0xfff0b8);
export const LOCK_COLORS = [hex(0xffd23a), hex(0xff9a2e), hex(0xff5f4a), hex(0xff3d8b), hex(0xc24dff), hex(0x5fd3ff)];
export const DENY = hex(0x8a8f99);

export const BALL_IVORY = hex(0xf7efe0);
export const BALL_STRIPE = hex(0xe63b2e);
export const BALL_STAR = hex(0x2f6fe0);

export function hdr(color: Color, intensity: number) {
  return color.clone().multiplyScalar(intensity);
}
