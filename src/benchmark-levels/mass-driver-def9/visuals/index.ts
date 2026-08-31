import {
  CircleGeometry,
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
  TorusGeometry,
  Vector3,
} from 'three';
import type { Camera, Color, Quaternion } from 'three';
import type { CameraFeelRig, CameraFeelShakeOptions } from '../../../engine/camera-feel';
import {
  createAdditiveBasicMaterial,
  createPendingVisualRecords,
  disposeObject3D,
} from '../../../engine/visual-kit';
import type { EventBus } from '../../../events';
import {
  MASS_DRIVER_DEF9_INTERLOCK_COUNT,
  MASS_DRIVER_DEF9_RUN_DURATION,
  createMassDriverDef9Rail,
  massDriverDef9RunProgress,
  speedFactorAt,
} from '../gameplay';
import { MASS_DRIVER_DEF9_BARS, MASS_DRIVER_DEF9_TIME } from '../timing';
import {
  createArcboltMesh,
  createInterlockMesh,
  createProjectileMeshInternal,
  createSentinelMesh,
  createSkimmerMesh,
  createWeaverMesh,
  type DriverTintPart,
} from './enemies';
import { createEnvironmentInternal, updateEnvironment, type DriverEnvironment } from './environment';
import { createEffects, disposeEffects, resetEffects, spawnBurst, spawnShockRing, updateEffects } from './effects';
import { createLetterMesh, setLetterDenied, setLetterLocked } from './letters';
import {
  ARC_BLUE,
  BARREL,
  BARREL_EDGE,
  CHARGE_WHITE,
  COIL_VIOLET,
  DENIED,
  DRONE_FILL,
  ION_CYAN,
  WARNING,
  chargeColor,
  hdr,
} from './palette';

export type DriverVisualContext = {
  scene: Scene;
  camera: Camera;
  elapsed: number;
  runTime: number;
  running: boolean;
  feel: CameraFeelRig;
};

export type DriverCameraContext = {
  camera: PerspectiveCamera;
  runTime: number;
  running: boolean;
  feel: CameraFeelRig;
};

type EnemyRecord = {
  mesh: Group;
  bornAt: number | null;
};

type ProjectileRecord = {
  mesh: Group;
  nextTrailAt: number;
};

const SHAKE: CameraFeelShakeOptions = {
  decay: 2.9,
  maxTrauma: 1.8,
  pitchDegrees: 0.32,
  yawDegrees: 0.28,
  rollDegrees: 0.82,
  frequency: 10.5,
  smoothing: 22,
};

const enemyRecords = createPendingVisualRecords<Group, EnemyRecord>({
  createRecord: (mesh) => ({ mesh, bornAt: null }),
  disposeRecord: (record) => disposeObject3D(record.mesh),
});

const projectileRecords = createPendingVisualRecords<ProjectileRecord, ProjectileRecord>({
  createRecord: (record) => record,
  disposeRecord: (record) => disposeObject3D(record.mesh),
});

const rail = createMassDriverDef9Rail();
const cameraForward = new Vector3();
const effectPosition = new Vector3();
let environment: DriverEnvironment | null = null;
let elapsedNow = 0;
let beatEnergy = 0;
let launchPulse = 0;
let launchCleared = false;
let barrelFailed = false;
let interlocksDestroyed = 0;
let lastRunTime = -1;
let reticleRef: Group | null = null;

export function createEnvironment(scene: Scene) {
  environment?.dispose();
  environment = createEnvironmentInternal(scene);
  createEffects(scene);
  return environment.root;
}

export function createEnemyMesh(kind: string, letter?: string) {
  const mesh = buildEnemyMesh(kind, letter);
  mesh.userData.kind = kind;
  if (!mesh.userData.isLetter && kind !== 'charge') attachLockHalo(mesh);
  mesh.scale.setScalar(0.001);
  enemyRecords.enqueue(mesh);
  return mesh;
}

