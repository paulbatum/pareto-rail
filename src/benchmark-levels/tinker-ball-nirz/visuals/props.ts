import {
  BoxGeometry,
  CircleGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  Group,
  IcosahedronGeometry,
  Mesh,
  MeshBasicMaterial,
  MultiplyBlending,
  SphereGeometry,
  TorusGeometry,
} from 'three';
import type { BufferGeometry, Object3D } from 'three';
import { GLUE, GLUE_SHEEN, LAMP, matte, glow } from './palette';

// Leaf module: every ordinary object on the table is built here from a handful
// of shared primitives. Nothing in this file decides colour schemes, sizes in
// context, or when a prop appears — callers pass all of that in.

const geometries = new Map<string, BufferGeometry>();

function cached<T extends BufferGeometry>(key: string, make: () => T): T {
  const hit = geometries.get(key);
  if (hit) return hit as T;
  const made = make();
  geometries.set(key, made);
  return made;
}

const UNIT_DISC = () => cached('disc', () => new CylinderGeometry(0.5, 0.5, 1, 18));
const UNIT_ROD = () => cached('rod', () => new CylinderGeometry(0.5, 0.5, 1, 8));
const UNIT_HEX = () => cached('hex', () => new CylinderGeometry(0.5, 0.5, 1, 6));
const UNIT_BOX = () => cached('box', () => new BoxGeometry(1, 1, 1));
const UNIT_CONE = () => cached('cone', () => new ConeGeometry(0.5, 1, 8));
const UNIT_BEAD = () => cached('bead', () => new IcosahedronGeometry(0.5, 0));
const UNIT_BALL = () => cached('ball', () => new SphereGeometry(0.5, 16, 12));
const UNIT_RING = () => cached('ring', () => new TorusGeometry(0.4, 0.09, 6, 16));
const UNIT_TAPER = () => cached('taper', () => new CylinderGeometry(0.5, 0.38, 1, 12));
const UNIT_SHADOW = () => cached('shadow', () => new CircleGeometry(0.5, 20));

export function box(width: number, height: number, depth: number, color: Color) {
  const mesh = new Mesh(UNIT_BOX(), matte(color));
  mesh.scale.set(width, height, depth);
  return mesh;
}

export function rod(length: number, radius: number, color: Color) {
  const mesh = new Mesh(UNIT_ROD(), matte(color));
  mesh.scale.set(radius * 2, length, radius * 2);
  return mesh;
}

export function bead(radius: number, color: Color) {
  const mesh = new Mesh(UNIT_BEAD(), matte(color));
  mesh.scale.setScalar(radius * 2);
  return mesh;
}

/**
 * Flat lamp shadow. Multiply blending darkens the table without a shadow map,
 * so the strength has to live in the colour: multiply ignores opacity, and a
 * black source would punch a hole straight through the wood.
 */
export function shadowBlob(radius: number, strength = 0.55) {
  const material = new MeshBasicMaterial({
    color: new Color().setScalar(1 - Math.min(0.8, strength)),
    transparent: true,
    opacity: 1,
    blending: MultiplyBlending,
    premultipliedAlpha: true,
    depthWrite: false,
  });
  const mesh = new Mesh(UNIT_SHADOW(), material);
  mesh.rotation.x = -Math.PI / 2;
  mesh.scale.setScalar(radius * 2);
  mesh.renderOrder = -1;
  return mesh;
}

export function createButton(radius: number, color: Color) {
  const group = new Group();
  const face = new Mesh(UNIT_DISC(), matte(color));
  face.scale.set(radius * 2, radius * 0.34, radius * 2);
  group.add(face);
  const rim = new Mesh(UNIT_RING(), matte(color, 0.16));
  rim.scale.setScalar(radius * 2.35);
  rim.rotation.x = Math.PI / 2;
  group.add(rim);
  for (const [hx, hz] of [[-0.22, -0.22], [0.22, 0.22]] as const) {
    const hole = new Mesh(UNIT_DISC(), matte(GLUE, 0));
    hole.scale.set(radius * 0.34, radius * 0.42, radius * 0.34);
    hole.position.set(hx * radius * 2, radius * 0.12, hz * radius * 2);
    group.add(hole);
  }
  return group;
}

