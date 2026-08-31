import {
  AdditiveBlending,
  BoxGeometry,
  CircleGeometry,
  ConeGeometry,
  CylinderGeometry,
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
import type { BufferGeometry, Color, Material, Object3D } from 'three';
import { glyphOnCells } from '../../../engine/glyphs';
import type { Broadside806fEnemyKind } from '../gameplay';
import {
  CRIMSON,
  CYAN,
  ENEMY_EDGE,
  ENEMY_HULL,
  FRIENDLY_HULL,
  ICE,
  MOLTEN,
  SHIELD,
  STAR_WHITE,
  hdr,
} from './palette';

type ShipMaterial = MeshBasicMaterial;
const geometryCache = new Map<string, BufferGeometry>();

function sharedGeometry<T extends BufferGeometry>(key: string, create: () => T): T {
  let geometry = geometryCache.get(key) as T | undefined;
  if (!geometry) {
    geometry = create();
    geometryCache.set(key, geometry);
  }
  return geometry;
}

function solid(color: Color, intensity = 1) {
  return new MeshBasicMaterial({ color: hdr(color, intensity) });
}

function glow(color: Color, intensity = 1, opacity = 0.9) {
  return new MeshBasicMaterial({
    color: hdr(color, intensity),
    transparent: true,
    opacity,
    blending: AdditiveBlending,
    depthWrite: false,
    side: DoubleSide,
  });
}

function addMesh(root: Group, geometry: ConstructorParameters<typeof Mesh>[0], material: Material, x: number, y: number, z: number) {
  const mesh = new Mesh(geometry, material);
  mesh.position.set(x, y, z);
  root.add(mesh);
  return mesh;
}

function finalize(root: Group, kind: string, accents: ShipMaterial[], animated: Object3D[] = []) {
  root.userData.kind = kind;
  root.userData.accents = accents;
  root.userData.animated = animated;
  root.userData.baseScale = 1;
  return root;
}

export function createSkirmisherMesh() {
  const root = new Group();
  const hull = solid(ENEMY_HULL, 1.3);
  const edge = solid(ENEMY_EDGE, 1.4);
  const molten = glow(MOLTEN, 1.45);

  const body = addMesh(root, sharedGeometry('skirmisher-body', () => new ConeGeometry(0.82, 4.8, 5)), hull, 0, 0, 0);
  body.rotation.x = Math.PI / 2;
  const leftWing = addMesh(root, sharedGeometry('skirmisher-wing', () => new BoxGeometry(3.9, 0.16, 1.25)), edge, -1.75, 0, 0.2);
  leftWing.rotation.z = -0.22;
  leftWing.rotation.y = 0.16;
  const rightWing = addMesh(root, sharedGeometry('skirmisher-wing', () => new BoxGeometry(3.9, 0.16, 1.25)), edge, 1.75, 0, 0.2);
  rightWing.rotation.z = 0.22;
  rightWing.rotation.y = -0.16;
  const tail = addMesh(root, sharedGeometry('skirmisher-tail', () => new RingGeometry(0.48, 0.67, 12)), molten, 0, 0, 2.15);
  tail.rotation.y = Math.PI;
  addMesh(root, sharedGeometry('skirmisher-seam', () => new BoxGeometry(0.11, 0.08, 3.25)), molten, 0, 0.44, 0.2);
  return finalize(root, 'skirmisher', [molten], [leftWing, rightWing, tail]);
}

export function createInterceptorMesh() {
  const root = new Group();
  const hull = solid(ENEMY_HULL, 1.45);
  const rim = solid(ENEMY_EDGE, 1.6);
  const crimson = glow(CRIMSON, 1.65);

  const needle = addMesh(root, sharedGeometry('interceptor-needle', () => new ConeGeometry(0.38, 6.2, 4)), hull, 0, 0, -0.3);
  needle.rotation.x = -Math.PI / 2;
  for (let index = 0; index < 3; index += 1) {
    const angle = index / 3 * Math.PI * 2;
    const fin = addMesh(root, sharedGeometry('interceptor-fin', () => new BoxGeometry(0.16, 1.55, 2.25)), rim, Math.cos(angle) * 0.82, Math.sin(angle) * 0.82, 1.05);
    fin.rotation.z = angle;
    fin.rotation.y = angle * 0.2;
  }
  const core = addMesh(root, sharedGeometry('interceptor-core', () => new OctahedronGeometry(0.42, 0)), crimson, 0, 0, -2.7);
  addMesh(root, sharedGeometry('interceptor-ring', () => new TorusGeometry(0.72, 0.08, 5, 18)), crimson, 0, 0, 1.8);
  return finalize(root, 'interceptor', [crimson], [core]);
}

export function createBomberMesh() {
  const root = new Group();
  const hull = solid(ENEMY_HULL, 1.45);
  const armor = solid(ENEMY_EDGE, 1.65);
  const molten = glow(MOLTEN, 1.55);
  const crimson = glow(CRIMSON, 1.35);

  const body = addMesh(root, sharedGeometry('bomber-body', () => new IcosahedronGeometry(1.55, 0)), hull, 0, 0, 0);
  body.scale.set(1.15, 0.78, 1.8);
  for (const side of [-1, 1]) {
    const pod = addMesh(root, sharedGeometry('bomber-pod', () => new CylinderGeometry(0.48, 0.72, 3.1, 6)), armor, side * 2.05, -0.18, 0.55);
    pod.rotation.x = Math.PI / 2;
    addMesh(root, sharedGeometry('bomber-engine', () => new CircleGeometry(0.43, 12)), molten, side * 2.05, -0.18, 2.12);
    const claw = addMesh(root, sharedGeometry('bomber-claw', () => new BoxGeometry(1.15, 0.22, 2.7)), armor, side * 1.45, 0.52, -0.25);
    claw.rotation.z = side * 0.18;
  }
  const eye = addMesh(root, sharedGeometry('bomber-eye', () => new SphereGeometry(0.48, 10, 7)), crimson, 0, 0.15, -1.95);
  addMesh(root, sharedGeometry('bomber-ring', () => new TorusGeometry(1.0, 0.07, 5, 20)), molten, 0, 0, -1.62);
  return finalize(root, 'bomber', [molten, crimson], [eye]);
}

export function createTurretMesh() {
  const root = new Group();
  const hull = solid(ENEMY_HULL, 1.55);
  const armor = solid(ENEMY_EDGE, 1.7);
  const hot = glow(MOLTEN, 1.55);
  const red = glow(CRIMSON, 1.5);
  const base = addMesh(root, sharedGeometry('turret-base', () => new CylinderGeometry(2.1, 2.65, 1.35, 8)), hull, 0, -0.6, 0);
  base.rotation.x = Math.PI / 2;
  const cradle = addMesh(root, sharedGeometry('turret-cradle', () => new BoxGeometry(3.2, 1.25, 1.6)), armor, 0, 0.28, 0);
  const barrels = new Group();
  for (const side of [-1, 1]) {
    const barrel = addMesh(barrels, sharedGeometry('turret-barrel', () => new CylinderGeometry(0.18, 0.3, 4.6, 6)), armor, side * 0.72, 0.55, -2.2);
    barrel.rotation.x = Math.PI / 2;
    addMesh(barrels, sharedGeometry('turret-muzzle', () => new RingGeometry(0.22, 0.38, 10)), red, side * 0.72, 0.55, -4.5);
  }
  root.add(barrels);
  addMesh(root, sharedGeometry('turret-seam', () => new BoxGeometry(0.14, 0.12, 2.5)), hot, 0, 1.0, 0.2);
  return finalize(root, 'turret', [hot, red], [cradle, barrels]);
}

export function createFlakMesh() {
  const root = new Group();
  const red = glow(CRIMSON, 2.0);
  const hot = glow(MOLTEN, 1.65);
  const core = addMesh(root, sharedGeometry('flak-core', () => new SphereGeometry(0.42, 10, 7)), red, 0, 0, 0);
  for (let index = 0; index < 3; index += 1) {
    const ring = addMesh(root, sharedGeometry(`flak-ring-${index}`, () => new TorusGeometry(0.72 + index * 0.14, 0.055, 5, 16)), index % 2 ? hot : red, 0, 0, 0);
    ring.rotation.x = index * 0.73;
    ring.rotation.y = index * 0.51;
  }
  return finalize(root, 'flak', [red, hot], [core]);
}

export function createGeneratorMesh() {
  const root = new Group();
  const armor = solid(ENEMY_HULL, 1.65);
  const rim = solid(ENEMY_EDGE, 1.85);
  const shield = glow(SHIELD, 1.55, 0.82);
  const molten = glow(MOLTEN, 1.65);
  const hub = addMesh(root, sharedGeometry('generator-hub', () => new IcosahedronGeometry(1.35, 1)), armor, 0, 0, 0);
  hub.scale.z = 1.35;
  const rings = new Group();
  for (let index = 0; index < 3; index += 1) {
    const ring = addMesh(rings, sharedGeometry(`generator-ring-${index}`, () => new TorusGeometry(2.0 + index * 0.42, 0.1, 6, 30)), index === 2 ? molten : shield, 0, 0, 0);
    ring.rotation.x = index * 0.72;
    ring.rotation.y = index * 0.55;
  }
  root.add(rings);
  const core = addMesh(root, sharedGeometry('generator-core', () => new SphereGeometry(0.62, 12, 8)), shield, 0, 0, -0.9);
  for (let index = 0; index < 4; index += 1) {
    const pylon = addMesh(root, sharedGeometry('generator-pylon', () => new BoxGeometry(0.55, 0.35, 2.4)), rim, 0, 0, 0.1);
    pylon.rotation.z = index * Math.PI / 2;
    pylon.position.set(Math.cos(index * Math.PI / 2) * 2.8, Math.sin(index * Math.PI / 2) * 2.8, 0.7);
  }
  return finalize(root, 'generator', [shield, molten], [rings, core]);
}

export function createPowerMesh() {
  const root = new Group();
  const armor = solid(ENEMY_HULL, 1.7);
  const rim = solid(ENEMY_EDGE, 1.9);
  const hot = glow(MOLTEN, 2.0);
  const red = glow(CRIMSON, 1.75);
  const casing = new Group();
  for (let index = 0; index < 6; index += 1) {
    const angle = index / 6 * Math.PI * 2;
    const plate = addMesh(casing, sharedGeometry('power-plate', () => new BoxGeometry(1.3, 0.42, 3.2)), index % 2 ? armor : rim, Math.cos(angle) * 2.2, Math.sin(angle) * 2.2, 0);
    plate.rotation.z = angle + Math.PI / 2;
    plate.rotation.y = 0.18 * (index % 2 ? 1 : -1);
  }
  root.add(casing);
  const core = addMesh(root, sharedGeometry('power-core', () => new IcosahedronGeometry(1.2, 1)), hot, 0, 0, -0.3);
  const ring = addMesh(root, sharedGeometry('power-outer-ring', () => new TorusGeometry(2.85, 0.13, 7, 32)), red, 0, 0, 0);
  addMesh(root, sharedGeometry('power-inner-ring', () => new TorusGeometry(1.72, 0.08, 6, 26)), hot, 0, 0, -0.15);
  return finalize(root, 'power', [hot, red], [casing, core, ring]);
}

export function createLetterMesh(character: string) {
  const root = new Group();
  const plateMaterial = new MeshBasicMaterial({
    color: hdr(ENEMY_HULL, 1.2),
    transparent: true,
    opacity: 0.92,
  });
  const edgeMaterial = glow(CYAN, 1.25, 0.82);
  const lampMaterial = glow(ICE, 1.55, 0.96);
  const plate = addMesh(root, sharedGeometry('letter-plate', () => new BoxGeometry(2.2, 3.15, 0.22)), plateMaterial, 0, 0, 0.2);
  plate.rotation.z = Math.sin(character.charCodeAt(0)) * 0.025;
  const cellGeometry = sharedGeometry('letter-cell', () => new BoxGeometry(0.28, 0.28, 0.12));
  for (const cell of glyphOnCells(character)) {
    const lamp = new Mesh(cellGeometry, lampMaterial);
    lamp.position.set((cell.x - 2) * 0.37, (3 - cell.y) * 0.37, -0.02);
    root.add(lamp);
  }
  const frame = addMesh(root, sharedGeometry('letter-frame', () => new RingGeometry(1.72, 1.79, 4)), edgeMaterial, 0, 0, -0.04);
  frame.scale.y = 1.2;
  root.userData.isLetter = true;
  return finalize(root, 'letter', [edgeMaterial, lampMaterial], [frame]);
}

export function createPlayerProjectile() {
  const root = new Group();
  const beam = glow(CYAN, 2.2);
  const ice = glow(STAR_WHITE, 2.8);
  const shaft = addMesh(root, sharedGeometry('projectile-shaft', () => new CylinderGeometry(0.07, 0.18, 2.8, 6)), beam, 0, 0, 0);
  shaft.rotation.x = Math.PI / 2;
  addMesh(root, sharedGeometry('projectile-head', () => new ConeGeometry(0.28, 0.9, 6)), ice, 0, 0, -1.7).rotation.x = -Math.PI / 2;
  addMesh(root, sharedGeometry('projectile-ring', () => new RingGeometry(0.22, 0.48, 12)), beam, 0, 0, 1.25);
  root.userData.accents = [beam, ice];
  return root;
}

export function createEnemyModel(kind: Broadside806fEnemyKind | 'letter', letter?: string) {
  switch (kind) {
    case 'letter': return createLetterMesh(letter ?? 'A');
    case 'skirmisher': return createSkirmisherMesh();
    case 'interceptor': return createInterceptorMesh();
    case 'bomber': return createBomberMesh();
    case 'turret': return createTurretMesh();
    case 'flak': return createFlakMesh();
    case 'generator': return createGeneratorMesh();
    case 'power': return createPowerMesh();
  }
}
