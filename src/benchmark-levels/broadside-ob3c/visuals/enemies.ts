import {
  BoxGeometry,
  BufferGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  Group,
  IcosahedronGeometry,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  OctahedronGeometry,
  TorusGeometry,
  Vector3,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { createAdditiveBasicMaterial } from '../../../engine/visual-kit';
import type { ShardSpec } from './effects';
import { CRIMSON, EMBER, MOLTEN, OBSIDIAN, OBSIDIAN_LIT, hdr } from './palette';

// Every hostile in Broadside is built the same way and is therefore instantly
// legible as "theirs": a near-black obsidian body that reads as pure
// silhouette against the nebula, thin molten-orange rim strips tracing its
// leading edges, and one small crimson heat core. Nothing is a lit surface —
// the shapes are cut out of the background, and the light is on the cut.
//
// The three silhouette families are the whole vocabulary: darts are long and
// swept, ring craft are circular, and rooted hardware is blocky and mounted.
// Motion follows the same split (see gameplay.ts), so shape and behaviour
// always agree.

export type TintPart = { material: MeshBasicMaterial; base: Color; kind: 'fill' | 'edge' | 'core' };

type Build = {
  group: Group;
  parts: TintPart[];
  shards: ShardSpec[];
};

function start(): Build {
  return { group: new Group(), parts: [], shards: [] };
}

function body(build: Build, geometry: BufferGeometry, tone = OBSIDIAN) {
  const material = new MeshBasicMaterial({ color: tone.clone() });
  const mesh = new Mesh(geometry, material);
  build.group.add(mesh);
  build.parts.push({ material, base: tone.clone(), kind: 'fill' });
  return mesh;
}

/** Thin emissive strips merged into one draw call — the rim light on a silhouette. */
function rim(build: Build, geometries: BufferGeometry[], tone = MOLTEN, intensity = 1.15) {
  if (geometries.length === 0) return null;
  const material = createAdditiveBasicMaterial({ color: hdr(tone, intensity) });
  const mesh = new Mesh(mergeGeometries(geometries), material);
  for (const geometry of geometries) geometry.dispose();
  build.group.add(mesh);
  build.parts.push({ material, base: hdr(tone, intensity), kind: 'edge' });
  return mesh;
}

function core(build: Build, geometry: BufferGeometry, tone = CRIMSON, intensity = 1.6) {
  const material = new MeshBasicMaterial({ color: hdr(tone, intensity) });
  const mesh = new Mesh(geometry, material);
  build.group.add(mesh);
  build.parts.push({ material, base: hdr(tone, intensity), kind: 'core' });
  return mesh;
}

const at = (geometry: BufferGeometry, x: number, y: number, z: number) =>
  geometry.applyMatrix4(new Matrix4().makeTranslation(x, y, z));

function shardsFrom(build: Build, directions: Array<[number, number, number]>, tone: Color, size: number) {
  for (const [x, y, z] of directions) {
    build.shards.push({ direction: new Vector3(x, y, z).normalize(), color: tone.clone(), size });
  }
}

function finish(build: Build, kind: string, accent: Color, lockRingScale: number) {
  build.group.userData.parts = build.parts;
  build.group.userData.shardSpecs = build.shards;
  build.group.userData.accent = accent.clone();
  build.group.userData.lockRingScale = lockRingScale;
  build.group.userData.kind = kind;
  return build.group;
}

// ---- swarm craft -----------------------------------------------------------------

/**
 * Interceptor — the swarm dart. A needle nose, hard forward-swept wings, twin
 * crimson exhausts. Longer than it is wide, so a rank of them crossing the
 * frame reads as a row of slashes.
 */
export function createInterceptorMesh() {
  const build = start();

  const nose = new ConeGeometry(0.4, 1.7, 4, 1);
  nose.rotateX(Math.PI / 2);
  at(nose, 0, 0, 1.1);
  body(build, nose);
  body(build, at(new BoxGeometry(0.52, 0.34, 1.6), 0, 0, -0.1), OBSIDIAN_LIT);

  const wing = (side: number) => {
    const geometry = new BoxGeometry(1.5, 0.09, 0.72);
    geometry.rotateY(side * -0.5);
    geometry.rotateZ(side * 0.16);
    return at(geometry, side * 0.85, -0.02, -0.15);
  };
  body(build, wing(1), OBSIDIAN);
  body(build, wing(-1), OBSIDIAN);

  const edges: BufferGeometry[] = [];
  for (const side of [1, -1]) {
    const strip = new BoxGeometry(1.5, 0.06, 0.1);
    strip.rotateY(side * -0.5);
    strip.rotateZ(side * 0.16);
    edges.push(at(strip, side * 0.85, 0.03, 0.2));
  }
  edges.push(at(new BoxGeometry(0.07, 0.07, 1.9), 0, 0.19, 0.35));
  rim(build, edges, MOLTEN, 1.25);

  for (const side of [1, -1]) {
    core(build, at(new IcosahedronGeometry(0.15, 0), side * 0.26, 0, -0.98), CRIMSON, 1.9);
  }

  shardsFrom(build, [[1, 0.2, 0.3], [-1, 0.2, 0.3], [0, 0.6, 1], [0, -0.5, -0.8], [0.5, -0.4, 0.2]], EMBER, 0.3);
  return finish(build, 'interceptor', MOLTEN, 1.05);
}

/**
 * Corsair — a ring-wing craft. The whole silhouette is a circle with a spike
 * through it, so it never gets confused with a dart even at a glance, and the
 * ring makes its corkscrew read as roll rather than drift.
 */
export function createCorsairMesh() {
  const ring = new TorusGeometry(1.15, 0.13, 6, 20);
  const build = start();
  body(build, ring, OBSIDIAN_LIT);

  const spike = new ConeGeometry(0.26, 2.1, 5, 1);
  spike.rotateX(Math.PI / 2);
  body(build, at(spike, 0, 0, 0.55));

  const struts: BufferGeometry[] = [];
  for (let i = 0; i < 3; i += 1) {
    const angle = (i / 3) * Math.PI * 2;
    const strut = new BoxGeometry(1.1, 0.08, 0.08);
    strut.rotateZ(angle);
    struts.push(at(strut, Math.cos(angle) * 0.6, Math.sin(angle) * 0.6, 0));
  }
  body(build, mergeGeometries(struts), OBSIDIAN);
  for (const geometry of struts) geometry.dispose();

  const inner = new TorusGeometry(1.02, 0.045, 5, 24);
  rim(build, [inner], MOLTEN, 1.35);

  core(build, new IcosahedronGeometry(0.3, 0), CRIMSON, 1.75);
  shardsFrom(build, [[1, 0, 0], [-0.5, 0.87, 0], [-0.5, -0.87, 0], [0, 0, 1], [0.7, 0.7, -0.4]], EMBER, 0.34);
  return finish(build, 'corsair', MOLTEN, 1.25);
}

/**
 * Lance — a two-hit gunship. Wide, flat, and slabbed, with two long outrigger
 * barrels: the widest hostile silhouette in the level, and the only one that
 * telegraphs a shot from a lamp on its centreline.
 */
export function createLanceMesh() {
  const build = start();
  body(build, new BoxGeometry(1.7, 0.78, 2.0), OBSIDIAN_LIT);
  body(build, at(new BoxGeometry(0.9, 0.5, 0.9), 0, 0, 1.3), OBSIDIAN);

  for (const side of [1, -1]) {
    body(build, at(new BoxGeometry(0.34, 0.34, 3.1), side * 1.25, -0.1, 0.5), OBSIDIAN);
    body(build, at(new BoxGeometry(0.6, 0.16, 0.9), side * 0.95, -0.1, -0.4), OBSIDIAN_LIT);
  }

  const edges: BufferGeometry[] = [];
  edges.push(at(new BoxGeometry(1.74, 0.07, 0.07), 0, 0.4, 0.95));
  edges.push(at(new BoxGeometry(1.74, 0.07, 0.07), 0, -0.4, 0.95));
  for (const side of [1, -1]) {
    edges.push(at(new BoxGeometry(0.09, 0.09, 3.1), side * 1.25, 0.16, 0.5));
  }
  rim(build, edges, MOLTEN, 1.1);

  const lamp = core(build, at(new IcosahedronGeometry(0.24, 0), 0, 0.22, 1.62), CRIMSON, 1.5);
  build.group.userData.chargeLamp = lamp.material as MeshBasicMaterial;

  for (const side of [1, -1]) {
    core(build, at(new IcosahedronGeometry(0.13, 0), side * 1.25, -0.1, 2.05), MOLTEN, 1.6);
  }

  shardsFrom(build, [[1, 0.1, 0], [-1, 0.1, 0], [0, 1, 0.2], [0, -1, 0.2], [0.6, 0, 1], [-0.6, 0, -1]], EMBER, 0.42);
  return finish(build, 'lance', CRIMSON, 1.35);
}

/**
 * Turret — a barbette hanging off a hull. Its collar and mount plate are
 * always visible behind the guns, which is the whole point: it is not flying,
 * it is bolted to the ship above you.
 */
export function createTurretMesh() {
  const build = start();

  const collar = new CylinderGeometry(1.0, 1.2, 0.55, 10, 1);
  collar.rotateX(Math.PI / 2);
  body(build, at(collar, 0, 0, -0.95), OBSIDIAN_LIT);
  body(build, at(new BoxGeometry(2.1, 2.1, 0.22), 0, 0, -1.32), OBSIDIAN);

  const dome = new IcosahedronGeometry(0.86, 1);
  body(build, at(dome, 0, 0, -0.2), OBSIDIAN);

  for (const side of [1, -1]) {
    body(build, at(new BoxGeometry(0.24, 0.24, 1.9), side * 0.34, 0.05, 0.85), OBSIDIAN_LIT);
  }

  const edges: BufferGeometry[] = [];
  const collarRing = new TorusGeometry(1.02, 0.05, 5, 18);
  edges.push(at(collarRing, 0, 0, -0.68));
  for (const side of [1, -1]) {
    edges.push(at(new BoxGeometry(0.07, 0.07, 1.9), side * 0.34, 0.2, 0.85));
  }
  rim(build, edges, MOLTEN, 1.2);

  const lamp = core(build, at(new IcosahedronGeometry(0.2, 0), 0, -0.3, 0.5), CRIMSON, 1.5);
  build.group.userData.chargeLamp = lamp.material as MeshBasicMaterial;
  for (const side of [1, -1]) {
    core(build, at(new IcosahedronGeometry(0.11, 0), side * 0.34, 0.05, 1.82), CRIMSON, 1.7);
  }

  shardsFrom(build, [[1, 0.3, 0.4], [-1, 0.3, 0.4], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0.5, -0.5, -0.5]], EMBER, 0.4);
  return finish(build, 'turret', CRIMSON, 1.3);
}

