import {
  AdditiveBlending,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Color,
  Fog,
  Group,
  LineSegments,
  MathUtils,
  Mesh,
  Object3D,
  OctahedronGeometry,
  RingGeometry,
  Scene,
  Vector3,
} from 'three';
import type { PerspectiveCamera } from 'three';
import { LineBasicNodeMaterial } from 'three/webgpu';
import type { CameraFeelRig, CameraFeelShakeOptions } from '../../../engine/camera-feel';
import { colorForLockCount } from '../../../engine/locks';
import { createPendingVisualRecords } from '../../../engine/visual-kit';
import type { EventBus } from '../../../events';
import { CLAW_DROP, CLAW_RADIUS, clawAngle, DESCENDER_SCALE, type DescenderState } from '../descender';
import { BAR, BEAT, bar, LIGHTNING_STRIKES, SKYHOOK_MARKERS } from '../timing';
import {
  altitudeAt,
  climbSpeedAt,
  DECK_ALTITUDE,
  HEAD_HEIGHT,
  SKYHOOK_PLAYER_HEALTH,
  STATION_ALTITUDE,
  TETHER_X,
  TETHER_Y,
} from '../world';
import { createDescenderMesh, poseDescender } from './descender-mesh';
import { createBracket, createEffects, createTelegraphLines, type Effects } from './effects';
import {
  createBoltMesh,
  createClawMesh,
  createGrapplerMesh,
  createKiteMesh,
  createSentinelMesh,
  createTickMesh,
  initEnemyKit,
  poseClaw,
  poseGrappler,
  poseKite,
  poseSentinel,
  poseTick,
} from './enemies';
import {
  createClouds,
  createDebris,
  createDriveHead,
  createLaunchPad,
  createStation,
  createStreaks,
  createTether,
  type Clouds,
  type DebrisField,
  type DriveHead,
  type Station,
  type Streaks,
  type Tether,
} from './environment';
import { createLetterMesh, initLetterKit, setLetterState } from './letters';
import { ambientUniform, flashLightUniform, glowMaterial, setColorUniform, sunColorUniform, sunDirectionUniform } from './materials';
import {
  AMBER,
  BEACON_RED,
  BONE,
  DEEP_VIOLET,
  DENY_RED,
  FROST,
  GRAPHITE,
  GUNMETAL,
  HAZARD,
  hdr,
  HULL_WHITE,
  LOCK_GRADIENT,
  PANEL_GREY,
  SKY_KEYS,
  SLATE,
  STEEL,
  STORM_VIOLET,
  srgb,
  SUN_DIRECTION,
  TRACER_WHITE,
  type SkyKey,
} from './palette';
import { flashColorUniform, flashUniform, veilColorUniform, veilUniform } from './post-fx';
import { createSky, skyUniforms, type Sky } from './sky';

// Visual spine: palette application, the sky's arc, and every event's look.

initEnemyKit({
  membrane: SLATE,
  bone: BONE,
  gunmetal: GUNMETAL,
  frost: FROST,
  glow: hdr(STORM_VIOLET, 1.3),
  hotGlow: hdr(srgb(0.84, 0.66, 1.0), 1.8),
  thruster: hdr(new Color(0.7, 0.55, 1.0), 1.4),
});
initLetterKit({
  plate: GRAPHITE,
  cell: new Color(0.95, 0.95, 0.92),
  frame: HAZARD,
  lockedCell: hdr(AMBER, 1.5),
  lockedFrame: hdr(HAZARD, 2.2),
  denied: hdr(DENY_RED, 1.8),
});

const AIR_KEYS: Array<[number, number]> = [
  [0, 1],
  [bar(8), 0.85],
  [bar(15), 0.6],
  [bar(18), 0.18],
  [bar(21), 0],
];

// Rain → cloud spray → wind streaks → ice glints → nothing.
const STREAK_KEYS: Array<{ time: number; amount: number; color: Color; fall: number }> = [
  { time: 0, amount: 1, color: new Color(0.42, 0.46, 0.52), fall: 34 },
  { time: bar(7), amount: 1, color: new Color(0.55, 0.58, 0.62), fall: 30 },
  { time: bar(8, 1), amount: 0.35, color: new Color(0.55, 0.6, 0.7), fall: 12 },
  { time: bar(15), amount: 0.22, color: new Color(0.5, 0.58, 0.72), fall: 6 },
  { time: bar(18), amount: 0.12, color: new Color(0.6, 0.66, 0.85), fall: 2 },
  { time: bar(21), amount: 0, color: new Color(0.6, 0.66, 0.85), fall: 0 },
];

const DEBRIS_KEYS: Array<[number, number]> = [
  [0, 0],
  [bar(16), 0],
  [bar(18), 0.5],
  [bar(22), 1],
  [bar(29), 0.7],
  [bar(31), 0],
];

const ENEMY_SCALE: Record<string, number> = {
  kite: 1.3,
  grappler: 1.25,
  tick: 1.05,
  sentinel: 1.3,
  bolt: 1,
  claw: 2.3,
  maw: DESCENDER_SCALE,
  letter: 1,
};

const BRACKET_SIZE: Record<string, number> = {
  kite: 1.9,
  grappler: 1.7,
  tick: 1.5,
  sentinel: 2.1,
  bolt: 0.9,
  claw: 3.4,
  maw: 12,
  letter: 1.65,
};

const KILL_COLOR: Record<string, Color> = {
  kite: SLATE.clone().lerp(BONE, 0.35),
  grappler: GUNMETAL.clone().lerp(BONE, 0.3),
  tick: FROST,
  sentinel: GUNMETAL.clone().lerp(FROST, 0.4),
  bolt: STORM_VIOLET,
  claw: FROST,
  maw: FROST,
  letter: HULL_WHITE,
};

const DOCKED_GREEN = srgb(0.3, 1.0, 0.45);

const CAMERA_SHAKE: CameraFeelShakeOptions = {
  decay: 2.4,
  maxTrauma: 1.6,
  pitchDegrees: 0.4,
  yawDegrees: 0.32,
  rollDegrees: 0.8,
  frequency: 9,
  smoothing: 18,
};

// ---- state -----------------------------------------------------------------------

type EnemyRecord = {
  mesh: Group;
  kind: string;
  bornAt: number;
  bracket: Group | null;
  bracketAt: number;
  lockCount: number;
  deniedUntil: number;
};

