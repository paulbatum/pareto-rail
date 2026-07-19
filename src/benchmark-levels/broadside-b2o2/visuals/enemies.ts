import {
  BoxGeometry,
  Color,
  CylinderGeometry,
  EdgesGeometry,
  Group,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  OctahedronGeometry,
  RingGeometry,
  SphereGeometry,
  TetrahedronGeometry,
  TorusGeometry,
  Vector3,
} from 'three';
import { additiveMaterialParameters, createAdditiveBasicMaterial } from '../../../engine/visual-kit';
import { CRIMSON, hdr, MOLTEN, OBSIDIAN, WHITE_HOT } from './palette';
import type { SparkSpec } from './effects';

// The enemy swarm is forged from one material story: near-black obsidian mass,
// molten orange seams, crimson fire. Silhouette and motion carry identity —
// darts are arrowheads, weavers are tri-fin spindles, rakers are gunboat
// slabs, turrets are hull-mounted domes, and the flagship's organs (shield
// generators, power cores) are architecture.

export type TintKind = 'edge' | 'fill' | 'core';
export type TintPart = { material: MeshBasicMaterial | LineBasicMaterial; base: Color; kind: TintKind };

function tintable(group: Group): TintPart[] {
  return (group.userData.parts ??= []) as TintPart[];
}

function addFacetMesh(
  group: Group,
  geometry: OctahedronGeometry | TetrahedronGeometry | BoxGeometry | CylinderGeometry | SphereGeometry,
  fillColor: Color,
  edgeColor: Color,
  edgeIntensity: number,
) {
  const fillMaterial = new MeshBasicMaterial({ color: fillColor.clone() });
  const fill = new Mesh(geometry, fillMaterial);
  const edgeMaterial = new LineBasicMaterial(additiveMaterialParameters({ color: hdr(edgeColor, edgeIntensity) }));
  const edges = new LineSegments(new EdgesGeometry(geometry), edgeMaterial);
  fill.add(edges);
  group.add(fill);
  tintable(group).push(
    { material: fillMaterial, base: fillColor.clone(), kind: 'fill' },
    { material: edgeMaterial, base: hdr(edgeColor, edgeIntensity), kind: 'edge' },
  );
  return fill;
}

function addCore(group: Group, radius: number, color: Color, intensity: number, glowScale = 1.55, glowOpacity = 0.26) {
  const coreMaterial = new MeshBasicMaterial({ color: hdr(color, intensity) });
  const core = new Mesh(new OctahedronGeometry(radius, 1), coreMaterial);
  const glowMaterial = createAdditiveBasicMaterial({ color: hdr(color, intensity * 0.4), opacity: glowOpacity });
  const glow = new Mesh(new OctahedronGeometry(radius * glowScale, 1), glowMaterial);
  core.add(glow);
  group.add(core);
  tintable(group).push(
    { material: coreMaterial, base: hdr(color, intensity), kind: 'core' },
    { material: glowMaterial, base: hdr(color, intensity * 0.4), kind: 'core' },
  );
  return core;
}

// ---- dart: an obsidian arrowhead with a crimson drive flare --------------------

