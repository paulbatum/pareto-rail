import {
  BackSide,
  BufferGeometry,
  Color,
  CylinderGeometry,
  DoubleSide,
  Group,
  IcosahedronGeometry,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshPhongMaterial,
  Quaternion,
  SphereGeometry,
  TorusGeometry,
  Vector3,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { createAdditiveBasicMaterial } from '../../../engine/visual-kit';
import { mulberry32 } from '../../../engine/rng';
import { SECTOR_ANGLES, WEB_RADIUS } from '../crown';
import { PARASITE, PARASITE_DARK, PARASITE_HOT, PARASITE_PALE, hdr } from './palette';

// Leaf: parasite construction. Each factory returns a Group whose
// userData.parts lists the tintable materials (shell / glow / core) so the
// spine can light them for locks, hits, and rejections, plus whatever moving
// pieces that kind animates (legs, segments, bladders, tendrils, web).
//
// Every parasite shares one anatomy language: a wet, glossy violet shell lit
// by the sun above, a hot violet-pink core glowing through it, and a faint
// aura so the silhouette separates from the water even with bloom off.

export type TintPart = { material: MeshPhongMaterial | MeshBasicMaterial; base: Color; kind: 'shell' | 'glow' | 'core' };

// Geometry is identical across instances of a kind, so it is built once and
// shared; only materials are per-enemy (they carry lock and hit tints).
const geometryCache = new Map<string, BufferGeometry>();

function memo<T extends BufferGeometry>(key: string, make: () => T): T {
  let geometry = geometryCache.get(key);
  if (!geometry) {
    geometry = make();
    geometryCache.set(key, geometry);
  }
  return geometry as T;
}

const sphere = (...args: ConstructorParameters<typeof SphereGeometry>) => memo(`sphere:${args.join(':')}`, () => new SphereGeometry(...args));
const torus = (...args: ConstructorParameters<typeof TorusGeometry>) => memo(`torus:${args.join(':')}`, () => new TorusGeometry(...args));
const icosa = (...args: ConstructorParameters<typeof IcosahedronGeometry>) => memo(`icosa:${args.join(':')}`, () => new IcosahedronGeometry(...args));
const cylinder = (...args: ConstructorParameters<typeof CylinderGeometry>) => memo(`cylinder:${args.join(':')}`, () => new CylinderGeometry(...args));

type Build = { group: Group; parts: TintPart[] };

function begin(): Build {
  return { group: new Group(), parts: [] };
}

function shell(build: Build, geometry: BufferGeometry, color: Color, options: { emissive?: number; opacity?: number } = {}) {
  const material = new MeshPhongMaterial({
    color: color.clone(),
    emissive: color.clone().multiplyScalar(options.emissive ?? 0.35),
    specular: new Color(0.75, 0.65, 0.9),
    shininess: 70,
    transparent: options.opacity !== undefined,
    opacity: options.opacity ?? 1,
    depthWrite: options.opacity === undefined,
  });
  build.parts.push({ material, base: color.clone(), kind: 'shell' });
  return new Mesh(geometry, material);
}

function glow(build: Build, geometry: BufferGeometry, color: Color, kind: 'glow' | 'core' = 'core', opacity = 1) {
  const material = createAdditiveBasicMaterial({ color: color.clone(), opacity });
  build.parts.push({ material, base: color.clone(), kind });
  return new Mesh(geometry, material);
}

function aura(build: Build, radius: number, strength = 0.2) {
  const tint = hdr(PARASITE_HOT, strength * 0.3).lerp(hdr(PARASITE, strength * 0.28), 0.5);
  const material = createAdditiveBasicMaterial({ color: tint, side: BackSide });
  build.parts.push({ material, base: tint.clone(), kind: 'glow' });
  const mesh = new Mesh(sphere(radius, 16, 12), material);
  return mesh;
}

function finish(build: Build, extra: Record<string, unknown> = {}) {
  Object.assign(build.group.userData, { parts: build.parts, ...extra });
  return build.group;
}

function segmentBetween(a: Vector3, b: Vector3, radiusA: number, radiusB: number, radial = 6) {
  const length = a.distanceTo(b);
  const geometry = new CylinderGeometry(radiusB, radiusA, length, radial, 1, false);
  const direction = b.clone().sub(a).normalize();
  const quaternion = new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), direction);
  geometry.applyMatrix4(new Matrix4().compose(a.clone().add(b).multiplyScalar(0.5), quaternion, new Vector3(1, 1, 1)));
  return geometry;
}

