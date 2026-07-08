import type { Object3D, PerspectiveCamera, Scene } from 'three';
import type { CatmullRomCurve3 } from 'three';
import type { ActionSfxQuantizationSettings, ShotDelaySettings } from './action-sfx-quantization';
import type { VisualFactories } from './types';
import type { EventBus } from '../events';
import type { Hud } from '../ui/hud';

export type LockOnSpawnEntry<TKind extends string = string, TData = unknown> = {
  time: number;
  kind: TKind;
  data: TData;
  letter?: string;
  hitPoints?: number;
  hitStages?: number[];
  lockable?: boolean;
  countsTowardTotal?: boolean;
};

export type LockOnEnemy<TKind extends string = string, TData = unknown> = {
  id: number;
  kind: TKind;
  mesh: Object3D;
  spawnTime: number;
  entry: LockOnSpawnEntry<TKind, TData>;
  letter?: string;
  hitPointsRemaining: number;
  hitStageIndex: number;
  hitStageCount: number;
  stageHitPointsRemaining: number;
};

export type LockOnEnemyUpdate<TKind extends string = string, TData = unknown> = {
  enemy: LockOnEnemy<TKind, TData>;
  runTime: number;
  runProgress: number;
  age: number;
  curve: CatmullRomCurve3;
  camera: PerspectiveCamera;
  /** Eased rail progress where an enemy seats itself: ease(min(duration, entry.time + lead), duration). */
  railAnchor(lead: number): number;
  /** Lazily-initialized mutable state scoped to this enemy instance; created on first call, discarded when the enemy goes away. */
  enemyState<S>(init: () => S): S;
  spawnEnemy(entry: LockOnSpawnEntry<TKind, TData>): number;
  damagePlayer(amount?: number): void;
  playerHealth: number;
};

export type LockOnAttractCameraUpdate = {
  camera: PerspectiveCamera;
  curve: CatmullRomCurve3;
  modeTime: number;
  dt: number;
};

export type LockOnCameraEffectsUpdate = {
  camera: PerspectiveCamera;
  curve: CatmullRomCurve3;
  runTime: number;
  runProgress: number;
  dt: number;
};

export type LockOnRunnerLevel<TKind extends string = string, TData = unknown> = {
  duration: number;
  bpm: number;
  createRail(): CatmullRomCurve3;
  spawnTimeline: Array<LockOnSpawnEntry<TKind, TData>>;
  updateEnemy(context: LockOnEnemyUpdate<TKind, TData>): boolean | void;
  updateAttractCamera?(context: LockOnAttractCameraUpdate): void;
  updateCameraEffects?(context: LockOnCameraEffectsUpdate): void;
  easeRunProgress?(time: number, duration: number): number;
  /**
   * Instantaneous rail-speed multiplier at a run time, relative to the level's
   * baseline pace (1 = baseline). When provided, the shot-delay snap cap
   * tightens as speed rises above baseline so impact delays cost a constant
   * felt distance instead of constant seconds.
   */
  speedFactorAt?(time: number): number;
  scoreForHit?(volleySize: number, enemy: LockOnEnemy<TKind, TData>): number;
  scoreForKill?(volleySize: number, enemy: LockOnEnemy<TKind, TData>): number;
  scoreForVolley?(results: Array<{ enemy: LockOnEnemy<TKind, TData>; killed: boolean }>): number;
  validateRelease?(enemies: Array<LockOnEnemy<TKind, TData>>): boolean | Array<LockOnEnemy<TKind, TData>>;
  rankForRun?(score: number, kills: number, totalEnemies: number): string;
  detailsForRun?(): string[] | undefined;
  lockRadiusNdc?: number;
  startWord?: string;
  replayWord?: string;
  playerHealth?: number;
  allowLockUndo?: boolean;
  timing?: {
    shotDelay?: Partial<ShotDelaySettings>;
    actionSfx?: Partial<ActionSfxQuantizationSettings>;
  };
};

export type LockOnRunnerOptions<TKind extends string = string, TData = unknown> = {
  scene: Scene;
  camera: PerspectiveCamera;
  canvas: HTMLCanvasElement;
  bus: EventBus;
  hud: Hud;
  visuals: VisualFactories;
  onPause: () => void;
  onFullscreen: () => void;
  startTip: string;
  level: LockOnRunnerLevel<TKind, TData>;
};
