import { CatmullRomCurve3, MathUtils, PerspectiveCamera, Vector3 } from 'three';
import {
  hostileShotAimPoint,
  shotBehindCamera,
  steerHomingShot,
  updateHostileShotImpact,
} from '../../engine/hostile-shot';
import type { LockOnRunnerLevel } from '../../engine/lock-on-runner';
import { offsetFromRail } from '../../engine/rail';
import { createSpeedProfile } from '../../engine/speed-profile';
import type { EventBus } from '../../events';
import { GENERATOR_COUNT, createFlagship, createFlagshipEntries } from './flagship';
import { battle } from './state';
import { BROADSIDE_BPM, BROADSIDE_DURATION, bar } from './timing';
import type { BroadsideEnemyKind, BroadsideSpawnData, BroadsideSpawnEntry, BroadsideUpdate } from './types';

// BROADSIDE — sixty seconds across a fleet engagement, thrown off the deck of
// your own flagship and flown through the gap between two battle lines:
//
//   Launch     (bars 0–4)    The catapult. Your fleet's guns open up behind you.
//   Crossfire  (bars 4–10)   The knot between the lines. Hard banks, corkscrews.
//   Flank      (bars 10–15)  A high-speed run down a friendly cruiser's side
//                            while its broadside fires over your canopy.
//   Raking     (bars 15–20)  Along an enemy warship's belly, killing turrets.
//   The eye    (bar 20)      One bar of near silence. The flagship fills the frame.
//   Shields    (bars 21–26)  Its emitters, on the beat. Four of six ends the shield.
//   Breach     (bars 26–28)  Escorts pour out of the hangars as the rail comes round.
//   Trench     (bars 28–32)  Down the dorsal canyon into the reactor couplings.
//   Victory    (bars 32–33)  The pull-out.

export { BROADSIDE_BPM, BROADSIDE_DURATION, bar } from './timing';
export { CORE_COUNT, GENERATOR_COUNT, SHIELD_COLLAPSE_AT } from './flagship';

export const BROADSIDE_PLAYER_HEALTH = 5;

// ---- the rail ------------------------------------------------------------------

// Authored as a flight, not a tube: the launch is straight, the crossfire is a
// pair of opposed banks with a low corkscrew between them, the flank is nearly
// level so the cruiser beside you does the work, the raking pass drops under an
// enemy keel, and the last third climbs over the flagship's bow shoulder before
// diving into its dorsal trench and blasting out the far end.
const RAIL_POINTS: Array<[number, number, number]> = [
  [0, 0, 0],
  [0, 5, -78],
  [26, 11, -176],
  [-14, 5, -292],
  [-42, -8, -402],
  [8, 9, -508],
  [-44, 7, -604],
  [-53, 10, -722],
  [-45, 13, -842],
  [-9, 4, -952],
  [33, -20, -1058],
  [41, -23, -1142],
  [17, -8, -1236],
  [25, 2, -1312],
  [28, 5, -1422],
  [26, 3, -1522],
  [11, 15, -1612],
  [63, 31, -1692],
  [95, 27, -1762],
  [95, 12, -1832],
  [95, 8, -1902],
  [95, 8, -1976],
  [95, 31, -2042],
  [90, 80, -2104],
];

export function createBroadsideRail() {
  return new CatmullRomCurve3(
    RAIL_POINTS.map(([x, y, z]) => new Vector3(x, y, z)),
    false,
    'catmullrom',
    0.4,
  );
}

// ---- speed profile → rail easing --------------------------------------------

// The catapult is the level's first statement: a dead stop, then 2.1× for three
// quarters of a bar. After that speed tracks the fiction — fastest down the
// friendly cruiser's flank and in the trench, slowest in the eye of the battle
// where the score falls away too.
const SPEED_KEYS: Array<[number, number]> = [
  [bar(0), 0.5],
  [bar(0.25), 0.5],
  [bar(0.85), 2.1],
  [bar(1.6), 1.15],
  [bar(4), 1.2],
  [bar(9.6), 1.28],
  [bar(10.2), 1.55],
  [bar(14.4), 1.6],
  [bar(15.4), 1.25],
  [bar(19.4), 1.05],
  [bar(20.3), 0.55],
  [bar(21), 0.95],
  [bar(25.8), 1.1],
  [bar(27.4), 1.65],
  [bar(28.2), 1.95],
  [bar(31.6), 1.95],
  [bar(32.3), 2.7],
  [bar(33), 0.85],
];

