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
  PerspectiveCamera,
  PlaneGeometry,
  RingGeometry,
  Scene,
  Vector3,
} from 'three';
import type { CameraFeelRig, CameraFeelShakeOptions } from '../../../engine/camera-feel';
import type { EventBus } from '../../../events';
import {
  SKYHOOK_7631_BOSS_TIME,
  SKYHOOK_7631_CLOUDBREAK_TIME,
  SKYHOOK_7631_DOCKING_TIME,
} from '../timing';
import { skyhook7631SpeedFactorAt } from '../gameplay';
import { createEffects, resetEffects, spawnBurst, spawnRing, updateEffects } from './effects';
import {
  createEnvironmentInternal,
  damageClimber,
  markBossDestroyed,
  pulseEnvironment,
  resetEnvironment,
  updateEnvironment,
  type SkyhookEnvironment,
} from './environment';
import {
  createBoarderMesh,
  createBoltMesh,
  createClampMesh,
  createCrawlerMesh,
  createGustwingMesh,
  createLetterMesh,
  createLockMarker,
  createPlayerProjectileMesh,
  createReaverMesh,
  createSkimmerMesh,
  type SkyhookTintPart,
} from './models';
import {
  CLOUD_WHITE,
  GRAPHITE,
  HAZARD_ORANGE,
  HAZARD_PALE,
  IMPACT_RED,
  PANEL_SHADE,
  PANEL_WHITE,
  WINDOW_BLUE,
  hdr,
} from './palette';

export type SkyhookVisualContext = {
  scene: Scene;
  camera: PerspectiveCamera;
  elapsed: number;
  runTime: number;
  running: boolean;
};

export type SkyhookCameraContext = {
  camera: PerspectiveCamera;
  runTime: number;
  running: boolean;
  feel: CameraFeelRig;
};

type EnemyRecord = {
  mesh: Group;
  kind: string;
  bornAt: number;
  lockMarker: Group | null;
};

type ProjectileRecord = {
  mesh: Group;
  trailClock: number;
};

let environment: SkyhookEnvironment | null = null;
let elapsedNow = 0;
let beatEnergy = 0;
let lastCameraRunTime = -1;
const pendingEnemies: Group[] = [];
const enemyRecords = new Map<number, EnemyRecord>();
const pendingProjectiles: Group[] = [];
const projectileRecords = new Map<number, ProjectileRecord>();

const CAMERA_SHAKE: CameraFeelShakeOptions = {
  decay: 2.5,
  maxTrauma: 1.7,
  pitchDegrees: 0.32,
  yawDegrees: 0.26,
  rollDegrees: 0.65,
  frequency: 8.2,
  smoothing: 20,
};

export function createEnvironment(scene: Scene) {
  environment = createEnvironmentInternal(scene);
  createEffects(scene);
  return environment.root;
}

export function createEnemyMesh(kind: string, letter?: string) {
  const mesh = buildEnemyMesh(kind, letter);
  mesh.scale.setScalar(0.001);
  mesh.userData.locked = false;
  pendingEnemies.push(mesh);
  return mesh;
}

function buildEnemyMesh(kind: string, letter?: string) {
  switch (kind) {
    case 'letter': return createLetterMesh(letter ?? 'A');
    case 'gustwing': return createGustwingMesh();
    case 'skimmer': return createSkimmerMesh();
    case 'boarder': return createBoarderMesh();
    case 'crawler': return createCrawlerMesh();
    case 'bolt': return createBoltMesh();
    case 'reaver': return createReaverMesh();
    case 'clamp': return createClampMesh();
    default: return createSkimmerMesh();
  }
}

export function setEnemyLocked(mesh: Object3D, locked: boolean, lockCount = 0) {
  mesh.userData.locked = locked;
  mesh.userData.lockCount = lockCount;
}

export function setEnemyDenied(mesh: Object3D) {
  mesh.userData.deniedUntil = elapsedNow + 0.48;
  mesh.userData.denyPulse = 1;
  spawnRing(mesh.position, hdr(IMPACT_RED, 1.05), 2.8, 0.34, 0.5);
}

export function createProjectileMesh() {
  const mesh = createPlayerProjectileMesh();
  pendingProjectiles.push(mesh);
  return mesh;
}

