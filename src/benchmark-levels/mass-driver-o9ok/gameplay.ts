import { CatmullRomCurve3, MathUtils, Vector3 } from 'three';
import type { PerspectiveCamera } from 'three';
import {
  hostileShotAimPoint,
  shotBehindCamera,
  steerHomingShot,
  updateHostileShotImpact,
  type HostileShotImpactState,
} from '../../engine/hostile-shot';
import type { LockOnEnemyUpdate, LockOnRunnerLevel, LockOnSpawnEntry } from '../../engine/lock-on-runner';
import { createRailPacer, type RailLead } from '../../engine/rail-pacer';
import { offsetFromRail } from '../../engine/rail';
import { createSpeedProfile } from '../../engine/speed-profile';
import type { EventBus } from '../../events';
import { bar, CHARGE_TIME, FIRE_TIME, MD_BEAT, MD_BPM, MD_DURATION } from './timing';

// MASS DRIVER — 60 seconds inside an orbital railgun, in five movements at
// 128 BPM (one bar = 1.875 s; 32 bars = exactly 60 s):
//
//   Breech      (0–15s)       The payload seats. Coils close together, arc blue.
//   Accelerate  (15–30s)      The pulse locks in. Defence drones thread the coils.
//   Overdrive   (30–41.25s)   Coils indigo-violet and pulling apart. Heaviest traffic.
//   Charge      (41.25–56.25s) The safety interlocks are jammed and the firing
//                             charge is building. Kill all five before it peaks.
//   Fire        (56.25–60s)   Cleared: the gun fires and throws you out of the
//                             muzzle into silence. Not cleared: the barrel goes.
//
// The rail easing is the normalized integral of the speed profile, and the
// accelerator rings are seated at ring(n) = runProgress(n * beatSeconds). One
// ring per beat is therefore exact at every speed, and the rings visibly pull
// apart as the profile ramps — the spacing IS the acceleration.

export { MD_BPM, MD_DURATION, CHARGE_TIME, FIRE_TIME } from './timing';
export const MD_PLAYER_HEALTH = 3;

export type MassDriverEnemyKind =
  | 'sentry'
  | 'weaver'
  | 'bulwark'
  | 'darter'
  | 'interlock';

export type MassDriverSpawnData =
  // Wall drone orbiting the bore, drifting inward as it closes.
  | { role: 'sentry'; engagement: RailLead; angle: number; radius: number; spin: number; arms: boolean }
  // Needle that threads the gap between two coils, straight through the bore.
  | { role: 'weaver'; engagement: RailLead; fromAngle: number; toAngle: number; radius: number; crossTime: number; delay: number }
  // Armoured blocker grinding down the barrel at you.
  | { role: 'bulwark'; engagement: RailLead; angle: number; radius: number }
  // Drone shot: homing spark, lockable, does not count toward the run total.
  | { role: 'darter'; position: Vector3; velocity: Vector3; lastAge: number; impact: HostileShotImpactState }
  // Jammed safety interlock. Holds station ahead of the payload until killed.
  | { role: 'interlock'; index: number; angle: number; radius: number; holdStart: number; holdEnd: number };

export type MassDriverSpawnEntry = LockOnSpawnEntry<MassDriverEnemyKind, MassDriverSpawnData>;
export type MassDriverUpdate = LockOnEnemyUpdate<MassDriverEnemyKind, MassDriverSpawnData>;

const TAU = Math.PI * 2;

// ---- speed profile → rail easing --------------------------------------------

// Piecewise-linear speed factors. The whole curve only ever goes up: this is a
// gun barrel, there is no braking. The step at bar 30 is the shot itself.
const SPEED_KEYS: Array<[number, number]> = [
  [bar(0), 0.46],
  [bar(4), 0.62],
  [bar(8), 0.88],
  [bar(12), 1.06],
  [bar(16), 1.28],
  [bar(22), 1.6],
  [bar(26), 1.8],
  [bar(29, 3), 1.98],
  [bar(30), 4.3],
  [bar(32), 4.9],
];

const speedProfile = createSpeedProfile(SPEED_KEYS, MD_DURATION);

export const speedFactorAt = speedProfile.speedAt;

export function massDriverRunProgress(time: number, duration = MD_DURATION) {
  return speedProfile.runProgress(time, duration);
}

// ---- rail --------------------------------------------------------------------

