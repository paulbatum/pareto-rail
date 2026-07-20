import { CatmullRomCurve3, MathUtils, Vector3 } from 'three';
import {
  hostileShotAimPoint,
  shotBehindCamera,
  steerHomingShot,
  updateHostileShotImpact,
  type HostileShotImpactState,
} from '../../engine/hostile-shot';
import type { LockOnEnemyUpdate, LockOnRunnerLevel, LockOnSpawnEntry } from '../../engine/lock-on-runner';
import { offsetFromRail } from '../../engine/rail';
import { createSpeedProfile } from '../../engine/speed-profile';
import type { EventBus } from '../../events';
import { MASS_DRIVER_BARS, MASS_DRIVER_BPM, MASS_DRIVER_DURATION, MASS_DRIVER_SHOT_TIME, MASS_DRIVER_TIME } from './timing';

export { MASS_DRIVER_BPM as MASS_DRIVER_DETAILED_P8JN_BPM } from './timing';
export const MASS_DRIVER_DETAILED_P8JN_RUN_DURATION = MASS_DRIVER_DURATION;

export type MassDriverEnemyKind = 'coil' | 'threader' | 'capacitor' | 'arc' | 'interlock';
type RailData = { role: 'rail'; clock: number; phase: number; pattern: 'wall' | 'helix' | 'bank'; direction: number; firing?: boolean };
type ArcData = { role: 'arc'; position: Vector3; velocity: Vector3; lastAge: number; impact: HostileShotImpactState };
type InterlockData = { role: 'interlock'; clock: number; phase: number; firing: boolean };
export type MassDriverSpawnData = RailData | ArcData | InterlockData;
export type MassDriverSpawn = LockOnSpawnEntry<MassDriverEnemyKind, MassDriverSpawnData>;
type MassDriverUpdate = LockOnEnemyUpdate<MassDriverEnemyKind, MassDriverSpawnData>;

export type MassDriverRunState = {
  interlocksCleared: number;
  arcsIntercepted: number;
  hitsTaken: number;
  gunFired: boolean;
  detonated: boolean;
  shotResolved: boolean;
};

const bar = MASS_DRIVER_TIME.bar;
export const massDriverSpeed = createSpeedProfile([
  [0, 0.36], [bar(4), 0.58], [bar(12), 0.92], [bar(20), 1.35], [bar(25), 1.82],
  [MASS_DRIVER_SHOT_TIME - 0.03, 2.55], [MASS_DRIVER_SHOT_TIME, 7.65], [MASS_DRIVER_DURATION, 6.85],
], MASS_DRIVER_DURATION);
export const massDriverRunProgress = massDriverSpeed.runProgress;
export const MASS_DRIVER_MUZZLE_U = massDriverRunProgress(MASS_DRIVER_SHOT_TIME);

export function createMassDriverRail() {
  const points: Vector3[] = [];
  const segments = 34;
  for (let i = 0; i <= segments; i += 1) {
    const u = i / segments;
    const bore = MathUtils.clamp(u / MASS_DRIVER_MUZZLE_U, 0, 1);
    const taper = Math.pow(1 - bore, 1.7);
    const x = u < MASS_DRIVER_MUZZLE_U ? (Math.sin(u * Math.PI * 7.2) * 1.75 + Math.sin(u * Math.PI * 2.1) * 0.5) * taper : 0;
    const y = u < MASS_DRIVER_MUZZLE_U ? Math.cos(u * Math.PI * 5.4 + 0.7) * 1.15 * taper : Math.pow((u - MASS_DRIVER_MUZZLE_U) / (1 - MASS_DRIVER_MUZZLE_U), 1.35) * 82;
    points.push(new Vector3(x, y, -u * 4100));
  }
  return new CatmullRomCurve3(points, false, 'catmullrom', 0.38);
}

