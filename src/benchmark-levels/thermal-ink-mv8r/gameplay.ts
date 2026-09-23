import { CatmullRomCurve3, MathUtils, Matrix4, Quaternion, Vector3 } from 'three';
import type { PerspectiveCamera } from 'three';
import {
  hostileShotAimPoint,
  shotBehindCamera,
  steerHomingShot,
  updateHostileShotImpact,
  type HostileShotImpactState,
} from '../../engine/hostile-shot';
import { GAME_FOV_DEGREES } from '../../engine/lock-on-runner';
import type { LockOnEnemyUpdate, LockOnRunnerLevel, LockOnSpawnEntry } from '../../engine/lock-on-runner';
import type { EventBus } from '../../events';
import { createOctopusRig, type ArmAttack, type OctopusRig, type ViewPose } from './octopus';
import { BAR, BARS, BEAT, INK_CLOUDS, RUN_DURATION, THERMAL_INK_BPM, bar } from './timing';

// THERMAL INK — one continuous boss fight in a drowned sodium-lit harbor.
//
// The camera circles a giant mutant octopus wrapped on a capsized freighter.
// Its spawn scuttle, swim, and pulse in from the screen edges; four of its
// arms erupt from the water to reach for the rail and must be severed at
// their nodes; then it rears, bares its core, and blacks the harbor out with
// a last cloud of ink. Everything the player fights is choreographed in the
// camera's own frame (so it always lands on screen, spread edge to edge),
// while the octopus itself lives in world space and turns to keep you close.

export { THERMAL_INK_BPM, RUN_DURATION } from './timing';
export const PLAYER_HEALTH = 4;

export type EnemyKind = 'scrapper' | 'eel' | 'bellbuoy' | 'barb' | 'node' | 'core';

type Frac2 = readonly [number, number];

// Timeline data is immutable and reused across runs; per-enemy runtime state
// lives in enemyState bags; barbs get fresh data objects per launch.
export type SpawnData =
  | { role: 'scrapper'; path: readonly Frac2[]; depths: readonly number[]; hopBeats: number; seed: number }
  | { role: 'eel'; from: Frac2; to: Frac2; depth: number; amp: number; cycles: number; seconds: number; seed: number }
  | { role: 'bellbuoy'; x: number; top: number; depth: number; pulses: number; hold: number; fireBeats: readonly number[]; seed: number }
  | { role: 'bolt'; position: Vector3; velocity: Vector3; lastAge: number; impact: HostileShotImpactState }
  | { role: 'node'; attack: number }
  | { role: 'core' };

export type SpawnEntry = LockOnSpawnEntry<EnemyKind, SpawnData>;
type Update = LockOnEnemyUpdate<EnemyKind, SpawnData>;

// ---- rail --------------------------------------------------------------------

// Camera stations, one every two bars: [bar, x, y, z]. The octopus sits at the
// origin on its wreck. The approach crosses the harbor from the south, dives
// low under the first ink, orbits the creature through the crane yard, and
// ends face to face with its crown.
const STATIONS: ReadonlyArray<readonly [number, number, number, number]> = [
  [0, 6, 11, 146],
  [2, -4, 9.5, 127],
  [4, 7, 8, 106],
  [6, 21, 6.4, 85],
  [8, 36, 5.2, 52],
  [10, 54, 6.8, 15],
  [12, 60, 9, -24],
  [14, 38, 12, -56],
  [16, 2, 15, -66],
  [18, -34, 16, -52],
  [20, -52, 14, -18],
  [22, -48, 15, 16],
  [24, -36, 16, 36],
];

export function createThermalInkRail() {
  return new CatmullRomCurve3(
    STATIONS.map(([, x, y, z]) => new Vector3(x, y, z)),
    false,
    'centripetal',
  );
}

const rail = createThermalInkRail();

// Rail progress is authored, not derived: the camera reaches each station on
// its bar, with a monotone cubic between stations so the pace never jerks.
const stationTimes = STATIONS.map(([stationBar]) => bar(stationBar));
const stationProgress = (() => {
  const divisions = 60;
  const lengths = rail.getLengths((STATIONS.length - 1) * divisions);
  const total = lengths[lengths.length - 1];
  return STATIONS.map((_, index) => lengths[index * divisions] / total);
})();
const stationSlopes = monotoneSlopes(stationTimes, stationProgress);

export function thermalInkRunProgress(time: number) {
  const t = MathUtils.clamp(time, 0, RUN_DURATION);
  let i = 0;
  while (i < stationTimes.length - 2 && t > stationTimes[i + 1]) i += 1;
  const t0 = stationTimes[i];
  const t1 = stationTimes[i + 1];
  const h = t1 - t0;
  const s = (t - t0) / h;
  const h00 = 2 * s ** 3 - 3 * s ** 2 + 1;
  const h10 = s ** 3 - 2 * s ** 2 + s;
  const h01 = -2 * s ** 3 + 3 * s ** 2;
  const h11 = s ** 3 - s ** 2;
  return MathUtils.clamp(
    h00 * stationProgress[i] + h10 * h * stationSlopes[i] + h01 * stationProgress[i + 1] + h11 * h * stationSlopes[i + 1],
    0,
    1,
  );
}

