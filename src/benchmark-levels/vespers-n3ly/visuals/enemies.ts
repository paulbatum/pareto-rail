import {
  BoxGeometry,
  CircleGeometry,
  Color,
  DoubleSide,
  Group,
  IcosahedronGeometry,
  Mesh,
  MeshBasicMaterial,
  OctahedronGeometry,
  PlaneGeometry,
  RingGeometry,
  Shape,
  ShapeGeometry,
  TorusGeometry,
  Vector2,
} from 'three';
import type { Object3D } from 'three';
import { glyphOnCells } from '../../../engine/glyphs';
import { BLOOD, BONE, BOTTLE, COBALT, GLASS_COLORS, GOLD, LEAD, hdr } from './palette';

const DARK = new MeshBasicMaterial({ color: LEAD, side: DoubleSide });
const DARK_EDGE = new MeshBasicMaterial({ color: 0x15151d, side: DoubleSide });

function jewelMaterial(color: Color, intensity = 1.55) {
  const baseColor = hdr(color, intensity);
  const material = new MeshBasicMaterial({ color: baseColor.clone(), side: DoubleSide });
  material.userData.baseColor = baseColor;
  return material;
}

function shapeGeometry(points: Array<[number, number]>) {
  const shape = new Shape();
  shape.moveTo(points[0][0], points[0][1]);
  for (const [x, y] of points.slice(1)) shape.lineTo(x, y);
  shape.closePath();
  return new ShapeGeometry(shape);
}

function addJewel(group: Group, color: Color, scale = 1) {
  const material = jewelMaterial(color);
  const hotMaterial = jewelMaterial(color, 2.35);
  const jewel = new Mesh(new OctahedronGeometry(0.52 * scale, 0), material);
  jewel.scale.set(0.78, 1.16, 0.38);
  jewel.position.z = 0.12;
  const core = new Mesh(new CircleGeometry(0.19 * scale, 12), hotMaterial);
  core.position.z = 0.42;
  group.add(jewel, core);
  group.userData.jewelMaterials = [material, hotMaterial];
  group.userData.accent = color;
}

function createPaneWraith() {
  const group = new Group();
  const wing = shapeGeometry([
    [-3.15, 0.15], [-2.2, 1.45], [-0.55, 0.78], [0, 1.72],
    [0.55, 0.78], [2.2, 1.45], [3.15, 0.15], [1.25, -0.45],
    [0.42, -1.55], [0, -0.72], [-0.42, -1.55], [-1.25, -0.45],
  ]);
  const silhouette = new Mesh(wing, DARK);
  const innerCut = new Mesh(new RingGeometry(0.82, 1.08, 4), DARK_EDGE);
  innerCut.rotation.z = Math.PI / 4;
  innerCut.position.z = 0.04;
  group.add(silhouette, innerCut);
  addJewel(group, COBALT, 1.05);
  group.userData.baseScale = 1;
  return group;
}

function createCandleEater() {
  const group = new Group();
  const body = shapeGeometry([
    [0, 2.9], [0.55, 1.2], [2.25, 0.4], [1.1, -0.1],
    [0.62, -2.15], [0, -3.05], [-0.62, -2.15], [-1.1, -0.1],
    [-2.25, 0.4], [-0.55, 1.2],
  ]);
  const silhouette = new Mesh(body, DARK);
  const chain = new Mesh(new BoxGeometry(0.11, 2.3, 0.08), DARK_EDGE);
  chain.position.y = 3.65;
  const halo = new Mesh(new TorusGeometry(1.3, 0.12, 4, 18, Math.PI), DARK_EDGE);
  halo.position.y = 2.1;
  halo.rotation.z = Math.PI;
  group.add(silhouette, chain, halo);
  addJewel(group, BLOOD, 1.08);
  group.userData.baseScale = 0.94;
  return group;
}

function createChorister() {
  const group = new Group();
  const outer = new Mesh(new TorusGeometry(1.62, 0.42, 5, 24), DARK);
  const inner = new Mesh(new TorusGeometry(0.78, 0.16, 4, 16), DARK_EDGE);
  group.add(outer, inner);
  const vaneGeometry = shapeGeometry([[0, 0.6], [0.48, 1.75], [0, 2.55], [-0.48, 1.75]]);
  for (let index = 0; index < 8; index += 1) {
    const vane = new Mesh(vaneGeometry, index % 2 === 0 ? DARK : DARK_EDGE);
    vane.rotation.z = index / 8 * Math.PI * 2;
    vane.position.z = -0.03;
    group.add(vane);
  }
  addJewel(group, BOTTLE, 1.12);
  group.userData.baseScale = 0.92;
  return group;
}

