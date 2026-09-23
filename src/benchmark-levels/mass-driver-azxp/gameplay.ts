import { CatmullRomCurve3, MathUtils, Vector3 } from 'three';
import {
  shotBehindCamera,
  updateHostileShotImpact,
  type HostileShotImpactState,
} from '../../engine/hostile-shot';
import type { LockOnEnemyUpdate, LockOnRunnerLevel, LockOnSpawnEntry } from '../../engine/lock-on-runner';
import { offsetFromRail } from '../../engine/rail';
import { createRailPacer, type RailLead } from '../../engine/rail-pacer';
import { createSpeedProfile } from '../../engine/speed-profile';
import type { EventBus } from '../../events';
import { resetRunState, runState } from './run-state';
import {
  BAR,
  BEAT,
  bar,
  CHARGE_TIME,
  FIRE_TIME,
  MASS_DRIVER_BPM,
  MASS_DRIVER_DURATION,
  MUZZLE_RING,
  STAGE_ONE_TIME,
  STAGE_TWO_TIME,
  VERDICT_TIME,
} from './timing';

// MASS DRIVER — riding a payload down an orbital railgun. One accelerator
// ring per beat at a locked 128 BPM; the speed profile below widens the ring
// spacing as the run goes, so the gun visibly accelerates while every coil is
// still crossed on the beat.
//
//   Breech      bars 0–4    the coils spool up; first pickets unfold
//   Stage one   bars 4–12   arc blue; pickets, threaders, leeches, arc pylons
//   Stage two   bars 12–20  violet; the same cast, denser and faster
//   Final charge bars 20–28 six jammed safety interlocks tether the payload;
//                           blow them before the peak or the barrel blows
//   Open space  bars 28–32  the gun fires; out of the muzzle, into silence

export { MASS_DRIVER_BPM, MASS_DRIVER_DURATION } from './timing';
export const MASS_DRIVER_PLAYER_HEALTH = 4;

export type MassDriverEnemyKind =
  | 'picket'
  | 'threader'
  | 'leech'
  | 'pylon'
  | 'bolt'
  | 'interlock'
  | 'discharge';

export type MassDriverSpawnData =
  | { role: 'picket'; engagement: RailLead; radius: number; angle: number; spin: number; depth: number }
  | { role: 'threader'; engagement: RailLead; radius: number; angle: number; step: number }
  | { role: 'leech'; ring: number; angle: number; inch: number }
  | { role: 'pylon'; engagement: RailLead; x: number; y: number; seed: number; fireEvery: number; firstShot: number }
  | { role: 'bolt'; ahead: number; x: number; y: number; lastAge: number; impact: HostileShotImpactState }
  | { role: 'interlock'; angle: number; wave: number }
  | { role: 'discharge' };

export type MassDriverSpawnEntry = LockOnSpawnEntry<MassDriverEnemyKind, MassDriverSpawnData>;
export type MassDriverUpdate = LockOnEnemyUpdate<MassDriverEnemyKind, MassDriverSpawnData>;

// ---- geometry of the barrel --------------------------------------------------

/**
 * World scale. Everything is authored in "barrel units" (a bore of 14) and
 * built at a third of that size. Angular motion on screen is unchanged, but
 * the gun's top speed stays under ~20 world units per second, which is what
 * the engine's homing slugs need to reliably close on targets that pace the
 * payload down the barrel.
 */
export const WORLD = 1 / 3;
/** Radius of the bore in barrel units: the inner face of every coil. */
export const BORE = 14;
/** Targets never leave this radius (barrel units), so the coils can never hide them. */
const TARGET_MAX_RADIUS = 12;

// ---- speed profile → rail easing ---------------------------------------------

// Rail speed in world units per second. Ring spacing is speed × one beat:
// ~6 units in the breech, ~8 at stage one, ~12 at stage two, ~18 at the
// charge, ~31 at the muzzle — and then the gun fires.
const SPEED_KEYS: Array<[number, number]> = [
  [0, 13],
  [STAGE_ONE_TIME, 16],
  [STAGE_TWO_TIME, 25],
  [CHARGE_TIME, 36],
  [VERDICT_TIME, 56],
  [FIRE_TIME, 60],
  [FIRE_TIME + BEAT * 0.4, 320],
  [FIRE_TIME + BAR, 240],
  [MASS_DRIVER_DURATION, 110],
];

const speedProfile = createSpeedProfile(
  SPEED_KEYS.map(([time, speed]) => [time, speed * WORLD] as const),
  MASS_DRIVER_DURATION,
  { samples: 2400 },
);
export const speedAt = speedProfile.speedAt;

export function massDriverRunProgress(time: number, duration = MASS_DRIVER_DURATION) {
  return speedProfile.runProgress(time, duration);
}

/** Rail parameter the camera occupies at run time `t`. */
export const railU = (time: number) => massDriverRunProgress(time);

