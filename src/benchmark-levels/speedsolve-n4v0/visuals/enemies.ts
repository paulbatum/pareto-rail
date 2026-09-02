import {
  BoxGeometry,
  BufferGeometry,
  Color,
  CylinderGeometry,
  DoubleSide,
  EdgesGeometry,
  Group,
  IcosahedronGeometry,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  OctahedronGeometry,
  Path,
  PlaneGeometry,
  RingGeometry,
  Shape,
  ShapeGeometry,
  SphereGeometry,
  TetrahedronGeometry,
  TorusGeometry,
} from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { createAdditiveBasicMaterial } from '../../../engine/visual-kit';
import { CORE_RADIUS } from '../cube';
import { GRAPHITE, HOT_WHITE, MACHINE_DARK, MACHINE_GREY, MACHINE_WHITE, hdr, solveColor } from './palette';

// Leaf: target meshes. Every swarm polyhedron shares one contract so the
// spine can recolour, lock, flash, and shatter them the same way:
//   userData.fillMaterial  — the coloured body (MeshStandardMaterial)
//   userData.edgeMaterial  — graphite wire edges
//   userData.coreMaterial  — a small hot-white core
//   userData.accent        — the current solve colour

type SwarmParts = { fillMaterial: MeshStandardMaterial; edgeMaterial: LineBasicMaterial; coreMaterial: MeshBasicMaterial };

function swarmParts(group: Group, body: Mesh, edges: LineSegments, core: Mesh): SwarmParts {
  const parts = {
    fillMaterial: body.material as MeshStandardMaterial,
    edgeMaterial: edges.material as LineBasicMaterial,
    coreMaterial: core.material as MeshBasicMaterial,
  };
  group.add(body, edges, core);
  group.userData.fillMaterial = parts.fillMaterial;
  group.userData.edgeMaterial = parts.edgeMaterial;
  group.userData.coreMaterial = parts.coreMaterial;
  group.userData.accent = new Color(1, 1, 1);
  group.userData.isSwarm = true;
  return parts;
}

// Geometry is shared per part so the swarm never grows the renderer's
// geometry count; only materials are per-enemy (they carry colour state).
const geometryCache = new Map<string, BufferGeometry>();
function shared<T extends BufferGeometry>(key: string, make: () => T): T {
  let geometry = geometryCache.get(key) as T | undefined;
  if (!geometry) {
    geometry = make();
    geometryCache.set(key, geometry);
  }
  return geometry;
}

function bodyMaterial() {
  return new MeshStandardMaterial({ color: 0xffffff, roughness: 0.42, metalness: 0.05, emissive: new Color(0, 0, 0) });
}

function edgeMaterial() {
  return new LineBasicMaterial({ color: GRAPHITE.clone() });
}

function coreMesh(radius: number) {
  return new Mesh(shared(`core-${radius}`, () => new OctahedronGeometry(radius, 1)), new MeshBasicMaterial({ color: hdr(HOT_WHITE, 1.8) }));
}

/** Recolour a swarm polyhedron to a solve colour (called once its data is known). */
export function applySwarmColor(group: Group, colorIndex: number) {
  const color = solveColor(colorIndex);
  const fill = group.userData.fillMaterial as MeshStandardMaterial | undefined;
  if (!fill) return;
  fill.color.copy(color);
  fill.emissive.copy(color).multiplyScalar(0.08);
  (group.userData.accent as Color).copy(color);
  group.userData.colorIndex = colorIndex;
}

// A dart: a stretched tetrahedron with a hot nose.
export function createTetraMesh() {
  const group = new Group();
  const geometry = shared('tetra', () => new TetrahedronGeometry(1.15, 0));
  const body = new Mesh(geometry, bodyMaterial());
  body.scale.set(0.9, 0.9, 1.55);
  const edges = new LineSegments(shared('tetra-edges', () => new EdgesGeometry(geometry)), edgeMaterial());
  edges.scale.copy(body.scale);
  const core = coreMesh(0.24);
  core.position.z = 0.9;
  swarmParts(group, body, edges, core);
  group.userData.lockRingScale = 0.9;
  group.userData.debrisSize = 0.34;
  return group;
}

// An orbiter: an octahedron wearing a thin white belt.
export function createOctaMesh() {
  const group = new Group();
  const geometry = shared('octa', () => new OctahedronGeometry(1.25, 0));
  const body = new Mesh(geometry, bodyMaterial());
  const edges = new LineSegments(shared('octa-edges', () => new EdgesGeometry(geometry)), edgeMaterial());
  const core = coreMesh(0.26);
  swarmParts(group, body, edges, core);
  const belt = new Mesh(shared('octa-belt', () => new TorusGeometry(1.45, 0.06, 6, 32)), new MeshStandardMaterial({ color: MACHINE_WHITE.clone(), roughness: 0.4 }));
  belt.rotation.x = Math.PI / 2;
  group.add(belt);
  group.userData.belt = belt;
  group.userData.lockRingScale = 1.05;
  group.userData.debrisSize = 0.38;
  return group;
}

