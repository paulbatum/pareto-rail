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
  Vector3,
} from 'three';
import { additiveMaterialParameters, createAdditiveBasicMaterial } from '../../../engine/visual-kit';
import { CRIMSON, CYAN, hdr, ICE, MOLTEN, NEBULA_GOLD, OBSIDIAN } from './palette';
import type { WreckSpec } from './effects';

// Everything hostile is cut from the same obsidian, rimmed in molten orange,
// with a crimson gun-light somewhere on it. Silhouette and motion carry the
// identity: darts are slivers with afterburner tails, skiffs are blunt
// wedges with an engine ring, raptors are wide twin-cannon hunters, turrets
// hang from the keel like armored bells, generators are shield domes on
// pylons, and the cores are the flagship's naked spine.

export type TintKind = 'edge' | 'fill' | 'core';
export type TintPart = { material: MeshBasicMaterial | LineBasicMaterial; base: Color; kind: TintKind };

function tintable(group: Group): TintPart[] {
  return (group.userData.parts ??= []) as TintPart[];
}

type FacetGeometry = OctahedronGeometry | TetrahedronGeometry | BoxGeometry | CylinderGeometry | SphereGeometry;

function addFacetMesh(
  group: Group,
  geometry: FacetGeometry,
  fillColor: Color,
  edgeColor: Color,
  edgeIntensity: number,
) {
  const fillMaterial = new MeshBasicMaterial({ color: fillColor.clone() });
  const fill = new Mesh(geometry, fillMaterial);
  const edgeMaterial = new LineBasicMaterial(additiveMaterialParameters({
    color: hdr(edgeColor, edgeIntensity),
  }));
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
  const glowMaterial = createAdditiveBasicMaterial({
    color: hdr(color, intensity * 0.4),
    opacity: glowOpacity,
  });
  const glow = new Mesh(new OctahedronGeometry(radius * glowScale, 1), glowMaterial);
  core.add(glow);
  group.add(core);
  tintable(group).push(
    { material: coreMaterial, base: hdr(color, intensity), kind: 'core' },
    { material: glowMaterial, base: hdr(color, intensity * 0.4), kind: 'core' },
  );
  return core;
}

// ---- dart: a sliver of obsidian with an afterburner scream --------------------

export function createDartMesh() {
  const group = new Group();
  const body = new OctahedronGeometry(0.44, 0);
  body.scale(0.42, 0.3, 2.5);
  addFacetMesh(group, body, OBSIDIAN.clone().multiplyScalar(0.65), MOLTEN, 1.15);

  // Three swept blades, off-axis — the tri-wing silhouette.
  for (const [angle, tiltZ] of [[0, 0.3], [2.1, -0.25], [-2.1, -0.25]] as const) {
    const blade = new TetrahedronGeometry(0.55, 0);
    blade.scale(1.55, 0.16, 0.85);
    const mesh = addFacetMesh(group, blade, OBSIDIAN.clone().multiplyScalar(0.5), MOLTEN, 1.0);
    mesh.position.set(Math.cos(angle) * 0.42, Math.sin(angle) * 0.42, -0.35);
    mesh.rotation.set(0, 0, angle + tiltZ);
  }

  addCore(group, 0.14, CRIMSON, 1.9, 1.5, 0.3);

  // The tail: the one hot thing on it, so the swarm reads as streaks.
  const tailMaterial = createAdditiveBasicMaterial({ color: hdr(MOLTEN, 1.25), opacity: 0.75, side: 2 });
  const tail = new Mesh(new CylinderGeometry(0.015, 0.34, 3.4, 7, 1, true), tailMaterial);
  tail.rotation.x = -Math.PI / 2;
  tail.position.z = -2.2;
  group.add(tail);
  tintable(group).push({ material: tailMaterial, base: hdr(MOLTEN, 1.25), kind: 'core' });

  group.userData.accent = MOLTEN.clone();
  group.userData.shardSpecs = [
    { direction: new Vector3(0, 0, 1), color: MOLTEN.clone(), size: 0.5 },
    { direction: new Vector3(0.7, 0.3, -0.6).normalize(), color: MOLTEN.clone(), size: 0.4 },
    { direction: new Vector3(-0.7, 0.3, -0.6).normalize(), color: CRIMSON.clone(), size: 0.4 },
  ] satisfies WreckSpec[];
  group.userData.lockRingScale = 0.9;
  return group;
}

