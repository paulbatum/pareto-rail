import {
  BoxGeometry,
  BufferGeometry,
  CircleGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  OctahedronGeometry,
  PlaneGeometry,
  RingGeometry,
  TorusGeometry,
  Vector3,
} from 'three';
import { createAdditiveBasicMaterial } from '../../../engine/visual-kit';
import { CASING, FAULT, HOSTILE, HOSTILE_DEEP, hdr } from './palette';

// Construction only. Silhouettes are the readable part: a flat hex wheel, a
// four-sided needle, a squat armoured blister, a curved clamp. Everything
// hostile is amber over a matte casing so it never disappears into the barrel's
// blue-violet light, and every emissive detail is a thin line or a small core so
// bloom cannot smear it into a blob.
//
// Geometry is shared across every instance of a kind (targets spawn constantly);
// materials are not, because each target tints independently.

export type TintPart = { material: MeshBasicMaterial; base: Color; kind: 'fill' | 'edge' | 'core' };
export type ShardSpec = { direction: Vector3; color: Color; size: number };

const geometryCache = new Map<string, BufferGeometry>();

function shared<T extends BufferGeometry>(key: string, make: () => T): T {
  const cached = geometryCache.get(key);
  if (cached) return cached as T;
  const geometry = make();
  geometryCache.set(key, geometry);
  return geometry;
}

type Build = {
  group: Group;
  parts: TintPart[];
  shards: ShardSpec[];
};

function build(): Build {
  return { group: new Group(), parts: [], shards: [] };
}

function addPart(context: Build, mesh: Mesh, base: Color, kind: TintPart['kind']) {
  context.parts.push({ material: mesh.material as MeshBasicMaterial, base, kind });
  context.group.add(mesh);
  return mesh;
}

function fillMesh(geometry: BufferGeometry, color: Color) {
  return new Mesh(geometry, new MeshBasicMaterial({ color: color.clone() }));
}

function glowMesh(geometry: BufferGeometry, color: Color, opacity = 1) {
  return new Mesh(geometry, createAdditiveBasicMaterial({ color: color.clone(), side: DoubleSide, opacity }));
}

function shard(x: number, y: number, z: number, color: Color, size: number): ShardSpec {
  return { direction: new Vector3(x, y, z), color: color.clone(), size };
}

function finish(context: Build, kind: string, accent: Color, lockRingScale: number) {
  context.group.userData.kind = kind;
  context.group.userData.parts = context.parts;
  context.group.userData.shardSpecs = context.shards;
  context.group.userData.accent = accent.clone();
  context.group.userData.lockRingScale = lockRingScale;
  return context.group;
}

/** Defence drone: a flat hex wheel with a single running slit. Faces the camera. */
export function createDroneMesh() {
  const context = build();

  addPart(context, fillMesh(shared('drone.plate', () => {
    const plate = new CylinderGeometry(1.26, 1.26, 0.22, 6);
    plate.rotateX(Math.PI / 2);
    return plate;
  }), CASING), CASING.clone().multiplyScalar(2.6), 'fill');

  addPart(
    context,
    glowMesh(shared('drone.rim', () => new RingGeometry(1.19, 1.36, 6)), hdr(HOSTILE, 1.25)),
    hdr(HOSTILE, 1.25),
    'edge',
  );

  const slit = glowMesh(shared('drone.slit', () => new PlaneGeometry(1.48, 0.17)), hdr(HOSTILE, 2.3));
  slit.position.z = 0.13;
  addPart(context, slit, hdr(HOSTILE, 2.3), 'core');

  // Two stubby thrust vanes read the drone's bank as it wheels around the bore.
  for (const side of [-1, 1]) {
    const vane = fillMesh(shared('drone.vane', () => new BoxGeometry(0.18, 0.72, 0.18)), CASING);
    vane.position.set(side * 1.22, 0, -0.1);
    vane.rotation.z = side * 0.5;
    addPart(context, vane, CASING.clone().multiplyScalar(3.4), 'fill');
  }

  for (let index = 0; index < 6; index += 1) {
    const angle = (index / 6) * Math.PI * 2;
    context.shards.push(shard(Math.cos(angle), Math.sin(angle), 0.2, HOSTILE, 0.28));
  }
  return finish(context, 'drone', HOSTILE, 1.0);
}