function monotoneSlopes(xs: number[], ys: number[]) {
  const n = xs.length;
  const deltas = xs.slice(0, -1).map((x, i) => (ys[i + 1] - ys[i]) / (xs[i + 1] - x));
  const slopes = xs.map((_, i) => (i === 0 ? deltas[0] : i === n - 1 ? deltas[n - 2] : (deltas[i - 1] + deltas[i]) / 2));
  for (let i = 0; i < n - 1; i += 1) {
    if (deltas[i] === 0) {
      slopes[i] = 0;
      slopes[i + 1] = 0;
      continue;
    }
    const a = slopes[i] / deltas[i];
    const b = slopes[i + 1] / deltas[i];
    const m = a * a + b * b;
    if (m > 9) {
      const tau = 3 / Math.sqrt(m);
      slopes[i] = tau * a * deltas[i];
      slopes[i + 1] = tau * b * deltas[i];
    }
  }
  return slopes;
}

// ---- the view -----------------------------------------------------------------

// How hard the camera looks at the creature instead of down the rail.
// Low while diving under the first ink (you look where you're going), high
// while circling (the creature holds frame), total at the end.
const LOOK_KEYS: ReadonlyArray<readonly [number, number]> = [
  [0, 0.5],
  [5, 0.55],
  [6.5, 0.3],
  [9, 0.3],
  [10.5, 0.72],
  [16, 0.8],
  [19, 0.92],
  [24, 0.96],
];

function lookWeightAt(time: number) {
  const b = time / BAR;
  for (let i = 1; i < LOOK_KEYS.length; i += 1) {
    if (b <= LOOK_KEYS[i][0]) {
      const [b0, w0] = LOOK_KEYS[i - 1];
      const [b1, w1] = LOOK_KEYS[i];
      const t = MathUtils.clamp((b - b0) / (b1 - b0), 0, 1);
      return MathUtils.lerp(w0, w1, t * t * (3 - 2 * t));
    }
  }
  return LOOK_KEYS[LOOK_KEYS.length - 1][1];
}

const UP = new Vector3(0, 1, 0);
const FOCUS = new Vector3(0, 12, 0);
const scratchMatrix = new Matrix4();
const scratchA = new Vector3();
const scratchB = new Vector3();

/** The camera's base pose (before the player's edge-look) at a run time. */
export function viewPoseAt(time: number, target: ViewPose & { quaternion: Quaternion }, rearFocus = 0) {
  const u = thermalInkRunProgress(time);
  target.position.copy(rail.getPointAt(u));
  const railDir = scratchA.copy(rail.getTangentAt(Math.min(0.999, u))).normalize();
  const focus = scratchB.copy(FOCUS);
  focus.y += rearFocus * 8;
  const toFocus = focus.sub(target.position).normalize();
  const w = lookWeightAt(time);
  target.forward.copy(railDir).lerp(toFocus, w).normalize();
  scratchMatrix.lookAt(target.position, scratchA.copy(target.position).add(target.forward), UP);
  target.quaternion.setFromRotationMatrix(scratchMatrix);
  target.right.set(1, 0, 0).applyQuaternion(target.quaternion);
  target.up.set(0, 1, 0).applyQuaternion(target.quaternion);
  return target;
}

export function createViewPose() {
  return {
    position: new Vector3(),
    forward: new Vector3(0, 0, -1),
    right: new Vector3(1, 0, 0),
    up: new Vector3(0, 1, 0),
    quaternion: new Quaternion(),
  };
}

const TAN_HALF_FOV = Math.tan(MathUtils.degToRad(GAME_FOV_DEGREES / 2));

// ---- ink ----------------------------------------------------------------------

function cloudDensity(time: number, [a, b, c, d]: readonly [number, number, number, number]) {
  const t = time / BAR;
  if (t <= a || t >= d) return 0;
  if (t < b) return (t - a) / (b - a);
  if (t <= c) return 1;
  return 1 - (t - c) / (d - c);
}

/** Ink density around the camera. The finale cloud clears early once the core dies. */
export function inkDensityAt(time: number, coreKilledAt = -1) {
  let density = 0;
  for (let i = 0; i < INK_CLOUDS.length; i += 1) {
    let value = cloudDensity(time, INK_CLOUDS[i]);
    if (i === INK_CLOUDS.length - 1 && coreKilledAt >= 0 && time > coreKilledAt) {
      const since = time - coreKilledAt;
      value = Math.min(value, 1 - MathUtils.clamp((since - 1.6) / (BAR * 0.9), 0, 1));
    }
    density = Math.max(density, value);
  }
  return density;
}

// ---- arm attacks -----------------------------------------------------------------

