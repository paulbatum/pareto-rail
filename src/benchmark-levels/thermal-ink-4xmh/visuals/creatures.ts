import {
  BoxGeometry,
  BufferGeometry,
  ConeGeometry,
  CylinderGeometry,
  Euler,
  Group,
  IcosahedronGeometry,
  InstancedMesh,
  Matrix4,
  Mesh,
  Object3D,
  Quaternion,
  RingGeometry,
  SphereGeometry,
  TorusGeometry,
  Vector3,
} from 'three';
import type { Color } from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { MeshBasicNodeMaterial } from 'three/webgpu';
import { modalMesh } from './materials';

// Every creature is built from exactly two materials: a body and a signal core.
// That is what makes the imager switch legible — one surface set goes white-hot,
// the other burns red — and it keeps per-enemy state down to two colour pairs
// for lock, damage, and death flashes to write.
//
// Shapes are merged once per kind and cached, so spawning a creature costs two
// meshes and two materials no matter how many parts it is drawn from.

/** A creature's two-material colour contract, chosen by the visual spine. */
export type CreatureSkin = {
  bodyMurk: Color;
  bodyThermal: Color;
  coreMurk: Color;
  coreThermal: Color;
  /** How completely ink swallows the body in normal sight. */
  swallow: number;
};

export type CreatureMaterials = {
  body: MeshBasicNodeMaterial;
  core: MeshBasicNodeMaterial;
  skin: CreatureSkin;
};

export type Layer = 'body' | 'core';
export type Parts = Record<Layer, BufferGeometry[]>;
export type Placement = {
  at?: [number, number, number];
  rotate?: [number, number, number];
  scale?: [number, number, number] | number;
};

export const ARM_SEGMENTS = 18;
export const SEGMENT_GEOMETRY = new CylinderGeometry(0.5, 0.62, 1, 7);

const matrix = new Matrix4();
const quaternion = new Quaternion();
const euler = new Euler();
const position = new Vector3();
const scale = new Vector3();

export function part(parts: Parts, layer: Layer, geometry: BufferGeometry, placement: Placement = {}) {
  const [x, y, z] = placement.at ?? [0, 0, 0];
  const [rx, ry, rz] = placement.rotate ?? [0, 0, 0];
  const s = placement.scale ?? 1;
  position.set(x, y, z);
  quaternion.setFromEuler(euler.set(rx, ry, rz));
  if (typeof s === 'number') scale.setScalar(s);
  else scale.set(s[0], s[1], s[2]);
  matrix.compose(position, quaternion, scale);
  parts[layer].push(geometry.toNonIndexed().applyMatrix4(matrix));
  geometry.dispose();
}

export function mergeParts(parts: Parts) {
  const merged: Partial<Record<Layer, BufferGeometry>> = {};
  for (const layer of ['body', 'core'] as const) {
    if (parts[layer].length === 0) continue;
    merged[layer] = mergeGeometries(parts[layer]) ?? undefined;
    for (const geometry of parts[layer]) geometry.dispose();
  }
  return merged;
}

const shapeCache = new Map<string, Partial<Record<Layer, BufferGeometry>>>();

function shapes(kind: string, build: (parts: Parts) => void) {
  const cached = shapeCache.get(kind);
  if (cached) return cached;
  const parts: Parts = { body: [], core: [] };
  build(parts);
  const merged = mergeParts(parts);
  shapeCache.set(kind, merged);
  return merged;
}

export function creatureMaterials(skin: CreatureSkin): CreatureMaterials {
  return {
    body: modalMesh(skin.bodyMurk, skin.bodyThermal, { swallow: skin.swallow, shade: 0.7, rim: 0.45 }),
    core: modalMesh(skin.coreMurk, skin.coreThermal, { swallow: skin.swallow * 0.7, shade: 0.2, rim: 0.35 }),
    skin,
  };
}

function assemble(kind: string, skin: CreatureSkin, lockRadius: number, build: (parts: Parts) => void) {
  const group = new Group();
  const materials = creatureMaterials(skin);
  const merged = shapes(kind, build);
  if (merged.body) group.add(new Mesh(merged.body, materials.body));
  if (merged.core) group.add(new Mesh(merged.core, materials.core));
  group.userData.kind = kind;
  group.userData.materials = materials;
  group.userData.lockRadius = lockRadius;
  return group;
}

