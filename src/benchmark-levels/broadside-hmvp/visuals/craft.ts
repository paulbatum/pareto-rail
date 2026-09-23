import {
  BufferGeometry,
  Color,
  CylinderGeometry,
  DoubleSide,
  EdgesGeometry,
  Float32BufferAttribute,
  Group,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  OctahedronGeometry,
  RingGeometry,
  SphereGeometry,
  TorusGeometry,
} from 'three';
import type { Material, Object3D } from 'three';
import { additiveMaterialParameters } from '../../../engine/visual-kit';

// Leaf: target, projectile, and reticle construction. Every tintable part is
// registered in userData.parts with a role; the spine decides colors per state
// (idle, locked, damaged, denied) and writes them each frame.

export type TintRole = 'body' | 'edge' | 'glow' | 'eye';
export type TintPart = { material: MeshBasicMaterial | LineBasicMaterial; role: TintRole; base: Color };

export type CraftColors = {
  body: Color;
  edge: Color;
  glow: Color;
  eye: Color;
};

// Geometry is shared per shape: craft spawn by the hundred, and only their
// materials (which carry per-target tint state) are per instance.
const geometryCache = new Map<string, BufferGeometry>();
const edgeCache = new WeakMap<BufferGeometry, EdgesGeometry>();
function g(key: string, make: () => BufferGeometry) {
  let geometry = geometryCache.get(key);
  if (!geometry) {
    geometry = make();
    geometryCache.set(key, geometry);
  }
  return geometry;
}

function register(group: Object3D, material: MeshBasicMaterial | LineBasicMaterial, role: TintRole, base: Color) {
  const parts = (group.userData.parts ??= []) as TintPart[];
  parts.push({ material, role, base: base.clone() });
  material.color.copy(base);
}

function bodyMesh(group: Group, geometry: BufferGeometry, colors: CraftColors, edgeThreshold = 20) {
  const bodyMaterial = new MeshBasicMaterial({ color: colors.body });
  const mesh = new Mesh(geometry, bodyMaterial);
  register(group, bodyMaterial, 'body', colors.body);
  const edgeMaterial = new LineBasicMaterial(additiveMaterialParameters({ color: colors.edge }));
  let edgeGeometry = edgeCache.get(geometry);
  if (!edgeGeometry) {
    edgeGeometry = new EdgesGeometry(geometry, edgeThreshold);
    edgeCache.set(geometry, edgeGeometry);
  }
  const edges = new LineSegments(edgeGeometry, edgeMaterial);
  register(group, edgeMaterial, 'edge', colors.edge);
  mesh.add(edges);
  group.add(mesh);
  return mesh;
}

function glowMesh(group: Object3D, geometry: BufferGeometry, color: Color, role: TintRole = 'glow') {
  const material = new MeshBasicMaterial(additiveMaterialParameters({ color }));
  const mesh = new Mesh(geometry, material);
  register(group, material, role, color);
  group.add(mesh);
  return mesh;
}

/** Custom flat-shaded geometry from a triangle list. */
function triangles(points: number[][]): BufferGeometry {
  const positions: number[] = [];
  for (const [ax, ay, az, bx, by, bz, cx, cy, cz] of points) positions.push(ax, ay, az, bx, by, bz, cx, cy, cz);
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  return geometry;
}

// ---- swarm craft (all face local −z) ----------------------------------------------------

/** Dart: a swept delta with a raised spine and a single molten engine. Fast, streaming. */
export function createDartMesh(colors: CraftColors) {
  const group = new Group();
  const nose: [number, number, number] = [0, 0, -2.2];
  const lw: [number, number, number] = [-1.9, -0.1, 1.3];
  const rw: [number, number, number] = [1.9, -0.1, 1.3];
  const tail: [number, number, number] = [0, 0, 0.9];
  const spine: [number, number, number] = [0, 0.55, 0.4];
  const belly: [number, number, number] = [0, -0.35, 0.4];
  const geometry = g('dart', () => triangles([
    [...nose, ...spine, ...lw], [...nose, ...rw, ...spine],
    [...spine, ...tail, ...lw], [...spine, ...rw, ...tail],
    [...nose, ...lw, ...belly], [...nose, ...belly, ...rw],
    [...belly, ...lw, ...tail], [...belly, ...tail, ...rw],
  ]));
  bodyMesh(group, geometry, colors, 1);
  const engine = glowMesh(group, g('new OctahedronGeometry(0.42, 0)', () => new OctahedronGeometry(0.42, 0)), colors.glow);
  engine.position.set(0, 0.05, 1.05);
  engine.scale.set(1, 0.7, 1.6);
  const eye = glowMesh(group, g('new OctahedronGeometry(0.2, 0)', () => new OctahedronGeometry(0.2, 0)), colors.eye, 'eye');
  eye.position.set(0, 0.3, -0.9);
  group.userData.lockScale = 1.1;
  return group;
}

