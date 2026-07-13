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
} from '../../../engine/visual-kit';
import type { EventBus } from '../../../events';
import {
  CHARGE_TIME,
  FIRE_TIME,
  INTERLOCK_COUNT,
  createMassDriverRail,
  mdRunProgress,
  speedFactorAt,
} from '../gameplay';
import { BEAT_SECONDS } from '../timing';
import {
  crackInterlock,
  createBoltMesh,
  createInterlockMesh,
  createSentinelMesh,
  createStatorMesh,
  createWeaverMesh,
  type TintPart,
} from './enemies';
import { createEnvironmentInternal, type Environment } from './environment';
import {
  burstShards,
  burstSparks,
  createEffects,
  dropTrail,
  resetEffects,
  spawnArc,
  spawnGlint,
  spawnRing,
  updateEffects,
  type ShardSpec,
} from './effects';
import { createLetterMesh, setLetterDenied, setLetterLocked } from './letters';
import { ARC_BLUE, ARC_VIOLET, ARC_WHITE, hdr, HAZARD_AMBER, LOCK_GRADIENT, PLAYER_CYAN, WARNING_RED } from './palette';
import { chargeUniform, flashUniform } from './post-fx';

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
const DENY_FILL = new Color(0.26, 0.02, 0.01);

let environment: Environment | null = null;
let beatEnergy = 0;
let surgePulse = 0;
let elapsedNow = 0;
let lastRunTime = -1;
let cameraRoll = 0;
let cameraFovOffset = 0;
let interlocksDown = 0;

const MD_CAMERA_SHAKE: CameraFeelShakeOptions = {
  decay: 2.8,
  maxTrauma: 1.7,
  pitchDegrees: 0.32,
  yawDegrees: 0.28,
  rollDegrees: 0.7,
  frequency: 10,
  smoothing: 21,
};

const rail = createMassDriverRail();

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
    case 'weaver':
      return createWeaverMesh();
    case 'stator':
      return createStatorMesh();
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
  if (mesh.userData.isLetter) setLetterLocked(mesh as Group, locked);
}

export function setEnemyDenied(mesh: Object3D) {
  mesh.userData.deniedUntil = elapsedNow + 0.5;
  spawnRing(mesh.position, DENY_RED.clone(), 2.4, 0.28);
}

// Player shot: the coldest thing in the gun — a cyan-white sliver.
export function createProjectileMesh() {
  const group = new Group();
  const coreGeometry = new OctahedronGeometry(0.3, 0);
  coreGeometry.scale(0.42, 0.42, 2.3);
  group.add(new Mesh(coreGeometry, new MeshBasicMaterial({ color: hdr(ARC_WHITE, 2.6) })));
  const shellGeometry = new OctahedronGeometry(0.48, 0);
  shellGeometry.scale(0.55, 0.55, 1.9);
  group.add(new Mesh(shellGeometry, createAdditiveBasicMaterial({ color: hdr(PLAYER_CYAN, 1.0), opacity: 0.5 })));
  projectileRecords.enqueue({ mesh: group, trailColor: PLAYER_CYAN.clone().multiplyScalar(0.85) });
  return group;
}

// ---- reticle ---------------------------------------------------------------------

