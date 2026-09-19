import { Color } from 'three';

// The world's colours. The world stays in greys, cold greens and pale sky so
// the worn-yellow machinery and the player's signal red own the saturated end.
// Hex values are sRGB; `Color` holds them linear, which is what shaders use.

export const SKY = {
  zenith: new Color(0x4f86c9),
  horizon: new Color(0xd3dee6),
  ground: new Color(0x55504a),
  sun: new Color(0xffe3bd),
  haze: new Color(0x9fb2c2),
  hazeWarm: new Color(0xf2c796),
};

export const SUNLIGHT = new Color(0xfff0dc);

export const GRANITE = {
  warm: new Color(0x8f887e),
  cool: new Color(0x6c7278),
  pale: new Color(0xa7a197),
  dark: new Color(0x3b3a38),
  lichen: new Color(0x7b7e6a),
  moss: new Color(0x3d4a2e),
  soil: new Color(0x4b4336),
  /** Rock bleached by the reservoir, above its drawn-down waterline. */
  bleached: new Color(0xb3ada1),
};

export const FOLIAGE = {
  pine: [new Color(0x263a24), new Color(0x2e4428), new Color(0x22321f), new Color(0x344a2c)],
  trunk: new Color(0x4a3a2e),
  snag: new Color(0x8b8479),
  meadow: new Color(0x60723d),
  forestFloor: new Color(0x34412b),
};

export const WATER = {
  deep: new Color(0x1a5243),
  shallow: new Color(0x3f7d63),
  foam: new Color(0xd9dfda),
  flood: new Color(0x9fb3ad),
};

export const CONCRETE = {
  base: new Color(0x9b978e),
  stain: new Color(0x5e5b55),
  wet: new Color(0x4a4945),
  bleached: new Color(0xbdb8ad),
};

export const STEEL = {
  gate: new Color(0x4c615e),
  rust: new Color(0x6a4c3a),
  rail: new Color(0x3a3f40),
};
