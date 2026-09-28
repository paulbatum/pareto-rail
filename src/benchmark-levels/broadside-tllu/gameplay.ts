import { MathUtils, Vector3 } from 'three';
import {
  shotBehindCamera,
  updateHostileShotImpact,
  type HostileShotImpactState,
} from '../../engine/hostile-shot';
import type { LockOnEnemyUpdate, LockOnRunnerLevel, LockOnSpawnEntry } from '../../engine/lock-on-runner';
import { createRailPacer, type RailLead } from '../../engine/rail-pacer';
import { offsetFromRail, sampleRailFrame } from '../../engine/rail';
import { sortTimeline } from '../../engine/spawn-patterns';
import type { EventBus } from '../../events';
import {
  BELLY_MOUNTS_LOCAL,
  broadsideProgress,
  createBroadsideRail,
  FLAGSHIP_GENS_WORLD,
  FLAGSHIP_PD_WORLD,
  railUNearest,
  RAIL_LENGTH_UNITS,
  shipToWorld,
  SHIPS,
  timeAtRailU,
  TRENCH_CORES_WORLD,
  TRENCH_HEART_WORLD,
  TRENCH_PD_WORLD,
} from './battlefield';
import { BARS, BROADSIDE_TLLU_BPM, BROADSIDE_TLLU_RUN_DURATION, BROADSIDE_TLLU_TIME } from './timing';

export { BROADSIDE_TLLU_BPM, BROADSIDE_TLLU_RUN_DURATION, BROADSIDE_TLLU_TIME } from './timing';

export type BroadsideEnemyKind = 'dart' | 'raker' | 'bomber' | 'turret' | 'pdgun' | 'gen' | 'core' | 'heart' | 'bolt';

type Pattern = 'sweep' | 'weave' | 'cross' | 'helix' | 'lumber' | 'drift' | 'stream';
type FlyerData = {
  role: 'flyer';
  pattern: Pattern;
  engagement: RailLead;
  x: number;
  y: number;
  /** Which side the craft enters from (+1 right, -1 left). Helix: spin direction. */
  dir: 1 | -1;
  /** Cross pattern: where the craft ends up (default: mirrored across the rail). */
  endX?: number;
  phase: number;
  /** Bolts launched at these ages (seconds), for gunships. */
  fireAt?: number[];
};
type MountData = {
  role: 'mount';
  world: Vector3;
  order: number;
  /** Rail fraction where the camera is closest to this mount. */
  passU: number;
  variant?: 'belly' | 'pd' | 'trench';
  /** Ages at which the mount launches a bolt. */
  fireAt?: number[];
};
type BoltData = {
  role: 'bolt';
  rel: Vector3;
  start: Vector3;
  aim: Vector3;
  closing: number;
  position: Vector3;
  velocity: Vector3;
  impact: HostileShotImpactState;
  lastAge: number;
};
export type BroadsideSpawnData = FlyerData | MountData | BoltData;
export type BroadsideSpawn = LockOnSpawnEntry<BroadsideEnemyKind, BroadsideSpawnData>;
type BroadsideUpdate = LockOnEnemyUpdate<BroadsideEnemyKind, BroadsideSpawnData>;
type LockOnUpdateCamera = BroadsideUpdate['camera'];

const bar = (value: number, beat = 0) => BROADSIDE_TLLU_TIME.bar(value, beat);
const step = (barIndex: number, stepInBar: number) => BROADSIDE_TLLU_TIME.step(barIndex, stepInBar);

// ---- tuning ------------------------------------------------------------------------

const SPAWN_AHEAD_UNITS = 64;
const DEFAULT_LEAD_SECONDS = 3.2;
const PLAYER_HULL = 4;
const GEN_SEAL_SECONDS = 0.9;
/** Hull-fixed targets appear earlier than swarm craft: the rail passes them at speed and they need a readable window. */
const MOUNT_AHEAD_UNITS: Record<'turret' | 'pdgun' | 'gen' | 'core' | 'heart', number> = { turret: 122, pdgun: 104, gen: 112, core: 96, heart: 104 };
/** Mounts stay targetable (and shots stay homed) until this far behind the camera. */
const MOUNT_LINGER_UNITS = 46;
/** Flagship reactor deadline: past this the fleet's fire finishes it, ready or not. */
export const HEART_DEADLINE = bar(BARS.victory) - 0.03;
const HEART_UNSEAL_TIME = bar(BARS.trench + 0.85);
const BOLT_BASE_CLOSING = 15;
const BOLT_ACCEL = 4.5;
const BOLT_MAX_CLOSING = 24;

