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
import { createAdornmentSlot, createPendingVisualRecords, configureAdditiveMaterial } from '../../../engine/visual-kit';
import type { EventBus } from '../../../events';
import {
  CLIMB_LENGTH,
  CLOUDBREAK_TIME,
  createSkyhookRail,
  railSAt,
  SKYHOOK_PLAYER_HEALTH,
  skyhookRunProgress,
  speedFactorAt,
  THIN_TIME,
} from '../gameplay';
import {
  breakBulwarkArmor,
  createBulwarkMesh,
  createDartMesh,
  createGrapplerMesh,
  createKiteMesh,
  createRipperMesh,
  createRivetMesh,
  createVaneMesh,
  shedRipperCarapace,
  type TintPart,
} from './enemies';
import { createEnvironmentInternal, type Environment } from './environment';
import {
  burstShards,
  burstSparks,
  createEffects,
  dropTrail,
  resetEffects,
  spawnGlint,
  spawnRing,
  spawnWisp,
  updateEffects,
  type ShardSpec,
} from './effects';
import { createLetterMesh, setLetterDenied, setLetterLocked } from './letters';
import {
  DANGER_RED,
  HAZARD_ORANGE,
  hdr,
  LOCK_GRADIENT,
  PALE_CORE,
  SIGNAL_GREEN,
  SIGNAL_WHITE,
  STORM_GREY,
  WARN_AMBER,
} from './palette';
import { chillUniform, flashUniform } from './post-fx';

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

const DENY_RED = new Color(1.5, 0.1, 0.05);
const DENY_FILL = new Color(0.28, 0.02, 0.01);

let environment: Environment | null = null;
let beatEnergy = 0;
let cameraRoll = 0;
let cameraFovOffset = 0;
let surgePulse = 0;
let elapsedNow = 0;
let lastRunTime = -1;
let hullRemaining = SKYHOOK_PLAYER_HEALTH;
let bossKilledAt = -1;
let altitudeNow = 0;
let sceneCamera: PerspectiveCamera | null = null;

const scratchDir = new Vector3();
const scratchRight = new Vector3();
const scratchUp = new Vector3();

const SKYHOOK_CAMERA_SHAKE: CameraFeelShakeOptions = {
  decay: 2.4,
  maxTrauma: 1.7,
  pitchDegrees: 0.34,
  yawDegrees: 0.3,
  rollDegrees: 0.7,
  frequency: 8,
  smoothing: 20,
};

const rail = createSkyhookRail();

// Lock rings share two module-scope geometries; only their materials are
// per-instance, so detach disposes materials and leaves the geometry alone.
const lockRingOuterGeometry = new RingGeometry(0.85, 0.91, 4);
const lockRingInnerGeometry = new RingGeometry(0.65, 0.68, 32);

