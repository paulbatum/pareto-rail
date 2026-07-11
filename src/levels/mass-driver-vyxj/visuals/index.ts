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
  chargeProgress,
  COLLAR_TIME,
  collarAnchorU,
  createMassDriverRail,
  FIRE_TIME,
  massDriverRunProgress,
  speedFactorAt,
} from '../gameplay';
import { ALARM_TIME, BEAT_SECONDS, BOSS_TIME, STAGE1_TIME, STAGE2_TIME } from '../timing';
import {
  breakInterlockCasing,
  createBoltMesh,
  createChargeMesh,
  createInterlockMesh,
  createSentinelMesh,
  createSliderMesh,
  createWeaverMesh,
  type TintPart,
} from './enemies';
import {
  beatFloatUniform,
  beatPulseUniform,
  chargeUniform,
  createEnvironmentInternal,
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
  spawnArc,
  spawnGlint,
  spawnRing,
  updateEffects,
  type SparkSpec,
} from './effects';
import { createLetterMesh, setLetterDenied, setLetterLocked } from './letters';
import {
  AMBER_WHITE,
  ARC_VIOLET,
  ARC_WHITE,
  hdr,
  LOCK_GRADIENT,
  TRACER_AMBER,
  WARNING_RED,
} from './palette';
import { flashUniform, interferenceUniform } from './post-fx';

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

const DENY_RED = new Color(1.5, 0.12, 0.06);
const DENY_FILL = new Color(0.28, 0.02, 0.015);

let environment: Environment | null = null;
let chargeCore: Group | null = null;
let beatEnergy = 0;
let elapsedNow = 0;
let lastRunTime = -1;
let bossActive = false;
let firedAt = -1;
let detonatedAt = -1;
let nextBossArcAt = 0;
let cameraRoll = 0;
let cameraFovOffset = 0;

const MASS_DRIVER_CAMERA_SHAKE: CameraFeelShakeOptions = {
  decay: 2.6,
  maxTrauma: 1.6,
  pitchDegrees: 0.3,
  yawDegrees: 0.26,
  rollDegrees: 0.62,
  frequency: 11,
  smoothing: 22,
};

const lockRings = createAdornmentSlot<EnemyRecord, Group>({
  get: (record) => record.lockRing,
  set: (record, ring) => {
    record.lockRing = ring;
  },
});

// createEnemyMesh() has no id, but the game emits `spawn` synchronously right
// after calling it — pairing the queue with spawn events links mesh to id.
// Dead meshes release their geometry immediately: a 60-second run spawns ~90
// targets and ~100 tracers, and headless perf gates flag unbounded growth.
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
  // The firing charge is scenery, not a target: a blinding core that builds
  // at the collar's center. Deliberately unlockable — nothing baits the
  // reticle onto it — so it lives here instead of in the enemy roster.
  chargeCore = createChargeMesh();
  chargeCore.visible = false;
  scene.add(chargeCore);
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
    case 'weaver':
      return createWeaverMesh();
    case 'slider':
      return createSliderMesh();
    case 'sentinel':
      return createSentinelMesh();
    case 'bolt':
      return createBoltMesh();
    case 'interlock':
      return createInterlockMesh();
    default:
      return createWeaverMesh();
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

// Player shot: a kinetic amber tracer — the one warm thing in the barrel.
export function createProjectileMesh() {
  const group = new Group();
  const coreGeometry = new OctahedronGeometry(0.3, 0);
  coreGeometry.scale(0.45, 0.45, 2.3);
  group.add(new Mesh(coreGeometry, new MeshBasicMaterial({ color: hdr(AMBER_WHITE, 2.6) })));
  const shellGeometry = new OctahedronGeometry(0.48, 0);
  shellGeometry.scale(0.55, 0.55, 2.0);
  group.add(
    new Mesh(
      shellGeometry,
      createAdditiveBasicMaterial({ color: hdr(TRACER_AMBER, 1.0), opacity: 0.5 }),
    ),
  );
  projectileRecords.enqueue({ mesh: group, trailColor: TRACER_AMBER.clone().multiplyScalar(0.85) });
  return group;
}

// ---- reticle ---------------------------------------------------------------------

