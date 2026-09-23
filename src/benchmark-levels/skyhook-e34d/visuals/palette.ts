import { Color, SRGBColorSpace } from 'three';
import { bar } from '../timing';

/** Palette colors are authored in sRGB, the way they read on screen. */
export function srgb(r: number, g: number, b: number) {
  return new Color().setRGB(r, g, b, SRGBColorSpace);
}

// Two material worlds. Everything the player owns — the climber, the tether,
// the station, locks, shots, reticle — is utilitarian: white paneling, graphite,
// hazard orange. Everything hostile shares one storm-violet glow on dark slate
// and frost armor. The sky supplies every other color.

export const HULL_WHITE = srgb(0.86, 0.86, 0.83);
export const PANEL_GREY = srgb(0.6, 0.61, 0.61);
export const GRAPHITE = srgb(0.16, 0.17, 0.18);
export const STEEL = srgb(0.42, 0.43, 0.45);
export const HAZARD = srgb(1.0, 0.4, 0.05);
export const AMBER = srgb(1.0, 0.68, 0.22);
export const BEACON_RED = srgb(1.0, 0.16, 0.08);
export const TRACER_WHITE = srgb(1.0, 0.95, 0.86);

export const SLATE = srgb(0.17, 0.18, 0.23);
export const BONE = srgb(0.86, 0.84, 0.76);
export const GUNMETAL = srgb(0.2, 0.21, 0.24);
export const FROST = srgb(0.76, 0.82, 0.9);
export const STORM_VIOLET = srgb(0.72, 0.52, 1.0);
export const DEEP_VIOLET = srgb(0.42, 0.22, 0.72);

// Locks charge white → amber → hazard orange; the sixth lock is full alarm.
export const LOCK_GRADIENT = [srgb(0.95, 0.95, 0.92), AMBER, HAZARD] as const;
export const DENY_RED = srgb(1.0, 0.12, 0.06);

export function hdr(color: Color, intensity: number) {
  return color.clone().multiplyScalar(intensity);
}

// ---- the sky, keyed to the score ---------------------------------------------------

export type SkyKey = {
  time: number;
  zenith: Color;
  horizon: Color;
  /** Planet surface: low it is weather, then the cloud sea, then ocean. */
  ground: Color;
  groundCloud: Color;
  cloudCover: number;
  /** Atmosphere limb glow. */
  limb: Color;
  /** Planet angular radius and limb elevation (degrees from the zenith). */
  planetRadius: number;
  limbFromZenith: number;
  /** Storm overcast painted onto the sky itself. */
  overcast: number;
  stars: number;
  sunDisc: number;
  sunGlow: number;
  fog: Color;
  fogNear: number;
  fogFar: number;
  ambient: Color;
  sun: Color;
};

// Sky colors are sRGB; ambient and sun are light multipliers, kept linear.
const c = (r: number, g: number, b: number) => srgb(r, g, b);
const lin = (r: number, g: number, b: number) => new Color(r, g, b);

