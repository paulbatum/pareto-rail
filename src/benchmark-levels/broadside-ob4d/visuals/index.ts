import {
  CircleGeometry,
  Color,
  DoubleSide,
  Group,
  MathUtils,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  PerspectiveCamera,
  PlaneGeometry,
  RingGeometry,
  Scene,
  Vector3,
} from 'three';
import type { CameraFeelRig, CameraFeelShakeOptions } from '../../../engine/camera-feel';
import { MAX_LOCKS, colorForLockCount } from '../../../engine/locks';
import {
  createAdditiveBasicMaterial,
  createAdornmentSlot,
  createPendingVisualRecords,
  configureAdditiveMaterial,
  disposeObject3D,
} from '../../../engine/visual-kit';
import type { EventBus } from '../../../events';
import { battle } from '../state';
import { BROADSIDE_DURATION, BROADSIDE_PLAYER_HEALTH, broadsideRunProgress, speedFactorAt } from '../gameplay';
import { EYE_TIME, VICTORY_TIME } from '../timing';
import {
  burstShards,
  burstSparks,
  createEffects,
  dropTrail,
  resetEffects,
  spawnGlint,
  spawnRing,
  spawnWreck,
  updateEffects,
  type ShardSpec,
} from './effects';
import { BROADSIDE_RAIL, createEnvironmentInternal, type Environment } from './environment';
import { createLetterMesh, setLetterDenied, setLetterLocked } from './letters';
import {
  breakCoreArmour,
  createCoreMesh,
  createEscortMesh,
  createGeneratorMesh,
  createInterceptorMesh,
  createPlayerProjectile,
  createShellMesh,
  createTurretMesh,
  createWaspMesh,
  type TintPart,
} from './models';
import {
  ALLY_CYAN,
  FOE_CRIMSON,
  FOE_HULL,
  FOE_MOLTEN,
  LOCK_GRADIENT,
  NEBULA_GOLD,
  NEBULA_MAGENTA,
  WHITE_HOT,
  hdr,
} from './palette';
import { alarmUniform, damageUniform, flashUniform, nebulaUniform } from './post-fx';

export type VisualContext = {
  scene: Scene;
  camera: PerspectiveCamera;
  elapsed: number;
  runTime: number;
  running: boolean;
  feel: CameraFeelRig;
};

export type CameraEffectsContext = {
  camera: PerspectiveCamera;
  runTime: number;
  running: boolean;
  feel: CameraFeelRig;
};

type EnemyRecord = {
  mesh: Group;
  bornAt: number | null;
  lockBracket: Group | null;
};

type ProjectileRecord = { mesh: Object3D };

const DENY_EDGE = new Color(1.6, 0.08, 0.06);
const DENY_FILL = new Color(0.3, 0.015, 0.01);

const CAMERA_SHAKE: CameraFeelShakeOptions = {
  decay: 2.6,
  maxTrauma: 1.8,
  pitchDegrees: 0.36,
  yawDegrees: 0.34,
  rollDegrees: 0.85,
  frequency: 9,
  smoothing: 20,
};

let environment: Environment | null = null;
let beatEnergy = 0;
let downbeats = 0;
let surge = 0;
let cameraRoll = 0;
let cameraFov = 0;
let pullOut = 0;
let elapsedNow = 0;
let hitsTaken = 0;
let damagePulse = 0;
let alarmPulse = 0;

// Bracket geometry is shared across every lock in the run: a sixty-second run
// takes hundreds of locks, and allocating a fresh ring per lock is how a level
// fails the geometry-growth gate. Disposal therefore frees materials only.
const BRACKET_ARC_GEOMETRY = [-1, 1].map((side) =>
  new RingGeometry(0.76, 0.84, 20, 1, side > 0 ? -0.62 : Math.PI - 0.62, 1.24));
const BRACKET_TICK_GEOMETRY = new PlaneGeometry(0.1, 0.28);

const lockBrackets = createAdornmentSlot<EnemyRecord, Group>({
  get: (record) => record.lockBracket,
  set: (record, bracket) => {
    record.lockBracket = bracket;
  },
  disposeAdornment: (bracket) => {
    bracket.traverse((child) => {
      const material = (child as Mesh).material as MeshBasicMaterial | undefined;
      material?.dispose();
    });
  },
});