/**
 * Escort — a flat arrowhead. It is met head-on, so it is designed to read as a
 * triangle first: wide, thin, with two wingtip lamps and a hot canopy bar.
 */
export function createEscortMesh() {
  const build = start();

  const plate = new ConeGeometry(1.5, 2.4, 3, 1);
  plate.rotateX(-Math.PI / 2);
  plate.scale(1, 0.22, 1);
  plate.rotateZ(Math.PI);
  body(build, at(plate, 0, 0, 0.1), OBSIDIAN);
  body(build, at(new BoxGeometry(0.5, 0.42, 1.5), 0, 0.1, -0.2), OBSIDIAN_LIT);

  const edges: BufferGeometry[] = [];
  for (const side of [1, -1]) {
    const leading = new BoxGeometry(1.75, 0.07, 0.09);
    leading.rotateY(side * 0.62);
    edges.push(at(leading, side * 0.72, 0.06, -0.32));
  }
  edges.push(at(new BoxGeometry(0.5, 0.08, 0.08), 0, 0.32, -0.1));
  rim(build, edges, MOLTEN, 1.3);

  for (const side of [1, -1]) {
    core(build, at(new IcosahedronGeometry(0.16, 0), side * 1.28, 0.02, -0.85), CRIMSON, 1.9);
  }
  core(build, at(new BoxGeometry(0.34, 0.1, 0.5), 0, 0.28, 0.15), MOLTEN, 1.5);

  shardsFrom(build, [[1, 0.1, -0.4], [-1, 0.1, -0.4], [0, 0.4, 1], [0, -0.6, 0], [0.4, 0.2, -1]], EMBER, 0.36);
  return finish(build, 'escort', CRIMSON, 1.15);
}

