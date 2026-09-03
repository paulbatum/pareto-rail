import {
  BufferGeometry,
  CircleGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  Group,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  Quaternion,
  SphereGeometry,
  TorusGeometry,
  Vector3,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { createAdditiveBasicMaterial } from '../../../engine/visual-kit';
import { mulberry32 } from '../../../engine/rng';
import { CHALK, DENY, GLUE, GLUE_SHEEN, GOLD, MINT, hdr, type Rng } from './palette';
import { BAKED_MATERIAL, bakeSupplyGeometry, paintGeometry, randomSupplyTint, SUPPLY_SPEC, type SupplyFinish, type SupplyType } from './supplies';

// Glue creatures. Every one is a visible black adhesive core wearing a
// temporary body of stolen supplies: beetles are a spool with a button
// carapace on pin legs, striders walk on pencils (rulers once the ball is
// melon-sized), snappers are folded cardboard wings around a clothespin beak.
// Bodies are built forward = +Z so gameplay can aim them with lookAt.
//
// Draw calls are the budget here, so a body is a handful of merged "chunks"
// (carapace, legs, a wing) rather than one mesh per supply. Each chunk keeps
// the list of supplies baked into it, so when the creature dies the visuals
// can hand every individual part to the piece system as a loose object.

export type CreaturePart = {
  type: SupplyType;
  tint: Color;
  /** Transform of the part inside its chunk. */
  local: Matrix4;
  scale: number;
  chunk: Chunk;
};

export type Chunk = {
  mesh: Mesh;
  parts: CreaturePart[];
  rest: Vector3;
  scatterFrom: Vector3;
};

export type Limb = { pivot: Object3D; phase: number; axis: 'x' | 'y' | 'z'; amp: number; rate: number; base: number };

export type CreatureUserData = {
  kind: string;
  core: Mesh;
  glue: MeshStandardMaterial;
  chunks: Chunk[];
  limbs: Limb[];
  wings: Limb[];
  beak: Limb[];
  shells: Chunk[];
  ring?: Mesh;
  disposables: BufferGeometry[];
  lockRingScale: number;
  accent: Color;
  locked?: boolean;
  deniedUntil?: number;
  damageFlashUntil?: number;
  active?: boolean;
  gait?: number;
  snapAt?: number;
  isGlob?: boolean;
  isCore?: boolean;
  spawnLift?: number;
  emerged?: boolean;
  assembled?: boolean;
};

let seedCounter = 1;

const shadowMaterial = new MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.32, depthWrite: false });
const shadowGeometry = new CircleGeometry(1, 18);
const ringGeometry = new TorusGeometry(0.7, 0.035, 6, 28);
const unitSphere = new SphereGeometry(1, 18, 12);
const dripSphere = new SphereGeometry(1, 9, 7);

// Glossy black: near-metal so the diffuse term stays black and only the lamp's
// highlight reads. Dark linear colors come out lighter on screen than they
// look on paper, so the violet sheen is kept very faint.
export function createGlueMaterial(sheen = 0.04) {
  return new MeshStandardMaterial({
    color: GLUE.clone(),
    roughness: 0.3,
    metalness: 0.35,
    emissive: GLUE_SHEEN.clone().multiplyScalar(sheen),
  });
}

/** Emissive is baked as color × intensity: the fallback renderer ignores emissiveIntensity. */
function glow(material: MeshStandardMaterial, color: Color, intensity: number) {
  material.emissive.copy(color).multiplyScalar(intensity);
}

type ChunkEntry = { type: SupplyType; tint: Color; position: Vector3; rotation: [number, number, number]; scale: number };

function creatureData(group: Group, kind: string, core: Mesh, glue: MeshStandardMaterial, accent: Color, lockRingScale: number): CreatureUserData {
  const data: CreatureUserData = {
    kind,
    core,
    glue,
    chunks: [],
    limbs: [],
    wings: [],
    beak: [],
    shells: [],
    disposables: [],
    lockRingScale,
    accent,
  };
  group.userData = data;
  return data;
}

