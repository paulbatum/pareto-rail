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
import { createMusicTime } from '../../engine/music-time';
import { sortTimeline } from '../../engine/spawn-patterns';
import type { EventBus } from '../../events';

// THERMAL INK — a one-minute boss passage at 108 BPM. Twenty-seven bars is
// exactly 60 seconds in common time, so the final blackout can land on the
// last downbeat without an awkward tail.
export const THERMAL_INK_8448_BPM = 108;
export const THERMAL_INK_8448_TIME = createMusicTime(THERMAL_INK_8448_BPM, { stepsPerBar: 16 });
export const THERMAL_INK_8448_RUN_DURATION = THERMAL_INK_8448_TIME.bar(27);

export const THERMAL_INK_8448_BARS = {
  opening: 0,
  firstInk: 4,
  secondInk: 7.5,
  deepInk: 10.7,
  mantle: 14.4,
  reveal: 18,
  blackout: 22,
  finale: 24,
  end: 27,
} as const;

export const THERMAL_INK_8448_MARKERS = THERMAL_INK_8448_TIME.markers({
  opening: THERMAL_INK_8448_BARS.opening,
  firstInk: THERMAL_INK_8448_BARS.firstInk,
  secondInk: THERMAL_INK_8448_BARS.secondInk,
  deepInk: THERMAL_INK_8448_BARS.deepInk,
  mantle: THERMAL_INK_8448_BARS.mantle,
  reveal: THERMAL_INK_8448_BARS.reveal,
  blackout: THERMAL_INK_8448_BARS.blackout,
  finale: THERMAL_INK_8448_BARS.finale,
  end: THERMAL_INK_8448_BARS.end,
});

export const THERMAL_INK_8448_RUN_SECTIONS = [
  { name: 'silt', fromBar: 0, toBar: 4 },
  { name: 'first-blackout', fromBar: 4, toBar: 7.5 },
  { name: 'pressure', fromBar: 7.5, toBar: 10.7 },
  { name: 'deep-water', fromBar: 10.7, toBar: 14.4 },
  { name: 'mantle', fromBar: 14.4, toBar: 18 },
  { name: 'core-reveal', fromBar: 18, toBar: 22 },
  { name: 'final-blackout', fromBar: 22, toBar: 27 },
] as const;

export type ThermalInk8448EnemyKind = 'arm' | 'scavenger' | 'cable' | 'core' | 'bolt' | 'ink-cloud';
export type ThermalInk8448Engagement = { leadSeconds: number; windowSeconds: number };

export type ThermalInk8448SpawnData =
  | {
    role: 'arm';
    lead: number;
    offset: Vector3;
    socket: number;
    fireAt: number;
    engagement: ThermalInk8448Engagement;
  }
  | {
    role: 'scavenger';
    lead: number;
    fromX: number;
    toX: number;
    y: number;
    arc: number;
    delay: number;
    crossTime: number;
    phase: number;
    engagement: ThermalInk8448Engagement;
  }
  | {
    role: 'cable';
    lead: number;
    side: number;
    y: number;
    phase: number;
    fireAt: number;
    engagement: ThermalInk8448Engagement;
  }
  | {
    role: 'core';
    lead: number;
    forcedRevealAt: number;
    engagement: ThermalInk8448Engagement;
  }
  | {
    role: 'ink';
    lead: number;
    life: number;
    radius: number;
    engagement: ThermalInk8448Engagement;
  }
  | {
    role: 'bolt';
    position: Vector3;
    velocity: Vector3;
    lastAge: number;
    impact: HostileShotImpactState;
  };

export type ThermalInk8448SpawnEntry = LockOnSpawnEntry<ThermalInk8448EnemyKind, ThermalInk8448SpawnData>;
export type ThermalInk8448Update = LockOnEnemyUpdate<ThermalInk8448EnemyKind, ThermalInk8448SpawnData>;

