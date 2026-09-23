import { CatmullRomCurve3, MathUtils, Quaternion, Vector3 } from 'three';
import type { PerspectiveCamera } from 'three';
import {
  hostileShotAimPoint,
  shotBehindCamera,
  steerHomingShot,
  updateHostileShotImpact,
  type HostileShotImpactState,
} from '../../engine/hostile-shot';
import type { LockOnEnemyUpdate, LockOnRunnerLevel, LockOnSpawnEntry } from '../../engine/lock-on-runner';
import type { EventBus } from '../../events';
import { createDescender, DESCENDER_CLAW_COUNT, type DescenderState } from './descender';
import { BAR, BEAT, bar, SKYHOOK_BARS, SKYHOOK_BPM, SKYHOOK_DURATION, SKYHOOK_MARKERS } from './timing';
import {
  altitudeAt,
  driveHeadPoint,
  HEAD_HEIGHT,
  leanDegreesAt,
  SKYHOOK_PLAYER_HEALTH,
  skyhookRunProgress,
  createSkyhookRail,
  tetherPoint,
  viewPoint,
  viewQuaternionAt,
} from './world';

// SKYHOOK — ride a climber car up a space elevator, 33 bars at 128 BPM.
//
//   Liftoff (bar 0)    the car leaves the storm-lashed pad; gantries drop away.
//   Storm   (2–7)      wind-riders surf the gusts; grapplers dive at the car.
//   Punch   (7.5)      the cloud deck: whiteout, then sunlight.
//   Sunlit  (8–15)     blue sky, the last and fastest of the wind-riders.
//   Thin    (16–19)    indigo; vacuum-hardened sentinels and tether ticks.
//   Contact (20–21)    something huge latches onto the tether far above.
//   Descender (22–28)  it climbs down toward the car. Kill it first.
//   Dock    (29–33)    the station opens overhead and swallows the car.
//
// World convention: altitude runs along world −Z. The rail is the camera's
// straight climb beside the tether; the level owns the camera's lean so the
// ribbon rises out of the bottom of the frame to a vanishing point high on
// screen, where the station — and later the Descender — waits.

export { SKYHOOK_BPM, SKYHOOK_DURATION } from './timing';
export * from './world';

// ---- enemy kinds --------------------------------------------------------------

export type SkyhookEnemyKind =
  | 'kite' // wind-rider: surfs a gust across the screen in a banking flock
  | 'grappler' // dives at the car, latches, and bites
  | 'tick' // vacuum-hardened crawler lurching down the ribbon to the car
  | 'sentinel' // vacuum-hardened gun platform that rises past and fires on you
  | 'bolt' // sentinel shot
  | 'claw' // Descender grip joint
  | 'maw'; // Descender core

type ScreenPoint = readonly [sx: number, sy: number, depth: number];

export type SkyhookSpawnData =
  | { role: 'kite'; path: readonly ScreenPoint[]; duration: number; flutter: number }
  | { role: 'grappler'; entry: ScreenPoint; perch: ScreenPoint; slot: number }
  | { role: 'tick'; startAbove: number; travel: number }
  | { role: 'sentinel'; station: ScreenPoint; fireAt: readonly number[]; leaveAt: number }
  | { role: 'bolt'; position: Vector3; velocity: Vector3; lastAge: number; impact: HostileShotImpactState }
  | { role: 'claw'; socket: number }
  | { role: 'maw' };

export type SkyhookSpawnEntry = LockOnSpawnEntry<SkyhookEnemyKind, SkyhookSpawnData>;
export type SkyhookUpdate = LockOnEnemyUpdate<SkyhookEnemyKind, SkyhookSpawnData>;

// Grappler rhythm: glide in, hover with claws open (the telegraph), dive,
// then bite the drive head. A bite costs one hull point.
export const GRAPPLER_ENTER = 1.1;
export const GRAPPLER_HOVER = 1.6;
export const GRAPPLER_DIVE = 0.7;
export const GRAPPLER_GNAW = 2.4;

// ---- spawn builders -------------------------------------------------------------

