import { Color } from 'three';
import type { Rng } from '../../../engine/rng';

// The three-color neon language everything draws from: dominant cyan,
// secondary magenta, sparse amber accents. HDR multipliers push values
// past 1.0 so bloom picks them up.
export const CYAN = new Color(0.27, 0.91, 1.0);
export const MAGENTA = new Color(1.0, 0.24, 0.75);
export const AMBER = new Color(1.0, 0.66, 0.22);
export const CORE_WHITE = new Color(0.85, 0.97, 1.0);

export const BACKGROUND = new Color(0.006, 0.012, 0.035);

export type { Rng };

// Weighted palette pick; weights = [cyan, magenta, amber].
export function pickColor(rng: Rng, weights: [number, number, number]): Color {
  const total = weights[0] + weights[1] + weights[2];
  const roll = rng() * total;
  if (roll < weights[0]) return CYAN;
  if (roll < weights[0] + weights[1]) return MAGENTA;
  return AMBER;
}

export function hdr(color: Color, intensity: number): Color {
  return color.clone().multiplyScalar(intensity);
}
