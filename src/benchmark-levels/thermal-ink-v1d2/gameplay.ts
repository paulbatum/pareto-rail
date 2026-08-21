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
import { createSpeedProfile } from '../../engine/speed-profile';
import type { EventBus } from '../../events';
import { ARM_HIT_POINTS, createOctopus } from './octopus';
import {
  BLACKOUT_TIME,
  CORE_FORCE_TIME,
  ENGAGE_TIME,
  ENRAGE_TIME,
  THERMAL_INK_V1D2_BPM,
  THERMAL_INK_V1D2_DURATION,
  THERMAL_INK_V1D2_TIME,
  bar,
} from './timing';

// THERMAL INK — sixty seconds inside one continuous boss fight against a giant
// mutant octopus in a drowned industrial harbor. The rail circles its lair,
// dives beneath its hanging arms, and skims collapsing steel while the creature
// turns to keep you in reach. It fights with ink: dense black clouds swallow
// normal sight, the suit's thermal sensors cut in, and the fight becomes a
// charcoal display of white-hot silhouettes and red signal cores.
//
//   Descent (bars 0–4)    Harbor murk. Scavengers probe. The octopus waits.
//   Engage  (bar 4)       First ink blast. Six arms unlock. It turns to hunt.
//   Hunt    (bars 6–12)   Skiffs, hatchlings and buoy-mines over the wrecks.
//   Dive    (bars 12–16)  The rail plunges beneath the hanging arms.
//   Enrage  (bars 16–20)  Blackout ink. Spawn pressure peaks.
//   Exposed (bar 20)      Arms broken, the mantle burns open: red core.
//   Blackout(22.5)        The final ink wall. Last volley lands in the dark.

export {
  BLACKOUT_TIME,
  CORE_FORCE_TIME,
  DIVE_TIME,
  ENGAGE_TIME,
  ENRAGE_TIME,
  EXPOSED_TIME,
  THERMAL_INK_V1D2_BPM,
  THERMAL_INK_V1D2_DURATION,
  bar,
} from './timing';

export const THERMAL_INK_V1D2_PLAYER_HEALTH = 4;

// ---- shared ink state -------------------------------------------------------
// Ink-cloud enemies report their coverage of the camera every frame; visuals
// smooth `level` toward the target and own `thermal`. Audio reads `thermal`
// to drop the drums and brighten the melody while the display is infrared.

export const inkState = {
  /** Smoothed ink coverage of the camera, 0..1. Written by visuals. */
  level: 0,
  /** True while the thermal display is engaged. Written by visuals. */
  thermal: false,
  /** Scripted final blackout: thermal stays on until the boss dies. */
  blackout: false,
  bossDead: false,
};

const inkFrame = { runTime: -1, sum: 0 };

/** Ink clouds call this every frame with how much they swallow the camera. */
export function reportInk(runTime: number, amount: number) {
  if (inkFrame.runTime !== runTime) {
    inkFrame.runTime = runTime;
    inkFrame.sum = 0;
  }
  inkFrame.sum = Math.min(1.35, inkFrame.sum + amount);
}

/** Freshness-checked ink target for this frame; 0 when no cloud reported. */
export function inkTarget(runTime: number) {
  if (inkState.bossDead) return 0;
  if (inkState.blackout) return 1;
  return inkFrame.runTime === runTime ? Math.min(1, inkFrame.sum) : 0;
}

// ---- kinds & per-enemy data -------------------------------------------------

export type ThermalInkV1d2EnemyKind =
  | 'drifter'
  | 'hatchling'
  | 'buoy'
  | 'arm'
  | 'core'
  | 'gob'
  | 'inkcloud';

