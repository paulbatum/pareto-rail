import { CatmullRomCurve3, MathUtils, Vector3 } from 'three';
import {
  hostileShotAimPoint,
  shotBehindCamera,
  steerHomingShot,
  updateHostileShotImpact,
  type HostileShotImpactState,
} from '../../engine/hostile-shot';
import type { LockOnEnemyUpdate, LockOnRunnerLevel, LockOnSpawnEntry } from '../../engine/lock-on-runner';
import { offsetFromRail, sampleRailFrame } from '../../engine/rail';
import { createSpeedProfile } from '../../engine/speed-profile';
import type { EventBus } from '../../events';
import {
  BROADSIDE_61Z2_BPM,
  BROADSIDE_61Z2_BARS,
  BROADSIDE_61Z2_MARKERS,
  BROADSIDE_61Z2_RUN_DURATION,
  BROADSIDE_61Z2_TIME,
} from './timing';

export {
  BROADSIDE_61Z2_BPM,
  BROADSIDE_61Z2_RUN_DURATION,
  BROADSIDE_61Z2_TIME,
} from './timing';

export type Broadside61z2EnemyKind =
  | 'skiff'
  | 'corsair'
  | 'interceptor'
  | 'point-defense'
  | 'bolt'
  | 'shield-generator'
  | 'power-core';

export type Broadside61z2SpawnData =
  | { role: 'skiff'; lead: number; fromX: number; toX: number; y: number; arc: number; delay: number; crossTime: number }
  | { role: 'corsair'; lead: number; x: number; y: number; phase: number; sweep: number }
  | { role: 'interceptor'; lead: number; phase: number; radius: number; lane: number }
  | { role: 'point-defense'; lead: number; x: number; y: number; fireAt: number; pulse: number }
  | { role: 'bolt'; position: Vector3; velocity: Vector3; lastAge: number; impact: HostileShotImpactState }
  | { role: 'shield-generator'; lead: number; x: number; y: number; z: number; socket: number }
  | { role: 'power-core'; lead: number; x: number; y: number; z: number; socket: number };

export type Broadside61z2SpawnEntry = LockOnSpawnEntry<Broadside61z2EnemyKind, Broadside61z2SpawnData>;
type Broadside61z2Update = LockOnEnemyUpdate<Broadside61z2EnemyKind, Broadside61z2SpawnData>;

const speedProfile = createSpeedProfile([
  [0, 0.72],
  [BROADSIDE_61Z2_TIME.bar(4), 0.92],
  [BROADSIDE_61Z2_TIME.bar(8), 1.16],
  [BROADSIDE_61Z2_TIME.bar(12), 0.98],
  [BROADSIDE_61Z2_TIME.bar(16), 1.22],
  [BROADSIDE_61Z2_TIME.bar(20), 0.9],
  [BROADSIDE_61Z2_TIME.bar(24), 1.08],
  [BROADSIDE_61Z2_TIME.bar(26), 1.34],
  [BROADSIDE_61Z2_RUN_DURATION, 1.62],
] as const, BROADSIDE_61Z2_RUN_DURATION);

export const broadside61z2RunProgress = speedProfile.runProgress;
export const broadside61z2SpeedAt = speedProfile.speedAt;

export function createBroadside61z2Rail() {
  return new CatmullRomCurve3(
    [
      new Vector3(0, 0, 0),
      new Vector3(8, 1.5, -58),
      new Vector3(-10, -3, -122),
      new Vector3(13, 4, -188),
      new Vector3(-15, -1, -256),
      new Vector3(11, -4, -326),
      new Vector3(-8, 3, -398),
      new Vector3(16, 1, -470),
      new Vector3(-12, -2, -542),
      new Vector3(8, 2.5, -616),
      new Vector3(0, 0, -690),
    ],
    false,
    'catmullrom',
    0.38,
  );
}

const stagger = BROADSIDE_61Z2_TIME.stepSeconds * 0.82;

function skiffWave(
  time: number,
  runs: Array<{ fromX: number; toX: number; y: number; arc: number; delay?: number; crossTime?: number }>,
  lead = 3.8,
): Broadside61z2SpawnEntry[] {
  return runs.map((run, index) => ({
    time: time + index * stagger,
    kind: 'skiff',
    data: {
      role: 'skiff',
      lead,
      fromX: run.fromX,
      toX: run.toX,
      y: run.y,
      arc: run.arc,
      delay: run.delay ?? index * 0.22,
      crossTime: run.crossTime ?? 2.6,
    },
  }));
}

