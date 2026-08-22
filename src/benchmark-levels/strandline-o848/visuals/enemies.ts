import {
  BoxGeometry,
  BufferGeometry,
  CircleGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  EdgesGeometry,
  Group,
  IcosahedronGeometry,
  LineBasicMaterial,
  LineSegments,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  OctahedronGeometry,
  RingGeometry,
  SphereGeometry,
  Vector3,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { additiveMaterialParameters, createAdditiveBasicMaterial } from '../../../engine/visual-kit';
import type { MoteSpec } from './effects';
import { VIOLET, VIOLET_HOT, VIOLET_SICK, hdr } from './palette';

// Parasite design: everything hostile is built from the same sickly violet
// family — shell, membrane, hot seams — so a player reads "infestation" before
// they read shape. The shapes themselves stay distinct: claspers are hinged
// shells, drifters are soft bells, skeins are segmented darts, broodlings are
// pulsing sparks, nettles are needles, the parent's webbing is hexagonal lace.

export type TintPart = {
  material: MeshBasicMaterial;
  base: Color;
  kind: 'edge' | 'fill' | 'core';
};

function tint(mesh: Mesh, base: Color, kind: TintPart['kind'], parts: TintPart[], additive = false) {
  const material = additive
    ? createAdditiveBasicMaterial({ color: base.clone() })
    : new MeshBasicMaterial({ color: base.clone() });
  mesh.material = material;
  parts.push({ material, base: base.clone(), kind });
  return mesh;
}

// ---- clasper: a hinged shell parasite clamped around a strand -----------------

export function createClasperMesh(): Group {
  const group = new Group();
  const parts: TintPart[] = [];

  // Two shell halves, top and bottom, that gape open when it detaches.
  const shellGeometry = new ConeGeometry(0.85, 1.7, 5);
  shellGeometry.rotateX(Math.PI / 2);
  const top = tint(new Mesh(shellGeometry), hdr(VIOLET, 0.55), 'fill', parts);
  top.position.set(0, 0.42, 0);
  const bottom = tint(new Mesh(shellGeometry), hdr(VIOLET, 0.55), 'fill', parts);
  bottom.position.set(0, -0.42, 0);
  bottom.rotation.x = Math.PI;

  const edgeSpecs: Array<[Mesh, number]> = [
    [top, 1],
    [bottom, -1],
  ];
  for (const [shell, sign] of edgeSpecs) {
    const edge = new LineSegments(
      new EdgesGeometry(shell.geometry as BufferGeometry),
      new LineBasicMaterial(additiveMaterialParameters({ color: hdr(VIOLET_HOT, 1.1) })),
    );
    parts.push({ material: edge.material as unknown as MeshBasicMaterial, base: hdr(VIOLET_HOT, 1.1), kind: 'edge' });
    edge.position.copy(shell.position);
    edge.rotation.copy(shell.rotation);
    edge.userData.shellSign = sign;
    group.add(edge);
    shell.userData.isShellHalf = true;
  }

  // The glowing seam between the halves — its weak point reads as a cut line.
  const seam = tint(new Mesh(new BoxGeometry(1.5, 0.09, 0.09)), hdr(VIOLET_HOT, 1.6), 'core', parts, true);
  void seam;

  const grip = tint(new Mesh(new CylinderGeometry(0.16, 0.16, 2.4, 6)), hdr(VIOLET_SICK, 0.8), 'fill', parts);
  grip.rotation.z = Math.PI / 2;

  group.add(top, bottom, seam, grip);
  group.userData.parts = parts;
  group.userData.shells = [top, bottom];
  group.userData.shardColor = VIOLET;
  group.userData.lockRingScale = 1.15;
  buildShardSpecs(group, 8, VIOLET);
  return group;
}

// ---- drifter: a soft parasitic bell with trailing feelers ---------------------

export function createDrifterMesh(): Group {
  const group = new Group();
  const parts: TintPart[] = [];

  const dome = new SphereGeometry(1.35, 18, 12);
  dome.scale(1, 0.72, 1);
  const domeMesh = tint(new Mesh(dome), hdr(VIOLET_SICK, 0.5), 'fill', parts);
  (domeMesh.material as MeshBasicMaterial).transparent = true;
  (domeMesh.material as MeshBasicMaterial).opacity = 0.55;

  const collar = tint(new Mesh(new RingGeometry(1.05, 1.32, 24)), hdr(VIOLET_HOT, 0.9), 'edge', parts, true);
  collar.rotation.x = Math.PI / 2;
  collar.position.y = -0.28;

  const core = tint(new Mesh(new SphereGeometry(0.42, 12, 8)), hdr(VIOLET_HOT, 1.9), 'core', parts, true);

  const feelerGeoms: BufferGeometry[] = [];
  for (let i = 0; i < 5; i += 1) {
    const angle = (i / 5) * Math.PI * 2;
    const feeler = new CylinderGeometry(0.03, 0.01, 2.6, 4);
    const matrix = new Matrix4()
      .makeRotationZ(Math.sin(angle * 2) * 0.22)
      .multiply(new Matrix4().makeTranslation(Math.cos(angle) * 0.75, -1.7, Math.sin(angle) * 0.75));
    feelerGeoms.push(feeler.applyMatrix4(matrix));
  }
  const feelers = tint(
    new Mesh(mergeGeometries(feelerGeoms)),
    hdr(VIOLET_SICK, 0.95),
    'edge',
    parts,
  );
  for (const geometry of feelerGeoms) geometry.dispose();

  group.add(domeMesh, collar, core, feelers);
  group.userData.parts = parts;
  group.userData.shardColor = VIOLET_SICK;
  group.userData.domeMesh = domeMesh;
  group.userData.coreMesh = core;
  group.userData.lockRingScale = 1.5;
  buildShardSpecs(group, 10, VIOLET_SICK);
  return group;
}

// ---- skein: a fast segmented louse that weaves across the rail ----------------

export function createSkeinMesh(): Group {
  const group = new Group();
  const parts: TintPart[] = [];

  const segmentGeometry = new OctahedronGeometry(0.42, 0);
  segmentGeometry.scale(1.6, 0.6, 0.7);
  for (let i = 0; i < 3; i += 1) {
    const segment = tint(new Mesh(segmentGeometry), hdr(i === 0 ? VIOLET_HOT : VIOLET, i === 0 ? 1.4 : 0.6), i === 0 ? 'core' : 'fill', parts, i === 0);
    segment.position.z = i * 0.62;
    segment.scale.setScalar(1 - i * 0.22);
    group.add(segment);
  }
  const tail = new LineSegments(
    tailEdges(),
    new LineBasicMaterial(additiveMaterialParameters({ color: hdr(VIOLET_SICK, 1.0) })),
  );
  parts.push({ material: tail.material as unknown as MeshBasicMaterial, base: hdr(VIOLET_SICK, 1.0), kind: 'edge' });
  tail.position.z = 1.86;
  group.add(tail);

  const fin = tint(new Mesh(new ConeGeometry(0.34, 1.1, 3)), hdr(VIOLET_SICK, 0.7), 'fill', parts);
  fin.rotation.x = Math.PI / 2;
  fin.position.y = 0.3;

  group.userData.parts = parts;
  group.userData.shardColor = VIOLET;
  buildShardSpecs(group, 6, VIOLET);
  return group;
}

function tailEdges() {
  const geometry = new ConeGeometry(0.3, 1.2, 4);
  geometry.rotateX(-Math.PI / 2);
  geometry.translate(0, 0, 0.6);
  return new EdgesGeometry(geometry);
}

// ---- broodling: a fresh-born spark of the infestation --------------------------

export function createBroodlingMesh(): Group {
  const group = new Group();
  const parts: TintPart[] = [];

  const core = tint(new Mesh(new IcosahedronGeometry(0.5, 0)), hdr(VIOLET_HOT, 1.7), 'core', parts, true);
  const shell = tint(new Mesh(new SphereGeometry(0.72, 10, 8)), hdr(VIOLET_SICK, 0.45), 'fill', parts);
  (shell.material as MeshBasicMaterial).transparent = true;
  (shell.material as MeshBasicMaterial).opacity = 0.5;
  const ring = tint(new Mesh(new RingGeometry(0.82, 0.88, 6)), hdr(VIOLET_HOT, 1.0), 'edge', parts, true);

  group.add(core, shell, ring);
  group.userData.parts = parts;
  group.userData.shardColor = VIOLET_HOT;
  return group;
}

// ---- nettle: the parent's stinging dart ----------------------------------------

export function createNettleMesh(): Group {
  const group = new Group();
  const needleGeometry = new ConeGeometry(0.14, 1.6, 5);
  needleGeometry.rotateX(Math.PI / 2);
  const needle = new Mesh(needleGeometry, createAdditiveBasicMaterial({ color: hdr(VIOLET_HOT, 1.8) }));
  const halo = new Mesh(new SphereGeometry(0.26, 8, 6), createAdditiveBasicMaterial({ color: hdr(VIOLET, 1.1) }));
  halo.position.z = -0.6;
  group.add(needle, halo);
  group.userData.isHostileShot = true;
  return group;
}

// ---- web panel: the parent's lattice ---------------------------------------------

export function createPanelMesh(): Group {
  const group = new Group();
  const parts: TintPart[] = [];

  const radius = 4.6;
  const frame = tint(new Mesh(new RingGeometry(radius * 0.92, radius, 6)), hdr(VIOLET_SICK, 0.85), 'edge', parts);
  const spokesGeoms: BufferGeometry[] = [];
  for (let i = 0; i < 6; i += 1) {
    const spoke = new BoxGeometry(0.07, radius * 0.9, 0.05);
    const matrix = new Matrix4().makeRotationZ((i / 6) * Math.PI * 2 + Math.PI / 6)
      .multiply(new Matrix4().makeTranslation(0, radius * 0.46, 0));
    spokesGeoms.push(spoke.applyMatrix4(matrix));
  }
  const spokes = tint(new Mesh(mergeGeometries(spokesGeoms)), hdr(VIOLET_SICK, 0.7), 'edge', parts);
  for (const geometry of spokesGeoms) geometry.dispose();
  const membrane = tint(new Mesh(new CircleGeometry(radius * 0.9, 6)), hdr(VIOLET_SICK, 0.28), 'fill', parts);
  (membrane.material as MeshBasicMaterial).transparent = true;
  (membrane.material as MeshBasicMaterial).opacity = 0.35;
  // The feeding sac at the center — violet while fed, gone when withered.
  const sac = tint(new Mesh(new SphereGeometry(0.66, 10, 8)), hdr(VIOLET_HOT, 1.3), 'core', parts, true);

  group.add(frame, spokes, membrane, sac);
  group.userData.parts = parts;
  group.userData.sac = sac;
  group.userData.membrane = membrane;
  group.userData.shardColor = VIOLET_SICK;
  group.userData.lockRingScale = 2.4;
  buildShardSpecs(group, 12, VIOLET_SICK, 1.6);
  return group;
}

// ---- the parent organism ------------------------------------------------------------

export function createParentMesh(): Group {
  const group = new Group();
  const parts: TintPart[] = [];

  // The parent is small compared to its child — a fist of a thing dug into
  // the crown, all membrane and greed.
  const dome = new SphereGeometry(5.4, 24, 16);
  dome.scale(1.25, 0.8, 1);
  const domeMesh = tint(new Mesh(dome), hdr(VIOLET_SICK, 0.42), 'fill', parts);
  (domeMesh.material as MeshBasicMaterial).transparent = true;
  (domeMesh.material as MeshBasicMaterial).opacity = 0.6;

  const manubium = tint(new Mesh(new ConeGeometry(1.5, 5.2, 8)), hdr(VIOLET, 0.65), 'fill', parts);
  manubium.rotation.x = Math.PI;
  manubium.position.y = -3.4;

  const heart = tint(new Mesh(new SphereGeometry(1.5, 14, 10)), hdr(VIOLET_HOT, 2.0), 'core', parts, true);
  heart.position.y = -2.2;

  const tendrilsGroup = new Group();
  const tendrilGeoms: BufferGeometry[] = [];
  for (let i = 0; i < 14; i += 1) {
    const angle = (i / 14) * Math.PI * 2;
    const tendril = new CylinderGeometry(0.09, 0.02, 11 + (i % 3) * 3, 4);
    const matrix = new Matrix4()
      .makeRotationX(Math.PI + Math.sin(angle * 3) * 0.24)
      .multiply(new Matrix4().makeTranslation(Math.cos(angle) * 2.6, -7.5 - (i % 4) * 1.6, Math.sin(angle) * 2.6));
    tendrilGeoms.push(tendril.applyMatrix4(matrix));
  }
  const tendrils = tint(new Mesh(mergeGeometries(tendrilGeoms)), hdr(VIOLET_SICK, 0.9), 'edge', parts);
  for (const geometry of tendrilGeoms) geometry.dispose();
  tendrilsGroup.add(tendrils);

  const collar = tint(new Mesh(new RingGeometry(4.4, 5.2, 30)), hdr(VIOLET_HOT, 0.8), 'edge', parts, true);
  collar.rotation.x = Math.PI / 2;
  collar.position.y = 0.6;

  group.add(domeMesh, manubium, heart, tendrilsGroup, collar);
  // The parent looms: authored large, since the runtime normalizes spawn scale.
  group.scale.setScalar(1.5);
  group.userData.baseScale = 1.5;
  group.userData.parts = parts;
  group.userData.heartMesh = heart;
  group.userData.tendrils = tendrilsGroup;
  group.userData.shardColor = VIOLET;
  group.userData.lockRingScale = 3.4;
  buildShardSpecs(group, 20, VIOLET, 2.2);
  return group;
}

// ---- shared shard bookkeeping ---------------------------------------------------------

function buildShardSpecs(group: Group, count: number, color: Color, sizeScale = 1) {
  const specs: MoteSpec[] = [];
  for (let i = 0; i < count; i += 1) {
    specs.push({
      direction: randomUnit(Math.random),
      color: color.clone(),
      size: 0.3 * sizeScale,
    });
  }
  group.userData.shardSpecs = specs;
}

function randomUnit(rng: () => number): Vector3 {
  const z = rng() * 2 - 1;
  const angle = rng() * Math.PI * 2;
  const r = Math.sqrt(Math.max(0, 1 - z * z));
  return new Vector3(Math.cos(angle) * r, Math.sin(angle) * r, z);
}

// A web panel dies back: the sac gutters out and the membrane goes slack.
export function breakWebPanel(group: Group) {
  const sac = group.userData.sac as Mesh | undefined;
  if (sac) sac.visible = false;
  group.userData.withered = true;
}
