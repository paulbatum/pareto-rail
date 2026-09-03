import {
  AdditiveBlending,
  BoxGeometry,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  Group,
  IcosahedronGeometry,
  Mesh,
  MeshBasicMaterial,
  OctahedronGeometry,
  PlaneGeometry,
  RingGeometry,
  SphereGeometry,
  TorusGeometry,
} from 'three';
import { glyphOnCells } from '../../../engine/glyphs';
import type { Broadside61z2EnemyKind } from '../gameplay';
import { hdr, type BroadsidePalette } from './palette';

function material(color: BroadsidePalette[keyof BroadsidePalette], intensity = 1, additive = false) {
  const base = color.clone().multiplyScalar(intensity);
  const result = new MeshBasicMaterial({
    color: base,
    side: DoubleSide,
    transparent: additive,
    depthWrite: !additive,
    blending: additive ? AdditiveBlending : undefined,
  });
  result.userData.baseColor = base.clone();
  return result;
}

function remember(group: Group, ...materials: MeshBasicMaterial[]) {
  group.userData.materials = materials;
  return group;
}

export function createDefenseMesh(kind: Broadside61z2EnemyKind, palette: BroadsidePalette) {
  if (kind === 'skiff') return createSkiff(palette);
  if (kind === 'corsair') return createCorsair(palette);
  if (kind === 'interceptor') return createInterceptor(palette);
  if (kind === 'point-defense') return createPointDefense(palette);
  if (kind === 'bolt') return createBolt(palette);
  if (kind === 'shield-generator') return createShieldGenerator(palette);
  return createPowerCore(palette);
}

function createSkiff(palette: BroadsidePalette) {
  const group = new Group();
  const shell = material(palette.obsidian, 1.45);
  const edge = material(palette.orange, 1.7, true);
  const eye = material(palette.crimson, 2.5, true);
  const nose = new Mesh(new ConeGeometry(0.58, 2.25, 3), shell);
  nose.rotation.x = Math.PI / 2;
  const wingGeometry = new BoxGeometry(1.55, 0.08, 0.45);
  const leftWing = new Mesh(wingGeometry, shell);
  const rightWing = new Mesh(wingGeometry, shell);
  leftWing.position.x = -0.82;
  rightWing.position.x = 0.82;
  leftWing.rotation.z = -0.18;
  rightWing.rotation.z = 0.18;
  const hotRail = new Mesh(new BoxGeometry(3.4, 0.045, 0.09), edge);
  hotRail.position.y = -0.26;
  const core = new Mesh(new SphereGeometry(0.15, 8, 6), eye);
  core.position.z = 0.82;
  group.add(nose, leftWing, rightWing, hotRail, core);
  group.userData.flexParts = [leftWing, rightWing];
  group.userData.accent = palette.orange;
  return remember(group, shell, edge, eye);
}

function createCorsair(palette: BroadsidePalette) {
  const group = new Group();
  const shell = material(palette.obsidianEdge, 1.35);
  const trim = material(palette.orange, 1.65, true);
  const eye = material(palette.scarlet, 2.25, true);
  const body = new Mesh(new OctahedronGeometry(0.62, 0), shell);
  body.scale.set(0.55, 0.7, 1.85);
  const wingGeometry = new PlaneGeometry(3.2, 0.7);
  const port = new Mesh(wingGeometry, shell);
  const starboard = new Mesh(wingGeometry, shell);
  port.position.set(-1.28, 0, -0.1);
  starboard.position.set(1.28, 0, -0.1);
  port.rotation.z = 0.2;
  starboard.rotation.z = -0.2;
  const spine = new Mesh(new BoxGeometry(0.08, 0.08, 4.2), trim);
  spine.position.y = -0.18;
  const ring = new Mesh(new TorusGeometry(0.74, 0.055, 5, 18), trim);
  ring.rotation.x = Math.PI / 2;
  const core = new Mesh(new SphereGeometry(0.19, 9, 7), eye);
  core.position.z = 0.92;
  group.add(port, starboard, body, spine, ring, core);
  group.userData.flexParts = [port, starboard];
  group.userData.rotors = [ring];
  group.userData.accent = palette.orange;
  return remember(group, shell, trim, eye);
}