function buildEnemyMesh(kind: string, letter?: string) {
  switch (kind) {
    case 'letter':
      return createLetterMesh(letter ?? 'A');
    case 'skimmer':
      return createSkimmerMesh();
    case 'weaver':
      return createWeaverMesh();
    case 'sentinel':
      return createSentinelMesh();
    case 'arcbolt':
      return createArcboltMesh();
    case 'interlock':
      return createInterlockMesh();
    case 'charge':
      return new Group();
    default:
      return createSkimmerMesh();
  }
}

function attachLockHalo(mesh: Group) {
  const radius = (mesh.userData.targetRadius as number | undefined) ?? 1.8;
  const halo = new Mesh(
    new RingGeometry(radius * 1.12, radius * 1.18, 6),
    createAdditiveBasicMaterial({ color: hdr(ION_CYAN, 1.2), opacity: 0.92, side: DoubleSide }),
  );
  const inner = new Mesh(
    new RingGeometry(radius * 0.92, radius * 0.95, 36),
    createAdditiveBasicMaterial({ color: hdr(CHARGE_WHITE, 0.9), opacity: 0.72, side: DoubleSide }),
  );
  const haloGroup = new Group();
  haloGroup.add(halo, inner);
  haloGroup.visible = false;
  haloGroup.userData.materials = [halo.material, inner.material];
  mesh.add(haloGroup);
  mesh.userData.lockHalo = haloGroup;
}

export function setEnemyLocked(mesh: Object3D, locked: boolean, lockCount = 1) {
  mesh.userData.locked = locked;
  if (mesh.userData.isLetter) {
    setLetterLocked(mesh as Group, locked);
    return;
  }
  const halo = mesh.userData.lockHalo as Group | undefined;
  if (!halo) return;
  halo.visible = locked;
  const color = chargeColor(MathUtils.clamp(lockCount / 6, 0, 1));
  const materials = halo.userData.materials as MeshBasicMaterial[];
  for (const [index, material] of materials.entries()) material.color.copy(index === 0 ? color : CHARGE_WHITE);
}

export function setEnemyDenied(mesh: Object3D) {
  mesh.userData.deniedUntil = elapsedNow + 0.48;
  spawnShockRing(mesh.position, hdr(DENIED, 1.2), 0.7, 3.4, 0.32);
}

export function createProjectileMesh() {
  const mesh = createProjectileMeshInternal();
  projectileRecords.enqueue({ mesh, nextTrailAt: 0 });
  return mesh;
}

export function createReticle() {
  const group = new Group();
  const materials: MeshBasicMaterial[] = [];
  const add = (mesh: Mesh, color: Color) => {
    const material = mesh.material as MeshBasicMaterial;
    material.color.copy(color);
    material.transparent = true;
    material.depthWrite = false;
    material.side = DoubleSide;
    materials.push(material);
    group.add(mesh);
  };

  add(new Mesh(new RingGeometry(0.56, 0.61, 48), new MeshBasicMaterial()), hdr(ARC_BLUE, 1.15));
  add(new Mesh(new RingGeometry(0.31, 0.345, 12), new MeshBasicMaterial()), hdr(COIL_VIOLET, 1.0));

  const spinner = new Group();
  for (let index = 0; index < 6; index += 1) {
    const tick = new Mesh(new PlaneGeometry(0.18, 0.035), new MeshBasicMaterial());
    const angle = index / 6 * Math.PI * 2;
    tick.position.set(Math.cos(angle) * 0.78, Math.sin(angle) * 0.78, 0);
    tick.rotation.z = angle;
    const material = tick.material as MeshBasicMaterial;
    material.color.copy(hdr(index % 2 === 0 ? ION_CYAN : COIL_VIOLET, 1.0));
    material.transparent = true;
    material.depthWrite = false;
    materials.push(material);
    spinner.add(tick);
  }
  group.add(spinner);
  add(new Mesh(new CircleGeometry(0.045, 16), new MeshBasicMaterial()), hdr(CHARGE_WHITE, 1.45));
  group.userData.materials = materials;
  group.userData.spinner = spinner;
  group.userData.active = false;
  reticleRef = group;
  return group;
}