export type ThermalInkV1d2SpawnData =
  | { role: 'drifter'; lead: number; fromX: number; toX: number; y: number; arc: number; crossTime: number; delay: number }
  | { role: 'hatchling'; lead: number; offset: Vector3; seed: number }
  | { role: 'buoy'; leadStart: number; leadEnd: number; closeTime: number; offset: Vector3 }
  | { role: 'arm'; socket: number }
  | { role: 'core' }
  | { role: 'gob'; position: Vector3; velocity: Vector3; lastAge: number; impact: HostileShotImpactState }
  | { role: 'ink'; lead: number; offset: Vector3; radius: number; seed: number };

export type ThermalInkV1d2SpawnEntry = LockOnSpawnEntry<ThermalInkV1d2EnemyKind, ThermalInkV1d2SpawnData>;
export type ThermalInkV1d2Update = LockOnEnemyUpdate<ThermalInkV1d2EnemyKind, ThermalInkV1d2SpawnData>;

// ---- speed profile → rail easing --------------------------------------------

const SPEED_KEYS: Array<[number, number]> = [
  [bar(0), 0.62],
  [bar(2), 0.78],
  [bar(4), 0.92],
  [bar(6), 1.0],
  [bar(11), 1.02],
  [bar(12), 1.28], // the dive kick
  [bar(13, 2), 0.95],
  [bar(16), 1.12],
  [bar(18), 1.0],
  [bar(20), 0.88], // closing on the exposed core
  [bar(22, 2), 0.82], // final blackout crawl
  [bar(24), 1.15],
];

const speedProfile = createSpeedProfile(SPEED_KEYS, THERMAL_INK_V1D2_DURATION);

export const speedFactorAt = speedProfile.speedAt;

export function thermalInkV1d2RunProgress(time: number, duration = THERMAL_INK_V1D2_DURATION) {
  return speedProfile.runProgress(time, duration);
}

/** Rail parameter the camera occupies at run time `t` — for placing set pieces. */
export const railU = (time: number) => thermalInkV1d2RunProgress(time);

// ---- rail -------------------------------------------------------------------

// A flooded harbor run: start above the wreck line, S-turn through the hull
// field, plunge beneath the octopus's hanging arms (bars 12–17), then climb
// back into the lamp light for the core standoff.
export function createThermalInkV1d2Rail() {
  return new CatmullRomCurve3(
    [
      new Vector3(0, 7, 0),
      new Vector3(-7, 5, -80),
      new Vector3(9, 3, -165),
      new Vector3(-11, 2, -250),
      new Vector3(13, 0, -335),
      new Vector3(-14, -2, -420),
      new Vector3(10, -6, -505),
      new Vector3(-8, -14, -590),
      new Vector3(6, -17, -675),
      new Vector3(-6, -13, -760),
      new Vector3(9, -6, -845),
      new Vector3(-12, 1, -930),
      new Vector3(14, 4, -1015),
      new Vector3(-9, 6, -1100),
      new Vector3(4, 4, -1185),
      new Vector3(-4, 2, -1270),
      new Vector3(0, 3, -1355),
    ],
    false,
    'catmullrom',
    0.4,
  );
}

// ---- spawn timeline ---------------------------------------------------------

const drifters = (
  time: number,
  runs: Array<{ fromX: number; toX: number; y: number; arc: number; delay?: number; crossTime?: number }>,
): ThermalInkV1d2SpawnEntry[] =>
  runs.map((run, index) => ({
    time: time + index * 0.12,
    kind: 'drifter',
    data: {
      role: 'drifter',
      lead: 3.9,
      fromX: run.fromX,
      toX: run.toX,
      y: run.y,
      arc: run.arc,
      delay: run.delay ?? index * 0.4,
      crossTime: run.crossTime ?? 2.7,
    },
  }));

const hatchlings = (time: number, offsets: Array<[number, number]>, lead = 4.3): ThermalInkV1d2SpawnEntry[] =>
  offsets.map((offset, index) => ({
    time: time + index * 0.18,
    kind: 'hatchling',
    data: { role: 'hatchling', lead, offset: new Vector3(offset[0], offset[1], 0), seed: index * 2.61 + time },
  }));

