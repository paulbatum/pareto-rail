import { CatmullRomCurve3, Vector3 } from 'three';
import type { LockOnRunnerLevel, LockOnSpawnEntry } from '../../engine/lock-on-runner';
import { createMusicTime } from '../../engine/music-time';

import { ESCAPEMENT_BPM, ESCAPEMENT_TIME } from './timing';
export { ESCAPEMENT_BPM, ESCAPEMENT_TIME };
export const ESCAPEMENT_RUN_DURATION = ESCAPEMENT_TIME.bar(16);

export type EscapementEnemyKind = string;
export type EscapementSpawnData = Record<string, never>;

export function createEscapementRail() {
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

export const ESCAPEMENT_SPAWN_TIMELINE: Array<LockOnSpawnEntry<EscapementEnemyKind, EscapementSpawnData>> = [];

export const escapementGameplay: LockOnRunnerLevel<EscapementEnemyKind, EscapementSpawnData> = {
  duration: ESCAPEMENT_RUN_DURATION,
  bpm: ESCAPEMENT_BPM,
  createRail: createEscapementRail,
  spawnTimeline: ESCAPEMENT_SPAWN_TIMELINE,
  updateEnemy() {
    // TODO: replace this stub when the spawn timeline gains authored enemies.
    return false;
  },
};
