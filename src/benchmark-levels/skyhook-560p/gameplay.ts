import { CatmullRomCurve3, MathUtils, Vector3 } from 'three';
import {
  hostileShotAimPoint,
  shotBehindCamera,
  steerHomingShot,
  updateHostileShotImpact,
  type HostileShotImpactState,
} from '../../engine/hostile-shot';
import type { LockOnEnemyUpdate, LockOnRunnerLevel, LockOnSpawnEntry } from '../../engine/lock-on-runner';
import { sortTimeline } from '../../engine/spawn-patterns';
import { createSpeedProfile } from '../../engine/speed-profile';
import type { EventBus } from '../../events';
import { createDescender, createDescenderEntries } from './descender';
import {
  DESCENDER_DEADLINE_TIME,
  DESCENDER_TIME,
  DOCK_TIME,
  SKYHOOK_BPM,
  SKYHOOK_DURATION,
  bar,
} from './timing';

// SKYHOOK — sixty seconds of a climber car running up a space-elevator tether,
// scored to 40 bars at 160 BPM (one bar = 1.5 s exactly):
//
//   Weather   (bars 0–7,   0–12 s)  Storm deck. Thick air, wind-riding kites.
//   Deck      (bars 8–15, 12–24 s)  Punch through the cloud floor into sunlight.
//   Thin      (bars 16–23, 24–36 s) Air runs out. Vacuum hardware, falling debris.
//   Descender (bars 24–35, 36–54 s) The thing on the tether climbs down at you.
//   Dock      (bars 36–39, 54–60 s) The station swallows the car. Everything stops.
//
// The camera flies UP. World +Y is altitude and the camera's up vector is world
// +Z (set in index.ts), so the tether recedes to a vanishing point dead ahead
// and everything else falls past the frame. Because the rail is near-vertical
// the shared rail frame in `src/engine/rail.ts` would be degenerate here, so
// this level places everything with the fixed climb basis below instead.

export { SKYHOOK_BPM, SKYHOOK_DURATION } from './timing';

export const SKYHOOK_PLAYER_HEALTH = 5;

/** Total height of the ascent in world units. */
export const CLIMB_HEIGHT = 1150;

/** Fixed climb basis: +Y is up the tether (camera forward), +X/+Z are screen right/up. */
export const CLIMB_AXIS = new Vector3(0, 1, 0);
export const CLIMB_RIGHT = new Vector3(1, 0, 0);
export const CLIMB_UP = new Vector3(0, 0, 1);

export type SkyhookEnemyKind =
  | 'kite'
  | 'ballast'
  | 'latcher'
  | 'sentry'
  | 'shard'
  | 'slug'
  | 'clamp'
  | 'core';

export type SkyhookSpawnData =
  | { role: 'kite'; lead: number; fromX: number; toX: number; y: number; arc: number; delay: number; crossTime: number }
  | { role: 'ballast'; lead: number; x: number; y: number; spin: number }
  | { role: 'latcher'; lead: number; fromX: number; fromY: number; slot: number; closeTime: number }
  | { role: 'sentry'; lead: number; x: number; y: number; seed: number; firstShot: number; period: number }
  | { role: 'shard'; lead: number; x: number; y: number; fall: number; spin: number }
  | { role: 'slug'; position: Vector3; velocity: Vector3; lastAge: number; impact: HostileShotImpactState }
  | { role: 'clamp'; socket: number }
  | { role: 'core' };

export type SkyhookSpawnEntry = LockOnSpawnEntry<SkyhookEnemyKind, SkyhookSpawnData>;
export type SkyhookUpdate = LockOnEnemyUpdate<SkyhookEnemyKind, SkyhookSpawnData>;

// ---- speed profile → rail easing --------------------------------------------

// The climb accelerates as the air thins and brakes hard into the dock. The
// spike at bar 8 is the cloud-deck punch; the long fade after bar 36 is the
// station catching the car.
const SPEED_KEYS: Array<[number, number]> = [
  [bar(0), 0.6],
  [bar(4), 0.9],
  [bar(7.5), 1.0],
  [bar(8), 1.62],
  [bar(9.5), 1.12],
  [bar(16), 1.2],
  [bar(20), 1.32],
  [bar(24), 1.24],
  [bar(30), 1.36],
  [bar(34.5), 1.5],
  [bar(36), 1.0],
  [bar(37.5), 0.4],
  [bar(38.8), 0.1],
  [bar(40), 0.03],
];

