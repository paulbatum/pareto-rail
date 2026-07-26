import {
  BufferAttribute,
  BufferGeometry,
  Color,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  Quaternion,
  Vector3,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Baked flat-shaded geometry: every static prop in the level fakes the
// overhead desk lamp by writing per-vertex colors from the transformed normal
// (tops bright, undersides dark), then merging into a handful of meshes so
// hundreds of stationery props cost a few draw calls. This is lifecycle-free
// construction; all colors and placement come from the callers.

const scratchMatrix = new Matrix4();
const scratchNormal = new Vector3();

export type BakeShading = {
  topBoost?: number;
  sideDim?: number;
  bottomDim?: number;
};

export function bakeShaded(
  parts: BufferGeometry[],
  geometry: BufferGeometry,
  matrix: Matrix4,
  color: Color,
  shading: BakeShading = {},
) {
  const topBoost = shading.topBoost ?? 1.22;
  const sideDim = shading.sideDim ?? 0.78;
  const bottomDim = shading.bottomDim ?? 0.45;
  const baked = geometry.clone().applyMatrix4(matrix);
  const normals = baked.getAttribute('normal');
  const count = baked.getAttribute('position').count;
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i += 1) {
    scratchNormal.set(normals.getX(i), normals.getY(i), normals.getZ(i));
    const up = scratchNormal.y;
    const shade = up >= 0 ? sideDim + (topBoost - sideDim) * up : sideDim + (bottomDim - sideDim) * -up;
    colors[i * 3] = color.r * shade;
    colors[i * 3 + 1] = color.g * shade;
    colors[i * 3 + 2] = color.b * shade;
  }
  baked.setAttribute('color', new BufferAttribute(colors, 3));
  parts.push(baked);
}

export function composeMatrix(
  position: Vector3,
  quaternion: Quaternion,
  scale: Vector3 | number,
): Matrix4 {
  const scaleVector = typeof scale === 'number' ? new Vector3(scale, scale, scale) : scale;
  return scratchMatrix.clone().compose(position, quaternion, scaleVector);
}

export function matrixAt(x: number, y: number, z: number, rotationY = 0, scale = 1, tilt = 0): Matrix4 {
  const quaternion = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), rotationY);
  if (tilt !== 0) {
    quaternion.multiply(new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), tilt));
  }
  return new Matrix4().compose(new Vector3(x, y, z), quaternion, new Vector3(scale, scale, scale));
}

/** Merge baked parts into a single vertex-colored mesh. Callers own placement in the scene. */
export function mergeShadedMesh(parts: BufferGeometry[]): Mesh {
  const merged = mergeGeometries(parts);
  for (const part of parts) part.dispose();
  const mesh = new Mesh(merged, new MeshBasicMaterial({ vertexColors: true }));
  return mesh;
}
