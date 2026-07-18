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
  BROADSIDE_B3FK_BPM,
  BROADSIDE_B3FK_MARKERS,
  BROADSIDE_B3FK_RUN_DURATION,
  BROADSIDE_B3FK_TIME,
} from './timing';

export { BROADSIDE_B3FK_BPM, BROADSIDE_B3FK_RUN_DURATION, BROADSIDE_B3FK_TIME } from './timing';

export type BroadsideB3fkEnemyKind =
  | 'interceptor'
  | 'bomber'
  | 'skiff'
  | 'escort'
  | 'pdcBolt'
  | 'shieldGen'
  | 'powerCore';

export type BroadsideB3fkSpawnData =
  | { role: 'interceptor'; lead: number; lane: number; side: number; phase: number }
  | { role: 'bomber'; lead: number; phase: number; radius: number; fireAt: number }
  | { role: 'skiff'; lead: number; lane: number; side: number; fireAt: number }
  | { role: 'escort'; lead: number; phase: number; radius: number; dive: number }
  | { role: 'pdcBolt'; position: Vector3; velocity: Vector3; lastAge: number; impact: HostileShotImpactState }
  | { role: 'shieldGen'; socket: number; unlockAt: number; fireAt: number }
  | { role: 'powerCore'; socket: number; unlockAt: number };

export type BroadsideSpawnEntry = LockOnSpawnEntry<BroadsideB3fkEnemyKind, BroadsideB3fkSpawnData>;
type BroadsideUpdate = LockOnEnemyUpdate<BroadsideB3fkEnemyKind, BroadsideB3fkSpawnData>;

const speedProfile = createSpeedProfile([
  [0, 0.62],
  [BROADSIDE_B3FK_TIME.bar(4), 1.04],
  [BROADSIDE_B3FK_TIME.bar(9), 1.34],
  [BROADSIDE_B3FK_TIME.bar(13), 1.5],
  [BROADSIDE_B3FK_TIME.bar(16), 0.58],
  [BROADSIDE_B3FK_TIME.bar(18), 0.9],
  [BROADSIDE_B3FK_TIME.bar(23), 1.18],
  [BROADSIDE_B3FK_TIME.bar(26), 1.65],
  [BROADSIDE_B3FK_TIME.bar(29), 0.48],
  [BROADSIDE_B3FK_RUN_DURATION, 0.2],
], BROADSIDE_B3FK_RUN_DURATION);

export const broadsideRunProgress = speedProfile.runProgress;
export const broadsideSpeedAt = speedProfile.speedAt;

export function createBroadsideB3fkRail() {
  return new CatmullRomCurve3(
    [
      new Vector3(0, 3, 10),
      new Vector3(0, 5, -42),
      new Vector3(-18, 18, -105),
      new Vector3(26, -2, -170),
      new Vector3(-34, 14, -238),
      new Vector3(18, 4, -310),
      new Vector3(45, 9, -382),
      new Vector3(14, -7, -456),
      new Vector3(-42, -13, -522),
      new Vector3(-18, 7, -590),
      new Vector3(29, 20, -655),
      new Vector3(55, 6, -724),
      new Vector3(12, -24, -792),
      new Vector3(-48, -12, -858),
      new Vector3(-26, 10, -924),
      new Vector3(8, 2, -982),
      new Vector3(3, -1, -1042),
      new Vector3(-6, -7, -1100),
      new Vector3(4, -15, -1160),
      new Vector3(0, -5, -1225),
    ],
    false,
    'catmullrom',
    0.34,
  );
}

const stagger = BROADSIDE_B3FK_TIME.stepSeconds * 0.7;

function interceptorKnot(time: number, count: number, spread = 1, lead = 4.3): BroadsideSpawnEntry[] {
  return Array.from({ length: count }, (_, index) => ({
    time: time + index * stagger,
    kind: 'interceptor',
    data: {
      role: 'interceptor',
      lead,
      lane: (index - (count - 1) / 2) * spread,
      side: index % 2 === 0 ? -1 : 1,
      phase: time * 0.37 + index * 1.7,
    },
  }));
}