export function createReticle() {
  const root = new Group();
  const materials: MeshBasicMaterial[] = [];
  const makeMaterial = (color: Color) => {
    const material = new MeshBasicMaterial({ color: color.clone(), side: DoubleSide, depthWrite: false });
    materials.push(material);
    return material;
  };

  const backing = new Mesh(
    new RingGeometry(0.585, 0.69, 32),
    new MeshBasicMaterial({ color: GRAPHITE, side: DoubleSide, depthWrite: false }),
  );
  backing.position.z = -0.012;
  const outer = new Mesh(new RingGeometry(0.62, 0.655, 32), makeMaterial(PANEL_WHITE));
  const spinner = new Group();
  for (let index = 0; index < 4; index += 1) {
    const bracketBack = new Mesh(
      new PlaneGeometry(0.42, 0.105),
      new MeshBasicMaterial({ color: GRAPHITE, side: DoubleSide, depthWrite: false }),
    );
    const bracket = new Mesh(new PlaneGeometry(0.34, 0.065), makeMaterial(PANEL_WHITE));
    const angle = index * Math.PI / 2;
    bracketBack.position.set(Math.cos(angle) * 0.87, Math.sin(angle) * 0.87, -0.012);
    bracketBack.rotation.z = angle;
    bracket.position.set(Math.cos(angle) * 0.87, Math.sin(angle) * 0.87, 0);
    bracket.rotation.z = angle;
    spinner.add(bracketBack, bracket);
  }
  const inner = new Mesh(new RingGeometry(0.25, 0.285, 8), makeMaterial(HAZARD_ORANGE));
  const dot = new Mesh(new CircleGeometry(0.04, 12), makeMaterial(HAZARD_PALE));
  root.add(backing, outer, spinner, inner, dot);
  root.userData.materials = materials;
  root.userData.spinner = spinner;
  root.userData.active = false;
  return root;
}

export function setReticleActive(reticle: Object3D, active: boolean, lockCount: number) {
  reticle.userData.active = active;
  reticle.userData.lockCount = lockCount;
  reticle.scale.setScalar(1 + lockCount * 0.055 + (active ? 0.055 : 0));
  const materials = reticle.userData.materials as MeshBasicMaterial[];
  const charge = PANEL_WHITE.clone().lerp(HAZARD_ORANGE, MathUtils.clamp(lockCount / 6, 0, 1));
  for (const [index, material] of materials.entries()) {
    material.color.copy(index >= materials.length - 2 ? HAZARD_ORANGE : charge).multiplyScalar(active ? 1.18 : 0.88);
  }
}

