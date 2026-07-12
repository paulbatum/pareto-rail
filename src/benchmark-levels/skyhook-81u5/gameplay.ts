import { CatmullRomCurve3, MathUtils, Vector3 } from 'three';
import type { LockOnEnemyUpdate, LockOnRunnerLevel, LockOnSpawnEntry } from '../../engine/lock-on-runner';
import { offsetFromRail } from '../../engine/rail';
import { createSpeedProfile } from '../../engine/speed-profile';
import type { EventBus } from '../../events';
import { SKYHOOK_BPM, SKYHOOK_DURATION, SKYHOOK_MARKERS, SKYHOOK_TIME, bar } from './timing';

export { SKYHOOK_BPM, SKYHOOK_DURATION } from './timing';
export const SKYHOOK_PLAYER_HEALTH = 4;

export type SkyhookEnemyKind = 'kite' | 'clamp' | 'sentinel' | 'debris' | 'boss';
export type SkyhookSpawnData =
  | { role: 'kite'; lead: number; side: number; lane: number; phase: number }
  | { role: 'clamp'; lead: number; side: number; high: number; strikeAge: number }
  | { role: 'sentinel'; lead: number; side: number; high: number; phase: number }
  | { role: 'debris'; lead: number; side: number; high: number; spin: number }
  | { role: 'boss'; startLead: number; reachAge: number };

export type SkyhookSpawnEntry = LockOnSpawnEntry<SkyhookEnemyKind, SkyhookSpawnData>;
type SkyhookUpdate = LockOnEnemyUpdate<SkyhookEnemyKind, SkyhookSpawnData>;

const speedProfile = createSpeedProfile([
  [0, 0.68], [bar(2), 0.9], [bar(6), 1.38], [bar(7), 1.08],
  [bar(11), 1.18], [bar(15), 0.82], [bar(21), 0.72], [bar(22), 0.48], [SKYHOOK_DURATION, 0.12],
], SKYHOOK_DURATION);

export const skyhookRunProgress = speedProfile.runProgress;
export const speedFactorAt = speedProfile.speedAt;

export function createSkyhookRail() {
  // The lateral bends are tiny against the vertical gain: this should feel like
  // a machine climbing a cable, with wind doing the moving down low.
  return new CatmullRomCurve3([
    new Vector3(0, 0, 0),
    new Vector3(2, 75, -12),
    new Vector3(-3, 170, -20),
    new Vector3(5, 280, -28),
    new Vector3(-2, 410, -38),
    new Vector3(3, 555, -48),
    new Vector3(-4, 710, -56),
    new Vector3(2, 870, -62),
    new Vector3(0, 1035, -68),
    new Vector3(0, 1185, -72),
  ], false, 'catmullrom', 0.36);
}

const stagger = SKYHOOK_TIME.seconds(0.13);

function fan(time: number, kind: 'kite' | 'sentinel', slots: Array<[number, number]>, lead = 4.8): SkyhookSpawnEntry[] {
  return slots.map(([side, high], i) => ({
    time: time + i * stagger,
    kind,
    data: kind === 'kite'
      ? { role: 'kite', lead, side: side * 2, lane: high * 1.5, phase: i * 1.37 + time }
      : { role: 'sentinel', lead, side: side * 2, high: high * 1.5, phase: i * 1.91 + time },
  }));
}

function clamps(time: number, slots: Array<[number, number]>, lead = 6.2): SkyhookSpawnEntry[] {
  return slots.map(([side, high], i) => ({
    time: time + i * stagger * 1.3,
    kind: 'clamp',
    hitPoints: 2,
    data: { role: 'clamp', lead, side: side * 1.8, high: high * 1.45, strikeAge: 5.7 + i * 0.15 },
  }));
}

function debris(time: number, slots: Array<[number, number]>): SkyhookSpawnEntry[] {
  return slots.map(([side, high], i) => ({
    time: time + i * stagger,
    kind: 'debris',
    countsTowardTotal: false,
    data: { role: 'debris', lead: 2.8, side: side * 1.75, high: high * 1.45, spin: (i % 2 ? -1 : 1) * (2.4 + i * 0.2) },
  }));
}