/** Point-defence round. Crimson, lance-shaped, with a long tail so its heading is obvious. */
export function createBoltMesh() {
  const build = start();
  const head = new OctahedronGeometry(0.4, 0);
  head.scale(0.5, 0.5, 2.1);
  core(build, head, CRIMSON, 2.4);
  const shell = new OctahedronGeometry(0.62, 0);
  shell.scale(0.55, 0.55, 1.7);
  const shellMaterial = createAdditiveBasicMaterial({ color: hdr(EMBER, 1.1), opacity: 0.6 });
  build.group.add(new Mesh(shell, shellMaterial));
  build.parts.push({ material: shellMaterial, base: hdr(EMBER, 1.1), kind: 'edge' });
  const tail = new ConeGeometry(0.2, 1.4, 4, 1);
  tail.rotateX(-Math.PI / 2);
  core(build, at(tail, 0, 0, -1.1), EMBER, 1.2);
  build.group.userData.isHostileShot = true;
  build.group.userData.trailColor = CRIMSON.clone().multiplyScalar(0.85);
  shardsFrom(build, [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0]], CRIMSON, 0.2);
  return finish(build, 'bolt', CRIMSON, 0.8);
}

// ---- the enemy flagship's hardware --------------------------------------------------

/**
 * Shield generator — a live coil clamped inside four armour blocks, on a pylon
 * that stands it off the flagship's plating. The blocks leave a cross of open
 * slots, so you can see the thing is running before you can hurt it. One lock
 * blows the clamp off and the coil is bare and spinning hard; two more and one
 * fifth of her shield goes with it.
 */
