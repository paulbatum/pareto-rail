import { Matrix4, Quaternion, Vector3 } from 'three';

// The animal's frame. Everything in the level — rail, bell, strands, boss —
// is authored against these few numbers, at a "design" size scaled once here.
export const WORLD_SCALE = 0.75;
const S = WORLD_SCALE;

export const BELL_CENTER = new Vector3(0, 0, 0);
export const BELL_RADIUS = 73 * S;
export const BELL_Y_SCALE = 0.62;
export const BELL_CUT_ANGLE = Math.PI * 0.63;
export const BELL_RIM_RADIUS = BELL_RADIUS * Math.sin(BELL_CUT_ANGLE);
export const BELL_RIM_Y = BELL_RADIUS * BELL_Y_SCALE * Math.cos(BELL_CUT_ANGLE);
export const BELL_TOP_Y = BELL_RADIUS * BELL_Y_SCALE;
export const CROWN = new Vector3(0, -29 * S, 0);
export const CROWN_RADIUS = 4 * S;

// The final approach: a straight line into the crown, rising at 22° from the
// camera's azimuth around the animal. The coda dollies straight back down it to
// the vista the attract screen shows.
export const APPROACH_AZIMUTH = (120 * Math.PI) / 180;
export const APPROACH_ELEVATION = (22 * Math.PI) / 180;
export const APPROACH_DIR = new Vector3(
  -Math.cos(APPROACH_ELEVATION) * Math.cos(APPROACH_AZIMUTH),
  Math.sin(APPROACH_ELEVATION),
  -Math.cos(APPROACH_ELEVATION) * Math.sin(APPROACH_AZIMUTH),
).normalize();
export const APPROACH_RIGHT = new Vector3().crossVectors(APPROACH_DIR, new Vector3(0, 1, 0)).normalize();
export const APPROACH_UP = new Vector3().crossVectors(APPROACH_RIGHT, APPROACH_DIR).normalize();
/** Camera-like orientation looking along the approach: local +X screen-right, +Y screen-up, -Z into the crown. */
export const APPROACH_QUATERNION = new Quaternion().setFromRotationMatrix(
  new Matrix4().makeBasis(APPROACH_RIGHT, APPROACH_UP, APPROACH_DIR.clone().negate()),
);
export const VISTA_DISTANCE = 260 * S;
export const VISTA = CROWN.clone().addScaledVector(APPROACH_DIR, -VISTA_DISTANCE);
export const PARENT_POSITION = CROWN.clone().add(new Vector3(0, -8.5 * S, 0));

/** Point on the approach line `distance` units short of the crown. */
export function approachPoint(distance: number, out = new Vector3()) {
  return out.copy(CROWN).addScaledVector(APPROACH_DIR, -distance);
}

/** World point from cylindrical design coordinates around the animal's axis: azimuth in degrees, radius and height in design units. */
export function cylindricalPoint(azimuthDegrees: number, radius: number, y: number, out = new Vector3()) {
  const azimuth = (azimuthDegrees * Math.PI) / 180;
  return out.set(Math.cos(azimuth) * radius * S, y * S, Math.sin(azimuth) * radius * S);
}

/** Point offset from the parent in the approach frame: `side` along screen-right, `lift` along screen-up, `depth` into the crown. */
export function parentFramePoint(side: number, lift: number, depth = 0, out = new Vector3()) {
  return out.copy(PARENT_POSITION)
    .addScaledVector(APPROACH_RIGHT, side)
    .addScaledVector(APPROACH_UP, lift)
    .addScaledVector(APPROACH_DIR, depth);
}
