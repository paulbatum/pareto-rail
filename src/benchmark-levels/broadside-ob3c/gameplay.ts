import { CatmullRomCurve3, MathUtils, Vector3 } from 'three';
import {
  hostileShotAimPoint,
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
import { BROADSIDE_BPM, BROADSIDE_DURATION, bar } from './timing';

// BROADSIDE — sixty seconds across a fleet engagement, from your own
// flagship's catapult to the enemy flagship's core. See `timing.ts` for the
// eight-phrase spine this file is choreographed against.
//
// One idea runs through the whole geometry: the capital ships are not placed
// in world space, they are **ribbons authored along the rail**. A station
// table says where a hull's centreline sits relative to the rail frame at a
// given bar, so a hull is exactly as close as it was authored to be no matter
// what the flight path is doing — and the flagship's trench is guaranteed to
// contain that path rather than being hand-fitted to it. Enemies mount to the
// same numbers, so a hull turret always stands proud of its own plating.

export { BROADSIDE_BPM, BROADSIDE_DURATION, bar } from './timing';

export const BROADSIDE_PLAYER_HEALTH = 4;

// ---- rail -------------------------------------------------------------------------

const RAIL_RUN = 1700;

// Waypoints are (path fraction, lateral, vertical). The fraction only spaces
// them down the run axis; the Catmull-Rom smooths everything between. Read the
// comment column and you are reading the flight.
const RAIL_WAYPOINTS: Array<[s: number, x: number, y: number]> = [
  [0.000, 0, -6], // sitting on your own flagship's catapult
  [0.026, 0, -4], // the shot down the deck
  [0.052, 2, 8], // off the bow, into open space
  [0.082, 8, 18],
  [0.116, 32, 22], // first hard bank — through the gap between two hulls
  [0.152, 36, 8],
  [0.188, 8, -4],
  [0.222, -32, 4], // and back the other way
  [0.256, -36, 20],
  [0.290, -10, 24],
  [0.320, 4, 15], // rolling out onto the friendly cruiser's flank
  [0.360, 6, 12], // the long straight run: her broadside fires overhead
  [0.400, 4, 11],
  [0.440, 3, 10],
  [0.470, 16, 2], // bank right and drop under the enemy warship
  [0.505, 36, -12],
  [0.540, 42, -20], // in her shadow — the eye of the battle
  [0.575, 32, -20],
  [0.610, 13, -12],
  [0.650, 2, -4], // levelling out onto the enemy flagship's port flank
  [0.700, 0, 0],
  [0.750, -2, 2],
  [0.786, -7, 5],
  [0.816, -12, 13], // shield down: pull up and come around
  [0.846, -6, 25],
  [0.872, 4, 26], // over the dorsal, lining up the trench
  [0.900, 4, 19], // the dive
  [0.926, -4, 14],
  [0.950, 6, 13], // trench weave
  [0.972, -3, 14],
  [0.986, 3, 32], // out of the trench
  [1.000, -5, 88], // and up — the whole engagement falls into frame
];

export function createBroadsideRail() {
  return new CatmullRomCurve3(
    RAIL_WAYPOINTS.map(([s, x, y]) => new Vector3(x, y, -RAIL_RUN * s)),
    false,
    'catmullrom',
    0.4,
  );
}

// ---- speed ------------------------------------------------------------------------

// The catapult throws you; the flank run is the fastest sustained stretch; the
// enemy warship's shadow is heavy and slow; the trench is the second surge;
// the pull-out coasts so the last frame can be read.
const SPEED_KEYS: Array<[number, number]> = [
  [bar(0), 0.34],
  [bar(0.5), 0.38],
  [bar(1.0), 1.55], // catapult
  [bar(2.2), 1.05],
  [bar(3.0), 1.1], // gauntlet
  [bar(7.0), 1.2],
  [bar(8.0), 1.5], // flank run
  [bar(11.6), 1.5],
  [bar(12.4), 0.86], // under the warship: heavy and close
  [bar(15.4), 0.9],
  [bar(16.2), 1.15], // flagship flank
  [bar(20.8), 1.2],
  [bar(21.6), 1.38], // coming around
  [bar(23.8), 1.3],
  [bar(24.4), 1.5], // trench dive
  [bar(26.9), 1.5],
  [bar(27.3), 0.9], // out, and slow enough to read it
  [bar(28), 0.62],
];

const speedProfile = createSpeedProfile(SPEED_KEYS, BROADSIDE_DURATION);
export const speedFactorAt = speedProfile.speedAt;

export function broadsideRunProgress(time: number, duration = BROADSIDE_DURATION) {
  return speedProfile.runProgress(time, duration);
}

// ---- capital-ship ribbons ------------------------------------------------------------

/**
 * One cross-section of a hull, in the rail's own frame: `right`/`up` locate the
 * centreline, the half-extents give the box, and a non-zero `trenchHalfWidth`
 * cuts a slot `trenchDepth` deep out of the dorsal — the flight path runs
 * inside that slot.
 */
export type HullStation = {
  bar: number;
  right: number;
  up: number;
  halfWidth: number;
  halfHeight: number;
  trenchHalfWidth: number;
  trenchDepth: number;
};

const station = (
  barIndex: number,
  right: number,
  up: number,
  halfWidth: number,
  halfHeight: number,
  trenchHalfWidth = 0,
  trenchDepth = 0,
): HullStation => ({ bar: barIndex, right, up, halfWidth, halfHeight, trenchHalfWidth, trenchDepth });

/** Friendly cruiser on the flank run. Her starboard face passes 22 units off your port wing. */
export const CRUISER_STATIONS: HullStation[] = [
  station(6.9, -108, -30, 30, 22),
  station(7.8, -62, -10, 32, 24),
  station(8.4, -56, -6, 34, 26),
  station(11.4, -56, -6, 34, 26),
  station(12.0, -60, -16, 32, 24),
  station(12.7, -104, -44, 28, 20),
];

/** Enemy warship you pass under. Her belly hangs 16 units over your canopy. */
export const WARSHIP_STATIONS: HullStation[] = [
  station(11.2, 40, 108, 30, 22),
  station(11.9, 12, 60, 34, 26),
  station(12.4, 2, 46, 36, 30),
  station(15.5, 2, 46, 36, 30),
  station(16.0, 6, 60, 34, 26),
  station(16.6, 26, 104, 30, 22),
];

/**
 * The enemy flagship. She arrives off your starboard bow, holds a 22-unit
 * close pass for five bars while you cut her shield generators out, rolls
 * beneath you as the rail comes around, and finishes as the canyon you dive
 * into. One continuous ribbon: it is all the same ship.
 */
export const FLAGSHIP_STATIONS: HullStation[] = [
  station(15.6, 142, -58, 42, 30),
  station(16.3, 74, -16, 40, 28),
  station(17.0, 68, -8, 38, 28),
  station(20.4, 68, -8, 38, 28),
  station(21.6, 68, -16, 40, 30),
  station(22.6, 66, -34, 46, 36),
  station(23.3, 50, -52, 56, 44, 8, 30),
  station(23.9, 20, -42, 60, 46, 18, 40),
  station(24.5, 0, -20, 62, 46, 26, 44),
  station(26.8, 0, -20, 62, 46, 26, 44),
  station(27.3, 0, -30, 60, 44, 26, 44),
  station(27.9, 0, -74, 50, 36),
];

/** Sample a station table at an arbitrary bar; clamps at both ends, smoothstep between. */
export function hullStationAt(stations: HullStation[], barIndex: number): HullStation {
  if (barIndex <= stations[0].bar) return stations[0];
  const last = stations[stations.length - 1];
  if (barIndex >= last.bar) return last;
  for (let i = 1; i < stations.length; i += 1) {
    const next = stations[i];
    if (barIndex > next.bar) continue;
    const previous = stations[i - 1];
    const raw = (barIndex - previous.bar) / Math.max(1e-6, next.bar - previous.bar);
    const t = raw * raw * (3 - 2 * raw);
    return {
      bar: barIndex,
      right: MathUtils.lerp(previous.right, next.right, t),
      up: MathUtils.lerp(previous.up, next.up, t),
      halfWidth: MathUtils.lerp(previous.halfWidth, next.halfWidth, t),
      halfHeight: MathUtils.lerp(previous.halfHeight, next.halfHeight, t),
      trenchHalfWidth: MathUtils.lerp(previous.trenchHalfWidth, next.trenchHalfWidth, t),
      trenchDepth: MathUtils.lerp(previous.trenchDepth, next.trenchDepth, t),
    };
  }
  return last;
}

/** Hull surfaces the level mounts hardware to, stood 7 units off the plating so nothing is buried. */
const MOUNT_CLEARANCE = 7;
export const GENERATOR_MOUNT_RIGHT = 68 - 38 - MOUNT_CLEARANCE; // flagship port face
export const TURRET_MOUNT_UP = 46 - 30 - MOUNT_CLEARANCE; // enemy warship belly

// ---- the corridor ---------------------------------------------------------------------

/**
 * The free flying space, in the rail frame, at a given moment. This is the
 * negative of the hull tables above: wherever a capital ship occupies the
 * frame, the corridor closes on that side, and every enemy is fitted into it
 * before it is placed. That single rule is what keeps targets from ever being
 * lost behind a hull — and, read down the table, it is also the level's
 * shape: open in the crossfire, squeezed to port along the friendly cruiser,
 * flattened under the enemy warship's belly, squeezed to starboard down the
 * flagship's flank, pinched almost shut as she rolls beneath you, and finally
 * boxed in on all four sides inside her trench.
 */
type CorridorKey = readonly [bar: number, minRight: number, maxRight: number, minUp: number, maxUp: number];

const CORRIDOR: CorridorKey[] = [
  [0.0, -52, 52, -34, 34], // open space off the catapult
  [6.6, -52, 52, -34, 34], // the gauntlet: nothing to hide behind
  [7.7, -20, 52, -34, 34], // the friendly cruiser closes in to port
  [11.6, -22, 52, -34, 32],
  [12.0, -22, 52, -34, 26], // her belly starts coming down over you
  [12.4, -46, 48, -36, 15],
  [12.9, -48, 48, -36, 13], // full shadow: wide, and no headroom at all
  [15.5, -48, 48, -36, 13],
  [16.3, -48, 27, -34, 34], // the flagship's flank owns the starboard half
  [21.6, -48, 26, -34, 34],
  [22.6, -48, 14, -30, 36], // she rolls under: the gap climbs and narrows
  [23.0, -44, 2, -22, 36],
  [23.3, -8, 6, -6, 36],
  [23.9, -16, 16, -30, 34], // into the mouth of the trench
  [24.5, -23, 23, -14, 24], // the trench itself
  [27.0, -23, 23, -14, 24],
  [27.5, -44, 44, -34, 40], // out over the top, and open again
];

export type Corridor = { minRight: number; maxRight: number; minUp: number; maxUp: number };

export function corridorAt(runTime: number): Corridor {
  const barIndex = runTime / bar(1);
  if (barIndex <= CORRIDOR[0][0]) return corridorFrom(CORRIDOR[0]);
  const last = CORRIDOR[CORRIDOR.length - 1];
  if (barIndex >= last[0]) return corridorFrom(last);
  for (let i = 1; i < CORRIDOR.length; i += 1) {
    const next = CORRIDOR[i];
    if (barIndex > next[0]) continue;
    const previous = CORRIDOR[i - 1];
    const t = (barIndex - previous[0]) / Math.max(1e-6, next[0] - previous[0]);
    return {
      minRight: MathUtils.lerp(previous[1], next[1], t),
      maxRight: MathUtils.lerp(previous[2], next[2], t),
      minUp: MathUtils.lerp(previous[3], next[3], t),
      maxUp: MathUtils.lerp(previous[4], next[4], t),
    };
  }
  return corridorFrom(last);
}

function corridorFrom(key: CorridorKey): Corridor {
  return { minRight: key[1], maxRight: key[2], minUp: key[3], maxUp: key[4] };
}

const RAIL_LENGTH = createBroadsideRail().getLength();
const BASE_UNITS_PER_SECOND = RAIL_LENGTH / BROADSIDE_DURATION;

/**
 * Place an authored offset inside the corridor, so an enemy never ends up
 * inside a hull. The tangent offset matters: a target sitting 30 units further
 * down the rail lives in a *later* cross-section than its anchor does, and on
 * the flagship's roll-under that is the difference between the open gap and
 * the inside of her hull. Convert it to time before looking the corridor up.
 */
function fitOffset(anchorTime: number, right: number, up: number, along: number, out: Vector3) {
  const unitsPerSecond = Math.max(1, BASE_UNITS_PER_SECOND * speedFactorAt(anchorTime));
  const corridor = corridorAt(anchorTime + along / unitsPerSecond);
  return out.set(
    MathUtils.clamp(right, corridor.minRight, corridor.maxRight),
    MathUtils.clamp(up, corridor.minUp, corridor.maxUp),
    along,
  );
}

// ---- spawn data ---------------------------------------------------------------------

export type BroadsideEnemyKind =
  | 'interceptor'
  | 'corsair'
  | 'lance'
  | 'bolt'
  | 'turret'
  | 'escort'
  | 'generator'
  | 'core';

export type BroadsideSpawnData =
  | { role: 'interceptor'; lead: number; fromX: number; toX: number; y: number; arc: number; delay: number; crossTime: number }
  | { role: 'corsair'; lead: number; phase: number; spin: number; centerY: number; delay: number }
  | { role: 'lance'; lead: number; x: number; y: number; seed: number }
  | { role: 'bolt'; position: Vector3; velocity: Vector3; lastAge: number; impact: HostileShotImpactState }
  | { role: 'turret'; lead: number; x: number; seed: number }
  | { role: 'escort'; lead: number; x: number; y: number; breakX: number; breakY: number; delay: number }
  | { role: 'generator'; index: number; lead: number; up: number }
  | { role: 'core'; index: number; lead: number; right: number; up: number };

export type BroadsideSpawnEntry = LockOnSpawnEntry<BroadsideEnemyKind, BroadsideSpawnData>;
export type BroadsideUpdate = LockOnEnemyUpdate<BroadsideEnemyKind, BroadsideSpawnData>;

// ---- spawn choreography ---------------------------------------------------------------

const DEFAULT_LEAD = 2.7;

/** Swarm darts crossing the frame. `arc` bows the crossing so a rank never reads as a line. */
const darts = (
  time: number,
  runs: Array<{ fromX: number; toX: number; y: number; arc?: number; delay?: number; crossTime?: number }>,
  lead = DEFAULT_LEAD,
): BroadsideSpawnEntry[] =>
  runs.map((run, index) => ({
    time: time + index * 0.05,
    kind: 'interceptor',
    data: {
      role: 'interceptor',
      lead,
      fromX: run.fromX,
      toX: run.toX,
      y: run.y,
      arc: run.arc ?? 5,
      delay: run.delay ?? index * 0.22,
      crossTime: run.crossTime ?? 2.0,
    },
  }));

/** Ring-winged craft that corkscrew down the flight path at you. */
const corsairs = (
  time: number,
  spirals: Array<{ phase: number; spin?: number; centerY?: number; delay?: number }>,
  lead = 2.9,
): BroadsideSpawnEntry[] =>
  spirals.map((spiral, index) => ({
    time: time + index * 0.09,
    kind: 'corsair',
    data: {
      role: 'corsair',
      lead,
      phase: spiral.phase,
      spin: spiral.spin ?? 1.1,
      centerY: spiral.centerY ?? 4,
      delay: spiral.delay ?? index * 0.2,
    },
  }));

/** Two-hit gunships that hold station and put crimson bolts through the gap. */
const lances = (time: number, posts: Array<[number, number]>, lead = 3.2): BroadsideSpawnEntry[] =>
  posts.map(([x, y], index) => ({
    time: time + index * 0.28,
    kind: 'lance',
    hitPoints: 2,
    data: { role: 'lance', lead, x, y, seed: time * 7.3 + index * 2.71 },
  }));

/** Point-defence turrets rooted to the warship belly overhead. */
const turretRank = (time: number, columns: number[], lead = 3.4): BroadsideSpawnEntry[] =>
  columns.map((x, index) => ({
    time: time + index * 0.3,
    kind: 'turret',
    hitPoints: 2,
    data: { role: 'turret', lead, x, seed: time * 5.1 + index * 1.93 },
  }));

/** Flagship escorts: a head-on rush that breaks hard across the canopy. */
const escorts = (
  time: number,
  wing: Array<{ x: number; y: number; breakX: number; breakY: number; delay?: number }>,
  lead = 2.5,
): BroadsideSpawnEntry[] =>
  wing.map((craft, index) => ({
    time: time + index * 0.06,
    kind: 'escort',
    data: {
      role: 'escort',
      lead,
      x: craft.x,
      y: craft.y,
      breakX: craft.breakX,
      breakY: craft.breakY,
      delay: craft.delay ?? index * 0.16,
    },
  }));

// Five shield generators down the flagship's port flank. One lock strips the
// armoured cowl, two more kill the bared coil — so a generator always costs
// two separate releases, which is what makes the flank pass a rhythm problem
// rather than a single sweep.
const GENERATOR_BARS = [16.7, 17.6, 18.5, 19.4, 20.3];
const GENERATOR_HEIGHTS = [-17, 12, -6, 19, -13];

const generators: BroadsideSpawnEntry[] = GENERATOR_BARS.map((barIndex, index) => ({
  time: bar(barIndex),
  kind: 'generator',
  hitStages: [1, 2],
  data: { role: 'generator', index, lead: 3.6, up: GENERATOR_HEIGHTS[index] },
}));

/** Three exposed power systems on the trench floor and walls: shroud, then sphere. */
const CORE_SPECS: Array<{ barIndex: number; right: number; up: number }> = [
  { barIndex: 24.5, right: -15, up: -9 },
  { barIndex: 25.3, right: 16, up: 7 },
  { barIndex: 26.1, right: -4, up: -12 },
];

const cores: BroadsideSpawnEntry[] = CORE_SPECS.map((spec, index) => ({
  time: bar(spec.barIndex),
  kind: 'core',
  hitStages: [3, 3],
  lockable: false, // her shield gates these; see dropShield below
  data: { role: 'core', index, lead: 3.1, right: spec.right, up: spec.up },
}));

export const BROADSIDE_TIMELINE: BroadsideSpawnEntry[] = sortTimeline([
  // --- Deck (bars 0–3). The catapult throws you into it. Two open passes so
  // the sweep is learned before the crossfire closes in.
  ...darts(bar(1.25), [
    { fromX: -46, toX: 46, y: 14, arc: 7 },
    { fromX: 46, toX: -46, y: -8, arc: 6 },
  ]),
  ...darts(bar(2.1), [
    { fromX: -44, toX: 40, y: -14, arc: 8 },
    { fromX: -40, toX: 44, y: 6, arc: 5 },
    { fromX: 44, toX: -40, y: 22, arc: 4 },
  ]),

  // --- Gauntlet (bars 3–8). No neat formation: swarms knotted through the
  // gaps between hulls, gunships anchoring the corners.
  ...darts(bar(3.0), [
    { fromX: -48, toX: 44, y: 24, arc: 5 },
    { fromX: 46, toX: -44, y: 2, arc: 8 },
    { fromX: -46, toX: 46, y: -16, arc: 6 },
    { fromX: 44, toX: -46, y: 13, arc: 5 },
  ]),
  ...corsairs(bar(3.8), [{ phase: 0.2 }, { phase: 2.3 }, { phase: 4.4 }]),
  ...darts(bar(4.5), [
    { fromX: -50, toX: 42, y: -20, arc: 9, crossTime: 1.85 },
    { fromX: -44, toX: 48, y: 0, arc: 6, crossTime: 1.85 },
    { fromX: 48, toX: -44, y: 17, arc: 5, crossTime: 1.85 },
    { fromX: 42, toX: -50, y: 27, arc: 4, crossTime: 1.85 },
    { fromX: -38, toX: 46, y: -6, arc: 7, crossTime: 1.85 },
  ]),
  ...lances(bar(5.3), [[-27, 20], [26, -12]]),
  ...darts(bar(5.9), [
    { fromX: 46, toX: -46, y: -18, arc: 7 },
    { fromX: -46, toX: 46, y: 9, arc: 5 },
    { fromX: 44, toX: -44, y: 25, arc: 4 },
    { fromX: -42, toX: 42, y: -2, arc: 6 },
  ]),
  ...corsairs(bar(6.6), [{ phase: 1.1, centerY: 10 }, { phase: 3.2, centerY: 2 }, { phase: 5.3, centerY: -6 }]),
  ...darts(bar(7.3), [
    { fromX: -52, toX: 46, y: 21, arc: 6, crossTime: 1.8 },
    { fromX: 50, toX: -46, y: -13, arc: 7, crossTime: 1.8 },
    { fromX: -46, toX: 50, y: 3, arc: 5, crossTime: 1.8 },
    { fromX: 46, toX: -50, y: 28, arc: 4, crossTime: 1.8 },
  ]),

  // --- Flank (bars 8–12). Her broadside lights off overhead on the downbeat;
  // the fastest, widest sweeping of the run happens under it.
  ...darts(bar(8.0), [
    { fromX: -54, toX: 48, y: -22, arc: 10, delay: 0, crossTime: 1.75 },
    { fromX: 52, toX: -48, y: -6, arc: 8, delay: 0.18, crossTime: 1.75 },
    { fromX: -50, toX: 52, y: 8, arc: 6, delay: 0.36, crossTime: 1.75 },
    { fromX: 50, toX: -50, y: 22, arc: 5, delay: 0.54, crossTime: 1.75 },
    { fromX: -46, toX: 54, y: 32, arc: 4, delay: 0.72, crossTime: 1.75 },
    { fromX: 48, toX: -52, y: 1, arc: 7, delay: 0.9, crossTime: 1.75 },
  ], 2.5),
  ...corsairs(bar(8.9), [{ phase: 0.6, spin: 1.3 }, { phase: 2.7, spin: 1.3 }, { phase: 4.8, spin: 1.3 }], 2.4),
  ...lances(bar(9.6), [[-30, 24], [29, -16]], 3.0),
  ...darts(bar(10.1), [
    { fromX: 50, toX: -48, y: 27, arc: 5, crossTime: 1.7 },
    { fromX: -48, toX: 50, y: 5, arc: 7, crossTime: 1.7 },
    { fromX: 46, toX: -50, y: -19, arc: 9, crossTime: 1.7 },
    { fromX: -44, toX: 46, y: 16, arc: 5, crossTime: 1.7 },
    { fromX: 44, toX: -46, y: -5, arc: 6, crossTime: 1.7 },
  ], 2.5),
  ...corsairs(bar(10.8), [
    { phase: 0.9, spin: 1.5, centerY: 8 },
    { phase: 2.5, spin: 1.5, centerY: 8 },
    { phase: 4.1, spin: 1.5, centerY: 8 },
    { phase: 5.7, spin: 1.5, centerY: 8 },
  ], 2.1),
  ...darts(bar(11.4), [
    { fromX: -54, toX: 50, y: 30, arc: 5, delay: 0, crossTime: 1.7 },
    { fromX: 52, toX: -50, y: 12, arc: 6, delay: 0.16, crossTime: 1.7 },
    { fromX: -50, toX: 52, y: -6, arc: 8, delay: 0.32, crossTime: 1.7 },
    { fromX: 50, toX: -52, y: -22, arc: 10, delay: 0.48, crossTime: 1.7 },
    { fromX: -46, toX: 48, y: 21, arc: 5, delay: 0.64, crossTime: 1.7 },
    { fromX: 46, toX: -48, y: 2, arc: 7, delay: 0.8, crossTime: 1.7 },
  ], 2.4),

  // --- Belly (bars 12–16). The eye of the battle. The music all but stops;
  // the only targets are her own point defence, and you rake them as you pass.
  ...turretRank(bar(12.3), [-26, 4, 27]),
  ...turretRank(bar(13.3), [18, -14, 32]),
  ...turretRank(bar(14.3), [-31, -8, 12, 30]),
  ...turretRank(bar(15.2), [-20, 8, 26]),
  ...darts(bar(15.4), [
    { fromX: -44, toX: 42, y: -20, arc: 6, crossTime: 2.2 },
    { fromX: 42, toX: -44, y: -26, arc: 5, crossTime: 2.2 },
  ], 3.0),

  // --- Flagship (bars 16–21). Five generators down her flank, point defence
  // filling the space between them. Everything comes from your port side
  // because her hull owns the whole starboard half of the frame.
  ...generators,
  ...lances(bar(17.0), [[-30, 22]], 3.0),
  ...darts(bar(17.8), [
    { fromX: -48, toX: 30, y: 26, arc: 5, crossTime: 2.0 },
    { fromX: -46, toX: 24, y: -18, arc: 7, crossTime: 2.0 },
  ], 2.6),
  ...lances(bar(18.8), [[-32, -18], [-14, 28]], 3.0),
  ...darts(bar(19.7), [
    { fromX: -50, toX: 26, y: 8, arc: 6, crossTime: 2.0 },
    { fromX: -44, toX: 30, y: -24, arc: 8, crossTime: 2.0 },
    { fromX: -46, toX: 22, y: 30, arc: 4, crossTime: 2.0 },
  ], 2.6),
  ...lances(bar(20.4), [[-28, 4]], 2.9),

  // --- Fighters (bars 21–24). The shield is down and her wings launch. Four
  // waves head-on, each breaking harder across the canopy than the last.
  ...escorts(bar(20.6), [
    { x: -14, y: 12, breakX: -50, breakY: 28 },
    { x: 12, y: -10, breakX: 14, breakY: -44 },
    { x: -10, y: -14, breakX: -46, breakY: -30 },
    { x: 14, y: 14, breakX: 12, breakY: 46 },
  ], 2.2),
  ...escorts(bar(21.0), [
    { x: 0, y: 20, breakX: -8, breakY: 48 },
    { x: -18, y: 4, breakX: -52, breakY: 12 },
    { x: 14, y: 2, breakX: 10, breakY: -40 },
    { x: -8, y: -18, breakX: -24, breakY: -48 },
    { x: 10, y: -16, breakX: -30, breakY: -34 },
  ], 2.1),
  ...escorts(bar(21.4), [
    { x: -22, y: 16, breakX: -54, breakY: 34 },
    { x: -8, y: 22, breakX: -16, breakY: 50 },
    { x: 8, y: 21, breakX: 6, breakY: 48 },
    { x: 14, y: 12, breakX: -44, breakY: 20 },
    { x: -16, y: -12, breakX: -50, breakY: -30 },
    { x: 12, y: -14, breakX: 4, breakY: -48 },
  ], 1.9),
  ...escorts(bar(21.75), [
    { x: -12, y: 6, breakX: -48, breakY: 24 },
    { x: -4, y: -20, breakX: -18, breakY: -48 },
    { x: 6, y: -18, breakX: 2, breakY: -46 },
    { x: 2, y: 18, breakX: -6, breakY: 46 },
  ], 1.8),
  // As she rolls under, her dorsal sweeps across the bottom of the frame and
  // the only clear sky is above it. These two wings come over the top of her,
  // silhouetted against the nebula — the one shot available during the
  // come-around, and the reason it is a held breath rather than a dead stretch.
  ...escorts(bar(22.3), [
    { x: -6, y: 15, breakX: -13, breakY: 42 },
    { x: 3, y: 20, breakX: 5, breakY: 46 },
    { x: -2, y: 27, breakX: -9, breakY: 48 },
  ], 1.9),
  ...escorts(bar(22.9), [
    { x: -9, y: 13, breakX: -15, breakY: 33 },
    { x: 8, y: 18, breakX: 13, breakY: 32 },
    { x: -1, y: 24, breakX: -3, breakY: 34 },
  ], 1.9),

  // --- Trench (bars 24–27). Three power systems, and her last runners inside
  // the canyon with you.
  ...darts(bar(24.4), [
    { fromX: -34, toX: 30, y: 18, arc: 4, crossTime: 1.6 },
    { fromX: 32, toX: -32, y: -10, arc: 5, crossTime: 1.6 },
  ], 2.2),
  ...cores,
  ...darts(bar(25.4), [
    { fromX: 30, toX: -30, y: 20, arc: 4, crossTime: 1.6 },
    { fromX: -32, toX: 28, y: -14, arc: 5, crossTime: 1.6 },
  ], 2.2),
  ...corsairs(bar(26.0), [{ phase: 2.0, spin: 1.8, centerY: 0 }, { phase: 5.1, spin: 1.8, centerY: 0 }], 2.0),

  // (bars 27–28: nothing spawns. The pull-out is the payoff.)
]);

export const BROADSIDE_GENERATOR_COUNT = generators.length;

// ---- scoring -------------------------------------------------------------------------

const KILL_SCORE: Record<BroadsideEnemyKind, number> = {
  interceptor: 110,
  corsair: 150,
  lance: 300,
  bolt: 45,
  turret: 260,
  escort: 170,
  generator: 700,
  core: 1400,
};

// The camera covers 30–45 units a second here, so a hostile round has to move
// like one: a slow bolt would simply be overtaken and never arrive. These close
// on the canopy at better than 40 u/s and then brake against it.
const BOLT_MAX_AGE = 7;
const MISS_GRACE = 0.014;

/** A volley against capital armour has to be a broadside — three locks, or it sparks off. */
const CAPITAL_KINDS = new Set<BroadsideEnemyKind>(['generator', 'core']);
const BROADSIDE_MINIMUM = 3;

export function createBroadsideGameplay(bus: EventBus): LockOnRunnerLevel<BroadsideEnemyKind, BroadsideSpawnData> {
  const interceptions = new Set<number>();
  let generatorsDown = 0;
  let coresDown = 0;
  let shieldDown = false;
  let hitsTaken = 0;
  let boltsShot = 0;
  let sparkedOff = 0;

  // The timeline is module-level and reused across runs, so anything the run
  // mutates on an entry has to be put back at the start of the next one.
  const reset = () => {
    interceptions.clear();
    generatorsDown = 0;
    coresDown = 0;
    shieldDown = false;
    hitsTaken = 0;
    boltsShot = 0;
    sparkedOff = 0;
    for (const entry of cores) entry.lockable = false;
  };
  reset();

  bus.on('runstart', reset);
  bus.on('playerhit', () => {
    hitsTaken += 1;
  });
  bus.on('fire', ({ enemyId }) => {
    interceptions.add(enemyId);
  });
  bus.on('kill', ({ enemyId }) => interceptions.delete(enemyId));
  bus.on('miss', ({ enemyId }) => interceptions.delete(enemyId));

  /**
   * The gate between the boss's two phases. Cutting all five generators drops
   * her shield on the spot; if any are still standing when her wings launch it
   * comes down anyway at bar 21, because the run has to reach the trench. The
   * generators are not a pass/fail lock, they are what the rank is made of —
   * see `rankForRun`, where S requires every one of them.
   */
  const SHIELD_FAILSAFE = bar(21);
  const dropShield = () => {
    if (shieldDown) return;
    shieldDown = true;
    for (const entry of cores) entry.lockable = true;
    bus.emit('bossphase', { phase: 'exposed' });
  };

  function fireBolt(context: BroadsideUpdate, from: Vector3, speed = 24) {
    const initial = hostileShotAimPoint(context.camera, from).sub(from).normalize().multiplyScalar(speed);
    context.spawnEnemy({
      time: context.runTime,
      kind: 'bolt',
      countsTowardTotal: false,
      data: { role: 'bolt', position: from.clone(), velocity: initial, lastAge: 0, impact: {} },
    });
  }

  // ---- motion --------------------------------------------------------------------------

  const scratchOffset = new Vector3();

  /** When the camera overtakes this spawn — the moment whose corridor it lives in. */
  const anchorTimeFor = (context: BroadsideUpdate, lead: number) =>
    Math.min(BROADSIDE_DURATION, context.enemy.entry.time + lead);

  /** Swarm dart: a bowed lateral slash across the frame, banking into the turn. */
  function updateInterceptor(context: BroadsideUpdate, data: Extract<BroadsideSpawnData, { role: 'interceptor' }>) {
    const { enemy, runProgress, age, curve, railAnchor } = context;
    const anchorU = railAnchor(data.lead);
    const t = (age - data.delay) / data.crossTime;
    if (t > 1.25 || runProgress > anchorU + MISS_GRACE) return true;
    const clamped = MathUtils.clamp(t, 0, 1);
    const eased = clamped * clamped * (3 - 2 * clamped);
    const anchorTime = anchorTimeFor(context, data.lead);
    const at = (k: number, e: number) => offsetFromRail(curve, anchorU, fitOffset(
      anchorTime,
      MathUtils.lerp(data.fromX, data.toX, e),
      data.y + Math.sin(k * Math.PI) * data.arc,
      MathUtils.lerp(16, -10, e),
      scratchOffset,
    ));
    enemy.mesh.position.copy(at(clamped, eased));
    // Look where it is going, then roll into the crossing — the bank is the read.
    enemy.mesh.lookAt(at(Math.min(1, clamped + 0.06), Math.min(1, eased + 0.06)));
    enemy.mesh.rotateZ((data.toX > data.fromX ? -1 : 1) * (0.7 + Math.sin(clamped * Math.PI) * 0.55));
    return false;
  }

  /** Corsair: a ring-winged craft screwing itself down the flight path at you. */
  function updateCorsair(context: BroadsideUpdate, data: Extract<BroadsideSpawnData, { role: 'corsair' }>) {
    const { enemy, runProgress, age, curve, railAnchor } = context;
    const anchorU = railAnchor(data.lead);
    if (runProgress > anchorU + MISS_GRACE) return true;
    const t = MathUtils.clamp((age - data.delay) / Math.max(0.4, data.lead), 0, 1.3);
    // The helix opens as wide as the corridor allows and tightens as it
    // arrives — a screw, not an orbit. Inside the trench it is a tight spiral;
    // out in the open it sweeps most of the frame.
    const anchorTime = anchorTimeFor(context, data.lead);
    const along = MathUtils.lerp(26, -8, Math.min(1, t));
    const corridor = corridorAt(anchorTime + along / Math.max(1, BASE_UNITS_PER_SECOND * speedFactorAt(anchorTime)));
    const room = Math.min(
      34,
      Math.min(corridor.maxRight - corridor.minRight, corridor.maxUp - corridor.minUp) * 0.46,
    );
    const radius = MathUtils.lerp(room, Math.min(room, 9), Math.min(1, t));
    const angle = data.phase + t * data.spin * Math.PI * 2;
    const centerRight = (corridor.minRight + corridor.maxRight) * 0.5;
    const centerUp = MathUtils.clamp(data.centerY, corridor.minUp + radius * 0.72, corridor.maxUp - radius * 0.72);
    enemy.mesh.position.copy(offsetFromRail(curve, anchorU, fitOffset(
      anchorTime,
      centerRight + Math.cos(angle) * radius,
      centerUp + Math.sin(angle) * radius * 0.72,
      along,
      scratchOffset,
    )));
    enemy.mesh.quaternion.copy(context.camera.quaternion);
    enemy.mesh.rotateZ(-angle * 1.6);
    enemy.mesh.rotateX(0.35);
    return false;
  }

  /** Lance: a heavy gunship that station-keeps and works a firing cadence. */
  function updateLance(context: BroadsideUpdate, data: Extract<BroadsideSpawnData, { role: 'lance' }>) {
    const { enemy, runProgress, age, curve, camera, railAnchor } = context;
    const anchorU = railAnchor(data.lead);
    const state = context.enemyState(() => ({ fireAt: 1.0 + (data.seed % 0.7) }));

    // A slow lateral crab and a heavy nose bob: the silhouette never sits
    // still, but it never leaves its post either.
    enemy.mesh.position.copy(offsetFromRail(curve, anchorU, fitOffset(
      anchorTimeFor(context, data.lead),
      data.x + Math.sin(age * 0.9 + data.seed) * 6.5,
      data.y + Math.cos(age * 0.7 + data.seed * 1.7) * 3.4,
      0,
      scratchOffset,
    )));
    enemy.mesh.lookAt(camera.position);
    enemy.mesh.rotateZ(Math.sin(age * 1.3 + data.seed) * 0.22);

    const untilShot = state.fireAt - age;
    enemy.mesh.userData.charge = untilShot < 0.75 ? MathUtils.clamp(1 - untilShot / 0.75, 0, 1) : 0;
    if (age >= state.fireAt) {
      state.fireAt = age + 3.1;
      fireBolt(context, enemy.mesh.position);
    }
    return runProgress > anchorU + MISS_GRACE;
  }

  /** Hull turret: rooted to the warship belly overhead, tracking you as you pass beneath. */
  function updateTurret(context: BroadsideUpdate, data: Extract<BroadsideSpawnData, { role: 'turret' }>) {
    const { enemy, runProgress, age, curve, camera, railAnchor } = context;
    const anchorU = railAnchor(data.lead);
    const state = context.enemyState(() => ({ fireAt: 1.15 + (data.seed % 1.0) }));
    // No drift at all — it is part of the ship. Only the mount rotates.
    enemy.mesh.position.copy(offsetFromRail(curve, anchorU, scratchOffset.set(data.x, TURRET_MOUNT_UP, 0)));
    enemy.mesh.lookAt(camera.position);

    const untilShot = state.fireAt - age;
    enemy.mesh.userData.charge = untilShot < 0.9 ? MathUtils.clamp(1 - untilShot / 0.9, 0, 1) : 0;
    if (age >= state.fireAt) {
      state.fireAt = age + 3.6;
      fireBolt(context, enemy.mesh.position, 27);
    }
    return runProgress > anchorU + MISS_GRACE;
  }

  /** Escort fighter: a head-on rush that snaps into a break turn across the canopy. */
  function updateEscort(context: BroadsideUpdate, data: Extract<BroadsideSpawnData, { role: 'escort' }>) {
    const { enemy, runProgress, age, curve, railAnchor } = context;
    const anchorU = railAnchor(data.lead);
    if (runProgress > anchorU + MISS_GRACE) return true;
    const t = (age - data.delay) / data.lead;
    if (t > 1.3) return true;
    const clamped = MathUtils.clamp(t, 0, 1.2);
    // Hold the run in, then break: the last third of the approach is all turn.
    const breakT = MathUtils.clamp((clamped - 0.62) / 0.5, 0, 1);
    const snap = breakT * breakT;
    enemy.mesh.position.copy(offsetFromRail(curve, anchorU, fitOffset(
      anchorTimeFor(context, data.lead),
      MathUtils.lerp(data.x, data.breakX, snap),
      MathUtils.lerp(data.y, data.breakY, snap),
      MathUtils.lerp(22, -12, Math.min(1, clamped)),
      scratchOffset,
    )));
    enemy.mesh.quaternion.copy(context.camera.quaternion);
    enemy.mesh.rotateZ(Math.atan2(data.breakY - data.y, data.breakX - data.x) * snap * 0.9);
    enemy.mesh.userData.breaking = breakT;
    return false;
  }

  /** Shield generator: bolted to the flagship's port flank, standing proud of her plating. */
  function updateGenerator(context: BroadsideUpdate, data: Extract<BroadsideSpawnData, { role: 'generator' }>) {
    const { enemy, runProgress, age, curve, railAnchor } = context;
    const anchorU = railAnchor(data.lead);
    enemy.mesh.position.copy(offsetFromRail(curve, anchorU, scratchOffset.set(GENERATOR_MOUNT_RIGHT, data.up, 0)));
    // Rigid mount, spinning coil: the ship is fixed, the machinery is not.
    enemy.mesh.lookAt(offsetFromRail(curve, MathUtils.clamp(anchorU + 0.004, 0, 1), scratchOffset.set(GENERATOR_MOUNT_RIGHT, data.up, 0)));
    enemy.mesh.userData.coilSpin = age;
    enemy.mesh.userData.stage = enemy.hitStageIndex;
    return runProgress > anchorU + MISS_GRACE;
  }

  /** Power core: exposed machinery on the trench floor and walls. */
  function updateCore(context: BroadsideUpdate, data: Extract<BroadsideSpawnData, { role: 'core' }>) {
    const { enemy, runProgress, age, curve, railAnchor } = context;
    const anchorU = railAnchor(data.lead);
    enemy.mesh.position.copy(offsetFromRail(curve, anchorU, scratchOffset.set(data.right, data.up, 0)));
    enemy.mesh.lookAt(offsetFromRail(curve, MathUtils.clamp(anchorU + 0.004, 0, 1), scratchOffset.set(data.right, data.up, 0)));
    enemy.mesh.userData.coilSpin = age;
    enemy.mesh.userData.stage = enemy.hitStageIndex;
    enemy.mesh.userData.shielded = !shieldDown;
    return runProgress > anchorU + MISS_GRACE;
  }

  /** Crimson point-defence bolt: interceptable, and it brakes visibly on the canopy. */
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
    });
    if (impact.phase === 'braking') {
      enemy.mesh.position.copy(data.position);
      enemy.mesh.quaternion.copy(camera.quaternion);
      enemy.mesh.rotateZ(age * 7);
      if (impact.damaged) {
        damagePlayer(1);
        return true;
      }
      return false;
    }

    steerHomingShot(data.position, data.velocity, hostileShotAimPoint(camera, data.position), age, dt, {
      baseSpeed: 27,
      maxSpeed: 50,
      accel: 16,
      turnRate: 3.6,
    });
    enemy.mesh.position.copy(data.position);
    if (data.velocity.lengthSq() > 0.001) enemy.mesh.lookAt(data.position.clone().add(data.velocity));
    return age > BOLT_MAX_AGE || shotBehindCamera(camera, data.position);
  }

  // ---- level ------------------------------------------------------------------------------

  return {
    duration: BROADSIDE_DURATION,
    bpm: BROADSIDE_BPM,
    playerHealth: BROADSIDE_PLAYER_HEALTH,
    createRail: createBroadsideRail,
    spawnTimeline: BROADSIDE_TIMELINE,
    easeRunProgress: broadsideRunProgress,
    startWord: 'SORTIE',
    replayWord: 'AGAIN',
    // The engine default caps the coarsest shot gap at a bar; at 112 BPM that
    // would trail a six-lock volley across most of a phrase. Capping at the
    // eighth note (0.268 s here) keeps a full broadside inside half a bar, so
    // the kill line reads as one melodic flourish instead of a slow drip.
    timing: { shotDelay: { maxGridSeconds: 0.28 } },

    updateEnemy(context) {
      if (!shieldDown && context.runTime >= SHIELD_FAILSAFE) dropShield();
      const data = context.enemy.entry.data;
      switch (data.role) {
        case 'interceptor':
          return updateInterceptor(context, data);
        case 'corsair':
          return updateCorsair(context, data);
        case 'lance':
          return updateLance(context, data);
        case 'turret':
          return updateTurret(context, data);
        case 'escort':
          return updateEscort(context, data);
        case 'generator':
          return updateGenerator(context, data);
        case 'core':
          return updateCore(context, data);
        case 'bolt':
          return updateBolt(context, data);
      }
    },

    // Capital armour shrugs off anything short of a broadside. Small targets in
    // the same release still fire, so intercepting a bolt never costs you the
    // shot — you just do not chip a generator with two locks.
    validateRelease(enemies: Array<LockOnEnemy<BroadsideEnemyKind, BroadsideSpawnData>>) {
      if (enemies.length >= BROADSIDE_MINIMUM) return true;
      const allowed = enemies.filter((enemy) => !CAPITAL_KINDS.has(enemy.kind));
      if (allowed.length === enemies.length) return true;
      sparkedOff += enemies.length - allowed.length;
      return allowed;
    },

    scoreForKill(volleySize, enemy) {
      if (enemy.kind === 'bolt') boltsShot += 1;
      if (enemy.kind === 'generator') {
        generatorsDown += 1;
        if (generatorsDown >= generators.length) dropShield();
      }
      if (enemy.kind === 'core') {
        coresDown += 1;
        if (coresDown >= cores.length) bus.emit('bossphase', { phase: 'destroyed' });
      }
      const multiplier = 1 + Math.max(0, volleySize - 1) * 0.2;
      return Math.round(KILL_SCORE[enemy.kind] * multiplier);
    },

    // Chipping armour pays; the flagship's own plating pays more.
    scoreForHit(_volleySize, enemy) {
      return CAPITAL_KINDS.has(enemy.kind) ? 120 : 50;
    },

    // FULL BROADSIDE: six locks, six kills, one release.
    scoreForVolley(results) {
      if (results.length < 4 || !results.every((result) => result.killed)) return 0;
      return results.length === 6 ? 900 : results.length * 90;
    },

    rankForRun(score, kills, totalEnemies) {
      const clearRate = totalEnemies === 0 ? 0 : kills / totalEnemies;
      // The top two ranks are gated on the flagship actually breaking: you can
      // score well flying past her, but the engagement is only won in the trench.
      const flagshipDown = coresDown >= cores.length;
      if (flagshipDown && generatorsDown >= generators.length && score >= 28000 && clearRate >= 0.9) return 'S';
      if (flagshipDown && score >= 20000 && clearRate >= 0.68) return 'A';
      if (score >= 12000 && clearRate >= 0.48) return 'B';
      if (score >= 5500 && clearRate >= 0.24) return 'C';
      return 'D';
    },

    detailsForRun() {
      const hull = Math.max(0, BROADSIDE_PLAYER_HEALTH - hitsTaken);
      const lines = [`Hull ${hull}/${BROADSIDE_PLAYER_HEALTH}`];
      lines.push(`Shield generators ${generatorsDown}/${generators.length}`);
      if (boltsShot > 0) lines.push(`${boltsShot} incoming round${boltsShot === 1 ? '' : 's'} shot down`);
      if (sparkedOff > 0) lines.push(`${sparkedOff} light shot${sparkedOff === 1 ? '' : 's'} sparked off capital armour`);
      lines.push(coresDown >= cores.length
        ? 'Enemy flagship destroyed — the line breaks'
        : `Power cores ${coresDown}/${cores.length} — she is still under way`);
      return lines;
    },
  };
}