export function createDartMesh() {
  const group = new Group();
  const body = new OctahedronGeometry(0.55, 0);
  body.scale(0.72, 0.5, 2.6);
  addFacetMesh(group, body, OBSIDIAN.clone().multiplyScalar(0.9), MOLTEN, 1.1);

  // Swept fins at the waist.
  for (const side of [-1, 1]) {
    const fin = new TetrahedronGeometry(0.42, 0);
    fin.scale(1.35, 0.2, 0.9);
    const mesh = addFacetMesh(group, fin, OBSIDIAN.clone().multiplyScalar(0.7), MOLTEN, 0.9);
    mesh.position.set(side * 0.52, 0, -0.28);
    mesh.rotation.set(0, side * 0.5, side * -0.35);
  }

  // Drive flare: the crimson engine cone.
  const engineMaterial = createAdditiveBasicMaterial({ color: hdr(CRIMSON, 1.6), opacity: 0.85 });
  const engine = new Mesh(new CylinderGeometry(0.02, 0.3, 1.1, 7, 1, true), engineMaterial);
  engine.rotation.x = -Math.PI / 2;
  engine.position.z = -1.6;
  group.add(engine);
  tintable(group).push({ material: engineMaterial, base: hdr(CRIMSON, 1.6), kind: 'core' });

  addCore(group, 0.14, CRIMSON, 2.0, 1.5, 0.3);

  group.userData.accent = CRIMSON.clone();
  group.userData.shardSpecs = [
    { direction: new Vector3(0, 0, 1), color: MOLTEN.clone(), size: 0.55 },
    { direction: new Vector3(0.7, 0.2, -0.6).normalize(), color: MOLTEN.clone(), size: 0.45 },
    { direction: new Vector3(-0.7, -0.2, -0.6).normalize(), color: CRIMSON.clone(), size: 0.4 },
  ] satisfies SparkSpec[];
  group.userData.lockRingScale = 0.85;
  return group;
}

// ---- weaver: a tri-fin spindle around a burning ring ---------------------------

export function createWeaverMesh() {
  const group = new Group();
  const body = new OctahedronGeometry(0.6, 0);
  body.scale(0.6, 0.6, 1.9);
  addFacetMesh(group, body, OBSIDIAN.clone().multiplyScalar(0.85), MOLTEN, 1.0);

  // Three fins at 120° — the helicopter silhouette.
  for (let i = 0; i < 3; i += 1) {
    const angle = (i / 3) * Math.PI * 2;
    const fin = new TetrahedronGeometry(0.5, 0);
    fin.scale(0.24, 1.3, 0.75);
    const mesh = addFacetMesh(group, fin, OBSIDIAN.clone().multiplyScalar(0.7), MOLTEN, 0.9);
    mesh.position.set(Math.cos(angle) * 0.85, Math.sin(angle) * 0.85, -0.15);
    mesh.rotation.z = angle - Math.PI / 2;
  }

  // The burning ring: a molten torus around the waist.
  const ringMaterial = createAdditiveBasicMaterial({ color: hdr(MOLTEN, 1.35), opacity: 0.9 });
  const ring = new Mesh(new TorusGeometry(0.95, 0.05, 6, 28), ringMaterial);
  group.add(ring);
  tintable(group).push({ material: ringMaterial, base: hdr(MOLTEN, 1.35), kind: 'edge' });

  addCore(group, 0.18, CRIMSON, 2.1, 1.5, 0.3);

  group.userData.accent = MOLTEN.clone();
  group.userData.shardSpecs = [
    { direction: new Vector3(1, 0, 0), color: MOLTEN.clone(), size: 0.5 },
    { direction: new Vector3(-0.5, 0.85, 0).normalize(), color: MOLTEN.clone(), size: 0.5 },
    { direction: new Vector3(-0.5, -0.85, 0).normalize(), color: CRIMSON.clone(), size: 0.45 },
    { direction: new Vector3(0, 0, -1), color: CRIMSON.clone(), size: 0.4 },
  ] satisfies SparkSpec[];
  group.userData.lockRingScale = 1.0;
  return group;
}

// ---- raker: a gunboat slab with twin prongs ------------------------------------

