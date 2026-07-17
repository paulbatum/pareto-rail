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
import { INTERLOCK_TIME, MD_BEAT, MD_DURATION, SHOT_TIME } from '../timing';
import {
  breakCapacitorStaves,
  createArcMesh,
  createCapacitorMesh,
  createCoilMesh,
  createInterlockMesh,
  createThreaderMesh,
  popInterlockCowl,
  type TintPart,
} from './enemies';
import { beatUniform, chargeUniform, createEnvironmentInternal, type Environment } from './environment';
import {
  burstFacets,
  burstSparks,
  createEffects,
  dropTrail,
  resetEffects,
  spawnArcLightning,
  spawnArcWhip,
  spawnFlashDisc,
  spawnGlint,
  spawnRing,
  updateEffects,
  type SparkSpec,
} from './effects';
import { createLetterMesh, setLetterDenied, setLetterLocked } from './letters';
import { ARC_BLUE, BLINDING, HAZARD_AMBER, HAZARD_RED, hdr, heatColor, ION_WHITE, LOCK_GRADIENT, VOLT_VIOLET } from './palette';
import { chargeOverlayUniform, detonationUniform, flashUniform } from './post-fx';

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
  baseScale: number;
  lockRing: Group | null;
};

type ProjectileRecord = {
  mesh: Object3D;
  trailColor: Color;
};

const DENY_RED = hdr(HAZARD_RED, 1.5);
const DENY_FILL = new Color(0.26, 0.02, 0.01);

// Metallic gun-barrel rattle: quick and tight, more roll than pitch — the
// whole barrel ringing rather than a soft impact.
const RATTLE: CameraFeelShakeOptions = {
  decay: 3.0,
  maxTrauma: 2.0,
  pitchDegrees: 0.3,
  yawDegrees: 0.22,
  rollDegrees: 0.95,
  frequency: 12,
  smoothing: 26,
};

let environment: Environment | null = null;
let beatEnergy = 0;
let elapsedNow = 0;
let lastRunTime = -1;
let lastCrossing = -1;
let cameraRoll = 0;
let cameraFovOffset = 0;
let shotDone = false;
let detonationActive = false;
let detonationStartedAt = -1;
let interlocksAlive = 0;
let interlockKills = 0;
let chargeLevel = 0;

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
  createRecord: (mesh) => ({ mesh, bornAt: null, baseScale: (mesh.userData.baseScale as number) ?? 1, lockRing: null }),
  disposeRecord: (record) => {
    lockRings.detach(record);
    // The runner only removes meshes from the scene; free the GPU resources
    // here or a full run leaks hundreds of geometries.
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
  mesh.userData.baseScale = mesh.scale.x;
  mesh.scale.setScalar(0.001);
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
  spawnRing(mesh.position, DENY_RED.clone(), 2.4, 0.3);
  detonationUniform.value = Math.max(detonationUniform.value, 0.16);
}

// Player shot: a cold ion dart — a stretched white-hot core in a translucent
// arc-blue shell, dropping a blue trail.
export function createProjectileMesh() {
  const group = new Group();
  const coreGeometry = new OctahedronGeometry(0.3, 0);
  coreGeometry.scale(0.45, 0.45, 2.4);
  group.add(new Mesh(coreGeometry, new MeshBasicMaterial({ color: hdr(ION_WHITE, 2.6) })));
  const shellGeometry = new OctahedronGeometry(0.48, 0);
  shellGeometry.scale(0.55, 0.55, 2.0);
  group.add(new Mesh(shellGeometry, createAdditiveBasicMaterial({ color: hdr(ARC_BLUE, 1.0), opacity: 0.5 })));
  projectileRecords.enqueue({ mesh: group, trailColor: ARC_BLUE.clone().multiplyScalar(0.85) });
  return group;
}

// ---- reticle: the breech charge gauge ------------------------------------------

