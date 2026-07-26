import { CatmullRomCurve3, MathUtils, Vector3 } from 'three';
import type { Object3D } from 'three';
import {
  hostileShotAimPoint,
  shotBehindCamera,
  steerHomingShot,
  updateHostileShotImpact,
} from '../../engine/hostile-shot';
import type { LockOnEnemyUpdate, LockOnRunnerLevel, LockOnSpawnEntry } from '../../engine/lock-on-runner';
import { offsetFromRail } from '../../engine/rail';
import { createSpeedProfile } from '../../engine/speed-profile';
import { formation, sortTimeline } from '../../engine/spawn-patterns';
import type { EventBus } from '../../events';
import { createGlueSpill, type SpillCallout, type SpillSpawnData } from './spill';
import { TINKER_BPM, TINKER_MARKERS, TINKER_RUN_DURATION, TINKER_TIME } from './timing';

// Spine: the rail, the speed curve, the wave book, and how every glue creature
// moves. One oversized worktable, three scales of ball, and a spill at the end.
//
// Waves are authored in screen fractions rather than world units. The table's
// apparent size changes across the run — the camera climbs as the ball grows
// and the rail speeds up — so a fixed world offset would drift from filling the
// frame to hugging the middle. `aheadUnits` converts an authored fraction into
// the world offset that lands there at the moment the wave is seen.

export { TINKER_BPM, TINKER_RUN_DURATION } from './timing';
export const TINKER_PLAYER_HEALTH = 3;
export const TABLE_Y = 0;

export type TinkerEnemyKind =
  | 'beetle'
  | 'strider'
  | 'bird'
  | 'spool'
  | 'potter'
  | 'ruler'
  | 'blob'
  | 'crust'
  | 'core'
  | 'heart';

export type TinkerMotion = 'scuttle' | 'stride' | 'swoop' | 'roll' | 'hop' | 'lumber';

type WaveData = {
  role: 'wave';
  motion: TinkerMotion;
  lead: number;
  offset: Vector3;
  /** Half the visible frame height in world units where this wave is seen. */
  span: number;
  scale: number;
  phase: number;
  fires: boolean;
};

type BlobData = {
  role: 'blob';
  position: Vector3;
  velocity: Vector3;
  lastAge: number;
  scale: number;
  impactAt?: number;
  impactDirection?: Vector3;
  interceptUntil?: number;
};

export type TinkerSpawnData = WaveData | BlobData | SpillSpawnData;
export type TinkerSpawnEntry = LockOnSpawnEntry<TinkerEnemyKind, TinkerSpawnData>;
export type TinkerUpdate = LockOnEnemyUpdate<TinkerEnemyKind, TinkerSpawnData>;

// ---------------------------------------------------------------------------
// Rail and pacing

/**
 * A scratch across the wood. It sweeps wider and climbs as the run goes on:
 * the height above the table is the ball's radius times 4.2, so the rail is
 * literally the growth curve.
 */
export function createTinkerRail() {
  return new CatmullRomCurve3(
    [
      new Vector3(0, 2.9, 0),
      new Vector3(-4, 3.0, -26),
      new Vector3(5, 3.1, -54),
      new Vector3(11, 3.4, -82),
      new Vector3(-2, 3.8, -110),
      new Vector3(-15, 4.2, -140),
      new Vector3(-6, 4.7, -172),
      new Vector3(13, 5.1, -206),
      new Vector3(23, 5.4, -240),
      new Vector3(8, 5.7, -276),
      new Vector3(-13, 6.0, -314),
      new Vector3(-25, 6.4, -350),
      new Vector3(-10, 6.9, -386),
      new Vector3(11, 7.3, -418),
      new Vector3(23, 7.6, -448),
      new Vector3(17, 7.7, -476),
    ],
    false,
    'catmullrom',
    0.4,
  );
}

/** Marble creep, tennis-ball trot, melon charge, with a held breath at the spill. */
const SPEED_KEYS = [
  [0, 0.54],
  [6, 0.62],
  [14, 0.82],
  [18.2, 0.96],
  [26, 1.04],
  [32, 1.14],
  [36.4, 1.26],
  [38.6, 0.9],
  [40, 0.86],
  [44, 1.06],
  [49, 1.2],
  [54, 1.34],
  [57, 1.5],
  [60, 1.28],
] as const;

const RAIL = createTinkerRail();
const RAIL_LENGTH = RAIL.getLength();
const SPEED_PROFILE = createSpeedProfile(SPEED_KEYS, TINKER_RUN_DURATION);

function easeRunProgress(runTime: number, duration: number) {
  return SPEED_PROFILE.runProgress(runTime, duration);
}

