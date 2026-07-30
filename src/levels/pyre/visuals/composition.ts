import type { FrameRect } from '../frame';

/**
 * The authored massing of the held frame. Every entry names where a mass lands
 * in the reference picture and how far ahead of the hero camera it sits; the
 * environment builder turns that into geometry.
 *
 * Blockout values only: flat colours sampled from the reference for the value
 * and rough hue each region reads at, so the composition can be judged before
 * any lighting exists.
 */
export const PYRE_COLORS = {
  sky: 0x18313f,
  skyUpperLeft: 0x336a8a,
  skyUpperRight: 0x14304a,
  skyMidLeft: 0x4a86a8,
  skyMidRight: 0x1f4b72,
  skyHorizon: 0x68a5bb,
  snow: 0x8fc0c4,
  snowShaded: 0x5c8b9c,
  slab: 0x3c5064,
  slabDark: 0x2d3949,
  rock: 0x222e3a,
  trenchHot: 0xe8763c,
  trenchMid: 0xb44a44,
  trenchFar: 0x7e3d42,
  trenchDark: 0x3a4c5e,
  basinFloor: 0x231c22,
  gateway: 0x1a1f26,
  slot: 0xfff0cb,
  paleStone: 0x8ac9de,
  paleStoneDim: 0x5f9cb8,
  pyramidFront: 0xb46364,
  pyramidRear: 0x8b586b,
} as const;

/** Depth in world units ahead of the hero camera, per layer of the picture. */
export const PYRE_DEPTHS = {
  frameSlab: 60,
  rightMonoliths: 110,
  leftMonolith: 116,
  centreMonolith: 130,
  gateway: 136,
  leftBeamNear: 130,
  leftBeamMid: 152,
  leftBeamFar: 168,
  rightBeamNear: 142,
  rightBeamFar: 168,
  frontPyramid: 150,
  rightWall: 172,
  rearPyramid: 190,
  backdrop: 222,
} as const;

/** Ground plan of the sunken block field, in world units. */
export const PYRE_BASIN = {
  nearZ: -28,
  farZ: -145,
  floorY: -46,
  /** The rims run as a wedge that stays tight near the camera and flares with distance. */
  nearHalfWidth: 18,
  farHalfWidth: 190,
  flare: 1.15,
  centreX: 4,
};

/**
 * The block field is cleared in front of the gateway so the frame's darkest
 * shape reads at full height instead of being buried by nearer blocks.
 */
export const PYRE_GATEWAY_LANE = { centreX: -15, halfWidth: 21 };

/**
 * The terraced concrete apron filling the near-left of the basin, which is what
 * the reference gives its bottom quarter to. The block field yields to its
 * footprint so the shelf edges read instead of being buried under blocks.
 */
export const PYRE_APRON = {
  bounds: { x0: -120, x1: -6, z0: -24, z1: -84 },
  /**
   * Lit terrace tops, each with a dark riser at its near edge for the shelf line.
   * The tops descend far more gently than the basin does: a terrace falling at the
   * viewing ray's own slope is edge-on to the hero camera and shows nothing.
   */
  riser: 0x24334c,
  steps: [
    { x0: -120, x1: -12, z0: -28, z1: -44, top: -2.6, color: 0x93b7c4 },
    { x0: -120, x1: -16, z0: -44, z1: -58, top: -3.2, color: 0x6e93a6 },
    { x0: -120, x1: -22, z0: -58, z1: -80, top: -3.6, color: 0x8aaebd },
    { x0: -52, x1: -18, z0: -30, z1: -41, top: -1.6, color: 0xa2c5cd },
    { x0: -92, x1: -58, z0: -46, z1: -56, top: -2.9, color: 0x9ab9c6 },
  ],
};

export interface Slab {
  rect: FrameRect;
  /**
   * Distance ahead of the hero camera. This is also where the mass's front face
   * lands, and two front faces at the same depth both draw, so any two masses
   * whose rectangles overlap must differ here by at least a couple of world
   * units.
   *
   * After adding or moving a mass, run `node src/levels/pyre/tools/zfight.mjs`;
   * it audits every overlapping pair and exits non-zero on a collision. It only
   * sees these tables, so confirm the frame itself with `npm run refcompare --
   * flicker` over two captures a small step apart.
   */
  depth: number;
  color: number;
  /** Extent along -Z, in world units. */
  thickness: number;
  /** Screen-plane roll, degrees; positive rolls the top to the left. */
  roll?: number;
  /** Rotation about the world up axis, degrees. */
  yaw?: number;
  /** Overrides the derived outline colour where the frame wants a deliberate rim. */
  edge?: number;
}

