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
  SKYHOOK_7631_BOSS_DEADLINE,
  SKYHOOK_7631_BOSS_TIME,
  SKYHOOK_7631_BPM,
  SKYHOOK_7631_RUN_DURATION,
  SKYHOOK_7631_TIME,
  skyhook7631Bar,
} from './timing';

// SKYHOOK — 24 bars at 96 BPM, exactly sixty seconds.
//
//   0–15s     Heavy weather: broad gustwing formations teach the sweep while
//             boarding claws make the climber hull matter immediately.
//   15–30s    Cloud break: hard sunlight, rigid skimmers, and tether crawlers.
//   30–42.5s  Thin air: the field opens, percussion and traffic fall away.
//   42.5–55s  Cable Reaver: three clamps guard an 18-hit winch core as the
//             whole machine climbs visibly down the tether toward the car.
//   55–60s    Docking: no targets, no percussion, only the station mouth.

export { SKYHOOK_7631_BPM, SKYHOOK_7631_RUN_DURATION } from './timing';
export const SKYHOOK_7631_PLAYER_HEALTH = 4;

export type Skyhook7631EnemyKind =
  | 'gustwing'
  | 'skimmer'
  | 'boarder'
  | 'crawler'
  | 'bolt'
  | 'reaver'
  | 'clamp';

export type Skyhook7631SpawnData =
  | {
      role: 'gustwing';
      lead: number;
      fromX: number;
      toX: number;
      y: number;
      arc: number;
      crossTime: number;
      phase: number;
    }
  | {
      role: 'skimmer';
      lead: number;
      centerX: number;
      centerY: number;
      radiusX: number;
      radiusY: number;
      angularSpeed: number;
      phase: number;
      fireAt?: number;
    }
  | {
      role: 'boarder';
      lead: number;
      x: number;
      y: number;
      carX: number;
      diveTime: number;
      phase: number;
    }
  | {
      role: 'crawler';
      leadStart: number;
      leadEnd: number;
      lane: number;
      side: number;
      seed: number;
      fireAt: number;
    }
  | {
      role: 'bolt';
      position: Vector3;
      velocity: Vector3;
      lastAge: number;
      impact: HostileShotImpactState;
    }
  | { role: 'reaver' }
  | { role: 'clamp'; socket: number };

export type Skyhook7631SpawnEntry = LockOnSpawnEntry<Skyhook7631EnemyKind, Skyhook7631SpawnData>;
type SkyhookUpdate = LockOnEnemyUpdate<Skyhook7631EnemyKind, Skyhook7631SpawnData>;

// The camera climbs more urgently at the cloud break, then brakes as the
// Reaver descends and the station takes control of the car.
const speedProfile = createSpeedProfile([
  [SKYHOOK_7631_TIME.bar(0), 0.68],
  [SKYHOOK_7631_TIME.bar(3), 0.95],
  [SKYHOOK_7631_TIME.bar(5.5), 1.08],
  [SKYHOOK_7631_TIME.bar(6), 1.62],
  [SKYHOOK_7631_TIME.bar(7), 1.0],
  [SKYHOOK_7631_TIME.bar(12), 1.2],
  [SKYHOOK_7631_TIME.bar(15), 1.34],
  [SKYHOOK_7631_TIME.bar(17), 0.76],
  [SKYHOOK_7631_TIME.bar(21), 0.7],
  [SKYHOOK_7631_TIME.bar(22), 0.46],
  [SKYHOOK_7631_TIME.bar(24), 0.16],
], SKYHOOK_7631_RUN_DURATION);

export const skyhook7631RunProgress = speedProfile.runProgress;
export const skyhook7631SpeedFactorAt = speedProfile.speedAt;

export function createSkyhook7631Rail() {
  return new CatmullRomCurve3(
    [
      new Vector3(0, 0, 0),
      new Vector3(3, 34, -22),
      new Vector3(-4, 76, -47),
      new Vector3(5, 124, -72),
      new Vector3(-5, 181, -98),
      new Vector3(4, 246, -126),
      new Vector3(-3, 318, -153),
      new Vector3(5, 394, -178),
      new Vector3(-4, 474, -200),
      new Vector3(3, 557, -218),
      new Vector3(-2, 641, -232),
      new Vector3(0, 724, -240),
    ],
    false,
    'catmullrom',
    0.42,
  );
}

