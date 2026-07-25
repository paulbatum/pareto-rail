import {
  Object3D,
  Scene,
  Vector3,
  type PerspectiveCamera,
} from 'three';
import type { EventBus } from '../../../events';
import { thermalState } from '../thermal-state';
import {
  inkBlackoutUniform,
  thermalModeUniform,
  thermalSwitchUniform,
} from '../post';
import {
  installEffectHandlers,
  rejectVisualEnergy,
  resetVisualEffects,
  updateVisualEffects,
  visualImpactEnergy,
} from './effects';
import {
  createHarborEnvironment,
  updateHarborEnvironment,
} from './environment';
import {
  resetThermalMaterials,
  updateThermalMaterials,
} from './materials';
import {
  animateTargetModel,
  createArmTarget,
  createBoilerSpawnTarget,
  createCableEelTarget,
  createCoreTarget,
  createIndustrialReticle,
  createInkCloudTarget,
  createLetterTarget,
  createProjectile,
  createScavengerTarget,
  denyTarget,
  setTargetLocked,
} from './models';

let infraredBlend = 0;
let currentScene: Scene | null = null;

export function createEnvironment(scene: Scene) {
  currentScene = scene;
  resetThermalMaterials();
  resetVisualEffects(scene);
  infraredBlend = 0;
  createHarborEnvironment(scene);
}

export function installVisualEventHandlers(bus: EventBus, scene: Scene) {
  installEffectHandlers(bus, scene);
}

export function createEnemyMesh(kind: string, letter?: string) {
  switch (kind) {
    case 'letter':
      return createLetterTarget(letter ?? 'A');
    case 'arm':
      return createArmTarget();
    case 'scavenger':
      return createScavengerTarget();
    case 'cable-eel':
      return createCableEelTarget();
    case 'boiler-spawn':
      return createBoilerSpawnTarget();
    case 'ink-cloud':
      return createInkCloudTarget();
    case 'core':
      return createCoreTarget();
    default:
      return createScavengerTarget();
  }
}

export function setEnemyLocked(mesh: Object3D, locked: boolean) {
  setTargetLocked(mesh, locked);
}

export function setEnemyDenied(mesh: Object3D) {
  denyTarget(mesh);
}

export function createProjectileMesh() {
  return createProjectile();
}

export function createReticle() {
  return createIndustrialReticle();
}

export function setReticleActive(reticle: Object3D, active: boolean, lockCount: number) {
  reticle.visible = true;
  reticle.userData.active = active;
  reticle.userData.lockCount = lockCount;
  reticle.rotation.z += active ? 0.035 + lockCount * 0.006 : 0.008;
  const targetScale = 1 + (active ? 0.06 : 0) + lockCount * 0.022;
  reticle.scale.lerp(new Vector3(targetScale, targetScale, targetScale), 0.28);
  reticle.traverse((child) => {
    if (child.userData.reticleInner) {
      child.rotation.z -= active ? 0.08 : 0.02;
      child.scale.setScalar(1 + Math.sin(reticle.rotation.z * 3.7) * 0.05);
    }
    if (child.userData.thermalSensor) {
      child.scale.setScalar(thermalState().infrared ? 2.1 : 1);
    }
  });
}

export function updateVisuals(
  dt: number,
  context: {
    scene: Scene;
    camera: PerspectiveCamera;
    elapsed: number;
    runTime: number;
    running: boolean;
  },
) {
  const state = thermalState();
  const targetInfrared = state.infrared ? 1 : 0;
  const response = 1 - Math.exp(-dt * 9.5);
  infraredBlend += (targetInfrared - infraredBlend) * response;

  thermalModeUniform.value = infraredBlend;
  inkBlackoutUniform.value = state.inkDensity;
  thermalSwitchUniform.value = Math.max(
    state.switchPulse,
    visualImpactEnergy() * (state.infrared ? 0.52 : 0.18),
    rejectVisualEnergy() * 0.16,
  );
  updateThermalMaterials(infraredBlend, state.inkDensity);
  updateHarborEnvironment(
    dt,
    context.elapsed,
    context.runTime,
    infraredBlend,
    state.inkDensity,
    context.camera,
  );
  updateVisualEffects(dt, context.camera);

  for (const child of context.scene.children) {
    if (child.userData.raildRole !== 'target') continue;
    animateTargetModel(child, dt, context.elapsed);
  }
}

export function disposeVisuals() {
  if (currentScene) resetVisualEffects(currentScene);
  currentScene = null;
}

// Explicit model exports are useful for the repository's isolated snapshot
// tool during visual iteration.
export const createThermalArmModel = createArmTarget;
export const createThermalScavengerModel = createScavengerTarget;
export const createThermalCableEelModel = createCableEelTarget;
export const createThermalBoilerModel = createBoilerSpawnTarget;
export const createThermalCoreModel = createCoreTarget;
