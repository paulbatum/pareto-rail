import {
  BufferGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  Material,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  Quaternion,
  RingGeometry,
  SphereGeometry,
  TorusGeometry,
  Vector3,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { createAdditiveBasicMaterial } from '../../../engine/visual-kit';
import { hdr, SICK_MAGENTA, VIOLET, VIOLET_DARK, VIOLET_HOT, VIOLET_PALE } from './palette';

// Five parasites, five silhouettes — and five ways of moving:
//   clamper  a seven-legged star that grips a strand, then lets go and skitters
//   leech    a long S-waving worm with a hot sucker mouth
//   brooder  a plated sac ringed with pustules and spikes
//   spore    a teardrop with a tail: the only thing that hunts you
//   brood    a curled comma with two eyes: the parent's fresh larvae
// All of them are sickly violet; their edges glow hotter than their bodies.

type Part = { mesh: Mesh; rest: Material; locked: Material; flash: Material };

const materialCache = new Map<string, MeshBasicMaterial>();
function basic(key: string, color: Color, vertexColors = false) {
  let material = materialCache.get(key);
  if (!material) {
    material = new MeshBasicMaterial({ color: color.clone(), vertexColors });
    materialCache.set(key, material);
  }
  return material;
}

const LOCKED_TINT = new Color(1, 0.94, 0.86);
const FLASH_TINT = new Color(1.6, 1.5, 1.4);

/** Registers a mesh with its resting, locked (sun-blanched) and hit-flash materials. */
function part(root: Group, parent: Object3D, mesh: Mesh, key: string, color: Color, vertexColors = false) {
  const rest = basic(key, color, vertexColors);
  const locked = basic(`${key}:locked`, vertexColors ? LOCKED_TINT.clone().multiplyScalar(1.1) : color.clone().lerp(LOCKED_TINT, 0.62).multiplyScalar(1.15), vertexColors);
  const flash = basic(`${key}:flash`, FLASH_TINT, vertexColors);
  mesh.material = rest;
  const parts = (root.userData.parts ??= []) as Part[];
  parts.push({ mesh, rest, locked, flash });
  parent.add(mesh);
  return mesh;
}

function paint(geometry: BufferGeometry, base: Color, tip: Color, axis: 'x' | 'y' | 'z', from: number, to: number) {
  const position = geometry.getAttribute('position');
  const colors = new Float32Array(position.count * 3);
  const scratch = new Color();
  for (let i = 0; i < position.count; i += 1) {
    const value = axis === 'x' ? position.getX(i) : axis === 'y' ? position.getY(i) : position.getZ(i);
    const t = Math.min(1, Math.max(0, (value - from) / (to - from)));
    scratch.copy(base).lerp(tip, t * t);
    colors[i * 3] = scratch.r;
    colors[i * 3 + 1] = scratch.g;
    colors[i * 3 + 2] = scratch.b;
  }
  geometry.setAttribute('color', new Float32BufferAttribute(colors, 3));
  return geometry;
}

const additiveCache = new Map<string, MeshBasicMaterial>();
function sharedAdditive(key: string, color: Color, opacity: number) {
  let material = additiveCache.get(key);
  if (!material) {
    material = createAdditiveBasicMaterial({ color: color.clone(), opacity });
    additiveCache.set(key, material);
  }
  return material;
}

let sharedHalo: BufferGeometry | null = null;
function haloGeometry() {
  sharedHalo ??= new SphereGeometry(1, 12, 9);
  return sharedHalo;
}

// ---- clamper ------------------------------------------------------------------------

const LEG_COUNT = 7;
let clamperLegGeometry: BufferGeometry | null = null;
let clamperBodyGeometry: BufferGeometry | null = null;
let clamperEyeGeometry: BufferGeometry | null = null;

function getClamperGeometries() {
  if (!clamperLegGeometry) {
    // A jointed leg along +X: thick thigh, bent shin, glowing hook tip.
    const thigh = new ConeGeometry(0.17, 0.85, 6, 1).rotateZ(-Math.PI / 2).translate(0.42, 0, 0);
    const shin = new ConeGeometry(0.11, 0.7, 6, 1).rotateZ(-Math.PI / 2).rotateY(-0.55).translate(0.85, 0, 0.02);
    const tip = new SphereGeometry(0.12, 6, 5).translate(1.22, 0, -0.22);
    const merged = mergeGeometries([thigh, shin, tip])!;
    clamperLegGeometry = paint(merged, VIOLET, hdr(VIOLET_HOT, 1.45), 'x', 0.35, 1.3);
    for (const geometry of [thigh, shin, tip]) geometry.dispose();
  }
  clamperBodyGeometry ??= new SphereGeometry(0.58, 14, 10).scale(1, 1, 0.82);
  if (!clamperEyeGeometry) {
    const eyes: BufferGeometry[] = [];
    for (const [x, y] of [[0, 0.22], [-0.2, -0.1], [0.2, -0.1]] as const) {
      eyes.push(new SphereGeometry(0.11, 6, 5).translate(x, y, 0.44));
    }
    clamperEyeGeometry = mergeGeometries(eyes)!;
    for (const geometry of eyes) geometry.dispose();
  }
  return { leg: clamperLegGeometry, body: clamperBodyGeometry, eyes: clamperEyeGeometry };
}

export function createClamperMesh() {
  const group = new Group();
  const geometries = getClamperGeometries();
  part(group, group, new Mesh(geometries.body), 'clamper:body', VIOLET_DARK.clone().multiplyScalar(2.1));
  part(group, group, new Mesh(geometries.eyes), 'clamper:eyes', hdr(VIOLET_HOT, 1.7));
  const legs: Group[] = [];
  for (let i = 0; i < LEG_COUNT; i += 1) {
    const pivot = new Group();
    const angle = (i / LEG_COUNT) * Math.PI * 2;
    pivot.rotation.z = angle;
    pivot.position.set(Math.cos(angle) * 0.42, Math.sin(angle) * 0.42, 0);
    const leg = new Mesh(geometries.leg);
    part(group, pivot, leg, 'clamper:leg', new Color(1, 1, 1), true);
    group.add(pivot);
    legs.push(pivot);
  }
  const halo = new Mesh(haloGeometry(), sharedAdditive('clamper:halo', hdr(VIOLET, 0.32), 0.5));
  halo.scale.setScalar(1.7);
  group.add(halo);
  group.userData.legs = legs;
  group.userData.halo = halo;
  return group;
}

function animateClamper(mesh: Object3D, time: number) {
  const legs = mesh.userData.legs as Group[];
  const peel = (mesh.userData.peel as number | undefined) ?? 0;
  const seed = (mesh.userData.seed as number | undefined) ?? 0;
  legs.forEach((pivot, index) => {
    // Latched: legs sweep back and dig in. Free: they reach forward and flutter.
    const grip = 0.85 + Math.sin(time * 1.4 + index * 0.9 + seed) * 0.05;
    const reach = -0.35 + Math.sin(time * 15 + index * 1.3 + seed) * 0.32;
    pivot.rotation.y = grip + (reach - grip) * peel;
  });
}

// ---- leech --------------------------------------------------------------------------

const LEECH_SEGMENTS = [
  { z: 1.5, r: 0.44 },
  { z: 0.85, r: 0.52 },
  { z: 0.2, r: 0.54 },
  { z: -0.45, r: 0.5 },
  { z: -1.05, r: 0.42 },
  { z: -1.6, r: 0.31 },
  { z: -2.1, r: 0.2 },
];

let leechSegmentGeometry: BufferGeometry | null = null;
let leechMouthGeometry: BufferGeometry | null = null;
let leechFinGeometry: BufferGeometry | null = null;
let leechStripeGeometry: BufferGeometry | null = null;

export function createLeechMesh() {
  const group = new Group();
  leechSegmentGeometry ??= new SphereGeometry(1, 12, 8);
  leechMouthGeometry ??= new TorusGeometry(0.4, 0.13, 6, 14);
  leechFinGeometry ??= new ConeGeometry(0.34, 1.0, 4).rotateX(-Math.PI / 2).scale(1.9, 0.18, 1);
  leechStripeGeometry ??= new SphereGeometry(1, 8, 5).scale(0.12, 0.09, 1);

  const segments: Group[] = [];
  LEECH_SEGMENTS.forEach((spec, index) => {
    const holder = new Group();
    holder.position.z = spec.z;
    const shade = VIOLET.clone().lerp(VIOLET_DARK, 0.15 + index * 0.06);
    const seg = new Mesh(leechSegmentGeometry!);
    seg.scale.set(spec.r, spec.r * 0.9, 0.42);
    part(group, holder, seg, `leech:seg${index}`, shade);
    // A magenta dorsal stripe rides the back.
    const stripe = new Mesh(leechStripeGeometry!);
    stripe.scale.set(1, 1, 0.5 + spec.r * 0.4);
    stripe.position.y = spec.r * 0.82;
    part(group, holder, stripe, 'leech:stripe', hdr(SICK_MAGENTA, 1.35));
    group.add(holder);
    segments.push(holder);
  });
  const mouth = new Mesh(leechMouthGeometry);
  mouth.position.z = 1.85;
  part(group, group, mouth, 'leech:mouth', hdr(VIOLET_HOT, 1.9));
  const fin = new Mesh(leechFinGeometry);
  fin.position.z = -2.55;
  part(group, group, fin, 'leech:fin', VIOLET_PALE.clone().multiplyScalar(0.9));
  group.userData.segments = segments;
  group.userData.fin = fin;
  return group;
}

function animateLeech(mesh: Object3D, time: number) {
  const segments = mesh.userData.segments as Group[];
  const seed = (mesh.userData.seed as number | undefined) ?? 0;
  segments.forEach((holder, index) => {
    // A travelling S-wave: amplitude grows toward the tail.
    const wave = Math.sin(time * 9 - index * 0.95 + seed);
    holder.position.x = wave * 0.12 * (0.3 + index * 0.24);
    holder.rotation.y = Math.cos(time * 9 - index * 0.95 + seed) * 0.28;
  });
  const fin = mesh.userData.fin as Mesh;
  fin.position.x = Math.sin(time * 9 - 7 * 0.95 + seed) * 0.4;
  fin.rotation.y = Math.cos(time * 9 - 7 * 0.95 + seed) * 0.5;
}

// ---- brooder -------------------------------------------------------------------------

let brooderSacGeometry: BufferGeometry | null = null;
let brooderPustuleGeometry: BufferGeometry | null = null;
let brooderSpikeGeometry: BufferGeometry | null = null;
let brooderPlateGeometry: BufferGeometry | null = null;

export function createBrooderMesh() {
  const group = new Group();
  brooderSacGeometry ??= new SphereGeometry(1.25, 16, 12);
  if (!brooderPustuleGeometry) {
    const list: BufferGeometry[] = [];
    for (let i = 0; i < 7; i += 1) {
      const angle = (i / 7) * Math.PI * 2 + 0.3;
      const ring = i % 2 === 0 ? 0.95 : 0.6;
      list.push(new SphereGeometry(0.42 + (i % 3) * 0.06, 8, 6).translate(Math.cos(angle) * ring, Math.sin(angle) * ring, 0.9 + (i % 2) * 0.1));
    }
    brooderPustuleGeometry = mergeGeometries(list)!;
    for (const geometry of list) geometry.dispose();
  }
  if (!brooderSpikeGeometry) {
    const list: BufferGeometry[] = [];
    for (let i = 0; i < 12; i += 1) {
      const angle = (i / 12) * Math.PI * 2;
      const spike = new ConeGeometry(0.16, 1.0, 5).rotateZ(-Math.PI / 2).translate(0.5, 0, 0);
      list.push(spike.applyMatrix4(new Matrix4().makeRotationZ(angle).multiply(new Matrix4().makeTranslation(1.55, 0, 0))));
    }
    brooderSpikeGeometry = paint(mergeGeometries(list)!, VIOLET_DARK.clone().multiplyScalar(3), hdr(VIOLET_PALE, 1.3), 'z', -0.2, 0.2);
    for (const geometry of list) geometry.dispose();
  }
  // Plate: a curved petal of shell cupped over the sac's front.
  brooderPlateGeometry ??= new SphereGeometry(1.62, 10, 6, 0, (Math.PI * 2) / 5 - 0.12, 0.28, 1.05).rotateX(Math.PI / 2);

  part(group, group, new Mesh(brooderSacGeometry), 'brooder:sac', new Color(0.62, 0.12, 0.5));
  part(group, group, new Mesh(brooderPustuleGeometry), 'brooder:pustule', hdr(VIOLET_HOT, 0.95));
  part(group, group, new Mesh(brooderSpikeGeometry), 'brooder:spike', new Color(1, 1, 1), true);
  const plates: Object3D[] = [];
  for (let i = 0; i < 5; i += 1) {
    const holder = new Group();
    holder.rotation.z = (i / 5) * Math.PI * 2;
    const plate = new Mesh(brooderPlateGeometry);
    part(group, holder, plate, 'brooder:plate', VIOLET_DARK.clone().multiplyScalar(2.6));
    group.add(holder);
    plates.push(holder);
  }
  const halo = new Mesh(haloGeometry(), sharedAdditive('brooder:halo', hdr(SICK_MAGENTA, 0.28), 0.5));
  halo.scale.setScalar(2.3);
  group.add(halo);
  group.userData.plates = plates;
  group.userData.pustules = group.children[1];
  group.userData.plateBreak = 0;
  return group;
}

function animateBrooder(mesh: Object3D, time: number, dt: number) {
  const swell = (mesh.userData.swell as number | undefined) ?? 0;
  const pustules = mesh.userData.pustules as Object3D;
  const beat = 1 + Math.sin(time * 2.4 + (mesh.userData.seed ?? 0)) * 0.05;
  pustules.scale.setScalar(beat + swell * 0.55);
  const stageIndex = (mesh.userData.stageIndex as number | undefined) ?? 0;
  const plates = mesh.userData.plates as Object3D[];
  let breakAmount = (mesh.userData.plateBreak as number) ?? 0;
  if (stageIndex > 0 || breakAmount > 0) {
    breakAmount = Math.min(1, breakAmount + dt * 2.6);
    mesh.userData.plateBreak = breakAmount;
  }
  plates.forEach((holder, index) => {
    // Plates lever open on a hinge, then drift away and vanish.
    const open = breakAmount;
    holder.position.z = open * (0.9 + index * 0.1);
    holder.position.x = Math.cos((index / 5) * Math.PI * 2) * open * 2.4;
    holder.position.y = Math.sin((index / 5) * Math.PI * 2) * open * 2.4;
    holder.scale.setScalar(Math.max(0.001, 1 - Math.max(0, open - 0.5) * 2));
    holder.visible = holder.scale.x > 0.01;
  });
  mesh.rotation.z += dt * 0.15;
}

// ---- spore ---------------------------------------------------------------------------

let sporeHeadGeometry: BufferGeometry | null = null;
let sporeTailGeometry: BufferGeometry | null = null;
let sporeHaloGeometry: BufferGeometry | null = null;
let sporeRingGeometry: BufferGeometry | null = null;

export function createSporeMesh() {
  const group = new Group();
  sporeHeadGeometry ??= new SphereGeometry(0.38, 10, 8);
  sporeTailGeometry ??= new ConeGeometry(0.24, 1.3, 7).rotateX(-Math.PI / 2).translate(0, 0, -0.85);
  sporeHaloGeometry ??= new SphereGeometry(0.7, 10, 8);
  sporeRingGeometry ??= new RingGeometry(1.15, 1.25, 28);
  part(group, group, new Mesh(sporeHeadGeometry), 'spore:head', hdr(VIOLET_HOT, 1.6));
  part(group, group, new Mesh(sporeTailGeometry), 'spore:tail', VIOLET.clone().multiplyScalar(1.1));
  const halo = new Mesh(sporeHaloGeometry, sharedAdditive('spore:halo', hdr(VIOLET, 0.7), 0.4));
  group.add(halo);
  const warning = new Mesh(sporeRingGeometry, createAdditiveBasicMaterial({ color: 0x000000, side: DoubleSide }));
  warning.userData.billboard = true;
  group.add(warning);
  group.userData.halo = halo;
  group.userData.warning = warning;
  return group;
}

function animateSpore(mesh: Object3D, time: number, _dt: number, camera: Object3D) {
  const halo = mesh.userData.halo as Mesh;
  const warning = mesh.userData.warning as Mesh;
  halo.scale.setScalar(1 + Math.sin(time * 9) * 0.15);
  // The closer it gets, the faster the ring blinks: a heartbeat you must silence.
  const distance = mesh.position.distanceTo(camera.position);
  const urgency = Math.max(0, Math.min(1, 1 - (distance - 4) / 30));
  const blink = 0.5 + 0.5 * Math.sin(time * (6 + urgency * 22));
  (warning.material as MeshBasicMaterial).color.copy(VIOLET_HOT).multiplyScalar(urgency * blink * 1.6);
  warning.quaternion.copy(camera.quaternion);
  // Cancel parent rotation so the ring always faces the player.
  warning.quaternion.premultiply(mesh.getWorldQuaternion(new Quaternion()).invert());
  warning.scale.setScalar(1 + (1 - blink) * 0.3);
}

// ---- brood ---------------------------------------------------------------------------

let broodBallGeometry: BufferGeometry | null = null;
let broodEyeGeometry: BufferGeometry | null = null;
let broodTailGeometry: BufferGeometry | null = null;

export function createBroodMesh() {
  const group = new Group();
  broodBallGeometry ??= new SphereGeometry(1, 10, 8);
  broodEyeGeometry ??= new SphereGeometry(0.1, 6, 5);
  broodTailGeometry ??= new ConeGeometry(0.2, 1.0, 6).rotateX(-Math.PI / 2);
  const segments: Group[] = [];
  [[0.62, 0.5, 0.42], [0.2, 0.44, 0.37], [-0.28, 0.36, 0.32]].forEach(([z, r, y], index) => {
    const holder = new Group();
    holder.position.set(0, 0, z);
    const ball = new Mesh(broodBallGeometry!);
    ball.scale.setScalar(r);
    part(group, holder, ball, `brood:${index}`, new Color(0.95, 0.22, 0.85).lerp(new Color(0.55, 0.15, 0.9), index * 0.3));
    void y;
    group.add(holder);
    segments.push(holder);
  });
  for (const x of [-0.19, 0.19]) {
    const eye = new Mesh(broodEyeGeometry);
    eye.position.set(x, 0.14, 1.04);
    part(group, group, eye, 'brood:eye', hdr(VIOLET_HOT, 2.1));
  }
  const tail = new Mesh(broodTailGeometry);
  tail.position.z = -0.88;
  part(group, group, tail, 'brood:tail', new Color(0.9, 0.6, 1).multiplyScalar(0.9));
  const halo = new Mesh(haloGeometry(), sharedAdditive('brood:halo', hdr(VIOLET_HOT, 0.42), 0.5));
  halo.scale.set(1.15, 1.15, 1.7);
  group.add(halo);
  group.userData.segments = segments;
  group.userData.tail = tail;
  return group;
}

function animateBrood(mesh: Object3D, time: number) {
  const segments = mesh.userData.segments as Group[];
  const seed = (mesh.userData.seed as number | undefined) ?? 0;
  const lunge = (mesh.userData.lunge as number | undefined) ?? 0;
  segments.forEach((holder, index) => {
    holder.position.x = Math.sin(time * 10 - index * 1.1 + seed) * 0.11 * (index + 1) * (1 + lunge * 2);
  });
  (mesh.userData.tail as Mesh).position.x = Math.sin(time * 10 - 3.3 + seed) * 0.42;
}

// ---- proxy for the parent ----------------------------------------------------------------

export function createParentProxy() {
  const group = new Group();
  group.userData.lockScale = 7;
  group.userData.proxy = true;
  return group;
}

// ---- shared ---------------------------------------------------------------------------------

export function animateEnemy(mesh: Object3D, kind: string, time: number, dt: number, camera: Object3D) {
  switch (kind) {
    case 'clamper':
      animateClamper(mesh, time);
      break;
    case 'leech':
      animateLeech(mesh, time);
      break;
    case 'brooder':
      animateBrooder(mesh, time, dt);
      break;
    case 'spore':
      animateSpore(mesh, time, dt, camera);
      break;
    case 'brood':
      animateBrood(mesh, time);
      break;
    default:
      break;
  }
}

/** State swap: rest / locked / flash. Everything shares cached materials. */
export function setEnemyState(mesh: Object3D, state: 'rest' | 'locked' | 'flash') {
  const parts = mesh.userData.parts as Part[] | undefined;
  if (!parts) return;
  for (const entry of parts) {
    entry.mesh.material = state === 'locked' ? entry.locked : state === 'flash' ? entry.flash : entry.rest;
  }
}

/** Approximate lock-ring radius for an enemy kind, in metres. */
export function enemyRadius(kind: string) {
  switch (kind) {
    case 'clamper':
      return 1.9;
    case 'leech':
      return 2.4;
    case 'brooder':
      return 2.6;
    case 'spore':
      return 1.1;
    case 'brood':
      return 1.3;
    default:
      return 2;
  }
}

void CylinderGeometry;
void Vector3;