export function setReticleActive(reticle: Object3D, active: boolean, lockCount: number) {
  reticle.userData.active = active;
  reticle.scale.setScalar(1 + lockCount * 0.07 + (active ? 0.06 : 0));
  const color = lockCount > 0 ? chargeColor(lockCount / 6) : ARC_BLUE;
  const materials = reticle.userData.materials as MeshBasicMaterial[];
  for (const [index, material] of materials.entries()) {
    material.color.copy(index === materials.length - 1 ? CHARGE_WHITE : color).multiplyScalar(active ? 1.16 : 0.9);
  }
}

export function installVisualEventHandlers(bus: EventBus, camera: PerspectiveCamera, cameraFeel: CameraFeelRig) {
  bus.on('spawn', ({ enemyId, kind, worldPosition }) => {
    const record = enemyRecords.claim(enemyId);
    if (!record) return;
    if (kind === 'arcbolt') {
      spawnShockRing(worldPosition, hdr(COIL_VIOLET, 1.25), 0.3, 2.6, 0.45);
    } else if (kind === 'interlock') {
      spawnShockRing(worldPosition, hdr(WARNING, 1.05), 0.7, 4.6, 0.5);
    } else if (kind !== 'letter' && kind !== 'charge') {
      spawnShockRing(worldPosition, hdr(ARC_BLUE, 0.78), 0.35, 2.3, 0.34);
    }
  });

  bus.on('lock', ({ enemyId, worldPosition, lockCount }) => {
    const record = enemyRecords.get(enemyId);
    if (record) record.mesh.userData.locked = true;
    spawnShockRing(worldPosition, chargeColor(lockCount / 6), 0.3, 1.8 + lockCount * 0.18, 0.24);
    beatEnergy = Math.max(beatEnergy, 0.25 + lockCount * 0.06);
  });

  bus.on('unlock', ({ enemyId, worldPosition }) => {
    const record = enemyRecords.get(enemyId);
    if (record) record.mesh.userData.locked = false;
    spawnShockRing(worldPosition, hdr(ARC_BLUE, 0.55), 0.9, 0.25, 0.2);
  });

  bus.on('fire', ({ projectileId, worldPosition, volleySize }) => {
    projectileRecords.claim(projectileId);
    spawnShockRing(worldPosition, hdr(CHARGE_WHITE, 1.35), 0.25, 1.4 + volleySize * 0.13, 0.2);
    if (volleySize >= 5) cameraFeel.kickFov(1.4, { decay: 6 });
  });

  bus.on('hit', ({ enemyId, projectileId, worldPosition, lethal }) => {
    projectileRecords.delete(projectileId, { dispose: true });
    const record = enemyRecords.get(enemyId);
    if (record && !lethal) record.mesh.userData.damageUntil = elapsedNow + 0.22;
    spawnBurst(worldPosition, lethal ? CHARGE_WHITE : ION_CYAN, lethal ? 8 : 4, lethal ? 10 : 6, 0.42);
  });

  bus.on('stage', ({ enemyId, worldPosition, stageIndex }) => {
    const record = enemyRecords.get(enemyId);
    if (record) record.mesh.userData.stageIndex = stageIndex;
    spawnShockRing(worldPosition, hdr(CHARGE_WHITE, 1.45), 0.5, 6.4, 0.48);
    spawnShockRing(worldPosition, hdr(COIL_VIOLET, 1.1), 0.4, 3.7, 0.36);
    spawnBurst(worldPosition, COIL_VIOLET, 16, 13, 0.72);
    cameraFeel.shake(0.38, SHAKE);
  });

  bus.on('kill', ({ enemyId, worldPosition }) => {
    const record = enemyRecords.get(enemyId);
    const isInterlock = record?.mesh.userData.isInterlock === true;
    const accent = (record?.mesh.userData.accent as Color | undefined) ?? ION_CYAN;
    spawnShockRing(worldPosition, hdr(accent, isInterlock ? 1.45 : 0.95), 0.45, isInterlock ? 8.5 : 4.5, isInterlock ? 0.62 : 0.42);
    spawnBurst(worldPosition, isInterlock ? CHARGE_WHITE : accent, isInterlock ? 28 : 12, isInterlock ? 18 : 11, isInterlock ? 0.9 : 0.58);
    if (isInterlock) {
      interlocksDestroyed += 1;
      launchPulse = Math.max(launchPulse, 0.45 + ((interlocksDestroyed - 1) % MASS_DRIVER_DEF9_INTERLOCK_COUNT + 1) * 0.08);
      cameraFeel.shake(0.46, SHAKE);
    }
    enemyRecords.delete(enemyId, { dispose: true });
  });

  bus.on('miss', ({ enemyId, worldPosition }) => {
    const record = enemyRecords.get(enemyId);
    if (record) {
      const color = record.mesh.userData.isInterlock ? WARNING : BARREL;
      spawnBurst(worldPosition, color, 5, 4, 0.4);
      enemyRecords.delete(enemyId, { dispose: true });
    }
  });

  bus.on('reject', () => {
    beatEnergy = Math.max(beatEnergy, 0.8);
    cameraFeel.shake(0.18, SHAKE);
  });

  bus.on('volley', ({ size, kills }) => {
    if (size < 5 || kills !== size) return;
    beatEnergy = Math.max(beatEnergy, size === 6 ? 1.45 : 1.0);
    launchPulse = Math.max(launchPulse, 0.22);
    cameraFeel.shake(size === 6 ? 0.42 : 0.26, SHAKE);
  });

  bus.on('beat', ({ beatNumber, isDownbeat }) => {
    beatEnergy = Math.max(beatEnergy, isDownbeat ? 1 : 0.48);
    camera.getWorldDirection(cameraForward);
    effectPosition.copy(camera.position).addScaledVector(cameraForward, 7.5);
    spawnShockRing(
      effectPosition,
      chargeColor(MathUtils.clamp(beatNumber / 128, 0, 1)),
      isDownbeat ? 1.7 : 1.25,
      isDownbeat ? 18 : 13,
      isDownbeat ? 0.3 : 0.22,
    );
    if (isDownbeat) cameraFeel.kickFov(0.45 + speedFactorAt(Math.max(0, lastRunTime)) * 0.08, { decay: 9 });
  });

  bus.on('bossphase', ({ phase }) => {
    if (phase !== 'destroyed') return;
    launchCleared = true;
    launchPulse = 1.25;
    beatEnergy = 1.5;
    cameraFeel.shake(1.1, SHAKE);
    if (environment) {
      spawnShockRing(environment.muzzlePosition, hdr(ION_CYAN, 1.2), 1, 18, 0.38);
      spawnShockRing(environment.muzzlePosition, hdr(COIL_VIOLET, 1.0), 1, 12, 0.28);
    }
  });

  bus.on('playerhit', ({ damage, healthRemaining }) => {
    beatEnergy = 1.5;
    cameraFeel.shake(damage >= 4 ? 1.8 : 0.8, SHAKE);
    if (healthRemaining <= 0) {
      barrelFailed = true;
      launchPulse = 1.8;
      camera.getWorldDirection(cameraForward);
      effectPosition.copy(camera.position).addScaledVector(cameraForward, 5);
      spawnShockRing(effectPosition, hdr(CHARGE_WHITE, 2.0), 1, 42, 1.2);
      spawnBurst(effectPosition, CHARGE_WHITE, 54, 28, 1.15);
    }
  });

  bus.on('runstart', () => {
    resetEffects();
    enemyRecords.clear({ dispose: true, pending: true });
    projectileRecords.clear({ dispose: true, pending: true });
    launchCleared = false;
    barrelFailed = false;
    interlocksDestroyed = 0;
    beatEnergy = 0;
    launchPulse = 0;
    lastRunTime = -1;
    cameraFeel.restore();
  });

  bus.on('runend', () => {
    cameraFeel.restore();
  });
}

