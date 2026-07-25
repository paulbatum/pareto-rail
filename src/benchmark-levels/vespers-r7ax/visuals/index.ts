import {
  Color,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  RingGeometry,
  Scene,
} from 'three';
import type { Camera } from 'three';
import type { CameraFeelRig } from '../../../engine/camera-feel';
import { colorForLockCount } from '../../../engine/locks';
import {
  createAdditiveBasicMaterial,
  createPendingVisualRecords,
} from '../../../engine/visual-kit';
import type { EventBus } from '../../../events';
import { createEffects, type VespersEffects } from './effects';
import { createEnvironmentInternal, type VespersEnvironment } from './environment';
import {
  createAngel,
  createCenser,
  createLetterMesh,
  createProjectileVisual,
  createReticleVisual,
  createRoseHeart,
  createRosePetal,
  createShade,
  setTargetDenied,
  setTargetLocked,
  updateTargetModel,
} from './models';
import {
  BLOOD,
  BOTTLE,
  COBALT,
  CORE_WHITE,
  GOLD,
  JEWELS,
  LOCK_GOLD,
  ROSE,
  hdr,
  jewelAt,
} from './palette';

export type VespersVisualContext = {
  scene: Scene;
  camera: Camera;
  feel: CameraFeelRig;
  elapsed: number;
  runProgress: number;
};

type EnemyRecord = {
  mesh: Group;
  kind: string;
  bornAt: number | null;
  windowIndex: number;
  roseSlot: number;
  jewel: Color;
  lockCount: number;
  damageFlashUntil: number;
};

type ProjectileRecord = {
  mesh: Group;
  color: Color;
};

let environment: VespersEnvironment | null = null;
let effects: VespersEffects | null = null;
let elapsedNow = 0;
let beatEnergy = 0;
let enemyOrdinal = 0;
let roseOrdinal = 0;
let illuminationTableau = false;

const enemyRecords = createPendingVisualRecords<Group, EnemyRecord>({
  createRecord: (mesh) => ({
    mesh,
    kind: mesh.userData.kind as string,
    bornAt: null,
    windowIndex: mesh.userData.windowIndex as number,
    roseSlot: mesh.userData.roseSlot as number,
    jewel: (mesh.userData.jewel as Color | undefined)?.clone() ?? CORE_WHITE.clone(),
    lockCount: 0,
    damageFlashUntil: -1,
  }),
});

const projectileRecords = createPendingVisualRecords<Group, ProjectileRecord>({
  createRecord: (mesh) => ({
    mesh,
    color: LOCK_GOLD.clone(),
  }),
});

export function createEnvironment(scene: Scene) {
  environment = createEnvironmentInternal(scene);
  effects = createEffects(scene);
  return environment;
}

export function createEnemyMesh(kind: string, letter?: string) {
  let mesh: Group;
  if (kind === 'letter' || letter) {
    const code = (letter ?? 'A').charCodeAt(0);
    mesh = createLetterMesh(letter ?? 'A', jewelAt(code));
  } else {
    const color = jewelAt(enemyOrdinal);
    switch (kind) {
      case 'shade':
        mesh = createShade(color);
        break;
      case 'censer':
        mesh = createCenser(color);
        break;
      case 'angel':
        mesh = createAngel(color);
        break;
      case 'rose-petal':
        mesh = createRosePetal(color);
        mesh.userData.roseSlot = roseOrdinal;
        roseOrdinal += 1;
        break;
      case 'rose-heart':
        mesh = createRoseHeart(JEWELS);
        mesh.userData.roseSlot = 6;
        break;
      default:
        mesh = createShade(color);
        break;
    }
    mesh.userData.windowIndex = enemyOrdinal;
    enemyOrdinal += 1;
  }

  mesh.userData.kind = kind;
  mesh.scale.setScalar(0.001);
  enemyRecords.enqueue(mesh);
  return mesh;
}

export function setEnemyLocked(mesh: Object3D, locked: boolean, lockCount = 1) {
  setTargetLocked(mesh, locked, lockCount);
  const record = [...enemyRecords.values()].find((candidate) => candidate.mesh === mesh);
  if (record) record.lockCount = locked ? lockCount : 0;
}

export function setEnemyDenied(mesh: Object3D) {
  setTargetDenied(mesh, elapsedNow + 0.5);
  const jewel = (mesh.userData.jewel as Color | undefined) ?? LOCK_GOLD;
  effects?.spawnRing(mesh.position, hdr(LOCK_GOLD, 1.25), 3.2, 0.42);
  effects?.spawnGlint(mesh.position, hdr(jewel, 1.1), 1.5, 0.25);
}

export function createProjectileMesh() {
  const mesh = createProjectileVisual();
  projectileRecords.enqueue(mesh);
  return mesh;
}

export function createReticle() {
  return createReticleVisual();
}

