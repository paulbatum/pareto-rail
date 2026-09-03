import {
  BoxGeometry,
  BufferGeometry,
  Color,
  ConeGeometry,
  DoubleSide,
  EdgesGeometry,
  Fog,
  Group,
  HemisphereLight,
  IcosahedronGeometry,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  OctahedronGeometry,
  PlaneGeometry,
  PointLight,
  RingGeometry,
  Scene,
  SphereGeometry,
  TorusGeometry,
  Vector3,
} from 'three';
import type { Camera } from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { CameraFeelRig } from '../../../engine/camera-feel';
import { colorForLockCount } from '../../../engine/locks';
import { glyphOnCells } from '../../../engine/glyphs';
import type { EventBus } from '../../../events';
import {
  additiveMaterialParameters,
  configureAdditiveMaterial,
  createAdditiveBasicMaterial,
  createAdornmentSlot,
  createPendingVisualRecords,
  createTransientEffectPool,
} from '../../../engine/visual-kit';

// Vespers palette: the glass is the only saturated thing in the frame.
// Deep cobalt, blood red, bottle green, gold — jewel light in a black room.
export const JEWELS = [
  new Color(0.15, 0.3, 1.0), // cobalt
  new Color(0.85, 0.08, 0.14), // blood red
  new Color(0.08, 0.65, 0.32), // bottle green
  new Color(1.0, 0.62, 0.1), // gold
];
const GOLD = new Color(0.85, 0.62, 0.25);
const BONE = new Color(0.92, 0.85, 0.7);
const STONE = new Color(0.008, 0.008, 0.012);
const BLACK = new Color(0.010, 0.010, 0.016);

export function hdr(color: Color, scale: number) {
  return color.clone().multiplyScalar(scale);
}

export type VisualContext = {
  scene: Scene;
  camera: Camera;
  feel: CameraFeelRig;
  elapsed: number;
  runProgress?: number;
};

type EnemyRecord = { mesh: Group; bornAt: number | null; lockRing: Group | null };
type ProjectileRecord = { mesh: Object3D };

let elapsedNow = 0;
let beatEnergy = 0;
let roseIgnited = false;

const lockRings = createAdornmentSlot<EnemyRecord, Group>({
  get: (r) => r.lockRing,
  set: (r, ring) => {
    r.lockRing = ring;
  },
});

const enemyRecords = createPendingVisualRecords<Group, EnemyRecord>({
  createRecord: (mesh) => ({ mesh, bornAt: null, lockRing: null }),
  disposeRecord: (record) => lockRings.detach(record),
});
const projectileRecords = createPendingVisualRecords<ProjectileRecord, ProjectileRecord>({
  createRecord: (record) => record,
});

// ---- transient rings & sparks ----------------------------------------------
type RingFx = { age: number; life: number; mesh: Mesh };
type SparkFx = { age: number; life: number; mesh: Mesh; velocity: Vector3 };
let fxScene: Scene | null = null;

const ringPool = createTransientEffectPool<RingFx>({
  update(effect, progress, _dt) {
    effect.mesh.scale.setScalar(1 + progress * 4.2);
    (effect.mesh.material as MeshBasicMaterial).opacity = 0.85 * (1 - progress);
  },
  dispose(effect) {
    effect.mesh.removeFromParent();
    effect.mesh.geometry.dispose();
    (effect.mesh.material as MeshBasicMaterial).dispose();
  },
});

const sparkPool = createTransientEffectPool<SparkFx>({
  update(effect, progress, dt) {
    effect.mesh.position.addScaledVector(effect.velocity, dt);
    effect.velocity.multiplyScalar(1 - dt * 1.6);
    (effect.mesh.material as MeshBasicMaterial).opacity = 1 - progress;
    effect.mesh.scale.setScalar(Math.max(0.01, 1 - progress));
  },
  dispose(effect) {
    effect.mesh.removeFromParent();
    effect.mesh.geometry.dispose();
    (effect.mesh.material as MeshBasicMaterial).dispose();
  },
});

export function spawnRing(at: Vector3, color: Color, size: number, life: number) {
  if (!fxScene) return;
  const mesh = new Mesh(
    new RingGeometry(0.8, 0.88, 40),
    createAdditiveBasicMaterial({ color, side: DoubleSide }),
  );
  (mesh.material as MeshBasicMaterial).opacity = 0.85;
  mesh.position.copy(at);
  mesh.scale.setScalar(size * 0.4);
  fxScene.add(mesh);
  ringPool.add({ age: 0, life, mesh });
}

function burstSparks(at: Vector3, color: Color, count: number, speed: number, life = 0.7) {
  if (!fxScene) return;
  for (let i = 0; i < count; i += 1) {
    const mesh = new Mesh(
      new PlaneGeometry(0.16, 0.16),
      createAdditiveBasicMaterial({ color: hdr(color, 1.6), side: DoubleSide }),
    );
    mesh.position.copy(at);
    fxScene.add(mesh);
    const dir = new Vector3((Math.random() - 0.5) * 2, (Math.random() - 0.5) * 2, (Math.random() - 0.5) * 2);
    if (dir.lengthSq() < 0.001) dir.set(0, 1, 0);
    sparkPool.add({ age: 0, life: life * (0.6 + Math.random() * 0.7), mesh, velocity: dir.normalize().multiplyScalar(speed * (0.5 + Math.random())) });
  }
}

