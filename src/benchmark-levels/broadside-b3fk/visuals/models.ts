import {
  AdditiveBlending,
  BoxGeometry,
  Color,
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
import type { Object3D } from 'three';
import { glyphOnCells } from '../../../engine/glyphs';
import type { BroadsideB3fkEnemyKind } from '../gameplay';

export type BroadsidePalette = {
  void: Color;
  friendlyHull: Color;
  friendlyDark: Color;
  cyan: Color;
  cyanWhite: Color;
  enemyHull: Color;
  enemyEdge: Color;
  molten: Color;
  crimson: Color;
  magenta: Color;
  gold: Color;
};

function material(color: Color, intensity = 1, transparent = false, opacity = 1) {
  const baseColor = color.clone();
  const result = new MeshBasicMaterial({
    color: baseColor.clone().multiplyScalar(intensity),
    transparent,
    opacity,
    depthWrite: !transparent,
    side: DoubleSide,
    blending: transparent ? AdditiveBlending : undefined,
  });
  result.userData.baseColor = baseColor;
  result.userData.baseIntensity = intensity;
  return result;
}

function register(group: Group, value: MeshBasicMaterial) {
  const materials = group.userData.materials as MeshBasicMaterial[];
  materials.push(value);
  return value;
}

function mesh(group: Group, geometry: ConstructorParameters<typeof Mesh>[0], value: MeshBasicMaterial) {
  const child = new Mesh(geometry, value);
  group.add(child);
  return child;
}

function baseGroup() {
  const group = new Group();
  group.userData.materials = [] as MeshBasicMaterial[];
  group.userData.rotors = [] as Object3D[];
  group.userData.flexParts = [] as Object3D[];
  return group;
}

function createInterceptor(palette: BroadsidePalette) {
  const group = baseGroup();
  const hull = register(group, material(palette.enemyHull));
  const edge = register(group, material(palette.molten, 1.55));
  const hot = register(group, material(palette.crimson, 2));
  const body = mesh(group, new ConeGeometry(0.7, 3.6, 5), hull);
  body.rotation.x = Math.PI / 2;
  const wing = new BoxGeometry(4.4, 0.13, 0.78);
  const wings = mesh(group, wing, hull);
  wings.position.z = 0.35;
  for (const side of [-1, 1]) {
    const swept = mesh(group, new BoxGeometry(2.25, 0.16, 0.62), hull);
    swept.position.set(side * 1.38, -0.15, -0.38);
    swept.rotation.z = side * 0.24;
    swept.rotation.y = side * 0.18;
    const enginePod = mesh(group, new CylinderGeometry(0.22, 0.34, 1.45, 6), hull);
    enginePod.rotation.x = Math.PI / 2;
    enginePod.position.set(side * 1.72, -0.18, -0.45);
    const podGlow = mesh(group, new RingGeometry(0.18, 0.32, 8), hot);
    podGlow.position.set(side * 1.72, -0.18, 0.29);
    group.userData.rotors.push(podGlow);
  }
  const slashA = mesh(group, new BoxGeometry(3.7, 0.05, 0.12), edge);
  slashA.position.set(0, 0.12, 0.3);
  const slashB = slashA.clone();
  slashB.position.y = -0.12;
  group.add(slashB);
  const core = mesh(group, new SphereGeometry(0.24, 8, 6), hot);
  core.position.z = 1.28;
  const tail = mesh(group, new RingGeometry(0.22, 0.4, 10), edge);
  tail.position.z = -1.6;
  group.userData.rotors.push(tail);
  group.scale.setScalar(1.05);
  return group;
}

function createBomber(palette: BroadsidePalette) {
  const group = baseGroup();
  const hull = register(group, material(palette.enemyHull));
  const edge = register(group, material(palette.molten, 1.5));
  const hot = register(group, material(palette.crimson, 2.2));
  const body = mesh(group, new OctahedronGeometry(1.35, 0), hull);
  body.scale.set(1, 0.68, 1.8);
  const cage = mesh(group, new TorusGeometry(1.75, 0.12, 6, 18), edge);
  cage.rotation.x = Math.PI / 2;
  const cageB = mesh(group, new TorusGeometry(1.2, 0.08, 5, 14), edge);
  cageB.rotation.y = Math.PI / 2;
  group.userData.rotors.push(cage, cageB);
  for (const side of [-1, 1]) {
    const pod = mesh(group, new CylinderGeometry(0.34, 0.48, 2.3, 6), hull);
    pod.rotation.x = Math.PI / 2;
    pod.position.x = side * 1.65;
    const slit = mesh(group, new BoxGeometry(0.14, 0.5, 1.5), edge);
    slit.position.set(side * 1.68, 0, 0.18);
  }
  const eye = mesh(group, new SphereGeometry(0.33, 8, 6), hot);
  eye.position.z = 1.45;
  group.scale.setScalar(1.08);
  return group;
}

function createSkiff(palette: BroadsidePalette) {
  const group = baseGroup();
  const hull = register(group, material(palette.enemyHull));
  const edge = register(group, material(palette.molten, 1.65));
  const hot = register(group, material(palette.crimson, 2.1));
  const spine = mesh(group, new BoxGeometry(0.72, 0.6, 4.3), hull);
  spine.rotation.z = 0.12;
  const hammer = mesh(group, new BoxGeometry(4.2, 0.3, 1.25), hull);
  hammer.position.z = 0.65;
  hammer.rotation.z = -0.15;
  const blade = mesh(group, new BoxGeometry(5, 0.06, 0.16), edge);
  blade.position.set(0, 0.25, 0.74);
  blade.rotation.z = -0.15;
  const chin = mesh(group, new ConeGeometry(0.5, 1.8, 4), hull);
  chin.rotation.x = Math.PI / 2;
  chin.position.set(0.7, -0.45, 1.2);
  const eye = mesh(group, new SphereGeometry(0.26, 8, 5), hot);
  eye.position.set(-0.55, 0.05, 1.78);
  const crescent = mesh(group, new TorusGeometry(2.65, 0.16, 5, 22, Math.PI * 1.22), edge);
  crescent.rotation.z = -Math.PI * 0.11;
  crescent.position.set(-0.2, 0.12, 0.18);
  for (const side of [-1, 1]) {
    const fang = mesh(group, new ConeGeometry(0.32, 1.75, 4), hull);
    fang.rotation.z = side * 0.54;
    fang.rotation.x = Math.PI / 2;
    fang.position.set(side * 2.15, -0.22, 0.62);
    const ember = mesh(group, new BoxGeometry(0.12, 0.12, 1.3), edge);
    ember.position.set(side * 1.55, 0.2, -0.35);
    ember.rotation.z = side * 0.32;
  }
  group.userData.flexParts.push(hammer, blade, crescent);
  return group;
}

function createEscort(palette: BroadsidePalette) {
  const group = createInterceptor(palette);
  const hot = register(group, material(palette.crimson, 2.2));
  for (const side of [-1, 1]) {
    const fin = mesh(group, new ConeGeometry(0.36, 2.4, 3), hot);
    fin.rotation.x = Math.PI / 2;
    fin.rotation.z = side * 0.7;
    fin.position.set(side * 2.15, 0, -0.15);
  }
  group.scale.setScalar(0.86);
  return group;
}

function createPdcBolt(palette: BroadsidePalette) {
  const group = baseGroup();
  const hot = register(group, material(palette.crimson, 2.8));
  const dark = register(group, material(palette.enemyHull));
  mesh(group, new SphereGeometry(0.38, 8, 6), hot);
  const cage = mesh(group, new IcosahedronGeometry(0.78, 0), dark);
  cage.scale.set(0.5, 0.5, 1.5);
  const ring = mesh(group, new TorusGeometry(0.67, 0.06, 5, 14), hot);
  ring.rotation.x = Math.PI / 2;
  group.userData.rotors.push(cage, ring);
  return group;
}

function createShieldGenerator(palette: BroadsidePalette) {
  const group = baseGroup();
  const hull = register(group, material(palette.enemyHull));
  const edge = register(group, material(palette.molten, 1.7));
  const hot = register(group, material(palette.crimson, 2.3));
  const base = mesh(group, new CylinderGeometry(1.55, 2, 0.72, 8), hull);
  base.rotation.x = Math.PI / 2;
  const core = mesh(group, new OctahedronGeometry(0.72, 1), hot);
  core.position.z = 0.75;
  const iris = mesh(group, new RingGeometry(0.78, 1.02, 12), edge);
  iris.position.z = 0.69;
  group.userData.rotors.push(iris);
  const rotors: Object3D[] = [];
  for (let index = 0; index < 4; index += 1) {
    const angle = index / 4 * Math.PI * 2;
    const prong = mesh(group, new BoxGeometry(0.28, 0.86, 2.45), hull);
    prong.position.set(Math.cos(angle) * 1.65, Math.sin(angle) * 1.65, 0.4);
    prong.rotation.z = angle;
    const seam = mesh(group, new BoxGeometry(0.09, 0.58, 2.12), edge);
    seam.position.copy(prong.position);
    seam.rotation.z = angle;
    rotors.push(prong, seam);
  }
  const ring = mesh(group, new TorusGeometry(2.2, 0.12, 6, 24), edge);
  ring.position.z = 0.55;
  group.userData.rotors.push(ring);
  group.userData.jaws = rotors;
  group.userData.isShieldGenerator = true;
  return group;
}

function createPowerCore(palette: BroadsidePalette) {
  const group = baseGroup();
  const hull = register(group, material(palette.enemyHull));
  const edge = register(group, material(palette.gold, 1.65));
  const hot = register(group, material(palette.molten, 2.5));
  const core = mesh(group, new IcosahedronGeometry(1.15, 1), hot);
  core.scale.set(1, 1.35, 1);
  const ringA = mesh(group, new TorusGeometry(1.8, 0.15, 6, 24), edge);
  const ringB = mesh(group, new TorusGeometry(1.8, 0.15, 6, 24), edge);
  ringB.rotation.x = Math.PI / 2;
  const ringC = mesh(group, new TorusGeometry(1.8, 0.12, 6, 24), hull);
  ringC.rotation.y = Math.PI / 2;
  group.userData.rotors.push(core, ringA, ringB, ringC);
  group.userData.isPowerCore = true;
  return group;
}

export function createBroadsideEnemy(kind: BroadsideB3fkEnemyKind, palette: BroadsidePalette) {
  if (kind === 'interceptor') return createInterceptor(palette);
  if (kind === 'bomber') return createBomber(palette);
  if (kind === 'skiff') return createSkiff(palette);
  if (kind === 'escort') return createEscort(palette);
  if (kind === 'pdcBolt') return createPdcBolt(palette);
  if (kind === 'shieldGen') return createShieldGenerator(palette);
  return createPowerCore(palette);
}

export function createFleetGlyph(character: string, palette: BroadsidePalette) {
  const group = baseGroup();
  const plate = register(group, material(palette.friendlyDark));
  const lamp = register(group, material(palette.cyanWhite, 1.9));
  const trim = register(group, material(palette.cyan, 1.25));
  const backing = mesh(group, new BoxGeometry(2.15, 2.75, 0.25), plate);
  backing.position.z = -0.12;
  for (const cell of glyphOnCells(character)) {
    const block = mesh(group, new BoxGeometry(0.28, 0.28, 0.13), lamp);
    block.position.set((cell.x - 2) * 0.34, (3 - cell.y) * 0.34, 0.12);
  }
  const frame = mesh(group, new TorusGeometry(1.7, 0.055, 5, 6), trim);
  frame.scale.y = 0.82;
  frame.rotation.z = Math.PI / 6;
  group.userData.rotors.push(frame);
  return group;
}

export function createBroadsideProjectile(palette: BroadsidePalette) {
  const group = baseGroup();
  const hot = register(group, material(palette.cyanWhite, 2.4));
  const cyan = register(group, material(palette.cyan, 1.7, true, 0.9));
  const needle = mesh(group, new ConeGeometry(0.16, 1.5, 6), hot);
  needle.rotation.x = Math.PI / 2;
  const halo = mesh(group, new RingGeometry(0.35, 0.48, 12), cyan);
  halo.position.z = -0.32;
  group.userData.rotors.push(halo);
  return group;
}

export function createBroadsideReticle(palette: BroadsidePalette) {
  const group = baseGroup();
  const cyan = register(group, material(palette.cyan, 1.55, true, 0.95));
  const white = register(group, material(palette.cyanWhite, 1.8, true, 0.95));
  const outer = mesh(group, new RingGeometry(0.47, 0.53, 6), cyan);
  outer.rotation.z = Math.PI / 6;
  const inner = mesh(group, new RingGeometry(0.26, 0.29, 24), white);
  for (let index = 0; index < 6; index += 1) {
    const tick = mesh(group, new BoxGeometry(0.075, 0.24, 0.02), cyan);
    const angle = index / 6 * Math.PI * 2;
    tick.position.set(Math.cos(angle) * 0.68, Math.sin(angle) * 0.68, 0);
    tick.rotation.z = angle + Math.PI / 2;
  }
  group.userData.rotors.push(outer, inner);
  return group;
}