export function createRakerMesh() {
  const group = new Group();
  const hull = new BoxGeometry(2.4, 0.55, 3.2);
  addFacetMesh(group, hull, OBSIDIAN.clone().multiplyScalar(0.9), MOLTEN, 1.0);

  // Forward prongs — the gunboat's catamaran bow.
  for (const side of [-1, 1]) {
    const prong = new BoxGeometry(0.5, 0.4, 1.9);
    const mesh = addFacetMesh(group, prong, OBSIDIAN.clone().multiplyScalar(0.75), MOLTEN, 0.95);
    mesh.position.set(side * 0.85, 0.05, 2.1);
    // Muzzle glow at each prong tip.
    const muzzleMaterial = createAdditiveBasicMaterial({ color: hdr(CRIMSON, 1.7), opacity: 0.85 });
    const muzzle = new Mesh(new SphereGeometry(0.18, 8, 6), muzzleMaterial);
    muzzle.position.set(side * 0.85, 0.05, 3.1);
    group.add(muzzle);
    tintable(group).push({ material: muzzleMaterial, base: hdr(CRIMSON, 1.7), kind: 'core' });
  }

  // Bridge hump with a molten viewport strip.
  const bridge = addFacetMesh(group, new BoxGeometry(1.1, 0.5, 1.1), OBSIDIAN.clone().multiplyScalar(1.15), MOLTEN, 0.8);
  bridge.position.set(0, 0.5, -0.7);
  const viewportMaterial = createAdditiveBasicMaterial({ color: hdr(MOLTEN, 1.5), opacity: 0.9 });
  const viewport = new Mesh(new BoxGeometry(0.9, 0.1, 0.12), viewportMaterial);
  viewport.position.set(0, 0.52, -0.12);
  group.add(viewport);
  tintable(group).push({ material: viewportMaterial, base: hdr(MOLTEN, 1.5), kind: 'edge' });

  addCore(group, 0.2, CRIMSON, 1.9, 1.5, 0.28);

  group.userData.accent = MOLTEN.clone();
  group.userData.shardSpecs = [
    { direction: new Vector3(1, 0.3, 0.4).normalize(), color: MOLTEN.clone(), size: 0.7 },
    { direction: new Vector3(-1, 0.3, 0.4).normalize(), color: MOLTEN.clone(), size: 0.7 },
    { direction: new Vector3(0, 1, -0.4).normalize(), color: CRIMSON.clone(), size: 0.55 },
    { direction: new Vector3(0, -1, -0.6).normalize(), color: MOLTEN.clone(), size: 0.5 },
  ] satisfies SparkSpec[];
  group.userData.lockRingScale = 1.5;
  return group;
}

// ---- turret: a hull-mounted dome with twin barrels ------------------------------

export function createTurretMesh() {
  const group = new Group();

  // Base plate flush with the hull.
  const plate = addFacetMesh(group, new CylinderGeometry(1.5, 1.7, 0.35, 8), OBSIDIAN.clone().multiplyScalar(1.1), MOLTEN, 0.85);
  plate.position.y = -0.5;

  // The dome.
  const domeGeometry = new SphereGeometry(1.05, 10, 6, 0, Math.PI * 2, 0, Math.PI * 0.55);
  const dome = addFacetMesh(group, domeGeometry, OBSIDIAN.clone().multiplyScalar(0.85), MOLTEN, 1.0);
  dome.position.y = -0.3;

  // Twin barrels pointing "up" out of the dome (toward open space).
  const muzzleMaterials: MeshBasicMaterial[] = [];
  for (const side of [-1, 1]) {
    const barrel = addFacetMesh(group, new CylinderGeometry(0.13, 0.17, 1.7, 6), OBSIDIAN.clone().multiplyScalar(1.2), MOLTEN, 0.9);
    barrel.position.set(side * 0.34, 0.85, 0);
    const muzzleMaterial = createAdditiveBasicMaterial({ color: hdr(CRIMSON, 1.2), opacity: 0.9 });
    const muzzle = new Mesh(new SphereGeometry(0.17, 8, 6), muzzleMaterial);
    muzzle.position.set(side * 0.34, 1.75, 0);
    group.add(muzzle);
    muzzleMaterials.push(muzzleMaterial);
    tintable(group).push({ material: muzzleMaterial, base: hdr(CRIMSON, 1.2), kind: 'core' });
  }
  group.userData.muzzleMaterials = muzzleMaterials;

  addCore(group, 0.16, CRIMSON, 1.8, 1.5, 0.26);

  group.userData.accent = CRIMSON.clone();
  group.userData.shardSpecs = [
    { direction: new Vector3(0.6, 0.8, 0).normalize(), color: MOLTEN.clone(), size: 0.6 },
    { direction: new Vector3(-0.6, 0.8, 0).normalize(), color: MOLTEN.clone(), size: 0.6 },
    { direction: new Vector3(0, -1, 0.4).normalize(), color: CRIMSON.clone(), size: 0.5 },
  ] satisfies SparkSpec[];
  group.userData.lockRingScale = 1.25;
  return group;
}

