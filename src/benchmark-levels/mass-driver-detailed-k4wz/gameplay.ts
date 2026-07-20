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
import { createRailPacer, type RailLead } from '../../engine/rail-pacer';
import { createSpeedProfile, type SpeedKey } from '../../engine/speed-profile';
import { sortTimeline } from '../../engine/spawn-patterns';
import type { EventBus } from '../../events';
import {
  BEAT_SECONDS,
  INTERLOCK_TIME,
  MASS_DRIVER_BPM,
  MASS_DRIVER_RUN_DURATION,
  MUZZLE_BEAT,
  SHOT_TIME,
  bar,
} from './timing';

// MASS DRIVER — you are the payload chambered in an orbital railgun, riding
// the bore from breech to muzzle over exactly sixty seconds. One accelerator
// ring per quarter-note beat; the gun fires on the downbeat of bar 28 whether
// or not the player is ready. Six safety interlocks jam the bore at bar 20:
// destroy all six before the charge peaks and the shot throws you cleanly out
// of the muzzle — fail and the barrel detonates with you inside it.

export { MASS_DRIVER_BPM, MASS_DRIVER_RUN_DURATION, SHOT_TIME } from './timing';
export const MASS_DRIVER_PLAYER_HEALTH = 3;
export const INTERLOCK_COUNT = 6;

/** The barrel blows at this moment if any interlock still stands. Slightly
 * before the shot so the failure branch lands before the muzzle music. */
export const DETONATION_TIME = SHOT_TIME - 0.34;

export type MassDriverEnemyKind = 'coil' | 'threader' | 'capacitor' | 'arc' | 'interlock';

export type MassDriverSpawnData =
  | { role: 'coil'; pace: RailLead; clock: number; drift: number; fireAt?: number }
  | {
    role: 'threader';
    pace: RailLead;
    fromX: number;
    toX: number;
    y: number;
    arc: number;
    helix: number;
    sign: 1 | -1;
    delay: number;
    crossTime: number;
  }
  | { role: 'capacitor'; pace: RailLead; offset: Vector3; rollRate: number }
  // Hostile arc bolts use role 'bolt' so the engine gives them lock priority.
  | { role: 'bolt'; position: Vector3; velocity: Vector3; lastAge: number; impact: HostileShotImpactState }
  | { role: 'interlock'; clock: number; rank: number; fires: boolean };

export type MassDriverSpawnEntry = LockOnSpawnEntry<MassDriverEnemyKind, MassDriverSpawnData>;
export type MassDriverUpdate = LockOnEnemyUpdate<MassDriverEnemyKind, MassDriverSpawnData>;

// ---- speed profile → rail easing -------------------------------------------

// The gun only ever speeds up. Factors are relative pace; UNIT_SPEED converts
// factor 1.0 into world units per second. The near-vertical step at bar 28 is
// THE SHOT: a sudden roughly-threefold surge, easing off only slightly in
// open space.
const SPEED_KEYS: readonly SpeedKey[] = [
  [bar(0), 0.4],
  [bar(4), 0.52],
  [bar(12), 0.72],
  [bar(20), 1.0],
  [bar(26), 1.28],
  [SHOT_TIME - 0.06, 1.55],
  [SHOT_TIME + 0.04, 4.6],
  [bar(30), 4.0],
  [bar(32), 3.6],
];

const UNIT_SPEED = 30;

/** Exact trapezoid integral of the piecewise-linear factor curve, in factor-seconds. */
function integrateSpeedKeys(keys: readonly SpeedKey[], duration: number) {
  let total = 0;
  for (let i = 1; i < keys.length; i += 1) {
    const [t0, v0] = keys[i - 1];
    const [t1, v1] = keys[i];
    total += ((v0 + v1) / 2) * (t1 - t0);
  }
  total += keys[keys.length - 1][1] * Math.max(0, duration - keys[keys.length - 1][0]);
  return total;
}

/** Total rail length in world units — the barrel plus the muzzle flight. */
export const RAIL_LENGTH = UNIT_SPEED * integrateSpeedKeys(SPEED_KEYS, MASS_DRIVER_RUN_DURATION);

const speedProfile = createSpeedProfile(SPEED_KEYS, MASS_DRIVER_RUN_DURATION);

export function massDriverRunProgress(time: number, duration = MASS_DRIVER_RUN_DURATION) {
  return speedProfile.runProgress(time, duration);
}