const gustwings = (
  time: number,
  direction: 1 | -1,
  ys: number[],
  lead = 3.7,
  spread = 15,
): Skyhook7631SpawnEntry[] => ys.map((y, index) => ({
  time: time + index * 0.14,
  kind: 'gustwing',
  data: {
    role: 'gustwing',
    lead,
    fromX: -spread * direction,
    toX: spread * direction,
    y,
    arc: (index % 2 === 0 ? 1 : -1) * (2.2 + index * 0.3),
    crossTime: 3.0 + (index % 3) * 0.24,
    phase: time * 1.7 + index * 1.91,
  },
}));

const skimmers = (
  time: number,
  centers: Array<[number, number]>,
  lead = 3.8,
  hostile = true,
): Skyhook7631SpawnEntry[] => centers.map(([centerX, centerY], index) => ({
  time: time + index * 0.12,
  kind: 'skimmer',
  data: {
    role: 'skimmer',
    lead,
    centerX,
    centerY,
    radiusX: 2.4 + (index % 3) * 0.8,
    radiusY: 1.4 + (index % 2) * 0.7,
    angularSpeed: (index % 2 === 0 ? 1 : -1) * (0.72 + index * 0.04),
    phase: index * 1.73 + time,
    fireAt: hostile && index % 2 === 0 ? 1.65 + (index % 3) * 0.28 : undefined,
  },
}));

const boarders = (time: number, positions: Array<[number, number]>, lead = 4.0): Skyhook7631SpawnEntry[] =>
  positions.map(([x, y], index) => ({
    time: time + index * 0.24,
    kind: 'boarder',
    data: {
      role: 'boarder',
      lead,
      x,
      y,
      carX: Math.sign(x || (index % 2 === 0 ? -1 : 1)) * (1.35 + (index % 2) * 0.35),
      diveTime: 4.25 + (index % 2) * 0.3,
      phase: time + index * 2.4,
    },
  }));

const crawlers = (time: number, lanes: number[], lead = 4.6): Skyhook7631SpawnEntry[] => lanes.map((lane, index) => ({
  time: time + index * 0.18,
  kind: 'crawler',
  hitPoints: 2,
  data: {
    role: 'crawler',
    leadStart: lead,
    leadEnd: 2.1,
    lane,
    side: index % 2 === 0 ? 1 : -1,
    seed: time * 3.1 + index * 2.3,
    fireAt: 1.85 + index * 0.22,
  },
}));

function createBossEntries() {
  const coreEntry: Skyhook7631SpawnEntry = {
    time: SKYHOOK_7631_BOSS_TIME + SKYHOOK_7631_TIME.beats(6),
    kind: 'reaver',
    hitStages: [4, 4, 4],
    lockable: false,
    data: { role: 'reaver' },
  };
  const clamps: Skyhook7631SpawnEntry[] = [0, 1, 2].map((socket, index) => ({
    time: SKYHOOK_7631_BOSS_TIME + index * 0.1,
    kind: 'clamp',
    hitPoints: 1,
    data: { role: 'clamp', socket },
  }));
  return { coreEntry, entries: [...clamps, coreEntry] };
}

function buildTimeline(bossEntries: Skyhook7631SpawnEntry[]) {
  return [
    // Weather — wide, wind-driven diagonals with boarders hiding in the squalls.
    ...gustwings(skyhook7631Bar(1), 1, [-5.5, -1.5, 2.5, 6]),
    ...boarders(skyhook7631Bar(2.15), [[-10, 5], [10, 1.5]]),
    ...gustwings(skyhook7631Bar(3), -1, [-6, -2.8, 0.5, 3.5, 6.5], 3.6, 17),
    ...boarders(skyhook7631Bar(4.15), [[-12, -1], [0, 7], [12, -1]], 4.15),
    ...gustwings(skyhook7631Bar(5), 1, [-7, -4.2, -1.4, 1.4, 4.2, 7], 3.45, 18),

    // Bar six is deliberately clear: the car punches through the cloud deck.
    ...skimmers(skyhook7631Bar(6.85), [[-10, -4], [-4, 3], [4, 3], [10, -4]], 3.8, false),
    ...crawlers(skyhook7631Bar(7.8), [-5, 0, 5], 4.7),
    ...skimmers(skyhook7631Bar(8.65), [[-12, 0], [-7, 5], [0, -5], [7, 5], [12, 0]], 3.7),
    ...boarders(skyhook7631Bar(9.8), [[-13, 4], [13, 4], [0, -6]], 3.85),
    ...skimmers(skyhook7631Bar(10.55), [[-11, -5], [-4, 5], [4, -5], [11, 5]], 3.65),
    ...crawlers(skyhook7631Bar(11.25), [-6, 2, 6], 4.35),

    // Thin air — formations widen as layers disappear from the arrangement.
    ...skimmers(skyhook7631Bar(12.15), [[-14, -5], [-9, 2], [-3, 6], [3, -6], [9, -2], [14, 5]], 3.55),
    ...boarders(skyhook7631Bar(13.15), [[-14, 6], [14, 6]], 3.75),
    ...crawlers(skyhook7631Bar(13.75), [-6, -2, 2, 6], 4.15),
    ...skimmers(skyhook7631Bar(14.55), [[-13, -5], [-8, 4], [0, 7], [8, 4], [13, -5]], 3.55),
    ...skimmers(skyhook7631Bar(15.35), [[-15, 0], [-10, 6], [-5, -5], [5, 5], [10, -6], [15, 0]], 3.4, false),

    // The descending winch and three armor clamps. The field clears completely
    // here so the player's eye stays on the machine growing down the cable.
    ...bossEntries,
  ].sort((a, b) => a.time - b.time);
}

