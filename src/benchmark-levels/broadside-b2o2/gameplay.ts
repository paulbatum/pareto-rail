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
import { createRailPacer, type RailLead } from '../../engine/rail-pacer';
import { createSpeedProfile } from '../../engine/speed-profile';
import type { EventBus } from '../../events';
import { createFlagship, type Flagship } from './flagship';
import { BROADSIDE_BPM, BROADSIDE_DURATION, BROADSIDE_TIME, bar } from './timing';

export { BROADSIDE_BPM, BROADSIDE_DURATION, bar };
export const BROADSIDE_B2O2_BPM = BROADSIDE_BPM;
export const BROADSIDE_PLAYER_HEALTH = 4;

// BROADSIDE — a sixty-second flight across a full fleet engagement:
// off the deck of the home flagship, through the crossfire between the lines,
// a high-speed run down a friendly cruiser's flank as its broadside ripples
// overhead, a slow drift through the wreck field in the eye of the battle,
// under an enemy warship's belly, then two passes on the enemy flagship —
// shield generators along its port flank, around its bow, and a trench dive
// into its power cores.

// ---- the rail ---------------------------------------------------------------

export function createBroadsideRail() {
  return new CatmullRomCurve3(
    [
      new Vector3(0, 6, 0), // launch off the flagship deck
      new Vector3(2, 9, -80),
      new Vector3(-6, 13, -180),
      new Vector3(18, 8, -290), // bank right past an ally frigate
      new Vector3(-28, 14, -410), // hard left through the crossfire
      new Vector3(30, 7, -540), // swing right into the surge
      new Vector3(-12, 11, -660),
      new Vector3(4, 4, -750), // drop toward the broadside cruiser
      new Vector3(-2, 5, -840), // — broadside run: flank at x≈+34
      new Vector3(0, 4, -930),
      new Vector3(-2, 5, -1010),
      new Vector3(-16, 9, -1090), // — peel left into the eye
      new Vector3(-30, 13, -1170), // wreck field drift
      new Vector3(-14, 7, -1250),
      new Vector3(4, 3, -1330), // — belly run: warship overhead
      new Vector3(-5, 2, -1410),
      new Vector3(3, 3, -1490),
      new Vector3(-2, 4, -1560),
      new Vector3(-30, 6, -1630), // — the flagship looms; hard left
      new Vector3(-70, 4, -1700), // onto its port flank
      new Vector3(-84, 3, -1800),
      new Vector3(-84, 5, -1910),
      new Vector3(-80, 4, -2010),
      new Vector3(-70, 6, -2100), // pull toward the bow
      new Vector3(-48, 10, -2200), // — interlude: around the bow
      new Vector3(-12, 14, -2280),
      new Vector3(16, 12, -2290),
      new Vector3(4, 7, -2240), // — trench dive into the spine channel
      new Vector3(2, 1, -2160),
      new Vector3(-2, 0, -2070),
      new Vector3(2, 1, -1980),
      new Vector3(0, 3, -1890),
      new Vector3(2, 8, -1790), // climb out past the stern
      new Vector3(8, 16, -1690),
      new Vector3(20, 28, -1600),
      new Vector3(30, 40, -1560),
      new Vector3(30, 48, -1630), // curl back: the whole battle in frame
      new Vector3(24, 54, -1740),
      new Vector3(18, 58, -1860),
    ],
    false,
    'catmullrom',
    0.4,
  );
}

// ---- speed profile → rail easing --------------------------------------------

const SPEED_KEYS: Array<readonly [number, number]> = [
  [bar(0), 0.5],
  [bar(2), 0.78],
  [bar(4), 1.0],
  [bar(8), 1.12],
  [bar(11, 2), 1.5],
  [bar(12), 1.62],
  [bar(15), 1.35],
  [bar(16), 0.62],
  [bar(17), 0.5],
  [bar(19, 2), 0.72],
  [bar(20), 1.05],
  [bar(23), 1.0],
  [bar(24), 0.88],
  [bar(27), 0.85],
  [bar(28), 0.9],
  [bar(29, 2), 1.42],
  [bar(30), 1.5],
  [bar(31), 0.62],
  [bar(31, 3), 0.34],
];

