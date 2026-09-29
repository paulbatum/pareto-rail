import {
  AdditiveBlending,
  BoxGeometry,
  BufferGeometry,
  ConeGeometry,
  Color,
  DoubleSide,
  Group,
  IcosahedronGeometry,
  Mesh,
  MeshBasicMaterial,
  Quaternion,
  SphereGeometry,
  Vector3,
} from 'three';
import { createHullBuilder, type HullBuilder } from './hull-kit';
import {
  CRAFT_RIG,
  CRIMSON,
  CRIMSON_HOT,
  CYAN,
  CYAN_HOT,
  hdr,
  MOLTEN,
  OBSIDIAN,
  OBSIDIAN_DARK,
  SHIELD_AMBER,
  SHIELD_ROSE,
  WHITE_HOT,
} from './palette';

// Hostile silhouettes, each distinct in shape AND motion so a glance sorts them:
//   dart   - needle interceptor, swept wings, twin engines: fast lateral strafer
//   raker  - ring-winged gunship: spins and corkscrews around the rail
//   bomber - fat wasp with twin booms and a chin gun: lumbers, lobs plasma
//   turret - hull-rooted twin gun: tracks the camera
//   gen    - shutter-caged shield emitter on the flagship wall
//   core / heart - reactor orbs in the flagship's trench
//   bolt   - crimson plasma ball, a shot you can shoot down
// Nose is +z on every craft (Object3D.lookAt aims +z), so the runtime's facing
// logic points each one where it is going.

const HULL = OBSIDIAN.clone().multiplyScalar(1.15);
const HULL_DARK = OBSIDIAN_DARK.clone().multiplyScalar(1.3);
const TRIM = new Color(0.42, 0.34, 0.46);
const GUN = new Color(0.32, 0.2, 0.22);
// Keep the brightest channel near 2 so glows stay orange (not clipped to yellow) and bloom picks them up.
const FLAME = hdr(MOLTEN, 2.3);
const EYE = hdr(new Color(1.0, 0.07, 0.12), 2.2);
const EDGE = hdr(MOLTEN, 1.9);

export type EnemyKindName = 'dart' | 'raker' | 'bomber' | 'turret' | 'pdgun' | 'gen' | 'core' | 'heart' | 'bolt';

type Built = { hull: BufferGeometry; glow: BufferGeometry | null };
const geometryCache = new Map<string, Built>();

const qz = (angle: number) => new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), angle);
const qy = (angle: number) => new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), angle);

function assemble(key: string, build: (builder: HullBuilder) => void): Built {
  const cached = geometryCache.get(key);
  if (cached) return cached;
  const builder = createHullBuilder(new Quaternion(), CRAFT_RIG);
  build(builder);
  const built = builder.build();
  geometryCache.set(key, built);
  return built;
}

function buildDart(b: HullBuilder) {
  b.taperedBox(0, 0, 0, 1.5, 0.95, 9, 0.12, 0.5, HULL, { jitter: 0.05 });
  b.taperedBox(0, 0.55, 0.9, 0.75, 0.55, 3.4, 0.4, 0.5, HULL_DARK);
  for (const side of [-1, 1]) {
    b.taperedBox(side * 3.0, -0.05, 1.5, 5.6, 0.16, 3.2, 0.22, 1, HULL, { rotation: qy(side * -0.46) });
    b.box(side * 3.85, -0.02, 0.0, 0.1, 0.1, 3.4, EDGE, { glow: true, rotation: qy(side * -0.46) });
    b.cylinder(side * 0.8, 0, 4.4, 0.44, 1.5, 'z', 8, TRIM);
    b.cylinder(side * 0.8, 0, 5.2, 0.4, 0.2, 'z', 8, FLAME, { glow: true });
  }
  b.taperedBox(0, 0.95, 3.7, 0.14, 1.5, 1.9, 1, 0.3, HULL_DARK);
  b.box(0, 0.62, -1.7, 0.42, 0.14, 1.0, EYE, { glow: true });
}

