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
  MASS_DRIVER_9281_BPM,
  MASS_DRIVER_9281_MARKERS,
  MASS_DRIVER_9281_RUN_DURATION,
  MASS_DRIVER_9281_TIME,
} from './timing';

export { MASS_DRIVER_9281_BPM, MASS_DRIVER_9281_RUN_DURATION, MASS_DRIVER_9281_TIME } from './timing';

export type MassDriver9281EnemyKind = 'weaver' | 'switchblade' | 'sentinel' | 'bolt' | 'interlock';

export type MassDriver9281SpawnData =
  | { role: 'weaver'; lead: number; phase: number; radius: number; lane: number }
  | { role: 'switchblade'; lead: number; fromX: number; toX: number; y: number; delay: number }
  | { role: 'sentinel'; lead: number; socket: number; pulse: number; fireAt: number }
  | { role: 'bolt'; position: Vector3; velocity: Vector3; lastAge: number; impact: HostileShotImpactState }
  | { role: 'interlock'; socket: number; unlockAt: number };

export type MassDriverSpawnEntry = LockOnSpawnEntry<MassDriver9281EnemyKind, MassDriver9281SpawnData>;
type MassDriverUpdate = LockOnEnemyUpdate<MassDriver9281EnemyKind, MassDriver9281SpawnData>;

const speedProfile = createSpeedProfile([
  [0, 0.42],
  [MASS_DRIVER_9281_TIME.bar(6), 0.66],
  [MASS_DRIVER_9281_TIME.bar(14), 0.98],
  [MASS_DRIVER_9281_TIME.bar(22), 1.42],
  [MASS_DRIVER_9281_TIME.bar(28), 1.82],
  [MASS_DRIVER_9281_RUN_DURATION, 2.35],
], MASS_DRIVER_9281_RUN_DURATION);

export const massDriverRunProgress = speedProfile.runProgress;
export const massDriverSpeedAt = speedProfile.speedAt;

export function createMassDriver9281Rail() {
  return new CatmullRomCurve3(
    [
      new Vector3(0, 0, 0),
      new Vector3(1, 0, -70),
      new Vector3(-3, 2, -150),
      new Vector3(4, -2, -245),
      new Vector3(-5, 1, -355),
      new Vector3(5, 3, -480),
      new Vector3(-4, -3, -620),
      new Vector3(3, 1, -770),
      new Vector3(-2, 0, -925),
      new Vector3(0, 0, -1090),
    ],
    false,
    'catmullrom',
    0.36,
  );
}

const stagger = MASS_DRIVER_9281_TIME.stepSeconds * 0.8;

function weaverFan(time: number, count: number, radius: number, lead = 4): MassDriverSpawnEntry[] {
  return Array.from({ length: count }, (_, index) => ({
    time: time + index * stagger,
    kind: 'weaver',
    data: {
      role: 'weaver',
      lead,
      phase: index / count * Math.PI * 2,
      radius,
      lane: index - (count - 1) / 2,
    },
  }));
}

function crossing(time: number, count: number, y: number, lead = 3.8): MassDriverSpawnEntry[] {
  return Array.from({ length: count }, (_, index) => {
    const left = index % 2 === 0;
    return {
      time: time + index * stagger,
      kind: 'switchblade',
      data: {
        role: 'switchblade',
        lead,
        fromX: left ? -18 : 18,
        toX: left ? 18 : -18,
        y: y + (index - (count - 1) / 2) * 1.65,
        delay: index * 0.22,
      },
    };
  });
}

function sentinels(time: number, sockets: number[], lead = 4.4): MassDriverSpawnEntry[] {
  const beatSeconds = 60 / MASS_DRIVER_9281_BPM;
  return sockets.map((socket, index) => {
    const spawnTime = time + index * stagger;
    const fireAt = Math.ceil((spawnTime + 0.7) / beatSeconds) * beatSeconds;
    return {
      time: spawnTime,
      kind: 'sentinel',
      hitPoints: 2,
      data: { role: 'sentinel', lead, socket, pulse: time + index * 1.71, fireAt },
    };
  });
}

