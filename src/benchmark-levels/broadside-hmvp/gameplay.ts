import { MathUtils, Matrix4, Vector3 } from 'three';
import {
  hostileShotAimPoint,
  shotBehindCamera,
  steerHomingShot,
  updateHostileShotImpact,
  type HostileShotImpactState,
} from '../../engine/hostile-shot';
import type { LockOnEnemyUpdate, LockOnRunnerLevel, LockOnSpawnEntry } from '../../engine/lock-on-runner';
import { createRailPacer, type RailLead } from '../../engine/rail-pacer';
import { sortTimeline } from '../../engine/spawn-patterns';
import type { EventBus } from '../../events';
import { applyAttractCamera, applyFlownCamera } from './camera';
import { bankAt, broadsideRail, frameAtTime, runProgress, viewFrameAt, type ViewFrame } from './flight';
import { CORE_MOUNTS, GENERATOR_MOUNTS, KEEL_TURRETS, POINT_DEFENSE_MOUNTS } from './setpieces';
import { BARS, BEAT_SECONDS, BROADSIDE_BPM, BROADSIDE_DURATION, bar } from './timing';

// BROADSIDE — sixty seconds across a fleet engagement, 34 bars at 136 BPM.
//
//   Launch     (0–2)    catapult off our carrier's deck on the bar-1 downbeat
//   The gaps   (2–8)    darts stream and ring-wings braid through the crossfire;
//                       two corkscrews thread between passing capital ships
//   Broadside  (8–14)   the long run down VALIANT's flank as its batteries fire
//                       overhead; torpedo bombers go for her hull
//   The eye    (14–16)  near silence; a few slow targets in the wreckage
//   The keel   (16–20)  under an enemy warship's belly; rake the turrets
//   Flagship   (20–24)  close pass down its flank: four shield generators
//                       while point defense fills the air
//   Come-around(24–26)  the shield falls on the downbeat, escorts pour in,
//                       the rail banks hard around the stern
//   Trench     (26–30)  dive the dorsal trench: three exposed power cores
//   Victory    (30–34)  pull out past the breaking flagship
//
// Swarm craft fight in the camera's banked frame — they stay put on screen
// while the battle wheels around them. Hull-mounted targets are world-fixed.

export { BROADSIDE_BPM, BROADSIDE_DURATION } from './timing';
export const BROADSIDE_PLAYER_HEALTH = 5;

export type BroadsideEnemyKind = 'dart' | 'ringwing' | 'lancer' | 'bomber' | 'turret' | 'bolt' | 'generator' | 'core';

type XY = readonly [number, number];

export type BroadsideSpawnData =
  | { role: 'dart'; engagement: RailLead; from: XY; via: XY; to: XY; cross: number; zSwing: number }
  | { role: 'ringwing'; engagement: RailLead; from: XY; to: XY; radius: number; phase: number; spin: number; cross: number; worldRoll: boolean }
  | { role: 'lancer'; side: -1 | 1; slot: XY; hold: number; firstShotBeat: number; shots: number; fromAbove: boolean }
  | { role: 'bomber'; engagement: RailLead; from: XY; to: XY; cross: number }
  | { role: 'turret'; mount: number; firstShotBeat: number }
  | { role: 'generator'; mount: number }
  | { role: 'core'; mount: number }
  | { role: 'bolt'; position: Vector3; velocity: Vector3; lastAge: number; impact: HostileShotImpactState; lastCamera: Vector3; source: 'lancer' | 'turret' | 'flak' };

export type BroadsideSpawnEntry = LockOnSpawnEntry<BroadsideEnemyKind, BroadsideSpawnData>;
type Update = LockOnEnemyUpdate<BroadsideEnemyKind, BroadsideSpawnData>;

// ---- tuning ----------------------------------------------------------------------

const SPAWN_AHEAD = 62;
const pacer = createRailPacer({
  curve: broadsideRail(),
  duration: BROADSIDE_DURATION,
  runProgress: (time, duration) => runProgress(time, duration),
  spawnAheadUnits: SPAWN_AHEAD,
  defaultLeadSeconds: 3.3,
});

const LANCER_SLOT_DISTANCE = 36;
const TURRET_WAKE_DISTANCE = 130;
const GENERATOR_WAKE_DISTANCE = 190;
const CORE_WAKE_DISTANCE = 165;
const BOLT_MAX_AGE = 9;

const KILL_SCORE: Record<BroadsideEnemyKind, number> = {
  dart: 100,
  ringwing: 140,
  lancer: 260,
  bomber: 420,
  turret: 240,
  bolt: 50,
  generator: 900,
  core: 1600,
};