/** Interceptor lance: a four-sided needle that flies nose-first along its chord. */
export function createLanceMesh() {
  const context = build();

  addPart(context, fillMesh(shared('lance.body', () => {
    const body = new ConeGeometry(0.36, 3.3, 4);
    body.rotateX(Math.PI / 2);
    return body;
  }), CASING), CASING.clone().multiplyScalar(3.0), 'fill');

  addPart(context, glowMesh(shared('lance.sheath', () => {
    const sheath = new ConeGeometry(0.43, 3.0, 4, 1, true);
    sheath.rotateX(Math.PI / 2);
    return sheath;
  }), hdr(HOSTILE, 0.75), 0.5), hdr(HOSTILE, 0.75), 'edge');

  const tip = glowMesh(shared('lance.tip', () => new OctahedronGeometry(0.27, 0)), hdr(HOSTILE, 2.6));
  tip.position.z = 1.62;
  addPart(context, tip, hdr(HOSTILE, 2.6), 'core');

  for (const side of [-1, 1]) {
    const fin = fillMesh(shared('lance.fin', () => new BoxGeometry(0.05, 0.74, 0.9)), CASING);
    fin.position.set(side * 0.16, 0, -0.9);
    fin.rotation.z = side * 0.3;
    addPart(context, fin, CASING.clone().multiplyScalar(3.6), 'fill');
  }

  const collar = glowMesh(shared('lance.collar', () => new RingGeometry(0.3, 0.4, 4)), hdr(HOSTILE, 1.5));
  collar.position.z = -0.35;
  addPart(context, collar, hdr(HOSTILE, 1.5), 'edge');

  for (let index = 0; index < 5; index += 1) {
    const angle = (index / 5) * Math.PI * 2;
    context.shards.push(shard(Math.cos(angle) * 0.5, Math.sin(angle) * 0.5, index % 2 === 0 ? 1 : -1, HOSTILE, 0.22));
  }
  return finish(context, 'lance', HOSTILE, 1.1);
}

/** Coil sentry: an armoured blister with a charging aperture. Two hits to kill. */
export function createSentryMesh() {
  const context = build();

  addPart(context, fillMesh(shared('sentry.hull', () => {
    const hull = new OctahedronGeometry(1.55, 0);
    hull.scale(1, 1, 0.66);
    return hull;
  }), CASING), CASING.clone().multiplyScalar(2.4), 'fill');

  for (let index = 0; index < 4; index += 1) {
    const angle = (index / 4) * Math.PI * 2 + Math.PI / 4;
    const plate = fillMesh(shared('sentry.plate', () => new BoxGeometry(0.9, 0.24, 0.5)), CASING);
    plate.position.set(Math.cos(angle) * 1.1, Math.sin(angle) * 1.1, 0.1);
    plate.rotation.z = angle + Math.PI / 2;
    addPart(context, plate, CASING.clone().multiplyScalar(3.8), 'fill');
    context.shards.push(shard(Math.cos(angle), Math.sin(angle), 0.3, HOSTILE_DEEP, 0.55));
  }

  addPart(
    context,
    glowMesh(shared('sentry.cage', () => new RingGeometry(1.34, 1.5, 8)), hdr(HOSTILE, 0.95)),
    hdr(HOSTILE, 0.95),
    'edge',
  );

  const aperture = glowMesh(shared('sentry.aperture', () => new CircleGeometry(0.5, 20)), hdr(HOSTILE, 2.8));
  aperture.position.z = 0.58;
  addPart(context, aperture, hdr(HOSTILE, 2.8), 'core');
  context.group.userData.aperture = aperture;

  const muzzleRing = glowMesh(shared('sentry.muzzle', () => new RingGeometry(0.56, 0.68, 16)), hdr(HOSTILE, 1.6));
  muzzleRing.position.z = 0.6;
  addPart(context, muzzleRing, hdr(HOSTILE, 1.6), 'edge');

  for (let index = 0; index < 6; index += 1) {
    const angle = (index / 6) * Math.PI * 2;
    context.shards.push(shard(Math.cos(angle) * 0.8, Math.sin(angle) * 0.8, 0.5, HOSTILE, 0.4));
  }
  return finish(context, 'sentry', HOSTILE, 1.25);
}

