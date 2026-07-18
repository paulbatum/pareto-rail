import {
  BoxGeometry,
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
  disposeObject3D,
} from '../../../engine/visual-kit';
import type { EventBus } from '../../../events';
import {
  BROADSIDE_DURATION,
  BROADSIDE_GENERATOR_COUNT,
  BROADSIDE_PLAYER_HEALTH,
  broadsideRunProgress,
  createBroadsideRail,
  speedFactorAt,
} from '../gameplay';
import { BROADSIDE_BARS, bar } from '../timing';
import {
  breakCoreShroud,
  breakGeneratorCowl,
  createBoltMesh,
  createCoreMesh,
  createCorsairMesh,
  createEscortMesh,
  createGeneratorMesh,
  createInterceptorMesh,
  createLanceMesh,
  createTurretMesh,
  updateFlagshipHardware,
  type TintPart,
} from './enemies';
import { createEnvironmentInternal, type Environment } from './environment';
import {
  burstShards,
  burstSparks,
  createEffects,
  dropTrail,
  enemyDeath,
  resetEffects,
  spawnGlint,
  spawnRing,
  spawnWreck,
  updateEffects,
  type ShardSpec,
} from './effects';
import { clearLetterDenied, createLetterMesh, setLetterDenied, setLetterLocked } from './letters';
import {
  CRIMSON,
  EMBER,
  FRIEND_CYAN,
  ICE_WHITE,
  LOCK_GRADIENT,
  MOLTEN,
  NEBULA_GOLD,
  OBSIDIAN,
  hdr,
} from './palette';
import { damageUniform, flashUniform, shadowUniform } from './post-fx';

// Palette and event choreography live here; mesh construction is in the leaf
// files. This module decides what a lock looks like, what a kill costs the
// frame, and how hard the camera flinches when something big lets go.
//
// The one colour rule the level obeys everywhere: cyan is yours, crimson and
// molten orange are theirs, gold belongs to the nebula and to a fully charged
// battery. You never have to think about whose round just went past you.

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
  lockBracket: Group | null;
  lastEmberAt: number;
};

type ProjectileRecord = {
  mesh: Object3D;
  trailColor: Color;
};

const DENY_EDGE = new Color(1.7, 0.08, 0.06);
const DENY_FILL = new Color(0.3, 0.015, 0.01);
/** The fill colour a hostile hull takes while it is yours. */
const LOCKED_FILL = new Color(0.03, 0.16, 0.24);

const BROADSIDE_SHAKE: CameraFeelShakeOptions = {
  decay: 2.5,
  maxTrauma: 1.8,
  pitchDegrees: 0.32,
  yawDegrees: 0.3,
  rollDegrees: 0.85,
  frequency: 9.5,
  smoothing: 21,
};

const rail = createBroadsideRail();

let environment: Environment | null = null;
let beatEnergy = 0;
let surge = 0;
let cameraRoll = 0;
let cameraFov = 0;
let elapsedNow = 0;
let hitsTaken = 0;
let damagePulse = 0;
let generatorsDown = 0;

const lockBrackets = createAdornmentSlot<EnemyRecord, Group>({
  get: (record) => record.lockBracket,
  set: (record, bracket) => {
    record.lockBracket = bracket;
  },
});

// createEnemyMesh() has no id, but the runner emits `spawn` synchronously right
// after calling it — pairing the queue with spawn events links mesh to id.
const enemyRecords = createPendingVisualRecords<Group, EnemyRecord>({
  createRecord: (mesh) => ({ mesh, bornAt: null, lockBracket: null, lastEmberAt: 0 }),
  // Every hostile is built fresh so its rim strips and heat cores can be tinted
  // per instance, which means every hostile also has to be torn down: over a
  // hundred targets a run, keeping them would be a real geometry leak.
  disposeRecord: (record) => {
    lockBrackets.detach(record);
    disposeObject3D(record.mesh);
  },
});
const projectileRecords = createPendingVisualRecords<ProjectileRecord, ProjectileRecord>({
  createRecord: (record) => record,
  disposeRecord: (record) => disposeObject3D(record.mesh),
});

