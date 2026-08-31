import {
  CatmullRomCurve3,
  BufferGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DodecahedronGeometry,
  DoubleSide,
  EdgesGeometry,
  Group,
  IcosahedronGeometry,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  OctahedronGeometry,
  RingGeometry,
  SphereGeometry,
  TorusGeometry,
  TubeGeometry,
  Vector3,
} from 'three';
import type { Material } from 'three';
import { IR_INK, IR_RED, IR_STEEL, IR_WHITE_EDGE, IR_WHITE_HOT, BONE, CREAM, INK, OCHRE, OILY, PLAYER, RUST, RUST_DARK, SIGNAL, hdr } from './palette';

export type ThermalPart = {
  material: Material & { color: Color; opacity: number };
  normal: Color;
  infrared: Color;
  normalOpacity: number;
  infraredOpacity: number;
};

type ThermalRoot = Group & { userData: { thermalParts?: ThermalPart[] } };

export function createThermalRoot() {
  const group = new Group() as ThermalRoot;
  group.userData.thermalParts = [];
  return group;
}

export function registerThermalPart(
  root: Group,
  material: Material & { color: Color; opacity: number },
  normal: Color,
  infrared: Color,
  normalOpacity = 1,
  infraredOpacity = 1,
) {
  const parts = (root.userData.thermalParts as ThermalPart[] | undefined) ?? [];
  parts.push({ material, normal: normal.clone(), infrared: infrared.clone(), normalOpacity, infraredOpacity });
  root.userData.thermalParts = parts;
  return material;
}

export function applyThermalMode(root: ObjectWithThermalParts, infrared: boolean) {
  const parts = root.userData.thermalParts as ThermalPart[] | undefined;
  if (!parts) return;
  for (const part of parts) {
    part.material.color.copy(infrared ? part.infrared : part.normal);
    part.material.opacity = infrared ? part.infraredOpacity : part.normalOpacity;
  }
}

export type ObjectWithThermalParts = Group & { userData: { thermalParts?: ThermalPart[]; [key: string]: unknown } };

function fill(root: Group, geometry: BufferGeometry, normal: Color, infrared: Color, opacity = 1, infraredOpacity = opacity) {
  const material = new MeshBasicMaterial({ color: normal, side: DoubleSide, transparent: opacity < 1 || infraredOpacity < 1, opacity });
  registerThermalPart(root, material, normal, infrared, opacity, infraredOpacity);
  const mesh = new Mesh(geometry, material);
  root.add(mesh);
  return mesh;
}

function edge(root: Group, geometry: BufferGeometry, normal: Color, infrared: Color, opacity = 1) {
  const material = new LineBasicMaterial({ color: normal, transparent: opacity < 1, opacity, depthTest: true });
  registerThermalPart(root, material, normal, infrared, opacity, opacity);
  const lines = new LineSegments(new EdgesGeometry(geometry), material);
  root.add(lines);
  return lines;
}

function signalCore(root: Group, radius: number, scale = 1) {
  const core = fill(root, new SphereGeometry(radius, 12, 8), hdr(SIGNAL, 1.8), hdr(IR_RED, 3.1), 1, 1);
  core.scale.setScalar(scale);
  root.userData.signalCore = core;
  return core;
}

function addSuctionCup(root: Group, position: Vector3, scale = 1) {
  const cup = fill(root, new SphereGeometry(0.13, 8, 5), hdr(CREAM, 0.72), hdr(IR_WHITE_HOT, 1.25), 1, 1);
  cup.position.copy(position);
  cup.scale.set(1, 0.55, 0.45).multiplyScalar(scale);
  return cup;
}

