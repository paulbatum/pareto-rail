import { CatmullRomCurve3, MathUtils, PerspectiveCamera, Vector3 } from 'three';
import { sampleRailFrame } from '../../engine/rail';
import { createSpeedProfile } from '../../engine/speed-profile';
import { DOCK_TIME, SKYHOOK_DURATION, bar } from './timing';

// The geometry of the climb, shared by gameplay (enemy placement) and visuals
// (scenery). The tether leans up and out and flattens as it climbs, so the
// camera can look up the cable while the planet still fits in the bottom of
// the frame. Nothing here draws anything.

const DEG = Math.PI / 180;

export const CLIMB_LENGTH = 3600;
/** Distance between the X-frame pylons on the cable (they pass the car like telegraph poles). */
export const PYLON_SPACING = 64;
/** Where the tether ribbon sits relative to the car's path, in rail-up units. */
export const TETHER_DROP = -8;
export const TETHER_HALF_WIDTH = 1.0;

const START_ELEVATION = 46 * DEG;
const END_ELEVATION = 28 * DEG;
const STRAIGHT_TAIL = 420; // the docking tunnel needs a dead-straight rail

function elevationAt(s: number) {
  const t = MathUtils.clamp(s / (CLIMB_LENGTH - STRAIGHT_TAIL), 0, 1);
  return MathUtils.lerp(START_ELEVATION, END_ELEVATION, t);
}

function swayAt(s: number) {
  const fade = MathUtils.smoothstep(s, 80, 400) * (1 - MathUtils.smoothstep(s, CLIMB_LENGTH - 900, CLIMB_LENGTH - STRAIGHT_TAIL));
  return Math.sin(s / 430 + 0.6) * 7 * fade;
}

export function createSkyhookRail() {
  const points: Vector3[] = [];
  const step = 60;
  let y = 0;
  let z = 0;
  let s = 0;
  points.push(new Vector3(swayAt(0), y, z));
  while (s < CLIMB_LENGTH) {
    const next = Math.min(CLIMB_LENGTH, s + step);
    const mid = elevationAt((s + next) / 2);
    y += Math.sin(mid) * (next - s);
    z -= Math.cos(mid) * (next - s);
    s = next;
    points.push(new Vector3(swayAt(s), y, z));
  }
  return new CatmullRomCurve3(points, false, 'catmullrom', 0.5);
}

// ---- speed profile -------------------------------------------------------------

export const T_DOOR = bar(21, 3); // 54.4 s: the car crosses the bay door

// Piecewise-linear speed factors. The launch is slow enough to see the platform
// fall away, the deck punch is a genuine lurch, and the docking decelerates to
// a stop the last frame arrives on.
const SPEED_KEYS: Array<[number, number]> = [
  [0, 0.12],
  [2, 0.6],
  [4.5, 0.92],
  [8, 1.0],
  [13.2, 1.02],
  [14.8, 1.62],
  [16.4, 1.36],
  [19, 1.1],
  [30, 1.16],
  [45, 1.2],
  [50, 1.14],
  [52.4, 1.08],
  [T_DOOR, 1.0],
  [56.5, 0.72],
  [58.3, 0.3],
  [59.4, 0.08],
  [SKYHOOK_DURATION, 0.0],
];

const speedProfile = createSpeedProfile(SPEED_KEYS, SKYHOOK_DURATION);
export const speedFactorAt = speedProfile.speedAt;

// The rail never quite reaches u = 1: the runner aims the camera at
// u + 0.025 and a target equal to the eye position would flip the view.
const RAIL_END_MARGIN = 0.9995;

export function skyhookRunProgress(time: number, duration = SKYHOOK_DURATION) {
  return speedProfile.runProgress(time, duration) * RAIL_END_MARGIN;
}

/** Distance climbed along the rail at run time `time`. */
export const climbAt = (time: number) => skyhookRunProgress(time) * CLIMB_LENGTH;
/** Actual climb speed in world units per second. */
export function climbSpeedAt(time: number) {
  const dt = 0.05;
  return (climbAt(Math.min(SKYHOOK_DURATION, time + dt)) - climbAt(Math.max(0, time - dt))) / (dt * 2);
}
/** Altitude in world units of a point on the tether curve at run time `time`. */
export function altitudeAt(curve: CatmullRomCurve3, time: number) {
  return curve.getPointAt(skyhookRunProgress(time)).y;
}

/** Distance along the rail of the bay door, and of the far bay wall. */
export const DOOR_S = climbAt(T_DOOR);
export const BAY_END_S = CLIMB_LENGTH + 34;
export const STATION_TIME = DOCK_TIME;

// ---- camera pitch ---------------------------------------------------------------

// The camera pitches down from the rail tangent so the tether rises through
// the upper half of the frame and the horizon (and later the planet) fills the
// lower part. Keyed by run time; the docking run levels it onto the tunnel axis.
const PITCH_KEYS: Array<[number, number]> = [
  [0, 33],
  [3, 30],
  [6, 24],
  [12, 18],
  [15, 15],
  [17.5, 22],
  [20.5, 27],
  [29, 27],
  [35, 21],
  [42, 20],
  [45, 20],
  [51, 19],
  [T_DOOR, 12],
  [56.5, 4],
  [SKYHOOK_DURATION, 1],
];