const RAIL_LENGTH = 3400;
const RAIL_CONTROL_POINTS = 24;
/** Bore radius. Coils sit here; drones work just inside it. */
export const BORE_RADIUS = 17;
/**
 * Hard ceiling on how far off-axis a drone may drift. Past this it slips behind
 * the bore plating and the player loses the target to level geometry, which is
 * never a fair way to lose one.
 */
const MAX_DRONE_RADIUS = BORE_RADIUS * 0.88;

// A gun is straight. The only curvature is the long lazy helix an orbital
// railgun needs to lie along a planet — enough for the coils to sweep across
// the screen, never enough to hide the muzzle.
export function createMassDriverRail() {
  const points: Vector3[] = [];
  for (let index = 0; index < RAIL_CONTROL_POINTS; index += 1) {
    const t = index / (RAIL_CONTROL_POINTS - 1);
    points.push(new Vector3(
      Math.sin(t * Math.PI * 2.15 + 0.35) * 15 * (1 - t * 0.45),
      Math.sin(t * Math.PI * 1.55 - 0.85) * 10 * (1 - t * 0.45),
      -RAIL_LENGTH * t,
    ));
  }
  return new CatmullRomCurve3(points, false, 'catmullrom', 0.5);
}

const railForPlacement = createMassDriverRail();

/** Rail parameter of accelerator ring `n` — the ring the camera crosses on beat `n`. */
export function ringU(beatIndex: number) {
  return massDriverRunProgress(beatIndex * MD_BEAT);
}

/** Rail parameter the camera occupies at run time `t` — for seating set pieces. */
export const railU = (time: number) => massDriverRunProgress(time);

// ---- rail pacing -------------------------------------------------------------

// The camera ends the run more than four times faster than it starts, so a
// fixed anchor authored for the breech would sit past the fog wall by the time
// the charge phase arrives. The pacer keeps "lead = seconds on screen" true at
// every speed; the leads below are authored in seconds and mean the same thing
// all the way down the barrel.
const SPAWN_AHEAD_UNITS = 290;
const MISS_GRACE = 0.16;

const pacer = createRailPacer({
  curve: railForPlacement,
  duration: MD_DURATION,
  runProgress: massDriverRunProgress,
  spawnAheadUnits: SPAWN_AHEAD_UNITS,
  defaultLeadSeconds: 3.2,
});

// ---- run state ---------------------------------------------------------------

// One gameplay instance exists at a time; visuals and audio read the charge
// through these accessors rather than duplicating the countdown.
const runState = {
  interlocksAlive: 0,
  interlocksCleared: 0,
  interlocksTotal: 0,
  fired: false,
  breached: false,
  hitsTaken: 0,
  dartersPopped: 0,
};

/** 0 → 1 across the charge window. 1 is the moment the charge has to go somewhere. */
export function chargeProgress(runTime: number) {
  return MathUtils.clamp((runTime - CHARGE_TIME) / (FIRE_TIME - CHARGE_TIME), 0, 1);
}

export const interlocksAlive = () => runState.interlocksAlive;
export const interlocksCleared = () => runState.interlocksCleared;
export const interlocksTotal = () => runState.interlocksTotal;
export const gunFired = () => runState.fired;
export const barrelBreached = () => runState.breached;

// ---- spawn timeline ----------------------------------------------------------

/** A full collar of drones around the bore: the sweep the reticle has to walk. */
const collar = (
  time: number,
  lead: number,
  count: number,
  options: { phase?: number; radius?: number; spin?: number; stagger?: number; arms?: boolean } = {},
): MassDriverSpawnEntry[] => {
  const { phase = 0, radius = 11, spin = 0.34, stagger = 0.055, arms = false } = options;
  return Array.from({ length: count }, (_value, index) => ({
    time: time + index * stagger,
    kind: 'sentry' as const,
    data: {
      role: 'sentry' as const,
      engagement: pacer.resolve(time + index * stagger, lead),
      angle: phase + (index / count) * TAU,
      radius,
      spin,
      // Only every other drone in a formation carries a launcher: a six-drone
      // collar answers with three darters, not six.
      arms: arms && index % 2 === 0,
    },
  }));
};