/**
 * Outline styling. The masses are unlit flats, so an edge is the only thing
 * that separates two faces of one block; these lines are part of the level's
 * look rather than a review aid. The default is a contrast step from the face —
 * darker on light masses, lighter on dark — with deliberate overrides where the
 * composition wants a brighter rim.
 */
export const PYRE_EDGE = {
  threshold: 16,
  offset: 0.06,
  style(faceColor: number) {
    const r = (faceColor >> 16) & 0xff;
    const g = (faceColor >> 8) & 0xff;
    const b = faceColor & 0xff;
    const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
    const step = (channel: number) =>
      Math.round(luminance > 0.46 ? channel * 0.66 : channel + (255 - channel) * 0.34);
    return {
      color: (step(r) << 16) | (step(g) << 8) | step(b),
      threshold: PYRE_EDGE.threshold,
      offset: PYRE_EDGE.offset,
    };
  },
};

export interface Beam {
  rect: FrameRect;
  depth: number;
  color: number;
  width: number;
  thickness: number;
}

export interface Pyramid {
  apexX: number;
  apexY: number;
  baseY: number;
  baseLeftX: number;
  baseRightX: number;
  depth: number;
  color: number;
  tilt: number;
  yaw: number;
}

/** Flat sky panels seen between the megastructure planes. */
export const PYRE_BACKDROP: Slab[] = [
  { rect: { x0: -260, y0: -240, x1: 980, y1: 380 }, depth: 230, color: PYRE_COLORS.skyUpperLeft, thickness: 2 },
  { rect: { x0: 960, y0: -240, x1: 2180, y1: 380 }, depth: 228, color: PYRE_COLORS.skyUpperRight, thickness: 2 },
  { rect: { x0: -260, y0: 370, x1: 980, y1: 700 }, depth: 226, color: PYRE_COLORS.skyMidLeft, thickness: 2 },
  { rect: { x0: 960, y0: 370, x1: 2180, y1: 700 }, depth: 224, color: PYRE_COLORS.skyMidRight, thickness: 2 },
  { rect: { x0: -260, y0: 690, x1: 2180, y1: 1200 }, depth: 222, color: PYRE_COLORS.skyHorizon, thickness: 2 },

];

/**
 * Overlapping flat planes of the overhead megastructure. The reference reads as
 * enormous rectangles fading into haze, so these stay low-contrast against one
 * another; the crisp geometry lives in the edge beams instead.
 */
export const PYRE_MEGASTRUCTURE: Slab[] = [
  { rect: { x0: 300, y0: -200, x1: 1350, y1: 250 }, depth: 219, color: 0x555d7e, thickness: 3 },
  { rect: { x0: 300, y0: 240, x1: 1350, y1: 424 }, depth: 216.5, color: 0x6f6a8c, thickness: 3 },
  { rect: { x0: 300, y0: 414, x1: 1350, y1: 624 }, depth: 214, color: 0x8c7d9c, thickness: 3 },
  { rect: { x0: 300, y0: 614, x1: 1350, y1: 840 }, depth: 211.5, color: 0x93808f, thickness: 3 },
  { rect: { x0: 120, y0: -120, x1: 760, y1: 700 }, depth: 208, color: 0x3f7796, thickness: 3, roll: 14 },
  { rect: { x0: -120, y0: -160, x1: 460, y1: 430 }, depth: 205, color: 0x467e9f, thickness: 3, roll: -24 },
  { rect: { x0: 470, y0: -160, x1: 980, y1: 700 }, depth: 202, color: 0x6b6180, thickness: 3, roll: -11 },
  { rect: { x0: 940, y0: -180, x1: 1450, y1: 560 }, depth: 199, color: 0x50557a, thickness: 3, roll: 20 },
  { rect: { x0: 1180, y0: 90, x1: 1720, y1: 660 }, depth: 196, color: 0x2c4f75, thickness: 3, roll: -18 },
  { rect: { x0: 1600, y0: -140, x1: 2060, y1: 560 }, depth: 186, color: 0x1a3c58, thickness: 3, roll: 9 },

];

export const PYRE_BEAMS: Beam[] = [
  { rect: { x0: -60, y0: 566, x1: 620, y1: 392 }, depth: PYRE_DEPTHS.leftBeamNear, color: 0x4d7f9e, width: 5, thickness: 4 },
  { rect: { x0: -60, y0: 684, x1: 500, y1: 512 }, depth: PYRE_DEPTHS.leftBeamMid, color: 0x44718f, width: 7, thickness: 5 },
  { rect: { x0: -60, y0: 452, x1: 740, y1: 286 }, depth: PYRE_DEPTHS.leftBeamFar, color: 0x4a7b9a, width: 6, thickness: 5 },
  { rect: { x0: 1640, y0: 812, x1: 2000, y1: 300 }, depth: PYRE_DEPTHS.rightBeamNear, color: 0x2b4a6c, width: 8, thickness: 6 },
  { rect: { x0: 1700, y0: 300, x1: 2000, y1: 780 }, depth: PYRE_DEPTHS.rightBeamFar, color: 0x1f3c5a, width: 6, thickness: 5 },
];

