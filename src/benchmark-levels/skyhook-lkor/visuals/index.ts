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
import { createSkyhookRail, skyhookRunProgress, speedFactorAt } from '../gameplay';
import { CAR_AHEAD_UNITS, SKYHOOK_MARKERS, SKYHOOK_PLAYER_HEALTH, SKYHOOK_TIME } from '../timing';
import {
  animateDart,
  animateKite,
  animateLamprey,
  animateLeech,
  animateWasp,
  blowLampreyArm,
  createBoltMesh,
  createDartMesh,
  createKiteMesh,
  createLampreyMesh,
  createLeechMesh,
  createWaspMesh,
  updateLampreyDeath,
  type TintPart,
} from './enemies';
import {
  createEnvironmentInternal,
  resetEnvironment,
  triggerLightning,
  updateEnvironment,
  type Environment,
} from './environment';
import {
  burstSlag,
  burstSparks,
  createEffects,
  dropTrail,
  resetEffects,
  spawnGlint,
  spawnRing,
  spawnSmoke,
  updateEffects,
  type ShardSpec,
} from './effects';
import {
  animateBeacon,
  createBeaconMesh,
  createClimberCar,
  createStation,
  createTether,
  tetherFrameQuaternion,
  tetherPoint,
  type ClimberCar,
  type Station,
  type TetherRig,
} from './hardware';
import { createLetterMesh, setLetterDenied, setLetterLocked } from './letters';
import {
  BAY_WARM,
  DENY_FILL,
  DENY_RED,
  HAZARD_ORANGE,
  hdr,
  LOCK_GRADIENT,
  MARK_HOT,
  MARK_WHITE,
  MARKER_WHITE,
  SIGNAL_AMBER,
} from './palette';
import { dockWarmUniform, flashUniform, hitEdgeUniform } from './post-fx';

export type SkyhookVisualFrame = {
  scene: Scene;
  camera: PerspectiveCamera;
  elapsed: number;
  runTime: number;
  running: boolean;
  feel: CameraFeelRig;
};

export type SkyhookCameraFrame = {
  camera: PerspectiveCamera;
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

const SKYHOOK_SHAKE: CameraFeelShakeOptions = {
  decay: 2.5,
  maxTrauma: 1.0,
  pitchDegrees: 0.32,
  yawDegrees: 0.26,
  rollDegrees: 0.62,
  frequency: 8.5,
  smoothing: 20,
};

const rail = createSkyhookRail();
const railLength = rail.getLength();
const carLeadU = CAR_AHEAD_UNITS / railLength;
const barSeconds = SKYHOOK_TIME.barSeconds;
const LIGHTNING_BARS = [2, 5, 7];

let environment: Environment | null = null;
let tether: TetherRig | null = null;
let car: ClimberCar | null = null;
let station: Station | null = null;
let deathHolder: Group | null = null;

let beatEnergy = 0;
let surgePulse = 0;
let cameraFovOffset = 0;
let cameraRoll = 0;
let elapsedNow = 0;
let lastRunTime = -1;

let carHealth = SKYHOOK_PLAYER_HEALTH;
let carSmokeAccum = 0;
let bossId = -1;
let dockActive = false;
let dockOpen = 0;
let dyingLamprey: { mesh: Object3D; since: number } | null = null;

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
    // Each enemy owns its geometries/materials (no shared module caches), so
    // the whole mesh is safe to release when the record is dropped with dispose.
    disposeObject3D(record.mesh);
  },
});
const projectileRecords = createPendingVisualRecords<ProjectileRecord, ProjectileRecord>({
  createRecord: (record) => record,
  // createProjectileMesh allocates two fresh octahedra per shot; free them when
  // the projectile record is dropped so geometry count cannot climb per shot.
  disposeRecord: (record) => disposeObject3D(record.mesh),
});

export function createEnvironment(scene: Scene) {
  environment = createEnvironmentInternal(scene);
  createEffects(scene);
  tether = createTether(rail);
  scene.add(tether.root);
  car = createClimberCar();
  scene.add(car.root);
  station = createStation();
  scene.add(station.root);
  deathHolder = new Group();
  scene.add(deathHolder);
}

