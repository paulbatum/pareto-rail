import {
  AdditiveBlending,
  Color,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  RingGeometry,
  Scene,
  Vector3,
} from 'three';
import type { Camera } from 'three';
import type { EventBus } from '../../../events';
import type { CameraFeelRig } from '../../../engine/camera-feel';
import { colorForLockCount } from '../../../engine/locks';
import { disposeObject3D } from '../../../engine/visual-kit';
import {
  createVespersEnemy,
  createVespersProjectile,
  createVespersReticle,
  deterministicDirection,
  EFFECT_DIAMOND,
  makeEffectMaterial,
  setReticleColor,
  tintJewelMaterials,
} from './enemies';
import { createVespersEnvironment, type VespersEnvironment } from './environment';
import { BLOOD, BONE, BOTTLE, COBALT, GLASS_COLORS, GOLD, hdr } from './palette';

type EnemyRecord = {
  mesh: Object3D;
  bornAt: number;
  kind: string;
  windowIndex?: number;
};

type RingEffect = {
  mesh: Mesh;
  age: number;
  life: number;
  startScale: number;
  endScale: number;
};

type BurstEffect = {
  group: Group;
  age: number;
  life: number;
  velocities: Vector3[];
};

let environment: VespersEnvironment | null = null;
let elapsedNow = 0;
let beatEnergy = 0;
let pendingEnemies: Object3D[] = [];
let pendingProjectiles: Object3D[] = [];
const enemies = new Map<number, EnemyRecord>();
const projectiles = new Map<number, Object3D>();
const rings: RingEffect[] = [];
const bursts: BurstEffect[] = [];

function clearDynamicVisuals() {
  for (const effect of rings) {
    effect.mesh.removeFromParent();
    disposeObject3D(effect.mesh);
  }
  for (const effect of bursts) {
    effect.group.removeFromParent();
    disposeObject3D(effect.group);
  }
  rings.length = 0;
  bursts.length = 0;
  enemies.clear();
  projectiles.clear();
  pendingEnemies = [];
  pendingProjectiles = [];
}

export function createEnvironment(scene: Scene) {
  environment?.dispose();
  clearDynamicVisuals();
  environment = createVespersEnvironment(scene);
  return environment.root;
}

export function disposeVisuals() {
  clearDynamicVisuals();
  environment?.dispose();
  environment = null;
}

export function createEnemyMesh(kind: string, letter?: string) {
  const mesh = createVespersEnemy(kind, letter);
  mesh.scale.setScalar(0.001);
  pendingEnemies.push(mesh);
  return mesh;
}

export function setEnemyLocked(mesh: Object3D, locked: boolean, lockCount = 1) {
  mesh.userData.locked = locked;
  mesh.userData.lockCount = lockCount;
  const color = colorForLockCount(lockCount, [COBALT, BOTTLE, GOLD, BLOOD]);
  tintJewelMaterials(mesh, locked ? color : undefined, locked ? 2.7 : 1);
}

export function setEnemyDenied(mesh: Object3D) {
  mesh.userData.deniedUntil = elapsedNow + 0.52;
  tintJewelMaterials(mesh, BLOOD, 2.75);
}

export function createProjectileMesh() {
  const mesh = createVespersProjectile();
  pendingProjectiles.push(mesh);
  return mesh;
}

export function createReticle() {
  return createVespersReticle();
}

export function setReticleActive(reticle: Object3D, active: boolean, lockCount: number) {
  reticle.userData.active = active;
  const color = lockCount > 0
    ? colorForLockCount(lockCount, [COBALT, BOTTLE, GOLD, BLOOD])
    : GOLD;
  setReticleColor(reticle, color);
  const pulse = active ? 0.08 : 0;
  reticle.scale.setScalar(1 + lockCount * 0.055 + pulse);
  reticle.rotation.z = active ? lockCount * 0.055 : 0;
}

