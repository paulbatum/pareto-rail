import { CatmullRomCurve3, MathUtils, Vector3 } from 'three';
import {
  hostileShotAimPoint,
  shotBehindCamera,
  steerHomingShot,
  updateHostileShotImpact,
  type HostileShotImpactState,
} from '../../engine/hostile-shot';
import type { LockOnEnemyUpdate, LockOnRunnerLevel, LockOnSpawnEntry } from '../../engine/lock-on-runner';
import { offsetFromRail } from '../../engine/rail';
import { createSpeedProfile } from '../../engine/speed-profile';
import type { EventBus } from '../../events';
import { createTetherjack, createTetherjackEntry } from './ripper';
import {
  bar,
  BOSS_LATCH_TIME,
  CLOUDBREAK_TIME,
  DOCK_TIME,
  SKYHOOK_BPM,
  SKYHOOK_DURATION,
  SKYHOOK_TIME,
  THIN_TIME,
} from './timing';

// SKYHOOK — riding a climber car up a space elevator, 60 seconds bottom to
// dock. The whole run is one straight climb: the world is built on a single
// tilted axis so the camera keeps a stable horizon reference while everything
// on screen reads as "up". Speed is the world falling away — cloud decks punch
// past, rain gives way to debris, the tether collars whip by — and the climb
// decelerates hard into the station over the last four bars.

export {
  BOSS_LATCH_TIME,
  BOSS_REACH_TIME,
  CLOUDBREAK_TIME,
  DOCK_TIME,
  SKYHOOK_BPM,
  SKYHOOK_DURATION,
  THIN_TIME,
  VACUUM_TIME,
  bar,
} from './timing';

export const SKYHOOK_PLAYER_HEALTH = 4;

// ---- the climb axis ---------------------------------------------------------

// The climb is a straight line pitched 62° above the horizon. Steep enough to
// read as vertical, shallow enough that lookAt() and the rail frame stay
// perfectly stable. Every visual that implies "down" (rain, debris, cloud
// decks, the horizon band) uses this axis, so the tilt is undetectable.
const PITCH = MathUtils.degToRad(62);
export const CLIMB_AXIS = new Vector3(0, Math.sin(PITCH), -Math.cos(PITCH));
export const AXIS_RIGHT = new Vector3(1, 0, 0);
export const AXIS_UP = new Vector3().crossVectors(AXIS_RIGHT, CLIMB_AXIS).normalize();

/** Total climb distance in world units over the 60-second run. */
export const CLIMB_LENGTH = 720;
/** The station dock aperture sits just past the end of the rail. */
export const STATION_S = CLIMB_LENGTH + 46;
/** The tether is a straight line offset from the climb axis; the car hugs it. */
export const TETHER_LATERAL = new Vector3()
  .addScaledVector(AXIS_RIGHT, 3.6)
  .addScaledVector(AXIS_UP, -1.4);

/** World position of the tether at climb distance `s`. */
export function tetherPoint(s: number, out = new Vector3()) {
  return out.copy(TETHER_LATERAL).addScaledVector(CLIMB_AXIS, s);
}

/** World position on the climb axis (no tether offset) at distance `s`. */
export function axisPoint(s: number, out = new Vector3()) {
  return out.copy(CLIMB_AXIS).multiplyScalar(s);
}

export type SkyhookEnemyKind =
  | 'kite'
  | 'vane'
  | 'dart'
  | 'grappler'
  | 'bulwark'
  | 'rivet'
  | 'ripper';

// Timeline data is immutable — per-enemy runtime state lives in the runner's
// enemyState bags, boss state lives in the ripper module.
export type SkyhookSpawnData =
  | { role: 'kite'; lead: number; fromX: number; toX: number; y: number; bob: number; crossTime: number; delay: number }
  | { role: 'vane'; lead: number; offset: Vector3; spin: number; phase: number }
  | { role: 'dart'; lead: number; entryX: number; holdX: number; exitX: number; y: number; holdTime: number }
  | { role: 'grappler'; latch: Vector3; approachTime: number; armTime: number; fromSide: number }
  | { role: 'bulwark'; leadStart: number; leadEnd: number; closeTime: number; offset: Vector3 }
  | { role: 'rivet'; position: Vector3; velocity: Vector3; lastAge: number; impact: HostileShotImpactState }
  | { role: 'ripper' };

