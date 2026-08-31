import {
  AdditiveBlending,
  BoxGeometry,
  CircleGeometry,
  Color,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  PerspectiveCamera,
  RingGeometry,
  Scene,
  TorusGeometry,
  Vector3,
} from 'three';
import type { CameraFeelRig } from '../../../engine/camera-feel';
import { colorForLockCount } from '../../../engine/locks';
import {
  createAdditiveBasicMaterial,
  createPendingVisualRecords,
} from '../../../engine/visual-kit';
import type { EventBus } from '../../../events';
import { createBroadside806fRail } from '../gameplay';
import { createFleetEnvironment, type FleetEnvironment } from './environment';
import { createEnemyModel, createPlayerProjectile } from './models';
import {
  CRIMSON,
  CYAN,
  ENEMY_EDGE,
  ICE,
  MOLTEN,
  NEBULA_GOLD,
  SHIELD,
  STAR_WHITE,
  hdr,
} from './palette';

type EnemyRecord = {
  mesh: Group;
  born: number;
  kind: string;
  lockBracket: Group | null;
  lockCount: number;
};

type Spark = {
  mesh: Mesh;
  velocity: Vector3;
  age: number;
  life: number;
  drag: number;
  spin: number;
};

type Shock = {
  mesh: Mesh;
  material: MeshBasicMaterial;
  age: number;
  life: number;
  maxScale: number;
};

let currentScene: Scene | null = null;
let environment: FleetEnvironment | null = null;
let elapsedNow = 0;
let beatEnergy = 0;
let rejectEnergy = 0;
let cameraFeel: CameraFeelRig | null = null;
const sparks: Spark[] = [];
const shocks: Shock[] = [];
const sparkGeometry = new BoxGeometry(0.12, 0.12, 0.85);
const lockCornerGeometry = new RingGeometry(1.55, 1.69, 6, 1, 0, Math.PI / 2);
const lockNotchGeometry = new BoxGeometry(0.28, 0.065, 0.03);
const shockGeometry = new RingGeometry(0.65, 0.9, 36);
const sparkMaterials = new Map<number, MeshBasicMaterial>();

function disposeMaterials(root: Object3D) {
  const disposed = new Set<MeshBasicMaterial>();
  root.traverse((child) => {
    if (!(child instanceof Mesh)) return;
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    for (const material of materials) {
      if (!(material instanceof MeshBasicMaterial) || disposed.has(material)) continue;
      material.dispose();
      disposed.add(material);
    }
  });
}

function disposeRecord(record: EnemyRecord) {
  if (record.lockBracket) {
    record.lockBracket.removeFromParent();
    disposeMaterials(record.lockBracket);
  }
  record.mesh.removeFromParent();
  disposeMaterials(record.mesh);
}

const records = createPendingVisualRecords<Group, EnemyRecord>({
  createRecord: (mesh) => ({ mesh, born: elapsedNow, kind: String(mesh.userData.kind ?? 'unknown'), lockBracket: null, lockCount: 0 }),
  disposeRecord,
});

const projectileRecords = createPendingVisualRecords<Group, Group>({
  createRecord: (mesh) => mesh,
  disposeRecord(mesh) {
    mesh.removeFromParent();
    disposeMaterials(mesh);
  },
});

export function createEnvironment(scene: Scene) {
  currentScene = scene;
  environment = createFleetEnvironment(scene, createBroadside806fRail());
  return environment.root;
}

export function createEnemyMesh(kind: string, letter?: string) {
  const mesh = createEnemyModel(kind as Parameters<typeof createEnemyModel>[0], letter);
  mesh.scale.setScalar(0.001);
  records.enqueue(mesh);
  return mesh;
}

export function setEnemyLocked(mesh: Object3D, locked: boolean, lockCount = 0) {
  mesh.userData.locked = locked;
  mesh.userData.lockCount = lockCount;
  const accents = (mesh.userData.accents ?? []) as MeshBasicMaterial[];
  for (const material of accents) material.opacity = locked ? 1 : 0.82;
}

export function setEnemyDenied(mesh: Object3D) {
  mesh.userData.deniedUntil = elapsedNow + 0.5;
  burst(mesh.position, CRIMSON, 11, 7.5, 0.42);
  shock(mesh.position, MOLTEN, 0.42, 5.2);
  cameraFeel?.shake(0.08);
}

