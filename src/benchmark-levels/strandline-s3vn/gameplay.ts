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
import { createSpeedProfile } from '../../engine/speed-profile';
import { section, sortTimeline } from '../../engine/spawn-patterns';
import type { EventBus } from '../../events';
import { createParent } from './parent';
import { CROWN_TIME, STRANDLINE_BPM, STRANDLINE_DURATION, bar } from './timing';

// STRANDLINE — sixty seconds inside the trailing strands of a jellyfish the
// size of a cathedral, cutting a violet infestation off it:
//
//   Drift  (bars 0–4)    Sunlit water, slow glide, the first clamped parasites.
//   Swarm  (bars 4–9)    The infestation shows itself. Larvae cross the frame.
//   Open   (bars 9–13)   The bundle billows open and the rail banks wide: for a
//                        few seconds the bell fills the view like a green moon.
//   Dive   (bars 13–18)  Back into the strands, climbing toward the crown.
//   Crown  (bars 18–25)  The parent, dug in where the strands root into the bell.
//   Clear  (bars 25–28)  The animal comes back to life and drifts on.
//
// The animal's own geometry lives in visuals/animal.ts; this module owns the
// bundle axis and the rail that threads it, because every spawn anchor is
// rail-relative and the animal has to be built around the same axis.

export {
  CLEAR_TIME,
  CROWN_TIME,
  DIVE_TIME,
  OPEN_TIME,
  STRANDLINE_BPM,
  STRANDLINE_DURATION,
  SWARM_TIME,
  bar,
} from './timing';

export const STRANDLINE_PLAYER_HEALTH = 3;

// ---- the bundle axis --------------------------------------------------------

// The animal drifts along +AXIS; its tentacles trail back along -AXIS, so the
// player flies up the bundle toward the bell. A gentle rise keeps the sunlit
// surface above the frame the whole way.
export const AXIS = new Vector3(0, 0.24, -1).normalize();
export const AXIS_RIGHT = new Vector3(1, 0, 0);
export const AXIS_UP = new Vector3().crossVectors(AXIS_RIGHT, AXIS).normalize();

/** Axis distance the rail covers. */
export const RAIL_SPAN = 760;

/** Bell radius. The engine camera's far plane is 500 units, so the animal is
 *  built at a scale that fits inside it whole. */
export const BELL_RADIUS = 150;
/** Where the bell's centre sits ahead of the crown, in the animal's own frame. */
export const BELL_LOCAL = 40;

export function axisPoint(distance: number, x = 0, y = 0, out = new Vector3()) {
  return out
    .copy(AXIS)
    .multiplyScalar(distance)
    .addScaledVector(AXIS_RIGHT, x)
    .addScaledVector(AXIS_UP, y);
}

/** How far along the bundle a world position sits. */
export function axisDistance(position: Vector3) {
  return position.dot(AXIS);
}

// The bundle is narrow where it roots and spreads as it trails — the flare is a
// property of the animal, not of where you happen to be in the run.
export function bundleFlare(trail: number) {
  const t = MathUtils.clamp(trail / 620, 0, 1.4);
  return 1 + t * 0.55;
}

// ---- the animal's station ----------------------------------------------------

// The jellyfish is swimming too. Rather than parking its crown at a fixed point
// a kilometre away — most of which the camera could never draw — it holds
// station ahead of the rail and lets you close on it: distant and hazy while
// you learn the strands, right on top of you by the time you reach the crown.
// Every distance the animal is drawn at is chosen from this one curve.
const GAP_KEYS: Array<[number, number]> = [
  [bar(0), 400],
  [bar(4), 360],
  [bar(9), 300],
  [bar(13), 250],
  [bar(18), 190],
  [bar(23), 115],
  [bar(25), 78],
  [bar(28), 70],
];