export type SkyhookSpawnEntry = LockOnSpawnEntry<SkyhookEnemyKind, SkyhookSpawnData>;
export type SkyhookUpdate = LockOnEnemyUpdate<SkyhookEnemyKind, SkyhookSpawnData>;

// ---- speed profile → rail easing --------------------------------------------

// The car accelerates out of the weather, punches the cloud deck on drop 1,
// surges again as the air thins, then brakes hard into the dock.
const SPEED_KEYS: Array<[number, number]> = [
  [bar(0), 0.72],
  [bar(4), 0.9],
  [bar(7.5), 1.0],
  [bar(8.3), 1.78],
  [bar(10), 1.15],
  [bar(15.5), 1.25],
  [bar(16.6), 1.66],
  [bar(18), 1.3],
  [bar(24), 1.1],
  [bar(28), 0.95],
  [bar(30), 0.42],
  [bar(32), 0.13],
];

const speedProfile = createSpeedProfile(SPEED_KEYS, SKYHOOK_DURATION);

export const speedFactorAt = speedProfile.speedAt;

export function skyhookRunProgress(time: number, duration = SKYHOOK_DURATION) {
  return speedProfile.runProgress(time, duration);
}

/** Climb distance (world units along the axis) the car has covered at run time `t`. */
export function railSAt(time: number) {
  return CLIMB_LENGTH * skyhookRunProgress(time);
}

/** The cloud deck sits exactly where the car is at the cloud-break drop. */
export const CLOUD_DECK_S = railSAt(CLOUDBREAK_TIME);
/** Faint cirrus sheet higher up, crossed mid-blue. */
export const CIRRUS_S = railSAt(SKYHOOK_TIME.bar(12.5));
/** Air (rain, wind streaks, buffeting) has effectively run out past this height. */
export const ATMOSPHERE_TOP_S = railSAt(THIN_TIME + 4);

// ---- rail -------------------------------------------------------------------

// The rail meanders a few units around the tether line — the car swaying on
// its bogies in the storm — and steadies as the air thins.
const SWAY: Array<[number, number]> = [
  [0, 0],
  [3.4, -1.2],
  [-4.1, 1.7],
  [4.6, 0.6],
  [-3.3, -1.5],
  [2.6, 1.2],
  [-2.1, 0.8],
  [1.8, -0.9],
  [-1.4, 0.7],
  [1.1, 0.5],
  [-0.8, -0.4],
  [0.6, 0.3],
  [-0.4, 0.2],
  [0.25, -0.12],
  [0, 0],
];

export function createSkyhookRail() {
  const points = SWAY.map(([swayX, swayY], index) => {
    const s = (CLIMB_LENGTH * index) / (SWAY.length - 1);
    return axisPoint(s)
      .addScaledVector(AXIS_RIGHT, swayX)
      .addScaledVector(AXIS_UP, swayY);
  });
  return new CatmullRomCurve3(points, false, 'catmullrom', 0.4);
}

// ---- spawn timeline ---------------------------------------------------------

const kites = (
  time: number,
  lead: number,
  runs: Array<{ fromX: number; toX: number; y: number; bob: number; delay?: number; crossTime?: number }>,
): SkyhookSpawnEntry[] =>
  runs.map((run, index) => ({
    time: time + index * 0.09,
    kind: 'kite',
    data: {
      role: 'kite',
      lead,
      fromX: run.fromX,
      toX: run.toX,
      y: run.y,
      bob: run.bob,
      delay: run.delay ?? index * 0.4,
      crossTime: run.crossTime ?? 2.7,
    },
  }));

