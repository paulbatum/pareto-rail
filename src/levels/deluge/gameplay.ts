import { CatmullRomCurve3, MathUtils, Vector3 } from 'three';
import {
  hostileShotAimPoint,
  shotBehindCamera,
  steerHomingShot,
  updateHostileShotImpact,
  type HostileShotImpactState,
} from '../../engine/hostile-shot';
import type { LockOnEnemyUpdate, LockOnRunnerLevel, LockOnSpawnEntry } from '../../engine/lock-on-runner';
import { tempo } from '../../engine/music';
import { offsetFromRail } from '../../engine/rail';
import type { EventBus } from '../../events';
import { createDelugeDebugTimeline, type DelugeDebugTarget } from './debug';

export const DELUGE_BPM = 176;
const DELUGE_TEMPO = tempo(DELUGE_BPM);
export const DELUGE_BAR = DELUGE_TEMPO.barSeconds;
export const bar = DELUGE_TEMPO.bar;
export const DELUGE_DURATION = 150;
export const DELUGE_PLAYER_HEALTH = 5;

export const STREETFALL_TIME = bar(16);
export const UNDER_TIME = bar(40);
export const TUBE_TIME = bar(48);
export const CANAL_TIME = bar(64);
export const VULTURE_TIME = bar(64);
export const PHASE2_TIME = bar(84);
export const OUTRO_TIME = bar(104);

export type DelugeEnemyKind =
  | 'gnat'
  | 'interceptor'
  | 'turret'
  | 'barrier'
  | 'dropvan'
  | 'bolt'
  | 'flak'
  | 'vulturePod'
  | 'vultureCore';

export type DelugeSpawnData =
  | { role: 'gnat'; lead: number; center: Vector3; seed: number; boid: number; debugHold?: boolean }
  | { role: 'interceptor'; lead: number; side: -1 | 1; y: number; seed: number; fireAt?: number; debugHold?: boolean }
  | { role: 'turret'; lead: number; wall: -1 | 1 | 0; y: number; seed: number; fireEvery?: number; debugHold?: boolean }
  | { role: 'barrier'; lead: number; gapX: number; gapY: number; width: number; seed: number; debugHold?: boolean }
  | { role: 'dropvan'; lead: number; offset: Vector3; seed: number; debugHold?: boolean }
  | { role: 'shot'; position: Vector3; velocity: Vector3; lastAge: number; impact: HostileShotImpactState; flavor: 'bolt' | 'flak' }
  | { role: 'vulturePod'; side: -1 | 1; debugHold?: boolean }
  | { role: 'vultureCore'; debugHold?: boolean };

export type DelugeSpawnEntry = LockOnSpawnEntry<DelugeEnemyKind, DelugeSpawnData>;
export type DelugeUpdate = LockOnEnemyUpdate<DelugeEnemyKind, DelugeSpawnData>;

const SPEED_KEYS: Array<[number, number]> = [
  [0, 0.54],
  [bar(8), 0.64],
  [STREETFALL_TIME - 0.7, 0.72],
  [STREETFALL_TIME + 0.45, 1.65],
  [bar(24), 1.02],
  [UNDER_TIME - 0.45, 1.1],
  [UNDER_TIME + 0.35, 1.95],
  [bar(46), 1.62],
  [bar(56), 1.92],
  [CANAL_TIME, 1.35],
  [bar(74), 1.02],
  [PHASE2_TIME, 0.88],
  [bar(98), 0.95],
  [OUTRO_TIME, 1.15],
  [DELUGE_DURATION, 1.78],
];

export function speedFactorAt(time: number) {
  const t = MathUtils.clamp(time, 0, DELUGE_DURATION);
  for (let i = 1; i < SPEED_KEYS.length; i += 1) {
    if (t <= SPEED_KEYS[i][0]) {
      const [t0, v0] = SPEED_KEYS[i - 1];
      const [t1, v1] = SPEED_KEYS[i];
      return MathUtils.lerp(v0, v1, (t - t0) / Math.max(0.0001, t1 - t0));
    }
  }
  return SPEED_KEYS[SPEED_KEYS.length - 1][1];
}

