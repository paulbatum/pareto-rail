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
  BOSS_TIME,
  CORONA_TIME,
  createHeliosRail,
  GATE_TIME,
  heliosRunProgress,
  HELIOS_DURATION,
  REVEAL_TIME,
  speedFactorAt,
} from '../gameplay';
import {
  breakPyreArmor,
  createBoltMesh,
  createCinderMesh,
  createFlareMesh,
  createMoteMesh,
  createPyreMesh,
  createScorcherMesh,
  type TintPart,
} from './enemies';
import {
  beatUniform,
  createEnvironmentInternal,
  novaUniform,
  streakGlowUniform,
  streakOffsetUniform,
  type Environment,
} from './environment';
import {
  burstEmbers,
  burstSlag,
  createEffects,
  dropTrail,
  resetEffects,
  spawnBeam,
  spawnGlint,
  spawnRing,
  updateEffects,
  type EmberSpec,
} from './effects';
import { createLetterMesh, setLetterDenied, setLetterLocked } from './letters';
import { COLD_BLUE, EMBER, GOLD, hdr, ICE_WHITE, LOCK_GRADIENT, SPACE_MAROON, WHITE_HOT } from './palette';
import { flashUniform, heatUniform, speedBlurUniform } from './post-fx';
import { createFangMesh, createHeadMesh, killSerpentBody, updateHeadMesh, updateSerpentBody } from './serpent';

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
let blurPulse = 0;
let elapsedNow = 0;
let lastRunTime = -1;
let heartWorldPosition: Vector3 | null = null;
let heartKilledAt = -1;

const HELIOS_CAMERA_SHAKE: CameraFeelShakeOptions = {
  decay: 2.6,
  maxTrauma: 1.8,
  pitchDegrees: 0.36,
  yawDegrees: 0.3,
  rollDegrees: 0.75,
  frequency: 8.5,
  smoothing: 20,
};

const rail = createHeliosRail();

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
  mesh.scale.setScalar(0.001);
  enemyRecords.enqueue(mesh);
  return mesh;
}

