import {
  CircleGeometry,
  Color,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  PlaneGeometry,
  RingGeometry,
  Scene,
  TorusGeometry,
} from 'three';
import type { Camera, PerspectiveCamera } from 'three';
import type { CameraFeelRig, CameraFeelShakeOptions } from '../../../engine/camera-feel';
import { colorForLockCount } from '../../../engine/locks';
import {
  createAdditiveBasicMaterial,
  createAdornmentSlot,
  createPendingVisualRecords,
  disposeObject3D,
} from '../../../engine/visual-kit';
import type { EventBus } from '../../../events';
import { skyhookSpeedFactorAt } from '../gameplay';
import {
  createBoltMesh,
  createCarclawMesh,
  createGustMesh,
  createNeedleMesh,
  createSkiffMesh,
  createSkyhookMesh,
  createVoidlingMesh,
  type EnemyTintPart,
} from './enemies';
import { createSkyhookEnvironment, type SkyhookEnvironment } from './environment';
import {
  burstHardware,
  burstSparks,
  createEffects,
  disposeEffects,
  dropTrail,
  resetEffects,
  spawnGlint,
  spawnRing,
  updateEffects,
} from './effects';
import { createLetterMesh, setLetterDenied, setLetterLocked } from './letters';

const AIR_BLUE = new Color(0.42, 0.67, 0.75);
const WHITE_PANEL = new Color(0.82, 0.88, 0.86);
const HAZARD_ORANGE = new Color(1.0, 0.28, 0.045);
const HOT_ORANGE = new Color(1.75, 0.42, 0.055);
const RED_DENY = new Color(1.55, 0.06, 0.025);
const RED_FILL = new Color(0.25, 0.015, 0.01);
const LOCK_GRADIENT = [AIR_BLUE, WHITE_PANEL, HAZARD_ORANGE] as const;

type VisualContext = {
  scene: Scene;
  camera: Camera;
  elapsed: number;
  runTime: number;
  runProgress: number;
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
  decay: 2.8,
  maxTrauma: 1.7,
  pitchDegrees: 0.34,
  yawDegrees: 0.26,
  rollDegrees: 0.62,
  frequency: 8.8,
  smoothing: 21,
};

let environment: SkyhookEnvironment | null = null;
let elapsedNow = 0;
let beatEnergy = 0;

const lockRings = createAdornmentSlot<EnemyRecord, Group>({
  get: (record) => record.lockRing,
  set: (record, ring) => { record.lockRing = ring; },
});

// createEnemyMesh() is called before the runner emits spawn, so a tiny pending
// queue pairs the mesh with the authoritative enemy id without touching the
// shared runner.
const enemyRecords = createPendingVisualRecords<Group, EnemyRecord>({
  createRecord: (mesh) => ({ mesh, bornAt: null, lockRing: null }),
  disposeRecord(record) {
    lockRings.detach(record);
    disposeObject3D(record.mesh);
  },
});
const projectileRecords = createPendingVisualRecords<ProjectileRecord, ProjectileRecord>({
  createRecord: (record) => record,
  disposeRecord(record) { disposeObject3D(record.mesh); },
});

export function createEnvironment(scene: Scene) {
  environment?.dispose();
  disposeEffects();
  environment = createSkyhookEnvironment(scene);
  createEffects(scene);
  return environment.root;
}

export function disposeVisuals() {
  enemyRecords.clear({ dispose: true, pending: true });
  projectileRecords.clear({ dispose: true, pending: true });
  environment?.dispose();
  environment = null;
  disposeEffects();
}

export function setEnvironmentBossDefeated(defeated: boolean) {
  environment?.setBossDefeated(defeated);
}

export function createEnemyMesh(kind: string, letter?: string) {
  const mesh = buildEnemyMesh(kind, letter);
  mesh.userData.kind = kind;
  mesh.userData.isHostileShot = kind === 'bolt';
  mesh.scale.setScalar(0.001);
  enemyRecords.enqueue(mesh);
  return mesh;
}

function buildEnemyMesh(kind: string, letter?: string): Group {
  switch (kind) {
    case 'letter': return createLetterMesh(letter ?? 'A');
    case 'gust': return createGustMesh();
    case 'skiff': return createSkiffMesh();
    case 'carclaw': return createCarclawMesh();
    case 'needle': return createNeedleMesh();
    case 'voidling': return createVoidlingMesh();
    case 'bolt': return createBoltMesh();
    case 'skyhook': return createSkyhookMesh();
    default: return createGustMesh();
  }
}

export function setEnemyLocked(mesh: Object3D, locked: boolean, _lockCount?: number) {
  mesh.userData.locked = locked;
  if (mesh.userData.isLetter) setLetterLocked(mesh as Group, locked);
}

