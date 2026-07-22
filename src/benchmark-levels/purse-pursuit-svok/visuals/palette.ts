import { Color } from 'three';

/**
 * A pop-video city at night. Everything in the world is warm — sodium amber,
 * tail-light red, the pink haze off the skyline, chrome white — and exactly one
 * thing is blue. Keep it that way: the purse has to read the instant it appears.
 */
export const NIGHT = new Color(0.006, 0.008, 0.022);
export const ASPHALT = new Color(0.012, 0.012, 0.018);
export const CONCRETE = new Color(0.016, 0.015, 0.022);
export const STEEL = new Color(0.16, 0.165, 0.19);

export const AMBER = new Color(1.0, 0.56, 0.12);
export const TAILLIGHT = new Color(1.0, 0.1, 0.08);
export const HEADLIGHT = new Color(1.0, 0.93, 0.82);
export const CHROME = new Color(0.84, 0.88, 0.95);
export const NEON_PINK = new Color(1.0, 0.18, 0.6);
export const CITY_GLOW = new Color(0.5, 0.11, 0.32);
export const GANG_RED = new Color(1.0, 0.26, 0.1);

/** The signature. Nothing else in the level may use it. */
export const PURSE_BLUE = new Color(0.09, 0.36, 1.0);

export const hdr = (color: Color, intensity: number) => color.clone().multiplyScalar(intensity);

/** Per-rider accent. Silhouette carries the read; colour confirms it. */
export const RIDER_ACCENT: Record<string, Color> = {
  weaver: NEON_PINK,
  swinger: AMBER,
  hauler: GANG_RED,
  flyer: HEADLIGHT,
  bomb: TAILLIGHT,
  spike: AMBER,
  boss: GANG_RED,
  letter: AMBER,
};