export function createPin(length: number, color: Color, headColor: Color) {
  const group = new Group();
  const shaft = rod(length, length * 0.028, color);
  shaft.position.y = length * 0.5;
  group.add(shaft);
  const head = bead(length * 0.075, headColor);
  head.position.y = length;
  group.add(head);
  const tip = new Mesh(UNIT_CONE(), matte(color));
  tip.scale.set(length * 0.056, length * 0.1, length * 0.056);
  tip.rotation.x = Math.PI;
  tip.position.y = length * 0.05;
  group.add(tip);
  return group;
}

export function createPencil(length: number, bodyColor: Color, tipColor: Color) {
  const group = new Group();
  const body = new Mesh(UNIT_HEX(), matte(bodyColor));
  body.scale.set(length * 0.115, length * 0.82, length * 0.115);
  body.position.y = length * 0.41;
  group.add(body);
  const point = new Mesh(UNIT_CONE(), matte(tipColor));
  point.scale.set(length * 0.11, length * 0.18, length * 0.11);
  point.position.y = length * 0.91;
  group.add(point);
  const lead = new Mesh(UNIT_CONE(), matte(GLUE, 0));
  lead.scale.set(length * 0.045, length * 0.07, length * 0.045);
  lead.position.y = length * 0.985;
  group.add(lead);
  return group;
}

/** A bent wire loop. Two nested squashed rings read as a paperclip at any size. */
export function createClip(size: number, color: Color) {
  const group = new Group();
  for (const [scale, squash] of [[1, 0.52], [0.66, 0.44]] as const) {
    const loop = new Mesh(UNIT_RING(), matte(color, 0.2));
    loop.scale.set(size * scale, size * scale * squash, size * 0.16);
    group.add(loop);
  }
  return group;
}

export function createSpool(radius: number, height: number, bodyColor: Color, threadColor: Color) {
  const group = new Group();
  const core = new Mesh(UNIT_DISC(), matte(bodyColor));
  core.scale.set(radius * 1.35, height, radius * 1.35);
  group.add(core);
  const thread = new Mesh(UNIT_DISC(), matte(threadColor));
  thread.scale.set(radius * 1.78, height * 0.72, radius * 1.78);
  group.add(thread);
  for (const side of [-1, 1]) {
    const flange = new Mesh(UNIT_DISC(), matte(bodyColor));
    flange.scale.set(radius * 2, height * 0.14, radius * 2);
    flange.position.y = side * height * 0.5;
    group.add(flange);
  }
  return group;
}

export function createEraser(size: number, color: Color, bandColor: Color) {
  const group = new Group();
  group.add(box(size * 1.6, size * 0.62, size * 0.5, color));
  const band = box(size * 0.5, size * 0.66, size * 0.54, bandColor);
  band.position.x = size * 0.44;
  group.add(band);
  return group;
}

export function createCard(width: number, height: number, color: Color) {
  const group = new Group();
  group.add(box(width, height, width * 0.045, color));
  // Corrugation: a couple of ribs so cardboard reads as folded, not as a flat card.
  for (const offset of [-0.28, 0.28]) {
    const rib = box(width * 0.94, height * 0.05, width * 0.075, color);
    rib.position.set(0, height * offset, width * 0.03);
    group.add(rib);
  }
  return group;
}

export function createClothespin(length: number, woodColor: Color, wireColor: Color) {
  const group = new Group();
  for (const side of [-1, 1]) {
    const jaw = box(length * 0.18, length, length * 0.16, woodColor);
    jaw.position.set(side * length * 0.11, 0, 0);
    jaw.rotation.z = side * 0.09;
    group.add(jaw);
  }
  const spring = new Mesh(UNIT_RING(), matte(wireColor, 0.25));
  spring.scale.setScalar(length * 0.34);
  spring.rotation.y = Math.PI / 2;
  group.add(spring);
  return group;
}