// ---- enemy factories ---------------------------------------------------------

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
      return createLetterMesh(letter ?? 'S');
    case 'kite':
      return createKiteMesh();
    case 'dart':
      return createDartMesh();
    case 'leech':
      return createLeechMesh();
    case 'wasp':
      return createWaspMesh();
    case 'bolt':
      return createBoltMesh();
    case 'lamprey':
      return createLampreyMesh();
    case 'beacon':
      return createBeaconMesh();
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
  spawnRing(mesh.position, DENY_RED.clone(), 2.6, 0.3);
}

// Player shot: a clean white dart in a warm orange sheath — utilitarian, of the
// same family as the reticle and locks.
export function createProjectileMesh() {
  const group = new Group();
  const coreGeometry = new OctahedronGeometry(0.3, 0);
  coreGeometry.scale(0.42, 0.42, 2.1);
  group.add(new Mesh(coreGeometry, new MeshBasicMaterial({ color: hdr(MARK_WHITE, 2.6) })));
  const shellGeometry = new OctahedronGeometry(0.46, 0);
  shellGeometry.scale(0.5, 0.5, 1.8);
  group.add(new Mesh(shellGeometry, createAdditiveBasicMaterial({ color: hdr(HAZARD_ORANGE, 1.1), opacity: 0.5 })));
  projectileRecords.enqueue({ mesh: group, trailColor: MARK_HOT.clone().multiplyScalar(0.8) });
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

  // Thin white docking ring.
  const outer = new Mesh(new RingGeometry(0.6, 0.64, 48), new MeshBasicMaterial());
  addPart(outer, hdr(MARK_WHITE, 1.15));

  // Four hazard-orange tick brackets — a docking crosshair, unlike any enemy.
  const brackets = new Group();
  for (let i = 0; i < 4; i += 1) {
    const tick = new Mesh(new PlaneGeometry(0.22, 0.05), new MeshBasicMaterial());
    addPart(tick, hdr(HAZARD_ORANGE, 1.4));
    const angle = (i / 4) * Math.PI * 2;
    tick.position.set(Math.cos(angle) * 0.82, Math.sin(angle) * 0.82, 0);
    tick.rotation.z = angle;
    brackets.add(tick);
  }

  // Subtle spinner: a broken alignment ring.
  const spinner = new Group();
  const segment = new Mesh(new RingGeometry(0.42, 0.455, 24, 1, 0, Math.PI * 0.5), new MeshBasicMaterial());
  addPart(segment, hdr(MARK_WHITE, 1.0));
  spinner.add(segment);

  const pip = new Mesh(new CircleGeometry(0.05, 16), new MeshBasicMaterial());
  addPart(pip, hdr(MARK_HOT, 2.0));

  group.add(outer, brackets, spinner, pip);
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
  const charge = lockCount === 0 ? null : colorForLockCount(lockCount, LOCK_GRADIENT);
  for (const part of parts) {
    if (charge) part.material.color.copy(hdr(charge, active ? 1.6 : 1.25));
    else part.material.color.copy(part.base).multiplyScalar(active ? 1.3 : 1);
  }
}

// ---- event wiring ------------------------------------------------------------

