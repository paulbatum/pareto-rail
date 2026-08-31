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
  BROADSIDE_806F_BARS,
  BROADSIDE_806F_BPM,
  BROADSIDE_806F_MARKERS,
  BROADSIDE_806F_RUN_DURATION,
  BROADSIDE_806F_TIME,
} from './timing';

export { BROADSIDE_806F_BPM, BROADSIDE_806F_RUN_DURATION, BROADSIDE_806F_TIME } from './timing';

export type Broadside806fEnemyKind =
  | 'skirmisher'
  | 'interceptor'
  | 'bomber'
  | 'turret'
  | 'flak'
  | 'generator'
  | 'power';

type SkirmisherData = {
  role: 'skirmisher';
  engagement: RailLead;
  lane: number;
  height: number;
  phase: number;
  direction: number;
};
type InterceptorData = {
  role: 'interceptor';
  engagement: RailLead;
  fromX: number;
  toX: number;
  height: number;
  phase: number;
};
type BomberData = {
  role: 'bomber';
  engagement: RailLead;
  side: number;
  height: number;
  phase: number;
};
type TurretData = { role: 'turret'; engagement: RailLead; x: number; y: number; phase: number };
type GeneratorData = { role: 'generator'; engagement: RailLead; x: number; y: number; socket: number };
type PowerData = { role: 'power'; engagement: RailLead; x: number; y: number; socket: number };
type FlakData = { role: 'flak'; lead: number; x: number; y: number; phase: number };

export type Broadside806fSpawnData =
  | SkirmisherData
  | InterceptorData
  | BomberData
  | TurretData
  | GeneratorData
  | PowerData
  | FlakData;

export type Broadside806fSpawn = LockOnSpawnEntry<Broadside806fEnemyKind, Broadside806fSpawnData>;
type BroadsideUpdate = LockOnEnemyUpdate<Broadside806fEnemyKind, Broadside806fSpawnData>;

const speedProfile = createSpeedProfile([
  [0, 0.72],
  [BROADSIDE_806F_TIME.bar(3), 1.18],
  [BROADSIDE_806F_MARKERS.broadside, 1.5],
  [BROADSIDE_806F_MARKERS.underbelly, 1.3],
  [BROADSIDE_806F_MARKERS.eye, 0.42],
  [BROADSIDE_806F_MARKERS.flagship, 0.82],
  [BROADSIDE_806F_MARKERS.turn, 1.42],
  [BROADSIDE_806F_MARKERS.trench, 1.68],
  [BROADSIDE_806F_MARKERS.victory, 2.4],
  [BROADSIDE_806F_RUN_DURATION, 1.8],
], BROADSIDE_806F_RUN_DURATION);

export const broadside806fRunProgress = speedProfile.runProgress;
export const broadside806fSpeedAt = speedProfile.speedAt;

export function createBroadside806fRail() {
  return new CatmullRomCurve3([
    new Vector3(0, 16, 76),
    new Vector3(0, 17, -50),
    new Vector3(34, 27, -190),
    new Vector3(-58, 42, -350),
    new Vector3(68, 10, -520),
    new Vector3(-50, -5, -690),
    new Vector3(-24, 12, -870),
    new Vector3(-10, 8, -1060),
    new Vector3(28, 24, -1230),
    new Vector3(72, -8, -1410),
    new Vector3(-50, -28, -1590),
    new Vector3(24, -8, -1760),
    new Vector3(12, 16, -1900),
    new Vector3(-38, 2, -2070),
    new Vector3(52, 14, -2225),
    new Vector3(8, -30, -2375),
    new Vector3(-8, -14, -2515),
    new Vector3(2, -8, -2645),
    new Vector3(104, 88, -2735),
    new Vector3(246, 186, -2420),
  ], false, 'catmullrom', 0.38);
}

const pacingRail = createBroadside806fRail();
const pacer = createRailPacer({
  curve: pacingRail,
  duration: BROADSIDE_806F_RUN_DURATION,
  runProgress: broadside806fRunProgress,
  spawnAheadUnits: 78,
  defaultLeadSeconds: 4.2,
});