const speedProfile = createSpeedProfile(SPEED_KEYS, BROADSIDE_DURATION);
export const speedFactorAt = speedProfile.speedAt;

export function broadsideRunProgress(time: number, duration = BROADSIDE_DURATION) {
  return speedProfile.runProgress(time, duration);
}

/** Rail parameter the camera occupies at run time `t` — for seating set pieces. */
export const railU = (time: number) => broadsideRunProgress(time);

// ---- spawn timeline helpers -----------------------------------------------------

type CrossRun = {
  fromX: number; fromY: number; toX: number; toY: number;
  arc?: number; helix?: number; delay?: number; crossTime?: number;
};

/** Swarm darts crossing the frame. `helix` corkscrews the path around its own axis. */
const darts = (time: number, lead: number, runs: CrossRun[]): BroadsideSpawnEntry[] =>
  runs.map((run, index) => ({
    time: time + index * 0.05,
    kind: 'interceptor',
    data: {
      role: 'interceptor',
      lead,
      fromX: run.fromX,
      fromY: run.fromY,
      toX: run.toX,
      toY: run.toY,
      arc: run.arc ?? 0,
      helix: run.helix ?? 0,
      delay: run.delay ?? index * 0.16,
      crossTime: run.crossTime ?? 2.6,
    },
  }));

/** Twin-boom fighters that spiral in place instead of crossing. */
const wasps = (
  time: number,
  lead: number,
  posts: Array<{ x: number; y: number; radius?: number; rate?: number; driftX?: number }>,
): BroadsideSpawnEntry[] =>
  posts.map((post, index) => ({
    time: time + index * 0.09,
    kind: 'wasp',
    data: {
      role: 'wasp',
      lead,
      x: post.x,
      y: post.y,
      radius: post.radius ?? 4.5,
      rate: post.rate ?? 3.2,
      driftX: post.driftX ?? 0,
      delay: index * 0.22,
    },
  }));

/** Hull batteries: rooted, tracking, and throwing crimson. */
const batteries = (
  time: number,
  lead: number,
  mounts: Array<[x: number, y: number]>,
  interval = 4.2,
): BroadsideSpawnEntry[] =>
  mounts.map(([x, y], index) => ({
    time: time + index * 0.14,
    kind: 'turret',
    hitPoints: 2,
    data: {
      role: 'turret',
      lead,
      x,
      y,
      seed: time * 3.1 + index * 2.7,
      firstShot: 1.45 + index * 0.38,
      interval,
    },
  }));

/** Heavy escorts: arrive stacked, fan to their slots, then break outward. */
const escorts = (
  time: number,
  lead: number,
  slots: Array<[x: number, y: number]>,
  fromX = 0,
  fromY = 2,
): BroadsideSpawnEntry[] =>
  slots.map(([x, y], index) => ({
    time: time + index * 0.07,
    kind: 'escort',
    hitPoints: 2,
    data: {
      role: 'escort',
      lead,
      x,
      y,
      fromX,
      fromY,
      delay: index * 0.1,
      breakAt: 2.4 + index * 0.05,
    },
  }));

// ---- the choreography -------------------------------------------------------------