export function createReticle() {
  const group = new Group();
  const parts: Array<{ material: MeshBasicMaterial; base: Color }> = [];

  const addPart = (mesh: Mesh, base: Color) => {
    const material = configureAdditiveMaterial(mesh.material as MeshBasicMaterial, { color: base, side: DoubleSide });
    parts.push({ material, base });
  };

  // Hex outer sight: the reticle speaks the collar's language.
  const outer = new Mesh(new RingGeometry(0.62, 0.66, 6), new MeshBasicMaterial());
  addPart(outer, hdr(TRACER_AMBER, 1.2));

  const spinner = new Group();
  const innerHex = new Mesh(new RingGeometry(0.36, 0.395, 6), new MeshBasicMaterial());
  addPart(innerHex, hdr(AMBER_WHITE, 1.0));
  innerHex.rotation.z = Math.PI / 6;
  spinner.add(innerHex);

  const brackets = new Group();
  for (let i = 0; i < 3; i += 1) {
    const tick = new Mesh(new PlaneGeometry(0.22, 0.045), new MeshBasicMaterial());
    addPart(tick, hdr(TRACER_AMBER, 1.4));
    const angle = (i / 3) * Math.PI * 2 + Math.PI / 2;
    tick.position.set(Math.cos(angle) * 0.82, Math.sin(angle) * 0.82, 0);
    tick.rotation.z = angle + Math.PI / 2;
    brackets.add(tick);
  }

  const dot = new Mesh(new CircleGeometry(0.05, 12), new MeshBasicMaterial());
  addPart(dot, hdr(AMBER_WHITE, 2.0));

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
  // Charging locks walks the sight amber → white: the sixth lock is a seated breech.
  const charge = lockCount === 0 ? null : colorForLockCount(lockCount, LOCK_GRADIENT);
  for (const part of parts) {
    if (charge) part.material.color.copy(hdr(charge, active ? 1.7 : 1.3));
    else part.material.color.copy(part.base).multiplyScalar(active ? 1.35 : 1);
  }
}

// ---- event wiring ------------------------------------------------------------------

const scratchArcFrom = new Vector3();

