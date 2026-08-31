import {
  BoxGeometry,
  ConeGeometry,
  CylinderGeometry,
  DodecahedronGeometry,
  DoubleSide,
  Group,
  IcosahedronGeometry,
  Mesh,
  MeshBasicMaterial,
  OctahedronGeometry,
  RingGeometry,
  SphereGeometry,
  TorusGeometry,
} from 'three';
import type { BufferGeometry, Color } from 'three';
import { createAdditiveBasicMaterial } from '../../../engine/visual-kit';
import {
  ARC_BLUE,
  BARREL,
  BARREL_EDGE,
  CHARGE_WHITE,
  COIL_VIOLET,
  DRONE_EDGE,
  DRONE_FILL,
  ION_CYAN,
  WARNING,
  hdr,
} from './palette';

export type DriverTintPart = {
  material: MeshBasicMaterial;
  base: Color;
  kind: 'fill' | 'edge' | 'core';
};

function addTintPart(
  group: Group,
  geometry: BufferGeometry,
  base: Color,
  kind: DriverTintPart['kind'],
  options: { opacity?: number; wireframe?: boolean; additive?: boolean } = {},
) {
  const material = options.additive
    ? createAdditiveBasicMaterial({
        color: base,
        opacity: options.opacity ?? 1,
        wireframe: options.wireframe ?? false,
        side: DoubleSide,
      })
    : new MeshBasicMaterial({
        color: base,
        transparent: options.opacity !== undefined && options.opacity < 1,
        opacity: options.opacity ?? 1,
        wireframe: options.wireframe ?? false,
        side: DoubleSide,
        depthWrite: kind === 'fill',
      });
  const mesh = new Mesh(geometry, material);
  const parts = (group.userData.parts ??= []) as DriverTintPart[];
  parts.push({ material, base: base.clone(), kind });
  group.add(mesh);
  return mesh;
}

export function createSkimmerMesh() {
  const group = new Group();
  const core = addTintPart(group, new OctahedronGeometry(0.72, 0), hdr(ION_CYAN, 1.45), 'core', { additive: true });
  core.scale.set(0.8, 0.42, 1.8);

  const hull = addTintPart(group, new ConeGeometry(0.78, 2.8, 3), DRONE_FILL, 'fill', { opacity: 0.9 });
  hull.rotation.x = Math.PI / 2;
  hull.position.z = -0.3;
  const hullEdge = addTintPart(group, new ConeGeometry(0.81, 2.84, 3), DRONE_EDGE, 'edge', { wireframe: true });
  hullEdge.rotation.copy(hull.rotation);
  hullEdge.position.copy(hull.position);

  const wingGeometry = new ConeGeometry(0.55, 3.8, 3);
  for (const side of [-1, 1]) {
    const wing = addTintPart(group, wingGeometry.clone(), DRONE_FILL, 'fill', { opacity: 0.82 });
    wing.scale.set(0.38, 1, 1.5);
    wing.rotation.set(Math.PI / 2, 0, side * 0.52);
    wing.position.set(side * 1.35, 0, 0.25);
    const edge = addTintPart(group, wingGeometry.clone(), hdr(DRONE_EDGE, 0.9), 'edge', { wireframe: true });
    edge.scale.copy(wing.scale).multiplyScalar(1.02);
    edge.rotation.copy(wing.rotation);
    edge.position.copy(wing.position);
  }

  group.userData.accent = ION_CYAN.clone();
  group.userData.targetRadius = 2.25;
  return group;
}

export function createWeaverMesh() {
  const group = new Group();
  const spindle = addTintPart(group, new OctahedronGeometry(0.55, 0), hdr(COIL_VIOLET, 1.35), 'core', { additive: true });
  spindle.scale.set(0.58, 0.58, 2.35);

  const spinParts: Mesh[] = [];
  for (let index = 0; index < 3; index += 1) {
    const angle = index / 3 * Math.PI * 2;
    const blade = addTintPart(group, new ConeGeometry(0.28, 3.5, 3), DRONE_FILL, 'fill', { opacity: 0.88 });
    blade.scale.set(0.7, 1, 0.5);
    blade.rotation.set(0, 0, angle);
    blade.position.set(Math.cos(angle) * 1.15, Math.sin(angle) * 1.15, 0);
    const edge = addTintPart(group, new ConeGeometry(0.3, 3.55, 3), hdr(COIL_VIOLET, 0.95), 'edge', { wireframe: true });
    edge.scale.copy(blade.scale);
    edge.rotation.copy(blade.rotation);
    edge.position.copy(blade.position);
    spinParts.push(blade, edge);
  }

  const hoop = addTintPart(group, new TorusGeometry(1.45, 0.055, 5, 36), hdr(ARC_BLUE, 1.05), 'edge', { additive: true });
  hoop.rotation.x = Math.PI / 2;
  group.userData.spinParts = spinParts;
  group.userData.accent = COIL_VIOLET.clone();
  group.userData.targetRadius = 2.15;
  return group;
}

