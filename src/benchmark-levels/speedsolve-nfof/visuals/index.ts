import {
  AdditiveBlending,
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
} from 'three';
import type { CameraFeelRig, CameraFeelShakeOptions } from '../../../engine/camera-feel';
import { configureAdditiveMaterial, createAdditiveBasicMaterial, createAdornmentSlot, createPendingVisualRecords, disposeObject3D } from '../../../engine/visual-kit';
import type { EventBus } from '../../../events';
import { createSpeedsolveRail, speedsolveRunProgress, speedsolveSpeedAt } from '../gameplay';
import { CUBE_HALF } from '../timing';
import { solveState } from '../solve-state';
import { burstCandy, burstSlag, burstSparks, createEffects, dropTrail, resetEffects, spawnGlint, spawnRing, updateEffects, type ShardSpec } from './effects';
import { createCubeShell, cubeCenterWorldPos, faceSlotWorldPos, wireSharedRig, type CubeShell } from './cube';
import {
  animateCell,
  animateCoreEnemy,
  animateWeak,
  createBoltMesh,
  createCellMesh,
  createCoreEnemyMesh,
  createMoteMesh,
  createOctaMesh,
  createPrismMesh,
  createTetraMesh,
  createWeakMesh,
} from './enemies';
import { createEnvironmentInternal, resetEnvironment, updateEnvironment, type Environment } from './environment';
import { createLetterMesh, setLetterDenied, setLetterLocked } from './letters';
import { DENY_FILL, DENY_RED, faceColor, hdr, MARK_HOT, MARK_WHITE } from './palette';
import { flashUniform, hitEdgeUniform } from './post-fx';

export type SpeedsolveVisualFrame = {
  scene: Scene;
  camera: PerspectiveCamera;
  elapsed: number;
  runTime: number;
  running: boolean;
  feel: CameraFeelRig;
};

export type SpeedsolveCameraFrame = {
  camera: PerspectiveCamera;
  runTime: number;
  running: boolean;
  feel: CameraFeelRig;
};

type EnemyRecord = {
  mesh: Group;
  bornAt: number | null;
  lockRing: Group | null;
  baseline: Map<MaterialLike, Color>;
};

type MaterialLike = MeshBasicMaterial | { color: Color };

const rail = createSpeedsolveRail();

let environment: Environment | null = null;
let cube: CubeShell | null = null;

let beatEnergy = 0;
let surgePulse = 0;
let cameraFovOffset = 0;
let cameraRoll = 0;
let elapsedNow = 0;
let lastRunTime = -1;
let coreSpinRate = 0;

const lockRings = createAdornmentSlot<EnemyRecord, Group>({
  get: (record) => record.lockRing,
  set: (record, ring) => {
    record.lockRing = ring;
  },
});

const enemyRecords = createPendingVisualRecords<Group, EnemyRecord>({
  createRecord: (mesh) => ({ mesh, bornAt: null, lockRing: null, baseline: new Map() }),
  disposeRecord: (record) => disposeObject3D(record.mesh),
});
const projectileRecords = createPendingVisualRecords<Object3D, Object3D>({
  createRecord: (mesh) => mesh,
  disposeRecord: (record) => disposeObject3D(record),
});

const SHAKE: CameraFeelShakeOptions = {
  decay: 2.6,
  maxTrauma: 1,
  pitchDegrees: 0.3,
  yawDegrees: 0.24,
  rollDegrees: 0.6,
  frequency: 8.5,
  smoothing: 20,
};

// ---- factories ---------------------------------------------------------------

export function createEnvironment(scene: Scene) {
  environment = createEnvironmentInternal(scene);
  createEffects(scene);
  cube = createCubeShell();
  scene.add(cube.root);
}

export function wireRig(rig: Parameters<typeof wireSharedRig>[0]) {
  wireSharedRig(rig);
  // The rig arrives after the shell exists; give attract mode a settled pose —
  // per-frame updates only run once the run starts, so apply it directly.
  rig.poseAttract();
  const state = rig.state;
  if (cube) {
    cube.root.position.copy(state.pos);
    cube.root.quaternion.copy(state.quat);
  }
}

