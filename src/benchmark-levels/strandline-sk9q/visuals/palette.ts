import { Color } from 'three';

// STRANDLINE palette discipline:
// - The WATER is a blue-green gradient, sunlit from above, deep with distance.
// - The ANIMAL is jade and gold bioluminescence: strands, bell, crown, and the
//   player's own marks all come from the same living light.
// - The PARASITES are the only sour note: sickly violet. Nothing friendly is
//   violet, nothing hostile is jade or gold.
// - HDR lives on thin lines and small cores only, so the frame never whites out
//   and everything stays legible with bloom at zero.

// -- the animal (jade → gold living light) --------------------------------------
export const JADE = new Color(0.23, 0.78, 0.55);
export const JADE_DEEP = new Color(0.1, 0.38, 0.3);
export const JADE_SICK = new Color(0.15, 0.36, 0.3); // dimmed strand before cleansing
export const GOLD = new Color(1.0, 0.82, 0.42);
export const GOLD_PALE = new Color(1.0, 0.94, 0.72);
export const BELL_MEMBRANE = new Color(0.3, 0.95, 0.42);

// -- the water --------------------------------------------------------------------
export const WATER_LIT = new Color(0.06, 0.32, 0.38);
export const WATER_DEEP = new Color(0.015, 0.1, 0.19);
export const WATER_CROWN = new Color(0.05, 0.24, 0.3);
export const WATER_SERENE = new Color(0.1, 0.38, 0.4);

// -- the parasites (sickly violet) --------------------------------------------------
export const VIOLET = new Color(0.48, 0.24, 0.68);
export const VIOLET_DARK = new Color(0.2, 0.1, 0.3);
export const VIOLET_HOT = new Color(0.78, 0.42, 1.0);
export const VIOLET_PALE = new Color(0.88, 0.66, 1.0);
export const SOUR = new Color(0.85, 0.3, 0.8);

// -- player marks (warm living light, kin to the animal) -----------------------------
export const MARK_WHITE = new Color(0.98, 0.96, 0.88);
export const MARK_GOLD = new Color(1.0, 0.85, 0.45);
export const DENY_VIOLET = new Color(1.3, 0.2, 0.7);
export const DENY_FILL = new Color(0.3, 0.05, 0.16);

// Locks charge jade → gold → hot white: the cleansing light gathering.
export const LOCK_GRADIENT = [JADE, GOLD, MARK_WHITE] as const;

export function hdr(color: Color, intensity: number) {
  return color.clone().multiplyScalar(intensity);
}
