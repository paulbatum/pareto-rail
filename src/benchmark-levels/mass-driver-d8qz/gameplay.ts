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
import { sortTimeline } from '../../engine/spawn-patterns';
import type { EventBus } from '../../events';
import {
  bar,
  FAULT_TIME,
  LAUNCH_TIME,
  MASS_DRIVER_BPM,
  MASS_DRIVER_DURATION,
  MASS_DRIVER_TIME,
  MUZZLE_TIME,
} from './timing';

// MASS DRIVER — 60 seconds inside an orbital railgun, scored to a 128 BPM pulse
// (one bar = 1.875 s; 32 bars = exactly 60 s):
//
//   Breech      (0–3.75s)     The payload is released into the barrel.
//   Cold barrel (3.75–15s)    Arc-blue rings, sparse drone wheels, learn the sweep.
//   Drive       (15–26.25s)   Violet rings, lances and armoured sentries.
//   Arc phase   (26.25–37.5s) The barrel is hot; the fight gets dense.
//   Fault       (37.5–52.5s)  Six safety interlocks jam. The firing charge builds.
//   Launch      (52.5–56.25s) Charge peak: the gun fires, or the barrel does.
//   Void        (56.25–60s)   Out of the muzzle. Silence.
//
// The one idea everything hangs off: the camera passes through exactly one
// accelerator ring on every beat. Ring N sits at the rail position the camera
// occupies at beat N, so the speed profile alone makes the rings spread apart
// as the payload accelerates while the pulse never changes.

export {
  FAULT_TIME,
  LAUNCH_TIME,
  MASS_DRIVER_BPM,
  MASS_DRIVER_DURATION,
  MUZZLE_TIME,
  bar,
} from './timing';

const TAU = Math.PI * 2;

// ---- world scale ------------------------------------------------------------
// Everything hostile flies inside the bore; every ring, coil and wall panel sits
// outside it. That separation is why the barrel can be a solid tunnel without
// ever occluding a target.

/** Inner radius of the glowing accelerator ring: the clear bore. */
export const BORE_RADIUS = 23;
/** Orbits are stretched horizontally so a circle in the bore reads as a circle on a 16:9 frame. */
export const BORE_X_SCALE = 1.35;
/** Largest orbital radius any target may take; comfortably inside `BORE_RADIUS`. */
export const TARGET_MAX_RADIUS = 12.6;
export const MASS_DRIVER_RAIL_LENGTH = 3480;
export const MASS_DRIVER_PLAYER_HEALTH = 3;
/** Damage dealt by the barrel overload; nothing else in the level hits this hard. */
export const BARREL_BLAST_DAMAGE = 9;

const SPAWN_AHEAD_UNITS = 42;
const MISS_GRACE = 0.4;

const DRONE_LEAD = 2.4;
const LANCE_LEAD = 1.7;
const SENTRY_LEAD = 2.8;

export const INTERLOCK_COUNT = 6;
/** Interlocks station-keep this far ahead: a ring of clamps the payload cannot get past. */
const INTERLOCK_HOLD_UNITS = 34;
const INTERLOCK_RADIUS = 11.4;
const INTERLOCK_SPIN = 0.24;

// ---- speed profile → rail easing --------------------------------------------
// Factor 1.0 ≈ 33 u/s. The run never decelerates: it is a gun barrel. The step
// at bar 28 is the firing charge finally releasing.

const SPEED_KEYS: Array<[number, number]> = [
  [bar(0), 0.55],
  [bar(1), 0.70],
  [bar(2), 0.88],
  [bar(8), 1.10],
  [bar(14), 1.34],
  [bar(20), 1.56],
  [bar(24), 1.74],
  [bar(27, 3), 1.98],
  [bar(28), 3.40],
  [bar(30), 5.20],
  [bar(32), 5.60],
];

const speedProfile = createSpeedProfile(SPEED_KEYS, MASS_DRIVER_DURATION, { samples: 1800 });

export const speedFactorAt = speedProfile.speedAt;

export function massDriverRunProgress(time: number, duration = MASS_DRIVER_DURATION) {
  return speedProfile.runProgress(time, duration);
}

// ---- rail --------------------------------------------------------------------

