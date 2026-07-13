import {
  AdditiveBlending,
  BoxGeometry,
  Color,
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
import type { MassDriver9281EnemyKind } from '../gameplay';

export type MassDriverPalette = {
  void: Color;
  steel: Color;
  dormant: Color;
  arc: Color;
  violet: Color;
  white: Color;
  warning: Color;
};

function material(color: Color, intensity = 1, additive = false) {
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

export function createDefenseDrone(kind: MassDriver9281EnemyKind, palette: MassDriverPalette) {
  if (kind === 'weaver') return createWeaver(palette);
  if (kind === 'switchblade') return createSwitchblade(palette);
  if (kind === 'sentinel') return createSentinel(palette);
  if (kind === 'bolt') return createArcBolt(palette);
  return createInterlock(palette);
}

function createArcBolt(palette: MassDriverPalette) {
  const group = new Group();
  const warning = material(palette.warning, 1.75);
  const arc = material(palette.arc, 2.15, true);
  const core = material(palette.white, 2.8, true);
  const shell = new Mesh(new IcosahedronGeometry(0.46, 1), warning);
  const hotCore = new Mesh(new SphereGeometry(0.2, 9, 7), core);
  group.add(shell, hotCore);
  const rotors: Mesh[] = [];
  for (let index = 0; index < 3; index += 1) {
    const ring = new Mesh(new TorusGeometry(0.7 + index * 0.13, 0.035, 4, 20), arc);
    ring.rotation.x = index * Math.PI / 3;
    ring.rotation.y = index * Math.PI / 4;
    rotors.push(ring);
    group.add(ring);
  }
  group.userData.rotors = rotors;
  group.userData.isBolt = true;
  group.userData.accent = palette.warning;
  return remember(group, warning, arc, core);
}

function createWeaver(palette: MassDriverPalette) {
  const group = new Group();
  const shell = material(palette.dormant, 1.05);
  const arc = material(palette.arc, 1.7, true);
  const core = material(palette.white, 2.15, true);
  const body = new Mesh(new IcosahedronGeometry(0.48, 0), shell);
  body.scale.set(0.72, 0.72, 1.5);
  const halo = new Mesh(new TorusGeometry(0.92, 0.055, 5, 18), arc);
  halo.rotation.x = Math.PI / 2;
  for (let index = 0; index < 3; index += 1) {
    const spoke = new Mesh(new BoxGeometry(0.1, 1.45, 0.08), shell);
    spoke.rotation.z = index / 3 * Math.PI;
    group.add(spoke);
  }
  group.add(body, halo, new Mesh(new SphereGeometry(0.14, 8, 6), core));
  group.userData.rotors = [halo];
  group.userData.accent = palette.arc;
  return remember(group, shell, arc, core);
}

function createSwitchblade(palette: MassDriverPalette) {
  const group = new Group();
  const shell = material(palette.steel, 1.3);
  const violet = material(palette.violet, 1.55, true);
  const core = material(palette.white, 2.2, true);
  const body = new Mesh(new OctahedronGeometry(0.62, 0), shell);
  body.scale.set(0.42, 0.7, 1.55);
  const wingGeometry = new PlaneGeometry(2.8, 0.64);
  const left = new Mesh(wingGeometry, shell);
  const right = new Mesh(wingGeometry, shell);
  left.position.x = -1.35;
  right.position.x = 1.35;
  left.rotation.z = 0.14;
  right.rotation.z = -0.14;
  const edge = new Mesh(new BoxGeometry(5.2, 0.045, 0.08), violet);
  edge.position.y = -0.26;
  const hotCore = new Mesh(new SphereGeometry(0.13, 8, 6), core);
  group.add(left, right, body, edge, hotCore);
  group.userData.flexParts = [left, right];
  group.userData.accent = palette.violet;
  return remember(group, shell, violet, core);
}

function createSentinel(palette: MassDriverPalette) {
  const group = new Group();
  const shell = material(palette.dormant, 1.12);
  const arc = material(palette.arc, 1.65, true);
  const core = material(palette.white, 2.3, true);
  const barrel = new Mesh(new CylinderGeometry(0.38, 0.52, 1.8, 6), shell);
  barrel.rotation.x = Math.PI / 2;
  const cage = new Mesh(new TorusGeometry(1.08, 0.08, 4, 6), arc);
  for (let index = 0; index < 3; index += 1) {
    const brace = new Mesh(new BoxGeometry(0.16, 1.75, 0.16), shell);
    brace.rotation.z = index / 3 * Math.PI;
    group.add(brace);
  }
  const eye = new Mesh(new SphereGeometry(0.2, 10, 8), core);
  eye.position.z = 0.94;
  group.add(barrel, cage, eye);
  group.userData.rotors = [cage];
  group.userData.accent = palette.arc;
  return remember(group, shell, arc, core);
}

function createInterlock(palette: MassDriverPalette) {
  const group = new Group();
  const clamp = material(palette.steel, 1.55);
  const violet = material(palette.violet, 1.95, true);
  const core = material(palette.white, 2.55, true);
  const ringA = new Mesh(new TorusGeometry(1.35, 0.22, 6, 28, Math.PI * 0.78), clamp);
  const ringB = ringA.clone();
  ringA.rotation.z = Math.PI * 0.11;
  ringB.rotation.z = Math.PI * 1.11;
  const jawA = new Mesh(new BoxGeometry(0.56, 1.4, 0.5), clamp);
  const jawB = jawA.clone();
  jawA.position.x = -1.1;
  jawB.position.x = 1.1;
  const chargeRing = new Mesh(new TorusGeometry(0.72, 0.07, 5, 24), violet);
  const lockCore = new Mesh(new OctahedronGeometry(0.42, 0), core);
  lockCore.scale.z = 1.6;
  group.add(ringA, ringB, jawA, jawB, chargeRing, lockCore);
  group.userData.rotors = [chargeRing];
  group.userData.jaws = [ringA, ringB, jawA, jawB];
  group.userData.accent = palette.violet;
  group.userData.isInterlock = true;
  return remember(group, clamp, violet, core);
}

export function createCoilGlyph(character: string, palette: MassDriverPalette) {
  const group = new Group();
  const fill = material(palette.arc, 1.45);
  const core = material(palette.white, 2.05, true);
  const frame = material(palette.violet, 1.28, true);
  const cellGeometry = new BoxGeometry(0.2, 0.2, 0.08);
  const hotGeometry = new BoxGeometry(0.09, 0.09, 0.1);
  for (const cell of glyphOnCells(character)) {
    const block = new Mesh(cellGeometry, fill);
    const spark = new Mesh(hotGeometry, core);
    block.position.set((cell.x - 2) * 0.28, (3 - cell.y) * 0.28, 0);
    spark.position.copy(block.position);
    spark.position.z = 0.055;
    group.add(block, spark);
  }
  const coil = new Mesh(new TorusGeometry(1.18, 0.045, 5, 40), frame);
  const railA = new Mesh(new BoxGeometry(2.15, 0.035, 0.04), frame);
  const railB = railA.clone();
  railA.position.y = 1.05;
  railB.position.y = -1.05;
  group.add(coil, railA, railB);
  group.userData.isLetter = true;
  group.userData.accent = palette.arc;
  return remember(group, fill, core, frame);
}

export function createMassDriverProjectile(palette: MassDriverPalette) {
  const group = new Group();
  const core = material(palette.white, 2.7, true);
  const arc = material(palette.arc, 1.8, true);
  const body = new Mesh(new OctahedronGeometry(0.2, 0), core);
  body.scale.set(0.55, 0.55, 3.2);
  const ringA = new Mesh(new RingGeometry(0.34, 0.39, 12), arc);
  const ringB = ringA.clone();
  ringA.position.z = -0.34;
  ringB.position.z = -0.66;
  ringB.scale.setScalar(0.7);
  group.add(body, ringA, ringB);
  return group;
}

export function createMassDriverReticle(palette: MassDriverPalette) {
  const group = new Group();
  const arc = material(palette.arc, 1.55);
  const violet = material(palette.violet, 1.35);
  const white = material(palette.white, 1.9);
  const inner = new Mesh(new RingGeometry(0.43, 0.48, 24, 1, 0.25, Math.PI * 1.5), arc);
  const outer = new Mesh(new RingGeometry(0.7, 0.735, 32, 1, Math.PI * 1.18, Math.PI * 1.1), violet);
  const pipH = new Mesh(new PlaneGeometry(0.24, 0.025), white);
  const pipV = new Mesh(new PlaneGeometry(0.025, 0.24), white);
  group.add(inner, outer, pipH, pipV);
  group.userData.rotors = [inner, outer];
  group.userData.materials = [arc, violet, white];
  return group;
}
