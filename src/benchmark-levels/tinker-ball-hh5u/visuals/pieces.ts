import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CatmullRomCurve3,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DynamicDrawUsage,
  Euler,
  IcosahedronGeometry,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  Object3D,
  Quaternion,
  SphereGeometry,
  TorusGeometry,
  TubeGeometry,
  Vector3,
} from 'three';
import { MeshStandardNodeMaterial } from 'three/webgpu';
import { attribute, float, max, mix, vec3 } from 'three/tsl';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Leaf: the supply-piece library. Every button, pin, spool, and ruler in the
// level — on a glue monster, flying as debris, lying on the table, or stuck
// to the ball — is an instance of one of these geometries. Builders take no
// decisions: sizes are unit-normalized and colours arrive per instance.
//
// Per-vertex `surf` = (tint mask, roughness, metalness). Per-instance
// `tintGrime` = (tint rgb, grime): grime 1 is wet black glue, 0 is clean, and
// negative values flash the piece bright as it is freed.

export type PieceType =
  | 'button'
  | 'bead'
  | 'pin'
  | 'paperclip'
  | 'sequin'
  | 'spool'
  | 'eraser'
  | 'paintpot'
  | 'block'
  | 'crayon'
  | 'ruler'
  | 'jar'
  | 'card'
  | 'paper'
  | 'jaw'
  | 'pencil';

export const PIECE_TYPES: PieceType[] = [
  'button', 'bead', 'pin', 'paperclip', 'sequin',
  'spool', 'eraser', 'paintpot', 'block', 'crayon',
  'ruler', 'jar', 'card', 'paper', 'jaw', 'pencil',
];

/** Approximate bounding radius of each unit piece, for pickup and burial. */
export const PIECE_RADIUS: Record<PieceType, number> = {
  button: 0.5,
  bead: 0.36,
  pin: 1.1,
  paperclip: 0.8,
  sequin: 0.26,
  spool: 0.95,
  eraser: 0.85,
  paintpot: 0.6,
  block: 0.7,
  crayon: 0.9,
  ruler: 3.0,
  jar: 1.0,
  card: 1.2,
  paper: 0.7,
  jaw: 0.8,
  pencil: 1.7,
};

/** Pieces that lie flat (their local +Y is the face normal). */
export const PIECE_FLAT: Record<PieceType, boolean> = {
  button: true,
  bead: false,
  pin: false,
  paperclip: true,
  sequin: true,
  spool: false,
  eraser: true,
  paintpot: false,
  block: false,
  crayon: false,
  ruler: true,
  jar: false,
  card: true,
  paper: true,
  jaw: true,
  pencil: false,
};

export type Part = { geometry: BufferGeometry; color: Color; mask: number; rough: number; metal: number };

export function part(geometry: BufferGeometry, color: Color | number, mask: number, rough = 0.6, metal = 0): Part {
  return { geometry, color: color instanceof Color ? color : new Color(color), mask, rough, metal };
}

export function bake(parts: Part[]) {
  const geometries = parts.map(({ geometry, color, mask, rough, metal }) => {
    const g = geometry.index ? geometry.toNonIndexed() : geometry;
    g.deleteAttribute('uv');
    const count = g.getAttribute('position').count;
    const colors = new Float32Array(count * 3);
    const surf = new Float32Array(count * 3);
    for (let i = 0; i < count; i += 1) {
      colors[i * 3] = color.r;
      colors[i * 3 + 1] = color.g;
      colors[i * 3 + 2] = color.b;
      surf[i * 3] = mask;
      surf[i * 3 + 1] = rough;
      surf[i * 3 + 2] = metal;
    }
    g.setAttribute('color', new BufferAttribute(colors, 3));
    g.setAttribute('surf', new BufferAttribute(surf, 3));
    return g;
  });
  const merged = mergeGeometries(geometries);
  for (const g of geometries) g.dispose();
  merged.computeBoundingSphere();
  return merged;
}

const m4 = new Matrix4();
const e = new Euler();
const q = new Quaternion();
const s = new Vector3();
const p = new Vector3();

export function at(geometry: BufferGeometry, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) {
  m4.compose(p.set(x, y, z), q.setFromEuler(e.set(rx, ry, rz)), s.set(sx, sy, sz));
  return geometry.applyMatrix4(m4);
}

const WHITE = 0xffffff;
const GRAPHITE_HEX = 0x2e2d33;
const HOLE = 0x2a2018;
const WOOD = 0xd9ae78;
const WOOD_DARK = 0xa7784a;
const METAL = 0xd4d7dd;

