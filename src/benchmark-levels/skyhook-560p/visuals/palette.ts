import { Color } from 'three';
import { mulberry32, type Rng } from '../../../engine/rng';

// Skyhook is deliberately un-neon. Everything built by people is white
// paneling, grey structure and hazard orange; everything else is sky. The sky
// does all the colouring, and it drains from storm grey to black over the
// climb, so the same white hull reads warm at the bottom and clinical at the top.
export const PANEL_WHITE = new Color(0.90, 0.92, 0.94);
export const PANEL_GREY = new Color(0.30, 0.33, 0.38);
export const PANEL_DARK = new Color(0.10, 0.11, 0.14);
export const STEEL = new Color(0.52, 0.58, 0.66);
export const HAZARD = new Color(1.0, 0.46, 0.07);
export const HAZARD_DEEP = new Color(0.52, 0.18, 0.02);
export const ALERT = new Color(1.0, 0.16, 0.10);

// Sky ramp: the four altitudes the run passes through.
export const SKY_STORM = new Color(0.088, 0.098, 0.116);
export const SKY_SUNLIT = new Color(0.105, 0.235, 0.470);
export const SKY_INDIGO = new Color(0.038, 0.052, 0.130);
export const SKY_VOID = new Color(0.004, 0.006, 0.016);

export const SUNLIGHT = new Color(1.0, 0.95, 0.85);
export const CLOUD_GREY = new Color(0.36, 0.39, 0.44);
export const CLOUD_LIT = new Color(0.80, 0.81, 0.82);
export const STARLIGHT = new Color(0.82, 0.87, 1.0);

// Locks charge from cold instrument cyan through white to hazard orange: the
// sixth lock is the colour of the warning stripes on the car itself.
export const INSTRUMENT = new Color(0.42, 0.78, 0.92);
export const LOCK_GRADIENT = [INSTRUMENT, PANEL_WHITE, HAZARD] as const;

export function hdr(color: Color, intensity: number) {
  return color.clone().multiplyScalar(intensity);
}

export { mulberry32, type Rng };
