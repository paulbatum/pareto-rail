import { CatmullRomCurve3, Vector3 } from 'three';
import type { LockOnRunnerLevel, LockOnSpawnEntry } from '../../engine/lock-on-runner';
import { createMusicTime } from '../../engine/music-time';

export const BROADSIDE_EE5D_BPM = 120;
export const BROADSIDE_EE5D_TIME = createMusicTime(BROADSIDE_EE5D_BPM, { stepsPerBar: 16 });
export const BROADSIDE_EE5D_RUN_DURATION = BROADSIDE_EE5D_TIME.bar(16);

export type BroadsideEe5dEnemyKind = string;
export type BroadsideEe5dSpawnData = Record<string, never>;

export function createBroadsideEe5dRail() {
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

export const BROADSIDE_EE5D_SPAWN_TIMELINE: Array<LockOnSpawnEntry<BroadsideEe5dEnemyKind, BroadsideEe5dSpawnData>> = [];

export const broadsideEe5dGameplay: LockOnRunnerLevel<BroadsideEe5dEnemyKind, BroadsideEe5dSpawnData> = {
  duration: BROADSIDE_EE5D_RUN_DURATION,
  bpm: BROADSIDE_EE5D_BPM,
  createRail: createBroadsideEe5dRail,
  spawnTimeline: BROADSIDE_EE5D_SPAWN_TIMELINE,
  updateEnemy() {
    // TODO: replace this stub when the spawn timeline gains authored enemies.
    return false;
  },
};