const EASE_SAMPLES = 1600;
const easeTable: number[] = (() => {
  const table = [0];
  let sum = 0;
  const dt = DELUGE_DURATION / EASE_SAMPLES;
  for (let i = 1; i <= EASE_SAMPLES; i += 1) {
    sum += speedFactorAt((i - 0.5) * dt) * dt;
    table.push(sum);
  }
  const total = table[EASE_SAMPLES];
  return table.map((value) => value / total);
})();

export function delugeRunProgress(time: number, duration = DELUGE_DURATION) {
  const t = MathUtils.clamp(time / duration, 0, 1) * EASE_SAMPLES;
  const index = Math.min(EASE_SAMPLES - 1, Math.floor(t));
  return MathUtils.lerp(easeTable[index], easeTable[index + 1], t - index);
}

export const railU = (time: number) => delugeRunProgress(time);

export function createDelugeRail() {
  return new CatmullRomCurve3(
    [
      new Vector3(0, 128, 0),
      new Vector3(8, 120, -75),
      new Vector3(-12, 92, -150),
      new Vector3(16, 45, -245),
      new Vector3(0, 8, -340),
      new Vector3(-22, 4, -455),
      new Vector3(20, 2, -575),
      new Vector3(-18, -2, -700),
      new Vector3(12, -22, -820),
      new Vector3(-8, -44, -930),
      new Vector3(6, -54, -1060),
      new Vector3(-5, -54, -1200),
      new Vector3(7, -53, -1350),
      new Vector3(-12, -36, -1495),
      new Vector3(18, -18, -1625),
      new Vector3(-22, 8, -1740),
      new Vector3(16, 40, -1855),
      new Vector3(-12, 72, -1960),
      new Vector3(0, 126, -2085),
      new Vector3(0, 176, -2180),
    ],
    false,
    'catmullrom',
    0.42,
  );
}

const DEBUG_HOLD_PROGRESS_OFFSET = 0.016;
const SHOT_MAX_AGE = 12;

const KILL_SCORE: Record<DelugeEnemyKind, number> = {
  gnat: 90,
  interceptor: 190,
  turret: 240,
  barrier: 70,
  dropvan: 420,
  bolt: 45,
  flak: 55,
  vulturePod: 650,
  vultureCore: 3000,
};

function gnats(time: number, lead: number, center: [number, number], count: number, spread = 2.8): DelugeSpawnEntry[] {
  return Array.from({ length: count }, (_, i) => ({
    time: time + i * 0.09,
    kind: 'gnat',
    data: {
      role: 'gnat',
      lead,
      center: new Vector3(center[0] + (i - (count - 1) / 2) * spread, center[1] + Math.sin(i) * 1.1, 0),
      seed: time * 7.1 + i * 1.37,
      boid: i,
    },
  }));
}

function interceptors(time: number, lead: number, sides: Array<-1 | 1>): DelugeSpawnEntry[] {
  return sides.map((side, index) => ({
    time: time + index * 0.28,
    kind: 'interceptor',
    data: { role: 'interceptor', lead, side, y: 0.6 + index * 1.6, seed: time + side * 9 + index, fireAt: 1.4 + index * 0.35 },
  }));
}

function turrets(time: number, lead: number, placements: Array<[-1 | 1 | 0, number]>): DelugeSpawnEntry[] {
  return placements.map(([wall, y], index) => ({
    time: time + index * 0.18,
    kind: 'turret',
    hitStages: [2],
    data: { role: 'turret', lead, wall, y, seed: time + index * 3.3, fireEvery: 2.5 },
  }));
}

function barriers(time: number, lead: number, gaps: Array<[number, number, number]>): DelugeSpawnEntry[] {
  return gaps.map(([gapX, gapY, width], index) => ({
    time: time + index * 0.32,
    kind: 'barrier',
    countsTowardTotal: false,
    data: { role: 'barrier', lead, gapX, gapY, width, seed: time + index },
  }));
}

