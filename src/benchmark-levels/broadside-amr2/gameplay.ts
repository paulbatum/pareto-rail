import { CatmullRomCurve3, MathUtils, Vector3 } from 'three';
import {
  hostileShotAimPoint,
  shotBehindCamera,
  steerHomingShot,
  updateHostileShotImpact,
} from '../../engine/hostile-shot';
import type { LockOnEnemy, LockOnEnemyUpdate, LockOnRunnerLevel, LockOnSpawnEntry } from '../../engine/lock-on-runner';
import { offsetFromRail, smoothRunProgress } from '../../engine/rail';
import { formation, section, sortTimeline } from '../../engine/spawn-patterns';
import { createMusicTime } from '../../engine/music-time';
import { createEventBus, type EventBus } from '../../events';

// Broadside: a 60-second fleet engagement. Launch off the flagship deck,
// thread the cruiser gaps, run the friendly broadside flank, rake an enemy
// warship's belly, then two passes on the enemy flagship — shield generators
// first, then the trench dive into its power core.
export const BROADSIDE_AMR2_BPM = 112;
export const BROADSIDE_AMR2_TIME = createMusicTime(BROADSIDE_AMR2_BPM, { stepsPerBar: 16 });
const TIME = BROADSIDE_AMR2_TIME;

export const BROADSIDE_AMR2_BARS = {
  launch: 0,
  broadside: 4,
  belly: 9,
  eye: 13,
  flagship: 17,
  trench: 21,
  finale: 26,
  end: 28,
} as const;

export const BROADSIDE_AMR2_MARKERS = TIME.markers({
  launch: BROADSIDE_AMR2_BARS.launch,
  broadside: BROADSIDE_AMR2_BARS.broadside,
  belly: BROADSIDE_AMR2_BARS.belly,
  eye: BROADSIDE_AMR2_BARS.eye,
  flagship: BROADSIDE_AMR2_BARS.flagship,
  trench: BROADSIDE_AMR2_BARS.trench,
  finale: BROADSIDE_AMR2_BARS.finale,
});

export const BROADSIDE_AMR2_RUN_DURATION = TIME.bar(BROADSIDE_AMR2_BARS.end);

export const BROADSIDE_AMR2_SCORE_SECTIONS = [
  { index: 0, fromBar: BROADSIDE_AMR2_BARS.launch },
  { index: 1, fromBar: BROADSIDE_AMR2_BARS.belly, crossfadeBars: 2 },
  { index: 2, fromBar: BROADSIDE_AMR2_BARS.flagship, crossfadeBars: 2 },
] as const;

export const BROADSIDE_AMR2_RUN_SECTIONS = [
  { name: 'launch', fromBar: 0, toBar: 4 },
  { name: 'broadside', fromBar: 4, toBar: 9 },
  { name: 'belly', fromBar: 9, toBar: 13 },
  { name: 'eye', fromBar: 13, toBar: 17 },
  { name: 'flagship', fromBar: 17, toBar: 21 },
  { name: 'trench', fromBar: 21, toBar: 26 },
  { name: 'finale', fromBar: 26 },
] as const;

export type BroadsideAmr2EnemyKind =
  | 'dart'
  | 'gunship'
  | 'weaver'
  | 'bolt'
  | 'shield-gen'
  | 'power-node'
  | 'flag-core';

type BoltData = {
  role: 'bolt';
  position: Vector3;
  velocity: Vector3;
  lastAge: number;
  impactAt?: number;
  impactDirection?: Vector3;
  interceptUntil?: number;
};

type WaveData = {
  role: 'wave';
  lead: number;
  pattern: 'hold' | 'weave' | 'corkscrew' | 'lumber';
  offset: Vector3;
};

type ShieldData = { role: 'shield'; index: number };
type NodeData = { role: 'node'; index: number };
type CoreData = { role: 'core' };

export type BroadsideAmr2SpawnData = BoltData | WaveData | ShieldData | NodeData | CoreData;
export type BroadsideAmr2SpawnEntry = LockOnSpawnEntry<BroadsideAmr2EnemyKind, BroadsideAmr2SpawnData>;
export type BroadsideAmr2Update = LockOnEnemyUpdate<BroadsideAmr2EnemyKind, BroadsideAmr2SpawnData>;

let railCurve: CatmullRomCurve3 | null = null;

