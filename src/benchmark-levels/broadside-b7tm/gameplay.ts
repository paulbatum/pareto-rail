import { CatmullRomCurve3, MathUtils, Vector3 } from 'three';
import {
  shotBehindCamera,
  steerHomingShot,
  updateHostileShotImpact,
  type HostileShotImpactState,
} from '../../engine/hostile-shot';
import type { LockOnEnemy, LockOnEnemyUpdate, LockOnRunnerLevel, LockOnSpawnEntry } from '../../engine/lock-on-runner';
import { offsetFromRail } from '../../engine/rail';
import { createSpeedProfile } from '../../engine/speed-profile';
import { sortTimeline } from '../../engine/spawn-patterns';
import type { EventBus } from '../../events';
import { FLAGSHIP_SPAWN_ENTRIES, createFlagship } from './flagship';
import { BROADSIDE_BPM, BROADSIDE_DURATION, BROADSIDE_TIME, bar } from './timing';

// BROADSIDE — sixty seconds across a fleet engagement, from your own flagship's
// launch deck to the enemy flagship's core:
//
//   Launch     (bars 0–4)    Up the catapult trench and off the bow.
//   Crossfire  (bars 4–11)   The gap between the battle lines. Hard banks, and
//                            a full corkscrew on the way out of it.
//   Flank      (bars 12–18)  A high-speed run down a friendly cruiser's side
//                            while its broadside lights off overhead.
//   Belly      (bars 18–23)  Under an enemy warship, raking its turret line.
//   Shields    (bars 23–28)  Close pass along the enemy flagship: six shield
//                            generators, point defence everywhere.
//   Breach     (bars 28–30)  The shield falls; escorts pour out of the hangars.
//   Trench     (bars 30–34)  Into the trenchwork after the exposed power cores.
//   Victory    (bars 34–36)  Out through the ruptured spine, battle in frame.
//
// The rail is generated FROM the score: control point i is authored at run time
// t_i and placed at the run-progress distance the speed profile puts the camera
// at that moment. Set pieces are therefore addressed in bars, and a change to
// the speed curve physically re-spaces the battle instead of desynchronising it.

export {
  BARS,
  BELLY_TIME,
  BREACH_TIME,
  BROADSIDE_BPM,
  BROADSIDE_DURATION,
  CROSSFIRE_TIME,
  FLANK_TIME,
  SHIELDS_TIME,
  TRENCH_TIME,
  VICTORY_TIME,
  bar,
} from './timing';

export const BROADSIDE_PLAYER_HEALTH = 4;

/** Straight-line depth of the whole engagement, in world units. */
export const BATTLE_LENGTH = 1140;

// ---- flight path ------------------------------------------------------------

// Lateral (right, up) offsets of the flight path, keyed in bars. This is the
// choreography of the flying itself: the launch trench, the weave through the
// crossfire, the dead-straight flank run, the drop under the enemy warship's
// belly, the climb onto the flagship, and the pull-out.
const LATERAL_KEYS: Array<readonly [number, number, number]> = [
  [0, 0, -9],
  [1.6, 0, -7],
  [3.0, 3, 0],
  [4.0, 10, 5],
  [5.6, 34, 12],
  [7.0, 28, -7],
  [8.6, -2, -17],
  [10.0, -34, -7],
  [11.0, -28, 7],
  [12.0, -17, 4],
  [16.6, -17, 4],
  [17.6, -15, 2],
  [19.0, 3, -7],
  [20.6, 20, -16],
  [22.0, 26, -18],
  [23.2, 27, -11],
  [25.0, 29, -4],
  [27.2, 28, 1],
  [28.6, 22, 9],
  [29.6, 4, 13],
  [30.6, -7, 4],
  [32.0, -5, -7],
  [33.0, 3, -9],
  [34.0, 7, -5],
  [35.0, 3, 26],
  [36.0, -9, 84],
];

// Authored camera roll, in degrees, keyed in bars. Values accumulate rather
// than wrap: the -360 at bar 12 is a real full corkscrew, flown in the one
// deliberately empty window of the run, and every later key is written relative
// to it.
const ROLL_KEYS: Array<readonly [number, number]> = [
  [0, 0],
  [3.6, 0],
  [4.6, -26],
  [5.8, -32],
  [6.8, 24],
  [7.8, 32],
  [8.8, -36],
  [10.0, 22],
  [10.9, 0],
  [12.0, -360],
  [13.0, -358],
  [17.6, -352],
  [19.2, -334],
  [22.6, -342],
  [23.6, -376],
  [27.6, -380],
  [28.8, -412],
  [29.9, -334],
  [30.8, -372],
  [32.0, -352],
  [33.2, -368],
  [34.2, -350],
  [35.2, -366],
  [36.0, -360],
];

