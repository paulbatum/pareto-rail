import {
  BoxGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  OctahedronGeometry,
  RingGeometry,
  SphereGeometry,
  TorusGeometry,
} from 'three';
import { createAdditiveBasicMaterial } from '../../../engine/visual-kit';
import { modeMaterial, type ModedSpec } from './moded';
import {
  CREAM,
  CREAM_DIRTY,
  hdr,
  INK_BLACK,
  IR_COLD,
  IR_HOT,
  LAMP,
  OIL,
  OIL_SHEEN,
  PALE_SICK,
  RUST,
  RUST_DARK,
  SIGNAL_RED,
} from './palette';

// The octopus's spawn: scavenger shapes assembled from flesh and harbor
// debris. Geometries are shared at module scope (materials are per-mesh so
// the infrared mode driver and lock flares stay per-enemy); the record
// disposal path in visuals/index disposes materials only.

export type LockSpecEntry = {
  spec: ModedSpec;
  murkBase: Color;
  irBase: Color;
  murkLocked: Color;
  irLocked: Color;
};

function lockable(spec: ModedSpec, murkLocked: Color, irLocked: Color): LockSpecEntry {
  return { spec, murkBase: spec.murk.clone(), irBase: spec.ir.clone(), murkLocked, irLocked };
}

export function applyLockSpecs(group: Group, locked: boolean) {
  const entries = group.userData.lockSpecs as LockSpecEntry[] | undefined;
  if (!entries) return;
  for (const entry of entries) {
    entry.spec.murk.copy(locked ? entry.murkLocked : entry.murkBase);
    entry.spec.ir.copy(locked ? entry.irLocked : entry.irBase);
  }
}

function fleshMaterial(murk: Color, blindDim = 1) {
  return modeMaterial(new MeshBasicMaterial({ color: murk.clone() }), {
    murk: murk.clone(),
    ir: hdr(IR_HOT, 1.15),
    blindDim,
  });
}

function debrisMaterial(murk: Color, blindDim = 1) {
  return modeMaterial(new MeshBasicMaterial({ color: murk.clone() }), {
    murk: murk.clone(),
    ir: hdr(IR_HOT, 0.75),
    blindDim,
  });
}

function signalMaterial(murk: Color, irIntensity = 2.4) {
  return modeMaterial(createAdditiveBasicMaterial({ color: murk.clone() }), {
    murk: murk.clone(),
    ir: hdr(SIGNAL_RED, irIntensity),
    blindDim: 0.94,
  });
}

// ---- shared geometries ------------------------------------------------------

const skimmerSpar = new BoxGeometry(0.18, 0.12, 1.6);
const skimmerNose = new ConeGeometry(0.16, 0.5, 5);
const skimmerFin = new BoxGeometry(1.35, 0.05, 0.75);
const skimmerEdge = new BoxGeometry(1.3, 0.06, 0.1);
const skimmerHook = new BoxGeometry(0.1, 0.42, 0.1);
const skimmerEye = new SphereGeometry(0.14, 8, 6);

const lurkerDome = new SphereGeometry(0.85, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2);
const lurkerSkirt = new CylinderGeometry(0.85, 0.95, 0.34, 10);
const lurkerLeg = new BoxGeometry(0.14, 0.5, 0.14);
const lurkerBarnacle = new ConeGeometry(0.22, 0.34, 6);
const lurkerEye = new SphereGeometry(0.2, 8, 6);
const lurkerRim = new TorusGeometry(0.26, 0.035, 6, 14);

const dredgerUpper = new BoxGeometry(2.3, 0.72, 1.2);
const dredgerLower = new BoxGeometry(2.2, 0.6, 1.1);
const dredgerToothUp = new ConeGeometry(0.11, 0.4, 4);
const dredgerToothDown = new ConeGeometry(0.1, 0.34, 4);
const dredgerHazard = new BoxGeometry(0.34, 0.74, 0.06);
const dredgerThroat = new BoxGeometry(1.7, 0.5, 0.2);
const dredgerLink = new TorusGeometry(0.22, 0.06, 6, 10);

const inkshotBody = new SphereGeometry(0.44, 10, 8);
const inkshotRing = new RingGeometry(0.52, 0.6, 22);
const inkshotHeart = new SphereGeometry(0.16, 8, 6);
const inkshotDroplet = new SphereGeometry(0.15, 6, 5);

