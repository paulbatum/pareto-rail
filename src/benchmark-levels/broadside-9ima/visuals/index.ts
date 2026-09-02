import {
  BoxGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  RingGeometry,
  Scene,
  SphereGeometry,
  TorusGeometry,
  Vector3,
} from 'three';
import type { EventBus } from '../../../events';
import { createAdditiveBasicMaterial } from '../../../engine/visual-kit';
import {
  CRIMSON_FIRE,
  CYAN_BOLT,
  DENIED_RED,
  FRIENDLY_CYAN,
  FRIENDLY_CYAN_HOT,
  FRIENDLY_WHITE,
  hdr,
  LOCK_COLOR,
  MOLTEN_ORANGE_HOT,
  RETICLE_CYAN,
  SHIELD_CYAN,
} from './palette';
import { createLetterMesh, setLetterDenied, setLetterLocked } from './letters';
import {
  createBomberMesh,
  createDartMesh,
  createPlasmaMesh,
  createReactorCoreMesh,
  createShieldGenMesh,
  createTurretMesh,
} from './enemies';
import { createEffectsSystem, type EffectsSystem } from './effects';
import {
  createEnvironmentInternal,
  type BroadsideEnvironment,
} from './environment';
import { cyanFlashUniform, orangeFlashUniform, post } from './post-fx';

export { post };

let activeEnvironment: BroadsideEnvironment | null = null;
let activeEffects: EffectsSystem | null = null;
let currentScene: Scene | null = null;

export function createEnvironment(scene: Scene) {
  currentScene = scene;
  activeEffects = createEffectsSystem(scene);
  activeEnvironment = createEnvironmentInternal(scene);
  return activeEnvironment;
}

export function updateVisuals(dt: number, runTime: number, speedFactor = 1.0) {
  if (activeEnvironment) {
    activeEnvironment.update(dt, runTime, speedFactor);
  }
  if (activeEffects) {
    activeEffects.update(dt);
  }

  // Decay post flash uniforms
  cyanFlashUniform.value = Math.max(0, cyanFlashUniform.value - dt * 4.0);
  orangeFlashUniform.value = Math.max(0, orangeFlashUniform.value - dt * 3.0);
}

export function triggerBroadsideEffect(from: Vector3, to: Vector3) {
  if (activeEffects) {
    activeEffects.spawnBroadsideBeam(from, to, CYAN_BOLT, 2.2, 0.4);
    activeEffects.spawnFlash(from, 8, FRIENDLY_CYAN_HOT, 0.3);
  }
  if (activeEnvironment) {
    activeEnvironment.triggerBroadsideSalvo(0);
  }
  cyanFlashUniform.value = Math.min(1.0, cyanFlashUniform.value + 0.45);
}

export function triggerBossDestruction() {
  if (activeEnvironment) {
    activeEnvironment.triggerBossExplosion(1.0);
  }
  orangeFlashUniform.value = 1.0;
}

export function installVisualEventHandlers(bus: EventBus, scene: Scene) {
  bus.on('fire', ({ volleySize }) => {
    // Subtle cyan flash on release
    if (volleySize >= 4) {
      cyanFlashUniform.value = Math.min(0.8, cyanFlashUniform.value + 0.25);
    }
  });

  bus.on('hit', () => {
    // Hit flash
  });

  bus.on('kill', ({ worldPosition }) => {
    if (activeEffects && worldPosition) {
      activeEffects.spawnExplosion(worldPosition, 28, MOLTEN_ORANGE_HOT, 20);
      activeEffects.spawnShockwave(worldPosition, 8, 0.5, FRIENDLY_CYAN_HOT);
      activeEffects.spawnFlash(worldPosition, 4.5, MOLTEN_ORANGE_HOT, 0.2);
    }
  });

  bus.on('stage', ({ stageIndex }) => {
    // Shield generator or power core stage destruction
    orangeFlashUniform.value = Math.min(1.0, orangeFlashUniform.value + 0.4);
    if (activeEffects && currentScene) {
      activeEffects.spawnShockwave(new Vector3(0, 0, -1800), 40, 1.2, MOLTEN_ORANGE_HOT);
    }
  });

  bus.on('bossphase', ({ phase }) => {
    if (phase === 'exposed') {
      cyanFlashUniform.value = 0.8;
    } else if (phase === 'destroyed') {
      triggerBossDestruction();
    }
  });

  bus.on('reject', () => {
    orangeFlashUniform.value = 0.35;
  });

  bus.on('playerhit', () => {
    orangeFlashUniform.value = 0.6;
  });
}