/** A partial arc of drones — a wall across one side of the bore. */
const arc = (
  time: number,
  lead: number,
  fromAngle: number,
  toAngle: number,
  count: number,
  options: { radius?: number; spin?: number; stagger?: number; arms?: boolean } = {},
): MassDriverSpawnEntry[] => {
  const { radius = 12, spin = -0.28, stagger = 0.07, arms = false } = options;
  return Array.from({ length: count }, (_value, index) => {
    const t = count === 1 ? 0.5 : index / (count - 1);
    const time_ = time + index * stagger;
    return {
      time: time_,
      kind: 'sentry' as const,
      data: {
        role: 'sentry' as const,
        engagement: pacer.resolve(time_, lead),
        angle: MathUtils.lerp(fromAngle, toAngle, t),
        radius,
        spin,
        arms: arms && index % 2 === 0,
      },
    };
  });
};

const WEAVER_EXIT = 1.2;

/**
 * A weaver's window is its crossing, not an authored lead — it is gone the
 * moment it is through the bore. The contract is derived from the motion so the
 * engagement report measures the promise the level actually makes.
 */
const weavers = (
  time: number,
  runs: Array<{ from: number; to: number; radius?: number; crossTime?: number; delay?: number }>,
): MassDriverSpawnEntry[] =>
  runs.map((run, index) => {
    const time_ = time + index * 0.04;
    const crossTime = run.crossTime ?? 1.5;
    const delay = run.delay ?? index * 0.2;
    return {
      time: time_,
      kind: 'weaver' as const,
      data: {
        role: 'weaver' as const,
        engagement: pacer.resolve(time_, delay + crossTime * WEAVER_EXIT - 0.15),
        fromAngle: run.from,
        toAngle: run.to,
        radius: run.radius ?? 15.5,
        crossTime,
        delay,
      },
    };
  });

const bulwarks = (time: number, lead: number, placements: Array<[angle: number, radius: number]>): MassDriverSpawnEntry[] =>
  placements.map(([angle, radius], index) => {
    const time_ = time + index * 0.22;
    return {
      time: time_,
      kind: 'bulwark' as const,
      hitStages: [2, 2],
      data: {
        role: 'bulwark' as const,
        engagement: pacer.resolve(time_, lead),
        angle,
        radius,
      },
    };
  });

/**
 * The five jammed interlocks. Unlike everything else in the barrel these are
 * never overtaken: they hold a shrinking distance ahead of the payload until
 * they are destroyed or the charge peaks.
 */
const INTERLOCK_PLACEMENTS: Array<{ at: number; angle: number; radius: number; holdStart: number; holdEnd: number }> = [
  { at: bar(22), angle: TAU * 0.25, radius: 12.0, holdStart: 1.35, holdEnd: 0.85 },
  { at: bar(22, 2), angle: TAU * 0.75, radius: 12.0, holdStart: 1.45, holdEnd: 0.95 },
  { at: bar(23, 2), angle: TAU * 0.02, radius: 14.0, holdStart: 1.3, holdEnd: 0.8 },
  { at: bar(24, 2), angle: TAU * 0.52, radius: 14.0, holdStart: 1.4, holdEnd: 0.9 },
];

const interlockEntries = (): MassDriverSpawnEntry[] =>
  INTERLOCK_PLACEMENTS.map((placement, index) => ({
    time: placement.at,
    kind: 'interlock' as const,
    hitStages: [2, 2],
    data: {
      role: 'interlock' as const,
      index,
      angle: placement.angle,
      radius: placement.radius,
      holdStart: placement.holdStart,
      holdEnd: placement.holdEnd,
    },
  }));