export function pitchDegAt(time: number) {
  const t = MathUtils.clamp(time, 0, SKYHOOK_DURATION);
  for (let i = 1; i < PITCH_KEYS.length; i += 1) {
    if (t <= PITCH_KEYS[i][0]) {
      const [t0, v0] = PITCH_KEYS[i - 1];
      const [t1, v1] = PITCH_KEYS[i];
      const k = (t - t0) / Math.max(1e-6, t1 - t0);
      return MathUtils.lerp(v0, v1, k * k * (3 - 2 * k));
    }
  }
  return PITCH_KEYS[PITCH_KEYS.length - 1][1];
}

// ---- the view frame -------------------------------------------------------------

export type ViewBasis = {
  position: Vector3;
  right: Vector3;
  up: Vector3;
  /** Direction the (unrolled, un-shaken) camera looks. */
  forward: Vector3;
  /** Rail tangent at the camera: the direction of the climb. */
  climb: Vector3;
};

const scratchCamera = new PerspectiveCamera();
const TAN_HALF_V = Math.tan(31 * DEG);
export const VIEW_TAN_V = TAN_HALF_V;

export function createViewBasis(): ViewBasis {
  return {
    position: new Vector3(),
    right: new Vector3(1, 0, 0),
    up: new Vector3(0, 1, 0),
    forward: new Vector3(0, 0, -1),
    climb: new Vector3(0, 0, -1),
  };
}

/**
 * The base orientation the runner gives its camera at run time `time`, plus
 * this level's pitch — before the player's edge-look and any shake. Enemies are
 * placed in this frame so the player's edge-look sweeps the view across them.
 */
export function viewBasisAt(curve: CatmullRomCurve3, time: number, out: ViewBasis = createViewBasis()): ViewBasis {
  const u = skyhookRunProgress(time);
  scratchCamera.position.copy(curve.getPointAt(u));
  scratchCamera.quaternion.identity();
  scratchCamera.lookAt(curve.getPointAt(Math.min(1, u + 0.025)));
  scratchCamera.rotateX(-pitchDegAt(time) * DEG);
  out.position.copy(scratchCamera.position);
  out.right.set(1, 0, 0).applyQuaternion(scratchCamera.quaternion);
  out.up.set(0, 1, 0).applyQuaternion(scratchCamera.quaternion);
  out.forward.set(0, 0, -1).applyQuaternion(scratchCamera.quaternion);
  out.climb.copy(sampleRailFrame(curve, u).tangent);
  return out;
}

/** Half-height tangent of a camera's vertical FOV in degrees (defaults to the nominal 62°). */
export function tanHalfFov(fovDegrees: number) {
  return Math.tan((fovDegrees * DEG) / 2);
}

/**
 * Place a point by screen position (NDC x/y) and distance ahead of the view.
 * Pass the camera's live `tanV` so placements keep their NDC through FOV kicks.
 */
export function ndcPoint(basis: ViewBasis, aspect: number, nx: number, ny: number, depth: number, out: Vector3, tanV = TAN_HALF_V) {
  return out
    .copy(basis.position)
    .addScaledVector(basis.forward, depth)
    .addScaledVector(basis.right, depth * tanV * aspect * nx)
    .addScaledVector(basis.up, depth * tanV * ny);
}

/** A point on the tether ribbon `distance` units up the cable from the car. */
export function tetherPointAhead(curve: CatmullRomCurve3, time: number, distance: number, drop = TETHER_DROP, out = new Vector3()) {
  const u = MathUtils.clamp(skyhookRunProgress(time) + distance / CLIMB_LENGTH, 0, 1);
  const frame = sampleRailFrame(curve, u);
  return out.copy(frame.position).addScaledVector(frame.up, drop);
}

// ---- the car ------------------------------------------------------------------

/**
 * Where hostile things clamp onto the climber, as screen position (NDC) and
 * distance from the camera. The car frame in the visuals is built through the
 * same points, so a limpet always lands on something you can see.
 */
export const CAR_ANCHORS: ReadonlyArray<{ nx: number; ny: number; depth: number }> = [
  { nx: -0.5, ny: -0.42, depth: 8 }, // 0: left deck pad
  { nx: 0.5, ny: -0.42, depth: 8 }, // 1: right deck pad
  { nx: -0.78, ny: 0.14, depth: 10 }, // 2: left strut
  { nx: 0.78, ny: 0.14, depth: 10 }, // 3: right strut
];

/** Where torpedoes and hooks strike: the climber's flanks. */
export const CAR_FLANKS: ReadonlyArray<{ nx: number; ny: number; depth: number }> = [
  { nx: -0.96, ny: -0.22, depth: 7 },
  { nx: 0.96, ny: -0.22, depth: 7 },
];