// ---- tick ---------------------------------------------------------------------
// A flat, plated louse with six hooked legs. Latched, its legs clench the
// strand behind it; swimming, they fold back and paddle.

export function createTickMesh() {
  const build = begin();
  const body = shell(build, sphere(0.85, 20, 14), PARASITE);
  body.scale.set(1, 0.6, 1.3);
  build.group.add(body);

  const plateColor = PARASITE_DARK.clone().lerp(PARASITE, 0.35);
  for (const [z, r] of [[-0.55, 0.62], [0, 0.82], [0.5, 0.7]] as const) {
    const plate = shell(build, torus(r, 0.07, 6, 24, Math.PI), plateColor, { emissive: 0.2 });
    plate.position.set(0, 0.05, z);
    plate.scale.set(1, 0.72, 1);
    build.group.add(plate);
  }

  const head = shell(build, sphere(0.42, 14, 10), PARASITE_DARK.clone().lerp(PARASITE, 0.6));
  head.position.set(0, 0, 1.05);
  head.scale.set(1.1, 0.7, 0.9);
  build.group.add(head);
  for (const x of [-0.17, 0.17]) {
    const eye = glow(build, sphere(0.09, 8, 6), hdr(PARASITE_HOT, 2.2));
    eye.position.set(x, 0.12, 1.36);
    build.group.add(eye);
  }

  const gut = glow(build, sphere(0.42, 12, 8), hdr(PARASITE_HOT, 1.1));
  gut.position.set(0, -0.12, -0.1);
  gut.scale.set(1, 0.6, 1.4);
  build.group.add(gut);

  const legs: Group[] = [];
  const legGeometry = memo('tick-leg', () => mergeGeometries([
    segmentBetween(new Vector3(0, 0, 0), new Vector3(0.75, -0.3, 0), 0.07, 0.05),
    segmentBetween(new Vector3(0.75, -0.3, 0), new Vector3(0.95, -0.85, 0.1), 0.05, 0.02),
  ]));
  for (let i = 0; i < 6; i += 1) {
    const side = i % 2 === 0 ? 1 : -1;
    const z = [-0.55, 0.05, 0.6][Math.floor(i / 2)];
    const pivot = new Group();
    pivot.position.set(side * 0.62, -0.12, z);
    const leg = shell(build, legGeometry, PARASITE_DARK.clone().lerp(PARASITE, 0.4), { emissive: 0.25 });
    leg.scale.x = side;
    pivot.add(leg);
    pivot.userData.side = side;
    pivot.userData.phase = i * 0.9;
    legs.push(pivot);
    build.group.add(pivot);
  }

  build.group.add(aura(build, 1.55, 0.14));
  return finish(build, { legs, accent: PARASITE_HOT, lockScale: 1 });
}

// ---- creeper ---------------------------------------------------------------------
// A segmented worm with a ring mouth. Its segments are repositioned every
// frame from the head's recent path, so it spirals and undulates as a body.