export function createReticle() {
  const group = new Group();
  const parts: Array<{ material: MeshBasicMaterial; base: Color }> = [];

  const addPart = (mesh: Mesh, base: Color) => {
    const material = mesh.material as MeshBasicMaterial;
    material.transparent = true;
    material.depthWrite = false;
    material.side = DoubleSide;
    material.color.copy(base);
    parts.push({ material, base });
  };

  // A coil sight: thin outer ring, counter-rotating square armature, hot dot.
  const outer = new Mesh(new RingGeometry(0.6, 0.64, 48), createAdditiveBasicMaterial({ color: 0xffffff }));
  addPart(outer, hdr(PLAYER_CYAN, 1.15));

  const spinner = new Group();
  const square = new Mesh(new RingGeometry(0.4, 0.435, 4), createAdditiveBasicMaterial({ color: 0xffffff }));
  addPart(square, hdr(ARC_WHITE, 1.0));
  spinner.add(square);

  const brackets = new Group();
  for (let i = 0; i < 4; i += 1) {
    const tick = new Mesh(new PlaneGeometry(0.19, 0.035), createAdditiveBasicMaterial({ color: 0xffffff }));
    addPart(tick, hdr(PLAYER_CYAN, 1.35));
    const angle = (i / 4) * Math.PI * 2;
    tick.position.set(Math.cos(angle) * 0.78, Math.sin(angle) * 0.78, 0);
    tick.rotation.z = angle + Math.PI / 2;
    brackets.add(tick);
  }

  const dot = new Mesh(new CircleGeometry(0.045, 16), createAdditiveBasicMaterial({ color: 0xffffff }));
  addPart(dot, hdr(ARC_WHITE, 2.0));

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
  const parts = reticle.userData.parts as Array<{ material: MeshBasicMaterial; base: Color }>;
  // Charging locks heats the sight along the level's own ramp: blue → violet
  // → white. Six locks reads as a capacitor at full charge.
  const charge = lockCount === 0 ? null : colorForLockCount(lockCount, LOCK_GRADIENT);
  for (const part of parts) {
    if (charge) part.material.color.copy(hdr(charge, active ? 1.7 : 1.3));
    else part.material.color.copy(part.base).multiplyScalar(active ? 1.35 : 1);
  }
}

// ---- event wiring -------------------------------------------------------------------