function buildEnemyMesh(kind: string, letter?: string): Group {
  switch (kind) {
    case 'letter':
      return createLetterMesh(letter ?? 'I');
    case 'cinder':
      return createCinderMesh();
    case 'mote':
      return createMoteMesh();
    case 'scorcher':
      return createScorcherMesh();
    case 'pyre':
      return createPyreMesh();
    case 'bolt':
      return createBoltMesh();
    case 'flare':
      return createFlareMesh();
    case 'fang':
      return createFangMesh();
    case 'heart':
      return createHeadMesh();
    default:
      return createCinderMesh();
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

// Player shot: a cold blue dart. The one cold-moving thing in a burning world.
export function createProjectileMesh() {
  const group = new Group();
  const coreGeometry = new OctahedronGeometry(0.32, 0);
  coreGeometry.scale(0.45, 0.45, 2.2);
  group.add(new Mesh(coreGeometry, new MeshBasicMaterial({ color: hdr(ICE_WHITE, 2.7) })));
  const shellGeometry = new OctahedronGeometry(0.5, 0);
  shellGeometry.scale(0.55, 0.55, 1.9);
  group.add(
    new Mesh(
      shellGeometry,
      createAdditiveBasicMaterial({ color: hdr(COLD_BLUE, 1.0), opacity: 0.5 }),
    ),
  );
  projectileRecords.enqueue({ mesh: group, trailColor: COLD_BLUE.clone().multiplyScalar(0.9) });
  return group;
}

// ---- reticle -----------------------------------------------------------------

export function createReticle() {
  const group = new Group();
  const parts: Array<{ material: MeshBasicMaterial; base: Color }> = [];

  const addPart = (mesh: Mesh, base: Color) => {
    const material = configureAdditiveMaterial(mesh.material as MeshBasicMaterial, { color: base, side: DoubleSide });
    parts.push({ material, base });
  };

  const outer = new Mesh(new RingGeometry(0.62, 0.655, 48), new MeshBasicMaterial());
  addPart(outer, hdr(COLD_BLUE, 1.15));

  // A spinning triangle sight — three-fold, unlike anything hostile here.
  const spinner = new Group();
  const triangle = new Mesh(new RingGeometry(0.38, 0.415, 3), new MeshBasicMaterial());
  addPart(triangle, hdr(ICE_WHITE, 1.0));
  spinner.add(triangle);

  const brackets = new Group();
  for (let i = 0; i < 3; i += 1) {
    const tick = new Mesh(new PlaneGeometry(0.2, 0.04), new MeshBasicMaterial());
    addPart(tick, hdr(COLD_BLUE, 1.35));
    const angle = (i / 3) * Math.PI * 2 + Math.PI / 2;
    tick.position.set(Math.cos(angle) * 0.8, Math.sin(angle) * 0.8, 0);
    tick.rotation.z = angle + Math.PI / 2;
    brackets.add(tick);
  }

  const dot = new Mesh(new CircleGeometry(0.05, 18), new MeshBasicMaterial());
  addPart(dot, hdr(ICE_WHITE, 2.1));

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
  // Charging locks walks the sight from cold blue through white to gold —
  // the sixth lock is visibly "ignition".
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
    if (kind === 'flare') {
      // Prominence telegraph: a light column where it will erupt.
      spawnBeam(worldPosition.clone(), hdr(GOLD, 0.9), 30, 0.8);
      spawnRing(worldPosition, hdr(GOLD, 1.1), 4, 0.5);
    } else if (kind === 'heart') {
      cameraFeel.shake(1.2, HELIOS_CAMERA_SHAKE);
      blurPulse = Math.max(blurPulse, 0.55);
      spawnRing(worldPosition, hdr(EMBER, 1.3), 26, 0.9);
      spawnRing(worldPosition, hdr(GOLD, 1.0), 14, 0.7);
    } else if (kind !== 'bolt') {
      spawnRing(worldPosition, hdr(EMBER, 0.8), 2.6, 0.4);
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
    spawnGlint(worldPosition, hdr(ICE_WHITE, 1.2), 0.5, 0.12);
  });

  bus.on('hit', ({ enemyId, projectileId, worldPosition, lethal }) => {
    projectileRecords.delete(projectileId);
    burstEmbers(worldPosition, hdr(ICE_WHITE, 0.9), 5, 10, 4);
    const record = enemyRecords.get(enemyId);
    if (record && !lethal) {
      record.mesh.userData.damageFlashUntil = elapsedNow + 0.35;
      spawnGlint(worldPosition, hdr(ICE_WHITE, 1.8), 1.1, 0.16);
    }
  });

  bus.on('stage', ({ enemyId, worldPosition }) => {
    const record = enemyRecords.get(enemyId);
    if (!record) return;
    if (record.mesh.userData.kind === 'pyre') {
      breakPyreArmor(record.mesh);
      const specs = record.mesh.userData.shardSpecs as EmberSpec[] | undefined;
      if (specs) burstSlag(worldPosition, specs.slice(0, 6));
      burstEmbers(worldPosition, hdr(GOLD, 1.1), 14, 14);
      spawnRing(worldPosition, hdr(GOLD, 1.4), 6.5, 0.5);
    } else if (record.mesh.userData.isSerpentHead) {
      // The heart survives a stage — it dives. Make the ocean answer.
      cameraFeel.shake(1.1, HELIOS_CAMERA_SHAKE);
      blurPulse = Math.max(blurPulse, 0.5);
      spawnRing(worldPosition, hdr(EMBER, 1.5), 30, 1.0);
      spawnRing(worldPosition, hdr(WHITE_HOT, 1.1), 12, 0.6);
      burstEmbers(worldPosition, hdr(GOLD, 1.2), 30, 26, 14);
    }
  });

  bus.on('kill', ({ enemyId, worldPosition }) => {
    const record = enemyRecords.get(enemyId);
    if (record) {
      const specs = record.mesh.userData.shardSpecs as EmberSpec[] | undefined;
      if (specs) burstSlag(worldPosition, specs);
      const accent = (record.mesh.userData.accent as Color | undefined) ?? EMBER;
      burstEmbers(worldPosition, hdr(accent, 1.0), 8, 13);
      spawnRing(worldPosition, hdr(accent, 0.9), 4.6, 0.42);
      spawnGlint(worldPosition, hdr(ICE_WHITE, 1.6), 1.2, 0.18);

      if (record.mesh.userData.isSerpentHead) {
        // Supernova: the kill the whole level is built around.
        heartKilledAt = elapsedNow;
        heartWorldPosition = null;
        cameraFeel.shake(1.8, HELIOS_CAMERA_SHAKE);
        blurPulse = 1.0;
        flashUniform.value = Math.max(flashUniform.value, 1.15);
        spawnRing(worldPosition, hdr(WHITE_HOT, 1.6), 90, 1.6);
        spawnRing(worldPosition, hdr(GOLD, 1.3), 55, 1.2);
        spawnRing(worldPosition, hdr(EMBER, 1.1), 30, 0.9);
        spawnGlint(worldPosition, hdr(WHITE_HOT, 2.4), 7, 0.5);
        burstEmbers(worldPosition, hdr(GOLD, 1.3), 60, 34, 10);
        if (environment) killSerpentBody(environment.serpent);
      } else if (record.mesh.userData.kind === 'fang') {
        cameraFeel.shake(0.6, HELIOS_CAMERA_SHAKE);
        spawnRing(worldPosition, hdr(GOLD, 1.3), 9, 0.55);
      }

      enemyRecords.delete(enemyId, { dispose: true });
    }
  });

  bus.on('miss', ({ enemyId, worldPosition }) => {
    const record = enemyRecords.get(enemyId);
    if (record) {
      enemyRecords.delete(enemyId, { dispose: true });
    }
    burstEmbers(worldPosition, EMBER.clone().multiplyScalar(0.4), 3, 3, 2);
  });

  bus.on('volley', ({ size, kills }) => {
    if (size >= 5 && kills === size) {
      // A perfect big volley pumps the whole frame.
      beatEnergy = Math.max(beatEnergy, 1.5);
      flashUniform.value = Math.max(flashUniform.value, 0.22);
    }
  });

  bus.on('beat', ({ isDownbeat }) => {
    beatEnergy = Math.max(beatEnergy, isDownbeat ? 1 : 0.45);
  });

  bus.on('playerhit', () => {
    beatEnergy = 1.5;
    cameraFeel.shake(1.3, HELIOS_CAMERA_SHAKE);
  });

  bus.on('runstart', () => {
    resetEffects();
    enemyRecords.clear({ dispose: true, pending: true });
    projectileRecords.clear({ pending: true });
    heartWorldPosition = null;
    heartKilledAt = -1;
    resetCameraFeel(cameraFeel);
    novaUniform.value = 0;
    flashUniform.value = 0;
    speedBlurUniform.value = 0;
    heatUniform.value = 0;
    blurPulse = 0;
    if (environment) {
      environment.serpent.state = 'idle';
      environment.serpent.dyingFor = 0;
      for (const segment of environment.serpent.neck) segment.visible = false;
    }
  });

  bus.on('runend', () => {
    resetCameraFeel(cameraFeel);
  });
}

// ---- per-frame update -------------------------------------------------------------

function resetCameraFeel(cameraFeel: CameraFeelRig) {
  lastRunTime = -1;
  cameraRoll = 0;
  cameraFovOffset = 0;
  cameraFeel.restore();
}

export function updateVisuals(dt: number, ctx: VisualContext) {
  elapsedNow = ctx.elapsed;
  beatEnergy = Math.max(0, beatEnergy - dt * 4.2);
  blurPulse = Math.max(0, blurPulse - dt * 0.85);
  beatUniform.value = beatEnergy;

  const runTime = ctx.running ? ctx.runTime : 0;
  const speed = ctx.running ? speedFactorAt(runTime) : 0.5;

  updateSetPieceMoments(ctx);
  updateEnvironmentFrame(dt, ctx, speed, runTime);
  updatePostUniforms(dt, ctx, runTime);

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

    if (record.mesh.userData.isSerpentHead) {
      updateHeadMesh(record.mesh, elapsedNow);
      heartWorldPosition = record.mesh.position;
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
      projectileRecords.delete(projectileId);
      continue;
    }
    dropTrail(record.mesh.position, record.trailColor);
  }

  const reticleSpinner = findReticleSpinner(ctx.scene);
  if (reticleSpinner) {
    const active = reticleSpinner.parent?.userData.active === true;
    reticleSpinner.rotation.z += dt * (active ? 4.6 : 1.2);
    const brackets = reticleSpinner.parent?.userData.brackets as Group | undefined;
    if (brackets) brackets.rotation.z -= dt * (active ? 3 : 0.7);
  }

  updateEffects(dt, ctx.camera);
}