// ---- environment: the nave ---------------------------------------------------
type WindowState = { mesh: Mesh; material: MeshBasicMaterial; edge: LineBasicMaterial; color: Color; lit: boolean };
const windows: WindowState[] = [];
let roseSegments: MeshBasicMaterial[] = [];
let roseRing: MeshBasicMaterial | null = null;
let candleLights: PointLight[] = [];
let naveLight: PointLight | null = null;
let candleMaterial: MeshBasicMaterial | null = null;
let moteMaterial: MeshBasicMaterial | null = null;
let moteVeil: Mesh | null = null;
let roseGroup: Group | null = null;
const WINDOW_COUNT = 28;

function jewelFor(index: number) {
  return JEWELS[((index % JEWELS.length) + JEWELS.length) % JEWELS.length];
}

export function createEnvironment(scene: Scene) {
  fxScene = scene;
  scene.fog = new Fog(0x020208, 18, 120);
  scene.add(new HemisphereLight(0x2a2a44, 0x050505, 0.55));

  naveLight = new PointLight(0xffc873, 60, 90, 1.6);
  naveLight.position.set(0, 6, -10);
  scene.add(naveLight);

  // Stonework merged into two draw calls: black piers, arches, galleries,
  // vault ribs, window mullions and floor share two materials.
  const stoneMat = new MeshBasicMaterial({ color: STONE });
  const darkMat = new MeshBasicMaterial({ color: BLACK });
  const stoneGeos: BufferGeometry[] = [];
  const darkGeos: BufferGeometry[] = [];
  const place = (geo: BufferGeometry, list: BufferGeometry[], x: number, y: number, z: number, ry = 0) => {
    if (ry !== 0) geo.rotateY(ry);
    geo.translate(x, y, z);
    list.push(geo);
  };
  for (let i = 0; i < 16; i += 1) {
    const z = -8 - i * 21;
    for (const side of [-1, 1]) {
      place(new BoxGeometry(1.8, 26, 2), stoneGeos, side * 19, 8, z);
      place(new TorusGeometry(5.2, 0.55, 6, 14, Math.PI), stoneGeos, side * 12, 16.5, z, Math.PI / 2);
      place(new BoxGeometry(4.5, 3.2, 8), darkGeos, side * 19, 19.5, z - 8);
    }
    place(new TorusGeometry(13, 0.4, 6, 20, Math.PI), stoneGeos, 0, 8, z - 10);
  }
  const floorGeo = new PlaneGeometry(30, 360);
  floorGeo.rotateX(-Math.PI / 2);
  floorGeo.translate(0, -10.5, -170);
  darkGeos.push(floorGeo);
  const stoneMesh = new Mesh(mergeAll(stoneGeos), stoneMat);
  stoneMesh.name = 'vespers-stone';
  const darkMesh = new Mesh(mergeAll(darkGeos), darkMat);
  darkMesh.name = 'vespers-dark';
  scene.add(stoneMesh, darkMesh);

  // Candle floor far below: a sea of warm pinpricks in a single draw call.
  // The whole sea breathes together instead of per-candle flicker.
  const candleGeos: BufferGeometry[] = [];
  for (let i = 0; i < 260; i += 1) {
    const g = new PlaneGeometry(0.22, 0.5);
    g.translate((Math.random() - 0.5) * 22, -9 + Math.random() * 1.5, -Math.random() * 340);
    candleGeos.push(g);
  }
  candleMaterial = createAdditiveBasicMaterial({ color: hdr(new Color(1, 0.62, 0.2), 0.95), side: DoubleSide });
  const candles = new Mesh(mergeAll(candleGeos), candleMaterial);
  candles.name = 'vespers-candles';
  scene.add(candles);

  // Stained-glass windows: tall lancets on both walls. The first few burn;
  // the rest start dead — kills win them back one by one.
  windows.length = 0;
  const mullionGeos: BufferGeometry[] = [];
  const winGeo = new PlaneGeometry(2.6, 7);
  const traceryGeo = new EdgesGeometry(winGeo);
  for (let i = 0; i < WINDOW_COUNT; i += 1) {
    const side = i % 2 === 0 ? -1 : 1;
    const z = -26 - Math.floor(i / 2) * 22;
    const color = jewelFor(i);
    const lit = i < 4;
    const material = lit
      ? createAdditiveBasicMaterial({ color: hdr(color, 0.55), side: DoubleSide })
      : new MeshBasicMaterial({ color: new Color(0.004, 0.004, 0.007), side: DoubleSide });
    const mesh = new Mesh(winGeo, material);
    mesh.position.set(side * 16.5, 8.5, z);
    mesh.rotation.y = -side * Math.PI / 2;
    scene.add(mesh);
    const edge = new LineBasicMaterial({ color: lit ? hdr(color, 0.9) : new Color(0.02, 0.02, 0.03) });
    const lines = new LineSegments(traceryGeo, edge);
    lines.position.copy(mesh.position);
    lines.rotation.copy(mesh.rotation);
    // Mullion cross, merged into the dark stonework batch via a static list.
    const mullion = new BoxGeometry(0.12, 7, 0.06);
    mullion.rotateY(-side * Math.PI / 2);
    mullion.translate(side * 16.5, 8.5, z);
    const crossbar = new BoxGeometry(2.6, 0.12, 0.06);
    crossbar.rotateY(-side * Math.PI / 2);
    crossbar.translate(side * 16.5, 8, z);
    mullionGeos.push(mullion, crossbar);
    scene.add(mesh, lines);
    windows.push({ mesh, material: material as MeshBasicMaterial, edge, color: color.clone(), lit });
  }
  const mullions = new Mesh(mergeAll(mullionGeos), darkMat);
  mullions.name = 'vespers-mullions';
  scene.add(mullions);

  // The dead rose window at the west end: a dark wheel holding every colour.
  const rose = new Group();
  rose.position.set(0, 4, -365);
  roseSegments = [];
  for (let i = 0; i < 12; i += 1) {
    const segMat = new MeshBasicMaterial({ color: new Color(0.003, 0.003, 0.005), side: DoubleSide });
    const seg = new Mesh(new PlaneGeometry(2.2, 5.2), segMat);
    const a = (i / 12) * Math.PI * 2;
    seg.position.set(Math.cos(a) * 3.4, Math.sin(a) * 3.4, 0);
    seg.rotation.z = a + Math.PI / 2;
    rose.add(seg);
    roseSegments.push(segMat);
  }
  roseRing = new MeshBasicMaterial({ color: new Color(0.015, 0.015, 0.02) });
  const ring = new Mesh(new TorusGeometry(7.2, 0.5, 8, 40), roseRing);
  rose.add(ring);
  const hubMat = new MeshBasicMaterial({ color: new Color(0.003, 0.003, 0.005) });
  const hub = new Mesh(new SphereGeometry(1.6, 12, 10), hubMat);
  hub.position.z = 1;
  rose.add(hub);
  rose.userData.hubMaterial = hubMat;
  rose.userData.isRose = true;
  roseGroup = rose;
  scene.add(rose);

  // A few drifting dust motes catch the jewel light — one merged veil that
  // breathes as a whole instead of sixty separate sprites.
  const moteGeos: BufferGeometry[] = [];
  for (let i = 0; i < 60; i += 1) {
    const g = new PlaneGeometry(0.08, 0.08);
    g.translate((Math.random() - 0.5) * 20, Math.random() * 14 - 4, -Math.random() * 330);
    moteGeos.push(g);
  }
  moteMaterial = createAdditiveBasicMaterial({ color: hdr(GOLD, 0.35), side: DoubleSide });
  moteVeil = new Mesh(mergeAll(moteGeos), moteMaterial);
  moteVeil.name = 'vespers-motes';
  scene.add(moteVeil);

  candleLights = [];
  for (const z of [-40, -140, -240]) {
    const light = new PointLight(0xff9a3c, 120, 110, 1.8);
    light.position.set(0, -6, z);
    scene.add(light);
    candleLights.push(light);
  }

  roseIgnited = false;
  return rose;
}