export function createEnvironment(scene: Scene) {
  environment = createEnvironmentInternal(scene);
  createEffects(scene);
  return environment.root;
}

// Silhouette sizes: swarm craft stay small, because the whole point of the
// level is that they are small and so are you. Capital hardware is huge.
const KIND_SCALE: Record<string, number> = {
  interceptor: 1.5,
  corsair: 1.35,
  lance: 1.45,
  turret: 1.5,
  escort: 1.5,
  bolt: 1.3,
  generator: 1.15,
  core: 1.3,
};

export function createEnemyMesh(kind: string, letter?: string) {
  const built = buildEnemyMesh(kind, letter);
  const scale = KIND_SCALE[kind] ?? 1;
  let mesh = built;
  if (scale !== 1) {
    // Wrap so the spawn scale-in animates the outer group while the inner one
    // holds each silhouette's readability scale.
    built.scale.setScalar(scale);
    mesh = new Group();
    mesh.add(built);
    mesh.userData = built.userData;
  }
  mesh.userData.kind = kind;
  mesh.scale.setScalar(0.001);
  enemyRecords.enqueue(mesh);
  return mesh;
}

function buildEnemyMesh(kind: string, letter?: string): Group {
  switch (kind) {
    case 'letter':
      return createLetterMesh(letter ?? 'A');
    case 'interceptor':
      return createInterceptorMesh();
    case 'corsair':
      return createCorsairMesh();
    case 'lance':
      return createLanceMesh();
    case 'turret':
      return createTurretMesh();
    case 'escort':
      return createEscortMesh();
    case 'bolt':
      return createBoltMesh();
    case 'generator':
      return createGeneratorMesh();
    case 'core':
      return createCoreMesh();
    default:
      return createInterceptorMesh();
  }
}

export function setEnemyLocked(mesh: Object3D, locked: boolean) {
  mesh.userData.locked = locked;
  if (mesh.userData.isLetter) setLetterLocked(mesh as Group, locked);
}

export function setEnemyDenied(mesh: Object3D) {
  mesh.userData.deniedUntil = elapsedNow + 0.55;
  // A light volley off capital armour throws sparks and achieves nothing else.
  const heavy = mesh.userData.kind === 'generator' || mesh.userData.kind === 'core';
  spawnRing(mesh.position, DENY_EDGE.clone(), heavy ? 6 : 2.6, 0.32);
  if (heavy) burstSparks(mesh.position, hdr(ICE_WHITE, 1.1), 12, 16, 0.5);
}

/** Your rounds are cold: an ice-white core inside a cyan tracer shell. */
export function createProjectileMesh() {
  const group = new Group();
  const coreGeometry = new OctahedronGeometry(0.3, 0);
  coreGeometry.scale(0.4, 0.4, 2.6);
  group.add(new Mesh(coreGeometry, new MeshBasicMaterial({ color: hdr(ICE_WHITE, 2.8) })));
  const shellGeometry = new OctahedronGeometry(0.5, 0);
  shellGeometry.scale(0.5, 0.5, 2.2);
  group.add(new Mesh(shellGeometry, createAdditiveBasicMaterial({ color: hdr(FRIEND_CYAN, 1.2), opacity: 0.6 })));
  projectileRecords.enqueue({ mesh: group, trailColor: FRIEND_CYAN.clone().multiplyScalar(0.9) });
  return group;
}

// ---- reticle -----------------------------------------------------------------------------

/**
 * The reticle is your own battery status board. Six pips ring the sight, one
 * per gun; they light in order as you lock, and a full six is a physical ring
 * of gold — you can see a broadside is ready without reading the HUD.
 */
