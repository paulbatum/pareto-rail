import {
  Color,
  Group,
  MathUtils,
  PerspectiveCamera,
  Scene,
  Vector3,
} from 'three';
import type { Camera, Object3D } from 'three';
import type { CameraFeelRig, CameraFeelShakeOptions } from '../../../engine/camera-feel';
import { colorForLockCount } from '../../../engine/locks';
import { createAdornmentSlot, createPendingVisualRecords } from '../../../engine/visual-kit';
import type { EventBus } from '../../../events';
import { bossLocalToWorld, bossState, clampLocal } from '../boss';
import { SKYHOOK_HULL } from '../gameplay';
import {
  CAR_FLANKS,
  climbSpeedAt,
  createSkyhookRail,
  createViewBasis,
  ndcPoint,
  tanHalfFov,
  viewBasisAt,
} from '../space';
import { DECK_TIME, DOCK_TIME, LATCH_TIME } from '../timing';
import { createAir } from './air';
import { createBossBody } from './boss';
import { createCarFrame } from './car';
import { createClouds } from './clouds';
import {
  animateEnemy,
  createBoltMesh,
  createClampMesh,
  createCoreMesh,
  createHaulerClock,
  createHookMesh,
  createKiteMesh,
  createLimpetMesh,
  createMantaMesh,
  createSentryMesh,
  createTorpedoMesh,
  type TintPart,
} from './enemies';
import { createPlatform, createTether } from './environment';
import {
  burstChips,
  burstSparks,
  createEffects,
  dropTrail,
  puffSmoke,
  resetEffects,
  spawnGlint,
  spawnRing,
  updateEffects,
} from './effects';
import { makeLockRing } from './instruments';
import { disposeMaterials } from './merge';
import { createLetterMesh, setLetterDenied, setLetterLocked } from './letters';
import {
  CHARCOAL,
  HAZARD,
  HAZARD_HOT,
  ICE,
  LOCK_GRADIENT,
  SIGNAL_WHITE,
  hdr,
} from './palette';
import { flashUniform, hurtUniform, hushUniform } from './post-fx';
import { createSky } from './sky';
import { createLatchShow } from './latch';
import { createLightning } from './lightning';
import { createStation } from './station';

export { createProjectileMesh, createReticle, setReticleActive } from './instruments';
import { updateReticle } from './instruments';

// Spine: the palette lives in palette.ts; this file is the event choreography.
// Gameplay events (spawn, lock, unlock, fire, hit, stage, kill, miss, reject,
// volley, playerhit, bossphase, beat) turn into light, debris and shake here;
// the set pieces (storm, the deck, the thinning, the Ripper, the docking) are
// keyed to the run clock.

export type VisualContext = {
  scene: Scene;
  camera: PerspectiveCamera;
  elapsed: number;
  runTime: number;
  running: boolean;
  ended: boolean;
  feel: CameraFeelRig;
};

type EnemyRecord = {
  mesh: Group;
  kind: string;
  bornAt: number | null;
  lockRing: Group | null;
  lastPosition: Vector3;
};

const SHAKE: CameraFeelShakeOptions = {
  decay: 2.4,
  maxTrauma: 1.8,
  pitchDegrees: 0.4,
  yawDegrees: 0.32,
  rollDegrees: 0.9,
  frequency: 8.5,
  smoothing: 20,
};

const rail = createSkyhookRail();
const basis = createViewBasis();

let sky: ReturnType<typeof createSky>;
let clouds: ReturnType<typeof createClouds>;
let air: ReturnType<typeof createAir>;
let tether: ReturnType<typeof createTether>;
let platform: Group;
let station: ReturnType<typeof createStation>;
let car: ReturnType<typeof createCarFrame>;
let boss: ReturnType<typeof createBossBody>;
let lightningBolt: ReturnType<typeof createLightning>;
let latchShow: ReturnType<typeof createLatchShow>;
let strikes = 0;
let reticleRef: Object3D | undefined;

let beatEnergy = 0;
let elapsedNow = 0;
let lastRunTime = -1;
let cameraFovOffset = 0;
let cameraRoll = 0;
let hullNow = SKYHOOK_HULL;
let lightningQueue: number[] = [];
let lightningFlicker = 0;
let shearHandled = false;
let calloutRef: (text: string, seconds: number) => void = () => {};
let lastStrides = 0;
let lastClimbSpeed = 0;

const DENY_RED = new Color(1.5, 0.12, 0.05);
const DENY_FILL = new Color(0.32, 0.03, 0.015);

// Deterministic lightning: it strikes on downbeats so the thunder can be scored.
const LIGHTNING_TIMES = [3.75, 7.5, 10.0, 12.5];

const lockRings = createAdornmentSlot<EnemyRecord, Group>({
  get: (record) => record.lockRing,
  set: (record, ring) => {
    record.lockRing = ring;
  },
  disposeAdornment: disposeMaterials,
});