export function createEnemyMesh(kind: string, letter?: string) {
  const mesh = buildEnemyMesh(kind, letter);
  mesh.userData.kind = kind;
  mesh.scale.setScalar(0.001);
  enemyRecords.enqueue(mesh);
  return mesh;
}

function buildEnemyMesh(kind: string, letter?: string): Group {
  if (kind === 'letter' || letter) return createLetterMesh(letter ?? 'S');
  switch (kind) {
    case 'cell':
      return createCellMesh();
    case 'weak':
      return createWeakMesh();
    case 'tetra':
      return createTetraMesh(Math.floor(Math.random() * 6));
    case 'octa':
      return createOctaMesh(Math.floor(Math.random() * 6));
    case 'prism':
      return createPrismMesh();
    case 'bolt':
      return createBoltMesh();
    case 'core':
      return createCoreEnemyMesh();
    case 'mote':
      return createMoteMesh();
    default:
      return new Group(); // conductor: invisible choreography node
  }
}

export function setEnemyLocked(mesh: Object3D, locked: boolean) {
  mesh.userData.locked = locked;
  if (mesh.userData.isLetter) setLetterLocked(mesh as Group, locked);
}

export function setEnemyDenied(mesh: Object3D) {
  mesh.userData.deniedUntil = elapsedNow + 0.5;
  spawnRing(mesh.position, DENY_RED, 2.6, 0.3);
}

export function createProjectileMesh() {
  const group = new Group();
  const coreGeometry = new OctahedronGeometry(0.3, 0);
  coreGeometry.scale(0.42, 0.42, 2.1);
  group.add(new Mesh(coreGeometry, new MeshBasicMaterial({ color: hdr(MARK_WHITE, 2.4) })));
  const shellGeometry = new OctahedronGeometry(0.46, 0);
  shellGeometry.scale(0.5, 0.5, 1.8);
  group.add(new Mesh(shellGeometry, createAdditiveBasicMaterial({ color: hdr(faceColor(solveState.faceIndex), 1.1), opacity: 0.5 })));
  projectileRecords.enqueue(group);
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

  // Four square bracket corners — a precision jig, like a cube template.
  const bracketLength = 0.34;
  for (let i = 0; i < 4; i += 1) {
    const sx = i < 2 ? 1 : -1;
    const sy = i % 2 === 0 ? 1 : -1;
    const horizontal = new Mesh(new PlaneGeometry(bracketLength, 0.05), new MeshBasicMaterial());
    horizontal.position.set(sx * 0.62, sy * 0.86, 0);
    addPart(horizontal, hdr(MARK_WHITE, 1.2));
    const vertical = new Mesh(new PlaneGeometry(0.05, bracketLength), new MeshBasicMaterial());
    vertical.position.set(sx * 0.86, sy * 0.62, 0);
    addPart(vertical, hdr(MARK_WHITE, 1.2));
  }

  // Broken alignment ring.
  const spinner = new Group();
  const segment = new Mesh(new RingGeometry(0.44, 0.472, 24, 1, 0, Math.PI * 0.5), new MeshBasicMaterial());
  addPart(segment, hdr(MARK_WHITE, 1.0));
  const segment2 = new Mesh(new RingGeometry(0.44, 0.472, 24, 1, Math.PI, Math.PI * 0.5), new MeshBasicMaterial());
  addPart(segment2, hdr(MARK_WHITE, 1.0));
  spinner.add(segment, segment2);

  const pip = new Mesh(new CircleGeometry(0.05, 16), new MeshBasicMaterial());
  addPart(pip, hdr(MARK_HOT, 2));

  group.add(spinner, pip);
  group.userData.parts = parts;
  group.userData.spinner = spinner;
  group.userData.active = false;
  return group;
}

export function setReticleActive(reticle: Object3D, active: boolean, lockCount: number) {
  reticle.userData.active = active;
  reticle.scale.setScalar(1 + lockCount * 0.06 + (active ? 0.05 : 0));
  const parts = reticle.userData.parts as Array<{ material: MeshBasicMaterial; base: Color }>;
  const charge = lockCount === 0 ? null : lockChargeColor(lockCount);
  for (const part of parts) {
    if (charge) part.material.color.copy(hdr(charge, active ? 1.7 : 1.3));
    else part.material.color.copy(part.base).multiplyScalar(active ? 1.3 : 1);
  }
}

