import {
  BoxGeometry,
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
  SphereGeometry,
  TorusGeometry,
  Vector3,
} from 'three';
import { createAdditiveBasicMaterial } from '../../../engine/visual-kit';
import type { ShardSpec } from './effects';
import { CRIMSON_FIRE, MOLTEN_ORANGE, OBSIDIAN, OBSIDIAN_LIT, PLAYER_WHITE, hdr } from './palette';

// Enemy small craft and the flagship's targetable fittings. Everything
// hostile is obsidian mass with molten-orange seams and crimson optics — no
// cyan anywhere, so targets can never be confused with the friendly fleet.
// Each kind fills a different piece of sky with a different motion, and each
// silhouette is built to be readable at forty-plus units against the nebula.

export type TintPart = {
  material: MeshBasicMaterial;
  base: Color;
  kind: 'fill' | 'edge' | 'core';
};

type PartsBuilder = {
  group: Group;
  parts: TintPart[];
  shards: ShardSpec[];
  fill(mesh: Mesh, color?: Color): Mesh;
  edge(mesh: Mesh, color?: Color, intensity?: number): Mesh;
  core(mesh: Mesh, color?: Color, intensity?: number): Mesh;
  shard(direction: Vector3, color: Color, size: number): void;
};

function builder(): PartsBuilder {
  const group = new Group();
  const parts: TintPart[] = [];
  const shards: ShardSpec[] = [];
  const add = (mesh: Mesh, kind: TintPart['kind'], base: Color): Mesh => {
    parts.push({ material: mesh.material as MeshBasicMaterial, base, kind });
    group.add(mesh);
    return mesh;
  };
  return {
    group,
    parts,
    shards,
    fill(mesh, color = OBSIDIAN_LIT) {
      (mesh.material as MeshBasicMaterial).color.copy(color);
      return add(mesh, 'fill', color.clone());
    },
    edge(mesh, color = MOLTEN_ORANGE, intensity = 0.9) {
      const material = createAdditiveBasicMaterial({ color: hdr(color, intensity) });
      mesh.material = material;
      return add(mesh, 'edge', hdr(color, intensity));
    },
    core(mesh, color = CRIMSON_FIRE, intensity = 1.3) {
      const material = createAdditiveBasicMaterial({ color: hdr(color, intensity) });
      mesh.material = material;
      return add(mesh, 'core', hdr(color, intensity));
    },
    shard(direction, color, size) {
      shards.push({ direction, color, size });
    },
  };
}

function finish(b: PartsBuilder, accent: Color, lockRingScale = 1) {
  b.group.userData.parts = b.parts;
  b.group.userData.shardSpecs = b.shards;
  b.group.userData.accent = accent.clone();
  b.group.userData.lockRingScale = lockRingScale;
  return b.group;
}

function box(w: number, h: number, d: number) {
  return new Mesh(new BoxGeometry(w, h, d), new MeshBasicMaterial());
}

// ---- dart: a sharp delta slasher, the swarm's basic fighter --------------------

export function createDartMesh() {
  const b = builder();
  // Needle nose and broad swept wings: a flat arrowhead, nose along +Z.
  const nose = new Mesh(new ConeGeometry(0.22, 1.6, 4), new MeshBasicMaterial());
  nose.rotation.x = Math.PI / 2;
  nose.position.z = 0.7;
  nose.scale.set(0.7, 1, 1);
  b.fill(nose, OBSIDIAN_LIT);
  for (const side of [-1, 1]) {
    const wing = box(1.35, 0.06, 0.85);
    wing.position.set(side * 0.72, 0, -0.25);
    wing.rotation.y = side * 0.5;
    b.fill(wing, OBSIDIAN);
    const leading = box(1.3, 0.045, 0.08);
    leading.position.set(side * 0.72, 0.015, 0.12);
    leading.rotation.y = side * 0.5;
    b.edge(leading, MOLTEN_ORANGE, 0.85);
    const tip = new Mesh(new SphereGeometry(0.07, 6, 5), new MeshBasicMaterial());
    tip.position.set(side * 1.32, 0, -0.58);
    b.core(tip, CRIMSON_FIRE, 1.3);
    b.shard(new Vector3(side, -0.15, 0), OBSIDIAN_LIT.clone().lerp(MOLTEN_ORANGE, 0.3), 0.36);
  }
  const canopy = box(0.14, 0.09, 0.4);
  canopy.position.set(0, 0.1, 0.25);
  b.core(canopy, CRIMSON_FIRE, 1.5);
  b.shard(new Vector3(0, 0.8, 0.4), CRIMSON_FIRE.clone(), 0.3);
  b.shard(new Vector3(0, -0.5, -0.6), OBSIDIAN_LIT.clone(), 0.34);
  return finish(b, CRIMSON_FIRE);
}