export function createBroadsideAmr2Rail() {
  const curve = new CatmullRomCurve3(
    [
      new Vector3(0, 1.5, 0),
      new Vector3(3, 1.0, -42),
      new Vector3(15, 0.5, -92),
      new Vector3(11, 2.5, -142),
      new Vector3(-11, 4.5, -192),
      new Vector3(-15, -1.5, -242),
      new Vector3(-5, -4.0, -300),
      new Vector3(-2, -2.0, -358),
      new Vector3(-4, -4.5, -412),
      new Vector3(-3, 1.5, -462),
      new Vector3(-2, 7.0, -498),
    ],
    false,
    'catmullrom',
    0.4,
  );
  railCurve = curve;
  return curve;
}

export function broadsideAmr2RailCurve(): CatmullRomCurve3 | null {
  return railCurve;
}

const GAP = TIME.seconds(0.16);

const wave = (
  time: number,
  lead: number,
  pattern: WaveData['pattern'],
  kind: BroadsideAmr2EnemyKind,
  offsets: Array<[number, number]>,
): BroadsideAmr2SpawnEntry[] =>
  formation(time, GAP, offsets, (offset) => ({
    kind,
    data: { role: 'wave', lead, pattern, offset: new Vector3(offset[0], offset[1], 0) },
  }));

function createTimeline(flagship: FlagshipFight): BroadsideAmr2SpawnEntry[] {
  const F = TIME.bar(BROADSIDE_AMR2_BARS.flagship);
  return sortTimeline([
    // Launch: off the deck into the escort screen.
    ...section(TIME.bar(0),
      wave(TIME.beats(2), 4.2, 'hold', 'dart', [[-5, 1], [-1.5, 3], [2.5, 2.5], [6, 0.5]]),
      wave(TIME.beats(7), 4.4, 'weave', 'dart', [[-8, -1], [-4, 2], [0, 3.5], [4, 2], [8, -1]]),
      wave(TIME.beats(12.5), 4.4, 'corkscrew', 'weaver', [[-6, 3.5], [0, 0.5], [6, 3.5]]),
    ),
    // Broadside: the long flank run as the cruiser's guns light off.
    ...section(TIME.bar(4),
      wave(TIME.beats(1.5), 4.6, 'weave', 'dart', [[-7, 2], [-3, -2], [2, 1], [7, -1]]),
      wave(TIME.beats(5), 5.0, 'lumber', 'gunship', [[-5.5, 3.5]]),
      wave(TIME.beats(7.5), 4.5, 'hold', 'dart', [[-7.5, 4], [-5, 1], [-2, -1.5], [2, -1.5], [5, 1], [7.5, 4]]),
      wave(TIME.beats(11), 4.6, 'corkscrew', 'weaver', [[-6, -2], [0, 4], [6, -2]]),
      wave(TIME.beats(13.5), 4.8, 'lumber', 'gunship', [[5, -3]]),
    ),
    // Belly: along the enemy warship, raking turrets — the push.
    ...section(TIME.bar(9),
      wave(TIME.beats(1), 4.6, 'weave', 'dart', [[-8, 1], [-4, 4], [1, 1], [6, 3]]),
      wave(TIME.beats(4), 5.2, 'lumber', 'gunship', [[-6, -2.5], [6, 2.5]]),
      wave(TIME.beats(7), 4.4, 'corkscrew', 'weaver', [[-8, 3], [-3, -1], [3, 3], [8, -1]]),
      wave(TIME.beats(10), 4.5, 'hold', 'dart', [[-6, 0], [-2, 3], [2, -2], [6, 1]]),
      wave(TIME.beats(12.5), 4.2, 'weave', 'dart', [[-4, 2], [0, 4], [4, 2]]),
    ),
    // Eye: near silence, drifting wreckage and a thin screen.
    ...section(TIME.bar(13),
      wave(TIME.beats(2), 4.6, 'lumber', 'gunship', [[0, 1.5]]),
      wave(TIME.beats(7), 4.8, 'hold', 'dart', [[-5, 0], [5, 2]]),
      wave(TIME.beats(12), 4.6, 'weave', 'dart', [[-3, 3], [3, -1]]),
    ),
    // Flagship: shield generators along the first pass, escorts pouring in.
    ...flagship.entries(F),
    ...section(TIME.bar(18),
      wave(TIME.beats(1), 4.4, 'weave', 'dart', [[-7, 1], [-2, 3.5], [3, 0], [7, 2.5]]),
      wave(TIME.beats(5.5), 4.5, 'corkscrew', 'weaver', [[-6, -1], [0, 3], [6, -1]]),
      wave(TIME.beats(9), 4.6, 'weave', 'dart', [[-8, 3], [-4, -1], [0, 2], [4, -2], [8, 1]]),
    ),
    // Trench: the dive — power nodes plus a last screen.
    ...section(TIME.bar(21),
      wave(TIME.beats(1.5), 4.4, 'lumber', 'gunship', [[-6.5, 3], [6.5, -2]]),
      wave(TIME.beats(5), 4.3, 'weave', 'dart', [[-7, 0], [-3, 3], [1, -1], [5, 2]]),
      wave(TIME.beats(8.5), 4.4, 'corkscrew', 'weaver', [[-5, 2.5], [0, -1.5], [5, 2.5]]),
      wave(TIME.beats(12), 4.2, 'lumber', 'gunship', [[0, -3.5]]),
    ),
    // Finale: the flagship's crimson guard counterattacks through the pull-out.
    ...section(TIME.bar(25),
      wave(TIME.beats(0), 4.0, 'weave', 'dart', [[-6, 2], [-2, -1], [2, 3], [6, 0]]),
      wave(TIME.beats(2.5), 4.0, 'corkscrew', 'weaver', [[-4, 3], [4, -1]]),
    ),
    ...section(TIME.bar(26),
      wave(TIME.beats(2), 3.6, 'weave', 'dart', [[-5, 1], [0, 3.5], [5, 1]]),
    ),
  ]);
}

