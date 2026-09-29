import { BufferGeometry, Color, Float32BufferAttribute, Quaternion, Uint32BufferAttribute, Vector3 } from 'three';

// Geometry builder for the fleet. Everything is unlit MeshBasicMaterial with
// vertex colors, and the light is baked per face from the nebula's direction:
// faces that turn toward the backlight pick up gold and magenta rims while the
// faces that look at the player stay near-black, so every hull reads as a
// silhouette edged in colored light. Leaves take parameters and decide nothing:
// the light rig, palette, and dimensions all come from the caller.

export type KeyLight = { toLight: Vector3; color: Color; power: number };
export type LightRig = { ambient: Color; keys: readonly KeyLight[] };

export type PartOptions = {
  /** Unlit, HDR-capable color routed to the glow buffer (windows, seams, engines). */
  glow?: boolean;
  /** Per-face brightness jitter, 0..1, for plated hulls. */
  jitter?: number;
  /** Rotation applied about the part's center before placement. */
  rotation?: Quaternion;
  /** Skip these faces: bitmask +x=1, -x=2, +y=4, -y=8, +z=16, -z=32. */
  skip?: number;
};

export type HullBuild = { hull: BufferGeometry; glow: BufferGeometry | null };

type Buffer = { positions: number[]; colors: number[]; indices: number[] };

const FACES: ReadonlyArray<{ bit: number; corners: readonly [number, number, number, number] }> = [
  { bit: 1, corners: [1, 5, 7, 3] }, // +x
  { bit: 2, corners: [0, 2, 6, 4] }, // -x
  { bit: 4, corners: [2, 3, 7, 6] }, // +y
  { bit: 8, corners: [0, 4, 5, 1] }, // -y
  { bit: 16, corners: [4, 6, 7, 5] }, // +z
  { bit: 32, corners: [0, 1, 3, 2] }, // -z
];

/** Cheap deterministic hash in [0,1) for jitter without threading an RNG through every call. */
function hash(a: number, b: number, c: number) {
  const value = Math.sin(a * 12.9898 + b * 78.233 + c * 37.719) * 43758.5453;
  return value - Math.floor(value);
}