/** World-units-per-second camera speed at run time `t` — drives streaks and FOV. */
export function cameraSpeedAt(time: number) {
  return speedProfile.speedAt(time) * UNIT_SPEED;
}

/** Rail progress of ring k — the camera crosses it exactly on beat k by construction. */
export function ringProgress(beatIndex: number) {
  return massDriverRunProgress(Math.min(MASS_DRIVER_RUN_DURATION, beatIndex * BEAT_SECONDS));
}

/** Where the barrel ends and open space begins. */
export const MUZZLE_PROGRESS = ringProgress(MUZZLE_BEAT);

// ---- rail --------------------------------------------------------------------

export const BORE_RADIUS = 12;

// A long line running mostly straight down the bore with a gentle weave, so
// the tunnel reads and enemies get parallax without the camera clipping the
// wall. The weave tapers to zero right at the muzzle; past the muzzle the
// line lifts gently upward into the black.
export function createMassDriverRail() {
  const points: Vector3[] = [];
  const barrelLength = RAIL_LENGTH * MUZZLE_PROGRESS;
  const step = 60;
  const count = Math.ceil(RAIL_LENGTH / step);
  for (let i = 0; i <= count; i += 1) {
    const s = Math.min(RAIL_LENGTH, i * step);
    const rampIn = MathUtils.smoothstep(s, 0, 170);
    const taperOut = 1 - MathUtils.smoothstep(s, barrelLength - 330, barrelLength - 90);
    const weave = rampIn * taperOut;
    const x = 3.4 * weave * Math.sin((s / 310) * Math.PI * 2 + 0.7);
    const y = 1.7 * weave * Math.sin((s / 214) * Math.PI * 2);
    const past = Math.max(0, s - barrelLength) / Math.max(1, RAIL_LENGTH - barrelLength);
    points.push(new Vector3(x, y + past * past * 52, -s));
  }
  return new CatmullRomCurve3(points, false, 'catmullrom', 0.32);
}

// ---- rail pacing --------------------------------------------------------------

// Fog wall sits near 95 units in the barrel; targets become readable and
// worth engaging inside ~40. The pacer compresses each spawn's
// distance-ahead profile to that budget, so a lead is honest screen time at
// every barrel speed and fights happen close enough to fill the frame.
const SPAWN_AHEAD_UNITS = 40;

const pacerCurve = createMassDriverRail();
const pacer = createRailPacer({
  curve: pacerCurve,
  duration: MASS_DRIVER_RUN_DURATION,
  runProgress: massDriverRunProgress,
  spawnAheadUnits: SPAWN_AHEAD_UNITS,
  defaultLeadSeconds: 4.2,
});

// ---- spawn timeline -------------------------------------------------------------

/** Wall-riding coils clamp at this radius; the rib wall reads just outside them. */
export const WALL_RADIUS = 10.8;
const MISS_GRACE = 0.3;

const clockAngle = (hours: number) => Math.PI / 2 - (hours / 12) * Math.PI * 2;

type CoilOptions = { lead?: number; drift?: number; fire?: Record<number, number> };

// A rank of coils sweeps onto the rim staggered half a beat apart, so the
// rank reads as a sweep around the frame rather than a cluster.
const coilRank = (time: number, clocks: number[], options: CoilOptions = {}): MassDriverSpawnEntry[] =>
  clocks.map((hours, index) => ({
    time: time + index * BEAT_SECONDS * 0.5,
    kind: 'coil',
    data: {
      role: 'coil',
      pace: pacer.resolve(time + index * BEAT_SECONDS * 0.5, options.lead ?? 4.4),
      clock: clockAngle(hours),
      drift: (options.drift ?? 0.16) * (index % 2 === 0 ? 1 : -1),
      fireAt: options.fire?.[hours],
    },
  }));

type ThreaderRun = {
  fromX: number;
  toX: number;
  y: number;
  arc: number;
  sign?: 1 | -1;
  delay?: number;
  crossTime?: number;
  helix?: number;
};

const threaders = (time: number, lead: number, runs: ThreaderRun[]): MassDriverSpawnEntry[] =>
  runs.map((run, index) => ({
    time: time + index * 0.1,
    kind: 'threader',
    data: {
      role: 'threader',
      pace: pacer.resolve(time + index * 0.1, lead),
      fromX: run.fromX,
      toX: run.toX,
      y: run.y,
      arc: run.arc,
      helix: run.helix ?? 1.25,
      sign: run.sign ?? (index % 2 === 0 ? 1 : -1),
      delay: run.delay ?? index * 0.36,
      crossTime: run.crossTime ?? 2.7,
    },
  }));

