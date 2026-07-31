/**
 * Pyre's world, authored in metres.
 *
 * Blockout stage: a ground plane and a rectangular pit cut into it, and nothing
 * else. Ground sits at y = 0, so the pit runs negative and every structure added
 * later runs positive — no piece has to be rebased when the next layer lands.
 */

/** A person, in world units. Everything else is a multiple of this. */
export const PYRE_HUMAN = 1.8;

/** The ground runs 4 km out, so the camera far plane has to clear it. */
export const PYRE_FAR_PLANE = 8000;

export const PYRE_COLORS = {
  sky: 0x16354f,
  /** What distance fades toward. Sits between the sky and the horizon glow. */
  haze: 0x4e7c96,
  ice: 0xa8cbcf,
  pitFloor: 0x1d1a20,
  slot: 0xffe6b8,
  paleStone: 0x9cc6d6,
} as const;

/**
 * The blockout has no lights. Masses are flat-shaded per facet against this
 * fixed key instead, because an unshaded hundred-metre block reads as a card
 * from every angle that is not straight on. It is also what separates the pit
 * walls from the ground they are cut into, since both are one colour.
 */
export const PYRE_LIGHT = {
  direction: [0.58, 0.68, 0.45] as const,
  ambient: 0.5,
  key: 0.44,
  sky: 0.14,
  /** Baked aerial perspective: the distance at which haze starts and saturates. */
  hazeNear: 1100,
  hazeFar: 6000,
  hazeStrength: 0.5,
};

/**
 * The ground: one flat sheet at y = 0, cut around the pit. `thickness` only has
 * to clear the pit floor, since the ground's underside is never seen.
 */
export const PYRE_GROUND = {
  edge: 3000,
  nearZ: 600,
  farZ: -4000,
  thickness: 400,
  color: PYRE_COLORS.ice,
};

/**
 * The pit. Its near rim sits 350 m ahead of the hero eye, which is what puts the
 * rim low in frame and the far rim just under the horizon, as the reference does.
 * At this depth the near half of the floor falls in the rim's own shadow — also
 * as the reference does; the cut is not meant to be seen into end to end.
 */
export const PYRE_PIT = {
  x0: -900,
  x1: 900,
  nearZ: -150,
  farZ: -2550,
  depth: 240,
  floorColor: PYRE_COLORS.pitFloor,
};
