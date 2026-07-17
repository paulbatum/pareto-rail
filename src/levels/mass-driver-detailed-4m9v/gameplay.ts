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
import { bar, INTERLOCK_TIME, MASS_DRIVER_BPM, MD_DURATION, SHOT_TIME } from './timing';

// MASS DRIVER — you are the payload chambered in an orbital railgun, riding
// the bore from breech to muzzle in exactly 60 seconds. One accelerator ring
// per quarter-note beat; the gun fires on the downbeat of bar 28 whether or
// not you are ready. Six safety interlocks jam across the bore at bar 20:
// clear all six before the charge peaks and the shot throws you into open
// space — fail, and the barrel detonates with you inside it.

export const MASS_DRIVER_PLAYER_HEALTH = 3;
export const BORE_RADIUS = 12;
export const INTERLOCK_COUNT = 6;

export type MassDriverEnemyKind = 'coil' | 'threader' | 'capacitor' | 'arc' | 'interlock';

// Timeline data is immutable — the runner reuses the timeline across runs.
// Per-enemy runtime state lives in enemyState bags; boss/run state lives in
// createMassDriverGameplay's closure; arcs get fresh data objects per launch.
export type MassDriverSpawnData =
  | { role: 'coil'; lead: number; clock: number; slide: number; fires?: boolean }
  | { role: 'threader'; lead: number; fromX: number; toX: number; y: number; arcY: number; helix: number; crossTime: number; delay: number }
  | { role: 'capacitor'; lead: number; x: number; y: number; phase: number }
  | { role: 'arc'; position: Vector3; velocity: Vector3; lastAge: number; impact: HostileShotImpactState }
  | { role: 'interlock'; clock: number; index: number; fires?: boolean };

export type MassDriverSpawnEntry = LockOnSpawnEntry<MassDriverEnemyKind, MassDriverSpawnData>;
export type MassDriverUpdate = LockOnEnemyUpdate<MassDriverEnemyKind, MassDriverSpawnData>;

// ---- speed profile → rail easing ------------------------------------------

// The gun only ever speeds up. Slow off the breech, a steady climb through the
// middle bars, a harder pull as the charge builds, then a ~3x surge on the
// bar-28 downbeat — THE SHOT — easing off only slightly in open space.
const SPEED_KEYS: Array<[number, number]> = [
  [bar(0), 0.34],
  [bar(4), 0.46],
  [bar(12), 0.68],
  [bar(20), 0.95],
  [bar(26), 1.22],
  [bar(28) - 0.06, 1.42],
  [bar(28) + 0.16, 4.35],
  [bar(30), 4.05],
  [bar(32), 3.8],
];

const speedProfile = createSpeedProfile(SPEED_KEYS, MD_DURATION);

export const speedFactorAt = speedProfile.speedAt;

export function massDriverRunProgress(time: number, duration = MD_DURATION) {
  return speedProfile.runProgress(time, duration);
}

/** Rail parameter the camera occupies at run time `t` — for placing set pieces. */
export const railU = (time: number) => massDriverRunProgress(time);

/** Rail parameter of the muzzle: where the camera is at the instant of the shot. */
export const MUZZLE_U = massDriverRunProgress(SHOT_TIME);

// ---- rail ------------------------------------------------------------------

// Deterministic: a long line running mostly straight down the bore with a
// gentle weave so the tunnel reads and enemies get parallax. The weave tapers
// to zero right at the muzzle so the exit is clean and straight; past the
// muzzle the line lifts gently upward into the black.
const RAIL_SPAN = 2000;
const RAIL_POINTS = 66;

