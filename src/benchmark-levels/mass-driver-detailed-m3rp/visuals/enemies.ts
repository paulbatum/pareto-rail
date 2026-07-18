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
  TorusGeometry,
  Vector3,
} from 'three';
import { additiveMaterialParameters, createAdditiveBasicMaterial } from '../../../engine/visual-kit';
import { ARC_BLUE, GUNMETAL, HAZARD, hdr, ION_WHITE, VOLT_VIOLET } from './palette';
import type { SparkSpec } from './effects';

// Every hostile is machined from the same facet vocabulary — gunmetal fills,
// thin bright edges, one small hot core with a glow shell — so a single tint
// pass drives every state (closing brightness, ion-white lock, hazard-red
// denial, blinding hit flash) and everything stays readable with the player's
// bloom slider at zero. Silhouette and motion carry identity:
//   coil       — hexagonal wall pod with a ring-lens eye and two clamp hooks.
//   threader   — a stretched needle with swept tail fins and an ion-tail.
//   capacitor  — a fat insulated bank whose six staves shear off.
//   arc        — ball lightning: a hot core in per-frame jittering wire shells.
//   interlock  — the hazard-striped X-clamp jamming the safety ring (boss ×6).

export type TintKind = 'edge' | 'fill' | 'core';
export type TintPart = { material: MeshBasicMaterial | LineBasicMaterial; base: Color; kind: TintKind };

type FacetGeometry = OctahedronGeometry | BoxGeometry | CylinderGeometry | ConeGeometry | IcosahedronGeometry | TorusGeometry;

function tintable(group: Group): TintPart[] {
  return (group.userData.parts ??= []) as TintPart[];
}

function addFacet(group: Group, geometry: FacetGeometry, fillColor: Color, edgeColor: Color, edgeIntensity: number) {
  const fillMaterial = new MeshBasicMaterial({ color: fillColor.clone() });
  const fill = new Mesh(geometry, fillMaterial);
  const edgeMaterial = new LineBasicMaterial(additiveMaterialParameters({ color: hdr(edgeColor, edgeIntensity) }));
  fill.add(new LineSegments(new EdgesGeometry(geometry), edgeMaterial));
  group.add(fill);
  tintable(group).push(
    { material: fillMaterial, base: fillColor.clone(), kind: 'fill' },
    { material: edgeMaterial, base: hdr(edgeColor, edgeIntensity), kind: 'edge' },
  );
  return fill;
}

