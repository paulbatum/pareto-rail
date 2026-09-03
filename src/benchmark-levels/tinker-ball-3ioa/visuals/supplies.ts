import {
  BoxGeometry,
  BufferGeometry,
  CatmullRomCurve3,
  Color,
  CylinderGeometry,
  Float32BufferAttribute,
  Matrix4,
  MeshStandardMaterial,
  Quaternion,
  SphereGeometry,
  TorusGeometry,
  TubeGeometry,
  Vector3,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { CARDBOARD, ERASER_PINK, GLASS, PENCIL_YELLOW, POT_WHITE, SILVER, WOOD_LIGHT, candy, type Rng } from './palette';

// Geometry factories for the worktable's supplies. Every piece is one merged,
// non-indexed geometry carrying two extra attributes: `color` (the baked
// relative color of each part) and `tintMask` (1 where the piece's own tint
// applies, 0 where the part keeps its baked color — pencil graphite, button
// holes, pin needles). The same geometry serves static clutter (tint baked
// in), creature body parts (tint as a material uniform), and the instanced
// debris pool (tint per instance).

export type SupplyType =
  | 'button'
  | 'bead'
  | 'pin'
  | 'clip'
  | 'pencil'
  | 'ruler'
  | 'spool'
  | 'eraser'
  | 'pot'
  | 'block'
  | 'peg'
  | 'card'
  | 'jar';

export const SUPPLY_TYPES: SupplyType[] = ['button', 'bead', 'pin', 'clip', 'pencil', 'ruler', 'spool', 'eraser', 'pot', 'block', 'peg', 'card', 'jar'];

export type SupplyFinish = 'matte' | 'gloss' | 'metal';

/** Bounding radius, resting half-height on the table, and surface finish at unit scale. */
export const SUPPLY_SPEC: Record<SupplyType, { radius: number; rest: number; finish: SupplyFinish }> = {
  button: { radius: 0.5, rest: 0.08, finish: 'gloss' },
  bead: { radius: 0.4, rest: 0.4, finish: 'gloss' },
  pin: { radius: 1.2, rest: 0.14, finish: 'metal' },
  clip: { radius: 0.9, rest: 0.05, finish: 'metal' },
  pencil: { radius: 1.7, rest: 0.11, finish: 'matte' },
  ruler: { radius: 2.0, rest: 0.05, finish: 'matte' },
  spool: { radius: 0.7, rest: 0.62, finish: 'matte' },
  eraser: { radius: 0.8, rest: 0.275, finish: 'matte' },
  pot: { radius: 0.6, rest: 0.53, finish: 'gloss' },
  block: { radius: 0.78, rest: 0.45, finish: 'matte' },
  peg: { radius: 0.75, rest: 0.13, finish: 'matte' },
  card: { radius: 0.8, rest: 0.04, finish: 'matte' },
  jar: { radius: 0.6, rest: 0.68, finish: 'gloss' },
};

const FINISH: Record<SupplyFinish, { roughness: number; metalness: number }> = {
  matte: { roughness: 0.72, metalness: 0.0 },
  gloss: { roughness: 0.28, metalness: 0.04 },
  metal: { roughness: 0.32, metalness: 0.75 },
};

const DARK = new Color(0.14, 0.11, 0.1);
const WHITE = new Color(1, 1, 1);

type Part = { geometry: BufferGeometry; color: Color; mask: number; matrix?: Matrix4 };

const geometryCache = new Map<SupplyType, BufferGeometry>();

export function createSupplyGeometry(type: SupplyType): BufferGeometry {
  let geometry = geometryCache.get(type);
  if (!geometry) {
    geometry = BUILDERS[type]();
    geometryCache.set(type, geometry);
  }
  return geometry;
}

/** A random tint appropriate to the supply: candy for buttons and beads, silver for pins. */
export function randomSupplyTint(type: SupplyType, rng: Rng): Color {
  switch (type) {
    case 'pin':
      return candy(rng);
    case 'clip':
      return rng() < 0.55 ? SILVER.clone() : candy(rng);
    case 'pencil':
      return rng() < 0.6 ? PENCIL_YELLOW.clone() : candy(rng);
    case 'ruler':
      return rng() < 0.7 ? new Color(0.95, 0.85, 0.55) : new Color(0.75, 0.9, 0.95);
    case 'spool':
      return candy(rng);
    case 'eraser':
      return rng() < 0.6 ? ERASER_PINK.clone() : new Color(0.55, 0.72, 0.95);
    case 'pot':
      return candy(rng);
    case 'block':
      return rng() < 0.5 ? candy(rng) : WOOD_LIGHT.clone();
    case 'peg':
      return WOOD_LIGHT.clone().multiplyScalar(0.9 + rng() * 0.2);
    case 'card':
      return CARDBOARD.clone().multiplyScalar(0.85 + rng() * 0.3);
    case 'jar':
      return candy(rng);
    default:
      return candy(rng);
  }
}

// ---- materials ----------------------------------------------------------------

/** Shared lit materials for geometry with tints baked into vertex colors. */
export const BAKED_MATERIAL: Record<SupplyFinish, MeshStandardMaterial> = {
  matte: new MeshStandardMaterial({ vertexColors: true, ...FINISH.matte }),
  gloss: new MeshStandardMaterial({ vertexColors: true, ...FINISH.gloss }),
  metal: new MeshStandardMaterial({ vertexColors: true, ...FINISH.metal }),
};

/** Give a plain geometry a flat baked color so it can merge with supply geometry. */
export function paintGeometry(geometry: BufferGeometry, color: Color) {
  const count = geometry.getAttribute('position').count;
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i += 1) {
    colors[i * 3] = color.r;
    colors[i * 3 + 1] = color.g;
    colors[i * 3 + 2] = color.b;
  }
  geometry.setAttribute('color', new Float32BufferAttribute(colors, 3));
  return geometry;
}