const STAGGER = BROADSIDE_806F_TIME.stepSeconds * 0.72;
const bar = BROADSIDE_806F_TIME.bar;

function skirmisherFan(time: number, count: number, radius = 25, lead = 4.25, tilt = 0): Broadside806fSpawn[] {
  return Array.from({ length: count }, (_, index) => {
    const centered = index - (count - 1) / 2;
    const direction = index % 2 === 0 ? 1 : -1;
    const entryTime = time + index * STAGGER;
    return {
      time: entryTime,
      kind: 'skirmisher',
      data: {
        role: 'skirmisher',
        engagement: pacer.resolve(entryTime, lead),
        lane: centered * (radius * 2 / Math.max(1, count - 1)),
        height: Math.sin(index * 2.17 + tilt) * 15 + tilt * 3,
        phase: time * 0.91 + index * 1.73,
        direction,
      },
    };
  });
}

function interceptorCross(time: number, count: number, high = false, lead = 3.9): Broadside806fSpawn[] {
  return Array.from({ length: count }, (_, index) => {
    const left = index % 2 === 0;
    const entryTime = time + index * STAGGER * 0.78;
    return {
      time: entryTime,
      kind: 'interceptor',
      data: {
        role: 'interceptor',
        engagement: pacer.resolve(entryTime, lead),
        fromX: left ? -42 : 42,
        toX: left ? 42 : -42,
        height: (high ? 14 : -8) + (index - (count - 1) / 2) * 5.5,
        phase: index * 1.37 + time,
      },
    };
  });
}

function bomberDive(time: number, count: number, lead = 4.8): Broadside806fSpawn[] {
  return Array.from({ length: count }, (_, index) => {
    const entryTime = time + index * STAGGER * 1.18;
    return {
      time: entryTime,
      kind: 'bomber',
      hitStages: [1, 1],
      data: {
        role: 'bomber',
        engagement: pacer.resolve(entryTime, lead),
        side: index % 2 === 0 ? -1 : 1,
        height: 24 - index * 6,
        phase: index * 2.31 + time * 0.4,
      },
    };
  });
}

function bellyTurrets(time: number, points: Array<[number, number]>, lead = 4.9): Broadside806fSpawn[] {
  return points.map(([x, y], index) => {
    const entryTime = time + index * STAGGER * 0.9;
    return {
      time: entryTime,
      kind: 'turret',
      hitStages: [2],
      data: { role: 'turret', engagement: pacer.resolve(entryTime, lead), x, y, phase: index * 1.8 + time },
    };
  });
}

const generatorPoints: Array<[number, number]> = [[-28, 14], [-10, -10], [10, 15], [28, -8]];
const generatorEntries: Broadside806fSpawn[] = generatorPoints.map(([x, y], socket) => {
  const entryTime = bar(20.15 + socket * 0.62);
  return {
    time: entryTime,
    kind: 'generator',
    hitStages: [2],
    data: { role: 'generator', engagement: pacer.resolve(entryTime, 5.6), x, y, socket },
  };
});

const powerPoints: Array<[number, number]> = [[-17, -7], [0, 11], [17, -6]];
const powerEntries: Broadside806fSpawn[] = powerPoints.map(([x, y], socket) => {
  const entryTime = bar(27.0 + socket * 0.9);
  return {
    time: entryTime,
    kind: 'power',
    hitPoints: 1,
    lockable: false,
    data: { role: 'power', engagement: pacer.resolve(entryTime, 5.2), x, y, socket },
  };
});

function flagshipFlak(time: number, count: number): Broadside806fSpawn[] {
  return Array.from({ length: count }, (_, index) => ({
    time: time + index * BROADSIDE_806F_TIME.beatSeconds * 1.3,
    kind: 'flak',
    countsTowardTotal: false,
    data: {
      role: 'flak',
      lead: 1.0,
      x: (index % 2 ? 1 : -1) * (15 + (index % 4) * 6),
      y: 18 - (index % 3) * 15,
      phase: index * 1.91,
    },
  }));
}