// ---- event wiring ------------------------------------------------------------

export function installVisualEventHandlers(bus: EventBus, scene: Scene, cameraFeel: CameraFeelRig) {
  bus.on('spawn', ({ enemyId, kind, worldPosition }) => {
    const record = enemyRecords.claim(enemyId);
    if (!record) return;
    if (kind === 'core') {
      cameraFeel.shake(0.5, SHAKE);
      surgePulse = Math.max(surgePulse, 0.5);
      flashUniform.value = Math.max(flashUniform.value, 0.35);
      spawnRing(worldPosition, hdr(MARK_WHITE, 1.3), 26, 0.9);
    } else if (kind === 'weak') {
      spawnRing(worldPosition, hdr(faceColor(solveState.faceIndex), 1.2), 6, 0.5);
      spawnGlint(worldPosition, hdr(MARK_WHITE, 1.8), 1.2, 0.3);
    } else if (kind === 'tetra' || kind === 'octa' || kind === 'prism') {
      spawnRing(worldPosition, hdr(record.mesh.userData.accent as Color ?? MARK_WHITE, 0.8), 2.2, 0.32);
    }
  });

  bus.on('lock', ({ enemyId, worldPosition, lockCount }) => {
    const lockColor = lockChargeColor(lockCount);
    const record = enemyRecords.get(enemyId);
    if (record && !record.lockRing) lockRings.attach(record, makeLockRing(lockColor), scene);
    spawnRing(worldPosition, hdr(lockColor, 1.3), 1.8, 0.24);
  });

  bus.on('unlock', ({ enemyId }) => {
    const record = enemyRecords.get(enemyId);
    if (record) lockRings.detach(record);
  });

  bus.on('fire', ({ projectileId, worldPosition }) => {
    projectileRecords.claim(projectileId);
    spawnGlint(worldPosition, hdr(MARK_WHITE, 1.2), 0.5, 0.12);
  });

  bus.on('hit', ({ enemyId, projectileId, worldPosition, lethal }) => {
    projectileRecords.delete(projectileId, { dispose: true });
    burstSparks(worldPosition, hdr(MARK_WHITE, 0.9), 5, 9, 1.6);
    if (lethal) return;
    const record = enemyRecords.get(enemyId);
    if (record) record.mesh.userData.damageFlashUntil = elapsedNow + 0.28;
    spawnGlint(worldPosition, hdr(MARK_WHITE, 1.8), 1, 0.16);
  });

  bus.on('stage', ({ enemyId, worldPosition }) => {
    const record = enemyRecords.get(enemyId);
    const isCore = record?.mesh.userData.kind === 'core';
    if (isCore) {
      cameraFeel.shake(0.5, SHAKE);
      surgePulse = Math.max(surgePulse, 0.5);
      flashUniform.value = Math.max(flashUniform.value, 0.22);
      burstCandy(worldPosition, 12, 10, 1.4);
      burstSparks(worldPosition, hdr(MARK_WHITE, 1.1), 14, 14);
      spawnRing(worldPosition, hdr(MARK_WHITE, 1.3), 16, 0.6);
    } else {
      cameraFeel.shake(0.3, SHAKE);
      burstSlag(worldPosition, (record?.mesh.userData.shardSpecs as ShardSpec[] ?? []).slice(0, 3));
      burstSparks(worldPosition, hdr(faceColor(solveState.faceIndex), 1.1), 8, 11);
      spawnRing(worldPosition, hdr(faceColor(solveState.faceIndex), 1.2), 4.5, 0.4);
    }
  });

  bus.on('kill', ({ enemyId, worldPosition }) => {
    const record = enemyRecords.get(enemyId);
    if (!record) return;
    const kind = record.mesh.userData.kind;
    const accent = (record.mesh.userData.accent as Color | undefined) ?? faceColor(solveState.faceIndex);
    const specs = record.mesh.userData.shardSpecs as ShardSpec[] | undefined;

    if (kind === 'core') {
      // The set piece: the core bursts into a confetti storm of tiny cubes.
      cameraFeel.shake(1, SHAKE);
      surgePulse = 1;
      flashUniform.value = Math.max(flashUniform.value, 0.9);
      spawnRing(worldPosition, hdr(MARK_WHITE, 1.5), 60, 1.4);
      spawnRing(worldPosition, hdr(faceColor(0), 1.1), 42, 1.2);
      spawnRing(worldPosition, hdr(faceColor(3), 1), 26, 1);
      burstCandy(worldPosition, 170, 17, 2.8);
      burstSparks(worldPosition, hdr(MARK_WHITE, 1.2), 40, 22, 1);
      coreSpinRate = 1.2;
      enemyRecords.delete(enemyId, { dispose: true });
      return;
    }

    if (kind === 'weak') {
      cameraFeel.shake(0.45, SHAKE);
      flashUniform.value = Math.max(flashUniform.value, 0.22);
      if (specs) burstSlag(worldPosition, specs);
      burstCandy(worldPosition, 14, 9, 1.6);
      burstSparks(worldPosition, hdr(MARK_WHITE, 1), 12, 13);
      spawnRing(worldPosition, hdr(MARK_WHITE, 1.2), 12, 0.6);
    } else if (kind === 'cell') {
      burstCandy(worldPosition, 5, 5, 1);
      burstSparks(worldPosition, hdr(faceColor(solveState.faceIndex), 1), 6, 9);
      spawnRing(worldPosition, hdr(faceColor(solveState.faceIndex), 1), 3.4, 0.34);
    } else {
      if (specs) burstSlag(worldPosition, specs);
      burstSparks(worldPosition, hdr(MARK_WHITE, 0.9), 8, 11);
      spawnRing(worldPosition, hdr(accent, 0.9), 3.8, 0.38);
    }
    enemyRecords.delete(enemyId, { dispose: true });
  });

  bus.on('miss', ({ enemyId, worldPosition }) => {
    if (enemyRecords.get(enemyId)) enemyRecords.delete(enemyId, { dispose: true });
    burstSparks(worldPosition, faceColor(solveState.faceIndex).clone().multiplyScalar(0.4), 3, 3, 1);
  });

  bus.on('reject', () => {
    cameraFeel.shake(0.22, SHAKE);
  });

  bus.on('volley', ({ size, kills }) => {
    if (size >= 5 && kills === size) {
      beatEnergy = Math.max(beatEnergy, 1.4);
      flashUniform.value = Math.max(flashUniform.value, 0.16);
    }
  });

  bus.on('beat', ({ isDownbeat }) => {
    beatEnergy = Math.max(beatEnergy, isDownbeat ? 1 : 0.4);
  });

  bus.on('playerhit', () => {
    hitEdgeUniform.value = Math.max(hitEdgeUniform.value, 1);
    cameraFeel.shake(0.5, SHAKE);
  });

  // Solve-state signals: the choreography spine.
  solveState.on((signal) => {
    switch (signal.type) {
      case 'snap': {
        cube?.setSolvedSnap(signal.face, signal.row, signal.col);
        burstCandy(faceSlotWorldPos(signal.row, signal.col), 3, 4, 0.9);
        break;
      }
      case 'face-clear': {
        cube?.dropFace(signal.face);
        const center = cubeCenterWorldPos(CUBE_HALF + 2);
        burstCandy(center, 30, 10, 1.9);
        burstSparks(center, hdr(faceColor(signal.face), 1.1), 16, 13);
        spawnRing(center, hdr(faceColor(signal.face), 1.2), 22, 0.8);
        flashUniform.value = Math.max(flashUniform.value, 0.3);
        cameraFeel.shake(0.45, SHAKE);
        break;
      }
      case 'face-change': {
        surgePulse = Math.max(surgePulse, 0.55);
        cameraFeel.kickFov(3.5);
        break;
      }
      case 'face-conquered': {
        const center = cubeCenterWorldPos(CUBE_HALF + 1);
        spawnRing(center, hdr(faceColor(signal.face), 1.3), 30, 0.9);
        burstCandy(center, 16, 12, 1.7);
        flashUniform.value = Math.max(flashUniform.value, 0.4);
        cameraFeel.shake(0.5, SHAKE);
        break;
      }
      case 'core-reveal': {
        cube?.dropEverything();
        flashUniform.value = Math.max(flashUniform.value, 0.5);
        cameraFeel.shake(0.6, SHAKE);
        surgePulse = Math.max(surgePulse, 0.7);
        break;
      }
      case 'core-dead':
        break;
    }
  });

  bus.on('runstart', () => {
    resetEffects();
    enemyRecords.clear({ dispose: true, pending: true });
    projectileRecords.clear({ dispose: true, pending: true });
    if (cube) cube.reset();
    if (environment) resetEnvironment(environment);
    flashUniform.value = 0;
    hitEdgeUniform.value = 0;
    beatEnergy = 0;
    surgePulse = 0;
    coreSpinRate = 0;
    cameraRoll = 0;
    cameraFovOffset = 0;
    lastRunTime = -1;
    cameraFeel.restore();
  });

  bus.on('runend', () => {
    cameraFeel.restore();
  });
}