const SCORE: Record<BroadsideEnemyKind, number> = {
  dart: 100,
  raker: 140,
  bomber: 260,
  turret: 180,
  pdgun: 150,
  gen: 600,
  core: 900,
  heart: 3000,
  bolt: 40,
};

const RAIL = createBroadsideRail();
const pacer = createRailPacer({
  curve: RAIL,
  duration: BROADSIDE_TLLU_RUN_DURATION,
  runProgress: broadsideProgress,
  spawnAheadUnits: SPAWN_AHEAD_UNITS,
  defaultLeadSeconds: DEFAULT_LEAD_SECONDS,
});

export function createBroadsideTlluRail() {
  return createBroadsideRail();
}

// ---- spawn authoring ------------------------------------------------------------------

type FlyerOptions = { lead?: number; fireAt?: number[]; hp?: number; endX?: number };
type Slot = readonly [x: number, y: number];

function flyer(
  kind: 'dart' | 'raker' | 'bomber',
  time: number,
  pattern: Pattern,
  [x, y]: Slot,
  dir: 1 | -1,
  index: number,
  options: FlyerOptions = {},
): BroadsideSpawn {
  const lead = options.lead ?? (pattern === 'lumber' ? 3.9 : pattern === 'drift' ? 4.6 : pattern === 'helix' ? 3.5 : 3.1);
  return {
    time,
    kind,
    ...(kind === 'bomber' ? { hitPoints: options.hp ?? 2 } : {}),
    data: {
      role: 'flyer',
      pattern,
      engagement: pacer.resolve(time, lead),
      x,
      y,
      dir,
      phase: index * 1.91 + time * 0.7,
      ...(options.endX !== undefined ? { endX: options.endX } : {}),
      ...(options.fireAt ? { fireAt: options.fireAt } : {}),
    },
  };
}

/** A wave of craft stamped on the eighth-note grid from `startStep` of `barIndex`. */
function wave(
  kind: 'dart' | 'raker' | 'bomber',
  barIndex: number,
  startStep: number,
  pattern: Pattern,
  slots: readonly Slot[],
  dir: 1 | -1 | 'alternate',
  options: FlyerOptions & { gap?: number; endXs?: readonly number[] } = {},
): BroadsideSpawn[] {
  const gap = options.gap ?? 2;
  return slots.map((slot, index) => flyer(
    kind,
    step(barIndex, startStep + index * gap),
    pattern,
    slot,
    dir === 'alternate' ? (index % 2 === 0 ? 1 : -1) : dir,
    index,
    { ...options, endX: options.endXs?.[index] },
  ));
}

/** Corkscrew tripod: three gunships 120 degrees apart around one axis. */
function tripod(barIndex: number, startStep: number, center: Slot, spin: 1 | -1, options: FlyerOptions = {}): BroadsideSpawn[] {
  return [0, 1, 2].map((arm) => {
    const spawn = flyer('raker', step(barIndex, startStep + arm), 'helix', center, spin, arm, options);
    (spawn.data as FlyerData).phase = (arm / 3) * Math.PI * 2;
    return spawn;
  });
}

type MountOptions = { variant?: MountData['variant']; hitStages?: number[]; hitPoints?: number; fireAt?: number[]; lockable?: boolean; spawnAt?: number; notBefore?: number };

/** A hull-mounted target: fixed in the world, spawned when the camera is one visibility window away. */
function mount(kind: 'turret' | 'pdgun' | 'gen' | 'core' | 'heart', world: Vector3, order: number, options: MountOptions = {}): BroadsideSpawn {
  const passU = railUNearest(world);
  const spawnU = Math.max(0, passU - (MOUNT_AHEAD_UNITS[kind] * 1.02) / RAIL_LENGTH_UNITS);
  // Snap to the sixteenth grid at or before the ideal moment so pop-ins land on the music.
  const raw = timeAtRailU(spawnU);
  const snapped = Math.floor(raw / BROADSIDE_TLLU_TIME.stepSeconds) * BROADSIDE_TLLU_TIME.stepSeconds;
  const time = options.spawnAt ?? Math.max(snapped, options.notBefore ?? 0);
  return {
    time,
    kind,
    ...(options.hitStages ? { hitStages: options.hitStages } : {}),
    ...(options.hitPoints ? { hitPoints: options.hitPoints } : {}),
    ...(options.lockable === false ? { lockable: false } : {}),
    data: {
      role: 'mount',
      world,
      order,
      passU,
      ...(options.variant ? { variant: options.variant } : {}),
      ...(options.fireAt ? { fireAt: options.fireAt } : {}),
    },
  };
}

