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
import type { CameraFeelRig } from '../../../engine/camera-feel';
import { colorForLockCount } from '../../../engine/locks';
import {
  createPendingVisualRecords,
  createTransientEffectPool,
  disposeObject3D,
} from '../../../engine/visual-kit';
import type { EventBus } from '../../../events';
import {
  createBroadsideB3fkRail,
  type BroadsideB3fkEnemyKind,
} from '../gameplay';
import {
  BROADSIDE_B3FK_BPM,
  BROADSIDE_B3FK_MARKERS,
} from '../timing';
import { createBroadsideEnvironment } from './environment';
import {
  createBroadsideEnemy,
  createBroadsideProjectile,
  createBroadsideReticle,
  createFleetGlyph,
  type BroadsidePalette,
} from './models';

export const PALETTE: BroadsidePalette = {
  void: new Color(0.006, 0.002, 0.018),
  friendlyHull: new Color(0.34, 0.46, 0.58),
  friendlyDark: new Color(0.045, 0.075, 0.12),
  cyan: new Color(0.08, 0.72, 1),
  cyanWhite: new Color(0.72, 0.96, 1),
  enemyHull: new Color(0.025, 0.018, 0.035),
  enemyEdge: new Color(0.16, 0.035, 0.025),
  molten: new Color(1, 0.27, 0.045),
  crimson: new Color(1, 0.035, 0.12),
  magenta: new Color(0.86, 0.04, 0.55),
  gold: new Color(1, 0.58, 0.08),
};

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
  spin: number;
};

type VisualContext = { scene: Scene; camera: Camera };

const enemies = createPendingVisualRecords<Group, EnemyRecord, [string]>({
  createRecord: (mesh, kind) => ({ mesh, kind, bornAt: elapsedNow, locked: false }),
  disposeRecord: (record) => disposeObject3D(record.mesh),
});
const projectiles = createPendingVisualRecords<Group, Group>({
  createRecord: (mesh) => mesh,
  disposeRecord: disposeObject3D,
});

const PULSE_GEOMETRY = new RingGeometry(0.92, 1, 24);
const pulses = createTransientEffectPool<Pulse, VisualContext>({
  update(effect, progress, dt, context) {
    effect.mesh.quaternion.copy(context.camera.quaternion);
    effect.mesh.rotateZ(progress * effect.spin);
    const scale = effect.inward
      ? effect.scale * (1.6 - progress * 1.42)
      : effect.scale * (0.16 + progress * 1.58);
    effect.mesh.scale.setScalar(scale);
    const material = effect.mesh.material as MeshBasicMaterial;
    material.color.copy(effect.color).multiplyScalar(1.7 * (1 - progress) ** 1.25);
    material.opacity = (1 - progress) ** 1.35;
    void dt;
  },
  dispose(effect) {
    effect.mesh.removeFromParent();
    (effect.mesh.material as MeshBasicMaterial).dispose();
  },
});

let environment: ReturnType<typeof createBroadsideEnvironment> | null = null;
let elapsedNow = 0;
let runTimeNow = 0;
let beatEnergy = 0;
let shieldGeneratorsDestroyed = 0;
let powerCoresDestroyed = 0;
let reticleRef: Group | null = null;

export function createEnvironment(scene: Scene) {
  environment?.dispose();
  environment = createBroadsideEnvironment(scene, { rail: createBroadsideB3fkRail(), palette: PALETTE });
  return environment.root;
}

export function forceVictoryVisuals() {
  shieldGeneratorsDestroyed = 4;
  powerCoresDestroyed = 3;
  environment?.setBossState(4, 3);
  environment?.setOutcome(true);
}

export function disposeVisuals(scene: Scene, camera: Camera) {
  pulses.clear({ scene, camera });
  enemies.clear({ dispose: true, pending: true });
  projectiles.clear({ dispose: true, pending: true });
  environment?.dispose();
  environment = null;
  if (reticleRef) disposeObject3D(reticleRef);
  reticleRef = null;
}

export function createEnemyMesh(kind: string, letter?: string) {
  const model = kind === 'letter' || letter
    ? createFleetGlyph(letter ?? 'A', PALETTE)
    : createBroadsideEnemy(kind as BroadsideB3fkEnemyKind, PALETTE);
  model.scale.setScalar(0.001);
  enemies.enqueue(model);
  return model;
}