// A gunner: a triangular prism with a white barrel that lunges before it fires.
export function createPrismMesh() {
  const group = new Group();
  const geometry = shared('prism', () => new CylinderGeometry(1.15, 1.15, 2.1, 3, 1));
  const body = new Mesh(geometry, bodyMaterial());
  body.rotation.x = Math.PI / 2;
  const edges = new LineSegments(shared('prism-edges', () => new EdgesGeometry(geometry, 10)), edgeMaterial());
  edges.rotation.x = Math.PI / 2;
  const core = coreMesh(0.22);
  core.position.z = 1.3;
  swarmParts(group, body, edges, core);
  const barrel = new Mesh(shared('prism-barrel', () => new CylinderGeometry(0.22, 0.3, 1.2, 8)), new MeshStandardMaterial({ color: MACHINE_WHITE.clone(), roughness: 0.35, metalness: 0.3 }));
  barrel.rotation.x = Math.PI / 2;
  barrel.position.z = 1.5;
  group.add(barrel);
  const muzzle = new Mesh(shared('prism-muzzle', () => new RingGeometry(0.34, 0.5, 4)), createAdditiveBasicMaterial({ color: hdr(HOT_WHITE, 0.6), side: DoubleSide }));
  muzzle.position.z = 2.15;
  group.add(muzzle);
  group.userData.muzzleMaterial = muzzle.material;
  group.userData.lockRingScale = 1.15;
  group.userData.debrisSize = 0.42;
  return group;
}

// Enemy fire: a small loose cubie in the cube's own colour with a hot core and
// a square halo so it reads as a lockable shot, not debris.
export function createBoltMesh() {
  const group = new Group();
  const geometry = shared('bolt', () => new RoundedBoxGeometry(0.5, 0.5, 0.5, 2, 0.08));
  const body = new Mesh(geometry, bodyMaterial());
  const edges = new LineSegments(shared('bolt-edges', () => new EdgesGeometry(new BoxGeometry(0.52, 0.52, 0.52))), edgeMaterial());
  const core = coreMesh(0.16);
  swarmParts(group, body, edges, core);
  const halo = new Mesh(shared('bolt-halo', () => new RingGeometry(0.7, 0.8, 4)), createAdditiveBasicMaterial({ color: hdr(HOT_WHITE, 0.9), side: DoubleSide }));
  halo.rotation.z = Math.PI / 4;
  group.add(halo);
  group.userData.halo = halo;
  group.userData.isBolt = true;
  group.userData.lockRingScale = 0.75;
  group.userData.debrisSize = 0.22;
  return group;
}

function roundedRectPath(path: Path, x: number, y: number, w: number, h: number, r: number) {
  path.moveTo(x + r, y);
  path.lineTo(x + w - r, y);
  path.quadraticCurveTo(x + w, y, x + w, y + r);
  path.lineTo(x + w, y + h - r);
  path.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  path.lineTo(x + r, y + h);
  path.quadraticCurveTo(x, y + h, x, y + h - r);
  path.lineTo(x, y + r);
  path.quadraticCurveTo(x, y, x + r, y);
}

// A sticker target: a hot white frame hovering over the wrong sticker, with
// corner brackets. The sticker plate itself glows through the cube visual.
export function createStickerFrameMesh() {
  const group = new Group();
  const shape = new Shape();
  roundedRectPath(shape, -2.5, -2.5, 5, 5, 0.6);
  const hole = new Path();
  roundedRectPath(hole, -2.12, -2.12, 4.24, 4.24, 0.45);
  shape.holes.push(hole);
  const frameMaterial = createAdditiveBasicMaterial({ color: hdr(HOT_WHITE, 0.9), side: DoubleSide });
  const frame = new Mesh(shared('sticker-frame', () => new ShapeGeometry(shape, 6)), frameMaterial);
  group.add(frame);

  const brackets = new Group();
  const bracketMaterial = createAdditiveBasicMaterial({ color: hdr(HOT_WHITE, 1.3), side: DoubleSide });
  const arm = shared('sticker-arm', () => new PlaneGeometry(0.9, 0.14));
  for (let i = 0; i < 4; i += 1) {
    const corner = new Group();
    const horizontal = new Mesh(arm, bracketMaterial);
    horizontal.position.set(-0.45, 0, 0);
    const vertical = new Mesh(arm, bracketMaterial);
    vertical.rotation.z = Math.PI / 2;
    vertical.position.set(0, -0.45, 0);
    corner.add(horizontal, vertical);
    const sx = i % 2 === 0 ? 1 : -1;
    const sy = i < 2 ? 1 : -1;
    corner.position.set(sx * 3.05, sy * 3.05, 0);
    corner.scale.set(sx, sy, 1);
    brackets.add(corner);
  }
  group.add(brackets);

  const diamond = new Mesh(shared('sticker-diamond', () => new RingGeometry(1.15, 1.3, 4)), createAdditiveBasicMaterial({ color: hdr(HOT_WHITE, 1.4), side: DoubleSide }));
  diamond.visible = false;
  group.add(diamond);

  group.userData.isSticker = true;
  group.userData.frameMaterial = frameMaterial;
  group.userData.bracketMaterial = bracketMaterial;
  group.userData.brackets = brackets;
  group.userData.diamond = diamond;
  group.userData.accent = HOT_WHITE.clone();
  group.userData.lockRingScale = 1.7;
  return group;
}

