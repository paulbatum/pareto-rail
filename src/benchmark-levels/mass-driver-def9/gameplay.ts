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
import { createRailPacer, type RailLead } from '../../engine/rail-pacer';
import { createSpeedProfile } from '../../engine/speed-profile';
import type { EventBus } from '../../events';
import {
  MASS_DRIVER_DEF9_BARS,
  MASS_DRIVER_DEF9_BPM,
  MASS_DRIVER_DEF9_RUN_DURATION,
  MASS_DRIVER_DEF9_TIME,
} from './timing';

export {
  MASS_DRIVER_DEF9_BPM,
  MASS_DRIVER_DEF9_RUN_DURATION,
  MASS_DRIVER_DEF9_TIME,
} from './timing';

export const MASS_DRIVER_DEF9_PLAYER_HEALTH = 4;
export const MASS_DRIVER_DEF9_INTERLOCK_COUNT = 6;
export const MASS_DRIVER_DEF9_INTERLOCK_BANKS = 4;
export const MASS_DRIVER_DEF9_INTERLOCK_TARGETS = MASS_DRIVER_DEF9_INTERLOCK_COUNT * MASS_DRIVER_DEF9_INTERLOCK_BANKS;

export type MassDriverDef9EnemyKind = 'skimmer' | 'weaver' | 'sentinel' | 'arcbolt' | 'interlock' | 'charge';

type PacedData = {
  pacing: RailLead;
  phase: number;
};

export type MassDriverDef9SpawnData =
  | (PacedData & { role: 'skimmer'; offset: Vector3; bank: number })
  | (PacedData & { role: 'weaver'; direction: number; height: number; radius: number })
  | (PacedData & { role: 'sentinel'; angle: number; radius: number; fireAt: number })
  | { role: 'arcbolt'; position: Vector3; velocity: Vector3; lastAge: number; impact: HostileShotImpactState }
  | (PacedData & { role: 'interlock'; socket: number; bankStage: number })
  | { role: 'charge' };

export type MassDriverDef9SpawnEntry = LockOnSpawnEntry<MassDriverDef9EnemyKind, MassDriverDef9SpawnData>;
export type MassDriverDef9Update = LockOnEnemyUpdate<MassDriverDef9EnemyKind, MassDriverDef9SpawnData>;

const SPEED_KEYS: ReadonlyArray<readonly [number, number]> = [
  [MASS_DRIVER_DEF9_TIME.bar(0), 0.38],
  [MASS_DRIVER_DEF9_TIME.bar(4), 0.52],
  [MASS_DRIVER_DEF9_TIME.bar(8), 0.70],
  [MASS_DRIVER_DEF9_TIME.bar(12), 0.94],
  [MASS_DRIVER_DEF9_TIME.bar(16), 1.20],
  [MASS_DRIVER_DEF9_TIME.bar(20), 1.52],
  [MASS_DRIVER_DEF9_TIME.bar(24), 1.82],
  [MASS_DRIVER_DEF9_TIME.bar(28), 2.18],
  [MASS_DRIVER_DEF9_TIME.bar(31), 2.76],
  [MASS_DRIVER_DEF9_RUN_DURATION, 3.20],
];

const speedProfile = createSpeedProfile(SPEED_KEYS, MASS_DRIVER_DEF9_RUN_DURATION, { samples: 1800 });

export const speedFactorAt = speedProfile.speedAt;

export function massDriverDef9RunProgress(time: number, duration = MASS_DRIVER_DEF9_RUN_DURATION) {
  return speedProfile.runProgress(time, duration);
}

export function createMassDriverDef9Rail() {
  const length = 2600;
  return new CatmullRomCurve3(
    [
      new Vector3(0, 0, 0),
      new Vector3(2, 1, -length * 0.08),
      new Vector3(-9, 4, -length * 0.18),
      new Vector3(13, -5, -length * 0.30),
      new Vector3(-16, 6, -length * 0.43),
      new Vector3(18, -8, -length * 0.57),
      new Vector3(-13, 9, -length * 0.71),
      new Vector3(9, -5, -length * 0.84),
      new Vector3(-4, 2, -length * 0.94),
      new Vector3(0, 0, -length),
    ],
    false,
    'catmullrom',
    0.28,
  );
}

