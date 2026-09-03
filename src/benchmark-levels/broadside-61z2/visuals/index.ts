import {
  AdditiveBlending,
  BoxGeometry,
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
import type { Camera, PerspectiveCamera } from 'three';
import type { CameraFeelRig } from '../../../engine/camera-feel';
import { colorForLockCount } from '../../../engine/locks';
import {
  createPendingVisualRecords,
  createTransientEffectPool,
  disposeObject3D,
} from '../../../engine/visual-kit';
import type { EventBus } from '../../../events';
import { broadside61z2RunProgress } from '../gameplay';
import { BROADSIDE_61Z2_RUN_DURATION } from '../timing';
import {
  createBroadsideEnvironment,
  type BroadsideEnvironment,
} from './environment';
import {
  createBroadsideGlyph,
  createBroadsideProjectile,
  createBroadsideReticle,
  createDefenseMesh,
} from './enemies';
import { hdr, PALETTE } from './palette';

type EnemyRecord = {
  mesh: Group;
  kind: string;
  bornAt: number;
  locked: boolean;
};

type Pulse = {
  mesh: Mesh;
  age: number;
  life: number;
  color: Color;
  scale: number;
  inward: boolean;
};

type Burst = {
  group: Group;
  age: number;
  life: number;
  color: Color;
  directions: Vector3[];
  scale: number;
};

type VisualContext = {
  scene: Scene;
  camera: PerspectiveCamera;
};

const enemyRecords = createPendingVisualRecords<Group, EnemyRecord, [string]>({
  createRecord: (mesh, kind) => ({ mesh, kind, bornAt: elapsedNow, locked: false }),
  disposeRecord: (record) => disposeObject3D(record.mesh),
});
const projectileRecords = createPendingVisualRecords<Group, Group>({
  createRecord: (mesh) => mesh,
  disposeRecord: disposeObject3D,
});
const pulseGeometry = new RingGeometry(0.92, 1.0, 32);
const sparkGeometry = new BoxGeometry(0.08, 0.08, 0.52);
const pulses = createTransientEffectPool<Pulse, VisualContext>({
  update(effect, progress, _dt, context) {
    effect.mesh.quaternion.copy(context.camera.quaternion);
    const size = effect.inward
      ? effect.scale * (1.55 - progress * 1.35)
      : effect.scale * (0.16 + progress * 1.55);
    effect.mesh.scale.setScalar(size);
    const material = effect.mesh.material as MeshBasicMaterial;
    material.color.copy(hdr(effect.color, 1.8 * (1 - progress) ** 1.4));
    material.opacity = (1 - progress) ** 1.25;
  },
  dispose(effect) {
    effect.mesh.removeFromParent();
    (effect.mesh.material as MeshBasicMaterial).dispose();
  },
});
const bursts = createTransientEffectPool<Burst, VisualContext>({
  update(effect, progress, dt) {
    effect.group.children.forEach((child, index) => {
      const direction = effect.directions[index] ?? effect.directions[0];
      child.position.copy(direction).multiplyScalar(effect.scale * (progress * 0.7 + progress * progress * 2.8));
      child.rotation.z += dt * (8 + index * 1.7);
      const material = child instanceof Mesh ? child.material as MeshBasicMaterial : undefined;
      if (material) {
        material.opacity = (1 - progress) ** 1.35;
        material.color.copy(hdr(effect.color, 1.1 + (1 - progress) * 1.7));
      }
    });
  },
  dispose(effect) {
    effect.group.removeFromParent();
    disposeObject3D(effect.group);
  },
});

let environment: BroadsideEnvironment | null = null;
let reticleRef: Group | null = null;
let elapsedNow = 0;
let runTimeNow = 0;
let beatEnergy = 0;
let bossDestroyed = false;

export function createEnvironment(scene: Scene) {
  environment?.dispose();
  environment = createBroadsideEnvironment(scene);
  return environment.root;
}

export function disposeVisuals(scene: Scene, camera: Camera) {
  const context = { scene, camera: camera as PerspectiveCamera };
  pulses.clear(context);
  bursts.clear(context);
  enemyRecords.clear({ dispose: true, pending: true });
  projectileRecords.clear({ dispose: true, pending: true });
  environment?.dispose();
  environment = null;
  if (reticleRef) disposeObject3D(reticleRef);
  reticleRef = null;
}

export function createEnemyMesh(kind: string, letter?: string) {
  const mesh = kind === 'letter' || letter !== undefined
    ? createBroadsideGlyph(letter ?? 'A', PALETTE)
    : createDefenseMesh(kind as Parameters<typeof createDefenseMesh>[0], PALETTE);
  mesh.scale.setScalar(0.001);
  enemyRecords.enqueue(mesh);
  return mesh;
}

export function setEnemyLocked(mesh: Object3D, locked: boolean, lockCount = 1) {
  mesh.userData.locked = locked;
  mesh.userData.lockCount = lockCount;
  const record = [...enemyRecords.values()].find((candidate) => candidate.mesh === mesh);
  if (record) record.locked = locked;
  if (locked) {
    tintMaterials(mesh, colorForLockCount(lockCount, [PALETTE.cyan, PALETTE.gold, PALETTE.white]), 2.0);
  }
}

export function setEnemyDenied(mesh: Object3D) {
  mesh.userData.deniedUntil = elapsedNow + 0.5;
  tintMaterials(mesh, PALETTE.scarlet, 2.2);
}

export function createProjectileMesh() {
  return projectileRecords.enqueue(createBroadsideProjectile(PALETTE));
}

export function createReticle() {
  reticleRef = createBroadsideReticle(PALETTE);
  return reticleRef;
}

export function setReticleActive(reticle: Object3D, active: boolean, lockCount: number) {
  reticle.userData.active = active;
  reticle.userData.lockCount = lockCount;
  reticle.scale.setScalar(1 + lockCount * 0.08 + (active ? 0.1 : 0));
  const materials = reticle.userData.materials as MeshBasicMaterial[] | undefined;
  const color = lockCount > 0
    ? colorForLockCount(lockCount, [PALETTE.cyan, PALETTE.gold, PALETTE.white])
    : PALETTE.cyan;
  for (const material of materials ?? []) material.color.copy(hdr(color, active ? 1.85 : 1.15));
}

export function installVisualEventHandlers(bus: EventBus, scene: Scene, camera: PerspectiveCamera, cameraFeel: CameraFeelRig) {
  bus.on('spawn', ({ enemyId, kind, worldPosition }) => {
    enemyRecords.claim(enemyId, kind);
    const color = kind === 'bolt' ? PALETTE.crimson : kind === 'shield-generator' || kind === 'power-core' ? PALETTE.gold : PALETTE.orange;
    pulse(scene, worldPosition, color, kind === 'bolt' ? 2.6 : kind === 'power-core' ? 2.7 : 1.55, kind === 'bolt' ? 0.3 : 0.34, kind === 'bolt');
    if (kind === 'shield-generator') pulse(scene, worldPosition, PALETTE.white, 1.55, 0.24, true);
    if (kind === 'shield-generator') cameraFeel.kickFov(0.75, { decay: 3.4 });
  });

  bus.on('lock', ({ worldPosition, lockCount }) => {
    pulse(scene, worldPosition, colorForLockCount(lockCount, [PALETTE.cyan, PALETTE.gold, PALETTE.white]), 1.15, 0.2, true);
  });

  bus.on('unlock', ({ worldPosition }) => {
    pulse(scene, worldPosition, PALETTE.iceShadow, 0.9, 0.17);
  });

  bus.on('fire', ({ projectileId, worldPosition, volleySize }) => {
    projectileRecords.claim(projectileId);
    pulse(scene, worldPosition, volleySize >= 6 ? PALETTE.white : PALETTE.cyan, 0.78 + volleySize * 0.1, 0.18);
    if (volleySize >= 6) {
      cameraFeel.shake(0.24, { maxTrauma: 1.3, decay: 2.4 });
      pulse(scene, worldPosition, PALETTE.gold, 1.8, 0.3);
    }
  });

  bus.on('hit', ({ enemyId, projectileId, worldPosition, lethal }) => {
    projectileRecords.delete(projectileId, { dispose: true });
    pulse(scene, worldPosition, lethal ? PALETTE.white : PALETTE.orange, lethal ? 2.75 : 1.6, lethal ? 0.4 : 0.22);
    burst(scene, worldPosition, lethal ? PALETTE.gold : PALETTE.orange, lethal ? 1.25 : 0.65, lethal ? 0.48 : 0.25, lethal ? 9 : 5);
    const record = enemyRecords.get(enemyId);
    if (record && !lethal) record.mesh.userData.flashUntil = elapsedNow + 0.24;
  });

  bus.on('stage', ({ enemyId, worldPosition }) => {
    const record = enemyRecords.get(enemyId);
    const color = record?.kind === 'shield-generator' ? PALETTE.gold : PALETTE.white;
    pulse(scene, worldPosition, color, 3.0, 0.45);
    burst(scene, worldPosition, color, 1.1, 0.45, 8);
    cameraFeel.shake(record?.kind === 'shield-generator' ? 0.48 : 0.32);
  });

  bus.on('kill', ({ enemyId, worldPosition }) => {
    const record = enemyRecords.get(enemyId);
    const kind = record?.kind ?? '';
    enemyRecords.delete(enemyId, { dispose: true });
    const boss = kind === 'shield-generator' || kind === 'power-core';
    pulse(scene, worldPosition, boss ? PALETTE.white : PALETTE.gold, boss ? 4.5 : 2.75, boss ? 0.66 : 0.38);
    pulse(scene, worldPosition, boss ? PALETTE.orange : PALETTE.cyan, boss ? 2.9 : 1.8, 0.38, true);
    burst(scene, worldPosition, boss ? PALETTE.gold : PALETTE.orange, boss ? 1.9 : 0.95, boss ? 0.72 : 0.38, boss ? 14 : 7);
    cameraFeel.shake(boss ? 0.68 : 0.12, { maxTrauma: boss ? 1.5 : 1 });
    if (kind === 'power-core') cameraFeel.kickFov(2.2, { decay: 1.5 });
  });

  bus.on('miss', ({ enemyId, worldPosition }) => {
    enemyRecords.delete(enemyId, { dispose: true });
    pulse(scene, worldPosition, PALETTE.crimson, 1.4, 0.24, true);
  });

  bus.on('reject', ({ enemyIds, missingEnemyIds }) => {
    const ids = new Set([...enemyIds, ...(missingEnemyIds ?? [])]);
    for (const enemyId of ids) {
      const record = enemyRecords.get(enemyId);
      if (!record) continue;
      record.mesh.userData.deniedUntil = elapsedNow + 0.54;
      pulse(scene, record.mesh.position, PALETTE.scarlet, 2.0, 0.27);
      burst(scene, record.mesh.position, PALETTE.crimson, 0.55, 0.3, 5);
    }
  });

  bus.on('bossphase', ({ phase }) => {
    environment?.setBossPhase(phase);
    if (phase === 'summoned') {
      cameraFeel.kickFov(1.8, { decay: 1.5 });
      cameraFeel.shake(0.32);
    } else if (phase === 'exposed') {
      cameraFeel.kickFov(4.5, { decay: 1.4 });
      cameraFeel.shake(0.75, { maxTrauma: 1.4, decay: 1.8 });
      pulse(scene, camera.position, PALETTE.gold, 8, 0.8);
    } else {
      bossDestroyed = true;
      cameraFeel.kickFov(7, { decay: 1.2 });
      cameraFeel.shake(1.15, { maxTrauma: 1.8, decay: 1.1, rollDegrees: 2.4 });
    }
  });

  bus.on('volley', ({ size, kills }) => {
    if (size === 6 && kills === size) {
      beatEnergy = 1.6;
      cameraFeel.shake(0.36, { maxTrauma: 1.4, decay: 2.2 });
    }
  });

  bus.on('beat', ({ isDownbeat }) => {
    beatEnergy = Math.max(beatEnergy, isDownbeat ? 1.0 : 0.48);
  });

  bus.on('runstart', () => {
    elapsedNow = 0;
    runTimeNow = 0;
    beatEnergy = 0;
    bossDestroyed = false;
    enemyRecords.clear({ dispose: true, pending: true });
    projectileRecords.clear({ dispose: true, pending: true });
    pulses.clear({ scene, camera });
    bursts.clear({ scene, camera });
    environment?.resetRun();
    cameraFeel.restore();
  });

  bus.on('runend', () => {
    environment?.setOutcome(bossDestroyed);
    cameraFeel.shake(bossDestroyed ? 0.45 : 0.9, { maxTrauma: 1.6, decay: bossDestroyed ? 1.4 : 1.0 });
  });

  bus.on('playerhit', ({ healthRemaining }) => {
    beatEnergy = 1.5;
    cameraFeel.shake(0.9 + (3 - healthRemaining) * 0.12, { maxTrauma: 1.7, decay: 1.9, rollDegrees: 2.1 });
    const position = camera.position;
    pulse(scene, position, PALETTE.crimson, 2.6, 0.34);
  });
}

export function updateVisuals(dt: number, context: { scene: Scene; camera: PerspectiveCamera; elapsed: number; runTime: number; running: boolean }) {
  elapsedNow = context.elapsed;
  runTimeNow = context.runTime;
  beatEnergy = Math.max(0, beatEnergy - dt * 4.5);
  const progress = context.running ? broadside61z2RunProgress(context.runTime, BROADSIDE_61Z2_RUN_DURATION) : 0;
  environment?.update(dt, context.runTime, context.running, progress, beatEnergy, context.camera);

  for (const record of enemyRecords.values()) {
    const age = Math.max(0, elapsedNow - record.bornAt);
    const intro = Math.min(1, age / (record.kind === 'power-core' || record.kind === 'shield-generator' ? 0.55 : 0.26));
    const pop = intro * intro * (3 - 2 * intro);
    const denied = (record.mesh.userData.deniedUntil as number | undefined ?? -Infinity) > elapsedNow;
    const flashing = (record.mesh.userData.flashUntil as number | undefined ?? -Infinity) > elapsedNow;
    const telegraph = record.kind === 'point-defense' ? Number(record.mesh.userData.charge ?? 0) : 0;
    const justFired = (record.mesh.userData.justFiredUntil as number | undefined ?? -Infinity) > runTimeNow;
    const bossScale = record.kind === 'shield-generator' || record.kind === 'power-core' ? 1.35 : record.kind === 'bolt' ? 1.18 : 1;
    const lockScale = record.locked ? 1 + Math.sin(elapsedNow * 15) * 0.065 : 1;
    const denialScale = denied ? 1 + Math.sin(elapsedNow * 40) * 0.12 : 1;
    const fireScale = justFired ? 1 + Math.sin(runTimeNow * 54) * 0.08 : 1;
    record.mesh.scale.setScalar(Math.max(0.001, pop * bossScale * lockScale * denialScale * fireScale * (1 + telegraph * 0.12)));

    const distance = record.mesh.position.distanceTo(context.camera.position);
    const dim = Math.min(1, Math.max(0.48, 1 - Math.max(0, distance - 20) / 120));
    if (denied) tintMaterials(record.mesh, PALETTE.scarlet, 2.4);
    else if (record.locked) tintMaterials(record.mesh, colorForLockCount(Number(record.mesh.userData.lockCount ?? 1), [PALETTE.cyan, PALETTE.gold, PALETTE.white]), 2.1);
    else if (flashing || justFired) tintMaterials(record.mesh, PALETTE.white, 2.25);
    else if (telegraph > 0) tintMaterials(record.mesh, PALETTE.crimson.clone().lerp(PALETTE.white, telegraph), 1.4 + telegraph * 1.6);
    else tintMaterials(record.mesh, undefined, dim);

    const rotors = record.mesh.userData.rotors as Object3D[] | undefined;
    rotors?.forEach((rotor, index) => {
      rotor.rotation.z += dt * (1.0 + index * 0.62) * (record.locked ? 2.4 : 1) * (1 + telegraph * 5);
    });
    const flex = record.mesh.userData.flexParts as Object3D[] | undefined;
    flex?.forEach((part, index) => {
      part.rotation.y = Math.sin(elapsedNow * 4.1 + index * Math.PI) * 0.16;
    });
  }

  for (const projectile of projectileRecords.values()) projectile.rotateZ(dt * 15);
  if (reticleRef) {
    const rotors = reticleRef.userData.rotors as Object3D[] | undefined;
    rotors?.forEach((rotor, index) => {
      rotor.rotation.z += dt * (index === 0 ? 0.9 : -0.56) * (reticleRef?.userData.active ? 2.4 : 1);
    });
  }
  const visualContext = { scene: context.scene, camera: context.camera };
  pulses.update(dt, visualContext);
  bursts.update(dt, visualContext);
}

function tintMaterials(mesh: Object3D, color: Color | undefined, intensity = 1) {
  const materials = mesh.userData.materials as MeshBasicMaterial[] | undefined;
  for (const material of materials ?? []) {
    const base = material.userData.baseColor as Color | undefined;
    material.color.copy(color ? hdr(color, intensity) : (base ?? PALETTE.orange).clone().multiplyScalar(intensity));
  }
}

function pulse(scene: Scene, position: Vector3, color: Color, scale: number, life: number, inward = false) {
  const material = new MeshBasicMaterial({
    color: hdr(color, 1.8),
    side: DoubleSide,
    transparent: true,
    opacity: 1,
    blending: AdditiveBlending,
    depthWrite: false,
  });
  const mesh = new Mesh(pulseGeometry, material);
  mesh.position.copy(position);
  scene.add(mesh);
  pulses.add({ mesh, age: 0, life, color: color.clone(), scale, inward });
}

function burst(scene: Scene, position: Vector3, color: Color, scale: number, life: number, count: number) {
  const group = new Group();
  group.position.copy(position);
  const directions: Vector3[] = [];
  for (let index = 0; index < count; index += 1) {
    const direction = new Vector3(
      Math.sin(index * 31.7 + scale) * 0.8,
      Math.cos(index * 17.3 + scale * 2) * 0.8,
      Math.sin(index * 11.1 + scale * 3) * 0.8,
    ).normalize();
    directions.push(direction);
    const material = new MeshBasicMaterial({
      color: hdr(color, 2.1),
      transparent: true,
      opacity: 1,
      blending: AdditiveBlending,
      depthWrite: false,
    });
    const spark = new Mesh(sparkGeometry, material);
    spark.lookAt(direction);
    group.add(spark);
  }
  scene.add(group);
  bursts.add({ group, age: 0, life, color: color.clone(), directions, scale });
}