export function createReticle() {
  const group = new Group();
  const parts: Array<{ material: MeshBasicMaterial; base: Color }> = [];
  const addPart = (mesh: Mesh, base: Color) => {
    const material = configureAdditiveMaterial(mesh.material as MeshBasicMaterial, { color: base, side: DoubleSide });
    parts.push({ material, base });
  };

  const outer = new Mesh(new RingGeometry(0.66, 0.688, 56), new MeshBasicMaterial());
  addPart(outer, hdr(FRIEND_CYAN, 0.95));

  const pips = new Group();
  const pipMaterials: MeshBasicMaterial[] = [];
  for (let i = 0; i < 6; i += 1) {
    const pip = new Mesh(new PlaneGeometry(0.13, 0.055), new MeshBasicMaterial());
    pipMaterials.push(configureAdditiveMaterial(pip.material as MeshBasicMaterial, {
      color: hdr(FRIEND_CYAN, 0.3),
      side: DoubleSide,
    }));
    const angle = -Math.PI / 2 + ((i + 0.5) / 6) * Math.PI * 2;
    pip.position.set(Math.cos(angle) * 0.82, Math.sin(angle) * 0.82, 0);
    pip.rotation.z = angle;
    pips.add(pip);
  }

  const ticks = new Group();
  for (let i = 0; i < 4; i += 1) {
    const tick = new Mesh(new PlaneGeometry(0.16, 0.03), new MeshBasicMaterial());
    addPart(tick, hdr(ICE_WHITE, 0.9));
    const angle = (i / 4) * Math.PI * 2 + Math.PI / 4;
    tick.position.set(Math.cos(angle) * 0.48, Math.sin(angle) * 0.48, 0);
    tick.rotation.z = angle;
    ticks.add(tick);
  }

  const dot = new Mesh(new CircleGeometry(0.038, 14), new MeshBasicMaterial());
  addPart(dot, hdr(ICE_WHITE, 2.0));

  group.add(outer, pips, ticks, dot);
  group.userData.parts = parts;
  group.userData.pipMaterials = pipMaterials;
  group.userData.ticks = ticks;
  group.userData.active = false;
  return group;
}

export function setReticleActive(reticle: Object3D, active: boolean, lockCount: number) {
  reticle.userData.active = active;
  reticle.scale.setScalar(1 + lockCount * 0.045 + (active ? 0.06 : 0));

  const charge = lockCount === 0 ? null : colorForLockCount(lockCount, LOCK_GRADIENT);
  const parts = reticle.userData.parts as Array<{ material: MeshBasicMaterial; base: Color }>;
  for (const part of parts) {
    if (charge) part.material.color.copy(hdr(charge, active ? 1.6 : 1.25));
    else part.material.color.copy(part.base).multiplyScalar(active ? 1.35 : 1);
  }

  const pipMaterials = reticle.userData.pipMaterials as MeshBasicMaterial[];
  pipMaterials.forEach((material, index) => {
    const lit = index < lockCount;
    material.color.copy(hdr(lit ? colorForLockCount(index + 1, LOCK_GRADIENT) : FRIEND_CYAN, lit ? 2.1 : 0.26));
  });
}

// ---- event choreography --------------------------------------------------------------------

