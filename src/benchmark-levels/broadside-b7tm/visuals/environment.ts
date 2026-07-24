import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CircleGeometry,
  Color,
  CylinderGeometry,
  DoubleSide,
  Euler,
  Fog,
  Group,
  IcosahedronGeometry,
  InstancedMesh,
  MathUtils,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  Quaternion,
  Scene,
  SphereGeometry,
  TetrahedronGeometry,
  Vector3,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { sampleRailFrame } from '../../../engine/rail';
import { mulberry32 } from '../../../engine/rng';
import { createAdditiveBasicMaterial, disposeObject3D } from '../../../engine/visual-kit';
import { BATTLE_LENGTH, createBroadsideRail, railUAtBar } from '../gameplay';
import { createCapitalShip, type CapitalShip } from './capitals';
import { spawnFlare, spawnTracer } from './effects';
import {
  COLD_WHITE,
  CRIMSON,
  CYAN,
  EMBER,
  ICE_SHADOW,
  MOLTEN,
  NEBULA_DEEP,
  NEBULA_GOLD,
  NEBULA_MAGENTA,
  NEBULA_ROSE,
  OBSIDIAN,
  OBSIDIAN_EDGE,
  VOID_BLACK,
  hdr,
} from './palette';

// The world of BROADSIDE is four things stacked:
//
//   1. a magenta-and-gold nebula shell that backlights everything, so every
//      hull in the level is a silhouette with a colored rim;
//   2. a loose, deliberately un-formed fleet engagement — capital ships at
//      wrong angles, at every distance, on both sides;
//   3. four rail-following structures the flight path is threaded through:
//      your own launch deck, an enemy warship's belly, the enemy flagship's
//      dorsal spine, and the trench cut into it;
//   4. the gunnery: kilometre-long tracers fired between those hulls, on the
//      beat, all run long. It is the level's signature image and it is driven
//      by the transport, not by a timer.

export type EnvironmentContext = {
  camera: PerspectiveCamera;
  elapsed: number;
  runTime: number;
  running: boolean;
  speed: number;
  beatEnergy: number;
};

export type Environment = {
  root: Group;
  update(dt: number, context: EnvironmentContext): void;
  onBeat(beatNumber: number, isDownbeat: boolean, runTime: number, running: boolean): void;
  dropShield(): void;
  killFlagship(): void;
  reset(): void;
  dispose(): void;
};

const curve = createBroadsideRail();
const scratchVector = new Vector3();
const scratchVector2 = new Vector3();

function railMatrix(u: number, x: number, y: number, z: number, out = new Matrix4()) {
  const frame = sampleRailFrame(curve, MathUtils.clamp(u, 0, 1));
  const position = frame.position
    .clone()
    .addScaledVector(frame.right, x)
    .addScaledVector(frame.up, y)
    .addScaledVector(frame.tangent, z);
  // (right, up, tangent) is left-handed — tangent points the way the camera
  // travels, which is three's -Z. Negating it keeps the basis right-handed so
  // merged scenery keeps its winding.
  return out.makeBasis(frame.right, frame.up, frame.tangent.negate()).setPosition(position);
}

function railPoint(u: number, x: number, y: number, out = new Vector3()) {
  const frame = sampleRailFrame(curve, MathUtils.clamp(u, 0, 1));
  return out.copy(frame.position).addScaledVector(frame.right, x).addScaledVector(frame.up, y);
}

function transform(geometry: BufferGeometry, matrix: Matrix4) {
  return geometry.applyMatrix4(matrix);
}

function localMatrix(x: number, y: number, z: number, rx = 0, ry = 0, rz = 0, out = new Matrix4()) {
  out.makeRotationFromEuler(new Euler(rx, ry, rz));
  return out.setPosition(x, y, z);
}

function mergeMesh(geometries: BufferGeometry[], material: MeshBasicMaterial) {
  if (geometries.length === 0) return null;
  const merged = mergeGeometries(geometries);
  for (const geometry of geometries) geometry.dispose();
  return merged ? new Mesh(merged, material) : null;
}

// ---- rail-following structures ------------------------------------------------

type StripBuild = { plates: BufferGeometry[]; seams: BufferGeometry[] };

/**
 * Walk a span of the rail in fixed steps and let the caller stamp geometry into
 * a rail-aligned frame at each one. Structures built this way hug the flight
 * path exactly, so nothing drifts into the firing corridor when the rail banks.
 */