// Four arms reach for the rail, one per movement of the fight. Each erupts
// from the water beside the camera, hovers its node in reach, and — unless
// severed — slams across the rail when its window closes.
export const ARM_ATTACKS: readonly ArmAttack[] = [
  { arm: 1, from: bar(3), riseSeconds: 1.8, until: bar(5.5), root: [1.05, 62], node: [0.5, 0.42, 31], sway: [0.07, 0.05] },
  { arm: 6, from: bar(6.5), riseSeconds: 1.8, until: bar(9.25), root: [-1.05, 56], node: [-0.46, 0.5, 29], sway: [0.08, 0.05] },
  { arm: 3, from: bar(10), riseSeconds: 1.6, until: bar(12.5), root: [1.1, 52], node: [0.56, 0.18, 28], sway: [0.06, 0.08] },
  { arm: 5, from: bar(13), riseSeconds: 1.6, until: bar(15.75), root: [-1.1, 52], node: [-0.52, 0.34, 29], sway: [0.07, 0.07] },
];
const NODE_SPAWN_DELAY = 1.2;
export const CORE_SPAWN_TIME = bar(BARS.coreOpen);
// The bared creature spits ink barbs from its beak: short phrases through the
// mantle, then single shots in the dark. [time, lateral spread]
const BEAK_SPITS: ReadonlyArray<readonly [number, number]> = [
  [bar(17, 2), -6], [bar(17, 2.5), 6],
  [bar(18, 3), -8], [bar(18, 3.5), 0], [bar(19), 8],
  [bar(20, 2), -5], [bar(21, 1), 5], [bar(21, 3), 0],
];
export const CORE_REOPEN_TIME = bar(20, 0.2);
export const ESCAPE_TIME = bar(BARS.escape);

// ---- spawn timeline ---------------------------------------------------------------

let seedCounter = 1;
const nextSeed = () => (seedCounter = (seedCounter * 16807) % 2147483647) / 2147483647;

/** An edge crawler: enters from off-screen, hops perch to perch on the beat, lunges past. */
function scrapper(time: number, path: Frac2[], depths: number[], hopBeats = 2): SpawnEntry {
  return { time, kind: 'scrapper', data: { role: 'scrapper', path, depths, hopBeats, seed: nextSeed() } };
}

function mirror(path: Frac2[]): Frac2[] {
  return path.map(([x, y]) => [-x, y] as const);
}

function eel(time: number, from: Frac2, to: Frac2, options: { depth?: number; amp?: number; cycles?: number; bars?: number } = {}): SpawnEntry {
  return {
    time,
    kind: 'eel',
    data: {
      role: 'eel',
      from,
      to,
      depth: options.depth ?? 21,
      amp: options.amp ?? 0.16,
      cycles: options.cycles ?? 1.5,
      seconds: (options.bars ?? 1.6) * BAR,
      seed: nextSeed(),
    },
  };
}

function bellbuoy(time: number, x: number, top: number, fireBeats: number[] = [6], depth = 23): SpawnEntry {
  return {
    time,
    kind: 'bellbuoy',
    hitPoints: 2,
    data: { role: 'bellbuoy', x, top, depth, pulses: 4, hold: 6, fireBeats, seed: nextSeed() },
  };
}

const LEFT_LOW: Frac2[] = [[-1.3, -0.35], [-0.72, -0.5], [-0.42, 0.05], [0.08, 0.38], [0.7, 1.4]];
const LEFT_HIGH: Frac2[] = [[-1.3, 0.45], [-0.78, 0.55], [-0.5, 0.12], [-0.05, -0.28], [0.8, -1.4]];
const BOTTOM_LEFT: Frac2[] = [[-0.62, -1.35], [-0.58, -0.62], [-0.86, -0.1], [-0.55, 0.5], [-1.4, 0.9]];
const BOTTOM_RIGHT: Frac2[] = [[0.3, -1.35], [0.28, -0.66], [0.62, -0.3], [0.86, 0.3], [1.45, 0.2]];
const TOP_LEFT: Frac2[] = [[-0.35, 1.35], [-0.32, 0.72], [-0.7, 0.3], [-0.9, -0.25], [-1.4, -0.8]];

