import { Color } from 'three';
import { mulberry32, type Rng } from '../../../engine/rng';

// Skyhook's rule: the sky does the coloring, the hardware stays utilitarian.
// Friendly hardware — tether, car, station, letters, reticle, locks — is
// white paneling and hazard orange. Hostile hardware is gunmetal and graphite
// with signal-red slits so it can never be mistaken for the things you are
// protecting. Nothing is neon; the only saturated hues on screen are the sky
// itself and the two signal colors.
export const PANEL_WHITE = new Color(0.82, 0.84, 0.86);
export const PANEL_SHADOW = new Color(0.3, 0.32, 0.35);
export const HAZARD_ORANGE = new Color(1.0, 0.42, 0.06);
export const AMBER = new Color(1.0, 0.68, 0.22);
export const GUNMETAL = new Color(0.16, 0.17, 0.2);
export const GRAPHITE = new Color(0.09, 0.1, 0.12);
export const SIGNAL_RED = new Color(1.0, 0.16, 0.1);
export const COLD_WHITE = new Color(0.92, 0.96, 1.0);
export const THRUSTER_BLUE = new Color(0.6, 0.78, 1.0);

// Sky keyframes, low to high.
export const STORM_GREY = new Color(0.23, 0.25, 0.27);
export const STORM_ZENITH = new Color(0.12, 0.135, 0.15);
export const DAY_HORIZON = new Color(0.48, 0.6, 0.78);
export const DAY_ZENITH = new Color(0.16, 0.34, 0.68);
export const INDIGO_HORIZON = new Color(0.16, 0.22, 0.42);
export const INDIGO_ZENITH = new Color(0.03, 0.05, 0.16);
export const SPACE_HORIZON = new Color(0.045, 0.06, 0.13);
export const SPACE_ZENITH = new Color(0.004, 0.005, 0.012);

// Locks charge white → amber → hazard orange: the sixth lock reads as the
// car's own warning livery going to full alert.
export const LOCK_GRADIENT = [COLD_WHITE, AMBER, HAZARD_ORANGE] as const;

export function hdr(color: Color, intensity: number) {
  return color.clone().multiplyScalar(intensity);
}

export { mulberry32, type Rng };