export const BROADSIDE_806F_SPAWN_TIMELINE: Broadside806fSpawn[] = [
  // Launch deck and first contact: clean packets establish the two fighter grammars.
  ...skirmisherFan(bar(1.1), 4, 24, 4.4, 0.4),
  ...interceptorCross(bar(2.7), 5, true, 4.05),
  ...bomberDive(bar(3.65), 3, 4.8),

  // The unordered fleet engagement knots three motions through one another.
  ...skirmisherFan(bar(4.8), 6, 34, 4.25, -1.1),
  ...interceptorCross(bar(6.1), 6, false, 3.85),
  ...bomberDive(bar(7.25), 4, 4.65),

  // Long run down the friendly cruiser; waves clear for the guns on each phrase.
  ...skirmisherFan(bar(8.55), 6, 38, 4.15, 1.4),
  ...interceptorCross(bar(10.1), 6, true, 3.8),
  ...bomberDive(bar(11.55), 4, 4.55),
  ...skirmisherFan(bar(12.75), 6, 36, 4.05, -0.6),

  // The rail rolls under an enemy cruiser. Rooted guns replace free-flying swarms.
  ...bellyTurrets(bar(14.15), [[-28, 15], [-10, 2], [10, 2], [28, 15]], 5.0),
  ...interceptorCross(bar(15.15), 5, false, 3.75),
  ...bellyTurrets(bar(16.05), [[-24, -9], [-8, 12], [8, 12], [24, -9]], 4.8),
  ...skirmisherFan(bar(17.0), 4, 31, 4.0, 0.2),

  // One lonely scout crosses the near-silent eye before the flagship fills the frame.
  ...bomberDive(bar(18.55), 1, 4.7),

  ...generatorEntries,
  ...flagshipFlak(bar(20.35), 9),

  // Shield-break turn: escorts pour out while the rail curls back to the trench.
  ...skirmisherFan(bar(24.0), 6, 38, 3.95, 1.2),
  ...interceptorCross(bar(25.15), 6, false, 3.65),
  ...bomberDive(bar(26.15), 3, 4.1),

  ...powerEntries,
].sort((a, b) => a.time - b.time);

const SCORE: Record<Broadside806fEnemyKind, number> = {
  skirmisher: 120,
  interceptor: 145,
  bomber: 250,
  turret: 320,
  flak: 65,
  generator: 900,
  power: 1500,
};

type FlakState = {
  position: Vector3;
  velocity: Vector3;
  lastAge: number;
  impact: HostileShotImpactState;
};

function updatePacedFighter(context: BroadsideUpdate) {
  const { enemy, age, runTime, curve, camera } = context;
  const data = enemy.entry.data;
  if (data.role !== 'skirmisher' && data.role !== 'interceptor' && data.role !== 'bomber') return false;
  const pace = pacer.sample(enemy.entry.time, runTime, data.engagement);
  const offset = new Vector3();

  if (data.role === 'skirmisher') {
    const braid = age * (1.45 + Math.abs(data.lane) * 0.008) + data.phase;
    offset.set(
      data.lane + Math.sin(braid) * 8.5 * data.direction,
      data.height + Math.cos(braid * 1.17) * 9,
      Math.sin(braid * 0.7) * 4,
    );
    enemy.mesh.lookAt(camera.position);
    enemy.mesh.rotateZ(-Math.cos(braid) * 0.72 * data.direction);
  } else if (data.role === 'interceptor') {
    const crossing = MathUtils.smootherstep(MathUtils.clamp(age / 2.75, 0, 1), 0, 1);
    const corkscrew = age * 5.4 + data.phase;
    offset.set(
      MathUtils.lerp(data.fromX, data.toX, crossing),
      data.height + Math.sin(corkscrew) * 7.5,
      Math.cos(corkscrew) * 6,
    );
    enemy.mesh.lookAt(camera.position);
    enemy.mesh.rotateZ(MathUtils.lerp(-1.05, 1.05, crossing) * Math.sign(data.toX));
  } else {
    const dive = MathUtils.clamp(age / 3.35, 0, 1);
    const peel = Math.sin(dive * Math.PI);
    offset.set(
      data.side * (38 - dive * 19) + Math.sin(age * 1.4 + data.phase) * 4,
      data.height + 24 * (1 - dive) - 35 * dive + peel * 8,
      Math.cos(age * 1.2 + data.phase) * 5,
    );
    enemy.mesh.lookAt(camera.position);
    enemy.mesh.rotateZ(data.side * (-0.45 + dive * 0.9));
  }

  // The gestures use the whole viewport, then fold back toward the flight
  // line for the final approach. This preserves the broad sweep without
  // sacrificing the authored engagement window as the camera overtakes them.
  const approach = MathUtils.clamp(age / data.engagement.leadSeconds, 0, 1);
  const settle = 1 - MathUtils.smootherstep(approach, 0.68, 1);
  const converge = Math.max(0.015, settle ** 1.8);
  offset.x *= converge;
  offset.y *= 0.12 + converge * 0.88;
  offset.z *= converge;

  enemy.mesh.position.copy(offsetFromRail(curve, pace.anchorU, offset));
  enemy.mesh.userData.heat = MathUtils.clamp(age / data.engagement.leadSeconds, 0, 1);
  return runTime > data.engagement.passTime + 0.52;
}