// createEnemyMesh() has no id, but the runner emits `spawn` synchronously right
// after calling it — pairing the queue with spawn events links mesh to id.
const enemyRecords = createPendingVisualRecords<Group, EnemyRecord>({
  createRecord: (mesh) => ({ mesh, kind: (mesh.userData.kind as string) ?? '', bornAt: null, lockRing: null, lastPosition: new Vector3() }),
  disposeRecord: (record) => {
    lockRings.detach(record);
    disposeMaterials(record.mesh);
  },
});
const projectileRecords = createPendingVisualRecords<Object3D, Object3D>({ createRecord: (mesh) => mesh });

export function createEnvironment(scene: Scene) {
  // The app can mount the level more than once in one page: drop anything from the last mount.
  reticleRef = undefined;
  enemyRecords.clear({ dispose: true, pending: true });
  projectileRecords.clear({ pending: true });
  sky = createSky(scene);
  clouds = createClouds(rail);
  air = createAir();
  tether = createTether(rail);
  platform = createPlatform(rail);
  station = createStation(rail);
  car = createCarFrame();
  boss = createBossBody();
  lightningBolt = createLightning(scene);
  latchShow = createLatchShow(scene, rail);
  scene.add(clouds.group, air.group, tether.group, platform, station.group, car.group, boss.group);
  createEffects(scene);
}

export function createEnemyMesh(kind: string, letter?: string) {
  const mesh = buildEnemyMesh(kind, letter);
  mesh.userData.kind = kind;
  mesh.scale.setScalar(0.001);
  enemyRecords.enqueue(mesh);
  return mesh;
}

function buildEnemyMesh(kind: string, letter?: string): Group {
  switch (kind) {
    case 'letter':
      return createLetterMesh(letter ?? 'A');
    case 'kite':
      return createKiteMesh();
    case 'manta':
      return createMantaMesh();
    case 'limpet':
      return createLimpetMesh();
    case 'sentry':
      return createSentryMesh();
    case 'bolt':
      return createBoltMesh();
    case 'torpedo':
      return createTorpedoMesh();
    case 'hook':
      return createHookMesh();
    case 'clamp':
      return createClampMesh();
    case 'core':
      return createCoreMesh();
    case 'hauler':
      return createHaulerClock();
    default:
      return createKiteMesh();
  }
}

export function setEnemyLocked(mesh: Object3D, locked: boolean) {
  mesh.userData.locked = locked;
  if (mesh.userData.isLetter) setLetterLocked(mesh as Group, locked);
}

export function setEnemyDenied(mesh: Object3D) {
  mesh.userData.deniedUntil = elapsedNow + 0.55;
  spawnRing(mesh.position, DENY_RED.clone(), 3.2, 0.32);
  if (mesh.userData.isLetter) setLetterDenied(mesh as Group, true);
}

// ---- helpers ----------------------------------------------------------------------------------

/** 1 in air, 0 in vacuum: gravity and drag for every effect follow the sky. */
function atmosphere(time: number) {
  return 1 - MathUtils.smoothstep(time, 25, 37);
}

let currentTime = 0;

function feelShake(feel: CameraFeelRig | null, amount: number) {
  feel?.shake(amount, SHAKE);
}
let feelRef: CameraFeelRig | null = null;

function screenPoint(camera: Camera, nx: number, ny: number, depth: number, out = new Vector3()) {
  const cam = camera as PerspectiveCamera;
  return ndcPoint(basis, cam.aspect, nx, ny, depth, out, tanHalfFov(cam.fov));
}

/** A point on the car's frame, in world space (camera space offsets). */
function carPoint(camera: Camera, x: number, y: number, z: number, out = new Vector3()) {
  const right = new Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
  const up = new Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
  const forward = new Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
  return out.copy(camera.position).addScaledVector(right, x).addScaledVector(up, y).addScaledVector(forward, z);
}

