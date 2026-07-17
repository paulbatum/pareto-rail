import {
  BoxGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  EdgesGeometry,
  Group,
  IcosahedronGeometry,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  OctahedronGeometry,
  TetrahedronGeometry,
  TorusGeometry,
  Vector3,
} from 'three';
import { additiveMaterialParameters, createAdditiveBasicMaterial } from '../../../engine/visual-kit';
import { ARC_BLUE, GUNMETAL, HAZARD_AMBER, hdr, ION_WHITE, VOLT_VIOLET } from './palette';
import type { SparkSpec } from './effects';

// Every hostile is machined from the same cold gunmetal, lit by thin electric
// edges and a small hot core, so silhouette and motion carry identity and
// everything stays readable with the glow dialed down. A single tint pass
// (visuals/index.ts) drives every state off the `parts` list.

export type TintKind = 'edge' | 'fill' | 'core';
export type TintPart = { material: MeshBasicMaterial | LineBasicMaterial; base: Color; kind: TintKind };

function tintable(group: Group): TintPart[] {
  return (group.userData.parts ??= []) as TintPart[];
}

type FacetGeometry = OctahedronGeometry | TetrahedronGeometry | BoxGeometry | CylinderGeometry | ConeGeometry;

function addFacetMesh(group: Group, geometry: FacetGeometry, fill: Color, edge: Color, edgeIntensity: number) {
  const fillMaterial = new MeshBasicMaterial({ color: fill.clone() });
  const mesh = new Mesh(geometry, fillMaterial);
  const edgeMaterial = new LineBasicMaterial(additiveMaterialParameters({ color: hdr(edge, edgeIntensity) }));
  mesh.add(new LineSegments(new EdgesGeometry(geometry), edgeMaterial));
  group.add(mesh);
  tintable(group).push(
    { material: fillMaterial, base: fill.clone(), kind: 'fill' },
    { material: edgeMaterial, base: hdr(edge, edgeIntensity), kind: 'edge' },
  );
  return mesh;
}

function addCore(group: Group, radius: number, color: Color, intensity: number, glowScale = 1.6, glowOpacity = 0.26) {
  const coreMaterial = new MeshBasicMaterial({ color: hdr(color, intensity) });
  const core = new Mesh(new OctahedronGeometry(radius, 1), coreMaterial);
  const glowMaterial = createAdditiveBasicMaterial({ color: hdr(color, intensity * 0.4), opacity: glowOpacity });
  core.add(new Mesh(new OctahedronGeometry(radius * glowScale, 1), glowMaterial));
  group.add(core);
  tintable(group).push(
    { material: coreMaterial, base: hdr(color, intensity), kind: 'core' },
    { material: glowMaterial, base: hdr(color, intensity * 0.4), kind: 'core' },
  );
  return core;
}

// ---- coil: a wall-riding hexagonal maintenance pod ---------------------------

// Hex pod, arc-blue ring-lens eye, two violet-edged clamp hooks gripping the
// wall behind it, and a small emitter nub. Built facing +z (lookAt aims +z at
// the bore axis, so the eye faces inward and the hooks reach back to the wall).
export function createCoilMesh() {
  const group = new Group();

  const pod = new CylinderGeometry(0.92, 0.92, 0.55, 6);
  pod.rotateX(Math.PI / 2);
  addFacetMesh(group, pod, GUNMETAL.clone().multiplyScalar(1.1), ARC_BLUE, 1.05);

  // Ring-lens eye, facing the bore.
  const lensMaterial = createAdditiveBasicMaterial({ color: hdr(ARC_BLUE, 1.5) });
  const lens = new Mesh(new TorusGeometry(0.4, 0.06, 6, 24), lensMaterial);
  lens.position.z = 0.34;
  group.add(lens);
  tintable(group).push({ material: lensMaterial, base: hdr(ARC_BLUE, 1.5), kind: 'edge' });
  addCore(group, 0.16, ION_WHITE, 1.8, 1.5, 0.3).position.z = 0.36;

  // Clamp hooks reaching back toward the wall.
  for (const side of [-1, 1]) {
    const hook = new BoxGeometry(0.22, 0.5, 0.9);
    const mesh = addFacetMesh(group, hook, GUNMETAL.clone().multiplyScalar(0.9), VOLT_VIOLET, 1.1);
    mesh.position.set(side * 0.72, 0, -0.55);
    mesh.rotation.x = -0.5;
    mesh.rotation.z = side * 0.2;
  }

  // Emitter nub.
  const nub = new ConeGeometry(0.16, 0.4, 6);
  nub.rotateX(Math.PI / 2);
  const nubMesh = addFacetMesh(group, nub, GUNMETAL.clone().multiplyScalar(1.3), ARC_BLUE, 1.3);
  nubMesh.position.set(0, -0.62, 0.2);

  group.userData.accent = ARC_BLUE.clone();
  group.userData.shardSpecs = hexShards(ARC_BLUE, 0.55);
  group.userData.lockRingScale = 1.0;
  return group;
}

