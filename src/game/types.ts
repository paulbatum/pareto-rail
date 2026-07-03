import type { Object3D, Scene, PerspectiveCamera } from 'three';
import type { EnemyKind, EventBus } from '../events';
import type { Hud } from '../ui/hud';

export type VisualFactories = {
  createEnemyMesh(kind: EnemyKind, letter?: string): Object3D;
  setEnemyLocked(mesh: Object3D, locked: boolean): void;
  createProjectileMesh(): Object3D;
  createReticle(): Object3D;
  setReticleActive(reticle: Object3D, active: boolean, lockCount: number): void;
};

export type GameOptions = {
  scene: Scene;
  camera: PerspectiveCamera;
  canvas: HTMLCanvasElement;
  bus: EventBus;
  hud: Hud;
  visuals: VisualFactories;
  onPause: () => void;
};