function updateTurret(context: BroadsideUpdate, data: TurretData) {
  const pace = pacer.sample(context.enemy.entry.time, context.runTime, data.engagement);
  const anchor = pace.anchorU;
  const rise = MathUtils.smoothstep(context.age, 0.1, 0.85);
  const offset = new Vector3(data.x, data.y + (rise - 1) * 12, Math.sin(data.phase) * 4);
  context.enemy.mesh.position.copy(offsetFromRail(context.curve, anchor, offset));
  context.enemy.mesh.lookAt(context.camera.position);
  context.enemy.mesh.rotateZ(Math.sin(context.age * 0.8 + data.phase) * 0.12);
  context.enemy.mesh.userData.stageIndex = context.enemy.hitStageIndex;
  context.enemy.mesh.userData.telegraph = Math.max(0, Math.sin(context.age * Math.PI * 0.9 + data.phase));
  return context.runTime > data.engagement.passTime + 0.45;
}

function updateGenerator(context: BroadsideUpdate, data: GeneratorData) {
  const pace = pacer.sample(context.enemy.entry.time, context.runTime, data.engagement);
  const anchor = pace.anchorU;
  const sweep = MathUtils.smoothstep(context.age, 0, 1.25);
  context.enemy.mesh.position.copy(offsetFromRail(
    context.curve,
    anchor,
    new Vector3(data.x * (0.7 + sweep * 0.3), data.y, Math.sin(context.age * 0.7 + data.socket) * 3),
  ));
  context.enemy.mesh.lookAt(context.camera.position);
  context.enemy.mesh.rotateZ(context.age * (data.socket % 2 ? -0.22 : 0.22));
  context.enemy.mesh.userData.socket = data.socket;
  context.enemy.mesh.userData.shieldEnergy = 1 - context.enemy.hitStageIndex / Math.max(1, context.enemy.hitStageCount);
  return context.runTime > data.engagement.passTime + 0.55;
}

function updatePower(context: BroadsideUpdate, data: PowerData, shieldDown: boolean) {
  const forcedOpen = context.runTime >= BROADSIDE_806F_MARKERS.trench + 1.25;
  context.enemy.entry.lockable = shieldDown || forcedOpen;
  const intro = MathUtils.smoothstep(context.age, 0, 0.6);
  const approach = MathUtils.smootherstep(MathUtils.clamp(context.age / data.engagement.leadSeconds, 0, 1), 0, 1);
  const forward = new Vector3();
  const right = new Vector3().setFromMatrixColumn(context.camera.matrixWorld, 0).normalize();
  const up = new Vector3().setFromMatrixColumn(context.camera.matrixWorld, 1).normalize();
  context.camera.getWorldDirection(forward);
  context.enemy.mesh.position.copy(context.camera.position)
    .addScaledVector(forward, MathUtils.lerp(76, 17, approach))
    .addScaledVector(right, data.x * (1 - approach * 0.32))
    .addScaledVector(up, data.y * intro + Math.sin(context.age + data.socket) * 1.5);
  context.enemy.mesh.lookAt(context.camera.position);
  context.enemy.mesh.rotateZ(context.age * (data.socket % 2 ? -0.7 : 0.7));
  context.enemy.mesh.userData.stageIndex = context.enemy.hitStageIndex;
  context.enemy.mesh.userData.stageCount = context.enemy.hitStageCount;
  context.enemy.mesh.userData.shielded = !context.enemy.entry.lockable;
  return context.age > data.engagement.leadSeconds + 1.0;
}

