import { CatmullRomCurve3, Vector3, MathUtils } from 'three';
import type { LockOnRunnerLevel, LockOnSpawnEntry, LockOnEnemyUpdate } from '../../engine/lock-on-runner';
import { createMusicTime } from '../../engine/music-time';
import { offsetFromRail } from '../../engine/rail';

export const STRANDLINE_DE7D_BPM = 108;
export const STRANDLINE_DE7D_TIME = createMusicTime(STRANDLINE_DE7D_BPM, { stepsPerBar: 16 });
export const STRANDLINE_DE7D_RUN_DURATION = STRANDLINE_DE7D_TIME.bar(27); // 60 sec at 108 BPM

export type StrandlineDe7dEnemyKind = 'clinger' | 'dart' | 'brood' | 'crown';
export type StrandlineDe7dSpawnData = {
  role: 'wave';
  lead: number;
  offset: Vector3;
  motion: 'drift' | 'weave' | 'orbit';
};

export function createStrandlineDe7dRail() {
  // Rail winds through glowing tentacle strands, curving gently through sunlit water.
  return new CatmullRomCurve3(
    [
      new Vector3(-4, 2, 0),
      new Vector3(8, -1, -28),
      new Vector3(-10, 4, -56),
      new Vector3(6, -3, -82),
      new Vector3(-12, 5, -108),
      new Vector3(4, -4, -134),
      new Vector3(-8, 6, -160),
      new Vector3(10, -5, -186),
      new Vector3(-14, 7, -212),
      new Vector3(2, -6, -238),
      new Vector3(-6, 8, -264),
      new Vector3(8, -7, -290),
      new Vector3(-4, 5, -316),
      new Vector3(12, -2, -342),
      new Vector3(-8, 9, -368),
      new Vector3(0, -3, -394),
    ],
    false,
    'catmullrom',
    0.42,
  );
}

function wave(
  time: number,
  lead: number,
  kind: StrandlineDe7dEnemyKind,
  motion: 'drift' | 'weave' | 'orbit',
  offsets: Array<[number, number, number?]>,
): LockOnSpawnEntry<StrandlineDe7dEnemyKind, StrandlineDe7dSpawnData>[] {
  return offsets.map(([x, y, z = 0]) => ({
    time,
    kind,
    data: {
      role: 'wave',
      lead,
      offset: new Vector3(x, y, z),
      motion,
    },
  }));
}

const time = STRANDLINE_DE7D_TIME;

export const STRANDLINE_DE7D_SPAWN_TIMELINE: Array<LockOnSpawnEntry<StrandlineDe7dEnemyKind, StrandlineDe7dSpawnData>> = [
  // Act 1 — slow introduction in the strands (bars 1-4, ~4.4 sec per bar)
  ...wave(time.beats(0.5), 5.2, 'clinger', 'drift', [[-4, 3], [-2, 1], [2, 2], [5, -1], [-1, -2]]),
  ...wave(time.beats(4.0), 4.8, 'dart', 'weave', [[-7, 4], [0, -2], [6, 5], [-5, -3], [3, 0]]),
  ...wave(time.beats(8.5), 5.0, 'brood', 'orbit', [[-10, 4, 2], [8, -4, -2], [0, 6, 1]]),

  // Act 2 — the infestation thickens (bars 9-16)
  ...wave(time.beats(10.0), 4.5, 'clinger', 'drift', [[-8, -2], [-4, 5], [3, -4], [7, 3]]),
  ...wave(time.beats(13.2), 4.2, 'dart', 'weave', [[-9, 1], [-3, -3], [0, 4], [8, -1], [4, 5]]),
  ...wave(time.beats(15.5), 4.6, 'brood', 'orbit', [[-7, 2], [-2, -4], [5, 3], [2, -1]]),
  ...wave(time.beats(18.8), 4.3, 'clinger', 'weave', [[-10, 0], [0, -3], [8, 2], [-6, 4]]),
  ...wave(time.beats(22.0), 4.7, 'dart', 'drift', [[-5, 5], [2, -2], [9, 1], [-3, -4]]),
  ...wave(time.beats(25.5), 4.0, 'brood', 'orbit', [[-4, 3, 3], [4, -2, -2], [-2, 5, 1]]),

  // Act 3 — the crown reveals itself (bars 20-24)
  ...wave(time.beats(28.0), 5.5, 'clinger', 'weave', [[-9, 4], [6, -3], [2, 6], [-7, -2], [5, 0]]),
  ...wave(time.beats(32.0), 4.0, 'dart', 'orbit', [[-8, -2], [0, 5], [7, 2], [3, -5]]),
  ...wave(time.beats(36.5), 5.2, 'brood', 'drift', [[-6, 4], [3, -2], [8, 3], [-4, -1]]),

  // Boss entrance: crown webbing and parent
  {
    time: time.beats(40.0),
    kind: 'crown',
    hitStages: [2, 2, 2, 6],
    data: { role: 'wave', lead: 6.0, offset: new Vector3(0, 6, 0), motion: 'orbit' },
  },

  // Final sweep before resolution (bars 26-27)
  ...wave(time.beats(43.0), 4.5, 'clinger', 'drift', [[-6, -3], [2, 5], [8, 1], [-3, 4]]),
  ...wave(time.beats(47.5), 4.2, 'dart', 'weave', [[-7, 2], [0, -4], [5, 3], [-4, -1]]),
];