export function installVisualEventHandlers(bus: EventBus, scene: Scene, cameraFeel: CameraFeelRig) {
  bus.on('spawn', ({ enemyId, kind, worldPosition }) => {
    const record = enemyRecords.claim(enemyId);
    if (!record) return;
    if (kind === 'interlock') {
      // The collar reveal: every clamp announces itself with a hard red ring.
      spawnRing(worldPosition, hdr(WARNING_RED, 1.2), 4.5, 0.5);
      surgePulse = Math.max(surgePulse, 0.4);
      if (interlocksDown === 0) cameraFeel.shake(0.55, MD_CAMERA_SHAKE);
    } else if (kind === 'sentinel') {
      spawnRing(worldPosition, hdr(HAZARD_AMBER, 0.9), 3, 0.4);
    } else if (kind !== 'bolt') {
      spawnRing(worldPosition, hdr(ARC_VIOLET, 0.7), 2.2, 0.35);
    }
  });

  bus.on('lock', ({ enemyId, worldPosition, lockCount }) => {
    const lockColor = colorForLockCount(lockCount, LOCK_GRADIENT);
    const record = enemyRecords.get(enemyId);
    if (record && !record.lockRing) lockRings.attach(record, makeLockRing(lockColor), scene);
    spawnRing(worldPosition, hdr(lockColor, 1.4), 2.0, 0.26);
  });

  bus.on('unlock', ({ enemyId }) => {
    const record = enemyRecords.get(enemyId);
    if (record) lockRings.detach(record);
  });

  bus.on('fire', ({ projectileId, worldPosition }) => {
    projectileRecords.claim(projectileId);
    spawnGlint(worldPosition, hdr(ARC_WHITE, 1.2), 0.5, 0.12);
  });

  bus.on('hit', ({ enemyId, projectileId, worldPosition, lethal }) => {
    projectileRecords.delete(projectileId);
    burstSparks(worldPosition, hdr(ARC_WHITE, 0.9), 5, 9);
    const record = enemyRecords.get(enemyId);
    if (record && !lethal) {
      record.mesh.userData.damageFlashUntil = elapsedNow + 0.3;
      spawnGlint(worldPosition, hdr(ARC_WHITE, 1.7), 1.0, 0.15);
    }
  });

  bus.on('stage', ({ enemyId, worldPosition }) => {
    const record = enemyRecords.get(enemyId);
    if (!record || record.mesh.userData.kind !== 'interlock' || record.mesh.userData.cracked) return;
    // First plate off: armor gone, jam light exposed, hazard debris.
    crackInterlock(record.mesh);
    const specs = record.mesh.userData.shardSpecs as ShardSpec[] | undefined;
    if (specs) burstShards(worldPosition, specs.slice(0, 5));
    spawnRing(worldPosition, hdr(HAZARD_AMBER, 1.3), 4, 0.4);
  });

  bus.on('kill', ({ enemyId, worldPosition }) => {
    const record = enemyRecords.get(enemyId);
    if (record) {
      const specs = record.mesh.userData.shardSpecs as ShardSpec[] | undefined;
      if (specs) burstShards(worldPosition, specs);
      const accent = (record.mesh.userData.accent as Color | undefined) ?? ARC_VIOLET;
      burstSparks(worldPosition, hdr(accent, 1.0), 8, 12);
      spawnRing(worldPosition, hdr(accent, 0.9), 4.2, 0.4);
      spawnGlint(worldPosition, hdr(ARC_WHITE, 1.6), 1.1, 0.16);

      if (record.mesh.userData.kind === 'interlock') {
        interlocksDown += 1;
        // Breaking a breaker: the discharge it was holding back gets loose.
        cameraFeel.shake(0.55 + interlocksDown * 0.08, MD_CAMERA_SHAKE);
        flashUniform.value = Math.max(flashUniform.value, 0.16 + interlocksDown * 0.05);
        spawnRing(worldPosition, hdr(ARC_WHITE, 1.3), 9, 0.55);
        for (let i = 0; i < 3; i += 1) {
          const jitter = new Vector3((Math.random() - 0.5) * 9, (Math.random() - 0.5) * 9, (Math.random() - 0.5) * 4);
          spawnArc(worldPosition.clone(), worldPosition.clone().add(jitter), hdr(ARC_WHITE, 1.5), 0.3);
        }
        if (interlocksDown >= INTERLOCK_COUNT) {
          // All clear: the collar lets go and the whole barrel exhales.
          surgePulse = 1;
          flashUniform.value = Math.max(flashUniform.value, 0.55);
          cameraFeel.shake(1.0, MD_CAMERA_SHAKE);
          spawnRing(worldPosition, hdr(ARC_WHITE, 1.5), 30, 0.9);
          spawnRing(worldPosition, hdr(ARC_VIOLET, 1.1), 18, 0.7);
        }
      }
      enemyRecords.delete(enemyId, { dispose: true });
    }
  });

  bus.on('miss', ({ enemyId, worldPosition }) => {
    if (enemyRecords.get(enemyId)) enemyRecords.delete(enemyId, { dispose: true });
    burstSparks(worldPosition, ARC_VIOLET.clone().multiplyScalar(0.35), 3, 3);
  });

  bus.on('volley', ({ size, kills }) => {
    if (size >= 5 && kills === size) {
      beatEnergy = Math.max(beatEnergy, 1.5);
      flashUniform.value = Math.max(flashUniform.value, 0.2);
    }
  });

  bus.on('beat', ({ isDownbeat }) => {
    beatEnergy = Math.max(beatEnergy, isDownbeat ? 1 : 0.5);
    if (environment && lastRunTime >= 0) {
      // Flash the ring the payload is about to cross — the crossing IS the beat.
      const camBeat = Math.ceil(lastRunTime / BEAT_SECONDS);
      environment.pulse(camBeat, isDownbeat ? 1 : 0.6);
      environment.pulse(camBeat + 1, 0.3);
    }
  });

  bus.on('playerhit', () => {
    beatEnergy = 1.5;
    flashUniform.value = Math.max(flashUniform.value, 0.3);
    cameraFeel.shake(1.25, MD_CAMERA_SHAKE);
  });

  bus.on('runstart', () => {
    resetEffects();
    enemyRecords.clear({ dispose: true, pending: true });
    projectileRecords.clear({ pending: true });
    resetCameraFeel(cameraFeel);
    flashUniform.value = 0;
    chargeUniform.value = 0;
    surgePulse = 0;
    interlocksDown = 0;
  });

  bus.on('runend', () => {
    resetCameraFeel(cameraFeel);
  });
}