function stripAlongRail(
  u0: number,
  u1: number,
  step: number,
  build: (index: number, matrix: Matrix4, rng: () => number, out: StripBuild) => void,
  seed: number,
): StripBuild {
  const out: StripBuild = { plates: [], seams: [] };
  const rng = mulberry32(seed);
  const count = Math.max(2, Math.round(((u1 - u0) * BATTLE_LENGTH) / step));
  const matrix = new Matrix4();
  for (let i = 0; i < count; i += 1) {
    const u = u0 + ((u1 - u0) * (i + 0.5)) / count;
    railMatrix(u, 0, 0, 0, matrix);
    build(i, matrix, rng, out);
  }
  return out;
}

/** Your own flagship's launch lane: a shallow wide trough that simply ends. */
function buildLaunchDeck(root: Group) {
  const u0 = railUAtBar(-0.4);
  const u1 = railUAtBar(2.5);
  const step = 16;
  const { plates, seams } = stripAlongRail(u0, u1, step, (index, matrix, rng, out) => {
    const local = new Matrix4();
    out.plates.push(transform(new BoxGeometry(120, 8, step), localMatrix(0, -18, 0, 0, 0, 0, local).premultiply(matrix)));
    for (const side of [-1, 1]) {
      out.plates.push(transform(new BoxGeometry(9, 26, step), localMatrix(side * 44, -3, 0, 0, 0, 0, local).premultiply(matrix)));
      out.plates.push(transform(
        new BoxGeometry(5 + rng() * 7, 4 + rng() * 8, step * 0.55),
        localMatrix(side * (30 + rng() * 8), -12, (rng() - 0.5) * step, 0, 0, 0, local).premultiply(matrix),
      ));
    }
    if (index % 2 === 0) {
      out.seams.push(transform(new BoxGeometry(76, 0.7, step * 0.7), localMatrix(0, -13.6, 0, 0, 0, 0, local).premultiply(matrix)));
    }
    for (const side of [-1, 1]) {
      out.seams.push(transform(new BoxGeometry(0.9, 0.9, step * 0.8), localMatrix(side * 39, 8, 0, 0, 0, 0, local).premultiply(matrix)));
    }
  }, 41);

  const deckMaterial = new MeshBasicMaterial({ color: ICE_SHADOW.clone().multiplyScalar(0.5) });
  const laneMaterial = createAdditiveBasicMaterial({ color: hdr(CYAN, 0.8) });
  const deck = mergeMesh(plates, deckMaterial);
  const lanes = mergeMesh(seams, laneMaterial);
  if (deck) root.add(deck);
  if (lanes) root.add(lanes);
  return { deckMaterial, laneMaterial };
}

/** The enemy warship you pass beneath: a ventral surface, ribs down, hard edges. */
function buildBellyHull(root: Group) {
  const u0 = railUAtBar(17.4);
  const u1 = railUAtBar(23.1);
  const step = 20;
  const { plates, seams } = stripAlongRail(u0, u1, step, (index, matrix, rng, out) => {
    const local = new Matrix4();
    out.plates.push(transform(new BoxGeometry(210, 16, step), localMatrix(0, 52, 0, 0, 0, 0, local).premultiply(matrix)));
    // Keel ridge and hull ribs hang down toward the flight path.
    out.plates.push(transform(new BoxGeometry(26, 12, step), localMatrix(0, 39, 0, 0, 0, 0, local).premultiply(matrix)));
    if (index % 2 === 0) {
      out.plates.push(transform(new BoxGeometry(150, 5, 5), localMatrix(0, 40, 0, 0, 0, 0, local).premultiply(matrix)));
    }
    for (const side of [-1, 1]) {
      out.plates.push(transform(
        new BoxGeometry(9 + rng() * 14, 6 + rng() * 10, 6 + rng() * 10),
        localMatrix(side * (24 + rng() * 62), 39 + rng() * 5, (rng() - 0.5) * step, 0, 0, 0, local).premultiply(matrix),
      ));
      out.seams.push(transform(new BoxGeometry(1.2, 1.2, step * 0.85), localMatrix(side * 46, 38, 0, 0, 0, 0, local).premultiply(matrix)));
    }
  }, 77);

  const hullMaterial = new MeshBasicMaterial({ color: OBSIDIAN.clone() });
  const seamMaterial = createAdditiveBasicMaterial({ color: hdr(EMBER, 0.75) });
  const hull = mergeMesh(plates, hullMaterial);
  const lit = mergeMesh(seams, seamMaterial);
  if (hull) root.add(hull);
  if (lit) root.add(lit);
  return { hullMaterial, seamMaterial };
}