function dropvans(time: number, lead: number, offsets: Array<[number, number]>): DelugeSpawnEntry[] {
  return offsets.map(([x, y], index) => ({
    time: time + index * 0.35,
    kind: 'dropvan',
    hitStages: [3, 2],
    data: { role: 'dropvan', lead, offset: new Vector3(x, y, 0), seed: time + index * 1.9 },
  }));
}

function createVultureEntries(): { timeline: DelugeSpawnEntry[]; podEntries: DelugeSpawnEntry[]; coreEntry: DelugeSpawnEntry } {
  const podEntries: DelugeSpawnEntry[] = [
    { time: VULTURE_TIME + 1.0, kind: 'vulturePod', hitStages: [3, 3], data: { role: 'vulturePod', side: -1 } },
    { time: VULTURE_TIME + 1.3, kind: 'vulturePod', hitStages: [3, 3], data: { role: 'vulturePod', side: 1 } },
  ];
  const coreEntry: DelugeSpawnEntry = {
    time: PHASE2_TIME,
    kind: 'vultureCore',
    hitStages: [3, 3, 3],
    lockable: false,
    data: { role: 'vultureCore' },
  };
  return { timeline: [...podEntries, coreEntry], podEntries, coreEntry };
}

function buildTimeline(vultureEntries: DelugeSpawnEntry[]): DelugeSpawnEntry[] {
  return [
    // Act 1 — Freefall: storm ceiling, antenna crowns, first locks.
    ...gnats(bar(2), 4.8, [-3, 2.5], 3),
    ...gnats(bar(4), 4.6, [3.5, 3.4], 4),
    ...interceptors(bar(6), 5.0, [-1]),
    ...gnats(bar(8), 4.4, [0, 4.2], 6, 2.1),
    ...dropvans(bar(11), 5.0, [[0, 3.3]]),
    ...turrets(bar(13), 4.8, [[-1, 2.8], [1, 4.2]]),

    // bars 15.3–17 clear for Streetfall.
    ...gnats(bar(17.5), 4.2, [-5, 2.0], 5, 2.0),
    ...interceptors(bar(18), 4.6, [-1, 1]),
    ...turrets(bar(20), 4.7, [[-1, 1.6], [1, 3.4]]),
    ...gnats(bar(21), 4.1, [4, 4.5], 6, 1.7),
    ...dropvans(bar(23), 4.9, [[-4.5, 2.3], [4.5, 3.1]]),
    ...interceptors(bar(25), 4.3, [1, -1]),
    ...turrets(bar(26), 4.5, [[-1, 0.8], [0, 5.2], [1, 2.6]]),
    ...gnats(bar(28), 4.1, [0, 3.5], 7, 1.8),
    ...barriers(bar(30), 4.3, [[-3.8, 0, 3.2], [3.8, 0, 3.2]]),
    ...interceptors(bar(32), 4.2, [-1, 1]),
    ...dropvans(bar(34), 4.7, [[0, 4.2]]),
    ...turrets(bar(36), 4.4, [[-1, 2.0], [1, 2.0]]),
    ...gnats(bar(38), 4.0, [-3.5, 3], 5, 1.9),

    // bars 39.5–41 clear for The Under drop.
    ...barriers(bar(41), 3.8, [[0, 0, 4.8], [-4.5, 0, 3.0]]),
    ...turrets(bar(42), 3.9, [[-1, 2.6], [1, 2.6], [0, 5.2]]),
    ...gnats(bar(43), 3.6, [0, 2.8], 8, 1.3),
    ...interceptors(bar(45), 3.8, [-1, 1]),
    ...barriers(bar(47), 3.5, [[3.9, 0, 2.8], [-3.9, 0, 2.8]]),

    // Tube: half-bar panic, ring turrets, barriers.
    ...turrets(bar(49), 3.3, [[-1, 2.4], [1, 2.4]]),
    ...barriers(bar(50), 3.2, [[0, 0, 4.2], [4.2, 0, 2.8]]),
    ...gnats(bar(51), 3.2, [0, 3.0], 6, 1.1),
    ...turrets(bar(52), 3.3, [[0, 5.5], [-1, 1.5], [1, 1.5]]),
    ...barriers(bar(54), 3.1, [[-4.1, 0, 2.8], [0, 0, 4.0]]),
    ...interceptors(bar(55), 3.3, [-1, 1]),
    ...gnats(bar(56), 3.1, [-2, 3.5], 8, 1.0),
    ...barriers(bar(58), 3.0, [[4.5, 0, 2.4], [-4.5, 0, 2.4], [0, 0, 4.0]]),
    ...dropvans(bar(60), 3.4, [[0, 3.2]]),
    ...turrets(bar(62), 3.0, [[-1, 2.1], [1, 4.3], [0, 5.6]]),

    // Act 4 — Vulture chase up the citadel.
    ...vultureEntries,
    ...interceptors(bar(66), 4.2, [-1, 1]),
    ...gnats(bar(68), 3.8, [0, 3], 6, 1.4),
    ...turrets(bar(70), 4.0, [[-1, 2.6], [1, 2.6]]),
    ...dropvans(bar(72), 4.3, [[-4.5, 2.5], [4.5, 3.6]]),
    ...interceptors(bar(76), 4.0, [1, -1]),
    ...gnats(bar(78), 3.8, [2.5, 4], 7, 1.4),
    ...turrets(bar(80), 4.0, [[-1, 3.0], [1, 1.5], [0, 5.5]]),
    ...barriers(bar(82), 3.8, [[0, 0, 4.4]]),
    ...gnats(bar(86), 3.8, [-2.5, 3.2], 6, 1.3),
    ...interceptors(bar(88), 4.0, [-1, 1]),
    ...barriers(bar(90), 3.6, [[-4.2, 0, 2.8], [4.2, 0, 2.8]]),
    ...turrets(bar(92), 3.9, [[-1, 2.2], [1, 4.4]]),
    ...gnats(bar(94), 3.7, [0, 3.5], 8, 1.0),
    ...dropvans(bar(96), 4.0, [[0, 3.0]]),
    ...interceptors(bar(100), 3.8, [-1, 1]),
    ...barriers(bar(102), 3.5, [[0, 0, 4.2]]),
  ].sort((a, b) => a.time - b.time);
}