export const SKY_KEYS: SkyKey[] = [
  {
    // Storm grey: low ceiling, rain, the pad lights.
    time: 0,
    zenith: c(0.25, 0.27, 0.3),
    horizon: c(0.34, 0.36, 0.39),
    ground: c(0.09, 0.1, 0.11),
    groundCloud: c(0.22, 0.24, 0.26),
    cloudCover: 0.6,
    limb: c(0.36, 0.38, 0.4),
    planetRadius: 89,
    limbFromZenith: 60,
    overcast: 1,
    stars: 0,
    sunDisc: 0,
    sunGlow: 0.02,
    fog: c(0.3, 0.32, 0.35),
    fogNear: 30,
    fogFar: 420,
    ambient: lin(0.62, 0.64, 0.68),
    sun: lin(0.1, 0.1, 0.1),
  },
  {
    time: bar(6),
    zenith: c(0.3, 0.32, 0.35),
    horizon: c(0.4, 0.42, 0.45),
    ground: c(0.1, 0.11, 0.12),
    groundCloud: c(0.26, 0.28, 0.3),
    cloudCover: 0.7,
    limb: c(0.42, 0.44, 0.46),
    planetRadius: 88,
    limbFromZenith: 58,
    overcast: 1,
    stars: 0,
    sunDisc: 0,
    sunGlow: 0.05,
    fog: c(0.36, 0.38, 0.41),
    fogNear: 20,
    fogFar: 300,
    ambient: lin(0.68, 0.7, 0.74),
    sun: lin(0.14, 0.14, 0.14),
  },
  {
    // Inside the deck: everything is the cloud.
    time: bar(7, 3),
    zenith: c(0.66, 0.68, 0.71),
    horizon: c(0.7, 0.72, 0.75),
    ground: c(0.55, 0.57, 0.6),
    groundCloud: c(0.66, 0.68, 0.71),
    cloudCover: 1,
    limb: c(0.7, 0.72, 0.75),
    planetRadius: 86,
    limbFromZenith: 50,
    overcast: 0.6,
    stars: 0,
    sunDisc: 0,
    sunGlow: 0.25,
    fog: c(0.68, 0.7, 0.73),
    fogNear: 2,
    fogFar: 110,
    ambient: lin(0.9, 0.9, 0.92),
    sun: lin(0.3, 0.3, 0.28),
  },
  {
    // Sunlit blue: above the weather, the cloud sea below.
    time: bar(8, 1),
    zenith: c(0.16, 0.4, 0.8),
    horizon: c(0.5, 0.66, 0.86),
    ground: c(0.4, 0.5, 0.64),
    groundCloud: c(0.78, 0.8, 0.84),
    cloudCover: 0.8,
    limb: c(0.7, 0.82, 0.96),
    planetRadius: 82,
    limbFromZenith: 44,
    overcast: 0,
    stars: 0,
    sunDisc: 1,
    sunGlow: 0.4,
    fog: c(0.52, 0.66, 0.86),
    fogNear: 160,
    fogFar: 1400,
    ambient: lin(0.52, 0.6, 0.76),
    sun: lin(0.95, 0.9, 0.8),
  },
  {
    time: bar(14),
    zenith: c(0.09, 0.26, 0.64),
    horizon: c(0.44, 0.6, 0.86),
    ground: c(0.28, 0.4, 0.58),
    groundCloud: c(0.76, 0.8, 0.86),
    cloudCover: 0.7,
    limb: c(0.6, 0.76, 1.0),
    planetRadius: 74,
    limbFromZenith: 43,
    overcast: 0,
    stars: 0,
    sunDisc: 1,
    sunGlow: 0.35,
    fog: c(0.36, 0.5, 0.78),
    fogNear: 220,
    fogFar: 1900,
    ambient: lin(0.44, 0.5, 0.68),
    sun: lin(1.0, 0.94, 0.84),
  },
  {
    // Indigo: the air is nearly gone.
    time: bar(18),
    zenith: c(0.07, 0.07, 0.26),
    horizon: c(0.26, 0.32, 0.64),
    ground: c(0.1, 0.26, 0.5),
    groundCloud: c(0.8, 0.84, 0.9),
    cloudCover: 0.5,
    limb: c(0.46, 0.66, 1.0),
    planetRadius: 62,
    limbFromZenith: 42,
    overcast: 0,
    stars: 0.45,
    sunDisc: 1.2,
    sunGlow: 0.25,
    fog: c(0.14, 0.16, 0.38),
    fogNear: 400,
    fogFar: 3200,
    ambient: lin(0.26, 0.28, 0.4),
    sun: lin(1.05, 1.0, 0.94),
  },
  {
    // Black: stars above, the planet curving away below.
    time: bar(22),
    zenith: c(0.01, 0.012, 0.03),
    horizon: c(0.04, 0.07, 0.16),
    ground: c(0.05, 0.19, 0.42),
    groundCloud: c(0.8, 0.84, 0.9),
    cloudCover: 0.45,
    limb: c(0.38, 0.6, 1.0),
    planetRadius: 50,
    limbFromZenith: 41,
    overcast: 0,
    stars: 1,
    sunDisc: 1.4,
    sunGlow: 0.1,
    fog: c(0.0, 0.0, 0.0),
    fogNear: 3000,
    fogFar: 9000,
    ambient: lin(0.16, 0.17, 0.22),
    sun: lin(1.15, 1.1, 1.02),
  },
  {
    time: bar(33),
    zenith: c(0.008, 0.01, 0.025),
    horizon: c(0.03, 0.06, 0.14),
    ground: c(0.05, 0.18, 0.4),
    groundCloud: c(0.78, 0.82, 0.88),
    cloudCover: 0.45,
    limb: c(0.36, 0.56, 0.96),
    planetRadius: 44,
    limbFromZenith: 42,
    overcast: 0,
    stars: 1,
    sunDisc: 1.4,
    sunGlow: 0.1,
    fog: c(0.0, 0.0, 0.0),
    fogNear: 3000,
    fogFar: 9000,
    ambient: lin(0.16, 0.17, 0.22),
    sun: lin(1.15, 1.1, 1.02),
  },
];

/** Sun direction, world space: high off the right shoulder, slightly behind. */
export const SUN_DIRECTION: readonly [number, number, number] = [0.62, 0.3, -0.72];