// ---- threader: a needle drone corkscrewing through the bore ------------------

export function createThreaderMesh() {
  const group = new Group();

  // Long stretched nose, pointing +z (lookAt orients travel along +z).
  const nose = new OctahedronGeometry(0.32, 0);
  nose.scale(0.62, 0.62, 4.4);
  addFacetMesh(group, nose, GUNMETAL.clone().multiplyScalar(1.15), VOLT_VIOLET, 1.15);

  // Ion-white hot core near the tip.
  addCore(group, 0.14, ION_WHITE, 2.0, 1.5, 0.3).position.z = 0.85;

  // Three swept tail fins.
  for (let i = 0; i < 3; i += 1) {
    const angle = (i / 3) * Math.PI * 2 + Math.PI / 6;
    const fin = new TetrahedronGeometry(0.5, 0);
    fin.scale(0.4, 0.22, 1.7);
    const mesh = addFacetMesh(group, fin, GUNMETAL.clone().multiplyScalar(0.9), ARC_BLUE, 1.2);
    mesh.position.set(Math.cos(angle) * 0.42, Math.sin(angle) * 0.42, -1.0);
    mesh.rotation.z = angle;
    mesh.rotation.x = -0.28;
  }

  // Translucent violet ion-tail.
  const tailMaterial = createAdditiveBasicMaterial({ color: hdr(VOLT_VIOLET, 1.1), opacity: 0.6, side: 2 });
  const tail = new Mesh(new CylinderGeometry(0.015, 0.34, 3.6, 7, 1, true), tailMaterial);
  tail.rotation.x = Math.PI / 2;
  tail.position.z = -2.4;
  group.add(tail);
  tintable(group).push({ material: tailMaterial, base: hdr(VOLT_VIOLET, 1.1), kind: 'core' });

  group.userData.accent = VOLT_VIOLET.clone();
  group.userData.shardSpecs = [
    { direction: new Vector3(0, 0, 1), color: ION_WHITE.clone(), size: 0.5 },
    { direction: new Vector3(0.6, 0.5, -0.6).normalize(), color: VOLT_VIOLET.clone(), size: 0.45 },
    { direction: new Vector3(-0.6, 0.4, -0.6).normalize(), color: VOLT_VIOLET.clone(), size: 0.45 },
    { direction: new Vector3(0, -0.7, -0.7).normalize(), color: ARC_BLUE.clone(), size: 0.4 },
  ] satisfies SparkSpec[];
  group.userData.lockRingScale = 1.0;
  return group;
}

// ---- capacitor: a fat two-stage insulated bank -------------------------------