/** Bake a tint into a copy of the geometry (for static merges), dropping the mask. */
export function bakeSupplyGeometry(type: SupplyType, tint: Color, matrix: Matrix4): BufferGeometry {
  const source = createSupplyGeometry(type);
  const geometry = source.clone().applyMatrix4(matrix);
  const colors = geometry.getAttribute('color') as Float32BufferAttribute;
  const masks = geometry.getAttribute('tintMask') as Float32BufferAttribute;
  for (let i = 0; i < colors.count; i += 1) {
    const mask = masks.getX(i);
    colors.setXYZ(
      i,
      colors.getX(i) * (1 - mask + mask * tint.r),
      colors.getY(i) * (1 - mask + mask * tint.g),
      colors.getZ(i) * (1 - mask + mask * tint.b),
    );
  }
  geometry.deleteAttribute('tintMask');
  return geometry;
}

// ---- builders -------------------------------------------------------------------

const BUILDERS: Record<SupplyType, () => BufferGeometry> = {
  button() {
    const parts: Part[] = [
      { geometry: new CylinderGeometry(0.5, 0.5, 0.16, 18), color: WHITE, mask: 1 },
      { geometry: new TorusGeometry(0.4, 0.035, 5, 20), color: new Color(0.72, 0.72, 0.72), mask: 1, matrix: place(0, 0.08, 0, Math.PI / 2, 0, 0) },
    ];
    for (const [x, z] of [[-0.14, -0.14], [0.14, -0.14], [-0.14, 0.14], [0.14, 0.14]]) {
      parts.push({ geometry: new CylinderGeometry(0.055, 0.055, 0.2, 8), color: DARK, mask: 0, matrix: place(x, 0, z) });
    }
    return assemble(parts);
  },
  bead() {
    return assemble([{ geometry: new SphereGeometry(0.4, 12, 9), color: WHITE, mask: 1 }]);
  },
  pin() {
    return assemble([
      { geometry: new CylinderGeometry(0.03, 0.012, 2.3, 6), color: new Color(0.86, 0.88, 0.94), mask: 0, matrix: place(-0.1, 0, 0, 0, 0, Math.PI / 2) },
      { geometry: new SphereGeometry(0.15, 12, 10), color: WHITE, mask: 1, matrix: place(1.08, 0, 0) },
    ]);
  },
  clip() {
    // Two nested loops in the table plane: the classic paperclip outline.
    const points = [
      ...arc(0.72, -0.34, 0.26, -Math.PI / 2, Math.PI / 2, 8).reverse(),
      new Vector3(-0.85, 0, -0.34),
      ...arc(-0.85, 0, 0.34, Math.PI / 2, (3 * Math.PI) / 2, 8),
      new Vector3(0.62, 0, 0.34),
      ...arc(0.62, 0.17, 0.17, -Math.PI / 2, Math.PI / 2, 8).reverse(),
      new Vector3(-0.5, 0, 0.0),
      ...arc(-0.5, 0.0 - 0.17, 0.17, Math.PI / 2, (3 * Math.PI) / 2, 8),
      new Vector3(0.3, 0, -0.17),
    ];
    const curve = new CatmullRomCurve3(points, false, 'catmullrom', 0.0);
    return assemble([{ geometry: new TubeGeometry(curve, 80, 0.045, 6, false), color: WHITE, mask: 1 }]);
  },
  pencil() {
    return assemble([
      { geometry: new CylinderGeometry(0.11, 0.11, 3.0, 6), color: WHITE, mask: 1, matrix: place(0, 0, 0, 0, 0, Math.PI / 2) },
      { geometry: new CylinderGeometry(0.02, 0.11, 0.34, 6), color: new Color(0.88, 0.72, 0.52), mask: 0, matrix: place(1.67, 0, 0, 0, 0, -Math.PI / 2) },
      { geometry: new CylinderGeometry(0.0, 0.03, 0.12, 6), color: new Color(0.16, 0.16, 0.18), mask: 0, matrix: place(1.9, 0, 0, 0, 0, -Math.PI / 2) },
      { geometry: new CylinderGeometry(0.12, 0.12, 0.2, 8), color: new Color(0.78, 0.8, 0.86), mask: 0, matrix: place(-1.58, 0, 0, 0, 0, Math.PI / 2) },
      { geometry: new CylinderGeometry(0.11, 0.11, 0.24, 8), color: ERASER_PINK, mask: 0, matrix: place(-1.8, 0, 0, 0, 0, Math.PI / 2) },
    ]);
  },
  ruler() {
    const parts: Part[] = [{ geometry: new BoxGeometry(4, 0.1, 0.7), color: WHITE, mask: 1 }];
    for (let i = 0; i <= 16; i += 1) {
      const x = -1.9 + i * 0.2375;
      const long = i % 4 === 0;
      parts.push({ geometry: new BoxGeometry(0.03, 0.11, long ? 0.24 : 0.13), color: new Color(0.22, 0.16, 0.1), mask: 0, matrix: place(x, 0, 0.28 - (long ? 0.12 : 0.065) + 0.06) });
    }
    return assemble(parts);
  },
  spool() {
    return assemble([
      { geometry: new CylinderGeometry(0.7, 0.7, 0.14, 18), color: WOOD_LIGHT, mask: 0, matrix: place(0, 0.55, 0) },
      { geometry: new CylinderGeometry(0.7, 0.7, 0.14, 18), color: WOOD_LIGHT, mask: 0, matrix: place(0, -0.55, 0) },
      { geometry: new CylinderGeometry(0.46, 0.46, 0.98, 16), color: WHITE, mask: 1 },
      { geometry: new TorusGeometry(0.46, 0.02, 4, 18), color: new Color(0.8, 0.8, 0.8), mask: 1, matrix: place(0, 0.2, 0, Math.PI / 2, 0, 0) },
      { geometry: new TorusGeometry(0.46, 0.02, 4, 18), color: new Color(0.8, 0.8, 0.8), mask: 1, matrix: place(0, -0.2, 0, Math.PI / 2, 0, 0) },
    ]);
  },
  eraser() {
    return assemble([
      { geometry: new BoxGeometry(1.4, 0.55, 0.8), color: WHITE, mask: 1 },
      { geometry: new BoxGeometry(0.5, 0.57, 0.82), color: new Color(0.5, 0.58, 0.85), mask: 0, matrix: place(0.45, 0, 0) },
    ]);
  },
  pot() {
    return assemble([
      { geometry: new CylinderGeometry(0.55, 0.5, 0.9, 16), color: POT_WHITE, mask: 0 },
      { geometry: new CylinderGeometry(0.58, 0.58, 0.16, 16), color: WHITE, mask: 1, matrix: place(0, 0.53, 0) },
      { geometry: new SphereGeometry(0.12, 8, 6), color: WHITE, mask: 1, matrix: place(0.5, 0.25, 0.1, 0, 0, 0, 1, 1.6, 1) },
    ]);
  },
  block() {
    return assemble([
      { geometry: new BoxGeometry(0.9, 0.9, 0.9), color: WHITE, mask: 1 },
      { geometry: new BoxGeometry(0.5, 0.92, 0.5), color: new Color(0.35, 0.3, 0.28), mask: 0 },
    ]);
  },
  peg() {
    return assemble([
      { geometry: new BoxGeometry(0.22, 0.15, 1.5), color: WHITE, mask: 1, matrix: place(0, 0.1, 0, 0.09, 0, 0) },
      { geometry: new BoxGeometry(0.22, 0.15, 1.5), color: WHITE, mask: 1, matrix: place(0, -0.1, 0, -0.09, 0, 0) },
      { geometry: new TorusGeometry(0.13, 0.03, 6, 12), color: SILVER, mask: 0, matrix: place(0, 0, 0.05, 0, Math.PI / 2, 0) },
    ]);
  },
  card() {
    return assemble([
      { geometry: new BoxGeometry(1.3, 0.08, 0.9), color: WHITE, mask: 1 },
      { geometry: new BoxGeometry(0.03, 0.09, 0.9), color: new Color(0.55, 0.42, 0.3), mask: 0 },
    ]);
  },
  jar() {
    return assemble([
      { geometry: new CylinderGeometry(0.5, 0.5, 1.2, 18), color: GLASS, mask: 0 },
      { geometry: new CylinderGeometry(0.53, 0.53, 0.16, 18), color: WHITE, mask: 1, matrix: place(0, 0.68, 0) },
      { geometry: new CylinderGeometry(0.34, 0.36, 0.7, 12), color: new Color(0.8, 0.5, 0.36), mask: 0, matrix: place(0, -0.2, 0) },
    ]);
  },
};