function relightWindow(colorIndex: number) {
  const next = windows.find((w) => !w.lit);
  if (!next) return;
  next.lit = true;
  const color = jewelFor(colorIndex);
  next.color.copy(color);
  const relit = createAdditiveBasicMaterial({ color: hdr(color, 0.55), side: DoubleSide });
  next.mesh.material = relit;
  next.material = relit;
  next.edge.color.copy(hdr(color, 0.9));
  if (naveLight) naveLight.color.copy(naveLight.color.lerp(color, 0.12));
}

function igniteRose() {
  roseIgnited = true;
  roseSegments.forEach((mat, i) => {
    mat.color.copy(hdr(jewelFor(i), 1.2));
  });
  roseRing?.color.setRGB(1.4, 1.0, 0.5);
  for (const w of windows) {
    if (!w.lit) {
      w.lit = true;
      w.material.color.copy(hdr(w.color, 0.55));
      w.edge.color.copy(hdr(w.color, 0.9));
    } else {
      w.material.color.copy(hdr(w.color, 1.0));
    }
  }
}

// ---- enemies: flat black shapes with a stolen pane burning in the chest ----
const blackMat = () => new MeshBasicMaterial({ color: BLACK, side: DoubleSide });
const jewelMat = (color: Color, scale = 2.2) =>
  createAdditiveBasicMaterial({ color: hdr(color, scale), side: DoubleSide });

function dimEdges(geo: BufferGeometry, color: Color, scale: number) {
  const lines = new LineSegments(new EdgesGeometry(geo, 30), new LineBasicMaterial({ color: hdr(color, scale) }));
  geo.dispose();
  return lines;
}

function chestGem(color: Color, size: number) {
  const gem = new Mesh(new OctahedronGeometry(size, 0), jewelMat(color));
  gem.userData.isGem = true;
  gem.userData.baseColor = color.clone();
  return gem;
}

function mergeAll(geos: BufferGeometry[]) {
  const parts = geos.map((g) => (g.index ? g.toNonIndexed() : g));
  const merged = mergeGeometries(parts, false);
  for (const g of geos) g.dispose();
  for (const p of parts) if (!geos.includes(p)) p.dispose();
  return merged;
}

