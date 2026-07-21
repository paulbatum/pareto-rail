import { CatmullRomCurve3, MathUtils, Vector3 } from 'three';
import type { EventBus } from '../../events';
import type { LockOnEnemyUpdate, LockOnRunnerLevel, LockOnSpawnEntry } from '../../engine/lock-on-runner';
import { createSpeedProfile } from '../../engine/speed-profile';
import {
  INTERLOCK_TIME,
  MASS_DRIVER_BPM,
  MASS_DRIVER_DURATION,
  MASS_DRIVER_TIME,
  SHOT_TIME,
  bar,
} from './timing';

export { MASS_DRIVER_BPM as MASS_DRIVER_DETAILED_UK78_BPM, MASS_DRIVER_DURATION as MASS_DRIVER_DETAILED_UK78_RUN_DURATION, MASS_DRIVER_TIME as MASS_DRIVER_DETAILED_UK78_TIME } from './timing';

export const MASS_DRIVER_PLAYER_HEALTH = 3;
export const BORE_RADIUS = 12;

export type MassDriverEnemyKind = 'coil' | 'threader' | 'capacitor' | 'arc' | 'interlock';

type CoilData = { role: 'coil'; clock: number; lead: number; delay: number; firing: boolean };
type ThreaderData = { role: 'threader'; sign: number; y: number; delay: number; crossTime: number; lead: number };
type CapacitorData = { role: 'capacitor'; x: number; y: number; lead: number; phase: number };
type ArcData = { role: 'arc'; x: number; y: number; travel: number; source: 'coil' | 'interlock' };
type InterlockData = { role: 'interlock'; clock: number; rank: number; firing: boolean };
export type MassDriverSpawnData = CoilData | ThreaderData | CapacitorData | ArcData | InterlockData;
export type MassDriverSpawnEntry = LockOnSpawnEntry<MassDriverEnemyKind, MassDriverSpawnData>;
type MassDriverUpdate = LockOnEnemyUpdate<MassDriverEnemyKind, MassDriverSpawnData>;

export type MassDriverMetrics = {
  fired: boolean;
  detonated: boolean;
  interlocksCleared: number;
  arcsIntercepted: number;
  hitsTaken: number;
};

export type MassDriverGameplay = LockOnRunnerLevel<MassDriverEnemyKind, MassDriverSpawnData> & {
  metrics: MassDriverMetrics;
};

const SPEED_KEYS: Array<[number, number]> = [
  [bar(0), 0.38],
  [bar(4), 0.62],
  [bar(12), 0.95],
  [bar(20), 1.38],
  [bar(24), 1.72],
  [bar(27), 2.25],
  [SHOT_TIME - 0.03, 2.6],
  [SHOT_TIME, 7.8],
  [bar(29), 7.45],
  [bar(32), 6.6],
];

const speedProfile = createSpeedProfile(SPEED_KEYS, MASS_DRIVER_DURATION);
export const massDriverRunProgress = speedProfile.runProgress;
export const massDriverSpeedAt = speedProfile.speedAt;
export const MUZZLE_U = massDriverRunProgress(SHOT_TIME, MASS_DRIVER_DURATION);

export function createMassDriverRail() {
  const points: Vector3[] = [];
  const length = 1600;
  const count = 40;
  for (let index = 0; index <= count; index += 1) {
    const t = index / count;
    const z = -length * t;
    const beforeMuzzle = MathUtils.clamp(1 - t / MUZZLE_U, 0, 1);
    const weave = beforeMuzzle ** 1.7;
    const x = Math.sin(t * Math.PI * 5.1) * 2.3 * weave;
    const y = Math.sin(t * Math.PI * 3.2 + 0.6) * 1.35 * weave;
    const postShot = MathUtils.smoothstep(t, MUZZLE_U, 1);
    points.push(new Vector3(x, y + postShot * 28, z));
  }
  return new CatmullRomCurve3(points, false, 'catmullrom', 0.36);
}

function coilRank(time: number, clocks: number[], firing: number[] = []): MassDriverSpawnEntry[] {
  return clocks.map((clock, index) => ({
    time: time + index * MASS_DRIVER_TIME.stepSeconds * 0.7,
    kind: 'coil',
    data: { role: 'coil', clock, lead: 4.6, delay: index * 0.12, firing: firing.includes(index) },
  }));
}

function threaderWave(time: number, ys: number[], crossTime = 3.2): MassDriverSpawnEntry[] {
  return ys.map((y, index) => ({
    time: time + index * MASS_DRIVER_TIME.stepSeconds,
    kind: 'threader',
    data: { role: 'threader', sign: index % 2 === 0 ? 1 : -1, y, delay: index * 0.1, crossTime, lead: 4.3 },
  }));
}

