import {
  BoxGeometry,
  BufferGeometry,
  CircleGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  Group,
  IcosahedronGeometry,
  Mesh,
  MeshBasicMaterial,
  OctahedronGeometry,
  RingGeometry,
  TorusGeometry,
} from 'three';
import { createAdditiveBasicMaterial } from '../../../engine/visual-kit';
import { ARC_BLUE, BORE_PLATE, DANGER, HOSTILE, HULL, WHITE_HOT, hdr } from './palette';

// Four defence silhouettes, each readable from its outline alone at bore
// distance: a flat hex plate on the wall, a long needle nose-on, a wide
// twin-rotor crossing shape, and a squat drum on an arm. The bodies are all
// the same dead grey plate; the acid-green core is the only thing that says
// hostile, and it is the only green in the level.

export type TintPart = {
  material: MeshBasicMaterial;
  base: Color;
  kind: 'plate' | 'edge' | 'core';
};

// Drone meshes are built and thrown away constantly — roughly a hundred over a
// run — so every primitive is interned by shape. Materials stay per-instance
// because tinting a lock or a damage flash has to be local to one target.
const geometryCache = new Map<string, BufferGeometry>();

function shared<T extends BufferGeometry>(key: string, make: () => T): T {
  const cached = geometryCache.get(key);
  if (cached) return cached as T;
  const created = make();
  geometryCache.set(key, created);
  return created;
}

const box = (w: number, h: number, d: number) => shared(`box:${w}:${h}:${d}`, () => new BoxGeometry(w, h, d));
const circle = (radius: number, segments: number) => shared(`circle:${radius}:${segments}`, () => new CircleGeometry(radius, segments));
const cone = (radius: number, height: number, segments: number) => shared(`cone:${radius}:${height}:${segments}`, () => new ConeGeometry(radius, height, segments));
const cylinder = (top: number, bottom: number, height: number, segments: number) =>
  shared(`cyl:${top}:${bottom}:${height}:${segments}`, () => new CylinderGeometry(top, bottom, height, segments));
const octa = (radius: number, detail: number) => shared(`octa:${radius}:${detail}`, () => new OctahedronGeometry(radius, detail));
const icosa = (radius: number, detail: number) => shared(`icosa:${radius}:${detail}`, () => new IcosahedronGeometry(radius, detail));
const ring = (inner: number, outer: number, theta: number, phi: number) =>
  shared(`ring:${inner}:${outer}:${theta}:${phi}`, () => new RingGeometry(inner, outer, theta, phi));
const torus = (radius: number, tube: number, radial: number, tubular: number) =>
  shared(`torus:${radius}:${tube}:${radial}:${tubular}`, () => new TorusGeometry(radius, tube, radial, tubular));

type Build = { group: Group; parts: TintPart[] };

function begin(): Build {
  return { group: new Group(), parts: [] };
}

function plate(build: Build, geometry: BufferGeometry, color: Color) {
  const material = new MeshBasicMaterial({ color: color.clone() });
  const mesh = new Mesh(geometry, material);
  build.group.add(mesh);
  build.parts.push({ material, base: color.clone(), kind: 'plate' });
  return mesh;
}

function glow(build: Build, geometry: BufferGeometry, color: Color, kind: 'edge' | 'core', opacity = 1) {
  const material = createAdditiveBasicMaterial({ color: color.clone(), opacity, side: DoubleSide });
  const mesh = new Mesh(geometry, material);
  build.group.add(mesh);
  build.parts.push({ material, base: color.clone(), kind });
  return mesh;
}

function finish(build: Build, kind: string, accent: Color, lockRingScale: number) {
  build.group.userData.kind = kind;
  build.group.userData.parts = build.parts;
  build.group.userData.accent = accent.clone();
  build.group.userData.lockRingScale = lockRingScale;
  return build.group;
}

// ---- sentry -----------------------------------------------------------------
// A hex plate bolted to the bore wall. Flat, wide, and always face-on.

export function createSentryMesh() {
  const build = begin();
  const body = plate(build, circle(1.5, 6), BORE_PLATE.clone().multiplyScalar(3.2));
  body.rotation.z = Math.PI / 6;

  const rim = glow(build, ring(1.44, 1.58, 6, 1), hdr(ARC_BLUE, 1.15), 'edge');
  rim.rotation.z = Math.PI / 6;

  // Three clamp tabs: the bolts holding it to the barrel.
  for (let i = 0; i < 3; i += 1) {
    const angle = (i / 3) * Math.PI * 2 + Math.PI / 2;
    const tab = plate(build, box(0.42, 0.24, 0.3), HULL);
    tab.position.set(Math.cos(angle) * 1.5, Math.sin(angle) * 1.5, -0.06);
    tab.rotation.z = angle;
  }

  // The eye: a horizontal slot, the one green thing on the plate.
  const slot = glow(build, box(1.7, 0.2, 0.08), hdr(HOSTILE, 1.6), 'core');
  slot.position.z = 0.14;
  const pupil = glow(build, circle(0.2, 12), hdr(HOSTILE, 2.4), 'core');
  pupil.position.z = 0.18;

  return finish(build, 'sentry', HOSTILE, 1.05);
}