function blackParts(geos: BufferGeometry[]) {
  return new Mesh(mergeAll(geos), blackMat());
}

function buildMoth(colorIndex: number) {
  // A flat black moth peeled off the glass: broad wings, burning thorax.
  const group = new Group();
  const color = jewelFor(colorIndex);
  const wingL = new PlaneGeometry(2.6, 1.5);
  wingL.translate(-1.25, 0, 0);
  const wingR = new PlaneGeometry(2.6, 1.5);
  wingR.translate(1.25, 0, 0);
  const bodyG = new OctahedronGeometry(0.55, 0);
  bodyG.scale(0.6, 1.4, 0.4);
  const black = blackParts([wingL, wingR, bodyG]);
  const chest = chestGem(color, 0.34);
  chest.position.z = 0.3;
  // Wing veins catch the stolen colour in a single line batch.
  const veinL = new EdgesGeometry(new PlaneGeometry(2.6, 1.5));
  veinL.translate(-1.25, 0, 0);
  const veinR = new EdgesGeometry(new PlaneGeometry(2.6, 1.5));
  veinR.translate(1.25, 0, 0);
  const veinsMerged = mergeGeometries([veinL, veinR], false);
  veinL.dispose();
  veinR.dispose();
  const veins = new LineSegments(veinsMerged, new LineBasicMaterial({ color: hdr(color, 0.9) }));
  group.add(black, chest, veins);
  group.userData.accent = color.clone();
  group.userData.lockRingScale = 1.5;
  group.userData.gem = chest;
  group.userData.flapPhase = Math.random() * Math.PI * 2;
  return group;
}

function buildGargoyle(colorIndex: number) {
  // A crouched black mass with horns and a furnace chest.
  const group = new Group();
  const color = jewelFor(colorIndex);
  const bodyG = new IcosahedronGeometry(1.0, 0);
  bodyG.scale(1.1, 1.3, 0.7);
  const browG = new BoxGeometry(1.6, 0.5, 0.6);
  browG.translate(0, 0.9, 0);
  const partGeos: BufferGeometry[] = [bodyG, browG];
  for (const side of [-1, 1]) {
    const horn = new ConeGeometry(0.22, 1.1, 5);
    horn.rotateZ(-side * 0.5);
    horn.translate(side * 0.85, 1.5, 0);
    partGeos.push(horn);
  }
  const black = blackParts(partGeos);
  const chest = chestGem(color, 0.42);
  chest.position.set(0, -0.1, 0.55);
  const eyeGeos: BufferGeometry[] = [];
  for (const side of [-1, 1]) {
    const eye = new SphereGeometry(0.11, 6, 5);
    eye.translate(side * 0.32, 0.62, 0.62);
    eyeGeos.push(eye);
  }
  const eyes = new Mesh(mergeAll(eyeGeos), jewelMat(new Color(1, 0.35, 0.1), 2.4));
  group.add(black, chest, eyes);
  group.userData.accent = color.clone();
  group.userData.lockRingScale = 1.3;
  group.userData.gem = chest;
  return group;
}

function buildThurible(colorIndex: number) {
  // A black censer swinging on its chain, jewel fire inside.
  const group = new Group();
  const color = jewelFor(colorIndex);
  const chain = new BoxGeometry(0.07, 2.6, 0.07);
  chain.translate(0, 1.7, 0);
  const cap = new ConeGeometry(0.7, 0.8, 6);
  cap.translate(0, 0.5, 0);
  const bowl = new SphereGeometry(0.75, 8, 6, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2);
  bowl.translate(0, 0.1, 0);
  const black = blackParts([chain, cap, bowl]);
  const fire = chestGem(color, 0.4);
  fire.position.set(0, 0.1, 0.45);
  const capEdgeGeo = new ConeGeometry(0.7, 0.8, 6);
  capEdgeGeo.translate(0, 0.5, 0);
  const capEdges = dimEdges(capEdgeGeo, color, 0.5);
  black.add(capEdges);
  const haloMat = jewelMat(color, 0.7);
  const halo = new Mesh(new RingGeometry(0.9, 0.98, 24), haloMat);
  halo.position.y = 0.1;
  group.add(black, fire, halo);
  group.userData.accent = color.clone();
  group.userData.lockRingScale = 1.2;
  group.userData.gem = fire;
  return group;
}

function buildCinder() {
  const group = new Group();
  const core = new Mesh(
    new OctahedronGeometry(0.42, 0),
    new MeshBasicMaterial({ color: new Color(0.004, 0.002, 0.002) }),
  );
  const rim = new Mesh(new OctahedronGeometry(0.58, 0), jewelMat(new Color(1, 0.25, 0.08), 2.0));
  rim.scale.set(1, 1, 0.45);
  group.add(core, rim);
  group.userData.accent = new Color(1, 0.3, 0.1);
  group.userData.lockRingScale = 0.7;
  group.userData.isBolt = true;
  return group;
}

