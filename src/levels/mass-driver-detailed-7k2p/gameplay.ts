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
  MASS_DRIVER_BPM,
  MASS_DRIVER_DURATION,
  MASS_DRIVER_MARKERS,
  MASS_DRIVER_TIME,
} from './timing';

export { MASS_DRIVER_BPM as MASS_DRIVER_DETAILED_7K2P_BPM } from './timing';
export { MASS_DRIVER_DURATION as MASS_DRIVER_DETAILED_7K2P_RUN_DURATION } from './timing';

export type MassDriverEnemyKind = 'coil' | 'threader' | 'capacitor' | 'arc' | 'interlock';

export type MassDriverSpawnData =
  | { role: 'coil'; lead: number; socket: number; direction: number; fireAt?: number }
  | { role: 'threader'; lead: number; fromX: number; toX: number; y: number; arc: number; helix: number; delay: number }
  | { role: 'capacitor'; lead: number; x: number; y: number; phase: number }
  | { role: 'arc'; position: Vector3; velocity: Vector3; lastAge: number; impact: HostileShotImpactState }
  | { role: 'interlock'; socket: number; rank: number; fireAt?: number };

export type MassDriverSpawn = LockOnSpawnEntry<MassDriverEnemyKind, MassDriverSpawnData>;
type MassDriverUpdate = LockOnEnemyUpdate<MassDriverEnemyKind, MassDriverSpawnData>;

// The barrel accelerates continuously until the firing downbeat, then the
// payload gets a physical threefold kick. Open space only relaxes slightly.
const SPEED = createSpeedProfile([
  [0, 0.34],
  [MASS_DRIVER_TIME.bar(4), 0.55],
  [MASS_DRIVER_TIME.bar(12), 0.92],
  [MASS_DRIVER_TIME.bar(20), 1.38],
  [MASS_DRIVER_TIME.bar(26), 1.92],
  [MASS_DRIVER_MARKERS.shot - 0.02, 2.12],
  [MASS_DRIVER_MARKERS.shot, 6.35],
  [MASS_DRIVER_DURATION, 5.72],
], MASS_DRIVER_DURATION);

export const massDriverRunProgress = SPEED.runProgress;
export const massDriverSpeedAt = SPEED.speedAt;
export const MASS_DRIVER_MUZZLE_U = massDriverRunProgress(MASS_DRIVER_MARKERS.shot, MASS_DRIVER_DURATION);

export function createMassDriverRail() {
  // A deterministic, mostly axial bore. Its lateral correction fades to zero
  // at the muzzle; the final points rise gently after launch.
  return new CatmullRomCurve3([
    new Vector3(0, 0, 0),
    new Vector3(1.2, 0.5, -160),
    new Vector3(-2.8, 1.3, -350),
    new Vector3(3.6, -1.5, -570),
    new Vector3(-4.0, 1.8, -810),
    new Vector3(3.1, -1.2, -1080),
    new Vector3(-1.7, 0.7, -1370),
    new Vector3(0, 0, -1660),
    new Vector3(0, 0, -1940),
    new Vector3(0, 10, -2240),
    new Vector3(0, 28, -2580),
  ], false, 'catmullrom', 0.34);
}

const stagger = MASS_DRIVER_TIME.stepSeconds * 0.78;

function coilRank(bar: number, beat: number, sockets: number[], options: { firing?: number[]; lead?: number; direction?: number } = {}): MassDriverSpawn[] {
  const time = MASS_DRIVER_TIME.bar(bar, beat);
  return sockets.map((socket, index) => ({
    time: time + index * stagger,
    kind: 'coil',
    data: {
      role: 'coil',
      lead: options.lead ?? 4.0,
      socket,
      direction: (options.direction ?? 1) * (index % 2 ? -1 : 1),
      ...(options.firing?.includes(index) ? { fireAt: time + 1.35 + index * 0.16 } : {}),
    },
  }));
}

function threaderWave(bar: number, beat: number, count: number, high = false, lead = 3.65): MassDriverSpawn[] {
  const time = MASS_DRIVER_TIME.bar(bar, beat);
  return Array.from({ length: count }, (_, index) => {
    const sign = index % 2 === 0 ? 1 : -1;
    return {
      time: time + index * stagger,
      kind: 'threader' as const,
      data: {
        role: 'threader' as const,
        lead,
        fromX: sign * -17,
        toX: sign * 17,
        y: (high ? 3.8 : -1.5) + (index - (count - 1) / 2) * 1.45,
        arc: sign * (2.5 + (index % 3) * 0.7),
        helix: sign,
        delay: index * 0.16,
      },
    };
  });
}