// ---- weaver: twin-boom braid fighter ---------------------------------------------

export function createWeaverMesh() {
  const b = builder();
  // Two slender pods joined at the wing: reads as a flying H, built to be
  // watched corkscrewing around its pair-mate.
  for (const side of [-1, 1]) {
    const pod = new Mesh(new CylinderGeometry(0.16, 0.24, 1.7, 6), new MeshBasicMaterial());
    pod.rotation.x = Math.PI / 2;
    pod.position.set(side * 0.62, 0, 0);
    b.fill(pod, OBSIDIAN_LIT);
    const tail = new Mesh(new ConeGeometry(0.16, 0.5, 6), new MeshBasicMaterial());
    tail.rotation.x = -Math.PI / 2;
    tail.position.set(side * 0.62, 0, -1.05);
    b.edge(tail, MOLTEN_ORANGE, 1.0);
    const slit = box(0.06, 0.06, 0.5);
    slit.position.set(side * 0.62, 0.14, 0.35);
    b.core(slit, CRIMSON_FIRE, 1.4);
    b.shard(new Vector3(side, 0, -0.5), MOLTEN_ORANGE.clone(), 0.3);
  }
  const spar = box(1.5, 0.07, 0.3);
  spar.position.z = -0.1;
  b.fill(spar, OBSIDIAN);
  const sparEdge = box(1.5, 0.045, 0.06);
  sparEdge.position.set(0, 0.02, 0.06);
  b.edge(sparEdge, MOLTEN_ORANGE, 0.75);
  const eye = new Mesh(new SphereGeometry(0.11, 6, 5), new MeshBasicMaterial());
  eye.position.set(0, 0.05, 0.62);
  b.core(eye, CRIMSON_FIRE, 1.6);
  b.shard(new Vector3(0, 0.5, 0.6), CRIMSON_FIRE.clone(), 0.32);
  return finish(b, MOLTEN_ORANGE);
}

// ---- gunship: armored weapons platform with staged plating -------------------------

export function createGunshipMesh() {
  const b = builder();
  const hull = box(1.7, 0.8, 2.6);
  b.fill(hull, OBSIDIAN_LIT);
  // Side weapon pods.
  for (const side of [-1, 1]) {
    const pod = box(0.55, 0.55, 1.6);
    pod.position.set(side * 1.15, -0.05, 0.3);
    b.fill(pod, OBSIDIAN);
    const barrel = new Mesh(new CylinderGeometry(0.09, 0.12, 1.3, 6), new MeshBasicMaterial());
    barrel.rotation.x = Math.PI / 2;
    barrel.position.set(side * 1.15, -0.05, 1.65);
    b.edge(barrel, MOLTEN_ORANGE, 0.8);
    b.shard(new Vector3(side, -0.2, 0.3), OBSIDIAN_LIT.clone(), 0.5);
  }
  // Top fin and crimson viewport.
  const fin = box(0.12, 0.7, 1.1);
  fin.position.set(0, 0.7, -0.7);
  b.fill(fin, OBSIDIAN);
  const viewport = box(1.1, 0.14, 0.08);
  viewport.position.set(0, 0.16, 1.31);
  b.core(viewport, CRIMSON_FIRE, 1.5);
  // Bow armor plates: they crack away at the stage break.
  const armor: Mesh[] = [];
  for (const [x, y, rz] of [[-0.5, 0.34, 0.24], [0.5, 0.34, -0.24], [0, -0.42, 0]] as const) {
    const plate = box(0.85, 0.6, 0.16);
    plate.position.set(x, y, 1.38);
    plate.rotation.z = rz;
    b.fill(plate, OBSIDIAN.clone().lerp(OBSIDIAN_LIT, 0.5));
    armor.push(plate);
    b.shard(new Vector3(x * 1.6, y, 1), OBSIDIAN_LIT.clone().lerp(PLAYER_WHITE, 0.25), 0.45);
  }
  // Muzzle lamp under the bow: climbs to white-hot before each bolt.
  const muzzle = new Mesh(new SphereGeometry(0.17, 8, 6), new MeshBasicMaterial());
  muzzle.position.set(0, -0.3, 1.4);
  const muzzlePart = b.core(muzzle, CRIMSON_FIRE, 0.8);
  b.group.userData.chargeLamp = muzzlePart.material;
  b.group.userData.armorPlates = armor;
  b.shard(new Vector3(0, 1, -0.5), OBSIDIAN_LIT.clone(), 0.5);
  b.shard(new Vector3(0, -0.6, 1), CRIMSON_FIRE.clone(), 0.42);
  return finish(b, CRIMSON_FIRE, 1.4);
}

