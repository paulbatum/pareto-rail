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
  Vector3,
  type Camera,
} from 'three';
import { additiveMaterialParameters } from '../../../engine/visual-kit';
import type { EventBus } from '../../../events';
import {
  createBoltMesh,
  createBomberMesh,
  createCorePowerMesh,
  createShieldGenMesh,
  createSkiffMesh,
  createTurretMesh,
} from './enemies';
import { createEffects, type EffectsSystem } from './effects';
import { createEnvironment, type Environment } from './environment';
import { createLetterMesh, setLetterDenied, setLetterLocked } from './letters';
import {
  CRIMSON_FIRE,
  CYAN_BEAM,
  CYAN_FIRE,
  CYAN_GLOW,
  DENY_CRIMSON,
  hdr,
  LOCK_GRADIENT,
  MOLTEN_ORANGE,
  RETICLE_CYAN,
  RETICLE_LOCKED,
} from './palette';

let activeEnvironment: Environment | null = null;
let activeEffects: EffectsSystem | null = null;

export function createEnvironmentInternal(scene: Scene): Environment {
  if (activeEnvironment) activeEnvironment.dispose();
  activeEnvironment = createEnvironment(scene);
  return activeEnvironment;
}

export { createEnvironmentInternal as createEnvironment };

export function installVisualEventHandlers(bus: EventBus, scene: Scene) {
  if (activeEffects) activeEffects.reset();
  activeEffects = createEffects(scene);

  const enemyKinds = new Map<number, string>();

  bus.on('spawn', ({ enemyId, kind }) => {
    enemyKinds.set(enemyId, kind);
  });

  bus.on('kill', ({ enemyId, worldPosition }) => {
    if (worldPosition && activeEffects) {
      const kind = enemyKinds.get(enemyId);
      const isBoss = kind === 'shield-gen' || kind === 'core-power';
      activeEffects.spawnExplosion(worldPosition, isBoss);
    }
    enemyKinds.delete(enemyId);
  });

  bus.on('hit', ({ worldPosition }) => {
    if (worldPosition && activeEffects) {
      activeEffects.spawnShockwave(worldPosition, CYAN_FIRE, 2.5);
    }
  });

  bus.on('stage', ({ worldPosition }) => {
    if (worldPosition && activeEffects) {
      activeEffects.spawnExplosion(worldPosition, true);
    }
  });

  bus.on('beat', ({ beatNumber }) => {
    if (!activeEffects) return;
    // Capital ship broadside salvo simulation on alternate beats
    if (beatNumber % 2 === 0) {
      // Friendly cruiser broadside from right flank across to left
      const fromY = 15 + (beatNumber % 4) * 8;
      const fromZ = -400 - (beatNumber % 6) * 120;
      activeEffects.spawnBroadsideBeam(
        new Vector3(30, fromY, fromZ),
        new Vector3(-200, fromY + 40, fromZ - 300),
        CYAN_BEAM,
      );
    } else {
      // Enemy crimson return fire
      const fromZ = -900 - (beatNumber % 5) * 150;
      activeEffects.spawnBroadsideBeam(
        new Vector3(180, -30, fromZ - 200),
        new Vector3(-40, 20, fromZ + 200),
        CRIMSON_FIRE,
      );
    }
  });
}

export function updateVisuals(camera: Camera, time: number, dt: number) {
  if (activeEnvironment) activeEnvironment.update(camera, time, dt);
  if (activeEffects) activeEffects.update(dt);
}

export function disposeVisuals() {
  if (activeEnvironment) {
    activeEnvironment.dispose();
    activeEnvironment = null;
  }
  if (activeEffects) {
    activeEffects.reset();
    activeEffects = null;
  }
}

// ---- Enemy Mesh Creation --------------------------------------------------

export function createEnemyMesh(kind: string, letter?: string): Object3D {
  if (kind === 'letter' || letter) {
    return createLetterMesh(letter ?? 'A');
  }

  switch (kind) {
    case 'skiff':
      return createSkiffMesh();
    case 'bomber':
      return createBomberMesh();
    case 'turret':
      return createTurretMesh();
    case 'shield-gen':
      return createShieldGenMesh();
    case 'core-power':
      return createCorePowerMesh();
    case 'bolt':
      return createBoltMesh();
    default:
      return createSkiffMesh();
  }
}

