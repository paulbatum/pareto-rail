import { Color } from 'three';
import { mulberry32, type Rng } from '../../../engine/rng';

// Strandline's rule: the water and the animal do the coloring; the infestation
// is the only sour note. Water is clear blue-green shading into deep blue with
// distance, lit through from above. The jelly's own light is green-gold —
// bioluminescent strands, gonad lobes, the bell's rim. Everything hostile is
// sickly violet with magenta-white cores, so a parasite can never be mistaken
// for the thing you are freeing. Player fire is the animal's own light.

// Colors are linear; the display encodes to sRGB, so mid-tones read brighter
// than these numbers suggest. Water and skins are kept low and saturated.
export const WATER_SHALLOW = new Color(0.14, 0.46, 0.46);
export const WATER_MID = new Color(0.035, 0.2, 0.34);
export const WATER_DEEP = new Color(0.008, 0.045, 0.14);
export const WATER_ABYSS = new Color(0.003, 0.014, 0.06);
export const WATER_HAZE = new Color(0.07, 0.28, 0.4); // fog: matches the lit water so distance fades, not silhouettes
export const SUN_SHAFT = new Color(0.62, 0.9, 0.78);

export const JELLY_GREEN = new Color(0.3, 0.92, 0.46);
export const JELLY_GOLD = new Color(0.98, 0.8, 0.36);
export const JELLY_MEMBRANE = new Color(0.16, 0.6, 0.4);
export const JELLY_DIM = new Color(0.04, 0.18, 0.14);
export const CLEAN_WHITE = new Color(0.9, 1.0, 0.92);

export const PARASITE_VIOLET = new Color(0.4, 0.06, 0.68);
export const PARASITE_PLUM = new Color(0.06, 0.015, 0.09);
export const PARASITE_MAGENTA = new Color(1.0, 0.3, 0.9);
export const PARASITE_SICK = new Color(0.22, 0.08, 0.32);

// Locks charge green → gold → clean white: the animal's light gathering in the sight.
export const LOCK_GRADIENT = [JELLY_GREEN, JELLY_GOLD, CLEAN_WHITE] as const;

export function hdr(color: Color, intensity: number) {
  return color.clone().multiplyScalar(intensity);
}

export { mulberry32, type Rng };