type World = {
  scene: Scene;
  sky: Sky;
  clouds: Clouds;
  tether: Tether;
  head: DriveHead;
  pad: ReturnType<typeof createLaunchPad>;
  streaks: Streaks;
  debris: DebrisField;
  station: Station;
  effects: Effects;
  telegraph: ReturnType<typeof createTelegraphLines>;
  lightning: ReturnType<typeof createLightning>;
  fog: Fog;
  brackets: Group;
};

let world: World | null = null;
let elapsedNow = 0;
let beatPulse = 0;
let downbeatPulse = 0;
let flash = 0;
let hullFlash = 0;
let rejectUntil = -1;
let hullDamage = 0;
let alarm = 0;
let lastRunTime = 0;
let nextStrike = 0;
let strikeFlash = 0;
let corpse: { mesh: Group; velocity: Vector3; spin: Vector3; age: number } | null = null;
let feelRig: CameraFeelRig | null = null;
const lockedMeshes = new Set<Group>();

const enemyRecords = createPendingVisualRecords<Group, EnemyRecord, [string]>({
  createRecord: (mesh, kind) => ({ mesh, kind, bornAt: elapsedNow, bracket: null, bracketAt: 0, lockCount: 0, deniedUntil: -1 }),
  disposeRecord: (record) => detachBracket(record),
});
const meshToId = new WeakMap<Object3D, number>();
const projectileMeshes = new Set<Group>();

// ---- construction ----------------------------------------------------------------

export function createEnvironment(scene: Scene) {
  // Module state outlives a level reload; start every session clean.
  enemyRecords.clear({ dispose: true, pending: true });
  pendingKinds.length = 0;
  projectileMeshes.clear();
  lockedMeshes.clear();
  corpse = null;
  const fog = new Fog(SKY_KEYS[0].fog.clone(), SKY_KEYS[0].fogNear, SKY_KEYS[0].fogFar);
  scene.fog = fog;
  scene.background = SKY_KEYS[0].zenith.clone();

  const sky = createSky();
  scene.add(sky.root);

  const clouds = createClouds({
    seed: 91,
    tetherX: TETHER_X,
    tetherY: TETHER_Y,
    scud: { count: 170, from: 60, to: DECK_ALTITUDE - 30 },
    deck: { count: 230, base: DECK_ALTITUDE - 18, top: DECK_ALTITUDE + 60 },
    cirrus: { count: 22, from: DECK_ALTITUDE + 260, to: DECK_ALTITUDE + 1100 },
  });
  scene.add(clouds.root);

  const tether = createTether(
    { x: TETHER_X, y: TETHER_Y, from: -20, to: STATION_ALTITUDE + 600, markerSpacing: 24, lampSpacing: 48 },
    { ribbon: srgb(0.24, 0.25, 0.27), rail: srgb(0.78, 0.78, 0.76), marker: HAZARD, lamp: hdr(AMBER, 1.6) },
  );
  scene.add(tether.root);

  const head = createDriveHead({ hull: HULL_WHITE, graphite: GRAPHITE, hazard: HAZARD, steel: STEEL });
  head.root.scale.setScalar(0.62);
  scene.add(head.root);

  const pad = createLaunchPad({ x: TETHER_X, y: TETHER_Y }, { hull: HULL_WHITE, hazard: HAZARD, graphite: GRAPHITE, lamp: BEACON_RED });
  scene.add(pad.root);

  const streaks = createStreaks(520, 17);
  scene.add(streaks.root);
  const debris = createDebris(70, 23, new Color(0.36, 0.36, 0.38));
  scene.add(debris.root);

  const station = createStation(
    { x: TETHER_X, y: TETHER_Y, altitude: STATION_ALTITUDE, throatRadius: 14 },
    { hull: HULL_WHITE, panel: PANEL_GREY, hazard: HAZARD, graphite: GRAPHITE, steel: STEEL, solar: new Color(0.1, 0.13, 0.24), lamp: AMBER, beacon: BEACON_RED },
  );
  scene.add(station.root);

  const effects = createEffects(scene, { fragments: 420, sparks: 520, rings: 28 });
  const telegraph = createTelegraphLines(12);
  scene.add(telegraph.root);
  const lightning = createLightning();
  scene.add(lightning.root);
  const brackets = new Group();
  scene.add(brackets);

  world = { scene, sky, clouds, tether, head, pad, streaks, debris, station, effects, telegraph, lightning, fog, brackets };
  applySky(0);
  return world;
}

// ---- enemy factories -----------------------------------------------------------------

export function createEnemyMesh(kind: string, letter?: string): Object3D {
  const mesh = buildEnemyMesh(kind, letter);
  mesh.userData.kind = kind;
  mesh.scale.setScalar(0.001);
  enemyRecords.enqueue(mesh);
  pendingKinds.push(kind);
  return mesh;
}

const pendingKinds: string[] = [];

function buildEnemyMesh(kind: string, letter?: string): Group {
  switch (kind) {
    case 'letter':
      return createLetterMesh(letter ?? 'A');
    case 'kite':
      return createKiteMesh();
    case 'grappler':
      return createGrapplerMesh();
    case 'tick':
      return createTickMesh();
    case 'sentinel':
      return createSentinelMesh();
    case 'bolt':
      return createBoltMesh();
    case 'claw':
      return createClawMesh();
    case 'maw':
      return createDescenderMesh({ carapace: GUNMETAL, frost: FROST, bone: BONE, glow: hdr(STORM_VIOLET, 1.1), hotGlow: hdr(STORM_VIOLET, 1.5) });
    default:
      return createKiteMesh();
  }
}

export function setEnemyLocked(mesh: Object3D, locked: boolean, lockCount = 1) {
  const group = mesh as Group;
  if (group.userData.isLetter) setLetterState(group, locked ? 'locked' : 'idle');
  const id = meshToId.get(mesh);
  const record = id === undefined ? undefined : enemyRecords.get(id);
  if (!record || !world) return;
  if (locked) {
    record.lockCount += 1;
    attachBracket(record, colorForLockCount(lockCount, LOCK_GRADIENT));
    lockedMeshes.add(group);
  } else {
    record.lockCount = 0;
    detachBracket(record);
    lockedMeshes.delete(group);
  }
}