function buildTimeline(): MassDriverSpawnEntry[] {
  const bar = MASS_DRIVER_9281_TIME.bar;
  const interlocks: MassDriverSpawnEntry[] = [0, 1, 2, 3].map((socket, index) => ({
    time: MASS_DRIVER_9281_MARKERS.critical + 1 + index * 0.18,
    kind: 'interlock',
    hitStages: [2, 1],
    lockable: false,
    data: { role: 'interlock', socket, unlockAt: MASS_DRIVER_9281_MARKERS.critical + 1 + index * 2.5 },
  }));

  return [
    // Injection: small symmetric packets teach the barrel's circular sweep.
    ...weaverFan(bar(1.5), 4, 4.7, 4.2),
    ...weaverFan(bar(3.5), 6, 6.2, 4.1),
    ...crossing(bar(5), 4, 0.5, 4),

    // Phase lock: the drones begin threading between opposite coils.
    ...weaverFan(bar(7), 6, 7.2, 4),
    ...crossing(bar(8.5), 6, 1.2, 3.9),
    ...sentinels(bar(10), [0, 2], 4.5),
    ...weaverFan(bar(11.5), 6, 8, 3.9),
    ...crossing(bar(13), 5, -0.8, 3.8),

    // Overdrive: alternating radial and lateral gestures, with armored anchors.
    ...sentinels(bar(14.5), [1, 3, 5], 4.3),
    ...weaverFan(bar(15.5), 6, 8.8, 3.8),
    ...crossing(bar(17), 6, 1.8, 3.7),
    ...weaverFan(bar(18.5), 6, 9.2, 3.7),
    ...sentinels(bar(20), [0, 2, 4], 4.1),
    ...crossing(bar(21), 6, -1.4, 3.6),
    ...weaverFan(bar(22), 6, 9.6, 3.5),

    // Critical charge: screen clears, then the four jammed safeties clamp in.
    ...interlocks,
  ].sort((a, b) => a.time - b.time);
}

export const MASS_DRIVER_9281_SPAWN_TIMELINE = buildTimeline();

const scoreBase: Record<MassDriver9281EnemyKind, number> = {
  weaver: 110,
  switchblade: 135,
  sentinel: 240,
  bolt: 55,
  interlock: 900,
};

const BOLT_MAX_AGE = 12;

function fireBolt(context: MassDriverUpdate, from: Vector3) {
  const initial = hostileShotAimPoint(context.camera, from).sub(from).normalize().multiplyScalar(5.2);
  context.spawnEnemy({
    time: context.runTime,
    kind: 'bolt',
    countsTowardTotal: false,
    data: { role: 'bolt', position: from.clone(), velocity: initial, lastAge: 0, impact: {} },
  });
}

function updateBolt(
  context: MassDriverUpdate,
  data: Extract<MassDriver9281SpawnData, { role: 'bolt' }>,
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
    config: { hitDistance: 2.7, impactBrake: 0.42, damageDistance: 0.58 },
  });
  if (impact.phase === 'braking') {
    enemy.mesh.position.copy(data.position);
    enemy.mesh.quaternion.copy(camera.quaternion);
    enemy.mesh.rotateZ(age * 13);
    enemy.mesh.userData.impact = true;
    if (impact.damaged) {
      damagePlayer(1);
      return true;
    }
    return false;
  }

  steerHomingShot(data.position, data.velocity, hostileShotAimPoint(camera, data.position, 2.7), age, dt, {
    baseSpeed: 5.2,
    maxSpeed: 14.5,
    accel: 3.6,
    turnRate: 2.55,
  });
  enemy.mesh.position.copy(data.position);
  enemy.mesh.lookAt(data.position.clone().add(data.velocity));
  enemy.mesh.rotateZ(age * 8.5);
  return age > BOLT_MAX_AGE || shotBehindCamera(camera, data.position);
}