function buildRaker(b: HullBuilder) {
  b.taperedBox(0, 0, 0.4, 1.9, 1.5, 5, 0.3, 0.6, HULL, { jitter: 0.05 });
  b.cylinder(0, 0, 3.1, 0.7, 1.2, 'z', 8, TRIM);
  b.cylinder(0, 0, 3.8, 0.62, 0.2, 'z', 8, FLAME, { glow: true });
  const segments = 12;
  const radius = 4.3;
  for (let i = 0; i < segments; i += 1) {
    const angle = (i / segments) * Math.PI * 2;
    const x = Math.cos(angle) * radius;
    const y = Math.sin(angle) * radius;
    b.box(x, y, 0, 2.5, 0.72, 0.9, i % 3 === 0 ? HULL_DARK : HULL, { rotation: qz(angle + Math.PI / 2), jitter: 0.06 });
    const ix = Math.cos(angle) * (radius - 0.5);
    const iy = Math.sin(angle) * (radius - 0.5);
    b.box(ix, iy, -0.05, 1.7, 0.16, 0.22, EDGE, { glow: true, rotation: qz(angle + Math.PI / 2) });
  }
  for (let i = 0; i < 4; i += 1) {
    const angle = (i / 4) * Math.PI * 2 + Math.PI / 4;
    b.box(Math.cos(angle) * radius * 0.5, Math.sin(angle) * radius * 0.5, 0.1, radius * 0.95, 0.3, 0.4, TRIM, { rotation: qz(angle) });
    b.box(Math.cos(angle) * radius, Math.sin(angle) * radius, -0.8, 0.5, 0.5, 1.4, EYE, { glow: true });
  }
  for (const side of [-1, 1]) b.taperedBox(0, side * radius, -2.0, 0.8, 0.8, 4.4, 0.2, 0.2, HULL_DARK);
}

function buildBomber(b: HullBuilder) {
  b.taperedBox(0, 0, 0, 4.8, 2.6, 9.5, 0.34, 0.7, HULL, { jitter: 0.05 });
  b.taperedBox(0, 1.7, 1.4, 2.4, 1.1, 5.2, 0.5, 0.6, HULL_DARK);
  for (const side of [-1, 1]) {
    b.taperedBox(side * 3.7, 0, 2.6, 0.9, 0.95, 7.2, 0.6, 0.8, HULL_DARK);
    b.taperedBox(side * 3.7, 0.9, 5.6, 0.22, 2.3, 2.3, 1, 0.3, HULL);
    b.cylinder(side * 3.7, 0, 6.4, 0.5, 0.5, 'z', 8, FLAME, { glow: true });
    b.taperedBox(side * 2.6, 0, 0.6, 3.2, 0.22, 3.4, 0.3, 1, HULL, { rotation: qy(side * -0.3) });
  }
  b.cylinder(0, -1.5, -3.6, 0.34, 4.2, 'z', 8, GUN);
  b.cylinder(0, -1.5, -5.7, 0.3, 0.3, 'z', 8, EYE, { glow: true });
  b.box(0, -1.32, 0.6, 2.4, 0.08, 3.2, EDGE, { glow: true });
  for (const side of [-1, 1]) b.box(side * 0.9, 0.55, -3.8, 0.55, 0.22, 0.7, EYE, { glow: true });
  for (let i = 0; i < 3; i += 1) b.box(0, 0.4 + i * 0.28, 2.6 + i * 1.2, 3.6 - i * 0.6, 0.12, 0.7, EDGE, { glow: true });
}