// Model-snapshot entry point used for bloom-zero silhouette review.
export function createBroadsideModelForSnapshot(kind: string) {
  if (kind === 'letter') return createFleetGlyph('R', PALETTE);
  return createBroadsideEnemy(kind as BroadsideB3fkEnemyKind, PALETTE);
}

export function setEnemyLocked(mesh: Object3D, locked: boolean, lockCount = 1) {
  mesh.userData.locked = locked;
  const record = [...enemies.values()].find((candidate) => candidate.mesh === mesh);
  if (record) record.locked = locked;
  const color = colorForLockCount(lockCount, [PALETTE.cyan, PALETTE.cyanWhite, PALETTE.gold]);
  tintMaterials(mesh, locked ? color : undefined, locked ? 1.95 : 1);
}

export function setEnemyDenied(mesh: Object3D) {
  mesh.userData.deniedUntil = elapsedNow + 0.48;
  tintMaterials(mesh, PALETTE.crimson, 2.2);
}

export function createProjectileMesh() {
  return projectiles.enqueue(createBroadsideProjectile(PALETTE));
}

export function createReticle() {
  reticleRef = createBroadsideReticle(PALETTE);
  return reticleRef;
}

export function setReticleActive(reticle: Object3D, active: boolean, lockCount: number) {
  reticle.userData.active = active;
  reticle.userData.lockCount = lockCount;
  reticle.scale.setScalar(1 + lockCount * 0.075 + (active ? 0.09 : 0));
  const materials = reticle.userData.materials as MeshBasicMaterial[] | undefined;
  const color = lockCount > 0
    ? colorForLockCount(lockCount, [PALETTE.cyan, PALETTE.cyanWhite, PALETTE.gold])
    : PALETTE.cyan;
  for (const material of materials ?? []) material.color.copy(color).multiplyScalar(active ? 1.85 : 1.35);
}

function pulse(scene: Scene, position: Vector3, color: Color, scale: number, life: number, inward = false, spin = 0) {
  const ring = new Mesh(
    PULSE_GEOMETRY,
    new MeshBasicMaterial({
      color: color.clone().multiplyScalar(1.7),
      side: DoubleSide,
      transparent: true,
      opacity: 1,
      blending: AdditiveBlending,
      depthWrite: false,
    }),
  );
  ring.position.copy(position);
  ring.userData.raildIgnoreOcclusion = true;
  scene.add(ring);
  pulses.add({ mesh: ring, age: 0, life, color: color.clone(), scale, inward, spin });
}