function anchorProgress(at: number, lead: number) {
  return easeRunProgress(Math.min(TINKER_RUN_DURATION, at + lead), TINKER_RUN_DURATION);
}

/** World distance from the camera to a wave's anchor at the moment it spawns. */
function aheadUnits(at: number, lead: number) {
  return Math.max(6, RAIL_LENGTH * (anchorProgress(at, lead) - easeRunProgress(at, TINKER_RUN_DURATION)));
}

function railHeightAt(at: number, lead: number) {
  return RAIL.getPointAt(MathUtils.clamp(anchorProgress(at, lead), 0, 1)).y;
}

// ---------------------------------------------------------------------------
// Wave authoring

const MISS_GRACE = 0.014;
const FORMATION_GAP = 0.1;
/** Local y of each creature's lowest point, so ground kinds stand on the wood. */
const FOOT_Y: Record<string, number> = {
  beetle: -0.73,
  strider: -1.7,
  spool: -0.95,
  potter: -1.53,
  ruler: -2.01,
};
const MOTION: Record<string, TinkerMotion> = {
  beetle: 'scuttle',
  strider: 'stride',
  bird: 'swoop',
  spool: 'roll',
  potter: 'hop',
  ruler: 'lumber',
};

type GroundCell = readonly [x: number, depth: number];
type AirCell = readonly [x: number, y: number];

function waveData(at: number, lead: number, kind: TinkerEnemyKind, index: number, offset: Vector3): WaveData {
  const ahead = aheadUnits(at, lead);
  return {
    role: 'wave',
    motion: MOTION[kind] ?? 'scuttle',
    lead,
    offset,
    span: ahead * 0.6,
    scale: ahead / 19,
    phase: index * 1.37,
    fires: kind === 'potter',
  };
}

/** Creatures that walk, roll or hop: seated on the table, spread across the frame and in depth. */
function ground(at: number, lead: number, kind: TinkerEnemyKind, cells: readonly GroundCell[], hitPoints?: number) {
  const ahead = aheadUnits(at, lead);
  const scale = ahead / 19;
  const standing = TABLE_Y - (FOOT_Y[kind] ?? -0.8) * scale - railHeightAt(at, lead);
  return formation<TinkerEnemyKind, TinkerSpawnData>(at, FORMATION_GAP, cells, ([x, depth], index) => ({
    kind,
    ...(hitPoints === undefined ? {} : { hitPoints }),
    data: waveData(at, lead, kind, index, new Vector3(x * ahead * 1.067, standing, depth * ahead * 0.6)),
  }));
}

/** Fliers: authored directly in frame fractions, always above the table line. */
function air(at: number, lead: number, kind: TinkerEnemyKind, cells: readonly AirCell[], hitPoints?: number) {
  const ahead = aheadUnits(at, lead);
  return formation<TinkerEnemyKind, TinkerSpawnData>(at, FORMATION_GAP, cells, ([x, y], index) => ({
    kind,
    ...(hitPoints === undefined ? {} : { hitPoints }),
    data: waveData(at, lead, kind, index, new Vector3(x * ahead * 1.067, y * ahead * 0.6, 0)),
  }));
}

const bar = TINKER_TIME.bar;
const MARBLE_LEAD = 4.4;
const TENNIS_LEAD = 4.0;
const MELON_LEAD = 3.6;

