import {
  BoxGeometry,
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
import {
  createAdornmentSlot,
  createPendingVisualRecords,
} from '../../../engine/visual-kit';
import type { EventBus } from '../../../events';
import { CUBE_CENTER, swingAt } from '../structure';
import { BEAT_SECONDS, CODA_TIME, CORE_TIME } from '../timing';
import {
  createBoltMesh,
  createCoreMesh,
  createOctaMesh,
  createPanelMesh,
  createPrismMesh,
  createTetraMesh,
  createWeakpointMesh,
  type TintPart,
} from './enemies';
import { createCube, type SpeedsolveCube } from './cube';
import { createEnvironmentInternal, type Environment } from './environment';
import {
  burstConfetti,
  burstShards,
  burstSparks,
  createEffects,
  dropTrail,
  resetEffects,
  spawnGlint,
  spawnRing,
  updateEffects,
  type ChipSpec,
} from './effects';
import { createLetterMesh, setLetterDenied, setLetterLocked } from './letters';
import {
  CHASSIS_MID,
  DENY_RED,
  HOT_ORANGE,
  HOT_WHITE,
  INK,
  LOCK_GRADIENT,
  SOLVE_COLORS,
  hdr,
} from './palette';
import { damageUniform, flashUniform, solveColorUniform, solvePulseUniform } from './post-fx';

export type VisualContext = {
  scene: Scene;
  camera: Camera;
  elapsed: number;
  runTime: number;
  running: boolean;
  feel: CameraFeelRig;
};

export type CameraFeelContext = {
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

const SPEEDSOLVE_SHAKE: CameraFeelShakeOptions = {
  decay: 2.6,
  maxTrauma: 1.6,
  pitchDegrees: 0.3,
  yawDegrees: 0.26,
  rollDegrees: 0.62,
  frequency: 9,
  smoothing: 21,
};

let environment: Environment | null = null;
let cube: SpeedsolveCube | null = null;
let elapsedNow = 0;
let beatEnergy = 0;
let surgePulse = 0;
let damagePulse = 0;
let hitsTaken = 0;
let cameraFovOffset = 0;
let lastBeatAt = -Infinity;
let coreKilled = false;
let coreCharge = 0;
let lastConfettiRainAt = 0;
let shellsKicked = false;
let swinging = false;
const panelKillsByFace = [0, 0, 0, 0, 0, 0];
const pendingSolveFlashes: Array<{ at: number; face: number; center: Vector3 }> = [];

function nextBeatTime(now: number) {
  if (!Number.isFinite(lastBeatAt)) return now + 0.06;
  const elapsedBeats = Math.max(0, Math.ceil((now - lastBeatAt) / BEAT_SECONDS - 1e-4));
  return lastBeatAt + elapsedBeats * BEAT_SECONDS;
}

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
  cube = createCube(scene);
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
      return createLetterMesh(letter ?? 'A');
    case 'panel':
      return createPanelMesh();
    case 'weakpoint':
      return createWeakpointMesh();
    case 'tetra':
      return createTetraMesh();
    case 'octa':
      return createOctaMesh();
    case 'prism':
      return createPrismMesh();
    case 'bolt':
      return createBoltMesh();
    case 'core':
      return createCoreMesh();
    default:
      return createTetraMesh();
  }
}

export function setEnemyLocked(mesh: Object3D, locked: boolean) {
  mesh.userData.locked = locked;
  if (mesh.userData.isLetter) setLetterLocked(mesh as Group, locked);
}

export function setEnemyDenied(mesh: Object3D) {
  mesh.userData.deniedUntil = elapsedNow + 0.5;
  spawnRing(mesh.position, hdr(DENY_RED, 1.2), 2.4, 0.3);
}

// Player shot: an ink-finned dart with a white-hot head — a drafting pen
// fired down the sight line.
export function createProjectileMesh() {
  const group = new Group();
  const coreGeometry = new OctahedronGeometry(0.32, 0);
  coreGeometry.scale(0.5, 0.5, 2.4);
  group.add(new Mesh(coreGeometry, new MeshBasicMaterial({ color: hdr(HOT_WHITE, 2.4) })));
  const finGeometry = new OctahedronGeometry(0.5, 0);
  finGeometry.scale(0.55, 0.55, 1.6);
  group.add(new Mesh(finGeometry, new MeshBasicMaterial({ color: INK.clone(), transparent: true, opacity: 0.7 })));
  projectileRecords.enqueue({ mesh: group, trailColor: new Color(0.55, 0.56, 0.6) });
  return group;
}