function buildTurret(b: HullBuilder) {
  b.cylinder(0, -1.1, 0, 2.7, 1.5, 'y', 10, TRIM);
  b.cylinder(0, 0.1, 0, 1.9, 1.5, 'y', 8, HULL_DARK, { jitter: 0.05 });
  b.taperedBox(0, 1.2, 0.5, 3.2, 1.7, 3.6, 0.72, 0.8, HULL, { jitter: 0.05 });
  for (const x of [-0.75, 0.75]) {
    b.box(x, 1.2, -3.2, 0.42, 0.42, 4.8, GUN);
    b.box(x, 1.2, -5.7, 0.36, 0.36, 0.3, EYE, { glow: true });
  }
  b.box(0, 0.12, 0, 4.0, 0.14, 4.0, EDGE, { glow: true });
  b.box(0, 2.05, 1.6, 1.2, 0.2, 0.9, EYE, { glow: true });
}

/** Ring segments for gyro cages: returns a set of boxes around an axis. */
function gyroRing(b: HullBuilder, radius: number, plane: 'xy' | 'xz' | 'yz', color: Color, glow: boolean, thickness = 0.7) {
  const segments = 12;
  for (let i = 0; i < segments; i += 1) {
    const angle = (i / segments) * Math.PI * 2;
    const c = Math.cos(angle) * radius;
    const s = Math.sin(angle) * radius;
    const length = radius * 0.55;
    if (plane === 'xy') b.box(c, s, 0, length, thickness, thickness, color, { glow, rotation: qz(angle + Math.PI / 2) });
    else if (plane === 'xz') b.box(c, 0, s, length, thickness, thickness, color, { glow, rotation: qy(-angle - Math.PI / 2) });
    else b.box(0, c, s, thickness, length, thickness, color, { glow, rotation: new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), angle + Math.PI / 2) });
  }
}

function buildGenFrame(b: HullBuilder) {
  b.box(0, 0, -5.4, 17, 17, 2.4, HULL_DARK, { jitter: 0.08 });
  b.box(0, 0, -4.1, 13.5, 13.5, 0.3, EDGE, { glow: true, skip: 32 });
  for (const [x, y] of [[-6, -6], [6, -6], [-6, 6], [6, 6]] as const) b.box(x, y, -2.6, 0.9, 0.9, 5, TRIM);
  gyroRing(b, 6.6, 'xy', HULL, false, 0.9);
  gyroRing(b, 5.6, 'xz', TRIM, false, 0.7);
  gyroRing(b, 5.0, 'yz', HULL, false, 0.6);
}

function buildCoreFrame(b: HullBuilder) {
  gyroRing(b, 7.4, 'xz', TRIM, false, 0.9);
  gyroRing(b, 6.4, 'yz', HULL, false, 0.8);
  b.box(0, 11.5, 0, 0.9, 8, 0.9, HULL_DARK);
  b.box(0, -11.5, 0, 0.9, 8, 0.9, HULL_DARK);
  for (let i = 0; i < 4; i += 1) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    b.box(Math.cos(a) * 5, 0, Math.sin(a) * 5, 0.5, 9, 0.5, EDGE, { glow: true });
  }
  b.box(0, 15.6, 0, 1.6, 1.6, 1.6, EYE, { glow: true });
  b.box(0, -15.6, 0, 1.6, 1.6, 1.6, EYE, { glow: true });
}

function buildHeartFrame(b: HullBuilder) {
  gyroRing(b, 14.5, 'xz', TRIM, false, 1.4);
  gyroRing(b, 13, 'xy', HULL, false, 1.2);
  gyroRing(b, 11.8, 'yz', TRIM, false, 1.1);
  for (let i = 0; i < 6; i += 1) {
    const a = (i / 6) * Math.PI * 2;
    b.box(Math.cos(a) * 16.5, 0, Math.sin(a) * 16.5, 1.2, 15, 1.2, EDGE, { glow: true });
    b.box(Math.cos(a) * 16.5, 8, Math.sin(a) * 16.5, 2.4, 1.2, 2.4, HULL_DARK);
    b.box(Math.cos(a) * 16.5, -8, Math.sin(a) * 16.5, 2.4, 1.2, 2.4, HULL_DARK);
  }
}

// ---- assembly ----------------------------------------------------------------------

