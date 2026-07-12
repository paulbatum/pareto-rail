import { CatmullRomCurve3, MathUtils, Vector3 } from 'three';
import type { LockOnEnemyUpdate, LockOnRunnerLevel, LockOnSpawnEntry } from '../../engine/lock-on-runner';
import { offsetFromRail } from '../../engine/rail';
import { createSpeedProfile } from '../../engine/speed-profile';
import type { EventBus } from '../../events';
import { MASS_DRIVER_BPM, MASS_DRIVER_DURATION, MASS_DRIVER_TIME } from './timing';

export { MASS_DRIVER_BPM as MASS_DRIVER_7RKV_BPM } from './timing';
export { MASS_DRIVER_DURATION as MASS_DRIVER_7RKV_RUN_DURATION } from './timing';

export type MassDriverEnemyKind = 'skimmer' | 'weaver' | 'clamp' | 'interlock';
export type MassDriverSpawnData =
  | { role: 'skimmer'; lead: number; side: number; y: number; sweep: number; phase: number }
  | { role: 'weaver'; lead: number; radiusX: number; radiusY: number; phase: number; direction: number }
  | { role: 'clamp'; lead: number; x: number; y: number; phase: number }
  | { role: 'interlock'; socket: number; phase: number };

type Spawn = LockOnSpawnEntry<MassDriverEnemyKind, MassDriverSpawnData>;
type Update = LockOnEnemyUpdate<MassDriverEnemyKind, MassDriverSpawnData>;

const SPEED = createSpeedProfile([
  [0, 0.34],
  [MASS_DRIVER_TIME.bar(8), 0.58],
  [MASS_DRIVER_TIME.bar(16), 0.92],
  [MASS_DRIVER_TIME.bar(24), 1.38],
  [MASS_DRIVER_TIME.bar(28), 1.72],
  [MASS_DRIVER_DURATION, 2.35],
], MASS_DRIVER_DURATION);

export const massDriverRunProgress = SPEED.runProgress;
export const massDriverSpeedAt = SPEED.speedAt;

export function createMassDriverRail() {
  // A mostly straight barrel with tiny magnetic-correction bends. The long
  // curve makes beat-to-beat distance visibly grow under the speed profile.
  return new CatmullRomCurve3([
    new Vector3(0, 0, 0),
    new Vector3(0, 0, -180),
    new Vector3(5, 2, -410),
    new Vector3(-6, -3, -720),
    new Vector3(4, 4, -1110),
    new Vector3(-3, -2, -1580),
    new Vector3(0, 0, -2160),
    new Vector3(0, 0, -2860),
  ], false, 'catmullrom', 0.32);
}

const t = (bar: number, beat = 0) => MASS_DRIVER_TIME.bar(bar, beat);

const skimmerWave = (bar: number, count: number, direction: number, high = false): Spawn[] =>
  Array.from({ length: count }, (_, i) => ({
    time: t(bar, i * 0.32),
    kind: 'skimmer',
    data: {
      role: 'skimmer', lead: 3.15, side: direction,
      y: (high ? 5.2 : -5.2) + (i % 2) * 2.4,
      sweep: 10.5 + i * 0.45, phase: i * 0.43,
    },
  }));

const weaverWheel = (bar: number, count: number, direction = 1): Spawn[] =>
  Array.from({ length: count }, (_, i) => ({
    time: t(bar, i * 0.22),
    kind: 'weaver',
    data: {
      role: 'weaver', lead: 3.45, radiusX: 9.2 + (i % 2) * 1.2,
      radiusY: 6.7 + (i % 3) * 0.55, phase: i / count * Math.PI * 2, direction,
    },
  }));

const clampBank = (bar: number, points: Array<[number, number]>): Spawn[] => points.map(([x, y], i) => ({
  time: t(bar, i * 0.35), kind: 'clamp', hitPoints: 2,
  data: { role: 'clamp', lead: 3.8, x: x * 1.22, y: y * 1.45, phase: i * 1.7 + bar },
}));

export const MASS_DRIVER_SPAWN_TIMELINE: Spawn[] = [
  ...skimmerWave(2, 4, 1),
  ...skimmerWave(4, 5, -1, true),
  ...weaverWheel(6, 5),
  ...skimmerWave(8, 6, 1, true),
  ...clampBank(10, [[-7, -3], [0, 5], [7, -3]]),
  ...weaverWheel(12, 6, -1),
  ...skimmerWave(14, 6, -1),
  ...clampBank(16, [[-8, 2], [-3, -4], [3, 5], [8, -1]]),
  ...weaverWheel(18, 6, 1),
  ...skimmerWave(20, 6, 1, true),
  ...clampBank(22, [[-8, -3], [-4, 4], [4, -4], [8, 3]]),
  ...weaverWheel(24, 6, -1),
  ...skimmerWave(26, 6, -1),
  ...Array.from({ length: 6 }, (_, socket): Spawn => ({
    time: t(28, socket * 0.12),
    kind: 'interlock',
    lockable: false,
    hitStages: [2, 2],
    data: { role: 'interlock', socket, phase: socket / 6 * Math.PI * 2 },
  })),
].sort((a, b) => a.time - b.time);

const KILL_SCORE: Record<MassDriverEnemyKind, number> = {
  skimmer: 120, weaver: 150, clamp: 260, interlock: 700,
};

