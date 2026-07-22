import { Color } from 'three';
import { mulberry32, type Rng } from '../../../engine/rng';

// One rule governs every color in Speedsolve: the six solve colors belong to
// the cube and to nothing else. The void is a pale, softly lit studio grey,
// the cube's shell is graphite, its guts are white-and-grey machinery, and
// every friendly optic — reticle, tracers, lock brackets, letters — is ink and
// bone so it can never be confused with a sticker. Enemy fire is the only
// other thing allowed to carry a solve color, because enemy fire is the cube
// arguing back.

// --- the six solve colors -----------------------------------------------------
// Ordered by cube-local face normal: +Z, +X, -Z, -X, +Y, -Y. Presentation
// order walks that same list, so face k always owns SOLVE_COLORS[k].
export const SOLVE_RED = new Color(1.0, 0.21, 0.26);
export const SOLVE_BLUE = new Color(0.13, 0.55, 1.0);
export const SOLVE_YELLOW = new Color(1.0, 0.79, 0.08);
export const SOLVE_GREEN = new Color(0.13, 0.82, 0.38);
export const SOLVE_ORANGE = new Color(1.0, 0.45, 0.06);
export const SOLVE_VIOLET = new Color(0.68, 0.32, 1.0);

export const SOLVE_COLORS = [SOLVE_RED, SOLVE_BLUE, SOLVE_YELLOW, SOLVE_GREEN, SOLVE_ORANGE, SOLVE_VIOLET] as const;

// --- the void -----------------------------------------------------------------
export const VOID_HIGH = new Color(0.45, 0.47, 0.52);
export const VOID_LOW = new Color(0.19, 0.21, 0.25);
export const VOID_FOG = new Color(0.31, 0.33, 0.37);

// --- hardware -----------------------------------------------------------------
export const GRAPHITE = new Color(0.05, 0.055, 0.068);
export const SHELL = new Color(0.15, 0.16, 0.185);
export const MACHINE_WHITE = new Color(0.78, 0.8, 0.84);
export const MACHINE_GREY = new Color(0.33, 0.35, 0.4);
export const INK = new Color(0.05, 0.055, 0.07);
export const BONE = new Color(0.95, 0.96, 0.98);
export const HOT_WHITE = new Color(1.0, 0.99, 0.96);

// Locks charge ink → bone → hot white. A six-lock charge is the only pure
// white on screen that is not machinery, so it reads as the player's own light.
export const LOCK_GRADIENT = [INK, MACHINE_WHITE, HOT_WHITE] as const;

export function hdr(color: Color, intensity: number) {
  return color.clone().multiplyScalar(intensity);
}

export { mulberry32, type Rng };