/** A flock riding one gust: every kite flies the same path, a beat-fraction apart. */
const kites = (time: number, count: number, path: ScreenPoint[], options: { spacing?: number; duration?: number; flutter?: number } = {}): SkyhookSpawnEntry[] =>
  Array.from({ length: count }, (_, index) => ({
    time: time + index * (options.spacing ?? BEAT * 0.5),
    kind: 'kite' as const,
    data: { role: 'kite' as const, path, duration: options.duration ?? 5.4, flutter: options.flutter ?? 1 },
  }));

const grapplers = (time: number, perches: Array<[number, number]>, spacing = BEAT): SkyhookSpawnEntry[] =>
  perches.map(([sx, sy], index) => ({
    time: time + index * spacing,
    kind: 'grappler' as const,
    data: {
      role: 'grappler' as const,
      entry: [Math.sign(sx || 1) * 0.95, 1.3, 30] as const,
      perch: [sx, sy, 21] as const,
      slot: index,
    },
  }));

const ticks = (time: number, count: number, startAbove: number, travelBeats: number, spacingBeats = 2): SkyhookSpawnEntry[] =>
  Array.from({ length: count }, (_, index) => ({
    time: time + index * spacingBeats * BEAT,
    kind: 'tick' as const,
    hitStages: [1, 1],
    data: { role: 'tick' as const, startAbove, travel: travelBeats * BEAT },
  }));

const sentinels = (time: number, stations: Array<[number, number]>, spacing = BEAT): SkyhookSpawnEntry[] =>
  stations.map(([sx, sy], index) => ({
    time: time + index * spacing,
    kind: 'sentinel' as const,
    hitPoints: 2,
    data: {
      role: 'sentinel' as const,
      station: [sx, sy, 24] as const,
      // Shots land on the beat grid: first at the end of the rise, then every bar.
      fireAt: [BAR * 1.25 - index * spacing, BAR * 2.25 - index * spacing, BAR * 3.25 - index * spacing].map((t) => Math.max(1.6, t)),
      leaveAt: BAR * 4.2,
    },
  }));

// Gust paths in screen space. Kites enter off one edge and leave off another.
const sweep = (dir: 1 | -1, y0: number, apex: number, y1: number, depth = 24): ScreenPoint[] => [
  [-1.35 * dir, y0, depth + 4],
  [-0.55 * dir, MathUtils.lerp(y0, apex, 0.8), depth],
  [0.25 * dir, apex, depth - 2],
  [0.8 * dir, MathUtils.lerp(apex, y1, 0.7), depth],
  [1.35 * dir, y1, depth + 4],
];

const loop = (dir: 1 | -1, cx: number, cy: number, r: number, depth = 23): ScreenPoint[] => [
  [-1.35 * dir, cy - r * 0.7, depth + 5],
  [(cx - r) * dir, cy - r * 0.2, depth],
  [cx * dir, cy - r, depth - 3],
  [(cx + r * 1.05) * dir, cy, depth - 1],
  [cx * dir, cy + r, depth + 1],
  [(cx - r * 0.9) * dir, cy + r * 0.2, depth],
  [(cx - r * 0.1) * dir, cy - r * 0.55, depth - 1],
  [1.35 * dir, cy - r * 0.2, depth + 5],
];

const vortex = (depth = 24): ScreenPoint[] => {
  const points: ScreenPoint[] = [[-1.35, -0.2, depth + 6]];
  for (let i = 0; i <= 9; i += 1) {
    const angle = Math.PI + i * 0.72;
    const radius = 0.78 - i * 0.045;
    points.push([Math.cos(angle) * radius * 1.05, 0.12 + Math.sin(angle) * radius * 0.92, depth - i * 0.35]);
  }
  points.push([0.6, 1.35, depth + 2]);
  return points;
};

const updraft = (sx: number, depth = 22): ScreenPoint[] => [
  [sx * 0.2, -1.35, depth - 6],
  [sx * 0.55, -0.55, depth - 2],
  [sx * 0.85, 0.2, depth],
  [sx * 0.7, 0.75, depth + 2],
  [sx * 0.2, 1.35, depth + 4],
];