function corsairSweep(
  time: number,
  positions: Array<{ x: number; y: number; phase?: number; sweep?: number }>,
  lead = 4.25,
): Broadside61z2SpawnEntry[] {
  return positions.map((position, index) => ({
    time: time + index * stagger,
    kind: 'corsair',
    data: {
      role: 'corsair',
      lead,
      x: position.x,
      y: position.y,
      phase: position.phase ?? index * 1.7,
      sweep: position.sweep ?? 2.5,
    },
  }));
}

function interceptorHelix(time: number, count: number, radius: number, lead = 4.1): Broadside61z2SpawnEntry[] {
  return Array.from({ length: count }, (_, index) => ({
    time: time + index * stagger,
    kind: 'interceptor',
    data: {
      role: 'interceptor',
      lead,
      phase: index / count * Math.PI * 2,
      radius,
      lane: index - (count - 1) / 2,
    },
  }));
}

function pointDefenseLine(time: number, positions: Array<[number, number]>, lead = 4.7): Broadside61z2SpawnEntry[] {
  return positions.map(([x, y], index) => {
    const spawnTime = time + index * stagger;
    return {
      time: spawnTime,
      kind: 'point-defense',
      data: {
        role: 'point-defense',
        lead,
        x,
        y,
        fireAt: spawnTime + 1.05 + (index % 2) * 0.55,
        pulse: index * 1.83 + time,
      },
    };
  });
}