export function breakGunshipArmor(group: Group) {
  const plates = group.userData.armorPlates as Mesh[] | undefined;
  if (!plates) return;
  for (const plate of plates) plate.visible = false;
}

// ---- mine: a drifting spiked charge ------------------------------------------------

export function createMineMesh() {
  const b = builder();
  const body = new Mesh(new IcosahedronGeometry(0.55, 0), new MeshBasicMaterial());
  b.fill(body, OBSIDIAN_LIT);
  for (let i = 0; i < 8; i += 1) {
    const phi = Math.acos(1 - (2 * (i + 0.5)) / 8);
    const theta = i * 2.399963;
    const direction = new Vector3(Math.sin(phi) * Math.cos(theta), Math.cos(phi), Math.sin(phi) * Math.sin(theta));
    const spike = new Mesh(new ConeGeometry(0.11, 0.62, 5), new MeshBasicMaterial());
    spike.position.copy(direction).multiplyScalar(0.62);
    spike.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), direction);
    b.fill(spike, OBSIDIAN);
    b.shard(direction, OBSIDIAN_LIT.clone().lerp(MOLTEN_ORANGE, 0.4), 0.3);
  }
  // The pulsing heart you read across the wreck field.
  const heart = new Mesh(new SphereGeometry(0.3, 8, 6), new MeshBasicMaterial());
  const heartPart = b.core(heart, MOLTEN_ORANGE, 1.2);
  b.group.userData.heartLamp = heartPart.material;
  b.shard(new Vector3(0, 1, 0), MOLTEN_ORANGE.clone(), 0.5);
  return finish(b, MOLTEN_ORANGE, 1.1);
}

// ---- turret: belly-mounted point-defense gun, raked in passing ------------------------

export function createTurretMesh() {
  const b = builder();
  const plate = new Mesh(new CylinderGeometry(1.15, 1.35, 0.4, 8), new MeshBasicMaterial());
  b.fill(plate, OBSIDIAN);
  const dome = new Mesh(new SphereGeometry(0.85, 10, 7), new MeshBasicMaterial());
  dome.position.y = 0.55;
  dome.scale.set(1, 0.72, 1);
  b.fill(dome, OBSIDIAN_LIT);
  for (const side of [-1, 1]) {
    const barrel = new Mesh(new CylinderGeometry(0.1, 0.14, 1.9, 6), new MeshBasicMaterial());
    barrel.rotation.x = Math.PI / 2;
    barrel.position.set(side * 0.3, 0.62, 1.0);
    b.fill(barrel, OBSIDIAN);
    const tip = new Mesh(new CylinderGeometry(0.13, 0.13, 0.24, 6), new MeshBasicMaterial());
    tip.rotation.x = Math.PI / 2;
    tip.position.set(side * 0.3, 0.62, 1.95);
    b.edge(tip, MOLTEN_ORANGE, 0.85);
  }
  const sensor = box(0.5, 0.12, 0.1);
  sensor.position.set(0, 0.95, 0.62);
  b.core(sensor, CRIMSON_FIRE, 1.5);
  b.shard(new Vector3(0, 1, 0.4), OBSIDIAN_LIT.clone().lerp(PLAYER_WHITE, 0.2), 0.6);
  b.shard(new Vector3(0.7, 0.4, -0.3), MOLTEN_ORANGE.clone(), 0.4);
  b.shard(new Vector3(-0.7, 0.4, -0.3), MOLTEN_ORANGE.clone(), 0.4);
  return finish(b, MOLTEN_ORANGE, 1.5);
}