export function installVisualEventHandlers(bus: EventBus, scene: Scene, cameraFeel: CameraFeelRig) {
  bus.on('spawn', ({ enemyId, kind, worldPosition }) => {
    const record = enemyRecords.claim(enemyId);
    if (!record) return;
    if (kind === 'interlock') {
      spawnRing(worldPosition, hdr(WARNING_RED, 1.2), 3.4, 0.5);
      crackleAt(worldPosition, hdr(WARNING_RED, 1.4), 2, 3.2);
    } else if (kind !== 'bolt' && kind !== 'letter') {
      spawnRing(worldPosition, hdr(ARC_VIOLET, 0.8), 2.4, 0.35);
    }
  });

  bus.on('lock', ({ enemyId, worldPosition, lockCount }) => {
    const lockColor = colorForLockCount(lockCount, LOCK_GRADIENT);
    const record = enemyRecords.get(enemyId);
    if (record && !record.lockRing) {
      lockRings.attach(record, makeLockRing(lockColor), scene);
    }
    spawnRing(worldPosition, hdr(lockColor, 1.4), 2.0, 0.26);
    crackleAt(worldPosition, hdr(lockColor, 1.3), 1, 1.8);
  });

  bus.on('unlock', ({ enemyId }) => {
    const record = enemyRecords.get(enemyId);
    if (record) lockRings.detach(record);
  });

  bus.on('fire', ({ worldPosition, projectileId }) => {
    projectileRecords.claim(projectileId);
    spawnGlint(worldPosition, hdr(AMBER_WHITE, 1.2), 0.5, 0.12);
  });

  bus.on('hit', ({ enemyId, projectileId, worldPosition, lethal }) => {
    projectileRecords.delete(projectileId, { dispose: true });
    burstSparks(worldPosition, hdr(AMBER_WHITE, 0.9), 5, 9);
    const record = enemyRecords.get(enemyId);
    if (record && !lethal) {
      record.mesh.userData.damageFlashUntil = elapsedNow + 0.35;
      spawnGlint(worldPosition, hdr(AMBER_WHITE, 1.7), 1.0, 0.15);
      if (record.mesh.userData.kind === 'interlock') crackleAt(worldPosition, hdr(ARC_WHITE, 1.5), 2, 2.6);
    }
  });

  bus.on('stage', ({ enemyId, worldPosition }) => {
    const record = enemyRecords.get(enemyId);
    if (!record) return;
    if (record.mesh.userData.kind === 'interlock') {
      breakInterlockCasing(record.mesh);
      const specs = record.mesh.userData.sparkSpecs as SparkSpec[] | undefined;
      if (specs) burstDebris(worldPosition, specs.slice(0, 3));
      burstSparks(worldPosition, hdr(ARC_WHITE, 1.1), 12, 13);
      spawnRing(worldPosition, hdr(WARNING_RED, 1.3), 5.5, 0.45);
      crackleAt(worldPosition, hdr(ARC_WHITE, 1.6), 3, 3.4);
      cameraFeel.shake(0.4, MASS_DRIVER_CAMERA_SHAKE);
    }
  });

  bus.on('kill', ({ enemyId, worldPosition }) => {
    const record = enemyRecords.get(enemyId);
    if (record) {
      const specs = record.mesh.userData.sparkSpecs as SparkSpec[] | undefined;
      if (specs) burstDebris(worldPosition, specs);
      const accent = (record.mesh.userData.accent as Color | undefined) ?? ARC_VIOLET;
      burstSparks(worldPosition, hdr(accent, 1.0), 8, 12);
      spawnRing(worldPosition, hdr(accent, 0.9), 4.2, 0.4);
      spawnGlint(worldPosition, hdr(AMBER_WHITE, 1.5), 1.1, 0.16);
      crackleAt(worldPosition, hdr(accent, 1.2), 2, 3);

      if (record.mesh.userData.kind === 'interlock') {
        // An interlock blows: the collar segment discharges into the core.
        cameraFeel.shake(0.7, MASS_DRIVER_CAMERA_SHAKE);
        flashUniform.value = Math.max(flashUniform.value, 0.3);
        spawnRing(worldPosition, hdr(ARC_WHITE, 1.4), 10, 0.6);
        if (chargeCore?.visible) {
          for (let i = 0; i < 3; i += 1) spawnArc(worldPosition, chargeCore.position, hdr(ARC_WHITE, 1.7), 0.3, 1.3);
        }
      }

      enemyRecords.delete(enemyId, { dispose: true });
    }
  });

  bus.on('miss', ({ enemyId, worldPosition }) => {
    const record = enemyRecords.get(enemyId);
    const kind = record?.mesh.userData.kind as string | undefined;
    if (record) enemyRecords.delete(enemyId, { dispose: true });
    if (kind === 'interlock') return; // only "missed" at the detonation, which owns the moment
    burstSparks(worldPosition, ARC_VIOLET.clone().multiplyScalar(0.4), 3, 3);
  });

  bus.on('volley', ({ size, kills }) => {
    if (size >= 5 && kills === size) {
      beatEnergy = Math.max(beatEnergy, 1.5);
      flashUniform.value = Math.max(flashUniform.value, 0.2);
    }
  });

  bus.on('beat', ({ isDownbeat }) => {
    beatEnergy = Math.max(beatEnergy, isDownbeat ? 1 : 0.5);
  });

  bus.on('playerhit', () => {
    beatEnergy = 1.5;
    interferenceUniform.value = Math.max(interferenceUniform.value, 0.5);
    cameraFeel.shake(1.2, MASS_DRIVER_CAMERA_SHAKE);
  });

  bus.on('bossphase', ({ phase }) => {
    if (phase === 'summoned') {
      bossActive = true;
      cameraFeel.shake(0.9, MASS_DRIVER_CAMERA_SHAKE);
      if (chargeCore) {
        spawnRing(chargeCore.position, hdr(ARC_WHITE, 1.2), 16, 0.8);
        spawnRing(chargeCore.position, hdr(ARC_VIOLET, 1.0), 9, 0.6);
      }
    }
    if (phase === 'exposed') {
      flashUniform.value = Math.max(flashUniform.value, 0.4);
    }
  });

  bus.on('runstart', () => {
    resetEffects();
    enemyRecords.clear({ dispose: true, pending: true });
    projectileRecords.clear({ dispose: true, pending: true });
    resetCameraFeel(cameraFeel);
    bossActive = false;
    firedAt = -1;
    detonatedAt = -1;
    nextBossArcAt = 0;
    flashUniform.value = 0;
    interferenceUniform.value = 0;
    chargeUniform.value = 0;
  });

  bus.on('runend', ({ died }) => {
    resetCameraFeel(cameraFeel);
    bossActive = false;
    if (died) {
      // The barrel blows: containment fails all at once.
      detonatedAt = elapsedNow;
      flashUniform.value = Math.max(flashUniform.value, 1.25);
      interferenceUniform.value = 1;
      cameraFeel.shake(1.6, MASS_DRIVER_CAMERA_SHAKE);
    }
  });
}