export function setEnemyDenied(mesh: Object3D) {
  const group = mesh as Group;
  if (group.userData.isLetter) setLetterState(group, 'denied');
  const id = meshToId.get(mesh);
  const record = id === undefined ? undefined : enemyRecords.get(id);
  if (record) record.deniedUntil = elapsedNow + 0.45;
  world?.effects.ring(mesh.position, { color: hdr(DENY_RED, 1.4), from: 0.6 * screenScale(mesh.position), to: 1.3 * screenScale(mesh.position), life: 0.35 });
  rejectUntil = elapsedNow + 0.45;
}

function attachBracket(record: EnemyRecord, color: Color) {
  if (!world) return;
  detachBracket(record);
  const bracket = createBracket(hdr(color, 1.6));
  bracket.scale.setScalar(BRACKET_SIZE[record.kind] ?? 1.8);
  world.brackets.add(bracket);
  record.bracket = bracket;
  record.bracketAt = elapsedNow;
}

function detachBracket(record: EnemyRecord) {
  if (!record.bracket) return;
  record.bracket.removeFromParent();
  record.bracket = null;
}

// ---- player hardware ---------------------------------------------------------------------

const tracerCoreGeometry = new BoxGeometry(0.09, 0.09, 1.6);
const tracerShellGeometry = new OctahedronGeometry(0.28, 0).scale(0.7, 0.7, 4.2);
const tracerCore = glowMaterial(hdr(TRACER_WHITE, 2.4));
const tracerShell = glowMaterial(hdr(HAZARD, 1.5), { additive: true, opacity: 0.8 });

export function createProjectileMesh() {
  const group = new Group();
  group.add(new Mesh(tracerCoreGeometry, tracerCore));
  group.add(new Mesh(tracerShellGeometry, tracerShell));
  projectileMeshes.add(group);
  return group;
}

const reticleWhite = new LineBasicNodeMaterial({ color: new Color(0.95, 0.95, 0.92), transparent: true, depthTest: false, depthWrite: false });
const reticlePipIdle = glowMaterial(new Color(0.32, 0.32, 0.3), { opacity: 0.8 });
const reticlePipLit = glowMaterial(hdr(HAZARD, 1.6));
const reticlePipFault = glowMaterial(hdr(DENY_RED, 1.8));

export function createReticle() {
  const root = new Group();
  const v: number[] = [];
  // Corner ticks and a centre cross — survey-instrument plain.
  for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) {
    v.push(sx * 0.9, sy * 0.9, 0, sx * 0.9 - sx * 0.3, sy * 0.9, 0);
    v.push(sx * 0.9, sy * 0.9, 0, sx * 0.9, sy * 0.9 - sy * 0.3, 0);
  }
  v.push(-0.14, 0, 0, 0.14, 0, 0, 0, -0.14, 0, 0, 0.14, 0);
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(v), 3));
  const ticks = new LineSegments(geometry, reticleWhite);
  ticks.renderOrder = 30;
  root.add(ticks);
  const pips: Mesh[] = [];
  for (let i = 0; i < 6; i += 1) {
    const start = Math.PI / 2 - (i + 1) * (Math.PI / 3) + 0.08;
    const pip = new Mesh(new RingGeometry(0.62, 0.72, 10, 1, start, Math.PI / 3 - 0.16), reticlePipIdle);
    pip.renderOrder = 30;
    root.add(pip);
    pips.push(pip);
  }
  const ring = new Group();
  ring.add(ticks);
  for (const pip of pips) ring.add(pip);
  root.add(ring);
  root.userData.parts = { ring, pips, ticks };
  root.traverse((child) => {
    const material = (child as Mesh).material as { depthTest?: boolean } | undefined;
    if (material) material.depthTest = false;
  });
  return root;
}

export function setReticleActive(reticle: Object3D, active: boolean, lockCount: number) {
  const { ring, pips } = reticle.userData.parts as { ring: Group; pips: Mesh[] };
  const fault = elapsedNow < rejectUntil;
  pips.forEach((pip, i) => {
    pip.material = fault ? reticlePipFault : i < lockCount ? reticlePipLit : reticlePipIdle;
  });
  const target = active ? 1.12 : 1;
  ring.scale.setScalar(MathUtils.lerp(ring.scale.x, target, 0.25) + (fault ? Math.sin(elapsedNow * 60) * 0.03 : 0));
  ring.rotation.z = active ? Math.sin(elapsedNow * 1.4) * 0.08 : 0;
}

// ---- events -------------------------------------------------------------------------------