// Slow off the deck, surge into the gap, run flat out down the friendly flank,
// ease back to rake the belly, hold steady for the flagship pass, then dive the
// trench and leave at full throttle.
const SPEED_KEYS: Array<[number, number]> = [
  [bar(0), 0.5],
  [bar(2), 0.72],
  [bar(3.4), 1.05],
  [bar(4), 1.2],
  [bar(8), 1.2],
  [bar(11), 1.3],
  [bar(12), 1.65],
  [bar(17), 1.65],
  [bar(18), 1.28],
  [bar(22.5), 1.1],
  [bar(23), 0.98],
  [bar(27.6), 0.98],
  [bar(28.2), 1.4],
  [bar(30), 1.55],
  [bar(33.8), 1.5],
  [bar(34.4), 2.3],
  [bar(36), 1.7],
];

const speedProfile = createSpeedProfile(SPEED_KEYS, BROADSIDE_DURATION);
export const speedFactorAt = speedProfile.speedAt;

export function broadsideRunProgress(time: number, duration = BROADSIDE_DURATION) {
  return speedProfile.runProgress(time, duration);
}

/** Rail parameter the camera occupies at run time `t` — how every set piece is placed. */
export const railU = (time: number) => broadsideRunProgress(MathUtils.clamp(time, 0, BROADSIDE_DURATION));

/** Rail parameter for an authored bar, for environment placement. */
export const railUAtBar = (barIndex: number) => railU(bar(barIndex));

function sampleLateral(at: number, out: [number, number]) {
  if (at <= LATERAL_KEYS[0][0]) {
    out[0] = LATERAL_KEYS[0][1];
    out[1] = LATERAL_KEYS[0][2];
    return out;
  }
  for (let i = 1; i < LATERAL_KEYS.length; i += 1) {
    if (at > LATERAL_KEYS[i][0]) continue;
    const [t0, a0, b0] = LATERAL_KEYS[i - 1];
    const [t1, a1, b1] = LATERAL_KEYS[i];
    const k = MathUtils.clamp((at - t0) / Math.max(1e-4, t1 - t0), 0, 1);
    const eased = k * k * (3 - 2 * k);
    out[0] = MathUtils.lerp(a0, a1, eased);
    out[1] = MathUtils.lerp(b0, b1, eased);
    return out;
  }
  const last = LATERAL_KEYS[LATERAL_KEYS.length - 1];
  out[0] = last[1];
  out[1] = last[2];
  return out;
}

const lateralScratch: [number, number] = [0, 0];

export function rollRadiansAt(runTime: number) {
  const at = runTime / BROADSIDE_TIME.barSeconds;
  if (at <= ROLL_KEYS[0][0]) return 0;
  for (let i = 1; i < ROLL_KEYS.length; i += 1) {
    if (at > ROLL_KEYS[i][0]) continue;
    const [t0, d0] = ROLL_KEYS[i - 1];
    const [t1, d1] = ROLL_KEYS[i];
    const k = MathUtils.clamp((at - t0) / Math.max(1e-4, t1 - t0), 0, 1);
    const eased = k * k * (3 - 2 * k);
    return MathUtils.degToRad(MathUtils.lerp(d0, d1, eased));
  }
  return MathUtils.degToRad(ROLL_KEYS[ROLL_KEYS.length - 1][1]);
}

export function createBroadsideRail() {
  const points: Vector3[] = [];
  const samples = 84;
  for (let i = 0; i <= samples; i += 1) {
    const time = (BROADSIDE_DURATION * i) / samples;
    const u = broadsideRunProgress(time);
    sampleLateral(time / BROADSIDE_TIME.barSeconds, lateralScratch);
    points.push(new Vector3(lateralScratch[0], lateralScratch[1], -BATTLE_LENGTH * u));
  }
  return new CatmullRomCurve3(points, false, 'centripetal');
}

// ---- spawn data -------------------------------------------------------------

export type BroadsideEnemyKind =
  | 'lance'
  | 'wasp'
  | 'picket'
  | 'turret'
  | 'bolt'
  | 'generator'
  | 'core';

// Timeline data is immutable — the engine reuses the timeline across runs, so
// per-enemy mutable state lives in `enemyState` bags and boss state lives in
// the flagship module. Dynamically spawned flak gets a fresh data object.
export type BroadsideSpawnData =
  | { role: 'lance'; lead: number; fromX: number; fromY: number; toX: number; toY: number; arc: number; delay: number; crossTime: number }
  | { role: 'wasp'; lead: number; centerX: number; centerY: number; radius: number; phase: number; spin: number; delay: number }
  | { role: 'picket'; lead: number; x: number; y: number; seed: number }
  | { role: 'turret'; lead: number; x: number; y: number; seed: number }
  | { role: 'bolt'; position: Vector3; velocity: Vector3; lastAge: number; impact: HostileShotImpactState }
  | { role: 'generator'; index: number; lead: number; x: number; y: number }
  | { role: 'core'; index: number; lead: number; x: number; y: number };