// A railgun barrel is straight. The whisper of drift here exists only so the
// tunnel has parallax; it stays far inside the bore clearance.
export function createMassDriverRail() {
  const length = MASS_DRIVER_RAIL_LENGTH;
  return new CatmullRomCurve3(
    [
      new Vector3(0, 0, 0),
      new Vector3(0.9, -0.7, -length * 0.14),
      new Vector3(-1.3, 0.8, -length * 0.30),
      new Vector3(1.5, 0.5, -length * 0.46),
      new Vector3(-1.1, -0.9, -length * 0.62),
      new Vector3(0.7, 1.0, -length * 0.78),
      new Vector3(-0.4, -0.3, -length * 0.90),
      new Vector3(0, 0, -length),
    ],
    false,
    'catmullrom',
    0.5,
  );
}

const railCurve = createMassDriverRail();
export const MASS_DRIVER_RAIL_UNITS = railCurve.getLength();

// ---- the ring lattice ---------------------------------------------------------
// One ring per beat, up to and including the muzzle. Exported so the visuals and
// the gameplay agree on where every beat lands in space.

export const RING_COUNT = Math.round(MUZZLE_TIME / MASS_DRIVER_TIME.beatSeconds);
export const RING_PASS_TIMES: number[] = Array.from(
  { length: RING_COUNT + 1 },
  (_value, index) => index * MASS_DRIVER_TIME.beatSeconds,
);
export const RING_RAIL_US: number[] = RING_PASS_TIMES.map((time) => massDriverRunProgress(time));
export const MUZZLE_U = RING_RAIL_US[RING_COUNT];

const pacer = createRailPacer({
  curve: railCurve,
  duration: MASS_DRIVER_DURATION,
  runProgress: massDriverRunProgress,
  spawnAheadUnits: SPAWN_AHEAD_UNITS,
  defaultLeadSeconds: DRONE_LEAD,
});

// ---- spawn data ----------------------------------------------------------------

export type MassDriverEnemyKind = 'drone' | 'lance' | 'sentry' | 'bolt' | 'interlock';

export type MassDriverSpawnData =
  | {
    role: 'drone';
    engagement: RailLead;
    angle: number;
    spin: number;
    radiusFrom: number;
    radiusTo: number;
    phase: number;
  }
  | {
    role: 'lance';
    engagement: RailLead;
    fromAngle: number;
    toAngle: number;
    radius: number;
    crossTime: number;
    phase: number;
  }
  | {
    role: 'sentry';
    engagement: RailLead;
    angle: number;
    radiusFrom: number;
    radiusTo: number;
    firstShot: number;
    shotInterval: number;
    phase: number;
  }
  | { role: 'bolt'; position: Vector3; velocity: Vector3; lastAge: number; impact: HostileShotImpactState }
  | { role: 'interlock'; socket: number };

export type MassDriverSpawnEntry = LockOnSpawnEntry<MassDriverEnemyKind, MassDriverSpawnData>;
export type MassDriverUpdate = LockOnEnemyUpdate<MassDriverEnemyKind, MassDriverSpawnData>;

// ---- spawn timeline -------------------------------------------------------------
// Angles are authored in turns (0 = screen right, 0.25 = up) so a wave reads as
// a clock face. Formations are built around the bore, never through its middle.

const STEP = MASS_DRIVER_TIME.stepSeconds;

type DroneOptions = {
  spin?: number;
  lead?: number;
  stagger?: number;
  radiusFrom?: number;
  radiusTo?: number;
};

const drones = (at: number, turns: readonly number[], options: DroneOptions = {}): MassDriverSpawnEntry[] =>
  turns.map((turn, index) => {
    const time = at + index * (options.stagger ?? STEP);
    return {
      time,
      kind: 'drone',
      data: {
        role: 'drone',
        engagement: pacer.resolve(time, options.lead ?? DRONE_LEAD),
        angle: turn * TAU,
        spin: options.spin ?? 0.34,
        radiusFrom: options.radiusFrom ?? TARGET_MAX_RADIUS,
        radiusTo: options.radiusTo ?? 2.4,
        phase: index * 1.73 + at * 0.7,
      },
    };
  });