const railEnemy = (time: number, kind: 'coil' | 'threader' | 'capacitor', pattern: RailData['pattern'], clock: number, index: number, options: { direction?: number; firing?: boolean } = {}): MassDriverSpawn => ({
  time, kind, ...(kind === 'capacitor' ? { hitStages: [2, 2] } : {}),
  data: { role: 'rail', clock, phase: index * 1.731 + time * 0.37, pattern, direction: options.direction ?? (index % 2 === 0 ? 1 : -1), ...(options.firing !== undefined ? { firing: options.firing } : {}) },
});
const coilRank = (time: number, clocks: number[], firingFrom = 99) => clocks.map((clock, i) => railEnemy(time + i * MASS_DRIVER_TIME.stepSeconds * 0.72, 'coil', 'wall', clock, i, { firing: i >= firingFrom }));
const threaderWave = (time: number, count: number, vertical = 0) => Array.from({ length: count }, (_, i) => railEnemy(time + i * MASS_DRIVER_TIME.stepSeconds * 1.7, 'threader', 'helix', vertical + (i - (count - 1) / 2) * 0.9, i, { direction: i % 2 === 0 ? 1 : -1 }));
const capacitorPair = (time: number, clocks: number[]) => clocks.map((clock, i) => railEnemy(time + i * MASS_DRIVER_TIME.beatSeconds * 0.7, 'capacitor', 'bank', clock, i));
const bossEntries: MassDriverSpawn[] = ([[0, true], [2, false], [4, false], [6, true], [8, false], [10, false]] as const).map(([clock, firing], i) => ({
  time: bar(MASS_DRIVER_BARS.interlock) + (i < 3 ? i : i - 3) * MASS_DRIVER_TIME.stepSeconds * 1.2 + (i >= 3 ? MASS_DRIVER_TIME.beatSeconds * 1.3 : 0),
  kind: 'interlock', hitStages: [1, 2], data: { role: 'interlock', clock, phase: i * Math.PI / 3, firing },
}));

export const MASS_DRIVER_SPAWN_TIMELINE: MassDriverSpawn[] = [
  ...threaderWave(bar(0, 2), 2), ...coilRank(bar(2), [0, 2, 4, 6]), ...threaderWave(bar(3, 1), 3, -0.25),
  ...coilRank(bar(4), [0, 2, 4, 6, 8, 10]), ...threaderWave(bar(6), 5, 0.4), ...capacitorPair(bar(8), [2.1]),
  ...coilRank(bar(9), [1, 3, 5, 7, 9, 11]), ...threaderWave(bar(10, 2), 6, -0.5),
  ...coilRank(bar(12), [0, 1.7, 3.4, 5.1, 6.8, 8.5, 10.2], 3), ...threaderWave(bar(13, 3), 6, 0.5),
  ...capacitorPair(bar(15), [2.2, 8.2]), ...coilRank(bar(16, 2), [0, 2, 4, 6, 8, 10], 2), ...threaderWave(bar(18), 5, -0.3),
  ...bossEntries, ...threaderWave(bar(21, 2), 2, 0.8), ...threaderWave(bar(23, 2), 2, -0.9),
  ...threaderWave(bar(25), 2, 0.25), ...threaderWave(bar(26, 2), 2, -0.2),
].sort((a, b) => a.time - b.time);

const SCORE: Record<MassDriverEnemyKind, number> = { coil: 130, threader: 160, capacitor: 460, arc: 110, interlock: 900 };

