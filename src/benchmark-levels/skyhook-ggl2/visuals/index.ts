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
import {
  CLOUDBREAK_TIME,
  createSkyhookGgl2Rail,
  DESCENT_TIME,
  DOCK_TIME,
  skyhookRunProgress,
  SKYHOOK_GGL2_RUN_DURATION,
  speedFactorAt,
  THIN_TIME,
} from '../gameplay';
import {
  createBoltMesh,
  createDescenderMesh,
  createGrapnelMesh,
  createHuskMesh,
  createKiteMesh,
  createPodMesh,
  type TintPart,
} from './enemies';
import {
  altitudeUniform,
  beatUniform,
  createEnvironmentInternal,
  dockGlowUniform,
  streakGlowUniform,
  streakOffsetUniform,
  type Environment,
} from './environment';
import {
  burstDebris,
  burstSparks,
  createEffects,
  dropTrail,
  resetEffects,
  spawnGlint,
  spawnPuff,
  spawnRing,
  updateEffects,
  type DebrisSpec,
} from './effects';
import { createLetterMesh, setLetterDenied, setLetterLocked } from './letters';
import { HAZARD, HAZARD_HOT, hdr, ICE, ICE_HOT, LOCK_GRADIENT, PANEL, STAR, WARN } from './palette';
import { dockUniform, flashUniform, hazeUniform } from './post-fx';

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

type EnemyRecord = { mesh: Group; bornAt: number | null; lockRing: Group | null };
type ProjectileRecord = { mesh: Object3D; trailColor: Color };

const DENY_RED = new Color(1.6, 0.1, 0.05);
const DENY_FILL = new Color(0.3, 0.02, 0.01);

let environment: Environment | null = null;
let beatEnergy = 0;
let cameraRoll = 0;
let cameraFovOffset = 0;
let surgePulse = 0;
let elapsedNow = 0;
let lastRunTime = -1;
let bossKilledAt = -1;

const SKYHOOK_CAMERA_SHAKE: CameraFeelShakeOptions = {
  decay: 2.6,
  maxTrauma: 1.6,
  pitchDegrees: 0.32,
  yawDegrees: 0.26,
  rollDegrees: 0.62,
  frequency: 8.5,
  smoothing: 20,
};

const rail = createSkyhookGgl2Rail();

const lockRings = createAdornmentSlot<EnemyRecord, Group>({
  get: (record) => record.lockRing,
  set: (record, ring) => {
    record.lockRing = ring;
  },
});