export function createCreeperMesh() {
  const build = begin();
  const head = shell(build, sphere(0.62, 18, 12), PARASITE);
  head.scale.set(1, 0.85, 1.25);
  build.group.add(head);
  const mouth = glow(build, torus(0.34, 0.09, 8, 20), hdr(PARASITE_HOT, 1.8));
  mouth.position.z = 0.72;
  build.group.add(mouth);
  const throat = glow(build, sphere(0.26, 10, 8), hdr(PARASITE_HOT, 2.4));
  throat.position.z = 0.62;
  build.group.add(throat);
  for (const x of [-0.22, 0.22]) {
    const feeler = shell(build, memo(`creeper-feeler:${x}`, () => segmentBetween(new Vector3(x, 0.25, 0.5), new Vector3(x * 3.2, 0.75, 1.35), 0.05, 0.015)), PARASITE_PALE, { emissive: 0.4 });
    build.group.add(feeler);
  }

  const segments: Mesh[] = [];
  const count = 8;
  for (let i = 0; i < count; i += 1) {
    const radius = 0.56 - i * 0.042;
    const color = PARASITE.clone().lerp(PARASITE_DARK, i / count * 0.6);
    const segment = shell(build, sphere(radius, 14, 10), color);
    const spines = shell(build, memo(`creeper-spines:${i}`, () => mergeGeometries([
      segmentBetween(new Vector3(0, 0, 0), new Vector3(radius * 1.9, radius * 0.6, -0.1), 0.06, 0.01, 4),
      segmentBetween(new Vector3(0, 0, 0), new Vector3(-radius * 1.9, radius * 0.6, -0.1), 0.06, 0.01, 4),
    ])), PARASITE_PALE, { emissive: 0.3 });
    segment.add(spines);
    const light = glow(build, sphere(radius * 0.42, 8, 6), hdr(PARASITE_HOT, 0.9 - i * 0.07));
    light.position.y = -radius * 0.35;
    segment.add(light);
    segments.push(segment);
    build.group.add(segment);
  }

  build.group.add(aura(build, 1.35, 0.13));
  return finish(build, { segments, segmentSpacing: 0.62, accent: PARASITE_HOT, lockScale: 1 });
}

// ---- bladder ---------------------------------------------------------------------
// A clustered gas-sac that stays rooted and spits spores. It swells across the
// beat before each spit; the first hit bursts a sac.

export function createBladderMesh() {
  const build = begin();
  const core = glow(build, sphere(0.55, 14, 10), hdr(PARASITE_HOT, 1.7));
  build.group.add(core);
  const sacs: Mesh[] = [];
  const rng = mulberry32(77);
  for (let i = 0; i < 5; i += 1) {
    const angle = (i / 5) * Math.PI * 2;
    const radius = 0.62 + rng() * 0.16;
    const sac = shell(build, sphere(radius, 16, 12), PARASITE.clone().lerp(PARASITE_PALE, 0.25), { opacity: 0.78, emissive: 0.45 });
    sac.position.set(Math.cos(angle) * 0.75, Math.sin(angle) * 0.75, -0.15 + rng() * 0.2);
    sac.userData.home = sac.position.clone();
    sacs.push(sac);
    build.group.add(sac);
  }
  const nozzle = shell(build, cylinder(0.22, 0.4, 0.8, 12, 1, true), PARASITE_DARK.clone().lerp(PARASITE, 0.5), { emissive: 0.3 });
  nozzle.rotation.x = Math.PI / 2;
  nozzle.position.z = 0.75;
  (nozzle.material as MeshPhongMaterial).side = DoubleSide;
  build.group.add(nozzle);
  const lip = glow(build, torus(0.23, 0.07, 6, 18), hdr(PARASITE_HOT, 2.2));
  lip.position.z = 1.15;
  build.group.add(lip);
  for (let i = 0; i < 4; i += 1) {
    const angle = (i / 4) * Math.PI * 2 + 0.4;
    const root = shell(build, memo(`bladder-root:${i}`, () => mergeGeometries([
      segmentBetween(new Vector3(0, 0, -0.3), new Vector3(Math.cos(angle) * 1.2, Math.sin(angle) * 1.2, -1.1), 0.12, 0.06, 5),
      segmentBetween(new Vector3(Math.cos(angle) * 1.2, Math.sin(angle) * 1.2, -1.1), new Vector3(Math.cos(angle) * 0.7, Math.sin(angle) * 0.7, -1.7), 0.06, 0.015, 5),
    ])), PARASITE_DARK.clone().lerp(PARASITE, 0.3), { emissive: 0.2 });
    build.group.add(root);
  }
  build.group.add(aura(build, 1.9, 0.16));
  return finish(build, { sacs, core, accent: PARASITE_HOT, lockScale: 1.25 });
}