// ---- skimmer ----------------------------------------------------------------
// A needle running back up the bore at you. Built nose-first along +Z, because
// lookAt points a plain Object3D's +Z at its target.

export function createSkimmerMesh() {
  const build = begin();
  const shaft = plate(build, cylinder(0.2, 0.34, 3.4, 6), HULL);
  shaft.rotation.x = Math.PI / 2;

  const nose = plate(build, cone(0.34, 1.3, 6), BORE_PLATE.clone().multiplyScalar(3.6));
  nose.rotation.x = Math.PI / 2;
  nose.position.z = 2.35;

  const tip = glow(build, octa(0.3, 0), hdr(HOSTILE, 2.2), 'core');
  tip.position.z = 2.9;
  tip.scale.set(0.7, 0.7, 1.5);

  // Four swept fins at the tail, splayed back down the barrel.
  for (let i = 0; i < 4; i += 1) {
    const angle = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const fin = plate(build, box(0.09, 1.15, 1.0), HULL);
    fin.position.set(Math.cos(angle) * 0.5, Math.sin(angle) * 0.5, -1.5);
    fin.rotation.z = angle - Math.PI / 2;
    fin.rotation.x = -0.34;
  }

  const collar = glow(build, torus(0.46, 0.05, 4, 16), hdr(ARC_BLUE, 1.4), 'edge');
  collar.position.z = 0.7;

  const thruster = glow(build, circle(0.32, 10), hdr(HOSTILE, 1.5), 'core', 0.85);
  thruster.position.z = -1.75;
  thruster.rotation.y = Math.PI;

  return finish(build, 'skimmer', HOSTILE, 1.2);
}

// ---- weaver -----------------------------------------------------------------
// Wide twin-rotor crossing drone. It shows its full span while it cuts the bore.

export function createWeaverMesh() {
  const build = begin();
  const spine = plate(build, box(0.5, 0.34, 2.1), HULL);
  spine.position.z = 0.1;

  const spinParts: Mesh[] = [];
  for (const side of [-1, 1]) {
    const boom = plate(build, box(1.5, 0.18, 0.28), HULL);
    boom.position.set(side * 0.95, 0, 0.1);

    const rotor = glow(build, torus(0.72, 0.06, 4, 20), hdr(ARC_BLUE, 1.3), 'edge');
    rotor.position.set(side * 1.75, 0, 0.1);
    rotor.rotation.x = Math.PI / 2;
    rotor.userData.spinSpeed = side * 7.5;
    spinParts.push(rotor);

    const blade = glow(build, ring(0.12, 0.66, 3, 1), hdr(HOSTILE, 0.9), 'core', 0.55);
    blade.position.set(side * 1.75, 0, 0.1);
    blade.rotation.x = Math.PI / 2;
    blade.userData.spinSpeed = side * -11;
    spinParts.push(blade);
  }

  const eye = glow(build, octa(0.34, 0), hdr(HOSTILE, 2.0), 'core');
  eye.position.z = 1.15;
  eye.scale.set(1, 0.62, 1.5);

  const keel = plate(build, box(0.16, 0.62, 0.9), BORE_PLATE.clone().multiplyScalar(3.2));
  keel.position.set(0, -0.4, -0.3);

  build.group.userData.spinParts = spinParts;
  return finish(build, 'weaver', HOSTILE, 1.35);
}

// ---- arcnode ----------------------------------------------------------------
// A capacitor drum on a swing arm. Local +Y points out at the bore wall, so the
// mount is at the top of the model and the business end reaches inward.