/** Ring-wing: a pod inside a circular wing on three struts. Corkscrews in braids. */
export function createRingwingMesh(colors: CraftColors) {
  const group = new Group();
  const ring = bodyMesh(group, g('new TorusGeometry(1.45, 0.2, 6, 18)', () => new TorusGeometry(1.45, 0.2, 6, 18)), colors, 30);
  void ring;
  const pod = bodyMesh(group, g('new OctahedronGeometry(0.62, 0)', () => new OctahedronGeometry(0.62, 0)), colors, 1);
  pod.scale.set(0.8, 0.8, 1.9);
  for (let i = 0; i < 3; i += 1) {
    const angle = (i / 3) * Math.PI * 2 + Math.PI / 2;
    const strut = new Mesh(g('new CylinderGeometry(0.07, 0.07, 1.3, 4)', () => new CylinderGeometry(0.07, 0.07, 1.3, 4)), (pod.material as MeshBasicMaterial));
    strut.position.set(Math.cos(angle) * 0.8, Math.sin(angle) * 0.8, 0);
    strut.rotation.z = angle + Math.PI / 2;
    group.add(strut);
  }
  const glowRing = glowMesh(group, g('new TorusGeometry(1.45, 0.05, 4, 32)', () => new TorusGeometry(1.45, 0.05, 4, 32)), colors.glow);
  glowRing.position.z = 0.22;
  const engine = glowMesh(group, g('new OctahedronGeometry(0.34, 0)', () => new OctahedronGeometry(0.34, 0)), colors.glow);
  engine.position.z = 1.25;
  const eye = glowMesh(group, g('new OctahedronGeometry(0.18, 0)', () => new OctahedronGeometry(0.18, 0)), colors.eye, 'eye');
  eye.position.z = -1.15;
  group.userData.lockScale = 1.25;
  return group;
}

/** Lancer: a heavy forward-swept claw with a charging crimson eye. Overtakes, brakes, fires. */
export function createLancerMesh(colors: CraftColors) {
  const group = new Group();
  const geometry = g('lancer', () => triangles([
    // Left prong
    [-0.5, 0.3, 1.2, -1.6, 0, -2.4, -0.6, -0.35, 0.8],
    [-0.5, 0.3, 1.2, -0.6, -0.35, 0.8, -1.6, 0, -2.4],
    [-0.5, 0.3, 1.2, -2.1, 0.05, 0.9, -1.6, 0, -2.4],
    [-2.1, 0.05, 0.9, -0.6, -0.35, 0.8, -1.6, 0, -2.4],
    // Right prong
    [0.5, 0.3, 1.2, 0.6, -0.35, 0.8, 1.6, 0, -2.4],
    [0.5, 0.3, 1.2, 1.6, 0, -2.4, 0.6, -0.35, 0.8],
    [0.5, 0.3, 1.2, 1.6, 0, -2.4, 2.1, 0.05, 0.9],
    [2.1, 0.05, 0.9, 1.6, 0, -2.4, 0.6, -0.35, 0.8],
    // Fuselage block
    [-0.7, 0.55, 1.6, 0.7, 0.55, 1.6, 0, 0.7, -0.6],
    [-0.7, 0.55, 1.6, 0, 0.7, -0.6, -0.6, -0.45, 1.4],
    [0.7, 0.55, 1.6, 0.6, -0.45, 1.4, 0, 0.7, -0.6],
    [-0.6, -0.45, 1.4, 0, 0.7, -0.6, 0.6, -0.45, 1.4],
    [-0.7, 0.55, 1.6, -0.6, -0.45, 1.4, 0.6, -0.45, 1.4],
    [-0.7, 0.55, 1.6, 0.6, -0.45, 1.4, 0.7, 0.55, 1.6],
  ]));
  bodyMesh(group, geometry, colors, 1);
  for (const x of [-0.45, 0.45]) {
    const engine = glowMesh(group, g('new OctahedronGeometry(0.3, 0)', () => new OctahedronGeometry(0.3, 0)), colors.glow);
    engine.position.set(x, 0.05, 1.7);
    engine.scale.set(1, 1, 1.5);
  }
  const eye = glowMesh(group, g('new OctahedronGeometry(0.34, 0)', () => new OctahedronGeometry(0.34, 0)), colors.eye, 'eye');
  eye.position.set(0, 0.35, -0.7);
  group.userData.eye = eye;
  group.userData.lockScale = 1.45;
  return group;
}