const buoys = (time: number, offsets: Array<[number, number]>): ThermalInkV1d2SpawnEntry[] =>
  offsets.map((offset, index) => ({
    time: time + index * 0.3,
    kind: 'buoy',
    hitStages: [2],
    data: {
      role: 'buoy',
      leadStart: 7.2,
      leadEnd: 3.4,
      closeTime: 7,
      offset: new Vector3(offset[0], offset[1], 0),
    },
  }));

const inkCloud = (time: number, lead: number, offset: [number, number], radius: number): ThermalInkV1d2SpawnEntry => ({
  time,
  kind: 'inkcloud',
  lockable: false,
  countsTowardTotal: false,
  data: { role: 'ink', lead, offset: new Vector3(offset[0], offset[1], 0), radius, seed: time },
});

function buildTimeline(armEntries: ThermalInkV1d2SpawnEntry[], coreEntry: ThermalInkV1d2SpawnEntry): ThermalInkV1d2SpawnEntry[] {
  return [
    coreEntry,
    ...armEntries,

    // --- Descent: scavengers probe while the octopus watches. ---
    ...drifters(bar(0, 2), [
      { fromX: -20, toX: 20, y: 2, arc: 2.2 },
      { fromX: 20, toX: -20, y: 4, arc: 1.6, delay: 0.5 },
    ]),
    ...drifters(bar(1), [
      { fromX: -24, toX: 24, y: 2.5, arc: 2 },
      { fromX: 24, toX: -24, y: 0.4, arc: 3, delay: 0.42 },
      { fromX: -24, toX: 24, y: 4.4, arc: 1.4, delay: 0.84 },
    ]),
    ...drifters(bar(2, 2), [
      { fromX: -26, toX: 26, y: 1.2, arc: 2.6 },
      { fromX: 26, toX: -26, y: 3.6, arc: 1.8, delay: 0.5 },
    ]),
    ...hatchlings(bar(3, 2), [[3.5, 2.6]]),

    // --- Engage: the first ink wall, and the arms come alive. ---
    inkCloud(bar(4), 3.2, [-2.5, 1.5], 13),
    inkCloud(bar(4), 3.8, [5, -1], 11),
    ...hatchlings(bar(4, 2), [[-5.5, 3.4], [5.5, 3.4]]),

    // --- Hunt: waves over the wreck field, choreographed to the bounce. ---
    ...drifters(bar(5), [
      { fromX: -24, toX: 24, y: -0.6, arc: 3.2 },
      { fromX: 24, toX: -24, y: 1.8, arc: 2.4 },
      { fromX: -24, toX: 24, y: 4.2, arc: 1.6 },
      { fromX: 24, toX: -24, y: 5.4, arc: 1, delay: 1.1 },
    ]),
    ...buoys(bar(6), [[0, 2.8]]),
    ...hatchlings(bar(7), [[-6, 4.2], [6, 4.2]]),
    inkCloud(bar(8), 3.4, [3, 0.5], 12),
    ...drifters(bar(8, 2), [
      { fromX: -22, toX: 22, y: 0.8, arc: 2.2 },
      { fromX: 22, toX: -22, y: 3, arc: 2.6 },
      { fromX: -22, toX: 22, y: 5, arc: 1.4 },
    ]),
    ...buoys(bar(9), [[-5.5, 1.4], [5.5, 1.4]]),
    ...drifters(bar(10), [
      { fromX: -25, toX: 25, y: 0.4, arc: 3.4, delay: 0 },
      { fromX: 25, toX: -25, y: 2.2, arc: 2.8, delay: 0.28 },
      { fromX: -25, toX: 25, y: 4, arc: 2.2, delay: 0.56 },
      { fromX: 25, toX: -25, y: 5.6, arc: 1.6, delay: 0.84 },
      { fromX: -25, toX: 25, y: 1.4, arc: 3, delay: 1.12 },
    ]),
    ...hatchlings(bar(11), [[-4.5, 0.8], [0, 5.2], [4.5, 0.8]]),

    // --- Dive: the rail plunges; the ink follows you down. ---
    inkCloud(bar(12), 3.0, [0, -1.5], 14),
    ...drifters(bar(12, 2), [
      { fromX: -20, toX: 20, y: -1.5, arc: 2, crossTime: 2.3 },
      { fromX: 20, toX: -20, y: 0.5, arc: 2.4, crossTime: 2.3 },
    ]),
    ...buoys(bar(13), [[-4.5, 2.2], [4.5, 2.2]]),
    ...hatchlings(bar(14), [[-5.5, 4], [5.5, 4]]),
    ...drifters(bar(14, 2), [
      { fromX: -22, toX: 22, y: -0.5, arc: 2.6, crossTime: 2.3 },
      { fromX: 22, toX: -22, y: 2, arc: 2, crossTime: 2.3 },
    ]),
    ...drifters(bar(15), [
      { fromX: -24, toX: 24, y: 0, arc: 3, delay: 0 },
      { fromX: -24, toX: 24, y: 1.8, arc: 2.6, delay: 0.3 },
      { fromX: -24, toX: 24, y: 3.6, arc: 2.2, delay: 0.6 },
      { fromX: 24, toX: -24, y: 2.4, arc: 2.8, delay: 0.9 },
      { fromX: 24, toX: -24, y: 4.8, arc: 1.8, delay: 1.2 },
      { fromX: -24, toX: 24, y: 5.8, arc: 1.2, delay: 1.5 },
    ]),

    // --- Enrage: blackout, and the broken machinery pours spawn. ---
    inkCloud(bar(16), 3.2, [-4, 1], 13),
    inkCloud(bar(16), 3.8, [4.5, -1.5], 12),
    ...hatchlings(bar(16, 2), [[-6.5, 3], [-2, 5], [2, 5], [6.5, 3]]),
    ...buoys(bar(17), [[-5, 0.5], [0, 3.4], [5, 0.5]]),
    ...drifters(bar(17, 2), [
      { fromX: -22, toX: 22, y: 1, arc: 2.4, crossTime: 2.2 },
      { fromX: 22, toX: -22, y: 3.4, arc: 2, crossTime: 2.2 },
    ]),
    ...drifters(bar(18), [
      { fromX: -25, toX: 25, y: -0.4, arc: 3.2, delay: 0 },
      { fromX: 25, toX: -25, y: 1.4, arc: 2.8, delay: 0.24 },
      { fromX: -25, toX: 25, y: 3, arc: 2.4, delay: 0.48 },
      { fromX: 25, toX: -25, y: 4.6, arc: 2, delay: 0.72 },
      { fromX: -25, toX: 25, y: 5.8, arc: 1.4, delay: 0.96 },
    ]),
    ...hatchlings(bar(19), [[-5, 1.2], [5, 1.2], [0, 4.6]]),
    ...buoys(bar(19, 2), [[0, 1.8]]),

    // --- Exposed: the core burns open; pressure thins to escorts. ---
    ...hatchlings(bar(20, 2), [[-6, 2.4], [6, 2.4]]),
    ...drifters(bar(21), [
      { fromX: -22, toX: 22, y: 1.4, arc: 2.4 },
      { fromX: 22, toX: -22, y: 3.2, arc: 2 },
      { fromX: -22, toX: 22, y: 4.8, arc: 1.4 },
    ]),
    ...hatchlings(bar(22), [[-4, 3.6], [4, 3.6]]),

    // --- Blackout: no more spawns. The dark belongs to the last volley. ---
  ].sort((a, b) => a.time - b.time);
}