export const massDriverDef9Pacer = createRailPacer({
  curve: createMassDriverDef9Rail(),
  duration: MASS_DRIVER_DEF9_RUN_DURATION,
  runProgress: massDriverDef9RunProgress,
  spawnAheadUnits: 48,
  defaultLeadSeconds: 4.4,
});

const massDriverDef9BossPacer = createRailPacer({
  curve: createMassDriverDef9Rail(),
  duration: MASS_DRIVER_DEF9_RUN_DURATION,
  runProgress: massDriverDef9RunProgress,
  spawnAheadUnits: 30,
  defaultLeadSeconds: 3.4,
});

type SkimmerWave = {
  bar: number;
  beat?: number;
  offsets: ReadonlyArray<readonly [number, number]>;
  lead?: number;
  bank?: number;
};

type WeaverWave = {
  bar: number;
  beat?: number;
  count: number;
  lead?: number;
  direction?: number;
  height?: number;
};

type SentinelWave = {
  bar: number;
  beat?: number;
  angles: readonly number[];
  lead?: number;
  radius?: number;
  fireAt?: number;
};

const SKIMMER_WAVES: readonly SkimmerWave[] = [
  { bar: 1, offsets: [[-11, -3], [-5, 3], [5, 3], [11, -3]], bank: 1 },
  { bar: 3, beat: 2, offsets: [[-15, 0], [-9, 5], [-3, -4], [3, -4], [9, 5], [15, 0]], bank: -1 },
  { bar: 6, offsets: [[-14, -5], [-8, 1], [0, 6], [8, 1], [14, -5]], bank: 1 },
  { bar: 8, offsets: [[-16, 1], [-10, -5], [-4, 5], [4, 5], [10, -5], [16, 1]], bank: -1 },
  { bar: 10, beat: 2, offsets: [[-14, 5], [-7, -4], [0, 6], [7, -4], [14, 5]], lead: 4.1, bank: 1 },
  { bar: 13, offsets: [[-16, -3], [-10, 4], [-3, -6], [3, 6], [10, -4], [16, 3]], lead: 4.1, bank: -1 },
  { bar: 16, beat: 1, offsets: [[-17, 0], [-11, 5], [-5, -5], [5, 5], [11, -5], [17, 0]], lead: 3.9, bank: 1 },
  { bar: 18, beat: 2, offsets: [[-15, 6], [-9, -2], [-3, 4], [3, -4], [9, 2], [15, -6]], lead: 3.8, bank: -1 },
  { bar: 21, offsets: [[-17, -4], [-10, 5], [-4, -6], [4, 6], [10, -5], [17, 4]], lead: 3.7, bank: 1 },
];

const WEAVER_WAVES: readonly WeaverWave[] = [
  { bar: 2, beat: 2, count: 3, direction: 1, height: 1 },
  { bar: 5, count: 4, direction: -1, height: -1 },
  { bar: 7, count: 5, direction: 1, height: 1 },
  { bar: 9, beat: 2, count: 5, lead: 4.1, direction: -1, height: 0 },
  { bar: 12, count: 6, lead: 4.0, direction: 1, height: 1 },
  { bar: 14, beat: 2, count: 6, lead: 3.9, direction: -1, height: -1 },
  { bar: 17, count: 6, lead: 3.8, direction: 1, height: 0 },
  { bar: 19, beat: 2, count: 6, lead: 3.7, direction: -1, height: 1 },
  { bar: 22, count: 6, lead: 3.6, direction: 0, height: -1 },
];

const SENTINEL_WAVES: readonly SentinelWave[] = [
  { bar: 4, beat: 2, angles: [0.35], radius: 10, fireAt: 1.8 },
  { bar: 7, beat: 2, angles: [2.5, 5.6], radius: 11, fireAt: 1.55 },
  { bar: 11, angles: [0.4, 3.5], lead: 4.4, radius: 12, fireAt: 1.4 },
  { bar: 15, angles: [1.7, 3.7, 5.8], lead: 4.1, radius: 12, fireAt: 1.25 },
  { bar: 18, angles: [0.4, 2.5, 4.6], lead: 4.0, radius: 13, fireAt: 1.1 },
  { bar: 20, beat: 2, angles: [1.4, 4.5], lead: 3.8, radius: 13, fireAt: 0.95 },
];

