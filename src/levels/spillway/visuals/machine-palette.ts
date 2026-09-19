import { Color } from 'three';

// Colours of the walker's machines and of the player. Worn yellow paint over
// steel, black hazard stripes and amber work lamps for everything hostile;
// signal red for the player alone, except the rivets, which glow a darker
// red-orange. Hex values are sRGB; `Color` holds them linear.

export const MACHINE = {
  paint: new Color(0xf4b81e),
  paintFaded: new Color(0xd3a444),
  steel: new Color(0x8b8e8c),
  darkSteel: new Color(0x34383a),
  hazard: new Color(0x16161a),
  rubber: new Color(0x1f1f1e),
  lamp: new Color(0xffb13b),
  glass: new Color(0x2b3a40),
};

export const SIGNAL = {
  red: new Color(0xff2a1a),
  /** The flare core, hot enough to bloom. */
  flare: new Color(0xff3b1f).multiplyScalar(4),
  flareCore: new Color(0xffd0a0).multiplyScalar(3),
  /** Dark rim behind red marks so they read on sunlit rock and foam. */
  underlay: new Color(0x120606),
};

export const RIVET = {
  hot: new Color(0xff6a10).multiplyScalar(2),
  shank: new Color(0x8a1e06).multiplyScalar(1.3),
  /** The heat haze trailing a rivet: orange, not the flare's red. */
  trail: new Color(0xff5a0a).multiplyScalar(0.55),
};

export const EFFECT = {
  smoke: new Color(0x5d5a55),
  flareSmoke: new Color(0x8a8580),
  spark: new Color(0xffc070).multiplyScalar(3),
  foam: new Color(0xe8eeea),
  wake: new Color(0xdfe8e4),
  dust: new Color(0x9c958a),
};