export type BroadsideSpawnEntry = LockOnSpawnEntry<BroadsideEnemyKind, BroadsideSpawnData>;
export type BroadsideUpdate = LockOnEnemyUpdate<BroadsideEnemyKind, BroadsideSpawnData>;
export type BroadsidePublicEnemy = LockOnEnemy<BroadsideEnemyKind, BroadsideSpawnData>;
/** Rail-relative seating shared with the flagship module. */
export type BroadsideSeat = (context: BroadsideUpdate, anchorU: number, x: number, y: number, z?: number) => Vector3;

// How far behind the camera a passed target lingers before it counts as a
// miss. At this battle length 0.0035 is about six units: enough that a shot
// already in flight still lands in frame, short enough that nothing dies
// behind the cockpit.
const PASS_MARGIN = 0.0035;

// ---- wave grammar -----------------------------------------------------------

type LanceRun = {
  fromX: number;
  toX: number;
  y: number;
  toY?: number;
  arc?: number;
  delay?: number;
  crossTime?: number;
};

/** Swarm craft: straight full-width slashes with an arc of loft. */
const lances = (time: number, lead: number, crossTime: number, runs: LanceRun[]): BroadsideSpawnEntry[] =>
  runs.map((run, index) => ({
    time: time + index * 0.05,
    kind: 'lance',
    data: {
      role: 'lance',
      lead,
      fromX: run.fromX,
      fromY: run.y,
      toX: run.toX,
      toY: run.toY ?? run.y,
      arc: run.arc ?? 0,
      delay: run.delay ?? index * 0.16,
      crossTime: run.crossTime ?? crossTime,
    },
  }));

/** Escort craft: a helix that sweeps a wide circle across the frame. */
const wasps = (
  time: number,
  lead: number,
  spec: Array<{ x?: number; y?: number; radius: number; phase: number; spin?: number }>,
): BroadsideSpawnEntry[] =>
  spec.map((wasp, index) => ({
    time: time + index * 0.09,
    kind: 'wasp',
    data: {
      role: 'wasp',
      lead,
      centerX: wasp.x ?? 0,
      centerY: wasp.y ?? 2,
      radius: wasp.radius,
      phase: wasp.phase,
      spin: wasp.spin ?? 1.9,
      delay: index * 0.12,
    },
  }));

/** Gunboats: station-keeping, sliding, and shooting. Two hits each. */
const pickets = (time: number, lead: number, posts: Array<[number, number]>): BroadsideSpawnEntry[] =>
  posts.map(([x, y], index) => ({
    time: time + index * 0.22,
    kind: 'picket',
    hitPoints: 2,
    data: { role: 'picket', lead, x, y, seed: time * 3.1 + index * 2.7 },
  }));

/** Hull batteries on the enemy warship's belly: rooted, tracking, two hits each. */
const turrets = (time: number, lead: number, posts: Array<[number, number]>): BroadsideSpawnEntry[] =>
  posts.map(([x, y], index) => ({
    time: time + index * 0.13,
    kind: 'turret',
    hitPoints: 2,
    data: { role: 'turret', lead, x, y, seed: time * 1.7 + index * 4.3 },
  }));

