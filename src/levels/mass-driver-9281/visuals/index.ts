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
  SphereGeometry,
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
  createMassDriver9281Rail,
  type MassDriver9281EnemyKind,
} from '../gameplay';
import {
  MASS_DRIVER_9281_BPM,
  MASS_DRIVER_9281_MARKERS,
  MASS_DRIVER_9281_RUN_DURATION,
} from '../timing';
import {
  createCoilGlyph,
  createDefenseDrone,
  createMassDriverProjectile,
  createMassDriverReticle,
  type MassDriverPalette,
} from './enemies';
import { createMassDriverEnvironment } from './environment';

export const PALETTE: MassDriverPalette = {
  void: new Color(0.002, 0.004, 0.018),
  steel: new Color(0.055, 0.075, 0.15),
  dormant: new Color(0.13, 0.22, 0.48),
  arc: new Color(0.16, 0.7, 1),
  violet: new Color(0.58, 0.2, 1),
  white: new Color(0.9, 0.98, 1),
  warning: new Color(0.92, 0.12, 1),
};

type EnemyRecord = {
  mesh: Group;
  kind: string;
  bornAt: number;
  locked: boolean;
};

type VisualContext = { scene: Scene; camera: Camera };
type Pulse = {
  mesh: Mesh;
  age: number;
  life: number;
  color: Color;
  scale: number;
  inward: boolean;
};

const enemies = createPendingVisualRecords<Group, EnemyRecord, [string]>({
  createRecord: (mesh, kind) => ({ mesh, kind, bornAt: elapsedNow, locked: false }),
  disposeRecord: (record) => disposeObject3D(record.mesh),
});
const projectiles = createPendingVisualRecords<Group, Group>({
  createRecord: (mesh) => mesh,
  disposeRecord: disposeObject3D,
});
const PULSE_GEOMETRY = new RingGeometry(0.92, 1, 32);
const pulses = createTransientEffectPool<Pulse, VisualContext>({
  update(effect, progress, _dt, context) {
    effect.mesh.quaternion.copy(context.camera.quaternion);
    const scale = effect.inward
      ? effect.scale * (1.6 - progress * 1.4)
      : effect.scale * (0.18 + progress * 1.45);
    effect.mesh.scale.setScalar(scale);
    const material = effect.mesh.material as MeshBasicMaterial;
    material.color.copy(effect.color).multiplyScalar(1.6 * (1 - progress) ** 1.5);
    material.opacity = (1 - progress) ** 1.2;
  },
  dispose(effect) {
    effect.mesh.removeFromParent();
    (effect.mesh.material as MeshBasicMaterial).dispose();
  },
});

let environment: ReturnType<typeof createMassDriverEnvironment> | null = null;
let beatEnergy = 0;
let elapsedNow = 0;
let runTimeNow = 0;
let interlocksDestroyed = 0;
let chargeFailed = false;
let reticleRef: Group | null = null;

