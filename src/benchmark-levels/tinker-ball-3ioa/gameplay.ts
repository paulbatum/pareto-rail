import { CatmullRomCurve3, MathUtils, Vector3 } from 'three';
import {
  hostileShotAimPoint,
  shotBehindCamera,
  steerHomingShot,
  updateHostileShotImpact,
  type HostileShotImpactState,
} from '../../engine/hostile-shot';
import type { LockOnEnemyUpdate, LockOnRunnerLevel, LockOnSpawnEntry } from '../../engine/lock-on-runner';
import { sampleRailFrame } from '../../engine/rail';
import { createSpeedProfile } from '../../engine/speed-profile';
import { sortTimeline } from '../../engine/spawn-patterns';
import type { EventBus } from '../../events';
import { onSignal } from './signals';
import { createSpill, type SpillAnchorData, type SpillCoreData } from './spill';
import {
  CLEAN_TIME,
  MELON_TIME,
  SPILL_TIME,
  TENNIS_TIME,
  TINKER_BPM,
  TINKER_RUN_DURATION,
  bar,
} from './timing';

// TINKER BALL — a 60-second roll across one oversized worktable, scored to a
// 32-bar pop arrangement at 128 BPM (one bar = 1.875 s):
//
//   Marble       bars 0–7    buttons, pins, beads, paperclips tower over you.
//   Tennis ball  bars 8–15   spools, erasers, paint pots, blocks.
//   Melon        bars 16–20  rulers, jars, cardboard; the table is small now.
//   The Spill    bars 21–29  a glue spill with three dark cores, cracked in turn.
//   Spotless     bars 30–31  the last glue snaps; coast across clean wood.
//
// The camera is the ball's eye line: the rail's height above the table rises
// with the ball's size, so the same table shrinks around you. Enemies are glue
// creatures wearing supplies; killing one drops its body on the road ahead
// where the ball rolls over it and keeps the pieces.

export { TINKER_BPM, TINKER_RUN_DURATION } from './timing';
export const TINKER_PLAYER_HEALTH = 3;
export const TABLE_Y = 0;

/** Seconds a fresh glue creature spends assembling its body before it can be locked. */
export const ASSEMBLE_SECONDS = 0.75;

export type TinkerEnemyKind = 'beetle' | 'strider' | 'snapper' | 'glob' | 'spill-core' | 'spill';

// Timeline data is immutable and reused across runs; per-enemy runtime state
// lives in the runner's enemyState bags. Globs are spawned dynamically with
// fresh data objects, so their flight state may mutate.
export type TinkerSpawnData =
  | { role: 'beetle'; lead: number; x: number; amp: number; rate: number; phase: number; scale: number }
  | { role: 'strider'; lead: number; x: number; stride: number; scale: number }
  | { role: 'snapper'; lead: number; fromX: number; toX: number; altitude: number; arc: number; crossTime: number; spit: boolean; scale: number }
  | { role: 'bolt'; position: Vector3; velocity: Vector3; lastAge: number; impact: HostileShotImpactState; scale: number }
  | SpillCoreData
  | SpillAnchorData;

export type TinkerSpawnEntry = LockOnSpawnEntry<TinkerEnemyKind, TinkerSpawnData>;
export type TinkerUpdate = LockOnEnemyUpdate<TinkerEnemyKind, TinkerSpawnData>;

// ---- speed profile → rail easing --------------------------------------------

// A marble rolls slower than a melon: each size step is a genuine change of
// pace, and the run relaxes a touch for the Spill so the cores can be read.
const SPEED_KEYS: Array<[number, number]> = [
  [bar(0), 0.42],
  [bar(1), 0.6],
  [bar(7.5), 0.62],
  [bar(8.5), 0.95],
  [bar(15.5), 1.0],
  [bar(16.5), 1.45],
  [bar(20.5), 1.5],
  [bar(21.5), 1.15],
  [bar(29.5), 1.15],
  [bar(30.5), 1.35],
  [bar(32), 1.45],
];

const speedProfile = createSpeedProfile(SPEED_KEYS, TINKER_RUN_DURATION);
export const speedFactorAt = speedProfile.speedAt;

