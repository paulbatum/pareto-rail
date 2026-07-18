import { Color } from 'three';
import { mulberry32, type Rng } from '../../../engine/rng';

// Strandline's rule: the water and the animal do the coloring, and the two
// sides of the fight can never be confused. The jellyfish is green-gold
// bioluminescence over clear blue-green water lit from above; everything the
// player does — reticle, locks, shots, letters — is the same clean light in
// white, green, and gold. The parasites are the only violet in the ocean:
// a sickly ultraviolet with bruised magenta cores, sour on purpose.
export const WATER_DEEP = new Color(0.012, 0.05, 0.1);
export const WATER_MID = new Color(0.05, 0.2, 0.26);
export const SUN_SHAFT = new Color(0.55, 0.85, 0.75);
export const JELLY_GREEN = new Color(0.35, 1.0, 0.55);
export const JELLY_GOLD = new Color(1.0, 0.82, 0.35);
export const STRAND_TEAL = new Color(0.22, 0.62, 0.55);
export const BELL_GLOW = new Color(0.45, 0.95, 0.5);
export const CORE_WHITE = new Color(0.9, 1.0, 0.92);
export const PARASITE_VIOLET = new Color(0.62, 0.24, 0.95);
export const PARASITE_BRUISE = new Color(0.4, 0.1, 0.5);
export const PARASITE_CORE = new Color(0.95, 0.35, 0.85);
export const HUSK_GREY = new Color(0.1, 0.09, 0.13);

// Locks charge white → jelly green → gold: six locks reads as the diver's
// lamp going to full cleansing burn.
export const LOCK_GRADIENT = [CORE_WHITE, JELLY_GREEN, JELLY_GOLD] as const;

// Deny is the infestation's color thrown back at you.
export const DENY_VIOLET = new Color(1.1, 0.2, 1.0);

export function hdr(color: Color, intensity: number) {
  return color.clone().multiplyScalar(intensity);
}

export { mulberry32, type Rng };
