import { Color } from 'three';

// Two palettes for one harbor.
//
// MURK is what the eye sees: sodium lamps burning through grit over tobacco
// water, rust and dirty cream paint, the creature an oily mass against ochre
// haze. The player's instruments are the only cold light in it — mercury
// white-blue, like a vapor lamp in a sodium yard.
//
// THERMAL is what the sight sees: a stark charcoal display. Cold steel and
// water fall to near-black greys, the creature and its brood blaze white, and
// the only color left is red — reserved for vulnerable signal cores and for
// the player's full lock.

const c = (r: number, g: number, b: number) => new Color(r, g, b);

export const MURK = {
  sky: c(0.2, 0.125, 0.052),
  skyHigh: c(0.035, 0.024, 0.017),
  haze: c(0.19, 0.118, 0.05),
  water: c(0.055, 0.036, 0.018),
  waterSheen: c(0.46, 0.27, 0.08),
  rust: c(0.36, 0.12, 0.06),
  rustDark: c(0.18, 0.07, 0.04),
  cream: c(0.62, 0.56, 0.44),
  iron: c(0.09, 0.075, 0.065),
  concrete: c(0.28, 0.24, 0.19),
  sodium: c(1.0, 0.56, 0.16),
  sodiumHot: c(1.0, 0.74, 0.38),
  flesh: c(0.56, 0.4, 0.34),
  fleshDark: c(0.3, 0.17, 0.16),
  oil: c(0.045, 0.03, 0.035),
  oilSheen: c(0.35, 0.22, 0.42),
  bone: c(0.72, 0.66, 0.54),
  ink: c(0.004, 0.003, 0.004),
  jelly: c(0.66, 0.46, 0.22),
  bile: c(0.62, 0.72, 0.16),
};

export const THERMAL = {
  sky: c(0.05, 0.05, 0.052),
  skyHigh: c(0.018, 0.018, 0.02),
  haze: c(0.04, 0.04, 0.042),
  water: c(0.012, 0.012, 0.013),
  steel: c(0.11, 0.11, 0.115),
  steelWarm: c(0.16, 0.16, 0.165),
  lampDull: c(0.42, 0.42, 0.42),
  body: c(1.35, 1.33, 1.3),
  bodyCool: c(0.62, 0.62, 0.62),
  hot: c(2.1, 2.08, 2.02),
  signal: c(2.6, 0.16, 0.08),
  signalDeep: c(1.3, 0.05, 0.03),
  ink: c(0.0, 0.0, 0.0),
};

// The player: mercury light. Locks charge mercury → white → signal red, so the
// sixth lock reads as heat in both senses.
export const MERCURY = c(0.55, 0.88, 1.0);
export const MERCURY_WHITE = c(0.9, 0.97, 1.0);
export const SIGNAL_RED = c(1.0, 0.18, 0.1);
export const LOCK_GRADIENT = [MERCURY, MERCURY_WHITE, SIGNAL_RED] as const;
export const DENY = c(1.0, 0.12, 0.05);

export function hdr(color: Color, intensity: number) {
  return color.clone().multiplyScalar(intensity);
}
