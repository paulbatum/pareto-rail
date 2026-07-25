import {
  BufferAttribute,
  BufferGeometry,
  CircleGeometry,
  Color,
  ConeGeometry,
  DoubleSide,
  EdgesGeometry,
  Group,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  OctahedronGeometry,
  PlaneGeometry,
  RingGeometry,
  ShapeGeometry,
  SphereGeometry,
  Vector3,
} from 'three';
import { additiveMaterialParameters, createAdditiveBasicMaterial } from '../../../engine/visual-kit';
import { BLOOD, BONE, LEAD, hdr } from './palette';
import { bladeShape, lancetShape, mergeParts, softDiscGeometry, vesicaShape } from './shapes';
import type { Splinter } from './effects';

// The things in the nave come off the glass: flat black cut-outs with one
// stolen pane burning in the chest. The silhouette is the read at distance,
// the chest colour is the read up close, and a thin came outline keeps both
// legible with the bloom slider at zero.
//
// Every kind shares one cached geometry set; only the materials are per
// instance, because the chest has to carry whichever colour that particular
// one took out of the wall.

/** Not quite black: the bodies have to occlude visibly against a black nave. */
const SHADOW = new Color(0.013, 0.014, 0.022);

export type EnemyVisual = {
  chest: MeshBasicMaterial[];
  /** Silhouette bleed: the pane's colour leaking out around the black shape. */
  aura: MeshBasicMaterial[];
  edge: LineBasicMaterial[];
  accent: Color;
};

const cache = new Map<string, BufferGeometry>();
function cached(key: string, build: () => BufferGeometry) {
  const existing = cache.get(key);
  if (existing) return existing;
  const geometry = build();
  cache.set(key, geometry);
  return geometry;
}

export function createVespersEnemy(kind: string): Group {
  switch (kind) {
    case 'seraph':
      return buildSeraph();
    case 'censer':
      return buildCenser();
    case 'gargoyle':
      return buildGargoyle();
    case 'mote':
      return buildMote();
    case 'rose-petal':
      return buildPetal();
    case 'rose-heart':
      return buildHeart();
    default:
      return buildShade();
  }
}

/** Recolour a target to the pane it stripped. Called once, as it spawns. */
export function setEnemyAccent(mesh: Object3D, colour: Color) {
  const visual = mesh.userData.visual as EnemyVisual | undefined;
  if (!visual) return;
  visual.accent.copy(colour);
  applyEnemyGlow(mesh, 1, false);
}

/**
 * The single place a target's hot elements are written. `heat` scales the
 * chest, `locked` swaps it for bone-white so a locked target never depends on
 * its stolen colour to read.
 */
export function applyEnemyGlow(mesh: Object3D, heat: number, locked: boolean, override?: Color) {
  const visual = mesh.userData.visual as EnemyVisual | undefined;
  if (!visual) return;
  const base = override ?? (locked ? BONE : visual.accent);
  for (const material of visual.chest) {
    material.color.copy(base).multiplyScalar((locked ? 4.2 : 3.1) * heat);
  }
  for (const material of visual.aura) {
    material.color.copy(base).multiplyScalar((locked ? 0.9 : 0.5) * heat);
  }
  for (const material of visual.edge) {
    material.color.copy(locked ? hdr(BONE, 1.1) : base.clone().multiplyScalar(0.26 * heat));
  }
}

export function setVespersEnemyLocked(mesh: Object3D, locked: boolean) {
  mesh.userData.locked = locked;
  applyEnemyGlow(mesh, 1, locked);
}

export function setVespersEnemyDenied(mesh: Object3D, until: number) {
  mesh.userData.deniedUntil = until;
  applyEnemyGlow(mesh, 1.6, false, BLOOD);
}

// --- kinds ---------------------------------------------------------------

/** A pane torn out of a lancet: tall, pointed, and edge-on thin. */
function buildShade() {
  const group = start('shade', 1.15);
  const pane = cached('shade.pane', () => new ShapeGeometry(lancetShape(0.95, -2, 0.4, 2.05), 12));
  addAura(group, pane, 1.22);
  addBody(group, pane);
  addOutline(group, pane, 0.02);
  addCame(group, [-1.1, -0.2, 0.75], 1.7, 0.03);
  addChest(group, cached('shade.chest', () => new ShapeGeometry(vesicaShape(0.42, 0.95), 8)), 0, -0.1, 0.06);
  splinters(group, 9, 0.5);
  return group;
}

