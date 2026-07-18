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
  MASS_DRIVER_DETAILED_M7HQ_BPM,
  MASS_DRIVER_DETAILED_M7HQ_BEAT_SECONDS,
  MASS_DRIVER_DETAILED_M7HQ_RUN_DURATION,
  MASS_DRIVER_DETAILED_M7HQ_SHOT_TIME,
  MASS_DRIVER_DETAILED_M7HQ_TIME,
  mdBar,
} from './timing';

export {
  MASS_DRIVER_DETAILED_M7HQ_BPM,
  MASS_DRIVER_DETAILED_M7HQ_RUN_DURATION,
  MASS_DRIVER_DETAILED_M7HQ_TIME,
} from './timing';

export const MASS_DRIVER_DETAILED_M7HQ_PLAYER_HEALTH = 3;
export const MASS_DRIVER_DETAILED_M7HQ_INTERLOCK_COUNT = 6;
export const MASS_DRIVER_DETAILED_M7HQ_BORE_RADIUS = 12;

export type MassDriverDetailedM7hqEnemyKind = 'coil' | 'threader' | 'capacitor' | 'arc' | 'interlock';

export type MassDriverDetailedM7hqSpawnData =
  | { role: 'coil'; lead: number; socket: number; angularSpeed: number; firing: boolean; fireDelay: number }
  | { role: 'threader'; lead: number; fromX: number; toX: number; y: number; sign: number; phase: number; crossTime: number; delay: number }
  | { role: 'capacitor'; lead: number; x: number; y: number; phase: number }
  | { role: 'arc'; position: Vector3; velocity: Vector3; lastAge: number; impact: HostileShotImpactState; seed: number }
  | { role: 'interlock'; socket: number; firing: boolean; fireDelay: number };

export type MassDriverDetailedM7hqSpawnEntry = LockOnSpawnEntry<MassDriverDetailedM7hqEnemyKind, MassDriverDetailedM7hqSpawnData>;
type MassDriverUpdate = LockOnEnemyUpdate<MassDriverDetailedM7hqEnemyKind, MassDriverDetailedM7hqSpawnData>;

const speedProfile = createSpeedProfile([
  [mdBar(0), 0.34],
  [mdBar(4), 0.52],
  [mdBar(12), 0.82],
  [mdBar(20), 1.16],
  [mdBar(26), 1.52],
  [mdBar(27.99), 1.72],
  [mdBar(28), 4.85],
  [mdBar(28.5), 4.55],
  [mdBar(32), 4.08],
], MASS_DRIVER_DETAILED_M7HQ_RUN_DURATION);

export const massDriverDetailedM7hqRunProgress = speedProfile.runProgress;
export const massDriverDetailedM7hqSpeedAt = speedProfile.speedAt;
export const MASS_DRIVER_DETAILED_M7HQ_MUZZLE_U = massDriverDetailedM7hqRunProgress(MASS_DRIVER_DETAILED_M7HQ_SHOT_TIME);

export function createMassDriverDetailedM7hqRail() {
  const points: Vector3[] = [];
  const segments = 28;
  const length = 2100;
  for (let index = 0; index <= segments; index += 1) {
    const t = index / segments;
    const barrelFraction = Math.min(1, t / MASS_DRIVER_DETAILED_M7HQ_MUZZLE_U);
    const taper = barrelFraction < 0.78 ? 1 : MathUtils.smootherstep(1 - barrelFraction, 0, 0.22);
    const openSpace = MathUtils.smoothstep(t, MASS_DRIVER_DETAILED_M7HQ_MUZZLE_U, 1);
    const x = Math.sin(barrelFraction * Math.PI * 4.15) * 3.8 * taper;
    const y = Math.sin(barrelFraction * Math.PI * 2.7 + 0.8) * 2.1 * taper + openSpace * 18;
    points.push(new Vector3(x, y, -t * length));
  }
  return new CatmullRomCurve3(points, false, 'catmullrom', 0.38);
}

/** The ring at this beat is exactly where the camera is on that beat. */
export function massDriverDetailedM7hqRingU(beatIndex: number) {
  return massDriverDetailedM7hqRunProgress(Math.min(MASS_DRIVER_DETAILED_M7HQ_SHOT_TIME, beatIndex * MASS_DRIVER_DETAILED_M7HQ_BEAT_SECONDS));
}