export function crownGapAt(runTime: number) {
  const t = MathUtils.clamp(runTime, GAP_KEYS[0][0], GAP_KEYS[GAP_KEYS.length - 1][0]);
  for (let i = 1; i < GAP_KEYS.length; i += 1) {
    if (t <= GAP_KEYS[i][0]) {
      const [t0, v0] = GAP_KEYS[i - 1];
      const [t1, v1] = GAP_KEYS[i];
      const k = (t - t0) / Math.max(0.0001, t1 - t0);
      return MathUtils.lerp(v0, v1, k * k * (3 - 2 * k));
    }
  }
  return GAP_KEYS[GAP_KEYS.length - 1][1];
}

/** World position of the crown at a moment in the run. */
export function crownPosition(curve: CatmullRomCurve3, runTime: number, out = new Vector3()) {
  const u = MathUtils.clamp(strandlineRunProgress(runTime), 0, 1);
  const cameraAxis = axisDistance(curve.getPointAt(u));
  return axisPoint(cameraAxis + crownGapAt(runTime), 0, 0, out);
}

// ---- rail -------------------------------------------------------------------

// (axis fraction, right, up). Two rules govern this curve. The weave has to
// stay shallow enough that the crown — the thing you are flying toward — never
// leaves the frame, because a rail that swings its own destination off screen
// has no destination. And the bank across 0.29–0.70 has to go out and then
// *hold*: the camera parks outside the bundle for four bars with its heading
// still pointed up the axis, which is the only way the bell can sit in the
// middle of the frame like a moon instead of whipping past the edge.
const RAIL_KEYS: ReadonlyArray<readonly [number, number, number]> = [
  [0.000, 0, 0],
  [0.075, -7, 4],
  [0.150, 8, 7],
  [0.225, -6, -3],
  [0.255, 6, 4],
  [0.315, 38, 12],
  [0.375, 68, 19],
  [0.430, 78, 18],
  [0.490, 76, 12],
  [0.545, 66, 8],
  [0.610, 30, 2],
  [0.680, 2, 6],
  [0.755, 9, -3],
  [0.815, -7, 5],
  [0.875, 6, 4],
  [0.940, -3, 2],
  [1.000, 0, 0],
];

export function createStrandlineRail() {
  return new CatmullRomCurve3(
    RAIL_KEYS.map(([f, x, y]) => axisPoint(f * RAIL_SPAN, x, y)),
    false,
    'catmullrom',
    0.4,
  );
}

// ---- speed ------------------------------------------------------------------

// A jellyfish pace: never fast, never still. The bank into open water is the
// one surge; the last three bars coast to almost nothing so the animal can pull
// away from you under its own power.
const SPEED_KEYS: Array<[number, number]> = [
  [bar(0), 0.52],
  [bar(2), 0.66],
  [bar(4), 0.92],
  [bar(8), 1.02],
  [bar(9), 1.45],
  [bar(11), 1.34],
  [bar(13), 1.12],
  [bar(16), 1.32],
  [bar(18), 1.1],
  [bar(23), 1.0],
  [bar(25), 0.5],
  [bar(26.5), 0.2],
  [bar(28), 0.08],
];

const speedProfile = createSpeedProfile(SPEED_KEYS, STRANDLINE_DURATION);
export const speedFactorAt = speedProfile.speedAt;

export function strandlineRunProgress(time: number, duration = STRANDLINE_DURATION) {
  return speedProfile.runProgress(time, duration);
}

/** Rail parameter the camera occupies at run time `t` — for seating set pieces. */
export const railU = (time: number) => strandlineRunProgress(time);

// Fixed anchors are overtaken `lead` seconds after they spawn; this grace is
// the slack past the anchor before a target counts as escaped.
const MISS_MARGIN_U = 0.012;

// ---- spawn data --------------------------------------------------------------

export type StrandlineKind = 'cling' | 'drifter' | 'chewer' | 'stinger' | 'spore' | 'brood' | 'parent';