function buildTimeline(flagshipEntries: BroadsideSpawnEntry[]): BroadsideSpawnEntry[] {
  return [
    // --- Launch. Wide, slow, and readable: learn the sweep while your own
    //     fleet's guns hammer away behind you.
    ...darts(bar(1), 4.0, [
      { fromX: -26, fromY: 5, toX: 26, toY: 9, arc: 3.0 },
      { fromX: -26, fromY: 12, toX: 26, toY: 2, arc: 2.0, delay: 0.42 },
    ]),
    ...darts(bar(2), 4.0, [
      { fromX: 27, fromY: -8, toX: -27, toY: -2, arc: 3.4 },
      { fromX: 27, fromY: 1, toX: -27, toY: 7, arc: 2.6, delay: 0.34 },
      { fromX: 27, fromY: 10, toX: -27, toY: 14, arc: 1.8, delay: 0.68 },
    ]),
    ...wasps(bar(3.1), 3.6, [{ x: -17, y: 8, radius: 5 }, { x: 15, y: -6, radius: 4.2 }]),
    ...darts(bar(3.5), 3.7, [
      { fromX: -4, fromY: 20, toX: -24, toY: -12, helix: 1.6 },
      { fromX: 4, fromY: 20, toX: 24, toY: -12, helix: 1.6, delay: 0.18 },
    ]),

    // --- Crossfire. The lines close. Everything is at an angle to everything.
    ...darts(bar(4), 3.4, [
      { fromX: -28, fromY: -10, toX: 28, toY: 4, arc: 3.8, crossTime: 2.3 },
      { fromX: 28, fromY: 3, toX: -28, toY: 12, arc: 2.4, delay: 0.24, crossTime: 2.3 },
      { fromX: -28, fromY: 14, toX: 28, toY: -6, arc: 2.0, delay: 0.48, crossTime: 2.3 },
      { fromX: 28, fromY: -3, toX: -28, toY: 8, arc: 3.0, delay: 0.72, crossTime: 2.3 },
    ]),
    ...wasps(bar(5), 3.3, [{ x: -19, y: 3, driftX: 3 }, { x: 0, y: 14, radius: 5.4 }, { x: 19, y: -8, driftX: -3 }]),
    ...darts(bar(5.75), 3.2, [
      { fromX: -12, fromY: 22, toX: -20, toY: -14, helix: 2.4, crossTime: 2.2 },
      { fromX: 12, fromY: 22, toX: 20, toY: -14, helix: 2.4, delay: 0.2, crossTime: 2.2 },
      { fromX: 0, fromY: 24, toX: 2, toY: -16, helix: 3.0, delay: 0.4, crossTime: 2.2 },
    ]),
    // Bar 6.5 is the first full-width six: the level's first real broadside.
    ...darts(bar(6.5), 3.3, [
      { fromX: -30, fromY: -12, toX: 30, toY: -12, arc: 5.0, delay: 0, crossTime: 2.4 },
      { fromX: -30, fromY: -4, toX: 30, toY: -4, arc: 4.2, delay: 0.14, crossTime: 2.4 },
      { fromX: -30, fromY: 4, toX: 30, toY: 4, arc: 3.4, delay: 0.28, crossTime: 2.4 },
      { fromX: 30, fromY: 8, toX: -30, toY: 8, arc: 2.8, delay: 0.42, crossTime: 2.4 },
      { fromX: 30, fromY: 15, toX: -30, toY: 15, arc: 2.0, delay: 0.56, crossTime: 2.4 },
      { fromX: 30, fromY: 21, toX: -30, toY: 21, arc: 1.4, delay: 0.7, crossTime: 2.4 },
    ]),
    ...wasps(bar(7.6), 3.2, [{ x: -21, y: -6 }, { x: -7, y: 11 }, { x: 21, y: 5 }]),
    ...darts(bar(8.1), 3.1, [
      { fromX: 30, fromY: -14, toX: -30, toY: 6, arc: 4.4, crossTime: 2.2 },
      { fromX: -30, fromY: 18, toX: 30, toY: 0, arc: 2.2, delay: 0.22, crossTime: 2.2 },
      { fromX: 30, fromY: 9, toX: -30, toY: -8, arc: 3.2, delay: 0.44, crossTime: 2.2 },
    ]),
    ...wasps(bar(9), 3.1, [
      { x: -13, y: 15, radius: 6 }, { x: 13, y: 15, radius: 6 },
      { x: -13, y: -9, radius: 6 }, { x: 13, y: -9, radius: 6 },
    ]),

    // --- Flank. Speed jumps; the cruiser's broadside fires over your head on
    //     every downbeat. Formations get wider so the ship stays in frame.
    ...darts(bar(10.25), 3.0, [
      { fromX: -30, fromY: -6, toX: 30, toY: 10, arc: 3.4, crossTime: 2.1 },
      { fromX: 30, fromY: 16, toX: -30, toY: 2, arc: 2.4, delay: 0.2, crossTime: 2.1 },
      { fromX: -30, fromY: 8, toX: 30, toY: -10, arc: 3.0, delay: 0.4, crossTime: 2.1 },
    ]),
    ...wasps(bar(11), 3.0, [{ x: 20, y: 9, driftX: -4 }, { x: -20, y: -4, driftX: 4 }]),
    // Bar 11.75: a descending stair across the full width, on the phrase.
    ...darts(bar(11.75), 3.0, [
      { fromX: -32, fromY: 20, toX: 32, toY: 18, arc: 1.2, delay: 0, crossTime: 2.2 },
      { fromX: -32, fromY: 13, toX: 32, toY: 11, arc: 1.6, delay: 0.12, crossTime: 2.2 },
      { fromX: -32, fromY: 6, toX: 32, toY: 4, arc: 2.2, delay: 0.24, crossTime: 2.2 },
      { fromX: -32, fromY: -1, toX: 32, toY: -3, arc: 2.8, delay: 0.36, crossTime: 2.2 },
      { fromX: -32, fromY: -8, toX: 32, toY: -10, arc: 3.4, delay: 0.48, crossTime: 2.2 },
      { fromX: -32, fromY: -15, toX: 32, toY: -17, arc: 4.0, delay: 0.6, crossTime: 2.2 },
    ]),
    ...wasps(bar(12.6), 3.0, [{ x: -22, y: 12 }, { x: 5, y: -12 }, { x: 22, y: 3 }]),
    ...darts(bar(13.25), 2.9, [
      { fromX: 32, fromY: -12, toX: -32, toY: 14, arc: 3.6, helix: 1.2, crossTime: 2.1 },
      { fromX: -32, fromY: 16, toX: 32, toY: -8, arc: 2.6, helix: 1.2, delay: 0.18, crossTime: 2.1 },
      { fromX: 32, fromY: 4, toX: -32, toY: 4, arc: 3.0, helix: 1.6, delay: 0.36, crossTime: 2.1 },
      { fromX: -32, fromY: -4, toX: 32, toY: 20, arc: 2.2, helix: 1.2, delay: 0.54, crossTime: 2.1 },
    ]),
    ...darts(bar(14.1), 2.9, [
      { fromX: -8, fromY: 20, toX: -26, toY: -14, helix: 2.6, crossTime: 2.1 },
      { fromX: 8, fromY: 20, toX: 26, toY: -14, helix: 2.6, delay: 0.13, crossTime: 2.1 },
      { fromX: -24, fromY: -16, toX: -6, toY: 19, helix: 2.6, delay: 0.26, crossTime: 2.1 },
      { fromX: 24, fromY: -16, toX: 6, toY: 19, helix: 2.6, delay: 0.39, crossTime: 2.1 },
    ]),
    ...wasps(bar(14.7), 2.9, [{ x: -16, y: -2, radius: 5.5 }, { x: 16, y: 10, radius: 5.5 }]),

    // --- Raking. Under an enemy keel: rooted batteries you fly past, spread
    //     across the whole hull face, with swarm cover between salvos.
    // Batteries hang off the keel plating overhead, so they own the upper
    // frame across its full width while the swarm works the open space below.
    ...batteries(bar(15), 4.4, [[-22, 11], [2, 18], [22, 8]]),
    ...darts(bar(15.9), 3.2, [
      { fromX: -30, fromY: -14, toX: 30, toY: -6, arc: 3.0, crossTime: 2.3 },
      { fromX: 30, fromY: -2, toX: -30, toY: -16, arc: 2.4, delay: 0.22, crossTime: 2.3 },
      { fromX: -30, fromY: 20, toX: 30, toY: 12, arc: 1.8, delay: 0.44, crossTime: 2.3 },
    ]),
    ...batteries(bar(16.6), 4.3, [[-25, 7], [-4, 19], [17, 13]]),
    ...wasps(bar(17.1), 3.2, [{ x: -14, y: -14 }, { x: 13, y: -6 }, { x: 0, y: -19, radius: 5.6 }]),
    ...batteries(bar(17.8), 4.2, [[-26, 16], [-11, 8], [9, 19], [25, 10]]),
    ...darts(bar(18.5), 3.1, [
      { fromX: -32, fromY: 2, toX: 32, toY: 2, arc: 4.6, delay: 0, crossTime: 2.2 },
      { fromX: -32, fromY: 10, toX: 32, toY: 10, arc: 3.6, delay: 0.15, crossTime: 2.2 },
      { fromX: 32, fromY: -6, toX: -32, toY: -6, arc: 3.6, delay: 0.3, crossTime: 2.2 },
      { fromX: 32, fromY: -14, toX: -32, toY: -14, arc: 2.8, delay: 0.45, crossTime: 2.2 },
      { fromX: -32, fromY: 19, toX: 32, toY: 19, arc: 2.0, delay: 0.6, crossTime: 2.2 },
    ]),
    ...batteries(bar(19.1), 4.0, [[-17, 9], [17, 17]]),
    ...wasps(bar(19.5), 3.0, [{ x: -20, y: -2 }, { x: 20, y: 4 }]),

    // (bars 20–21: the eye of the battle. Nothing spawns; the silence is the cue.)

    // --- Shields. Emitters own the starboard hull face, so the swarm cover is
    //     authored to sweep in from port and keep the frame in use.
    ...flagshipEntries.filter((entry) => entry.kind === 'generator'),
    ...darts(bar(22.1), 3.6, [
      { fromX: -30, fromY: 16, toX: -6, toY: -16, helix: 2.0, crossTime: 2.5 },
      { fromX: -30, fromY: -12, toX: -4, toY: 18, helix: 2.0, delay: 0.2, crossTime: 2.5 },
      { fromX: -28, fromY: 2, toX: 4, toY: 2, arc: 3.4, delay: 0.4, crossTime: 2.5 },
    ]),
    ...wasps(bar(23.3), 3.4, [
      { x: -22, y: 12 }, { x: -18, y: -12 },
      { x: -4, y: 20, radius: 5.4 }, { x: 2, y: -19, radius: 5.4 },
    ]),
    ...darts(bar(24.5), 3.4, [
      { fromX: -32, fromY: -8, toX: 22, toY: 10, arc: 3.2, crossTime: 2.4 },
      { fromX: -32, fromY: 18, toX: 20, toY: -14, arc: 2.2, delay: 0.2, crossTime: 2.4 },
      { fromX: -30, fromY: 6, toX: 24, toY: 20, arc: 2.6, delay: 0.4, crossTime: 2.4 },
      { fromX: -30, fromY: -18, toX: 18, toY: -2, arc: 3.8, delay: 0.6, crossTime: 2.4 },
    ]),
    ...wasps(bar(25.4), 3.2, [{ x: -24, y: -4, driftX: 4 }, { x: -10, y: 16 }, { x: 6, y: -16 }]),

    // --- Breach. The hangars empty. Formation arrivals that fan to full width.
    ...escorts(bar(26), 3.0, [[-26, 10], [-14, -4], [-2, 18], [10, -6], [22, 8], [28, 2]], 0, 4),
    ...darts(bar(26.9), 2.9, [
      { fromX: -32, fromY: -14, toX: 32, toY: 8, arc: 3.4, crossTime: 2.1 },
      { fromX: 32, fromY: 14, toX: -32, toY: -8, arc: 2.6, delay: 0.16, crossTime: 2.1 },
      { fromX: -32, fromY: 20, toX: 32, toY: -18, arc: 2.0, delay: 0.32, crossTime: 2.1 },
      { fromX: 32, fromY: -20, toX: -32, toY: 18, arc: 3.0, delay: 0.48, crossTime: 2.1 },
    ]),
    ...escorts(bar(27.1), 2.6, [[-20, -2], [-7, 14], [7, -4], [20, 12]], 0, 2),

    // --- Trench. Tight, fast, and walled: everything lives inside ±20.
    ...flagshipEntries.filter((entry) => entry.kind === 'core'),
    ...batteries(bar(28.6), 2.6, [[-15, 12], [15, -12]], 3.4),
    ...darts(bar(29.0), 2.2, [
      { fromX: -16, fromY: -13, toX: 16, toY: 13, helix: 2.2, crossTime: 1.6 },
      { fromX: 16, fromY: -13, toX: -16, toY: 13, helix: 2.2, delay: 0.12, crossTime: 1.6 },
      { fromX: 0, fromY: 18, toX: 0, toY: -18, helix: 3.4, delay: 0.24, crossTime: 1.6 },
    ]),
    ...batteries(bar(29.8), 2.5, [[-16, -11], [16, 11]], 3.4),
    ...darts(bar(30.4), 2.2, [
      { fromX: -16, fromY: 13, toX: 16, toY: -13, helix: 2.4, crossTime: 1.6 },
      { fromX: 16, fromY: 13, toX: -16, toY: -13, helix: 2.4, delay: 0.11, crossTime: 1.6 },
      { fromX: -16, fromY: -4, toX: 16, toY: 4, arc: 2.4, delay: 0.22, crossTime: 1.6 },
      { fromX: 16, fromY: 4, toX: -16, toY: -4, arc: 2.4, delay: 0.33, crossTime: 1.6 },
    ]),
    ...batteries(bar(30.9), 2.4, [[-15, 6], [15, -6]], 3.2),
    // The last pair of the run, kept tight to the centreline: the rail is
    // pitching up out of the canyon here and a wide crossing would fly behind
    // the trench lip on its way past.
    ...darts(bar(31.35), 1.5, [
      { fromX: -9, fromY: 7, toX: 9, toY: 7, arc: 1.2, crossTime: 1.15 },
      { fromX: 9, fromY: -7, toX: -9, toY: -7, arc: 1.2, delay: 0.1, crossTime: 1.15 },
    ]),

    // (bars 32–33: the pull-out. Nothing spawns; the battle is the picture.)
  ];
}