// The glue itself: a squashed core sphere with a few hanging drips, merged
// into one mesh so a creature's black parts cost one draw call.
function addGlue(group: Group, rng: Rng, radius: number, squash: number, drips: number, dripSpread: number, dripSize: number) {
  const geometries: BufferGeometry[] = [];
  const core = unitSphere.clone().applyMatrix4(new Matrix4().makeScale(radius, radius * squash, radius));
  geometries.push(core);
  for (let i = 0; i < drips; i += 1) {
    const size = dripSize * (0.6 + rng() * 0.7);
    const angle = rng() * Math.PI * 2;
    const matrix = new Matrix4().compose(
      new Vector3(Math.cos(angle) * dripSpread, -0.1 - rng() * 0.25 * dripSpread, Math.sin(angle) * dripSpread),
      new Quaternion(),
      new Vector3(size, size * (1.5 + rng()), size),
    );
    geometries.push(dripSphere.clone().applyMatrix4(matrix));
  }
  const merged = mergeGeometries(geometries, false);
  for (const geometry of geometries) geometry.dispose();
  const glue = createGlueMaterial();
  const mesh = new Mesh(merged, glue);
  group.add(mesh);
  return { core: mesh, glue, geometry: merged };
}

function addChunk(
  parent: Object3D,
  data: CreatureUserData,
  entries: ChunkEntry[],
  finish: SupplyFinish,
  rng: Rng,
  options: { rest?: Vector3; scatter?: Vector3 } = {},
): Chunk {
  const geometries: BufferGeometry[] = [];
  const parts: CreaturePart[] = [];
  const chunk: Chunk = { mesh: new Mesh(), parts, rest: options.rest?.clone() ?? new Vector3(), scatterFrom: new Vector3() };
  for (const entry of entries) {
    const quaternion = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), entry.rotation[1])
      .multiply(new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), entry.rotation[0]))
      .multiply(new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), entry.rotation[2]));
    const local = new Matrix4().compose(entry.position, quaternion, new Vector3(entry.scale, entry.scale, entry.scale));
    geometries.push(bakeSupplyGeometry(entry.type, entry.tint, local));
    parts.push({ type: entry.type, tint: entry.tint.clone(), local, scale: entry.scale, chunk });
  }
  const merged = mergeGeometries(geometries, false);
  for (const geometry of geometries) geometry.dispose();
  chunk.mesh.geometry = merged;
  chunk.mesh.material = BAKED_MATERIAL[finish];
  chunk.mesh.position.copy(chunk.rest);
  chunk.scatterFrom.copy(options.scatter ?? chunk.rest.clone().add(new Vector3(rng() - 0.5, rng() * 0.8 + 0.3, rng() - 0.5).multiplyScalar(3.4)));
  parent.add(chunk.mesh);
  data.chunks.push(chunk);
  data.disposables.push(merged);
  return chunk;
}

function addShadow(group: Group, y: number, rx: number, rz: number) {
  const shadow = new Mesh(shadowGeometry, shadowMaterial);
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = y;
  shadow.scale.set(rx, rz, 1);
  shadow.userData.raildIgnoreOcclusion = true;
  shadow.renderOrder = 1;
  group.add(shadow);
  return shadow;
}

const entry = (type: SupplyType, tint: Color, x: number, y: number, z: number, rotation: [number, number, number], scale: number): ChunkEntry =>
  ({ type, tint, position: new Vector3(x, y, z), rotation, scale });

// ---- beetle: spool thorax, button carapace, pin legs ----------------------------