function capacitorBank(bar: number, beat: number, points: Array<[number, number]>, lead = 4.65): MassDriverSpawn[] {
  const time = MASS_DRIVER_TIME.bar(bar, beat);
  return points.map(([x, y], index) => ({
    time: time + index * stagger * 1.4,
    kind: 'capacitor',
    hitStages: [2, 2],
    data: { role: 'capacitor', lead, x, y, phase: bar + index * 2.17 },
  }));
}

function buildTimeline(): MassDriverSpawn[] {
  const interlocks: MassDriverSpawn[] = Array.from({ length: 6 }, (_, socket) => ({
    time: MASS_DRIVER_TIME.bar(20, socket < 3 ? socket * 0.18 : 1 + (socket - 3) * 0.18),
    kind: 'interlock',
    hitStages: [1, 2],
    data: {
      role: 'interlock',
      socket,
      rank: socket < 3 ? 0 : 1,
      ...(socket === 1
        ? { fireAt: MASS_DRIVER_TIME.bar(22, 2) }
        : socket === 4
          ? { fireAt: MASS_DRIVER_TIME.bar(24, 2) }
          : {}),
    },
  }));

  return [
    // Injection: the first pair is a literal counter-rotating double helix.
    ...threaderWave(1, 0, 2, false, 4.15),
    ...coilRank(2, 2, [0, 2, 3, 5], { lead: 4.35, direction: 1 }),
    ...threaderWave(3, 2, 3, true, 3.9),

    // Stage 1: two-bar call and response, with the first bank as punctuation.
    ...coilRank(4, 1, [0, 1, 3, 4], { direction: -1 }),
    ...threaderWave(6, 0, 4),
    ...coilRank(8, 0, [0, 1, 2, 3, 4, 5], { direction: 1 }),
    ...capacitorBank(9, 2, [[0, 2.4]], 5.0),
    ...threaderWave(10, 0, 5, true),

    // Stage 2: denser ranks return fire, then paired banks and a full-bar breath.
    ...coilRank(12, 0, [0, 1, 2, 3, 4, 5], { firing: [1, 4], direction: -1 }),
    ...threaderWave(13, 2, 5, false, 3.45),
    ...capacitorBank(14, 2, [[-4.8, 2.8], [4.8, -2.4]], 4.45),
    ...coilRank(16, 0, [0, 1, 2, 3, 4, 5], { firing: [0, 3, 5], direction: 1, lead: 3.65 }),
    ...threaderWave(17, 2, 6, true, 3.35),
    ...capacitorBank(18, 0, [[-5.5, -1.8], [5.5, 2.4]], 4.25),

    // Bar 19 is deliberately empty under the warning klaxon.
    ...interlocks,
    ...threaderWave(22, 0, 2, false, 3.1),
    ...threaderWave(24, 0, 2, true, 2.9),
    ...threaderWave(26, 0, 2, false, 2.65),
    // Bars 28–32: no hostiles. Space is the reward.
  ].sort((a, b) => a.time - b.time);
}

export const MASS_DRIVER_SPAWN_TIMELINE = buildTimeline();

const KILL_SCORE: Record<MassDriverEnemyKind, number> = {
  coil: 140,
  threader: 175,
  capacitor: 420,
  arc: 90,
  interlock: 850,
};

function spawnArc(context: MassDriverUpdate, origin: Vector3) {
  const velocity = hostileShotAimPoint(context.camera, origin, 2.2).sub(origin).normalize().multiplyScalar(5.4);
  context.spawnEnemy({
    time: context.runTime,
    kind: 'arc',
    countsTowardTotal: false,
    data: { role: 'arc', position: origin.clone(), velocity, lastAge: 0, impact: {} },
  });
}

function updateArc(context: MassDriverUpdate, data: Extract<MassDriverSpawnData, { role: 'arc' }>) {
  const dt = Math.max(0, context.age - data.lastAge);
  data.lastAge = context.age;
  const impact = updateHostileShotImpact({
    age: context.age,
    camera: context.camera,
    position: data.position,
    velocity: data.velocity,
    state: data.impact,
    config: { hitDistance: 2.75, impactBrake: 0.46, damageDistance: 0.62 },
  });
  context.enemy.mesh.position.copy(data.position);
  // The unstable tell is rebuilt every frame through independent shell axes.
  context.enemy.mesh.rotation.set(context.age * 13.1, context.age * 17.3, context.age * 11.7);
  context.enemy.mesh.scale.set(
    0.9 + Math.sin(context.age * 41) * 0.14,
    1 + Math.sin(context.age * 53 + 1) * 0.18,
    0.92 + Math.sin(context.age * 47 + 2) * 0.15,
  );
  if (impact.phase === 'braking') {
    context.enemy.mesh.quaternion.copy(context.camera.quaternion);
    if (impact.damaged) {
      context.damagePlayer(1);
      return true;
    }
    return false;
  }
  steerHomingShot(data.position, data.velocity, hostileShotAimPoint(context.camera, data.position, 2.55), context.age, dt, {
    baseSpeed: 5.4,
    maxSpeed: 16,
    accel: 4.1,
    turnRate: 2.8,
  });
  return context.age > 11 || shotBehindCamera(context.camera, data.position);
}