// ---- bolt: a crimson lance (hostile shot) ---------------------------------------

export function createBoltMesh() {
  const group = new Group();
  const dart = new OctahedronGeometry(0.34, 0);
  dart.scale(0.5, 0.5, 2.6);
  const coreMaterial = new MeshBasicMaterial({ color: hdr(CRIMSON, 2.6) });
  const core = new Mesh(dart, coreMaterial);
  const shellGeometry = new OctahedronGeometry(0.52, 0);
  shellGeometry.scale(0.58, 0.58, 2.2);
  const shellMaterial = createAdditiveBasicMaterial({ color: hdr(CRIMSON, 1.1), opacity: 0.5 });
  const shell = new Mesh(shellGeometry, shellMaterial);
  group.add(core, shell);
  tintable(group).push(
    { material: coreMaterial, base: hdr(CRIMSON, 2.6), kind: 'core' },
    { material: shellMaterial, base: hdr(CRIMSON, 1.1), kind: 'core' },
  );
  group.userData.accent = CRIMSON.clone();
  group.userData.isHostileShot = true;
  group.userData.trailColor = CRIMSON.clone().multiplyScalar(0.85);
  group.userData.shardSpecs = [
    { direction: new Vector3(0, 0, 1), color: CRIMSON.clone(), size: 0.4 },
    { direction: new Vector3(0, 0, -1), color: CRIMSON.clone(), size: 0.4 },
  ] satisfies SparkSpec[];
  group.userData.lockRingScale = 0.7;
  return group;
}

// ---- shield generator: hull plate, emitter vanes, and the dish that breaks ------

export function createGenMesh() {
  const group = new Group();

  // Armored pedestal.
  const pedestal = addFacetMesh(group, new CylinderGeometry(1.1, 1.5, 1.1, 6), OBSIDIAN.clone().multiplyScalar(1.05), MOLTEN, 0.9);
  pedestal.position.y = -0.9;

  // The shield dish: a glowing concave emitter, sheared off at the stage break.
  const dish = new Group();
  const dishMaterial = createAdditiveBasicMaterial({ color: hdr(MOLTEN, 1.15), opacity: 0.75, side: 2 });
  const dishMesh = new Mesh(new SphereGeometry(1.5, 12, 6, 0, Math.PI * 2, 0, Math.PI * 0.4), dishMaterial);
  dishMesh.rotation.x = Math.PI; // concave side out
  dishMesh.position.y = 0.6;
  dish.add(dishMesh);
  tintable(group).push({ material: dishMaterial, base: hdr(MOLTEN, 1.15), kind: 'edge' });

  // Rotating emitter vanes.
  const spinParts: Mesh[] = [];
  const vaneMaterial = createAdditiveBasicMaterial({ color: hdr(MOLTEN, 1.5), opacity: 0.9 });
  for (let i = 0; i < 3; i += 1) {
    const vane = new Mesh(new BoxGeometry(0.16, 0.05, 2.2), vaneMaterial);
    vane.rotation.y = (i / 3) * Math.PI * 2;
    vane.position.y = 0.75;
    dish.add(vane);
    spinParts.push(vane);
  }
  tintable(group).push({ material: vaneMaterial, base: hdr(MOLTEN, 1.5), kind: 'edge' });
  group.add(dish);
  group.userData.dish = dish;
  group.userData.spinParts = spinParts;

  addCore(group, 0.26, WHITE_HOT, 1.8, 1.6, 0.3);

  group.userData.accent = MOLTEN.clone();
  group.userData.shardSpecs = [
    { direction: new Vector3(0.7, 0.7, 0).normalize(), color: MOLTEN.clone(), size: 0.7 },
    { direction: new Vector3(-0.7, 0.7, 0).normalize(), color: MOLTEN.clone(), size: 0.7 },
    { direction: new Vector3(0, 1, 0.3).normalize(), color: WHITE_HOT.clone(), size: 0.55 },
    { direction: new Vector3(0, -1, -0.5).normalize(), color: CRIMSON.clone(), size: 0.5 },
  ] satisfies SparkSpec[];
  group.userData.lockRingScale = 1.5;
  return group;
}

