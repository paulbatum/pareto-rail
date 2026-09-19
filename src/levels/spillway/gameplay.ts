import { CatmullRomCurve3, Vector3 } from 'three';
import type { LockOnRunnerLevel, LockOnSpawnEntry } from '../../engine/lock-on-runner';
import { SPILLWAY_BPM, SPILLWAY_DURATION } from './timing';

export { SPILLWAY_BPM } from './timing';

export type SpillwayEnemyKind = string;
export type SpillwaySpawnData = Record<string, never>;

export function createSpillwayRail() {
  // TODO: replace this plain placeholder curve with the level's authored rail.
  return new CatmullRomCurve3(
    [
      new Vector3(0, 0, 0),
      new Vector3(0, 0, -40),
      new Vector3(0, 0, -80),
      new Vector3(0, 0, -120),
    ],
    false,
    'catmullrom',
    0.5,
  );
}

export const SPILLWAY_SPAWN_TIMELINE: Array<LockOnSpawnEntry<SpillwayEnemyKind, SpillwaySpawnData>> = [];

export const spillwayGameplay: LockOnRunnerLevel<SpillwayEnemyKind, SpillwaySpawnData> = {
  duration: SPILLWAY_DURATION,
  bpm: SPILLWAY_BPM,
  createRail: createSpillwayRail,
  spawnTimeline: SPILLWAY_SPAWN_TIMELINE,
  updateEnemy() {
    // TODO: replace this stub when the spawn timeline gains authored enemies.
    return false;
  },
};