export const PYRE_PYRAMIDS: Pyramid[] = [
  {
    apexX: 790,
    apexY: 432,
    baseY: 838,
    baseLeftX: 315,
    baseRightX: 1184,
    depth: PYRE_DEPTHS.rearPyramid,
    color: PYRE_COLORS.pyramidRear,
    tilt: -7,
    yaw: 12,
  },
  {
    apexX: 950,
    apexY: 664,
    baseY: 842,
    baseLeftX: 620,
    baseRightX: 1290,
    depth: PYRE_DEPTHS.frontPyramid,
    color: PYRE_COLORS.pyramidFront,
    tilt: 3,
    yaw: 24,
  },
];

/** The leaning stack at the left edge: irregular blocks, top offset right of the base. */
export const PYRE_LEFT_MONOLITH: Slab[] = [
  { rect: { x0: 160, y0: 438, x1: 320, y1: 592 }, depth: PYRE_DEPTHS.leftMonolith - 2, color: 0x1d3f60, thickness: 10, roll: -6, yaw: 12 },
  { rect: { x0: 100, y0: 580, x1: 282, y1: 684 }, depth: PYRE_DEPTHS.leftMonolith, color: 0x1a3856, thickness: 11, roll: -5, yaw: -8 },
  { rect: { x0: 80, y0: 672, x1: 226, y1: 862 }, depth: PYRE_DEPTHS.leftMonolith + 2, color: 0x16304c, thickness: 10, roll: -8, yaw: 6 },
  { rect: { x0: 92, y0: 838, x1: 196, y1: 902 }, depth: PYRE_DEPTHS.leftMonolith - 8, color: 0x122840, thickness: 7, roll: 6, yaw: -16 },
  { rect: { x0: 176, y0: 852, x1: 246, y1: 898 }, depth: PYRE_DEPTHS.leftMonolith - 10, color: 0x16304c, thickness: 6, roll: -4, yaw: 14 },

];

/** The pale, brightly lit group at the right: offset stacking over a terraced base. */
export const PYRE_RIGHT_MONOLITHS: Slab[] = [
  { rect: { x0: 1494, y0: 458, x1: 1596, y1: 546 }, depth: PYRE_DEPTHS.rightMonoliths, color: PYRE_COLORS.paleStone, thickness: 8, roll: -2, yaw: 10 },
  { rect: { x0: 1486, y0: 540, x1: 1606, y1: 654 }, depth: PYRE_DEPTHS.rightMonoliths + 2, color: 0x7dbed6, thickness: 9, roll: 3, yaw: -12 },
  { rect: { x0: 1540, y0: 584, x1: 1692, y1: 808 }, depth: PYRE_DEPTHS.rightMonoliths + 8, color: 0x84c3da, thickness: 9, roll: -1, yaw: 6 },
  { rect: { x0: 1452, y0: 644, x1: 1546, y1: 870 }, depth: PYRE_DEPTHS.rightMonoliths - 6, color: PYRE_COLORS.paleStoneDim, thickness: 7, roll: 2, yaw: -6 },
  { rect: { x0: 1538, y0: 806, x1: 1684, y1: 928 }, depth: PYRE_DEPTHS.rightMonoliths - 4, color: 0x6ea6c0, thickness: 9, roll: 1, yaw: 4 },

];

/** The lone pale pillar right of centre, standing out of the block field. */
export const PYRE_CENTRE_MONOLITH: Slab[] = [
  { rect: { x0: 1158, y0: 583, x1: 1216, y1: 640 }, depth: PYRE_DEPTHS.centreMonolith + 3, color: 0xbdd0dc, thickness: 6, roll: -2, yaw: 12 },
  { rect: { x0: 1166, y0: 636, x1: 1210, y1: 676 }, depth: PYRE_DEPTHS.centreMonolith + 1, color: 0xa9c1d1, thickness: 5, roll: 3, yaw: -8 },
  { rect: { x0: 1170, y0: 672, x1: 1212, y1: 710 }, depth: PYRE_DEPTHS.centreMonolith - 1, color: 0xbdd0dc, thickness: 5, roll: -1, yaw: 5 },
  { rect: { x0: 1166, y0: 706, x1: 1218, y1: 772 }, depth: PYRE_DEPTHS.centreMonolith - 3, color: 0xb2c8d7, thickness: 6, roll: 2, yaw: -6 },
  { rect: { x0: 1181, y0: 766, x1: 1234, y1: 812 }, depth: PYRE_DEPTHS.centreMonolith - 5, color: 0xbdd0dc, thickness: 6, roll: -2, yaw: 8 },
  { rect: { x0: 1186, y0: 806, x1: 1236, y1: 892 }, depth: PYRE_DEPTHS.centreMonolith - 7, color: 0x5c3a3c, thickness: 6, roll: 1, yaw: -5 },

];