export function tinkerRunProgress(time: number, duration = TINKER_RUN_DURATION) {
  return speedProfile.runProgress(time, duration);
}

// ---- ball scale profile -------------------------------------------------------

// Radius of the ball and how far ahead of the camera it rolls, by rail fraction.
// The camera height follows from these so the ball always sits in the lower
// middle of the frame; everything else on the table keeps its true size, which
// is what makes the table look like it shrinks.
type ScaleKnot = readonly [u: number, radius: number, ahead: number];
const SCALE_KNOTS: ScaleKnot[] = [
  [0, 0.45, 5],
  [0.13, 0.5, 5.3],
  [0.2, 1.5, 10],
  [0.36, 1.7, 10.6],
  [0.44, 3.6, 19],
  [0.6, 3.9, 20],
  [0.66, 4.3, 21.5],
  [1, 4.8, 23],
];
const CAMERA_DROP = 0.42; // camera height above the ball's top ≈ ahead × this

export type BallProfile = { radius: number; ahead: number; cameraHeight: number };

export function ballProfileAt(u: number): BallProfile {
  const t = MathUtils.clamp(u, 0, 1);
  let radius = SCALE_KNOTS[SCALE_KNOTS.length - 1][1];
  let ahead = SCALE_KNOTS[SCALE_KNOTS.length - 1][2];
  for (let i = 1; i < SCALE_KNOTS.length; i += 1) {
    if (t <= SCALE_KNOTS[i][0]) {
      const [u0, r0, a0] = SCALE_KNOTS[i - 1];
      const [u1, r1, a1] = SCALE_KNOTS[i];
      const k = MathUtils.smoothstep(t, u0, u1);
      radius = MathUtils.lerp(r0, r1, k);
      ahead = MathUtils.lerp(a0, a1, k);
      break;
    }
  }
  return { radius, ahead, cameraHeight: radius + CAMERA_DROP * ahead };
}

// ---- rail --------------------------------------------------------------------

// Seventeen stations forty units apart: a lively S-road scratched across the
// table, with the widest sweeps saved for the Spill's turns. Height is the
// camera height from the scale profile.
const RAIL_X = [0, 2, -4, -12, -8, 4, 14, 12, -2, -16, -12, 4, 18, 14, -6, -10, 0];
const RAIL_STEP = 40;

export function createTinkerRail() {
  const points = RAIL_X.map((x, index) => {
    const u = index / (RAIL_X.length - 1);
    return new Vector3(x, ballProfileAt(u).cameraHeight, -index * RAIL_STEP);
  });
  return new CatmullRomCurve3(points, false, 'catmullrom', 0.5);
}

/** Rail parameter the camera occupies at run time `t`. */
export const railU = (time: number) => tinkerRunProgress(time);

// ---- spawn timeline ------------------------------------------------------------

const ACT_SCALE = { marble: 1, tennis: 2.3, melon: 4.6, spill: 4.8 } as const;
const ACT_LEAD = { marble: 4.0, tennis: 3.6, melon: 3.0, spill: 3.0 } as const;
// Bird altitude is authored above the camera's eye line of that act so the sky
// stays populated as the camera climbs.
const ACT_EYE = { marble: 2.55, tennis: 5.7, melon: 11.6, spill: 13.6 } as const;
type Act = keyof typeof ACT_SCALE;

const beetles = (time: number, act: Act, list: Array<[x: number, amp: number, rate?: number]>): TinkerSpawnEntry[] =>
  list.map(([x, amp, rate], index) => ({
    time: time + index * 0.11,
    kind: 'beetle',
    data: {
      role: 'beetle',
      lead: ACT_LEAD[act],
      x: x * ACT_SCALE[act],
      amp: amp * ACT_SCALE[act],
      rate: rate ?? 1.35 + (index % 3) * 0.2,
      phase: index * 1.9,
      scale: ACT_SCALE[act],
    },
  }));

const striders = (time: number, act: Act, xs: number[]): TinkerSpawnEntry[] =>
  xs.map((x, index) => ({
    time: time + index * 0.16,
    kind: 'strider',
    data: { role: 'strider', lead: ACT_LEAD[act] + 0.3, x: x * ACT_SCALE[act], stride: 1.6 + (index % 2) * 0.35, scale: ACT_SCALE[act] },
  }));