function bomberWheel(time: number, count: number, radius: number, lead = 4.7): BroadsideSpawnEntry[] {
  return Array.from({ length: count }, (_, index) => ({
    time: time + index * stagger * 0.8,
    kind: 'bomber',
    hitPoints: 2,
    data: {
      role: 'bomber',
      lead,
      phase: index / count * Math.PI * 2,
      radius,
      fireAt: time + 1.5 + index * 0.38,
    },
  }));
}

function skiffRake(time: number, count: number, high: boolean, lead = 4): BroadsideSpawnEntry[] {
  return Array.from({ length: count }, (_, index) => ({
    time: time + index * stagger,
    kind: 'skiff',
    data: {
      role: 'skiff',
      lead,
      lane: (index - (count - 1) / 2) * 2.2 + (high ? 3 : -3),
      side: index % 2 === 0 ? -1 : 1,
      fireAt: time + 1.15 + index * 0.28,
    },
  }));
}

function escortSpiral(time: number, count: number, lead = 3.8): BroadsideSpawnEntry[] {
  return Array.from({ length: count }, (_, index) => ({
    time: time + index * stagger * 0.62,
    kind: 'escort',
    data: {
      role: 'escort',
      lead,
      phase: index / count * Math.PI * 2,
      radius: 7 + (index % 3) * 1.6,
      dive: index % 2 === 0 ? -1 : 1,
    },
  }));
}

function buildTimeline(): BroadsideSpawnEntry[] {
  const bar = BROADSIDE_B3FK_TIME.bar;
  const shieldGenerators: BroadsideSpawnEntry[] = [0, 1, 2, 3].map((socket) => ({
    time: BROADSIDE_B3FK_MARKERS.flagship + 0.35 + socket * 0.18,
    kind: 'shieldGen',
    hitStages: [2, 1],
    lockable: false,
    data: {
      role: 'shieldGen',
      socket,
      unlockAt: BROADSIDE_B3FK_MARKERS.flagship + 0.65 + socket * 1.55,
      fireAt: BROADSIDE_B3FK_MARKERS.flagship + 1.4 + socket * 1.35,
    },
  }));
  const powerCores: BroadsideSpawnEntry[] = [0, 1, 2].map((socket) => ({
    time: BROADSIDE_B3FK_MARKERS.trench + 0.2 + socket * 0.16,
    kind: 'powerCore',
    hitStages: [2, 1],
    lockable: false,
    data: { role: 'powerCore', socket, unlockAt: BROADSIDE_B3FK_MARKERS.trench + 0.55 + socket * 0.7 },
  }));

  return [
    // Launch from the flagship deck: clean formations establish faction and aim language.
    ...interceptorKnot(bar(0.8), 4, 1.6, 4.5),
    ...skiffRake(bar(2.2), 5, true, 4.4),
    ...bomberWheel(bar(3.2), 4, 6.4, 4.6),

    // The engagement knots up between ships; gestures deliberately alternate axes.
    ...interceptorKnot(bar(4.3), 6, 2.15, 4.4),
    ...bomberWheel(bar(5.6), 6, 9.2, 4.5),
    ...skiffRake(bar(7), 6, false, 4.1),
    ...interceptorKnot(bar(8.1), 6, 2.5, 4.1),

    // Friendly flank run and overhead broadside.
    ...skiffRake(bar(9.2), 6, true, 4),
    ...bomberWheel(bar(10.5), 6, 10.5, 4.35),
    ...interceptorKnot(bar(11.7), 6, 2.8, 3.9),
    ...skiffRake(bar(13), 6, false, 3.9),
    ...bomberWheel(bar(14.2), 5, 8.6, 4.1),

    // The eye: one sparse herald formation, then the flagship dominates the frame.
    ...interceptorKnot(bar(16.35), 4, 3.3, 4.25),
    ...shieldGenerators,

    // Shield collapse throws escorts into the turn for pass two.
    ...escortSpiral(bar(23.15), 5, 3.75),
    ...escortSpiral(bar(24.35), 5, 3.55),
    ...powerCores,
  ].sort((a, b) => a.time - b.time);
}

export const BROADSIDE_B3FK_SPAWN_TIMELINE = buildTimeline();

const SCORE_BASE: Record<BroadsideB3fkEnemyKind, number> = {
  interceptor: 120,
  bomber: 230,
  skiff: 155,
  escort: 175,
  pdcBolt: 60,
  shieldGen: 850,
  powerCore: 1400,
};