export function createBeetleMesh(): Group {
  const group = new Group();
  const rng = mulberry32(300 + seedCounter * 7919);
  seedCounter += 1;
  const { core, glue, geometry } = addGlue(group, rng, 0.46, 0.8, 3, 0.35, 0.12);
  const data = creatureData(group, 'beetle', core, glue, new Color(0.95, 0.22, 0.24), 1.35);
  data.disposables.push(geometry);

  addChunk(group, data, [entry('spool', randomSupplyTint('spool', rng), 0, 0.02, -0.3, [Math.PI / 2, 0, 0], 1.0)], 'matte', rng);

  const shell = randomSupplyTint('button', rng);
  const shell2 = randomSupplyTint('button', rng);
  const eye = randomSupplyTint('bead', rng);
  addChunk(group, data, [
    entry('button', shell, 0, 0.62, 0.32, [0.55, 0, 0], 1.15),
    entry('button', shell2, -0.52, 0.5, 0.05, [0.2, 0, 0.8], 1.05),
    entry('button', shell2, 0.52, 0.5, 0.05, [0.2, 0, -0.8], 1.05),
    entry('button', shell, -0.36, 0.42, -0.62, [-0.5, 0, 0.6], 0.95),
    entry('button', shell, 0.36, 0.42, -0.62, [-0.5, 0, -0.6], 0.95),
    entry('bead', eye, -0.2, 0.22, 0.72, [0, 0, 0], 0.42),
    entry('bead', eye, 0.2, 0.22, 0.72, [0, 0, 0], 0.42),
  ], 'gloss', rng, { scatter: new Vector3(0, 2.6, 0.4) });

  // Six pin legs in two tripods, each tripod a chunk that rocks in counterphase.
  const pinTint = randomSupplyTint('pin', rng);
  const tripods: Array<Array<[number, number]>> = [[[-0.32, 0.45], [0.36, 0], [-0.3, -0.45]], [[0.32, 0.45], [-0.36, 0], [0.3, -0.45]]];
  tripods.forEach((legs, index) => {
    const pivot = new Group();
    pivot.position.y = -0.12;
    group.add(pivot);
    const entries = legs.map(([x, z]) => {
      const side = Math.sign(x);
      const yaw = side > 0 ? 0 : Math.PI;
      return entry('pin', pinTint, x + side * 0.5, -0.05, z, [0, yaw + (z > 0 ? side * 0.4 : z < 0 ? -side * 0.35 : 0), side * -0.42], 0.62);
    });
    addChunk(pivot, data, entries, 'metal', rng, { scatter: new Vector3(index === 0 ? -2.4 : 2.4, 1, 0) });
    data.limbs.push({ pivot, phase: index === 0 ? 0 : Math.PI, axis: 'z', amp: 0.16, rate: 11, base: 0 });
  });

  addShadow(group, -0.6, 1.5, 1.2);
  return group;
}

// ---- strider: a core on stilts --------------------------------------------------

export function createStriderMesh(rulerLegs: boolean): Group {
  const group = new Group();
  const rng = mulberry32(900 + seedCounter * 7919);
  seedCounter += 1;
  const { core, glue, geometry } = addGlue(group, rng, 0.55, 0.9, 4, 0.45, 0.14);
  const data = creatureData(group, 'strider', core, glue, new Color(1.0, 0.8, 0.18), 1.25);
  data.disposables.push(geometry);

  const legTint = rulerLegs ? randomSupplyTint('ruler', rng) : randomSupplyTint('pencil', rng);
  const type: SupplyType = rulerLegs ? 'ruler' : 'pencil';
  // Two diagonal pairs (front-left + back-right, front-right + back-left) that
  // swing in counterphase: a trot on stilts.
  const pairs: Array<Array<[number, number]>> = [[[-0.85, 0.75], [0.9, -0.7]], [[0.85, 0.75], [-0.9, -0.7]]];
  pairs.forEach((feet, index) => {
    const pivot = new Group();
    pivot.position.y = -0.1;
    group.add(pivot);
    const entries = feet.map(([fx, fz]) => {
      const top = new Vector3(fx * 0.3, 0, fz * 0.3);
      const foot = new Vector3(fx * 0.9, -2.35, fz * 0.9);
      const direction = foot.clone().sub(top);
      const length = direction.length();
      direction.normalize();
      // Supply geometry runs along +X: yaw/pitch so X points down the leg.
      const yaw = Math.atan2(-direction.z, direction.x);
      const pitch = -Math.asin(direction.y);
      const middle = top.clone().add(foot).multiplyScalar(0.5);
      const scale = rulerLegs ? length / 4.1 : length / 3.5;
      return entry(type, legTint, middle.x, middle.y, middle.z, [0, yaw, pitch], scale);
    });
    addChunk(pivot, data, entries, 'matte', rng, { scatter: new Vector3(index === 0 ? -3 : 3, -1.5, 0) });
    data.limbs.push({ pivot, phase: index === 0 ? 0 : Math.PI, axis: 'x', amp: 0.2, rate: 1, base: 0 });
  });

  // A stack of two buttons for a hat and a paperclip antenna.
  addChunk(group, data, [
    entry('button', randomSupplyTint('button', rng), 0, 0.56, 0, [0, rng() * 3, 0], 1.0),
    entry('button', randomSupplyTint('button', rng), 0.05, 0.7, 0.04, [0.08, rng() * 3, 0.05], 0.72),
    entry('clip', randomSupplyTint('clip', rng), 0, 0.75, 0.35, [-1.2, 0, 0], 0.8),
  ], 'gloss', rng, { scatter: new Vector3(0.5, 3, 0) });

  addShadow(group, -2.45, 1.7, 1.5);
  return group;
}

