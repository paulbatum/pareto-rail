import {
  BoxGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  Group,
  IcosahedronGeometry,
  Mesh,
  MeshBasicMaterial,
  SphereGeometry,
  TorusGeometry,
  Vector3,
} from 'three';
import type { BufferGeometry } from 'three';
import { createAdditiveBasicMaterial } from '../../../engine/visual-kit';
import {
  BRASS,
  BUTTON_RED,
  CARDBOARD,
  CREAM,
  ERASER_PINK,
  GLUE,
  GLUE_SHEEN,
  hdr,
  LAMP,
  PENCIL_YELLOW,
  SPOOL_TEAL,
  WOOD,
} from './palette';

// Glue monsters: ordinary supplies stolen and stuck around a visible black
// adhesive core. Every factory records `shardSpecs` (scatter directions and
// colors for the death burst) and an `accent` used by effects and the ball's
// collection pieces.
//
// Geometries and materials are cached at module scope: enemies spawn ~90
// times a run, and the renderer uploads each unique geometry it first draws.

const glueMaterial = new MeshBasicMaterial({ color: GLUE });
const partMaterials = new Map<Color, MeshBasicMaterial>();
function materialFor(color: Color): MeshBasicMaterial {
  let material = partMaterials.get(color);
  if (!material) {
    material = new MeshBasicMaterial({ color });
    partMaterials.set(color, material);
  }
  return material;
}
const mat = {
  glue: () => glueMaterial,
  red: () => materialFor(BUTTON_RED),
  teal: () => materialFor(SPOOL_TEAL),
  cream: () => materialFor(CREAM.clone().multiplyScalar(0.72)),
  cardboard: () => materialFor(CARDBOARD),
  cardboardLight: () => materialFor(CARDBOARD.clone().lerp(new Color(0xffffff), 0.05)),
  pencil: () => materialFor(PENCIL_YELLOW),
  wood: () => materialFor(WOOD),
  woodLeg: () => materialFor(PENCIL_YELLOW.clone().lerp(WOOD, 0.35)),
  eraser: () => materialFor(ERASER_PINK),
  brass: () => materialFor(BRASS),
};

// Geometry cache: one shared instance per unique shape. Enemies spawn ~90
// times a run, and the renderer uploads each unique geometry it first draws,
// so every part shape is built exactly once.
const geometryCache = new Map<string, BufferGeometry>();
function cached(key: string, make: () => BufferGeometry): BufferGeometry {
  let geometry = geometryCache.get(key);
  if (!geometry) {
    geometry = make();
    geometryCache.set(key, geometry);
  }
  return geometry;
}
const geo = {
  beetleDome: () => cached('beetleDome', () => new SphereGeometry(0.62, 12, 8)),
  bigButton: () => cached('bigButton', () => new CylinderGeometry(0.52, 0.52, 0.16, 18)),
  buttonHole: () => cached('buttonHole', () => new CylinderGeometry(0.07, 0.07, 0.2, 8)),
  smallButton: () => cached('smallButton', () => new CylinderGeometry(0.32, 0.32, 0.13, 14)),
  spoolLeg: () => cached('spoolLeg', () => new CylinderGeometry(0.13, 0.16, 0.3, 10)),
  core: (radius: number) => cached(`core${radius}`, () => new SphereGeometry(radius, 12, 10)),
  coreGlint: (radius: number) => cached(`coreGlint${radius}`, () => new SphereGeometry(radius * 0.24, 8, 6)),
  snapperBody: () => cached('snapperBody', () => new ConeGeometry(0.42, 1.15, 4)),
  snapperWing: () => cached('snapperWing', () => new BoxGeometry(1.5, 0.07, 0.55)),
  beak: () => cached('beak', () => new ConeGeometry(0.12, 0.4, 6)),
  walkerLeg: () => cached('walkerLeg', () => new BoxGeometry(0.14, 2.3, 0.32)),
  walkerBody: () => cached('walkerBody', () => new CylinderGeometry(0.26, 0.26, 1.7, 6)),
  pencilTip: () => cached('pencilTip', () => new ConeGeometry(0.26, 0.42, 6)),
  graphite: () => cached('graphite', () => new ConeGeometry(0.11, 0.16, 6)),
  eraserCap: () => cached('eraserCap', () => new CylinderGeometry(0.24, 0.24, 0.22, 10)),
  ferrule: () => cached('ferrule', () => new CylinderGeometry(0.27, 0.27, 0.1, 10)),
  globBlob: () => cached('globBlob', () => new IcosahedronGeometry(0.4, 0)),
  globGlint: () => cached('globGlint', () => new SphereGeometry(0.1, 8, 6)),
  globHalo: () => cached('globHalo', () => new TorusGeometry(0.5, 0.02, 6, 20)),
  jarBody: () => cached('jarBody', () => new CylinderGeometry(0.34, 0.3, 0.72, 12)),
  jarLid: () => cached('jarLid', () => new CylinderGeometry(0.36, 0.36, 0.14, 12)),
  ruler: () => cached('ruler', () => new BoxGeometry(1.9, 0.09, 0.3)),
  rulerEnd: () => cached('rulerEnd', () => new BoxGeometry(0.12, 0.12, 0.34)),
  block: () => cached('block', () => new BoxGeometry(0.55, 0.55, 0.55)),
  gluePatch: () => cached('gluePatch', () => new SphereGeometry(0.2, 8, 6)),
  orbitGlint: () => cached('orbitGlint', () => new SphereGeometry(0.09, 8, 6)),
  nodeBlob: () => cached('nodeBlob', () => new IcosahedronGeometry(0.52, 0)),
  nodeRing: () => cached('nodeRing', () => new TorusGeometry(0.56, 0.035, 6, 24)),
  nodeGlint: () => cached('nodeGlint', () => new SphereGeometry(0.12, 8, 6)),
  coreHeart: () => cached('coreHeart', () => new SphereGeometry(1.55, 18, 14)),
  coreCrack: () => cached('coreCrack', () => new BoxGeometry(1.9, 0.045, 0.045)),
  coreGlintBig: () => cached('coreGlintBig', () => new SphereGeometry(0.3, 10, 8)),
};

