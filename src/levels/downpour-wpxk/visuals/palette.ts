import { Color } from 'three';
import { mulberry32, type Rng } from '../../../engine/rng';

// A rain-lashed megacity at night. The city is wet slate and ink lit by
// signage: cyan and magenta above ground, sodium amber in the undercity,
// hazard white for security hardware. Acid green belongs to the gunship
// alone — nothing else in the level may wear it. The player's own light
// (reticle, locks, shots) is cold moonlight so it survives every district.
export const INK = new Color(0.014, 0.018, 0.03);
export const SLATE = new Color(0.09, 0.12, 0.19);
export const RAIN_GREY = new Color(0.32, 0.38, 0.47);
export const CYAN = new Color(0.16, 0.85, 1.0);
export const MAGENTA = new Color(1.0, 0.2, 0.78);
export const AMBER = new Color(1.0, 0.58, 0.16);
export const HAZARD = new Color(0.95, 0.97, 1.0);
export const ACID = new Color(0.55, 1.0, 0.12);
export const MOON = new Color(0.78, 0.87, 1.0);
export const DENY_RED = new Color(1.0, 0.16, 0.1);

// Locks charge cyan → moonlight → magenta: the sixth lock reads as a full
// signage board igniting.
export const LOCK_GRADIENT = [CYAN, MOON, MAGENTA] as const;

export function hdr(color: Color, intensity: number) {
  return color.clone().multiplyScalar(intensity);
}

export { mulberry32, type Rng };