// A thin arc-blue ring around an ion-white center dot, with six arc segments
// that light one per lock, climbing the lock gradient — the sixth segment is
// ignition-white, so a full volley literally reads "fully charged".
export function createReticle() {
  const group = new Group();

  const outerMaterial = createAdditiveBasicMaterial({ color: hdr(ARC_BLUE, 1.2), side: DoubleSide });
  group.add(new Mesh(new RingGeometry(0.6, 0.635, 48), outerMaterial));

  const dotMaterial = createAdditiveBasicMaterial({ color: hdr(ION_WHITE, 2.0), side: DoubleSide });
  group.add(new Mesh(new CircleGeometry(0.05, 16), dotMaterial));

  const spinner = new Group();
  const segments: MeshBasicMaterial[] = [];
  const SEGMENT_SWEEP = (Math.PI * 2) / 6 - 0.18;
  for (let i = 0; i < 6; i += 1) {
    const material = createAdditiveBasicMaterial({ color: ARC_BLUE.clone().multiplyScalar(0.18), side: DoubleSide });
    const segment = new Mesh(new RingGeometry(0.75, 0.82, 14, 1, (i / 6) * Math.PI * 2 + 0.09, SEGMENT_SWEEP), material);
    spinner.add(segment);
    segments.push(material);
  }
  group.add(spinner);

  group.userData.outerMaterial = outerMaterial;
  group.userData.dotMaterial = dotMaterial;
  group.userData.segments = segments;
  group.userData.spinner = spinner;
  group.userData.active = false;
  group.userData.lockCount = 0;
  return group;
}

export function setReticleActive(reticle: Object3D, active: boolean, lockCount: number) {
  reticle.userData.active = active;
  reticle.userData.lockCount = lockCount;
  // Grows slightly per lock.
  reticle.scale.setScalar(1 + lockCount * 0.055 + (active ? 0.05 : 0));
  const segments = reticle.userData.segments as MeshBasicMaterial[];
  for (const [index, material] of segments.entries()) {
    if (index < lockCount) {
      const charge = index === 5 ? hdr(BLINDING, 2.5) : hdr(heatColor((index + 1) / 6), 1.8);
      material.color.copy(charge);
    } else {
      material.color.copy(ARC_BLUE).multiplyScalar(active ? 0.3 : 0.18);
    }
  }
  const outer = reticle.userData.outerMaterial as MeshBasicMaterial;
  const lockColor = lockCount === 0 ? null : colorForLockCount(lockCount, LOCK_GRADIENT);
  outer.color.copy(lockColor ? hdr(lockColor, 1.5) : hdr(ARC_BLUE, active ? 1.5 : 1.2));
}

// ---- event wiring ---------------------------------------------------------------