type LanceRun = { from: number; to: number; radius?: number };

const lances = (
  at: number,
  runs: readonly LanceRun[],
  options: { stagger?: number; lead?: number; crossTime?: number } = {},
): MassDriverSpawnEntry[] =>
  runs.map((run, index) => {
    const time = at + index * (options.stagger ?? STEP * 2);
    return {
      time,
      kind: 'lance',
      data: {
        role: 'lance',
        engagement: pacer.resolve(time, options.lead ?? LANCE_LEAD),
        fromAngle: run.from * TAU,
        toAngle: run.to * TAU,
        radius: run.radius ?? 11.8,
        crossTime: options.crossTime ?? 1.5,
        phase: index * 2.11 + at * 0.4,
      },
    };
  });

const sentries = (
  at: number,
  turns: readonly number[],
  options: { stagger?: number; lead?: number; shotInterval?: number } = {},
): MassDriverSpawnEntry[] =>
  turns.map((turn, index) => {
    const time = at + index * (options.stagger ?? STEP * 3);
    return {
      time,
      kind: 'sentry',
      hitPoints: 2,
      data: {
        role: 'sentry',
        engagement: pacer.resolve(time, options.lead ?? SENTRY_LEAD),
        angle: turn * TAU,
        radiusFrom: 12.0,
        radiusTo: 2.4,
        firstShot: 1.15,
        shotInterval: options.shotInterval ?? 1.5,
        phase: index * 3.07 + at,
      },
    };
  });

const interlocks = (at: number, sockets: readonly number[]): MassDriverSpawnEntry[] =>
  sockets.map((socket, index) => ({
    time: at + index * STEP * 2,
    kind: 'interlock',
    // Armour shell, then the fault core underneath.
    hitStages: [2, 2],
    data: { role: 'interlock', socket },
  }));

const RING_6 = [0, 1 / 6, 2 / 6, 3 / 6, 4 / 6, 5 / 6] as const;
const UPPER_ARC = [0.09, 0.25, 0.41] as const;
const LOWER_ARC = [0.59, 0.75, 0.91] as const;
const FLANKS = [0.0, 0.5] as const;