export function createCapacitorMesh() {
  const group = new Group();

  // Hot violet core cylinder, hidden behind the staves until the break.
  const coreMaterial = new MeshBasicMaterial({ color: hdr(VOLT_VIOLET, 1.1) });
  const core = new Mesh(new CylinderGeometry(0.62, 0.62, 2.3, 8), coreMaterial);
  const coreGlowMaterial = createAdditiveBasicMaterial({ color: hdr(VOLT_VIOLET, 0.45), opacity: 0.25 });
  core.add(new Mesh(new CylinderGeometry(0.92, 0.92, 2.4, 8), coreGlowMaterial));
  group.add(core);
  tintable(group).push(
    { material: coreMaterial, base: hdr(VOLT_VIOLET, 1.1), kind: 'core' },
    { material: coreGlowMaterial, base: hdr(VOLT_VIOLET, 0.45), kind: 'core' },
  );

  // Six gunmetal insulator staves caged around the core.
  const staves = new Group();
  const shardSpecs: SparkSpec[] = [];
  for (let i = 0; i < 6; i += 1) {
    const angle = (i / 6) * Math.PI * 2;
    const stave = new BoxGeometry(0.55, 2.6, 0.28);
    const mesh = addFacetMesh(group, stave, GUNMETAL.clone().multiplyScalar(1.0), ARC_BLUE, 0.95);
    mesh.removeFromParent();
    mesh.position.set(Math.cos(angle) * 1.12, 0, Math.sin(angle) * 1.12);
    mesh.rotation.y = -angle + Math.PI / 2;
    staves.add(mesh);
    // The stage break shears the staves off in a burst along the six stave directions.
    shardSpecs.push({
      direction: new Vector3(Math.cos(angle), 0.25, Math.sin(angle)).normalize(),
      color: ARC_BLUE.clone(),
      size: 0.85,
    });
  }
  group.add(staves);
  group.userData.staves = staves;
  group.userData.staveSpecs = shardSpecs;

  // Ribbed end caps.
  for (const y of [1.5, -1.5]) {
    const cap = addFacetMesh(
      group,
      new CylinderGeometry(1.28, 1.05, 0.5, 6),
      GUNMETAL.clone().multiplyScalar(1.2),
      VOLT_VIOLET,
      1.05,
    );
    cap.position.y = y;
    if (y < 0) cap.rotation.z = Math.PI;
  }

  group.userData.accent = VOLT_VIOLET.clone();
  group.userData.shardSpecs = [
    ...shardSpecs,
    { direction: new Vector3(0, 1, 0), color: VOLT_VIOLET.clone(), size: 1.1 },
    { direction: new Vector3(0, -1, 0), color: VOLT_VIOLET.clone(), size: 1.1 },
  ];
  group.userData.lockRingScale = 1.7;
  return group;
}

/** Stage break: the staves shear off and the naked core brightens. */
export function breakCapacitorStaves(group: Group) {
  const staves = group.userData.staves as Group | undefined;
  if (!staves || staves.visible === false) return;
  staves.visible = false;
  for (const part of group.userData.parts as TintPart[]) {
    if (part.kind === 'core') part.base.multiplyScalar(2.1);
  }
}

// ---- arc: ball lightning ------------------------------------------------------

// An ion-white hot core inside two jagged wire shells that re-randomize their
// rotation and scale every frame — the unstable "this is incoming" tell.
export function createArcMesh() {
  const group = new Group();
  addCore(group, 0.3, ION_WHITE, 2.4, 1.8, 0.4);

  const shells = new Group();
  for (const radius of [0.6, 0.85]) {
    const wireMaterial = new LineBasicMaterial(additiveMaterialParameters({ color: hdr(ARC_BLUE, 1.7) }));
    const shell = new LineSegments(new EdgesGeometry(new IcosahedronGeometry(radius, 0)), wireMaterial);
    shells.add(shell);
    tintable(group).push({ material: wireMaterial, base: hdr(ARC_BLUE, 1.7), kind: 'edge' });
  }
  group.add(shells);
  group.userData.jitterShells = shells;

  group.userData.accent = ARC_BLUE.clone();
  group.userData.isHostileShot = true;
  group.userData.trailColor = ARC_BLUE.clone().multiplyScalar(0.8);
  group.userData.shardSpecs = [
    { direction: new Vector3(0.8, 0.5, 0).normalize(), color: ARC_BLUE.clone(), size: 0.5 },
    { direction: new Vector3(-0.8, 0.4, 0.3).normalize(), color: ARC_BLUE.clone(), size: 0.5 },
    { direction: new Vector3(0, -0.7, -0.7).normalize(), color: ION_WHITE.clone(), size: 0.45 },
  ];
  group.userData.lockRingScale = 0.85;
  return group;
}

