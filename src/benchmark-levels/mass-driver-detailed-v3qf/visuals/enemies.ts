import {
  BoxGeometry,
  BufferGeometry,
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
  Vector3,
} from 'three';
import { additiveMaterialParameters, createAdditiveBasicMaterial } from '../../../engine/visual-kit';
import {
  ARC_BLUE,
  GUNMETAL,
  HAZARD,
  hdr,
  ION_WHITE,
  VOLT_VIOLET,
} from './palette';
import type { SparkSpec } from './effects';

// Defense drones threading the coils. Every hostile is machined from the same
// gunmetal, lit by thin electric edges and a small hot core, so all of them read
// with bloom at zero — silhouette and motion carry identity:
//   coil       — a hexagonal wall pod, clamped to the barrel, watching the bore.
//   threader   — a long needle that corkscrews between the coils.
//   capacitor  — a fat insulated bank whose armour staves shear off.
//   arc        — ball lightning: a hot core inside jittering jagged shells.
//   interlock  — a heavy hazard-striped X-clamp jamming the safety ring (boss).

export type TintKind = 'edge' | 'fill' | 'core';
export type TintPart = { material: MeshBasicMaterial | LineBasicMaterial; base: Color; kind: TintKind };

type FacetGeometry = OctahedronGeometry | BoxGeometry | CylinderGeometry | ConeGeometry | IcosahedronGeometry;

function tintable(group: Group): TintPart[] {
  return (group.userData.parts ??= []) as TintPart[];
}

