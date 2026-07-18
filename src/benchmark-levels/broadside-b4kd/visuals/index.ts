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
import { broadsideRunProgress, createBroadsideRail, speedFactorAt } from '../gameplay';
import { BROADSIDE_MARKERS } from '../timing';
import {
  breakTurretArmor,
  createBoltMesh,
  createCoreMesh,
  createDartMesh,
  createPlayerShotMesh,
  createRaptorMesh,
  createShieldGeneratorMesh,
  createSkiffMesh,
  createTurretMesh,
  openCoreCage,
  type TintPart,
} from './ships';
import {
  beatUniform,
  createEnvironmentInternal,
  shieldUniform,
  streakGlowUniform,
  streakOffsetUniform,
  type Environment,
} from './environment';
import {
  burstSparks,
  burstWreck,
  createEffects,
  dropTrail,
  resetEffects,
  spawnBeam,
  spawnGlint,
  spawnRing,
  updateEffects,
  type WreckSpec,
} from './effects';
import { createLetterMesh, setLetterDenied, setLetterLocked } from './letters';
import { CYAN, hdr, ICE, LOCK_GRADIENT, MOLTEN, NEBULA_GOLD, NEBULA_MAGENTA } from './palette';
import { flashUniform, victoryUniform } from './post-fx';

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

const DENY_RED = new Color(1.6, 0.1, 0.08);
const DENY_FILL = new Color(0.3, 0.02, 0.02);

let environment: Environment | null = null;
let beatEnergy = 0;
let cameraRoll = 0;
let cameraFovOffset = 0;
let surgePulse = 0;
let elapsedNow = 0;
let lastRunTime = -1;
let salvoQueued = false;
let salvoIndex = 0;
let shieldTarget = 1;
let victoryAt = -1;
let nextBurnAt = -1;

const BROADSIDE_CAMERA_SHAKE: CameraFeelShakeOptions = {
  decay: 2.7,
  maxTrauma: 1.8,
  pitchDegrees: 0.34,
  yawDegrees: 0.3,
  rollDegrees: 0.72,
  frequency: 8.8,
  smoothing: 20,
};

const rail = createBroadsideRail();

const lockRings = createAdornmentSlot<EnemyRecord, Group>({
  get: (record) => record.lockRing,
  set: (record, ring) => {
    record.lockRing = ring;
  },
});