/** Torpedo bomber: a fat hull slung with two torpedoes. Slow, heavy, aimed at our cruiser. */
export function createBomberMesh(colors: CraftColors, torpedoColor: Color) {
  const group = new Group();
  const hull = bodyMesh(group, g('new OctahedronGeometry(1.2, 0)', () => new OctahedronGeometry(1.2, 0)), colors, 1);
  hull.scale.set(1.2, 0.7, 2.3);
  const wingGeometry = g('bomber-wing', () => triangles([
    [-3.2, 0, 1.4, 0, 0.1, -0.8, 0, 0.1, 1.2],
    [3.2, 0, 1.4, 0, 0.1, 1.2, 0, 0.1, -0.8],
    [-3.2, 0, 1.4, 0, 0.1, 1.2, 0, 0.1, -0.8],
    [3.2, 0, 1.4, 0, 0.1, -0.8, 0, 0.1, 1.2],
  ]));
  bodyMesh(group, wingGeometry, colors, 1);
  const torpedoes: Mesh[] = [];
  for (const x of [-1.5, 1.5]) {
    const torpedo = bodyMesh(group, g('new CylinderGeometry(0.3, 0.3, 2.6, 6)', () => new CylinderGeometry(0.3, 0.3, 2.6, 6)), colors, 30);
    torpedo.rotation.x = Math.PI / 2;
    torpedo.position.set(x, -0.55, 0.2);
    const tip = glowMesh(group, g('new OctahedronGeometry(0.28, 0)', () => new OctahedronGeometry(0.28, 0)), torpedoColor, 'eye');
    tip.position.set(x, -0.55, -1.2);
    torpedoes.push(torpedo);
  }
  for (const x of [-0.6, 0.6]) {
    const engine = glowMesh(group, g('new OctahedronGeometry(0.38, 0)', () => new OctahedronGeometry(0.38, 0)), colors.glow);
    engine.position.set(x, 0.1, 2.6);
    engine.scale.set(1, 1, 1.4);
  }
  group.userData.lockScale = 1.9;
  return group;
}

/** Belly turret: an inverted dome with a twin-barrel housing that tracks the camera. */
export function createTurretMesh(colors: CraftColors) {
  const group = new Group();
  const dome = bodyMesh(group, g('new SphereGeometry(2.1, 10, 5, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2)', () => new SphereGeometry(2.1, 10, 5, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2)), colors, 25);
  dome.position.y = 1.2;
  const head = new Group();
  const housingGroup = new Group();
  bodyMesh(housingGroup, g('new OctahedronGeometry(1.4, 0)', () => new OctahedronGeometry(1.4, 0)), colors, 1).scale.set(1.2, 0.8, 1.3);
  for (const x of [-0.55, 0.55]) {
    const barrel = bodyMesh(housingGroup, g('new CylinderGeometry(0.16, 0.2, 3.4, 5)', () => new CylinderGeometry(0.16, 0.2, 3.4, 5)), colors, 30);
    barrel.rotation.x = Math.PI / 2;
    barrel.position.set(x, 0, -2.2);
  }
  const eye = glowMesh(housingGroup, g('new OctahedronGeometry(0.36, 0)', () => new OctahedronGeometry(0.36, 0)), colors.eye, 'eye');
  eye.position.set(0, 0.35, -1.0);
  // Housing registered parts roll up to the root group.
  for (const part of (housingGroup.userData.parts as TintPart[])) ((group.userData.parts ??= []) as TintPart[]).push(part);
  head.add(housingGroup);
  head.position.y = -0.2;
  group.add(head);
  group.userData.head = head;
  group.userData.eye = eye;
  group.userData.lockScale = 1.9;
  return group;
}