const time = THERMAL_INK_8448_TIME;
const beat = time.beats;
const bar = time.bar;
const ARM_TARGET_COUNT = 6;
const CORE_FORCED_REVEAL = THERMAL_INK_8448_MARKERS.finale - beat(1.5);

// The rail rolls around the wreck, dives under the arms, then rises into the
// exposed core. Its lateral bends are deliberately broad: they make the
// sodium lamps and boss silhouette move through the whole viewport.
export function createThermalInk8448Rail() {
  return new CatmullRomCurve3(
    [
      new Vector3(0, 1.5, 0),
      new Vector3(-6, 0.5, -28),
      new Vector3(11, 2.5, -58),
      new Vector3(18, -1.5, -88),
      new Vector3(-8, -3.5, -118),
      new Vector3(-22, 2, -148),
      new Vector3(-4, 5, -178),
      new Vector3(20, 0.5, -208),
      new Vector3(10, -5, -238),
      new Vector3(-18, -2, -268),
      new Vector3(-24, 4.5, -298),
      new Vector3(2, 7, -328),
      new Vector3(24, 2, -358),
      new Vector3(13, -5, -388),
      new Vector3(-15, -1, -418),
      new Vector3(-20, 6, -448),
      new Vector3(4, 8, -478),
      new Vector3(25, 1, -508),
      new Vector3(12, -4, -538),
      new Vector3(-6, 0, -568),
    ],
    false,
    'catmullrom',
    0.42,
  );
}

function contract(lead: number): ThermalInk8448Engagement {
  return { leadSeconds: lead, windowSeconds: lead };
}

function arm(at: number, lead: number, x: number, y: number, socket: number, fireAt = 2.1): ThermalInk8448SpawnEntry {
  return {
    time: at,
    kind: 'arm',
    hitStages: [2, 2],
    data: { role: 'arm', lead, offset: new Vector3(x, y, 0), socket, fireAt, engagement: contract(lead) },
  };
}

function scavengerWave(
  at: number,
  lead: number,
  paths: Array<[fromX: number, toX: number, y: number, arc: number]>,
): ThermalInk8448SpawnEntry[] {
  return paths.map(([fromX, toX, y, arc], index) => ({
    time: at + index * beat(0.24),
    kind: 'scavenger',
    data: {
      role: 'scavenger',
      lead,
      fromX,
      toX,
      y,
      arc,
      delay: index * 0.26,
      crossTime: 2.25 + (index % 2) * 0.25,
      phase: index * 1.7 + at,
      engagement: contract(lead),
    },
  }));
}

function cable(at: number, lead: number, side: number, y: number, phase: number): ThermalInk8448SpawnEntry {
  return {
    time: at,
    kind: 'cable',
    hitStages: [1, 1],
    data: { role: 'cable', lead, side, y, phase, fireAt: 1.45, engagement: contract(lead) },
  };
}

function ink(at: number, lead = 3.4, life = 2.8, radius = 10): ThermalInk8448SpawnEntry {
  return {
    time: at,
    kind: 'ink-cloud',
    lockable: false,
    countsTowardTotal: false,
    data: { role: 'ink', lead, life, radius, engagement: contract(lead) },
  };
}

function core(at: number): ThermalInk8448SpawnEntry {
  const lead = 8.5;
  return {
    time: at,
    kind: 'core',
    lockable: false,
    hitStages: [4, 3],
    data: { role: 'core', lead, forcedRevealAt: CORE_FORCED_REVEAL, engagement: contract(lead) },
  };
}