export function createArcnodeMesh() {
  const build = begin();
  const foot = plate(build, box(1.5, 0.3, 1.5), HULL);
  foot.position.y = 1.5;

  const arm = plate(build, box(0.3, 1.2, 0.3), HULL);
  arm.position.y = 0.85;

  const drum = plate(build, cylinder(0.95, 0.95, 1.5, 10), BORE_PLATE.clone().multiplyScalar(3.4));

  // Banding: three charged hoops around the can.
  for (const y of [-0.45, 0, 0.45]) {
    const band = glow(build, torus(0.99, 0.05, 4, 18), hdr(ARC_BLUE, 1.35), 'edge');
    band.position.y = y;
    band.rotation.x = Math.PI / 2;
  }

  // Three discharge prongs reaching further into the bore.
  for (let i = 0; i < 3; i += 1) {
    const angle = (i / 3) * Math.PI * 2;
    const prong = plate(build, box(0.16, 0.9, 0.16), HULL);
    prong.position.set(Math.cos(angle) * 0.62, -1.05, Math.sin(angle) * 0.62);
    const spark = glow(build, octa(0.16, 0), hdr(WHITE_HOT, 1.6), 'core');
    spark.position.set(Math.cos(angle) * 0.62, -1.5, Math.sin(angle) * 0.62);
  }

  const core = glow(build, icosa(0.52, 0), hdr(HOSTILE, 1.9), 'core');
  core.position.y = -0.1;
  build.group.userData.armourCore = core;
  void drum;

  return finish(build, 'arcnode', HOSTILE, 1.5);
}

/** Blowing the outer stage strips the drum's banding and bares the core. */
export function crackArcnodeArmour(group: Group) {
  const core = group.userData.armourCore as Mesh | undefined;
  if (core) core.scale.setScalar(1.7);
  const parts = group.userData.parts as TintPart[] | undefined;
  if (!parts) return;
  for (const part of parts) {
    if (part.kind === 'edge') part.base.copy(hdr(DANGER, 1.2));
  }
}

// ---- interlock --------------------------------------------------------------
// Safety hardware, not a drone: heavy, hazard-marked, and much bigger than
// anything else in the barrel. Local +Y is out at the wall; the jaw reaches in.

export function createInterlockMesh() {
  const build = begin();
  const block = plate(build, box(6.4, 2.6, 3.6), BORE_PLATE.clone().multiplyScalar(3.0));
  block.position.y = 1.2;

  const shoulder = plate(build, box(7.4, 0.7, 2.4), HULL);
  shoulder.position.y = 2.35;

  // Hazard chevrons: the only place this level lets warning stripes exist.
  for (let i = 0; i < 4; i += 1) {
    const chevron = glow(build, box(0.9, 0.18, 3.7), hdr(DANGER, 0.55), 'edge', 0.85);
    chevron.position.set(-2.4 + i * 1.6, 2.42, 0);
    chevron.rotation.y = 0.5;
  }

  // The jaw: two seized fingers reaching into the bore.
  for (const side of [-1, 1]) {
    const finger = plate(build, box(1.5, 3.2, 2.2), HULL);
    finger.position.set(side * 1.9, -0.9, 0);
    finger.rotation.z = side * 0.16;
    const claw = plate(build, cone(0.75, 1.5, 4), BORE_PLATE.clone().multiplyScalar(3.4));
    claw.position.set(side * 2.15, -2.6, 0);
    claw.rotation.x = Math.PI;
    claw.rotation.y = Math.PI / 4;
  }

  // The seized seam — this is the part that goes red as the charge builds.
  const seam = glow(build, box(4.2, 0.22, 3.7), hdr(DANGER, 1.0), 'core');
  seam.position.y = -0.15;
  build.group.userData.seam = seam;

  const rail = glow(build, box(6.5, 0.12, 0.12), hdr(ARC_BLUE, 1.5), 'edge');
  rail.position.set(0, 2.72, 1.05);

  const sensor = glow(build, octa(0.5, 0), hdr(HOSTILE, 1.8), 'core');
  sensor.position.set(0, 0.6, 1.95);
  build.group.userData.sensor = sensor;

  return finish(build, 'interlock', DANGER, 3.4);
}

/** Punching the outer casing exposes the interlock's actuator. */
export function crackInterlockArmour(group: Group) {
  const sensor = group.userData.sensor as Mesh | undefined;
  if (sensor) sensor.scale.setScalar(1.9);
  const seam = group.userData.seam as Mesh | undefined;
  if (seam) seam.scale.set(1, 2.4, 1);
}

// ---- bolt -------------------------------------------------------------------

export function createBoltMesh() {
  const build = begin();
  const core = glow(build, octa(0.34, 0), hdr(HOSTILE, 2.6), 'core');
  core.scale.set(0.6, 0.6, 2.0);
  const halo = glow(build, ring(0.4, 0.62, 12, 1), hdr(HOSTILE, 1.0), 'edge', 0.6);
  build.group.userData.isHostileShot = true;
  build.group.userData.trailColor = hdr(HOSTILE, 0.7);
  void halo;
  return finish(build, 'bolt', HOSTILE, 0.8);
}
