import { CatmullRomCurve3, MathUtils, Vector3 } from 'three';

const UP = new Vector3(0, 1, 0);

export function smoothRunProgress(time: number, duration: number) {
  const x = MathUtils.clamp(time / duration, 0, 1);
  return x * x * (3 - 2 * x);
}

export type RailFrame = {
  position: Vector3;
  tangent: Vector3;
  right: Vector3;
  up: Vector3;
};

export function sampleRailFrame(curve: CatmullRomCurve3, u: number): RailFrame {
  const clamped = MathUtils.clamp(u, 0, 1);
  const position = curve.getPointAt(clamped);
  const tangent = curve.getTangentAt(clamped).normalize();
  const right = new Vector3().crossVectors(tangent, UP).normalize();
  if (right.lengthSq() < 0.0001) right.set(1, 0, 0);
  const up = new Vector3().crossVectors(right, tangent).normalize();
  return { position, tangent, right, up };
}

export function offsetFromRail(curve: CatmullRomCurve3, u: number, offset: Vector3) {
  const frame = sampleRailFrame(curve, u);
  return frame.position
    .clone()
    .addScaledVector(frame.right, offset.x)
    .addScaledVector(frame.up, offset.y)
    .addScaledVector(frame.tangent, offset.z);
}