export function createSkyhook7631Timeline() {
  const boss = createBossEntries();
  return { coreEntry: boss.coreEntry, timeline: buildTimeline(boss.entries) };
}

// Exported for spawn tracing; the runtime factory below creates a fresh copy
// because it mutates the boss core's lockable flag between phases.
export const SKYHOOK_7631_SPAWN_TIMELINE = createSkyhook7631Timeline().timeline;

const KILL_SCORE: Record<Skyhook7631EnemyKind, number> = {
  gustwing: 100,
  skimmer: 140,
  boarder: 220,
  crawler: 260,
  bolt: 60,
  reaver: 2400,
  clamp: 420,
};

export function createSkyhook7631Gameplay(bus: EventBus): LockOnRunnerLevel<Skyhook7631EnemyKind, Skyhook7631SpawnData> {
  const { coreEntry, timeline } = createSkyhook7631Timeline();
  const intercepted = new Set<number>();
  const kindsById = new Map<number, Skyhook7631EnemyKind>();
  const boss = {
    coreId: -1,
    summoned: false,
    coreSpawned: false,
    coreKilled: false,
    exposed: false,
    doomed: false,
    clampIds: new Set<number>(),
    position: new Vector3(),
    right: new Vector3(1, 0, 0),
    up: new Vector3(0, 1, 0),
    forward: new Vector3(0, 0, -1),
  };
  let hullDamage = 0;
  let boardersStopped = 0;
  let boltsStopped = 0;

  bus.on('runstart', () => {
    intercepted.clear();
    kindsById.clear();
    boss.coreId = -1;
    boss.summoned = false;
    boss.coreSpawned = false;
    boss.coreKilled = false;
    boss.exposed = false;
    boss.doomed = false;
    boss.clampIds.clear();
    coreEntry.lockable = false;
    hullDamage = 0;
    boardersStopped = 0;
    boltsStopped = 0;
  });

  bus.on('spawn', ({ enemyId, kind }) => {
    const typedKind = kind as Skyhook7631EnemyKind;
    kindsById.set(enemyId, typedKind);
    if (kind === 'reaver') {
      boss.coreId = enemyId;
      boss.coreSpawned = true;
    }
    if (kind === 'clamp') {
      boss.clampIds.add(enemyId);
      if (!boss.summoned) {
        boss.summoned = true;
        bus.emit('bossphase', { phase: 'summoned' });
      }
    }
  });

  const releaseClamp = (enemyId: number) => {
    if (!boss.clampIds.delete(enemyId)) return;
    if (boss.clampIds.size === 0 && !boss.exposed) {
      boss.exposed = true;
      coreEntry.lockable = true;
      bus.emit('bossphase', { phase: 'exposed' });
    }
  };

  bus.on('fire', ({ enemyId }) => {
    intercepted.add(enemyId);
  });

  bus.on('kill', ({ enemyId }) => {
    intercepted.delete(enemyId);
    const kind = kindsById.get(enemyId);
    if (kind === 'boarder') boardersStopped += 1;
    if (kind === 'bolt') boltsStopped += 1;
    if (kind === 'clamp') releaseClamp(enemyId);
    if (enemyId === boss.coreId) {
      boss.coreKilled = true;
      bus.emit('bossphase', { phase: 'destroyed' });
    }
    kindsById.delete(enemyId);
  });

  bus.on('miss', ({ enemyId }) => {
    intercepted.delete(enemyId);
    if (kindsById.get(enemyId) === 'clamp') releaseClamp(enemyId);
    kindsById.delete(enemyId);
  });

  bus.on('playerhit', ({ damage }) => {
    hullDamage += damage;
  });

  function spawnBolt(context: SkyhookUpdate, from: Vector3, spread = 0) {
    const target = hostileShotAimPoint(context.camera, from, 2.6);
    const right = new Vector3().setFromMatrixColumn(context.camera.matrixWorld, 0).normalize();
    target.addScaledVector(right, spread);
    const velocity = target.sub(from).normalize().multiplyScalar(7.2);
    context.spawnEnemy({
      time: context.runTime,
      kind: 'bolt',
      countsTowardTotal: false,
      data: { role: 'bolt', position: from.clone(), velocity, lastAge: 0, impact: {} },
    });
  }

  function updateGustwing(context: SkyhookUpdate, data: Extract<Skyhook7631SpawnData, { role: 'gustwing' }>) {
    const { enemy, age, curve, camera, runProgress, railAnchor } = context;
    const anchorU = railAnchor(Math.max(2.2, data.lead - 0.2));
    const t = age / data.crossTime;
    if (t > 1.18 || runProgress > anchorU + 0.018) return true;
    const eased = smoother(MathUtils.clamp(t, 0, 1));
    const x = MathUtils.lerp(data.fromX, data.toX, eased);
    const y = data.y + Math.sin(eased * Math.PI) * data.arc + Math.sin(age * 2.5 + data.phase) * 0.45;
    enemy.mesh.position.copy(offsetFromRail(curve, anchorU, new Vector3(x, y, Math.sin(age * 4 + data.phase) * 0.7)));
    enemy.mesh.quaternion.copy(camera.quaternion);
    enemy.mesh.rotateZ(-Math.atan2(data.toX - data.fromX, data.crossTime * 20) + Math.sin(age * 2 + data.phase) * 0.22);
    enemy.mesh.rotateY(Math.sin(age * 5.2 + data.phase) * 0.22);
    return false;
  }

  function updateSkimmer(context: SkyhookUpdate, data: Extract<Skyhook7631SpawnData, { role: 'skimmer' }>) {
    const { enemy, age, curve, camera, runProgress, railAnchor } = context;
    const anchorU = railAnchor(Math.max(2.2, data.lead - 0.2));
    if (runProgress > anchorU + 0.018) return true;
    const angle = data.phase + age * data.angularSpeed;
    const spreadCenter = Math.abs(data.centerX) < 6
      ? (Math.sin(data.phase) >= 0 ? 1 : -1) * (6 + Math.abs(data.centerX) * 0.35)
      : data.centerX;
    const orbitX = spreadCenter + Math.cos(angle) * data.radiusX;
    const x = Math.sign(orbitX || spreadCenter) * Math.max(9.2, Math.abs(orbitX));
    const y = data.centerY + Math.sin(angle) * data.radiusY;
    enemy.mesh.position.copy(offsetFromRail(curve, anchorU, new Vector3(x, y, Math.sin(angle * 2) * 1.4)));
    enemy.mesh.quaternion.copy(camera.quaternion);
    enemy.mesh.rotateZ(angle + Math.PI / 2);
    enemy.mesh.rotateX(Math.sin(angle) * 0.35);
    if (data.fireAt !== undefined) {
      const state = context.enemyState(() => ({ fired: false }));
      if (!state.fired && age >= data.fireAt) {
        state.fired = true;
        spawnBolt(context, enemy.mesh.position, Math.sin(data.phase) * 0.7);
      }
    }
    return age > data.lead + 1;
  }

  function updateBoarder(context: SkyhookUpdate, data: Extract<Skyhook7631SpawnData, { role: 'boarder' }>) {
    const { enemy, age, curve, camera, railAnchor, damagePlayer } = context;
    const state = context.enemyState(() => ({ struck: false }));
    const t = MathUtils.clamp(age / data.diveTime, 0, 1);
    const dive = t * t * (2 - t);
    const start = offsetFromRail(curve, railAnchor(Math.max(2.2, data.lead - 0.18)), new Vector3(
      data.x + Math.sin(age * 2.2 + data.phase) * 1.2,
      data.y + Math.cos(age * 2.8 + data.phase) * 0.8,
      0,
    ));
    const forward = new Vector3();
    camera.getWorldDirection(forward);
    const right = new Vector3().setFromMatrixColumn(camera.matrixWorld, 0).normalize();
    const up = new Vector3().setFromMatrixColumn(camera.matrixWorld, 1).normalize();
    const carSocket = camera.position.clone()
      .addScaledVector(forward, 2.25)
      .addScaledVector(right, data.carX)
      .addScaledVector(up, -1.45);
    enemy.mesh.position.copy(start).lerp(carSocket, dive);
    enemy.mesh.lookAt(carSocket);
    enemy.mesh.rotateZ(Math.sin(age * 7 + data.phase) * 0.16);
    if (t >= 1 && !state.struck) {
      state.struck = true;
      damagePlayer(1);
      return true;
    }
    return false;
  }

  function updateCrawler(context: SkyhookUpdate, data: Extract<Skyhook7631SpawnData, { role: 'crawler' }>) {
    const { enemy, age, curve, camera, runProgress, railAnchor } = context;
    const close = smoother(MathUtils.clamp(age / 5.2, 0, 1));
    const lead = MathUtils.lerp(data.leadStart - 0.2, data.leadEnd - 0.1, close);
    const anchorU = railAnchor(lead);
    const tetherX = 8.4 * data.side;
    const x = tetherX + Math.sin(age * 3.1 + data.seed) * 0.65;
    const y = data.lane + Math.sin(age * 1.4 + data.seed) * 1.1;
    enemy.mesh.position.copy(offsetFromRail(curve, anchorU, new Vector3(x, y, -age * 0.5)));
    enemy.mesh.quaternion.copy(camera.quaternion);
    enemy.mesh.rotateZ(data.side * (Math.PI / 2 + Math.sin(age * 2.6 + data.seed) * 0.18));
    const state = context.enemyState(() => ({ fired: false }));
    if (!state.fired && age >= data.fireAt) {
      state.fired = true;
      spawnBolt(context, enemy.mesh.position, data.side * 0.9);
    }
    return age > 6.2 || runProgress > anchorU + 0.02;
  }

  function updateBolt(context: SkyhookUpdate, data: Extract<Skyhook7631SpawnData, { role: 'bolt' }>) {
    const { enemy, age, camera, damagePlayer } = context;
    const dt = Math.max(0, age - data.lastAge);
    data.lastAge = age;
    const impact = updateHostileShotImpact({
      age,
      camera,
      position: data.position,
      velocity: data.velocity,
      state: data.impact,
      intercepted: intercepted.delete(enemy.id),
      config: { hitDistance: 2.7, impactBrake: 0.42, damageDistance: 0.74 },
    });
    if (impact.phase === 'braking') {
      enemy.mesh.position.copy(data.position);
      enemy.mesh.quaternion.copy(camera.quaternion);
      enemy.mesh.rotateZ(age * 11);
      if (impact.damaged) {
        damagePlayer(1);
        return true;
      }
      return false;
    }
    steerHomingShot(data.position, data.velocity, hostileShotAimPoint(camera, data.position, 2.7), age, dt, {
      baseSpeed: 7.2,
      maxSpeed: 16,
      accel: 2.8,
      turnRate: 2.15,
    });
    enemy.mesh.position.copy(data.position);
    if (data.velocity.lengthSq() > 0.001) enemy.mesh.lookAt(data.position.clone().add(data.velocity));
    return age > 11 || shotBehindCamera(camera, data.position);
  }

  function updateBossFrame(context: SkyhookUpdate) {
    const { runTime, runProgress, curve } = context;
    const fight = MathUtils.clamp(
      (runTime - SKYHOOK_7631_BOSS_TIME) / (SKYHOOK_7631_BOSS_DEADLINE - SKYHOOK_7631_BOSS_TIME),
      0,
      1,
    );
    const approach = 1 - (1 - fight) ** 2;
    const distanceAhead = MathUtils.lerp(58, 7.2, approach);
    const frame = sampleRailFrame(curve, MathUtils.clamp(runProgress + distanceAhead / curve.getLength(), 0, 1));
    boss.position.copy(frame.position)
      .addScaledVector(frame.right, 6.2)
      .addScaledVector(frame.up, 1.4);
    boss.right.copy(frame.right);
    boss.up.copy(frame.up);
    boss.forward.copy(frame.tangent).negate();
    return approach;
  }

  function updateReaver(context: SkyhookUpdate) {
    const { enemy, runTime, camera, damagePlayer, playerHealth } = context;
    const approach = updateBossFrame(context);
    enemy.mesh.position.copy(boss.position);
    enemy.mesh.quaternion.copy(camera.quaternion);
    enemy.mesh.rotateZ(Math.sin(runTime * 0.65) * 0.08);
    enemy.mesh.userData.approach = approach;
    enemy.mesh.userData.shielded = !boss.exposed;
    enemy.mesh.userData.hitStage = enemy.hitStageIndex;

    if (!boss.coreKilled && !boss.doomed && runTime >= SKYHOOK_7631_BOSS_DEADLINE) {
      boss.doomed = true;
      damagePlayer(Math.max(SKYHOOK_7631_PLAYER_HEALTH, playerHealth));
    }
    return false;
  }

  function updateClamp(context: SkyhookUpdate, data: Extract<Skyhook7631SpawnData, { role: 'clamp' }>) {
    const { enemy, age, camera } = context;
    updateBossFrame(context);
    const angle = -Math.PI / 2 + data.socket * (Math.PI * 2 / 3) + Math.sin(age * 1.6 + data.socket) * 0.08;
    const radiusX = 5.0;
    const radiusY = 3.8;
    enemy.mesh.position.copy(boss.position)
      .addScaledVector(boss.right, Math.cos(angle) * radiusX)
      .addScaledVector(boss.up, Math.sin(angle) * radiusY)
      .addScaledVector(boss.forward, 0.7);
    enemy.mesh.quaternion.copy(camera.quaternion);
    enemy.mesh.rotateZ(angle + Math.PI / 2);
    enemy.mesh.userData.socket = data.socket;
    return boss.coreKilled;
  }

  return {
    duration: SKYHOOK_7631_RUN_DURATION,
    bpm: SKYHOOK_7631_BPM,
    playerHealth: SKYHOOK_7631_PLAYER_HEALTH,
    startWord: 'ASCEND',
    replayWord: 'REDOCK',
    lockRadiusNdc: 0.12,
    timing: {
      shotDelay: { pattern: 'grid-ramp', maxGridSeconds: 1.35, releaseShare: 0.68 },
      actionSfx: { enabled: true, gridThirtyseconds: 1 },
    },
    createRail: createSkyhook7631Rail,
    spawnTimeline: timeline,
    easeRunProgress: skyhook7631RunProgress,
    updateEnemy(context) {
      const data = context.enemy.entry.data;
      switch (data.role) {
        case 'gustwing': return updateGustwing(context, data);
        case 'skimmer': return updateSkimmer(context, data);
        case 'boarder': return updateBoarder(context, data);
        case 'crawler': return updateCrawler(context, data);
        case 'bolt': return updateBolt(context, data);
        case 'reaver': return updateReaver(context);
        case 'clamp': return updateClamp(context, data);
      }
    },
    scoreForKill(volleySize, enemy) {
      const chain = 1 + Math.max(0, volleySize - 1) * 0.16;
      return Math.round(KILL_SCORE[enemy.kind] * chain);
    },
    scoreForHit(_volleySize, enemy) {
      return enemy.kind === 'reaver' ? 90 : enemy.kind === 'clamp' ? 55 : 35;
    },
    scoreForVolley(results) {
      if (results.length < 4 || !results.every((result) => result.killed)) return 0;
      return results.length === 6 ? 720 : results.length * 70;
    },
    rankForRun(score, kills, totalEnemies) {
      const clear = totalEnemies > 0 ? kills / totalEnemies : 0;
      if (boss.coreKilled && hullDamage === 0 && score >= 11_500 && clear >= 0.82) return 'S';
      if (boss.coreKilled && score >= 8_000 && clear >= 0.64) return 'A';
      if (score >= 5_000 && clear >= 0.45) return 'B';
      if (score >= 2_300 && clear >= 0.24) return 'C';
      return 'D';
    },
    detailsForRun() {
      const integrity = Math.max(0, SKYHOOK_7631_PLAYER_HEALTH - hullDamage);
      return [
        `Climber integrity ${integrity}/${SKYHOOK_7631_PLAYER_HEALTH}`,
        `${boardersStopped} boarder${boardersStopped === 1 ? '' : 's'} stopped · ${boltsStopped} harpoon${boltsStopped === 1 ? '' : 's'} cut`,
        boss.coreKilled ? 'Cable Reaver severed — dock secured' : 'Cable Reaver reached the climber',
      ];
    },
  };
}

function smoother(value: number) {
  return value * value * (3 - 2 * value);
}