// The stage break: the dish shears off, the naked emitter burns twice as hot.
export function breakGenDish(group: Group) {
  const dish = group.userData.dish as Group | undefined;
  if (!dish || dish.visible === false) return;
  dish.visible = false;
  for (const part of group.userData.parts as TintPart[]) {
    if (part.kind === 'core') part.base.multiplyScalar(1.9);
  }
}

// ---- power core: a vented reactor drum in the trench -----------------------------

export function createCoreMesh() {
  const group = new Group();

  // The reactor heart, visible through the cage.
  const heartMaterial = new MeshBasicMaterial({ color: hdr(WHITE_HOT, 2.1) });
  const heart = new Mesh(new OctahedronGeometry(0.72, 1), heartMaterial);
  const heartGlowMaterial = createAdditiveBasicMaterial({ color: hdr(MOLTEN, 0.9), opacity: 0.4 });
  const heartGlow = new Mesh(new OctahedronGeometry(1.15, 1), heartGlowMaterial);
  heart.add(heartGlow);
  group.add(heart);
  group.userData.heart = heart;
  tintable(group).push(
    { material: heartMaterial, base: hdr(WHITE_HOT, 2.1), kind: 'core' },
    { material: heartGlowMaterial, base: hdr(MOLTEN, 0.9), kind: 'core' },
  );

  // Armored cage: six hex bars around the drum.
  for (let i = 0; i < 6; i += 1) {
    const angle = (i / 6) * Math.PI * 2;
    const bar = addFacetMesh(group, new BoxGeometry(0.34, 2.6, 0.34), OBSIDIAN.clone().multiplyScalar(0.95), MOLTEN, 1.0);
    bar.position.set(Math.cos(angle) * 1.15, 0, Math.sin(angle) * 1.15);
  }
  // Cap rings top and bottom.
  for (const y of [1.45, -1.45]) {
    const ringMaterial = createAdditiveBasicMaterial({ color: hdr(MOLTEN, 1.2), opacity: 0.85 });
    const ring = new Mesh(new RingGeometry(0.85, 1.3, 6), ringMaterial);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = y;
    group.add(ring);
    tintable(group).push({ material: ringMaterial, base: hdr(MOLTEN, 1.2), kind: 'edge' });
  }

  group.userData.accent = WHITE_HOT.clone();
  group.userData.shardSpecs = [
    { direction: new Vector3(1, 0.4, 0).normalize(), color: MOLTEN.clone(), size: 0.7 },
    { direction: new Vector3(-1, 0.4, 0).normalize(), color: MOLTEN.clone(), size: 0.7 },
    { direction: new Vector3(0, 1, 0.4).normalize(), color: WHITE_HOT.clone(), size: 0.65 },
    { direction: new Vector3(0, -1, -0.4).normalize(), color: WHITE_HOT.clone(), size: 0.55 },
    { direction: new Vector3(0.5, 0, -0.85).normalize(), color: CRIMSON.clone(), size: 0.5 },
  ] satisfies SparkSpec[];
  group.userData.lockRingScale = 1.6;
  return group;
}
