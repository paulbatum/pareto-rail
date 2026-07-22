import type { Vector3 } from 'three';
import type { LockOnEnemyUpdate, LockOnSpawnEntry } from '../../engine/lock-on-runner';
import type { RailLead } from '../../engine/rail-pacer';

export type PurseEnemyKind = 'weaver' | 'swinger' | 'hauler' | 'flyer' | 'bomb' | 'spike' | 'boss';

/** How a gang rider carries itself down the highway. One grammar per kind. */
export type RiderData = {
  role: 'rider';
  engagement: RailLead;
  /** Lane centre, in metres from the rail. */
  laneX: number;
  /** Which screen edge a swinger comes in from. */
  side: -1 | 1;
  phase: number;
  /** Extra ride height, used by the ramp jumpers. */
  lift: number;
  /** Haulers kick a spike cluster loose once they are close enough to matter. */
  harasses: boolean;
};

export type BombData = {
  role: 'bomb';
  position: Vector3;
  velocity: Vector3;
  lastAge: number;
  spin: number;
  impactAt?: number;
  impactDirection?: Vector3;
  interceptUntil?: number;
};

export type SpikeData = {
  role: 'spike';
  /** Rail progress the cluster is nailed to; the road brings it to you. */
  anchorU: number;
  lane: number;
  drift: number;
};

export type BossData = { role: 'boss' };

export type PurseSpawnData = RiderData | BombData | SpikeData | BossData;
export type PurseSpawnEntry = LockOnSpawnEntry<PurseEnemyKind, PurseSpawnData>;
export type PurseUpdate = LockOnEnemyUpdate<PurseEnemyKind, PurseSpawnData>;