function musicalTime(bar: number, beat = 0) {
  return MASS_DRIVER_DEF9_TIME.bar(bar, beat);
}

function buildSkimmers(wave: SkimmerWave): MassDriverDef9SpawnEntry[] {
  const start = musicalTime(wave.bar, wave.beat);
  return wave.offsets.map(([x, y], index) => {
    const time = start + index * MASS_DRIVER_DEF9_TIME.stepSeconds;
    return {
      time,
      kind: 'skimmer',
      data: {
        role: 'skimmer',
        pacing: massDriverDef9Pacer.resolve(time, wave.lead),
        offset: new Vector3(x, y, 0),
        phase: wave.bar * 0.73 + index * 1.19,
        bank: wave.bank ?? 1,
      },
    };
  });
}

function buildWeavers(wave: WeaverWave): MassDriverDef9SpawnEntry[] {
  const start = musicalTime(wave.bar, wave.beat);
  return Array.from({ length: wave.count }, (_, index) => {
    const time = start + index * MASS_DRIVER_DEF9_TIME.stepSeconds;
    return {
      time,
      kind: 'weaver',
      data: {
        role: 'weaver',
        pacing: massDriverDef9Pacer.resolve(time, wave.lead),
        direction: (wave.direction ?? 1) * (index % 2 === 0 ? 1 : -1),
        height: (wave.height ?? 0) + (index - (wave.count - 1) / 2) * 0.55,
        radius: 14 + (index % 3) * 1.4,
        phase: wave.bar * 0.41 + index * 0.82,
      },
    };
  });
}

function buildSentinels(wave: SentinelWave): MassDriverDef9SpawnEntry[] {
  const start = musicalTime(wave.bar, wave.beat);
  return wave.angles.map((angle, index) => {
    const time = start + index * MASS_DRIVER_DEF9_TIME.stepSeconds * 2;
    return {
      time,
      kind: 'sentinel',
      ...(wave.bar === 7 && index === 0
        ? { hitStages: [1, 1] }
        : { hitPoints: wave.bar >= MASS_DRIVER_DEF9_BARS.redline ? 2 : 1 }),
      data: {
        role: 'sentinel',
        pacing: massDriverDef9Pacer.resolve(time, wave.lead),
        angle,
        radius: wave.radius ?? 11,
        fireAt: (wave.fireAt ?? 1.5) + index * 0.13,
        phase: wave.bar * 0.57 + index * 1.71,
      },
    };
  });
}

function buildInterlocks(): MassDriverDef9SpawnEntry[] {
  const bankBars = [23, 25.4, 27.8, 30.05] as const;
  return bankBars.flatMap((bankBar, bankStage) =>
    Array.from({ length: MASS_DRIVER_DEF9_INTERLOCK_COUNT }, (_, socket) => {
      const time = MASS_DRIVER_DEF9_TIME.bar(bankBar) + socket * MASS_DRIVER_DEF9_TIME.stepSeconds;
      const nextBankTime = bankStage < bankBars.length - 1
        ? MASS_DRIVER_DEF9_TIME.bar(bankBars[bankStage + 1])
        : MASS_DRIVER_DEF9_RUN_DURATION - 0.22;
      const lead = Math.max(2.7, nextBankTime - time - 0.34);
      return {
        time,
        kind: 'interlock' as const,
        hitPoints: 1,
        countsTowardTotal: bankStage === bankBars.length - 1,
        data: {
          role: 'interlock' as const,
          pacing: massDriverDef9BossPacer.resolve(time, lead),
          socket,
          bankStage,
          phase: socket * Math.PI / 3 + bankStage * 0.37,
        },
      };
    }),
  );
}

export const MASS_DRIVER_DEF9_SPAWN_TIMELINE: MassDriverDef9SpawnEntry[] = [
  ...SKIMMER_WAVES.flatMap(buildSkimmers),
  ...WEAVER_WAVES.flatMap(buildWeavers),
  ...SENTINEL_WAVES.flatMap(buildSentinels),
  ...buildInterlocks(),
  {
    time: MASS_DRIVER_DEF9_TIME.bar(MASS_DRIVER_DEF9_BARS.interlocks),
    kind: 'charge' as const,
    lockable: false,
    countsTowardTotal: false,
    data: { role: 'charge' as const },
  },
].sort((a, b) => a.time - b.time);