// --- Flagship fight ----------------------------------------------------------

export type FlagshipFight = ReturnType<typeof createFlagshipFight>;

const SHIELD_COUNT = 3;
const NODE_COUNT = 3;

export function createFlagshipFight(bus: EventBus, fireBolt: (context: BroadsideAmr2Update, from: Vector3) => void) {
  const corePosition = new Vector3();
  let coreId = -1;
  let coreSpawned = false;
  let coreKilled = false;
  let exposed = false;
  let defenseSpawned = 0;
  let shieldsDown = 0;
  let coreEntry: BroadsideAmr2SpawnEntry | undefined;
  let nodeEntries: BroadsideAmr2SpawnEntry[] = [];
  const shieldIds = new Set<number>();
  const liveDefenseIds = new Set<number>();
  const defensePositions = new Map<number, Vector3>();

  bus.on('runstart', () => {
    coreId = -1;
    coreSpawned = false;
    coreKilled = false;
    exposed = false;
    defenseSpawned = 0;
    shieldsDown = 0;
    shieldIds.clear();
    liveDefenseIds.clear();
    defensePositions.clear();
    if (coreEntry) coreEntry.lockable = false;
    for (const entry of nodeEntries) entry.lockable = false;
  });

  bus.on('spawn', ({ enemyId, kind }) => {
    if (kind === 'shield-gen' || kind === 'power-node') {
      liveDefenseIds.add(enemyId);
      defenseSpawned += 1;
    }
    if (kind === 'shield-gen') shieldIds.add(enemyId);
    if (kind === 'flag-core') {
      coreSpawned = true;
      coreId = enemyId;
      bus.emit('bossphase', { phase: 'summoned' });
    }
  });

  const exposeCore = () => {
    if (exposed || shieldsDown < SHIELD_COUNT) return;
    exposed = true;
    if (coreEntry) coreEntry.lockable = true;
    for (const entry of nodeEntries) entry.lockable = true;
    bus.emit('bossphase', { phase: 'exposed' });
  };

  const onDefenseGone = (enemyId: number) => {
    if (!liveDefenseIds.delete(enemyId)) return;
    defensePositions.delete(enemyId);
    if (shieldIds.delete(enemyId)) {
      shieldsDown += 1;
      exposeCore();
    }
  };

  bus.on('kill', ({ enemyId }) => {
    onDefenseGone(enemyId);
    if (enemyId === coreId && !coreKilled) {
      coreKilled = true;
      bus.emit('bossphase', { phase: 'destroyed' });
    }
  });

  bus.on('miss', ({ enemyId }) => {
    onDefenseGone(enemyId);
  });

  function entries(time: number): BroadsideAmr2SpawnEntry[] {
    const core: BroadsideAmr2SpawnEntry = {
      time: time + 0.6,
      kind: 'flag-core',
      hitStages: [4, 4],
      lockable: false,
      data: { role: 'core' },
    };
    const shields: BroadsideAmr2SpawnEntry[] = [0, 1, 2].map((index) => ({
      time: time + 0.15 + index * 0.14,
      kind: 'shield-gen',
      hitPoints: 2,
      data: { role: 'shield', index },
    }));
    const trenchStart = TIME.bar(BROADSIDE_AMR2_BARS.trench);
    const nodes: BroadsideAmr2SpawnEntry[] = [0, 1, 2].map((index) => ({
      time: trenchStart + index * 1.1,
      kind: 'power-node',
      hitPoints: 2,
      lockable: false,
      data: { role: 'node', index },
    }));
    coreEntry = core;
    nodeEntries = nodes;
    return [core, ...shields, ...nodes];
  }

  function updateShield(context: BroadsideAmr2Update, data: ShieldData) {
    const { enemy, runTime, age, camera } = context;
    // Screen-space triangle wheeling around the flagship core.
    const angle = data.index * ((Math.PI * 2) / SHIELD_COUNT) + runTime * 0.8;
    const right = new Vector3().setFromMatrixColumn(camera.matrixWorld, 0).normalize();
    const up = new Vector3().setFromMatrixColumn(camera.matrixWorld, 1).normalize();
    enemy.mesh.position
      .copy(corePosition)
      .addScaledVector(right, Math.cos(angle) * 7.8)
      .addScaledVector(up, Math.sin(angle) * 6.2);
    defensePositions.set(enemy.id, enemy.mesh.position.clone());
    enemy.mesh.quaternion.copy(camera.quaternion);
    enemy.mesh.rotateZ(runTime * 1.2 + data.index);
    // Point defense: throws flak at the player while the shield holds.
    const fire = context.enemyState(() => ({ nextAt: 2.2 + data.index * 1.1 }));
    if (age >= fire.nextAt) {
      fire.nextAt = age + 5.6;
      fireBolt(context, enemy.mesh.position);
    }
    return false;
  }

  function updateNode(context: BroadsideAmr2Update, data: NodeData) {
    const { enemy, runTime, runProgress, curve, camera } = context;
    // Trenchwork coils between the rail and the flagship's belly trench,
    // staggered in depth so the dive rakes them one after another.
    const aheadU = Math.min(1, runProgress + 0.028 + (NODE_COUNT - 1 - data.index) * 0.006);
    const lateral = new Vector3(
      (data.index - 1) * 5.2 + Math.sin(runTime * 1.1 + data.index * 2.1) * 0.5,
      1.2 + (data.index % 2) * 1.2,
      0,
    );
    enemy.mesh.position.copy(offsetFromRail(curve, aheadU, lateral));
    defensePositions.set(enemy.id, enemy.mesh.position.clone());
    enemy.mesh.quaternion.copy(camera.quaternion);
    enemy.mesh.rotateZ(runTime * 0.9 + data.index * 2);
    return false;
  }

  function updateCore(context: BroadsideAmr2Update) {
    const { enemy, runTime, age, runProgress, curve, camera } = context;
    // The flagship holds the sky ahead of the camera to the end of the rail.
    // The flagship holds off the port bow while the camera threads past;
    // the core burns in open space ahead, framed against her hull.
    const juke = exposed ? 1 : 0;
    const sway = new Vector3(
      -4 + Math.sin(runTime * 0.5) * 2.2 + juke * Math.sin(runTime * 2.7) * 1.6,
      2.2 + Math.sin(runTime * 0.75) * 1.2 + juke * Math.cos(runTime * 2.4) * 1.2,
      30 + juke * Math.sin(runTime * 3.3) * 2.0,
    );
    corePosition.copy(offsetFromRail(curve, MathUtils.clamp(runProgress, 0, 1), sway));
    enemy.mesh.position.copy(corePosition);
    enemy.mesh.quaternion.copy(camera.quaternion);
    enemy.mesh.rotateZ(runTime * 0.3);
    enemy.mesh.userData.exposed = exposed;

    if (exposed) {
      const fire = context.enemyState(() => ({ nextAt: age + 1.4 }));
      if (age >= fire.nextAt) {
        fire.nextAt = age + 3.0;
        const right = new Vector3().setFromMatrixColumn(camera.matrixWorld, 0).normalize();
        fireBolt(context, enemy.mesh.position.clone().addScaledVector(right, 2.4));
        fireBolt(context, enemy.mesh.position.clone().addScaledVector(right, -2.4));
      }
    }
    return false;
  }

  function update(context: BroadsideAmr2Update, data: ShieldData | NodeData | CoreData) {
    switch (data.role) {
      case 'shield':
        return updateShield(context, data);
      case 'node':
        return updateNode(context, data);
      case 'core':
        return updateCore(context);
    }
  }

  function validateRelease(
    enemies: Array<LockOnEnemy<BroadsideAmr2EnemyKind, BroadsideAmr2SpawnData>>,
  ): boolean | Array<LockOnEnemy<BroadsideAmr2EnemyKind, BroadsideAmr2SpawnData>> {
    // While any shield generator lives, the flagship's shield plate eats
    // volleys aimed at the core or trench systems. Mixed releases still let
    // swarm craft and flak through.
    const deniedIds = new Set<number>();
    const shieldFlashIds = new Set<number>();
    if (shieldIds.size > 0) {
      const aimed = enemies.filter((enemy) => enemy.kind === 'flag-core' || enemy.kind === 'power-node');
      if (aimed.length > 0) {
        for (const enemy of aimed) deniedIds.add(enemy.id);
        for (const enemyId of shieldIds) shieldFlashIds.add(enemyId);
      }
    }
    if (deniedIds.size === 0) return true;
    bus.emit('shielded', {
      shields: [...shieldFlashIds].map((enemyId) => ({
        enemyId,
        worldPosition: defensePositions.get(enemyId)?.clone() ?? corePosition.clone(),
      })),
      blockedEnemyIds: [...deniedIds],
    });
    return enemies.filter((enemy) => !deniedIds.has(enemy.id));
  }

  function summary() {
    if (!coreSpawned) return undefined;
    return coreKilled ? 'Enemy flagship destroyed' : 'Enemy flagship escaped';
  }

  return { entries, update, validateRelease, summary, corePosition: () => corePosition };
}