/** The enemy flagship's dorsal spine: the surface the generators stand on. */
function buildFlagshipSpine(root: Group) {
  const u0 = railUAtBar(22.3);
  const u1 = railUAtBar(29.0);
  const step = 20;
  const { plates, seams } = stripAlongRail(u0, u1, step, (index, matrix, rng, out) => {
    const local = new Matrix4();
    out.plates.push(transform(new BoxGeometry(230, 20, step), localMatrix(0, -42, 0, 0, 0, 0, local).premultiply(matrix)));
    if (index % 2 === 0) {
      out.plates.push(transform(new BoxGeometry(190, 4, 6), localMatrix(0, -31, 0, 0, 0, 0, local).premultiply(matrix)));
    }
    for (const side of [-1, 1]) {
      // Flanking superstructure: two black cliffs well outside the firing lane.
      out.plates.push(transform(new BoxGeometry(30, 70, step), localMatrix(side * 96, -14, 0, 0, 0, 0, local).premultiply(matrix)));
      out.plates.push(transform(
        new BoxGeometry(10 + rng() * 20, 8 + rng() * 16, 8 + rng() * 14),
        localMatrix(side * (40 + rng() * 34), -28 + rng() * 6, (rng() - 0.5) * step, 0, 0, 0, local).premultiply(matrix),
      ));
      out.seams.push(transform(new BoxGeometry(1.4, 1.4, step * 0.9), localMatrix(side * 78, -30, 0, 0, 0, 0, local).premultiply(matrix)));
      out.seams.push(transform(new BoxGeometry(2.2, 2.2, step * 0.5), localMatrix(side * 96, 18, 0, 0, 0, 0, local).premultiply(matrix)));
    }
  }, 133);

  const hullMaterial = new MeshBasicMaterial({ color: OBSIDIAN.clone() });
  const seamMaterial = createAdditiveBasicMaterial({ color: hdr(EMBER, 0.8) });
  const hull = mergeMesh(plates, hullMaterial);
  const lit = mergeMesh(seams, seamMaterial);
  if (hull) root.add(hull);
  if (lit) root.add(lit);
  return { hullMaterial, seamMaterial };
}

/**
 * The trenchwork. Walls stand well outside the firing corridor and the only
 * structure that crosses the centre line rides high above every target, so the
 * canyon can be tight to look at without ever hiding something you must shoot.
 */
function buildTrench(root: Group) {
  const u0 = railUAtBar(29.5);
  const u1 = railUAtBar(34.5);
  const step = 14;
  const HALF = 38;
  const { plates, seams } = stripAlongRail(u0, u1, step, (index, matrix, rng, out) => {
    const local = new Matrix4();
    out.plates.push(transform(new BoxGeometry(HALF * 2 + 24, 10, step), localMatrix(0, -50, 0, 0, 0, 0, local).premultiply(matrix)));
    for (const side of [-1, 1]) {
      out.plates.push(transform(new BoxGeometry(16, 130, step), localMatrix(side * (HALF + 8), 6, 0, 0, 0, 0, local).premultiply(matrix)));
      out.plates.push(transform(
        new BoxGeometry(8 + rng() * 10, 10 + rng() * 30, 5 + rng() * 8),
        localMatrix(side * (HALF - 3), -14 + rng() * 40, (rng() - 0.5) * step, 0, 0, 0, local).premultiply(matrix),
      ));
      // Two lit conduits per wall, one low and one at eye level: the canyon has
      // to read as a canyon in the half-second you are inside each bay.
      out.seams.push(transform(new BoxGeometry(1.5, 1.5, step * 0.92), localMatrix(side * (HALF - 1), -8 - rng() * 20, 0, 0, 0, 0, local).premultiply(matrix)));
      out.seams.push(transform(new BoxGeometry(1.1, 1.1, step * 0.92), localMatrix(side * (HALF - 1.4), 12 + rng() * 22, 0, 0, 0, 0, local).premultiply(matrix)));
    }
    // Machinery on the trench floor, and overhead spans high enough to clear
    // every core and every crossing swarm craft.
    out.plates.push(transform(
      new BoxGeometry(10 + rng() * 16, 8 + rng() * 12, 8 + rng() * 12),
      localMatrix((rng() - 0.5) * HALF, -38 + rng() * 6, (rng() - 0.5) * step, 0, 0, 0, local).premultiply(matrix),
    ));
    // Overhead spans ride high above every target in the trench, so the canyon
    // can close over your head without ever hiding something you must shoot.
    if (index % 2 === 0) {
      out.plates.push(transform(new BoxGeometry(HALF * 2, 6, 7), localMatrix(0, 34, 0, 0, 0, 0, local).premultiply(matrix)));
      out.seams.push(transform(new BoxGeometry(HALF * 2 - 6, 0.9, 1.3), localMatrix(0, 30, 0, 0, 0, 0, local).premultiply(matrix)));
    }
  }, 911);

  const wallMaterial = new MeshBasicMaterial({ color: OBSIDIAN.clone() });
  const seamMaterial = createAdditiveBasicMaterial({ color: hdr(EMBER, 0.85) });
  const walls = mergeMesh(plates, wallMaterial);
  const lit = mergeMesh(seams, seamMaterial);
  if (walls) root.add(walls);
  if (lit) root.add(lit);

  // Shield canopy: a violet arch over the trench that eats your fire until the
  // generators are gone. Additive wireframe, so it never hides a target.
  const length = (u1 - u0) * BATTLE_LENGTH;
  const canopyGeometry = new CylinderGeometry(62, 62, length, 24, 8, true, 0, Math.PI);
  const canopyMaterial = createAdditiveBasicMaterial({ color: new Color(0.5, 0.1, 0.85), opacity: 0.6, side: DoubleSide });
  canopyMaterial.wireframe = true;
  const canopy = new Mesh(canopyGeometry, canopyMaterial);
  canopy.userData.raildIgnoreOcclusion = true;
  canopy.frustumCulled = false;
  const canopyHolder = new Group();
  canopyHolder.userData.raildIgnoreOcclusion = true;
  canopyHolder.applyMatrix4(railMatrix((u0 + u1) / 2, 0, -6, 0));
  canopy.rotation.set(Math.PI / 2, 0, 0);
  canopyHolder.add(canopy);
  root.add(canopyHolder);

  return { wallMaterial, seamMaterial, canopy, canopyMaterial, canopyHolder };
}