export function createSentinelMesh() {
  const group = new Group();
  const hull = addTintPart(group, new DodecahedronGeometry(1.22, 0), DRONE_FILL, 'fill', { opacity: 0.94 });
  hull.scale.set(1, 1, 0.78);
  const cage = addTintPart(group, new IcosahedronGeometry(1.28, 0), hdr(DRONE_EDGE, 0.9), 'edge', { wireframe: true });
  cage.scale.copy(hull.scale);

  const spinParts: Mesh[] = [];
  [
    [0, 0, 0],
    [Math.PI / 2, 0, 0],
    [0, Math.PI / 2, 0],
  ].forEach(([x, y, z], index) => {
    const gimbal = addTintPart(group, new TorusGeometry(1.72 + index * 0.12, 0.075, 5, 32), hdr(index === 1 ? COIL_VIOLET : ARC_BLUE, 0.92), 'edge', { additive: true });
    gimbal.rotation.set(x, y, z);
    gimbal.userData.spinSpeed = (index % 2 === 0 ? 1 : -1) * (0.7 + index * 0.18);
    spinParts.push(gimbal);
  });

  const eye = addTintPart(group, new SphereGeometry(0.32, 10, 6), hdr(CHARGE_WHITE, 1.35), 'core', { additive: true });
  eye.position.z = 1.05;
  group.userData.spinParts = spinParts;
  group.userData.accent = ARC_BLUE.clone();
  group.userData.targetRadius = 2.45;
  return group;
}

export function createArcboltMesh() {
  const group = new Group();
  const core = addTintPart(group, new SphereGeometry(0.3, 8, 5), hdr(CHARGE_WHITE, 1.9), 'core', { additive: true });
  core.scale.z = 1.7;
  for (let index = 0; index < 4; index += 1) {
    const angle = index / 4 * Math.PI * 2;
    const prong = addTintPart(group, new ConeGeometry(0.11, 1.05, 3), hdr(COIL_VIOLET, 1.3), 'edge', { additive: true });
    prong.rotation.z = angle - Math.PI / 2;
    prong.position.set(Math.cos(angle) * 0.55, Math.sin(angle) * 0.55, 0);
  }
  group.userData.isHostileShot = true;
  group.userData.accent = CHARGE_WHITE.clone();
  group.userData.targetRadius = 1.15;
  return group;
}

export function createInterlockMesh() {
  const group = new Group();
  const back = addTintPart(group, new BoxGeometry(3.8, 0.62, 0.75), BARREL, 'fill');
  back.position.y = -1.45;
  const backEdge = addTintPart(group, new BoxGeometry(3.86, 0.66, 0.79), BARREL_EDGE, 'edge', { wireframe: true });
  backEdge.position.copy(back.position);

  for (const side of [-1, 1]) {
    const jaw = addTintPart(group, new BoxGeometry(0.72, 3.2, 0.9), BARREL, 'fill');
    jaw.position.set(side * 1.55, 0, 0);
    const jawEdge = addTintPart(group, new BoxGeometry(0.76, 3.25, 0.94), hdr(COIL_VIOLET, 0.85), 'edge', { wireframe: true });
    jawEdge.position.copy(jaw.position);
    const tooth = addTintPart(group, new ConeGeometry(0.38, 1.25, 4), hdr(ARC_BLUE, 1.1), 'edge', { additive: true });
    tooth.rotation.z = side * Math.PI / 2;
    tooth.position.set(side * 1.08, 0.45, 0.15);
  }

  const core = addTintPart(group, new CylinderGeometry(0.62, 0.62, 0.5, 12), hdr(WARNING, 1.2), 'core', { additive: true });
  core.rotation.x = Math.PI / 2;
  core.position.set(0, -0.62, 0.52);
  const seal = addTintPart(group, new RingGeometry(0.82, 0.94, 12), hdr(COIL_VIOLET, 1.05), 'edge', { additive: true });
  seal.position.set(0, -0.62, 0.82);
  group.userData.interlockCore = core;
  group.userData.interlockSeal = seal;
  group.userData.isInterlock = true;
  group.userData.accent = WARNING.clone();
  group.userData.targetRadius = 2.8;
  return group;
}

export function createProjectileMeshInternal() {
  const group = new Group();
  const core = new Mesh(
    new OctahedronGeometry(0.22, 0),
    new MeshBasicMaterial({ color: hdr(CHARGE_WHITE, 1.8) }),
  );
  core.scale.set(0.5, 0.5, 2.8);
  const sheath = new Mesh(
    new ConeGeometry(0.34, 1.9, 5),
    createAdditiveBasicMaterial({ color: hdr(ION_CYAN, 1.15), opacity: 0.58 }),
  );
  sheath.rotation.x = Math.PI / 2;
  group.add(core, sheath);
  return group;
}

