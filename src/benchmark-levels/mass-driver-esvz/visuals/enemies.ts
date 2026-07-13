import {
  BoxGeometry,
  CircleGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  EdgesGeometry,
  Group,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  OctahedronGeometry,
  Vector3,
} from 'three';
import type { BufferGeometry, Material } from 'three';
import { additiveMaterialParameters, createAdditiveBasicMaterial } from '../../../engine/visual-kit';
import type { ShardSpec } from './effects';
import { ARC_VIOLET, ARC_WHITE, GUNMETAL, HAZARD_AMBER, hdr, WARNING_RED } from './palette';

// Defense drone hardware: near-black gunmetal panels with hazard-amber
// running lights, so every hostile silhouette reads warm against the cold
// blue-violet barrel. TintPart drives lock/denied/damage recolors per frame.

export type TintPart = {
  material: MeshBasicMaterial | LineBasicMaterial;
  base: Color;
  kind: 'fill' | 'edge' | 'core';
};

function fillPart(parts: TintPart[], geometry: BufferGeometry, color: Color): Mesh {
  const material = new MeshBasicMaterial({ color: color.clone() });
  parts.push({ material, base: color.clone(), kind: 'fill' });
  return new Mesh(geometry, material);
}

function edgePart(parts: TintPart[], geometry: BufferGeometry, color: Color): LineSegments {
  const material = new LineBasicMaterial(additiveMaterialParameters({ color: color.clone() }));
  parts.push({ material, base: color.clone(), kind: 'edge' });
  return new LineSegments(new EdgesGeometry(geometry as never), material);
}

function corePart(parts: TintPart[], geometry: BufferGeometry, color: Color): Mesh {
  const material = createAdditiveBasicMaterial({ color: color.clone() });
  parts.push({ material, base: color.clone(), kind: 'core' });
  return new Mesh(geometry, material);
}

function finishGroup(group: Group, parts: TintPart[], accent: Color, shardSpecs: ShardSpec[], lockRingScale = 1) {
  group.userData.parts = parts;
  group.userData.accent = accent.clone();
  group.userData.shardSpecs = shardSpecs;
  group.userData.lockRingScale = lockRingScale;
  return group;
}

function radialShards(count: number, color: Color, size: number): ShardSpec[] {
  return Array.from({ length: count }, (_item, index) => {
    const angle = (index / count) * Math.PI * 2;
    return {
      direction: new Vector3(Math.cos(angle), Math.sin(angle), (index % 3 - 1) * 0.4).normalize(),
      color: color.clone(),
      size,
    };
  });
}

// Weaver — a slim interceptor dart: swept twin fins, hot amber spine.
export function createWeaverMesh() {
  const group = new Group();
  const parts: TintPart[] = [];

  const body = new OctahedronGeometry(0.5, 0);
  body.scale(0.42, 0.42, 2.4);
  group.add(fillPart(parts, body, GUNMETAL.clone().multiplyScalar(1.4)));
  group.add(edgePart(parts, body, hdr(HAZARD_AMBER, 0.9)));

  const fin = new BoxGeometry(1.9, 0.05, 0.55);
  for (const side of [-1, 1]) {
    const finMesh = fillPart(parts, fin, GUNMETAL.clone().multiplyScalar(1.2));
    finMesh.position.set(side * 0.85, 0, 0.35);
    finMesh.rotation.z = side * -0.42;
    group.add(finMesh);
    const finEdge = edgePart(parts, fin, hdr(HAZARD_AMBER, 0.7));
    finEdge.position.copy(finMesh.position);
    finEdge.rotation.copy(finMesh.rotation);
    group.add(finEdge);
  }

  const spine = new BoxGeometry(0.09, 0.09, 2.3);
  const spineMesh = corePart(parts, spine, hdr(HAZARD_AMBER, 1.6));
  group.add(spineMesh);

  return finishGroup(group, parts, HAZARD_AMBER, radialShards(7, HAZARD_AMBER, 0.3));
}

// Stator — a flat wall-crawler wedge with claw feet, belly to the coils.
export function createStatorMesh() {
  const group = new Group();
  const parts: TintPart[] = [];

  const hull = new BoxGeometry(1.5, 0.42, 1.1);
  group.add(fillPart(parts, hull, GUNMETAL.clone().multiplyScalar(1.5)));
  group.add(edgePart(parts, hull, hdr(HAZARD_AMBER, 0.85)));

  const nose = new ConeGeometry(0.42, 0.7, 4);
  const noseMesh = fillPart(parts, nose, GUNMETAL.clone().multiplyScalar(1.3));
  noseMesh.rotation.x = Math.PI / 2;
  noseMesh.position.z = 0.85;
  group.add(noseMesh);

  const claw = new BoxGeometry(0.12, 0.5, 0.12);
  for (const [x, z] of [[-0.75, -0.4], [0.75, -0.4], [-0.75, 0.4], [0.75, 0.4]] as const) {
    const clawMesh = fillPart(parts, claw, GUNMETAL.clone().multiplyScalar(1.1));
    clawMesh.position.set(x, 0.32, z);
    clawMesh.rotation.z = x > 0 ? 0.5 : -0.5;
    group.add(clawMesh);
  }

  // Underglow eye strip faces into the tunnel — the visible warm belly light.
  const strip = new BoxGeometry(0.9, 0.07, 0.07);
  const stripMesh = corePart(parts, strip, hdr(HAZARD_AMBER, 1.7));
  stripMesh.position.y = -0.26;
  group.add(stripMesh);

  return finishGroup(group, parts, HAZARD_AMBER, radialShards(6, HAZARD_AMBER, 0.32));
}