// Timeline data is immutable: the engine reuses the timeline across runs.
// Per-enemy mutable state lives in enemyState bags; spores get fresh objects.
export type StrandlineData =
  | { role: 'cling'; lead: number; x: number; y: number; detach: number; seed: number }
  | { role: 'drifter'; lead: number; fromX: number; toX: number; y: number; arc: number; delay: number; cross: number }
  | { role: 'chewer'; lead: number; x: number; y: number; seed: number }
  | { role: 'stinger'; lead: number; x: number; y: number; seed: number }
  | { role: 'spore'; position: Vector3; velocity: Vector3; lastAge: number; impact: HostileShotImpactState }
  | { role: 'brood'; wave: number; slot: number; seed: number }
  | { role: 'parent' };

export type StrandlineEntry = LockOnSpawnEntry<StrandlineKind, StrandlineData>;
export type StrandlineUpdate = LockOnEnemyUpdate<StrandlineKind, StrandlineData>;

// ---- timeline builders --------------------------------------------------------

// One knob over every authored lead. Leads are written in the seconds a target
// should stay on screen; this trims them together when the whole timeline needs
// to engage a little closer in without reshaping any individual wave.
const LEAD_SCALE = 0.9;


/** Parasites clamped on strands ahead; they let go as you close. */
const clings = (
  time: number,
  lead: number,
  posts: ReadonlyArray<readonly [number, number]>,
  options: { stagger?: number; detach?: number } = {},
): StrandlineEntry[] =>
  posts.map(([x, y], index) => ({
    time: time + index * (options.stagger ?? 0.1),
    kind: 'cling',
    data: {
      role: 'cling',
      lead: lead * LEAD_SCALE,
      x,
      y,
      detach: (options.detach ?? 1.15) + index * 0.09,
      seed: time * 3.7 + index * 1.31,
    },
  }));

/** Free-swimming larvae crossing the frame. */
const drifters = (
  time: number,
  lead: number,
  runs: ReadonlyArray<{ fromX: number; toX: number; y: number; arc: number; delay?: number; cross?: number }>,
): StrandlineEntry[] =>
  runs.map((run, index) => ({
    time: time + index * 0.08,
    kind: 'drifter',
    data: {
      role: 'drifter',
      lead: lead * LEAD_SCALE,
      fromX: run.fromX,
      toX: run.toX,
      y: run.y,
      arc: run.arc,
      delay: run.delay ?? index * 0.3,
      cross: run.cross ?? 2.6,
    },
  }));

/** Armoured borers wound around a strand; two shells deep. */
const chewers = (time: number, lead: number, posts: ReadonlyArray<readonly [number, number]>): StrandlineEntry[] =>
  posts.map(([x, y], index) => ({
    time: time + index * 0.35,
    kind: 'chewer',
    hitStages: [2, 2],
    data: { role: 'chewer', lead: lead * LEAD_SCALE, x, y, seed: time * 2.3 + index * 5.1 },
  }));

/** Station-keeping spitters that lob homing spores. */
const stingers = (time: number, lead: number, posts: ReadonlyArray<readonly [number, number]>): StrandlineEntry[] =>
  posts.map(([x, y], index) => ({
    time: time + index * 0.22,
    kind: 'stinger',
    data: { role: 'stinger', lead: lead * LEAD_SCALE, x, y, seed: time * 1.7 + index * 3.3 },
  }));

/** Three larvae braided across the full width of the frame. */
const wideCross = (y0: number, spread: number, cross: number) => [
  { fromX: -32, toX: 32, y: y0 + spread, arc: 3.0, delay: 0, cross },
  { fromX: 32, toX: -32, y: y0, arc: -2.4, delay: 0.34, cross },
  { fromX: -32, toX: 32, y: y0 - spread, arc: 2.2, delay: 0.68, cross },
];

