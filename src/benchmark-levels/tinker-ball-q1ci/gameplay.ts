import { CatmullRomCurve3, MathUtils, Vector3 } from 'three';
import type { EventBus } from '../../events';
import type {
  LockOnEnemyUpdate,
  LockOnRunnerLevel,
  LockOnSpawnEntry,
} from '../../engine/lock-on-runner';
import { offsetFromRail, smoothRunProgress } from '../../engine/rail';
import { formation, sortTimeline } from '../../engine/spawn-patterns';
import {
  TINKER_BALL_Q1CI_BPM,
  TINKER_BALL_Q1CI_MARKERS,
  TINKER_BALL_Q1CI_RUN_DURATION,
  TINKER_BALL_Q1CI_TIME,
} from './timing';

export {
  TINKER_BALL_Q1CI_BPM,
  TINKER_BALL_Q1CI_RUN_DURATION,
  TINKER_BALL_Q1CI_TIME,
} from './timing';

export type TinkerBallQ1ciEnemyKind =
  | 'button-beetle'
  | 'pencil-walker'
  | 'clothespin-bird'
  | 'spool-crab'
  | 'block-golem'
  | 'spill-controller'
  | 'spill-ruler-core'
  | 'spill-jar-core'
  | 'spill-card-core'
  | 'spill-heart';

export type TinkerBallMotion = 'skitter' | 'stride' | 'swoop' | 'orbit' | 'lumber';

export type TinkerBallWaveData = {
  role: 'wave';
  lead: number;
  motion: TinkerBallMotion;
  offset: Vector3;
  phase: number;
  scale: number;
};

export type TinkerBallBossData = {
  role: 'boss';
  order: number;
  anchorU: number;
  offset: Vector3;
  scale: number;
};

export type TinkerBallControllerData = {
  role: 'controller';
  offset: Vector3;
};

export type TinkerBallQ1ciSpawnData = TinkerBallWaveData | TinkerBallBossData | TinkerBallControllerData;
export type TinkerBallSpawnEntry = LockOnSpawnEntry<TinkerBallQ1ciEnemyKind, TinkerBallQ1ciSpawnData>;
type TinkerBallUpdate = LockOnEnemyUpdate<TinkerBallQ1ciEnemyKind, TinkerBallQ1ciSpawnData>;

const time = TINKER_BALL_Q1CI_TIME;
const FORMATION_STAGGER = time.seconds(0.105);
const BOSS_KINDS: TinkerBallQ1ciEnemyKind[] = [
  'spill-ruler-core',
  'spill-jar-core',
  'spill-card-core',
  'spill-heart',
];
const BOSS_BLUEPRINTS: ReadonlyArray<{
  kind: TinkerBallQ1ciEnemyKind;
  hitStages: number[];
  offset: Vector3;
  scale: number;
}> = [
  { kind: 'spill-ruler-core', hitStages: [2], offset: new Vector3(-7.2, -4.3, 0), scale: 1.4 },
  { kind: 'spill-jar-core', hitStages: [2], offset: new Vector3(7, -3.8, 0), scale: 1.5 },
  { kind: 'spill-card-core', hitStages: [2], offset: new Vector3(-8, 2.8, 0), scale: 1.5 },
  { kind: 'spill-heart', hitStages: [2, 2], offset: new Vector3(0, -3.3, 1.4), scale: 1.85 },
];

/**
 * A single exuberant route across the worktop. Camera height rises with the
 * ball's scale, while the lateral loops deliberately bring the rail through
 * the debris dropped by the preceding wave.
 */
export function createTinkerBallQ1ciRail() {
  return new CatmullRomCurve3(
    [
      new Vector3(0, 5.1, 24),
      new Vector3(18, 5.0, -7),
      new Vector3(-14, 5.2, -39),
      new Vector3(-35, 5.5, -70),
      new Vector3(4, 5.7, -102),
      new Vector3(43, 6.1, -130),
      new Vector3(68, 6.4, -164),
      new Vector3(34, 6.8, -196),
      new Vector3(-9, 7.1, -222),
      new Vector3(-58, 7.5, -248),
      new Vector3(-76, 8.0, -284),
      new Vector3(-36, 8.4, -314),
      new Vector3(12, 8.9, -337),
      new Vector3(58, 9.4, -366),
      new Vector3(39, 9.8, -401),
      new Vector3(-6, 10.2, -427),
      new Vector3(-42, 10.5, -455),
      new Vector3(-7, 10.6, -484),
    ],
    false,
    'catmullrom',
    0.42,
  );
}

