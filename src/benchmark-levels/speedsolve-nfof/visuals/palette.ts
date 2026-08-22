import { Color } from 'three';
import { mulberry32 } from '../../../engine/rng';

// SPEEDSOLVE palette discipline: the cube owns the six bright solve colours and
// everything else stays out of their way — a pale, softly lit void, white-and-
// grey machinery inside the cube, and enemy fire tinted in the cube's own
// candy colours. HDR is reserved for small hot cores and thin marks.

export const SOLVE_COLORS = [
  new Color(0xff5257), // red
  new Color(0xffa63d), // orange
  new Color(0xffd84a), // yellow
  new Color(0x4fd07a), // green
  new Color(0x4da3ff), // blue
  new Color(0xb06cff), // violet
] as const;

export const faceColor = (face: number) => SOLVE_COLORS[((face % 6) + 6) % 6];

// -- void ----------------------------------------------------------------------
export const VOID_PALE = 0xe2e6ef;
export const VOID_FOG = 0xd6dbe7;
export const RING_TINT = new Color(0x8d96ac);

// -- machinery ------------------------------------------------------------------
export const MACH_WHITE = new Color(0xe9ebf2);
export const MACH_GREY = new Color(0x9aa1b0);
export const MACH_SHADE = new Color(0x565b68);
export const MACH_DARK = new Color(0x2b2e36);
export const MACH_BLACK = new Color(0x14161b);

// -- player marks ---------------------------------------------------------------
export const MARK_WHITE = new Color(1, 0.99, 0.96);
export const MARK_HOT = new Color(1, 0.9, 0.72);
export const DENY_RED = new Color(1.6, 0.12, 0.06);
export const DENY_FILL = new Color(0.34, 0.04, 0.03);

// Locks charge white → warm → the active face's own solve colour.
export const LOCK_GRADIENT = [MARK_WHITE, MARK_HOT, new Color(1, 0.78, 0.4)] as const;

export function hdr(color: Color, intensity: number) {
  return color.clone().multiplyScalar(intensity);
}

export { mulberry32 };