// Gate transit / corona plunge: detect the crossing, slam the senses.
function updateSetPieceMoments(ctx: VisualContext) {
  if (!ctx.running) {
    lastRunTime = -1;
    return;
  }
  const crossed = (t: number) => lastRunTime >= 0 && lastRunTime < t && ctx.runTime >= t;
  if (crossed(GATE_TIME)) {
    flashUniform.value = Math.max(flashUniform.value, 0.75);
    blurPulse = Math.max(blurPulse, 0.95);
    ctx.feel.shake(0.8, HELIOS_CAMERA_SHAKE);
    if (environment) {
      spawnRing(environment.gatePosition, hdr(GOLD, 1.5), 70, 1.1);
      spawnRing(environment.gatePosition, hdr(EMBER, 1.1), 40, 0.8);
    }
  }
  if (crossed(CORONA_TIME)) {
    flashUniform.value = Math.max(flashUniform.value, 1.05);
    blurPulse = Math.max(blurPulse, 1.1);
    ctx.feel.shake(1.0, HELIOS_CAMERA_SHAKE);
    if (environment) {
      spawnRing(environment.coronaPosition, hdr(WHITE_HOT, 1.4), 60, 1.2);
      spawnRing(environment.coronaPosition, hdr(GOLD, 1.0), 34, 0.9);
    }
  }
  lastRunTime = ctx.runTime;
}