function createInterceptor(palette: BroadsidePalette) {
  const group = new Group();
  const shell = material(palette.obsidian, 1.5);
  const edge = material(palette.orange, 1.9, true);
  const eye = material(palette.crimson, 2.7, true);
  const body = new Mesh(new IcosahedronGeometry(0.5, 0), shell);
  body.scale.set(0.78, 0.78, 1.45);
  const halo = new Mesh(new TorusGeometry(0.93, 0.075, 5, 22), edge);
  halo.rotation.x = Math.PI / 2;
  const rotorA = new Mesh(new BoxGeometry(2.9, 0.075, 0.13), edge);
  const rotorB = rotorA.clone();
  rotorA.rotation.z = Math.PI / 3;
  rotorB.rotation.z = -Math.PI / 3;
  const core = new Mesh(new SphereGeometry(0.17, 8, 6), eye);
  group.add(body, halo, rotorA, rotorB, core);
  group.userData.rotors = [halo, rotorA, rotorB];
  group.userData.accent = palette.orange;
  return remember(group, shell, edge, eye);
}

function createPointDefense(palette: BroadsidePalette) {
  const group = new Group();
  const shell = material(palette.obsidianEdge, 1.65);
  const orange = material(palette.orange, 1.85, true);
  const eye = material(palette.crimson, 3.0, true);
  const base = new Mesh(new CylinderGeometry(0.55, 0.78, 0.42, 8), shell);
  const turret = new Mesh(new CylinderGeometry(0.42, 0.5, 0.72, 8), shell);
  turret.position.y = 0.42;
  const barrel = new Mesh(new CylinderGeometry(0.11, 0.16, 1.9, 6), orange);
  barrel.rotation.x = Math.PI / 2;
  barrel.position.z = 0.68;
  const sight = new Mesh(new TorusGeometry(0.62, 0.045, 4, 20), orange);
  sight.rotation.x = Math.PI / 2;
  const lamp = new Mesh(new SphereGeometry(0.17, 8, 6), eye);
  lamp.position.z = 1.12;
  group.add(base, turret, barrel, sight, lamp);
  group.userData.rotors = [sight];
  group.userData.chargeLamp = eye;
  group.userData.accent = palette.crimson;
  return remember(group, shell, orange, eye);
}

function createBolt(palette: BroadsidePalette) {
  const group = new Group();
  const shell = material(palette.crimson, 1.7);
  const orange = material(palette.orange, 2.0, true);
  const core = material(palette.white, 2.8, true);
  const body = new Mesh(new IcosahedronGeometry(0.38, 1), shell);
  const halo = new Mesh(new TorusGeometry(0.63, 0.045, 5, 18), orange);
  const haloB = new Mesh(new TorusGeometry(0.72, 0.028, 4, 18), orange);
  halo.rotation.x = Math.PI / 2;
  haloB.rotation.y = Math.PI / 2;
  const hotCore = new Mesh(new SphereGeometry(0.17, 8, 6), core);
  group.add(body, halo, haloB, hotCore);
  group.userData.rotors = [halo, haloB];
  group.userData.isHostileShot = true;
  group.userData.accent = palette.crimson;
  return remember(group, shell, orange, core);
}

function createShieldGenerator(palette: BroadsidePalette) {
  const group = new Group();
  const plate = material(palette.obsidianEdge, 1.8);
  const orange = material(palette.orange, 2.0, true);
  const red = material(palette.crimson, 2.6, true);
  const housing = new Mesh(new CylinderGeometry(0.64, 0.82, 0.55, 6), plate);
  housing.rotation.x = Math.PI / 2;
  const frame = new Mesh(new TorusGeometry(1.18, 0.1, 5, 24), orange);
  frame.rotation.x = Math.PI / 2;
  const ring = new Mesh(new TorusGeometry(0.8, 0.06, 5, 20), red);
  ring.rotation.y = Math.PI / 2;
  const pylonA = new Mesh(new BoxGeometry(0.12, 1.7, 0.12), plate);
  const pylonB = pylonA.clone();
  pylonA.rotation.z = Math.PI / 4;
  pylonB.rotation.z = -Math.PI / 4;
  const core = new Mesh(new SphereGeometry(0.23, 9, 7), red);
  core.position.z = 0.36;
  group.add(housing, frame, ring, pylonA, pylonB, core);
  group.userData.rotors = [frame, ring];
  group.userData.isShieldGenerator = true;
  group.userData.accent = palette.orange;
  return remember(group, plate, orange, red);
}