// ---- skiff: a blunt gun-wedge with an engine ring ------------------------------

export function createSkiffMesh() {
  const group = new Group();
  const hull = new BoxGeometry(1.5, 0.5, 1.15);
  addFacetMesh(group, hull, OBSIDIAN.clone().multiplyScalar(0.6), MOLTEN, 1.05);

  const prow = new TetrahedronGeometry(0.62, 0);
  prow.scale(1.2, 0.42, 1.1);
  const prowMesh = addFacetMesh(group, prow, OBSIDIAN.clone().multiplyScalar(0.5), MOLTEN, 1.2);
  prowMesh.position.set(0, 0.05, 0.85);
  prowMesh.rotation.y = Math.PI / 4;

  // The engine ring behind the hull — the skiff's identifying halo.
  const ringMaterial = createAdditiveBasicMaterial({ color: hdr(MOLTEN, 1.5), side: 2 });
  const engineRing = new Mesh(new RingGeometry(0.5, 0.66, 24), ringMaterial);
  engineRing.position.z = -0.75;
  group.add(engineRing);
  tintable(group).push({ material: ringMaterial, base: hdr(MOLTEN, 1.5), kind: 'edge' });

  addCore(group, 0.17, CRIMSON, 1.6, 1.5, 0.28);

  // A crooked sensor mast.
  const mast = addFacetMesh(group, new BoxGeometry(0.07, 0.9, 0.07), OBSIDIAN.clone().multiplyScalar(0.55), CRIMSON, 1.2);
  mast.position.set(-0.4, 0.6, -0.2);
  mast.rotation.z = 0.2;

  group.userData.accent = MOLTEN.clone();
  group.userData.shardSpecs = [
    { direction: new Vector3(1, 0.3, 0).normalize(), color: MOLTEN.clone(), size: 0.6 },
    { direction: new Vector3(-1, 0.3, 0).normalize(), color: MOLTEN.clone(), size: 0.6 },
    { direction: new Vector3(0, 0.7, 0.7).normalize(), color: CRIMSON.clone(), size: 0.45 },
    { direction: new Vector3(0, -0.6, -0.7).normalize(), color: MOLTEN.clone(), size: 0.5 },
  ] satisfies WreckSpec[];
  group.userData.lockRingScale = 1.05;
  return group;
}

// ---- raptor: wide-winged hunter with twin cannons ------------------------------

export function createRaptorMesh() {
  const group = new Group();
  const body = new OctahedronGeometry(0.7, 0);
  body.scale(0.85, 0.5, 1.5);
  addFacetMesh(group, body, OBSIDIAN.clone().multiplyScalar(0.62), MOLTEN, 1.1);

  // Forward-swept wings — the biggest small-craft silhouette on the field.
  for (const side of [-1, 1]) {
    const wing = new TetrahedronGeometry(0.85, 0);
    wing.scale(2.1, 0.14, 0.9);
    const mesh = addFacetMesh(group, wing, OBSIDIAN.clone().multiplyScalar(0.5), MOLTEN, 1.25);
    mesh.position.set(side * 1.15, 0.05, -0.25);
    mesh.rotation.set(0.1, side * 0.4, side * -0.16);
  }

  // Twin cannon barrels with crimson muzzle lamps: the thing that shoots you.
  for (const side of [-1, 1]) {
    const barrel = addFacetMesh(group, new CylinderGeometry(0.08, 0.1, 1.2, 6), OBSIDIAN.clone().multiplyScalar(0.7), CRIMSON, 1.35);
    barrel.position.set(side * 0.45, -0.12, 0.7);
    barrel.rotation.x = Math.PI / 2;
    const lampMaterial = createAdditiveBasicMaterial({ color: hdr(CRIMSON, 2.0), opacity: 0.85 });
    const lamp = new Mesh(new OctahedronGeometry(0.1, 0), lampMaterial);
    lamp.position.set(side * 0.45, -0.12, 1.34);
    group.add(lamp);
    tintable(group).push({ material: lampMaterial, base: hdr(CRIMSON, 2.0), kind: 'core' });
  }

  addCore(group, 0.2, MOLTEN, 1.6, 1.5, 0.28);

  group.userData.accent = CRIMSON.clone();
  group.userData.shardSpecs = [
    { direction: new Vector3(1, 0.2, 0).normalize(), color: MOLTEN.clone(), size: 0.7 },
    { direction: new Vector3(-1, 0.2, 0).normalize(), color: MOLTEN.clone(), size: 0.7 },
    { direction: new Vector3(0.3, 0.7, 0.5).normalize(), color: CRIMSON.clone(), size: 0.5 },
    { direction: new Vector3(-0.3, -0.6, 0.6).normalize(), color: CRIMSON.clone(), size: 0.5 },
    { direction: new Vector3(0, 0.2, -1).normalize(), color: MOLTEN.clone(), size: 0.55 },
  ] satisfies WreckSpec[];
  group.userData.lockRingScale = 1.35;
  return group;
}