export function createMassDriverGameplay(bus: EventBus) {
  const state: MassDriverRunState = { interlocksCleared: 0, arcsIntercepted: 0, hitsTaken: 0, gunFired: false, detonated: false, shotResolved: false };
  const firedAt = new Set<number>();
  const interlockIds = new Set<number>();
  const arcIds = new Set<number>();
  const targetedArcs = new Set<number>();
  bus.on('runstart', () => {
    Object.assign(state, { interlocksCleared: 0, arcsIntercepted: 0, hitsTaken: 0, gunFired: false, detonated: false, shotResolved: false });
    firedAt.clear(); interlockIds.clear(); arcIds.clear(); targetedArcs.clear();
  });
  bus.on('spawn', ({ enemyId, kind }) => { if (kind === 'interlock') interlockIds.add(enemyId); if (kind === 'arc') arcIds.add(enemyId); });
  bus.on('fire', ({ enemyId }) => { firedAt.add(enemyId); if (arcIds.has(enemyId)) targetedArcs.add(enemyId); });
  bus.on('miss', ({ enemyId }) => { firedAt.delete(enemyId); interlockIds.delete(enemyId); arcIds.delete(enemyId); targetedArcs.delete(enemyId); });
  bus.on('playerhit', () => { state.hitsTaken += 1; });
  bus.on('kill', ({ enemyId }) => {
    if (interlockIds.delete(enemyId)) {
      state.interlocksCleared += 1;
      if (state.interlocksCleared === 6) bus.emit('bossphase', { phase: 'destroyed' });
    } else if (arcIds.delete(enemyId) && targetedArcs.delete(enemyId)) state.arcsIntercepted += 1;
    firedAt.delete(enemyId);
  });

  function spawnArc(context: MassDriverUpdate, sideways = 0) {
    const from = context.enemy.mesh.position.clone();
    const target = hostileShotAimPoint(context.camera, from, 2).add(new Vector3(sideways, 0, 0));
    context.spawnEnemy({ time: context.runTime, kind: 'arc', countsTowardTotal: false, data: { role: 'arc', position: from, velocity: target.sub(from).normalize().multiplyScalar(8.5), lastAge: 0, impact: {} } });
  }

  function updateRailEnemy(context: MassDriverUpdate, data: RailData) {
    const anchor = Math.min(MASS_DRIVER_MUZZLE_U - 0.004, context.runProgress + (data.pattern === 'bank' ? 0.0105 : data.pattern === 'wall' ? 0.009 : 0.0085));
    const theta = (data.clock / 12) * Math.PI * 2;
    let x = Math.sin(theta) * 8.9;
    let y = Math.cos(theta) * 8.9;
    let fireArc = false;
    if (data.pattern === 'wall') {
      const orbit = theta + data.direction * context.age * 0.23;
      let wallRadius = 10.15;
      if (data.firing) {
        const fire = context.enemyState(() => ({ next: 2.3 + (context.enemy.id % 4) * 0.31 }));
        const tell = MathUtils.clamp((context.age - (fire.next - 0.48)) / 0.48, 0, 1);
        context.enemy.mesh.userData.fireTell = tell;
        context.enemy.mesh.userData.enemyAge = context.age;
        if (context.age >= fire.next && context.runTime < bar(19)) { fire.next += 3.65; context.enemy.mesh.userData.recoilUntil = context.age + 0.28; fireArc = true; }
        const recoilRemaining = Number(context.enemy.mesh.userData.recoilUntil ?? -1) - context.age;
        const lunge = recoilRemaining > 0 ? Math.sin((recoilRemaining / 0.28) * Math.PI) : 0;
        wallRadius += tell * 0.62 - lunge * 2.35;
      }
      x = Math.sin(orbit) * wallRadius; y = Math.cos(orbit) * wallRadius;
    } else if (data.pattern === 'helix') {
      const crossing = MathUtils.clamp(context.age / 3.9, 0, 1);
      const helix = context.age * 5.4 * data.direction + data.phase;
      x = MathUtils.lerp(-13.5 * data.direction, 13.5 * data.direction, crossing);
      y = data.clock * 2.8 + data.direction * 3.6 + Math.sin(crossing * Math.PI) * 2.1 + Math.sin(helix) * 2.05;
    } else {
      const drift = theta + Math.sin(context.age * 0.65 + data.phase) * 0.34;
      x = Math.sin(drift) * 7.25 + Math.sin(context.age * 0.8 + data.phase) * 1.45;
      y = Math.cos(drift) * 6.25 + Math.sin(context.age * 1.1 + data.phase) * 1.1;
    }
    context.enemy.mesh.position.copy(offsetFromRail(context.curve, anchor, new Vector3(x, y, 0)));
    context.enemy.mesh.quaternion.copy(context.camera.quaternion);
    context.enemy.mesh.rotateZ(data.pattern === 'wall'
      ? -theta + context.age * 0.2
      : data.pattern === 'helix'
        ? (data.direction < 0 ? Math.PI : 0) + Math.sin(context.age * 5.4 + data.phase) * 0.32
        : data.direction * context.age * 0.42);
    if (fireArc) spawnArc(context, Math.sin(theta) * 1.3);
    return context.age > (data.pattern === 'helix' ? 4.2 : data.pattern === 'bank' ? 6.7 : 5.6) || context.runTime >= MASS_DRIVER_SHOT_TIME - 0.08;
  }

  function updateArc(context: MassDriverUpdate, data: ArcData) {
    const dt = Math.max(0, context.age - data.lastAge); data.lastAge = context.age;
    const impact = updateHostileShotImpact({ age: context.age, camera: context.camera, position: data.position, velocity: data.velocity, state: data.impact, intercepted: firedAt.delete(context.enemy.id), config: { hitDistance: 2.5, impactBrake: 0.42, damageDistance: 0.75 } });
    if (impact.phase === 'braking') { context.enemy.mesh.position.copy(data.position); if (impact.damaged) { context.damagePlayer(1); return true; } return false; }
    steerHomingShot(data.position, data.velocity, hostileShotAimPoint(context.camera, data.position, 1.8), context.age, dt, { baseSpeed: 8.5, maxSpeed: 24, accel: 7.5, turnRate: 2.2 });
    context.enemy.mesh.position.copy(data.position); context.enemy.mesh.lookAt(data.position.clone().add(data.velocity));
    return context.age > 8 || shotBehindCamera(context.camera, data.position);
  }

  function updateInterlock(context: MassDriverUpdate, data: InterlockData) {
    const theta = (data.clock / 12) * Math.PI * 2;
    const charge = MathUtils.clamp((context.runTime - bar(20)) / (MASS_DRIVER_SHOT_TIME - bar(20)), 0, 1);
    const anchor = Math.min(MASS_DRIVER_MUZZLE_U - 0.003, context.runProgress + MathUtils.lerp(0.0105, 0.0065, charge));
    let radius = MathUtils.lerp(8.85, 7.75, charge);
    context.enemy.mesh.userData.charge = charge;
    const phase = context.enemyState(() => ({ next: 3 + (context.enemy.id % 2) * 0.65, detonated: false }));
    context.enemy.mesh.userData.enemyAge = context.age;
    context.enemy.mesh.userData.fireTell = data.firing ? MathUtils.clamp((context.age - (phase.next - 0.55)) / 0.55, 0, 1) : 0;
    let fireNow = false;
    if (data.firing && context.age >= phase.next && context.runTime < MASS_DRIVER_SHOT_TIME - 0.5) { phase.next += 4.25; context.enemy.mesh.userData.recoilUntil = context.age + 0.34; fireNow = true; }
    const recoilRemaining = Number(context.enemy.mesh.userData.recoilUntil ?? -1) - context.age;
    if (recoilRemaining > 0) radius -= Math.sin((recoilRemaining / 0.34) * Math.PI) * 0.72;
    context.enemy.mesh.position.copy(offsetFromRail(context.curve, anchor, new Vector3(Math.sin(theta) * radius, Math.cos(theta) * radius, 0)));
    context.enemy.mesh.quaternion.copy(context.camera.quaternion); context.enemy.mesh.rotateZ(-theta + Math.sin(context.age * 0.7 + data.phase) * 0.035);
    if (fireNow) spawnArc(context);
    if (context.runTime >= MASS_DRIVER_SHOT_TIME && !phase.detonated && !state.gunFired) {
      phase.detonated = true; state.detonated = true; state.shotResolved = true; context.damagePlayer(3);
    }
    return state.gunFired && context.runTime >= MASS_DRIVER_SHOT_TIME;
  }

  const level: LockOnRunnerLevel<MassDriverEnemyKind, MassDriverSpawnData> = {
    duration: MASS_DRIVER_DURATION, bpm: MASS_DRIVER_BPM, playerHealth: 3,
    createRail: createMassDriverRail, spawnTimeline: MASS_DRIVER_SPAWN_TIMELINE, easeRunProgress: massDriverRunProgress,
    lockRadiusNdc: 0.215, startWord: 'CHARGE', replayWord: 'RELOAD',
    timing: { shotDelay: { maxGridSeconds: 0.12 }, actionSfx: { gridThirtyseconds: 2 } },
    updateEnemy(context) { const data = context.enemy.entry.data; return data.role === 'arc' ? updateArc(context, data) : data.role === 'interlock' ? updateInterlock(context, data) : updateRailEnemy(context, data); },
    scoreForHit(volleySize, enemy) { return 35 + Math.max(0, volleySize - 1) * 9 + (enemy.kind === 'interlock' ? 35 : 0); },
    scoreForKill(volleySize, enemy) { return Math.round(SCORE[enemy.kind] * (1 + Math.max(0, volleySize - 1) * 0.22)); },
    scoreForVolley(results) { return results.length === 6 ? (results.every((result) => result.killed) ? 1200 : 420) : results.length >= 4 ? results.length * 35 : 0; },
    rankForRun(score, kills, totalEnemies) { const clear = totalEnemies ? kills / totalEnemies : 0; const fired = state.gunFired || (state.interlocksCleared === 6 && !state.detonated); if (fired && clear >= 0.99 && score >= 13500) return 'S'; if (fired && clear >= 0.73) return 'A'; if (clear >= 0.54) return 'B'; return 'C'; },
    detailsForRun() { const fired = state.gunFired || (state.interlocksCleared === 6 && !state.detonated); return [`HULL ${state.detonated ? 0 : Math.max(0, 3 - state.hitsTaken)}/3`, `INTERLOCKS ${state.interlocksCleared}/6`, `ARCS INTERCEPTED ${state.arcsIntercepted}`, fired ? 'PAYLOAD AWAY — muzzle exit clean' : 'CHARGE CONTAINMENT FAILED']; },
  };
  return Object.assign(level, { runState: state });
}