function buildTimeline(descenderEntries: SkyhookSpawnEntry[]): SkyhookSpawnEntry[] {
  return [
    // --- Liftoff & storm: learn the sweep on flocks riding the weather.
    ...kites(bar(1), 3, sweep(1, 0.55, 0.78, 0.35), { duration: 4.8 }),
    ...kites(bar(2), 4, sweep(-1, 0.1, -0.35, 0.45), { duration: 4.8 }),
    // The first grappler comes alone so its dive at the car reads.
    ...grapplers(bar(3), [[0.6, 0.5]]),
    ...kites(bar(3, 2), 4, loop(-1, 0.35, 0.3, 0.42), { duration: 5.2 }),
    ...kites(bar(4, 3), 3, sweep(1, -0.5, 0.2, 0.7), { duration: 4.4 }),
    ...kites(bar(4, 3.5), 3, sweep(-1, 0.75, 0.35, -0.3), { duration: 4.4 }),
    ...grapplers(bar(5, 2), [[-0.62, 0.55], [0.64, 0.6]], BEAT),
    // The gust vortex: six on one spiral, the storm's full-volley set piece.
    ...kites(bar(6, 1), 6, vortex(), { spacing: BEAT * 0.5, duration: 5.2, flutter: 1.3 }),

    // (bar 7.5: the deck — screen held clear for the punch-through)

    // --- Sunlit: they burst out of the cloud tops with us; densest air combat.
    ...kites(bar(8, 1), 3, updraft(-1), { spacing: BEAT * 0.25, duration: 4.2 }),
    ...kites(bar(8, 1.5), 3, updraft(1), { spacing: BEAT * 0.25, duration: 4.2 }),
    ...grapplers(bar(9, 2), [[-0.66, 0.42], [0.66, 0.42]], BEAT * 0.5),
    ...kites(bar(10, 2), 6, sweep(1, 0.2, 0.85, 0.1, 26), { spacing: BEAT * 0.5, duration: 4.6 }),
    ...kites(bar(12), 4, loop(-1, 0.4, 0.05, 0.5), { spacing: BEAT * 0.5, duration: 5 }),
    ...grapplers(bar(12, 2), [[-0.7, 0.3]]),
    ...ticks(bar(13), 2, 150, 12),
    ...kites(bar(13, 2), 5, sweep(-1, 0.8, 0.45, 0.85, 25), { spacing: BEAT * 0.5, duration: 4.4 }),
    // The last gust: the high wind-riders struggle in the thinning air.
    ...kites(bar(15), 6, loop(1, 0.3, 0.25, 0.55), { spacing: BEAT * 0.5, duration: 5.6, flutter: 1.6 }),

    // --- Thin air: vacuum-hardened things; the tether itself is a way in.
    ...sentinels(bar(16, 1), [[-0.72, 0.55], [0.72, 0.55], [0, 0.82]]),
    ...ticks(bar(17), 3, 170, 11, 1.5),
    ...grapplers(bar(17, 2), [[0.7, 0.25]]),
    ...sentinels(bar(18, 1), [[0.5, 0.72], [-0.62, 0.3]]),
    ...kites(bar(18, 2), 3, sweep(-1, 0.35, 0.6, 0.2, 27), { duration: 5, flutter: 2 }),
    ...ticks(bar(19), 2, 150, 10),
    ...grapplers(bar(19, 2), [[0.62, 0.55]]),

    // --- Contact and the Descender.
    ...descenderEntries,
    ...grapplers(bar(21), [[-0.72, 0.35], [0.72, 0.35]], BEAT * 2),
    ...sentinels(bar(24), [[-0.78, 0.2], [0.78, 0.25]], BEAT * 2),
  ];
}

export function createSkyhookTimeline() {
  const descender = createDescenderEntries();
  return {
    mawEntry: descender.mawEntry,
    timeline: buildTimeline(descender.entries).sort((a, b) => a.time - b.time),
  };
}

function createDescenderEntries() {
  const mawEntry: SkyhookSpawnEntry = {
    time: SKYHOOK_MARKERS.contact,
    kind: 'maw',
    hitStages: [4, 4],
    lockable: false,
    data: { role: 'maw' },
  };
  const claws: SkyhookSpawnEntry[] = Array.from({ length: DESCENDER_CLAW_COUNT }, (_, socket) => ({
    time: SKYHOOK_MARKERS.boss - BEAT * 2 + socket * BEAT * 0.5,
    kind: 'claw' as const,
    hitPoints: 2,
    data: { role: 'claw' as const, socket },
  }));
  return { mawEntry, entries: [mawEntry, ...claws] };
}