const speedProfile = createSpeedProfile(SPEED_KEYS, BROADSIDE_DURATION);

export const broadsideSpeedAt = speedProfile.speedAt;

export function broadsideRunProgress(time: number, duration = BROADSIDE_DURATION) {
  return speedProfile.runProgress(time, duration);
}

/** Rail parameter the camera occupies at run time `t` — for placing set pieces. */
export const railU = (time: number) => broadsideRunProgress(time);

// ---- capital-ship geography ----------------------------------------------------
// Authored in world space; the rail hugs these placements. Targets mounted on
// hulls project their anchor onto the rail from these world positions.

export const FLAGSHIP = {
  sternZ: -1600,
  bowZ: -2280,
  portFaceX: -70,
  starboardFaceX: 70,
  channelHalf: 16,
  floorY: -18,
  rimY: 11,
  centerY: -4,
} as const;

export const GENERATOR_POSITIONS = [
  new Vector3(-66, 2, -1720),
  new Vector3(-66, 6, -1830),
  new Vector3(-66, 0, -1940),
  new Vector3(-66, 5, -2050),
];

export const POINT_DEFENSE_POSITIONS = [
  new Vector3(-66, 10, -1775),
  new Vector3(-66, 10, -1885),
  new Vector3(-66, 10, -1995),
];

export const CORE_POSITIONS = [
  new Vector3(-8, -12, -2120),
  new Vector3(8, -12, -2010),
  new Vector3(-8, -12, -1900),
];

export const TRENCH_TURRET_POSITIONS = [
  new Vector3(-13, 7, -2100),
  new Vector3(13, 7, -1990),
];

export const BELLY_TURRET_POSITIONS = [
  new Vector3(-8, 27, -1335),
  new Vector3(8, 27, -1360),
  new Vector3(-13, 27, -1405),
  new Vector3(13, 27, -1430),
  new Vector3(-8, 27, -1475),
  new Vector3(8, 27, -1500),
  new Vector3(-13, 27, -1535),
  new Vector3(13, 27, -1548),
];

export const BELLY_WARSHIP = { center: new Vector3(0, 42, -1430), length: 360, width: 96, height: 26 };
export const BROADSIDE_CRUISER = { center: new Vector3(36, 6, -920), length: 340, width: 56, height: 30 };
export const BROADSIDE_TARGET_SHIP = { center: new Vector3(-190, 15, -880), length: 380, width: 70, height: 34 };

// ---- spawn data ------------------------------------------------------------------

export type BroadsideEnemyKind = 'dart' | 'weaver' | 'raker' | 'turret' | 'bolt' | 'gen' | 'core';

export type BroadsideSpawnData =
  | { role: 'dart'; engagement: RailLead; fromX: number; toX: number; y: number; arc: number; delay: number; crossTime: number }
  | { role: 'weaver'; engagement: RailLead; radius: number; phase: number; spin: number; y: number }
  | { role: 'raker'; engagement: RailLead; offset: Vector3; seed: number; fireEvery: number }
  | { role: 'turret'; anchorU: number; offset: Vector3; fireEvery: number; seed: number; variant: 'belly' | 'flagship' | 'trench' }
  | { role: 'bolt'; position: Vector3; velocity: Vector3; lastAge: number; impact: HostileShotImpactState }
  | { role: 'gen'; anchorU: number; offset: Vector3; index: number }
  | { role: 'core'; anchorU: number; offset: Vector3; index: number };

export type BroadsideSpawnEntry = LockOnSpawnEntry<BroadsideEnemyKind, BroadsideSpawnData>;
export type BroadsideUpdate = LockOnEnemyUpdate<BroadsideEnemyKind, BroadsideSpawnData>;

// ---- rail pacing -----------------------------------------------------------------
// Cruise is ~50 u/s and the broadside/trench runs are faster; a fixed anchor
// would spawn targets far beyond readable range. The pacer keeps the authored
// lead as the on-screen window while spawning targets at the visibility edge.