function makeCore(radius: number): Group {
  const core = new Group();
  const body = new Mesh(geo.core(radius), mat.glue());
  // One hot specular glint sells "wet adhesive" and marks the lock point.
  const glint = new Mesh(
    geo.coreGlint(radius),
    createAdditiveBasicMaterial({ color: hdr(LAMP, 2.2) }),
  );
  glint.position.set(radius * 0.38, radius * 0.42, radius * 0.62);
  core.add(body, glint);
  core.userData.coreGlint = glint;
  return core;
}

function recordPart(group: Group, position: Vector3, color: Color, size: number) {
  const specs = (group.userData.shardSpecs ??= []) as Array<{ direction: Vector3; color: Color; size: number }>;
  specs.push({
    direction: position.lengthSq() > 0.0001 ? position.clone().normalize() : new Vector3(0, 0, 1),
    color: color.clone(),
    size,
  });
}

function addPart(
  group: Group,
  mesh: Mesh,
  position: Vector3,
  color: Color,
  size: number,
): Mesh {
  mesh.position.copy(position);
  group.add(mesh);
  recordPart(group, position, color, size);
  return mesh;
}

// ---- beetle: buttons and spools around a glue dome -------------------------

export function createBeetleMesh(): Group {
  const group = new Group();
  group.userData.shardSpecs = [];

  const dome = new Mesh(geo.beetleDome(), mat.glue());
  dome.scale.set(1.15, 0.62, 1.3);
  group.add(dome);
  recordPart(group, new Vector3(0, 0.3, 0), GLUE, 0.5);

  const bigButton = addPart(
    group,
    new Mesh(geo.bigButton(), mat.red()),
    new Vector3(0, 0.38, 0.18),
    BUTTON_RED,
    0.55,
  );
  bigButton.rotation.x = Math.PI / 2;
  for (const x of [-0.18, 0.18]) {
    const hole = new Mesh(geo.buttonHole(), mat.glue());
    hole.rotation.x = Math.PI / 2;
    hole.position.set(x, 0.38, 0.36);
    group.add(hole);
  }

  const smallButton = addPart(
    group,
    new Mesh(geo.smallButton(), mat.teal()),
    new Vector3(0, 0.3, -0.5),
    SPOOL_TEAL,
    0.4,
  );
  smallButton.rotation.x = Math.PI / 2;

  for (const side of [-1, 1]) {
    for (let leg = 0; leg < 3; leg += 1) {
      const spool = new Mesh(geo.spoolLeg(), mat.cream());
      spool.rotation.z = Math.PI / 2;
      addPart(group, spool, new Vector3(side * 0.68, -0.08, -0.42 + leg * 0.42), CREAM, 0.28);
    }
  }

  const core = makeCore(0.3);
  core.position.set(0, -0.12, 0.62);
  group.add(core);
  group.userData.core = core;
  group.userData.accent = BUTTON_RED.clone();
  group.userData.lockRingScale = 1.15;
  return group;
}

// ---- snapper: cardboard wings, clothespin beak ------------------------------