// ---- turret: an armored bell hanging off the enemy keel ------------------------

export function createTurretMesh() {
  const group = new Group();

  // Yoke reaching up toward the hull overhead.
  const yoke = addFacetMesh(group, new CylinderGeometry(0.22, 0.34, 1.5, 6), OBSIDIAN.clone().multiplyScalar(0.5), MOLTEN, 0.9);
  yoke.position.y = 1.35;

  // The exposed mount, hidden until the armor shears off.
  const mountMaterial = new MeshBasicMaterial({ color: hdr(MOLTEN, 1.1) });
  const mount = new Mesh(new SphereGeometry(0.62, 10, 8), mountMaterial);
  const mountGlowMaterial = createAdditiveBasicMaterial({ color: hdr(MOLTEN, 0.45), opacity: 0.25 });
  const mountGlow = new Mesh(new SphereGeometry(0.85, 10, 8), mountGlowMaterial);
  mount.add(mountGlow);
  group.add(mount);
  tintable(group).push(
    { material: mountMaterial, base: hdr(MOLTEN, 1.1), kind: 'core' },
    { material: mountGlowMaterial, base: hdr(MOLTEN, 0.45), kind: 'core' },
  );

  // Armor bell: six plates skirted around the mount; they shear at the stage break.
  const armor = new Group();
  const wreckSpecs: WreckSpec[] = [];
  for (let i = 0; i < 6; i += 1) {
    const angle = (i / 6) * Math.PI * 2;
    const plateGroup = new Group();
    const plate = new BoxGeometry(0.8, 1.5, 0.24);
    const fill = addFacetMesh(group, plate, OBSIDIAN.clone().multiplyScalar(0.55), MOLTEN, 1.0);
    fill.removeFromParent();
    plateGroup.add(fill);
    plateGroup.position.set(Math.cos(angle) * 0.85, 0.1, Math.sin(angle) * 0.85);
    plateGroup.rotation.y = -angle + Math.PI / 2;
    plateGroup.rotation.x = 0.18;
    armor.add(plateGroup);
    wreckSpecs.push({
      direction: new Vector3(Math.cos(angle), -0.4, Math.sin(angle)).normalize(),
      color: MOLTEN.clone(),
      size: 0.8,
    });
  }
  group.add(armor);
  group.userData.armor = armor;

  // Twin long guns pointing back down the deck line.
  for (const side of [-1, 1]) {
    const gun = addFacetMesh(group, new CylinderGeometry(0.09, 0.12, 1.9, 6), OBSIDIAN.clone().multiplyScalar(0.65), CRIMSON, 1.25);
    gun.position.set(side * 0.3, -0.35, 0.95);
    gun.rotation.x = Math.PI / 2;
  }

  group.userData.accent = CRIMSON.clone();
  group.userData.shardSpecs = [
    ...wreckSpecs,
    { direction: new Vector3(0, -1, 0.3).normalize(), color: CRIMSON.clone(), size: 1.0 },
  ] satisfies WreckSpec[];
  group.userData.lockRingScale = 1.6;
  return group;
}

// Armor break: the bell shears off; the mount burns naked.
export function breakTurretArmor(group: Group) {
  const armor = group.userData.armor as Group | undefined;
  if (!armor || armor.visible === false) return;
  armor.visible = false;
  for (const part of (group.userData.parts as TintPart[])) {
    if (part.kind === 'core') part.base.multiplyScalar(2.1);
  }
}