// Choreography reads against the arrangement: collars land on downbeats,
// weaver crossings answer them on the half-bar, bulwarks arrive on the
// four-bar phrase boundaries.
function buildTimeline(): MassDriverSpawnEntry[] {
  return [
    // --- Breech: sparse and legible. Learn the bore, learn the sweep.
    // The very first drones arrive on bar 1 so the run never opens on an empty
    // barrel — there is something to sweep before the kick even lands.
    ...arc(bar(1), 2.65, TAU * 0.15, TAU * 0.35, 2, { radius: 13 }),
    ...arc(bar(2), 2.55, TAU * 0.05, TAU * 0.45, 3, { radius: 15.5 }),
    ...arc(bar(4), 2.55, TAU * 0.55, TAU * 0.95, 3, { radius: 14, spin: 0.3 }),
    ...weavers(bar(5, 2), [
      { from: TAU * 0.0, to: TAU * 0.5 },
      { from: TAU * 0.5, to: TAU * 1.0, delay: 0.42 },
    ]),

    // --- Accelerate: the pulse locks in and the coils start pulling apart.
    // The first full collar is the level teaching its signature sweep.
    ...collar(bar(8), 2.35, 6, { phase: TAU * 0.08, radius: 15, arms: true }),
    ...weavers(bar(9, 2), [
      { from: TAU * 0.12, to: TAU * 0.62 },
      { from: TAU * 0.62, to: TAU * 0.12, delay: 0.26 },
    ]),
    ...bulwarks(bar(10), 3.4, [[TAU * 0.25, 7]]),
    ...arc(bar(11, 2), 2.25, TAU * 0.12, TAU * 0.38, 3, { radius: 14.5, spin: 0.32 }),
    ...collar(bar(12), 2.25, 5, { phase: 0, radius: 14, spin: -0.3, arms: true }),
    ...weavers(bar(13), [
      { from: TAU * 0.25, to: TAU * 0.75, crossTime: 1.35 },
      { from: TAU * 0.75, to: TAU * 0.25, crossTime: 1.35, delay: 0.24 },
      { from: TAU * 0.0, to: TAU * 0.5, crossTime: 1.35, delay: 0.48 },
    ]),
    ...bulwarks(bar(14), 3.2, [[TAU * 0.1, 9], [TAU * 0.6, 9]]),
    ...arc(bar(15), 2.25, TAU * 0.3, TAU * 0.7, 3, { radius: 15, arms: true }),

    // --- Overdrive: heaviest traffic, widest sweeps, coils burning violet.
    ...collar(bar(16), 2.25, 6, { phase: TAU * 0.04, radius: 14.5, spin: 0.4, arms: true }),
    ...weavers(bar(16, 2), [
      { from: TAU * 0.05, to: TAU * 0.55, crossTime: 1.3 },
      { from: TAU * 0.55, to: TAU * 0.05, crossTime: 1.3, delay: 0.2 },
    ]),
    ...arc(bar(17, 2), 2.25, TAU * 0.55, TAU * 0.95, 4, { radius: 15.5 }),
    ...bulwarks(bar(18), 3.1, [[TAU * 0.75, 8], [TAU * 0.25, 8]]),
    ...weavers(bar(18, 2), [
      { from: TAU * 0.15, to: TAU * 0.65, crossTime: 1.25 },
      { from: TAU * 0.9, to: TAU * 0.4, crossTime: 1.25, delay: 0.22 },
      { from: TAU * 0.4, to: TAU * 0.9, crossTime: 1.25, delay: 0.44 },
    ]),
    ...collar(bar(19, 2), 2.25, 6, { phase: TAU * 0.5, radius: 15, spin: -0.42, arms: true }),
    ...arc(bar(21), 2.25, TAU * 0.1, TAU * 0.4, 3, { radius: 15.5 }),
    ...weavers(bar(21, 2), [
      { from: TAU * 0.0, to: TAU * 0.5, crossTime: 1.2 },
      { from: TAU * 0.5, to: TAU * 1.0, crossTime: 1.2, delay: 0.18 },
    ]),

    // --- Charge: the interlocks, plus just enough traffic to make you choose
    // between clearing the barrel and clearing the screen.
    ...interlockEntries(),
    ...weavers(bar(23, 2), [
      { from: TAU * 0.12, to: TAU * 0.62, crossTime: 1.2 },
      { from: TAU * 0.62, to: TAU * 0.12, crossTime: 1.2, delay: 0.2 },
    ]),
    ...arc(bar(25), 2.25, TAU * 0.58, TAU * 0.92, 3, { radius: 15, arms: true }),
    ...weavers(bar(26, 2), [
      { from: TAU * 0.35, to: TAU * 0.85, crossTime: 1.15 },
      { from: TAU * 0.85, to: TAU * 0.35, crossTime: 1.15, delay: 0.2 },
    ]),
    // Last collar of the run, on the bar the snare roll starts.
    ...collar(bar(28, 2), 2.25, 6, { phase: TAU * 0.06, radius: 14, spin: 0.46, arms: true }),
  ].sort((a, b) => a.time - b.time);
}

export const MD_TIMELINE: MassDriverSpawnEntry[] = buildTimeline();

