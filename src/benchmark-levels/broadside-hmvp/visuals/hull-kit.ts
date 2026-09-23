import {
  BoxGeometry,
  BufferGeometry,
  Color,
  CylinderGeometry,
  Euler,
  Float32BufferAttribute,
  Matrix4,
  Quaternion,
  ShapeUtils,
  Vector2,
  Vector3,
} from 'three';

// Leaf: construction only. A HullBatch accumulates flat-shaded triangles with
// per-vertex albedo, emissive, and a "vein" mask (molten streaks on enemy
// plating), so an entire capital ship — hull, towers, turrets, window strips,
// engine bells — is one geometry and one draw call.

const tmpA = new Vector3();
const tmpB = new Vector3();
const tmpC = new Vector3();
const tmpN = new Vector3();
const BLACK = new Color(0, 0, 0);

export type SurfaceSpec = {
  albedo: Color;
  emissive?: Color;
  vein?: number;
};

export class HullBatch {
  private positions: number[] = [];
  private normals: number[] = [];
  private colors: number[] = [];
  private emissive: number[] = [];
  private veins: number[] = [];

  get triangleCount() {
    return this.positions.length / 9;
  }

  triangle(a: Vector3, b: Vector3, c: Vector3, surface: SurfaceSpec) {
    tmpB.subVectors(b, a);
    tmpC.subVectors(c, a);
    tmpN.crossVectors(tmpB, tmpC);
    if (tmpN.lengthSq() < 1e-12) return;
    tmpN.normalize();
    const emissive = surface.emissive ?? BLACK;
    const vein = surface.vein ?? 0;
    for (const v of [a, b, c]) {
      this.positions.push(v.x, v.y, v.z);
      this.normals.push(tmpN.x, tmpN.y, tmpN.z);
      this.colors.push(surface.albedo.r, surface.albedo.g, surface.albedo.b);
      this.emissive.push(emissive.r, emissive.g, emissive.b);
      this.veins.push(vein);
    }
  }

  /** Add any three geometry, transformed, as flat-shaded triangles. */
  geometry(source: BufferGeometry, matrix: Matrix4, surface: SurfaceSpec) {
    const geometry = source.index ? source.toNonIndexed() : source;
    const position = geometry.getAttribute('position');
    const a = new Vector3();
    const b = new Vector3();
    const c = new Vector3();
    for (let i = 0; i < position.count; i += 3) {
      a.fromBufferAttribute(position, i).applyMatrix4(matrix);
      b.fromBufferAttribute(position, i + 1).applyMatrix4(matrix);
      c.fromBufferAttribute(position, i + 2).applyMatrix4(matrix);
      this.triangle(a, b, c, surface);
    }
    if (geometry !== source) geometry.dispose();
  }

  box(center: Vector3, size: Vector3, surface: SurfaceSpec, rotation?: Euler) {
    const geometry = new BoxGeometry(size.x, size.y, size.z);
    const matrix = new Matrix4().compose(center, new Quaternion().setFromEuler(rotation ?? new Euler()), new Vector3(1, 1, 1));
    this.geometry(geometry, matrix, surface);
    geometry.dispose();
  }

  cylinder(center: Vector3, radiusTop: number, radiusBottom: number, height: number, segments: number, surface: SurfaceSpec, rotation?: Euler) {
    const geometry = new CylinderGeometry(radiusTop, radiusBottom, height, segments, 1, false);
    const matrix = new Matrix4().compose(center, new Quaternion().setFromEuler(rotation ?? new Euler()), new Vector3(1, 1, 1));
    this.geometry(geometry, matrix, surface);
    geometry.dispose();
  }