export function createProjectileMesh() {
  const projectile = createPlayerProjectile();
  projectileRecords.enqueue(projectile);
  return projectile;
}

export function createReticle() {
  const root = new Group();
  const materials: MeshBasicMaterial[] = [];
  const add = (geometry: RingGeometry | BoxGeometry | CircleGeometry, color: Color, opacity = 0.88) => {
    const material = createAdditiveBasicMaterial({ color, opacity, side: DoubleSide });
    materials.push(material);
    const mesh = new Mesh(geometry, material);
    root.add(mesh);
    return mesh;
  };
  add(new RingGeometry(0.53, 0.58, 48), hdr(CYAN, 1.35));
  add(new RingGeometry(0.72, 0.75, 6), hdr(ICE, 0.9), 0.58).rotation.z = Math.PI / 6;
  for (let index = 0; index < 6; index += 1) {
    const angle = index / 6 * Math.PI * 2;
    const pip = add(new BoxGeometry(0.16, 0.045, 0.02), hdr(index < 3 ? CYAN : ICE, 1.18));
    pip.position.set(Math.cos(angle) * 0.94, Math.sin(angle) * 0.94, 0);
    pip.rotation.z = angle;
  }
  add(new CircleGeometry(0.035, 10), hdr(STAR_WHITE, 2.4));
  root.userData.materials = materials;
  root.userData.active = false;
  return root;
}

export function setReticleActive(reticle: Object3D, active: boolean, lockCount: number) {
  reticle.userData.active = active;
  reticle.userData.lockCount = lockCount;
  reticle.visible = true;
  reticle.scale.setScalar(1 + lockCount * 0.06 + (active ? 0.055 : 0));
  const colors = [CYAN, CYAN, ICE, NEBULA_GOLD, MOLTEN, CRIMSON];
  const color = lockCount ? colorForLockCount(lockCount, colors) : CYAN;
  const materials = reticle.userData.materials as MeshBasicMaterial[];
  for (const [index, material] of materials.entries()) {
    material.color.copy(hdr(index === materials.length - 1 ? STAR_WHITE : color, active ? 1.5 : 1.02));
    material.opacity = active ? 0.92 : 0.52;
  }
  reticle.rotation.z += active ? 0.008 : 0.002;
}

function createLockBracket(lockCount: number) {
  const root = new Group();
  const color = colorForLockCount(lockCount, [CYAN, ICE, NEBULA_GOLD, MOLTEN, CRIMSON, STAR_WHITE]);
  const material = createAdditiveBasicMaterial({ color: hdr(color, 1.6), opacity: 0.92, side: DoubleSide });
  for (let index = 0; index < 4; index += 1) {
    const corner = new Mesh(lockCornerGeometry, material);
    corner.rotation.z = index * Math.PI / 2 + Math.PI / 4;
    root.add(corner);
  }
  for (let index = 0; index < Math.min(6, lockCount); index += 1) {
    const notch = new Mesh(lockNotchGeometry, material);
    notch.position.set((index - (lockCount - 1) / 2) * 0.36, -2.0, 0);
    root.add(notch);
  }
  return root;
}

function materialForSpark(color: Color) {
  const key = color.getHex();
  let material = sparkMaterials.get(key);
  if (!material) {
    material = new MeshBasicMaterial({
      color: hdr(color, 1.8),
      transparent: true,
      opacity: 0.9,
      blending: AdditiveBlending,
      depthWrite: false,
    });
    sparkMaterials.set(key, material);
  }
  return material;
}

function burst(position: Vector3, color: Color, count: number, speed: number, life: number) {
  if (!currentScene) return;
  const material = materialForSpark(color);
  const emittedCount = Math.max(3, Math.ceil(count * 0.65));
  for (let index = 0; index < emittedCount; index += 1) {
    const phi = index * 2.399963 + elapsedNow * 0.7;
    const y = 1 - ((index + 0.5) / emittedCount) * 2;
    const radius = Math.sqrt(Math.max(0, 1 - y * y));
    const velocity = new Vector3(Math.cos(phi) * radius, y, Math.sin(phi) * radius)
      .multiplyScalar(speed * (0.45 + (index % 7) / 8));
    const mesh = new Mesh(sparkGeometry, material);
    mesh.position.copy(position);
    mesh.scale.setScalar(0.65 + (index % 4) * 0.18);
    currentScene.add(mesh);
    sparks.push({ mesh, velocity, age: 0, life: life * (0.78 + (index % 5) * 0.08), drag: 1.4 + (index % 4) * 0.35, spin: (index % 2 ? 1 : -1) * (2 + index % 5) });
  }
}