function killEffects(kind: string, position: Vector3, mesh: Object3D | undefined) {
  const fire = hdr(HAZARD, 1.3);
  const hot = hdr(HAZARD_HOT, 1.6);
  const airy = atmosphere(currentTime);
  const grav = 9 * airy;
  switch (kind) {
    case 'kite':
      burstSparks(position, fire, 9, 11, { gravity: 9, life: 0.55 });
      burstChips(position, 4, 8, { hazard: 0.6, size: 0.6 });
      spawnRing(position, fire, 4.4, 0.4);
      spawnGlint(position, hdr(SIGNAL_WHITE, 1.6), 1.1, 0.16);
      break;
    case 'manta':
      burstSparks(position, fire, 20, 12, { gravity: 8, life: 0.7 });
      burstChips(position, 10, 9, { hazard: 0.45, size: 1.1 });
      puffSmoke(position, 3, 2.4, CHARCOAL.clone().multiplyScalar(4), 1.3);
      spawnRing(position, fire, 8, 0.5);
      spawnGlint(position, hdr(SIGNAL_WHITE, 1.8), 2, 0.2);
      break;
    case 'limpet':
      burstSparks(position, hot, 14, 10, { gravity: grav, life: 0.6 });
      burstChips(position, 7, 8, { hazard: 0.4, size: 0.7 });
      spawnRing(position, fire, 5, 0.42);
      spawnGlint(position, hdr(SIGNAL_WHITE, 1.6), 1.4, 0.17);
      break;
    case 'sentry':
      // Vacuum: the plates fly straight, tumbling, and keep going.
      burstChips(position, 16, 13, { hazard: 0.22, size: 1.15 });
      burstSparks(position, hot, 14, 14, { gravity: grav, drag: 1.4 * airy, life: 0.7 });
      spawnRing(position, hdr(SIGNAL_WHITE, 1.3), 8, 0.5);
      spawnRing(position, fire, 5, 0.38);
      spawnGlint(position, hdr(SIGNAL_WHITE, 2.1), 2.4, 0.22);
      break;
    case 'bolt':
      burstSparks(position, hot, 8, 9, { gravity: grav, life: 0.4 });
      spawnRing(position, fire, 3.4, 0.3);
      break;
    case 'torpedo':
    case 'hook': {
      const heavy = kind === 'hook';
      burstSparks(position, hot, heavy ? 24 : 20, 14, { gravity: grav, life: 0.8 });
      burstChips(position, heavy ? 10 : 6, 10, { hazard: 0.5, size: heavy ? 1.1 : 0.8 });
      if (airy > 0.3) puffSmoke(position, heavy ? 4 : 3, 2.6, CHARCOAL.clone().multiplyScalar(4), 1.4);
      spawnRing(position, hot, heavy ? 10 : 7.5, 0.5);
      spawnGlint(position, hdr(SIGNAL_WHITE, 2), 2.4, 0.2);
      break;
    }
    case 'clamp':
      burstSparks(position, hot, 28, 18, { gravity: 0, drag: 0, life: 0.9, size: 1.8 });
      burstChips(position, 12, 16, { hazard: 0.4, size: 2.6, gravity: 0, drag: 0 });
      spawnRing(position, hdr(SIGNAL_WHITE, 1.4), 24, 0.7);
      spawnRing(position, fire, 14, 0.5);
      spawnGlint(position, hdr(SIGNAL_WHITE, 2.4), 8, 0.28);
      feelShake(feelRef, 0.55);
      break;
    default:
      break;
  }
}

function updateEnemyTint(record: EnemyRecord, camera: Camera) {
  const userData = record.mesh.userData;
  const denied = ((userData.deniedUntil as number | undefined) ?? -Infinity) > elapsedNow;

  if (userData.isLetter) {
    if (denied) setLetterDenied(record.mesh, true);
    else if (userData.locked !== true) setLetterLocked(record.mesh, false);
    return;
  }
  const parts = userData.parts as TintPart[] | undefined;
  if (!parts || parts.length === 0) return;

  const locked = userData.locked === true;
  const flashing = ((userData.damageFlashUntil as number | undefined) ?? -Infinity) > elapsedNow;
  const latched = userData.latched === true;
  const gnaw = (userData.gnaw as number | undefined) ?? 0;
  for (const part of parts) {
    if (denied) {
      part.material.color.copy(part.kind === 'body' ? DENY_FILL : DENY_RED);
      continue;
    }
    if (locked) {
      if (part.kind === 'body') part.material.color.copy(part.base).lerp(SIGNAL_WHITE, 0.55).multiplyScalar(1.25);
      else part.material.color.copy(hdr(ICE, part.kind === 'core' ? 2.6 : 2.0));
      continue;
    }
    if (flashing) {
      part.material.color.copy(hdr(SIGNAL_WHITE, part.kind === 'body' ? 1.0 : 2.4));
      continue;
    }
    part.material.color.copy(part.base);
    if (latched && part.kind !== 'body') {
      // A limpet on the hull runs hotter the longer it gnaws.
      const blink = 0.55 + 0.45 * Math.sin(elapsedNow * (8 + gnaw * 22));
      part.material.color.multiplyScalar(1 + gnaw * 1.6 * blink);
    }
  }
}

// ---- event wiring ------------------------------------------------------------------------------------

