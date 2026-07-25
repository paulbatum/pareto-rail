import { Color } from 'three';

// The cube owns colour. Six bright candy solve hues and nothing else may use
// them: the void is pale, the machinery is white and grey, and the player's own
// optics are graphite with a white-hot core. Enemy fire borrows the cube's hues,
// because the little polyhedra are pieces of the same toy.
//
// All values are linear working colours, not sRGB hex. The void sits around 0.42
// linear (a light grey-blue once encoded) and lit machinery peaks just below 1,
// which leaves the whole range above 1 free for the handful of genuinely hot
// elements the bloom threshold is set to catch.
export const SOLVE_COLORS = [
  new Color(0.90, 0.13, 0.17), // 0 front  — red
  new Color(0.10, 0.68, 0.28), // 1 right  — green
  new Color(0.92, 0.38, 0.05), // 2 back   — orange
  new Color(0.10, 0.32, 0.88), // 3 left   — blue
  new Color(0.90, 0.72, 0.08), // 4 top    — yellow
  new Color(0.52, 0.20, 0.92), // 5 bottom — violet
] as const;

export const MACHINE_WHITE = new Color(0.74, 0.76, 0.81);
export const MACHINE_GREY = new Color(0.46, 0.48, 0.54);
export const MACHINE_DARK = new Color(0.17, 0.18, 0.22);
export const GRAPHITE = new Color(0.07, 0.075, 0.09);
export const HOT_WHITE = new Color(1.0, 0.99, 0.96);

export const VOID_NEAR = new Color(0.355, 0.390, 0.455);
export const VOID_FAR = new Color(0.440, 0.470, 0.535);
export const VOID_CORE = new Color(0.235, 0.255, 0.340);

export function solveColor(index: number) {
  return SOLVE_COLORS[((index % SOLVE_COLORS.length) + SOLVE_COLORS.length) % SOLVE_COLORS.length];
}

/** HDR multiplier: the bloom threshold sits above 1 so only these actually glow. */
export function hdr(color: Color, intensity: number) {
  return color.clone().multiplyScalar(intensity);
}