export function installVisualEventHandlers(bus: EventBus, scene: Scene, feel: CameraFeelRig) {
  void scene;
  feelRig = feel;

  bus.on('spawn', ({ enemyId, kind, worldPosition }) => {
    const pendingKind = pendingKinds.shift() ?? kind;
    const record = enemyRecords.claim(enemyId, pendingKind);
    if (record) meshToId.set(record.mesh, enemyId);
    if (!world || kind === 'letter') return;
    if (kind === 'sentinel') world.effects.sparkBurst(worldPosition, { count: 10, color: hdr(STORM_VIOLET, 1.2), speed: 5, life: 0.4, length: 1, gravity: 0, drag: 0 });
  });

  bus.on('lock', ({ worldPosition, lockCount }) => {
    if (!world) return;
    const color = colorForLockCount(lockCount, LOCK_GRADIENT);
    const reach = screenScale(worldPosition);
    world.effects.ring(worldPosition, { color: hdr(color, 1.4), from: 1.3 * reach, to: 0.55 * reach, life: 0.18 });
    if (lockCount === 6) {
      world.effects.ring(worldPosition, { color: hdr(HAZARD, 2), from: 0.5 * reach, to: 1.8 * reach, life: 0.35 });
      feelRig?.kickFov(-1.4, { decay: 6 });
    }
  });

  bus.on('fire', ({ worldPosition, volleySize, indexInVolley }) => {
    if (!world) return;
    world.effects.sparkBurst(worldPosition, { count: 4, color: hdr(AMBER, 1.2), speed: 6, life: 0.2, length: 1.4, gravity: 0, drag: 0 });
    if ((indexInVolley ?? 0) === 0) {
      world.effects.ring(worldPosition, { color: hdr(TRACER_WHITE, 1), from: 0.3, to: 0.8 + volleySize * 0.12, life: 0.2 });
      if (volleySize >= 6) {
        feelRig?.kickFov(2.4, { decay: 5 });
        feelRig?.shake(0.28);
      }
    }
  });

  bus.on('hit', ({ worldPosition, lethal, enemyId, stageCompleted }) => {
    if (!world || lethal) return;
    const record = enemyRecords.get(enemyId);
    const kind = record?.kind ?? '';
    world.effects.sparkBurst(worldPosition, { count: 12, color: hdr(AMBER, 1.5), speed: 12, life: 0.35, length: 1.2, gravity: 8, drag: 2 });
    world.effects.ring(worldPosition, { color: hdr(TRACER_WHITE, 1.2), from: 0.25 * screenScale(worldPosition), to: 0.8 * screenScale(worldPosition), life: 0.14, filled: true });
    world.effects.burst(worldPosition, { count: stageCompleted ? 12 : 4, color: KILL_COLOR[kind] ?? FROST, speed: 8, size: 0.2, life: 1.4, gravity: gravityNow(), drag: dragNow(), carry: carryNow() });
    if (kind === 'maw') {
      feelRig?.shake(0.22);
      flash = Math.max(flash, 0.12);
    }
  });

  bus.on('kill', ({ enemyId, worldPosition, indexInVolley }) => {
    if (!world) return;
    const record = enemyRecords.get(enemyId);
    const kind = record?.kind ?? 'letter';
    const air = airDensity(lastRunTime);
    const color = KILL_COLOR[kind] ?? FROST;
    if (kind === 'letter') {
      world.effects.ring(worldPosition, { color: hdr(HAZARD, 1.6), from: 0.8, to: 3.4, life: 0.4 });
      world.effects.burst(worldPosition, { count: 10, color: HULL_WHITE, speed: 7, size: 0.18, life: 1.1, gravity: 6, drag: 1.5 });
    } else if (kind === 'maw') {
      killDescender(record);
    } else {
      const big = kind === 'sentinel' || kind === 'claw';
      world.effects.burst(worldPosition, { count: big ? 22 : 14, color, speed: big ? 12 : 9, size: big ? 0.36 : 0.26, life: 2.2, gravity: gravityNow(), drag: dragNow(), carry: carryNow() });
      world.effects.burst(worldPosition, { count: 4, color: hdr(STORM_VIOLET, 1.3), speed: 6, size: 0.14, life: 0.8, gravity: gravityNow(), drag: dragNow(), carry: carryNow() });
      world.effects.sparkBurst(worldPosition, { count: 18, color: hdr(AMBER, 1.6), speed: 16, life: 0.5, length: 1.6, gravity: 10 * air, drag: 1.5 * air, carry: carryNow() });
      const reach = screenScale(worldPosition);
      world.effects.ring(worldPosition, { color: hdr(TRACER_WHITE, 1.3), from: 0.2 * reach, to: (big ? 1.1 : 0.8) * reach, life: 0.24 });
      world.effects.ring(worldPosition, { color: hdr(STORM_VIOLET, 0.9), from: 0.4 * reach, to: (big ? 1.5 : 1.15) * reach, life: 0.36 });
      if ((indexInVolley ?? 0) >= 5) feelRig?.shake(0.2);
    }
    enemyRecords.delete(enemyId, { dispose: true });
    lockedMeshes.delete(record?.mesh as Group);
  });

  bus.on('miss', ({ enemyId, worldPosition }) => {
    if (!world) return;
    const record = enemyRecords.get(enemyId);
    const kind = record?.kind ?? '';
    const phase = record?.mesh.userData.phase as string | undefined;
    if (phase === 'bitten') {
      // It took its bite and lets go: a shower of torn panel off the drive head.
      world.effects.burst(worldPosition, { count: 10, color: HULL_WHITE, speed: 6, size: 0.24, life: 2, gravity: gravityNow(), drag: dragNow(), carry: carryNow() });
      world.effects.burst(worldPosition, { count: 6, color: HAZARD, speed: 5, size: 0.2, life: 2, gravity: gravityNow(), drag: dragNow(), carry: carryNow() });
    } else if (kind !== 'letter' && kind !== 'maw') {
      world.effects.ring(worldPosition, { color: hdr(DEEP_VIOLET, 1.2), from: 0.8 * screenScale(worldPosition), to: 0.2 * screenScale(worldPosition), life: 0.3 });
    }
    enemyRecords.delete(enemyId, { dispose: true });
  });

  bus.on('reject', () => {
    rejectUntil = elapsedNow + 0.45;
  });

  bus.on('beat', ({ isDownbeat }) => {
    beatPulse = 1;
    if (isDownbeat) downbeatPulse = 1;
  });

  bus.on('playerhit', ({ healthRemaining }) => {
    hullFlash = 1;
    hullDamage = MathUtils.clamp(1 - healthRemaining / SKYHOOK_PLAYER_HEALTH, 0, 1);
    feelRig?.shake(0.9);
    if (!world) return;
    const headPosition = world.head.root.position;
    world.effects.sparkBurst(headPosition, { count: 40, color: hdr(AMBER, 1.8), speed: 14, life: 0.7, length: 1.8, gravity: 12, drag: 1, carry: carryNow() });
    world.effects.burst(headPosition, { count: 14, color: HULL_WHITE, speed: 7, size: 0.3, life: 2.4, gravity: gravityNow(), drag: dragNow(), carry: carryNow() });
  });

  bus.on('stage', ({ worldPosition }) => {
    world?.effects.ring(worldPosition, { color: hdr(STORM_VIOLET, 1.4), from: 0.4 * screenScale(worldPosition), to: 1.5 * screenScale(worldPosition), life: 0.3 });
  });

  bus.on('bossphase', ({ phase }) => {
    if (phase === 'summoned') {
      flash = Math.max(flash, 0.25);
      flashColorUniform.value.set(0.55, 0.4, 0.9);
      feelRig?.shake(0.5);
    }
    if (phase === 'exposed') {
      feelRig?.shake(0.4);
    }
  });

  bus.on('runend', ({ died }) => {
    if (!died || !world) return;
    // The climber is torn apart: the drive head bursts and is gone.
    const headPosition = world.head.root.position.clone();
    world.effects.burst(headPosition, { count: 60, color: HULL_WHITE, speed: 14, size: 0.5, life: 4, gravity: gravityNow(), drag: dragNow() });
    world.effects.burst(headPosition, { count: 30, color: HAZARD, speed: 12, size: 0.4, life: 4, gravity: gravityNow(), drag: dragNow() });
    world.effects.sparkBurst(headPosition, { count: 120, color: hdr(AMBER, 2), speed: 24, life: 1.2, length: 2, gravity: 0, drag: 0 });
    world.head.root.visible = false;
    flash = 0.8;
    flashColorUniform.value.set(1.0, 0.5, 0.25);
    feelRig?.shake(1.6);
  });

  bus.on('runstart', () => {
    world?.effects.clear();
    if (world) world.head.root.visible = true;
    hullDamage = 0;
    alarm = 0;
    corpse?.mesh.removeFromParent();
    corpse = null;
    nextStrike = 0;
    enemyRecords.clear({ dispose: true, pending: false });
  });
}

