import { CatmullRomCurve3, MathUtils, Vector3 } from 'three';
import type { EventBus } from '../../events';
import type { LockOnEnemyUpdate, LockOnRunnerLevel, LockOnSpawnEntry } from '../../engine/lock-on-runner';
import { createMusicTime } from '../../engine/music-time';
import { offsetFromRail } from '../../engine/rail';

export const STRANDLINE_S5CX_BPM = 120;
export const STRANDLINE_S5CX_TIME = createMusicTime(STRANDLINE_S5CX_BPM, { stepsPerBar: 16 });
export const STRANDLINE_S5CX_RUN_DURATION = STRANDLINE_S5CX_TIME.bar(30); // exactly sixty seconds

export const STRANDLINE_S5CX_MARKERS = {
  shallows: STRANDLINE_S5CX_TIME.bar(0),
  bellReveal: STRANDLINE_S5CX_TIME.bar(8),
  innerForest: STRANDLINE_S5CX_TIME.bar(11),
  quickening: STRANDLINE_S5CX_TIME.bar(17),
  crown: STRANDLINE_S5CX_TIME.bar(22),
  liberation: STRANDLINE_S5CX_TIME.bar(28),
};

export type StrandlineS5cxEnemyKind = 'clasper' | 'ribbon' | 'spore' | 'brood' | 'parent';
export type StrandlineS5cxSpawnData =
  | { role: 'clasp'; lead: number; side: number; height: number; detach: number; phase: number }
  | { role: 'ribbon'; lead: number; side: number; height: number; phase: number; direction: number }
  | { role: 'spore'; lead: number; radius: number; phase: number; direction: number }
  | { role: 'brood'; slot: number }
  | { role: 'parent' };
type Entry = LockOnSpawnEntry<StrandlineS5cxEnemyKind, StrandlineS5cxSpawnData>;
type Update = LockOnEnemyUpdate<StrandlineS5cxEnemyKind, StrandlineS5cxSpawnData>;

export function createStrandlineS5cxRail() {
  // The first half banks between the hanging filaments. At the eighth bar it
  // swings far enough out for the bell to read as a moon, then folds back into
  // the strands and climbs their convergence point at the crown.
  return new CatmullRomCurve3([
    new Vector3(0, 2, 34),
    new Vector3(-8, 4, -18),
    new Vector3(15, 7, -72),
    new Vector3(-18, 9, -126),
    new Vector3(34, 12, -178),
    new Vector3(82, 21, -226),
    new Vector3(58, 18, -278),
    new Vector3(8, 15, -324),
    new Vector3(-31, 21, -374),
    new Vector3(25, 28, -422),
    new Vector3(-13, 40, -466),
    new Vector3(5, 58, -505),
    new Vector3(0, 76, -535),
  ], false, 'catmullrom', 0.42);
}

const bar = (value: number) => STRANDLINE_S5CX_TIME.bar(value);

function claspers(time: number, layout: Array<[number, number]>, detach = 1.65, lead = 5.4): Entry[] {
  return layout.map(([side, height], index) => ({
    time: time + index * 0.13,
    kind: 'clasper',
    data: { role: 'clasp', lead, side, height, detach: detach + index * 0.08, phase: time * 0.73 + index * 1.7 },
  }));
}

function ribbons(time: number, layout: Array<[number, number]>, lead = 5.1): Entry[] {
  return layout.map(([side, height], index) => ({
    time: time + index * 0.12,
    kind: 'ribbon',
    data: { role: 'ribbon', lead, side, height, phase: index * 1.37 + time, direction: index % 2 ? -1 : 1 },
  }));
}

function spores(time: number, count: number, radius: number, lead = 4.9): Entry[] {
  return Array.from({ length: count }, (_, index) => ({
    time: time + index * 0.09,
    kind: 'spore',
    data: { role: 'spore', lead, radius, phase: index / count * Math.PI * 2, direction: index % 2 ? -1 : 1 },
  }));
}

const PARENT_ENTRY: Entry = {
  time: bar(25.2),
  kind: 'parent',
  hitStages: [2, 2, 2],
  data: { role: 'parent' },
};

