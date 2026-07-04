import {
  AdditiveBlending,
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
  TetrahedronGeometry,
  Vector3,
} from 'three';
import { EMBER, GOLD, hdr, OBSIDIAN, WHITE_HOT } from './palette';
import type { EmberSpec } from './effects';

// Every hostile is forged from the same stuff: near-black obsidian mass,
// molten seams, and a hot core. Silhouette and motion carry identity —
// cinders are tumbling chunks, motes are comets, scorchers are wasps,
// pyres are armored idols, and the boss parts are architecture.

export type TintKind = 'edge' | 'fill' | 'core';
export type TintPart = { material: MeshBasicMaterial | LineBasicMaterial; base: Color; kind: TintKind };

function tintable(group: Group): TintPart[] {
  return (group.userData.parts ??= []) as TintPart[];
}

function addFacetMesh(
  group: Group,
  geometry: OctahedronGeometry | TetrahedronGeometry | BoxGeometry | CylinderGeometry,
  fillColor: Color,
  edgeColor: Color,
  edgeIntensity: number,
) {
  const fillMaterial = new MeshBasicMaterial({ color: fillColor.clone() });
  const fill = new Mesh(geometry, fillMaterial);
  const edgeMaterial = new LineBasicMaterial({
    color: hdr(edgeColor, edgeIntensity),
    transparent: true,
    blending: AdditiveBlending,
    depthWrite: false,
  });
  const edges = new LineSegments(new EdgesGeometry(geometry), edgeMaterial);
  fill.add(edges);
  group.add(fill);
  tintable(group).push(
    { material: fillMaterial, base: fillColor.clone(), kind: 'fill' },
    { material: edgeMaterial, base: hdr(edgeColor, edgeIntensity), kind: 'edge' },
  );
  return fill;
}