/** 0 in the breech → 1 at the muzzle. Drives colour (arc blue → violet → white) and the hum. */
export function heatAt(time: number) {
  if (time >= FIRE_TIME) return 1;
  const slowest = SPEED_KEYS[0][1] * WORLD;
  return MathUtils.clamp((speedAt(time) - slowest) / (speedAt(FIRE_TIME) - slowest), 0, 1);
}

// ---- rail ----------------------------------------------------------------------

const TOTAL_DISTANCE = (() => {
  let sum = 0;
  const steps = 6000;
  const dt = MASS_DRIVER_DURATION / steps;
  for (let i = 0; i < steps; i += 1) sum += speedAt((i + 0.5) * dt) * dt;
  return sum;
})();

// The barrel sweeps in long, slow bends through the stages — enough to see
// the tunnel curve away ahead — then straightens for the final charge so the
// muzzle sits dead on the vanishing point.
function barrelPath(worldDistance: number) {
  const distance = worldDistance / WORLD;
  const straighten = 1 - MathUtils.smoothstep(distance, 640, 980);
  return new Vector3(
    Math.sin((distance / 1050) * Math.PI * 2) * 34 * straighten,
    Math.sin((distance / 760) * Math.PI * 2 + 0.9) * 13 * straighten,
    -distance,
  ).multiplyScalar(WORLD);
}

let sharedRail: CatmullRomCurve3 | null = null;

export function createMassDriverRail() {
  if (sharedRail) return sharedRail;
  const points: Vector3[] = [];
  const spacing = 18 * WORLD;
  for (let d = 0; d <= TOTAL_DISTANCE + spacing; d += spacing) points.push(barrelPath(d));
  const curve = new CatmullRomCurve3(points, false, 'catmullrom', 0.5);
  curve.arcLengthDivisions = 5000;
  curve.updateArcLengths();
  sharedRail = curve;
  return curve;
}

const rail = createMassDriverRail();
export const RAIL_LENGTH = rail.getLength();

// ---- the beat clock --------------------------------------------------------------

/** Run time at which ring k is crossed: exactly on the heard beat k. */
export function ringTime(ring: number) {
  return ring * BEAT + runState.beatPhase;
}

/** Rail parameter of ring k. */
export function ringU(ring: number) {
  return railU(ringTime(ring));
}

/** Continuous beat position on the heard grid (ring index the payload is at). */
export function beatPosition(runTime: number) {
  return (runTime - runState.beatPhase) / BEAT;
}

// ---- rail pacing ---------------------------------------------------------------

const PACER_SPAWN_AHEAD = 36 * WORLD;
const MISS_GRACE = 0.25;

const pacer = createRailPacer({
  curve: rail,
  duration: MASS_DRIVER_DURATION,
  runProgress: massDriverRunProgress,
  spawnAheadUnits: PACER_SPAWN_AHEAD,
  defaultLeadSeconds: 4,
});

// ---- spawn authoring -------------------------------------------------------------

const deg = MathUtils.degToRad;

/** A wheel of pickets unfolding off the coil wall and orbiting the bore. */
function pickets(time: number, lead: number, angles: number[], radius: number, spin: number, depthStep = 0): MassDriverSpawnEntry[] {
  return angles.map((angle, index) => {
    const at = time + index * 0.06;
    return {
      time: at,
      kind: 'picket',
      data: { role: 'picket', engagement: pacer.resolve(at, lead), radius, angle: deg(angle), spin, depth: index * depthStep },
    };
  });
}

/** Evenly spaced wheel of `count` pickets. */
function picketWheel(time: number, lead: number, count: number, radius: number, spin: number, offset = 0) {
  return pickets(time, lead, Array.from({ length: count }, (_, i) => offset + (i * 360) / count), radius, spin);
}

/** Threaders stitch across the bore in straight chords, one hop per beat. */
function threaders(time: number, lead: number, specs: Array<{ angle: number; step: number; radius?: number }>): MassDriverSpawnEntry[] {
  return specs.map((spec, index) => {
    const at = time + index * 0.04;
    return {
      time: at,
      kind: 'threader',
      data: { role: 'threader', engagement: pacer.resolve(at, lead), radius: spec.radius ?? 10.5, angle: deg(spec.angle), step: deg(spec.step) },
    };
  });
}

/** Leeches latch onto a specific coil and ride it in; they inch around its rim each beat. */
function leeches(ring: number, lead: number, angles: number[], inch: number): MassDriverSpawnEntry[] {
  return angles.map((angle, index) => ({
    time: ring * BEAT - lead + index * 0.05,
    kind: 'leech',
    hitPoints: 2,
    data: { role: 'leech', ring, angle: deg(angle), inch: deg(inch) * (index % 2 === 0 ? 1 : -1) },
  }));
}

