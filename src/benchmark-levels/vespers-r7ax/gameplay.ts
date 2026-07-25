import { CatmullRomCurve3, MathUtils, Vector3 } from 'three';
import type {
  LockOnEnemyUpdate,
  LockOnRunnerLevel,
  LockOnSpawnEntry,
} from '../../engine/lock-on-runner';
import { offsetFromRail, smoothRunProgress } from '../../engine/rail';
import { formation, sortTimeline } from '../../engine/spawn-patterns';
import type { EventBus } from '../../events';
import {
  VESPERS_R7AX_BPM,
  VESPERS_R7AX_RUN_DURATION,
  VESPERS_R7AX_TIME,
} from './timing';

export { VESPERS_R7AX_BPM, VESPERS_R7AX_RUN_DURATION } from './timing';

export type VespersR7axEnemyKind =
  | 'shade'
  | 'censer'
  | 'angel'
  | 'rose-petal'
  | 'rose-heart';

type WavePattern = 'peel' | 'pendulum' | 'swoop' | 'procession' | 'solitary';

type WaveData = {
  role: 'wave';
  pattern: WavePattern;
  lead: number;
  offset: Vector3;
  phase: number;
};

type RoseData = {
  role: 'rose';
  slot: number;
  offset: Vector3;
};

export type VespersR7axSpawnData = WaveData | RoseData;
export type VespersR7axSpawnEntry = LockOnSpawnEntry<VespersR7axEnemyKind, VespersR7axSpawnData>;
type VespersR7axUpdate = LockOnEnemyUpdate<VespersR7axEnemyKind, VespersR7axSpawnData>;

export function createVespersR7axRail() {
  // A long, almost-straight nave. The small lateral bends let the stacked
  // arcades reveal themselves in parallax without making the architecture
  // feel like a tunnel ride.
  return new CatmullRomCurve3(
    [
      new Vector3(0, 6, 18),
      new Vector3(-1.5, 7, -38),
      new Vector3(2.2, 8, -92),
      new Vector3(-2.8, 7, -150),
      new Vector3(1.8, 9, -212),
      new Vector3(3.2, 8, -274),
      new Vector3(-2.4, 7, -338),
      new Vector3(-1.2, 8, -404),
      new Vector3(2.6, 9, -470),
      new Vector3(-2.2, 8, -532),
      new Vector3(1.4, 7, -590),
      new Vector3(0, 8, -640),
      new Vector3(0, 9, -674),
    ],
    false,
    'catmullrom',
    0.42,
  );
}

const STAGGER = VESPERS_R7AX_TIME.seconds(0.16);

function wave(
  time: number,
  kind: Extract<VespersR7axEnemyKind, 'shade' | 'censer' | 'angel'>,
  pattern: WavePattern,
  lead: number,
  offsets: ReadonlyArray<readonly [number, number]>,
): VespersR7axSpawnEntry[] {
  return formation(time, STAGGER, offsets, (offset, index) => ({
    kind,
    data: {
      role: 'wave',
      pattern,
      lead: Math.max(2.9, lead - 0.22),
      offset: new Vector3(offset[0] * 1.28, offset[1] * 1.25, 0),
      phase: index * 1.27 + time * 0.37,
    },
  }));
}

