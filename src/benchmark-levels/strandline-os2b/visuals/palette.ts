import { Color } from 'three';
import { mulberry32, type Rng } from '../../../engine/rng';

// Strandline's rule: the water and the animal own the whole frame, and there
// is exactly one wrong colour in it. Everything alive is green-gold read
// through clear blue-green water; everything parasitic is a sickly violet that
// appears nowhere else. The player's own optics are the palest warm white, so
// locks, tracers and the reticle read as light rather than as another creature.

// --- the water, near to far -------------------------------------------------
export const SUNLIT_WATER = new Color(0.10, 0.34, 0.33);
export const MID_WATER = new Color(0.045, 0.19, 0.26);
export const DEEP_WATER = new Color(0.012, 0.055, 0.155);
export const ABYSS = new Color(0.004, 0.02, 0.075);

// --- the animal -------------------------------------------------------------
export const BIO_GREEN = new Color(0.30, 0.98, 0.60);
export const BIO_GOLD = new Color(1.0, 0.84, 0.40);
export const BIO_DIM = new Color(0.10, 0.36, 0.28);
export const BELL_JADE = new Color(0.20, 0.72, 0.52);
export const BELL_RIM = new Color(0.66, 1.0, 0.76);
export const SUNSHAFT = new Color(0.58, 0.95, 0.82);

// --- the infestation --------------------------------------------------------
export const PARASITE_VIOLET = new Color(0.62, 0.20, 0.95);
export const PARASITE_HOT = new Color(0.92, 0.44, 1.0);
export const PARASITE_SHELL = new Color(0.16, 0.06, 0.24);
export const WEBBING = new Color(0.44, 0.24, 0.62);

// --- the player -------------------------------------------------------------
export const LUMEN = new Color(0.94, 1.0, 0.94);

/** Locks charge from bioluminescent green through gold to a white-hot sixth. */
export const LOCK_GRADIENT = [BIO_GREEN, BIO_GOLD, LUMEN] as const;

export function hdr(color: Color, intensity: number) {
  return color.clone().multiplyScalar(intensity);
}

/** Mix toward another colour without mutating either. */
export function blend(from: Color, to: Color, t: number) {
  return from.clone().lerp(to, t);
}

export { mulberry32, type Rng };