export function createSnapperMesh(): Group {
  const group = new Group();
  group.userData.shardSpecs = [];

  const body = new Mesh(geo.snapperBody(), mat.cardboard());
  body.rotation.x = -Math.PI / 2;
  body.scale.set(1, 1, 0.45);
  group.add(body);
  recordPart(group, new Vector3(0, 0, 0), CARDBOARD, 0.5);

  const wingGeometry = geo.snapperWing();
  const wingL = new Mesh(wingGeometry, mat.cardboardLight());
  wingL.position.set(-0.85, 0.12, -0.05);
  const wingR = new Mesh(wingGeometry, mat.cardboardLight());
  wingR.position.set(0.85, 0.12, -0.05);
  group.add(wingL, wingR);
  recordPart(group, new Vector3(-0.85, 0.12, 0), CARDBOARD, 0.45);
  recordPart(group, new Vector3(0.85, 0.12, 0), CARDBOARD, 0.45);

  const beakTop = new Mesh(geo.beak(), mat.red());
  beakTop.rotation.x = Math.PI / 2;
  beakTop.position.set(0, 0.08, 0.68);
  const beakBottom = new Mesh(geo.beak(), mat.red());
  beakBottom.rotation.x = Math.PI / 2;
  beakBottom.position.set(0, -0.04, 0.68);
  group.add(beakTop, beakBottom);
  recordPart(group, new Vector3(0, 0, 0.68), BUTTON_RED, 0.25);

  const core = makeCore(0.26);
  core.position.set(0, -0.16, 0.28);
  group.add(core);
  group.userData.core = core;
  group.userData.accent = CARDBOARD.clone();
  group.userData.wingL = wingL;
  group.userData.wingR = wingR;
  group.userData.lockRingScale = 1.05;
  return group;
}

// ---- walker: ruler legs and a pencil body ----------------------------------

export function createWalkerMesh(): Group {
  const group = new Group();
  group.userData.shardSpecs = [];

  const legGeometry = geo.walkerLeg();
  for (const [x, z] of [[-0.55, 0.3], [0.55, 0.3], [0, -0.65]]) {
    const leg = new Mesh(legGeometry, mat.woodLeg());
    leg.position.set(x, -1.05, z);
    leg.rotation.z = -x * 0.22;
    leg.rotation.x = z * 0.18;
    group.add(leg);
    recordPart(group, new Vector3(x, -1.05, z), PENCIL_YELLOW, 0.5);
  }

  const body = new Mesh(geo.walkerBody(), mat.pencil());
  body.rotation.z = Math.PI / 2;
  group.add(body);
  recordPart(group, new Vector3(0, 0.2, 0), PENCIL_YELLOW, 0.6);

  const tip = new Mesh(geo.pencilTip(), mat.wood());
  tip.rotation.z = -Math.PI / 2;
  tip.position.set(1.05, 0.2, 0);
  group.add(tip);
  const graphite = new Mesh(geo.graphite(), mat.glue());
  graphite.rotation.z = -Math.PI / 2;
  graphite.position.set(1.32, 0.2, 0);
  group.add(graphite);
  recordPart(group, new Vector3(1.05, 0.2, 0), WOOD, 0.3);

  const eraser = new Mesh(geo.eraserCap(), mat.eraser());
  eraser.rotation.z = Math.PI / 2;
  eraser.position.set(-1.05, 0.2, 0);
  group.add(eraser);
  recordPart(group, new Vector3(-1.05, 0.2, 0), ERASER_PINK, 0.3);

  const band = new Mesh(geo.ferrule(), mat.brass());
  band.rotation.z = Math.PI / 2;
  band.position.set(-0.86, 0.2, 0);
  group.add(band);

  const core = makeCore(0.34);
  core.position.set(-0.1, -0.35, 0.3);
  group.add(core);
  group.userData.core = core;
  group.userData.accent = PENCIL_YELLOW.clone();
  group.userData.lockRingScale = 1.35;
  return group;
}

// ---- glob: a wobbling adhesive blob (hazard) --------------------------------

export function createGlobMesh(): Group {
  const group = new Group();
  const blob = new Mesh(geo.globBlob(), mat.glue());
  const glint = new Mesh(
    geo.globGlint(),
    createAdditiveBasicMaterial({ color: hdr(LAMP, 2.4) }),
  );
  glint.position.set(0.14, 0.16, 0.26);
  const halo = new Mesh(
    geo.globHalo(),
    createAdditiveBasicMaterial({ color: hdr(BUTTON_RED, 1.4) }),
  );
  group.add(blob, glint, halo);
  group.userData.isGlob = true;
  group.userData.halo = halo;
  group.userData.accent = GLUE_SHEEN.clone().lerp(BUTTON_RED, 0.4);
  group.userData.lockRingScale = 1.0;
  return group;
}