export function installVisualEventHandlers(bus: EventBus, scene: Scene, cameraFeel: CameraFeelRig) {
  bus.on('spawn', ({ enemyId, kind, worldPosition }) => {
    const record = enemyRecords.claim(enemyId);
    if (!record) return;
    if (kind === 'interlock') {
      interlocksAlive += 1;
      // Every interlock arrival lands a double hazard ring and a camera jolt.
      spawnRing(worldPosition, hdr(HAZARD_AMBER, 1.4), 9, 0.55);
      spawnRing(worldPosition, hdr(HAZARD_AMBER, 0.9), 5, 0.4);
      cameraFeel.shake(0.55, RATTLE);
    } else if (kind === 'arc') {
      spawnRing(worldPosition, hdr(ARC_BLUE, 1.2), 2.2, 0.3);
    } else if (kind !== 'letter') {
      spawnRing(worldPosition, hdr(heatColor(chargeLevel * 0.6 + 0.1), 0.8), 2.4, 0.35);
    }
  });

  bus.on('lock', ({ enemyId, worldPosition, lockCount }) => {
    const lockColor = colorForLockCount(lockCount, LOCK_GRADIENT);
    const record = enemyRecords.get(enemyId);
    if (record && !record.lockRing) {
      lockRings.attach(record, makeLockRing(lockColor), scene);
    }
    spawnRing(worldPosition, hdr(lockColor, 1.4), 2.0, 0.26);
    if (lockCount >= 6) {
      // The sixth lock pumps a blinding bloom: fully charged.
      flashUniform.value = Math.max(flashUniform.value, 0.16);
      spawnGlint(worldPosition, hdr(BLINDING, 2.0), 1.4, 0.2);
    }
  });

  bus.on('unlock', ({ enemyId }) => {
    const record = enemyRecords.get(enemyId);
    if (record) lockRings.detach(record);
  });

  bus.on('fire', ({ worldPosition, projectileId }) => {
    projectileRecords.claim(projectileId);
    spawnGlint(worldPosition, hdr(ION_WHITE, 1.2), 0.5, 0.12);
  });

  bus.on('hit', ({ enemyId, projectileId, worldPosition, lethal }) => {
    projectileRecords.delete(projectileId, { dispose: true });
    burstSparks(worldPosition, hdr(ION_WHITE, 0.9), 5, 11);
    spawnGlint(worldPosition, hdr(ION_WHITE, 1.6), 1.0, 0.15);
    const record = enemyRecords.get(enemyId);
    if (record && !lethal) {
      record.mesh.userData.damageFlashUntil = elapsedNow + 0.3;
      // Armor chips whip a short arc of lightning off the impact.
      spawnArcWhip(worldPosition, hdr(ARC_BLUE, 1.5), 2.6, 0.22);
    }
  });

  bus.on('stage', ({ enemyId, worldPosition }) => {
    const record = enemyRecords.get(enemyId);
    if (!record) return;
    if (record.mesh.userData.kind === 'capacitor') {
      // The staves shear off in a burst along the six stave directions.
      breakCapacitorStaves(record.mesh);
      const specs = record.mesh.userData.staveSpecs as SparkSpec[] | undefined;
      if (specs) burstFacets(worldPosition, specs, 12);
      spawnRing(worldPosition, hdr(VOLT_VIOLET, 1.4), 5.5, 0.45);
      spawnArcWhip(worldPosition, hdr(VOLT_VIOLET, 1.6), 3.6, 0.3);
      spawnArcWhip(worldPosition, hdr(ARC_BLUE, 1.4), 3.0, 0.26);
    } else if (record.mesh.userData.kind === 'interlock') {
      popInterlockCowl(record.mesh);
      spawnRing(worldPosition, hdr(HAZARD_AMBER, 1.5), 7, 0.5);
      spawnRing(worldPosition, hdr(ION_WHITE, 1.1), 4, 0.35);
      spawnArcWhip(worldPosition, hdr(ION_WHITE, 1.7), 4.2, 0.32);
      cameraFeel.shake(0.4, RATTLE);
    }
  });

  bus.on('kill', ({ enemyId, worldPosition }) => {
    const record = enemyRecords.get(enemyId);
    if (record) {
      const specs = record.mesh.userData.shardSpecs as SparkSpec[] | undefined;
      const accent = (record.mesh.userData.accent as Color | undefined) ?? ARC_BLUE;
      const isInterlock = record.mesh.userData.kind === 'interlock';
      if (specs) burstFacets(worldPosition, specs, isInterlock ? 15 : 10);
      burstSparks(worldPosition, hdr(accent, 1.0), isInterlock ? 16 : 8, isInterlock ? 20 : 13);
      spawnRing(worldPosition, hdr(accent, 0.9), isInterlock ? 10 : 4.4, isInterlock ? 0.6 : 0.4);
      spawnGlint(worldPosition, hdr(ION_WHITE, 1.6), isInterlock ? 2.4 : 1.1, 0.18);
      spawnArcWhip(worldPosition, hdr(accent, 1.6), isInterlock ? 5.5 : 3.2, 0.3);
      if (isInterlock) {
        // Interlock kills are doubled and heavier.
        spawnArcWhip(worldPosition, hdr(ION_WHITE, 1.8), 6.5, 0.36);
        spawnRing(worldPosition, hdr(ION_WHITE, 1.2), 6, 0.45);
        cameraFeel.shake(0.7, RATTLE);
        interlocksAlive = Math.max(0, interlocksAlive - 1);
        interlockKills += 1;
        if (interlockKills >= 6 && environment) {
          // INTERLOCKS CLEAR: a brief full-tunnel white strobe sweep.
          environment.triggerStrobe(elapsedNow);
          flashUniform.value = Math.max(flashUniform.value, 0.42);
          cameraFeel.shake(0.6, RATTLE);
        }
      }
      enemyRecords.delete(enemyId, { dispose: true });
    }
  });

  bus.on('miss', ({ enemyId, worldPosition }) => {
    const record = enemyRecords.get(enemyId);
    if (record) {
      if (record.mesh.userData.kind === 'interlock') interlocksAlive = Math.max(0, interlocksAlive - 1);
      enemyRecords.delete(enemyId, { dispose: true });
    }
    // Misses fizzle.
    burstSparks(worldPosition, ARC_BLUE.clone().multiplyScalar(0.35), 3, 3);
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
    cameraFeel.shake(1.2, RATTLE);
    detonationUniform.value = Math.max(detonationUniform.value, 0.3);
  });

  bus.on('runstart', () => {
    resetEffects();
    enemyRecords.clear({ dispose: true, pending: true });
    projectileRecords.clear({ dispose: true, pending: true });
    resetCameraFeel(cameraFeel);
    flashUniform.value = 0;
    chargeOverlayUniform.value = 0;
    detonationUniform.value = 0;
    chargeUniform.value = 0;
    shotDone = false;
    detonationActive = false;
    detonationStartedAt = -1;
    interlocksAlive = 0;
    interlockKills = 0;
    chargeLevel = 0;
    lastCrossing = -1;
    environment?.reset(scene);
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
  beatEnergy = Math.max(0, beatEnergy - dt * 4.4);
  beatUniform.value = beatEnergy;

  const runTime = ctx.running ? ctx.runTime : 0;
  const speed = ctx.running ? speedFactorAt(runTime) : 0.4;

  // The firing charge builds through the interlock bars whether or not the
  // player is ready; the shot (or the detonation) zeroes it.
  chargeLevel = !ctx.running || shotDone || detonationActive
    ? 0
    : MathUtils.smoothstep(runTime, INTERLOCK_TIME, SHOT_TIME - 0.1);
  chargeUniform.value = chargeLevel;

  updateRingCrossings(ctx, runTime);
  updateShotMoment(ctx);

  environment?.update(dt, {
    scene: ctx.scene,
    cameraPosition: (ctx.camera as PerspectiveCamera).position,
    cameraQuaternion: (ctx.camera as PerspectiveCamera).quaternion,
    elapsed: ctx.elapsed,
    runTime,
    running: ctx.running,
    speedFactor: speed,
    charge: chargeLevel,
    shotDone,
  });

  updatePostUniforms(dt);

  for (const [enemyId, record] of enemyRecords.entries()) {
    if (!record.mesh.parent) {
      enemyRecords.delete(enemyId, { dispose: true });
      continue;
    }
    if (record.bornAt === null) record.bornAt = elapsedNow;
    const age = elapsedNow - record.bornAt;
    // Pop in with a quick overshoot.
    record.mesh.scale.setScalar(record.baseScale * easeOutBack(Math.min(1, age / 0.35)));

    updateEnemyTint(record, ctx);

    // Arc bolts: the wire shells re-randomize rotation and scale every frame.
    const jitterShells = record.mesh.userData.jitterShells as Group | undefined;
    if (jitterShells) {
      for (const shell of jitterShells.children) {
        shell.rotation.set(Math.random() * Math.PI * 2, Math.random() * Math.PI * 2, Math.random() * Math.PI * 2);
        shell.scale.setScalar(0.8 + Math.random() * 0.45);
      }
    }

    if (record.mesh.userData.isHostileShot) {
      dropTrail(record.mesh.position, record.mesh.userData.trailColor as Color);
    }

    if (record.lockRing) {
      record.mesh.getWorldPosition(record.lockRing.position);
      record.lockRing.quaternion.copy((ctx.camera as PerspectiveCamera).quaternion);
      record.lockRing.rotation.z += dt * 1.6;
      const pulse = 1 + Math.sin(elapsedNow * 9) * 0.05;
      const fit = (record.mesh.userData.lockRingScale as number | undefined) ?? 1;
      record.lockRing.scale.setScalar(pulse * 1.8 * fit);
    }
  }

  for (const [projectileId, record] of projectileRecords.entries()) {
    if (!record.mesh.parent) {
      projectileRecords.delete(projectileId, { dispose: true });
      continue;
    }
    dropTrail(record.mesh.position, record.trailColor);
  }

  const reticle = findReticle(ctx.scene);
  if (reticle) {
    const spinner = reticle.userData.spinner as Group;
    const active = reticle.userData.active === true;
    const lockCount = (reticle.userData.lockCount as number) ?? 0;
    // The gauge spins faster while charging.
    spinner.rotation.z += dt * (active ? 2.2 + lockCount * 0.9 : 0.6);
  }

  updateEffects(dt, ctx.camera);
}

// One glowing accelerator ring crossed on every quarter-note beat: flash it,
// kick the camera a hair on downbeats, and throw a heat-colored shockwave
// pulse at the moment of crossing.
function updateRingCrossings(ctx: VisualContext, runTime: number) {
  if (!ctx.running || !environment || runTime >= SHOT_TIME) return;
  const crossing = Math.floor(runTime / MD_BEAT);
  if (crossing <= lastCrossing || crossing < 1) {
    lastCrossing = Math.max(lastCrossing, crossing);
    return;
  }
  lastCrossing = crossing;
  const downbeat = crossing % 4 === 0;
  const color = hdr(heatColor(crossing / (SHOT_TIME / MD_BEAT)), downbeat ? 1.5 : 1.0);
  spawnRing(
    environment.ringPosition(crossing),
    color,
    downbeat ? 15 : 9,
    downbeat ? 0.5 : 0.34,
    environment.ringQuaternion(crossing),
  );
  if (downbeat) ctx.feel.kickFov(1.1, { decay: 6 });
}

// THE SHOT — the downbeat of bar 28. A hard cut, not a crossfade. If any
// interlock still stands, this is the detonation instead.
function updateShotMoment(ctx: VisualContext) {
  if (!ctx.running) {
    lastRunTime = -1;
    return;
  }
  const crossed = lastRunTime >= 0 && lastRunTime < SHOT_TIME && ctx.runTime >= SHOT_TIME;
  if (crossed && !shotDone && !detonationActive && environment) {
    if (interlocksAlive > 0) {
      // CHARGE CONTAINMENT FAILED.
      detonationActive = true;
      detonationStartedAt = elapsedNow;
      detonationUniform.value = 1.5;
      flashUniform.value = 0.5;
      ctx.feel.shake(2.0, RATTLE);
      ctx.feel.kickFov(9, { decay: 2.4 });
      spawnFlashDisc(environment.muzzlePosition, hdr(HAZARD_RED, 2.2), 60, 0.9);
      for (let i = 0; i < 5; i += 1) spawnArcWhip(environment.muzzlePosition, hdr(HAZARD_RED, 2.0), 18, 0.5);
    } else {
      // PAYLOAD AWAY: speed spike, whiteout, FOV kick — and silence beyond.
      shotDone = true;
      flashUniform.value = 1.35;
      ctx.feel.shake(1.7, RATTLE);
      ctx.feel.kickFov(13, { decay: 2.0 });
      spawnFlashDisc(environment.muzzlePosition, hdr(ION_WHITE, 2.4), 80, 1.1);
      spawnRing(environment.muzzlePosition, hdr(BLINDING, 1.8), 90, 1.2, environment.ringQuaternion(SHOT_TIME / MD_BEAT - 1));
      spawnRing(environment.muzzlePosition, hdr(VOLT_VIOLET, 1.2), 50, 0.9, environment.ringQuaternion(SHOT_TIME / MD_BEAT - 1));
    }
  }
  lastRunTime = ctx.runTime;
}

function updatePostUniforms(dt: number) {
  flashUniform.value = Math.max(0, flashUniform.value - dt * (flashUniform.value > 0.8 ? 1.5 : 2.6));
  // The visible firing charge pools at frame center, held back enough that
  // the fight stays readable until the last bar and a half.
  const overlayTarget = chargeLevel ** 3 * 0.5;
  chargeOverlayUniform.value += (overlayTarget - chargeOverlayUniform.value) * Math.min(1, dt * 3);
  // The detonation overload burns hard, then bleeds out over a few seconds
  // (the run ends almost immediately; the slow tail only matters to immortal
  // debug runs and the end panel).
  const sinceDetonation = detonationActive ? elapsedNow - detonationStartedAt : Infinity;
  const detonationFloor = detonationActive ? Math.max(0, 0.9 - sinceDetonation * 0.3) : 0;
  detonationUniform.value = Math.max(detonationFloor, detonationUniform.value - dt * 2.2);
}

export function updateCameraEffects(dt: number, ctx: CameraEffectsContext) {
  if (!(ctx.camera instanceof PerspectiveCamera)) return;
  const camera = ctx.camera;
  const runTime = ctx.running ? ctx.runTime : 0;
  const speed = ctx.running ? speedFactorAt(runTime) : 0.4;

  // The field of view breathes with airspeed and the building charge.
  const targetFovOffset = (speed - 0.7) * 4.2 + beatEnergy * 0.8 + chargeLevel * 2.5;
  cameraFovOffset = MathUtils.lerp(cameraFovOffset, targetFovOffset, Math.min(1, dt * 6));

  if (ctx.running) {
    // Bank subtly into the weave — a cosmetic roll only, applied after the
    // runner's lookAt so lock hit-testing stays honest.
    const u = massDriverRunProgress(runTime, MD_DURATION);
    const tangent = rail.getTangentAt(MathUtils.clamp(u, 0, 1));
    const ahead = rail.getTangentAt(MathUtils.clamp(u + 0.006, 0, 1));
    const targetRoll = MathUtils.clamp((ahead.x - tangent.x) * 34, -0.15, 0.15);
    cameraRoll += (targetRoll - cameraRoll) * Math.min(1, dt * 3.4);
    camera.rotateZ(cameraRoll);
  }

  ctx.feel.setFovOffset(cameraFovOffset);
  ctx.feel.update(dt, { shake: RATTLE });
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

  // Enemies brighten as they close; distance falloff keeps far additive
  // stacks from blobbing under bloom.
  const distance = record.mesh.position.distanceTo((ctx.camera as PerspectiveCamera).position);
  const closeness = smootherstep(1 - clamp01((distance - 18) / (95 - 18)));
  const locked = userData.locked === true;
  const damageFlash = ((userData.damageFlashUntil as number | undefined) ?? -Infinity) > elapsedNow;

  for (const part of parts) {
    if (denied) {
      part.material.color.copy(part.kind === 'fill' ? DENY_FILL : DENY_RED);
      continue;
    }
    if (locked) {
      if (part.kind === 'edge') part.material.color.copy(hdr(ION_WHITE, 1.6));
      else if (part.kind === 'fill') part.material.color.copy(ARC_BLUE.clone().multiplyScalar(0.3));
      else part.material.color.copy(hdr(ION_WHITE, 2.1));
      continue;
    }
    if (damageFlash) {
      part.material.color.copy(hdr(BLINDING, part.kind === 'fill' ? 0.5 : 1.9));
      continue;
    }
    const dim = part.kind === 'edge' ? 0.5 + 0.5 * closeness : part.kind === 'fill' ? 0.35 + 0.65 * closeness : 0.4 + 0.6 * closeness;
    part.material.color.copy(part.base).multiplyScalar(dim);
  }
}

function findReticle(scene: Scene): Object3D | null {
  for (const child of scene.children) {
    if (child.userData.raildRole === 'reticle') return child;
  }
  return null;
}

// Lock ring: a hexagonal clamp of two nested rings, camera-facing and slowly
// rotating; oversized on the interlocks via lockRingScale.
function makeLockRing(color: Color): Group {
  const group = new Group();
  const outer = new Mesh(
    new RingGeometry(0.88, 0.94, 6),
    createAdditiveBasicMaterial({ color: hdr(color, 1.8), side: DoubleSide }),
  );
  const inner = new Mesh(
    new RingGeometry(0.66, 0.7, 6),
    createAdditiveBasicMaterial({ color: hdr(color.clone().lerp(ION_WHITE, 0.5), 1.4), side: DoubleSide }),
  );
  inner.rotation.z = Math.PI / 6;
  group.add(outer, inner);
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

export { spawnArcLightning };