function updateFlak(context: BroadsideUpdate, data: FlakData, intercepted: Set<number>) {
  const state = context.enemyState<FlakState>(() => {
    const anchor = context.railAnchor(data.lead);
    const position = offsetFromRail(context.curve, anchor, new Vector3(data.x, data.y, 0));
    const velocity = hostileShotAimPoint(context.camera, position, 2.3).sub(position).normalize().multiplyScalar(26);
    return { position, velocity, lastAge: 0, impact: {} };
  });
  const dt = Math.max(0, context.age - state.lastAge);
  state.lastAge = context.age;
  const impact = updateHostileShotImpact({
    age: context.age,
    camera: context.camera,
    position: state.position,
    velocity: state.velocity,
    state: state.impact,
    intercepted: intercepted.delete(context.enemy.id),
    config: { hitDistance: 2.8, impactBrake: 0.42, damageDistance: 0.62 },
  });
  context.enemy.mesh.position.copy(state.position);
  context.enemy.mesh.quaternion.copy(context.camera.quaternion);
  context.enemy.mesh.rotateZ(context.age * 11 + data.phase);
  context.enemy.mesh.userData.impact = impact.phase === 'braking';
  if (impact.phase === 'braking') {
    if (impact.damaged) {
      context.damagePlayer(1);
      return true;
    }
    return false;
  }
  steerHomingShot(state.position, state.velocity, hostileShotAimPoint(context.camera, state.position, 2.4), context.age, dt, {
    baseSpeed: 26,
    maxSpeed: 98,
    accel: 46,
    turnRate: 8.5,
  });
  return context.age > 10 || shotBehindCamera(context.camera, state.position);
}

