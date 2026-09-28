import { CatmullRomCurve3, MathUtils, Matrix4, Vector3 } from 'three';
import { STRANDLINE_DURATION } from './timing';

// The jelly lives in its own frame: +Y runs along the animal from the tentacle
// tips toward the bell, the origin is the CROWN — the apex of the subumbrella
// where every strand roots. The whole animal is tilted so the rail climbs
// through the water on a diagonal, looking up toward the surface light.
//
// Looking along +Y from the rail, local +X is screen-right and local +Z is
// screen-up; gameplay offsets (right, up) map onto (x, z) at the crown.

export const AXIS_PITCH_DEGREES = 36;
export const JELLY_MATRIX = new Matrix4().makeRotationX(-MathUtils.degToRad(90 - AXIS_PITCH_DEGREES));
const JELLY_MATRIX_INVERSE = JELLY_MATRIX.clone().invert();

export const toWorld = (local: Vector3, target = new Vector3()) => target.copy(local).applyMatrix4(JELLY_MATRIX);
export const toLocal = (world: Vector3, target = new Vector3()) => target.copy(world).applyMatrix4(JELLY_MATRIX_INVERSE);
export const dirToWorld = (local: Vector3, target = new Vector3()) => target.copy(local).transformDirection(JELLY_MATRIX);

/** World-space direction of the surface light (toward the sun). */
export const SUN_DIRECTION = new Vector3(0.28, 0.93, 0.24).normalize();

// ---- the animal --------------------------------------------------------------

export const BELL = {
  radius: 72, // margin radius
  apexOuterY: 44, // top of the dome
  marginY: -30, // where the rim curls under
  thicknessAtApex: 44,
  center: new Vector3(0, -20.5, 0),
  height: 64.5,
};

export const PARENT_Y = -6;
export const PARENT_RADIUS = 10.5;

// Broods hatch onto two veils of webbing. The outer veil is nearer the rail.
export const VEILS = [
  { y: -33, rx: 25, rz: 15, broods: 4 },
  { y: -23, rx: 14.5, rz: 9, broods: 6 },
] as const;

// ---- the rail --------------------------------------------------------------------

// Where the rail is at each moment: (time, x, y, z) in the jelly frame. The
// waypoints are the art direction: a drift up the strands, a swing out under
// the bell (widest at 24 s, a hair outside its rim), a dive back into the
// forest, then a slow hover in the crown's chamber. Time-to-place is exact:
// the run progress below passes through every waypoint at its listed time.
const WAYPOINTS: Array<[time: number, x: number, y: number, z: number]> = [
  [0, 0, -286, 0],
  [2, 3, -273, 2],
  [4, 6, -258, 5],
  [6, -4, -243, 8],
  [8, -12, -227, 4],
  [10, -14, -211, -5],
  [12, -3, -195, -11],
  [14, 9, -180, -7],
  [15, 13, -168, 4],
  // the swing: up and out of the strands, under the bell, to the moon
  [16.5, 0, -154, 16],
  [18, -26, -136, 26],
  [19.5, -64, -110, 28],
  [21, -100, -80, 20],
  [22, -118, -58, 10],
  [23, -126, -44, 0],
  [24, -124, -38, -8],
  [25, -114, -40, -14],
  // the dive back in
  [26.25, -92, -48, -16],
  [27.75, -58, -59, -12],
  [29.25, -22, -66, -6],
  [30.75, 0, -68, -1],
  [40, 0, -62, 0],
  [50, 0, -57, 0],
  [60, 0, -52, 0],
];

export const RAIL_LOCAL_POINTS = WAYPOINTS.map(([, x, y, z]) => new Vector3(x, y, z));
export const RAIL_START_Y = RAIL_LOCAL_POINTS[0].y;
export const TIP_Y = RAIL_START_Y - 44;
export const RAIL_END_Y = RAIL_LOCAL_POINTS[RAIL_LOCAL_POINTS.length - 1].y;

// The pull-back has its own stretch of rail. It is dormant until the parent
// lets go, then the run's progress rides it out to a far vantage; the last
// segment arrives heading straight at the animal, so the runner's own end-of-run
// camera — which is aimed along the rail — is already looking at it.
export const PULL_VANTAGE = new Vector3(300, -150, 36);
export const ANIMAL_CENTER = new Vector3(0, -150, 0);
const TAIL_POINTS = [
  // The rail runs on into the crown first, so the runner's look-ahead while the
  // camera hovers at the end of the climb still points at the parent.
  new Vector3(0, -22, 0),
  new Vector3(0, -96, 10),
  new Vector3(108, -150, 28),
  new Vector3(215, -158, 34),
  PULL_VANTAGE.clone().add(new Vector3(24, 0, 2.6)),
  PULL_VANTAGE.clone(),
];
/** Where the rail's progress rests when the pull-back finishes (leaves room for the runner's look-ahead). */
export const PULL_END_PROGRESS = 0.985;