export function installVisualEventHandlers(bus: EventBus, scene: Scene, cameraFeel: CameraFeelRig, camera: PerspectiveCamera, showCallout: (text: string, seconds: number) => void) {
  feelRef = cameraFeel;
  calloutRef = showCallout;

  bus.on('spawn', ({ enemyId, kind, worldPosition }) => {
    const record = enemyRecords.claim(enemyId);
    if (!record) return;
    if (kind === 'letter') return;
    if (kind === 'torpedo' || kind === 'hook') {
      // A warning ring where it will strike: the car's flank on its side of the screen.
      const left = worldPosition.clone().project(camera).x < 0;
      const flank = CAR_FLANKS[left ? 0 : 1];
      spawnRing(screenPoint(camera, flank.nx * 0.9, flank.ny, flank.depth), hdr(HAZARD, 1.3), 3.2, 0.55);
    }
    if (kind === 'sentry') spawnRing(worldPosition, hdr(SIGNAL_WHITE, 0.9), 5, 0.4);
    else if (kind !== 'bolt' && kind !== 'hauler') spawnRing(worldPosition, hdr(HAZARD, 0.8), 3, 0.35);
  });

  bus.on('lock', ({ enemyId, worldPosition, lockCount }) => {
    const lockColor = colorForLockCount(lockCount, LOCK_GRADIENT);
    const record = enemyRecords.get(enemyId);
    if (record && !record.lockRing) lockRings.attach(record, makeLockRing(lockColor), scene);
    spawnRing(worldPosition, hdr(lockColor, 1.5), 2.4, 0.28);
    if (lockCount >= 6) {
      spawnGlint(camera.position.clone().addScaledVector(new Vector3(0, 0, -1).applyQuaternion(camera.quaternion), 24), hdr(SIGNAL_WHITE, 2), 3, 0.3);
    }
  });

  bus.on('unlock', ({ enemyId }) => {
    const record = enemyRecords.get(enemyId);
    if (record) lockRings.detach(record);
  });

  bus.on('fire', ({ projectileId, worldPosition, volleySize, indexInVolley }) => {
    projectileRecords.claim(projectileId);
    spawnGlint(worldPosition, hdr(SIGNAL_WHITE, 1.4), 0.6, 0.13);
    // A full six-lock release is an event: a shockwave from the reticle and a kick of FOV.
    if (volleySize >= 6 && (indexInVolley ?? 0) === 0) {
      spawnRing(worldPosition, hdr(ICE, 1.6), 16, 0.5);
      spawnRing(worldPosition, hdr(SIGNAL_WHITE, 1.2), 8, 0.32);
      cameraFeel.kickFov(2.4, { decay: 5 });
      feelShake(cameraFeel, 0.22);
    }
  });

  bus.on('hit', ({ enemyId, projectileId, worldPosition, lethal }) => {
    projectileRecords.delete(projectileId);
    const record = enemyRecords.get(enemyId);
    burstSparks(worldPosition, hdr(SIGNAL_WHITE, 1.1), 5, 10, { gravity: 6 * atmosphere(currentTime), life: 0.3 });
    if (record && !lethal) {
      record.mesh.userData.damageFlashUntil = elapsedNow + 0.3;
      spawnGlint(worldPosition, hdr(SIGNAL_WHITE, 1.9), 1.5, 0.16);
      burstChips(worldPosition, 2, 6, { hazard: 0.3, size: 0.6 });
    }
  });

  bus.on('stage', ({ enemyId, worldPosition }) => {
    const record = enemyRecords.get(enemyId);
    if (!record) return;
    if (record.kind === 'sentry') {
      // Armour petals blow off.
      const armour = record.mesh.userData.armour as Group | undefined;
      if (armour) armour.visible = false;
      burstChips(worldPosition, 14, 12, { hazard: 0.25, size: 1.3 });
      burstSparks(worldPosition, hdr(HAZARD_HOT, 1.5), 14, 12, { gravity: 6 * atmosphere(currentTime), life: 0.6 });
      spawnRing(worldPosition, hdr(SIGNAL_WHITE, 1.4), 7, 0.4);
      feelShake(cameraFeel, 0.25);
    } else if (record.kind === 'core') {
      feelShake(cameraFeel, 1.1);
      flashUniform.value = Math.max(flashUniform.value, 0.4);
      spawnRing(worldPosition, hdr(HAZARD_HOT, 1.8), 30, 0.8);
      spawnRing(worldPosition, hdr(SIGNAL_WHITE, 1.4), 16, 0.55);
      burstSparks(worldPosition, hdr(HAZARD_HOT, 1.6), 40, 28, { gravity: 0, drag: 0, life: 1.0, size: 2 });
      burstChips(worldPosition, 16, 20, { hazard: 0.4, size: 2.2, gravity: 0, drag: 0 });
    }
  });

  bus.on('kill', ({ enemyId, worldPosition }) => {
    const record = enemyRecords.get(enemyId);
    if (!record) return;
    killEffects(record.kind, worldPosition, record.mesh);
    if (record.kind === 'core') {
      boss.release();
      flashUniform.value = Math.max(flashUniform.value, 1.0);
      feelShake(cameraFeel, 1.8);
      cameraFeel.kickFov(9, { decay: 2.4 });
      spawnRing(worldPosition, hdr(SIGNAL_WHITE, 1.8), 120, 1.3);
      spawnRing(worldPosition, hdr(HAZARD_HOT, 1.7), 70, 1.0);
      spawnRing(worldPosition, hdr(HAZARD, 1.3), 38, 0.8);
      spawnGlint(worldPosition, hdr(SIGNAL_WHITE, 2.6), 22, 0.5);
      burstSparks(worldPosition, hdr(HAZARD_HOT, 1.7), 70, 34, { gravity: 0, drag: 0, life: 1.6, size: 2.4 });
      burstChips(worldPosition, 60, 26, { hazard: 0.35, size: 3.0, gravity: 0, drag: 0 });
      showCallout('TETHER CLEAR', 4.5);
    }
    enemyRecords.delete(enemyId, { dispose: true });
  });

  bus.on('miss', ({ enemyId, worldPosition }) => {
    const record = enemyRecords.get(enemyId);
    if (!record) return;
    const mesh = record.mesh;
    if (mesh.userData.impacted === true) {
      // It got through: the strike lands on the car.
      const heavy = record.kind === 'hook';
      burstSparks(worldPosition, hdr(HAZARD_HOT, 1.6), heavy ? 34 : 24, 15, { gravity: 6 * atmosphere(currentTime), life: 0.8 });
      burstChips(worldPosition, heavy ? 12 : 8, 10, { hazard: 0.6, size: 1.0 });
      if (atmosphere(currentTime) > 0.3) puffSmoke(worldPosition, 4, 2.6, CHARCOAL.clone().multiplyScalar(4), 1.6);
      spawnRing(worldPosition, hdr(HAZARD, 1.6), 9, 0.5);
      spawnGlint(worldPosition, hdr(SIGNAL_WHITE, 2), 3, 0.22);
    } else if (record.kind !== 'hauler') {
      burstSparks(worldPosition, HAZARD.clone().multiplyScalar(0.4), 3, 3, { gravity: 2, life: 0.4 });
    }
    enemyRecords.delete(enemyId, { dispose: true });
  });

  bus.on('volley', ({ size, kills }) => {
    if (size >= 5 && kills === size) {
      beatEnergy = Math.max(beatEnergy, 1.5);
      flashUniform.value = Math.max(flashUniform.value, size >= 6 ? 0.2 : 0.1);
      if (size >= 6) cameraFeel.kickFov(3, { decay: 5 });
    }
  });

  bus.on('reject', () => {
    const position = camera.position.clone().addScaledVector(new Vector3(0, 0, -1).applyQuaternion(camera.quaternion), 20);
    spawnRing(position, DENY_RED.clone(), 5, 0.3);
    beatEnergy = Math.max(0, beatEnergy - 0.2);
  });

  bus.on('beat', ({ isDownbeat }) => {
    beatEnergy = Math.max(beatEnergy, isDownbeat ? 1 : 0.5);
  });

  bus.on('playerhit', ({ healthRemaining }) => {
    hullNow = healthRemaining;
    beatEnergy = 1.4;
    hurtUniform.value = 1;
    feelShake(cameraFeel, 1.15);
    // Sparks off the deck, smoke once the hull is low.
    const spark = carPoint(camera, (Math.random() - 0.5) * 12, -3.1, -6);
    burstSparks(spark, hdr(HAZARD_HOT, 1.6), 22, 10, { gravity: 8 * atmosphere(currentTime), life: 0.7, bias: new Vector3(0, 1, 0), biasAmount: 0.6 });
    burstChips(spark, 5, 6, { hazard: 0.5, size: 0.6 });
    if (healthRemaining <= 2 && atmosphere(currentTime) > 0.2) puffSmoke(spark, 3, 1.6, CHARCOAL.clone().multiplyScalar(4), 1.6);
  });

  bus.on('bossphase', ({ phase }) => {
    if (phase === 'summoned') {
      cameraFeel.kickFov(4, { decay: 3 });
      feelShake(cameraFeel, 1.3);
      flashUniform.value = Math.max(flashUniform.value, 0.25);
      showCallout('SOMETHING HAS LATCHED THE TETHER', 3.4);
    } else if (phase === 'exposed') {
      showCallout('CORE EXPOSED', 2.6);
      flashUniform.value = Math.max(flashUniform.value, 0.18);
      feelShake(cameraFeel, 0.6);
    }
  });

  bus.on('runstart', () => {
    resetEffects();
    enemyRecords.clear({ dispose: true, pending: true });
    projectileRecords.clear({ pending: true });
    lastRunTime = -1;
    cameraFovOffset = 0;
    cameraRoll = 0;
    hullNow = SKYHOOK_HULL;
    shearHandled = false;
    lastStrides = 0;
    lightningQueue = [...LIGHTNING_TIMES];
    lightningFlicker = 0;
    strikes = 0;
    lightningBolt.reset();
    latchShow.reset();
    flashUniform.value = 0;
    hurtUniform.value = 0;
    hushUniform.value = 0;
    boss.reset();
    cameraFeel.restore();
  });

  bus.on('runend', ({ died }) => {
    cameraFeel.restore();
    lastRunTime = -1;
    if (died) {
      // The climber comes apart: a white-out, a rain of plating, and the frame goes red.
      flashUniform.value = 0.9;
      hurtUniform.value = 1;
      const at = carPoint(camera, 0, -1, -6);
      burstChips(at, 40, 22, { hazard: 0.35, size: 1.4 });
      burstSparks(at, hdr(HAZARD_HOT, 1.6), 40, 18, { gravity: 6 * atmosphere(currentTime), life: 1.0 });
      spawnRing(at, hdr(HAZARD_HOT, 1.6), 24, 0.8);
      cameraFeel.shake(1.8, SHAKE);
    }
  });
}