function createPowerCore(palette: BroadsidePalette) {
  const group = new Group();
  const housing = material(palette.obsidian, 1.9);
  const orange = material(palette.orange, 2.0, true);
  const white = material(palette.white, 2.8, true);
  const core = new Mesh(new OctahedronGeometry(0.62, 1), white);
  core.scale.z = 1.35;
  const cage = new Mesh(new TorusGeometry(1.08, 0.095, 5, 24), orange);
  cage.rotation.x = Math.PI / 2;
  const cageB = new Mesh(new TorusGeometry(0.9, 0.07, 5, 24), orange);
  cageB.rotation.y = Math.PI / 2;
  const armGeometry = new BoxGeometry(0.12, 1.9, 0.12);
  const arms = [0, 1, 2].map((index) => {
    const arm = new Mesh(armGeometry, housing);
    arm.rotation.z = index * Math.PI / 3;
    return arm;
  });
  group.add(core, cage, cageB, ...arms);
  group.userData.rotors = [cage, cageB];
  group.userData.isPowerCore = true;
  group.userData.accent = palette.orange;
  return remember(group, housing, orange, white);
}

export function createBroadsideGlyph(character: string, palette: BroadsidePalette) {
  const group = new Group();
  const plate = material(palette.obsidian, 1.45);
  const cell = material(palette.ice, 1.35);
  const hot = material(palette.cyanWhite, 2.1, true);
  const frame = material(palette.cyan, 1.7, true);
  const backing = new Mesh(new BoxGeometry(1.72, 2.42, 0.08), plate);
  backing.position.z = -0.07;
  const cellGeometry = new BoxGeometry(0.22, 0.22, 0.1);
  const hotGeometry = new BoxGeometry(0.08, 0.08, 0.11);
  for (const point of glyphOnCells(character)) {
    const block = new Mesh(cellGeometry, cell);
    const spark = new Mesh(hotGeometry, hot);
    block.position.set((point.x - 2) * 0.27, (3 - point.y) * 0.27, 0.04);
    spark.position.copy(block.position);
    spark.position.z = 0.1;
    group.add(block, spark);
  }
  const border = new Mesh(new RingGeometry(1.02, 0.045, 6), frame);
  border.rotation.z = Math.PI / 6;
  border.position.z = 0.09;
  group.add(backing, border);
  group.userData.isLetter = true;
  group.userData.materials = [plate, cell, hot, frame];
  return group;
}

export function createBroadsideProjectile(palette: BroadsidePalette) {
  const group = new Group();
  const bodyMaterial = material(palette.cyan, 1.9, true);
  const coreMaterial = material(palette.white, 2.8, true);
  const body = new Mesh(new CylinderGeometry(0.07, 0.14, 1.25, 6), bodyMaterial);
  const core = new Mesh(new SphereGeometry(0.13, 7, 5), coreMaterial);
  core.position.y = 0.58;
  group.add(body, core);
  group.userData.materials = [bodyMaterial, coreMaterial];
  group.userData.isProjectile = true;
  return group;
}

export function createBroadsideReticle(palette: BroadsidePalette) {
  const group = new Group();
  const outerMaterial = material(palette.cyan, 1.7, true);
  const innerMaterial = material(palette.cyanWhite, 1.4, true);
  const outer = new Mesh(new RingGeometry(0.62, 0.68, 32), outerMaterial);
  const inner = new Mesh(new RingGeometry(0.76, 0.79, 6), innerMaterial);
  const ticks = new Group();
  const tickMaterial = material(palette.ice, 1.5, true);
  for (let index = 0; index < 6; index += 1) {
    const tick = new Mesh(new BoxGeometry(0.045, 0.22, 0.04), tickMaterial);
    const angle = index / 6 * Math.PI * 2;
    tick.position.set(Math.cos(angle) * 0.92, Math.sin(angle) * 0.92, 0.01);
    tick.rotation.z = angle;
    ticks.add(tick);
  }
  group.add(outer, inner, ticks);
  group.userData.materials = [outerMaterial, innerMaterial, tickMaterial];
  group.userData.rotors = [outer, inner, ticks];
  group.userData.ticks = ticks;
  return group;
}