function ring(
  scene: Scene,
  position: Vector3,
  color: Color,
  startScale: number,
  endScale: number,
  life: number,
  opacity = 1,
) {
  const material = new MeshBasicMaterial({
    color: hdr(color, 1.8),
    side: DoubleSide,
    transparent: true,
    opacity,
    blending: AdditiveBlending,
    depthWrite: false,
  });
  const mesh = new Mesh(new RingGeometry(0.94, 1, 40), material);
  mesh.position.copy(position);
  mesh.scale.setScalar(startScale);
  mesh.userData.raildIgnoreOcclusion = true;
  scene.add(mesh);
  rings.push({ mesh, age: 0, life, startScale, endScale });
}

function burst(scene: Scene, position: Vector3, color: Color, count: number, force = 1) {
  const group = new Group();
  group.position.copy(position);
  group.userData.raildIgnoreOcclusion = true;
  const material = makeEffectMaterial(color);
  material.blending = AdditiveBlending;
  material.transparent = true;
  const geometry = EFFECT_DIAMOND.clone();
  const velocities: Vector3[] = [];
  for (let index = 0; index < count; index += 1) {
    const direction = deterministicDirection(index);
    const shard = new Mesh(geometry, material);
    shard.scale.set(0.55 + (index % 4) * 0.18, 1.2 + (index % 3) * 0.45, 1);
    shard.rotation.z = index * 1.71;
    group.add(shard);
    velocities.push(new Vector3(direction.x * force, direction.y * force, ((index % 5) - 2) * 0.12 * force));
  }
  scene.add(group);
  bursts.push({ group, age: 0, life: 0.72 + force * 0.09, velocities });
}

function accentForKind(kind: string) {
  if (kind === 'pane-wraith') return COBALT;
  if (kind === 'candle-eater') return BLOOD;
  if (kind === 'chorister') return BOTTLE;
  if (kind === 'vigil') return GOLD;
  return BONE;
}

