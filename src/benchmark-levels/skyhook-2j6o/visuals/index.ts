import {
  CircleGeometry,
  Color,
  DoubleSide,
  Group,
  MathUtils,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  OctahedronGeometry,
  PerspectiveCamera,
  PlaneGeometry,
  RingGeometry,
  Scene,
  Vector3,
} from 'three';
import type { Camera } from 'three';
import type { CameraFeelRig, CameraFeelShakeOptions } from '../../../engine/camera-feel';
import { colorForLockCount } from '../../../engine/locks';
import {
  createAdditiveBasicMaterial,
  createAdornmentSlot,
  createPendingVisualRecords,
  configureAdditiveMaterial,
} from '../../../engine/visual-kit';
import type { EventBus } from '../../../events';
import { clawAngle, placeBossBody, placeClaw, tetherjackState } from '../boss';
import { CLAMP_SLOTS, SKYHOOK_PLAYER_HEALTH, railUnitsPerSecond, speedFactorAt } from '../gameplay';
import { RAIL_BASIS, RAIL_LENGTH, RAIL_RIGHT, RAIL_UP, railPoint, railUForPosition } from '../rail';
import { skyhookSignals } from '../signals';
import { DECK_TIME, LIGHTNING_TIMES } from '../timing';
import { coreParts, createClawMesh, createCoreMesh, updateCoreMesh } from './boss-mesh';
import { createClimberCar, restoreDeck, type ClimberCar } from './car';
import {
  breakSentinelArmor,
  createBoltMesh,
  createKiteMesh,
  createLimpetMesh,
  createMiteMesh,
  createSentinelMesh,
  createSquallMesh,
  createWreckMesh,
  dressHostile,
  setBodyState,
  tintPart,
  updateKiteMesh,
  updateLimpetMesh,
  type BodyState,
  type TintPart,
} from './enemies';
import {
  burstShards,
  burstSparks,
  createEffects,
  dropTrail,
  resetEffects,
  spawnGlint,
  spawnLightning,
  spawnRing,
  updateEffects,
  type ShardSpec,
} from './effects';
import { createEnvironmentInternal, lightningUniform, type Environment } from './environment';
import { createLetterMesh, setLetterDenied, setLetterLocked } from './letters';
import { CHARCOAL, HAZARD_ORANGE, hdr, HOSTILE_RED, INSTRUMENT, INSTRUMENT_HOT, LOCK_GRADIENT, WARNING_RED } from './palette';
import { dockUniform, flashUniform, hullUniform } from './post-fx';

// Spine: palette and event choreography live here. Every mesh, number and
// timing decision that belongs to the level's look is made in this file or in
// the leaves it calls; the engine only supplies lifecycle bookkeeping.

export type VisualContext = {
  scene: Scene;
  camera: Camera;
  elapsed: number;
  runTime: number;
  running: boolean;
  feel: CameraFeelRig;
};

export type CameraEffectsContext = {
  camera: Camera;
  runTime: number;
  running: boolean;
  feel: CameraFeelRig;
};

type EnemyRecord = {
  mesh: Group;
  bornAt: number | null;
  lockRing: Group | null;
};

type ProjectileRecord = {
  mesh: Object3D;
  trailColor: Color;
};

const DENY_LIGHT = hdr(WARNING_RED, 1.6);
const WHITE_HOT = new Color(1.0, 0.98, 0.94);
const LOCKED_EDGE = hdr(INSTRUMENT, 1.5);
const LOCKED_LIGHT = hdr(INSTRUMENT_HOT, 2.0);
const FLASH_LIGHT = hdr(WHITE_HOT, 2.0);

const SKYHOOK_SHAKE: CameraFeelShakeOptions = {
  decay: 2.4,
  maxTrauma: 1.7,
  pitchDegrees: 0.34,
  yawDegrees: 0.28,
  rollDegrees: 0.7,
  frequency: 9,
  smoothing: 20,
};

let environment: Environment | null = null;
let car: ClimberCar | null = null;
let bossProxy: { core: Group; claws: Group[] } | null = null;
let beatEnergy = 0;
let surgePulse = 0;
let elapsedNow = 0;
let lastRunTime = -1;
let lastU = -1;
let deckFlash = 0;
let hullRemaining = SKYHOOK_PLAYER_HEALTH;
let reachShake = false;
let dockTarget = 0;
let cameraRoll = 0;
let cameraFovOffset = 0;
let climbSpeed = 0;
let bossKilledAt = -1;
const scratchTint = new Color();