export const DELUGE_TIMELINE: DelugeSpawnEntry[] = buildTimeline(createVultureEntries().timeline);

function orientAlongVelocity(context: DelugeUpdate, position: Vector3, velocity: Vector3) {
  if (velocity.lengthSq() < 0.001) return;
  context.enemy.mesh.lookAt(position.clone().add(velocity));
}

export function createDelugeGameplay(bus: EventBus, debugTarget?: DelugeDebugTarget): LockOnRunnerLevel<DelugeEnemyKind, DelugeSpawnData> {
  const vultureEntries = createVultureEntries();
  const timeline = debugTarget ? createDelugeDebugTimeline(debugTarget, vultureEntries.timeline) : buildTimeline(vultureEntries.timeline);
  const coreEntry = vultureEntries.coreEntry;

  const interceptions = new Set<number>();
  const podsAlive = new Set<number>();
  const podIds = new Set<number>();
  const barrierIds = new Set<number>();
  let hitsTaken = 0;
  let barriersShattered = 0;
  let vultureCoreId = -1;
  let coreKilled = false;
  let coreWindow = 0;
  let beamFired = false;
  let coreKillWindow = 0;

  bus.on('runstart', () => {
    interceptions.clear();
    podsAlive.clear();
    podIds.clear();
    barrierIds.clear();
    hitsTaken = 0;
    barriersShattered = 0;
    vultureCoreId = -1;
    coreKilled = false;
    coreWindow = 0;
    beamFired = false;
    coreKillWindow = 0;
    coreEntry.lockable = debugTarget === 'vulture';
  });
  bus.on('spawn', ({ enemyId, kind }) => {
    if (kind === 'vulturePod') {
      podsAlive.add(enemyId);
      podIds.add(enemyId);
    }
    if (kind === 'barrier') barrierIds.add(enemyId);
    if (kind === 'vultureCore') vultureCoreId = enemyId;
  });
  bus.on('playerhit', () => { hitsTaken += 1; });
  bus.on('fire', ({ enemyId }) => { interceptions.add(enemyId); });
  bus.on('kill', ({ enemyId }) => {
    interceptions.delete(enemyId);
    if (barrierIds.delete(enemyId)) barriersShattered += 1;
    if (podIds.has(enemyId)) podsAlive.delete(enemyId);
    if (enemyId === vultureCoreId) {
      coreKilled = true;
      coreKillWindow = coreWindow;
      bus.emit('bossphase', { phase: 'destroyed' });
    }
  });
  bus.on('miss', ({ enemyId }) => { interceptions.delete(enemyId); });

  function fireShot(context: DelugeUpdate, from: Vector3, flavor: 'bolt' | 'flak' = 'bolt') {
    const initial = hostileShotAimPoint(context.camera, from, flavor === 'flak' ? 1.2 : 2).sub(from).normalize().multiplyScalar(flavor === 'flak' ? 4 : 5.5);
    context.spawnEnemy({
      time: context.runTime,
      kind: flavor,
      countsTowardTotal: false,
      data: { role: 'shot', position: from.clone(), velocity: initial, lastAge: 0, impact: {}, flavor },
    });
  }

  function updateGnat(context: DelugeUpdate, data: Extract<DelugeSpawnData, { role: 'gnat' }>) {
    const { enemy, age, curve, camera, railAnchor, runProgress } = context;
    const anchorU = data.debugHold ? MathUtils.clamp(runProgress + DEBUG_HOLD_PROGRESS_OFFSET, 0, 1) : railAnchor(data.lead);
    const weave = new Vector3(
      data.center.x + Math.sin(age * 2.7 + data.seed) * 1.2 + Math.sin(age * 5.1 + data.boid) * 0.35,
      data.center.y + Math.cos(age * 2.1 + data.seed) * 0.9,
      Math.sin(age * 3.4 + data.seed) * 0.9,
    );
    enemy.mesh.position.copy(offsetFromRail(curve, anchorU, weave));
    enemy.mesh.quaternion.copy(camera.quaternion);
    enemy.mesh.rotateZ(age * (6 + data.boid * 0.4));
    return !data.debugHold && runProgress > anchorU + 0.014;
  }

  function updateInterceptor(context: DelugeUpdate, data: Extract<DelugeSpawnData, { role: 'interceptor' }>) {
    const { enemy, age, curve, railAnchor, runProgress } = context;
    const anchorU = data.debugHold ? MathUtils.clamp(runProgress + DEBUG_HOLD_PROGRESS_OFFSET, 0, 1) : railAnchor(data.lead);
    const cross = MathUtils.smoothstep(MathUtils.clamp((age - 1.0) / 2.6, 0, 1), 0, 1);
    const sideLane = data.side * MathUtils.lerp(11, -7.5, cross);
    const offset = new Vector3(sideLane + Math.sin(age * 3 + data.seed) * 0.8, data.y + Math.sin(age * 2.4) * 0.45, Math.sin(age * 6) * 0.35);
    enemy.mesh.position.copy(offsetFromRail(curve, anchorU, offset));
    const ahead = offsetFromRail(curve, Math.min(1, anchorU + 0.003), offset.clone().add(new Vector3(-data.side * 0.8, 0, 0)));
    enemy.mesh.lookAt(ahead);
    if (data.fireAt !== undefined && age >= data.fireAt) {
      data.fireAt = undefined;
      fireShot(context, enemy.mesh.position, 'bolt');
    }
    return !data.debugHold && (runProgress > anchorU + 0.016 || age > 7.5);
  }

  function updateTurret(context: DelugeUpdate, data: Extract<DelugeSpawnData, { role: 'turret' }>) {
    const { enemy, age, curve, camera, railAnchor, runProgress } = context;
    const anchorU = data.debugHold ? MathUtils.clamp(runProgress + DEBUG_HOLD_PROGRESS_OFFSET, 0, 1) : railAnchor(data.lead);
    const wallX = data.wall === 0 ? Math.sin(data.seed) * 2 : data.wall * 9.2;
    const deploy = MathUtils.smoothstep(MathUtils.clamp(age / 0.7, 0, 1), 0, 1);
    enemy.mesh.position.copy(offsetFromRail(curve, anchorU, new Vector3(wallX, data.y, -0.5 + deploy * 1.4)));
    enemy.mesh.quaternion.copy(camera.quaternion);
    enemy.mesh.rotateY(-data.wall * 0.55);
    const state = context.enemyState(() => ({ nextFire: 1.2 + (data.seed % 0.7) }));
    if (age >= state.nextFire) {
      state.nextFire += data.fireEvery ?? 3.0;
      fireShot(context, enemy.mesh.position, 'bolt');
    }
    return !data.debugHold && runProgress > anchorU + 0.016;
  }

  function updateBarrier(context: DelugeUpdate, data: Extract<DelugeSpawnData, { role: 'barrier' }>) {
    const { enemy, age, curve, camera, railAnchor, runProgress, damagePlayer } = context;
    const anchorU = data.debugHold ? MathUtils.clamp(runProgress + DEBUG_HOLD_PROGRESS_OFFSET, 0, 1) : railAnchor(data.lead);
    enemy.mesh.position.copy(offsetFromRail(curve, anchorU, new Vector3(0, 2.4, 0)));
    enemy.mesh.quaternion.copy(camera.quaternion);
    enemy.mesh.userData.gapX = data.gapX;
    enemy.mesh.userData.gapY = data.gapY;
    enemy.mesh.userData.gapWidth = data.width;
    enemy.mesh.rotateZ(Math.sin(age * 5 + data.seed) * 0.03);
    if (!data.debugHold && runProgress > anchorU + 0.002) {
      const cameraInGap = Math.abs(data.gapX) < data.width * 0.5 && Math.abs(data.gapY) < 2.2;
      if (!cameraInGap) damagePlayer(1);
      return true;
    }
    return false;
  }

  function updateDropvan(context: DelugeUpdate, data: Extract<DelugeSpawnData, { role: 'dropvan' }>) {
    const { enemy, age, curve, camera, railAnchor, runProgress, spawnEnemy } = context;
    const anchorU = data.debugHold ? MathUtils.clamp(runProgress + DEBUG_HOLD_PROGRESS_OFFSET, 0, 1) : railAnchor(data.lead);
    const unfold = MathUtils.smoothstep(MathUtils.clamp(age / 1.1, 0, 1), 0, 1);
    const offset = data.offset.clone();
    offset.x += Math.sin(age * 1.2 + data.seed) * 1.1;
    offset.y += Math.sin(age * 0.9 + data.seed) * 0.55;
    enemy.mesh.position.copy(offsetFromRail(curve, anchorU, offset));
    enemy.mesh.quaternion.copy(camera.quaternion);
    enemy.mesh.rotateZ(Math.sin(age * 1.7) * 0.15);
    enemy.mesh.userData.unfold = unfold;
    const state = context.enemyState(() => ({ spilled: false }));
    if (!state.spilled && age > 1.25) {
      state.spilled = true;
      for (let i = 0; i < 4; i += 1) {
        spawnEnemy({
          time: context.runTime + i * 0.05,
          kind: 'gnat',
          data: { role: 'gnat', lead: data.lead - 0.35, center: new Vector3(data.offset.x + (i - 1.5) * 1.4, data.offset.y - 1.4, 0), seed: data.seed + i * 5, boid: i },
        });
      }
    }
    return !data.debugHold && runProgress > anchorU + 0.018;
  }

  function updateShot(context: DelugeUpdate, data: Extract<DelugeSpawnData, { role: 'shot' }>) {
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
      config: data.flavor === 'flak' ? { hitDistance: 2.3, impactBrake: 0.32, damageDistance: 0.75 } : undefined,
    });
    if (impact.phase === 'braking') {
      enemy.mesh.position.copy(data.position);
      enemy.mesh.quaternion.copy(camera.quaternion);
      enemy.mesh.rotateZ(age * 9);
      if (impact.damaged) {
        damagePlayer(1);
        return true;
      }
      return false;
    }
    steerHomingShot(data.position, data.velocity, hostileShotAimPoint(camera, data.position, data.flavor === 'flak' ? 1 : 2.3), age, dt, {
      baseSpeed: data.flavor === 'flak' ? 5.8 : 6.5,
      maxSpeed: data.flavor === 'flak' ? 11 : 14,
      accel: data.flavor === 'flak' ? 2.7 : 3.6,
      turnRate: data.flavor === 'flak' ? 1.4 : 2.3,
    });
    enemy.mesh.position.copy(data.position);
    orientAlongVelocity(context, data.position, data.velocity);
    return age > SHOT_MAX_AGE || shotBehindCamera(camera, data.position);
  }

  function vultureAnchor(context: DelugeUpdate, phaseOffset = 0) {
    const local = Math.max(0, context.runTime - VULTURE_TIME);
    const lead = context.runTime < PHASE2_TIME ? 5.0 : 4.0;
    const anchorU = context.enemy.entry.data.role === 'vultureCore' && context.enemy.entry.data.debugHold
      ? MathUtils.clamp(context.runProgress + DEBUG_HOLD_PROGRESS_OFFSET, 0, 1)
      : context.railAnchor(lead);
    const strafe = Math.sin(local * 0.38 + phaseOffset) * (context.runTime < PHASE2_TIME ? 9 : 5.2);
    const bob = Math.sin(local * 0.7 + phaseOffset) * 1.4 + (context.runTime < PHASE2_TIME ? 6 : 4.2);
    return { anchorU, strafe, bob, local };
  }

  function updateVulturePod(context: DelugeUpdate, data: Extract<DelugeSpawnData, { role: 'vulturePod' }>) {
    const { enemy, curve, camera, runProgress, age } = context;
    const { anchorU, strafe, bob, local } = data.debugHold
      ? { anchorU: MathUtils.clamp(runProgress + DEBUG_HOLD_PROGRESS_OFFSET, 0, 1), strafe: 0, bob: 4, local: age }
      : vultureAnchor(context, data.side * 0.9);
    enemy.mesh.position.copy(offsetFromRail(curve, anchorU, new Vector3(strafe + data.side * 4.9, bob, data.side * 0.6)));
    enemy.mesh.quaternion.copy(camera.quaternion);
    enemy.mesh.rotateZ(data.side * 0.2 + Math.sin(local) * 0.12);
    const state = context.enemyState(() => ({ nextFire: 2.2 + (data.side > 0 ? 0.8 : 0) }));
    if (age >= state.nextFire) {
      state.nextFire += 3.0;
      fireShot(context, enemy.mesh.position, 'flak');
    }
    return !data.debugHold && coreKilled;
  }

  function updateCoreWindow(runTime: number) {
    const windows = [
      [bar(86), bar(88.5)],
      [bar(92), bar(94.8)],
      [bar(99), bar(102)],
      [bar(102.8), bar(103.8)],
    ] as const;
    let window = 0;
    coreEntry.lockable = false;
    for (let i = 0; i < windows.length; i += 1) {
      const [start, end] = windows[i];
      if (runTime >= start && runTime <= end) {
        window = i + 1;
        coreEntry.lockable = podsAlive.size === 0 || i === windows.length - 1 || debugTarget === 'vulture';
      }
    }
    coreWindow = window;
    if (!beamFired && runTime > windows[2][1] + 0.35 && !coreKilled) {
      beamFired = true;
      bus.emit('bossphase', { phase: 'exposed' });
    }
  }

  function updateVultureCore(context: DelugeUpdate, data: Extract<DelugeSpawnData, { role: 'vultureCore' }>) {
    const { enemy, curve, camera, runProgress, age } = context;
    updateCoreWindow(context.runTime);
    const { anchorU, strafe, bob, local } = data.debugHold
      ? { anchorU: MathUtils.clamp(runProgress + DEBUG_HOLD_PROGRESS_OFFSET, 0, 1), strafe: 0, bob: 3.6, local: age }
      : vultureAnchor(context, 0);
    enemy.mesh.position.copy(offsetFromRail(curve, anchorU, new Vector3(strafe, bob - 0.45, 0)));
    enemy.mesh.quaternion.copy(camera.quaternion);
    enemy.mesh.rotateZ(Math.sin(local * 0.6) * 0.08);
    enemy.mesh.userData.charge = coreEntry.lockable ? 1 : Math.max(0, Math.sin(local * 3.2) * 0.4);
    const state = context.enemyState(() => ({ nextFlak: 1.0, beamDamageDone: false }));
    if (age >= state.nextFlak && !coreEntry.lockable) {
      state.nextFlak += 1.6;
      fireShot(context, enemy.mesh.position, 'flak');
    }
    if (beamFired && !state.beamDamageDone && !coreKilled) {
      state.beamDamageDone = true;
      context.damagePlayer(2);
    }
    return !data.debugHold && context.runTime > OUTRO_TIME;
  }

  return {
    duration: debugTarget ? 90 : DELUGE_DURATION,
    bpm: DELUGE_BPM,
    playerHealth: DELUGE_PLAYER_HEALTH,
    createRail: createDelugeRail,
    spawnTimeline: timeline,
    easeRunProgress: delugeRunProgress,
    startWord: 'DELUGE',
    lockRadiusNdc: 0.09,
    timing: { shotDelay: { gridRampGapGrowthThirtyseconds: 2, releaseShare: 0.72 } },
    updateEnemy(context) {
      const data = context.enemy.entry.data;
      switch (data.role) {
        case 'gnat': return updateGnat(context, data);
        case 'interceptor': return updateInterceptor(context, data);
        case 'turret': return updateTurret(context, data);
        case 'barrier': return updateBarrier(context, data);
        case 'dropvan': return updateDropvan(context, data);
        case 'shot': return updateShot(context, data);
        case 'vulturePod': return updateVulturePod(context, data);
        case 'vultureCore': return updateVultureCore(context, data);
      }
    },
    scoreForKill(volleySize, enemy) {
      const multiplier = 1 + Math.max(0, volleySize - 1) * 0.2;
      return Math.round(KILL_SCORE[enemy.kind] * multiplier);
    },
    scoreForHit: () => 50,
    scoreForVolley(results) {
      if (results.length < 4 || !results.every((result) => result.killed)) return 0;
      return results.length === 6 ? 700 : results.length * 80;
    },
    rankForRun(score, kills, totalEnemies) {
      const clearRate = totalEnemies === 0 ? 0 : kills / totalEnemies;
      if (coreKilled && score >= 36000 && clearRate >= 0.82) return 'S';
      if (score >= 26000 && clearRate >= 0.66) return 'A';
      if (score >= 15000 && clearRate >= 0.45) return 'B';
      if (score >= 7000 && clearRate >= 0.25) return 'C';
      return 'D';
    },
    detailsForRun() {
      const hull = Math.max(0, DELUGE_PLAYER_HEALTH - hitsTaken);
      const lines = [`Hull ${hull}/${DELUGE_PLAYER_HEALTH}`, `${barriersShattered} barrier${barriersShattered === 1 ? '' : 's'} shattered`];
      if (coreKilled) lines.push(`Vulture downed${coreKillWindow > 0 ? ` in window ${coreKillWindow}` : ''}`);
      else lines.push('Vulture escaped');
      return lines;
    },
  };
}