// ---- the Spill's layers -----------------------------------------------------

export function createSpillOrbitMesh(index: number): Group {
  const group = new Group();
  group.userData.shardSpecs = [];
  const gluePatch = new Mesh(geo.gluePatch(), mat.glue());
  gluePatch.scale.set(1, 0.5, 1);

  if (index % 3 === 0) {
    // Jar: glass-ish cream cylinder with a brass lid.
    const jar = new Mesh(geo.jarBody(), materialFor(CREAM.clone().multiplyScalar(0.85)));
    const lid = new Mesh(geo.jarLid(), mat.brass());
    lid.position.y = 0.42;
    group.add(jar, lid, gluePatch);
    recordPart(group, new Vector3(0, 0, 0), CREAM, 0.5);
    recordPart(group, new Vector3(0, 0.42, 0), BRASS, 0.3);
  } else if (index % 3 === 1) {
    // Ruler: a long flat stick with a brass end.
    const ruler = new Mesh(geo.ruler(), materialFor(PENCIL_YELLOW.clone().lerp(WOOD, 0.3)));
    const end = new Mesh(geo.rulerEnd(), mat.brass());
    end.position.x = 0.95;
    group.add(ruler, end, gluePatch);
    recordPart(group, new Vector3(0, 0, 0), PENCIL_YELLOW, 0.55);
  } else {
    // Toy block.
    const block = new Mesh(geo.block(), index % 2 === 0 ? mat.red() : mat.teal());
    group.add(block, gluePatch);
    recordPart(group, new Vector3(0, 0, 0), index % 2 === 0 ? BUTTON_RED : SPOOL_TEAL, 0.45);
  }

  const glint = new Mesh(
    geo.orbitGlint(),
    createAdditiveBasicMaterial({ color: hdr(LAMP, 2.2) }),
  );
  glint.position.set(0.18, 0.22, 0.24);
  group.add(glint);
  group.userData.accent = index % 3 === 2 ? (index % 2 === 0 ? BUTTON_RED.clone() : SPOOL_TEAL.clone()) : BRASS.clone();
  group.userData.lockRingScale = 1.1;
  return group;
}

export function createSpillNodeMesh(): Group {
  const group = new Group();
  const blob = new Mesh(geo.nodeBlob(), mat.glue());
  const crackRing = new Mesh(
    geo.nodeRing(),
    createAdditiveBasicMaterial({ color: hdr(BUTTON_RED, 1.6) }),
  );
  crackRing.rotation.x = Math.PI / 2.4;
  const glint = new Mesh(
    geo.nodeGlint(),
    createAdditiveBasicMaterial({ color: hdr(LAMP, 2.4) }),
  );
  glint.position.set(0.2, 0.2, 0.34);
  group.add(blob, crackRing, glint);
  group.userData.isNode = true;
  group.userData.crackRing = crackRing;
  group.userData.accent = BUTTON_RED.clone();
  group.userData.lockRingScale = 1.1;
  return group;
}

export function createSpillCoreMesh(): Group {
  const group = new Group();
  const heart = new Mesh(geo.coreHeart(), mat.glue());
  heart.scale.set(1.1, 0.95, 0.9);
  group.add(heart);
  // A dim hot shell so the dark heart silhouettes against the room.
  const shell = new Mesh(
    geo.coreHeart(),
    createAdditiveBasicMaterial({ color: hdr(BUTTON_RED, 0.28), opacity: 0.5 }),
  );
  shell.scale.set(1.16, 1.0, 0.95);
  group.add(shell);

  // Hot cracks across the heart: they brighten as stages break.
  const cracks: Mesh[] = [];
  const crackGeometry = geo.coreCrack();
  for (let i = 0; i < 4; i += 1) {
    const crack = new Mesh(crackGeometry, createAdditiveBasicMaterial({ color: hdr(BUTTON_RED, 1.5) }));
    crack.position.setFromSphericalCoords(1.45, Math.PI / 2 + (i - 1.5) * 0.42, i * 1.7);
    crack.rotation.z = i * 0.9 + 0.4;
    crack.rotation.y = i * 0.55;
    group.add(crack);
    cracks.push(crack);
  }

  const glint = new Mesh(
    geo.coreGlintBig(),
    createAdditiveBasicMaterial({ color: hdr(LAMP, 2.2) }),
  );
  glint.position.set(0.5, 0.6, 1.1);
  group.add(glint);

  group.userData.isSpillCore = true;
  group.userData.cracks = cracks;
  group.userData.accent = BUTTON_RED.clone();
  group.userData.lockRingScale = 1.7;
  return group;
}