// ---- drifter ----------------------------------------------------------------------
// A small parasitic medusa: a violet bell that jets on the beat, trailing
// hooked tendrils. The bell apex leads (+z).

export function createDrifterMesh() {
  const build = begin();
  const bellGeometry = memo('drifter-bell', () => new SphereGeometry(0.78, 20, 10, 0, Math.PI * 2, 0, Math.PI * 0.55).rotateX(Math.PI / 2));
  const bell = shell(build, bellGeometry, PARASITE.clone().lerp(PARASITE_PALE, 0.2), { opacity: 0.85, emissive: 0.5 });
  (bell.material as MeshPhongMaterial).side = DoubleSide;
  build.group.add(bell);
  const margin = glow(build, torus(0.66, 0.06, 6, 24), hdr(PARASITE_HOT, 1.6));
  margin.position.z = 0.12;
  build.group.add(margin);
  const heart = glow(build, sphere(0.28, 10, 8), hdr(PARASITE_HOT, 2.0));
  heart.position.z = 0.35;
  build.group.add(heart);
  const tendrils: Group[] = [];
  for (let i = 0; i < 6; i += 1) {
    const angle = (i / 6) * Math.PI * 2;
    const pivot = new Group();
    pivot.position.set(Math.cos(angle) * 0.55, Math.sin(angle) * 0.55, 0.05);
    const tendril = shell(build, memo('drifter-tendril', () => mergeGeometries([
      segmentBetween(new Vector3(0, 0, 0), new Vector3(0, 0, -0.9), 0.05, 0.035, 4),
      segmentBetween(new Vector3(0, 0, -0.9), new Vector3(0.15, 0, -1.7), 0.035, 0.012, 4),
    ])), PARASITE_PALE, { emissive: 0.5 });
    pivot.add(tendril);
    pivot.rotation.z = angle;
    pivot.userData.phase = i * 1.1;
    tendrils.push(pivot);
    build.group.add(pivot);
  }
  build.group.add(aura(build, 1.3, 0.15));
  return finish(build, { bell, tendrils, accent: PARASITE_HOT, lockScale: 0.9 });
}

// ---- hatchling ----------------------------------------------------------------------

export function createHatchlingMesh() {
  const build = begin();
  const body = shell(build, icosa(0.52, 1), PARASITE);
  build.group.add(body);
  const spikes = memo('hatchling-spikes', () => {
    const pieces: BufferGeometry[] = [];
    const rng = mulberry32(12);
    for (let i = 0; i < 12; i += 1) {
      const direction = new Vector3(rng() - 0.5, rng() - 0.5, rng() - 0.5).normalize();
      pieces.push(segmentBetween(direction.clone().multiplyScalar(0.4), direction.clone().multiplyScalar(1.05), 0.09, 0.01, 4));
    }
    return mergeGeometries(pieces);
  });
  build.group.add(shell(build, spikes, PARASITE_PALE, { emissive: 0.35 }));
  const core = glow(build, sphere(0.3, 10, 8), hdr(PARASITE_HOT, 2.0));
  build.group.add(core);
  const tail = shell(build, memo('hatchling-tail', () => segmentBetween(new Vector3(0, 0, -0.35), new Vector3(0, 0, -1.4), 0.2, 0.02, 6)), PARASITE_DARK.clone().lerp(PARASITE, 0.5));
  build.group.add(tail);
  build.group.add(aura(build, 1.25, 0.16));
  return finish(build, { accent: PARASITE_HOT, lockScale: 0.9 });
}