const enemyRecords = createPendingVisualRecords<Group, EnemyRecord>({
  createRecord: (mesh) => ({ mesh, bornAt: null, lockRing: null }),
  disposeRecord: (record) => lockRings.detach(record),
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
  if (kind !== 'descender') mesh.scale.setScalar(0.001);
  enemyRecords.enqueue(mesh);
  return mesh;
}

function buildEnemyMesh(kind: string, letter?: string): Group {
  switch (kind) {
    case 'letter':
      return createLetterMesh(letter ?? 'A');
    case 'pod':
      return createPodMesh();
    case 'kite':
      return createKiteMesh();
    case 'husk':
      return createHuskMesh();
    case 'grapnel':
      return createGrapnelMesh();
    case 'bolt':
      return createBoltMesh();
    case 'descender':
      return createDescenderMesh();
    default:
      return createPodMesh();
  }
}

export function setEnemyLocked(mesh: Object3D, locked: boolean) {
  mesh.userData.locked = locked;
  if (mesh.userData.isLetter) setLetterLocked(mesh as Group, locked);
}

export function setEnemyDenied(mesh: Object3D) {
  mesh.userData.deniedUntil = elapsedNow + 0.5;
  spawnRing(mesh.position, DENY_RED.clone(), 2.6, 0.3);
}

// Player shot: a cold ice-white dart — the one calm-coloured thing in the frame.
export function createProjectileMesh() {
  const group = new Group();
  const coreGeometry = new OctahedronGeometry(0.32, 0);
  coreGeometry.scale(0.42, 0.42, 2.1);
  group.add(new Mesh(coreGeometry, new MeshBasicMaterial({ color: hdr(ICE_HOT, 2.6) })));
  const shellGeometry = new OctahedronGeometry(0.5, 0);
  shellGeometry.scale(0.5, 0.5, 1.8);
  group.add(new Mesh(shellGeometry, createAdditiveBasicMaterial({ color: hdr(ICE, 1.0), opacity: 0.5 })));
  projectileRecords.enqueue({ mesh: group, trailColor: ICE.clone().multiplyScalar(0.85) });
  return group;
}

// ---- reticle ---------------------------------------------------------------

export function createReticle() {
  const group = new Group();
  const parts: Array<{ material: MeshBasicMaterial; base: Color }> = [];
  const addPart = (mesh: Mesh, base: Color) => {
    const material = configureAdditiveMaterial(mesh.material as MeshBasicMaterial, { color: base, side: DoubleSide });
    parts.push({ material, base });
  };

  const outer = new Mesh(new RingGeometry(0.62, 0.66, 4), new MeshBasicMaterial());
  outer.rotation.z = Math.PI / 4;
  addPart(outer, hdr(ICE, 1.1));

  const spinner = new Group();
  const inner = new Mesh(new RingGeometry(0.36, 0.4, 4), new MeshBasicMaterial());
  addPart(inner, hdr(PANEL, 1.0));
  spinner.add(inner);

  const brackets = new Group();
  for (let i = 0; i < 4; i += 1) {
    const tick = new Mesh(new PlaneGeometry(0.22, 0.04), new MeshBasicMaterial());
    addPart(tick, hdr(ICE, 1.3));
    const angle = (i / 4) * Math.PI * 2 + Math.PI / 4;
    tick.position.set(Math.cos(angle) * 0.82, Math.sin(angle) * 0.82, 0);
    tick.rotation.z = angle;
    brackets.add(tick);
  }

  const dot = new Mesh(new CircleGeometry(0.05, 16), new MeshBasicMaterial());
  addPart(dot, hdr(ICE_HOT, 2.0));

  group.add(outer, spinner, brackets, dot);
  group.userData.parts = parts;
  group.userData.spinner = spinner;
  group.userData.brackets = brackets;
  group.userData.active = false;
  return group;
}

export function setReticleActive(reticle: Object3D, active: boolean, lockCount: number) {
  reticle.userData.active = active;
  reticle.scale.setScalar(1 + lockCount * 0.075 + (active ? 0.05 : 0));
  const parts = reticle.userData.parts as Array<{ material: MeshBasicMaterial; base: Color }>;
  const charge = lockCount === 0 ? null : colorForLockCount(lockCount, LOCK_GRADIENT);
  for (const part of parts) {
    if (charge) part.material.color.copy(hdr(charge, active ? 1.7 : 1.3));
    else part.material.color.copy(part.base).multiplyScalar(active ? 1.35 : 1);
  }
}

// ---- event wiring ----------------------------------------------------------

export function installVisualEventHandlers(bus: EventBus, scene: Scene, cameraFeel: CameraFeelRig) {
  bus.on('spawn', ({ enemyId, kind, worldPosition }) => {
    const record = enemyRecords.claim(enemyId);
    if (!record) return;
    if (kind === 'descender') {
      cameraFeel.shake(1.0, SKYHOOK_CAMERA_SHAKE);
      surgePulse = Math.max(surgePulse, 0.5);
      spawnRing(worldPosition, hdr(WARN, 1.2), 28, 0.9);
      spawnRing(worldPosition, hdr(HAZARD, 1.0), 16, 0.7);
    } else if (kind === 'grapnel') {
      spawnRing(worldPosition, hdr(HAZARD, 1.1), 4, 0.5);
    } else if (kind !== 'bolt') {
      spawnRing(worldPosition, hdr(PANEL, 0.7), 2.4, 0.4);
    }
  });

  bus.on('lock', ({ enemyId, worldPosition, lockCount }) => {
    const lockColor = colorForLockCount(lockCount, LOCK_GRADIENT);
    const record = enemyRecords.get(enemyId);
    if (record && !record.lockRing) lockRings.attach(record, makeLockRing(lockColor), scene);
    spawnRing(worldPosition, hdr(lockColor, 1.4), 2.2, 0.26);
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
    projectileRecords.delete(projectileId);
    burstSparks(worldPosition, hdr(ICE, 0.9), 5, 10, 3);
    const record = enemyRecords.get(enemyId);
    if (record && !lethal) {
      record.mesh.userData.damageFlashUntil = elapsedNow + 0.3;
      spawnGlint(worldPosition, hdr(ICE_HOT, 1.7), 1.0, 0.15);
    }
  });

  bus.on('stage', ({ enemyId, worldPosition }) => {
    const record = enemyRecords.get(enemyId);
    if (!record) return;
    if (record.mesh.userData.kind === 'descender') {
      cameraFeel.shake(0.9, SKYHOOK_CAMERA_SHAKE);
      surgePulse = Math.max(surgePulse, 0.4);
      spawnRing(worldPosition, hdr(WARN, 1.4), 22, 0.8);
      spawnRing(worldPosition, hdr(HAZARD_HOT, 1.1), 12, 0.6);
      const specs = record.mesh.userData.debrisSpecs as DebrisSpec[] | undefined;
      if (specs) burstDebris(worldPosition, specs.slice(0, 5));
      burstSparks(worldPosition, hdr(HAZARD, 1.1), 20, 16);
    }
  });

  bus.on('kill', ({ enemyId, worldPosition }) => {
    const record = enemyRecords.get(enemyId);
    if (!record) return;
    const specs = record.mesh.userData.debrisSpecs as DebrisSpec[] | undefined;
    if (specs) burstDebris(worldPosition, specs);
    const accent = (record.mesh.userData.accent as Color | undefined) ?? HAZARD;
    burstSparks(worldPosition, hdr(accent, 1.0), 9, 13);
    spawnRing(worldPosition, hdr(accent, 0.9), 4.4, 0.4);
    spawnGlint(worldPosition, hdr(ICE, 1.5), 1.1, 0.16);

    if (record.mesh.userData.kind === 'descender') {
      // The Descender comes apart: the last stretch to the station opens up.
      bossKilledAt = elapsedNow;
      cameraFeel.shake(1.6, SKYHOOK_CAMERA_SHAKE);
      surgePulse = 0.9;
      flashUniform.value = Math.max(flashUniform.value, 0.9);
      spawnRing(worldPosition, hdr(PANEL, 1.5), 80, 1.5);
      spawnRing(worldPosition, hdr(HAZARD, 1.2), 48, 1.1);
      spawnRing(worldPosition, hdr(WARN, 1.0), 28, 0.85);
      spawnGlint(worldPosition, hdr(ICE_HOT, 2.2), 6, 0.5);
      burstSparks(worldPosition, hdr(HAZARD, 1.3), 50, 30, 6);
    } else if (record.mesh.userData.kind === 'grapnel') {
      cameraFeel.shake(0.4, SKYHOOK_CAMERA_SHAKE);
      spawnRing(worldPosition, hdr(HAZARD, 1.2), 7, 0.5);
    }
    enemyRecords.delete(enemyId, { dispose: true });
  });

  bus.on('miss', ({ enemyId, worldPosition, letter }) => {
    const record = enemyRecords.get(enemyId);
    if (record) enemyRecords.delete(enemyId, { dispose: true });
    if (letter === undefined) burstSparks(worldPosition, HAZARD.clone().multiplyScalar(0.4), 3, 3, 2);
  });

  bus.on('volley', ({ size, kills }) => {
    if (size >= 5 && kills === size) {
      beatEnergy = Math.max(beatEnergy, 1.5);
      flashUniform.value = Math.max(flashUniform.value, 0.2);
    }
  });

  bus.on('beat', ({ isDownbeat }) => {
    beatEnergy = Math.max(beatEnergy, isDownbeat ? 1 : 0.45);
  });

  bus.on('playerhit', () => {
    beatEnergy = 1.4;
    cameraFeel.shake(1.2, SKYHOOK_CAMERA_SHAKE);
    flashUniform.value = Math.max(flashUniform.value, 0.12);
  });

  bus.on('runstart', () => {
    resetEffects();
    enemyRecords.clear({ dispose: true, pending: true });
    projectileRecords.clear({ pending: true });
    bossKilledAt = -1;
    resetCameraState(cameraFeel);
    beatEnergy = 0;
    surgePulse = 0;
    flashUniform.value = 0;
    dockUniform.value = 0;
    hazeUniform.value = 0;
    dockGlowUniform.value = 0;
    streakGlowUniform.value = 0.4;
  });

  bus.on('runend', () => {
    resetCameraState(cameraFeel);
  });
}

function resetCameraState(cameraFeel: CameraFeelRig) {
  lastRunTime = -1;
  cameraRoll = 0;
  cameraFovOffset = 0;
  cameraFeel.restore();
}

// ---- per-frame update ------------------------------------------------------

export function updateVisuals(dt: number, ctx: VisualContext) {
  elapsedNow = ctx.elapsed;
  beatEnergy = Math.max(0, beatEnergy - dt * 4.2);
  surgePulse = Math.max(0, surgePulse - dt * 0.85);
  beatUniform.value = beatEnergy;

  const runTime = ctx.running ? ctx.runTime : 0;
  const progress = ctx.running ? skyhookRunProgress(runTime) : 0;
  const speed = ctx.running ? speedFactorAt(runTime) : 0.6;

  updateSetPieceMoments(ctx);
  updateEnvironmentFrame(dt, ctx, speed, runTime, progress);
  updatePostUniforms(dt, ctx, runTime, progress);

  for (const [enemyId, record] of enemyRecords.entries()) {
    if (!record.mesh.parent) {
      enemyRecords.delete(enemyId, { dispose: true });
      continue;
    }
    if (record.bornAt === null) record.bornAt = elapsedNow;
    const age = elapsedNow - record.bornAt;
    if (record.mesh.userData.isBoss) {
      const grow = easeOutBack(Math.min(1, age / 0.7));
      record.mesh.scale.setScalar(grow * ((record.mesh.userData.bossScale as number | undefined) ?? 1));
    } else if (record.mesh.userData.kind !== 'letter') {
      record.mesh.scale.setScalar(easeOutBack(Math.min(1, age / 0.4)));
    }

    updateEnemyTint(record, ctx);

    if (record.mesh.userData.isHostileShot) {
      dropTrail(record.mesh.position, record.mesh.userData.trailColor as Color);
    }

    if (record.lockRing) {
      record.mesh.getWorldPosition(record.lockRing.position);
      record.lockRing.quaternion.copy((ctx.camera as PerspectiveCamera).quaternion);
      record.lockRing.rotation.z += dt * 2.2;
      const pulse = 1 + Math.sin(elapsedNow * 9) * 0.05;
      const fit = (record.mesh.userData.isBoss ? (record.mesh.userData.bossScale as number | undefined) ?? 1 : 1);
      record.lockRing.scale.setScalar(pulse * 1.9 * fit);
    }
  }

  for (const [projectileId, record] of projectileRecords.entries()) {
    if (!record.mesh.parent) {
      projectileRecords.delete(projectileId);
      continue;
    }
    dropTrail(record.mesh.position, record.trailColor);
  }

  const reticleSpinner = findReticleSpinner(ctx.scene);
  if (reticleSpinner) {
    const active = reticleSpinner.parent?.userData.active === true;
    reticleSpinner.rotation.z += dt * (active ? 4.2 : 1.0);
    const brackets = reticleSpinner.parent?.userData.brackets as Group | undefined;
    if (brackets) brackets.rotation.z -= dt * (active ? 2.6 : 0.6);
  }

  updateEffects(dt, ctx.camera);
}

// Cloud break and docking: detect the crossings and slam / soothe the senses.
function updateSetPieceMoments(ctx: VisualContext) {
  if (!ctx.running) {
    lastRunTime = -1;
    return;
  }
  const crossed = (t: number) => lastRunTime >= 0 && lastRunTime < t && ctx.runTime >= t;
  if (crossed(CLOUDBREAK_TIME)) {
    flashUniform.value = Math.max(flashUniform.value, 0.4);
    hazeUniform.value = Math.max(hazeUniform.value, 0.5);
    surgePulse = Math.max(surgePulse, 0.9);
    ctx.feel.shake(0.7, SKYHOOK_CAMERA_SHAKE);
    if (environment) {
      spawnRing(environment.cloudbreakPosition, hdr(PANEL, 1.2), 46, 1.0);
      for (let i = 0; i < 8; i += 1) {
        spawnPuff(
          environment.cloudbreakPosition.clone().add(new Vector3((Math.random() - 0.5) * 20, (Math.random() - 0.5) * 16, (Math.random() - 0.5) * 10)),
          hdr(PANEL, 0.7),
          6,
          30,
          0.9,
        );
      }
    }
  }
  lastRunTime = ctx.runTime;
}

export function updateCameraEffects(dt: number, ctx: CameraEffectsContext) {
  const runTime = ctx.running ? ctx.runTime : 0;
  const speed = ctx.running ? speedFactorAt(runTime) : 0.6;
  updateCameraFeel(dt, ctx, speed);
}

function updateCameraFeel(dt: number, ctx: CameraEffectsContext, speed: number) {
  if (!(ctx.camera instanceof PerspectiveCamera)) return;
  const camera = ctx.camera;

  const targetFovOffset = (speed - 0.9) * 8 + beatEnergy * 1.0 + surgePulse * 7;
  cameraFovOffset = MathUtils.lerp(cameraFovOffset, targetFovOffset, Math.min(1, dt * 6));

  if (ctx.running) {
    const u = skyhookRunProgress(ctx.runTime, SKYHOOK_GGL2_RUN_DURATION);
    const tangent = rail.getTangentAt(MathUtils.clamp(u, 0, 1));
    const ahead = rail.getTangentAt(MathUtils.clamp(u + 0.006, 0, 1));
    const targetRoll = MathUtils.clamp((ahead.x - tangent.x) * 26, -0.15, 0.15);
    cameraRoll += (targetRoll - cameraRoll) * Math.min(1, dt * 3.2);
    camera.rotateZ(cameraRoll);
  }

  ctx.feel.setFovOffset(cameraFovOffset);
  ctx.feel.update(dt, { shake: SKYHOOK_CAMERA_SHAKE });
}

function updateEnvironmentFrame(dt: number, ctx: VisualContext, speed: number, runTime: number, progress: number) {
  if (!environment) return;
  const camera = ctx.camera as PerspectiveCamera;

  environment.atmosphere(ctx.running ? progress : 0);
  altitudeUniform.value = progress;

  // Debris streaks ride the camera and stream downward as the world falls away.
  environment.streaks.position.copy(camera.position);
  environment.streaks.quaternion.copy(camera.quaternion);
  streakOffsetUniform.value = (streakOffsetUniform.value + dt * speed * 24) % 10000;
  const glowTarget = !ctx.running ? 0.15 : runTime < CLOUDBREAK_TIME ? 0.22 : runTime < THIN_TIME ? 0.45 : runTime < DOCK_TIME ? 0.4 : 0.12;
  streakGlowUniform.value += (glowTarget - streakGlowUniform.value) * Math.min(1, dt * 2);

  // Stars fade in as the sky darkens toward the top.
  const starMaterial = environment.stars.material as { opacity: number; transparent: boolean };
  const starTarget = ctx.running ? MathUtils.clamp((progress - railFor(THIN_TIME) + 0.05) * 3, 0, 1) : 0;
  starMaterial.opacity += (starTarget - starMaterial.opacity) * Math.min(1, dt * 1.5);
}

function railFor(time: number) {
  return skyhookRunProgress(time);
}

function updatePostUniforms(dt: number, ctx: VisualContext, runTime: number, progress: number) {
  flashUniform.value = Math.max(0, flashUniform.value - dt * (flashUniform.value > 0.7 ? 1.4 : 2.4));
  hazeUniform.value = Math.max(0, hazeUniform.value - dt * 0.9);

  // Docking: the station light swells and swallows the frame near the very top.
  const dockTarget = ctx.running && runTime >= DOCK_TIME ? MathUtils.clamp((progress - railFor(DOCK_TIME)) / Math.max(0.0001, 1 - railFor(DOCK_TIME)), 0, 1) : 0;
  dockGlowUniform.value += (Math.min(1, dockTarget * 1.3) - dockGlowUniform.value) * Math.min(1, dt * 2);
  dockUniform.value += (dockTarget * dockTarget * 0.5 - dockUniform.value) * Math.min(1, dt * 1.5);

  // Boss kill flash decays through the runtime already; a small settle here.
  if (bossKilledAt >= 0 && elapsedNow - bossKilledAt < 1.6) {
    const since = elapsedNow - bossKilledAt;
    flashUniform.value = Math.max(flashUniform.value, 0.4 * (1 - since / 1.6));
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

  const distance = record.mesh.position.distanceTo((ctx.camera as PerspectiveCamera).position);
  const closeness = smootherstep(1 - clamp01((distance - 16) / (60 - 16)));
  const locked = userData.locked === true;
  const damageFlash = (userData.damageFlashUntil as number | undefined ?? -Infinity) > elapsedNow;
  const bossExposed = userData.bossExposed === true;

  for (const part of parts) {
    if (denied) {
      part.material.color.copy(part.kind === 'fill' ? DENY_FILL : DENY_RED);
      continue;
    }
    if (locked) {
      if (part.kind === 'edge') part.material.color.copy(hdr(ICE, 1.6));
      else if (part.kind === 'fill') part.material.color.copy(ICE.clone().multiplyScalar(0.4));
      else part.material.color.copy(hdr(ICE_HOT, 2.0));
      continue;
    }
    if (damageFlash) {
      part.material.color.copy(hdr(STAR, part.kind === 'fill' ? 0.6 : 1.9));
      continue;
    }
    if (bossExposed && part.kind === 'core') {
      part.material.color.copy(hdr(WARN, 2.2 + Math.sin(elapsedNow * 8) * 0.5));
      continue;
    }
    const dim = part.kind === 'edge' ? 0.55 + 0.45 * closeness : part.kind === 'fill' ? 0.35 + 0.65 * closeness : 0.4 + 0.6 * closeness;
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
  const ring = new Mesh(new RingGeometry(0.86, 0.92, 4), createAdditiveBasicMaterial({ color: hdr(color, 1.8), side: DoubleSide }));
  ring.rotation.z = Math.PI / 4;
  const innerRing = new Mesh(new RingGeometry(0.66, 0.69, 24), createAdditiveBasicMaterial({ color: hdr(color.clone().lerp(ICE, 0.5), 1.4), side: DoubleSide }));
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