// ---- shield generator: a humming dome on a pylon --------------------------------

export function createShieldGeneratorMesh() {
  const group = new Group();

  // Pylon collar reaching back toward the flagship's hull.
  const pylon = addFacetMesh(group, new BoxGeometry(0.5, 0.5, 2.4), OBSIDIAN.clone().multiplyScalar(0.5), MOLTEN, 0.85);
  pylon.position.set(-1.4, -0.3, 0);
  pylon.rotation.y = 0.25;

  const base = addFacetMesh(group, new CylinderGeometry(1.1, 1.35, 0.6, 8), OBSIDIAN.clone().multiplyScalar(0.6), MOLTEN, 1.05);
  base.position.y = -0.5;

  // The dome itself — the one magenta-lit machine on the enemy side, because
  // it is what projects the shield.
  const domeMaterial = new MeshBasicMaterial({ color: hdr(new Color(0.85, 0.2, 0.6), 1.15) });
  const dome = new Mesh(new SphereGeometry(0.95, 14, 10, 0, Math.PI * 2, 0, Math.PI / 2), domeMaterial);
  const domeGlowMaterial = createAdditiveBasicMaterial({ color: hdr(new Color(0.9, 0.25, 0.65), 0.5), opacity: 0.3 });
  const domeGlow = new Mesh(new SphereGeometry(1.2, 14, 10), domeGlowMaterial);
  dome.add(domeGlow);
  group.add(dome);
  tintable(group).push(
    { material: domeMaterial, base: hdr(new Color(0.85, 0.2, 0.6), 1.15), kind: 'core' },
    { material: domeGlowMaterial, base: hdr(new Color(0.9, 0.25, 0.65), 0.5), kind: 'core' },
  );

  // Emitter spike.
  const spike = addFacetMesh(group, new CylinderGeometry(0.05, 0.16, 1.3, 5), OBSIDIAN.clone().multiplyScalar(0.7), CRIMSON, 1.3);
  spike.position.y = 1.1;

  group.userData.accent = new Color(0.9, 0.25, 0.65);
  group.userData.shardSpecs = [
    { direction: new Vector3(0, 1, 0), color: new Color(0.9, 0.25, 0.65), size: 0.9 },
    { direction: new Vector3(0.8, 0.4, 0).normalize(), color: MOLTEN.clone(), size: 0.7 },
    { direction: new Vector3(-0.8, 0.4, 0).normalize(), color: MOLTEN.clone(), size: 0.7 },
    { direction: new Vector3(0, -0.5, 0.8).normalize(), color: CRIMSON.clone(), size: 0.6 },
  ] satisfies WreckSpec[];
  group.userData.lockRingScale = 1.5;
  return group;
}

// ---- power core: the flagship's exposed spine -----------------------------------