function firePdcBolt(context: BroadsideUpdate, from: Vector3) {
  const velocity = hostileShotAimPoint(context.camera, from, 2.8).sub(from).normalize().multiplyScalar(6.2);
  context.spawnEnemy({
    time: context.runTime,
    kind: 'pdcBolt',
    countsTowardTotal: false,
    data: { role: 'pdcBolt', position: from.clone(), velocity, lastAge: 0, impact: {} },
  });
}

function updatePdcBolt(context: BroadsideUpdate, data: Extract<BroadsideB3fkSpawnData, { role: 'pdcBolt' }>, intercepted: Set<number>) {
  const dt = Math.max(0, context.age - data.lastAge);
  data.lastAge = context.age;
  const impact = updateHostileShotImpact({
    age: context.age,
    camera: context.camera,
    position: data.position,
    velocity: data.velocity,
    state: data.impact,
    intercepted: intercepted.delete(context.enemy.id),
    config: { hitDistance: 2.8, impactBrake: 0.44, damageDistance: 0.58 },
  });
  if (impact.phase === 'braking') {
    context.enemy.mesh.position.copy(data.position);
    context.enemy.mesh.quaternion.copy(context.camera.quaternion);
    context.enemy.mesh.rotateZ(context.age * 16);
    context.enemy.mesh.userData.impact = true;
    if (impact.damaged) {
      context.damagePlayer(1);
      return true;
    }
    return false;
  }
  steerHomingShot(data.position, data.velocity, hostileShotAimPoint(context.camera, data.position, 2.7), context.age, dt, {
    baseSpeed: 6.2,
    maxSpeed: 18,
    accel: 4.2,
    turnRate: 2.35,
  });
  context.enemy.mesh.position.copy(data.position);
  context.enemy.mesh.lookAt(data.position.clone().add(data.velocity));
  context.enemy.mesh.rotateZ(context.age * 10);
  return context.age > 10 || shotBehindCamera(context.camera, data.position);
}