const pacer = createRailPacer({
  curve: createBroadsideRail(),
  duration: BROADSIDE_DURATION,
  runProgress: broadsideRunProgress,
  spawnAheadUnits: 88,
  defaultLeadSeconds: 3.4,
});

/** Project a static world position onto the rail: nearest anchor + frame offset. */
function railProjection(curve: CatmullRomCurve3, world: Vector3) {
  let bestU = 0;
  let bestDistance = Infinity;
  for (let i = 0; i <= 800; i += 1) {
    const u = i / 800;
    const distance = curve.getPointAt(u).distanceToSquared(world);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestU = u;
    }
  }
  const frame = sampleRailFrame(curve, bestU);
  const delta = world.clone().sub(frame.position);
  return {
    anchorU: bestU,
    offset: new Vector3(delta.dot(frame.right), delta.dot(frame.up), delta.dot(frame.tangent)),
  };
}

// ---- timeline ---------------------------------------------------------------

const STEP2 = BROADSIDE_TIME.stepSeconds * 2; // an eighth note

const darts = (
  time: number,
  lead: number,
  runs: Array<{ fromX: number; toX: number; y: number; arc: number; delay?: number; crossTime?: number }>,
): BroadsideSpawnEntry[] =>
  runs.map((run, index) => ({
    time: time + index * STEP2,
    kind: 'dart',
    data: {
      role: 'dart',
      engagement: pacer.resolve(time + index * STEP2, lead),
      fromX: run.fromX,
      toX: run.toX,
      y: run.y,
      arc: run.arc,
      delay: run.delay ?? index * 0.34,
      crossTime: run.crossTime ?? 2.4,
    },
  }));

const weavers = (
  time: number,
  lead: number,
  members: Array<{ y: number; radius?: number; spin?: number }>,
): BroadsideSpawnEntry[] =>
  members.map((member, index) => ({
    time: time + index * STEP2,
    kind: 'weaver',
    data: {
      role: 'weaver',
      engagement: pacer.resolve(time + index * STEP2, lead),
      radius: member.radius ?? 4.6,
      phase: index * 2.1 + time,
      spin: member.spin ?? (index % 2 === 0 ? 2.6 : -2.6),
      y: member.y,
    },
  }));

const rakers = (time: number, lead: number, offsets: Array<[number, number]>): BroadsideSpawnEntry[] =>
  offsets.map((offset, index) => ({
    time: time + index * STEP2 * 2,
    kind: 'raker',
    hitPoints: 2,
    data: {
      role: 'raker',
      engagement: pacer.resolve(time + index * STEP2 * 2, lead),
      offset: new Vector3(offset[0], offset[1], 0),
      seed: index * 3.7 + time,
      fireEvery: 3.4,
    },
  }));

function hullTurrets(
  time: number,
  positions: Vector3[],
  variant: 'belly' | 'flagship' | 'trench',
  fireEvery: number,
): BroadsideSpawnEntry[] {
  const curve = createBroadsideRail();
  return positions.map((position, index) => {
    const projection = railProjection(curve, position);
    return {
      time: time + index * 0.05,
      kind: 'turret',
      data: {
        role: 'turret',
        anchorU: projection.anchorU,
        offset: projection.offset,
        fireEvery,
        seed: index * 1.31 + time,
        variant,
      },
    };
  });
}

