import { Color } from 'three';
import { mulberry32, type Rng } from '../../../engine/rng';

// Skyhook rides a climber car up a space elevator. The sky does the coloring —
// storm grey down in the weather, sunlit blue above the deck, indigo as it
// thins, black at the station — and the hardware stays utilitarian: white
// paneling, hazard orange, dark steel. Nothing neon. Everything the player owns
// (reticle, locks, shots) is a clean ice-white that reads against every sky,
// and the locks charge white → hazard so a full charge looks like ignition.

// --- sky (backgrounds by altitude) ---
export const STORM = new Color(0.13, 0.15, 0.19);
export const SUNLIT = new Color(0.15, 0.27, 0.44);
export const INDIGO = new Color(0.045, 0.065, 0.16);
export const VOID = new Color(0.006, 0.010, 0.028);

// --- clouds / atmosphere ---
export const CLOUD = new Color(0.40, 0.44, 0.50);
export const CLOUD_LIT = new Color(0.62, 0.64, 0.68);
export const SUN_GOLD = new Color(1.0, 0.86, 0.58);
export const PLANET = new Color(0.20, 0.42, 0.72);
export const PLANET_LIMB = new Color(0.55, 0.78, 1.0);

// --- hardware ---
export const PANEL = new Color(0.90, 0.92, 0.95);
export const STEEL = new Color(0.17, 0.19, 0.23);
export const HAZARD = new Color(1.0, 0.50, 0.08);
export const HAZARD_HOT = new Color(1.0, 0.66, 0.24);
export const WARN = new Color(1.0, 0.16, 0.09);

// --- player ---
export const ICE = new Color(0.82, 0.94, 1.0);
export const ICE_HOT = new Color(0.92, 0.97, 1.0);
export const STAR = new Color(0.92, 0.95, 1.0);

// Locks charge ice-white → panel-white → hazard: a full lock reads as ignition.
export const LOCK_GRADIENT = [ICE, PANEL, HAZARD] as const;

export function hdr(color: Color, intensity: number) {
  return color.clone().multiplyScalar(intensity);
}

export { mulberry32, type Rng };
