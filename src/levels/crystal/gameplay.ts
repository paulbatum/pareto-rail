import { CatmullRomCurve3, MathUtils, Vector3 } from 'three';
import {
  hostileShotAimPoint,
  shotBehindCamera,
  steerHomingShot,
  updateHostileShotImpact,
} from '../../engine/hostile-shot';
import type { LockOnEnemyUpdate, LockOnRunnerLevel, LockOnSpawnEntry } from '../../engine/lock-on-runner';
import { offsetFromRail, smoothRunProgress } from '../../engine/rail';
import { formation, section, sortTimeline } from '../../engine/spawn-patterns';
import { createEventBus, type EventBus } from '../../events';
import { createDebugTimeline, type CrystalDebugTarget } from './debug';
import { CRYSTAL_BPM, CRYSTAL_MARKERS, CRYSTAL_RUN_DURATION, CRYSTAL_TIME } from './timing';
import { createCrystalWarden, type CrystalWarden, type WardenSpawnData } from './warden';

// A 45-second run in three acts: a familiar warm-up third, a dense middle
// where lancers start shooting back, and a heavier Crystal Warden finale after
// a short breath. The player has a 3-point hull; shard bolts home in on the
// center of the view and must be shot down before they land.

export { CRYSTAL_BPM, CRYSTAL_RUN_DURATION } from './timing';
export const CRYSTAL_PLAYER_HEALTH = 3;

export type CrystalEnemyKind =
  | 'node'
  | 'drifter'
  | 'orbiter'
  | 'lancer'
  | 'bolt'
  | 'warden-outer'
  | 'warden-shield'
  | 'warden-core';
export type CrystalTargetKind = CrystalEnemyKind | 'letter';
export type CrystalMovementPattern = 'hold' | 'drift' | 'orbit';

// Timeline entries carry immutable config only — the engine reuses the
// timeline across runs. Per-enemy runtime state (fire cadence) lives in a
// closure map keyed by enemy id; bolts are spawned dynamically with fresh
// data objects, so theirs may mutate.
type CrystalBoltData = {
  role: 'bolt';
  position: Vector3;
  velocity: Vector3;
  lastAge: number;
  impactAt?: number;
  impactDirection?: Vector3;
  interceptUntil?: number;
};

type CrystalWaveData = {
  role: 'wave';
  lead: number;
  pattern: CrystalMovementPattern;
  offset: Vector3;
  debugHold?: boolean;
  fireForever?: boolean;
};

export type CrystalSpawnData = CrystalBoltData | CrystalWaveData | WardenSpawnData;
export type CrystalSpawnEntry = LockOnSpawnEntry<CrystalEnemyKind, CrystalSpawnData>;
export type CrystalUpdate = LockOnEnemyUpdate<CrystalEnemyKind, CrystalSpawnData>;

export function createCrystalRail() {
  return new CatmullRomCurve3(
    [
      new Vector3(0, 0, 0),
      new Vector3(0, 2, -24),
      new Vector3(14, -1, -54),
      new Vector3(-10, 5, -86),
      new Vector3(-22, -2, -118),
      new Vector3(6, 3, -152),
      new Vector3(24, 8, -184),
      new Vector3(-4, 0, -220),
      new Vector3(-18, 6, -254),
      new Vector3(-6, -4, -288),
      new Vector3(14, 3, -320),
      new Vector3(4, 6, -350),
      new Vector3(0, 3, -380),
    ],
    false,
    'catmullrom',
    0.45,
  );
}

const wave = (
  time: number,
  lead: number,
  pattern: CrystalMovementPattern,
  kind: CrystalEnemyKind,
  offsets: Array<[number, number]>,
): CrystalSpawnEntry[] => formation(time, FORMATION_GAP, offsets, (offset) => ({
  kind,
  data: { role: 'wave', lead, pattern, offset: new Vector3(offset[0], offset[1], 0) },
}));

const lancers = (time: number, lead: number, offsets: Array<[number, number]>): CrystalSpawnEntry[] =>
  wave(time, lead, 'hold', 'lancer', offsets);

const time = CRYSTAL_TIME;
const BOSS_TIME = CRYSTAL_MARKERS.bossEntrance;
const FORMATION_GAP = time.seconds(0.18);

