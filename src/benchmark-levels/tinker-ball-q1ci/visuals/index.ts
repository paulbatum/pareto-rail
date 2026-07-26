import {
  BoxGeometry,
  Color,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  RingGeometry,
  Scene,
  TorusGeometry,
} from 'three';
import type { Camera } from 'three';
import type { CameraFeelRig } from '../../../engine/camera-feel';
import type { EventBus } from '../../../events';
import {
  createPendingVisualRecords,
} from '../../../engine/visual-kit';
import { createTinkerBallQ1ciRail } from '../gameplay';
import { createWorkshopEffects, type WorkshopEffects } from './effects';
import { createWorkshopEnvironment, type WorkshopEnvironment } from './environment';
import {
  animateTinkerEnemyModel,
  collectModelMaterials,
  createTinkerEnemyModel,
  createTinkerProjectileModel,
  restoreModelMaterials,
  setTinkerModelLocked,
  tintModelForDamage,
} from './models';
import {
  CORAL,
  CREAM,
  CYAN,
  GLUE_BLACK,
  MINT,
  ORANGE,
  SUPPLY_COLORS,
  VIOLET,
  YELLOW,
  hdr,
} from './palette';

export type TinkerVisualContext = {
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
  lockRing: Group | null;
};

type ProjectileRecord = {
  mesh: Group;
  lastTrailAt: number;
};

let environment: WorkshopEnvironment | null = null;
let effects: WorkshopEffects | null = null;
let elapsedNow = 0;
let beatEnergy = 0;
let pendingFovKick = 0;
let pendingTrauma = 0;

const reticles = new Set<Group>();
const enemyRecords = createPendingVisualRecords<Group, EnemyRecord, [string]>({
  createRecord: (mesh, kind) => ({ mesh, kind, bornAt: null, lockRing: null }),
  disposeRecord(record) {
    if (record.lockRing) {
      record.lockRing.removeFromParent();
      disposeMaterials(record.lockRing);
      record.lockRing = null;
    }
    disposeMaterials(record.mesh);
  },
});
const projectileRecords = createPendingVisualRecords<Group, ProjectileRecord>({
  createRecord: (mesh) => ({ mesh, lastTrailAt: -Infinity }),
  disposeRecord(record) {
    disposeMaterials(record.mesh);
  },
});

function disposeMaterials(root: Object3D) {
  for (const material of collectModelMaterials(root)) material.dispose();
  const geometries = new Set<import('three').BufferGeometry>();
  root.traverse((object) => {
    if (object instanceof Mesh) geometries.add(object.geometry);
  });
  for (const geometry of geometries) geometry.dispose();
}

export function createEnvironment(scene: Scene) {
  environment?.dispose();
  environment = createWorkshopEnvironment(scene, createTinkerBallQ1ciRail());
  effects = createWorkshopEffects(scene, environment.ball);
  return environment.root;
}

export function disposeVisuals() {
  enemyRecords.clear({ dispose: true, pending: true });
  projectileRecords.clear({ dispose: true, pending: true });
  for (const reticle of reticles) disposeMaterials(reticle);
  reticles.clear();
  effects?.dispose();
  effects = null;
  environment?.dispose();
  environment = null;
}

export function createEnemyMesh(kind: string, letter?: string) {
  const mesh = createTinkerEnemyModel(kind, letter);
  mesh.scale.setScalar(0.001);
  enemyRecords.enqueue(mesh);
  return mesh;
}

export function setEnemyLocked(mesh: Object3D, locked: boolean, lockCount = 0) {
  setTinkerModelLocked(mesh, locked, lockCount);
}

export function setEnemyDenied(mesh: Object3D) {
  mesh.userData.deniedUntil = elapsedNow + 0.48;
  tintModelForDamage(mesh, 0.95);
  effects?.ring(mesh.position, ORANGE, 0.75, 3.5, 0.38);
  effects?.sparks(mesh.position, ORANGE, 5, 2.4);
  pendingFovKick -= 0.8;
  pendingTrauma += 0.08;
}

export function createProjectileMesh() {
  const mesh = createTinkerProjectileModel();
  projectileRecords.enqueue(mesh);
  return mesh;
}