const lockRings = createAdornmentSlot<EnemyRecord, Group>({
  get: (record) => record.lockRing,
  set: (record, ring) => {
    record.lockRing = ring;
  },
});

// createEnemyMesh() has no id, but the game emits `spawn` synchronously right
// after calling it — pairing the queue with spawn events links mesh to id.
// Geometry is shared through the templates and never disposed here; every
// instance owns its materials, and those are released when it goes away so
// the renderer does not keep bindings for hardware that is already scrap.
function disposeInstanceMaterials(root: Object3D) {
  root.traverse((child) => {
    const material = (child as Mesh).material as MeshBasicMaterial | MeshBasicMaterial[] | undefined;
    if (!material) return;
    const materials = Array.isArray(material) ? material : [material];
    for (const entry of materials) {
      if (!entry.userData.shared) entry.dispose();
    }
  });
}

const enemyRecords = createPendingVisualRecords<Group, EnemyRecord>({
  createRecord: (mesh) => ({ mesh, bornAt: null, lockRing: null }),
  disposeRecord: (record) => {
    lockRings.detach(record);
    disposeInstanceMaterials(record.mesh);
  },
});
const projectileRecords = createPendingVisualRecords<ProjectileRecord, ProjectileRecord>({
  createRecord: (record) => record,
  disposeRecord: (record) => disposeInstanceMaterials(record.mesh),
});

export function createEnvironment(scene: Scene) {
  environment = createEnvironmentInternal(scene);
  createEffects(scene);
  car = createClimberCar();
  car.setHull(SKYHOOK_PLAYER_HEALTH, SKYHOOK_PLAYER_HEALTH);
  scene.add(car.root);
  // Stand-ins for the Tetherjack while it is a sight, not yet a target.
  const core = createCoreMesh();
  core.userData.raildIgnoreOcclusion = true;
  core.visible = false;
  const claws = [0, 1, 2].map(() => {
    const claw = createClawMesh();
    claw.userData.raildIgnoreOcclusion = true;
    claw.visible = false;
    return claw;
  });
  scene.add(core, ...claws);
  bossProxy = { core, claws };
  return environment.root;
}

export function createEnemyMesh(kind: string, letter?: string) {
  const mesh = buildEnemyMesh(kind, letter);
  mesh.userData.kind = kind;
  if (kind !== 'tether') mesh.scale.setScalar(0.001);
  enemyRecords.enqueue(mesh);
  return mesh;
}

function buildEnemyMesh(kind: string, letter?: string): Group {
  switch (kind) {
    case 'letter':
      return createLetterMesh(letter ?? 'C');
    case 'kite':
      return createKiteMesh();
    case 'limpet':
      return createLimpetMesh();
    case 'squall':
      return createSquallMesh();
    case 'mite':
      return createMiteMesh();
    case 'sentinel':
      return createSentinelMesh();
    case 'bolt':
      return createBoltMesh();
    case 'claw':
      return createClawMesh();
    case 'core':
      return createCoreMesh();
    case 'wreck':
      return createWreckMesh();
    case 'tether': {
      // The Tetherjack's brain: no body of its own; the stand-ins draw it.
      const brain = new Group();
      brain.userData.isBrain = true;
      return brain;
    }
    default:
      return createKiteMesh();
  }
}

export function setEnemyLocked(mesh: Object3D, locked: boolean) {
  mesh.userData.locked = locked;
  if (mesh.userData.isLetter) setLetterLocked(mesh as Group, locked);
}

export function setEnemyDenied(mesh: Object3D) {
  mesh.userData.deniedUntil = elapsedNow + 0.5;
  spawnRing(mesh.position, DENY_LIGHT.clone(), 2.4, 0.3);
}

// Player shot: a white tracer dart with an instrument-blue shell.
let projectileCore: OctahedronGeometry | null = null;
let projectileShell: OctahedronGeometry | null = null;

export function createProjectileMesh() {
  if (!projectileCore) {
    projectileCore = new OctahedronGeometry(0.3, 0);
    projectileCore.scale(0.4, 0.4, 2.4);
  }
  if (!projectileShell) {
    projectileShell = new OctahedronGeometry(0.48, 0);
    projectileShell.scale(0.55, 0.55, 2.0);
  }
  const group = new Group();
  group.add(new Mesh(projectileCore, new MeshBasicMaterial({ color: hdr(INSTRUMENT_HOT, 2.6) })));
  group.add(new Mesh(projectileShell, createAdditiveBasicMaterial({ color: hdr(INSTRUMENT, 0.9), opacity: 0.5 })));
  projectileRecords.enqueue({ mesh: group, trailColor: INSTRUMENT.clone().multiplyScalar(0.8) });
  return group;
}