function killDescender(record: EnemyRecord | undefined) {
  if (!world || !record) return;
  const mesh = record.mesh;
  flash = 1;
  flashColorUniform.value.set(0.9, 0.82, 1.0);
  feelRig?.shake(1.4);
  feelRig?.kickFov(4, { decay: 2.5 });
  const position = mesh.position.clone();
  for (let i = 0; i < 4; i += 1) {
    world.effects.burst(position.clone().add(new Vector3((Math.random() - 0.5) * 14, (Math.random() - 0.5) * 14, (Math.random() - 0.5) * 10)), { count: 40, color: i % 2 ? FROST : GUNMETAL, speed: 16, size: 0.9, life: 4, gravity: 0, drag: 0 });
  }
  world.effects.sparkBurst(position, { count: 120, color: hdr(STORM_VIOLET, 2), speed: 30, life: 1.2, length: 2.5, gravity: 0, drag: 0 });
  world.effects.ring(position, { color: hdr(TRACER_WHITE, 1.6), from: 2, to: 16, life: 0.6 });
  world.effects.ring(position, { color: hdr(STORM_VIOLET, 1.2), from: 4, to: 24, life: 1.1 });
  // The husk loses its grip and falls away past the car, tumbling.
  world.scene.add(mesh);
  corpse = { mesh, velocity: new Vector3(9, 3, 4), spin: new Vector3(0.5, 0.9, 0.2), age: 0 };
}

// ---- per-frame --------------------------------------------------------------------------

export type VisualFrame = {
  camera: PerspectiveCamera;
  elapsed: number;
  runTime: number;
  mode: 'attract' | 'running' | 'ended';
  descender: DescenderState;
  health: number;
};

const skyScratch = { key: SKY_KEYS[0] };
const colorA = new Color();
const planetCenter = new Vector3();
const headTarget = new Vector3();
const toTarget = new Vector3();
const camRight = new Vector3();
const camUp = new Vector3();
const airVelocity = new Vector3();
const lastPositions = new WeakMap<Object3D, Vector3>();

export function updateVisuals(dt: number, frame: VisualFrame) {
  if (!world) return;
  elapsedNow = frame.elapsed;
  viewer = frame.camera.position;
  const runTime = frame.mode === 'attract' ? 0 : frame.runTime;
  lastRunTime = runTime;
  const altitude = altitudeAt(runTime);
  const climb = frame.mode === 'running' ? climbSpeedAt(runTime) : frame.mode === 'attract' ? 0 : 0;
  const cameraZ = frame.camera.position.z;

  beatPulse = Math.max(0, beatPulse - dt * 4);
  downbeatPulse = Math.max(0, downbeatPulse - dt * 2.5);
  flash = Math.max(0, flash - dt * 3);
  hullFlash = Math.max(0, hullFlash - dt * 2.2);

  applySky(runTime);
  world.sky.update(frame.camera.position);
  skyUniforms.drift.value = altitude * 0.0016;

  // Weather: lightning lands on authored storm beats.
  updateLightning(runTime, frame, dt);

  // The punch through the deck: a veil of cloud, then light.
  const deckDistance = Math.abs(altitude - DECK_ALTITUDE - 18);
  const veil = frame.mode === 'running' ? MathUtils.clamp(1 - deckDistance / 55, 0, 1) : 0;
  veilUniform.value = veil * 0.72;
  flashUniform.value = flash * 0.55 + strikeFlash * 0.35;
  flashLightUniform.value = strikeFlash * 0.45 + flash * 0.3 + hullFlash * 0.12;

  // Environment follow and animation.
  const air = airDensity(runTime);
  const streak = sampleStreaks(runTime);
  world.streaks.color.value.set(streak.color.r, streak.color.g, streak.color.b);
  world.streaks.update(cameraZ, climb + streak.fall, 6 * air, streak.amount, dt);
  world.debris.update(cameraZ, climb * 0.9 + 6, sampleKeys(DEBRIS_KEYS, runTime), dt, frame.elapsed);
  world.tether.lampGlow.value = 0.5 + beatPulse * 1.1;
  world.pad.root.visible = altitude < 600;
  world.pad.lampMaterial.color.copy(hdr(BEACON_RED, 0.5 + downbeatPulse * 1.8));
  world.station.update(MathUtils.smoothstep(runTime, bar(29, 2), bar(30, 3)), frame.elapsed);
  // Inside the throat the lamps settle; the clamps seal on the last downbeat and go green.
  const sealed = MathUtils.smoothstep(runTime, SKYHOOK_MARKERS.docked, SKYHOOK_MARKERS.docked + BEAT);
  world.station.throatLamps.value = MathUtils.lerp(0.7 + beatPulse * 0.8, 0.45, sealed);
  const blink = frame.mode === 'running' && sealed < 0.5 ? (Math.sin(frame.elapsed * 12) > 0 ? 1.6 : 0.25) : 1.4;
  setColorUniform(world.station.dockLampColor, colorA.copy(HAZARD).lerp(DOCKED_GREEN, sealed).multiplyScalar(blink));

  // Drive head rides with the car.
  const head = world.head;
  head.root.position.set(TETHER_X, TETHER_Y, -(altitude + HEAD_HEIGHT));
  for (const wheel of head.wheels) wheel.rotation.x += (climb / 0.46) * dt;
  (head.beams as Object3D).visible = air > 0.05;
  head.beams.traverse((child) => {
    const mesh = child as Mesh;
    if (mesh.isMesh) mesh.visible = air > 0.05;
  });
  const beaconMaterial = head.beacon.material as unknown as { color: Color };
  const critical = frame.health <= 1;
  beaconMaterial.color.copy(critical ? hdr(BEACON_RED, Math.sin(frame.elapsed * 14) > 0 ? 2.2 : 0.3) : hdr(HAZARD, 0.8 + downbeatPulse * 1.6));
  const strobeMaterial = head.strobe.material as unknown as { color: Color };
  alarm = Math.max(0, alarm - dt * 2);
  strobeMaterial.color.copy(alarm > 0.05 ? hdr(BEACON_RED, Math.sin(frame.elapsed * 30) > 0 ? 2.4 : 0.2) : hdr(HAZARD, 0.6));
  if (hullDamage > 0 && frame.mode === 'running' && Math.random() < dt * (3 + hullDamage * 10)) {
    world.effects.sparkBurst(head.root.position.clone().add(new Vector3((Math.random() - 0.5) * 2, 1, (Math.random() - 0.5) * 1.5)), { count: 3, color: hdr(AMBER, 1.4), speed: 5, life: 0.4, length: 1, gravity: 10 * air, drag: 2 * air, carry: carryNow() });
  }

  // Enemies.
  camRight.setFromMatrixColumn(frame.camera.matrixWorld, 0);
  camUp.setFromMatrixColumn(frame.camera.matrixWorld, 1);
  world.telegraph.begin();
  for (const [, record] of enemyRecords.entries()) animateEnemy(record, frame, dt);
  world.telegraph.end();

  // Lock brackets follow their targets and turn toward the camera.
  for (const [, record] of enemyRecords.entries()) {
    if (!record.bracket) continue;
    const since = frame.elapsed - record.bracketAt;
    const base = BRACKET_SIZE[record.kind] ?? 1.8;
    const snap = 1 + Math.max(0, 0.25 - since) * 3;
    record.bracket.position.copy(record.mesh.position);
    record.bracket.quaternion.copy(frame.camera.quaternion);
    record.bracket.rotateZ(Math.PI / 4 * Math.max(0, 1 - since * 6) + since * 0.8);
    record.bracket.scale.setScalar(base * snap * (1 + record.lockCount * 0.06));
  }

  // Tracers leave a short orange wake.
  for (const mesh of projectileMeshes) {
    if (!mesh.parent) {
      projectileMeshes.delete(mesh);
      continue;
    }
    const last = lastPositions.get(mesh);
    if (last && frame.mode !== 'attract') world.effects.sparkBurst(mesh.position, { count: 1, color: hdr(HAZARD, 0.9), speed: 0.4, life: 0.18, length: 0.2, gravity: 0, drag: 0 });
    lastPositions.set(mesh, mesh.position.clone());
  }

  // The Descender's husk falls away.
  if (corpse) {
    corpse.age += dt;
    corpse.velocity.z += 14 * dt;
    corpse.mesh.position.addScaledVector(corpse.velocity, dt);
    corpse.mesh.rotation.x += corpse.spin.x * dt;
    corpse.mesh.rotation.y += corpse.spin.y * dt;
    corpse.mesh.rotation.z += corpse.spin.z * dt;
    if (corpse.age > 6) {
      corpse.mesh.removeFromParent();
      corpse = null;
    }
  }

  airVelocity.set(0, 0, 0);
  world.effects.update(dt, frame.camera, airVelocity);
}