export function installVisualEventHandlers(bus: EventBus, scene: Scene, cameraFeel: CameraFeelRig) {
  bus.on('spawn', ({ enemyId, kind, worldPosition }) => {
    const record = enemyRecords.claim(enemyId);
    if (!record) return;
    if (kind === 'lamprey') {
      bossId = enemyId;
      cameraFeel.shake(0.35, SKYHOOK_SHAKE);
      surgePulse = Math.max(surgePulse, 0.4);
      spawnRing(worldPosition, hdr(SIGNAL_AMBER, 1.2), 20, 0.9);
    } else if (kind !== 'bolt') {
      spawnRing(worldPosition, hdr(HAZARD_ORANGE, 0.8), 2.4, 0.36);
    }
  });

  bus.on('lock', ({ enemyId, worldPosition, lockCount }) => {
    const lockColor = colorForLockCount(lockCount, LOCK_GRADIENT);
    const record = enemyRecords.get(enemyId);
    if (record && !record.lockRing) lockRings.attach(record, makeLockRing(lockColor), scene);
    spawnRing(worldPosition, hdr(lockColor, 1.3), 2.0, 0.26);
  });

  bus.on('unlock', ({ enemyId }) => {
    const record = enemyRecords.get(enemyId);
    if (record) lockRings.detach(record);
  });

  bus.on('fire', ({ projectileId, worldPosition }) => {
    projectileRecords.claim(projectileId);
    spawnGlint(worldPosition, hdr(MARK_WHITE, 1.2), 0.5, 0.12);
  });

  bus.on('hit', ({ enemyId, projectileId, worldPosition, lethal, hitStageIndex }) => {
    projectileRecords.delete(projectileId, { dispose: true });
    burstSparks(worldPosition, hdr(MARK_HOT, 0.9), 5, 10, 5);
    const record = enemyRecords.get(enemyId);
    if (!record) return;
    if (!lethal) {
      record.mesh.userData.damageFlashUntil = elapsedNow + 0.3;
      spawnGlint(worldPosition, hdr(MARK_WHITE, 1.8), 1.0, 0.16);
    }
    // Lamprey stage-1 hits blow a grapple-arm pod: it buys distance, briefly.
    if (record.mesh.userData.kind === 'lamprey' && hitStageIndex === 0) {
      const armWorld = blowLampreyArm(record.mesh);
      if (armWorld) {
        cameraFeel.shake(0.35, SKYHOOK_SHAKE);
        burstSparks(armWorld, hdr(SIGNAL_AMBER, 1.2), 14, 18);
        spawnRing(armWorld, hdr(SIGNAL_AMBER, 1.2), 8, 0.5);
      }
    }
  });

  bus.on('stage', ({ enemyId, worldPosition }) => {
    const record = enemyRecords.get(enemyId);
    if (!record) return;
    const specs = record.mesh.userData.shardSpecs as ShardSpec[] | undefined;
    if (record.mesh.userData.kind === 'lamprey') {
      // A grinder plate shears off; the machine shudders.
      cameraFeel.shake(0.6, SKYHOOK_SHAKE);
      surgePulse = Math.max(surgePulse, 0.55);
      if (specs) burstSlag(worldPosition, specs.slice(0, 8));
      burstSparks(worldPosition, hdr(SIGNAL_AMBER, 1.2), 16, 16);
      spawnRing(worldPosition, hdr(SIGNAL_AMBER, 1.4), 14, 0.6);
    } else {
      // Leech shell cracks.
      if (specs) burstSlag(worldPosition, specs.slice(0, 3));
      burstSparks(worldPosition, hdr(SIGNAL_AMBER, 1.0), 8, 12);
      spawnRing(worldPosition, hdr(SIGNAL_AMBER, 1.1), 4, 0.4);
    }
  });

  bus.on('kill', ({ enemyId, worldPosition }) => {
    const record = enemyRecords.get(enemyId);
    if (!record) return;

    if (record.mesh.userData.kind === 'beacon') {
      // Igniting, not destroying: warm white-orange flare, no gunmetal slag,
      // and a lingering lit ember where the lamp came on.
      burstSparks(worldPosition, hdr(BAY_WARM, 1.1), 8, 6, 2);
      spawnRing(worldPosition, hdr(MARKER_WHITE, 1.4), 5.5, 0.5);
      spawnRing(worldPosition, hdr(HAZARD_ORANGE, 1.1), 3, 0.4);
      spawnGlint(worldPosition, hdr(MARKER_WHITE, 2.0), 1.4, 1.2);
      if (station) station.flare();
      enemyRecords.delete(enemyId, { dispose: true });
      return;
    }

    const specs = record.mesh.userData.shardSpecs as ShardSpec[] | undefined;
    if (specs) burstSlag(worldPosition, specs);
    const accent = (record.mesh.userData.accent as Color | undefined) ?? HAZARD_ORANGE;
    // White-orange flash; gunmetal shards fall away down.
    burstSparks(worldPosition, hdr(MARK_HOT, 1.0), 9, 13);
    spawnRing(worldPosition, hdr(accent, 0.9), 4.4, 0.42);
    spawnGlint(worldPosition, hdr(MARK_WHITE, 1.6), 1.2, 0.18);

    if (enemyId === bossId && record.mesh.userData.kind === 'lamprey') {
      // Set piece: the lamprey unclamps and tumbles away burning.
      cameraFeel.shake(0.9, SKYHOOK_SHAKE);
      surgePulse = Math.max(surgePulse, 1.0);
      flashUniform.value = Math.max(flashUniform.value, 0.7);
      spawnRing(worldPosition, hdr(MARK_WHITE, 1.5), 60, 1.4);
      spawnRing(worldPosition, hdr(HAZARD_ORANGE, 1.2), 40, 1.1);
      spawnRing(worldPosition, hdr(SIGNAL_AMBER, 1.0), 24, 0.9);
      burstSparks(worldPosition, hdr(SIGNAL_AMBER, 1.2), 44, 26, 12);
      // Keep the mesh alive for the scripted fall.
      if (deathHolder) {
        deathHolder.add(record.mesh);
        record.mesh.userData.deathVelocity = new Vector3(3, -7, 5);
        dyingLamprey = { mesh: record.mesh, since: 0 };
      }
      enemyRecords.delete(enemyId); // no dispose: the death holder owns it now
      bossId = -1;
    } else {
      enemyRecords.delete(enemyId, { dispose: true });
    }
  });

  bus.on('miss', ({ enemyId, worldPosition }) => {
    if (enemyRecords.get(enemyId)) enemyRecords.delete(enemyId, { dispose: true });
    burstSparks(worldPosition, SIGNAL_AMBER.clone().multiplyScalar(0.4), 3, 3, 3);
  });

  bus.on('reject', () => {
    cameraFeel.shake(0.25, SKYHOOK_SHAKE);
  });

  bus.on('volley', ({ size, kills }) => {
    if (size >= 5 && kills === size) {
      beatEnergy = Math.max(beatEnergy, 1.4);
      flashUniform.value = Math.max(flashUniform.value, 0.18);
    }
  });

  bus.on('beat', ({ isDownbeat }) => {
    beatEnergy = Math.max(beatEnergy, isDownbeat ? 1 : 0.4);
  });

  bus.on('bossphase', ({ phase }) => {
    if (phase === 'summoned') {
      cameraFeel.shake(0.6, SKYHOOK_SHAKE);
      surgePulse = Math.max(surgePulse, 0.5);
    } else if (phase === 'exposed') {
      cameraFeel.shake(0.7, SKYHOOK_SHAKE);
      surgePulse = Math.max(surgePulse, 0.6);
      flashUniform.value = Math.max(flashUniform.value, 0.2);
    } else if (phase === 'destroyed') {
      dockActive = true;
    }
  });

  bus.on('playerhit', ({ healthRemaining }) => {
    carHealth = healthRemaining;
    beatEnergy = 1.4;
    hitEdgeUniform.value = Math.max(hitEdgeUniform.value, 1);
    cameraFeel.shake(0.5, SKYHOOK_SHAKE);
    if (car) {
      const pos = car.root.getWorldPosition(new Vector3());
      burstSparks(pos, hdr(SIGNAL_AMBER, 1.0), 10, 9);
    }
  });

  bus.on('runstart', () => {
    resetEffects();
    enemyRecords.clear({ dispose: true, pending: true });
    projectileRecords.clear({ dispose: true, pending: true });
    if (environment) resetEnvironment(environment);
    if (deathHolder) {
      for (const child of [...deathHolder.children]) {
        deathHolder.remove(child);
        disposeObject3D(child);
      }
    }
    dyingLamprey = null;
    bossId = -1;
    carHealth = SKYHOOK_PLAYER_HEALTH;
    carSmokeAccum = 0;
    dockActive = false;
    dockOpen = 0;
    flashUniform.value = 0;
    hitEdgeUniform.value = 0;
    dockWarmUniform.value = 0;
    resetCameraFeel(cameraFeel);
  });

  bus.on('runend', () => {
    resetCameraFeel(cameraFeel);
  });
}