const speedProfile = createSpeedProfile(SPEED_KEYS, SKYHOOK_DURATION);

export const speedFactorAt = speedProfile.speedAt;

export function skyhookRunProgress(time: number, duration = SKYHOOK_DURATION) {
  return speedProfile.runProgress(time, duration);
}

/** Rail parameter the camera occupies at run time `t` — for seating set pieces. */
export const railU = (time: number) => skyhookRunProgress(time);

// ---- rail --------------------------------------------------------------------

// A near-vertical climb with a lazy 75° drift around the tether's axis, so the
// world creeps sideways over the minute instead of sitting perfectly still.
export function createSkyhookRail() {
  const points: Vector3[] = [];
  const samples = 24;
  for (let i = 0; i <= samples; i += 1) {
    const t = i / samples;
    const angle = 0.42 + t * 1.32;
    points.push(new Vector3(
      Math.sin(angle) * 24 - Math.sin(0.42) * 24,
      t * CLIMB_HEIGHT,
      Math.cos(angle) * 24 - Math.cos(0.42) * 24,
    ));
  }
  return new CatmullRomCurve3(points, false, 'catmullrom', 0.5);
}

/** Place a point `x` screen-right, `y` screen-up and `z` further up the tether from rail parameter `u`. */
export function climbOffset(curve: CatmullRomCurve3, u: number, x: number, y: number, z = 0) {
  return curve.getPointAt(MathUtils.clamp(u, 0, 1))
    .addScaledVector(CLIMB_RIGHT, x)
    .addScaledVector(CLIMB_UP, y)
    .addScaledVector(CLIMB_AXIS, z);
}

/** How much rail parameter one world unit of climb is worth. */
const U_PER_UNIT = 1 / CLIMB_HEIGHT;

// The ribbon runs past the car's lower-left shoulder, so it leaves the frame
// through the bottom-left corner and converges on the vanishing point ahead:
// the read is a cable dropping away beneath you, not a wire strung sideways.
// Visuals and gameplay both place against these numbers.
export const TETHER_OFFSET_X = -3.6;
export const TETHER_OFFSET_Y = -6.4;

// ---- spawn timeline ------------------------------------------------------------

const MISS_GRACE = 0.012;

type KiteRun = { fromX: number; toX: number; y: number; arc: number; delay?: number; crossTime?: number };

const kites = (time: number, lead: number, runs: KiteRun[]): SkyhookSpawnEntry[] =>
  runs.map((run, index) => ({
    time: time + index * 0.09,
    kind: 'kite',
    data: {
      role: 'kite',
      lead,
      fromX: run.fromX,
      toX: run.toX,
      y: run.y,
      arc: run.arc,
      delay: run.delay ?? index * 0.3,
      crossTime: run.crossTime ?? 2.5,
    },
  }));

const ballast = (
  time: number,
  lead: number,
  spin: number,
  offsets: Array<[number, number]>,
  hitPoints = 1,
): SkyhookSpawnEntry[] =>
  offsets.map((offset, index) => ({
    time: time + index * 0.11,
    kind: 'ballast',
    hitPoints,
    data: { role: 'ballast', lead, x: offset[0], y: offset[1], spin },
  }));

const latchers = (time: number, entries: Array<[number, number, number]>): SkyhookSpawnEntry[] =>
  entries.map(([fromX, fromY, slot], index) => ({
    time: time + index * 0.26,
    kind: 'latcher',
    hitPoints: 2,
    data: { role: 'latcher', lead: 4.2, fromX, fromY, slot, closeTime: 4.6 },
  }));

const sentries = (time: number, lead: number, entries: Array<[number, number]>, period = 3.0): SkyhookSpawnEntry[] =>
  entries.map(([x, y], index) => ({
    time: time + index * 0.22,
    kind: 'sentry',
    hitPoints: 2,
    data: { role: 'sentry', lead, x, y, seed: time * 1.7 + index * 2.3, firstShot: 1.5 + index * 0.35, period },
  }));