export function createArmMesh() {
  const root = createThermalRoot();
  const path = new CatmullRomCurve3([
    new Vector3(-1.35, -0.18, 0),
    new Vector3(-0.65, 0.3, 0.08),
    new Vector3(0.1, -0.18, 0),
    new Vector3(0.78, 0.23, -0.05),
    new Vector3(1.35, 0.02, 0),
  ]);
  const tentacle = fill(root, new TubeGeometry(path, 18, 0.42, 8, false), hdr(RUST_DARK, 1.2), hdr(IR_WHITE_HOT, 1.35));
  tentacle.userData.tentacle = true;
  edge(root, tentacle.geometry, hdr(RUST, 1.05), hdr(IR_WHITE_EDGE, 1));
  for (const [x, y, z] of [
    [-1.0, -0.38, 0.24], [-0.42, -0.38, 0.18], [0.2, -0.38, 0.12], [0.8, -0.34, 0.08], [1.25, -0.21, 0.04],
  ] as const) addSuctionCup(root, new Vector3(x, y, z), 0.9);
  const plate = fill(root, new TorusGeometry(0.69, 0.085, 7, 28), hdr(OCHRE, 1.2), hdr(IR_WHITE_EDGE, 1.1));
  plate.rotation.x = Math.PI / 2;
  root.userData.plate = plate;
  signalCore(root, 0.19, 1.05);
  root.userData.accent = OCHRE.clone();
  root.userData.shardDirections = [
    new Vector3(-1, 0, 0), new Vector3(1, 0, 0), new Vector3(0, 1, 0), new Vector3(0, -1, 0),
  ];
  return root;
}

export function createScavengerMesh() {
  const root = createThermalRoot();
  const body = fill(root, new DodecahedronGeometry(0.72, 0), hdr(OILY, 2.0), hdr(IR_WHITE_HOT, 1.35));
  body.scale.set(1.25, 0.7, 1.45);
  edge(root, body.geometry, hdr(RUST, 1.15), hdr(IR_WHITE_EDGE, 1));

  for (const side of [-1, 1]) {
    const fin = fill(root, new ConeGeometry(0.28, 1.1, 5), hdr(RUST, 1.2), hdr(IR_WHITE_HOT, 1.25));
    fin.position.set(side * 0.76, 0.04, -0.18);
    fin.rotation.z = side * Math.PI * 0.42;
    fin.rotation.x = Math.PI / 2;
  }
  const jaw = fill(root, new CylinderGeometry(0.2, 0.38, 0.8, 6), hdr(BONE, 0.65), hdr(IR_STEEL, 1.1));
  jaw.position.z = 0.72;
  jaw.rotation.x = Math.PI / 2;
  jaw.scale.set(0.75, 1, 0.5);
  signalCore(root, 0.12, 0.9);
  root.userData.accent = RUST.clone();
  root.userData.shardDirections = [
    new Vector3(-1, 0.4, 0), new Vector3(1, 0.4, 0), new Vector3(0, -0.8, 0.4),
  ];
  return root;
}

export function createCableMesh() {
  const root = createThermalRoot();
  const cable = fill(root, new CylinderGeometry(0.16, 0.27, 3.5, 8), hdr(RUST_DARK, 1.5), hdr(IR_WHITE_HOT, 1.2));
  cable.rotation.x = Math.PI / 2;
  edge(root, cable.geometry, hdr(OCHRE, 0.9), hdr(IR_WHITE_EDGE, 1));
  for (const z of [-1.25, -0.42, 0.42, 1.25]) {
    const collar = fill(root, new TorusGeometry(0.25, 0.055, 6, 16), hdr(CREAM, 0.62), hdr(IR_WHITE_EDGE, 0.9));
    collar.rotation.x = Math.PI / 2;
    collar.position.z = z;
  }
  const hook = fill(root, new TorusGeometry(0.45, 0.12, 7, 18, Math.PI * 1.5), hdr(OCHRE, 1.3), hdr(IR_WHITE_HOT, 1.25));
  hook.rotation.y = Math.PI / 2;
  hook.position.z = 1.9;
  signalCore(root, 0.13, 1.1);
  root.userData.accent = LAMPISH.clone();
  root.userData.shardDirections = [new Vector3(0, 1, 0), new Vector3(0, -1, 0), new Vector3(0, 0, 1)];
  return root;
}