// ---- escort: bay-launched interceptor, swept forward -----------------------------------

export function createEscortMesh() {
  const b = builder();
  const body = new Mesh(new ConeGeometry(0.3, 1.9, 5), new MeshBasicMaterial());
  body.rotation.x = Math.PI / 2;
  body.scale.set(0.8, 1, 1);
  b.fill(body, OBSIDIAN_LIT);
  // Forward-swept wings: the silhouette of something launched, not scrambled.
  for (const side of [-1, 1]) {
    const wing = box(1.1, 0.06, 0.7);
    wing.position.set(side * 0.62, 0, 0.18);
    wing.rotation.y = -side * 0.42;
    b.fill(wing, OBSIDIAN);
    const edgeStrip = box(1.06, 0.045, 0.08);
    edgeStrip.position.set(side * 0.62, 0.015, 0.47);
    edgeStrip.rotation.y = -side * 0.42;
    b.edge(edgeStrip, CRIMSON_FIRE, 0.95);
    b.shard(new Vector3(side, 0, 0.4), CRIMSON_FIRE.clone(), 0.34);
  }
  const eye = box(0.16, 0.1, 0.34);
  eye.position.set(0, 0.12, 0.5);
  b.core(eye, MOLTEN_ORANGE, 1.5);
  b.shard(new Vector3(0, 0.6, 0.6), MOLTEN_ORANGE.clone(), 0.32);
  b.shard(new Vector3(0, -0.4, -0.7), OBSIDIAN_LIT.clone(), 0.36);
  return finish(b, CRIMSON_FIRE);
}

// ---- bolt: hostile crimson round --------------------------------------------------------

export function createBoltMesh() {
  const b = builder();
  const core = new Mesh(new OctahedronGeometry(0.28, 0), new MeshBasicMaterial());
  core.scale.set(0.55, 0.55, 2.1);
  b.fill(core, OBSIDIAN);
  const glow = new Mesh(new OctahedronGeometry(0.38, 0), new MeshBasicMaterial());
  glow.scale.set(0.5, 0.5, 1.9);
  b.core(glow, CRIMSON_FIRE, 1.5);
  b.shard(new Vector3(0, -1, 0), CRIMSON_FIRE.clone(), 0.3);
  b.group.userData.isHostileShot = true;
  b.group.userData.trailColor = CRIMSON_FIRE.clone().multiplyScalar(0.6);
  return finish(b, CRIMSON_FIRE, 0.85);
}

// ---- generator: shield projector dome on the flagship's flank ------------------------------

export function createGeneratorMesh() {
  const b = builder();
  const pylon = new Mesh(new CylinderGeometry(0.5, 0.9, 1.6, 8), new MeshBasicMaterial());
  pylon.rotation.z = Math.PI / 2;
  pylon.position.x = -0.7;
  b.fill(pylon, OBSIDIAN);
  const dome = new Mesh(new SphereGeometry(1.05, 12, 8), new MeshBasicMaterial());
  dome.position.x = 0.45;
  dome.scale.set(0.8, 1, 1);
  b.fill(dome, OBSIDIAN_LIT);
  // Emitter ring: the shield's heartbeat, dying when the dome does.
  const ring = new Mesh(new TorusGeometry(1.25, 0.09, 6, 24), new MeshBasicMaterial());
  ring.position.x = 0.55;
  ring.rotation.y = Math.PI / 2;
  const ringPart = b.edge(ring, MOLTEN_ORANGE, 1.1);
  b.group.userData.emitterRing = ringPart.material;
  const cap = new Mesh(new SphereGeometry(0.3, 8, 6), new MeshBasicMaterial());
  cap.position.set(1.35, 0, 0);
  b.core(cap, CRIMSON_FIRE, 1.4);
  b.shard(new Vector3(1, 0.4, 0), MOLTEN_ORANGE.clone(), 0.6);
  b.shard(new Vector3(0.6, -0.8, 0.4), OBSIDIAN_LIT.clone(), 0.55);
  b.shard(new Vector3(0.6, 0.4, -0.8), OBSIDIAN_LIT.clone(), 0.55);
  return finish(b, MOLTEN_ORANGE, 1.7);
}

