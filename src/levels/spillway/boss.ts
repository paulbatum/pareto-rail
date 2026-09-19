import { Group } from 'three';
import type { Object3D } from 'three';
import type { EventBus } from '../../events';
import type { SpillwaySpawnEntry, SpillwayUpdate } from './gameplay';

// The walker fight at the dam crest, bars 44–58: the kinds `leg`, `core` and
// `slab`. Gameplay routes their spawns and updates here, and the visuals route
// their meshes to `createBossMesh`. Everything below is an empty stub.

export type BossPart = 'leg' | 'core' | 'slab';

export type BossSpawnData = { role: 'boss'; part: BossPart };

/** Timeline entries for the fight. Times are absolute run seconds. */
export function createBossSpawns(): SpillwaySpawnEntry[] {
  return [];
}

export function createBoss(_bus: EventBus) {
  return {
    /** Motion for a boss part; return true to despawn it as a miss. */
    update(_context: SpillwayUpdate, _data: BossSpawnData): boolean {
      return false;
    },
    /** One end-screen line about the fight, or nothing. */
    summaryLine(): string | undefined {
      return undefined;
    },
  };
}

export function createBossMesh(_kind: BossPart): Object3D {
  return new Group();
}