export function updateCameraEffects(dt: number, ctx: CameraEffectsContext) {
  const runTime = ctx.running ? ctx.runTime : 0;
  const speed = ctx.running ? speedFactorAt(runTime) : 0.5;
  updateCameraFeel(dt, ctx, speed);
}

function updateCameraFeel(dt: number, ctx: CameraEffectsContext, speed: number) {
  if (!(ctx.camera instanceof PerspectiveCamera)) return;
  const camera = ctx.camera;

  // FOV breathes with airspeed, kicks with the beat and the blur pulses. Helios
  // keeps the old smoothing curve here while the shared rig owns the actual
  // camera.fov write and projection update.
  const targetFovOffset = (speed - 0.8) * 9 + beatEnergy * 1.1 + blurPulse * 7;
  cameraFovOffset = MathUtils.lerp(cameraFovOffset, targetFovOffset, Math.min(1, dt * 6));

  if (ctx.running) {
    // Bank into the rail's turns. Applied after the runner's lookAt, so it is
    // purely cosmetic; kept modest so lock hit-testing stays honest.
    const u = heliosRunProgress(ctx.runTime, HELIOS_DURATION);
    const tangent = rail.getTangentAt(MathUtils.clamp(u, 0, 1));
    const ahead = rail.getTangentAt(MathUtils.clamp(u + 0.006, 0, 1));
    const targetRoll = MathUtils.clamp((ahead.x - tangent.x) * 30, -0.16, 0.16);
    cameraRoll += (targetRoll - cameraRoll) * Math.min(1, dt * 3.2);
    camera.rotateZ(cameraRoll);
  }

  ctx.feel.setFovOffset(cameraFovOffset);
  ctx.feel.update(dt, { shake: HELIOS_CAMERA_SHAKE });
}

function updateEnvironmentFrame(dt: number, ctx: VisualContext, speed: number, runTime: number) {
  if (!environment) return;

  environment.gateRunes.rotation.z += dt * 0.25;
  environment.geyserField.update(heliosRunProgress(runTime), dt);

  for (const geyser of environment.geysers) {
    const swell = Math.max(0, Math.sin(elapsedNow * geyser.speed + geyser.phase));
    const height = geyser.baseHeight * (0.25 + swell * 0.75);
    geyser.mesh.scale.set(0.6 + swell, height, 0.6 + swell);
    (geyser.mesh.material as MeshBasicMaterial).opacity = 0.18 + swell * 0.4;
  }

  // Speed streaks ride the camera; their scroll rate is the felt airspeed.
  environment.streaks.position.copy((ctx.camera as PerspectiveCamera).position);
  environment.streaks.quaternion.copy((ctx.camera as PerspectiveCamera).quaternion);
  streakOffsetUniform.value = (streakOffsetUniform.value + dt * speed * 26) % 10000;
  const act = !ctx.running ? -1 : runTime < GATE_TIME ? 0 : runTime < CORONA_TIME ? 1 : runTime < BOSS_TIME ? 2 : 3;
  const glowTarget = act === -1 ? 0.12 : act === 0 ? 0.3 : act === 1 ? 0.55 : act === 2 ? 0.95 : 0.55;
  streakGlowUniform.value += (glowTarget - streakGlowUniform.value) * Math.min(1, dt * 2);

  // Space itself warms as the dive deepens.
  const targetBackground = act <= 0
    ? SPACE_MAROON
    : act === 1
      ? BG_FURNACE
      : act === 2
        ? BG_CORONA
        : BG_BOSS;
  (ctx.scene.background as Color).lerp(targetBackground, Math.min(1, dt * 0.8));

  // The serpent: agitated once the reveal hits, following its head while the
  // boss lives, sinking after the kill.
  const agitated = ctx.running && runTime >= REVEAL_TIME;
  updateSerpentBody(environment.serpent, heartWorldPosition, dt * (agitated ? 2.4 : 1), elapsedNow);
}