function createVigil() {
  const group = new Group();
  const silhouette = new Mesh(shapeGeometry([
    [0, 3.2], [0.72, 1.55], [0.5, 0.7], [1.65, -0.6],
    [0.68, -0.4], [0.55, -2.25], [0, -3.05], [-0.55, -2.25],
    [-0.68, -0.4], [-1.65, -0.6], [-0.5, 0.7], [-0.72, 1.55],
  ]), DARK);
  const crown = new Mesh(new RingGeometry(1.2, 1.42, 6), DARK_EDGE);
  crown.position.y = 1.45;
  crown.position.z = 0.03;
  const crossbar = new Mesh(new BoxGeometry(3.5, 0.16, 0.1), DARK_EDGE);
  crossbar.position.y = 0.28;
  group.add(silhouette, crown, crossbar);
  addJewel(group, GOLD, 1.04);
  group.userData.baseScale = 0.9;
  return group;
}

function createRoseLobe() {
  const group = new Group();
  const petal = new Shape();
  petal.moveTo(0, 3.1);
  petal.bezierCurveTo(2.2, 2.1, 2.1, -1.2, 0, -2.8);
  petal.bezierCurveTo(-2.1, -1.2, -2.2, 2.1, 0, 3.1);
  const silhouette = new Mesh(new ShapeGeometry(petal), DARK);
  group.add(silhouette);
  const jewelMaterials: MeshBasicMaterial[] = [];
  GLASS_COLORS.forEach((color, index) => {
    const material = jewelMaterial(color, 1.65);
    const pane = new Mesh(new RingGeometry(0.38, 0.88, 16, 1, index * Math.PI / 2, Math.PI / 2 - 0.07), material);
    pane.position.z = 0.12;
    group.add(pane);
    jewelMaterials.push(material);
  });
  const lead = new Mesh(new TorusGeometry(0.91, 0.08, 4, 22), DARK_EDGE);
  lead.position.z = 0.15;
  group.add(lead);
  group.userData.jewelMaterials = jewelMaterials;
  group.userData.accent = GOLD;
  group.userData.baseScale = 0.86;
  return group;
}

function createDevourer() {
  const group = new Group();
  const points: Array<[number, number]> = [];
  for (let index = 0; index < 24; index += 1) {
    const angle = index / 24 * Math.PI * 2;
    const radius = index % 2 === 0 ? 5.2 : 3.35;
    points.push([Math.cos(angle) * radius, Math.sin(angle) * radius]);
  }
  const maw = new Mesh(shapeGeometry(points), DARK);
  const outerTeeth = new Mesh(new RingGeometry(3.2, 4.15, 12), DARK_EDGE);
  outerTeeth.rotation.z = Math.PI / 12;
  group.add(maw, outerTeeth);

  const jewelMaterials: MeshBasicMaterial[] = [];
  GLASS_COLORS.forEach((color, index) => {
    const material = jewelMaterial(color, 1.75);
    const rank = new Mesh(new RingGeometry(1.05, 2.85, 28, 1, index * Math.PI / 2 + 0.04, Math.PI / 2 - 0.08), material);
    rank.position.z = 0.14;
    group.add(rank);
    jewelMaterials.push(material);
  });
  const pupilMaterial = jewelMaterial(BONE, 2.35);
  const pupil = new Mesh(new IcosahedronGeometry(0.74, 1), pupilMaterial);
  pupil.scale.z = 0.45;
  pupil.position.z = 0.35;
  group.add(pupil);
  jewelMaterials.push(pupilMaterial);

  const innerLead = new Mesh(new TorusGeometry(1.02, 0.14, 5, 30), DARK_EDGE);
  innerLead.position.z = 0.2;
  group.add(innerLead);
  group.userData.jewelMaterials = jewelMaterials;
  group.userData.accent = BONE;
  group.userData.baseScale = 1.08;
  group.userData.isBoss = true;
  return group;
}