function createThermalInk8448Timeline(): ThermalInk8448SpawnEntry[] {
  return sortTimeline([
    // The first two arms are visible in sodium haze; machinery scavengers
    // teach the player to sweep before the first forced sense change.
    arm(bar(1, 0.2), 4.8, -6.5, 2.7, 0),
    ...scavengerWave(bar(1, 1.5), 4.3, [
      [10, -10, 3.8, 1.2],
      [8, -8, -2.4, 2.4],
      [6, -6, 5.8, 0.8],
      [4, -4, 0.2, 2.1],
    ]),
    cable(bar(2, 2), 4.1, 1, 3.2, 0.2),
    arm(bar(3, 0.1), 4.8, 6.8, -1.8, 1),
    ...scavengerWave(bar(3, 1.5), 4.2, [
      [-10, 10, 1.2, 2.4],
      [-8, 8, 5.4, 1.1],
      [-6, 6, -3.2, 2.0],
    ]),

    // First ink: two hot targets are deliberately placed high and low so the
    // white-hot mode is a new composition, not just a palette swap.
    ink(bar(4)),
    arm(bar(4, 3), 4.8, -2.2, 5.2, 2, 1.8),
    cable(bar(5, 0.5), 4.0, -1, 0.8, 1.3),
    ...scavengerWave(bar(5, 1.25), 4.1, [
      [10, -10, -1.5, 2.8],
      [8, -8, 4.8, 1.6],
      [6, -6, 2.1, 2.2],
      [4, -4, 6.2, 0.8],
      [2, -2, -3.8, 1.8],
    ]),

    ink(bar(7.5), 3.3, 2.6, 11),
    arm(bar(7.75, 1), 4.7, 7.2, 3.6, 3, 1.65),
    cable(bar(8.5), 4.0, 1, -2.2, 2.5),
    ...scavengerWave(bar(8.8), 4.0, [
      [-11, 11, 4.8, 1.8],
      [-9, 9, -2.8, 2.4],
      [-7, 7, 1.4, 3.0],
      [-5, 5, 6.0, 1.0],
    ]),

    ink(bar(10.7), 3.4, 2.9, 12),
    arm(bar(10.95), 4.6, -7.5, -2.2, 4, 1.8),
    cable(bar(11.8), 3.9, -1, 4.8, 3.1),
    ...scavengerWave(bar(12.1), 4.0, [
      [11, -11, 0.2, 2.2],
      [9, -9, 5.5, 1.5],
      [7, -7, -3.6, 2.7],
      [5, -5, 2.8, 1.4],
    ]),

    ink(bar(14.4), 3.5, 2.8, 13),
    arm(bar(14.75), 4.5, 3.4, 5.7, 5, 1.55),
    cable(bar(15.6), 3.8, 1, 0.4, 4.4),
    ...scavengerWave(bar(16), 3.9, [
      [-11, 11, -2.2, 2.8],
      [-9, 9, 3.5, 1.3],
      [-7, 7, 6.3, 0.9],
      [-5, 5, 1.0, 2.4],
      [-3, 3, -4.0, 1.7],
    ]),

    // The boss' mantle begins to burn through the murk. The core exists but
    // remains un-lockable until the arms are gone or the final phrase arrives.
    core(bar(18, 0.5)),
    cable(bar(18.9), 4.0, -1, 3.6, 5.0),
    ...scavengerWave(bar(19.2), 3.9, [
      [10, -10, 4.8, 1.2],
      [8, -8, -2.0, 2.6],
      [6, -6, 1.8, 2.2],
    ]),
    ink(bar(20.4), 3.4, 2.7, 14),
    cable(bar(21), 3.8, 1, -2.6, 5.8),
    ...scavengerWave(bar(21.25), 3.8, [
      [-11, 11, 5.8, 0.9],
      [-9, 9, 0.4, 2.9],
      [-7, 7, -3.5, 1.8],
      [-5, 5, 3.0, 2.0],
    ]),

    // Last ink is the signature finish: the core is now forced open and the
    // final volley is readable as a red signal inside a charcoal blackout.
    ink(bar(24), 3.2, 4.0, 15),
    cable(bar(24.4), 3.5, -1, 4.2, 6.6),
    ...scavengerWave(bar(24.65), 3.5, [
      [11, -11, 5.7, 0.8],
      [9, -9, -3.0, 2.4],
      [7, -7, 1.3, 2.8],
      [5, -5, 4.0, 1.4],
    ]),
  ]);
}