/** Crimson plasma bolt: interceptable. */
export function createBoltMesh(core: Color, glow: Color) {
  const group = new Group();
  const coreMesh = glowMesh(group, g('new OctahedronGeometry(0.34, 0)', () => new OctahedronGeometry(0.34, 0)), core);
  coreMesh.scale.set(0.8, 0.8, 2.4);
  const sheath = glowMesh(group, g('new OctahedronGeometry(0.62, 0)', () => new OctahedronGeometry(0.62, 0)), glow);
  sheath.scale.set(0.9, 0.9, 1.8);
  const ring = glowMesh(group, g('new RingGeometry(0.62, 0.78, 12)', () => new RingGeometry(0.62, 0.78, 12)), glow);
  (ring.material as MeshBasicMaterial).side = DoubleSide;
  group.userData.spin = ring;
  group.userData.lockScale = 0.9;
  group.userData.isBolt = true;
  return group;
}

/** Shield generator: a domed emitter inside counter-rotating armor rings. */
export function createGeneratorMesh(colors: CraftColors) {
  const group = new Group();
  const base = bodyMesh(group, g('new CylinderGeometry(3.6, 4.4, 2.4, 10)', () => new CylinderGeometry(3.6, 4.4, 2.4, 10)), colors, 25);
  base.rotation.z = Math.PI / 2;
  base.position.x = -1.5;
  const rings: Object3D[] = [];
  for (const [radius, tilt] of [[5.2, 0.4], [6.4, -0.5]] as const) {
    const ring = new Group();
    const ringMesh = bodyMesh(ring, g('new TorusGeometry(radius, 0.42, 5, 22)', () => new TorusGeometry(radius, 0.42, 5, 22)), colors, 30);
    void ringMesh;
    for (const part of (ring.userData.parts as TintPart[])) ((group.userData.parts ??= []) as TintPart[]).push(part);
    ring.rotation.set(tilt, Math.PI / 2, 0);
    ring.position.x = 1.2;
    group.add(ring);
    rings.push(ring);
  }
  const dome = glowMesh(group, g('new SphereGeometry(2.2, 14, 8)', () => new SphereGeometry(2.2, 14, 8)), colors.eye, 'eye');
  dome.position.x = 1.4;
  const spike = glowMesh(group, g('new OctahedronGeometry(0.9, 0)', () => new OctahedronGeometry(0.9, 0)), colors.eye, 'eye');
  spike.position.x = 5;
  spike.scale.set(3.2, 0.6, 0.6);
  group.userData.rings = rings;
  group.userData.dome = dome;
  group.userData.lockScale = 3.4;
  return group;
}

/** Power core: a molten crystal column in a cage of emitters, rising out of the trench floor. */
export function createCoreMesh(colors: CraftColors) {
  const group = new Group();
  const crystal = glowMesh(group, g('new OctahedronGeometry(2.4, 0)', () => new OctahedronGeometry(2.4, 0)), colors.eye, 'eye');
  crystal.scale.set(0.9, 2.2, 0.9);
  const inner = glowMesh(group, g('new OctahedronGeometry(1.2, 0)', () => new OctahedronGeometry(1.2, 0)), colors.glow);
  inner.scale.set(1, 2.4, 1);
  const cage = new Group();
  for (let i = 0; i < 3; i += 1) {
    const ring = bodyMesh(cage, g('new TorusGeometry(3.4, 0.35, 5, 18)', () => new TorusGeometry(3.4, 0.35, 5, 18)), colors, 30);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = -3 + i * 3;
    ring.scale.setScalar(1 - Math.abs(i - 1) * 0.18);
  }
  for (const part of (cage.userData.parts as TintPart[])) ((group.userData.parts ??= []) as TintPart[]).push(part);
  group.add(cage);
  group.userData.cage = cage;
  group.userData.crystal = crystal;
  group.userData.lockScale = 3.0;
  return group;
}