// ---- spore ----------------------------------------------------------------------------
// The hostile shot: a spiked seed with a hot core. It reads as danger by
// being the brightest violet thing in the water.

export function createSporeMesh() {
  const build = begin();
  const core = glow(build, sphere(0.3, 12, 8), hdr(PARASITE_HOT, 2.6));
  build.group.add(core);
  const spikes = memo('spore-spikes', () => {
    const pieces: BufferGeometry[] = [];
    const rng = mulberry32(5);
    for (let i = 0; i < 14; i += 1) {
      const direction = new Vector3(rng() - 0.5, rng() - 0.5, rng() - 0.5).normalize();
      pieces.push(segmentBetween(direction.clone().multiplyScalar(0.18), direction.clone().multiplyScalar(0.72), 0.07, 0.008, 4));
    }
    return mergeGeometries(pieces);
  });
  const spikeMesh = shell(build, spikes, PARASITE_DARK.clone().lerp(PARASITE, 0.5), { emissive: 0.5 });
  build.group.add(spikeMesh);
  build.group.add(glow(build, sphere(0.95, 12, 10), hdr(PARASITE_HOT, 0.35), 'glow', 0.6));
  return finish(build, { spin: spikeMesh, accent: PARASITE_HOT, lockScale: 0.8, isHostileShot: true });
}

// ---- the parent -------------------------------------------------------------------------
// A bloated violet sac clenched into the crown by six hooked claws, a
// translucent brood pouch pulsing with eggs, three burning eye-slits, and a
// three-sector cage of webbing bulging toward the approach.

