import { Group, Mesh, MeshBasicMaterial, Object3D, PerspectiveCamera, Scene, SphereGeometry, Vector3 } from 'three';
import type { EventBus } from '../../../events';
import type { CameraFeelRig } from '../../../engine/camera-feel';
import { createWorktableEnvironment, type WorktableEnvironment } from './table';
import { createRollingBall, type RollingBallController } from './ball';
import {
  createEnemyMesh,
  createGlueBlobMesh,
  createProjectileMesh,
  createReticle,
} from './enemies';

export { createEnemyMesh, createProjectileMesh, createReticle };

let activeEnvironment: WorktableEnvironment | undefined;
let activeBall: RollingBallController | undefined;

// Active transient debris scattered on floor awaiting ball pickup
type LooseDebris = {
  mesh: Mesh;
  type: 'button' | 'pin' | 'spool' | 'eraser' | 'ruler';
  position: Vector3;
  spawnTime: number;
};
const looseDebrisList: LooseDebris[] = [];

export function createEnvironment(scene: Scene): void {
  activeEnvironment = createWorktableEnvironment(scene);
  activeBall = createRollingBall(scene);
  looseDebrisList.length = 0;
}

export function getRollingBallController(): RollingBallController | undefined {
  return activeBall;
}

export function setEnemyLocked(mesh: Object3D, locked: boolean): void {
  mesh.scale.setScalar(locked ? 1.3 : 1.0);
}

export function setEnemyDenied(mesh: Object3D): void {
  mesh.scale.setScalar(0.7);
  mesh.rotation.z += 0.4;
}

export function setReticleActive(reticle: Object3D, active: boolean, lockCount: number): void {
  reticle.visible = true;
  const scale = 1.0 + lockCount * 0.08 + (active ? 0.15 : 0);
  reticle.scale.setScalar(scale);
}

export function installVisualEventHandlers(bus: EventBus, scene: Scene): void {
  bus.on('kill', ({ worldPosition }) => {
    // Spawn 3-5 loose debris items scattering on floor when an enemy core breaks
    const types: Array<'button' | 'pin' | 'spool' | 'eraser' | 'ruler'> = [
      'button',
      'pin',
      'spool',
      'eraser',
      'ruler',
    ];
    const count = 3 + Math.floor(Math.random() * 3);

    for (let i = 0; i < count; i++) {
      const type = types[Math.floor(Math.random() * types.length)];
      const mesh = new Mesh(
        new SphereGeometry(0.12, 8, 6),
        new MeshBasicMaterial({ color: 0xfacc15 }),
      );
      const scatterPos = worldPosition
        .clone()
        .add(
          new Vector3(
            (Math.random() - 0.5) * 3,
            -worldPosition.y - 2.8,
            (Math.random() - 0.5) * 3,
          ),
        );
      mesh.position.copy(scatterPos);
      scene.add(mesh);
      looseDebrisList.push({ mesh, type, position: scatterPos, spawnTime: Date.now() });
    }
  });

  bus.on('stage', ({ worldPosition }) => {
    bus.emit('kill', { enemyId: -1, worldPosition, scoreAwarded: 100 });
  });

  bus.on('reject', () => {
    // Reject flash
  });
}

export type UpdateVisualsContext = {
  scene: Scene;
  camera: PerspectiveCamera;
  feel: CameraFeelRig;
  elapsed: number;
  runProgress: number;
  railPosition: Vector3;
  prevRailPosition: Vector3;
  ballScaleRadius: number;
};

export function updateVisuals(dt: number, ctx: UpdateVisualsContext): void {
  if (activeEnvironment) {
    activeEnvironment.update(dt, ctx.elapsed);
  }

  if (activeBall) {
    activeBall.setTargetScale(ctx.ballScaleRadius);
    activeBall.update(dt, ctx.railPosition, ctx.prevRailPosition);

    // Check collision between rolling ball and loose floor debris
    for (let i = looseDebrisList.length - 1; i >= 0; i--) {
      const debris = looseDebrisList[i];
      const dist = ctx.railPosition.distanceTo(debris.position);
      if (dist < ctx.ballScaleRadius * 3.5) {
        activeBall.attachDebris(debris.type);
        ctx.scene.remove(debris.mesh);
        looseDebrisList.splice(i, 1);
      } else if (Date.now() - debris.spawnTime > 15000) {
        ctx.scene.remove(debris.mesh);
        looseDebrisList.splice(i, 1);
      }
    }
  }
}