function buildTimeline(): SpawnEntry[] {
  seedCounter = 1;
  const entries: SpawnEntry[] = [
    // ---- Act I: Sodium Murk. The spawn test the edges; arm 1 rises right.
    scrapper(bar(1), LEFT_LOW, [24, 22, 20, 17, 7]),
    scrapper(bar(1, 1), mirror(LEFT_HIGH), [24, 22, 20, 17, 7]),
    scrapper(bar(1, 2), BOTTOM_LEFT, [22, 21, 19, 17, 8]),
    scrapper(bar(1, 3), BOTTOM_RIGHT, [22, 21, 19, 17, 8]),
    eel(bar(2, 2), [-1.3, 0.62], [1.3, 0.2], { amp: 0.16 }),
    eel(bar(2, 3), [1.3, -0.3], [-1.3, -0.62], { amp: 0.14, depth: 19 }),
    bellbuoy(bar(3, 2), -0.72, 0.2),
    bellbuoy(bar(3, 3), -0.28, 0.5, [7]),
    scrapper(bar(4, 1), LEFT_HIGH, [23, 21, 19, 16, 7], 1),
    scrapper(bar(4, 1.5), LEFT_LOW, [23, 21, 19, 16, 7], 1),
    scrapper(bar(4, 2), BOTTOM_LEFT, [22, 20, 18, 16, 7], 1),
    eel(bar(5), [1.3, 0.7], [-1.3, 0.45], { amp: 0.12, cycles: 2, bars: 1.4 }),

    // ---- Act II: First Ink. Blind inside the cloud; thermal or nothing.
    scrapper(bar(6, 1), mirror(LEFT_LOW), [20, 19, 17, 15, 6]),
    scrapper(bar(6, 1.5), BOTTOM_LEFT, [20, 19, 17, 15, 6]),
    scrapper(bar(6, 2), mirror(TOP_LEFT), [21, 19, 17, 15, 6]),
    eel(bar(7, 1), [-1.3, 0.75], [1.3, -0.65], { amp: 0.1, cycles: 1, bars: 1.5 }),
    eel(bar(7, 1.5), [-1.3, -0.7], [1.3, 0.62], { amp: 0.1, cycles: 1, bars: 1.5, depth: 18 }),
    bellbuoy(bar(8), 0.7, 0.3),
    bellbuoy(bar(8, 1), 0.3, 0.55, [7]),
    scrapper(bar(8, 3), BOTTOM_RIGHT, [19, 18, 16, 14, 6], 1),
    scrapper(bar(8, 3.5), BOTTOM_LEFT, [19, 18, 16, 14, 6], 1),
    eel(bar(9, 2), [1.3, 0.1], [-1.3, 0.55], { amp: 0.18, cycles: 2 }),
    eel(bar(9, 3), [-1.3, -0.2], [1.3, -0.55], { amp: 0.18, cycles: 2, depth: 19 }),
    // Surfacing as the cloud thins: two buoys toll the way out of the ink.
    bellbuoy(bar(9, 2), -0.3, 0.5, [7], 17),
    bellbuoy(bar(9, 3), 0.38, 0.32, [6], 17),

    // ---- Act III: The Circling. Arms 3 and 4, the crane, a second cloud.
    scrapper(bar(10, 1), LEFT_LOW, [22, 20, 18, 16, 7]),
    scrapper(bar(10, 1.5), LEFT_HIGH, [22, 20, 18, 16, 7]),
    scrapper(bar(10, 2), BOTTOM_LEFT, [21, 20, 18, 16, 7]),
    bellbuoy(bar(11), -0.5, 0.62, [5]),
    eel(bar(11, 2), [-1.3, 0.55], [1.3, 0.55], { amp: 0.2, cycles: 2, bars: 1.7 }),
    eel(bar(11, 2.5), [-1.3, 0.0], [1.3, 0.0], { amp: 0.2, cycles: 2, bars: 1.7, depth: 19 }),
    eel(bar(11, 3), [-1.3, -0.55], [1.3, -0.55], { amp: 0.2, cycles: 2, bars: 1.7, depth: 17 }),
    scrapper(bar(12, 1), TOP_LEFT, [20, 18, 17, 15, 6], 1),
    scrapper(bar(12, 1.5), mirror(TOP_LEFT), [20, 18, 17, 15, 6], 1),
    bellbuoy(bar(13), -0.2, 0.62),
    bellbuoy(bar(13, 1), 0.3, 0.3, [6]),
    scrapper(bar(14, 0.5), mirror(LEFT_LOW), [19, 18, 16, 14, 6]),
    scrapper(bar(14, 1), mirror(LEFT_HIGH), [19, 18, 16, 14, 6]),
    scrapper(bar(14, 1.5), BOTTOM_LEFT, [19, 18, 16, 14, 6]),
    eel(bar(14, 3), [1.3, 0.6], [-1.3, -0.1], { amp: 0.15, cycles: 1.5 }),
    eel(bar(14, 3.5), [1.3, -0.65], [-1.3, 0.05], { amp: 0.15, cycles: 1.5, depth: 18 }),

    // ---- Act IV: The Mantle. Arms spent; it rears and bares the core; its
    // brood rings the frame for one full six-lock volley.
    scrapper(bar(16, 3), LEFT_HIGH, [21, 20, 18, 16, 7]),
    scrapper(bar(16, 3), mirror(LEFT_HIGH), [21, 20, 18, 16, 7]),
    scrapper(bar(16, 3.5), LEFT_LOW, [21, 20, 18, 16, 7]),
    scrapper(bar(16, 3.5), mirror(LEFT_LOW), [21, 20, 18, 16, 7]),
    scrapper(bar(17), BOTTOM_LEFT, [21, 20, 18, 16, 7]),
    scrapper(bar(17), BOTTOM_RIGHT, [21, 20, 18, 16, 7]),
    eel(bar(18, 1), [-1.3, 0.72], [1.3, 0.3], { amp: 0.14, cycles: 2 }),
    eel(bar(18, 1.5), [1.3, -0.72], [-1.3, -0.3], { amp: 0.14, cycles: 2, depth: 19 }),
    bellbuoy(bar(18, 2), -0.55, 0.38, [5], 20),
    bellbuoy(bar(18, 2.5), 0.62, 0.32, [5], 20),
    scrapper(bar(19, 1), TOP_LEFT, [19, 18, 16, 14, 6], 1),
    scrapper(bar(19, 1.5), mirror(TOP_LEFT), [19, 18, 16, 14, 6], 1),

    // ---- Finale: the blackout. Its last brood circles close in the dark.
    scrapper(bar(20, 1), LEFT_LOW, [17, 16, 15, 13, 5]),
    scrapper(bar(20, 1.5), mirror(LEFT_LOW), [17, 16, 15, 13, 5]),
    scrapper(bar(20, 2), BOTTOM_LEFT, [17, 16, 15, 13, 5]),
    scrapper(bar(20, 2.5), BOTTOM_RIGHT, [17, 16, 15, 13, 5]),
    eel(bar(21), [-1.3, 0.62], [1.3, 0.62], { amp: 0.16, cycles: 2, depth: 18 }),
    eel(bar(21, 0.5), [1.3, -0.62], [-1.3, -0.62], { amp: 0.16, cycles: 2, depth: 17 }),
  ];

  ARM_ATTACKS.forEach((attack, index) => {
    entries.push({ time: attack.from + NODE_SPAWN_DELAY, kind: 'node', hitStages: [3, 3], data: { role: 'node', attack: index } });
  });
  return entries;
}