const capacitors = (time: number, offsets: Array<[number, number]>): MassDriverSpawnEntry[] =>
  offsets.map((offset, index) => ({
    time: time + index * 0.35,
    kind: 'capacitor',
    hitStages: [2, 2],
    data: {
      role: 'capacitor',
      pace: pacer.resolve(time + index * 0.35, 6.2),
      offset: new Vector3(offset[0], offset[1], 0),
      rollRate: index % 2 === 0 ? 0.35 : -0.35,
    },
  }));

const interlockRank = (time: number, clocks: number[], rank: number, firingClock: number): MassDriverSpawnEntry[] =>
  clocks.map((hours, index) => ({
    time: time + index * BEAT_SECONDS * 0.5,
    kind: 'interlock',
    hitStages: [1, 2],
    data: { role: 'interlock', clock: clockAngle(hours), rank, fires: hours === firingClock },
  }));

function createMassDriverTimeline(): MassDriverSpawnEntry[] {
  return sortTimeline([
    // --- INJECTION (bars 0–4): the breech. First drones teach the sweep;
    // a counter-rotating threader pair reveals the double helix.
    ...threaders(bar(0, 2), 4.6, [
      { fromX: -13.5, toX: 13.5, y: 2.1, arc: 1.6, sign: 1, delay: 0, crossTime: 3.6, helix: 1.5 },
      { fromX: -13.5, toX: 13.5, y: 2.1, arc: 1.6, sign: -1, delay: 0, crossTime: 3.6, helix: 1.5 },
    ]),
    ...coilRank(bar(1, 3), [10, 2, 4, 8], { lead: 4.7, drift: 0.14 }),
    ...threaders(bar(3), 4.4, [
      { fromX: -13, toX: 13, y: 3.6, arc: 1.2 },
      { fromX: 13, toX: -13, y: 0.4, arc: 2.2 },
    ]),

    // --- STAGE-1 (bars 4–12): the four-on-floor locks in. A two-bar
    // call-and-response between coil ranks and threader weaves; the first
    // capacitor drifts in mid-section.
    ...coilRank(bar(4), [12, 4, 8], { lead: 4.5 }),
    ...threaders(bar(5), 4.3, [
      { fromX: -13.5, toX: 13.5, y: 1.2, arc: 2.4 },
      { fromX: -13.5, toX: 13.5, y: 4.2, arc: 1.4 },
      { fromX: 13.5, toX: -13.5, y: -0.8, arc: 2.8 },
    ]),
    ...coilRank(bar(6), [2, 6, 10], { drift: 0.2 }),
    ...threaders(bar(7), 4.2, [
      { fromX: -13.5, toX: 13.5, y: 2.6, arc: 1.8, sign: 1, delay: 0, crossTime: 2.9, helix: 1.5 },
      { fromX: 13.5, toX: -13.5, y: 2.6, arc: 1.8, sign: -1, delay: 0.12, crossTime: 2.9, helix: 1.5 },
    ]),
    ...capacitors(bar(8), [[3.6, 1.8]]),
    ...coilRank(bar(8, 1), [10, 2], { lead: 4.2 }),
    ...threaders(bar(9, 2), 4.2, [
      { fromX: 13.5, toX: -13.5, y: 0.2, arc: 2.6 },
      { fromX: 13.5, toX: -13.5, y: 3.4, arc: 1.6 },
      { fromX: -13.5, toX: 13.5, y: 5.0, arc: 1.0 },
    ]),
    ...coilRank(bar(10), [12, 4, 6, 8], { drift: 0.22 }),
    ...threaders(bar(11), 4.1, [
      { fromX: -13.5, toX: 13.5, y: 1.6, arc: 2.2 },
      { fromX: 13.5, toX: -13.5, y: 4.4, arc: 1.2 },
    ]),

    // --- STAGE-2 (bars 12–20): rings run violet; density rises; hostiles
    // start shooting back. Ends on a deliberate breath of empty air.
    ...coilRank(bar(12), [12, 2, 4, 6, 8, 10], { lead: 4.3, drift: 0.24, fire: { 12: 1.4, 6: 2.3 } }),
    ...threaders(bar(13), 4.0, [
      { fromX: -13.5, toX: 13.5, y: 0.4, arc: 3.0, delay: 0 },
      { fromX: 13.5, toX: -13.5, y: 2.4, arc: 2.2, delay: 0.3 },
      { fromX: -13.5, toX: 13.5, y: 4.4, arc: 1.4, delay: 0.6 },
      { fromX: 13.5, toX: -13.5, y: 1.4, arc: 2.6, delay: 0.9 },
    ]),
    ...capacitors(bar(14), [[-4.6, 1.4], [4.6, -0.8]]),
    ...coilRank(bar(14, 2), [3, 9], { lead: 4.0, fire: { 3: 1.6 } }),
    ...threaders(bar(15, 2), 3.9, [
      { fromX: 13.5, toX: -13.5, y: 3.0, arc: 1.8 },
      { fromX: -13.5, toX: 13.5, y: 0.0, arc: 2.6 },
      { fromX: 13.5, toX: -13.5, y: 5.2, arc: 0.9 },
    ]),
    ...coilRank(bar(16), [12, 2, 6, 8, 10], { drift: 0.26, fire: { 2: 1.5, 10: 2.4 } }),
    ...threaders(bar(17), 3.8, [
      { fromX: -13.5, toX: 13.5, y: 1.0, arc: 2.8, delay: 0, crossTime: 2.4 },
      { fromX: 13.5, toX: -13.5, y: 3.6, arc: 1.8, delay: 0.28, crossTime: 2.4 },
      { fromX: -13.5, toX: 13.5, y: 5.0, arc: 1.1, delay: 0.56, crossTime: 2.4 },
      { fromX: 13.5, toX: -13.5, y: -0.6, arc: 3.0, delay: 0.84, crossTime: 2.4 },
    ]),
    ...capacitors(bar(18), [[0, 2.9]]),
    ...coilRank(bar(18, 1), [4, 8], { lead: 3.6, fire: { 8: 1.4 } }),
    ...threaders(bar(18, 3), 3.4, [
      { fromX: -13.5, toX: 13.5, y: 2.0, arc: 2.0, crossTime: 2.2 },
      { fromX: 13.5, toX: -13.5, y: 0.6, arc: 2.4, crossTime: 2.2 },
    ]),
    // (bars 19.2–20: the breath before the klaxon)

    // --- INTERLOCK (bars 20–28): six jammed clamps brood over the bore at
    // the frame rim and can never be overtaken. Threader chaff in pairs keeps
    // the volleys mixed, tightening as the gun accelerates.
    ...interlockRank(bar(20), [12, 4, 8], 0, 12),
    ...interlockRank(bar(21), [2, 6, 10], 1, 6),
    ...threaders(bar(22, 1), 3.4, [
      { fromX: -13.5, toX: 13.5, y: 1.4, arc: 2.4, crossTime: 2.5, helix: 1.0 },
      { fromX: 13.5, toX: -13.5, y: 3.8, arc: 1.6, crossTime: 2.5, helix: 1.0 },
    ]),
    ...threaders(bar(23, 3), 3.2, [
      { fromX: 13.5, toX: -13.5, y: 0.2, arc: 2.8, crossTime: 2.3, helix: 1.0 },
      { fromX: -13.5, toX: 13.5, y: 4.6, arc: 1.2, crossTime: 2.3, helix: 1.0 },
    ]),
    ...threaders(bar(25, 1), 3.0, [
      { fromX: -13.5, toX: 13.5, y: 2.6, arc: 2.0, crossTime: 2.1, helix: 0.9 },
      { fromX: 13.5, toX: -13.5, y: 1.0, arc: 2.4, crossTime: 2.1, helix: 0.9 },
    ]),
    ...threaders(bar(26, 2), 2.6, [
      { fromX: 13.5, toX: -13.5, y: 3.2, arc: 1.6, crossTime: 1.9, helix: 0.8 },
      { fromX: -13.5, toX: 13.5, y: 0.4, arc: 2.4, crossTime: 1.9, helix: 0.8 },
    ]),

    // --- MUZZLE (bars 28–32): intentionally empty. The payoff for surviving.
  ]);
}