function buildPetal(colorIndex: number) {
  // A shard of the rose itself, bent round the Eater.
  const group = new Group();
  const color = jewelFor(colorIndex);
  const shard = new Mesh(new ConeGeometry(1.1, 2.8, 4), blackMat());
  shard.scale.z = 0.35;
  const edge = new LineSegments(
    new EdgesGeometry(shard.geometry),
    new LineBasicMaterial({ color: hdr(color, 1.4) }),
  );
  edge.scale.copy(shard.scale);
  const heart = chestGem(color, 0.5);
  heart.position.z = 0.3;
  group.add(shard, edge, heart);
  group.userData.accent = color.clone();
  group.userData.lockRingScale = 1.4;
  group.userData.gem = heart;
  return group;
}

function buildEater() {
  // The thing eating the light: a black sun wearing every stolen colour.
  const group = new Group();
  const mass = new Mesh(new IcosahedronGeometry(1.9, 1), blackMat());
  mass.scale.set(1, 1.15, 0.7);
  const massEdgeGeo = new IcosahedronGeometry(1.9, 1);
  massEdgeGeo.scale(1, 1.15, 0.7);
  const massEdges = dimEdges(massEdgeGeo, new Color(0.6, 0.08, 0.18), 0.7);
  group.add(mass, massEdges);
  const crown: Mesh[] = [];
  JEWELS.forEach((color, i) => {
    const a = (i / JEWELS.length) * Math.PI * 2 + Math.PI / 8;
    const gem = chestGem(color, 0.5);
    gem.position.set(Math.cos(a) * 2.4, Math.sin(a) * 2.6, 0.2);
    crown.push(gem);
    group.add(gem);
  });
  const maw = new Mesh(new RingGeometry(0.9, 1.25, 24), jewelMat(new Color(0.6, 0.05, 0.2), 2.4));
  maw.position.z = 1.5;
  group.add(maw);
  group.userData.accent = new Color(0.9, 0.15, 0.3);
  group.userData.lockRingScale = 2.2;
  group.userData.crown = crown;
  group.userData.maw = maw;
  return group;
}

// ---- letters: gold leaf on black --------------------------------------------
const GOLD_CELL = new Color(0.95, 0.72, 0.3);

export function createLetterMesh(char: string) {
  const group = new Group();
  const cells = glyphOnCells(char.toUpperCase());
  const cellGeo = new BoxGeometry(0.3, 0.3, 0.14);
  const w = 4 * 0.34;
  const h = 6 * 0.34;
  const fillMaterial = createAdditiveBasicMaterial({ color: GOLD_CELL.clone().multiplyScalar(0.35) });
  const edgeMaterial = new LineBasicMaterial(additiveMaterialParameters({ color: hdr(GOLD_CELL, 1.4) }));
  const fillGeos: BufferGeometry[] = [];
  const edgeGeos: BufferGeometry[] = [];
  for (const cell of cells) {
    const f = new BoxGeometry(0.3, 0.3, 0.14);
    f.translate(cell.x * 0.34 - w / 2, h / 2 - cell.y * 0.34, 0);
    fillGeos.push(f);
    const e = new EdgesGeometry(cellGeo);
    e.translate(cell.x * 0.34 - w / 2, h / 2 - cell.y * 0.34, 0);
    edgeGeos.push(e);
  }
  const fills = new Mesh(mergeAll(fillGeos), fillMaterial);
  const wires = new LineSegments(mergeAll(edgeGeos), edgeMaterial);
  cellGeo.dispose();
  group.add(fills, wires);
  const halo = new Mesh(new RingGeometry(1.9, 1.96, 40), createAdditiveBasicMaterial({ color: hdr(GOLD, 0.9) }));
  group.add(halo);
  group.userData.isLetter = true;
  group.userData.accent = GOLD.clone();
  group.userData.lockRingScale = 1.6;
  group.userData.letterMaterials = { fillMaterial, edgeMaterial };
  return group;
}

export function setLetterLocked(group: Group, locked: boolean) {
  const materials = group.userData.letterMaterials as
    | { fillMaterial: MeshBasicMaterial; edgeMaterial: LineBasicMaterial }
    | undefined;
  if (!materials) return;
  materials.edgeMaterial.color.copy(locked ? hdr(BONE, 2.0) : hdr(GOLD_CELL, 1.4));
  materials.fillMaterial.color.copy(locked ? BONE.clone().multiplyScalar(0.5) : GOLD_CELL.clone().multiplyScalar(0.35));
}

// ---- factories ---------------------------------------------------------------
export function createEnemyMesh(kind: string, letter?: string) {
  let mesh: Group;
  const colorIndex = Math.floor(Math.random() * 4);
  switch (kind) {
    case 'letter':
      mesh = createLetterMesh(letter ?? '?');
      break;
    case 'moth':
      mesh = buildMoth(colorIndex);
      break;
    case 'gargoyle':
      mesh = buildGargoyle(colorIndex);
      break;
    case 'thurible':
      mesh = buildThurible(colorIndex);
      break;
    case 'cinder':
      mesh = buildCinder();
      break;
    case 'petal':
      mesh = buildPetal(colorIndex);
      break;
    case 'eater':
      mesh = buildEater();
      break;
    default:
      mesh = buildMoth(colorIndex);
      break;
  }
  // Stagger the stolen colour deterministically per spawn order so kills walk
  // the jewel cycle instead of repeating one pane.
  const gem = mesh.userData.gem as Mesh | undefined;
  if (gem && kind !== 'eater') {
    const ordered = jewelFor(enemyRecords.pendingCount + enemyRecords.size);
    (gem.material as MeshBasicMaterial).color.copy(hdr(ordered, 2.2));
    mesh.userData.accent = ordered.clone();
    mesh.userData.colorIndex = (enemyRecords.pendingCount + enemyRecords.size) % 4;
  }
  mesh.userData.kind = kind;
  mesh.scale.setScalar(0.001);
  enemyRecords.enqueue(mesh);
  return mesh;
}