function buildPiece(type: PieceType): BufferGeometry {
  switch (type) {
    case 'button': {
      const parts = [
        part(new CylinderGeometry(0.5, 0.5, 0.12, 24), WHITE, 1, 0.45),
        part(at(new TorusGeometry(0.42, 0.06, 6, 24), 0, 0.06, 0, Math.PI / 2), WHITE, 1, 0.4),
      ];
      for (const [x, z] of [[-0.12, -0.12], [0.12, -0.12], [-0.12, 0.12], [0.12, 0.12]]) {
        parts.push(part(at(new CylinderGeometry(0.06, 0.06, 0.14, 8), x, 0.005, z), HOLE, 0, 0.9));
      }
      return bake(parts);
    }
    case 'bead':
      return bake([
        part(new IcosahedronGeometry(0.34, 1), WHITE, 1, 0.25),
        part(at(new CylinderGeometry(0.1, 0.1, 0.72, 8), 0, 0, 0), HOLE, 0, 0.9),
      ]);
    case 'pin':
      return bake([
        part(new CylinderGeometry(0.035, 0.035, 2.0, 6), METAL, 0, 0.25, 0.9),
        part(at(new ConeGeometry(0.035, 0.18, 6), 0, -1.09, 0, Math.PI), METAL, 0, 0.25, 0.9),
        part(at(new SphereGeometry(0.15, 12, 8), 0, 1.02, 0), WHITE, 1, 0.3),
      ]);
    case 'paperclip': {
      const path = [
        [0, -0.72], [0.2, -0.72], [0.2, 0.62], [-0.2, 0.62], [-0.2, -0.5], [0.12, -0.5], [0.12, 0.45],
      ].map(([x, z]) => new Vector3(x, 0, z));
      const curve = new CatmullRomCurve3(path, false, 'catmullrom', 0.08);
      return bake([part(new TubeGeometry(curve, 48, 0.045, 5, false), WHITE, 0.85, 0.3, 0.7)]);
    }
    case 'sequin':
      return bake([
        part(new CylinderGeometry(0.26, 0.26, 0.03, 16), WHITE, 1, 0.15, 0.8),
        part(at(new CylinderGeometry(0.05, 0.05, 0.04, 6), 0, 0.001, 0), HOLE, 0, 0.9),
      ]);
    case 'spool':
      return bake([
        part(at(new CylinderGeometry(0.62, 0.62, 0.18, 20), 0, 0.72, 0), WOOD, 0, 0.7),
        part(at(new CylinderGeometry(0.62, 0.62, 0.18, 20), 0, -0.72, 0), WOOD, 0, 0.7),
        part(new CylinderGeometry(0.46, 0.46, 1.28, 20), WHITE, 1, 0.85),
        part(at(new CylinderGeometry(0.14, 0.14, 1.66, 8), 0, 0, 0), HOLE, 0, 0.9),
      ]);
    case 'eraser':
      return bake([
        part(at(new BoxGeometry(1.1, 0.42, 0.62), -0.27, 0, 0), WHITE, 1, 0.9),
        part(at(new BoxGeometry(0.58, 0.42, 0.62), 0.57, 0, 0), 0x3f6fd8, 0, 0.9),
      ]);
    case 'paintpot':
      return bake([
        part(new CylinderGeometry(0.46, 0.46, 0.7, 18), WHITE, 1, 0.35),
        part(at(new CylinderGeometry(0.5, 0.5, 0.14, 18), 0, 0.42, 0), 0xf2f2ee, 0, 0.5),
        part(at(new CylinderGeometry(0.2, 0.2, 0.08, 12), 0, 0.52, 0), 0xf2f2ee, 0, 0.5),
      ]);
    case 'block':
      return bake([
        part(new BoxGeometry(1, 1, 1), WHITE, 1, 0.75),
        part(at(new BoxGeometry(0.62, 0.04, 0.62), 0, 0.51, 0), WOOD, 0, 0.8),
        part(at(new BoxGeometry(0.62, 0.62, 0.04), 0, 0, 0.51), WOOD, 0, 0.8),
        part(at(new BoxGeometry(0.04, 0.62, 0.62), 0.51, 0, 0), WOOD, 0, 0.8),
      ]);
    case 'crayon':
      return bake([
        part(new CylinderGeometry(0.13, 0.13, 1.3, 10), WHITE, 1, 0.8),
        part(at(new CylinderGeometry(0.135, 0.135, 0.8, 10), 0, -0.1, 0), WHITE, 0.55, 0.9),
        part(at(new ConeGeometry(0.13, 0.32, 10), 0, 0.81, 0), WHITE, 1, 0.8),
      ]);
    case 'ruler': {
      const parts = [part(new BoxGeometry(6, 0.08, 0.7), WHITE, 1, 0.55)];
      for (let i = 0; i <= 30; i += 1) {
        const long = i % 5 === 0;
        parts.push(part(at(new BoxGeometry(0.03, 0.02, long ? 0.26 : 0.14), -2.85 + i * 0.19, 0.045, 0.35 - (long ? 0.13 : 0.07)), GRAPHITE_HEX, 0, 0.9));
      }
      return bake(parts);
    }
    case 'jar':
      return bake([
        part(new CylinderGeometry(0.72, 0.72, 1.4, 22), 0xcfe5e6, 0, 0.08, 0.2),
        part(at(new CylinderGeometry(0.6, 0.6, 1.05, 22), 0, -0.14, 0), WHITE, 0.9, 0.5),
        part(at(new CylinderGeometry(0.66, 0.66, 0.26, 22), 0, 0.82, 0), WHITE, 0.35, 0.35, 0.8),
      ]);
    case 'card': {
      const parts = [part(new BoxGeometry(2.2, 0.07, 1.5), 0xba8a5a, 0.18, 0.95)];
      for (let i = 0; i < 9; i += 1) parts.push(part(at(new BoxGeometry(0.035, 0.075, 1.5), -0.96 + i * 0.24, 0.002, 0), 0x9a6c40, 0, 0.95));
      return bake(parts);
    }
    case 'paper':
      return bake([part(new BoxGeometry(1.1, 0.025, 1.1), WHITE, 1, 0.9)]);
    case 'jaw':
      return bake([
        part(at(new BoxGeometry(1.5, 0.2, 0.26), 0, 0, 0), WOOD, 0.35, 0.8),
        part(at(new BoxGeometry(0.5, 0.12, 0.27), -0.55, 0.12, 0), WOOD_DARK, 0, 0.8),
        part(at(new TorusGeometry(0.13, 0.035, 6, 12), 0.1, 0.16, 0, 0, Math.PI / 2), METAL, 0, 0.3, 0.9),
      ]);
    case 'pencil':
      return bake([
        part(new CylinderGeometry(0.15, 0.15, 2.8, 6), WHITE, 1, 0.55),
        part(at(new ConeGeometry(0.15, 0.42, 6), 0, 1.61, 0), WOOD, 0, 0.8),
        part(at(new ConeGeometry(0.05, 0.14, 6), 0, 1.76, 0), GRAPHITE_HEX, 0, 0.5),
        part(at(new CylinderGeometry(0.155, 0.155, 0.22, 10), 0, -1.5, 0), METAL, 0, 0.3, 0.9),
        part(at(new CylinderGeometry(0.15, 0.15, 0.24, 10), 0, -1.72, 0), 0xf29aa0, 0, 0.9),
      ]);
  }
}