function buildTimeline(): Broadside61z2SpawnEntry[] {
  const bar = BROADSIDE_61Z2_TIME.bar;
  const generators: Broadside61z2SpawnEntry[] = [
    [-15, 7.5, -0.4],
    [-7, 10, 0.4],
    [8, 9, -0.1],
    [15, 5.5, 0.7],
  ].map(([x, y, z], index) => ({
    time: bar(20, 0.25) + index * 0.95,
    kind: 'shield-generator',
    hitStages: [2, 1],
    data: { role: 'shield-generator', lead: 5.1, x, y, z, socket: index },
  }));

  const cores: Broadside61z2SpawnEntry[] = [
    [-8.5, -5.2, 0.2],
    [0, -7.2, -0.5],
    [8.5, -5.2, 0.1],
  ].map(([x, y, z], index) => ({
    time: bar(24, 1.25) + index * 1.2,
    kind: 'power-core',
    hitStages: [2, 1],
    lockable: false,
    data: { role: 'power-core', lead: 5.2, x, y, z, socket: index },
  }));

  return [
    // Launch: a clean fan teaches the player to sweep from low port to high starboard.
    ...skiffWave(bar(0.75), [
      { fromX: -24, toX: 24, y: -5.5, arc: 2.2 },
      { fromX: -24, toX: 24, y: 5.5, arc: 1.8, delay: 0.3 },
      { fromX: 24, toX: -24, y: 1.5, arc: 3.4, delay: 0.6 },
      { fromX: 24, toX: -24, y: 9.5, arc: 1.4, delay: 0.9 },
    ]),
    ...corsairSweep(bar(2.4), [
      { x: -15, y: 7, phase: 0.2 },
      { x: 3, y: -3.5, phase: 1.6 },
      { x: 16, y: 5, phase: 3.2 },
    ]),
    ...interceptorHelix(bar(3.5), 4, 6.8),

    // Skirmish: the fleet line becomes visible and point defense starts throwing crimson.
    ...skiffWave(bar(4.2), [
      { fromX: 25, toX: -25, y: -6.5, arc: 2.5 },
      { fromX: -25, toX: 25, y: 0, arc: 4.2, delay: 0.25 },
      { fromX: 25, toX: -25, y: 6, arc: 2.2, delay: 0.5 },
      { fromX: -25, toX: 25, y: 11, arc: 1.3, delay: 0.75 },
      { fromX: 25, toX: -25, y: 3.5, arc: 3.4, delay: 1.0 },
    ], 3.65),
    ...pointDefenseLine(bar(5.7), [[-18, 7], [18, 3], [-15, -4]], 4.8),
    ...corsairSweep(bar(6.5), [
      { x: -19, y: 1, sweep: 3.4 },
      { x: -4, y: 9, sweep: 2.7 },
      { x: 12, y: -5, sweep: 3.0 },
      { x: 21, y: 5, sweep: 2.1 },
    ], 4.0),
    ...skiffWave(bar(7.6), [
      { fromX: -26, toX: 26, y: -3, arc: 4.6, delay: 0 },
      { fromX: 26, toX: -26, y: 4, arc: 2.3, delay: 0.36 },
      { fromX: -26, toX: 26, y: 10, arc: 1.5, delay: 0.72 },
    ], 3.7),

    // Broadside: a friendly cruiser opens its guns overhead while enemy craft knot through it.
    ...interceptorHelix(bar(8.3), 6, 8.4, 4.1),
    ...corsairSweep(bar(9.5), [
      { x: -20, y: 8, phase: 0.3, sweep: 3.2 },
      { x: -8, y: -4, phase: 2.1, sweep: 2.4 },
      { x: 7, y: 5, phase: 3.6, sweep: 3.1 },
      { x: 20, y: 10, phase: 5.2, sweep: 2.2 },
      { x: 13, y: -6, phase: 0.9, sweep: 2.8 },
    ], 3.9),
    ...pointDefenseLine(bar(10.3), [[-21, 4], [17, 9], [0, -6], [22, -2]], 4.6),
    ...skiffWave(bar(11.2), [
      { fromX: 27, toX: -27, y: 9.5, arc: 1.8 },
      { fromX: -27, toX: 27, y: 4, arc: 2.8, delay: 0.25 },
      { fromX: 27, toX: -27, y: -2, arc: 4.2, delay: 0.5 },
      { fromX: -27, toX: 27, y: -7, arc: 2.3, delay: 0.75 },
      { fromX: 27, toX: -27, y: 1, arc: 3.6, delay: 1.0 },
      { fromX: -27, toX: 27, y: 7, arc: 2.1, delay: 1.25 },
    ], 3.65),

    // Crossfire: no neat formation — helices and diagonal banks trade places on alternate beats.
    ...skiffWave(bar(12.15), [
      { fromX: -28, toX: 28, y: -6, arc: 3.8, delay: 0, crossTime: 2.4 },
      { fromX: 28, toX: -28, y: 0.5, arc: 2.6, delay: 0.22, crossTime: 2.4 },
      { fromX: -28, toX: 28, y: 7, arc: 2.0, delay: 0.44, crossTime: 2.4 },
      { fromX: 28, toX: -28, y: 11.5, arc: 1.2, delay: 0.66, crossTime: 2.4 },
      { fromX: -28, toX: 28, y: 3, arc: 4.3, delay: 0.88, crossTime: 2.4 },
      { fromX: 28, toX: -28, y: -8, arc: 2.8, delay: 1.1, crossTime: 2.4 },
    ], 3.6),
    ...interceptorHelix(bar(13.25), 6, 9.7, 3.9),
    ...corsairSweep(bar(14.6), [
      { x: -18, y: 10, phase: 0.8, sweep: 3.5 },
      { x: -2, y: -7, phase: 2.4, sweep: 3.0 },
      { x: 16, y: 2, phase: 4.6, sweep: 3.5 },
      { x: 22, y: 9, phase: 5.8, sweep: 2.0 },
    ], 3.75),
    ...pointDefenseLine(bar(15.3), [[-22, 7], [2, -5], [22, 4]], 4.4),

    // Approach: the enemy flagship's amber silhouette rises beyond the next bank.
    ...skiffWave(bar(16.25), [
      { fromX: 28, toX: -28, y: -6, arc: 4.0 },
      { fromX: -28, toX: 28, y: 2, arc: 3.0, delay: 0.25 },
      { fromX: 28, toX: -28, y: 8.5, arc: 2.0, delay: 0.5 },
      { fromX: -28, toX: 28, y: 12, arc: 1.2, delay: 0.75 },
      { fromX: 28, toX: -28, y: 5, arc: 3.6, delay: 1.0 },
    ], 3.8),
    ...corsairSweep(bar(17.5), [
      { x: -20, y: 8, phase: 1.1 },
      { x: -8, y: -3, phase: 2.7 },
      { x: 8, y: 6, phase: 4.1 },
      { x: 20, y: -5, phase: 5.3 },
      { x: 15, y: 11, phase: 0.2 },
    ], 3.9),
    ...interceptorHelix(bar(18.45), 6, 10.6, 3.9),
    ...pointDefenseLine(bar(19.2), [[-21, 3], [0, 10], [21, 1], [-14, -7]], 4.7),

    // Boss pass one: four shield generators on the flagship's exposed flank.
    ...generators,
    ...skiffWave(bar(21.8), [
      { fromX: -25, toX: 25, y: -4, arc: 3.5, delay: 0 },
      { fromX: 25, toX: -25, y: 5, arc: 2.2, delay: 0.35 },
      { fromX: -25, toX: 25, y: 10, arc: 1.3, delay: 0.7 },
      { fromX: 25, toX: -25, y: 1, arc: 4.2, delay: 1.05 },
    ], 3.5),
    ...pointDefenseLine(bar(22.4), [[-19, 7], [18, 6], [5, -7]], 4.2),

    // Shield break: escorts pour out as the shield skin comes off. Core targets are present but gated.
    ...skiffWave(bar(24.15), [
      { fromX: 26, toX: -26, y: -6, arc: 4.0, delay: 0 },
      { fromX: -26, toX: 26, y: 0, arc: 3.0, delay: 0.24 },
      { fromX: 26, toX: -26, y: 7, arc: 2.2, delay: 0.48 },
      { fromX: -26, toX: 26, y: 11, arc: 1.2, delay: 0.72 },
      { fromX: 26, toX: -26, y: 3, arc: 3.7, delay: 0.96 },
      { fromX: -26, toX: 26, y: -2, arc: 2.5, delay: 1.2 },
    ], 3.55),
    ...cores,
    ...interceptorHelix(bar(25.55), 5, 8.8, 3.8),

    // Boss pass two: the rail dives under the hull into a short, hot trench run.
    ...pointDefenseLine(bar(26.4), [[-18, 7], [19, 3], [-5, -8], [22, 9]], 4.3),
    ...corsairSweep(bar(27.15), [
      { x: -16, y: 6, phase: 1.7, sweep: 2.4 },
      { x: 0, y: -4, phase: 3.4, sweep: 2.1 },
      { x: 16, y: 7, phase: 5.1, sweep: 2.4 },
      { x: 23, y: -3, phase: 0.5, sweep: 1.8 },
    ], 4.0),
    ...skiffWave(bar(28.15), [
      { fromX: -24, toX: 24, y: -5.5, arc: 3.2, delay: 0 },
      { fromX: 24, toX: -24, y: 2.5, arc: 2.4, delay: 0.32 },
      { fromX: -24, toX: 24, y: 8.5, arc: 1.7, delay: 0.64 },
    ], 3.75),
  ].sort((a, b) => a.time - b.time);
}