function updateDrone(context: MassDriverUpdate, interceptions: Set<number>, deadlineFailed: boolean) {
  const { enemy, runTime, runProgress, age, curve, camera, railAnchor } = context;
  const data = enemy.entry.data;

  if (data.role === 'bolt') return updateBolt(context, data, interceptions);

  if (data.role === 'interlock') {
    if (deadlineFailed) {
      enemy.entry.lockable = false;
      enemy.mesh.userData.failed = true;
    } else if (runTime >= data.unlockAt) {
      enemy.entry.lockable = true;
      enemy.mesh.userData.armed = true;
    }
    const frame = sampleRailFrame(curve, MathUtils.clamp(runProgress + 0.017, 0, 0.985));
    const angle = data.socket / 4 * Math.PI * 2 + runTime * 0.055;
    const radius = 7.4 + Math.sin(age * 1.4 + data.socket) * 0.28;
    enemy.mesh.position.copy(frame.position)
      .addScaledVector(frame.right, Math.cos(angle) * radius)
      .addScaledVector(frame.up, Math.sin(angle) * radius)
      .addScaledVector(frame.tangent, 2 + Math.sin(age * 0.7 + data.socket) * 1.2);
    enemy.mesh.lookAt(camera.position);
    enemy.mesh.rotateZ(angle + Math.PI / 2);
    enemy.mesh.userData.charge = MathUtils.smoothstep(runTime, MASS_DRIVER_9281_MARKERS.critical, MASS_DRIVER_9281_RUN_DURATION);
    return false;
  }

  const anchorU = railAnchor(data.lead);
  const offset = new Vector3();
  if (data.role === 'weaver') {
    const angle = data.phase + age * (1.35 + runProgress * 1.4);
    const breathe = data.radius * 1.16 + Math.sin(age * 2.4 + data.phase) * 1.25;
    offset.set(Math.cos(angle) * breathe, Math.sin(angle) * breathe, Math.sin(age * 1.9 + data.lane) * 2.2);
    enemy.mesh.lookAt(camera.position);
    enemy.mesh.rotateZ(angle + Math.PI / 2);
  } else if (data.role === 'switchblade') {
    const crossingProgress = MathUtils.smootherstep(MathUtils.clamp((age - data.delay) / 2.5, 0, 1), 0, 1);
    offset.set(
      MathUtils.lerp(data.fromX, data.toX, crossingProgress),
      data.y * 1.22 + Math.sin(crossingProgress * Math.PI) * 5.8,
      Math.sin(age * 3.2) * 1.4,
    );
    enemy.mesh.lookAt(camera.position);
    enemy.mesh.rotateZ(MathUtils.lerp(-0.75, 0.75, crossingProgress) * Math.sign(data.toX));
  } else {
    const angle = data.socket / 6 * Math.PI * 2 + Math.sin(age * 0.8 + data.pulse) * 0.12;
    offset.set(Math.cos(angle) * 9.7, Math.sin(angle) * 8.3, Math.sin(age * 0.9 + data.pulse) * 2);
    enemy.mesh.lookAt(camera.position);
    enemy.mesh.rotateZ(angle);
    const fire = context.enemyState(() => ({ fired: false }));
    const chargeStart = data.fireAt - 0.5;
    enemy.mesh.userData.telegraph = fire.fired ? 0 : MathUtils.clamp((runTime - chargeStart) / 0.5, 0, 1);
    if (!fire.fired && runTime >= data.fireAt) {
      fire.fired = true;
      fireBolt(context, enemy.mesh.position);
      enemy.mesh.userData.justFiredUntil = runTime + 0.34;
      enemy.mesh.userData.telegraph = 0;
    }
  }

  enemy.mesh.position.copy(offsetFromRail(curve, anchorU, offset));
  enemy.mesh.userData.charge = runProgress;
  return runProgress > anchorU + 0.026;
}