export function installVisualEventHandlers(bus: EventBus, scene: Scene, cameraFeel: CameraFeelRig) {
  bus.on('spawn', ({ enemyId, kind, worldPosition }) => {
    const record = enemyRecords.claim(enemyId);
    if (!record) return;
    if (kind === 'generator') {
      spawnRing(worldPosition, hdr(MOLTEN, 1.2), 7, 0.5);
    } else if (kind === 'core') {
      cameraFeel.shake(0.5, BROADSIDE_SHAKE);
      spawnRing(worldPosition, hdr(CRIMSON, 1.3), 14, 0.6);
    } else if (kind !== 'bolt' && kind !== 'letter') {
      spawnRing(worldPosition, hdr(EMBER, 0.6), 2.4, 0.3);
    }
  });

  bus.on('lock', ({ enemyId, worldPosition, lockCount }) => {
    const lockColor = colorForLockCount(lockCount, LOCK_GRADIENT);
    const record = enemyRecords.get(enemyId);
    if (record && !record.lockBracket) lockBrackets.attach(record, makeLockBracket(lockColor), scene);
    spawnRing(worldPosition, hdr(lockColor, 1.4), 2.1, 0.24);
  });

  bus.on('unlock', ({ enemyId }) => {
    const record = enemyRecords.get(enemyId);
    if (record) lockBrackets.detach(record);
  });

  bus.on('fire', ({ projectileId, worldPosition }) => {
    projectileRecords.claim(projectileId);
    spawnGlint(worldPosition, hdr(FRIEND_CYAN, 1.3), 0.6, 0.11);
  });

  bus.on('hit', ({ enemyId, projectileId, worldPosition, lethal }) => {
    projectileRecords.delete(projectileId, { dispose: true });
    burstSparks(worldPosition, hdr(ICE_WHITE, 1.0), 5, 11);
    const record = enemyRecords.get(enemyId);
    if (record && !lethal) {
      record.mesh.userData.damageFlashUntil = elapsedNow + 0.26;
      spawnGlint(worldPosition, hdr(ICE_WHITE, 1.7), 1.1, 0.14);
    }
  });

  // Armour off. Both boss pieces physically shed the plate that was in the way.
  bus.on('stage', ({ enemyId, worldPosition }) => {
    const record = enemyRecords.get(enemyId);
    if (!record) return;
    const kind = record.mesh.userData.kind as string | undefined;
    const specs = record.mesh.userData.shardSpecs as ShardSpec[] | undefined;
    if (kind === 'generator') {
      breakGeneratorCowl(record.mesh);
      if (specs) burstShards(worldPosition, specs.slice(0, 4), 1.6);
      burstSparks(worldPosition, hdr(MOLTEN, 1.2), 20, 18);
      spawnRing(worldPosition, hdr(MOLTEN, 1.4), 9, 0.5);
      cameraFeel.shake(0.5, BROADSIDE_SHAKE);
    } else if (kind === 'core') {
      breakCoreShroud(record.mesh);
      if (specs) burstShards(worldPosition, specs.slice(0, 6), 2.0);
      burstSparks(worldPosition, hdr(MOLTEN, 1.3), 28, 22);
      spawnRing(worldPosition, hdr(MOLTEN, 1.5), 15, 0.6);
      flashUniform.value = Math.max(flashUniform.value, 0.22);
      cameraFeel.shake(0.85, BROADSIDE_SHAKE);
    } else {
      if (specs) burstShards(worldPosition, specs.slice(0, 3));
      burstSparks(worldPosition, hdr(EMBER, 1.1), 10, 13);
    }
  });

  bus.on('kill', ({ enemyId, worldPosition }) => {
    const record = enemyRecords.get(enemyId);
    if (!record) return;
    const kind = record.mesh.userData.kind as string | undefined;
    const specs = record.mesh.userData.shardSpecs as ShardSpec[] | undefined;
    const accent = (record.mesh.userData.accent as Color | undefined) ?? CRIMSON;

    if (kind === 'generator') {
      generatorsDown += 1;
      environment?.setShieldStrength(1 - generatorsDown / BROADSIDE_GENERATOR_COUNT);
      enemyDeath(worldPosition, specs, MOLTEN, 2.6);
      spawnRing(worldPosition, hdr(NEBULA_GOLD, 1.3), 26, 0.75);
      spawnGlint(worldPosition, hdr(MOLTEN, 2.0), 4, 0.3);
      spawnWreck(worldPosition, new Vector3(48, 24, 14), 2.4, 2.2);
      flashUniform.value = Math.max(flashUniform.value, 0.3);
      surge = Math.max(surge, 0.5);
      cameraFeel.shake(1.0, BROADSIDE_SHAKE);
    } else if (kind === 'core') {
      enemyDeath(worldPosition, specs, MOLTEN, 3.4);
      spawnRing(worldPosition, hdr(NEBULA_GOLD, 1.6), 44, 1.0);
      spawnRing(worldPosition, hdr(CRIMSON, 1.2), 24, 0.7);
      spawnGlint(worldPosition, hdr(NEBULA_GOLD, 2.4), 7, 0.4);
      burstSparks(worldPosition, hdr(MOLTEN, 1.4), 46, 30, 1.4);
      spawnWreck(worldPosition, new Vector3(-62, -46, 30), 3.4, 2.2);
      flashUniform.value = Math.max(flashUniform.value, 0.62);
      surge = 1;
      cameraFeel.shake(1.5, BROADSIDE_SHAKE);
    } else if (kind === 'lance' || kind === 'turret') {
      // No tumbling hulk here: at this speed a slow-drifting wreck parks itself
      // in front of the next target. Ordinary kills get sparks and plating only.
      enemyDeath(worldPosition, specs, accent, 1.5);
      cameraFeel.shake(0.24, BROADSIDE_SHAKE);
    } else if (kind === 'letter') {
      if (specs) burstShards(worldPosition, specs);
      spawnRing(worldPosition, hdr(FRIEND_CYAN, 1.1), 3.2, 0.35);
    } else {
      enemyDeath(worldPosition, specs, accent, 1);
    }

    enemyRecords.delete(enemyId, { dispose: true });
  });

  bus.on('miss', ({ enemyId, worldPosition }) => {
    enemyRecords.delete(enemyId, { dispose: true });
    burstSparks(worldPosition, OBSIDIAN.clone().multiplyScalar(3), 3, 4, 0.3);
  });

  bus.on('bossphase', ({ phase }) => {
    if (phase === 'exposed') {
      // The shield lets go all at once: a magenta wall snapping outward.
      environment?.setShieldStrength(0);
      flashUniform.value = Math.max(flashUniform.value, 0.55);
      surge = Math.max(surge, 0.8);
      beatEnergy = 1.8;
      cameraFeel.shake(1.3, BROADSIDE_SHAKE);
    }
    if (phase === 'destroyed') {
      environment?.breakFlagship();
      flashUniform.value = Math.max(flashUniform.value, 1.0);
      surge = 1;
      cameraFeel.shake(1.8, BROADSIDE_SHAKE);
    }
  });

  bus.on('reject', () => {
    damagePulse = Math.max(damagePulse, 0.35);
  });

  bus.on('volley', ({ size, kills }) => {
    if (size >= 5 && kills === size) {
      beatEnergy = Math.max(beatEnergy, 1.7);
      flashUniform.value = Math.max(flashUniform.value, 0.18);
      surge = Math.max(surge, 0.35);
    }
  });

  bus.on('beat', ({ isDownbeat }) => {
    beatEnergy = Math.max(beatEnergy, isDownbeat ? 1 : 0.4);
  });

  bus.on('playerhit', () => {
    hitsTaken += 1;
    damagePulse = 1;
    beatEnergy = 1.5;
    cameraFeel.shake(1.35, BROADSIDE_SHAKE);
  });

  bus.on('runstart', () => {
    resetEffects();
    environment?.reset();
    enemyRecords.clear({ dispose: true, pending: true });
    projectileRecords.clear({ dispose: true, pending: true });
    resetCameraFeel(cameraFeel);
    flashUniform.value = 0;
    damageUniform.value = 0;
    shadowUniform.value = 0;
    surge = 0;
    hitsTaken = 0;
    damagePulse = 0;
    generatorsDown = 0;
  });

  bus.on('runend', () => {
    resetCameraFeel(cameraFeel);
  });
}

