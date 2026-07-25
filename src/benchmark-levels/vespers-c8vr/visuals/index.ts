import {
  BoxGeometry,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  RingGeometry,
  Scene,
  SphereGeometry,
  Vector3,
} from 'three';
import type { Object3D } from 'three';
import type { EventBus } from '../../../events';
import { CathedralEnvironment } from './environment';
import { createEnemyMesh as buildEnemyMesh, setEnemyDenied as applyEnemyDenied, setEnemyLocked as applyEnemyLocked } from './enemies';
import { createLetterMesh } from './letters';

let activeEnv: CathedralEnvironment | null = null;

export function createEnvironment(scene: Scene): CathedralEnvironment {
  activeEnv = new CathedralEnvironment(scene);
  return activeEnv;
}

export function installVisualEventHandlers(bus: EventBus, _scene: Scene) {
  bus.on('kill', (e) => {
    if (activeEnv) {
      const pos = e.worldPosition ?? new Vector3(0, 0, -50);
      activeEnv.restoreNearestWindow(pos);
    }
  });

  bus.on('runend', (e) => {
    if (activeEnv && !e.died) {
      activeEnv.igniteRoseWindow();
    }
  });
}

export function createEnemyMesh(kind: string, letter?: string): Object3D {
  if (kind === 'letter' || letter) {
    return createLetterMesh(letter ?? 'A');
  }
  return buildEnemyMesh(kind, letter);
}

export function setEnemyLocked(mesh: Object3D, locked: boolean) {
  applyEnemyLocked(mesh, locked);
}

export function setEnemyDenied(mesh: Object3D) {
  applyEnemyDenied(mesh);
}

export function createProjectileMesh(): Object3D {
  const group = new Group();

  // Dark Stained-Glass Shard Projectile
  const shardGeo = new BoxGeometry(0.2, 0.2, 0.6);
  const shardMat = new MeshBasicMaterial({ color: 0xff0d33 }); // Blood red shard
  const shard = new Mesh(shardGeo, shardMat);
  group.add(shard);

  const coreGeo = new SphereGeometry(0.12, 6, 6);
  const coreMat = new MeshBasicMaterial({ color: 0xffffff });
  group.add(new Mesh(coreGeo, coreMat));

  return group;
}

export function createReticle(): Object3D {
  const group = new Group();

  // Outer Gothic Traceried Rose Ring (matching 0.085 NDC lock radius in world units!)
  const ringGeo = new RingGeometry(0.55, 0.62, 32);
  const ringMat = new MeshBasicMaterial({
    color: 0xffaa00,
    side: DoubleSide,
    transparent: true,
    opacity: 0.9,
  });
  const ring = new Mesh(ringGeo, ringMat);
  group.add(ring);

  // Inner Crosshair Accents
  const dotGeo = new SphereGeometry(0.06, 8, 8);
  const dotMat = new MeshBasicMaterial({ color: 0x0033ff });

  const topDot = new Mesh(dotGeo, dotMat);
  topDot.position.set(0, 0.58, 0);
  group.add(topDot);

  const bottomDot = new Mesh(dotGeo, dotMat);
  bottomDot.position.set(0, -0.58, 0);
  group.add(bottomDot);

  const leftDot = new Mesh(dotGeo, dotMat);
  leftDot.position.set(-0.58, 0, 0);
  group.add(leftDot);

  const rightDot = new Mesh(dotGeo, dotMat);
  rightDot.position.set(0.58, 0, 0);
  group.add(rightDot);

  return group;
}

export function setReticleActive(reticle: Object3D, active: boolean, lockCount: number) {
  reticle.visible = true;
  const baseScale = 1.0 + lockCount * 0.04 + (active ? 0.08 : 0);
  reticle.scale.setScalar(baseScale);
}