// ---- snapper: cardboard wings, clothespin beak -------------------------------------

export function createSnapperMesh(): Group {
  const group = new Group();
  const rng = mulberry32(1500 + seedCounter * 7919);
  seedCounter += 1;
  const { core, glue, geometry } = addGlue(group, rng, 0.44, 1.0, 3, 0.3, 0.11);
  const data = creatureData(group, 'snapper', core, glue, new Color(0.16, 0.72, 0.68), 1.4);
  data.disposables.push(geometry);

  const cardTint = randomSupplyTint('card', rng);
  for (const side of [-1, 1]) {
    const pivot = new Group();
    pivot.position.set(side * 0.3, 0.08, 0);
    group.add(pivot);
    // Inner panel flat, outer panel folded up: a paper wing.
    addChunk(pivot, data, [
      entry('card', cardTint, side * 0.62, 0, 0, [0, Math.PI / 2, side * 0.1], 0.95),
      entry('card', cardTint.clone().multiplyScalar(0.92), side * 1.78, 0.28, 0.02, [0, Math.PI / 2, side * -0.5], 0.9),
    ], 'matte', rng, { scatter: new Vector3(side * 2.4, 1.4, 0) });
    data.wings.push({ pivot, phase: 0, axis: 'z', amp: 0.55, rate: 9, base: 0 });
  }

  // Clothespin beak: two jaws that snap.
  const pegTint = randomSupplyTint('peg', rng);
  for (const side of [-1, 1]) {
    const pivot = new Group();
    pivot.position.set(0, side * 0.08, 0.4);
    group.add(pivot);
    addChunk(pivot, data, [entry('peg', pegTint, 0, 0, 0.55, [0, 0, 0], 0.75)], 'matte', rng, { scatter: new Vector3(0, side * 0.9 + 0.3, 1.6) });
    data.beak.push({ pivot, phase: side, axis: 'x', amp: 0.2, rate: 1, base: side * -0.12 });
  }

  // Paperclip tail.
  addChunk(group, data, [entry('clip', randomSupplyTint('clip', rng), 0, 0, -0.85, [0, 0, 0], 0.8)], 'metal', rng, { scatter: new Vector3(0, 0.6, -2.6) });
  return group;
}

// ---- glob: a hostile glue spit -----------------------------------------------------

export function createGlobMesh(): Group {
  const group = new Group();
  const rng = mulberry32(2100 + seedCounter * 7919);
  seedCounter += 1;
  const { core, glue, geometry } = addGlue(group, rng, 0.36, 1.0, 2, 0.24, 0.11);
  glow(glue, GLUE_SHEEN.clone().lerp(new Color(0.5, 0.1, 0.05), 0.4), 0.4);
  const data = creatureData(group, 'glob', core, glue, new Color(1.0, 0.52, 0.16), 0.85);
  data.disposables.push(geometry);
  data.isGlob = true;
  core.scale.set(0.9, 0.9, 1.3);
  const tail = new Mesh(new ConeGeometry(0.28, 0.9, 10), glue);
  tail.rotation.x = Math.PI / 2;
  tail.position.z = -0.55;
  group.add(tail);
  data.disposables.push(tail.geometry);
  // Warning ring: reads as a lockable target and warms up as it closes in.
  const ring = new Mesh(ringGeometry, createAdditiveBasicMaterial({ color: hdr(GOLD, 0.9) }));
  group.add(ring);
  data.ring = ring;
  return group;
}

// ---- spill core: a dark core wearing shells of swallowed supplies -------------------

const CORE_SHELL_TYPES: SupplyType[] = ['button', 'spool', 'eraser', 'pot', 'block', 'pencil', 'card', 'peg', 'bead', 'clip', 'ruler', 'jar'];