function buildTimeline(): MassDriverSpawnEntry[] {
  return sortTimeline<MassDriverEnemyKind, MassDriverSpawnData>([
    // --- Cold barrel: the sweep is taught as a shape, not a stream.
    ...drones(bar(2), UPPER_ARC, { spin: 0.3, stagger: STEP * 2 }),
    ...drones(bar(3, 2), LOWER_ARC, { spin: -0.3, stagger: STEP * 2 }),
    ...lances(bar(4, 2), [{ from: 0.02, to: 0.44 }, { from: 0.52, to: 0.94 }]),
    ...drones(bar(5), [0.14, 0.36, 0.64, 0.86], { spin: 0.36 }),
    ...drones(bar(6), RING_6, { spin: 0.28 }), // first full wheel: the signature sweep
    ...sentries(bar(7), [0.25]),
    ...lances(bar(7, 2), [{ from: 0.3, to: 0.8 }]),

    // --- Drive: two-bar cadence, armour arrives, the bore starts filling.
    ...drones(bar(8), [0.05, 0.2, 0.35, 0.65, 0.8, 0.95], { spin: 0.32 }),
    ...lances(bar(9), [{ from: 0.98, to: 0.56 }, { from: 0.46, to: 0.04 }]),
    ...drones(bar(10), RING_6, { spin: -0.34 }),
    ...sentries(bar(11), FLANKS, { stagger: STEP * 4 }),
    ...drones(bar(11, 2), [0.22, 0.28, 0.72, 0.78], { spin: 0.4, radiusFrom: 9.4 }),
    ...lances(bar(12), [{ from: 0.12, to: 0.62 }, { from: 0.88, to: 0.38 }, { from: 0.25, to: 0.75 }], { stagger: STEP * 3 }),
    ...drones(bar(13), [0.0, 0.17, 0.33, 0.5, 0.67, 0.83], { spin: 0.44 }),

    // --- Arc phase: the barrel is hot. Wheels inside wheels, crossfire.
    ...drones(bar(14), RING_6, { spin: 0.5, radiusTo: 3.0 }),
    ...lances(bar(15), [{ from: 0.06, to: 0.56 }, { from: 0.94, to: 0.44 }], { stagger: STEP * 2 }),
    ...sentries(bar(15, 2), [0.15, 0.85], { stagger: STEP * 4 }),
    ...drones(bar(16), [0.1, 0.23, 0.4, 0.6, 0.77, 0.9], { spin: -0.42 }),
    ...lances(bar(17), [{ from: 0.3, to: 0.7, radius: 11.2 }, { from: 0.7, to: 0.3, radius: 8.4 }], { stagger: STEP * 2 }),
    ...drones(bar(17, 2), [0.02, 0.48, 0.52, 0.98], { spin: 0.5, radiusFrom: 10.6 }),
    ...sentries(bar(18), [0.5]),
    ...drones(bar(18, 2), RING_6, { spin: 0.38 }),
    ...lances(bar(19), [{ from: 0.16, to: 0.66 }, { from: 0.84, to: 0.34 }, { from: 0.5, to: 0.0 }], { stagger: STEP * 2 }),

    // --- Fault: the interlock cage. Drones keep the pressure on between clamps.
    ...interlocks(bar(20), [0, 2, 4]),
    ...drones(bar(21, 2), [0.14, 0.86], { spin: 0.3, radiusFrom: 9.0, radiusTo: 2.6 }),
    ...lances(bar(22, 2), [{ from: 0.25, to: 0.75, radius: 7.4 }]),
    ...interlocks(bar(23), [1, 3, 5]),

    // --- Charge: the last window to blow the clamps.
    ...drones(bar(24, 2), [0.33, 0.67], { spin: -0.3, radiusFrom: 8.6, radiusTo: 2.4 }),
    ...sentries(bar(25, 2), [0.75], { lead: 2.6 }),
    ...drones(bar(26, 2), [0.06, 0.44, 0.56, 0.94], { spin: 0.34, radiusFrom: 9.2, radiusTo: 2.6 }),
    ...lances(bar(27, 2), [{ from: 0.4, to: 0.9, radius: 8.0 }]),
  ]);
}

export const MASS_DRIVER_TIMELINE: MassDriverSpawnEntry[] = buildTimeline();

const KILL_SCORE: Record<MassDriverEnemyKind, number> = {
  drone: 110,
  lance: 150,
  sentry: 240,
  bolt: 70,
  interlock: 620,
};

const BOLT_MAX_AGE = 9;

// ---- level ---------------------------------------------------------------------

