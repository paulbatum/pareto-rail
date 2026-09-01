import {
  BoxGeometry,
  BufferGeometry,
  Color,
  ConeGeometry,
  DoubleSide,
  Group,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  OctahedronGeometry,
  SphereGeometry,
  TorusGeometry,
  Vector3,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { createAdditiveBasicMaterial } from '../../../engine/visual-kit';
import { WEB_ANCHOR_REACH, WEB_ANGLES } from '../parent';
import { WORLD_SCALE } from '../world';
import type { ShardSpec } from './effects';
import { CLEAN_WHITE, JELLY_GOLD, PARASITE_MAGENTA, PARASITE_PLUM, PARASITE_SICK, PARASITE_VIOLET, hdr } from './palette';

// The parasites: dark plum bodies, sickly violet membranes, magenta-white
// cores. Every silhouette is built from the same grammar — a clamped body and
// something that glows in the middle — so they read as one infestation, and
// none of them share the animal's green-gold.

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
    fill(mesh, color = PARASITE_PLUM) {
      (mesh.material as MeshBasicMaterial).color.copy(color);
      return add(mesh, 'fill', color.clone());
    },
    edge(mesh, color = PARASITE_VIOLET, intensity = 0.9) {
      const material = createAdditiveBasicMaterial({ color: hdr(color, intensity) });
      mesh.material = material;
      return add(mesh, 'edge', hdr(color, intensity));
    },
    core(mesh, color = PARASITE_MAGENTA, intensity = 1.3) {
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

// Geometry is shared across every instance of a kind (materials stay
// per-instance for tinting), so spawning parasites never grows the GPU
// geometry count over a run.
const geometryCache = new Map<string, BufferGeometry>();
function shared<T extends BufferGeometry>(key: string, make: () => T): T {
  let geometry = geometryCache.get(key) as T | undefined;
  if (!geometry) {
    geometry = make();
    geometryCache.set(key, geometry);
  }
  return geometry;
}

function box(w: number, h: number, d: number) {
  return new Mesh(shared(`box:${w}:${h}:${d}`, () => new BoxGeometry(w, h, d)), new MeshBasicMaterial());
}

function sphere(radius: number, w = 10, h = 8) {
  return new Mesh(shared(`sphere:${radius}:${w}:${h}`, () => new SphereGeometry(radius, w, h)), new MeshBasicMaterial());
}

function torus(radius: number, tube: number, radial: number, tubular: number, arc?: number) {
  return new Mesh(
    shared(`torus:${radius}:${tube}:${radial}:${tubular}:${arc ?? 'full'}`, () => new TorusGeometry(radius, tube, radial, tubular, arc)),
    new MeshBasicMaterial(),
  );
}

function cone(radius: number, height: number, segments: number) {
  return new Mesh(shared(`cone:${radius}:${height}:${segments}`, () => new ConeGeometry(radius, height, segments)), new MeshBasicMaterial());
}

function octahedron(radius: number) {
  return new Mesh(shared(`octa:${radius}`, () => new OctahedronGeometry(radius, 0)), new MeshBasicMaterial());
}

// A translucent violet skin over a body: the membrane every parasite wears.
function membrane(radius: number, opacity: number) {
  return new Mesh(
    shared(`sphere:${radius}:12:9`, () => new SphereGeometry(radius, 12, 9)),
    new MeshBasicMaterial({ color: PARASITE_SICK, transparent: true, opacity, depthWrite: false, side: DoubleSide }),
  );
}

// ---- tick: a clamped body with hooked legs -----------------------------------------

export function createTickMesh() {
  const b = builder();
  const body = sphere(0.62);
  body.scale.set(1, 0.78, 1.15);
  b.fill(body, PARASITE_PLUM);
  const skin = membrane(0.7, 0.28);
  skin.scale.copy(body.scale);
  b.group.add(skin);
  // Six hooked legs, clamped around the strand; they fold in when it lets go.
  const legs: Mesh[] = [];
  for (let i = 0; i < 6; i += 1) {
    const side = i < 3 ? -1 : 1;
    const row = (i % 3) - 1;
    const leg = box(0.9, 0.08, 0.1);
    leg.position.set(side * 0.72, 0.1 - row * 0.28, row * 0.32);
    leg.rotation.z = side * 0.75;
    leg.rotation.y = row * 0.35;
    b.fill(leg, PARASITE_SICK.clone().multiplyScalar(0.7));
    legs.push(leg);
    const hook = box(0.14, 0.22, 0.1);
    hook.position.set(side * 1.12, -0.28 - row * 0.28, row * 0.32);
    b.edge(hook, PARASITE_VIOLET, 0.8);
    b.shard(new Vector3(side, -0.3, row * 0.5), PARASITE_SICK.clone(), 0.28);
  }
  const eye = sphere(0.2, 8, 6);
  eye.position.set(0, 0.26, 0.5);
  b.core(eye, PARASITE_MAGENTA, 1.5);
  const mouth = torus(0.22, 0.05, 6, 16);
  mouth.position.set(0, -0.32, 0.5);
  b.edge(mouth, PARASITE_VIOLET, 1.0);
  b.group.userData.legs = legs;
  b.shard(new Vector3(0, 1, 0.4), PARASITE_MAGENTA.clone(), 0.32);
  b.shard(new Vector3(0, -0.4, -1), PARASITE_PLUM.clone().lerp(PARASITE_VIOLET, 0.4), 0.36);
  return finish(b, PARASITE_VIOLET);
}

// ---- darter: a sinuous free swimmer -------------------------------------------------

export function createDarterMesh() {
  const b = builder();
  // Nose along +Z (motion uses lookAt); a tapered body with two tail vanes.
  const body = sphere(0.42, 10, 8);
  body.scale.set(0.8, 0.55, 2.6);
  b.fill(body, PARASITE_PLUM);
  const skin = membrane(0.47, 0.22);
  skin.scale.copy(body.scale);
  b.group.add(skin);
  const spine = box(0.06, 0.1, 2.0);
  spine.position.set(0, 0.24, -0.1);
  b.edge(spine, PARASITE_VIOLET, 1.0);
  const vanes: Mesh[] = [];
  for (const side of [-1, 1]) {
    const vane = box(0.9, 0.03, 0.55);
    vane.position.set(side * 0.55, 0, -0.85);
    vane.rotation.y = side * 0.5;
    vane.rotation.z = side * 0.25;
    b.fill(vane, PARASITE_SICK.clone().multiplyScalar(0.8));
    vanes.push(vane);
    const vaneEdge = box(0.86, 0.04, 0.06);
    vaneEdge.position.set(side * 0.56, 0.02, -1.1);
    vaneEdge.rotation.y = side * 0.5;
    b.edge(vaneEdge, PARASITE_VIOLET, 0.7);
    b.shard(new Vector3(side, 0.1, -0.6), PARASITE_SICK.clone(), 0.34);
  }
  const tail = box(0.05, 0.6, 0.5);
  tail.position.set(0, 0, -1.25);
  b.fill(tail, PARASITE_SICK.clone().multiplyScalar(0.8));
  vanes.push(tail);
  const eyeStripe = box(0.5, 0.08, 0.16);
  eyeStripe.position.set(0, 0.1, 0.95);
  b.core(eyeStripe, PARASITE_MAGENTA, 1.4);
  b.group.userData.vanes = vanes;
  b.shard(new Vector3(0, 0.3, 1), PARASITE_MAGENTA.clone(), 0.3);
  b.shard(new Vector3(0, -0.5, -1), PARASITE_PLUM.clone().lerp(PARASITE_VIOLET, 0.3), 0.4);
  return finish(b, PARASITE_VIOLET);
}

// ---- spinner: a spiked ring that corkscrews down a strand and spits ---------------------

export function createSpinnerMesh() {
  const b = builder();
  const ring = torus(0.55, 0.16, 8, 20);
  b.fill(ring, PARASITE_PLUM);
  const ringEdge = torus(0.55, 0.05, 6, 24);
  ringEdge.position.z = 0.14;
  b.edge(ringEdge, PARASITE_VIOLET, 0.9);
  for (let i = 0; i < 4; i += 1) {
    const angle = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const spine = cone(0.12, 0.7, 5);
    spine.position.set(Math.cos(angle) * 0.85, Math.sin(angle) * 0.85, 0);
    spine.rotation.z = angle - Math.PI / 2;
    b.fill(spine, PARASITE_SICK.clone().multiplyScalar(0.75));
    b.shard(new Vector3(Math.cos(angle), Math.sin(angle), 0), PARASITE_SICK.clone(), 0.3);
  }
  // The spit gland: brightens through the wind-up so the spore is telegraphed.
  const gland = sphere(0.24, 8, 6);
  gland.position.z = 0.1;
  const glandPart = b.core(gland, PARASITE_MAGENTA, 0.9);
  b.group.userData.chargeLamp = glandPart.material;
  b.shard(new Vector3(0, 0, 1), PARASITE_MAGENTA.clone(), 0.32);
  return finish(b, PARASITE_MAGENTA, 1.05);
}

// ---- sac: a bloated two-stage egg sac clamped on a strand ------------------------------

export function createSacMesh() {
  const b = builder();
  const inner = sphere(0.55, 12, 9);
  inner.scale.set(1, 1.15, 1);
  b.fill(inner, PARASITE_PLUM.clone().lerp(PARASITE_VIOLET, 0.35));
  const core = sphere(0.3, 8, 6);
  const corePart = b.core(core, PARASITE_MAGENTA, 0.7);
  // The outer membrane: bursts at the stage break to bare the core.
  const skinMaterial = new MeshBasicMaterial({ color: PARASITE_SICK, transparent: true, opacity: 0.55, depthWrite: false, side: DoubleSide });
  const skin = new Mesh(shared('sphere:0.98:14:10', () => new SphereGeometry(0.98, 14, 10)), skinMaterial);
  skin.scale.set(1, 1.2, 1);
  b.group.add(skin);
  const skinEdge = torus(0.96, 0.04, 6, 32);
  skinEdge.scale.set(1, 1.2, 1);
  b.edge(skinEdge, PARASITE_VIOLET, 0.8);
  for (let i = 0; i < 4; i += 1) {
    const angle = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const hook = box(0.1, 0.5, 0.1);
    hook.position.set(Math.cos(angle) * 0.95, Math.sin(angle) * 1.1, 0.1);
    hook.rotation.z = angle + Math.PI / 2;
    b.fill(hook, PARASITE_SICK.clone().multiplyScalar(0.7));
    b.shard(new Vector3(Math.cos(angle), Math.sin(angle), 0.3), PARASITE_SICK.clone(), 0.42);
  }
  b.group.userData.sacSkin = skin;
  b.group.userData.sacSkinEdge = skinEdge;
  b.group.userData.sacCore = corePart.material;
  b.shard(new Vector3(0, 0, 1), PARASITE_MAGENTA.clone(), 0.5);
  b.shard(new Vector3(0, 1, 0.3), PARASITE_VIOLET.clone(), 0.45);
  b.shard(new Vector3(0, -1, 0.3), PARASITE_VIOLET.clone(), 0.45);
  return finish(b, PARASITE_MAGENTA, 1.3);
}

export function bareSac(group: Group) {
  const skin = group.userData.sacSkin as Mesh | undefined;
  const edge = group.userData.sacSkinEdge as Mesh | undefined;
  if (skin) skin.visible = false;
  if (edge) edge.visible = false;
  const core = group.userData.sacCore as MeshBasicMaterial | undefined;
  if (core) core.color.copy(hdr(PARASITE_MAGENTA, 1.8));
}

// ---- spore: a spat seed, homing --------------------------------------------------------

export function createSporeMesh() {
  const b = builder();
  const seed = octahedron(0.28);
  seed.scale.set(0.7, 0.7, 1.6);
  b.fill(seed, PARASITE_PLUM);
  const glow = octahedron(0.36);
  glow.scale.set(0.65, 0.65, 1.5);
  b.core(glow, PARASITE_MAGENTA, 1.2);
  b.shard(new Vector3(0, -1, 0), PARASITE_MAGENTA.clone(), 0.3);
  b.group.userData.isHostileShot = true;
  b.group.userData.trailColor = PARASITE_VIOLET.clone().multiplyScalar(0.6);
  return finish(b, PARASITE_MAGENTA, 0.8);
}

// ---- broodling: fresh from the gullet -----------------------------------------------------

export function createBroodlingMesh() {
  const b = builder();
  const body = sphere(0.5, 9, 7);
  body.scale.set(1, 0.85, 1.05);
  b.fill(body, PARASITE_PLUM.clone().lerp(PARASITE_VIOLET, 0.2));
  const skin = membrane(0.58, 0.3);
  b.group.add(skin);
  for (let i = 0; i < 3; i += 1) {
    const angle = (i / 3) * Math.PI * 2 + Math.PI / 2;
    const leg = box(0.7, 0.07, 0.08);
    leg.position.set(Math.cos(angle) * 0.6, Math.sin(angle) * 0.6, 0);
    leg.rotation.z = angle;
    b.fill(leg, PARASITE_SICK.clone().multiplyScalar(0.7));
    b.shard(new Vector3(Math.cos(angle), Math.sin(angle), 0), PARASITE_SICK.clone(), 0.26);
  }
  const eye = sphere(0.19, 8, 6);
  eye.position.set(0, 0.12, 0.44);
  b.core(eye, PARASITE_MAGENTA, 1.5);
  b.shard(new Vector3(0, 0, 1), PARASITE_MAGENTA.clone(), 0.3);
  return finish(b, PARASITE_VIOLET, 0.95);
}

// ---- the Parent ------------------------------------------------------------------------------

// Built in the approach frame: local +X is screen-right, +Y screen-up, and
// -Z points into the crown. The runtime pins the mesh to that orientation, so
// webs and legs never billboard with the player's edge-look.
export function createParentMesh() {
  const b = builder();
  const S = WORLD_SCALE;

  // Bloated body, membrane over it, the gullet on the near face.
  const body = sphere(2.6 * S, 18, 14);
  body.scale.set(1.15, 0.95, 1);
  b.fill(body, PARASITE_PLUM);
  const bodyMembrane = new Mesh(
    shared(`sphere:${3.0 * S}:18:14`, () => new SphereGeometry(3.0 * S, 18, 14)),
    new MeshBasicMaterial({ color: PARASITE_SICK, transparent: true, opacity: 0.32, depthWrite: false, side: DoubleSide }),
  );
  bodyMembrane.scale.copy(body.scale);
  b.group.add(bodyMembrane);
  const veinGeometries: BufferGeometry[] = [];
  for (let i = 0; i < 7; i += 1) {
    const angle = (i / 7) * Math.PI * 2;
    const vein = new TorusGeometry(2.75 * S, 0.06 * S, 4, 26, Math.PI * 0.55);
    vein.applyMatrix4(new Matrix4().makeRotationZ(angle).multiply(new Matrix4().makeRotationX(Math.PI / 2 + 0.3)));
    veinGeometries.push(vein);
  }
  const veins = new Mesh(shared('parent-veins', () => mergeGeometries(veinGeometries)), new MeshBasicMaterial());
  veins.scale.copy(body.scale);
  b.edge(veins, PARASITE_VIOLET, 0.7);
  for (const geometry of veinGeometries) geometry.dispose();

  const gullet = torus(0.9 * S, 0.28 * S, 8, 20);
  gullet.position.z = 2.9 * S;
  b.fill(gullet, PARASITE_SICK.clone().multiplyScalar(0.8));
  const gulletCore = sphere(0.7 * S, 10, 8);
  gulletCore.position.z = 2.9 * S;
  const gulletPart = b.core(gulletCore, PARASITE_MAGENTA, 0.9);

  // Eye clusters either side of the gullet.
  const eyes: MeshBasicMaterial[] = [];
  for (const [x, y] of [[-1.6, 1.1], [1.6, 1.1], [-2.2, 0.2], [2.2, 0.2]] as const) {
    const eye = sphere(0.3 * S, 8, 6);
    eye.position.set(x * S, y * S, 2.4 * S);
    eyes.push(b.core(eye, PARASITE_MAGENTA, 1.5).material as MeshBasicMaterial);
  }

  // Eight hooked legs dug into the crown behind it. Half tear free at the
  // first stage break, the rest at the kill.
  const legs: Mesh[] = [];
  for (let i = 0; i < 8; i += 1) {
    const angle = (i / 8) * Math.PI * 2 + Math.PI / 8;
    const leg = box(0.34 * S, 0.34 * S, 3.6 * S);
    leg.position.set(Math.cos(angle) * 3.2 * S, Math.sin(angle) * 2.8 * S, -2.6 * S);
    leg.rotation.x = -0.35;
    leg.rotation.z = angle;
    b.fill(leg, PARASITE_SICK.clone().multiplyScalar(0.6));
    legs.push(leg);
    const hook = box(0.4 * S, 0.4 * S, 0.5 * S);
    hook.position.set(Math.cos(angle) * 4.2 * S, Math.sin(angle) * 3.7 * S, -4.4 * S);
    b.edge(hook, PARASITE_VIOLET, 0.9);
    legs.push(hook);
    b.shard(new Vector3(Math.cos(angle), Math.sin(angle), -0.3), PARASITE_SICK.clone(), 0.7);
  }

  // Three fans of webbing, one per brood, from the body out to the crown.
  const webs: Mesh[] = [];
  for (const [index, angle] of WEB_ANGLES.entries()) {
    const threads: BufferGeometry[] = [];
    const anchor = new Vector3(Math.cos(angle) * WEB_ANCHOR_REACH, Math.sin(angle) * WEB_ANCHOR_REACH, -4 * S);
    for (let t = 0; t < 7; t += 1) {
      const spread = (t / 6 - 0.5) * 0.9;
      const from = new Vector3(Math.cos(angle + spread * 0.5) * 2.2 * S, Math.sin(angle + spread * 0.5) * 2.0 * S, 0.4 * S);
      const to = new Vector3(Math.cos(angle + spread) * WEB_ANCHOR_REACH * 1.05, Math.sin(angle + spread) * WEB_ANCHOR_REACH * 1.05, anchor.z);
      const length = from.distanceTo(to);
      const thread = new BoxGeometry(0.07 * S, 0.07 * S, length);
      const matrix = new Matrix4().lookAt(from, to, new Vector3(0, 1, 0));
      matrix.setPosition(from.clone().lerp(to, 0.5));
      thread.applyMatrix4(matrix);
      threads.push(thread);
    }
    // Cross-threads tie the fan together.
    for (let ring = 1; ring <= 3; ring += 1) {
      const k = ring / 3.5;
      for (let t = 0; t < 6; t += 1) {
        const a0 = angle + (t / 6 - 0.5) * 0.9;
        const a1 = angle + ((t + 1) / 6 - 0.5) * 0.9;
        const p0 = new Vector3(Math.cos(a0) * WEB_ANCHOR_REACH * k, Math.sin(a0) * WEB_ANCHOR_REACH * k, -4 * S * k + 0.4 * S);
        const p1 = new Vector3(Math.cos(a1) * WEB_ANCHOR_REACH * k, Math.sin(a1) * WEB_ANCHOR_REACH * k, -4 * S * k + 0.4 * S);
        const thread = new BoxGeometry(0.05 * S, 0.05 * S, p0.distanceTo(p1));
        const matrix = new Matrix4().lookAt(p0, p1, new Vector3(0, 1, 0));
        matrix.setPosition(p0.clone().lerp(p1, 0.5));
        thread.applyMatrix4(matrix);
        threads.push(thread);
      }
    }
    const web = new Mesh(shared(`parent-web:${index}`, () => mergeGeometries(threads)), createAdditiveBasicMaterial({ color: hdr(PARASITE_VIOLET, 1.1) }));
    web.userData.webIndex = index;
    b.group.add(web);
    webs.push(web);
    for (const geometry of threads) geometry.dispose();
  }

  b.group.userData.isParent = true;
  b.group.userData.legs = legs;
  b.group.userData.webs = webs;
  b.group.userData.webWither = [0, 0, 0];
  b.group.userData.gulletMaterial = gulletPart.material;
  b.group.userData.eyeMaterials = eyes;
  b.group.userData.bodyMembrane = bodyMembrane;
  b.shard(new Vector3(0, 0, 1), PARASITE_MAGENTA.clone(), 1.0);
  b.shard(new Vector3(0, 1, 0.4), PARASITE_VIOLET.clone(), 0.9);
  b.shard(new Vector3(0, -1, 0.4), PARASITE_VIOLET.clone(), 0.9);
  b.shard(new Vector3(1, 0.3, 0.2), PARASITE_SICK.clone(), 0.8);
  b.shard(new Vector3(-1, 0.3, 0.2), PARASITE_SICK.clone(), 0.8);
  return finish(b, PARASITE_MAGENTA, 3.4);
}

/** Per-frame animation of the Parent from the flags the boss module writes into userData. */
export function updateParentMesh(group: Group, elapsed: number, dt: number) {
  const exposed = group.userData.exposed === true;
  const flinching = group.userData.flinching === true;
  const websAlive = (group.userData.websAlive as boolean[] | undefined) ?? [true, true, true];
  const stage = (group.userData.stage as number | undefined) ?? 0;
  const pump = (group.userData.pump as number | undefined) ?? 0;
  const webs = group.userData.webs as Mesh[] | undefined;
  const wither = group.userData.webWither as number[] | undefined;
  const legs = group.userData.legs as Mesh[] | undefined;
  const gullet = group.userData.gulletMaterial as MeshBasicMaterial | undefined;
  const eyes = group.userData.eyeMaterials as MeshBasicMaterial[] | undefined;
  const bodyMembrane = group.userData.bodyMembrane as Mesh | undefined;

  const flare = (group.userData.webFlareUntil as number | undefined ?? -Infinity) > elapsed ? 1 : 0;
  if (webs && wither) {
    for (const [index, web] of webs.entries()) {
      const target = websAlive[index] ? 0 : 1;
      wither[index] = Math.min(1, Math.max(0, wither[index] + (target - wither[index]) * Math.min(1, dt * 1.6)));
      const w = wither[index];
      // Dying back: the fan shrinks toward the body and dims to nothing. A
      // caught shot flares the whole lattice white-violet for a breath.
      web.scale.setScalar(Math.max(0.01, 1 - w * 0.97));
      const glow = (1.1 + Math.sin(elapsed * 3 + index) * 0.25) * (1 - w) ** 1.5;
      (web.material as MeshBasicMaterial).color.copy(hdr(flare ? PARASITE_MAGENTA : PARASITE_VIOLET, glow * (1 + flare * 1.4)));
      web.visible = w < 0.995;
    }
  }
  if (legs) {
    // Stage one tears the first four legs (and their hooks) loose.
    for (const [index, leg] of legs.entries()) {
      const pair = Math.floor(index / 2);
      leg.visible = !(stage >= 1 && pair < 4);
    }
  }
  if (gullet) {
    const pulse = pump > 0 ? 1.4 + pump * 1.6 : exposed ? 1.6 + Math.sin(elapsed * 8) * 0.5 : 0.8 + Math.sin(elapsed * 2.3) * 0.2;
    gullet.color.copy(hdr(PARASITE_MAGENTA, flinching ? 0.4 : pulse));
  }
  if (eyes) {
    for (const [index, eye] of eyes.entries()) {
      const flicker = elapsed * (flinching ? 13 : 3.1) + index * 1.9;
      eye.color.copy(hdr(PARASITE_MAGENTA, 1.2 + Math.sin(flicker) * (flinching ? 0.9 : 0.35)));
    }
  }
  if (bodyMembrane) {
    const material = bodyMembrane.material as MeshBasicMaterial;
    material.opacity = exposed ? 0.12 : 0.32;
    material.color.copy(exposed ? PARASITE_MAGENTA.clone().multiplyScalar(0.6) : PARASITE_SICK);
    const breathe = 1 + Math.sin(elapsed * 1.7) * 0.03 + pump * 0.08;
    bodyMembrane.scale.set(1.15 * breathe, 0.95 * breathe, breathe);
  }
}

export function goldFor(color: Color) {
  return color.clone().lerp(JELLY_GOLD, 0.6);
}

export { CLEAN_WHITE };