function updateHostile(context: MassDriverUpdate, deadlineFailed: boolean) {
  const { enemy, age, runTime, runProgress, curve, camera, railAnchor } = context;
  const data = enemy.entry.data;
  if (data.role === 'arc') return updateArc(context, data);

  if (data.role === 'interlock') {
    const frame = sampleRailFrame(curve, MathUtils.clamp(runProgress + 0.014, 0, MASS_DRIVER_MUZZLE_U - 0.002));
    const angle = data.socket / 6 * Math.PI * 2 + Math.sin(runTime * 0.9 + data.socket) * 0.045;
    const radius = 8.35 + Math.sin(age * 1.7 + data.socket) * 0.25;
    enemy.mesh.position.copy(frame.position)
      .addScaledVector(frame.right, Math.cos(angle) * radius)
      .addScaledVector(frame.up, Math.sin(angle) * radius)
      .addScaledVector(frame.tangent, 2.2 + data.rank * 0.55);
    enemy.mesh.lookAt(camera.position);
    enemy.mesh.rotateZ(angle + Math.PI / 4);
    enemy.mesh.userData.charge = MathUtils.clamp((runTime - MASS_DRIVER_MARKERS.interlock) / (MASS_DRIVER_MARKERS.shot - MASS_DRIVER_MARKERS.interlock), 0, 1);
    enemy.mesh.userData.failed = deadlineFailed;
    const state = context.enemyState(() => ({ fired: false }));
    if (!state.fired && data.fireAt !== undefined && runTime >= data.fireAt) {
      state.fired = true;
      spawnArc(context, enemy.mesh.position);
      enemy.mesh.userData.justFiredUntil = runTime + 0.4;
    }
    return false;
  }

  const anchorU = railAnchor(data.lead);
  const offset = new Vector3();
  if (data.role === 'coil') {
    const baseAngle = data.socket / 6 * Math.PI * 2;
    const angle = baseAngle + data.direction * age * 0.22;
    const fireState = context.enemyState(() => ({ fired: false }));
    const telegraph = data.fireAt === undefined || fireState.fired ? 0 : MathUtils.clamp((runTime - data.fireAt + 0.62) / 0.62, 0, 1);
    const rearBack = Math.sin(telegraph * Math.PI) * 1.25;
    const inward = telegraph > 0.72 ? MathUtils.smoothstep(telegraph, 0.72, 1) * 2.6 : 0;
    const radius = 9.35 + rearBack - inward;
    offset.set(Math.cos(angle) * radius, Math.sin(angle) * radius, Math.sin(age * 0.75 + data.socket) * 0.7);
    enemy.mesh.lookAt(camera.position);
    enemy.mesh.rotateZ(angle + Math.PI / 2);
    enemy.mesh.userData.telegraph = telegraph;
    if (!fireState.fired && data.fireAt !== undefined && runTime >= data.fireAt) {
      fireState.fired = true;
      spawnArc(context, offsetFromRail(curve, anchorU, offset));
      enemy.mesh.userData.justFiredUntil = runTime + 0.32;
    }
  } else if (data.role === 'threader') {
    const p = MathUtils.smootherstep(MathUtils.clamp((age - data.delay) / 3.0, 0, 1), 0, 1);
    const helixAngle = p * Math.PI * 5 * data.helix;
    offset.set(
      MathUtils.lerp(data.fromX, data.toX, p) + Math.cos(helixAngle) * 1.15,
      data.y + Math.sin(p * Math.PI) * data.arc + Math.sin(helixAngle) * 1.15,
      Math.cos(helixAngle + Math.PI / 2) * 1.4,
    );
    enemy.mesh.rotation.z = Math.atan2(data.toX - data.fromX, data.arc * Math.PI) * -0.5;
    enemy.mesh.rotation.y = helixAngle;
    enemy.mesh.userData.ionTail = 1 - p * 0.35;
  } else {
    offset.set(
      data.x + Math.sin(age * 0.72 + data.phase) * 1.15,
      data.y + Math.sin(age * 0.47 + data.phase * 1.7) * 1.65,
      Math.cos(age * 0.61 + data.phase) * 1.1,
    );
    enemy.mesh.lookAt(camera.position);
    enemy.mesh.rotateZ(Math.sin(age * 0.38 + data.phase) * 0.45);
    enemy.mesh.userData.exposed = enemy.hitStageIndex > 0;
  }
  enemy.mesh.position.copy(offsetFromRail(curve, anchorU, offset));
  enemy.mesh.userData.heat = runProgress;
  return age > data.lead + 0.75;
}

