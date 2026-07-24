import { Color } from 'three';
import { mulberry32, type Rng } from '../../../engine/rng';

// Speedsolve's rule: the cube owns the six bright solve colors and everything
// else stays out of their way. The void is pale and softly lit, the machinery
// inside the cube is white and grey, hostile fire borrows the cube's own
// colors, and the player's optics are ink — dark, precise marks that read
// like drafting instruments against the bright void. Nothing is neon; on a
// pale ground, saturation and darkness do the talking, and HDR is reserved
// for small hot cores so bloom stays honest.
export const SOLVE_COLORS = [
  new Color(0.9, 0.14, 0.18), // red
  new Color(1.0, 0.5, 0.06), // orange
  new Color(1.0, 0.78, 0.08), // yellow
  new Color(0.08, 0.72, 0.34), // green
  new Color(0.12, 0.42, 0.95), // blue
  new Color(0.82, 0.16, 0.72), // magenta
] as const;

export const CHASSIS_LIGHT = new Color(0.68, 0.69, 0.72);
export const CHASSIS_MID = new Color(0.5, 0.51, 0.55);
export const CHASSIS_DARK = new Color(0.34, 0.35, 0.39);
export const MACHINE_DARK = new Color(0.21, 0.215, 0.245);
export const INK = new Color(0.1, 0.1, 0.13);
export const VOID_PALE = new Color(0.895, 0.885, 0.87);
export const VOID_FLOOR = new Color(0.82, 0.8, 0.79);
export const HOT_WHITE = new Color(1.0, 0.99, 0.97);
export const HOT_ORANGE = new Color(1.0, 0.5, 0.14);
export const DENY_RED = new Color(0.85, 0.06, 0.05);

// Locks charge ink → blue → magenta: the sight fills with the cube's own
// late-solve colors as the volley builds.
export const LOCK_GRADIENT = [INK.clone().lerp(SOLVE_COLORS[4], 0.45), SOLVE_COLORS[4], SOLVE_COLORS[5]] as const;

// Letter plates color one glyph per solve color across both words.
export const CHAR_COLORS: Record<string, number> = {
  S: 0, O: 1, L: 2, V: 3, E: 4, '!': 5,
  R: 0, P: 1, A: 3, Y: 5,
};

export function hdr(color: Color, intensity: number) {
  return color.clone().multiplyScalar(intensity);
}

export { mulberry32, type Rng };