export function createBroadside806fGameplay(bus: EventBus): LockOnRunnerLevel<Broadside806fEnemyKind, Broadside806fSpawnData> {
  const generatorIds = new Set<number>();
  const powerIds = new Set<number>();
  const flakIds = new Set<number>();
  const interceptedFlak = new Set<number>();
  let generatorsDestroyed = 0;
  let powerDestroyed = 0;
  let flakDestroyed = 0;
  let hullHits = 0;
  let shieldDown = false;

  bus.on('runstart', () => {
    generatorIds.clear();
    powerIds.clear();
    flakIds.clear();
    interceptedFlak.clear();
    generatorsDestroyed = 0;
    powerDestroyed = 0;
    flakDestroyed = 0;
    hullHits = 0;
    shieldDown = false;
    for (const entry of powerEntries) entry.lockable = false;
  });
  bus.on('spawn', ({ enemyId, kind }) => {
    if (kind === 'generator') generatorIds.add(enemyId);
    if (kind === 'power') powerIds.add(enemyId);
    if (kind === 'flak') flakIds.add(enemyId);
  });
  bus.on('fire', ({ enemyId }) => {
    if (flakIds.has(enemyId)) interceptedFlak.add(enemyId);
  });
  bus.on('kill', ({ enemyId }) => {
    if (generatorIds.delete(enemyId)) {
      generatorsDestroyed += 1;
      if (generatorsDestroyed === generatorEntries.length) {
        shieldDown = true;
        bus.emit('bossphase', { phase: 'exposed' });
      }
    }
    if (powerIds.delete(enemyId)) {
      powerDestroyed += 1;
      if (powerDestroyed === powerEntries.length) bus.emit('bossphase', { phase: 'destroyed' });
    }
    if (flakIds.delete(enemyId)) flakDestroyed += 1;
    interceptedFlak.delete(enemyId);
  });
  bus.on('miss', ({ enemyId }) => {
    generatorIds.delete(enemyId);
    powerIds.delete(enemyId);
    flakIds.delete(enemyId);
    interceptedFlak.delete(enemyId);
  });
  bus.on('playerhit', () => { hullHits += 1; });

  return {
    duration: BROADSIDE_806F_RUN_DURATION,
    bpm: BROADSIDE_806F_BPM,
    createRail: createBroadside806fRail,
    spawnTimeline: BROADSIDE_806F_SPAWN_TIMELINE,
    easeRunProgress: broadside806fRunProgress,
    playerHealth: 4,
    lockRadiusNdc: 0.18,
    startWord: 'SORTIE',
    replayWord: 'RETURN',
    timing: {
      shotDelay: { maxGridSeconds: 0.145, gridRampGapGrowthThirtyseconds: 1 },
      actionSfx: { enabled: true, gridThirtyseconds: 2 },
    },
    updateAttractCamera({ camera, curve, modeTime }) {
      const base = curve.getPointAt(0);
      const look = curve.getPointAt(0.027);
      camera.position.copy(base).add(new Vector3(Math.sin(modeTime * 0.35) * 0.16, 1.5 + Math.cos(modeTime * 0.42) * 0.12, 5.5));
      camera.lookAt(look.clone().add(new Vector3(0, 2.2, 0)));
      camera.rotateZ(Math.sin(modeTime * 0.28) * 0.012);
    },
    updateCameraEffects({ camera, runTime, runProgress }) {
      const broadsideRush = MathUtils.smoothstep(runTime, BROADSIDE_806F_MARKERS.broadside, BROADSIDE_806F_MARKERS.underbelly);
      const eye = 1 - MathUtils.clamp(Math.abs(runTime - BROADSIDE_806F_MARKERS.eye - 1.7) / 2.2, 0, 1);
      const trench = MathUtils.smoothstep(runTime, BROADSIDE_806F_MARKERS.trench, BROADSIDE_806F_MARKERS.victory);
      const roll = Math.sin(runProgress * Math.PI * 13) * (0.035 + broadsideRush * 0.11 + trench * 0.08) * (1 - eye * 0.75);
      camera.rotateZ(roll);
    },
    updateEnemy(context) {
      const data = context.enemy.entry.data;
      if (data.role === 'skirmisher' || data.role === 'interceptor' || data.role === 'bomber') return updatePacedFighter(context);
      if (data.role === 'turret') return updateTurret(context, data);
      if (data.role === 'generator') return updateGenerator(context, data);
      if (data.role === 'power') return updatePower(context, data, shieldDown);
      return updateFlak(context, data, interceptedFlak);
    },
    scoreForHit(volleySize, enemy) {
      return Math.round(SCORE[enemy.kind] * 0.28 * (1 + Math.max(0, volleySize - 1) * 0.08));
    },
    scoreForKill(volleySize, enemy) {
      return Math.round(SCORE[enemy.kind] * (1 + Math.max(0, volleySize - 1) * 0.16));
    },
    scoreForVolley(results) {
      if (results.length !== 6) return 0;
      return results.every((result) => result.killed) ? 806 : 240;
    },
    rankForRun(score, kills, totalEnemies) {
      const clear = totalEnemies > 0 ? kills / totalEnemies : 0;
      const flagshipBroken = powerDestroyed === powerEntries.length;
      if (flagshipBroken && clear >= 0.9 && hullHits === 0 && score >= 19000) return 'GRAND ADMIRAL';
      if (flagshipBroken && clear >= 0.76) return 'LINEBREAKER';
      if (flagshipBroken) return 'VANGUARD';
      if (shieldDown || clear >= 0.58) return 'GUNNER';
      return 'ENSIGN';
    },
    detailsForRun() {
      return [
        `Shield generators ${generatorsDestroyed}/${generatorEntries.length}`,
        `Flagship power systems ${powerDestroyed}/${powerEntries.length}`,
        `Point defense intercepted ${flakDestroyed} · hull hits ${hullHits}`,
      ];
    },
  };
}