// Sentinel — a heavy tri-fin turret pod with a single hot eye. Two hits.
export function createSentinelMesh() {
  const group = new Group();
  const parts: TintPart[] = [];

  const drum = new CylinderGeometry(0.62, 0.75, 1.0, 6);
  const drumMesh = fillPart(parts, drum, GUNMETAL.clone().multiplyScalar(1.6));
  drumMesh.rotation.x = Math.PI / 2;
  group.add(drumMesh);
  const drumEdge = edgePart(parts, drum, hdr(HAZARD_AMBER, 0.95));
  drumEdge.rotation.x = Math.PI / 2;
  group.add(drumEdge);

  const fin = new BoxGeometry(0.12, 1.1, 0.8);
  for (let i = 0; i < 3; i += 1) {
    const angle = (i / 3) * Math.PI * 2 + Math.PI / 2;
    const finMesh = fillPart(parts, fin, GUNMETAL.clone().multiplyScalar(1.2));
    finMesh.position.set(Math.cos(angle) * 0.85, Math.sin(angle) * 0.85, -0.1);
    finMesh.rotation.z = angle + Math.PI / 2;
    group.add(finMesh);
    const finEdge = edgePart(parts, fin, hdr(HAZARD_AMBER, 0.6));
    finEdge.position.copy(finMesh.position);
    finEdge.rotation.copy(finMesh.rotation);
    group.add(finEdge);
  }

  const eye = corePart(parts, new CircleGeometry(0.24, 18), hdr(HAZARD_AMBER, 2.0));
  eye.position.z = 0.55;
  group.add(eye);

  return finishGroup(group, parts, HAZARD_AMBER, radialShards(9, HAZARD_AMBER, 0.4), 1.25);
}

// Arc bolt — a live spark thrown by a sentinel; lockable, interceptable.
export function createBoltMesh() {
  const group = new Group();
  const parts: TintPart[] = [];

  const core = new OctahedronGeometry(0.3, 0);
  core.scale(0.7, 0.7, 1.7);
  group.add(corePart(parts, core, hdr(ARC_WHITE, 2.2)));
  const shell = new OctahedronGeometry(0.46, 0);
  shell.scale(0.8, 0.8, 1.5);
  group.add(corePart(parts, shell, hdr(ARC_VIOLET, 1.0)));

  group.userData.isHostileShot = true;
  group.userData.trailColor = ARC_VIOLET.clone().multiplyScalar(0.9);
  return finishGroup(group, parts, ARC_VIOLET, radialShards(5, ARC_VIOLET, 0.24), 0.8);
}

// Interlock — a jammed safety clamp on the payload collar: hazard-striped
// jaw block with a warning-red jam light. Two hits; the first blows the
// armor plate off and exposes the light.
export function createInterlockMesh() {
  const group = new Group();
  const parts: TintPart[] = [];

  const block = new BoxGeometry(1.7, 1.15, 0.75);
  group.add(fillPart(parts, block, GUNMETAL.clone().multiplyScalar(2.0)));
  group.add(edgePart(parts, block, hdr(HAZARD_AMBER, 1.1)));

  // Clamp jaws bite inward toward the collar center.
  const jaw = new BoxGeometry(0.5, 0.75, 0.55);
  for (const side of [-1, 1]) {
    const jawMesh = fillPart(parts, jaw, GUNMETAL.clone().multiplyScalar(1.6));
    jawMesh.position.set(side * 0.95, -0.72, 0);
    group.add(jawMesh);
    const jawEdge = edgePart(parts, jaw, hdr(HAZARD_AMBER, 0.8));
    jawEdge.position.copy(jawMesh.position);
    group.add(jawEdge);
  }

  // Hazard chevrons across the armor plate.
  const armor = new Group();
  const stripe = new BoxGeometry(0.24, 1.0, 0.1);
  for (let i = 0; i < 4; i += 1) {
    const stripeMesh = fillPart(parts, stripe, i % 2 === 0 ? HAZARD_AMBER.clone().multiplyScalar(0.75) : GUNMETAL.clone().multiplyScalar(0.9));
    stripeMesh.position.set(-0.6 + i * 0.4, 0, 0.38);
    stripeMesh.rotation.z = 0.5;
    armor.add(stripeMesh);
  }
  group.add(armor);

  // The jam light: dim behind armor, exposed and furious once cracked.
  const jamLight = corePart(parts, new CircleGeometry(0.3, 20), hdr(WARNING_RED, 1.1));
  jamLight.position.z = 0.42;
  jamLight.visible = false;
  group.add(jamLight);

  group.userData.armorPlate = armor;
  group.userData.jamLight = jamLight;
  return finishGroup(group, parts, WARNING_RED, radialShards(10, HAZARD_AMBER, 0.42), 1.35);
}

/** First interlock stage down: armor plate gone, jam light exposed. */
export function crackInterlock(group: Group) {
  const armor = group.userData.armorPlate as Group | undefined;
  if (armor) armor.visible = false;
  const jamLight = group.userData.jamLight as Mesh | undefined;
  if (jamLight) {
    jamLight.visible = true;
    (jamLight.material as MeshBasicMaterial).color.copy(hdr(WARNING_RED, 2.4));
  }
  group.userData.cracked = true;
}

export function disposeGeneratedMaterial(material: Material | Material[]) {
  for (const item of Array.isArray(material) ? material : [material]) item.dispose();
}