export const BROADSIDE_61Z2_SPAWN_TIMELINE = buildTimeline();

const scoreBase: Record<Broadside61z2EnemyKind, number> = {
  skiff: 95,
  corsair: 140,
  interceptor: 125,
  'point-defense': 230,
  bolt: 55,
  'shield-generator': 520,
  'power-core': 780,
};

const BOLT_MAX_AGE = 11;

function fireBolt(context: Broadside61z2Update, from: Vector3) {
  const initial = hostileShotAimPoint(context.camera, from).sub(from).normalize().multiplyScalar(5.8);
  context.spawnEnemy({
    time: context.runTime,
    kind: 'bolt',
    countsTowardTotal: false,
    data: { role: 'bolt', position: from.clone(), velocity: initial, lastAge: 0, impact: {} },
  });
}

function updateBolt(
  context: Broadside61z2Update,
  data: Extract<Broadside61z2SpawnData, { role: 'bolt' }>,
  interceptions: Set<number>,
) {
  const { enemy, age, camera, damagePlayer } = context;
  const dt = Math.max(0, age - data.lastAge);
  data.lastAge = age;
  const impact = updateHostileShotImpact({
    age,
    camera,
    position: data.position,
    velocity: data.velocity,
    state: data.impact,
    intercepted: interceptions.delete(enemy.id),
    config: { hitDistance: 2.6, impactBrake: 0.42, damageDistance: 0.58 },
  });
  if (impact.phase === 'braking') {
    enemy.mesh.position.copy(data.position);
    enemy.mesh.quaternion.copy(camera.quaternion);
    enemy.mesh.rotateZ(age * 15);
    enemy.mesh.userData.impact = true;
    if (impact.damaged) {
      damagePlayer(1);
      return true;
    }
    return false;
  }

  steerHomingShot(data.position, data.velocity, hostileShotAimPoint(camera, data.position, 2.6), age, dt, {
    baseSpeed: 5.8,
    maxSpeed: 15.5,
    accel: 3.8,
    turnRate: 2.7,
  });
  enemy.mesh.position.copy(data.position);
  enemy.mesh.lookAt(data.position.clone().add(data.velocity));
  enemy.mesh.rotateZ(age * 9);
  return age > BOLT_MAX_AGE || shotBehindCamera(camera, data.position);
}

