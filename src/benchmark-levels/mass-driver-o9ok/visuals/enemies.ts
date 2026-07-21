import {
  BoxGeometry,
  BufferGeometry,
  CircleGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  Group,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  OctahedronGeometry,
  PlaneGeometry,
  RingGeometry,
  TetrahedronGeometry,
  TorusGeometry,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { createAdditiveBasicMaterial } from '../../../engine/visual-kit';
import {
  DRONE_AMBER,
  DRONE_SHELL,
  GUN_STEEL,
  GUN_STEEL_LIT,
  hdr,
  INTERLOCK_WARN,
  VIOLET,
} from './palette';

// Construction only. Silhouette first: every drone has an opaque dark shell so
// it still reads as a shape with the player's bloom slider at zero, and the glow
// is confined to thin edges and one small core.
//
// Two structural rules keep the barrel cheap to draw with a dozen drones in it:
// every geometry is built once at module scope and shared by every instance of
// its kind, and all the parts of a drone that share a tint role are merged into
// a single mesh. A sentry is three draw calls rather than five, and spawning one
// allocates nothing but materials.

export type TintPart = {
  material: MeshBasicMaterial;
  base: Color;
  kind: 'edge' | 'fill' | 'core';
};

export type ShardSpec = {
  size: number;
  color: Color;
  speed: number;
  spin: number;
};

/** A merged geometry plus the tint role and resting colour its mesh should take. */
type PartSpec = {
  geometry: BufferGeometry;
  kind: TintPart['kind'];
  base: Color;
  additive: boolean;
  /** Parts flagged as armour are hidden together when a hit stage completes. */
  armour?: boolean;
};

type KindSpec = {
  parts: PartSpec[];
  accent: Color;
  shards: ShardSpec[];
  lockRingScale: number;
  baseScale?: number;
  extra?: Record<string, unknown>;
};

type Placed = { geometry: BufferGeometry; matrix: Matrix4 };

/** Position a primitive inside its parent shape before merging. */
function place(geometry: BufferGeometry, options: {
  position?: [number, number, number];
  rotation?: [number, number, number];
  scale?: [number, number, number];
} = {}): Placed {
  const matrix = new Matrix4();
  if (options.scale) matrix.multiply(new Matrix4().makeScale(...options.scale));
  if (options.rotation) {
    const [x, y, z] = options.rotation;
    matrix
      .premultiply(new Matrix4().makeRotationZ(z))
      .premultiply(new Matrix4().makeRotationY(y))
      .premultiply(new Matrix4().makeRotationX(x));
  }
  if (options.position) matrix.premultiply(new Matrix4().makeTranslation(...options.position));
  return { geometry, matrix };
}

/** Merge positioned primitives into one shared geometry. Inputs are consumed. */
function merge(pieces: Placed[]): BufferGeometry {
  const prepared = pieces.map(({ geometry, matrix }) => {
    // three's primitives disagree on indexing — boxes and rings are indexed,
    // polyhedra are not — and mergeGeometries needs one or the other. Flattening
    // to non-indexed and keeping only positions makes every shape mergeable;
    // nothing here is lit or textured, so uv and normal are dead weight anyway.
    const clone = (geometry.index ? geometry.toNonIndexed() : geometry.clone()).applyMatrix4(matrix);
    clone.deleteAttribute('uv');
    clone.deleteAttribute('normal');
    return clone;
  });
  for (const piece of pieces) piece.geometry.dispose();
  const merged = mergeGeometries(prepared, false);
  for (const piece of prepared) piece.dispose();
  if (!merged) throw new Error('Mass Driver enemy part failed to merge');
  return merged;
}

function shardSet(count: number, size: number, color: Color, speed: number): ShardSpec[] {
  return Array.from({ length: count }, (_value, index) => ({
    size: size * (0.6 + ((index * 0.37) % 1) * 0.8),
    color,
    speed: speed * (0.7 + ((index * 0.61) % 1) * 0.7),
    spin: (index % 2 === 0 ? 1 : -1) * (3 + (index % 3)),
  }));
}

// ---- shared kind specifications, built once ------------------------------------

/**
 * Sentry — flat hexagonal wall drone. Reads as a plate edge-on and a hexagon
 * face-on, with one amber sight slit that tells you which way it is looking.
 */
const SENTRY: KindSpec = {
  parts: [
    {
      geometry: merge([
        place(new CircleGeometry(0.92, 6)),
        place(new BoxGeometry(0.16, 0.34, 0.16), { position: [-0.98, 0, 0] }),
        place(new BoxGeometry(0.16, 0.34, 0.16), { position: [0.98, 0, 0] }),
      ]),
      kind: 'fill',
      base: DRONE_SHELL,
      additive: false,
    },
    {
      geometry: merge([place(new RingGeometry(0.9, 1.02, 6))]),
      kind: 'edge',
      base: hdr(DRONE_AMBER, 0.5),
      additive: true,
    },
    {
      // The sight: a slit, not a dot — it gives the plate an orientation.
      geometry: merge([place(new PlaneGeometry(0.78, 0.13), { position: [0, 0, 0.04] })]),
      kind: 'core',
      base: hdr(DRONE_AMBER, 2.2),
      additive: true,
    },
  ],
  accent: DRONE_AMBER,
  shards: shardSet(7, 0.2, DRONE_AMBER, 9),
  lockRingScale: 1.05,
};

/**
 * Weaver — the needle that threads the coil gaps. Long, thin and swept, so a
 * crossing traversal reads as a streak before the trail even catches up.
 */
const WEAVER: KindSpec = {
  parts: [
    {
      geometry: merge([
        place(new OctahedronGeometry(0.34, 0), { scale: [0.5, 0.5, 3.1] }),
        place(new PlaneGeometry(0.72, 0.16), { position: [-0.3, 0, -0.55], rotation: [Math.PI / 2, 0, -0.5] }),
        place(new PlaneGeometry(0.72, 0.16), { position: [0.3, 0, -0.55], rotation: [Math.PI / 2, 0, 0.5] }),
      ]),
      kind: 'fill',
      base: DRONE_SHELL,
      additive: false,
    },
    {
      geometry: merge([place(new OctahedronGeometry(0.2, 0), { scale: [0.42, 0.42, 3.5] })]),
      kind: 'edge',
      base: hdr(DRONE_AMBER, 0.9),
      additive: true,
    },
    {
      geometry: merge([place(new ConeGeometry(0.15, 0.6, 5), { position: [0, 0, 1.3], rotation: [-Math.PI / 2, 0, 0] })]),
      kind: 'core',
      base: hdr(DRONE_AMBER, 2.4),
      additive: true,
    },
  ],
  accent: DRONE_AMBER,
  shards: shardSet(6, 0.16, DRONE_AMBER, 12),
  lockRingScale: 0.95,
};

/**
 * Bulwark — armoured blocker. A broad wedge whose plates break away at the stage
 * boundary, exposing the capacitor core that finishes it.
 */
const BULWARK: KindSpec = {
  parts: [
    {
      geometry: merge([place(new CylinderGeometry(0.55, 1.35, 1.5, 6), { rotation: [Math.PI / 2, 0, 0] })]),
      kind: 'fill',
      base: DRONE_SHELL,
      additive: false,
    },
    {
      geometry: merge([place(new TorusGeometry(1.2, 0.07, 4, 6), { position: [0, 0, -0.35] })]),
      kind: 'edge',
      base: hdr(DRONE_AMBER, 0.7),
      additive: true,
    },
    {
      // Dim and buried until the armour goes; the tint pass then lights it, so
      // "cracked open" is legible with no geometry swap.
      geometry: merge([place(new OctahedronGeometry(0.46, 0), { position: [0, 0, 0.2] })]),
      kind: 'core',
      base: DRONE_AMBER.clone().multiplyScalar(0.35),
      additive: true,
    },
    {
      geometry: merge([
        place(new BoxGeometry(1.15, 0.24, 1.5), { position: [-0.62, 0, 0.1], rotation: [0, 0, -0.42] }),
        place(new BoxGeometry(1.15, 0.24, 1.5), { position: [0.62, 0, 0.1], rotation: [0, 0, 0.42] }),
      ]),
      kind: 'fill',
      base: GUN_STEEL_LIT,
      additive: false,
      armour: true,
    },
    {
      geometry: merge([
        place(new PlaneGeometry(1.15, 0.05), { position: [-0.62, -0.12, 0.86], rotation: [0, 0, -0.42] }),
        place(new PlaneGeometry(1.15, 0.05), { position: [0.62, 0.12, 0.86], rotation: [0, 0, 0.42] }),
      ]),
      kind: 'edge',
      base: hdr(DRONE_AMBER, 0.4),
      additive: true,
      armour: true,
    },
  ],
  accent: DRONE_AMBER,
  shards: shardSet(11, 0.26, DRONE_AMBER, 8),
  lockRingScale: 1.5,
};

/** Darter — the drones' shot. Small, sharp, and unmistakably incoming. */
const DARTER: KindSpec = {
  parts: [
    {
      geometry: merge([place(new TetrahedronGeometry(0.34, 0))]),
      kind: 'core',
      base: hdr(DRONE_AMBER, 3.0),
      additive: true,
    },
    {
      geometry: merge([place(new RingGeometry(0.44, 0.56, 3))]),
      kind: 'edge',
      base: hdr(INTERLOCK_WARN, 1.2),
      additive: true,
    },
  ],
  accent: INTERLOCK_WARN,
  shards: shardSet(4, 0.13, DRONE_AMBER, 10),
  lockRingScale: 0.8,
  extra: { isHostileShot: true, trailColor: DRONE_AMBER.clone().multiplyScalar(0.9) },
};

/**
 * Interlock — a safety clamp bolted across the bore. Two jaws holding a violet
 * gun-side conductor, with an amber fault core that is the thing you shoot.
 * Built at the scale of a piece of the gun rather than of a drone: it holds
 * station close to the payload and must never read as traffic.
 */
const INTERLOCK: KindSpec = {
  parts: [
    {
      geometry: merge([place(new BoxGeometry(2.5, 1.5, 1.4))]),
      kind: 'fill',
      base: GUN_STEEL,
      additive: false,
    },
    {
      geometry: merge([
        place(new BoxGeometry(0.42, 2.1, 0.9), { position: [-1.28, 0, 0.1] }),
        place(new BoxGeometry(0.42, 2.1, 0.9), { position: [1.28, 0, 0.1] }),
      ]),
      kind: 'fill',
      base: GUN_STEEL_LIT,
      additive: false,
      armour: true,
    },
    {
      geometry: merge([
        place(new ConeGeometry(0.2, 0.7, 4), { position: [-1.28, -1.15, 0.1] }),
        place(new ConeGeometry(0.2, 0.7, 4), { position: [1.28, 1.15, 0.1], rotation: [0, 0, Math.PI] }),
      ]),
      kind: 'edge',
      base: hdr(INTERLOCK_WARN, 0.8),
      additive: true,
      armour: true,
    },
    {
      geometry: merge([place(new CylinderGeometry(0.5, 0.5, 0.5, 10), { position: [0, 0, 0.6], rotation: [Math.PI / 2, 0, 0] })]),
      kind: 'core',
      base: hdr(INTERLOCK_WARN, 2.6),
      additive: true,
    },
    {
      // The gun-side conductor the clamp is holding, plus the fault ring around
      // the core: one edge mesh for the whole non-armour trim.
      geometry: merge([
        place(new TorusGeometry(0.92, 0.05, 3, 20), { position: [0, 0, 0.6] }),
        place(new BoxGeometry(2.7, 0.16, 0.16), { position: [0, 0, 0.74] }),
      ]),
      kind: 'edge',
      base: hdr(VIOLET, 1.1),
      additive: true,
    },
  ],
  accent: INTERLOCK_WARN,
  shards: shardSet(18, 0.4, INTERLOCK_WARN, 12),
  lockRingScale: 4.4,
  baseScale: 2.2,
  extra: { isInterlock: true },
};

// ---- instancing -------------------------------------------------------------------

function build(spec: KindSpec, spin?: { partIndex: number; speed: number }) {
  const group = new Group();
  const parts: TintPart[] = [];
  const armour: Mesh[] = [];
  const spinParts: Mesh[] = [];

  for (const [index, part] of spec.parts.entries()) {
    const material = part.additive
      ? createAdditiveBasicMaterial({ color: part.base, side: DoubleSide })
      : new MeshBasicMaterial({ color: part.base, side: DoubleSide });
    material.toneMapped = false;
    const mesh = new Mesh(part.geometry, material);
    group.add(mesh);
    parts.push({ material, base: part.base.clone(), kind: part.kind });
    if (part.armour) armour.push(mesh);
    if (spin && spin.partIndex === index) {
      mesh.userData.spinSpeed = spin.speed;
      spinParts.push(mesh);
    }
  }

  group.userData.parts = parts;
  group.userData.accent = spec.accent;
  group.userData.shardSpecs = spec.shards;
  group.userData.lockRingScale = spec.lockRingScale;
  if (spec.baseScale !== undefined) group.userData.baseScale = spec.baseScale;
  if (armour.length) group.userData.armour = armour;
  if (spinParts.length) group.userData.spinParts = spinParts;
  if (spec.extra) Object.assign(group.userData, spec.extra);
  return group;
}

export const createSentryMesh = () => build(SENTRY);
export const createWeaverMesh = () => build(WEAVER);
export const createBulwarkMesh = () => build(BULWARK);
export const createDarterMesh = () => build(DARTER);
export const createInterlockMesh = () => build(INTERLOCK);

/** Strips a target's armour when its first hit stage completes. */
export function breakArmour(mesh: Group) {
  const armour = mesh.userData.armour as Mesh[] | undefined;
  if (!armour) return;
  for (const plate of armour) plate.visible = false;
  mesh.userData.armour = undefined;
  mesh.userData.cracked = true;
}

export const breakBulwarkArmour = breakArmour;
export const breakInterlockJaws = breakArmour;
