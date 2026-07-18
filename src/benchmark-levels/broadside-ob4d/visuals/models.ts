import {
  BoxGeometry,
  BufferGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  Group,
  IcosahedronGeometry,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  OctahedronGeometry,
  PlaneGeometry,
  RingGeometry,
  SphereGeometry,
  Vector3,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { createAdditiveBasicMaterial } from '../../../engine/visual-kit';
import type { ShardSpec } from './effects';
import {
  ALLY_CYAN,
  FOE_CRIMSON,
  FOE_HULL,
  FOE_MOLTEN,
  FOE_PLATE,
  NEBULA_GOLD,
  NEBULA_MAGENTA,
  WHITE_HOT,
  hdr,
} from './palette';

// Enemy construction. Every hostile in the level is built from the same three
// material roles so the tint pass in visuals/index.ts can speak about any of
// them without knowing what it is:
//
//   fill  the obsidian body — the silhouette, and the only non-additive part
//   edge  nebula-rimmed chines and armour lines — how the shape reads at range
//   core  molten orange and crimson light — engines, optics, muzzles
//
// Silhouettes are deliberately unlike each other in outline, not just in
// detail: the dart is a long thin triangle, the wasp is a wide H, the battery
// is a squat rectangle with two prongs, the escort is a broad shallow delta,
// and the boss hardware is round.

export type TintPart = { material: MeshBasicMaterial; base: Color; kind: 'fill' | 'edge' | 'core' };

type Build = {
  group: Group;
  parts: TintPart[];
  shards: ShardSpec[];
};

function startBuild(): Build {
  return { group: new Group(), parts: [], shards: [] };
}

function addFill(build: Build, geometries: BufferGeometry[], color: Color) {
  if (!geometries.length) return;
  const material = new MeshBasicMaterial({ color: color.clone() });
  build.group.add(new Mesh(mergeGeometries(geometries), material));
  for (const geometry of geometries) geometry.dispose();
  build.parts.push({ material, base: color.clone(), kind: 'fill' });
}

function addGlow(build: Build, geometries: BufferGeometry[], color: Color, kind: 'edge' | 'core', side = false) {
  if (!geometries.length) return;
  const material = createAdditiveBasicMaterial({ color: color.clone(), side: side ? DoubleSide : undefined });
  build.group.add(new Mesh(mergeGeometries(geometries), material));
  for (const geometry of geometries) geometry.dispose();
  build.parts.push({ material, base: color.clone(), kind });
}

function shard(x: number, y: number, z: number, color: Color, size: number): ShardSpec {
  return { direction: new Vector3(x, y, z).normalize(), color: color.clone(), size };
}

function finish(build: Build, accent: Color, lockRingScale = 1) {
  build.group.userData.parts = build.parts;
  build.group.userData.shardSpecs = build.shards;
  build.group.userData.accent = accent.clone();
  build.group.userData.lockRingScale = lockRingScale;
  return build.group;
}

const box = (w: number, h: number, d: number, x = 0, y = 0, z = 0) =>
  new BoxGeometry(w, h, d).applyMatrix4(new Matrix4().makeTranslation(x, y, z));

/** Meshes fly nose-first: Object3D.lookAt points local +Z at the target. */
const forwardCone = (radius: number, height: number, segments: number, z: number) =>
  new ConeGeometry(radius, height, segments)
    .applyMatrix4(new Matrix4().makeRotationX(Math.PI / 2))
    .applyMatrix4(new Matrix4().makeTranslation(0, 0, z));

// ---- interceptor: the swarm dart ------------------------------------------------
// A long thin triangle. Read at a glance as "fast, small, and pointed at you".

export function createInterceptorMesh() {
  const build = startBuild();

  addFill(build, [
    forwardCone(0.34, 1.9, 4, 0.35),
    box(0.24, 0.16, 0.8, 0, 0, -0.5),
    // Swept wings, thin enough to vanish edge-on and wide enough to bank against.
    box(1.5, 0.05, 0.34, 0, -0.02, -0.42).applyMatrix4(new Matrix4().makeShear(0, 0, 0, 0, 0.55, 0)),
  ], FOE_HULL);

  addGlow(build, [
    // Chine lines: the nebula catching both edges of the wing.
    box(1.44, 0.035, 0.05, 0, 0.05, -0.3),
    box(0.05, 0.03, 1.5, 0, 0.14, 0.15),
  ], NEBULA_MAGENTA, 'edge');

  addGlow(build, [
    box(0.16, 0.09, 0.24, 0, 0.02, -0.86),
    box(0.08, 0.06, 0.5, 0, 0.11, 0.5),
  ], FOE_MOLTEN, 'core');

  build.shards.push(
    shard(0, 0.3, 1, FOE_MOLTEN, 0.42),
    shard(-1, 0, -0.2, FOE_HULL, 0.5),
    shard(1, 0, -0.2, FOE_HULL, 0.5),
    shard(0, -0.6, -0.6, NEBULA_MAGENTA, 0.34),
    shard(0.3, 0.7, -0.3, FOE_MOLTEN, 0.3),
  );
  return finish(build, FOE_MOLTEN, 0.95);
}

// ---- wasp: the twin-boom fighter ------------------------------------------------
// A wide H. Where the dart is a line, this is a frame — unmistakable when the
// two silhouettes share a frame, which they usually do.

export function createWaspMesh() {
  const build = startBuild();
  const booms: BufferGeometry[] = [];
  for (const side of [-1, 1]) {
    booms.push(box(0.17, 0.17, 1.7, side * 0.62, 0, 0));
    booms.push(forwardCone(0.13, 0.5, 4, 0.98).applyMatrix4(new Matrix4().makeTranslation(side * 0.62, 0, 0)));
  }
  addFill(build, [
    ...booms,
    box(0.5, 0.34, 0.34),
    box(1.3, 0.12, 0.3, 0, 0, -0.34),
  ], FOE_HULL);

  const pod = new Mesh(new OctahedronGeometry(0.4, 0), new MeshBasicMaterial({ color: FOE_PLATE.clone() }));
  pod.scale.set(1, 0.9, 1.4);
  build.group.add(pod);
  build.parts.push({ material: pod.material as MeshBasicMaterial, base: FOE_PLATE.clone(), kind: 'fill' });

  // A ring strung between the booms: the shape that makes it read as a frame.
  const ring = new Mesh(
    new RingGeometry(0.5, 0.56, 24),
    createAdditiveBasicMaterial({ color: NEBULA_GOLD.clone(), side: DoubleSide }),
  );
  ring.position.z = -0.2;
  build.group.add(ring);
  build.parts.push({ material: ring.material as MeshBasicMaterial, base: NEBULA_GOLD.clone(), kind: 'edge' });

  addGlow(build, [
    box(0.12, 0.12, 0.16, -0.62, 0, -0.88),
    box(0.12, 0.12, 0.16, 0.62, 0, -0.88),
    box(0.1, 0.1, 0.1, 0, 0, 0.44),
  ], FOE_MOLTEN, 'core');

  build.shards.push(
    shard(-1, 0.2, 0, FOE_HULL, 0.5),
    shard(1, 0.2, 0, FOE_HULL, 0.5),
    shard(0, 1, 0.3, NEBULA_GOLD, 0.36),
    shard(0, -1, 0.3, NEBULA_GOLD, 0.36),
    shard(0, 0, -1, FOE_MOLTEN, 0.4),
  );
  return finish(build, FOE_MOLTEN, 1.1);
}

// ---- turret: the hull battery ----------------------------------------------------
// Squat, rooted, and two-pronged: the only hostile that never moves off its mount.

export function createTurretMesh() {
  const build = startBuild();
  const barbette = new CylinderGeometry(0.78, 0.92, 0.36, 8)
    .applyMatrix4(new Matrix4().makeRotationX(Math.PI / 2))
    .applyMatrix4(new Matrix4().makeTranslation(0, 0, -0.5));

  addFill(build, [
    barbette,
    box(1.0, 0.68, 0.72, 0, 0, 0),
    box(0.15, 0.15, 1.5, -0.26, 0.04, 0.72),
    box(0.15, 0.15, 1.5, 0.26, 0.04, 0.72),
    box(0.72, 0.2, 0.24, 0, 0.42, 0.1),
  ], FOE_PLATE);

  addGlow(build, [
    // Armour collar: a hard ring of nebula light around the barbette.
    box(1.7, 0.05, 0.05, 0, 0.36, -0.4),
    box(1.7, 0.05, 0.05, 0, -0.36, -0.4),
    box(0.05, 0.76, 0.05, -0.85, 0, -0.4),
    box(0.05, 0.76, 0.05, 0.85, 0, -0.4),
  ], NEBULA_MAGENTA, 'edge');

  // Muzzles and the tracking optic, kept as their own material so the charge
  // ramp can drive them independently of the rest of the body.
  const muzzleMaterial = createAdditiveBasicMaterial({ color: FOE_CRIMSON.clone() });
  const muzzles = mergeGeometries([
    box(0.2, 0.2, 0.12, -0.26, 0.04, 1.46),
    box(0.2, 0.2, 0.12, 0.26, 0.04, 1.46),
    box(0.34, 0.1, 0.08, 0, 0.42, 0.24),
  ]);
  build.group.add(new Mesh(muzzles, muzzleMaterial));
  build.parts.push({ material: muzzleMaterial, base: FOE_CRIMSON.clone(), kind: 'core' });
  build.group.userData.chargeMaterial = muzzleMaterial;

  build.shards.push(
    shard(-0.8, 0.3, 0.5, FOE_PLATE, 0.5),
    shard(0.8, 0.3, 0.5, FOE_PLATE, 0.5),
    shard(0, 1, 0, NEBULA_MAGENTA, 0.4),
    shard(-0.5, -0.8, 0, FOE_PLATE, 0.44),
    shard(0.5, -0.8, 0, FOE_PLATE, 0.44),
    shard(0, 0.2, 1, FOE_CRIMSON, 0.5),
  );
  return finish(build, FOE_CRIMSON, 1.25);
}

// ---- escort: the heavy delta -----------------------------------------------------
// Broad and shallow, with forward-swept canards that give it a distinct
// leading edge. Arrives in formation, so its width is doing choreography work.

export function createEscortMesh() {
  const build = startBuild();
  addFill(build, [
    forwardCone(0.42, 1.3, 3, 0.75),
    box(2.5, 0.13, 1.1, 0, 0, -0.15),
    box(0.9, 0.3, 1.5, 0, 0.05, -0.1),
    // Forward-swept canards.
    box(1.1, 0.07, 0.3, -0.85, 0.08, 0.55).applyMatrix4(new Matrix4().makeRotationZ(0.16)),
    box(1.1, 0.07, 0.3, 0.85, 0.08, 0.55).applyMatrix4(new Matrix4().makeRotationZ(-0.16)),
    box(0.1, 0.6, 0.6, 0, 0.38, -0.5),
  ], FOE_HULL);

  addGlow(build, [
    box(2.44, 0.04, 0.06, 0, 0.07, 0.32),
    box(2.44, 0.04, 0.06, 0, -0.07, -0.68),
    box(0.05, 0.5, 0.05, 0, 0.62, -0.5),
  ], NEBULA_MAGENTA, 'edge');

  addGlow(build, [
    box(0.2, 0.14, 0.2, -0.45, 0.02, -0.86),
    box(0.2, 0.14, 0.2, 0, 0.02, -0.9),
    box(0.2, 0.14, 0.2, 0.45, 0.02, -0.86),
    box(0.5, 0.06, 0.3, 0, 0.16, 0.66),
  ], FOE_MOLTEN, 'core');

  build.shards.push(
    shard(-1, 0.1, 0, FOE_HULL, 0.62),
    shard(1, 0.1, 0, FOE_HULL, 0.62),
    shard(0, 1, 0.2, NEBULA_MAGENTA, 0.44),
    shard(0, -0.8, 0.4, FOE_HULL, 0.5),
    shard(-0.4, 0.2, -1, FOE_MOLTEN, 0.46),
    shard(0.4, 0.2, -1, FOE_MOLTEN, 0.46),
    shard(0, 0.3, 1, FOE_HULL, 0.5),
  );
  return finish(build, FOE_MOLTEN, 1.35);
}

// ---- shell: point-defence fire ----------------------------------------------------
// The only crimson thing that moves toward you. Small, spinning, and lockable.

export function createShellMesh() {
  const build = startBuild();
  const core = new OctahedronGeometry(0.26, 0);
  core.scale(0.7, 0.7, 2.1);
  const halo = new OctahedronGeometry(0.42, 0);
  halo.scale(0.9, 0.9, 1.5);
  addGlow(build, [core], hdr(FOE_CRIMSON, 2.4), 'core');
  addGlow(build, [halo], hdr(FOE_CRIMSON, 0.5), 'core');
  addGlow(build, [
    box(0.7, 0.03, 0.03, 0, 0, -0.25),
    box(0.03, 0.7, 0.03, 0, 0, -0.25),
  ], hdr(NEBULA_GOLD, 0.7), 'edge');

  build.shards.push(shard(0, 1, 0, FOE_CRIMSON, 0.28), shard(0, -1, 0, FOE_CRIMSON, 0.28));
  build.group.userData.isHostileShot = true;
  build.group.userData.trailColor = FOE_CRIMSON.clone().multiplyScalar(0.75);
  return finish(build, FOE_CRIMSON, 0.8);
}

// ---- shield emitter ---------------------------------------------------------------
// A hexagonal drum on the flagship's flank under a hard-light dome. The dome is
// the mechanic: while it is up the emitter cannot be locked, and it drops on
// the beat when the battery underneath fires.

export function createGeneratorMesh() {
  const build = startBuild();
  const drum = new CylinderGeometry(1.05, 1.25, 0.72, 6)
    .applyMatrix4(new Matrix4().makeRotationX(Math.PI / 2))
    .applyMatrix4(new Matrix4().makeTranslation(0, 0, -0.5));
  const ribs: BufferGeometry[] = [];
  for (let i = 0; i < 6; i += 1) {
    const angle = (i / 6) * Math.PI * 2;
    ribs.push(box(0.16, 0.5, 1.0, Math.cos(angle) * 1.0, Math.sin(angle) * 1.0, -0.1)
      .applyMatrix4(new Matrix4().makeRotationZ(angle)));
  }
  addFill(build, [drum, ...ribs], FOE_PLATE);

  addGlow(build, [
    box(2.3, 0.06, 0.06, 0, 1.1, -0.4),
    box(2.3, 0.06, 0.06, 0, -1.1, -0.4),
  ], NEBULA_MAGENTA, 'edge');

  const emitter = new Mesh(
    new IcosahedronGeometry(0.52, 1),
    createAdditiveBasicMaterial({ color: hdr(FOE_MOLTEN, 1.6) }),
  );
  emitter.position.z = 0.24;
  build.group.add(emitter);
  build.parts.push({ material: emitter.material as MeshBasicMaterial, base: hdr(FOE_MOLTEN, 1.6), kind: 'core' });
  build.group.userData.emitter = emitter;

  // The dome. Kept out of `parts` so the tint pass never fights the shield
  // animation for control of its colour.
  const domeMaterial = createAdditiveBasicMaterial({
    color: hdr(NEBULA_MAGENTA, 1.1),
    opacity: 0.5,
    side: DoubleSide,
  });
  const dome = new Mesh(new SphereGeometry(2.0, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2), domeMaterial);
  dome.rotation.x = -Math.PI / 2;
  dome.position.z = -0.2;
  build.group.add(dome);
  build.group.userData.dome = dome;
  build.group.userData.domeMaterial = domeMaterial;

  build.shards.push(
    shard(0, 1, 0.3, NEBULA_MAGENTA, 0.62),
    shard(0.87, 0.5, 0.3, FOE_PLATE, 0.62),
    shard(0.87, -0.5, 0.3, FOE_PLATE, 0.62),
    shard(0, -1, 0.3, NEBULA_MAGENTA, 0.62),
    shard(-0.87, -0.5, 0.3, FOE_PLATE, 0.62),
    shard(-0.87, 0.5, 0.3, FOE_PLATE, 0.62),
    shard(0, 0, 1, FOE_MOLTEN, 0.8),
  );
  build.group.userData.isGenerator = true;
  return finish(build, NEBULA_MAGENTA, 1.6);
}

// ---- reactor coupling ---------------------------------------------------------------
// Round where everything else is angular: a caged sphere breathing orange in
// the trench wall. The armour cage sheds on the stage break so the second half
// of the fight visibly targets something different from the first.

export function createCoreMesh() {
  const build = startBuild();
  const struts: BufferGeometry[] = [];
  for (let i = 0; i < 4; i += 1) {
    const angle = (i / 4) * Math.PI * 2 + Math.PI / 4;
    struts.push(box(0.22, 0.22, 2.2, Math.cos(angle) * 1.15, Math.sin(angle) * 1.15, 0));
  }
  struts.push(new CylinderGeometry(1.5, 1.5, 0.3, 8)
    .applyMatrix4(new Matrix4().makeRotationX(Math.PI / 2))
    .applyMatrix4(new Matrix4().makeTranslation(0, 0, -1.05)));
  addFill(build, struts, FOE_PLATE);

  const glowSphere = new Mesh(
    new IcosahedronGeometry(0.95, 2),
    createAdditiveBasicMaterial({ color: hdr(FOE_MOLTEN, 1.4) }),
  );
  build.group.add(glowSphere);
  build.parts.push({ material: glowSphere.material as MeshBasicMaterial, base: hdr(FOE_MOLTEN, 1.4), kind: 'core' });
  build.group.userData.reactor = glowSphere;

  // Three orthogonal containment rings.
  const ringMaterial = createAdditiveBasicMaterial({ color: hdr(NEBULA_GOLD, 1.2), side: DoubleSide });
  for (const [rx, ry] of [[0, 0], [Math.PI / 2, 0], [0, Math.PI / 2]] as const) {
    const ring = new Mesh(new RingGeometry(1.28, 1.4, 32), ringMaterial);
    ring.rotation.set(rx, ry, 0);
    build.group.add(ring);
  }
  build.parts.push({ material: ringMaterial, base: hdr(NEBULA_GOLD, 1.2), kind: 'edge' });

  // Armour casing — stage one. Removed when the casing breaks.
  const armour = new Mesh(
    new IcosahedronGeometry(1.62, 1),
    new MeshBasicMaterial({ color: FOE_HULL.clone(), transparent: true, opacity: 0.94 }),
  );
  build.group.add(armour);
  build.group.userData.armour = armour;
  const armourRim = new Mesh(
    new RingGeometry(1.6, 1.72, 6),
    createAdditiveBasicMaterial({ color: hdr(NEBULA_MAGENTA, 1.2), side: DoubleSide }),
  );
  build.group.add(armourRim);
  build.group.userData.armourRim = armourRim;

  build.shards.push(
    shard(1, 0.4, 0.3, FOE_PLATE, 0.7),
    shard(-1, 0.4, 0.3, FOE_PLATE, 0.7),
    shard(0.4, 1, -0.2, NEBULA_GOLD, 0.6),
    shard(-0.4, -1, -0.2, NEBULA_GOLD, 0.6),
    shard(0, 0.2, 1, FOE_MOLTEN, 0.9),
    shard(0, -0.2, -1, FOE_MOLTEN, 0.9),
    shard(0.7, -0.7, 0, FOE_PLATE, 0.66),
    shard(-0.7, 0.7, 0, FOE_PLATE, 0.66),
  );
  build.group.userData.isCore = true;
  return finish(build, FOE_MOLTEN, 1.9);
}

/** Strip a coupling's armour casing when its first hit stage completes. */
export function breakCoreArmour(group: Group) {
  for (const key of ['armour', 'armourRim'] as const) {
    const mesh = group.userData[key] as Mesh | undefined;
    if (!mesh) continue;
    mesh.removeFromParent();
    mesh.geometry.dispose();
    (mesh.material as MeshBasicMaterial).dispose();
    group.userData[key] = undefined;
  }
}

// ---- player ordnance -----------------------------------------------------------------
// Cold cyan, always: the one colour on screen that belongs to you.

export function createPlayerProjectile() {
  const group = new Group();
  const core = new OctahedronGeometry(0.24, 0);
  core.scale(0.5, 0.5, 2.6);
  group.add(new Mesh(core, new MeshBasicMaterial({ color: hdr(WHITE_HOT, 2.4) })));
  const shell = new OctahedronGeometry(0.4, 0);
  shell.scale(0.6, 0.6, 2.2);
  group.add(new Mesh(shell, createAdditiveBasicMaterial({ color: hdr(ALLY_CYAN, 1.1), opacity: 0.6 })));
  const wake = new Mesh(new PlaneGeometry(0.5, 0.5), createAdditiveBasicMaterial({ color: hdr(ALLY_CYAN, 0.9), opacity: 0.5 }));
  wake.position.z = -0.7;
  group.add(wake);
  return group;
}