function updateTarget(context: BroadsideUpdate, intercepted: Set<number>, shieldsDestroyed: number) {
  const { enemy, runTime, runProgress, age, curve, camera, railAnchor } = context;
  const data = enemy.entry.data;
  if (data.role === 'pdcBolt') return updatePdcBolt(context, data, intercepted);

  if (data.role === 'shieldGen' || data.role === 'powerCore') {
    const isCore = data.role === 'powerCore';
    const mayArm = runTime >= data.unlockAt && (!isCore || shieldsDestroyed === 4);
    enemy.entry.lockable = mayArm;
    enemy.mesh.userData.armed = mayArm;
    const ahead = isCore ? 0.019 : 0.032;
    const frame = sampleRailFrame(curve, MathUtils.clamp(runProgress + ahead, 0, 0.992));
    const angle = isCore
      ? (-0.62 + data.socket * 0.62)
      : (data.socket / 4 * Math.PI * 2 + Math.sin(runTime * 0.28) * 0.08);
    const radius = isCore ? 5.4 : 8.5;
    enemy.mesh.position.copy(frame.position)
      .addScaledVector(frame.right, Math.cos(angle) * radius)
      .addScaledVector(frame.up, Math.sin(angle) * (isCore ? 4.2 : radius * 0.68))
      .addScaledVector(frame.tangent, isCore ? 1 + data.socket * 2.7 : 4 + Math.sin(age + data.socket) * 1.2);
    enemy.mesh.lookAt(camera.position);
    enemy.mesh.rotateZ(isCore ? angle * 0.35 : angle + Math.PI / 2);
    enemy.mesh.userData.bossCharge = MathUtils.clamp((runTime - BROADSIDE_B3FK_MARKERS.flagship) / 18, 0, 1);
    if (data.role === 'shieldGen') {
      const fire = context.enemyState(() => ({ nextFire: Math.max(data.fireAt, data.unlockAt + 3) }));
      enemy.mesh.userData.telegraph = MathUtils.clamp((runTime - (fire.nextFire - 0.55)) / 0.55, 0, 1);
      if (mayArm && runTime >= fire.nextFire) {
        fire.nextFire += 2.8 + data.socket * 0.18;
        firePdcBolt(context, enemy.mesh.position);
        enemy.mesh.userData.justFiredUntil = runTime + 0.35;
      }
    }
    return false;
  }

  // Seat swarm craft closer than their authored lifetime suggests; their own
  // lateral velocity supplies the readable window while the fleet keeps scale.
  const anchorU = railAnchor(data.lead * (data.role === 'escort' ? 0.92 : 0.7));
  const offset = new Vector3();
  if (data.role === 'interceptor') {
    const crossing = MathUtils.smootherstep(MathUtils.clamp(age / 3.2, 0, 1), 0, 1);
    offset.set(
      MathUtils.lerp(data.side * 22, -data.side * 19, crossing),
      data.lane * 2.1 + Math.sin(age * 3 + data.phase) * 2.8,
      Math.sin(age * 2.2 + data.phase) * 3.2,
    );
    enemy.mesh.lookAt(camera.position);
    enemy.mesh.rotateZ(data.side * (0.95 - crossing * 1.6));
  } else if (data.role === 'bomber') {
    const angle = data.phase + age * 1.15;
    offset.set(Math.cos(angle) * data.radius * 1.22, Math.sin(angle) * data.radius * 0.96, Math.sin(age * 1.7 + data.phase) * 2.4);
    enemy.mesh.lookAt(camera.position);
    enemy.mesh.rotateZ(angle + Math.PI / 2);
    const fire = context.enemyState(() => ({ fired: false }));
    enemy.mesh.userData.telegraph = fire.fired ? 0 : MathUtils.clamp((runTime - (data.fireAt - 0.5)) / 0.5, 0, 1);
    if (!fire.fired && runTime >= data.fireAt && Math.sin(data.phase) > -0.2) {
      fire.fired = true;
      firePdcBolt(context, enemy.mesh.position);
    }
  } else if (data.role === 'skiff') {
    const crossing = MathUtils.smootherstep(MathUtils.clamp(age / 2.65, 0, 1), 0, 1);
    offset.set(
      MathUtils.lerp(data.side * 25, -data.side * 24, crossing),
      data.lane * 1.2 + Math.sin(crossing * Math.PI) * 9 * data.side,
      -4 + crossing * 9,
    );
    enemy.mesh.lookAt(camera.position);
    enemy.mesh.rotateZ(data.side * (1.2 - crossing * 1.8));
    const fire = context.enemyState(() => ({ fired: false, rammed: false }));
    if (!fire.fired && runTime >= data.fireAt && Math.abs(data.lane) < 4.5) {
      fire.fired = true;
      firePdcBolt(context, enemy.mesh.position);
    }
    // One centerline skiff in each rake can clip an unattended player. This
    // keeps the hull system meaningful without making no-fire policy lethal.
    if (!fire.rammed && age >= 2.45 && Math.abs(data.lane) < 0.5) {
      fire.rammed = true;
      context.damagePlayer(1);
    }
  } else {
    const angle = data.phase + age * (1.8 + runProgress);
    const plunge = Math.sin(MathUtils.clamp(age / 3.1, 0, 1) * Math.PI) * data.dive * 4.2;
    offset.set(Math.cos(angle) * data.radius * 1.12, Math.sin(angle) * data.radius * 0.92 + plunge, Math.sin(age * 3 + data.phase) * 2.6);
    enemy.mesh.lookAt(camera.position);
    enemy.mesh.rotateZ(angle + Math.PI / 2);
  }
  enemy.mesh.position.copy(offsetFromRail(curve, anchorU, offset));
  return runProgress > anchorU + 0.026;
}

