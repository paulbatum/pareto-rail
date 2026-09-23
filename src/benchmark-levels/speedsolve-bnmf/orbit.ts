import { Matrix4, Quaternion, Vector3 } from 'three';
import type { Vec3i } from './cube-model';

// Leaf: orbit-pose math for a camera that always faces the cube. A pose is an
// orientation plus a distance; the camera sits on the orientation's local +Z
// at that distance from the target, so it always looks straight at it.

export type OrbitPose = {
  q: Quaternion;
  /** The point the camera orbits and looks at. */
  target: Vector3;
  radius: number;
  /** Slides the camera along its own down axis, lifting the subject in frame. */
  drop: number;
};

const X_AXIS = new Vector3(1, 0, 0);
const Y_AXIS = new Vector3(0, 1, 0);
const scratchA = new Quaternion();
const scratchB = new Quaternion();

export function frameQuaternion(right: Vec3i, up: Vec3i, normal: Vec3i) {
  const basis = new Matrix4().makeBasis(
    new Vector3(...right),
    new Vector3(...up),
    new Vector3(...normal),
  );
  return new Quaternion().setFromRotationMatrix(basis);
}

/** Orbit a frame by yaw (toward screen-right) and lift (toward screen-up), in radians. */
export function orbitQuaternion(frame: Quaternion, yaw: number, lift: number, out = new Quaternion()) {
  scratchA.setFromAxisAngle(Y_AXIS, yaw);
  scratchB.setFromAxisAngle(X_AXIS, -lift);
  return out.copy(frame).multiply(scratchA).multiply(scratchB);
}

export function poseCamera(pose: OrbitPose, outPosition: Vector3, outQuaternion: Quaternion) {
  outQuaternion.copy(pose.q);
  outPosition.set(0, -pose.drop, pose.radius).applyQuaternion(pose.q).add(pose.target);
}

export function blendPose(a: OrbitPose, b: OrbitPose, t: number, bulge = 0): OrbitPose {
  return {
    q: a.q.clone().slerp(b.q, t),
    target: a.target.clone().lerp(b.target, t),
    radius: a.radius + (b.radius - a.radius) * t + bulge * Math.sin(Math.PI * t),
    drop: a.drop + (b.drop - a.drop) * t,
  };
}

/** Direction of a neighbouring face as seen on screen from a face frame. */
export function screenDirection(target: Vec3i, right: Vec3i, up: Vec3i): [number, number] {
  const x = target[0] * right[0] + target[1] * right[1] + target[2] * right[2];
  const y = target[0] * up[0] + target[1] * up[1] + target[2] * up[2];
  const length = Math.hypot(x, y) || 1;
  return [x / length, y / length];
}

const lookMatrix = new Matrix4();
const WORLD_UP = new Vector3(0, 1, 0);

/** The quaternion Object3D.lookAt gives a camera at `eye` looking at `target` with world-up. */
export function cameraLookQuaternion(eye: Vector3, target: Vector3, out: Quaternion) {
  lookMatrix.lookAt(eye, target, WORLD_UP);
  return out.setFromRotationMatrix(lookMatrix);
}
