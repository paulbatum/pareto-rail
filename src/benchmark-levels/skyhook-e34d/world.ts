import { CatmullRomCurve3, MathUtils, Quaternion, Vector3 } from 'three';
import { createSpeedProfile } from '../../engine/speed-profile';
import { bar, SKYHOOK_DURATION, SKYHOOK_MARKERS } from './timing';

// World layout and the climb itself: where the tether runs, how fast the car
// climbs, and how the camera leans. Gameplay, the Descender, and the visuals
// all agree on these.

export const SKYHOOK_PLAYER_HEALTH = 5;

// ---- world layout -----------------------------------------------------------

/** Tether axis, relative to the camera's rail (x = right, y = image-up side). */
export const TETHER_X = -2.4;
export const TETHER_Y = -4.6;
/** The climber's drive head clamps the ribbon this far above the camera. */
export const HEAD_HEIGHT = 4.5;

// Climb speed in world units per second, keyed to the score. The integral is
// the tether length the car covers; the runner's progress easing is its
// normalized integral, so every surge lands on its downbeat.
const SPEED_KEYS: Array<[number, number]> = [
  [0, 3],
  [bar(1), 26],
  [bar(2), 58],
  [bar(7), 74],
  [bar(7, 2), 128], // the punch through the deck
  [bar(8, 2), 96],
  [bar(15), 86],
  [bar(16), 62],
  [bar(19), 40],
  [bar(20, 2), 20], // contact: the car strains against the thing on the line
  [bar(22), 13],
  [bar(28, 2), 13],
  [bar(29), 30], // the line is clear: sprint for the station
  [bar(29, 2), 175],
  [bar(30, 2), 170],
  [bar(31), 58],
  [bar(31, 3), 5], // docking deceleration inside the throat
  [bar(32, 1), 0],
  [SKYHOOK_DURATION, 0],
];

const speedProfile = createSpeedProfile(SPEED_KEYS, SKYHOOK_DURATION, { samples: 2400 });
export const climbSpeedAt = speedProfile.speedAt;

function integrateClimb() {
  const steps = 6000;
  const dt = SKYHOOK_DURATION / steps;
  let sum = 0;
  for (let i = 0; i < steps; i += 1) sum += speedProfile.speedAt((i + 0.5) * dt) * dt;
  return sum;
}

/** Total tether length climbed during the run, in world units. */
export const CLIMB_LENGTH = integrateClimb();

export function skyhookRunProgress(time: number, duration = SKYHOOK_DURATION) {
  return speedProfile.runProgress(time, duration);
}

/** Camera altitude (world units above the pad) at run time `t`. */
export function altitudeAt(time: number) {
  return CLIMB_LENGTH * skyhookRunProgress(time);
}

/** Named altitudes for scenery that must line up with the score. */
export const DECK_ALTITUDE = altitudeAt(SKYHOOK_MARKERS.punch);
export const STATION_ALTITUDE = CLIMB_LENGTH;

export function createSkyhookRail() {
  const points: Vector3[] = [];
  for (let i = 0; i <= 8; i += 1) points.push(new Vector3(0, 0, -(CLIMB_LENGTH * i) / 8));
  return new CatmullRomCurve3(points, false, 'catmullrom', 0.5);
}

// ---- the camera lean ----------------------------------------------------------

// Degrees the view leans off the tether axis toward the planet. The attract
// view looks out over the storm; the climb settles to a steady lean; the dock
// swings the view straight up the station's throat.
const ATTRACT_LEAN = 34;
const CLIMB_LEAN = 21;
// On the pad the view turns off the ribbon so the start placards hang clear of it.
const ATTRACT_YAW = 22;

export function leanDegreesAt(runTime: number) {
  const settle = MathUtils.smoothstep(runTime, 0, bar(2));
  const dock = MathUtils.smoothstep(runTime, bar(29), bar(31, 2));
  return MathUtils.lerp(MathUtils.lerp(ATTRACT_LEAN, CLIMB_LEAN, settle), 0, dock);
}

const X_AXIS = new Vector3(1, 0, 0);
const Y_AXIS = new Vector3(0, 1, 0);
const yawQuaternion = new Quaternion();

export function yawDegreesAt(runTime: number) {
  return ATTRACT_YAW * (1 - MathUtils.smoothstep(runTime, 0, bar(1, 2)));
}

export function viewQuaternionAt(runTime: number, out = new Quaternion()) {
  // Lean off the tether, then turn in the camera's own frame.
  yawQuaternion.setFromAxisAngle(Y_AXIS, -MathUtils.degToRad(yawDegreesAt(runTime)));
  return out.setFromAxisAngle(X_AXIS, -MathUtils.degToRad(leanDegreesAt(runTime))).multiply(yawQuaternion);
}

// Authoring frame: enemies are placed in screen space (sx, sy ∈ −1..1 across a
// 16:9 frame at the game's 62° vertical FOV) at a depth along the lean.
const TAN_V = Math.tan(MathUtils.degToRad(31));
const TAN_H = TAN_V * (16 / 9);
const viewQ = new Quaternion();
const viewRight = new Vector3();
const viewUp = new Vector3();
const viewForward = new Vector3();

export function cameraPositionAt(runProgress: number, out = new Vector3()) {
  return out.set(0, 0, -CLIMB_LENGTH * runProgress);
}

export function viewPoint(runTime: number, runProgress: number, sx: number, sy: number, depth: number, out = new Vector3()) {
  viewQuaternionAt(runTime, viewQ);
  viewRight.set(1, 0, 0).applyQuaternion(viewQ);
  viewUp.set(0, 1, 0).applyQuaternion(viewQ);
  viewForward.set(0, 0, -1).applyQuaternion(viewQ);
  return cameraPositionAt(runProgress, out)
    .addScaledVector(viewForward, depth)
    .addScaledVector(viewRight, sx * TAN_H * depth)
    .addScaledVector(viewUp, sy * TAN_V * depth);
}

/** Point on the tether's camera-facing face at an altitude. */
export function tetherPoint(altitude: number, out = new Vector3()) {
  return out.set(TETHER_X, TETHER_Y + 0.5, -altitude);
}

/** The drive head the grapplers and ticks go for. */
export function driveHeadPoint(runProgress: number, out = new Vector3()) {
  return out.set(TETHER_X, TETHER_Y, -(CLIMB_LENGTH * runProgress + HEAD_HEIGHT));
}