// ---- per-frame ---------------------------------------------------------------------------

function resetCameraFeel(cameraFeel: CameraFeelRig) {
  cameraRoll = 0;
  cameraFov = 0;
  cameraFeel.restore();
}

const SHADOW_FROM = bar(BROADSIDE_BARS.belly - 0.5);
const SHADOW_TO = bar(BROADSIDE_BARS.flagship - 0.4);
const PULLOUT_FROM = bar(BROADSIDE_BARS.victory + 0.05);
const PULLOUT_TO = bar(BROADSIDE_BARS.victory + 0.85);

export function updateVisuals(dt: number, ctx: VisualContext) {
  elapsedNow = ctx.elapsed;
  beatEnergy = Math.max(0, beatEnergy - dt * 4.0);
  surge = Math.max(0, surge - dt * 0.9);
  damagePulse = Math.max(0, damagePulse - dt * 1.6);

  const runTime = ctx.running ? ctx.runTime : 0;
  environment?.update(dt, {
    camera: ctx.camera as PerspectiveCamera,
    elapsed: ctx.elapsed,
    runTime,
    running: ctx.running,
    beatEnergy,
  });

  // Under the enemy warship the nebula is blocked: the light actually leaves.
  shadowUniform.value = ctx.running
    ? smoothWindow(runTime, SHADOW_FROM, SHADOW_FROM + 0.9, SHADOW_TO - 1.1, SHADOW_TO)
    : 0;
  damageUniform.value = Math.min(1, damagePulse * 0.55 + Math.min(1, hitsTaken / BROADSIDE_PLAYER_HEALTH) * 0.07);
  flashUniform.value = Math.max(0, flashUniform.value - dt * (flashUniform.value > 0.6 ? 1.4 : 2.6));

  for (const [enemyId, record] of enemyRecords.entries()) {
    if (!record.mesh.parent) {
      enemyRecords.delete(enemyId, { dispose: true });
      continue;
    }
    if (record.bornAt === null) record.bornAt = elapsedNow;
    record.mesh.scale.setScalar(easeOutBack(Math.min(1, (elapsedNow - record.bornAt) / 0.32)));

    updateEnemyTint(record, ctx);

    const kind = record.mesh.userData.kind as string | undefined;

    // Gunships and turrets telegraph: the muzzle lamp climbs to white-hot.
    if (kind === 'lance' || kind === 'turret') {
      const lamp = record.mesh.userData.chargeLamp as MeshBasicMaterial | undefined;
      const charge = (record.mesh.userData.charge as number | undefined) ?? 0;
      if (lamp && record.mesh.userData.locked !== true) {
        lamp.color.copy(CRIMSON.clone().lerp(ICE_WHITE, charge * 0.75)).multiplyScalar(0.8 + charge * 2.6);
      }
    }

    if (kind === 'generator' || kind === 'core') {
      updateFlagshipHardware(record.mesh, elapsedNow);
      // Bare machinery sheds embers into the flight path.
      if (record.mesh.userData.bare && elapsedNow - record.lastEmberAt > 0.1) {
        record.lastEmberAt = elapsedNow;
        burstSparks(record.mesh.position, hdr(MOLTEN, 1.1), 2, 7, 0.4);
      }
    }

    if (record.mesh.userData.isHostileShot) {
      dropTrail(record.mesh.position, record.mesh.userData.trailColor as Color, 0.5);
    }

    if (record.lockBracket) {
      record.mesh.getWorldPosition(record.lockBracket.position);
      record.lockBracket.quaternion.copy((ctx.camera as PerspectiveCamera).quaternion);
      record.lockBracket.rotation.z -= dt * 1.6;
      const fit = (record.mesh.userData.lockRingScale as number | undefined) ?? 1;
      record.lockBracket.scale.setScalar((1 + Math.sin(elapsedNow * 10) * 0.05) * 1.85 * fit);
    }
  }

  for (const [projectileId, record] of projectileRecords.entries()) {
    if (!record.mesh.parent) {
      projectileRecords.delete(projectileId, { dispose: true });
      continue;
    }
    dropTrail(record.mesh.position, record.trailColor);
  }

  const reticle = findReticle(ctx.scene);
  if (reticle) {
    const ticks = reticle.userData.ticks as Group | undefined;
    if (ticks) ticks.rotation.z += dt * (reticle.userData.active === true ? 2.6 : 0.55);
  }

  updateEffects(dt, ctx.camera);
}