// ---- fleets -------------------------------------------------------------------

type FleetShip = { ship: CapitalShip; group: Group; batteries: Vector3[]; side: 'friendly' | 'enemy'; burning: boolean };

// The engine renders to a 500-unit far plane, so the whole engagement — sky,
// stars and every hull in it — has to live inside that shell. The fleet is
// therefore close and enormous rather than distant and small, which is also
// the read the theme wants.
//
// (bar, lateral x, lateral y, length, side, yaw, pitch, roll, batteries)
const FLEET_PLAN: Array<readonly [number, number, number, number, 'friendly' | 'enemy', number, number, number, number]> = [
  [1.5, -150, -34, 380, 'friendly', 0.22, 0.03, 0.3, 5],
  [3.2, 168, 52, 320, 'enemy', -0.3, -0.05, -0.5, 4],
  [6.0, -206, 74, 440, 'friendly', 0.1, -0.08, 0.9, 6],
  [7.5, 150, -78, 350, 'enemy', 0.35, 0.06, 0.2, 5],
  [10.0, 250, 36, 400, 'enemy', -0.14, 0.02, -1.1, 5],
  [15.0, -104, 4, 460, 'friendly', 0.05, 0.0, -0.08, 7],
  [13.0, 186, -20, 360, 'enemy', 0.18, -0.04, 0.6, 5],
  [16.5, 296, 84, 440, 'enemy', -0.22, 0.03, 1.5, 6],
  [17.5, -212, -62, 340, 'friendly', 0.28, 0.05, -0.7, 4],
  [21.0, -178, 36, 380, 'friendly', -0.16, -0.03, 0.4, 5],
  [25.0, -254, -50, 430, 'friendly', 0.2, 0.04, 1.2, 6],
  [27.0, 232, 74, 310, 'enemy', -0.26, -0.02, -0.3, 4],
  [31.0, -150, 82, 350, 'friendly', 0.12, -0.06, 0.8, 5],
  [33.0, 206, -44, 390, 'enemy', 0.3, 0.05, -0.9, 5],
];

// The far side of the engagement, hung ahead of the rail's end so the pull-out
// flies into a frame that already has the whole battle in it.
const FAR_LINE: Array<readonly [number, number, number, number, 'friendly' | 'enemy']> = [
  [-150, 24, 210, 430, 'enemy'],
  [-30, 86, 260, 380, 'enemy'],
  [120, 8, 235, 410, 'enemy'],
  [250, 104, 290, 360, 'enemy'],
  [-280, 122, 300, 380, 'friendly'],
  [290, -22, 310, 350, 'friendly'],
];