// The hub: the axle end exposed when a face falls away. A white gear ring with
// teeth around a hot spindle; three hits to shear it off.
export function createHubMesh() {
  const group = new Group();
  const ringMaterial = new MeshStandardMaterial({ color: MACHINE_WHITE.clone(), roughness: 0.35, metalness: 0.35 });
  const ring = new Mesh(new TorusGeometry(1.35, 0.26, 10, 32), ringMaterial);
  group.add(ring);
  const gear = new Group();
  const toothGeometry = new BoxGeometry(0.42, 0.34, 0.5);
  for (let i = 0; i < 10; i += 1) {
    const tooth = new Mesh(toothGeometry, ringMaterial);
    const angle = (i / 10) * Math.PI * 2;
    tooth.position.set(Math.cos(angle) * 1.72, Math.sin(angle) * 1.72, 0);
    tooth.rotation.z = angle;
    gear.add(tooth);
  }
  group.add(gear);
  const disc = new Mesh(new CylinderGeometry(1.1, 1.1, 0.5, 24), new MeshStandardMaterial({ color: MACHINE_GREY.clone(), roughness: 0.6 }));
  disc.rotation.x = Math.PI / 2;
  disc.position.z = -0.3;
  group.add(disc);
  const spindleMaterial = new MeshBasicMaterial({ color: hdr(HOT_WHITE, 1.6) });
  const spindle = new Mesh(new SphereGeometry(0.5, 16, 12), spindleMaterial);
  spindle.position.z = 0.35;
  group.add(spindle);
  const spokeMaterial = new MeshStandardMaterial({ color: MACHINE_DARK.clone(), roughness: 0.5 });
  const spokeGeometry = new BoxGeometry(2.4, 0.16, 0.16);
  for (let i = 0; i < 3; i += 1) {
    const spoke = new Mesh(spokeGeometry, spokeMaterial);
    spoke.rotation.z = (i / 3) * Math.PI;
    spoke.position.z = 0.1;
    group.add(spoke);
  }
  group.userData.isHub = true;
  group.userData.gear = gear;
  group.userData.ringMaterial = ringMaterial;
  group.userData.spindleMaterial = spindleMaterial;
  group.userData.accent = MACHINE_WHITE.clone();
  group.userData.lockRingScale = 1.35;
  return group;
}

