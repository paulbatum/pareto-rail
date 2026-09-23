import { CatmullRomCurve3, MathUtils, Vector3 } from 'three';
import { createSpeedProfile } from '../../engine/speed-profile';
import { BROADSIDE_DURATION, bar } from './timing';

// THE FLIGHT PLAN. The rail is not drawn — it is flown. Airspeed, heading,
// and climb are authored against the bar grid and integrated into a path, so
// every set piece (the catapult, the cruiser's flank, the belly of the enemy
// warship, the turn around the flagship's stern, the trench) sits exactly
// where the music says the player will be. Run progress is the normalized
// integral of the same airspeed, so rail time and world distance agree.
//
// Headings are yaw degrees (positive turns left) and pitch degrees (positive
// climbs). Roll is the camera's bank: an automatic lean into every turn plus
// the two authored corkscrews through the crossfire.

type Key = readonly [bar: number, value: number];

/** Airspeed in world units per second. The capital ships are ~1–1.5 km; you are quick and small. */
const SPEED_KEYS: Key[] = [
  [0, 3],
  [0.95, 12], // spooling on the deck
  [1.28, 112], // CATAPULT
  [2.2, 86],
  [3, 70],
  [7.6, 74],
  [8.2, 86], // down the cruiser's flank
  [13.2, 96],
  [14, 88],
  [14.7, 34], // the eye: a held breath
  [15.8, 30],
  [16.3, 48], // under the keel: a menacing crawl
  [19.7, 50],
  [20.3, 34], // flagship pass, close along the flank
  [23.6, 36],
  [24.0, 92], // the come-around: a hard, fast bank around the stern
  [25.2, 90],
  [25.8, 60],
  [26.3, 42], // into the trench
  [29.6, 46],
  [30.4, 48],
  [34, 30],
];

const YAW_KEYS: Key[] = [
  [0, 0],
  [2, 0],
  [2.6, -5],
  [3.6, 20],
  [4.4, 24],
  [5.2, 8],
  [6.2, -8],
  [7.1, -22],
  [8.05, -12],
  [14, -12],
  [15.1, -10],
  [16, -24],
  [19.2, -24],
  [20.1, 8],
  [23.6, 8],
  [25.4, -172], // hard 180 around the flagship's stern
  [34, -172],
];

const PITCH_KEYS: Key[] = [
  [0, 0],
  [1.6, 0],
  [2.2, -8], // off the bow
  [3, -2],
  [4, 5],
  [5, 6],
  [6, -5],
  [7.2, 0],
  [14, 0],
  [14.7, 7],
  [15.7, 3],
  [16.2, -10], // dive under the keel
  [16.9, 0],
  [19.5, 0],
  [20, -2],
  [23.4, 0],
  [24.2, 12],
  [25.2, 6],
  [25.8, -16], // drop into the trench
  [26.5, 0],
  [29.55, 0],
  [30.25, 28], // pull up and out
  [34, 18],
];

/** Authored rolls on top of the automatic bank: two full corkscrews through the crossfire. */
const ROLL_KEYS: Key[] = [
  [0, 0],
  [4.5, 0],
  [5.5, 360],
  [6.75, 360],
  [7.75, 0],
  [34, 0],
];

const AUTO_BANK_PER_DEG_PER_SEC = 1.15;
const AUTO_BANK_LIMIT_DEG = 62;

function smoothKeys(keys: Key[], barValue: number) {
  if (barValue <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i += 1) {
    const [b1, v1] = keys[i];
    if (barValue <= b1) {
      const [b0, v0] = keys[i - 1];
      const t = MathUtils.clamp((barValue - b0) / Math.max(1e-6, b1 - b0), 0, 1);
      return v0 + (v1 - v0) * t * t * (3 - 2 * t);
    }
  }
  return keys[keys.length - 1][1];
}

const secondsToBar = (seconds: number) => seconds / bar(1);

const speedProfile = createSpeedProfile(
  SPEED_KEYS.map(([b, v]) => [bar(b), v] as const),
  BROADSIDE_DURATION,
  { samples: 2400 },
);

export const speedAt = speedProfile.speedAt;
export function runProgress(time: number, duration = BROADSIDE_DURATION) {
  return speedProfile.runProgress(time, duration);
}

export function headingAt(time: number) {
  const b = secondsToBar(time);
  return { yaw: smoothKeys(YAW_KEYS, b), pitch: smoothKeys(PITCH_KEYS, b) };
}

function directionFor(yawDeg: number, pitchDeg: number, target = new Vector3()) {
  const yaw = MathUtils.degToRad(yawDeg);
  const pitch = MathUtils.degToRad(pitchDeg);
  return target.set(-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch));
}