export type EnemyParts = {
  /** Flat armor color for plates that have no vertex colors (petals, shells). */
  solidMaterial: MeshBasicMaterial;
  hullMaterial: MeshBasicMaterial;
  glowMaterial: MeshBasicMaterial;
  extraMaterials: MeshBasicMaterial[];
  /** Objects the runtime animates each frame. */
  spinners: Array<{ object: Group | Mesh; axis: Vector3; rate: number }>;
  /** Exhaust plume material: dimmed by the runtime as a craft passes close to the lens. */
  trail?: MeshBasicMaterial;
  petals?: Group[];
  plates?: Group;
  core?: Mesh;
  halo?: Mesh;
  baseRadius: number;
  disposables: Array<{ dispose(): void }>;
};

function meshFrom(built: Built, parts: EnemyParts, parent: Group) {
  const hullMesh = new Mesh(built.hull, parts.hullMaterial);
  parent.add(hullMesh);
  if (built.glow) parent.add(new Mesh(built.glow, parts.glowMaterial));
}

export const SOLID_BASE = new Color(0.2, 0.16, 0.22);

function baseParts(radius: number): EnemyParts {
  return {
    solidMaterial: new MeshBasicMaterial({ color: SOLID_BASE.clone() }),
    hullMaterial: new MeshBasicMaterial({ vertexColors: true }),
    glowMaterial: new MeshBasicMaterial({ vertexColors: true }),
    extraMaterials: [],
    spinners: [],
    baseRadius: radius,
    disposables: [],
  };
}

/** Additive exhaust streaks behind engines: they read at range and show which way a craft is flying. */
function addTrails(parent: Group, parts: EnemyParts, points: ReadonlyArray<readonly [number, number, number]>, length: number, width: number) {
  const material = new MeshBasicMaterial({ color: hdr(MOLTEN, 1.1), transparent: true, opacity: 0.5, blending: AdditiveBlending, depthWrite: false, side: DoubleSide });
  parts.extraMaterials.push(material);
  parts.trail = material;
  // A tapered plume: wide at the nozzle, fading to a point behind the craft.
  const geometry = new ConeGeometry(width * 1.1, length, 8, 1, true);
  geometry.rotateX(Math.PI / 2);
  parts.disposables.push(geometry);
  for (const [x, y, z] of points) {
    const trail = new Mesh(geometry, material);
    trail.position.set(x, y, z + length / 2);
    trail.userData.raildIgnoreOcclusion = true;
    parent.add(trail);
  }
}

function glowBall(radius: number, color: Color, parts: EnemyParts, detail = 2) {
  const material = new MeshBasicMaterial({ color });
  const mesh = new Mesh(new IcosahedronGeometry(radius, detail), material);
  parts.extraMaterials.push(material);
  parts.disposables.push(mesh.geometry);
  return mesh;
}

function haloBall(radius: number, color: Color, parts: EnemyParts) {
  const material = new MeshBasicMaterial({ color, transparent: true, blending: AdditiveBlending, depthWrite: false, opacity: 0.55 });
  const mesh = new Mesh(new SphereGeometry(radius, 16, 12), material);
  mesh.userData.raildIgnoreOcclusion = true;
  parts.extraMaterials.push(material);
  parts.disposables.push(mesh.geometry);
  return mesh;
}