// createEnemyMesh() has no id, but the runner emits `spawn` synchronously right
// after calling it — pairing the queue with spawn events links mesh to id.
const enemyRecords = createPendingVisualRecords<Group, EnemyRecord>({
  createRecord: (mesh) => ({ mesh, bornAt: null, lockBracket: null }),
  disposeRecord: (record) => {
    lockBrackets.detach(record);
    // Every hostile is assembled from geometry built for that one instance, and
    // a sixty-second run spawns well over a hundred of them. Releasing a dead
    // target's buffers here is what keeps geometry count flat across the run
    // instead of climbing until the perf gate trips.
    disposeObject3D(record.mesh);
  },
});
const projectileRecords = createPendingVisualRecords<ProjectileRecord, ProjectileRecord>({
  createRecord: (record) => record,
});

export function createEnvironment(scene: Scene) {
  environment = createEnvironmentInternal(scene);
  createEffects(scene);
  return environment.root;
}

// Readability scales: the swarm is small, the boss hardware is large, and the
// runner's spawn pop animates the outer wrapper so these stay intact.
const KIND_SCALE: Record<string, number> = {
  interceptor: 1.5,
  wasp: 1.4,
  turret: 1.5,
  escort: 1.3,
  shell: 1.35,
  generator: 1.15,
  core: 1.2,
};