function addCore(group: Group, radius: number, color: Color, intensity: number, glowScale = 1.9, glowOpacity = 0.4) {
  const coreMaterial = new MeshBasicMaterial({ color: hdr(color, intensity) });
  const core = new Mesh(new OctahedronGeometry(radius, 1), coreMaterial);
  const glowMaterial = new MeshBasicMaterial({
    color: hdr(color, intensity * 0.4),
    transparent: true,
    opacity: glowOpacity,
    blending: AdditiveBlending,
    depthWrite: false,
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

// ---- cinder: a smoldering obsidian chunk ------------------------------------

export function createCinderMesh() {
  const group = new Group();
  const shardSpecs: EmberSpec[] = [];
  const placements: Array<[Vector3, number, number]> = [
    [new Vector3(0.42, 0.1, 0), 0.62, 0.8],
    [new Vector3(-0.35, 0.32, 0.15), 0.52, 2.4],
    [new Vector3(-0.1, -0.42, -0.12), 0.56, 4.2],
    [new Vector3(0.05, 0.5, -0.3), 0.4, 1.3],
  ];
  for (const [offset, size, twist] of placements) {
    const geometry = new TetrahedronGeometry(size, 0);
    const fill = addFacetMesh(group, geometry, OBSIDIAN.clone().multiplyScalar(1.6), EMBER, 1.0);
    fill.position.copy(offset);
    fill.rotation.set(twist, twist * 1.7, twist * 0.6);
    shardSpecs.push({ direction: offset.clone().normalize(), color: EMBER.clone(), size: size * 0.7 });
  }
  addCore(group, 0.24, GOLD, 1.7);
  group.userData.accent = EMBER.clone();
  group.userData.shardSpecs = shardSpecs;
  group.userData.lockRingScale = 0.9;
  return group;
}

// ---- mote: a comet — hot head, streaming tail --------------------------------

export function createMoteMesh() {
  const group = new Group();
  const head = new OctahedronGeometry(0.42, 0);
  head.scale(1, 1, 2.2);
  addFacetMesh(group, head, OBSIDIAN.clone().multiplyScalar(2), GOLD, 1.3);
  addCore(group, 0.2, WHITE_HOT, 2.1, 1.7, 0.5);

  const tailMaterial = new MeshBasicMaterial({
    color: hdr(EMBER, 0.85),
    transparent: true,
    opacity: 0.55,
    blending: AdditiveBlending,
    depthWrite: false,
  });
  for (const [radius, length, z] of [
    [0.3, 2.4, -1.5],
    [0.16, 3.6, -2.2],
  ] as const) {
    const cone = new CylinderGeometry(0.01, radius, length, 6, 1, true);
    const tail = new Mesh(cone, tailMaterial);
    tail.rotation.x = -Math.PI / 2;
    tail.position.z = z;
    group.add(tail);
  }
  tintable(group).push({ material: tailMaterial, base: hdr(EMBER, 0.85), kind: 'core' });

  group.userData.accent = GOLD.clone();
  group.userData.shardSpecs = [
    { direction: new Vector3(0, 0, 1), color: GOLD.clone(), size: 0.5 },
    { direction: new Vector3(0.5, 0.5, -0.6).normalize(), color: EMBER.clone(), size: 0.4 },
    { direction: new Vector3(-0.5, -0.3, -0.7).normalize(), color: EMBER.clone(), size: 0.4 },
  ];
  group.userData.lockRingScale = 0.9;
  return group;
}

// ---- scorcher: an ember wasp with a broken targeting halo --------------------

export function createScorcherMesh() {
  const group = new Group();
  const body = new OctahedronGeometry(0.85, 0);
  body.scale(1.25, 0.6, 0.75);
  addFacetMesh(group, body, OBSIDIAN.clone().multiplyScalar(1.8), EMBER, 1.1);

  // Mandible fins sweeping forward.
  for (const side of [-1, 1]) {
    const fin = new TetrahedronGeometry(0.66, 0);
    fin.scale(0.5, 0.28, 1.9);
    const mesh = addFacetMesh(group, fin, OBSIDIAN.clone().multiplyScalar(1.5), GOLD, 1.25);
    mesh.position.set(side * 0.82, -0.05, 0.75);
    mesh.rotation.set(0.15, side * -0.35, side * 0.5);
  }

  addCore(group, 0.3, WHITE_HOT, 1.9, 1.8, 0.45);

  // The tell: a broken halo that spins while it hunts.
  const halo = new Group();
  const spinParts: Mesh[] = [];
  for (const [inner, outer, tilt, speed] of [
    [1.35, 1.44, 0.55, 1],
    [1.7, 1.76, -0.4, -1],
  ] as const) {
    const arcMaterial = new MeshBasicMaterial({
      color: hdr(EMBER, 1.45),
      transparent: true,
      blending: AdditiveBlending,
      depthWrite: false,
      side: 2,
    });
    const ring = new Mesh(new RingGeometry(inner, outer, 40, 1, 0, Math.PI * 1.35), arcMaterial);
    ring.rotation.x = tilt;
    ring.userData.spinSpeed = speed * 2.2;
    halo.add(ring);
    spinParts.push(ring);
    tintable(group).push({ material: arcMaterial, base: hdr(EMBER, 1.45), kind: 'edge' });
  }
  group.add(halo);
  group.userData.spinParts = spinParts;

  group.userData.accent = EMBER.clone();
  group.userData.shardSpecs = [
    { direction: new Vector3(1, 0.2, 0).normalize(), color: EMBER.clone(), size: 0.6 },
    { direction: new Vector3(-1, 0.2, 0).normalize(), color: EMBER.clone(), size: 0.6 },
    { direction: new Vector3(0, 0.6, 0.6).normalize(), color: GOLD.clone(), size: 0.5 },
    { direction: new Vector3(0, -0.5, -0.6).normalize(), color: GOLD.clone(), size: 0.4 },
  ];
  group.userData.lockRingScale = 1.25;
  return group;
}

// ---- pyre: an armored furnace idol -------------------------------------------

export function createPyreMesh() {
  const group = new Group();

  // Molten column, hidden until the armor breaks.
  const coreMaterial = new MeshBasicMaterial({ color: hdr(GOLD, 1.0) });
  const core = new Mesh(new CylinderGeometry(0.72, 0.72, 2.7, 6), coreMaterial);
  const coreGlowMaterial = new MeshBasicMaterial({
    color: hdr(GOLD, 0.4),
    transparent: true,
    opacity: 0.35,
    blending: AdditiveBlending,
    depthWrite: false,
  });
  const coreGlow = new Mesh(new CylinderGeometry(1.05, 1.05, 2.9, 6), coreGlowMaterial);
  core.add(coreGlow);
  group.add(core);
  tintable(group).push(
    { material: coreMaterial, base: hdr(GOLD, 1.0), kind: 'core' },
    { material: coreGlowMaterial, base: hdr(GOLD, 0.4), kind: 'core' },
  );

  // Six obsidian plates caged around the column; they shear off at the stage break.
  const armor = new Group();
  const shardSpecs: EmberSpec[] = [];
  for (let i = 0; i < 6; i += 1) {
    const angle = (i / 6) * Math.PI * 2;
    const plateGroup = new Group();
    const plate = new BoxGeometry(1.16, 3.1, 0.3);
    const fill = addFacetMesh(group, plate, OBSIDIAN.clone().multiplyScalar(1.4), EMBER, 0.95);
    fill.removeFromParent();
    plateGroup.add(fill);
    plateGroup.position.set(Math.cos(angle) * 1.32, 0, Math.sin(angle) * 1.32);
    plateGroup.rotation.y = -angle + Math.PI / 2;
    armor.add(plateGroup);
    shardSpecs.push({
      direction: new Vector3(Math.cos(angle), 0.35, Math.sin(angle)).normalize(),
      color: EMBER.clone(),
      size: 1,
    });
  }
  group.add(armor);
  group.userData.armor = armor;

  // Caps: dark hex crowns top and bottom.
  for (const y of [1.85, -1.85]) {
    const cap = addFacetMesh(
      group,
      new CylinderGeometry(1.5, 1.15, 0.5, 6),
      OBSIDIAN.clone().multiplyScalar(1.2),
      GOLD,
      1.05,
    );
    cap.position.y = y;
    if (y < 0) cap.rotation.z = Math.PI;
  }

  group.userData.accent = GOLD.clone();
  group.userData.shardSpecs = [
    ...shardSpecs,
    { direction: new Vector3(0, 1, 0), color: GOLD.clone(), size: 1.2 },
    { direction: new Vector3(0, -1, 0), color: GOLD.clone(), size: 1.2 },
  ];
  group.userData.lockRingScale = 1.9;
  return group;
}

// Armor break: plates shear off, the column burns naked.
export function breakPyreArmor(group: Group) {
  const armor = group.userData.armor as Group | undefined;
  if (!armor || armor.visible === false) return;
  armor.visible = false;
  for (const part of (group.userData.parts as TintPart[])) {
    if (part.kind === 'core') part.base.multiplyScalar(2.2);
  }
}

// ---- hostile shots ------------------------------------------------------------

export function createBoltMesh() {
  const group = new Group();
  const dart = new OctahedronGeometry(0.36, 0);
  dart.scale(0.55, 0.55, 2.4);
  const coreMaterial = new MeshBasicMaterial({ color: hdr(EMBER, 2.5) });
  const core = new Mesh(dart, coreMaterial);
  const shellMaterial = new MeshBasicMaterial({
    color: hdr(EMBER, 1.0),
    transparent: true,
    opacity: 0.5,
    blending: AdditiveBlending,
    depthWrite: false,
  });
  const shellGeometry = new OctahedronGeometry(0.55, 0);
  shellGeometry.scale(0.6, 0.6, 2.1);
  const shell = new Mesh(shellGeometry, shellMaterial);
  group.add(core, shell);
  tintable(group).push(
    { material: coreMaterial, base: hdr(EMBER, 2.5), kind: 'core' },
    { material: shellMaterial, base: hdr(EMBER, 1.0), kind: 'core' },
  );
  group.userData.accent = EMBER.clone();
  group.userData.isHostileShot = true;
  group.userData.trailColor = EMBER.clone().multiplyScalar(0.8);
  group.userData.shardSpecs = [
    { direction: new Vector3(0, 0, 1), color: EMBER.clone(), size: 0.4 },
    { direction: new Vector3(0, 0, -1), color: EMBER.clone(), size: 0.4 },
  ];
  group.userData.lockRingScale = 0.75;
  return group;
}

export function createFlareMesh() {
  const group = new Group();
  addCore(group, 0.62, WHITE_HOT, 2.3, 1.9, 0.5);
  const sheathMaterial = new MeshBasicMaterial({
    color: hdr(GOLD, 0.9),
    transparent: true,
    opacity: 0.42,
    blending: AdditiveBlending,
    depthWrite: false,
  });
  const sheathGeometry = new OctahedronGeometry(1.05, 1);
  sheathGeometry.scale(0.8, 0.8, 1.5);
  group.add(new Mesh(sheathGeometry, sheathMaterial));
  tintable(group).push({ material: sheathMaterial, base: hdr(GOLD, 0.9), kind: 'core' });

  const tailMaterial = new MeshBasicMaterial({
    color: hdr(GOLD, 0.8),
    transparent: true,
    opacity: 0.5,
    blending: AdditiveBlending,
    depthWrite: false,
  });
  const tail = new Mesh(new CylinderGeometry(0.02, 0.52, 4.2, 8, 1, true), tailMaterial);
  tail.rotation.x = -Math.PI / 2;
  tail.position.z = -2.4;
  group.add(tail);
  tintable(group).push({ material: tailMaterial, base: hdr(GOLD, 0.8), kind: 'core' });

  group.userData.accent = GOLD.clone();
  group.userData.isHostileShot = true;
  group.userData.trailColor = GOLD.clone().multiplyScalar(0.75);
  group.userData.shardSpecs = [
    { direction: new Vector3(0.7, 0.7, 0).normalize(), color: GOLD.clone(), size: 0.6 },
    { direction: new Vector3(-0.7, 0.7, 0).normalize(), color: GOLD.clone(), size: 0.6 },
    { direction: new Vector3(0, -0.8, 0.6).normalize(), color: WHITE_HOT.clone(), size: 0.5 },
  ];
  group.userData.lockRingScale = 1.1;
  return group;
}