const vanes = (time: number, lead: number, spin: number, offsets: Array<[number, number]>): SkyhookSpawnEntry[] =>
  offsets.map((offset, index) => ({
    time: time + index * 0.13,
    kind: 'vane',
    data: { role: 'vane', lead, spin, phase: index * 1.13, offset: new Vector3(offset[0], offset[1], 0) },
  }));

const darts = (
  time: number,
  lead: number,
  runs: Array<{ entryX: number; holdX: number; exitX: number; y: number; holdTime?: number }>,
): SkyhookSpawnEntry[] =>
  runs.map((run, index) => ({
    time: time + index * 0.22,
    kind: 'dart',
    data: {
      role: 'dart',
      lead,
      entryX: run.entryX,
      holdX: run.holdX,
      exitX: run.exitX,
      y: run.y,
      holdTime: run.holdTime ?? 1.0,
    },
  }));

// Latch points sit on the visible car deck at the bottom of the frame.
// All three project comfortably inside the frame at the game's 62° FOV — a
// latch the player cannot see or shoot would be unavoidable damage.
const GRAPPLE_LATCHES: Array<[number, number]> = [
  [1.3, -1.5],
  [2.7, -1.35],
  [0.3, -1.7],
];

const grappler = (time: number, latchIndex: number, fromSide: number): SkyhookSpawnEntry => ({
  time,
  kind: 'grappler',
  hitPoints: 2,
  data: {
    role: 'grappler',
    latch: new Vector3(GRAPPLE_LATCHES[latchIndex % GRAPPLE_LATCHES.length][0], GRAPPLE_LATCHES[latchIndex % GRAPPLE_LATCHES.length][1], 3.6),
    approachTime: 2.1,
    armTime: 3.4,
    fromSide,
  },
});

const bulwark = (time: number, x: number, y: number): SkyhookSpawnEntry => ({
  time,
  kind: 'bulwark',
  hitStages: [3, 3],
  data: { role: 'bulwark', leadStart: 6.6, leadEnd: 3.0, closeTime: 7.5, offset: new Vector3(x, y, 0) },
});