export function createEnemyObject(kind: EnemyKindName): Group {
  const root = new Group();
  const inner = new Group();
  root.add(inner);
  let parts: EnemyParts;

  switch (kind) {
    case 'dart': {
      parts = baseParts(4.4);
      const body = new Group();
      body.rotation.y = Math.PI;
      meshFrom(assemble('dart', buildDart), parts, body);
      addTrails(body, parts, [[-0.8, 0, 5.3], [0.8, 0, 5.3]], 7, 0.36);
      inner.add(body);
      inner.scale.setScalar(1.3);
      break;
    }
    case 'raker': {
      parts = baseParts(5.6);
      const body = new Group();
      body.rotation.y = Math.PI;
      meshFrom(assemble('raker', buildRaker), parts, body);
      addTrails(body, parts, [[0, 0, 3.9]], 8, 0.9);
      inner.add(body);
      inner.scale.setScalar(1.2);
      parts.spinners.push({ object: body, axis: new Vector3(0, 0, 1), rate: 0 });
      break;
    }
    case 'bomber': {
      parts = baseParts(6.4);
      const body = new Group();
      body.rotation.y = Math.PI;
      meshFrom(assemble('bomber', buildBomber), parts, body);
      addTrails(body, parts, [[-3.7, 0, 6.7], [3.7, 0, 6.7]], 8, 0.8);
      inner.add(body);
      inner.scale.setScalar(1.15);
      const plates = new Group();
      plates.add(new Mesh(new BoxGeometry(3.2, 0.5, 4.2), parts.solidMaterial));
      plates.position.set(0, 2.3, 0.8);
      body.add(plates);
      parts.plates = plates;
      parts.disposables.push(plates.children[0] instanceof Mesh ? plates.children[0].geometry : new BufferGeometry());
      break;
    }
    case 'turret':
    case 'pdgun': {
      const belly = kind === 'turret';
      parts = baseParts(belly ? 5.4 : 4.4);
      const body = new Group();
      body.rotation.y = Math.PI;
      meshFrom(assemble('turret', buildTurret), parts, body);
      inner.add(body);
      inner.scale.setScalar(belly ? 1.3 : 1.0);
      break;
    }
    case 'gen': {
      parts = baseParts(9.5);
      meshFrom(assemble('gen', buildGenFrame), parts, inner);
      const core = glowBall(3.3, hdr(SHIELD_AMBER, 1.8), parts);
      inner.add(core);
      const halo = haloBall(5.6, hdr(SHIELD_ROSE, 1.1), parts);
      inner.add(halo);
      parts.core = core;
      parts.halo = halo;
      const petals: Group[] = [];
      for (let i = 0; i < 4; i += 1) {
        const hinge = new Group();
        hinge.rotation.z = (i / 4) * Math.PI * 2;
        // The pivot sits at the petal's outer edge so opening folds it back toward the hull.
        const pivot = new Group();
        pivot.position.set(0, 6.4, 4.2);
        const petal = new Mesh(new BoxGeometry(4.6, 6.4, 0.5), parts.solidMaterial);
        petal.position.set(0, -3.2, 0);
        const rim = new Mesh(new BoxGeometry(4.0, 0.28, 0.2), parts.extraMaterials[0]);
        rim.position.set(0, -0.1, 0.3);
        parts.disposables.push(petal.geometry, rim.geometry);
        pivot.add(petal, rim);
        hinge.add(pivot);
        inner.add(hinge);
        petals.push(pivot);
      }
      parts.petals = petals;
      parts.spinners.push({ object: core, axis: new Vector3(0, 1, 0), rate: 1.4 });
      break;
    }
    case 'core': {
      parts = baseParts(11);
      meshFrom(assemble('core', buildCoreFrame), parts, inner);
      const core = glowBall(4.4, hdr(WHITE_HOT, 1.5), parts);
      inner.add(core);
      const halo = haloBall(7.0, hdr(CRIMSON, 1.1), parts);
      inner.add(halo);
      parts.core = core;
      parts.halo = halo;
      parts.spinners.push({ object: core, axis: new Vector3(0.3, 1, 0.2).normalize(), rate: 2.2 });
      break;
    }
    case 'heart': {
      parts = baseParts(19);
      meshFrom(assemble('heart', buildHeartFrame), parts, inner);
      const core = glowBall(7.6, hdr(WHITE_HOT, 1.6), parts);
      inner.add(core);
      const halo = haloBall(11, hdr(CRIMSON, 1.1), parts);
      inner.add(halo);
      parts.core = core;
      parts.halo = halo;
      const plates = new Group();
      const plateMaterial = parts.solidMaterial;
      for (let i = 0; i < 8; i += 1) {
        const a = (i / 8) * Math.PI * 2;
        const plate = new Mesh(new BoxGeometry(11, 15, 1.8), plateMaterial);
        plate.position.set(Math.cos(a) * 11.5, 0, Math.sin(a) * 11.5);
        plate.rotation.y = -a + Math.PI / 2;
        parts.disposables.push(plate.geometry);
        plates.add(plate);
      }
      inner.add(plates);
      parts.plates = plates;
      parts.spinners.push({ object: core, axis: new Vector3(0, 1, 0), rate: 1.2 });
      break;
    }
    default: {
      // bolt: a plasma ball with crossed flares
      parts = baseParts(2.2);
      const core = glowBall(0.95, hdr(WHITE_HOT, 3.2), parts, 1);
      inner.add(core);
      const halo = haloBall(2.1, hdr(CRIMSON, 2.2), parts);
      inner.add(halo);
      parts.core = core;
      parts.halo = halo;
      const flareMaterial = new MeshBasicMaterial({ color: hdr(CRIMSON_HOT, 2.4), transparent: true, blending: AdditiveBlending, depthWrite: false });
      parts.extraMaterials.push(flareMaterial);
      const flareGeometry = new BoxGeometry(0.22, 0.22, 5.6);
      parts.disposables.push(flareGeometry);
      for (let i = 0; i < 3; i += 1) {
        const flare = new Mesh(flareGeometry, flareMaterial);
        flare.rotation.set(i * 1.05, i * 0.7, i * 1.6);
        flare.userData.raildIgnoreOcclusion = true;
        inner.add(flare);
      }
      break;
    }
  }
  root.userData.parts = parts;
  root.userData.kind = kind;
  return root;
}