// ---- per-frame ---------------------------------------------------------------

export function updateVisuals(dt: number, frame: SpeedsolveVisualFrame) {
  elapsedNow = frame.elapsed;
  beatEnergy = Math.max(0, beatEnergy - dt * 4.2);
  surgePulse = Math.max(0, surgePulse - dt * 0.85);
  const camera = frame.camera;

  if (frame.running) {
    const crossed = (t: number) => lastRunTime >= 0 && lastRunTime < t && frame.runTime >= t;
    lastRunTime = frame.runTime;
    void crossed;
  } else {
    lastRunTime = -1;
  }

  // Core spin-up: still, then screaming, then spent.
  const spinTarget = solveState.coreDeadAt !== null ? 1 : solveState.coreRevealed ? 6 : 0;
  coreSpinRate += (spinTarget - coreSpinRate) * Math.min(1, dt * (solveState.coreRevealed && coreSpinRate < 5 ? 0.9 : 2.4));

  const rigState = solveState.rig?.state;
  if (cube && rigState) {
    cube.root.position.copy(rigState.pos);
    cube.root.quaternion.copy(rigState.quat);
    cube.update(dt, elapsedNow, solveState.facesConquered);
  }
  if (environment) updateEnvironment(environment, { dt, elapsed: elapsedNow, camera });

  for (const [enemyId, record] of enemyRecords.entries()) {
    if (!record.mesh.parent) {
      enemyRecords.delete(enemyId, { dispose: true });
      continue;
    }
    if (record.bornAt === null) record.bornAt = elapsedNow;
    const age = elapsedNow - record.bornAt;
    if (record.mesh.userData.kind !== 'conductor') {
      record.mesh.scale.setScalar(easeOutBack(Math.min(1, age / 0.38)));
    }
    updateEnemyTint(record, camera);

    switch (record.mesh.userData.kind) {
      case 'cell':
        animateCell(record.mesh, elapsedNow);
        break;
      case 'weak':
        animateWeak(record.mesh, dt, elapsedNow);
        break;
      case 'core':
        animateCoreEnemy(record.mesh, dt, elapsedNow, coreSpinRate);
        break;
      default:
        break;
    }

    if (record.mesh.userData.isHostileShot) {
      dropTrail(record.mesh.position, record.mesh.userData.trailColor as Color);
    }

    if (record.lockRing) {
      record.mesh.getWorldPosition(record.lockRing.position);
      record.lockRing.quaternion.copy((camera as PerspectiveCamera).quaternion);
      record.lockRing.rotation.z += dt * 2.4;
      const pulse = 1 + Math.sin(elapsedNow * 9) * 0.05;
      const fit = (record.mesh.userData.lockRingScale as number | undefined) ?? 1;
      record.lockRing.scale.setScalar(pulse * 1.9 * fit);
    }
  }

  for (const [projectileId, record] of projectileRecords.entries()) {
    if (!record.parent) {
      projectileRecords.delete(projectileId, { dispose: true });
      continue;
    }
    dropTrail(record.position, faceColor(solveState.faceIndex).clone().multiplyScalar(0.8));
  }

  const spinner = findReticleSpinner(frame.scene);
  if (spinner) {
    const active = spinner.parent?.parent?.userData.active === true;
    spinner.rotation.z += dt * (active ? 3.4 : 1);
  }

  updateEffects(dt, camera);

  flashUniform.value = Math.max(0, flashUniform.value - dt * (flashUniform.value > 0.8 ? 1.4 : 2.4));
  hitEdgeUniform.value = Math.max(0, hitEdgeUniform.value - dt * 2.2);
}