function buildFleet(root: Group) {
  const ships: FleetShip[] = [];
  let seed = 1201;

  for (const [atBar, x, y, length, side, yaw, pitch, roll, batteries] of FLEET_PLAN) {
    seed += 37;
    const ship = createCapitalShip({
      length,
      beam: length * 0.055,
      depth: length * 0.042,
      side,
      seed,
      batteries,
      superstructure: 1,
    });
    const holder = new Group();
    holder.applyMatrix4(railMatrix(railUAtBar(atBar), x, y, 0));
    ship.group.rotation.set(pitch, yaw, roll);
    holder.add(ship.group);
    root.add(holder);
    ships.push({ ship, group: holder, batteries: [], side, burning: false });
  }

  // The far line sits beyond the end of the rail, in world space, so the
  // pull-out flies into a frame that already has the whole battle in it.
  const end = curve.getPointAt(1);
  for (const [x, y, ahead, length, side] of FAR_LINE) {
    seed += 53;
    const ship = createCapitalShip({
      length,
      beam: length * 0.055,
      depth: length * 0.042,
      side,
      seed,
      batteries: 5,
      superstructure: 1,
    });
    const holder = new Group();
    holder.position.set(end.x + x, end.y + y, end.z - ahead);
    ship.group.rotation.set(0.04, (x > 0 ? -1 : 1) * 0.25, x * 0.0006);
    holder.add(ship.group);
    root.add(holder);
    ships.push({ ship, group: holder, batteries: [], side, burning: false });
  }

  // Cache muzzle points in world space once — capital ships never move.
  for (const entry of ships) {
    entry.group.updateMatrixWorld(true);
    for (const point of entry.ship.batteryPoints) {
      entry.batteries.push(point.clone().applyMatrix4(entry.ship.group.matrixWorld));
    }
  }
  return ships;
}

// ---- nebula and stars ---------------------------------------------------------

function buildSky(root: Group) {
  const sky = new Group();
  sky.userData.raildIgnoreOcclusion = true;
  root.add(sky);

  // Backdrop shell: magenta low, gold high, near-black in the deep gaps. The
  // colours are baked per-vertex so it costs one draw call and no texture.
  const shell = new SphereGeometry(455, 40, 26);
  const position = shell.getAttribute('position');
  const colors = new Float32Array(position.count * 3);
  const noiseRng = mulberry32(20260724);
  const blobs = Array.from({ length: 9 }, () => ({
    direction: new Vector3(noiseRng() * 2 - 1, noiseRng() * 2 - 1, noiseRng() * 2 - 1).normalize(),
    tightness: 1.6 + noiseRng() * 3.2,
    gold: noiseRng(),
  }));
  // Rifts: the dark lanes that keep the shell from reading as one flat wash.
  const rifts = Array.from({ length: 5 }, () => ({
    direction: new Vector3(noiseRng() * 2 - 1, noiseRng() * 2 - 1, noiseRng() * 2 - 1).normalize(),
    tightness: 3.0 + noiseRng() * 5.0,
  }));
  const color = new Color();
  const normal = new Vector3();
  for (let i = 0; i < position.count; i += 1) {
    normal.set(position.getX(i), position.getY(i), position.getZ(i)).normalize();
    const elevation = MathUtils.clamp(normal.y * 0.5 + 0.5, 0, 1);
    color.copy(NEBULA_DEEP).lerp(NEBULA_MAGENTA, MathUtils.smoothstep(elevation, 0.1, 0.75));
    let goldWeight = 0;
    let roseWeight = 0;
    for (const blob of blobs) {
      const alignment = Math.max(0, normal.dot(blob.direction));
      const weight = alignment ** blob.tightness;
      goldWeight += weight * blob.gold;
      roseWeight += weight * (1 - blob.gold);
    }
    color.lerp(NEBULA_ROSE, MathUtils.clamp(roseWeight * 0.9, 0, 0.85));
    color.lerp(NEBULA_GOLD, MathUtils.clamp(goldWeight * 0.8, 0, 0.7));
    let riftWeight = 0;
    for (const rift of rifts) riftWeight += Math.max(0, normal.dot(rift.direction)) ** rift.tightness;
    color.lerp(VOID_BLACK, MathUtils.clamp(riftWeight * 0.9, 0, 0.8));
    // Below the battle's plane the sky falls away to nothing, so the lower half
    // of every frame is dark enough for cyan fire and the reticle to carry.
    color.lerp(VOID_BLACK, MathUtils.clamp(1 - elevation * 1.9, 0, 0.82));
    colors[i * 3] = color.r;
    colors[i * 3 + 1] = color.g;
    colors[i * 3 + 2] = color.b;
  }
  shell.setAttribute('color', new BufferAttribute(colors, 3));
  const shellMaterial = new MeshBasicMaterial({ vertexColors: true, side: DoubleSide, fog: false, depthWrite: false });
  const shellMesh = new Mesh(shell, shellMaterial);
  shellMesh.renderOrder = -2;
  shellMesh.frustumCulled = false;
  sky.add(shellMesh);

  // Stars: one instanced draw call, static, riding with the camera.
  const starRng = mulberry32(88);
  const stars = new InstancedMesh(
    new TetrahedronGeometry(1.1, 0),
    new MeshBasicMaterial({ vertexColors: false, fog: false, depthWrite: false, color: 0xffffff }),
    700,
  );
  stars.renderOrder = -1;
  stars.frustumCulled = false;
  const matrix = new Matrix4();
  const starColor = new Color();
  for (let i = 0; i < 700; i += 1) {
    const z = starRng() * 2 - 1;
    const angle = starRng() * Math.PI * 2;
    const radius = Math.sqrt(Math.max(0, 1 - z * z));
    const scale = 0.4 + starRng() * 1.5;
    matrix.makeScale(scale, scale, scale);
    matrix.setPosition(Math.cos(angle) * radius * 430, z * 430, Math.sin(angle) * radius * 430);
    stars.setMatrixAt(i, matrix);
    const warm = starRng();
    starColor.setRGB(0.6 + warm * 0.4, 0.6 + warm * 0.25, 0.8 + (1 - warm) * 0.2).multiplyScalar(0.35 + starRng() * 0.9);
    stars.setColorAt(i, starColor);
  }
  sky.add(stars);

  // Two enormous soft veils give the nebula depth without a texture.
  const veilRng = mulberry32(4242);
  for (const [radius, tint, distance] of [[260, NEBULA_MAGENTA, 420], [200, NEBULA_GOLD, 400]] as const) {
    const disc = new CircleGeometry(radius, 40);
    const discPosition = disc.getAttribute('position');
    const discColors = new Float32Array(discPosition.count * 3);
    for (let i = 0; i < discPosition.count; i += 1) {
      const r = Math.hypot(discPosition.getX(i), discPosition.getY(i)) / radius;
      const fade = (1 - MathUtils.clamp(r, 0, 1)) ** 2.2 * 0.5;
      discColors[i * 3] = tint.r * fade;
      discColors[i * 3 + 1] = tint.g * fade;
      discColors[i * 3 + 2] = tint.b * fade;
    }
    disc.setAttribute('color', new BufferAttribute(discColors, 3));
    const veil = new Mesh(
      disc,
      createAdditiveBasicMaterial({ color: 0xffffff }),
    );
    (veil.material as MeshBasicMaterial).vertexColors = true;
    (veil.material as MeshBasicMaterial).fog = false;
    veil.renderOrder = -1;
    veil.frustumCulled = false;
    const direction = new Vector3(veilRng() * 2 - 1, veilRng() * 0.6, -0.6 - veilRng() * 0.5).normalize();
    veil.position.copy(direction).multiplyScalar(distance);
    veil.lookAt(0, 0, 0);
    sky.add(veil);
  }

  return sky;
}

