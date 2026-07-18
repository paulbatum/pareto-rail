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
  disposeObject3D,
} from '../../../engine/visual-kit';
import type { EventBus } from '../../../events';
import { createMassDriverRail, massDriverRunProgress, speedFactorAt } from '../gameplay';
import { INTERLOCK_TIME, RING_COUNT, RUN_DURATION, SHOT_TIME } from '../timing';
import {
  breakCapacitorArmor,
  breakInterlockCowl,
  createArcMesh,
  createCapacitorMesh,
  createCoilMesh,
  createInterlockMesh,
  createThreaderMesh,
  type TintPart,
} from './enemies';
import { createEnvironmentInternal, type MassDriverEnvironment } from './environment';
import {
  burstShatter,
  burstSparks,
  createEffects,
  dropTrail,
  resetEffects,
  spawnArc,
  spawnFlash,
  spawnGlint,
  spawnRing,
  updateEffects,
  type SparkSpec,
} from './effects';
import { createLetterMesh, setLetterDenied, setLetterLocked } from './letters';
import {
  ARC_BLUE,
  BLINDING,
  GUNMETAL,
  HAZARD,
  HAZARD_FILL,
  HAZARD_RED,
  hdr,
  heatColorAt,
  ION_WHITE,
  LOCK_GRADIENT,
  VOLT_VIOLET,
} from './palette';
import { chargeUniform, detonationUniform, flashUniform } from './post-fx';

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

const DENY_EDGE = HAZARD_RED.clone();
const LOCK_FILL = ARC_BLUE.clone().multiplyScalar(0.35);

// A metallic gun-barrel rattle: quick and tight, more roll than pitch — the
// whole barrel ringing rather than a soft impact.
const BARREL_SHAKE: CameraFeelShakeOptions = {
  decay: 3.0,
  maxTrauma: 1.9,
  pitchDegrees: 0.28,
  yawDegrees: 0.24,
  rollDegrees: 0.58,
  frequency: 12.5,
  smoothing: 24,
};

let environment: MassDriverEnvironment | null = null;
let beatEnergy = 0;
let cameraRoll = 0;
let cameraFovOffset = 0;
let elapsedNow = 0;
let lastRunTime = -1;
let shotFired = false;
let detonated = false;

const rail = createMassDriverRail();

const lockRings = createAdornmentSlot<EnemyRecord, Group>({
  get: (record) => record.lockRing,
  set: (record, ring) => {
    record.lockRing = ring;
  },
});