export function createCoreMesh(index: number): Group {
  const group = new Group();
  const rng = mulberry32(4000 + index * 977);
  const heart = index === 2;
  const radius = heart ? 3.2 : 2.4;
  const { core, glue, geometry } = addGlue(group, rng, radius, 0.92, 6, radius * 0.9, radius * 0.16);
  const data = creatureData(group, 'spill-core', core, glue, new Color(0.62, 0.36, 0.86), heart ? 2.6 : 2.1);
  data.disposables.push(geometry);
  data.isCore = true;

  const layers: Array<{ count: number; orbit: number; scale: number }> = heart
    ? [{ count: 8, orbit: radius * 2.7, scale: 3.2 }, { count: 5, orbit: radius * 1.85, scale: 2.6 }]
    : [{ count: 7, orbit: radius * 2.6, scale: 2.8 }, { count: 4, orbit: radius * 1.8, scale: 2.3 }];

  for (const layer of layers) {
    const shellGroup = new Group();
    shellGroup.rotation.set(rng() * 0.5 - 0.25, rng() * Math.PI, rng() * 0.4 - 0.2);
    group.add(shellGroup);
    const entries: ChunkEntry[] = [];
    const strands: BufferGeometry[] = [];
    for (let i = 0; i < layer.count; i += 1) {
      const type = CORE_SHELL_TYPES[Math.floor(rng() * CORE_SHELL_TYPES.length)];
      const angle = (i / layer.count) * Math.PI * 2 + rng() * 0.3;
      const tilt = (rng() - 0.5) * 1.2;
      const position = new Vector3(Math.cos(angle) * Math.cos(tilt), Math.sin(tilt), Math.sin(angle) * Math.cos(tilt)).multiplyScalar(layer.orbit);
      entries.push(entry(type, randomSupplyTint(type, rng), position.x, position.y, position.z, [rng() * 3, rng() * 3, rng() * 3], layer.scale * (0.8 + rng() * 0.4)));
      // Glue strand from the core to the piece, baked dark into the same chunk.
      const strand = new CylinderGeometry(0.1, 0.32, position.length(), 6).toNonIndexed();
      strand.deleteAttribute('uv');
      const matrix = new Matrix4().compose(
        position.clone().multiplyScalar(0.5),
        new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), position.clone().normalize()),
        new Vector3(1, 1, 1),
      );
      strand.applyMatrix4(matrix);
      paintGeometry(strand, GLUE.clone().multiplyScalar(1.6));
      strands.push(strand);
    }
    const chunk = addChunk(shellGroup, data, entries, 'matte', rng, { scatter: new Vector3(0, 0, 0) });
    const withStrands = mergeGeometries([chunk.mesh.geometry, ...strands], false);
    chunk.mesh.geometry.dispose();
    for (const strand of strands) strand.dispose();
    chunk.mesh.geometry = withStrands;
    data.disposables[data.disposables.length - 1] = withStrands;
    chunk.scatterFrom.copy(chunk.rest);
    data.shells.push(chunk);
  }
  // Target halo: a hot ring that only shows on the core the player can crack.
  const ring = new Mesh(ringGeometry, createAdditiveBasicMaterial({ color: hdr(GOLD, 1.2) }));
  ring.scale.setScalar(radius * 1.9);
  ring.visible = false;
  group.add(ring);
  data.ring = ring;
  data.assembled = true;
  return group;
}

/** Hide a shell layer (it has just showered off) and return its parts. */
export function breakShell(group: Group, layerIndex: number): CreaturePart[] {
  const data = group.userData as CreatureUserData;
  const shell = data.shells[layerIndex];
  if (!shell || !shell.mesh.visible) return [];
  shell.mesh.visible = false;
  return shell.parts;
}

/** Every part still worn by the creature. */
export function wornParts(group: Group): CreaturePart[] {
  const data = group.userData as CreatureUserData;
  return data.chunks.filter((chunk) => chunk.mesh.visible).flatMap((chunk) => chunk.parts);
}

export function disposeCreature(group: Group) {
  const data = group.userData as CreatureUserData | undefined;
  if (!data?.disposables) return;
  for (const geometry of data.disposables) geometry.dispose();
  data.disposables.length = 0;
  data.glue.dispose();
  if (data.ring) (data.ring.material as MeshBasicMaterial).dispose();
}

