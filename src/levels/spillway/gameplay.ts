import type { LockOnRunnerLevel, LockOnSpawnEntry } from '../../engine/lock-on-runner';
import { createSpillwayRail, spillwayRunProgress } from './rail';
import { SPILLWAY_BPM, SPILLWAY_DURATION } from './timing';

export { SPILLWAY_BPM } from './timing';

export type SpillwayEnemyKind = string;
export type SpillwaySpawnData = Record<string, never>;

export const SPILLWAY_SPAWN_TIMELINE: Array<LockOnSpawnEntry<SpillwayEnemyKind, SpillwaySpawnData>> = [];

export const spillwayGameplay: LockOnRunnerLevel<SpillwayEnemyKind, SpillwaySpawnData> = {
  duration: SPILLWAY_DURATION,
  bpm: SPILLWAY_BPM,
  createRail: createSpillwayRail,
  easeRunProgress: spillwayRunProgress,
  spawnTimeline: SPILLWAY_SPAWN_TIMELINE,
  updateEnemy() {
    // TODO: replace this stub when the spawn timeline gains authored enemies.
    return false;
  },
};