function buildTimeline(flagship: Flagship): BroadsideSpawnEntry[] {
  const curve = createBroadsideRail();
  const genEntries: BroadsideSpawnEntry[] = GENERATOR_POSITIONS.map((position, index) => {
    const projection = railProjection(curve, position);
    return {
      time: bar(23, 1.5) + index * 0.12,
      kind: 'gen',
      hitStages: [2, 1],
      data: { role: 'gen', anchorU: projection.anchorU, offset: projection.offset, index },
    };
  });
  flagship.registerGenerators(genEntries);

  const coreEntries: BroadsideSpawnEntry[] = CORE_POSITIONS.map((position, index) => {
    const projection = railProjection(curve, position);
    return {
      time: bar(29, 2) + index * 0.08,
      kind: 'core',
      hitStages: [2],
      data: { role: 'core', anchorU: projection.anchorU, offset: projection.offset, index },
    };
  });
  flagship.registerCores(coreEntries);

  return [
    // --- Launch (bars 0–3): first contacts off the deck.
    ...darts(bar(1), 3.4, [
      { fromX: 18, toX: -18, y: 3.4, arc: 2 },
      { fromX: 20, toX: -16, y: 5.6, arc: 1.4 },
    ]),
    ...darts(bar(2), 3.4, [
      { fromX: -20, toX: 18, y: 2.2, arc: 2.2 },
      { fromX: -18, toX: 20, y: 4.4, arc: 1.6 },
      { fromX: -22, toX: 16, y: 6.4, arc: 1.2 },
    ]),
    ...weavers(bar(3), 3.6, [{ y: 2.4 }, { y: 5.4 }]),

    // --- Melee (bars 4–7): the swarm knotted between the fleets.
    ...darts(bar(4), 3.3, [
      { fromX: -22, toX: 20, y: 2.4, arc: 2.4 },
      { fromX: -20, toX: 22, y: 5.0, arc: 1.6 },
      { fromX: 22, toX: -20, y: 3.6, arc: 2 },
      { fromX: 20, toX: -22, y: 6.2, arc: 1.2 },
    ]),
    ...weavers(bar(5), 3.5, [{ y: 1.8 }, { y: 4.6 }, { y: 6.8 }]),
    ...rakers(bar(6), 4.2, [[0, 3.6]]),
    ...darts(bar(6, 1), 3.2, [
      { fromX: -20, toX: 18, y: 1.4, arc: 1.8 },
      { fromX: 20, toX: -18, y: 5.8, arc: 1.4 },
    ]),
    ...darts(bar(7), 3.2, [
      { fromX: -24, toX: 22, y: 1.2, arc: 2.6 },
      { fromX: -20, toX: 24, y: 3.2, arc: 2 },
      { fromX: 24, toX: -22, y: 5.2, arc: 1.6 },
      { fromX: 22, toX: -24, y: 7.0, arc: 1.2 },
      { fromX: -22, toX: 20, y: 8.4, arc: 0.8 },
    ]),

    // --- Surge (bars 8–11): dense crossfire, gunboats in pairs.
    ...weavers(bar(8), 3.5, [{ y: 2 }, { y: 4.4 }, { y: 6.4 }, { y: 8 }]),
    ...rakers(bar(9), 4.2, [[-5, 2.6], [5, 5.2]]),
    ...darts(bar(10), 3.1, [
      { fromX: -24, toX: 24, y: 1.6, arc: 3, delay: 0 },
      { fromX: 24, toX: -24, y: 3.4, arc: 2.4, delay: 0.22 },
      { fromX: -24, toX: 24, y: 5.2, arc: 1.8, delay: 0.44 },
      { fromX: 24, toX: -24, y: 7, arc: 1.4, delay: 0.66 },
      { fromX: -24, toX: 24, y: 4.2, arc: 2.2, delay: 0.88 },
      { fromX: 24, toX: -24, y: 2.4, arc: 2.6, delay: 1.1 },
    ]),
    ...weavers(bar(11), 3.4, [{ y: 3 }, { y: 5.6 }]),
    ...rakers(bar(11, 2), 4.0, [[0, 4.4]]),

    // --- Broadside run (bars 12–15): darts diving at the cruiser.
    ...darts(bar(12), 3.0, [
      { fromX: 24, toX: -20, y: 7.4, arc: -2 },
      { fromX: 22, toX: -22, y: 4.8, arc: -1.4 },
      { fromX: 20, toX: -18, y: 2.4, arc: -1 },
    ]),
    ...darts(bar(13), 3.0, [
      { fromX: -22, toX: 22, y: 2, arc: 2.2 },
      { fromX: -24, toX: 20, y: 4.4, arc: 1.8 },
      { fromX: 22, toX: -22, y: 6.4, arc: 1.4 },
      { fromX: 24, toX: -20, y: 8.2, arc: 1 },
    ]),
    ...rakers(bar(14), 3.8, [[-4, 5.4]]),
    ...darts(bar(14, 1), 3.0, [
      { fromX: 24, toX: -22, y: 3, arc: 2 },
      { fromX: 22, toX: -24, y: 5.6, arc: 1.6 },
      { fromX: -22, toX: 20, y: 7.6, arc: 1.2 },
    ]),
    ...weavers(bar(15), 3.3, [{ y: 2.2 }, { y: 4.4 }, { y: 6.6 }, { y: 8.4 }]),

    // --- Eye (bars 16–19): a handful of drifters among the wrecks.
    ...darts(bar(16, 2), 3.4, [
      { fromX: -16, toX: 14, y: 3, arc: 1.4, crossTime: 3.2 },
      { fromX: 16, toX: -14, y: 5.4, arc: 1.2, crossTime: 3.2 },
    ]),
    ...weavers(bar(18), 3.6, [{ y: 3.4, radius: 3.6 }, { y: 6, radius: 3.6 }]),
    ...darts(bar(19), 3.2, [
      { fromX: -20, toX: 20, y: 2.4, arc: 2 },
      { fromX: 20, toX: -20, y: 4.8, arc: 1.6 },
      { fromX: -18, toX: 18, y: 7, arc: 1.2 },
    ]),

    // --- Belly run (bars 20–23): turret racks overhead, fighters below.
    ...hullTurrets(bar(20), BELLY_TURRET_POSITIONS.slice(0, 2), 'belly', 3.6),
    ...darts(bar(20, 2), 3.0, [
      { fromX: -22, toX: 20, y: 1.2, arc: 2 },
      { fromX: 22, toX: -20, y: 3.4, arc: 1.6 },
      { fromX: -20, toX: 18, y: 5.4, arc: 1.2 },
    ]),
    ...hullTurrets(bar(21), BELLY_TURRET_POSITIONS.slice(2, 4), 'belly', 3.4),
    ...weavers(bar(21, 2), 3.4, [{ y: 2 }, { y: 4.6 }]),
    ...hullTurrets(bar(22), BELLY_TURRET_POSITIONS.slice(4, 6), 'belly', 3.2),
    ...rakers(bar(22, 1), 3.8, [[0, 3.2]]),
    ...hullTurrets(bar(23), BELLY_TURRET_POSITIONS.slice(6, 8), 'belly', 3.2),
    ...darts(bar(23, 1), 3.0, [
      { fromX: 22, toX: -20, y: 2, arc: 1.8 },
      { fromX: -22, toX: 20, y: 4.4, arc: 1.4 },
    ]),

    // --- Flagship phase 1 (bars 24–27): shield generators + point defense.
    ...genEntries,
    ...hullTurrets(bar(24), [POINT_DEFENSE_POSITIONS[0]], 'flagship', 2.6),
    ...darts(bar(24, 2), 3.0, [
      { fromX: 20, toX: -24, y: 4, arc: 2 },
      { fromX: 18, toX: -22, y: 6.4, arc: 1.4 },
    ]),
    ...hullTurrets(bar(25), [POINT_DEFENSE_POSITIONS[1]], 'flagship', 2.6),
    ...weavers(bar(25, 2), 3.3, [{ y: 3 }, { y: 5.6 }]),
    ...hullTurrets(bar(26), [POINT_DEFENSE_POSITIONS[2]], 'flagship', 2.6),
    ...darts(bar(26, 2), 3.0, [
      { fromX: 22, toX: -24, y: 2.6, arc: 2 },
      { fromX: 20, toX: -22, y: 5, arc: 1.6 },
      { fromX: 18, toX: -20, y: 7.2, arc: 1.2 },
    ]),
    ...weavers(bar(27), 3.2, [{ y: 3.6 }, { y: 6 }]),

    // --- Interlude (bars 28–29): escorts pour in around the bow.
    ...darts(bar(27, 3), 3.0, [
      { fromX: 24, toX: -20, y: 2.4, arc: 2.2 },
      { fromX: 22, toX: -22, y: 4.6, arc: 1.8 },
      { fromX: 20, toX: -24, y: 6.8, arc: 1.4 },
      { fromX: 18, toX: -18, y: 8.6, arc: 1 },
    ]),
    ...weavers(bar(28, 1), 3.1, [{ y: 3 }, { y: 5.4 }, { y: 7.4 }]),
    ...darts(bar(28, 3), 2.9, [
      { fromX: -24, toX: 22, y: 2.8, arc: 2 },
      { fromX: -22, toX: 24, y: 5, arc: 1.6 },
      { fromX: 24, toX: -22, y: 7.2, arc: 1.2 },
      { fromX: 22, toX: -24, y: 4, arc: 1.8 },
    ]),
    ...weavers(bar(29, 1), 3.0, [{ y: 4.2 }, { y: 6.6 }]),
    ...rakers(bar(29, 1.5), 3.4, [[0, 5]]),

    // --- Trench (bars 30–31): the power cores, rim turrets, chasers.
    ...coreEntries,
    ...hullTurrets(bar(30), TRENCH_TURRET_POSITIONS, 'trench', 2.4),
    ...darts(bar(30, 2), 2.8, [
      { fromX: 16, toX: -16, y: 5, arc: 1.2 },
      { fromX: -16, toX: 16, y: 7, arc: 1 },
    ]),
  ].sort((a, b) => a.time - b.time);
}