const lockRings = createAdornmentSlot<EnemyRecord, Group>({
  get: (record) => record.lockRing,
  set: (record, ring) => {
    record.lockRing = ring;
  },
  disposeAdornment(ring) {
    ring.traverse((child) => {
      const material = (child as Mesh).material as MeshBasicMaterial | undefined;
      material?.dispose?.();
    });
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
    case 'vane':
      return createVaneMesh();
    case 'dart':
      return createDartMesh();
    case 'grappler':
      return createGrapplerMesh();
    case 'bulwark':
      return createBulwarkMesh();
    case 'rivet':
      return createRivetMesh();
    case 'ripper':
      return createRipperMesh();
    default:
      return createKiteMesh();
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

// Player shot: a signal-green tracer dart.
export function createProjectileMesh() {
  const group = new Group();
  const coreGeometry = new OctahedronGeometry(0.32, 0);
  coreGeometry.scale(0.45, 0.45, 2.2);
  group.add(new Mesh(coreGeometry, new MeshBasicMaterial({ color: hdr(SIGNAL_WHITE, 2.4) })));
  const shellGeometry = new OctahedronGeometry(0.5, 0);
  shellGeometry.scale(0.55, 0.55, 1.9);
  group.add(new Mesh(
    shellGeometry,
    configureAdditiveMaterial(new MeshBasicMaterial({ color: hdr(SIGNAL_GREEN, 1.0), opacity: 0.5 })),
  ));
  projectileRecords.enqueue({ mesh: group, trailColor: SIGNAL_GREEN.clone().multiplyScalar(0.8) });
  return group;
}

// ---- reticle ----------------------------------------------------------------

// A utilitarian docking sight: outer gimbal ring, square inner frame, four
// tick marks, center pip. Signal green — nav-light hardware, not neon.
export function createReticle() {
  const group = new Group();
  const parts: Array<{ material: MeshBasicMaterial; base: Color }> = [];

  const addPart = (mesh: Mesh, base: Color) => {
    const material = configureAdditiveMaterial(mesh.material as MeshBasicMaterial, { color: base, side: DoubleSide });
    parts.push({ material, base });
  };

  const outer = new Mesh(new RingGeometry(0.6, 0.64, 40), new MeshBasicMaterial());
  addPart(outer, hdr(SIGNAL_GREEN, 1.1));

  const spinner = new Group();
  const inner = new Mesh(new RingGeometry(0.4, 0.43, 4), new MeshBasicMaterial());
  addPart(inner, hdr(SIGNAL_WHITE, 0.95));
  spinner.add(inner);

  const brackets = new Group();
  for (let i = 0; i < 4; i += 1) {
    const tick = new Mesh(new PlaneGeometry(0.2, 0.045), new MeshBasicMaterial());
    addPart(tick, hdr(SIGNAL_GREEN, 1.3));
    const angle = (i / 4) * Math.PI * 2;
    tick.position.set(Math.cos(angle) * 0.8, Math.sin(angle) * 0.8, 0);
    tick.rotation.z = angle;
    brackets.add(tick);
  }

  const dot = new Mesh(new CircleGeometry(0.05, 16), new MeshBasicMaterial());
  addPart(dot, hdr(SIGNAL_WHITE, 2.0));

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
  // Charging walks the sight green → white → amber; the sixth lock reads as commit.
  const charge = lockCount === 0 ? null : colorForLockCount(lockCount, LOCK_GRADIENT);
  for (const part of parts) {
    if (charge) part.material.color.copy(hdr(charge, active ? 1.6 : 1.25));
    else part.material.color.copy(part.base).multiplyScalar(active ? 1.3 : 1);
  }
}

// ---- event wiring -----------------------------------------------------------

export function installVisualEventHandlers(bus: EventBus, scene: Scene, cameraFeel: CameraFeelRig) {
  bus.on('spawn', ({ enemyId, kind, worldPosition }) => {
    const record = enemyRecords.claim(enemyId);
    if (!record) return;
    if (kind === 'ripper') {
      // The latch: the whole frame answers.
      cameraFeel.shake(1.1, SKYHOOK_CAMERA_SHAKE);
      surgePulse = Math.max(surgePulse, 0.5);
      flashUniform.value = Math.max(flashUniform.value, 0.35);
      spawnRing(worldPosition, hdr(HAZARD_ORANGE, 1.2), 30, 0.9);
      spawnRing(worldPosition, hdr(DANGER_RED, 1.0), 16, 0.7);
    } else if (kind === 'grappler') {
      spawnRing(worldPosition, hdr(DANGER_RED, 1.0), 3.4, 0.5);
    } else if (kind !== 'rivet') {
      spawnRing(worldPosition, hdr(STORM_GREY, 0.8), 2.4, 0.4);
    }
  });

  bus.on('lock', ({ enemyId, worldPosition, lockCount }) => {
    const lockColor = colorForLockCount(lockCount, LOCK_GRADIENT);
    const record = enemyRecords.get(enemyId);
    if (record && !record.lockRing) {
      lockRings.attach(record, makeLockRing(lockColor), scene);
    }
    spawnRing(worldPosition, hdr(lockColor, 1.4), 2.1, 0.26);
  });

  bus.on('unlock', ({ enemyId }) => {
    const record = enemyRecords.get(enemyId);
    if (record) lockRings.detach(record);
  });

  bus.on('fire', ({ projectileId, worldPosition }) => {
    projectileRecords.claim(projectileId);
    spawnGlint(worldPosition, hdr(SIGNAL_WHITE, 1.2), 0.5, 0.12);
  });

  bus.on('hit', ({ enemyId, projectileId, worldPosition, lethal }) => {
    projectileRecords.delete(projectileId);
    burstSparks(worldPosition, hdr(SIGNAL_WHITE, 0.9), 5, 9, airFall());
    const record = enemyRecords.get(enemyId);
    if (record && !lethal) {
      record.mesh.userData.damageFlashUntil = elapsedNow + 0.35;
      spawnGlint(worldPosition, hdr(SIGNAL_WHITE, 1.7), 1.1, 0.16);
    }
  });

  bus.on('stage', ({ enemyId, worldPosition }) => {
    const record = enemyRecords.get(enemyId);
    if (!record) return;
    if (record.mesh.userData.kind === 'bulwark') {
      breakBulwarkArmor(record.mesh);
      const specs = record.mesh.userData.shardSpecs as ShardSpec[] | undefined;
      if (specs) burstShards(worldPosition, specs.slice(0, 5), airFall());
      burstSparks(worldPosition, hdr(WARN_AMBER, 1.1), 12, 13, airFall());
      spawnRing(worldPosition, hdr(WARN_AMBER, 1.3), 6, 0.5);
    } else if (record.mesh.userData.isBoss) {
      // Carapace sheared: the plates tumble away down the sky.
      shedRipperCarapace(record.mesh);
      const specs = record.mesh.userData.carapaceSpecs as ShardSpec[] | undefined;
      if (specs) burstShards(worldPosition, specs, 8);
      cameraFeel.shake(1.0, SKYHOOK_CAMERA_SHAKE);
      surgePulse = Math.max(surgePulse, 0.45);
      spawnRing(worldPosition, hdr(HAZARD_ORANGE, 1.4), 22, 0.8);
      burstSparks(worldPosition, hdr(HAZARD_ORANGE, 1.2), 24, 20, 6);
    }
  });

  bus.on('kill', ({ enemyId, worldPosition }) => {
    const record = enemyRecords.get(enemyId);
    if (record) {
      const specs = record.mesh.userData.shardSpecs as ShardSpec[] | undefined;
      if (specs) burstShards(worldPosition, specs, airFall());
      const accent = (record.mesh.userData.accent as Color | undefined) ?? STORM_GREY;
      burstSparks(worldPosition, hdr(accent, 1.0), 8, 12, airFall());
      spawnRing(worldPosition, hdr(accent, 0.9), 4.2, 0.4);
      spawnGlint(worldPosition, hdr(SIGNAL_WHITE, 1.5), 1.2, 0.18);
      if (record.mesh.userData.isVapor) {
        spawnWisp(worldPosition, hdr(PALE_CORE, 0.5), 4, 0.7);
      }

      if (record.mesh.userData.isBoss) {
        // The kill the level is built around: cut loose, it falls past you.
        bossKilledAt = elapsedNow;
        cameraFeel.shake(1.7, SKYHOOK_CAMERA_SHAKE);
        surgePulse = 1.0;
        flashUniform.value = Math.max(flashUniform.value, 0.9);
        spawnRing(worldPosition, hdr(SIGNAL_WHITE, 1.4), 60, 1.3);
        spawnRing(worldPosition, hdr(HAZARD_ORANGE, 1.2), 36, 1.0);
        spawnGlint(worldPosition, hdr(SIGNAL_WHITE, 2.2), 6, 0.5);
        burstSparks(worldPosition, hdr(HAZARD_ORANGE, 1.2), 50, 28, 4);
        environment?.dropCarcass(worldPosition);
      } else if (record.mesh.userData.kind === 'grappler') {
        cameraFeel.shake(0.5, SKYHOOK_CAMERA_SHAKE);
        spawnRing(worldPosition, hdr(DANGER_RED, 1.2), 7, 0.5);
      }

      enemyRecords.delete(enemyId, { dispose: true });
    }
  });

  bus.on('miss', ({ enemyId, worldPosition }) => {
    if (enemyRecords.get(enemyId)) enemyRecords.delete(enemyId, { dispose: true });
    burstSparks(worldPosition, STORM_GREY.clone().multiplyScalar(0.4), 3, 3, 2);
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

  bus.on('playerhit', ({ healthRemaining }) => {
    hullRemaining = healthRemaining;
    beatEnergy = 1.5;
    cameraFeel.shake(1.2, SKYHOOK_CAMERA_SHAKE);
    // The hit lands on the car, not just the lens: sparks off the deck.
    if (sceneCamera) {
      const deckPoint = sceneCamera.position.clone()
        .add(sceneCamera.getWorldDirection(scratchDir).multiplyScalar(4))
        .addScaledVector(scratchRight.setFromMatrixColumn(sceneCamera.matrixWorld, 0), 1.6)
        .addScaledVector(scratchUp.setFromMatrixColumn(sceneCamera.matrixWorld, 1), -2.2);
      burstSparks(deckPoint, hdr(DANGER_RED, 1.1), 14, 10, airFall());
      spawnWisp(deckPoint, hdr(STORM_GREY, 0.6), 2.5, 1.1);
    }
  });

  bus.on('runstart', () => {
    resetEffects();
    enemyRecords.clear({ dispose: true, pending: true });
    projectileRecords.clear({ pending: true });
    resetCameraFeel(cameraFeel);
    environment?.reset();
    flashUniform.value = 0;
    chillUniform.value = 0;
    surgePulse = 0;
    hullRemaining = SKYHOOK_PLAYER_HEALTH;
    bossKilledAt = -1;
  });

  bus.on('runend', () => {
    resetCameraFeel(cameraFeel);
  });
}

function airFall() {
  // Sparks arc down hard in the weather, barely at all in vacuum.
  return MathUtils.lerp(11, 1.5, MathUtils.clamp(altitudeNow * 1.4, 0, 1));
}

// ---- per-frame update -------------------------------------------------------

function resetCameraFeel(cameraFeel: CameraFeelRig) {
  lastRunTime = -1;
  cameraRoll = 0;
  cameraFovOffset = 0;
  cameraFeel.restore();
}

export function updateVisuals(dt: number, ctx: VisualContext) {
  elapsedNow = ctx.elapsed;
  sceneCamera = ctx.camera as PerspectiveCamera;
  beatEnergy = Math.max(0, beatEnergy - dt * 4.2);
  surgePulse = Math.max(0, surgePulse - dt * 0.85);

  const runTime = ctx.running ? ctx.runTime : 0;
  const speed = ctx.running ? speedFactorAt(runTime) : 0.5;
  altitudeNow = ctx.running ? railSAt(runTime) / CLIMB_LENGTH : 0;

  updateSetPieceMoments(ctx);

  environment?.update(dt, {
    camera: ctx.camera as PerspectiveCamera,
    elapsed: ctx.elapsed,
    runTime: ctx.runTime,
    running: ctx.running,
    speed,
    beatEnergy,
    hull: hullRemaining,
  });

  // Post: the air gets colder as it thins; flashes decay.
  const chillTarget = ctx.running ? MathUtils.clamp((altitudeNow - 0.45) * 0.7, 0, 0.3) : 0;
  chillUniform.value += (chillTarget - chillUniform.value) * Math.min(1, dt * 1.2);
  flashUniform.value = Math.max(0, flashUniform.value - dt * (flashUniform.value > 0.7 ? 1.6 : 2.6));
  if (bossKilledAt >= 0) {
    const since = elapsedNow - bossKilledAt;
    if (since < 1.6) flashUniform.value = Math.max(flashUniform.value, 0.35 * (1 - since / 1.6));
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

    const spinParts = record.mesh.userData.spinParts as Object3D[] | undefined;
    if (spinParts) {
      for (const part of spinParts) part.rotation.z += dt * (part.userData.spinSpeed as number);
    }

    // Grappler eye: pulse while latched, flare when armed; bites spark red.
    if (record.mesh.userData.kind === 'grappler') {
      const eye = record.mesh.userData.eyeMaterial as MeshBasicMaterial | undefined;
      if (eye) {
        const latched = record.mesh.userData.latched === true;
        const armed = record.mesh.userData.armed === true;
        const pulse = latched ? 0.8 + Math.sin(elapsedNow * (armed ? 14 : 6)) * 0.5 : 0.6;
        eye.color.copy(DANGER_RED).multiplyScalar(1.2 * pulse + (armed ? 0.8 : 0));
      }
    }

    if (record.mesh.userData.isBoss) {
      const eye = record.mesh.userData.eyeMaterial as MeshBasicMaterial | undefined;
      if (eye) eye.color.copy(DANGER_RED).multiplyScalar(1.5 + Math.sin(elapsedNow * 3.4) * 0.5 + beatEnergy * 0.4);
    }

    // Bites (grappler or gripped boss) spark off the hull.
    const biteAt = record.mesh.userData.biteAt as number | undefined;
    if (biteAt !== undefined && biteAt !== record.mesh.userData.biteSeen) {
      record.mesh.userData.biteSeen = biteAt;
      burstSparks(record.mesh.position, hdr(DANGER_RED, 1.2), 12, 9, airFall());
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
    reticleSpinner.rotation.z += dt * (active ? 4.2 : 1.0);
    const brackets = reticleSpinner.parent?.userData.brackets as Group | undefined;
    if (brackets) brackets.rotation.z -= dt * (active ? 2.6 : 0.6);
  }

  updateEffects(dt, ctx.camera);
}

// Cloud break / thin-air surge: detect the crossing, slam the senses.
function updateSetPieceMoments(ctx: VisualContext) {
  if (!ctx.running) {
    lastRunTime = -1;
    return;
  }
  const crossed = (t: number) => lastRunTime >= 0 && lastRunTime < t && ctx.runTime >= t;
  if (crossed(CLOUDBREAK_TIME)) {
    flashUniform.value = Math.max(flashUniform.value, 0.95);
    surgePulse = Math.max(surgePulse, 0.9);
    ctx.feel.shake(0.9, SKYHOOK_CAMERA_SHAKE);
    // Punching the deck: vapor everywhere.
    const camera = ctx.camera as PerspectiveCamera;
    for (let i = 0; i < 8; i += 1) {
      const angle = (i / 8) * Math.PI * 2;
      const point = camera.position.clone()
        .add(camera.getWorldDirection(scratchDir).multiplyScalar(8))
        .addScaledVector(scratchRight.setFromMatrixColumn(camera.matrixWorld, 0), Math.cos(angle) * 7)
        .addScaledVector(scratchUp.setFromMatrixColumn(camera.matrixWorld, 1), Math.sin(angle) * 5);
      spawnWisp(point, hdr(PALE_CORE, 0.7), 8, 1.2);
    }
  }
  if (crossed(THIN_TIME)) {
    flashUniform.value = Math.max(flashUniform.value, 0.4);
    surgePulse = Math.max(surgePulse, 0.7);
    ctx.feel.shake(0.5, SKYHOOK_CAMERA_SHAKE);
  }
  lastRunTime = ctx.runTime;
}

export function updateCameraEffects(dt: number, ctx: CameraEffectsContext) {
  if (!(ctx.camera instanceof PerspectiveCamera)) return;
  const camera = ctx.camera;
  const runTime = ctx.running ? ctx.runTime : 0;
  const speed = ctx.running ? speedFactorAt(runTime) : 0.5;
  const altitude = ctx.running ? railSAt(runTime) / CLIMB_LENGTH : 0;

  // Storm turbulence: continuous low-grade buffeting that dies with the air.
  const storm = 1 - MathUtils.clamp((altitude - 0.14) / 0.16, 0, 1);
  if (ctx.running && storm > 0.02) ctx.feel.shake(dt * storm * 0.9, SKYHOOK_CAMERA_SHAKE);

  // FOV breathes with climb rate, kicks with the beat and the set pieces.
  const targetFovOffset = (speed - 0.9) * 8 + beatEnergy * 1.0 + surgePulse * 6;
  cameraFovOffset = MathUtils.lerp(cameraFovOffset, targetFovOffset, Math.min(1, dt * 6));

  if (ctx.running) {
    // Bank gently with the car's sway.
    const u = skyhookRunProgress(ctx.runTime);
    const tangent = rail.getTangentAt(MathUtils.clamp(u, 0, 1));
    const ahead = rail.getTangentAt(MathUtils.clamp(u + 0.006, 0, 1));
    const targetRoll = MathUtils.clamp((ahead.x - tangent.x) * 26, -0.14, 0.14);
    cameraRoll += (targetRoll - cameraRoll) * Math.min(1, dt * 3);
    camera.rotateZ(cameraRoll);
  }

  ctx.feel.setFovOffset(cameraFovOffset);
  ctx.feel.update(dt, { shake: SKYHOOK_CAMERA_SHAKE });
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

  for (const part of parts) {
    if (denied) {
      part.material.color.copy(part.kind === 'fill' ? DENY_FILL : DENY_RED);
      continue;
    }
    if (locked) {
      if (part.kind === 'edge') part.material.color.copy(hdr(SIGNAL_WHITE, 1.5));
      else if (part.kind === 'fill') part.material.color.copy(SIGNAL_GREEN.clone().multiplyScalar(0.3));
      else part.material.color.copy(hdr(SIGNAL_WHITE, 2.0));
      continue;
    }
    if (damageFlash) {
      part.material.color.copy(hdr(SIGNAL_WHITE, part.kind === 'fill' ? 0.5 : 1.8));
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
  // A square docking bracket — hardware clamping onto a contact.
  const ring = new Mesh(
    lockRingOuterGeometry,
    configureAdditiveMaterial(new MeshBasicMaterial({ color: hdr(color, 1.7) }), { side: DoubleSide }),
  );
  const innerRing = new Mesh(
    lockRingInnerGeometry,
    configureAdditiveMaterial(new MeshBasicMaterial({ color: hdr(color.clone().lerp(SIGNAL_WHITE, 0.55), 1.3) }), { side: DoubleSide }),
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