export function createBroadsideB3fkGameplay(bus: EventBus): LockOnRunnerLevel<BroadsideB3fkEnemyKind, BroadsideB3fkSpawnData> {
  const shieldIds = new Set<number>();
  const coreIds = new Set<number>();
  const boltIds = new Set<number>();
  const intercepted = new Set<number>();
  let shieldsDestroyed = 0;
  let coresDestroyed = 0;
  let boltsIntercepted = 0;
  let hullHits = 0;

  bus.on('runstart', () => {
    shieldIds.clear();
    coreIds.clear();
    boltIds.clear();
    intercepted.clear();
    shieldsDestroyed = 0;
    coresDestroyed = 0;
    boltsIntercepted = 0;
    hullHits = 0;
    for (const entry of BROADSIDE_B3FK_SPAWN_TIMELINE) {
      if (entry.kind === 'shieldGen' || entry.kind === 'powerCore') entry.lockable = false;
    }
  });
  bus.on('spawn', ({ enemyId, kind }) => {
    if (kind === 'shieldGen') shieldIds.add(enemyId);
    if (kind === 'powerCore') coreIds.add(enemyId);
    if (kind === 'pdcBolt') boltIds.add(enemyId);
  });
  bus.on('fire', ({ enemyId }) => {
    if (boltIds.has(enemyId)) intercepted.add(enemyId);
  });
  bus.on('kill', ({ enemyId }) => {
    if (shieldIds.delete(enemyId)) shieldsDestroyed += 1;
    if (coreIds.delete(enemyId)) coresDestroyed += 1;
    if (boltIds.delete(enemyId)) boltsIntercepted += 1;
    intercepted.delete(enemyId);
  });
  bus.on('miss', ({ enemyId }) => {
    shieldIds.delete(enemyId);
    coreIds.delete(enemyId);
    boltIds.delete(enemyId);
    intercepted.delete(enemyId);
  });
  bus.on('playerhit', () => { hullHits += 1; });

  return {
    duration: BROADSIDE_B3FK_RUN_DURATION,
    bpm: BROADSIDE_B3FK_BPM,
    createRail: createBroadsideB3fkRail,
    spawnTimeline: BROADSIDE_B3FK_SPAWN_TIMELINE,
    easeRunProgress: broadsideRunProgress,
    playerHealth: 4,
    lockRadiusNdc: 0.26,
    startWord: 'LAUNCH',
    replayWord: 'SALVO',
    timing: {
      shotDelay: { maxGridSeconds: 0.17, gapThirtyseconds: 1, gridRampGapGrowthThirtyseconds: 1 },
      actionSfx: { enabled: true, gridThirtyseconds: 2 },
    },
    updateEnemy(context) {
      return updateTarget(context, intercepted, shieldsDestroyed);
    },
    updateAttractCamera({ camera, curve, modeTime }) {
      // Hover above the launch deck with the opening fleet lanes beyond it.
      // This also keeps the procedural LAUNCH plaques off the flagship's hot engines.
      const frame = sampleRailFrame(curve, 0.024);
      const look = sampleRailFrame(curve, 0.105);
      camera.position.copy(frame.position)
        .addScaledVector(frame.up, 24 + Math.sin(modeTime * 0.35) * 0.7)
        .addScaledVector(frame.right, 16 + Math.sin(modeTime * 0.22) * 1.2)
        .addScaledVector(frame.tangent, -3);
      camera.lookAt(look.position.clone().addScaledVector(look.up, 5).addScaledVector(look.right, -3));
      camera.rotateZ(-0.075 + Math.sin(modeTime * 0.3) * 0.015);
    },
    scoreForHit(volleySize, enemy) {
      return Math.round(SCORE_BASE[enemy.kind] * 0.32 * (1 + Math.max(0, volleySize - 1) * 0.08));
    },
    scoreForKill(volleySize, enemy) {
      return Math.round(SCORE_BASE[enemy.kind] * (1 + Math.max(0, volleySize - 1) * 0.14));
    },
    scoreForVolley(results) {
      return results.length === 6 && results.every((result) => result.killed) ? 1800 : 0;
    },
    rankForRun(score, kills, total) {
      const clear = total > 0 ? kills / total : 0;
      const victory = coresDestroyed === 3;
      if (victory && clear > 0.9 && score > 21000) return 'ADMIRAL';
      if (victory && clear > 0.76) return 'TRIUMPH';
      if (victory) return 'BREACH';
      if (shieldsDestroyed === 4) return 'BOARDING';
      return clear > 0.55 ? 'ACE' : 'SCATTERED';
    },
    detailsForRun() {
      return [
        `Shield generators ${shieldsDestroyed}/4 · power systems ${coresDestroyed}/3`,
        coresDestroyed === 3 ? 'Enemy flagship breaking — line in retreat' : 'Flagship core remains combat-capable',
        `Point defense intercepted ${boltsIntercepted} · hull hits ${hullHits}`,
      ];
    },
  };
}