// ---- drifting wreckage --------------------------------------------------------

type DebrisField = { mesh: InstancedMesh; update(cameraU: number, dt: number): void };

function buildDebris(root: Group): DebrisField {
  const COUNT = 64;
  const rng = mulberry32(5150);
  const mesh = new InstancedMesh(
    new IcosahedronGeometry(1, 0),
    new MeshBasicMaterial({ color: OBSIDIAN_EDGE.clone().multiplyScalar(0.9) }),
    COUNT,
  );
  mesh.frustumCulled = false;
  mesh.userData.raildIgnoreOcclusion = true;
  root.add(mesh);

  const items = Array.from({ length: COUNT }, () => ({
    u: rng(),
    x: (rng() < 0.5 ? -1 : 1) * (26 + rng() * 130),
    y: (rng() < 0.5 ? -1 : 1) * (16 + rng() * 90),
    scale: 0.7 + rng() * 2.6,
    axis: new Vector3(rng() * 2 - 1, rng() * 2 - 1, rng() * 2 - 1).normalize(),
    rotation: new Quaternion(),
    spin: (rng() - 0.5) * 1.5,
  }));
  const matrix = new Matrix4();
  const spinQuaternion = new Quaternion();
  const scale = new Vector3();
  const aheadU = 380 / BATTLE_LENGTH;
  const behindU = 60 / BATTLE_LENGTH;

  return {
    mesh,
    update(cameraU, dt) {
      for (let i = 0; i < items.length; i += 1) {
        const item = items[i];
        if (item.u < cameraU - behindU) {
          item.u += aheadU + behindU;
          item.x = (rng() < 0.5 ? -1 : 1) * (26 + rng() * 130);
          item.y = (rng() < 0.5 ? -1 : 1) * (16 + rng() * 90);
        }
        if (item.u > cameraU + aheadU) item.u -= aheadU + behindU;
        spinQuaternion.setFromAxisAngle(item.axis, item.spin * dt);
        item.rotation.premultiply(spinQuaternion).normalize();
        railPoint(item.u, item.x, item.y, scratchVector);
        scale.setScalar(item.scale);
        matrix.compose(scratchVector, item.rotation, scale);
        mesh.setMatrixAt(i, matrix);
      }
      mesh.instanceMatrix.needsUpdate = true;
    },
  };
}

