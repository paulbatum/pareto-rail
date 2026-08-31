import {
  AdditiveBlending,
  BoxGeometry,
  CircleGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  EdgesGeometry,
  Group,
  IcosahedronGeometry,
  InstancedMesh,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  OctahedronGeometry,
  Object3D,
  PlaneGeometry,
  RingGeometry,
  Scene,
  SphereGeometry,
  TorusGeometry,
  Vector3,
} from 'three';
import type { Camera } from 'three';
import type { EventBus } from '../../../events';
import { glyphOnCells } from '../../../engine/glyphs';

// Jewel light in a black room. The stone never competes with these four panes.
const VOID = 0x010208;
const STONE = 0x0a0b14;
const STONE_EDGE = 0x28283a;
const HOSTILE_EDGE = 0x6b6b84;
const COBALT = 0x285cff;
const BLOOD = 0xb21f4f;
const BOTTLE = 0x16865f;
const GOLD = 0xffb62d;
const IVORY = 0xfff1c7;
const AMBER = 0xf08c32;
const WINDOW_COLORS = [COBALT, BLOOD, BOTTLE, GOLD] as const;

const stoneMaterial = new MeshBasicMaterial({ color: STONE, side: DoubleSide });
const edgeMaterial = new LineBasicMaterial({ color: STONE_EDGE, transparent: true, opacity: 0.78 });
const hostileEdgeMaterial = new LineBasicMaterial({ color: HOSTILE_EDGE, transparent: true, opacity: 0.94 });
const blackMaterial = () => new MeshBasicMaterial({ color: VOID, side: DoubleSide });
const additiveMaterial = (color: Color, opacity = 1) => new MeshBasicMaterial({
  color,
  transparent: opacity < 1,
  opacity,
  side: DoubleSide,
  depthWrite: false,
  blending: AdditiveBlending,
});

type WindowPane = {
  mesh: Mesh;
  base: Color;
  lit: boolean;
  level: number;
  phase: number;
};

type EnemyRecord = {
  mesh: Group;
  bornAt: number;
  kind: string;
  windowIndex: number;
  accent: Color;
  lockRing: Group | null;
};

type VisualEffect = {
  mesh: Mesh;
  material: MeshBasicMaterial;
  age: number;
  duration: number;
  velocity: Vector3;
  spin: number;
  ring: boolean;
  startScale: number;
  endScale: number;
};

let activeScene: Scene | null = null;
let environmentRoot: Group | null = null;
let effectRoot: Group | null = null;
let roseRoot: Group | null = null;
let roseCore: Mesh | null = null;
let rosePanes: WindowPane[] = [];
let windowPanes: WindowPane[] = [];
let candles: Array<{ mesh: Object3D; phase: number }> = [];
let enemyRecords = new Map<number, EnemyRecord>();
let projectileRecords = new Map<number, Object3D>();
let pendingEnemies: Group[] = [];
let pendingProjectiles: Object3D[] = [];
let effects: VisualEffect[] = [];
let windowCursor = 0;
let effectSeed = 0;
let elapsedNow = 0;
let beatEnergy = 0;
let rejectEnergy = 0;
let roseIgnited = false;

const sparkGeometry = new IcosahedronGeometry(0.11, 0);
const projectileGeometry = new OctahedronGeometry(0.16, 0);

export type VisualContext = {
  scene: Scene;
  camera: Camera;
  elapsed: number;
  dt: number;
  runProgress?: number;
};

export function createEnvironment(scene: Scene) {
  activeScene = scene;
  environmentRoot = new Group();
  environmentRoot.userData.raildIgnoreOcclusion = true;
  environmentRoot.name = 'Vespers Cathedral';
  scene.add(environmentRoot);

  effectRoot = new Group();
  effectRoot.name = 'Vespers light returned';
  scene.add(effectRoot);

  rosePanes = [];
  windowPanes = [];
  candles = [];
  roseRoot = null;
  roseCore = null;
  roseIgnited = false;
  windowCursor = 0;
  effectSeed = 0;
  effects = [];

  buildNave();
  buildWestRose();
  buildCandleFloor();
  resetWindows();

  return environmentRoot;
}