export function createEnemyMesh(kind: string, letter?: string): Object3D {
  if (kind === 'letter' || letter) {
    return createLetterMesh(letter ?? 'L');
  }
  switch (kind) {
    case 'dart':
      return createDartMesh();
    case 'bomber':
      return createBomberMesh();
    case 'turret':
      return createTurretMesh();
    case 'shield':
      return createShieldGenMesh();
    case 'core':
      return createReactorCoreMesh();
    case 'plasma':
      return createPlasmaMesh();
    default:
      return createDartMesh();
  }
}

export function setEnemyLocked(mesh: Object3D, locked: boolean) {
  if (mesh.userData.isLetter) {
    setLetterLocked(mesh as Group, locked);
    return;
  }

  // Visual lock response for enemy models
  mesh.scale.setScalar(locked ? 1.28 : 1.0);

  // If locked, pulse accent
  if (mesh.userData.accent) {
    const accent = mesh.userData.accent as Color;
    if (locked) {
      accent.copy(LOCK_COLOR);
    } else {
      accent.copy(mesh.userData.kind === 'bomber' ? MOLTEN_ORANGE_HOT : CRIMSON_FIRE);
    }
  }
}

export function setEnemyDenied(mesh: Object3D) {
  if (mesh.userData.isLetter) {
    setLetterDenied(mesh as Group, true);
    return;
  }
  mesh.scale.setScalar(0.78);
  if (mesh.userData.accent) {
    (mesh.userData.accent as Color).copy(DENIED_RED);
  }
}

// Player homing cyan energy torpedo
const torpedoMat = createAdditiveBasicMaterial({ color: hdr(CYAN_BOLT, 2.5) });
const torpedoBodyMat = new MeshBasicMaterial({ color: FRIENDLY_WHITE });

export function createProjectileMesh(): Object3D {
  const root = new Group();
  root.userData.raildRole = 'projectile';
  root.userData.raildIgnoreOcclusion = true;

  const tipGeo = new SphereGeometry(0.24, 8, 8);
  const tip = new Mesh(tipGeo, torpedoMat);

  const tailGeo = new ConeGeometry(0.2, 0.8, 6);
  tailGeo.rotateX(-Math.PI / 2);
  tailGeo.translate(0, 0, 0.4);
  const tail = new Mesh(tailGeo, torpedoBodyMat);

  root.add(tip, tail);
  return root;
}

// Fighter cockpit targeting reticle
export function createReticle(): Object3D {
  const root = new Group();
  root.userData.raildRole = 'reticle';
  root.userData.raildIgnoreOcclusion = true;

  const reticleMat = createAdditiveBasicMaterial({ color: hdr(RETICLE_CYAN, 1.8) });

  // Outer segmented bracket ring
  const outerRing = new Mesh(new RingGeometry(0.55, 0.62, 32), reticleMat);

  // Inner crosshair ticks
  const tickGeo = new BoxGeometry(0.04, 0.22, 0.02);
  const topTick = new Mesh(tickGeo, reticleMat);
  topTick.position.y = 0.72;

  const btmTick = new Mesh(tickGeo, reticleMat);
  btmTick.position.y = -0.72;

  const lftTick = new Mesh(tickGeo, reticleMat);
  lftTick.rotation.z = Math.PI / 2;
  lftTick.position.x = -0.72;

  const rgtTick = new Mesh(tickGeo, reticleMat);
  rgtTick.rotation.z = Math.PI / 2;
  rgtTick.position.x = 0.72;

  root.add(outerRing, topTick, btmTick, lftTick, rgtTick);
  return root;
}

export function setReticleActive(reticle: Object3D, active: boolean, lockCount: number) {
  reticle.visible = true;
  const targetScale = 1.0 + lockCount * 0.08 + (active ? 0.12 : 0);
  reticle.scale.setScalar(targetScale);
  reticle.rotation.z += 0.015;
}
