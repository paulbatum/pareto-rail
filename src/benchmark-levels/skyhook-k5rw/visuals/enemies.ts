import {
  BoxGeometry,
  BufferGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  EdgesGeometry,
  Euler,
  Group,
  LineBasicMaterial,
  LineSegments,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  OctahedronGeometry,
  RingGeometry,
  TorusGeometry,
  Vector3,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { additiveMaterialParameters, createAdditiveBasicMaterial } from '../../../engine/visual-kit';
import { HAZARD, hdr, ICE, PALE, PANEL, RUST, SLATE, STEEL } from './palette';
import type { ShardSpec } from './effects';

// Everything hostile is built out of the same three things: dark slate plate,
// a bright cold rim line, and one small hot signal light. Nothing has a colour
// of its own — identity is silhouette and motion, so a kite (wide flat delta),
// a spar (long thin girder), a shrike (narrow dart), a limpet (squat drum) and
// the Descender (architecture) all read instantly against sky or vacuum alike.
//
// Every enemy is assembled as a single merged plate mesh plus a single merged
// edge pass plus at most two signal meshes: four draw calls for a whole enemy,
// which is what lets a 60-second run hold this much hardware on screen.

export type TintKind = 'plate' | 'edge' | 'signal';
export type TintPart = { material: MeshBasicMaterial | LineBasicMaterial; base: Color; kind: TintKind };

type Build = { fills: BufferGeometry[]; edges: BufferGeometry[] };

function build(): Build {
  return { fills: [], edges: [] };
}

const scratchMatrix = new Matrix4();
const scratchEuler = new Euler();

/** Stamp one plate into the build: it contributes a filled face and an edge line. */
function plate(
  target: Build,
  geometry: BufferGeometry,
  position: [number, number, number] = [0, 0, 0],
  rotation: [number, number, number] = [0, 0, 0],
) {
  scratchEuler.set(rotation[0], rotation[1], rotation[2]);
  scratchMatrix.makeRotationFromEuler(scratchEuler);
  scratchMatrix.setPosition(position[0], position[1], position[2]);
  const placed = geometry.clone().applyMatrix4(scratchMatrix);
  // Octahedra come back un-indexed and boxes come back indexed; merging needs
  // one or the other, so every plate is flattened before it joins the build.
  const solid = placed.index ? placed.toNonIndexed() : placed;
  if (solid !== placed) placed.dispose();
  target.fills.push(solid);
  target.edges.push(new EdgesGeometry(solid));
  geometry.dispose();
  return solid;
}

function tintable(group: Group): TintPart[] {
  return (group.userData.parts ??= []) as TintPart[];
}

function finish(group: Group, target: Build, plateColor: Color, edgeColor: Color, edgeIntensity: number) {
  const fillMaterial = new MeshBasicMaterial({ color: plateColor.clone() });
  const merged = mergeGeometries(target.fills);
  group.add(new Mesh(merged, fillMaterial));
  const edgeMaterial = new LineBasicMaterial(additiveMaterialParameters({ color: hdr(edgeColor, edgeIntensity), fog: false }));
  group.add(new LineSegments(mergeGeometries(target.edges), edgeMaterial));
  tintable(group).push(
    { material: fillMaterial, base: plateColor.clone(), kind: 'plate' },
    { material: edgeMaterial, base: hdr(edgeColor, edgeIntensity), kind: 'edge' },
  );
  for (const geometry of [...target.fills, ...target.edges]) geometry.dispose();
  return merged;
}

function signal(group: Group, geometry: BufferGeometry, color: Color, intensity: number, position: [number, number, number] = [0, 0, 0]) {
  const material = new MeshBasicMaterial({ color: hdr(color, intensity) });
  const mesh = new Mesh(geometry, material);
  mesh.position.set(position[0], position[1], position[2]);
  group.add(mesh);
  tintable(group).push({ material, base: hdr(color, intensity), kind: 'signal' });
  return mesh;
}

function glow(group: Group, geometry: BufferGeometry, color: Color, intensity: number, opacity: number, position: [number, number, number] = [0, 0, 0]) {
  const material = createAdditiveBasicMaterial({ color: hdr(color, intensity), opacity, fog: false });
  const mesh = new Mesh(geometry, material);
  mesh.position.set(position[0], position[1], position[2]);
  group.add(mesh);
  tintable(group).push({ material, base: hdr(color, intensity), kind: 'signal' });
  return mesh;
}

const shard = (x: number, y: number, z: number, color: Color, size: number): ShardSpec => ({
  direction: new Vector3(x, y, z).normalize(),
  color: color.clone(),
  size,
});

// ---- kite: a wind-rider, all wing and rigging --------------------------------

export function createKiteMesh() {
  const group = new Group();
  const target = build();

  // Delta canopy: a flattened three-sided cone with the apex leading.
  const canopy = new ConeGeometry(1.55, 3.1, 3, 1);
  canopy.rotateX(Math.PI / 2);
  canopy.scale(1.55, 0.14, 1);
  plate(target, canopy);

  // Wing spars along both leading edges.
  for (const side of [-1, 1]) {
    plate(target, new BoxGeometry(2.6, 0.14, 0.16), [side * 1.15, 0.05, -0.3], [0, side * 0.52, 0]);
  }
  // Slung pod and its rigging.
  plate(target, new OctahedronGeometry(0.34, 0), [0, -0.95, -1.15]);
  for (const side of [-1, 1]) {
    plate(target, new BoxGeometry(0.07, 1.25, 0.07), [side * 0.85, -0.5, -0.9], [0.32, 0, side * -0.6]);
  }

  finish(group, target, SLATE.clone().multiplyScalar(3.4), PALE, 1.05);
  signal(group, new OctahedronGeometry(0.15, 0), ICE, 1.7, [0, -0.95, -1.15]);

  group.userData.accent = PALE.clone();
  group.userData.lockRingScale = 1.5;
  group.userData.shardSpecs = [
    shard(-1, 0.2, 0.4, PALE, 0.9),
    shard(1, 0.2, 0.4, PALE, 0.9),
    shard(0, -0.6, -0.8, STEEL, 0.5),
    shard(0, 0.3, 1, PANEL, 0.6),
  ];
  return group;
}

// ---- spar: torn tether girder, tumbling ---------------------------------------

export function createSparMesh() {
  const group = new Group();
  const target = build();

  plate(target, new BoxGeometry(0.34, 0.34, 4.4));
  // Cross-bracing gives the tumble something to read against.
  for (const [z, tilt] of [[-1.2, 0.7], [0.5, -0.7]] as const) {
    plate(target, new BoxGeometry(1.5, 0.13, 0.13), [0, 0, z], [0, 0, tilt]);
  }
  plate(target, new BoxGeometry(0.72, 0.72, 0.3), [0, 0, -2.1]);
  // Sheared end.
  plate(target, new OctahedronGeometry(0.42, 0), [0.1, 0.08, 2.2]);

  finish(group, target, SLATE.clone().multiplyScalar(3.8), PALE, 0.95);
  signal(group, new BoxGeometry(0.4, 0.06, 0.9), RUST, 1.4, [0, 0.2, 0.4]);

  group.userData.accent = STEEL.clone();
  group.userData.lockRingScale = 1.2;
  group.userData.shardSpecs = [
    shard(0, 0.3, 1, STEEL, 0.7),
    shard(0, -0.3, -1, STEEL, 0.7),
    shard(0.9, 0.4, 0, PALE, 0.5),
    shard(-0.9, -0.4, 0, PALE, 0.5),
  ];
  return group;
}

// ---- shrike: an interceptor that wants the climber ---------------------------

export function createShrikeMesh() {
  const group = new Group();
  const target = build();

  const body = new OctahedronGeometry(0.62, 0);
  body.scale(0.72, 0.55, 2.5);
  plate(target, body);
  // Forward-swept wings: the tell that this one is diving, not drifting.
  for (const side of [-1, 1]) {
    const wing = new BoxGeometry(2.2, 0.1, 0.85);
    plate(target, wing, [side * 1.15, 0, -0.35], [0, side * -0.62, side * 0.34]);
    plate(target, new BoxGeometry(0.16, 0.5, 1.1), [side * 2.0, 0.18, -0.75], [0.2, 0, 0]);
  }
  // Ram prow.
  const prow = new ConeGeometry(0.34, 1.5, 4, 1);
  prow.rotateX(Math.PI / 2);
  plate(target, prow, [0, 0, 2.1]);

  finish(group, target, SLATE.clone().multiplyScalar(3.0), PALE, 1.15);
  // Intake slot — the runtime drives this from pale to hazard as it commits.
  const slot = signal(group, new BoxGeometry(0.9, 0.16, 0.22), ICE, 1.6, [0, 0.3, 0.55]);
  const halo = glow(group, new RingGeometry(0.8, 0.94, 20), ICE, 1.2, 0.4, [0, 0, 1.1]);
  group.userData.commitParts = [slot, halo];

  group.userData.accent = ICE.clone();
  group.userData.lockRingScale = 1.35;
  group.userData.shardSpecs = [
    shard(1, 0.15, -0.3, PALE, 0.9),
    shard(-1, 0.15, -0.3, PALE, 0.9),
    shard(0, 0.4, 1, ICE, 0.7),
    shard(0, -0.5, -0.8, STEEL, 0.6),
  ];
  return group;
}

// ---- limpet: a vacuum-hardened clamp pod --------------------------------------

export function createLimpetMesh() {
  const group = new Group();
  const target = build();

  const drum = new CylinderGeometry(1.15, 1.15, 1.0, 6);
  drum.rotateX(Math.PI / 2);
  plate(target, drum);
  // Three magnetic claws splayed forward.
  for (let i = 0; i < 3; i += 1) {
    const angle = (i / 3) * Math.PI * 2;
    plate(target, new BoxGeometry(0.36, 1.9, 0.36), [Math.cos(angle) * 1.35, Math.sin(angle) * 1.35, 0.55], [0.5, 0, -angle + Math.PI / 2]);
    plate(target, new BoxGeometry(0.3, 0.3, 1.1), [Math.cos(angle) * 1.85, Math.sin(angle) * 1.85, 1.25], [0, 0, 0]);
  }
  finish(group, target, SLATE.clone().multiplyScalar(3.2), PALE, 1.0);

  // Armour shell: six plates caged round the drum, shed at the stage break.
  const armour = build();
  for (let i = 0; i < 6; i += 1) {
    const angle = (i / 6) * Math.PI * 2 + 0.26;
    plate(armour, new BoxGeometry(0.9, 0.34, 1.35), [Math.cos(angle) * 1.28, Math.sin(angle) * 1.28, -0.1], [0, 0, angle + Math.PI / 2]);
  }
  const shellGroup = new Group();
  const shellMaterial = new MeshBasicMaterial({ color: STEEL.clone().multiplyScalar(0.55) });
  const shellMerged = mergeGeometries(armour.fills);
  shellGroup.add(new Mesh(shellMerged, shellMaterial));
  const shellEdgeMaterial = new LineBasicMaterial(additiveMaterialParameters({ color: hdr(PANEL, 0.7), fog: false }));
  shellGroup.add(new LineSegments(mergeGeometries(armour.edges), shellEdgeMaterial));
  tintable(group).push(
    { material: shellMaterial, base: STEEL.clone().multiplyScalar(0.55), kind: 'plate' },
    { material: shellEdgeMaterial, base: hdr(PANEL, 0.7), kind: 'edge' },
  );
  group.add(shellGroup);
  group.userData.armour = shellGroup;
  for (const geometry of [...armour.fills, ...armour.edges]) geometry.dispose();

  // Beacon: slow pulse while it hunts, hard strobe once it is grinding.
  const beacon = signal(group, new OctahedronGeometry(0.32, 1), ICE, 1.5, [0, 0, -0.7]);
  glow(group, new OctahedronGeometry(0.5, 1), ICE, 0.6, 0.32, [0, 0, -0.7]);
  group.userData.beacon = beacon;

  group.userData.accent = PALE.clone();
  group.userData.lockRingScale = 1.5;
  group.userData.shardSpecs = [
    shard(1, 0, 0.2, PALE, 1.0),
    shard(-0.5, 0.87, 0.2, PALE, 1.0),
    shard(-0.5, -0.87, 0.2, PALE, 1.0),
    shard(0, 0, -1, ICE, 0.8),
    shard(0.6, 0.6, 0.5, STEEL, 0.6),
    shard(-0.6, -0.6, 0.5, STEEL, 0.6),
  ];
  return group;
}

/** Stage break: the shell blows off and the beacon core is left in the open. */
export function breakLimpetShell(group: Group) {
  const armour = group.userData.armour as Group | undefined;
  if (!armour || !armour.visible) return;
  armour.visible = false;
  for (const part of group.userData.parts as TintPart[]) {
    if (part.kind === 'signal') part.base.multiplyScalar(1.9);
  }
}

// ---- slug: the hostile round -----------------------------------------------------

export function createSlugMesh() {
  const group = new Group();
  const target = build();
  const body = new OctahedronGeometry(0.38, 0);
  body.scale(0.62, 0.62, 1.9);
  plate(target, body);
  for (const side of [-1, 1]) plate(target, new BoxGeometry(0.5, 0.08, 0.3), [side * 0.3, 0, -0.6], [0, 0, side * 0.5]);
  finish(group, target, SLATE.clone().multiplyScalar(4.0), PALE, 1.3);
  signal(group, new OctahedronGeometry(0.2, 0), ICE, 2.4, [0, 0, 0.55]);
  glow(group, new OctahedronGeometry(0.3, 0), ICE, 0.9, 0.34, [0, 0, 0.36]);

  group.userData.accent = ICE.clone();
  group.userData.isHostileShot = true;
  group.userData.trailColor = ICE.clone().multiplyScalar(0.7);
  group.userData.lockRingScale = 0.85;
  group.userData.shardSpecs = [shard(0, 0, 1, ICE, 0.5), shard(0, 0, -1, PALE, 0.5)];
  return group;
}

// ---- the Descender ------------------------------------------------------------

/** One of the four arms holding the thing to the cable. */
export function createGrapnelMesh() {
  const group = new Group();
  const target = build();

  plate(target, new BoxGeometry(0.85, 3.4, 0.85));
  plate(target, new BoxGeometry(1.15, 1.15, 1.15), [0, 1.9, 0]);
  // Claw fingers biting the cable.
  for (const side of [-1, 1]) {
    plate(target, new BoxGeometry(0.3, 1.6, 0.3), [side * 0.5, -2.3, 0], [0, 0, side * 0.42]);
  }
  plate(target, new BoxGeometry(2.0, 0.5, 0.5), [0, -0.5, 0]);
  finish(group, target, SLATE.clone().multiplyScalar(2.6), PALE, 1.0);
  const joint = signal(group, new OctahedronGeometry(0.42, 0), HAZARD, 1.1, [0, 1.9, 0]);
  group.userData.jointParts = [joint];

  group.userData.accent = PALE.clone();
  group.userData.lockRingScale = 2.2;
  group.userData.shardSpecs = [
    shard(0, 1, 0, PALE, 1.3),
    shard(0, -1, 0.2, STEEL, 1.1),
    shard(1, 0.2, 0, PALE, 0.9),
    shard(-1, 0.2, 0, PALE, 0.9),
  ];
  return group;
}

/** The body: a collar around the cable, a hauling drum, and a cutting head. */
export function createCoreMesh() {
  const group = new Group();
  const target = build();

  // Collar that rides the cable.
  const collar = new TorusGeometry(4.4, 1.5, 6, 16);
  plate(target, collar, [0, 0, 2.6]);
  // Hauling drum.
  const drum = new CylinderGeometry(3.4, 4.2, 6.5, 8);
  drum.rotateX(Math.PI / 2);
  plate(target, drum, [0, 0, -1.2]);
  // Shoulder blocks the grapnels hang from.
  for (let i = 0; i < 4; i += 1) {
    const angle = Math.PI * (0.25 + i * 0.5);
    plate(target, new BoxGeometry(2.4, 2.4, 3.0), [Math.cos(angle) * 5.0, Math.sin(angle) * 5.0, 1.4], [0, 0, angle]);
  }
  // Cutting head — the part that will take the roof off the car.
  const head = new ConeGeometry(2.6, 4.6, 6, 1);
  head.rotateX(Math.PI / 2);
  plate(target, head, [0, -0.6, 5.6]);
  // Spine ribs down the back.
  for (const z of [-4.2, -5.6, -7.0]) {
    plate(target, new BoxGeometry(6.6, 0.7, 0.7), [0, 1.4, z]);
  }
  finish(group, target, SLATE.clone().multiplyScalar(2.2), PALE, 0.95);

  // Furnace slot: sealed while the grapnels hold, open and hot once exposed.
  const slot = signal(group, new BoxGeometry(4.6, 0.85, 0.35), RUST, 1.0, [0, 0.3, 4.2]);
  const core = glow(group, new OctahedronGeometry(1.9, 1), HAZARD, 0.65, 0.26, [0, 0, 0.8]);
  const halo = glow(group, new TorusGeometry(5.2, 0.3, 6, 26), HAZARD, 0.7, 0.4, [0, 0, 2.6]);
  group.userData.slotParts = [slot, core, halo];
  group.userData.isDescender = true;

  group.userData.accent = HAZARD.clone();
  group.userData.lockRingScale = 6.5;
  group.userData.shardSpecs = [
    shard(1, 0.3, 0.2, PALE, 2.4),
    shard(-1, 0.3, 0.2, PALE, 2.4),
    shard(0.4, 1, 0, STEEL, 2.0),
    shard(-0.4, -1, 0, STEEL, 2.0),
    shard(0, 0.2, 1, HAZARD, 2.2),
    shard(0, -0.2, -1, STEEL, 2.6),
    shard(0.8, -0.6, 0.4, PALE, 1.8),
    shard(-0.8, 0.6, 0.4, PALE, 1.8),
  ];
  return group;
}