function buildNave() {
  if (!environmentRoot) return;
  const bayCount = 18;
  for (let bay = 0; bay < bayCount; bay += 1) {
    const z = -18 - bay * 34;
    const side = bay % 2 === 0 ? 1 : -1;
    for (const sign of [-1, 1]) {
      const x = sign * (19.5 + (bay % 3) * 0.7);
      addStone(new BoxGeometry(3.5, 22, 3.2), x, 3.4, z);
      addStone(new BoxGeometry(4.8, 1.15, 4.2), x, 14.45, z);
      addStone(new BoxGeometry(3.9, 0.7, 3.8), x, -7.25, z);
    }

    // A second arcade tier hangs above the flight path. Its alternating
    // capitals make the scale of the nave readable at speed.
    for (const sign of [-1, 1]) {
      const x = sign * (12.2 + (bay % 2) * 0.35);
      addStone(new BoxGeometry(1.25, 9, 1.4), x, 11.0, z + 0.8);
      addStone(new BoxGeometry(2.1, 0.55, 1.9), x, 15.3, z + 0.8);
    }

    const arch = new Mesh(new TorusGeometry(15.8, 0.24, 5, 32, Math.PI), edgeMaterial);
    arch.position.set(0, 11.2, z + 1.2);
    arch.scale.y = 0.88;
    environmentRoot.add(arch);

    // High ribs are deliberately thin: they frame the windows without making
    // a solid ceiling that can swallow targets when bloom is off.
    for (const x of [-8.2, 8.2]) addStone(new BoxGeometry(0.22, 0.22, 36), x, 18.3, z + 9);
    addStone(new BoxGeometry(0.3, 0.3, 36), 0, 20.2, z + 9);

    buildSideWindow(-1, z, bay * 2 + 0, side);
    buildSideWindow(1, z - 8, bay * 2 + 1, side);
  }
}

function addStone(geometry: BoxGeometry, x: number, y: number, z: number) {
  if (!environmentRoot) return;
  const mesh = new Mesh(geometry, stoneMaterial);
  mesh.position.set(x, y, z);
  environmentRoot.add(mesh);
}

function buildSideWindow(sign: number, z: number, index: number, side: number) {
  if (!environmentRoot) return;
  const color = new Color(WINDOW_COLORS[index % WINDOW_COLORS.length]);
  const group = new Group();
  group.position.set(sign * 15.55, 5.0 + (index % 3) * 0.25, z);
  group.rotation.y = sign * -0.06;

  const pane = new Mesh(new PlaneGeometry(2.75, 5.9), additiveMaterial(color.clone().multiplyScalar(0.06)));
  pane.position.z = 0.08;
  group.add(pane);
  const crown = new Mesh(new CircleGeometry(1.36, 3), additiveMaterial(color.clone().multiplyScalar(0.055)));
  crown.position.set(0, 3.05, 0.08);
  crown.rotation.z = Math.PI / 2;
  group.add(crown);

  environmentRoot.add(group);

  windowPanes.push({ mesh: pane, base: color, lit: false, level: 0.04, phase: index * 0.71 + side * 0.2 });
}

function buildWestRose() {
  if (!environmentRoot) return;
  roseRoot = new Group();
  roseRoot.name = 'Dead west rose window';
  roseRoot.position.set(0, 10.2, -620);
  environmentRoot.add(roseRoot);

  const backing = new Mesh(new CircleGeometry(15.2, 64), new MeshBasicMaterial({ color: 0x05050d, side: DoubleSide }));
  backing.position.z = -0.34;
  roseRoot.add(backing);

  const paneColors = [COBALT, BLOOD, BOTTLE, GOLD, BLOOD, COBALT, GOLD, BOTTLE, COBALT, BLOOD, BOTTLE, GOLD];
  for (let index = 0; index < 12; index += 1) {
    const color = new Color(paneColors[index]);
    const pane = new Mesh(new CircleGeometry(9.4, 3, index * Math.PI / 6 + Math.PI / 12, Math.PI / 6 - 0.035), additiveMaterial(color.clone().multiplyScalar(0.035)));
    pane.position.z = -0.2;
    roseRoot.add(pane);
    rosePanes.push({ mesh: pane, base: color, lit: false, level: 0.03, phase: index * 0.54 });
  }

  const outer = new Mesh(new TorusGeometry(14.3, 0.6, 8, 48), new MeshBasicMaterial({ color: STONE_EDGE, side: DoubleSide }));
  const inner = new Mesh(new TorusGeometry(9.5, 0.34, 6, 36), new MeshBasicMaterial({ color: STONE_EDGE, side: DoubleSide }));
  roseRoot.add(outer, inner);
  for (let index = 0; index < 12; index += 1) {
    const spoke = new Mesh(new BoxGeometry(0.22, 19, 0.25), new MeshBasicMaterial({ color: STONE_EDGE }));
    spoke.rotation.z = index * Math.PI / 6;
    roseRoot.add(spoke);
  }
  roseCore = new Mesh(new CircleGeometry(2.35, 32), additiveMaterial(new Color(IVORY).multiplyScalar(0.025)));
  roseCore.position.z = -0.12;
  roseRoot.add(roseCore);
}