function shock(position: Vector3, color: Color, life = 0.5, maxScale = 8) {
  if (!currentScene) return;
  const material = createAdditiveBasicMaterial({ color: hdr(color, 1.5), opacity: 0.9, side: DoubleSide });
  const mesh = new Mesh(shockGeometry, material);
  mesh.position.copy(position);
  mesh.scale.setScalar(0.15);
  mesh.raycast = () => {};
  currentScene.add(mesh);
  shocks.push({ mesh, material, age: 0, life, maxScale });
}

function removeLock(record: EnemyRecord) {
  if (!record.lockBracket) return;
  record.lockBracket.removeFromParent();
  disposeMaterials(record.lockBracket);
  record.lockBracket = null;
}

export function installVisualEventHandlers(bus: EventBus, _scene: Scene, feel?: CameraFeelRig) {
  cameraFeel = feel ?? null;
  bus.on('runstart', () => {
    beatEnergy = 0;
    rejectEnergy = 0;
    environment?.resetRun();
  });
  bus.on('runend', () => {
    projectileRecords.clear({ dispose: true, pending: true });
  });
  bus.on('spawn', ({ enemyId, kind, worldPosition }) => {
    const record = records.claim(enemyId);
    if (!record) return;
    record.born = elapsedNow;
    record.kind = kind;
    if (kind === 'generator') {
      burst(worldPosition, SHIELD, 18, 8, 0.65);
      shock(worldPosition, SHIELD, 0.75, 11);
    } else if (kind === 'power') {
      burst(worldPosition, MOLTEN, 22, 10, 0.75);
      shock(worldPosition, CRIMSON, 0.85, 13);
    } else if (kind !== 'letter' && kind !== 'flak') {
      burst(worldPosition, kind === 'turret' ? MOLTEN : CRIMSON, 6, 3.8, 0.32);
    }
  });
  bus.on('lock', ({ enemyId, lockCount, worldPosition }) => {
    const record = records.get(enemyId);
    if (record && currentScene) {
      removeLock(record);
      record.lockBracket = createLockBracket(lockCount);
      record.lockCount = lockCount;
      currentScene.add(record.lockBracket);
    }
    burst(worldPosition, CYAN, 4 + Math.min(4, lockCount), 3, 0.22);
    cameraFeel?.shake(lockCount === 6 ? 0.08 : 0.018);
  });
  bus.on('unlock', ({ enemyId }) => {
    const record = records.get(enemyId);
    if (record) removeLock(record);
  });
  bus.on('fire', ({ projectileId, volleySize, worldPosition }) => {
    projectileRecords.claim(projectileId);
    burst(worldPosition, CYAN, 5 + volleySize, 7 + volleySize, 0.26);
    shock(worldPosition, ICE, 0.28, 2.5 + volleySize * 0.55);
    cameraFeel?.kickFov(Math.min(2.4, volleySize * 0.32), { decay: 7 });
    cameraFeel?.shake(0.035 + volleySize * 0.012);
  });
  bus.on('hit', ({ enemyId, projectileId, worldPosition, lethal }) => {
    projectileRecords.delete(projectileId, { dispose: true });
    const record = records.get(enemyId);
    if (record) record.mesh.userData.flashUntil = elapsedNow + (lethal ? 0.24 : 0.13);
    burst(worldPosition, lethal ? MOLTEN : ICE, lethal ? 18 : 8, lethal ? 11 : 5, lethal ? 0.72 : 0.3);
    shock(worldPosition, lethal ? NEBULA_GOLD : CYAN, lethal ? 0.62 : 0.28, lethal ? 9 : 3.7);
    environment?.impact(lethal ? 0.6 : 0.25);
    cameraFeel?.shake(lethal ? 0.11 : 0.035);
  });
  bus.on('stage', ({ enemyId, worldPosition }) => {
    const record = records.get(enemyId);
    if (record) record.mesh.userData.stageBurstAt = elapsedNow;
    burst(worldPosition, CRIMSON, 26, 14, 0.9);
    shock(worldPosition, MOLTEN, 0.85, 14);
    environment?.impact(0.9);
    cameraFeel?.kickFov(1.4, { decay: 5 });
    cameraFeel?.shake(0.22);
  });
  bus.on('kill', ({ enemyId, worldPosition }) => {
    const record = records.get(enemyId);
    const bossTarget = record?.kind === 'generator' || record?.kind === 'power';
    burst(worldPosition, bossTarget ? NEBULA_GOLD : MOLTEN, bossTarget ? 38 : 22, bossTarget ? 18 : 12, bossTarget ? 1.15 : 0.8);
    shock(worldPosition, bossTarget ? STAR_WHITE : CRIMSON, bossTarget ? 1.1 : 0.72, bossTarget ? 20 : 11);
    records.delete(enemyId, { dispose: true });
    cameraFeel?.shake(bossTarget ? 0.38 : 0.16);
  });
  bus.on('miss', ({ enemyId, worldPosition }) => {
    burst(worldPosition, ENEMY_EDGE, 5, 2.4, 0.28);
    records.delete(enemyId, { dispose: true });
  });
  bus.on('reject', () => {
    rejectEnergy = 1;
    cameraFeel?.shake(0.12);
  });
  bus.on('beat', ({ isDownbeat }) => { beatEnergy = isDownbeat ? 1 : 0.55; });
  bus.on('bossphase', ({ phase }) => {
    if (phase === 'exposed') environment?.setShieldDown();
    if (phase === 'destroyed') environment?.setFlagshipDestroyed();
  });
  bus.on('playerhit', () => {
    environment?.playerDamage();
    cameraFeel?.shake(0.52, { decay: 2.2, maxTrauma: 1.2 });
  });
}