function animateEnemy(record: EnemyRecord, frame: VisualFrame, dt: number) {
  if (!world) return;
  const mesh = record.mesh;
  const data = mesh.userData;
  const age = frame.elapsed - record.bornAt;
  const grow = MathUtils.smoothstep(age, 0, 0.3);
  const denied = frame.elapsed < record.deniedUntil;
  const scale = (ENEMY_SCALE[record.kind] ?? 1) * grow * (denied ? 1 + Math.sin(frame.elapsed * 50) * 0.12 : 1);
  if (record.kind === 'letter') {
    if (!denied && data.isLetter && !lockedMeshes.has(mesh)) setLetterState(mesh, 'idle');
    mesh.scale.setScalar(Math.max(0.001, grow));
    return;
  }
  const close = record.kind === 'grappler' && (data.phase === 'dive' || data.phase === 'gnaw') ? 0.62 : 1;
  data.closeScale = MathUtils.lerp((data.closeScale as number | undefined) ?? 1, close, 0.12);
  mesh.scale.setScalar(Math.max(0.001, scale * (data.closeScale as number)));
  const id = mesh.id;

  switch (record.kind) {
    case 'kite': {
      const heading = (data.heading as number | undefined) ?? 0;
      const turn = MathUtils.clamp((data.turn as number | undefined) ?? 0, -1.1, 1.1);
      mesh.quaternion.copy(frame.camera.quaternion);
      mesh.rotateZ(heading - Math.PI / 2);
      const flap = 0.25 + Math.sin(age * 8.5 + id) * 0.42;
      poseKite(mesh, flap, -turn, age * 7 + id);
      break;
    }
    case 'grappler': {
      const phase = data.phase as string | undefined;
      const charge = (data.charge as number | undefined) ?? 0;
      const target = data.target as Vector3 | undefined;
      mesh.quaternion.copy(frame.camera.quaternion);
      if (target) {
        toTarget.subVectors(target, mesh.position);
        const angle = Math.atan2(toTarget.dot(camUp), toTarget.dot(camRight));
        mesh.rotateZ(angle + Math.PI / 2);
        if (phase === 'hover' || phase === 'dive') {
          world.telegraph.add(mesh.position, target, hdr(STORM_VIOLET, 1.2), phase === 'dive' ? 1 : charge * 0.8);
          alarm = Math.max(alarm, phase === 'dive' ? 1 : charge);
        }
        if (phase === 'gnaw') {
          alarm = 1;
          if (Math.random() < dt * 22) world.effects.sparkBurst(mesh.position, { count: 2, color: hdr(AMBER, 1.6), speed: 7, life: 0.3, length: 1, gravity: 10, drag: 1, carry: carryNow() });
        }
      }
      const open = phase === 'hover' ? 0.3 + charge * 0.7 : phase === 'gnaw' ? 0.05 + Math.abs(Math.sin(age * 22)) * 0.2 : phase === 'dive' ? 0.9 : 0.2;
      poseGrappler(mesh, open, phase === 'dive' ? 1 : 0, charge > 0.6 || phase === 'gnaw');
      break;
    }
    case 'tick': {
      const progress = (data.progress as number | undefined) ?? 0;
      mesh.quaternion.identity();
      mesh.rotateY(Math.sin(age * 9) * 0.08);
      poseTick(mesh, progress * 14, data.cracked === true);
      if (progress > 0.7) alarm = Math.max(alarm, (progress - 0.7) * 3);
      break;
    }
    case 'sentinel': {
      mesh.quaternion.copy(frame.camera.quaternion);
      const charge = (data.charge as number | undefined) ?? 0;
      const thrust = (data.thrust as number | undefined) ?? 0;
      poseSentinel(mesh, charge, thrust, Math.random(), age * 0.7 + id);
      break;
    }
    case 'bolt': {
      const velocity = data.velocity as Vector3 | undefined;
      if (velocity && velocity.lengthSq() > 0.01) mesh.lookAt(headTarget.copy(mesh.position).add(velocity));
      mesh.rotateZ(age * 12);
      break;
    }
    case 'claw': {
      mesh.quaternion.copy(frame.camera.quaternion);
      const socket = (data.socket as number | undefined) ?? 0;
      poseClaw(mesh, clawAngle(socket) - Math.PI / 2, Math.max(0, Math.sin(age * 5 + socket)));
      break;
    }
    case 'maw': {
      const state = frame.descender;
      data.openAmount = MathUtils.lerp((data.openAmount as number | undefined) ?? 0, state.mawOpen ? 1 : 0, 1 - Math.exp(-dt * 3));
      mesh.quaternion.identity();
      poseDescender(mesh, {
        step: state.stepPhase,
        clawsAlive: state.clawsAlive,
        open: data.openAmount as number,
        shudder: state.slip,
        time: frame.elapsed,
        clawRadius: CLAW_RADIUS / DESCENDER_SCALE,
        clawDrop: CLAW_DROP / DESCENDER_SCALE,
        clawAngle,
      });
      // Every grip lands like a hammer on the tether; closer means harder.
      if (state.stepPhase > 0 && state.stepPhase < 0.2 && data.lastStep !== state.stepIndex) {
        data.lastStep = state.stepIndex;
        const proximity = MathUtils.clamp(1 - state.distance / 110, 0, 1);
        feelRig?.shake(0.05 + proximity * 0.35);
      }
      break;
    }
  }
}