export function createHullBuilder(worldQuaternion: Quaternion, rig: LightRig) {
  const hull: Buffer = { positions: [], colors: [], indices: [] };
  const glow: Buffer = { positions: [], colors: [], indices: [] };
  const scratch = {
    center: new Vector3(),
    edgeA: new Vector3(),
    edgeB: new Vector3(),
    normal: new Vector3(),
    world: new Vector3(),
    tint: new Color(),
  };
  let faceCounter = 0;

  function shade(normalLocal: Vector3, base: Color, jitter: number) {
    scratch.world.copy(normalLocal).applyQuaternion(worldQuaternion);
    const color = scratch.tint.copy(rig.ambient);
    for (const key of rig.keys) {
      const lit = Math.max(0, scratch.world.dot(key.toLight));
      if (lit > 0) {
        const wrapped = lit ** 0.85 * key.power;
        color.r += key.color.r * wrapped;
        color.g += key.color.g * wrapped;
        color.b += key.color.b * wrapped;
      }
    }
    const scale = jitter > 0 ? 1 + (hash(faceCounter, 3.1, jitter) - 0.5) * 2 * jitter : 1;
    return [base.r * color.r * scale, base.g * color.g * scale, base.b * color.b * scale] as const;
  }

  function pushQuad(target: Buffer, quad: readonly Vector3[], rgb: readonly [number, number, number]) {
    const start = target.positions.length / 3;
    for (const point of quad) {
      target.positions.push(point.x, point.y, point.z);
      target.colors.push(rgb[0], rgb[1], rgb[2]);
    }
    target.indices.push(start, start + 1, start + 2, start, start + 2, start + 3);
  }

  /** A hexahedron from eight corners, index bits (x=1, y=2, z=4). Skew, taper, and wedge shapes are all hexes. */
  function hex(corners: readonly Vector3[], base: Color, options: PartOptions = {}) {
    const center = scratch.center.set(0, 0, 0);
    for (const corner of corners) center.add(corner);
    center.multiplyScalar(1 / 8);
    for (const face of FACES) {
      if (options.skip && (options.skip & face.bit) !== 0) continue;
      const quad = face.corners.map((index) => corners[index]);
      scratch.edgeA.subVectors(quad[1], quad[0]);
      scratch.edgeB.subVectors(quad[3], quad[0]);
      const normal = scratch.normal.crossVectors(scratch.edgeA, scratch.edgeB);
      if (normal.lengthSq() < 1e-12) {
        scratch.edgeA.subVectors(quad[2], quad[1]);
        scratch.edgeB.subVectors(quad[0], quad[1]);
        normal.crossVectors(scratch.edgeA, scratch.edgeB);
        if (normal.lengthSq() < 1e-12) continue;
      }
      normal.normalize();
      const faceCenter = quad[0].clone().add(quad[2]).multiplyScalar(0.5);
      let outward = normal.dot(faceCenter.sub(center));
      let oriented = quad;
      if (outward < 0) {
        oriented = [quad[0], quad[3], quad[2], quad[1]];
        normal.negate();
        outward = -outward;
      }
      faceCounter += 1;
      if (options.glow) pushQuad(glow, oriented, [base.r, base.g, base.b]);
      else pushQuad(hull, oriented, shade(normal, base, options.jitter ?? 0));
    }
  }

  function boxCorners(cx: number, cy: number, cz: number, sx: number, sy: number, sz: number, rotation?: Quaternion) {
    const hx = sx / 2;
    const hy = sy / 2;
    const hz = sz / 2;
    const corners: Vector3[] = [];
    for (let i = 0; i < 8; i += 1) {
      const point = new Vector3((i & 1 ? hx : -hx), (i & 2 ? hy : -hy), (i & 4 ? hz : -hz));
      if (rotation) point.applyQuaternion(rotation);
      point.x += cx;
      point.y += cy;
      point.z += cz;
      corners.push(point);
    }
    return corners;
  }

  function box(cx: number, cy: number, cz: number, sx: number, sy: number, sz: number, base: Color, options: PartOptions = {}) {
    hex(boxCorners(cx, cy, cz, sx, sy, sz, options.rotation), base, options);
  }

  /**
   * A box whose -z end is scaled in x and y: hull sections that narrow toward the bow, fins, wedges.
   * `shiftY` lifts or drops the -z end, sweeping a keel line or a deck line.
   */
  function taperedBox(
    cx: number,
    cy: number,
    cz: number,
    sx: number,
    sy: number,
    sz: number,
    frontScaleX: number,
    frontScaleY: number,
    base: Color,
    options: PartOptions & { shiftY?: number; backScaleX?: number; backScaleY?: number } = {},
  ) {
    const corners = boxCorners(cx, cy, cz, sx, sy, sz);
    const hx = sx / 2;
    const hy = sy / 2;
    const backX = options.backScaleX ?? 1;
    const backY = options.backScaleY ?? 1;
    for (let i = 0; i < 8; i += 1) {
      const front = (i & 4) === 0;
      const scaleX = front ? frontScaleX : backX;
      const scaleY = front ? frontScaleY : backY;
      const sign = { x: i & 1 ? 1 : -1, y: i & 2 ? 1 : -1 };
      corners[i].x = cx + sign.x * hx * scaleX;
      corners[i].y = cy + sign.y * hy * scaleY + (front ? (options.shiftY ?? 0) : 0);
      if (options.rotation) {
        corners[i].sub(new Vector3(cx, cy, cz)).applyQuaternion(options.rotation).add(new Vector3(cx, cy, cz));
      }
    }
    hex(corners, base, options);
  }

  /** N-sided prism along an axis: barrels, engine nozzles, domes' drums. */
  function cylinder(
    cx: number,
    cy: number,
    cz: number,
    radius: number,
    length: number,
    axis: 'x' | 'y' | 'z',
    sides: number,
    base: Color,
    options: PartOptions & { radiusEnd?: number; caps?: boolean } = {},
  ) {
    const rings: Vector3[][] = [];
    const radii = [radius, options.radiusEnd ?? radius];
    for (let end = 0; end < 2; end += 1) {
      const ring: Vector3[] = [];
      const offset = (end === 0 ? -0.5 : 0.5) * length;
      for (let i = 0; i < sides; i += 1) {
        const angle = (i / sides) * Math.PI * 2;
        const a = Math.cos(angle) * radii[end];
        const b = Math.sin(angle) * radii[end];
        const point = axis === 'x' ? new Vector3(offset, a, b) : axis === 'y' ? new Vector3(a, offset, b) : new Vector3(a, b, offset);
        if (options.rotation) point.applyQuaternion(options.rotation);
        ring.push(point.add(new Vector3(cx, cy, cz)));
      }
      rings.push(ring);
    }
    const middle = new Vector3(cx, cy, cz);
    for (let i = 0; i < sides; i += 1) {
      const j = (i + 1) % sides;
      quadFacing([rings[0][i], rings[0][j], rings[1][j], rings[1][i]], middle, base, options);
    }
    if (options.caps !== false) {
      const capA = rings[0];
      const capB = rings[1];
      for (let i = 1; i < sides - 1; i += 1) {
        quadFacing([capA[0], capA[i], capA[i + 1], capA[i + 1]], middle, base, options);
        quadFacing([capB[0], capB[i], capB[i + 1], capB[i + 1]], middle, base, options);
      }
    }
  }

  /** A quad (or degenerate-quad triangle) whose normal is flipped to face away from `inside`. */
  function quadFacing(quad: readonly Vector3[], inside: Vector3, base: Color, options: PartOptions = {}) {
    scratch.edgeA.subVectors(quad[1], quad[0]);
    scratch.edgeB.subVectors(quad[3], quad[0]);
    const normal = scratch.normal.crossVectors(scratch.edgeA, scratch.edgeB);
    if (normal.lengthSq() < 1e-12) {
      scratch.edgeA.subVectors(quad[2], quad[1]);
      scratch.edgeB.subVectors(quad[0], quad[1]);
      normal.crossVectors(scratch.edgeA, scratch.edgeB);
      if (normal.lengthSq() < 1e-12) return;
    }
    normal.normalize();
    const faceCenter = quad[0].clone().add(quad[2]).multiplyScalar(0.5);
    let oriented = quad;
    if (normal.dot(faceCenter.sub(inside)) < 0) {
      oriented = [quad[0], quad[3], quad[2], quad[1]];
      normal.negate();
    }
    faceCounter += 1;
    if (options.glow) pushQuad(glow, oriented, [base.r, base.g, base.b]);
    else pushQuad(hull, oriented, shade(normal, base, options.jitter ?? 0));
  }

  /** A flat, one-sided glow rectangle, facing along `normal`, for windows and seams. */
  function glowPlate(center: Vector3, u: Vector3, v: Vector3, color: Color) {
    const quad = [
      center.clone().addScaledVector(u, -0.5).addScaledVector(v, -0.5),
      center.clone().addScaledVector(u, 0.5).addScaledVector(v, -0.5),
      center.clone().addScaledVector(u, 0.5).addScaledVector(v, 0.5),
      center.clone().addScaledVector(u, -0.5).addScaledVector(v, 0.5),
    ];
    pushQuad(glow, quad, [color.r, color.g, color.b]);
    // Back face so a plate seen from behind still shows.
    pushQuad(glow, [quad[0], quad[3], quad[2], quad[1]], [color.r, color.g, color.b]);
  }

  function toGeometry(target: Buffer) {
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new Float32BufferAttribute(target.positions, 3));
    geometry.setAttribute('color', new Float32BufferAttribute(target.colors, 3));
    geometry.setIndex(new Uint32BufferAttribute(target.indices, 1));
    geometry.computeBoundingSphere();
    geometry.computeBoundingBox();
    return geometry;
  }

  function build(): HullBuild {
    return { hull: toGeometry(hull), glow: glow.indices.length > 0 ? toGeometry(glow) : null };
  }

  return { hex, box, taperedBox, cylinder, glowPlate, build, get faceCount() { return faceCounter; } };
}

export type HullBuilder = ReturnType<typeof createHullBuilder>;