// ---- per-frame ---------------------------------------------------------------

function resetCameraFeel(cameraFeel: CameraFeelRig) {
  lastRunTime = -1;
  cameraRoll = 0;
  cameraFovOffset = 0;
  surgePulse = 0;
  cameraFeel.restore();
}

export function updateVisuals(dt: number, frame: SkyhookVisualFrame) {
  elapsedNow = frame.elapsed;
  beatEnergy = Math.max(0, beatEnergy - dt * 4.2);
  surgePulse = Math.max(0, surgePulse - dt * 0.85);

  const runTime = frame.running ? frame.runTime : 0;
  const progress = frame.running ? skyhookRunProgress(runTime) : 0;
  const speed = frame.running ? speedFactorAt(runTime) : 0.55;
  const camera = frame.camera;

  updateSetPieceMoments(frame);

  if (environment) updateEnvironment(environment, { dt, elapsed: elapsedNow, progress, speed, camera, running: frame.running });
  if (tether) tether.update(progress, beatEnergy);
  updateCar(dt, camera, progress, speed);
  updateStation(dt, camera, runTime, frame.running);
  updatePostUniforms(dt, runTime, frame.running);

  updateEnemies(dt, camera);
  updateDyingLamprey(dt);

  for (const [projectileId, record] of projectileRecords.entries()) {
    if (!record.mesh.parent) {
      projectileRecords.delete(projectileId, { dispose: true });
      continue;
    }
    dropTrail(record.mesh.position, record.trailColor);
  }

  const spinner = findReticleSpinner(frame.scene);
  if (spinner) {
    const active = spinner.parent?.userData.active === true;
    spinner.rotation.z += dt * (active ? 3.4 : 1.0);
  }

  updateEffects(dt, camera);
}