export function createMassDriverRail() {
  const points: Vector3[] = [];
  for (let i = 0; i <= RAIL_POINTS; i += 1) {
    const u = i / RAIL_POINTS;
    const z = -u * RAIL_SPAN;
    if (u <= MUZZLE_U) {
      // Weave window: straight at the breech, full weave through the middle,
      // dead straight again just before the muzzle.
      const rampIn = MathUtils.smoothstep(u, 0.015, 0.1);
      const taperOut = 1 - MathUtils.smoothstep(u, MUZZLE_U - 0.08, MUZZLE_U - 0.01);
      const amp = rampIn * taperOut;
      points.push(new Vector3(
        Math.sin(u * Math.PI * 2 * 5.5) * 3.4 * amp,
        Math.sin(u * Math.PI * 2 * 3.5 + 1.3) * 2.3 * amp,
        z,
      ));
    } else {
      // Open space: straight, lifting gently upward (zero slope at the muzzle).
      const t = (u - MUZZLE_U) / (1 - MUZZLE_U);
      points.push(new Vector3(0, t * t * 52, z));
    }
  }
  return new CatmullRomCurve3(points, false, 'catmullrom', 0.5);
}

// ---- spawn timeline ---------------------------------------------------------

// Clock positions around the frame rim, in radians (12 o'clock = up).
const clockAngle = (hour: number) => Math.PI / 2 - (hour / 12) * Math.PI * 2;

const coilRank = (
  time: number,
  lead: number,
  hours: number[],
  options: { slide?: number; fires?: boolean[] } = {},
): MassDriverSpawnEntry[] =>
  hours.map((hour, index) => ({
    // Staggered a beat-fraction apart so a rank sweeps the whole rim.
    time: time + index * 0.234375, // half a beat at 128 BPM
    kind: 'coil',
    data: {
      role: 'coil',
      lead,
      clock: clockAngle(hour),
      slide: (options.slide ?? 0.14) * (index % 2 === 0 ? 1 : -1),
      fires: options.fires?.[index] ?? false,
    },
  }));

const threaders = (
  time: number,
  lead: number,
  runs: Array<{ fromX: number; toX: number; y: number; arcY: number; delay?: number; crossTime?: number }>,
): MassDriverSpawnEntry[] =>
  runs.map((run, index) => ({
    time: time + index * 0.12,
    kind: 'threader',
    data: {
      role: 'threader',
      lead,
      fromX: run.fromX,
      toX: run.toX,
      y: run.y,
      arcY: run.arcY,
      // Sign alternates within a wave so pairs read as counter-rotating
      // double helices.
      helix: index % 2 === 0 ? 7.5 : -7.5,
      crossTime: run.crossTime ?? 3.0,
      delay: run.delay ?? index * 0.47,
    },
  }));

const capacitors = (time: number, lead: number, slots: Array<[number, number]>): MassDriverSpawnEntry[] =>
  slots.map(([x, y], index) => ({
    time: time + index * 0.35,
    kind: 'capacitor',
    hitStages: [2, 2],
    data: { role: 'capacitor', lead, x, y, phase: index * 2.4 + time },
  }));

const interlockRank = (time: number, entries: Array<{ hour: number; index: number; fires?: boolean }>): MassDriverSpawnEntry[] =>
  entries.map((entry, i) => ({
    time: time + i * 0.2,
    kind: 'interlock',
    hitStages: [1, 2],
    data: { role: 'interlock', clock: clockAngle(entry.hour), index: entry.index, fires: entry.fires ?? false },
  }));