// ---- environment --------------------------------------------------------------

export function createEnvironmentInternal(scene: Scene): Environment {
  const root = new Group();
  scene.add(root);
  scene.fog = new Fog(new Color(0.07, 0.025, 0.1), 130, 470);

  const sky = buildSky(root);
  const fleet = buildFleet(root);
  const deck = buildLaunchDeck(root);
  const belly = buildBellyHull(root);
  const spine = buildFlagshipSpine(root);
  const trench = buildTrench(root);
  const debris = buildDebris(root);

  const friendlyBatteries = fleet.filter((entry) => entry.side === 'friendly').flatMap((entry) => entry.batteries);
  const enemyBatteries = fleet.filter((entry) => entry.side === 'enemy').flatMap((entry) => entry.batteries);
  const flankCruiser = fleet[5];

  let shieldUp = true;
  let shieldFlash = 0;
  let burn = 0;
  let gunIndex = 0;
  let cameraU = 0;

  const CYAN_BOLT = hdr(CYAN, 2.4);
  const CRIMSON_BOLT = hdr(CRIMSON, 2.2);

  /** One gun firing: muzzle bloom, a bolt across the battle, an impact bloom. */
  function fireGun(from: Vector3, to: Vector3, friendly: boolean, calibre: number) {
    const color = friendly ? CYAN_BOLT : CRIMSON_BOLT;
    spawnTracer(from, to, color, { width: calibre, length: 40 + calibre * 60, speed: 1100 });
    spawnFlare(from, color.clone().multiplyScalar(0.5), 14 * calibre, 0.24);
    spawnFlare(to, (friendly ? hdr(COLD_WHITE, 1.2) : hdr(MOLTEN, 1.4)).multiplyScalar(0.55), 22 * calibre, 0.5);
  }

  function pick(points: Vector3[], offset: number) {
    return points.length === 0 ? null : points[(offset >>> 0) % points.length];
  }

  /**
   * Gunnery cadence. Everything here is keyed off the beat and the current bar,
   * so the battle escalates with the arrangement: sparse trades at launch, the
   * friendly cruiser's full broadside going off overhead during the flank run,
   * the enemy warship answering above the belly, and the flagship's point
   * defence hosing the sky during the shield pass.
   */
  function onBeat(beatNumber: number, isDownbeat: boolean, runTime: number, running: boolean) {
    gunIndex += 1;
    const atBar = running ? runTime / (60 / 144 * 4) : -1;
    const camera = scratchVector2;

    // Background trades happen in attract mode too — the battle predates you.
    const distantFrom = pick(gunIndex % 2 === 0 ? friendlyBatteries : enemyBatteries, gunIndex * 7);
    const distantTo = pick(gunIndex % 2 === 0 ? enemyBatteries : friendlyBatteries, gunIndex * 13 + 5);
    if (distantFrom && distantTo) fireGun(distantFrom, distantTo, gunIndex % 2 === 0, isDownbeat ? 1.6 : 1.0);

    if (!running) return;

    if (atBar >= 3.5 && atBar < 11.5) {
      // Crossfire: bolts crossing the flight path just ahead of you.
      const lead = railPoint(MathUtils.clamp(cameraU + 0.05, 0, 1), 0, 0, camera.clone());
      for (let i = 0; i < (isDownbeat ? 3 : 1); i += 1) {
        const friendly = (gunIndex + i) % 2 === 0;
        const source = pick(friendly ? friendlyBatteries : enemyBatteries, gunIndex * 11 + i * 3);
        if (!source) continue;
        const target = lead.clone().add(new Vector3(
          Math.sin(gunIndex * 2.3 + i) * 240,
          Math.cos(gunIndex * 1.7 + i * 2) * 160,
          0,
        ));
        fireGun(source, target, friendly, 1.2);
      }
    }

    if (atBar >= 11.6 && atBar < 18.2 && flankCruiser) {
      // The broadside. The cruiser beside you empties its guns over your head,
      // one battery pair per beat, four on the downbeat.
      const shots = isDownbeat ? 4 : 2;
      const aim = pick(enemyBatteries, gunIndex * 5) ?? railPoint(1, 400, 200, new Vector3());
      for (let i = 0; i < shots; i += 1) {
        const source = flankCruiser.batteries[(gunIndex * 3 + i) % Math.max(1, flankCruiser.batteries.length)];
        if (!source) continue;
        fireGun(source, aim.clone().add(new Vector3(Math.sin(i * 2.1 + gunIndex) * 160, Math.cos(i * 1.3) * 120, 0)), true, isDownbeat ? 2.2 : 1.5);
      }
    }

    if (atBar >= 18 && atBar < 23 && isDownbeat) {
      // The warship overhead fires outward across the frame.
      const from = railPoint(MathUtils.clamp(cameraU + 0.03, 0, 1), (gunIndex % 2 === 0 ? -1 : 1) * 60, 44, new Vector3());
      const to = pick(friendlyBatteries, gunIndex * 17);
      if (to) fireGun(from, to, false, 1.8);
    }

    if (atBar >= 23 && atBar < 30) {
      // Point defence: short bright streams thrown up past the cockpit.
      for (let i = 0; i < (isDownbeat ? 4 : 2); i += 1) {
        const from = railPoint(MathUtils.clamp(cameraU + 0.02 + i * 0.004, 0, 1), (Math.sin(gunIndex * 3.1 + i * 2.2)) * 70, -34, new Vector3());
        const to = from.clone().add(new Vector3(Math.sin(gunIndex + i) * 120, 240, -160));
        fireGun(from, to, false, 0.7);
      }
    }
    void beatNumber;
  }

  function dropShield() {
    if (!shieldUp) return;
    shieldUp = false;
    shieldFlash = 1;
  }

  function killFlagship() {
    burn = Math.max(burn, 1);
    for (const entry of fleet) {
      if (entry.side !== 'enemy') continue;
      entry.burning = true;
    }
  }

  function reset() {
    shieldUp = true;
    shieldFlash = 0;
    burn = 0;
    trench.canopyMaterial.color.copy(new Color(0.5, 0.1, 0.85));
    trench.canopy.visible = true;
    for (const entry of fleet) entry.burning = false;
    for (const entry of fleet) entry.ship.hullMaterial.color.copy(entry.side === 'enemy' ? OBSIDIAN.clone() : ICE_SHADOW.clone());
  }

  function update(dt: number, context: EnvironmentContext) {
    sky.position.copy(context.camera.position);
    cameraU = context.running ? MathUtils.clamp(context.runTime > 0 ? cameraUFromCamera(context.camera) : 0, 0, 1) : 0;
    debris.update(cameraU, dt);

    // Hull seams breathe with the beat: the battle has a pulse and every ship
    // in it is on the same one.
    const pulse = 0.75 + context.beatEnergy * 0.5;
    belly.seamMaterial.color.copy(hdr(EMBER, 0.75 * pulse));
    spine.seamMaterial.color.copy(hdr(EMBER, (0.8 + burn * 1.6) * pulse));
    trench.seamMaterial.color.copy(hdr(burn > 0 ? MOLTEN : EMBER, (0.85 + burn * 2.4) * pulse));
    deck.laneMaterial.color.copy(hdr(CYAN, 0.8 * pulse));

    // Shield canopy: a slow violet crawl while it holds, a white flash and a
    // clean disappearance when the last generator goes.
    if (shieldUp) {
      const shimmer = 0.42 + 0.3 * Math.sin(context.elapsed * 2.1) + context.beatEnergy * 0.2;
      trench.canopyMaterial.color.setRGB(0.5 * shimmer, 0.1 * shimmer, 0.9 * shimmer);
      trench.canopy.visible = true;
    } else if (shieldFlash > 0) {
      shieldFlash = Math.max(0, shieldFlash - dt * 1.6);
      trench.canopyMaterial.color.setRGB(shieldFlash * 2.4, shieldFlash * 1.7, shieldFlash * 2.6);
      trench.canopy.visible = shieldFlash > 0.02;
    } else {
      trench.canopy.visible = false;
    }

    if (burn > 0) {
      burn = Math.max(0, burn - dt * 0.05);
      for (const entry of fleet) {
        if (!entry.burning) continue;
        entry.ship.hullMaterial.color.copy(OBSIDIAN).lerp(hdr(EMBER, 0.5), 0.35 + 0.25 * Math.sin(context.elapsed * 3 + entry.batteries.length));
      }
    }
  }

  function cameraUFromCamera(camera: PerspectiveCamera) {
    // The camera rides the rail, so its depth along the battle axis is enough
    // to recycle the debris field without threading run progress through.
    return MathUtils.clamp(-camera.position.z / BATTLE_LENGTH, 0, 1);
  }

  function dispose() {
    scene.fog = null;
    root.removeFromParent();
    disposeObject3D(root);
    root.clear();
  }

  return { root, update, onBeat, dropShield, killFlagship, reset, dispose };
}