const pieceGeometryCache = new Map<PieceType, BufferGeometry>();

export function pieceGeometry(type: PieceType) {
  let geometry = pieceGeometryCache.get(type);
  if (!geometry) {
    geometry = buildPiece(type);
    pieceGeometryCache.set(type, geometry);
  }
  return geometry;
}

let pieceMaterial: MeshStandardNodeMaterial | null = null;

/** The one material every supply piece shares. */
export function getPieceMaterial(glue: Color) {
  if (pieceMaterial) return pieceMaterial;
  const material = new MeshStandardNodeMaterial();
  const surf = attribute<'vec3'>('surf', 'vec3');
  const tintGrime = attribute<'vec4'>('tintGrime', 'vec4');
  const grime = max(tintGrime.w, float(0));
  const flash = max(tintGrime.w.negate(), float(0));
  const base = attribute<'vec3'>('color', 'vec3').mul(mix(vec3(1, 1, 1), tintGrime.xyz, surf.x));
  material.colorNode = mix(base, vec3(glue.r, glue.g, glue.b), grime.mul(0.86));
  material.roughnessNode = mix(surf.y, float(0.16), grime);
  material.metalnessNode = surf.z.mul(float(1).sub(grime));
  material.emissiveNode = base.mul(flash.mul(1.6)).add(vec3(0.9, 0.75, 0.5).mul(flash.mul(0.6)));
  pieceMaterial = material;
  return material;
}

/** Same geometry as a piece, with its own per-instance buffer. */
function instancedGeometry(type: PieceType, capacity: number) {
  const source = pieceGeometry(type);
  const geometry = new BufferGeometry();
  for (const name of ['position', 'normal', 'color', 'surf']) geometry.setAttribute(name, source.getAttribute(name));
  const tint = new InstancedBufferAttribute(new Float32Array(capacity * 4), 4);
  tint.setUsage(DynamicDrawUsage);
  geometry.setAttribute('tintGrime', tint);
  geometry.boundingSphere = source.boundingSphere?.clone() ?? null;
  return geometry;
}

const ZERO = new Matrix4().makeScale(0, 0, 0);

export type PieceSet = ReturnType<typeof createPieceSet>;