/** The stepped, layered wall banding the right frame edge. */
export const PYRE_RIGHT_WALL: Slab[] = [
  { rect: { x0: 1686, y0: 398, x1: 1990, y1: 520 }, depth: PYRE_DEPTHS.rightWall, color: 0x35638a, thickness: 18, roll: 6 },
  { rect: { x0: 1708, y0: 500, x1: 1990, y1: 620 }, depth: PYRE_DEPTHS.rightWall - 6, color: 0x2c5678, thickness: 18, roll: 6 },
  { rect: { x0: 1730, y0: 600, x1: 1990, y1: 720 }, depth: PYRE_DEPTHS.rightWall - 12, color: 0x244968, thickness: 18, roll: 6 },
  { rect: { x0: 1752, y0: 700, x1: 1990, y1: 812 }, depth: PYRE_DEPTHS.rightWall - 18, color: 0x1d3d59, thickness: 18, roll: 6 },
];

/** The near megastructure block cutting into the top-left corner. */
export const PYRE_FRAME_SLAB: Slab[] = [
  { rect: { x0: -90, y0: -140, x1: 128, y1: 482 }, depth: PYRE_DEPTHS.frameSlab, color: 0x1c4057, thickness: 6, roll: 6, yaw: -14 },
  { rect: { x0: -90, y0: 430, x1: 96, y1: 640 }, depth: PYRE_DEPTHS.frameSlab + 6, color: 0x24506a, thickness: 6, roll: -8, yaw: 10 },
];

/** The near-black gateway: the frame's darkest shape against its hottest ground. */
export const PYRE_GATEWAY: Slab[] = [
  { rect: { x0: 804, y0: 840, x1: 912, y1: 980 }, depth: PYRE_DEPTHS.gateway, color: PYRE_COLORS.gateway, thickness: 7 },
  { rect: { x0: 810, y0: 818, x1: 906, y1: 848 }, depth: PYRE_DEPTHS.gateway - 3, color: 0x232830, thickness: 7 },
  { rect: { x0: 828, y0: 872, x1: 888, y1: 986 }, depth: PYRE_DEPTHS.gateway - 8, color: 0x0c0f13, thickness: 5 },
];

/**
 * Dark towers standing out of the block field. They break the orange band's top
 * edge, which otherwise reads as a flat stripe rather than architecture.
 */
export const PYRE_TRENCH_STRUCTURES: Slab[] = [
  { rect: { x0: 358, y0: 816, x1: 462, y1: 906 }, depth: 108, color: PYRE_COLORS.trenchDark, thickness: 5, yaw: 8 },
  { rect: { x0: 186, y0: 836, x1: 340, y1: 904 }, depth: 96, color: 0x33445a, thickness: 5, yaw: -6 },
  { rect: { x0: 470, y0: 842, x1: 556, y1: 900 }, depth: 118, color: 0x2f4256, thickness: 5, yaw: 4 },
  { rect: { x0: 1286, y0: 824, x1: 1424, y1: 908 }, depth: 110, color: 0x35485c, thickness: 5, yaw: -8 },
  { rect: { x0: 1440, y0: 848, x1: 1602, y1: 926 }, depth: 98, color: 0x2e4054, thickness: 5, yaw: 6 },
  { rect: { x0: 1608, y0: 872, x1: 1780, y1: 946 }, depth: 88, color: 0x27384c, thickness: 5, yaw: -4 },
  { rect: { x0: 640, y0: 838, x1: 726, y1: 892 }, depth: 128, color: 0x3d4f60, thickness: 4, yaw: 5 },
  { rect: { x0: 1040, y0: 830, x1: 1132, y1: 886 }, depth: 126, color: 0x3a4c5e, thickness: 4, yaw: -5 },
];

/** Hot vertical slots that read as the light source inside the block field. */
export const PYRE_SLOTS: Slab[] = [
  { rect: { x0: 928, y0: 878, x1: 972, y1: 962 }, depth: PYRE_DEPTHS.gateway - 18, color: PYRE_COLORS.slot, thickness: 2 },
  { rect: { x0: 1232, y0: 890, x1: 1258, y1: 952 }, depth: 104, color: PYRE_COLORS.slot, thickness: 2 },
  { rect: { x0: 356, y0: 880, x1: 378, y1: 934 }, depth: 112, color: 0xf6a96a, thickness: 2 },
  { rect: { x0: 668, y0: 872, x1: 688, y1: 926 }, depth: 124, color: 0xf6a96a, thickness: 2 },
];