export function setEnemyLocked(mesh: Object3D, locked: boolean) {
  if (mesh.userData.isLetter) {
    setLetterLocked(mesh as Group, locked);
    return;
  }

  mesh.scale.setScalar(locked ? 1.2 : 1.0);
  const kind = mesh.userData.kind;
  if (kind === 'turret' && mesh.userData.turretHousing) {
    (mesh.userData.turretHousing as Object3D).scale.setScalar(locked ? 1.25 : 1.0);
  }
}

export function setEnemyDenied(mesh: Object3D) {
  if (mesh.userData.isLetter) {
    setLetterDenied(mesh as Group, true);
    return;
  }
  mesh.scale.setScalar(0.85);
}

// ---- Projectile Mesh (Player Homing Laser / Torpedo) -----------------------

export function createProjectileMesh(): Object3D {
  const group = new Group();

  // Cyan needle torpedo
  const coneGeom = new ConeGeometry(0.18, 1.4, 6);
  coneGeom.rotateX(Math.PI / 2);
  const coneMat = new MeshBasicMaterial(additiveMaterialParameters({
    color: CYAN_FIRE,
    depthWrite: false,
  }));
  const coneMesh = new Mesh(coneGeom, coneMat);
  group.add(coneMesh);

  // Trailing energy core
  const auraGeom = new SphereGeometry(0.35, 6, 4);
  const auraMat = new MeshBasicMaterial(additiveMaterialParameters({
    color: CYAN_GLOW,
    depthWrite: false,
    transparent: true,
    opacity: 0.6,
  }));
  const auraMesh = new Mesh(auraGeom, auraMat);
  group.add(auraMesh);

  return group;
}

// ---- Targeting Reticle ----------------------------------------------------

export function createReticle(): Object3D {
  const group = new Group();

  // Outer segmented ring
  const outerGeom = new RingGeometry(0.55, 0.62, 32);
  const outerMat = new MeshBasicMaterial(additiveMaterialParameters({
    color: RETICLE_CYAN,
    side: DoubleSide,
    depthWrite: false,
  }));
  const outerMesh = new Mesh(outerGeom, outerMat);
  group.add(outerMesh);

  // Inner targeting crosshair pips
  const innerGeom = new RingGeometry(0.25, 0.28, 4);
  const innerMat = new MeshBasicMaterial(additiveMaterialParameters({
    color: RETICLE_CYAN,
    side: DoubleSide,
    depthWrite: false,
  }));
  const innerMesh = new Mesh(innerGeom, innerMat);
  innerMesh.rotation.z = Math.PI / 4;
  group.add(innerMesh);

  group.userData.outerMesh = outerMesh;
  group.userData.innerMesh = innerMesh;
  group.userData.outerMat = outerMat;
  group.userData.innerMat = innerMat;

  return group;
}

export function setReticleActive(reticle: Object3D, active: boolean, lockCount: number) {
  reticle.visible = true;

  const outerMesh = reticle.userData.outerMesh as Mesh | undefined;
  const innerMesh = reticle.userData.innerMesh as Mesh | undefined;
  const outerMat = reticle.userData.outerMat as MeshBasicMaterial | undefined;
  const innerMat = reticle.userData.innerMat as MeshBasicMaterial | undefined;

  const scale = 1.0 + lockCount * 0.08 + (active ? 0.15 : 0);
  reticle.scale.setScalar(scale);

  if (innerMesh) {
    innerMesh.rotation.z += 0.03 + lockCount * 0.01;
  }

  const targetColor = lockCount >= 6 ? RETICLE_LOCKED : lockCount > 0 ? LOCK_GRADIENT[Math.min(LOCK_GRADIENT.length - 1, lockCount)] : RETICLE_CYAN;
  if (outerMat) outerMat.color.copy(targetColor);
  if (innerMat) innerMat.color.copy(targetColor);
}