// ---- per-frame ------------------------------------------------------------------------------------------

export function updateVisuals(dt: number, ctx: VisualContext) {
  elapsedNow = ctx.elapsed;
  feelRef = ctx.feel;
  beatEnergy = Math.max(0, beatEnergy - dt * 3.6);
  hurtUniform.value = Math.max(0, hurtUniform.value - dt * 1.9);
  flashUniform.value = Math.max(0, flashUniform.value - dt * (flashUniform.value > 0.8 ? 1.4 : 1.9));

  const time = ctx.running || ctx.ended ? ctx.runTime : 0;
  currentTime = time;
  viewBasisAt(rail, time, basis);
  const climbSpeed = ctx.running ? climbSpeedAt(time) : 0;
  lastClimbSpeed = climbSpeed;

  updateSetPieces(ctx);

  // Hush: the last stretch draws the frame down to a calm.
  const hush = ctx.ended ? 1 : MathUtils.smoothstep(time, 56.5, 59.6);
  hushUniform.value += (hush * 0.55 - hushUniform.value) * Math.min(1, dt * 2);

  // Inside the bay the sun stops mattering.
  const bayDepth = -stationDepth(ctx.camera);
  const interior = MathUtils.smoothstep(bayDepth, -6, 22);

  const lightning = lightningFlicker > 0 ? 1 : 0;
  sky.update(time, ctx.camera, flashUniform.value + lightning * 0.35, beatEnergy, interior);
  clouds.update(sky.state, time, ctx.camera.position.y);
  air.update(dt, ctx.camera.position, basis.climb, time, climbSpeed, ctx.running);
  air.group.visible = !ctx.ended && interior < 0.6;
  tether.update(beatEnergy, time, 0);
  platform.visible = time < 9 || !ctx.running;
  station.update(time, beatEnergy, bayDepth);

  // The car: hull state and which side is under attack.
  const threat: [number, number] = [0, 0];
  for (const record of enemyRecords.values()) {
    const side = record.mesh.userData.side as number | undefined;
    if (side === undefined) continue;
    const idx = side < 0 ? 0 : 1;
    let level = 0;
    if (record.kind === 'limpet') level = record.mesh.userData.latched === true ? 0.45 + ((record.mesh.userData.gnaw as number | undefined) ?? 0) * 0.55 : 0.12;
    else level = 0.2 + ((record.mesh.userData.closing as number | undefined) ?? 0) * 0.8;
    threat[idx] = Math.max(threat[idx], level);
  }
  car.update(ctx.camera, beatEnergy, hullNow, SKYHOOK_HULL, hurtUniform.value, ctx.elapsed, threat);

  // The Ripper. If the door reaches it first, the dock clamps shear it off the cable.
  if (ctx.running && bossState.sheared && !shearHandled) {
    shearHandled = true;
    const at = bossState.origin.clone();
    burstChips(at, 40, 34, { hazard: 0.35, size: 3.2, gravity: 0, drag: 0 });
    burstSparks(at, hdr(HAZARD_HOT, 1.7), 50, 30, { gravity: 0, drag: 0, life: 1.2, size: 2.2 });
    spawnRing(at, hdr(SIGNAL_WHITE, 1.6), 90, 1.0);
    spawnRing(at, hdr(HAZARD_HOT, 1.5), 50, 0.8);
    spawnGlint(at, hdr(SIGNAL_WHITE, 2.4), 18, 0.4);
    flashUniform.value = Math.max(flashUniform.value, 0.5);
    ctx.feel.shake(1.5, SHAKE);
    calloutRef('DOCK CLAMPS SHEAR IT OFF', 3);
  }
  latchShow.update(time, ctx.running);
  boss.update(dt, ctx.elapsed, ctx.camera, beatEnergy, ctx.running, ctx.running && bossState.latchedAt >= 0 ? time - bossState.latchedAt : 0);
  if (ctx.running && bossState.phase !== 'idle' && bossState.strides > lastStrides) {
    lastStrides = bossState.strides;
    // Each grip slams the cable: the whole climber shudders on the beat, and the planted hands throw sparks.
    const near = MathUtils.clamp(1 - (bossState.distance - 30) / 320, 0, 1);
    feelShake(ctx.feel, 0.16 + near * 0.55);
    if (near > 0.3) hurtUniform.value = Math.max(hurtUniform.value, near * 0.12);
    if (bossState.phase === 'approach' || bossState.phase === 'exposed') {
      const planted = new Vector3();
      for (let i = 0; i < 4; i += 1) {
        if (bossState.clampGone[i]) continue;
        clampLocal(i, bossState.strides, 0.5, planted);
        bossLocalToWorld(planted.x, planted.y, planted.z, planted);
        burstSparks(planted, hdr(HAZARD_HOT, 1.4), 5, 10 + near * 12, { gravity: 0, drag: 0.5, life: 0.5, size: 1.4 + near * 2 });
      }
    }
  }
  // Severed legs spark; a dying Ripper comes apart in chained blasts as it tumbles away.
  if (ctx.running && (bossState.phase === 'approach' || bossState.phase === 'exposed')) {
    for (let i = 0; i < 4; i += 1) {
      if (bossState.clampGone[i] && Math.random() < 0.18) burstSparks(boss.kneeWorld[i], hdr(HAZARD_HOT, 1.4), 3, 8, { gravity: 0, drag: 0.4, life: 0.4, size: 1.6 });
    }
  }
  if (ctx.running && bossState.phase === 'dying' && time - bossState.killedAt < 2.8 && Math.random() < 0.4) {
    const at = boss.group.position.clone().add(new Vector3((Math.random() - 0.5) * 50, (Math.random() - 0.5) * 50, (Math.random() - 0.5) * 50));
    burstSparks(at, hdr(HAZARD_HOT, 1.6), 10, 16, { gravity: 0, drag: 0, life: 0.9, size: 2.4 });
    burstChips(at, 4, 14, { hazard: 0.4, size: 2.4, gravity: 0, drag: 0 });
    spawnRing(at, hdr(HAZARD_HOT, 1.4), 22, 0.55);
    if (Math.random() < 0.3) feelShake(ctx.feel, 0.35);
  }

  // Enemies.
  for (const [enemyId, record] of enemyRecords.entries()) {
    if (!record.mesh.parent) {
      enemyRecords.delete(enemyId, { dispose: true });
      continue;
    }
    if (record.bornAt === null) record.bornAt = elapsedNow;
    const age = elapsedNow - record.bornAt;
    const mesh = record.mesh;
    const ease = easeOutBack(Math.min(1, age / 0.35));
    const distance = mesh.position.distanceTo(ctx.camera.position);
    if (mesh.userData.scaleWithDistance) mesh.userData.spawnScale = ease;
    else if (record.kind === 'bolt' || record.kind === 'torpedo' || record.kind === 'hook') {
      // Inbound shots shrink as they close so they never fill the frame.
      mesh.scale.setScalar(ease * MathUtils.clamp(distance / 12, 0.05, 1));
    } else if (!mesh.userData.hidden) mesh.scale.setScalar(ease * ((mesh.userData.baseScale as number | undefined) ?? 1));

    animateEnemy(mesh, record.kind, age, dt, distance);
    updateEnemyTint(record, ctx.camera);

    if (mesh.userData.isHostileShot) {
      dropTrail(mesh.position, HAZARD.clone().multiplyScalar(record.kind === 'bolt' ? 1.3 : 1.0));
    }
    if (record.kind === 'sentry' && (mesh.userData.thrust as number) > 0.2 && atmosphere(time) < 0.5) {
      // RCS puffs: short, straight, no smoke.
      const back = new Vector3(0, 0, -1).applyQuaternion(mesh.quaternion).multiplyScalar(1.4);
      burstSparks(mesh.position.clone().add(back), hdr(HAZARD_HOT, 0.9), 1, 6, { gravity: 0, drag: 0, life: 0.22, size: 0.7 });
    }
    if (record.kind === 'limpet' && mesh.userData.latched === true && Math.random() < 0.22) {
      burstSparks(mesh.position, hdr(HAZARD_HOT, 1.5), 2, 6, { gravity: 6 * atmosphere(time), life: 0.3, size: 0.6 });
    }

    if (record.lockRing) {
      record.lockRing.position.copy(mesh.position);
      record.lockRing.quaternion.copy(ctx.camera.quaternion);
      record.lockRing.rotation.z += dt * 2.2;
      const fit = ((mesh.userData.lockRingScale as number | undefined) ?? 1) * ((mesh.userData.baseScale as number | undefined) ?? 1);
      const pulse = 1 + Math.sin(elapsedNow * 9) * 0.05;
      const scaled = mesh.userData.scaleWithDistance ? mesh.scale.x : 1;
      record.lockRing.scale.setScalar(pulse * 1.5 * fit * Math.max(1, scaled));
    }
    record.lastPosition.copy(mesh.position);
  }

  for (const [projectileId, projectile] of projectileRecords.entries()) {
    if (!projectile.parent) {
      projectileRecords.delete(projectileId);
      continue;
    }
    dropTrail(projectile.position, ICE.clone().multiplyScalar(0.9));
  }

  if (!reticleRef) reticleRef = findReticle(ctx.scene);
  updateReticle(reticleRef, dt);
  lightningBolt.update(dt);
  updateEffects(dt, ctx.camera, atmosphere(time));
}

