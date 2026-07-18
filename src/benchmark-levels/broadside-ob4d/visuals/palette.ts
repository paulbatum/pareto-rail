import { Color } from 'three';
import { mulberry32, type Rng } from '../../../engine/rng';

// BROADSIDE's rule: the nebula is the only light source in the level, so every
// hull is a black or near-black silhouette wearing a magenta key rim on its
// upper edge and a gold fill rim underneath. Nothing in the world is lit; it
// is all backlit. That means the two fleets cannot be told apart by hull
// brightness alone, so they are told apart by *signal colour*: everything the
// friendly fleet emits — engines, running lights, broadside fire, your own
// tracers and locks — is cyan. Everything the enemy emits is molten orange at
// rest and crimson when it fires. There is no third signal colour, so any
// crimson on screen is something shooting at you.

// --- the nebula ---------------------------------------------------------------
export const NEBULA_MAGENTA = new Color(0.86, 0.14, 0.6);
export const NEBULA_ROSE = new Color(0.52, 0.1, 0.42);
export const NEBULA_GOLD = new Color(1.0, 0.64, 0.2);
export const NEBULA_EMBER = new Color(0.44, 0.2, 0.08);
export const NEBULA_DEEP = new Color(0.06, 0.02, 0.1);
export const VOID = new Color(0.01, 0.007, 0.018);
export const STARLIGHT = new Color(0.86, 0.88, 1.0);

// --- your fleet ---------------------------------------------------------------
export const ALLY_HULL = new Color(0.66, 0.72, 0.8);
export const ALLY_SHADOW = new Color(0.17, 0.2, 0.26);
export const ALLY_CYAN = new Color(0.24, 0.92, 1.0);
export const ALLY_CYAN_DEEP = new Color(0.05, 0.4, 0.6);

// --- the enemy ----------------------------------------------------------------
export const FOE_HULL = new Color(0.055, 0.048, 0.068);
export const FOE_PLATE = new Color(0.13, 0.115, 0.15);
export const FOE_MOLTEN = new Color(1.0, 0.38, 0.05);
export const FOE_CRIMSON = new Color(1.0, 0.09, 0.13);

// --- shared signal ------------------------------------------------------------
export const WHITE_HOT = new Color(1.0, 0.97, 0.94);
export const GOLD = new Color(1.0, 0.76, 0.32);

// Locks charge cyan → white-hot → gold: your own battery running up to a full
// broadside, ending on the nebula's own gold.
export const LOCK_GRADIENT = [ALLY_CYAN, WHITE_HOT, GOLD] as const;

/** Rim light every hull wears: magenta from above, gold from below. */
export const RIM_KEY = NEBULA_MAGENTA;
export const RIM_FILL = NEBULA_GOLD;

export function hdr(color: Color, intensity: number) {
  return color.clone().multiplyScalar(intensity);
}

export { mulberry32, type Rng };