// ---- per-frame update -----------------------------------------------------------------

function resetCameraFeel(cameraFeel: CameraFeelRig) {
  lastRunTime = -1;
  cameraRoll = 0;
  cameraFovOffset = 0;
  cameraFeel.restore();
}

export function updateVisuals(dt: number, ctx: VisualContext) {
  elapsedNow = ctx.elapsed;
  beatEnergy = Math.max(0, beatEnergy - dt * 4.4);
  surgePulse = Math.max(0, surgePulse - dt * 0.9);

  const runTime = ctx.running ? ctx.runTime : 0;
  const charge = !ctx.running
    ? 0
    : MathUtils.clamp((runTime - CHARGE_TIME) / (FIRE_TIME - CHARGE_TIME), 0, runTime >= FIRE_TIME ? 0 : 1);

  updateSetPieceMoments(ctx);

  if (environment) {
    const cameraU = ctx.running ? mdRunProgress(runTime) : 0;
    environment.update(cameraU, runTime, dt, { beatEnergy, charge, running: ctx.running });

    // Stray discharges crackle across the bore, more insistent as the charge
    // builds; each one jumps between two coils just ahead of the payload.
    const arcChance = ctx.running ? dt * (0.5 + charge * 6) : dt * 0.15;
    if (Math.random() < arcChance && ctx.running) {
      const nearBeat = Math.ceil(runTime / BEAT_SECONDS) + 2 + Math.floor(Math.random() * 8);
      const angleA = Math.random() * Math.PI * 2;
      const angleB = angleA + 0.8 + Math.random() * 1.6;
      spawnArc(
        environment.ringPoint(nearBeat, angleA),
        environment.ringPoint(nearBeat + 1 + Math.floor(Math.random() * 2), angleB),
        hdr(charge > 0.4 ? ARC_WHITE : ARC_BLUE, 0.9 + charge * 0.8),
        0.18 + Math.random() * 0.14,
      );
    }
  }

  // Post uniforms: the charge tint creeps in over the six interlock bars and
  // vanishes at the muzzle; flash decays fast so hits stay readable.
  chargeUniform.value += ((ctx.running && runTime < FIRE_TIME ? charge : 0) - chargeUniform.value) * Math.min(1, dt * 3);
  flashUniform.value = Math.max(0, flashUniform.value - dt * (flashUniform.value > 0.8 ? 1.5 : 2.6));

  for (const [enemyId, record] of enemyRecords.entries()) {
    if (!record.mesh.parent) {
      enemyRecords.delete(enemyId, { dispose: true });
      continue;
    }
    if (record.bornAt === null) record.bornAt = elapsedNow;
    const age = elapsedNow - record.bornAt;
    record.mesh.scale.setScalar(easeOutBack(Math.min(1, age / 0.4)));

    updateEnemyTint(record, ctx);

    if (record.mesh.userData.isHostileShot) {
      dropTrail(record.mesh.position, record.mesh.userData.trailColor as Color);
    }

    if (record.lockRing) {
      record.mesh.getWorldPosition(record.lockRing.position);
      record.lockRing.quaternion.copy((ctx.camera as PerspectiveCamera).quaternion);
      record.lockRing.rotation.z += dt * 2.6;
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
    reticleSpinner.rotation.z += dt * (active ? 4.4 : 1.1);
    const brackets = reticleSpinner.parent?.userData.brackets as Group | undefined;
    if (brackets) brackets.rotation.z -= dt * (active ? 2.8 : 0.6);
  }

  updateEffects(dt, ctx.camera);
}

// The firing slam: detect the crossing of bar 30, blow the frame out white,
// then let the silence of open space do the rest.
function updateSetPieceMoments(ctx: VisualContext) {
  if (!ctx.running) {
    lastRunTime = -1;
    return;
  }
  if (lastRunTime >= 0 && lastRunTime < FIRE_TIME && ctx.runTime >= FIRE_TIME) {
    flashUniform.value = Math.max(flashUniform.value, 1.25);
    surgePulse = Math.max(surgePulse, 1.2);
    ctx.feel.shake(1.5, MD_CAMERA_SHAKE);
    ctx.feel.kickFov(10, { decay: 1.6 });
    if (environment) {
      spawnRing(environment.muzzlePosition, hdr(ARC_WHITE, 1.6), 70, 1.2);
      spawnRing(environment.muzzlePosition, hdr(ARC_VIOLET, 1.1), 40, 0.9);
    }
  }
  lastRunTime = ctx.runTime;
}

export function updateCameraEffects(dt: number, ctx: CameraEffectsContext) {
  if (!(ctx.camera instanceof PerspectiveCamera)) return;
  const camera = ctx.camera;
  const speed = ctx.running ? speedFactorAt(ctx.runTime) : 0.5;

  // FOV breathes with barrel speed and kicks with the pulse; the launch adds
  // its own kick on top via the set-piece moment.
  const targetFovOffset = (speed - 0.75) * 7 + beatEnergy * 1.0 + surgePulse * 6;
  cameraFovOffset = MathUtils.lerp(cameraFovOffset, targetFovOffset, Math.min(1, dt * 6));

  if (ctx.running) {
    // Bank into the barrel's sweep; cosmetic, applied after the runner's lookAt.
    const u = mdRunProgress(ctx.runTime);
    const tangent = rail.getTangentAt(MathUtils.clamp(u, 0, 1));
    const ahead = rail.getTangentAt(MathUtils.clamp(u + 0.006, 0, 1));
    const targetRoll = MathUtils.clamp((ahead.x - tangent.x) * 26, -0.14, 0.14);
    cameraRoll += (targetRoll - cameraRoll) * Math.min(1, dt * 3.2);
    camera.rotateZ(cameraRoll);
  }

  ctx.feel.setFovOffset(cameraFovOffset);
  ctx.feel.update(dt, { shake: MD_CAMERA_SHAKE });
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

  // Distance falloff keeps far additive stacks from blobbing under bloom.
  const distance = record.mesh.position.distanceTo((ctx.camera as PerspectiveCamera).position);
  const closeness = smootherstep(1 - clamp01((distance - 16) / (60 - 16)));
  const locked = userData.locked === true;
  const damageFlash = ((userData.damageFlashUntil as number | undefined) ?? -Infinity) > elapsedNow;
  const cracked = userData.cracked === true;

  for (const part of parts) {
    if (denied) {
      part.material.color.copy(part.kind === 'fill' ? DENY_FILL : DENY_RED);
      continue;
    }
    if (locked) {
      if (part.kind === 'edge') part.material.color.copy(hdr(ARC_WHITE, 1.6));
      else if (part.kind === 'fill') part.material.color.copy(PLAYER_CYAN.clone().multiplyScalar(0.32));
      else part.material.color.copy(hdr(ARC_WHITE, 2.0));
      continue;
    }
    if (damageFlash) {
      part.material.color.copy(hdr(ARC_WHITE, part.kind === 'fill' ? 0.5 : 1.8));
      continue;
    }
    const dim = part.kind === 'edge' ? 0.55 + 0.45 * closeness : part.kind === 'fill' ? 0.35 + 0.65 * closeness : 0.4 + 0.6 * closeness;
    part.material.color.copy(part.base).multiplyScalar(dim);
    // An exposed jam light seethes.
    if (cracked && part.kind === 'core') {
      part.material.color.copy(WARNING_RED).multiplyScalar(1.6 + Math.sin(elapsedNow * 21) * 0.7);
    }
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
  // A square clamp bracket — the payload's targeting language, not the gun's.
  const ring = new Mesh(
    new RingGeometry(0.84, 0.9, 4),
    createAdditiveBasicMaterial({ color: hdr(color, 1.8), side: DoubleSide }),
  );
  const innerRing = new Mesh(
    new RingGeometry(0.64, 0.67, 32),
    createAdditiveBasicMaterial({ color: hdr(color.clone().lerp(ARC_WHITE, 0.55), 1.4), side: DoubleSide }),
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