export const MASS_DRIVER_TIMELINE: MassDriverSpawnEntry[] = createMassDriverTimeline();

const KILL_SCORE: Record<MassDriverEnemyKind, number> = {
  coil: 100,
  threader: 130,
  capacitor: 400,
  arc: 60,
  interlock: 600,
};

const ARC_MAX_AGE = 12;

// ---- gameplay ---------------------------------------------------------------------

export function createMassDriverGameplay(bus: EventBus): LockOnRunnerLevel<MassDriverEnemyKind, MassDriverSpawnData> {
  const timeline = createMassDriverTimeline();

  const arcInterceptions = new Set<number>();
  const arcIds = new Set<number>();
  const interlockIds = new Set<number>();
  let arcsIntercepted = 0;
  let interlocksDown = 0;
  let hitsTaken = 0;
  let gunFired = false;
  let detonated = false;

  bus.on('runstart', () => {
    arcInterceptions.clear();
    arcIds.clear();
    interlockIds.clear();
    arcsIntercepted = 0;
    interlocksDown = 0;
    hitsTaken = 0;
    gunFired = false;
    detonated = false;
  });

  bus.on('spawn', ({ enemyId, kind }) => {
    if (kind === 'arc') arcIds.add(enemyId);
    if (kind === 'interlock') interlockIds.add(enemyId);
  });

  bus.on('playerhit', () => {
    hitsTaken += 1;
  });

  bus.on('fire', ({ enemyId }) => {
    if (arcIds.has(enemyId)) arcInterceptions.add(enemyId);
  });

  bus.on('kill', ({ enemyId }) => {
    if (arcIds.delete(enemyId)) {
      arcInterceptions.delete(enemyId);
      arcsIntercepted += 1;
    }
    if (interlockIds.delete(enemyId)) {
      interlocksDown += 1;
      if (interlocksDown >= INTERLOCK_COUNT) gunFired = true;
    }
  });

  bus.on('miss', ({ enemyId }) => {
    arcIds.delete(enemyId);
    arcInterceptions.delete(enemyId);
  });

  function fireArc(context: MassDriverUpdate, from: Vector3) {
    const initial = hostileShotAimPoint(context.camera, from).sub(from).normalize().multiplyScalar(5);
    context.spawnEnemy({
      time: context.runTime,
      kind: 'arc',
      countsTowardTotal: false,
      data: { role: 'bolt', position: from.clone(), velocity: initial, lastAge: 0, impact: {} },
    });
  }

  function updateCoil(context: MassDriverUpdate, data: Extract<MassDriverSpawnData, { role: 'coil' }>) {
    const { enemy, runTime, age, curve } = context;
    const sample = pacer.sample(enemy.entry.time, runTime, data.pace);
    const angle = data.clock + data.drift * age;
    let radius = WALL_RADIUS;

    // Telegraphed shot: rear back into the wall, then a fast lunge inward.
    if (data.fireAt !== undefined) {
      const untilShot = data.fireAt - age;
      if (untilShot < 0.6 && untilShot > 0.3) radius += (0.6 - untilShot) * 3.2;
      else if (untilShot <= 0.3 && untilShot > 0) radius -= (0.3 - untilShot) * 11;
      const fire = context.enemyState(() => ({ fired: false }));
      if (!fire.fired && age >= data.fireAt) {
        fire.fired = true;
        fireArc(context, enemy.mesh.position);
      }
    }

    const offset = new Vector3(Math.cos(angle) * radius, Math.sin(angle) * radius, 0);
    enemy.mesh.position.copy(offsetFromRail(curve, sample.anchorU, offset));
    // Always face inward toward the bore axis, with a lazy spin.
    enemy.mesh.lookAt(sampleRailFrame(curve, sample.anchorU).position);
    enemy.mesh.rotateZ(age * 0.5 + enemy.id * 1.3);
    return runTime > sample.passTime + MISS_GRACE;
  }

  function updateThreader(context: MassDriverUpdate, data: Extract<MassDriverSpawnData, { role: 'threader' }>) {
    const { enemy, runTime, age, curve } = context;
    const sample = pacer.sample(enemy.entry.time, runTime, data.pace);
    const t = (age - data.delay) / data.crossTime;
    if (t > 1.12 || runTime > sample.passTime + MISS_GRACE) return true;
    const clamped = MathUtils.clamp(t, 0, 1);
    const eased = clamped * clamped * (3 - 2 * clamped);
    // The body winds a helix around the crossing path; alternating signs in a
    // wave read as counter-rotating double helices.
    const phase = clamped * Math.PI * 2 * 2.6 * data.sign + enemy.id;
    const x = MathUtils.lerp(data.fromX, data.toX, eased);
    const y = data.y + Math.sin(clamped * Math.PI) * data.arc + Math.sin(phase) * data.helix;
    const z = Math.cos(phase) * data.helix;
    enemy.mesh.position.copy(offsetFromRail(curve, sample.anchorU, new Vector3(x, y, z)));

    // The nose points a moment ahead of its travel.
    const aheadT = Math.min(1, clamped + 0.05);
    const aheadPhase = aheadT * Math.PI * 2 * 2.6 * data.sign + enemy.id;
    const ahead = offsetFromRail(curve, sample.anchorU, new Vector3(
      MathUtils.lerp(data.fromX, data.toX, aheadT * aheadT * (3 - 2 * aheadT)),
      data.y + Math.sin(aheadT * Math.PI) * data.arc + Math.sin(aheadPhase) * data.helix,
      Math.cos(aheadPhase) * data.helix,
    ));
    enemy.mesh.lookAt(ahead);
    enemy.mesh.rotateZ(age * 5 * data.sign);
    return false;
  }

  function updateCapacitor(context: MassDriverUpdate, data: Extract<MassDriverSpawnData, { role: 'capacitor' }>) {
    const { enemy, runTime, age, curve, camera } = context;
    const sample = pacer.sample(enemy.entry.time, runTime, data.pace);
    const offset = data.offset.clone();
    // Lazy figure-drift, facing the camera with a slow alternating roll.
    offset.x += Math.sin(age * 0.55) * 1.5;
    offset.y += Math.sin(age * 0.85 + 1.2) * 0.9;
    enemy.mesh.position.copy(offsetFromRail(curve, sample.anchorU, offset));
    enemy.mesh.quaternion.copy(camera.quaternion);
    enemy.mesh.rotateZ(Math.sin(age * data.rollRate * 2) * 0.8);
    // Exposed core (stage 1) shudders at high frequency.
    if (enemy.hitStageIndex > 0) {
      enemy.mesh.position.x += Math.sin(age * 27) * 0.09;
      enemy.mesh.position.y += Math.cos(age * 23) * 0.08;
    }
    return runTime > sample.passTime + MISS_GRACE;
  }

  function updateArc(context: MassDriverUpdate, data: Extract<MassDriverSpawnData, { role: 'bolt' }>) {
    const { enemy, age, camera, damagePlayer } = context;
    const dt = Math.max(0, age - data.lastAge);
    data.lastAge = age;

    const impact = updateHostileShotImpact({
      age,
      camera,
      position: data.position,
      velocity: data.velocity,
      state: data.impact,
      intercepted: arcInterceptions.delete(enemy.id),
    });
    enemy.mesh.position.copy(data.position);
    if (impact.phase === 'braking') {
      if (impact.damaged) {
        damagePlayer(1);
        return true;
      }
      return false;
    }

    // Ball lightning: homes on the camera, accelerating and braking as it
    // closes. Shell instability is handled by the visuals every frame.
    steerHomingShot(data.position, data.velocity, hostileShotAimPoint(camera, data.position), age, dt, {
      baseSpeed: 5.5,
      maxSpeed: 13,
      accel: 3.6,
      turnRate: 2.3,
    });
    enemy.mesh.position.copy(data.position);
    return age > ARC_MAX_AGE || shotBehindCamera(camera, data.position);
  }

  function updateInterlock(context: MassDriverUpdate, data: Extract<MassDriverSpawnData, { role: 'interlock' }>) {
    const { enemy, runTime, runProgress, age, curve, camera, damagePlayer } = context;

    // The deadline: any interlock still standing when the gun fires deals a
    // lethal hit — the detonation. Repeated in case an invulnerability window
    // swallowed the first frame.
    if (runTime >= DETONATION_TIME) {
      detonated = true;
      damagePlayer(MASS_DRIVER_PLAYER_HEALTH);
    }

    // Station-keeping: hold a roughly constant distance ahead of the camera,
    // brooding over the bore at a frame-rim clock position — it can never be
    // overtaken or missed before the shot. The hold tightens with the charge.
    const sectionPhase = MathUtils.clamp((runTime - INTERLOCK_TIME) / (SHOT_TIME - INTERLOCK_TIME), 0, 1);
    const arrive = MathUtils.smoothstep(age, 0, 1.3);
    const holdDistance = MathUtils.lerp(26, 19.5, sectionPhase);
    const distanceAhead = MathUtils.lerp(64, holdDistance, arrive);
    const anchorU = MathUtils.clamp(runProgress + distanceAhead / RAIL_LENGTH, 0, 1);
    const rim = MathUtils.lerp(7.1, 6.3, sectionPhase);
    const sway = Math.sin(age * 0.9 + data.clock * 3) * 0.06;
    const offset = new Vector3(Math.cos(data.clock + sway) * rim, Math.sin(data.clock + sway) * rim, 0);
    enemy.mesh.position.copy(offsetFromRail(curve, anchorU, offset));
    enemy.mesh.quaternion.copy(camera.quaternion);
    enemy.mesh.rotateZ(data.clock + Math.sin(age * 0.7) * 0.1);
    // Exposed actuator core (stage 1) shudders.
    if (enemy.hitStageIndex > 0) {
      enemy.mesh.position.x += Math.sin(age * 25) * 0.07;
      enemy.mesh.position.y += Math.cos(age * 29) * 0.07;
    }

    if (data.fires && runTime < bar(26.5)) {
      const fire = context.enemyState(() => ({ nextAt: age + 2.3 + data.rank * 1.1 }));
      if (age >= fire.nextAt) {
        fire.nextAt = age + 2.7;
        fireArc(context, enemy.mesh.position);
      }
    }
    return false;
  }

  return {
    duration: MASS_DRIVER_RUN_DURATION,
    bpm: MASS_DRIVER_BPM,
    playerHealth: MASS_DRIVER_PLAYER_HEALTH,
    startWord: 'CHARGE',
    replayWord: 'RELOAD',
    createRail: createMassDriverRail,
    spawnTimeline: timeline,
    easeRunProgress: massDriverRunProgress,
    // The barrel runs fast; keep volley snap grids tight in absolute time.
    timing: { shotDelay: { maxGridSeconds: 0.95 } },
    updateEnemy(context) {
      const data = context.enemy.entry.data;
      switch (data.role) {
        case 'coil':
          return updateCoil(context, data);
        case 'threader':
          return updateThreader(context, data);
        case 'capacitor':
          return updateCapacitor(context, data);
        case 'bolt':
          return updateArc(context, data);
        case 'interlock':
          return updateInterlock(context, data);
      }
    },
    scoreForKill(volleySize, enemy) {
      const multiplier = 1 + Math.max(0, volleySize - 1) * 0.15;
      return Math.round(KILL_SCORE[enemy.kind] * multiplier);
    },
    // Every non-lethal armor chip pays a little.
    scoreForHit: () => 35,
    // Volleys reward locking several targets at once; a clean full six is the
    // breech fully charged — worth a lot.
    scoreForVolley(results) {
      const kills = results.filter((result) => result.killed).length;
      if (kills < 3 || kills < results.length) return 0;
      if (kills === 6) return 900;
      return kills * 45;
    },
    rankForRun(score, kills, totalEnemies) {
      const clearRate = totalEnemies === 0 ? 0 : kills / totalEnemies;
      // S is reserved for a run where the gun actually fired and nearly
      // everything died; a solid imperfect clear lands A.
      if (gunFired && score >= 13200 && clearRate >= 0.92) return 'S';
      if (score >= 9000 && clearRate >= 0.66) return 'A';
      if (score >= 5500 && clearRate >= 0.45) return 'B';
      if (score >= 2500 && clearRate >= 0.25) return 'C';
      return 'D';
    },
    detailsForRun() {
      const hull = detonated ? 0 : Math.max(0, MASS_DRIVER_PLAYER_HEALTH - hitsTaken);
      const verdict = gunFired
        ? 'PAYLOAD AWAY — muzzle exit clean'
        : detonated
          ? 'CHARGE CONTAINMENT FAILED'
          : 'HULL BREACH — payload lost in the bore';
      return [
        `Hull ${hull}/${MASS_DRIVER_PLAYER_HEALTH}`,
        `Interlocks ${interlocksDown}/${INTERLOCK_COUNT}`,
        `Arcs intercepted ${arcsIntercepted}`,
        verdict,
      ];
    },
  };
}