function buildCandleFloor() {
  if (!environmentRoot) return;
  const candleGeometry = new CylinderGeometry(0.055, 0.075, 0.38, 5);
  const flameGeometry = new SphereGeometry(0.09, 5, 4);
  const candleMaterial = additiveMaterial(new Color(GOLD).multiplyScalar(0.65));
  const flameMaterial = additiveMaterial(new Color(AMBER).multiplyScalar(0.85));
  const count = 7 * 24;
  const candleInstances = new InstancedMesh(candleGeometry, candleMaterial, count);
  const flameInstances = new InstancedMesh(flameGeometry, flameMaterial, count);
  const dummy = new Object3D();
  let instance = 0;
  for (let row = -3; row <= 3; row += 1) {
    for (let index = 0; index < 24; index += 1) {
      const z = -8 - index * 19 - (row % 2 === 0 ? 0 : 7);
      const x = row * 7.3 + Math.sin(index * 1.9 + row) * 0.55;
      dummy.position.set(x, -10.4, z);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      candleInstances.setMatrixAt(instance, dummy.matrix);
      dummy.position.y = -10.12;
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      flameInstances.setMatrixAt(instance, dummy.matrix);
      instance += 1;
    }
  }
  candleInstances.instanceMatrix.needsUpdate = true;
  flameInstances.instanceMatrix.needsUpdate = true;
  environmentRoot.add(candleInstances, flameInstances);
  candles.push({ mesh: flameInstances, phase: 0 });
}