function updatePostUniforms(dt: number, ctx: VisualContext, runTime: number) {
  const act3 = ctx.running && runTime >= CORONA_TIME;
  const heatTarget = !ctx.running ? 0 : act3 ? (runTime >= BOSS_TIME ? 0.3 : 0.5) : runTime >= GATE_TIME ? 0.12 : 0;
  heatUniform.value += (heatTarget - heatUniform.value) * Math.min(1, dt * 1.4);

  const blurBase = !ctx.running ? 0 : act3 ? 0.1 : 0.04;
  speedBlurUniform.value = Math.min(1, blurBase + blurPulse);

  flashUniform.value = Math.max(0, flashUniform.value - dt * (flashUniform.value > 0.8 ? 1.4 : 2.4));

  // Supernova ramp after the heart dies.
  if (heartKilledAt >= 0) {
    const since = elapsedNow - heartKilledAt;
    novaUniform.value = MathUtils.clamp(since / 4.2, 0, 1) * 0.85;
    if (since < 2.5) flashUniform.value = Math.max(flashUniform.value, 0.5 * (1 - since / 2.5));
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
  const closeness = smootherstep(1 - clamp01((distance - 16) / (54 - 16)));
  const locked = userData.locked === true;
  const damageFlash = (userData.damageFlashUntil as number | undefined ?? -Infinity) > elapsedNow;

  for (const part of parts) {
    if (denied) {
      part.material.color.copy(part.kind === 'fill' ? DENY_FILL : DENY_RED);
      continue;
    }
    if (locked) {
      if (part.kind === 'edge') part.material.color.copy(hdr(ICE_WHITE, 1.6));
      else if (part.kind === 'fill') part.material.color.copy(COLD_BLUE.clone().multiplyScalar(0.35));
      else part.material.color.copy(hdr(ICE_WHITE, 2.1));
      continue;
    }
    if (damageFlash) {
      part.material.color.copy(hdr(WHITE_HOT, part.kind === 'fill' ? 0.5 : 1.9));
      continue;
    }
    const dim = part.kind === 'edge' ? 0.55 + 0.45 * closeness : part.kind === 'fill' ? 0.3 + 0.7 * closeness : 0.35 + 0.65 * closeness;
    part.material.color.copy(part.base).multiplyScalar(dim);
  }
}

const BG_FURNACE = new Color(0.045, 0.014, 0.016);
const BG_CORONA = new Color(0.085, 0.026, 0.018);
const BG_BOSS = new Color(0.05, 0.01, 0.024);

function findReticleSpinner(scene: Scene): Group | null {
  for (const child of scene.children) {
    if (child.userData.spinner) return child.userData.spinner as Group;
  }
  return null;
}

function makeLockRing(color: Color): Group {
  const group = new Group();
  // Hex outer ring — the cold clamp closing on a hostile.
  const ring = new Mesh(
    new RingGeometry(0.86, 0.92, 6),
    createAdditiveBasicMaterial({ color: hdr(color, 1.8), side: DoubleSide }),
  );
  const innerRing = new Mesh(
    new RingGeometry(0.66, 0.69, 32),
    createAdditiveBasicMaterial({ color: hdr(color.clone().lerp(ICE_WHITE, 0.55), 1.4), side: DoubleSide }),
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