export function createCoreMesh() {
  const group = new Group();

  // The naked column: white-hot heart in a molten sheath.
  const columnMaterial = new MeshBasicMaterial({ color: hdr(new Color(1.0, 0.72, 0.4), 1.7) });
  const column = new Mesh(new CylinderGeometry(0.42, 0.42, 2.3, 8), columnMaterial);
  const columnGlowMaterial = createAdditiveBasicMaterial({ color: hdr(MOLTEN, 0.6), opacity: 0.3 });
  const columnGlow = new Mesh(new CylinderGeometry(0.66, 0.66, 2.5, 8), columnGlowMaterial);
  column.add(columnGlow);
  group.add(column);
  tintable(group).push(
    { material: columnMaterial, base: hdr(new Color(1.0, 0.72, 0.4), 1.7), kind: 'core' },
    { material: columnGlowMaterial, base: hdr(MOLTEN, 0.6), kind: 'core' },
  );

  // Vent fins top and bottom.
  for (const y of [1.4, -1.4]) {
    const cap = addFacetMesh(group, new CylinderGeometry(0.95, 0.6, 0.5, 6), OBSIDIAN.clone().multiplyScalar(0.55), MOLTEN, 1.1);
    cap.position.y = y;
    if (y < 0) cap.rotation.z = Math.PI;
  }

  // The cage: crimson containment bars that read "shielded" until the
  // generators die — then they retract and the core is bare.
  const cage = new Group();
  const cageMaterial = createAdditiveBasicMaterial({ color: hdr(CRIMSON, 1.6), side: 2 });
  for (let i = 0; i < 4; i += 1) {
    const angle = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const rail = new Mesh(new BoxGeometry(0.08, 2.9, 0.08), cageMaterial);
    rail.position.set(Math.cos(angle) * 0.85, 0, Math.sin(angle) * 0.85);
    cage.add(rail);
  }
  const hoop = new Mesh(new RingGeometry(0.8, 0.92, 6), cageMaterial);
  cage.add(hoop);
  group.add(cage);
  group.userData.cage = cage;
  group.userData.cageMaterial = cageMaterial;
  tintable(group).push({ material: cageMaterial, base: hdr(CRIMSON, 1.6), kind: 'edge' });

  group.userData.accent = NEBULA_GOLD.clone();
  group.userData.shardSpecs = [
    { direction: new Vector3(0, 1, 0), color: NEBULA_GOLD.clone(), size: 1.1 },
    { direction: new Vector3(0, -1, 0), color: MOLTEN.clone(), size: 1.1 },
    { direction: new Vector3(1, 0.2, 0).normalize(), color: MOLTEN.clone(), size: 0.8 },
    { direction: new Vector3(-1, 0.2, 0).normalize(), color: MOLTEN.clone(), size: 0.8 },
    { direction: new Vector3(0, 0.2, 1).normalize(), color: CRIMSON.clone(), size: 0.7 },
  ] satisfies WreckSpec[];
  group.userData.lockRingScale = 1.55;
  return group;
}

// The shield falls: the cage snaps open and the column runs hotter.
export function openCoreCage(group: Group) {
  const cage = group.userData.cage as Group | undefined;
  if (!cage || cage.visible === false) return;
  cage.visible = false;
  for (const part of (group.userData.parts as TintPart[])) {
    if (part.kind === 'core') part.base.multiplyScalar(1.6);
  }
}

// ---- hostile shell ---------------------------------------------------------------

export function createBoltMesh() {
  const group = new Group();
  const dart = new OctahedronGeometry(0.36, 0);
  dart.scale(0.55, 0.55, 2.4);
  const coreMaterial = new MeshBasicMaterial({ color: hdr(CRIMSON, 2.4) });
  const core = new Mesh(dart, coreMaterial);
  const shellMaterial = createAdditiveBasicMaterial({ color: hdr(CRIMSON, 1.0), opacity: 0.5 });
  const shellGeometry = new OctahedronGeometry(0.55, 0);
  shellGeometry.scale(0.6, 0.6, 2.1);
  const shell = new Mesh(shellGeometry, shellMaterial);
  group.add(core, shell);
  tintable(group).push(
    { material: coreMaterial, base: hdr(CRIMSON, 2.4), kind: 'core' },
    { material: shellMaterial, base: hdr(CRIMSON, 1.0), kind: 'core' },
  );
  group.userData.accent = CRIMSON.clone();
  group.userData.isHostileShot = true;
  group.userData.trailColor = CRIMSON.clone().multiplyScalar(0.8);
  group.userData.shardSpecs = [
    { direction: new Vector3(0, 0, 1), color: CRIMSON.clone(), size: 0.4 },
    { direction: new Vector3(0, 0, -1), color: CRIMSON.clone(), size: 0.4 },
  ] satisfies WreckSpec[];
  group.userData.lockRingScale = 0.75;
  return group;
}

// ---- player shot: the coldest thing in the sky ------------------------------------

export function createPlayerShotMesh() {
  const group = new Group();
  const coreGeometry = new OctahedronGeometry(0.32, 0);
  coreGeometry.scale(0.45, 0.45, 2.2);
  group.add(new Mesh(coreGeometry, new MeshBasicMaterial({ color: hdr(ICE, 2.6) })));
  const shellGeometry = new OctahedronGeometry(0.5, 0);
  shellGeometry.scale(0.55, 0.55, 1.9);
  group.add(new Mesh(shellGeometry, createAdditiveBasicMaterial({ color: hdr(CYAN, 1.0), opacity: 0.5 })));
  return group;
}