function updateSkiff(context: Broadside61z2Update, data: Extract<Broadside61z2SpawnData, { role: 'skiff' }>) {
  const { enemy, runProgress, age, curve, railAnchor } = context;
  const anchorU = railAnchor(data.lead);
  const t = (age - data.delay) / data.crossTime;
  if (t > 1.12 || runProgress > anchorU + 0.024) return true;
  const k = MathUtils.clamp(t, 0, 1);
  const eased = k * k * (3 - 2 * k);
  const x = MathUtils.lerp(data.fromX, data.toX, eased);
  const y = data.y + Math.sin(k * Math.PI) * data.arc + Math.sin(age * 7.3 + enemy.id) * 0.24;
  enemy.mesh.position.copy(offsetFromRail(curve, anchorU, new Vector3(x, y, Math.sin(age * 3.2) * 0.8)));
  const ahead = offsetFromRail(curve, anchorU, new Vector3(
    MathUtils.lerp(data.fromX, data.toX, Math.min(1, eased + 0.06)),
    data.y + Math.sin(Math.min(1, k + 0.06) * Math.PI) * data.arc,
    0,
  ));
  enemy.mesh.lookAt(ahead);
  enemy.mesh.rotateZ((data.toX > data.fromX ? -1 : 1) * (0.35 + Math.sin(k * Math.PI) * 0.55));
  return false;
}

function updateCorsair(context: Broadside61z2Update, data: Extract<Broadside61z2SpawnData, { role: 'corsair' }>) {
  const { enemy, runProgress, age, curve, railAnchor } = context;
  const anchorU = railAnchor(data.lead);
  if (runProgress > anchorU + 0.024) return true;
  const sweep = Math.sin(age * 1.1 + data.phase) * data.sweep;
  const lift = Math.sin(age * 2.2 + data.phase * 0.7) * 1.25;
  const offset = new Vector3(data.x + sweep, data.y + lift, Math.cos(age * 1.6 + data.phase) * 1.8);
  enemy.mesh.position.copy(offsetFromRail(curve, anchorU, offset));
  enemy.mesh.lookAt(offsetFromRail(curve, anchorU, new Vector3(data.x + sweep * 0.3, data.y + lift, -2)));
  enemy.mesh.rotateZ(Math.sin(age * 1.4 + data.phase) * 0.52);
  return false;
}

function updateInterceptor(context: Broadside61z2Update, data: Extract<Broadside61z2SpawnData, { role: 'interceptor' }>) {
  const { enemy, runProgress, age, curve, camera, railAnchor } = context;
  const anchorU = railAnchor(data.lead);
  if (runProgress > anchorU + 0.024) return true;
  const angle = data.phase + age * (2.45 + runProgress * 1.6);
  const breathing = Math.sin(age * 2.1 + data.phase) * 0.85;
  const offset = new Vector3(
    Math.cos(angle) * (data.radius + breathing),
    Math.sin(angle) * (data.radius * 0.78 + breathing),
    Math.sin(age * 1.7 + data.lane) * 2.8,
  );
  enemy.mesh.position.copy(offsetFromRail(curve, anchorU, offset));
  enemy.mesh.lookAt(camera.position);
  enemy.mesh.rotateZ(angle + Math.PI / 2);
  return false;
}