export function createMassDriverTimeline(): MassDriverSpawnEntry[] {
  return [
    // --- Injection (bars 0–4): the breech. The counter-rotating threader pair
    // is the double-helix reveal; a four-coil rank teaches the rim sweep.
    ...threaders(bar(0, 2), 4.6, [
      { fromX: -11, toX: 11, y: 1.5, arcY: 3.2, delay: 0 },
      { fromX: 11, toX: -11, y: 1.5, arcY: 3.2, delay: 0 },
    ]),
    ...coilRank(bar(2), 4.6, [12, 3, 6, 9]),
    ...threaders(bar(3), 4.4, [
      { fromX: -11, toX: 11, y: -3.5, arcY: 2.6 },
      { fromX: 11, toX: -11, y: 4.5, arcY: -2.2 },
      { fromX: -11, toX: 11, y: 0.5, arcY: 3.0 },
    ]),

    // --- Stage-1 (bars 4–12): the four-on-floor locks in. A two-bar
    // call-and-response between coil ranks and threader weaves.
    ...coilRank(bar(4), 3.8, [10, 12, 2, 4]),
    ...threaders(bar(6), 3.6, [
      { fromX: -11, toX: 11, y: 2.5, arcY: 2.8, crossTime: 2.6 },
      { fromX: 11, toX: -11, y: -1.5, arcY: 3.4, crossTime: 2.6 },
      { fromX: -11, toX: 11, y: 5.0, arcY: -2.4, crossTime: 2.6 },
    ]),
    ...coilRank(bar(8), 3.7, [8, 10, 12, 2, 4]),
    ...capacitors(bar(8, 2), 5.4, [[0, 1.2]]), // the first capacitor drifts in mid-section
    ...threaders(bar(10), 3.5, [
      { fromX: 11, toX: -11, y: 0.5, arcY: 3.2, crossTime: 2.4 },
      { fromX: -11, toX: 11, y: 3.5, arcY: 2.4, crossTime: 2.4 },
      { fromX: 11, toX: -11, y: -4.0, arcY: 2.8, crossTime: 2.4 },
      { fromX: -11, toX: 11, y: -1.0, arcY: -3.0, crossTime: 2.4 },
    ]),
    ...coilRank(bar(11), 3.4, [6, 12, 3]),

    // --- Stage-2 (bars 12–20): density plus return fire. Larger coil ranks
    // with several firing, threader staggers, paired capacitors — then a
    // deliberate breath of empty air just before the klaxon.
    ...coilRank(bar(12), 2.9, [12, 2, 4, 6, 8, 10], { fires: [true, false, false, true, false, false] }),
    ...threaders(bar(13, 2), 2.7, [
      { fromX: -11, toX: 11, y: 1.5, arcY: 3.0, delay: 0, crossTime: 1.9 },
      { fromX: 11, toX: -11, y: 4.0, arcY: -2.4, delay: 0.2, crossTime: 1.9 },
      { fromX: -11, toX: 11, y: -2.5, arcY: 2.8, delay: 0.4, crossTime: 1.9 },
      { fromX: 11, toX: -11, y: -5.0, arcY: 2.4, delay: 0.6, crossTime: 1.9 },
    ]),
    ...capacitors(bar(14, 2), 4.6, [[-4.6, 2.2], [4.6, -1.6]]),
    ...coilRank(bar(15, 2), 2.8, [1, 5, 7, 11], { fires: [false, true, false, true] }),
    ...threaders(bar(16, 2), 2.6, [
      { fromX: 11, toX: -11, y: 2.5, arcY: 2.6, delay: 0, crossTime: 1.8 },
      { fromX: -11, toX: 11, y: -0.5, arcY: 3.2, delay: 0.2, crossTime: 1.8 },
      { fromX: 11, toX: -11, y: 5.2, arcY: -2.2, delay: 0.4, crossTime: 1.8 },
      { fromX: -11, toX: 11, y: -4.2, arcY: 2.6, delay: 0.6, crossTime: 1.8 },
    ]),
    ...coilRank(bar(17, 2), 2.7, [12, 3, 6, 9], { fires: [false, true, true, false] }),
    ...threaders(bar(18, 1), 2.6, [
      { fromX: -11, toX: 11, y: 0.5, arcY: 2.8, delay: 0, crossTime: 1.7 },
      { fromX: 11, toX: -11, y: 3.0, arcY: 2.4, delay: 0.25, crossTime: 1.7 },
      { fromX: -11, toX: 11, y: -3.0, arcY: -2.6, delay: 0.5, crossTime: 1.7 },
    ]),
    // (bars 19–20: empty air. The klaxon owns this bar.)

    // --- Interlock (bars 20–28): the six clamps arrive in two ranks of three
    // around the rim; threader chaff keeps the volleys mixed.
    ...interlockRank(bar(20), [
      { hour: 12, index: 0 },
      { hour: 4, index: 1, fires: true },
      { hour: 8, index: 2 },
    ]),
    ...interlockRank(bar(21), [
      { hour: 2, index: 3 },
      { hour: 6, index: 4 },
      { hour: 10, index: 5, fires: true },
    ]),
    ...threaders(bar(22, 2), 1.9, [
      { fromX: -11, toX: 11, y: -4.5, arcY: 2.2, delay: 0, crossTime: 1.3 },
      { fromX: 11, toX: -11, y: 5.0, arcY: -2.0, delay: 0.3, crossTime: 1.3 },
    ]),
    ...threaders(bar(24, 2), 1.8, [
      { fromX: 11, toX: -11, y: -5.0, arcY: 2.4, delay: 0, crossTime: 1.25 },
      { fromX: -11, toX: 11, y: 4.6, arcY: -2.2, delay: 0.3, crossTime: 1.25 },
    ]),
    ...threaders(bar(26), 1.7, [
      { fromX: -11, toX: 11, y: -4.6, arcY: 2.0, delay: 0, crossTime: 1.2 },
      { fromX: 11, toX: -11, y: 4.2, arcY: -1.8, delay: 0.25, crossTime: 1.2 },
    ]),

    // --- Muzzle (bars 28–32): intentionally empty. The payoff for surviving.
  ].sort((a, b) => a.time - b.time);
}