export const STRANDLINE_S5CX_SPAWN_TIMELINE: Entry[] = [
  // Dormant shallows: parasites peel off the first quiet strands in readable fans.
  ...claspers(bar(1), [[-7, -3], [-3.5, 2], [0, 4.5], [3.5, 2], [7, -3]]),
  ...ribbons(bar(3), [[-8, 3], [-3, -1], [3, -1], [8, 3]]),
  ...spores(bar(4.6), 6, 7.5),
  ...claspers(bar(6.2), [[-9, -2], [-5, 2], [0, 5], [5, 2], [9, -2]], 1.25),

  // Wide water and the green-moon bell: sparse silhouettes preserve the reveal.
  ...ribbons(bar(8.4), [[-10, 1], [-4, 5], [4, -3], [10, 2]], 5.6),
  ...spores(bar(10), 5, 9, 5.2),

  // Back inside: alternating high/low clamps and clockwise/counterclockwise schools.
  ...claspers(bar(11.5), [[-9, 4], [-5, -3], [0, 5], [5, -3], [9, 4]], 1.1, 5),
  ...ribbons(bar(13.4), [[-10, -3], [-6, 4], [0, 0], [6, 4], [10, -3]], 4.8),
  ...spores(bar(15), 6, 10, 4.8),

  // The animal wakes: formations widen and arrive on brighter musical phrases.
  ...claspers(bar(17), [[-11, 0], [-7, 5], [-3, -4], [3, -4], [7, 5], [11, 0]], 0.9, 4.8),
  ...ribbons(bar(19), [[-11, 4], [-7, -2], [-2, 5], [2, -4], [7, 2], [11, -3]], 4.7),
  ...spores(bar(20.5), 6, 11, 4.6),

  // Parent and its three feeding broods. The parent is present but cannot be
  // locked until every violet brood-heart has been removed from the lattice.
  PARENT_ENTRY,
  ...([ 
    { time: bar(23.1), kind: 'brood', data: { role: 'brood', slot: 0 } },
    { time: bar(23.9), kind: 'brood', data: { role: 'brood', slot: 1 } },
    { time: bar(24.7), kind: 'brood', data: { role: 'brood', slot: 2 } },
  ] satisfies Entry[]),
].sort((a, b) => a.time - b.time);

const SCORES: Record<StrandlineS5cxEnemyKind, number> = {
  clasper: 120,
  ribbon: 155,
  spore: 95,
  brood: 520,
  parent: 3200,
};