export function setEnemyDenied(mesh: Object3D) {
  mesh.userData.deniedUntil = elapsedNow + 0.58;
  if (mesh.userData.isLetter) setLetterDenied(mesh as Group, true);
  spawnRing(mesh.position, RED_DENY, 2.4, 0.3);
}

export function createProjectileMesh() {
  const group = new Group();
  const body = new Mesh(new TorusGeometry(0.18, 0.08, 5, 12), createAdditiveBasicMaterial({ color: HOT_ORANGE }));
  const core = new Mesh(new CircleGeometry(0.12, 8), new MeshBasicMaterial({ color: WHITE_PANEL, side: DoubleSide }));
  group.add(body, core);
  projectileRecords.enqueue({ mesh: group, trailColor: HOT_ORANGE.clone() });
  return group;
}

export function createReticle() {
  const group = new Group();
  const parts: Array<{ material: MeshBasicMaterial; base: Color }> = [];
  const addPart = (mesh: Mesh, color: Color) => {
    const material = mesh.material as MeshBasicMaterial;
    material.color.copy(color);
    parts.push({ material, base: color.clone() });
  };

  const outer = new Mesh(new RingGeometry(0.64, 0.68, 48), createAdditiveBasicMaterial({ color: AIR_BLUE }));
  addPart(outer, AIR_BLUE);
  const spinner = new Group();
  const inner = new Mesh(new RingGeometry(0.4, 0.43, 6), new MeshBasicMaterial({ color: WHITE_PANEL, side: DoubleSide }));
  addPart(inner, WHITE_PANEL);
  spinner.add(inner);
  const brackets = new Group();
  for (let index = 0; index < 4; index += 1) {
    const tick = new Mesh(new PlaneGeometry(0.24, 0.045), createAdditiveBasicMaterial({ color: AIR_BLUE }));
    const angle = index * Math.PI * 0.5;
    tick.position.set(Math.cos(angle) * 0.82, Math.sin(angle) * 0.82, 0);
    tick.rotation.z = angle + Math.PI * 0.5;
    addPart(tick, AIR_BLUE);
    brackets.add(tick);
  }
  const dot = new Mesh(new CircleGeometry(0.05, 16), new MeshBasicMaterial({ color: WHITE_PANEL }));
  addPart(dot, WHITE_PANEL);
  group.add(outer, spinner, brackets, dot);
  group.userData.parts = parts;
  group.userData.spinner = spinner;
  group.userData.brackets = brackets;
  group.userData.active = false;
  return group;
}

export function setReticleActive(reticle: Object3D, active: boolean, lockCount: number) {
  reticle.userData.active = active;
  reticle.scale.setScalar(1 + lockCount * 0.075 + (active ? 0.06 : 0));
  const parts = reticle.userData.parts as Array<{ material: MeshBasicMaterial; base: Color }>;
  const charge = lockCount > 0 ? colorForLockCount(lockCount, LOCK_GRADIENT) : null;
  for (const part of parts) part.material.color.copy(charge ?? part.base).multiplyScalar(active ? 1.25 : 1);
}