const harpoonTip = new OctahedronGeometry(0.3, 0);
const harpoonHalo = new OctahedronGeometry(0.5, 0);

// ---- skimmer: a debris-ray that banks across the whole screen --------------

export function createSkimmerMesh() {
  const group = new Group();
  const hull = fleshMaterial(OIL.clone().lerp(RUST, 0.35));
  const plate = debrisMaterial(RUST.clone());
  const stripe = debrisMaterial(CREAM_DIRTY.clone());
  const eye = signalMaterial(hdr(LAMP, 1.5));

  const spar = new Mesh(skimmerSpar, hull);
  const nose = new Mesh(skimmerNose, hull);
  nose.rotation.x = Math.PI / 2;
  nose.position.z = 1.0;

  for (const side of [-1, 1]) {
    const fin = new Mesh(skimmerFin, plate);
    fin.position.set(side * 0.72, 0, -0.1);
    fin.rotation.y = side * -0.5;
    fin.rotation.z = side * 0.12;
    const edge = new Mesh(skimmerEdge, stripe);
    edge.position.set(side * 0.78, 0.01, 0.26);
    edge.rotation.y = side * -0.5;
    group.add(fin, edge);
  }

  const hook = new Mesh(skimmerHook, plate);
  hook.position.set(0, -0.3, -0.72);
  const eyeBall = new Mesh(skimmerEye, eye);
  eyeBall.position.set(0, 0.08, 0.86);

  group.add(spar, nose, hook, eyeBall);
  group.userData.kind = 'skimmer';
  group.userData.accent = RUST.clone().lerp(LAMP, 0.4);
  group.userData.lockSpecs = [
    lockable(eye.userData.moded as ModedSpec, hdr(LAMP, 2.6), hdr(SIGNAL_RED, 3.2)),
    lockable(stripe.userData.moded as ModedSpec, hdr(LAMP, 1.3), hdr(IR_HOT, 1.5)),
  ];
  return group;
}

// ---- lurker: a barnacle crab squatting on the wreck line -------------------

export function createLurkerMesh() {
  const group = new Group();
  const shell = debrisMaterial(CREAM_DIRTY.clone());
  const under = fleshMaterial(OIL.clone().lerp(OIL_SHEEN, 0.3));
  const patch = debrisMaterial(RUST.clone());
  const eye = signalMaterial(hdr(LAMP, 1.9), 3.0);

  const dome = new Mesh(lurkerDome, shell);
  const skirt = new Mesh(lurkerSkirt, under);
  skirt.position.y = -0.16;

  for (let i = 0; i < 4; i += 1) {
    const angle = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const leg = new Mesh(lurkerLeg, under);
    leg.position.set(Math.cos(angle) * 0.8, -0.52, Math.sin(angle) * 0.55);
    leg.rotation.z = Math.cos(angle) * 0.5;
    group.add(leg);
  }
  for (const [px, pz] of [[-0.35, 0.3], [0.4, -0.1], [0.05, -0.45]] as const) {
    const barnacle = new Mesh(lurkerBarnacle, patch);
    barnacle.position.set(px, 0.62, pz);
    group.add(barnacle);
  }

  const eyeBall = new Mesh(lurkerEye, eye);
  eyeBall.position.set(0, 0.18, 0.82);
  const eyeRim = new Mesh(lurkerRim, patch);
  eyeRim.position.copy(eyeBall.position);

  group.add(dome, skirt, eyeBall, eyeRim);
  group.userData.kind = 'lurker';
  group.userData.accent = CREAM_DIRTY.clone().lerp(LAMP, 0.5);
  group.userData.lockSpecs = [
    lockable(eye.userData.moded as ModedSpec, hdr(LAMP, 2.8), hdr(SIGNAL_RED, 3.4)),
    lockable(shell.userData.moded as ModedSpec, CREAM.clone().multiplyScalar(1.15), hdr(IR_HOT, 1.4)),
  ];
  return group;
}

// ---- dredger: an armored dredge-bucket jaw lowered in on its chain ---------

