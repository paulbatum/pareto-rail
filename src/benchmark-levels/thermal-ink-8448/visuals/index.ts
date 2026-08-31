import {
  CircleGeometry,
  Color,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  OctahedronGeometry,
  PlaneGeometry,
  RingGeometry,
  Scene,
  Vector3,
} from 'three';
import type { Camera } from 'three';
import { colorForLockCount } from '../../../engine/locks';
import {
  createAdditiveBasicMaterial,
  createAdornmentSlot,
  createPendingVisualRecords,
  configureAdditiveMaterial,
} from '../../../engine/visual-kit';
import type { EventBus } from '../../../events';
import type { ThermalInk8448EnemyKind } from '../gameplay';
import { createEffects, type ThermalInkEffects } from './effects';
import { createArmMesh, createBoltMesh, createCableMesh, createCoreMesh, createInkCloudMesh, createScavengerMesh, applyThermalMode } from './enemies';
import { createEnvironment as createHarbourEnvironment, type ThermalInkEnvironment } from './environment';
import { createLetterMesh, setLetterDenied, setLetterLocked } from './letters';
import { CREAM, IR_RED, IR_WHITE_EDGE, IR_WHITE_HOT, LAMP, OCHRE, PLAYER, RUST, SIGNAL, hdr } from './palette';

type EnemyRecord = {
  mesh: Group;
  bornAt: number | null;
  lockRing: Group | null;
};

type ProjectileRecord = { mesh: Object3D };

let environment: ThermalInkEnvironment | null = null;
let effects: ThermalInkEffects | null = null;
let infrared = false;
let elapsedNow = 0;
let beatEnergy = 0;
let coreKilledAt = -1;

const lockRings = createAdornmentSlot<EnemyRecord, Group>({
  get: (record) => record.lockRing,
  set: (record, ring) => { record.lockRing = ring; },
});

// createEnemyMesh() has no id; the runner emits spawn synchronously after the
// factory returns, so the pending queue pairs the mesh with its event id.
const enemyRecords = createPendingVisualRecords<Group, EnemyRecord>({
  createRecord: (mesh) => ({ mesh, bornAt: null, lockRing: null }),
  disposeRecord: (record) => lockRings.detach(record),
});
const projectileRecords = createPendingVisualRecords<ProjectileRecord, ProjectileRecord>({
  createRecord: (record) => record,
});

export function createEnvironment(scene: Scene) {
  environment = createHarbourEnvironment(scene);
  effects = createEffects(scene);
  return environment.root;
}

export function createEnemyMesh(kind: string, letter?: string) {
  const mesh = kind === 'letter' || letter
    ? createLetterMesh(letter ?? 'A')
    : buildEnemyMesh(kind as ThermalInk8448EnemyKind);
  mesh.userData.kind = kind;
  if (kind === 'ink-cloud') mesh.scale.setScalar(1);
  else mesh.scale.setScalar(0.001);
  enemyRecords.enqueue(mesh);
  return mesh;
}

function buildEnemyMesh(kind: ThermalInk8448EnemyKind) {
  switch (kind) {
    case 'arm': return createArmMesh();
    case 'scavenger': return createScavengerMesh();
    case 'cable': return createCableMesh();
    case 'core': return createCoreMesh();
    case 'bolt': return createBoltMesh();
    case 'ink-cloud': return createInkCloudMesh();
  }
}

export function setEnemyLocked(mesh: Object3D, locked: boolean, lockCount = 0) {
  mesh.userData.locked = locked;
  mesh.userData.lockCount = lockCount;
  if (mesh.userData.isLetter) setLetterLocked(mesh as Group, locked);
  const core = mesh.userData.signalCore as Mesh | undefined;
  if (core) core.scale.setScalar(locked ? 1.18 + lockCount * 0.045 : 1);
}

export function setEnemyDenied(mesh: Object3D) {
  mesh.userData.deniedUntil = elapsedNow + 0.55;
  if (mesh.userData.isLetter) setLetterDenied(mesh as Group);
  effects?.ring(mesh.position, hdr(SIGNAL, 1.2), 2.6, 0.34);
}