function capacitor(time: number, x: number, y: number, phase: number): MassDriverSpawnEntry {
  return { time, kind: 'capacitor', hitStages: [2, 2], data: { role: 'capacitor', x, y, lead: 6, phase } };
}

function buildTimeline(): MassDriverSpawnEntry[] {
  const entries: MassDriverSpawnEntry[] = [
    // Injection: the paired counter-rotating double helix is the reveal.
    ...threaderWave(bar(0.8), [-2.4, 2.4], 4.0),
    ...coilRank(bar(2.0), [0, 3, 6, 9]),
    ...threaderWave(bar(3.05), [-5, 0, 5], 3.5),

    // Stage one: two-bar call and response.
    ...coilRank(bar(4.15), [0, 2, 4, 6, 8, 10]),
    ...threaderWave(bar(5.9), [-6, -2, 2, 6]),
    ...coilRank(bar(7.9), [1, 3, 5, 7, 9, 11]),
    capacitor(bar(8.8), 1.5, -0.5, 0.3),
    ...threaderWave(bar(9.9), [5, 1, -3, -6]),
    ...coilRank(bar(11.1), [0, 2, 4, 6, 8, 10]),

    // Stage two: crowded ranks, return fire, paired banks.
    ...coilRank(bar(12.15), [0, 2, 4, 6, 8, 10], [1, 4]),
    ...threaderWave(bar(13.0), [-7, -3.5, 0, 3.5, 7], 2.8),
    capacitor(bar(14.15), -4.5, 2.8, 1.1),
    capacitor(bar(14.45), 4.5, -2.8, 2.8),
    ...coilRank(bar(15.8), [1, 3, 5, 7, 9, 11], [0, 2, 5]),
    ...threaderWave(bar(16.7), [6, 2, -2, -6], 2.55),
    ...coilRank(bar(17.9), [0, 2, 4, 6, 8, 10], [1, 3, 4]),
    capacitor(bar(18.05), 0, 0, 4.2),
    // bar 19 is deliberately empty: warning and breath before the jam.
  ];

  // Two ranks of three. They remain at the frame rim until killed or the shot.
  [0, 4, 8, 2, 6, 10].forEach((clock, index) => {
    entries.push({
      time: INTERLOCK_TIME + (index >= 3 ? MASS_DRIVER_TIME.beatSeconds * 0.55 : 0) + (index % 3) * 0.08,
      kind: 'interlock',
      hitStages: [1, 2],
      data: { role: 'interlock', clock, rank: index >= 3 ? 1 : 0, firing: index === 1 || index === 4 },
    });
  });

  entries.push(
    ...threaderWave(bar(21.1), [-4.5, 4.5], 2.7),
    ...threaderWave(bar(23.1), [5.5, -5.5], 2.45),
    ...threaderWave(bar(25.0), [-6, -2, 2, 6], 2.15),
    ...threaderWave(bar(26.4), [4, -4], 1.85),
  );
  return entries.sort((a, b) => a.time - b.time);
}

export const MASS_DRIVER_SPAWN_TIMELINE = buildTimeline();
export const MASS_DRIVER_DETAILED_UK78_SPAWN_TIMELINE = MASS_DRIVER_SPAWN_TIMELINE;

const KILL_SCORE: Record<MassDriverEnemyKind, number> = {
  coil: 110,
  threader: 150,
  capacitor: 650,
  arc: 90,
  interlock: 1250,
};

function cameraLocal(context: MassDriverUpdate, x: number, y: number, z: number, out = new Vector3()) {
  return out.set(x, y, z).applyQuaternion(context.camera.quaternion).add(context.camera.position);
}

function faceCamera(context: MassDriverUpdate) {
  context.enemy.mesh.quaternion.copy(context.camera.quaternion);
}

