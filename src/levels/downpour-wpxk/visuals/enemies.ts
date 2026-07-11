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
  PlaneGeometry,
  RingGeometry,
  TorusGeometry,
  Vector3,
} from 'three';
import { additiveMaterialParameters, createAdditiveBasicMaterial } from '../../../engine/visual-kit';
import {
  ACID,
  AMBER,
  CYAN,
  HAZARD,
  hdr,
  INK,
  MAGENTA,
  SLATE,
} from './palette';
import type { DebrisSpec } from './effects';

// Every hostile is wet city hardware: ink-black chassis, slate armor, and a
// signage-lit core. Above-ground craft glow cyan and magenta; security wears
// hazard white; the undercity enforcer burns sodium amber. Acid green is the
// gunship's alone. Fill and base geometry read at bloom zero — only thin edges
// and small cores run hot.

export type TintKind = 'edge' | 'fill' | 'core';
export type TintPart = { material: MeshBasicMaterial | LineBasicMaterial; base: Color; kind: TintKind };

function tintable(group: Group): TintPart[] {
  return (group.userData.parts ??= []) as TintPart[];
}

function addFacetMesh(
  group: Group,
  geometry: OctahedronGeometry | BoxGeometry | CylinderGeometry,
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

// ---- drone: a hunter spotter, four rotor arms in an X ------------------------

export function createDroneMesh() {
  const group = new Group();

  // Small ink-black chamfered body.
  const body = new OctahedronGeometry(0.34, 0);
  body.scale(1.1, 0.7, 1.1);
  addFacetMesh(group, body, INK.clone().multiplyScalar(1.4), CYAN, 1.15);

  // Four thin rotor arms in an X with tiny spinning rotor rings.
  const spinParts: Mesh[] = [];
  for (const corner of [
    new Vector3(0.5, 0.06, 0.5),
    new Vector3(-0.5, 0.06, 0.5),
    new Vector3(0.5, 0.06, -0.5),
    new Vector3(-0.5, 0.06, -0.5),
  ]) {
    const arm = new BoxGeometry(0.7, 0.03, 0.05);
    const armMesh = addFacetMesh(group, arm, SLATE.clone().multiplyScalar(0.6), CYAN, 1.0);
    armMesh.position.copy(corner).multiplyScalar(0.5);
    armMesh.lookAt(corner.clone().multiplyScalar(2));

    const ringMaterial = createAdditiveBasicMaterial({
      color: hdr(CYAN, 1.3),
      side: 2,
    });
    const ring = new Mesh(new RingGeometry(0.14, 0.17, 20), ringMaterial);
    ring.rotation.x = -Math.PI / 2;
    ring.position.copy(corner);
    ring.userData.spinSpeed = (corner.x * corner.z > 0 ? 1 : -1) * 6;
    group.add(ring);
    spinParts.push(ring);
    tintable(group).push({ material: ringMaterial, base: hdr(CYAN, 1.3), kind: 'edge' });
  }
  group.userData.spinParts = spinParts;

  // Bright cyan eye core.
  addCore(group, 0.12, CYAN, 1.9, 1.5, 0.3).position.set(0, 0, 0.3);

  // Magenta underglow strip.
  const stripMaterial = createAdditiveBasicMaterial({
    color: hdr(MAGENTA, 1.2),
    opacity: 0.7,
    side: 2,
  });
  const strip = new Mesh(new PlaneGeometry(0.5, 0.08), stripMaterial);
  strip.rotation.x = -Math.PI / 2;
  strip.position.set(0, -0.24, 0);
  group.add(strip);
  tintable(group).push({ material: stripMaterial, base: hdr(MAGENTA, 1.2), kind: 'core' });

  group.userData.accent = CYAN.clone();
  group.userData.debrisSpecs = [
    { direction: new Vector3(0.5, 0.2, 0.5).normalize(), color: CYAN.clone(), size: 0.4 },
    { direction: new Vector3(-0.5, 0.2, 0.5).normalize(), color: CYAN.clone(), size: 0.4 },
    { direction: new Vector3(0.5, 0.2, -0.5).normalize(), color: CYAN.clone(), size: 0.4 },
    { direction: new Vector3(0, -0.6, 0.2).normalize(), color: MAGENTA.clone(), size: 0.3 },
  ];
  group.userData.lockRingScale = 0.9;
  return group;
}

// ---- skimmer: a courier bike / signage dart ---------------------------------

export function createSkimmerMesh() {
  const group = new Group();

  // Long thin wedge.
  const body = new OctahedronGeometry(0.5, 0);
  body.scale(0.5, 0.4, 3.0);
  addFacetMesh(group, body, SLATE.clone().multiplyScalar(0.55), MAGENTA, 1.2);

  // Hot magenta-white core at the nose.
  const noseColor = MAGENTA.clone().lerp(new Color(1, 1, 1), 0.5);
  addCore(group, 0.13, noseColor, 2.0, 1.5, 0.32).position.set(0, 0, 1.35);

  // Two short trailing spray fins with additive translucent rain-wake planes.
  const wakeMaterial = createAdditiveBasicMaterial({
    color: hdr(MAGENTA, 0.9),
    opacity: 0.4,
    side: 2,
  });
  for (const side of [-1, 1]) {
    const fin = new Mesh(new PlaneGeometry(0.45, 0.6), wakeMaterial);
    fin.position.set(side * 0.28, 0, -1.5);
    fin.rotation.set(-Math.PI / 2, 0, side * 0.4);
    group.add(fin);
  }
  tintable(group).push({ material: wakeMaterial, base: hdr(MAGENTA, 0.9), kind: 'core' });

  group.userData.accent = MAGENTA.clone();
  group.userData.debrisSpecs = [
    { direction: new Vector3(0, 0, 1), color: noseColor.clone(), size: 0.5 },
    { direction: new Vector3(0.6, 0.3, -0.7).normalize(), color: MAGENTA.clone(), size: 0.4 },
    { direction: new Vector3(-0.6, 0.3, -0.7).normalize(), color: MAGENTA.clone(), size: 0.4 },
    { direction: new Vector3(0, -0.5, -0.8).normalize(), color: MAGENTA.clone(), size: 0.35 },
  ];
  group.userData.lockRingScale = 0.9;
  return group;
}

// ---- sentry: a security turret pod ------------------------------------------

export function createSentryMesh() {
  const group = new Group();

  // Squat hexagonal drum.
  const drum = new CylinderGeometry(0.85, 0.85, 0.9, 6);
  addFacetMesh(group, drum, SLATE.clone().multiplyScalar(0.6), HAZARD, 1.15);

  // Hazard strobe ring around the waist.
  const strobeParts: MeshBasicMaterial[] = [];
  const strobeMaterial = createAdditiveBasicMaterial({
    color: hdr(HAZARD, 1.3),
    side: 2,
  });
  const strobe = new Mesh(new TorusGeometry(0.9, 0.05, 8, 24), strobeMaterial);
  strobe.rotation.x = Math.PI / 2;
  group.add(strobe);
  tintable(group).push({ material: strobeMaterial, base: hdr(HAZARD, 1.3), kind: 'edge' });
  strobeParts.push(strobeMaterial);
  group.userData.strobeParts = strobeParts;

  // Small hot white muzzle core facing +z.
  addCore(group, 0.12, HAZARD, 2.0, 1.4, 0.3).position.set(0, 0, 0.85);

  group.userData.accent = HAZARD.clone();
  group.userData.debrisSpecs = [
    { direction: new Vector3(1, 0.3, 0).normalize(), color: HAZARD.clone(), size: 0.6 },
    { direction: new Vector3(-1, 0.3, 0).normalize(), color: HAZARD.clone(), size: 0.6 },
    { direction: new Vector3(0, 0.8, 0.4).normalize(), color: HAZARD.clone(), size: 0.5 },
    { direction: new Vector3(0, -0.7, 0.5).normalize(), color: SLATE.clone(), size: 0.4 },
  ];
  group.userData.lockRingScale = 1.2;
  return group;
}

// ---- enforcer: armored security wedge, amber reactor caged in slate plates ---

export function createEnforcerMesh() {
  const group = new Group();

  // Inner amber reactor column, hidden until the armor breaks.
  const coreMaterial = new MeshBasicMaterial({ color: hdr(AMBER, 1.0) });
  const core = new Mesh(new CylinderGeometry(0.6, 0.6, 2.5, 6), coreMaterial);
  const coreGlowMaterial = createAdditiveBasicMaterial({
    color: hdr(AMBER, 0.4),
    opacity: 0.24,
  });
  const coreGlow = new Mesh(new CylinderGeometry(0.9, 0.9, 2.7, 6), coreGlowMaterial);
  core.add(coreGlow);
  group.add(core);
  tintable(group).push(
    { material: coreMaterial, base: hdr(AMBER, 1.0), kind: 'core' },
    { material: coreGlowMaterial, base: hdr(AMBER, 0.4), kind: 'core' },
  );

  // Slate armor plates caged around the column; they shear off at the break.
  const armor = new Group();
  const debrisSpecs: DebrisSpec[] = [];
  const plateCount = 5;
  for (let i = 0; i < plateCount; i += 1) {
    const angle = (i / plateCount) * Math.PI * 2;
    const plateGroup = new Group();
    const plate = new BoxGeometry(0.9, 2.8, 0.28);
    const fill = addFacetMesh(group, plate, SLATE.clone().multiplyScalar(0.55), HAZARD, 1.0);
    fill.removeFromParent();
    plateGroup.add(fill);
    plateGroup.position.set(Math.cos(angle) * 1.15, 0, Math.sin(angle) * 1.15);
    plateGroup.rotation.y = -angle + Math.PI / 2;
    armor.add(plateGroup);
    debrisSpecs.push({
      direction: new Vector3(Math.cos(angle), 0.3, Math.sin(angle)).normalize(),
      color: HAZARD.clone(),
      size: 0.9,
    });
  }
  group.add(armor);
  group.userData.armor = armor;

  group.userData.accent = AMBER.clone();
  group.userData.debrisSpecs = [
    ...debrisSpecs,
    { direction: new Vector3(0, 1, 0), color: AMBER.clone(), size: 1.1 },
    { direction: new Vector3(0, -1, 0), color: AMBER.clone(), size: 1.1 },
  ];
  group.userData.lockRingScale = 1.7;
  return group;
}

// Armor break: slate plates shear off, the amber reactor burns exposed.
export function breakEnforcerArmor(group: Group) {
  const armor = group.userData.armor as Group | undefined;
  if (!armor || armor.visible === false) return;
  armor.visible = false;
  for (const part of (group.userData.parts as TintPart[])) {
    if (part.kind === 'core') part.base.multiplyScalar(2);
  }
}

// ---- tracer: a hostile homing bolt ------------------------------------------

export function createTracerMesh() {
  const group = new Group();
  const dart = new OctahedronGeometry(0.32, 0);
  dart.scale(0.5, 0.5, 2.3);
  const coreMaterial = new MeshBasicMaterial({ color: hdr(HAZARD, 2.6) });
  const coreMesh = new Mesh(dart, coreMaterial);
  const shellMaterial = createAdditiveBasicMaterial({
    color: hdr(MAGENTA, 1.0),
    opacity: 0.5,
  });
  const shellGeometry = new OctahedronGeometry(0.5, 0);
  shellGeometry.scale(0.55, 0.55, 2.0);
  const shell = new Mesh(shellGeometry, shellMaterial);
  group.add(coreMesh, shell);
  tintable(group).push(
    { material: coreMaterial, base: hdr(HAZARD, 2.6), kind: 'core' },
    { material: shellMaterial, base: hdr(MAGENTA, 1.0), kind: 'core' },
  );
  group.userData.accent = MAGENTA.clone();
  group.userData.isHostileShot = true;
  group.userData.trailColor = MAGENTA.clone().multiplyScalar(0.8);
  group.userData.debrisSpecs = [
    { direction: new Vector3(0, 0, 1), color: MAGENTA.clone(), size: 0.35 },
    { direction: new Vector3(0, 0, -1), color: MAGENTA.clone(), size: 0.35 },
  ];
  group.userData.lockRingScale = 0.75;
  return group;
}

// ---- gunship: the only acid-green thing in the level ------------------------

export function createGunshipMesh() {
  const group = new Group();

  // Broad ink-black hull wedge.
  const hull = new OctahedronGeometry(2.0, 0);
  hull.scale(1.75, 0.45, 1.2);
  addFacetMesh(group, hull, INK.clone().multiplyScalar(1.3), ACID, 1.1);

  // Two stub wings with weapon pods (blown off at stage 0).
  const pods = new Group();
  for (const side of [-1, 1]) {
    const wing = new BoxGeometry(1.4, 0.18, 0.9);
    const wingMesh = addFacetMesh(group, wing, SLATE.clone().multiplyScalar(0.5), ACID, 1.0);
    wingMesh.position.set(side * 2.6, -0.1, 0);

    const podGroup = new Group();
    const pod = new BoxGeometry(0.5, 0.5, 1.0);
    const podFill = addFacetMesh(group, pod, INK.clone().multiplyScalar(1.4), ACID, 1.2);
    podFill.removeFromParent();
    podGroup.add(podFill);
    podGroup.position.set(side * 3.2, -0.12, 0.2);
    pods.add(podGroup);
  }
  group.add(pods);
  group.userData.pods = pods;

  // Belly armor plates (blown off at stage 1).
  const armor = new Group();
  for (let i = 0; i < 4; i += 1) {
    const plateGroup = new Group();
    const plate = new BoxGeometry(1.0, 0.16, 0.7);
    const plateFill = addFacetMesh(group, plate, SLATE.clone().multiplyScalar(0.5), ACID, 0.95);
    plateFill.removeFromParent();
    plateGroup.add(plateFill);
    plateGroup.position.set((i - 1.5) * 1.05, -0.42, 0);
    armor.add(plateGroup);
  }
  group.add(armor);
  group.userData.armor = armor;

  // Spinning main rotor disc on top: thin additive acid ring.
  const spinParts: Mesh[] = [];
  const rotorMaterial = createAdditiveBasicMaterial({
    color: hdr(ACID, 1.35),
    side: 2,
  });
  const rotor = new Mesh(new RingGeometry(1.4, 1.5, 48), rotorMaterial);
  rotor.rotation.x = -Math.PI / 2;
  rotor.position.y = 0.55;
  rotor.userData.spinSpeed = 5;
  group.add(rotor);
  spinParts.push(rotor);
  tintable(group).push({ material: rotorMaterial, base: hdr(ACID, 1.35), kind: 'edge' });
  group.userData.spinParts = spinParts;

  // Acid running lights along the hull edges.
  const lightMaterial = createAdditiveBasicMaterial({
    color: hdr(ACID, 1.4),
    side: 2,
  });
  for (const side of [-1, 1]) {
    const strip = new Mesh(new BoxGeometry(3.4, 0.04, 0.04), lightMaterial);
    strip.position.set(0, 0.05, side * 0.9);
    group.add(strip);
  }
  tintable(group).push({ material: lightMaterial, base: hdr(ACID, 1.4), kind: 'edge' });

  // Small acid sensor-eye core.
  addCore(group, 0.2, ACID, 1.8, 1.5, 0.3).position.set(0, 0, 1.7);

  group.userData.accent = ACID.clone();
  group.userData.debrisSpecs = [
    { direction: new Vector3(1, 0.2, 0.3).normalize(), color: ACID.clone(), size: 1.2 },
    { direction: new Vector3(-1, 0.2, 0.3).normalize(), color: ACID.clone(), size: 1.2 },
    { direction: new Vector3(1, 0.2, -0.3).normalize(), color: ACID.clone(), size: 1.0 },
    { direction: new Vector3(-1, 0.2, -0.3).normalize(), color: ACID.clone(), size: 1.0 },
    { direction: new Vector3(0, 1, 0), color: ACID.clone(), size: 1.4 },
    { direction: new Vector3(0, -1, 0), color: SLATE.clone(), size: 1.0 },
    { direction: new Vector3(0, 0.4, 1).normalize(), color: ACID.clone(), size: 0.9 },
    { direction: new Vector3(0, 0.4, -1).normalize(), color: ACID.clone(), size: 0.9 },
    { direction: new Vector3(0.7, -0.4, 0.6).normalize(), color: SLATE.clone(), size: 0.8 },
    { direction: new Vector3(-0.7, -0.4, 0.6).normalize(), color: SLATE.clone(), size: 0.8 },
    { direction: new Vector3(0.5, 0.6, -0.6).normalize(), color: ACID.clone(), size: 0.9 },
    { direction: new Vector3(-0.5, 0.6, -0.6).normalize(), color: ACID.clone(), size: 0.9 },
  ];
  group.userData.lockRingScale = 2.6;
  return group;
}

// Stage breaks: pods blow off first, then belly armor exposes the core.
export function breakGunshipStage(group: Group, stageIndex: number) {
  if (stageIndex === 0) {
    const pods = group.userData.pods as Group | undefined;
    if (pods) pods.visible = false;
    return;
  }
  if (stageIndex === 1) {
    const armor = group.userData.armor as Group | undefined;
    if (armor && armor.visible !== false) {
      armor.visible = false;
      for (const part of (group.userData.parts as TintPart[])) {
        if (part.kind === 'core') part.base.multiplyScalar(1.8);
      }
    }
  }
}
