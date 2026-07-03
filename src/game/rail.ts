import { CatmullRomCurve3, MathUtils, Vector3 } from 'three';

export const RUN_DURATION = 30;

const UP = new Vector3(0, 1, 0);

export function createRail() {
  return new CatmullRomCurve3(
    [
      new Vector3(0, 0, 0),
      new Vector3(0, 2, -24),
      new Vector3(14, -1, -54),
      new Vector3(-10, 5, -86),
      new Vector3(-22, -2, -118),
      new Vector3(6, 3, -152),
      new Vector3(24, 8, -184),
      new Vector3(-4, 0, -220),
      new Vector3(0, 4, -250),
    ],
    false,
    'catmullrom',
    0.45,
  );
}

export function easeRailTime(t: number) {
  const x = MathUtils.clamp(t / RUN_DURATION, 0, 1);
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