function updatePointDefense(context: Broadside61z2Update, data: Extract<Broadside61z2SpawnData, { role: 'point-defense' }>) {
  const { enemy, runTime, runProgress, age, curve, camera, railAnchor } = context;
  const anchorU = railAnchor(data.lead);
  if (runProgress > anchorU + 0.024) return true;
  const fireState = context.enemyState(() => ({ shots: 0 }));
  const nextShot = data.fireAt + fireState.shots * 3.15;
  const charge = MathUtils.clamp((runTime - (nextShot - 0.68)) / 0.68, 0, 1);
  enemy.mesh.userData.charge = fireState.shots >= 2 ? 0 : charge;
  if (fireState.shots < 2 && runTime >= nextShot) {
    fireBolt(context, enemy.mesh.position);
    fireState.shots += 1;
    enemy.mesh.userData.justFiredUntil = runTime + 0.26;
  }
  const offset = new Vector3(
    data.x + Math.sin(age * 0.85 + data.pulse) * 0.55,
    data.y + Math.cos(age * 1.1 + data.pulse) * 0.35,
    Math.sin(age * 1.5 + data.pulse) * 1.2,
  );
  enemy.mesh.position.copy(offsetFromRail(curve, anchorU, offset));
  enemy.mesh.lookAt(camera.position);
  enemy.mesh.rotateZ(Math.sin(age * 0.7 + data.pulse) * 0.2);
  return false;
}

function updateBossTarget(context: Broadside61z2Update, data: Extract<Broadside61z2SpawnData, { role: 'shield-generator' | 'power-core' }>, exposed: boolean) {
  const { enemy, runProgress, age, curve, camera, railAnchor } = context;
  const anchorU = railAnchor(data.lead);
  if (data.role === 'power-core') {
    enemy.entry.lockable = exposed;
    enemy.mesh.userData.exposed = exposed;
  }
  if (runProgress > anchorU + 0.03) return true;
  const trenchPulse = data.role === 'power-core' ? Math.sin(age * 4.2 + data.socket) * 0.22 : Math.sin(age * 2.1 + data.socket) * 0.35;
  const offset = new Vector3(
    data.x + trenchPulse,
    data.y + Math.cos(age * 1.7 + data.socket) * (data.role === 'power-core' ? 0.18 : 0.42),
    data.z + Math.sin(age * 1.15 + data.socket) * (data.role === 'power-core' ? 0.55 : 1.2),
  );
  enemy.mesh.position.copy(offsetFromRail(curve, anchorU, offset));
  enemy.mesh.lookAt(camera.position);
  enemy.mesh.rotateZ(data.role === 'power-core' ? Math.sin(age * 1.8) * 0.2 : data.socket * 0.7 + age * 0.2);
  enemy.mesh.userData.bossAge = age;
  return false;
}