/** World size that reads as a constant fraction of the screen at this point. */
let viewer: Vector3 | null = null;
function screenScale(position: Vector3) {
  if (!viewer) return 1;
  return MathUtils.clamp(position.distanceTo(viewer) * 0.045, 0.5, 4);
}

// ---- the sky's arc ---------------------------------------------------------------------

function sampleKeys(keys: Array<[number, number]>, time: number) {
  if (time <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i += 1) {
    if (time <= keys[i][0]) {
      const t = MathUtils.smoothstep(time, keys[i - 1][0], keys[i][0]);
      return MathUtils.lerp(keys[i - 1][1], keys[i][1], t);
    }
  }
  return keys[keys.length - 1][1];
}

function airDensity(time: number) {
  return sampleKeys(AIR_KEYS, time);
}

function gravityNow() {
  return 4 + airDensity(lastRunTime) * 16;
}

function dragNow() {
  return airDensity(lastRunTime) * 2.4;
}

const carry = new Vector3();
function carryNow() {
  // What breaks alongside the car is climbing with it.
  return carry.set(0, 0, -climbSpeedAt(lastRunTime));
}

function sampleStreaks(time: number) {
  const keys = STREAK_KEYS;
  let i = 1;
  while (i < keys.length - 1 && time > keys[i].time) i += 1;
  const a = keys[i - 1];
  const b = keys[i];
  const t = MathUtils.smoothstep(time, a.time, b.time);
  return {
    amount: MathUtils.lerp(a.amount, b.amount, t),
    fall: MathUtils.lerp(a.fall, b.fall, t),
    color: colorA.copy(a.color).lerp(b.color, t),
  };
}

const blended: SkyKey = { ...SKY_KEYS[0], zenith: new Color(), horizon: new Color(), ground: new Color(), groundCloud: new Color(), limb: new Color(), fog: new Color(), ambient: new Color(), sun: new Color() };

function applySky(time: number) {
  if (!world) return;
  let i = 1;
  while (i < SKY_KEYS.length - 1 && time > SKY_KEYS[i].time) i += 1;
  const a = SKY_KEYS[i - 1];
  const b = SKY_KEYS[i];
  const t = MathUtils.smoothstep(time, a.time, b.time);
  for (const key of ['zenith', 'horizon', 'ground', 'groundCloud', 'limb', 'fog', 'ambient', 'sun'] as const) {
    blended[key].copy(a[key]).lerp(b[key], t);
  }
  for (const key of ['cloudCover', 'planetRadius', 'limbFromZenith', 'overcast', 'stars', 'sunDisc', 'sunGlow', 'fogNear', 'fogFar'] as const) {
    blended[key] = MathUtils.lerp(a[key], b[key], t);
  }
  skyScratch.key = blended;
  const u = skyUniforms;
  setColorUniform(u.zenith, blended.zenith);
  setColorUniform(u.horizon, blended.horizon);
  setColorUniform(u.ground, blended.ground);
  setColorUniform(u.groundCloud, blended.groundCloud);
  setColorUniform(u.limb, blended.limb);
  u.cloudCover.value = blended.cloudCover;
  u.overcast.value = blended.overcast;
  u.stars.value = blended.stars;
  u.sunDisc.value = blended.sunDisc;
  u.sunGlow.value = blended.sunGlow;
  const theta = MathUtils.degToRad(blended.limbFromZenith + blended.planetRadius);
  planetCenter.set(0, -Math.sin(theta), -Math.cos(theta));
  u.planetCenter.value.copy(planetCenter);
  u.planetRadius.value = MathUtils.degToRad(blended.planetRadius);
  u.sunDirection.value.set(...SUN_DIRECTION).normalize();
  sunDirectionUniform.value.set(...SUN_DIRECTION).normalize();
  setColorUniform(ambientUniform, blended.ambient);
  setColorUniform(sunColorUniform, blended.sun);
  world.fog.color.copy(blended.fog);
  world.fog.near = blended.fogNear;
  world.fog.far = blended.fogFar;
  (world.scene.background as Color | null)?.copy(blended.zenith);

  // Cloud layers: dark undersides in the storm, white tops in the sun.
  const aboveDeck = MathUtils.smoothstep(time, SKYHOOK_MARKERS.punch, bar(8, 1));
  const clouds = world.clouds;
  setColorUniform(clouds.scud.lit, colorA.setRGB(0.3, 0.315, 0.34));
  setColorUniform(clouds.scud.shadow, colorA.setRGB(0.06, 0.065, 0.075));
  clouds.scud.opacity.value = 0.8 * (1 - aboveDeck);
  setColorUniform(clouds.deck.lit, colorA.setRGB(0.5, 0.52, 0.55).lerp(new Color(0.82, 0.84, 0.87), aboveDeck));
  setColorUniform(clouds.deck.shadow, colorA.setRGB(0.2, 0.21, 0.24).lerp(new Color(0.42, 0.5, 0.66), aboveDeck));
  clouds.deck.opacity.value = 0.9;
  setColorUniform(clouds.ceiling.lit, colorA.setRGB(0.38, 0.4, 0.43));
  setColorUniform(clouds.ceiling.shadow, colorA.setRGB(0.17, 0.18, 0.2));
  clouds.ceiling.opacity.value = 0.92 * (1 - aboveDeck);
  setColorUniform(clouds.cirrus.lit, colorA.setRGB(0.9, 0.92, 0.95));
  setColorUniform(clouds.cirrus.shadow, colorA.setRGB(0.66, 0.74, 0.88));
  clouds.cirrus.opacity.value = 0.26 * (1 - MathUtils.smoothstep(time, bar(15), bar(18)));
  veilColorUniform.value.set(0.78, 0.8, 0.83).lerp(new Vector3(0.95, 0.96, 0.98), aboveDeck);
}