function addFacet(
  group: Group,
  geometry: FacetGeometry,
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

function addCore(group: Group, radius: number, color: Color, intensity: number, glowScale = 1.6, glowOpacity = 0.28) {
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

// ---- coil: a hexagonal maintenance pod clamped to the barrel wall ------------

export function createCoilMesh() {
  const group = new Group();

  // Hex housing, flat face toward the bore. A short 6-sided prism reads as a
  // clear hexagon head-on and as a slab in profile.
  const hex = new CylinderGeometry(1.15, 1.28, 0.7, 6);
  hex.rotateX(Math.PI / 2); // flat face along +z, toward the bore
  addFacet(group, hex, GUNMETAL.clone(), ARC_BLUE, 1.15);

  // A ring lens set into the face — the coil's eye.
  addCore(group, 0.34, ARC_BLUE, 1.5, 1.7, 0.3).position.z = 0.42;

  // Two clamp hooks gripping the (implied) wall behind it.
  const sparkSpecs: SparkSpec[] = [];
  for (const side of [-1, 1]) {
    const clamp = new BoxGeometry(0.34, 1.9, 0.5);
    const hook = addFacet(group, clamp, GUNMETAL.clone().multiplyScalar(0.8), VOLT_VIOLET, 0.9);
    hook.position.set(side * 1.15, 0, -0.32);
    hook.rotation.z = side * 0.18;
    sparkSpecs.push({ direction: new Vector3(side, 0.2, 0).normalize(), color: ARC_BLUE.clone(), size: 0.7 });
  }

  // Emitter nub the coil fires its bolt from.
  const nub = new ConeGeometry(0.24, 0.7, 6);
  nub.rotateX(Math.PI / 2);
  addFacet(group, nub, GUNMETAL.clone(), ARC_BLUE, 1.3).position.z = 0.7;

  for (let i = 0; i < 6; i += 1) {
    const angle = (i / 6) * Math.PI * 2;
    sparkSpecs.push({ direction: new Vector3(Math.cos(angle), Math.sin(angle), 0.3).normalize(), color: ARC_BLUE.clone(), size: 0.5 });
  }
  group.userData.accent = ARC_BLUE.clone();
  group.userData.sparkSpecs = sparkSpecs;
  group.userData.lockRingScale = 1.35;
  return group;
}

// ---- threader: a corkscrewing needle -----------------------------------------

export function createThreaderMesh() {
  const group = new Group();

  // Long needle nose along +z.
  const nose = new OctahedronGeometry(0.42, 0);
  nose.scale(0.6, 0.6, 4.4);
  addFacet(group, nose, GUNMETAL.clone(), VOLT_VIOLET, 1.35);
  addCore(group, 0.18, ION_WHITE, 1.7, 1.5, 0.32).position.z = 1.2;

  // Swept fins near the tail so the corkscrew reads as a spin, not a slide.
  const sparkSpecs: SparkSpec[] = [];
  for (let i = 0; i < 3; i += 1) {
    const angle = (i / 3) * Math.PI * 2;
    const fin = new BoxGeometry(0.08, 0.95, 1.1);
    const blade = addFacet(group, fin, GUNMETAL.clone().multiplyScalar(0.9), ARC_BLUE, 1.1);
    blade.position.set(Math.cos(angle) * 0.5, Math.sin(angle) * 0.5, -1.3);
    blade.rotation.z = angle;
    blade.rotation.x = -0.3;
    sparkSpecs.push({ direction: new Vector3(Math.cos(angle), Math.sin(angle), -0.4).normalize(), color: VOLT_VIOLET.clone(), size: 0.5 });
  }

  // Ion tail streak.
  const tailMaterial = createAdditiveBasicMaterial({ color: hdr(VOLT_VIOLET, 1.1), opacity: 0.7, side: 2 });
  const tail = new Mesh(new ConeGeometry(0.34, 3.4, 7, 1, true), tailMaterial);
  tail.rotation.x = Math.PI / 2; // taper points back along -z
  tail.position.z = -2.7;
  group.add(tail);
  tintable(group).push({ material: tailMaterial, base: hdr(VOLT_VIOLET, 1.1), kind: 'core' });

  sparkSpecs.push({ direction: new Vector3(0, 0, 1), color: ION_WHITE.clone(), size: 0.6 });
  group.userData.accent = VOLT_VIOLET.clone();
  group.userData.sparkSpecs = sparkSpecs;
  group.userData.lockRingScale = 1.0;
  return group;
}

// ---- capacitor: an insulated bank that sheds its armour ----------------------

export function createCapacitorMesh() {
  const group = new Group();

  // Insulated core cylinder, exposed once the staves blow.
  const coreMaterial = new MeshBasicMaterial({ color: hdr(VOLT_VIOLET, 0.85) });
  const core = new Mesh(new CylinderGeometry(0.62, 0.62, 2.6, 10), coreMaterial);
  core.rotation.x = Math.PI / 2;
  const coreGlowMaterial = createAdditiveBasicMaterial({ color: hdr(VOLT_VIOLET, 0.4), opacity: 0.24 });
  const coreGlow = new Mesh(new CylinderGeometry(0.9, 0.9, 2.7, 10), coreGlowMaterial);
  core.add(coreGlow);
  group.add(core);
  tintable(group).push(
    { material: coreMaterial, base: hdr(VOLT_VIOLET, 0.85), kind: 'core' },
    { material: coreGlowMaterial, base: hdr(VOLT_VIOLET, 0.4), kind: 'core' },
  );
  group.userData.crackleCore = core;

  // Six insulator staves caged around the core; they shear off at the stage break.
  const armor = new Group();
  const sparkSpecs: SparkSpec[] = [];
  for (let i = 0; i < 6; i += 1) {
    const angle = (i / 6) * Math.PI * 2;
    const stave = new BoxGeometry(0.5, 0.5, 2.9);
    const fill = addFacet(group, stave, GUNMETAL.clone(), ARC_BLUE, 0.95);
    fill.removeFromParent();
    fill.position.set(Math.cos(angle) * 0.98, Math.sin(angle) * 0.98, 0);
    armor.add(fill);
    sparkSpecs.push({ direction: new Vector3(Math.cos(angle), Math.sin(angle), 0.2).normalize(), color: ARC_BLUE.clone(), size: 1.0 });
  }
  group.add(armor);
  group.userData.armor = armor;

  // Ribbed end caps, top and bottom of the barrel.
  for (const z of [1.5, -1.5]) {
    const cap = new CylinderGeometry(1.15, 0.9, 0.5, 8);
    cap.rotateX(Math.PI / 2);
    const capMesh = addFacet(group, cap, GUNMETAL.clone().multiplyScalar(0.9), ARC_BLUE, 1.1);
    capMesh.position.z = z;
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

// Stave break: the armour shears off, the core is exposed and runs hotter.
export function breakCapacitorArmor(group: Group) {
  const armor = group.userData.armor as Group | undefined;
  if (!armor || armor.visible === false) return;
  armor.visible = false;
  for (const part of group.userData.parts as TintPart[]) {
    if (part.kind === 'core') part.base.multiplyScalar(2.1);
  }
}

// ---- arc: ball lightning (a lockable hostile bolt) ---------------------------

export function createArcMesh() {
  const group = new Group();
  addCore(group, 0.4, ION_WHITE, 2.3, 1.7, 0.42);

  // Two jagged shells that jitter every frame (see updateVisuals) — the tell that
  // this thing is unstable and incoming, not a coil to be leisurely locked.
  const shells: Mesh[] = [];
  for (const [radius, color, intensity] of [
    [0.72, ARC_BLUE, 1.5],
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

  // Heavy X-clamp: two crossed braces gripping the bore, hazard-striped.
  const sparkSpecs: SparkSpec[] = [];
  for (const rot of [Math.PI * 0.25, -Math.PI * 0.25]) {
    const brace = new BoxGeometry(5.4, 0.95, 0.95);
    const arm = addFacet(group, brace, GUNMETAL.clone(), HAZARD, 1.1);
    arm.rotation.z = rot;
    // Hazard chevrons banded along each arm.
    for (let s = -2; s <= 2; s += 1) {
      const stripe = new BoxGeometry(0.42, 1.02, 1.02);
      const stripeMaterial = new MeshBasicMaterial({ color: hdr(HAZARD, 0.9) });
      const chevron = new Mesh(stripe, stripeMaterial);
      chevron.position.x = s * 1.0;
      arm.add(chevron);
      tintable(group).push({ material: stripeMaterial, base: hdr(HAZARD, 0.9), kind: 'edge' });
    }
    sparkSpecs.push(
      { direction: new Vector3(Math.cos(rot), Math.sin(rot), 0).normalize(), color: HAZARD.clone(), size: 1.3 },
      { direction: new Vector3(-Math.cos(rot), -Math.sin(rot), 0).normalize(), color: HAZARD.clone(), size: 1.3 },
    );
  }

  // Central actuator core, subdued until the cowl pops at stage 1 exposes it.
  addCore(group, 0.72, ION_WHITE, 1.35, 1.5, 0.3);
  const cowl = new Group();
  const cowlShell = new CylinderGeometry(1.5, 1.5, 1.5, 8);
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

// Cowl pop: the hazard shell shears away, the hot actuator core is exposed.
export function breakInterlockCowl(group: Group) {
  const cowl = group.userData.armor as Group | undefined;
  if (!cowl || cowl.visible === false) return;
  cowl.visible = false;
  for (const part of group.userData.parts as TintPart[]) {
    if (part.kind === 'core') part.base.multiplyScalar(1.6);
  }
}