export function installVisualEventHandlers(bus: EventBus, scene: Scene, feel: CameraFeelRig) {
  bus.on('spawn', ({ enemyId, kind, worldPosition }) => {
    const mesh = pendingEnemies.shift();
    if (!mesh) return;
    enemyRecords.set(enemyId, { mesh, kind, bornAt: elapsedNow, lockMarker: null });
    if (kind === 'reaver') {
      feel.shake(1.25, CAMERA_SHAKE);
      spawnRing(worldPosition, hdr(HAZARD_ORANGE, 1.15), 18, 0.9, 2);
      spawnRing(worldPosition, hdr(PANEL_WHITE, 0.9), 11, 0.68, 1);
    } else if (kind === 'bolt') {
      spawnRing(worldPosition, hdr(HAZARD_ORANGE, 0.95), 1.7, 0.24, 0.2);
    } else if (kind !== 'letter') {
      spawnRing(worldPosition, PANEL_WHITE.clone().multiplyScalar(0.72), 2.2, 0.32, 0.25);
    }
  });

  bus.on('lock', ({ enemyId, lockCount, worldPosition }) => {
    const record = enemyRecords.get(enemyId);
    if (record && !record.lockMarker) {
      const color = PANEL_WHITE.clone().lerp(HAZARD_ORANGE, lockCount / 6);
      record.lockMarker = createLockMarker(color);
      scene.add(record.lockMarker);
    }
    spawnRing(worldPosition, hdr(HAZARD_ORANGE, 1.05), 2.0 + lockCount * 0.12, 0.26, 0.4);
  });

  bus.on('unlock', ({ enemyId }) => detachLockMarker(enemyRecords.get(enemyId), scene));

  bus.on('fire', ({ projectileId, worldPosition, volleySize }) => {
    const mesh = pendingProjectiles.shift();
    if (mesh) projectileRecords.set(projectileId, { mesh, trailClock: 0 });
    spawnBurst(worldPosition, hdr(PANEL_WHITE, 1.2), 3 + Math.min(4, volleySize), 4.5, 0.28);
  });

  bus.on('hit', ({ enemyId, projectileId, worldPosition, lethal }) => {
    projectileRecords.delete(projectileId);
    const record = enemyRecords.get(enemyId);
    if (record && !lethal) record.mesh.userData.damageFlashUntil = elapsedNow + 0.24;
    spawnBurst(worldPosition, hdr(PANEL_WHITE, 1.1), lethal ? 7 : 4, lethal ? 10 : 6, 0.52);
    spawnRing(worldPosition, hdr(HAZARD_ORANGE, 1.15), lethal ? 3.4 : 2.1, lethal ? 0.38 : 0.22, 0.25);
  });

  bus.on('stage', ({ enemyId, worldPosition, stageIndex }) => {
    const record = enemyRecords.get(enemyId);
    if (record) {
      record.mesh.userData.damageFlashUntil = elapsedNow + 0.55;
      record.mesh.userData.hitStage = stageIndex;
    }
    feel.shake(record?.kind === 'reaver' ? 0.72 : 0.28, CAMERA_SHAKE);
    spawnBurst(worldPosition, hdr(HAZARD_ORANGE, 1.1), record?.kind === 'reaver' ? 28 : 12, 13, 0.9);
    spawnRing(worldPosition, hdr(PANEL_WHITE, 1.1), record?.kind === 'reaver' ? 10 : 4.8, 0.58, 0.6);
  });

  bus.on('kill', ({ enemyId, worldPosition }) => {
    const record = enemyRecords.get(enemyId);
    if (!record) return;
    const bossKill = record.kind === 'reaver';
    spawnBurst(worldPosition, bossKill ? hdr(PANEL_WHITE, 1.3) : hdr(HAZARD_ORANGE, 1.05), bossKill ? 64 : 14, bossKill ? 24 : 11, bossKill ? 1.8 : 0.75);
    spawnRing(worldPosition, hdr(HAZARD_ORANGE, bossKill ? 1.25 : 0.95), bossKill ? 34 : 5.2, bossKill ? 1.35 : 0.45, bossKill ? 3 : 0.4);
    if (bossKill) {
      feel.shake(1.7, CAMERA_SHAKE);
      feel.kickFov(7, { decay: 1.8 });
      if (environment) markBossDestroyed(environment);
    } else if (record.kind === 'clamp') {
      feel.shake(0.36, CAMERA_SHAKE);
    }
    detachLockMarker(record, scene);
    enemyRecords.delete(enemyId);
  });

  bus.on('miss', ({ enemyId, worldPosition }) => {
    const record = enemyRecords.get(enemyId);
    if (record) {
      detachLockMarker(record, scene);
      enemyRecords.delete(enemyId);
    }
    spawnBurst(worldPosition, PANEL_SHADE.clone().multiplyScalar(0.65), 3, 3.5, 0.42, new Vector3(0, -2, 0));
  });

  bus.on('reject', () => {
    beatEnergy = Math.max(beatEnergy, 0.85);
    feel.shake(0.18, CAMERA_SHAKE);
  });

  bus.on('volley', ({ size, kills }) => {
    if (size >= 5 && kills === size) {
      beatEnergy = Math.max(beatEnergy, 1.4);
      feel.kickFov(1.6 + size * 0.18, { decay: 4.5 });
    }
  });

  bus.on('beat', ({ isDownbeat }) => {
    beatEnergy = Math.max(beatEnergy, isDownbeat ? 1 : 0.34);
    if (environment) pulseEnvironment(environment, isDownbeat);
  });

  bus.on('playerhit', ({ healthRemaining }) => {
    feel.shake(1.2, CAMERA_SHAKE);
    if (environment) damageClimber(environment, healthRemaining);
  });

  bus.on('bossphase', ({ phase }) => {
    if (phase === 'summoned') {
      beatEnergy = Math.max(beatEnergy, 1.2);
      feel.shake(0.58, CAMERA_SHAKE);
      return;
    }
    if (phase !== 'exposed') return;
    beatEnergy = Math.max(beatEnergy, 1.5);
    feel.shake(0.72, CAMERA_SHAKE);
    const reaver = [...enemyRecords.values()].find((record) => record.kind === 'reaver');
    if (reaver) {
      spawnRing(reaver.mesh.position, hdr(PANEL_WHITE, 1.35), 13, 0.72, 1.4);
      spawnBurst(reaver.mesh.position, hdr(HAZARD_ORANGE, 1.15), 22, 15, 1.0);
    }
  });

  bus.on('runstart', () => {
    for (const record of enemyRecords.values()) detachLockMarker(record, scene);
    enemyRecords.clear();
    projectileRecords.clear();
    pendingEnemies.length = 0;
    pendingProjectiles.length = 0;
    beatEnergy = 0;
    lastCameraRunTime = -1;
    resetEffects();
    feel.restore();
    if (environment) resetEnvironment(environment);
  });

  bus.on('runend', () => {
    feel.restore();
  });
}