// ---- per-frame animation -----------------------------------------------------------

export function animateCreature(group: Group, dt: number, elapsed: number, age: number) {
  const data = group.userData as CreatureUserData;
  const gait = data.gait ?? 1;

  // Assembly: chunks fly in from a scatter and lock into their rest pose.
  if (!data.assembled) {
    const assembleT = Math.min(1, age / 0.7);
    const ease = assembleT * assembleT * (3 - 2 * assembleT);
    for (const chunk of data.chunks) {
      chunk.mesh.position.lerpVectors(chunk.scatterFrom, chunk.rest, ease);
      chunk.mesh.scale.setScalar(0.25 + 0.75 * ease);
    }
    if (assembleT >= 1) data.assembled = true;
  }

  for (const limb of data.limbs) {
    const swing = Math.sin(elapsed * limb.rate * gait + limb.phase) * limb.amp;
    limb.pivot.rotation[limb.axis] = limb.base + swing;
  }
  for (const wing of data.wings) {
    const flap = Math.sin(elapsed * wing.rate + wing.phase) * wing.amp;
    wing.pivot.rotation.z = flap * Math.sign(wing.pivot.position.x || 1);
  }
  if (data.beak.length) {
    const snapping = data.snapAt !== undefined && age - data.snapAt < 0.35;
    const open = snapping ? Math.abs(Math.sin(((age - (data.snapAt ?? 0)) / 0.35) * Math.PI)) * 0.6 : 0.05 + Math.max(0, Math.sin(elapsed * 2.2)) * 0.08;
    for (const jaw of data.beak) jaw.pivot.rotation.x = jaw.base - jaw.phase * open;
  }
  if (data.isCore) {
    const speed = data.active ? 0.6 : 0.18;
    data.shells.forEach((shell, index) => {
      const parent = shell.mesh.parent;
      if (!parent) return;
      parent.rotation.y += dt * speed * (index === 0 ? 1 : -1.4);
      parent.rotation.x += dt * speed * 0.35;
    });
    const pulse = data.active ? 1 + Math.sin(elapsed * 5) * 0.05 : 1;
    data.core.scale.setScalar(pulse);
    if (data.ring) data.ring.rotation.z += dt * 1.5;
  } else {
    // Glue breathes: a slow wobble on the core.
    data.core.scale.y = 1 + Math.sin(elapsed * 3.1 + gait) * 0.05;
  }
}

/** Core emissive tint for the creature's current state; the cool mint lock glow is the player's color. */
export function tintCreature(group: Group, elapsed: number, closeness: number) {
  const data = group.userData as CreatureUserData;
  const denied = (data.deniedUntil ?? -Infinity) > elapsed;
  const flash = (data.damageFlashUntil ?? -Infinity) > elapsed;
  const big = data.isCore ? 0.35 : 1;
  if (denied) {
    const t = ((data.deniedUntil ?? 0) - elapsed) / 0.45;
    glow(data.glue, DENY, (0.5 + t * 1.2) * big);
    return;
  }
  if (flash) {
    glow(data.glue, CHALK, 1.3 * big);
    return;
  }
  if (data.locked) {
    glow(data.glue, MINT, (0.9 + Math.sin(elapsed * 12) * 0.2) * big);
    return;
  }
  if (data.isGlob) {
    glow(data.glue, GLUE_SHEEN.clone().lerp(new Color(1.0, 0.3, 0.08), closeness * 0.8), 0.25 + closeness * 0.7);
    if (data.ring) (data.ring.material as MeshBasicMaterial).color.copy(hdr(GOLD, 0.7 + closeness * 1.5));
    return;
  }
  if (data.isCore) {
    const active = data.active === true;
    glow(data.glue, GLUE_SHEEN.clone().lerp(GOLD, active ? 0.6 : 0), active ? 0.1 + Math.sin(elapsed * 4) * 0.04 : 0.03);
    if (data.ring) {
      data.ring.visible = active && data.emerged === true;
      (data.ring.material as MeshBasicMaterial).color.copy(hdr(GOLD, 1.0 + Math.sin(elapsed * 6) * 0.4));
    }
    return;
  }
  glow(data.glue, GLUE_SHEEN, 0.04 + closeness * 0.05);
}