// createEnemyMesh() has no id, but the game emits `spawn` synchronously right
// after calling it — pairing the queue with spawn events links mesh to id.
// The runner removes meshes from the scene but leaves disposal to the level;
// at this level's spawn density the GPU resources must actually be freed.
const enemyRecords = createPendingVisualRecords<Group, EnemyRecord>({
  createRecord: (mesh) => ({ mesh, bornAt: null, lockRing: null }),
  disposeRecord: (record) => {
    lockRings.detach(record);
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
      return createLetterMesh(letter ?? 'I');
    case 'dart':
      return createDartMesh();
    case 'skiff':
      return createSkiffMesh();
    case 'raptor':
      return createRaptorMesh();
    case 'turret':
      return createTurretMesh();
    case 'shieldgen':
      return createShieldGeneratorMesh();
    case 'core':
      return createCoreMesh();
    case 'bolt':
      return createBoltMesh();
    default:
      return createSkiffMesh();
  }
}

export function setEnemyLocked(mesh: Object3D, locked: boolean) {
  mesh.userData.locked = locked;
  if (mesh.userData.isLetter) {
    setLetterLocked(mesh as Group, locked);
  }
}

export function setEnemyDenied(mesh: Object3D) {
  mesh.userData.deniedUntil = elapsedNow + 0.5;
  spawnRing(mesh.position, DENY_RED.clone(), 2.6, 0.3);
}

// Player shot: a sliver of your own fleet's light.
export function createProjectileMesh() {
  const group = createPlayerShotMesh();
  projectileRecords.enqueue({ mesh: group, trailColor: CYAN.clone().multiplyScalar(0.9) });
  return group;
}

// ---- reticle ------------------------------------------------------------------

// A naval gunsight: outer range ring, four corner brackets that tighten as
// locks accumulate, a spinning inner triangle, and the cold center pip.
export function createReticle() {
  const group = new Group();
  const parts: Array<{ material: MeshBasicMaterial; base: Color }> = [];

  const addPart = (mesh: Mesh, base: Color) => {
    const material = configureAdditiveMaterial(mesh.material as MeshBasicMaterial, { color: base, side: DoubleSide });
    parts.push({ material, base });
  };

  const outer = new Mesh(new RingGeometry(0.64, 0.672, 48), new MeshBasicMaterial());
  addPart(outer, hdr(CYAN, 1.15));

  const spinner = new Group();
  const triangle = new Mesh(new RingGeometry(0.36, 0.395, 3), new MeshBasicMaterial());
  addPart(triangle, hdr(ICE, 1.0));
  spinner.add(triangle);

  const brackets = new Group();
  for (let i = 0; i < 4; i += 1) {
    const angle = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const corner = new Group();
    for (const tilt of [0, Math.PI / 2]) {
      const tick = new Mesh(new PlaneGeometry(0.2, 0.035), new MeshBasicMaterial());
      addPart(tick, hdr(CYAN, 1.35));
      tick.position.x = 0.09;
      tick.rotation.z = tilt;
      const arm = new Group();
      arm.add(tick);
      arm.rotation.z = angle;
      corner.add(arm);
    }
    corner.position.set(Math.cos(angle) * 0.82, Math.sin(angle) * 0.82, 0);
    brackets.add(corner);
  }

  const dot = new Mesh(new CircleGeometry(0.05, 18), new MeshBasicMaterial());
  addPart(dot, hdr(ICE, 2.1));

  group.add(outer, spinner, brackets, dot);
  group.userData.parts = parts;
  group.userData.spinner = spinner;
  group.userData.brackets = brackets;
  group.userData.active = false;
  return group;
}

export function setReticleActive(reticle: Object3D, active: boolean, lockCount: number) {
  reticle.userData.active = active;
  reticle.scale.setScalar(1 + lockCount * 0.07 + (active ? 0.05 : 0));
  const brackets = reticle.userData.brackets as Group;
  // The brackets tighten as locks accumulate — six locks reads as "guns run out".
  const tighten = 1 - Math.min(6, lockCount) * 0.055;
  brackets.scale.setScalar(tighten);
  const parts = reticle.userData.parts as Array<{ material: MeshBasicMaterial; base: Color }>;
  const charge = lockCount === 0 ? null : colorForLockCount(lockCount, LOCK_GRADIENT);
  for (const part of parts) {
    if (charge) part.material.color.copy(hdr(charge, active ? 1.7 : 1.3));
    else part.material.color.copy(part.base).multiplyScalar(active ? 1.35 : 1);
  }
}

// ---- event wiring ----------------------------------------------------------------

export function installVisualEventHandlers(bus: EventBus, scene: Scene, cameraFeel: CameraFeelRig) {
  bus.on('spawn', ({ enemyId, kind, worldPosition }) => {
    const record = enemyRecords.claim(enemyId);
    if (!record) return;
    if (kind === 'shieldgen') {
      spawnRing(worldPosition, hdr(NEBULA_MAGENTA, 1.2), 6, 0.55);
      cameraFeel.shake(0.35, BROADSIDE_CAMERA_SHAKE);
    } else if (kind === 'core') {
      spawnRing(worldPosition, hdr(NEBULA_GOLD, 1.2), 6, 0.55);
    } else if (kind === 'turret') {
      spawnRing(worldPosition, hdr(MOLTEN, 1.0), 4, 0.45);
    } else if (kind !== 'bolt') {
      spawnRing(worldPosition, hdr(MOLTEN, 0.75), 2.4, 0.35);
    }
  });

  bus.on('lock', ({ enemyId, worldPosition, lockCount }) => {
    const lockColor = colorForLockCount(lockCount, LOCK_GRADIENT);
    const record = enemyRecords.get(enemyId);
    if (record && !record.lockRing) {
      lockRings.attach(record, makeLockRing(lockColor), scene);
    }
    spawnRing(worldPosition, hdr(lockColor, 1.4), 2.2, 0.28);
  });

  bus.on('unlock', ({ enemyId }) => {
    const record = enemyRecords.get(enemyId);
    if (record) lockRings.detach(record);
  });

  bus.on('fire', ({ projectileId, worldPosition }) => {
    projectileRecords.claim(projectileId);
    spawnGlint(worldPosition, hdr(ICE, 1.2), 0.5, 0.12);
  });

  bus.on('hit', ({ enemyId, projectileId, worldPosition, lethal }) => {
    projectileRecords.delete(projectileId, { dispose: true });
    burstSparks(worldPosition, hdr(ICE, 0.9), 5, 10);
    const record = enemyRecords.get(enemyId);
    if (record && !lethal) {
      record.mesh.userData.damageFlashUntil = elapsedNow + 0.35;
      spawnGlint(worldPosition, hdr(ICE, 1.8), 1.1, 0.16);
    }
  });

  bus.on('stage', ({ enemyId, worldPosition }) => {
    const record = enemyRecords.get(enemyId);
    if (!record) return;
    if (record.mesh.userData.kind === 'turret') {
      breakTurretArmor(record.mesh);
      const specs = record.mesh.userData.shardSpecs as WreckSpec[] | undefined;
      if (specs) burstWreck(worldPosition, specs.slice(0, 6));
      burstSparks(worldPosition, hdr(MOLTEN, 1.1), 14, 14);
      spawnRing(worldPosition, hdr(MOLTEN, 1.4), 6.5, 0.5);
      cameraFeel.shake(0.5, BROADSIDE_CAMERA_SHAKE);
    }
  });

  bus.on('kill', ({ enemyId, worldPosition }) => {
    const record = enemyRecords.get(enemyId);
    if (record) {
      const specs = record.mesh.userData.shardSpecs as WreckSpec[] | undefined;
      if (specs) burstWreck(worldPosition, specs);
      const accent = (record.mesh.userData.accent as Color | undefined) ?? MOLTEN;
      burstSparks(worldPosition, hdr(accent, 1.0), 8, 13);
      spawnRing(worldPosition, hdr(accent, 0.9), 4.6, 0.42);
      spawnGlint(worldPosition, hdr(ICE, 1.6), 1.2, 0.18);

      const kind = record.mesh.userData.kind as string;
      if (kind === 'shieldgen') {
        cameraFeel.shake(0.7, BROADSIDE_CAMERA_SHAKE);
        surgePulse = Math.max(surgePulse, 0.45);
        spawnRing(worldPosition, hdr(NEBULA_MAGENTA, 1.4), 11, 0.6);
        flashUniform.value = Math.max(flashUniform.value, 0.18);
      } else if (kind === 'core') {
        cameraFeel.shake(1.0, BROADSIDE_CAMERA_SHAKE);
        surgePulse = Math.max(surgePulse, 0.6);
        spawnRing(worldPosition, hdr(NEBULA_GOLD, 1.5), 14, 0.7);
        spawnRing(worldPosition, hdr(MOLTEN, 1.2), 8, 0.55);
        flashUniform.value = Math.max(flashUniform.value, 0.3);
      } else if (kind === 'turret') {
        cameraFeel.shake(0.5, BROADSIDE_CAMERA_SHAKE);
        spawnRing(worldPosition, hdr(MOLTEN, 1.3), 8, 0.5);
      }

      enemyRecords.delete(enemyId, { dispose: true });
    }
  });

  bus.on('miss', ({ enemyId, worldPosition }) => {
    const record = enemyRecords.get(enemyId);
    if (record) {
      enemyRecords.delete(enemyId, { dispose: true });
    }
    burstSparks(worldPosition, MOLTEN.clone().multiplyScalar(0.4), 3, 3);
  });

  bus.on('volley', ({ size, kills }) => {
    if (size >= 5 && kills === size) {
      beatEnergy = Math.max(beatEnergy, 1.5);
      flashUniform.value = Math.max(flashUniform.value, 0.2);
    }
  });

  bus.on('beat', ({ isDownbeat }) => {
    beatEnergy = Math.max(beatEnergy, isDownbeat ? 1 : 0.45);
    // During the broadside run the cruiser's guns answer the downbeats.
    if (isDownbeat && lastRunTime >= BROADSIDE_MARKERS.broadside && lastRunTime < BROADSIDE_MARKERS.eye) {
      salvoQueued = true;
    }
  });

  bus.on('playerhit', () => {
    beatEnergy = 1.5;
    flashUniform.value = Math.max(flashUniform.value, 0.35);
    cameraFeel.shake(1.3, BROADSIDE_CAMERA_SHAKE);
  });

  bus.on('bossphase', ({ phase }) => {
    if (!environment) return;
    if (phase === 'summoned') {
      cameraFeel.shake(0.5, BROADSIDE_CAMERA_SHAKE);
      spawnRing(environment.flagshipCenter, hdr(NEBULA_MAGENTA, 1.1), 60, 1.0);
      return;
    }
    if (phase === 'exposed') {
      // The shield lets go: one white-magenta crack across the sky.
      shieldTarget = 0;
      flashUniform.value = Math.max(flashUniform.value, 0.55);
      surgePulse = Math.max(surgePulse, 0.9);
      cameraFeel.shake(1.1, BROADSIDE_CAMERA_SHAKE);
      spawnRing(environment.flagshipCenter, hdr(NEBULA_MAGENTA, 1.5), 90, 1.3);
      spawnRing(environment.flagshipCenter, hdr(ICE, 1.1), 50, 0.9);
      // Discharge arcs run along the hull, away from the rail, so the
      // collapse reads on the ship instead of whiting out the camera.
      for (let i = 0; i < 5; i += 1) {
        const offset = new Vector3(
          -20 - Math.random() * 90,
          (Math.random() - 0.5) * 70,
          (Math.random() - 0.5) * 300,
        );
        spawnBeam(environment.flagshipCenter.clone(), environment.flagshipCenter.clone().add(offset), hdr(NEBULA_MAGENTA, 0.8), 0.35, 0.5);
      }
      return;
    }
    // Destroyed: the run's payoff. The frame washes gold and the flagship
    // starts coming apart behind the player all the way to the summary.
    victoryAt = elapsedNow;
    nextBurnAt = elapsedNow;
    flashUniform.value = Math.max(flashUniform.value, 1.1);
    surgePulse = 1.0;
    cameraFeel.shake(1.7, BROADSIDE_CAMERA_SHAKE);
    spawnRing(environment.flagshipCenter, hdr(NEBULA_GOLD, 1.5), 120, 1.6);
    spawnRing(environment.flagshipCenter, hdr(MOLTEN, 1.2), 70, 1.2);
    spawnGlint(environment.flagshipCenter, hdr(ICE, 2.2), 9, 0.5);
  });

  bus.on('runstart', () => {
    resetEffects();
    enemyRecords.clear({ dispose: true, pending: true });
    projectileRecords.clear({ dispose: true, pending: true });
    resetCameraFeel(cameraFeel);
    flashUniform.value = 0;
    victoryUniform.value = 0;
    beatEnergy = 0;
    surgePulse = 0;
    salvoQueued = false;
    salvoIndex = 0;
    shieldTarget = 1;
    shieldUniform.value = 1;
    victoryAt = -1;
    nextBurnAt = -1;
    if (environment) environment.shieldMesh.visible = true;
  });

  bus.on('runend', () => {
    resetCameraFeel(cameraFeel);
  });
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
  surgePulse = Math.max(0, surgePulse - dt * 0.85);
  beatUniform.value = beatEnergy;

  const runTime = ctx.running ? ctx.runTime : 0;
  const speed = ctx.running ? speedFactorAt(runTime) : 0.5;
  lastRunTime = ctx.running ? ctx.runTime : -1;

  updateEnvironmentFrame(dt, ctx, speed, runTime);
  updatePostUniforms(dt);

  for (const [enemyId, record] of enemyRecords.entries()) {
    if (!record.mesh.parent) {
      enemyRecords.delete(enemyId, { dispose: true });
      continue;
    }
    if (record.bornAt === null) record.bornAt = elapsedNow;
    const age = elapsedNow - record.bornAt;
    record.mesh.scale.setScalar(easeOutBack(Math.min(1, age / 0.4)));

    updateEnemyTint(record, ctx);

    if (record.mesh.userData.kind === 'core' && record.mesh.userData.caged === false) {
      openCoreCage(record.mesh);
    }

    if (record.mesh.userData.isHostileShot) {
      dropTrail(record.mesh.position, record.mesh.userData.trailColor as Color);
    }

    if (record.lockRing) {
      record.mesh.getWorldPosition(record.lockRing.position);
      record.lockRing.quaternion.copy((ctx.camera as PerspectiveCamera).quaternion);
      record.lockRing.rotation.z += dt * 2.4;
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

  const reticleSpinner = findReticleSpinner(ctx.scene);
  if (reticleSpinner) {
    const active = reticleSpinner.parent?.userData.active === true;
    reticleSpinner.rotation.z += dt * (active ? 4.6 : 1.2);
  }

  updateEffects(dt, ctx.camera);
}

export function updateCameraEffects(dt: number, ctx: CameraEffectsContext) {
  const runTime = ctx.running ? ctx.runTime : 0;
  const speed = ctx.running ? speedFactorAt(runTime) : 0.5;
  if (!(ctx.camera instanceof PerspectiveCamera)) return;
  const camera = ctx.camera;

  // FOV breathes with airspeed and kicks on the surge moments (catapult,
  // broadside surge, trench dive) — the same profile the rail runs on.
  const targetFovOffset = (speed - 0.9) * 8.5 + beatEnergy * 1.0 + surgePulse * 6.5;
  cameraFovOffset = MathUtils.lerp(cameraFovOffset, targetFovOffset, Math.min(1, dt * 6));

  if (ctx.running) {
    // Bank into the rail's turns — the hard-bank read of flying the gaps.
    const u = broadsideRunProgress(ctx.runTime);
    const tangent = rail.getTangentAt(MathUtils.clamp(u, 0, 1));
    const ahead = rail.getTangentAt(MathUtils.clamp(u + 0.006, 0, 1));
    const targetRoll = MathUtils.clamp((ahead.x - tangent.x) * 34, -0.2, 0.2);
    cameraRoll += (targetRoll - cameraRoll) * Math.min(1, dt * 3.2);
    camera.rotateZ(cameraRoll);
  }

  ctx.feel.setFovOffset(cameraFovOffset);
  ctx.feel.update(dt, { shake: BROADSIDE_CAMERA_SHAKE });
}

function updateEnvironmentFrame(dt: number, ctx: VisualContext, speed: number, runTime: number) {
  if (!environment) return;

  // The sky shell and speed streaks ride the camera.
  environment.sky.position.copy((ctx.camera as PerspectiveCamera).position);
  // Speed streaks ride the camera; scroll rate is the felt airspeed.
  environment.streaks.position.copy((ctx.camera as PerspectiveCamera).position);
  environment.streaks.quaternion.copy((ctx.camera as PerspectiveCamera).quaternion);
  streakOffsetUniform.value = (streakOffsetUniform.value + dt * speed * 27) % 10000;

  const act = !ctx.running
    ? -1
    : runTime < BROADSIDE_MARKERS.broadside ? 0
    : runTime < BROADSIDE_MARKERS.eye ? 1
    : runTime < BROADSIDE_MARKERS.belly ? 2
    : runTime < BROADSIDE_MARKERS.trench ? 3
    : 4;
  const glowTarget = act === -1 ? 0.12 : act === 0 ? 0.35 : act === 1 ? 0.8 : act === 2 ? 0.15 : act === 3 ? 0.5 : 0.95;
  streakGlowUniform.value += (glowTarget - streakGlowUniform.value) * Math.min(1, dt * 2);

  // The cruiser's broadside: on queued downbeats, one turret fires a beam
  // over the player's head toward the enemy line.
  if (salvoQueued && ctx.running) {
    salvoQueued = false;
    const gun = environment.cruiserGuns[salvoIndex % environment.cruiserGuns.length];
    salvoIndex += 1;
    const target = gun.clone().addScaledVector(environment.cruiserFireDirection, 500);
    spawnBeam(gun, target, hdr(CYAN, 1.3), 1.5, 0.5);
    spawnBeam(gun, target, hdr(ICE, 0.7), 3.2, 0.3);
    spawnGlint(gun, hdr(CYAN, 2.0), 4, 0.3);
    beatEnergy = Math.max(beatEnergy, 1.3);
    ctx.feel.shake(0.28, BROADSIDE_CAMERA_SHAKE);
  }

  // Shield envelope follows the boss state.
  shieldUniform.value += (shieldTarget - shieldUniform.value) * Math.min(1, dt * 2.8);
  if (shieldUniform.value < 0.02 && environment.shieldMesh.visible) environment.shieldMesh.visible = false;

  // After the kill the flagship burns: rolling detonations down its length.
  if (victoryAt >= 0 && elapsedNow >= nextBurnAt) {
    nextBurnAt = elapsedNow + 0.22 + Math.random() * 0.3;
    const burnPoint = environment.flagshipCenter.clone().add(new Vector3(
      (Math.random() - 0.5) * 40,
      (Math.random() - 0.5) * 24,
      (Math.random() - 0.5) * 300,
    ));
    burstSparks(burnPoint, hdr(Math.random() < 0.6 ? MOLTEN : NEBULA_GOLD, 1.1), 10, 16);
    spawnRing(burnPoint, hdr(MOLTEN, 1.0), 10 + Math.random() * 10, 0.6);
  }
}

function updatePostUniforms(dt: number) {
  flashUniform.value = Math.max(0, flashUniform.value - dt * (flashUniform.value > 0.8 ? 1.4 : 2.4));
  if (victoryAt >= 0) {
    const since = elapsedNow - victoryAt;
    victoryUniform.value = MathUtils.clamp(since / 3.6, 0, 1) * 0.75;
  } else {
    victoryUniform.value = Math.max(0, victoryUniform.value - dt * 1.5);
  }
}

function updateEnemyTint(record: EnemyRecord, ctx: VisualContext) {
  const userData = record.mesh.userData;
  const denied = (userData.deniedUntil as number | undefined ?? -Infinity) > elapsedNow;

  if (userData.isLetter) {
    if (denied) setLetterDenied(record.mesh, true);
    else if (userData.locked !== true) setLetterLocked(record.mesh, false);
    return;
  }

  const parts = userData.parts as TintPart[] | undefined;
  if (!parts) return;

  // Distance falloff keeps far additive stacks from blobbing under bloom.
  const distance = record.mesh.position.distanceTo((ctx.camera as PerspectiveCamera).position);
  const closeness = smootherstep(1 - clamp01((distance - 16) / (56 - 16)));
  const locked = userData.locked === true;
  const damageFlash = (userData.damageFlashUntil as number | undefined ?? -Infinity) > elapsedNow;

  for (const part of parts) {
    if (denied) {
      part.material.color.copy(part.kind === 'fill' ? DENY_FILL : DENY_RED);
      continue;
    }
    if (locked) {
      if (part.kind === 'edge') part.material.color.copy(hdr(ICE, 1.6));
      else if (part.kind === 'fill') part.material.color.copy(CYAN.clone().multiplyScalar(0.32));
      else part.material.color.copy(hdr(ICE, 2.0));
      continue;
    }
    if (damageFlash) {
      part.material.color.copy(hdr(ICE, part.kind === 'fill' ? 0.5 : 1.9));
      continue;
    }
    const dim = part.kind === 'edge' ? 0.55 + 0.45 * closeness : part.kind === 'fill' ? 0.3 + 0.7 * closeness : 0.35 + 0.65 * closeness;
    part.material.color.copy(part.base).multiplyScalar(dim);
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
  // A gunsight clamp: square outer frame, fine inner circle.
  const ring = new Mesh(
    new RingGeometry(0.86, 0.92, 4),
    createAdditiveBasicMaterial({ color: hdr(color, 1.8), side: DoubleSide }),
  );
  const innerRing = new Mesh(
    new RingGeometry(0.64, 0.67, 32),
    createAdditiveBasicMaterial({ color: hdr(color.clone().lerp(ICE, 0.55), 1.4), side: DoubleSide }),
  );
  group.add(ring, innerRing);
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