/** Six wings, three pairs, stacked in depth and counter-turning. */
function buildSeraph() {
  const group = start('seraph', 1.5);
  const wings = new Group();
  const blade = cached('seraph.blade', () => new ShapeGeometry(bladeShape(2.5, 0.42, 0.22), 10));
  for (let pair = 0; pair < 3; pair += 1) {
    const rank = new Group();
    rank.position.z = (pair - 1) * 0.24;
    for (const side of [1, -1]) {
      const mesh = new Mesh(blade, bodyMaterial());
      mesh.rotation.z = side > 0 ? (pair - 1) * 0.62 : Math.PI - (pair - 1) * 0.62;
      mesh.scale.set(0.78 + pair * 0.16, side > 0 ? 1 : -1, 1);
      rank.add(mesh);
      const line = new LineSegments(cached('seraph.blade.edge', () => new EdgesGeometry(blade, 1)), edgeMaterial(group));
      line.rotation.copy(mesh.rotation);
      line.scale.copy(mesh.scale);
      line.position.z = 0.02;
      rank.add(line);
    }
    rank.userData.spinRate = (pair - 1) * 0.9 + 0.35;
    wings.add(rank);
    group.userData.ranks = (group.userData.ranks as Group[] | undefined) ?? [];
    (group.userData.ranks as Group[]).push(rank);
  }
  group.add(wings);
  addBloom(group, 2.1);
  const core = cached('seraph.core', () => new ShapeGeometry(vesicaShape(0.36, 1.15), 8));
  addBody(group, core);
  addOutline(group, core, 0.04);
  addChest(group, cached('seraph.eye', () => new ShapeGeometry(vesicaShape(0.16, 0.78), 8)), 0, 0, 0.08);
  splinters(group, 10, 0.6);
  return group;
}

/** A thurible on a long chain, swinging on the beat with coals inside. */
function buildCenser() {
  const group = start('censer', 1.1);
  const bowl = cached('censer.bowl', () => {
    const parts = [
      new SphereGeometry(0.72, 8, 5, 0, Math.PI * 2, Math.PI * 0.42, Math.PI * 0.58),
      new ConeGeometry(0.62, 0.7, 8, 1, true).translate(0, 0.45, 0),
      new SphereGeometry(0.13, 6, 4).translate(0, 0.92, 0),
    ];
    return mergeParts(parts);
  });
  addAura(group, bowl, 1.3, 0);
  addBody(group, bowl);
  addOutline(group, bowl, 0);

  // The chain reaching up out of frame is what makes the swing read.
  const chain = new LineSegments(
    cached('censer.chain', () => {
      const points: number[] = [];
      for (let i = 0; i < 7; i += 1) points.push(0, 1 + i * 1.15, 0, 0, 1.75 + i * 1.15, 0);
      const geometry = new BufferGeometry();
      geometry.setAttribute('position', new BufferAttribute(new Float32Array(points), 3));
      return geometry;
    }),
    edgeMaterial(group),
  );
  group.add(chain);

  const coals = new Mesh(cached('censer.coals', () => new SphereGeometry(0.4, 8, 6)), chestMaterial(group));
  coals.position.y = 0.08;
  group.add(coals);
  const smoke = new Mesh(cached('censer.smoke', () => softDiscGeometry(0.95, 18)), chestMaterial(group, true));
  smoke.position.set(0, 0.1, 0.05);
  group.add(smoke);
  group.userData.billboard = [smoke];
  splinters(group, 8, 0.42);
  return group;
}