export function createProjectileMesh() {
  const group = new Group();
  const core = new Mesh(new OctahedronGeometry(0.28, 0), new MeshBasicMaterial({ color: hdr(CREAM, 2.7) }));
  core.scale.set(0.42, 0.42, 2.3);
  const shell = new Mesh(new OctahedronGeometry(0.48, 0), createAdditiveBasicMaterial({ color: hdr(PLAYER, 0.95), opacity: 0.48 }));
  shell.scale.set(0.52, 0.52, 2.0);
  group.add(core, shell);
  projectileRecords.enqueue({ mesh: group });
  return group;
}

export function createReticle() {
  const group = new Group();
  const parts: Array<{ material: MeshBasicMaterial; normal: Color; active: Color }> = [];
  const addPart = (mesh: Mesh, normal: Color, active: Color) => {
    const material = configureAdditiveMaterial(mesh.material as MeshBasicMaterial, { color: normal, side: DoubleSide });
    parts.push({ material, normal, active });
  };

  // Radius 0.8 at the runner's 24m sight depth clears half the acquisition
  // radius, so the drawn ring agrees with what the engine can lock.
  const outer = new Mesh(new RingGeometry(0.76, 0.82, 48), new MeshBasicMaterial());
  addPart(outer, hdr(LAMP, 1.15), hdr(IR_WHITE_EDGE, 1.45));
  const inner = new Mesh(new RingGeometry(0.42, 0.46, 12), new MeshBasicMaterial());
  addPart(inner, hdr(OCHRE, 0.92), hdr(IR_RED, 1.6));
  const brackets = new Group();
  for (let index = 0; index < 4; index += 1) {
    const tick = new Mesh(new PlaneGeometry(0.26, 0.05), new MeshBasicMaterial());
    const angle = index * Math.PI * 0.5;
    tick.position.set(Math.cos(angle) * 0.94, Math.sin(angle) * 0.94, 0);
    tick.rotation.z = angle;
    addPart(tick, hdr(CREAM, 1.2), hdr(IR_WHITE_HOT, 1.6));
    brackets.add(tick);
  }
  const dot = new Mesh(new CircleGeometry(0.055, 20), new MeshBasicMaterial());
  addPart(dot, hdr(CREAM, 1.8), hdr(IR_RED, 2.6));
  group.add(outer, inner, brackets, dot);
  group.userData.parts = parts;
  group.userData.inner = inner;
  return group;
}

export function setReticleActive(reticle: Object3D, active: boolean, lockCount: number) {
  reticle.userData.active = active;
  reticle.scale.setScalar(1 + lockCount * 0.065 + (active ? 0.06 : 0));
  const parts = reticle.userData.parts as Array<{ material: MeshBasicMaterial; normal: Color; active: Color }>;
  for (const part of parts) {
    part.material.color.copy(active ? part.active : part.normal);
    if (infrared && !active) part.material.color.copy(hdr(IR_RED, 1.05));
  }
  const inner = reticle.userData.inner as Mesh | undefined;
  if (inner) inner.rotation.z += 0.035 + lockCount * 0.01;
}

export function setInfraredMode(active: boolean) {
  infrared = active;
  environment?.setMode(active);
  for (const record of enemyRecords.values()) {
    applyThermalMode(record.mesh, active);
    if (record.mesh.userData.isLetter) setLetterLocked(record.mesh, record.mesh.userData.locked === true);
  }
}

export function toggleInfraredMode() {
  setInfraredMode(!infrared);
}

export function isInfraredMode() {
  return infrared;
}