const railLocalCurve = new CatmullRomCurve3(RAIL_LOCAL_POINTS, false, 'centripetal');
const fullLocalPoints = [...RAIL_LOCAL_POINTS, ...TAIL_POINTS];
const fullLocalCurve = new CatmullRomCurve3(fullLocalPoints, false, 'centripetal');
const LENGTH_SAMPLES_PER_SEGMENT = 64;
const cumulative = fullLocalCurve.getLengths(LENGTH_SAMPLES_PER_SEGMENT * (fullLocalPoints.length - 1));

/** Total rail length in metres (climb plus pull-back stretch). */
export const RAIL_LENGTH = cumulative[cumulative.length - 1];
/** Fraction of the rail that is the climb; the rest is the pull-back stretch. */
export const CLIMB_FRACTION = cumulative[LENGTH_SAMPLES_PER_SEGMENT * (RAIL_LOCAL_POINTS.length - 1)] / RAIL_LENGTH;

// Progress through the waypoint times, monotone-cubic so the speed is smooth.
const WAYPOINT_TIMES = WAYPOINTS.map(([time]) => time);
const WAYPOINT_PROGRESS = WAYPOINTS.map((_, index) => cumulative[index * LENGTH_SAMPLES_PER_SEGMENT] / RAIL_LENGTH);
const progressSlopes = monotoneSlopes(WAYPOINT_TIMES, WAYPOINT_PROGRESS);

/** Progress along the climb at run time `t` (the pull-back stretch is ridden separately). */
export function strandlineRunProgress(time: number, duration = STRANDLINE_DURATION) {
  const t = MathUtils.clamp((time / duration) * STRANDLINE_DURATION, 0, STRANDLINE_DURATION);
  let i = 0;
  while (i < WAYPOINT_TIMES.length - 2 && t > WAYPOINT_TIMES[i + 1]) i += 1;
  const h = WAYPOINT_TIMES[i + 1] - WAYPOINT_TIMES[i];
  const s = MathUtils.clamp((t - WAYPOINT_TIMES[i]) / h, 0, 1);
  const s2 = s * s;
  const s3 = s2 * s;
  return (
    (2 * s3 - 3 * s2 + 1) * WAYPOINT_PROGRESS[i]
    + (s3 - 2 * s2 + s) * h * progressSlopes[i]
    + (-2 * s3 + 3 * s2) * WAYPOINT_PROGRESS[i + 1]
    + (s3 - s2) * h * progressSlopes[i + 1]
  );
}

/** Rail speed in metres per second at run time `t`. */
export function speedAt(time: number) {
  const dt = 0.05;
  return ((strandlineRunProgress(time + dt) - strandlineRunProgress(time - dt)) / (2 * dt)) * RAIL_LENGTH;
}

// Fritsch–Carlson tangents: monotone, so the camera never drifts backward.
function monotoneSlopes(xs: number[], ys: number[]) {
  const n = xs.length;
  const delta: number[] = [];
  for (let i = 0; i < n - 1; i += 1) delta.push((ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i]));
  const m: number[] = new Array(n).fill(0);
  m[0] = delta[0];
  m[n - 1] = delta[n - 2];
  for (let i = 1; i < n - 1; i += 1) m[i] = delta[i - 1] * delta[i] <= 0 ? 0 : (delta[i - 1] + delta[i]) / 2;
  for (let i = 0; i < n - 1; i += 1) {
    if (delta[i] === 0) {
      m[i] = 0;
      m[i + 1] = 0;
      continue;
    }
    const a = m[i] / delta[i];
    const b = m[i + 1] / delta[i];
    const sum = a * a + b * b;
    if (sum > 9) {
      const tau = 3 / Math.sqrt(sum);
      m[i] = tau * a * delta[i];
      m[i + 1] = tau * b * delta[i];
    }
  }
  return m;
}

export function createStrandlineRail() {
  return new CatmullRomCurve3(fullLocalPoints.map((point) => toWorld(point)), false, 'centripetal');
}

/** Rail parameter the camera occupies at run time `t`. */
export const railU = (time: number) => strandlineRunProgress(time);

const railTable = railLocalCurve.getSpacedPoints(480);

/**
 * Where the rail passes near local height `y`: the lateral (x, z) of the rail
 * sample closest to the given lateral point, among samples within a few metres
 * of that height. The rail climbs, swings out, and dives back, so more than
 * one part of it can share a height.
 */
export function railLateralNear(y: number, x: number, z: number, target = { x: 0, z: 0, distance: Infinity }) {
  target.distance = Infinity;
  for (let i = 0; i < railTable.length; i += 1) {
    const p = railTable[i];
    if (Math.abs(p.y - y) > 5) continue;
    const distance = Math.hypot(p.x - x, p.z - z);
    if (distance < target.distance) {
      target.distance = distance;
      target.x = p.x;
      target.z = p.z;
    }
  }
  return target;
}

/** Progress the rail has reached at local height `y` (0..1) — for placing scenery. */
export function railUAtY(y: number) {
  let best = 0;
  for (let i = 0; i < railTable.length; i += 1) {
    if (railTable[i].y <= y) best = i;
    else break;
  }
  return best / (railTable.length - 1);
}