export function installVisualEventHandlers(bus: EventBus, scene: Scene) {
  activeScene = scene;
  bus.on('spawn', ({ enemyId, worldPosition, kind }) => {
    const mesh = pendingEnemies.shift();
    if (!mesh) return;
    const windowIndex = Number(mesh.userData.windowIndex ?? -1);
    const accent = mesh.userData.accent instanceof Color ? mesh.userData.accent as Color : new Color(IVORY);
    const record: EnemyRecord = { mesh, bornAt: elapsedNow, kind, windowIndex, accent: accent.clone(), lockRing: null };
    enemyRecords.set(enemyId, record);
    spawnRing(worldPosition, accent, 0.85, kind === 'rose' ? 4.6 : 2.1, kind === 'rose' ? 0.8 : 0.42);
    spawnBurst(worldPosition, accent, kind === 'rose' ? 12 : 5, kind === 'rose' ? 2.8 : 1.2);
  });

  bus.on('lock', ({ enemyId, worldPosition, lockCount }) => {
    const record = enemyRecords.get(enemyId);
    if (record && !record.lockRing) {
      record.lockRing = createLockRing(record.accent, lockCount);
      record.mesh.add(record.lockRing);
    }
    spawnRing(worldPosition, lockCount > 2 ? new Color(IVORY) : record?.accent ?? new Color(IVORY), 0.65, 1.8 + lockCount * 0.18, 0.24);
    spawnBurst(worldPosition, record?.accent ?? new Color(IVORY), 2, 0.55);
  });

  bus.on('unlock', ({ enemyId }) => {
    const record = enemyRecords.get(enemyId);
    if (record?.lockRing) {
      record.mesh.remove(record.lockRing);
      record.lockRing = null;
    }
  });

  bus.on('fire', ({ projectileId, worldPosition, volleySize }) => {
    const projectile = pendingProjectiles.shift();
    if (projectile) projectileRecords.set(projectileId, projectile);
    spawnBurst(worldPosition, new Color(IVORY), 3 + volleySize, 0.9);
  });

  bus.on('hit', ({ enemyId, projectileId, worldPosition, lethal, hitStageIndex }) => {
    projectileRecords.delete(projectileId);
    const record = enemyRecords.get(enemyId);
    if (record) {
      record.mesh.userData.hitUntil = elapsedNow + (lethal ? 0.45 : 0.28);
      record.mesh.userData.hitStage = hitStageIndex;
    }
    spawnBurst(worldPosition, lethal ? record?.accent ?? new Color(IVORY) : new Color(IVORY), lethal ? 7 : 4, lethal ? 1.8 : 1.0);
    spawnRing(worldPosition, new Color(IVORY), 0.45, lethal ? 3.1 : 1.8, lethal ? 0.42 : 0.24);
  });

  bus.on('stage', ({ enemyId, worldPosition, stageIndex }) => {
    const record = enemyRecords.get(enemyId);
    if (!record) return;
    record.mesh.userData.hitStage = stageIndex;
    spawnRing(worldPosition, new Color(GOLD), 0.8, 4.5 + stageIndex, 0.58);
    spawnBurst(worldPosition, new Color(GOLD), 10, 2.1);
  });

  bus.on('kill', ({ enemyId, worldPosition }) => {
    const record = enemyRecords.get(enemyId);
    const accent = record?.accent ?? new Color(IVORY);
    if (record && record.windowIndex >= 0 && windowPanes.length) lightWindow(record.windowIndex);
    if (record?.kind === 'rose') igniteRose(worldPosition);
    spawnRing(worldPosition, accent, 0.7, record?.kind === 'rose' ? 14 : 5.8, record?.kind === 'rose' ? 1.15 : 0.52);
    spawnBurst(worldPosition, accent, record?.kind === 'rose' ? 54 : 14, record?.kind === 'rose' ? 8 : 3.3);
    if (record) {
      if (record.lockRing) record.mesh.remove(record.lockRing);
      enemyRecords.delete(enemyId);
    }
  });

  bus.on('miss', ({ enemyId, worldPosition }) => {
    const record = enemyRecords.get(enemyId);
    spawnBurst(worldPosition, new Color(AMBER), record?.kind === 'rose' ? 14 : 4, 1.1);
    if (record) enemyRecords.delete(enemyId);
  });

  bus.on('reject', ({ enemyIds, missingEnemyIds }) => {
    rejectEnergy = 1;
    for (const id of [...enemyIds, ...(missingEnemyIds ?? [])]) {
      const record = enemyRecords.get(id);
      if (!record) continue;
      record.mesh.userData.deniedUntil = elapsedNow + 0.58;
      spawnRing(record.mesh.position, new Color(AMBER), 0.8, 3.3, 0.46);
    }
  });

  bus.on('volley', ({ size, kills }) => {
    if (kills < 3 || kills < size) return;
    beatEnergy = Math.max(beatEnergy, 0.85);
    spawnBurst(new Vector3(0, 0, 0), new Color(IVORY), Math.min(16, size * 3), 2.2);
  });

  bus.on('bossphase', ({ phase }) => {
    beatEnergy = 1;
    if (phase === 'destroyed') igniteRose(roseRoot?.position ?? new Vector3(0, 10, -620));
    const color = phase === 'exposed' ? new Color(GOLD) : new Color(IVORY);
    if (roseRoot) spawnRing(roseRoot.position, color, 1, phase === 'destroyed' ? 25 : 12, phase === 'destroyed' ? 1.4 : 0.75);
  });

  bus.on('beat', ({ isDownbeat }) => {
    beatEnergy = Math.max(beatEnergy, isDownbeat ? 1 : 0.42);
  });

  bus.on('playerhit', () => {
    rejectEnergy = 1;
    beatEnergy = 1;
  });

  bus.on('runstart', () => {
    enemyRecords.clear();
    projectileRecords.clear();
    pendingEnemies = [];
    pendingProjectiles = [];
    windowCursor = 0;
    resetWindows();
    resetEffects();
  });
}

export function createEnemyMesh(kind: string, letter?: string) {
  const mesh = kind === 'letter' ? createLetterMesh(letter ?? '?') : createEnemyBody(kind);
  mesh.userData.kind = kind;
  mesh.scale.setScalar(0.001);
  if (kind !== 'letter') {
    const index = windowCursor;
    windowCursor += 1;
    mesh.userData.windowIndex = index;
    mesh.userData.accent = new Color(kind === 'rose' ? GOLD : WINDOW_COLORS[index % WINDOW_COLORS.length]);
  } else {
    mesh.userData.windowIndex = -1;
    mesh.userData.accent = new Color(IVORY);
  }
  pendingEnemies.push(mesh);
  return mesh;
}

function createEnemyBody(kind: string) {
  switch (kind) {
    case 'wraith':
      return createWraith();
    case 'lancet':
      return createLancet();
    case 'bell':
      return createBell();
    case 'rose':
      return createRoseTarget();
    default:
      return createWraith();
  }
}

