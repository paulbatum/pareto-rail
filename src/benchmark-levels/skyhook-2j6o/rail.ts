import { CatmullRomCurve3, MathUtils, Matrix4, Quaternion, Vector3 } from 'three';

// The rail: one straight line pitched 20° above the horizon. The tether runs
// parallel to it; the sky's zenith is world +y, so the horizon sits in the
// lower third of the view and the planet's limb can curve away below at the
// top of the climb. Shared by gameplay, the boss, and the environment.
const RAIL_PITCH = MathUtils.degToRad(20);
export const RAIL_LENGTH = 1000;
export const RAIL_ORIGIN = new Vector3(0, 0, 0);
export const RAIL_DIRECTION = new Vector3(0, Math.sin(RAIL_PITCH), -Math.cos(RAIL_PITCH));
export const RAIL_RIGHT = new Vector3(1, 0, 0);
export const RAIL_UP = new Vector3(0, Math.cos(RAIL_PITCH), Math.sin(RAIL_PITCH));

/** Local x = rail right, y = rail up, z = back down the tether toward the player. */
export const RAIL_BASIS = new Quaternion().setFromRotationMatrix(
  new Matrix4().makeBasis(RAIL_RIGHT, RAIL_UP, RAIL_DIRECTION.clone().negate()),
);

/** Where the tether runs, in rail-frame units relative to the camera line. */
export const TETHER_OFFSET = { x: -4.2, y: -3.4 } as const;

/** Rail-frame point: `u` along the rail, then x right, y up, z further along the tether. */
export function railPoint(u: number, x = 0, y = 0, z = 0, target = new Vector3()) {
  return target
    .copy(RAIL_ORIGIN)
    .addScaledVector(RAIL_DIRECTION, u * RAIL_LENGTH + z)
    .addScaledVector(RAIL_RIGHT, x)
    .addScaledVector(RAIL_UP, y);
}

const scratchRail = new Vector3();

export function railUForPosition(position: Vector3) {
  return MathUtils.clamp(scratchRail.copy(position).sub(RAIL_ORIGIN).dot(RAIL_DIRECTION) / RAIL_LENGTH, 0, 1);
}

export function createSkyhookRail() {
  return new CatmullRomCurve3(
    [0, 1 / 3, 2 / 3, 1].map((u) => railPoint(u)),
    false,
    'catmullrom',
    0.5,
  );
}
