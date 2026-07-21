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
  PerspectiveCamera,
  PlaneGeometry,
  RingGeometry,
  Scene,
  Vector3,
} from 'three';
import type { Camera, LineBasicMaterial } from 'three';
import type { CameraFeelRig, CameraFeelShakeOptions } from '../../../engine/camera-feel';
import { colorForLockCount } from '../../../engine/locks';
import {
  createAdditiveBasicMaterial,
  createAdornmentSlot,
  createPendingVisualRecords,
  disposeObject3D,
} from '../../../engine/visual-kit';
import type { EventBus } from '../../../events';
import {
  createSkyhookRail,
  skyhookRunProgress,
  speedFactorAt,
  SKYHOOK_DURATION,
} from '../gameplay';
import { DECK_TIME, DOCK_TIME, SKYHOOK_TIME } from '../timing';
import {
  breakDescenderShell,
  createBallastMesh,
  createClampMesh,
  createDescenderCoreMesh,
  createKiteMesh,
  createLatcherMesh,
  createSentryMesh,
  createShardMesh,
  createSlugMesh,
  type TintPart,
} from './enemies';
import {
  DECK_U,
  createEnvironmentInternal,
  updateClouds,
  updateRain,
  updateSky,
  updateTetherFurniture,
  type Environment,
} from './environment';
import {
  burstDebris,
  createEffects,
  dropTracer,
  dropWisp,
  resetEffects,
  setEffectAirDensity,
  spawnRing,
  spawnSpark,
  updateEffects,
  type DebrisSpec,
} from './effects';
import { createLetterMesh, setLetterDenied, setLetterLocked } from './letters';
import {
  ALERT,
  CLOUD_LIT,
  HAZARD,
  INSTRUMENT,
  LOCK_GRADIENT,
  PANEL_WHITE,
  SUNLIGHT,
  hdr,
} from './palette';
import { glareUniform, hazeUniform, strainUniform } from './post-fx';

// The visual contract for Skyhook: everything the world builds is warm — white
// panel and hazard orange — and everything the *player* owns is cold instrument
// cyan: the reticle, the lock brackets, the shot tracers, and the tint a target
// takes the moment it is locked. That single split is what keeps a frame full
// of white hardware readable, with or without bloom.

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
  bracket: Group | null;
};

type ProjectileRecord = { mesh: Object3D };

const DENY_TRIM = new Color(1.7, 0.14, 0.08);
const DENY_HULL = new Color(0.34, 0.07, 0.05);

const SKYHOOK_SHAKE: CameraFeelShakeOptions = {
  decay: 2.9,
  maxTrauma: 1.7,
  pitchDegrees: 0.34,
  yawDegrees: 0.26,
  rollDegrees: 0.6,
  frequency: 9.5,
  smoothing: 22,
};

// Docking sweep: once the car is inside the station the camera finally looks
// back down the tether — the only moment in the run you see how far you climbed.
const SWEEP_START = SKYHOOK_TIME.bar(37.2);
const SWEEP_DOWN = SKYHOOK_TIME.bar(38.1);
const SWEEP_HOLD = SKYHOOK_TIME.bar(39.0);
const SWEEP_END = SKYHOOK_TIME.bar(39.8);
const SWEEP_DEGREES = 104;

const rail = createSkyhookRail();
const DECK_Y = rail.getPointAt(DECK_U).y;

let environment: Environment | null = null;
let beatEnergy = 0;
let elapsedNow = 0;
let lastRunTime = -1;
let cameraRoll = 0;
let cameraFovOffset = 0;
let surge = 0;
let strain = 0;
let alarm = 0;
let airDensity = 1;
let coreKilledAt = -1;
let clampedLatchers = 0;

const brackets = createAdornmentSlot<EnemyRecord, Group>({
  get: (record) => record.bracket,
  set: (record, bracket) => {
    record.bracket = bracket;
  },
});