function createTimeline() {
  const t = VESPERS_R7AX_TIME;
  const ordinary: VespersR7axSpawnEntry[] = [
    // Introit — isolated silhouettes peel off the first panes while the
    // soundtrack is still almost entirely a pedal note.
    ...wave(t.bar(0, 2.2), 'shade', 'peel', 3.4, [[-8, 3], [5, -2], [-3, 5]]),
    ...wave(t.bar(2, 0.5), 'censer', 'pendulum', 3.6, [[-9, 1], [0, 6], [9, 1]]),
    ...wave(t.bar(3, 2.5), 'shade', 'procession', 3.3, [[-11, -2], [-6, 5], [2, 7], [9, 1]]),

    // Procession — the nave fills in antiphonal left/right phrases.
    ...wave(t.bar(4, 1), 'angel', 'swoop', 3.6, [[-12, 7], [-5, -1], [5, -1], [12, 7]]),
    ...wave(t.bar(5, 2.5), 'shade', 'peel', 3.3, [[-12, 0], [-7, 6], [0, 2], [7, 6], [10, 0]]),
    ...wave(t.bar(7, 0.5), 'censer', 'pendulum', 3.7, [[-12, -3], [-6, 4], [0, 8], [6, 4], [12, -3]]),

    // Counterpoint — three enemy motions interleave like the three organ
    // lines. These broad formations force full-screen reticle sweeps.
    ...wave(t.bar(8, 1), 'angel', 'swoop', 3.6, [[-13, 8], [-8, 0], [-2, 5], [5, -2], [12, 5]]),
    ...wave(t.bar(9, 2.25), 'shade', 'procession', 3.2, [[-13, -3], [-8, 7], [-3, 1], [3, 8], [8, -1], [13, 4]]),
    ...wave(t.bar(10, 3), 'censer', 'pendulum', 3.7, [[-11, 6], [-5, -3], [0, 9], [6, -2], [12, 5]]),
    ...wave(t.bar(12, 0.5), 'angel', 'swoop', 3.4, [[-9.5, -1], [-9, 8], [-4, 3], [4, 3], [9, 8], [13, -1]]),
    ...wave(t.bar(13, 1.75), 'shade', 'peel', 3.1, [[-10, 6], [-5, -3], [0, 9], [5, -3], [10, 6]]),

    // Tenebrae — a deliberately long dark span. One stolen light crosses the
    // nave halfway through it; there is nothing else to shoot.
    ...wave(t.bar(16, 0), 'shade', 'solitary', 3.8, [[-9, 5]]),
  ];

  const roseTime = t.bar(19, 3);
  const roseOffsets: ReadonlyArray<readonly [number, number]> = [
    [-16, 11],
    [0, 16],
    [16, 11],
    [18, -4],
    [0, -15],
    [-20, -4.5],
  ];
  const petals = roseOffsets.map<VespersR7axSpawnEntry>(([x, y], slot) => ({
    time: roseTime + slot * t.seconds(0.1),
    kind: 'rose-petal',
    data: { role: 'rose', slot, offset: new Vector3(x, y, 0) },
    hitPoints: 1,
  }));
  const heart: VespersR7axSpawnEntry = {
    time: roseTime + t.seconds(0.65),
    kind: 'rose-heart',
    data: { role: 'rose', slot: 6, offset: new Vector3(0, 2.2, 0.5) },
    hitPoints: 8,
    hitStages: [3, 3, 2],
    lockable: false,
  };

  return { timeline: sortTimeline([...ordinary, ...petals, heart]), heart };
}

const traceTimeline = createTimeline();
export const VESPERS_R7AX_SPAWN_TIMELINE = traceTimeline.timeline;

const KILL_SCORE: Record<VespersR7axEnemyKind, number> = {
  shade: 110,
  censer: 140,
  angel: 175,
  'rose-petal': 260,
  'rose-heart': 2200,
};

function positionRose(context: VespersR7axUpdate, data: RoseData) {
  const { enemy, curve, camera, age } = context;
  // The runner's rail stops short of the west wall, so the dead rose remains
  // ahead of the player through the final cadence instead of being passed.
  const position = offsetFromRail(curve, 1, data.offset.clone().setZ(31 + data.offset.z));
  enemy.mesh.position.copy(position);
  enemy.mesh.quaternion.copy(camera.quaternion);
  if (enemy.kind === 'rose-petal') {
    const angle = (data.slot / 6) * Math.PI * 2;
    enemy.mesh.rotation.z += angle + Math.sin(age * 0.7 + data.slot) * 0.06;
  } else {
    enemy.mesh.rotation.z += Math.sin(age * 0.3) * 0.04;
  }
  return false;
}