// ---- camera effects ----------------------------------------------------------

export function updateSpeedsolveCameraEffects(dt: number, frame: SpeedsolveCameraFrame) {
  if (!(frame.camera instanceof PerspectiveCamera)) return;
  const camera = frame.camera;
  const speed = frame.running ? speedsolveSpeedAt(frame.runTime) : 0.85;

  let targetFovOffset = (speed - 1) * 9 + beatEnergy * 0.9 + surgePulse * 5;
  if (solveState.coreDeadAt !== null) targetFovOffset = MathUtils.lerp(targetFovOffset, -2.5, 0.6);
  cameraFovOffset = MathUtils.lerp(cameraFovOffset, targetFovOffset, Math.min(1, dt * 6));

  if (frame.running) {
    const u = speedsolveRunProgress(frame.runTime);
    const tangent = rail.getTangentAt(MathUtils.clamp(u, 0, 1));
    const ahead = rail.getTangentAt(MathUtils.clamp(u + 0.006, 0, 1));
    const targetRoll = MathUtils.clamp((ahead.x - tangent.x) * 22, -0.13, 0.13);
    cameraRoll += (targetRoll - cameraRoll) * Math.min(1, dt * 3);
    camera.rotateZ(cameraRoll);
  }

  frame.feel.setFovOffset(cameraFovOffset);
  frame.feel.update(dt, { shake: SHAKE });
}