export function createStrandlineS5cxGameplay(bus: EventBus): LockOnRunnerLevel<StrandlineS5cxEnemyKind, StrandlineS5cxSpawnData> {
  let broodKills = 0;
  let parentDestroyed = false;
  let cleansed = 0;
  const broodIds = new Set<number>();
  let parentId = -1;

  bus.on('runstart', () => {
    broodKills = 0;
    parentDestroyed = false;
    cleansed = 0;
    broodIds.clear();
    parentId = -1;
  });
  bus.on('spawn', ({ enemyId, kind }) => {
    if (kind === 'brood') broodIds.add(enemyId);
    if (kind === 'parent') {
      parentId = enemyId;
      bus.emit('bossphase', { phase: 'summoned' });
    }
  });
  bus.on('kill', ({ enemyId }) => {
    cleansed += 1;
    if (broodIds.has(enemyId)) {
      broodIds.delete(enemyId);
      broodKills += 1;
      if (broodKills === 3) {
        bus.emit('bossphase', { phase: 'exposed' });
      }
    }
    if (enemyId === parentId) {
      parentDestroyed = true;
      bus.emit('bossphase', { phase: 'destroyed' });
    }
  });

  function updateClasper(context: Update, data: Extract<StrandlineS5cxSpawnData, { role: 'clasp' }>) {
    const state = context.enemyState(() => ({ struck: false }));
    const anchor = context.railAnchor(data.lead);
    const release = MathUtils.smoothstep(context.age, data.detach, data.detach + 1.65);
    const clampedSide = data.side * 2.05;
    const huntSide = -data.side * 0.42 + Math.sin(context.age * 3.1 + data.phase) * 2.4;
    const offset = new Vector3(
      MathUtils.lerp(clampedSide, huntSide, release),
      MathUtils.lerp(data.height * 1.85, data.height * 0.25 - 0.8, release) + Math.sin(context.age * 4.4 + data.phase) * 0.45,
      release * release * 7,
    );
    context.enemy.mesh.position.copy(offsetFromRail(context.curve, anchor, offset));
    context.enemy.mesh.lookAt(context.camera.position);
    context.enemy.mesh.rotateZ(Math.sin(context.age * 5 + data.phase) * 0.16 + release * data.side * 0.018);
    // Two central tutorial clamps complete their defensive lunge if ignored;
    // later waves remain sweep targets rather than turning the finale punitive.
    if (!state.struck && data.side === 0 && context.enemy.spawnTime < 20 && context.age >= data.lead - 0.35) {
      state.struck = true;
      context.damagePlayer(1);
      return true;
    }
    return context.runProgress > anchor + 0.025;
  }

  function updateRibbon(context: Update, data: Extract<StrandlineS5cxSpawnData, { role: 'ribbon' }>) {
    const anchor = context.railAnchor(data.lead);
    const crossing = Math.sin(context.age * 1.05 + data.phase);
    const offset = new Vector3(
      data.side * 1.45 + crossing * 5.4 * data.direction,
      data.height * 1.6 + Math.cos(context.age * 1.7 + data.phase) * 2.6,
      Math.sin(context.age * 0.75 + data.phase) * 2,
    );
    context.enemy.mesh.position.copy(offsetFromRail(context.curve, anchor, offset));
    context.enemy.mesh.lookAt(context.camera.position);
    context.enemy.mesh.rotateZ(-crossing * 0.72);
    context.enemy.mesh.rotateY(Math.sin(context.age * 2.2) * 0.3);
    return context.runProgress > anchor + 0.022;
  }

  function updateSpore(context: Update, data: Extract<StrandlineS5cxSpawnData, { role: 'spore' }>) {
    const anchor = context.railAnchor(data.lead);
    const angle = data.phase + context.age * 1.08 * data.direction;
    const radius = data.radius * (1 + Math.sin(context.age * 2.2 + data.phase) * 0.12);
    context.enemy.mesh.position.copy(offsetFromRail(context.curve, anchor, new Vector3(
      Math.cos(angle) * radius * 1.55,
      Math.sin(angle) * radius + 1,
      Math.cos(context.age * 1.6 + data.phase) * 1.4,
    )));
    context.enemy.mesh.lookAt(offsetFromRail(context.curve, anchor, new Vector3(0, 1, 0)));
    context.enemy.mesh.rotateZ(context.age * 2.8 * data.direction);
    return context.runProgress > anchor + 0.022;
  }

  function updateBrood(context: Update, data: Extract<StrandlineS5cxSpawnData, { role: 'brood' }>) {
    const anchor = 0.98;
    const angle = data.slot / 3 * Math.PI * 2 - Math.PI / 2;
    const breathe = 1 + Math.sin(context.age * 3.4 + data.slot) * 0.08;
    context.enemy.mesh.position.copy(offsetFromRail(context.curve, anchor, new Vector3(
      Math.cos(angle) * 6 * breathe,
      Math.sin(angle) * 4 * breathe + 1.5,
      -data.slot * 1.4,
    )));
    context.enemy.mesh.lookAt(context.camera.position);
    context.enemy.mesh.rotateZ(angle + Math.sin(context.age * 2) * 0.12);
    return false;
  }

  function updateParent(context: Update) {
    const anchor = 0.98;
    const stage = context.enemy.hitStageIndex;
    const exposed = broodKills === 3;
    const shudder = stage > 0 ? Math.sin(context.age * (11 + stage * 2)) * 0.32 : 0;
    context.enemy.mesh.position.copy(offsetFromRail(context.curve, anchor, new Vector3(shudder, 4 + shudder, -2)));
    context.enemy.mesh.lookAt(context.camera.position);
    context.enemy.mesh.rotateZ(Math.sin(context.age * 0.85) * 0.12 + stage * 0.08);
    context.enemy.mesh.scale.setScalar((exposed ? 1 : 0.94) * (1 + Math.sin(context.age * 2.2) * 0.025));
    return false;
  }

  return {
    duration: STRANDLINE_S5CX_RUN_DURATION,
    bpm: STRANDLINE_S5CX_BPM,
    playerHealth: 4,
    createRail: createStrandlineS5cxRail,
    spawnTimeline: STRANDLINE_S5CX_SPAWN_TIMELINE,
    startWord: 'RESTORE',
    replayWord: 'RETURN',
    lockRadiusNdc: 0.2,
    timing: {
      shotDelay: { maxGridSeconds: 0.4 },
      actionSfx: { enabled: true, gridThirtyseconds: 1 },
    },
    updateEnemy(context) {
      const data = context.enemy.entry.data;
      switch (data.role) {
        case 'clasp': return updateClasper(context, data);
        case 'ribbon': return updateRibbon(context, data);
        case 'spore': return updateSpore(context, data);
        case 'brood': return updateBrood(context, data);
        case 'parent': return updateParent(context);
      }
    },
    validateRelease(enemies) {
      return enemies.filter((enemy) => enemy.kind !== 'parent' || broodKills === 3);
    },
    scoreForHit: (volleySize) => 45 + volleySize * 7,
    scoreForKill(volleySize, enemy) {
      return Math.round(SCORES[enemy.kind] * (1 + Math.max(0, volleySize - 1) * 0.17));
    },
    scoreForVolley(results) {
      return results.length === 6 ? 420 : results.length >= 4 ? 130 : 0;
    },
    rankForRun(score, kills, total) {
      const ratio = total ? kills / total : 0;
      if (parentDestroyed && ratio >= 0.92) return 'LUMINOUS';
      if (parentDestroyed && ratio >= 0.72) return 'CURRENTKEEPER';
      if (parentDestroyed) return 'CLEANSED';
      if (broodKills === 3) return 'CROWNBOUND';
      return score > 5200 ? 'DRIFTER' : 'INFESTED';
    },
    detailsForRun() {
      return [
        `PARASITES CLEARED ${cleansed}`,
        `WEB ROOTS ${broodKills}/3`,
        parentDestroyed ? 'STRANDLINE RESTORED' : 'PARENT STILL ATTACHED',
      ];
    },
  };
}
