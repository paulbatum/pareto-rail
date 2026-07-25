import { Color, Group, MeshBasicMaterial, Object3D, Scene } from 'three';
import type { EventBus } from '../../../events';
import { createHarborEnvironment, type HarborEnvironment } from './environment';
import { createLetterMesh, setLetterDenied, setLetterLocked } from './letters';
import { createOctopusBoss, type OctopusBoss } from './octopus';
import {
  createHarborMineMesh,
  createScavengerMesh,
  createThermalProjectileMesh,
  createThermalReticle,
  updateReticleState,
} from './enemies';
import { inkUniform, irUniform } from './post-fx';

let currentEnv: HarborEnvironment | null = null;
let currentBoss: OctopusBoss | null = null;

export function createEnvironment(scene: Scene) {
  currentEnv = createHarborEnvironment(scene);
  currentBoss = createOctopusBoss();
  scene.add(currentBoss.group);
}

export function installVisualEventHandlers(bus: EventBus, _scene: Scene) {
  bus.on('hit', ({ enemyId: _id, lethal: _lethal }) => {
    // Punchy hit feedback
  });

  bus.on('kill', ({ enemyId: _id }) => {
    // Kill impact explosion / spark effect
  });

  bus.on('reject', () => {
    // Rejected release audio/visual feedback
  });
}

export function createEnemyMesh(kind: string, letter?: string): Object3D {
  if (kind === 'letter' || letter) return createLetterMesh(letter ?? 'A');
  if (kind === 'scavenger') return createScavengerMesh();
  if (kind === 'harbor_mine') return createHarborMineMesh();

  // Boss arm node / core target placeholder mesh
  const group = new Group();
  group.userData.kind = kind;
  return group;
}

export function setEnemyLocked(mesh: Object3D, locked: boolean) {
  if (mesh.userData.isLetter) {
    setLetterLocked(mesh as Group, locked);
    return;
  }
  mesh.scale.setScalar(locked ? 1.3 : 1.0);
}

export function setEnemyDenied(mesh: Object3D) {
  if (mesh.userData.isLetter) {
    setLetterDenied(mesh as Group);
    return;
  }
  mesh.scale.setScalar(0.75);
}

export function createProjectileMesh(): Object3D {
  return createThermalProjectileMesh();
}

export function createReticle(): Object3D {
  return createThermalReticle();
}

export function setReticleActive(reticle: Object3D, active: boolean, lockCount: number) {
  updateReticleState(reticle as Group, active, lockCount);
}

export function updateVisuals(
  dt: number,
  options: { elapsed: number; runTime: number; running: boolean; irActive: boolean; inkAmount: number; coreExposed: boolean },
) {
  const { elapsed, irActive, inkAmount, coreExposed } = options;

  // 1. Update uniforms for post-processing
  const targetIr = irActive ? 1.0 : 0.0;
  irUniform.value += (targetIr - irUniform.value) * Math.min(1.0, dt * 8.0);
  inkUniform.value += (inkAmount - inkUniform.value) * Math.min(1.0, dt * 6.0);

  // 2. Update Environment & Boss
  if (currentEnv) {
    currentEnv.update(elapsed, dt, inkUniform.value);
  }

  if (currentBoss) {
    currentBoss.update(elapsed, dt, irUniform.value, coreExposed);
  }
}
