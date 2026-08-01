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
};

/**
 * Analytic depth haze (engine `height-haze`, wired as `scene.fogNode`).
 * The cold veil dissolves horizontal sightlines while the sky stays clear; the
 * warm term is the burning city read through it, a segment along the pit's long
 * axis below the rim. Density is set so a sightline at hero-eye altitude
 * saturates near the far ground edge, not at the pit.
 */
/**
 * The molten field on the pit floor. Sunk far enough that the hero pose sees
 * only its glow on the haze, not the surface; the fly-around's high vantages
 * look straight down onto it. Scales are in metres: blocks are city-block
 * pitch, heat patches span a few blocks, grain breaks the surface up close.
 */
export const PYRE_MOLTEN = {
  footprint: { x0: -320, x1: 320, nearZ: -150, farZ: -1200 },
  top: -220,
  thickness: 10,
  blockScale: 1 / 80,
  heatScale: 1 / 200,
  grainScale: 1 / 20,
  gamma: 1.9,
  /**
   * Peak of the hottest core, not the average. The veil into the pit transmits
   * ~15% from the fly-around vantages, so the field is authored far over 1 and
   * arrives at readable levels; the gamma-bent field keeps the mean well under
   * the peak so the floor does not clip to one salmon.
   */
  strength: 9,
  /** Deep red through orange to yellow, reserved for the hottest slivers. */
  ramp: [
    [0.0, [1.0, 0.035, 0.003]],
    [0.5, [1.0, 0.09, 0.006]],
    [0.84, [1.0, 0.215, 0.021]],
    [1.0, [1.0, 0.48, 0.1]],
  ],
} as const;

export const PYRE_HAZE = {
  coldColor: PYRE_COLORS.haze,
  density: 0.0009,
  floorHeight: 0,
  falloffHeight: 150,
  glowColor: 0xff5a22,
  glowStrength: 0.9,
  glowStart: [-180, -120, -675] as const,
  glowEnd: [180, -120, -675] as const,
  glowRadius: 180,
  glowFalloffHeight: 130,
  glowSamples: 4,
};

/** The ground: one flat sheet at y = 0, cut around the pit. */
export const PYRE_GROUND = {
  edge: 3000,
  nearZ: 600,
  farZ: -4000,
  color: PYRE_COLORS.ice,
};

/**
 * The pit. Its near rim sits 350 m ahead of the hero eye, which is what puts the
 * rim low in frame and the far rim just under the horizon, as the reference does.
 *
 * It has no floor: `depth` is how thick the ground slabs are cut, and their cut
 * faces are the walls. From the hero eye the near rim's own shadow crosses the
 * far wall well above its bottom edge, so the cut reads as bottomless — which is
 * what leaves room for the city to be dropped into it.
 */
export const PYRE_PIT = {
  x0: -320,
  x1: 320,
  nearZ: -150,
  farZ: -1200,
  depth: 800,
};