function buildSkyhookTimeline(bossEntry: SkyhookSpawnEntry): SkyhookSpawnEntry[] {
  return [
    // --- Storm (bars 1–8): wind-riders. Learn the sweep in the murk.
    ...kites(bar(0.4), 4.6, [
      { fromX: -18, toX: 18, y: 3.2, bob: 2 },
      { fromX: 18, toX: -18, y: 1, bob: 2.4 },
    ]),
    ...vanes(bar(1.6), 4.7, 0.3, [[-7.5, 0.8], [7.5, 0.8]]),
    ...kites(bar(1), 4.6, [
      { fromX: -20, toX: 20, y: 2.6, bob: 2.2 },
      { fromX: -20, toX: 20, y: 0.6, bob: 3.0 },
      { fromX: -20, toX: 20, y: 4.6, bob: 1.6 },
    ]),
    ...vanes(bar(2.5), 4.8, 0.32, [[-8.5, 1.2], [-3.2, 4.4], [3.2, 4.4], [8.5, 1.2]]),
    ...kites(bar(4), 4.4, [
      { fromX: 21, toX: -21, y: 3.4, bob: 2.4 },
      { fromX: -21, toX: 21, y: 1.2, bob: 2.8 },
      { fromX: 21, toX: -21, y: 5.2, bob: 1.4 },
      { fromX: -21, toX: 21, y: -0.4, bob: 3.2 },
    ]),
    ...vanes(bar(5.5), 4.6, -0.4, [[-9.5, -0.8], [-4.8, 1.8], [0, 3.2], [4.8, 1.8], [9.5, -0.8]]),
    ...kites(bar(6.75), 4.2, [
      { fromX: -22, toX: 22, y: 2, bob: 2.6, crossTime: 2.3 },
      { fromX: 22, toX: -22, y: 4.2, bob: 1.8, crossTime: 2.3 },
      { fromX: -22, toX: 22, y: 0, bob: 3, crossTime: 2.3 },
    ]),

    // (bars 7.6–8.3: screen kept clear for the cloud-break punch)

    // --- Blue (bars 8–16): sunlit climb; the car becomes a target.
    ...vanes(bar(8.4), 3.9, 0.5, [[-9, 2], [-4.4, 5], [0, 6.2], [4.4, 5], [9, 2], [0, 0.6]]),
    grappler(bar(9.5), 0, -1),
    ...kites(bar(10.25), 3.8, [
      { fromX: -22, toX: 22, y: 3.2, bob: 2 },
      { fromX: 22, toX: -22, y: 1.2, bob: 2.4 },
    ]),
    ...darts(bar(10.75), 3.9, [
      { entryX: -24, holdX: -8.5, exitX: 24, y: 4.8 },
      { entryX: 24, holdX: 8.5, exitX: -24, y: 2.4 },
      { entryX: -24, holdX: -3, exitX: 24, y: 0.2 },
    ]),
    grappler(bar(12), 1, 1),
    ...vanes(bar(12.5), 3.9, -0.36, [[-9.5, 0.8], [-4.6, 3.4], [4.6, 3.4], [9.5, 0.8]]),
    ...kites(bar(13.5), 3.8, [
      { fromX: 22, toX: -22, y: 5, bob: 1.5 },
      { fromX: -22, toX: 22, y: 2.8, bob: 2.2 },
      { fromX: 22, toX: -22, y: 0.4, bob: 2.8 },
    ]),
    grappler(bar(14), 2, -1),
    bulwark(bar(14.5), 0, 3.4),
    ...darts(bar(15.1), 3.7, [
      { entryX: 24, holdX: 7.5, exitX: -24, y: 5.6 },
      { entryX: -24, holdX: -7.5, exitX: 24, y: 1.2 },
    ]),

    // (bars 15.6–16.4: clear for the thin-air surge)

    // --- Thin (bars 16–24): vacuum-hardened kinds; the Tetherjack latches at 18.
    ...darts(bar(16.5), 3.7, [
      { entryX: -25, holdX: -9.5, exitX: 25, y: 3.8 },
      { entryX: 25, holdX: 9.5, exitX: -25, y: 1.6 },
      { entryX: -25, holdX: 0, exitX: 25, y: 6 },
      { entryX: 25, holdX: -4, exitX: -25, y: -0.6 },
    ]),
    grappler(bar(17.6), 0, 1),
    bossEntry, // bar 18 — it hits the tether high above and starts down
    ...vanes(bar(19), 3.8, 0.42, [[-9, 2.8], [-3.4, 5.4], [3.4, 5.4], [9, 2.8]]),
    bulwark(bar(19.6), -4.5, 2.2),
    ...darts(bar(20.6), 3.6, [
      { entryX: 25, holdX: 8.5, exitX: -25, y: 4.6 },
      { entryX: -25, holdX: -8.5, exitX: 25, y: 2 },
    ]),
    grappler(bar(21.4), 1, -1),
    ...vanes(bar(22.2), 3.7, -0.45, [[-8, 0.4], [0, -1], [8, 0.4]]),
    ...darts(bar(22.8), 3.5, [
      { entryX: -25, holdX: -6, exitX: 25, y: 6.2 },
      { entryX: 25, holdX: 6, exitX: -25, y: 3 },
    ]),

    // --- Vacuum (bars 24–28): sparse pressure; the boss is the show.
    ...darts(bar(24.4), 3.5, [
      { entryX: -25, holdX: -10, exitX: 25, y: 4.6 },
      { entryX: 25, holdX: 10, exitX: -25, y: 1.2 },
      { entryX: -25, holdX: 2, exitX: 25, y: 2.8, holdTime: 0.7 },
    ]),
    grappler(bar(25.4), 2, 1),
    grappler(bar(25.7), 0, -1),
    ...vanes(bar(26.6), 3.4, 0.5, [[-7, 4.2], [7, 4.2]]),

    // (bars 28–32: tether clear — the dock sequence owns the screen)
  ];
}