// --- Scavenger crab: a flat debris carapace on flesh legs, always arriving
// from an edge of the frame. Wide and low.
function buildScuttler(parts: Parts) {
  part(parts, 'body', new CylinderGeometry(1.3, 0.94, 0.36, 6), { rotate: [Math.PI / 2, 0, 0] });
  part(parts, 'body', new BoxGeometry(1.55, 0.5, 0.22), { at: [0, 0.6, 0.16] });
  for (let i = 0; i < 6; i += 1) {
    const angle = (i / 6) * Math.PI * 2 + Math.PI / 12;
    part(parts, 'body', new BoxGeometry(0.15, 1.4, 0.15), {
      at: [Math.cos(angle) * 1.42, Math.sin(angle) * 1.42, -0.12],
      rotate: [0.35, 0, angle - Math.PI / 2],
    });
    part(parts, 'body', new BoxGeometry(0.11, 0.7, 0.11), {
      at: [Math.cos(angle) * 2.05, Math.sin(angle) * 2.05, -0.5],
      rotate: [0.9, 0, angle - Math.PI / 2],
    });
  }
  for (const side of [-1, 1]) {
    part(parts, 'body', new ConeGeometry(0.26, 0.85, 5), { at: [side * 0.9, 1.0, 0.12], rotate: [0, 0, -side * 0.7] });
  }
  part(parts, 'core', new RingGeometry(0.3, 0.48, 14), { at: [0, 0, 0.24] });
  part(parts, 'core', new SphereGeometry(0.17, 6, 5), { at: [-0.28, 0.5, 0.3] });
  part(parts, 'core', new SphereGeometry(0.17, 6, 5), { at: [0.28, 0.5, 0.3] });
}

// --- Hatchling: a jetting infant, bell mantle over five trailing tendrils.
// Tall and soft where the scuttler is flat and hard.
function buildHatchling(parts: Parts) {
  part(parts, 'body', new ConeGeometry(0.68, 1.6, 8), { at: [0, 0.52, 0] });
  part(parts, 'body', new SphereGeometry(0.64, 9, 7), { at: [0, -0.18, 0], scale: [1, 0.82, 1] });
  for (let i = 0; i < 5; i += 1) {
    const angle = (i / 5) * Math.PI * 2;
    part(parts, 'body', new ConeGeometry(0.12, 1.6, 4), {
      at: [Math.cos(angle) * 0.36, -1.0, Math.sin(angle) * 0.36],
      rotate: [-Math.sin(angle) * 0.55, angle, Math.cos(angle) * 0.55],
    });
    part(parts, 'body', new ConeGeometry(0.06, 0.9, 4), {
      at: [Math.cos(angle) * 0.62, -1.85, Math.sin(angle) * 0.62],
      rotate: [-Math.sin(angle) * 1.0, angle, Math.cos(angle) * 1.0],
    });
  }
  for (const side of [-1, 1]) {
    part(parts, 'core', new SphereGeometry(0.19, 7, 6), { at: [side * 0.36, -0.08, 0.48] });
  }
  part(parts, 'core', new TorusGeometry(0.27, 0.07, 5, 12), { at: [0, -0.52, 0.32], rotate: [Math.PI / 2.4, 0, 0] });
}

// --- Vent pod: a rusted drum coughed out of the broken machinery with
// something growing through its seam. Blocky, slow, two hits.
function buildPod(parts: Parts) {
  part(parts, 'body', new CylinderGeometry(0.94, 0.94, 1.8, 9), { rotate: [Math.PI / 2, 0, 0] });
  for (const z of [-0.58, 0.58]) {
    part(parts, 'body', new TorusGeometry(0.98, 0.11, 5, 14), { at: [0, 0, z] });
  }
  part(parts, 'body', new IcosahedronGeometry(0.8, 0), { at: [0.16, 0.74, 0.1], scale: [1.05, 0.82, 1.05] });
  for (const side of [-1, 1]) {
    part(parts, 'body', new CylinderGeometry(0.17, 0.17, 1.2, 6), { at: [side * 0.88, -0.42, 0.2], rotate: [0, 0, side * 0.5] });
  }
  part(parts, 'body', new BoxGeometry(0.7, 0.24, 0.5), { at: [0, -0.9, -0.3], rotate: [0.3, 0, 0] });
  part(parts, 'core', new TorusGeometry(0.68, 0.1, 6, 16), { at: [0, 0, 0.9] });
  part(parts, 'core', new SphereGeometry(0.32, 8, 6), { at: [0.16, 0.74, 0.74] });
}

// --- Ink bolt: a barbed needle of pressurised ink. Small, fast, and the only
// thing in the level aimed at the player.
function buildBolt(parts: Parts) {
  part(parts, 'body', new ConeGeometry(0.25, 1.6, 6), { rotate: [Math.PI / 2, 0, 0] });
  for (let i = 0; i < 3; i += 1) {
    const angle = (i / 3) * Math.PI * 2;
    part(parts, 'body', new BoxGeometry(0.08, 0.55, 0.08), {
      at: [Math.cos(angle) * 0.27, Math.sin(angle) * 0.27, -0.45],
      rotate: [0, 0, angle],
    });
  }
  part(parts, 'core', new SphereGeometry(0.22, 7, 6), {});
  part(parts, 'core', new RingGeometry(0.36, 0.48, 14), { at: [0, 0, 0.12] });
}

