import {
  type BufferGeometry,
  BoxGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  EdgesGeometry,
  Group,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  OctahedronGeometry,
  SphereGeometry,
  TetrahedronGeometry,
  TorusGeometry,
} from 'three';

export type EnemyTintPart = {
  material: { color: Color };
  kind: 'fill' | 'edge' | 'core';
  base: Color;
};

const STORM_PANEL = new Color(0.34, 0.42, 0.45);
const SKY_PANEL = new Color(0.68, 0.75, 0.74);
const DEEP_PANEL = new Color(0.08, 0.12, 0.16);
const ORANGE = new Color(1.0, 0.3, 0.055);
const ORANGE_HOT = new Color(1.85, 0.46, 0.06);
const WHITE = new Color(0.92, 0.96, 0.92);
const VOID_EDGE = new Color(0.48, 0.62, 0.72);

function meshPart(group: Group, geometry: BufferGeometry, color: Color, kind: EnemyTintPart['kind'] = 'fill', scale?: [number, number, number]) {
  const material = new MeshBasicMaterial({ color: color.clone() });
  const mesh = new Mesh(geometry, material);
  if (scale) mesh.scale.set(...scale);
  group.add(mesh);
  addPart(group, material, kind);
  return mesh;
}

function edgePart(group: Group, geometry: BufferGeometry, color: Color) {
  const material = new LineBasicMaterial({ color: color.clone() });
  const edges = new LineSegments(new EdgesGeometry(geometry), material);
  group.add(edges);
  addPart(group, material, 'edge');
  return edges;
}

function addPart(group: Group, material: { color: Color }, kind: EnemyTintPart['kind'], base = material.color) {
  const parts = (group.userData.parts ??= []) as EnemyTintPart[];
  parts.push({ material, kind, base: base.clone() });
}

function finish(group: Group, accent: Color, baseScale = 1) {
  group.userData.parts = (group.userData.parts ?? []) as EnemyTintPart[];
  group.userData.accent = accent.clone();
  group.userData.baseScale = baseScale;
  return group;
}

export function createGustMesh() {
  const group = new Group();
  const body = new OctahedronGeometry(1.0, 0);
  meshPart(group, body, STORM_PANEL, 'fill', [1.3, 0.48, 0.58]);
  edgePart(group, body, SKY_PANEL);

  const wing = new ConeGeometry(0.62, 2.9, 3);
  const left = meshPart(group, wing, DEEP_PANEL, 'fill');
  left.position.set(-1.22, -0.05, 0);
  left.rotation.z = -Math.PI * 0.48;
  const right = meshPart(group, wing.clone(), DEEP_PANEL, 'fill');
  right.position.set(1.22, -0.05, 0);
  right.rotation.z = Math.PI * 0.48;

  const wingEdgeLeft = edgePart(group, wing, ORANGE);
  wingEdgeLeft.position.copy(left.position);
  wingEdgeLeft.rotation.copy(left.rotation);
  const wingEdgeRight = edgePart(group, wing.clone(), ORANGE);
  wingEdgeRight.position.copy(right.position);
  wingEdgeRight.rotation.copy(right.rotation);

  meshPart(group, new TetrahedronGeometry(0.32, 0), ORANGE_HOT, 'core', [1.2, 0.55, 0.7]).position.z = -0.5;
  const tail = meshPart(group, new ConeGeometry(0.24, 1.5, 4), SKY_PANEL, 'edge');
  tail.position.set(0, -0.45, 0.32);
  tail.rotation.x = Math.PI;
  return finish(group, ORANGE);
}

export function createSkiffMesh() {
  const group = new Group();
  const hull = new BoxGeometry(2.8, 0.62, 1.0);
  meshPart(group, hull, SKY_PANEL, 'fill');
  edgePart(group, hull, ORANGE);
  const canopy = meshPart(group, new SphereGeometry(0.78, 10, 6), DEEP_PANEL, 'fill', [1.0, 0.42, 0.72]);
  canopy.position.set(0, 0.42, -0.08);
  const canopyEdge = edgePart(group, new SphereGeometry(0.79, 10, 6), WHITE);
  canopyEdge.position.copy(canopy.position);
  canopyEdge.scale.copy(canopy.scale);

  for (const side of [-1, 1]) {
    const fin = meshPart(group, new BoxGeometry(0.28, 1.9, 0.32), STORM_PANEL, 'fill');
    fin.position.set(side * 1.45, -0.08, 0.12);
    fin.rotation.z = side * 0.23;
    const seam = meshPart(group, new BoxGeometry(0.07, 1.25, 0.08), ORANGE_HOT, 'core');
    seam.position.set(side * 1.59, -0.08, -0.34);
    seam.rotation.z = side * 0.23;
  }
  meshPart(group, new TetrahedronGeometry(0.36, 0), ORANGE_HOT, 'core', [1.6, 0.7, 1]).position.set(0, 0, -0.65);
  return finish(group, ORANGE);
}

export function createCarclawMesh() {
  const group = new Group();
  const clamp = new TorusGeometry(1.25, 0.22, 7, 22, Math.PI * 1.48);
  const body = meshPart(group, clamp, STORM_PANEL, 'fill');
  body.rotation.z = Math.PI * 0.78;
  const edge = edgePart(group, clamp, ORANGE);
  edge.rotation.z = body.rotation.z;
  const jawGeometry = new ConeGeometry(0.28, 1.0, 4);
  for (const side of [-1, 1]) {
    const jaw = meshPart(group, jawGeometry.clone(), SKY_PANEL, 'fill');
    jaw.position.set(side * 0.92, -0.88, 0);
    jaw.rotation.z = side * 0.36;
    const jawEdge = edgePart(group, jawGeometry.clone(), WHITE);
    jawEdge.position.copy(jaw.position);
    jawEdge.rotation.copy(jaw.rotation);
  }
  const cable = meshPart(group, new CylinderGeometry(0.12, 0.12, 2.0, 7), ORANGE_HOT, 'core');
  cable.position.y = 1.42;
  const eye = meshPart(group, new SphereGeometry(0.2, 8, 5), WHITE, 'core');
  eye.position.set(0, -0.05, -0.25);
  return finish(group, ORANGE);
}