export function createMassDriverGameplay(bus: EventBus): LockOnRunnerLevel<MassDriverEnemyKind, MassDriverSpawnData> {
  const interlockIds = new Set<number>();
  const interceptions = new Set<number>();
  let interlocksKilled = 0;
  let interlocksSpawned = 0;
  let hitsTaken = 0;
  let boltsDowned = 0;
  let launched = false;

  bus.on('runstart', () => {
    interlockIds.clear();
    interceptions.clear();
    interlocksKilled = 0;
    interlocksSpawned = 0;
    hitsTaken = 0;
    boltsDowned = 0;
    launched = false;
  });

  bus.on('spawn', ({ enemyId, kind }) => {
    if (kind !== 'interlock') return;
    interlockIds.add(enemyId);
    interlocksSpawned += 1;
    if (interlocksSpawned === 1) bus.emit('bossphase', { phase: 'summoned' });
  });

  bus.on('playerhit', () => {
    hitsTaken += 1;
  });

  bus.on('fire', ({ enemyId }) => {
    interceptions.add(enemyId);
  });

  bus.on('miss', ({ enemyId }) => {
    interceptions.delete(enemyId);
    interlockIds.delete(enemyId);
  });

  bus.on('kill', ({ enemyId }) => {
    interceptions.delete(enemyId);
    if (!interlockIds.delete(enemyId)) return;
    interlocksKilled += 1;
    if (interlocksKilled === 3) bus.emit('bossphase', { phase: 'exposed' });
    if (interlocksKilled === INTERLOCK_COUNT) {
      launched = true;
      bus.emit('bossphase', { phase: 'destroyed' });
    }
  });

  const offset = new Vector3();
  const aheadOffset = new Vector3();

  const borePoint = (angle: number, radius: number, z = 0) =>
    offset.set(Math.cos(angle) * radius * BORE_X_SCALE, Math.sin(angle) * radius, z);

  function fireBolt(context: MassDriverUpdate, from: Vector3) {
    const velocity = hostileShotAimPoint(context.camera, from).sub(from).normalize().multiplyScalar(8);
    context.spawnEnemy({
      time: context.runTime,
      kind: 'bolt',
      countsTowardTotal: false,
      data: { role: 'bolt', position: from.clone(), velocity, lastAge: 0, impact: {} },
    });
  }

  // ---- motion -------------------------------------------------------------------

  // Drones ride the field lines: they orbit the bore and are dragged toward the
  // axis as the accelerator grips them, so the wheel tightens as it closes.
  function updateDrone(context: MassDriverUpdate, data: Extract<MassDriverSpawnData, { role: 'drone' }>) {
    const { enemy, runTime, age, curve, camera } = context;
    const paced = pacer.sample(enemy.entry.time, runTime, data.engagement);
    const progress = MathUtils.clamp(age / Math.max(0.001, data.engagement.windowSeconds), 0, 1);
    // Radius collapses toward the axis as the field takes hold, which is also
    // what keeps a target inside the frame all the way to the overtake.
    const radius = MathUtils.lerp(data.radiusFrom, data.radiusTo, progress)
      + Math.sin(age * 5.2 + data.phase) * 0.42 * (1 - progress);
    const angle = data.angle + data.spin * age + Math.sin(age * 2.1 + data.phase) * 0.05;
    enemy.mesh.position.copy(offsetFromRail(curve, paced.anchorU, borePoint(angle, radius)));
    enemy.mesh.quaternion.copy(camera.quaternion);
    // Hull banks along its own orbit; a wheel of drones reads as one machine.
    enemy.mesh.rotateZ(angle + Math.PI / 2);
    enemy.mesh.rotateY(Math.sin(age * 3.1 + data.phase) * 0.35);
    return runTime > paced.passTime + MISS_GRACE;
  }

  // Lances cut a straight chord across the bore, nose first, and leave the far
  // side. They never linger; they are the level's reaction test.
  function updateLance(context: MassDriverUpdate, data: Extract<MassDriverSpawnData, { role: 'lance' }>) {
    const { enemy, runTime, age, curve } = context;
    const paced = pacer.sample(enemy.entry.time, runTime, data.engagement);
    const travel = MathUtils.clamp(age / data.crossTime, -0.1, 1.1);
    const fromX = Math.cos(data.fromAngle) * data.radius;
    const fromY = Math.sin(data.fromAngle) * data.radius;
    const toX = Math.cos(data.toAngle) * data.radius;
    const toY = Math.sin(data.toAngle) * data.radius;
    const wobble = Math.sin(age * 9 + data.phase) * 0.35;
    // The far half of the chord bends inward: the bore field bites, and the exit
    // stays inside the frame instead of sliding off the edge.
    const taper = 1 - 0.62 * MathUtils.clamp((travel - 0.4) / 0.6, 0, 1);
    offset.set(
      MathUtils.lerp(fromX, toX, travel) * BORE_X_SCALE * taper,
      MathUtils.lerp(fromY, toY, travel) * taper + wobble,
      0,
    );
    enemy.mesh.position.copy(offsetFromRail(curve, paced.anchorU, offset));
    const nextTravel = Math.min(1.2, travel + 0.05);
    const nextTaper = 1 - 0.62 * MathUtils.clamp((nextTravel - 0.4) / 0.6, 0, 1);
    aheadOffset.set(
      MathUtils.lerp(fromX, toX, nextTravel) * BORE_X_SCALE * nextTaper,
      MathUtils.lerp(fromY, toY, nextTravel) * nextTaper,
      -1.2,
    );
    enemy.mesh.lookAt(offsetFromRail(curve, paced.anchorU, aheadOffset));
    enemy.mesh.rotateZ(age * 7.5 + data.phase);
    return travel >= 1.08 || runTime > paced.passTime + MISS_GRACE;
  }

  // Sentries are the slow menace: armoured blisters that creep off the bore wall,
  // rear back, and spit a homing bolt down the axis.
  function updateSentry(context: MassDriverUpdate, data: Extract<MassDriverSpawnData, { role: 'sentry' }>) {
    const { enemy, runTime, age, curve, camera } = context;
    const paced = pacer.sample(enemy.entry.time, runTime, data.engagement);
    const progress = MathUtils.clamp(age / Math.max(0.001, data.engagement.windowSeconds), 0, 1);
    const radius = MathUtils.lerp(data.radiusFrom, data.radiusTo, progress)
      + Math.sin(age * 1.6 + data.phase) * 0.7 * (1 - progress);
    const angle = data.angle + Math.sin(age * 0.75 + data.phase) * 0.16;

    const gun = context.enemyState(() => ({ nextAt: data.firstShot }));
    const untilShot = gun.nextAt - age;
    // Telegraph: settle back, then punch forward on the shot.
    const lunge = untilShot < 0.55 && untilShot > 0.1
      ? (0.55 - untilShot) * 5
      : untilShot <= 0.1 && untilShot > -0.25
        ? -8 * (0.1 - untilShot)
        : 0;
    enemy.mesh.position.copy(offsetFromRail(curve, paced.anchorU, borePoint(angle, radius, lunge)));
    if (age >= gun.nextAt) {
      gun.nextAt = age + data.shotInterval;
      fireBolt(context, enemy.mesh.position);
    }
    enemy.mesh.quaternion.copy(camera.quaternion);
    enemy.mesh.rotateZ(angle - Math.PI / 2 + Math.sin(age * 1.1 + data.phase) * 0.2);
    return runTime > paced.passTime + MISS_GRACE;
  }

  function updateBolt(context: MassDriverUpdate, data: Extract<MassDriverSpawnData, { role: 'bolt' }>) {
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
      config: { hitDistance: 2.6, impactBrake: 0.34, damageDistance: 0.7 },
    });
    if (impact.phase === 'braking') {
      enemy.mesh.position.copy(data.position);
      enemy.mesh.quaternion.copy(camera.quaternion);
      enemy.mesh.rotateZ(age * 14);
      if (impact.damaged) {
        damagePlayer(1);
        return true;
      }
      return false;
    }

    steerHomingShot(data.position, data.velocity, hostileShotAimPoint(camera, data.position), age, dt, {
      baseSpeed: 9,
      maxSpeed: 21,
      accel: 5.5,
      turnRate: 2.6,
    });
    enemy.mesh.position.copy(data.position);
    enemy.mesh.lookAt(data.position.clone().add(data.velocity));
    return age > BOLT_MAX_AGE || shotBehindCamera(camera, data.position);
  }

  // Interlocks are clamped to the bore and driven by the same field as the
  // payload, so they hold station ahead of it: a wheel of six that has to be
  // taken apart before the charge peaks.
  function updateInterlock(context: MassDriverUpdate, data: Extract<MassDriverSpawnData, { role: 'interlock' }>) {
    const { enemy, runTime, runProgress, curve, camera, damagePlayer } = context;
    const anchorU = MathUtils.clamp(runProgress + INTERLOCK_HOLD_UNITS / MASS_DRIVER_RAIL_UNITS, 0, 1);
    const angle = data.socket * (TAU / INTERLOCK_COUNT) + (runTime - FAULT_TIME) * INTERLOCK_SPIN;
    const cracked = enemy.hitStageIndex > 0;
    const radius = INTERLOCK_RADIUS
      + Math.sin(runTime * 1.7 + data.socket * 1.4) * 0.55
      - (cracked ? 0.9 : 0);
    enemy.mesh.position.copy(offsetFromRail(curve, anchorU, borePoint(angle, radius)));
    enemy.mesh.quaternion.copy(camera.quaternion);
    enemy.mesh.rotateZ(angle - Math.PI / 2);
    if (cracked) {
      // Armour gone: the fault core rattles in its mount.
      enemy.mesh.position.x += Math.sin(runTime * 33 + data.socket) * 0.2;
      enemy.mesh.position.y += Math.cos(runTime * 27 + data.socket) * 0.18;
    }

    // Charge peak with a clamp still jammed: the barrel has nowhere to vent.
    if (runTime >= LAUNCH_TIME) {
      damagePlayer(BARREL_BLAST_DAMAGE);
      return true;
    }
    return false;
  }

  return {
    duration: MASS_DRIVER_DURATION,
    bpm: MASS_DRIVER_BPM,
    playerHealth: MASS_DRIVER_PLAYER_HEALTH,
    createRail: createMassDriverRail,
    spawnTimeline: MASS_DRIVER_TIMELINE,
    easeRunProgress: massDriverRunProgress,
    startWord: 'CHARGE',
    replayWord: 'RELOAD',
    lockRadiusNdc: 0.095,
    // A locked pulse wants tight volleys: cap the coarsest snap at one beat and
    // grow shot gaps by a single 32nd so a six-lock release fans out inside a bar.
    timing: {
      shotDelay: { maxGridSeconds: 0.48, gridRampGapGrowthThirtyseconds: 1, releaseShare: 0.6 },
      actionSfx: { enabled: true, gridThirtyseconds: 1 },
    },
    updateCameraEffects({ camera, runTime }) {
      // Rifling. A slow oscillating roll through the barrel that runs away into a
      // real spin once the gun fires and there is nothing left to aim at. Pure
      // function of run time, so it never accumulates drift across a run.
      const spin = Math.max(0, runTime - LAUNCH_TIME);
      camera.rotateZ(Math.sin(runTime * 0.24) * 0.075 + spin * spin * 0.42);
    },
    updateAttractCamera({ camera, curve, modeTime }) {
      // Sitting in the breech, the payload still settling on its cradle.
      const base = curve.getPointAt(0);
      const look = curve.getPointAt(0.018);
      camera.position.copy(base);
      camera.position.x += Math.sin(modeTime * 0.47) * 0.9;
      camera.position.y += Math.cos(modeTime * 0.39) * 0.7;
      camera.lookAt(look);
      camera.rotateZ(Math.sin(modeTime * 0.21) * 0.05);
    },
    updateEnemy(context) {
      const data = context.enemy.entry.data;
      switch (data.role) {
        case 'drone':
          return updateDrone(context, data);
        case 'lance':
          return updateLance(context, data);
        case 'sentry':
          return updateSentry(context, data);
        case 'bolt':
          return updateBolt(context, data);
        case 'interlock':
          return updateInterlock(context, data);
      }
    },
    scoreForKill(volleySize, enemy) {
      if (enemy.kind === 'bolt') boltsDowned += 1;
      const multiplier = 1 + Math.max(0, volleySize - 1) * 0.16;
      return Math.round(KILL_SCORE[enemy.kind] * multiplier);
    },
    scoreForHit: () => 55,
    scoreForVolley(results) {
      // Sweeping the whole wheel and dropping every target is the level's play.
      if (results.length < 4) return 0;
      if (!results.every((result) => result.killed)) return 0;
      return results.length === 6 ? 640 : results.length * 80;
    },
    rankForRun(score, kills, totalEnemies) {
      const clearRate = totalEnemies === 0 ? 0 : kills / totalEnemies;
      if (launched && score >= 15500 && clearRate >= 0.85) return 'S';
      if (launched && score >= 10000 && clearRate >= 0.6) return 'A';
      if (score >= 5800 && clearRate >= 0.4) return 'B';
      if (score >= 2500 && clearRate >= 0.2) return 'C';
      return 'D';
    },
    detailsForRun() {
      const hull = Math.max(0, MASS_DRIVER_PLAYER_HEALTH - hitsTaken);
      const lines = [`Hull ${hull}/${MASS_DRIVER_PLAYER_HEALTH}`];
      lines.push(`Interlocks ${interlocksKilled}/${INTERLOCK_COUNT}`);
      if (boltsDowned > 0) lines.push(`${boltsDowned} bolt${boltsDowned === 1 ? '' : 's'} intercepted`);
      lines.push(launched ? 'Muzzle exit clean' : 'Barrel overload');
      return lines;
    },
  };
}
