import { CatmullRomCurve3, Vector3 } from 'three';

// The nave is a real building: straight, axis-aligned, enormous. The rail
// sways gently *inside* it rather than bending it, so the architecture reads
// as architecture and the bays tick past like a metronome the player can see.
//
// Everything downstream depends on these numbers. The spawn offsets in
// gameplay.ts stay inside a clear box of roughly x +/-25, y -15..18 so no
// scenery can ever occlude a target, and the window field in
// visuals/cathedral.ts is laid out bay by bay from the tiers below.

/** Half the width of the nave, measured to the face of the arcade piers. */
export const NAVE_HALF = 30;
/** Bay pitch along the nave. One pier bundle and one window stack per bay. */
export const BAY = 17;
export const BAY_COUNT = 33;
export const FLOOR_Y = -30;
/** Outer wall of the side aisle: the aisle windows are set into it. */
export const AISLE_X = 45;
/** Where the vault ribs spring from the wall, and where the crown sits. */
export const VAULT_SPRING_Y = 48;
export const VAULT_CROWN_Y = 66;

export const NAVE_END_Z = -BAY * BAY_COUNT;
/** The west wall, and the plane the dead rose window is set into. */
export const ROSE_Z = NAVE_END_Z - 39;
export const ROSE_Y = 12;
export const ROSE_RADIUS = 26;

export function bayCenterZ(bay: number) {
  return -(bay * BAY + BAY / 2);
}

/**
 * The three tiers of openings in the nave elevation. These are building
 * dimensions, not a rendering detail: the window index they define is the
 * level's currency, shared by the runtime that counts relit panes and by the
 * geometry that draws them.
 */
export const WINDOW_TIERS = [
  // aisle: seen through the arcade, deepest and largest
  { sill: -20, spring: -8, apex: 2, halfWidth: 5, glassX: AISLE_X - 0.8, glassWidth: 11.5, shaftPitch: -0.18 },
  // gallery: a small bright band just above eye level
  { sill: 8, spring: 13, apex: 18.5, halfWidth: 4, glassX: 36, glassWidth: 9, shaftPitch: -0.05 },
  // clerestory: the tall lancets that carry the frame
  { sill: 26, spring: 38, apex: 46.5, halfWidth: 5.5, glassX: NAVE_HALF + 0.7, glassWidth: 12.5, shaftPitch: -0.55 },
] as const;

export const TIER_COUNT = WINDOW_TIERS.length;
export const WINDOW_COUNT = BAY_COUNT * 2 * TIER_COUNT;

export function windowIndex(bay: number, side: number, tier: number) {
  return (bay * 2 + side) * TIER_COUNT + tier;
}

export function clampWindow(index: number) {
  return Math.min(WINDOW_COUNT - 1, Math.max(0, Math.floor(index)));
}

/** The pane a thing standing at this point came off: same bay, same side, same height. */
export function nearestWindowIndex(point: { x: number; y: number; z: number }) {
  const bay = Math.min(BAY_COUNT - 1, Math.max(0, Math.round((-point.z - BAY / 2) / BAY)));
  const tier = point.y > 14 ? 2 : point.y > -3 ? 1 : 0;
  return windowIndex(bay, point.x >= 0 ? 0 : 1, tier);
}

/** The same opening in the opposite arcade: panes come back in pairs. */
export function mirrorWindow(index: number) {
  const safe = clampWindow(index);
  const pair = Math.floor(safe / TIER_COUNT);
  return windowIndex(pair >> 1, (pair & 1) === 0 ? 1 : 0, safe % TIER_COUNT);
}

/**
 * A long straight flight down the middle of the nave with a slow drift: the
 * camera leans toward one arcade, then the other, so the piers on each side
 * take turns filling the frame instead of running past symmetrically.
 */
export function createVespersRail() {
  return new CatmullRomCurve3(
    [
      new Vector3(0, 1.5, 6),
      new Vector3(-2, 0.5, -40),
      new Vector3(-6, -1.5, -96),
      new Vector3(-3, 1.0, -150),
      new Vector3(3, 2.5, -204),
      new Vector3(7, 0.5, -258),
      new Vector3(4, -2.0, -310),
      new Vector3(-2, -1.0, -360),
      new Vector3(-6, 1.5, -410),
      new Vector3(-3, 3.0, -458),
      new Vector3(0, 2.0, -500),
      new Vector3(0, 4.0, -534),
      new Vector3(0, 6.0, -556),
    ],
    false,
    'catmullrom',
    0.4,
  );
}