export const THERMAL_INK_8448_SPAWN_TIMELINE = createThermalInk8448Timeline();

export const thermalInk8448Timeline = THERMAL_INK_8448_SPAWN_TIMELINE;

const KILL_SCORE: Record<ThermalInk8448EnemyKind, number> = {
  arm: 620,
  scavenger: 120,
  cable: 190,
  core: 2600,
  bolt: 40,
  'ink-cloud': 0,
};

const BOLT_MAX_AGE = 12;

export function createThermalInk8448Gameplay(bus: EventBus): LockOnRunnerLevel<ThermalInk8448EnemyKind, ThermalInk8448SpawnData> {
  const timeline = createThermalInk8448Timeline();
  const coreEntries = timeline.filter((entry) => entry.kind === 'core');
  const roles = new Map<number, ThermalInk8448EnemyKind>();
  const intercepted = new Set<number>();
  let armsBroken = 0;
  let hitsTaken = 0;
  let infraredMoments = 0;
  let coreOpen = false;

  bus.on('runstart', () => {
    roles.clear();
    intercepted.clear();
    armsBroken = 0;
    hitsTaken = 0;
    infraredMoments = 0;
    coreOpen = false;
    for (const entry of coreEntries) entry.lockable = false;
    bus.emit('bossphase', { phase: 'summoned' });
  });

  bus.on('spawn', ({ enemyId, kind }) => {
    roles.set(enemyId, kind as ThermalInk8448EnemyKind);
    if (kind === 'ink-cloud') infraredMoments += 1;
  });

  bus.on('playerhit', () => {
    hitsTaken += 1;
  });

  bus.on('fire', ({ enemyId }) => {
    intercepted.add(enemyId);
  });

  bus.on('kill', ({ enemyId }) => {
    const kind = roles.get(enemyId);
    if (kind === 'arm') armsBroken += 1;
    if (kind === 'core') bus.emit('bossphase', { phase: 'destroyed' });
    intercepted.delete(enemyId);
    roles.delete(enemyId);
  });

  bus.on('miss', ({ enemyId }) => {
    intercepted.delete(enemyId);
    roles.delete(enemyId);
  });

  function fireBolt(context: ThermalInk8448Update, from: Vector3) {
    const velocity = hostileShotAimPoint(context.camera, from).sub(from).normalize().multiplyScalar(5.5);
    context.spawnEnemy({
      time: context.runTime,
      kind: 'bolt',
      countsTowardTotal: false,
      data: { role: 'bolt', position: from.clone(), velocity, lastAge: 0, impact: {} },
    });
  }

  function updateArm(context: ThermalInk8448Update, data: Extract<ThermalInk8448SpawnData, { role: 'arm' }>) {
    const { enemy, age, runProgress, curve, camera, railAnchor } = context;
    const state = context.enemyState(() => ({ fired: false }));
    const offset = data.offset.clone();
    offset.x += Math.sin(age * 0.8 + data.socket * 1.9) * 0.65;
    offset.y += Math.cos(age * 0.65 + data.socket) * 0.35;
    offset.z = Math.sin(age * 1.2 + data.socket) * 0.5;
    if (enemy.hitStageIndex > 0) {
      offset.x += Math.sin(age * 19) * 0.14;
      offset.y += Math.cos(age * 17) * 0.12;
    }
    if (!state.fired && age >= data.fireAt) {
      state.fired = true;
      fireBolt(context, enemy.mesh.position);
    }
    const anchorU = railAnchor(data.lead);
    enemy.mesh.position.copy(offsetFromRail(curve, anchorU, offset));
    enemy.mesh.quaternion.copy(camera.quaternion);
    enemy.mesh.rotateZ(age * (0.22 + data.socket * 0.035));
    enemy.mesh.rotateX(Math.sin(age * 0.7 + data.socket) * 0.18);
    return runProgress > anchorU + 0.018;
  }

  function updateScavenger(context: ThermalInk8448Update, data: Extract<ThermalInk8448SpawnData, { role: 'scavenger' }>) {
    const { enemy, age, runProgress, curve, camera, railAnchor } = context;
    const anchorU = railAnchor(data.lead);
    const normalized = MathUtils.clamp((age - data.delay) / data.crossTime, 0, 1);
    const eased = normalized * normalized * (3 - 2 * normalized);
    const x = MathUtils.lerp(data.fromX, data.toX, eased);
    const y = data.y + Math.sin(normalized * Math.PI) * data.arc;
    const z = Math.sin(age * 3.4 + data.phase) * 0.35;
    enemy.mesh.position.copy(offsetFromRail(curve, anchorU, new Vector3(x, y, z)));
    const ahead = offsetFromRail(curve, anchorU, new Vector3(
      MathUtils.lerp(data.fromX, data.toX, Math.min(1, eased + 0.045)),
      data.y + Math.sin(Math.min(1, normalized + 0.045) * Math.PI) * data.arc,
      z,
    ));
    enemy.mesh.lookAt(ahead);
    enemy.mesh.rotateZ(age * 4.5 + data.phase);
    return age > data.delay + data.crossTime + 0.65 || runProgress > anchorU + 0.02;
  }

  function updateCable(context: ThermalInk8448Update, data: Extract<ThermalInk8448SpawnData, { role: 'cable' }>) {
    const { enemy, age, runProgress, curve, camera, railAnchor } = context;
    const state = context.enemyState(() => ({ fired: false }));
    const sweep = Math.sin(age * 1.2 + data.phase);
    const x = data.side * (7.8 - Math.abs(sweep) * 2.2) * (sweep >= 0 ? 1 : -1);
    const y = data.y + Math.cos(age * 1.8 + data.phase) * 1.2;
    const anchorU = railAnchor(data.lead);
    enemy.mesh.position.copy(offsetFromRail(curve, anchorU, new Vector3(x, y, Math.cos(age * 2.3) * 0.6)));
    const tangent = offsetFromRail(curve, anchorU, new Vector3(x + data.side * 0.3, y + Math.cos(age * 1.8 + data.phase) * 1.2, 0));
    enemy.mesh.lookAt(tangent);
    enemy.mesh.rotateZ(Math.sin(age * 2.8) * 0.35);
    if (!state.fired && age >= data.fireAt) {
      state.fired = true;
      fireBolt(context, enemy.mesh.position);
    }
    return runProgress > anchorU + 0.018;
  }

  function updateCore(context: ThermalInk8448Update, data: Extract<ThermalInk8448SpawnData, { role: 'core' }>) {
    const { enemy, runTime, runProgress, curve, camera } = context;
    if (!coreOpen && (armsBroken >= ARM_TARGET_COUNT || runTime >= data.forcedRevealAt)) {
      coreOpen = true;
      enemy.entry.lockable = true;
      bus.emit('bossphase', { phase: 'exposed' });
    }
    // Once the mantle is exposed it keeps pace with the camera rather than
    // being passed on the rail. This gives the final blackout a real boss
    // window instead of making the last target vanish at the rail end.
    const anchorU = MathUtils.clamp(runProgress + 0.105, 0, 1);
    const offset = new Vector3(
      Math.sin(runTime * 0.46) * 0.9,
      1.1 + Math.cos(runTime * 0.63) * 0.45,
      -1.2 + Math.sin(runTime * 0.8) * 0.5,
    );
    enemy.mesh.position.copy(offsetFromRail(curve, anchorU, offset));
    enemy.mesh.quaternion.copy(camera.quaternion);
    enemy.mesh.rotateZ(runTime * 0.28);
    enemy.mesh.rotateY(Math.sin(runTime * 0.7) * 0.15);
    return false;
  }

  function updateInk(context: ThermalInk8448Update, data: Extract<ThermalInk8448SpawnData, { role: 'ink' }>) {
    const { enemy, age, curve, camera, railAnchor } = context;
    const anchorU = railAnchor(data.lead);
    enemy.mesh.position.copy(offsetFromRail(curve, anchorU, new Vector3(0, 0.3, -1.2)));
    enemy.mesh.quaternion.copy(camera.quaternion);
    enemy.mesh.scale.setScalar(data.radius * (0.78 + Math.sin(age * 2.1) * 0.08));
    enemy.mesh.rotateZ(age * 0.18);
    return age >= data.life;
  }

  function updateBolt(context: ThermalInk8448Update, data: Extract<ThermalInk8448SpawnData, { role: 'bolt' }>) {
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
      config: { hitDistance: 2.8, impactBrake: 0.42, damageDistance: 0.72 },
    });
    if (impact.phase === 'braking') {
      enemy.mesh.position.copy(data.position);
      enemy.mesh.quaternion.copy(camera.quaternion);
      enemy.mesh.rotateZ(age * 10);
      if (impact.damaged) {
        damagePlayer(1);
        return true;
      }
      return false;
    }
    steerHomingShot(data.position, data.velocity, hostileShotAimPoint(camera, data.position, 2.8), age, dt, {
      baseSpeed: 5.5,
      maxSpeed: 14,
      accel: 4.2,
      turnRate: 2.6,
    });
    enemy.mesh.position.copy(data.position);
    enemy.mesh.quaternion.copy(camera.quaternion);
    enemy.mesh.rotateZ(age * 6.5);
    return shotBehindCamera(camera, data.position) || age > BOLT_MAX_AGE;
  }

  return {
    duration: THERMAL_INK_8448_RUN_DURATION,
    bpm: THERMAL_INK_8448_BPM,
    playerHealth: 4,
    createRail: createThermalInk8448Rail,
    spawnTimeline: timeline,
    startWord: 'START!',
    replayWord: 'REPLAY',
    lockRadiusNdc: 0.085,
    timing: {
      shotDelay: { maxGridSeconds: 0.24 },
      actionSfx: { enabled: true, gridThirtyseconds: 2 },
    },
    updateEnemy(context) {
      const data = context.enemy.entry.data;
      switch (data.role) {
        case 'arm': return updateArm(context, data);
        case 'scavenger': return updateScavenger(context, data);
        case 'cable': return updateCable(context, data);
        case 'core': return updateCore(context, data);
        case 'ink': return updateInk(context, data);
        case 'bolt': return updateBolt(context, data);
      }
    },
    scoreForHit: () => 45,
    scoreForKill(volleySize, enemy) {
      return Math.round(KILL_SCORE[enemy.kind] * (1 + Math.max(0, volleySize - 1) * 0.12));
    },
    scoreForVolley(results) {
      const clean = results.length >= 4 && results.every((result) => result.killed);
      return clean ? 180 + results.length * 35 : 0;
    },
    rankForRun(score, kills, totalEnemies) {
      const clearRate = totalEnemies > 0 ? kills / totalEnemies : 0;
      if (score >= 13500 && clearRate >= 0.86) return 'S';
      if (score >= 9800 && clearRate >= 0.68) return 'A';
      if (score >= 6500 && clearRate >= 0.48) return 'B';
      if (score >= 3000 && clearRate >= 0.25) return 'C';
      return 'D';
    },
    detailsForRun() {
      const hull = Math.max(0, 4 - hitsTaken);
      return [
        `Hull ${hull}/4`,
        `Arms broken ${Math.min(ARM_TARGET_COUNT, armsBroken)}/${ARM_TARGET_COUNT}`,
        `Infrared surges ${infraredMoments}`,
      ];
    },
  };
}