// ---- reticle: an instrument gunsight with six charge segments -------------------------

export function createReticle() {
  const group = new Group();
  const parts: Array<{ material: MeshBasicMaterial; base: Color }> = [];
  const addPart = (mesh: Mesh, base: Color) => {
    const material = configureAdditiveMaterial(mesh.material as MeshBasicMaterial, { color: base, side: DoubleSide });
    parts.push({ material, base });
  };

  const outer = new Mesh(new RingGeometry(0.6, 0.635, 48), new MeshBasicMaterial());
  addPart(outer, hdr(INSTRUMENT, 1.1));
  const ticks = new Group();
  for (let i = 0; i < 4; i += 1) {
    const tick = new Mesh(new PlaneGeometry(0.22, 0.035), new MeshBasicMaterial());
    addPart(tick, hdr(INSTRUMENT, 1.3));
    const angle = (i / 4) * Math.PI * 2;
    tick.position.set(Math.cos(angle) * 0.86, Math.sin(angle) * 0.86, 0);
    tick.rotation.z = angle;
    ticks.add(tick);
  }
  const dot = new Mesh(new CircleGeometry(0.045, 16), new MeshBasicMaterial());
  addPart(dot, hdr(INSTRUMENT_HOT, 1.8));

  // Six arc segments around the sight fill in as locks charge.
  const arcs: Mesh[] = [];
  const arcMaterials: MeshBasicMaterial[] = [];
  for (let i = 0; i < 6; i += 1) {
    const start = Math.PI / 2 + (i / 6) * Math.PI * 2 + 0.06;
    const arc = new Mesh(new RingGeometry(0.72, 0.79, 10, 1, start, (Math.PI * 2) / 6 - 0.12), new MeshBasicMaterial());
    const material = configureAdditiveMaterial(arc.material as MeshBasicMaterial, { color: hdr(INSTRUMENT, 1.4), side: DoubleSide });
    arc.visible = false;
    arcs.push(arc);
    arcMaterials.push(material);
    group.add(arc);
  }

  group.add(outer, ticks, dot);
  group.userData.parts = parts;
  group.userData.ticks = ticks;
  group.userData.arcs = arcs;
  group.userData.arcMaterials = arcMaterials;
  group.userData.active = false;
  return group;
}

export function setReticleActive(reticle: Object3D, active: boolean, lockCount: number) {
  reticle.userData.active = active;
  reticle.scale.setScalar(1 + lockCount * 0.06 + (active ? 0.06 : 0));
  const parts = reticle.userData.parts as Array<{ material: MeshBasicMaterial; base: Color }>;
  const arcs = reticle.userData.arcs as Mesh[];
  const arcMaterials = reticle.userData.arcMaterials as MeshBasicMaterial[];
  const charge = lockCount === 0 ? null : colorForLockCount(lockCount, LOCK_GRADIENT);
  for (const part of parts) {
    if (charge) part.material.color.copy(hdr(charge, active ? 1.5 : 1.2));
    else part.material.color.copy(part.base).multiplyScalar(active ? 1.3 : 1);
  }
  for (const [index, arc] of arcs.entries()) {
    arc.visible = index < lockCount;
    if (charge) arcMaterials[index].color.copy(hdr(charge, lockCount >= 6 ? 2.0 : 1.4));
  }
}

// ---- event wiring ---------------------------------------------------------------------