// ---- helpers -----------------------------------------------------------------

function lockChargeColor(lockCount: number): Color {
  if (lockCount <= 2) return MARK_WHITE;
  if (lockCount <= 4) return MARK_HOT;
  return faceColor(solveState.faceIndex);
}

function makeLockRing(color: Color): Group {
  const group = new Group();
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

function findReticleSpinner(scene: Scene): Group | null {
  for (const child of scene.children) {
    if (child.userData.spinner) return child.userData.spinner as Group;
  }
  return null;
}

function updateEnemyTint(record: EnemyRecord, camera: PerspectiveCamera) {
  const userData = record.mesh.userData;
  if (userData.isLetter) {
    if ((userData.deniedUntil as number | undefined ?? -Infinity) > elapsedNow) setLetterDenied(record.mesh, true);
    else if (userData.locked !== true) setLetterDenied(record.mesh, false);
    return;
  }
  if (userData.kind === 'conductor') return;

  const denied = (userData.deniedUntil as number | undefined ?? -Infinity) > elapsedNow;
  const locked = userData.locked === true;
  const damageFlash = (userData.damageFlashUntil as number | undefined ?? -Infinity) > elapsedNow;
  const tint = locked ? faceColor(solveState.faceIndex) : null;

  record.mesh.traverse((child) => {
    const material = (child as Mesh).material as MeshBasicMaterial | undefined;
    if (!material || !material.color) return;
    let baseline = record.baseline.get(material as MaterialLike);
    if (!baseline) {
      baseline = material.color.clone();
      record.baseline.set(material as MaterialLike, baseline);
    }
    if (damageFlash) {
      material.color.copy(hdr(MARK_WHITE, 1.9));
      return;
    }
    if (denied) {
      material.color.copy(material.blending === AdditiveBlending ? DENY_RED : DENY_FILL);
      return;
    }
    material.color.copy(baseline);
    if (locked) {
      const isAdditive = material.blending === AdditiveBlending;
      material.color.lerp(hdr(tint!, isAdditive ? 2 : 1.15), isAdditive ? 0.85 : 0.55);
    }
  });
}

function easeOutBack(t: number): number {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2;
}
