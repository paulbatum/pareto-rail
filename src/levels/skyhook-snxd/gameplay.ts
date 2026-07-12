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
import { createLamprey, createLampreyEntries } from './lamprey';
import { BREACH_TIME, SKYHOOK_BPM, SKYHOOK_DURATION, bar } from './timing';

// SKYHOOK — 60 seconds up a space-elevator tether, defending the climber car
// from the weather to the station:
//
//   Storm        (bars 0–8)    Grey murk, rain, wind-riding gliders and sprites.
//   Cloudbreak   (bar 8)       Punch through the deck into sunlit blue. Drop.
//   Jetstream    (bars 8–16)   Squalls, and the first sappers going for the car.
//   Stratosphere (bars 16–20)  The air thins to indigo; vacuum hardware arrives.
//   The Lamprey  (bars 19–29)  Something huge takes the tether overhead and
//                              climbs down. Cut it loose before it reaches the car.
//   Dock         (bars 29–32)  The station swallows the car. Deceleration, quiet.
//
// The climb is authored as a straight 64° ribbon: steep enough that the sky
// owns the frame and the world visibly falls away, shallow enough that the
// shared camera rig stays stable.

export {
  BOSS_TIME,
  BREACH_TIME,
  CLOUDBREAK_TIME,
  DOCK_TIME,
  SKYHOOK_BPM,
  SKYHOOK_DURATION,
  STRATOSPHERE_TIME,
  bar,
} from './timing';

export const SKYHOOK_PLAYER_HEALTH = 3;

// ---- climb geometry ---------------------------------------------------------

// One straight tether owns the level. The rail (camera path) sways around it
// in the weather and steadies as the air thins; the car and the boss both live
// on the tether line itself.
export const CLIMB_LENGTH = 940;
export const CLIMB_DIR = new Vector3(0, 0.9026, -0.4305).normalize();
export const FRAME_RIGHT = new Vector3(1, 0, 0);
export const FRAME_UP = new Vector3().crossVectors(FRAME_RIGHT, CLIMB_DIR).normalize();
// Camera rides above and right of the tether ribbon: you stand watch on top
// of the car, looking up the line, and the ribbon sweeps from the lower-left
// corner to the vanishing point without shadowing the sky where targets live.
const TETHER_SIDE = new Vector3()
  .addScaledVector(FRAME_RIGHT, -4.6)
  .addScaledVector(FRAME_UP, -5.2);
export const CAR_LEAD_SECONDS = 1.35;

export function tetherPoint(s: number, out = new Vector3()) {
  return out.copy(CLIMB_DIR).multiplyScalar(s).add(TETHER_SIDE);
}

/** Distance along the climb axis for any world position. */
export function climbDistance(position: Vector3) {
  return position.dot(CLIMB_DIR);
}

export function createSkyhookRail() {
  const points: Vector3[] = [];
  const N = 16;
  for (let i = 0; i <= N; i += 1) {
    const s = (CLIMB_LENGTH * i) / N;
    const settle = 1 - s / CLIMB_LENGTH;
    const swayX = Math.sin(s * 0.021 + 0.8) * (4.4 * settle ** 1.6 + 0.5);
    const swayU = Math.cos(s * 0.013) * (2.4 * settle ** 1.4 + 0.3);
    points.push(
      new Vector3()
        .copy(CLIMB_DIR)
        .multiplyScalar(s)
        .addScaledVector(FRAME_RIGHT, swayX)
        .addScaledVector(FRAME_UP, swayU),
    );
  }
  return new CatmullRomCurve3(points, false, 'catmullrom', 0.35);
}

// ---- speed profile → rail easing --------------------------------------------

// Launch heavy in the weather, surge through the cloud deck on the drop, run
// clean and fast in thin air, then decelerate hard into the docking collar.
const SPEED_KEYS: Array<[number, number]> = [
  [bar(0), 0.6],
  [bar(4), 0.85],
  [bar(7.6), 0.95],
  [bar(8.35), 1.8],
  [bar(9.6), 1.3],
  [bar(14), 1.3],
  [bar(18), 1.45],
  [bar(20), 1.35],
  [bar(27), 1.35],
  [bar(29), 1.0],
  [bar(30.5), 0.4],
  [bar(32), 0.18],
];