function createWraith() {
  const group = new Group();
  const silhouette = new Mesh(new ConeGeometry(0.95, 2.9, 4), blackMaterial());
  silhouette.rotation.z = Math.PI / 4;
  group.add(silhouette, new LineSegments(new EdgesGeometry(silhouette.geometry), hostileEdgeMaterial));
  const left = new Mesh(new ConeGeometry(0.55, 1.85, 3), blackMaterial());
  left.position.set(-0.9, -0.1, 0.02);
  left.rotation.z = -0.55;
  const right = left.clone();
  right.position.x = 0.9;
  right.rotation.z = 0.55;
  group.add(left, right);
  addEnemyCore(group, 0.64, 0.86);
  return group;
}

function createLancet() {
  const group = new Group();
  const body = new Mesh(new ConeGeometry(0.76, 3.7, 4), blackMaterial());
  group.add(body, new LineSegments(new EdgesGeometry(body.geometry), hostileEdgeMaterial));
  for (const sign of [-1, 1]) {
    const wing = new Mesh(new ConeGeometry(0.48, 2.4, 3), blackMaterial());
    wing.position.set(sign * 0.72, 0.08, 0.03);
    wing.rotation.z = sign * 0.38;
    group.add(wing);
  }
  const crown = new Mesh(new TorusGeometry(0.63, 0.08, 5, 18), new MeshBasicMaterial({ color: STONE_EDGE }));
  crown.rotation.x = Math.PI / 2;
  crown.position.y = 1.15;
  group.add(crown);
  addEnemyCore(group, 0.52, 1.18);
  return group;
}

function createBell() {
  const group = new Group();
  const body = new Mesh(new CylinderGeometry(1.18, 1.52, 1.75, 8), blackMaterial());
  group.add(body, new LineSegments(new EdgesGeometry(body.geometry), hostileEdgeMaterial));
  const shoulder = new Mesh(new TorusGeometry(1.02, 0.2, 6, 20), new MeshBasicMaterial({ color: STONE_EDGE }));
  shoulder.position.y = 0.86;
  group.add(shoulder);
  const clapper = new Mesh(new SphereGeometry(0.21, 7, 5), blackMaterial());
  clapper.position.y = -1.08;
  group.add(clapper);
  addEnemyCore(group, 0.46, 0.72);
  return group;
}

function createRoseTarget() {
  const group = new Group();
  const shell = new Mesh(new TorusGeometry(3.5, 0.62, 8, 32), blackMaterial());
  const shellEdge = new LineSegments(new EdgesGeometry(shell.geometry), hostileEdgeMaterial);
  group.add(shell, shellEdge);
  const inner = new Mesh(new TorusGeometry(2.45, 0.28, 6, 28), new MeshBasicMaterial({ color: STONE_EDGE }));
  group.add(inner);
  for (let index = 0; index < 8; index += 1) {
    const spoke = new Mesh(new BoxGeometry(0.3, 6.4, 0.24), blackMaterial());
    spoke.rotation.z = index * Math.PI / 4;
    group.add(spoke);
    const thorn = new Mesh(new ConeGeometry(0.46, 1.4, 4), blackMaterial());
    const angle = index * Math.PI / 4;
    thorn.position.set(Math.cos(angle) * 4.05, Math.sin(angle) * 4.05, 0);
    thorn.rotation.z = angle;
    group.add(thorn);
  }
  const core = addEnemyCore(group, 1.14, 1.16);
  group.userData.bossShell = shell;
  group.userData.bossCore = core;
  return group;
}

function addEnemyCore(group: Group, size: number, scaleY: number) {
  const core = new Mesh(new OctahedronGeometry(size, 0), additiveMaterial(new Color(IVORY).multiplyScalar(1.45)));
  core.scale.y = scaleY;
  core.position.z = 0.24;
  group.add(core);
  const ring = new Mesh(new RingGeometry(size * 1.2, size * 1.29, 16), additiveMaterial(new Color(IVORY).multiplyScalar(0.72), 0.86));
  ring.position.z = 0.18;
  group.add(ring);
  group.userData.core = core;
  group.userData.coreRing = ring;
  return core;
}