const enemyRecords = createPendingVisualRecords<Group, EnemyRecord>({
  createRecord: (mesh) => ({ mesh, bornAt: null, lockRing: null }),
  // The runner removes despawned meshes from the scene but does not free their
  // geometry; these drones carry a lot of it, so dispose it here.
  disposeRecord: (record) => {
    lockRings.detach(record);
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
  environment = createEnvironmentInternal(scene);
  createEffects(scene);
  return environment.root;
}

export function createEnemyMesh(kind: string, letter?: string) {
  const mesh = buildEnemyMesh(kind, letter);
  mesh.userData.kind = kind;
  mesh.scale.setScalar(0.001); // pop-in overshoot handled per frame
  enemyRecords.enqueue(mesh);
  return mesh;
}

function buildEnemyMesh(kind: string, letter?: string): Group {
  switch (kind) {
    case 'letter':
      return createLetterMesh(letter ?? 'C');
    case 'coil':
      return createCoilMesh();
    case 'threader':
      return createThreaderMesh();
    case 'capacitor':
      return createCapacitorMesh();
    case 'arc':
      return createArcMesh();
    case 'interlock':
      return createInterlockMesh();
    default:
      return createCoilMesh();
  }
}

export function setEnemyLocked(mesh: Object3D, locked: boolean) {
  mesh.userData.locked = locked;
  if (mesh.userData.isLetter) setLetterLocked(mesh as Group, locked);
}

export function setEnemyDenied(mesh: Object3D) {
  mesh.userData.deniedUntil = elapsedNow + 0.5;
  spawnRing(mesh.position, HAZARD_RED.clone(), 2.6, 0.32);
  // Short-circuit: a red arc snaps off the rejected target.
  spawnArc(
    mesh.position,
    mesh.position.clone().add(new Vector3((Math.random() - 0.5) * 2.4, (Math.random() - 0.5) * 2.4, 0.6)),
    HAZARD_RED.clone(),
    0.18,
    0.8,
  );
}

// The player shot: a cold ion dart — a stretched white-hot core in a
// translucent arc-blue shell, dropping a blue trail.
export function createProjectileMesh() {
  const group = new Group();
  const coreGeometry = new OctahedronGeometry(0.3, 0);
  coreGeometry.scale(0.45, 0.45, 2.3);
  group.add(new Mesh(coreGeometry, new MeshBasicMaterial({ color: hdr(ION_WHITE, 2.6) })));
  const shellGeometry = new OctahedronGeometry(0.48, 0);
  shellGeometry.scale(0.55, 0.55, 1.9);
  group.add(new Mesh(shellGeometry, createAdditiveBasicMaterial({ color: hdr(ARC_BLUE, 1.0), opacity: 0.5 })));
  projectileRecords.enqueue({ mesh: group, trailColor: ARC_BLUE.clone().multiplyScalar(0.9) });
  return group;
}

// ---- reticle: the breech charge gauge ---------------------------------------

const RETICLE_SEGMENTS = 6;

export function createReticle() {
  const group = new Group();

  const outer = new Mesh(
    new RingGeometry(0.58, 0.61, 56),
    createAdditiveBasicMaterial({ color: hdr(ARC_BLUE, 1.05), side: DoubleSide }),
  );

  // Six arc segments — one lights per lock, climbing the lock gradient, so a
  // full six-lock volley literally reads "fully charged".
  const spinner = new Group();
  const segments: MeshBasicMaterial[] = [];
  const gap = 0.17;
  const span = (Math.PI * 2) / RETICLE_SEGMENTS - gap;
  for (let i = 0; i < RETICLE_SEGMENTS; i += 1) {
    const start = i * ((Math.PI * 2) / RETICLE_SEGMENTS) + gap / 2;
    const material = createAdditiveBasicMaterial({ color: GUNMETAL.clone(), side: DoubleSide });
    spinner.add(new Mesh(new RingGeometry(0.66, 0.8, 20, 1, start, span), material));
    segments.push(material);
  }

  const dot = new Mesh(new CircleGeometry(0.055, 18), createAdditiveBasicMaterial({ color: hdr(ION_WHITE, 1.4) }));

  group.add(outer, spinner, dot);
  group.userData.isReticle = true;
  group.userData.spinner = spinner;
  group.userData.segments = segments;
  group.userData.dot = dot.material as MeshBasicMaterial;
  group.userData.active = false;
  return group;
}

export function setReticleActive(reticle: Object3D, active: boolean, lockCount: number) {
  reticle.userData.active = active;
  // The gauge grows slightly per lock and spins faster while charging.
  reticle.scale.setScalar(1 + lockCount * 0.05 + (active ? 0.04 : 0));
  const segments = reticle.userData.segments as MeshBasicMaterial[];
  for (let i = 0; i < segments.length; i += 1) {
    if (i < lockCount) {
      segments[i].color.copy(hdr(colorForLockCount(i + 1, LOCK_GRADIENT), active ? 1.7 : 1.4));
    } else {
      segments[i].color.copy(GUNMETAL).multiplyScalar(active ? 0.55 : 0.4);
    }
  }
  const dot = reticle.userData.dot as MeshBasicMaterial;
  dot.color.copy(hdr(lockCount >= RETICLE_SEGMENTS ? BLINDING : ION_WHITE, 1.2 + lockCount * 0.25));
}

// ---- event wiring -----------------------------------------------------------

export function installVisualEventHandlers(bus: EventBus, scene: Scene, cameraFeel: CameraFeelRig) {
  bus.on('spawn', ({ enemyId, kind, worldPosition }) => {
    const record = enemyRecords.claim(enemyId);
    if (!record) return;
    if (kind === 'coil') {
      spawnRing(worldPosition, hdr(ARC_BLUE, 0.9), 3.2, 0.4);
    } else if (kind === 'threader') {
      spawnGlint(worldPosition, hdr(VOLT_VIOLET, 1.1), 1.0, 0.16);
    } else if (kind === 'capacitor') {
      spawnRing(worldPosition, hdr(VOLT_VIOLET, 0.9), 4.0, 0.5);
    } else if (kind === 'interlock') {
      // A clamp slamming into the safety ring: a double hazard ring + a jolt.
      spawnRing(worldPosition, hdr(HAZARD, 1.2), 8, 0.7);
      spawnRing(worldPosition, hdr(HAZARD_RED, 0.9), 4.5, 0.5);
      cameraFeel.shake(0.5, BARREL_SHAKE);
    }
  });

  bus.on('lock', ({ enemyId, worldPosition, lockCount }) => {
    const lockColor = colorForLockCount(lockCount, LOCK_GRADIENT);
    const record = enemyRecords.get(enemyId);
    if (record && !record.lockRing) lockRings.attach(record, makeLockRing(lockColor), scene);
    spawnRing(worldPosition, hdr(lockColor, 1.4), 2.2, 0.26);
    if (lockCount >= 6) {
      // The sixth lock is the gun fully charged: a blinding clamp and a pump.
      spawnRing(worldPosition, hdr(BLINDING, 1.6), 4.2, 0.34);
      flashUniform.value = Math.max(flashUniform.value, 0.16);
    }
  });

  bus.on('unlock', ({ enemyId }) => {
    const record = enemyRecords.get(enemyId);
    if (record) lockRings.detach(record);
  });

  bus.on('fire', ({ projectileId, worldPosition }) => {
    projectileRecords.claim(projectileId);
    spawnGlint(worldPosition, hdr(ION_WHITE, 1.3), 0.5, 0.12);
  });

  bus.on('hit', ({ enemyId, projectileId, worldPosition, lethal }) => {
    projectileRecords.delete(projectileId, { dispose: true });
    burstSparks(worldPosition, hdr(ION_WHITE, 0.9), 6, 12);
    spawnGlint(worldPosition, hdr(ION_WHITE, 1.5), 0.9, 0.14);
    const record = enemyRecords.get(enemyId);
    if (record && !lethal) {
      record.mesh.userData.damageFlashUntil = elapsedNow + 0.32;
      // A chip that only strips armour crackles off the exposed core.
      spawnArc(
        worldPosition,
        worldPosition.clone().add(new Vector3((Math.random() - 0.5) * 2, (Math.random() - 0.5) * 2, 0.5)),
        hdr(ARC_BLUE, 1.2),
        0.14,
        0.9,
      );
    }
  });

  bus.on('stage', ({ enemyId, worldPosition }) => {
    const record = enemyRecords.get(enemyId);
    if (!record) return;
    const specs = record.mesh.userData.sparkSpecs as SparkSpec[] | undefined;
    if (record.mesh.userData.kind === 'capacitor') {
      // The six staves shear off along their own directions.
      breakCapacitorArmor(record.mesh);
      if (specs) burstShatter(worldPosition, specs.slice(0, 6));
      burstSparks(worldPosition, hdr(ARC_BLUE, 1.1), 12, 13);
      spawnRing(worldPosition, hdr(VOLT_VIOLET, 1.3), 5.5, 0.45);
      spawnArc(worldPosition, worldPosition.clone().add(new Vector3(1.7, 0.8, 0)), hdr(ARC_BLUE, 1.4), 0.2, 1);
    } else if (record.mesh.userData.kind === 'interlock') {
      breakInterlockCowl(record.mesh);
      if (specs) burstShatter(worldPosition, specs.slice(0, 6));
      burstSparks(worldPosition, hdr(HAZARD, 1.2), 14, 15);
      spawnRing(worldPosition, hdr(HAZARD, 1.4), 7, 0.55);
      cameraFeel.shake(0.55, BARREL_SHAKE);
    }
  });

  bus.on('kill', ({ enemyId, worldPosition }) => {
    const record = enemyRecords.get(enemyId);
    if (!record) return;
    const specs = record.mesh.userData.sparkSpecs as SparkSpec[] | undefined;
    const accent = (record.mesh.userData.accent as Color | undefined) ?? ARC_BLUE;
    if (specs) burstShatter(worldPosition, specs);
    burstSparks(worldPosition, hdr(accent, 1.0), 9, 14);
    spawnRing(worldPosition, hdr(accent, 1.0), 4.6, 0.4);
    spawnGlint(worldPosition, hdr(ION_WHITE, 1.6), 1.2, 0.18);
    // A whip of arc lightning snaps off the shattered drone.
    spawnArc(
      worldPosition,
      worldPosition.clone().add(new Vector3((Math.random() - 0.5) * 3.4, (Math.random() - 0.5) * 3.4, (Math.random() - 0.5) * 2)),
      hdr(ION_WHITE, 1.3),
      0.16,
      1,
    );

    if (record.mesh.userData.isInterlock) {
      // Interlock kills are doubled and heavier.
      cameraFeel.shake(0.7, BARREL_SHAKE);
      spawnRing(worldPosition, hdr(ION_WHITE, 1.4), 10, 0.6);
      spawnRing(worldPosition, hdr(ARC_BLUE, 1.2), 6, 0.5);
      spawnArc(
        worldPosition,
        worldPosition.clone().add(new Vector3((Math.random() - 0.5) * 6, (Math.random() - 0.5) * 6, 1)),
        hdr(HAZARD, 1.2),
        0.22,
        1.1,
      );
    }
    enemyRecords.delete(enemyId, { dispose: true });
  });

  bus.on('miss', ({ enemyId, worldPosition }) => {
    const record = enemyRecords.get(enemyId);
    if (record) enemyRecords.delete(enemyId, { dispose: true });
    // Misses fizzle — a few dim sparks, nothing rewarding.
    burstSparks(worldPosition, ARC_BLUE.clone().multiplyScalar(0.4), 3, 4);
  });

  bus.on('reject', () => {
    // Breaker trip: a cold hazard pulse across the frame, no reward.
    detonationUniform.value = Math.max(detonationUniform.value, 0.14);
    cameraFeel.shake(0.28, BARREL_SHAKE);
  });

  bus.on('volley', ({ size, kills }) => {
    if (size >= 4 && kills === size) {
      beatEnergy = Math.max(beatEnergy, 1.5);
      flashUniform.value = Math.max(flashUniform.value, size >= 6 ? 0.34 : 0.2);
    }
  });

  bus.on('beat', ({ isDownbeat }) => {
    beatEnergy = Math.max(beatEnergy, isDownbeat ? 1 : 0.45);
    // The FOV kicks a hair on every downbeat ring crossing.
    if (isDownbeat) cameraFeel.kickFov(0.5, { decay: 5.5 });
  });

  bus.on('bossphase', ({ phase }) => {
    if (phase === 'summoned') {
      cameraFeel.shake(0.6, BARREL_SHAKE);
    } else if (phase === 'destroyed') {
      // All six interlocks down: a full-tunnel white strobe sweep, and the gun
      // is committed.
      environment?.strobeRings();
      flashUniform.value = Math.max(flashUniform.value, 0.42);
      cameraFeel.shake(0.9, BARREL_SHAKE);
    }
  });

  bus.on('playerhit', ({ damage }) => {
    if (damage >= 90) {
      triggerDetonation(cameraFeel);
      return;
    }
    beatEnergy = 1.5;
    cameraFeel.shake(1.0, BARREL_SHAKE);
    detonationUniform.value = Math.max(detonationUniform.value, 0.22);
  });

  bus.on('runstart', () => {
    resetEffects();
    enemyRecords.clear({ dispose: true, pending: true });
    projectileRecords.clear({ pending: true });
    resetVisualState(cameraFeel);
  });

  bus.on('runend', ({ died }) => {
    if (died && !detonated) triggerDetonation(cameraFeel);
    resetCameraFeel(cameraFeel);
  });
}

function triggerDetonation(cameraFeel: CameraFeelRig) {
  detonated = true;
  detonationUniform.value = Math.max(detonationUniform.value, 1.0);
  flashUniform.value = Math.max(flashUniform.value, 0.9);
  cameraFeel.shake(2.0, BARREL_SHAKE);
  if (environment) {
    const at = environment.muzzlePosition;
    spawnFlash(at, HAZARD_RED.clone().multiplyScalar(1.4), 70, 0.7);
    spawnRing(at, hdr(HAZARD, 1.6), 90, 1.2);
    spawnRing(at, hdr(HAZARD_RED, 1.2), 50, 0.9);
    burstSparks(at, hdr(HAZARD, 1.2), 40, 40);
  }
}

// ---- per-frame update -------------------------------------------------------

function resetVisualState(cameraFeel: CameraFeelRig) {
  environment?.reset();
  flashUniform.value = 0;
  chargeUniform.value = 0;
  detonationUniform.value = 0;
  beatEnergy = 0;
  shotFired = false;
  detonated = false;
  resetCameraFeel(cameraFeel);
}

function resetCameraFeel(cameraFeel: CameraFeelRig) {
  lastRunTime = -1;
  cameraRoll = 0;
  cameraFovOffset = 0;
  cameraFeel.restore();
}

export function updateVisuals(dt: number, ctx: VisualContext) {
  elapsedNow = ctx.elapsed;
  beatEnergy = Math.max(0, beatEnergy - dt * 4.2);

  const runTime = ctx.running ? ctx.runTime : 0;

  updateShotMoment(ctx);

  if (environment) {
    environment.update(dt, {
      camera: ctx.camera as PerspectiveCamera,
      runTime,
      running: ctx.running,
      elapsed: ctx.elapsed,
      beatEnergy,
      onRingPass: (index, position, isDownbeat) => {
        // A heat-colored shockwave pulse at the exact crossing — bigger and
        // brighter on downbeats.
        spawnRing(position, hdr(heatColorAt(index / (RING_COUNT - 1)), isDownbeat ? 1.6 : 1.0), isDownbeat ? 3.4 : 2.2, 0.3);
      },
    });
  }

  updatePostUniforms(dt, ctx, runTime);

  for (const [enemyId, record] of enemyRecords.entries()) {
    if (!record.mesh.parent) {
      enemyRecords.delete(enemyId, { dispose: true });
      continue;
    }
    if (record.bornAt === null) record.bornAt = elapsedNow;
    const age = elapsedNow - record.bornAt;
    // Pop in with a quick overshoot.
    record.mesh.scale.setScalar(easeOutBack(Math.min(1, age / 0.35)));

    updateEnemyTint(record, ctx);

    // Ball lightning re-randomizes its jagged shells every frame — the tell.
    const shells = record.mesh.userData.arcShells as Mesh[] | undefined;
    if (shells) {
      for (const shell of shells) {
        shell.rotation.set(Math.random() * 6.28, Math.random() * 6.28, Math.random() * 6.28);
        shell.scale.setScalar(0.9 + Math.random() * 0.25);
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

  updateReticle(dt, ctx.scene);
  updateEffects(dt, ctx.camera);
}

// THE SHOT: catch the SHOT_TIME crossing and slam every sense at once.
function updateShotMoment(ctx: VisualContext) {
  if (!ctx.running) {
    lastRunTime = -1;
    return;
  }
  const crossedShot = lastRunTime >= 0 && lastRunTime < SHOT_TIME && ctx.runTime >= SHOT_TIME;
  if (crossedShot && !shotFired) {
    shotFired = true;
    if (!detonated) {
      // Clean muzzle exit: full whiteout, a wide FOV punch, the barrel rings.
      flashUniform.value = Math.max(flashUniform.value, 1.2);
      ctx.feel.kickFov(9, { decay: 2.4 });
      ctx.feel.shake(1.6, BARREL_SHAKE);
      if (environment) spawnFlash(environment.muzzlePosition, hdr(BLINDING, 1.6), 64, 0.55);
    }
  }
  lastRunTime = ctx.runTime;
}

export function updateCameraEffects(dt: number, ctx: CameraEffectsContext) {
  const runTime = ctx.running ? ctx.runTime : 0;
  const speed = ctx.running ? speedFactorAt(runTime) : 0.46;
  if (!(ctx.camera instanceof PerspectiveCamera)) return;
  const camera = ctx.camera;

  // The FOV breathes with airspeed; the post-shot surge opens it hard.
  const targetFovOffset = (speed - 0.7) * 8 + beatEnergy * 0.9;
  cameraFovOffset = MathUtils.lerp(cameraFovOffset, targetFovOffset, Math.min(1, dt * 6));

  if (ctx.running) {
    // Bank subtly into the bore weave — a cosmetic roll only, applied after
    // the runner's lookAt.
    const u = massDriverRunProgress(ctx.runTime, RUN_DURATION);
    const tangent = rail.getTangentAt(MathUtils.clamp(u, 0, 1));
    const ahead = rail.getTangentAt(MathUtils.clamp(u + 0.006, 0, 1));
    const targetRoll = MathUtils.clamp((ahead.x - tangent.x) * 26, -0.12, 0.12);
    cameraRoll += (targetRoll - cameraRoll) * Math.min(1, dt * 3.2);
    camera.rotateZ(cameraRoll);
  }

  ctx.feel.setFovOffset(cameraFovOffset);
  ctx.feel.update(dt, { shake: BARREL_SHAKE });
}

function updatePostUniforms(dt: number, ctx: VisualContext, runTime: number) {
  // The charge overlay ramps through the interlock bars but is held back (a
  // quadratic) so the fight stays readable until the last bar and a half; it
  // cuts to zero past the shot.
  const chargeLinear = ctx.running && runTime >= INTERLOCK_TIME && runTime < SHOT_TIME
    ? MathUtils.clamp((runTime - INTERLOCK_TIME) / Math.max(0.001, SHOT_TIME - INTERLOCK_TIME), 0, 1)
    : 0;
  const chargeTarget = chargeLinear * chargeLinear * 0.75;
  chargeUniform.value += (chargeTarget - chargeUniform.value) * Math.min(1, dt * 2.2);

  flashUniform.value = Math.max(0, flashUniform.value - dt * (flashUniform.value > 0.8 ? 1.4 : 2.6));
  detonationUniform.value = Math.max(0, detonationUniform.value - dt * (detonationUniform.value > 0.5 ? 0.9 : 2.2));
}

function updateReticle(dt: number, scene: Scene) {
  const reticle = scene.children.find((child) => child.userData.isReticle);
  if (!reticle) return;
  const active = reticle.userData.active === true;
  const spinner = reticle.userData.spinner as Group | undefined;
  if (spinner) spinner.rotation.z += dt * (active ? -2.5 : -0.6);
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

  const distance = record.mesh.position.distanceTo((ctx.camera as PerspectiveCamera).position);
  const closeness = smootherstep(1 - clamp01((distance - 14) / (92 - 14)));
  const locked = userData.locked === true;
  const damageFlash = ((userData.damageFlashUntil as number | undefined) ?? -Infinity) > elapsedNow;
  // A firing coil runs its eye hot through the rear-back — the tell.
  const telegraph = (userData.telegraph as number | undefined) ?? 0;

  for (const part of parts) {
    if (denied) {
      part.material.color.copy(part.kind === 'fill' ? HAZARD_FILL : DENY_EDGE);
      continue;
    }
    if (locked) {
      if (part.kind === 'edge') part.material.color.copy(hdr(ION_WHITE, 1.6));
      else if (part.kind === 'fill') part.material.color.copy(LOCK_FILL);
      else part.material.color.copy(hdr(ION_WHITE, 2.0));
      continue;
    }
    if (damageFlash) {
      part.material.color.copy(hdr(BLINDING, part.kind === 'fill' ? 0.5 : 1.8));
      continue;
    }
    const dim = part.kind === 'edge'
      ? 0.55 + 0.45 * closeness
      : part.kind === 'fill'
        ? 0.35 + 0.65 * closeness
        : 0.4 + 0.6 * closeness;
    part.material.color.copy(part.base).multiplyScalar(dim * (part.kind === 'core' ? 1 + telegraph * 1.6 : 1));
  }
}

function makeLockRing(color: Color): Group {
  const group = new Group();
  // A hexagonal clamp of two nested rings — cold, mechanical, precise.
  const ring = new Mesh(
    new RingGeometry(0.86, 0.92, 6),
    createAdditiveBasicMaterial({ color: hdr(color, 1.8), side: DoubleSide }),
  );
  const inner = new Mesh(
    new RingGeometry(0.66, 0.69, 6),
    createAdditiveBasicMaterial({ color: hdr(color.clone().lerp(ION_WHITE, 0.5), 1.5), side: DoubleSide }),
  );
  inner.rotation.z = Math.PI / 6;
  group.add(ring, inner);
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