function stationDepth(camera: Camera) {
  // Signed distance of the camera before the bay door along the climb (+ = approaching).
  const door = station.group.position;
  const toDoor = door.clone().sub(camera.position);
  return toDoor.dot(basis.climb);
}

function updateSetPieces(ctx: VisualContext) {
  if (!ctx.running) {
    lastRunTime = -1;
    return;
  }
  const t = ctx.runTime;
  const crossed = (at: number) => lastRunTime >= 0 && lastRunTime < at && t >= at;

  // Lightning on the storm's downbeats: a hard flash, a stutter, a thunderhead glow.
  while (lightningQueue.length > 0 && t >= lightningQueue[0]) {
    lightningQueue.shift();
    flashUniform.value = Math.max(flashUniform.value, 0.42);
    lightningFlicker = 0.14;
    strikes += 1;
    lightningBolt.strike(ctx.camera, basis.forward, strikes);
    ctx.feel.shake(0.3, SHAKE);
  }
  if (lightningFlicker > 0) lightningFlicker = Math.max(0, lightningFlicker - 1 / 60);

  // The deck: whiteout building through the cloud, then punching out into blue.
  if (t > DECK_TIME - 2.2 && t < DECK_TIME + 1.8) {
    const inside = MathUtils.smoothstep(t, DECK_TIME - 2.2, DECK_TIME - 0.5) * (1 - MathUtils.smoothstep(t, DECK_TIME - 0.2, DECK_TIME + 0.9));
    flashUniform.value = Math.max(flashUniform.value, inside * 0.1);
  }
  if (crossed(DECK_TIME - 0.5)) {
    ctx.feel.kickFov(11, { decay: 1.6 });
    ctx.feel.shake(1.1, SHAKE);
    flashUniform.value = Math.max(flashUniform.value, 0.22);
  }
  if (crossed(DECK_TIME + 0.4)) {
    // Out of the top of the cloud: the sun arrives.
    flashUniform.value = Math.max(flashUniform.value, 0.5);
    beatEnergy = 1.6;
  }
  // Boss latches: the comet strikes the cable, and the tether rings like a struck bell.
  if (crossed(LATCH_TIME)) {
    ctx.feel.shake(1.0, SHAKE);
    const at = latchShow.strikePoint;
    spawnRing(at, hdr(SIGNAL_WHITE, 1.8), 80, 0.9);
    spawnRing(at, hdr(HAZARD_HOT, 1.6), 46, 0.7);
    spawnGlint(at, hdr(SIGNAL_WHITE, 2.6), 36, 0.5);
    burstSparks(at, hdr(HAZARD_HOT, 1.7), 40, 26, { gravity: 0, drag: 0, life: 1.2, size: 3.2 });
  }
  // Doors and docking.
  if (crossed(DOCK_TIME - 0.2)) ctx.feel.kickFov(-2, { decay: 1.2 });
  lastRunTime = t;
}