export function createEnvironment(scene: Scene) {
  environment?.dispose();
  environment = createMassDriverEnvironment(scene, {
    rail: createMassDriver9281Rail(),
    duration: MASS_DRIVER_9281_RUN_DURATION,
    beatSeconds: 60 / MASS_DRIVER_9281_BPM,
    muzzleTime: MASS_DRIVER_9281_MARKERS.muzzle,
    palette: PALETTE,
  });
  return environment.root;
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

export function setChargeFailure() {
  chargeFailed = true;
  environment?.setOutcome(false);
}

export function createEnemyMesh(kind: string, letter?: string) {
  const mesh = kind === 'letter' || letter
    ? createCoilGlyph(letter ?? 'A', PALETTE)
    : createDefenseDrone(kind as MassDriver9281EnemyKind, PALETTE);
  mesh.scale.setScalar(0.001);
  enemies.enqueue(mesh);
  return mesh;
}

export function setEnemyLocked(mesh: Object3D, locked: boolean, lockCount = 1) {
  mesh.userData.locked = locked;
  const record = [...enemies.values()].find((candidate) => candidate.mesh === mesh);
  if (record) record.locked = locked;
  const color = colorForLockCount(lockCount, [PALETTE.arc, PALETTE.violet, PALETTE.white]);
  tintMaterials(mesh, locked ? color : undefined, locked ? 2 : 1);
}

export function setEnemyDenied(mesh: Object3D) {
  mesh.userData.deniedUntil = elapsedNow + 0.48;
  tintMaterials(mesh, PALETTE.warning, 2.2);
}

export function createProjectileMesh() {
  return projectiles.enqueue(createMassDriverProjectile(PALETTE));
}

export function createReticle() {
  reticleRef = createMassDriverReticle(PALETTE);
  return reticleRef;
}

export function setReticleActive(reticle: Object3D, active: boolean, lockCount: number) {
  reticle.userData.active = active;
  reticle.userData.lockCount = lockCount;
  reticle.scale.setScalar(1 + lockCount * 0.075 + (active ? 0.08 : 0));
  const materials = reticle.userData.materials as MeshBasicMaterial[] | undefined;
  const color = lockCount > 0
    ? colorForLockCount(lockCount, [PALETTE.arc, PALETTE.violet, PALETTE.white])
    : PALETTE.arc;
  for (const material of materials ?? []) material.color.copy(color).multiplyScalar(active ? 1.8 : 1.25);
}

export function installVisualEventHandlers(bus: EventBus, scene: Scene, cameraFeel: CameraFeelRig) {
  bus.on('spawn', ({ enemyId, kind, worldPosition }) => {
    enemies.claim(enemyId, kind);
    const spawnColor = kind === 'bolt' ? PALETTE.warning : kind === 'interlock' ? PALETTE.violet : PALETTE.arc;
    const spawnScale = kind === 'bolt' ? 2.7 : kind === 'interlock' ? 3.2 : 1.8;
    pulse(scene, worldPosition, spawnColor, spawnScale, kind === 'bolt' ? 0.28 : 0.36, kind === 'bolt');
    if (kind === 'interlock') pulse(scene, worldPosition, PALETTE.white, 1.5, 0.22, true);
    if (kind === 'bolt') cameraFeel.shake(0.1);
  });

  bus.on('lock', ({ worldPosition, lockCount }) => {
    pulse(scene, worldPosition, colorForLockCount(lockCount, [PALETTE.arc, PALETTE.violet, PALETTE.white]), 1.35, 0.22, true);
  });

  bus.on('unlock', ({ worldPosition }) => {
    pulse(scene, worldPosition, PALETTE.dormant, 1.1, 0.18);
  });

  bus.on('fire', ({ projectileId, worldPosition, volleySize }) => {
    projectiles.claim(projectileId);
    pulse(scene, worldPosition, volleySize === 6 ? PALETTE.white : PALETTE.arc, 0.9 + volleySize * 0.08, 0.2);
    if (volleySize === 6) cameraFeel.shake(0.38);
  });

  bus.on('hit', ({ enemyId, projectileId, worldPosition, lethal }) => {
    projectiles.delete(projectileId, { dispose: true });
    pulse(scene, worldPosition, lethal ? PALETTE.white : PALETTE.violet, lethal ? 2.8 : 1.7, lethal ? 0.35 : 0.2);
    const record = enemies.get(enemyId);
    if (record && !lethal) record.mesh.userData.flashUntil = elapsedNow + 0.2;
  });

  bus.on('stage', ({ enemyId, worldPosition }) => {
    const record = enemies.get(enemyId);
    if (record?.mesh.userData.isInterlock) {
      const jaws = record.mesh.userData.jaws as Object3D[] | undefined;
      jaws?.forEach((jaw, index) => { jaw.rotation.z += index % 2 === 0 ? -0.28 : 0.28; });
      cameraFeel.shake(0.72);
      pulse(scene, worldPosition, PALETTE.white, 4.2, 0.48);
      pulse(scene, worldPosition, PALETTE.violet, 2.4, 0.3, true);
    }
  });

  bus.on('kill', ({ enemyId, worldPosition }) => {
    const record = enemies.get(enemyId);
    const interlock = record?.kind === 'interlock';
    enemies.delete(enemyId, { dispose: true });
    pulse(scene, worldPosition, PALETTE.white, interlock ? 6.8 : 3.4, interlock ? 0.7 : 0.4);
    pulse(scene, worldPosition, interlock ? PALETTE.violet : PALETTE.arc, interlock ? 4.4 : 2.2, interlock ? 0.5 : 0.3, true);
    if (interlock) {
      interlocksDestroyed += 1;
      cameraFeel.shake(0.72 + interlocksDestroyed * 0.14);
      if (interlocksDestroyed === 4 && !chargeFailed && runTimeNow < MASS_DRIVER_9281_MARKERS.muzzle - 0.04) {
        environment?.setSafetyCleared(true);
        cameraFeel.kickFov(5.5, { decay: 1.3 });
      }
    }
  });

  bus.on('miss', ({ enemyId, worldPosition }) => {
    enemies.delete(enemyId, { dispose: true });
    pulse(scene, worldPosition, PALETTE.warning, 1.5, 0.22, true);
  });

  bus.on('reject', ({ enemyIds, missingEnemyIds }) => {
    const ids = new Set([...enemyIds, ...(missingEnemyIds ?? [])]);
    for (const enemyId of ids) {
      const record = enemies.get(enemyId);
      if (!record) continue;
      record.mesh.userData.deniedUntil = elapsedNow + 0.5;
      pulse(scene, record.mesh.position, PALETTE.warning, 2.2, 0.25);
      pulse(scene, record.mesh.position, PALETTE.white, 1.2, 0.15, true);
    }
  });

  bus.on('volley', ({ size, kills }) => {
    if (size === 6 && kills === size) {
      beatEnergy = 1.4;
      cameraFeel.shake(0.52);
    }
  });

  bus.on('beat', ({ isDownbeat }) => {
    beatEnergy = Math.max(beatEnergy, isDownbeat ? 1 : 0.48);
  });

  bus.on('runstart', () => {
    enemies.clear({ dispose: true });
    projectiles.clear({ dispose: true });
    interlocksDestroyed = 0;
    chargeFailed = false;
    runTimeNow = 0;
    environment?.setSafetyCleared(false);
    environment?.resetRun();
    cameraFeel.restore();
  });

  bus.on('runend', () => {
    const success = interlocksDestroyed === 4 && !chargeFailed;
    environment?.setOutcome(success);
    cameraFeel.shake(success ? 0.35 : 1.7);
  });

  bus.on('playerhit', () => {
    beatEnergy = 1.6;
    cameraFeel.shake(1.3, { decay: 2.1, maxTrauma: 1.5, pitchDegrees: 0.75, yawDegrees: 0.6, rollDegrees: 1.8 });
    environment?.arcFlash(0.58);
  });
}

function pulse(scene: Scene, position: Vector3, color: Color, scale: number, life: number, inward = false) {
  const mesh = new Mesh(
    PULSE_GEOMETRY,
    new MeshBasicMaterial({
      color: color.clone().multiplyScalar(1.6),
      side: DoubleSide,
      transparent: true,
      opacity: 1,
      blending: AdditiveBlending,
      depthWrite: false,
    }),
  );
  mesh.position.copy(position);
  scene.add(mesh);
  pulses.add({ mesh, age: 0, life, color: color.clone(), scale, inward });
}

function tintMaterials(mesh: Object3D, color?: Color, intensity = 1) {
  const materials = mesh.userData.materials as MeshBasicMaterial[] | undefined;
  for (const material of materials ?? []) {
    const base = material.userData.baseColor as Color | undefined;
    material.color.copy(color ? color.clone().multiplyScalar(intensity) : base ?? PALETTE.arc);
  }
}

export function updateVisuals(
  dt: number,
  context: { scene: Scene; camera: Camera; feel: CameraFeelRig; elapsed: number; runTime: number; running: boolean },
) {
  elapsedNow = context.elapsed;
  runTimeNow = context.runTime;
  beatEnergy = Math.max(0, beatEnergy - dt * 4.2);
  environment?.update(dt, runTimeNow, context.running, beatEnergy, context.camera);
  context.feel.setFovOffset(context.running ? beatEnergy * 1.25 + Math.min(3.4, runTimeNow / 24) : beatEnergy * 0.5);
  if (context.running && interlocksDestroyed === 4 && !chargeFailed && runTimeNow >= MASS_DRIVER_9281_MARKERS.muzzle) {
    const release = Math.min(1, (runTimeNow - MASS_DRIVER_9281_MARKERS.muzzle) / 4);
    context.feel.setFovOffset(release * 11, { response: 4.5 });
  }

  for (const record of enemies.values()) {
    const age = elapsedNow - record.bornAt;
    const intro = Math.min(1, age / (record.kind === 'interlock' ? 0.7 : 0.26));
    const denied = (record.mesh.userData.deniedUntil as number | undefined ?? -1) > elapsedNow;
    const flashing = (record.mesh.userData.flashUntil as number | undefined ?? -1) > elapsedNow;
    const justFired = (record.mesh.userData.justFiredUntil as number | undefined ?? -1) > runTimeNow;
    const telegraph = record.kind === 'sentinel' ? Number(record.mesh.userData.telegraph ?? 0) : 0;
    const pulseScale = record.locked ? 1 + Math.sin(elapsedNow * 14) * 0.065 : 1;
    const deniedScale = denied ? 1 + Math.sin(elapsedNow * 42) * 0.1 : 1;
    const stageScale = record.kind === 'interlock' ? 1.45 : record.kind === 'bolt' ? 1.22 : 1;
    const chargeScale = 1 + telegraph * 0.12 + (justFired ? Math.sin(runTimeNow * 52) * 0.055 : 0);
    record.mesh.scale.setScalar((intro * intro * (3 - 2 * intro)) * pulseScale * deniedScale * stageScale * chargeScale);

    if (record.kind === 'interlock' && record.mesh.userData.armed && !record.mesh.userData.armedSeen) {
      record.mesh.userData.armedSeen = true;
      pulse(context.scene, record.mesh.position, PALETTE.white, 3.6, 0.42, true);
      context.feel.kickFov(1.1, { decay: 5 });
    }

    if (record.mesh.userData.failed) tintMaterials(record.mesh, PALETTE.warning, 2.35);
    else if (denied) tintMaterials(record.mesh, PALETTE.warning, 2.2);
    else if (flashing) tintMaterials(record.mesh, PALETTE.white, 2.5);
    else if (justFired) tintMaterials(record.mesh, PALETTE.white, 2.25);
    else if (telegraph > 0) tintMaterials(record.mesh, PALETTE.arc.clone().lerp(PALETTE.white, telegraph), 1.3 + telegraph);
    else if (record.kind === 'interlock' && !record.mesh.userData.armed) tintMaterials(record.mesh, PALETTE.dormant, 0.72);
    else if (!record.locked) tintMaterials(record.mesh);

    const rotors = record.mesh.userData.rotors as Object3D[] | undefined;
    rotors?.forEach((rotor, index) => {
      rotor.rotation.z += dt * (1.4 + index * 0.7) * (record.locked ? 2.1 : 1) * (1 + telegraph * 4.5);
      if (record.kind === 'sentinel') rotor.scale.setScalar(1 + telegraph * 0.22);
    });
    const flex = record.mesh.userData.flexParts as Object3D[] | undefined;
    flex?.forEach((part, index) => { part.rotation.y = Math.sin(elapsedNow * 4 + index * Math.PI) * 0.18; });
  }

  for (const projectile of projectiles.values()) projectile.rotateZ(dt * 12);
  if (reticleRef) {
    const rotors = reticleRef.userData.rotors as Object3D[] | undefined;
    rotors?.forEach((rotor, index) => { rotor.rotation.z += dt * (index === 0 ? 0.8 : -0.52) * (reticleRef?.userData.active ? 2.3 : 1); });
  }
  pulses.update(dt, context);
}