const shards = (time: number, lead: number, entries: Array<[number, number, number]>): SkyhookSpawnEntry[] =>
  entries.map(([x, y, fall], index) => ({
    time: time + index * 0.13,
    kind: 'shard',
    data: { role: 'shard', lead, x, y, fall, spin: 3 + (index % 3) * 1.4 },
  }));

function buildSkyhookTimeline(descenderEntries: SkyhookSpawnEntry[]): SkyhookSpawnEntry[] {
  return [
    // --- Weather: thick air, wide formations, learn the sweep. ------------------
    ...ballast(bar(1), 3.39, 0.3, [[-26, 8], [-9, 15], [9, 15], [26, 8]]),
    ...kites(bar(2.5), 3.13, [
      { fromX: -42, toX: 42, y: 2, arc: 9 },
      { fromX: -42, toX: 42, y: -9, arc: 12 },
      { fromX: -42, toX: 42, y: 12, arc: 5 },
    ]),
    ...ballast(bar(4), 3.39, -0.26, [[-30, -4], [-15, 6], [0, 14], [15, 6], [30, -4]]),
    ...kites(bar(5), 3.13, [
      { fromX: -44, toX: 44, y: 6, arc: 8 },
      { fromX: 44, toX: -44, y: -6, arc: 10 },
      { fromX: -44, toX: 44, y: 16, arc: 4 },
      { fromX: 44, toX: -44, y: -12, arc: 6 },
    ]),
    ...ballast(bar(6), 3.31, 0.36, [[-32, 4], [-19, 12], [-6, 17], [6, 17], [19, 12], [32, 4]]),
    ...kites(bar(7), 2.96, [
      { fromX: -40, toX: 40, y: -2, arc: 11, crossTime: 2.1 },
      { fromX: 40, toX: -40, y: 10, arc: -8, crossTime: 2.1 },
    ]),

    // (bars 7.6–8.4: screen kept clear so the cloud-deck punch reads)

    // --- Deck: sunlight, top speed, and the first things that want the car. -----
    ...kites(bar(8.6), 2.96, [
      { fromX: -8, toX: -44, y: 4, arc: 10, crossTime: 2.0, delay: 0 },
      { fromX: 8, toX: 44, y: 4, arc: 10, crossTime: 2.0, delay: 0 },
      { fromX: -6, toX: -38, y: -10, arc: -7, crossTime: 2.0, delay: 0.28 },
      { fromX: 6, toX: 38, y: -10, arc: -7, crossTime: 2.0, delay: 0.28 },
    ]),
    ...ballast(bar(9.5), 3.22, 0.4, [[-28, 10], [-14, 17], [0, 20], [14, 17], [28, 10]]),
    ...latchers(bar(10.5), [[-30, 14, 0]]),
    ...kites(bar(11), 2.96, [
      { fromX: -44, toX: 44, y: 13, arc: 5, crossTime: 2.2 },
      { fromX: 44, toX: -44, y: 0, arc: 9, crossTime: 2.2 },
      { fromX: -44, toX: 44, y: -13, arc: 6, crossTime: 2.2 },
    ]),
    ...ballast(bar(12), 3.22, -0.44, [[-34, 0], [-20, 9], [-7, 15], [7, 15], [20, 9], [34, 0]]),
    ...latchers(bar(13), [[34, 10, 1], [-34, -6, 2]]),
    ...kites(bar(13.5), 2.87, [
      { fromX: -46, toX: 46, y: 8, arc: 7, crossTime: 2.1, delay: 0 },
      { fromX: 46, toX: -46, y: -4, arc: -9, crossTime: 2.1, delay: 0.24 },
      { fromX: -46, toX: 46, y: -13, arc: 5, crossTime: 2.1, delay: 0.48 },
      { fromX: 46, toX: -46, y: 18, arc: -4, crossTime: 2.1, delay: 0.72 },
    ]),
    ...ballast(bar(14.5), 3.13, 0.5, [[-24, -8], [-10, -12.5], [10, -12.5], [24, -8]], 2),
    ...kites(bar(15), 2.78, [
      { fromX: -42, toX: 42, y: 15, arc: 4, crossTime: 1.9 },
      { fromX: 42, toX: -42, y: -2, arc: 8, crossTime: 1.9 },
      { fromX: -42, toX: 42, y: -12.5, arc: 5, crossTime: 1.9 },
    ]),

    // --- Thin: no wind left. Hardware holds station and debris falls past. ------
    ...sentries(bar(16), 3.39, [[-30, 6], [30, 6]]),
    ...shards(bar(16.6), 3.13, [[-36, 18, 16], [-12, 20, 22], [14, 19, 18], [37, 17, 14]]),
    ...ballast(bar(17.6), 3.13, 0.32, [[-30, -6], [-16, 3], [0, 9], [16, 3], [30, -6]], 2),
    ...sentries(bar(18.4), 3.31, [[0, 17]]),
    ...shards(bar(18.8), 3.04, [[-40, 16, 20], [-20, 20, 15], [24, 18, 24]]),
    ...latchers(bar(19.4), [[-36, 8, 0], [36, 12, 3]]),
    ...shards(bar(20), 2.96, [[-42, 20, 26], [-24, 18, 19], [-4, 21, 23], [20, 19, 17], [40, 17, 25]]),
    ...sentries(bar(21), 3.22, [[-26, -10], [26, -10]]),
    ...ballast(bar(21.6), 3.04, -0.4, [[-32, 12], [-11, 19], [11, 19], [32, 12]], 2),
    ...shards(bar(22.2), 2.87, [[-34, 19, 21], [-8, 21, 27], [16, 18, 18], [38, 20, 23]]),
    ...latchers(bar(22.7), [[30, -10, 1]]),

    // (bar 23: cleared for the reveal — the Descender is already a speck above)

    // --- Descender: the boss owns the sky; everything else is its wake. ---------
    ...descenderEntries,
    ...shards(bar(26), 2.87, [[-38, 18, 22], [-6, 21, 26], [32, 17, 20]]),
    ...latchers(bar(27.4), [[-34, 6, 2], [34, 4, 3]]),
    ...shards(bar(29), 2.78, [[-40, 19, 25], [-16, 21, 20], [12, 20, 28], [36, 18, 22]]),
    ...sentries(bar(30.5), 3.04, [[-28, -12], [28, -12]], 2.2),
    ...shards(bar(32), 2.70, [[-42, 20, 27], [-22, 18, 22], [0, 22, 30], [22, 19, 24], [42, 17, 26]]),
    ...shards(bar(33.8), 2.61, [[-30, 20, 26], [4, 21, 30], [30, 19, 24]]),
  ];
}