// --- The core: the beak between the arms, and the only soft thing on it.
function buildCore(parts: Parts) {
  part(parts, 'body', new IcosahedronGeometry(2.0, 1), { scale: [1.12, 0.95, 0.8] });
  for (const side of [-1, 1]) {
    part(parts, 'body', new ConeGeometry(0.66, 2.0, 4), { at: [side * 0.52, 0, 1.15], rotate: [Math.PI / 2, 0, side * 0.4] });
  }
  for (let i = 0; i < 6; i += 1) {
    const angle = (i / 6) * Math.PI * 2;
    part(parts, 'body', new BoxGeometry(0.3, 1.1, 0.3), {
      at: [Math.cos(angle) * 1.85, Math.sin(angle) * 1.85, -0.2],
      rotate: [0, 0, angle],
    });
  }
  part(parts, 'core', new TorusGeometry(1.4, 0.17, 7, 20), { at: [0, 0, 0.55] });
  part(parts, 'core', new IcosahedronGeometry(1.0, 1), { at: [0, 0, 0.66] });
}

// --- The curled tip of an arm: the lock point, and where the limb's heat
// gathers. The limb itself is instanced and posed every frame.
function buildArmTip(parts: Parts) {
  part(parts, 'body', new ConeGeometry(0.52, 2.2, 7), { at: [0, 0, 0.4], rotate: [-Math.PI / 2.6, 0, 0] });
  part(parts, 'body', new TorusGeometry(0.74, 0.28, 6, 14, Math.PI * 1.4), { at: [0, -0.56, 0.2], rotate: [0, Math.PI / 2, 0] });
  for (let i = 0; i < 5; i += 1) {
    part(parts, 'core', new RingGeometry(0.07, 0.17, 8), { at: [0.38, -0.22 - i * 0.34, 0.5], rotate: [0, 0.8, 0], scale: 1.5 - i * 0.13 });
  }
  part(parts, 'core', new IcosahedronGeometry(0.48, 0), { at: [0, 0.16, 0.56] });
  part(parts, 'core', new TorusGeometry(0.82, 0.09, 6, 16), { at: [0, 0.16, 0.5] });
}

export function createCreatureMesh(kind: string, skin: CreatureSkin): Group {
  switch (kind) {
    case 'hatchling':
      return assemble('hatchling', skin, 1.6, buildHatchling);
    case 'pod':
      return assemble('pod', skin, 1.8, buildPod);
    case 'bolt':
      return assemble('bolt', skin, 1.2, buildBolt);
    case 'core':
      return assemble('core', skin, 3.4, buildCore);
    case 'arm':
      return createArm(skin);
    default:
      return assemble('scuttler', skin, 2.0, buildScuttler);
  }
}

/**
 * An arm target owns its whole limb: the curled tip the player locks, plus the
 * instanced segments running back to the mantle. Keeping the limb inside the
 * target means an arm can never occlude its own lock point, and severing it
 * takes the geometry with it.
 */
function createArm(skin: CreatureSkin): Group {
  const group = assemble('arm-tip', skin, 2.8, buildArmTip);
  const materials = group.userData.materials as CreatureMaterials;
  const tip = new Group();
  // Re-parent the merged tip meshes so the curl can twist without dragging the
  // limb's world-space instance matrices with it.
  for (const child of [...group.children]) tip.add(child);
  group.add(tip);

  const limb = new InstancedMesh(SEGMENT_GEOMETRY, materials.body, ARM_SEGMENTS);
  limb.frustumCulled = false;
  limb.count = 0;
  group.add(limb);
  group.userData.kind = 'arm';
  group.userData.limb = limb;
  group.userData.tip = tip;
  return group;
}

export function creatureMaterialsOf(object: Object3D): CreatureMaterials | undefined {
  return object.userData.materials as CreatureMaterials | undefined;
}

/**
 * Release a creature's two materials once the runner has taken its mesh out of
 * the scene. Geometry is deliberately left alone: it is cached per kind and
 * shared by every creature of that kind for the life of the page.
 */
export function disposeCreatureMaterials(object: Object3D) {
  const materials = creatureMaterialsOf(object);
  if (materials) {
    materials.body.dispose();
    materials.core.dispose();
    return;
  }
  const letterMaterials = object.userData.letterMaterials as Record<string, { dispose(): void }> | undefined;
  if (!letterMaterials) return;
  for (const material of Object.values(letterMaterials)) material.dispose();
}

type ModalHandles = { murk: { value: Color }; thermal: { value: Color } };

/** Repaint a creature from its skin, optionally biased toward a flash colour. */
export function paintCreature(object: Object3D, flash?: { murk: Color; thermal: Color; amount: number }) {
  const materials = creatureMaterialsOf(object);
  if (!materials) return;
  const { skin } = materials;
  write(materials.body, skin.bodyMurk, skin.bodyThermal, flash);
  write(materials.core, skin.coreMurk, skin.coreThermal, flash);
}

function write(
  material: MeshBasicNodeMaterial,
  murk: Color,
  thermal: Color,
  flash?: { murk: Color; thermal: Color; amount: number },
) {
  const modal = material.userData.modal as ModalHandles | undefined;
  if (!modal) return;
  modal.murk.value.copy(murk);
  modal.thermal.value.copy(thermal);
  if (!flash || flash.amount <= 0) return;
  modal.murk.value.lerp(flash.murk, flash.amount);
  modal.thermal.value.lerp(flash.thermal, flash.amount);
}
