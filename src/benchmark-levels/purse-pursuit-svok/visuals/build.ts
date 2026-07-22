import {
  BufferGeometry,
  Color,
  DoubleSide,
  Float32BufferAttribute,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { additiveMaterialParameters } from '../../../engine/visual-kit';

/**
 * Construction helpers only — no look decisions live here. Every model in this
 * level is baked into two vertex-coloured meshes (a solid body and an additive
 * light rig) so a bike costs two draw calls no matter how many parts it has.
 */

export function paint(geometry: BufferGeometry, color: Color): BufferGeometry {
  const prepared = geometry.index ? geometry.toNonIndexed() : geometry;
  if (prepared !== geometry) geometry.dispose();
  const count = prepared.getAttribute('position')?.count ?? 0;
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i += 1) {
    colors[i * 3] = color.r;
    colors[i * 3 + 1] = color.g;
    colors[i * 3 + 2] = color.b;
  }
  prepared.setAttribute('color', new Float32BufferAttribute(colors, 3));
  return prepared;
}

export type Placement = {
  at?: readonly [number, number, number];
  scale?: readonly [number, number, number] | number;
  rotate?: readonly [number, number, number];
};

const matrix = new Matrix4();
const rotation = new Matrix4();

export function place(geometry: BufferGeometry, placement: Placement): BufferGeometry {
  const scale = placement.scale ?? 1;
  const [sx, sy, sz] = typeof scale === 'number' ? [scale, scale, scale] : scale;
  matrix.makeScale(sx, sy, sz);
  if (placement.rotate) {
    const [rx, ry, rz] = placement.rotate;
    rotation.makeRotationX(rx);
    matrix.premultiply(rotation);
    rotation.makeRotationY(ry);
    matrix.premultiply(rotation);
    rotation.makeRotationZ(rz);
    matrix.premultiply(rotation);
  }
  if (placement.at) {
    const [x, y, z] = placement.at;
    rotation.makeTranslation(x, y, z);
    matrix.premultiply(rotation);
  }
  geometry.applyMatrix4(matrix);
  return geometry;
}

/** Collects painted, placed pieces and merges them into one geometry. */
export class PartBin {
  private readonly parts: BufferGeometry[] = [];

  add(geometry: BufferGeometry, color: Color, placement: Placement = {}) {
    this.parts.push(paint(place(geometry, placement), color));
    return this;
  }

  get empty() {
    return this.parts.length === 0;
  }

  merge(): BufferGeometry {
    if (this.parts.length === 0) return new BufferGeometry();
    const merged = mergeGeometries(this.parts, false) ?? new BufferGeometry();
    for (const part of this.parts) part.dispose();
    this.parts.length = 0;
    return merged;
  }
}

export function solidMaterial() {
  return new MeshBasicMaterial({ color: 0xffffff, vertexColors: true, side: DoubleSide });
}

export function glowMaterial() {
  return new MeshBasicMaterial(additiveMaterialParameters({ color: 0xffffff, vertexColors: true, side: DoubleSide }));
}

export function solidMesh(geometry: BufferGeometry) {
  return new Mesh(geometry, solidMaterial());
}

export function glowMesh(geometry: BufferGeometry) {
  return new Mesh(geometry, glowMaterial());
}