const snappers = (
  time: number,
  act: Act,
  runs: Array<{ from: number; to: number; up: number; arc?: number; spit?: boolean; cross?: number }>,
): TinkerSpawnEntry[] =>
  runs.map((run, index) => ({
    time: time + index * 0.14,
    kind: 'snapper',
    data: {
      role: 'snapper',
      lead: ACT_LEAD[act] + 0.4,
      fromX: run.from * ACT_SCALE[act],
      toX: run.to * ACT_SCALE[act],
      altitude: ACT_EYE[act] + run.up * ACT_SCALE[act],
      arc: (run.arc ?? 1.2) * ACT_SCALE[act],
      crossTime: run.cross ?? 2.4,
      spit: run.spit ?? false,
      scale: ACT_SCALE[act],
    },
  }));

function buildTimeline(spillEntries: TinkerSpawnEntry[]): TinkerSpawnEntry[] {
  return [
    // --- Marble. Wide, slow, readable: learn the sweep among the buttons.
    ...beetles(bar(1.5), 'marble', [[-5, 2.2], [1, 1.6], [6, 2.4]]),
    ...striders(bar(3), 'marble', [-6.5, 6.5]),
    ...beetles(bar(4), 'marble', [[-7.5, 2], [-2.5, 1.4], [2.5, 1.4], [7.5, 2]]),
    ...snappers(bar(5), 'marble', [
      { from: -14, to: 9, up: 2.6 },
      { from: 12, to: -8, up: 3.8, arc: 1.6 },
    ]),
    ...striders(bar(6), 'marble', [-8, 2, 8]),
    ...beetles(bar(7), 'marble', [[-6, 2.4], [0.5, 1.8], [6, 2.4]]),
    ...snappers(bar(7.25), 'marble', [{ from: 10, to: -12, up: 3.2, spit: true }]),

    // --- Tennis ball. The clutter gets heavier and the birds start snapping.
    ...beetles(bar(8.25), 'tennis', [[-7, 2], [-3.5, 1.5], [1, 1.2], [4, 1.6], [7.5, 2.2]]),
    ...snappers(bar(9.5), 'tennis', [
      { from: -13, to: 9, up: 2.4, spit: true },
      { from: 12, to: -10, up: 3.6, arc: 1.8 },
      { from: -9, to: 13, up: 4.6, arc: 0.8, spit: true },
    ]),
    ...striders(bar(10.5), 'tennis', [-6.5, 1.5, 6.5]),
    ...beetles(bar(11.5), 'tennis', [[-8, 2.4], [-3, 1.6], [3, 1.6], [8, 2.4]]),
    ...striders(bar(11.75), 'tennis', [0.5]),
    ...snappers(bar(12.5), 'tennis', [
      { from: 11, to: -12, up: 3, spit: true },
      { from: -12, to: 10, up: 4.2, arc: 1.4 },
    ]),
    ...beetles(bar(12.75), 'tennis', [[-6, 1.8], [6, 1.8]]),
    ...striders(bar(13.5), 'tennis', [-8, -2.5, 2.5, 8]),
    ...snappers(bar(14.5), 'tennis', [
      { from: -14, to: 8, up: 2.6, spit: true },
      { from: 13, to: -9, up: 3.4, arc: 1.6, spit: true },
      { from: -8, to: 14, up: 4.4, arc: 1, spit: true },
    ]),
    ...beetles(bar(15.25), 'tennis', [[-8, 2.2], [-4, 1.6], [0.5, 1.2], [4, 1.6], [8, 2.2]]),

    // --- Melon. Ruler-legged striders and cardboard birds; the road is fast.
    ...striders(bar(16.25), 'melon', [-6, 1, 6]),
    ...beetles(bar(16.5), 'melon', [[-4, 1.6], [4, 1.6], [0.5, 1.1]]),
    ...snappers(bar(17.25), 'melon', [
      { from: -12, to: 9, up: 2.4, spit: true },
      { from: 11, to: -10, up: 3.2, arc: 1.6 },
      { from: -9, to: 12, up: 4.2, arc: 1, spit: true },
      { from: 13, to: -12, up: 5, arc: 0.8 },
    ]),
    ...beetles(bar(18.25), 'melon', [[-8, 2.4], [-5, 1.8], [-1.5, 1.2], [1.5, 1.2], [5, 1.8], [8, 2.4]]),
    ...striders(bar(19), 'melon', [-7.5, -2.5, 2.5, 7.5]),
    ...snappers(bar(19.25), 'melon', [
      { from: -11, to: 11, up: 3, spit: true },
      { from: 11, to: -11, up: 4.4, arc: 1.2, spit: true },
    ]),
    ...beetles(bar(20), 'melon', [[-6, 2], [-2, 1.4], [2, 1.4], [6, 2]]),

    // --- The Spill. Cores first; a few stragglers keep the sky honest.
    ...spillEntries,
    ...snappers(bar(24), 'spill', [
      { from: -12, to: 10, up: 3.2, arc: 1.4 },
      { from: 11, to: -11, up: 4.6, arc: 1 },
    ]),
    ...beetles(bar(26.5), 'spill', [[-8, 2.2], [-3, 1.6], [3, 1.6], [8, 2.2]]),
    ...snappers(bar(28), 'spill', [
      { from: -11, to: 11, up: 3.4, spit: true },
      { from: 12, to: -10, up: 4.8, arc: 1.2 },
    ]),
    // A last sweep of beetles across the clean wood before the coast.
    ...beetles(bar(29.25), 'spill', [[-7, 2], [-2.5, 1.4], [2.5, 1.4], [7, 2]]),
  ];
}