function createLetterMesh(character: string) {
  const group = new Group();
  group.userData.isLetter = true;
  const cells = glyphOnCells(character);
  const cellGeometry = new BoxGeometry(0.27, 0.27, 0.12);
  const cellMaterial = additiveMaterial(new Color(GOLD).multiplyScalar(1.2));
  const backing = new Mesh(new PlaneGeometry(1.72, 2.35), new MeshBasicMaterial({ color: VOID, transparent: true, opacity: 0.88, side: DoubleSide }));
  backing.position.z = -0.08;
  group.add(backing);
  for (const cell of cells) {
    const block = new Mesh(cellGeometry, cellMaterial);
    block.position.set((cell.x - 2) * 0.32, (3 - cell.y) * 0.32, 0.04);
    group.add(block);
  }
  const frame = new Mesh(new RingGeometry(1.18, 1.23, 24), additiveMaterial(new Color(COBALT).multiplyScalar(0.85), 0.9));
  group.add(frame);
  return group;
}

export function setEnemyLocked(mesh: Object3D, locked: boolean, lockCount = 0) {
  mesh.userData.locked = locked;
  mesh.userData.lockCount = lockCount;
  mesh.userData.lockedUntil = locked ? elapsedNow + 0.22 : 0;
}

export function setEnemyDenied(mesh: Object3D) {
  mesh.userData.deniedUntil = elapsedNow + 0.58;
  rejectEnergy = 1;
}

export function createProjectileMesh() {
  const group = new Group();
  const core = new Mesh(projectileGeometry, additiveMaterial(new Color(IVORY).multiplyScalar(2.2)));
  core.scale.set(0.6, 0.6, 2.1);
  const halo = new Mesh(new RingGeometry(0.22, 0.28, 12), additiveMaterial(new Color(GOLD).multiplyScalar(1.1), 0.75));
  halo.rotation.y = Math.PI / 2;
  group.add(core, halo);
  pendingProjectiles.push(group);
  return group;
}

export function createReticle() {
  const group = new Group();
  const parts: Array<{ material: MeshBasicMaterial; base: Color; active: Color }> = [];
  const addPart = (mesh: Mesh, base: Color, active: Color) => {
    const material = mesh.material as MeshBasicMaterial;
    material.color.copy(base);
    parts.push({ material, base, active });
  };

  const outer = new Mesh(new RingGeometry(1.0, 1.07, 48), new MeshBasicMaterial());
  addPart(outer, new Color(GOLD), new Color(IVORY));
  const inner = new Mesh(new RingGeometry(0.55, 0.59, 32), new MeshBasicMaterial());
  addPart(inner, new Color(COBALT), new Color(GOLD));
  const marks = new Group();
  for (let index = 0; index < 4; index += 1) {
    const mark = new Mesh(new PlaneGeometry(0.28, 0.055), new MeshBasicMaterial());
    const angle = index * Math.PI / 2;
    mark.position.set(Math.cos(angle) * 1.25, Math.sin(angle) * 1.25, 0);
    mark.rotation.z = angle;
    addPart(mark, new Color(GOLD), new Color(IVORY));
    marks.add(mark);
  }
  const center = new Mesh(new CircleGeometry(0.06, 16), new MeshBasicMaterial());
  addPart(center, new Color(IVORY), new Color(IVORY));
  group.add(outer, inner, marks, center);
  group.userData.parts = parts;
  group.userData.inner = inner;
  group.userData.marks = marks;
  return group;
}

export function setReticleActive(reticle: Object3D, active: boolean, lockCount: number) {
  reticle.userData.active = active;
  reticle.userData.lockCount = lockCount;
  reticle.scale.setScalar(1 + lockCount * 0.045 + (active ? 0.06 : 0));
  const parts = reticle.userData.parts as Array<{ material: MeshBasicMaterial; base: Color; active: Color }>;
  for (const part of parts) part.material.color.copy(active ? part.active : part.base);
  const inner = reticle.userData.inner as Mesh | undefined;
  if (inner) inner.rotation.z += active ? 0.035 : 0.012;
  const marks = reticle.userData.marks as Group | undefined;
  if (marks) marks.rotation.z += active ? -0.02 : -0.008;
}

export function updateVisuals(dt: number, context: VisualContext) {
  elapsedNow = context.elapsed;
  beatEnergy = Math.max(0, beatEnergy - dt * 2.8);
  rejectEnergy = Math.max(0, rejectEnergy - dt * 3.5);
  updateWindowLights();
  updateCandleFloor();
  updateEnemyRecords(dt, context.camera);
  updateProjectileRecords(dt);
  updateEffects(dt);
}

