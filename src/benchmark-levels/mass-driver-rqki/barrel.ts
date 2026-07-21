import { CatmullRomCurve3, MathUtils, Matrix4, Vector3 } from 'three';
import { sampleRailFrame } from '../../engine/rail';
import { createSpeedProfile } from '../../engine/speed-profile';
import { LAST_RING_BEAT, MASS_DRIVER_BEAT, MASS_DRIVER_DURATION, MASS_DRIVER_TIME, MUZZLE_TIME } from './timing';

// The barrel is the level's one piece of shared geometry: gameplay seats
// enemies against it, the environment builds rings and wall plate from it, and
// the boss clamps onto it. Everything here is pure derivation from the rail and
// the speed curve, so no module needs to guess where the tunnel is.

// The payload accelerates the entire way. Because rail progress is the
// normalized integral of this curve, the accelerator rings — placed at
// runProgress(beat) — spread further apart exactly as the speed climbs, while
// still being crossed on the beat. The spike half a beat after bar 32 is the
// gun firing: the muzzle ring goes past and the barrel is simply gone.
const SPEED_KEYS: Array<[number, number]> = [
  [MASS_DRIVER_TIME.bar(0), 0.42],
  [MASS_DRIVER_TIME.bar(4), 0.62],
  [MASS_DRIVER_TIME.bar(12), 0.95],
  [MASS_DRIVER_TIME.bar(20), 1.24],
  [MASS_DRIVER_TIME.bar(24), 1.46],
  [MASS_DRIVER_TIME.bar(31), 1.88],
  [MASS_DRIVER_TIME.bar(32), 2.05],
  [MASS_DRIVER_TIME.bar(32, 0.6), 4.4],
  [MASS_DRIVER_TIME.bar(33, 2), 3.15],
  [MASS_DRIVER_TIME.bar(36), 2.4],
];

const speedProfile = createSpeedProfile(SPEED_KEYS, MASS_DRIVER_DURATION);

export const speedFactorAt = speedProfile.speedAt;

export function massDriverRunProgress(time: number, duration = MASS_DRIVER_DURATION) {
  return speedProfile.runProgress(time, duration);
}

/** Rail parameter the camera occupies at run time `t` — for seating set pieces. */
export const railU = (time: number) => massDriverRunProgress(time);

// A very slightly snaking barrel: enough that the ring tunnel visibly bends
// away ahead of you, not enough to hide the muzzle. The last three control
// points share an axis so the exit — the part you are fired through — is dead
// straight.
export function createMassDriverRail() {
  const points: Vector3[] = [];
  for (let i = 0; i <= 10; i += 1) {
    points.push(new Vector3(
      Math.sin(i * 0.92) * 21 * (i >= 9 ? 0.25 : 1),
      Math.sin(i * 1.37 + 0.6) * 9 * (i >= 9 ? 0.25 : 1),
      -260 * i,
    ));
  }
  points.push(new Vector3(0, 0, -3000));
  points.push(new Vector3(0, 0, -3400));
  return new CatmullRomCurve3(points, false, 'catmullrom', 0.5);
}

const rail = createMassDriverRail();

export const RAIL_LENGTH = rail.getLength();

/** Rail parameter of the muzzle aperture: past this the barrel does not exist. */
export const MUZZLE_U = massDriverRunProgress(MUZZLE_TIME);

const BREECH_RADIUS = 26;
const MUZZLE_RADIUS = 17;

/**
 * The bore narrows toward the muzzle. It is a small taper, but combined with
 * the widening ring spacing it reads unmistakably as compression: the tube is
 * squeezing you out of the end.
 */
export function barrelRadiusAt(u: number) {
  const t = MathUtils.clamp(u / MUZZLE_U, 0, 1);
  return MathUtils.lerp(BREECH_RADIUS, MUZZLE_RADIUS, t * t * (3 - 2 * t));
}

/** Rail parameter of the ring crossed on `beat`. Exact by construction. */
export function ringU(beat: number) {
  return massDriverRunProgress(beat * MASS_DRIVER_BEAT);
}

export const RING_BEATS = Array.from({ length: LAST_RING_BEAT + 1 }, (_value, beat) => beat);

/** 0 at the breech, 1 at the muzzle: how hot a ring burns and how blinding it is. */
export function ringHeat(beat: number) {
  return MathUtils.clamp(beat / LAST_RING_BEAT, 0, 1);
}

const basisMatrix = new Matrix4();
const outwardVector = new Vector3();
const sideVector = new Vector3();

/**
 * Orientation for anything bolted to the bore wall at angle `theta`, measured
 * from rail-right toward rail-up: local +Y points out at the wall, local +Z
 * points down-barrel away from the camera.
 */
export function railBasis(curve: CatmullRomCurve3, u: number, theta: number, target: Matrix4 = basisMatrix) {
  const frame = sampleRailFrame(curve, u);
  outwardVector.copy(frame.right).multiplyScalar(Math.cos(theta)).addScaledVector(frame.up, Math.sin(theta));
  sideVector.crossVectors(frame.tangent, outwardVector).normalize();
  return target.makeBasis(sideVector, outwardVector, frame.tangent);
}

/** Rail-relative offset for a point at bore angle `theta` and radius `radius`. */
export function boreOffset(theta: number, radius: number, along = 0, target = new Vector3()) {
  return target.set(Math.cos(theta) * radius, Math.sin(theta) * radius, along);
}
