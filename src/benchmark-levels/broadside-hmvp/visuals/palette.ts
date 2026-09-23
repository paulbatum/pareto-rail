import { Color } from 'three';

// BROADSIDE palette. Two navies and one sky.
//
// The sky is a vast magenta-and-gold nebula; it backlights everything, so
// hulls read as silhouettes with colored rims. The sides read by color:
// our fleet is ice-white with cyan engines and cyan fire; the enemy is
// obsidian veined with molten orange and fires crimson. Nothing else is
// allowed to be cyan or crimson — those two colors mean "ours" and "theirs".

// ---- sky ----
export const NEBULA_MAGENTA = new Color(0.86, 0.1, 0.52);
export const NEBULA_ROSE = new Color(0.95, 0.32, 0.5);
export const NEBULA_GOLD = new Color(1.0, 0.66, 0.24);
export const NEBULA_DUST = new Color(0.05, 0.012, 0.045);
export const DEEP_SPACE = new Color(0.008, 0.004, 0.018);
export const HAZE = new Color(0.07, 0.02, 0.06);

// ---- our fleet ----
export const ICE_WHITE = new Color(0.82, 0.9, 1.0);
export const HULL_WHITE = new Color(0.46, 0.5, 0.56);
export const HULL_WHITE_DARK = new Color(0.2, 0.23, 0.28);
export const CYAN = new Color(0.25, 0.92, 1.0);
export const CYAN_DEEP = new Color(0.05, 0.45, 0.75);

// ---- the enemy ----
export const OBSIDIAN = new Color(0.028, 0.022, 0.03);
export const OBSIDIAN_EDGE = new Color(0.07, 0.05, 0.06);
export const MOLTEN = new Color(1.0, 0.42, 0.08);
export const MOLTEN_HOT = new Color(1.0, 0.72, 0.3);
export const CRIMSON = new Color(1.0, 0.08, 0.12);
export const CRIMSON_DEEP = new Color(0.5, 0.02, 0.05);

// ---- feedback ----
export const DENY = new Color(1.0, 0.05, 0.08);
export const WHITE_HOT = new Color(1.0, 0.95, 0.85);

/** Lock charge: cold cyan → ice white → gold as the volley fills. */
export const LOCK_GRADIENT = [new Color(0.25, 0.92, 1.0), new Color(0.8, 0.95, 1.0), new Color(1.0, 0.78, 0.3)] as const;

export function hdr(color: Color, intensity: number) {
  return color.clone().multiplyScalar(intensity);
}

export type Rng = () => number;