export function createBroadside61z2Gameplay(bus: EventBus): LockOnRunnerLevel<Broadside61z2EnemyKind, Broadside61z2SpawnData> {
  const generatorIds = new Set<number>();
  const coreIds = new Set<number>();
  const boltIds = new Set<number>();
  const boltInterceptions = new Set<number>();
  let bossSummoned = false;
  let bossExposed = false;
  let bossDestroyed = false;
  let generatorsDestroyed = 0;
  let coresDestroyed = 0;
  let interceptedBolts = 0;
  let hitsTaken = 0;

  bus.on('runstart', () => {
    generatorIds.clear();
    coreIds.clear();
    boltIds.clear();
    boltInterceptions.clear();
    bossSummoned = false;
    bossExposed = false;
    bossDestroyed = false;
    generatorsDestroyed = 0;
    coresDestroyed = 0;
    interceptedBolts = 0;
    hitsTaken = 0;
    for (const entry of BROADSIDE_61Z2_SPAWN_TIMELINE) {
      if (entry.kind === 'power-core') entry.lockable = false;
    }
  });
  bus.on('spawn', ({ enemyId, kind }) => {
    if (kind === 'shield-generator') {
      generatorIds.add(enemyId);
      if (!bossSummoned) {
        bossSummoned = true;
        bus.emit('bossphase', { phase: 'summoned' });
      }
    }
    if (kind === 'power-core') coreIds.add(enemyId);
    if (kind === 'bolt') boltIds.add(enemyId);
  });
  bus.on('fire', ({ enemyId }) => {
    if (boltIds.has(enemyId)) boltInterceptions.add(enemyId);
  });
  bus.on('kill', ({ enemyId }) => {
    if (generatorIds.delete(enemyId)) {
      generatorsDestroyed += 1;
      if (generatorIds.size === 0 && !bossExposed) {
        bossExposed = true;
        for (const entry of BROADSIDE_61Z2_SPAWN_TIMELINE) {
          if (entry.kind === 'power-core') entry.lockable = true;
        }
        bus.emit('bossphase', { phase: 'exposed' });
      }
    }
    if (coreIds.delete(enemyId)) {
      coresDestroyed += 1;
      if (coreIds.size === 0 && bossExposed && !bossDestroyed) {
        bossDestroyed = true;
        bus.emit('bossphase', { phase: 'destroyed' });
      }
    }
    if (boltIds.delete(enemyId)) {
      boltInterceptions.delete(enemyId);
      interceptedBolts += 1;
    }
  });
  bus.on('miss', ({ enemyId }) => {
    boltIds.delete(enemyId);
    boltInterceptions.delete(enemyId);
  });
  bus.on('playerhit', () => {
    hitsTaken += 1;
  });

  return {
    duration: BROADSIDE_61Z2_RUN_DURATION,
    bpm: BROADSIDE_61Z2_BPM,
    createRail: createBroadside61z2Rail,
    spawnTimeline: BROADSIDE_61Z2_SPAWN_TIMELINE,
    easeRunProgress: broadside61z2RunProgress,
    lockRadiusNdc: 0.16,
    playerHealth: 3,
    startWord: 'START!',
    replayWord: 'REPLAY',
    timing: {
      shotDelay: { maxGridSeconds: 0.2 },
      actionSfx: { enabled: true, gridThirtyseconds: 2 },
    },
    updateAttractCamera({ camera, curve, modeTime }) {
      const u = 0.025 + Math.sin(modeTime * 0.23) * 0.01;
      const frame = sampleRailFrame(curve, u);
      camera.position.copy(frame.position)
        .addScaledVector(frame.right, Math.sin(modeTime * 0.55) * 2.5)
        .addScaledVector(frame.up, 1.5 + Math.cos(modeTime * 0.42) * 1.1)
        .addScaledVector(frame.tangent, -2.5);
      camera.lookAt(frame.position.clone().addScaledVector(frame.tangent, 28).addScaledVector(frame.right, Math.sin(modeTime * 0.31) * 4));
    },
    updateEnemy(context) {
      const data = context.enemy.entry.data;
      switch (data.role) {
        case 'skiff':
          return updateSkiff(context, data);
        case 'corsair':
          return updateCorsair(context, data);
        case 'interceptor':
          return updateInterceptor(context, data);
        case 'point-defense':
          return updatePointDefense(context, data);
        case 'bolt':
          return updateBolt(context, data, boltInterceptions);
        case 'shield-generator':
        case 'power-core':
          return updateBossTarget(context, data, bossExposed);
      }
    },
    scoreForHit(volleySize, enemy) {
      const base = scoreBase[enemy.kind];
      return Math.round(base * 0.24 * (1 + Math.max(0, volleySize - 1) * 0.07));
    },
    scoreForKill(volleySize, enemy) {
      const base = scoreBase[enemy.kind];
      return Math.round(base * (1 + Math.max(0, volleySize - 1) * 0.15));
    },
    scoreForVolley(results) {
      if (results.length === 6 && results.every((result) => result.killed)) return 610;
      if (results.length >= 4 && results.every((result) => result.killed)) return results.length * 55;
      return 0;
    },
    rankForRun(score, kills, totalEnemies) {
      const clearRate = totalEnemies > 0 ? kills / totalEnemies : 0;
      if (bossDestroyed && generatorsDestroyed === 4 && coresDestroyed === 3 && score >= 14500 && clearRate >= 0.82) return 'ADMIRAL';
      if (bossDestroyed && clearRate >= 0.62) return 'CAPTAIN';
      if (generatorsDestroyed >= 2 && clearRate >= 0.42) return 'ACE';
      if (clearRate >= 0.2) return 'WING';
      return 'DRIFT';
    },
    detailsForRun() {
      return [
        `Flagship shield generators ${generatorsDestroyed}/4`,
        bossDestroyed ? 'Enemy flagship core ruptured' : bossExposed ? `Trench power systems ${coresDestroyed}/3` : 'Flagship shield held',
        `Crimson bolts intercepted ${interceptedBolts} · hull hits ${hitsTaken}`,
      ];
    },
  };
}