function updateSetPieceMoments(frame: SkyhookVisualFrame) {
  if (!frame.running) {
    lastRunTime = -1;
    return;
  }
  const crossed = (t: number) => lastRunTime >= 0 && lastRunTime < t && frame.runTime >= t;
  if (crossed(SKYHOOK_MARKERS.cloudPunch)) {
    // Punch through the deck: white overload + surge kick.
    flashUniform.value = Math.max(flashUniform.value, 0.85);
    surgePulse = Math.max(surgePulse, 0.9);
    frame.feel.kickFov(4);
    frame.feel.shake(0.4, SKYHOOK_SHAKE);
  }
  for (const barIndex of LIGHTNING_BARS) {
    if (crossed(barSeconds * barIndex)) triggerLightning(1);
  }
  lastRunTime = frame.runTime;
}

function updateCar(dt: number, camera: Camera, progress: number, speed: number) {
  if (!car) return;
  const u = Math.min(1, progress + carLeadU);
  tetherPoint(rail, u, car.root.position);
  tetherFrameQuaternion(rail, u, car.root.quaternion);
  const healthFrac = carHealth / SKYHOOK_PLAYER_HEALTH;
  car.update({ dt, elapsed: elapsedNow, healthFrac, speed });

  // Venting smoke scales with damage.
  if (healthFrac < 0.999) {
    carSmokeAccum += dt * (0.6 + (1 - healthFrac) * 3);
    while (carSmokeAccum >= 1) {
      carSmokeAccum -= 1;
      const pos = car.root.position.clone().add(new Vector3((Math.random() - 0.5) * 0.8, 0.3, -0.6));
      spawnSmoke(pos, new Vector3((Math.random() - 0.5) * 0.6, 0.6, -1.2), 1.2 + (1 - healthFrac), 0.9);
    }
    // Occasional fault sparks.
    if (Math.random() < (1 - healthFrac) * dt * 3) {
      burstSparks(car.root.position.clone().add(new Vector3(0, 0.2, 0)), hdr(SIGNAL_AMBER, 0.9), 4, 7);
    }
  }
  void camera;
}

