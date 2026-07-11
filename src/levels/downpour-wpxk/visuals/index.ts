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
  disposeObject3D,
} from '../../../engine/visual-kit';
import type { EventBus } from '../../../events';
import {
  CANAL_TIME,
  createDownpourRail,
  downpourRunProgress,
  DOWNPOUR_DURATION,
  HUNT_TIME,
  PLUNGE_TIME,
  speedFactorAt,
  SUMMIT_TIME,
  UNDERCITY_TIME,
} from '../gameplay';
import { DOWNPOUR_TIME, LIGHTNING_BARS } from '../timing';
import {
  breakEnforcerArmor,
  breakGunshipStage,
  createDroneMesh,
  createEnforcerMesh,
  createGunshipMesh,
  createSentryMesh,
  createSkimmerMesh,
  createTracerMesh,
  type TintPart,
} from './enemies';
import {
  beatUniform,
  createEnvironmentInternal,
  lightningUniform,
  rainGlowUniform,
  rainOffsetUniform,
  type Environment,
} from './environment';
import {
  burstDebris,
  burstSparks,
  createEffects,
  dropTrail,
  resetEffects,
  spawnGlint,
  spawnRing,
  spawnSplash,
  updateEffects,
  type DebrisSpec,
} from './effects';
import { createLetterMesh, setLetterDenied, setLetterLocked } from './letters';
import { ACID, CYAN, DENY_RED, hdr, LOCK_GRADIENT, MAGENTA, MOON, SLATE } from './palette';
import { flashUniform } from './post-fx';

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

const DENY_HOT = hdr(DENY_RED, 1.6);
const DENY_FILL = new Color(0.28, 0.02, 0.03);

let environment: Environment | null = null;
let beatEnergy = 0;
let cameraRoll = 0;
let cameraFovOffset = 0;
let surgePulse = 0;
let elapsedNow = 0;
let lastRunTime = -1;
let nextLightning = 0;
let attractLightningAt = 6;
let gunshipKilledAt = -1;

const DOWNPOUR_CAMERA_SHAKE: CameraFeelShakeOptions = {
  decay: 2.8,
  maxTrauma: 1.7,
  pitchDegrees: 0.34,
  yawDegrees: 0.3,
  rollDegrees: 0.7,
  frequency: 9,
  smoothing: 20,
};

const rail = createDownpourRail();
const LIGHTNING_TIMES = LIGHTNING_BARS.map((atBar) => DOWNPOUR_TIME.bar(atBar));

const lockRings = createAdornmentSlot<EnemyRecord, Group>({
  get: (record) => record.lockRing,
  set: (record, ring) => {
    record.lockRing = ring;
  },
});

// createEnemyMesh() has no id, but the game emits `spawn` synchronously right
// after calling it — pairing the queue with spawn events links mesh to id.
const enemyRecords = createPendingVisualRecords<Group, EnemyRecord>({
  createRecord: (mesh) => ({ mesh, bornAt: null, lockRing: null }),
  disposeRecord: (record) => {
    lockRings.detach(record);
    // The engine has already pulled the mesh from the scene by the time a
    // record is disposed; free its GPU geometry so long runs don't accrete.
    record.mesh.removeFromParent();
    disposeObject3D(record.mesh);
  },
});
const projectileRecords = createPendingVisualRecords<ProjectileRecord, ProjectileRecord>({
  createRecord: (record) => record,
  disposeRecord: (record) => {
    record.mesh.removeFromParent();
    disposeObject3D(record.mesh);
  },
});

export function createEnvironment(scene: Scene) {
  scene.background = BG_CEILING.clone();
  environment = createEnvironmentInternal(scene);
  createEffects(scene);
  return environment.root;
}

export function createEnemyMesh(kind: string, letter?: string) {
  const mesh = buildEnemyMesh(kind, letter);
  mesh.userData.kind = kind;
  mesh.traverse((child) => {
    if (!child.name) child.name = kind;
  });
  mesh.scale.setScalar(0.001);
  enemyRecords.enqueue(mesh);
  return mesh;
}