function createLetter(character: string) {
  const group = new Group();
  const cells = glyphOnCells(character);
  const frameGeometry = new BoxGeometry(0.29, 0.29, 0.09);
  const paneGeometry = new PlaneGeometry(0.205, 0.205);
  const jewelMaterials: MeshBasicMaterial[] = [];
  for (const [index, cell] of cells.entries()) {
    const frame = new Mesh(frameGeometry, DARK);
    frame.position.set((cell.x - 2) * 0.33, (3 - cell.y) * 0.33, 0);
    const color = GLASS_COLORS[(index + character.charCodeAt(0)) % GLASS_COLORS.length];
    const material = jewelMaterial(color, 1.55);
    const pane = new Mesh(paneGeometry, material);
    pane.position.copy(frame.position);
    pane.position.z = 0.06;
    group.add(frame, pane);
    jewelMaterials.push(material);
  }
  const frame = new Mesh(new TorusGeometry(1.24, 0.045, 5, 32), DARK_EDGE);
  frame.scale.y = 1.14;
  group.add(frame);
  group.userData.jewelMaterials = jewelMaterials;
  group.userData.accent = GOLD;
  group.userData.baseScale = 1;
  group.userData.isLetter = true;
  return group;
}

export function createVespersEnemy(kind: string, letter?: string) {
  let group: Group;
  if (kind === 'letter' || letter) group = createLetter(letter ?? 'A');
  else if (kind === 'pane-wraith') group = createPaneWraith();
  else if (kind === 'candle-eater') group = createCandleEater();
  else if (kind === 'chorister') group = createChorister();
  else if (kind === 'vigil') group = createVigil();
  else if (kind === 'rose-lobe') group = createRoseLobe();
  else group = createDevourer();
  group.userData.kind = kind;
  return group;
}

export function tintJewelMaterials(mesh: Object3D, color?: Color, intensity = 2.2) {
  const materials = mesh.userData.jewelMaterials as MeshBasicMaterial[] | undefined;
  for (const material of materials ?? []) {
    const base = material.userData.baseColor as Color | undefined;
    material.color.copy(color ? hdr(color, intensity) : (base ?? BONE));
  }
}

export function createVespersProjectile() {
  const group = new Group();
  const bodyMaterial = jewelMaterial(GOLD, 2.2);
  const body = new Mesh(new OctahedronGeometry(0.22, 0), bodyMaterial);
  body.scale.set(0.6, 0.6, 3.2);
  const haloMaterial = jewelMaterial(BONE, 1.8);
  const halo = new Mesh(new RingGeometry(0.38, 0.45, 4), haloMaterial);
  halo.rotation.z = Math.PI / 4;
  group.add(body, halo);
  group.userData.jewelMaterials = [bodyMaterial, haloMaterial];
  return group;
}

export function createVespersReticle() {
  const group = new Group();
  const pale = jewelMaterial(BONE, 1.45);
  const gold = jewelMaterial(GOLD, 1.35);
  const outer = new Mesh(new RingGeometry(1.02, 1.08, 24), pale);
  const inner = new Mesh(new RingGeometry(0.64, 0.7, 4), gold);
  inner.rotation.z = Math.PI / 4;
  group.add(outer, inner);
  for (let index = 0; index < 4; index += 1) {
    const cusp = new Mesh(new CircleGeometry(0.12, 8), gold);
    const angle = index * Math.PI / 2;
    cusp.position.set(Math.cos(angle) * 0.88, Math.sin(angle) * 0.88, 0.01);
    group.add(cusp);
  }
  group.userData.reticleMaterials = [pale, gold];
  return group;
}

export function setReticleColor(reticle: Object3D, color: Color) {
  const materials = reticle.userData.reticleMaterials as MeshBasicMaterial[] | undefined;
  for (const [index, material] of (materials ?? []).entries()) {
    material.color.copy(hdr(index === 0 ? BONE : color, index === 0 ? 1.55 : 1.8));
  }
}

export const EFFECT_DIAMOND = (() => {
  const geometry = new PlaneGeometry(0.18, 0.18);
  geometry.rotateZ(Math.PI / 4);
  return geometry;
})();

export function makeEffectMaterial(color: Color, opacity = 1) {
  return new MeshBasicMaterial({
    color: hdr(color, 1.8),
    side: DoubleSide,
    transparent: opacity < 1,
    opacity,
    depthWrite: false,
  });
}

export function deterministicDirection(index: number) {
  const angle = index * 2.3999632297;
  const radius = 0.72 + (index % 5) * 0.11;
  return new Vector2(Math.cos(angle) * radius, Math.sin(angle) * radius);
}