export function setEnemyLocked(mesh: Object3D, locked: boolean) {
  mesh.userData.locked = locked;
  if (mesh.userData.isLetter) {
    setLetterLocked(mesh as Group, locked);
    return;
  }
  const gem = (mesh as Group).userData.gem as Mesh | undefined;
  if (gem) {
    const base = (mesh as Group).userData.accent as Color;
    (gem.material as MeshBasicMaterial).color.copy(locked ? hdr(BONE, 2.6) : hdr(base, 2.2));
  }
  const maw = (mesh as Group).userData.maw as Mesh | undefined;
  if (maw) (maw.material as MeshBasicMaterial).color.copy(locked ? hdr(BONE, 2.4) : hdr(new Color(0.6, 0.05, 0.2), 1.8));
}

export function setEnemyDenied(mesh: Object3D) {
  mesh.userData.deniedUntil = elapsedNow + 0.5;
  spawnRing(mesh.position, hdr(GOLD, 0.8), 2.6, 0.35);
}

export function createProjectileMesh() {
  const group = new Group();
  const core = new Mesh(new OctahedronGeometry(0.3, 0), new MeshBasicMaterial({ color: hdr(BONE, 2.6) }));
  core.scale.set(0.45, 0.45, 2.2);
  const shell = new Mesh(new OctahedronGeometry(0.5, 0), createAdditiveBasicMaterial({ color: hdr(GOLD, 0.9), opacity: 0.55 }));
  shell.scale.set(0.55, 0.55, 2.0);
  group.add(core, shell);
  projectileRecords.enqueue({ mesh: group });
  return group;
}

export function createReticle() {
  const group = new Group();
  const parts: Array<{ material: MeshBasicMaterial; base: Color; active: Color }> = [];
  const addPart = (mesh: Mesh, base: Color, active: Color) => {
    const material = configureAdditiveMaterial(mesh.material as MeshBasicMaterial, { color: base, side: DoubleSide });
    parts.push({ material, base, active });
  };
  const outer = new Mesh(new RingGeometry(0.55, 0.6, 48), new MeshBasicMaterial());
  addPart(outer, hdr(GOLD, 1.1), hdr(BONE, 1.9));
  const spinner = new Group();
  const diamond = new Mesh(new RingGeometry(0.34, 0.37, 4), new MeshBasicMaterial());
  addPart(diamond, hdr(GOLD, 0.9), hdr(BONE, 1.8));
  spinner.add(diamond);
  const brackets = new Group();
  for (let i = 0; i < 4; i += 1) {
    const tick = new Mesh(new PlaneGeometry(0.2, 0.04), new MeshBasicMaterial());
    addPart(tick, hdr(GOLD, 1.3), hdr(BONE, 2.2));
    const angle = (i / 4) * Math.PI * 2 + Math.PI / 4;
    tick.position.set(Math.cos(angle) * 0.8, Math.sin(angle) * 0.8, 0);
    tick.rotation.z = angle;
    brackets.add(tick);
  }
  const dot = new Mesh(new OctahedronGeometry(0.05, 0), new MeshBasicMaterial());
  addPart(dot, hdr(BONE, 2), hdr(BONE, 3));
  group.add(outer, spinner, brackets, dot);
  group.userData.parts = parts;
  group.userData.spinner = spinner;
  group.userData.brackets = brackets;
  group.userData.active = false;
  return group;
}

export function setReticleActive(reticle: Object3D, active: boolean, lockCount: number) {
  reticle.userData.active = active;
  reticle.scale.setScalar(1 + lockCount * 0.07 + (active ? 0.06 : 0));
  const parts = reticle.userData.parts as Array<{ material: MeshBasicMaterial; base: Color; active: Color }>;
  for (const part of parts) part.material.color.copy(active ? part.active : part.base);
}

