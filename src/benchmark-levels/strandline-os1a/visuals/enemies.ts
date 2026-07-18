import {
  BoxGeometry,
  BufferGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  Group,
  IcosahedronGeometry,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  OctahedronGeometry,
  PlaneGeometry,
  RingGeometry,
  SphereGeometry,
  TorusGeometry,
  Vector3,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { createAdditiveBasicMaterial } from '../../../engine/visual-kit';
import type { ShardSpec } from './effects';
import { PARASITE_DARK, PARASITE_PALE, PARASITE_VIOLET, hdr } from './palette';

// Every parasite is built from the same three ideas — a dark chitin shell that
// carries the silhouette with bloom at zero, a violet rim that says "not part
// of this animal", and one pale core that is the thing actually alive inside.
// What separates the kinds is anatomy and gait, not colour:
//
//   cling   — a flat gripping disc with six hooks. Latched, then swimming.
//   larva   — a head and three tail segments. Never stops, always undulating.
//   spitter — a hunched segmented crawler with clamp arms and a snout.
//   brood   — a translucent sac with embryos visible inside it.
//   parent  — all of the above at forty times the size, dug into the crown.
//
// Geometry is built once per kind and shared; materials are per-instance,
// because the tint layer rewrites colour per enemy every frame. Parts that
// never move independently are merged, so a target is a handful of draw calls
// rather than a few dozen.

export type TintKind = 'shell' | 'rim' | 'core';
export type TintPart = { material: MeshBasicMaterial; base: Color; kind: TintKind };

const geometryCache = new Map<string, BufferGeometry>();

function cached(key: string, build: () => BufferGeometry) {
  const existing = geometryCache.get(key);
  if (existing) return existing;
  const geometry = build();
  geometryCache.set(key, geometry);
  return geometry;
}

/**
 * Merge a set of placed parts into one geometry and release the sources.
 * Everything is flattened to non-indexed first: three's polyhedra are
 * non-indexed while cones, boxes and cylinders are not, and mergeGeometries
 * refuses a mixture.
 */
function merged(parts: BufferGeometry[]) {
  const flattened = parts.map((part) => part.toNonIndexed());
  const result = mergeGeometries(flattened);
  for (const part of flattened) part.dispose();
  for (const part of parts) part.dispose();
  return result;
}

/**
 * Bakes a placement into a geometry while building a cached part. Rotations
 * are applied Z, Y, X so the composed result matches three.js' default XYZ
 * Euler order — the numbers here read the same as `mesh.rotation` would.
 */
function place(geometry: BufferGeometry, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0) {
  const rotate = new Matrix4();
  if (rz) geometry.applyMatrix4(rotate.makeRotationZ(rz));
  if (ry) geometry.applyMatrix4(rotate.makeRotationY(ry));
  if (rx) geometry.applyMatrix4(rotate.makeRotationX(rx));
  if (x || y || z) geometry.applyMatrix4(rotate.makeTranslation(x, y, z));
  return geometry;
}

function shellMaterial(color: Color) {
  return new MeshBasicMaterial({ color: color.clone() });
}

function tint(parts: TintPart[], material: MeshBasicMaterial, base: Color, kind: TintKind) {
  parts.push({ material, base: base.clone(), kind });
  return material;
}

function shardsFrom(points: Array<[number, number, number]>, color: Color, size: number): ShardSpec[] {
  return points.map(([x, y, z]) => ({
    direction: new Vector3(x, y, z).normalize(),
    color: color.clone(),
    size,
  }));
}

// ---- cling ---------------------------------------------------------------------

const CLING_SHELL = PARASITE_DARK.clone().multiplyScalar(2.2);
const CLING_HOOKS = PARASITE_DARK.clone().multiplyScalar(3.0);

export function createClingMesh() {
  const group = new Group();
  const parts: TintPart[] = [];

  const bodyGeometry = cached('cling.body', () => {
    const dome = new SphereGeometry(1, 12, 7, 0, Math.PI * 2, 0, Math.PI * 0.56);
    dome.applyMatrix4(new Matrix4().makeScale(1.15, 0.62, 1.15));
    return dome;
  });
  group.add(new Mesh(bodyGeometry, tint(parts, shellMaterial(CLING_SHELL), CLING_SHELL, 'shell')));

  const skirtColor = hdr(PARASITE_VIOLET, 0.85);
  const skirtGeometry = cached('cling.skirt', () => place(new RingGeometry(0.98, 1.28, 20), 0, 0, 0, -Math.PI / 2));
  group.add(new Mesh(skirtGeometry, tint(parts, createAdditiveBasicMaterial({ color: skirtColor, side: DoubleSide }), skirtColor, 'rim')));

  // Six hooks splayed into the strand, merged into one mesh. They fold back as
  // a unit when it lets go, so they never need to be separate objects.
  const hookGeometry = cached('cling.hooks', () => {
    const cones: BufferGeometry[] = [];
    for (let i = 0; i < 6; i += 1) {
      const angle = (i / 6) * Math.PI * 2;
      cones.push(place(
        new ConeGeometry(0.13, 1.35, 4),
        Math.cos(angle) * 0.85,
        -0.42,
        Math.sin(angle) * 0.85,
        -Math.sin(angle) * 1.5,
        0,
        Math.cos(angle) * 1.5,
      ));
    }
    return merged(cones);
  });
  const hooks = new Group();
  hooks.add(new Mesh(hookGeometry, tint(parts, shellMaterial(CLING_HOOKS), CLING_HOOKS, 'shell')));
  group.add(hooks);

  const coreColor = hdr(PARASITE_PALE, 1.5);
  const core = new Mesh(
    cached('cling.core', () => place(new OctahedronGeometry(0.34, 0), 0, 0.34, 0)),
    tint(parts, createAdditiveBasicMaterial({ color: coreColor }), coreColor, 'core'),
  );
  group.add(core);

  group.userData.parts = parts;
  group.userData.hooks = hooks;
  group.userData.core = core;
  group.userData.accent = PARASITE_VIOLET.clone();
  group.userData.lockRingScale = 1.2;
  group.userData.shardSpecs = shardsFrom([
    [1, 0.3, 0], [-1, 0.3, 0], [0, 0.4, 1], [0, 0.4, -1],
    [0.7, -0.4, 0.7], [-0.7, -0.4, -0.7], [0, 1, 0],
  ], PARASITE_VIOLET, 0.34);
  return group;
}

// ---- larva ---------------------------------------------------------------------

const LARVA_HEAD = PARASITE_DARK.clone().multiplyScalar(2.6);

export function createLarvaMesh() {
  const group = new Group();
  const parts: TintPart[] = [];

  const headGeometry = cached('larva.head', () => {
    const head = new SphereGeometry(0.42, 10, 7);
    head.applyMatrix4(new Matrix4().makeScale(0.85, 0.85, 1.5));
    return head;
  });
  group.add(new Mesh(headGeometry, tint(parts, shellMaterial(LARVA_HEAD), LARVA_HEAD, 'shell')));

  const coreColor = hdr(PARASITE_PALE, 1.7);
  group.add(new Mesh(
    cached('larva.core', () => place(new SphereGeometry(0.2, 8, 6), 0, 0, 0.12)),
    tint(parts, createAdditiveBasicMaterial({ color: coreColor }), coreColor, 'core'),
  ));

  // Three tail segments, each a child of the last, so a single sine drives the
  // whole whip. This is the level's only chain-articulated enemy and it reads
  // at any distance as "swimming" rather than "flying".
  const segments: Group[] = [];
  const tailColor = hdr(PARASITE_VIOLET, 0.6);
  const tailMaterial = tint(parts, createAdditiveBasicMaterial({ color: tailColor }), tailColor, 'rim');
  let parent: Group = group;
  for (let i = 0; i < 3; i += 1) {
    const joint = new Group();
    joint.position.z = i === 0 ? -0.5 : -0.42;
    const geometry = cached(`larva.tail${i}`, () => place(new ConeGeometry(0.2 - i * 0.05, 0.5, 5), 0, 0, -0.22, Math.PI / 2));
    joint.add(new Mesh(geometry, tailMaterial));
    parent.add(joint);
    segments.push(joint);
    parent = joint;
  }

  group.userData.parts = parts;
  group.userData.segments = segments;
  group.userData.accent = PARASITE_PALE.clone();
  group.userData.lockRingScale = 0.85;
  group.userData.shardSpecs = shardsFrom([
    [0.6, 0.3, 0.7], [-0.6, 0.3, 0.7], [0, -0.5, -1], [0.4, 0.6, -0.6],
  ], PARASITE_PALE, 0.2);
  return group;
}

// ---- spitter --------------------------------------------------------------------

const SPITTER_SHELL = PARASITE_DARK.clone().multiplyScalar(2.4);

export function createSpitterMesh() {
  const group = new Group();
  const parts: TintPart[] = [];

  // Carapace, clamp arms and snout are one rigid body, so they are one mesh.
  const bodyGeometry = cached('spitter.body', () => {
    const pieces: BufferGeometry[] = [];
    for (let i = 0; i < 3; i += 1) {
      pieces.push(place(new BoxGeometry(2.3 - i * 0.5, 0.42, 1.5 - i * 0.28), 0, 0.35 - i * 0.28, -0.5 + i * 0.62, -0.24 * i));
    }
    for (const side of [-1, 1]) {
      pieces.push(place(new BoxGeometry(0.24, 0.24, 1.5), side * 1.0, -0.1, 0.5, 0, side * 0.28));
      pieces.push(place(new ConeGeometry(0.26, 0.9, 4), side * 1.32, -0.1, 1.34, Math.PI / 2));
    }
    pieces.push(place(new CylinderGeometry(0.14, 0.3, 1.5, 7), 0, -0.1, 1.35, Math.PI / 2));
    return merged(pieces);
  });
  group.add(new Mesh(bodyGeometry, tint(parts, shellMaterial(SPITTER_SHELL), SPITTER_SHELL, 'shell')));

  const ribColor = hdr(PARASITE_VIOLET, 0.9);
  const ribGeometry = cached('spitter.ribs', () => {
    const ribs: BufferGeometry[] = [];
    for (let i = 0; i < 3; i += 1) {
      ribs.push(place(new PlaneGeometry(2.4 - i * 0.5, 0.055), 0, 0.58 - i * 0.28, -0.5 + i * 0.62, -Math.PI / 2 - 0.24 * i));
    }
    return merged(ribs);
  });
  group.add(new Mesh(ribGeometry, tint(parts, createAdditiveBasicMaterial({ color: ribColor, side: DoubleSide }), ribColor, 'rim')));

  const lampColor = hdr(PARASITE_PALE, 1.2);
  const lampMaterial = tint(parts, createAdditiveBasicMaterial({ color: lampColor }), lampColor, 'core');
  group.add(new Mesh(cached('spitter.lamp', () => place(new SphereGeometry(0.26, 8, 6), 0, -0.1, 2.05)), lampMaterial));

  group.userData.parts = parts;
  group.userData.chargeLamp = lampMaterial;
  group.userData.accent = PARASITE_VIOLET.clone();
  group.userData.lockRingScale = 1.5;
  group.userData.shardSpecs = shardsFrom([
    [1, 0.4, 0.2], [-1, 0.4, 0.2], [0.5, 0.8, -0.6], [-0.5, 0.8, -0.6],
    [0, -0.6, 1], [0.8, -0.3, -0.8], [-0.8, -0.3, -0.8], [0, 0.3, 1.2],
  ], PARASITE_VIOLET, 0.38);
  return group;
}

// ---- spore -----------------------------------------------------------------------

export function createSporeMesh() {
  const group = new Group();
  group.add(new Mesh(
    cached('spore.core', () => new OctahedronGeometry(0.3, 0)),
    new MeshBasicMaterial({ color: hdr(PARASITE_PALE, 2.2) }),
  ));

  const barbGeometry = cached('spore.barbs', () => {
    const barbs: BufferGeometry[] = [];
    for (let i = 0; i < 4; i += 1) {
      const angle = (i / 4) * Math.PI * 2;
      barbs.push(place(new ConeGeometry(0.1, 0.7, 4), Math.cos(angle) * 0.28, Math.sin(angle) * 0.28, -0.2, -0.9, 0, -angle));
    }
    return merged(barbs);
  });
  group.add(new Mesh(barbGeometry, new MeshBasicMaterial({ color: PARASITE_DARK.clone().multiplyScalar(3.2) })));

  const halo = new Mesh(
    cached('spore.halo', () => new SphereGeometry(0.62, 10, 7)),
    createAdditiveBasicMaterial({ color: hdr(PARASITE_VIOLET, 0.7), opacity: 0.6 }),
  );
  group.add(halo);

  group.userData.isHostileShot = true;
  group.userData.trailColor = PARASITE_VIOLET.clone().multiplyScalar(0.7);
  group.userData.halo = halo;
  group.userData.accent = PARASITE_PALE.clone();
  group.userData.lockRingScale = 0.8;
  group.userData.shardSpecs = shardsFrom([[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0]], PARASITE_PALE, 0.16);
  return group;
}

// ---- brood ------------------------------------------------------------------------

const BROOD_MASS = PARASITE_DARK.clone().multiplyScalar(2.0);

export function createBroodMesh() {
  const group = new Group();
  const parts: TintPart[] = [];

  // Solid inner mass, so the sac still reads as a body with bloom off.
  group.add(new Mesh(
    cached('brood.mass', () => new IcosahedronGeometry(1.5, 1)),
    tint(parts, shellMaterial(BROOD_MASS), BROOD_MASS, 'shell'),
  ));

  // Embryos: pale, unevenly packed, visible through the membrane.
  const embryoColor = hdr(PARASITE_PALE, 0.75);
  const embryoGeometry = cached('brood.embryos', () => {
    const embryos: BufferGeometry[] = [];
    for (let i = 0; i < 7; i += 1) {
      const angle = i * 2.399;
      const radius = 0.9 + (i % 3) * 0.42;
      embryos.push(place(
        new SphereGeometry(0.34, 8, 6),
        Math.cos(angle) * radius,
        Math.sin(angle * 1.7) * radius * 0.8,
        Math.sin(angle) * radius,
      ));
    }
    return merged(embryos);
  });
  const embryos = new Group();
  embryos.add(new Mesh(embryoGeometry, tint(parts, createAdditiveBasicMaterial({ color: embryoColor }), embryoColor, 'core')));
  group.add(embryos);

  const membraneColor = hdr(PARASITE_VIOLET, 0.3);
  const membrane = new Mesh(
    cached('brood.membrane', () => new SphereGeometry(2.5, 16, 11)),
    tint(
      parts,
      createAdditiveBasicMaterial({ color: membraneColor, opacity: 0.55, side: DoubleSide }),
      membraneColor,
      'rim',
    ),
  );
  group.add(membrane);

  // Knot where the umbilical enters.
  const knotColor = hdr(PARASITE_VIOLET, 0.85);
  group.add(new Mesh(
    cached('brood.knot', () => place(new TorusGeometry(0.6, 0.16, 6, 14), 0, 2.2, 0)),
    tint(parts, createAdditiveBasicMaterial({ color: knotColor }), knotColor, 'rim'),
  ));

  group.userData.parts = parts;
  group.userData.isBrood = true;
  group.userData.membrane = membrane;
  group.userData.embryos = embryos;
  group.userData.accent = PARASITE_VIOLET.clone();
  group.userData.lockRingScale = 2.6;
  group.userData.shardSpecs = shardsFrom([
    [1, 0.2, 0.3], [-1, 0.2, 0.3], [0.3, 1, -0.2], [0.3, -1, -0.2],
    [0.6, 0.3, 1], [-0.6, 0.3, -1], [0, 0.6, -1], [-0.4, -0.7, 0.6],
  ], PARASITE_VIOLET, 0.55);
  return group;
}

// ---- the parent -------------------------------------------------------------------

const PANEL_COUNT = 3;
const PARENT_BODY = PARASITE_DARK.clone().multiplyScalar(1.9);
const PARENT_PLATE = PARASITE_DARK.clone().multiplyScalar(2.6);

export function createParentMesh() {
  const group = new Group();
  const parts: TintPart[] = [];

  // Core plus the eight legs dug into the crown socket: one rigid body.
  const bodyGeometry = cached('parent.body', () => {
    const pieces: BufferGeometry[] = [new IcosahedronGeometry(8.6, 2)];
    for (let i = 0; i < 8; i += 1) {
      const angle = (i / 8) * Math.PI * 2;
      pieces.push(place(new ConeGeometry(1.1, 15, 5), Math.cos(angle) * 7.5, Math.sin(angle) * 7.5, -6, -2.1, 0, -angle));
    }
    return merged(pieces);
  });
  group.add(new Mesh(bodyGeometry, tint(parts, shellMaterial(PARENT_BODY), PARENT_BODY, 'shell')));

  const ridgeColor = hdr(PARASITE_VIOLET, 0.5);
  const ridgeGeometry = cached('parent.ridges', () => {
    const ridges: BufferGeometry[] = [];
    for (let i = 0; i < 3; i += 1) ridges.push(place(new TorusGeometry(8.9, 0.16, 5, 40), 0, 0, 0, 0, (i / 3) * Math.PI));
    return merged(ridges);
  });
  group.add(new Mesh(ridgeGeometry, tint(parts, createAdditiveBasicMaterial({ color: ridgeColor, side: DoubleSide }), ridgeColor, 'rim')));

  // The heart, and the plates covering it until the webbing is gone.
  const heartColor = hdr(PARASITE_PALE, 1.1);
  const heartMaterial = tint(parts, createAdditiveBasicMaterial({ color: heartColor }), heartColor, 'core');
  const heart = new Mesh(cached('parent.heart', () => new IcosahedronGeometry(4.6, 2)), heartMaterial);
  heart.position.z = 3.4;
  group.add(heart);

  const plates = new Group();
  const plateMaterial = tint(parts, shellMaterial(PARENT_PLATE), PARENT_PLATE, 'shell');
  for (let i = 0; i < 5; i += 1) {
    const angle = (i / 5) * Math.PI * 2;
    const geometry = cached(`parent.plate${i}`, () => place(
      new SphereGeometry(5.4, 10, 6, angle, Math.PI * 0.42, 0, Math.PI * 0.55),
      0, 0, 0, -Math.PI / 2,
    ));
    const plate = new Mesh(geometry, plateMaterial);
    plate.position.z = 3.4;
    plate.userData.outward = new Vector3(Math.cos(angle + 0.6), Math.sin(angle + 0.6), 0.35).normalize();
    plates.add(plate);
  }
  group.add(plates);

  // Three webbing panels. Each is a fan of struts with membrane between them —
  // large, thin, and additive, so they read as covering without blacking the
  // parent out. Struts and lacing merge into one mesh, the membrane into
  // another; the panel group as a whole is what withers.
  const webColor = hdr(PARASITE_VIOLET, 0.78);
  const strutColor = hdr(PARASITE_VIOLET, 1.5);
  const strutGeometry = cached('parent.panelStruts', () => {
    const pieces: BufferGeometry[] = [];
    for (let s = 0; s < 4; s += 1) {
      const spread = (s / 3 - 0.5) * 1.15;
      pieces.push(place(new CylinderGeometry(0.16, 0.34, 27, 4), Math.sin(spread) * 13, Math.cos(spread) * 13, 5, 0, 0, -spread));
    }
    for (let r = 0; r < 4; r += 1) pieces.push(place(new PlaneGeometry(26, 0.22), 0, 4 + r * 7, 5));
    return merged(pieces);
  });
  const webGeometry = cached('parent.panelWeb', () => {
    const pieces: BufferGeometry[] = [];
    for (let s = 0; s < 3; s += 1) {
      const mid = ((s + 0.5) / 3 - 0.5) * 1.15;
      pieces.push(place(new PlaneGeometry(9, 26), Math.sin(mid) * 13, Math.cos(mid) * 13, 5, 0, 0, -mid));
    }
    return merged(pieces);
  });

  const panels: Group[] = [];
  for (let p = 0; p < PANEL_COUNT; p += 1) {
    const panel = new Group();
    const webMaterial = createAdditiveBasicMaterial({ color: webColor, opacity: 0.7, side: DoubleSide });
    const strutMaterial = createAdditiveBasicMaterial({ color: strutColor });
    panel.add(new Mesh(strutGeometry, strutMaterial));
    panel.add(new Mesh(webGeometry, webMaterial));
    panel.rotation.z = (p / PANEL_COUNT) * Math.PI * 2;
    panel.userData.webMaterial = webMaterial;
    panel.userData.strutMaterial = strutMaterial;
    panel.userData.wither = 0;
    panels.push(panel);
    group.add(panel);
  }

  group.userData.parts = parts;
  group.userData.isParent = true;
  group.userData.heart = heart;
  group.userData.heartMaterial = heartMaterial;
  group.userData.plates = plates;
  group.userData.webPanels = panels;
  group.userData.accent = PARASITE_VIOLET.clone();
  group.userData.lockRingScale = 9;
  group.userData.shardSpecs = shardsFrom([
    [1, 0.2, 0.3], [-1, 0.2, 0.3], [0.4, 1, 0], [0.4, -1, 0], [0, 0.3, 1],
    [0.7, 0.7, -0.4], [-0.7, -0.7, -0.4], [-0.9, 0.4, 0.5], [0.9, -0.4, 0.5],
    [0.2, 0.9, 0.6], [-0.2, -0.9, 0.6], [0, 0, -1],
  ], PARASITE_VIOLET, 1.5);
  return group;
}

/**
 * The parent's per-frame state. Everything here is driven off the fight, not
 * off a timer: panels die back as broods die, plates retract once it is bare,
 * and the heart burns brighter the closer it is to coming loose.
 */
export function updateParentMesh(mesh: Group, elapsed: number, dt: number) {
  const panels = mesh.userData.webPanels as Group[] | undefined;
  const alive = (mesh.userData.panelsRemaining as number | undefined) ?? PANEL_COUNT;
  if (panels) {
    for (const [index, panel] of panels.entries()) {
      const target = index >= alive ? 1 : 0;
      const previous = panel.userData.wither as number;
      const wither = previous + (target - previous) * Math.min(1, dt * 1.6);
      panel.userData.wither = wither;
      // Dying webbing curls in on itself and goes out.
      const breath = 1 + Math.sin(elapsed * 0.9 + index * 2.1) * 0.05;
      panel.scale.set((1 - wither * 0.82) * breath, (1 - wither * 0.55) * breath, breath);
      panel.rotation.y = wither * 1.1;
      (panel.userData.webMaterial as MeshBasicMaterial).color.copy(hdr(PARASITE_VIOLET, 0.78 * (1 - wither) ** 1.4));
      (panel.userData.strutMaterial as MeshBasicMaterial).color.copy(hdr(PARASITE_VIOLET, 1.5 * (1 - wither) ** 1.6));
    }
  }

  const exposed = (mesh.userData.exposedAmount as number | undefined) ?? 0;
  const plates = mesh.userData.plates as Group | undefined;
  if (plates) {
    for (const plate of plates.children) {
      const outward = plate.userData.outward as Vector3;
      plate.position.copy(outward).multiplyScalar(exposed * 6.2);
      plate.position.z += 3.4;
      plate.scale.setScalar(1 - exposed * 0.35);
    }
  }

  const heartMaterial = mesh.userData.heartMaterial as MeshBasicMaterial | undefined;
  const heart = mesh.userData.heart as Mesh | undefined;
  if (heartMaterial && heart) {
    const stage = (mesh.userData.stageIndex as number | undefined) ?? 0;
    const beat = 0.8 + Math.sin(elapsed * (2.2 + exposed * 3 + stage * 1.4)) * 0.35;
    heartMaterial.color.copy(hdr(PARASITE_PALE, (0.3 + exposed * 1.1 + stage * 0.5) * beat));
    heart.scale.setScalar(1 + exposed * 0.2 + Math.sin(elapsed * 3 + stage) * 0.05);
  }
}

/** Clings fold their hooks back the moment they let go of the strand. */
export function updateClingMesh(mesh: Group, elapsed: number) {
  const hooks = mesh.userData.hooks as Group | undefined;
  const detach = (mesh.userData.detachProgress as number | undefined) ?? 0;
  const tension = (mesh.userData.tension as number | undefined) ?? 0;
  if (hooks) {
    hooks.scale.setScalar(1 - detach * 0.5);
    hooks.rotation.y = detach * 1.6;
    // Shivering telegraph while it is still holding on.
    hooks.position.y = tension > 0 ? Math.sin(elapsed * 34) * 0.05 * tension : 0;
  }
  const core = mesh.userData.core as Mesh | undefined;
  if (core) core.scale.setScalar(1 + tension * 0.5 + Math.sin(elapsed * 5) * 0.08);
}

/** One sine runs down the chain — the tail whips, it does not flap. */
export function updateLarvaMesh(mesh: Group, elapsed: number) {
  const segments = mesh.userData.segments as Group[] | undefined;
  if (!segments) return;
  const swim = (mesh.userData.swim as number | undefined) ?? elapsed;
  for (const [index, segment] of segments.entries()) {
    segment.rotation.y = Math.sin(swim * 9 - index * 1.05) * (0.36 + index * 0.14);
  }
}

export function updateBroodMesh(mesh: Group, elapsed: number) {
  const membrane = mesh.userData.membrane as Mesh | undefined;
  const embryos = mesh.userData.embryos as Group | undefined;
  const pulse = (mesh.userData.pulse as number | undefined) ?? elapsed;
  const breedIn = (mesh.userData.breedIn as number | undefined) ?? 1;
  // It swells as the next larva comes up, then snaps back when it lets go.
  const contraction = Math.max(0, 1 - breedIn / 0.45);
  if (membrane) membrane.scale.setScalar(1 + Math.sin(pulse * 1.7) * 0.06 + contraction * 0.26);
  if (embryos) {
    embryos.rotation.y = pulse * 0.4;
    embryos.scale.setScalar(1 - contraction * 0.18);
  }
}

export function updateSporeMesh(mesh: Group, elapsed: number) {
  const halo = mesh.userData.halo as Mesh | undefined;
  const imminent = mesh.userData.imminent === true;
  if (halo) halo.scale.setScalar(1 + Math.sin(elapsed * (imminent ? 22 : 7)) * (imminent ? 0.4 : 0.14));
}