function updateEnemyAnimation(record: EnemyRecord, dt: number) {
  const mesh = record.mesh;
  const age = elapsedNow - record.born;
  const animated = (mesh.userData.animated ?? []) as Object3D[];
  const heat = Number(mesh.userData.heat ?? 0);
  const locked = Boolean(mesh.userData.locked);
  const denied = Number(mesh.userData.deniedUntil ?? -1) > elapsedNow;
  const intro = Math.min(1, Math.max(0.001, age * (record.kind === 'generator' || record.kind === 'power' ? 2.6 : 5.2)));
  const targetScale = intro * (locked ? 1.08 : 1) * (denied ? 0.78 + Math.sin(elapsedNow * 38) * 0.14 : 1);
  mesh.scale.setScalar(Math.max(0.001, targetScale));

  if (record.kind === 'skirmisher') {
    if (animated[0]) animated[0].rotation.y = Math.sin(age * 5.5) * 0.34;
    if (animated[1]) animated[1].rotation.y = -Math.sin(age * 5.5) * 0.34;
    if (animated[2]) animated[2].scale.setScalar(0.85 + Math.sin(age * 13) * 0.15 + heat * 0.25);
  } else if (record.kind === 'interceptor') {
    if (animated[0]) animated[0].rotation.z += dt * 4.8;
  } else if (record.kind === 'bomber') {
    if (animated[0]) animated[0].scale.setScalar(0.82 + Math.sin(age * 7.2) * 0.18);
  } else if (record.kind === 'turret') {
    if (animated[1]) animated[1].rotation.y = Math.sin(age * 0.9) * 0.3;
  } else if (record.kind === 'flak') {
    mesh.rotation.z += dt * 9;
    if (mesh.userData.impact) mesh.scale.multiplyScalar(1 + Math.sin(age * 42) * 0.08);
  } else if (record.kind === 'generator') {
    if (animated[0]) {
      animated[0].rotation.x += dt * 0.55;
      animated[0].rotation.y -= dt * 0.72;
    }
    if (animated[1]) animated[1].scale.setScalar(0.82 + Math.sin(age * 5.5) * 0.18 + beatEnergy * 0.12);
  } else if (record.kind === 'power') {
    const stageIndex = Number(mesh.userData.stageIndex ?? 0);
    if (animated[0]) {
      animated[0].rotation.z += dt * (0.35 + stageIndex * 0.4);
      animated[0].scale.setScalar(1 + stageIndex * 0.12);
    }
    if (animated[1]) animated[1].scale.setScalar(0.75 + Math.sin(age * 8) * 0.18 + stageIndex * 0.16);
    if (animated[2]) animated[2].rotation.z -= dt * 1.4;
    if (mesh.userData.shielded) mesh.scale.multiplyScalar(0.94 + Math.sin(age * 7) * 0.035);
  } else if (record.kind === 'letter' && animated[0]) {
    animated[0].rotation.z += dt * 0.12;
  }

  const accents = (mesh.userData.accents ?? []) as MeshBasicMaterial[];
  const flash = Number(mesh.userData.flashUntil ?? -1) > elapsedNow;
  for (const material of accents) {
    material.opacity = flash ? 0.35 : locked ? 1 : 0.72 + beatEnergy * 0.08;
  }
}