function createTinkerTimeline(spill: ReturnType<typeof createGlueSpill>): TinkerSpawnEntry[] {
  const marble = (index: number, beat = 0) => TINKER_MARKERS.marble + bar(index, beat);
  const tennis = (index: number, beat = 0) => TINKER_MARKERS.tennis + bar(index, beat);
  const melon = (index: number, beat = 0) => TINKER_MARKERS.spill + bar(index, beat);
  const L1 = MARBLE_LEAD;
  const L2 = TENNIS_LEAD;
  const L3 = MELON_LEAD;

  return [
    // --- Marble. Buttons, pins and beads close to the wood; room to learn the
    // sweep. Waves land two bars apart, so about five things are ever alive.
    ...ground(marble(0, 2), L1, 'beetle', [[-0.74, 0], [-0.3, 0.24], [0.32, -0.14], [0.76, 0.06]]),
    ...ground(marble(2), L1, 'strider', [[-0.56, 0.1], [0.04, -0.14], [0.58, 0.12]]),
    ...air(marble(4), L1, 'bird', [[-0.78, 0.44], [-0.44, 0.66], [0.06, 0.72], [0.46, 0.64], [0.78, 0.42]]),
    ...ground(marble(6), L1, 'beetle', [[-0.7, -0.12], [-0.26, 0.2], [0.28, 0.2], [0.72, -0.12]]),
    ...ground(marble(7, 2), L1, 'strider', [[-0.34, 0.3], [0.36, 0.3]]),
    ...air(marble(8, 2), L1, 'bird', [[-0.66, 0.58], [0.68, 0.56]]),

    // --- Tennis ball. Spools race the ball down its own scratch and paint pots
    // start throwing glue: the densest stretch of the run.
    ...ground(tennis(0), L2, 'spool', [[-0.74, 0.04], [-0.28, 0.2], [0.3, 0.2], [0.76, 0.04]]),
    ...air(tennis(1, 2), L2, 'bird', [[-0.78, 0.42], [-0.34, 0.64], [0.36, 0.64], [0.78, 0.42]]),
    ...ground(tennis(3), L2, 'strider', [[-0.72, 0], [-0.26, 0.2], [0.28, 0.2], [0.74, 0]]),
    ...ground(tennis(4, 2), L2, 'beetle', [[-0.6, 0.1], [-0.2, 0.3], [0.22, 0.3], [0.62, 0.1]]),
    ...ground(tennis(4, 3), L2, 'potter', [[-0.78, -0.06], [0.78, -0.06]]),
    ...air(tennis(6), L2, 'bird', [[-0.78, 0.34], [-0.5, 0.56], [-0.16, 0.72], [0.2, 0.72], [0.54, 0.56], [0.78, 0.34]]),
    ...ground(tennis(7, 2), L2, 'spool', [[-0.52, 0.24], [-0.14, 0.36], [0.16, 0.36], [0.54, 0.24]]),
    ...ground(tennis(9), L2, 'beetle', [[-0.78, -0.04], [-0.44, 0.18], [0.46, 0.18], [0.78, -0.04]]),
    ...ground(tennis(9, 2), L2, 'potter', [[-0.14, 0.34], [0.16, 0.34]]),
    // The break: the table empties out under the riser.
    ...air(tennis(10, 2), L2, 'bird', [[-0.68, 0.6], [0.02, 0.74], [0.7, 0.58]]),

    // --- Melon. The spill holds the middle of the frame for the whole fight,
    // so its escorts stay small and wide.
    ...spill.entries(TINKER_MARKERS.spill),
    ...ground(melon(2), L3, 'ruler', [[-0.76, 0.08], [0.78, 0.08]], 2),
    ...air(melon(4), L3, 'bird', [[-0.7, 0.56], [-0.2, 0.72], [0.72, 0.54]]),
    ...ground(melon(6), L3, 'ruler', [[-0.6, 0.26], [0.62, 0.26]], 2),
    ...ground(melon(6, 2), L3, 'beetle', [[-0.78, 0], [0.78, 0]]),
    // Last call: everything after this point cannot finish its window before
    // the rail runs out, so the final bars belong to the spill alone.
    ...air(melon(8), L3, 'bird', [[-0.74, 0.5], [0.06, 0.74], [0.76, 0.48]]),
  ];
}

// ---------------------------------------------------------------------------
// Tuning

const KILL_SCORE: Record<TinkerEnemyKind, number> = {
  beetle: 100,
  strider: 120,
  bird: 130,
  spool: 140,
  potter: 190,
  ruler: 170,
  blob: 40,
  crust: 260,
  core: 460,
  heart: 1700,
};

/** How many supplies each body breaks into. Visuals and the end screen read the same table. */
export const PIECES_PER_KILL: Record<TinkerEnemyKind, number> = {
  beetle: 4,
  strider: 4,
  bird: 4,
  spool: 4,
  potter: 4,
  ruler: 5,
  blob: 2,
  crust: 9,
  core: 8,
  heart: 14,
};

const BLOB_MAX_AGE = 12;
/** The ball rides low and looks slightly down the table; everything is composed around this. */
const CAMERA_PITCH = 0.105;

// ---------------------------------------------------------------------------

