import { MathUtils, Matrix4, Vector3 } from 'three';
import type { CatmullRomCurve3, Object3D } from 'three';

const UP = new Vector3(0, 1, 0);
const basis = new Matrix4();
const right = new Vector3();
const up = new Vector3();
const tangent = new Vector3();

/**
 * Seat a mesh so its nose runs down the rail, then lean and steer it. Bikes are
 * modelled facing -Z; the rail frame's `right × up` is exactly `-tangent`, so
 * this basis is right-handed by construction. After it, local Z is the travel
 * axis: rotateZ leans the bike over, rotateY steers the front wheel.
 */
export function orientAlongRail(
  mesh: Object3D,
  curve: CatmullRomCurve3,
  anchorU: number,
  lean: number,
  steer: number,
) {
  tangent.copy(curve.getTangentAt(MathUtils.clamp(anchorU, 0, 1))).normalize();
  right.crossVectors(tangent, UP).normalize();
  if (right.lengthSq() < 0.0001) right.set(1, 0, 0);
  up.crossVectors(right, tangent).normalize();
  basis.makeBasis(right, up, tangent.negate());
  mesh.quaternion.setFromRotationMatrix(basis);
  if (steer !== 0) mesh.rotateY(steer);
  if (lean !== 0) mesh.rotateZ(lean);
}