export function createGeneratorMesh() {
  const build = start();

  // Pylon runs out to starboard, back toward the plating it is bolted to.
  body(build, at(new BoxGeometry(5.0, 0.8, 0.8), 3.2, 0, 0), OBSIDIAN_LIT);
  body(build, at(new BoxGeometry(1.1, 2.6, 2.6), 5.6, 0, 0), OBSIDIAN);

  const coil = new Group();
  const coilMaterial = createAdditiveBasicMaterial({ color: hdr(MOLTEN, 1.2) });
  for (const [radius, offset] of [[1.3, 0], [1.05, 0.62], [1.05, -0.62]] as const) {
    const ring = new Mesh(new TorusGeometry(radius, 0.14, 6, 20), coilMaterial);
    ring.rotation.y = Math.PI / 2;
    ring.position.x = offset;
    coil.add(ring);
  }
  const coilCoreMaterial = new MeshBasicMaterial({ color: hdr(CRIMSON, 1.4) });
  const coilCore = new Mesh(new IcosahedronGeometry(0.6, 1), coilCoreMaterial);
  coilCore.scale.x = 1.6;
  coil.add(coilCore);
  build.group.add(coil);
  build.parts.push({ material: coilMaterial, base: hdr(MOLTEN, 1.2), kind: 'edge' });
  build.parts.push({ material: coilCoreMaterial, base: hdr(CRIMSON, 1.4), kind: 'core' });

  // The clamp: four heavy blocks on the diagonals, so the cardinal gaps between
  // them read as slots of light rather than as a solid drum.
  const clamp = new Group();
  const clampMaterial = new MeshBasicMaterial({ color: OBSIDIAN_LIT.clone() });
  const lipMaterial = createAdditiveBasicMaterial({ color: hdr(MOLTEN, 1.3) });
  build.parts.push({ material: clampMaterial, base: OBSIDIAN_LIT.clone(), kind: 'fill' });
  build.parts.push({ material: lipMaterial, base: hdr(MOLTEN, 1.3), kind: 'edge' });
  for (let i = 0; i < 4; i += 1) {
    const angle = Math.PI / 4 + (i / 4) * Math.PI * 2;
    const block = new Mesh(new BoxGeometry(3.0, 0.95, 1.5), clampMaterial);
    block.position.set(0, Math.cos(angle) * 1.55, Math.sin(angle) * 1.55);
    block.rotation.x = -angle;
    clamp.add(block);

    const lip = new Mesh(new BoxGeometry(0.12, 1.0, 1.55), lipMaterial);
    lip.position.set(1.5, Math.cos(angle) * 1.62, Math.sin(angle) * 1.62);
    lip.rotation.x = -angle;
    clamp.add(lip);
  }
  // End collars tie the four blocks into one machine.
  for (const x of [1.62, -1.62]) {
    const collar = new Mesh(new TorusGeometry(1.72, 0.13, 5, 4), clampMaterial);
    collar.rotation.set(0, Math.PI / 2, Math.PI / 4);
    collar.position.x = x;
    clamp.add(collar);
  }
  build.group.add(clamp);
  build.group.userData.cowl = clamp;
  build.group.userData.coil = coil;
  build.group.userData.coilMaterial = coilMaterial;

  shardsFrom(build, [[0, 1, 0.3], [0, -1, 0.3], [0, 0.6, 1], [0, 0.6, -1], [-1, 0.2, 0], [0, -0.8, -0.9]], EMBER, 0.7);
  return finish(build, 'generator', MOLTEN, 2.3);
}

/**
 * Power core — the thing at the bottom of the trench. A strut cage over a
 * molten sphere, wearing two heavy shroud plates until the first stage of
 * armour is off. Physically the largest target in the level.
 */