const KILL_SCORE: Record<BroadsideAmr2EnemyKind, number> = {
  dart: 100,
  weaver: 120,
  gunship: 150,
  bolt: 40,
  'shield-gen': 250,
  'power-node': 300,
  'flag-core': 1500,
};

const BOLT_MAX_AGE = 14;

export function createBroadsideAmr2Gameplay(bus: EventBus): LockOnRunnerLevel<BroadsideAmr2EnemyKind, BroadsideAmr2SpawnData> {
  const boltInterceptions = new Set<number>();
  let hitsTaken = 0;

  function fireBolt(context: BroadsideAmr2Update, from: Vector3) {
    const initial = hostileShotAimPoint(context.camera, from).sub(from).normalize().multiplyScalar(4.5);
    context.spawnEnemy({
      time: context.runTime,
      kind: 'bolt',
      countsTowardTotal: false,
      data: { role: 'bolt', position: from.clone(), velocity: initial, lastAge: 0 },
    });
  }

  const flagship = createFlagshipFight(bus, fireBolt);
  const timeline = sortTimeline(createTimeline(flagship));

  bus.on('runstart', () => {
    boltInterceptions.clear();
    hitsTaken = 0;
  });

  bus.on('playerhit', () => {
    hitsTaken += 1;
  });

  bus.on('fire', ({ enemyId }) => {
    boltInterceptions.add(enemyId);
  });

  bus.on('kill', ({ enemyId }) => {
    boltInterceptions.delete(enemyId);
  });

  bus.on('miss', ({ enemyId }) => {
    boltInterceptions.delete(enemyId);
  });

  function updateWave(context: BroadsideAmr2Update, data: WaveData) {
    const { enemy, runTime, runProgress, age, curve, camera, railAnchor } = context;
    const anchorU = railAnchor(data.lead);
    const offset = data.offset.clone();
    if (data.pattern === 'weave') {
      offset.x += Math.sin(age * 1.15 + enemy.id * 1.7) * 1.8;
      offset.y += Math.cos(age * 0.9 + enemy.id) * 0.9;
    } else if (data.pattern === 'corkscrew') {
      const spin = age * 2.6 + enemy.id;
      offset.x += Math.cos(spin) * 2.4;
      offset.y += Math.sin(spin) * 2.4;
    } else if (data.pattern === 'lumber') {
      // Gunships wallow across the lane, slow and menacing.
      offset.x += Math.sin(age * 0.5 + enemy.id) * 2.2 + age * 0.35;
      offset.y += Math.sin(age * 0.7 + enemy.id * 0.6) * 0.5;
      offset.z = Math.sin(age * 1.1) * 1.1;
    }
    enemy.mesh.position.copy(offsetFromRail(curve, anchorU, offset));
    enemy.mesh.quaternion.copy(camera.quaternion);
    if (enemy.kind === 'weaver') {
      enemy.mesh.rotateZ(-age * 2.6 - enemy.id);
    } else {
      enemy.mesh.rotateZ(runTime * (0.25 + (enemy.id % 5) * 0.07) + enemy.id * 1.3);
      enemy.mesh.rotateX(Math.cos(runTime * 0.6 + enemy.id * 1.9) * 0.25);
    }
    return runProgress > anchorU + 0.02;
  }

  function updateBolt(context: BroadsideAmr2Update, data: BoltData) {
    const { enemy, age, camera, damagePlayer } = context;
    const dt = Math.max(0, age - data.lastAge);
    data.lastAge = age;

    const impact = updateHostileShotImpact({
      age,
      camera,
      position: data.position,
      velocity: data.velocity,
      state: data,
      intercepted: boltInterceptions.delete(enemy.id),
    });
    if (impact.phase === 'braking') {
      enemy.mesh.position.copy(data.position);
      enemy.mesh.quaternion.copy(camera.quaternion);
      if (impact.damaged) {
        damagePlayer(1);
        return true;
      }
      return false;
    }

    steerHomingShot(data.position, data.velocity, hostileShotAimPoint(camera, data.position), age, dt, {
      baseSpeed: 5,
      maxSpeed: 12,
      accel: 3.4,
      turnRate: 2.3,
    });

    enemy.mesh.position.copy(data.position);
    enemy.mesh.quaternion.copy(camera.quaternion);
    return shotBehindCamera(camera, data.position) || age > BOLT_MAX_AGE;
  }

  return {
    duration: BROADSIDE_AMR2_RUN_DURATION,
    bpm: BROADSIDE_AMR2_BPM,
    playerHealth: 3,
    createRail: createBroadsideAmr2Rail,
    spawnTimeline: timeline,
    easeRunProgress: smoothRunProgress,
    updateEnemy(context) {
      const data = context.enemy.entry.data;
      switch (data.role) {
        case 'wave':
          return updateWave(context, data);
        case 'bolt':
          return updateBolt(context, data);
        case 'shield':
        case 'node':
        case 'core':
          return flagship.update(context, data);
      }
    },
    validateRelease(enemies) {
      return flagship.validateRelease(enemies);
    },
    updateCameraEffects({ camera, runTime }) {
      // Finale pull-out: past the breaking flagship, past both fleets, the
      // whole battle in frame as the enemy line burns.
      const pullStart = BROADSIDE_AMR2_RUN_DURATION - 4.2;
      if (runTime <= pullStart || railCurve === null) return;
      const t = Math.min(1, (runTime - pullStart) / 4.2);
      const eased = t * t * (3 - 2 * t);
      camera.position.y += eased * 10;
      camera.position.x += eased * 6;
      if (camera.fov !== undefined) {
        camera.fov = 62 + eased * 16;
        camera.updateProjectionMatrix();
      }
    },
    scoreForKill(volleySize, enemy) {
      const multiplier = 1 + Math.max(0, volleySize - 1) * 0.15;
      return Math.round(KILL_SCORE[enemy.kind] * multiplier);
    },
    scoreForHit: () => 40,
    rankForRun(score, kills, totalEnemies) {
      const clearRate = totalEnemies === 0 ? 0 : kills / totalEnemies;
      if (score >= 13000 && clearRate >= 0.88) return 'S';
      if (score >= 7800 && clearRate >= 0.7) return 'A';
      if (score >= 5000 && clearRate >= 0.5) return 'B';
      if (score >= 2400 && clearRate >= 0.3) return 'C';
      return 'D';
    },
    detailsForRun() {
      const hull = Math.max(0, 3 - hitsTaken);
      const lines = [`Hull ${hull}/3`];
      const summary = flagship.summary();
      if (summary) lines.push(summary);
      return lines;
    },
  };
}

export const BROADSIDE_AMR2_SPAWN_TIMELINE: BroadsideAmr2SpawnEntry[] = sortTimeline(
  createTimeline(createFlagshipFight(createEventBus(), () => {})),
);