// ---- node: trench power canister ----------------------------------------------------------------

export function createNodeMesh() {
  const b = builder();
  const shell = new Mesh(new CylinderGeometry(0.8, 0.8, 2.2, 8), new MeshBasicMaterial());
  b.fill(shell, OBSIDIAN_LIT);
  const capTop = new Mesh(new CylinderGeometry(0.55, 0.8, 0.4, 8), new MeshBasicMaterial());
  capTop.position.y = 1.3;
  b.fill(capTop, OBSIDIAN);
  const capBottom = new Mesh(new CylinderGeometry(0.8, 0.55, 0.4, 8), new MeshBasicMaterial());
  capBottom.position.y = -1.3;
  b.fill(capBottom, OBSIDIAN);
  // Molten slats: the power underneath, visible through the armor.
  for (let i = 0; i < 4; i += 1) {
    const angle = (i / 4) * Math.PI * 2;
    const slat = box(0.16, 1.7, 0.16);
    slat.position.set(Math.cos(angle) * 0.82, 0, Math.sin(angle) * 0.82);
    b.core(slat, MOLTEN_ORANGE, 1.35);
    b.shard(new Vector3(Math.cos(angle), 0, Math.sin(angle)), MOLTEN_ORANGE.clone(), 0.45);
  }
  b.shard(new Vector3(0, 1, 0), CRIMSON_FIRE.clone(), 0.4);
  return finish(b, MOLTEN_ORANGE, 1.4);
}

// ---- core: the flagship's heart ----------------------------------------------------------------------

export function createCoreMesh() {
  const b = builder();
  const heart = new Mesh(new IcosahedronGeometry(1.5, 1), new MeshBasicMaterial());
  const heartPart = b.core(heart, MOLTEN_ORANGE, 1.5);
  b.group.userData.heartMaterial = heartPart.material;
  // Gyro cage: two dark rings that keep the heart reading as machinery.
  const cageA = new Mesh(new TorusGeometry(2.3, 0.22, 6, 20), new MeshBasicMaterial());
  b.fill(cageA, OBSIDIAN);
  const cageB = new Mesh(new TorusGeometry(2.9, 0.18, 6, 22), new MeshBasicMaterial());
  cageB.rotation.x = Math.PI / 2;
  b.fill(cageB, OBSIDIAN_LIT);
  b.group.userData.cageA = cageA;
  b.group.userData.cageB = cageB;
  for (let i = 0; i < 4; i += 1) {
    const angle = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const strut = box(0.3, 0.3, 2.4);
    strut.position.set(Math.cos(angle) * 2.2, Math.sin(angle) * 2.2, 0);
    strut.rotation.z = angle + Math.PI / 2;
    b.fill(strut, OBSIDIAN);
  }
  const slit = new Mesh(new RingGeometry(1.62, 1.78, 24), new MeshBasicMaterial({ side: DoubleSide }));
  b.edge(slit, CRIMSON_FIRE, 1.1);
  b.shard(new Vector3(0, 0, 1), MOLTEN_ORANGE.clone(), 1.2);
  b.shard(new Vector3(1, 0.6, 0), MOLTEN_ORANGE.clone(), 0.9);
  b.shard(new Vector3(-0.7, -0.8, 0), CRIMSON_FIRE.clone(), 0.9);
  return finish(b, MOLTEN_ORANGE, 3.4);
}