// Kept local to make the cable's warm accent explicit without adding another
// palette role; the value is copied before it is stored in userData.
const LAMPISH = new Color(0.84, 0.4, 0.1);

export function createCoreMesh() {
  const root = createThermalRoot();
  const mantle = fill(root, new IcosahedronGeometry(1.05, 1), hdr(OILY, 2.4), hdr(IR_WHITE_HOT, 1.45), 1, 1);
  mantle.scale.set(1.05, 1.05, 0.72);
  edge(root, mantle.geometry, hdr(RUST, 1.35), hdr(IR_WHITE_EDGE, 1.1));
  const cage = new Group();
  for (const tilt of [0, Math.PI / 2, Math.PI / 4]) {
    const ring = fill(root, new TorusGeometry(1.38, 0.095, 7, 36), hdr(OCHRE, 1.1), hdr(IR_WHITE_EDGE, 1.25));
    ring.rotation.x = Math.PI / 2;
    ring.rotation.z = tilt;
    cage.add(ring);
  }
  root.userData.cage = cage;
  root.add(cage);
  signalCore(root, 0.36, 1.35);
  const pin = fill(root, new OctahedronGeometry(0.58, 0), hdr(SIGNAL, 1.7), hdr(IR_RED, 3.4));
  pin.scale.set(0.65, 0.65, 1.35);
  root.userData.accent = SIGNAL.clone();
  root.userData.shardDirections = [
    new Vector3(1, 0, 0), new Vector3(-1, 0, 0), new Vector3(0, 1, 0), new Vector3(0, -1, 0), new Vector3(0, 0, 1),
  ];
  return root;
}

export function createBoltMesh() {
  const root = createThermalRoot();
  const bolt = fill(root, new OctahedronGeometry(0.34, 0), hdr(RUST, 1.6), hdr(IR_WHITE_HOT, 1.3));
  bolt.scale.set(0.45, 0.45, 2.4);
  edge(root, bolt.geometry, hdr(SIGNAL, 1.25), hdr(IR_WHITE_EDGE, 1));
  const hot = fill(root, new SphereGeometry(0.12, 8, 6), hdr(SIGNAL, 2.2), hdr(IR_RED, 3.4));
  hot.position.z = 0.48;
  root.userData.isHostileShot = true;
  root.userData.accent = SIGNAL.clone();
  root.userData.shardDirections = [new Vector3(0, 0, 1), new Vector3(0, 0, -1)];
  return root;
}

export function createInkCloudMesh() {
  const root = createThermalRoot();
  root.userData.raildIgnoreOcclusion = true;
  const blobs = [
    [-1.7, 0.2, 0.2, 1.1], [-0.65, 1.1, -0.1, 1.45], [0.65, 0.9, 0.1, 1.32], [1.7, 0.15, -0.1, 1.05],
    [-1.05, -0.95, 0.1, 1.3], [0.15, -0.85, -0.1, 1.55], [1.2, -0.78, 0.15, 1.25], [0, 0.05, -0.35, 1.8],
  ] as const;
  for (const [x, y, z, scale] of blobs) {
    const blob = fill(root, new IcosahedronGeometry(1, 1), hdr(INK, 1.2), hdr(IR_INK, 1), 0.58, 0.82);
    blob.position.set(x, y, z);
    blob.scale.setScalar(scale);
    blob.userData.raildIgnoreOcclusion = true;
  }
  const edgeRing = fill(root, new RingGeometry(3.0, 3.08, 64), hdr(OILY, 0.5), hdr(IR_INK, 0.8), 0.22, 0.4);
  edgeRing.userData.raildIgnoreOcclusion = true;
  edgeRing.rotation.x = Math.PI / 2;
  root.userData.accent = INK.clone();
  return root;
}
