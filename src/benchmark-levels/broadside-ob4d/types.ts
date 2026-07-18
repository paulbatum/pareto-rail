import type { Vector3 } from 'three';
import type { HostileShotImpactState } from '../../engine/hostile-shot';
import type { LockOnEnemyUpdate, LockOnSpawnEntry } from '../../engine/lock-on-runner';

// The seven things in the engagement, in the order you meet them:
//
//   interceptor  swarm dart — the fleet's small craft, crossing the gaps
//   wasp         twin-boom fighter that corkscrews in instead of crossing
//   turret       a rooted hull battery that tracks you and throws shells
//   shell        crimson point-defence round; lockable, so it is also a target
//   escort       heavy delta that arrives in formation and fans out
//   generator    a shield emitter on the enemy flagship's flank
//   core         a reactor coupling exposed in the flagship's trench
export type BroadsideEnemyKind =
  | 'interceptor'
  | 'wasp'
  | 'turret'
  | 'shell'
  | 'escort'
  | 'generator'
  | 'core';

// Timeline data is immutable and reused across runs; every mutable per-enemy
// value lives in an `enemyState` bag or on the mesh's userData. Shells are the
// exception: they are spawned at run time with fresh data objects.
export type BroadsideSpawnData =
  | {
    role: 'interceptor';
    lead: number;
    fromX: number; fromY: number; toX: number; toY: number;
    arc: number; helix: number; delay: number; crossTime: number;
  }
  | { role: 'wasp'; lead: number; x: number; y: number; radius: number; rate: number; driftX: number; delay: number }
  | { role: 'turret'; lead: number; x: number; y: number; seed: number; firstShot: number; interval: number }
  | { role: 'shell'; position: Vector3; velocity: Vector3; lastAge: number; impact: HostileShotImpactState }
  | { role: 'escort'; lead: number; x: number; y: number; fromX: number; fromY: number; delay: number; breakAt: number }
  | { role: 'generator'; lead: number; x: number; y: number; index: number; phase: number }
  | { role: 'core'; lead: number; x: number; y: number; index: number };

export type BroadsideSpawnEntry = LockOnSpawnEntry<BroadsideEnemyKind, BroadsideSpawnData>;
export type BroadsideUpdate = LockOnEnemyUpdate<BroadsideEnemyKind, BroadsideSpawnData>;

export type GeneratorData = Extract<BroadsideSpawnData, { role: 'generator' }>;
export type CoreData = Extract<BroadsideSpawnData, { role: 'core' }>;
