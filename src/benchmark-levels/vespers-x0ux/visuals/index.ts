import {
  BoxGeometry,
  CircleGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  EdgesGeometry,
  FogExp2,
  Group,
  LineBasicMaterial,
  LineSegments,
  MathUtils,
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
import { colorForLockCount } from '../../../engine/locks';
import {
  createAdditiveBasicMaterial,
  createPendingVisualRecords,
  disposeObject3D,
} from '../../../engine/visual-kit';

// The room is almost black. Saturation belongs to the recovered windows and
// the stolen panes inside the silhouettes, not to the stone itself.
const VOID = new Color(0x010108);
const STONE = new Color(0.035, 0.04, 0.065);
const STONE_EDGE = new Color(0.12, 0.13, 0.2);
const LEAD = new Color(0.18, 0.2, 0.28);
const WHITE = new Color(0.72, 0.78, 0.94);
const COBALT = new Color(0.04, 0.2, 1.0);
const BLOOD = new Color(0.95, 0.035, 0.08);
const BOTTLE = new Color(0.02, 0.62, 0.25);
const GOLD = new Color(1.0, 0.46, 0.06);
const DENIED = new Color(1.2, 0.12, 0.04);
const LOCK_COLORS = [COBALT, BOTTLE, GOLD, BLOOD, WHITE, GOLD];

function hdr(color: Color, amount = 1) { return color.clone().multiplyScalar(amount); }
function basic(color: Color, opacity = 1) {
  return new MeshBasicMaterial({ color: hdr(color), side: DoubleSide, transparent: opacity < 1, opacity });
}
function additive(color: Color, opacity = 1) {
  return createAdditiveBasicMaterial({ color: hdr(color), opacity, side: DoubleSide });
}

type TintPart = { material: MeshBasicMaterial; idle: Color; locked: Color };
type EnemyRecord = { mesh: Group; bornAt: number | null; lockRing: Group | null };
type ProjectileRecord = { mesh: Object3D; color: Color };
type Effect = { group: Group; age: number; life: number; velocity: Vector3; spin: number; startScale: number; endScale: number };

let environmentRoot: Group | null = null;
let effectRoot: Group | null = null;
let elapsedNow = 0;
let beatEnergy = 0;
let roseGlow = 0;
let cathedralLit = false;
let finaleGroup: Group | null = null;
let environmentLights: Array<{ material: MeshBasicMaterial; base: Color; strength: number; lit: boolean }> = [];
let nextRestoredWindow = 0;
let candles: Array<{ flame: Mesh; phase: number }> = [];
const effects: Effect[] = [];

const enemyRecords = createPendingVisualRecords<Group, EnemyRecord>({
  createRecord: (mesh) => ({ mesh, bornAt: null, lockRing: null }),
});
const projectileRecords = createPendingVisualRecords<ProjectileRecord, ProjectileRecord>({
  createRecord: (record) => record,
});

function tintParts(mesh: Group, parts: TintPart[]) {
  mesh.userData.tintParts = parts;
  mesh.userData.accent = parts[0]?.idle ?? COBALT;
}

function createWisp() {
  const group = new Group();
  const parts: TintPart[] = [];
  const body = new Mesh(new OctahedronGeometry(0.92, 0), basic(STONE));
  body.scale.set(0.72, 1.3, 0.22);
  group.add(body);
  const edge = new LineSegments(new EdgesGeometry(body.geometry), new LineBasicMaterial({ color: STONE_EDGE }));
  edge.scale.copy(body.scale);
  group.add(edge);
  const paneMaterial = basic(COBALT, 1);
  const pane = new Mesh(new PlaneGeometry(0.55, 0.82), paneMaterial);
  pane.position.z = 0.28;
  group.add(pane);
  parts.push({ material: paneMaterial, idle: hdr(COBALT, 0.9), locked: hdr(WHITE, 2.1) });
  const lead = new LineSegments(new EdgesGeometry(new PlaneGeometry(0.62, 0.9)), new LineBasicMaterial({ color: LEAD }));
  lead.position.z = 0.31;
  group.add(lead);
  tintParts(group, parts);
  group.userData.body = body;
  return group;
}

function createGargoyle() {
  const group = new Group();
  const parts: TintPart[] = [];
  const body = new Mesh(new BoxGeometry(1.25, 1.35, 0.62), basic(STONE));
  body.rotation.z = Math.PI / 4;
  group.add(body);
  const leftWing = new Mesh(new ConeGeometry(0.78, 1.65, 3), basic(STONE));
  leftWing.position.x = -0.98;
  leftWing.rotation.z = -Math.PI / 2;
  leftWing.rotation.y = -0.24;
  group.add(leftWing);
  const rightWing = new Mesh(new ConeGeometry(0.78, 1.65, 3), basic(STONE));
  rightWing.position.x = 0.98;
  rightWing.rotation.z = Math.PI / 2;
  rightWing.rotation.y = 0.24;
  group.add(rightWing);
  const eye = new Mesh(new CircleGeometry(0.33, 8), basic(BLOOD));
  eye.position.z = 0.42;
  group.add(eye);
  parts.push({ material: eye.material as MeshBasicMaterial, idle: hdr(BLOOD, 0.9), locked: hdr(WHITE, 2.0) });
  const horn = new Mesh(new ConeGeometry(0.14, 0.58, 4), basic(STONE_EDGE));
  horn.position.set(-0.34, 0.86, 0);
  horn.rotation.z = -0.18;
  group.add(horn);
  const horn2 = horn.clone();
  horn2.position.x = 0.34;
  horn2.rotation.z = 0.18;
  group.add(horn2);
  tintParts(group, parts);
  group.userData.body = body;
  return group;
}

function createCowl() {
  const group = new Group();
  const parts: TintPart[] = [];
  const hood = new Mesh(new ConeGeometry(0.96, 1.95, 8, 1, true), basic(STONE));
  hood.position.y = 0.32;
  group.add(hood);
  const rim = new Mesh(new TorusGeometry(0.7, 0.12, 6, 20), new MeshBasicMaterial({ color: STONE_EDGE, side: DoubleSide }));
  rim.rotation.x = Math.PI / 2;
  rim.position.y = -0.52;
  group.add(rim);
  const paneMaterial = basic(BOTTLE);
  const pane = new Mesh(new PlaneGeometry(0.4, 0.84), paneMaterial);
  pane.position.set(0, 0.08, 0.48);
  group.add(pane);
  parts.push({ material: paneMaterial, idle: hdr(BOTTLE, 1.0), locked: hdr(WHITE, 2.2) });
  const cross = new Group();
  const bar = new Mesh(new BoxGeometry(0.62, 0.045, 0.035), new MeshBasicMaterial({ color: LEAD }));
  const stem = new Mesh(new BoxGeometry(0.045, 0.95, 0.035), new MeshBasicMaterial({ color: LEAD }));
  cross.add(bar, stem);
  cross.position.z = 0.5;
  group.add(cross);
  tintParts(group, parts);
  group.userData.body = hood;
  return group;
}

function createRoseShell() {
  const group = new Group();
  const parts: TintPart[] = [];
  const outer = new Mesh(new TorusGeometry(3.7, 0.34, 8, 48), new MeshBasicMaterial({ color: STONE_EDGE, side: DoubleSide }));
  group.add(outer);
  const inner = new Mesh(new TorusGeometry(2.9, 0.16, 6, 36), new MeshBasicMaterial({ color: LEAD, side: DoubleSide }));
  group.add(inner);
  const petals: Mesh[] = [];
  const paneColors = [COBALT, BLOOD, BOTTLE, GOLD, COBALT, BLOOD];
  for (let index = 0; index < 6; index += 1) {
    const angle = index * Math.PI / 3;
    const petal = new Mesh(new PlaneGeometry(1.6, 3.0), basic(STONE, 0.94));
    petal.position.set(Math.cos(angle) * 1.45, Math.sin(angle) * 1.45, -0.03);
    petal.rotation.z = angle - Math.PI / 2;
    group.add(petal);
    petals.push(petal);
    const paneMaterial = basic(paneColors[index], 0.26);
    const pane = new Mesh(new PlaneGeometry(0.7, 1.45), paneMaterial);
    pane.position.set(Math.cos(angle) * 1.45, Math.sin(angle) * 1.45, 0.13);
    pane.rotation.z = angle - Math.PI / 2;
    group.add(pane);
    parts.push({ material: paneMaterial, idle: hdr(paneColors[index], 0.7), locked: hdr(WHITE, 1.8) });
  }
  for (let index = 0; index < 6; index += 1) {
    const angle = index * Math.PI / 3;
    const spoke = new Mesh(new BoxGeometry(0.09, 6.4, 0.08), new MeshBasicMaterial({ color: LEAD }));
    spoke.rotation.z = angle;
    group.add(spoke);
  }
  const occlusion = new Mesh(new CircleGeometry(0.85, 16), basic(STONE, 0.84));
  occlusion.position.z = 0.1;
  group.add(occlusion);
  tintParts(group, parts);
  group.userData.petals = petals;
  group.userData.occlusion = occlusion;
  group.userData.boss = true;
  return group;
}

function createRoseCore() {
  const group = new Group();
  const parts: TintPart[] = [];
  const outer = new Mesh(new TorusGeometry(1.35, 0.16, 7, 32), new MeshBasicMaterial({ color: LEAD, side: DoubleSide }));
  group.add(outer);
  const coreMaterial = basic(GOLD, 1);
  const core = new Mesh(new CircleGeometry(0.82, 12), coreMaterial);
  core.position.z = 0.22;
  group.add(core);
  parts.push({ material: coreMaterial, idle: hdr(GOLD, 1.2), locked: hdr(WHITE, 2.6) });
  const iris = new Mesh(new RingGeometry(0.98, 1.06, 12), additive(BLOOD, 0.85));
  iris.position.z = 0.25;
  group.add(iris);
  tintParts(group, parts);
  group.userData.core = core;
  group.userData.boss = true;
  return group;
}

function createLetterMesh(character: string) {
  const group = new Group();
  const cells = glyphOnCells(character);
  const parts: TintPart[] = [];
  const geometry = new BoxGeometry(0.3, 0.3, 0.12);
  for (const cell of cells) {
    const material = basic(GOLD, 1);
    const block = new Mesh(geometry, material);
    block.position.set((cell.x - 2) * 0.37, (3 - cell.y) * 0.37, 0);
    group.add(block);
    parts.push({ material, idle: hdr(GOLD, 1.1), locked: hdr(WHITE, 2.5) });
  }
  const halo = new Mesh(new RingGeometry(1.35, 1.39, 32), additive(COBALT, 0.55));
  group.add(halo);
  tintParts(group, parts);
  group.userData.isLetter = true;
  group.userData.halo = halo;
  return group;
}

function buildEnemy(kind: string, letter?: string): Group {
  if (kind === 'letter') return createLetterMesh(letter ?? 'A');
  switch (kind) {
    case 'wisp': return createWisp();
    case 'gargoyle': return createGargoyle();
    case 'cowl': return createCowl();
    case 'rose-shell': return createRoseShell();
    case 'rose-core': return createRoseCore();
    default: return createWisp();
  }
}

function createFinaleGroup() {
  const group = new Group();
  group.userData.raildIgnoreOcclusion = true;
  const arch = new Mesh(new TorusGeometry(9.5, 0.22, 6, 48, Math.PI), new MeshBasicMaterial({ color: WHITE, side: DoubleSide }));
  arch.position.y = -6.5;
  group.add(arch);
  const colors = [COBALT, BLOOD, BOTTLE, GOLD, COBALT, BLOOD];
  for (let index = 0; index < 6; index += 1) {
    const angle = (index - 2.5) * 0.42;
    const paneMaterial = additive(colors[index], 0.34);
    const pane = new Mesh(new CircleGeometry(1.7, 16), paneMaterial);
    pane.position.set((index - 2.5) * 3.0, Math.sin(angle) * 1.2, 0.5);
    group.add(pane);
  }
  const vault = new Mesh(new TorusGeometry(4.2, 0.11, 5, 32), new MeshBasicMaterial({ color: LEAD, side: DoubleSide }));
  vault.position.z = 0.3;
  group.add(vault);
  return group;
}

export function createEnvironment(scene: Scene) {
  environmentRoot?.removeFromParent();
  environmentRoot = new Group();
  environmentRoot.userData.raildIgnoreOcclusion = true;
  effectRoot = new Group();
  scene.add(environmentRoot, effectRoot);
  scene.background = VOID.clone();
  scene.fog = new FogExp2(VOID.clone(), 0.0065);
  environmentLights = [];
  candles = [];

  for (let segment = 0; segment < 12; segment += 1) {
    const z = -25 - segment * 54;
    addPier(-13.5, z, segment);
    addPier(13.5, z, segment);
    addWindow(-11.9, 4.1, z - 10, -1, segment);
    addWindow(11.9, 4.1, z - 10, 1, segment);
    addVaultRib(z);
    addCandleRow(z, segment);
  }
  addRoseBackdrop(-606);
  return environmentRoot;
}

function addPier(x: number, z: number, index: number) {
  if (!environmentRoot) return;
  const pier = new Mesh(new BoxGeometry(2.1, 15, 2.4), basic(STONE));
  pier.position.set(x, 1.7, z);
  environmentRoot.add(pier);
  const tracery = new LineSegments(new EdgesGeometry(new BoxGeometry(2.3, 12, 2.55)), new LineBasicMaterial({ color: new Color(0.09, 0.1, 0.16) }));
  tracery.position.set(x, 1.7, z);
  environmentRoot.add(tracery);
}

function addWindow(x: number, y: number, z: number, side: number, index: number) {
  if (!environmentRoot) return;
  const colors = [COBALT, BLOOD, BOTTLE, GOLD];
  const color = colors[index % colors.length];
  const frame = new Mesh(new TorusGeometry(2.0, 0.13, 6, 28), new MeshBasicMaterial({ color: LEAD, side: DoubleSide }));
  frame.position.set(x, y, z);
  frame.rotation.y = side * Math.PI / 2;
  environmentRoot.add(frame);
  const paneMaterial = basic(color, 0.82);
  const pane = new Mesh(new PlaneGeometry(2.7, 3.5), paneMaterial);
  pane.position.set(x + side * 0.04, y, z);
  pane.rotation.y = side * Math.PI / 2;
  environmentRoot.add(pane);
  environmentLights.push({ material: paneMaterial, base: hdr(color, 0.72), strength: 0.28, lit: false });
  for (let ray = 0; ray < 2; ray += 1) {
    const mullion = new Mesh(new BoxGeometry(0.08, 3.3, 0.08), new MeshBasicMaterial({ color: LEAD }));
    mullion.position.set(x + side * 0.06, y, z);
    mullion.rotation.y = side * Math.PI / 2;
    mullion.rotation.z = ray * Math.PI / 4;
    environmentRoot.add(mullion);
  }
}

function addVaultRib(z: number) {
  if (!environmentRoot) return;
  const rib = new Mesh(new TorusGeometry(13.5, 0.18, 6, 42, Math.PI), new MeshBasicMaterial({ color: STONE_EDGE, side: DoubleSide }));
  rib.position.set(0, -7.6, z);
  environmentRoot.add(rib);
  const spine = new Mesh(new BoxGeometry(0.2, 0.2, 27), new MeshBasicMaterial({ color: LEAD }));
  spine.position.set(0, 8.3, z);
  environmentRoot.add(spine);
}

function addCandleRow(z: number, index: number) {
  if (!environmentRoot) return;
  for (let side = -1; side <= 1; side += 2) {
    for (let candleIndex = 0; candleIndex < 2; candleIndex += 1) {
      const x = side * (5.1 + candleIndex * 2.0);
      const candle = new Mesh(new CylinderGeometry(0.09, 0.14, 0.9, 6), new MeshBasicMaterial({ color: new Color(0.22, 0.16, 0.1) }));
      candle.position.set(x, -8.1 + (candleIndex % 2) * 0.12, z + (candleIndex - 0.5) * 2.6);
      environmentRoot.add(candle);
      const flameMaterial = additive(GOLD, 1.1);
      const flame = new Mesh(new ConeGeometry(0.16, 0.55, 7), flameMaterial);
      flame.position.copy(candle.position).add(new Vector3(0, 0.62, 0));
      environmentRoot.add(flame);
      candles.push({ flame, phase: index * 1.7 + candleIndex * 0.8 + side });
    }
  }
}

function addRoseBackdrop(z: number) {
  if (!environmentRoot) return;
  const group = new Group();
  group.position.set(0, 3.5, z);
  const frame = new Mesh(new TorusGeometry(14.5, 0.55, 8, 64), new MeshBasicMaterial({ color: STONE_EDGE, side: DoubleSide }));
  group.add(frame);
  const colors = [COBALT, BLOOD, BOTTLE, GOLD, COBALT, BLOOD, BOTTLE, GOLD];
  for (let index = 0; index < 8; index += 1) {
    const angle = index * Math.PI / 4;
    const paneMaterial = basic(colors[index], 0.2);
    const pane = new Mesh(new CircleGeometry(3.8, 24, angle, Math.PI / 5.5), paneMaterial);
    pane.position.z = -0.12;
    group.add(pane);
    environmentLights.push({ material: paneMaterial, base: hdr(colors[index], 0.35), strength: 0.45, lit: false });
  }
  for (let index = 0; index < 8; index += 1) {
    const bar = new Mesh(new BoxGeometry(0.24, 28, 0.2), new MeshBasicMaterial({ color: LEAD }));
    bar.rotation.z = index * Math.PI / 8;
    group.add(bar);
  }
  environmentRoot.add(group);
}

export function createEnemyMesh(kind: string, letter?: string) {
  const mesh = buildEnemy(kind, letter);
  mesh.userData.kind = kind;
  mesh.scale.setScalar(0.001);
  enemyRecords.enqueue(mesh);
  return mesh;
}

export function setEnemyLocked(mesh: Object3D, locked: boolean, lockCount = 1) {
  mesh.userData.locked = locked;
  const parts = mesh.userData.tintParts as TintPart[] | undefined;
  if (parts) {
    const lockColor = colorForLockCount(lockCount, LOCK_COLORS);
    for (const part of parts) part.material.color.copy(locked ? hdr(lockColor, 1.5) : part.idle);
  }
  const halo = mesh.userData.halo as Mesh | undefined;
  if (halo) (halo.material as MeshBasicMaterial).color.copy(hdr(locked ? GOLD : COBALT, locked ? 1.3 : 0.55));
}

export function setEnemyDenied(mesh: Object3D) {
  mesh.userData.deniedUntil = elapsedNow + 0.52;
  mesh.scale.multiplyScalar(0.84);
  spawnRing(mesh.position, DENIED, 2.0, 0.38);
}

export function createProjectileMesh() {
  const group = new Group();
  const core = new Mesh(new OctahedronGeometry(0.23, 0), basic(WHITE, 1));
  core.scale.set(0.55, 0.55, 2.6);
  group.add(core);
  const shell = new Mesh(new OctahedronGeometry(0.4, 0), additive(COBALT, 0.72));
  shell.scale.set(0.5, 0.5, 2.1);
  group.add(shell);
  projectileRecords.enqueue({ mesh: group, color: COBALT.clone() });
  return group;
}

export function createReticle() {
  const group = new Group();
  const parts: Array<{ material: MeshBasicMaterial; base: Color; active: Color }> = [];
  const add = (mesh: Mesh, base: Color, active: Color) => {
    const material = mesh.material as MeshBasicMaterial;
    material.color.copy(hdr(base, 1.2));
    material.transparent = true;
    material.depthTest = false;
    material.depthWrite = false;
    parts.push({ material, base: hdr(base, 1.2), active: hdr(active, 1.8) });
  };
  const outer = new Mesh(new RingGeometry(1.17, 1.23, 48), new MeshBasicMaterial());
  add(outer, BOTTLE, GOLD);
  const inner = new Mesh(new RingGeometry(0.66, 0.7, 12), new MeshBasicMaterial());
  add(inner, COBALT, WHITE);
  const ticks = new Group();
  for (let index = 0; index < 4; index += 1) {
    const tick = new Mesh(new PlaneGeometry(0.22, 0.045), new MeshBasicMaterial());
    const angle = index * Math.PI / 2;
    tick.position.set(Math.cos(angle) * 1.38, Math.sin(angle) * 1.38, 0);
    tick.rotation.z = angle;
    add(tick, GOLD, WHITE);
    ticks.add(tick);
  }
  const dot = new Mesh(new CircleGeometry(0.065, 16), new MeshBasicMaterial());
  add(dot, WHITE, WHITE);
  group.add(outer, inner, ticks, dot);
  group.userData.parts = parts;
  group.userData.ticks = ticks;
  group.userData.raildRole = 'reticle';
  return group;
}

export function setReticleActive(reticle: Object3D, active: boolean, lockCount: number) {
  reticle.userData.active = active;
  reticle.scale.setScalar(1 + lockCount * 0.075 + (active ? 0.06 : 0));
  const parts = reticle.userData.parts as Array<{ material: MeshBasicMaterial; base: Color; active: Color }>;
  for (const part of parts) part.material.color.copy(active ? part.active : part.base);
  const ticks = reticle.userData.ticks as Group | undefined;
  if (ticks) ticks.rotation.z += active ? 0.015 : 0.005;
}

function restoreNextWindow() {
  if (environmentLights.length === 0) return;
  environmentLights[nextRestoredWindow % environmentLights.length].lit = true;
  nextRestoredWindow += 1;
}

export function installVisualEventHandlers(bus: EventBus, scene: Scene) {
  bus.on('spawn', ({ enemyId, kind, worldPosition }) => {
    const record = enemyRecords.claim(enemyId);
    if (!record) return;
    spawnRing(worldPosition, kind === 'rose-shell' ? GOLD : kind === 'rose-core' ? BLOOD : COBALT, kind === 'rose-shell' ? 5.5 : 2.5, kind === 'rose-shell' ? 0.9 : 0.42);
  });
  bus.on('lock', ({ enemyId, worldPosition, lockCount }) => {
    const record = enemyRecords.get(enemyId);
    if (record && !record.lockRing) {
      record.lockRing = makeLockRing(colorForLockCount(lockCount, LOCK_COLORS));
      scene.add(record.lockRing);
    }
    spawnRing(worldPosition, colorForLockCount(lockCount, LOCK_COLORS), 1.6 + lockCount * 0.22, 0.28);
  });
  bus.on('unlock', ({ enemyId }) => {
    const record = enemyRecords.get(enemyId);
    if (record?.lockRing) {
      record.lockRing.removeFromParent();
      disposeObject3D(record.lockRing);
      record.lockRing = null;
    }
  });
  bus.on('fire', ({ projectileId, worldPosition }) => {
    projectileRecords.claim(projectileId);
    spawnGlint(worldPosition, WHITE, 0.55, 0.16);
  });
  bus.on('hit', ({ enemyId, projectileId, worldPosition, lethal }) => {
    projectileRecords.delete(projectileId, { dispose: true });
    spawnBurst(worldPosition, lethal ? (enemyRecords.get(enemyId)?.mesh.userData.accent as Color | undefined) ?? COBALT : WHITE, lethal ? 9 : 4, lethal ? 0.62 : 0.32);
    if (!lethal) {
      const record = enemyRecords.get(enemyId);
      if (record) record.mesh.userData.damageFlashUntil = elapsedNow + 0.42;
    }
  });
  bus.on('stage', ({ enemyId, worldPosition, stageIndex }) => {
    const record = enemyRecords.get(enemyId);
    if (record) {
      record.mesh.userData.damageLevel = stageIndex;
      if (record.mesh.userData.kind === 'rose-shell') roseGlow = 1.2;
    }
    spawnRing(worldPosition, GOLD, record?.mesh.userData.kind === 'rose-shell' ? 4.5 : 3.2, 0.55);
    spawnBurst(worldPosition, GOLD, 10, 0.55);
  });
  bus.on('kill', ({ enemyId, worldPosition }) => {
    const record = enemyRecords.get(enemyId);
    const color = (record?.mesh.userData.accent as Color | undefined) ?? COBALT;
    const kind = record?.mesh.userData.kind;
    const boss = kind === 'rose-shell' || kind === 'rose-core';
    restoreNextWindow();
    spawnBurst(worldPosition, boss ? GOLD : color, boss ? 30 : 14, boss ? 1.4 : 0.72);
    spawnRing(worldPosition, boss ? GOLD : color, boss ? 9 : 3.6, boss ? 1.3 : 0.52);
    if (record?.lockRing) {
      record.lockRing.removeFromParent();
      disposeObject3D(record.lockRing);
    }
    if (record) enemyRecords.delete(enemyId, { dispose: true });
  });
  bus.on('miss', ({ enemyId, worldPosition }) => {
    const record = enemyRecords.get(enemyId);
    if (record?.lockRing) {
      record.lockRing.removeFromParent();
      disposeObject3D(record.lockRing);
    }
    if (record) enemyRecords.delete(enemyId, { dispose: true });
    spawnRing(worldPosition, DENIED, 1.6, 0.32);
  });
  bus.on('reject', ({ enemyIds, missingEnemyIds }) => {
    for (const id of [...enemyIds, ...(missingEnemyIds ?? [])]) {
      const record = enemyRecords.get(id);
      if (record) spawnRing(record.mesh.position, DENIED, 2.5, 0.5);
    }
  });
  bus.on('bossphase', ({ phase }) => {
    if (phase === 'summoned') roseGlow = 1.4;
    if (phase === 'exposed') {
      roseGlow = 2.2;
      const core = [...enemyRecords.values()].find((record) => record.mesh.userData.kind === 'rose-core');
      if (core) spawnBurst(core.mesh.position, GOLD, 34, 1.4);
    }
    if (phase === 'destroyed') {
      cathedralLit = true;
      for (const light of environmentLights) light.lit = true;
      roseGlow = 4;
      const core = [...enemyRecords.values()].find((record) => record.mesh.userData.kind === 'rose-core');
      if (core) spawnBurst(core.mesh.position, GOLD, 70, 2.5);
    }
  });
  bus.on('beat', ({ isDownbeat }) => { beatEnergy = Math.max(beatEnergy, isDownbeat ? 1 : 0.36); });
  bus.on('playerhit', () => { roseGlow = Math.max(roseGlow, 0.7); });
  bus.on('runstart', () => {
    clearEffects();
    enemyRecords.clear({ dispose: true, pending: true });
    projectileRecords.clear({ dispose: true, pending: true });
    roseGlow = 0;
    cathedralLit = false;
    nextRestoredWindow = 0;
    for (const light of environmentLights) light.lit = false;
    finaleGroup?.removeFromParent();
    if (finaleGroup) disposeObject3D(finaleGroup);
    finaleGroup = null;
  });
}

function makeLockRing(color: Color) {
  const group = new Group();
  const outer = new Mesh(new RingGeometry(1.02, 1.09, 12), additive(color, 0.9));
  const inner = new Mesh(new RingGeometry(0.78, 0.82, 32), additive(WHITE, 0.65));
  group.add(outer, inner);
  group.userData.outer = outer;
  return group;
}

function spawnRing(position: Vector3, color: Color, size: number, life: number) {
  if (!effectRoot) return;
  const group = new Group();
  const ring = new Mesh(new RingGeometry(0.93, 1.0, 32), additive(color, 0.84));
  group.add(ring);
  group.position.copy(position);
  effectRoot.add(group);
  effects.push({ group, age: 0, life, velocity: new Vector3(), spin: 1.6, startScale: size, endScale: size * 1.8 });
}

function spawnGlint(position: Vector3, color: Color, size: number, life: number) {
  if (!effectRoot) return;
  const group = new Group();
  const mesh = new Mesh(new SphereGeometry(0.18, 8, 6), additive(color, 1));
  group.add(mesh);
  group.position.copy(position);
  effectRoot.add(group);
  effects.push({ group, age: 0, life, velocity: new Vector3(), spin: 0, startScale: size, endScale: size * 0.2 });
}

function spawnBurst(position: Vector3, color: Color, count: number, life: number) {
  if (!effectRoot) return;
  const group = new Group();
  for (let index = 0; index < Math.min(count, 72); index += 1) {
    const shard = new Mesh(new OctahedronGeometry(0.055 + (index % 3) * 0.025, 0), additive(color, 0.88));
    const angle = index * 2.399963;
    shard.position.set(Math.cos(angle) * 0.12, Math.sin(angle) * 0.12, (index % 5 - 2) * 0.08);
    shard.userData.velocity = new Vector3(Math.cos(angle) * (1.8 + (index % 4) * 0.7), Math.sin(angle) * (1.8 + (index % 3) * 0.9), (index % 5 - 2) * 0.85);
    group.add(shard);
  }
  group.position.copy(position);
  effectRoot.add(group);
  effects.push({ group, age: 0, life, velocity: new Vector3(), spin: 3.4, startScale: 1, endScale: 0.35 });
}

function clearEffects() {
  for (const effect of effects) {
    effect.group.removeFromParent();
    disposeObject3D(effect.group);
  }
  effects.length = 0;
}

export function updateVisuals(dt: number, camera: Camera, elapsed: number, runProgress = 0) {
  elapsedNow = elapsed;
  beatEnergy = Math.max(0, beatEnergy - dt * 3.4);
  roseGlow = Math.max(0, roseGlow - dt * 1.2);
  for (const light of environmentLights) {
    const pulse = light.strength * (0.6 + beatEnergy * 0.35 + roseGlow * 0.08);
    const recovered = cathedralLit ? 1.45 : 0;
    const windowLevel = light.lit || cathedralLit ? 1 : 0.2;
    light.material.color.copy(light.base).multiplyScalar(windowLevel * (1 + pulse + recovered));
  }
  for (const candle of candles) {
    const flicker = 1 + Math.sin(elapsed * 7.2 + candle.phase) * 0.14 + beatEnergy * 0.1 + (cathedralLit ? 0.45 : 0);
    candle.flame.scale.set(flicker, 0.8 + flicker * 0.3, flicker);
  }
  if (cathedralLit && !finaleGroup && effectRoot?.parent) {
    finaleGroup = createFinaleGroup();
    effectRoot.parent.add(finaleGroup);
  }
  if (cathedralLit && finaleGroup) {
    const forward = new Vector3();
    camera.getWorldDirection(forward);
    finaleGroup.position.copy(camera.position).addScaledVector(forward, 44);
    finaleGroup.quaternion.copy(camera.quaternion);
    finaleGroup.scale.setScalar(1 + beatEnergy * 0.06);
  }

  for (const [enemyId, record] of enemyRecords.entries()) {
    if (!record.mesh.parent) {
      enemyRecords.delete(enemyId);
      continue;
    }
    if (record.bornAt === null) record.bornAt = elapsed;
    const age = elapsed - record.bornAt;
    const t = MathUtils.clamp(age / 0.34, 0, 1);
    record.mesh.scale.setScalar(t * t * (3 - 2 * t));
    const deniedUntil = record.mesh.userData.deniedUntil as number | undefined;
    const damagedUntil = record.mesh.userData.damageFlashUntil as number | undefined;
    const parts = record.mesh.userData.tintParts as TintPart[] | undefined;
    if (parts) {
      if ((deniedUntil ?? -Infinity) > elapsed) {
        for (const part of parts) part.material.color.copy(hdr(DENIED, 1.1));
      } else if ((damagedUntil ?? -Infinity) > elapsed) {
        for (const part of parts) part.material.color.copy(hdr(WHITE, 1.6));
      } else if (record.mesh.userData.locked !== true) {
        for (const part of parts) part.material.color.copy(part.idle);
      }
    }
    const petals = record.mesh.userData.petals as Mesh[] | undefined;
    if (petals) {
      const exposed = record.mesh.userData.exposed === true;
      for (const petal of petals) {
        petal.scale.setScalar(exposed ? Math.max(0.01, 1 - (elapsed % 0.8) * 1.1) : 1);
        petal.visible = !exposed || petal.scale.x > 0.03;
      }
    }
    if (record.lockRing) {
      record.mesh.getWorldPosition(record.lockRing.position);
      record.lockRing.quaternion.copy(camera.quaternion);
      record.lockRing.rotation.z += dt * 2.6;
      record.lockRing.scale.setScalar(1.12 + Math.sin(elapsed * 8) * 0.05);
    }
  }
  for (const [_projectileId, projectile] of projectileRecords.entries()) {
    if (!projectile.mesh.parent) projectileRecords.delete(_projectileId);
  }
  for (let index = effects.length - 1; index >= 0; index -= 1) {
    const effect = effects[index];
    effect.age += dt;
    if (effect.age >= effect.life) {
      effect.group.removeFromParent();
      disposeObject3D(effect.group);
      effects.splice(index, 1);
      continue;
    }
    const progress = effect.age / effect.life;
    effect.group.scale.setScalar(MathUtils.lerp(effect.startScale, effect.endScale, progress));
    effect.group.rotation.z += dt * effect.spin;
    effect.group.quaternion.copy(camera.quaternion);
    effect.group.position.addScaledVector(effect.velocity, dt);
    effect.group.traverse((child) => {
      const material = (child as Mesh).material as MeshBasicMaterial | undefined;
      if (material?.opacity !== undefined) material.opacity = Math.max(0, 1 - progress);
      const velocity = child.userData.velocity as Vector3 | undefined;
      if (velocity) child.position.addScaledVector(velocity, dt);
    });
  }
  void runProgress;
}

export function disposeVisuals() {
  clearEffects();
  enemyRecords.clear({ dispose: true, pending: true });
  projectileRecords.clear({ dispose: true, pending: true });
  environmentRoot?.removeFromParent();
  effectRoot?.removeFromParent();
  if (finaleGroup) {
    finaleGroup.removeFromParent();
    disposeObject3D(finaleGroup);
  }
  finaleGroup = null;
  environmentRoot = null;
  effectRoot = null;
  environmentLights = [];
  candles = [];
}