export function createThermalInkTimeline(coreEntry: SpawnEntry) {
  return [...buildTimeline(), coreEntry].sort((a, b) => a.time - b.time);
}

// ---- scoring --------------------------------------------------------------------

const KILL_SCORE: Record<EnemyKind, number> = {
  scrapper: 120,
  eel: 160,
  bellbuoy: 200,
  barb: 60,
  node: 900,
  core: 4000,
};

const BARB_MAX_AGE = 9;

// ---- the gameplay factory --------------------------------------------------------

export type ThermalInkGameplay = LockOnRunnerLevel<EnemyKind, SpawnData> & {
  rig: OctopusRig;
  state: FightState;
  animateIdle(dt: number, camera: PerspectiveCamera): void;
};

export type FightState = {
  runTime: number;
  coreKilledAt: number;
  coreStageBroken: boolean;
  coreEscaped: boolean;
  armsSevered: number;
  thermalKills: number;
  hitsTaken: number;
  barbsDowned: number;
  ink: number;
  /** Per arm-attack index: 'pending' | 'severed' | 'slammed'. */
  armOutcomes: Array<'pending' | 'severed' | 'slammed'>;
};

export function createThermalInkGameplay(bus: EventBus, sharedRig?: OctopusRig): ThermalInkGameplay {
  const rig = sharedRig ?? createOctopusRig();
  const coreEntry: SpawnEntry = { time: CORE_SPAWN_TIME, kind: 'core', hitStages: [6, 6], data: { role: 'core' } };
  const timeline = createThermalInkTimeline(coreEntry);
  const pose = createViewPose();
  let aspect = 16 / 9;

  const state: FightState = {
    runTime: 0,
    coreKilledAt: -1,
    coreStageBroken: false,
    coreEscaped: false,
    armsSevered: 0,
    thermalKills: 0,
    hitsTaken: 0,
    barbsDowned: 0,
    ink: 0,
    armOutcomes: ARM_ATTACKS.map(() => 'pending' as const),
  };

  const nodeAttack = new Map<number, number>();
  let coreId = -1;
  const interceptions = new Set<number>();
  let lastTime = 0;

  function resetFight() {
    rig.reset();
    state.runTime = 0;
    state.coreKilledAt = -1;
    state.coreStageBroken = false;
    state.coreEscaped = false;
    state.armsSevered = 0;
    state.thermalKills = 0;
    state.hitsTaken = 0;
    state.barbsDowned = 0;
    state.ink = 0;
    state.armOutcomes = ARM_ATTACKS.map(() => 'pending' as const);
    nodeAttack.clear();
    interceptions.clear();
    coreId = -1;
    coreEntry.lockable = true;
    lastTime = 0;
  }

  bus.on('runstart', resetFight);
  bus.on('runend', () => {
    for (const attack of ARM_ATTACKS) rig.retreat(attack.arm, state.runTime);
  });
  bus.on('playerhit', () => {
    state.hitsTaken += 1;
  });
  bus.on('fire', ({ enemyId }) => interceptions.add(enemyId));
  bus.on('miss', ({ enemyId }) => interceptions.delete(enemyId));
  bus.on('spawn', ({ enemyId, kind }) => {
    if (kind === 'core') coreId = enemyId;
  });
  bus.on('hit', ({ enemyId, lethal }) => {
    const attack = nodeAttack.get(enemyId);
    if (attack !== undefined && !lethal) rig.flinch(ARM_ATTACKS[attack].arm, 0.8);
  });
  bus.on('stage', ({ enemyId }) => {
    if (enemyId === coreId && state.runTime < CORE_REOPEN_TIME) {
      // The first membrane is broken: the core seals under folded arms until
      // the final blackout, so the last volley always lands in the dark.
      state.coreStageBroken = true;
      coreEntry.lockable = false;
    }
  });
  bus.on('kill', ({ enemyId }) => {
    interceptions.delete(enemyId);
    if (state.ink >= 0.5) state.thermalKills += 1;
    const attack = nodeAttack.get(enemyId);
    if (attack !== undefined) {
      state.armOutcomes[attack] = 'severed';
      state.armsSevered += 1;
      rig.sever(ARM_ATTACKS[attack].arm, state.runTime);
    }
    if (enemyId === coreId) state.coreKilledAt = state.runTime;
  });

  const toWorld = (xf: number, yf: number, depth: number) =>
    pose.position.clone()
      .addScaledVector(pose.right, xf * depth * TAN_HALF_FOV * aspect)
      .addScaledVector(pose.up, yf * depth * TAN_HALF_FOV)
      .addScaledVector(pose.forward, depth);

  // The brood never swims under the surface while on screen: anything placed
  // below the waterline rides up the view's vertical until it skims the water.
  const WATERLINE = 1.3;
  const seat = (xf: number, yf: number, depth: number) => {
    const point = toWorld(xf, yf, depth);
    if (point.y < WATERLINE && pose.up.y > 0.2) point.addScaledVector(pose.up, (WATERLINE - point.y) / pose.up.y);
    return point;
  };

  // ---- the fight's clock: body posture, arms, ink -------------------------------

  function updateFight(time: number, dt: number) {
    state.runTime = time;
    state.ink = inkDensityAt(time, state.coreKilledAt);

    for (const attack of ARM_ATTACKS) {
      const arm = rig.arms[attack.arm];
      if (time >= attack.from && lastTime < attack.from) rig.beginAttack(attack, time);
      if (arm.attack === attack && arm.phase === 'reaching' && time >= attack.until + 0.9) rig.retreat(attack.arm, time);
    }

    const body = rig.body;
    const rearTarget = time >= bar(BARS.mantle) ? 1 : 0;
    body.rear = MathUtils.clamp(body.rear + (rearTarget - body.rear) * Math.min(1, dt * 1.1), 0, 1);
    const guardTarget = state.coreStageBroken && time < CORE_REOPEN_TIME ? 0.6 : 0;
    body.guard += (guardTarget - body.guard) * Math.min(1, dt * 3);
    if (guardTarget === 0 && state.coreStageBroken && time >= CORE_REOPEN_TIME) coreEntry.lockable = true;
    // Once bared the core stays out of the crown; sealing is shown by its membrane.
    const opening = time >= CORE_SPAWN_TIME - 1 && state.coreKilledAt < 0 ? 1 : 0;
    rig.core.open += (opening - rig.core.open) * Math.min(1, dt * 2);
    if (state.coreKilledAt >= 0) body.collapse = MathUtils.clamp((time - state.coreKilledAt) / 3.2, 0, 1);
    if (state.coreEscaped) body.sink = Math.min(1, body.sink + dt * 0.35);

    rig.update(time, dt, pose.position, toWorld);
    lastTime = time;
  }

  // ---- enemy motion --------------------------------------------------------------

  function faceCamera(context: Update) {
    context.enemy.mesh.quaternion.copy(pose.quaternion);
  }

  function updateScrapper(context: Update, data: Extract<SpawnData, { role: 'scrapper' }>) {
    const { enemy, age } = context;
    // Hops land on the beat: segment k lands at (k + 1) * hopBeats beats.
    const hopSeconds = data.hopBeats * BEAT;
    const segment = Math.floor(age / hopSeconds);
    const last = data.path.length - 1;
    if (segment >= last) return true;
    const local = (age - segment * hopSeconds) / hopSeconds;
    // Cling for most of the interval, then spring; the first hop is a scuttle in.
    const airborne = segment === 0 ? 0.85 : segment === last - 1 ? 0.6 : 0.42;
    const t = MathUtils.clamp((local - (1 - airborne)) / airborne, 0, 1);
    const eased = t * t * (3 - 2 * t);
    const [x0, y0] = data.path[segment];
    const [x1, y1] = data.path[segment + 1];
    const arc = segment === 0 ? 0.05 : 0.2;
    const xf = MathUtils.lerp(x0, x1, eased);
    const yf = MathUtils.lerp(y0, y1, eased) + Math.sin(t * Math.PI) * arc;
    const depth = MathUtils.lerp(data.depths[segment], data.depths[segment + 1], eased);
    // Clinging scrappers twitch; scuttling ones jitter.
    const twitch = t === 0 ? Math.sin(age * 31 + data.seed * 40) * 0.006 : 0;
    enemy.mesh.position.copy(seat(xf + twitch, yf, depth));
    faceCamera(context);
    enemy.mesh.rotateZ(Math.atan2(y1 - y0, x1 - x0) * 0.25 * Math.sin(t * Math.PI) + Math.sin(age * 5 + data.seed) * 0.08);
    enemy.mesh.userData.airborne = t > 0 && t < 1 ? Math.sin(t * Math.PI) : 0;
    enemy.mesh.userData.heading = Math.sign(x1 - x0) || 1;
    return false;
  }

  function updateEel(context: Update, data: Extract<SpawnData, { role: 'eel' }>) {
    const { enemy, age } = context;
    const t = age / data.seconds;
    if (t > 1) return true;
    const along = MathUtils.clamp(t, 0, 1);
    const dx = data.to[0] - data.from[0];
    const dy = data.to[1] - data.from[1];
    const length = Math.hypot(dx, dy) || 1;
    const nx = -dy / length;
    const ny = dx / length;
    const wave = Math.sin(along * Math.PI * 2 * data.cycles + data.seed * 6) * data.amp;
    const xf = data.from[0] + dx * along + nx * wave;
    const yf = data.from[1] + dy * along + ny * wave;
    const depth = data.depth + Math.sin(along * Math.PI) * -3;
    enemy.mesh.position.copy(seat(xf, yf, depth));
    faceCamera(context);
    const slope = Math.cos(along * Math.PI * 2 * data.cycles + data.seed * 6) * data.amp * Math.PI * 2 * data.cycles;
    const heading = Math.atan2(dy + ny * slope, (dx + nx * slope) * aspect);
    enemy.mesh.rotateZ(heading);
    return false;
  }

  function updateBellbuoy(context: Update, data: Extract<SpawnData, { role: 'bellbuoy' }>) {
    const { enemy, age } = context;
    // Jet-pulses on every beat: contract, thrust up, coast.
    const beats = age / BEAT;
    const pulse = Math.floor(beats);
    const phase = beats - pulse;
    const fromY = -1.35;
    let yf: number;
    const riseEnd = data.pulses;
    if (beats < riseEnd) {
      const thrust = 1 - (1 - Math.min(1, phase / 0.45)) ** 3;
      yf = fromY + ((data.top - fromY) * (pulse + thrust)) / data.pulses;
    } else if (beats < riseEnd + data.hold) {
      yf = data.top + Math.sin((beats - riseEnd) * Math.PI * 0.5) * 0.04;
    } else {
      const sink = beats - riseEnd - data.hold;
      yf = data.top - sink * sink * 0.35;
      if (yf < -1.4) return true;
    }
    const xf = data.x + Math.sin(age * 0.8 + data.seed * 5) * 0.05;
    enemy.mesh.position.copy(seat(xf, yf, data.depth));
    faceCamera(context);
    enemy.mesh.rotateZ(Math.sin(age * 1.4 + data.seed) * 0.12);
    enemy.mesh.userData.pulse = beats < riseEnd + data.hold ? phase : 0;

    const fired = context.enemyState(() => ({ next: 0 }));
    while (fired.next < data.fireBeats.length && beats >= data.fireBeats[fired.next]) {
      fired.next += 1;
      launchBarb(context, enemy.mesh.position);
    }
    return false;
  }

  function launchBarb(context: Update, from: Vector3) {
    const velocity = hostileShotAimPoint(context.camera, from).sub(from).normalize().multiplyScalar(4);
    context.spawnEnemy({
      time: context.runTime,
      kind: 'barb',
      countsTowardTotal: false,
      data: { role: 'bolt', position: from.clone(), velocity, lastAge: 0, impact: {} },
    });
  }

  function updateBarb(context: Update, data: Extract<SpawnData, { role: 'bolt' }>) {
    const { enemy, age, camera, damagePlayer } = context;
    // Its ink dies with it.
    if (state.coreKilledAt >= 0) return true;
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
      faceCamera(context);
      enemy.mesh.rotateZ(age * 8);
      if (impact.damaged) {
        damagePlayer(1);
        return true;
      }
      return false;
    }
    steerHomingShot(data.position, data.velocity, hostileShotAimPoint(camera, data.position), age, dt, {
      baseSpeed: 4.5,
      maxSpeed: 11,
      accel: 2.8,
      turnRate: 2.2,
    });
    enemy.mesh.position.copy(data.position);
    enemy.mesh.lookAt(scratchA.copy(data.position).add(data.velocity));
    return age > BARB_MAX_AGE || shotBehindCamera(camera, data.position);
  }

  function updateNode(context: Update, data: Extract<SpawnData, { role: 'node' }>) {
    const { enemy, runTime } = context;
    const attack = ARM_ATTACKS[data.attack];
    const arm = rig.arms[attack.arm];
    nodeAttack.set(enemy.id, data.attack);
    enemy.mesh.position.copy(arm.node);
    faceCamera(context);
    enemy.mesh.rotateZ(runTime * 0.6);
    // One beat of warning before the slam: the node swells and burns.
    enemy.mesh.userData.telegraph = MathUtils.clamp((runTime - (attack.until - BEAT)) / BEAT, 0, 1);
    if (arm.phase === 'reaching' && runTime >= attack.until) rig.slam(attack.arm, runTime);
    if (arm.phase === 'slamming' && arm.lash >= 1) {
      state.armOutcomes[data.attack] = 'slammed';
      context.damagePlayer(1);
      rig.retreat(attack.arm, runTime);
      return true;
    }
    return arm.phase !== 'reaching' && arm.phase !== 'slamming';
  }

  function updateCore(context: Update) {
    const { enemy, runTime } = context;
    enemy.mesh.position.copy(rig.core.position);
    const spit = context.enemyState(() => ({ next: BEAK_SPITS.findIndex(([time]) => time >= runTime) }));
    while (spit.next >= 0 && spit.next < BEAK_SPITS.length && runTime >= BEAK_SPITS[spit.next][0]) {
      const from = rig.core.position.clone().addScaledVector(pose.right, BEAK_SPITS[spit.next][1]).addScaledVector(rig.core.normal, 3);
      if (state.coreKilledAt < 0) launchBarb(context, from);
      spit.next += 1;
    }
    enemy.mesh.quaternion.copy(pose.quaternion);
    enemy.mesh.userData.sealed = coreEntry.lockable === false ? 1 : 0;
    enemy.mesh.userData.open = rig.core.open;
    if (runTime >= ESCAPE_TIME && state.coreKilledAt < 0) {
      state.coreEscaped = true;
      return true;
    }
    return false;
  }

  // Outside a run (attract, end card) the creature still breathes and writhes.
  let idleTime = 0;
  function animateIdle(dt: number, camera: PerspectiveCamera) {
    idleTime += dt;
    pose.position.copy(camera.position);
    camera.getWorldDirection(pose.forward);
    pose.quaternion.copy(camera.quaternion);
    pose.right.set(1, 0, 0).applyQuaternion(pose.quaternion);
    pose.up.set(0, 1, 0).applyQuaternion(pose.quaternion);
    rig.update(state.runTime + idleTime, dt, camera.position, toWorld);
  }

  return {
    rig,
    state,
    animateIdle,
    duration: RUN_DURATION,
    bpm: THERMAL_INK_BPM,
    playerHealth: PLAYER_HEALTH,
    createRail: createThermalInkRail,
    spawnTimeline: timeline,
    easeRunProgress: thermalInkRunProgress,
    startWord: 'STRIKE',
    // The camera's gaze is part of the fight, not decoration: blend from the
    // rail direction toward the creature, then re-apply the player's edge-look.
    updateCameraEffects({ camera, runTime, dt }) {
      aspect = MathUtils.clamp((camera as PerspectiveCamera).aspect || 16 / 9, 0.6, 2.4);
      viewPoseAt(runTime, pose, rig.body.rear);
      applyGaze(camera, runTime, pose.quaternion);
      updateFight(runTime, dt);
    },
    // Attract: the rail's first station, gaze lowered so the creature looms
    // over the letters. START tilts it up into the fight.
    updateAttractCamera({ camera, modeTime }) {
      viewPoseAt(0, pose, 0);
      camera.position.copy(pose.position);
      camera.lookAt(scratchB.set(Math.sin(modeTime * 0.21) * 4, -27 + Math.sin(modeTime * 0.33) * 1.5, 0));
      camera.updateMatrixWorld();
    },
    updateEnemy(context) {
      const data = context.enemy.entry.data;
      switch (data.role) {
        case 'scrapper':
          return updateScrapper(context, data);
        case 'eel':
          return updateEel(context, data);
        case 'bellbuoy':
          return updateBellbuoy(context, data);
        case 'bolt':
          return updateBarb(context, data);
        case 'node':
          return updateNode(context, data);
        case 'core':
          return updateCore(context);
      }
    },
    scoreForKill(volleySize, enemy) {
      if (enemy.kind === 'barb') state.barbsDowned += 1;
      const volley = 1 + Math.max(0, volleySize - 1) * 0.2;
      const thermal = state.ink >= 0.5 ? 1.5 : 1;
      return Math.round(KILL_SCORE[enemy.kind] * volley * thermal);
    },
    scoreForHit: (_volleySize, enemy) => (enemy.kind === 'core' ? 150 : 60),
    scoreForVolley(results) {
      if (results.length < 4 || !results.every((result) => result.killed)) return 0;
      return results.length === 6 ? 800 : results.length * 80;
    },
    rankForRun(score, kills, totalEnemies) {
      const clear = totalEnemies === 0 ? 0 : kills / totalEnemies;
      const coreDown = state.coreKilledAt >= 0;
      if (coreDown && state.armsSevered === ARM_ATTACKS.length && score >= 24000 && clear >= 0.85) return 'S';
      if (coreDown && score >= 16000 && clear >= 0.65) return 'A';
      if (score >= 10000 && clear >= 0.45) return 'B';
      if (score >= 4500 && clear >= 0.25) return 'C';
      return 'D';
    },
    detailsForRun() {
      const lines = [`Arms severed ${state.armsSevered}/${ARM_ATTACKS.length}`];
      lines.push(state.coreKilledAt >= 0 ? 'The core burned out in the dark' : 'It slipped back into the ink');
      if (state.thermalKills > 0) lines.push(`${state.thermalKills} kill${state.thermalKills === 1 ? '' : 's'} through the ink`);
      lines.push(`Hull ${Math.max(0, PLAYER_HEALTH - state.hitsTaken)}/${PLAYER_HEALTH}`);
      return lines;
    },
  };
}

