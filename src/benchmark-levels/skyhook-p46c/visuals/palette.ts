import { Color } from 'three';
import { mulberry32, type Rng } from '../../../engine/rng';

// Utilitarian hardware against a sky that does all the coloring. Hardware is
// panel white and hazard orange; hostiles are storm-grey chitin with pale
// cores low down and darker vacuum shells higher; the player owns signal
// green (nav-light green, kept desaturated — nothing neon).
export const PANEL_WHITE = new Color(0.75, 0.78, 0.82);
export const PANEL_SHADOW = new Color(0.16, 0.18, 0.21);
export const HAZARD_ORANGE = new Color(1.0, 0.42, 0.06);
export const WARN_AMBER = new Color(1.0, 0.68, 0.16);
export const STORM_GREY = new Color(0.42, 0.46, 0.52);
export const CHITIN = new Color(0.1, 0.11, 0.14);
export const PALE_CORE = new Color(0.78, 0.86, 0.95);
export const SIGNAL_GREEN = new Color(0.45, 0.95, 0.55);
export const SIGNAL_WHITE = new Color(0.88, 0.96, 0.9);
export const DANGER_RED = new Color(1.0, 0.16, 0.1);

// Locks charge green → white → amber: the sixth lock reads as commit.
export const LOCK_GRADIENT = [SIGNAL_GREEN, SIGNAL_WHITE, WARN_AMBER] as const;

export function hdr(color: Color, intensity: number) {
  return color.clone().multiplyScalar(intensity);
}

export { mulberry32, type Rng };