export function createReticle() {
  const root = new Group();
  const parts: Array<{
    material: MeshBasicMaterial;
    idle: Color;
    active: Color;
  }> = [];

  const addPart = (mesh: Mesh, idle: Color, active: Color) => {
    const material = mesh.material as MeshBasicMaterial;
    material.color.copy(idle);
    material.transparent = true;
    material.opacity = 0.92;
    material.depthWrite = false;
    material.side = DoubleSide;
    parts.push({ material, idle, active });
  };

  const darkOutline = new Mesh(
    new RingGeometry(1.12, 1.22, 48),
    new MeshBasicMaterial({ color: GLUE_BLACK, transparent: true, opacity: 0.72, side: DoubleSide }),
  );
  const paperclip = new Mesh(
    new TorusGeometry(1.03, 0.055, 7, 48),
    new MeshBasicMaterial(),
  );
  paperclip.scale.set(1, 0.78, 1);
  addPart(paperclip, CYAN, YELLOW);

  const spinner = new Group();
  for (let index = 0; index < 4; index += 1) {
    const tick = new Mesh(new BoxGeometry(0.42, 0.065, 0.025), new MeshBasicMaterial());
    const angle = index / 4 * Math.PI * 2;
    tick.position.set(Math.cos(angle) * 1.34, Math.sin(angle) * 1.34, 0);
    tick.rotation.z = angle;
    addPart(tick, CREAM, CORAL);
    spinner.add(tick);
  }

  const beads = new Group();
  for (let index = 0; index < 6; index += 1) {
    const bead = new Mesh(new RingGeometry(0.095, 0.15, 12), new MeshBasicMaterial());
    const angle = index / 6 * Math.PI * 2;
    bead.position.set(Math.cos(angle) * 0.74, Math.sin(angle) * 0.58, 0);
    addPart(bead, SUPPLY_COLORS[index], CREAM);
    beads.add(bead);
  }

  const center = new Mesh(new RingGeometry(0.055, 0.1, 12), new MeshBasicMaterial());
  addPart(center, CREAM, CREAM);

  root.add(darkOutline, paperclip, spinner, beads, center);
  root.userData.parts = parts;
  root.userData.spinner = spinner;
  root.userData.beads = beads;
  root.userData.active = false;
  root.userData.raildIgnoreOcclusion = true;
  reticles.add(root);
  return root;
}

export function setReticleActive(reticle: Object3D, active: boolean, lockCount: number) {
  reticle.visible = true;
  reticle.userData.active = active;
  reticle.userData.lockCount = lockCount;
  reticle.scale.setScalar(1 + lockCount * 0.035 + (active ? 0.035 : 0));
  const parts = reticle.userData.parts as Array<{
    material: MeshBasicMaterial;
    idle: Color;
    active: Color;
  }>;
  for (const part of parts) part.material.color.copy(active ? part.active : part.idle);
}

function createLockRing(lockCount: number) {
  const root = new Group();
  const color = SUPPLY_COLORS[Math.max(0, lockCount - 1) % SUPPLY_COLORS.length];
  const outer = new Mesh(
    new RingGeometry(1.05, 1.12, 28),
    new MeshBasicMaterial({
      color: hdr(color, 1.15),
      transparent: true,
      opacity: 0.88,
      side: DoubleSide,
      depthWrite: false,
    }),
  );
  const thread = new Mesh(
    new TorusGeometry(0.86, 0.045, 6, 32),
    new MeshBasicMaterial({
      color: CREAM,
      transparent: true,
      opacity: 0.78,
      depthWrite: false,
    }),
  );
  thread.scale.set(1, 0.8, 1);
  root.add(outer, thread);
  root.userData.raildIgnoreOcclusion = true;
  return root;
}