const rankStagger = MASS_DRIVER_DETAILED_M7HQ_TIME.stepSeconds * 0.72;

function coilRank(time: number, sockets: number[], options: { lead?: number; angularSpeed?: number; firing?: number[] } = {}) {
  return sockets.map((socket, index): MassDriverDetailedM7hqSpawnEntry => ({
    time: time + index * rankStagger,
    kind: 'coil',
    lockable: false,
    data: {
      role: 'coil',
      lead: options.lead ?? 4,
      socket,
      angularSpeed: (options.angularSpeed ?? 0.23) * (index % 2 ? -1 : 1),
      firing: options.firing?.includes(index) ?? false,
      fireDelay: 1.35 + index * 0.14,
    },
  }));
}

function threaderWave(time: number, count: number, y: number, options: { lead?: number; stagger?: number; crossTime?: number } = {}) {
  return Array.from({ length: count }, (_, index): MassDriverDetailedM7hqSpawnEntry => {
    const sign = index % 2 === 0 ? 1 : -1;
    return {
      time: time + index * (options.stagger ?? rankStagger),
      kind: 'threader',
      lockable: false,
      data: {
        role: 'threader',
        lead: options.lead ?? 3.65,
        fromX: sign > 0 ? -8.2 : 8.2,
        toX: sign > 0 ? 8.2 : -8.2,
        y: y + (index - (count - 1) / 2) * 1.12 + sign * 3.25,
        sign,
        phase: index * 1.7,
        crossTime: options.crossTime ?? 2.65,
        delay: index * 0.16,
      },
    };
  });
}

function capacitors(time: number, offsets: Array<[number, number]>, lead = 4.35) {
  return offsets.map(([x, y], index): MassDriverDetailedM7hqSpawnEntry => ({
    time: time + index * MASS_DRIVER_DETAILED_M7HQ_TIME.beatSeconds * 0.5,
    kind: 'capacitor',
    hitStages: [2, 2],
    lockable: false,
    data: { role: 'capacitor', lead, x, y, phase: index * Math.PI + time },
  }));
}

function interlockRank(time: number, sockets: number[]) {
  return sockets.map((socket, index): MassDriverDetailedM7hqSpawnEntry => ({
    time: time + index * rankStagger * 1.25,
    kind: 'interlock',
    hitStages: [1, 2],
    lockable: false,
    data: { role: 'interlock', socket, firing: socket === 1 || socket === 4, fireDelay: 2.4 + index * 0.35 },
  }));
}

export const MASS_DRIVER_DETAILED_M7HQ_SPAWN_TIMELINE: MassDriverDetailedM7hqSpawnEntry[] = [
  // Injection — the counter-rotating double helix is the first readable gesture.
  ...threaderWave(mdBar(0.75), 2, 0.2, { lead: 3.15, stagger: 0.16, crossTime: 3.2 }),
  ...coilRank(mdBar(2.1), [0, 2, 3, 5], { lead: 3.2, angularSpeed: 0.18 }),
  ...threaderWave(mdBar(3.2), 3, -0.3, { lead: 3.05, stagger: 0.24, crossTime: 2.9 }),

  // Stage 1 — two-bar call and response between rim ranks and threader weaves.
  ...coilRank(mdBar(4.15), [0, 1, 3, 4], { lead: 3.15 }),
  ...threaderWave(mdBar(6.05), 4, 0.6, { lead: 2.95 }),
  ...capacitors(mdBar(7.15), [[0, -0.5]], 3.4),
  ...coilRank(mdBar(8.15), [1, 2, 4, 5], { lead: 3.05, angularSpeed: 0.3 }),
  ...threaderWave(mdBar(10.05), 5, -0.6, { lead: 2.85, stagger: 0.19 }),
  ...coilRank(mdBar(11.2), [0, 2, 3, 5], { lead: 2.95, angularSpeed: 0.34 }),

  // Stage 2 — larger ranks, counter-fire, paired armor banks, then a breath.
  ...coilRank(mdBar(12.1), [0, 1, 2, 3, 4, 5], { lead: 2.85, angularSpeed: 0.38, firing: [1, 4] }),
  ...threaderWave(mdBar(13.65), 5, 0.4, { lead: 2.65, stagger: 0.17, crossTime: 2.35 }),
  ...capacitors(mdBar(15.0), [[-3.7, 2.1], [3.7, -2.1]], 3.1),
  ...coilRank(mdBar(16.55), [0, 1, 2, 3, 4, 5], { lead: 2.65, angularSpeed: 0.46, firing: [0, 2, 4] }),
  ...threaderWave(mdBar(18.05), 6, 0, { lead: 2.5, stagger: 0.14, crossTime: 2.15 }),

  // Interlock — two ranks of three, then chaff pairs that tighten with charge.
  ...interlockRank(mdBar(20), [0, 2, 4]),
  ...interlockRank(mdBar(20.55), [1, 3, 5]),
  ...threaderWave(mdBar(22.1), 2, 0.7, { lead: 2.45, stagger: 0.16, crossTime: 2.2 }),
  ...threaderWave(mdBar(24.15), 2, -0.5, { lead: 2.25, stagger: 0.13, crossTime: 2.0 }),
  ...threaderWave(mdBar(26.1), 2, 0, { lead: 2.05, stagger: 0.1, crossTime: 1.75 }),
].sort((a, b) => a.time - b.time);