export function createMassDriver9281Gameplay(bus: EventBus): LockOnRunnerLevel<MassDriver9281EnemyKind, MassDriver9281SpawnData> {
  const interlockIds = new Set<number>();
  const boltIds = new Set<number>();
  const boltInterceptions = new Set<number>();
  let destroyedInterlocks = 0;
  let interceptedBolts = 0;
  let hitsTaken = 0;
  let deadlineFailed = false;

  bus.on('runstart', () => {
    interlockIds.clear();
    boltIds.clear();
    boltInterceptions.clear();
    destroyedInterlocks = 0;
    interceptedBolts = 0;
    hitsTaken = 0;
    deadlineFailed = false;
    for (const entry of MASS_DRIVER_9281_SPAWN_TIMELINE) {
      if (entry.kind === 'interlock') entry.lockable = false;
    }
  });
  bus.on('spawn', ({ enemyId, kind }) => {
    if (kind === 'interlock') interlockIds.add(enemyId);
    if (kind === 'bolt') boltIds.add(enemyId);
  });
  bus.on('fire', ({ enemyId }) => {
    if (boltIds.has(enemyId)) boltInterceptions.add(enemyId);
  });
  bus.on('kill', ({ enemyId }) => {
    if (interlockIds.delete(enemyId)) destroyedInterlocks += 1;
    if (boltIds.delete(enemyId)) interceptedBolts += 1;
    boltInterceptions.delete(enemyId);
  });
  bus.on('miss', ({ enemyId }) => {
    boltIds.delete(enemyId);
    boltInterceptions.delete(enemyId);
  });
  bus.on('playerhit', () => {
    hitsTaken += 1;
  });

  return {
    duration: MASS_DRIVER_9281_RUN_DURATION,
    bpm: MASS_DRIVER_9281_BPM,
    createRail: createMassDriver9281Rail,
    spawnTimeline: MASS_DRIVER_9281_SPAWN_TIMELINE,
    easeRunProgress: massDriverRunProgress,
    lockRadiusNdc: 0.17,
    playerHealth: 3,
    timing: {
      shotDelay: { maxGridSeconds: 0.18 },
      actionSfx: { enabled: true, gridThirtyseconds: 2 },
    },
    updateEnemy(context) {
      if (context.runTime >= MASS_DRIVER_9281_MARKERS.muzzle && destroyedInterlocks < 4) deadlineFailed = true;
      return updateDrone(context, boltInterceptions, deadlineFailed);
    },
    scoreForHit(volleySize, enemy) {
      return Math.round(scoreBase[enemy.kind] * 0.3 * (1 + Math.max(0, volleySize - 1) * 0.08));
    },
    scoreForKill(volleySize, enemy) {
      return Math.round(scoreBase[enemy.kind] * (1 + Math.max(0, volleySize - 1) * 0.14));
    },
    scoreForVolley(results) {
      return results.length === 6 && results.every((result) => result.killed) ? 9281 : 0;
    },
    rankForRun(score, kills, total) {
      const clear = total > 0 ? kills / total : 0;
      const launched = destroyedInterlocks === 4 && !deadlineFailed;
      if (launched && clear > 0.9 && score >= 17000) return 'LAUNCH';
      if (launched && clear > 0.72) return 'ORBIT';
      if (launched) return 'CLEAR';
      if (clear > 0.6) return 'ARC';
      return 'GROUND';
    },
    detailsForRun() {
      return [
        `Safety interlocks ${destroyedInterlocks}/4`,
        destroyedInterlocks === 4 && !deadlineFailed ? 'Payload launched clear' : 'Barrel containment failed at charge peak',
        `Arc bolts intercepted ${interceptedBolts} · hull hits ${hitsTaken}`,
      ];
    },
  };
}