export function installVisualEventHandlers(bus: EventBus, scene: Scene) {
  const off = [
    bus.on('spawn', ({ enemyId, kind, worldPosition }) => {
      const record = enemyRecords.claim(enemyId, kind);
      if (!record) return;
      if (kind === 'spill-controller') return;
      const boss = kind.startsWith('spill-');
      effects?.ring(worldPosition, boss ? CORAL : CYAN, boss ? 1.2 : 0.45, boss ? 6.5 : 2.7, boss ? 0.72 : 0.4);
      effects?.sparks(worldPosition, boss ? ORANGE : CREAM, boss ? 12 : 4, boss ? 3.6 : 2.1);
    }),
    bus.on('lock', ({ enemyId, worldPosition, lockCount }) => {
      const record = enemyRecords.get(enemyId);
      if (record && !record.lockRing) {
        record.lockRing = createLockRing(lockCount);
        scene.add(record.lockRing);
      }
      const color = SUPPLY_COLORS[Math.max(0, lockCount - 1) % SUPPLY_COLORS.length];
      effects?.ring(worldPosition, color, 0.45, 2.3, 0.25);
      effects?.sparks(worldPosition, color, 3, 1.8);
      pendingFovKick += 0.16;
    }),
    bus.on('unlock', ({ enemyId, worldPosition }) => {
      const record = enemyRecords.get(enemyId);
      if (record?.lockRing) {
        record.lockRing.removeFromParent();
        disposeMaterials(record.lockRing);
        record.lockRing = null;
      }
      effects?.ring(worldPosition, VIOLET, 0.6, 1.8, 0.2);
    }),
    bus.on('fire', ({ projectileId, worldPosition, volleySize }) => {
      projectileRecords.claim(projectileId);
      effects?.ring(worldPosition, YELLOW, 0.2, 1.55 + volleySize * 0.08, 0.2);
      pendingFovKick += 0.08 + volleySize * 0.018;
    }),
    bus.on('hit', ({ enemyId, projectileId, worldPosition, lethal, stageCompleted }) => {
      projectileRecords.delete(projectileId, { dispose: true });
      const record = enemyRecords.get(enemyId);
      if (record) {
        record.mesh.userData.damageFlashUntil = elapsedNow + (stageCompleted ? 0.52 : 0.28);
        record.mesh.userData.damageStrength = stageCompleted ? 1 : 0.7;
      }
      effects?.glueSplash(worldPosition, lethal ? 9 : 5);
      effects?.ring(worldPosition, lethal ? CORAL : CREAM, 0.35, lethal ? 4.5 : 2.4, lethal ? 0.38 : 0.22);
      pendingTrauma += lethal ? 0.13 : 0.05;
    }),
    bus.on('stage', ({ enemyId, worldPosition, stageIndex }) => {
      const record = enemyRecords.get(enemyId);
      if (record) record.mesh.userData.crackLevel = stageIndex;
      effects?.rescuedDebris(worldPosition, record?.kind ?? 'spill-heart', 7);
      effects?.ring(worldPosition, YELLOW, 1, 7.5, 0.62);
      effects?.sparks(worldPosition, CREAM, 18, 5.2);
      pendingFovKick += 2.4;
      pendingTrauma += 0.34;
    }),
    bus.on('kill', ({ enemyId, worldPosition }) => {
      const record = enemyRecords.get(enemyId);
      const kind = record?.kind ?? 'button-beetle';
      const letter = kind === 'letter';
      const boss = kind.startsWith('spill-');
      if (!letter) {
        effects?.rescuedDebris(worldPosition, kind, boss ? 13 : 5);
        effects?.sparks(worldPosition, boss ? YELLOW : SUPPLY_COLORS[enemyId % SUPPLY_COLORS.length], boss ? 24 : 11, boss ? 6.4 : 4.2);
        effects?.ring(worldPosition, boss ? CREAM : MINT, boss ? 1.2 : 0.7, boss ? 9 : 4.8, boss ? 0.8 : 0.5);
      } else {
        effects?.sparks(worldPosition, SUPPLY_COLORS[enemyId % SUPPLY_COLORS.length], 8, 3.4);
      }
      enemyRecords.delete(enemyId, { dispose: true });
      pendingFovKick += boss ? 3.1 : 0.72;
      pendingTrauma += boss ? 0.4 : 0.14;
    }),
    bus.on('miss', ({ enemyId, worldPosition }) => {
      const record = enemyRecords.get(enemyId);
      const kind = record?.kind ?? '';
      if (kind !== 'letter' && kind !== 'spill-controller') {
        effects?.glueSplash(worldPosition, 4);
        effects?.ring(worldPosition, GLUE_BLACK, 0.4, 2, 0.34);
      }
      enemyRecords.delete(enemyId, { dispose: true });
    }),
    bus.on('reject', () => {
      pendingFovKick -= 1.1;
      pendingTrauma += 0.12;
      if (environment) {
        effects?.ring(environment.ball.position, ORANGE, 0.5, 2.6, 0.32);
        effects?.sparks(environment.ball.position, ORANGE, 7, 2.6);
      }
    }),
    bus.on('volley', ({ size, kills }) => {
      if (!environment || size < 6 || kills < 5) return;
      effects?.ring(environment.ball.position, CYAN, 0.7, 5.8, 0.55);
      effects?.ring(environment.ball.position, CORAL, 1.1, 7.2, 0.68);
      effects?.sparks(environment.ball.position, YELLOW, 18, 5);
      pendingFovKick += 2.2;
      pendingTrauma += 0.28;
    }),
    bus.on('beat', ({ isDownbeat }) => {
      beatEnergy = isDownbeat ? 1 : 0.38;
    }),
    bus.on('bossphase', ({ phase }) => {
      if (phase === 'destroyed') {
        environment?.defeatSpill();
        if (environment) {
          effects?.ring(environment.ball.position, CREAM, 1, 12, 1.2);
          effects?.sparks(environment.ball.position, YELLOW, 32, 7);
        }
        pendingFovKick += 5.2;
        pendingTrauma += 0.62;
      } else if (phase === 'exposed') {
        pendingFovKick += 2.8;
        pendingTrauma += 0.34;
      } else {
        pendingFovKick += 3.5;
        pendingTrauma += 0.42;
      }
    }),
    bus.on('runstart', () => {
      enemyRecords.clear({ dispose: true, pending: true });
      projectileRecords.clear({ dispose: true, pending: true });
      effects?.reset();
      environment?.reset();
      beatEnergy = 0;
      pendingFovKick = 0;
      pendingTrauma = 0;
    }),
  ];

  return () => {
    for (const unsubscribe of off) unsubscribe();
  };
}