function buildTimeline(): StrandlineEntry[] {
  return sortTimeline([
    // --- Drift: learn the sweep. Wide, slow, unhurried; the water is calm.
    ...clings(bar(1), 3.6, [[-24, 5], [22, -7]], { stagger: 0.5, detach: 1.5 }),
    ...clings(bar(2.25), 3.4, [[-19, -11], [2, 13], [21, 3]], { stagger: 0.28, detach: 1.35 }),
    ...drifters(bar(3.1), 3.2, [
      { fromX: -30, toX: 30, y: 9, arc: 2.6, delay: 0, cross: 2.8 },
      { fromX: 30, toX: -30, y: -6, arc: -2.2, delay: 0.42, cross: 2.8 },
    ]),

    // --- Swarm: the infestation is everywhere once you know its shape.
    ...clings(bar(4), 3.3, [[-27, 2], [-9, 14], [11, -12], [26, 6]], { stagger: 0.22, detach: 1.25 }),
    ...drifters(bar(5), 3.0, wideCross(3, 10, 2.5)),
    ...clings(bar(6), 3.2, [[-28, -6], [-16, 9], [-3, -13], [10, 13], [22, -4], [30, 8]], { stagger: 0.15, detach: 1.1 }),
    ...chewers(bar(7.25), 4.4, [[-13, 5]]),
    ...drifters(bar(7.5), 2.9, [
      { fromX: 31, toX: -31, y: 12, arc: -2.0, delay: 0, cross: 2.4 },
      { fromX: -31, toX: 31, y: -9, arc: 2.8, delay: 0.3, cross: 2.4 },
    ]),
    ...clings(bar(8.25), 3.0, [[-22, 11], [4, -14], [25, 1]], { stagger: 0.18, detach: 1.0 }),

    // --- Open: the bundle billows apart and the bell arrives. One bar of
    // nothing but the animal, then a wide fan swept against a green moon.
    ...stingers(bar(10), 3.6, [[-23, 8], [24, -5]]),
    ...drifters(bar(10.6), 2.8, wideCross(6, 12, 2.3)),
    ...drifters(bar(11.5), 2.8, [
      { fromX: -34, toX: 34, y: -12, arc: 3.4, delay: 0, cross: 2.2 },
      { fromX: -34, toX: 34, y: 1, arc: 2.4, delay: 0.22, cross: 2.2 },
      { fromX: 34, toX: -34, y: 14, arc: -1.8, delay: 0.44, cross: 2.2 },
      { fromX: 34, toX: -34, y: -4, arc: -2.8, delay: 0.66, cross: 2.2 },
      { fromX: -34, toX: 34, y: 10, arc: 2.0, delay: 0.88, cross: 2.2 },
      { fromX: 34, toX: -34, y: -16, arc: -3.6, delay: 1.1, cross: 2.2 },
    ]),
    ...stingers(bar(12.4), 3.2, [[-14, -10], [16, 11]]),

    // --- Dive: back inside the strands, climbing. The densest stretch.
    ...clings(bar(13), 3.0, [[-26, -4], [-8, 12], [12, -12], [28, 4]], { stagger: 0.16, detach: 1.05 }),
    ...chewers(bar(14), 4.2, [[14, -6], [-15, 8]]),
    ...drifters(bar(14.6), 2.7, wideCross(-2, 11, 2.2)),
    ...clings(bar(15.4), 2.9, [[-30, 6], [-17, -9], [-4, 12], [9, -13], [21, 7], [31, -2]], { stagger: 0.13, detach: 0.95 }),
    ...stingers(bar(16.4), 3.0, [[-20, 10], [21, -8]]),
    ...drifters(bar(16.8), 2.6, [
      { fromX: -32, toX: 32, y: 13, arc: 2.4, delay: 0, cross: 2.1 },
      { fromX: 32, toX: -32, y: -13, arc: -2.4, delay: 0.26, cross: 2.1 },
    ]),
    ...clings(bar(17.3), 2.8, [[-24, -10], [0, 14], [24, -3]], { stagger: 0.14, detach: 0.9 }),

    // --- Crown: the parent. Broods come from the boss, not the timeline;
    // these are the strays still feeding while you fight it.
    { time: CROWN_TIME, kind: 'parent', hitStages: [2, 2, 2], data: { role: 'parent' } },
    ...section(CROWN_TIME,
      drifters(bar(2.2), 3.0, [
        { fromX: -31, toX: 31, y: -14, arc: 2.6, delay: 0, cross: 2.3 },
        { fromX: 31, toX: -31, y: 15, arc: -2.2, delay: 0.3, cross: 2.3 },
      ]),
      clings(bar(4.3), 2.8, [[-27, 3], [27, -5]], { stagger: 0.2, detach: 0.9 }),
      // Last of the colony, thrown at you while the rail is already leaving.
      drifters(bar(5.7), 2.8, [
        { fromX: -30, toX: 30, y: 8, arc: 2.4, delay: 0, cross: 2.2 },
        { fromX: 30, toX: -30, y: -9, arc: -2.6, delay: 0.28, cross: 2.2 },
        { fromX: -26, toX: 26, y: 0, arc: 3.0, delay: 0.56, cross: 2.2 },
      ]),
    ),

    // (bars 25–28: the clear. Nothing spawns; the animal is the payoff.)
  ]);
}