// ---- reticle -------------------------------------------------------------------

export function createReticle() {
  const group = new Group();

  const outer = new Mesh(new RingGeometry(0.86, 0.91, 48), new MeshBasicMaterial({ color: INK.clone(), side: DoubleSide }));
  group.add(outer);

  const square = new Group();
  const inner = new Mesh(new RingGeometry(0.52, 0.565, 4), new MeshBasicMaterial({ color: INK.clone(), side: DoubleSide }));
  inner.rotation.z = Math.PI / 4;
  square.add(inner);
  group.add(square);

  // Six pips around the sight — one per lock, filling in the cube's colors.
  const pips: MeshBasicMaterial[] = [];
  const pipRing = new Group();
  for (let i = 0; i < 6; i += 1) {
    const material = new MeshBasicMaterial({ color: CHASSIS_MID.clone() });
    const pip = new Mesh(new BoxGeometry(0.14, 0.14, 0.02), material);
    const angle = Math.PI / 2 - (i / 6) * Math.PI * 2;
    pip.position.set(Math.cos(angle) * 1.12, Math.sin(angle) * 1.12, 0);
    pip.rotation.z = angle;
    pipRing.add(pip);
    pips.push(material);
  }
  group.add(pipRing);

  const dot = new Mesh(new CircleGeometry(0.055, 16), new MeshBasicMaterial({ color: INK.clone() }));
  group.add(dot);

  group.userData.outerMaterial = outer.material;
  group.userData.innerMaterial = inner.material;
  group.userData.pips = pips;
  group.userData.spinner = square;
  group.userData.active = false;
  return group;
}

export function setReticleActive(reticle: Object3D, active: boolean, lockCount: number) {
  reticle.userData.active = active;
  reticle.scale.setScalar(1 + lockCount * 0.06 + (active ? 0.05 : 0));
  const pips = reticle.userData.pips as MeshBasicMaterial[];
  for (let i = 0; i < pips.length; i += 1) {
    if (i < lockCount) pips[i].color.copy(hdr(SOLVE_COLORS[i], 1.35));
    else pips[i].color.copy(CHASSIS_MID).multiplyScalar(active ? 1.1 : 0.9);
  }
  const charge = lockCount === 0 ? null : LOCK_GRADIENT[Math.min(2, Math.floor((lockCount - 1) / 2))];
  const outer = reticle.userData.outerMaterial as MeshBasicMaterial;
  const inner = reticle.userData.innerMaterial as MeshBasicMaterial;
  outer.color.copy(charge ? hdr(charge, 1.15) : INK).multiplyScalar(active ? 1.15 : 1);
  inner.color.copy(charge ? hdr(charge, 1.3) : INK);
}

// ---- event wiring ----------------------------------------------------------------