/** Camera bank in radians at run time: lean into the turn plus authored rolls. */
export function bankAt(time: number) {
  const dt = 0.12;
  const yawRate = (headingAt(time + dt).yaw - headingAt(time - dt).yaw) / (2 * dt);
  const auto = MathUtils.clamp(yawRate * AUTO_BANK_PER_DEG_PER_SEC, -AUTO_BANK_LIMIT_DEG, AUTO_BANK_LIMIT_DEG);
  return MathUtils.degToRad(auto + smoothKeys(ROLL_KEYS, secondsToBar(time)));
}

// ---- integrate the flight into rail control points -----------------------------

const INTEGRATION_DT = 1 / 240;
const CONTROL_POINT_SECONDS = 0.2;

function integrateFlight() {
  const points: Vector3[] = [];
  const position = new Vector3(0, 0, 0);
  const direction = new Vector3();
  let nextControl = 0;
  const steps = Math.ceil(BROADSIDE_DURATION / INTEGRATION_DT);
  for (let i = 0; i <= steps; i += 1) {
    const t = i * INTEGRATION_DT;
    if (t >= nextControl - 1e-9) {
      points.push(position.clone());
      nextControl += CONTROL_POINT_SECONDS;
    }
    const { yaw, pitch } = headingAt(t + INTEGRATION_DT / 2);
    directionFor(yaw, pitch, direction);
    position.addScaledVector(direction, speedAt(t + INTEGRATION_DT / 2) * INTEGRATION_DT);
  }
  points.push(position.clone());
  return points;
}

let cachedCurve: CatmullRomCurve3 | null = null;

/** The one rail instance every system shares. */
export function broadsideRail() {
  if (!cachedCurve) {
    cachedCurve = new CatmullRomCurve3(integrateFlight(), false, 'catmullrom', 0.5);
    cachedCurve.arcLengthDivisions = 6000;
  }
  return cachedCurve;
}

// ---- frames --------------------------------------------------------------------

export type ViewFrame = {
  position: Vector3;
  forward: Vector3;
  right: Vector3;
  up: Vector3;
};

const WORLD_UP = new Vector3(0, 1, 0);
const LOOK_AHEAD_UNITS = 22;

/**
 * The flown frame at a rail parameter: forward is the smoothed flight
 * direction, and right/up are rolled by `bank` radians. Targets that dogfight
 * with the player use the camera's live bank so they stay put on screen while
 * the battle wheels around them; hull-mounted targets use their own.
 */
export function viewFrameAt(u: number, bank: number, target?: ViewFrame): ViewFrame {
  const curve = broadsideRail();
  const length = curve.getLength();
  const clamped = MathUtils.clamp(u, 0, 1);
  const frame = target ?? { position: new Vector3(), forward: new Vector3(), right: new Vector3(), up: new Vector3() };
  curve.getPointAt(clamped, frame.position);
  const aheadU = Math.min(1, clamped + LOOK_AHEAD_UNITS / length);
  const behindU = Math.max(0, aheadU - LOOK_AHEAD_UNITS / length);
  const ahead = curve.getPointAt(aheadU, new Vector3());
  const behind = curve.getPointAt(behindU, new Vector3());
  frame.forward.copy(ahead).sub(behind);
  if (frame.forward.lengthSq() < 1e-8) curve.getTangentAt(clamped, frame.forward);
  frame.forward.normalize();
  frame.right.crossVectors(frame.forward, WORLD_UP);
  if (frame.right.lengthSq() < 1e-6) frame.right.set(1, 0, 0);
  frame.right.normalize();
  frame.up.crossVectors(frame.right, frame.forward).normalize();
  if (bank !== 0) {
    const c = Math.cos(bank);
    const s = Math.sin(bank);
    const right = frame.right.clone();
    const up = frame.up.clone();
    frame.right.copy(right).multiplyScalar(c).addScaledVector(up, s);
    frame.up.copy(up).multiplyScalar(c).addScaledVector(right, -s);
  }
  return frame;
}

/** Run time at which the camera reaches rail parameter `u` (inverse of runProgress). */
export function timeAtProgress(u: number) {
  let lo = 0;
  let hi = BROADSIDE_DURATION;
  for (let i = 0; i < 40; i += 1) {
    const mid = (lo + hi) / 2;
    if (runProgress(mid) < u) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/** Where the camera is at a run time — the anchor for every world set piece. */
export function frameAtTime(time: number, bank = 0): ViewFrame {
  return viewFrameAt(runProgress(time), bank);
}

/** World point expressed in the (unbanked) flown frame at a run time: x right, y up, z forward. */
export function pointFromFrame(time: number, x: number, y: number, z: number, target = new Vector3()) {
  const frame = frameAtTime(time);
  return target.copy(frame.position)
    .addScaledVector(frame.right, x)
    .addScaledVector(frame.up, y)
    .addScaledVector(frame.forward, z);
}