export function installVisualEventHandlers(bus: EventBus, scene: Scene, cameraFeel: CameraFeelRig) {
  bus.on('spawn', ({ enemyId, kind, worldPosition }) => {
    const record = enemyRecords.claim(enemyId);
    if (!record) return;
    if (kind === 'core') {
      surgePulse = Math.max(surgePulse, 0.3);
      spawnRing(worldPosition, hdr(HOSTILE_RED, 1.2), 24, 0.9);
    } else if (kind === 'claw') {
      spawnRing(worldPosition, hdr(HAZARD_ORANGE, 1.0), 6, 0.5);
    } else if (kind !== 'bolt' && kind !== 'wreck' && kind !== 'tether') {
      // Radar ping: a thin instrument ring where a contact appears.
      spawnRing(worldPosition, hdr(INSTRUMENT, 0.7), 2.4, 0.4);
    }
  });

  bus.on('lock', ({ enemyId, worldPosition, lockCount }) => {
    const lockColor = colorForLockCount(lockCount, LOCK_GRADIENT);
    const record = enemyRecords.get(enemyId);
    if (record && !record.lockRing) lockRings.attach(record, makeLockBracket(lockColor), scene);
    spawnRing(worldPosition, hdr(lockColor, 1.3), 2.0, 0.26);
  });

  bus.on('unlock', ({ enemyId }) => {
    const record = enemyRecords.get(enemyId);
    if (record) lockRings.detach(record);
  });

  bus.on('fire', ({ projectileId, worldPosition }) => {
    projectileRecords.claim(projectileId);
    spawnGlint(worldPosition, hdr(INSTRUMENT_HOT, 1.2), 0.5, 0.12);
  });

  bus.on('hit', ({ enemyId, projectileId, worldPosition, lethal }) => {
    projectileRecords.delete(projectileId, { dispose: true });
    burstSparks(worldPosition, hdr(WHITE_HOT, 0.9), 6, 9, 5);
    const record = enemyRecords.get(enemyId);
    if (record && !lethal) {
      record.mesh.userData.damageFlashUntil = elapsedNow + 0.3;
      spawnGlint(worldPosition, hdr(INSTRUMENT_HOT, 1.7), 1.0, 0.15);
    }
  });

  bus.on('stage', ({ enemyId, worldPosition }) => {
    const record = enemyRecords.get(enemyId);
    if (!record) return;
    if (record.mesh.userData.kind === 'sentinel') {
      breakSentinelArmor(record.mesh);
      const specs = record.mesh.userData.shardSpecs as ShardSpec[] | undefined;
      if (specs) burstShards(worldPosition, specs.slice(0, 4));
      burstSparks(worldPosition, hdr(HOSTILE_RED, 1.0), 14, 12);
      spawnRing(worldPosition, hdr(WHITE_HOT, 1.2), 6, 0.5);
    } else if (record.mesh.userData.isTetherjack) {
      cameraFeel.shake(1.0, SKYHOOK_SHAKE);
      surgePulse = Math.max(surgePulse, 0.5);
      flashUniform.value = Math.max(flashUniform.value, 0.3);
      const specs = record.mesh.userData.shardSpecs as ShardSpec[] | undefined;
      if (specs) burstShards(worldPosition, specs.slice(0, 8), Math.random, 6);
      spawnRing(worldPosition, hdr(HOSTILE_RED, 1.5), 26, 0.9);
      burstSparks(worldPosition, hdr(WHITE_HOT, 1.1), 30, 24, 8);
    }
  });

  bus.on('kill', ({ enemyId, worldPosition }) => {
    const record = enemyRecords.get(enemyId);
    if (!record) return;
    const specs = record.mesh.userData.shardSpecs as ShardSpec[] | undefined;
    const accent = (record.mesh.userData.accent as Color | undefined) ?? HOSTILE_RED;
    if (specs) burstShards(worldPosition, specs, Math.random, record.mesh.userData.isLetter ? 9 : 11);
    burstSparks(worldPosition, hdr(accent, 1.0), 9, 12);
    burstSparks(worldPosition, hdr(WHITE_HOT, 0.8), 4, 7);
    spawnRing(worldPosition, hdr(INSTRUMENT, 0.9), 4.2, 0.4);
    spawnGlint(worldPosition, hdr(INSTRUMENT_HOT, 1.5), 1.1, 0.16);

    if (record.mesh.userData.isTetherjack) {
      // The kill the climb is built around: white-out, the tether shudders,
      // and the thing comes apart down the cable.
      bossKilledAt = elapsedNow;
      reachShake = false;
      cameraFeel.shake(1.6, SKYHOOK_SHAKE);
      surgePulse = 1.0;
      flashUniform.value = Math.max(flashUniform.value, 1.0);
      spawnRing(worldPosition, hdr(WHITE_HOT, 1.5), 70, 1.4);
      spawnRing(worldPosition, hdr(HOSTILE_RED, 1.2), 40, 1.1);
      spawnGlint(worldPosition, hdr(WHITE_HOT, 2.2), 6, 0.5);
      burstSparks(worldPosition, hdr(HAZARD_ORANGE, 1.2), 70, 30, 7);
      if (specs) burstShards(worldPosition, [...specs, ...specs], Math.random, 5);
    } else if (record.mesh.userData.isClaw) {
      cameraFeel.shake(0.5, SKYHOOK_SHAKE);
      spawnRing(worldPosition, hdr(HAZARD_ORANGE, 1.2), 9, 0.55);
    }
    enemyRecords.delete(enemyId, { dispose: true });
  });

  bus.on('miss', ({ enemyId, worldPosition }) => {
    const record = enemyRecords.get(enemyId);
    const brain = record?.mesh.userData.isBrain === true;
    if (record) enemyRecords.delete(enemyId, { dispose: true });
    if (!brain) burstSparks(worldPosition, CHARCOAL.clone().multiplyScalar(4), 3, 3, 2);
  });

  bus.on('volley', ({ size, kills }) => {
    if (size >= 5 && kills === size) {
      beatEnergy = Math.max(beatEnergy, 1.5);
      surgePulse = Math.max(surgePulse, 0.35);
      flashUniform.value = Math.max(flashUniform.value, 0.18);
    }
  });

  bus.on('beat', ({ isDownbeat }) => {
    beatEnergy = Math.max(beatEnergy, isDownbeat ? 1 : 0.45);
  });

  bus.on('playerhit', ({ healthRemaining }) => {
    hullRemaining = healthRemaining;
    car?.setHull(healthRemaining, SKYHOOK_PLAYER_HEALTH);
    hullUniform.value = 1;
    beatEnergy = 1.4;
    deckFlash = 1;
    cameraFeel.shake(1.1, SKYHOOK_SHAKE);
    if (car) {
      const slot = CLAMP_SLOTS[Math.floor(Math.random() * CLAMP_SLOTS.length)];
      const at = car.root.localToWorld(new Vector3(slot.x + (Math.random() - 0.5) * 2, slot.y, -slot.z + 1));
      burstSparks(at, hdr(HAZARD_ORANGE, 1.2), 14, 8, 9);
    }
  });

  bus.on('runstart', () => {
    resetEffects();
    enemyRecords.clear({ dispose: true, pending: true });
    projectileRecords.clear({ dispose: true, pending: true });
    resetCameraFeel(cameraFeel);
    flashUniform.value = 0;
    hullUniform.value = 0;
    dockUniform.value = 0;
    dockTarget = 0;
    lightningUniform.value = 0;
    surgePulse = 0;
    deckFlash = 0;
    reachShake = false;
    bossKilledAt = -1;
    hullRemaining = SKYHOOK_PLAYER_HEALTH;
    car?.setHull(SKYHOOK_PLAYER_HEALTH, SKYHOOK_PLAYER_HEALTH);
    environment?.setStationOpen(false);
    environment?.setDocked(false);
    hideBossProxy();
  });

  bus.on('runend', () => {
    resetCameraFeel(cameraFeel);
    reachShake = false;
    hideBossProxy();
  });

  // ---- level moments --------------------------------------------------------------

  skyhookSignals.on('clamp', ({ worldPosition }) => {
    cameraFeel.shake(0.35, SKYHOOK_SHAKE);
    deckFlash = Math.max(deckFlash, 0.6);
    burstSparks(worldPosition, hdr(HAZARD_ORANGE, 1.1), 12, 6, 9);
    spawnRing(worldPosition, hdr(WARNING_RED, 1.2), 2.2, 0.4);
  });
  skyhookSignals.on('bite', ({ worldPosition }) => {
    cameraFeel.shake(0.5, SKYHOOK_SHAKE);
    hullUniform.value = Math.max(hullUniform.value, 0.8);
    burstSparks(worldPosition, hdr(WHITE_HOT, 1.0), 10, 7, 10);
  });
  skyhookSignals.on('pry', ({ worldPosition }) => {
    spawnRing(worldPosition, hdr(INSTRUMENT, 1.2), 3.5, 0.45);
  });
  skyhookSignals.on('bossLatch', () => {
    cameraFeel.shake(0.6, SKYHOOK_SHAKE);
    flashUniform.value = Math.max(flashUniform.value, 0.12);
    surgePulse = Math.max(surgePulse, 0.4);
  });
  skyhookSignals.on('bossLurch', ({ distance }) => {
    const closeness = 1 - Math.min(1, distance / 240);
    cameraFeel.shake(0.15 + closeness * 0.55, SKYHOOK_SHAKE);
    beatEnergy = Math.max(beatEnergy, 1.2);
  });
  skyhookSignals.on('bossGrip', () => {
    surgePulse = Math.max(surgePulse, 0.4);
    flashUniform.value = Math.max(flashUniform.value, 0.2);
  });
  skyhookSignals.on('bossReach', () => {
    reachShake = true;
    cameraFeel.shake(1.2, SKYHOOK_SHAKE);
    deckFlash = 1;
  });
  skyhookSignals.on('bossBite', () => {
    cameraFeel.shake(1.0, SKYHOOK_SHAKE);
    hullUniform.value = 1;
    deckFlash = 1;
  });
  skyhookSignals.on('bossDead', () => {
    reachShake = false;
    environment?.setStationOpen(true);
    hideBossProxy();
  });
  skyhookSignals.on('stationOpen', () => {
    environment?.setStationOpen(true);
    surgePulse = Math.max(surgePulse, 0.3);
  });
  skyhookSignals.on('docked', () => {
    environment?.setDocked(true);
    dockTarget = 1;
    cameraFeel.shake(0.6, SKYHOOK_SHAKE);
  });
}