const KILL_SCORE: Record<TinkerEnemyKind, number> = {
  beetle: 100,
  strider: 140,
  snapper: 160,
  glob: 40,
  'spill-core': 800,
  spill: 0,
};

const GLOB_MAX_AGE = 12;
const MISS_MARGIN_U = 0.006;

export function createTinkerBallGameplay(bus: EventBus): LockOnRunnerLevel<TinkerEnemyKind, TinkerSpawnData> {
  const curve = createTinkerRail();
  const interceptions = new Set<number>();
  let hitsTaken = 0;
  let rescued = 0;

  bus.on('runstart', () => {
    interceptions.clear();
    hitsTaken = 0;
    rescued = 0;
  });
  bus.on('playerhit', () => {
    hitsTaken += 1;
  });
  bus.on('fire', ({ enemyId }) => interceptions.add(enemyId));
  bus.on('kill', ({ enemyId }) => interceptions.delete(enemyId));
  bus.on('miss', ({ enemyId }) => interceptions.delete(enemyId));
  onSignal('stick', ({ count }) => {
    rescued = count;
  });

  function fireGlob(context: TinkerUpdate, from: Vector3, scale: number) {
    const initial = hostileShotAimPoint(context.camera, from).sub(from).normalize().multiplyScalar(4 * Math.sqrt(scale));
    context.spawnEnemy({
      time: context.runTime,
      kind: 'glob',
      countsTowardTotal: false,
      data: { role: 'bolt', position: from.clone(), velocity: initial, lastAge: 0, impact: {}, scale },
    });
  }

  const spill = createSpill(bus, { curve, fireGlob });
  const timeline = sortTimeline(buildTimeline(spill.entries(SPILL_TIME)));

  // A point on the table beside the road: rail frame at anchorU, lateral x,
  // absolute height above the table (the rail itself climbs with the ball).
  function seat(anchorU: number, x: number, y: number, along = 0) {
    const frame = sampleRailFrame(curve, anchorU);
    const point = frame.position.clone().addScaledVector(frame.right, x).addScaledVector(frame.tangent, along);
    point.y = TABLE_Y + y;
    return { point, frame };
  }

  function assembling(context: TinkerUpdate) {
    const lockable = context.age >= ASSEMBLE_SECONDS;
    context.enemy.entry.lockable = lockable;
    return !lockable;
  }

  function faceAlong(context: TinkerUpdate, direction: Vector3, bank = 0) {
    const { enemy } = context;
    if (direction.lengthSq() < 1e-6) return;
    const target = enemy.mesh.position.clone().add(direction);
    enemy.mesh.lookAt(target);
    if (bank !== 0) enemy.mesh.rotateZ(bank);
  }

  function updateBeetle(context: TinkerUpdate, data: Extract<TinkerSpawnData, { role: 'beetle' }>) {
    const { enemy, age, runProgress, railAnchor } = context;
    assembling(context);
    const anchorU = railAnchor(data.lead);
    // A quick scuttle with a pause at each end of the zigzag: the sine's sign
    // gives the direction, the shaped magnitude the dash-and-settle rhythm.
    const p = age * data.rate + data.phase;
    const s = Math.sin(p);
    const zig = Math.sign(s) * Math.abs(s) ** 0.55;
    const dzig = Math.cos(p) * data.rate;
    const x = data.x + data.amp * zig;
    const hop = Math.max(0, Math.sin(p * 2)) * 0.12 * data.scale;
    const { point, frame } = seat(anchorU, x, 0.62 * data.scale + hop);
    enemy.mesh.position.copy(point);
    enemy.mesh.scale.setScalar(data.scale * spawnEase(age));
    const heading = frame.right.clone().multiplyScalar(Math.sign(dzig) || 1).addScaledVector(frame.tangent, -0.35);
    heading.y = 0;
    faceAlong(context, heading);
    enemy.mesh.userData.gait = Math.abs(dzig);
    return runProgress > anchorU + MISS_MARGIN_U;
  }

  function updateStrider(context: TinkerUpdate, data: Extract<TinkerSpawnData, { role: 'strider' }>) {
    const { enemy, age, runProgress, railAnchor } = context;
    assembling(context);
    const anchorU = railAnchor(data.lead);
    // Stilt-walks in toward the road, bobbing on every step.
    const approach = 1 - 0.3 * Math.min(1, age / 5);
    const x = data.x * approach + Math.sin(age * 0.7 + data.x) * 0.6 * data.scale;
    const bob = Math.abs(Math.sin(age * data.stride * Math.PI)) * 0.22 * data.scale;
    const { point, frame } = seat(anchorU, x, 2.45 * data.scale + bob);
    enemy.mesh.position.copy(point);
    enemy.mesh.scale.setScalar(data.scale * spawnEase(age));
    const heading = frame.tangent.clone().negate().addScaledVector(frame.right, -Math.sign(x) * 0.25 + Math.sin(age * 0.9) * 0.2);
    heading.y = 0;
    faceAlong(context, heading);
    enemy.mesh.userData.gait = data.stride;
    return runProgress > anchorU + MISS_MARGIN_U;
  }

  function updateSnapper(context: TinkerUpdate, data: Extract<TinkerSpawnData, { role: 'snapper' }>) {
    const { enemy, age, runProgress, railAnchor } = context;
    assembling(context);
    const anchorU = railAnchor(data.lead);
    // Swoops across the road and back, banking through the turn; the ping-pong
    // keeps it in play until the camera passes under it.
    const t = age / data.crossTime;
    const k = t % 2;
    const s = k < 1 ? k : 2 - k;
    const eased = s * s * (3 - 2 * s);
    const forward = k < 1 ? 1 : -1;
    const x = MathUtils.lerp(data.fromX, data.toX, eased);
    const y = data.altitude + Math.sin(s * Math.PI) * data.arc + Math.sin(age * 9) * 0.12 * data.scale;
    const { point, frame } = seat(anchorU, x, y);
    enemy.mesh.position.copy(point);
    enemy.mesh.scale.setScalar(data.scale * spawnEase(age));
    const dx = Math.sign(data.toX - data.fromX) * forward;
    const heading = frame.right.clone().multiplyScalar(dx).addScaledVector(frame.tangent, -0.3);
    heading.y = Math.cos(s * Math.PI) * forward * 0.35;
    faceAlong(context, heading, -dx * 0.35 * Math.sin(s * Math.PI));
    enemy.mesh.userData.gait = 1;

    if (data.spit) {
      const spit = context.enemyState(() => ({ nextAt: ASSEMBLE_SECONDS + 1.1, shotsLeft: 1 }));
      if (spit.shotsLeft > 0 && age >= spit.nextAt) {
        spit.shotsLeft -= 1;
        enemy.mesh.userData.snapAt = age;
        fireGlob(context, enemy.mesh.position.clone().addScaledVector(frame.tangent, -0.8 * data.scale), data.scale);
      }
    }
    return runProgress > anchorU + MISS_MARGIN_U;
  }

  function updateGlob(context: TinkerUpdate, data: Extract<TinkerSpawnData, { role: 'bolt' }>) {
    const { enemy, age, camera, damagePlayer } = context;
    const dt = Math.max(0, age - data.lastAge);
    data.lastAge = age;
    enemy.mesh.scale.setScalar(0.55 + 0.45 * Math.sqrt(data.scale));

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
      if (impact.damaged) {
        damagePlayer(1);
        return true;
      }
      return false;
    }

    const k = Math.sqrt(data.scale);
    steerHomingShot(data.position, data.velocity, hostileShotAimPoint(camera, data.position), age, dt, {
      baseSpeed: 3.6 * k,
      maxSpeed: 8.5 * k,
      accel: 2.2 * k,
      turnRate: 2.1,
    });
    enemy.mesh.position.copy(data.position);
    if (data.velocity.lengthSq() > 0.001) enemy.mesh.lookAt(data.position.clone().add(data.velocity));
    return age > GLOB_MAX_AGE || shotBehindCamera(camera, data.position);
  }

  return {
    duration: TINKER_RUN_DURATION,
    bpm: TINKER_BPM,
    playerHealth: TINKER_PLAYER_HEALTH,
    createRail: createTinkerRail,
    spawnTimeline: timeline,
    easeRunProgress: tinkerRunProgress,
    // A pop level at 128 BPM: cap the coarsest volley grid at a half bar so a
    // six-lock release lands inside one phrase instead of dragging past it.
    timing: { shotDelay: { maxGridSeconds: 0.94 } },
    updateEnemy(context) {
      const data = context.enemy.entry.data;
      switch (data.role) {
        case 'beetle':
          return updateBeetle(context, data);
        case 'strider':
          return updateStrider(context, data);
        case 'snapper':
          return updateSnapper(context, data);
        case 'bolt':
          return updateGlob(context, data);
        case 'core':
          return spill.update(context, data);
        case 'spill':
          return spill.updateAnchor(context);
      }
    },
    scoreForKill(volleySize, enemy) {
      const multiplier = 1 + Math.max(0, volleySize - 1) * 0.16;
      return Math.round(KILL_SCORE[enemy.kind] * multiplier);
    },
    // Cracking a shell layer on a core pays a little.
    scoreForHit: () => 60,
    scoreForVolley(results) {
      if (results.length < 4 || !results.every((result) => result.killed)) return 0;
      return results.length === 6 ? 400 : results.length * 50;
    },
    rankForRun(score, kills, totalEnemies) {
      const clearRate = totalEnemies === 0 ? 0 : kills / totalEnemies;
      if (spill.snapped() && score >= 13500 && clearRate >= 0.85) return 'S';
      if (score >= 9500 && clearRate >= 0.65) return 'A';
      if (score >= 6000 && clearRate >= 0.45) return 'B';
      if (score >= 2500 && clearRate >= 0.25) return 'C';
      return 'D';
    },
    detailsForRun() {
      const shine = Math.max(0, TINKER_PLAYER_HEALTH - hitsTaken);
      const lines = [`Shine ${shine}/${TINKER_PLAYER_HEALTH}`];
      if (rescued > 0) lines.push(`${rescued} supplies rescued`);
      const summary = spill.summary();
      if (summary) lines.push(summary);
      return lines;
    },
  };
}

function spawnEase(age: number) {
  const t = Math.min(1, age / 0.45);
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return Math.max(0.02, 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2);
}

/** Which size act a run time falls in: for callouts and audio/visual staging. */
export function actAt(runTime: number): 'marble' | 'tennis' | 'melon' | 'spill' | 'clean' {
  if (runTime < TENNIS_TIME) return 'marble';
  if (runTime < MELON_TIME) return 'tennis';
  if (runTime < SPILL_TIME) return 'melon';
  if (runTime < CLEAN_TIME) return 'spill';
  return 'clean';
}