export function installVisualEventHandlers(bus: EventBus, scene: Scene, cameraFeel: CameraFeelRig) {
  bus.on('spawn', ({ enemyId, kind, worldPosition }) => {
    enemies.claim(enemyId, kind);
    const boss = kind === 'shieldGen' || kind === 'powerCore';
    const bolt = kind === 'pdcBolt';
    pulse(scene, worldPosition, bolt ? PALETTE.crimson : boss ? PALETTE.gold : PALETTE.molten, boss ? 3.5 : bolt ? 2.4 : 1.7, boss ? 0.46 : 0.3, bolt, boss ? 1.5 : 0.5);
    if (boss) pulse(scene, worldPosition, PALETTE.crimson, 2.1, 0.3, true, -1.2);
    if (bolt) cameraFeel.shake(0.08);
  });

  bus.on('lock', ({ worldPosition, lockCount }) => {
    pulse(scene, worldPosition, colorForLockCount(lockCount, [PALETTE.cyan, PALETTE.cyanWhite, PALETTE.gold]), 1.35, 0.22, true, 1.2);
  });
  bus.on('unlock', ({ worldPosition }) => pulse(scene, worldPosition, PALETTE.friendlyDark, 1.05, 0.18));
  bus.on('fire', ({ projectileId, worldPosition, volleySize }) => {
    projectiles.claim(projectileId);
    pulse(scene, worldPosition, volleySize === 6 ? PALETTE.gold : PALETTE.cyanWhite, 0.85 + volleySize * 0.1, 0.22, false, volleySize);
    if (volleySize === 6) {
      cameraFeel.shake(0.48);
      cameraFeel.kickFov(1.8, { decay: 5 });
    }
  });
  bus.on('hit', ({ enemyId, projectileId, worldPosition, lethal }) => {
    projectiles.delete(projectileId, { dispose: true });
    pulse(scene, worldPosition, lethal ? PALETTE.gold : PALETTE.cyanWhite, lethal ? 3.1 : 1.65, lethal ? 0.42 : 0.2, false, lethal ? 2 : 0.6);
    const record = enemies.get(enemyId);
    if (record && !lethal) record.mesh.userData.flashUntil = elapsedNow + 0.2;
  });
  bus.on('stage', ({ enemyId, worldPosition }) => {
    const record = enemies.get(enemyId);
    const jaws = record?.mesh.userData.jaws as Object3D[] | undefined;
    jaws?.forEach((jaw, index) => {
      jaw.rotation.z += index % 2 === 0 ? -0.36 : 0.36;
      jaw.position.multiplyScalar(1.08);
    });
    cameraFeel.shake(0.8);
    cameraFeel.kickFov(1.2, { decay: 4.2 });
    pulse(scene, worldPosition, PALETTE.gold, 4.8, 0.52, false, 2.2);
    pulse(scene, worldPosition, PALETTE.crimson, 2.7, 0.32, true, -1.8);
  });
  bus.on('kill', ({ enemyId, worldPosition }) => {
    const record = enemies.get(enemyId);
    const shield = record?.kind === 'shieldGen';
    const core = record?.kind === 'powerCore';
    enemies.delete(enemyId, { dispose: true });
    if (shield) shieldGeneratorsDestroyed += 1;
    if (core) powerCoresDestroyed += 1;
    environment?.setBossState(shieldGeneratorsDestroyed, powerCoresDestroyed);
    const boss = shield || core;
    pulse(scene, worldPosition, boss ? PALETTE.gold : PALETTE.molten, boss ? 7.2 : 3.4, boss ? 0.82 : 0.4, false, boss ? 3 : 1);
    pulse(scene, worldPosition, boss ? PALETTE.crimson : PALETTE.gold, boss ? 4.8 : 2.2, boss ? 0.6 : 0.3, true, -2);
    cameraFeel.shake(boss ? 0.95 + powerCoresDestroyed * 0.2 : 0.24);
    if (shieldGeneratorsDestroyed === 4) cameraFeel.kickFov(4, { decay: 1.4 });
    if (powerCoresDestroyed === 3) cameraFeel.kickFov(8.5, { decay: 0.75 });
  });
  bus.on('miss', ({ enemyId, worldPosition }) => {
    enemies.delete(enemyId, { dispose: true });
    pulse(scene, worldPosition, PALETTE.crimson, 1.4, 0.2, true, -0.8);
  });
  bus.on('reject', ({ enemyIds, missingEnemyIds }) => {
    for (const enemyId of new Set([...enemyIds, ...(missingEnemyIds ?? [])])) {
      const record = enemies.get(enemyId);
      if (!record) continue;
      record.mesh.userData.deniedUntil = elapsedNow + 0.48;
      pulse(scene, record.mesh.position, PALETTE.crimson, 2.3, 0.28, false, 2.6);
      pulse(scene, record.mesh.position, PALETTE.gold, 1.2, 0.16, true, -2.2);
    }
  });
  bus.on('volley', ({ size, kills }) => {
    if (size === 6 && kills === size) {
      beatEnergy = 1.5;
      cameraFeel.shake(0.56);
    }
  });
  bus.on('beat', ({ isDownbeat }) => {
    beatEnergy = Math.max(beatEnergy, isDownbeat ? 1 : 0.42);
  });
  bus.on('playerhit', () => {
    beatEnergy = 1.65;
    cameraFeel.shake(1.25, { decay: 2, maxTrauma: 1.5, pitchDegrees: 0.7, yawDegrees: 0.65, rollDegrees: 2 });
  });
  bus.on('runstart', () => {
    enemies.clear({ dispose: true });
    projectiles.clear({ dispose: true });
    shieldGeneratorsDestroyed = 0;
    powerCoresDestroyed = 0;
    runTimeNow = 0;
    environment?.reset();
    cameraFeel.restore();
  });
  bus.on('runend', () => {
    const success = powerCoresDestroyed === 3;
    environment?.setOutcome(success);
    cameraFeel.shake(success ? 0.65 : 1.35);
  });
}

