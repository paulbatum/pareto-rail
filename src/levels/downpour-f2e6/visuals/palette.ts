import { Color } from 'three';

// The city is rain-grey black and deep blue-slate. Cyan and magenta signage
// and the courier's own targeting light read against it; sodium-amber is the
// undercity's light; hazard-white belongs to the security forces; acid green
// is reserved for the gunship alone.
export const RAIN_BLACK = new Color(0.01, 0.012, 0.018);
export const SLATE = new Color(0.045, 0.06, 0.095);
export const SLATE_LIGHT = new Color(0.1, 0.13, 0.19);
export const SLATE_WET = new Color(0.06, 0.08, 0.12);

export const CYAN = new Color(0.22, 0.92, 1.0);
export const MAGENTA = new Color(1.0, 0.14, 0.86);
export const AMBER = new Color(1.0, 0.6, 0.14);
export const HAZARD_WHITE = new Color(0.96, 0.98, 1.0);
export const ACID_GREEN = new Color(0.55, 1.0, 0.16);

export const RAIN_STREAK = new Color(0.55, 0.72, 0.85);
export const LIGHTNING = new Color(0.85, 0.92, 1.0);
export const MOONLIGHT = new Color(0.62, 0.72, 0.95);

// The courier drone's own instruments: cold electric white, distinct from
// every hostile and from the city's own signage.
export const DRONE_WHITE = new Color(0.86, 0.94, 1.0);

// Locks charge through the city's own light language: cyan, then magenta,
// then amber — the sixth lock reads as a full-spectrum flare.
export const LOCK_GRADIENT = [CYAN, MAGENTA, AMBER] as const;

export function hdr(color: Color, intensity: number) {
  return color.clone().multiplyScalar(intensity);
}