// ---- timeline authoring helpers ----------------------------------------------------------

const T = (barValue: number) => bar(barValue);

type StreamSpec = { at: number; count: number; spacing?: number; lead?: number; from: XY; via: XY; to: XY; cross?: number; zSwing?: number };

/** A stream of darts: each follows the same curve, strung out behind the leader. */
function darts(spec: StreamSpec): BroadsideSpawnEntry[] {
  const spacing = spec.spacing ?? BEAT_SECONDS / 2;
  return Array.from({ length: spec.count }, (_, index) => {
    const time = T(spec.at) + index * spacing;
    return {
      time,
      kind: 'dart' as const,
      data: {
        role: 'dart' as const,
        engagement: pacer.resolve(time, spec.lead ?? 3.3),
        from: spec.from,
        via: spec.via,
        to: spec.to,
        cross: spec.cross ?? 3.2,
        zSwing: spec.zSwing ?? 6,
      },
    };
  });
}

type BraidSpec = { at: number; count?: number; lead?: number; from: XY; to: XY; radius?: number; spin?: number; cross?: number; worldRoll?: boolean };

/** Ring-wings braided around a drifting axis: a knot you sweep in a circle. */
function braid(spec: BraidSpec): BroadsideSpawnEntry[] {
  const count = spec.count ?? 3;
  return Array.from({ length: count }, (_, index) => {
    const time = T(spec.at) + index * 0.04;
    return {
      time,
      kind: 'ringwing' as const,
      data: {
        role: 'ringwing' as const,
        engagement: pacer.resolve(time, spec.lead ?? 3.8),
        from: spec.from,
        to: spec.to,
        radius: spec.radius ?? 6,
        phase: (index / count) * Math.PI * 2,
        spin: spec.spin ?? 2.3,
        cross: spec.cross ?? 3.6,
        worldRoll: spec.worldRoll ?? false,
      },
    };
  });
}

/** Lancers overtake from behind, brake into a slot, fire on the beat, then break away. */
function lancer(at: number, side: -1 | 1, slot: XY, shots = 1, hold = 3.2, fromAbove = false): BroadsideSpawnEntry {
  const time = T(at);
  return {
    time,
    kind: 'lancer',
    hitPoints: 2,
    data: { role: 'lancer', side, slot, hold, firstShotBeat: Math.ceil((time + 1.3) / BEAT_SECONDS), shots, fromAbove },
  };
}

function bombers(at: number, runs: Array<{ from: XY; to: XY; delay?: number }>): BroadsideSpawnEntry[] {
  return runs.map((run, index) => {
    const time = T(at) + (run.delay ?? index * BEAT_SECONDS);
    return {
      time,
      kind: 'bomber' as const,
      hitPoints: 3,
      data: { role: 'bomber' as const, engagement: pacer.resolve(time, 6.4), from: run.from, to: run.to, cross: 5.6 },
    };
  });
}

/** Time the camera is `distance` along-track short of a world point. */
function wakeTime(world: Vector3, passBar: number, distance: number) {
  let t = T(passBar);
  for (let i = 0; i < 400; i += 1) {
    const frame = frameAtTime(t);
    const along = world.clone().sub(frame.position).dot(frame.forward);
    if (along >= distance || t <= 0) break;
    t -= 0.02;
  }
  return Math.max(0, t);
}

// ---- the score ---------------------------------------------------------------------------