export function createParentMesh(options: { web: boolean } = { web: true }) {
  const build = begin();
  const rng = mulberry32(99);

  const bodyGeometry = memo('parent-body', () => {
    const geometry = new SphereGeometry(4, 48, 32);
    const positions = geometry.getAttribute('position');
    const v = new Vector3();
    for (let i = 0; i < positions.count; i += 1) {
      v.fromBufferAttribute(positions, i);
      const n = v.clone().normalize();
      const lump = 1 + 0.09 * Math.sin(n.x * 7 + 1.3) * Math.sin(n.y * 6 + 0.4) + 0.06 * Math.sin(n.z * 11 + n.x * 5);
      v.multiplyScalar(lump);
      v.z *= 0.8;
      positions.setXYZ(i, v.x, v.y, v.z);
    }
    geometry.computeVertexNormals();
    return geometry;
  });
  const body = shell(build, bodyGeometry, PARASITE.clone().lerp(PARASITE_DARK, 0.25), { emissive: 0.3 });
  build.group.add(body);

  // Brood pouch with eggs.
  const pouch = shell(build, sphere(2.3, 24, 18), PARASITE.clone().lerp(PARASITE_PALE, 0.3), { opacity: 0.55, emissive: 0.6 });
  pouch.position.set(0, -1.2, 2.6);
  build.group.add(pouch);
  const eggs: Mesh[] = [];
  for (let i = 0; i < 7; i += 1) {
    const egg = glow(build, sphere(0.42 + rng() * 0.2, 10, 8), hdr(PARASITE_HOT, 1.6));
    egg.position.set((rng() - 0.5) * 2.4, -1.2 + (rng() - 0.5) * 2.2, 2.6 + (rng() - 0.5) * 1.6);
    egg.userData.home = egg.position.clone();
    eggs.push(egg);
    build.group.add(egg);
  }

  // Eye slits.
  const eyes: Mesh[] = [];
  for (const [x, y] of [[-1.5, 1.2], [1.5, 1.2], [0, 2.0]] as const) {
    const eye = glow(build, sphere(0.34, 12, 8), hdr(PARASITE_HOT, 2.8));
    eye.scale.set(1.5, 0.32, 0.5);
    eye.position.set(x, y, 3.25);
    eyes.push(eye);
    build.group.add(eye);
  }

  // Claws: hooked limbs reaching back and out into the bell.
  const claws: Group[] = [];
  for (let i = 0; i < 6; i += 1) {
    const angle = (i / 6) * Math.PI * 2 + Math.PI / 6;
    const out = new Vector3(Math.cos(angle), Math.sin(angle), 0);
    const pivot = new Group();
    pivot.position.copy(out.clone().multiplyScalar(3.2)).setZ(-0.8);
    const a = new Vector3();
    const b = out.clone().multiplyScalar(3.4).setZ(-2.2);
    const c = out.clone().multiplyScalar(4.6).setZ(-4.6);
    const d = out.clone().multiplyScalar(3.7).setZ(-5.8);
    const claw = shell(build, memo(`parent-claw:${i}`, () => mergeGeometries([
      segmentBetween(a, b, 0.6, 0.42, 8),
      segmentBetween(b, c, 0.42, 0.25, 8),
      segmentBetween(c, d, 0.25, 0.03, 8),
    ])), PARASITE_DARK.clone().lerp(PARASITE, 0.35), { emissive: 0.2 });
    pivot.add(claw);
    pivot.userData.out = out;
    claws.push(pivot);
    build.group.add(pivot);
  }

  // The web cage: three sectors of radial and concentric threads bulging
  // toward the camera, each with its own material so it can wither alone.
  const dome = (r: number, theta: number) => new Vector3(
    Math.cos(theta) * r,
    Math.sin(theta) * r,
    4.8 * (1 - (r / (WEB_RADIUS * 1.2)) ** 2) + 1.4,
  );
  const sectors: Group[] = [];
  if (options.web) SECTOR_ANGLES.forEach((centerAngle, sectorIndex) => {
    const threadGeometry = memo(`web-sector:${sectorIndex}`, () => {
    const pieces: BufferGeometry[] = [];
    const span = (Math.PI * 2) / 3;
    const start = centerAngle - span / 2;
    for (let k = 0; k <= 6; k += 1) {
      const theta = start + (k / 6) * span;
      let prev = dome(2.4, theta);
      for (let r = 3.4; r <= WEB_RADIUS * 1.18; r += 1.1) {
        const next = dome(r, theta + Math.sin(r * 1.7 + k) * 0.03);
        pieces.push(segmentBetween(prev, next, 0.07, 0.07, 4));
        prev = next;
      }
      // Anchor line from the rim back into the bell.
      const rim = dome(WEB_RADIUS * 1.18, theta);
      pieces.push(segmentBetween(rim, new Vector3(Math.cos(theta) * WEB_RADIUS * 1.6, Math.sin(theta) * WEB_RADIUS * 1.6, -3), 0.06, 0.04, 4));
    }
    for (const r of [4.3, 6.2, 8.1, 10]) {
      let prev = dome(r, start);
      for (let k = 1; k <= 10; k += 1) {
        const theta = start + (k / 10) * span;
        const next = dome(r + Math.sin(k * 2.3 + r) * 0.2, theta);
        pieces.push(segmentBetween(prev, next, 0.05, 0.05, 4));
        prev = next;
      }
    }
    return mergeGeometries(pieces);
    });
    const threads = new Mesh(threadGeometry, new MeshBasicMaterial({
      color: hdr(PARASITE_PALE, 0.9),
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
    }));
    const sheen = new Mesh(threads.geometry, createAdditiveBasicMaterial({ color: hdr(PARASITE_HOT, 0.45) }));
    sheen.scale.setScalar(1.001);
    const sector = new Group();
    sector.add(threads, sheen);
    sector.userData.threads = threads;
    sector.userData.sheen = sheen;
    sector.userData.centerAngle = centerAngle;
    sectors.push(sector);
    build.group.add(sector);
  });

  build.group.add(aura(build, 6.5, 0.1));
  const bodyParts = build.group.children.filter((child) => !sectors.includes(child as Group));
  return finish(build, { eggs, eyes, claws, sectors, pouch, bodyParts, accent: PARASITE_HOT, lockScale: 4.2, isParent: true });
}