function hideBossProxy() {
  if (!bossProxy) return;
  bossProxy.core.visible = false;
  for (const claw of bossProxy.claws) claw.visible = false;
}

// ---- per-frame update ---------------------------------------------------------------

function resetCameraFeel(cameraFeel: CameraFeelRig) {
  lastRunTime = -1;
  cameraRoll = 0;
  cameraFovOffset = 0;
  cameraFeel.restore();
}

export function updateVisuals(dt: number, ctx: VisualContext) {
  elapsedNow = ctx.elapsed;
  beatEnergy = Math.max(0, beatEnergy - dt * 4.2);
  surgePulse = Math.max(0, surgePulse - dt * 0.9);
  const camera = ctx.camera as PerspectiveCamera;
  const runTime = ctx.running ? ctx.runTime : 0;

  const u = railUForPosition(camera.position);
  let railDelta = lastU < 0 ? 0 : (u - lastU) * RAIL_LENGTH;
  if (Math.abs(railDelta) > 80) railDelta = 0;
  railDelta = Math.max(0, railDelta);
  lastU = u;
  climbSpeed = ctx.running ? railUnitsPerSecond(runTime) : 0;

  updateSetPieceMoments(ctx, u);

  environment?.update({ camera, dt, elapsed: elapsedNow, u, railDelta, running: ctx.running, beat: beatEnergy });

  if (car) {
    car.root.position.copy(camera.position);
    deckFlash = Math.max(0, deckFlash - dt * 2.2);
    restoreDeck(car, deckFlash);
    (car.strobe.material as MeshBasicMaterial).color.copy(HAZARD_ORANGE).multiplyScalar(0.9 + beatEnergy * 1.1);
    for (const roller of car.rollers) roller.rotation.x += dt * (climbSpeed / 0.5);
    for (const [index, lamp] of car.lamps.entries()) {
      const intact = hullRemaining >= ((index + 1) / car.lamps.length) * SKYHOOK_PLAYER_HEALTH - 1e-6;
      if (intact) (lamp.material as MeshBasicMaterial).color.copy(INSTRUMENT).multiplyScalar(1.2 + beatEnergy * 0.5);
      else (lamp.material as MeshBasicMaterial).color.copy(WARNING_RED).multiplyScalar(1.0 + Math.max(0, Math.sin(elapsedNow * 9)) * 1.2);
    }
  }

  updateBossProxy(ctx, u);

  for (const [enemyId, record] of enemyRecords.entries()) {
    if (!record.mesh.parent) {
      enemyRecords.delete(enemyId, { dispose: true });
      continue;
    }
    if (record.mesh.userData.isBrain) continue;
    if (record.bornAt === null) record.bornAt = elapsedNow;
    const age = elapsedNow - record.bornAt;
    record.mesh.scale.setScalar(easeOutBack(Math.min(1, age / 0.4)) * ((record.mesh.userData.baseScale as number | undefined) ?? 1));

    updateEnemyTint(record.mesh, camera);
    dressEnemy(record.mesh, dt);

    if (record.mesh.userData.isHostileShot) dropTrail(record.mesh.position, record.mesh.userData.trailColor as Color);

    if (record.lockRing) {
      record.mesh.getWorldPosition(record.lockRing.position);
      record.lockRing.quaternion.copy(camera.quaternion);
      record.lockRing.rotation.z += dt * 1.8;
      const pulse = 1 + Math.sin(elapsedNow * 9) * 0.05;
      const fit = (record.mesh.userData.lockRingScale as number | undefined) ?? 1;
      record.lockRing.scale.setScalar(pulse * 1.9 * fit);
    }
  }

  for (const [projectileId, record] of projectileRecords.entries()) {
    if (!record.mesh.parent) {
      projectileRecords.delete(projectileId, { dispose: true });
      continue;
    }
    dropTrail(record.mesh.position, record.trailColor);
  }

  const reticleTicks = findReticleTicks(ctx.scene);
  if (reticleTicks) {
    const active = reticleTicks.parent?.userData.active === true;
    reticleTicks.rotation.z += dt * (active ? 2.6 : 0.6);
  }

  updateEffects(dt, camera);

  flashUniform.value = Math.max(0, flashUniform.value - dt * (flashUniform.value > 0.7 ? 1.3 : 2.6));
  hullUniform.value = Math.max(0, hullUniform.value - dt * 1.8);
  dockUniform.value += (dockTarget - dockUniform.value) * Math.min(1, dt * 0.8);
  if (reachShake) ctx.feel.shake(dt * 2.4, SKYHOOK_SHAKE);
  if (bossKilledAt >= 0 && elapsedNow - bossKilledAt < 1.6) {
    flashUniform.value = Math.max(flashUniform.value, 0.4 * (1 - (elapsedNow - bossKilledAt) / 1.6));
  }
}