// ---- interlock: the hazard-striped X-clamp boss --------------------------------

// Two crossed gunmetal braces banded with amber hazard chevrons around a
// central cowl hiding an ion-white actuator core. Hazard amber is strictly
// reserved for these (and the charge warnings). Oversized on purpose.
export function createInterlockMesh() {
  const group = new Group();

  for (const tilt of [Math.PI / 4, -Math.PI / 4]) {
    const brace = new BoxGeometry(4.4, 0.78, 0.55);
    const mesh = addFacetMesh(group, brace, GUNMETAL.clone().multiplyScalar(1.25), HAZARD_AMBER, 0.9);
    mesh.rotation.z = tilt;
    // Hazard chevrons banded along the brace.
    for (let i = -2; i <= 2; i += 1) {
      if (i === 0) continue;
      const bandMaterial = createAdditiveBasicMaterial({
        color: hdr(HAZARD_AMBER, Math.abs(i) % 2 === 0 ? 0.85 : 0.55),
      });
      const band = new Mesh(new BoxGeometry(0.3, 0.8, 0.57), bandMaterial);
      band.position.x = i * 0.82;
      band.rotation.z = 0.5;
      mesh.add(band);
      tintable(group).push({ material: bandMaterial, base: bandMaterial.color.clone(), kind: 'edge' });
    }
  }

  // Ion-white actuator core, hidden by the cowl until the first hit pops it.
  addCore(group, 0.5, ION_WHITE, 2.0, 1.7, 0.35);
  const cowl = new Group();
  const cowlGeometry = new CylinderGeometry(0.95, 1.1, 0.8, 6);
  cowlGeometry.rotateX(Math.PI / 2);
  const cowlMesh = addFacetMesh(group, cowlGeometry, GUNMETAL.clone().multiplyScalar(1.5), HAZARD_AMBER, 1.15);
  cowlMesh.removeFromParent();
  cowl.add(cowlMesh);
  group.add(cowl);
  group.userData.cowl = cowl;

  group.scale.setScalar(1.9);
  group.userData.accent = HAZARD_AMBER.clone();
  group.userData.shardSpecs = [
    { direction: new Vector3(1, 1, 0).normalize(), color: HAZARD_AMBER.clone(), size: 1.2 },
    { direction: new Vector3(-1, 1, 0).normalize(), color: HAZARD_AMBER.clone(), size: 1.2 },
    { direction: new Vector3(1, -1, 0).normalize(), color: HAZARD_AMBER.clone(), size: 1.2 },
    { direction: new Vector3(-1, -1, 0).normalize(), color: HAZARD_AMBER.clone(), size: 1.2 },
    { direction: new Vector3(0, 0, 1), color: ION_WHITE.clone(), size: 0.9 },
    { direction: new Vector3(0, 0, -1), color: ION_WHITE.clone(), size: 0.9 },
  ];
  group.userData.lockRingScale = 2.5;
  return group;
}

/** First hit pops the cowl and exposes the actuator core. */
export function popInterlockCowl(group: Group) {
  const cowl = group.userData.cowl as Group | undefined;
  if (!cowl || cowl.visible === false) return;
  cowl.visible = false;
  for (const part of group.userData.parts as TintPart[]) {
    if (part.kind === 'core') part.base.multiplyScalar(2.0);
  }
}

function hexShards(color: Color, size: number): SparkSpec[] {
  const specs: SparkSpec[] = [];
  for (let i = 0; i < 6; i += 1) {
    const angle = (i / 6) * Math.PI * 2;
    specs.push({ direction: new Vector3(Math.cos(angle), Math.sin(angle), 0.3).normalize(), color: color.clone(), size });
  }
  return specs;
}