export function setReticleActive(reticle: Object3D, active: boolean, lockCount: number) {
  reticle.userData.active = active;
  reticle.scale.setScalar(1 + lockCount * 0.052 + (active ? 0.035 : 0));
  const colors = [COBALT, BLOOD, BOTTLE, GOLD, ROSE];
  const target = active
    ? colorForLockCount(Math.max(1, lockCount), colors)
    : CORE_WHITE;
  for (const material of (reticle.userData.reticleMaterials as MeshBasicMaterial[] | undefined) ?? []) {
    material.color.copy(hdr(target, active ? 1.15 : 0.72));
  }
}

export function installVisualEventHandlers(
  bus: EventBus,
  scene: Scene,
  feel: CameraFeelRig,
) {
  bus.on('spawn', ({ enemyId, worldPosition, kind }) => {
    const record = enemyRecords.claim(enemyId);
    if (!record) return;
    if (kind === 'shade' || kind === 'censer' || kind === 'angel') {
      environment?.steal(record.windowIndex);
    }
    effects?.spawnRing(worldPosition, hdr(record.jewel, 0.42), kind.startsWith('rose') ? 5 : 2.8, 0.55);
  });

  bus.on('lock', ({ enemyId, worldPosition, lockCount }) => {
    const record = enemyRecords.get(enemyId);
    if (record) record.lockCount = lockCount;
    const color = colorForLockCount(lockCount, [COBALT, BLOOD, BOTTLE, GOLD, ROSE]);
    effects?.spawnRing(worldPosition, hdr(color, 1.15), 2.4 + lockCount * 0.12, 0.3);
    effects?.spawnGlint(worldPosition, hdr(CORE_WHITE, 1.3), 0.65 + lockCount * 0.08, 0.14);
  });

  bus.on('unlock', ({ enemyId, worldPosition, lockCount }) => {
    const record = enemyRecords.get(enemyId);
    if (record) record.lockCount = lockCount;
    effects?.spawnRing(worldPosition, hdr(record?.jewel ?? LOCK_GOLD, 0.45), 1.7, 0.26);
  });

  bus.on('fire', ({ projectileId, worldPosition, volleySize }) => {
    const record = projectileRecords.claim(projectileId);
    if (record) record.color.copy(colorForLockCount(volleySize, [COBALT, BLOOD, BOTTLE, GOLD, ROSE]));
    effects?.spawnGlint(worldPosition, hdr(CORE_WHITE, 1.8), 1.1 + volleySize * 0.08, 0.18);
    feel.kickFov(Math.min(2.2, 0.45 + volleySize * 0.23), { decay: 6.5 });
  });

  bus.on('hit', ({
    enemyId,
    projectileId,
    worldPosition,
    lethal,
    hitStageIndex,
  }) => {
    projectileRecords.delete(projectileId);
    const record = enemyRecords.get(enemyId);
    if (record) record.damageFlashUntil = elapsedNow + (lethal ? 0.12 : 0.3);
    effects?.burstGlass(worldPosition, lethal ? (record?.jewel ?? CORE_WHITE) : CORE_WHITE, lethal ? 9 : 5, lethal ? 5 : 3);
    if (!lethal) {
      effects?.spawnRing(worldPosition, hdr(CORE_WHITE, 1.3), 3.4 + hitStageIndex * 0.7, 0.33);
      feel.shake(0.06, { decay: 4.5, maxTrauma: 0.7 });
    }
  });

  bus.on('stage', ({ worldPosition, stageIndex }) => {
    effects?.spawnRing(worldPosition, hdr(LOCK_GOLD, 1.45), 6.2 + stageIndex, 0.62);
    effects?.spawnGlint(worldPosition, hdr(CORE_WHITE, 1.9), 2.4, 0.32);
    feel.shake(0.18, { decay: 2.4, maxTrauma: 0.9, rollDegrees: 1.1 });
  });

  bus.on('kill', ({ enemyId, worldPosition }) => {
    const record = enemyRecords.get(enemyId);
    if (!record) return;
    if (record.kind === 'rose-petal') {
      environment?.chargeRose(record.roseSlot, record.jewel);
    } else if (record.kind === 'rose-heart') {
      environment?.igniteRose();
    } else {
      environment?.restore(record.windowIndex, record.jewel);
    }
    const isBoss = record.kind.startsWith('rose');
    effects?.burstGlass(worldPosition, record.jewel, isBoss ? 38 : 24, isBoss ? 12 : 8);
    effects?.spawnRing(worldPosition, hdr(record.jewel, 1.25), isBoss ? 9 : 5.3, isBoss ? 0.85 : 0.55);
    effects?.spawnGlint(worldPosition, hdr(CORE_WHITE, 1.7), isBoss ? 3 : 1.35, isBoss ? 0.46 : 0.24);
    enemyRecords.delete(enemyId);
  });

  bus.on('miss', ({ enemyId, worldPosition }) => {
    const record = enemyRecords.get(enemyId);
    effects?.spawnRing(worldPosition, hdr(record?.jewel ?? LOCK_GOLD, 0.22), 2.6, 0.6);
    if (record) enemyRecords.delete(enemyId);
  });

  bus.on('reject', () => {
    beatEnergy = Math.max(beatEnergy, 0.65);
    feel.kickFov(-0.75, { decay: 8 });
  });

  bus.on('beat', ({ isDownbeat }) => {
    beatEnergy = isDownbeat ? 1 : 0.42;
  });

  bus.on('bossphase', ({ phase }) => {
    if (!environment || !effects) return;
    if (phase === 'summoned') {
      effects.spawnRing(environment.rosePosition, hdr(BLOOD, 0.85), 15, 1.4);
      feel.shake(0.35, { decay: 1.4, maxTrauma: 1, rollDegrees: 1.4 });
    } else if (phase === 'exposed') {
      effects.spawnRing(environment.rosePosition, hdr(GOLD, 1.25), 11, 0.8);
      effects.spawnGlint(environment.rosePosition, hdr(CORE_WHITE, 1.7), 5, 0.5);
      feel.kickFov(3.2, { decay: 2.5 });
    } else {
      environment.igniteRose();
      effects.flareRose(environment.rosePosition);
      feel.kickFov(7.5, { decay: 1.25 });
      feel.shake(0.8, {
        decay: 0.72,
        maxTrauma: 1.2,
        pitchDegrees: 0.7,
        yawDegrees: 0.6,
        rollDegrees: 2.2,
      });
    }
  });

  bus.on('runstart', () => {
    enemyOrdinal = 0;
    roseOrdinal = 0;
    beatEnergy = 0;
    illuminationTableau = false;
    enemyRecords.clear({ pending: true });
    projectileRecords.clear({ pending: true });
    environment?.reset();
    effects?.reset();
  });

  // Keep scene in the signature so this installation remains symmetrical
  // with other levels and future attached adornments have an explicit parent.
  void scene;
}