export function installVisualEventHandlers(bus: EventBus, scene: Scene, feel?: CameraFeelRig) {
  bus.on('spawn', ({ enemyId, kind, worldPosition }) => {
    const mesh = pendingEnemies.shift();
    if (!mesh) return;
    const record: EnemyRecord = { mesh, bornAt: elapsedNow, kind };
    if (kind !== 'letter' && kind !== 'devourer') {
      record.windowIndex = environment?.stealNearest(worldPosition);
    }
    enemies.set(enemyId, record);
    if (kind !== 'letter') ring(scene, worldPosition, accentForKind(kind), 0.15, 1.7, 0.34, 0.72);
  });

  bus.on('lock', ({ enemyId, worldPosition, lockCount }) => {
    const record = enemies.get(enemyId);
    if (record) record.mesh.userData.locked = true;
    ring(scene, worldPosition, colorForLockCount(lockCount, [COBALT, BOTTLE, GOLD, BLOOD]), 0.35, 1.45, 0.26);
  });

  bus.on('unlock', ({ enemyId, worldPosition }) => {
    const record = enemies.get(enemyId);
    if (record) record.mesh.userData.locked = false;
    ring(scene, worldPosition, BONE, 1.1, 0.25, 0.2, 0.55);
  });

  bus.on('fire', ({ projectileId, worldPosition, indexInVolley }) => {
    const projectile = pendingProjectiles.shift();
    if (projectile) projectiles.set(projectileId, projectile);
    ring(scene, worldPosition, GOLD, 0.22, 1.15, 0.16, 0.68);
    if ((indexInVolley ?? 0) === 0) feel?.kickFov(0.55, { decay: 7 });
  });

  bus.on('hit', ({ projectileId, enemyId, worldPosition, lethal, stageCompleted }) => {
    projectiles.delete(projectileId);
    const record = enemies.get(enemyId);
    const color = record ? accentForKind(record.kind) : BONE;
    ring(scene, worldPosition, color, 0.22, lethal ? 3.2 : 2.1, lethal ? 0.42 : 0.26);
    burst(scene, worldPosition, color, lethal ? 12 : 6, lethal ? 1.75 : 0.85);
    if (stageCompleted && !lethal) {
      ring(scene, worldPosition, BONE, 0.4, 5.8, 0.72);
      feel?.shake(0.2);
    }
  });

  bus.on('kill', ({ enemyId, worldPosition }) => {
    const record = enemies.get(enemyId);
    if (record?.windowIndex !== undefined) environment?.restore(record.windowIndex);
    if (record?.kind === 'devourer') environment?.igniteRose();
    const color = record ? accentForKind(record.kind) : GOLD;
    ring(scene, worldPosition, color, 0.18, record?.kind === 'devourer' ? 13 : 4.8, record?.kind === 'devourer' ? 1.5 : 0.56);
    burst(scene, worldPosition, color, record?.kind === 'devourer' ? 32 : 16, record?.kind === 'devourer' ? 3.8 : 2.1);
    enemies.delete(enemyId);
    feel?.shake(record?.kind === 'devourer' ? 0.7 : 0.075);
  });

  bus.on('miss', ({ enemyId, worldPosition }) => {
    const record = enemies.get(enemyId);
    ring(scene, worldPosition, BLOOD, 0.9, 0.16, 0.3, 0.58);
    if (record) tintJewelMaterials(record.mesh, BLOOD, 0.55);
    enemies.delete(enemyId);
  });

  bus.on('reject', ({ enemyIds, missingEnemyIds }) => {
    const denied = new Set([...enemyIds, ...(missingEnemyIds ?? [])]);
    for (const enemyId of denied) {
      const record = enemies.get(enemyId);
      if (!record) continue;
      record.mesh.userData.deniedUntil = elapsedNow + 0.52;
      tintJewelMaterials(record.mesh, BLOOD, 2.8);
      ring(scene, record.mesh.position, BLOOD, 0.32, 2.6, 0.28);
      ring(scene, record.mesh.position, BONE, 1.35, 0.5, 0.24, 0.62);
    }
    feel?.shake(0.12);
  });

  bus.on('volley', ({ size, kills }) => {
    if (size >= 5 && kills >= 5) feel?.kickFov(1.2, { decay: 3.8 });
  });

  bus.on('beat', ({ isDownbeat }) => {
    beatEnergy = isDownbeat ? 1 : 0.42;
  });

  bus.on('bossphase', ({ phase }) => {
    if (phase === 'exposed') {
      environment?.exposeRose();
      const core = [...enemies.values()].find((record) => record.kind === 'devourer');
      if (core) {
        core.mesh.userData.exposed = true;
        ring(scene, core.mesh.position, BONE, 0.5, 8.5, 1.1);
        GLASS_COLORS.forEach((color, index) => {
          ring(scene, core.mesh.position, color, 0.4 + index * 0.12, 4.5 + index, 0.62 + index * 0.08);
        });
      }
      feel?.shake(0.36);
    }
    if (phase === 'destroyed') {
      environment?.igniteRose();
      feel?.kickFov(3.2, { decay: 1.7 });
      feel?.shake(0.9, { decay: 0.9, rollDegrees: 1.4, pitchDegrees: 0.75, yawDegrees: 0.55 });
    }
  });

  bus.on('runstart', () => {
    enemies.clear();
    projectiles.clear();
    environment?.reset();
  });
}

function updateRings(dt: number, camera: Camera) {
  for (let index = rings.length - 1; index >= 0; index -= 1) {
    const effect = rings[index];
    effect.age += dt;
    const progress = Math.min(1, effect.age / effect.life);
    effect.mesh.quaternion.copy(camera.quaternion);
    effect.mesh.scale.setScalar(effect.startScale + (effect.endScale - effect.startScale) * (1 - (1 - progress) ** 2));
    const material = effect.mesh.material as MeshBasicMaterial;
    material.opacity = (1 - progress) ** 1.7;
    if (progress >= 1) {
      effect.mesh.removeFromParent();
      disposeObject3D(effect.mesh);
      rings.splice(index, 1);
    }
  }
}