/** Crouched on the arcade until it lunges: heavy, horned, low-slung. */
function buildGargoyle() {
  const group = start('gargoyle', 1.35);
  const body = cached('gargoyle.body', () => {
    const parts = [
      new OctahedronGeometry(1.15, 0).scale(1.5, 0.72, 0.85),
      new ConeGeometry(0.34, 1.5, 4).rotateZ(Math.PI / 2).translate(1.55, -0.16, 0),
      new ConeGeometry(0.26, 0.95, 4).translate(-0.55, 0.85, 0).rotateZ(0.32),
      new ConeGeometry(0.26, 0.95, 4).translate(0.55, 0.85, 0).rotateZ(-0.32),
    ];
    return mergeParts(parts);
  });
  addAura(group, body, 1.24, 0);
  addBody(group, body);
  addOutline(group, body, 0);

  const wing = cached('gargoyle.wing', () => new ShapeGeometry(bladeShape(2.0, 0.85, -0.5), 8));
  for (const side of [1, -1]) {
    const mesh = new Mesh(wing, bodyMaterial());
    mesh.position.set(side * 0.3, 0.35, -0.35);
    mesh.rotation.z = side > 0 ? 2.2 : Math.PI - 2.2;
    mesh.scale.y = side;
    group.add(mesh);
  }
  addChest(group, cached('gargoyle.throat', () => new ShapeGeometry(bladeShape(1.5, 0.3, 0), 6)), 0.5, -0.34, 0.6);
  splinters(group, 12, 0.75);
  return group;
}

/** A spat ember: small, fast, and the only red thing that moves. */
function buildMote() {
  const group = start('mote', 0.9);
  const shell = cached('mote.shell', () => new OctahedronGeometry(0.62, 0).scale(1, 1, 1.7));
  addAura(group, shell, 1.35, 0);
  addBody(group, shell);
  addOutline(group, shell, 0);
  const core = new Mesh(cached('mote.core', () => new OctahedronGeometry(0.34, 0)), chestMaterial(group));
  group.add(core);
  const flare = new Mesh(cached('mote.flare', () => softDiscGeometry(1.15, 16)), chestMaterial(group, true));
  group.add(flare);
  group.userData.billboard = [flare];
  splinters(group, 6, 0.3);
  return group;
}

/** One of the six lights the rose is holding, pulled forward into the nave. */
function buildPetal() {
  const group = start('rose-petal', 1.5);
  const pane = cached('petal.pane', () => new ShapeGeometry(vesicaShape(1.15, 2.6), 14));
  addAura(group, pane, 1.22);
  addBody(group, pane);
  addOutline(group, pane, 0.03);
  addCame(group, [-1.5, 0, 1.5], 1.5, 0.05);
  addChest(group, cached('petal.chest', () => new ShapeGeometry(vesicaShape(0.6, 1.5), 10)), 0, 0, 0.08);
  const ring = new Mesh(cached('petal.ring', () => new RingGeometry(1.5, 1.62, 20)), chestMaterial(group));
  ring.position.z = -0.05;
  group.add(ring);
  splinters(group, 12, 0.7);
  return group;
}

/** The thing nested in the oculus: a shut black flower with a core inside. */
function buildHeart() {
  const group = start('rose-heart', 2.6);
  const shell = new Group();
  const leaf = cached('heart.leaf', () => new ShapeGeometry(vesicaShape(0.95, 2.5), 12));
  for (let i = 0; i < 8; i += 1) {
    const mesh = new Mesh(leaf, bodyMaterial());
    mesh.rotation.z = (i / 8) * Math.PI * 2;
    mesh.position.set(Math.sin(-mesh.rotation.z) * 1.5, Math.cos(mesh.rotation.z) * 1.5, 0);
    shell.add(mesh);
    const line = new LineSegments(cached('heart.leaf.edge', () => new EdgesGeometry(leaf, 1)), edgeMaterial(group));
    line.rotation.copy(mesh.rotation);
    line.position.copy(mesh.position).setZ(0.05);
    shell.add(line);
  }
  group.add(shell);
  group.userData.shell = shell;

  addBody(group, cached('heart.hub', () => new CircleGeometry(1.55, 20)));
  const core = new Mesh(cached('heart.core', () => new CircleGeometry(1.2, 20)), chestMaterial(group));
  core.position.z = 0.1;
  group.add(core);
  const halo = new Mesh(cached('heart.halo', () => softDiscGeometry(4.2, 26)), chestMaterial(group, true));
  halo.position.z = -0.15;
  group.add(halo);
  const spokes = new Mesh(cached('heart.spokes', () => {
    const parts: BufferGeometry[] = [];
    for (let i = 0; i < 12; i += 1) parts.push(new PlaneGeometry(3.2, 0.12).translate(2.4, 0, 0).rotateZ((i / 12) * Math.PI * 2));
    return mergeParts(parts);
  }), chestMaterial(group));
  spokes.position.z = 0.02;
  group.add(spokes);
  group.userData.spokes = spokes;
  splinters(group, 18, 1.1);
  return group;
}