/** Arc pylons hang off the wall and discharge bolts down the bore on the beat. */
function pylons(time: number, lead: number, spots: Array<[number, number]>, fireEvery = 6): MassDriverSpawnEntry[] {
  return spots.map(([x, y], index) => {
    const at = time + index * 0.12;
    return {
      time: at,
      kind: 'pylon',
      hitPoints: 2,
      data: { role: 'pylon', engagement: pacer.resolve(at, lead), x, y, seed: index * 1.9 + time, fireEvery, firstShot: 3 + index * 2 },
    };
  });
}

function interlocks(time: number, wave: number, angles: number[]): MassDriverSpawnEntry[] {
  return angles.map((angle, index) => ({
    time: time + index * BEAT * 0.5,
    kind: 'interlock',
    hitStages: [2, 2],
    lockable: false,
    data: { role: 'interlock', angle: deg(angle), wave },
  }));
}

/** Beat index of bar n, beat b — the ring a leech rides in on. */
const ringOf = (barIndex: number, beatInBar = 0) => barIndex * 4 + beatInBar;

const DISCHARGE_ENTRY: MassDriverSpawnEntry = {
  time: FIRE_TIME,
  kind: 'discharge',
  lockable: false,
  countsTowardTotal: false,
  data: { role: 'discharge' },
};

function buildTimeline(): MassDriverSpawnEntry[] {
  return [
    // --- Breech: the coils spool up. Pickets unfold off the wall to teach the sweep.
    ...pickets(bar(1, 2), 4.6, [90, 210, 330], 8.8, 0.55),
    ...pickets(bar(2, 2), 4.4, [30, 150, 270], 9.6, -0.55),
    ...threaders(bar(3), 4.2, [{ angle: 180, step: 105 }, { angle: 0, step: -105 }]),

    // --- Stage one (arc blue). The halo on the drop, then the cast arrives one by one.
    ...picketWheel(bar(4), 4.4, 6, 10, 0.5, 15),
    ...leeches(ringOf(7), 3.6, [8, 172, 196], 14),
    ...threaders(bar(6), 4.2, [
      { angle: 45, step: 90 }, { angle: 135, step: 90 }, { angle: 225, step: 90 }, { angle: 315, step: 90 },
    ]),
    ...pylons(bar(7), 5.4, [[0, 9.2]]),
    ...pickets(bar(7, 2), 4.0, [215, 325], 10.5, 0.4),
    ...pickets(bar(8), 4.6, [0, 60, 120, 180, 240, 300], 9.2, 0.85, 1.4),
    ...leeches(ringOf(10, 2), 3.5, [-12, 12, 168, 192], 12),
    ...threaders(bar(9, 2), 4.0, [{ angle: 200, step: -110 }, { angle: -20, step: 110 }]),
    ...pylons(bar(10), 5.0, [[-10.5, 3.5], [10.5, 3.5]]),
    ...pickets(bar(10, 2), 3.8, [240, 270, 300], 10.5, 0.3),
    ...picketWheel(bar(11), 3.8, 5, 9.5, -0.9, 90),
    ...threaders(bar(11, 2), 3.2, [{ angle: 90, step: 120 }, { angle: 270, step: 120 }]),

    // --- Stage two (violet, a whole tone up). Denser, and the pylons come in pairs.
    ...picketWheel(bar(12), 4.2, 6, 10.8, 0.95),
    ...pylons(bar(12, 1), 5.4, [[0, 10]]),
    ...threaders(bar(13), 4.0, [
      { angle: 20, step: 100 }, { angle: 160, step: -100 }, { angle: 200, step: 100 }, { angle: 340, step: -100 },
    ]),
    ...leeches(ringOf(15), 2.9, [0, 180, 24, 204], 16),
    ...pylons(bar(14), 5.0, [[-10.5, -6], [10.5, -6]]),
    ...pickets(bar(14, 2), 3.8, [70, 90, 110], 10.8, 0.6),
    ...pickets(bar(15), 4.2, [0, 120, 240], 9.8, 1.0, 1.2),
    ...pickets(bar(15, 0.25), 4.2, [60, 180, 300], 9.8, -1.0, 1.2),
    ...threaders(bar(16), 3.8, [
      { angle: 0, step: 95 }, { angle: 180, step: 95 }, { angle: 90, step: -95 }, { angle: 270, step: -95 },
    ]),
    ...leeches(ringOf(18), 2.8, [-8, 188], 18),
    ...pylons(bar(17), 4.8, [[-11, 5], [11, 5]]),
    ...picketWheel(bar(17, 2), 3.8, 4, 10.6, 0.7, 45),
    ...picketWheel(bar(18), 4.0, 6, 10.2, -1.1, 0),
    ...threaders(bar(18, 2), 3.6, [{ angle: 150, step: -100 }, { angle: 30, step: 100 }]),
    ...pickets(bar(19), 3.2, [200, 250, 290, 340], 10.8, 1.3),

    // --- Final charge. The safeties latch on and tether the payload.
    ...interlocks(bar(20), 0, [90, 210, 330]),
    ...pickets(bar(21), 3.8, [0, 180], 11, 0.7),
    ...interlocks(bar(22, 2), 1, [30, 150, 270]),
    ...threaders(bar(23, 2), 3.6, [{ angle: 60, step: 110 }, { angle: 240, step: 110 }]),
    ...pickets(bar(24, 2), 3.6, [0, 90, 180, 270], 11, -0.8),
    ...picketWheel(bar(25, 2), 3.4, 5, 10.8, 1.2, 18),
    ...threaders(bar(26), 2.8, [{ angle: 120, step: -115 }, { angle: 300, step: -115 }]),

    // --- The peak. Whatever the charge finds decides the ending.
    DISCHARGE_ENTRY,
  ].sort((a, b) => a.time - b.time);
}

