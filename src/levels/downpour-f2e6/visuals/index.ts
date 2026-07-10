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
  configureAdditiveMaterial,
  createAdditiveBasicMaterial,
  createAdornmentSlot,
  createPendingVisualRecords,
  disposeObject3D,
} from '../../../engine/visual-kit';
import type { EventBus } from '../../../events';
import { createDownpourRail, DOWNPOUR_DURATION, downpourRunProgress, speedFactorAt } from '../gameplay';
import { CITADEL_TIME, OUTRO_TIME, PLUNGE_TIME, UNDERCITY_TIME } from '../timing';
import {
  burstShrapnel,
  burstSparks,
  createEffects,
  dropTrail,
  resetEffects,
  spawnGlint,
  spawnLightningLine,
  spawnRing,
  updateEffects,
} from './effects';
import { createBoltMesh, createGunshipMesh, createInterceptorMesh, createSentryMesh, createTrawlerMesh, type TintPart } from './enemies';
import {
  beatUniform,
  createEnvironmentInternal,
  lightningUniform,
  moonlightUniform,
  rainGlowUniform,
  rainOffsetUniform,
  type Environment,
} from './environment';
import { createLetterMesh, setLetterDenied, setLetterLocked } from './letters';
import { flashUniform } from './post-fx';
import { ACID_GREEN, AMBER, CYAN, DRONE_WHITE, hdr, HAZARD_WHITE, LIGHTNING, LOCK_GRADIENT, MAGENTA, MOONLIGHT, RAIN_BLACK, SLATE } from './palette';

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

const DENY_RED = new Color(1.6, 0.1, 0.05);
const DENY_FILL = new Color(0.3, 0.02, 0.01);

let environment: Environment | null = null;
let beatEnergy = 0;
let cameraRoll = 0;
let cameraFovOffset = 0;
let surgePulse = 0;
let elapsedNow = 0;
let lastRunTime = -1;

const DOWNPOUR_SHAKE: CameraFeelShakeOptions = {
  decay: 3.0,
  maxTrauma: 1.7,
  pitchDegrees: 0.32,
  yawDegrees: 0.26,
  rollDegrees: 0.68,
  frequency: 10,
  smoothing: 22,
};

const rail = createDownpourRail();

const lockRings = createAdornmentSlot<EnemyRecord, Group>({
  get: (record) => record.lockRing,
  set: (record, ring) => {
    record.lockRing = ring;
  },
});

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
      return createLetterMesh(letter ?? 'L');
    case 'interceptor':
      return createInterceptorMesh();
    case 'sentry':
      return createSentryMesh();
    case 'trawler':
      return createTrawlerMesh();
    case 'bolt':
      return createBoltMesh();
    case 'gunship':
      return createGunshipMesh();
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
  spawnRing(mesh.position, DENY_RED.clone(), 2.4, 0.3);
}

// The courier's own dart: cold electric white, distinct from every hostile.
export function createProjectileMesh() {
  const group = new Group();
  const core = new Mesh(
    scaledOctahedron(0.3, 0.45, 0.45, 2.1),
    new MeshBasicMaterial({ color: hdr(DRONE_WHITE, 2.6) }),
  );
  group.add(core);
  const shell = new Mesh(
    scaledOctahedron(0.48, 0.55, 0.55, 1.85),
    createAdditiveBasicMaterial({ color: hdr(CYAN, 1.0), opacity: 0.5 }),
  );
  group.add(shell);
  projectileRecords.enqueue({ mesh: group, trailColor: DRONE_WHITE.clone().multiplyScalar(0.9) });
  return group;
}

function scaledOctahedron(radius: number, sx: number, sy: number, sz: number) {
  const geometry = new OctahedronGeometry(radius, 0);
  geometry.scale(sx, sy, sz);
  return geometry;
}

// ---- reticle: a rectangular scanner, reading the city's own signage grid ------