function detachLockMarker(record: EnemyRecord | undefined, scene: Scene) {
  if (!record?.lockMarker) return;
  scene.remove(record.lockMarker);
  record.lockMarker = null;
}

export function updateVisuals(dt: number, context: SkyhookVisualContext) {
  elapsedNow = context.elapsed;
  beatEnergy = Math.max(0, beatEnergy - dt * 3.8);
  if (environment) updateEnvironment(environment, dt, context.camera, context.scene, context.runTime, context.running);

  for (const [enemyId, record] of enemyRecords) {
    if (!record.mesh.parent) {
      detachLockMarker(record, context.scene);
      enemyRecords.delete(enemyId);
      continue;
    }
    const age = Math.max(0, elapsedNow - record.bornAt);
    const baseScale = easeOutBack(Math.min(1, age / (record.kind === 'reaver' ? 0.8 : 0.34)));
    const denyPulse = Math.max(0, (record.mesh.userData.denyPulse as number | undefined) ?? 0);
    if (denyPulse > 0) record.mesh.userData.denyPulse = Math.max(0, denyPulse - dt * 4.4);
    record.mesh.scale.setScalar(baseScale * (1 - denyPulse * 0.12));
    animateEnemy(record, age, dt);
    tintEnemy(record, context.camera);

    if (record.lockMarker) {
      record.mesh.getWorldPosition(record.lockMarker.position);
      record.lockMarker.quaternion.copy(context.camera.quaternion);
      const fit = (record.mesh.userData.lockScale as number | undefined) ?? 1;
      record.lockMarker.scale.setScalar(fit * (1 + Math.sin(elapsedNow * 9) * 0.04));
      const ticks = record.lockMarker.userData.ticks as Group | undefined;
      if (ticks) ticks.rotation.z += dt * 1.8;
    }
  }

  for (const [projectileId, record] of projectileRecords) {
    if (!record.mesh.parent) {
      projectileRecords.delete(projectileId);
      continue;
    }
    record.trailClock -= dt;
    if (record.trailClock <= 0) {
      record.trailClock = 0.04;
      spawnBurst(record.mesh.position, hdr(PANEL_WHITE, 0.85), 1, 0.45, 0.22);
    }
  }

  const reticle = findReticle(context.scene);
  if (reticle) {
    const spinner = reticle.userData.spinner as Group;
    spinner.rotation.z += dt * (reticle.userData.active ? 3.2 : 0.65);
  }
  updateEffects(dt, context.camera);
}

function animateEnemy(record: EnemyRecord, age: number, dt: number) {
  const rotors = record.mesh.userData.rotors as Group[] | undefined;
  if (rotors) for (const rotor of rotors) rotor.rotation.z += dt * 11;
  const flexParts = record.mesh.userData.flexParts as Mesh[] | undefined;
  if (flexParts) for (const [index, wing] of flexParts.entries()) wing.scale.y = 0.92 + Math.sin(age * 5.5 + index * Math.PI) * 0.12;
  const claws = record.mesh.userData.claws as Group[] | undefined;
  if (claws) for (const [index, claw] of claws.entries()) claw.rotation.x = Math.sin(age * 4 + index) * 0.16;
  const legs = record.mesh.userData.legs as Group[] | undefined;
  if (legs) for (const [index, leg] of legs.entries()) leg.rotation.x = Math.sin(age * 5.2 + index * 1.7) * 0.22;
  const cage = record.mesh.userData.crawlerCage as Mesh | undefined;
  if (cage) cage.rotation.z += dt * 2.8;
  const gears = record.mesh.userData.gears as Mesh[] | undefined;
  if (gears) {
    gears[0].rotation.z += dt * (0.8 + (record.mesh.userData.approach as number | undefined ?? 0) * 2.5);
    gears[1].rotation.z -= dt * 1.4;
  }
  const jaws = record.mesh.userData.jaws as Group[] | undefined;
  if (jaws) {
    const approach = (record.mesh.userData.approach as number | undefined) ?? 0;
    for (const [index, jaw] of jaws.entries()) jaw.rotation.z = (index === 0 ? 1 : -1) * (0.06 + Math.sin(age * (2 + approach * 4)) * (0.05 + approach * 0.12));
  }
}