export function createSkyhookTimeline(): SkyhookSpawnEntry[] {
  const boss: SkyhookSpawnEntry = {
    time: SKYHOOK_MARKERS.boss,
    kind: 'boss',
    hitStages: [2, 2, 2],
    data: { role: 'boss', startLead: 9.5, reachAge: SKYHOOK_MARKERS.clear - SKYHOOK_MARKERS.boss - 0.2 },
  };
  return [
    // Weather: broad gull-like formations ride the crosswind.
    ...fan(bar(1), 'kite', [[-7, 1], [-3.5, 3.8], [0, 5], [3.5, 3.8], [7, 1]], 3.8),
    ...fan(bar(2.5), 'kite', [[-8, -2], [-4, 2], [4, 2], [8, -2]], 3.6),
    ...clamps(bar(3.5), [[-6, 2.8], [6, 2.8]], 4.5),
    ...fan(bar(4.4), 'kite', [[-9, 0], [-5.4, 3], [-1.8, 5], [1.8, 5], [5.4, 3], [9, 0]], 3.5),
    ...debris(bar(5.3), [[-8, -3], [-3, 5], [4, -1], [9, 4]]),

    // Cloudbreak: first hard sunlight and an attack on the car itself.
    ...clamps(bar(6.5), [[-7, 4], [0, 6], [7, 4]], 4.6),
    ...fan(bar(7.6), 'kite', [[-8, -2], [-4.8, 1], [-1.6, 3.6], [1.6, 3.6], [4.8, 1], [8, -2]], 3.4),
    ...fan(bar(9), 'sentinel', [[-7, 1], [-3.5, 4.5], [3.5, 4.5], [7, 1]], 3.8),
    ...debris(bar(9.8), [[-9, 5], [-4, -2], [2, 6], [8, 0]]),

    // Thin air: formations lose members and the hardware gets heavier.
    ...fan(bar(10.6), 'sentinel', [[-8, -1], [0, 5.8], [8, -1]], 3.7),
    ...clamps(bar(11.8), [[-6.5, 2], [6.5, 2]], 4.4),
    ...fan(bar(12.7), 'sentinel', [[-8, 0], [-4, 4], [0, 6], [4, 4], [8, 0]], 3.5),
    ...debris(bar(13.5), [[-10, 2], [-5, 6], [5, -2], [10, 4]]),
    ...fan(bar(14), 'sentinel', [[-6, 0], [0, 5], [6, 0]], 3.3),

    // It is visible from the instant the boss phrase begins and closes for 17.5s.
    boss,
  ].sort((a, b) => a.time - b.time);
}

export const SKYHOOK_TIMELINE = createSkyhookTimeline();

const KILL_SCORE: Record<SkyhookEnemyKind, number> = {
  kite: 110, clamp: 220, sentinel: 170, debris: 60, boss: 2400,
};