export const MASS_DRIVER_TIMELINE: MassDriverSpawnEntry[] = createMassDriverTimeline();

const KILL_SCORE: Record<MassDriverEnemyKind, number> = {
  coil: 90,
  threader: 120,
  capacitor: 300,
  arc: 50,
  interlock: 450,
};

const ARC_MAX_AGE = 11;
const PASS_MARGIN_U = 0.01;
const INTERLOCK_LEAD_SECONDS = 1.25;
const INTERLOCK_RADIUS = 10.0;
const COIL_WALL_RADIUS = 10.4;

export type MassDriverGameplay = LockOnRunnerLevel<MassDriverEnemyKind, MassDriverSpawnData> & {
  gunFired(): boolean;
  detonated(): boolean;
  interlocksDown(): number;
};

export function createMassDriverGameplay(bus: EventBus): MassDriverGameplay {
  const timeline = createMassDriverTimeline();

  // Shots in flight toward arc bolts; a bolt only counts as intercepted if a
  // player dart actually connects before impact.
  const interceptions = new Set<number>();
  const interlockIds = new Set<number>();
  let interlockKills = 0;
  let arcsIntercepted = 0;
  let hitsTaken = 0;
  let detonating = false;
  let detonated = false;

  bus.on('runstart', () => {
    interceptions.clear();
    interlockIds.clear();
    interlockKills = 0;
    arcsIntercepted = 0;
    hitsTaken = 0;
    detonating = false;
    detonated = false;
  });

  bus.on('playerhit', () => {
    hitsTaken += 1;
  });

  bus.on('spawn', ({ enemyId, kind }) => {
    if (kind === 'interlock') interlockIds.add(enemyId);
  });

  bus.on('fire', ({ enemyId }) => {
    interceptions.add(enemyId);
  });

  bus.on('kill', ({ enemyId }) => {
    interceptions.delete(enemyId);
    if (interlockIds.delete(enemyId)) interlockKills += 1;
  });

  bus.on('miss', ({ enemyId }) => {
    interceptions.delete(enemyId);
    interlockIds.delete(enemyId);
  });

  const gunFired = () => interlockKills >= INTERLOCK_COUNT && !detonated;

  function fireArc(context: MassDriverUpdate, from: Vector3) {
    const initial = hostileShotAimPoint(context.camera, from).sub(from).normalize().multiplyScalar(5.5);
    context.spawnEnemy({
      time: context.runTime,
      kind: 'arc',
      countsTowardTotal: false,
      data: { role: 'arc', position: from.clone(), velocity: initial, lastAge: 0, impact: {} },
    });
  }

  // ---- movement -------------------------------------------------------------

  // Coil: wall-riding sentry. Clamps to the bore wall ahead of the camera and
  // slides slowly around the circumference, always facing inward. From
  // stage-2, firing coils telegraph a rear-back, then lunge inward and loose
  // an arc bolt.
  function updateCoil(context: MassDriverUpdate, data: Extract<MassDriverSpawnData, { role: 'coil' }>) {
    const { enemy, runProgress, age, curve, railAnchor } = context;
    const anchorU = railAnchor(data.lead);
    const angle = data.clock + data.slide * age;
    let radius = COIL_WALL_RADIUS;
    let punch = 0;

    if (data.fires) {
      const fire = context.enemyState(() => ({ nextAt: 1.7 }));
      const untilShot = fire.nextAt - age;
      if (untilShot < 0.85 && untilShot > 0.5) radius += (0.85 - untilShot) * 3.2; // rear back into the wall
      else if (untilShot <= 0.5 && untilShot > 0) {
        radius -= (0.5 - untilShot) * 9; // fast lunge inward
        punch = 1;
      }
      if (age >= fire.nextAt) {
        fire.nextAt = age + 4.2;
        fireArc(context, enemy.mesh.position);
      }
    }

    const offset = new Vector3(Math.cos(angle) * radius, Math.sin(angle) * radius, 0);
    enemy.mesh.position.copy(offsetFromRail(curve, anchorU, offset));
    // Face inward toward the bore axis with a lazy spin.
    const axisPoint = offsetFromRail(curve, anchorU, new Vector3(0, 0, 0));
    enemy.mesh.lookAt(axisPoint);
    enemy.mesh.rotateZ(age * 0.5 + data.clock + punch * age * 3);
    return runProgress > anchorU + PASS_MARGIN_U;
  }

  // Threader: needle drone corkscrewing through the bore. Crosses the full
  // frame width along a shallow vertical arc while the body winds a helix
  // around that path; the nose points a moment ahead of its travel.
  function updateThreader(context: MassDriverUpdate, data: Extract<MassDriverSpawnData, { role: 'threader' }>) {
    const { enemy, runProgress, age, curve, railAnchor } = context;
    const anchorU = railAnchor(data.lead);
    const t = (age - data.delay) / data.crossTime;
    if (t > 1.12 || runProgress > anchorU + PASS_MARGIN_U) return true;
    const clamped = MathUtils.clamp(t, 0, 1);
    const eased = clamped * clamped * (3 - 2 * clamped);

    const helixPhase = age * data.helix;
    const pathAt = (progress: number) => new Vector3(
      MathUtils.lerp(data.fromX, data.toX, progress),
      data.y + Math.sin(progress * Math.PI) * data.arcY,
      0,
    );
    const position = pathAt(eased);
    position.y += Math.sin(helixPhase) * 1.35;
    position.z = Math.cos(helixPhase) * 1.35;
    enemy.mesh.position.copy(offsetFromRail(curve, anchorU, position));

    // Nose a moment ahead of travel.
    const ahead = pathAt(Math.min(1, eased + 0.05));
    ahead.y += Math.sin(helixPhase + 0.45) * 1.35;
    ahead.z = Math.cos(helixPhase + 0.45) * 1.35;
    enemy.mesh.lookAt(offsetFromRail(curve, anchorU, ahead));
    enemy.mesh.rotateZ(helixPhase * 0.6);
    return false;
  }

  // Capacitor: fat two-stage insulated bank drifting mid-bore. Faces the
  // camera with a slow alternating roll and a lazy figure-drift; once the
  // staves shear off, the exposed core shudders at high frequency.
  function updateCapacitor(context: MassDriverUpdate, data: Extract<MassDriverSpawnData, { role: 'capacitor' }>) {
    const { enemy, runProgress, age, curve, camera, railAnchor } = context;
    const close = MathUtils.clamp(age / 6.5, 0, 1);
    const lead = MathUtils.lerp(data.lead, 2.4, close * close * (3 - 2 * close));
    const anchorU = railAnchor(lead);
    const offset = new Vector3(
      data.x + Math.sin(age * 0.55 + data.phase) * 1.7,
      data.y + Math.sin(age * 0.9 + data.phase * 1.7) * 1.3,
      0,
    );
    enemy.mesh.position.copy(offsetFromRail(curve, anchorU, offset));
    enemy.mesh.quaternion.copy(camera.quaternion);
    enemy.mesh.rotateZ(Math.sin(age * 0.5 + data.phase) * 0.7);
    if (enemy.hitStageIndex > 0) {
      // Exposed core: high-frequency shudder.
      enemy.mesh.position.x += Math.sin(age * 24) * 0.12;
      enemy.mesh.position.y += Math.cos(age * 19) * 0.1;
    }
    return runProgress > anchorU + PASS_MARGIN_U;
  }

  // Arc: ball lightning — an interceptable hostile bolt that homes on the
  // camera, accelerating and braking as it closes.
  function updateArc(context: MassDriverUpdate, data: Extract<MassDriverSpawnData, { role: 'arc' }>) {
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
      if (impact.damaged) {
        damagePlayer(1);
        return true;
      }
      return false;
    }

    steerHomingShot(data.position, data.velocity, hostileShotAimPoint(camera, data.position), age, dt, {
      baseSpeed: 6,
      maxSpeed: 15,
      accel: 3.6,
      turnRate: 2.5,
    });
    enemy.mesh.position.copy(data.position);
    return age > ARC_MAX_AGE || shotBehindCamera(camera, data.position);
  }

  // Interlock: the boss. Station-keeping — each clamp holds a roughly
  // constant lead ahead of the camera so all six brood over the bore at
  // frame-rim clock positions and can never be overtaken. The lead is clamped
  // to the muzzle, so through the final bars they tighten and close in as the
  // gun accelerates. Any interlock still standing when the gun fires is the
  // detonation.
  function updateInterlock(context: MassDriverUpdate, data: Extract<MassDriverSpawnData, { role: 'interlock' }>) {
    const { enemy, runTime, age, curve, camera, damagePlayer } = context;

    if (runTime >= SHOT_TIME - 0.02) {
      // Deadline reached with this clamp still standing: containment failure.
      // Stay alive so damage keeps landing past any invulnerability window;
      // the timeout only matters to immortal debug/snapshot runs.
      detonating = true;
      detonated = true;
      damagePlayer(MASS_DRIVER_PLAYER_HEALTH);
      return runTime > SHOT_TIME + 1.2;
    }

    const anchorU = massDriverRunProgress(Math.min(SHOT_TIME, runTime + INTERLOCK_LEAD_SECONDS));
    const settle = 1 - (1 - MathUtils.clamp(age / 1.1, 0, 1)) ** 3;
    const wobble = Math.sin(age * 1.3 + data.index * 2.1) * 0.35;
    const radius = (INTERLOCK_RADIUS + wobble) * settle + BORE_RADIUS * (1 - settle);
    const offset = new Vector3(Math.cos(data.clock) * radius, Math.sin(data.clock) * radius, 0);
    enemy.mesh.position.copy(offsetFromRail(curve, anchorU, offset));
    enemy.mesh.quaternion.copy(camera.quaternion);
    enemy.mesh.rotateZ(data.clock + Math.sin(age * 0.9 + data.index) * 0.12);
    if (enemy.hitStageIndex > 0) {
      // Cowl popped: the actuator core shudders.
      enemy.mesh.position.x += Math.sin(age * 26 + data.index) * 0.09;
      enemy.mesh.position.y += Math.cos(age * 21 + data.index) * 0.08;
    }

    if (data.fires && age > 1.6) {
      const fire = context.enemyState(() => ({ nextAt: age + 0.4 + data.index * 0.7 }));
      if (age >= fire.nextAt) {
        fire.nextAt = age + 4.6;
        fireArc(context, enemy.mesh.position);
      }
    }
    return false;
  }

  // ---- level definition ------------------------------------------------------

  return {
    gunFired,
    detonated: () => detonated,
    interlocksDown: () => interlockKills,
    duration: MD_DURATION,
    bpm: MASS_DRIVER_BPM,
    playerHealth: MASS_DRIVER_PLAYER_HEALTH,
    createRail: createMassDriverRail,
    spawnTimeline: timeline,
    easeRunProgress: massDriverRunProgress,
    startWord: 'CHARGE',
    replayWord: 'RELOAD',
    // Deadline boss on a musical clock: cap volley resolution at a half bar so
    // late shots never eat the charge window.
    timing: { shotDelay: { maxGridSeconds: 0.9375 } },
    updateEnemy(context) {
      // While the barrel detonates, hammer the hull through the engine's
      // invulnerability window until the run ends.
      if (detonating) context.damagePlayer(MASS_DRIVER_PLAYER_HEALTH);
      const data = context.enemy.entry.data;
      switch (data.role) {
        case 'coil':
          return updateCoil(context, data);
        case 'threader':
          return updateThreader(context, data);
        case 'capacitor':
          return updateCapacitor(context, data);
        case 'arc':
          return updateArc(context, data);
        case 'interlock':
          return updateInterlock(context, data);
      }
    },
    scoreForKill(volleySize, enemy) {
      if (enemy.kind === 'arc') arcsIntercepted += 1;
      const multiplier = 1 + Math.max(0, volleySize - 1) * 0.18;
      return Math.round(KILL_SCORE[enemy.kind] * multiplier);
    },
    // Every non-lethal armor chip pays a little.
    scoreForHit: () => 40,
    scoreForVolley(results) {
      // Volleys reward locking several targets at once; a perfect six is a lot.
      if (results.length < 4) return 0;
      if (!results.every((result) => result.killed)) return 0;
      return results.length === 6 ? 600 : results.length * 60;
    },
    rankForRun(score, kills, totalEnemies) {
      const clearRate = totalEnemies === 0 ? 0 : kills / totalEnemies;
      // S requires the gun to have actually fired on top of score and clear.
      if (gunFired() && score >= 15000 && clearRate >= 0.78) return 'S';
      if (score >= 10000 && clearRate >= 0.58) return 'A';
      if (score >= 6000 && clearRate >= 0.38) return 'B';
      if (score >= 2400 && clearRate >= 0.18) return 'C';
      return 'D';
    },
    detailsForRun() {
      const hull = detonated ? 0 : Math.max(0, MASS_DRIVER_PLAYER_HEALTH - hitsTaken);
      const lines = [
        `Hull ${hull}/${MASS_DRIVER_PLAYER_HEALTH}`,
        `Interlocks ${Math.min(INTERLOCK_COUNT, interlockKills)}/${INTERLOCK_COUNT}`,
      ];
      if (arcsIntercepted > 0) lines.push(`${arcsIntercepted} arc bolt${arcsIntercepted === 1 ? '' : 's'} intercepted`);
      if (detonated) lines.push('CHARGE CONTAINMENT FAILED');
      else if (gunFired()) lines.push('PAYLOAD AWAY — muzzle exit clean');
      else lines.push('Run aborted before the shot');
      return lines;
    },
  };
}

export { INTERLOCK_TIME, MD_DURATION, SHOT_TIME };