// ---- event choreography --------------------------------------------------------
export function installVisualEventHandlers(bus: EventBus, scene: Scene) {
  bus.on('spawn', ({ enemyId, worldPosition, kind }) => {
    const record = enemyRecords.claim(enemyId);
    if (!record) return;
    const accent = (record.mesh.userData.accent as Color | undefined) ?? GOLD;
    spawnRing(worldPosition, hdr(accent, kind === 'eater' ? 1.6 : 0.9), kind === 'eater' ? 6 : 3, 0.5);
    if (kind === 'eater') burstSparks(worldPosition, new Color(0.7, 0.1, 0.2), 24, 5, 1.0);
  });

  bus.on('lock', ({ enemyId, worldPosition, lockCount }) => {
    const lockColor = colorForLockCount(lockCount, [GOLD, BONE, new Color(1, 0.4, 0.3)]);
    const record = enemyRecords.get(enemyId);
    if (record && !record.lockRing) lockRings.attach(record, makeLockRing(lockColor), scene);
    spawnRing(worldPosition, hdr(lockColor, 1.5), 2.2, 0.3);
    beatEnergy = Math.min(1.4, beatEnergy + 0.12);
  });

  bus.on('unlock', ({ enemyId }) => {
    const record = enemyRecords.get(enemyId);
    if (record) lockRings.detach(record);
  });

  bus.on('fire', ({ projectileId, worldPosition }) => {
    projectileRecords.claim(projectileId);
    spawnRing(worldPosition, hdr(BONE, 1.2), 1.2, 0.18);
  });

  bus.on('hit', ({ enemyId, projectileId, worldPosition, lethal }) => {
    projectileRecords.delete(projectileId);
    const record = enemyRecords.get(enemyId);
    const accent = (record?.mesh.userData.accent as Color | undefined) ?? GOLD;
    if (lethal) {
      burstSparks(worldPosition, accent, 10, 4, 0.7);
    } else {
      burstSparks(worldPosition, BONE, 6, 3, 0.4);
      spawnRing(worldPosition, hdr(BONE, 1.2), 3.4, 0.3);
      if (record) record.mesh.userData.damageFlashUntil = elapsedNow + 0.4;
    }
  });

  bus.on('stage', ({ worldPosition }) => {
    spawnRing(worldPosition, hdr(BONE, 1.6), 5, 0.5);
  });

  bus.on('kill', ({ enemyId, worldPosition }) => {
    const record = enemyRecords.get(enemyId);
    beatEnergy = Math.min(1.6, beatEnergy + 0.3);
    if (record) {
      const accent = (record.mesh.userData.accent as Color | undefined) ?? GOLD;
      const kind = record.mesh.userData.kind as string;
      burstSparks(worldPosition, accent, kind === 'eater' ? 36 : 12, kind === 'eater' ? 8 : 5, kind === 'eater' ? 1.6 : 0.8);
      burstSparks(worldPosition, BONE, kind === 'eater' ? 12 : 4, 3, 1.0);
      spawnRing(worldPosition, hdr(accent, 1.2), kind === 'eater' ? 10 : 5, 0.6);
      spawnRing(worldPosition, hdr(BONE, 0.7), 3, 0.4);
      if (kind === 'eater') {
        igniteRose();
        spawnRing(worldPosition, hdr(new Color(1, 0.8, 0.4), 1.6), 16, 1.4);
      } else {
        // The light goes back where it belongs: a dead window reignites in
        // the stolen colour and stays lit for the rest of the run.
        relightWindow((record.mesh.userData.colorIndex as number | undefined) ?? 0);
      }
      enemyRecords.delete(enemyId, { dispose: true });
    }
  });

  bus.on('miss', ({ enemyId, worldPosition }) => {
    const record = enemyRecords.get(enemyId);
    if (record) enemyRecords.delete(enemyId, { dispose: true });
    burstSparks(worldPosition, new Color(0.2, 0.2, 0.25), 4, 1.5, 0.5);
  });

  bus.on('beat', ({ isDownbeat }) => {
    beatEnergy = isDownbeat ? 1 : 0.45;
  });

  bus.on('playerhit', () => {
    beatEnergy = 1.6;
    if (fxScene) {
      // Blood-dark pulse at the screen edge is HUD-owned; shake lives here.
    }
  });

  bus.on('runstart', () => {
    ringPool.clear(undefined);
    sparkPool.clear(undefined);
    // Reset the cathedral: most windows go dark again, the rose dies.
    windows.forEach((w, i) => {
      const keep = i < 4;
      w.lit = keep;
      if (keep) {
        const color = jewelFor(i);
        w.color.copy(color);
        const relit = createAdditiveBasicMaterial({ color: hdr(color, 0.55), side: DoubleSide });
        w.mesh.material = relit;
        w.material = relit;
        w.edge.color.copy(hdr(color, 1.2));
      } else {
        w.material.color.setRGB(0.004, 0.004, 0.007);
        w.edge.color.setRGB(0.02, 0.02, 0.03);
      }
    });
    roseIgnited = false;
    roseSegments.forEach((mat) => mat.color.setRGB(0.003, 0.003, 0.005));
    roseRing?.color.setRGB(0.015, 0.015, 0.02);
    enemyRecords.clear({ dispose: true, pending: true });
    projectileRecords.clear({ pending: true });
  });
}