const belly = SHIPS.find((ship) => ship.id === 'belly')!;
const bellyMount = (lx: number, lz: number) => shipToWorld(belly, new Vector3(lx, -belly.height / 2 - 5, lz));

/** World-space anchors the visual layer needs to dress (gens, cores, heart). */
export const BOSS_ANCHORS = {
  gens: FLAGSHIP_GENS_WORLD,
  cores: TRENCH_CORES_WORLD,
  heart: TRENCH_HEART_WORLD,
} as const;

const TURRET_ENTRIES: BroadsideSpawn[] = BELLY_MOUNTS_LOCAL.map(([lx, lz], index) => mount('turret', bellyMount(lx, lz), index, {
  variant: 'belly',
  // The eye stays clear of targets: the battery deploys only as the rail commits to the belly run.
  notBefore: bar(BARS.belly - 0.25),
  // Belly guns open fire a beat after they deploy; the stagger keeps the volleys from stacking.
  fireAt: [1.1 + (index % 3) * 0.2],
}));

const GEN_ENTRIES: BroadsideSpawn[] = BOSS_ANCHORS.gens.map((world, index) => mount('gen', world, index, {
  hitStages: [2],
  lockable: index === 0,
  fireAt: [1.8, 3.4],
}));

const PD_ENTRIES: BroadsideSpawn[] = FLAGSHIP_PD_WORLD.map((world, index) => mount('pdgun', world, index, {
  variant: 'pd',
  fireAt: [1.0 + (index % 4) * 0.12],
}));

const CORE_ENTRIES: BroadsideSpawn[] = BOSS_ANCHORS.cores.map((world, index) => mount('core', world, index, {
  hitStages: [2],
  variant: 'trench',
  fireAt: index === 0 ? [1.5] : [1.3],
}));

const HEART_ENTRY: BroadsideSpawn = {
  ...mount('heart', BOSS_ANCHORS.heart, 0, { hitStages: [2, 2], lockable: false, variant: 'trench', spawnAt: bar(BARS.trench + 0.25) }),
};

const TRENCH_PD: BroadsideSpawn[] = TRENCH_PD_WORLD.map((world, index) => mount('pdgun', world, index, {
  variant: 'trench',
  fireAt: [1.2 - index * 0.2],
}));

/** Sequence of shielded-then-open boss parts: the entries that reset each run. */