function positionWave(context: VespersR7axUpdate, data: WaveData) {
  const { enemy, curve, camera, runProgress, age, railAnchor } = context;
  const anchorU = railAnchor(data.lead);
  const offset = data.offset.clone();

  switch (data.pattern) {
    case 'peel': {
      const side = Math.sign(data.offset.x || 1);
      const arrival = MathUtils.smootherstep(Math.min(1, age / 1.2), 0, 1);
      offset.x += side * (1 - arrival) * 5.5 + Math.sin(age * 0.9 + data.phase) * 0.8;
      offset.y += Math.sin(age * 0.6 + data.phase) * 0.9;
      break;
    }
    case 'pendulum':
      offset.x += Math.sin(age * 1.45 + data.phase) * 3.2;
      offset.y += Math.cos(age * 2.9 + data.phase) * 0.65;
      offset.z = Math.sin(age * 0.8 + data.phase) * 0.8;
      break;
    case 'swoop': {
      const arc = Math.sin(Math.min(1, age / 3) * Math.PI);
      offset.x += Math.sin(age * 0.9 + data.phase) * 2.2;
      offset.y += arc * 3.4 - age * 0.08;
      offset.z = Math.cos(age * 1.2 + data.phase) * 0.9;
      break;
    }
    case 'procession':
      offset.x += Math.sin(age * 0.7 + data.phase) * 1.1;
      offset.y += Math.sin(age * 1.15 + data.phase) * 1.5;
      break;
    case 'solitary':
      offset.x += age * 2.1;
      offset.y += Math.sin(age * 0.55) * 2.4;
      break;
  }

  enemy.mesh.position.copy(offsetFromRail(curve, anchorU, offset));
  enemy.mesh.quaternion.copy(camera.quaternion);
  if (enemy.kind === 'shade') {
    enemy.mesh.rotateY(Math.sin(age * 1.2 + data.phase) * 0.22);
    enemy.mesh.rotateZ(Math.sin(age * 0.8 + data.phase) * 0.12);
  } else if (enemy.kind === 'censer') {
    enemy.mesh.rotateZ(Math.sin(age * 1.45 + data.phase) * 0.42);
    enemy.mesh.rotateY(age * 0.18);
  } else {
    enemy.mesh.rotateZ(Math.sin(age * 1.05 + data.phase) * 0.28);
    enemy.mesh.rotateX(Math.cos(age * 0.8 + data.phase) * 0.13);
  }

  return runProgress > anchorU + 0.018;
}

export function createVespersR7axGameplay(
  bus: EventBus,
): LockOnRunnerLevel<VespersR7axEnemyKind, VespersR7axSpawnData> {
  const { timeline, heart } = createTimeline();
  const petalIds = new Set<number>();
  let heartId = -1;
  let heartExposed = false;
  let restored = 0;

  bus.on('runstart', () => {
    petalIds.clear();
    heartId = -1;
    heartExposed = false;
    restored = 0;
    heart.lockable = false;
  });
  bus.on('spawn', ({ enemyId, kind }) => {
    if (kind === 'rose-petal') petalIds.add(enemyId);
    if (kind === 'rose-heart') {
      heartId = enemyId;
      bus.emit('bossphase', { phase: 'summoned' });
    }
  });
  bus.on('kill', ({ enemyId }) => {
    if (petalIds.has(enemyId)) {
      petalIds.delete(enemyId);
      if (petalIds.size === 0 && heartId >= 0) {
        heart.lockable = true;
        heartExposed = true;
        bus.emit('bossphase', { phase: 'exposed' });
      }
    } else if (enemyId === heartId) {
      bus.emit('bossphase', { phase: 'destroyed' });
    } else {
      restored += 1;
    }
  });

  return {
    duration: VESPERS_R7AX_RUN_DURATION,
    bpm: VESPERS_R7AX_BPM,
    createRail: createVespersR7axRail,
    spawnTimeline: timeline,
    easeRunProgress: smoothRunProgress,
    lockRadiusNdc: 0.12,
    timing: {
      shotDelay: {
        pattern: 'grid-ramp',
        gridRampGapGrowthThirtyseconds: 1,
        maxGridSeconds: 1.3,
        releaseShare: 0.68,
      },
      actionSfx: { enabled: true, gridThirtyseconds: 1 },
    },
    updateEnemy(context) {
      const data = context.enemy.entry.data;
      if (data.role === 'rose') {
        if (context.enemy.kind === 'rose-heart') {
          context.enemy.mesh.userData.exposed = heartExposed;
        }
        return positionRose(context, data);
      }
      return positionWave(context, data);
    },
    scoreForKill(volleySize, enemy) {
      const choirBonus = 1 + Math.max(0, volleySize - 1) * 0.18;
      return Math.round(KILL_SCORE[enemy.kind] * choirBonus);
    },
    scoreForHit(_volleySize, enemy) {
      return enemy.kind === 'rose-heart' ? 90 : 35;
    },
    scoreForVolley(results) {
      const killed = results.filter((result) => result.killed).length;
      return killed >= 6 ? 600 : killed >= 4 ? 250 : 0;
    },
    rankForRun(score, kills, totalEnemies) {
      const clearRate = totalEnemies > 0 ? kills / totalEnemies : 0;
      if (score >= 11_000 && clearRate >= 0.9) return 'S';
      if (score >= 8_000 && clearRate >= 0.74) return 'A';
      if (score >= 5_200 && clearRate >= 0.52) return 'B';
      if (score >= 2_600 && clearRate >= 0.3) return 'C';
      return 'D';
    },
    detailsForRun() {
      return [
        `Windows returned ${restored}`,
        heartId < 0 ? 'Rose unseen' : heartExposed ? 'Rose broken' : 'Rose sealed',
      ];
    },
  };
}