export function createCoreMesh() {
  const build = start();

  body(build, new BoxGeometry(3.2, 1.0, 3.2), OBSIDIAN_LIT);
  const struts: BufferGeometry[] = [];
  for (const [x, y] of [[1, 1], [1, -1], [-1, 1], [-1, -1]] as const) {
    struts.push(at(new BoxGeometry(0.3, 0.3, 3.6), x * 1.4, y * 1.4, 0));
  }
  body(build, mergeGeometries(struts), OBSIDIAN);
  for (const geometry of struts) geometry.dispose();

  const sphereMaterial = new MeshBasicMaterial({ color: hdr(MOLTEN, 1.45) });
  const sphere = new Mesh(new IcosahedronGeometry(1.35, 2), sphereMaterial);
  build.group.add(sphere);
  build.parts.push({ material: sphereMaterial, base: hdr(MOLTEN, 1.45), kind: 'core' });
  build.group.userData.coreSphere = sphere;
  build.group.userData.coreMaterial = sphereMaterial;

  const cage = new TorusGeometry(1.75, 0.09, 6, 24);
  const cageMaterial = createAdditiveBasicMaterial({ color: hdr(CRIMSON, 1.2) });
  for (const rotation of [0, Math.PI / 2]) {
    const hoop = new Mesh(cage, cageMaterial);
    hoop.rotation.y = rotation;
    build.group.add(hoop);
  }
  build.parts.push({ material: cageMaterial, base: hdr(CRIMSON, 1.2), kind: 'edge' });

  const shroud = new Group();
  for (const side of [1, -1]) {
    const plateMaterial = new MeshBasicMaterial({ color: OBSIDIAN.clone() });
    const plate = new Mesh(new BoxGeometry(0.34, 3.4, 3.4), plateMaterial);
    plate.position.x = side * 1.85;
    shroud.add(plate);
    build.parts.push({ material: plateMaterial, base: OBSIDIAN.clone(), kind: 'fill' });

    const lipMaterial = createAdditiveBasicMaterial({ color: hdr(MOLTEN, 1.0) });
    const lip = new Mesh(new BoxGeometry(0.1, 3.5, 0.1), lipMaterial);
    lip.position.set(side * 1.85, 0, 1.7);
    shroud.add(lip);
    build.parts.push({ material: lipMaterial, base: hdr(MOLTEN, 1.0), kind: 'edge' });
  }
  build.group.add(shroud);
  build.group.userData.shroud = shroud;

  shardsFrom(build, [
    [1, 0.2, 0], [-1, 0.2, 0], [0, 1, 0.4], [0, -1, 0.4],
    [0.7, 0.7, 0.7], [-0.7, -0.7, 0.7], [0, 0, 1], [0, 0, -1],
  ], EMBER, 0.95);
  return finish(build, 'core', MOLTEN, 2.6);
}

// ---- armour breaks -------------------------------------------------------------------

/** Stage one on a generator: the cowl hinges open and burns off, baring the coil. */
export function breakGeneratorCowl(mesh: Group) {
  const cowl = mesh.userData.cowl as Group | undefined;
  if (!cowl || cowl.userData.broken) return;
  cowl.userData.broken = true;
  cowl.visible = false;
  const coilMaterial = mesh.userData.coilMaterial as MeshBasicMaterial | undefined;
  if (coilMaterial) coilMaterial.color.copy(hdr(MOLTEN, 2.4));
  mesh.userData.bare = true;
}

/** Stage one on a power core: the shroud plates blow off and the sphere runs open. */
export function breakCoreShroud(mesh: Group) {
  const shroud = mesh.userData.shroud as Group | undefined;
  if (!shroud || shroud.userData.broken) return;
  shroud.userData.broken = true;
  shroud.visible = false;
  const coreMaterial = mesh.userData.coreMaterial as MeshBasicMaterial | undefined;
  if (coreMaterial) coreMaterial.color.copy(hdr(MOLTEN, 2.6));
  mesh.userData.bare = true;
}

/** Per-frame life for the flagship's machinery: coils turn, cores breathe. */
export function updateFlagshipHardware(mesh: Group, elapsed: number) {
  const coil = mesh.userData.coil as Group | undefined;
  if (coil) coil.rotation.x = elapsed * (mesh.userData.bare ? 7.5 : 2.4);
  const sphere = mesh.userData.coreSphere as Mesh | undefined;
  if (sphere) {
    const pulse = 1 + Math.sin(elapsed * (mesh.userData.bare ? 9 : 3.4)) * (mesh.userData.bare ? 0.13 : 0.05);
    sphere.scale.setScalar(pulse);
    sphere.rotation.y = elapsed * 0.8;
  }
}