export function updateCameraEffects(dt: number, ctx: CameraEffectsContext) {
  if (!(ctx.camera instanceof PerspectiveCamera)) return;
  const camera = ctx.camera;
  const runTime = ctx.running ? ctx.runTime : 0;
  const speed = ctx.running ? speedFactorAt(runTime) : 0.4;

  // The pull-out: past the breaking flagship, past both fleets, the whole
  // engagement in frame. The rail is already climbing out of the trench; this
  // swings the look back across it and opens the field of view right up.
  const pullOut = ctx.running
    ? smootherstep(MathUtils.clamp((runTime - PULLOUT_FROM) / Math.max(0.01, PULLOUT_TO - PULLOUT_FROM), 0, 1))
    : 0;

  const targetFov = (speed - 1.0) * 8.0 + beatEnergy * 1.1 + surge * 7.5 + pullOut * 26;
  cameraFov = MathUtils.lerp(cameraFov, targetFov, Math.min(1, dt * 6));

  if (ctx.running) {
    // Bank into the turn: roll is read off the rail's own lateral curvature, so
    // every authored hard bank rolls the horizon without a second timeline.
    const u = broadsideRunProgress(runTime, BROADSIDE_DURATION);
    const tangent = rail.getTangentAt(MathUtils.clamp(u, 0, 1));
    const ahead = rail.getTangentAt(MathUtils.clamp(u + 0.005, 0, 1));
    const target = MathUtils.clamp((ahead.x - tangent.x) * 30, -0.34, 0.34);
    cameraRoll += (target - cameraRoll) * Math.min(1, dt * 3.4);
    camera.rotateZ(cameraRoll);

    if (pullOut > 0) {
      camera.rotateY(pullOut * 1.95);
      camera.rotateX(-pullOut * 0.3);
      camera.rotateZ(pullOut * 0.25);
    }
  }

  ctx.feel.setFovOffset(cameraFov);
  ctx.feel.update(dt, { shake: BROADSIDE_SHAKE });
}