export function installVisualEventHandlers(bus: EventBus, scene: Scene, cameraFeel?: CameraFeelRig) {
  bus.on('spawn', ({ enemyId, kind, worldPosition }) => {
    const record = enemyRecords.claim(enemyId);
    if (kind === 'skyhook') {
      cameraFeel?.shake(0.95, SKYHOOK_SHAKE);
      spawnRing(worldPosition, HOT_ORANGE, 16, 0.8);
      spawnRing(worldPosition, WHITE_PANEL, 8, 0.55);
    } else if (kind === 'carclaw') {
      spawnRing(worldPosition, HAZARD_ORANGE, 3.2, 0.42);
      spawnGlint(worldPosition, HAZARD_ORANGE, 1.1, 0.18);
    } else if (kind !== 'bolt' && record) {
      spawnRing(worldPosition, AIR_BLUE, 2.0, 0.27);
    }
  });

  bus.on('lock', ({ enemyId, lockCount, worldPosition }) => {
    const color = colorForLockCount(lockCount, LOCK_GRADIENT);
    const record = enemyRecords.get(enemyId);
    if (record && !record.lockRing) lockRings.attach(record, makeLockRing(color), scene);
    spawnRing(worldPosition, color, 2.0 + lockCount * 0.16, 0.24);
  });

  bus.on('unlock', ({ enemyId }) => {
    const record = enemyRecords.get(enemyId);
    if (record) lockRings.detach(record);
  });

  bus.on('fire', ({ projectileId, worldPosition }) => {
    projectileRecords.claim(projectileId);
    spawnGlint(worldPosition, WHITE_PANEL, 0.55, 0.12);
  });

  bus.on('hit', ({ enemyId, projectileId, worldPosition, lethal }) => {
    projectileRecords.delete(projectileId, { dispose: true });
    burstSparks(worldPosition, lethal ? WHITE_PANEL : HAZARD_ORANGE, lethal ? 10 : 6, lethal ? 7.5 : 4.8);
    const record = enemyRecords.get(enemyId);
    if (record && !lethal) {
      record.mesh.userData.damageFlashUntil = elapsedNow + 0.3;
      spawnGlint(worldPosition, WHITE_PANEL, 1.0, 0.15);
    }
  });

  bus.on('stage', ({ enemyId, worldPosition, stageIndex }) => {
    const record = enemyRecords.get(enemyId);
    if (!record) return;
    record.mesh.userData.damageFlashUntil = elapsedNow + 0.48;
    const boss = record.mesh.userData.isBoss === true;
    burstSparks(worldPosition, boss ? HOT_ORANGE : WHITE_PANEL, boss ? 30 : 12, boss ? 8.5 : 5.5);
    spawnRing(worldPosition, boss ? HOT_ORANGE : HAZARD_ORANGE, boss ? 12 + stageIndex * 3 : 5.5, boss ? 0.72 : 0.38);
    cameraFeel?.shake(boss ? 0.58 : 0.18, SKYHOOK_SHAKE);
  });

  bus.on('kill', ({ enemyId, worldPosition }) => {
    const record = enemyRecords.get(enemyId);
    const boss = record?.mesh.userData.isBoss === true;
    const accent = (record?.mesh.userData.accent as Color | undefined) ?? HAZARD_ORANGE;
    burstHardware(worldPosition, boss ? WHITE_PANEL : accent, boss ? 4.5 : 1.0);
    if (boss) {
      spawnRing(worldPosition, HOT_ORANGE, 36, 1.1);
      spawnRing(worldPosition, WHITE_PANEL, 20, 0.82);
      burstSparks(worldPosition, HOT_ORANGE, 72, 16);
      cameraFeel?.shake(1.55, SKYHOOK_SHAKE);
    } else {
      spawnGlint(worldPosition, WHITE_PANEL, 1.25, 0.2);
      cameraFeel?.shake(0.16, SKYHOOK_SHAKE);
    }
    if (record) enemyRecords.delete(enemyId, { dispose: true });
  });

  bus.on('miss', ({ enemyId, worldPosition }) => {
    const record = enemyRecords.get(enemyId);
    if (record) enemyRecords.delete(enemyId, { dispose: true });
    spawnRing(worldPosition, RED_DENY, 2.1, 0.26);
  });

  bus.on('reject', ({ enemyIds, missingEnemyIds }) => {
    const ids = [...new Set([...enemyIds, ...(missingEnemyIds ?? [])])];
    for (const enemyId of ids) {
      const record = enemyRecords.get(enemyId);
      if (!record) continue;
      setEnemyDenied(record.mesh);
      spawnRing(record.mesh.position, RED_DENY, 2.8, 0.42);
    }
  });

  bus.on('volley', ({ size, kills }) => {
    if (size >= 5 && kills === size) {
      beatEnergy = Math.max(beatEnergy, 1.45);
    }
  });

  bus.on('beat', ({ isDownbeat }) => {
    beatEnergy = Math.max(beatEnergy, isDownbeat ? 1 : 0.42);
  });

  bus.on('playerhit', () => {
    beatEnergy = 1.45;
    cameraFeel?.shake(1.1, SKYHOOK_SHAKE);
  });

  bus.on('bossphase', ({ phase }) => {
    if (phase === 'destroyed') setEnvironmentBossDefeated(true);
  });

  bus.on('runstart', () => {
    setEnvironmentBossDefeated(false);
    resetEffects();
    enemyRecords.clear({ dispose: true, pending: true });
    projectileRecords.clear({ dispose: true, pending: true });
    beatEnergy = 0;
    cameraFeel?.restore();
  });

  bus.on('runend', () => {
    cameraFeel?.restore();
  });
}