export type MassDriverRunState = {
  destroyedInterlocks: number;
  interceptedArcs: number;
  hullRemaining: number;
  gunFired: boolean;
  detonated: boolean;
};

export function createMassDriverGameplay(bus: EventBus, onState?: (state: Readonly<MassDriverRunState>) => void): LockOnRunnerLevel<MassDriverEnemyKind, MassDriverSpawnData> {
  const interlockIds = new Set<number>();
  const arcIds = new Set<number>();
  const state: MassDriverRunState = { destroyedInterlocks: 0, interceptedArcs: 0, hullRemaining: 3, gunFired: false, detonated: false };
  let deadlineResolved = false;
  let unresolvedMisses = 0;
  const publish = () => onState?.(state);

  bus.on('runstart', () => {
    interlockIds.clear();
    arcIds.clear();
    state.destroyedInterlocks = 0;
    state.interceptedArcs = 0;
    state.hullRemaining = 3;
    state.gunFired = false;
    state.detonated = false;
    deadlineResolved = false;
    unresolvedMisses = 0;
    publish();
  });
  bus.on('spawn', ({ enemyId, kind }) => {
    if (kind === 'interlock') interlockIds.add(enemyId);
    if (kind === 'arc') arcIds.add(enemyId);
  });
  bus.on('kill', ({ enemyId }) => {
    if (interlockIds.delete(enemyId)) {
      state.destroyedInterlocks += 1;
      // This arms the shot. The visual/audio/runtime payoff remains pinned to
      // bar 28; keeping the state here also works when the sixth clamp was the
      // final live enemy and there is nothing left for updateEnemy to tick.
      if (state.destroyedInterlocks === 6) state.gunFired = true;
    }
    if (arcIds.delete(enemyId)) state.interceptedArcs += 1;
    publish();
  });
  bus.on('miss', ({ enemyId }) => {
    arcIds.delete(enemyId);
    unresolvedMisses += 1;
  });
  bus.on('playerhit', ({ healthRemaining }) => {
    state.hullRemaining = healthRemaining;
    publish();
  });

  return {
    duration: MASS_DRIVER_DURATION,
    bpm: MASS_DRIVER_BPM,
    createRail: createMassDriverRail,
    spawnTimeline: MASS_DRIVER_SPAWN_TIMELINE,
    easeRunProgress: massDriverRunProgress,
    playerHealth: 3,
    startWord: 'CHARGE',
    replayWord: 'RELOAD',
    lockRadiusNdc: 0.17,
    timing: {
      shotDelay: { maxGridSeconds: 0.18, gapThirtyseconds: 1, gridRampGapGrowthThirtyseconds: 1 },
      actionSfx: { enabled: true, gridThirtyseconds: 1 },
    },
    updateEnemy(context) {
      if (!deadlineResolved && context.runTime >= MASS_DRIVER_MARKERS.shot) {
        deadlineResolved = true;
        state.gunFired = state.destroyedInterlocks === 6;
        state.detonated = !state.gunFired;
        if (state.detonated) context.damagePlayer(99);
        publish();
      }
      return updateHostile(context, state.detonated);
    },
    updateAttractCamera({ camera, modeTime }) {
      camera.rotation.z = Math.sin(modeTime * 0.24) * 0.008;
    },
    scoreForHit(volleySize, enemy) {
      const armorChip = enemy.kind === 'capacitor' || enemy.kind === 'interlock' ? 55 : 25;
      return armorChip + Math.max(0, volleySize - 1) * 9;
    },
    scoreForKill(volleySize, enemy) {
      return Math.round(KILL_SCORE[enemy.kind] * (1 + Math.max(0, volleySize - 1) * 0.14));
    },
    scoreForVolley(results) {
      if (results.length !== 6 || !results.every((result) => result.killed)) return 0;
      return 2400;
    },
    rankForRun(score, kills, totalEnemies) {
      const clear = totalEnemies > 0 ? kills / totalEnemies : 0;
      if (state.gunFired && clear >= 0.995 && score >= 15500 && unresolvedMisses === 0) return 'S';
      if (state.gunFired && clear >= 0.76) return 'A';
      if (clear >= 0.58) return 'B';
      return 'C';
    },
    detailsForRun() {
      return [
        `HULL ${state.detonated ? 0 : state.hullRemaining}/3`,
        `INTERLOCKS ${state.destroyedInterlocks}/6`,
        `INTERCEPTED ARCS ${state.interceptedArcs}`,
        state.gunFired ? 'PAYLOAD AWAY — muzzle exit clean' : 'CHARGE CONTAINMENT FAILED',
      ];
    },
  };
}