export function createReticle() {
  const group = new Group();
  const parts: Array<{ material: MeshBasicMaterial; base: Color }> = [];

  const addPart = (mesh: Mesh, base: Color) => {
    const material = configureAdditiveMaterial(mesh.material as MeshBasicMaterial, { color: base, side: DoubleSide });
    parts.push({ material, base });
  };

  const outer = new Mesh(new RingGeometry(0.6, 0.635, 4), new MeshBasicMaterial());
  outer.rotation.z = Math.PI / 4;
  addPart(outer, hdr(DRONE_WHITE, 1.1));

  const spinner = new Group();
  const cross = new Mesh(new RingGeometry(0.36, 0.39, 4), new MeshBasicMaterial());
  addPart(cross, hdr(DRONE_WHITE, 1.0));
  spinner.add(cross);

  const brackets = new Group();
  for (let i = 0; i < 4; i += 1) {
    const tick = new Mesh(new PlaneGeometry(0.16, 0.035), new MeshBasicMaterial());
    addPart(tick, hdr(DRONE_WHITE, 1.3));
    const angle = (i / 4) * Math.PI * 2;
    tick.position.set(Math.cos(angle) * 0.78, Math.sin(angle) * 0.78, 0);
    tick.rotation.z = angle + Math.PI / 2;
    brackets.add(tick);
  }

  const dot = new Mesh(new CircleGeometry(0.045, 12), new MeshBasicMaterial());
  addPart(dot, hdr(DRONE_WHITE, 2.0));

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

// ---- event wiring ---------------------------------------------------------------

export function installVisualEventHandlers(bus: EventBus, scene: Scene, cameraFeel: CameraFeelRig) {
  bus.on('spawn', ({ enemyId, kind, worldPosition }) => {
    const record = enemyRecords.claim(enemyId);
    if (!record) return;
    if (kind === 'gunship') {
      cameraFeel.shake(1.1, DOWNPOUR_SHAKE);
      surgePulse = Math.max(surgePulse, 0.5);
      spawnRing(worldPosition, hdr(ACID_GREEN, 1.2), 20, 0.8);
      spawnRing(worldPosition, hdr(HAZARD_WHITE, 0.9), 12, 0.6);
    } else if (kind !== 'bolt') {
      spawnRing(worldPosition, hdr(accentForKind(kind), 0.8), 2.4, 0.35);
    }
  });

  bus.on('lock', ({ enemyId, worldPosition, lockCount }) => {
    const lockColor = colorForLockCount(lockCount, LOCK_GRADIENT);
    const record = enemyRecords.get(enemyId);
    if (record && !record.lockRing) lockRings.attach(record, makeLockRing(lockColor), scene);
    spawnRing(worldPosition, hdr(lockColor, 1.4), 2, 0.26);
  });

  bus.on('unlock', ({ enemyId }) => {
    const record = enemyRecords.get(enemyId);
    if (record) lockRings.detach(record);
  });

  bus.on('fire', ({ projectileId, worldPosition }) => {
    projectileRecords.claim(projectileId);
    spawnGlint(worldPosition, hdr(DRONE_WHITE, 1.2), 0.45, 0.12);
  });

  bus.on('hit', ({ enemyId, projectileId, worldPosition, lethal }) => {
    projectileRecords.delete(projectileId, { dispose: true });
    burstSparks(worldPosition, hdr(DRONE_WHITE, 0.9), 5, 9, 4);
    const record = enemyRecords.get(enemyId);
    if (record && !lethal) {
      record.mesh.userData.damageFlashUntil = elapsedNow + 0.32;
      spawnGlint(worldPosition, hdr(DRONE_WHITE, 1.7), 1.0, 0.15);
    }
  });

  bus.on('stage', ({ enemyId, worldPosition }) => {
    const record = enemyRecords.get(enemyId);
    if (!record) return;
    if (record.mesh.userData.isGunship) {
      cameraFeel.shake(1.2, DOWNPOUR_SHAKE);
      surgePulse = Math.max(surgePulse, 0.55);
      flashUniform.value = Math.max(flashUniform.value, 0.4);
      const specs = record.mesh.userData.shardSpecs as ReturnType<typeof shardSpecsOf>;
      if (specs) burstShrapnel(worldPosition, specs.slice(0, 4));
      burstSparks(worldPosition, hdr(ACID_GREEN, 1.2), 16, 15, 6);
      spawnRing(worldPosition, hdr(ACID_GREEN, 1.4), 10, 0.6);
    }
  });

  bus.on('kill', ({ enemyId, worldPosition }) => {
    const record = enemyRecords.get(enemyId);
    if (record) {
      const specs = shardSpecsOf(record.mesh);
      if (specs) burstShrapnel(worldPosition, specs);
      const accent = (record.mesh.userData.accent as Color | undefined) ?? DRONE_WHITE;
      burstSparks(worldPosition, hdr(accent, 1.0), 8, 12);
      spawnRing(worldPosition, hdr(accent, 0.9), 4.2, 0.4);
      spawnGlint(worldPosition, hdr(DRONE_WHITE, 1.5), 1.1, 0.17);

      if (record.mesh.userData.isGunship) {
        cameraFeel.shake(1.7, DOWNPOUR_SHAKE);
        surgePulse = 1.0;
        flashUniform.value = Math.max(flashUniform.value, 1.1);
        spawnRing(worldPosition, hdr(ACID_GREEN, 1.5), 70, 1.4);
        spawnRing(worldPosition, hdr(HAZARD_WHITE, 1.2), 42, 1.0);
        burstSparks(worldPosition, hdr(ACID_GREEN, 1.3), 50, 28, 9);
      }

      enemyRecords.delete(enemyId, { dispose: true });
    }
  });

  bus.on('miss', ({ worldPosition }) => {
    burstSparks(worldPosition, DRONE_WHITE.clone().multiplyScalar(0.35), 3, 3, 2);
  });

  bus.on('volley', ({ size, kills }) => {
    if (size >= 5 && kills === size) {
      beatEnergy = Math.max(beatEnergy, 1.4);
      flashUniform.value = Math.max(flashUniform.value, 0.2);
    }
  });

  bus.on('beat', ({ isDownbeat }) => {
    beatEnergy = Math.max(beatEnergy, isDownbeat ? 1 : 0.4);
  });

  bus.on('playerhit', () => {
    beatEnergy = 1.4;
    cameraFeel.shake(1.2, DOWNPOUR_SHAKE);
  });

  bus.on('runstart', () => {
    resetEffects();
    enemyRecords.clear({ dispose: true, pending: true });
    projectileRecords.clear({ dispose: true, pending: true });
    resetCameraFeel(cameraFeel);
    flashUniform.value = 0;
    lightningUniform.value = 0;
    moonlightUniform.value = 0;
    surgePulse = 0;
    lastRunTime = -1;
  });

  bus.on('runend', () => {
    resetCameraFeel(cameraFeel);
  });
}

function accentForKind(kind: string): Color {
  switch (kind) {
    case 'interceptor':
      return MAGENTA;
    case 'sentry':
      return HAZARD_WHITE;
    case 'trawler':
      return AMBER;
    default:
      return DRONE_WHITE;
  }
}

function shardSpecsOf(mesh: Object3D) {
  return mesh.userData.shardSpecs as Array<{ direction: Vector3; color: Color; size: number }> | undefined;
}

// ---- per-frame update -------------------------------------------------------------

function resetCameraFeel(cameraFeel: CameraFeelRig) {
  cameraRoll = 0;
  cameraFovOffset = 0;
  cameraFeel.restore();
}

export function updateVisuals(dt: number, ctx: VisualContext) {
  elapsedNow = ctx.elapsed;
  beatEnergy = Math.max(0, beatEnergy - dt * 4);
  surgePulse = Math.max(0, surgePulse - dt * 0.8);
  beatUniform.value = beatEnergy;

  const runTime = ctx.running ? ctx.runTime : 0;
  const speed = ctx.running ? speedFactorAt(runTime) : 0.45;

  updateSetPieceMoments(ctx);
  updateEnvironmentFrame(dt, ctx, speed, runTime);
  updatePostUniforms(dt);

  for (const [enemyId, record] of enemyRecords.entries()) {
    if (!record.mesh.parent) {
      enemyRecords.delete(enemyId, { dispose: true });
      continue;
    }
    if (record.bornAt === null) record.bornAt = elapsedNow;
    const age = elapsedNow - record.bornAt;
    record.mesh.scale.setScalar(easeOutBack(Math.min(1, age / 0.36)) * (1 - (record.mesh.userData.fadeOut as number ?? 0)));

    updateEnemyTint(record, ctx);

    if (record.mesh.userData.isHostileShot) {
      dropTrail(record.mesh.position, record.mesh.userData.trailColor as Color);
    }

    if (record.lockRing) {
      record.mesh.getWorldPosition(record.lockRing.position);
      record.lockRing.quaternion.copy((ctx.camera as PerspectiveCamera).quaternion);
      record.lockRing.rotation.z += dt * 2.2;
      const pulse = 1 + Math.sin(elapsedNow * 9) * 0.05;
      const fit = (record.mesh.userData.lockRingScale as number | undefined) ?? 1;
      record.lockRing.scale.setScalar(pulse * 1.85 * fit);
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
    reticleSpinner.rotation.z += dt * (active ? 4.4 : 1.1);
    const brackets = reticleSpinner.parent?.userData.brackets as Group | undefined;
    if (brackets) brackets.rotation.z -= dt * (active ? 2.8 : 0.65);
  }

  updateEffects(dt, ctx.camera);
}

// Drop 1 (tower plunge) and drop 2 (undercity plunge) land as lightning /
// impact flashes, matched to the music's drops.
function updateSetPieceMoments(ctx: VisualContext) {
  if (!ctx.running) {
    lastRunTime = -1;
    return;
  }
  const crossed = (t: number) => lastRunTime >= 0 && lastRunTime < t && ctx.runTime >= t;
  if (crossed(PLUNGE_TIME) && environment) {
    flashUniform.value = Math.max(flashUniform.value, 0.85);
    lightningUniform.value = 1;
    surgePulse = Math.max(surgePulse, 1.0);
    ctx.feel.shake(0.9, DOWNPOUR_SHAKE);
    const from = environment.stormCloudPosition;
    const to = from.clone().add(new Vector3((Math.random() - 0.5) * 30, -50, (Math.random() - 0.5) * 20));
    spawnLightningLine(from, to, LIGHTNING);
    spawnRing(to, hdr(LIGHTNING, 1.3), 40, 0.7);
  }
  if (crossed(UNDERCITY_TIME) && environment) {
    flashUniform.value = Math.max(flashUniform.value, 0.7);
    surgePulse = Math.max(surgePulse, 0.9);
    ctx.feel.shake(0.85, DOWNPOUR_SHAKE);
    spawnRing(environment.cloudBreakPosition.clone().setZ(-720), hdr(AMBER, 1.2), 32, 0.6);
  }
  lastRunTime = ctx.runTime;
}

export function updateCameraEffects(dt: number, ctx: CameraEffectsContext) {
  const runTime = ctx.running ? ctx.runTime : 0;
  const speed = ctx.running ? speedFactorAt(runTime) : 0.45;
  updateCameraFeel(dt, ctx, speed);
}

function updateCameraFeel(dt: number, ctx: CameraEffectsContext, speed: number) {
  if (!(ctx.camera instanceof PerspectiveCamera)) return;
  const camera = ctx.camera;

  const targetFovOffset = (speed - 0.8) * 8 + beatEnergy * 1.0 + surgePulse * 6.5;
  cameraFovOffset = MathUtils.lerp(cameraFovOffset, targetFovOffset, Math.min(1, dt * 6));

  if (ctx.running) {
    const u = downpourRunProgress(ctx.runTime, DOWNPOUR_DURATION);
    const tangent = rail.getTangentAt(MathUtils.clamp(u, 0, 1));
    const ahead = rail.getTangentAt(MathUtils.clamp(u + 0.006, 0, 1));
    const targetRoll = MathUtils.clamp((ahead.x - tangent.x) * 28, -0.15, 0.15);
    cameraRoll += (targetRoll - cameraRoll) * Math.min(1, dt * 3.2);
    camera.rotateZ(cameraRoll);
  }

  ctx.feel.setFovOffset(cameraFovOffset);
  ctx.feel.update(dt, { shake: DOWNPOUR_SHAKE });
}

function updateEnvironmentFrame(dt: number, ctx: VisualContext, speed: number, runTime: number) {
  if (!environment) return;

  rainOffsetUniform.value += dt * speed * 24;
  const inCitadel = runTime >= CITADEL_TIME;
  const targetRainGlow = !ctx.running ? 0.3 : inCitadel ? 0.75 : 0.5;
  rainGlowUniform.value += (targetRainGlow - rainGlowUniform.value) * Math.min(1, dt * 2);

  const moonlightTarget = ctx.running && runTime >= OUTRO_TIME ? MathUtils.clamp((runTime - OUTRO_TIME) / 3, 0, 1) : 0;
  moonlightUniform.value += (moonlightTarget - moonlightUniform.value) * Math.min(1, dt * 1.5);

  const targetBackground = backgroundForRunTime(ctx.running, runTime);
  (ctx.scene.background as Color).lerp(targetBackground, Math.min(1, dt * 0.9));
}

function backgroundForRunTime(running: boolean, runTime: number): Color {
  if (!running) return RAIN_BLACK;
  if (runTime < PLUNGE_TIME) return RAIN_BLACK;
  if (runTime < UNDERCITY_TIME) return SLATE.clone().multiplyScalar(0.5);
  if (runTime < CITADEL_TIME) return new Color(0.03, 0.02, 0.015);
  if (runTime < OUTRO_TIME) return new Color(0.02, 0.025, 0.035);
  return MOONLIGHT.clone().multiplyScalar(0.16);
}

function updatePostUniforms(dt: number) {
  flashUniform.value = Math.max(0, flashUniform.value - dt * (flashUniform.value > 0.7 ? 1.6 : 2.6));
  lightningUniform.value = Math.max(0, lightningUniform.value - dt * 1.1);
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
  const closeness = smootherstep(1 - clamp01((distance - 14) / (50 - 14)));
  const locked = userData.locked === true;
  const damageFlash = (userData.damageFlashUntil as number | undefined ?? -Infinity) > elapsedNow;
  const stage = (userData.stage as number | undefined) ?? 0;

  for (const part of parts) {
    if (denied) {
      part.material.color.copy(part.kind === 'fill' ? DENY_FILL : DENY_RED);
      continue;
    }
    if (locked) {
      if (part.kind === 'edge') part.material.color.copy(hdr(DRONE_WHITE, 1.6));
      else if (part.kind === 'fill') part.material.color.copy(CYAN.clone().multiplyScalar(0.3));
      else part.material.color.copy(hdr(DRONE_WHITE, 2.0));
      continue;
    }
    if (damageFlash) {
      part.material.color.copy(hdr(DRONE_WHITE, part.kind === 'fill' ? 0.45 : 1.8));
      continue;
    }
    let dim = part.kind === 'edge' ? 0.55 + 0.45 * closeness : part.kind === 'fill' ? 0.3 + 0.7 * closeness : 0.35 + 0.65 * closeness;
    if (userData.isGunship && part.kind === 'core') dim *= 1 + stage * 0.35;
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
  const ring = new Mesh(
    new RingGeometry(0.84, 0.9, 4),
    createAdditiveBasicMaterial({ color: hdr(color, 1.8), side: DoubleSide }),
  );
  ring.rotation.z = Math.PI / 4;
  const innerRing = new Mesh(
    new RingGeometry(0.64, 0.67, 32),
    createAdditiveBasicMaterial({ color: hdr(color.clone().lerp(DRONE_WHITE, 0.55), 1.4), side: DoubleSide }),
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
