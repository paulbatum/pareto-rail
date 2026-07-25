import { Color } from 'three';
import { mulberry32, type Rng } from '../../../engine/rng';

// Vespers is a black room with jewels in it. Only glass is allowed to be
// saturated; stone, lead and bone stay desaturated and dim so the contrast
// never collapses. HDR multipliers push glass past 1.0 so bloom catches it,
// but every glass value is bright enough to read with the bloom slider at 0.
export const COBALT = new Color(0.10, 0.30, 1.0);
export const BLOOD = new Color(1.0, 0.09, 0.10);
export const BOTTLE = new Color(0.05, 0.85, 0.32);
export const GOLD = new Color(1.0, 0.70, 0.15);
export const VIOLET = new Color(0.58, 0.17, 1.0);

/** The five panes the cathedral is glazed with; enemies steal one of these. */
export const GLASS = [COBALT, BLOOD, BOTTLE, GOLD, VIOLET] as const;

export const STONE = new Color(0.0085, 0.0100, 0.0165);
export const LEAD = new Color(0.075, 0.082, 0.105);
export const CANDLE = new Color(1.0, 0.55, 0.18);
export const BONE = new Color(0.86, 0.89, 0.96);
export const NIGHT = new Color(0.004, 0.006, 0.017);

/** Locks charge cold glass → bone → gold: the sixth lock reads as ignition. */
export const LOCK_GRADIENT = [COBALT, BONE, GOLD] as const;

export function hdr(color: Color, intensity: number) {
  return color.clone().multiplyScalar(intensity);
}

/** Deterministic glazing scheme: a bay keeps one colour family, tiers rotate within it. */
export function glassColour(bay: number, tier: number) {
  return GLASS[(bay * 2 + tier * 3) % GLASS.length];
}

export { mulberry32, type Rng };