function updateBursts(dt: number, camera: Camera) {
  for (let index = bursts.length - 1; index >= 0; index -= 1) {
    const effect = bursts[index];
    effect.age += dt;
    const progress = Math.min(1, effect.age / effect.life);
    effect.group.quaternion.copy(camera.quaternion);
    effect.group.children.forEach((child, childIndex) => {
      const velocity = effect.velocities[childIndex];
      if (!velocity) return;
      child.position.addScaledVector(velocity, dt * (1 - progress * 0.68) * 5.2);
      child.rotation.z += dt * (4 + childIndex * 0.25);
      child.scale.multiplyScalar(Math.max(0.01, 1 - dt * 1.45));
    });
    const material = effect.group.children[0] instanceof Mesh
      ? effect.group.children[0].material as MeshBasicMaterial
      : undefined;
    if (material) material.opacity = (1 - progress) ** 1.35;
    if (progress >= 1) {
      effect.group.removeFromParent();
      disposeObject3D(effect.group);
      bursts.splice(index, 1);
    }
  }
}

export function updateVisuals(
  dt: number,
  context: {
    scene: Scene;
    camera: Camera;
    feel: CameraFeelRig;
    elapsed: number;
    runTime: number;
    running: boolean;
  },
) {
  elapsedNow = context.elapsed;
  beatEnergy = Math.max(0, beatEnergy - dt * 3.4);

  for (const record of enemies.values()) {
    const age = context.elapsed - record.bornAt;
    const intro = Math.min(1, age / (record.kind === 'devourer' ? 0.85 : 0.3));
    const easedIntro = intro * intro * (3 - 2 * intro);
    const baseScale = (record.mesh.userData.baseScale as number | undefined) ?? 1;
    const denied = ((record.mesh.userData.deniedUntil as number | undefined) ?? -Infinity) > context.elapsed;
    const locked = record.mesh.userData.locked === true;
    const bossPulse = record.kind === 'devourer'
      ? 1 + Math.sin(context.elapsed * (record.mesh.userData.exposed ? 5.4 : 2.1)) * (record.mesh.userData.exposed ? 0.075 : 0.025)
      : 1;
    const lockPulse = locked ? 1 + Math.sin(context.elapsed * 12) * 0.055 : 1;
    const deniedPulse = denied ? 1 + Math.sin(context.elapsed * 42) * 0.085 : 1;
    record.mesh.scale.setScalar(baseScale * easedIntro * bossPulse * lockPulse * deniedPulse);

    if (denied) tintJewelMaterials(record.mesh, BLOOD, 2.75);
    else if (locked) {
      const count = (record.mesh.userData.lockCount as number | undefined) ?? 1;
      tintJewelMaterials(record.mesh, colorForLockCount(count, [COBALT, BOTTLE, GOLD, BLOOD]), 2.65);
    } else tintJewelMaterials(record.mesh);

    if (record.kind === 'chorister') {
      record.mesh.children.forEach((child, index) => {
        if (index > 1 && index < 10) child.rotation.z += dt * (index % 2 === 0 ? 0.35 : -0.35);
      });
    }
  }

  for (const projectile of projectiles.values()) projectile.rotateZ(dt * 8.5);
  updateRings(dt, context.camera);
  updateBursts(dt, context.camera);
  environment?.update(dt, {
    camera: context.camera,
    elapsed: context.elapsed,
    runTime: context.runTime,
    beatEnergy,
  });

  if (context.running) {
    const quiet = context.runTime >= 32.5 && context.runTime < 42.5;
    const finale = context.runTime >= 50;
    context.feel.setFovOffset(quiet ? -1.35 : finale ? 2.15 : beatEnergy * 0.42, { response: 3.4 });
  } else {
    context.feel.setFovOffset(-0.8 + Math.sin(context.elapsed * 0.18) * 0.3, { response: 2 });
  }
  context.feel.update(dt);
}