// createEnemyMesh() has no id, but the runner emits `spawn` synchronously right
// after calling it — pairing the queue with spawn events links mesh to id.
const enemyRecords = createPendingVisualRecords<Group, EnemyRecord>({
  createRecord: (mesh) => ({ mesh, bornAt: null, bracket: null }),
  // Every hostile builds its own geometries and materials, so retiring one has
  // to hand them back or a sixty-second run leaks a thousand of them.
  disposeRecord: (record) => {
    brackets.detach(record);
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
    case 'kite':
      return createKiteMesh();
    case 'ballast':
      return createBallastMesh();
    case 'latcher':
      return createLatcherMesh();
    case 'sentry':
      return createSentryMesh();
    case 'shard':
      return createShardMesh();
    case 'slug':
      return createSlugMesh();
    case 'clamp':
      return createClampMesh();
    case 'core':
      return createDescenderCoreMesh();
    default:
      return createBallastMesh();
  }
}

export function setEnemyLocked(mesh: Object3D, locked: boolean) {
  mesh.userData.locked = locked;
  if (mesh.userData.isLetter) setLetterLocked(mesh as Group, locked);
}

export function setEnemyDenied(mesh: Object3D) {
  mesh.userData.deniedUntil = elapsedNow + 0.55;
  if (mesh.userData.isLetter) setLetterDenied(mesh as Group, true);
  spawnRing(mesh.position, DENY_TRIM.clone(), 3.0, 0.3);
}

// The car's rail-gun round: a cold slug on a cyan tracer, the one thing in the
// frame that is not painted in hazard orange.
export function createProjectileMesh() {
  const group = new Group();
  const core = new Mesh(new BoxGeometry(0.14, 0.14, 1.5), new MeshBasicMaterial({ color: hdr(PANEL_WHITE, 1.9) }));
  const sheath = new Mesh(
    new BoxGeometry(0.3, 0.3, 1.1),
    createAdditiveBasicMaterial({ color: hdr(INSTRUMENT, 0.9), opacity: 0.55 }),
  );
  group.add(core, sheath);
  projectileRecords.enqueue({ mesh: group });
  return group;
}

// ---- reticle -------------------------------------------------------------------

// An instrument, not a crosshair: a thin ranging circle, four corner ticks, and
// a lock ladder that lights one rung at a time as the volley charges.
export function createReticle() {
  const group = new Group();
  const parts: Array<{ material: MeshBasicMaterial; base: Color }> = [];
  const addPart = (mesh: Mesh, base: Color) => {
    const material = mesh.material as MeshBasicMaterial;
    material.color.copy(base);
    parts.push({ material, base: base.clone() });
    return mesh;
  };

  const circle = new Mesh(
    new RingGeometry(0.56, 0.585, 60),
    createAdditiveBasicMaterial({ color: INSTRUMENT, side: DoubleSide }),
  );
  addPart(circle, hdr(INSTRUMENT, 1.1));

  const corners = new Group();
  for (let i = 0; i < 4; i += 1) {
    const angle = (i / 4) * Math.PI * 2 + Math.PI / 4;
    for (const along of [0, 1]) {
      const tick = new Mesh(
        new PlaneGeometry(along ? 0.045 : 0.26, along ? 0.26 : 0.045),
        createAdditiveBasicMaterial({ color: INSTRUMENT, side: DoubleSide }),
      );
      tick.position.set(
        Math.cos(angle) * 0.82 + (along ? 0 : -Math.sign(Math.cos(angle)) * 0.1),
        Math.sin(angle) * 0.82 + (along ? -Math.sign(Math.sin(angle)) * 0.1 : 0),
        0,
      );
      addPart(tick, hdr(INSTRUMENT, 1.25));
      corners.add(tick);
    }
  }

  // Lock ladder: six rungs around the ring, one lit per lock.
  const rungs: Mesh[] = [];
  for (let i = 0; i < 6; i += 1) {
    const angle = -Math.PI / 2 + (i / 6) * Math.PI * 2;
    const rung = new Mesh(
      new PlaneGeometry(0.14, 0.06),
      createAdditiveBasicMaterial({ color: INSTRUMENT, side: DoubleSide, opacity: 0.18 }),
    );
    rung.position.set(Math.cos(angle) * 0.7, Math.sin(angle) * 0.7, 0);
    rung.rotation.z = angle + Math.PI / 2;
    rungs.push(rung);
    group.add(rung);
  }

  const pip = new Mesh(
    new CircleGeometry(0.038, 12),
    createAdditiveBasicMaterial({ color: PANEL_WHITE, side: DoubleSide }),
  );
  addPart(pip, hdr(PANEL_WHITE, 1.6));

  group.add(circle, corners, pip);
  group.userData.parts = parts;
  group.userData.corners = corners;
  group.userData.rungs = rungs;
  group.userData.active = false;
  return group;
}

export function setReticleActive(reticle: Object3D, active: boolean, lockCount: number) {
  reticle.userData.active = active;
  reticle.scale.setScalar(1 + lockCount * 0.055 + (active ? 0.05 : 0));
  const parts = reticle.userData.parts as Array<{ material: MeshBasicMaterial; base: Color }>;
  const charge = lockCount === 0 ? null : colorForLockCount(lockCount, LOCK_GRADIENT);
  for (const part of parts) {
    if (charge) part.material.color.copy(hdr(charge, active ? 1.55 : 1.2));
    else part.material.color.copy(part.base).multiplyScalar(active ? 1.35 : 1);
  }
  const rungs = reticle.userData.rungs as Mesh[];
  for (const [index, rung] of rungs.entries()) {
    const lit = index < lockCount;
    const material = rung.material as MeshBasicMaterial;
    material.opacity = lit ? 1 : 0.18;
    material.color.copy(lit ? hdr(colorForLockCount(index + 1, LOCK_GRADIENT), 1.5) : INSTRUMENT);
  }
}

// ---- event wiring ----------------------------------------------------------------

export function installVisualEventHandlers(bus: EventBus, scene: Scene, cameraFeel: CameraFeelRig) {
  bus.on('spawn', ({ enemyId, kind, worldPosition }) => {
    const record = enemyRecords.claim(enemyId);
    if (!record) return;
    if (kind === 'latcher') {
      // Proximity warning: the cowl lamps start flashing long before it lands.
      alarm = Math.max(alarm, 1);
      spawnRing(worldPosition, hdr(ALERT, 0.9), 6, 0.55);
      spawnRing(worldPosition, hdr(HAZARD, 0.7), 3.4, 0.4);
    } else if (kind === 'core') {
      cameraFeel.shake(0.9, SKYHOOK_SHAKE);
      surge = Math.max(surge, 0.6);
      glareUniform.value = Math.max(glareUniform.value, 0.22);
      spawnRing(worldPosition, hdr(HAZARD, 1.0), 40, 1.1);
    } else if (kind === 'slug') {
      spawnSpark(worldPosition, hdr(HAZARD, 1.6), 1.0, 0.16);
    } else if (kind !== 'clamp') {
      spawnRing(worldPosition, hdr(PANEL_WHITE, 0.5), 2.4, 0.34, 0.5);
    }
  });

  bus.on('lock', ({ enemyId, worldPosition, lockCount }) => {
    const lockColor = colorForLockCount(lockCount, LOCK_GRADIENT);
    const record = enemyRecords.get(enemyId);
    if (record && !record.bracket) brackets.attach(record, makeBracket(lockColor), scene);
    spawnSpark(worldPosition, hdr(lockColor, 1.5), 0.7, 0.14);
  });

  bus.on('unlock', ({ enemyId }) => {
    const record = enemyRecords.get(enemyId);
    if (record) brackets.detach(record);
  });

  bus.on('fire', ({ projectileId, worldPosition }) => {
    projectileRecords.claim(projectileId);
    spawnSpark(worldPosition, hdr(INSTRUMENT, 1.4), 0.5, 0.1);
  });

  bus.on('hit', ({ enemyId, projectileId, worldPosition, lethal }) => {
    projectileRecords.delete(projectileId);
    spawnSpark(worldPosition, hdr(SUNLIGHT, 1.3), 0.7, 0.12);
    const record = enemyRecords.get(enemyId);
    if (record && !lethal) {
      record.mesh.userData.damageFlashUntil = elapsedNow + 0.3;
      burstDebris(worldPosition, (record.mesh.userData.debrisSpecs as DebrisSpec[] | undefined)?.slice(0, 3) ?? [], 7, 0.9);
    }
  });

  bus.on('stage', ({ enemyId, worldPosition }) => {
    const record = enemyRecords.get(enemyId);
    if (!record) return;
    if (record.mesh.userData.isDescenderCore) {
      // Its shell splits, and the recoil slips the whole machine back up the ribbon.
      breakDescenderShell(record.mesh);
      cameraFeel.shake(0.8, SKYHOOK_SHAKE);
      surge = Math.max(surge, 0.45);
      spawnRing(worldPosition, hdr(PANEL_WHITE, 1.0), 46, 0.9);
      burstDebris(worldPosition, (record.mesh.userData.debrisSpecs as DebrisSpec[]) ?? [], 26, 0.8);
    } else {
      spawnRing(worldPosition, hdr(HAZARD, 0.8), 5, 0.4);
      burstDebris(worldPosition, (record.mesh.userData.debrisSpecs as DebrisSpec[] | undefined)?.slice(0, 5) ?? [], 10);
    }
  });

  bus.on('kill', ({ enemyId, worldPosition }) => {
    const record = enemyRecords.get(enemyId);
    if (!record) return;
    const specs = (record.mesh.userData.debrisSpecs as DebrisSpec[] | undefined) ?? [];
    const accent = (record.mesh.userData.accent as Color | undefined) ?? HAZARD;
    burstDebris(worldPosition, specs, 13);
    spawnRing(worldPosition, hdr(accent, 0.8), 4.2, 0.38);
    spawnSpark(worldPosition, hdr(PANEL_WHITE, 1.7), 1.0, 0.16);

    if (record.mesh.userData.isDescenderCore) {
      coreKilledAt = elapsedNow;
      cameraFeel.shake(1.7, SKYHOOK_SHAKE);
      surge = 1;
      glareUniform.value = Math.max(glareUniform.value, 1.1);
      spawnRing(worldPosition, hdr(PANEL_WHITE, 1.5), 130, 1.7);
      spawnRing(worldPosition, hdr(HAZARD, 1.1), 78, 1.3);
      spawnSpark(worldPosition, hdr(SUNLIGHT, 2.2), 9, 0.5);
      burstDebris(worldPosition, specs, 46, 1.2);
    } else if (record.mesh.userData.kind === 'clamp') {
      cameraFeel.shake(0.55, SKYHOOK_SHAKE);
      spawnRing(worldPosition, hdr(HAZARD, 1.1), 16, 0.6);
    } else if (record.mesh.userData.isLatcher) {
      if (record.mesh.userData.clamped) clampedLatchers = Math.max(0, clampedLatchers - 1);
      cameraFeel.shake(0.3, SKYHOOK_SHAKE);
      spawnRing(worldPosition, hdr(PANEL_WHITE, 0.9), 5.5, 0.4);
    }
    enemyRecords.delete(enemyId, { dispose: true });
  });

  bus.on('miss', ({ enemyId, worldPosition }) => {
    const record = enemyRecords.get(enemyId);
    if (record) {
      if (record.mesh.userData.clamped) clampedLatchers = Math.max(0, clampedLatchers - 1);
      enemyRecords.delete(enemyId, { dispose: true });
    }
    dropWisp(worldPosition, hdr(CLOUD_LIT, 0.2), new Vector3(0, -6, 0));
  });

  bus.on('volley', ({ size, kills }) => {
    if (size >= 5 && kills === size) {
      beatEnergy = Math.max(beatEnergy, 1.6);
      glareUniform.value = Math.max(glareUniform.value, 0.16);
    }
  });

  bus.on('beat', ({ isDownbeat }) => {
    beatEnergy = Math.max(beatEnergy, isDownbeat ? 1 : 0.4);
  });

  bus.on('reject', () => {
    // Rejected release: the car's own console throws a fault, edge burn and all.
    alarm = 1;
    strain = Math.max(strain, 0.75);
    cameraFeel.shake(0.28, SKYHOOK_SHAKE);
  });

  bus.on('playerhit', () => {
    beatEnergy = 1.5;
    strain = 1;
    alarm = 1;
    cameraFeel.shake(1.2, SKYHOOK_SHAKE);
    if (environment) {
      for (const anchor of environment.cowlSparkAnchors) {
        spawnSpark(environment.cowl.localToWorld(anchor.clone()), hdr(HAZARD, 1.8), 0.9, 0.28);
      }
    }
  });

  bus.on('bossphase', ({ phase }) => {
    if (phase === 'exposed') {
      glareUniform.value = Math.max(glareUniform.value, 0.2);
      surge = Math.max(surge, 0.4);
    }
  });

  bus.on('runstart', () => {
    resetEffects();
    enemyRecords.clear({ dispose: true, pending: true });
    projectileRecords.clear({ pending: true });
    coreKilledAt = -1;
    clampedLatchers = 0;
    surge = 0;
    strain = 0;
    alarm = 0;
    glareUniform.value = 0;
    strainUniform.value = 0;
    resetCameraFeel(cameraFeel);
  });

  bus.on('runend', () => {
    resetCameraFeel(cameraFeel);
  });

  void scene;
}

// ---- per-frame ---------------------------------------------------------------------

function resetCameraFeel(cameraFeel: CameraFeelRig) {
  lastRunTime = -1;
  cameraRoll = 0;
  cameraFovOffset = 0;
  cameraFeel.restore();
}

export function updateVisuals(dt: number, ctx: VisualContext) {
  elapsedNow = ctx.elapsed;
  beatEnergy = Math.max(0, beatEnergy - dt * 4.4);
  surge = Math.max(0, surge - dt * 0.9);
  strain = Math.max(0, strain - dt * 0.7);
  alarm = Math.max(0, alarm - dt * 0.85);

  const runTime = ctx.running ? ctx.runTime : 0;
  const progress = ctx.running ? skyhookRunProgress(runTime, SKYHOOK_DURATION) : 0;
  const speedFactor = ctx.running ? speedFactorAt(runTime) : 0.55;
  // Roughly the world units per second the camera is covering right now.
  const speed = speedFactor * 19;

  updateSetPieceMoments(ctx);

  const camera = ctx.camera as PerspectiveCamera;
  if (environment) {
    environment.applyAtmosphere(progress);
    airDensity = airDensityAt(progress);
    setEffectAirDensity(airDensity);

    updateTetherFurniture(environment, progress, camera.position.y);
    updateClouds(environment, camera.position, dt, speed);
    updateRain(environment, camera.position, dt, speed, wetnessAt(camera.position.y));
    updateSky(environment, camera.position, airDensity, ctx.elapsed);

    environment.cowl.position.copy(camera.position);
    environment.cowl.quaternion.copy(camera.quaternion);
    const alarmLevel = Math.max(alarm, clampedLatchers > 0 ? 0.75 : 0);
    const blink = alarmLevel > 0.02 ? (Math.sin(ctx.elapsed * 15) * 0.5 + 0.5) * alarmLevel : 0;
    for (const material of environment.cowlAlarms) {
      material.color.copy(hdr(HAZARD, 0.4)).lerp(hdr(ALERT, 2.2), blink);
    }
    // Station lights breathe on the beat once the dock is in sight.
    for (const material of environment.stationLights) {
      material.color.copy(hdr(SUNLIGHT, 0.6 + beatEnergy * 0.5));
    }
  }

  updatePostUniforms(dt, ctx, runTime);
  updateEnemies(dt, camera);
  updateProjectiles();
  updateReticleSpin(dt, ctx.scene);
  updateEffects(dt, ctx.camera);
}

/** Air fraction by rail progress — the number the whole level's look and mix hang on. */
export function airDensityAt(progress: number) {
  if (progress <= DECK_U) return 1;
  return MathUtils.clamp(1 - (progress - DECK_U) / 0.42, 0, 1) ** 1.5;
}

function wetnessAt(cameraY: number) {
  return MathUtils.clamp((DECK_Y - 12 - cameraY) / 95, 0, 1);
}

// The cloud-deck punch: one frame of sunlight, and every layer below is gone.
function updateSetPieceMoments(ctx: VisualContext) {
  if (!ctx.running) {
    lastRunTime = -1;
    return;
  }
  if (lastRunTime >= 0 && lastRunTime < DECK_TIME && ctx.runTime >= DECK_TIME) {
    glareUniform.value = Math.max(glareUniform.value, 0.95);
    surge = Math.max(surge, 1);
    ctx.feel.shake(0.65, SKYHOOK_SHAKE);
    const camera = ctx.camera as PerspectiveCamera;
    spawnRing(camera.position.clone().setY(camera.position.y + 24), hdr(CLOUD_LIT, 1.2), 90, 1.2);
  }
  lastRunTime = ctx.runTime;
}

function updatePostUniforms(dt: number, ctx: VisualContext, runTime: number) {
  hazeUniform.value += ((ctx.running ? airDensity * 0.85 : 0.75) - hazeUniform.value) * Math.min(1, dt * 1.6);
  strainUniform.value += (strain - strainUniform.value) * Math.min(1, dt * 7);
  glareUniform.value = Math.max(0, glareUniform.value - dt * (glareUniform.value > 0.7 ? 1.3 : 2.2));

  // Docking: the station floods the frame with clean white light as it closes.
  if (ctx.running && runTime >= DOCK_TIME) {
    glareUniform.value = Math.max(glareUniform.value, MathUtils.clamp((runTime - DOCK_TIME) / 2.4, 0, 1) * 0.12);
  }

  if (coreKilledAt >= 0) {
    const since = elapsedNow - coreKilledAt;
    if (since < 2.2) glareUniform.value = Math.max(glareUniform.value, 0.45 * (1 - since / 2.2));
  }
}

function updateEnemies(dt: number, camera: PerspectiveCamera) {
  for (const [enemyId, record] of enemyRecords.entries()) {
    if (!record.mesh.parent) {
      enemyRecords.delete(enemyId, { dispose: true });
      continue;
    }
    if (record.bornAt === null) record.bornAt = elapsedNow;
    const age = elapsedNow - record.bornAt;
    // The Descender is already vast; it does not pop in the way a target does.
    record.mesh.scale.setScalar(
      record.mesh.userData.isDescenderCore ? Math.min(1, age / 1.1) : easeOutBack(Math.min(1, age / 0.34)),
    );

    tintEnemy(record, camera);

    if (record.mesh.userData.clamped) {
      const bite = (record.mesh.userData.biteCharge as number | undefined) ?? 0;
      if (bite > 0.8 && Math.random() < dt * 28) {
        spawnSpark(record.mesh.position, hdr(HAZARD, 1.9), 0.5, 0.2);
      }
    }

    if (record.mesh.userData.isHostileShot) {
      dropWisp(record.mesh.position, record.mesh.userData.trailColor as Color, new Vector3(0, -3, 0));
    }

    if (record.bracket) {
      record.mesh.getWorldPosition(record.bracket.position);
      record.bracket.quaternion.copy(camera.quaternion);
      const fit = (record.mesh.userData.lockRingScale as number | undefined) ?? 1;
      record.bracket.scale.setScalar((1 + Math.sin(elapsedNow * 11) * 0.045) * 1.55 * fit);
      record.bracket.rotateZ(Math.sin(elapsedNow * 2.4) * 0.05);
    }
  }
}

function updateProjectiles() {
  for (const [projectileId, record] of projectileRecords.entries()) {
    if (!record.mesh.parent) {
      projectileRecords.delete(projectileId);
      continue;
    }
    dropTracer(record.mesh.position, hdr(INSTRUMENT, 0.9));
  }
}

function updateReticleSpin(dt: number, scene: Scene) {
  for (const child of scene.children) {
    const corners = child.userData.corners as Group | undefined;
    if (!corners) continue;
    corners.rotation.z += dt * (child.userData.active === true ? 1.3 : 0.35);
    return;
  }
}

function tintEnemy(record: EnemyRecord, camera: PerspectiveCamera) {
  const userData = record.mesh.userData;
  const denied = ((userData.deniedUntil as number | undefined) ?? -Infinity) > elapsedNow;

  if (userData.isLetter) {
    if (denied) setLetterDenied(record.mesh, true);
    else if (userData.locked !== true) setLetterLocked(record.mesh, false);
    return;
  }

  const parts = userData.parts as TintPart[] | undefined;
  if (!parts) return;

  // Distance falloff: far hardware settles back into the sky instead of stacking
  // into a bright blob, which matters most with the bloom slider turned up.
  const distance = record.mesh.position.distanceTo(camera.position);
  const closeness = smoothstep(1 - clamp01((distance - 14) / 62));
  const locked = userData.locked === true;
  const damageFlash = ((userData.damageFlashUntil as number | undefined) ?? -Infinity) > elapsedNow;
  const charge = (userData.charge as number | undefined) ?? 0;

  for (const part of parts) {
    const material = part.material as MeshBasicMaterial | LineBasicMaterial;
    if (denied) {
      material.color.copy(part.kind === 'hull' ? DENY_HULL : DENY_TRIM);
      continue;
    }
    if (locked) {
      // Locked targets go cold: the player's colour claims them.
      if (part.kind === 'hull') material.color.copy(INSTRUMENT).multiplyScalar(0.42);
      else if (part.kind === 'trim') material.color.copy(hdr(INSTRUMENT, 1.5));
      else material.color.copy(hdr(PANEL_WHITE, 1.9));
      continue;
    }
    if (damageFlash) {
      material.color.copy(hdr(PANEL_WHITE, part.kind === 'hull' ? 0.7 : 1.8));
      continue;
    }
    // Hulls sit well under the sky's value so white hardware still reads as a
    // solid shape against a bright cloud deck; trim and lamps carry the accent.
    material.color.copy(part.base).multiplyScalar(part.kind === 'hull' ? 0.22 + 0.36 * closeness : 0.52 + 0.58 * closeness);
    // A charging sentry visibly heats its iris before it spits.
    if (part.kind === 'lamp' && charge > 0) material.color.lerp(hdr(ALERT, 1.6), charge * 0.8);
  }
}

// ---- camera --------------------------------------------------------------------

export function updateCameraEffects(dt: number, ctx: CameraEffectsContext) {
  if (!(ctx.camera instanceof PerspectiveCamera)) return;
  const camera = ctx.camera;
  const runTime = ctx.running ? ctx.runTime : 0;
  const speedFactor = ctx.running ? speedFactorAt(runTime) : 0.55;

  // FOV rides airspeed. The deck punch throws it wide; the dock pulls it in
  // tight as the car brakes, which is what makes the ending feel like arriving.
  const targetFov = (speedFactor - 1.0) * 11 + beatEnergy * 0.9 + surge * 6.5;
  cameraFovOffset = MathUtils.lerp(cameraFovOffset, targetFov, Math.min(1, dt * 5.5));
  ctx.feel.setFovOffset(cameraFovOffset);

  if (ctx.running) {
    // Bank into the tether's lazy drift. Cosmetic only — applied after the
    // runner's lookAt, and small enough that lock hit-testing stays honest.
    const u = skyhookRunProgress(runTime, SKYHOOK_DURATION);
    const here = rail.getTangentAt(MathUtils.clamp(u, 0, 1));
    const ahead = rail.getTangentAt(MathUtils.clamp(u + 0.01, 0, 1));
    const targetRoll = MathUtils.clamp((ahead.x - here.x) * 46, -0.13, 0.13);
    cameraRoll += (targetRoll - cameraRoll) * Math.min(1, dt * 2.6);
    camera.rotateZ(cameraRoll);
    const sweep = dockingSweep(runTime);
    if (sweep > 0) camera.rotateX(-MathUtils.degToRad(SWEEP_DEGREES) * sweep);
  }

  ctx.feel.update(dt, { shake: SKYHOOK_SHAKE });
}

/** 0 → 1 → 0 pitch-down across the docking bars, so the sweep starts and ends level. */
function dockingSweep(runTime: number) {
  if (runTime <= SWEEP_START || runTime >= SWEEP_END) return 0;
  if (runTime < SWEEP_DOWN) return smoothstep((runTime - SWEEP_START) / (SWEEP_DOWN - SWEEP_START));
  if (runTime < SWEEP_HOLD) return 1;
  return 1 - smoothstep((runTime - SWEEP_HOLD) / (SWEEP_END - SWEEP_HOLD));
}

// ---- helpers --------------------------------------------------------------------

// A four-corner bracket, not a ring: the lock reads as an instrument acquiring a
// contact, and it is made of the same strokes as the reticle it came from.
function makeBracket(color: Color): Group {
  const group = new Group();
  const material = () => createAdditiveBasicMaterial({ color: hdr(color, 1.7), side: DoubleSide });
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      const horizontal = new Mesh(new PlaneGeometry(0.36, 0.07), material());
      horizontal.position.set(sx * 0.72, sy * 0.9, 0);
      const vertical = new Mesh(new PlaneGeometry(0.07, 0.36), material());
      vertical.position.set(sx * 0.9, sy * 0.72, 0);
      group.add(horizontal, vertical);
    }
  }
  const tick = new Mesh(new PlaneGeometry(0.5, 0.045), material());
  tick.position.y = -1.16;
  group.add(tick);
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

function smoothstep(t: number): number {
  const x = clamp01(t);
  return x * x * (3 - 2 * x);
}