function tintMaterials(mesh: Object3D, color?: Color, intensity = 1) {
  const materials = mesh.userData.materials as MeshBasicMaterial[] | undefined;
  for (const material of materials ?? []) {
    const base = material.userData.baseColor as Color | undefined;
    const baseIntensity = Number(material.userData.baseIntensity ?? 1);
    material.color.copy(color ?? base ?? PALETTE.molten).multiplyScalar(color ? intensity : baseIntensity);
  }
}

export function updateVisuals(
  dt: number,
  context: { scene: Scene; camera: Camera; feel: CameraFeelRig; elapsed: number; runTime: number; running: boolean },
) {
  elapsedNow = context.elapsed;
  runTimeNow = context.runTime;
  beatEnergy = Math.max(0, beatEnergy - dt * 4.5);
  environment?.update(dt, runTimeNow, context.running, beatEnergy, context.camera);

  const flankSurge = runTimeNow >= BROADSIDE_B3FK_MARKERS.broadside && runTimeNow < BROADSIDE_B3FK_MARKERS.enemyBelly ? 2.8 : 0;
  const trenchSurge = runTimeNow >= BROADSIDE_B3FK_MARKERS.trench ? 4.6 : 0;
  context.feel.setFovOffset(context.running ? beatEnergy * 1.15 + flankSurge + trenchSurge : beatEnergy * 0.4, { response: 5 });

  for (const record of enemies.values()) {
    const age = elapsedNow - record.bornAt;
    const boss = record.kind === 'shieldGen' || record.kind === 'powerCore';
    const bolt = record.kind === 'pdcBolt';
    const intro = Math.min(1, age / (boss ? 0.72 : bolt ? 0.16 : 0.28));
    const eased = intro * intro * (3 - 2 * intro);
    const denied = Number(record.mesh.userData.deniedUntil ?? -1) > elapsedNow;
    const flash = Number(record.mesh.userData.flashUntil ?? -1) > elapsedNow;
    const armed = Boolean(record.mesh.userData.armed);
    const telegraph = Number(record.mesh.userData.telegraph ?? 0);
    const justFired = Number(record.mesh.userData.justFiredUntil ?? -1) > runTimeNow;
    const lockPulse = record.locked ? 1 + Math.sin(elapsedNow * 15) * 0.065 : 1;
    const deniedPulse = denied ? 1 + Math.sin(elapsedNow * 42) * 0.1 : 1;
    const scale = boss ? 1.32 : bolt ? 1.12 : 1;
    record.mesh.scale.setScalar(eased * scale * lockPulse * deniedPulse * (1 + telegraph * 0.12));

    if (denied) tintMaterials(record.mesh, PALETTE.crimson, 2.35);
    else if (flash || justFired) tintMaterials(record.mesh, PALETTE.cyanWhite, 2.45);
    else if (telegraph > 0) tintMaterials(record.mesh, PALETTE.crimson.clone().lerp(PALETTE.gold, telegraph), 1.55 + telegraph);
    else if (boss && !armed) tintMaterials(record.mesh, PALETTE.enemyEdge, 0.65);
    else if (!record.locked) tintMaterials(record.mesh);

    const rotors = record.mesh.userData.rotors as Object3D[] | undefined;
    rotors?.forEach((rotor, index) => {
      rotor.rotation.z += dt * (1.2 + index * 0.6) * (record.locked ? 2.1 : 1) * (1 + telegraph * 3.5);
    });
    const flex = record.mesh.userData.flexParts as Object3D[] | undefined;
    flex?.forEach((part, index) => { part.rotation.y = Math.sin(elapsedNow * 5 + index * Math.PI) * 0.14; });

    if (boss && armed && !record.mesh.userData.armedSeen) {
      record.mesh.userData.armedSeen = true;
      pulse(context.scene, record.mesh.position, PALETTE.gold, 3.8, 0.44, true, 2.4);
      context.feel.kickFov(1, { decay: 5 });
    }
  }

  for (const projectile of projectiles.values()) projectile.rotateZ(dt * 13);
  if (reticleRef) {
    const rotors = reticleRef.userData.rotors as Object3D[] | undefined;
    rotors?.forEach((rotor, index) => rotor.rotateZ(dt * (index === 0 ? 0.85 : -0.6) * (reticleRef?.userData.active ? 2.2 : 1)));
  }
  pulses.update(dt, context);
}

export const BROADSIDE_BEAT_SECONDS = 60 / BROADSIDE_B3FK_BPM;