export function installVisualEventHandlers(bus: EventBus, scene: Scene, cameraFeel: CameraFeelRig) {
  bus.on('beat', ({ isDownbeat, beatNumber }) => {
    lastBeatAt = elapsedNow;
    beatEnergy = Math.max(beatEnergy, isDownbeat ? 1 : 0.45);
    // Attract idle: the cube slowly shuffles itself on alternating downbeats.
    if (cube && isDownbeat && beatNumber % 8 === 0) cube.idleRatchet(elapsedNow);
  });

  bus.on('spawn', ({ enemyId, kind, worldPosition }) => {
    const record = enemyRecords.claim(enemyId);
    if (!record) return;
    if (kind === 'core') {
      cameraFeel.shake(1.2, SPEEDSOLVE_SHAKE);
      surgePulse = Math.max(surgePulse, 0.6);
      flashUniform.value = Math.max(flashUniform.value, 0.4);
      spawnRing(worldPosition, hdr(HOT_WHITE, 1.3), 30, 0.8);
      spawnRing(worldPosition, hdr(SOLVE_COLORS[5], 1.0), 18, 0.6);
    } else if (kind === 'weakpoint') {
      const face = record.mesh.userData.faceIndex as number | undefined;
      if (face !== undefined) cube?.ensureHatch(face);
      spawnRing(worldPosition, hdr(HOT_ORANGE, 1.15), 4.2, 0.4);
    } else if (kind === 'panel') {
      const face = record.mesh.userData.faceIndex as number | undefined;
      spawnRing(worldPosition, hdr(face !== undefined ? SOLVE_COLORS[face] : HOT_WHITE, 1.0), 3.4, 0.35);
    } else if (kind !== 'bolt') {
      spawnRing(worldPosition, hdr(HOT_WHITE, 0.6), 2.4, 0.3);
    }
  });

  bus.on('lock', ({ enemyId, worldPosition, lockCount }) => {
    const lockColor = LOCK_GRADIENT[Math.min(2, Math.floor((lockCount - 1) / 2))];
    const record = enemyRecords.get(enemyId);
    if (record && !record.lockRing) {
      lockRings.attach(record, makeLockBracket(lockColor), scene);
    }
    spawnRing(worldPosition, hdr(lockColor, 1.25), 2.2, 0.24);
  });

  bus.on('unlock', ({ enemyId }) => {
    const record = enemyRecords.get(enemyId);
    if (record) lockRings.detach(record);
  });

  bus.on('fire', ({ projectileId, worldPosition }) => {
    projectileRecords.claim(projectileId);
    spawnGlint(worldPosition, hdr(HOT_WHITE, 1.1), 0.5, 0.12);
  });

  bus.on('hit', ({ enemyId, projectileId, worldPosition, lethal }) => {
    projectileRecords.delete(projectileId);
    const record = enemyRecords.get(enemyId);
    const accent = (record?.mesh.userData.accent as Color | undefined) ?? HOT_WHITE;
    burstSparks(worldPosition, hdr(accent, 0.9), 5, 9);
    if (record && !lethal) {
      record.mesh.userData.damageFlashUntil = elapsedNow + 0.25;
      spawnGlint(worldPosition, hdr(HOT_WHITE, 1.6), 0.9, 0.14);
      if (record.mesh.userData.isCore) cameraFeel.shake(0.3, SPEEDSOLVE_SHAKE);
    }
  });

  bus.on('stage', ({ enemyId, worldPosition }) => {
    const record = enemyRecords.get(enemyId);
    if (!record) return;
    const specs = record.mesh.userData.shardSpecs as ChipSpec[] | undefined;
    if (record.mesh.userData.isCore) {
      cameraFeel.shake(1.0, SPEEDSOLVE_SHAKE);
      surgePulse = Math.max(surgePulse, 0.45);
      flashUniform.value = Math.max(flashUniform.value, 0.3);
      spawnRing(worldPosition, hdr(HOT_WHITE, 1.4), 22, 0.7);
      if (specs) burstShards(worldPosition, specs.slice(0, 8));
      burstSparks(worldPosition, hdr(HOT_WHITE, 1.1), 20, 18);
    } else {
      // A casing shears off a gunner or the weakpoint housing cracks.
      if (specs) burstShards(worldPosition, specs.slice(0, 4));
      burstSparks(worldPosition, hdr(HOT_ORANGE, 0.9), 8, 11);
      spawnRing(worldPosition, hdr(HOT_ORANGE, 1.1), 4.5, 0.4);
    }
  });

  bus.on('kill', ({ enemyId, worldPosition }) => {
    const record = enemyRecords.get(enemyId);
    if (!record) return;
    const kind = record.mesh.userData.kind as string;
    const accent = (record.mesh.userData.accent as Color | undefined) ?? HOT_WHITE;
    const specs = record.mesh.userData.shardSpecs as ChipSpec[] | undefined;
    if (specs) burstShards(worldPosition, specs);
    burstSparks(worldPosition, hdr(accent, 0.95), 8, 12);
    spawnRing(worldPosition, hdr(accent, 0.9), 4.2, 0.38);
    spawnGlint(worldPosition, hdr(HOT_WHITE, 1.5), 1.1, 0.16);

    if (kind === 'panel') {
      const face = (record.mesh.userData.faceIndex as number | undefined) ?? 0;
      cube?.onPanelKilled(face, elapsedNow, nextBeatTime, BEAT_SECONDS);
      panelKillsByFace[face] += 1;
      cameraFeel.shake(0.3, SPEEDSOLVE_SHAKE);
      if (panelKillsByFace[face] === 4) {
        // The face reaches a single color on the next beat: stage the flash
        // and the shower of loose tiles for the moment the layer lands.
        pendingSolveFlashes.push({ at: nextBeatTime(elapsedNow) + 0.18, face, center: worldPosition.clone() });
      }
    } else if (kind === 'weakpoint') {
      cameraFeel.shake(0.8, SPEEDSOLVE_SHAKE);
      flashUniform.value = Math.max(flashUniform.value, 0.22);
      spawnRing(worldPosition, hdr(HOT_ORANGE, 1.3), 10, 0.5);
      burstSparks(worldPosition, hdr(HOT_ORANGE, 1.1), 18, 16);
    } else if (kind === 'core') {
      // The finish: the naked core bursts into a confetti storm.
      coreKilled = true;
      cube?.onCoreKilled();
      cameraFeel.shake(1.6, SPEEDSOLVE_SHAKE);
      surgePulse = 1;
      flashUniform.value = 1;
      spawnRing(worldPosition, hdr(HOT_WHITE, 1.6), 60, 1.2);
      for (let i = 0; i < SOLVE_COLORS.length; i += 1) {
        spawnRing(worldPosition, hdr(SOLVE_COLORS[i], 1.1), 14 + i * 7, 0.55 + i * 0.1);
      }
      spawnGlint(worldPosition, hdr(HOT_WHITE, 2.2), 6, 0.5);
      burstConfetti(worldPosition, 420, 24);
    }

    enemyRecords.delete(enemyId, { dispose: true });
  });

  bus.on('miss', ({ enemyId, worldPosition }) => {
    const record = enemyRecords.get(enemyId);
    if (record) enemyRecords.delete(enemyId, { dispose: true });
    burstSparks(worldPosition, CHASSIS_MID.clone().multiplyScalar(0.7), 3, 4, 3);
  });

  bus.on('volley', ({ size, kills }) => {
    if (size >= 5 && kills === size) {
      beatEnergy = Math.max(beatEnergy, 1.5);
      flashUniform.value = Math.max(flashUniform.value, 0.14);
    }
  });

  bus.on('playerhit', () => {
    hitsTaken += 1;
    damagePulse = 1;
    beatEnergy = 1.3;
    cameraFeel.shake(1.25, SPEEDSOLVE_SHAKE);
  });

  bus.on('runstart', () => {
    resetEffects();
    enemyRecords.clear({ dispose: true, pending: true });
    projectileRecords.clear({ pending: true });
    cube?.reset();
    cameraFeel.restore();
    flashUniform.value = 0;
    solvePulseUniform.value = 0;
    damageUniform.value = 0;
    surgePulse = 0;
    damagePulse = 0;
    hitsTaken = 0;
    coreKilled = false;
    coreCharge = 0;
    shellsKicked = false;
    swinging = false;
    cameraFovOffset = 0;
    panelKillsByFace.fill(0);
    pendingSolveFlashes.length = 0;
  });

  bus.on('runend', () => {
    cameraFeel.restore();
    if (!coreKilled) cube?.sealCore();
  });
}