// ---- gaze --------------------------------------------------------------------------

const railQuaternion = new Quaternion();
const gazeDelta = new Quaternion();
const identity = new Quaternion();
const railPoint = new Vector3();
const railAhead = new Vector3();

// The runner has already placed the camera on the rail looking down it, with
// the player's edge-look applied on top. Swap the rail gaze for ours while
// keeping that edge-look: camera = gaze * rail⁻¹ * (rail * edge). During the
// runner's one-second start ease the swap fades in with the same smoothstep.
function applyGaze(camera: PerspectiveCamera, runTime: number, gaze: Quaternion) {
  const u = thermalInkRunProgress(runTime);
  railPoint.copy(rail.getPointAt(u));
  railAhead.copy(rail.getPointAt(MathUtils.clamp(u + 0.025, 0, 1)));
  scratchMatrix.lookAt(railPoint, railAhead, camera.up);
  railQuaternion.setFromRotationMatrix(scratchMatrix);
  gazeDelta.copy(gaze).multiply(railQuaternion.invert());
  const ease = Math.min(1, runTime);
  if (ease < 1) gazeDelta.slerp(identity, 1 - ease * ease * (3 - 2 * ease));
  camera.quaternion.premultiply(gazeDelta);
  camera.updateMatrixWorld();
}