export const MASS_DRIVER_TIMELINE: MassDriverSpawnEntry[] = buildTimeline();

// ---- scoring ------------------------------------------------------------------------

const KILL_SCORE: Record<MassDriverEnemyKind, number> = {
  picket: 100,
  threader: 150,
  leech: 220,
  pylon: 260,
  bolt: 50,
  interlock: 700,
  discharge: 0,
};

// ---- the gameplay factory --------------------------------------------------------------

export type MassDriverGameplayOptions = {
  /** Inspection aid: every interlock dies the moment it latches, so the launch is always reachable. */
  autoClearSafeties?: boolean;
};

const BOLT_SPEED = 13 * WORLD;
const BOLT_MAX_AGE = 9;
const INTERLOCK_LATCH_SECONDS = BEAT * 2;

export function createMassDriverGameplay(
  bus: EventBus,
  options: MassDriverGameplayOptions = {},
): LockOnRunnerLevel<MassDriverEnemyKind, MassDriverSpawnData> {
  const timeline = MASS_DRIVER_TIMELINE;
  const interlockEntries = timeline.filter((entry) => entry.kind === 'interlock');
  const interceptions = new Set<number>();
  const interlockIds = new Set<number>();
  // Slugs in flight per target. A pinned target stops outrunning its slug:
  // the engine's homing shots close at ~20× their remaining distance per
  // second, so anything receding faster than ~20 u/s near impact would be
  // chased forever at this gun's speeds.
  const incoming = new Map<number, number>();
  let hitsTaken = 0;
  let boltsDowned = 0;
  let lastRunTime = 0;

  function resetRun() {
    resetRunState();
    interceptions.clear();
    interlockIds.clear();
    incoming.clear();
    hitsTaken = 0;
    boltsDowned = 0;
    lastRunTime = 0;
    // Timeline entries are reused across runs; interlocks are sealed until they latch.
    for (const entry of interlockEntries) entry.lockable = false;
  }
  resetRun();

  bus.on('runstart', resetRun);
  bus.on('playerhit', () => {
    hitsTaken += 1;
  });
  bus.on('fire', ({ enemyId }) => {
    interceptions.add(enemyId);
    incoming.set(enemyId, (incoming.get(enemyId) ?? 0) + 1);
  });
  bus.on('hit', ({ enemyId }) => {
    const count = (incoming.get(enemyId) ?? 0) - 1;
    if (count > 0) incoming.set(enemyId, count);
    else incoming.delete(enemyId);
  });
  bus.on('miss', ({ enemyId }) => {
    interceptions.delete(enemyId);
    incoming.delete(enemyId);
    // Inspection runs dismiss latched safeties instead of shooting them.
    if (options.autoClearSafeties) interlockGone(enemyId);
  });
  bus.on('spawn', ({ enemyId, kind }) => {
    if (kind !== 'interlock') return;
    interlockIds.add(enemyId);
    runState.interlocksSpawned += 1;
  });
  bus.on('kill', ({ enemyId }) => {
    interceptions.delete(enemyId);
    incoming.delete(enemyId);
    interlockGone(enemyId);
  });

  function interlockGone(enemyId: number) {
    if (!interlockIds.delete(enemyId)) return;
    runState.interlocksDestroyed += 1;
    const allLatched = runState.interlocksSpawned === interlockEntries.length;
    if (allLatched && interlockIds.size === 0 && runState.outcome === 'pending') {
      runState.outcome = 'launch';
      runState.safetiesClearAt = lastRunTime;
    }
  }

  // ---- helpers ------------------------------------------------------------------

  const scratch = new Vector3();

  const PINNED_WORLD_SPEED = 12;

  // One mutable bag per enemy instance; each behaviour keeps its own slot.
  type EnemyBag = {
    pace?: { lastU: number; lastAge: number; lag: number; spawnAhead: number };
    threader?: { startBeat: number; frozenHops: number };
    pylon?: { startBeat: number; shots: number };
    bolt?: { velocity: Vector3; fromAhead: number };
    interlock?: { lastShotBeat: number };
  };
  const bag = (context: MassDriverUpdate) => context.enemyState<EnemyBag>(() => ({}));

  /**
   * Rail-paced anchor. The pacer fixes where a target spawns and when it is
   * overtaken; between the two, drones hold their distance and then whip past
   * the payload in the last moments, instead of creeping in linearly and
   * parking just off the edge of the frame. While a slug is inbound the
   * target's forward world speed is capped, so it drops back and the slug
   * lands; afterwards it eases back onto its track.
   */
  function paced(context: MassDriverUpdate, engagement: RailLead) {
    const entryTime = context.enemy.entry.time;
    const state = (bag(context).pace ??= {
      lastU: 0,
      lastAge: context.age,
      lag: 0,
      spawnAhead: pacer.sample(entryTime, entryTime, engagement).distanceAheadUnits,
    });
    const sample = pacer.sample(entryTime, context.runTime, engagement);
    const progress = MathUtils.clamp((context.runTime - entryTime) / Math.max(0.1, engagement.windowSeconds), 0, 1);
    const ahead = state.spawnAhead * (1 - progress ** 4);
    const baseU = railU(context.runTime);
    const anchorU = Math.min(1, baseU + ahead / RAIL_LENGTH);
    const dt = Math.max(0, context.age - state.lastAge);
    const worldSpeed = dt > 0 && state.lastU > 0 ? ((anchorU - state.lastU) * RAIL_LENGTH) / dt : 0;
    if ((incoming.get(context.enemy.id) ?? 0) > 0) state.lag += Math.max(0, worldSpeed - PINNED_WORLD_SPEED) * dt;
    else state.lag = Math.max(0, state.lag - 14 * dt);
    state.lastU = anchorU;
    state.lastAge = context.age;
    const pinnedAhead = Math.max(0, ahead - state.lag);
    // Close to the lens, tuck inward — more vertically, to match a wide
    // frame — so the whip-past stays on screen until the last moment.
    const far = MathUtils.smoothstep(pinnedAhead, 0, 28 * WORLD);
    return {
      ...sample,
      anchorU: Math.max(0, baseU + pinnedAhead / RAIL_LENGTH),
      tuckX: MathUtils.lerp(0.8, 1, far),
      tuckY: MathUtils.lerp(0.5, 1, far),
    };
  }

  function pinned(context: MassDriverUpdate) {
    return (incoming.get(context.enemy.id) ?? 0) > 0;
  }

  function faceCamera(context: MassDriverUpdate) {
    context.enemy.mesh.quaternion.copy(context.camera.quaternion);
  }

  function clampRadius(x: number, y: number) {
    const r = Math.hypot(x, y);
    if (r <= TARGET_MAX_RADIUS) return [x, y] as const;
    const s = TARGET_MAX_RADIUS / r;
    return [x * s, y * s] as const;
  }

  /** Seat a target at rail parameter `u`, offset in barrel units. */
  function place(context: MassDriverUpdate, u: number, x: number, y: number, z = 0) {
    const [cx, cy] = clampRadius(x, y);
    context.enemy.mesh.position.copy(offsetFromRail(context.curve, u, scratch.set(cx * WORLD, cy * WORLD, z * WORLD)));
  }

  function fireBolt(context: MassDriverUpdate, x: number, y: number, ahead: number) {
    context.spawnEnemy({
      time: context.runTime,
      kind: 'bolt',
      countsTowardTotal: false,
      data: { role: 'bolt', ahead, x, y, lastAge: 0, impact: {} },
    });
  }

  function distanceAheadOf(context: MassDriverUpdate) {
    const forward = scratch.set(0, 0, -1).applyQuaternion(context.camera.quaternion);
    return context.enemy.mesh.position.clone().sub(context.camera.position).dot(forward);
  }

  // ---- movement -------------------------------------------------------------------

  // Pickets unfold off the coil wall, then wheel around the bore. Each beat
  // gives the wheel a little kick, so the whole formation turns in time.
  function updatePicket(context: MassDriverUpdate, data: Extract<MassDriverSpawnData, { role: 'picket' }>) {
    const { age, runTime, enemy } = context;
    const sample = paced(context, data.engagement);
    const unfold = MathUtils.smoothstep(age, 0, 0.6);
    const beat = beatPosition(runTime);
    const kick = Math.floor(beat) + easeOutCubic(beat - Math.floor(beat));
    const angle = data.angle + data.spin * (age * 0.55 + kick * 0.22);
    const radius = MathUtils.lerp(BORE - 0.8, data.radius, unfold) * (1 + Math.sin(age * 2.1 + enemy.id) * 0.04);
    place(context, sample.anchorU, Math.cos(angle) * radius * sample.tuckX, Math.sin(angle) * radius * sample.tuckY, data.depth + Math.sin(age * 1.7 + data.angle) * 0.8);
    faceCamera(context);
    enemy.mesh.rotateZ(age * 5 + enemy.id);
    return runTime > sample.passTime + MISS_GRACE;
  }

  // Threaders hold on the wall, then dart across the bore in a straight chord
  // on every beat — stitching between the coils. The hop lands on the beat.
  function updateThreader(context: MassDriverUpdate, data: Extract<MassDriverSpawnData, { role: 'threader' }>) {
    const { age, runTime, enemy } = context;
    const sample = paced(context, data.engagement);
    const state = (bag(context).threader ??= { startBeat: Math.ceil(beatPosition(enemy.entry.time)), frozenHops: -1 });
    const beat = beatPosition(runTime);
    let hops = Math.max(0, beat - state.startBeat + 1);
    // A slug inbound pins it mid-stitch; it cannot outrun the shot.
    if (pinned(context)) {
      if (state.frozenHops < 0) state.frozenHops = hops;
      hops = state.frozenHops;
    } else {
      state.frozenHops = -1;
    }
    const hop = Math.floor(hops);
    // The dash occupies the last third of each beat and lands on the next one.
    const frac = hops - hop;
    const dash = MathUtils.smoothstep(frac, 0.62, 1);
    const from = data.angle + data.step * hop;
    const to = from + data.step;
    const unfold = MathUtils.smoothstep(age, 0, 0.45);
    const r = MathUtils.lerp(BORE - 0.8, data.radius, unfold);
    const x = MathUtils.lerp(Math.cos(from) * r, Math.cos(to) * r, dash) * sample.tuckX;
    const y = MathUtils.lerp(Math.sin(from) * r, Math.sin(to) * r, dash) * sample.tuckY;
    place(context, sample.anchorU, x, y, Math.sin(age * 3 + enemy.id) * 0.3);
    // Nose along the chord it is about to run.
    const aim = offsetFromRail(context.curve, sample.anchorU, new Vector3(Math.cos(to) * r * sample.tuckX * WORLD, Math.sin(to) * r * sample.tuckY * WORLD, 0));
    enemy.mesh.lookAt(aim);
    enemy.mesh.userData.dash = dash > 0 && dash < 1 ? 1 : 0;
    return runTime > sample.passTime + MISS_GRACE;
  }

  // Leeches ride in on the coil they are draining and inch around its rim on
  // the beat. The coil arrives on its beat whether you kill them or not.
  function updateLeech(context: MassDriverUpdate, data: Extract<MassDriverSpawnData, { role: 'leech' }>) {
    const { age, runTime, enemy } = context;
    const beat = beatPosition(runTime);
    const inch = Math.floor(beat) + MathUtils.smoothstep(beat - Math.floor(beat), 0, 0.3);
    const angle = data.angle + data.inch * inch;
    const latch = MathUtils.smoothstep(age, 0, 0.5);
    const radius = MathUtils.lerp(BORE + 1.5, TARGET_MAX_RADIUS - 0.4, latch);
    place(context, ringU(data.ring), Math.cos(angle) * radius, Math.sin(angle) * radius, -0.5);
    faceCamera(context);
    // Open side of the clamp toward the coil it is gripping.
    enemy.mesh.rotateZ(angle);
    enemy.mesh.userData.drainingRing = data.ring;
    return runTime > ringTime(data.ring) + 0.05;
  }

  // Arc pylons hang near the wall and charge for one beat before each
  // discharge; the bolt leaves exactly on the beat.
  function updatePylon(context: MassDriverUpdate, data: Extract<MassDriverSpawnData, { role: 'pylon' }>) {
    const { age, runTime, enemy } = context;
    const sample = paced(context, data.engagement);
    const x = (data.x + Math.sin(age * 0.8 + data.seed) * 1.4) * sample.tuckX;
    const y = (data.y + Math.sin(age * 1.25 + data.seed * 2.1) * 1.0) * sample.tuckY;
    const state = (bag(context).pylon ??= { startBeat: Math.ceil(beatPosition(enemy.entry.time)), shots: 0 });
    const beat = beatPosition(runTime);
    const sinceStart = beat - state.startBeat;
    const nextShot = data.firstShot + state.shots * data.fireEvery;
    const untilShot = nextShot - sinceStart;
    enemy.mesh.userData.charge = untilShot < 1 ? MathUtils.clamp(1 - untilShot, 0, 1) : 0;
    // Rear back while charging, snap forward on release.
    const recoil = untilShot < 1 && untilShot > 0 ? (1 - untilShot) * 1.6 : 0;
    place(context, sample.anchorU, x, y, recoil);
    if (untilShot <= 0) {
      state.shots += 1;
      const ahead = distanceAheadOf(context);
      if (ahead > 6 * WORLD && runTime < sample.passTime - 0.9) fireBolt(context, x, y, ahead);
    }
    faceCamera(context);
    enemy.mesh.rotateZ(age * 0.7);
    enemy.mesh.rotateX(Math.sin(age * 0.9 + data.seed) * 0.4);
    return runTime > sample.passTime + MISS_GRACE;
  }

  // Bolts fly in the payload's own frame: they close at a fixed speed relative
  // to the camera no matter how fast the gun is moving, crackling sideways.
  function updateBolt(context: MassDriverUpdate, data: Extract<MassDriverSpawnData, { role: 'bolt' }>) {
    const { age, camera, enemy, damagePlayer, runTime } = context;
    const dt = Math.max(0, age - data.lastAge);
    data.lastAge = age;
    const state = (bag(context).bolt ??= { velocity: new Vector3(), fromAhead: data.ahead });
    const intercepted = interceptions.delete(enemy.id);

    if (data.impact.impactAt === undefined) {
      data.ahead = Math.max(0.5 * WORLD, data.ahead - BOLT_SPEED * dt);
      // Lateral offset shrinks faster than distance, so the bolt's bearing
      // swings onto the view axis and it always resolves into an impact.
      const closing = Math.min(1, data.ahead / state.fromAhead) ** 1.6;
      const jitter = Math.sin(age * 37 + enemy.id) * 0.25 * closing;
      const u = Math.min(1, railU(runTime) + data.ahead / RAIL_LENGTH);
      const next = offsetFromRail(context.curve, u, scratch.set((data.x * closing + jitter) * WORLD, (data.y * closing - jitter * 0.6) * WORLD, 0));
      state.velocity.copy(next).sub(enemy.mesh.position).divideScalar(Math.max(dt, 1 / 240));
      enemy.mesh.position.copy(next);
    }
    const impact = updateHostileShotImpact({
      age,
      camera,
      position: enemy.mesh.position,
      velocity: state.velocity,
      state: data.impact,
      intercepted,
      config: { hitDistance: 2.8 * WORLD, impactBrake: 0.3, damageDistance: 0.8 * WORLD },
    });
    faceCamera(context);
    enemy.mesh.rotateZ(age * 11);
    if (impact.phase === 'braking' && impact.damaged) {
      damagePlayer(1);
      return true;
    }
    return age > BOLT_MAX_AGE || shotBehindCamera(camera, enemy.mesh.position);
  }

  // The safety interlocks ride the barrel alongside the payload. They slam
  // shut on the beat, then hold station while the charge drags them closer.
  function updateInterlock(context: MassDriverUpdate, data: Extract<MassDriverSpawnData, { role: 'interlock' }>) {
    const { age, runTime, enemy, damagePlayer } = context;
    const entry = enemy.entry;
    const latch = MathUtils.clamp(age / INTERLOCK_LATCH_SECONDS, 0, 1);
    const slam = latch * latch * latch;
    const charge = MathUtils.clamp((runTime - CHARGE_TIME) / (VERDICT_TIME - CHARGE_TIME), 0, 1);
    const holdAhead = MathUtils.lerp(23, 16, charge);
    const ahead = MathUtils.lerp(120, holdAhead, slam) * WORLD;
    const beat = beatPosition(runTime);
    const shudder = Math.exp(-(beat - Math.floor(beat)) * 6) * (0.4 + charge * 0.9) * WORLD;
    const rx = 10.2;
    const ry = 7.2;
    const sway = Math.sin(age * 0.7 + data.angle * 3) * 0.08;
    const x = Math.cos(data.angle + sway) * MathUtils.lerp(BORE - 0.5, rx, slam);
    const y = Math.sin(data.angle + sway) * MathUtils.lerp(BORE - 0.5, ry, slam);
    const u = Math.min(1, railU(runTime) + (ahead - shudder) / RAIL_LENGTH);
    place(context, u, x, y);
    faceCamera(context);
    enemy.mesh.rotateZ(data.angle - Math.PI / 2);
    enemy.mesh.userData.latched = latch >= 1;

    if (latch >= 1 && runTime < VERDICT_TIME && entry.lockable === false && runState.outcome === 'pending') {
      entry.lockable = true;
      if (options.autoClearSafeties) return true;
    }

    // Exposed interlocks spit arc bolts at the payload every other bar.
    if (enemy.hitStageIndex > 0 && runTime < VERDICT_TIME - BEAT) {
      const state = (bag(context).interlock ??= { lastShotBeat: Math.floor(beat) });
      if (Math.floor(beat) >= state.lastShotBeat + 8 && Math.floor(beat) % 8 === (data.wave * 4 + Math.round(data.angle)) % 8) {
        state.lastShotBeat = Math.floor(beat);
        fireBolt(context, x, y, ahead);
      }
    }

    if (runTime >= VERDICT_TIME && runState.outcome === 'pending') runState.outcome = 'breach';
    if (runTime >= VERDICT_TIME) entry.lockable = false;
    if (runTime >= FIRE_TIME && runState.outcome === 'breach') {
      damagePlayer(MASS_DRIVER_PLAYER_HEALTH * 3);
      // Immortal inspection runs survive the breach; the dead safeties go with the barrel.
      return runTime > FIRE_TIME + 0.4;
    }
    return false;
  }

  // The discharge is the charge itself arriving at the muzzle. It cannot be
  // locked; it only delivers the verdict if nothing else is left to.
  function updateDischarge(context: MassDriverUpdate) {
    const { age, runTime, damagePlayer } = context;
    place(context, Math.min(1, railU(runTime) + (40 * WORLD) / RAIL_LENGTH), 0, 0);
    if (runState.outcome === 'pending') runState.outcome = interlockIds.size === 0 ? 'launch' : 'breach';
    if (runState.outcome === 'breach' && age > 0) damagePlayer(MASS_DRIVER_PLAYER_HEALTH * 3);
    return age > 0.6;
  }

  return {
    duration: MASS_DRIVER_DURATION,
    bpm: MASS_DRIVER_BPM,
    playerHealth: MASS_DRIVER_PLAYER_HEALTH,
    createRail: createMassDriverRail,
    spawnTimeline: timeline,
    easeRunProgress: massDriverRunProgress,
    startWord: 'CHARGE',
    replayWord: 'REFIRE',
    timing: {
      // A locked, even pulse: a volley lands as a straight run of 16ths — the
      // kill melody's own rhythm — instead of the default widening ramp, which
      // at this tempo would hold the sixth slug for a full bar while the rail
      // outruns it.
      // Every slug leaves the rail on release; the stagger is all travel time.
      // A delayed launch would start from a point the payload has already
      // overtaken at these speeds, chasing its target from behind.
      shotDelay: { pattern: 'linear', gapThirtyseconds: 2, releaseShare: 0 },
    },
    updateEnemy(context) {
      lastRunTime = context.runTime;
      const data = context.enemy.entry.data;
      switch (data.role) {
        case 'picket':
          return updatePicket(context, data);
        case 'threader':
          return updateThreader(context, data);
        case 'leech':
          return updateLeech(context, data);
        case 'pylon':
          return updatePylon(context, data);
        case 'bolt':
          return updateBolt(context, data);
        case 'interlock':
          return updateInterlock(context, data);
        case 'discharge':
          return updateDischarge(context);
      }
    },
    scoreForKill(volleySize, enemy) {
      if (enemy.kind === 'bolt') boltsDowned += 1;
      const chain = 1 + Math.max(0, volleySize - 1) * 0.15;
      let score = KILL_SCORE[enemy.kind] * chain;
      // The last safety pays for every beat left on the clock.
      if (enemy.kind === 'interlock' && interlockIds.size <= 1 && runState.interlocksSpawned === interlockEntries.length) {
        score += Math.max(0, Math.floor((VERDICT_TIME - lastRunTime) / BEAT)) * 60;
      }
      return Math.round(score);
    },
    // Cracking a leech shell, a pylon, or an interlock plate.
    scoreForHit: () => 40,
    scoreForVolley(results) {
      if (results.length < 4 || !results.every((result) => result.killed)) return 0;
      return results.length === 6 ? 600 : results.length * 80;
    },
    rankForRun(score, kills, totalEnemies) {
      const clearRate = totalEnemies === 0 ? 0 : kills / totalEnemies;
      const launched = runState.outcome === 'launch';
      if (launched && score >= 21000 && clearRate >= 0.9) return 'S';
      if (launched && score >= 15500 && clearRate >= 0.7) return 'A';
      if (launched && score >= 9000) return 'B';
      if (score >= 5000) return 'C';
      return 'D';
    },
    detailsForRun() {
      const lines: string[] = [];
      if (runState.outcome === 'launch') {
        const spare = runState.safetiesClearAt >= 0 ? VERDICT_TIME - runState.safetiesClearAt : 0;
        lines.push(spare > 0.05 ? `Safeties cleared with ${spare.toFixed(1)}s to spare` : 'Safeties cleared on the last beat');
        lines.push(`Muzzle exit at beat ${MUZZLE_RING} — payload away`);
      } else if (runState.interlocksSpawned > 0) {
        const cleared = runState.interlocksDestroyed;
        lines.push(cleared >= interlockEntries.length
          ? 'All safeties cleared — one beat too late'
          : `${cleared}/${interlockEntries.length} safeties cleared — barrel breach`);
      }
      lines.push(`Hull ${Math.max(0, MASS_DRIVER_PLAYER_HEALTH - hitsTaken)}/${MASS_DRIVER_PLAYER_HEALTH}`);
      if (boltsDowned > 0) lines.push(`${boltsDowned} arc bolt${boltsDowned === 1 ? '' : 's'} grounded`);
      return lines;
    },
  };
}

function easeOutCubic(t: number) {
  return 1 - (1 - t) ** 3;
}