export function forceIlluminationTableau() {
  if (illuminationTableau || !environment || !effects) return;
  illuminationTableau = true;
  environment.igniteRose();
  effects.flareRose(environment.rosePosition);
  for (const record of enemyRecords.values()) {
    if (record.kind.startsWith('rose')) record.mesh.visible = false;
  }
}

export function updateVisuals(dt: number, context: VespersVisualContext) {
  elapsedNow = context.elapsed;
  beatEnergy = Math.max(0, beatEnergy - dt * 3.1);
  environment?.update(dt, context.runProgress, beatEnergy);
  context.feel.setFovOffset(beatEnergy * 0.42, { response: 9 });

  for (const [enemyId, record] of enemyRecords.entries()) {
    if (!record.mesh.parent) {
      enemyRecords.delete(enemyId);
      continue;
    }
    if (record.bornAt === null) record.bornAt = elapsedNow;
    const age = elapsedNow - record.bornAt;
    const spawnT = Math.min(1, age / 0.42);
    const pop = 1 + 1.7 * (spawnT - 1) ** 3 + 0.7 * (spawnT - 1) ** 2;
    const lockedPulse = record.lockCount > 0
      ? 1 + Math.sin(elapsedNow * 9 + enemyId) * 0.035
      : 1;
    record.mesh.scale.setScalar(Math.max(0.001, pop) * lockedPulse);

    updateTargetModel(record.mesh, elapsedNow, age, dt);
    const deniedUntil = record.mesh.userData.deniedUntil as number | undefined;
    if ((deniedUntil ?? -1) <= elapsedNow) {
      setTargetLocked(record.mesh, record.lockCount > 0, record.lockCount);
    }
    if (record.damageFlashUntil > elapsedNow) {
      const flash = (record.damageFlashUntil - elapsedNow) / 0.3;
      for (const material of (record.mesh.userData.chestMaterials as MeshBasicMaterial[] | undefined) ?? []) {
        material.color.copy(hdr(CORE_WHITE, 1.2 + flash * 1.2));
      }
    }
  }

  for (const [projectileId, record] of projectileRecords.entries()) {
    if (!record.mesh.parent) {
      projectileRecords.delete(projectileId);
      continue;
    }
    effects?.dropTrail(record.mesh.position, record.color);
    const halo = record.mesh.userData.projectileHalo as Mesh | undefined;
    if (halo) halo.rotation.z += dt * 8;
  }

  const reticle = findReticle(context.scene);
  if (reticle) {
    const quatrefoil = reticle.userData.quatrefoil as Group | undefined;
    if (quatrefoil) {
      quatrefoil.rotation.z += dt * (reticle.userData.active === true ? 2.4 : 0.55);
    }
  }

  effects?.update(dt, context.camera);
}

export function disposeVisuals() {
  enemyRecords.clear({ pending: true });
  projectileRecords.clear({ pending: true });
  effects?.dispose();
  environment?.dispose();
  effects = null;
  environment = null;
}

function findReticle(scene: Scene) {
  for (const child of scene.children) {
    if (child.userData.reticleMaterials) return child;
  }
  return null;
}

export function createRoseLockHalo(color: Color) {
  const group = new Group();
  const outer = new Mesh(
    new RingGeometry(0.88, 0.94, 12),
    createAdditiveBasicMaterial({ color: hdr(color, 1.15), side: DoubleSide }),
  );
  group.add(outer);
  return group;
}