const speedProfile = createSpeedProfile(SPEED_KEYS, SKYHOOK_DURATION);
export const speedFactorAt = speedProfile.speedAt;

export function skyhookRunProgress(time: number, duration = SKYHOOK_DURATION) {
  return speedProfile.runProgress(time, duration);
}

/** Rail parameter the camera occupies at run time `t` — for placing set pieces. */
export const railU = (time: number) => skyhookRunProgress(time);

/** Tether distance of the climber car at run time `t`. */
export function carClimbDistanceAt(curve: CatmullRomCurve3, runTime: number) {
  const u = skyhookRunProgress(Math.min(SKYHOOK_DURATION, runTime + CAR_LEAD_SECONDS));
  return climbDistance(curve.getPointAt(MathUtils.clamp(u, 0, 1)));
}

/** World position of the climber car (it rides the tether line, not the swaying rail). */
export function carPosition(curve: CatmullRomCurve3, runTime: number, out = new Vector3()) {
  return tetherPoint(carClimbDistanceAt(curve, runTime), out);
}

// Latch points on the car frame, in (right, frame-up) coordinates. The car
// body hangs below the ribbon, so its flanks and belly are what sappers grab.
export const CAR_LATCH_POINTS: Array<[number, number]> = [[1.7, -1.2], [-1.7, -1.2], [1.2, -2.6], [-1.2, -2.6]];

export function carLatchPoint(curve: CatmullRomCurve3, runTime: number, latch: number, out = new Vector3()) {
  carPosition(curve, runTime, out);
  const [x, y] = CAR_LATCH_POINTS[latch % CAR_LATCH_POINTS.length];
  return out.addScaledVector(FRAME_RIGHT, x).addScaledVector(FRAME_UP, y);
}

// ---- spawn data --------------------------------------------------------------

export type SkyhookEnemyKind =
  | 'glider'
  | 'sprite'
  | 'sapper'
  | 'spiker'
  | 'breaker'
  | 'bolt'
  | 'claw'
  | 'maw';

// Timeline data is immutable — the engine reuses the timeline across runs.
// Per-enemy runtime state lives in enemyState bags; boss state lives in the
// lamprey module; dynamically spawned bolts get fresh data objects.
export type SkyhookSpawnData =
  | { role: 'glider'; lead: number; fromX: number; toX: number; y: number; arc: number; delay: number; crossTime: number }
  | { role: 'sprite'; lead: number; x: number; holdY: number; delay: number }
  | { role: 'sapper'; latch: number; fromX: number; fromY: number }
  | { role: 'spiker'; lead: number; x: number; y: number; seed: number }
  | { role: 'breaker'; leaveAge: number }
  | { role: 'bolt'; position: Vector3; velocity: Vector3; lastAge: number; impact: HostileShotImpactState }
  | { role: 'claw'; socket: number }
  | { role: 'maw' };

export type SkyhookSpawnEntry = LockOnSpawnEntry<SkyhookEnemyKind, SkyhookSpawnData>;
export type SkyhookUpdate = LockOnEnemyUpdate<SkyhookEnemyKind, SkyhookSpawnData>;

// ---- spawn timeline -----------------------------------------------------------

const gliders = (
  time: number,
  lead: number,
  runs: Array<{ fromX: number; toX: number; y: number; arc: number; delay?: number; crossTime?: number }>,
): SkyhookSpawnEntry[] =>
  runs.map((run, index) => ({
    time: time + index * 0.09,
    kind: 'glider',
    data: {
      role: 'glider',
      lead,
      fromX: run.fromX,
      toX: run.toX,
      y: run.y,
      arc: run.arc,
      delay: run.delay ?? index * 0.36,
      crossTime: run.crossTime ?? 2.7,
    },
  }));

const sprites = (time: number, lead: number, columns: Array<[number, number]>): SkyhookSpawnEntry[] =>
  columns.map(([x, holdY], index) => ({
    time: time + index * 0.12,
    kind: 'sprite',
    data: { role: 'sprite', lead, x, holdY, delay: index * 0.34 },
  }));