/** Sentry bolt: a small hot slug with a swept collar. Lockable, interceptable. */
export function createBoltMesh() {
  const context = build();

  addPart(context, glowMesh(shared('bolt.core', () => {
    const core = new OctahedronGeometry(0.34, 0);
    core.scale(0.7, 0.7, 2.1);
    return core;
  }), hdr(HOSTILE, 3.0)), hdr(HOSTILE, 3.0), 'core');

  addPart(context, glowMesh(shared('bolt.shell', () => {
    const shell = new OctahedronGeometry(0.52, 0);
    shell.scale(0.8, 0.8, 1.7);
    return shell;
  }), hdr(FAULT, 0.9), 0.55), hdr(FAULT, 0.9), 'edge');

  context.group.userData.isHostileShot = true;
  context.group.userData.trailColor = HOSTILE.clone().multiplyScalar(0.85);
  return finish(context, 'bolt', HOSTILE, 0.8);
}

/**
 * Safety interlock: a curved clamp bolted around the bore, with a fault core
 * burning behind its armour. `breakInterlockArmour` strips the shell when the
 * first hit stage completes and leaves the core exposed.
 */
export function createInterlockMesh() {
  const context = build();

  // Local -Y is "toward the bore axis": the clamp is mounted on the wall and
  // reaches inward, so the shoe, the rim light and the jaws all hang off that
  // side and the whole wheel of six reads as one cage.
  const SHOE_RADIUS = 2.9;
  const SHOE_SPAN = Math.PI * 0.55;
  const SHOE_START = -Math.PI / 2 - SHOE_SPAN / 2;

  addPart(context, fillMesh(shared('interlock.shoe', () => {
    const shoe = new TorusGeometry(SHOE_RADIUS, 0.58, 6, 22, SHOE_SPAN);
    shoe.rotateZ(SHOE_START);
    return shoe;
  }), CASING), CASING.clone().multiplyScalar(2.2), 'fill');

  const armour = new Group();
  for (const side of [-1, 1]) {
    const angle = -Math.PI / 2 + (side * SHOE_SPAN) / 2;
    const jaw = fillMesh(shared('interlock.jaw', () => new BoxGeometry(0.78, 1.6, 0.78)), CASING);
    jaw.position.set(Math.cos(angle) * SHOE_RADIUS, Math.sin(angle) * SHOE_RADIUS, 0);
    jaw.rotation.z = angle + Math.PI / 2;
    context.parts.push({ material: jaw.material as MeshBasicMaterial, base: CASING.clone().multiplyScalar(3.2), kind: 'fill' });
    armour.add(jaw);

    const brace = glowMesh(shared('interlock.brace', () => new BoxGeometry(0.16, 1.4, 0.16)), hdr(FAULT, 0.8));
    brace.position.set(Math.cos(angle) * (SHOE_RADIUS * 0.55), Math.sin(angle) * (SHOE_RADIUS * 0.55), 0.24);
    brace.rotation.z = angle + Math.PI / 2;
    context.parts.push({ material: brace.material as MeshBasicMaterial, base: hdr(FAULT, 0.8), kind: 'edge' });
    armour.add(brace);
  }
  context.group.add(armour);
  context.group.userData.armour = armour;

  const rim = glowMesh(
    shared('interlock.rim', () => new RingGeometry(SHOE_RADIUS - 1.12, SHOE_RADIUS - 0.86, 30, 1, SHOE_START, SHOE_SPAN)),
    hdr(FAULT, 1.3),
  );
  addPart(context, rim, hdr(FAULT, 1.3), 'edge');

  const core = glowMesh(shared('interlock.core', () => new OctahedronGeometry(0.78, 1)), hdr(FAULT, 2.4));
  core.position.y = -SHOE_RADIUS;
  addPart(context, core, hdr(FAULT, 2.4), 'core');
  context.group.userData.faultCore = core;

  for (let index = 0; index < 9; index += 1) {
    const angle = (index / 9) * Math.PI * 2;
    context.shards.push(shard(
      Math.cos(angle),
      Math.sin(angle) - 0.6,
      (index % 3) - 1,
      index % 2 === 0 ? FAULT : HOSTILE_DEEP,
      0.7,
    ));
  }
  return finish(context, 'interlock', FAULT, 1.9);
}

/** First hit stage cleared: the clamp's armour blows off and the fault core is bare. */
export function breakInterlockArmour(group: Group) {
  const armour = group.userData.armour as Group | undefined;
  if (armour) armour.visible = false;
  const core = group.userData.faultCore as Mesh | undefined;
  if (core) core.scale.setScalar(1.5);
}