export function updateVisuals(dt: number, context: DriverVisualContext) {
  elapsedNow = context.elapsed;
  beatEnergy = Math.max(0, beatEnergy - dt * 4.8);
  launchPulse = Math.max(0, launchPulse - dt * 0.72);
  const runTime = context.running ? context.runTime : 0;

  if (environment) {
    updateEnvironment(environment, dt, {
      runTime,
      running: context.running,
      launchCleared,
      barrelFailed,
      beatEnergy,
      camera: context.camera,
    });
  }

  if (context.running && lastRunTime >= 0) {
    const launchTime = MASS_DRIVER_DEF9_TIME.bar(MASS_DRIVER_DEF9_BARS.launch);
    if (launchCleared && lastRunTime < launchTime && runTime >= launchTime) {
      launchPulse = 1.8;
      beatEnergy = 1.8;
      context.feel.kickFov(10, { decay: 1.4 });
      context.feel.shake(1.6, SHAKE);
      if (environment) {
        spawnShockRing(environment.muzzlePosition, hdr(CHARGE_WHITE, 1.35), 1, 34, 0.46);
        spawnBurst(environment.muzzlePosition, ION_CYAN, 30, 38, 0.72);
      }
    }
  }
  lastRunTime = context.running ? runTime : -1;

  for (const [enemyId, record] of enemyRecords.entries()) {
    if (!record.mesh.parent) {
      enemyRecords.delete(enemyId, { dispose: true });
      continue;
    }
    if (record.bornAt === null) record.bornAt = elapsedNow;
    const age = elapsedNow - record.bornAt;
    record.mesh.scale.setScalar(easeOutBack(Math.min(1, age / 0.34)));
    updateEnemyTint(record, context.camera);

    const spinParts = record.mesh.userData.spinParts as Mesh[] | undefined;
    if (spinParts) {
      for (const part of spinParts) part.rotation.z += dt * ((part.userData.spinSpeed as number | undefined) ?? 1.2);
    }

    const halo = record.mesh.userData.lockHalo as Group | undefined;
    if (halo?.visible) {
      faceChildTowardCamera(halo, record.mesh, context.camera.quaternion);
      halo.rotation.z += dt * 1.9;
      halo.scale.setScalar(1 + Math.sin(elapsedNow * 9) * 0.04);
    }

    if (record.mesh.userData.isInterlock) updateInterlockMesh(record.mesh, runTime);
    if (record.mesh.userData.isHostileShot && elapsedNow >= ((record.mesh.userData.nextTrailAt as number | undefined) ?? 0)) {
      record.mesh.userData.nextTrailAt = elapsedNow + 0.07;
      spawnShockRing(record.mesh.position, hdr(COIL_VIOLET, 0.65), 0.12, 0.55, 0.18);
    }
  }

  for (const [projectileId, record] of projectileRecords.entries()) {
    if (!record.mesh.parent) {
      projectileRecords.delete(projectileId, { dispose: true });
      continue;
    }
    if (elapsedNow >= record.nextTrailAt) {
      record.nextTrailAt = elapsedNow + 0.065;
      spawnShockRing(record.mesh.position, hdr(ION_CYAN, 0.62), 0.08, 0.42, 0.16);
    }
  }

  if (reticleRef) {
    const spinner = reticleRef.userData.spinner as Group;
    spinner.rotation.z += dt * (reticleRef.userData.active ? 3.8 : 0.75);
  }
  updateEffects(dt, context.camera);
}

