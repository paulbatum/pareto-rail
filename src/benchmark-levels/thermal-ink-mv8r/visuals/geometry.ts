import {
  BoxGeometry,
  BufferGeometry,
  CatmullRomCurve3,
  CylinderGeometry,
  Euler,
  Matrix4,
  Quaternion,
  SphereGeometry,
  TubeGeometry,
  Vector3,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Geometry bucket: accumulate transformed primitives, merge once. Leaf helper;
// callers decide every size and placement.

export class GeometryBucket {
  private parts: BufferGeometry[] = [];

  add(geometry: BufferGeometry, position: Vector3, rotation = new Euler(), scale = new Vector3(1, 1, 1)) {
    const matrix = new Matrix4().compose(position, new Quaternion().setFromEuler(rotation), scale);
    const part = geometry.index ? geometry.toNonIndexed() : geometry.clone();
    part.applyMatrix4(matrix);
    for (const name of Object.keys(part.attributes)) {
      if (name !== 'position' && name !== 'normal' && name !== 'uv') part.deleteAttribute(name);
    }
    if (!part.getAttribute('uv')) return this;
    this.parts.push(part);
    return this;
  }

  box(w: number, h: number, d: number, position: Vector3, rotation?: Euler) {
    return this.add(new BoxGeometry(w, h, d), position, rotation);
  }

  cylinder(radiusTop: number, radiusBottom: number, height: number, position: Vector3, rotation?: Euler, segments = 10) {
    return this.add(new CylinderGeometry(radiusTop, radiusBottom, height, segments, 1), position, rotation);
  }

  sphere(radius: number, position: Vector3, scale?: Vector3) {
    return this.add(new SphereGeometry(radius, 10, 8), position, undefined, scale);
  }

  /** A beam between two points. */
  beam(from: Vector3, to: Vector3, thickness: number, round = false) {
    const direction = to.clone().sub(from);
    const length = direction.length();
    const middle = from.clone().add(to).multiplyScalar(0.5);
    const quaternion = new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), direction.normalize());
    const geometry = round
      ? new CylinderGeometry(thickness, thickness, length, 6, 1)
      : new BoxGeometry(thickness, length, thickness);
    const part = geometry.toNonIndexed();
    part.applyMatrix4(new Matrix4().compose(middle, quaternion, new Vector3(1, 1, 1)));
    this.parts.push(part);
    return this;
  }

  /** A sagging cable between two points (or a dangling one when `drop` is set). */
  cable(points: Vector3[], radius: number, segments = 24) {
    const curve = new CatmullRomCurve3(points);
    const part = new TubeGeometry(curve, segments, radius, 5, false).toNonIndexed();
    this.parts.push(part);
    return this;
  }

  get size() {
    return this.parts.length;
  }

  merge() {
    if (this.parts.length === 0) return new BufferGeometry();
    const merged = mergeGeometries(this.parts, false);
    for (const part of this.parts) part.dispose();
    this.parts = [];
    return merged ?? new BufferGeometry();
  }
}

export function catenary(from: Vector3, to: Vector3, sag: number, count = 8) {
  const points: Vector3[] = [];
  for (let i = 0; i <= count; i += 1) {
    const t = i / count;
    const point = from.clone().lerp(to, t);
    point.y -= Math.sin(t * Math.PI) * sag;
    points.push(point);
  }
  return points;
}
