import { Color, Vector3 } from 'three';
import { mulberry32 } from '../../../engine/rng';
import type { LightRig } from './hull-kit';

// One idea: a battle silhouetted against a magenta-and-gold nebula. Every hull
// is dark on the face that looks at the player and rimmed in nebula light on the
// faces that turn away. Sides read by color alone: the fleet is ice-white with
// cyan glow and cyan fire; the enemy is obsidian streaked with molten orange and
// fires crimson. The player's own colors (reticle, locks, shots) are cyan-white
// so they can never be lost against the enemy's warm palette.

export const NEBULA_MAGENTA = new Color(0.9, 0.12, 0.55);
export const NEBULA_GOLD = new Color(1.0, 0.66, 0.2);
export const NEBULA_VIOLET = new Color(0.2, 0.05, 0.3);
export const NEBULA_DEEP = new Color(0.03, 0.012, 0.06);
export const SPACE = new Color(0.006, 0.003, 0.014);

export const ICE = new Color(0.68, 0.8, 0.94);
export const ICE_DARK = new Color(0.32, 0.4, 0.54);
export const CYAN = new Color(0.16, 0.86, 1.0);
export const CYAN_HOT = new Color(0.7, 1.0, 1.0);

export const OBSIDIAN = new Color(0.17, 0.15, 0.2);
export const OBSIDIAN_DARK = new Color(0.08, 0.07, 0.1);
export const MOLTEN = new Color(1.0, 0.4, 0.05);
export const CRIMSON = new Color(1.0, 0.09, 0.18);
export const CRIMSON_HOT = new Color(1.0, 0.5, 0.42);

export const WHITE_HOT = new Color(1.0, 0.95, 0.84);
export const WINDOW = new Color(1.0, 0.82, 0.5);

export const hdr = (color: Color, intensity: number) => color.clone().multiplyScalar(intensity);
export { mulberry32 };

/** Player colors: cold cyan, ice white, and the nebula's gold when the volley is full. */
export const LOCK_GRADIENT = [CYAN, CYAN_HOT, WHITE_HOT] as const;

const direction = (x: number, y: number, z: number) => new Vector3(x, y, z).normalize();

/** The nebula sits ahead and above: gold from high ahead, magenta and amber raking both flanks. */
export const FRIENDLY_RIG: LightRig = {
  ambient: new Color(0.034, 0.05, 0.085),
  keys: [
    { toLight: direction(0.2, 0.6, -0.75), color: new Color(0.95, 0.82, 0.78), power: 0.36 },
    { toLight: direction(-0.7, -0.05, -0.7), color: new Color(0.95, 0.2, 0.68), power: 0.3 },
    { toLight: direction(0.7, 0.1, -0.7), color: new Color(1.0, 0.55, 0.25), power: 0.22 },
    { toLight: direction(0.4, -0.5, 0.75), color: new Color(0.12, 0.5, 0.8), power: 0.12 },
  ],
};

export const ENEMY_RIG: LightRig = {
  ambient: new Color(0.06, 0.042, 0.09),
  keys: [
    { toLight: direction(0.2, 0.6, -0.75), color: new Color(1.0, 0.62, 0.26), power: 0.62 },
    { toLight: direction(-0.7, -0.05, -0.7), color: new Color(1.0, 0.16, 0.64), power: 0.3 },
    { toLight: direction(0.7, 0.1, -0.7), color: new Color(1.0, 0.5, 0.2), power: 0.2 },
    { toLight: direction(0.3, -0.7, 0.55), color: new Color(0.7, 0.16, 0.1), power: 0.3 },
  ],
};

export type ShipLook = {
  rig: LightRig;
  hull: Color;
  hullDark: Color;
  trim: Color;
  accent: Color;
  /** Running-light / engine color. */
  engine: Color;
  window: Color;
  seam: Color;
  gun: Color;
};

export const FRIENDLY_LOOK: ShipLook = {
  rig: FRIENDLY_RIG,
  hull: ICE,
  hullDark: ICE_DARK,
  trim: new Color(0.62, 0.74, 0.9),
  accent: CYAN,
  engine: hdr(CYAN, 1.7),
  window: hdr(WINDOW, 1.5),
  seam: hdr(CYAN, 1.7),
  gun: new Color(0.55, 0.66, 0.8),
};

export const ENEMY_LOOK: ShipLook = {
  rig: ENEMY_RIG,
  hull: OBSIDIAN,
  hullDark: OBSIDIAN_DARK,
  trim: new Color(0.36, 0.3, 0.38),
  accent: MOLTEN,
  engine: hdr(MOLTEN, 2.0),
  window: hdr(CRIMSON, 1.1),
  seam: hdr(MOLTEN, 1.7),
  gun: new Color(0.3, 0.16, 0.16),
};

/** Small hostile craft are lit in their own frame: warm from the nose-high side, magenta from behind. */
export const CRAFT_RIG: LightRig = {
  ambient: new Color(0.2, 0.16, 0.26),
  keys: [
    { toLight: direction(0.3, 0.85, -0.45), color: new Color(1.0, 0.7, 0.4), power: 0.9 },
    { toLight: direction(-0.6, 0.1, 0.7), color: new Color(0.9, 0.25, 0.7), power: 0.6 },
  ],
};

/** The shield is enemy tech: molten amber-rose, never the fleet's cyan. */
export const SHIELD_ROSE = new Color(1.0, 0.36, 0.5);
export const SHIELD_AMBER = new Color(1.0, 0.62, 0.22);