const KILL_SCORE: Record<MassDriverEnemyKind, number> = {
  sentry: 110,
  weaver: 150,
  bulwark: 320,
  darter: 60,
  interlock: 900,
};

const DARTER_MAX_AGE = 9;

/** Cosmetic per-frame camera work the level runtime injects; gameplay owns the hook. */
export type MassDriverCameraFrame = (context: { camera: PerspectiveCamera; runTime: number; dt: number }) => void;

export function createMassDriverGameplay(
  bus: EventBus,
  onCameraFrame?: MassDriverCameraFrame,
): LockOnRunnerLevel<MassDriverEnemyKind, MassDriverSpawnData> {
  const timeline = MD_TIMELINE;
  const interlockCount = timeline.filter((entry) => entry.kind === 'interlock').length;
  const interceptions = new Set<number>();

  bus.on('runstart', () => {
    interceptions.clear();
    runState.interlocksAlive = 0;
    runState.interlocksCleared = 0;
    runState.interlocksTotal = interlockCount;
    runState.fired = false;
    runState.breached = false;
    runState.hitsTaken = 0;
    runState.dartersPopped = 0;
  });

  bus.on('playerhit', () => {
    runState.hitsTaken += 1;
  });

  bus.on('spawn', ({ kind }) => {
    if (kind === 'interlock') runState.interlocksAlive += 1;
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

  function fireDarter(context: MassDriverUpdate, from: Vector3) {
    const initial = hostileShotAimPoint(context.camera, from).sub(from).normalize().multiplyScalar(6);
    context.spawnEnemy({
      time: context.runTime,
      kind: 'darter',
      countsTowardTotal: false,
      data: { role: 'darter', position: from.clone(), velocity: initial, lastAge: 0, impact: {} },
    });
  }

  // ---- movement --------------------------------------------------------------

  /** Wall drone: rides the bore wall, orbits the axis, closes in as it ages. */
  function updateSentry(context: MassDriverUpdate, data: Extract<MassDriverSpawnData, { role: 'sentry' }>) {
    const { enemy, runTime, age, curve, camera } = context;
    const pace = pacer.sample(enemy.entry.time, runTime, data.engagement);
    const close = MathUtils.clamp(age / Math.max(0.2, data.engagement.windowSeconds), 0, 1);
    const angle = data.angle + age * data.spin;
    const radius = Math.min(MAX_DRONE_RADIUS, data.radius * (1 + close * 0.3)) + Math.sin(age * 2.3 + enemy.id) * 0.35;
    enemy.mesh.position.copy(offsetFromRail(curve, pace.anchorU, new Vector3(
      Math.cos(angle) * radius,
      Math.sin(angle) * radius,
      0,
    )));
    // Face the payload, but bank with the orbit so the plate reads as circling.
    enemy.mesh.quaternion.copy(camera.quaternion);
    enemy.mesh.rotateZ(angle + Math.PI / 2);
    enemy.mesh.rotateX(Math.sin(age * 1.7 + enemy.id) * 0.22);

    const fire = context.enemyState(() => ({ nextAt: data.arms ? 1.05 : Infinity }));
    if (age >= fire.nextAt) {
      fire.nextAt = Infinity; // one shot each; the swarm supplies the volume
      fireDarter(context, enemy.mesh.position);
    }
    return runTime > pace.passTime + MISS_GRACE;
  }

  /** Needle: crosses the bore through the gap between two coils and out again. */
  function updateWeaver(context: MassDriverUpdate, data: Extract<MassDriverSpawnData, { role: 'weaver' }>) {
    const { enemy, runTime, age, curve } = context;
    const pace = pacer.sample(enemy.entry.time, runTime, data.engagement);
    const t = (age - data.delay) / data.crossTime;
    if (t > WEAVER_EXIT || runTime > pace.passTime + MISS_GRACE) return true;
    // Radius collapses toward the axis at the midpoint: the needle really does
    // pass through the middle of the bore rather than skirting the wall.
    const at = (progress: number) => {
      const e = MathUtils.clamp(progress, 0, 1);
      const smoothed = e * e * (3 - 2 * e);
      const a = MathUtils.lerp(data.fromAngle, data.toAngle, smoothed);
      const r = Math.min(MAX_DRONE_RADIUS, data.radius) * (1 - Math.sin(e * Math.PI) * 0.52);
      return offsetFromRail(curve, pace.anchorU, new Vector3(Math.cos(a) * r, Math.sin(a) * r, 0));
    };
    const clamped = MathUtils.clamp(t, 0, 1);
    enemy.mesh.position.copy(at(clamped));
    enemy.mesh.lookAt(at(clamped + 0.05));
    enemy.mesh.rotateZ(age * 7.5);
    return false;
  }

  /** Blocker: heavy, slow, rolls as it grinds down the barrel toward you. */
  function updateBulwark(context: MassDriverUpdate, data: Extract<MassDriverSpawnData, { role: 'bulwark' }>) {
    const { enemy, runTime, age, curve, camera } = context;
    const pace = pacer.sample(enemy.entry.time, runTime, data.engagement);
    const drift = Math.sin(age * 0.55 + enemy.id) * 0.16;
    const radius = Math.min(MAX_DRONE_RADIUS, data.radius * (1 + Math.min(1, age / 3) * 0.3)) + Math.sin(age * 0.8) * 0.9;
    enemy.mesh.position.copy(offsetFromRail(curve, pace.anchorU, new Vector3(
      Math.cos(data.angle + drift) * radius,
      Math.sin(data.angle + drift) * radius,
      0,
    )));
    enemy.mesh.quaternion.copy(camera.quaternion);
    enemy.mesh.rotateZ(age * 0.5);
    // Cracked open: the exposed capacitor shudders.
    if (enemy.hitStageIndex > 0) {
      enemy.mesh.position.x += Math.sin(age * 24) * 0.13;
      enemy.mesh.position.y += Math.cos(age * 19) * 0.11;
    }
    return runTime > pace.passTime + MISS_GRACE;
  }

  /** Drone shot: converges on the payload, poppable on the way in. */
  function updateDarter(context: MassDriverUpdate, data: Extract<MassDriverSpawnData, { role: 'darter' }>) {
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
      config: { hitDistance: 2.5, impactBrake: 0.34, damageDistance: 0.7 },
    });
    if (impact.phase === 'braking') {
      enemy.mesh.position.copy(data.position);
      enemy.mesh.quaternion.copy(camera.quaternion);
      enemy.mesh.rotateZ(age * 12);
      if (impact.damaged) {
        damagePlayer(1);
        return true;
      }
      return false;
    }

    steerHomingShot(data.position, data.velocity, hostileShotAimPoint(camera, data.position), age, dt, {
      baseSpeed: 7,
      maxSpeed: 15,
      accel: 3.8,
      turnRate: 2.6,
    });
    enemy.mesh.position.copy(data.position);
    if (data.velocity.lengthSq() > 0.001) enemy.mesh.lookAt(data.position.clone().add(data.velocity));
    return age > DARTER_MAX_AGE || shotBehindCamera(camera, data.position);
  }

  /**
   * Interlock: the only thing in the barrel that is not overtaken. It holds a
   * shrinking distance ahead of the payload, so it stays engaged for as long as
   * it lives. At the charge peak a survivor takes the barrel — and you — with it.
   */
  function updateInterlock(context: MassDriverUpdate, data: Extract<MassDriverSpawnData, { role: 'interlock' }>) {
    const { enemy, runTime, age, curve, camera, damagePlayer } = context;
    const charge = chargeProgress(runTime);
    if (runTime >= FIRE_TIME) {
      // The charge peaked with this thing still welded across the bore. Keep
      // asking every frame rather than despawning on the first call: the engine
      // ignores damage inside the post-hit invulnerability window, and a barrel
      // breach is not something a lucky darter hit should let you walk away from.
      runState.breached = true;
      damagePlayer(MD_PLAYER_HEALTH);
      return false;
    }
    const hold = MathUtils.lerp(data.holdStart, data.holdEnd, charge);
    const anchorU = massDriverRunProgress(Math.min(MD_DURATION, runTime + hold));
    // Jammed hard against the bore wall, shuddering harder as the charge climbs.
    const shudder = (0.1 + charge * 0.5) * (enemy.hitStageIndex > 0 ? 2.1 : 1);
    const angle = data.angle + Math.sin(age * 0.4) * 0.06;
    enemy.mesh.position.copy(offsetFromRail(curve, anchorU, new Vector3(
      Math.cos(angle) * data.radius + Math.sin(age * 27 + enemy.id) * shudder,
      Math.sin(angle) * data.radius + Math.cos(age * 31 + enemy.id) * shudder,
      0,
    )));
    enemy.mesh.quaternion.copy(camera.quaternion);
    enemy.mesh.rotateZ(angle + Math.PI / 2);
    return false;
  }

  // ---- level definition --------------------------------------------------------

  return {
    duration: MD_DURATION,
    bpm: MD_BPM,
    playerHealth: MD_PLAYER_HEALTH,
    createRail: createMassDriverRail,
    spawnTimeline: timeline,
    easeRunProgress: massDriverRunProgress,
    // The run's phase clock lives on a runner hook rather than in the level
    // runtime, so the shot still fires when nothing is on screen and headless
    // tools that drive gameplay directly see the same outcome a player does.
    updateCameraEffects(context) {
      updateRunPhase(context.runTime);
      onCameraFrame?.(context);
    },
    startWord: 'LOAD',
    replayWord: 'RELOAD',
    // The bore is crowded and the traffic is fast; a slightly wider lock radius
    // keeps sweeping a six-drone collar tactile instead of finicky.
    lockRadiusNdc: 0.095,
    timing: {
      // 128 BPM with a hard four-on-the-floor: cap the coarsest shot gap well
      // under a beat so a six-shot volley lands inside the bar it was fired in.
      shotDelay: { maxGridSeconds: 0.72, gapThirtyseconds: 2, gridRampGapGrowthThirtyseconds: 1 },
    },
    updateEnemy(context) {
      const data = context.enemy.entry.data;
      switch (data.role) {
        case 'sentry':
          return updateSentry(context, data);
        case 'weaver':
          return updateWeaver(context, data);
        case 'bulwark':
          return updateBulwark(context, data);
        case 'darter':
          return updateDarter(context, data);
        case 'interlock':
          return updateInterlock(context, data);
      }
    },
    scoreForKill(volleySize, enemy) {
      if (enemy.kind === 'darter') runState.dartersPopped += 1;
      if (enemy.kind === 'interlock') {
        runState.interlocksAlive = Math.max(0, runState.interlocksAlive - 1);
        runState.interlocksCleared += 1;
      }
      const multiplier = 1 + Math.max(0, volleySize - 1) * 0.2;
      return Math.round(KILL_SCORE[enemy.kind] * multiplier);
    },
    // Chipping armour pays a little; the kill pays properly.
    scoreForHit: () => 40,
    scoreForVolley(results) {
      if (results.length < 4) return 0;
      if (!results.every((result) => result.killed)) return 0;
      // A clean six is a full capacitor bank discharging at once. Pay it.
      return results.length === 6 ? 700 : results.length * 90;
    },
    rankForRun(score, kills, totalEnemies) {
      const clearRate = totalEnemies === 0 ? 0 : kills / totalEnemies;
      // Getting the gun to fire is the price of admission, not an achievement:
      // a breached barrel already ends the run with a forced dash.
      if (!runState.fired) return score >= 9000 ? 'C' : 'D';
      if (score >= 18000 && clearRate >= 0.85) return 'S';
      if (score >= 13800 && clearRate >= 0.72) return 'A';
      if (score >= 8800 && clearRate >= 0.42) return 'B';
      if (score >= 4800) return 'C';
      return 'D';
    },
    detailsForRun() {
      const hull = Math.max(0, MD_PLAYER_HEALTH - runState.hitsTaken);
      const lines = [`Hull ${hull}/${MD_PLAYER_HEALTH}`, `Interlocks ${runState.interlocksCleared}/${runState.interlocksTotal}`];
      if (runState.dartersPopped > 0) lines.push(`${runState.dartersPopped} darter${runState.dartersPopped === 1 ? '' : 's'} intercepted`);
      lines.push(runState.fired ? 'GUN FIRED — payload away' : 'BARREL BREACH — the charge had nowhere to go');
      return lines;
    },
  };
}

/**
 * Advances the run's own clock: the moment the charge peaks with a clear
 * barrel, the gun fires. Driven from the per-frame camera-effects hook so it
 * ticks whether or not anything is on screen.
 */
export function updateRunPhase(runTime: number) {
  if (!runState.fired && !runState.breached && runTime >= FIRE_TIME && runState.interlocksAlive <= 0) {
    runState.fired = true;
  }
  return runState.fired;
}