// ---- per-frame update ---------------------------------------------------------------

export function updateVisuals(dt: number, ctx: VisualContext) {
  elapsedNow = ctx.elapsed;
  beatEnergy = Math.max(0, beatEnergy - dt * 4.2);
  surgePulse = Math.max(0, surgePulse - dt * 0.9);
  damagePulse = Math.max(0, damagePulse - dt * 1.4);

  const runTime = ctx.running ? ctx.runTime : 0;

  // Staged face-solve payoffs land on their beat.
  for (let i = pendingSolveFlashes.length - 1; i >= 0; i -= 1) {
    const pending = pendingSolveFlashes[i];
    if (elapsedNow < pending.at) continue;
    pendingSolveFlashes.splice(i, 1);
    const color = SOLVE_COLORS[pending.face];
    solveColorUniform.value.set(color.r, color.g, color.b);
    solvePulseUniform.value = 1;
    flashUniform.value = Math.max(flashUniform.value, 0.4);
    ctx.feel.shake(0.75, SPEEDSOLVE_SHAKE);
    spawnRing(pending.center, hdr(color, 1.3), 16, 0.6);
    burstConfetti(pending.center, 60, 12);
  }

  // Coda confetti rain while the burst settles.
  if (coreKilled && ctx.running && runTime > CODA_TIME && elapsedNow - lastConfettiRainAt > 0.35) {
    lastConfettiRainAt = elapsedNow;
    const camera = ctx.camera as PerspectiveCamera;
    const forward = new Vector3();
    camera.getWorldDirection(forward);
    const right = new Vector3().setFromMatrixColumn(camera.matrixWorld, 0).normalize();
    const origin = camera.position.clone()
      .addScaledVector(forward, 26)
      .addScaledVector(right, (Math.random() - 0.5) * 32)
      .add(new Vector3(0, 14, 0));
    burstConfetti(origin, 16, 5);
  }

  environment?.update(dt, ctx.elapsed);
  cube?.setCoreCharge(coreCharge);
  cube?.update(dt, { elapsed: ctx.elapsed, runTime, running: ctx.running, beatEnergy });

  damageUniform.value = Math.min(1, damagePulse * 0.75 + Math.min(1, hitsTaken / 3) * 0.08);
  flashUniform.value = Math.max(0, flashUniform.value - dt * (flashUniform.value > 0.7 ? 1.6 : 2.4));
  solvePulseUniform.value = Math.max(0, solvePulseUniform.value - dt * 1.7);

  for (const [enemyId, record] of enemyRecords.entries()) {
    if (!record.mesh.parent) {
      enemyRecords.delete(enemyId, { dispose: true });
      continue;
    }
    if (record.bornAt === null) record.bornAt = elapsedNow;
    const age = elapsedNow - record.bornAt;
    record.mesh.scale.setScalar(easeOutBack(Math.min(1, age / 0.35)));

    updateEnemyTint(record);

    const userData = record.mesh.userData;

    // Wave polyhedra spin about their travel axis.
    const spinner = userData.spinner as Group | undefined;
    if (spinner && userData.isCore !== true) {
      spinner.rotation.z += dt * ((userData.spinRate as number | undefined) ?? 0);
    }

    // Solve squares breathe with the beat — armed machinery, not decoration.
    if (userData.isPanel) {
      const diamond = userData.diamond as Group | undefined;
      if (diamond) {
        diamond.scale.setScalar(1 + beatEnergy * 0.07);
        diamond.rotation.z = Math.PI / 4 + Math.sin(elapsedNow * 1.1) * 0.06;
      }
    }

    // Octa gunner wind-up lamp.
    if (userData.kind === 'octa') {
      const lamp = userData.chargeLamp as MeshBasicMaterial | undefined;
      const charge = (userData.charge as number | undefined) ?? 0;
      if (lamp && userData.locked !== true) {
        lamp.color.copy(HOT_WHITE).multiplyScalar(0.5 + charge * 2.0);
      }
    }

    // Weakpoint heart pumps as it emerges.
    if (userData.isWeakpoint) {
      const heart = userData.heart as Mesh | undefined;
      const emerge = (userData.emerge as number | undefined) ?? 1;
      if (heart) {
        heart.scale.setScalar(0.4 + emerge * (0.6 + Math.max(0, Math.sin(elapsedNow * 10)) * 0.18));
        (heart.material as MeshBasicMaterial).color.copy(HOT_ORANGE).multiplyScalar(1.2 + beatEnergy * 0.7);
      }
    }

    // The core spins up with the damage it has taken.
    if (userData.isCore) {
      coreCharge = (userData.chargeLevel as number | undefined) ?? coreCharge;
      const flinching = userData.flinching === true;
      if (spinner) {
        spinner.rotation.y += dt * (0.8 + coreCharge * 4.5) * (flinching ? 0.2 : 1);
        spinner.rotation.x += dt * (0.35 + coreCharge * 1.6);
      }
      const heart = userData.heart as Mesh | undefined;
      if (heart) {
        const throb = 1 + Math.sin(elapsedNow * (6 + coreCharge * 14)) * (0.06 + coreCharge * 0.12);
        heart.scale.setScalar(throb);
        (heart.material as MeshBasicMaterial).color
          .copy(HOT_WHITE)
          .multiplyScalar(1.4 + coreCharge * 1.4 + beatEnergy * 0.4);
      }
    }

    if (userData.isHostileShot) {
      const colorIndex = userData.colorIndex as number | undefined;
      if (colorIndex !== undefined && userData.boltTinted !== true) {
        userData.boltTinted = true;
        const parts = userData.parts as TintPart[];
        for (const part of parts) {
          if (part.kind === 'core') part.base.copy(hdr(SOLVE_COLORS[colorIndex], 1.5));
        }
        (userData.accent as Color).copy(SOLVE_COLORS[colorIndex]);
      }
      dropTrail(record.mesh.position, ((userData.accent as Color | undefined) ?? HOT_WHITE).clone().multiplyScalar(0.9));
    }

    if (record.lockRing) {
      record.mesh.getWorldPosition(record.lockRing.position);
      record.lockRing.quaternion.copy((ctx.camera as PerspectiveCamera).quaternion);
      record.lockRing.rotation.z += dt * 1.9;
      const pulse = 1 + Math.sin(elapsedNow * 9) * 0.05;
      const fit = (record.mesh.userData.lockRingScale as number | undefined) ?? 1;
      record.lockRing.scale.setScalar(pulse * 1.8 * fit);
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
    reticleSpinner.rotation.z += dt * (active ? 3.8 : 0.8);
  }

  updateEffects(dt, ctx.camera);
}

// FOV and shake live here; the aim itself is gameplay's camera hook so the
// headless simulation sees the same framing the player does.
export function updateCameraFeel(dt: number, ctx: CameraFeelContext) {
  const runTime = ctx.running ? ctx.runTime : 0;

  if (ctx.running) {
    const swing = swingAt(runTime);
    if (swing && !swinging) ctx.feel.kickFov(3.2);
    swinging = swing !== null;
    if (!shellsKicked && runTime >= CORE_TIME) {
      shellsKicked = true;
      ctx.feel.kickFov(7);
      ctx.feel.shake(1.3, SPEEDSOLVE_SHAKE);
      flashUniform.value = Math.max(flashUniform.value, 0.55);
      surgePulse = Math.max(surgePulse, 0.8);
      spawnRing(CUBE_CENTER.clone(), hdr(HOT_WHITE, 1.2), 44, 1.0);
    }
  }

  const targetFovOffset = beatEnergy * 0.8 + surgePulse * 6;
  cameraFovOffset = MathUtils.lerp(cameraFovOffset, targetFovOffset, Math.min(1, dt * 6));
  ctx.feel.setFovOffset(cameraFovOffset);
  ctx.feel.update(dt, { shake: SPEEDSOLVE_SHAKE });
}

function updateEnemyTint(record: EnemyRecord) {
  const userData = record.mesh.userData;
  const denied = ((userData.deniedUntil as number | undefined) ?? -Infinity) > elapsedNow;

  if (userData.isLetter) {
    if (denied) setLetterDenied(record.mesh, true);
    else if (userData.locked !== true) setLetterLocked(record.mesh, false);
    return;
  }

  const parts = userData.parts as TintPart[] | undefined;
  if (!parts) return;

  // Panels take their face color the moment gameplay stamps the face index:
  // corner pips go saturated, the lens stays white-hot, ink frame stays ink.
  if (userData.isPanel && userData.faceIndex !== undefined && userData.colorApplied !== true) {
    userData.colorApplied = true;
    const color = SOLVE_COLORS[userData.faceIndex as number];
    for (const part of parts) {
      if (part.kind === 'fill') part.base.copy(hdr(color, 1.25));
    }
    (userData.accent as Color).copy(color);
    for (const spec of userData.shardSpecs as ChipSpec[]) spec.color.copy(color);
  }

  const locked = userData.locked === true;
  const damageFlash = ((userData.damageFlashUntil as number | undefined) ?? -Infinity) > elapsedNow;

  for (const part of parts) {
    if (denied) {
      part.material.color.copy(part.kind === 'fill' ? DENY_RED.clone().multiplyScalar(0.5) : DENY_RED);
      continue;
    }
    if (locked) {
      if (part.kind === 'edge') part.material.color.copy(userData.accent as Color ?? part.base);
      else if (part.kind === 'fill') part.material.color.copy(part.base).lerp(INK, 0.45);
      else part.material.color.copy(hdr(HOT_WHITE, 2.0));
      continue;
    }
    if (damageFlash) {
      part.material.color.copy(hdr(HOT_WHITE, part.kind === 'fill' ? 0.9 : 1.7));
      continue;
    }
    part.material.color.copy(part.base);
  }
}

function findReticleSpinner(scene: Scene): Group | null {
  for (const child of scene.children) {
    if (child.userData.spinner && child.userData.pips) return child.userData.spinner as Group;
  }
  return null;
}

function makeLockBracket(color: Color): Group {
  const group = new Group();
  group.name = 'lock-bracket';
  // A solver's registration mark: an ink square clamp with a colored ring.
  const square = new Mesh(
    new RingGeometry(0.86, 0.94, 4),
    new MeshBasicMaterial({ color: INK.clone(), side: DoubleSide }),
  );
  square.rotation.z = Math.PI / 4;
  const innerRing = new Mesh(
    new RingGeometry(0.64, 0.68, 32),
    new MeshBasicMaterial({ color: hdr(color, 1.35), side: DoubleSide }),
  );
  group.add(square, innerRing);
  return group;
}

function easeOutBack(t: number): number {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2;
}