export function updateCameraEffects(dt: number, context: DriverCameraContext) {
  const speed = context.running ? speedFactorAt(context.runTime) : 0.38;
  const speedFov = (speed - 0.38) * 3.2;
  context.feel.setFovOffset(speedFov + beatEnergy * 0.65 + launchPulse * 4.5, { response: 5.5 });
  if (context.running) {
    const u = massDriverDef9RunProgress(context.runTime, MASS_DRIVER_DEF9_RUN_DURATION);
    const tangent = rail.getTangentAt(MathUtils.clamp(u, 0, 1));
    const ahead = rail.getTangentAt(MathUtils.clamp(u + 0.006, 0, 1));
    context.camera.rotateZ(MathUtils.clamp((ahead.x - tangent.x) * 18, -0.1, 0.1));
  }
  context.feel.update(dt, { shake: SHAKE });
}

function updateEnemyTint(record: EnemyRecord, camera: Camera) {
  const denied = ((record.mesh.userData.deniedUntil as number | undefined) ?? -Infinity) > elapsedNow;
  if (record.mesh.userData.isLetter) {
    setLetterDenied(record.mesh, denied);
    return;
  }

  const parts = record.mesh.userData.parts as DriverTintPart[] | undefined;
  if (!parts) return;
  const distance = record.mesh.position.distanceTo(camera.position);
  const closeness = smoothstep(1 - MathUtils.clamp((distance - 12) / 45, 0, 1));
  const locked = record.mesh.userData.locked === true;
  const damaged = ((record.mesh.userData.damageUntil as number | undefined) ?? -Infinity) > elapsedNow;
  const stageIndex = (record.mesh.userData.stageIndex as number | undefined) ?? 0;

  for (const part of parts) {
    if (denied) {
      part.material.color.copy(part.kind === 'fill' ? DRONE_FILL.clone().lerp(DENIED, 0.28) : DENIED);
      continue;
    }
    if (damaged) {
      part.material.color.copy(hdr(CHARGE_WHITE, part.kind === 'fill' ? 0.45 : 1.45));
      continue;
    }
    if (locked) {
      part.material.color.copy(part.kind === 'fill' ? ARC_BLUE.clone().multiplyScalar(0.24) : hdr(CHARGE_WHITE, part.kind === 'core' ? 1.6 : 1.15));
      continue;
    }
    if (record.mesh.userData.isInterlock && stageIndex > 0) {
      part.material.color.copy(part.kind === 'fill' ? BARREL.clone().lerp(COIL_VIOLET, 0.34) : hdr(part.kind === 'core' ? CHARGE_WHITE : COIL_VIOLET, 1.18));
      continue;
    }
    if (record.mesh.userData.isInterlock && record.mesh.userData.exposed === false) {
      part.material.color.copy(
        part.kind === 'fill'
          ? BARREL.clone().multiplyScalar(0.72)
          : part.kind === 'core'
            ? WARNING.clone().multiplyScalar(0.42)
            : BARREL_EDGE.clone().multiplyScalar(0.62),
      );
      continue;
    }
    const dim = part.kind === 'fill' ? 0.55 + closeness * 0.45 : 0.62 + closeness * 0.38;
    part.material.color.copy(part.base).multiplyScalar(dim);
  }
}