export function updateVisuals(dt: number, context: TinkerVisualContext) {
  elapsedNow = context.elapsed;
  beatEnergy = Math.max(0, beatEnergy - dt * 4.1);
  if (pendingFovKick !== 0) {
    context.feel.kickFov(pendingFovKick, { decay: 5.4 });
    pendingFovKick = 0;
  }
  if (pendingTrauma > 0) {
    context.feel.shake(pendingTrauma, {
      decay: 2.8,
      maxTrauma: 1.2,
      pitchDegrees: 0.45,
      yawDegrees: 0.38,
      rollDegrees: 1.15,
      frequency: 11,
    });
    pendingTrauma = 0;
  }
  context.feel.setFovOffset(beatEnergy * 0.42);

  environment?.update(dt, context.elapsed, context.camera as import('three').PerspectiveCamera, context.runProgress, beatEnergy);

  for (const [enemyId, record] of enemyRecords.entries()) {
    if (!record.mesh.parent) {
      enemyRecords.delete(enemyId, { dispose: true });
      continue;
    }
    if (record.bornAt === null) record.bornAt = elapsedNow;
    const age = elapsedNow - record.bornAt;
    const targetScale = Number(record.mesh.userData.targetScale ?? 1);
    record.mesh.scale.setScalar(easeOutBack(Math.min(1, age / 0.38)) * targetScale);
    animateTinkerEnemyModel(record.mesh, elapsedNow, dt);

    restoreModelMaterials(record.mesh);
    const activeCore = record.mesh.userData.activeCore as boolean | undefined;
    if (activeCore === false && record.mesh.userData.locked !== true) {
      const materials = record.mesh.userData.coreMaterials as MeshStandardMaterial[] | undefined;
      for (const material of materials ?? []) {
        material.color.copy(GLUE_BLACK);
        material.emissive.copy(GLUE_BLACK);
        material.emissiveIntensity = 0.02;
      }
    }

    const damageFlashUntil = Number(record.mesh.userData.damageFlashUntil ?? -Infinity);
    const deniedUntil = Number(record.mesh.userData.deniedUntil ?? -Infinity);
    if (damageFlashUntil > elapsedNow) {
      const strength = Number(record.mesh.userData.damageStrength ?? 0.7);
      const flash = Math.min(1, (damageFlashUntil - elapsedNow) / 0.28) * strength;
      tintModelForDamage(record.mesh, flash);
    } else if (deniedUntil > elapsedNow) {
      const materials = record.mesh.userData.coreMaterials as MeshStandardMaterial[] | undefined;
      for (const material of materials ?? []) {
        material.color.copy(ORANGE);
        material.emissive.copy(CORAL);
        material.emissiveIntensity = 0.8;
      }
    }

    const crackLevel = Number(record.mesh.userData.crackLevel ?? 0);
    const shell = record.mesh.userData.shellParts as Group | undefined;
    if (shell && crackLevel > 0) {
      const wobble = 1 + Math.sin(elapsedNow * 8) * 0.04;
      shell.scale.setScalar((1 + crackLevel * 0.16) * wobble);
    }

    if (record.lockRing) {
      record.mesh.getWorldPosition(record.lockRing.position);
      record.lockRing.quaternion.copy(context.camera.quaternion);
      record.lockRing.rotation.z += dt * 2.9;
      record.lockRing.scale.setScalar(targetScale * (1.12 + Math.sin(elapsedNow * 10) * 0.055));
    }
  }

  for (const [projectileId, record] of projectileRecords.entries()) {
    if (!record.mesh.parent) {
      projectileRecords.delete(projectileId, { dispose: true });
      continue;
    }
    record.mesh.rotation.z += dt * 8.5;
    if (elapsedNow - record.lastTrailAt >= 0.035) {
      record.lastTrailAt = elapsedNow;
      effects?.trail(record.mesh.position, CYAN);
    }
  }

  for (const reticle of reticles) {
    const spinner = reticle.userData.spinner as Group;
    const beads = reticle.userData.beads as Group;
    const active = reticle.userData.active === true;
    const lockCount = Number(reticle.userData.lockCount ?? 0);
    spinner.rotation.z += dt * (active ? 2.8 + lockCount * 0.4 : 0.55);
    beads.rotation.z -= dt * (active ? 1.7 : 0.3);
  }

  effects?.update(dt, elapsedNow, context.camera);
}

function easeOutBack(t: number) {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2;
}