export function installVisualEventHandlers(bus: EventBus, scene: Scene) {
  bus.on('spawn', ({ enemyId, kind, worldPosition }) => {
    const record = enemyRecords.claim(enemyId);
    if (!record) return;
    record.bornAt = null;
    if (kind === 'ink-cloud') {
      setInfraredMode(true);
      effects?.ring(worldPosition, hdr(IR_RED, 1.2), 12, 0.8);
    } else if (kind === 'core') {
      effects?.ring(worldPosition, hdr(SIGNAL, 1.3), 6.5, 0.55);
    } else {
      effects?.ring(worldPosition, hdr(LAMP, 0.75), 2.4, 0.36);
    }
  });

  bus.on('lock', ({ enemyId, worldPosition, lockCount }) => {
    const record = enemyRecords.get(enemyId);
    if (record) {
      if (!record.lockRing) lockRings.attach(record, createLockRing(lockCount), scene);
      else updateLockRing(record.lockRing, lockCount);
    }
    effects?.ring(worldPosition, hdr(lockColor(lockCount), 1.1), 2.0 + lockCount * 0.16, 0.26);
  });

  bus.on('unlock', ({ enemyId }) => {
    const record = enemyRecords.get(enemyId);
    if (record) lockRings.detach(record);
  });

  bus.on('fire', ({ projectileId, worldPosition }) => {
    projectileRecords.claim(projectileId);
    effects?.glint(worldPosition, hdr(CREAM, 1.3), 0.65, 0.12);
  });

  bus.on('hit', ({ enemyId, projectileId, worldPosition, lethal, hitStageIndex }) => {
    projectileRecords.delete(projectileId);
    const record = enemyRecords.get(enemyId);
    effects?.burst(worldPosition, lethal ? hdr(OCHRE, 1.15) : hdr(IR_WHITE_HOT, 1.0), lethal ? 9 : 6, lethal ? 11 : 8);
    effects?.glint(worldPosition, hdr(IR_WHITE_HOT, 1.6), lethal ? 1.2 : 0.85, 0.18);
    if (record) {
      record.mesh.userData.damageFlashUntil = elapsedNow + (lethal ? 0.25 : 0.44);
      record.mesh.userData.damageLevel = hitStageIndex;
    }
  });

  bus.on('stage', ({ enemyId, worldPosition, stageIndex }) => {
    const record = enemyRecords.get(enemyId);
    if (record) record.mesh.userData.damageLevel = Math.max(record.mesh.userData.damageLevel ?? 0, stageIndex);
    effects?.ring(worldPosition, hdr(SIGNAL, 1.65), stageIndex > 0 ? 6.2 : 4.6, 0.52);
    effects?.burst(worldPosition, hdr(IR_RED, 1.4), stageIndex > 0 ? 14 : 9, 15);
  });

  bus.on('kill', ({ enemyId, worldPosition }) => {
    const record = enemyRecords.get(enemyId);
    const kind = record?.mesh.userData.kind as string | undefined;
    if (kind === 'core') {
      coreKilledAt = elapsedNow;
      effects?.ring(worldPosition, hdr(IR_WHITE_HOT, 2.1), 20, 1.25);
      effects?.ring(worldPosition, hdr(IR_RED, 1.7), 12, 0.9);
      effects?.glint(worldPosition, hdr(IR_WHITE_HOT, 3.0), 4.8, 0.6);
      effects?.burst(worldPosition, hdr(IR_WHITE_HOT, 1.7), 34, 26);
    } else {
      effects?.ring(worldPosition, hdr(OCHRE, 1.0), kind === 'arm' ? 6.2 : 3.9, 0.48);
      effects?.burst(worldPosition, hdr(RUST, 1.1), kind === 'arm' ? 16 : 8, kind === 'cable' ? 16 : 10);
      effects?.glint(worldPosition, hdr(CREAM, 1.8), kind === 'arm' ? 1.8 : 0.9, 0.22);
    }
    enemyRecords.delete(enemyId, { dispose: true });
  });

  bus.on('miss', ({ enemyId, worldPosition }) => {
    const record = enemyRecords.get(enemyId);
    const kind = record?.mesh.userData.kind as string | undefined;
    if (kind === 'ink-cloud') {
      setInfraredMode(false);
      effects?.ring(worldPosition, hdr(LAMP, 0.9), 11, 0.7);
    } else {
      effects?.burst(worldPosition, hdr(OCHRE, 0.45), 4, 4);
    }
    enemyRecords.delete(enemyId, { dispose: true });
    projectileRecords.delete(enemyId);
  });

  bus.on('reject', ({ enemyIds }) => {
    for (const enemyId of enemyIds) {
      const record = enemyRecords.get(enemyId);
      if (record) effects?.ring(record.mesh.position, hdr(SIGNAL, 1.1), 2.8, 0.4);
    }
  });

  bus.on('bossphase', ({ phase }) => {
    if (phase === 'summoned') effects?.ring(new Vector3(0, 0, -20), hdr(RUST, 0.8), 9, 0.8);
    if (phase === 'exposed') {
      effects?.ring(new Vector3(0, 0, -20), hdr(IR_RED, 1.7), 9, 0.65);
      beatEnergy = Math.max(beatEnergy, 1.35);
    }
    if (phase === 'destroyed') beatEnergy = 1.8;
  });

  bus.on('beat', ({ isDownbeat }) => {
    beatEnergy = Math.max(beatEnergy, isDownbeat ? 1 : 0.42);
  });

  bus.on('playerhit', () => {
    beatEnergy = 1.55;
    effects?.ring(new Vector3(0, 0, -3), hdr(SIGNAL, 1.1), 4.5, 0.3);
  });

  bus.on('runstart', () => {
    effects?.reset();
    enemyRecords.clear({ dispose: true, pending: true });
    projectileRecords.clear({ pending: true });
    coreKilledAt = -1;
    beatEnergy = 0;
    setInfraredMode(false);
    environment?.reset();
  });

  bus.on('runend', () => {
    if (coreKilledAt < 0) setInfraredMode(false);
  });
}