function arc(cx: number, cz: number, radius: number, from: number, to: number, steps: number) {
  const points: Vector3[] = [];
  for (let i = 0; i <= steps; i += 1) {
    const angle = from + ((to - from) * i) / steps;
    points.push(new Vector3(cx + Math.cos(angle) * radius, 0, cz + Math.sin(angle) * radius));
  }
  return points;
}

export function place(x: number, y: number, z: number, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) {
  const quaternion = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), ry)
    .multiply(new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), rx))
    .multiply(new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), rz));
  return new Matrix4().compose(new Vector3(x, y, z), quaternion, new Vector3(sx, sy, sz));
}

function assemble(parts: Part[]): BufferGeometry {
  const geometries = parts.map(({ geometry, color, mask, matrix }) => {
    const source = geometry.index ? geometry.toNonIndexed() : geometry.clone();
    if (matrix) source.applyMatrix4(matrix);
    source.deleteAttribute('uv');
    const count = source.getAttribute('position').count;
    const colors = new Float32Array(count * 3);
    const masks = new Float32Array(count);
    for (let i = 0; i < count; i += 1) {
      colors[i * 3] = color.r;
      colors[i * 3 + 1] = color.g;
      colors[i * 3 + 2] = color.b;
      masks[i] = mask;
    }
    source.setAttribute('color', new Float32BufferAttribute(colors, 3));
    source.setAttribute('tintMask', new Float32BufferAttribute(masks, 1));
    geometry.dispose();
    return source;
  });
  const merged = mergeGeometries(geometries, false);
  for (const geometry of geometries) geometry.dispose();
  merged.computeBoundingSphere();
  return merged;
}