function updateStation(dt: number, camera: Camera, runTime: number, running: boolean) {
  if (!station) return;
  if (!running) {
    station.update({ open: 0, elapsed: elapsedNow, dt });
    return;
  }
  // Park the station at the tether's end, facing back toward the climber.
  tetherPoint(rail, 1, station.root.position);
  tetherFrameQuaternion(rail, 1, station.root.quaternion);
  station.root.rotateY(Math.PI);

  if (dockActive) dockOpen = Math.min(1, dockOpen + dt * 0.7);
  station.update({ open: dockOpen, elapsed: elapsedNow, dt });

  // Warm bay wash as the seal completes.
  const sealT = MathUtils.clamp((runTime - SKYHOOK_MARKERS.dock) / Math.max(0.001, SKYHOOK_MARKERS.dockSeal - SKYHOOK_MARKERS.dock), 0, 1);
  dockWarmUniform.value = dockActive ? sealT * 0.9 : 0;
  void camera;
}

function updatePostUniforms(dt: number, _runTime: number, _running: boolean) {
  flashUniform.value = Math.max(0, flashUniform.value - dt * (flashUniform.value > 0.8 ? 1.4 : 2.4));
  hitEdgeUniform.value = Math.max(0, hitEdgeUniform.value - dt * 2.2);
}

function updateEnemies(dt: number, camera: Camera) {
  for (const [enemyId, record] of enemyRecords.entries()) {
    if (!record.mesh.parent) {
      enemyRecords.delete(enemyId, { dispose: true });
      continue;
    }
    if (record.bornAt === null) record.bornAt = elapsedNow;
    const age = elapsedNow - record.bornAt;
    record.mesh.scale.setScalar(easeOutBack(Math.min(1, age / 0.4)));

    updateEnemyTint(record, camera);

    switch (record.mesh.userData.kind) {
      case 'kite':
        animateKite(record.mesh, dt, elapsedNow);
        break;
      case 'dart':
        animateDart(record.mesh, dt, elapsedNow);
        break;
      case 'leech':
        animateLeech(record.mesh, dt, elapsedNow);
        break;
      case 'wasp':
        animateWasp(record.mesh, dt, elapsedNow);
        break;
      case 'lamprey':
        animateLamprey(record.mesh, dt, elapsedNow);
        break;
      case 'beacon':
        animateBeacon(record.mesh, elapsedNow);
        break;
      default:
        break;
    }

    if (record.mesh.userData.isHostileShot) dropTrail(record.mesh.position, record.mesh.userData.trailColor as Color);

    if (record.lockRing) {
      record.mesh.getWorldPosition(record.lockRing.position);
      record.lockRing.quaternion.copy((camera as PerspectiveCamera).quaternion);
      record.lockRing.rotation.z += dt * 2.4;
      const pulse = 1 + Math.sin(elapsedNow * 9) * 0.05;
      const fit = (record.mesh.userData.lockRingScale as number | undefined) ?? 1;
      record.lockRing.scale.setScalar(pulse * 1.9 * fit);
    }
  }
}

function updateDyingLamprey(dt: number) {
  if (!dyingLamprey || !deathHolder) return;
  dyingLamprey.since += dt;
  updateLampreyDeath(dyingLamprey.mesh, dt, elapsedNow, dyingLamprey.since);
  if (dyingLamprey.since > 3.2) {
    // The tumble is done (fallen away / burned out): drop it from the scene and
    // release its geometry so the boss mesh does not persist to end of run.
    deathHolder.remove(dyingLamprey.mesh);
    disposeObject3D(dyingLamprey.mesh);
    dyingLamprey = null;
  }
}