const sappers = (time: number, drops: Array<{ latch: number; fromX: number; fromY?: number }>): SkyhookSpawnEntry[] =>
  drops.map((drop, index) => ({
    time: time + index * 0.4,
    kind: 'sapper',
    data: { role: 'sapper', latch: drop.latch, fromX: drop.fromX, fromY: drop.fromY ?? 6 },
  }));

const spikers = (time: number, lead: number, posts: Array<[number, number]>): SkyhookSpawnEntry[] =>
  posts.map(([x, y], index) => ({
    time: time + index * 0.22,
    kind: 'spiker',
    data: { role: 'spiker', lead, x, y, seed: index * 2.17 + time },
  }));

function buildTimeline(lampreyEntries: SkyhookSpawnEntry[]): SkyhookSpawnEntry[] {
  return [
    // --- Storm: learn the sweep among wind-riders. Wide crossings, low light.
    ...gliders(bar(1), 3.8, [
      { fromX: -25, toX: 25, y: 3, arc: 3.2 },
      { fromX: -25, toX: 25, y: 8.5, arc: 2.0 },
    ]),
    ...gliders(bar(2.5), 3.8, [
      { fromX: 25, toX: -25, y: -4.5, arc: 3.4 },
      { fromX: 25, toX: -25, y: 2.5, arc: 2.6 },
      { fromX: 25, toX: -25, y: 9.5, arc: 1.8 },
    ]),
    ...sprites(bar(4), 3.3, [[-20, 1.5], [3, 11], [11, 5.5]]),
    ...gliders(bar(5), 3.8, [
      { fromX: -26, toX: 26, y: -6, arc: 4.4, delay: 0 },
      { fromX: 26, toX: -26, y: 1.5, arc: 3.0, delay: 0.28 },
      { fromX: -26, toX: 26, y: 6.5, arc: 2.4, delay: 0.56 },
      { fromX: 26, toX: -26, y: 11.5, arc: 1.7, delay: 0.84 },
      { fromX: -26, toX: 26, y: -2.5, arc: 3.8, delay: 1.12 },
    ]),
    ...sprites(bar(6.2), 3.3, [[-20, 7.5], [16, 0.5]]),
    ...gliders(bar(6.4), 3.8, [
      { fromX: -24, toX: 24, y: 5, arc: 2.6 },
      { fromX: 24, toX: -24, y: 10.5, arc: 1.8 },
    ]),

    // (bars 7–8.2 kept clear for the cloud deck punch)

    // --- Jetstream: sunlit squalls, and the sappers start going for the car.
    ...gliders(bar(8.3), 3.1, [
      { fromX: -26, toX: 26, y: 0.5, arc: 3.6, delay: 0, crossTime: 2.3 },
      { fromX: 26, toX: -26, y: 5, arc: 2.6, delay: 0.2, crossTime: 2.3 },
      { fromX: -26, toX: 26, y: 9.5, arc: 2.0, delay: 0.4, crossTime: 2.3 },
      { fromX: 26, toX: -26, y: -5, arc: 4.0, delay: 0.6, crossTime: 2.3 },
      { fromX: -26, toX: 26, y: 12, arc: 1.6, delay: 0.8, crossTime: 2.3 },
      { fromX: 26, toX: -26, y: 2.5, arc: 3.0, delay: 1.0, crossTime: 2.3 },
    ]),
    ...sappers(bar(9.5), [{ latch: 0, fromX: 24 }]),
    ...gliders(bar(10.5), 3.0, [
      { fromX: 26, toX: -26, y: 7.5, arc: 2.2, crossTime: 2.4 },
      { fromX: -26, toX: 26, y: 2, arc: 3.0, crossTime: 2.4 },
      { fromX: 26, toX: -26, y: -3.5, arc: 3.6, crossTime: 2.4 },
    ]),
    ...sprites(bar(10.9), 3.0, [[-21, 2.5], [13, 9]]),
    ...sappers(bar(12), [
      { latch: 1, fromX: -24, fromY: 3 },
      { latch: 2, fromX: 20, fromY: -6 },
    ]),
    ...gliders(bar(13.2), 3.0, [
      { fromX: -27, toX: 27, y: -4, arc: 4.2, delay: 0, crossTime: 2.4 },
      { fromX: -27, toX: 27, y: 2, arc: 3.0, delay: 0.3, crossTime: 2.4 },
      { fromX: 27, toX: -27, y: 6.5, arc: 2.4, delay: 0.6, crossTime: 2.4 },
      { fromX: 27, toX: -27, y: 11, arc: 1.8, delay: 0.9, crossTime: 2.4 },
      { fromX: -27, toX: 27, y: -7.5, arc: 4.6, delay: 1.2, crossTime: 2.4 },
    ]),
    { time: bar(14.2), kind: 'breaker', hitStages: [3, 3], data: { role: 'breaker', leaveAge: 15 } },
    ...sprites(bar(15), 2.9, [[-22, 0.5], [4, 10], [14, 5]]),

    // --- Stratosphere: vacuum hardware. Rigid hops and railgun debris.
    ...spikers(bar(16), 3.3, [[-9, 8.5], [9, -1.5]]),
    ...sappers(bar(17.2), [
      { latch: 3, fromX: -22, fromY: 8 },
      { latch: 0, fromX: 24, fromY: 2 },
    ]),
    ...spikers(bar(18), 3.2, [[-10.5, 0.5], [0.5, 11], [10.5, 5]]),

    // --- The Lamprey. Claws gate the maw; the gap is the whole fight.
    ...lampreyEntries,
    ...spikers(bar(23), 4.4, [[-11, 1.5], [11, 9]]),
    ...sappers(bar(25), [{ latch: 1, fromX: -23, fromY: -4 }]),
    // Last stand below the doors: for anyone who has already cut the Lamprey
    // loose, and one more problem for anyone who hasn't.
    ...spikers(bar(26.2), 3.4, [[-9.5, 6.5], [9.5, 1]]),

    // (bars 29–32: the dock. Nothing spawns; the quiet is the payoff.)
  ];
}