// Short lightning burst around a point: arcs to random nearby space.
function crackleAt(position: Vector3, color: Color, count: number, reach: number) {
  for (let i = 0; i < count; i += 1) {
    scratchArcFrom.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize().multiplyScalar(reach);
    scratchArcFrom.add(position);
    spawnArc(position, scratchArcFrom, color, 0.14 + Math.random() * 0.1, 1);
  }
}

// ---- per-frame update ------------------------------------------------------------------

function resetCameraFeel(cameraFeel: CameraFeelRig) {
  lastRunTime = -1;
  cameraRoll = 0;
  cameraFovOffset = 0;
  cameraFeel.restore();
}

export function updateVisuals(dt: number, ctx: VisualContext) {
  elapsedNow = ctx.elapsed;
  beatEnergy = Math.max(0, beatEnergy - dt * 4.0);
  beatPulseUniform.value = beatEnergy;

  const runTime = ctx.running ? ctx.runTime : 0;
  const progress = ctx.running ? massDriverRunProgress(runTime) : 0;
  const speed = ctx.running ? speedFactorAt(runTime) : 0.42;

  beatFloatUniform.value = ctx.running ? runTime / BEAT_SECONDS : -10;

  updateSetPieceMoments(ctx);
  updateEnvironmentFrame(dt, ctx, speed, progress, runTime);
  updatePostUniforms(dt, ctx, runTime);
  updateChargeCore(ctx, runTime);
  updateBossArcs(ctx);

  for (const [enemyId, record] of enemyRecords.entries()) {
    if (!record.mesh.parent) {
      enemyRecords.delete(enemyId, { dispose: true });
      continue;
    }
    if (record.bornAt === null) record.bornAt = elapsedNow;
    const age = elapsedNow - record.bornAt;
    record.mesh.scale.setScalar(easeOutBack(Math.min(1, age / 0.4)));

    updateCoreBoost(record);
    updateEnemyTint(record, ctx);

    const spinParts = record.mesh.userData.spinParts as Object3D[] | undefined;
    if (spinParts) {
      for (const part of spinParts) part.rotation.z += dt * (part.userData.spinSpeed as number);
    }

    if (record.mesh.userData.isHostileShot) {
      dropTrail(record.mesh.position, record.mesh.userData.trailColor as Color);
    }

    if (record.lockRing) {
      record.mesh.getWorldPosition(record.lockRing.position);
      record.lockRing.quaternion.copy((ctx.camera as PerspectiveCamera).quaternion);
      record.lockRing.rotation.z += dt * 2.2;
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
    reticleSpinner.rotation.z += dt * (active ? 4.2 : 1.1);
    const brackets = reticleSpinner.parent?.userData.brackets as Group | undefined;
    if (brackets) brackets.rotation.z -= dt * (active ? 2.8 : 0.6);
  }

  updateEffects(dt, ctx.camera, elapsedNow);
}

// Stage drops and the firing: detect the crossing, slam the senses.
function updateSetPieceMoments(ctx: VisualContext) {
  if (!ctx.running) {
    lastRunTime = -1;
    return;
  }
  const crossed = (t: number) => lastRunTime >= 0 && lastRunTime < t && ctx.runTime >= t;
  if (crossed(STAGE1_TIME)) {
    flashUniform.value = Math.max(flashUniform.value, 0.35);
    ctx.feel.shake(0.5, MASS_DRIVER_CAMERA_SHAKE);
    ctx.feel.kickFov(4);
  }
  if (crossed(STAGE2_TIME)) {
    flashUniform.value = Math.max(flashUniform.value, 0.45);
    ctx.feel.shake(0.6, MASS_DRIVER_CAMERA_SHAKE);
    ctx.feel.kickFov(5);
  }
  if (crossed(BOSS_TIME)) {
    flashUniform.value = Math.max(flashUniform.value, 0.5);
    ctx.feel.shake(0.7, MASS_DRIVER_CAMERA_SHAKE);
    ctx.feel.kickFov(5);
  }
  if (crossed(FIRE_TIME)) {
    // The gun fires with the payload in flight: everything whites, then quiet.
    firedAt = elapsedNow;
    flashUniform.value = Math.max(flashUniform.value, 1.15);
    ctx.feel.shake(1.5, MASS_DRIVER_CAMERA_SHAKE);
    ctx.feel.kickFov(9);
  }
  lastRunTime = ctx.runTime;
}

// The charge core: positioned at the collar's center every frame, growing
// and brightening toward the firing.
function updateChargeCore(ctx: VisualContext, runTime: number) {
  if (!chargeCore) return;
  if (!ctx.running) {
    chargeCore.visible = false;
    return;
  }
  chargeCore.position.copy(cameraRail.getPointAt(collarAnchorU(runTime)));
  chargeCore.quaternion.copy((ctx.camera as PerspectiveCamera).quaternion);
  const chargeT = chargeProgress(runTime);
  chargeCore.visible = runTime >= COLLAR_TIME && runTime < FIRE_TIME;
  if (!chargeCore.visible) return;
  const arrive = Math.min(1, (runTime - COLLAR_TIME) / 0.6);
  chargeCore.scale.setScalar(easeOutBack(arrive) * (0.75 + chargeT * 1.1));
  const boost = 0.7 + chargeT * 2.2 + (chargeT > 0.6 ? Math.random() * chargeT * 0.7 : 0);
  const parts = chargeCore.userData.parts as TintPart[] | undefined;
  if (parts) {
    for (const part of parts) part.material.color.copy(part.base).multiplyScalar(boost);
  }
  const spinParts = chargeCore.userData.spinParts as Object3D[] | undefined;
  if (spinParts) {
    for (const part of spinParts) part.rotation.z += (part.userData.spinSpeed as number) * (0.5 + chargeT * 2) * 0.016;
  }
}

function updateBossArcs(ctx: VisualContext) {
  if (!bossActive || !ctx.running || ctx.runTime >= FIRE_TIME || !chargeCore?.visible) return;
  if (elapsedNow < nextBossArcAt) return;
  nextBossArcAt = elapsedNow + 0.12 + Math.random() * 0.1;
  const interlocks: EnemyRecord[] = [];
  for (const record of enemyRecords.values()) {
    if (record.mesh.userData.kind === 'interlock') interlocks.push(record);
  }
  const chargeT = chargeProgress(ctx.runTime);
  if (interlocks.length > 0) {
    const target = interlocks[Math.floor(Math.random() * interlocks.length)];
    spawnArc(chargeCore.position, target.mesh.position, hdr(ARC_VIOLET, 0.9 + chargeT * 1.1), 0.18, 1);
  } else if (chargeT > 0.2) {
    crackleAt(chargeCore.position, hdr(ARC_WHITE, 1.2 + chargeT), 1, 4.5);
  }
}

export function updateCameraEffects(dt: number, ctx: CameraEffectsContext) {
  if (!(ctx.camera instanceof PerspectiveCamera)) return;
  const camera = ctx.camera;
  const speed = ctx.running ? speedFactorAt(ctx.runTime) : 0.42;

  // FOV breathes with barrel speed and the beat; the firing adds its own kick.
  const targetFovOffset = Math.min(15, (speed - 0.8) * 5.5) + beatEnergy * 1.1;
  cameraFovOffset = MathUtils.lerp(cameraFovOffset, targetFovOffset, Math.min(1, dt * 6));

  if (ctx.running) {
    // Bank into the barrel's long flexes; purely cosmetic, applied after lookAt.
    const u = massDriverRunProgress(ctx.runTime);
    const tangentNow = railTangent(u);
    const tangentAhead = railTangent(Math.min(1, u + 0.006));
    const targetRoll = MathUtils.clamp((tangentAhead.x - tangentNow.x) * 34, -0.14, 0.14);
    cameraRoll += (targetRoll - cameraRoll) * Math.min(1, dt * 3.2);
    camera.rotateZ(cameraRoll);
  }

  ctx.feel.setFovOffset(cameraFovOffset);
  ctx.feel.update(dt, { shake: MASS_DRIVER_CAMERA_SHAKE });
}

const cameraRail = createMassDriverRail();
function railTangent(u: number) {
  return cameraRail.getTangentAt(MathUtils.clamp(u, 0, 1));
}

function updateEnvironmentFrame(dt: number, ctx: VisualContext, speed: number, progress: number, runTime: number) {
  if (!environment) return;

  environment.applyAtmosphere(progress);
  environment.greebleField.update(progress, dt);

  // Ion streaks ride the camera; scroll rate is the felt airspeed. The star
  // shell rides too (position only): zero-parallax stars read as infinity.
  environment.starShell.position.copy((ctx.camera as PerspectiveCamera).position);
  environment.streaks.position.copy((ctx.camera as PerspectiveCamera).position);
  environment.streaks.quaternion.copy((ctx.camera as PerspectiveCamera).quaternion);
  streakOffsetUniform.value = (streakOffsetUniform.value + dt * speed * 22) % 10000;

  const pastMuzzle = ctx.running && runTime >= FIRE_TIME;
  const glowTarget = !ctx.running
    ? 0.14
    : pastMuzzle
      ? 1.35
      : runTime >= BOSS_TIME
        ? 0.7
        : runTime >= STAGE2_TIME
          ? 0.55
          : runTime >= STAGE1_TIME
            ? 0.4
            : 0.22;
  streakGlowUniform.value += (glowTarget - streakGlowUniform.value) * Math.min(1, dt * 2);
}

function updatePostUniforms(dt: number, ctx: VisualContext, runTime: number) {
  // The charge is the whole run: the barrel heats toward the firing.
  const chargeTarget = ctx.running ? MathUtils.clamp(runTime / FIRE_TIME, 0, 1) : 0;
  chargeUniform.value += (chargeTarget - chargeUniform.value) * Math.min(1, dt * 3);

  // Arc interference builds through the alarm and the charge window.
  const alarmT = ctx.running
    ? MathUtils.clamp((runTime - ALARM_TIME) / (FIRE_TIME - ALARM_TIME), 0, 1)
    : 0;
  const interferenceTarget = ctx.running && runTime >= ALARM_TIME && runTime < FIRE_TIME
    ? 0.08 + alarmT * 0.22
    : 0;
  const detonationHold = detonatedAt >= 0 && elapsedNow - detonatedAt < 1.4;
  if (!detonationHold) {
    interferenceUniform.value += (interferenceTarget - interferenceUniform.value) * Math.min(1, dt * 2.5);
  }

  flashUniform.value = Math.max(0, flashUniform.value - dt * (flashUniform.value > 0.8 ? 1.3 : 2.4));

  // Weightless afterglow once the payload is away — brief, so the black of
  // open space arrives while the impact is still ringing.
  if (firedAt >= 0) {
    const since = elapsedNow - firedAt;
    if (since < 0.9) flashUniform.value = Math.max(flashUniform.value, 0.45 * (1 - since / 0.9));
  }
}

function updateCoreBoost(record: EnemyRecord) {
  const userData = record.mesh.userData;
  const kind = userData.kind as string | undefined;
  if (kind === 'sentinel') {
    const chargeT = (userData.chargeT as number | undefined) ?? 0;
    userData.coreBoost = 1 + chargeT * 1.7;
  } else if (kind === 'interlock') {
    const chargeT = (userData.chargeT as number | undefined) ?? 0;
    // Jam light blinking faster as the charge climbs.
    userData.coreBoost = 0.6 + Math.abs(Math.sin(elapsedNow * (3 + chargeT * 13))) * (0.8 + chargeT * 1.4);
  } else {
    userData.coreBoost = 1;
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
  const closeness = smootherstep(1 - clamp01((distance - 16) / (58 - 16)));
  const locked = userData.locked === true;
  const damageFlash = (userData.damageFlashUntil as number | undefined ?? -Infinity) > elapsedNow;
  const coreBoost = (userData.coreBoost as number | undefined) ?? 1;

  for (const part of parts) {
    if (denied) {
      part.material.color.copy(part.kind === 'fill' ? DENY_FILL : DENY_RED);
      continue;
    }
    if (locked) {
      if (part.kind === 'edge') part.material.color.copy(hdr(AMBER_WHITE, 1.6));
      else if (part.kind === 'fill') part.material.color.copy(TRACER_AMBER.clone().multiplyScalar(0.32));
      else part.material.color.copy(hdr(AMBER_WHITE, 2.0));
      continue;
    }
    if (damageFlash) {
      part.material.color.copy(hdr(ARC_WHITE, part.kind === 'fill' ? 0.5 : 1.9));
      continue;
    }
    const dim = part.kind === 'edge' ? 0.55 + 0.45 * closeness : part.kind === 'fill' ? 0.3 + 0.7 * closeness : (0.35 + 0.65 * closeness) * coreBoost;
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
  // Hex clamp closing on the target — the player's own interlock.
  const ring = new Mesh(
    new RingGeometry(0.86, 0.92, 6),
    createAdditiveBasicMaterial({ color: hdr(color, 1.8), side: DoubleSide }),
  );
  const innerRing = new Mesh(
    new RingGeometry(0.64, 0.675, 24),
    createAdditiveBasicMaterial({ color: hdr(color.clone().lerp(ARC_WHITE, 0.5), 1.4), side: DoubleSide }),
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