export function createNeedleMesh() {
  const group = new Group();
  const body = new ConeGeometry(0.62, 3.7, 6);
  const needle = meshPart(group, body, DEEP_PANEL, 'fill');
  needle.rotation.z = Math.PI;
  const edge = edgePart(group, body, SKY_PANEL);
  edge.rotation.z = needle.rotation.z;
  const tip = meshPart(group, new ConeGeometry(0.26, 1.05, 6), ORANGE_HOT, 'core');
  tip.position.y = -2.05;
  tip.rotation.z = Math.PI;
  for (const side of [-1, 1]) {
    const fin = meshPart(group, new BoxGeometry(0.12, 2.1, 0.32), STORM_PANEL, 'fill');
    fin.position.set(side * 0.62, 0.15, 0.12);
    fin.rotation.z = side * 0.36;
    const finEdge = edgePart(group, new BoxGeometry(0.13, 2.1, 0.33), ORANGE);
    finEdge.position.copy(fin.position);
    finEdge.rotation.copy(fin.rotation);
  }
  return finish(group, ORANGE);
}

export function createVoidlingMesh() {
  const group = new Group();
  const shell = new TorusGeometry(1.0, 0.28, 8, 24);
  meshPart(group, shell, DEEP_PANEL, 'fill');
  edgePart(group, shell, VOID_EDGE);
  const hub = meshPart(group, new OctahedronGeometry(0.52, 0), SKY_PANEL, 'fill', [1.1, 0.72, 0.55]);
  hub.rotation.z = Math.PI * 0.25;
  meshPart(group, new TetrahedronGeometry(0.19, 0), WHITE, 'core').position.z = -0.34;
  for (let i = 0; i < 4; i += 1) {
    const angle = (i / 4) * Math.PI * 2;
    const fin = meshPart(group, new ConeGeometry(0.17, 1.25, 3), STORM_PANEL, 'fill');
    fin.position.set(Math.cos(angle) * 1.18, Math.sin(angle) * 1.18, 0.08);
    fin.rotation.z = angle + Math.PI * 0.5;
  }
  return finish(group, VOID_EDGE);
}

export function createBoltMesh() {
  const group = new Group();
  const body = new OctahedronGeometry(0.46, 0);
  meshPart(group, body, ORANGE_HOT, 'core', [0.5, 0.5, 2.2]);
  edgePart(group, body, WHITE).scale.set(0.5, 0.5, 2.2);
  meshPart(group, new SphereGeometry(0.14, 8, 5), WHITE, 'core');
  return finish(group, ORANGE_HOT);
}

export function createSkyhookMesh() {
  const group = new Group();
  group.userData.isBoss = true;
  const back = meshPart(group, new BoxGeometry(8.8, 6.6, 2.3), DEEP_PANEL, 'fill');
  back.position.z = 0.32;
  edgePart(group, new BoxGeometry(8.9, 6.7, 2.4), SKY_PANEL);

  const outer = new TorusGeometry(4.15, 0.45, 9, 36);
  meshPart(group, outer, STORM_PANEL, 'fill');
  edgePart(group, outer, ORANGE);
  const inner = new TorusGeometry(3.1, 0.13, 7, 32);
  meshPart(group, inner, ORANGE_HOT, 'edge');

  const spine = meshPart(group, new CylinderGeometry(0.42, 0.7, 10.5, 8), SKY_PANEL, 'fill');
  spine.position.set(0, 0.6, 0);
  const spineEdge = edgePart(group, new CylinderGeometry(0.44, 0.72, 10.6, 8), WHITE);
  spineEdge.position.copy(spine.position);
  const hub = meshPart(group, new OctahedronGeometry(1.25, 0), ORANGE_HOT, 'core', [1.0, 0.76, 0.42]);
  hub.position.set(0, -0.3, -1.15);

  // Paired utility hooks are the boss silhouette: unmistakable at a distance,
  // and visibly pointed at the car as the ring approaches.
  for (const side of [-1, 1]) {
    const hook = new TorusGeometry(2.3, 0.32, 7, 22, Math.PI * 1.05);
    const hookMesh = meshPart(group, hook, SKY_PANEL, 'fill');
    hookMesh.position.set(side * 3.4, -3.2, -0.2);
    hookMesh.rotation.z = side < 0 ? -0.22 : 0.22;
    const hookEdge = edgePart(group, hook.clone(), ORANGE);
    hookEdge.position.copy(hookMesh.position);
    hookEdge.rotation.copy(hookMesh.rotation);
  }

  for (const side of [-1, 1]) {
    const brace = meshPart(group, new BoxGeometry(0.34, 7.2, 0.6), STORM_PANEL, 'fill');
    brace.position.set(side * 4.75, 0.7, 0.1);
    brace.rotation.z = side * 0.18;
    const stripe = meshPart(group, new BoxGeometry(0.12, 5.2, 0.66), ORANGE_HOT, 'core');
    stripe.position.set(side * 4.95, 0.7, -0.35);
    stripe.rotation.z = side * 0.18;
  }
  return finish(group, ORANGE_HOT, 1.2);
}