export function createSkyhookTimeline() {
  const lamprey = createLampreyEntries(BREACH_TIME + bar(0.2));
  return {
    mawEntry: lamprey.mawEntry,
    clawEntries: lamprey.clawEntries,
    timeline: buildTimeline(lamprey.timeline).sort((a, b) => a.time - b.time),
  };
}

const KILL_SCORE: Record<SkyhookEnemyKind, number> = {
  glider: 100,
  sprite: 120,
  sapper: 260,
  spiker: 180,
  breaker: 380,
  bolt: 40,
  claw: 420,
  maw: 2500,
};

const BOLT_MAX_AGE = 12;
const SAPPER_APPROACH = 2.3;
const SAPPER_DRILL = 3.4;

export function createSkyhookGameplay(bus: EventBus): LockOnRunnerLevel<SkyhookEnemyKind, SkyhookSpawnData> {
  const { timeline, mawEntry, clawEntries } = createSkyhookTimeline();

  const interceptions = new Set<number>();
  let hitsTaken = 0;
  let sappersPried = 0;
  let boltsShot = 0;

  bus.on('runstart', () => {
    interceptions.clear();
    hitsTaken = 0;
    sappersPried = 0;
    boltsShot = 0;
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

  function fireBolt(context: SkyhookUpdate, from: Vector3) {
    const initial = hostileShotAimPoint(context.camera, from).sub(from).normalize().multiplyScalar(5.5);
    context.spawnEnemy({
      time: context.runTime,
      kind: 'bolt',
      countsTowardTotal: false,
      data: { role: 'bolt', position: from.clone(), velocity: initial, lastAge: 0, impact: {} },
    });
  }

  const lamprey = createLamprey(bus, {
    mawEntry,
    clawEntries,
    tetherPoint,
    climbDistance,
    frameRight: FRAME_RIGHT,
    frameUp: FRAME_UP,
    spawnBossBolt: fireBolt,
  });

  // ---- movement ---------------------------------------------------------------

  function updateGlider(context: SkyhookUpdate, data: Extract<SkyhookSpawnData, { role: 'glider' }>) {
    const { enemy, runProgress, age, curve, railAnchor } = context;
    const anchorU = railAnchor(data.lead);
    const t = (age - data.delay) / data.crossTime;
    if (t > 1.15 || runProgress > anchorU + 0.012) return true;
    const clamped = MathUtils.clamp(t, 0, 1);
    const eased = clamped * clamped * (3 - 2 * clamped);
    const x = MathUtils.lerp(data.fromX, data.toX, eased);
    // Gust bob rides on top of the authored crossing arc.
    const y = data.y + Math.sin(clamped * Math.PI) * data.arc + Math.sin(age * 6.5 + enemy.id) * 0.3;
    enemy.mesh.position.copy(offsetFromRail(curve, anchorU, new Vector3(x, y, 0)));
    const ahead = offsetFromRail(curve, anchorU, new Vector3(
      MathUtils.lerp(data.fromX, data.toX, Math.min(1, eased + 0.05)),
      data.y + Math.sin(Math.min(1, clamped + 0.05) * Math.PI) * data.arc,
      0,
    ));
    enemy.mesh.lookAt(ahead);
    // Bank into the crossing; the roll is the wind.
    enemy.mesh.rotateZ((data.toX > data.fromX ? -1 : 1) * (0.5 + Math.sin(clamped * Math.PI) * 0.5));
    return false;
  }

  function updateSprite(context: SkyhookUpdate, data: Extract<SkyhookSpawnData, { role: 'sprite' }>) {
    const { enemy, runProgress, age, curve, railAnchor } = context;
    const anchorU = railAnchor(data.lead);
    const t = age - data.delay;
    const RISE = 1.5;
    const HOLD = 1.8;
    let y: number;
    if (t < RISE) {
      // Ride the updraft in from the bottom of the frame.
      const k = MathUtils.clamp(t / RISE, 0, 1);
      y = MathUtils.lerp(-30, data.holdY, 1 - (1 - k) ** 2.4);
    } else if (t < RISE + HOLD) {
      y = data.holdY + Math.sin((t - RISE) * 5) * 0.4;
    } else {
      // The updraft dies; it stalls and drops away below the car.
      const fall = t - RISE - HOLD;
      y = data.holdY - fall * fall * 14;
    }
    if (y < -34 || runProgress > anchorU + 0.012) return true;
    const x = data.x + Math.sin(age * 2.4 + enemy.id) * 0.7;
    enemy.mesh.position.copy(offsetFromRail(curve, anchorU, new Vector3(x, y, 0)));
    enemy.mesh.quaternion.copy(context.camera.quaternion);
    enemy.mesh.rotateZ(Math.sin(age * 3.1 + enemy.id * 1.7) * 0.35);
    return false;
  }

  function updateSapper(context: SkyhookUpdate, data: Extract<SkyhookSpawnData, { role: 'sapper' }>) {
    const { enemy, runTime, age, curve, camera, damagePlayer } = context;
    const latchTarget = carLatchPoint(curve, runTime, data.latch);

    if (age < SAPPER_APPROACH) {
      // Swoop in from the flank, converging on the latch point.
      const k = age / SAPPER_APPROACH;
      const eased = k * k * (3 - 2 * k);
      const from = carPosition(curve, runTime, new Vector3())
        .addScaledVector(FRAME_RIGHT, data.fromX)
        .addScaledVector(FRAME_UP, data.fromY)
        .addScaledVector(CLIMB_DIR, 26 * (1 - eased));
      enemy.mesh.position.copy(from.lerp(latchTarget, eased));
      enemy.mesh.position.addScaledVector(FRAME_UP, Math.sin(k * Math.PI) * 3.2);
      enemy.mesh.lookAt(latchTarget);
      enemy.mesh.userData.drilling = false;
      return false;
    }

    const latchedFor = age - SAPPER_APPROACH;
    if (latchedFor < SAPPER_DRILL) {
      // Latched: it chews on the car until pried off. Kill it before the
      // drill lamp goes solid.
      enemy.mesh.position.copy(latchTarget);
      enemy.mesh.position.addScaledVector(FRAME_RIGHT, Math.sin(age * 31) * 0.06);
      enemy.mesh.quaternion.copy(camera.quaternion);
      enemy.mesh.userData.drilling = true;
      enemy.mesh.userData.drillProgress = latchedFor / SAPPER_DRILL;
      return false;
    }

    // Drill complete: one bite out of the hull, then it kicks off and drops.
    const drillState = context.enemyState(() => ({ bit: false }));
    if (!drillState.bit) {
      drillState.bit = true;
      damagePlayer(1);
    }
    const fall = latchedFor - SAPPER_DRILL;
    enemy.mesh.position
      .copy(latchTarget)
      .addScaledVector(FRAME_RIGHT, (data.latch % 2 === 0 ? 1 : -1) * fall * 9)
      .addScaledVector(FRAME_UP, -fall * fall * 22);
    enemy.mesh.rotation.z += fall * 0.4;
    enemy.mesh.userData.drilling = false;
    return fall > 1.1;
  }

  function updateSpiker(context: SkyhookUpdate, data: Extract<SkyhookSpawnData, { role: 'spiker' }>) {
    const { enemy, runProgress, age, curve, camera, railAnchor } = context;
    const anchorU = railAnchor(data.lead);
    const state = context.enemyState(() => ({
      x: data.x,
      y: data.y,
      fromX: data.x,
      fromY: data.y,
      toX: data.x,
      toY: data.y,
      hopAt: 1.4 + (data.seed % 0.7),
      hopStarted: -1,
      fireAt: 1.9 + (data.seed % 0.9),
    }));

    // Thruster hops: dead-still station keeping, then a hard 0.3 s reposition.
    if (age >= state.hopAt) {
      state.hopStarted = age;
      state.fromX = state.x;
      state.fromY = state.y;
      const jitter = (n: number) => (Math.sin(data.seed * 37.7 + age * n) * 0.5 + 0.5) * 2 - 1;
      state.toX = MathUtils.clamp(data.x + jitter(11) * 3.2, -11, 11);
      state.toY = MathUtils.clamp(data.y + jitter(17) * 2.6, 0.5, 8.5);
      state.hopAt = age + 1.9 + (Math.abs(jitter(23)) * 0.7);
    }
    if (state.hopStarted >= 0) {
      const k = MathUtils.clamp((age - state.hopStarted) / 0.3, 0, 1);
      const snap = 1 - (1 - k) ** 3;
      state.x = MathUtils.lerp(state.fromX, state.toX, snap);
      state.y = MathUtils.lerp(state.fromY, state.toY, snap);
      enemy.mesh.userData.hopping = k < 1;
    }

    // Railgun cadence with a readable wind-up.
    const untilShot = state.fireAt - age;
    enemy.mesh.userData.charge = untilShot < 0.8 ? 1 - untilShot / 0.8 : 0;
    if (age >= state.fireAt) {
      state.fireAt = age + 3.6;
      fireBolt(context, enemy.mesh.position);
    }

    enemy.mesh.position.copy(offsetFromRail(curve, anchorU, new Vector3(state.x, state.y, 0)));
    enemy.mesh.quaternion.copy(camera.quaternion);
    enemy.mesh.rotateZ(Math.sin(data.seed + age * 0.4) * 0.3);
    return runProgress > anchorU + 0.012;
  }

  function updateBreaker(context: SkyhookUpdate, data: Extract<SkyhookSpawnData, { role: 'breaker' }>) {
    const { enemy, runTime, age, camera } = context;
    // A hardened crawler that descends the tether toward the car — the
    // Lamprey's opening argument, at a survivable scale.
    const carS = climbDistance(camera.position) + 22;
    const close = MathUtils.clamp(age / 9, 0, 1);
    const gap = MathUtils.lerp(150, 17, 1 - (1 - close) ** 2);
    tetherPoint(carS + gap + Math.sin(runTime * 2.3) * 0.8, enemy.mesh.position);
    enemy.mesh.position.addScaledVector(FRAME_RIGHT, Math.sin(age * 0.9) * 0.5);
    enemy.mesh.lookAt(camera.position);
    if (enemy.hitStageIndex > 0) {
      enemy.mesh.position.x += Math.sin(age * 19) * 0.1;
      enemy.mesh.userData.cracked = true;
    }
    if (age > data.leaveAge) {
      // Unbeaten, it lets go and drops past the car.
      const fall = age - data.leaveAge;
      enemy.mesh.position.addScaledVector(FRAME_UP, -fall * fall * 30);
      return fall > 1.2;
    }
    return false;
  }

  function updateBolt(context: SkyhookUpdate, data: Extract<SkyhookSpawnData, { role: 'bolt' }>) {
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
      enemy.mesh.rotateZ(age * 8);
      if (impact.damaged) {
        damagePlayer(1);
        return true;
      }
      return false;
    }

    steerHomingShot(data.position, data.velocity, hostileShotAimPoint(camera, data.position), age, dt, {
      baseSpeed: 6,
      maxSpeed: 13,
      accel: 3.2,
      turnRate: 2.5,
    });
    enemy.mesh.position.copy(data.position);
    if (data.velocity.lengthSq() > 0.001) enemy.mesh.lookAt(data.position.clone().add(data.velocity));
    return age > BOLT_MAX_AGE || shotBehindCamera(camera, data.position);
  }

  // ---- level definition ---------------------------------------------------------

  return {
    duration: SKYHOOK_DURATION,
    bpm: SKYHOOK_BPM,
    playerHealth: SKYHOOK_PLAYER_HEALTH,
    createRail: createSkyhookRail,
    spawnTimeline: timeline,
    easeRunProgress: skyhookRunProgress,
    startWord: 'ASCEND',
    updateEnemy(context) {
      const data = context.enemy.entry.data;
      switch (data.role) {
        case 'glider':
          return updateGlider(context, data);
        case 'sprite':
          return updateSprite(context, data);
        case 'sapper':
          return updateSapper(context, data);
        case 'spiker':
          return updateSpiker(context, data);
        case 'breaker':
          return updateBreaker(context, data);
        case 'bolt':
          return updateBolt(context, data);
        case 'claw':
          return lamprey.updateClaw(context, data);
        case 'maw':
          return lamprey.updateMaw(context, data);
      }
    },
    scoreForKill(volleySize, enemy) {
      if (enemy.kind === 'sapper') sappersPried += 1;
      if (enemy.kind === 'bolt') boltsShot += 1;
      const multiplier = 1 + Math.max(0, volleySize - 1) * 0.18;
      return Math.round(KILL_SCORE[enemy.kind] * multiplier);
    },
    // Chipping armor (breaker plates, claws, the maw) pays a little.
    scoreForHit: () => 45,
    scoreForVolley(results) {
      if (results.length < 4) return 0;
      if (!results.every((result) => result.killed)) return 0;
      return results.length === 6 ? 500 : results.length * 60;
    },
    rankForRun(score, kills, totalEnemies) {
      const clearRate = totalEnemies === 0 ? 0 : kills / totalEnemies;
      if (lamprey.mawKilled() && score >= 12800 && clearRate >= 0.94) return 'S';
      if (score >= 10500 && clearRate >= 0.68) return 'A';
      if (score >= 5800 && clearRate >= 0.42) return 'B';
      if (score >= 2400 && clearRate >= 0.2) return 'C';
      return 'D';
    },
    detailsForRun() {
      const hull = Math.max(0, SKYHOOK_PLAYER_HEALTH - hitsTaken);
      const lines = [`Car integrity ${hull}/${SKYHOOK_PLAYER_HEALTH}`];
      if (sappersPried > 0) lines.push(`${sappersPried} sapper${sappersPried === 1 ? '' : 's'} pried off the car`);
      if (boltsShot > 0) lines.push(`${boltsShot} debris bolt${boltsShot === 1 ? '' : 's'} shot down`);
      const bossLine = lamprey.summaryLine();
      if (bossLine) lines.push(bossLine);
      return lines;
    },
  };
}