function buildTimeline(): BroadsideSpawnEntry[] {
  const entries: BroadsideSpawnEntry[] = [
    // LAUNCH — the first stream crosses as the theme lands on bar 2.
    ...darts({ at: 1.5, count: 4, from: [70, 14], via: [8, 20], to: [-58, 4], lead: 4.4 }),

    // THE GAPS
    ...darts({ at: 2.5, count: 5, from: [-74, -10], via: [-4, -22], to: [62, -4] }),
    ...braid({ at: 3.25, from: [24, 14], to: [-22, -8] }),
    ...darts({ at: 3.75, count: 4, from: [72, 26], via: [10, 6], to: [-52, 22], cross: 2.5 }),
    lancer(4.0, -1, [-20, 8]),
    lancer(4.1, 1, [21, -9]),
    // Corkscrew 1: a ring of ring-wings that holds still in the world while we roll.
    ...braid({ at: 4.6, count: 5, from: [0, 2], to: [0, -2], radius: 17, spin: 0.35, cross: 3.4, lead: 4.6, worldRoll: true }),
    ...darts({ at: 5.75, count: 3, from: [-70, 24], via: [-10, 10], to: [56, 26] }),
    ...darts({ at: 5.85, count: 3, from: [70, -22], via: [10, -12], to: [-56, -20] }),
    // Corkscrew 2
    ...braid({ at: 6.8, count: 6, from: [0, 0], to: [0, 0], radius: 19, spin: -0.4, cross: 3.4, lead: 4.6, worldRoll: true }),
    ...braid({ at: 7.4, from: [-26, -12], to: [20, 12], radius: 5.5 }),

    // BROADSIDE — bombers make torpedo runs at VALIANT; darts and lancers escort.
    // VALIANT's hull fills the upper left (x < −8 with y > −2, and everything above
    // y ≈ 36), so every path stays in the open water to starboard and below.
    ...bombers(8.0, [{ from: [58, -14], to: [-12, 2] }, { from: [62, 10], to: [-7, 12], delay: BEAT_SECONDS * 2 }]),
    ...darts({ at: 8.5, count: 5, from: [76, -26], via: [18, -30], to: [-40, -18] }),
    ...darts({ at: 9.25, count: 6, from: [72, 28], via: [12, 24], to: [-4, -34], spacing: BEAT_SECONDS / 3 }),
    lancer(9.9, 1, [24, 10]),
    ...bombers(10.0, [{ from: [64, -6], to: [-10, 6] }, { from: [60, -20], to: [-17, -5], delay: BEAT_SECONDS * 3 }]),
    ...braid({ at: 10.6, from: [30, -16], to: [2, 12] }),
    ...braid({ at: 11.1, from: [36, 18], to: [4, -16], spin: -2.3 }),
    ...darts({ at: 11.6, count: 5, from: [78, 30], via: [30, 0], to: [-30, -26], spacing: BEAT_SECONDS / 3 }),
    ...bombers(12.0, [
      { from: [60, 16], to: [-6, 14] },
      { from: [66, -4], to: [-11, 3], delay: BEAT_SECONDS * 1.5 },
      { from: [58, -22], to: [-18, -6], delay: BEAT_SECONDS * 3 },
    ]),
    lancer(12.3, 1, [16, -16]),
    ...darts({ at: 12.75, count: 6, from: [-10, -48], via: [22, -6], to: [60, 30], spacing: BEAT_SECONDS / 3 }),
    ...darts({ at: 13.1, count: 4, from: [74, 8], via: [30, 22], to: [8, 24], cross: 2.6 }),

    // THE EYE — near silence; slow ring-wings drift through the wreckage.
    ...braid({ at: 14.2, count: 3, from: [-30, 10], to: [26, -6], radius: 8, spin: 0.9, cross: 5.4, lead: 5.4 }),
    ...darts({ at: 15.1, count: 2, from: [60, -16], via: [20, -24], to: [-40, -10], cross: 3.6, spacing: BEAT_SECONDS }),

    // THE KEEL — turrets wake as the belly passes overhead; fighters work the lower half.
    ...darts({ at: 16.2, count: 5, from: [-72, -20], via: [-6, -30], to: [64, -14] }),
    ...braid({ at: 17.2, from: [-24, -18], to: [26, -12], radius: 6.5 }),
    ...darts({ at: 18.1, count: 5, from: [-70, -8], via: [-4, -28], to: [40, -24] }),
    lancer(18.6, -1, [-22, -12]),
    lancer(18.7, -1, [-6, -18]),
    ...darts({ at: 19.3, count: 4, from: [-66, -26], via: [-10, -16], to: [30, -30], cross: 2.6 }),

    // FLAGSHIP PASS — generators on the right; escorts on the left.
    ...darts({ at: 20.4, count: 4, from: [-70, 20], via: [-26, 2], to: [-8, -30], cross: 3.0 }),
    ...braid({ at: 21.3, from: [-30, 14], to: [-12, -16], radius: 6 }),
    ...darts({ at: 22.2, count: 4, from: [-70, -24], via: [-30, 4], to: [-6, 32], cross: 3.0 }),
    lancer(22.6, -1, [-24, 6], 1, 1.9),

    // SHIELDS DOWN — escorts pour in from outside the turn as the rail banks hard
    // around the stern; the flagship fills the inside of the turn (screen right).
    ...darts({ at: 24.0, count: 6, from: [-70, 34], via: [-6, 22], to: [30, 38], spacing: BEAT_SECONDS / 3, lead: 3.0 }),
    ...darts({ at: 24.25, count: 6, from: [-66, 12], via: [-24, 20], to: [-4, 42], spacing: BEAT_SECONDS / 3, lead: 3.0 }),
    ...braid({ at: 24.75, from: [-26, 16], to: [-4, 28], radius: 7 }),
    lancer(25.0, -1, [-16, 16], 1, 3.2, true),
    lancer(25.1, 1, [-4, 24], 1, 3.2, true),
    ...braid({ at: 25.25, from: [-8, 30], to: [-28, 8], radius: 6, spin: -2.4 }),

    // THE TRENCH — the walls stand 20 either side and the rim 18 overhead:
    // fighters dive in over the rim and weave the slot; lancers drop in behind.
    ...darts({ at: 26.4, count: 5, from: [-12, 40], via: [-10, 6], to: [12, -6], cross: 2.8 }),
    ...darts({ at: 27.25, count: 5, from: [12, 40], via: [8, 6], to: [-12, -6], cross: 2.8 }),
    lancer(27.9, 1, [9, 5], 1, 2.6, true),
    lancer(28.0, -1, [-9, 5], 1, 2.6, true),
    ...braid({ at: 28.5, from: [0, 14], to: [0, 0], radius: 8 }),
    ...darts({ at: 29.0, count: 4, from: [-14, 36], via: [0, 6], to: [14, 30], cross: 2.4, lead: 3.0 }),
  ];

  KEEL_TURRETS.forEach((turret, index) => {
    const time = wakeTime(turret.world, turret.passBar, TURRET_WAKE_DISTANCE);
    entries.push({
      time,
      kind: 'turret',
      hitPoints: 2,
      data: { role: 'turret', mount: index, firstShotBeat: Math.ceil((time + 0.4) / BEAT_SECONDS) + (index % 2) },
    });
  });
  GENERATOR_MOUNTS.forEach((generator, index) => {
    entries.push({
      time: wakeTime(generator.world, generator.passBar, GENERATOR_WAKE_DISTANCE),
      kind: 'generator',
      hitStages: [2, 2],
      data: { role: 'generator', mount: index },
    });
  });
  CORE_MOUNTS.forEach((core, index) => {
    entries.push({
      time: wakeTime(core.world, core.passBar, CORE_WAKE_DISTANCE),
      kind: 'core',
      hitStages: [2, 2],
      data: { role: 'core', mount: index },
    });
  });
  return sortTimeline(entries);
}

