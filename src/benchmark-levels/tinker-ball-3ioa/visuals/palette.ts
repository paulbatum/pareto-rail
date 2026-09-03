import { Color } from 'three';
import { mulberry32, type Rng } from '../../../engine/rng';

// A worktable under a desk lamp: warm wood, warm haze, candy-colored supplies,
// and glossy black glue. The player's own things — reticle, locks, shots, the
// sparkle of rescued materials — are cool mint and chalk so they never get
// lost against the warm table.
export const WOOD = new Color(0.5, 0.31, 0.17);
export const WOOD_DARK = new Color(0.36, 0.21, 0.11);
export const WOOD_SCRATCH = new Color(0.82, 0.64, 0.42);
export const WOOD_CLEAN = new Color(0.9, 0.7, 0.46);
export const LAMP_WARM = new Color(1.0, 0.84, 0.58);
export const ROOM_DARK = new Color(0.05, 0.03, 0.03);
export const HAZE = new Color(0.15, 0.09, 0.055);
export const GLUE = new Color(0.018, 0.014, 0.02);
export const GLUE_SHEEN = new Color(0.16, 0.05, 0.22);
export const MINT = new Color(0.45, 1.0, 0.82);
export const CHALK = new Color(0.96, 0.98, 0.94);
export const GOLD = new Color(1.0, 0.78, 0.3);
export const DENY = new Color(1.0, 0.26, 0.08);
export const DENY_DIM = new Color(0.32, 0.06, 0.02);

export const SILVER = new Color(0.84, 0.86, 0.92);
export const PENCIL_YELLOW = new Color(0.98, 0.76, 0.2);
export const CARDBOARD = new Color(0.76, 0.6, 0.42);
export const WOOD_LIGHT = new Color(0.86, 0.7, 0.5);
export const ERASER_PINK = new Color(1.0, 0.56, 0.62);
export const GLASS = new Color(0.82, 0.9, 0.9);
export const POT_WHITE = new Color(0.94, 0.93, 0.88);

export const CANDY = [
  new Color(0.95, 0.22, 0.24), // red
  new Color(1.0, 0.8, 0.18), // yellow
  new Color(0.16, 0.72, 0.68), // teal
  new Color(0.24, 0.46, 0.92), // blue
  new Color(1.0, 0.52, 0.16), // orange
  new Color(0.96, 0.95, 0.9), // white
  new Color(0.98, 0.5, 0.72), // pink
  new Color(0.42, 0.78, 0.3), // green
  new Color(0.62, 0.36, 0.86), // violet
] as const;

// Locks charge mint → chalk → gold: the sixth lock is the ball beaming.
export const LOCK_GRADIENT = [MINT, CHALK, GOLD] as const;

export function hdr(color: Color, intensity: number) {
  return color.clone().multiplyScalar(intensity);
}

export function candy(rng: Rng): Color {
  return CANDY[Math.floor(rng() * CANDY.length)].clone();
}

export { mulberry32, type Rng };