export function createEnemyMesh(kind: string, letter?: string) {
  const built = buildEnemyMesh(kind, letter);
  const scale = KIND_SCALE[kind] ?? 1;
  let mesh = built;
  if (scale !== 1) {
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
    case 'wasp':
      return createWaspMesh();
    case 'turret':
      return createTurretMesh();
    case 'escort':
      return createEscortMesh();
    case 'shell':
      return createShellMesh();
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
  mesh.userData.deniedUntil = elapsedNow + 0.5;
  spawnRing(mesh.position, DENY_EDGE.clone(), 3.0, 0.32);
}

export function createProjectileMesh() {
  const mesh = createPlayerProjectile();
  projectileRecords.enqueue({ mesh });
  return mesh;
}

// ---- reticle ---------------------------------------------------------------------
// A naval gunnery director: two outboard brackets that frame the target rather
// than ring it, and a rank of six charge bars beneath — one per gun in the
// broadside. Cold cyan is yours; the bars run to gold as the battery fills.

export function createReticle() {
  const group = new Group();
  const parts: Array<{ material: MeshBasicMaterial; base: Color }> = [];
  const addPart = (mesh: Mesh, base: Color) => {
    const material = configureAdditiveMaterial(mesh.material as MeshBasicMaterial, { color: base, side: DoubleSide });
    parts.push({ material, base });
    return mesh;
  };

  const brackets = new Group();
  for (const side of [-1, 1]) {
    const arc = new Mesh(
      new RingGeometry(0.62, 0.68, 24, 1, side > 0 ? -0.7 : Math.PI - 0.7, 1.4),
      new MeshBasicMaterial(),
    );
    brackets.add(addPart(arc, hdr(ALLY_CYAN, 1.2)));
    const spur = new Mesh(new PlaneGeometry(0.26, 0.04), new MeshBasicMaterial());
    spur.position.set(side * 0.86, 0, 0);
    brackets.add(addPart(spur, hdr(WHITE_HOT, 1.0)));
  }
  group.add(brackets);

  const bars = new Group();
  const barMaterials: MeshBasicMaterial[] = [];
  for (let i = 0; i < MAX_LOCKS; i += 1) {
    const bar = new Mesh(new PlaneGeometry(0.12, 0.07), new MeshBasicMaterial());
    bar.position.set((i - (MAX_LOCKS - 1) / 2) * 0.17, -0.84, 0);
    const material = configureAdditiveMaterial(bar.material as MeshBasicMaterial, {
      color: hdr(ALLY_CYAN, 0.5),
      side: DoubleSide,
      opacity: 0.28,
    });
    barMaterials.push(material);
    bars.add(bar);
  }
  group.add(bars);

  const pip = new Mesh(new CircleGeometry(0.04, 12), new MeshBasicMaterial());
  group.add(addPart(pip, hdr(WHITE_HOT, 2.0)));

  group.userData.parts = parts;
  group.userData.bars = barMaterials;
  group.userData.brackets = brackets;
  group.userData.active = false;
  return group;
}

export function setReticleActive(reticle: Object3D, active: boolean, lockCount: number) {
  reticle.userData.active = active;
  reticle.scale.setScalar(1 + lockCount * 0.055 + (active ? 0.05 : 0));

  const charge = lockCount === 0 ? null : colorForLockCount(lockCount, LOCK_GRADIENT);
  for (const part of reticle.userData.parts as Array<{ material: MeshBasicMaterial; base: Color }>) {
    if (charge) part.material.color.copy(hdr(charge, active ? 1.7 : 1.3));
    else part.material.color.copy(part.base).multiplyScalar(active ? 1.35 : 1);
  }

  // The battery gauge: one bar per lock, filling left to right.
  for (const [index, material] of (reticle.userData.bars as MeshBasicMaterial[]).entries()) {
    const filled = index < lockCount;
    material.color.copy(filled ? hdr(colorForLockCount(index + 1, LOCK_GRADIENT), 2.0) : hdr(ALLY_CYAN, 0.5));
    material.opacity = filled ? 1 : 0.26;
  }
}

// ---- event choreography ------------------------------------------------------------

export function installVisualEventHandlers(bus: EventBus, scene: Scene, cameraFeel: CameraFeelRig) {
  bus.on('spawn', ({ enemyId, kind, worldPosition }) => {
    const record = enemyRecords.claim(enemyId);
    if (!record) return;
    if (kind === 'generator') {
      // An emitter coming online announces itself with its own shield ring.
      spawnRing(worldPosition, hdr(NEBULA_MAGENTA, 1.4), 9, 0.55);
    } else if (kind === 'core') {
      spawnRing(worldPosition, hdr(FOE_MOLTEN, 1.1), 7, 0.5);
    } else if (kind === 'escort') {
      spawnGlint(worldPosition, hdr(FOE_MOLTEN, 1.2), 2.2, 0.28);
    } else if (kind !== 'shell') {
      spawnGlint(worldPosition, hdr(FOE_MOLTEN, 0.7), 1.2, 0.2, 0.7);
    }
  });

  bus.on('runstart', () => {
    resetEffects();
    enemyRecords.clear({ dispose: true, pending: true });
    projectileRecords.clear({ pending: true });
    resetCameraFeel(cameraFeel);
    flashUniform.value = 0;
    damageUniform.value = 0;
    nebulaUniform.value = 0;
    alarmUniform.value = 0;
    beatEnergy = 0;
    surge = 0;
    pullOut = 0;
    hitsTaken = 0;
    damagePulse = 0;
    alarmPulse = 0;
  });

  bus.on('runend', () => {
    resetCameraFeel(cameraFeel);
  });

  bus.on('lock', ({ enemyId, worldPosition, lockCount }) => {
    const color = colorForLockCount(lockCount, LOCK_GRADIENT);
    const record = enemyRecords.get(enemyId);
    if (record && !record.lockBracket) lockBrackets.attach(record, makeLockBracket(color), scene);
    spawnRing(worldPosition, hdr(color, 1.4), 2.2, 0.24);
  });

  bus.on('unlock', ({ enemyId, worldPosition }) => {
    const record = enemyRecords.get(enemyId);
    if (record) lockBrackets.detach(record);
    spawnGlint(worldPosition, hdr(ALLY_CYAN, 0.8), 0.9, 0.14, 0.6);
  });

  bus.on('fire', ({ projectileId, worldPosition, volleySize }) => {
    projectileRecords.claim(projectileId);
    spawnGlint(worldPosition, hdr(ALLY_CYAN, 1.6), 0.7 + volleySize * 0.06, 0.12);
    if (volleySize >= 5) surge = Math.max(surge, 0.35);
  });

  bus.on('hit', ({ enemyId, projectileId, worldPosition, lethal }) => {
    projectileRecords.delete(projectileId);
    burstSparks(worldPosition, hdr(WHITE_HOT, 0.9), 5, 10, 0.35);
    const record = enemyRecords.get(enemyId);
    if (record && !lethal) {
      record.mesh.userData.damageFlashUntil = elapsedNow + 0.28;
      spawnGlint(worldPosition, hdr(ALLY_CYAN, 1.8), 1.1, 0.15);
    }
  });

  bus.on('stage', ({ enemyId, worldPosition }) => {
    const record = enemyRecords.get(enemyId);
    if (!record) return;
    if (record.mesh.userData.isCore) {
      // The casing comes off: the coupling underneath is now the target.
      breakCoreArmour(record.mesh);
      const specs = record.mesh.userData.shardSpecs as ShardSpec[] | undefined;
      if (specs) burstShards(worldPosition, specs.slice(0, 5), 14);
      burstSparks(worldPosition, hdr(FOE_MOLTEN, 1.1), 18, 16);
      spawnRing(worldPosition, hdr(NEBULA_GOLD, 1.5), 7, 0.5);
      cameraFeel.shake(0.5, CAMERA_SHAKE);
    } else {
      burstSparks(worldPosition, hdr(FOE_MOLTEN, 0.9), 10, 12);
      spawnRing(worldPosition, hdr(NEBULA_MAGENTA, 1.1), 4, 0.35);
    }
  });

  bus.on('kill', ({ enemyId, worldPosition }) => {
    const record = enemyRecords.get(enemyId);
    if (!record) return;
    const userData = record.mesh.userData;
    const specs = userData.shardSpecs as ShardSpec[] | undefined;
    if (specs) burstShards(worldPosition, specs);
    const accent = (userData.accent as Color | undefined) ?? FOE_MOLTEN;
    burstSparks(worldPosition, hdr(accent, 1.0), 9, 13);
    spawnRing(worldPosition, hdr(accent, 0.95), 4.4, 0.36);
    spawnGlint(worldPosition, hdr(WHITE_HOT, 1.6), 1.2, 0.16);

    if (userData.isGenerator) {
      // An emitter going up is a real event: the envelope flares where it used
      // to hold, and the frame shudders.
      cameraFeel.shake(0.95, CAMERA_SHAKE);
      surge = Math.max(surge, 0.5);
      alarmPulse = Math.max(alarmPulse, 0.8);
      flashUniform.value = Math.max(flashUniform.value, 0.28);
      spawnRing(worldPosition, hdr(NEBULA_MAGENTA, 1.6), 26, 0.85);
      spawnRing(worldPosition, hdr(WHITE_HOT, 1.1), 13, 0.55);
      spawnWreck(worldPosition, 2.0, FOE_HULL, NEBULA_MAGENTA, new Vector3(0, 6, -4));
    } else if (userData.isCore) {
      cameraFeel.shake(1.3, CAMERA_SHAKE);
      surge = Math.max(surge, 0.75);
      flashUniform.value = Math.max(flashUniform.value, 0.55);
      spawnRing(worldPosition, hdr(FOE_MOLTEN, 1.7), 40, 1.0);
      spawnRing(worldPosition, hdr(NEBULA_GOLD, 1.3), 22, 0.7);
      burstSparks(worldPosition, hdr(FOE_MOLTEN, 1.3), 40, 30, 0.9);
      spawnWreck(worldPosition, 3.2, FOE_HULL, NEBULA_GOLD, new Vector3(0, 4, -10));
    } else if (userData.kind === 'escort' || userData.kind === 'turret') {
      spawnWreck(worldPosition, 1.4, FOE_HULL, NEBULA_MAGENTA, new Vector3(0, -2, -6));
    }

    enemyRecords.delete(enemyId, { dispose: true });
  });

  bus.on('miss', ({ enemyId, worldPosition }) => {
    enemyRecords.delete(enemyId, { dispose: true });
    // A target that got past you is not an explosion; it is a cold flicker.
    burstSparks(worldPosition, FOE_HULL.clone().multiplyScalar(2.4), 3, 4, 0.3);
  });

  bus.on('reject', () => {
    alarmPulse = Math.max(alarmPulse, 0.55);
    surge = Math.max(surge, 0.18);
  });

  bus.on('volley', ({ size, kills }) => {
    if (kills < size) return;
    if (battle.broadsideVolley) {
      // The namesake landed: gold across the frame and a real kick.
      beatEnergy = Math.max(beatEnergy, 1.7);
      flashUniform.value = Math.max(flashUniform.value, 0.12 + size * 0.035);
      surge = Math.max(surge, 0.3 + size * 0.06);
      cameraFeel.shake(0.3 + size * 0.09, CAMERA_SHAKE);
    } else if (size >= 5) {
      beatEnergy = Math.max(beatEnergy, 1.4);
      flashUniform.value = Math.max(flashUniform.value, 0.14);
    }
  });

  bus.on('beat', ({ isDownbeat }) => {
    beatEnergy = Math.max(beatEnergy, isDownbeat ? 1 : 0.42);
    if (isDownbeat) downbeats += 1;
  });

  bus.on('playerhit', () => {
    hitsTaken += 1;
    damagePulse = 1;
    beatEnergy = 1.5;
    cameraFeel.shake(1.4, CAMERA_SHAKE);
  });

  bus.on('bossphase', ({ phase }) => {
    if (phase === 'exposed') {
      // The shield envelope fails: one enormous magenta shell blowing outward.
      cameraFeel.shake(1.5, CAMERA_SHAKE);
      surge = 1.0;
      alarmPulse = 1.0;
      flashUniform.value = Math.max(flashUniform.value, 0.7);
    } else if (phase === 'destroyed') {
      cameraFeel.shake(1.8, CAMERA_SHAKE);
      surge = 1.0;
      flashUniform.value = Math.max(flashUniform.value, 1.0);
    }
  });
}

// ---- per-frame ---------------------------------------------------------------------

function resetCameraFeel(cameraFeel: CameraFeelRig) {
  cameraRoll = 0;
  cameraFov = 0;
  cameraFeel.restore();
}

export function updateVisuals(dt: number, ctx: VisualContext) {
  elapsedNow = ctx.elapsed;
  beatEnergy = Math.max(0, beatEnergy - dt * 4.0);
  surge = Math.max(0, surge - dt * 0.9);
  damagePulse = Math.max(0, damagePulse - dt * 1.5);
  alarmPulse = Math.max(0, alarmPulse - dt * 1.8);

  const runTime = ctx.running ? ctx.runTime : 0;
  const progress = ctx.running ? broadsideRunProgress(runTime) : 0;
  const speed = ctx.running ? speedFactorAt(runTime) : 0.5;

  environment?.update(dt, {
    camera: ctx.camera,
    elapsed: ctx.elapsed,
    runTime,
    running: ctx.running,
    progress,
    speed,
    beatEnergy,
    downbeats,
  });

  // Post grade. The nebula lift peaks twice: in the eye of the battle, where
  // the score drops away and the backdrop is the whole point, and again on the
  // victory pull-out.
  const eyeLift = ctx.running ? bump(runTime, EYE_TIME - 1.2, EYE_TIME + 1.6) : 0.55;
  const victoryLift = ctx.running && runTime > VICTORY_TIME - 1.5
    ? MathUtils.clamp((runTime - (VICTORY_TIME - 1.5)) / 2.2, 0, 1)
    : 0;
  nebulaUniform.value = Math.max(eyeLift * 0.85, victoryLift, 0.12);
  damageUniform.value = Math.min(1, damagePulse * 0.65 + Math.min(1, hitsTaken / BROADSIDE_PLAYER_HEALTH) * 0.08);
  alarmUniform.value = alarmPulse;
  flashUniform.value = Math.max(0, flashUniform.value - dt * (flashUniform.value > 0.7 ? 1.6 : 2.6));

  for (const [enemyId, record] of enemyRecords.entries()) {
    if (!record.mesh.parent) {
      enemyRecords.delete(enemyId, { dispose: true });
      continue;
    }
    if (record.bornAt === null) record.bornAt = elapsedNow;
    const age = elapsedNow - record.bornAt;
    record.mesh.scale.setScalar(easeOutBack(Math.min(1, age / 0.32)));

    updateEnemyTint(record, ctx);
    updateEnemyDetail(record);

    if (record.lockBracket) {
      record.mesh.getWorldPosition(record.lockBracket.position);
      record.lockBracket.quaternion.copy(ctx.camera.quaternion);
      record.lockBracket.rotation.z += dt * 0.9;
      const pulse = 1 + Math.sin(elapsedNow * 10) * 0.05;
      const fit = (record.mesh.userData.lockRingScale as number | undefined) ?? 1;
      record.lockBracket.scale.setScalar(pulse * 2.0 * fit);
    }
  }

  for (const [projectileId, record] of projectileRecords.entries()) {
    if (!record.mesh.parent) {
      projectileRecords.delete(projectileId);
      continue;
    }
    dropTrail(record.mesh.position, hdr(ALLY_CYAN, 0.9), 1.3);
  }

  const brackets = findReticleBrackets(ctx.scene);
  if (brackets) {
    const active = brackets.parent?.userData.active === true;
    brackets.rotation.z += dt * (active ? 1.6 : 0.35);
  }

  updateEffects(dt, ctx.camera);
}

/** Per-kind mesh state that is not colour: domes, charge lamps, reactors, trails. */
function updateEnemyDetail(record: EnemyRecord) {
  const userData = record.mesh.userData;

  if (userData.isGenerator) {
    const dome = userData.dome as Mesh | undefined;
    const domeMaterial = userData.domeMaterial as MeshBasicMaterial | undefined;
    const exposed = userData.exposed === true;
    const charge = (userData.domeCharge as number | undefined) ?? 0;
    if (dome && domeMaterial) {
      dome.visible = !exposed;
      // The dome hardens and brightens as the battery under it charges, then
      // vanishes on the beat when it fires. That flicker is the tell.
      const flicker = charge > 0.82 ? 0.5 + 0.5 * Math.sin(elapsedNow * 44) : 1;
      domeMaterial.opacity = (0.24 + charge * 0.42) * flicker;
      domeMaterial.color.copy(NEBULA_MAGENTA).lerp(WHITE_HOT, charge * 0.45).multiplyScalar(1 + charge * 0.9);
      dome.scale.setScalar(1 + Math.sin(elapsedNow * 3 + charge) * 0.02);
    }
    const emitter = userData.emitter as Mesh | undefined;
    if (emitter) {
      emitter.rotation.y += 0.05;
      emitter.rotation.x += 0.03;
      (emitter.material as MeshBasicMaterial).color
        .copy(exposed ? FOE_CRIMSON : FOE_MOLTEN)
        .multiplyScalar(exposed ? 2.4 : 0.8 + charge * 1.6);
    }
  }

  if (userData.isCore) {
    const reactor = userData.reactor as Mesh | undefined;
    const exposed = userData.exposed === true;
    const pulse = (userData.pulse as number | undefined) ?? 0;
    if (reactor) {
      reactor.scale.setScalar(1 + pulse * 0.14);
      // Untouchable while the shield holds: the coupling runs cold. Once the
      // envelope is gone it is visibly overloading.
      (reactor.material as MeshBasicMaterial).color
        .copy(FOE_MOLTEN)
        .multiplyScalar(exposed ? 1.4 + pulse * 1.9 : 0.5);
    }
    if (userData.breached === true && Math.random() < 0.25) {
      burstSparks(record.mesh.position, hdr(FOE_MOLTEN, 1.0), 1, 5, 0.3);
    }
  }

  if (userData.kind === 'turret') {
    const material = userData.chargeMaterial as MeshBasicMaterial | undefined;
    const charge = (userData.charge as number | undefined) ?? 0;
    if (material && userData.locked !== true) {
      material.color.copy(FOE_CRIMSON).lerp(WHITE_HOT, charge * 0.65).multiplyScalar(0.6 + charge * 2.6);
    }
  }

  if (userData.isHostileShot) {
    dropTrail(record.mesh.position, userData.trailColor as Color, 1.1);
  }
}

function updateEnemyTint(record: EnemyRecord, ctx: VisualContext) {
  const userData = record.mesh.userData;
  const denied = ((userData.deniedUntil as number | undefined) ?? -Infinity) > elapsedNow;

  if (userData.isLetter) {
    if (denied) setLetterDenied(record.mesh, true);
    else if (userData.locked !== true) setLetterLocked(record.mesh, false);
    return;
  }

  const parts = userData.parts as TintPart[] | undefined;
  if (!parts) return;

  // Distance falloff keeps far additive stacks from turning into haze;
  // silhouette and rim carry the read at range.
  const distance = record.mesh.position.distanceTo(ctx.camera.position);
  const closeness = smoothstep(1 - clamp01((distance - 18) / (110 - 18)));
  const locked = userData.locked === true;
  const damageFlash = ((userData.damageFlashUntil as number | undefined) ?? -Infinity) > elapsedNow;

  for (const part of parts) {
    if (denied) {
      part.material.color.copy(part.kind === 'fill' ? DENY_FILL : DENY_EDGE);
      continue;
    }
    if (locked) {
      // Locked targets change side: your cyan claims them off the enemy's
      // orange, which is the clearest possible "this one is mine".
      if (part.kind === 'edge') part.material.color.copy(hdr(ALLY_CYAN, 1.8));
      else if (part.kind === 'fill') part.material.color.copy(ALLY_CYAN.clone().multiplyScalar(0.16));
      else part.material.color.copy(hdr(WHITE_HOT, 2.1));
      continue;
    }
    if (damageFlash) {
      part.material.color.copy(hdr(WHITE_HOT, part.kind === 'fill' ? 0.55 : 2.0));
      continue;
    }
    part.material.color.copy(part.base).multiplyScalar(0.5 + 0.5 * closeness);
  }
}

// ---- camera ---------------------------------------------------------------------------

export function updateCameraEffects(dt: number, ctx: CameraEffectsContext) {
  const camera = ctx.camera;
  const runTime = ctx.running ? ctx.runTime : 0;
  const speed = ctx.running ? speedFactorAt(runTime) : 0.5;

  // FOV tracks speed, kicks on the beat, and opens hard for the pull-out.
  const targetFov = (speed - 1.1) * 8.5 + beatEnergy * 1.2 + surge * 7.5 + pullOut * 21;
  cameraFov = MathUtils.lerp(cameraFov, targetFov, Math.min(1, dt * 6));

  if (ctx.running) {
    // Bank into the rail's own curvature. The crossfire act is authored as
    // opposed banks, so that is where most of the level's roll comes from.
    const u = broadsideRunProgress(runTime, BROADSIDE_DURATION);
    const tangent = BROADSIDE_RAIL.getTangentAt(MathUtils.clamp(u, 0, 1));
    const ahead = BROADSIDE_RAIL.getTangentAt(MathUtils.clamp(u + 0.007, 0, 1));
    const targetRoll = MathUtils.clamp((ahead.x - tangent.x) * 22, -0.3, 0.3);
    cameraRoll += (targetRoll - cameraRoll) * Math.min(1, dt * 3.4);
    camera.rotateZ(cameraRoll);

    // The pull-out. When the last coupling blows, the camera stops being a
    // cockpit and becomes a camera: it rises out of the trench, drifts back,
    // and tips down so the breaking flagship and both fleets fill the frame.
    const want = battle.flagshipKilled ? 1 : (runTime > VICTORY_TIME + 0.9 ? 0.35 : 0);
    pullOut += (want - pullOut) * Math.min(1, dt * 1.15);
    if (pullOut > 0.001) {
      const eased = pullOut * pullOut * (3 - 2 * pullOut);
      const forward = camera.getWorldDirection(new Vector3());
      camera.position
        .addScaledVector(forward, -78 * eased)
        .addScaledVector(WORLD_UP, 138 * eased);
      camera.rotateX(-0.52 * eased);
    }
  } else {
    pullOut = 0;
  }

  ctx.feel.setFovOffset(cameraFov);
  ctx.feel.update(dt, { shake: CAMERA_SHAKE });
}

/** Attract mode: a slow crane along your own flagship's bow catapult. */
export function updateAttractCamera(camera: PerspectiveCamera, modeTime: number) {
  const base = BROADSIDE_RAIL.getPointAt(0);
  camera.position.copy(base).add(new Vector3(
    Math.sin(modeTime * 0.32) * 5.5,
    2.4 + Math.cos(modeTime * 0.24) * 2.2,
    Math.sin(modeTime * 0.19) * 3.5,
  ));
  camera.lookAt(BROADSIDE_RAIL.getPointAt(0.028).add(new Vector3(
    Math.sin(modeTime * 0.27 + 1.1) * 4.5,
    Math.cos(modeTime * 0.21) * 2.6,
    0,
  )));
}

// ---- small helpers -----------------------------------------------------------------

const WORLD_UP = new Vector3(0, 1, 0);

function makeLockBracket(color: Color): Group {
  const group = new Group();
  // Two outboard arcs, matching the reticle: the director handing the target
  // over to the guns.
  for (const geometry of BRACKET_ARC_GEOMETRY) {
    group.add(new Mesh(geometry, createAdditiveBasicMaterial({ color: hdr(color, 1.9), side: DoubleSide })));
  }
  const tick = new Mesh(
    BRACKET_TICK_GEOMETRY,
    createAdditiveBasicMaterial({ color: hdr(color.clone().lerp(WHITE_HOT, 0.4), 1.5), side: DoubleSide }),
  );
  tick.position.y = 0.9;
  group.add(tick);
  return group;
}

function findReticleBrackets(scene: Scene): Group | null {
  for (const child of scene.children) {
    if (child.userData.brackets) return child.userData.brackets as Group;
  }
  return null;
}

function bump(value: number, from: number, to: number) {
  if (value <= from || value >= to) return 0;
  return Math.sin(((value - from) / (to - from)) * Math.PI);
}

function easeOutBack(t: number): number {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function smoothstep(t: number): number {
  return t * t * (3 - 2 * t);
}