export const BROADSIDE_TIMELINE = buildTimeline();

// ---- motion helpers ----------------------------------------------------------------------

const frameScratch: ViewFrame = { position: new Vector3(), forward: new Vector3(), right: new Vector3(), up: new Vector3() };
const orientMatrix = new Matrix4();
const tmpA = new Vector3();
const tmpB = new Vector3();
const tmpUp = new Vector3();

function framePoint(frame: ViewFrame, x: number, y: number, z: number, target: Vector3) {
  return target.copy(frame.position).addScaledVector(frame.right, x).addScaledVector(frame.up, y).addScaledVector(frame.forward, z);
}

/** Point a craft (which faces local −z) along a direction, with a bank roll. */
function orient(mesh: { quaternion: { setFromRotationMatrix(m: Matrix4): unknown }; rotateZ(angle: number): unknown }, direction: Vector3, up: Vector3, roll = 0) {
  const f = tmpA.copy(direction);
  if (f.lengthSq() < 1e-8) return;
  f.normalize();
  const r = tmpB.crossVectors(f, up);
  if (r.lengthSq() < 1e-8) return;
  r.normalize();
  const u = tmpUp.crossVectors(r, f).normalize();
  orientMatrix.makeBasis(r, u, f.negate());
  mesh.quaternion.setFromRotationMatrix(orientMatrix);
  if (roll !== 0) mesh.rotateZ(roll);
}

function bezier(from: XY, via: XY, to: XY, s: number): [number, number] {
  const a = (1 - s) * (1 - s);
  const b = 2 * (1 - s) * s;
  const c = s * s;
  return [from[0] * a + via[0] * b + to[0] * c, from[1] * a + via[1] * b + to[1] * c];
}

/** The Bezier, continued along its end tangent past s = 1. */
function extrapolated(from: XY, via: XY, to: XY, s: number): [number, number] {
  if (s <= 1) return bezier(from, via, to, s);
  const tx = 2 * (to[0] - via[0]);
  const ty = 2 * (to[1] - via[1]);
  return [to[0] + tx * (s - 1), to[1] + ty * (s - 1)];
}