const tempOffset = new Vector3();
const tempPosition = new Vector3();

export function createMassDriverDef9Gameplay(bus: EventBus): LockOnRunnerLevel<MassDriverDef9EnemyKind, MassDriverDef9SpawnData> {
  const interceptedBolts = new Set<number>();
  const liveInterlocks = new Set<number>();
  let interlocksSpawned = 0;
  let interlocksDestroyed = 0;
  let interlocksCleared = false;
  let barrelFailed = false;
  let hitsTaken = 0;

  bus.on('runstart', () => {
    interceptedBolts.clear();
    liveInterlocks.clear();
    interlocksSpawned = 0;
    interlocksDestroyed = 0;
    interlocksCleared = false;
    barrelFailed = false;
    hitsTaken = 0;
  });

  bus.on('spawn', ({ enemyId, kind }) => {
    if (kind !== 'interlock') return;
    liveInterlocks.add(enemyId);
    interlocksSpawned += 1;
    if (interlocksSpawned === 1) bus.emit('bossphase', { phase: 'summoned' });
  });

  bus.on('fire', ({ enemyId }) => {
    interceptedBolts.add(enemyId);
  });

  bus.on('kill', ({ enemyId }) => {
    interceptedBolts.delete(enemyId);
    if (!liveInterlocks.delete(enemyId)) return;
    interlocksDestroyed += 1;
    if (interlocksDestroyed === 1) bus.emit('bossphase', { phase: 'exposed' });
    if (interlocksDestroyed === MASS_DRIVER_DEF9_INTERLOCK_TARGETS) {
      interlocksCleared = true;
      bus.emit('bossphase', { phase: 'destroyed' });
    }
  });

  bus.on('miss', ({ enemyId }) => {
    interceptedBolts.delete(enemyId);
    liveInterlocks.delete(enemyId);
  });

  bus.on('playerhit', ({ damage }) => {
    hitsTaken += damage;
  });

  function spawnArcbolt(context: MassDriverDef9Update, from: Vector3) {
    const velocity = hostileShotAimPoint(context.camera, from).sub(from).normalize().multiplyScalar(7.5);
    context.spawnEnemy({
      time: context.runTime,
      kind: 'arcbolt',
      countsTowardTotal: false,
      data: {
        role: 'arcbolt',
        position: from.clone(),
        velocity,
        lastAge: 0,
        impact: {},
      },
    });
  }

  function updateSkimmer(context: MassDriverDef9Update, data: Extract<MassDriverDef9SpawnData, { role: 'skimmer' }>) {
    const paced = massDriverDef9Pacer.sample(context.enemy.entry.time, context.runTime, data.pacing);
    tempOffset.copy(data.offset);
    tempOffset.x += Math.sin(context.age * 3.6 + data.phase) * 1.25;
    tempOffset.y += Math.cos(context.age * 4.4 + data.phase) * 0.8;
    tempOffset.z = Math.sin(context.age * 2.8 + data.phase) * 1.2;
    context.enemy.mesh.position.copy(offsetFromRail(context.curve, paced.anchorU, tempOffset));
    context.enemy.mesh.quaternion.copy(context.camera.quaternion);
    context.enemy.mesh.rotateZ(data.bank * (0.38 + Math.sin(context.age * 2.6 + data.phase) * 0.18));
    context.enemy.mesh.rotateY(Math.sin(context.age * 3.1 + data.phase) * 0.16);
    return context.runTime > paced.passTime + 0.75;
  }

  function updateWeaver(context: MassDriverDef9Update, data: Extract<MassDriverDef9SpawnData, { role: 'weaver' }>) {
    const paced = massDriverDef9Pacer.sample(context.enemy.entry.time, context.runTime, data.pacing);
    const travel = MathUtils.clamp(context.age / Math.max(0.1, data.pacing.windowSeconds), 0, 1);
    const sweep = MathUtils.lerp(-data.radius, data.radius, travel) * data.direction;
    const thread = Math.sin(travel * Math.PI * 3 + data.phase);
    tempOffset.set(sweep, data.height * 2.2 + thread * 6.6, Math.cos(travel * Math.PI * 2 + data.phase) * 2.2);
    context.enemy.mesh.position.copy(offsetFromRail(context.curve, paced.anchorU, tempOffset));
    context.enemy.mesh.quaternion.copy(context.camera.quaternion);
    context.enemy.mesh.rotateZ(context.age * data.direction * 3.8 + data.phase);
    context.enemy.mesh.rotateX(Math.sin(context.age * 4 + data.phase) * 0.28);
    return context.runTime > paced.passTime + 0.7;
  }

  function updateSentinel(context: MassDriverDef9Update, data: Extract<MassDriverDef9SpawnData, { role: 'sentinel' }>) {
    const paced = massDriverDef9Pacer.sample(context.enemy.entry.time, context.runTime, data.pacing);
    const angle = data.angle + context.age * (0.42 + speedFactorAt(context.runTime) * 0.08);
    tempOffset.set(Math.cos(angle) * data.radius, Math.sin(angle) * data.radius * 0.62, Math.sin(context.age * 1.7 + data.phase) * 1.8);
    context.enemy.mesh.position.copy(offsetFromRail(context.curve, paced.anchorU, tempOffset));
    context.enemy.mesh.lookAt(context.camera.position);
    context.enemy.mesh.rotateZ(-angle + Math.PI / 2);

    const state = context.enemyState(() => ({ nextFire: data.fireAt, shots: 0 }));
    const maxShots = context.enemy.entry.hitPoints === 2 ? 2 : 1;
    if (context.age >= state.nextFire && state.shots < maxShots) {
      spawnArcbolt(context, context.enemy.mesh.position);
      state.shots += 1;
      state.nextFire += 1.45;
    }
    return context.runTime > paced.passTime + 0.9;
  }

  function updateArcbolt(context: MassDriverDef9Update, data: Extract<MassDriverDef9SpawnData, { role: 'arcbolt' }>) {
    const dt = MathUtils.clamp(context.age - data.lastAge, 0, 0.1);
    data.lastAge = context.age;
    const impact = updateHostileShotImpact({
      age: context.age,
      camera: context.camera,
      position: data.position,
      velocity: data.velocity,
      state: data.impact,
      intercepted: interceptedBolts.delete(context.enemy.id),
      config: { hitDistance: 2.45, impactBrake: 0.38, damageDistance: 0.68 },
    });
    if (impact.phase === 'braking') {
      context.enemy.mesh.position.copy(data.position);
      context.enemy.mesh.quaternion.copy(context.camera.quaternion);
      context.enemy.mesh.rotateZ(context.age * 9);
      if (impact.damaged) {
        context.damagePlayer(1);
        return true;
      }
      return false;
    }

    steerHomingShot(
      data.position,
      data.velocity,
      hostileShotAimPoint(context.camera, data.position, 2.45),
      context.age,
      dt,
      { baseSpeed: 8, maxSpeed: 18, accel: 2.4, turnRate: 2.1 },
    );
    context.enemy.mesh.position.copy(data.position);
    tempPosition.copy(data.position).add(data.velocity);
    context.enemy.mesh.lookAt(tempPosition);
    context.enemy.mesh.rotateZ(context.age * 8);
    return context.age > 10 || shotBehindCamera(context.camera, data.position);
  }

  function updateInterlock(context: MassDriverDef9Update, data: Extract<MassDriverDef9SpawnData, { role: 'interlock' }>) {
    const paced = massDriverDef9BossPacer.sample(context.enemy.entry.time, context.runTime, data.pacing);
    const angle = data.socket / MASS_DRIVER_DEF9_INTERLOCK_COUNT * Math.PI * 2 + Math.PI / 6;
    const charge = MathUtils.clamp((context.runTime - MASS_DRIVER_DEF9_TIME.bar(MASS_DRIVER_DEF9_BARS.interlocks)) / 15, 0, 1);
    const radius = MathUtils.lerp(13.5, 10.5, charge);
    tempOffset.set(
      Math.cos(angle) * radius,
      Math.sin(angle) * radius * 0.62,
      Math.sin(context.age * 1.8 + data.phase) * 0.8,
    );
    context.enemy.mesh.position.copy(offsetFromRail(context.curve, paced.anchorU, tempOffset));
    context.enemy.mesh.lookAt(context.camera.position);
    context.enemy.mesh.rotateZ(-angle + Math.PI / 2 + Math.sin(context.age * 2 + data.phase) * 0.08);
    context.enemy.mesh.userData.charge = charge;
    context.enemy.mesh.userData.stageIndex = context.enemy.hitStageIndex;
    context.enemy.mesh.userData.exposed = true;
    context.enemy.mesh.userData.bankStage = data.bankStage;
    return context.runTime > paced.passTime + 0.28;
  }

  function updateCharge(context: MassDriverDef9Update) {
    context.enemy.mesh.visible = false;
    if (!interlocksCleared && !barrelFailed && context.runTime >= MASS_DRIVER_DEF9_RUN_DURATION - 0.48) {
      barrelFailed = true;
      context.damagePlayer(MASS_DRIVER_DEF9_PLAYER_HEALTH);
    }
    return false;
  }

  return {
    duration: MASS_DRIVER_DEF9_RUN_DURATION,
    bpm: MASS_DRIVER_DEF9_BPM,
    playerHealth: MASS_DRIVER_DEF9_PLAYER_HEALTH,
    createRail: createMassDriverDef9Rail,
    spawnTimeline: MASS_DRIVER_DEF9_SPAWN_TIMELINE,
    easeRunProgress: massDriverDef9RunProgress,
    startWord: 'ARM',
    replayWord: 'REARM',
    lockRadiusNdc: 0.105,
    timing: {
      shotDelay: { maxGridSeconds: 0.72, gridRampGapGrowthThirtyseconds: 1 },
      actionSfx: { enabled: true, gridThirtyseconds: 1 },
    },
    updateAttractCamera({ camera, curve, modeTime }) {
      const u = 0.018 + (Math.sin(modeTime * 0.12) + 1) * 0.004;
      const position = curve.getPointAt(u);
      const lookAt = curve.getPointAt(Math.min(1, u + 0.012));
      camera.position.copy(position);
      camera.lookAt(lookAt);
      camera.rotateZ(Math.sin(modeTime * 0.28) * 0.025);
    },
    updateEnemy(context) {
      const data = context.enemy.entry.data;
      switch (data.role) {
        case 'skimmer':
          return updateSkimmer(context, data);
        case 'weaver':
          return updateWeaver(context, data);
        case 'sentinel':
          return updateSentinel(context, data);
        case 'arcbolt':
          return updateArcbolt(context, data);
        case 'interlock':
          return updateInterlock(context, data);
        case 'charge':
          return updateCharge(context);
      }
    },
    scoreForKill(volleySize, enemy) {
      const base: Record<MassDriverDef9EnemyKind, number> = {
        skimmer: 110,
        weaver: 145,
        sentinel: 240,
        arcbolt: 70,
        interlock: 260,
        charge: 0,
      };
      return Math.round(base[enemy.kind] * (1 + Math.max(0, volleySize - 1) * 0.16));
    },
    scoreForHit(_volleySize, enemy) {
      return enemy.kind === 'interlock' ? 90 : 45;
    },
    scoreForVolley(results) {
      if (results.length < 4 || !results.every((result) => result.killed)) return 0;
      return results.length === 6 ? 720 : results.length * 80;
    },
    rankForRun(score, kills, totalEnemies) {
      const clearRate = totalEnemies === 0 ? 0 : kills / totalEnemies;
      if (interlocksCleared && score >= 21000 && clearRate >= 0.82) return 'S';
      if (interlocksCleared && score >= 14500 && clearRate >= 0.62) return 'A';
      if (interlocksCleared && score >= 9000 && clearRate >= 0.42) return 'B';
      if (score >= 4800 && clearRate >= 0.25) return 'C';
      return 'D';
    },
    detailsForRun() {
      const hull = Math.max(0, MASS_DRIVER_DEF9_PLAYER_HEALTH - hitsTaken);
      return [
        `Safety banks ${Math.floor(interlocksDestroyed / MASS_DRIVER_DEF9_INTERLOCK_COUNT)}/${MASS_DRIVER_DEF9_INTERLOCK_BANKS}`,
        interlocksCleared ? 'Payload launched' : barrelFailed ? 'Charge containment failed' : 'Muzzle remained sealed',
        `Hull ${hull}/${MASS_DRIVER_DEF9_PLAYER_HEALTH}`,
      ];
    },
  };
}
