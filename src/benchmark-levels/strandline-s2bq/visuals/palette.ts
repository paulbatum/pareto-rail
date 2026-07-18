import { Color } from 'three';
import { mulberry32, type Rng } from '../../../engine/rng';

// Strandline's rule: the water and the animal do the coloring — clear
// blue-green shading to deep blue with distance, lit from somewhere above,
// with the jelly's own green-gold bioluminescence layered on top. The one
// sour note in the palette is the parasites' sickly violet; nothing friendly
// ever wears it. The player's own light is warm sun-gold.
export const SUN_GOLD = new Color(1.0, 0.82, 0.45);
export const WARM_WHITE = new Color(1.0, 0.96, 0.85);
export const BIO_GREEN = new Color(0.45, 1.0, 0.62);
export const BIO_GOLD = new Color(0.85, 0.95, 0.5);
export const STRAND_GLOW = new Color(0.5, 0.95, 0.65);
export const DEEP_TEAL = new Color(0.06, 0.28, 0.3);
export const JELLY_FLESH = new Color(0.2, 0.5, 0.42);

// The infestation.
export const PARASITE_VIOLET = new Color(0.62, 0.24, 0.85);
export const PARASITE_MURK = new Color(0.16, 0.08, 0.2);
export const PARASITE_HOT = new Color(0.95, 0.3, 0.75);
export const VENOM_GREEN = new Color(0.75, 0.95, 0.35);

// Water keyframes, near to far / early to late.
export const SUNLIT_TEAL = new Color(0.16, 0.5, 0.52);
export const MID_BLUE = new Color(0.07, 0.3, 0.42);
export const DEEP_BLUE = new Color(0.02, 0.1, 0.24);
export const ABYSS_BLUE = new Color(0.008, 0.045, 0.13);

// Locks charge warm white → gold → bio-green: a full six-lock volley reads
// as borrowed sunlight ready to be given back to the animal.
export const LOCK_GRADIENT = [WARM_WHITE, SUN_GOLD, BIO_GREEN] as const;

export function hdr(color: Color, intensity: number) {
  return color.clone().multiplyScalar(intensity);
}

export { mulberry32, type Rng };