function wave(
  at: number,
  kind: TinkerBallQ1ciEnemyKind,
  motion: TinkerBallMotion,
  lead: number,
  scale: number,
  offsets: ReadonlyArray<readonly [number, number]>,
): TinkerBallSpawnEntry[] {
  return formation(at, FORMATION_STAGGER, offsets, (offset, index) => {
    const spreadScale = scale < 0.9 ? 0.78 : 1;
    const expandedX = Math.abs(offset[0]) < 1
      ? (index % 2 === 0 ? -7.5 : 7.5)
      : offset[0] * 1.16 + Math.sign(offset[0]) * 4.4;
    return {
      kind,
      data: {
        role: 'wave',
        lead: lead * 0.78,
        motion,
        offset: new Vector3(
          expandedX * spreadScale,
          (offset[1] * 1.35 + Math.sign(offset[1] || (index % 2 === 0 ? -1 : 1)) * 1.05) * spreadScale,
          0,
        ),
        phase: at * 0.73 + index * 1.618,
        scale,
      },
    };
  });
}

function createTimeline(): TinkerBallSpawnEntry[] {
  const bossAt = TINKER_BALL_Q1CI_MARKERS.spillEntrance;
  return sortTimeline([
    // Act I — marble scale. Low beetles cross the scratches; the first birds
    // force a vertical sweep and establish that everything here is stolen.
    ...wave(time.bar(1), 'button-beetle', 'skitter', 4.2, 0.82, [
      [-7.5, -3.1], [-2.5, -1.5], [2.5, -3.0], [7.5, -1.2],
    ]),
    ...wave(time.bar(2, 2), 'button-beetle', 'skitter', 4.5, 0.9, [
      [-10, -2.6], [-5, -0.7], [0, -3.2], [5, -0.7], [10, -2.6],
    ]),
    ...wave(time.bar(4), 'clothespin-bird', 'swoop', 4.8, 0.8, [
      [-9, 2], [-3, 6.5], [3, 4.2], [9, 1.4],
    ]),
    ...wave(time.bar(5, 2), 'pencil-walker', 'stride', 4.6, 0.78, [
      [-8, -1.8], [-2.7, 2.2], [2.7, -2.1], [8, 1.6],
    ]),
    ...wave(time.bar(7), 'button-beetle', 'skitter', 4.35, 0.98, [
      [-11, -2.5], [-7, 0.1], [-2.5, -3.3], [2.5, 0.5], [7, -2.8], [11, 0.2],
    ]),

    // Act II — tennis-ball scale. Spools roll in broad arcs and walkers loom
    // above them; the alternating heights keep full-screen sweeps musical.
    ...wave(time.bar(8), 'spool-crab', 'orbit', 4.8, 1.05, [
      [-8.5, -2.3], [-3, 2.8], [3, -1.2], [8.5, 2.5],
    ]),
    ...wave(time.bar(9, 2), 'clothespin-bird', 'swoop', 4.9, 1.08, [
      [-10, 1.5], [-5, 5.2], [0, 2.8], [5, 5.6], [10, 1.2],
    ]),
    ...wave(time.bar(11), 'pencil-walker', 'stride', 4.6, 1.08, [
      [-10, -2], [-5, 2], [0, -2.8], [5, 2.5], [10, -1.4],
    ]),
    ...wave(time.bar(12, 2), 'spool-crab', 'orbit', 4.55, 1.16, [
      [-9, 3], [-3, -2.8], [3, 3.5], [9, -2.2],
    ]),
    ...wave(time.bar(14), 'button-beetle', 'skitter', 4.25, 1.2, [
      [-11, -2.5], [-6.5, 0.7], [-2, -3.2], [2, 1.1], [6.5, -2.6], [11, 0.4],
    ]),
    ...wave(time.bar(14, 2), 'clothespin-bird', 'swoop', 4.7, 1.08, [
      [-7.5, 5.6], [0, 3.3], [7.5, 5.2],
    ]),
    ...wave(time.bar(15, 2), 'pencil-walker', 'stride', 4.35, 1.2, [
      [-8, -1.4], [-2.6, 2.9], [2.6, -2.4], [8, 2.1],
    ]),

    // Act III — melon scale. Wooden bodies occupy more screen and their
    // slower, heavier timing makes the growth tangible before the spill.
    ...wave(time.bar(17), 'block-golem', 'lumber', 5.0, 1.15, [
      [-9, -2.3], [-3, 2.9], [3, -1.7], [9, 2.2],
    ]),
    ...wave(time.bar(18, 2), 'spool-crab', 'orbit', 4.75, 1.38, [
      [-11, 2.4], [-6, -3], [0, 3.7], [6, -2.4], [11, 1.9],
    ]),
    ...wave(time.bar(20), 'clothespin-bird', 'swoop', 4.8, 1.28, [
      [-11, 1.2], [-5.5, 5.7], [0, 2.1], [5.5, 5.2], [11, 0.9],
    ]),
    ...wave(time.bar(21), 'pencil-walker', 'stride', 4.5, 1.38, [
      [-11, -2.4], [-7, 2.4], [-2.5, -3.1], [2.5, 3.2], [7, -2.4], [11, 1.8],
    ]),
    ...wave(time.bar(22, 2), 'block-golem', 'lumber', 4.6, 1.32, [
      [-9.5, 2.5], [-3.2, -2.8], [3.2, 3], [9.5, -2],
    ]),
    ...wave(time.bar(23, 1), 'spool-crab', 'orbit', 3.8, 1.38, [
      [-10, -2.5], [-5, 3.2], [0, -3], [5, 3.4], [10, -2.1],
    ]),

    // Finale — an off-screen controller uses the runner's dynamic-spawn
    // contract to expose one core at a time. This keeps the fight literal:
    // breaking a shell is what allows the spill to recycle its next layer.
    {
      time: bossAt,
      kind: 'spill-controller',
      lockable: false,
      countsTowardTotal: false,
      data: { role: 'controller', offset: new Vector3(0, -60, 10) },
    },

    // The spill keeps recycling two small bodies while its shells are being
    // opened, preventing the finale from collapsing into a stationary dot.
    ...wave(time.bar(25, 2), 'button-beetle', 'skitter', 4.0, 1.32, [
      [-10, -2.8], [10, -2.8], [-5, 1.5], [5, 1.5],
    ]),
    ...wave(time.bar(27, 1), 'clothespin-bird', 'swoop', 4.1, 1.28, [
      [-9, 4.6], [0, 1.8], [9, 4.6],
    ]),
  ]);
}