export function createMassDriverGameplay(bus: EventBus): LockOnRunnerLevel<MassDriverEnemyKind, MassDriverSpawnData> {
  const liveInterlocks = new Set<number>();
  let overloadTriggered = false;
  let interlocksDestroyed = 0;

  bus.on('runstart', () => {
    liveInterlocks.clear();
    overloadTriggered = false;
    interlocksDestroyed = 0;
    for (const entry of MASS_DRIVER_SPAWN_TIMELINE) if (entry.kind === 'interlock') entry.lockable = false;
  });
  bus.on('spawn', ({ enemyId, kind }) => { if (kind === 'interlock') liveInterlocks.add(enemyId); });
  bus.on('kill', ({ enemyId }) => {
    if (liveInterlocks.delete(enemyId)) interlocksDestroyed += 1;
  });

  function updateEnemy({ enemy, age, runTime, curve, railAnchor, damagePlayer }: Update) {
    const data = enemy.entry.data;
    if (data.role === 'interlock') {
      // The six safeties pace the payload instead of being passed, so the
      // finale stays readable until the charge peaks.
      const u = MathUtils.clamp(massDriverRunProgress(runTime, MASS_DRIVER_DURATION) + 0.018, 0, 0.992);
      const angle = data.phase + Math.sin(runTime * 1.7 + data.socket) * 0.09;
      const radius = 7.4 + Math.sin(runTime * 2.3 + data.socket) * 0.45;
      enemy.mesh.position.copy(offsetFromRail(curve, u, new Vector3(Math.cos(angle) * radius, Math.sin(angle) * radius, 0)));
      enemy.mesh.rotation.z = angle + Math.PI / 2;
      enemy.mesh.rotation.y = Math.sin(runTime * 2 + data.socket) * 0.18;
      enemy.entry.lockable = runTime >= MASS_DRIVER_TIME.bar(28) + data.socket * 1.45;
      if (!overloadTriggered && runTime >= MASS_DRIVER_DURATION - 0.55 && liveInterlocks.size > 0) {
        overloadTriggered = true;
        damagePlayer(99);
      }
      return false;
    }

    const lead = data.lead;
    const u = railAnchor(lead);
    if (data.role === 'skimmer') {
      const p = MathUtils.clamp(age / 4.25, 0, 1);
      const x = data.side * MathUtils.lerp(-data.sweep, data.sweep, p);
      const y = data.y + Math.sin(p * Math.PI) * (3.6 + Math.sin(data.phase));
      enemy.mesh.position.copy(offsetFromRail(curve, u, new Vector3(x, y, 0)));
      enemy.mesh.rotation.z = -data.side * 0.7 + Math.sin(age * 3 + data.phase) * 0.14;
    } else if (data.role === 'weaver') {
      const a = data.phase + age * 1.72 * data.direction;
      enemy.mesh.position.copy(offsetFromRail(curve, u, new Vector3(Math.cos(a) * data.radiusX, Math.sin(a * 1.07) * data.radiusY, 0)));
      enemy.mesh.rotation.z = a + Math.PI / 2;
    } else {
      enemy.mesh.position.copy(offsetFromRail(curve, u, new Vector3(data.x, data.y, 0)));
      enemy.mesh.rotation.z = Math.atan2(data.y, data.x) + Math.PI / 2;
      enemy.mesh.rotation.y = Math.sin(age * 1.5 + data.phase) * 0.18;
    }
    return age > lead + 0.55;
  }

  return {
    duration: MASS_DRIVER_DURATION,
    bpm: MASS_DRIVER_BPM,
    createRail: createMassDriverRail,
    spawnTimeline: MASS_DRIVER_SPAWN_TIMELINE,
    updateEnemy,
    easeRunProgress: massDriverRunProgress,
    playerHealth: 3,
    lockRadiusNdc: 0.155,
    timing: {
      shotDelay: { maxGridSeconds: 0.42, gapThirtyseconds: 1, gridRampGapGrowthThirtyseconds: 1 },
      actionSfx: { enabled: true, gridThirtyseconds: 1 },
    },
    scoreForHit(volleySize) { return 35 + volleySize * 8; },
    scoreForKill(volleySize, enemy) { return KILL_SCORE[enemy.kind] + Math.max(0, volleySize - 1) * 35; },
    scoreForVolley(results) { return results.length === 6 && results.every((result) => result.killed) ? 1200 : 0; },
    rankForRun(score, kills, total) {
      const ratio = total ? kills / total : 0;
      if (ratio === 1 && score >= 11500) return 'RAIL SOVEREIGN';
      if (ratio >= 0.9) return 'MUZZLE VELOCITY';
      if (ratio >= 0.72) return 'SYNCHRONIZED';
      if (ratio >= 0.5) return 'INDUCTED';
      return 'SCRUBBED';
    },
    detailsForRun() {
      return interlocksDestroyed === 6
        ? ['SAFETIES 6/6', 'PAYLOAD LAUNCHED', 'ORBITAL VELOCITY: ACHIEVED']
        : [`SAFETIES ${interlocksDestroyed}/6`, 'CHARGE CONTAINMENT: FAILED', 'BARREL LOST'];
    },
  };
}