// The core: a white-hot heart inside a wire cage, wrapped in whatever armour
// plates the unsolved faces left behind. Stage breaks strip it layer by layer.
export function createCoreMesh(unsolvedFaces: readonly number[]) {
  const group = new Group();
  const heartMaterial = new MeshStandardMaterial({
    color: MACHINE_WHITE.clone(),
    emissive: HOT_WHITE.clone().multiplyScalar(0.55),
    roughness: 0.3,
    metalness: 0.1,
  });
  const heart = new Mesh(new IcosahedronGeometry(CORE_RADIUS, 3), heartMaterial);
  heart.name = 'core-heart';
  group.add(heart);
  const veins = new LineSegments(new EdgesGeometry(new IcosahedronGeometry(CORE_RADIUS * 1.02, 1)), new LineBasicMaterial({ color: MACHINE_GREY.clone() }));
  group.add(veins);

  const cage = new Group();
  const cageMaterial = new LineBasicMaterial({ color: hdr(MACHINE_WHITE, 1.2) });
  cage.add(new LineSegments(new EdgesGeometry(new IcosahedronGeometry(4.7, 1)), cageMaterial));
  cage.add(new LineSegments(new EdgesGeometry(new IcosahedronGeometry(5.3, 0)), new LineBasicMaterial({ color: MACHINE_GREY.clone() })));
  const cageShell = new Mesh(new IcosahedronGeometry(4.7, 1), createAdditiveBasicMaterial({ color: MACHINE_WHITE.clone().multiplyScalar(0.12), opacity: 0.35 }));
  cageShell.name = 'cage-shell';
  cage.add(cageShell);
  group.add(cage);

  // Armour: each unsolved face's nine stickers clamp around the cage.
  const armor = new Group();
  const plateGeometry = new RoundedBoxGeometry(1.5, 1.5, 0.22, 2, 0.16);
  for (const face of unsolvedFaces) {
    const plates = new Group();
    const material = new MeshStandardMaterial({ color: solveColor(face).clone(), roughness: 0.4, emissive: solveColor(face).clone().multiplyScalar(0.1) });
    for (let u = -1; u <= 1; u += 1) {
      for (let v = -1; v <= 1; v += 1) {
        const plate = new Mesh(plateGeometry, material);
        plate.position.set(u * 1.7, v * 1.7, 5.7);
        plates.add(plate);
      }
    }
    plates.userData.face = face;
    plates.userData.material = material;
    orientGroupToFace(plates, face);
    armor.add(plates);
  }
  group.add(armor);

  group.userData.isCore = true;
  group.userData.heartMaterial = heartMaterial;
  group.userData.cage = cage;
  group.userData.cageMaterial = cageMaterial;
  group.userData.armor = armor;
  group.userData.veins = veins;
  group.userData.accent = HOT_WHITE.clone();
  group.userData.lockRingScale = 2.4;
  return group;
}

function orientGroupToFace(group: Group, face: number) {
  const axis = Math.floor(face / 2);
  const sign = face % 2 === 0 ? 1 : -1;
  if (axis === 0) group.rotation.y = sign === 1 ? Math.PI / 2 : -Math.PI / 2;
  else if (axis === 1) group.rotation.x = sign === 1 ? -Math.PI / 2 : Math.PI / 2;
  else if (sign === -1) group.rotation.y = Math.PI;
}

export function createProjectileGroup() {
  const group = new Group();
  const core = new Mesh(new BoxGeometry(0.2, 0.2, 1.7), new MeshBasicMaterial({ color: hdr(HOT_WHITE, 2.6) }));
  const shell = new Mesh(new BoxGeometry(0.42, 0.42, 1.5), createAdditiveBasicMaterial({ color: hdr(MACHINE_WHITE, 0.7), opacity: 0.45 }));
  group.add(core, shell);
  return group;
}

// The reticle is a sticker outline: a square frame, spinning corner brackets,
// and a dot. Locks tighten it and push it hot.
export function createReticleGroup() {
  const group = new Group();
  const parts: Array<{ material: MeshBasicMaterial; base: Color; active: Color }> = [];
  const add = (mesh: Mesh, base: Color, active: Color) => {
    const material = mesh.material as MeshBasicMaterial;
    material.transparent = true;
    material.depthWrite = false;
    material.side = DoubleSide;
    material.color.copy(base);
    parts.push({ material, base, active });
  };
  const frame = new Mesh(new RingGeometry(0.62, 0.68, 4), createAdditiveBasicMaterial({ color: 0xffffff }));
  frame.rotation.z = Math.PI / 4;
  add(frame, GRAPHITE.clone().lerp(MACHINE_WHITE, 0.55), hdr(HOT_WHITE, 1.6));
  const spinner = new Group();
  const diamond = new Mesh(new RingGeometry(0.34, 0.38, 4), createAdditiveBasicMaterial({ color: 0xffffff }));
  add(diamond, GRAPHITE.clone().lerp(MACHINE_WHITE, 0.4), hdr(HOT_WHITE, 1.2));
  spinner.add(diamond);
  const brackets = new Group();
  for (let i = 0; i < 4; i += 1) {
    const tick = new Mesh(new PlaneGeometry(0.22, 0.04), createAdditiveBasicMaterial({ color: 0xffffff }));
    add(tick, GRAPHITE.clone().lerp(MACHINE_WHITE, 0.7), hdr(HOT_WHITE, 2));
    const angle = (i / 4) * Math.PI * 2 + Math.PI / 4;
    tick.position.set(Math.cos(angle) * 0.86, Math.sin(angle) * 0.86, 0);
    tick.rotation.z = angle;
    brackets.add(tick);
  }
  const dot = new Mesh(new RingGeometry(0, 0.05, 12), createAdditiveBasicMaterial({ color: 0xffffff }));
  add(dot, GRAPHITE.clone(), hdr(HOT_WHITE, 3));
  group.add(frame, spinner, brackets, dot);
  group.userData.parts = parts;
  group.userData.spinner = spinner;
  group.userData.brackets = brackets;
  group.userData.active = false;
  return group;
}