export function enemyParts(object: Group): EnemyParts {
  return object.userData.parts as EnemyParts;
}

export function disposeEnemyObject(object: Group) {
  const parts = object.userData.parts as EnemyParts | undefined;
  if (!parts) return;
  parts.hullMaterial.dispose();
  parts.glowMaterial.dispose();
  parts.solidMaterial.dispose();
  for (const material of parts.extraMaterials) material.dispose();
  for (const item of parts.disposables) item.dispose();
}

export function disposeEnemyCaches() {
  for (const built of geometryCache.values()) {
    built.hull.dispose();
    built.glow?.dispose();
  }
  geometryCache.clear();
}

// ---- the player's tools --------------------------------------------------------------

export function createPlayerShot() {
  // Nose along +z (lookAt aims +z at the target): a hot needle, a soft head glow, a long cyan tail.
  const group = new Group();
  const coreMaterial = new MeshBasicMaterial({ color: hdr(CYAN_HOT, 2.6), side: DoubleSide });
  const core = new Mesh(new BoxGeometry(0.2, 0.2, 3.4), coreMaterial);
  const haloMaterial = new MeshBasicMaterial({ color: hdr(CYAN, 1.3), transparent: true, opacity: 0.55, blending: AdditiveBlending, depthWrite: false });
  const halo = new Mesh(new SphereGeometry(0.55, 10, 8), haloMaterial);
  halo.position.z = 1.2;
  const tailMaterial = new MeshBasicMaterial({ color: hdr(CYAN, 1.1), transparent: true, opacity: 0.4, blending: AdditiveBlending, depthWrite: false });
  const tail = new Mesh(new BoxGeometry(0.09, 0.09, 11), tailMaterial);
  tail.position.z = -6.2;
  for (const child of [core, halo, tail]) child.userData.raildIgnoreOcclusion = true;
  group.add(core, halo, tail);
  group.userData.materials = [coreMaterial, haloMaterial, tailMaterial];
  group.userData.geometries = [core.geometry, halo.geometry, tail.geometry];
  return group;
}

export function disposePlayerShot(object: Group) {
  for (const material of (object.userData.materials as MeshBasicMaterial[] | undefined) ?? []) material.dispose();
  for (const geometry of (object.userData.geometries as BufferGeometry[] | undefined) ?? []) geometry.dispose();
}

export { Vector3 };