export function updateVisuals(dt: number, ctx: VisualContext) {
  elapsedNow = ctx.elapsed;
  beatEnergy = Math.max(0, beatEnergy - dt * 3.6);
  ctx.feel.setFovOffset(beatEnergy * 1.2);

  ringPool.update(dt, undefined);
  sparkPool.update(dt, undefined);
  for (const ring of ringPool.values()) {
    ring.mesh.quaternion.copy(ctx.camera.quaternion);
  }
  for (const spark of sparkPool.values()) {
    spark.mesh.quaternion.copy(ctx.camera.quaternion);
  }

  // Candle flicker, mote drift, gem breathing.
  if (naveLight) {
    naveLight.intensity = 60 + Math.sin(elapsedNow * 2.3) * 8 + beatEnergy * 30;
    const u = ctx.runProgress ?? 0;
    naveLight.position.z = -10 - u * 280;
  }
  for (const light of candleLights) {
    light.intensity = 120 + Math.sin(elapsedNow * 7 + light.position.z) * 18;
  }
  // Candle sea breathing, mote veil drift, rose rotation — no scene traversal.
  if (candleMaterial) candleMaterial.opacity = 0.8 + Math.sin(elapsedNow * 7.3) * 0.12 + beatEnergy * 0.1;
  if (moteVeil) {
    moteVeil.position.x = Math.sin(elapsedNow * 0.4) * 0.8;
    moteVeil.position.y = Math.sin(elapsedNow * 0.55) * 0.5;
  }
  if (roseGroup && roseIgnited) roseGroup.rotation.z += dt * 0.05;

  for (const [enemyId, record] of enemyRecords.entries()) {
    if (!record.mesh.parent) {
      enemyRecords.delete(enemyId, { dispose: true });
      continue;
    }
    if (record.bornAt === null) record.bornAt = elapsedNow;
    const age = elapsedNow - record.bornAt;
    const kind = record.mesh.userData.kind as string;
    const baseScale = kind === 'eater' ? 1 : 1;
    record.mesh.scale.setScalar(Math.max(0.001, easeOutBack(Math.min(1, age / 0.35)) * baseScale));

    // Moth banking reads as wingbeats now that wings share one mesh; the
    // eater crown rotation lives below with the gem pulse.
    if (kind === 'moth') {
      const phase = (record.mesh.userData.flapPhase as number | undefined) ?? 0;
      record.mesh.rotateZ(Math.sin(elapsedNow * 6 + phase) * 0.16);
    }
    const gem = record.mesh.userData.gem as Mesh | undefined;
    if (gem && record.mesh.userData.locked !== true) {
      const accent = record.mesh.userData.accent as Color;
      const pulse = 1.9 + Math.sin(elapsedNow * 3.5 + enemyId) * 0.5 + beatEnergy * 0.6;
      (gem.material as MeshBasicMaterial).color.copy(accent).multiplyScalar(pulse);
    }
    const crown = record.mesh.userData.crown as Mesh[] | undefined;
    if (crown) {
      crown.forEach((gemMesh, i) => {
        gemMesh.position.z = 0.2 + Math.sin(elapsedNow * 2 + i * 1.7) * 0.25;
      });
      const maw = record.mesh.userData.maw as Mesh | undefined;
      if (maw && record.mesh.userData.locked !== true) {
        (maw.material as MeshBasicMaterial).color.setRGB(0.6 + beatEnergy * 0.8, 0.05, 0.2);
      }
    }

    const deniedUntil = record.mesh.userData.deniedUntil as number | undefined;
    if ((deniedUntil ?? -Infinity) > elapsedNow) {
      const flash = Math.max(0, Math.min(1, ((deniedUntil ?? 0) - elapsedNow) / 0.5));
      if (gem) (gem.material as MeshBasicMaterial).color.copy(hdr(new Color(0.5, 0.1, 0.1), 1 + flash * 2));
    }
    const damageFlashUntil = record.mesh.userData.damageFlashUntil as number | undefined;
    if ((damageFlashUntil ?? -Infinity) > elapsedNow) {
      if (gem) (gem.material as MeshBasicMaterial).color.copy(hdr(BONE, 2.6));
    } else if (record.mesh.userData.isLetter && record.mesh.userData.locked !== true) {
      setLetterLocked(record.mesh, false);
    }

    if (record.lockRing) {
      record.mesh.getWorldPosition(record.lockRing.position);
      record.lockRing.quaternion.copy(ctx.camera.quaternion);
      record.lockRing.rotation.z += dt * 2.4;
      const pulse = 1 + Math.sin(elapsedNow * 9) * 0.05;
      const fit = (record.mesh.userData.lockRingScale as number | undefined) ?? 1;
      record.lockRing.scale.setScalar(pulse * 1.9 * fit);
    }
  }

  for (const [projectileId, record] of projectileRecords.entries()) {
    if (!record.mesh.parent) {
      projectileRecords.delete(projectileId);
      continue;
    }
  }

  const reticleSpinner = findReticleSpinner(ctx.scene);
  if (reticleSpinner) {
    const active = reticleSpinner.parent?.userData.active === true;
    reticleSpinner.rotation.z += dt * (active ? 4 : 1.2);
    const brackets = reticleSpinner.parent?.userData.brackets as Group | undefined;
    if (brackets) brackets.rotation.z -= dt * (active ? 2.8 : 0.7);
  }
}

function findReticleSpinner(scene: Scene): Group | null {
  for (const child of scene.children) {
    if (child.userData.spinner) return child.userData.spinner as Group;
  }
  return null;
}

function makeLockRing(color: Color): Group {
  const group = new Group();
  const ring = new Mesh(new RingGeometry(0.86, 0.92, 4), createAdditiveBasicMaterial({ color: hdr(color, 1.8), side: DoubleSide }));
  const innerRing = new Mesh(
    new RingGeometry(0.68, 0.71, 32),
    createAdditiveBasicMaterial({ color: hdr(color.clone().lerp(BONE, 0.5), 1.4), side: DoubleSide }),
  );
  group.add(ring, innerRing);
  return group;
}

function easeOutBack(t: number): number {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2;
}