function buildTimeline(): BroadsideSpawn[] {
  // Slot vocabulary: x in [-34, 34] and y in [-17, 17] read as full-width, full-height sweeps at ~35 units.
  return sortTimeline<BroadsideEnemyKind, BroadsideSpawnData>([
    // ---- crossfire: the swarm knots through the gap ----
    ...wave('dart', 2, 0, 'sweep', [[-20, 5], [-7, -6], [8, 4], [21, -5]], 1),
    ...wave('dart', 3, 0, 'sweep', [[23, 7], [9, -5], [-6, 5], [-21, -4]], -1),
    ...tripod(4, 0, [0, 1], 1),
    ...wave('dart', 4, 8, 'weave', [[-26, 10], [26, -9]], 'alternate', { gap: 3 }),
    ...wave('dart', 5, 8, 'cross', [[-27, 11], [27, 5], [-27, -1], [27, -7], [-27, -12], [27, 14]], 'alternate', { gap: 2, lead: 3.4 }),
    ...wave('bomber', 6, 8, 'lumber', [[-12, 7]], 1, { fireAt: [1.5] }),
    ...wave('dart', 6, 10, 'weave', [[24, -8], [-24, 9]], 'alternate', { gap: 2 }),
    ...tripod(6, 4, [3, 0], -1),
    ...wave('dart', 7, 6, 'sweep', [[-26, 12], [-14, -12], [0, 13], [14, -13], [27, 11], [30, -6]], 1, { gap: 2 }),
    ...wave('bomber', 8, 0, 'lumber', [[-10, -8], [19, 8]], 1, { gap: 4, fireAt: [1.4] }),
    ...wave('dart', 8, 8, 'weave', [[4, 14], [12, -14], [-2, 0], [25, 3]], 1, { gap: 2 }),

    // ---- broadside: the long flank run under the friendly guns ----
    ...wave('dart', 9, 0, 'sweep', [[-10, 9], [-1, 3], [8, -3], [17, -9], [26, -14]], 1, { gap: 2 }),
    ...wave('dart', 10, 0, 'sweep', [[0, 12], [11, 8], [22, 3], [30, -3], [22, -11], [10, -14]], 1, { gap: 2 }),
    ...wave('bomber', 11, 0, 'lumber', [[30, 9], [40, -7]], 1, { gap: 4, fireAt: [1.5] }),
    ...wave('dart', 11, 8, 'weave', [[2, 13], [14, -12], [33, 6]], 1, { gap: 2 }),
    ...tripod(12, 0, [24, 2], 1),
    ...wave('dart', 12, 8, 'cross', [[40, 13], [-6, 8], [40, -3], [-6, -6], [40, -13], [-6, 14]], 'alternate', { gap: 2, lead: 3.4, endXs: [-6, 40, -6, 40, -6, 40] }),
    ...wave('dart', 13, 8, 'sweep', [[-6, -12], [6, 12], [18, -8], [30, 10], [40, -4], [10, 0]], 1, { gap: 2 }),
    ...wave('bomber', 14, 0, 'lumber', [[22, 10], [36, -9]], 1, { gap: 3, fireAt: [1.4] }),
    ...wave('dart', 14, 6, 'weave', [[2, 5], [14, -6], [36, 5], [8, 12]], 1, { gap: 2 }),

    // ---- the eye: stragglers drifting through the wreck field ----
    ...wave('dart', 15, 12, 'drift', [[-12, 6], [10, -6], [26, 4]], 'alternate', { gap: 6 }),
    ...wave('dart', 16, 12, 'drift', [[-4, 10], [16, 8], [-12, -8], [22, -9]], 'alternate', { gap: 6 }),
    ...wave('dart', 17, 10, 'drift', [[0, 4], [-18, -2], [18, -3]], 'alternate', { gap: 5 }),

    // ---- belly: the enemy warship's battery, plus fighters falling out of its hangars ----
    ...TURRET_ENTRIES,
    ...wave('dart', 18, 8, 'sweep', [[-18, -8], [-4, -12], [10, -7], [24, -10]], 'alternate', { gap: 2 }),
    ...wave('dart', 19, 10, 'weave', [[-24, -6], [24, -6], [0, -12]], 'alternate', { gap: 2 }),
    ...wave('dart', 20, 4, 'cross', [[-26, -3], [26, -9], [-26, -11], [26, 0]], 'alternate', { gap: 2 }),

    // ---- flagship pass: generators one by one under point-defense fire ----
    ...GEN_ENTRIES,
    ...PD_ENTRIES,

    // ---- escorts: the shield falls and the flagship's fighters pour out ----
    ...wave('dart', 24, 0, 'sweep', [[-2, 9], [26, 11], [8, 5], [34, 8], [16, 12], [40, 7]], 1, { gap: 2, lead: 3.0 }),
    ...tripod(24, 8, [14, 10], -1, { lead: 3.3 }),
    ...wave('bomber', 24, 12, 'lumber', [[-4, 13], [14, 12]], 1, { gap: 4, lead: 3.2, fireAt: [1.2] }),
    ...wave('dart', 25, 2, 'cross', [[-15, 12], [15, 8], [-15, 4], [15, 2], [-15, 14], [15, 6]], 'alternate', { gap: 2, lead: 2.8, endXs: [15, -15, 15, -15, 15, -15] }),

    // ---- trench: the reactor ----
    ...wave('dart', 27, 4, 'stream', [[-12, -6], [12, -8], [0, 6], [-8, 2]], 1, { gap: 3, lead: 2.6 }),
    ...CORE_ENTRIES,
    ...TRENCH_PD,
    HEART_ENTRY,
  ]);
}

export const BROADSIDE_TLLU_SPAWN_TIMELINE: BroadsideSpawn[] = buildTimeline();