/** A bank of instanced meshes, one per piece type, with slot allocation. */
export function createPieceSet(parent: Object3D, glue: Color, capacity: Partial<Record<PieceType, number>>, defaultCapacity: number) {
  const material = getPieceMaterial(glue);
  const banks = new Map<PieceType, { mesh: InstancedMesh; tint: InstancedBufferAttribute; free: number[]; high: number; dirty: boolean; tintDirty: boolean }>();
  for (const type of PIECE_TYPES) {
    const cap = capacity[type] ?? defaultCapacity;
    const geometry = instancedGeometry(type, cap);
    const mesh = new InstancedMesh(geometry, material, cap);
    mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    mesh.frustumCulled = false;
    mesh.name = `pieces-${type}`;
    mesh.count = 0;
    for (let i = 0; i < cap; i += 1) mesh.setMatrixAt(i, ZERO);
    parent.add(mesh);
    const free: number[] = [];
    for (let i = cap - 1; i >= 0; i -= 1) free.push(i);
    banks.set(type, { mesh, tint: geometry.getAttribute('tintGrime') as InstancedBufferAttribute, free, high: 0, dirty: true, tintDirty: true });
  }

  return {
    alloc(type: PieceType) {
      const bank = banks.get(type)!;
      const slot = bank.free.pop();
      if (slot === undefined) return -1;
      if (slot + 1 > bank.high) {
        bank.high = slot + 1;
        bank.mesh.count = bank.high;
      }
      return slot;
    },
    release(type: PieceType, slot: number) {
      const bank = banks.get(type)!;
      bank.mesh.setMatrixAt(slot, ZERO);
      bank.free.push(slot);
      bank.dirty = true;
    },
    setMatrix(type: PieceType, slot: number, matrix: Matrix4) {
      const bank = banks.get(type)!;
      bank.mesh.setMatrixAt(slot, matrix);
      bank.dirty = true;
    },
    setTint(type: PieceType, slot: number, color: Color, grime: number) {
      const bank = banks.get(type)!;
      bank.tint.setXYZW(slot, color.r, color.g, color.b, grime);
      bank.tintDirty = true;
    },
    setGrime(type: PieceType, slot: number, grime: number) {
      const bank = banks.get(type)!;
      bank.tint.setW(slot, grime);
      bank.tintDirty = true;
    },
    available(type: PieceType) {
      return banks.get(type)!.free.length;
    },
    flush() {
      for (const bank of banks.values()) {
        if (bank.dirty) bank.mesh.instanceMatrix.needsUpdate = true;
        if (bank.tintDirty) bank.tint.needsUpdate = true;
        bank.dirty = false;
        bank.tintDirty = false;
      }
    },
    clear() {
      for (const bank of banks.values()) {
        const cap = bank.mesh.instanceMatrix.count;
        bank.free.length = 0;
        for (let i = cap - 1; i >= 0; i -= 1) {
          bank.mesh.setMatrixAt(i, ZERO);
          bank.free.push(i);
        }
        bank.high = 0;
        bank.mesh.count = 0;
        bank.dirty = true;
      }
    },
    meshes() {
      return [...banks.values()].map((bank) => bank.mesh);
    },
  };
}

/** Build a static merged mesh geometry from placed pieces (table clutter). */
export function mergePlacedPieces(placements: Array<{ type: PieceType; matrix: Matrix4; tint: Color }>) {
  const geometries: BufferGeometry[] = [];
  for (const placement of placements) {
    const source = pieceGeometry(placement.type);
    const g = new BufferGeometry();
    g.setAttribute('position', source.getAttribute('position').clone());
    g.setAttribute('normal', source.getAttribute('normal').clone());
    g.setAttribute('color', source.getAttribute('color').clone());
    g.setAttribute('surf', source.getAttribute('surf').clone());
    const count = g.getAttribute('position').count;
    const tint = new Float32Array(count * 4);
    for (let i = 0; i < count; i += 1) {
      tint[i * 4] = placement.tint.r;
      tint[i * 4 + 1] = placement.tint.g;
      tint[i * 4 + 2] = placement.tint.b;
      tint[i * 4 + 3] = 0;
    }
    g.setAttribute('tintGrime', new BufferAttribute(tint, 4));
    g.applyMatrix4(placement.matrix);
    geometries.push(g);
  }
  const merged = mergeGeometries(geometries);
  for (const g of geometries) g.dispose();
  merged.computeBoundingSphere();
  return merged;
}

/** Give a baked (non-instanced) geometry the per-vertex tintGrime the piece material reads. */
export function withStaticTint(geometry: BufferGeometry, tint: Color) {
  const count = geometry.getAttribute('position').count;
  const data = new Float32Array(count * 4);
  for (let i = 0; i < count; i += 1) {
    data[i * 4] = tint.r;
    data[i * 4 + 1] = tint.g;
    data[i * 4 + 2] = tint.b;
  }
  geometry.setAttribute('tintGrime', new BufferAttribute(data, 4));
  return geometry;
}