function updateEnemyTint(record: EnemyRecord, ctx: VisualContext) {
  const userData = record.mesh.userData;
  const denied = ((userData.deniedUntil as number | undefined) ?? -Infinity) > elapsedNow;

  if (userData.isLetter) {
    if (denied) setLetterDenied(record.mesh, true);
    else clearLetterDenied(record.mesh);
    return;
  }

  const parts = userData.parts as TintPart[] | undefined;
  if (!parts) return;

  // Distance falloff keeps far additive stacks from washing the nebula out: the
  // silhouette carries the read at range, the rim light carries it up close.
  const distance = record.mesh.position.distanceTo((ctx.camera as PerspectiveCamera).position);
  const closeness = smootherstep(clamp01(1 - (distance - 18) / (90 - 18)));
  const damageFlash = ((userData.damageFlashUntil as number | undefined) ?? -Infinity) > elapsedNow;
  // A core still behind her shield reads dead: no heat, nothing to shoot at.
  const gate = userData.shielded === true ? 0.3 : 1;

  for (const part of parts) {
    if (denied) {
      part.material.color.copy(part.kind === 'fill' ? DENY_FILL : DENY_EDGE);
      continue;
    }
    if (userData.locked === true) {
      // Locked targets take on your colour — the one time cyan touches a
      // hostile hull, and the clearest possible "this one is mine".
      if (part.kind === 'edge') part.material.color.copy(hdr(FRIEND_CYAN, 1.8));
      else if (part.kind === 'fill') part.material.color.copy(LOCKED_FILL);
      else part.material.color.copy(hdr(ICE_WHITE, 2.1));
      continue;
    }
    if (damageFlash) {
      part.material.color.copy(hdr(ICE_WHITE, part.kind === 'fill' ? 0.55 : 1.9));
      continue;
    }
    const dim = (part.kind === 'fill' ? 0.45 + 0.55 * closeness : 0.5 + 0.5 * closeness) * gate;
    part.material.color.copy(part.base).multiplyScalar(dim);
  }
}

function findReticle(scene: Scene): Object3D | null {
  for (const child of scene.children) {
    if (child.userData.raildRole === 'reticle') return child;
  }
  return null;
}

/** Lock bracket: a pair of open gun-laying arcs with a range spar, not a closed ring. */
function makeLockBracket(color: Color): Group {
  const group = new Group();
  for (const rotation of [0, Math.PI]) {
    const arc = new Mesh(
      new RingGeometry(0.78, 0.86, 20, 1, -0.7, 1.4),
      createAdditiveBasicMaterial({ color: hdr(color, 1.8), side: DoubleSide }),
    );
    arc.rotation.z = rotation;
    group.add(arc);
  }
  const spar = new Mesh(
    new BoxGeometry(0.06, 0.34, 0.02),
    createAdditiveBasicMaterial({ color: hdr(color.clone().lerp(ICE_WHITE, 0.5), 1.4) }),
  );
  spar.position.y = 0.95;
  group.add(spar);
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

/** Ramp up between a→b, hold, ramp down between c→d. */
function smoothWindow(value: number, a: number, b: number, c: number, d: number) {
  const rise = smootherstep(clamp01((value - a) / Math.max(1e-4, b - a)));
  const fall = 1 - smootherstep(clamp01((value - c) / Math.max(1e-4, d - c)));
  return Math.min(rise, fall);
}