function updateEnemyTint(record: EnemyRecord, camera: Camera) {
  const userData = record.mesh.userData;
  const denied = (userData.deniedUntil as number | undefined ?? -Infinity) > elapsedNow;

  if (userData.isLetter) {
    if (denied) setLetterDenied(record.mesh, true);
    else if (userData.locked !== true) setLetterLocked(record.mesh, false);
    return;
  }

  const parts = userData.parts as TintPart[] | undefined;
  if (!parts) return;

  const distance = record.mesh.position.distanceTo((camera as PerspectiveCamera).position);
  const closeness = smootherstep(1 - clamp01((distance - 16) / (54 - 16)));
  const locked = userData.locked === true;
  const damageFlash = (userData.damageFlashUntil as number | undefined ?? -Infinity) > elapsedNow;

  for (const part of parts) {
    if (denied) {
      part.material.color.copy(part.kind === 'fill' ? DENY_FILL : DENY_RED);
      continue;
    }
    if (locked) {
      if (part.kind === 'edge') part.material.color.copy(hdr(MARK_HOT, 1.6));
      else if (part.kind === 'fill') part.material.color.copy(MARK_WHITE.clone().multiplyScalar(0.32));
      else part.material.color.copy(hdr(MARK_WHITE, 2.0));
      continue;
    }
    if (damageFlash) {
      part.material.color.copy(hdr(MARKER_WHITE, part.kind === 'fill' ? 0.5 : 1.9));
      continue;
    }
    const dim = part.kind === 'edge' ? 0.55 + 0.45 * closeness : part.kind === 'fill' ? 0.35 + 0.65 * closeness : 0.4 + 0.6 * closeness;
    part.material.color.copy(part.base).multiplyScalar(dim);
  }
}

// ---- camera effects ----------------------------------------------------------

export function updateSkyhookCameraEffects(dt: number, frame: SkyhookCameraFrame) {
  if (!(frame.camera instanceof PerspectiveCamera)) return;
  const camera = frame.camera;
  const runTime = frame.running ? frame.runTime : 0;
  const speed = frame.running ? speedFactorAt(runTime) : 0.55;

  // FOV breathes with airspeed, kicks on the beat and surges, settles during dock.
  let targetFovOffset = (speed - 0.9) * 8 + beatEnergy * 1.0 + surgePulse * 6;
  if (dockActive) targetFovOffset = MathUtils.lerp(targetFovOffset, -3, dockOpen);
  cameraFovOffset = MathUtils.lerp(cameraFovOffset, targetFovOffset, Math.min(1, dt * 6));

  if (frame.running) {
    const u = skyhookRunProgress(frame.runTime);
    const tangent = rail.getTangentAt(MathUtils.clamp(u, 0, 1));
    const ahead = rail.getTangentAt(MathUtils.clamp(u + 0.006, 0, 1));
    const targetRoll = MathUtils.clamp((ahead.x - tangent.x) * 26, -0.14, 0.14);
    cameraRoll += (targetRoll - cameraRoll) * Math.min(1, dt * 3.2);
    camera.rotateZ(cameraRoll);
  }

  frame.feel.setFovOffset(cameraFovOffset);
  frame.feel.update(dt, { shake: SKYHOOK_SHAKE });
}

// ---- helpers -----------------------------------------------------------------

function findReticleSpinner(scene: Scene): Group | null {
  for (const child of scene.children) {
    if (child.userData.spinner) return child.userData.spinner as Group;
  }
  return null;
}

function makeLockRing(color: Color): Group {
  const group = new Group();
  // A square docking clamp closing on the target — four-fold, unlike the enemies.
  const ring = new Mesh(
    new RingGeometry(0.84, 0.9, 4),
    createAdditiveBasicMaterial({ color: hdr(color, 1.7), side: DoubleSide }),
  );
  ring.rotation.z = Math.PI / 4;
  const inner = new Mesh(
    new RingGeometry(0.64, 0.67, 32),
    createAdditiveBasicMaterial({ color: hdr(color, 1.3), side: DoubleSide }),
  );
  group.add(ring, inner);
  return group;
}

// Parameterless factory for snapshot inspection of the climber car.
export function snapshotCar(): Object3D {
  return createClimberCar().root;
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