function tintEnemy(record: EnemyRecord, camera: PerspectiveCamera) {
  const parts = record.mesh.userData.tintParts as SkyhookTintPart[] | undefined;
  if (!parts) return;
  const denied = ((record.mesh.userData.deniedUntil as number | undefined) ?? -Infinity) > elapsedNow;
  const locked = record.mesh.userData.locked === true;
  const damage = ((record.mesh.userData.damageFlashUntil as number | undefined) ?? -Infinity) > elapsedNow;
  const distance = record.mesh.position.distanceTo(camera.position);
  const close = smoother(1 - MathUtils.clamp((distance - 14) / 50, 0, 1));
  const shielded = record.mesh.userData.shielded === true;
  for (const part of parts) {
    if (denied) {
      part.material.color.copy(part.role === 'dark' ? GRAPHITE : IMPACT_RED).multiplyScalar(part.role === 'hot' ? 1.2 : 0.75);
    } else if (damage) {
      part.material.color.copy(hdr(CLOUD_WHITE, part.role === 'dark' ? 0.75 : 1.35));
    } else if (locked) {
      part.material.color.copy(part.role === 'dark' ? GRAPHITE : part.role === 'hot' ? HAZARD_PALE : PANEL_WHITE)
        .multiplyScalar(part.role === 'edge' ? 1.18 : 1);
    } else if (record.kind === 'reaver' && shielded && part.role === 'hot') {
      part.material.color.copy(HAZARD_ORANGE).multiplyScalar(0.72 + beatEnergy * 0.18);
    } else {
      const distanceDim = part.role === 'hot' ? 0.72 + close * 0.42 : part.role === 'dark' ? 0.8 : 0.58 + close * 0.42;
      part.material.color.copy(part.base).multiplyScalar(distanceDim);
    }
  }
}

export function updateCameraEffects(dt: number, context: SkyhookCameraContext) {
  const time = context.running ? context.runTime : 0;
  const speed = context.running ? skyhook7631SpeedFactorAt(time) : 0.58;
  let offset = (speed - 0.7) * 5.5 + beatEnergy * 0.35;
  if (time >= SKYHOOK_7631_BOSS_TIME) offset -= MathUtils.clamp((time - SKYHOOK_7631_BOSS_TIME) / 8, 0, 1) * 2.4;
  if (time >= SKYHOOK_7631_DOCKING_TIME) offset -= MathUtils.clamp((time - SKYHOOK_7631_DOCKING_TIME) / 4, 0, 1) * 4.5;
  context.feel.setFovOffset(offset, { response: 5.2 });

  if (context.running && lastCameraRunTime >= 0) {
    if (lastCameraRunTime < SKYHOOK_7631_CLOUDBREAK_TIME && time >= SKYHOOK_7631_CLOUDBREAK_TIME) {
      context.feel.kickFov(7.5, { decay: 2.2 });
      context.feel.shake(0.65, CAMERA_SHAKE);
    }
    if (lastCameraRunTime < SKYHOOK_7631_DOCKING_TIME && time >= SKYHOOK_7631_DOCKING_TIME) {
      context.feel.shake(0.28, CAMERA_SHAKE);
    }
  }
  lastCameraRunTime = context.running ? time : -1;
  context.feel.update(dt, { shake: CAMERA_SHAKE });
}

function findReticle(scene: Scene) {
  for (const child of scene.children) if (child.userData.spinner) return child;
  return null;
}

function easeOutBack(value: number) {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * (value - 1) ** 3 + c1 * (value - 1) ** 2;
}

function smoother(value: number) {
  return value * value * (3 - 2 * value);
}
