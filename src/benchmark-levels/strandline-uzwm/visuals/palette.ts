import { Color } from 'three';

// Strandline's rule: the water does the coloring, the animals carry the
// light. Friendly light — reticle, locks, projectiles, letters, the jelly's
// own bioluminescence — is sunlit aqua and green-gold. The only sour note is
// the sickly violet of the parasites. Nothing hostile may borrow the
// green-gold; nothing friendly may borrow the violet.
export const SUNLIT_AQUA = new Color(0.35, 0.85, 0.8);
export const SHALLOW_TEAL = new Color(0.12, 0.45, 0.5);
export const DEEP_BLUE = new Color(0.015, 0.08, 0.2);
export const ABYSS = new Color(0.004, 0.02, 0.06);
export const JELLY_GREEN = new Color(0.35, 0.95, 0.45);
export const BLOOM_GOLD = new Color(1.0, 0.8, 0.3);
export const PARASITE_VIOLET = new Color(0.62, 0.2, 0.95);
export const SICKLY_MAGENTA = new Color(0.95, 0.15, 0.6);
export const BONE_WHITE = new Color(0.88, 0.94, 0.88);
export const CORE_WHITE = new Color(0.95, 1.0, 0.98);

// Locks charge aqua → green → gold: the sixth lock reads as the jelly's own
// bioluminescence going to full brightness.
export const LOCK_GRADIENT = [SUNLIT_AQUA, JELLY_GREEN, BLOOM_GOLD] as const;

export function hdr(color: Color, intensity: number) {
  return color.clone().multiplyScalar(intensity);
}