export function updateVisuals(dt: number, context: {
  scene: Scene;
  camera: PerspectiveCamera;
  elapsed: number;
  runTime: number;
  runProgress: number;
  running: boolean;
}) {
  elapsedNow = context.elapsed;
  beatEnergy *= Math.exp(-dt * 6.5);
  rejectEnergy *= Math.exp(-dt * 8);

  for (const record of records.values()) {
    updateEnemyAnimation(record, dt);
    if (record.lockBracket) {
      record.lockBracket.position.copy(record.mesh.position);
      record.lockBracket.quaternion.copy(context.camera.quaternion);
      record.lockBracket.rotation.z += dt * (1.2 + record.lockCount * 0.12);
      record.lockBracket.scale.setScalar(record.kind === 'power' || record.kind === 'generator' ? 1.55 : record.kind === 'bomber' ? 1.3 : 1);
    }
  }

  for (let index = sparks.length - 1; index >= 0; index -= 1) {
    const spark = sparks[index];
    spark.age += dt;
    if (spark.age >= spark.life) {
      spark.mesh.removeFromParent();
      sparks.splice(index, 1);
      continue;
    }
    spark.mesh.position.addScaledVector(spark.velocity, dt);
    spark.velocity.multiplyScalar(Math.exp(-spark.drag * dt));
    spark.mesh.rotation.z += spark.spin * dt;
    spark.mesh.quaternion.copy(context.camera.quaternion);
    spark.mesh.rotateZ(spark.age * spark.spin);
    const remaining = 1 - spark.age / spark.life;
    spark.mesh.scale.multiplyScalar(0.97);
    spark.mesh.scale.z = Math.max(0.08, remaining * 1.8);
  }

  for (let index = shocks.length - 1; index >= 0; index -= 1) {
    const ring = shocks[index];
    ring.age += dt;
    if (ring.age >= ring.life) {
      ring.mesh.removeFromParent();
      ring.material.dispose();
      shocks.splice(index, 1);
      continue;
    }
    const progress = ring.age / ring.life;
    ring.mesh.quaternion.copy(context.camera.quaternion);
    ring.mesh.scale.setScalar(0.2 + ring.maxScale * (1 - (1 - progress) ** 3));
    ring.material.opacity = (1 - progress) ** 2 * 0.86;
  }

  environment?.update(dt, {
    camera: context.camera,
    runTime: context.runTime,
    runProgress: context.runProgress,
    running: context.running,
    beatEnergy: beatEnergy + rejectEnergy * 0.15,
  });
}

export function disposeVisuals() {
  records.clear({ dispose: true, pending: true });
  projectileRecords.clear({ dispose: true, pending: true });
  for (const spark of sparks) spark.mesh.removeFromParent();
  sparks.length = 0;
  for (const ring of shocks) {
    ring.mesh.removeFromParent();
    ring.material.dispose();
  }
  shocks.length = 0;
  for (const material of sparkMaterials.values()) material.dispose();
  sparkMaterials.clear();
  environment?.dispose();
  environment = null;
  currentScene = null;
  cameraFeel = null;
}