export function createRuler(length: number, color: Color, markColor: Color) {
  const group = new Group();
  group.add(box(length, length * 0.11, length * 0.028, color));
  for (let i = 1; i < 5; i += 1) {
    const tick = box(length * 0.012, length * (i % 2 === 0 ? 0.055 : 0.032), length * 0.04, markColor);
    tick.position.set((i / 5 - 0.5) * length * 0.92, length * 0.028, length * 0.012);
    group.add(tick);
  }
  return group;
}

export function createPaintPot(radius: number, height: number, potColor: Color, paintColor: Color) {
  const group = new Group();
  const body = new Mesh(UNIT_TAPER(), matte(potColor));
  body.scale.set(radius * 2, height, radius * 2);
  group.add(body);
  const paint = new Mesh(UNIT_DISC(), matte(paintColor, 0.3));
  paint.scale.set(radius * 1.86, height * 0.09, radius * 1.86);
  paint.position.y = height * 0.46;
  group.add(paint);
  const handle = new Mesh(UNIT_RING(), matte(potColor, 0.2));
  handle.scale.setScalar(radius * 2.6);
  handle.position.y = height * 0.5;
  group.add(handle);
  return group;
}

export function createJar(radius: number, height: number, glassColor: Color, lidColor: Color) {
  const group = new Group();
  const body = new Mesh(UNIT_DISC(), matte(glassColor, 0.22));
  body.scale.set(radius * 2, height, radius * 2);
  group.add(body);
  const lid = new Mesh(UNIT_DISC(), matte(lidColor));
  lid.scale.set(radius * 2.1, height * 0.14, radius * 2.1);
  lid.position.y = height * 0.53;
  group.add(lid);
  return group;
}

export function createBlock(size: number, color: Color) {
  const group = new Group();
  group.add(box(size, size, size, color));
  group.add(box(size * 1.02, size * 0.2, size * 1.02, LAMP));
  return group;
}

/**
 * The thing you actually shoot. A matte black lump of adhesive with a wet
 * highlight so it stays visible against dark wood when bloom is off, plus an
 * additive halo that only lifts the silhouette rather than washing it out.
 */
export function createGlueCore(radius: number) {
  const group = new Group();
  const body = new Mesh(UNIT_BEAD(), matte(GLUE, 0));
  body.scale.setScalar(radius * 2);
  group.add(body);

  const sheen = new Mesh(UNIT_BALL(), matte(GLUE_SHEEN, 0.75));
  sheen.scale.setScalar(radius * 0.78);
  sheen.position.set(-radius * 0.34, radius * 0.42, radius * 0.4);
  group.add(sheen);

  // Just enough rim to separate black glue from dark wood — the core must
  // never read as a glowing ball.
  const halo = new Mesh(UNIT_BALL(), glow(GLUE_SHEEN, 0.13));
  halo.scale.setScalar(radius * 1.55);
  group.add(halo);

  const wet = new Mesh(UNIT_RING(), glow(LAMP, 0.3));
  wet.scale.setScalar(radius * 1.9);
  group.add(wet);

  group.userData.coreBody = body;
  group.userData.coreHalo = halo;
  group.userData.coreWet = wet;
  return group;
}

/** Drips hanging off a glue body — the silhouette cue that says "this thing is held together by glue". */
export function createGlueDrips(count: number, radius: number, seed: number) {
  const group = new Group();
  for (let i = 0; i < count; i += 1) {
    const angle = (i / count) * Math.PI * 2 + seed;
    const drip = new Mesh(UNIT_CONE(), matte(GLUE, 0));
    const length = radius * (0.7 + ((i * 7 + seed * 13) % 5) * 0.14);
    drip.scale.set(radius * 0.4, length, radius * 0.4);
    drip.rotation.x = Math.PI;
    drip.position.set(Math.cos(angle) * radius * 0.62, -length * 0.4, Math.sin(angle) * radius * 0.62);
    group.add(drip);
  }
  return group;
}

export function tiltRandomly(object: Object3D, seed: number) {
  object.rotation.set(
    Math.sin(seed * 12.9898) * 0.4,
    seed * 2.399,
    Math.cos(seed * 78.233) * 0.4,
  );
  return object;
}