export function createMassDriverGameplay(bus: EventBus) {
  const metrics: MassDriverMetrics = {
    fired: false,
    detonated: false,
    interlocksCleared: 0,
    arcsIntercepted: 0,
    hitsTaken: 0,
  };
  const interlocks = new Set<number>();
  const arcs = new Set<number>();
  const firedAtArcs = new Set<number>();

  bus.on('runstart', () => {
    metrics.fired = false;
    metrics.detonated = false;
    metrics.interlocksCleared = 0;
    metrics.arcsIntercepted = 0;
    metrics.hitsTaken = 0;
    interlocks.clear();
    arcs.clear();
    firedAtArcs.clear();
  });
  bus.on('spawn', ({ enemyId, kind }) => {
    if (kind === 'interlock') interlocks.add(enemyId);
    if (kind === 'arc') arcs.add(enemyId);
  });
  bus.on('fire', ({ enemyId }) => {
    if (arcs.has(enemyId)) firedAtArcs.add(enemyId);
  });
  bus.on('kill', ({ enemyId }) => {
    if (interlocks.delete(enemyId)) metrics.interlocksCleared += 1;
    if (arcs.delete(enemyId) && firedAtArcs.delete(enemyId)) metrics.arcsIntercepted += 1;
  });
  bus.on('miss', ({ enemyId }) => {
    arcs.delete(enemyId);
    firedAtArcs.delete(enemyId);
  });
  bus.on('playerhit', () => {
    metrics.hitsTaken += 1;
  });
  bus.on('beat', ({ beatNumber }) => {
    if (beatNumber >= 28 * 4 && metrics.interlocksCleared === 6 && !metrics.detonated) metrics.fired = true;
  });

  function spawnArc(context: MassDriverUpdate, x: number, y: number, source: ArcData['source']) {
    context.spawnEnemy({
      time: context.runTime,
      kind: 'arc',
      countsTowardTotal: false,
      data: { role: 'arc', x, y, travel: source === 'interlock' ? 2.55 : 2.8, source },
    });
  }

  function updateCoil(context: MassDriverUpdate, data: CoilData) {
    const t = MathUtils.clamp((context.age - data.delay) / 0.45, 0, 1);
    const pop = 1 + Math.sin(t * Math.PI) * 0.18;
    const angle = data.clock / 12 * Math.PI * 2 + context.age * 0.16;
    const radius = 9.3;
    const state = context.enemyState(() => ({ fired: false }));
    const recoil = data.firing && !state.fired && context.age > 2.0 ? MathUtils.smoothstep(context.age, 1.8, 2.25) : 0;
    cameraLocal(context, Math.sin(angle) * radius * pop, Math.cos(angle) * radius * pop, -35 + recoil * 3, context.enemy.mesh.position);
    faceCamera(context);
    context.enemy.mesh.rotateZ(-angle + context.age * 0.22);
    if (data.firing && !state.fired && context.age >= 2.25) {
      state.fired = true;
      spawnArc(context, Math.sin(angle) * radius * 0.82, Math.cos(angle) * radius * 0.82, 'coil');
    }
    return context.age > data.lead;
  }

  function updateThreader(context: MassDriverUpdate, data: ThreaderData) {
    const t = (context.age - data.delay) / data.crossTime;
    if (t > 1.12) return true;
    const k = MathUtils.clamp(t, 0, 1);
    const eased = k * k * (3 - 2 * k);
    const x = MathUtils.lerp(-15 * data.sign, 15 * data.sign, eased);
    const helix = k * Math.PI * 5 * data.sign;
    const y = data.y + Math.sin(k * Math.PI) * 2.2 + Math.sin(helix) * 1.25;
    const z = -33 + Math.cos(helix) * 2.2;
    cameraLocal(context, x, y, z, context.enemy.mesh.position);
    faceCamera(context);
    context.enemy.mesh.rotateZ(-data.sign * 0.35 + Math.sin(helix) * 0.2);
    return false;
  }

  function updateCapacitor(context: MassDriverUpdate, data: CapacitorData) {
    const bobX = data.x + Math.sin(context.age * 0.72 + data.phase) * 2.0;
    const bobY = data.y + Math.sin(context.age * 1.03 + data.phase * 1.7) * 1.4;
    const closing = Math.min(5, context.age * 0.7);
    cameraLocal(context, bobX, bobY, -37 + closing, context.enemy.mesh.position);
    faceCamera(context);
    context.enemy.mesh.rotateZ(Math.sin(context.age * 0.42 + data.phase) * 0.48);
    if (context.enemy.hitStageIndex > 0) {
      context.enemy.mesh.position.x += Math.sin(context.age * 33) * 0.06;
      context.enemy.mesh.position.y += Math.cos(context.age * 29) * 0.06;
    }
    return context.age > data.lead;
  }

  function updateArc(context: MassDriverUpdate, data: ArcData) {
    const t = MathUtils.clamp(context.age / data.travel, 0, 1);
    const home = t * t * (3 - 2 * t);
    const orbit = Math.sin(context.age * 13 + context.enemy.id) * (1 - t) * 0.7;
    cameraLocal(context, data.x * (1 - home) + orbit, data.y * (1 - home) - orbit * 0.5, MathUtils.lerp(-31, -0.6, home), context.enemy.mesh.position);
    faceCamera(context);
    context.enemy.mesh.rotation.z += 0.21 + Math.sin(context.age * 47) * 0.17;
    const shellA = context.enemy.mesh.getObjectByName('arc-shell-a');
    const shellB = context.enemy.mesh.getObjectByName('arc-shell-b');
    if (shellA) shellA.scale.setScalar(0.86 + Math.sin(context.age * 79) * 0.16);
    if (shellB) shellB.rotation.set(context.age * 19, context.age * -23, context.age * 17);
    if (context.age >= data.travel) {
      context.damagePlayer(1);
      return true;
    }
    return false;
  }

  function updateInterlock(context: MassDriverUpdate, data: InterlockData) {
    const angle = data.clock / 12 * Math.PI * 2;
    const arrival = MathUtils.clamp(context.age / 0.5, 0, 1);
    const overshoot = 1 + Math.sin(arrival * Math.PI) * 0.2;
    const radius = MathUtils.lerp(14.5, data.rank === 0 ? 8.7 : 9.6, arrival) * overshoot;
    const tighten = MathUtils.smoothstep(context.runTime, bar(24), SHOT_TIME) * 0.7;
    const x = Math.sin(angle) * (radius - tighten);
    const y = Math.cos(angle) * (radius - tighten);
    cameraLocal(context, x, y, -34, context.enemy.mesh.position);
    faceCamera(context);
    context.enemy.mesh.rotateZ(-angle + Math.sin(context.age * 2.2) * 0.035);
    const state = context.enemyState(() => ({ fired: false, deadline: false }));
    if (data.firing && !state.fired && context.age > 3.25 + data.rank * 1.4) {
      state.fired = true;
      spawnArc(context, x * 0.78, y * 0.78, 'interlock');
    }
    if (!state.deadline && context.runTime >= SHOT_TIME) {
      state.deadline = true;
      metrics.detonated = true;
      context.damagePlayer(MASS_DRIVER_PLAYER_HEALTH);
      // Normal play ends immediately. Immortal inspection mode deliberately
      // survives damage, so explicitly clear the failed clamp there as well:
      // nothing from the barrel is allowed to ride into the muzzle field.
      return true;
    }
    return false;
  }

  const level: MassDriverGameplay = {
    metrics,
    duration: MASS_DRIVER_DURATION,
    bpm: MASS_DRIVER_BPM,
    createRail: createMassDriverRail,
    spawnTimeline: MASS_DRIVER_SPAWN_TIMELINE,
    easeRunProgress: massDriverRunProgress,
    playerHealth: MASS_DRIVER_PLAYER_HEALTH,
    startWord: 'CHARGE',
    replayWord: 'RELOAD',
    lockRadiusNdc: 0.145,
    timing: {
      shotDelay: { maxGridSeconds: 0.16, gridRampGapGrowthThirtyseconds: 1 },
      actionSfx: { enabled: true, gridThirtyseconds: 1 },
    },
    updateEnemy(context) {
      const data = context.enemy.entry.data;
      if (data.role === 'coil') return updateCoil(context, data);
      if (data.role === 'threader') return updateThreader(context, data);
      if (data.role === 'capacitor') return updateCapacitor(context, data);
      if (data.role === 'arc') return updateArc(context, data);
      return updateInterlock(context, data);
    },
    scoreForHit(volleySize, enemy) {
      return enemy.kind === 'capacitor' || enemy.kind === 'interlock' ? 35 + volleySize * 8 : 10;
    },
    scoreForKill(volleySize, enemy) {
      return KILL_SCORE[enemy.kind] + Math.max(0, volleySize - 1) * 28;
    },
    scoreForVolley(results) {
      const kills = results.filter((result) => result.killed).length;
      const clean = kills === results.length;
      return results.length >= 6 && clean ? 850 : clean ? results.length * results.length * 14 : 0;
    },
    rankForRun(score, kills, totalEnemies) {
      const clear = totalEnemies > 0 ? kills / totalEnemies : 0;
      // A non-death summary is produced at the 60-second rail end, so reaching
      // rank evaluation with all clamps clear proves the bar-28 shot occurred.
      // Keeping this derivation inside gameplay also makes headless simulation
      // authoritative; the visual runtime mirrors it at the actual shot frame.
      if (!metrics.detonated && metrics.interlocksCleared === 6) metrics.fired = true;
      if (metrics.fired && score >= 13200 && clear >= 0.92) return 'S';
      if (metrics.fired && score >= 9800 && clear >= 0.72) return 'A';
      if (!metrics.detonated && score >= 6500 && clear >= 0.5) return 'B';
      return 'C';
    },
    detailsForRun() {
      const hull = metrics.detonated ? 0 : Math.max(0, MASS_DRIVER_PLAYER_HEALTH - metrics.hitsTaken);
      return [
        `HULL ${hull}/${MASS_DRIVER_PLAYER_HEALTH}`,
        `INTERLOCKS ${metrics.interlocksCleared}/6`,
        `ARCS INTERCEPTED ${metrics.arcsIntercepted}`,
        metrics.fired && !metrics.detonated ? 'PAYLOAD AWAY — muzzle exit clean' : 'CHARGE CONTAINMENT FAILED',
      ];
    },
    updateAttractCamera({ camera, modeTime }) {
      camera.rotation.z += Math.sin(modeTime * 0.45) * 0.00035;
    },
  };

  return level;
}