function buildTimeline(flagshipEntries: BroadsideSpawnEntry[]): BroadsideSpawnEntry[] {
  return sortTimeline([
    // --- Launch: wide, slow, legible. Learn the sweep while the deck falls away.
    ...lances(bar(1), 3.6, 4.05, [
      { fromX: -24, toX: 24, y: 4, arc: 2 },
      { fromX: -24, toX: 24, y: -3, arc: 3 },
      { fromX: -24, toX: 24, y: 11, arc: 1 },
    ]),
    ...lances(bar(2.25), 3.5, 3.92, [
      { fromX: 24, toX: -24, y: 8, arc: 2 },
      { fromX: 24, toX: -24, y: 1, arc: 3 },
      { fromX: 24, toX: -24, y: -6, arc: 2 },
    ]),
    ...wasps(bar(3.25), 3.4, [
      { x: -12, y: 3, radius: 13, phase: 0.4 },
      { x: 13, y: 4, radius: 12, phase: 3.0 },
    ]),

    // --- Crossfire: the fleets are shooting through you. Dense, alternating,
    //     and the whole screen is in play.
    ...lances(bar(4), 3.2, 3.24, [
      { fromX: -26, toX: 26, y: -1, toY: 6, arc: 2 },
      { fromX: 26, toX: -26, y: 9, toY: 1, arc: 2 },
      { fromX: -26, toX: 26, y: 13, arc: 1 },
      { fromX: 26, toX: -26, y: -9, arc: 3 },
    ]),
    ...wasps(bar(5), 3.2, [
      { x: -15, y: 1, radius: 15, phase: 1.1 },
      { x: 16, y: 6, radius: 13, phase: 4.2 },
    ]),
    ...pickets(bar(5.5), 3.7, [[-22, 9]]),
    ...lances(bar(6), 3.2, 3.1, [
      { fromX: 26, toX: -26, y: 0, arc: 3 },
      { fromX: 26, toX: -26, y: 6, arc: 2 },
      { fromX: -26, toX: 26, y: 12, arc: 1 },
    ]),
    ...wasps(bar(7), 3.1, [
      { x: -18, y: 4, radius: 14, phase: 0.2, spin: 2.2 },
      { x: 18, y: -1, radius: 14, phase: 3.4, spin: 2.2 },
    ]),
    ...pickets(bar(7.5), 3.6, [[24, -4]]),
    ...lances(bar(8), 3.1, 2.97, [
      { fromX: -27, toX: 27, y: -10, arc: 4, delay: 0 },
      { fromX: -27, toX: 27, y: -3, arc: 3, delay: 0.14 },
      { fromX: -27, toX: 27, y: 4, arc: 2, delay: 0.28 },
      { fromX: -27, toX: 27, y: 12, arc: 1, delay: 0.42 },
      { fromX: 27, toX: -27, y: 15, arc: 1, delay: 0.56 },
      { fromX: 27, toX: -27, y: 8, arc: 2, delay: 0.7 },
    ]),
    ...wasps(bar(9), 3.1, [
      { x: -14, y: 7, radius: 16, phase: 2.0, spin: 2.4 },
      { x: 14, y: 0, radius: 16, phase: 5.0, spin: 2.4 },
    ]),
    ...pickets(bar(9.5), 3.5, [[-26, 1]]),
    ...lances(bar(10), 3.0, 2.97, [
      { fromX: 26, toX: -26, y: -7, arc: 3 },
      { fromX: -26, toX: 26, y: 2, arc: 2 },
      { fromX: 26, toX: -26, y: 11, arc: 1 },
    ]),

    // (bars 10.6–12: nothing. The corkscrew needs a clean frame.)

    // --- Flank run: the fastest stretch. Everything crosses hard and low.
    ...lances(bar(12), 2.8, 2.56, [
      { fromX: -26, toX: 26, y: 1, arc: 2 },
      { fromX: 26, toX: -26, y: 9, arc: 1 },
      { fromX: -26, toX: 26, y: -6, arc: 3 },
    ]),
    ...wasps(bar(12.75), 2.8, [
      { x: -16, y: 3, radius: 15, phase: 1.6, spin: 2.6 },
      { x: 16, y: 7, radius: 13, phase: 4.4, spin: 2.6 },
    ]),
    ...lances(bar(13.5), 2.8, 2.56, [
      { fromX: 27, toX: -27, y: 12, arc: 1, delay: 0 },
      { fromX: 27, toX: -27, y: 5, arc: 2, delay: 0.13 },
      { fromX: 27, toX: -27, y: -2, arc: 3, delay: 0.26 },
    ]),
    ...pickets(bar(14.5), 3.3, [[-25, 11], [25, -6]]),
    ...lances(bar(15), 2.8, 2.43, [
      { fromX: -27, toX: 27, y: -9, toY: 13, arc: 1, delay: 0 },
      { fromX: 27, toX: -27, y: 13, toY: -9, arc: 1, delay: 0.12 },
      { fromX: -27, toX: 27, y: 6, arc: 2, delay: 0.24 },
      { fromX: 27, toX: -27, y: -1, arc: 2, delay: 0.36 },
      { fromX: -24, toX: 24, y: 16, arc: 1, delay: 0.48 },
      { fromX: 24, toX: -24, y: -12, arc: 2, delay: 0.6 },
    ]),
    ...wasps(bar(16), 2.8, [
      { x: -17, y: 6, radius: 16, phase: 0.6, spin: 2.7 },
      { x: 17, y: -1, radius: 16, phase: 3.6, spin: 2.7 },
    ]),
    ...lances(bar(16.75), 2.7, 2.43, [
      { fromX: 26, toX: -26, y: 3, arc: 2 },
      { fromX: -26, toX: 26, y: -6, arc: 3 },
      { fromX: 26, toX: -26, y: 10, arc: 1 },
    ]),

    // --- Belly: the warship's hull fills the top of the frame and its turret
    //     line comes at you in rows. Rooted targets, so the sweep is spatial.
    ...turrets(bar(18.25), 3.4, [[-20, 12], [7, 15]]),
    ...lances(bar(18.75), 3.0, 2.84, [
      { fromX: -24, toX: 24, y: -9, arc: 2 },
      { fromX: 24, toX: -24, y: -2, arc: 2 },
    ]),
    ...turrets(bar(19.25), 3.4, [[21, 11], [-6, 16]]),
    ...lances(bar(19.9), 3.0, 2.84, [
      { fromX: 25, toX: -25, y: 3, arc: 2 },
      { fromX: -25, toX: 25, y: -10, arc: 3 },
      { fromX: 25, toX: -25, y: -4, arc: 2 },
    ]),
    ...turrets(bar(20.5), 3.4, [[-24, 9], [0, 14], [24, 9]]),
    ...wasps(bar(21.2), 3.1, [
      { x: -14, y: -3, radius: 14, phase: 1.2, spin: 2.3 },
      { x: 15, y: -4, radius: 14, phase: 4.0, spin: 2.3 },
    ]),
    ...turrets(bar(21.6), 3.3, [[-15, 14], [26, 16]]),
    ...lances(bar(22.3), 2.9, 2.7, [
      { fromX: -24, toX: 24, y: -9, arc: 3 },
      { fromX: 24, toX: -24, y: -4, arc: 2 },
    ]),

    // --- The flagship: generators, point defence, and gunboats riding shotgun.
    ...flagshipEntries,
    ...pickets(bar(23.9), 3.7, [[-24, 6]]),
    ...lances(bar(24.5), 3.3, 3.24, [
      { fromX: -24, toX: 24, y: -9, arc: 2 },
      { fromX: 24, toX: -24, y: 13, arc: 1 },
    ]),
    ...pickets(bar(25.5), 3.7, [[-27, -6]]),
    ...wasps(bar(26.1), 3.4, [
      { x: -16, y: 4, radius: 14, phase: 2.6, spin: 2.1 },
      { x: -6, y: -6, radius: 13, phase: 5.2, spin: 2.1 },
    ]),
    ...lances(bar(27.0), 3.3, 3.1, [
      { fromX: -24, toX: 24, y: 3, arc: 2 },
      { fromX: 24, toX: -24, y: -7, arc: 2 },
    ]),

    // --- Breach: the hangars empty. Two bars of pure swarm.
    ...lances(bar(28), 3.0, 2.7, [
      { fromX: -26, toX: 26, y: -10, arc: 3, delay: 0 },
      { fromX: 26, toX: -26, y: -3, arc: 2, delay: 0.12 },
      { fromX: -26, toX: 26, y: 4, arc: 2, delay: 0.24 },
      { fromX: 26, toX: -26, y: 12, arc: 1, delay: 0.36 },
      { fromX: -25, toX: 25, y: 16, arc: 1, delay: 0.48 },
      { fromX: 25, toX: -25, y: -14, arc: 2, delay: 0.6 },
    ]),
    // Kept inside the trench mouth: a wider helix here swings behind the
    // canyon wall the rail is already dropping into.
    ...wasps(bar(28.75), 3.0, [
      { x: -14, y: 3, radius: 12, phase: 0.9, spin: 2.8 },
      { x: 14, y: 6, radius: 12, phase: 3.9, spin: 2.8 },
    ]),
    ...lances(bar(29.3), 2.9, 2.56, [
      { fromX: 26, toX: -26, y: 9, arc: 1, delay: 0 },
      { fromX: -26, toX: 26, y: 0, arc: 2, delay: 0.12 },
      { fromX: 26, toX: -26, y: -9, arc: 3, delay: 0.24 },
    ]),

    // --- Trench: the cores are the run. Everything else is in your way.
    ...lances(bar(30.2), 2.8, 2.56, [
      { fromX: -21, toX: 21, y: 7, arc: 1 },
      { fromX: 21, toX: -21, y: -6, arc: 2 },
    ]),
    ...wasps(bar(31.4), 2.8, [
      { x: -13, y: 1, radius: 12, phase: 1.8, spin: 2.6 },
      { x: 13, y: 4, radius: 12, phase: 4.6, spin: 2.6 },
    ]),
    ...lances(bar(32.4), 2.7, 2.43, [
      { fromX: 20, toX: -20, y: 9, arc: 1 },
      { fromX: -20, toX: 20, y: -4, arc: 2 },
    ]),
    ...lances(bar(33.2), 2.7, 2.29, [
      { fromX: -19, toX: 19, y: 3, arc: 2 },
      { fromX: 19, toX: -19, y: 10, arc: 1 },
    ]),
  ]);
}