// ---- scoring -------------------------------------------------------------------

const KILL_SCORE: Record<BroadsideEnemyKind, number> = {
  dart: 100,
  weaver: 130,
  raker: 260,
  turret: 160,
  bolt: 40,
  gen: 350,
  core: 500,
};

const BOLT_MAX_AGE = 12;
const HULL_PASS_MARGIN = 0.0045;

// ---- gameplay ---------------------------------------------------------------

export function createBroadsideGameplay(bus: EventBus): LockOnRunnerLevel<BroadsideEnemyKind, BroadsideSpawnData> {
  const flagship = createFlagship(bus);
  const timeline = buildTimeline(flagship);

  const interceptions = new Set<number>();
  const kinds = new Map<number, BroadsideEnemyKind>();
  let hitsTaken = 0;
  let boltsDowned = 0;
  let turretsRaked = 0;

  bus.on('runstart', () => {
    interceptions.clear();
    kinds.clear();
    hitsTaken = 0;
    boltsDowned = 0;
    turretsRaked = 0;
  });
  bus.on('playerhit', () => {
    hitsTaken += 1;
  });
  bus.on('spawn', ({ enemyId, kind }) => {
    kinds.set(enemyId, kind as BroadsideEnemyKind);
  });
  bus.on('fire', ({ enemyId }) => {
    interceptions.add(enemyId);
  });
  bus.on('kill', ({ enemyId }) => {
    interceptions.delete(enemyId);
    const kind = kinds.get(enemyId);
    if (kind === 'bolt') boltsDowned += 1;
    if (kind === 'turret') turretsRaked += 1;
  });
  bus.on('miss', ({ enemyId }) => {
    interceptions.delete(enemyId);
  });

  function fireBolt(context: BroadsideUpdate, from: Vector3) {
    const initial = hostileShotAimPoint(context.camera, from).sub(from).normalize().multiplyScalar(5.5);
    context.spawnEnemy({
      time: context.runTime,
      kind: 'bolt',
      countsTowardTotal: false,
      data: { role: 'bolt', position: from.clone(), velocity: initial, lastAge: 0, impact: {} },
    });
  }

  // ---- movement -------------------------------------------------------------

  function updateDart(context: BroadsideUpdate, data: Extract<BroadsideSpawnData, { role: 'dart' }>) {
    const { enemy, runTime, age, curve } = context;
    const sample = pacer.sample(enemy.entry.time, runTime, data.engagement);
    const t = (age - data.delay) / data.crossTime;
    if (runTime > sample.passTime + 0.4 || t > 1.2) return true;
    const clamped = MathUtils.clamp(t, 0, 1);
    const eased = clamped * clamped * (3 - 2 * clamped);
    const x = MathUtils.lerp(data.fromX, data.toX, eased);
    const y = data.y + Math.sin(clamped * Math.PI) * data.arc;
    enemy.mesh.position.copy(offsetFromRail(curve, sample.anchorU, new Vector3(x, y, Math.sin(age * 3 + enemy.id) * 0.35)));
    // Nose into the crossing direction, banking hard into the turn.
    const aheadT = Math.min(1, eased + 0.05);
    const ahead = offsetFromRail(
      curve,
      sample.anchorU,
      new Vector3(MathUtils.lerp(data.fromX, data.toX, aheadT), data.y + Math.sin(aheadT * Math.PI) * data.arc, 0),
    );
    enemy.mesh.lookAt(ahead);
    enemy.mesh.rotateZ((data.toX > data.fromX ? -1 : 1) * 0.55);
    return false;
  }

  function updateWeaver(context: BroadsideUpdate, data: Extract<BroadsideSpawnData, { role: 'weaver' }>) {
    const { enemy, runTime, age, curve, camera } = context;
    const sample = pacer.sample(enemy.entry.time, runTime, data.engagement);
    if (runTime > sample.passTime + 0.4) return true;
    const angle = age * data.spin + data.phase;
    const offset = new Vector3(
      Math.cos(angle) * data.radius,
      data.y + Math.sin(angle) * data.radius * 0.72,
      Math.sin(age * 1.7 + enemy.id) * 0.5,
    );
    enemy.mesh.position.copy(offsetFromRail(curve, sample.anchorU, offset));
    enemy.mesh.quaternion.copy(camera.quaternion);
    enemy.mesh.rotateZ(angle * 0.6);
    return false;
  }

  function updateRaker(context: BroadsideUpdate, data: Extract<BroadsideSpawnData, { role: 'raker' }>) {
    const { enemy, runTime, age, curve, camera } = context;
    const sample = pacer.sample(enemy.entry.time, runTime, data.engagement);
    if (runTime > sample.passTime + 0.5) return true;
    const offset = data.offset.clone();
    offset.x += Math.sin(age * 0.6 + data.seed) * 2.4;
    offset.y += Math.sin(age * 0.9 + data.seed * 2.1) * 1.3;
    enemy.mesh.position.copy(offsetFromRail(curve, sample.anchorU, offset));
    enemy.mesh.quaternion.copy(camera.quaternion);
    enemy.mesh.rotateZ(Math.sin(age * 0.5 + data.seed) * 0.22);

    const fire = context.enemyState(() => ({ nextAt: 2.0 }));
    if (age >= fire.nextAt && sample.distanceAheadUnits > 14) {
      fire.nextAt = age + data.fireEvery;
      fireBolt(context, enemy.mesh.position);
    }
    return false;
  }

  function updateTurret(context: BroadsideUpdate, data: Extract<BroadsideSpawnData, { role: 'turret' }>) {
    const { enemy, runTime, runProgress, age, curve, camera } = context;
    if (runProgress > data.anchorU + HULL_PASS_MARGIN) return true;
    enemy.mesh.position.copy(offsetFromRail(curve, data.anchorU, data.offset));
    // The mount is fixed to the hull; the whole assembly yaws to track.
    const toCamera = camera.position.clone().sub(enemy.mesh.position);
    enemy.mesh.rotation.set(0, Math.atan2(toCamera.x, toCamera.z), 0);

    const fire = context.enemyState(() => ({ nextAt: data.fireEvery * (0.45 + (data.seed % 0.4)) }));
    const distance = toCamera.length();
    enemy.mesh.userData.muzzleHeat = MathUtils.clamp(1 - (fire.nextAt - age) / 0.45, 0, 1);
    if (age >= fire.nextAt && distance < 130 && distance > 10) {
      fire.nextAt = age + data.fireEvery;
      fireBolt(context, enemy.mesh.position.clone().addScaledVector(toCamera.normalize(), 1.6));
    }
    return false;
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
    });
    if (impact.phase === 'braking') {
      enemy.mesh.position.copy(data.position);
      enemy.mesh.quaternion.copy(camera.quaternion);
      enemy.mesh.rotateZ(age * 10);
      if (impact.damaged) {
        damagePlayer(1);
        return true;
      }
      return false;
    }

    steerHomingShot(data.position, data.velocity, hostileShotAimPoint(camera, data.position), age, dt, {
      baseSpeed: 6,
      maxSpeed: 14,
      accel: 3.8,
      turnRate: 2.6,
    });
    enemy.mesh.position.copy(data.position);
    if (data.velocity.lengthSq() > 0.001) enemy.mesh.lookAt(data.position.clone().add(data.velocity));
    return age > BOLT_MAX_AGE || shotBehindCamera(camera, data.position);
  }

  function updateGen(context: BroadsideUpdate, data: Extract<BroadsideSpawnData, { role: 'gen' }>) {
    const { enemy, runProgress, curve, camera } = context;
    if (runProgress > data.anchorU + HULL_PASS_MARGIN) return true;
    enemy.mesh.position.copy(offsetFromRail(curve, data.anchorU, data.offset));
    enemy.mesh.quaternion.copy(camera.quaternion);
    return false;
  }

  function updateCore(context: BroadsideUpdate, data: Extract<BroadsideSpawnData, { role: 'core' }>) {
    const { enemy, runProgress, age, curve, camera } = context;
    if (runProgress > data.anchorU + HULL_PASS_MARGIN) return true;
    enemy.mesh.position.copy(offsetFromRail(curve, data.anchorU, data.offset));
    enemy.mesh.quaternion.copy(camera.quaternion);
    enemy.mesh.rotateZ(age * 1.4 + data.index * 2.1);
    return false;
  }

  return {
    duration: BROADSIDE_DURATION,
    bpm: BROADSIDE_BPM,
    playerHealth: BROADSIDE_PLAYER_HEALTH,
    createRail: createBroadsideRail,
    spawnTimeline: timeline,
    easeRunProgress: broadsideRunProgress,
    startWord: 'LAUNCH',
    replayWord: 'REJOIN',
    updateEnemy(context) {
      const data = context.enemy.entry.data;
      switch (data.role) {
        case 'dart':
          return updateDart(context, data);
        case 'weaver':
          return updateWeaver(context, data);
        case 'raker':
          return updateRaker(context, data);
        case 'turret':
          return updateTurret(context, data);
        case 'bolt':
          return updateBolt(context, data);
        case 'gen':
          return updateGen(context, data);
        case 'core':
          return updateCore(context, data);
      }
    },
    scoreForKill(volleySize, enemy) {
      const multiplier = 1 + Math.max(0, volleySize - 1) * 0.18;
      return Math.round(KILL_SCORE[enemy.kind] * multiplier);
    },
    scoreForHit: () => 40,
    scoreForVolley(results) {
      // A full, perfect volley is the level's signature play; pay it like one.
      if (results.length < 4) return 0;
      if (!results.every((result) => result.killed)) return 0;
      return results.length === 6 ? 500 : results.length * 60;
    },
    rankForRun(score, kills, totalEnemies) {
      const clearRate = totalEnemies === 0 ? 0 : kills / totalEnemies;
      if (flagship.destroyed() && score >= 15000 && clearRate >= 0.72) return 'S';
      if (score >= 10500 && clearRate >= 0.52) return 'A';
      if (score >= 6000 && clearRate >= 0.33) return 'B';
      if (score >= 2800 && clearRate >= 0.15) return 'C';
      return 'D';
    },
    detailsForRun() {
      const hull = Math.max(0, BROADSIDE_PLAYER_HEALTH - hitsTaken);
      const lines = [`Hull ${hull}/${BROADSIDE_PLAYER_HEALTH}`];
      if (turretsRaked > 0) lines.push(`${turretsRaked} turret${turretsRaked === 1 ? '' : 's'} raked`);
      if (boltsDowned > 0) lines.push(`${boltsDowned} bolt${boltsDowned === 1 ? '' : 's'} intercepted`);
      lines.push(...flagship.summaryLines());
      return lines;
    },
  };
}