// The Tetherjack as a sight: stand-ins follow the brain's published state
// until the real targets exist (claws in range, core exposed).
function updateBossProxy(ctx: VisualContext, u: number) {
  if (!bossProxy) return;
  const state = tetherjackState;
  const showCore = ctx.running && state.active && !state.coreSpawned && !state.dead;
  const showClaws = ctx.running && state.active && !state.engaged && !state.dead;
  bossProxy.core.visible = showCore;
  for (const claw of bossProxy.claws) claw.visible = showClaws;
  if (showCore) {
    const core = bossProxy.core;
    placeBossBody(u, state, core.position);
    core.quaternion.copy(RAIL_BASIS);
    core.rotateZ(Math.sin(state.age * 0.5) * 0.12 + (state.reached ? Math.sin(state.age * 40) * 0.035 : 0));
    core.userData.exposed = state.exposed;
    core.userData.reached = state.reached;
    core.userData.lurching = state.lurching;
    core.userData.stage = state.stage;
    updateEnemyTint(core, ctx.camera as PerspectiveCamera);
    updateCoreMesh(core, elapsedNow);
  }
  if (showClaws) {
    for (const [socket, claw] of bossProxy.claws.entries()) {
      placeClaw(u, state, socket, claw.position);
      claw.quaternion.copy(RAIL_BASIS);
      claw.rotateZ(clawAngle(state, socket));
      claw.userData.engaged = false;
      updateEnemyTint(claw, ctx.camera as PerspectiveCamera);
    }
  }
}