export function updateVisuals(dt: number, context: VisualContext) {
  elapsedNow = context.elapsed;
  beatEnergy = Math.max(0, beatEnergy - dt * 4.1);
  const progress = context.running ? context.runProgress : 0;
  environment?.update(progress, context.runTime, context.elapsed, context.camera, context.running, dt);

  for (const [enemyId, record] of enemyRecords.entries()) {
    if (!record.mesh.parent) {
      enemyRecords.delete(enemyId, { dispose: true });
      continue;
    }
    if (record.bornAt === null) record.bornAt = elapsedNow;
    const age = elapsedNow - record.bornAt;
    const spawnScale = easeOutBack(Math.min(1, age / 0.32));
    const distance = record.mesh.position.distanceTo((context.camera as PerspectiveCamera).position);
    const bossGrowth = record.mesh.userData.isBoss === true
      ? 1.03 + smootherstep(clamp01(1 - distance / 210)) * 0.5
      : 1;
    record.mesh.scale.setScalar(spawnScale * bossGrowth * ((record.mesh.userData.baseScale as number | undefined) ?? 1));
    updateEnemyTint(record, context.camera as PerspectiveCamera, elapsedNow);

    const spinParts = record.mesh.userData.spinParts as Array<{ rotation: { z: number }; userData: { spinSpeed?: number } }> | undefined;
    if (spinParts) for (const part of spinParts) part.rotation.z += dt * (part.userData.spinSpeed ?? 1);

    if (record.mesh.userData.isHostileShot === true) dropTrail(record.mesh.position, (record.mesh.userData.accent as Color | undefined) ?? HOT_ORANGE);
    if (record.lockRing) {
      record.mesh.getWorldPosition(record.lockRing.position);
      record.lockRing.quaternion.copy(context.camera.quaternion);
      record.lockRing.rotation.z += dt * 2.7;
      record.lockRing.scale.setScalar((1 + Math.sin(elapsedNow * 9) * 0.06) * 1.85);
    }
  }

  for (const [projectileId, record] of projectileRecords.entries()) {
    if (!record.mesh.parent) {
      projectileRecords.delete(projectileId, { dispose: true });
      continue;
    }
    dropTrail(record.mesh.position, record.trailColor);
  }

  const reticle = context.scene.children.find((child) => child.userData.raildRole === 'reticle');
  const spinner = reticle?.userData.spinner as Group | undefined;
  const brackets = reticle?.userData.brackets as Group | undefined;
  if (spinner) spinner.rotation.z += dt * (reticle?.userData.active ? 4.4 : 1.1);
  if (brackets) brackets.rotation.z -= dt * (reticle?.userData.active ? 3.1 : 0.7);

  updateEffects(dt, context.camera);

  const speed = context.running ? skyhookSpeedFactorAt(context.runTime) : 0.25;
  const fovOffset = (speed - 0.7) * 4.1 + beatEnergy * 0.85;
  context.feel.setFovOffset(fovOffset, { response: 10 });
  context.feel.update(dt, { shake: SKYHOOK_SHAKE });
}

function updateEnemyTint(record: EnemyRecord, camera: PerspectiveCamera, elapsed: number) {
  const userData = record.mesh.userData;
  const denied = (userData.deniedUntil as number | undefined ?? -Infinity) > elapsed;
  if (userData.isLetter) {
    if (denied) setLetterDenied(record.mesh, true);
    else if (userData.locked !== true) setLetterDenied(record.mesh, false);
    return;
  }

  const parts = userData.parts as EnemyTintPart[] | undefined;
  if (!parts) return;
  const distance = record.mesh.position.distanceTo(camera.position);
  const closeness = smootherstep(clamp01(1 - (distance - 14) / 82));
  const locked = userData.locked === true;
  const flashing = (userData.damageFlashUntil as number | undefined ?? -Infinity) > elapsed;
  for (const part of parts) {
    if (denied) {
      part.material.color.copy(part.kind === 'fill' ? RED_FILL : RED_DENY);
    } else if (locked) {
      part.material.color.copy(part.kind === 'fill' ? AIR_BLUE.clone().multiplyScalar(0.45) : WHITE_PANEL.clone().multiplyScalar(1.25));
    } else if (flashing) {
      part.material.color.copy(part.kind === 'fill' ? WHITE_PANEL : HOT_ORANGE.clone().multiplyScalar(1.2));
    } else {
      const dim = part.kind === 'edge' ? 0.55 + closeness * 0.55 : part.kind === 'core' ? 0.72 + closeness * 0.8 : 0.32 + closeness * 0.68;
      part.material.color.copy(part.base).multiplyScalar(dim);
    }
  }
}

function makeLockRing(color: Color) {
  const group = new Group();
  const outer = new Mesh(new RingGeometry(0.86, 0.91, 6), createAdditiveBasicMaterial({ color: color.clone().multiplyScalar(1.45), side: DoubleSide }));
  const inner = new Mesh(new RingGeometry(0.66, 0.69, 32), createAdditiveBasicMaterial({ color: color.clone().lerp(WHITE_PANEL, 0.52), side: DoubleSide }));
  group.add(outer, inner);
  group.userData.raildRole = 'effect';
  return group;
}

function easeOutBack(t: number) {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2;
}

function smootherstep(t: number) {
  return t * t * (3 - 2 * t);
}

function clamp01(value: number) {
  return Math.min(1, Math.max(0, value));
}