function createCrystalTimeline(warden: CrystalWarden): CrystalSpawnEntry[] {
  return [
    // --- Act 1: the familiar opening. Room to learn the sweep.
    ...section(CRYSTAL_MARKERS.run,
      wave(time.beats(2.52), 4.0, 'hold', 'node', [
        [-5, 1], [-2, 3], [2, 3], [5, 1],
      ]),
      wave(time.beats(8.82), 4.6, 'drift', 'drifter', [
        [-8, -1], [-4, 2], [0, 3], [4, 2], [8, -1],
      ]),
      wave(time.beats(15.54), 4.8, 'orbit', 'orbiter', [
        [-6, 4], [-3, 0], [3, 0], [6, 4],
      ]),
    ),

    // --- Act 2: the corridor wakes up. Times are relative to the act marker;
    // lancers are haloed crystals that fire homing shard bolts at the hull.
    ...section(CRYSTAL_MARKERS.gameplayAct2,
      wave(time.beats(1.26), 4.3, 'drift', 'drifter', [
        [-7, 2], [-3, -2], [2, 1], [7, -1],
      ]),
      wave(time.beats(6.72), 4.6, 'hold', 'node', [
        [-7, -1], [-3.5, 2], [0, 3.5], [3.5, 2], [7, -1],
      ]),
      lancers(time.beats(9.24), 5.0, [[0, 5.4]]),
      wave(time.beats(13.44), 4.7, 'orbit', 'orbiter', [
        [-9, 2], [-4.5, 5], [0, 2], [4.5, 5], [9, 2],
      ]),
      wave(time.beats(18.48), 4.4, 'drift', 'drifter', [
        [-7, 0], [-2, 3], [2, -1], [7, 2],
      ]),
      lancers(time.beats(20.16), 5.2, [[-6, 4], [6, 4]]),
      wave(time.beats(24.36), 4.5, 'hold', 'node', [
        [-7.5, 4], [-5, 1.5], [-2.5, -1], [2.5, -1], [5, 1.5], [7.5, 4],
      ]),
      wave(time.beats(28.98), 4.6, 'orbit', 'orbiter', [
        [-8, -1], [-3, 3], [3, 3], [8, -1],
      ]),
      lancers(time.beats(30.66), 4.8, [[-5, -2], [5, -2]]),
      wave(time.beats(34.02), 4.2, 'drift', 'drifter', [
        [-8, 1], [-5, -2], [-1.5, 3], [1.5, -1], [5, 2], [8, -1],
      ]),
      lancers(time.beats(38.22), 4.4, [[-3, 5], [3, 5]]),
      wave(time.beats(40.32), 3.4, 'hold', 'node', [
        [-4, 2], [0, 4], [4, 2],
      ]),
    ),

    // --- Act 3: the Crystal Warden. The delayed entrance gives the last
    // corridor wave room to clear after the bar-16 fill.
    ...warden.entries(BOSS_TIME),
  ];
}

const traceWarden = createCrystalWarden(createEventBus(), () => {});
export const CRYSTAL_TIMELINE: CrystalSpawnEntry[] = sortTimeline(createCrystalTimeline(traceWarden));

const KILL_SCORE: Record<CrystalEnemyKind, number> = {
  node: 100,
  drifter: 100,
  orbiter: 100,
  lancer: 150,
  bolt: 40,
  'warden-outer': 180,
  'warden-shield': 300,
  'warden-core': 1500,
};

const BOLT_MAX_AGE = 14;

