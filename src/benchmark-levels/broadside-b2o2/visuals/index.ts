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
  TorusGeometry,
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
import { broadsideRunProgress, createBroadsideRail, SOVEREIGN, speedFactorAt } from '../gameplay';
import { SALVO_TIMES } from '../timing';
import {
  breakGunshipArmor,
  createBoltMesh,
  createCoreMesh,
  createDartMesh,
  createEscortMesh,
  createGeneratorMesh,
  createGunshipMesh,
  createMineMesh,
  createNodeMesh,
  createTurretMesh,
  createWeaverMesh,
  type TintPart,
} from './enemies';
import {
  burstShards,
  burstSparks,
  createEffects,
  dropTrail,
  resetEffects,
  spawnBloom,
  spawnFallingHulk,
  spawnGlint,
  spawnRing,
  updateEffects,
  type ShardSpec,
} from './effects';
import { beatUniform, createEnvironmentInternal, type Environment } from './environment';
import { createShieldDomeMesh, shieldFlickerUniform, shieldStrengthUniform } from './fleet';
import { createLetterMesh, setLetterDenied, setLetterLocked } from './letters';
import {
  CRIMSON_FIRE,
  CYAN_ENGINE,
  CYAN_FIRE,
  CYAN_WINDOW,
  LOCK_CYAN,
  LOCK_GOLD,
  LOCK_GRADIENT,
  MOLTEN_ORANGE,
  OBSIDIAN,
  PLAYER_WHITE,
  hdr,
} from './palette';
import { damageUniform, flashUniform, victoryUniform } from './post-fx';

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
  noScaleIn: boolean;
};

type ProjectileRecord = {
  mesh: Object3D;
  trailColor: Color;
};

const DENY_RED = new Color(1.5, 0.1, 0.08);
const DENY_FILL = new Color(0.3, 0.02, 0.02);

let environment: Environment | null = null;
let beatEnergy = 0;
let surgePulse = 0;
let cameraRoll = 0;
let cameraFovOffset = 0;
let elapsedNow = 0;
let hitsTaken = 0;
let damagePulse = 0;
let victoryPulse = 0;

const BROADSIDE_CAMERA_SHAKE: CameraFeelShakeOptions = {
  decay: 2.6,
  maxTrauma: 1.7,
  pitchDegrees: 0.36,
  yawDegrees: 0.3,
  rollDegrees: 0.7,
  frequency: 8.5,
  smoothing: 20,
};

const rail = createBroadsideRail();

const lockRings = createAdornmentSlot<EnemyRecord, Group>({
  get: (record) => record.lockRing,
  set: (record, ring) => {
    record.lockRing = ring;
  },
});