/** Static authored timeline for diagnostics and spawn-trace tooling. */
export const TINKER_BALL_Q1CI_TIMELINE = createTimeline();

function cloneTimeline(): TinkerBallSpawnEntry[] {
  return TINKER_BALL_Q1CI_TIMELINE.map((entry) => ({
    ...entry,
    data: {
      ...entry.data,
      offset: entry.data.offset.clone(),
    },
  }));
}

const KILL_SCORE: Record<TinkerBallQ1ciEnemyKind, number> = {
  'button-beetle': 110,
  'pencil-walker': 150,
  'clothespin-bird': 140,
  'spool-crab': 170,
  'block-golem': 220,
  'spill-controller': 0,
  'spill-ruler-core': 500,
  'spill-jar-core': 600,
  'spill-card-core': 700,
  'spill-heart': 1800,
};

export function createTinkerBallQ1ciGameplay(
  bus: EventBus,
): LockOnRunnerLevel<TinkerBallQ1ciEnemyKind, TinkerBallQ1ciSpawnData> {
  const timeline = cloneTimeline();
  const kindById = new Map<number, TinkerBallQ1ciEnemyKind>();
  let rescued = 0;
  let bossCracked = 0;
  let bossSummoned = false;
  let spillDefeated = false;
  let activeBossId = -1;

  bus.on('runstart', () => {
    kindById.clear();
    rescued = 0;
    bossCracked = 0;
    bossSummoned = false;
    spillDefeated = false;
    activeBossId = -1;
  });

  bus.on('spawn', ({ enemyId, kind }) => {
    const typedKind = kind as TinkerBallQ1ciEnemyKind;
    kindById.set(enemyId, typedKind);
    if (BOSS_KINDS.includes(typedKind) && !bossSummoned) {
      bossSummoned = true;
      bus.emit('bossphase', { phase: 'summoned' });
    }
  });

  bus.on('kill', ({ enemyId }) => {
    const kind = kindById.get(enemyId);
    if (!kind) return;
    kindById.delete(enemyId);
    rescued += BOSS_KINDS.includes(kind) ? 8 : 3;
    const bossIndex = BOSS_KINDS.indexOf(kind);
    if (bossIndex < 0) return;

    if (activeBossId === enemyId) activeBossId = -1;
    bossCracked = Math.max(bossCracked, bossIndex + 1);
    if (bossIndex + 1 < BOSS_BLUEPRINTS.length) {
      if (bossIndex === BOSS_BLUEPRINTS.length - 2) bus.emit('bossphase', { phase: 'exposed' });
    } else {
      spillDefeated = true;
      bus.emit('bossphase', { phase: 'destroyed' });
    }
  });

  function updateWave(context: TinkerBallUpdate, data: TinkerBallWaveData) {
    const { enemy, age, camera, curve, railAnchor, runProgress } = context;
    const anchorU = railAnchor(data.lead);
    const offset = data.offset.clone();
    const phase = data.phase + enemy.id * 0.37;

    switch (data.motion) {
      case 'skitter': {
        const foot = Math.sin(age * 7.2 + phase);
        offset.x += foot * 1.65 + Math.sin(age * 2.1 + phase) * 0.7;
        offset.y += Math.abs(foot) * 0.28;
        offset.z += Math.cos(age * 4.1 + phase) * 0.4;
        break;
      }
      case 'stride': {
        offset.x += Math.sin(age * 1.65 + phase) * 1.7;
        offset.y += Math.abs(Math.sin(age * 3.3 + phase)) * 0.95;
        offset.z += Math.sin(age * 1.3 + phase) * 0.75;
        break;
      }
      case 'swoop': {
        offset.x += Math.sin(age * 1.35 + phase) * 3.1;
        offset.y += Math.sin(age * 2.7 + phase) * 1.5;
        offset.z += Math.cos(age * 1.7 + phase) * 1.2;
        break;
      }
      case 'orbit': {
        offset.x += Math.cos(age * 2.25 + phase) * 2.2;
        offset.y += Math.sin(age * 2.25 + phase) * 1.55;
        offset.z += Math.sin(age * 1.1 + phase) * 0.8;
        break;
      }
      case 'lumber': {
        const step = Math.sin(age * 2.4 + phase);
        offset.x += step * 1.25;
        offset.y += Math.abs(step) * 0.65;
        offset.z += Math.cos(age * 1.2 + phase) * 0.55;
        break;
      }
    }

    enemy.mesh.userData.targetScale = data.scale * 1.32;
    enemy.mesh.userData.motionPhase = age;
    enemy.mesh.position.copy(offsetFromRail(curve, anchorU, offset));
    enemy.mesh.quaternion.copy(camera.quaternion);
    if (data.motion === 'skitter') enemy.mesh.rotateZ(Math.sin(age * 7 + phase) * 0.16);
    if (data.motion === 'stride') enemy.mesh.rotateZ(Math.sin(age * 3.3 + phase) * 0.22);
    if (data.motion === 'swoop') enemy.mesh.rotateZ(Math.sin(age * 1.35 + phase) * 0.42);
    if (data.motion === 'orbit') enemy.mesh.rotateZ(age * 1.7 + phase);
    if (data.motion === 'lumber') enemy.mesh.rotateZ(Math.sin(age * 2.4 + phase) * 0.12);

    return runProgress > anchorU + 0.022 || age > data.lead + 1.35;
  }

  function updateBoss(context: TinkerBallUpdate, data: TinkerBallBossData) {
    const { enemy, age, camera, curve, runProgress } = context;
    // The spill rolls forward with the camera just enough to preserve the
    // authored fifteen-second fight, then settles over the spotless patch.
    const anchorU = Math.min(0.988, Math.max(data.anchorU, runProgress + 0.072));
    const offset = data.offset.clone();
    const inhale = 1 + Math.sin(age * 1.7 + data.order) * 0.05;
    offset.x += Math.sin(age * 0.7 + data.order * 1.7) * (0.4 + data.order * 0.1);
    offset.y += Math.cos(age * 0.9 + data.order) * 0.3;
    enemy.mesh.userData.targetScale = data.scale * inhale * 1.2;
    enemy.mesh.userData.activeCore = enemy.entry.lockable !== false;
    enemy.mesh.userData.motionPhase = age;
    enemy.mesh.position.copy(offsetFromRail(curve, anchorU, offset));
    enemy.mesh.quaternion.copy(camera.quaternion);
    enemy.mesh.rotateZ(Math.sin(age * 0.55 + data.order) * 0.08);
    return false;
  }

  function updateController(context: TinkerBallUpdate, data: TinkerBallControllerData) {
    const state = context.enemyState(() => ({
      spawned: 0,
      nextAt: context.runTime + 0.12,
      waitingAfterKill: false,
    }));
    const hiddenOffset = data.offset.clone().applyQuaternion(context.camera.quaternion);
    context.enemy.mesh.position.copy(context.camera.position).add(hiddenOffset);
    context.enemy.mesh.visible = false;

    if (activeBossId < 0 && state.spawned > 0 && !state.waitingAfterKill && state.spawned < BOSS_BLUEPRINTS.length) {
      state.nextAt = context.runTime + 0.38;
      state.waitingAfterKill = true;
    }
    if (activeBossId >= 0 || state.spawned >= BOSS_BLUEPRINTS.length || context.runTime < state.nextAt) return false;

    const blueprint = BOSS_BLUEPRINTS[state.spawned];
    activeBossId = context.spawnEnemy({
      time: context.runTime,
      kind: blueprint.kind,
      hitStages: [...blueprint.hitStages],
      data: {
        role: 'boss',
        order: state.spawned,
        anchorU: 0.92,
        offset: blueprint.offset.clone(),
        scale: blueprint.scale,
      },
    });
    state.spawned += 1;
    state.nextAt = Number.POSITIVE_INFINITY;
    state.waitingAfterKill = false;
    return false;
  }

  return {
    duration: TINKER_BALL_Q1CI_RUN_DURATION,
    bpm: TINKER_BALL_Q1CI_BPM,
    createRail: createTinkerBallQ1ciRail,
    spawnTimeline: timeline,
    easeRunProgress: smoothRunProgress,
    lockRadiusNdc: 0.16,
    timing: {
      shotDelay: {
        pattern: 'grid-ramp',
        gapThirtyseconds: 1,
        releaseShare: 0.62,
        gridRampGapGrowthThirtyseconds: 1,
        maxGridSeconds: 0.9,
      },
      actionSfx: { enabled: true, gridThirtyseconds: 1 },
    },
    updateAttractCamera({ camera, modeTime }) {
      camera.rotateZ(Math.sin(modeTime * 0.45) * 0.012);
      camera.rotateX(-0.11);
    },
    updateCameraEffects({ camera, runProgress }) {
      // A slight downward pitch keeps the scratched work surface in frame.
      camera.rotateX(-MathUtils.lerp(0.105, 0.155, runProgress));
      camera.rotateZ(Math.sin(runProgress * Math.PI * 5) * 0.018);
    },
    updateEnemy(context) {
      const data = context.enemy.entry.data;
      if (data.role === 'wave') return updateWave(context, data);
      if (data.role === 'controller') return updateController(context, data);
      return updateBoss(context, data);
    },
    scoreForHit(volleySize, enemy) {
      return BOSS_KINDS.includes(enemy.kind) ? 45 + volleySize * 8 : 20;
    },
    scoreForKill(volleySize, enemy) {
      const chain = 1 + Math.max(0, volleySize - 1) * 0.18;
      return Math.round(KILL_SCORE[enemy.kind] * chain);
    },
    scoreForVolley(results) {
      if (results.length < 6 || results.some((result) => !result.killed)) return 0;
      return 420;
    },
    validateRelease(enemies) {
      // Inactive boss cores never enter the lock list. This defensive filter
      // also keeps a mixed spill/minion volley honest during the unlock frame.
      return enemies.filter((enemy) => enemy.entry.lockable !== false);
    },
    rankForRun(score, kills, totalEnemies) {
      const clear = totalEnemies === 0 ? 0 : kills / totalEnemies;
      if (spillDefeated && score >= 13_500 && clear >= 0.9) return 'S';
      if (spillDefeated && score >= 10_000 && clear >= 0.75) return 'A';
      if (score >= 7_000 && clear >= 0.58) return 'B';
      if (score >= 3_800 && clear >= 0.35) return 'C';
      return 'D';
    },
    detailsForRun() {
      const size = rescued >= 150 ? 'MELON' : rescued >= 75 ? 'TENNIS BALL' : 'MARBLE';
      return [
        `Ball size  ${size}`,
        `Supplies rescued  ${rescued}`,
        spillDefeated ? 'Glue spill  CLEAN' : `Glue cores  ${bossCracked}/4`,
      ];
    },
  };
}