export function updateVisuals(dt: number, context: { scene: Scene; camera: Camera; elapsed: number; runProgress?: number }) {
  elapsedNow = context.elapsed;
  beatEnergy = Math.max(0, beatEnergy - dt * 3.8);
  environment?.update(context.runProgress ?? 0, context.elapsed, dt, context.camera, infrared);
  effects?.update(dt, context.camera);

  for (const [enemyId, record] of enemyRecords.entries()) {
    if (!record.mesh.parent) {
      enemyRecords.delete(enemyId, { dispose: true });
      continue;
    }
    if (record.bornAt === null) record.bornAt = elapsedNow;
    const age = elapsedNow - record.bornAt;
    if (record.mesh.userData.kind !== 'ink-cloud') {
      record.mesh.scale.setScalar(Math.min(1, age / 0.35) ** 0.65);
    }

    applyThermalMode(record.mesh, infrared);
    const deniedUntil = record.mesh.userData.deniedUntil as number | undefined;
    if ((deniedUntil ?? -Infinity) > elapsedNow && record.mesh.userData.isLetter) {
      setLetterDenied(record.mesh);
    } else if (record.mesh.userData.isLetter) {
      setLetterLocked(record.mesh, record.mesh.userData.locked === true);
    }

    const flashUntil = record.mesh.userData.damageFlashUntil as number | undefined;
    if ((flashUntil ?? -Infinity) > elapsedNow) flashMesh(record.mesh, (flashUntil! - elapsedNow) / 0.44);

    const signalCore = record.mesh.userData.signalCore as Mesh | undefined;
    if (signalCore) {
      const pulse = 1 + Math.sin(elapsedNow * 10 + enemyId) * 0.08;
      signalCore.scale.setScalar((record.mesh.userData.locked ? 1.13 : 1) * pulse);
    }
    if (record.lockRing) {
      record.mesh.getWorldPosition(record.lockRing.position);
      record.lockRing.quaternion.copy(context.camera.quaternion);
      record.lockRing.rotation.z += dt * 2.4;
      record.lockRing.scale.setScalar(1 + Math.sin(elapsedNow * 9) * 0.055);
    }
  }

  if (coreKilledAt >= 0 && environment) {
    const collapse = Math.max(0.02, 1 - (elapsedNow - coreKilledAt) * 1.15);
    environment.boss.scale.setScalar(collapse);
    if (elapsedNow - coreKilledAt > 0.75) {
      environment.boss.visible = false;
      setInfraredMode(false);
    }
  }
}

function lockColor(lockCount: number) {
  return colorForLockCount(lockCount, [LAMP, CREAM, SIGNAL]);
}

function createLockRing(lockCount: number) {
  const group = new Group();
  const material = createAdditiveBasicMaterial({ color: hdr(lockColor(lockCount), 1.45), side: DoubleSide });
  const ring = new Mesh(new RingGeometry(0.96, 1.015, 32), material);
  const inner = new Mesh(new RingGeometry(0.69, 0.715, 16), material);
  group.add(ring, inner);
  group.userData.material = material;
  return group;
}

function updateLockRing(ring: Group, lockCount: number) {
  const material = ring.userData.material as MeshBasicMaterial | undefined;
  if (material) material.color.copy(hdr(lockColor(lockCount), 1.45));
}

function flashMesh(mesh: Group, amount: number) {
  const parts = mesh.userData.thermalParts as Array<{ material: { color: Color }; normal: Color; infrared: Color }> | undefined;
  if (!parts) return;
  for (const part of parts) {
    part.material.color.copy(infrared ? part.infrared : part.normal).multiplyScalar(1.2 + amount * 1.8);
  }
}