// Deck punch-through and lightning: detect the crossing, slam the senses.
function updateSetPieceMoments(ctx: VisualContext, u: number) {
  if (!ctx.running) {
    lastRunTime = -1;
    // Attract mode: the storm still flickers.
    if (environment && environment.phase() < 0.5 && Math.random() < 0.0035) strikeLightning(u, 0.5);
    return;
  }
  const crossed = (t: number) => lastRunTime >= 0 && lastRunTime < t && ctx.runTime >= t;
  if (crossed(DECK_TIME)) {
    flashUniform.value = Math.max(flashUniform.value, 0.95);
    surgePulse = Math.max(surgePulse, 0.9);
    ctx.feel.shake(0.7, SKYHOOK_SHAKE);
    ctx.feel.kickFov(7, { decay: 3.2 });
  }
  for (const time of LIGHTNING_TIMES) if (crossed(time)) strikeLightning(u, 1);
  lastRunTime = ctx.runTime;
}

function strikeLightning(u: number, strength: number) {
  lightningUniform.value = Math.max(lightningUniform.value, strength);
  flashUniform.value = Math.max(flashUniform.value, 0.2 * strength);
  const side = Math.random() < 0.5 ? -1 : 1;
  const from = railPoint(u + 0.05 + Math.random() * 0.05, side * (18 + Math.random() * 30), 40 + Math.random() * 20, 0);
  const to = railPoint(u + 0.03 + Math.random() * 0.04, side * (8 + Math.random() * 25), -30 - Math.random() * 20, 0);
  spawnLightning(from, to, hdr(new Color(0.85, 0.9, 1.0), 2.2 * strength), 0.18, 7);
}