function updateWindowLights() {
  for (const pane of [...windowPanes, ...rosePanes]) {
    const pulse = pane.lit ? 0.84 + beatEnergy * 0.16 + Math.sin(elapsedNow * 1.7 + pane.phase) * 0.035 : 0.035;
    pane.level += (pulse - pane.level) * Math.min(1, 0.1 + beatEnergy * 0.07);
    const material = pane.mesh.material as MeshBasicMaterial;
    material.color.copy(pane.base).multiplyScalar(pane.level);
  }
  if (roseCore) {
    const coreMaterial = roseCore.material as MeshBasicMaterial;
    coreMaterial.color.copy(new Color(roseIgnited ? IVORY : VOID)).multiplyScalar(roseIgnited ? 1.65 + beatEnergy * 0.45 : 0.025);
    roseCore.scale.setScalar(roseIgnited ? 1 + beatEnergy * 0.12 : 1);
  }
  if (roseRoot) {
    roseRoot.rotation.z = Math.sin(elapsedNow * 0.12) * 0.018;
    roseRoot.userData.ignited = roseIgnited;
  }
}

function updateCandleFloor() {
  for (const candle of candles) {
    const pulse = 0.8 + Math.sin(elapsedNow * 4.6 + candle.phase) * 0.13 + beatEnergy * 0.12;
    candle.mesh.scale.set(1, pulse, 1);
  }
}

function updateEnemyRecords(dt: number, camera: Camera) {
  for (const [enemyId, record] of enemyRecords) {
    if (!record.mesh.parent && record.kind !== 'letter') {
      enemyRecords.delete(enemyId);
      continue;
    }
    const age = Math.max(0, elapsedNow - record.bornAt);
    const enter = Math.min(1, age / 0.38);
    const ease = enter < 1 ? 1 - (1 - enter) ** 3 : 1;
    const locked = record.mesh.userData.locked === true;
    const boss = record.kind === 'rose';
    record.mesh.scale.setScalar(ease * (locked ? 1.12 : 1) * (boss ? 1.04 : 1));

    const core = record.mesh.userData.core as Mesh | undefined;
    const coreRing = record.mesh.userData.coreRing as Mesh | undefined;
    const hitUntil = Number(record.mesh.userData.hitUntil ?? 0);
    const deniedUntil = Number(record.mesh.userData.deniedUntil ?? 0);
    const flash = Math.max(0, Math.max(hitUntil, deniedUntil) - elapsedNow);
    if (core) {
      const base = flash > 0 ? new Color(IVORY) : record.accent;
      const strength = flash > 0 ? 2.1 + flash * 1.5 : 1.25 + (locked ? 0.55 : 0) + (boss ? 0.35 : 0);
      (core.material as MeshBasicMaterial).color.copy(base).multiplyScalar(strength);
      core.rotation.z += dt * (locked ? 2.1 : 0.65);
    }
    if (coreRing) {
      (coreRing.material as MeshBasicMaterial).color.copy(flash > 0 ? new Color(AMBER) : record.accent).multiplyScalar(locked ? 1.4 : 0.72);
      coreRing.rotation.z -= dt * (locked ? 2.8 : 0.75);
    }
    if (boss) {
      const stage = Number(record.mesh.userData.hitStage ?? 0);
      const shell = record.mesh.userData.bossShell as Mesh | undefined;
      if (shell) {
        shell.rotation.z += dt * (0.22 + stage * 0.18);
        shell.scale.setScalar(1 + Math.sin(elapsedNow * 1.2) * 0.025 + stage * 0.05);
      }
    }
    if (record.lockRing) {
      record.lockRing.rotation.z += dt * 2.2;
      const pulse = 1 + Math.sin(elapsedNow * 9 + enemyId) * 0.06;
      record.lockRing.scale.setScalar(pulse * (1 + (Number(record.mesh.userData.lockCount ?? 0) * 0.045)));
    }
    if (record.kind === 'letter') {
      const denied = deniedUntil > elapsedNow;
      record.mesh.userData.denied = denied;
    }
  }

  if (rejectEnergy > 0 && activeScene) {
    activeScene.userData.vespersRejectPulse = rejectEnergy;
  }
  void camera;
}

function updateProjectileRecords(dt: number) {
  for (const [id, projectile] of projectileRecords) {
    projectile.rotateZ(dt * 8);
    if (!projectile.parent) projectileRecords.delete(id);
  }
}