export function createThermalInkV1d2Timeline() {
  const octopusEntries = createOctopusEntries(ENGAGE_TIME);
  return {
    coreEntry: octopusEntries.coreEntry,
    timeline: buildTimeline(octopusEntries.armEntries, octopusEntries.coreEntry),
  };
}

export function createOctopusEntries(engageTime: number): { coreEntry: ThermalInkV1d2SpawnEntry; armEntries: ThermalInkV1d2SpawnEntry[] } {
  const coreEntry: ThermalInkV1d2SpawnEntry = {
    time: 0.5,
    kind: 'core',
    hitStages: [3, 3],
    lockable: false,
    data: { role: 'core' },
  };
  const armEntries: ThermalInkV1d2SpawnEntry[] = [0, 1, 2, 3, 4, 5].map((socket, index) => ({
    time: engageTime + 0.15 + index * 0.1,
    kind: 'arm',
    hitPoints: ARM_HIT_POINTS,
    data: { role: 'arm', socket },
  }));
  return { coreEntry, armEntries };
}

export const THERMAL_INK_V1D2_TIMELINE = createThermalInkV1d2Timeline().timeline;

// ---- tuning -----------------------------------------------------------------

const KILL_SCORE: Record<ThermalInkV1d2EnemyKind, number> = {
  drifter: 120,
  hatchling: 160,
  buoy: 300,
  gob: 40,
  arm: 350,
  core: 2000,
  inkcloud: 0,
};

