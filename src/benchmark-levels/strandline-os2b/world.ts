import { CatmullRomCurve3, Vector3 } from 'three';

// The animal's own coordinates. Gameplay needs them (the parent digs in at the
// crown, the camera falls away from the bell at the end) and so do the visuals,
// so the geometry of the jellyfish lives in one place and neither owns it.

/** Centre of the bell's sphere. The dome is the upper cap; the crown hangs under it. */
export const BELL_CENTER = new Vector3(0, 225, -505);
export const BELL_RADIUS = 110;
/** Where the strands root into the bell — the boss arena, directly under the dome. */
export const CROWN_CENTER = new Vector3(0, 118, -510);

/** Camera far plane is 500, so the bell fades in as the rail swings wide of the forest. */
export const BELL_VISIBLE_DISTANCE = 470;
export const BELL_FADE_NEAR = 400;

// A swim that stays inside the trailing strands except for one wide banking
// arc at bars 8–10, where the forest opens and the whole animal is in view,
// then dives back in and climbs to the crown.
const RAIL_POINTS: ReadonlyArray<readonly [number, number, number]> = [
  [0, 6, 0],
  [-8, 3, -38],
  [9, -2, -74],
  [20, -5, -108],
  [3, 2, -142],
  [-18, 7, -172],
  [8, 20, -202],
  [58, 34, -232],
  [68, 40, -262],
  [36, 36, -292],
  [4, 30, -322],
  [-18, 30, -352],
  [-2, 34, -382],
  [16, 42, -410],
  [6, 56, -436],
  [0, 74, -462],
  [0, 92, -488],
];

export function createStrandlineRail() {
  return new CatmullRomCurve3(
    RAIL_POINTS.map(([x, y, z]) => new Vector3(x, y, z)),
    false,
    'catmullrom',
    0.4,
  );
}