function createLockRing(color: Color, lockCount: number) {
  const group = new Group();
  const ring = new Mesh(new RingGeometry(1.14, 1.2, 28), additiveMaterial(color.clone().multiplyScalar(1.45), 0.88));
  group.add(ring);
  for (let index = 0; index < 4; index += 1) {
    const mark = new Mesh(new PlaneGeometry(0.32, 0.06), additiveMaterial(new Color(IVORY).multiplyScalar(1.2), 0.92));
    const angle = index * Math.PI / 2;
    mark.position.set(Math.cos(angle) * 1.35, Math.sin(angle) * 1.35, 0.03);
    mark.rotation.z = angle;
    group.add(mark);
  }
  group.scale.setScalar(1 + lockCount * 0.06);
  return group;
}

function spawnRing(position: Vector3, color: Color, startScale: number, endScale: number, duration: number) {
  if (!effectRoot) return;
  const mesh = new Mesh(new TorusGeometry(1, 0.035, 5, 28), additiveMaterial(color.clone().multiplyScalar(1.2), 0.88));
  mesh.position.copy(position);
  effectRoot.add(mesh);
  effects.push({ mesh, material: mesh.material as MeshBasicMaterial, age: 0, duration, velocity: new Vector3(), spin: 1.8, ring: true, startScale, endScale });
}

function spawnBurst(position: Vector3, color: Color, count: number, speed: number) {
  if (!effectRoot) return;
  const base = effectSeed++;
  for (let index = 0; index < count; index += 1) {
    const angle = index / Math.max(1, count) * Math.PI * 2 + base * 0.731;
    const vertical = Math.sin(index * 2.17 + base) * 0.72;
    const direction = new Vector3(Math.cos(angle), vertical, Math.sin(angle) * 0.6).normalize();
    const mesh = new Mesh(sparkGeometry, additiveMaterial(color.clone().multiplyScalar(1.15 + (index % 3) * 0.18), 0.92));
    mesh.position.copy(position);
    mesh.scale.setScalar(0.55 + (index % 4) * 0.16);
    effectRoot.add(mesh);
    effects.push({ mesh, material: mesh.material as MeshBasicMaterial, age: 0, duration: 0.35 + (index % 4) * 0.06, velocity: direction.multiplyScalar(speed * (0.65 + (index % 3) * 0.2)), spin: 3 + (index % 5), ring: false, startScale: mesh.scale.x, endScale: 0.04 });
  }
}

function updateEffects(dt: number) {
  for (let index = effects.length - 1; index >= 0; index -= 1) {
    const effect = effects[index]!;
    effect.age += dt;
    const t = Math.min(1, effect.age / effect.duration);
    effect.mesh.position.addScaledVector(effect.velocity, dt);
    effect.mesh.rotation.z += dt * effect.spin;
    const scale = effect.startScale + (effect.endScale - effect.startScale) * t;
    effect.mesh.scale.setScalar(scale);
    effect.material.opacity = (1 - t) * 0.9;
    if (t >= 1) {
      effect.mesh.removeFromParent();
      effects.splice(index, 1);
    }
  }
}

function lightWindow(index: number) {
  const pane = windowPanes[index % windowPanes.length];
  if (!pane) return;
  pane.lit = true;
  pane.level = Math.max(pane.level, 0.9);
}

function igniteRose(position: Vector3) {
  roseIgnited = true;
  for (const pane of rosePanes) {
    pane.lit = true;
    pane.level = 1.35;
  }
  if (roseCore) {
    roseCore.scale.setScalar(1.4);
    spawnBurst(position, new Color(IVORY), 42, 7.2);
  }
  if (roseRoot) spawnRing(roseRoot.position, new Color(GOLD), 0.8, 28, 1.55);
}

function resetWindows() {
  roseIgnited = false;
  for (const pane of windowPanes) {
    pane.lit = false;
    pane.level = 0.04;
    (pane.mesh.material as MeshBasicMaterial).color.copy(pane.base).multiplyScalar(0.04);
  }
  for (const pane of rosePanes) {
    pane.lit = false;
    pane.level = 0.03;
    (pane.mesh.material as MeshBasicMaterial).color.copy(pane.base).multiplyScalar(0.03);
  }
}

function resetEffects() {
  for (const effect of effects) effect.mesh.removeFromParent();
  effects = [];
  beatEnergy = 0;
  rejectEnergy = 0;
}