export function updateCameraEffects(dt: number, ctx: CameraEffectsContext) {
  if (!(ctx.camera instanceof PerspectiveCamera)) return;
  const camera = ctx.camera;
  const runTime = ctx.running ? ctx.runTime : 0;
  const speed = ctx.running ? speedFactorAt(runTime) : 0.5;
  const storm = environment ? Math.max(0, 1 - environment.phase()) : 1;

  // FOV breathes with climb rate, kicks on the beat and the surge moments.
  const targetFovOffset = (speed - 0.9) * 6 + beatEnergy * 0.9 + surgePulse * 6 - dockUniform.value * 3;
  cameraFovOffset = MathUtils.lerp(cameraFovOffset, targetFovOffset, Math.min(1, dt * 6));

  // Wind buffet in the weather: the whole turret sways on the tether.
  const t = elapsedNow;
  const buffet = storm * (ctx.running ? 1 : 0.6);
  camera.position
    .addScaledVector(RAIL_RIGHT, Math.sin(t * 1.7) * 0.2 * buffet + Math.sin(t * 4.3) * 0.05 * buffet)
    .addScaledVector(RAIL_UP, Math.sin(t * 2.3 + 1) * 0.14 * buffet);
  const targetRoll = Math.sin(t * 0.9) * 0.018 * buffet + Math.sin(t * 3.1) * 0.006 * buffet;
  cameraRoll += (targetRoll - cameraRoll) * Math.min(1, dt * 4);
  camera.rotateZ(cameraRoll);

  ctx.feel.setFovOffset(cameraFovOffset);
  ctx.feel.update(dt, { shake: SKYHOOK_SHAKE });
}

// ---- enemy dressing -------------------------------------------------------------------

function dressEnemy(mesh: Group, dt: number) {
  const kind = mesh.userData.kind as string;
  if (kind === 'limpet') updateLimpetMesh(mesh);
  else if (kind === 'kite') updateKiteMesh(mesh);
  dressHostile(mesh, dt);
  if (mesh.userData.isTetherjack) updateCoreMesh(mesh, elapsedNow);
}

function updateEnemyTint(mesh: Group, camera: PerspectiveCamera) {
  const userData = mesh.userData;
  const denied = (userData.deniedUntil as number | undefined ?? -Infinity) > elapsedNow;

  if (userData.isLetter) {
    if (denied) setLetterDenied(mesh, true);
    else if (userData.locked !== true) setLetterLocked(mesh, false);
    return;
  }

  const parts = (userData.isTetherjack ? coreParts(mesh) : (userData.parts as TintPart[] | undefined)) ?? [];
  if (parts.length === 0) return;

  const distance = mesh.position.distanceTo(camera.position);
  const closeness = smootherstep(1 - clamp01((distance - 18) / (70 - 18)));
  const locked = userData.locked === true;
  const damageFlash = (userData.damageFlashUntil as number | undefined ?? -Infinity) > elapsedNow;
  const charge = (userData.charge as number | undefined) ?? 0;
  const cold = userData.isClaw && userData.engaged !== true;

  const bodyState: BodyState = denied ? 'denied' : locked ? 'locked' : damageFlash ? 'flash' : 'normal';
  for (const part of parts) {
    if (part.kind === 'body') {
      setBodyState(part, bodyState);
      continue;
    }
    if (denied) {
      tintPart(part, DENY_LIGHT);
      continue;
    }
    if (locked) {
      tintPart(part, part.kind === 'edge' ? LOCKED_EDGE : LOCKED_LIGHT);
      continue;
    }
    if (damageFlash) {
      tintPart(part, FLASH_LIGHT);
      continue;
    }
    // Hot elements dim with distance so far stacks never blob under bloom.
    const dim = (part.kind === 'edge' ? 0.4 + 0.6 * closeness : 0.45 + 0.55 * closeness) * (cold ? 0.35 : 1);
    const boost = part.kind === 'light' ? 1 + charge * 1.6 : 1;
    tintPart(part, scratchTint.copy(part.base).multiplyScalar(dim * boost));
  }
}

function findReticleTicks(scene: Scene): Group | null {
  for (const child of scene.children) {
    if (child.userData.ticks) return child.userData.ticks as Group;
  }
  return null;
}

function makeLockBracket(color: Color): Group {
  const group = new Group();
  // Two squares, one turned — an instrument bracket closing on a contact.
  const outer = new Mesh(new RingGeometry(0.84, 0.9, 4), createAdditiveBasicMaterial({ color: hdr(color, 1.6), side: DoubleSide }));
  outer.rotation.z = Math.PI / 4;
  const inner = new Mesh(new RingGeometry(0.66, 0.7, 4), createAdditiveBasicMaterial({ color: hdr(color.clone().lerp(INSTRUMENT_HOT, 0.5), 1.3), side: DoubleSide }));
  group.add(outer, inner);
  group.userData.raildIgnoreOcclusion = true;
  return group;
}

function easeOutBack(t: number): number {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function smootherstep(t: number): number {
  return t * t * (3 - 2 * t);
}
