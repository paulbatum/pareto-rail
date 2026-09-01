import {
  BoxGeometry,
  Color,
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
import { CHARCOAL, hdr, HOSTILE_RED, PANEL_DARK } from './palette';
import { cachedTemplate, instantiateTemplate, mergeParts, taggedMesh, taggedPart, tintable, type TintPart } from './template';
import type { ShardSpec } from './effects';

// Hostile hardware. Down in the weather it is charcoal composite with red
// marker lights (kites, limpets, squalls); up top it is bare vacuum-rated
// metal with red thrusters (mites, sentinels). Silhouette and motion carry
// identity: a kite is a delta wing, a limpet a domed tick, a squall a
// vaned drum, a mite a boxy dart, a sentinel an armored cube.

export { setBodyState, tintable, type BodyState, type TintKind, type TintPart } from './template';

export const BARE_METAL = new Color(0.44, 0.46, 0.5);
const CHARCOAL_BODY = CHARCOAL.clone().multiplyScalar(1.4);

/** Tint a light or edge part; body panels go through setBodyState instead. */
export function tintPart(part: TintPart, color: Color) {
  if (part.panel) return;
  (part.material as MeshBasicMaterial).color.copy(color);
}

// ---- kite: a delta wing riding the wind -----------------------------------------

const KITE = cachedTemplate((b) => {
  const wing = new CylinderGeometry(0, 1.35, 2.3, 3, 1);
  wing.rotateX(Math.PI / 2);
  wing.scale(1.25, 1, 0.16);
  wing.rotateZ(Math.PI);
  b.panel(wing, CHARCOAL_BODY, { edges: [HOSTILE_RED, 0.55] });
  b.panel(new BoxGeometry(0.16, 2.1, 0.24), PANEL_DARK, { position: [0, -0.15, 0.08] });
  b.light(new OctahedronGeometry(0.16, 0), HOSTILE_RED, 2.2, { position: [0, 1.05, 0.12] });
  // Streamer tail on a hinge so the flutter reads.
  b.panel(new BoxGeometry(0.1, 1.5, 0.04), PANEL_DARK, { tag: 'ribbon', pivot: { position: [0, -1.1, 0] }, position: [0, -0.75, 0] });
  b.light(new BoxGeometry(0.14, 0.2, 0.06), HOSTILE_RED, 1.4, { tag: 'ribbonTip', pivot: { position: [0, -1.1, 0] }, position: [0, -1.5, 0] });
});

export function createKiteMesh() {
  const group = new Group();
  instantiateTemplate(KITE(), group);
  group.userData.accent = HOSTILE_RED.clone();
  group.userData.shardSpecs = [
    { direction: new Vector3(-0.8, -0.4, 0.2).normalize(), color: CHARCOAL.clone().multiplyScalar(2.5), size: 0.5 },
    { direction: new Vector3(0.8, -0.4, 0.2).normalize(), color: CHARCOAL.clone().multiplyScalar(2.5), size: 0.5 },
    { direction: new Vector3(0, 1, 0.2).normalize(), color: PANEL_DARK.clone(), size: 0.35 },
  ] satisfies ShardSpec[];
  group.userData.lockRingScale = 1.0;
  return group;
}

export function updateKiteMesh(group: Group) {
  const flutter = (group.userData.flutter as number | undefined) ?? 0;
  const angle = Math.sin(flutter * 9) * 0.3;
  const ribbon = taggedPart(group, 'ribbon');
  const tip = taggedPart(group, 'ribbonTip');
  if (ribbon) ribbon.rotation.z = angle;
  if (tip) tip.rotation.z = angle * 1.4;
}

// ---- limpet: a domed tick that clamps onto the deck ----------------------------

const LIMPET = cachedTemplate((b) => {
  const dome = new SphereGeometry(0.72, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2);
  dome.rotateX(Math.PI / 2); // apex toward +z: the camera while it dives, rail up once clamped
  b.panel(dome, CHARCOAL.clone().multiplyScalar(1.5));
  b.panel(new CylinderGeometry(0.74, 0.62, 0.22, 14), PANEL_DARK, { rotation: [Math.PI / 2, 0, 0], position: [0, 0, -0.1] });
  b.light(new SphereGeometry(0.17, 10, 8), HOSTILE_RED, 2.4, { position: [0, 0, 0.7] });
  b.panel(new CylinderGeometry(0.05, 0.28, 0.5, 6), BARE_METAL, { rotation: [-Math.PI / 2, 0, 0], position: [0, 0, -0.42] });
  // Six legs on hinges in the plate's plane; they fold flat or splay to clamp.
  for (let i = 0; i < 6; i += 1) {
    const angle = (i / 6) * Math.PI * 2;
    const leg = mergeParts([
      [new BoxGeometry(0.95, 0.12, 0.12), { position: [0.45, 0, 0] }],
      [new BoxGeometry(0.18, 0.1, 0.24), { position: [0.95, 0, -0.06] }],
    ]);
    b.panel(leg, PANEL_DARK, {
      tag: `leg${i}`,
      pivot: { position: [Math.cos(angle) * 0.62, Math.sin(angle) * 0.62, -0.12], rotation: [0, 0, angle] },
    });
  }
});

export function createLimpetMesh() {
  const group = new Group();
  instantiateTemplate(LIMPET(), group);
  group.userData.accent = HOSTILE_RED.clone();
  group.userData.shardSpecs = Array.from({ length: 6 }, (_, i) => {
    const angle = (i / 6) * Math.PI * 2;
    return { direction: new Vector3(Math.cos(angle), Math.sin(angle), 0.4).normalize(), color: CHARCOAL.clone().multiplyScalar(2.6), size: 0.4 };
  }) satisfies ShardSpec[];
  group.userData.lockRingScale = 1.05;
  return group;
}

export function updateLimpetMesh(group: Group) {
  const spread = (group.userData.legSpread as number | undefined) ?? 0.2;
  for (let i = 0; i < 6; i += 1) {
    const hinge = taggedPart(group, `leg${i}`);
    // Tucked legs fold toward -z; clamping legs splay flat onto the deck.
    if (hinge) hinge.rotation.y = -(1 - spread) * 1.1;
  }
}

// ---- squall: a vaned storm drum spitting lightning ----------------------------

const SQUALL = cachedTemplate((b) => {
  const drum = new CylinderGeometry(0.95, 0.85, 1.25, 10);
  drum.rotateX(Math.PI / 2);
  b.panel(drum, CHARCOAL.clone().multiplyScalar(1.35), { edges: [HOSTILE_RED, 0.35] });
  // Four vanes as one spinning part.
  const vanes = mergeParts(
    [0, 1, 2, 3].map((i) => [new BoxGeometry(2.2, 0.32, 0.1), { rotation: [0, 0, (i / 4) * Math.PI] }] as [BoxGeometry, { rotation: [number, number, number] }]),
  );
  b.panel(vanes, PANEL_DARK, { tag: 'vanes', position: [0, 0, -0.35] });
  // Lightning coil on the face and the discharge core: both swell with charge.
  b.light(new TorusGeometry(0.62, 0.07, 6, 24), HOSTILE_RED, 1.0, { tag: 'coil', position: [0, 0, 0.66] });
  b.light(new SphereGeometry(0.24, 10, 8), HOSTILE_RED, 1.6, { tag: 'core', position: [0, 0, 0.7] });
});

export function createSquallMesh() {
  const group = new Group();
  instantiateTemplate(SQUALL(), group);
  group.userData.spinTags = ['vanes'];
  group.userData.chargeTags = ['coil', 'core'];
  group.userData.accent = HOSTILE_RED.clone();
  group.userData.shardSpecs = [
    { direction: new Vector3(1, 0.3, 0).normalize(), color: CHARCOAL.clone().multiplyScalar(2.6), size: 0.7 },
    { direction: new Vector3(-1, 0.3, 0).normalize(), color: CHARCOAL.clone().multiplyScalar(2.6), size: 0.7 },
    { direction: new Vector3(0, 1, 0.3).normalize(), color: PANEL_DARK.clone(), size: 0.6 },
    { direction: new Vector3(0, -1, 0.3).normalize(), color: PANEL_DARK.clone(), size: 0.6 },
    { direction: new Vector3(0, 0, 1), color: HOSTILE_RED.clone(), size: 0.4 },
  ] satisfies ShardSpec[];
  group.userData.lockRingScale = 1.35;
  return group;
}

// ---- mite: a boxy vacuum dart on reaction-control pulses ----------------------

const MITE = cachedTemplate((b) => {
  b.panel(new BoxGeometry(1.0, 0.48, 0.44), BARE_METAL, { edges: [PANEL_DARK, 0.8] });
  b.panel(new OctahedronGeometry(0.3, 0), BARE_METAL.clone().multiplyScalar(1.15), { position: [0.62, 0, 0], scale: [1.5, 1, 1] });
  for (const y of [-0.2, 0.2]) b.panel(new BoxGeometry(0.7, 0.05, 0.05), PANEL_DARK, { position: [0.55, y, 0.16] });
  b.panel(new CylinderGeometry(0.16, 0.24, 0.3, 8), PANEL_DARK, { rotation: [0, 0, Math.PI / 2], position: [-0.6, 0, 0] });
  b.light(new SphereGeometry(0.16, 8, 6), HOSTILE_RED, 2.0, { tag: 'thruster', position: [-0.72, 0, 0] });
});

export function createMiteMesh() {
  const group = new Group();
  instantiateTemplate(MITE(), group);
  group.userData.thrustTag = 'thruster';
  group.userData.accent = HOSTILE_RED.clone();
  group.userData.shardSpecs = [
    { direction: new Vector3(0.6, 0.6, 0.3).normalize(), color: BARE_METAL.clone(), size: 0.4 },
    { direction: new Vector3(-0.6, 0.6, 0.3).normalize(), color: BARE_METAL.clone(), size: 0.4 },
    { direction: new Vector3(0, -0.8, 0.5).normalize(), color: PANEL_DARK.clone(), size: 0.35 },
  ] satisfies ShardSpec[];
  group.userData.lockRingScale = 0.85;
  return group;
}

// ---- sentinel: an armored station-keeper with a railgun -----------------------

const SENTINEL = cachedTemplate((b) => {
  b.panel(new BoxGeometry(1.25, 1.25, 1.25), CHARCOAL_BODY, { edges: [HOSTILE_RED, 0.45] });
  // Four bare-metal armor plates as one part, their stripes as another; both go at the stage break.
  const plates: Array<[BoxGeometry, { position: [number, number, number]; rotation: [number, number, number] }]> = [];
  const stripes: Array<[BoxGeometry, { position: [number, number, number] }]> = [];
  for (const [x, y] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
    plates.push([new BoxGeometry(1.7, 1.7, 0.22), { position: [x * 0.98, y * 0.98, 0], rotation: [y !== 0 ? Math.PI / 2 : 0, x !== 0 ? Math.PI / 2 : 0, 0] }]);
    stripes.push([new BoxGeometry(x !== 0 ? 0.1 : 1.2, x !== 0 ? 1.2 : 0.1, 0.06), { position: [x * 1.12, y * 1.12, 0.3] }]);
  }
  b.panel(mergeParts(plates), BARE_METAL, { tag: 'armor' });
  b.light(mergeParts(stripes), HOSTILE_RED, 0.9, { tag: 'armorLights' });
  b.panel(new CylinderGeometry(0.16, 0.22, 1.5, 8), PANEL_DARK, { rotation: [Math.PI / 2, 0, 0], position: [0, 0, 1.2] });
  b.light(new SphereGeometry(0.2, 8, 6), HOSTILE_RED, 1.4, { tag: 'muzzle', position: [0, 0, 2.0] });
  b.light(new BoxGeometry(0.5, 0.14, 0.06), HOSTILE_RED, 2.0, { position: [0, 0, 0.66] });
});

export function createSentinelMesh() {
  const group = new Group();
  instantiateTemplate(SENTINEL(), group);
  group.userData.chargeTags = ['muzzle'];
  group.userData.accent = HOSTILE_RED.clone();
  group.userData.shardSpecs = [
    ...[[1, 0], [-1, 0], [0, 1], [0, -1]].map(([x, y]) => ({ direction: new Vector3(x, y, 0.35).normalize(), color: BARE_METAL.clone(), size: 0.9 })),
    { direction: new Vector3(0, 0, 1), color: CHARCOAL.clone().multiplyScalar(2.5), size: 0.6 },
    { direction: new Vector3(0.5, 0.5, -0.5).normalize(), color: CHARCOAL.clone().multiplyScalar(2.5), size: 0.5 },
  ] satisfies ShardSpec[];
  group.userData.lockRingScale = 1.6;
  return group;
}

export function breakSentinelArmor(group: Group) {
  if (group.userData.armorBroken) return;
  group.userData.armorBroken = true;
  for (const tag of ['armor', 'armorLights']) {
    const part = taggedPart(group, tag);
    if (part) part.visible = false;
  }
  for (const part of tintable(group)) {
    if (part.kind === 'light') part.base.multiplyScalar(1.8);
  }
}

// ---- hostile shots -------------------------------------------------------------

let boltCoreGeometry: OctahedronGeometry | null = null;
let boltShellGeometry: OctahedronGeometry | null = null;

export function createBoltMesh() {
  if (!boltCoreGeometry) {
    boltCoreGeometry = new OctahedronGeometry(0.36, 0);
    boltCoreGeometry.scale(0.55, 0.55, 2.2);
  }
  if (!boltShellGeometry) {
    boltShellGeometry = new OctahedronGeometry(0.55, 0);
    boltShellGeometry.scale(0.6, 0.6, 2.0);
  }
  const group = new Group();
  const coreMaterial = new MeshBasicMaterial({ color: hdr(HOSTILE_RED, 2.6) });
  group.add(new Mesh(boltCoreGeometry, coreMaterial));
  const shellMaterial = createAdditiveBasicMaterial({ color: hdr(HOSTILE_RED, 1.0), opacity: 0.5 });
  group.add(new Mesh(boltShellGeometry, shellMaterial));
  tintable(group).push(
    { material: coreMaterial, base: coreMaterial.color.clone(), kind: 'light', panel: false },
    { material: shellMaterial, base: shellMaterial.color.clone(), kind: 'light', panel: false },
  );
  group.userData.accent = HOSTILE_RED.clone();
  group.userData.isHostileShot = true;
  group.userData.trailColor = HOSTILE_RED.clone().multiplyScalar(0.7);
  group.userData.shardSpecs = [
    { direction: new Vector3(0, 0, 1), color: HOSTILE_RED.clone(), size: 0.3 },
    { direction: new Vector3(0, 0, -1), color: HOSTILE_RED.clone(), size: 0.3 },
  ] satisfies ShardSpec[];
  group.userData.lockRingScale = 0.75;
  return group;
}

// ---- wreck: a chunk shed by the Tetherjack, tumbling down the tether -----------

const WRECK = cachedTemplate((b) => {
  b.panel(new BoxGeometry(1.5, 0.9, 0.7), CHARCOAL.clone().multiplyScalar(1.6), { edges: [HOSTILE_RED, 0.5] });
  b.panel(new BoxGeometry(1.1, 0.2, 1.2), BARE_METAL, { position: [0.3, 0.5, 0], rotation: [0, 0, 0.3] });
  b.light(new BoxGeometry(0.2, 0.2, 0.2), HOSTILE_RED, 1.6, { position: [-0.5, 0.1, 0.4] });
});

export function createWreckMesh() {
  const group = new Group();
  instantiateTemplate(WRECK(), group);
  group.userData.accent = HOSTILE_RED.clone();
  group.userData.shardSpecs = [
    { direction: new Vector3(1, 0.5, 0).normalize(), color: CHARCOAL.clone().multiplyScalar(2.5), size: 0.6 },
    { direction: new Vector3(-1, 0.5, 0.3).normalize(), color: BARE_METAL.clone(), size: 0.5 },
    { direction: new Vector3(0, -1, 0.3).normalize(), color: CHARCOAL.clone().multiplyScalar(2.5), size: 0.5 },
  ] satisfies ShardSpec[];
  group.userData.lockRingScale = 1.1;
  return group;
}

/** Per-frame dressing shared by the hostile kinds: spinning parts, charge swells, thrusters. */
export function dressHostile(group: Group, dt: number) {
  const charge = (group.userData.charge as number | undefined) ?? 0;
  const spinTags = group.userData.spinTags as string[] | undefined;
  if (spinTags) {
    for (const tag of spinTags) {
      const part = taggedPart(group, tag);
      if (part) part.rotation.z += dt * 1.4 * (1 + charge * 4);
    }
  }
  const chargeTags = group.userData.chargeTags as string[] | undefined;
  if (chargeTags) {
    for (const tag of chargeTags) {
      const part = taggedMesh(group, tag);
      if (part) part.scale.setScalar(1 + charge * 0.6);
    }
  }
  const thrustTag = group.userData.thrustTag as string | undefined;
  if (thrustTag) {
    const thrust = (group.userData.thrust as number | undefined) ?? 0;
    const part = taggedMesh(group, thrustTag);
    if (part) part.scale.setScalar(0.5 + thrust * 1.4);
  }
}