export function createSkyhookTimeline() {
  const bossEntry = createTetherjackEntry(BOSS_LATCH_TIME);
  return {
    bossEntry,
    timeline: buildSkyhookTimeline(bossEntry).sort((a, b) => a.time - b.time),
  };
}

const KILL_SCORE: Record<SkyhookEnemyKind, number> = {
  kite: 100,
  vane: 120,
  dart: 170,
  grappler: 280,
  bulwark: 340,
  rivet: 40,
  ripper: 2200,
};

const GRAPPLER_BITE_INTERVAL = 2.4;

export function createSkyhookGameplay(bus: EventBus): LockOnRunnerLevel<SkyhookEnemyKind, SkyhookSpawnData> {
  const { timeline, bossEntry } = createSkyhookTimeline();

  const interceptions = new Set<number>();
  let hitsTaken = 0;
  let grapplersCut = 0;

  bus.on('runstart', () => {
    interceptions.clear();
    hitsTaken = 0;
    grapplersCut = 0;
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

  function throwRivet(context: SkyhookUpdate, from: Vector3, speed: number) {
    const initial = hostileShotAimPoint(context.camera, from).sub(from).normalize().multiplyScalar(speed);
    context.spawnEnemy({
      time: context.runTime,
      kind: 'rivet',
      countsTowardTotal: false,
      data: { role: 'rivet', position: from.clone(), velocity: initial, lastAge: 0, impact: {} },
    });
  }

  const tetherjack = createTetherjack(bus, { bossEntry, throwRivet });

  // ---- movement -------------------------------------------------------------

  function updateKite(context: SkyhookUpdate, data: Extract<SkyhookSpawnData, { role: 'kite' }>) {
    const { enemy, runProgress, age, curve, railAnchor } = context;
    const anchorU = railAnchor(data.lead);
    const t = (age - data.delay) / data.crossTime;
    if (t > 1.15 || runProgress > anchorU + 0.012) return true;
    const clamped = MathUtils.clamp(t, 0, 1);
    const eased = clamped * clamped * (3 - 2 * clamped);
    // Gusts shove it around while it rides the crosswind.
    const gust = Math.sin(age * 2.1 + enemy.id * 1.7) * 1.5;
    const x = MathUtils.lerp(data.fromX, data.toX, eased) + gust;
    const y = data.y + Math.sin(clamped * Math.PI) * data.bob + Math.sin(age * 3.3 + enemy.id) * 0.5;
    enemy.mesh.position.copy(offsetFromRail(curve, anchorU, new Vector3(x, y, Math.sin(age * 2.6 + enemy.id) * 0.5)));
    const ahead = offsetFromRail(curve, anchorU, new Vector3(
      MathUtils.lerp(data.fromX, data.toX, Math.min(1, eased + 0.05)) + gust,
      data.y + Math.sin(Math.min(1, clamped + 0.05) * Math.PI) * data.bob,
      0,
    ));
    enemy.mesh.lookAt(ahead);
    // Bank into the gusts — a taut wing, not a projectile.
    enemy.mesh.rotateZ(Math.cos(age * 2.1 + enemy.id * 1.7) * 0.7);
    return false;
  }

  function updateVane(context: SkyhookUpdate, data: Extract<SkyhookSpawnData, { role: 'vane' }>) {
    const { enemy, runProgress, age, curve, camera, railAnchor } = context;
    const anchorU = railAnchor(data.lead);
    // The whole formation wheels slowly; each rotor bobs on its own phase.
    const angle = age * data.spin;
    const x = data.offset.x * Math.cos(angle) - data.offset.y * Math.sin(angle);
    const y = data.offset.x * Math.sin(angle) + data.offset.y * Math.cos(angle) + 1.4 + Math.sin(age * 1.6 + data.phase) * 0.45;
    enemy.mesh.position.copy(offsetFromRail(curve, anchorU, new Vector3(x, y, 0)));
    enemy.mesh.quaternion.copy(camera.quaternion);
    enemy.mesh.rotateZ(Math.sin(age * 0.9 + data.phase) * 0.25);
    return runProgress > anchorU + 0.014;
  }

  function updateDart(context: SkyhookUpdate, data: Extract<SkyhookSpawnData, { role: 'dart' }>) {
    const { enemy, runProgress, age, curve, railAnchor } = context;
    const anchorU = railAnchor(data.lead);
    const ENTER = 0.55;
    const EXIT = 0.5;
    const total = ENTER + data.holdTime + EXIT;
    if (age > total + 0.15 || runProgress > anchorU + 0.012) return true;
    // Three hard phases: dash in, twitchy hold, snap away. Nothing smooth about it.
    let x: number;
    if (age < ENTER) {
      const t = age / ENTER;
      x = MathUtils.lerp(data.entryX, data.holdX, 1 - (1 - t) ** 3);
    } else if (age < ENTER + data.holdTime) {
      x = data.holdX + Math.sin(age * 21 + enemy.id) * 0.22;
    } else {
      const t = (age - ENTER - data.holdTime) / EXIT;
      x = MathUtils.lerp(data.holdX, data.exitX, t * t);
    }
    const y = data.y + Math.sin(age * 17 + enemy.id * 2.3) * 0.12;
    const position = offsetFromRail(curve, anchorU, new Vector3(x, y, 0));
    // Nose along its own velocity: sharp attitude snaps at the phase changes.
    const prev = enemy.mesh.position.clone();
    enemy.mesh.position.copy(position);
    if (prev.distanceToSquared(position) > 0.0004) {
      enemy.mesh.lookAt(position.clone().multiplyScalar(2).sub(prev));
    }
    return false;
  }

  function updateGrappler(context: SkyhookUpdate, data: Extract<SkyhookSpawnData, { role: 'grappler' }>) {
    const { enemy, age, runProgress, curve, camera, damagePlayer } = context;
    const state = context.enemyState(() => ({ nextBiteAt: data.approachTime + data.armTime }));
    // It gets a couple of bites, then loses its grip and drops away — a
    // persistent-forever grappler would be both unfair and unbounded.
    if (age > data.approachTime + data.armTime + 7.5) return true;
    const carU = MathUtils.clamp(runProgress + 0.0015, 0, 1);
    const latchWorld = offsetFromRail(curve, carU, data.latch);
    if (age < data.approachTime) {
      // Swings up from below the deck edge on a rising arc.
      const t = age / data.approachTime;
      const eased = t * t * (3 - 2 * t);
      const start = new Vector3(data.latch.x + data.fromSide * 13, data.latch.y - 10, data.latch.z + 7);
      const swing = new Vector3(
        MathUtils.lerp(start.x, data.latch.x, eased) + Math.sin(t * Math.PI) * data.fromSide * 2.5,
        MathUtils.lerp(start.y, data.latch.y, eased),
        MathUtils.lerp(start.z, data.latch.z, eased),
      );
      enemy.mesh.position.copy(offsetFromRail(curve, carU, swing));
      enemy.mesh.lookAt(latchWorld);
      enemy.mesh.userData.latched = false;
      return false;
    }
    // Latched: it rides the car and starts tearing at the hull once armed.
    const grind = Math.sin(age * 23) * 0.05;
    enemy.mesh.position.copy(latchWorld).addScaledVector(AXIS_RIGHT, grind);
    enemy.mesh.quaternion.copy(camera.quaternion);
    enemy.mesh.rotateZ(data.fromSide * 0.35 + Math.sin(age * 5.2) * 0.1);
    enemy.mesh.userData.latched = true;
    enemy.mesh.userData.armed = age > data.approachTime + data.armTime * 0.55;
    if (age >= state.nextBiteAt) {
      state.nextBiteAt = age + GRAPPLER_BITE_INTERVAL;
      enemy.mesh.userData.biteAt = context.runTime;
      damagePlayer(1);
    }
    return false;
  }

  function updateBulwark(context: SkyhookUpdate, data: Extract<SkyhookSpawnData, { role: 'bulwark' }>) {
    const { enemy, runProgress, age, curve, camera, railAnchor } = context;
    const close = Math.min(1, age / data.closeTime);
    const lead = MathUtils.lerp(data.leadStart, data.leadEnd, close * close * (3 - 2 * close));
    const anchorU = railAnchor(lead);
    const offset = data.offset.clone();
    offset.x += Math.sin(age * 0.45) * 1.0;
    offset.y += 1.6 + Math.sin(age * 0.7) * 0.6;
    enemy.mesh.position.copy(offsetFromRail(curve, anchorU, offset));
    enemy.mesh.quaternion.copy(camera.quaternion);
    enemy.mesh.rotateZ(age * 0.3);
    // Armor gone (stage 1): the exposed core shudders.
    if (enemy.hitStageIndex > 0) {
      enemy.mesh.position.x += Math.sin(age * 19) * 0.12;
      enemy.mesh.position.y += Math.cos(age * 16) * 0.1;
    }
    return runProgress > anchorU + 0.014;
  }

  const RIVET_MAX_AGE = 12;

  function updateRivet(context: SkyhookUpdate, data: Extract<SkyhookSpawnData, { role: 'rivet' }>) {
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
      turnRate: 2.2,
    });
    enemy.mesh.position.copy(data.position);
    if (data.velocity.lengthSq() > 0.001) {
      enemy.mesh.lookAt(data.position.clone().add(data.velocity));
    }
    return age > RIVET_MAX_AGE || shotBehindCamera(camera, data.position);
  }

  // ---- level definition -----------------------------------------------------

  return {
    duration: SKYHOOK_DURATION,
    bpm: SKYHOOK_BPM,
    playerHealth: SKYHOOK_PLAYER_HEALTH,
    createRail: createSkyhookRail,
    spawnTimeline: timeline,
    easeRunProgress: skyhookRunProgress,
    startWord: 'CLIMB',
    updateEnemy(context) {
      const data = context.enemy.entry.data;
      switch (data.role) {
        case 'kite':
          return updateKite(context, data);
        case 'vane':
          return updateVane(context, data);
        case 'dart':
          return updateDart(context, data);
        case 'grappler':
          return updateGrappler(context, data);
        case 'bulwark':
          return updateBulwark(context, data);
        case 'rivet':
          return updateRivet(context, data);
        case 'ripper':
          return tetherjack.update(context);
      }
    },
    scoreForKill(volleySize, enemy) {
      if (enemy.kind === 'grappler') grapplersCut += 1;
      const multiplier = 1 + Math.max(0, volleySize - 1) * 0.18;
      return Math.round(KILL_SCORE[enemy.kind] * multiplier);
    },
    // Chipping armor (bulwark plates, the Tetherjack's carapace) pays a little.
    scoreForHit: () => 45,
    scoreForVolley(results) {
      if (results.length < 4) return 0;
      if (!results.every((result) => result.killed)) return 0;
      return results.length === 6 ? 500 : results.length * 60;
    },
    rankForRun(score, kills, totalEnemies) {
      const clearRate = totalEnemies === 0 ? 0 : kills / totalEnemies;
      if (tetherjack.killed() && score >= 13800 && clearRate >= 0.9) return 'S';
      if (score >= 9000 && clearRate >= 0.6) return 'A';
      if (score >= 4800 && clearRate >= 0.4) return 'B';
      if (score >= 2200 && clearRate >= 0.2) return 'C';
      return 'D';
    },
    detailsForRun() {
      const hull = Math.max(0, SKYHOOK_PLAYER_HEALTH - hitsTaken);
      const lines = [`Hull ${hull}/${SKYHOOK_PLAYER_HEALTH}`];
      if (grapplersCut > 0) lines.push(`${grapplersCut} grappler${grapplersCut === 1 ? '' : 's'} cut off the car`);
      const bossLine = tetherjack.summaryLine();
      if (bossLine) lines.push(bossLine);
      return lines;
    },
  };
}