export const strandlineDe7dGameplay: LockOnRunnerLevel<StrandlineDe7dEnemyKind, StrandlineDe7dSpawnData> = {
  duration: STRANDLINE_DE7D_RUN_DURATION,
  bpm: STRANDLINE_DE7D_BPM,
  createRail: createStrandlineDe7dRail,
  spawnTimeline: STRANDLINE_DE7D_SPAWN_TIMELINE,
  playerHealth: 3,
  updateEnemy(context: LockOnEnemyUpdate<StrandlineDe7dEnemyKind, StrandlineDe7dSpawnData>) {
    const { enemy, runTime, age, curve, camera, railAnchor } = context;
    const data = enemy.entry.data as StrandlineDe7dSpawnData;
    const anchorU = railAnchor(data.lead);
    const offset = data.offset.clone();

    if (data.motion === 'drift') {
      offset.x += Math.sin(age * 0.9 + enemy.id * 1.2) * 1.8;
      offset.y += Math.cos(age * 0.7 + enemy.id * 0.8) * 1.2;
    } else if (data.motion === 'weave') {
      offset.x += Math.sin(age * 2.0 + enemy.id * 2.2) * 2.5;
      offset.y += Math.sin(age * 1.4 + enemy.id * 1.8) * 2.2;
      offset.z += Math.sin(age * 3.0) * 0.8;
    } else if (data.motion === 'orbit') {
      offset.x += Math.cos(age * 1.6 + enemy.id) * 2.8;
      offset.y += Math.sin(age * 1.6 + enemy.id) * 2.8;
      offset.z += Math.sin(age * 0.9) * 1.5;
    }

    // Crown: slow majestic rotation, stays near center until final stage
    if (enemy.kind === 'crown') {
      offset.x += Math.sin(age * 0.4) * 1.5;
      offset.y += Math.cos(age * 0.4) * 1.5;
      offset.z += Math.sin(age * 0.25) * 2.0;
    }

    // Place mesh along rail at eased progress
    enemy.mesh.position.copy(offsetFromRail(curve, anchorU, offset));
    // Orient to face camera loosely, with gentle rotation
    enemy.mesh.quaternion.copy(camera.quaternion);
    enemy.mesh.rotateZ(runTime * 0.35 + enemy.id * 0.4);
    enemy.mesh.rotateY(Math.sin(runTime * 0.5 + enemy.id) * 0.3);

    // Miss check: enemy passes behind camera after its lead window
    if (enemy.kind === 'crown') {
      // Boss stays visible until run ends
      return false;
    }
    return runTime > (enemy.spawnTime + data.lead + 0.8);
  },
  startWord: 'FREE',
  replayWord: 'AGAIN',
  timing: {
    shotDelay: {
      gapThirtyseconds: 2,
      releaseShare: 0.75,
      pattern: 'grid-ramp' as const,
      maxGridSeconds: 0.6,
    },
    actionSfx: { enabled: true, gridThirtyseconds: 1 },
  },
};
