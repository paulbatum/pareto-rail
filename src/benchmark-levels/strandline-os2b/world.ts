import { CatmullRomCurve3, Vector3 } from 'three';

// The animal's own coordinates. Gameplay needs them (the parent digs in at the
// crown, the camera falls away from the bell at the end) and so do the visuals,
// so the geometry of the jellyfish lives in one place and neither owns it.

/** Centre of the bell's sphere. The dome is the upper cap; the crown hangs under it. */
export const BELL_CENTER = new Vector3(0, 210, -740);
export const BELL_RADIUS = 165;
/** Where the strands root into the bell — the boss arena, directly under the dome. */
export const CROWN_CENTER = new Vector3(0, 96, -706);

/** Camera far plane is 500, so the bell fades in as the rail swings wide of the forest. */
export const BELL_VISIBLE_DISTANCE = 496;
export const BELL_FADE_NEAR = 405;

// A swim that stays inside the trailing strands except for one wide banking
// arc at bars 8–10, where the forest opens and the whole animal is in view,
// then dives back in and climbs to the crown.
const RAIL_POINTS: ReadonlyArray<readonly [number, number, number]> = [
  [0, 6, 0],
  [-7, 3, -46],
  [9, -2, -92],
  [23, -6, -136],
  [7, 1, -180],
  [-14, 6, -222],
  [-7, 12, -262],
  [30, 20, -300],
  [70, 30, -338],
  [76, 36, -378],
  [44, 34, -416],
  [10, 28, -452],
  [-16, 28, -486],
  [0, 34, -518],
  [14, 44, -546],
  [4, 54, -566],
  [0, 60, -580],
];

export function createStrandlineRail() {
  return new CatmullRomCurve3(
    RAIL_POINTS.map(([x, y, z]) => new Vector3(x, y, z)),
    false,
    'catmullrom',
    0.4,
  );
}