function smooth(t: number) {
  const x = MathUtils.clamp(t, 0, 1);
  return x * x * (3 - 2 * x);
}

// ---- gameplay -------------------------------------------------------------------------------

export function createBroadsideGameplay(bus: EventBus): LockOnRunnerLevel<BroadsideEnemyKind, BroadsideSpawnData> {
  const interceptions = new Set<number>();
  const generatorIds = new Set<number>();
  const coreIds = new Set<number>();
  const state = {
    hitsTaken: 0,
    generatorsDown: 0,
    coresDown: 0,
    bombersStopped: 0,
    bombersTotal: 0,
    fullBroadsides: 0,
    boltsDowned: 0,
    shieldPhase: 'up' as 'up' | 'failing' | 'down',
    flagshipDestroyed: false,
    summoned: false,
  };

  bus.on('runstart', () => {
    interceptions.clear();
    generatorIds.clear();
    coreIds.clear();
    state.hitsTaken = 0;
    state.generatorsDown = 0;
    state.coresDown = 0;
    state.bombersStopped = 0;
    state.bombersTotal = 0;
    state.fullBroadsides = 0;
    state.boltsDowned = 0;
    state.shieldPhase = 'up';
    state.flagshipDestroyed = false;
    state.summoned = false;
  });
  bus.on('playerhit', () => {
    state.hitsTaken += 1;
  });
  bus.on('fire', ({ enemyId }) => {
    interceptions.add(enemyId);
  });
  bus.on('miss', ({ enemyId }) => {
    interceptions.delete(enemyId);
  });
  bus.on('spawn', ({ enemyId, kind }) => {
    if (kind === 'generator') generatorIds.add(enemyId);
    if (kind === 'core') coreIds.add(enemyId);
    if (kind === 'bomber') state.bombersTotal += 1;
  });
  bus.on('kill', ({ enemyId }) => {
    interceptions.delete(enemyId);
    if (generatorIds.delete(enemyId)) {
      state.generatorsDown += 1;
      if (state.generatorsDown === GENERATOR_MOUNTS.length) state.shieldPhase = 'failing';
    }
    if (coreIds.delete(enemyId)) {
      state.coresDown += 1;
      if (state.coresDown === CORE_MOUNTS.length && !state.flagshipDestroyed) {
        state.flagshipDestroyed = true;
        bus.emit('bossphase', { phase: 'destroyed' });
      }
    }
  });
  bus.on('volley', ({ size, kills }) => {
    if (size === 6 && kills === 6) state.fullBroadsides += 1;
  });

  // ---- the director: boss beats that land on downbeats, driven from the camera hook ----
  function direct(runTime: number) {
    if (!state.summoned && runTime >= T(BARS.flagship - 0.5)) {
      state.summoned = true;
      bus.emit('bossphase', { phase: 'summoned' });
    }
    if (state.shieldPhase !== 'down' && runTime >= T(BARS.shieldsDown)) {
      state.shieldPhase = 'down';
      bus.emit('bossphase', { phase: 'exposed' });
    }
  }

  // ---- shooting ----
  function fireBolt(context: Update, from: Vector3, source: 'lancer' | 'turret' | 'flak') {
    const aim = hostileShotAimPoint(context.camera, from);
    const velocity = aim.sub(from).normalize().multiplyScalar(source === 'flak' ? 9 : 7);
    context.spawnEnemy({
      time: context.runTime,
      kind: 'bolt',
      countsTowardTotal: false,
      data: {
        role: 'bolt',
        position: from.clone(),
        velocity,
        lastAge: 0,
        impact: {},
        lastCamera: context.camera.position.clone(),
        source,
      },
    });
  }

  const beatIndex = (time: number) => Math.floor(time / BEAT_SECONDS + 1e-6);

  // ---- motion grammars ----

  function swarmFrame(context: Update, engagement: RailLead, worldRoll = false) {
    const sample = pacer.sample(context.enemy.entry.time, context.runTime, engagement);
    const bank = worldRoll ? 0 : bankAt(context.runTime);
    viewFrameAt(sample.anchorU, bank, frameScratch);
    return sample;
  }

  function updateDart(context: Update, data: Extract<BroadsideSpawnData, { role: 'dart' }>) {
    const { enemy, age } = context;
    const sample = swarmFrame(context, data.engagement);
    const s = MathUtils.clamp(age / data.cross, 0, 1.6);
    const eased = s <= 1 ? smooth(s) : 1 + (s - 1) * 1.5;
    const [x, y] = extrapolated(data.from, data.via, data.to, eased);
    const z = data.zSwing * (1 - Math.min(1, eased)) ** 2;
    framePoint(frameScratch, x, y, z, enemy.mesh.position);
    const nextS = s + 0.03;
    const [nx, ny] = extrapolated(data.from, data.via, data.to, nextS <= 1 ? smooth(nextS) : 1 + (nextS - 1) * 1.5);
    const nz = data.zSwing * (1 - Math.min(1, smooth(nextS))) ** 2;
    const ahead = framePoint(frameScratch, nx, ny, nz, new Vector3());
    const direction = ahead.sub(enemy.mesh.position);
    // Bank into the curve: roll against the path's lateral turn.
    const prevS = Math.max(0, s - 0.03);
    const [px, py] = extrapolated(data.from, data.via, data.to, prevS <= 1 ? smooth(prevS) : 1 + (prevS - 1) * 1.5);
    const turn = (nx - x) * (y - py) - (ny - y) * (x - px);
    orient(enemy.mesh, direction.lengthSq() > 1e-6 ? direction : frameScratch.forward.clone().negate(), frameScratch.up, MathUtils.clamp(turn * 0.05, -1.1, 1.1));
    // Past the far edge the dart keeps flying: shots already loosed can still run it down.
    return s >= 1.55 || context.runTime > sample.passTime + 1.2;
  }

  function updateRingwing(context: Update, data: Extract<BroadsideSpawnData, { role: 'ringwing' }>) {
    const { enemy, age } = context;
    const sample = swarmFrame(context, data.engagement, data.worldRoll);
    const s = MathUtils.clamp(age / data.cross, 0, 1.4);
    const eased = s <= 1 ? smooth(s) : 1 + (s - 1) * 1.5;
    const cx = MathUtils.lerp(data.from[0], data.to[0], eased);
    const cy = MathUtils.lerp(data.from[1], data.to[1], eased);
    const angle = data.phase + age * data.spin;
    const grow = Math.min(1, age / 0.7);
    const radius = data.radius * (0.35 + 0.65 * grow);
    const x = cx + Math.cos(angle) * radius;
    const y = cy + Math.sin(angle) * radius;
    const z = Math.sin(angle * 2 + data.phase) * 2.5;
    framePoint(frameScratch, x, y, z, enemy.mesh.position);
    // Face the camera's path with the ring banked into the orbit.
    orient(enemy.mesh, frameScratch.forward.clone().negate(), frameScratch.up, angle + Math.PI / 2);
    return s >= 1.35 || context.runTime > sample.passTime + 1;
  }

  function updateLancer(context: Update, data: Extract<BroadsideSpawnData, { role: 'lancer' }>) {
    const { enemy, age, runTime } = context;
    const camU = runProgress(runTime);
    const length = broadsideRail().getLength();
    const bank = bankAt(runTime);
    const fire = context.enemyState(() => ({ nextBeat: data.firstShotBeat, shots: 0, charge: 0 }));

    // Overtake: from behind and beside the camera into the slot.
    const arrive = smooth(age / 1.25);
    const breakAway = Math.max(0, age - data.hold - 1.25);
    let distance = MathUtils.lerp(-26, LANCER_SLOT_DISTANCE, 1 - (1 - arrive) ** 3);
    let x = MathUtils.lerp(data.fromAbove ? data.slot[0] : data.side * 30, data.slot[0], arrive) + Math.sin(age * 1.7 + data.side) * (data.fromAbove ? 1 : 2.2);
    let y = MathUtils.lerp(data.fromAbove ? 28 : -4, data.slot[1], arrive) + Math.sin(age * 2.3) * 1.4;
    if (breakAway > 0) {
      distance += breakAway * breakAway * 40;
      y += breakAway * (data.fromAbove ? 16 : 9);
      if (!data.fromAbove) x += data.side * breakAway * 14;
    }
    viewFrameAt(camU + distance / length, bank, frameScratch);
    framePoint(frameScratch, x, y, 0, enemy.mesh.position);

    // Fire on the beat, telegraphed by the eye charging for a beat first.
    const beat = beatIndex(runTime);
    fire.charge = fire.shots < data.shots && breakAway === 0 ? MathUtils.clamp(1 - (fire.nextBeat * BEAT_SECONDS - runTime) / (BEAT_SECONDS * 2), 0, 1) : 0;
    enemy.mesh.userData.charge = fire.charge;
    if (breakAway === 0 && fire.shots < data.shots && beat >= fire.nextBeat && arrive >= 0.95) {
      fireBolt(context, enemy.mesh.position, 'lancer');
      fire.shots += 1;
      fire.nextBeat = beat + 4;
    }
    const direction = breakAway > 0 ? frameScratch.forward.clone().addScaledVector(frameScratch.up, 0.3) : frameScratch.forward.clone().negate();
    orient(enemy.mesh, direction, frameScratch.up, Math.sin(age * 1.7) * 0.25 - data.side * (1 - arrive) * 0.9);
    return distance > 70;
  }

  function updateBomber(context: Update, data: Extract<BroadsideSpawnData, { role: 'bomber' }>) {
    const { enemy, age } = context;
    swarmFrame(context, data.engagement);
    const s = MathUtils.clamp(age / data.cross, 0, 1);
    const x = MathUtils.lerp(data.from[0], data.to[0], s);
    const y = MathUtils.lerp(data.from[1], data.to[1], s) + Math.sin(s * Math.PI) * 5 + Math.sin(age * 1.4) * 0.8;
    framePoint(frameScratch, x, y, 8 * (1 - s), enemy.mesh.position);
    const heading = framePoint(frameScratch, data.to[0], data.to[1], 0, new Vector3()).sub(enemy.mesh.position);
    orient(enemy.mesh, heading, frameScratch.up, Math.sin(age * 1.1) * 0.12);
    // Reaching the cruiser's hull is a torpedo strike: the bomber is lost to us.
    return s >= 1;
  }

  function updateTurret(context: Update, data: Extract<BroadsideSpawnData, { role: 'turret' }>) {
    const { enemy, runTime, camera } = context;
    const mount = KEEL_TURRETS[data.mount];
    enemy.mesh.position.copy(mount.world);
    const toCamera = tmpA.copy(camera.position).sub(mount.world);
    const head = enemy.mesh.userData.head as { lookAt?: (v: Vector3) => void } | undefined;
    enemy.mesh.userData.aim = camera.position;
    void head;
    const forward = new Vector3();
    camera.getWorldDirection(forward);
    const along = mount.world.clone().sub(camera.position).dot(forward);
    const fire = context.enemyState(() => ({ nextBeat: data.firstShotBeat, shots: 0 }));
    const beat = beatIndex(runTime);
    enemy.mesh.userData.charge = fire.shots < 1 ? MathUtils.clamp(1 - (fire.nextBeat * BEAT_SECONDS - runTime) / (BEAT_SECONDS * 2), 0, 1) : 0;
    if (data.mount % 2 === 0 && mount.passBar < 19.1 && fire.shots < 1 && beat >= fire.nextBeat && along > 28 && toCamera.lengthSq() > 25 * 25) {
      fireBolt(context, mount.world.clone().add(new Vector3(0, -2.5, 0)), 'turret');
      fire.shots += 1;
    }
    return along < -4;
  }

  function updateGenerator(context: Update, data: Extract<BroadsideSpawnData, { role: 'generator' }>) {
    const { enemy, runTime, camera } = context;
    const mount = GENERATOR_MOUNTS[data.mount];
    enemy.mesh.position.copy(mount.world);
    const forward = new Vector3();
    camera.getWorldDirection(forward);
    const along = mount.world.clone().sub(camera.position).dot(forward);
    // Point defense: while a generator lives, the flank batteries near it fill the air on the beat.
    const pd = context.enemyState(() => ({ nextBeat: beatIndex(runTime) + 2 }));
    const beat = beatIndex(runTime);
    if (beat >= pd.nextBeat && along > 40 && runTime > T(BARS.flagship + 0.4)) {
      pd.nextBeat = beat + 4;
      let best: Vector3 | null = null;
      let bestScore = Infinity;
      for (const point of POINT_DEFENSE_MOUNTS) {
        const pointAlong = point.clone().sub(camera.position).dot(forward);
        if (pointAlong < 35 || pointAlong > 150) continue;
        const score = Math.abs(pointAlong - 80) + Math.random() * 20;
        if (score < bestScore) {
          bestScore = score;
          best = point;
        }
      }
      // Launch clear of the blister, out over the flank.
      if (best) fireBolt(context, best.clone().addScaledVector(camera.position.clone().sub(best).setY(0).normalize(), 12), 'flak');
    }
    return along < -6;
  }

  function updateCore(context: Update, data: Extract<BroadsideSpawnData, { role: 'core' }>) {
    const { enemy, camera } = context;
    const mount = CORE_MOUNTS[data.mount];
    enemy.mesh.position.copy(mount.world);
    const forward = new Vector3();
    camera.getWorldDirection(forward);
    const along = mount.world.clone().sub(camera.position).dot(forward);
    return along < -5;
  }

  function updateBolt(context: Update, data: Extract<BroadsideSpawnData, { role: 'bolt' }>) {
    const { enemy, age, camera, damagePlayer } = context;
    const dt = Math.max(0, age - data.lastAge);
    data.lastAge = age;
    // Bolts are fired by craft pacing us: they inherit the camera's motion.
    data.position.add(tmpB.copy(camera.position).sub(data.lastCamera));
    data.lastCamera.copy(camera.position);

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
    steerHomingShot(data.position, data.velocity, hostileShotAimPoint(camera, data.position), age, dt, {
      baseSpeed: data.source === 'flak' ? 9 : 7,
      maxSpeed: 17,
      accel: 3.2,
      turnRate: 2.6,
    });
    enemy.mesh.position.copy(data.position);
    orient(enemy.mesh, data.velocity, new Vector3(0, 1, 0));
    return age > BOLT_MAX_AGE || shotBehindCamera(camera, data.position);
  }

  return {
    duration: BROADSIDE_DURATION,
    bpm: BROADSIDE_BPM,
    playerHealth: BROADSIDE_PLAYER_HEALTH,
    createRail: broadsideRail,
    spawnTimeline: BROADSIDE_TIMELINE,
    easeRunProgress: (time, duration) => runProgress(time, duration),
    startWord: 'SORTIE',
    replayWord: 'REARM',
    lockRadiusNdc: 0.095,
    timing: {
      // A volley goes out as a rippling broadside: one shot per sixteenth.
      shotDelay: { pattern: 'linear', gapThirtyseconds: 2, releaseShare: 0.6, maxGridSeconds: 0.9 },
      actionSfx: { gridThirtyseconds: 2 },
    },
    updateAttractCamera({ camera, modeTime }) {
      applyAttractCamera(camera, modeTime);
    },
    updateCameraEffects({ camera, runTime }) {
      direct(runTime);
      applyFlownCamera(camera, runTime);
    },
    updateEnemy(context) {
      const data = context.enemy.entry.data;
      switch (data.role) {
        case 'dart':
          return updateDart(context, data);
        case 'ringwing':
          return updateRingwing(context, data);
        case 'lancer':
          return updateLancer(context, data);
        case 'bomber':
          return updateBomber(context, data);
        case 'turret':
          return updateTurret(context, data);
        case 'generator':
          return updateGenerator(context, data);
        case 'core':
          return updateCore(context, data);
        case 'bolt':
          return updateBolt(context, data);
      }
    },
    scoreForKill(volleySize, enemy) {
      if (enemy.kind === 'bomber') state.bombersStopped += 1;
      if (enemy.kind === 'bolt') state.boltsDowned += 1;
      return Math.round(KILL_SCORE[enemy.kind] * (1 + Math.max(0, volleySize - 1) * 0.15));
    },
    scoreForHit: (_volleySize, enemy) => (enemy.kind === 'core' || enemy.kind === 'generator' ? 80 : 40),
    scoreForVolley(results) {
      if (results.length < 4 || !results.every((result) => result.killed)) return 0;
      return results.length === 6 ? 600 : results.length * 50;
    },
    rankForRun(score, kills, totalEnemies) {
      const clear = totalEnemies === 0 ? 0 : kills / totalEnemies;
      if (state.flagshipDestroyed && score >= 30000 && clear >= 0.82) return 'S';
      if (state.flagshipDestroyed && score >= 21000 && clear >= 0.64) return 'A';
      if (score >= 13000 && clear >= 0.45) return 'B';
      if (score >= 6000 && clear >= 0.25) return 'C';
      return 'D';
    },
    detailsForRun() {
      const lines = [
        state.flagshipDestroyed ? 'Enemy flagship destroyed' : 'Enemy flagship escaped',
        `Shield generators ${state.generatorsDown}/${GENERATOR_MOUNTS.length} · Cores ${state.coresDown}/${CORE_MOUNTS.length}`,
        `Hull ${Math.max(0, BROADSIDE_PLAYER_HEALTH - state.hitsTaken)}/${BROADSIDE_PLAYER_HEALTH}`,
      ];
      if (state.bombersTotal > 0) lines.push(`Torpedo bombers stopped ${state.bombersStopped}/${state.bombersTotal}`);
      if (state.fullBroadsides > 0) lines.push(`${state.fullBroadsides} full broadside${state.fullBroadsides === 1 ? '' : 's'}`);
      return lines;
    },
  };
}