/** The whole authored run, sorted. Immutable: the engine reuses it across runs. */
export const BROADSIDE_SPAWN_TIMELINE = buildTimeline(FLAGSHIP_SPAWN_ENTRIES);

const KILL_SCORE: Record<BroadsideEnemyKind, number> = {
  lance: 110,
  wasp: 145,
  picket: 280,
  turret: 320,
  bolt: 45,
  generator: 560,
  core: 1100,
};

const BOLT_MAX_AGE = 11;

// ---- level ------------------------------------------------------------------

export function createBroadsideGameplay(bus: EventBus): LockOnRunnerLevel<BroadsideEnemyKind, BroadsideSpawnData> {
  const interceptions = new Set<number>();
  let hitsTaken = 0;
  let flakShot = 0;
  let turretsRaked = 0;

  bus.on('runstart', () => {
    interceptions.clear();
    hitsTaken = 0;
    flakShot = 0;
    turretsRaked = 0;
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

  // The engine's shared aim point leads the cockpit by 62% of the round's own
  // depth. That is right for a slow rail; at this speed the camera outruns the
  // lead point and no round ever converges, so BROADSIDE aims flak nearly at
  // the canopy and keeps the shared steering and impact model around it.
  const aimScratch = new Vector3();
  const aimForward = new Vector3();
  function flakAim(context: BroadsideUpdate, from: Vector3, out = aimScratch) {
    const camera = context.camera;
    camera.getWorldDirection(aimForward);
    const depth = out.copy(from).sub(camera.position).dot(aimForward);
    // A small proportional lead: enough that rounds visibly converge on the
    // canopy and enough that a round fired from the far edge of the frame
    // arrives wide. Rounds that would otherwise all be lethal become a threat
    // you weigh, not a tax you pay.
    return out.copy(aimForward).multiplyScalar(1.8 + Math.max(0, depth) * 0.05).add(camera.position);
  }

  function fireFlak(context: BroadsideUpdate, from: Vector3, speed = 5.4) {
    const initial = flakAim(context, from, new Vector3()).sub(from).normalize().multiplyScalar(speed);
    context.spawnEnemy({
      time: context.runTime,
      kind: 'bolt',
      countsTowardTotal: false,
      data: { role: 'bolt', position: from.clone(), velocity: initial, lastAge: 0, impact: {} },
    });
  }

  const flagship = createFlagship(bus);

  // ---- motion ---------------------------------------------------------------

  const offsetScratch = new Vector3();
  const attractHere = new Vector3();
  const attractAhead = new Vector3();

  const seat: BroadsideSeat = (context, anchorU, x, y, z = 0) =>
    offsetFromRail(context.curve, anchorU, offsetScratch.set(x, y, z));

  // Swarm craft: a straight slash across the whole frame with a loft arc and a
  // hard bank into the crossing. They never stop; being passed is the exit.
  function updateLance(context: BroadsideUpdate, data: Extract<BroadsideSpawnData, { role: 'lance' }>) {
    const { enemy, runProgress, age, railAnchor } = context;
    const anchorU = railAnchor(data.lead);
    const t = (age - data.delay) / data.crossTime;
    if (t > 1.2 || runProgress > anchorU + PASS_MARGIN) return true;
    const k = MathUtils.clamp(t, 0, 1);
    const eased = k * k * (3 - 2 * k);
    const x = MathUtils.lerp(data.fromX, data.toX, eased);
    const y = MathUtils.lerp(data.fromY, data.toY, eased) + Math.sin(k * Math.PI) * data.arc;
    // Weave in depth as well as across, so a formation reads as a swarm.
    enemy.mesh.position.copy(seat(context, anchorU, x, y, Math.sin(k * Math.PI) * 7));

    const nextK = Math.min(1, k + 0.05);
    const nextEased = nextK * nextK * (3 - 2 * nextK);
    const ahead = seat(
      context,
      anchorU,
      MathUtils.lerp(data.fromX, data.toX, nextEased),
      MathUtils.lerp(data.fromY, data.toY, nextEased) + Math.sin(nextK * Math.PI) * data.arc,
      Math.sin(nextK * Math.PI) * 7,
    ).clone();
    enemy.mesh.lookAt(ahead);
    enemy.mesh.rotateZ((data.toX > data.fromX ? -1 : 1) * (0.7 + Math.sin(k * Math.PI) * 0.55));
    return false;
  }

  // Escorts: a helix that sweeps a wide circle across the frame while closing.
  function updateWasp(context: BroadsideUpdate, data: Extract<BroadsideSpawnData, { role: 'wasp' }>) {
    const { enemy, runProgress, age, railAnchor } = context;
    const anchorU = railAnchor(data.lead);
    if (runProgress > anchorU + PASS_MARGIN) return true;
    const t = Math.max(0, age - data.delay);
    const angle = data.phase + t * data.spin;
    // The helix winds tighter as it arrives — a screw closing on the camera.
    const radius = data.radius * (1.15 - 0.45 * MathUtils.clamp(t / Math.max(0.4, data.lead), 0, 1));
    const x = data.centerX + Math.cos(angle) * radius;
    const y = data.centerY + Math.sin(angle) * radius * 0.78;
    enemy.mesh.position.copy(seat(context, anchorU, x, y, Math.sin(angle * 0.5) * 4));
    enemy.mesh.quaternion.copy(context.camera.quaternion);
    enemy.mesh.rotateZ(angle * 1.7);
    enemy.mesh.rotateX(0.5);
    enemy.mesh.userData.spinPhase = angle;
    return false;
  }

  // Gunboats: they hold a post, slide sideways in long powered glides, and put
  // one heavy shell down the middle. Heavier, slower, armored.
  function updatePicket(context: BroadsideUpdate, data: Extract<BroadsideSpawnData, { role: 'picket' }>) {
    const { enemy, runProgress, age, camera, railAnchor } = context;
    const anchorU = railAnchor(data.lead);
    const state = context.enemyState(() => ({
      x: data.x,
      y: data.y,
      fromX: data.x,
      fromY: data.y,
      toX: data.x,
      toY: data.y,
      glideAt: 0.9 + (data.seed % 0.6),
      glideStart: -1,
      fireAt: 0.75 + (data.seed % 0.6),
      burst: 0,
      shots: 0,
    }));

    if (age >= state.glideAt) {
      state.glideStart = age;
      state.fromX = state.x;
      state.fromY = state.y;
      const wobble = (n: number) => Math.sin(data.seed * 21.7 + age * n);
      state.toX = MathUtils.clamp(data.x + wobble(3.1) * 16, -30, 30);
      state.toY = MathUtils.clamp(data.y + wobble(5.3) * 11, -18, 22);
      state.glideAt = age + 1.6;
    }
    if (state.glideStart >= 0) {
      const k = MathUtils.clamp((age - state.glideStart) / 1.1, 0, 1);
      const glide = k * k * (3 - 2 * k);
      state.x = MathUtils.lerp(state.fromX, state.toX, glide);
      state.y = MathUtils.lerp(state.fromY, state.toY, glide);
      enemy.mesh.userData.thrust = 1 - k;
    }

    const untilShot = state.fireAt - age;
    enemy.mesh.userData.charge = untilShot < 0.7 ? 1 - Math.max(0, untilShot) / 0.7 : 0;
    // One heavy shell per gunboat, well telegraphed: the picket is a problem
    // you can solve by killing it first, not a stream you have to soak.
    if (age >= state.fireAt && state.shots < 1) {
      state.shots += 1;
      fireFlak(context, enemy.mesh.position, 5.2);
      state.fireAt = age + 1.5;
    }

    enemy.mesh.position.copy(seat(context, anchorU, state.x, state.y, 0));
    enemy.mesh.lookAt(camera.position);
    enemy.mesh.rotateZ(Math.sin(data.seed + age * 0.7) * 0.25);
    return runProgress > anchorU + PASS_MARGIN;
  }

  // Hull batteries: bolted to the warship passing overhead. They do not travel
  // at all — they track, and they get raked as the rail carries you past.
  function updateTurret(context: BroadsideUpdate, data: Extract<BroadsideSpawnData, { role: 'turret' }>) {
    const { enemy, runProgress, age, camera, railAnchor } = context;
    const anchorU = railAnchor(data.lead);
    const state = context.enemyState(() => ({ fireAt: 0.7 + (data.seed % 0.5), shots: 0 }));
    enemy.mesh.position.copy(seat(context, anchorU, data.x, data.y, 0));

    const mount = enemy.mesh.userData.mount as { lookAt(target: Vector3): void } | undefined;
    if (mount) mount.lookAt(camera.position);
    else enemy.mesh.lookAt(camera.position);

    const untilShot = state.fireAt - age;
    enemy.mesh.userData.charge = untilShot < 0.55 ? 1 - Math.max(0, untilShot) / 0.55 : 0;
    if (age >= state.fireAt && state.shots < 1) {
      state.shots += 1;
      state.fireAt = age + 1.3;
      fireFlak(context, enemy.mesh.position, 5.0);
    }
    return runProgress > anchorU + PASS_MARGIN;
  }

  function updateBolt(context: BroadsideUpdate, data: Extract<BroadsideSpawnData, { role: 'bolt' }>) {
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
      // A tighter hit sphere than the engine default: at battle speed a round
      // that is nearly on the canopy should still be survivable if it is off
      // the centreline, and the sky here is full of rounds.
      // A longer brake than the engine default: an incoming round hangs in
      // front of the canopy for most of a beat, which is the window a player
      // needs to lock and swat it at this speed. Everything else about the
      // impact model is the shared one.
      config: { impactBrake: 0.6, damageDistance: 1.2 },
    });
    if (impact.phase === 'braking') {
      enemy.mesh.position.copy(data.position);
      enemy.mesh.quaternion.copy(camera.quaternion);
      enemy.mesh.rotateZ(age * 9);
      if (impact.damaged) {
        damagePlayer(1);
        return true;
      }
      return false;
    }

    // Flak has to be genuinely quick: the round must close a 25-unit lateral
    // error against a camera that is itself moving, and the shared impact model
    // only fires inside 2.4 units of the canopy.
    steerHomingShot(data.position, data.velocity, flakAim(context, data.position), age, dt, {
      baseSpeed: 18,
      maxSpeed: 44,
      accel: 15,
      turnRate: 3.6,
    });
    enemy.mesh.position.copy(data.position);
    if (data.velocity.lengthSq() > 0.001) enemy.mesh.lookAt(data.position.clone().add(data.velocity));
    return age > BOLT_MAX_AGE || shotBehindCamera(camera, data.position);
  }

  // ---- level definition -----------------------------------------------------

  return {
    duration: BROADSIDE_DURATION,
    bpm: BROADSIDE_BPM,
    playerHealth: BROADSIDE_PLAYER_HEALTH,
    createRail: createBroadsideRail,
    spawnTimeline: BROADSIDE_SPAWN_TIMELINE,
    easeRunProgress: broadsideRunProgress,
    // Attract: holding on the catapult with the engagement already running
    // ahead of you. A slow breathing dolly rather than a static shot, so the
    // fleet gunnery in the background has somewhere to read against.
    updateAttractCamera({ camera, curve, modeTime }) {
      const u = 0.006 + 0.016 * (0.5 - 0.5 * Math.cos(modeTime * 0.2));
      camera.position.copy(offsetFromRail(curve, u, attractHere.set(
        Math.sin(modeTime * 0.31) * 2.6,
        1.4 + Math.cos(modeTime * 0.23) * 1.1,
        0,
      )));
      camera.lookAt(offsetFromRail(curve, Math.min(1, u + 0.05), attractAhead.set(
        Math.sin(modeTime * 0.19) * 5,
        3.4 + Math.cos(modeTime * 0.17) * 2,
        0,
      )));
      camera.rotateZ(Math.sin(modeTime * 0.16) * 0.06);
    },
    startWord: 'LAUNCH',
    replayWord: 'AGAIN',
    timing: {
      // A broadside is a rolling salvo, not a single crack — but at this pace a
      // six-shot ripple has to finish before the camera has flown past its own
      // targets, so the ramp is capped at an eighth and the gap growth halved.
      shotDelay: { maxGridSeconds: 0.3, gridRampGapGrowthThirtyseconds: 1 },
    },
    updateEnemy(context) {
      const data = context.enemy.entry.data;
      switch (data.role) {
        case 'lance':
          return updateLance(context, data);
        case 'wasp':
          return updateWasp(context, data);
        case 'picket':
          return updatePicket(context, data);
        case 'turret':
          return updateTurret(context, data);
        case 'bolt':
          return updateBolt(context, data);
        case 'generator':
          return flagship.updateGenerator(context, data, seat);
        case 'core':
          return flagship.updateCore(context, data, seat);
      }
    },
    // The flagship's shield is a real wall: while it holds, a volley that
    // includes a trench core loses exactly those shots, and the shield flares
    // where they would have landed.
    validateRelease(enemies) {
      if (flagship.shieldDown()) return true;
      const blocked = enemies.filter((enemy) => enemy.kind === 'core');
      if (blocked.length === 0) return true;
      flagship.reportShieldBlock(blocked, enemies);
      const allowed = enemies.filter((enemy) => enemy.kind !== 'core');
      return allowed.length === 0 ? false : allowed;
    },
    scoreForKill(volleySize, enemy) {
      if (enemy.kind === 'bolt') flakShot += 1;
      if (enemy.kind === 'turret') turretsRaked += 1;
      const multiplier = 1 + Math.max(0, volleySize - 1) * 0.2;
      return Math.round(KILL_SCORE[enemy.kind] * multiplier);
    },
    scoreForHit: () => 55,
    // A full six-lock release is the level's title move.
    scoreForVolley(results) {
      if (results.length < 4 || !results.every((result) => result.killed)) return 0;
      return results.length === 6 ? 700 : results.length * 80;
    },
    rankForRun(score, kills, totalEnemies) {
      const clearRate = totalEnemies === 0 ? 0 : kills / totalEnemies;
      if (flagship.flagshipDestroyed() && score >= 25000 && clearRate >= 0.9) return 'S';
      if (flagship.flagshipDestroyed() && score >= 18000 && clearRate >= 0.68) return 'A';
      if (score >= 11000 && clearRate >= 0.45) return 'B';
      if (score >= 5000 && clearRate >= 0.22) return 'C';
      return 'D';
    },
    detailsForRun() {
      const hull = Math.max(0, BROADSIDE_PLAYER_HEALTH - hitsTaken);
      const lines = [`Hull ${hull}/${BROADSIDE_PLAYER_HEALTH}`];
      lines.push(...flagship.summaryLines());
      if (turretsRaked > 0) lines.push(`${turretsRaked} hull batter${turretsRaked === 1 ? 'y' : 'ies'} raked`);
      if (flakShot > 0) lines.push(`${flakShot} incoming round${flakShot === 1 ? '' : 's'} shot down`);
      return lines;
    },
  };
}