const SCORE: Record<MassDriverDetailedM7hqEnemyKind, number> = {
  coil: 130,
  threader: 155,
  capacitor: 440,
  arc: 90,
  interlock: 780,
};

export type MassDriverDetailedM7hqGameplay = LockOnRunnerLevel<MassDriverDetailedM7hqEnemyKind, MassDriverDetailedM7hqSpawnData> & {
  interlocksCleared(): number;
  interceptedArcs(): number;
  gunFired(): boolean;
  detonated(): boolean;
  resolveShot(): boolean;
};

export function createMassDriverDetailedM7hqGameplay(bus: EventBus): MassDriverDetailedM7hqGameplay {
  const interlockIds = new Set<number>();
  const arcIds = new Set<number>();
  const arcShotsInFlight = new Set<number>();
  let clearedInterlocks = 0;
  let arcInterceptions = 0;
  let hullHits = 0;
  let fired = false;
  let containmentFailed = false;

  bus.on('runstart', () => {
    interlockIds.clear();
    arcIds.clear();
    arcShotsInFlight.clear();
    clearedInterlocks = 0;
    arcInterceptions = 0;
    hullHits = 0;
    fired = false;
    containmentFailed = false;
    for (const entry of MASS_DRIVER_DETAILED_M7HQ_SPAWN_TIMELINE) entry.lockable = false;
  });
  bus.on('spawn', ({ enemyId, kind }) => {
    if (kind === 'interlock') interlockIds.add(enemyId);
    if (kind === 'arc') arcIds.add(enemyId);
  });
  bus.on('fire', ({ enemyId }) => {
    if (arcIds.has(enemyId)) arcShotsInFlight.add(enemyId);
  });
  bus.on('kill', ({ enemyId }) => {
    if (interlockIds.delete(enemyId)) clearedInterlocks += 1;
    if (arcIds.delete(enemyId)) arcInterceptions += 1;
    arcShotsInFlight.delete(enemyId);
  });
  bus.on('miss', ({ enemyId }) => {
    arcIds.delete(enemyId);
    arcShotsInFlight.delete(enemyId);
  });
  bus.on('playerhit', () => { hullHits += 1; });

  function spawnArc(context: MassDriverUpdate, from: Vector3, seed: number) {
    const velocity = hostileShotAimPoint(context.camera, from, 2.4).sub(from).normalize().multiplyScalar(6.2);
    context.spawnEnemy({
      time: context.runTime,
      kind: 'arc',
      countsTowardTotal: false,
      data: { role: 'arc', position: from.clone(), velocity, lastAge: 0, impact: {}, seed },
    });
  }

  function updateArc(context: MassDriverUpdate, data: Extract<MassDriverDetailedM7hqSpawnData, { role: 'arc' }>) {
    const dt = Math.max(0, context.age - data.lastAge);
    data.lastAge = context.age;
    const impact = updateHostileShotImpact({
      age: context.age,
      camera: context.camera,
      position: data.position,
      velocity: data.velocity,
      state: data.impact,
      intercepted: arcShotsInFlight.delete(context.enemy.id),
      config: { hitDistance: 2.8, impactBrake: 0.48, damageDistance: 0.6 },
    });
    if (impact.phase === 'braking') {
      context.enemy.mesh.position.copy(data.position);
      context.enemy.mesh.quaternion.copy(context.camera.quaternion);
      context.enemy.mesh.userData.impact = true;
      if (impact.damaged) {
        context.damagePlayer(1);
        return true;
      }
      return false;
    }
    steerHomingShot(data.position, data.velocity, hostileShotAimPoint(context.camera, data.position, 2.6), context.age, dt, {
      baseSpeed: 6.2,
      maxSpeed: 18,
      accel: 4.5,
      turnRate: 2.8,
    });
    context.enemy.mesh.position.copy(data.position);
    context.enemy.mesh.quaternion.copy(context.camera.quaternion);
    context.enemy.mesh.rotateZ(context.age * 10.5 + data.seed);
    context.enemy.mesh.userData.age = context.age;
    return context.age > 10 || shotBehindCamera(context.camera, data.position);
  }

  function updateCoil(context: MassDriverUpdate, data: Extract<MassDriverDetailedM7hqSpawnData, { role: 'coil' }>) {
    if (context.age >= 0.74) context.enemy.entry.lockable = true;
    const anchorU = context.railAnchor(data.lead);
    const angle = data.socket / 6 * Math.PI * 2 - Math.PI / 2 + context.age * data.angularSpeed;
    const fireState = context.enemyState(() => ({ fired: false, firedAt: -1 }));
    const chargeStart = data.fireDelay - 0.58;
    const telegraph = !fireState.fired ? MathUtils.clamp((context.age - chargeStart) / 0.58, 0, 1) : 0;
    const lungeAge = fireState.fired ? context.age - fireState.firedAt : 99;
    const lunge = lungeAge >= 0 && lungeAge < 0.34 ? Math.sin(lungeAge / 0.34 * Math.PI) * 2.35 : 0;
    const radius = 9.68 + Math.sin(context.age * 1.2 + data.socket) * 0.34 + telegraph * 0.72 - lunge;
    const offset = new Vector3(Math.cos(angle) * radius, Math.sin(angle) * radius, Math.sin(context.age * 0.8 + data.socket) * 0.7);
    context.enemy.mesh.position.copy(offsetFromRail(context.curve, anchorU, offset));
    context.enemy.mesh.quaternion.copy(context.camera.quaternion);
    context.enemy.mesh.rotateZ(angle + Math.PI / 2 + context.age * 0.18);
    context.enemy.mesh.userData.telegraph = telegraph;
    if (data.firing && !fireState.fired && context.age >= data.fireDelay) {
      fireState.fired = true;
      fireState.firedAt = context.age;
      spawnArc(context, context.enemy.mesh.position, context.enemy.id * 0.73);
      context.enemy.mesh.userData.recoilUntil = context.age + 0.3;
    }
    context.enemy.mesh.userData.age = context.age;
    return context.runProgress > anchorU + 0.017;
  }

  function updateThreader(context: MassDriverUpdate, data: Extract<MassDriverDetailedM7hqSpawnData, { role: 'threader' }>) {
    if (context.age >= Math.max(0.28, data.delay + 0.1)) context.enemy.entry.lockable = true;
    const anchorU = context.railAnchor(data.lead);
    const raw = (context.age - data.delay) / data.crossTime;
    if (raw > 1.17 || context.runProgress > anchorU + 0.018) return true;
    const t = MathUtils.smootherstep(MathUtils.clamp(raw, 0, 1), 0, 1);
    const helix = t * Math.PI * 4 * data.sign + data.phase;
    const x = MathUtils.lerp(data.fromX, data.toX, t);
    const y = data.y + Math.sin(t * Math.PI) * 2.4 + Math.sin(helix) * 1.05;
    const z = Math.cos(helix) * 1.55;
    const position = offsetFromRail(context.curve, anchorU, new Vector3(x, y, z));
    const aheadT = Math.min(1, t + 0.045);
    const aheadHelix = aheadT * Math.PI * 4 * data.sign + data.phase;
    const ahead = offsetFromRail(context.curve, anchorU, new Vector3(
      MathUtils.lerp(data.fromX, data.toX, aheadT),
      data.y + Math.sin(aheadT * Math.PI) * 2.4 + Math.sin(aheadHelix) * 1.05,
      Math.cos(aheadHelix) * 1.55,
    ));
    context.enemy.mesh.position.copy(position);
    context.enemy.mesh.up.set(0, 1, 0);
    context.enemy.mesh.lookAt(ahead);
    context.enemy.mesh.rotateZ(helix * 0.25);
    context.enemy.mesh.userData.age = context.age;
    return false;
  }

  function updateCapacitor(context: MassDriverUpdate, data: Extract<MassDriverDetailedM7hqSpawnData, { role: 'capacitor' }>) {
    if (context.age >= 0.48) context.enemy.entry.lockable = true;
    const anchorU = context.railAnchor(data.lead);
    const offset = new Vector3(
      data.x + Math.sin(context.age * 0.74 + data.phase) * 1.25,
      data.y + Math.sin(context.age * 1.08 + data.phase * 0.7) * 1.05,
      Math.sin(context.age * 0.48 + data.phase) * 1.2,
    );
    context.enemy.mesh.position.copy(offsetFromRail(context.curve, anchorU, offset));
    context.enemy.mesh.quaternion.copy(context.camera.quaternion);
    context.enemy.mesh.rotateZ(context.age * (data.phase % 2 > 1 ? -0.28 : 0.28));
    const exposed = context.enemy.hitStageIndex > 0;
    if (exposed && context.enemy.mesh.userData.exposedAt === undefined) context.enemy.mesh.userData.exposedAt = context.age;
    context.enemy.mesh.userData.exposed = exposed;
    context.enemy.mesh.userData.age = context.age;
    return context.runProgress > anchorU + 0.02;
  }

  function updateInterlock(context: MassDriverUpdate, data: Extract<MassDriverDetailedM7hqSpawnData, { role: 'interlock' }>) {
    const anchorU = massDriverDetailedM7hqRunProgress(Math.min(context.runTime + 0.95, MASS_DRIVER_DETAILED_M7HQ_SHOT_TIME));
    const angle = data.socket / MASS_DRIVER_DETAILED_M7HQ_INTERLOCK_COUNT * Math.PI * 2 - Math.PI / 2;
    const reveal = MathUtils.smootherstep(MathUtils.clamp(context.age / 0.72, 0, 1), 0, 1);
    if (context.age >= 0.88) context.enemy.entry.lockable = true;
    const charge = MathUtils.clamp((context.runTime - mdBar(20)) / (MASS_DRIVER_DETAILED_M7HQ_SHOT_TIME - mdBar(20)), 0, 1);
    const radius = MathUtils.lerp(2.4, 8.9, reveal);
    const shudder = 0.04 + charge * charge * 0.24;
    const frame = sampleRailFrame(context.curve, anchorU);
    context.enemy.mesh.position.copy(frame.position)
      .addScaledVector(frame.right, Math.cos(angle) * radius + Math.sin(context.age * 27 + data.socket) * shudder)
      .addScaledVector(frame.up, Math.sin(angle) * radius + Math.cos(context.age * 23 + data.socket) * shudder)
      .addScaledVector(frame.tangent, 0.6 + Math.sin(context.age * 1.1 + data.socket) * 0.35);
    context.enemy.mesh.quaternion.copy(context.camera.quaternion);
    context.enemy.mesh.rotateZ(angle + Math.PI / 4 + Math.sin(context.age * 21) * shudder * 0.2);
    context.enemy.mesh.userData.charge = charge;
    const exposed = context.enemy.hitStageIndex > 0;
    if (exposed && context.enemy.mesh.userData.exposedAt === undefined) context.enemy.mesh.userData.exposedAt = context.age;
    context.enemy.mesh.userData.exposed = exposed;
    context.enemy.mesh.userData.age = context.age;

    const fireState = context.enemyState(() => ({ next: data.fireDelay, shots: 0 }));
    const untilFire = fireState.next - context.age;
    context.enemy.mesh.userData.telegraph = data.firing && fireState.shots < 2 ? MathUtils.clamp((0.7 - untilFire) / 0.7, 0, 1) : 0;
    if (data.firing && fireState.shots < 2 && context.age >= fireState.next && context.runTime < MASS_DRIVER_DETAILED_M7HQ_SHOT_TIME - 1) {
      spawnArc(context, context.enemy.mesh.position, data.socket + fireState.shots * 7.1);
      fireState.shots += 1;
      fireState.next += 4.15;
    }

    if (!fired && context.runTime >= MASS_DRIVER_DETAILED_M7HQ_SHOT_TIME - 0.015) {
      if (clearedInterlocks >= MASS_DRIVER_DETAILED_M7HQ_INTERLOCK_COUNT) fired = true;
      else {
        containmentFailed = true;
        context.damagePlayer(99);
      }
    }
    return false;
  }

  return {
    duration: MASS_DRIVER_DETAILED_M7HQ_RUN_DURATION,
    bpm: MASS_DRIVER_DETAILED_M7HQ_BPM,
    playerHealth: MASS_DRIVER_DETAILED_M7HQ_PLAYER_HEALTH,
    createRail: createMassDriverDetailedM7hqRail,
    spawnTimeline: MASS_DRIVER_DETAILED_M7HQ_SPAWN_TIMELINE,
    easeRunProgress: massDriverDetailedM7hqRunProgress,
    startWord: 'CHARGE',
    replayWord: 'RELOAD',
    lockRadiusNdc: 0.18,
    timing: {
      shotDelay: { maxGridSeconds: 0.19 },
      actionSfx: { enabled: true, gridThirtyseconds: 2 },
    },
    interlocksCleared: () => clearedInterlocks,
    interceptedArcs: () => arcInterceptions,
    gunFired: () => fired,
    detonated: () => containmentFailed,
    resolveShot() {
      if (clearedInterlocks >= MASS_DRIVER_DETAILED_M7HQ_INTERLOCK_COUNT) fired = true;
      return fired;
    },
    updateEnemy(context) {
      const data = context.enemy.entry.data;
      switch (data.role) {
        case 'coil': return updateCoil(context, data);
        case 'threader': return updateThreader(context, data);
        case 'capacitor': return updateCapacitor(context, data);
        case 'arc': return updateArc(context, data);
        case 'interlock': return updateInterlock(context, data);
      }
    },
    scoreForHit(volleySize, enemy) {
      return Math.round(42 + SCORE[enemy.kind] * 0.12 + Math.max(0, volleySize - 1) * 9);
    },
    scoreForKill(volleySize, enemy) {
      return Math.round(SCORE[enemy.kind] * (1 + Math.max(0, volleySize - 1) * 0.17));
    },
    scoreForVolley(results) {
      if (results.length < 3 || !results.every((result) => result.killed)) return 0;
      if (results.length === 6) return 1800;
      return results.length * results.length * 35;
    },
    rankForRun(score, kills, totalEnemies) {
      const clearRate = totalEnemies > 0 ? kills / totalEnemies : 0;
      const launched = clearedInterlocks >= MASS_DRIVER_DETAILED_M7HQ_INTERLOCK_COUNT && !containmentFailed;
      if (launched && score >= 30000 && clearRate >= 0.94) return 'S';
      if (launched && score >= 10000 && clearRate >= 0.68) return 'A';
      if (score >= 6500 && clearRate >= 0.48) return 'B';
      if (score >= 3200 && clearRate >= 0.26) return 'C';
      return 'D';
    },
    detailsForRun() {
      const hull = containmentFailed ? 0 : Math.max(0, MASS_DRIVER_DETAILED_M7HQ_PLAYER_HEALTH - hullHits);
      const launched = clearedInterlocks >= MASS_DRIVER_DETAILED_M7HQ_INTERLOCK_COUNT && !containmentFailed;
      return [
        `Hull ${hull}/${MASS_DRIVER_DETAILED_M7HQ_PLAYER_HEALTH}`,
        `Interlocks cleared ${clearedInterlocks}/${MASS_DRIVER_DETAILED_M7HQ_INTERLOCK_COUNT}`,
        `Arcs intercepted ${arcInterceptions}`,
        launched ? 'PAYLOAD AWAY — muzzle exit clean' : 'CHARGE CONTAINMENT FAILED',
      ];
    },
  };
}