export function updateCameraEffects(dt: number, ctx: { camera: PerspectiveCamera; runTime: number; running: boolean; feel: CameraFeelRig }) {
  const { camera, feel } = ctx;
  const time = ctx.running ? ctx.runTime : 0;
  const speed = ctx.running ? lastClimbSpeed : 30;

  // FOV breathes with the climb speed: wide on the deck lurch, narrowing to a
  // telephoto settle as the car brakes into the bay.
  const target = MathUtils.clamp((speed - 52) * 0.14, -7.5, 6) + beatEnergy * 0.8;
  cameraFovOffset = MathUtils.lerp(cameraFovOffset, target, Math.min(1, dt * 5));

  // Wind buffets the car in the storm; in the thin air it flies dead level.
  const storm = 1 - MathUtils.smoothstep(time, 12.5, 15.4);
  const targetRoll = (Math.sin(time * 1.3) * 0.010 + Math.sin(time * 3.7 + 1.2) * 0.006) * storm + Math.sin(time * 0.45) * 0.004 * (1 - storm);
  cameraRoll += (targetRoll - cameraRoll) * Math.min(1, dt * 3);
  camera.rotateZ(cameraRoll);

  feel.setFovOffset(cameraFovOffset);
  feel.update(dt, { shake: SHAKE });
}

function findReticle(scene: Scene): Object3D | undefined {
  for (const child of scene.children) if (child.userData.raildRole === 'reticle') return child;
  return undefined;
}

function easeOutBack(t: number) {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2;
}
