import { Color } from 'three';
import { mulberry32, type Rng } from '../../../engine/rng';

// One idea: sunlit water. The world is clear blue-green shading into deep
// blue; the jelly's own light layers green-gold on top of it. The parasites
// are the only sour note — a sickly violet that never appears anywhere else.
// The player owns pale sunlight (warm white / gold), so locks and shots read
// against both the water and the violet.

export const LAGOON = new Color(0.020, 0.115, 0.118); // clear sunlit teal — near surface
export const MIDWATER = new Color(0.012, 0.062, 0.095); // blue-green mid column
export const DEEPWATER = new Color(0.006, 0.028, 0.058); // deep blue with distance

export const STRAND_GREEN = new Color(0.38, 1.0, 0.58); // strand bioluminescence
export const STRAND_GOLD = new Color(0.86, 1.0, 0.42); // gold-green layer on top
export const BELL_GREEN = new Color(0.30, 0.85, 0.52); // the bell itself, lit through

export const VIOLET = new Color(0.60, 0.28, 0.98); // parasite shell
export const VIOLET_SICK = new Color(0.42, 0.18, 0.62); // membrane, sacs, webbing
export const VIOLET_HOT = new Color(0.82, 0.55, 1.35); // seams and cores (HDR-leaning)

export const PEARL = new Color(1.0, 0.96, 0.84); // player warm white
export const SUNLIGHT = new Color(1.0, 0.88, 0.55); // player gold accent
export const AQUA_WHITE = new Color(0.72, 1.0, 0.94); // cold end of the lock gradient

// Locks charge aqua-white → pearl → gold: the sixth lock reads as full sun.
export const LOCK_GRADIENT = [AQUA_WHITE, PEARL, SUNLIGHT] as const;

export function hdr(color: Color, intensity: number) {
  return color.clone().multiplyScalar(intensity);
}

export { mulberry32, type Rng };
