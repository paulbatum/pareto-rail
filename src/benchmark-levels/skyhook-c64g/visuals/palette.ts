import { Color } from 'three';

// Skyhook's colour rules. The SKY does all the colouring — storm grey, sunlit
// blue, indigo, black — so the hardware stays utilitarian: white paneling and
// hazard orange. Nothing neon.
//
// Everything hostile carries hazard orange somewhere; everything the player
// owns (reticle, locks, shots) is a cold white-cyan with a dark keyline, so it
// can never be lost against a storm-grey, sunlit-blue or black backdrop.
// Values are linear-sRGB working-space components (no hex round trip).

export const PANEL_WHITE = new Color(0.78, 0.8, 0.82);
export const PANEL_SHADE = new Color(0.36, 0.38, 0.42);
export const GUNMETAL = new Color(0.075, 0.08, 0.095);
export const CHARCOAL = new Color(0.035, 0.038, 0.048);
export const HAZARD = new Color(1.0, 0.36, 0.045);
export const HAZARD_HOT = new Color(1.0, 0.58, 0.16);
export const AMBER_WARN = new Color(1.0, 0.7, 0.16);
export const ALARM_RED = new Color(1.0, 0.1, 0.06);

// Player instruments.
export const ICE = new Color(0.55, 0.86, 1.0);
export const SIGNAL_WHITE = new Color(1.0, 0.98, 0.94);
export const LOCK_GOLD = new Color(1.0, 0.86, 0.4);
export const LOCK_GRADIENT = [ICE, SIGNAL_WHITE, LOCK_GOLD] as const;
export const KEYLINE = new Color(0.01, 0.012, 0.02);

export function hdr(color: Color, intensity: number) {
  return color.clone().multiplyScalar(intensity);
}

export function mixColor(a: Color, b: Color, t: number) {
  return a.clone().lerp(b, t);
}
