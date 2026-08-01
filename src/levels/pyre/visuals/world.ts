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
  /** Near-black navy: the town band and machinery, silhouetted against the glow. */
  dark: 0x101c28,
  /** The great pyramid, darker still — the deepest value in the frame. */
  pyramid: 0x0d1520,
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
 * The terraced tile field: the plain is armour plating, not snowfield. One
 * instanced mesh; heights quantize to terrace steps keyed on coarse blocks so
 * the steps run in courses, and each tile carries a small value tilt so the
 * field reads built rather than blank.
 */
export const PYRE_TILES = {
  x0: -1400,
  x1: 1400,
  z0: -1500,
  z1: 450,
  pitch: 48,
  gap: 5,
  /** Terrace quantum and count. */
  step: 4,
  levels: 3,
  /** Matches PYRE_GROUND.color, which is declared below this constant. */
  color: 0x87a5b0,
};

/**
 * The great pyramid: the dark mass the whole frame is built around. Base sunk
 * well below ground so its silhouette rises from behind the town band rather
 * than standing on the plain; corner toward the camera so the silhouette edges
 * slope instead of flattening into a roofline.
 */
export const PYRE_PYRAMID = {
  x: 0,
  z: -1550,
  base: 1400,
  height: 900,
  y0: -300,
  color: PYRE_COLORS.pyramid,
};

/**
 * The framing crag towers. Pale eroded stone flanking the pit: a dark-ish pair
 * on the left, a brighter pair on the right, and one small far sentinel just
 * right of centre standing against the warm veil, as the reference frames it.
 * Sections are (left, right, height) half-widths, stacked bottom-up.
 */
export const PYRE_TOWERS = [
  {
    x: -620, z: -420, depth: 150, color: PYRE_COLORS.paleStone, seed: 3, lean: 0.06,
    sections: [[62, 70, 115], [54, 60, 100], [58, 46, 88], [40, 48, 72], [28, 33, 58]],
  },
  {
    x: -840, z: -700, depth: 175, color: PYRE_COLORS.paleStone, seed: 11, lean: -0.04,
    sections: [[78, 72, 105], [62, 66, 92], [52, 55, 78], [36, 40, 60]],
  },
  {
    x: 540, z: -320, depth: 140, color: PYRE_COLORS.ice, seed: 7, lean: -0.05,
    sections: [[56, 62, 110], [60, 51, 118], [46, 52, 92], [38, 41, 72], [26, 31, 55]],
  },
  {
    x: 790, z: -560, depth: 165, color: PYRE_COLORS.ice, seed: 19, lean: 0.03,
    sections: [[72, 66, 125], [58, 63, 108], [52, 46, 88], [34, 38, 64]],
  },
  {
    x: 250, z: -1120, depth: 95, color: PYRE_COLORS.ice, seed: 23, lean: 0.02,
    sections: [[34, 37, 78], [28, 31, 68], [21, 24, 50]],
  },
] as const;

/**
 * The overhead megastructure: kilometre-scale plates leaning across the upper
 * frame, converging over the pyramid. Far enough back that the fly-around never
 * passes through one.
 */
/** Dark blue-grey: the plates are silhouettes against the veil, not lit faces. */
export const PYRE_MEGASTRUCTURE = [
  { x: -1500, y: 1700, z: -3400, sx: 4000, sy: 110, sz: 1600, yaw: 18, roll: -38, color: 0x46606f },
  { x: 1600, y: 1500, z: -3200, sx: 3600, sy: 110, sz: 1500, yaw: -14, roll: 44, color: 0x46606f },
  /** High canopy slab, kept to the upper left so the starfield corner stays open. */
  { x: -1600, y: 2900, z: -3100, sx: 5200, sy: 130, sz: 2000, yaw: 14, roll: -18, color: 0x3d5462 },
  { x: -2400, y: 700, z: -1600, sx: 320, sy: 2600, sz: 320, yaw: 24, roll: -28, color: 0x54707f },
  { x: 2500, y: 600, z: -1300, sx: 300, sy: 2200, sz: 300, yaw: -20, roll: 24, color: 0x54707f },
] as const;

/**
 * The town band: dark machinery along the pit rims, silhouetted against the
 * glow. Authored as seeded strips — count and rough size here, exact block
 * shapes from the hash — plus the door slab, the one block placed by hand.
 */
export const PYRE_TOWN = {
  color: PYRE_COLORS.dark,
  /** x0, x1, z0, z1, block pitch, min/max height. */
  strips: [
    /** Far rim, against the pyramid. */
    { x0: -340, x1: 340, z0: -1260, z1: -1150, pitch: 52, hMin: 24, hMax: 95 },
    /** Near rim flanks, framing the deck. Kept low: they sit close to the hero eye. */
    { x0: -420, x1: -160, z0: -175, z1: -115, pitch: 46, hMin: 10, hMax: 34 },
    { x0: 170, x1: 440, z0: -180, z1: -120, pitch: 46, hMin: 10, hMax: 36 },
    /** Side rims, thinning with distance. */
    { x0: -430, x1: -330, z0: -1080, z1: -300, pitch: 58, hMin: 14, hMax: 52 },
    { x0: 340, x1: 440, z0: -1060, z1: -320, pitch: 58, hMin: 14, hMax: 56 },
    /** The machined deck: a low plate field running under the hero eye to the rim. */
    { x0: -190, x1: 190, z0: -148, z1: -20, pitch: 30, hMin: 1, hMax: 5 },
  ],
  door: { x: 0, y: 60, z: -1190, sx: 90, sy: 120, sz: 30 },
};

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
  /** Darker and bluer than the old baked tint: AgX lifts accumulated haze. */
  coldColor: 0x243850,
  /** Low: the near field stays crisp; the warm column carries the veil. */
  density: 0.0004,
  floorHeight: 0,
  falloffHeight: 150,
  glowColor: 0xff4818,
  /**
   * A rising column, not a pool: from the pit floor up and *behind* the pyramid.
   * The sky background takes no fog, so the veil needs surfaces to accumulate
   * on — the backdrop wall behind and the megastructure above. With the column's
   * upper half behind the pyramid, the apex stands dark inside a red halo while
   * the lower faces still take the warm wash, which is the reference's polarity.
   * The tall glow falloff is what lets it reach that high before the cold
   * profile would have killed it.
   */
  glowStart: [0, -140, -1600] as const,
  glowEnd: [0, 1100, -2600] as const,
  glowRadius: 340,
  glowStrength: 1.35,
  glowFalloffHeight: 420,
  glowSamples: 6,
};

/**
 * The sky wall: one huge unlit backdrop far behind the vista. The haze cannot
 * fog the clear colour, so without a surface back there the warm column would
 * read only on the pyramid in front of it; this wall is what the veil and the
 * horizon lift accumulate on. Colour is the sky divided by the facet-shading
 * level a +z face receives, so it matches the true sky at its top edge.
 */
export const PYRE_BACKDROP = {
  x: 0,
  y: 1700,
  z: -4300,
  sx: 14000,
  sy: 5600,
  sz: 40,
  color: 0x1d4567,
};

/** The ground: one flat sheet at y = 0, cut around the pit. */
export const PYRE_GROUND = {
  edge: 3000,
  nearZ: 600,
  farZ: -4000,
  /** Darker than the tower ice: the reference's plain is shadowed mid grey-blue. */
  color: 0x87a5b0,
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