const KILL_SCORE: Record<StrandlineKind, number> = {
  cling: 110,
  drifter: 130,
  chewer: 300,
  stinger: 230,
  spore: 55,
  brood: 260,
  parent: 3000,
};

const SPORE_MAX_AGE = 11;

export function createStrandlineGameplay(bus: EventBus): LockOnRunnerLevel<StrandlineKind, StrandlineData> {
  const timeline = buildTimeline();

  const interceptions = new Set<number>();
  let hitsTaken = 0;
  let sporesShot = 0;
  let clingsFreed = 0;

  bus.on('runstart', () => {
    interceptions.clear();
    hitsTaken = 0;
    sporesShot = 0;
    clingsFreed = 0;
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

  function spitSpore(context: StrandlineUpdate, from: Vector3) {
    const initial = hostileShotAimPoint(context.camera, from).sub(from).normalize().multiplyScalar(4.5);
    context.spawnEnemy({
      time: context.runTime,
      kind: 'spore',
      countsTowardTotal: false,
      data: { role: 'spore', position: from.clone(), velocity: initial, lastAge: 0, impact: {} },
    });
  }

  const parent = createParent(bus, { spitSpore, crownPosition });

  // ---- movement -----------------------------------------------------------------

  const scratch = new Vector3();

  /** A parasite clamped on a strand: still, breathing, then it lets go. */
  function updateCling(context: StrandlineUpdate, data: Extract<StrandlineData, { role: 'cling' }>) {
    const { enemy, runProgress, age, curve, camera, railAnchor } = context;
    const anchorU = railAnchor(data.lead);
    const detached = age - data.detach;
    const mesh = enemy.mesh;

    if (detached < 0) {
      // Clamped. The body works like a fist slowly opening and closing.
      mesh.position.copy(offsetFromRail(curve, anchorU, scratch.set(data.x, data.y, 0)));
      const frame = sampleRailFrame(curve, anchorU);
      mesh.lookAt(scratch.copy(mesh.position).add(frame.tangent));
      mesh.rotateZ(data.seed);
      mesh.userData.grip = 1;
      mesh.userData.breathe = Math.sin(age * 2.4 + data.seed) * 0.5 + 0.5;
      return false;
    }

    // Let go: it kicks off its strand and pulses at you, medusa-style — a hard
    // contraction, then a long coast.
    const pulse = detached * 2.1;
    const swim = pulse * 1.6 + Math.max(0, Math.sin(pulse * Math.PI - Math.PI / 2)) * 1.4;
    const spread = Math.hypot(data.x, data.y);
    const radial = spread < 0.001 ? 0 : Math.min(9, swim * 1.5) / spread;
    mesh.position.copy(offsetFromRail(curve, anchorU, scratch.set(
      data.x * (1 + radial),
      data.y * (1 + radial) + Math.sin(detached * 3.1 + data.seed) * 0.8,
      -Math.min(16, swim * 3.4),
    )));
    mesh.lookAt(camera.position);
    mesh.rotateZ(Math.sin(detached * 1.7 + data.seed) * 0.5);
    mesh.userData.grip = 0;
    mesh.userData.breathe = Math.max(0, Math.sin(pulse * Math.PI - Math.PI / 2));
    return runProgress > anchorU + MISS_MARGIN_U;
  }

  /** A larva crossing the frame on a long swimming arc. */
  function updateDrifter(context: StrandlineUpdate, data: Extract<StrandlineData, { role: 'drifter' }>) {
    const { enemy, runProgress, age, curve, railAnchor } = context;
    const anchorU = railAnchor(data.lead);
    const t = (age - data.delay) / data.cross;
    if (t > 1.2 || runProgress > anchorU + MISS_MARGIN_U) return true;
    const clamped = MathUtils.clamp(t, 0, 1);
    const eased = clamped * clamped * (3 - 2 * clamped);
    const stroke = Math.sin(age * 5.2 + enemy.id);
    const x = MathUtils.lerp(data.fromX, data.toX, eased);
    const y = data.y + Math.sin(clamped * Math.PI) * data.arc + stroke * 0.55;
    enemy.mesh.position.copy(offsetFromRail(curve, anchorU, scratch.set(x, y, 0)));
    const ahead = offsetFromRail(curve, anchorU, scratch.set(
      MathUtils.lerp(data.fromX, data.toX, Math.min(1, eased + 0.06)),
      data.y + Math.sin(Math.min(1, clamped + 0.06) * Math.PI) * data.arc,
      0,
    ));
    enemy.mesh.lookAt(ahead);
    // Undulate: the whole body rolls through each stroke.
    enemy.mesh.rotateZ(stroke * 0.6);
    enemy.mesh.userData.stroke = stroke;
    return false;
  }

  /** A borer wound around a strand, screwing its way down toward you. */
  function updateChewer(context: StrandlineUpdate, data: Extract<StrandlineData, { role: 'chewer' }>) {
    const { enemy, runProgress, age, curve, railAnchor } = context;
    const anchorU = railAnchor(data.lead);
    const state = context.enemyState(() => ({ spat: false }));
    const crawl = Math.min(26, age * 4.6);
    const roll = age * 1.35 + data.seed;
    enemy.mesh.position.copy(offsetFromRail(curve, anchorU, scratch.set(
      data.x + Math.cos(roll) * 1.1,
      data.y + Math.sin(roll) * 1.1,
      -crawl,
    )));
    const frame = sampleRailFrame(curve, anchorU);
    enemy.mesh.lookAt(scratch.copy(enemy.mesh.position).add(frame.tangent));
    enemy.mesh.rotateZ(roll * 2.1);
    enemy.mesh.userData.armour = enemy.hitStageIndex === 0;

    // Anything still eating when it draws level spits once on the way past.
    if (!state.spat && runProgress > anchorU - MISS_MARGIN_U * 0.6) {
      state.spat = true;
      spitSpore(context, enemy.mesh.position);
    }
    return runProgress > anchorU + MISS_MARGIN_U;
  }

  /** A spitter holding station, sac swelling before each shot. */
  function updateStinger(context: StrandlineUpdate, data: Extract<StrandlineData, { role: 'stinger' }>) {
    const { enemy, runProgress, age, curve, camera, railAnchor } = context;
    const anchorU = railAnchor(data.lead);
    const state = context.enemyState(() => ({ fireAt: 1.35 + (data.seed % 0.6) }));
    const orbit = age * 0.9 + data.seed;
    enemy.mesh.position.copy(offsetFromRail(curve, anchorU, scratch.set(
      data.x + Math.cos(orbit) * 2.6,
      data.y + Math.sin(orbit * 1.3) * 2.0,
      0,
    )));
    enemy.mesh.lookAt(camera.position);
    enemy.mesh.rotateZ(Math.sin(age * 1.6 + data.seed) * 0.4);

    const untilShot = state.fireAt - age;
    enemy.mesh.userData.charge = untilShot < 0.9 ? MathUtils.clamp(1 - untilShot / 0.9, 0, 1) : 0;
    if (age >= state.fireAt) {
      state.fireAt = age + 2.6;
      enemy.mesh.userData.charge = 0;
      spitSpore(context, enemy.mesh.position);
    }
    return runProgress > anchorU + MISS_MARGIN_U;
  }

  /** A spat spore: homing, interceptable, and it brakes visibly before it bites. */
  function updateSpore(context: StrandlineUpdate, data: Extract<StrandlineData, { role: 'spore' }>) {
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
      enemy.mesh.rotateZ(age * 5.5);
      if (impact.damaged) {
        damagePlayer(1);
        return true;
      }
      return false;
    }

    steerHomingShot(data.position, data.velocity, hostileShotAimPoint(camera, data.position), age, dt, {
      baseSpeed: 5,
      maxSpeed: 11,
      accel: 2.6,
      turnRate: 2.1,
    });
    enemy.mesh.position.copy(data.position);
    if (data.velocity.lengthSq() > 0.001) enemy.mesh.lookAt(scratch.copy(data.position).add(data.velocity));
    return age > SPORE_MAX_AGE || shotBehindCamera(camera, data.position);
  }

  // ---- level definition -----------------------------------------------------------

  return {
    duration: STRANDLINE_DURATION,
    bpm: STRANDLINE_BPM,
    playerHealth: STRANDLINE_PLAYER_HEALTH,
    createRail: createStrandlineRail,
    spawnTimeline: timeline,
    easeRunProgress: strandlineRunProgress,
    startWord: 'AWAKEN',
    replayWord: 'REVIVE',
    // The water is thick and the pace is slow: a slightly wider lock radius
    // keeps sweeping across a drifting shoal feeling like a caress, not a poke.
    lockRadiusNdc: 0.095,
    updateEnemy(context) {
      const data = context.enemy.entry.data;
      switch (data.role) {
        case 'cling':
          return updateCling(context, data);
        case 'drifter':
          return updateDrifter(context, data);
        case 'chewer':
          return updateChewer(context, data);
        case 'stinger':
          return updateStinger(context, data);
        case 'spore':
          return updateSpore(context, data);
        case 'brood':
          return parent.updateBrood(context, data);
        case 'parent':
          return parent.updateParent(context);
      }
    },
    validateRelease(enemies) {
      return parent.validateRelease(enemies);
    },
    scoreForKill(volleySize, enemy) {
      if (enemy.kind === 'cling') clingsFreed += 1;
      if (enemy.kind === 'spore') sporesShot += 1;
      const multiplier = 1 + Math.max(0, volleySize - 1) * 0.2;
      return Math.round(KILL_SCORE[enemy.kind] * multiplier);
    },
    // Chipping a borer's shell or the parent's mantle pays a little.
    scoreForHit: () => 50,
    scoreForVolley(results) {
      if (results.length < 4 || !results.every((result) => result.killed)) return 0;
      return results.length === 6 ? 600 : results.length * 70;
    },
    rankForRun(score, kills, totalEnemies) {
      const clearRate = totalEnemies === 0 ? 0 : kills / totalEnemies;
      if (parent.killed() && score >= 15000 && clearRate >= 0.9) return 'S';
      if (parent.killed() && score >= 11000 && clearRate >= 0.68) return 'A';
      if (score >= 6500 && clearRate >= 0.45) return 'B';
      if (score >= 2800 && clearRate >= 0.22) return 'C';
      return 'D';
    },
    detailsForRun() {
      const hull = Math.max(0, STRANDLINE_PLAYER_HEALTH - hitsTaken);
      const lines = [`Suit integrity ${hull}/${STRANDLINE_PLAYER_HEALTH}`];
      if (clingsFreed > 0) lines.push(`${clingsFreed} strand${clingsFreed === 1 ? '' : 's'} pried clean`);
      if (sporesShot > 0) lines.push(`${sporesShot} spore${sporesShot === 1 ? '' : 's'} cut down`);
      lines.push(parent.summaryLine());
      return lines;
    },
  };
}