// ---- scoring ------------------------------------------------------------------

const KILL_SCORE: Record<SkyhookEnemyKind, number> = {
  kite: 100,
  grappler: 180,
  tick: 220,
  sentinel: 240,
  bolt: 50,
  claw: 450,
  maw: 3000,
};

// Car defenders get paid for how close the threat got.
const CAR_SAVE_BONUS = 120;

const BOLT_MAX_AGE = 9;

/** Dev inspection: `skip-descender` previews the dock without the boss on the line. */
export type SkyhookDebug = 'skip-descender';

export function createSkyhookGameplay(bus: EventBus, debug?: SkyhookDebug): LockOnRunnerLevel<SkyhookEnemyKind, SkyhookSpawnData> & { descender: DescenderState } {
  const created = createSkyhookTimeline();
  const mawEntry = created.mawEntry;
  const timeline = debug === 'skip-descender' ? created.timeline.filter((entry) => entry.kind !== 'maw' && entry.kind !== 'claw') : created.timeline;
  const interceptions = new Set<number>();
  const carThreatIds = new Set<number>();
  let hullHits = 0;
  let carSaves = 0;
  let carThreats = 0;

  bus.on('runstart', () => {
    interceptions.clear();
    carThreatIds.clear();
    hullHits = 0;
    carSaves = 0;
    carThreats = 0;
  });
  bus.on('playerhit', () => {
    hullHits += 1;
  });
  bus.on('fire', ({ enemyId }) => {
    interceptions.add(enemyId);
  });
  bus.on('kill', ({ enemyId }) => {
    interceptions.delete(enemyId);
  });
  bus.on('miss', ({ enemyId }) => {
    interceptions.delete(enemyId);
    carThreatIds.delete(enemyId);
  });
  bus.on('spawn', ({ kind }) => {
    if (kind === 'grappler' || kind === 'tick') carThreats += 1;
  });

  const descender = createDescender(bus, {
    mawEntry,
    spawnTick(context, startAbove, travelBeats) {
      context.spawnEnemy({
        time: context.runTime,
        kind: 'tick',
        hitStages: [1, 1],
        countsTowardTotal: false,
        data: { role: 'tick', startAbove, travel: travelBeats * BEAT },
      });
    },
  });

  // ---- motion ------------------------------------------------------------------

  const scratch = new Vector3();
  const scratch2 = new Vector3();
  const headScratch = new Vector3();

  function updateKite(context: SkyhookUpdate, data: Extract<SkyhookSpawnData, { role: 'kite' }>) {
    const { enemy, age, runTime, runProgress } = context;
    const t = age / data.duration;
    if (t >= 1) return true;
    const path = context.enemyState(() => new CatmullRomCurve3(data.path.map(([x, y, z]) => new Vector3(x, y, z)), false, 'centripetal'));
    const point = path.getPoint(t, scratch);
    const tangent = path.getTangent(Math.min(0.999, t), scratch2);
    // Gust flutter: each kite rides its own eddies on top of the shared path.
    const flutter = data.flutter;
    const sx = point.x + Math.sin(age * 2.3 + enemy.id * 1.7) * 0.025 * flutter;
    const sy = point.y + Math.sin(age * 3.1 + enemy.id) * 0.035 * flutter;
    viewPoint(runTime, runProgress, sx, sy, point.z, enemy.mesh.position);
    // Heading and bank come from the screen-space tangent; visuals read them.
    const heading = Math.atan2(tangent.y, tangent.x);
    const previous = (enemy.mesh.userData.heading as number | undefined) ?? heading;
    let delta = heading - previous;
    if (delta > Math.PI) delta -= Math.PI * 2;
    if (delta < -Math.PI) delta += Math.PI * 2;
    enemy.mesh.userData.heading = heading;
    enemy.mesh.userData.turn = MathUtils.lerp((enemy.mesh.userData.turn as number | undefined) ?? 0, delta * 30, 0.15);
    enemy.mesh.userData.lean = leanDegreesAt(runTime);
    return false;
  }

  function updateGrappler(context: SkyhookUpdate, data: Extract<SkyhookSpawnData, { role: 'grappler' }>) {
    const { enemy, age, runTime, runProgress } = context;
    const mesh = enemy.mesh;
    const enterEnd = GRAPPLER_ENTER;
    const hoverEnd = enterEnd + GRAPPLER_HOVER;
    const diveEnd = hoverEnd + GRAPPLER_DIVE;
    const gnawEnd = diveEnd + GRAPPLER_GNAW;
    const latch = latchPoint(runProgress, data.slot, headScratch);

    if (age < enterEnd) {
      const t = easeOutCubic(age / enterEnd);
      const sx = MathUtils.lerp(data.entry[0], data.perch[0], t);
      const sy = MathUtils.lerp(data.entry[1], data.perch[1], t) + Math.sin(t * Math.PI) * 0.08;
      const depth = MathUtils.lerp(data.entry[2], data.perch[2], t);
      viewPoint(runTime, runProgress, sx, sy, depth, mesh.position);
      mesh.userData.phase = 'enter';
      mesh.userData.charge = 0;
    } else if (age < hoverEnd) {
      const t = (age - enterEnd) / GRAPPLER_HOVER;
      const bob = Math.sin(age * 5.2 + enemy.id) * 0.02;
      viewPoint(runTime, runProgress, data.perch[0] + Math.sin(age * 2.1) * 0.02, data.perch[1] + bob + t * 0.05, data.perch[2] - t * 1.2, mesh.position);
      mesh.userData.phase = 'hover';
      mesh.userData.charge = t;
    } else if (age < diveEnd) {
      // The dive: accelerate from the perch straight onto the drive head.
      const t = (age - hoverEnd) / GRAPPLER_DIVE;
      const from = viewPoint(runTime, runProgress, data.perch[0], data.perch[1] + 0.05, data.perch[2] - 1.2, scratch);
      mesh.position.copy(from).lerp(latch, t * t);
      mesh.userData.phase = 'dive';
      mesh.userData.charge = 1;
    } else if (age < gnawEnd) {
      mesh.position.copy(latch);
      mesh.position.x += Math.sin(age * 38) * 0.05;
      mesh.position.y += Math.cos(age * 31) * 0.04;
      mesh.userData.phase = 'gnaw';
      mesh.userData.charge = (age - diveEnd) / GRAPPLER_GNAW;
      if (!carThreatIds.has(enemy.id)) carThreatIds.add(enemy.id);
    } else {
      context.damagePlayer(1);
      mesh.userData.phase = 'bitten';
      return true;
    }
    mesh.userData.target = latch;
    return false;
  }

  function latchPoint(runProgress: number, slot: number, out: Vector3) {
    driveHeadPoint(runProgress, out);
    // Grapplers bite the camera-facing housing, spread around its rim.
    const angle = -0.9 + (slot % 3) * 0.9;
    out.x += Math.cos(angle) * 0.8;
    out.y += 0.75 + Math.sin(angle) * 0.15;
    out.z += -0.1 + (slot % 2) * 0.5;
    return out;
  }

  function beatClock(time: number) {
    // Inchworm time: most of each beat's travel happens in its first half.
    const beats = time / BEAT;
    const whole = Math.floor(beats);
    return whole + MathUtils.smoothstep(beats - whole, 0, 0.45);
  }

  function updateTick(context: SkyhookUpdate, data: Extract<SkyhookSpawnData, { role: 'tick' }>) {
    const { enemy, runTime, age } = context;
    const state = context.enemyState(() => {
      const spawnTime = runTime - age;
      const startAltitude = altitudeAt(spawnTime) + data.startAbove;
      const arriveTime = spawnTime + data.travel;
      const arriveAltitude = altitudeAt(Math.min(SKYHOOK_DURATION, arriveTime)) + HEAD_HEIGHT + 0.8;
      return { spawnTime, startAltitude, arriveAltitude, clock0: beatClock(spawnTime), clock1: beatClock(arriveTime) };
    });
    const s = MathUtils.clamp((beatClock(runTime) - state.clock0) / Math.max(0.001, state.clock1 - state.clock0), 0, 1);
    const altitude = MathUtils.lerp(state.startAltitude, state.arriveAltitude, s);
    tetherPoint(altitude, enemy.mesh.position);
    enemy.mesh.userData.progress = s;
    enemy.mesh.userData.cracked = enemy.hitStageIndex > 0;
    if (s >= 1) {
      context.damagePlayer(1);
      enemy.mesh.userData.phase = 'bitten';
      return true;
    }
    return false;
  }

  function updateSentinel(context: SkyhookUpdate, data: Extract<SkyhookSpawnData, { role: 'sentinel' }>) {
    const { enemy, age, runTime, runProgress } = context;
    const RISE = 1.4;
    const LEAVE = 1.3;
    const [sx, sy, depth] = data.station;
    let px = sx;
    let py = sy;
    let pd = depth;
    if (age < RISE) {
      const t = easeOutCubic(age / RISE);
      py = MathUtils.lerp(-1.4, sy, t);
      px = sx * MathUtils.lerp(0.7, 1, t);
      pd = depth - (1 - t) * 6;
      enemy.mesh.userData.thrust = 1 - t * 0.7;
    } else if (age < data.leaveAt) {
      py += Math.sin((age - RISE) * 1.3 + enemy.id) * 0.035;
      px += Math.sin((age - RISE) * 0.8 + enemy.id * 2) * 0.03;
      enemy.mesh.userData.thrust = 0.25;
    } else {
      const t = (age - data.leaveAt) / LEAVE;
      if (t >= 1) return true;
      py = sy - t * t * 2.6;
      px = sx * (1 + t * 0.4);
      enemy.mesh.userData.thrust = 0.2;
    }

    const shots = context.enemyState(() => ({ next: 0 }));
    const nextShot = data.fireAt[shots.next];
    enemy.mesh.userData.charge = nextShot === undefined ? 0 : MathUtils.clamp(1 - (nextShot - age) / 0.7, 0, 1);
    viewPoint(runTime, runProgress, px, py, pd, enemy.mesh.position);
    // Recoil kick right after a shot.
    const sinceShot = shots.next > 0 ? age - data.fireAt[shots.next - 1] : 99;
    if (sinceShot < 0.3) enemy.mesh.position.z += (0.3 - sinceShot) * 2.2;
    if (nextShot !== undefined && age >= nextShot && age < data.leaveAt) {
      shots.next += 1;
      fireBolt(context, enemy.mesh.position);
    }
    return false;
  }

  function fireBolt(context: SkyhookUpdate, from: Vector3) {
    const initial = hostileShotAimPoint(context.camera, from).sub(from).normalize().multiplyScalar(4);
    context.spawnEnemy({
      time: context.runTime,
      kind: 'bolt',
      countsTowardTotal: false,
      data: { role: 'bolt', position: from.clone(), velocity: initial, lastAge: 0, impact: {} },
    });
  }

  function updateBolt(context: SkyhookUpdate, data: Extract<SkyhookSpawnData, { role: 'bolt' }>) {
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
      if (impact.damaged) {
        damagePlayer(1);
        return true;
      }
      return false;
    }
    steerHomingShot(data.position, data.velocity, hostileShotAimPoint(camera, data.position), age, dt, {
      baseSpeed: 6,
      maxSpeed: 12,
      accel: 3,
      turnRate: 2.2,
    });
    enemy.mesh.position.copy(data.position);
    enemy.mesh.userData.velocity = data.velocity;
    return age > BOLT_MAX_AGE || shotBehindCamera(camera, data.position);
  }

  // ---- the runner contract -----------------------------------------------------------

  // The runner aims the camera straight down the rail (world −Z, so its base
  // orientation is the identity once its one-second start ease is done); this
  // level leans it. Whatever the runner added on top is the player's edge-look,
  // which survives the lean: final = lean · edge. During the runner's start ease
  // the level owns the camera outright — REPLAY cuts cleanly from the station
  // back to the pad instead of flying down the whole tether — and the edge-look
  // fades back in over a few frames.
  const lean = new Quaternion();
  const edge = new Quaternion();
  const identity = new Quaternion();

  function leanCamera(camera: PerspectiveCamera, curve: CatmullRomCurve3, runTime: number, runProgress: number) {
    viewQuaternionAt(runTime, lean);
    if (runTime < 1) {
      camera.position.copy(curve.getPointAt(runProgress));
      camera.quaternion.copy(lean);
    } else {
      edge.copy(identity).slerp(camera.quaternion, MathUtils.smoothstep(runTime, 1, 1.35));
      camera.quaternion.copy(lean).multiply(edge);
    }
    camera.updateMatrixWorld();
  }

  return {
    duration: SKYHOOK_DURATION,
    bpm: SKYHOOK_BPM,
    playerHealth: SKYHOOK_PLAYER_HEALTH,
    createRail: createSkyhookRail,
    spawnTimeline: timeline,
    easeRunProgress: skyhookRunProgress,
    startWord: 'ASCEND',
    descender: descender.state,
    updateAttractCamera({ camera, curve }) {
      // Parked on the pad, looking up the ribbon into the weather.
      camera.position.copy(curve.getPointAt(0));
      viewQuaternionAt(0, camera.quaternion);
      camera.updateMatrixWorld();
    },
    updateCameraEffects({ camera, curve, runTime, runProgress }) {
      leanCamera(camera, curve, runTime, runProgress);
    },
    updateEnemy(context) {
      const data = context.enemy.entry.data;
      switch (data.role) {
        case 'kite':
          return updateKite(context, data);
        case 'grappler':
          return updateGrappler(context, data);
        case 'tick':
          return updateTick(context, data);
        case 'sentinel':
          return updateSentinel(context, data);
        case 'bolt':
          return updateBolt(context, data);
        case 'claw':
          return descender.updateClaw(context, data.socket);
        case 'maw':
          return descender.updateMaw(context);
      }
    },
    scoreForKill(volleySize, enemy) {
      const multiplier = 1 + Math.max(0, volleySize - 1) * 0.15;
      let award = KILL_SCORE[enemy.kind] * multiplier;
      // A grappler shot off the car, or a tick picked off the ribbon near the head.
      const threat = enemy.kind === 'grappler' || enemy.kind === 'tick';
      if (threat) {
        carSaves += 1;
        const phase = enemy.mesh.userData.phase as string | undefined;
        const close = phase === 'gnaw' || phase === 'dive' || ((enemy.mesh.userData.progress as number | undefined) ?? 0) > 0.7;
        if (close) award += CAR_SAVE_BONUS;
      }
      return Math.round(award);
    },
    // Cracking tick shells, claw armor, and the maw pays a little.
    scoreForHit: () => 40,
    scoreForVolley(results) {
      if (results.length < 4 || !results.every((result) => result.killed)) return 0;
      return results.length === 6 ? 600 : results.length * 70;
    },
    rankForRun(score, kills, totalEnemies) {
      const clearRate = totalEnemies === 0 ? 0 : kills / totalEnemies;
      const docked = descender.state.killed;
      if (docked && hullHits === 0 && score >= 26000 && clearRate >= 0.85) return 'S';
      if (docked && score >= 19000 && clearRate >= 0.7) return 'A';
      if (score >= 12000 && clearRate >= 0.5) return 'B';
      if (score >= 5000 && clearRate >= 0.25) return 'C';
      return 'D';
    },
    detailsForRun() {
      const hull = Math.max(0, SKYHOOK_PLAYER_HEALTH - hullHits);
      const lines = [`Hull ${hull}/${SKYHOOK_PLAYER_HEALTH}`];
      if (carThreats > 0) lines.push(`Car attackers stopped ${Math.min(carSaves, carThreats)}/${carThreats}`);
      lines.push(descender.summaryLine());
      return lines;
    },
  };
}

function easeOutCubic(t: number) {
  const clamped = MathUtils.clamp(t, 0, 1);
  return 1 - (1 - clamped) ** 3;
}

export { SKYHOOK_BARS, SKYHOOK_MARKERS, BAR, BEAT, bar };