// ---- lightning -------------------------------------------------------------------------

function createLightning() {
  const count = 24;
  const positions = new Float32Array(count * 6);
  const geometry = new BufferGeometry();
  const attribute = new BufferAttribute(positions, 3);
  geometry.setAttribute('position', attribute);
  const material = new LineBasicNodeMaterial({ color: hdr(new Color(0.85, 0.85, 1.0), 2.4), transparent: true, blending: AdditiveBlending, depthWrite: false });
  material.fog = false;
  const root = new LineSegments(geometry, material);
  root.frustumCulled = false;
  root.visible = false;
  root.userData.raildIgnoreOcclusion = true;
  return {
    root,
    material,
    strike(from: Vector3, down: Vector3, side: Vector3) {
      const point = from.clone();
      for (let i = 0; i < count; i += 1) {
        const next = point.clone().addScaledVector(down, 9 + Math.random() * 7).addScaledVector(side, (Math.random() - 0.5) * 14);
        positions.set([point.x, point.y, point.z, next.x, next.y, next.z], i * 6);
        point.copy(next);
      }
      attribute.needsUpdate = true;
      root.visible = true;
    },
  };
}

const strikeDown = new Vector3();
const strikeSide = new Vector3();

function updateLightning(runTime: number, frame: VisualFrame, dt: number) {
  if (!world) return;
  strikeFlash = Math.max(0, strikeFlash - dt * 5);
  const lightning = world.lightning;
  if (frame.mode !== 'running') {
    if (frame.mode === 'attract' && Math.random() < dt * 0.25) strikeFlash = 0.8;
  } else {
    while (nextStrike < LIGHTNING_STRIKES.length && runTime >= LIGHTNING_STRIKES[nextStrike]) {
      nextStrike += 1;
      strikeFlash = 1;
      // A bolt somewhere in the frame, far out in the weather.
      const sx = (Math.random() - 0.5) * 1.6;
      const from = frame.camera.position.clone()
        .add(new Vector3(0, 0, -1).applyQuaternion(frame.camera.quaternion).multiplyScalar(340))
        .add(camRight.clone().multiplyScalar(sx * 300))
        .add(camUp.clone().multiplyScalar(200));
      strikeDown.copy(camUp).multiplyScalar(-1);
      strikeSide.copy(camRight);
      lightning.strike(from, strikeDown, strikeSide);
      skyUniforms.lightningCenter.value.copy(from).sub(frame.camera.position).normalize();
      flashColorUniform.value.set(0.8, 0.84, 1.0);
    }
  }
  skyUniforms.lightning.value = strikeFlash * (0.7 + Math.random() * 0.3);
  lightning.root.visible = strikeFlash > 0.35;
  lightning.material.opacity = strikeFlash;
}

// ---- camera feel -------------------------------------------------------------------------

export function updateCameraFeel(dt: number, runTime: number, running: boolean) {
  if (!feelRig) return;
  if (running) {
    // Buffeting in the weather, a hard shove through the deck.
    const air = airDensity(runTime);
    const deckT = Math.abs(runTime - (SKYHOOK_MARKERS.punch + BEAT));
    if (deckT < BAR * 0.6) feelRig.shake(dt * 2.2);
    else if (air > 0.5 && Math.random() < dt * 3) feelRig.shake(0.04 * air);
    feelRig.setFovOffset(MathUtils.clamp((climbSpeedAt(runTime) - 60) / 70, 0, 1) * 5, { response: 3 });
  }
  feelRig.update(dt, { shake: CAMERA_SHAKE });
}


/** Inspection helper for the model snapshot tool: both words as placards. */
export function createGlyphSampler() {
  const group = new Group();
  [...'ASCEND'].forEach((letter, index) => {
    const mesh = createLetterMesh(letter);
    mesh.position.set((index - 2.5) * 2.75, 1.6, 0);
    if (index === 1) setLetterState(mesh, 'locked');
    group.add(mesh);
  });
  [...'REPLAY'].forEach((letter, index) => {
    const mesh = createLetterMesh(letter);
    mesh.position.set((index - 2.5) * 2.55, -1.6, 0);
    if (index === 4) setLetterState(mesh, 'denied');
    group.add(mesh);
  });
  return group;
}

/** Inspection helper for the model snapshot tool: the Descender mid-grip, maw half open. */
export function createDescenderSampler(open = 0.5) {
  const mesh = buildEnemyMesh('maw');
  poseDescender(mesh, {
    step: 0.4,
    clawsAlive: [true, false, true, true],
    open,
    shudder: 0,
    time: 1.3,
    clawRadius: CLAW_RADIUS / DESCENDER_SCALE,
    clawDrop: CLAW_DROP / DESCENDER_SCALE,
    clawAngle,
  });
  for (let socket = 0; socket < 4; socket += 1) {
    if (socket === 1) continue;
    const claw = createClawMesh();
    const angle = clawAngle(socket);
    claw.position.set(Math.cos(angle) * CLAW_RADIUS / DESCENDER_SCALE, Math.sin(angle) * CLAW_RADIUS * 0.92 / DESCENDER_SCALE, CLAW_DROP / DESCENDER_SCALE);
    claw.scale.setScalar(ENEMY_SCALE.claw / DESCENDER_SCALE);
    claw.rotation.set(0, 0, angle - Math.PI / 2);
    mesh.add(claw);
  }
  return mesh;
}
