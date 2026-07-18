import {
  BoxGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  OctahedronGeometry,
  SphereGeometry,
  TorusGeometry,
  Vector3,
} from 'three';
import { createAdditiveBasicMaterial } from '../../../engine/visual-kit';
import type { ShardSpec } from './effects';
import { COLD_WHITE, CRIMSON, MOLTEN, NEBULA_MAGENTA, OBSIDIAN, OBSIDIAN_EDGE, hdr } from './palette';

// Enemy hardware: obsidian mass streaked with molten orange, signal light in
// crimson. Dark bodies read as silhouettes against the nebula; the molten
// seams and crimson slits carry the same silhouettes through the trench's
// shadow. Nothing here wears the fleet's ice-white and cyan.

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
    fill(mesh, color = OBSIDIAN) {
      (mesh.material as MeshBasicMaterial).color.copy(color);
      return add(mesh, 'fill', color.clone());
    },
    edge(mesh, color = MOLTEN, intensity = 0.9) {
      const material = createAdditiveBasicMaterial({ color: hdr(color, intensity) });
      mesh.material = material;
      return add(mesh, 'edge', hdr(color, intensity));
    },
    core(mesh, color = CRIMSON, intensity = 1.3) {
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

// ---- dart: the swarm's crescent interceptor ---------------------------------

export function createDartMesh() {
  const b = builder();
  // A swept crescent: two forward-raked wings meeting at a thin blade body,
  // nose along +Z (motion uses lookAt), molten seams along the leading edges.
  for (const side of [-1, 1]) {
    const wing = box(1.6, 0.07, 0.55);
    wing.position.set(side * 0.8, 0, -0.35);
    wing.rotation.y = side * -0.7;
    b.fill(wing, OBSIDIAN);
    const seam = box(1.5, 0.045, 0.09);
    seam.position.set(side * 0.79, 0.02, -0.12);
    seam.rotation.y = side * -0.7;
    b.edge(seam, MOLTEN, 0.85);
    const tip = new Mesh(new SphereGeometry(0.07, 6, 5), new MeshBasicMaterial());
    tip.position.set(side * 1.5, 0, -0.95);
    b.core(tip, MOLTEN, 1.1);
    b.shard(new Vector3(side, -0.2, 0), OBSIDIAN_EDGE.clone().lerp(MOLTEN, 0.4), 0.4);
  }
  const body = box(0.24, 0.18, 1.05);
  b.fill(body, OBSIDIAN);
  const slit = box(0.09, 0.06, 0.5);
  slit.position.set(0, 0.08, 0.28);
  b.core(slit, CRIMSON, 1.5);
  b.shard(new Vector3(0, 1, 0.3), CRIMSON.clone(), 0.3);
  b.shard(new Vector3(0, -0.6, -0.5), OBSIDIAN_EDGE.clone().lerp(COLD_WHITE, 0.15), 0.35);
  return finish(b, MOLTEN);
}

// ---- lancer: the forked gun platform ----------------------------------------

export function createLancerMesh() {
  const b = builder();
  // A tuning fork stood on end: twin prongs with a charge arc between them.
  const hull = box(0.7, 0.6, 0.9);
  hull.position.y = -0.7;
  b.fill(hull, OBSIDIAN);
  const collar = box(0.9, 0.12, 0.5);
  collar.position.y = -0.32;
  b.edge(collar, MOLTEN, 0.8);
  for (const side of [-1, 1]) {
    const prong = box(0.18, 1.7, 0.24);
    prong.position.set(side * 0.42, 0.55, 0);
    b.fill(prong, OBSIDIAN_EDGE);
    const seam = box(0.07, 1.6, 0.08);
    seam.position.set(side * 0.42, 0.55, 0.12);
    b.edge(seam, MOLTEN, 0.75);
    const tipLamp = new Mesh(new SphereGeometry(0.1, 6, 5), new MeshBasicMaterial());
    tipLamp.position.set(side * 0.42, 1.42, 0);
    b.core(tipLamp, CRIMSON, 1.2);
    b.shard(new Vector3(side, 0.7, 0), OBSIDIAN_EDGE.clone().lerp(MOLTEN, 0.35), 0.4);
  }
  // Charge lamp between the prongs: the wind-up the player reads.
  const lamp = new Mesh(new SphereGeometry(0.17, 8, 6), new MeshBasicMaterial());
  lamp.position.set(0, 0.7, 0);
  const lampPart = b.core(lamp, CRIMSON, 0.6);
  b.group.userData.chargeLamp = lampPart.material;
  b.shard(new Vector3(0, 1, 0), CRIMSON.clone(), 0.35);
  b.shard(new Vector3(0, -1, 0.2), OBSIDIAN_EDGE.clone().lerp(COLD_WHITE, 0.2), 0.4);
  return finish(b, CRIMSON, 1.1);
}

// ---- turret: keel-mounted twin-barrel battery -------------------------------

export function createTurretMesh() {
  const b = builder();
  // Hangs off a capital keel: a mount stalk, an armored dome, twin barrels
  // toward the viewer (+Z after lookAt).
  const stalk = box(0.5, 0.9, 0.5);
  stalk.position.y = 0.85;
  b.fill(stalk, OBSIDIAN_EDGE);
  const dome = new Mesh(new SphereGeometry(0.62, 10, 7), new MeshBasicMaterial());
  dome.scale.set(1.05, 0.75, 1.05);
  b.fill(dome, OBSIDIAN);
  const band = new Mesh(new TorusGeometry(0.62, 0.05, 6, 20), new MeshBasicMaterial());
  band.rotation.x = Math.PI / 2;
  b.edge(band, MOLTEN, 0.85);
  for (const side of [-1, 1]) {
    const barrel = new Mesh(new CylinderGeometry(0.09, 0.11, 1.15, 6), new MeshBasicMaterial());
    barrel.rotation.x = Math.PI / 2;
    barrel.position.set(side * 0.26, -0.05, 0.62);
    b.fill(barrel, OBSIDIAN_EDGE);
    const muzzle = new Mesh(new SphereGeometry(0.09, 6, 5), new MeshBasicMaterial());
    muzzle.position.set(side * 0.26, -0.05, 1.2);
    const part = b.core(muzzle, CRIMSON, 0.8);
    if (side === 1) b.group.userData.chargeLamp = part.material;
    else b.group.userData.chargeLampB = part.material;
    b.shard(new Vector3(side, 0, 0.6), OBSIDIAN_EDGE.clone().lerp(MOLTEN, 0.4), 0.45);
  }
  b.shard(new Vector3(0, -1, 0.3), CRIMSON.clone(), 0.4);
  b.shard(new Vector3(0, 1, 0), OBSIDIAN_EDGE.clone().lerp(COLD_WHITE, 0.25), 0.5);
  return finish(b, MOLTEN, 1.3);
}

// ---- escort: the flagship's hex-frame fighters ------------------------------

export function createEscortMesh() {
  const b = builder();
  // A hexagonal engine frame around a slim pod — reads instantly against the
  // crescent darts even in silhouette.
  for (let i = 0; i < 6; i += 1) {
    const angle = (i / 6) * Math.PI * 2 + Math.PI / 6;
    const strut = box(0.09, 0.62, 0.12);
    strut.position.set(Math.cos(angle) * 0.62, Math.sin(angle) * 0.62, 0);
    strut.rotation.z = angle + Math.PI / 2;
    if (i % 2 === 0) b.fill(strut, OBSIDIAN_EDGE);
    else b.edge(strut, MOLTEN, 0.8);
    if (i % 2 === 0) b.shard(new Vector3(Math.cos(angle), Math.sin(angle), 0), OBSIDIAN_EDGE.clone().lerp(MOLTEN, 0.35), 0.34);
  }
  const pod = new Mesh(new OctahedronGeometry(0.34, 0), new MeshBasicMaterial());
  pod.scale.set(0.7, 0.7, 1.9);
  b.fill(pod, OBSIDIAN);
  const eye = new Mesh(new SphereGeometry(0.12, 6, 5), new MeshBasicMaterial());
  eye.position.z = 0.55;
  b.core(eye, CRIMSON, 1.5);
  const drive = new Mesh(new SphereGeometry(0.14, 6, 5), new MeshBasicMaterial());
  drive.position.z = -0.6;
  b.core(drive, MOLTEN, 1.3);
  b.shard(new Vector3(0, 0, 1), CRIMSON.clone(), 0.3);
  b.shard(new Vector3(0, 0, -1), MOLTEN.clone(), 0.35);
  return finish(b, CRIMSON, 1.05);
}

// ---- bolt: crimson plasma slug -----------------------------------------------

export function createBoltMesh() {
  const b = builder();
  const slug = new Mesh(new OctahedronGeometry(0.26, 0), new MeshBasicMaterial());
  slug.scale.set(0.6, 0.6, 1.9);
  b.fill(slug, new Color(0.16, 0.02, 0.02));
  const glow = new Mesh(new OctahedronGeometry(0.34, 0), new MeshBasicMaterial());
  glow.scale.set(0.55, 0.55, 1.7);
  b.core(glow, CRIMSON, 1.2);
  b.shard(new Vector3(0, -1, 0), CRIMSON.clone(), 0.3);
  b.group.userData.isHostileShot = true;
  b.group.userData.trailColor = CRIMSON.clone().multiplyScalar(0.55);
  return finish(b, CRIMSON, 0.8);
}

// ---- shield generator: the flagship's pylon emitters ------------------------

export function createShieldGenMesh() {
  const b = builder();
  // A pylon off the hull face holding a caged emitter sphere. The cage ring
  // spins; the emitter carries the shield's magenta film color — the only
  // enemy hardware that glows in the nebula's own hue.
  const pylon = box(3.2, 0.5, 0.5);
  pylon.position.x = 1.9;
  b.fill(pylon, OBSIDIAN_EDGE);
  const socket = box(0.9, 0.9, 0.9);
  b.fill(socket, OBSIDIAN);
  const emitter = new Mesh(new SphereGeometry(0.55, 10, 8), new MeshBasicMaterial());
  const emitterPart = b.core(emitter, NEBULA_MAGENTA, 1.5);
  b.group.userData.emitter = emitterPart.material;
  const ring = new Mesh(new TorusGeometry(0.95, 0.07, 6, 22), new MeshBasicMaterial());
  const ringPart = b.edge(ring, MOLTEN, 0.9);
  b.group.userData.cageRing = ring;
  b.group.userData.cageRingMaterial = ringPart.material;
  const ring2 = new Mesh(new TorusGeometry(0.95, 0.05, 6, 22), new MeshBasicMaterial());
  ring2.rotation.y = Math.PI / 2;
  b.edge(ring2, MOLTEN, 0.7);
  b.group.userData.cageRing2 = ring2;
  for (const direction of [new Vector3(-1, 0.4, 0.3), new Vector3(0.5, -1, 0), new Vector3(0.2, 0.8, -0.5)]) {
    b.shard(direction, NEBULA_MAGENTA.clone().lerp(COLD_WHITE, 0.3), 0.5);
  }
  b.shard(new Vector3(1, 0, 0), OBSIDIAN_EDGE.clone().lerp(MOLTEN, 0.5), 0.55);
  b.group.userData.isShieldGen = true;
  return finish(b, NEBULA_MAGENTA, 1.5);
}

// ---- power core: the trench's exposed heart ---------------------------------

export function createCoreMesh() {
  const b = builder();
  // A molten column between armored fins, sunk in the trench floor. Shielded,
  // it smolders behind a film; exposed, it burns white-hot — the difference
  // is the whole second phase.
  const column = new Mesh(new CylinderGeometry(0.5, 0.6, 2.4, 8), new MeshBasicMaterial());
  const columnPart = b.core(column, MOLTEN, 0.9);
  b.group.userData.coreColumn = columnPart.material;
  for (let i = 0; i < 4; i += 1) {
    const angle = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const fin = box(0.3, 2.8, 0.9);
    fin.position.set(Math.cos(angle) * 1.05, 0, Math.sin(angle) * 1.05);
    fin.rotation.y = -angle;
    b.fill(fin, OBSIDIAN);
    const finEdge = box(0.1, 2.6, 0.1);
    finEdge.position.set(Math.cos(angle) * 1.05, 0, Math.sin(angle) * 1.05 + 0.42);
    finEdge.rotation.y = -angle;
    b.edge(finEdge, MOLTEN, 0.6);
    b.shard(new Vector3(Math.cos(angle), 0.3, Math.sin(angle)), OBSIDIAN_EDGE.clone().lerp(MOLTEN, 0.5), 0.6);
  }
  const cap = new Mesh(new ConeGeometry(0.55, 0.5, 8), new MeshBasicMaterial());
  cap.position.y = 1.45;
  b.fill(cap, OBSIDIAN_EDGE);
  // Shield film: a faint magenta shell while the grid is up. Translucent and
  // additive — it must not read as a solid occluder to the audit.
  const film = new Mesh(new SphereGeometry(1.7, 12, 9), new MeshBasicMaterial());
  film.userData.raildIgnoreOcclusion = true;
  const filmPart = b.core(film, NEBULA_MAGENTA, 0.16);
  b.group.userData.shieldFilm = filmPart.material;
  b.shard(new Vector3(0, 1, 0), MOLTEN.clone(), 0.7);
  b.shard(new Vector3(0, -0.5, 0.6), CRIMSON.clone(), 0.5);
  b.group.userData.isCore = true;
  return finish(b, MOLTEN, 1.8);
}
