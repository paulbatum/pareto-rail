import type { Object3D, PerspectiveCamera, Scene } from 'three';
import type { EventBus } from '../events';
import type { Hud } from '../ui/hud';

export type LevelAudio = {
  start(): Promise<void>;
  installGestureStart(): void;
  setMasterVolume(volume: number): void;
  getMasterVolume(): number;
  suspend(): Promise<void>;
  dispose(): void;
};

export type LevelRuntime = {
  update(dt: number, elapsed: number): void;
  dispose(): void;
};

export type LevelContext = {
  scene: Scene;
  camera: PerspectiveCamera;
  canvas: HTMLCanvasElement;
  bus: EventBus;
  hud: Hud;
  onPause: () => void;
  onFullscreen: () => void;
  startTip: string;
  debugValue?: string;
};

export type LevelPostConfig = {
  clearColor?: number;
  bloom?: {
    strength?: number;
    threshold?: number;
    radius?: number;
  };
  vignette?: {
    inner?: number;
    outer?: number;
    strength?: number;
  } | false;
};

export type LevelDebugSelector = {
  queryParam: string;
  label: string;
  options: Array<{ id: string; title: string }>;
};

export type LevelDefinition = {
  id: string;
  title: string;
  description: string;
  aliases?: string[];
  debugOnly?: boolean;
  debugSelector?: LevelDebugSelector;
  post?: LevelPostConfig;
  createAudio(bus: EventBus): LevelAudio;
  createRuntime(context: LevelContext): LevelRuntime;
};

export type VisualFactories = {
  createEnemyMesh(kind: string, letter?: string): Object3D;
  setEnemyLocked(mesh: Object3D, locked: boolean, lockCount?: number): void;
  setEnemyDenied(mesh: Object3D): void;
  createProjectileMesh(): Object3D;
  createReticle(): Object3D;
  setReticleActive(reticle: Object3D, active: boolean, lockCount: number): void;
};