function buildEnemyMesh(kind: string, letter?: string): Group {
  switch (kind) {
    case 'letter':
      return createLetterMesh(letter ?? 'I');
    case 'drone':
      return createDroneMesh();
    case 'skimmer':
      return createSkimmerMesh();
    case 'sentry':
      return createSentryMesh();
    case 'enforcer':
      return createEnforcerMesh();
    case 'tracer':
      return createTracerMesh();
    case 'gunship':
      return createGunshipMesh();
    default:
      return createDroneMesh();
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
  spawnRing(mesh.position, DENY_HOT.clone(), 2.6, 0.3);
}

// Player shot: a sliver of moonlight — the one clean, cold light in the rain.
export function createProjectileMesh() {
  const group = new Group();
  const coreGeometry = new OctahedronGeometry(0.32, 0);
  coreGeometry.scale(0.42, 0.42, 2.3);
  group.add(new Mesh(coreGeometry, new MeshBasicMaterial({ color: hdr(MOON, 2.6) })));
  const shellGeometry = new OctahedronGeometry(0.5, 0);
  shellGeometry.scale(0.55, 0.55, 1.9);
  group.add(new Mesh(shellGeometry, createAdditiveBasicMaterial({ color: hdr(CYAN, 1.0), opacity: 0.5 })));
  projectileRecords.enqueue({ mesh: group, trailColor: CYAN.clone().multiplyScalar(0.85) });
  return group;
}

// ---- reticle -------------------------------------------------------------------

// A courier's rain-swept sight: a thin outer dial, a wiper blade that sweeps
// harder as the charge builds, and four droplet ticks.
export function createReticle() {
  const group = new Group();
  const parts: Array<{ material: MeshBasicMaterial; base: Color }> = [];

  const addPart = (mesh: Mesh, base: Color) => {
    const material = configureAdditiveMaterial(mesh.material as MeshBasicMaterial, { color: base, side: DoubleSide });
    parts.push({ material, base });
  };

  const outer = new Mesh(new RingGeometry(0.62, 0.652, 48), new MeshBasicMaterial());
  addPart(outer, hdr(CYAN, 1.15));

  const wiper = new Group();
  const blade = new Mesh(new PlaneGeometry(0.5, 0.035), new MeshBasicMaterial());
  addPart(blade, hdr(MOON, 1.4));
  blade.position.x = 0.31;
  wiper.add(blade);

  const droplets = new Group();
  for (let i = 0; i < 4; i += 1) {
    const tick = new Mesh(new CircleGeometry(0.038, 10), new MeshBasicMaterial());
    addPart(tick, hdr(CYAN, 1.35));
    const angle = (i / 4) * Math.PI * 2 + Math.PI / 4;
    tick.position.set(Math.cos(angle) * 0.8, Math.sin(angle) * 0.8, 0);
    droplets.add(tick);
  }

  const dot = new Mesh(new CircleGeometry(0.05, 18), new MeshBasicMaterial());
  addPart(dot, hdr(MOON, 2.0));

  group.add(outer, wiper, droplets, dot);
  group.userData.parts = parts;
  group.userData.spinner = wiper;
  group.userData.brackets = droplets;
  group.userData.active = false;
  return group;
}

export function setReticleActive(reticle: Object3D, active: boolean, lockCount: number) {
  reticle.userData.active = active;
  reticle.scale.setScalar(1 + lockCount * 0.075 + (active ? 0.05 : 0));
  const parts = reticle.userData.parts as Array<{ material: MeshBasicMaterial; base: Color }>;
  // Charging walks the sight cyan → moonlight → magenta: the sixth lock reads
  // as a whole signage board igniting.
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
    if (kind === 'gunship') {
      // The hunter drops out of the storm: acid ring, thunder-shake, flash.
      cameraFeel.shake(1.1, DOWNPOUR_CAMERA_SHAKE);
      surgePulse = Math.max(surgePulse, 0.5);
      lightningUniform.value = Math.max(lightningUniform.value, 0.9);
      flashUniform.value = Math.max(flashUniform.value, 0.35);
      spawnRing(worldPosition, hdr(ACID, 1.3), 22, 0.9);
      spawnRing(worldPosition, hdr(ACID, 0.9), 12, 0.6);
    } else if (kind !== 'tracer') {
      spawnRing(worldPosition, hdr(CYAN, 0.8), 2.4, 0.35);
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
    spawnGlint(worldPosition, hdr(MOON, 1.2), 0.5, 0.12);
  });

  bus.on('hit', ({ enemyId, projectileId, worldPosition, lethal }) => {
    projectileRecords.delete(projectileId, { dispose: true });
    burstSparks(worldPosition, hdr(MOON, 0.9), 5, 9);
    const record = enemyRecords.get(enemyId);
    if (record && !lethal) {
      record.mesh.userData.damageFlashUntil = elapsedNow + 0.35;
      spawnGlint(worldPosition, hdr(MOON, 1.5), 0.9, 0.16);
    }
  });

  bus.on('stage', ({ enemyId, stageIndex, worldPosition }) => {
    const record = enemyRecords.get(enemyId);
    if (!record) return;
    if (record.mesh.userData.kind === 'enforcer') {
      breakEnforcerArmor(record.mesh);
      const specs = record.mesh.userData.debrisSpecs as DebrisSpec[] | undefined;
      if (specs) burstDebris(worldPosition, specs.slice(0, 5));
      burstSparks(worldPosition, hdr(MAGENTA, 0.9), 10, 12);
      spawnRing(worldPosition, hdr(MAGENTA, 1.1), 4.2, 0.45);
    } else if (record.mesh.userData.kind === 'gunship') {
      breakGunshipStage(record.mesh, stageIndex);
      cameraFeel.shake(0.9, DOWNPOUR_CAMERA_SHAKE);
      surgePulse = Math.max(surgePulse, 0.45);
      const specs = record.mesh.userData.debrisSpecs as DebrisSpec[] | undefined;
      if (specs) burstDebris(worldPosition, specs.slice(0, 6));
      spawnRing(worldPosition, hdr(ACID, 1.4), 16, 0.7);
      burstSparks(worldPosition, hdr(ACID, 1.1), 20, 18);
    }
  });

  bus.on('kill', ({ enemyId, worldPosition }) => {
    const record = enemyRecords.get(enemyId);
    if (record) {
      const specs = record.mesh.userData.debrisSpecs as DebrisSpec[] | undefined;
      if (specs) burstDebris(worldPosition, specs);
      const accent = (record.mesh.userData.accent as Color | undefined) ?? CYAN;
      burstSparks(worldPosition, hdr(accent, 1.0), 8, 12);
      spawnRing(worldPosition, hdr(accent, 0.9), 4.4, 0.4);
      spawnGlint(worldPosition, hdr(MOON, 1.3), 1.0, 0.18);
      // Anything downed low over the flooded canal throws up a ripple.
      if (worldPosition.y < 2 && worldPosition.y > -10) {
        spawnSplash(new Vector3(worldPosition.x, -7.5, worldPosition.z), hdr(accent, 0.7), 0.6);
      }

      if (record.mesh.userData.kind === 'gunship') {
        // The kill the hunt is built around: the storm itself answers.
        gunshipKilledAt = elapsedNow;
        cameraFeel.shake(1.7, DOWNPOUR_CAMERA_SHAKE);
        surgePulse = 1.0;
        flashUniform.value = Math.max(flashUniform.value, 1.0);
        lightningUniform.value = 1.2;
        spawnRing(worldPosition, hdr(ACID, 1.5), 60, 1.4);
        spawnRing(worldPosition, hdr(MOON, 1.2), 36, 1.0);
        spawnRing(worldPosition, hdr(MAGENTA, 1.0), 20, 0.8);
        spawnGlint(worldPosition, hdr(MOON, 2.4), 6, 0.5);
        burstSparks(worldPosition, hdr(ACID, 1.2), 46, 28, 6);
      }

      enemyRecords.delete(enemyId, { dispose: true });
    }
  });

  bus.on('miss', ({ enemyId, worldPosition }) => {
    const record = enemyRecords.get(enemyId);
    if (record) {
      enemyRecords.delete(enemyId, { dispose: true });
    }
    burstSparks(worldPosition, SLATE.clone().multiplyScalar(0.8), 3, 3, 4);
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
    beatEnergy = 1.5;
    cameraFeel.shake(1.3, DOWNPOUR_CAMERA_SHAKE);
  });

  bus.on('runstart', () => {
    resetEffects();
    enemyRecords.clear({ dispose: true, pending: true });
    projectileRecords.clear({ dispose: true, pending: true });
    resetCameraFeel(cameraFeel);
    flashUniform.value = 0;
    lightningUniform.value = 0;
    surgePulse = 0;
    nextLightning = 0;
    gunshipKilledAt = -1;
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

  updateLightning(dt, ctx);
  updateSetPieceMoments(ctx);
  updateEnvironmentFrame(dt, ctx, speed, runTime);

  flashUniform.value = Math.max(0, flashUniform.value - dt * (flashUniform.value > 0.7 ? 1.6 : 2.6));
  // Afterglow while the wreck falls: a dimming strike-light.
  if (gunshipKilledAt >= 0 && elapsedNow - gunshipKilledAt < 2.2) {
    flashUniform.value = Math.max(flashUniform.value, 0.35 * (1 - (elapsedNow - gunshipKilledAt) / 2.2));
  }

  for (const [enemyId, record] of enemyRecords.entries()) {
    if (!record.mesh.parent) {
      enemyRecords.delete(enemyId, { dispose: true });
      continue;
    }
    if (record.bornAt === null) record.bornAt = elapsedNow;
    const age = elapsedNow - record.bornAt;
    record.mesh.scale.setScalar(easeOutBack(Math.min(1, age / 0.4)));

    updateEnemyTint(record, ctx);

    const spinParts = record.mesh.userData.spinParts as Mesh[] | undefined;
    if (spinParts) {
      for (const part of spinParts) part.rotation.z += dt * (part.userData.spinSpeed as number);
    }

    // Sentry firing telegraph: the hazard strobe ring snaps hot and flickers.
    const strobeParts = record.mesh.userData.strobeParts as MeshBasicMaterial[] | undefined;
    if (strobeParts) {
      const telegraph = record.mesh.userData.telegraph === true;
      for (const material of strobeParts) {
        if (telegraph) {
          material.color.copy(DENY_HOT).multiplyScalar(1.1 + Math.sin(elapsedNow * 34) * 0.45);
        } else {
          material.color.copy(hdr(MOON, 0.8));
        }
      }
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

  const reticleWiper = findReticleWiper(ctx.scene);
  if (reticleWiper) {
    const active = reticleWiper.parent?.userData.active === true;
    // The wiper sweeps like a metronome arm; it works harder while charging.
    reticleWiper.rotation.z += dt * (active ? 5.2 : 1.4);
    const droplets = reticleWiper.parent?.userData.brackets as Group | undefined;
    if (droplets) droplets.rotation.z -= dt * (active ? 2.6 : 0.6);
  }

  updateEffects(dt, ctx.camera);
}

// Authored lightning: driven from the same bar table the thunder plays from.
function updateLightning(dt: number, ctx: VisualContext) {
  lightningUniform.value = Math.max(0, lightningUniform.value - dt * 2.2);

  if (!ctx.running) {
    // Attract mode: distant strikes keep the storm alive on the menu.
    if (ctx.elapsed >= attractLightningAt) {
      attractLightningAt = ctx.elapsed + 5 + Math.random() * 6;
      lightningUniform.value = 0.55;
      flashUniform.value = Math.max(flashUniform.value, 0.12);
    }
    return;
  }

  while (nextLightning < LIGHTNING_TIMES.length && ctx.runTime >= LIGHTNING_TIMES[nextLightning]) {
    const strike = LIGHTNING_TIMES[nextLightning];
    const isDrop = Math.abs(strike - PLUNGE_TIME) < 0.01
      || Math.abs(strike - UNDERCITY_TIME) < 0.01
      || Math.abs(strike - CANAL_TIME) < 0.01;
    lightningUniform.value = isDrop ? 1.2 : 0.8;
    flashUniform.value = Math.max(flashUniform.value, isDrop ? 0.55 : 0.28);
    ctx.feel.shake(isDrop ? 0.5 : 0.25, DOWNPOUR_CAMERA_SHAKE);
    nextLightning += 1;
  }
}

// The two descents and the canal breach: detect the crossing, slam the senses.
function updateSetPieceMoments(ctx: VisualContext) {
  if (!ctx.running) {
    lastRunTime = -1;
    return;
  }
  const crossed = (t: number) => lastRunTime >= 0 && lastRunTime < t && ctx.runTime >= t;
  if (crossed(PLUNGE_TIME) || crossed(UNDERCITY_TIME)) {
    surgePulse = Math.max(surgePulse, 1.0);
    ctx.feel.shake(0.85, DOWNPOUR_CAMERA_SHAKE);
  }
  if (crossed(CANAL_TIME)) {
    surgePulse = Math.max(surgePulse, 0.8);
    ctx.feel.shake(0.6, DOWNPOUR_CAMERA_SHAKE);
  }
  if (crossed(SUMMIT_TIME)) {
    // Punching through the cloud deck into moonlight.
    flashUniform.value = Math.max(flashUniform.value, 0.45);
    surgePulse = Math.max(surgePulse, 0.7);
  }
  lastRunTime = ctx.runTime;
}

export function updateCameraEffects(dt: number, ctx: CameraEffectsContext) {
  const speed = ctx.running ? speedFactorAt(ctx.runTime) : 0.5;
  if (!(ctx.camera instanceof PerspectiveCamera)) return;

  // FOV breathes with airspeed and kicks on the drops.
  const targetFovOffset = (speed - 0.8) * 9 + beatEnergy * 1.0 + surgePulse * 7;
  cameraFovOffset = MathUtils.lerp(cameraFovOffset, targetFovOffset, Math.min(1, dt * 6));

  if (ctx.running) {
    // Bank into the rail's turns; cosmetic, applied after the runner's lookAt.
    const u = downpourRunProgress(ctx.runTime, DOWNPOUR_DURATION);
    const tangent = rail.getTangentAt(MathUtils.clamp(u, 0, 1));
    const ahead = rail.getTangentAt(MathUtils.clamp(u + 0.006, 0, 1));
    const targetRoll = MathUtils.clamp((ahead.x - tangent.x) * 30, -0.17, 0.17);
    cameraRoll += (targetRoll - cameraRoll) * Math.min(1, dt * 3.2);
    ctx.camera.rotateZ(cameraRoll);
  }

  ctx.feel.setFovOffset(cameraFovOffset);
  ctx.feel.update(dt, { shake: DOWNPOUR_CAMERA_SHAKE });
}

function updateEnvironmentFrame(dt: number, ctx: VisualContext, speed: number, runTime: number) {
  if (!environment) return;

  const camera = ctx.camera as PerspectiveCamera;
  const u = ctx.running ? downpourRunProgress(runTime) : 0.02;

  // Rain rides the eye; its scroll rate is the felt airspeed. It thins to a
  // drizzle above the cloud deck at the summit.
  environment.rain.position.copy(camera.position);
  environment.rain.quaternion.copy(camera.quaternion);
  rainOffsetUniform.value = (rainOffsetUniform.value + dt * (14 + speed * 22)) % 10000;
  const act = actAt(ctx.running, runTime);
  const rainTarget = act === 5 ? 0.08 : act <= 0 ? 0.42 : act === 3 || act === 4 ? 0.5 : 0.34;
  rainGlowUniform.value += (rainTarget - rainGlowUniform.value) * Math.min(1, dt * 1.6);

  // The city's light follows the districts: slate ceiling, ink canyons,
  // sodium undercity, blue-black canal, moonlit navy at the summit.
  const targetBackground = act <= 0
    ? BG_CEILING
    : act === 1
      ? BG_STREETS
      : act === 2
        ? BG_UNDERCITY
        : act === 3 || act === 4
          ? BG_CANAL
          : BG_SUMMIT;
  (ctx.scene.background as Color).lerp(targetBackground, Math.min(1, dt * 0.9));

  environment.update(u, dt, ctx.elapsed, speed, ctx.running);
}

function actAt(running: boolean, runTime: number) {
  if (!running) return -1;
  if (runTime < PLUNGE_TIME) return 0;
  if (runTime < UNDERCITY_TIME) return 1;
  if (runTime < CANAL_TIME) return 2;
  if (runTime < HUNT_TIME) return 3;
  if (runTime < SUMMIT_TIME) return 4;
  return 5;
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

  // Distance falloff keeps far additive stacks from blobbing under bloom —
  // the storm haze dims everything with range.
  const distance = record.mesh.position.distanceTo((ctx.camera as PerspectiveCamera).position);
  const closeness = smootherstep(1 - clamp01((distance - 16) / (54 - 16)));
  const locked = userData.locked === true;
  const damageFlash = (userData.damageFlashUntil as number | undefined ?? -Infinity) > elapsedNow;

  for (const part of parts) {
    if (denied) {
      part.material.color.copy(part.kind === 'fill' ? DENY_FILL : DENY_HOT);
      continue;
    }
    if (locked) {
      if (part.kind === 'edge') part.material.color.copy(hdr(MOON, 1.6));
      else if (part.kind === 'fill') part.material.color.copy(CYAN.clone().multiplyScalar(0.3));
      else part.material.color.copy(hdr(MOON, 2.1));
      continue;
    }
    if (damageFlash) {
      part.material.color.copy(hdr(MOON, part.kind === 'fill' ? 0.5 : 1.9));
      continue;
    }
    const dim = part.kind === 'edge' ? 0.55 + 0.45 * closeness : part.kind === 'fill' ? 0.3 + 0.7 * closeness : 0.35 + 0.65 * closeness;
    part.material.color.copy(part.base).multiplyScalar(dim);
  }
}

const BG_CEILING = new Color(0.016, 0.022, 0.04);
const BG_STREETS = new Color(0.008, 0.012, 0.026);
const BG_UNDERCITY = new Color(0.024, 0.014, 0.006);
const BG_CANAL = new Color(0.006, 0.014, 0.03);
const BG_SUMMIT = new Color(0.02, 0.03, 0.06);

function findReticleWiper(scene: Scene): Group | null {
  for (const child of scene.children) {
    if (child.userData.spinner) return child.userData.spinner as Group;
  }
  return null;
}

function makeLockRing(color: Color): Group {
  const group = new Group();
  // A square signage frame closing on the target — the city marks its own.
  const frame = new Mesh(
    new RingGeometry(0.86, 0.92, 4),
    createAdditiveBasicMaterial({ color: hdr(color, 1.8), side: DoubleSide }),
  );
  frame.rotation.z = Math.PI / 4;
  const innerRing = new Mesh(
    new RingGeometry(0.66, 0.69, 32),
    createAdditiveBasicMaterial({ color: hdr(color.clone().lerp(MOON, 0.55), 1.4), side: DoubleSide }),
  );
  group.add(frame, innerRing);
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