const KILL_SCORE: Record<SkyhookEnemyKind, number> = {
  kite: 110,
  ballast: 140,
  latcher: 280,
  sentry: 200,
  shard: 160,
  slug: 45,
  clamp: 430,
  core: 2600,
};

const SLUG_MAX_AGE = 11;
const LATCHER_MAX_ATTACHED = 4.0;
const LATCHER_FIRST_BITE = 2.6;
const LATCHER_BITE_PERIOD = 3.4;
/** Camera-relative clamp berths along the bottom lip of the climber's cowl. */
const LATCHER_SLOT_X = [-3.0, -1.0, 1.0, 3.0];
const LATCHER_CLAMP_FORWARD = 6.6;
const LATCHER_CLAMP_DOWN = -3.05;

export function createSkyhookTimeline() {
  const descender = createDescenderEntries(DESCENDER_TIME);
  return {
    coreEntry: descender.coreEntry,
    armEntries: descender.armEntries,
    timeline: sortTimeline(buildSkyhookTimeline(descender.timeline)),
  };
}

export const SKYHOOK_TIMELINE: SkyhookSpawnEntry[] = createSkyhookTimeline().timeline;

export function createSkyhookGameplay(bus: EventBus): LockOnRunnerLevel<SkyhookEnemyKind, SkyhookSpawnData> {
  const { timeline, coreEntry, armEntries } = createSkyhookTimeline();

  const interceptions = new Set<number>();
  let hitsTaken = 0;
  let latchersPried = 0;
  let slugsIntercepted = 0;

  bus.on('runstart', () => {
    interceptions.clear();
    hitsTaken = 0;
    latchersPried = 0;
    slugsIntercepted = 0;
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

  const descender = createDescender(bus, {
    coreEntry,
    armEntries,
    deadlineTime: DESCENDER_DEADLINE_TIME,
    dockTime: DOCK_TIME,
  });

  // ---- shared helpers ---------------------------------------------------------

  const cameraRight = new Vector3();
  const cameraUp = new Vector3();
  const cameraForward = new Vector3();

  /** The berth a latcher clamps onto, in world space, recomputed every frame. */
  function clampBerth(context: SkyhookUpdate, slot: number, target: Vector3) {
    const { camera } = context;
    cameraRight.setFromMatrixColumn(camera.matrixWorld, 0).normalize();
    cameraUp.setFromMatrixColumn(camera.matrixWorld, 1).normalize();
    camera.getWorldDirection(cameraForward);
    return target.copy(camera.position)
      .addScaledVector(cameraForward, LATCHER_CLAMP_FORWARD)
      .addScaledVector(cameraRight, LATCHER_SLOT_X[slot % LATCHER_SLOT_X.length])
      .addScaledVector(cameraUp, LATCHER_CLAMP_DOWN);
  }

  function fireSlug(context: SkyhookUpdate, from: Vector3) {
    const initial = hostileShotAimPoint(context.camera, from).sub(from).normalize().multiplyScalar(6);
    context.spawnEnemy({
      time: context.runTime,
      kind: 'slug',
      countsTowardTotal: false,
      data: { role: 'slug', position: from.clone(), velocity: initial, lastAge: 0, impact: {} },
    });
  }

  function faceCamera(context: SkyhookUpdate) {
    context.enemy.mesh.quaternion.copy(context.camera.quaternion);
  }

  // ---- movement ----------------------------------------------------------------

  // Kites ride the wind: a long lateral crossing bowed by an updraft, nosing
  // into the direction of travel so their streamers trail behind.
  function updateKite(context: SkyhookUpdate, data: Extract<SkyhookSpawnData, { role: 'kite' }>) {
    const { enemy, runProgress, age, curve, railAnchor } = context;
    const anchorU = railAnchor(data.lead);
    const t = (age - data.delay) / data.crossTime;
    if (t > 1.2 || runProgress > anchorU + MISS_GRACE) return true;
    const clamped = MathUtils.clamp(t, 0, 1);
    const eased = clamped * clamped * (3 - 2 * clamped);
    const y = data.y + Math.sin(clamped * Math.PI) * data.arc;
    enemy.mesh.position.copy(climbOffset(
      curve,
      anchorU,
      MathUtils.lerp(data.fromX, data.toX, eased),
      y,
      Math.sin(age * 2.6 + enemy.id) * 1.2,
    ));
    const nextClamped = Math.min(1, clamped + 0.05);
    const nextEased = nextClamped * nextClamped * (3 - 2 * nextClamped);
    enemy.mesh.lookAt(climbOffset(
      curve,
      anchorU,
      MathUtils.lerp(data.fromX, data.toX, nextEased),
      data.y + Math.sin(nextClamped * Math.PI) * data.arc,
    ));
    enemy.mesh.rotateZ(Math.sin(age * 5.5 + enemy.id) * 0.42);
    return false;
  }

  // Ballast pods hang off the tether in formations that wheel slowly around the
  // climb axis — the level's readable, sweepable wall.
  function updateBallast(context: SkyhookUpdate, data: Extract<SkyhookSpawnData, { role: 'ballast' }>) {
    const { enemy, runProgress, age, curve, railAnchor } = context;
    const anchorU = railAnchor(data.lead);
    const angle = age * data.spin;
    const breathe = 1 + Math.sin(age * 1.1 + enemy.id) * 0.05;
    enemy.mesh.position.copy(climbOffset(
      curve,
      anchorU,
      (data.x * Math.cos(angle) - data.y * Math.sin(angle)) * breathe,
      (data.x * Math.sin(angle) + data.y * Math.cos(angle)) * breathe,
    ));
    faceCamera(context);
    enemy.mesh.rotateZ(age * (0.35 + (enemy.id % 5) * 0.09) + enemy.id);
    enemy.mesh.rotateX(Math.sin(age * 0.8 + enemy.id) * 0.4);
    return runProgress > anchorU + MISS_GRACE;
  }

  // Latchers ignore the player entirely: they converge on the car, clamp onto
  // the cowl lip and start cutting. Attached ones stay lockable along the
  // bottom of the frame until they are pried off.
  function updateLatcher(context: SkyhookUpdate, data: Extract<SkyhookSpawnData, { role: 'latcher' }>) {
    const { enemy, age, curve, railAnchor, damagePlayer } = context;
    const state = context.enemyState(() => ({ attached: false, nextBite: 0, berth: new Vector3() }));
    const berth = clampBerth(context, data.slot, state.berth);

    if (age < data.closeTime) {
      const approach = climbOffset(curve, railAnchor(data.lead), data.fromX, data.fromY);
      // Slow drift, then a fast final grab.
      const eased = (age / data.closeTime) ** 2.4;
      enemy.mesh.position.copy(approach).lerp(berth, eased);
      enemy.mesh.lookAt(context.camera.position);
      enemy.mesh.rotateZ(Math.sin(age * 3.4 + enemy.id) * 0.5 * (1 - eased));
      enemy.mesh.userData.clampProgress = eased;
      return false;
    }

    if (!state.attached) {
      state.attached = true;
      state.nextBite = age + LATCHER_FIRST_BITE;
      enemy.mesh.userData.clamped = true;
    }
    enemy.mesh.position.copy(berth);
    enemy.mesh.quaternion.copy(context.camera.quaternion);
    enemy.mesh.rotateZ(Math.PI + Math.sin(age * 15) * 0.06);
    enemy.mesh.userData.clampProgress = 1;
    enemy.mesh.userData.biteCharge = MathUtils.clamp(1 - (state.nextBite - age) / 0.6, 0, 1);

    if (age >= state.nextBite) {
      state.nextBite = age + LATCHER_BITE_PERIOD;
      damagePlayer(1);
    }
    // Nine seconds of cutting and it tears a panel free and drops away with it.
    return age > data.closeTime + LATCHER_MAX_ATTACHED;
  }

  // Sentries are vacuum hardware: they hold station off the tether, track the
  // car and spit homing slugs, rearing up the tether on the wind-up.
  function updateSentry(context: SkyhookUpdate, data: Extract<SkyhookSpawnData, { role: 'sentry' }>) {
    const { enemy, runProgress, age, curve, railAnchor } = context;
    const anchorU = railAnchor(data.lead);
    const fire = context.enemyState(() => ({ nextAt: data.firstShot }));
    const untilShot = fire.nextAt - age;
    let z = 0;
    if (untilShot < 0.75 && untilShot > 0.4) z = (0.75 - untilShot) * 14;
    else if (untilShot <= 0.4 && untilShot > 0) z = -(0.4 - untilShot) * 22;
    if (age >= fire.nextAt) {
      fire.nextAt = age + data.period;
      fireSlug(context, enemy.mesh.position);
    }
    enemy.mesh.userData.charge = MathUtils.clamp(1 - untilShot / 0.75, 0, 1);

    enemy.mesh.position.copy(climbOffset(
      curve,
      anchorU,
      data.x + Math.sin(age * 0.9 + data.seed) * 3.2,
      data.y + Math.sin(age * 1.35 + data.seed * 1.7) * 2.4,
      z,
    ));
    enemy.mesh.lookAt(context.camera.position);
    enemy.mesh.rotateZ(Math.sin(age * 1.6 + data.seed) * 0.3);
    return runProgress > anchorU + MISS_GRACE;
  }

  // Shards are the tether's own shed ice and paint falling planetward while the
  // car climbs, so they close at roughly double the camera's speed and streak
  // out of the vanishing point past the frame.
  function updateShard(context: SkyhookUpdate, data: Extract<SkyhookSpawnData, { role: 'shard' }>) {
    const { enemy, runProgress, age, curve, railAnchor } = context;
    const anchorU = railAnchor(data.lead) - data.fall * age * U_PER_UNIT;
    if (runProgress > anchorU + MISS_GRACE) return true;
    enemy.mesh.position.copy(climbOffset(
      curve,
      anchorU,
      data.x + Math.sin(age * 1.4 + enemy.id) * 2.2,
      data.y + Math.cos(age * 1.1 + enemy.id) * 1.6,
    ));
    faceCamera(context);
    enemy.mesh.rotateZ(age * data.spin + enemy.id);
    enemy.mesh.rotateX(age * data.spin * 0.6);
    return false;
  }

  function updateSlug(context: SkyhookUpdate, data: Extract<SkyhookSpawnData, { role: 'slug' }>) {
    const { enemy, age, camera, damagePlayer } = context;
    const dt = Math.max(0, age - data.lastAge);
    data.lastAge = age;

    const intercepted = interceptions.delete(enemy.id);
    if (intercepted) slugsIntercepted += 1;
    const impact = updateHostileShotImpact({
      age,
      camera,
      position: data.position,
      velocity: data.velocity,
      state: data.impact,
      intercepted,
      config: { hitDistance: 2.6, impactBrake: 0.4, damageDistance: 0.7 },
    });
    if (impact.phase === 'braking') {
      enemy.mesh.position.copy(data.position);
      faceCamera(context);
      enemy.mesh.rotateZ(age * 11);
      if (impact.damaged) {
        damagePlayer(1);
        return true;
      }
      return false;
    }

    steerHomingShot(data.position, data.velocity, hostileShotAimPoint(camera, data.position), age, dt, {
      baseSpeed: 6.5,
      maxSpeed: 15,
      accel: 3.2,
      turnRate: 2.2,
    });
    enemy.mesh.position.copy(data.position);
    if (data.velocity.lengthSq() > 0.0001) enemy.mesh.lookAt(data.position.clone().add(data.velocity));
    return age > SLUG_MAX_AGE || shotBehindCamera(camera, data.position);
  }

  // ---- level definition ---------------------------------------------------------

  return {
    duration: SKYHOOK_DURATION,
    bpm: SKYHOOK_BPM,
    playerHealth: SKYHOOK_PLAYER_HEALTH,
    createRail: createSkyhookRail,
    spawnTimeline: timeline,
    easeRunProgress: skyhookRunProgress,
    startWord: 'CLIMB',
    replayWord: 'RERIDE',
    // The climb is fast and the whole frame is in play; a slightly wider lock
    // radius keeps sweeping the far corners honest without making it automatic.
    lockRadiusNdc: 0.095,
    timing: {
      // 160 BPM, one bar = 1.5 s. Cap the coarse end of the shot-gap ramp at an
      // eighth note so a six-lock volley ripples out inside a single bar.
      shotDelay: { maxGridSeconds: 0.38 },
    },
    updateEnemy(context) {
      const data = context.enemy.entry.data;
      switch (data.role) {
        case 'kite':
          return updateKite(context, data);
        case 'ballast':
          return updateBallast(context, data);
        case 'latcher':
          return updateLatcher(context, data);
        case 'sentry':
          return updateSentry(context, data);
        case 'shard':
          return updateShard(context, data);
        case 'slug':
          return updateSlug(context, data);
        case 'clamp':
          return descender.updateClamp(context, data);
        case 'core':
          return descender.updateCore(context, data);
      }
    },
    scoreForKill(volleySize, enemy) {
      if (enemy.kind === 'latcher') latchersPried += 1;
      const multiplier = 1 + Math.max(0, volleySize - 1) * 0.2;
      return Math.round(KILL_SCORE[enemy.kind] * multiplier);
    },
    scoreForHit: () => 50,
    scoreForVolley(results) {
      if (results.length < 4) return 0;
      if (!results.every((result) => result.killed)) return 0;
      return results.length === 6 ? 620 : results.length * 70;
    },
    rankForRun(score, kills, totalEnemies) {
      const clearRate = totalEnemies === 0 ? 0 : kills / totalEnemies;
      if (descender.coreKilled() && score >= 24000 && clearRate >= 0.78) return 'S';
      if (score >= 16000 && clearRate >= 0.6) return 'A';
      if (score >= 10000 && clearRate >= 0.4) return 'B';
      if (score >= 4500 && clearRate >= 0.22) return 'C';
      return 'D';
    },
    detailsForRun() {
      const hull = Math.max(0, SKYHOOK_PLAYER_HEALTH - hitsTaken);
      const lines = [`Climber hull ${hull}/${SKYHOOK_PLAYER_HEALTH}`];
      if (latchersPried > 0) lines.push(`${latchersPried} latcher${latchersPried === 1 ? '' : 's'} pried off the cowl`);
      if (slugsIntercepted > 0) lines.push(`${slugsIntercepted} slug${slugsIntercepted === 1 ? '' : 's'} shot down`);
      const descenderLine = descender.summaryLine();
      if (descenderLine) lines.push(descenderLine);
      return lines;
    },
  };
}