export function createBroadsideTimeline() {
  const flagship = createFlagshipEntries();
  return { timeline: buildTimeline(flagship.timeline).sort((a, b) => a.time - b.time) };
}

// ---- scoring ---------------------------------------------------------------------

const KILL_SCORE: Record<BroadsideEnemyKind, number> = {
  interceptor: 110,
  wasp: 145,
  turret: 300,
  shell: 45,
  escort: 260,
  generator: 750,
  core: 1250,
};

const SHELL_MAX_AGE = 11;
const MISS_GRACE = 0.012;

// ---- the level -------------------------------------------------------------------

export function createBroadsideGameplay(bus: EventBus): LockOnRunnerLevel<BroadsideEnemyKind, BroadsideSpawnData> {
  const { timeline } = createBroadsideTimeline();

  const interceptions = new Set<number>();
  let hitsTaken = 0;
  let shellsShot = 0;
  let broadsides = 0;
  let bestBroadside = 0;
  // Captured from the update context so volley scoring can ask which flank a
  // target was on. The runner owns the camera; the level only reads it.
  let cameraRef: PerspectiveCamera | null = null;

  bus.on('runstart', () => {
    interceptions.clear();
    battle.reset();
    hitsTaken = 0;
    shellsShot = 0;
    broadsides = 0;
    bestBroadside = 0;
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

  function fireShell(context: BroadsideUpdate, from: Vector3) {
    const initial = hostileShotAimPoint(context.camera, from).sub(from).normalize().multiplyScalar(6);
    context.spawnEnemy({
      time: context.runTime,
      kind: 'shell',
      countsTowardTotal: false,
      data: { role: 'shell', position: from.clone(), velocity: initial, lastAge: 0, impact: {} },
    });
  }

  const flagship = createFlagship(bus, { fireShell });

  // ---- motion ------------------------------------------------------------------

  const scratch = new Vector3();

  function updateInterceptor(context: BroadsideUpdate, data: Extract<BroadsideSpawnData, { role: 'interceptor' }>) {
    const { enemy, runProgress, age, curve, railAnchor } = context;
    const anchorU = railAnchor(data.lead);
    const t = (age - data.delay) / data.crossTime;
    if (t > 1.18 || runProgress > anchorU + MISS_GRACE) return true;

    const k = MathUtils.clamp(t, 0, 1);
    // Corkscrew: a helix wound around the straight crossing line, phase-locked
    // to the enemy id so a formation never rolls in unison.
    const point = (progress: number, out: Vector3) => {
      const e = MathUtils.clamp(progress, 0, 1);
      const s = e * e * (3 - 2 * e);
      const spin = s * Math.PI * 3.2 + enemy.id * 0.7;
      return out.set(
        MathUtils.lerp(data.fromX, data.toX, s) + Math.cos(spin) * data.helix,
        MathUtils.lerp(data.fromY, data.toY, s) + Math.sin(s * Math.PI) * data.arc + Math.sin(spin) * data.helix,
        0,
      );
    };

    enemy.mesh.position.copy(offsetFromRail(curve, anchorU, point(k, scratch)));
    enemy.mesh.lookAt(offsetFromRail(curve, anchorU, point(k + 0.06, scratch)));
    // Bank into the turn: darts fly like aircraft, not like sprites.
    const bank = (data.toX > data.fromX ? -1 : 1) * (0.6 + Math.sin(k * Math.PI) * 0.7)
      + (data.helix > 0 ? Math.sin(k * Math.PI * 3.2 + enemy.id * 0.7) * 0.8 : 0);
    enemy.mesh.rotateZ(bank);
    enemy.mesh.userData.throttle = 0.6 + Math.sin(k * Math.PI) * 0.4;
    return false;
  }

  function updateWasp(context: BroadsideUpdate, data: Extract<BroadsideSpawnData, { role: 'wasp' }>) {
    const { enemy, runProgress, age, curve, camera, railAnchor } = context;
    const anchorU = railAnchor(data.lead);
    if (runProgress > anchorU + MISS_GRACE) return true;

    const t = Math.max(0, age - data.delay);
    // A corkscrew that tightens as it closes: the spiral is this silhouette's
    // motion signature the way crossing is the dart's.
    const tighten = 1 - MathUtils.clamp(t / (data.lead * 0.9), 0, 1) * 0.55;
    const angle = t * data.rate + enemy.id * 1.3;
    const radius = data.radius * tighten;
    enemy.mesh.position.copy(offsetFromRail(curve, anchorU, scratch.set(
      data.x + Math.cos(angle) * radius + data.driftX * t,
      data.y + Math.sin(angle) * radius * 0.82,
      0,
    )));
    enemy.mesh.quaternion.copy(camera.quaternion);
    // Roll with the orbit so the booms scissor across the frame.
    enemy.mesh.rotateZ(angle * 0.7);
    enemy.mesh.rotateX(Math.sin(t * 2.1) * 0.3);
    enemy.mesh.userData.throttle = 0.7 + Math.sin(angle * 2) * 0.3;
    return false;
  }

  function updateTurret(context: BroadsideUpdate, data: Extract<BroadsideSpawnData, { role: 'turret' }>) {
    const { enemy, runProgress, age, curve, camera, railAnchor } = context;
    const anchorU = railAnchor(data.lead);
    const state = context.enemyState(() => ({ nextShot: data.firstShot, recoil: 0 }));

    // Charge lamp climbs through the last 0.7 s before each salvo.
    const untilShot = state.nextShot - age;
    enemy.mesh.userData.charge = untilShot < 0.7 ? MathUtils.clamp(1 - untilShot / 0.7, 0, 1) : 0;
    if (age >= state.nextShot) {
      state.nextShot = age + data.interval;
      state.recoil = 1;
      fireShell(context, enemy.mesh.position.clone());
    }
    state.recoil = Math.max(0, state.recoil - 0.055);
    enemy.mesh.userData.recoil = state.recoil;

    enemy.mesh.position.copy(offsetFromRail(curve, anchorU, scratch.set(data.x, data.y, 0)));
    // Rooted to the hull, but the barbette tracks you the whole way past.
    enemy.mesh.lookAt(camera.position);
    enemy.mesh.rotateZ(Math.sin(data.seed) * 0.4);
    return runProgress > anchorU + MISS_GRACE;
  }

  function updateEscort(context: BroadsideUpdate, data: Extract<BroadsideSpawnData, { role: 'escort' }>) {
    const { enemy, runProgress, age, curve, camera, railAnchor } = context;
    const anchorU = railAnchor(data.lead);
    if (runProgress > anchorU + MISS_GRACE) return true;

    const t = Math.max(0, age - data.delay);
    const FAN = 1.3;
    let x: number;
    let y: number;
    if (t < FAN) {
      // Arrive stacked out of the hangar mouth, then fan to station.
      const eased = 1 - (1 - t / FAN) ** 3;
      x = MathUtils.lerp(data.fromX, data.x, eased);
      y = MathUtils.lerp(data.fromY, data.y, eased);
    } else if (t < data.breakAt) {
      const hold = t - FAN;
      x = data.x + Math.sin(hold * 2.6 + enemy.id) * 1.1;
      y = data.y + Math.cos(hold * 2.1 + enemy.id) * 0.9;
    } else {
      // Break: peel outward and away, still shootable on the way out.
      const away = t - data.breakAt;
      x = data.x + Math.sign(data.x || 1) * away * away * 22;
      y = data.y + away * away * 9;
    }

    enemy.mesh.position.copy(offsetFromRail(curve, anchorU, scratch.set(x, y, 0)));
    enemy.mesh.quaternion.copy(camera.quaternion);
    enemy.mesh.rotateZ(MathUtils.clamp((x - data.x) * 0.06, -0.9, 0.9));
    enemy.mesh.userData.throttle = t < FAN ? 1 : 0.55;
    return Math.abs(x) > 70;
  }

  function updateShell(context: BroadsideUpdate, data: Extract<BroadsideSpawnData, { role: 'shell' }>) {
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
      // The rail peaks near eighty units a second, so the shared defaults —
      // sized for slower levels — let shells slip past before the impact test
      // ever samples them. A wider catch radius and a longer brake keep the
      // last moment of an incoming round readable at this speed.
      config: { hitDistance: 2.9, impactBrake: 0.45, damageDistance: 1.0 },
    });
    if (impact.phase === 'braking') {
      enemy.mesh.position.copy(data.position);
      enemy.mesh.quaternion.copy(camera.quaternion);
      enemy.mesh.rotateZ(age * 11);
      if (impact.damaged) {
        damagePlayer(1);
        return true;
      }
      return false;
    }

    // A shell has to close on a camera already doing 40-80 units a second, so
    // it has to be faster than one in a slower level or it simply never
    // arrives. But it must not be so fast that it cannot be shot down: the
    // whole point of a lockable hazard is that answering it is a decision.
    // These numbers give roughly two seconds of visible approach.
    steerHomingShot(data.position, data.velocity, hostileShotAimPoint(camera, data.position), age, dt, {
      baseSpeed: 11,
      maxSpeed: 34,
      accel: 9,
      turnRate: 3.0,
    });
    enemy.mesh.position.copy(data.position);
    if (data.velocity.lengthSq() > 0.0001) enemy.mesh.lookAt(data.position.clone().add(data.velocity));
    return age > SHELL_MAX_AGE || shotBehindCamera(camera, data.position);
  }

  // ---- the broadside bonus -----------------------------------------------------

  /** Screen flank of a target: -1 port, +1 starboard, 0 too near the centreline to count. */
  function flankOf(position: Vector3) {
    if (!cameraRef) return 0;
    const ndc = position.clone().project(cameraRef);
    if (!Number.isFinite(ndc.x) || Math.abs(ndc.x) < 0.07) return 0;
    return ndc.x < 0 ? -1 : 1;
  }

  return {
    duration: BROADSIDE_DURATION,
    bpm: BROADSIDE_BPM,
    playerHealth: BROADSIDE_PLAYER_HEALTH,
    createRail: createBroadsideRail,
    spawnTimeline: timeline,
    easeRunProgress: broadsideRunProgress,
    startWord: 'LAUNCH',
    replayWord: 'REARM',
    // Fast level: the engine's default coarse shot grid is too slow for a rail
    // that peaks near eighty units a second, so the grid is capped tight enough
    // that a volley lands inside the bar it was fired in, even in the trench.
    timing: { shotDelay: { maxGridSeconds: 0.13 } },

    updateEnemy(context) {
      cameraRef = context.camera;
      const data = context.enemy.entry.data;
      switch (data.role) {
        case 'interceptor':
          return updateInterceptor(context, data);
        case 'wasp':
          return updateWasp(context, data);
        case 'turret':
          return updateTurret(context, data);
        case 'shell':
          return updateShell(context, data);
        case 'escort':
          return updateEscort(context, data);
        case 'generator':
          return flagship.updateGenerator(context, data);
        case 'core':
          return flagship.updateCore(context, data);
      }
    },

    scoreForKill(volleySize, enemy) {
      if (enemy.kind === 'shell') shellsShot += 1;
      const multiplier = 1 + Math.max(0, volleySize - 1) * 0.2;
      return Math.round((KILL_SCORE[enemy.kind] ?? 100) * multiplier);
    },

    // Chipping armour — turret plate, emitter housing, coupling casing — pays a
    // little, so multi-hit targets never feel like dead air.
    scoreForHit: () => 55,

    scoreForVolley(results) {
      battle.broadsideVolley = false;
      battle.broadsideSize = 0;
      if (results.length < 3 || !results.every((result) => result.killed)) return 0;

      const flanks = results.map((result) => flankOf(result.enemy.mesh.position));
      const sameFlank = flanks[0] !== 0 && flanks.every((flank) => flank === flanks[0]);
      let bonus = results.length === 6 ? 600 : results.length * 70;
      if (sameFlank) {
        // The level's namesake: every gun in the volley pointed the same way.
        battle.broadsideVolley = true;
        battle.broadsideSize = results.length;
        broadsides += 1;
        bestBroadside = Math.max(bestBroadside, results.length);
        bonus += results.length === 6 ? 900 : results.length * 130;
      }
      return bonus;
    },

    rankForRun(score, kills, totalEnemies) {
      const clearRate = totalEnemies === 0 ? 0 : kills / totalEnemies;
      if (battle.flagshipKilled && score >= 26000 && clearRate >= 0.93) return 'S';
      if (battle.flagshipKilled && score >= 20000 && clearRate >= 0.74) return 'A';
      if (score >= 13000 && clearRate >= 0.5) return 'B';
      if (score >= 6000 && clearRate >= 0.26) return 'C';
      return 'D';
    },

    detailsForRun() {
      const hull = Math.max(0, BROADSIDE_PLAYER_HEALTH - hitsTaken);
      const lines = [`Hull ${hull}/${BROADSIDE_PLAYER_HEALTH}`];
      if (broadsides > 0) {
        lines.push(`${broadsides} broadside${broadsides === 1 ? '' : 's'} — best ${bestBroadside} guns one flank`);
      }
      if (shellsShot > 0) lines.push(`${shellsShot} shell${shellsShot === 1 ? '' : 's'} shot out of the air`);
      lines.push(flagship.summaryLine());
      if (battle.flagshipKilled && battle.generatorsDown === GENERATOR_COUNT) {
        lines.push('All six emitters cut — clean kill');
      }
      return lines;
    },
  };
}