// --- construction helpers -------------------------------------------------

function start(kind: string, lockRingScale: number) {
  const group = new Group();
  group.userData.kind = kind;
  group.userData.lockRingScale = lockRingScale;
  group.userData.visual = { chest: [], aura: [], edge: [], accent: BONE.clone() } satisfies EnemyVisual;
  return group;
}

function visualOf(group: Group) {
  return group.userData.visual as EnemyVisual;
}

function bodyMaterial() {
  return new MeshBasicMaterial({ color: SHADOW, side: DoubleSide });
}

function chestMaterial(group: Group, vertexColors = false) {
  const material = createAdditiveBasicMaterial({ color: 0x000000, side: DoubleSide, vertexColors });
  visualOf(group).chest.push(material);
  return material;
}

/**
 * The shape's own colour bleeding out from behind it. The body is opaque and
 * sits in front, so what the player reads is a black cut-out with a lit rim —
 * which is the only reason a black thing is visible in a black room.
 */
function addAura(group: Group, geometry: BufferGeometry, scale: number, z = -0.06) {
  const material = createAdditiveBasicMaterial({ color: 0x000000, side: DoubleSide });
  visualOf(group).aura.push(material);
  const mesh = new Mesh(geometry, material);
  mesh.scale.setScalar(scale);
  mesh.position.z = z;
  group.add(mesh);
  return mesh;
}

/** A soft round bloom behind a target, for shapes an outline cannot describe. */
function addBloom(group: Group, radius: number) {
  const material = createAdditiveBasicMaterial({ color: 0x000000, side: DoubleSide, vertexColors: true });
  visualOf(group).aura.push(material);
  const mesh = new Mesh(cached(`bloom.${radius}`, () => softDiscGeometry(radius, 22)), material);
  mesh.position.z = -0.2;
  group.add(mesh);
  return mesh;
}

function edgeMaterial(group: Group) {
  const material = new LineBasicMaterial(additiveMaterialParameters({ color: 0x000000 }));
  visualOf(group).edge.push(material);
  return material;
}

function addBody(group: Group, geometry: BufferGeometry) {
  group.add(new Mesh(geometry, bodyMaterial()));
}

function addOutline(group: Group, geometry: BufferGeometry, z: number) {
  const key = `${geometry.uuid}.edges`;
  const line = new LineSegments(cached(key, () => new EdgesGeometry(geometry, 1)), edgeMaterial(group));
  line.position.z = z;
  group.add(line);
}

function addChest(group: Group, geometry: BufferGeometry, x: number, y: number, z: number) {
  const mesh = new Mesh(geometry, chestMaterial(group));
  mesh.position.set(x, y, z);
  group.add(mesh);
}

/** Lead came laid across a pane, so the flat black shapes read as glass. */
function addCame(group: Group, rows: number[], width: number, z: number) {
  const key = `came.${width}.${rows.join(',')}`;
  const geometry = cached(key, () => {
    const parts = rows.map((y) => new PlaneGeometry(width, 0.055).translate(0, y, 0));
    parts.push(new PlaneGeometry(0.055, Math.abs(rows[rows.length - 1] - rows[0]) + 1.6).translate(0, (rows[0] + rows[rows.length - 1]) / 2, 0));
    return mergeParts(parts);
  });
  const mesh = new Mesh(geometry, new MeshBasicMaterial({ color: LEAD, side: DoubleSide }));
  mesh.position.z = z;
  group.add(mesh);
}

/** How this one comes apart: directions and sizes for the shatter burst. */
function splinters(group: Group, count: number, size: number) {
  const specs: Splinter[] = [];
  for (let i = 0; i < count; i += 1) {
    const angle = (i / count) * Math.PI * 2 + (i % 3) * 0.4;
    const tilt = ((i % 5) - 2) * 0.22;
    specs.push({
      direction: new Vector3(Math.cos(angle), Math.sin(angle), tilt).normalize(),
      size: size * (0.6 + ((i * 7) % 5) * 0.16),
    });
  }
  group.userData.splinters = specs;
}