export function createDredgerMesh() {
  const group = new Group();
  const armor = debrisMaterial(RUST.clone(), 0.96);
  const dark = debrisMaterial(RUST_DARK.clone(), 0.96);
  const stripe = debrisMaterial(CREAM_DIRTY.clone(), 0.96);
  const gut = signalMaterial(hdr(LAMP, 1.1), 2.8);

  const upper = new Mesh(dredgerUpper, armor);
  upper.position.y = 0.42;
  const lower = new Mesh(dredgerLower, dark);
  lower.position.y = -0.5;
  lower.rotation.x = 0.16;

  for (let i = 0; i < 5; i += 1) {
    const x = (i - 2) * 0.48;
    const toothUp = new Mesh(dredgerToothUp, stripe);
    toothUp.position.set(x, 0.06, 0.55);
    toothUp.rotation.x = Math.PI;
    const toothDown = new Mesh(dredgerToothDown, stripe);
    toothDown.position.set(x + 0.2, -0.2, 0.52);
    group.add(toothUp, toothDown);
  }

  for (const side of [-1, 1]) {
    const hazard = new Mesh(dredgerHazard, stripe);
    hazard.position.set(side * 0.85, 0.42, 0.62);
    hazard.rotation.z = side * 0.5;
    group.add(hazard);
  }

  const throat = new Mesh(dredgerThroat, gut);
  throat.position.set(0, -0.05, 0.32);

  for (let i = 0; i < 3; i += 1) {
    const link = new Mesh(dredgerLink, dark);
    link.position.set(0, 1.05 + i * 0.42, 0);
    link.rotation.y = (i % 2) * Math.PI / 2;
    group.add(link);
  }

  group.add(upper, lower, throat);
  group.userData.kind = 'dredger';
  group.userData.accent = LAMP.clone();
  group.userData.lockSpecs = [
    lockable(gut.userData.moded as ModedSpec, hdr(LAMP, 2.4), hdr(SIGNAL_RED, 3.4)),
    lockable(stripe.userData.moded as ModedSpec, hdr(LAMP, 1.2), hdr(IR_HOT, 1.4)),
  ];
  return group;
}

// ---- inkshot: a heavy homing glob of oil-black ink -------------------------

export function createInkshotMesh() {
  const group = new Group();
  const glob = modeMaterial(new MeshBasicMaterial({ color: INK_BLACK.clone(), transparent: true, opacity: 0.96 }), {
    murk: INK_BLACK.clone(),
    ir: IR_COLD.clone(),
    murkOpacity: 0.96,
    irOpacity: 0.96,
    blindDim: 0,
  });
  const rim = modeMaterial(createAdditiveBasicMaterial({ color: PALE_SICK.clone().multiplyScalar(0.8), side: DoubleSide }), {
    murk: PALE_SICK.clone().multiplyScalar(0.8),
    ir: hdr(SIGNAL_RED, 1.8),
    blindDim: 0.5,
  });
  const core = signalMaterial(hdr(SIGNAL_RED, 0.9), 3.2);

  const body = new Mesh(inkshotBody, glob);
  const ring = new Mesh(inkshotRing, rim);
  const heart = new Mesh(inkshotHeart, core);
  const droplet = new Mesh(inkshotDroplet, glob);
  droplet.position.set(-0.3, 0.24, -0.3);

  group.add(body, ring, heart, droplet);
  group.userData.kind = 'inkshot';
  group.userData.accent = PALE_SICK.clone();
  group.userData.lockSpecs = [
    lockable(rim.userData.moded as ModedSpec, hdr(LAMP, 2.2), hdr(SIGNAL_RED, 3.0)),
  ];
  return group;
}

// ---- player projectile: a lamplit harpoon tracer ---------------------------

export function createHarpoonMesh() {
  const group = new Group();
  const core = modeMaterial(new MeshBasicMaterial({ color: hdr(CREAM, 2.4) }), {
    murk: hdr(CREAM, 2.4),
    ir: hdr(IR_HOT, 3.0),
    blindDim: 0,
  });
  const shell = modeMaterial(createAdditiveBasicMaterial({ color: hdr(LAMP, 0.9), opacity: 0.55 }), {
    murk: hdr(LAMP, 0.9),
    ir: hdr(IR_HOT, 1.2),
    murkOpacity: 0.55,
    irOpacity: 0.55,
    blindDim: 0,
  });

  const tip = new Mesh(harpoonTip, core);
  tip.scale.set(0.42, 0.42, 2.2);
  const halo = new Mesh(harpoonHalo, shell);
  halo.scale.set(0.5, 0.5, 1.9);
  group.add(tip, halo);
  return group;
}