const enemyRecords = createPendingVisualRecords<Group, EnemyRecord>({
  createRecord: (mesh) => ({ mesh, bornAt: null, lockRing: null, noScaleIn: mesh.userData.noScaleIn === true }),
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

const KIND_SCALE: Record<string, number> = {
  dart: 1.3,
  weaver: 1.4,
  gunship: 1.7,
  mine: 1.6,
  turret: 2.3,
  escort: 1.4,
  bolt: 1.35,
  generator: 2.5,
  node: 2.3,
  core: 3.4,
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
  mesh.scale.setScalar(mesh.userData.noScaleIn === true ? 1 : 0.001);
  enemyRecords.enqueue(mesh);
  return mesh;
}

function buildEnemyMesh(kind: string, letter?: string): Group {
  switch (kind) {
    case 'letter':
      return createLetterMesh(letter ?? 'A');
    case 'dart':
      return createDartMesh();
    case 'weaver':
      return createWeaverMesh();
    case 'gunship':
      return createGunshipMesh();
    case 'mine':
      return createMineMesh();
    case 'turret':
      return createTurretMesh();
    case 'escort':
      return createEscortMesh();
    case 'bolt':
      return createBoltMesh();
    case 'generator':
      return createGeneratorMesh();
    case 'node':
      return createNodeMesh();
    case 'core':
      return createCoreMesh();
    case 'shieldDome': {
      const dome = createShieldDomeMesh();
      // The group's origin rides SOVEREIGN.domeAnchor (see updateDome); the
      // shell counter-offsets so the bubble still wraps the hull.
      dome.position.copy(SOVEREIGN.center).sub(SOVEREIGN.domeAnchor);
      const group = new Group();
      group.add(dome);
      group.userData.noScaleIn = true;
      return group;
    }
    default:
      return createDartMesh();
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
  spawnRing(mesh.position, DENY_RED.clone(), 2.4, 0.3);
}

// Player shot: a white-cyan interceptor round — the home fleet's colors.
export function createProjectileMesh() {
  const group = new Group();
  const coreGeometry = new OctahedronGeometry(0.3, 0);
  coreGeometry.scale(0.45, 0.45, 2.4);
  group.add(new Mesh(coreGeometry, new MeshBasicMaterial({ color: hdr(PLAYER_WHITE, 2.4) })));
  const shellGeometry = new OctahedronGeometry(0.5, 0);
  shellGeometry.scale(0.55, 0.55, 2.1);
  group.add(new Mesh(shellGeometry, createAdditiveBasicMaterial({ color: hdr(CYAN_FIRE, 1.0), opacity: 0.55 })));
  projectileRecords.enqueue({ mesh: group, trailColor: CYAN_WINDOW.clone().multiplyScalar(0.7) });
  return group;
}

// ---- reticle -------------------------------------------------------------------

export function createReticle() {
  const group = new Group();
  const parts: Array<{ material: MeshBasicMaterial; base: Color }> = [];

  const addPart = (mesh: Mesh, base: Color) => {
    const material = configureAdditiveMaterial(mesh.material as MeshBasicMaterial, { color: base, side: DoubleSide });
    parts.push({ material, base });
  };

  // A fleet gunsight: thin outer ring, four gun-laying ticks, and an inner
  // bracket square that spins up while tracking.
  const outer = new Mesh(new RingGeometry(0.62, 0.652, 48), new MeshBasicMaterial());
  addPart(outer, hdr(CYAN_WINDOW, 1.05));

  const square = new Group();
  const inner = new Mesh(new RingGeometry(0.34, 0.372, 4), new MeshBasicMaterial());
  inner.rotation.z = Math.PI / 4;
  addPart(inner, hdr(PLAYER_WHITE, 0.95));
  square.add(inner);

  const ticks = new Group();
  for (let i = 0; i < 4; i += 1) {
    const tick = new Mesh(new PlaneGeometry(0.22, 0.05), new MeshBasicMaterial());
    addPart(tick, hdr(LOCK_GOLD, 1.1));
    const angle = (i / 4) * Math.PI * 2;
    tick.position.set(Math.cos(angle) * 0.82, Math.sin(angle) * 0.82, 0);
    tick.rotation.z = angle;
    ticks.add(tick);
  }

  const dot = new Mesh(new CircleGeometry(0.045, 16), new MeshBasicMaterial());
  addPart(dot, hdr(PLAYER_WHITE, 1.9));

  group.add(outer, square, ticks, dot);
  group.userData.parts = parts;
  group.userData.spinner = square;
  group.userData.ticks = ticks;
  group.userData.active = false;
  return group;
}

export function setReticleActive(reticle: Object3D, active: boolean, lockCount: number) {
  reticle.userData.active = active;
  reticle.scale.setScalar(1 + lockCount * 0.07 + (active ? 0.05 : 0));
  const parts = reticle.userData.parts as Array<{ material: MeshBasicMaterial; base: Color }>;
  const charge = lockCount === 0 ? null : colorForLockCount(lockCount, LOCK_GRADIENT);
  for (const part of parts) {
    if (charge) part.material.color.copy(hdr(charge, active ? 1.6 : 1.25));
    else part.material.color.copy(part.base).multiplyScalar(active ? 1.3 : 1);
  }
}

// ---- event wiring ----------------------------------------------------------------

export function installVisualEventHandlers(bus: EventBus, scene: Scene, cameraFeel: CameraFeelRig) {
  bus.on('spawn', ({ enemyId, kind, worldPosition }) => {
    const record = enemyRecords.claim(enemyId);
    if (!record) return;
    if (kind === 'core') {
      spawnRing(worldPosition, hdr(MOLTEN_ORANGE, 1.2), 14, 0.8);
    } else if (kind === 'escort') {
      spawnRing(worldPosition, hdr(CRIMSON_FIRE, 1.1), 3.4, 0.45);
    } else if (kind === 'shieldDome') {
      shieldStrengthUniform.value = 1;
    } else if (kind !== 'bolt') {
      spawnRing(worldPosition, hdr(CYAN_WINDOW, 0.5), 2.2, 0.35);
    }
  });

  bus.on('lock', ({ enemyId, worldPosition, lockCount }) => {
    const lockColor = colorForLockCount(lockCount, LOCK_GRADIENT);
    const record = enemyRecords.get(enemyId);
    if (record && !record.lockRing) {
      lockRings.attach(record, makeLockBracket(lockColor), scene);
    }
    spawnRing(worldPosition, hdr(lockColor, 1.3), 2.0, 0.26);
  });

  bus.on('unlock', ({ enemyId }) => {
    const record = enemyRecords.get(enemyId);
    if (record) lockRings.detach(record);
  });

  bus.on('fire', ({ projectileId, worldPosition }) => {
    projectileRecords.claim(projectileId);
    spawnGlint(worldPosition, hdr(PLAYER_WHITE, 1.1), 0.5, 0.12);
  });

  bus.on('hit', ({ enemyId, projectileId, worldPosition, lethal }) => {
    projectileRecords.delete(projectileId, { dispose: true });
    burstSparks(worldPosition, hdr(PLAYER_WHITE, 0.85), 5, 10);
    const record = enemyRecords.get(enemyId);
    if (record && !lethal) {
      record.mesh.userData.damageFlashUntil = elapsedNow + 0.3;
      spawnGlint(worldPosition, hdr(CYAN_FIRE, 1.6), 1.0, 0.15);
    }
  });

  bus.on('stage', ({ enemyId, worldPosition }) => {
    const record = enemyRecords.get(enemyId);
    if (!record) return;
    if (record.mesh.userData.kind === 'gunship') {
      breakGunshipArmor(record.mesh as Group);
      const specs = record.mesh.userData.shardSpecs as ShardSpec[] | undefined;
      if (specs) burstShards(worldPosition, specs.slice(0, 4));
      burstSparks(worldPosition, hdr(MOLTEN_ORANGE, 1.0), 12, 13);
      spawnRing(worldPosition, hdr(MOLTEN_ORANGE, 1.3), 5.5, 0.45);
    }
  });

  bus.on('kill', ({ enemyId, worldPosition }) => {
    const record = enemyRecords.get(enemyId);
    if (!record) return;
    const kind = record.mesh.userData.kind as string | undefined;
    const specs = record.mesh.userData.shardSpecs as ShardSpec[] | undefined;
    if (specs) burstShards(worldPosition, specs);
    const accent = (record.mesh.userData.accent as Color | undefined) ?? CRIMSON_FIRE;
    burstSparks(worldPosition, hdr(accent, 0.95), 8, 12);
    spawnRing(worldPosition, hdr(accent, 0.85), 4.2, 0.4);
    spawnGlint(worldPosition, hdr(PLAYER_WHITE, 1.5), 1.1, 0.16);

    if (kind === 'core') {
      // The flagship's heart goes: the biggest thing the level can do.
      environment?.startFlagshipDeath();
      victoryPulse = 0.001; // starts the ramp
      flashUniform.value = Math.max(flashUniform.value, 0.85);
      spawnRing(worldPosition, hdr(MOLTEN_ORANGE, 1.5), 46, 1.3);
      spawnRing(worldPosition, hdr(PLAYER_WHITE, 1.3), 26, 1.0);
      spawnBloom(worldPosition, hdr(MOLTEN_ORANGE, 1.8), 34, 1.2);
      burstSparks(worldPosition, hdr(MOLTEN_ORANGE, 1.3), 46, 30);
      burstSparks(worldPosition, hdr(PLAYER_WHITE, 1.2), 24, 24);
    } else if (kind === 'generator') {
      shieldFlickerUniform.value = 1;
      spawnRing(worldPosition, hdr(MOLTEN_ORANGE, 1.2), 9, 0.6);
      spawnBloom(worldPosition, hdr(MOLTEN_ORANGE, 1.2), 9, 0.6);
    } else if (kind === 'node') {
      spawnBloom(worldPosition, hdr(MOLTEN_ORANGE, 1.3), 8, 0.55);
    } else if (kind === 'gunship') {
      spawnFallingHulk(worldPosition, 1.5, new Vector3(6, 1, -4));
    } else if (kind === 'turret') {
      spawnBloom(worldPosition, hdr(MOLTEN_ORANGE, 1.1), 5.5, 0.5);
    } else if (kind === 'mine') {
      spawnBloom(worldPosition, hdr(MOLTEN_ORANGE, 1.4), 8, 0.6);
    }

    enemyRecords.delete(enemyId, { dispose: true });
  });

  bus.on('miss', ({ enemyId, worldPosition }) => {
    const record = enemyRecords.get(enemyId);
    if (record) {
      // A mine that reaches the hull detonates where it died.
      if (record.mesh.userData.kind === 'mine') {
        spawnBloom(worldPosition, hdr(MOLTEN_ORANGE, 1.5), 10, 0.7);
        spawnRing(worldPosition, hdr(CRIMSON_FIRE, 1.2), 8, 0.5);
        burstSparks(worldPosition, hdr(MOLTEN_ORANGE, 1.1), 18, 16);
      }
      enemyRecords.delete(enemyId, { dispose: true });
    }
  });

  bus.on('volley', ({ size, kills }) => {
    if (size >= 5 && kills === size) {
      beatEnergy = Math.max(beatEnergy, 1.5);
      flashUniform.value = Math.max(flashUniform.value, 0.14);
    }
  });

  bus.on('beat', ({ isDownbeat }) => {
    beatEnergy = Math.max(beatEnergy, isDownbeat ? 1 : 0.45);
  });

  bus.on('playerhit', () => {
    hitsTaken += 1;
    damagePulse = 1;
    beatEnergy = 1.4;
    cameraFeel.shake(1.25, BROADSIDE_CAMERA_SHAKE);
    flashUniform.value = Math.max(flashUniform.value, 0.2);
  });

  bus.on('bossphase', ({ phase }) => {
    if (phase === 'exposed') {
      // The shield dome collapses: the flagship's skin goes naked.
      flashUniform.value = Math.max(flashUniform.value, 0.4);
      cameraFeel.shake(0.8, BROADSIDE_CAMERA_SHAKE);
      shieldFlickerUniform.value = 1.4;
      spawnRing(rail.getPointAt(broadsideRunProgress(45.5)), hdr(MOLTEN_ORANGE, 1.2), 60, 1.2);
    } else if (phase === 'destroyed') {
      cameraFeel.shake(1.7, BROADSIDE_CAMERA_SHAKE);
      flashUniform.value = Math.max(flashUniform.value, 0.6);
    }
  });

  bus.on('runstart', () => {
    resetEffects();
    enemyRecords.clear({ dispose: true, pending: true });
    projectileRecords.clear({ pending: true });
    environment?.resetRun();
    resetCameraFeel(cameraFeel);
    flashUniform.value = 0;
    damageUniform.value = 0;
    victoryUniform.value = 0;
    shieldStrengthUniform.value = 1;
    shieldFlickerUniform.value = 0;
    surgePulse = 0;
    victoryPulse = 0;
    hitsTaken = 0;
    damagePulse = 0;
  });

  bus.on('runend', () => {
    resetCameraFeel(cameraFeel);
  });
}

// ---- per-frame update ---------------------------------------------------------------

function resetCameraFeel(cameraFeel: CameraFeelRig) {
  cameraRoll = 0;
  cameraFovOffset = 0;
  cameraFeel.restore();
}

export function updateVisuals(dt: number, ctx: VisualContext) {
  elapsedNow = ctx.elapsed;
  beatEnergy = Math.max(0, beatEnergy - dt * 4.2);
  surgePulse = Math.max(0, surgePulse - dt * 0.9);
  damagePulse = Math.max(0, damagePulse - dt * 1.5);
  shieldFlickerUniform.value = Math.max(0, shieldFlickerUniform.value - dt * 1.8);
  beatUniform.value = beatEnergy;

  const runTime = ctx.running ? ctx.runTime : 0;
  const speed = ctx.running ? speedFactorAt(runTime) : 0.5;

  // Salvo proximity: the camera shake and FOV kick read the same authored
  // broadside beats the environment fires on.
  if (ctx.running) {
    for (const salvoTime of SALVO_TIMES) {
      const since = runTime - salvoTime;
      if (since >= 0 && since < 0.4) {
        surgePulse = Math.max(surgePulse, 0.8 * (1 - since / 0.4));
      }
    }
  }

  environment?.update(dt, {
    camera: ctx.camera as PerspectiveCamera,
    elapsed: ctx.elapsed,
    runTime,
    running: ctx.running,
    speed,
    beatEnergy,
  });

  // Post grade: damage presses red in from the edges; victory warms the pull-out.
  damageUniform.value = Math.min(1, damagePulse * 0.6 + Math.min(1, hitsTaken / 4) * 0.06);
  if (victoryPulse > 0) victoryPulse = Math.min(1, victoryPulse + dt * 0.4);
  victoryUniform.value = victoryPulse;
  flashUniform.value = Math.max(0, flashUniform.value - dt * (flashUniform.value > 0.7 ? 1.6 : 2.6));

  for (const [enemyId, record] of enemyRecords.entries()) {
    if (!record.mesh.parent) {
      enemyRecords.delete(enemyId, { dispose: true });
      continue;
    }
    if (record.bornAt === null) record.bornAt = elapsedNow;
    const age = elapsedNow - record.bornAt;
    if (!record.noScaleIn) record.mesh.scale.setScalar(easeOutBack(Math.min(1, age / 0.4)));

    const kind = record.mesh.userData.kind as string | undefined;
    if (kind === 'shieldDome') {
      const strength = (record.mesh.userData.shieldStrength as number | undefined) ?? 1;
      shieldStrengthUniform.value = MathUtils.lerp(shieldStrengthUniform.value, strength, Math.min(1, dt * 5));
    } else {
      updateEnemyTint(record, ctx);
    }

    // Gunship wind-up: the muzzle lamp climbs to white-hot before each bolt.
    if (kind === 'gunship') {
      const lamp = record.mesh.userData.chargeLamp as MeshBasicMaterial | undefined;
      const charge = (record.mesh.userData.charge as number | undefined) ?? 0;
      if (lamp && record.mesh.userData.locked !== true) {
        lamp.color.copy(CRIMSON_FIRE.clone().lerp(PLAYER_WHITE, charge * 0.7)).multiplyScalar(0.7 + charge * 2.4);
      }
    }

    // Mine heartbeat: the pulse the player reads across the wreck field.
    if (kind === 'mine') {
      const lamp = record.mesh.userData.heartLamp as MeshBasicMaterial | undefined;
      const pulse = (record.mesh.userData.pulse as number | undefined) ?? 0.5;
      if (lamp && record.mesh.userData.locked !== true) {
        lamp.color.copy(MOLTEN_ORANGE.clone().lerp(CRIMSON_FIRE, pulse)).multiplyScalar(0.8 + pulse * 1.8);
      }
    }

    // Generator emitter: the shield's heartbeat on the hull.
    if (kind === 'generator') {
      const ring = record.mesh.userData.emitterRing as MeshBasicMaterial | undefined;
      if (ring && record.mesh.userData.locked !== true) {
        ring.color.copy(hdr(MOLTEN_ORANGE, 1.0 + Math.sin(elapsedNow * 4.2) * 0.45));
      }
    }

    // Core: the cage breathes around the heart.
    if (kind === 'core') {
      const heart = record.mesh.userData.heartMaterial as MeshBasicMaterial | undefined;
      if (heart) heart.color.copy(hdr(MOLTEN_ORANGE, 1.3 + Math.sin(elapsedNow * 5.4) * 0.5));
      const cageA = record.mesh.userData.cageA as Group | undefined;
      const cageB = record.mesh.userData.cageB as Group | undefined;
      if (cageA) cageA.rotation.z += dt * 0.7;
      if (cageB) cageB.rotation.y += dt * 0.5;
    }

    // Escorts trail their launch burn.
    if (kind === 'escort' || record.mesh.userData.isHostileShot) {
      dropTrail(record.mesh.position, (record.mesh.userData.trailColor as Color | undefined) ?? CRIMSON_FIRE.clone().multiplyScalar(0.5));
    }

    if (record.lockRing) {
      record.mesh.getWorldPosition(record.lockRing.position);
      record.lockRing.quaternion.copy((ctx.camera as PerspectiveCamera).quaternion);
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

  const reticleSpinner = findReticleSpinner(ctx.scene);
  if (reticleSpinner) {
    const active = reticleSpinner.parent?.userData.active === true;
    reticleSpinner.rotation.z += dt * (active ? 4.2 : 0.9);
    const ticks = reticleSpinner.parent?.userData.ticks as Group | undefined;
    if (ticks) ticks.rotation.z -= dt * (active ? 2.4 : 0.5);
  }

  updateEffects(dt, ctx.camera);
}

export function updateCameraEffects(dt: number, ctx: CameraEffectsContext) {
  const runTime = ctx.running ? ctx.runTime : 0;
  const speed = ctx.running ? speedFactorAt(runTime) : 0.5;
  if (!(ctx.camera instanceof PerspectiveCamera)) return;
  const camera = ctx.camera;

  // FOV breathes with the surge; salvos and the finale kick it.
  const targetFovOffset = (speed - 0.9) * 7.5 + beatEnergy * 0.8 + surgePulse * 5;
  cameraFovOffset = MathUtils.lerp(cameraFovOffset, targetFovOffset, Math.min(1, dt * 6));

  if (ctx.running) {
    // Bank with the rail's weave; steady in the eye.
    const u = broadsideRunProgress(ctx.runTime);
    const tangent = rail.getTangentAt(MathUtils.clamp(u, 0, 1));
    const ahead = rail.getTangentAt(MathUtils.clamp(u + 0.006, 0, 1));
    const targetRoll = MathUtils.clamp((ahead.x - tangent.x) * 24, -0.16, 0.16);
    cameraRoll += (targetRoll - cameraRoll) * Math.min(1, dt * 3.4);
    camera.rotateZ(cameraRoll);
  }

  ctx.feel.setFovOffset(cameraFovOffset);
  ctx.feel.update(dt, { shake: BROADSIDE_CAMERA_SHAKE });
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

  const distance = record.mesh.position.distanceTo((ctx.camera as PerspectiveCamera).position);
  const closeness = smootherstep(1 - clamp01((distance - 14) / (64 - 14)));
  const locked = userData.locked === true;
  const damageFlash = (userData.damageFlashUntil as number | undefined ?? -Infinity) > elapsedNow;

  for (const part of parts) {
    if (denied) {
      part.material.color.copy(part.kind === 'fill' ? DENY_FILL : DENY_RED);
      continue;
    }
    if (locked) {
      if (part.kind === 'edge') part.material.color.copy(hdr(LOCK_GOLD, 1.5));
      else if (part.kind === 'fill') part.material.color.copy(LOCK_GOLD.clone().multiplyScalar(0.3));
      else part.material.color.copy(hdr(PLAYER_WHITE, 1.9));
      continue;
    }
    if (damageFlash) {
      part.material.color.copy(hdr(PLAYER_WHITE, part.kind === 'fill' ? 0.5 : 1.8));
      continue;
    }
    const dim = part.kind === 'edge' ? 0.5 + 0.5 * closeness : 0.35 + 0.65 * closeness;
    part.material.color.copy(part.base).multiplyScalar(dim);
  }
}

function findReticleSpinner(scene: Scene): Group | null {
  for (const child of scene.children) {
    if (child.userData.spinner) return child.userData.spinner as Group;
  }
  return null;
}

function makeLockBracket(color: Color): Group {
  const group = new Group();
  // A gun-laying bracket: the fire-control reticle clamping on.
  const square = new Mesh(
    new RingGeometry(0.84, 0.9, 4),
    createAdditiveBasicMaterial({ color: hdr(color, 1.7), side: DoubleSide }),
  );
  square.rotation.z = Math.PI / 4;
  const innerRing = new Mesh(
    new TorusGeometry(0.66, 0.025, 6, 32),
    createAdditiveBasicMaterial({ color: hdr(color.clone().lerp(PLAYER_WHITE, 0.5), 1.3), side: DoubleSide }),
  );
  group.add(square, innerRing);
  return group;
}

function easeOutBack(t: number): number {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2;
}

function clamp01(value: number) {
  return Math.min(1, Math.max(0, value));
}

function smootherstep(t: number) {
  return t * t * (3 - 2 * t);
}