export function createSkyhookGameplay(bus: EventBus): LockOnRunnerLevel<SkyhookEnemyKind, SkyhookSpawnData> {
  let carHits = 0;
  let attackersStopped = 0;
  let bossKilled = false;
  const carAttackers = new Set<number>();

  bus.on('runstart', () => {
    carHits = 0;
    attackersStopped = 0;
    bossKilled = false;
    carAttackers.clear();
  });
  bus.on('spawn', ({ enemyId, kind }) => {
    if (kind === 'clamp') carAttackers.add(enemyId);
    if (kind === 'boss') bus.emit('bossphase', { phase: 'summoned' });
  });
  bus.on('kill', ({ enemyId }) => {
    if (carAttackers.delete(enemyId)) attackersStopped += 1;
  });
  bus.on('playerhit', () => { carHits += 1; });

  const updateEnemy = ({ enemy, runTime, age, curve, camera, railAnchor, enemyState, damagePlayer }: SkyhookUpdate) => {
    const data = enemy.entry.data;
    const state = enemyState(() => ({ struck: false, lastStage: -1 }));
    const drift = new Vector3();
    let anchorU = railAnchor(4.8);

    if (data.role === 'kite') {
      anchorU = railAnchor(data.lead);
      const sweep = Math.sin(age * 1.15 + data.phase);
      drift.set(data.side + sweep * 3.2, 2 + data.lane + Math.sin(age * 2.1 + data.phase) * 1.1, Math.cos(age * 1.4) * 1.5);
      enemy.mesh.rotation.z = -sweep * 0.7;
      enemy.mesh.rotation.y = Math.sin(age * 0.9 + data.phase) * 0.35;
    } else if (data.role === 'sentinel') {
      anchorU = railAnchor(data.lead);
      drift.set(data.side + Math.sin(age * 0.65 + data.phase) * 1.4, 2 + data.high + Math.cos(age * 1.1 + data.phase) * 1.8, 0);
      enemy.mesh.rotation.z = age * 0.42 * Math.sign(data.side || 1);
      enemy.mesh.rotation.x = Math.sin(age * 0.7 + data.phase) * 0.3;
    } else if (data.role === 'debris') {
      anchorU = railAnchor(data.lead - age * 0.45);
      drift.set(data.side + Math.sin(age * 2) * 1.4, 2 + data.high - age * 1.2, 0);
      enemy.mesh.rotation.x = age * data.spin;
      enemy.mesh.rotation.z = age * data.spin * 0.6;
    } else if (data.role === 'clamp') {
      const approach = MathUtils.smoothstep(age, 0.4, data.strikeAge);
      anchorU = railAnchor(MathUtils.lerp(data.lead, 0.25, approach));
      drift.set(MathUtils.lerp(data.side, Math.sign(data.side) * 2.7, approach), MathUtils.lerp(data.high + 2, -0.45, approach), 0);
      enemy.mesh.rotation.z = Math.sin(age * 3) * 0.12 - Math.sign(data.side) * approach * 0.35;
      if (age >= data.strikeAge && !state.struck) {
        state.struck = true;
        carAttackers.delete(enemy.id);
        damagePlayer();
      }
      if (state.struck && age >= data.strikeAge + 0.25) return true;
    } else {
      const close = MathUtils.smootherstep(Math.min(1, age / data.reachAge), 0, 1);
      anchorU = railAnchor(MathUtils.lerp(data.startLead, 0.35, close));
      drift.set(Math.sin(age * 0.45) * (2.4 - close), 5.8 - close * 6.2, 0);
      enemy.mesh.rotation.z = Math.sin(age * 1.1) * 0.08;
      if (enemy.hitStageIndex !== state.lastStage) {
        state.lastStage = enemy.hitStageIndex;
        if (enemy.hitStageIndex > 0) bus.emit('bossphase', { phase: 'exposed' });
      }
      if (age >= data.reachAge && !state.struck) {
        state.struck = true;
        damagePlayer(SKYHOOK_PLAYER_HEALTH);
      }
      if (age > data.reachAge + 0.5) return true;
    }

    enemy.mesh.position.copy(offsetFromRail(curve, anchorU, drift));
    if (data.role !== 'boss') enemy.mesh.quaternion.premultiply(camera.quaternion);
    return false;
  };

  let bossId = -1;
  bus.on('spawn', ({ enemyId, kind }) => { if (kind === 'boss') bossId = enemyId; });
  bus.on('kill', ({ enemyId }) => {
    if (enemyId === bossId) {
      bossKilled = true;
      bus.emit('bossphase', { phase: 'destroyed' });
    }
  });

  return {
    duration: SKYHOOK_DURATION,
    bpm: SKYHOOK_BPM,
    createRail: createSkyhookRail,
    spawnTimeline: SKYHOOK_TIMELINE,
    easeRunProgress: skyhookRunProgress,
    playerHealth: SKYHOOK_PLAYER_HEALTH,
    lockRadiusNdc: 0.15,
    timing: { shotDelay: { maxGridSeconds: 0.42 }, actionSfx: { gridThirtyseconds: 2 } },
    updateEnemy,
    scoreForHit(volleySize, enemy) {
      return enemy.kind === 'boss' ? 85 + volleySize * 15 : 45;
    },
    scoreForKill(volleySize, enemy) {
      return Math.round(KILL_SCORE[enemy.kind] * (1 + Math.max(0, volleySize - 1) * 0.13));
    },
    rankForRun(score, kills, total) {
      const ratio = total ? kills / total : 0;
      if (bossKilled && ratio >= 0.92 && carHits === 0) return 'ORBITAL';
      if (bossKilled && ratio >= 0.75) return 'ASCENDED';
      if (bossKilled) return 'DOCKED';
      return score > 0 ? 'SEVERED' : 'FALLEN';
    },
    detailsForRun() {
      return [
        `CAR ${Math.max(0, SKYHOOK_PLAYER_HEALTH - carHits)}/${SKYHOOK_PLAYER_HEALTH}`,
        `BOARDERS ${attackersStopped} STOPPED`,
        bossKilled ? 'SKYHOOK SECURE' : 'TETHER LOST',
      ];
    },
  };
}