export function createTinkerGameplay(
  bus: EventBus,
  say: SpillCallout = () => {},
): LockOnRunnerLevel<TinkerEnemyKind, TinkerSpawnData> {
  const blobIntercepts = new Set<number>();
  let hitsTaken = 0;
  let piecesGathered = 0;

  function fireBlob(context: TinkerUpdate, from: Vector3, scale: number) {
    const initial = hostileShotAimPoint(context.camera, from).sub(from).normalize().multiplyScalar(5);
    context.spawnEnemy({
      time: context.runTime,
      kind: 'blob',
      countsTowardTotal: false,
      // A thrown drop is the one thing that ends up inches from the lens, so
      // its size is capped no matter how big the thing that threw it was.
      data: { role: 'blob', position: from.clone(), velocity: initial, lastAge: 0, scale: Math.min(1.15, scale) },
    });
  }

  const spill = createGlueSpill(bus, fireBlob, say);
  const timeline = sortTimeline(createTinkerTimeline(spill));

  bus.on('runstart', () => {
    blobIntercepts.clear();
    hitsTaken = 0;
    piecesGathered = 0;
  });

  bus.on('playerhit', () => {
    hitsTaken += 1;
  });

  bus.on('fire', ({ enemyId }) => {
    blobIntercepts.add(enemyId);
  });

  bus.on('kill', ({ enemyId }) => {
    blobIntercepts.delete(enemyId);
  });

  bus.on('miss', ({ enemyId }) => {
    blobIntercepts.delete(enemyId);
  });

  /** Legs, wings and wheels, posed from absolute age so a paused frame still looks alive. */
  function animateLimbs(mesh: Object3D, motion: TinkerMotion, age: number, phase: number) {
    const limbs = mesh.userData.limbs as Object3D[] | undefined;
    if (limbs?.length) {
      for (let i = 0; i < limbs.length; i += 1) {
        const limb = limbs[i];
        switch (motion) {
          case 'scuttle':
            limb.rotation.x = Math.sin(age * 13 + i * 1.05 + phase) * 0.55;
            break;
          case 'stride':
            limb.rotation.x = Math.sin(age * 5.4 + i * (Math.PI / 2) + phase) * 0.5;
            break;
          case 'swoop':
            limb.rotation.z = Math.sin(age * 7.2 + phase) * 0.62 * (i === 0 ? 1 : -1);
            break;
          case 'roll':
            limb.rotation.x = -age * 7.5;
            break;
          case 'hop':
            limb.rotation.z = Math.sin(age * 2.3 + phase) * 0.4 * (i === 0 ? 1 : -1);
            limb.scale.y = 1 - Math.max(0, Math.sin(age * 2.3 + phase)) * 0.28;
            break;
          case 'lumber':
            limb.rotation.x = Math.sin(age * 3.1 + i * Math.PI + phase) * 0.42;
            break;
        }
      }
    }
    const beak = mesh.userData.beak as Object3D | undefined;
    if (beak) beak.rotation.z = Math.max(0, Math.sin(age * 7.2 + phase)) * 0.45;
  }

  function updateWave(context: TinkerUpdate, data: WaveData) {
    const { enemy, age, runProgress, curve, camera, railAnchor } = context;
    const anchorU = railAnchor(data.lead);
    const offset = data.offset.clone();
    const span = data.span;
    const phase = data.phase;

    switch (data.motion) {
      case 'scuttle':
        offset.x += Math.sin(age * 3.3 + phase) * 0.04 * span + Math.sin(age * 0.75 + phase) * 0.07 * span;
        offset.y += Math.abs(Math.sin(age * 6.4 + phase)) * 0.012 * span;
        break;
      case 'stride':
        offset.x += Math.sin(age * 1.05 + phase) * 0.09 * span;
        offset.y += Math.sin(age * 2.7 + phase) * 0.02 * span;
        break;
      case 'swoop':
        offset.x += Math.sin(age * 1.3 + phase) * 0.14 * span;
        offset.y += Math.cos(age * 1.75 + phase * 1.3) * 0.11 * span - age * 0.011 * span;
        break;
      case 'roll':
        offset.x += Math.sin(age * 2 + phase) * 0.085 * span;
        // Races the ball down its own scratch and closes the gap as it comes.
        offset.z -= age * span * 0.1;
        break;
      case 'hop': {
        const hop = Math.max(0, Math.sin(age * 2.3 + phase));
        offset.y += hop * hop * 0.08 * span;
        offset.x += Math.sin(age * 0.65 + phase) * 0.07 * span;
        break;
      }
      case 'lumber':
        offset.x += Math.sin(age * 0.72 + phase) * 0.1 * span;
        offset.y += Math.abs(Math.sin(age * 1.55 + phase)) * 0.02 * span;
        break;
    }

    enemy.mesh.position.copy(offsetFromRail(curve, anchorU, offset));
    enemy.mesh.scale.setScalar(data.scale);
    // Supplies on a table stay upright; only the yaw turns to face the ball.
    enemy.mesh.rotation.set(
      data.motion === 'swoop' ? Math.sin(age * 1.75 + phase) * 0.2 : 0,
      Math.atan2(camera.position.x - enemy.mesh.position.x, camera.position.z - enemy.mesh.position.z),
      data.motion === 'swoop' ? Math.sin(age * 1.3 + phase) * 0.45 : Math.sin(age * 1.6 + phase) * 0.06,
    );
    animateLimbs(enemy.mesh, data.motion, age, phase);

    if (data.fires) {
      const fire = context.enemyState(() => ({ nextAt: 1.5, shotsLeft: 2 }));
      if (fire.shotsLeft > 0 && age >= fire.nextAt) {
        fire.shotsLeft -= 1;
        fire.nextAt = age + 2.6;
        fireBlob(context, enemy.mesh.position, data.scale);
      }
    }

    return runProgress > anchorU + MISS_GRACE;
  }

  function updateBlob(context: TinkerUpdate, data: BlobData) {
    const { enemy, age, camera, damagePlayer } = context;
    const dt = Math.max(0, age - data.lastAge);
    data.lastAge = age;
    enemy.mesh.scale.setScalar(data.scale);

    const impact = updateHostileShotImpact({
      age,
      camera,
      position: data.position,
      velocity: data.velocity,
      state: data,
      intercepted: blobIntercepts.delete(enemy.id),
      // Glue lands further out than the engine default: at the ball's scale a
      // drop that closes to arm's length swallows the entire frame.
      config: { hitDistance: 3.4, impactBrake: 0.3, damageDistance: 1.9 },
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
      baseSpeed: 5.5,
      maxSpeed: 12,
      accel: 3,
      turnRate: 2.1,
    });

    enemy.mesh.position.copy(data.position);
    enemy.mesh.quaternion.copy(camera.quaternion);
    enemy.mesh.rotateZ(age * 2.6);
    return shotBehindCamera(camera, data.position) || age > BLOB_MAX_AGE;
  }

  return {
    duration: TINKER_RUN_DURATION,
    bpm: TINKER_BPM,
    playerHealth: TINKER_PLAYER_HEALTH,
    createRail: createTinkerRail,
    spawnTimeline: timeline,
    easeRunProgress,
    lockRadiusNdc: 0.09,
    startWord: 'STICK',
    replayWord: 'AGAIN',
    timing: {
      // A pop level at 132 wants a volley to land inside the bar, not sprawl across it.
      shotDelay: { maxGridSeconds: 0.5 },
    },
    updateEnemy(context) {
      const data = context.enemy.entry.data;
      switch (data.role) {
        case 'wave':
          return updateWave(context, data);
        case 'blob':
          return updateBlob(context, data);
        default:
          return spill.update(context, data);
      }
    },
    updateAttractCamera({ camera }) {
      camera.rotateX(-CAMERA_PITCH);
    },
    updateCameraEffects({ camera, curve, runTime, runProgress }) {
      camera.rotateX(-CAMERA_PITCH);
      // Lean into the scratch's turns the way a rolling ball would.
      const u = MathUtils.clamp(runProgress, 0, 1);
      const before = curve.getTangentAt(Math.max(0, u - 0.006));
      const after = curve.getTangentAt(Math.min(1, u + 0.006));
      const turn = Math.atan2(after.x, -after.z) - Math.atan2(before.x, -before.z);
      camera.rotateZ(MathUtils.clamp(turn * 5.5, -0.15, 0.15));
      camera.position.y += Math.sin(runTime * 5.4) * 0.008 * camera.position.y;
    },
    validateRelease(enemies) {
      return spill.validateRelease(enemies);
    },
    scoreForKill(volleySize, enemy) {
      piecesGathered += PIECES_PER_KILL[enemy.kind] ?? 4;
      const multiplier = 1 + Math.max(0, volleySize - 1) * 0.16;
      return Math.round(KILL_SCORE[enemy.kind] * multiplier);
    },
    scoreForHit: () => 45,
    rankForRun(score, kills, totalEnemies) {
      const clearRate = totalEnemies === 0 ? 0 : kills / totalEnemies;
      if (score >= 13000 && clearRate >= 0.85) return 'S';
      if (score >= 9500 && clearRate >= 0.7) return 'A';
      if (score >= 6000 && clearRate >= 0.5) return 'B';
      if (score >= 2600 && clearRate >= 0.3) return 'C';
      return 'D';
    },
    detailsForRun() {
      const hull = Math.max(0, TINKER_PLAYER_HEALTH - hitsTaken);
      const lines = [`Hull ${hull}/${TINKER_PLAYER_HEALTH}`, `Supplies rescued ${piecesGathered}`];
      const summary = spill.summary();
      if (summary) lines.push(summary);
      return lines;
    },
  };
}
