import { CatmullRomCurve3, Vector3 } from 'three';
import type { LockOnRunnerLevel, LockOnSpawnEntry } from '../../engine/lock-on-runner';
import { createMusicTime } from '../../engine/music-time';

export const STRANDLINE_C0FB_BPM = 120;
export const STRANDLINE_C0FB_TIME = createMusicTime(STRANDLINE_C0FB_BPM, { stepsPerBar: 16 });
export const STRANDLINE_C0FB_RUN_DURATION = STRANDLINE_C0FB_TIME.bar(16);

export type StrandlineC0fbEnemyKind = string;
export type StrandlineC0fbSpawnData = Record<string, never>;

export function createStrandlineC0fbRail() {
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

export const STRANDLINE_C0FB_SPAWN_TIMELINE: Array<LockOnSpawnEntry<StrandlineC0fbEnemyKind, StrandlineC0fbSpawnData>> = [];

export const strandlineC0fbGameplay: LockOnRunnerLevel<StrandlineC0fbEnemyKind, StrandlineC0fbSpawnData> = {
  duration: STRANDLINE_C0FB_RUN_DURATION,
  bpm: STRANDLINE_C0FB_BPM,
  createRail: createStrandlineC0fbRail,
  spawnTimeline: STRANDLINE_C0FB_SPAWN_TIMELINE,
  updateEnemy() {
    // TODO: replace this stub when the spawn timeline gains authored enemies.
    return false;
  },
};