// ---- motion -----------------------------------------------------------------------

const easeOutCubic = (t: number) => 1 - (1 - MathUtils.clamp(t, 0, 1)) ** 3;
const scratchDirection = new Vector3();
const scratchTarget = new Vector3();
const camRight = new Vector3();
const camUp = new Vector3();
const camForward = new Vector3();

/** The camera's own axes: hostile shots converge on what the player is actually looking at. */
function cameraBasis(camera: LockOnUpdateCamera) {
  camera.updateMatrixWorld();
  camRight.setFromMatrixColumn(camera.matrixWorld, 0).normalize();
  camUp.setFromMatrixColumn(camera.matrixWorld, 1).normalize();
  camForward.setFromMatrixColumn(camera.matrixWorld, 2).normalize().negate();
}

type EnemyRuntime = { lastX: number; lastY: number; lastAge: number; vx: number; vy: number; next: number };

export function createBroadsideTlluGameplay(bus: EventBus): LockOnRunnerLevel<BroadsideEnemyKind, BroadsideSpawnData> {
  const intercepted = new Set<number>();
  let hitsTaken = 0;
  let boltsShot = 0;
  let gensResolved = 0;
  let coresResolved = 0;
  let shieldDown = false;
  let bossOver = false;
  const gensById = new Set<number>();
  const passedGens = new Set<number>();
  const coresById = new Set<number>();
  let heartId = -1;

  function reset() {
    intercepted.clear();
    gensById.clear();
    passedGens.clear();
    heartId = -1;
    coresById.clear();
    hitsTaken = 0;
    boltsShot = 0;
    gensResolved = 0;
    coresResolved = 0;
    shieldDown = false;
    bossOver = false;
    for (const entry of GEN_ENTRIES) entry.lockable = (entry.data as MountData).order === 0;
    HEART_ENTRY.lockable = false;
  }
  reset();

  function resolveGen(enemyId: number) {
    if (!gensById.delete(enemyId)) return;
    gensResolved += 1;
    for (const entry of GEN_ENTRIES) if ((entry.data as MountData).order <= gensResolved) entry.lockable = true;
    if (gensResolved >= GEN_ENTRIES.length && !shieldDown) {
      shieldDown = true;
      bus.emit('bossphase', { phase: 'summoned' });
    }
  }
  function resolveCore(enemyId: number) {
    if (!coresById.delete(enemyId)) return;
    coresResolved += 1;
  }

  bus.on('runstart', reset);
  bus.on('spawn', ({ enemyId, kind }) => {
    if (kind === 'gen') gensById.add(enemyId);
    if (kind === 'core') coresById.add(enemyId);
    if (kind === 'core' && coresById.size + coresResolved === 1) bus.emit('bossphase', { phase: 'exposed' });
  });
  bus.on('fire', ({ enemyId }) => intercepted.add(enemyId));
  bus.on('kill', ({ enemyId }) => {
    intercepted.delete(enemyId);
    resolveGen(enemyId);
    resolveCore(enemyId);
  });
  bus.on('miss', ({ enemyId }) => {
    intercepted.delete(enemyId);
    // A generator only counts as resolved when the rail actually passed it; the run-ending sweep that
    // "misses" everything alive must not read as the shield falling.
    if (gensById.has(enemyId) && !passedGens.has(enemyId)) gensById.delete(enemyId);
    else resolveGen(enemyId);
    resolveCore(enemyId);
  });
  bus.on('playerhit', () => { hitsTaken += 1; });

  // -- hostile bolts, flown in the camera's frame so they stay interceptable at any rail speed --

  function launchBolt(context: BroadsideUpdate, from: Vector3, closing = BOLT_BASE_CLOSING) {
    cameraBasis(context.camera);
    const d = from.clone().sub(context.camera.position);
    const rel = new Vector3(d.dot(camRight), d.dot(camUp), d.dot(camForward));
    // Keep the line of sight from the camera to the shooter: pull far shooters' shots in along it,
    // and skip shooters already too close to read as a launch.
    if (rel.z < 20) return;
    if (rel.z > 68) rel.multiplyScalar(68 / rel.z);
    context.spawnEnemy({
      time: context.runTime,
      kind: 'bolt',
      countsTowardTotal: false,
      data: {
        role: 'bolt',
        rel,
        start: rel.clone(),
        aim: new Vector3(Math.sin(context.enemy.id * 2.3) * 0.4, Math.cos(context.enemy.id * 1.7) * 0.3, 0),
        closing,
        position: from.clone(),
        velocity: new Vector3(),
        impact: {},
        lastAge: 0,
      },
    });
  }

  function placeBolt(context: BroadsideUpdate, data: BoltData) {
    data.position.copy(context.camera.position)
      .addScaledVector(camRight, data.rel.x)
      .addScaledVector(camUp, data.rel.y)
      .addScaledVector(camForward, data.rel.z);
  }

  function updateBolt(context: BroadsideUpdate, data: BoltData) {
    const dt = MathUtils.clamp(context.age - data.lastAge, 0, 0.1);
    data.lastAge = context.age;
    cameraBasis(context.camera);
    // Re-seat the bolt on the camera's current axes before testing for impact: the camera moves
    // meters per frame at rail speed, so last frame's position is already stale.
    if (data.impact.impactAt === undefined) placeBolt(context, data);
    const impact = updateHostileShotImpact({
      age: context.age,
      camera: context.camera,
      position: data.position,
      velocity: data.velocity,
      state: data.impact,
      intercepted: intercepted.delete(context.enemy.id),
    });
    if (impact.phase === 'braking') {
      context.enemy.mesh.position.copy(data.position);
      if (impact.damaged) {
        context.damagePlayer(1);
        return true;
      }
      return false;
    }
    const closing = Math.min(BOLT_MAX_CLOSING, data.closing + context.age * BOLT_ACCEL);
    // Held just in front of the cockpit until the impact timer takes over: at rail speeds a bolt could
    // otherwise step clean through the camera between frames.
    data.rel.z = Math.max(1.7, data.rel.z - closing * dt);
    // A straight line to the player's center: lateral offset falls away in step with the remaining range.
    const remaining = MathUtils.clamp(data.rel.z / data.start.z, 0, 1);
    data.rel.x = data.aim.x + (data.start.x - data.aim.x) * remaining;
    data.rel.y = data.aim.y + (data.start.y - data.aim.y) * remaining;
    placeBolt(context, data);
    context.enemy.mesh.position.copy(data.position);
    // Fly-through pose: the tracer's long axis points along its closing vector.
    scratchTarget.copy(context.camera.position).addScaledVector(camRight, data.aim.x).addScaledVector(camUp, data.aim.y);
    context.enemy.mesh.lookAt(scratchTarget);
    context.enemy.mesh.rotateZ(context.age * 4.5);
    return context.age > 9 || shotBehindCamera(context.camera, data.position, 6);
  }

  // -- swarm craft --

  function updateFlyer(context: BroadsideUpdate, data: FlyerData) {
    const pace = pacer.sample(context.enemy.entry.time, context.runTime, data.engagement);
    const anchor = pace.anchorU;
    const age = context.age;
    const lead = data.engagement.leadSeconds;
    const remaining = lead - age;
    let x = data.x;
    let y = data.y;

    switch (data.pattern) {
      case 'sweep': {
        const e = easeOutCubic(age / 1.35);
        x = MathUtils.lerp(data.dir * 46, data.x, e) + Math.sin(age * 2.6 + data.phase) * 1.7 * e;
        y = data.y + Math.sin(age * 3.1 + data.phase * 1.3) * 1.6 * e + (1 - e) * (data.y > 0 ? 9 : -9);
        break;
      }
      case 'weave': {
        const e = easeOutCubic(age / 1.1);
        const swing = Math.sin(age * 1.9 + data.phase);
        x = MathUtils.lerp(data.dir * 44, data.x, e) - data.dir * swing * 12 * e;
        y = data.y + Math.sin(age * 2.5 + data.phase * 0.6) * 5.5 * e;
        break;
      }
      case 'cross': {
        const t = MathUtils.clamp(age / (lead * 0.9), 0, 1);
        x = MathUtils.lerp(data.x, data.endX ?? -data.x, t * t * (3 - 2 * t));
        y = data.y + Math.sin(t * Math.PI) * (data.y > 0 ? 5 : -5) + Math.sin(age * 4 + data.phase) * 0.9;
        break;
      }
      case 'helix': {
        const e = easeOutCubic(age / 1.5);
        const radius = MathUtils.lerp(30, 15, e);
        const theta = data.phase + data.dir * age * 1.05;
        x = data.x + Math.cos(theta) * radius;
        y = data.y + Math.sin(theta) * radius * 0.78;
        break;
      }
      case 'lumber': {
        const e = easeOutCubic(age / 1.8);
        x = MathUtils.lerp(data.dir * 40, data.x, e) + Math.sin(age * 0.95 + data.phase) * 5;
        y = data.y + Math.sin(age * 1.35 + data.phase) * 2.6;
        break;
      }
      case 'stream': {
        // Fighters boiling out of the trench's far end: they rise from the centerline to their slot.
        const e = easeOutCubic(age / 0.9);
        x = data.x * e + Math.sin(age * 1.9 + data.phase) * 3.2 * e;
        y = data.y * e + Math.sin(age * 2.4 + data.phase * 0.7) * 2.2 * e;
        break;
      }
      case 'drift': {
        const e = easeOutCubic(age / 2.2);
        x = MathUtils.lerp(data.dir * 30, data.x, e) + Math.cos(age * 0.62 + data.phase) * 5;
        y = data.y + Math.sin(age * 0.8 + data.phase) * 3.5;
        break;
      }
    }

    // Peel-off: just before the camera overtakes, strafers break away rather than being simply passed.
    if (data.pattern !== 'helix' && data.pattern !== 'drift' && remaining < 0.7) {
      const p = MathUtils.clamp((0.7 - remaining) / 0.7, 0, 1);
      x += Math.sign(x || data.dir) * p * p * 9;
      y += (data.y >= 0 ? 1 : -1) * p * p * 4;
    }

    const world = offsetFromRail(context.curve, anchor, scratchDirection.set(x, y, 0));
    const state = runtime(context, x, y);
    const dt = age - state.lastAge;
    if (dt > 1e-4) {
      state.vx = MathUtils.lerp(state.vx, (x - state.lastX) / dt, 0.35);
      state.vy = MathUtils.lerp(state.vy, (y - state.lastY) / dt, 0.35);
      state.lastX = x;
      state.lastY = y;
      state.lastAge = age;
    }
    context.enemy.mesh.position.copy(world);

    // Face along the craft's velocity relative to the camera (lateral motion plus the slow closing rate).
    const frame = sampleRailFrame(context.curve, anchor);
    const closingRate = Math.max(6, (pace.distanceAheadUnits / Math.max(0.4, remaining)) * 0.9);
    scratchTarget.copy(world)
      .addScaledVector(frame.right, state.vx * 0.12)
      .addScaledVector(frame.up, state.vy * 0.12)
      .addScaledVector(frame.tangent, -closingRate * 0.08);
    context.enemy.mesh.lookAt(scratchTarget);
    context.enemy.mesh.rotateZ(MathUtils.clamp(-state.vx * 0.035, -1.1, 1.1) + (data.pattern === 'helix' ? age * 3 * data.dir : 0));

    fireScheduled(context, data.fireAt, world);

    const passed = context.runProgress > pace.anchorU + 0.004 && age > lead - 0.15;
    return passed || age > lead + 1.6;
  }

  /** One mutable state object per enemy instance: flyers use the motion fields, everything shares the fire cursor. */
  function runtime(context: BroadsideUpdate, x = 0, y = 0) {
    return context.enemyState<EnemyRuntime>(() => ({ lastX: x, lastY: y, lastAge: context.age, vx: 0, vy: 0, next: 0 }));
  }

  function fireScheduled(context: BroadsideUpdate, fireAt: number[] | undefined, from: Vector3, closing = BOLT_BASE_CLOSING) {
    if (!fireAt || fireAt.length === 0) return;
    const state = runtime(context);
    while (state.next < fireAt.length && context.age >= fireAt[state.next]) {
      state.next += 1;
      launchBolt(context, from, closing);
    }
  }

  // -- hull-fixed targets --

  function updateMount(context: BroadsideUpdate, data: MountData) {
    const kind = context.enemy.kind;
    const mesh = context.enemy.mesh;
    mesh.position.copy(data.world);
    const bob = kind === 'gen' || kind === 'heart' || kind === 'core' ? Math.sin(context.age * 1.7 + data.order) * 0.25 : 0;
    mesh.position.y += bob;

    // Turrets, generators, and cores track the camera; the visual layer animates parts from userData.
    const frame = sampleRailFrame(context.curve, context.runProgress);
    const toCamera = scratchDirection.copy(frame.position).sub(mesh.position);
    mesh.userData.range = toCamera.length();
    mesh.lookAt(frame.position);

    if (kind === 'gen') {
      // Each generator unseals when the one before it falls, or after a short seal so a slow player is not gated.
      if (!context.enemy.entry.lockable && context.age > GEN_SEAL_SECONDS) context.enemy.entry.lockable = true;
      mesh.userData.sealed = !context.enemy.entry.lockable;
      mesh.userData.charge = MathUtils.clamp(context.age / 1.6, 0, 1);
    } else if (kind === 'heart') {
      const unsealed = coresResolved >= CORE_ENTRIES.length || context.runTime >= HEART_UNSEAL_TIME;
      context.enemy.entry.lockable = unsealed;
      mesh.userData.sealed = !unsealed;
    }

    if (kind === 'turret' || kind === 'pdgun' || kind === 'gen' || kind === 'core') {
      fireScheduled(context, data.fireAt, data.world, kind === 'turret' || kind === 'pdgun' ? 20 : 19);
    }

    if (kind === 'heart' || kind === 'core') {
      if (context.runTime >= HEART_DEADLINE && kind === 'heart' && !bossOver) {
        bossOver = true;
        bus.emit('bossphase', { phase: 'destroyed' });
        return true;
      }
      if (context.runTime >= HEART_DEADLINE) return true;
      return false;
    }

    const ahead = frame.tangent.dot(scratchDirection.copy(data.world).sub(frame.position));
    const despawn = ahead < -MOUNT_LINGER_UNITS || (kind === 'gen' && context.runTime > bar(BARS.escorts) + 0.6);
    if (despawn && kind === 'gen') passedGens.add(context.enemy.id);
    return despawn;
  }

  bus.on('spawn', ({ enemyId, kind }) => { if (kind === 'heart') heartId = enemyId; });
  bus.on('kill', ({ enemyId }) => {
    if (heartId >= 0 && enemyId === heartId && !bossOver) {
      bossOver = true;
      bus.emit('bossphase', { phase: 'destroyed' });
    }
  });

  return {
    duration: BROADSIDE_TLLU_RUN_DURATION,
    bpm: BROADSIDE_TLLU_BPM,
    playerHealth: PLAYER_HULL,
    createRail: createBroadsideTlluRail,
    spawnTimeline: BROADSIDE_TLLU_SPAWN_TIMELINE,
    easeRunProgress: broadsideProgress,
    lockRadiusNdc: 0.12,
    startWord: 'ENGAGE',
    replayWord: 'REARM',
    timing: { shotDelay: { maxGridSeconds: 0.24 }, actionSfx: { gridThirtyseconds: 2 } },
    updateEnemy(context) {
      // The flagship is dead: whatever is left of its fighters and fire falls away with it.
      if (bossOver && context.enemy.kind !== 'heart') return true;
      const data = context.enemy.entry.data;
      if (data.role === 'flyer') return updateFlyer(context, data);
      if (data.role === 'bolt') return updateBolt(context, data);
      return updateMount(context, data);
    },
    scoreForKill(volleySize, enemy) {
      if (enemy.kind === 'bolt') boltsShot += 1;
      return Math.round(SCORE[enemy.kind] * (1 + Math.max(0, volleySize - 1) * 0.25));
    },
    scoreForHit: () => 60,
    scoreForVolley: (results) => (results.length >= 6 && results.every((result) => result.killed) ? 600 : 0),
    rankForRun(_score, kills, total) {
      const ratio = total ? kills / total : 0;
      if (ratio >= 0.66 && hitsTaken === 0) return 'FLEET ADMIRAL';
      if (ratio >= 0.55) return 'COMMODORE';
      if (ratio >= 0.4) return 'WING LEADER';
      return 'ENSIGN';
    },
    detailsForRun: () => [
      `HULL ${Math.max(0, PLAYER_HULL - hitsTaken)}/${PLAYER_HULL}`,
      `GENERATORS ${Math.min(GEN_ENTRIES.length, gensResolved)}/${GEN_ENTRIES.length}`,
      `FLAK INTERCEPTED ${boltsShot}`,
    ],
  };
}