const GOB_MAX_AGE = 6.5;

export function createThermalInkV1d2Gameplay(bus: EventBus): LockOnRunnerLevel<ThermalInkV1d2EnemyKind, ThermalInkV1d2SpawnData> {
  const { timeline } = createThermalInkV1d2Timeline();
  const interceptions = new Set<number>();
  let hitsTaken = 0;

  bus.on('runstart', () => {
    interceptions.clear();
    hitsTaken = 0;
    inkState.level = 0;
    inkState.thermal = false;
    inkState.blackout = false;
    inkState.bossDead = false;
    inkFrame.runTime = -1;
    inkFrame.sum = 0;
  });

  bus.on('playerhit', () => {
    hitsTaken += 1;
  });

  bus.on('fire', ({ enemyId }) => {
    interceptions.add(enemyId);
  });

  bus.on('kill', ({ enemyId }) => {
    interceptions.delete(enemyId);
  });

  bus.on('miss', ({ enemyId }) => {
    interceptions.delete(enemyId);
  });

  const octopus = createOctopus(bus, {
    coreForceTime: CORE_FORCE_TIME,
    setBlackout(value) {
      inkState.blackout = value;
    },
    enrageTime: ENRAGE_TIME,
    spawnInk(context, lead, offset, radius) {
      context.spawnEnemy({
        time: context.runTime,
        kind: 'inkcloud',
        lockable: false,
        countsTowardTotal: false,
        data: { role: 'ink', lead, offset: new Vector3(offset[0], offset[1], 0), radius, seed: context.runTime },
      });
    },
    spawnGob: fireGob,
  });

  function fireGob(context: ThermalInkV1d2Update, from: Vector3) {
    const initial = hostileShotAimPoint(context.camera, from).sub(from).normalize().multiplyScalar(4.5);
    context.spawnEnemy({
      time: context.runTime,
      kind: 'gob',
      countsTowardTotal: false,
      data: { role: 'gob', position: from.clone(), velocity: initial, lastAge: 0, impact: {} },
    });
  }

  // ---- movement -------------------------------------------------------------

  function updateDrifter(context: ThermalInkV1d2Update, data: Extract<ThermalInkV1d2SpawnData, { role: 'drifter' }>) {
    const { enemy, runProgress, age, curve, camera, railAnchor } = context;
    const anchorU = railAnchor(data.lead);
    const t = (age - data.delay) / data.crossTime;
    if (t > 1.15 || runProgress > anchorU + 0.012) return true;
    const clamped = MathUtils.clamp(t, 0, 1);
    const eased = clamped * clamped * (3 - 2 * clamped);
    const x = MathUtils.lerp(data.fromX, data.toX, eased);
    const y = data.y + Math.sin(clamped * Math.PI) * data.arc;
    enemy.mesh.position.copy(offsetFromRail(curve, anchorU, new Vector3(x, y, Math.sin(age * 3 + enemy.id) * 0.4)));
    const ahead = offsetFromRail(curve, anchorU, new Vector3(
      MathUtils.lerp(data.fromX, data.toX, Math.min(1, eased + 0.04)),
      data.y + Math.sin(Math.min(1, clamped + 0.04) * Math.PI) * data.arc,
      0,
    ));
    enemy.mesh.lookAt(ahead);
    enemy.mesh.rotateZ(Math.sin(age * 2.2 + enemy.id) * 0.25);
    void camera;
    return false;
  }

  function updateHatchling(context: ThermalInkV1d2Update, data: Extract<ThermalInkV1d2SpawnData, { role: 'hatchling' }>) {
    const { enemy, runProgress, age, curve, camera, railAnchor } = context;
    const anchorU = railAnchor(data.lead);
    if (runProgress > anchorU + 0.014) return true;
    const offset = data.offset.clone();
    offset.x += Math.sin(age * 1.2 + data.seed) * 2.2;
    offset.y += Math.sin(age * 1.8 + data.seed * 2.1) * 1.4;

    // Telegraphed hunt: rear back, jet forward, spit an ink gob.
    const fire = context.enemyState(() => ({ nextAt: 1.5 }));
    const untilShot = fire.nextAt - age;
    if (untilShot < 0.85 && untilShot > 0.5) offset.z += (0.85 - untilShot) * 7; // rear back
    else if (untilShot <= 0.5 && untilShot > 0) offset.z -= (0.5 - untilShot) * 12; // lunge in
    if (age >= fire.nextAt) {
      fire.nextAt = age + 3.4;
      fireGob(context, enemy.mesh.position);
    }

    enemy.mesh.position.copy(offsetFromRail(curve, anchorU, offset));
    enemy.mesh.quaternion.copy(camera.quaternion);
    enemy.mesh.rotateZ(Math.sin(age * 2 + data.seed) * 0.4);
    enemy.mesh.userData.age = age;
    return false;
  }

  function updateBuoy(context: ThermalInkV1d2Update, data: Extract<ThermalInkV1d2SpawnData, { role: 'buoy' }>) {
    const { enemy, runProgress, age, curve, camera, railAnchor } = context;
    const close = Math.min(1, age / data.closeTime);
    const lead = MathUtils.lerp(data.leadStart, data.leadEnd, close * close * (3 - 2 * close));
    const anchorU = railAnchor(lead);
    if (runProgress > anchorU + 0.014) return true;
    const offset = data.offset.clone();
    offset.x += Math.sin(age * 0.55 + enemy.id) * 1;
    offset.y += Math.sin(age * 0.8 + enemy.id * 2) * 0.7;
    enemy.mesh.position.copy(offsetFromRail(curve, anchorU, offset));
    enemy.mesh.quaternion.copy(camera.quaternion);
    enemy.mesh.rotateZ(age * 0.35);
    // Stripped shell (stage broken): the ember heart shudders naked.
    if (enemy.hitStageIndex > 0) {
      enemy.mesh.position.x += Math.sin(age * 20) * 0.12;
      enemy.mesh.position.y += Math.cos(age * 16) * 0.1;
    }
    return false;
  }

  function updateGob(context: ThermalInkV1d2Update, data: Extract<ThermalInkV1d2SpawnData, { role: 'gob' }>) {
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
    });
    if (impact.phase === 'braking') {
      enemy.mesh.position.copy(data.position);
      enemy.mesh.quaternion.copy(camera.quaternion);
      enemy.mesh.rotateZ(age * 6);
      if (impact.damaged) {
        damagePlayer(1);
        return true;
      }
      return false;
    }

    steerHomingShot(data.position, data.velocity, hostileShotAimPoint(camera, data.position), age, dt, {
      baseSpeed: 5,
      maxSpeed: 11.5,
      accel: 3,
      turnRate: 2.2,
    });
    enemy.mesh.position.copy(data.position);
    orientAlongVelocity(enemy.mesh.position, data.velocity, context);
    return age > GOB_MAX_AGE || shotBehindCamera(camera, data.position);
  }

  function updateInkCloud(context: ThermalInkV1d2Update, data: Extract<ThermalInkV1d2SpawnData, { role: 'ink' }>) {
    const { enemy, runProgress, age, curve, camera, railAnchor } = context;
    const anchorU = railAnchor(data.lead);
    if (runProgress > anchorU + 0.03) return true;
    const offset = data.offset.clone();
    // The cloud drifts across the route and breathes while you fly through it.
    offset.x += Math.sin(age * 0.4 + data.seed) * 2.2;
    offset.y += Math.sin(age * 0.3 + data.seed * 1.7) * 1.1;
    enemy.mesh.position.copy(offsetFromRail(curve, anchorU, offset));
    enemy.mesh.rotation.y = age * 0.14 + data.seed;
    const breathe = 1 + Math.sin(age * 0.9 + data.seed) * 0.07;
    enemy.mesh.scale.setScalar(data.radius / 10 * breathe);

    const distance = camera.position.distanceTo(enemy.mesh.position);
    const reach = data.radius * 1.25;
    reportInk(context.runTime, MathUtils.clamp(1 - distance / reach, 0, 1));
    return false;
  }

  function orientAlongVelocity(position: Vector3, velocity: Vector3, context: ThermalInkV1d2Update) {
    if (velocity.lengthSq() < 0.001) return;
    const target = position.clone().add(velocity);
    context.enemy.mesh.lookAt(target);
  }

  // ---- level definition ------------------------------------------------------

  return {
    duration: THERMAL_INK_V1D2_DURATION,
    bpm: THERMAL_INK_V1D2_BPM,
    playerHealth: THERMAL_INK_V1D2_PLAYER_HEALTH,
    createRail: createThermalInkV1d2Rail,
    spawnTimeline: timeline,
    easeRunProgress: thermalInkV1d2RunProgress,
    startWord: 'START',
    replayWord: 'REPLAY',
    updateEnemy(context) {
      const data = context.enemy.entry.data;
      switch (data.role) {
        case 'drifter':
          return updateDrifter(context, data);
        case 'hatchling':
          return updateHatchling(context, data);
        case 'buoy':
          return updateBuoy(context, data);
        case 'gob':
          return updateGob(context, data);
        case 'ink':
          return updateInkCloud(context, data);
        case 'arm':
          return octopus.updateArm(context, data);
        case 'core':
          return octopus.updateCore(context, data);
      }
    },
    scoreForKill(volleySize, enemy) {
      const multiplier = 1 + Math.max(0, volleySize - 1) * 0.18;
      return Math.round(KILL_SCORE[enemy.kind] * multiplier);
    },
    // Chipping buoys and the core pays a little.
    scoreForHit: () => 45,
    scoreForVolley(results) {
      // A full, perfect volley through the dark is the level's signature play.
      if (results.length < 4) return 0;
      if (!results.every((result) => result.killed)) return 0;
      return results.length === 6 ? 500 : results.length * 60;
    },
    rankForRun(score, kills, totalEnemies) {
      const clearRate = totalEnemies === 0 ? 0 : kills / totalEnemies;
      if (octopus.coreKilled() && score >= 15000 && clearRate >= 0.72) return 'S';
      if (score >= 10000 && clearRate >= 0.52) return 'A';
      if (score >= 6000 && clearRate >= 0.32) return 'B';
      if (score >= 2500 && clearRate >= 0.14) return 'C';
      return 'D';
    },
    detailsForRun() {
      const hull = Math.max(0, THERMAL_INK_V1D2_PLAYER_HEALTH - hitsTaken);
      const lines = [`Hull ${hull}/${THERMAL_INK_V1D2_PLAYER_HEALTH}`];
      const armsLine = octopus.armsSummaryLine();
      if (armsLine) lines.push(armsLine);
      lines.push(octopus.bossSummaryLine());
      return lines;
    },
  };
}