function updateInterlockMesh(mesh: Group, runTime: number) {
  const charge = (mesh.userData.charge as number | undefined) ?? 0;
  const core = mesh.userData.interlockCore as Mesh;
  const seal = mesh.userData.interlockSeal as Mesh;
  const coreMaterial = core.material as MeshBasicMaterial;
  const sealMaterial = seal.material as MeshBasicMaterial;
  const exposed = mesh.userData.exposed !== false;
  const bankStage = (mesh.userData.bankStage as number | undefined) ?? 0;
  core.scale.setScalar(0.82 + charge * 0.45 + Math.sin(runTime * (5 + charge * 7)) * 0.08);
  coreMaterial.opacity = exposed ? 0.58 + charge * 0.35 : 0.16 + charge * 0.12;
  coreMaterial.color.copy(chargeColor((bankStage + 1) / 4));
  seal.rotation.z += 0.015 + charge * 0.025;
  sealMaterial.opacity = exposed ? 0.55 + charge * 0.4 : 0.18 + charge * 0.1;
  sealMaterial.color.copy(chargeColor((bankStage + 0.7) / 4)).multiplyScalar(0.82);
  if (((mesh.userData.stageIndex as number | undefined) ?? 0) > 0) {
    seal.scale.setScalar(1.22);
    sealMaterial.color.copy(hdr(CHARGE_WHITE, 1.25));
  }
}

function faceChildTowardCamera(child: Object3D, parent: Object3D, cameraQuaternion: Quaternion) {
  parent.getWorldQuaternion(child.quaternion);
  child.quaternion.invert().multiply(cameraQuaternion);
}

function easeOutBack(t: number) {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2;
}

function smoothstep(t: number) {
  return t * t * (3 - 2 * t);
}

export function disposeVisuals() {
  enemyRecords.clear({ dispose: true, pending: true });
  projectileRecords.clear({ dispose: true, pending: true });
  environment?.dispose();
  environment = null;
  disposeEffects();
  if (reticleRef) disposeObject3D(reticleRef);
  reticleRef = null;
}