  /**
   * Loft a hull through cross-section stations. Each station is a polygon in
   * the local XY plane (x starboard, y up), wound counter-clockwise as seen
   * from astern, all with the same vertex count. Stations run stern (+z) to
   * bow (−z). Optional caps close the ends.
   */
  loft(stations: LoftStation[], surface: SurfaceSpec | ((edge: number, station: number) => SurfaceSpec), caps = { aft: true, fore: true }) {
    const count = stations[0].points.length;
    const surfaceFor = typeof surface === 'function' ? surface : () => surface;
    for (let s = 0; s < stations.length - 1; s += 1) {
      const aft = stations[s];
      const fore = stations[s + 1];
      for (let j = 0; j < count; j += 1) {
        const k = (j + 1) % count;
        const a0 = new Vector3(aft.points[j][0], aft.points[j][1], aft.z);
        const a1 = new Vector3(aft.points[k][0], aft.points[k][1], aft.z);
        const b0 = new Vector3(fore.points[j][0], fore.points[j][1], fore.z);
        const b1 = new Vector3(fore.points[k][0], fore.points[k][1], fore.z);
        const spec = surfaceFor(j, s);
        this.triangle(a0, b1, a1, spec);
        this.triangle(a0, b0, b1, spec);
      }
    }
    if (caps.aft) this.cap(stations[0], 1, surfaceFor(-1, 0));
    if (caps.fore) this.cap(stations[stations.length - 1], -1, surfaceFor(-1, stations.length - 1));
  }

  private cap(station: LoftStation, facing: 1 | -1, surface: SurfaceSpec) {
    const contour = station.points
      .map(([x, y]) => new Vector2(x, y))
      .filter((point, index, all) => point.distanceToSquared(all[(index + all.length - 1) % all.length]) > 1e-8);
    if (contour.length < 3) return;
    const triangles = ShapeUtils.triangulateShape(contour, []);
    for (const [i0, i1, i2] of triangles) {
      const a = new Vector3(contour[i0].x, contour[i0].y, station.z);
      const b = new Vector3(contour[i1].x, contour[i1].y, station.z);
      const c = new Vector3(contour[i2].x, contour[i2].y, station.z);
      tmpA.subVectors(b, a).cross(tmpC.subVectors(c, a));
      if (Math.sign(tmpA.z) === facing) this.triangle(a, b, c, surface);
      else this.triangle(a, c, b, surface);
    }
  }

  merge(other: HullBatch) {
    const append = (target: number[], source: number[]) => {
      for (let i = 0; i < source.length; i += 1) target.push(source[i]);
    };
    append(this.positions, other.positions);
    append(this.normals, other.normals);
    append(this.colors, other.colors);
    append(this.emissive, other.emissive);
    append(this.veins, other.veins);
  }

  build() {
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new Float32BufferAttribute(this.positions, 3));
    geometry.setAttribute('normal', new Float32BufferAttribute(this.normals, 3));
    geometry.setAttribute('color', new Float32BufferAttribute(this.colors, 3));
    geometry.setAttribute('emissive', new Float32BufferAttribute(this.emissive, 3));
    geometry.setAttribute('vein', new Float32BufferAttribute(this.veins, 1));
    geometry.computeBoundingSphere();
    geometry.computeBoundingBox();
    return geometry;
  }
}

export type LoftStation = {
  z: number;
  points: Array<[number, number]>;
};

/** A symmetric hull section from a half-profile listed keel → deck on the starboard side. */
export function mirroredSection(z: number, starboard: Array<[number, number]>): LoftStation {
  // Starboard runs keel (bottom) → deck (top); CCW from astern goes up the
  // starboard side, across the deck, and down the port side.
  // Equal vertex counts across stations matter more than duplicates; the
  // zero-area quads a centerline point produces are dropped at emit time.
  const port = [...starboard].reverse().map(([x, y]) => [-x, y] as [number, number]);
  return { z, points: [...starboard, ...port] };
}

export function jitterColor(base: Color, rng: () => number, amount: number) {
  const k = 1 + (rng() - 0.5) * 2 * amount;
  return base.clone().multiplyScalar(k);
}