export function createCrystalGameplay(
  bus: EventBus,
  debugTarget?: CrystalDebugTarget,
): LockOnRunnerLevel<CrystalEnemyKind, CrystalSpawnData> {
  const boltInterceptions = new Set<number>();
  let hitsTaken = 0;

  function fireBolt(context: CrystalUpdate, from: Vector3) {
    const initial = hostileShotAimPoint(context.camera, from).sub(from).normalize().multiplyScalar(4.5);
    context.spawnEnemy({
      time: context.runTime,
      kind: 'bolt',
      countsTowardTotal: false,
      data: { role: 'bolt', position: from.clone(), velocity: initial, lastAge: 0 },
    });
  }

  const warden = createCrystalWarden(bus, fireBolt);
  const timeline = debugTarget
    ? sortTimeline(createDebugTimeline(debugTarget, warden))
    : sortTimeline(createCrystalTimeline(warden));

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

  function updateWave(context: CrystalUpdate, data: Extract<CrystalSpawnData, { role: 'wave' }>) {
    const { enemy, runTime, runProgress, age, curve, camera, railAnchor } = context;
    const anchorU = data.debugHold
      ? MathUtils.clamp(runProgress + 0.08, 0, 1)
      : railAnchor(data.lead);
    const offset = data.offset.clone();
    if (data.pattern === 'drift') {
      offset.x += Math.sin(age * 0.85 + enemy.id) * 1.3 + age * 0.55;
      offset.y += Math.cos(age * 0.65 + enemy.id * 0.5) * 0.55;
    } else if (data.pattern === 'orbit') {
      offset.x += Math.cos(age * 2.2 + enemy.id) * 2.1;
      offset.y += Math.sin(age * 2.2 + enemy.id) * 2.1;
    }

    if (enemy.kind === 'lancer') {
      // Menace pulse: a slow push toward the camera sells intent.
      offset.z = Math.sin(age * 1.5) * 0.9;
      const fire = context.enemyState(() => ({
        nextAt: data.fireForever ? 0.8 : 1.4,
        shotsLeft: data.fireForever ? Number.POSITIVE_INFINITY : 2,
      }));
      if (fire.shotsLeft > 0 && age >= fire.nextAt) {
        fire.shotsLeft -= 1;
        fire.nextAt = age + (data.fireForever ? 1.8 : 3.2);
        fireBolt(context, enemy.mesh.position);
      }
    }

    enemy.mesh.position.copy(offsetFromRail(curve, anchorU, offset));
    enemy.mesh.quaternion.copy(camera.quaternion);
    enemy.mesh.rotateZ(runTime * (0.3 + (enemy.id % 5) * 0.09) + enemy.id * 1.7);
    enemy.mesh.rotateY(Math.sin(runTime * 0.8 + enemy.id * 1.3) * 0.4);
    enemy.mesh.rotateX(Math.cos(runTime * 0.65 + enemy.id * 2.1) * 0.3);

    return !data.debugHold && runProgress > anchorU + 0.018;
  }

  function updateBolt(context: CrystalUpdate, data: Extract<CrystalSpawnData, { role: 'bolt' }>) {
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
      enemy.mesh.rotateZ(age * 8);
      if (impact.damaged) {
        damagePlayer(1);
        return true;
      }
      return false;
    }

    // Ballistic launch that tightens into a homing run; speed ramps so the
    // player gets a beat to read it before it commits.
    steerHomingShot(data.position, data.velocity, hostileShotAimPoint(camera, data.position), age, dt, {
      baseSpeed: 5,
      maxSpeed: 11.5,
      accel: 3.2,
      turnRate: 2.2,
    });

    enemy.mesh.position.copy(data.position);
    enemy.mesh.quaternion.copy(camera.quaternion);
    enemy.mesh.rotateZ(age * 3.1);

    return shotBehindCamera(camera, data.position) || age > BOLT_MAX_AGE;
  }

  return {
    duration: debugTarget ? 90 : CRYSTAL_RUN_DURATION,
    bpm: CRYSTAL_BPM,
    playerHealth: CRYSTAL_PLAYER_HEALTH,
    createRail: createCrystalRail,
    spawnTimeline: timeline,
    easeRunProgress: smoothRunProgress,
    updateEnemy(context) {
      const data = context.enemy.entry.data;
      switch (data.role) {
        case 'wave':
          return updateWave(context, data);
        case 'bolt':
          return updateBolt(context, data);
        case 'outer':
        case 'shield':
        case 'core':
          return warden.update(context, data);
      }
    },
    validateRelease(enemies) {
      return warden.validateRelease(enemies);
    },
    scoreForKill(volleySize, enemy) {
      const multiplier = 1 + Math.max(0, volleySize - 1) * 0.15;
      return Math.round(KILL_SCORE[enemy.kind] * multiplier);
    },
    // Armor chips (non-lethal hits on shields and the core) pay a little.
    scoreForHit: () => 40,
    rankForRun(score, kills, totalEnemies) {
      const clearRate = totalEnemies === 0 ? 0 : kills / totalEnemies;
      if (score >= 9200 && clearRate >= 0.88) return 'S';
      if (score >= 6800 && clearRate >= 0.72) return 'A';
      if (score >= 4400 && clearRate >= 0.5) return 'B';
      if (score >= 2000 && clearRate >= 0.3) return 'C';
      return 'D';
    },
    detailsForRun() {
      const hull = Math.max(0, CRYSTAL_PLAYER_HEALTH - hitsTaken);
      const lines = [`Hull ${hull}/${CRYSTAL_PLAYER_HEALTH}`];
      const summary = warden.summary();
      if (summary) lines.push(summary);
      return lines;
    },
  };
}