// ---- player side ------------------------------------------------------------------------

/** Our fire: an ice-white needle in a cyan sheath. */
export function createShotMesh(core: Color, sheath: Color) {
  const group = new Group();
  const coreGeometry = new OctahedronGeometry(0.3, 0);
  coreGeometry.scale(0.5, 0.5, 3.2);
  group.add(new Mesh(coreGeometry, new MeshBasicMaterial({ color: core })));
  const sheathGeometry = new OctahedronGeometry(0.5, 0);
  sheathGeometry.scale(0.7, 0.7, 2.6);
  group.add(new Mesh(sheathGeometry, new MeshBasicMaterial(additiveMaterialParameters({ color: sheath, opacity: 0.6 }))));
  return group;
}

/**
 * The gunsight: a ring broken into six arcs that fill one per lock, four
 * range ticks, and a center pip. Parts are registered for the spine to tint.
 */
export function createGunsight(base: Color, dim: Color) {
  const group = new Group();
  const arcs: MeshBasicMaterial[] = [];
  for (let i = 0; i < 6; i += 1) {
    const start = Math.PI / 2 - (i + 1) * (Math.PI / 3) + 0.07;
    const material = new MeshBasicMaterial(additiveMaterialParameters({ color: dim, side: DoubleSide }));
    const arc = new Mesh(new RingGeometry(0.66, 0.74, 10, 1, start, Math.PI / 3 - 0.14), material);
    group.add(arc);
    arcs.push(material);
  }
  const tickMaterial = new MeshBasicMaterial(additiveMaterialParameters({ color: base, side: DoubleSide }));
  const ticks = new Group();
  for (let i = 0; i < 4; i += 1) {
    const angle = (i / 4) * Math.PI * 2;
    const tick = new Mesh(new CylinderGeometry(0.022, 0.022, 0.28, 4), tickMaterial);
    tick.position.set(Math.cos(angle) * 0.98, Math.sin(angle) * 0.98, 0);
    tick.rotation.z = angle + Math.PI / 2;
    ticks.add(tick);
  }
  group.add(ticks);
  const inner = new Mesh(new RingGeometry(0.2, 0.235, 24), new MeshBasicMaterial(additiveMaterialParameters({ color: base, side: DoubleSide })));
  group.add(inner);
  const pip = new Mesh(new SphereGeometry(0.05, 8, 6), new MeshBasicMaterial({ color: base }));
  group.add(pip);
  group.userData.arcs = arcs;
  group.userData.ticks = ticks;
  group.userData.tickMaterial = tickMaterial;
  group.userData.inner = inner;
  return group;
}

/** Lock bracket: four corner chevrons that snap around a locked target. */
export function createLockBracket(color: Color) {
  const group = new Group();
  const material = new MeshBasicMaterial(additiveMaterialParameters({ color, side: DoubleSide }));
  for (let i = 0; i < 4; i += 1) {
    const corner = new Group();
    const a = new Mesh(new CylinderGeometry(0.045, 0.045, 0.42, 4), material);
    a.rotation.z = Math.PI / 2;
    a.position.set(0.21, 0, 0);
    const b = new Mesh(new CylinderGeometry(0.045, 0.045, 0.42, 4), material);
    b.position.set(0, 0.21, 0);
    corner.add(a, b);
    corner.position.set(-1, -1, 0);
    const pivot = new Group();
    pivot.add(corner);
    pivot.rotation.z = (i * Math.PI) / 2;
    group.add(pivot);
  }
  group.userData.material = material;
  return group;
}

export function disposeMaterials(object: Object3D) {
  object.traverse((child) => {
    const mesh = child as Mesh;
    if (mesh.geometry) mesh.geometry.dispose();
    const material = mesh.material as Material | Material[] | undefined;
    if (Array.isArray(material)) material.forEach((m) => m.dispose());
    else material?.dispose();
  });
}