function addCore(group: Group, radius: number, color: Color, intensity: number, glowScale = 1.6, glowOpacity = 0.28) {
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

export function createCoilMesh() {
  const group = new Group();

  // Hex housing with its flat face toward the bore.
  const hex = new CylinderGeometry(1.12, 1.26, 0.72, 6);
  hex.rotateX(Math.PI / 2);
  addFacet(group, hex, GUNMETAL.clone(), ARC_BLUE, 1.15);

  // The ring-lens eye: an arc-blue torus around a small hot pupil. The pupil is
  // registered separately so the firing telegraph can run it hot.
  const lensMaterial = createAdditiveBasicMaterial({ color: hdr(ARC_BLUE, 1.3) });
  const lens = new Mesh(new TorusGeometry(0.44, 0.07, 6, 24), lensMaterial);
  lens.position.z = 0.44;
  group.add(lens);
  tintable(group).push({ material: lensMaterial, base: hdr(ARC_BLUE, 1.3), kind: 'edge' });
  const pupil = addCore(group, 0.2, ARC_BLUE, 1.6, 1.8, 0.32);
  pupil.position.z = 0.48;
  group.userData.eye = pupil;

  // Two violet-edged clamp hooks gripping the wall behind the pod.
  const sparkSpecs: SparkSpec[] = [];
  for (const side of [-1, 1]) {
    const hook = addFacet(group, new BoxGeometry(0.32, 1.85, 0.52), GUNMETAL.clone().multiplyScalar(0.8), VOLT_VIOLET, 0.9);
    hook.position.set(side * 1.12, 0, -0.35);
    hook.rotation.z = side * 0.2;
    sparkSpecs.push({ direction: new Vector3(side, 0.2, 0).normalize(), color: ARC_BLUE.clone(), size: 0.7 });
  }

  // The emitter nub it looses arc bolts from.
  const nub = new ConeGeometry(0.22, 0.66, 6);
  nub.rotateX(Math.PI / 2);
  addFacet(group, nub, GUNMETAL.clone(), ARC_BLUE, 1.3).position.z = 0.74;

  for (let i = 0; i < 6; i += 1) {
    const angle = (i / 6) * Math.PI * 2;
    sparkSpecs.push({ direction: new Vector3(Math.cos(angle), Math.sin(angle), 0.3).normalize(), color: ARC_BLUE.clone(), size: 0.5 });
  }
  group.userData.accent = ARC_BLUE.clone();
  group.userData.sparkSpecs = sparkSpecs;
  group.userData.lockRingScale = 1.35;
  return group;
}

// ---- threader: a corkscrewing needle drone -----------------------------------

export function createThreaderMesh() {
  const group = new Group();

  // The long stretched nose along +z.
  const nose = new OctahedronGeometry(0.42, 0);
  nose.scale(0.58, 0.58, 4.6);
  addFacet(group, nose, GUNMETAL.clone(), VOLT_VIOLET, 1.35);
  addCore(group, 0.17, ION_WHITE, 1.7, 1.5, 0.32).position.z = 1.25;

  // Three swept tail fins so the corkscrew reads as a spin, not a slide.
  const sparkSpecs: SparkSpec[] = [];
  for (let i = 0; i < 3; i += 1) {
    const angle = (i / 3) * Math.PI * 2 + 0.5;
    const blade = addFacet(group, new BoxGeometry(0.07, 0.98, 1.15), GUNMETAL.clone().multiplyScalar(0.9), ARC_BLUE, 1.1);
    blade.position.set(Math.cos(angle) * 0.5, Math.sin(angle) * 0.5, -1.35);
    blade.rotation.z = angle;
    blade.rotation.x = -0.32;
    sparkSpecs.push({ direction: new Vector3(Math.cos(angle), Math.sin(angle), -0.4).normalize(), color: VOLT_VIOLET.clone(), size: 0.5 });
  }

  // The translucent violet ion-tail.
  const tailMaterial = createAdditiveBasicMaterial({ color: hdr(VOLT_VIOLET, 1.1), opacity: 0.65, side: 2 });
  const tail = new Mesh(new ConeGeometry(0.32, 3.6, 7, 1, true), tailMaterial);
  tail.rotation.x = Math.PI / 2;
  tail.position.z = -2.8;
  group.add(tail);
  tintable(group).push({ material: tailMaterial, base: hdr(VOLT_VIOLET, 1.1), kind: 'core' });

  sparkSpecs.push({ direction: new Vector3(0, 0, 1), color: ION_WHITE.clone(), size: 0.6 });
  group.userData.accent = VOLT_VIOLET.clone();
  group.userData.sparkSpecs = sparkSpecs;
  group.userData.lockRingScale = 1.0;
  return group;
}

// ---- capacitor: a two-stage insulated bank -----------------------------------

export function createCapacitorMesh() {
  const group = new Group();

  // The hot violet core cylinder, exposed once the staves shear off.
  const coreMaterial = new MeshBasicMaterial({ color: hdr(VOLT_VIOLET, 0.85) });
  const core = new Mesh(new CylinderGeometry(0.6, 0.6, 2.6, 10), coreMaterial);
  core.rotation.x = Math.PI / 2;
  const coreGlowMaterial = createAdditiveBasicMaterial({ color: hdr(VOLT_VIOLET, 0.4), opacity: 0.24 });
  core.add(new Mesh(new CylinderGeometry(0.88, 0.88, 2.7, 10), coreGlowMaterial));
  group.add(core);
  tintable(group).push(
    { material: coreMaterial, base: hdr(VOLT_VIOLET, 0.85), kind: 'core' },
    { material: coreGlowMaterial, base: hdr(VOLT_VIOLET, 0.4), kind: 'core' },
  );

  // Six gunmetal insulator staves caged around the core (stage-1 armor).
  const armor = new Group();
  const sparkSpecs: SparkSpec[] = [];
  for (let i = 0; i < 6; i += 1) {
    const angle = (i / 6) * Math.PI * 2;
    const stave = addFacet(group, new BoxGeometry(0.48, 0.48, 2.95), GUNMETAL.clone(), ARC_BLUE, 0.95);
    stave.removeFromParent();
    stave.position.set(Math.cos(angle) * 0.98, Math.sin(angle) * 0.98, 0);
    stave.rotation.z = angle;
    armor.add(stave);
    sparkSpecs.push({ direction: new Vector3(Math.cos(angle), Math.sin(angle), 0.2).normalize(), color: ARC_BLUE.clone(), size: 1.0 });
  }
  group.add(armor);
  group.userData.armor = armor;

  // Ribbed end caps at both ends of the bank.
  for (const z of [1.55, -1.55]) {
    const cap = new CylinderGeometry(1.12, 0.88, 0.52, 8);
    cap.rotateX(Math.PI / 2);
    addFacet(group, cap, GUNMETAL.clone().multiplyScalar(0.9), ARC_BLUE, 1.1).position.z = z;
    const rib = new TorusGeometry(1.0, 0.06, 5, 16);
    addFacet(group, rib, GUNMETAL.clone().multiplyScalar(1.1), VOLT_VIOLET, 0.8).position.z = z * 0.78;
  }

  sparkSpecs.push(
    { direction: new Vector3(0, 0, 1), color: VOLT_VIOLET.clone(), size: 1.1 },
    { direction: new Vector3(0, 0, -1), color: VOLT_VIOLET.clone(), size: 1.1 },
  );
  group.userData.accent = VOLT_VIOLET.clone();
  group.userData.sparkSpecs = sparkSpecs;
  group.userData.lockRingScale = 1.7;
  return group;
}

// Stage break: the staves shear off in a burst and the exposed core runs hotter.
export function breakCapacitorArmor(group: Group) {
  const armor = group.userData.armor as Group | undefined;
  if (!armor || armor.visible === false) return;
  armor.visible = false;
  for (const part of group.userData.parts as TintPart[]) {
    if (part.kind === 'core') part.base.multiplyScalar(2.1);
  }
}

// ---- arc: ball lightning (an interceptable hostile bolt) ---------------------

export function createArcMesh() {
  const group = new Group();
  addCore(group, 0.4, ION_WHITE, 2.3, 1.7, 0.42);

  // Two jagged wire shells re-randomized every frame — the unstable tell that
  // this is incoming, not something to be leisurely admired.
  const shells: Mesh[] = [];
  for (const [radius, color, intensity] of [
    [0.7, ARC_BLUE, 1.5],
    [0.95, VOLT_VIOLET, 1.2],
  ] as const) {
    const shellMaterial = new LineBasicMaterial(additiveMaterialParameters({ color: hdr(color, intensity) }));
    const shell = new LineSegments(new EdgesGeometry(new IcosahedronGeometry(radius, 0)), shellMaterial);
    group.add(shell);
    shells.push(shell as unknown as Mesh);
    tintable(group).push({ material: shellMaterial, base: hdr(color, intensity), kind: 'edge' });
  }

  group.userData.accent = ARC_BLUE.clone();
  group.userData.arcShells = shells;
  group.userData.isHostileShot = true;
  group.userData.trailColor = ARC_BLUE.clone().multiplyScalar(0.85);
  group.userData.sparkSpecs = [
    { direction: new Vector3(1, 0.2, 0).normalize(), color: ARC_BLUE.clone(), size: 0.5 },
    { direction: new Vector3(-1, 0.2, 0).normalize(), color: ARC_BLUE.clone(), size: 0.5 },
    { direction: new Vector3(0, -1, 0.3).normalize(), color: ION_WHITE.clone(), size: 0.5 },
  ] satisfies SparkSpec[];
  group.userData.lockRingScale = 0.95;
  return group;
}

// ---- interlock: the jammed safety clamp (boss ×6) ----------------------------

export function createInterlockMesh() {
  const group = new Group();

  // Two crossed gunmetal braces banded with amber hazard chevrons.
  const sparkSpecs: SparkSpec[] = [];
  for (const rot of [Math.PI * 0.25, -Math.PI * 0.25]) {
    const arm = addFacet(group, new BoxGeometry(5.6, 0.92, 0.92), GUNMETAL.clone(), HAZARD, 1.1);
    arm.rotation.z = rot;
    for (let s = -2; s <= 2; s += 1) {
      if (s === 0) continue;
      const stripeMaterial = new MeshBasicMaterial({ color: hdr(HAZARD, 0.9) });
      const chevron = new Mesh(new BoxGeometry(0.4, 0.99, 0.99), stripeMaterial);
      chevron.position.x = s * 1.05;
      chevron.rotation.x = 0.12 * Math.sign(s);
      arm.add(chevron);
      tintable(group).push({ material: stripeMaterial, base: hdr(HAZARD, 0.9), kind: 'edge' });
    }
    sparkSpecs.push(
      { direction: new Vector3(Math.cos(rot), Math.sin(rot), 0).normalize(), color: HAZARD.clone(), size: 1.3 },
      { direction: new Vector3(-Math.cos(rot), -Math.sin(rot), 0).normalize(), color: HAZARD.clone(), size: 1.3 },
    );
  }

  // The central cowl hiding an ion-white actuator core. One hit pops the cowl.
  addCore(group, 0.7, ION_WHITE, 1.35, 1.5, 0.3);
  const cowl = new Group();
  const cowlShell = new CylinderGeometry(1.45, 1.45, 1.45, 8);
  cowlShell.rotateX(Math.PI / 2);
  const cowlMesh = addFacet(group, cowlShell, GUNMETAL.clone().multiplyScalar(1.05), HAZARD, 1.25);
  cowlMesh.removeFromParent();
  cowl.add(cowlMesh);
  group.add(cowl);
  group.userData.armor = cowl;

  for (let i = 0; i < 8; i += 1) {
    const angle = (i / 8) * Math.PI * 2;
    sparkSpecs.push({ direction: new Vector3(Math.cos(angle), Math.sin(angle), 0.2).normalize(), color: HAZARD.clone(), size: 0.9 });
  }
  group.userData.accent = HAZARD.clone();
  group.userData.sparkSpecs = sparkSpecs;
  group.userData.lockRingScale = 2.4;
  group.userData.isInterlock = true;
  return group;
}

// Cowl pop: the hazard shell shears away; the hot actuator core is exposed.
export function breakInterlockCowl(group: Group) {
  const cowl = group.userData.armor as Group | undefined;
  if (!cowl || cowl.visible === false) return;
  cowl.visible = false;
  for (const part of group.userData.parts as TintPart[]) {
    if (part.kind === 'core') part.base.multiplyScalar(1.6);
  }
}
